import { describe, expect, it } from 'vitest';
import { HEAD_UP, ON_WELD, adsEye, adsRoll, adsVelocity, planScopeIn, planScopeOut } from '../src/scope/ads';
import { SCOPE, eyeboxTransmission } from '../src/scope/optics';

const still = { x: 0, y: 0, z: 0 };

describe('scope-in and scope-out', () => {
  it('ends exactly on the weld and at rest, for every attempt', () => {
    for (let n = 0; n < 20; n++) {
      const m = planScopeIn(0, HEAD_UP, still, n);
      const e = adsEye(m, m.duration);
      expect(Math.hypot(e.x - ON_WELD.x, e.y - ON_WELD.y, e.z - ON_WELD.z)).toBeLessThan(0.05);
      const v = adsVelocity(m, m.duration);
      expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(1);
      expect(m.duration).toBeGreaterThan(0.55);
      expect(m.duration).toBeLessThan(0.85);
    }
  });

  it('lands the primary stroke high and back, so the picture opens as a crescent before it fills', () => {
    const m = planScopeIn(0, HEAD_UP, still, 0);
    const land = adsEye(m, 0.8 * 0.45 * 0.9);
    expect(land.z).toBeGreaterThan(3);
    const at = (t: number) => eyeboxTransmission(SCOPE, 8, { ...adsEye(m, t), pupilMm: 3 }, 0, 0.15) + eyeboxTransmission(SCOPE, 8, { ...adsEye(m, t), pupilMm: 3 }, 0, -0.15);
    // Coming down from above: the bottom of the field lights first.
    let t = 0;
    while (at(t) === 0 && t < 1) t += 0.005;
    const e = { ...adsEye(m, t), pupilMm: 3 };
    expect(eyeboxTransmission(SCOPE, 8, e, 0, -0.15)).toBeGreaterThan(eyeboxTransmission(SCOPE, 8, e, 0, 0.15));
  });

  it('is minimum-jerk: bell-shaped speed, peak in the first half of the move', () => {
    const m = planScopeIn(0, HEAD_UP, still, 3);
    let peak = 0;
    let tPeak = 0;
    for (let t = 0; t < m.duration; t += 0.005) {
      const v = adsVelocity(m, t);
      const s = Math.hypot(v.x, v.y, v.z);
      if (s > peak) { peak = s; tPeak = t; }
    }
    expect(tPeak).toBeGreaterThan(0.15);
    expect(tPeak).toBeLessThan(0.3);
    // 1.875 × the mean speed for a pure minimum-jerk stroke; ~70 mm in ~0.45 s.
    expect(peak).toBeGreaterThan(120);
    expect(peak).toBeLessThan(350);
  });

  it('lifts off the weld back first, then up, and can be reversed mid-move without a jump', () => {
    const m = planScopeOut(0, ON_WELD, still, 0);
    const early = adsEye(m, 0.05);
    expect(early.z).toBeGreaterThan(early.y);
    expect(adsEye(m, m.duration).y).toBeGreaterThan(50);
    const t = 0.15;
    const from = adsEye(m, t);
    const back = planScopeIn(t, from, adsVelocity(m, t), 1);
    const a = adsEye(back, t + 0.001);
    expect(Math.hypot(a.x - from.x, a.y - from.y, a.z - from.z)).toBeLessThan(0.5);
  });

  it('rolls the view a degree or so mid-move and not at either end', () => {
    const m = planScopeIn(0, HEAD_UP, still, 0);
    expect(adsRoll(m, 0)).toBe(0);
    expect(adsRoll(m, m.duration)).toBe(0);
    expect(Math.abs(adsRoll(m, m.rollT / 2))).toBeGreaterThan(0.01);
    expect(Math.abs(adsRoll(m, m.rollT / 2))).toBeLessThan(0.03);
  });
});
