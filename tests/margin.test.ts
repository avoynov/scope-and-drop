import { describe, expect, it } from "vitest";
import { Career, settleContract } from "../src/armoury/career";
import { emptyLoadout } from "../src/armoury/loadout";
import { MARGIN, afterContract, contractMarginUsed, effectiveMargin, freshMargin, judgeShot, marginHint, marginRng, shotQuality, usedInWords, type MarginState } from "../src/armoury/margin";

/**
 * The simulation (scripts/margin-sim.ts), loaded by path so the typecheck (browser code, without Node's types) doesn't
 * take it in.
 */
const SIM = "../scripts/margin-sim.ts";
interface Sim {
  RANGE_M: number;
  PROFILES: { name: string; s0: number; sInf: number; alpha: number }[];
  career(p: Sim["PROFILES"][number], n: number, seed: number): { margin: number; kind: string; pay: number; dx: number; dy: number; marginAfter: number }[];
  missBeyond(dx: number, dy: number): number;
}

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-01T21:00:00.000Z");
const at = (days: number) => new Date(T0 + days * DAY).toISOString();
const R = { killed: 1, downed: 0.6, wounded: 0.2 } as const;

describe("the safety margin against its simulation", () => {
  it("gives the simulation's margins, kinds and pay, contract by contract, on the same seeds", async () => {
    const sim = (await import(/* @vite-ignore */ SIM)) as Sim;
    for (const p of sim.PROFILES)
      for (let seed = 0; seed < 40; seed++) {
        const ref = sim.career(p, 40, seed);
        // The simulation's own draws, in its order: two normals for the shot, then one uniform for a margin hit's outcome.
        const rng = marginRng(seed * 7919 + 17);
        let state = freshMargin();
        for (const [i, c] of ref.entries()) {
          const dx = rng.gauss();
          const dy = rng.gauss();
          const s = p.sInf + (p.s0 - p.sInf) * (i + 1) ** -p.alpha;
          expect(dx * s).toBe(c.dx);
          expect(dy * s).toBe(c.dy);
          const m = effectiveMargin(state, "vss");
          expect(m).toBeCloseTo(c.margin, 12);
          const shot = { missMrad: sim.missBeyond(c.dx, c.dy), fromChestMrad: Math.hypot(c.dx, c.dy), rangeM: sim.RANGE_M };
          const j = judgeShot(shot, m, rng);
          expect(j.kind, `${p.name} seed ${seed} contract ${i + 1}`).toBe(c.kind);
          const pay = j.kind === "miss" ? 0 : j.kind === "hit" ? 1 : R[j.outcome!] * j.payFactor;
          expect(pay).toBeCloseTo(c.pay, 12);
          state = afterContract(state, "vss", { kind: j.kind, ...shot }, at(i * 2));
          expect(effectiveMargin(state, "vss")).toBeCloseTo(c.marginAfter, 12);
        }
      }
  });
});

describe("judging a shot", () => {
  const rng = () => marginRng(42);

  it("uses none of the margin for a body hit, and calls a shot beyond it a miss", () => {
    const hit = judgeShot({ missMrad: 0, fromChestMrad: 0.3, rangeM: 183 }, 1.5, rng());
    expect(hit).toMatchObject({ kind: "hit", used: 0, payFactor: 1 });
    expect(hit.outcome).toBeUndefined();
    expect(hit.quality).toBeCloseTo(1 - 0.3 / ((0.2 / 183) * 1000 + 1.5), 12);
    expect(judgeShot({ missMrad: 1.51, fromChestMrad: 3, rangeM: 183 }, 1.5, rng())).toMatchObject({ kind: "miss", used: 0, quality: 0 });
    // With the margin gone, any miss is a miss.
    expect(judgeShot({ missMrad: 0.01, fromChestMrad: 1.4, rangeM: 183 }, 0, rng()).kind).toBe("miss");
  });

  it("pays a margin hit less the more of it the shot used, never as much as a clean hit", () => {
    for (const u of [0.01, 0.25, 0.5, 0.99, 1]) {
      const j = judgeShot({ missMrad: u * 1.2, fromChestMrad: 1.5, rangeM: 183 }, 1.2, rng());
      expect(j.kind).toBe("margin");
      expect(j.used).toBeCloseTo(u, 12);
      expect(j.payFactor).toBeCloseTo(1 - MARGIN.k * u, 12);
      expect(j.payFactor).toBeLessThan(1);
    }
  });

  it("draws the outcome weighted by the margin used: killed 1 − 0.6u, downed 0.45u, wounded 0.15u", () => {
    for (const u of [0.2, 0.6, 1]) {
      const r = marginRng(7);
      const n = 200_000;
      const count = { killed: 0, downed: 0, wounded: 0 };
      for (let i = 0; i < n; i++) count[judgeShot({ missMrad: u, fromChestMrad: 2, rangeM: 183 }, 1, r).outcome!]++;
      expect(count.killed / n).toBeCloseTo(1 - 0.6 * u, 2);
      expect(count.downed / n).toBeCloseTo(0.45 * u, 2);
      expect(count.wounded / n).toBeCloseTo(0.15 * u, 2);
    }
  });

  it("takes the largest share used among the contract's margin hits at the spy", () => {
    const s = (at: "spy" | "guest" | "none", kind: "hit" | "margin" | "miss", marginUsed: number) => ({ at, kind, marginUsed });
    expect(contractMarginUsed([s("spy", "margin", 0.3), s("spy", "miss", 0), s("spy", "margin", 0.7), s("guest", "margin", 0.9)])).toBe(0.7);
    expect(contractMarginUsed([s("spy", "hit", 0)])).toBe(0);
  });
});

describe("the margin after a contract", () => {
  const miss = { kind: "miss" as const, fromChestMrad: 4, rangeM: 183 };
  const centre = { kind: "hit" as const, fromChestMrad: 0, rangeM: 183 };

  it("stays as it was with no shot at the spy", () => {
    const s = { ...freshMargin(), career: 0.7 };
    expect(afterContract(s, "svd", null, at(100))).toEqual(s);
  });

  it("shrinks each part by quality and drift, the rifle's part only for the rifle used", () => {
    const s = afterContract(freshMargin(), "svd", centre, at(0));
    expect(s.career).toBeCloseTo(MARGIN.career0 * (1 - MARGIN.f) - MARGIN.drift * MARGIN.career0, 12);
    expect(s.rifle.svd).toBeCloseTo(MARGIN.rifle0 * (1 - MARGIN.f) - MARGIN.drift * MARGIN.rifle0, 12);
    expect(s.rifle.vss).toBe(MARGIN.rifle0);
    expect(s.lastContractAt).toBe(at(0));
    // Quality falls off with distance from the chest centre: a shot at the chest's edge plus the margin has none.
    expect(shotQuality("hit", (0.2 / 183) * 1000 + 1.5, 183, 1.5)).toBe(0);
  });

  it("gives back on the 2nd miss in a row and each further one, never lifting the career part above half its start", () => {
    let s: MarginState = { ...freshMargin(), career: 0.1, rifle: { vss: 0.2, svd: 0.4, bolt: 0.4 } };
    s = afterContract(s, "vss", miss, at(0));
    expect(s.missesInRow).toBe(1);
    expect(s.career).toBeCloseTo(0.1 - 0.022, 12);
    s = afterContract(s, "vss", miss, at(1));
    expect(s.career).toBeCloseTo(0.078 + 0.11 - 0.022, 12);
    s = afterContract(s, "vss", miss, at(2));
    expect(s.career).toBeCloseTo(0.166 + 0.055 - 0.022, 12);
    // The rifle's part never grows from misses: only the drift.
    expect(s.rifle.vss).toBeCloseTo(0.2 - 3 * 0.008, 12);
    for (let i = 3; i < 30; i++) s = afterContract(s, "vss", miss, at(i));
    expect(s.career).toBeLessThanOrEqual(MARGIN.growCap * MARGIN.career0);
    expect(s.career).toBeGreaterThan(MARGIN.growCap * MARGIN.career0 - 0.03);
    // A hit ends the run.
    s = afterContract(s, "vss", centre, at(31));
    expect(s.missesInRow).toBe(0);
    // A career above half its start keeps what it has: misses never take it up, only drift down.
    const high = afterContract(afterContract({ ...freshMargin(), career: 0.9 }, "vss", miss, at(0)), "vss", miss, at(1));
    expect(high.career).toBeCloseTo(0.9 - 2 * 0.022, 12);
  });

  it("gives a little back after a break: 5% of each part's start per full 14 days, at most 15%", () => {
    const gone: MarginState = { career: 0.5, rifle: { vss: 0.2, svd: 0.2, bolt: 0 }, missesInRow: 0, lastContractAt: at(0) };
    // A first miss after the break: only the break and the drift act.
    const after = (days: number) => afterContract(gone, "vss", miss, at(days));
    const give = (days: number) => after(days).career - after(0).career;
    expect(give(13)).toBeCloseTo(0, 12);
    expect(give(14)).toBeCloseTo(0.05 * MARGIN.career0, 12);
    expect(give(28)).toBeCloseTo(0.1 * MARGIN.career0, 12);
    expect(give(60)).toBeCloseTo(0.15 * MARGIN.career0, 12);
    expect(give(365)).toBeCloseTo(0.15 * MARGIN.career0, 12);
    // Every rifle's part comes back, the one used and the others.
    expect(after(60).rifle.svd).toBeCloseTo(0.2 + 0.15 * MARGIN.rifle0, 12);
    expect(after(60).rifle.vss).toBeCloseTo(0.2 + 0.15 * MARGIN.rifle0 - MARGIN.drift * MARGIN.rifle0, 12);
    expect(after(60).rifle.bolt).toBeCloseTo(0.06, 12);
    // A two-month break restores at most 15% of a full margin.
    expect(effectiveMargin(after(60), "svd") - effectiveMargin(gone, "svd")).toBeLessThanOrEqual(0.15 * (MARGIN.career0 + MARGIN.rifle0) + 1e-12);
  });

  it("clamps each part to its start and snaps a part below 0.05 mrad to nothing", () => {
    const s = afterContract({ ...freshMargin(), lastContractAt: at(-100) }, "bolt", miss, at(0));
    expect(s.career).toBeLessThanOrEqual(MARGIN.career0);
    expect(s.rifle.bolt).toBeLessThanOrEqual(MARGIN.rifle0);
    expect(s.rifle.vss).toBe(MARGIN.rifle0);
    const small = afterContract({ ...freshMargin(), career: 0.07, rifle: { vss: 0.06, svd: 0.4, bolt: 0.4 } }, "vss", { kind: "hit", fromChestMrad: 0.5, rangeM: 183 }, at(0));
    expect(small.career).toBe(0);
    expect(small.rifle.vss).toBe(0);
  });

  it("adds the career part and the rifle's", () => {
    const s: MarginState = { career: 0.6, rifle: { vss: 0.1, svd: 0.3, bolt: 0 }, missesInRow: 0, lastContractAt: null };
    expect(effectiveMargin(s, "vss")).toBeCloseTo(0.7, 12);
    expect(effectiveMargin(s, "svd")).toBeCloseTo(0.9, 12);
    expect(effectiveMargin(freshMargin(), "bolt")).toBeCloseTo(1.5, 12);
  });
});

describe("what the player sees of it", () => {
  it("prints a margin hit on the receipt, after the shot, with lines that still add up", () => {
    const l = emptyLoadout("vss");
    l.spotters = [{ tier: "seasoned", place: "beside" }];
    const clean = settleContract({ fee: 6000 }, { factor: 1, label: "killed", doneAt: 3600 }, l);
    const r = settleContract({ fee: 6000 }, { factor: 1, label: "killed", doneAt: 3600, margin: { used: 0.5, wideCm: 14.2 } }, l);
    expect(r.margin!.label).toBe("Counted as a hit: 14 cm wide of him, half the margin used, pay ×0.82");
    expect(r.margin!.amount).toBe(-Math.round((r.gross + r.early!.amount) * MARGIN.k * 0.5));
    expect(r.total).toBe(r.gross + r.early!.amount + r.margin!.amount + [...r.kit, ...r.spotters].reduce((s, x) => s + x.amount, 0));
    expect(r.total).toBeLessThan(clean.total);
    expect(clean.margin).toBeUndefined();
    expect(settleContract({ fee: 6000 }, { factor: 0.6, label: "downed", margin: { used: 1, wideCm: 9, spy: "her" } }, emptyLoadout("svd")).margin!.label).toBe(
      "Counted as a hit: 9 cm wide of her, all the margin used, pay ×0.65",
    );
  });

  it("puts the share used in words", () => {
    expect([0.05, 0.27, 0.35, 0.48, 0.64, 0.76, 0.88, 1].map(usedInWords)).toEqual([
      "a sliver of the margin",
      "a quarter of the margin",
      "a third of the margin",
      "half the margin",
      "two-thirds of the margin",
      "three-quarters of the margin",
      "nearly all the margin",
      "all the margin",
    ]);
  });

  it("hints on the rifle's card in words while it lasts", () => {
    const s = (career: number, vss: number): MarginState => ({ career, rifle: { vss, svd: 0, bolt: 0 }, missesInRow: 0, lastContractAt: null });
    expect(marginHint(freshMargin(), "vss")).toBe("Forgiving");
    expect(marginHint(s(0.8, 0.25), "vss")).toBe("Forgiving");
    expect(marginHint(s(0.6, 0.2), "vss")).toBe("Steadying");
    expect(marginHint(s(0.2, 0.05), "vss")).toBe("Almost on your own");
    expect(marginHint(s(0, 0), "vss")).toBeNull();
  });

  it("is kept in the career, and a fresh one starts at 1.5 mrad", () => {
    const c = new Career();
    expect(effectiveMargin(c.margin, "svd")).toBeCloseTo(1.5, 12);
    c.updateMargin("svd", { kind: "hit", fromChestMrad: 0.2, rangeM: 412 }, at(0));
    expect(effectiveMargin(c.margin, "svd")).toBeLessThan(1.5);
    expect(Career.fromJSON(JSON.parse(JSON.stringify(c))).margin).toEqual(c.margin);
  });
});
