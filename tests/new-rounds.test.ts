import { describe, expect, it } from "vitest";
import { TERMINAL, woundTrack } from "../src/body/wound";
import { GLAZING, throughGlass } from "../src/scope/glass";
import type { RoundId } from "../src/scope/ballistics";

/** A chest shot straight in, averaged over a few people and bullets. */
const chest = (round: RoundId, speed: number, n = 8) => {
  let perm = 0;
  let early = 0;
  let energy = 0;
  for (let seed = 0; seed < n; seed++) {
    const w = woundTrack({ entry: [0.03, 1.3, 0.13], dir: [0, 0, -1], speed, round, seed });
    perm += Math.max(...w.track.map((x) => x.perm)) / n;
    // The crushed channel's width over the first 6 cm.
    const first = w.track.filter((x) => Math.abs(x.p[2] - 0.13) < 0.06);
    early += Math.max(...first.map((x) => x.perm)) / n;
    energy += w.energyJ / n;
  }
  return { perm, early, energy };
};

describe("expanding loads in tissue", () => {
  it("open early: the soft point and the bonded round crush a wider channel in the first centimetres than full metal jacket", () => {
    const fmj = chest("7n14", 750);
    const sp = chest("sb180sp", 750);
    const bonded = chest("tbt168", 750);
    expect(sp.early).toBeGreaterThan(2.5 * fmj.early);
    expect(bonded.early).toBeGreaterThan(1.3 * fmj.early);
    // The soft point sheds a quarter of itself; the bonded round holds together, so its channel stays narrower.
    expect(sp.perm).toBeGreaterThan(bonded.perm);
    // Both give up more of their energy in the body than the jacketed round that only yaws late.
    expect(sp.energy).toBeGreaterThan(fmj.energy);
    expect(bonded.energy).toBeGreaterThan(fmj.energy);
  });

  it("stay nose-first once open: no channel as wide as the bullet is long", () => {
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const w = woundTrack({ entry: [0.03, 1.3, 0.13], dir: [0, 0, -1], speed: 780, round: "tbt168", seed });
      expect(Math.max(...w.track.map((x) => x.perm)) * 2).toBeLessThan(TERMINAL.tbt168.lenM);
    }
  });

  it("do not open when they strike too slowly, and behave as plain bullets", () => {
    const slow = chest("sb180sp", 0.55 * TERMINAL.sb180sp.expand!.minV);
    const early = slow.early * 2;
    expect(early).toBeLessThan(TERMINAL.sb180sp.diaM + 0.006);
  });

  it("do not open after glass has stripped the jacket", () => {
    const stripped = woundTrack({ entry: [0.03, 1.3, 0.13], dir: [0, 0, -1], speed: 700, round: "sb180sp", seed: 1, massKg: 0.7 * TERMINAL.sb180sp.massKg });
    const open = woundTrack({ entry: [0.03, 1.3, 0.13], dir: [0, 0, -1], speed: 700, round: "sb180sp", seed: 1 });
    const firstPerm = (w: typeof open) => Math.max(...w.track.slice(0, 3).map((x) => x.perm));
    expect(firstPerm(open)).toBeGreaterThan(1.5 * firstPerm(stripped));
  });
});

describe("the new loads through glass", () => {
  const through = (round: RoundId, v: number, seed: number) =>
    throughGlass({ round, pos: [0, 0, 0], vel: [0, 0, -v], normal: [0, 0, 1], glazing: GLAZING.laminated, twistM: 0.254, sg: 1.9, seed });

  it("strips the soft point's thin jacket, keeps the bonded round's, and lets the steel cores through", () => {
    const strips = (round: RoundId) => {
      let n = 0;
      for (let s = 0; s < 40; s++) if (through(round, 750, s).stripped) n++;
      return n / 40;
    };
    expect(strips("sb180sp")).toBeGreaterThan(strips("7n14"));
    expect(strips("tbt168")).toBe(0);
    for (let s = 0; s < 10; s++) expect(through("7n14", 780, s).outcome).toBe("through");
  });

  it("slows the subsonic loads but lets them through ordinary glass", () => {
    for (const round of ["sp6", "sub200"] as const) {
      const t = throughGlass({ round, pos: [0, 0, 0], vel: [0, 0, -290], normal: [0, 0, 1], glazing: GLAZING.single, twistM: 0.2286, sg: 1.5, seed: 3 });
      expect(t.outcome).toBe("through");
      expect(t.speed).toBeLessThan(290);
    }
  });
});
