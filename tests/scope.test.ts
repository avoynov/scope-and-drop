import { describe, expect, it } from 'vitest';
import { SCOPE, THOUSANDTH, circleOverlap, exitPupilMm, eyeboxTransmission, parallaxShiftRad, stadiaRangeM, tanHalfApparent, trueFovRad } from '../src/scope/optics';
import { ROUNDS, at, handHoldRad, holdRad, zeroTiltRad, type Round } from '../src/scope/ballistics';
import { BATTLE_ZERO_M, RIFLES } from '../src/scope/shot';
import { RECOIL, followHead, recoilAt, shotVariation, type RecoilSpec } from '../src/scope/recoil';
import { PSO_CHEVRON_RANGES, VSS_CHEVRON_RANGES, VSS_RANGEFINDER, psoChevronY, psoCurveHeight, psoReticle, treeReticle, vssChevronY, vssReticle } from '../src/scope/reticles';

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

  it('darkens the side the eye has moved to when it is too far back, and the other side when too close', () => {
    const back = eye(1.5, 0, 15);
    expect(eyeboxTransmission(SCOPE, 16, back, 0.18, 0)).toBeLessThan(eyeboxTransmission(SCOPE, 16, back, -0.18, 0));
    const close = eye(1.5, 0, -15);
    expect(eyeboxTransmission(SCOPE, 16, close, 0.18, 0)).toBeGreaterThan(eyeboxTransmission(SCOPE, 16, close, -0.18, 0));
  });

  it('brings a crescent in from the side the eye slips to, even at the right eye relief', () => {
    const edge = tanHalfApparent(SCOPE);
    expect(eyeboxTransmission(SCOPE, 12, eye(), edge, 0)).toBeGreaterThan(0.95);
    const slip = eye(1, 0, 0);
    expect(eyeboxTransmission(SCOPE, 12, slip, edge, 0)).toBeLessThan(0.75);
    expect(eyeboxTransmission(SCOPE, 12, slip, -edge, 0)).toBeGreaterThan(0.95);
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

  it('VSS rangefinder: the drawn ticks bracket a 1.7 m man every 50 m from 100 to 400 m', () => {
    const lines = vssReticle().prims.flatMap((p) => (p.kind === 'line' ? [p] : []));
    // The base line is the long horizontal one at lower left; the ticks stand on the curve and point up.
    const base = lines.find((l) => l.y1 === l.y2 && l.x1 < -10 && l.y1 > 5)!;
    const ticks = lines.filter((l) => l.x1 === l.x2 && l.x1 < -4 && l.y2 < l.y1 && l.y1 < base.y1).sort((a, b) => a.x1 - b.x1);
    expect(ticks.map((l) => stadiaRangeM(1.7, (base.y1 - l.y1) * THOUSANDTH))).toEqual(VSS_RANGEFINDER.map((n) => expect.closeTo(n * 100, 6)));
  });

  it('builds all three patterns with a lit aiming point', () => {
    for (const r of [psoReticle(), treeReticle(), vssReticle()]) {
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
    // With the scope over the bore too: nothing at the zero, and the drum's 0 adds the sight height's angle.
    expect(holdRad(r, 100, 100, 0.058)).toBeCloseTo(0, 9);
    expect(zeroTiltRad(r, 0, 0.058)).toBe(0);
    expect(holdRad(r, 412, 0, 0.058)).toBeCloseTo((at(r, 412).drop + 0.058) / 412, 12);
  });

  it("matches the SVD manual's zeroing check: 100 m, drum on 3, hits 14 cm above the aim", () => {
    const r = ROUNDS['7n1'];
    const h = RIFLES.svd.sightM;
    // The bullet's height over the line of sight at 100 m with the drum on 3.
    const high = 100 * zeroTiltRad(r, 300, h) - at(r, 100).drop - h;
    expect(high).toBeCloseTo(0.14, 2);
  });

  it('gives every rifle a drum from 1 (100 m) up in 50 m clicks, and the bolt rifle a 0 below it', () => {
    for (const rifle of Object.values(RIFLES)) {
      const one = rifle.drumM.indexOf(BATTLE_ZERO_M);
      expect(one).toBe(rifle.id === 'bolt' ? 1 : 0);
      if (rifle.id === 'bolt') expect(rifle.drumM[0]).toBe(0);
      for (let i = one + 1; i < rifle.drumM.length; i++) expect(rifle.drumM[i]! - rifle.drumM[i - 1]!).toBe(50);
    }
    expect(RIFLES.vss.drumM.at(-1)).toBe(400);
    expect(RIFLES.svd.drumM.at(-1)).toBe(1000);
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
      expect(chevrons[i + 1]).toBeCloseTo(holdRad(ROUNDS['7n1'], d, BATTLE_ZERO_M, RIFLES.svd.sightM) / THOUSANDTH, 9);
      expect(psoChevronY(d)).toBeGreaterThan(i === 0 ? 1 : psoChevronY(PSO_CHEVRON_RANGES[i - 1]!));
    });
  });

  it('cuts the VSS chevrons for the subsonic SP-5: steep, about a thousandth every 15 m at the game range', () => {
    const chevrons = vssReticle().prims.filter((p) => p.kind === 'poly').map((p) => (p.kind === 'poly' ? p.pts[1]![1] : 0));
    expect(chevrons[0]).toBe(0);
    VSS_CHEVRON_RANGES.forEach((d, i) => expect(chevrons[i + 1]).toBeCloseTo(holdRad(ROUNDS.sp5, d, BATTLE_ZERO_M, RIFLES.vss.sightM) / THOUSANDTH, 9));
    // 100 m is the zero: the aiming chevron.
    expect(vssChevronY(100)).toBeCloseTo(0, 9);
    expect(vssChevronY(150)).toBeCloseTo(3.0, 1);
    expect(vssChevronY(400)).toBeCloseTo(20.0, 1);
    // From 150 to 200 m the hold grows 3.2 thousandths: a range error of 16 m is a thousandth, 18 cm at 183 m.
    expect(vssChevronY(200) - vssChevronY(150)).toBeCloseTo(3.2, 1);
    // The 7N1 needs half that hold at 412 m.
    expect(vssChevronY(183)).toBeGreaterThan(1.9 * psoChevronY(412));
  });
});

describe('recoil', () => {
  it('gives bit-identical results when frames reuse the cached head track, in any order', () => {
    for (const spec of [RECOIL.svd, RECOIL.bolt]) {
      const shared = shotVariation(5);
      const times = [0.5, 0.0005, 2.9, 0.1, 0.1083, 0.0917, 1.6, 0, -0.01, spec.duration, 0.0010000001];
      for (const t of times) expect(recoilAt(spec, shared, t)).toStrictEqual(recoilAt(spec, { ...shared }, t));
    }
  });

  const v = shotVariation(0);
  /** The full-bore rifles black the picture out for a while; the suppressed VSS only dims it (its own test below). */
  const fullBore = (name: string) => name === 'svd' || name === 'bolt';
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
      expect(mid.eye.y).toBeLessThan(fullBore(name) ? -2 : -1.5);
    });

    if (!fullBore(name)) continue;
    it(`${name}: holds the scope too close and the eye low long enough to be seen`, () => {
      let close = 0;
      let low = 0;
      for (let t = 0; t < 1; t += 0.002) {
        const r = recoilAt(spec, v, t);
        if (r.eye.z < -10) close += 0.002;
        if (r.eye.y < -2) low += 0.002;
      }
      expect(close).toBeGreaterThan(0.2);
      expect(low).toBeGreaterThan(0.15);
    });
  }

  it('lets the head trail a steady swing by its lag, and glues it on with none', () => {
    let head = 0;
    for (let i = 1; i <= 1000; i++) head = followHead(head, i * 0.001, 0.001, 0.03);
    expect(1 - head).toBeCloseTo(0.03, 2);
    expect(followHead(0, 1, 0.016, 0)).toBe(1);
    expect(followHead(0, 1, 0, 0.03)).toBe(0);
  });

  it('varies every shot, ties shoulder and cheek together, and never hides the artifacts', () => {
    const shots = Array.from({ length: 200 }, (_, n) => shotVariation(n));
    const spread = (k: keyof (typeof shots)[0]) => Math.max(...shots.map((v) => v[k])) - Math.min(...shots.map((v) => v[k]));
    for (const k of ['rise', 'drift', 'kick', 'kickPeak', 'travel', 'travelRecover', 'headLag', 'shake', 'joltMm'] as const) {
      expect(spread(k)).toBeGreaterThan(0.1);
    }
    expect(shotVariation(7)).toEqual(shotVariation(7));
    const left = shots.filter((v) => v.drift < 0).length;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(15);
    // A loose hold lets the scope come further back and the head settle more slowly.
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const mt = mean(shots.map((v) => v.travel));
    const ml = mean(shots.map((v) => v.headLag));
    expect(mean(shots.map((v) => (v.travel - mt) * (v.headLag - ml)))).toBeGreaterThan(0);
    // The full-bore rifles black out for at least a tenth of a second every shot; the VSS still dims.
    for (const [name, spec] of Object.entries(RECOIL)) {
      const [far, dip] = fullBore(name) ? [-10, -2] : [-5, -1];
      for (const v of shots.slice(0, 40)) {
        let close = 0;
        let low = 0;
        for (let t = 0; t < 1; t += 0.004) {
          const r = recoilAt(spec, v, t);
          if (r.eye.z < far) close += 0.004;
          if (r.eye.y < dip) low += 0.004;
        }
        expect(close).toBeGreaterThan(0.1);
        expect(low).toBeGreaterThan(0.1);
        expect(recoilAt(spec, v, 0).pitch).toBe(0);
      }
    }
  });

  it('makes the lighter SVD kick harder than the bolt rifle', () => {
    expect(RECOIL.svd.impulseNs / RECOIL.svd.rifleKg).toBeGreaterThan(RECOIL.bolt.impulseNs / RECOIL.bolt.rifleKg);
    expect(RECOIL.svd.kick).toBeGreaterThan(RECOIL.bolt.kick);
    expect(RECOIL.svd.travelMm).toBeGreaterThan(RECOIL.bolt.travelMm);
  });

  it('vss: kicks a fifth as hard as the SVD, so the picture only dims and a 183 m target stays in an 8× field', () => {
    const energy = (s: RecoilSpec) => s.impulseNs ** 2 / (2 * s.rifleKg);
    expect(energy(RECOIL.vss)).toBeCloseTo(3.2, 1);
    expect(energy(RECOIL.vss) / energy(RECOIL.svd)).toBeLessThan(0.2);
    const dims = (spec: RecoilSpec) => {
      let close = 0, low = 0, nearest = 0;
      for (let t = 0; t < 1; t += 0.002) {
        const r = recoilAt(spec, v, t);
        if (r.eye.z < -5) close += 0.002;
        if (r.eye.y < -1) low += 0.002;
        nearest = Math.min(nearest, r.eye.z);
      }
      return { close, low, nearest };
    };
    const vss = dims(RECOIL.vss);
    const svd = dims(RECOIL.svd);
    // Still there to see: the scope comes about 10 mm back and the eye dips under the exit pupil's centre...
    expect(vss.nearest).toBeLessThan(-8);
    expect(vss.close).toBeGreaterThan(0.12);
    expect(vss.low).toBeGreaterThan(0.1);
    // ...for well under half as long as the SVD's, and less than half as far.
    expect(vss.close).toBeLessThan(0.5 * svd.close);
    expect(vss.nearest).toBeGreaterThan(0.5 * svd.nearest);
    // Held on the 183 m mark, the mannequin is still in an 8× field once the rifle settles.
    const below = holdRad(ROUNDS.sp5, 183) + recoilAt(RECOIL.vss, v, RECOIL.vss.duration).pitch;
    expect(below).toBeLessThan(0.8 * (trueFovRad(SCOPE, 8) / 2));
  });
});
