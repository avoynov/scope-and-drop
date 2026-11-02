import { describe, expect, it } from "vitest";
import { TORSO_TOP, inBody, inTorso, torsoAt, type Vec3 } from "../src/body/anatomy";
import { CHEST, RING, angleMrad, closestApproach, densify, redirectEntries } from "../src/scope/hit-test";

/** A straight path along −z (toward the person's back) through (x, y), from 3 m in front to 3 m behind. */
const line = (x: number, y: number): Vec3[] =>
  densify([
    [x, y, 3],
    [x, y, -3],
  ]);

describe("the torso the margin measures to", () => {
  it("is the torso from the hips to the base of the neck: not the head, neck or thighs", () => {
    expect(inTorso([0, 1.24, 0])).toBe(true);
    expect(inTorso([0, 0.9, 0])).toBe(true);
    expect(inTorso([0, 1.5, 0])).toBe(false);
    expect(inBody([0, 1.5, 0])).toBe(true);
    expect(inTorso([0, 1.6, 0])).toBe(false);
    expect(inTorso([0.09, 0.7, 0])).toBe(false);
    expect(inBody([0.09, 0.7, 0])).toBe(true);
    // Its outline at the chest is the mannequin's lathe profile.
    const [r] = torsoAt(1.24);
    expect(inTorso([r - 0.001, 1.24, 0])).toBe(true);
    expect(inTorso([r + 0.001, 1.24, 0])).toBe(false);
  });
});

describe("the closest approach", () => {
  it("is the perpendicular distance from the path to the torso's outline, by bisection on a ring of 16 points", () => {
    expect(RING).toBe(16);
    const [r] = torsoAt(1.24);
    for (const x of [0.25, 0.3, 0.5, 1]) {
      const a = closestApproach(line(x, 1.24))!;
      // The true distance in the plane across the path (the torso widens just above the chest), to the ring's
      // resolution: 16 points are 22.5° apart, so the ring overshoots by up to a few per cent, never falls short.
      let truth = Infinity;
      for (let y = 0.86; y <= TORSO_TOP; y += 0.0005) truth = Math.min(truth, Math.hypot(Math.max(0, x - torsoAt(y)[0]), y - 1.24));
      expect(a.missM).toBeGreaterThanOrEqual(truth - 1e-3);
      expect(a.missM).toBeLessThan(truth * 1.05 + 0.003);
      expect(a.missM).toBeLessThanOrEqual(x - r + 1e-3);
      expect(inTorso(a.touch)).toBe(true);
    }
    // Over the shoulders, the outline's top is the base of the neck.
    const over = closestApproach(line(0, 1.6))!;
    expect(over.missM).toBeCloseTo(1.6 - TORSO_TOP, 2);
  });

  it("is zero through the torso and nothing beyond its reach", () => {
    expect(closestApproach(line(0.05, 1.2))!.missM).toBe(0);
    expect(closestApproach(line(3, 1.2), 2)).toBeNull();
  });

  it("grows as the path moves away, and follows a slanting path", () => {
    let prev = -1;
    for (let x = 0.2; x < 0.8; x += 0.05) {
      const m = closestApproach(line(x, 1.1))!.missM;
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
    // From a tower, 50° down, passing 30 cm to the side of the chest: the miss is still across the path.
    const a = (50 * Math.PI) / 180;
    const steep = densify([
      [0.3 + 0, 1.2 + 3 * Math.sin(a), 3 * Math.cos(a)],
      [0.3, 1.2 - 3 * Math.sin(a), -3 * Math.cos(a)],
    ]);
    const s = closestApproach(steep)!;
    expect(s.missM).toBeGreaterThan(0.1);
    expect(s.missM).toBeLessThan(0.3 - torsoAt(1.2)[0] + 0.01);
  });
});

describe("the redirect", () => {
  it("enters the torso at its surface, along the path, from the touched point inward", () => {
    const a = closestApproach(line(0.3, 1.2))!;
    const entries = redirectEntries(a);
    expect(entries.length).toBeGreaterThan(2);
    for (const e of entries) {
      expect(inTorso(e)).toBe(false);
      // A millimetre on along the path it is inside.
      expect(inTorso([e[0] + a.dir[0] * 0.002, e[1] + a.dir[1] * 0.002, e[2] + a.dir[2] * 0.002])).toBe(true);
      // On the near side of the body, at the height it passed.
      expect(e[2]).toBeGreaterThan(0);
      expect(Math.abs(e[1] - 1.2)).toBeLessThan(0.02);
    }
    // Further in, each entry sits nearer the middle.
    expect(Math.abs(entries.at(-1)![0])).toBeLessThan(Math.abs(entries[0]![0]));
  });
});

describe("angles from the muzzle", () => {
  it("measures the impact from the chest centre as an angle at the muzzle", () => {
    const muzzle: Vec3 = [0, 1.15, 183];
    expect(angleMrad(muzzle, [0.183, 1.15, 0], CHEST)).toBeCloseTo(1, 2);
    expect(angleMrad(muzzle, CHEST, CHEST)).toBeCloseTo(0, 6);
  });
});
