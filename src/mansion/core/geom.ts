/** Small 2D/3D helpers. Plan coordinates are (x, z) in metres; y is up. */

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Axis-aligned rectangle in plan, x0 < x1, z0 < z1. */
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const EPS = 1e-6;

export function rect(x0: number, z0: number, x1: number, z1: number): Rect {
  return {
    x0: Math.min(x0, x1),
    z0: Math.min(z0, z1),
    x1: Math.max(x0, x1),
    z1: Math.max(z0, z1),
  };
}

export const rw = (r: Rect): number => r.x1 - r.x0;
export const rd = (r: Rect): number => r.z1 - r.z0;
export const area = (r: Rect): number => rw(r) * rd(r);
export const center = (r: Rect): Vec2 => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });

export function inset(r: Rect, d: number): Rect {
  return { x0: r.x0 + d, z0: r.z0 + d, x1: r.x1 - d, z1: r.z1 - d };
}

export function expand(r: Rect, dx: number, dz = dx): Rect {
  return { x0: r.x0 - dx, z0: r.z0 - dz, x1: r.x1 + dx, z1: r.z1 + dz };
}

export function overlaps(a: Rect, b: Rect, tol = EPS): boolean {
  return a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.z0 < b.z1 - tol && b.z0 < a.z1 - tol;
}

export function containsPoint(r: Rect, x: number, z: number, tol = 0): boolean {
  return x >= r.x0 - tol && x <= r.x1 + tol && z >= r.z0 - tol && z <= r.z1 + tol;
}

export function containsRect(outer: Rect, inner: Rect, tol = EPS): boolean {
  return (
    inner.x0 >= outer.x0 - tol &&
    inner.x1 <= outer.x1 + tol &&
    inner.z0 >= outer.z0 - tol &&
    inner.z1 <= outer.z1 + tol
  );
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const r = { x0: Math.max(a.x0, b.x0), z0: Math.max(a.z0, b.z0), x1: Math.min(a.x1, b.x1), z1: Math.min(a.z1, b.z1) };
  return r.x1 > r.x0 + EPS && r.z1 > r.z0 + EPS ? r : null;
}

/** Overlap of 1D intervals [a0,a1] and [b0,b1]; null when they only touch. */
export function overlap1(a0: number, a1: number, b0: number, b1: number, tol = EPS): [number, number] | null {
  const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  return hi > lo + tol ? [lo, hi] : null;
}

export const near = (a: number, b: number, tol = 1e-4): boolean => Math.abs(a - b) <= tol;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Round for compact, stable JSON output. */
export function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Rotate a plan offset by a yaw angle (radians, counter-clockwise looking down -y... i.e. three.js rotation.y). */
export function rotateY(x: number, z: number, yaw: number): Vec2 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/** Footprint rect of a box of width w (local x) and depth d (local z) rotated by a multiple of 90°. */
export function footprint(cx: number, cz: number, w: number, d: number, yaw: number): Rect {
  const q = Math.round(yaw / (Math.PI / 2)) & 1;
  const hw = (q ? d : w) / 2;
  const hd = (q ? w : d) / 2;
  return { x0: cx - hw, z0: cz - hd, x1: cx + hw, z1: cz + hd };
}
