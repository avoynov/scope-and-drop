import { describe, expect, it } from "vitest";
import { SPOTTERS } from "../src/armoury/catalogue";
import { DIR_SIGMA, Spotter, WIND_LOOK_S, flagReading, parseSpotters } from "../src/armoury/spotter";
import { issuedRig } from "../src/armoury/rig";
import { windHoldMil } from "../src/scope/aids";
import { MRAD, THOUSANDTH } from "../src/scope/optics";

const TIERS = ["rookie", "seasoned", "veteran"] as const;
const sd = (xs: number[]) => {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};

describe("the spotter beside you", () => {
  it("reads the wind's clock off the flags in the rifle's frame, the near ones weighted most", () => {
    // Aiming down −Z: a wind blowing toward +X comes from the left, 9 o'clock.
    const r = flagReading(
      [
        [4, 0, 0],
        [4, 0, 0],
        [4, 0, 0],
      ],
      0,
    );
    expect(r.ms).toBeCloseTo(4, 9);
    expect(r.clock).toBeCloseTo(9, 9);
    // Turned 90° left (aiming down −X), the same wind comes head on, and turned right it blows from behind.
    expect(
      flagReading(
        [
          [4, 0, 0],
          [4, 0, 0],
          [4, 0, 0],
        ],
        Math.PI / 2,
      ).clock,
    ).toBeCloseTo(0, 9);
    expect(
      flagReading(
        [
          [4, 0, 0],
          [4, 0, 0],
          [4, 0, 0],
        ],
        -Math.PI / 2,
      ).clock,
    ).toBeCloseTo(6, 9);
    // Near 3, middle 2, far 1.
    expect(
      flagReading(
        [
          [6, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        0,
      ).ms,
    ).toBeCloseTo(3, 9);
  });

  it("speaks after a delay uniform in the tier's range", () => {
    for (const tier of TIERS) {
      const s = new Spotter(tier, 1);
      const [a, b] = SPOTTERS[tier].delayS;
      const ds = Array.from({ length: 2000 }, () => s.delay());
      expect(Math.min(...ds)).toBeGreaterThanOrEqual(a);
      expect(Math.max(...ds)).toBeLessThan(b);
      expect(ds.reduce((x, y) => x + y, 0) / ds.length).toBeCloseTo((a + b) / 2, 1);
    }
  });

  it("misreads the wind by tier: speed σ 0.4 / 0.25 / 0.15 multiplicative, direction σ 0.5 / 0.25 / 0 clock hours", () => {
    for (const tier of TIERS) {
      const s = new Spotter(tier, 2);
      const reads = Array.from({ length: 4000 }, () => s.misread({ ms: 5, clock: 3 }));
      expect(sd(reads.map((r) => r.ms / 5 - 1))).toBeCloseTo(SPOTTERS[tier].windError, 1);
      expect(sd(reads.map((r) => r.clock))).toBeCloseTo(DIR_SIGMA[tier], 1);
    }
  });

  it("notices about 60%, 80% and 95% of the impacts, and only calls what it saw", () => {
    for (const tier of TIERS) {
      const s = new Spotter(tier, 3);
      let seen = 0;
      for (let i = 0; i < 3000; i++) if (s.shotCall(i, { hit: true, miss: null, rangeM: 183 }, MRAD)) seen++;
      expect(seen / 3000).toBeCloseTo(SPOTTERS[tier].notices, 1);
    }
  });

  it("calls a miss elevation first, then windage, in the reticle's unit to a quarter", () => {
    const s = new Spotter("veteran", 4);
    const calls: string[] = [];
    for (let i = 0; calls.length < 3 && i < 50; i++) {
      const c = s.shotCall(0, { hit: false, miss: [0.1, -0.28], rangeM: 183 }, MRAD);
      if (c) calls.push(c.text);
    }
    // 28 cm low at 183 m is 1.53 mil; 10 cm right is 0.55.
    expect(calls[0]).toBe("Low one point five, right point five");
    const hit = Array.from({ length: 20 }, () => s.shotCall(0, { hit: true, miss: [0.1, 0], rangeM: 183 }, MRAD)).find(Boolean)!;
    expect(hit.text).toBe("Hit");
    expect(hit.kind).toBe("shot");
  });

  it("calls the range only as a veteran, and exactly", () => {
    expect(new Spotter("rookie", 5).rangeCall(0, 183)).toBeNull();
    expect(new Spotter("seasoned", 5).rangeCall(0, 183)).toBeNull();
    expect(new Spotter("veteran", 5).rangeCall(0, 183.4)!.text).toBe("Range one eight three");
  });

  it("calls the wind when the flags change the hold by a quarter, not on every look", () => {
    const rf = issuedRig("vss").rifle;
    const s = new Spotter("veteran", 6);
    const read = { ms: 3, clock: 9 };
    const first = s.windCall(0, rf, 183, read, THOUSANDTH)!;
    expect(first.kind).toBe("wind");
    expect(first.text).toMatch(/^Wind left, hold .* left$/);
    expect(s.windCall(1, rf, 183, read, THOUSANDTH)).toBeNull();
    expect(s.windCall(WIND_LOOK_S, rf, 183, read, THOUSANDTH)).toBeNull();
    expect(s.windCall(2 * WIND_LOOK_S, rf, 183, { ms: 6, clock: 9 }, THOUSANDTH)).not.toBeNull();
  });

  it("holds for its reading exactly as the solver does, in the reticle's unit", () => {
    const rf = issuedRig("svd").rifle;
    expect(Spotter.windHold(rf, 412, { ms: 4, clock: 3 }, MRAD)).toBeCloseTo(windHoldMil(rf, 412, 4, 3), 12);
    expect(Spotter.windHold(rf, 412, { ms: 4, clock: 3 }, THOUSANDTH)).toBeCloseTo((windHoldMil(rf, 412, 4, 3) * MRAD) / THOUSANDTH, 12);
  });

  it("is repeatable: the same seed gives the same calls", () => {
    const run = () => {
      const s = new Spotter("rookie", 7);
      return Array.from({ length: 30 }, (_, i) => s.shotCall(i, { hit: false, miss: [0.2, 0.1], rangeM: 300 }, MRAD)?.at ?? null);
    };
    expect(run()).toEqual(run());
  });

  it("reads spot= as at most two known tiers", () => {
    expect(parseSpotters("veteran")).toEqual(["veteran"]);
    expect(parseSpotters("rookie, Seasoned,veteran")).toEqual(["rookie", "seasoned"]);
    expect(parseSpotters("captain")).toEqual([]);
    expect(parseSpotters(null)).toEqual([]);
  });
});
