/**
 * The mansion's site in the wind's way (src/scope/wind.ts): every mass of the house a solid box up to half way
 * up its roof, every tree a porous crown. `matchWind` bakes them, with the terrain, once before the match.
 */
import { shelterWind, terrainWind, type Obstacle, type Wind } from '../../scope/wind';
import type { MansionBlueprint, Tree } from '../core/types';
import { terrainHeight } from './terrain';

/** Share of the air a crown in leaf lets through: broadleaves about half, the dense conifers less. */
const POROSITY: Record<Tree['kind'], number> = { oak: 0.45, beech: 0.4, poplar: 0.5, cedar: 0.3, cypress: 0.25, yew: 0.2 };

export function windObstacles(bp: MansionBlueprint): Obstacle[] {
  const out: Obstacle[] = [];
  for (const m of bp.masses) {
    const { x0, z0, x1, z1 } = m.rect;
    const w = x1 - x0, d = z1 - z0;
    // A pitched roof stands in the wind like a wall about half its rise higher than the eaves.
    const rise = m.roof.kind === 'flat' ? 0 : (Math.tan((m.roof.pitchDeg * Math.PI) / 180) * Math.min(w, d)) / 2;
    out.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: w / 2, hz: d / 2, base: 0, height: m.roof.eaveY + rise / 2, porosity: 0 });
  }
  for (const t of bp.site.trees) out.push({ x: t.x, z: t.z, r: t.crown, base: t.y, height: t.height, porosity: POROSITY[t.kind] });
  return out;
}

/**
 * The match's wind over this site: `speed` m/s at 3 m, blowing from `fromClock` in the scene frame (12 is from
 * -z, the house's side as seen from a perch on the garden axis; 9 from -x), gusting by `gust`. The terrain and
 * the shelter of the house and the trees are baked in, once per match.
 */
export function matchWind(bp: MansionBlueprint, speed: number, fromClock: number, gust = 0.3): Wind {
  const height = (x: number, z: number) => terrainHeight(bp.site.terrain, x, z);
  const obstacles = windObstacles(bp);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const o of obstacles) {
    const r = o.r ?? Math.max(o.hx!, o.hz!);
    x0 = Math.min(x0, o.x - r); x1 = Math.max(x1, o.x + r);
    z0 = Math.min(z0, o.z - r); z1 = Math.max(z1, o.z + r);
  }
  const pad = 60;
  return {
    speed,
    fromClock,
    gust,
    terrain: terrainWind(height, x0 - pad, z0 - pad, x1 + pad, z1 + pad, 8),
    shelter: shelterWind(obstacles, fromClock, height, x0 - pad, z0 - pad, x1 + pad, z1 + pad, 4),
  };
}
