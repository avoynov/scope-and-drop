import { describe, expect, it } from "vitest";
import { Career, earlyBoost, settleContract } from "../src/armoury/career";
import { EARLY_BEND, EARLY_MAX, ISSUED, ITEMS, ITEM_IDS, MARKUP, RETAINER, SLOTS, SPOTTERS, START_BALANCE, fits, type ItemId } from "../src/armoury/catalogue";
import { carried, checkLoadout, decodeKit, emptyLoadout, encodeKit, kitFactor, payFactor, type Loadout } from "../src/armoury/loadout";
import { issuedRig, rigFor } from "../src/armoury/rig";
import { ROUNDS } from "../src/scope/ballistics";
import { ACTIONS } from "../src/scope/handling";
import { HOLD, LAB_REST } from "../src/scope/hold";
import { RECOIL, recoilImpulse, scaleRecoil } from "../src/scope/recoil";
import { RIFLES, type RifleId } from "../src/scope/shot";

const RIFLE_IDS: RifleId[] = ["vss", "svd", "bolt"];
const loadout = (rifle: RifleId, ids: ItemId[], spotters: Loadout["spotters"] = []): Loadout => {
  const l = emptyLoadout(rifle);
  for (const id of ids) l.items[ITEMS[id].slot] = id;
  l.spotters = spotters;
  return l;
};

describe("the catalogue", () => {
  it("prices every item at its street price × 4, in a known slot, with a decay for each rifle it fits", () => {
    for (const id of ITEM_IDS) {
      const it = ITEMS[id];
      expect(it.id).toBe(id);
      expect(SLOTS).toContain(it.slot);
      expect(it.price).toBe(it.streetUsd * MARKUP);
      const decays = RIFLE_IDS.map((r) => it.decay[r]).filter((d): d is number => d !== null);
      expect(decays.length, id).toBeGreaterThan(0);
      for (const d of decays) expect(d > 0 && d < 0.25, id).toBe(true);
      expect(it.does.length && it.costs.length).toBeTruthy();
    }
  });

  it("keeps the plan's prices: the EBR-7D at €6,000, the TReMoR3 at €14,000, the Sig at about €6,000", () => {
    expect(ITEMS.ebr.price).toBe(6000);
    expect(ITEMS.tremor.price).toBe(14000);
    expect(ITEMS.kilo.price).toBeCloseTo(6000, -1);
    expect(ITEMS.harris.price).toBe(600);
  });

  it("puts no suppressor on the VSS, and subsonic rounds only where they are real", () => {
    expect(fits("can", "vss")).toBe(false);
    expect(fits("sub200", "bolt")).toBe(true);
    expect(fits("sub200", "svd")).toBe(false);
    for (const id of ITEM_IDS) {
      const round = ITEMS[id].effects.round;
      if (round) for (const r of RIFLE_IDS) if (fits(id, r)) expect(ROUNDS[round].cartridge).toBe(ROUNDS[ISSUED[r].round].cartridge);
    }
  });
});

describe("loadouts and the pay factor", () => {
  it("works the plan's example: VSS, Atlas and bag 0.88; with the Sig 0.72; with a veteran spotter 0.47", () => {
    const a = loadout("vss", ["atlas", "bag"]);
    expect(payFactor(a)).toBeCloseTo(0.93 * 0.95, 9);
    const b = loadout("vss", ["atlas", "bag", "kilo"]);
    expect(payFactor(b)).toBeCloseTo(0.93 * 0.95 * 0.82, 9);
    const c = loadout("vss", ["atlas", "bag", "kilo"], [{ tier: "veteran", place: "beside" }]);
    expect(payFactor(c)).toBeCloseTo(0.93 * 0.95 * 0.82 * 0.65, 9);
    expect(payFactor(emptyLoadout("vss"))).toBe(1);
  });

  it("halves the decay of kit the dossier calls for", () => {
    const l = loadout("bolt", ["hide"]);
    expect(kitFactor(l, new Set<ItemId>(["hide"]))).toBeCloseTo(1 - 0.015, 9);
  });

  it("refuses what can't be carried: wrong rifle, wrong slot, not owned, a sleeve with no can, three spotters", () => {
    expect(checkLoadout(loadout("bolt", ["can", "sleeve", "kilo"]))).toEqual([]);
    expect(checkLoadout(loadout("vss", ["can"])).map((p) => p.item)).toContain("can");
    expect(checkLoadout({ ...emptyLoadout("svd"), items: { rear: "harris" } }).length).toBeGreaterThan(0);
    expect(checkLoadout(loadout("bolt", ["sleeve"])).some((p) => /needs/.test(p.why))).toBe(true);
    expect(checkLoadout(loadout("bolt", ["kilo"]), new Set()).some((p) => /owned/.test(p.why))).toBe(true);
    const spot = { tier: "rookie" as const, place: "beside" as const };
    expect(checkLoadout(loadout("bolt", [], [spot, spot, spot])).length).toBe(1);
  });

  it("reads a kit from the URL forgivingly, for whichever rifle is up", () => {
    const vss = decodeKit("vss", "atlas, BAG,can,nonsense,harris,acss");
    expect(carried(vss).sort()).toEqual(["acss", "atlas", "bag"]);
    expect(decodeKit("bolt", "sleeve").items).toEqual({});
    expect(encodeKit(decodeKit("bolt", "can,sleeve,kilo"))).toBe("can,sleeve,kilo");
    expect(decodeKit("svd", null).items).toEqual({});
  });
});

describe("the career", () => {
  it("starts with a grand contract's fee in hand, buys for good, and refuses what it can't afford or owns", () => {
    const c = new Career();
    expect(c.balance).toBe(START_BALANCE);
    c.buy("atlas");
    expect(c.balance).toBe(START_BALANCE - 1400);
    expect(c.canBuy("atlas").ok).toBe(false);
    expect(c.canBuy("tremor").why).toMatch(/short/);
    expect(() => c.buy("tremor")).toThrow();
  });

  it("settles a contract into lines that add up, the decay shared out fairly between the items", () => {
    const l = loadout("vss", ["atlas", "bag", "kilo"], [{ tier: "veteran", place: "beside" }]);
    const r = settleContract({ fee: 6000 }, { factor: 1, label: "killed" }, l, new Set<ItemId>(["atlas", "bag"]));
    const sum = r.gross + [...r.kit, ...r.spotters].reduce((s, x) => s + x.amount, 0);
    expect(r.total).toBe(sum);
    expect(r.total).toBeCloseTo(6000 * payFactor(l), -1);
    // The Sig decays most, so it costs most.
    const sig = r.kit.find((x) => /KILO/.test(x.label))!;
    expect(Math.abs(sig.amount)).toBeGreaterThan(Math.abs(r.kit[0]!.amount));
    expect(r.unused.map((x) => x.label)).toEqual(["Sig KILO8K-ABS: carried, never used"]);
  });

  it("pays nothing for a failed contract and still owes the spotters their retainer", () => {
    const l = loadout("svd", [], [{ tier: "rookie", place: "beside" }, { tier: "veteran", place: "bearing", azDeg: -20 }]);
    const r = settleContract({ fee: 8000 }, { factor: 0, label: "failed" }, l);
    expect(r.total).toBe(-2 * RETAINER);
  });

  it("boosts the pay the earlier before the evening's end the job is done, and never takes anything off", () => {
    const end = 3 * 3600;
    expect(earlyBoost(undefined)).toBe(0);
    expect(earlyBoost(end)).toBe(0);
    expect(earlyBoost(end + 600)).toBe(0);
    expect(earlyBoost(0)).toBe(EARLY_MAX);
    expect(earlyBoost(-600)).toBe(EARLY_MAX);
    // Rises the earlier the job is done, and ever faster (a softened 1/x): each step earlier adds more than the last.
    let last = -1;
    let lastStep = 0;
    for (let t = end; t >= 0; t -= 300) {
      const b = earlyBoost(t);
      expect(b).toBeGreaterThan(last);
      if (last >= 0) {
        expect(b - last).toBeGreaterThan(lastStep);
        lastStep = b - last;
      }
      last = b;
    }
    // Below the straight line, but not by much: halfway it pays more than a third of the straight line's boost.
    expect(earlyBoost(end / 2)).toBeLessThan(EARLY_MAX / 2);
    expect(earlyBoost(end / 2)).toBeGreaterThan(EARLY_MAX / 2 / 3);
    const l = loadout("vss", ["atlas", "bag"], [{ tier: "veteran", place: "beside" }]);
    const plain = settleContract({ fee: 6000 }, { factor: 1, label: "killed" }, l);
    const late = settleContract({ fee: 6000 }, { factor: 1, label: "killed", doneAt: end }, l);
    const early = settleContract({ fee: 6000 }, { factor: 1, label: "killed", doneAt: end / 2 }, l);
    expect(late.total).toBe(plain.total);
    expect(late.early).toBeUndefined();
    const half = (EARLY_MAX * 0.5) / (1 + EARLY_BEND * 0.5);
    expect(early.early!.amount).toBe(Math.round(6000 * half));
    expect(early.early!.label).toBe(`Done 1 h 30 min before the evening's end: +${Math.round(half * 100)}%`);
    expect(early.total).toBe(early.gross + early.early!.amount + [...early.kit, ...early.spotters].reduce((s, x) => s + x.amount, 0));
    expect(early.total).toBeCloseTo(6000 * (1 + half) * payFactor(l), -1);
    // A failure stays a failure, however early.
    expect(settleContract({ fee: 6000 }, { factor: 0, label: "failed", doneAt: 0 }, l).total).toBe(-RETAINER);
  });

  it("books the pay, and only for a loadout it owns", () => {
    const c = new Career({ balance: 2000 });
    expect(() => c.settle({ fee: 6000 }, { factor: 1, label: "killed" }, loadout("bolt", ["kilo"]))).toThrow(/owned/);
    const r = c.settle({ fee: 6000 }, { factor: 1, label: "killed" }, emptyLoadout("bolt"));
    expect(r.total).toBe(6000);
    expect(c.balance).toBe(8000);
    expect(c.history[0]).toBe(r);
  });

  it("round-trips through JSON and drops whatever doesn't belong", () => {
    const c = new Career({ balance: 12345 });
    c.buy("bag");
    expect(Career.fromJSON(JSON.parse(JSON.stringify(c))).toJSON()).toEqual(c.toJSON());
    const bad = Career.fromJSON({ v: 1, balance: "lots", owned: ["bag", "laser-sword", 7], history: "x" });
    expect(bad.balance).toBe(START_BALANCE);
    expect([...bad.owned]).toEqual(["bag"]);
    expect(bad.history).toEqual([]);
    expect(Career.fromJSON(null).balance).toBe(START_BALANCE);
  });

  it("knows its spotters", () => {
    expect(Object.values(SPOTTERS).map((s) => s.share)).toEqual([0.15, 0.25, 0.35]);
  });
});

describe("the rig", () => {
  it("leaves the issued rifle exactly as the lab has it", () => {
    for (const id of RIFLE_IDS) {
      const r = issuedRig(id);
      expect(r.rifle).toEqual(RIFLES[id]);
      expect(r.recoil.rise).toBeCloseTo(RECOIL[id].rise, 12);
      expect(r.recoil.travelMm).toBeCloseTo(RECOIL[id].travelMm, 12);
      expect(r.mag).toBe(ACTIONS[id].mag);
      expect(r.restKind).toBe("pack");
      expect(r.optic).toBe(ISSUED[id].optic);
    }
  });

  it("gives the lab its own rest: the bipod hold it always had, following the hands exactly", () => {
    const r = rigFor(emptyLoadout("svd"), { lab: true });
    expect(r.hold).toEqual(HOLD.harris);
    expect(r.rest).toEqual(LAB_REST);
  });

  it("scales recoil from momentum: a can softens the SVD's kick, a muzzle weight cuts its free recoil about 8%", () => {
    expect(scaleRecoil("svd", { round: "7n1", gas: 1, addedKg: 0, muzzleKg: 0 })).toEqual({ ...RECOIL.svd, impulseNs: recoilImpulse("7n1", 1), rifleKg: RECOIL.svd.rifleKg });
    const can = rigFor(loadout("svd", ["can"])).recoil;
    expect(can.travelMm / RECOIL.svd.travelMm).toBeLessThan(0.8);
    expect(can.rise / RECOIL.svd.rise).toBeLessThan(can.travelMm / RECOIL.svd.travelMm);
    const w = rigFor(loadout("svd", ["weight"])).recoil;
    const energy = (s: { impulseNs: number; rifleKg: number }) => (s.impulseNs * s.impulseNs) / (2 * s.rifleKg);
    expect(1 - energy(w) / energy({ impulseNs: recoilImpulse("7n1", 1), rifleKg: RECOIL.svd.rifleKg })).toBeCloseTo(0.085, 2);
  });

  it("makes the Sako's subsonic package quiet, slow and soft", () => {
    const r = rigFor(loadout("bolt", ["can", "sub200"]));
    expect(r.subsonic).toBe(true);
    expect(r.report).toBe("can-sub");
    expect(r.rifle.twistMm).toBeCloseTo(228.6, 6);
    expect(r.recoil.travelMm / RECOIL.bolt.travelMm).toBeLessThan(0.45);
    expect(r.rifle.blastDust).toBeLessThan(0.05);
  });

  it("loads the VSS's 20-round magazine, which sits the rifle a little higher", () => {
    const r = rigFor(loadout("vss", ["mag20"]));
    expect(r.rifle.magazine).toBe(20);
    expect(r.mag.rounds).toBe(20);
    expect(r.hold.breath[0]).toBeCloseTo(HOLD.pack.breath[0] * 1.1, 9);
  });

  it("halves the vertical breathing on a squeeze bag and steadies the heartbeat with mass out front", () => {
    const r = rigFor(loadout("bolt", ["harris", "bag", "weight"]));
    expect(r.hold.breath[1]).toBeCloseTo(0.5, 9);
    expect(r.hold.pulse).toBeCloseTo(0.85 / (1 + 1.07 * 0.4), 9);
    expect(r.rest.bag).not.toBeNull();
    expect(r.rest.muzzleKg).toBe(0.4);
  });
});
