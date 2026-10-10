/**
 * Firing a real bullet: a 3D point-mass flight through moving air, plus the rifle and ammunition behind it.
 *
 * The flight uses the same G7 drag and ICAO air as `trajectory()` in ballistics.ts, but in three dimensions
 * and relative to the wind, with gravity, Coriolis, spin drift (Litz) and crosswind aerodynamic jump
 * (Litz). With no wind and no Earth rotation a level shot reproduces `trajectory()`, so the PSO chevrons
 * and the ammo card stay true.
 *
 * Frame: the demo's scene frame. x right, y up, z toward the shooter (the range runs down -z). Metres,
 * seconds, radians.
 */
import { AIR, ROUNDS, cdG7, type Round, type RoundId } from './ballistics';

export type Vec3 = [number, number, number];

export interface Rifle {
  id: 'svd' | 'bolt' | 'vss';
  name: string;
  round: RoundId;
  /** Rifling: one turn in this many mm, right-hand. */
  twistMm: number;
  /** Bullet length and diameter, for Miller stability. */
  bulletLenMm: number;
  bulletDiaMm: number;
  /** Rifle and ammunition precision: standard deviation of the launch angle, per axis. */
  sigmaRad: number;
  /** Shot-to-shot muzzle-velocity standard deviation. */
  mvSd: number;
  /** Trigger break to primer (lock time) and primer to muzzle (barrel time). */
  lockS: number;
  barrelS: number;
  action: 'semi' | 'bolt';
  magazine: number;
  /** Magazine change, prone, until the rifle is back on the shoulder and loaded. */
  reloadS: number;
  /** Working the bolt, prone, staying on the gun. */
  cycleS: number;
  /** How much dust the muzzle blast raises off dry ground in front of a prone shooter (SVD = 1). */
  blastDust: number;
  /** Height of the scope's axis above the bore. */
  sightM: number;
  /** The elevation drum's marks, one detent each, in metres, from 100 m (its 1) up. */
  drumM: readonly number[];
}

/** The drum's normal setting: the rifle is zeroed at 100 m, drum on 1, and the cut reticles are cut for it. */
export const BATTLE_ZERO_M = 100;

/** Drum marks every 50 m from 100 m to `max`. Like the real PSO-1's, the drum starts at 1. */
const drum = (max: number): number[] => Array.from({ length: (max - 100) / 50 + 1 }, (_, i) => 100 + i * 50);

const MOA = Math.PI / (180 * 60);

/**
 * Precision from extreme spreads: a 5-shot group's extreme spread is about 3.0 σ (per-axis σ of a round
 * normal cone). MV variation is kept out of σ here and flown for real, so it shows as vertical spread.
 */
export const RIFLES = {
  /**
   * SVD, 7N1. Spec: ≤ 1.24 MOA extreme vertical spread for 5 shots with the 240 mm twist; 7N1 at 300 m
   * puts every shot of a group inside an 80 mm radius. That is σ ≈ 0.4 MOA. Hammer-fired: ≈ 6 ms lock.
   * Barrel 620 mm: ≈ 1.3 ms barrel time. 10-round box magazine, semi-automatic.
   * Sight height 70 mm: the manual's zeroing check (100 m, drum on 3, hits 14 cm above the aim) comes out at
   * 14 cm with the 7N1 only for a scope 70 mm over the bore (tested). PSO-1 drum: 100–1000 m in 50 m clicks.
   */
  svd: {
    id: 'svd', name: 'SVD', round: '7n1', twistMm: 240, bulletLenMm: 32.3, bulletDiaMm: 7.92,
    sigmaRad: 0.4 * MOA, mvSd: 8, lockS: 0.006, barrelS: 0.0013,
    action: 'semi', magazine: 10, reloadS: 3.2, cycleS: 0, blastDust: 1, sightM: 0.07, drumM: drum(1000),
  },
  /**
   * Bolt rifle (M24 class), M118LR: about 0.75 MOA for 5 shots, so σ ≈ 0.25 MOA; velocity SD about 4 m/s.
   * Twist 1:11.25", striker lock time ≈ 3 ms, 610 mm barrel. Five-round magazine; working the bolt prone
   * without coming off the gun takes about a second.
   * Scope 58 mm over the bore, as modelled in the demo. Its elevation turret carries a ballistic dial cut for
   * the M118LR (as Leupold's CDS dials are), marked in hundreds of metres to 1000 m.
   */
  bolt: {
    id: 'bolt', name: 'Bolt rifle', round: 'm118lr', twistMm: 286, bulletLenMm: 31.5, bulletDiaMm: 7.82,
    sigmaRad: 0.25 * MOA, mvSd: 4, lockS: 0.003, barrelS: 0.0013,
    action: 'bolt', magazine: 5, reloadS: 4.5, cycleS: 1.1, blastDust: 0.6, sightM: 0.058, drumM: drum(1000),
  },
  /**
   * VSS "Vintorez", SP-5: integrally suppressed and subsonic. Spec: 4 shots inside 75 mm at 100 m, prone off
   * a rest; observed 1–2 MOA. σ ≈ 0.45 MOA with a 4 m/s velocity SD, which at subsonic speed is itself worth
   * 1.8 cm of vertical at 100 m and 6 cm at 183 m. The twist is not published: 210 mm assumed, which gives
   * the long bullet SG ≈ 3.3. Striker-fired, ≈ 5 ms lock; a 200 mm ported barrel and the suppressor ahead of
   * it, ≈ 1.9 ms until the bullet is out. 10-round magazine, semi-automatic (the automatic mode is left out).
   * The gas leaves through the suppressor, so the blast lifts almost no dust.
   * The PSO-1-1 sits on the same side rail as the SVD's PSO: 70 mm over the bore assumed. Its drum is cut for
   * the SP-5 out to 400 m.
   */
  vss: {
    id: 'vss', name: 'VSS', round: 'sp5', twistMm: 210, bulletLenMm: 36, bulletDiaMm: 9.25,
    sigmaRad: 0.45 * MOA, mvSd: 4, lockS: 0.005, barrelS: 0.0019,
    action: 'semi', magazine: 10, reloadS: 3, cycleS: 0, blastDust: 0.05, sightM: 0.07, drumM: drum(400),
  },
} as const satisfies Record<string, Rifle>;
export type RifleId = keyof typeof RIFLES;

/** Miller's gyroscopic stability at the muzzle, standard air. */
export function millerStability(rf: Rifle, mv: number): number {
  const r = ROUNDS[rf.round];
  const d = rf.bulletDiaMm / 25.4;
  const l = rf.bulletLenMm / rf.bulletDiaMm;
  const t = rf.twistMm / rf.bulletDiaMm;
  const sg = (30 * r.bulletGr) / (t * t * d ** 3 * l * (1 + l * l));
  return sg * Math.cbrt(mv / 0.3048 / 2800);
}

/** Litz's spin drift: 1.25·(SG + 1.2)·t^1.83 inches, to the right for a right-hand twist. */
export function spinDriftM(sg: number, tof: number): number {
  return 1.25 * (sg + 1.2) * Math.pow(tof, 1.83) * 0.0254;
}

/**
 * Litz's crosswind aerodynamic jump: (0.01·SG − 0.0024·L + 0.032) MOA per mph of crosswind, L in calibres.
 * With a right-hand twist a wind from the left throws the bullet up, one from the right throws it down.
 * `crossFromLeft` is the crosswind component blowing left to right (m/s). Returns radians, up positive.
 */
export function aeroJumpRad(rf: Rifle, sg: number, crossFromLeft: number): number {
  const l = rf.bulletLenMm / rf.bulletDiaMm;
  const perMph = 0.01 * sg - 0.0024 * l + 0.032;
  return perMph * (crossFromLeft / 0.44704) * MOA;
}

/**
 * Wind over the range. `speed` m/s blowing from `fromClock` (12 = from downrange, 3 = from the right,
 * 9 = from the left). Gusts vary the speed by about ±`gust` and swing the direction by ~±12°, over
 * 5–15 s, and the same gust reaches different parts of the range at different times, so the wind at the
 * target is not the wind at the shooter.
 */
export interface Wind {
  speed: number;
  fromClock: number;
  gust: number;
}

function hash1(i: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth 1D value noise in [-1, 1]. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i * 7919 + seed) * 2 - 1;
  const b = hash1((i + 1) * 7919 + seed) * 2 - 1;
  return a + (b - a) * u;
}

/** Air velocity (m/s, scene frame) at downrange distance `down` (m, ≥ 0) and time `t`. */
export function windAt(w: Wind, down: number, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  if (w.speed <= 0) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  // Gusts are frozen into the air and carried across the range; downrange they arrive out of step.
  const u = t / 9 - down / 260;
  const g = 0.65 * noise1(u, 11) + 0.35 * noise1(u * 2.7 + 5, 12);
  const s = Math.max(0, w.speed * (1 + w.gust * g));
  const a = (w.fromClock * Math.PI) / 6 + 0.21 * (0.7 * noise1(u * 1.3 + 9, 13) + 0.3 * noise1(u * 3.1, 14));
  // Coming from bearing a (clockwise from downrange), the air blows the other way.
  out[0] = -Math.sin(a) * s;
  out[1] = 0;
  out[2] = Math.cos(a) * s;
  return out;
}

/** Earth's rotation in the scene frame, for a range at `latDeg` firing toward azimuth `azDeg` (from north). */
export function earthSpin(latDeg: number, azDeg: number): Vec3 {
  const w = 7.292115e-5;
  const lat = (latDeg * Math.PI) / 180;
  const az = (azDeg * Math.PI) / 180;
  // Downrange is -z at azimuth az; right (+x) is az + 90°. North in the scene frame:
  const north: Vec3 = [-Math.sin(az), 0, -Math.cos(az)];
  return [w * Math.cos(lat) * north[0], w * Math.sin(lat), w * Math.cos(lat) * north[2]];
}

/**
 * The range in the demo: high desert at 38.5° N, shooting toward the north-west (azimuth 315°), which puts
 * the afternoon sun behind the shooter's left shoulder as in the scene.
 */
export const RANGE_SPIN = earthSpin(38.5, 315);

export interface FlyOptions {
  round: Round;
  mv: number;
  origin: Vec3;
  /** Unit launch direction. */
  dir: Vec3;
  /** Air velocity at a point and an absolute time. */
  wind?: (x: number, y: number, z: number, t: number, out: Vec3) => Vec3;
  /** Absolute time the bullet leaves the muzzle (for the wind). */
  t0?: number;
  /** Earth rotation (rad/s, scene frame) for Coriolis; omit for none. */
  spin?: Vec3;
  /** Spin drift: Miller stability, and the sign of the twist (+1 right-hand). Omit for none. */
  sg?: number;
  /** Stop after this long, or once the bullet is this far below the muzzle. */
  maxT?: number;
  floor?: number;
  /** Stop a few samples after this says the bullet is done (in the ground, say), to save flying on. */
  until?: (x: number, y: number, z: number) => boolean;
}

/**
 * The bullet's path, sampled every `dt` from the muzzle. Spin drift is added to the stored positions as a
 * sideways offset (Litz's fit is for the drift itself, not a force). Positions are xyz triples.
 */
export interface Path {
  dt: number;
  n: number;
  pos: Float64Array;
  speed: Float64Array;
}

/**
 * Flies the bullet with RK4 at 0.5 ms, as `trajectory()` does, and records it every 1 ms.
 * Drag deceleration = (π/8)·ρ·|v−w|·Cd(M)·(v−w) / BC, with M from the air-relative speed.
 */
export function fly(o: FlyOptions): Path {
  const r = o.round;
  if (r.model !== 'G7') throw new Error('fly() only knows G7');
  const k = ((Math.PI / 8) * AIR.density) / (r.bc * 703.0696);
  const maxT = o.maxT ?? 3;
  const floor = o.floor ?? 300;
  const t0 = o.t0 ?? 0;
  const W: Vec3 = [0, 0, 0];
  const sp = o.spin ?? [0, 0, 0];
  // The air moves slowly next to the bullet: one wind sample per stored step (1 ms, under a metre) is plenty.
  const acc = (vx: number, vy: number, vz: number, a: Float64Array) => {
    const rx = vx - W[0], ry = vy - W[1], rz = vz - W[2];
    const v = Math.hypot(rx, ry, rz);
    const d = k * v * cdG7(v / AIR.sound);
    // Coriolis: −2 Ω × v.
    a[0] = -d * rx - 2 * (sp[1] * vz - sp[2] * vy);
    a[1] = -d * ry - 2 * (sp[2] * vx - sp[0] * vz) - AIR.g;
    a[2] = -d * rz - 2 * (sp[0] * vy - sp[1] * vx);
  };
  const h = 0.0005;
  const per = 2; // RK4 steps per stored sample
  const cap = Math.ceil(maxT / (h * per)) + 1;
  const pos = new Float64Array(cap * 3);
  const speed = new Float64Array(cap);
  let [x, y, z] = o.origin;
  let vx = o.dir[0] * o.mv, vy = o.dir[1] * o.mv, vz = o.dir[2] * o.mv;
  // Spin drift goes to the right of the line of fire, level.
  const hl = Math.hypot(o.dir[0], o.dir[2]) || 1;
  const rightX = -o.dir[2] / hl, rightZ = o.dir[0] / hl;
  const a1 = new Float64Array(3), a2 = new Float64Array(3), a3 = new Float64Array(3), a4 = new Float64Array(3);
  let n = 0;
  const store = (t: number) => {
    const sd = o.sg ? spinDriftM(o.sg, t) : 0;
    pos[n * 3] = x + rightX * sd;
    pos[n * 3 + 1] = y;
    pos[n * 3 + 2] = z + rightZ * sd;
    speed[n] = Math.hypot(vx, vy, vz);
    n++;
  };
  store(0);
  let t = 0;
  let tail = -1;
  while (n < cap && y > o.origin[1] - floor && tail !== 0) {
    if (o.wind) o.wind(x, y, z, t0 + t + h, W);
    for (let s = 0; s < per; s++) {
      acc(vx, vy, vz, a1);
      acc(vx + a1[0]! * h / 2, vy + a1[1]! * h / 2, vz + a1[2]! * h / 2, a2);
      const bx = vx + a2[0]! * h / 2, by = vy + a2[1]! * h / 2, bz = vz + a2[2]! * h / 2;
      acc(bx, by, bz, a3);
      const cx = vx + a3[0]! * h, cy = vy + a3[1]! * h, cz = vz + a3[2]! * h;
      acc(cx, cy, cz, a4);
      x += (vx + 2 * (vx + a1[0]! * h / 2) + 2 * bx + cx) * h / 6;
      y += (vy + 2 * (vy + a1[1]! * h / 2) + 2 * by + cy) * h / 6;
      z += (vz + 2 * (vz + a1[2]! * h / 2) + 2 * bz + cz) * h / 6;
      vx += (a1[0]! + 2 * a2[0]! + 2 * a3[0]! + a4[0]!) * h / 6;
      vy += (a1[1]! + 2 * a2[1]! + 2 * a3[1]! + a4[1]!) * h / 6;
      vz += (a1[2]! + 2 * a2[2]! + 2 * a3[2]! + a4[2]!) * h / 6;
      t += h;
    }
    store(t);
    if (tail > 0) tail--;
    else if (tail < 0 && o.until?.(x, y, z)) tail = 3;
  }
  return { dt: h * per, n, pos: pos.subarray(0, n * 3), speed: speed.subarray(0, n) };
}

/** Where the bullet is `t` seconds after leaving the muzzle (linear between samples). */
export function pathAt(p: Path, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const f = Math.max(0, Math.min(p.n - 1, t / p.dt));
  const i = Math.min(p.n - 2, Math.floor(f));
  const u = f - i;
  for (let c = 0; c < 3; c++) out[c] = p.pos[i * 3 + c]! + (p.pos[(i + 1) * 3 + c]! - p.pos[i * 3 + c]!) * u;
  return out;
}

export interface Hit {
  /** Time of flight to the hit. */
  t: number;
  pos: Vec3;
  /** Velocity at the hit. */
  vel: Vec3;
  speed: number;
  /** What was hit; the demo names its own objects. 'ground' for the terrain, 'none' if it flew out. */
  what: string;
}

/**
 * First thing the bullet hits along its path. `solid(a, b)` lets the caller test its own objects against
 * the segment from a to b and return the fraction along it, or null; the terrain `ground(x, z)` is tested
 * after it and its crossing found by bisection.
 */
export function firstHit(p: Path, ground: (x: number, z: number) => number, solid?: (a: Vec3, b: Vec3) => { f: number; what: string } | null): Hit {
  const a: Vec3 = [0, 0, 0];
  const b: Vec3 = [0, 0, 0];
  const at = (i: number, out: Vec3) => {
    out[0] = p.pos[i * 3]!;
    out[1] = p.pos[i * 3 + 1]!;
    out[2] = p.pos[i * 3 + 2]!;
    return out;
  };
  const make = (i: number, f: number, what: string): Hit => {
    at(i, a);
    at(i + 1, b);
    const pos: Vec3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    const vel: Vec3 = [(b[0] - a[0]) / p.dt, (b[1] - a[1]) / p.dt, (b[2] - a[2]) / p.dt];
    return { t: (i + f) * p.dt, pos, vel, speed: p.speed[i]! + (p.speed[i + 1]! - p.speed[i]!) * f, what };
  };
  for (let i = 0; i < p.n - 1; i++) {
    at(i, a);
    at(i + 1, b);
    const s = solid?.(a, b);
    // The terrain under the segment's end: if it is already below ground, find where it went in.
    const below = (f: number) => {
      const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f;
      return y < ground(x, z);
    };
    let g: number | null = null;
    if (below(1)) {
      let lo = 0, hi = 1;
      for (let k = 0; k < 24; k++) {
        const m = (lo + hi) / 2;
        if (below(m)) hi = m;
        else lo = m;
      }
      g = hi;
    }
    if (s && (g === null || s.f <= g)) return make(i, s.f, s.what);
    if (g !== null) return make(i, g, 'ground');
  }
  return make(p.n - 2, 1, 'none');
}

/** Seeded normal pairs (mulberry32 + Box–Muller), so a shot's dispersion is repeatable for stills. */
export function shotRandom(seed: number): () => number {
  let s = (seed * 0x9e3779b9) >>> 0;
  const uni = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    const u = Math.max(1e-12, uni());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uni());
  };
}

export interface Dispersion {
  /** Launch-angle error, right and up (rad). */
  dx: number;
  dy: number;
  /** Muzzle velocity this shot. */
  mv: number;
}

/** This shot's rifle-and-ammunition error: a normal cone of σ per axis, and a normal muzzle velocity. */
export function dispersion(rf: Rifle, seed: number): Dispersion {
  const n = shotRandom(seed + 1013);
  return { dx: n() * rf.sigmaRad, dy: n() * rf.sigmaRad, mv: ROUNDS[rf.round].mv + n() * rf.mvSd };
}
