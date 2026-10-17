import { describe, expect, it } from "vitest";
import { CHEST_M, EYE_HEIGHT, NEAR_TARGET, TARGET, configureTargets, heightAt, targetRanges } from "../demo/reticle/scene";

/** Slant range and elevation from the eye to a mannequin's chest, as the lab sets them. */
const spot = (v: { x: number; z: number }) => {
  const eye = heightAt(0, 0) + EYE_HEIGHT;
  const dy = heightAt(v.x, v.z) + CHEST_M - eye;
  const horiz = Math.hypot(v.x, v.z);
  return { rangeM: Math.hypot(horiz, dy), elevDeg: (Math.atan2(dy, horiz) * 180) / Math.PI };
};

/** Nothing on the way: the line of sight to each chest clears the ground. */
const clear = () => {
  for (const v of [TARGET, NEAR_TARGET]) {
    const eye = heightAt(0, 0) + EYE_HEIGHT;
    const chest = heightAt(v.x, v.z) + CHEST_M;
    for (let f = 0.02; f < 0.97; f += 0.01) expect(eye + (chest - eye) * f).toBeGreaterThan(heightAt(v.x * f, v.z * f));
  }
};

describe("target range and elevation", () => {
  it("raises a hill under a target set uphill, and the hide for one set downhill, to put each chest where asked", () => {
    configureTargets([
      { rangeM: 600, elevDeg: 20 },
      { rangeM: 250, elevDeg: -12 },
    ]);
    const far = spot(TARGET);
    const near = spot(NEAR_TARGET);
    expect(far.rangeM).toBeCloseTo(600, 0);
    expect(far.elevDeg).toBeCloseTo(20, 1);
    expect(near.rangeM).toBeCloseTo(250, 0);
    expect(near.elevDeg).toBeCloseTo(-12, 1);
    expect(targetRanges).toEqual([600, 250]);
    clear();
  });

  it("holds at the ends of the inputs' range", () => {
    // One mannequin at each end, or both steep the same way. (Opposite steep slopes can put one's hill in the way of the other.)
    const cases: [number, number][][] = [
      [
        [1500, 30],
        [50, -30],
      ],
      [
        [1000, -30],
        [183, -30],
      ],
      [
        [50, 30],
        [1500, 30],
      ],
    ];
    for (const [far, near] of cases) {
      configureTargets([
        { rangeM: far![0], elevDeg: far![1] },
        { rangeM: near![0], elevDeg: near![1] },
      ]);
      expect(spot(TARGET).elevDeg).toBeCloseTo(far![1], 1);
      expect(spot(TARGET).rangeM).toBeCloseTo(far![0], 0);
      expect(spot(NEAR_TARGET).elevDeg).toBeCloseTo(near![1], 1);
      clear();
    }
  });
});
