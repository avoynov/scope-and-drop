/**
 * Sightline tracer from the sniper perch.
 *
 * 2.5D: vertical wall planes with rectangular openings (glass, curtains),
 * horizontal floor slabs, vertical boxes (tall furniture), vertical cylinders
 * (columns, statues, tree crowns) and the terrain. Each blocker has a
 * transmittance (sheer curtain 0.45, tree crown 0.15 ...); a ray's visibility
 * is the product. Occluders are binned by bearing from the eye, so a query
 * only tests what lies along its bearing.
 */
import type { Rect, Vec3 } from '../core/geom';
import type { TerrainSpec } from '../core/types';
import { terrainHeight } from '../site/terrain';

export interface WallOccluder {
  axis: 'x' | 'z';
  line: number;
  t0: number;
  t1: number;
  y0: number;
  y1: number;
  holes: { t0: number; t1: number; y0: number; y1: number; transmit: number }[];
}

export interface BoxOccluder {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
  transmit: number;
}

export interface CylOccluder {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
  transmit: number;
}

export interface SlabOccluder {
  y: number;
  rects: Rect[];
  holes: Rect[];
}

export interface OccluderSet {
  walls: WallOccluder[];
  boxes: BoxOccluder[];
  cyls: CylOccluder[];
  slabs: SlabOccluder[];
  terrain: TerrainSpec | null;
}

type Item = { kind: 0; o: WallOccluder } | { kind: 1; o: BoxOccluder } | { kind: 2; o: CylOccluder };

const BINS = 4096;

export class SightlineTracer {
  private readonly bins: Item[][];
  private readonly aMin: number;
  private readonly aMax: number;
  rays = 0;

  constructor(
    readonly eye: Vec3,
    private readonly occ: OccluderSet,
  ) {
    const items: { item: Item; a0: number; a1: number }[] = [];
    const ang = (x: number, z: number) => Math.atan2(x - eye.x, eye.z - z);
    const push = (item: Item, pts: [number, number][], pad = 0) => {
      // Skip anything entirely behind the eye: every target is in front.
      if (pts.every(([, z]) => z > eye.z)) return;
      const as = pts.map(([x, z]) => ang(x, z));
      items.push({ item, a0: Math.min(...as) - pad, a1: Math.max(...as) + pad });
    };
    for (const o of occ.walls) {
      const pts: [number, number][] = o.axis === 'x' ? [[o.t0, o.line], [o.t1, o.line]] : [[o.line, o.t0], [o.line, o.t1]];
      push({ kind: 0, o }, pts, 1e-4);
    }
    for (const o of occ.boxes) push({ kind: 1, o }, [[o.x0, o.z0], [o.x1, o.z0], [o.x0, o.z1], [o.x1, o.z1]], 1e-4);
    for (const o of occ.cyls) {
      const d = Math.max(o.r + 0.01, Math.hypot(o.x - eye.x, o.z - eye.z));
      const a = ang(o.x, o.z);
      const s = Math.asin(Math.min(1, o.r / d));
      items.push({ item: { kind: 2, o }, a0: a - s - 1e-4, a1: a + s + 1e-4 });
    }
    this.aMin = Math.max(-Math.PI / 2, Math.min(...items.map((i) => i.a0), -0.01));
    this.aMax = Math.min(Math.PI / 2, Math.max(...items.map((i) => i.a1), 0.01));
    this.bins = Array.from({ length: BINS }, () => []);
    for (const { item, a0, a1 } of items) {
      const b0 = this.bin(a0);
      const b1 = this.bin(a1);
      for (let b = b0; b <= b1; b++) this.bins[b]!.push(item);
    }
  }

  private bin(a: number): number {
    const t = (a - this.aMin) / (this.aMax - this.aMin);
    return Math.min(BINS - 1, Math.max(0, Math.floor(t * BINS)));
  }

  /** Fraction of light reaching `target` from the eye (1 = clear view). */
  transmit(target: Vec3): number {
    this.rays++;
    const E = this.eye;
    const dx = target.x - E.x;
    const dy = target.y - E.y;
    const dz = target.z - E.z;
    let T = 1;
    const a = Math.atan2(dx, -dz);
    const list = this.bins[this.bin(a)]!;
    for (const it of list) {
      if (it.kind === 0) {
        const w = it.o;
        let t: number;
        let u: number;
        if (w.axis === 'x') {
          if (Math.abs(dz) < 1e-9) continue;
          t = (w.line - E.z) / dz;
          if (t <= 1e-6 || t >= 1 - 1e-6) continue;
          u = E.x + t * dx;
        } else {
          if (Math.abs(dx) < 1e-9) continue;
          t = (w.line - E.x) / dx;
          if (t <= 1e-6 || t >= 1 - 1e-6) continue;
          u = E.z + t * dz;
        }
        if (u < w.t0 || u > w.t1) continue;
        const y = E.y + t * dy;
        if (y < w.y0 || y > w.y1) continue;
        let through = 0;
        for (const h of w.holes) {
          if (u >= h.t0 && u <= h.t1 && y >= h.y0 && y <= h.y1) {
            through = h.transmit;
            break;
          }
        }
        T *= through;
      } else if (it.kind === 1) {
        const b = it.o;
        // Slab method in plan.
        let t0 = 0;
        let t1 = 1;
        if (Math.abs(dx) < 1e-9) {
          if (E.x < b.x0 || E.x > b.x1) continue;
        } else {
          const ta = (b.x0 - E.x) / dx;
          const tb = (b.x1 - E.x) / dx;
          t0 = Math.max(t0, Math.min(ta, tb));
          t1 = Math.min(t1, Math.max(ta, tb));
        }
        if (Math.abs(dz) < 1e-9) {
          if (E.z < b.z0 || E.z > b.z1) continue;
        } else {
          const ta = (b.z0 - E.z) / dz;
          const tb = (b.z1 - E.z) / dz;
          t0 = Math.max(t0, Math.min(ta, tb));
          t1 = Math.min(t1, Math.max(ta, tb));
        }
        if (t1 <= t0 || t1 <= 1e-6 || t0 >= 1 - 1e-6) continue;
        const ya = E.y + t0 * dy;
        const yb = E.y + t1 * dy;
        if (Math.max(ya, yb) < b.y0 || Math.min(ya, yb) > b.y1) continue;
        T *= b.transmit;
      } else {
        const c = it.o;
        const fx = E.x - c.x;
        const fz = E.z - c.z;
        const A = dx * dx + dz * dz;
        const B = 2 * (fx * dx + fz * dz);
        const C = fx * fx + fz * fz - c.r * c.r;
        const disc = B * B - 4 * A * C;
        if (disc <= 0 || A < 1e-12) continue;
        const sq = Math.sqrt(disc);
        const ta = Math.max(0, (-B - sq) / (2 * A));
        const tb = Math.min(1, (-B + sq) / (2 * A));
        if (tb <= ta || tb <= 1e-6 || ta >= 1 - 1e-6) continue;
        const ya = E.y + ta * dy;
        const yb = E.y + tb * dy;
        if (Math.max(ya, yb) < c.y0 || Math.min(ya, yb) > c.y1) continue;
        T *= c.transmit;
      }
      if (T <= 0.003) return 0;
    }
    // Floor slabs between storeys.
    for (const s of this.occ.slabs) {
      if (Math.abs(dy) < 1e-9) continue;
      const t = (s.y - E.y) / dy;
      if (t <= 1e-6 || t >= 1 - 1e-6) continue;
      const x = E.x + t * dx;
      const z = E.z + t * dz;
      if (s.rects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) && !s.holes.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) return 0;
    }
    // Brow of the hill.
    if (this.occ.terrain) {
      for (let i = 1; i <= 16; i++) {
        const t = (i / 16) * 0.85;
        const x = E.x + t * dx;
        const z = E.z + t * dz;
        if (terrainHeight(this.occ.terrain, x, z) > E.y + t * dy) return 0;
      }
    }
    return T;
  }

  /** Visibility of a standing person (torso + head) at plan (x, z) on a floor at floorY. */
  person(x: number, z: number, floorY: number): number {
    const torso = this.transmit({ x, y: floorY + 1.25, z });
    const head = this.transmit({ x, y: floorY + 1.62, z });
    return (torso + head) / 2;
  }
}
