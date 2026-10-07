/** Collect sightline occluders from the blueprint parts. */
import type { LevelSpec, Mass, Portico, Prop, Room, Site, Wall } from '../core/types';
import type { BoxOccluder, CylOccluder, OccluderSet, SlabOccluder, WallOccluder } from './sightlines';

export interface OccluderInput {
  walls: Wall[];
  rooms: Room[];
  levels: LevelSpec[];
  masses: Mass[];
  porticos: Portico[];
  props: Prop[];
  site: Site | null;
  /** Include furniture (second pass) or only architecture (first pass). */
  withProps: boolean;
}

const PROP_TRANSMIT: Partial<Record<Prop['kind'], number>> = {
  statue: 0.4,
  bust: 0.6,
  plant: 0.5,
  harp: 0.6,
  bookcase: 0,
  wardrobe: 0,
  cabinet: 0,
  'bar-shelf': 0,
  clock: 0.3,
};

export function roofRise(m: Mass): number {
  const span = Math.min(m.rect.x1 - m.rect.x0, m.rect.z1 - m.rect.z0);
  switch (m.roof.kind) {
    case 'flat':
      return 1.1;
    case 'glass':
      return Math.min(2.4, span * 0.25);
    case 'mansard':
      return Math.min(4.6, span * 0.35);
    default:
      return Math.min(span / 2, 9) * Math.tan((m.roof.pitchDeg * Math.PI) / 180);
  }
}

export function collectOccluders(input: OccluderInput): OccluderSet {
  const walls: WallOccluder[] = [];
  for (const w of input.walls) {
    const holes = w.openings.map((o) => {
      let transmit: number;
      if (!o.glazed) transmit = w.exterior && o.kind === 'entrance' ? 0 : 1;
      else if (o.frosted) transmit = 0;
      else if (o.curtain === 'drawn') transmit = 0;
      else if (o.curtain === 'sheer') transmit = 0.45;
      else transmit = 0.92;
      const base = w.axis === 'x' ? w.a.x : w.a.z;
      return { t0: base + o.u0, t1: base + o.u1, y0: o.y0, y1: o.y1, transmit };
    });
    walls.push({
      axis: w.axis,
      line: w.axis === 'x' ? w.a.z : w.a.x,
      t0: w.axis === 'x' ? w.a.x : w.a.z,
      t1: w.axis === 'x' ? w.b.x : w.b.z,
      // Exterior walls continue down to the ground as the plinth.
      y0: w.exterior && w.level === 0 ? 0 : w.y0,
      y1: w.y1,
      holes,
    });
  }

  const boxes: BoxOccluder[] = [];
  const cyls: CylOccluder[] = [];
  for (const m of input.masses) {
    const rise = roofRise(m);
    boxes.push({ x0: m.rect.x0 - 0.3, z0: m.rect.z0 - 0.3, x1: m.rect.x1 + 0.3, z1: m.rect.z1 + 0.3, y0: m.roof.eaveY - 0.05, y1: m.roof.eaveY + rise * 0.55, transmit: m.roof.kind === 'glass' ? 0.8 : 0 });
  }
  for (const p of input.porticos) {
    for (const c of p.columns) cyls.push({ x: c.x, z: c.z, r: p.columnRadius, y0: p.baseY, y1: p.topY, transmit: 0 });
    boxes.push({ x0: p.rect.x0, z0: p.rect.z0, x1: p.rect.x1, z1: p.rect.z1, y0: p.topY - 0.9, y1: p.topY + 0.4, transmit: 0 });
  }
  if (input.withProps) {
    for (const p of input.props) {
      if (!p.occludes || p.mount !== 'floor') continue;
      const q = Math.round(p.yaw / (Math.PI / 2)) & 1;
      const hw = (q ? p.d : p.w) / 2;
      const hd = (q ? p.w : p.d) / 2;
      const transmit = PROP_TRANSMIT[p.kind] ?? 0.2;
      if (p.kind === 'statue' || p.kind === 'bust' || p.kind === 'plant') {
        cyls.push({ x: p.x, z: p.z, r: Math.min(hw, hd) * 0.8, y0: p.y, y1: p.y + p.h, transmit });
      } else {
        boxes.push({ x0: p.x - hw, z0: p.z - hd, x1: p.x + hw, z1: p.z + hd, y0: p.y, y1: p.y + p.h, transmit });
      }
    }
  }

  const site = input.site;
  if (site) {
    const ty = site.terrace.y;
    for (const b of site.terrace.balustrades) {
      const axis = Math.abs(b.a.z - b.b.z) < 1e-6 ? 'x' : 'z';
      walls.push({
        axis,
        line: axis === 'x' ? b.a.z : b.a.x,
        t0: axis === 'x' ? Math.min(b.a.x, b.b.x) : Math.min(b.a.z, b.b.z),
        t1: axis === 'x' ? Math.max(b.a.x, b.b.x) : Math.max(b.a.z, b.b.z),
        y0: 0,
        y1: ty + b.height,
        // Balusters: the lower part is solid (terrace wall), the railing zone is half see-through.
        holes: [{ t0: -1e9, t1: 1e9, y0: ty + 0.18, y1: ty + b.height - 0.14, transmit: 0.5 }],
      });
    }
    for (const t of site.trees) {
      const trunkTop = t.y + t.height * (t.kind === 'cypress' || t.kind === 'poplar' ? 0.15 : 0.35);
      cyls.push({ x: t.x, z: t.z, r: Math.max(0.25, t.height / 50), y0: t.y, y1: trunkTop, transmit: 0 });
      cyls.push({ x: t.x, z: t.z, r: t.crown, y0: trunkTop, y1: t.y + t.height, transmit: 0.15 });
    }
    for (const t of site.topiary) cyls.push({ x: t.x, z: t.z, r: t.radius, y0: 0, y1: t.height, transmit: 0.3 });
    if (site.fountain) cyls.push({ x: site.fountain.x, z: site.fountain.z, r: 0.7, y0: 0, y1: 1.6 + site.fountain.tiers * 0.8, transmit: 0.2 });
  }

  // Floor slabs at each storey above the ground.
  const slabs: SlabOccluder[] = [];
  for (const lv of input.levels) {
    if (lv.index === 0) continue;
    const rooms = input.rooms.filter((r) => r.level === lv.index);
    if (!rooms.length) continue;
    slabs.push({ y: lv.floorY - 0.2, rects: rooms.map((r) => r.rect), holes: rooms.flatMap((r) => r.floorHoles) });
  }

  return { walls, boxes, cyls, slabs, terrain: site?.terrain ?? null };
}
