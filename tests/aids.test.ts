import { describe, expect, it } from "vitest";
import { solveElevationMil, speedDrop } from "../src/scope/aids";
import { ROUNDS, holdRad } from "../src/scope/ballistics";
import { BATTLE_ZERO_M, RIFLES } from "../src/scope/shot";

const rf = RIFLES.bolt;
const r = ROUNDS[rf.round];
const elev = (m: number) => holdRad(r, m, BATTLE_ZERO_M, rf.sightM) * 1000;

describe("speed drop", () => {
  it("gives the M118LR, zeroed at 100 m and ranged in metres, a factor of 1.3, true to 0.2 mil from 120 to 475 m", () => {
    const sd = speedDrop(rf);
    expect(sd.factor).toBe(1.3);
    expect(sd.minM).toBe(120);
    expect(sd.maxM).toBe(475);
    for (let m = sd.minM; m <= sd.maxM; m += 5) expect(Math.abs(m / 100 - sd.factor - elev(m))).toBeLessThanOrEqual(0.2 + 1e-9);
    // Just past the band the sum reads high, and by 700 m it is more than a mil out: the far rows take over.
    expect(7 - sd.factor - elev(700)).toBeLessThan(-1);
  });

  it("narrows the band when the shooter allows less error", () => {
    const tight = speedDrop(rf, 0.1);
    const loose = speedDrop(rf, 0.2);
    expect(tight.maxM - tight.minM).toBeLessThan(loose.maxM - loose.minM);
  });
});

describe("rangefinder solver", () => {
  it("matches the come-ups on level ground", () => {
    for (const m of [200, 412, 600, 800]) expect(solveElevationMil(rf, m, 0)).toBeCloseTo(elev(m), 1);
  });

  it("holds less up or down a slope, and less again than the card's cosine rule", () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    for (const d of [-30, -15, 15, 30]) {
      const lrf = solveElevationMil(rf, 800, deg(d));
      expect(lrf).toBeLessThan(elev(800));
      // The card's rule (elevation for the slant range × cosine) runs a touch high: the solver is the exact hold.
      const card = elev(800) * Math.cos(deg(d));
      expect(card - lrf).toBeGreaterThan(-0.05);
      expect(card - lrf).toBeLessThan(0.3);
    }
  });
});
