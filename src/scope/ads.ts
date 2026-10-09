/**
 * Scope-in and scope-out, prone with the rifle on its bipod: the rifle stays put and the head moves. Going
 * in, the head drops from looking over the scope onto the cheek weld until the eye sits in the exit pupil;
 * going out, it lifts back up. Eye offsets are in millimetres in the frame of `Eye` in optics.ts (x right,
 * y up, z behind the exit pupil), times in seconds.
 *
 * The motion follows the motor-control literature on aimed movements:
 *  - every stroke is minimum-jerk (Flash & Hogan 1985): a quintic with a bell-shaped speed profile;
 *  - an aimed movement is a fast primary stroke that lands near the goal, then a slower corrective stroke
 *    that overlaps it (Meyer et al. 1988). Going in, the primary lands a few millimetres high and too far
 *    back, so the picture first shows as a crescent and then fills as the eye settles;
 *  - the cheek lands on the comb before the eye reaches the eyebox, and the soft tissue gives a fraction of
 *    a millimetre under the head's weight;
 *  - the gaze stays on the target throughout (the vestibulo-ocular reflex cancels head rotation), except for
 *    a small residual roll as the head cants onto the stock, because torsional VOR gain is only about 0.6.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/** Head up, looking over the scope at the target: eye above the turret line and back off the eyepiece. */
export const HEAD_UP: Vec3 = { x: 4, y: 62, z: 36 };
/** On the cheek weld, eye in the exit pupil at full eye relief. */
export const ON_WELD: Vec3 = { x: 0, y: 0, z: 0 };

/** One minimum-jerk stroke by `d`, starting at `t0` with velocity `v0` (mm/s) and ending at rest. */
interface Stroke {
  t0: number;
  T: number;
  d: Vec3;
  v0: Vec3;
}

export interface AdsMotion {
  dir: 'in' | 'out';
  start: number;
  base: Vec3;
  strokes: Stroke[];
  /** Cheek meets the comb: time after start, and how far the tissue gives (mm). */
  contact: number;
  squash: number;
  /** Residual view roll at the peak of the move, and the span it builds and dies over. */
  roll: number;
  rollT: number;
  /** After this the eye is where the motion leaves it. */
  duration: number;
}

/**
 * Quintic with p(0)=0, p'(0)=v0, p''(0)=0, p(T)=h, p'(T)=p''(T)=0. With v0 = 0 it is the minimum-jerk
 * profile 10s³ − 15s⁴ + 6s⁵. A non-zero v0 lets a stroke start from a head that is still moving.
 */
function quintic(h: number, v0: number, T: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= T) return h;
  const s = t / T;
  const H = h - v0 * T;
  const V = -v0 * T;
  const c3 = 10 * H - 4 * V;
  const c4 = -15 * H + 7 * V;
  const c5 = 6 * H - 3 * V;
  return v0 * T * s + s * s * s * (c3 + s * (c4 + s * c5));
}

/** x·e^(1−x): rises to 1 at x = 1 and dies away. */
const pulse = (x: number) => (x <= 0 ? 0 : x * Math.exp(1 - x));

/** Deterministic 0…1 values for the n-th move, so every scope-in lands a little differently. */
function rnd(n: number, k: number): number {
  let h = Math.imul(n + 11, 0x27d4eb2d) ^ Math.imul(k + 3, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Head down onto the weld from `from` (moving at `vel` mm/s if a scope-out is interrupted).
 * Primary stroke ~0.45 s, lands 0.5–1.7 mm high, ±1.2 mm sideways and 6–12 mm too far back; the
 * corrective stroke starts before it ends and takes the eye home in another ~0.25 s.
 */
export function planScopeIn(start: number, from: Vec3, vel: Vec3, n: number): AdsMotion {
  const r = (k: number) => rnd(n, k);
  const Tp = 0.45 * (0.9 + 0.2 * r(1));
  const land: Vec3 = { x: (r(2) - 0.5) * 2.4, y: 0.5 + 1.2 * r(3), z: 6 + 6 * r(4) };
  const Tc = 0.26 * (0.9 + 0.2 * r(5));
  const tc = 0.8 * Tp;
  const strokes: Stroke[] = [
    // Down first, forward later: the head drops, then the cheek slides forward along the comb.
    { t0: 0, T: Tp, d: { x: land.x - from.x, y: land.y - from.y, z: 0 }, v0: { x: vel.x, y: vel.y, z: 0 } },
    { t0: 0, T: Tp + 0.08, d: { x: 0, y: 0, z: land.z - from.z }, v0: { x: 0, y: 0, z: vel.z } },
    { t0: tc, T: Tc, d: sub(ON_WELD, land), v0: ZERO },
  ];
  return {
    dir: 'in', start, base: { ...from }, strokes,
    contact: 0.85 * Tp, squash: 0.5 + 0.4 * r(6),
    roll: 1.1 * DEG * (0.8 + 0.4 * r(7)), rollT: Tp + 0.15,
    duration: Math.max(Tp + 0.08, tc + Tc) + 0.05,
  };
}

/** Head up off the weld: the cheek peels off first, so the eye backs off before it rises. ~0.4 s. */
export function planScopeOut(start: number, from: Vec3, vel: Vec3, n: number): AdsMotion {
  const r = (k: number) => rnd(n, k + 20);
  const T = 0.36 * (0.9 + 0.2 * r(1));
  const to: Vec3 = { x: HEAD_UP.x + (r(2) - 0.5) * 4, y: HEAD_UP.y * (0.92 + 0.16 * r(3)), z: HEAD_UP.z * (0.9 + 0.2 * r(4)) };
  const d = sub(to, from);
  const strokes: Stroke[] = [
    { t0: 0, T: T * 0.9, d: { x: 0, y: 0, z: d.z }, v0: { x: 0, y: 0, z: vel.z } },
    { t0: 0.04, T, d: { x: d.x, y: d.y, z: 0 }, v0: { x: vel.x, y: vel.y, z: 0 } },
  ];
  return {
    dir: 'out', start, base: { ...from }, strokes,
    contact: -1, squash: 0,
    roll: -0.8 * DEG * (0.8 + 0.4 * r(5)), rollT: T + 0.1,
    duration: T + 0.1,
  };
}

/** Eye offset from the exit pupil `t` seconds into the clock (absolute time, like `start`). */
export function adsEye(m: AdsMotion, t: number): Vec3 {
  const s = t - m.start;
  const p = { ...m.base };
  for (const k of m.strokes) {
    const u = s - k.t0;
    p.x += quintic(k.d.x, k.v0.x, k.T, u);
    p.y += quintic(k.d.y, k.v0.y, k.T, u);
    p.z += quintic(k.d.z, k.v0.z, k.T, u);
  }
  if (m.contact > 0) p.y -= m.squash * pulse((s - m.contact) / 0.035);
  return p;
}

/** Eye velocity (mm/s), for starting a new move from one still in progress. */
export function adsVelocity(m: AdsMotion, t: number): Vec3 {
  const h = 0.002;
  const a = adsEye(m, t - h);
  const b = adsEye(m, t + h);
  return { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h), z: (b.z - a.z) / (2 * h) };
}

/** Residual roll of the view (radians, counter-clockwise): builds and dies away within the move. */
export function adsRoll(m: AdsMotion, t: number): number {
  const s = (t - m.start) / m.rollT;
  if (s <= 0 || s >= 1) return 0;
  return m.roll * Math.sin(Math.PI * s) ** 2;
}
