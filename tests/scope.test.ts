import { describe, expect, it } from 'vitest';
import { SCOPE, THOUSANDTH, circleOverlap, exitPupilMm, eyeboxTransmission, parallaxShiftRad, stadiaRangeM, trueFovRad } from '../src/scope/optics';
import { psoCurveHeight, psoReticle, treeReticle } from '../src/scope/reticles';

const eye = (x = 0, y = 0, z = 0) => ({ x, y, z, pupilMm: 3 });

describe('optics', () => {
  it('matches the PSO-1 field at 4× and shrinks with power', () => {
    expect((trueFovRad(SCOPE, 4) * 180) / Math.PI).toBeCloseTo(6.06, 1);
    expect(trueFovRad(SCOPE, 20)).toBeLessThan(trueFovRad(SCOPE, 4) / 4.9);
    expect(exitPupilMm(SCOPE, 20)).toBeCloseTo(2.5);
  });

  it('computes circle overlap at the limits', () => {
    expect(circleOverlap(2, 1, 0)).toBeCloseTo(Math.PI);
    expect(circleOverlap(1, 1, 2)).toBe(0);
    const half = circleOverlap(1, 1, 1);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(Math.PI);
  });

  it('is fully bright with the eye on the exit pupil and goes dark off it', () => {
    expect(eyeboxTransmission(SCOPE, 4, eye(), 0.2, 0)).toBeCloseTo(1);
    expect(eyeboxTransmission(SCOPE, 20, eye(4, 0, 0), 0, 0)).toBe(0);
  });

  it('casts the crescent on the side away from the head when the eye is too far back', () => {
    const e = eye(1.5, 0, 15);
    const right = eyeboxTransmission(SCOPE, 16, e, 0.18, 0);
    const left = eyeboxTransmission(SCOPE, 16, e, -0.18, 0);
    expect(right).toBeGreaterThan(left);
    // Too close: the visible disc moves the other way.
    const close = eye(1.5, 0, -15);
    expect(eyeboxTransmission(SCOPE, 16, close, -0.18, 0)).toBeGreaterThan(eyeboxTransmission(SCOPE, 16, close, 0.18, 0));
  });

  it('has no parallax when focused at the target range, and some when not', () => {
    expect(parallaxShiftRad(SCOPE, 12, 1, 400, 400)).toBeCloseTo(0, 12);
    const err = parallaxShiftRad(SCOPE, 12, 1, 400, 100);
    expect(Math.abs(err)).toBeGreaterThan(5e-5); // > 0.05 mil: visible at 12×
    expect(Math.abs(err)).toBeLessThan(5e-4);
    expect(parallaxShiftRad(SCOPE, 12, 1, 400, Infinity)).toBeCloseTo(0.012 / 400, 9);
  });
});

describe('reticles', () => {
  it('PSO rangefinder curve brackets a 1.7 m man at its marked ranges', () => {
    for (const n of [2, 4, 6, 8, 10]) {
      expect(stadiaRangeM(1.7, psoCurveHeight(n) * THOUSANDTH)).toBeCloseTo(n * 100, 6);
    }
  });

  it('builds both patterns with a lit aiming point', () => {
    for (const r of [psoReticle(), treeReticle()]) {
      expect(r.prims.length).toBeGreaterThan(30);
      expect(r.prims.some((p) => p.lit)).toBe(true);
    }
    // Tree rows widen with drop, like the reference glass.
    const rowWidth = (y: number) => Math.max(...treeReticle().prims.filter((p) => p.kind === 'dot' && p.y === y).map((p) => (p.kind === 'dot' ? Math.abs(p.x) : 0)));
    expect(rowWidth(10)).toBeGreaterThan(rowWidth(2));
  });
});
