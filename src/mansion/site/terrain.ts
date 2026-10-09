/**
 * Deterministic terrain height field: a flat lawn plateau around the house,
 * a wooded ridge along the sniper's perch arc, and gentle undulation.
 * Pure function of the TerrainSpec so the server, AI and renderer agree.
 */
import type { TerrainSpec } from '../core/types';

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function terrainHeight(t: TerrainSpec, x: number, z: number): number {
  // The lawn plateau round the house is flat: nothing to compute there.
  const r = Math.sqrt(x * x + z * z);
  if (r <= t.flatRadius) return 0;
  // Wooded ridge following the perch arc, so every bearing the sniper may pick looks down on the house.
  const rz = z - t.ridge.cz;
  const rho = Math.sqrt(x * x + rz * rz);
  const over = Math.max(0, Math.abs(Math.atan2(x, rz)) - t.ridge.halfAngle);
  const along = (over * t.ridge.radius) / 2.6;
  const across = rho - t.ridge.radius;
  const d = Math.sqrt(along * along + across * across);
  const rise = t.perchRise * (1 - smooth(0, 95, d));
  // Plateau mask: zero near the house, full beyond.
  const mask = smooth(t.flatRadius, t.flatRadius + 60, r);
  const n = (valueNoise(x / 55, z / 55, t.seed) - 0.5) * 2 + (valueNoise(x / 19, z / 19, t.seed + 7) - 0.5) * 0.5;
  return (rise + n * t.undulation) * mask;
}
