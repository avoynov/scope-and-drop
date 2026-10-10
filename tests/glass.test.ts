import { describe, expect, it } from 'vitest';
import { woundTrack } from '../src/body/wound';
import { GLAZING, dragAfter, swingLength, throughGlass, yawAfter, type GlassBullet, type GlassShot, type Glazing, type GlazingId } from '../src/scope/glass';
import { ROUNDS, at } from '../src/scope/ballistics';
import { RIFLES, firstHit, fly, millerStability, spinDriftM, type Path, type Vec3 } from '../src/scope/shot';

const DEG = Math.PI / 180;
const IN = 0.0254;
/**
 * A bullet going down −z into a pane at the origin turned `deg` about the vertical: + turns its face to the
 * shooter's right, so the shooter stands left of its normal.
 */
const shoot = (round: GlassShot['round'], v: number, deg: number, glazing: Glazing, seed: number, extra: Partial<GlassShot> = {}) =>
  throughGlass({ round, pos: [0, 0, 0], vel: [0, 0, -v], normal: [Math.sin(deg * DEG), 0, Math.cos(deg * DEG)], glazing, twistM: 0.254, sg: 1.9, seed, ...extra });
const stats = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { mean: m, sd: Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) };
};
/** Many shots: mean and spread of the turn right and up (rad), speed lost, and how often the jacket came off. */
function group(n: number, f: (seed: number) => ReturnType<typeof throughGlass>) {
  const right: number[] = [], up: number[] = [], lost: number[] = [], strip: number[] = [];
  for (let s = 0; s < n; s++) {
    const t = f(s);
    right.push(t.vel[0] / -t.vel[2]);
    up.push(t.vel[1] / -t.vel[2]);
    lost.push(1 - t.speed / t.sheets[0]!.speedIn);
    strip.push(t.stripped ? 1 : 0);
  }
  return { right: stats(right), up: stats(up), lost: stats(lost).mean, strip: stats(strip).mean };
}

/** The lab's three rounds at the ranges they are shot at, with their own rifles' twist and stability. */
const LAB = (['vss', 'svd', 'bolt'] as const).map((id) => {
  const rf = RIFLES[id];
  const r = ROUNDS[rf.round];
  const d = id === 'vss' ? 179 : 408;
  return { round: rf.round, v: at(r, d).v, twistM: rf.twistMm / 1000, sg: millerStability(rf, r.mv) };
});
const lab = (i: number, g: GlazingId, deg: number, seed: number) => {
  const l = LAB[i]!;
  return shoot(l.round, l.v, deg, GLAZING[g], seed, { twistM: l.twistM, sg: l.sg });
};

describe('glass: calibration against published shots', () => {
  // Lambert (1994): M118 173 gr FMJ at ≈ 760 m/s through 6 mm tempered glass, target 5 yd behind. With the
  // rifle right of the pane's normal the cores landed 0.59, 1.30 and 2.17 in right of the line (SD ≈ 0.6, 0.99,
  // 1.42 in) at 0°, 30° and 45°; from the left of the normal they still went right. No jacket came off
  // square-on, every one did at 45°.
  const tempered: Glazing = { name: 't', sheets: [{ plies: [{ k: 'tempered', mm: 5.95 }], gapMm: 0 }] };
  const fmj: GlassBullet = { diaM: 0.00782, lenM: 0.0305, jacket: 0.35, stripV: 850, deform: 0.25, breakup: 0 };
  /** `deg` with the rifle right of the normal (the pane's face turned to the shooter's left). */
  const lambert = (deg: number) => group(1500, (s) => shoot('m118lr', 760, -deg, tempered, s, { bullet: fmj, massKg: 0.01121 }));
  const at5yd = (x: number) => (x * 4.572) / IN;
  it('lands M118 behind tempered glass where Lambert measured it', () => {
    for (const [deg, mean, sd] of [[0, 0.59, 0.6], [30, 1.3, 0.99], [45, 2.17, 1.42]] as const) {
      const g = lambert(deg);
      expect(at5yd(g.right.mean), `${deg}° mean`).toBeGreaterThan(mean - 0.3);
      expect(at5yd(g.right.mean), `${deg}° mean`).toBeLessThan(mean + 0.3);
      expect(at5yd(g.right.sd), `${deg}° spread`).toBeGreaterThan(sd * 0.7);
      expect(at5yd(g.right.sd), `${deg}° spread`).toBeLessThan(sd * 1.3);
    }
    for (const deg of [-30, -45]) expect(lambert(deg).right.mean, `${deg}°`).toBeGreaterThan(0);
  });
  it('strips M118 jackets as Lambert saw: none square-on, every one at 45°', () => {
    expect(lambert(0).strip).toBeLessThan(0.05);
    const s30 = lambert(30).strip;
    expect(s30).toBeGreaterThan(0.1);
    expect(s30).toBeLessThan(0.7);
    expect(lambert(45).strip).toBeGreaterThan(0.9);
  });

  // Osnes et al.: 7.62 mm AP (10.5 g) into a plate of three 3.8 mm glass plies and two 1.52 mm PVB layers.
  // Ballistic limit 232 m/s; 519.6 m/s came out at 412.8 m/s.
  const plate: Glazing = { name: 'dl', sheets: [{ plies: [{ k: 'glass', mm: 3.8 }, { k: 'pvb', mm: 1.52 }, { k: 'glass', mm: 3.8 }, { k: 'pvb', mm: 1.52 }, { k: 'glass', mm: 3.8 }], gapMm: 0 }] };
  const ap: GlassBullet = { diaM: 0.00762, lenM: 0.035, jacket: 0.52, stripV: 1e9, deform: 0, breakup: 0 };
  it('slows a 7.62 AP through laminated plate as Osnes et al. measured', () => {
    const t = shoot('7n1', 519.6, 0, plate, 1, { bullet: ap, massKg: 0.0105 });
    expect(t.speed).toBeGreaterThan(400);
    expect(t.speed).toBeLessThan(426);
    expect(shoot('7n1', 225, 0, plate, 1, { bullet: ap, massKg: 0.0105 }).outcome).toBe('stopped');
    expect(shoot('7n1', 260, 0, plate, 1, { bullet: ap, massKg: 0.0105 }).outcome).toBe('through');
  });
});

describe('glass: the lab rounds', () => {
  it('square-on, window glass costs 3–9 % of the speed and barely turns the bullet', () => {
    for (let i = 0; i < 3; i++) {
      const g = group(400, (s) => lab(i, 'single', 0, s));
      expect(g.lost, LAB[i]!.round).toBeGreaterThan(0.03);
      expect(g.lost, LAB[i]!.round).toBeLessThan(0.09);
      // Under 4 mrad of turn: a few cm on a man 100 m behind the window.
      expect(Math.hypot(g.right.mean, g.up.mean)).toBeLessThan(0.004);
      expect(g.right.sd).toBeLessThan(0.006);
    }
  });

  it('more glass costs more: a double unit or laminated glass about twice a single pane', () => {
    for (let i = 0; i < 3; i++) {
      const loss = (g: GlazingId) => group(200, (s) => lab(i, g, 0, s)).lost;
      expect(loss('double')).toBeGreaterThan(loss('single') * 1.6);
      expect(loss('laminated')).toBeGreaterThan(loss('single') * 1.5);
      expect(loss('laminated')).toBeLessThan(0.2);
    }
  });

  it('the spread opens as the pane turns', () => {
    for (let i = 0; i < 3; i++) {
      const sd = [0, 30, 45, 60].map((deg) => group(400, (s) => lab(i, 'single', deg, s)).right.sd);
      for (let k = 1; k < sd.length; k++) expect(sd[k]!).toBeGreaterThan(sd[k - 1]!);
    }
  });

  it("turns toward the pane's normal on a slant: right when the shooter stands right of it", () => {
    // The spin turns it right either way; the difference between the two sides is the turn toward the normal.
    const right = (deg: number) => group(800, (s) => lab(0, 'laminated', deg, s)).right.mean;
    expect(right(-45) - right(45)).toBeGreaterThan(0.004);
  });

  it('SP-5 keeps its jacket at up to 45°; the open-tip M118LR loses it even square-on', () => {
    for (const deg of [0, 30, 45]) expect(group(300, (s) => lab(0, 'single', deg, s)).strip).toBeLessThan(0.05);
    const sq = group(300, (s) => lab(2, 'single', 0, s)).strip;
    expect(sq).toBeGreaterThan(0.2);
    expect(group(300, (s) => lab(2, 'single', 45, s)).strip).toBeGreaterThan(0.9);
    // A stripped match bullet loses its jacket and part of its core.
    const t = lab(2, 'single', 45, 3);
    expect(t.massKg).toBeLessThan(ROUNDS.m118lr.bulletGr * 0.0000648 * 0.7);
  });

  it('glances off a pane met at a grazing angle', () => {
    expect(lab(0, 'single', 84, 1).outcome).toBe('ricochet');
    expect(lab(0, 'single', 60, 1).outcome).toBe('through');
  });

  it('carries yaw from the first pane of a double unit into the second', () => {
    const t = lab(0, 'double', 0, 5);
    expect(t.sheets.length).toBe(2);
    expect(t.sheets[1]!.speedIn).toBeCloseTo(t.sheets[0]!.speedOut, 6);
    expect(t.yawMax).toBeGreaterThan(0);
  });

  it('is repeatable for a seed', () => {
    expect(lab(1, 'laminated', 30, 7)).toEqual(lab(1, 'laminated', 30, 7));
    expect(lab(1, 'laminated', 30, 7).vel).not.toEqual(lab(1, 'laminated', 30, 8).vel);
  });

  it('costs microseconds a pane', () => {
    const t0 = performance.now();
    for (let s = 0; s < 20000; s++) lab(s % 3, 'double', (s % 7) * 8, s);
    expect((performance.now() - t0) / 20000).toBeLessThan(0.05);
  });
});

describe('glass: after the pane', () => {
  it('the yaw swings and dies away over ~80 m, and adds drag while it lasts', () => {
    const sp5 = LAB[0]!;
    const swing = swingLength({ diaM: 0.00925, lenM: 0.036, jacket: 0.28, stripV: 520, deform: 0.15, breakup: 0 }, sp5.twistM, sp5.sg);
    expect(swing).toBeGreaterThan(1);
    expect(swing).toBeLessThan(15);
    expect(yawAfter(0.3, swing, 0)).toBe(0);
    expect(yawAfter(0.3, swing, swing / 2)).toBeGreaterThan(0.25);
    expect(yawAfter(0.3, swing, 400)).toBeLessThan(0.003);
    const t = lab(0, 'laminated', 45, 2);
    expect(dragAfter(t, swing / 2)).toBeGreaterThan(dragAfter(t, 400));
    expect(dragAfter(t, 400)).toBeCloseTo(t.stripped ? 1.25 : 1, 2);
  });

  it('fly() picks up after glass: spin drift carries on, and extra drag slows it', () => {
    const r = ROUNDS.sp5;
    const base = { round: r, mv: 280, origin: [0, 0, 0] as Vec3, dir: [0, 0, -1] as Vec3, sg: 3 };
    const plane = (p: Path, d: number) => firstHit(p, () => -1e9, (a, b) => (b[2] <= -d ? { f: (-d - a[2]) / (b[2] - a[2]), what: 'plane' } : null));
    const fresh = fly(base);
    const later = fly({ ...base, flown: 0.4 });
    const h0 = plane(fresh, 100), h1 = plane(later, 100);
    // Same flight; spin drift picks up where it was rather than starting again.
    expect(h1.pos[1]).toBeCloseTo(h0.pos[1], 6);
    expect(h1.pos[0] - h0.pos[0]).toBeCloseTo(spinDriftM(3, 0.4 + h0.t) - spinDriftM(3, 0.4) - spinDriftM(3, h0.t), 3);
    // A yawing bullet bleeds more speed.
    const yawing = fly({ ...base, drag: () => 1.5 });
    expect(plane(yawing, 100).speed).toBeLessThan(h0.speed - 2);
    expect(fly({ ...base, drag: () => 1 }).pos).toEqual(fresh.pos);
  });

  it('a bullet that arrives yawing turns at once in tissue', () => {
    // Below the ribs, where no bone yaws the bullet anyway.
    const w = { entry: [0.05, 1.0, 0.2] as Vec3, dir: [0, 0, -1] as Vec3, speed: 250, round: 'sp5' as const, seed: 1 };
    const cavity = (yawRad: number) => woundTrack({ ...w, yawRad }).track.filter((q) => q.p[2] > 0.06).reduce((a, q) => Math.max(a, q.cavity), 0);
    expect(cavity(0.4)).toBeGreaterThan(cavity(0) * 1.2);
  });
});
