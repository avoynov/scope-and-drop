/** Tileable noise for texture synthesis. All functions wrap at `period` lattice units. */

export function hash2i(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Periodic value noise in [0,1]. */
export function vnoise(x: number, y: number, period: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = mod(ix, period);
  const y0 = mod(iy, period);
  const x1 = mod(ix + 1, period);
  const y1 = mod(iy + 1, period);
  const a = hash2i(x0, y0, seed);
  const b = hash2i(x1, y0, seed);
  const c = hash2i(x0, y1, seed);
  const d = hash2i(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Periodic fBm in [0,1] (approximately). */
export function fbm(x: number, y: number, period: number, octaves = 5, seed = 0, gain = 0.5): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * f, y * f, period * f, seed + i * 17);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Periodic Worley noise: [F1, F2, cell id]. */
export function worley(x: number, y: number, period: number, seed = 0, jitter = 0.9): [number, number, number] {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const wx = mod(cx, period);
      const wy = mod(cy, period);
      const px = cx + 0.5 + (hash2i(wx, wy, seed) - 0.5) * jitter;
      const py = cy + 0.5 + (hash2i(wx, wy, seed + 1) - 0.5) * jitter;
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2i(wx, wy, seed + 2);
      } else if (d < f2) f2 = d;
    }
  }
  return [f1, f2, id];
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
