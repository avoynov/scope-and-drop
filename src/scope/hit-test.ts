/**
 * The safety margin's hit test (armoury task 11): how far a bullet's path passed from the spy's torso, and where it
 * would be redirected to if the margin counts it. Pure geometry in the body's own frame (src/body/anatomy.ts: origin
 * between the feet, y up, z the way the person faces); the caller moves the path into that frame and back.
 *
 *  - The miss is the path's closest approach to the torso (shoulders to hips, `inTorso`), perpendicular to the path:
 *    the smallest radius at which a ring of 16 points round the path touches the torso, bracketed a centimetre at a
 *    time and found by bisection. Divided by
 *    the slant range from the muzzle to that point it is the miss in mrad, the same skill at any range.
 *  - A margin hit is redirected to the torso point the ring touched, and enters there along the path's direction.
 *    Whether the straight piece from the path to that point is clear (no wall, pane, furniture or other person) is
 *    the caller's: it knows the scene.
 *  - `Shot.miss` in demo/reticle/shooting.ts (an offset in the target's plane) is the readout's, not this.
 */
import { inTorso, TORSO_BASE, TORSO_TOP, type Vec3 } from "../body/anatomy";

/** Points on the ring round the path. */
export const RING = 16;
/** The torso's bounds in the body frame (m): half-width and half-depth at their widest, with a little to spare. */
const BOX = { x: 0.23, z: 0.17, y0: TORSO_BASE, y1: TORSO_TOP };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** How far p lies outside the torso's box (m), 0 inside it. */
const boxGap = (p: Vec3) => Math.hypot(Math.max(0, Math.abs(p[0]) - BOX.x), Math.max(0, BOX.y0 - p[1], p[1] - BOX.y1), Math.max(0, Math.abs(p[2]) - BOX.z));

/** Points along a polyline no more than `stepM` apart. */
export function densify(points: readonly Vec3[], stepM = 0.01): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const n = Math.max(1, Math.ceil(len(sub(b, a)) / stepM));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  if (points.length) out.push([...points[points.length - 1]!] as Vec3);
  return out;
}

/** The ring's two directions square to the path's direction `d`. */
function ringBasis(d: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(d, ref));
  return [u, cross(d, u)];
}

export interface Approach {
  /** The closest approach to the torso, perpendicular to the path (m); 0 if the path goes through it. */
  missM: number;
  /** The point on the path where it came closest. */
  at: Vec3;
  /** The torso point the ring touched there: where a margin hit is redirected to. */
  touch: Vec3;
  /** The path's direction there. */
  dir: Vec3;
}

/**
 * The path's closest approach to the torso, by bisection on the radius of a ring of RING points round the path.
 * `path` is in the body frame and dense (see `densify`). Null if it passes farther than `maxM` from the torso.
 */
export function closestApproach(path: readonly Vec3[], maxM = 2): Approach | null {
  const n = path.length;
  if (n < 2) return null;
  const near: number[] = [];
  for (let i = 0; i < n; i++) if (boxGap(path[i]!) <= maxM) near.push(i);
  if (!near.length) return null;
  const dirAt = (i: number) => norm(sub(path[Math.min(n - 1, i + 1)]!, path[Math.max(0, i - 1)]!));
  const bases = new Map<number, [Vec3, Vec3]>();
  const basis = (i: number) => {
    let b = bases.get(i);
    if (!b) bases.set(i, (b = ringBasis(dirAt(i))));
    return b;
  };
  /** The first ring point (path index, the point) inside the torso at radius r, or null. */
  const touches = (r: number): { i: number; p: Vec3 } | null => {
    for (const i of near) {
      const c = path[i]!;
      if (boxGap(c) > r) continue;
      if (r === 0) {
        if (inTorso(c)) return { i, p: c };
        continue;
      }
      const [u, v] = basis(i);
      for (let k = 0; k < RING; k++) {
        const a = (2 * Math.PI * k) / RING;
        const ca = Math.cos(a) * r;
        const sa = Math.sin(a) * r;
        const p: Vec3 = [c[0] + u[0] * ca + v[0] * sa, c[1] + u[1] * ca + v[1] * sa, c[2] + u[2] * ca + v[2] * sa];
        if (inTorso(p)) return { i, p };
      }
    }
    return null;
  };
  const through = touches(0);
  if (through) return { missM: 0, at: through.p, touch: through.p, dir: dirAt(through.i) };
  // A ring touches only between the torso's near and far sides, so step out a centimetre at a time to the first
  // ring that touches, then bisect between it and the last that didn't.
  const STEP = 0.01;
  let hi = 0;
  // No ring smaller than the path's nearest approach to the torso's box can reach it.
  const gap = Math.min(...near.map((i) => boxGap(path[i]!)));
  for (let r = Math.max(STEP, Math.floor(gap / STEP) * STEP); r <= maxM + 1e-9; r += STEP)
    if (touches(r)) {
      hi = r;
      break;
    }
  if (hi === 0) return null;
  let lo = hi - STEP;
  for (let it = 0; it < 30 && hi - lo > 1e-4; it++) {
    const mid = (lo + hi) / 2;
    if (touches(mid)) hi = mid;
    else lo = mid;
  }
  const t = touches(hi)!;
  return { missM: hi, at: path[t.i]!, touch: t.p, dir: dirAt(t.i) };
}

/** The angle (mrad) at the muzzle between a point and another. */
export function angleMrad(muzzle: Vec3, a: Vec3, b: Vec3): number {
  const da = norm(sub(a, muzzle));
  const db = norm(sub(b, muzzle));
  return Math.acos(Math.max(-1, Math.min(1, da[0] * db[0] + da[1] * db[1] + da[2] * db[2]))) * 1000;
}

/** The chest centre the margin's quality is measured from, in the body frame (1.15 m above the feet). */
export const CHEST: Vec3 = [0, 1.15, 0];

/** The point on the path nearest the chest centre (for a miss's distance from it). */
export function nearestTo(path: readonly Vec3[], q: Vec3): Vec3 {
  let best = path[0]!;
  let bd = Infinity;
  for (const p of path) {
    const d = len(sub(p, q));
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/**
 * Entries for a redirected bullet, best first: the touched point, then points a little further in toward the torso's
 * axis (2, 4, 6, 8 cm across the path), each taken back along the path to where it meets the torso's surface. The
 * wound model is run on them in turn, so an entry can be found whose result matches the margin's draw.
 */
export function redirectEntries(a: Approach, steps = [0, 0.02, 0.04, 0.06, 0.08]): Vec3[] {
  const d = a.dir;
  // Across the path, from the touched point toward the torso's axis at its height.
  const axis: Vec3 = [0, a.touch[1], 0];
  let inward = sub(axis, a.touch);
  const along = inward[0] * d[0] + inward[1] * d[1] + inward[2] * d[2];
  inward = norm([inward[0] - d[0] * along, inward[1] - d[1] * along, inward[2] - d[2] * along]);
  const out: Vec3[] = [];
  for (const s of steps) {
    let p: Vec3 = [a.touch[0] + inward[0] * s, a.touch[1] + inward[1] * s, a.touch[2] + inward[2] * s];
    if (!inTorso(p)) continue;
    // Back along the path to the surface, a millimetre at a time.
    for (let k = 0; k < 600 && inTorso(p); k++) p = [p[0] - d[0] * 0.001, p[1] - d[1] * 0.001, p[2] - d[2] * 0.001];
    out.push(p);
  }
  return out;
}
