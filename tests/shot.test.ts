import { describe, expect, it } from 'vitest';
import { AIR, ROUNDS, at, zeroTiltRad } from '../src/scope/ballistics';
import { THOUSANDTH } from '../src/scope/optics';
import { PSO_CHEVRON_RANGES, VSS_CHEVRON_RANGES, psoChevronY, vssChevronY } from '../src/scope/reticles';
import { BATTLE_ZERO_M, RANGE_SPIN, RIFLES, aeroJumpRad, crossDriftPerMs, dispersion, firstHit, fly, millerStability, pathAt, spinDriftM, type Path, type Vec3 } from '../src/scope/shot';

/** Where the path crosses the vertical plane `range` metres down -z. */
const plane = (p: Path, range: number) =>
  firstHit(p, () => -1e9, (a, b) => (b[2] <= -range ? { f: (-range - a[2]) / (b[2] - a[2]), what: 'plane' } : null));
const svd = RIFLES.svd;
const r7n1 = ROUNDS['7n1'];
const sp5 = ROUNDS.sp5;
const steady = (x: number, y: number, z: number) => (_x: number, _y: number, _z: number, _t: number, o: Vec3) => { o[0] = x; o[1] = y; o[2] = z; return o; };

describe('3D bullet flight', () => {
  it('reproduces the 2D solver (and so the ammo card and chevrons) in still air without Earth rotation', () => {
    for (const r of [r7n1, ROUNDS.m118lr]) {
      const p = fly({ round: r, mv: r.mv, origin: [0, 0, 0], dir: [0, 0, -1] });
      for (const d of [100, 412, 800]) {
        const h = plane(p, d);
        expect(-h.pos[1]).toBeCloseTo(at(r, d).drop, 3);
        expect(h.t).toBeCloseTo(at(r, d).tof, 3);
        expect(h.speed).toBeCloseTo(at(r, d).v, 0);
      }
    }
    // The subsonic SP-5 flies 1.6 s to 400 m.
    const p = fly({ round: sp5, mv: sp5.mv, origin: [0, 0, 0], dir: [0, 0, -1] });
    for (const d of [100, 183, 400]) {
      const h = plane(p, d);
      expect(-h.pos[1]).toBeCloseTo(at(sp5, d).drop, 3);
      expect(h.t).toBeCloseTo(at(sp5, d).tof, 3);
    }
  });

  it('lands on the target when the matching PSO chevron is held on it, drum on 1', () => {
    const sight = svd.sightM;
    for (const d of PSO_CHEVRON_RANGES) {
      // Hold the chevron on a target at the marked range: the bore leaves 70 mm under the line of sight and
      // points that far above it, plus the drum's tilt.
      const up = psoChevronY(d) * THOUSANDTH + zeroTiltRad(r7n1, BATTLE_ZERO_M, sight);
      const p = fly({ round: r7n1, mv: r7n1.mv, origin: [0, -sight, 0], dir: [0, Math.sin(up), -Math.cos(up)] });
      const h = plane(p, d);
      // Within 1 cm of the line of sight, at every chevron range.
      expect(Math.abs(h.pos[1])).toBeLessThan(0.01 + d * 1e-5);
    }
  });

  it('lands on the target when the matching VSS chevron is held on it, drum on 1', () => {
    const s = RIFLES.vss.sightM;
    for (const d of [BATTLE_ZERO_M, ...VSS_CHEVRON_RANGES]) {
      const up = vssChevronY(d) * THOUSANDTH + zeroTiltRad(sp5, BATTLE_ZERO_M, s);
      const h = plane(fly({ round: sp5, mv: sp5.mv, origin: [0, -s, 0], dir: [0, Math.sin(up), -Math.cos(up)] }), d);
      expect(Math.abs(h.pos[1])).toBeLessThan(0.01 + d * 1e-5);
    }
  });

  it('keeps the SP-5 subsonic all the way, so it leaves no shock and no trace', () => {
    const p = fly({ round: sp5, mv: sp5.mv, origin: [0, 0, 0], dir: [0, 0, -1] });
    expect(Math.max(...p.speed.subarray(0, p.n))).toBeLessThan(AIR.sound * 0.85);
    expect(plane(p, 400).speed).toBeGreaterThan(230);
    // At 183 m: 2.2 m of drop and 0.68 s of flight, against 0.06 m and 0.24 s for the 7N1.
    expect(at(sp5, 183).drop).toBeCloseTo(2.2, 1);
    expect(at(sp5, 183).tof).toBeCloseTo(0.68, 2);
  });

  it('drifts downwind as the lag rule says: wind × (time of flight − vacuum time)', () => {
    const p = fly({ round: r7n1, mv: r7n1.mv, origin: [0, 0, 0], dir: [0, 0, -1], wind: steady(3, 0, 0) });
    const h = plane(p, 412);
    const lag = 3 * (at(r7n1, 412).tof - 412 / r7n1.mv);
    expect(h.pos[0]).toBeGreaterThan(0.3);
    expect(h.pos[0]).toBeCloseTo(lag, 2);
    // About 0.8 thousandth: a little under one mark of the PSO's lateral scale at the mannequin.
    expect(h.pos[0] / 412 / THOUSANDTH).toBeGreaterThan(0.75);
    expect(h.pos[0] / 412 / THOUSANDTH).toBeLessThan(0.9);
  });

  it('a headwind costs a little height, a tailwind gives a little', () => {
    const head = plane(fly({ round: r7n1, mv: r7n1.mv, origin: [0, 0, 0], dir: [0, 0, -1], wind: steady(0, 0, 5) }), 600);
    const tail = plane(fly({ round: r7n1, mv: r7n1.mv, origin: [0, 0, 0], dir: [0, 0, -1], wind: steady(0, 0, -5) }), 600);
    expect(head.pos[1]).toBeLessThan(-at(r7n1, 600).drop);
    expect(tail.pos[1]).toBeGreaterThan(-at(r7n1, 600).drop);
  });

  it('Coriolis at 38.5° N firing north-west: about a centimetre right and a centimetre low at 412 m', () => {
    const h = plane(fly({ round: r7n1, mv: r7n1.mv, origin: [0, 0, 0], dir: [0, 0, -1], spin: RANGE_SPIN }), 412);
    expect(h.pos[0]).toBeGreaterThan(0.005);
    expect(h.pos[0]).toBeLessThan(0.02);
    expect(h.pos[1] + at(r7n1, 412).drop).toBeLessThan(-0.005);
    expect(h.pos[1] + at(r7n1, 412).drop).toBeGreaterThan(-0.02);
  });

  it('is gyro-stable, drifts right with the twist and jumps with the crosswind', () => {
    const sg = millerStability(svd, r7n1.mv);
    expect(sg).toBeGreaterThan(1.5);
    expect(sg).toBeLessThan(3);
    expect(millerStability(RIFLES.bolt, ROUNDS.m118lr.mv)).toBeCloseTo(1.9, 1);
    // A few centimetres at 412 m, growing faster than linearly.
    const tof = at(r7n1, 412).tof;
    expect(spinDriftM(sg, tof)).toBeGreaterThan(0.03);
    expect(spinDriftM(sg, tof)).toBeLessThan(0.06);
    const h = plane(fly({ round: r7n1, mv: r7n1.mv, origin: [0, 0, 0], dir: [0, 0, -1], sg }), 412);
    expect(h.pos[0]).toBeCloseTo(spinDriftM(sg, h.t), 4);
    // Right-hand twist: wind from the left throws it up, from the right down, ≈ ¼ MOA per 5 mph.
    expect(aeroJumpRad(svd, sg, 2.2)).toBeGreaterThan(0);
    expect(aeroJumpRad(svd, sg, -2.2)).toBeLessThan(0);
    expect(aeroJumpRad(svd, sg, 2.2) / (Math.PI / 10800)).toBeCloseTo(0.22, 1);
  });

  it('blows the slow SP-5 off less than its flight time suggests: the lag rule holds for it too', () => {
    const h = plane(fly({ round: sp5, mv: sp5.mv, origin: [0, 0, 0], dir: [0, 0, -1], wind: steady(3, 0, 0) }), 183);
    expect(h.pos[0]).toBeCloseTo(3 * (at(sp5, 183).tof - 183 / sp5.mv), 2);
    // About 7 cm in 3 m/s at 183 m: the bullet barely slows, so there is little lag to drift in.
    expect(h.pos[0]).toBeGreaterThan(0.05);
    expect(h.pos[0]).toBeLessThan(0.1);
  });

  it('VSS: gyro-stable with the assumed 210 mm twist, and its long flight drifts it a few cm right', () => {
    const sg = millerStability(RIFLES.vss, sp5.mv);
    expect(sg).toBeGreaterThan(2.5);
    expect(sg).toBeLessThan(4);
    const drift = spinDriftM(sg, at(sp5, 183).tof);
    expect(drift).toBeGreaterThan(0.05);
    expect(drift).toBeLessThan(0.09);
  });

  it('finds the ground crossing and keeps the bullet moving the right way', () => {
    // Level ground 1.1 m below the muzzle: a level shot comes down where its drop is 1.1 m.
    const p = fly({ round: r7n1, mv: r7n1.mv, origin: [0, 1.1, 0], dir: [0, 0, -1] });
    const h = firstHit(p, () => 0);
    expect(h.what).toBe('ground');
    expect(h.pos[1]).toBeCloseTo(0, 3);
    expect(at(r7n1, -h.pos[2]).drop).toBeCloseTo(1.1, 2);
    expect(h.vel[2]).toBeLessThan(-300);
    expect(h.vel[1]).toBeLessThan(0);
    const mid = pathAt(p, h.t / 2);
    expect(mid[2]).toBeLessThan(0);
    expect(mid[2]).toBeGreaterThan(h.pos[2]);
  });
});

describe('the rifle and the air', () => {
  it('spreads like the spec: σ per axis and in velocity, repeatable per shot', () => {
    let sx = 0, sy = 0, sv = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const d = dispersion(svd, i);
      sx += d.dx * d.dx;
      sy += d.dy * d.dy;
      sv += (d.mv - r7n1.mv) ** 2;
    }
    expect(Math.sqrt(sx / N) / svd.sigmaRad).toBeCloseTo(1, 1);
    expect(Math.sqrt(sy / N) / svd.sigmaRad).toBeCloseTo(1, 1);
    expect(Math.sqrt(sv / N) / svd.mvSd).toBeCloseTo(1, 1);
    expect(dispersion(svd, 7)).toEqual(dispersion(svd, 7));
  });

  it('gives range-card drift that matches published data: the .308 175 gr SMK and the VSS', () => {
    // Applied Ballistics, per 1 m/s at 600, 800 and 1000 m: 0.25, 0.47 and 0.83 m. Within 8 %.
    const [d600, d800, d1000] = crossDriftPerMs(ROUNDS.m118lr, [600, 800, 1000]);
    expect(d600! / 0.25).toBeGreaterThan(0.92);
    expect(d800! / 0.47).toBeCloseTo(1, 1);
    expect(d1000! / 0.83).toBeGreaterThan(0.92);
    // The VSS at the game's 183 m: 2.5 cm, about an eighth of a thousandth, per m/s.
    const [vss] = crossDriftPerMs(sp5, [183]);
    expect(vss).toBeCloseTo(0.025, 3);
    expect(vss! / 183 / THOUSANDTH).toBeCloseTo(0.13, 2);
  });
});
