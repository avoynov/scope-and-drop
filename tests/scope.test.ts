import { describe, expect, it } from 'vitest';
import { SCOPE, THOUSANDTH, circleOverlap, exitPupilMm, eyeboxTransmission, parallaxShiftRad, stadiaRangeM, trueFovRad } from '../src/scope/optics';
import { ROUNDS, at, handHoldRad, holdRad, type Round } from '../src/scope/ballistics';
import { RECOIL, recoilAt, shotVariation } from '../src/scope/recoil';
import { PSO_CHEVRON_RANGES, psoChevronY, psoCurveHeight, psoReticle, treeReticle } from '../src/scope/reticles';

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

  it('casts the crescent on the head side when the eye is too far back', () => {
    // Eye right of the axis and behind the exit pupil: all its light comes through the exit pupil, on its left.
    const e = eye(1.5, 0, 15);
    const right = eyeboxTransmission(SCOPE, 16, e, 0.18, 0);
    const left = eyeboxTransmission(SCOPE, 16, e, -0.18, 0);
    expect(left).toBeGreaterThan(right);
    // Too close: the visible disc moves the other way.
    const close = eye(1.5, 0, -15);
    expect(eyeboxTransmission(SCOPE, 16, close, 0.18, 0)).toBeGreaterThan(eyeboxTransmission(SCOPE, 16, close, -0.18, 0));
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

describe('ballistics', () => {
  const yd = 0.9144;
  const inch = 0.0254;
  const fps = 0.3048;

  it("reproduces Federal's published table for the 175 gr SMK at 2600 ft/s", () => {
    const gm: Round = { id: 'gm308m2', name: 'GM308M2', cartridge: '.308 Win', bulletGr: 175, mv: 2600 * fps, bc: 0.25, model: 'G7' };
    // Federal: 2427, 2262, 2102, 1949, 1803 ft/s at 100–500 yd.
    [2427, 2262, 2102, 1949, 1803].forEach((v, i) => expect(Math.abs(at(gm, (i + 1) * 100 * yd).v / fps - v) / v).toBeLessThan(0.015));
    // 100 yd zero, sight 1.5 in over the bore: -4.4 in at 200 yd, -15.7 in at 300 yd.
    const h = 1.5 * inch;
    const tilt = (at(gm, 100 * yd).drop + h) / (100 * yd);
    const height = (d: number) => (d * yd * tilt - at(gm, d * yd).drop - h) / inch;
    expect(height(200)).toBeCloseTo(-4.4, 0);
    expect(height(300)).toBeCloseTo(-15.7, 0);
  });

  it('holds nothing at the zero range and the whole drop angle with a 0 m zero', () => {
    const r = ROUNDS.m118lr;
    expect(holdRad(r, 300, 300)).toBeCloseTo(0, 9);
    expect(holdRad(r, 412)).toBeCloseTo(at(r, 412).drop / 412, 12);
    expect(holdRad(r, 800)).toBeGreaterThan(holdRad(r, 400) * 2);
  });

  it('lets a mil-tree shooter work the hold out from the ammo card to within about a tenth', () => {
    const r = ROUNDS.m118lr;
    for (const d of [200, 400, 600, 800]) {
      const hand = handHoldRad(r.mv, at(r, d).v, d);
      expect(hand / holdRad(r, d)).toBeGreaterThan(1);
      expect(hand / holdRad(r, d)).toBeLessThan(1.12);
    }
  });

  it('cuts the PSO chevrons for the 7N1 at their marked ranges', () => {
    const chevrons = psoReticle().prims.filter((p) => p.kind === 'poly').map((p) => (p.kind === 'poly' ? p.pts[1]![1] : 0));
    expect(chevrons[0]).toBe(0);
    PSO_CHEVRON_RANGES.forEach((d, i) => {
      expect(chevrons[i + 1]).toBeCloseTo(holdRad(ROUNDS['7n1'], d) / THOUSANDTH, 9);
      expect(psoChevronY(d)).toBeGreaterThan(i === 0 ? 1 : psoChevronY(PSO_CHEVRON_RANGES[i - 1]!));
    });
  });
});

describe('recoil', () => {
  const v = shotVariation(0);
  for (const [name, spec] of Object.entries(RECOIL)) {
    it(`${name}: kicks high, settles with the rifle left up, and gives the eye back`, () => {
      const end = recoilAt(spec, v, spec.duration);
      expect(end.pitch).toBeCloseTo(spec.rise * v.rise, 4);
      expect(end.yaw).toBeGreaterThan(0);
      expect(Math.abs(end.tiltPitch)).toBeLessThan(1e-4);
      expect(Math.hypot(end.eye.x, end.eye.y, end.eye.z)).toBeLessThan(0.05);
      const peak = Math.max(...[0.03, 0.05, 0.07, 0.09].map((t) => recoilAt(spec, v, t).pitch));
      expect(peak).toBeGreaterThan(end.pitch * 1.8);
    });

    it(`${name}: drives the scope toward the eye, then the eye under the exit pupil`, () => {
      const early = [0.01, 0.015, 0.02, 0.025].map((t) => recoilAt(spec, v, t));
      expect(Math.min(...early.map((r) => r.eye.z))).toBeLessThan(-0.8 * spec.travelMm);
      // The head lags the rifle, so the scope tilts up against the eye and the eye ends up low.
      const mid = recoilAt(spec, v, 0.05);
      expect(mid.tiltPitch).toBeGreaterThan(0.01);
      expect(mid.eye.y).toBeLessThan(-2);
    });
  }

  it('makes the lighter SVD kick harder than the bolt rifle', () => {
    expect(RECOIL.svd.impulseNs / RECOIL.svd.rifleKg).toBeGreaterThan(RECOIL.bolt.impulseNs / RECOIL.bolt.rifleKg);
    expect(RECOIL.svd.kick).toBeGreaterThan(RECOIL.bolt.kick);
    expect(RECOIL.svd.travelMm).toBeGreaterThan(RECOIL.bolt.travelMm);
  });
});
