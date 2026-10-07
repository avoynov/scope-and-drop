/**
 * Site (stage 6): raised garden terrace, formal parterre, fountain, tree belts
 * that frame the vista without blocking it, the sniper's perch on a wooded
 * rise, and blue-hour sky parameters.
 */
import { rect, type Rect, type Vec2 } from '../core/geom';
import { snap, type Rng } from '../core/rng';
import type { LightSpec, Perch, Portico, Prop, Site, SkySpec, StyleDef, Terrace, TerrainSpec, Tree } from '../core/types';
import type { MassingPlan } from '../layout/massing';
import { terrainHeight } from './terrain';

export interface SiteInput {
  rng: Rng;
  m: MassingPlan;
  style: StyleDef;
  porticos: Portico[];
  /** Plan bounds of all masses. */
  footprint: Rect;
  perchDistance?: number;
  perchAzimuthDeg?: number;
}

export interface SiteOutput {
  site: Site;
  props: Prop[];
  lights: LightSpec[];
}

/** Bridson Poisson-disc sampling inside a rect (deterministic given rng). */
export function poissonDisc(rng: Rng, area: Rect, minDist: number, accept: (x: number, z: number) => boolean, max = 400): Vec2[] {
  const cell = minDist / Math.SQRT2;
  const cols = Math.max(1, Math.ceil((area.x1 - area.x0) / cell));
  const rows = Math.max(1, Math.ceil((area.z1 - area.z0) / cell));
  const grid = new Int32Array(cols * rows).fill(-1);
  const pts: Vec2[] = [];
  const active: number[] = [];
  const put = (p: Vec2) => {
    const c = Math.floor((p.x - area.x0) / cell);
    const r = Math.floor((p.z - area.z0) / cell);
    grid[r * cols + c] = pts.length;
    pts.push(p);
    active.push(pts.length - 1);
  };
  const far = (p: Vec2): boolean => {
    const c = Math.floor((p.x - area.x0) / cell);
    const r = Math.floor((p.z - area.z0) / cell);
    for (let j = Math.max(0, r - 2); j <= Math.min(rows - 1, r + 2); j++) {
      for (let i = Math.max(0, c - 2); i <= Math.min(cols - 1, c + 2); i++) {
        const k = grid[j * cols + i]!;
        if (k >= 0) {
          const q = pts[k]!;
          if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < minDist * minDist) return false;
        }
      }
    }
    return true;
  };
  for (let s = 0; s < 30 && pts.length === 0; s++) {
    const p = { x: rng.range(area.x0, area.x1), z: rng.range(area.z0, area.z1) };
    if (accept(p.x, p.z)) put(p);
  }
  while (active.length && pts.length < max) {
    const ai = rng.int(0, active.length - 1);
    const base = pts[active[ai]!]!;
    let found = false;
    for (let k = 0; k < 18; k++) {
      const ang = rng.range(0, Math.PI * 2);
      const rad = rng.range(minDist, 2 * minDist);
      const p = { x: base.x + Math.cos(ang) * rad, z: base.z + Math.sin(ang) * rad };
      if (p.x < area.x0 || p.x >= area.x1 || p.z < area.z0 || p.z >= area.z1) continue;
      if (!far(p) || !accept(p.x, p.z)) continue;
      put(p);
      found = true;
      break;
    }
    if (!found) active.splice(ai, 1);
  }
  return pts;
}

const TREE_SIZES: Record<Tree['kind'], { h: [number, number]; c: [number, number] }> = {
  oak: { h: [15, 21], c: [6, 8.5] },
  beech: { h: [18, 26], c: [5, 7.5] },
  cedar: { h: [17, 24], c: [7, 10] },
  cypress: { h: [11, 17], c: [1.4, 2.2] },
  yew: { h: [6, 10], c: [2.8, 4] },
  poplar: { h: [20, 28], c: [2.4, 3.4] },
};

export function planSite(input: SiteInput): SiteOutput {
  const { rng, m, footprint } = input;
  const props: Prop[] = [];
  const lights: LightSpec[] = [];
  let pid = 0;
  let lid = 0;
  const warm = (k: number): [number, number, number] => [1, 0.62 + 0.08 * k, 0.32 + 0.1 * k];

  /* ---------------- Terrace ---------------- */
  const gardenPortico = input.porticos.find((p) => p.side === 'garden');
  const pav = m.gardenPavilion?.depth ?? 0;
  const gardenWing = m.wings.find((w) => w.toward === 'garden');
  const frontMost = Math.max(m.zGarden + pav, gardenPortico ? gardenPortico.rect.z1 : -Infinity, gardenWing ? gardenWing.rect.z1 : -Infinity);
  const td = snap(rng.range(gardenWing ? 4.5 : 6.5, gardenWing ? 7.5 : 10.5), 0.1);
  const ext = snap(gardenWing ? rng.range(2.0, 4.0) : rng.range(0.0, 3.0), 0.1);
  const tx0 = Math.min(-m.W / 2, footprint.x0) - ext;
  const tx1 = Math.max(m.W / 2, footprint.x1) + ext;
  const tz1 = snap(frontMost + td, 0.01);
  const terraceY = snap(m.groundFloorY - 0.15, 0.01);
  const stepCount = Math.max(3, Math.ceil(terraceY / 0.155));
  const stepRun = snap(stepCount * 0.4, 0.01);
  const stepW = snap(Math.max(gardenPortico ? gardenPortico.rect.x1 - gardenPortico.rect.x0 : 0, rng.range(5.5, 9)), 0.1);
  const terrace: Terrace = {
    rect: rect(tx0, m.zGarden - 0.3, tx1, tz1),
    y: terraceY,
    balustrades: [
      { a: { x: tx0, z: tz1 }, b: { x: -stepW / 2, z: tz1 }, height: 1.0 },
      { a: { x: stepW / 2, z: tz1 }, b: { x: tx1, z: tz1 }, height: 1.0 },
    ],
    steps: [{ rect: rect(-stepW / 2, tz1, stepW / 2, tz1 + stepRun), dir: '+z', y0: terraceY, y1: 0, count: stepCount }],
  };
  // Side balustrades run back to the façade; optional side stairs halfway.
  const sideSteps = rng.chance(0.5);
  for (const sx of [tx0, tx1]) {
    const back = m.zGarden;
    if (sideSteps) {
      const zc = (back + tz1) / 2;
      const sw = 3.2;
      terrace.balustrades.push({ a: { x: sx, z: back }, b: { x: sx, z: zc - sw / 2 }, height: 1.0 });
      terrace.balustrades.push({ a: { x: sx, z: zc + sw / 2 }, b: { x: sx, z: tz1 }, height: 1.0 });
      const dir = sx < 0 ? '-x' : '+x';
      terrace.steps.push({
        rect: sx < 0 ? rect(sx - stepRun, zc - sw / 2, sx, zc + sw / 2) : rect(sx, zc - sw / 2, sx + stepRun, zc + sw / 2),
        dir,
        y0: terraceY,
        y1: 0,
        count: stepCount,
      });
    } else {
      terrace.balustrades.push({ a: { x: sx, z: back }, b: { x: sx, z: tz1 }, height: 1.0 });
    }
  }

  /* ---------------- Formal garden ---------------- */
  const walkZ0 = tz1 + stepRun;
  const fountainZ = snap(walkZ0 + rng.range(24, 38), 0.1);
  const fountainR = snap(rng.range(3.5, 6.5), 0.1);
  const pathW = snap(Math.min(stepW, rng.range(4, 6.5)), 0.1);
  const gardenEnd = fountainZ + fountainR + rng.range(18, 34);
  const paths: Site['paths'] = [
    { rect: rect(tx0 - 2, walkZ0, tx1 + 2, walkZ0 + 3.2), kind: 'gravel' },
    { rect: rect(-pathW / 2, walkZ0, pathW / 2, gardenEnd), kind: 'gravel' },
    { rect: rect(-fountainR - 16, fountainZ - 1.6, fountainR + 16, fountainZ + 1.6), kind: 'gravel' },
  ];
  const parterres: Site['parterres'] = [];
  const topiary: Site['topiary'] = [];
  const pattern = rng.pick(['cross', 'diamond', 'ring', 'quarters'] as const);
  const bedW = snap(rng.range(9, 15), 0.1);
  const bedZ0 = walkZ0 + 5;
  const bedZ1 = fountainZ - fountainR - 4;
  const split = bedZ1 - bedZ0 > 22 && rng.chance(0.6);
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -pathW / 2 - 2.5 - bedW : pathW / 2 + 2.5;
    const zs = split ? [bedZ0, (bedZ0 + bedZ1) / 2 - 1.5, (bedZ0 + bedZ1) / 2 + 1.5, bedZ1] : [bedZ0, bedZ1];
    for (let i = 0; i + 1 < zs.length; i += 2) {
      const r = rect(x0, zs[i]!, x0 + bedW, zs[i + 1]!);
      if (r.z1 - r.z0 < 5) continue;
      parterres.push({ rect: r, pattern });
      for (const [cx, cz] of [
        [r.x0, r.z0],
        [r.x1, r.z0],
        [r.x0, r.z1],
        [r.x1, r.z1],
      ] as const) {
        topiary.push({ x: cx, z: cz, height: 1.7, radius: 0.55, shape: 'cone' });
      }
    }
  }
  for (const sx of [-stepW / 2 - 1.2, stepW / 2 + 1.2]) topiary.push({ x: sx, z: walkZ0 + 1.6, height: 2.3, radius: 0.75, shape: rng.pick(['cone', 'ball', 'spiral'] as const) });

  /* ---------------- Exterior props + lights ---------------- */
  const lamp = (x: number, z: number, y: number) => {
    props.push({ id: `px${pid++}`, kind: 'lamppost', roomId: null, level: 0, x, y, z, yaw: 0, w: 0.5, d: 0.5, h: 3.4, variant: 0, mount: 'floor', blocksNav: true, occludes: false });
    lights.push({ id: `lx${lid++}`, kind: 'lamppost', scope: 'exterior', x, y: y + 3.25, z, color: warm(0.2), intensity: 160, range: 18 });
  };
  lamp(-stepW / 2 - 0.5, tz1 - 0.6, terraceY);
  lamp(stepW / 2 + 0.5, tz1 - 0.6, terraceY);
  for (let z = walkZ0 + 8; z < fountainZ - fountainR - 3; z += 14) {
    lamp(-pathW / 2 - 0.9, z, 0);
    lamp(pathW / 2 + 0.9, z, 0);
  }
  // Urns on the balustrade piers.
  for (const b of terrace.balustrades) {
    for (const p of [b.a, b.b]) {
      props.push({ id: `px${pid++}`, kind: 'urn', roomId: null, level: 0, x: p.x, y: terraceY + b.height, z: p.z, yaw: 0, w: 0.6, d: 0.6, h: 0.9, variant: 0, mount: 'floor', blocksNav: false, occludes: false });
    }
  }
  if (gardenPortico) {
    for (const c of gardenPortico.columns) {
      // Floodlights a little in front of each column: they wash the shaft, not the paving.
      lights.push({
        id: `lx${lid++}`,
        kind: 'uplight',
        scope: 'exterior',
        x: c.x,
        y: gardenPortico.baseY + 0.25,
        z: c.z + gardenPortico.columnRadius + 0.7,
        color: warm(0.5),
        intensity: 140,
        range: 14,
        dir: [0, 0.94, -0.34],
        cone: 0.9,
      });
    }
  }
  lights.push({ id: `lx${lid++}`, kind: 'uplight', scope: 'exterior', x: 0, y: 0.6, z: fountainZ, color: [1, 0.86, 0.66], intensity: 90, range: fountainR + 8 });

  /* ---------------- Perch, terrain, sky ---------------- */
  const dist = snap(input.perchDistance ?? rng.range(135, 205), 0.1);
  const az = snap(input.perchAzimuthDeg ?? rng.range(-24, 24), 0.1);
  const azr = (az * Math.PI) / 180;
  const px = snap(Math.sin(azr) * dist, 0.01);
  const pz = snap(m.zGarden + Math.cos(azr) * dist, 0.01);
  const fountainReach = Math.hypot(fountainR + 20, gardenEnd);
  const terrain: TerrainSpec = {
    flatRadius: snap(Math.min(dist - 55, Math.max(70, fountainReach + 8)), 0.1),
    perchRise: snap(rng.range(4, 11), 0.1),
    crest: { x: snap(px + Math.sin(azr) * 7, 0.01), z: snap(pz + Math.cos(azr) * 7, 0.01) },
    undulation: snap(rng.range(0.3, 0.9), 0.01),
    seed: rng.int(1, 1 << 20),
  };
  const groundAtPerch = terrainHeight(terrain, px, pz);
  const target = { x: 0, y: snap(m.groundFloorY + 3.0, 0.01), z: m.zGarden };
  let eyeY = groundAtPerch + 0.55;
  // Make sure the brow of the hill does not cut the sightline; the sniper lies on a mound if needed.
  const torsoY = m.groundFloorY + 1.3;
  let lift = 0;
  for (let i = 1; i < 40; i++) {
    const t = i / 40;
    const x = px + (0 - px) * t;
    const z = pz + (m.zGarden - pz) * t;
    const rayY = eyeY + (torsoY - eyeY) * t;
    lift = Math.max(lift, terrainHeight(terrain, x, z) + 0.3 - rayY);
  }
  eyeY += Math.min(2.5, Math.max(0, lift) * 1.15);
  const perch: Perch = {
    eye: { x: px, y: snap(eyeY, 0.01), z: pz },
    target,
    distance: dist,
    azimuthDeg: az,
    fovMinDeg: 1.2,
    fovMaxDeg: 24,
  };
  const sunSide = rng.chance(0.5) ? 1 : -1;
  const sunAz = snap(180 + sunSide * rng.range(22, 60), 0.1);
  const sky: SkySpec = {
    sunAzimuthDeg: sunAz,
    sunElevationDeg: snap(rng.range(-6.5, -3.0), 0.1),
    moonAzimuthDeg: snap(sunAz - sunSide * rng.range(12, 34), 0.1),
    moonElevationDeg: snap(rng.range(9, 21), 0.1),
    cloudiness: snap(rng.range(0.1, 0.55), 0.01),
  };

  /* ---------------- Trees ---------------- */
  // Keep the cone from the eye to the façade (plus margin) clear.
  const eye = perch.eye;
  const fx0 = Math.min(footprint.x0, tx0) - 8;
  const fx1 = Math.max(footprint.x1, tx1) + 8;
  const angOf = (x: number, z: number) => Math.atan2(x - eye.x, eye.z - z);
  const aA = angOf(fx0, m.zGarden);
  const aB = angOf(fx1, m.zGarden);
  const aLo = Math.min(aA, aB);
  const aHi = Math.max(aA, aB);
  const coneDist = Math.hypot(eye.x, eye.z - footprint.z0) + 5;
  const inCone = (x: number, z: number, r: number): boolean => {
    const d = Math.hypot(x - eye.x, z - eye.z);
    if (d < 6 + r) return true; // the sniper's own spot
    if (z > eye.z + r) return false; // behind the sniper
    if (d > coneDist) return false; // behind the house
    const a = angOf(x, z);
    const margin = Math.asin(Math.min(1, (r + 2.5) / d));
    return a > aLo - margin && a < aHi + margin;
  };
  const trees: Tree[] = [];
  const nearHouse = (x: number, z: number, r: number) =>
    x > footprint.x0 - 6 - r && x < footprint.x1 + 6 + r && z > footprint.z0 - 6 - r && z < tz1 + stepRun + 6 + r;
  const nearGarden = (x: number, z: number, r: number) => x > -fountainR - 26 - r && x < fountainR + 26 + r && z > walkZ0 - 2 && z < gardenEnd + 4 + r;
  const addTrees = (area: Rect, minDist: number, kinds: Tree['kind'][], cap: number) => {
    const pts = poissonDisc(rng, area, minDist, (x, z) => !inCone(x, z, 8) && !nearHouse(x, z, 6) && !nearGarden(x, z, 6), cap);
    for (const p of pts) {
      const kind = rng.pick(kinds);
      const s = TREE_SIZES[kind];
      const crown = snap(rng.range(s.c[0], s.c[1]), 0.1);
      if (inCone(p.x, p.z, crown) || nearHouse(p.x, p.z, crown) || nearGarden(p.x, p.z, crown)) continue;
      trees.push({ x: snap(p.x, 0.01), z: snap(p.z, 0.01), y: snap(terrainHeight(terrain, p.x, p.z), 0.01), height: snap(rng.range(s.h[0], s.h[1]), 0.1), crown, kind });
    }
  };
  // Woods behind the house: silhouettes above the roofline.
  addTrees(rect(footprint.x0 - 70, footprint.z0 - 110, footprint.x1 + 70, footprint.z0 - 16), 9, ['beech', 'oak', 'cedar', 'beech', 'poplar'], 160);
  // Flanking belts.
  addTrees(rect(fx1 + 18, footprint.z0 - 30, fx1 + 140, eye.z - 25), 10, ['oak', 'beech', 'oak', 'cedar'], 120);
  addTrees(rect(fx0 - 140, footprint.z0 - 30, fx0 - 18, eye.z - 25), 10, ['oak', 'beech', 'oak', 'cedar'], 120);
  // The sniper's treeline along the ridge.
  addTrees(rect(eye.x - 230, eye.z - 30, eye.x + 230, eye.z + 50), 7.5, ['oak', 'beech', 'yew', 'oak'], 220);
  // A specimen cedar or two on the lawn.
  for (const side of [-1, 1]) {
    if (!rng.chance(0.7)) continue;
    const x = side * (Math.max(Math.abs(fx0), Math.abs(fx1)) + rng.range(6, 22));
    const z = m.zGarden + rng.range(8, 40);
    const crown = rng.range(8, 10.5);
    if (inCone(x, z, crown)) continue;
    trees.push({ x: snap(x, 0.01), z: snap(z, 0.01), y: snap(terrainHeight(terrain, x, z), 0.01), height: snap(rng.range(18, 24), 0.1), crown: snap(crown, 0.1), kind: 'cedar' });
  }
  // Clipped yews along the terrace foot.
  if (rng.chance(0.6)) {
    for (let x = tx0 + 3; x <= tx1 - 3; x += 6) {
      if (Math.abs(x) < stepW / 2 + 2) continue;
      topiary.push({ x: snap(x, 0.01), z: snap(walkZ0 + 3.8, 0.01), height: 2.6, radius: 0.7, shape: 'cone' });
    }
  }

  const site: Site = {
    terrace,
    lawn: rect(-260, footprint.z0 - 130, 260, eye.z + 80),
    paths,
    fountain: { x: 0, z: fountainZ, radius: fountainR, tiers: rng.int(1, 3) },
    parterres,
    topiary,
    trees,
    terrain,
    perch,
    sky,
  };
  return { site, props, lights };
}
