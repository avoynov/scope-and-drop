/**
 * Wall derivation (stage 3).
 *
 * Walls are not authored; they fall out of the room rectangles. For every
 * axis-aligned line we sweep the room edges lying on it and emit one wall
 * segment per run with a constant (room-on-negative-side, room-on-positive-side)
 * pair. A null side means outside, which makes the segment a façade wall.
 */
import { containsPoint, near, type Rect } from '../core/geom';
import type { FacadeSide, LevelSpec, Mass, Wall } from '../core/types';
import type { RoomDraft } from './rooms';

import { EXTERIOR_T, INTERIOR_T } from './massing';

export { EXTERIOR_T, INTERIOR_T };
export const MASS_JOINT_T = 0.5;
export const GLASS_T = 0.16;

interface Edge {
  axis: 'x' | 'z';
  line: number;
  t0: number;
  t1: number;
  side: 'neg' | 'pos';
  room: RoomDraft;
}

function roomEdges(r: RoomDraft): Edge[] {
  const { x0, z0, x1, z1 } = r.rect;
  return [
    { axis: 'x', line: z0, t0: x0, t1: x1, side: 'pos', room: r },
    { axis: 'x', line: z1, t0: x0, t1: x1, side: 'neg', room: r },
    { axis: 'z', line: x0, t0: z0, t1: z1, side: 'pos', room: r },
    { axis: 'z', line: x1, t0: z0, t1: z1, side: 'neg', room: r },
  ];
}

/** Rooms occupying a level, including double-height rooms rising from below. */
export function roomsOnLevel(rooms: RoomDraft[], level: number): RoomDraft[] {
  return rooms.filter((r) => r.level === level || (r.doubleHeight && r.level === level - 1));
}

export function massAt(masses: Mass[], x: number, z: number, minLevels = 1): Mass | undefined {
  // Most specific first: pavilions/conservatories sit inside or against the main block.
  const order = ['pavilion', 'conservatory', 'wing', 'main'];
  return masses
    .filter((m) => m.levels >= minLevels && containsPoint(m.rect, x, z, 1e-3))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0];
}

export function deriveWalls(rooms: RoomDraft[], levels: LevelSpec[], masses: Mass[], conservatoryHeight: number): Wall[] {
  const walls: Wall[] = [];
  const maxLevel = Math.max(...rooms.map((r) => r.level + (r.doubleHeight ? 1 : 0)));
  for (let L = 0; L <= maxLevel; L++) {
    const present = roomsOnLevel(rooms, L);
    const groups = new Map<string, Edge[]>();
    for (const r of present) {
      for (const e of roomEdges(r)) {
        const key = `${e.axis}:${e.line.toFixed(3)}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = []));
        g.push(e);
      }
    }
    const keys = [...groups.keys()].sort();
    let n = 0;
    for (const key of keys) {
      const edges = groups.get(key)!;
      const axis = edges[0]!.axis;
      const line = edges[0]!.line;
      const bps = [...new Set(edges.flatMap((e) => [e.t0, e.t1]).map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
      type Seg = { a: number; b: number; neg: RoomDraft | null; pos: RoomDraft | null };
      const segs: Seg[] = [];
      for (let k = 0; k + 1 < bps.length; k++) {
        const a = bps[k]!;
        const b = bps[k + 1]!;
        const mid = (a + b) / 2;
        const neg = edges.find((e) => e.side === 'neg' && e.t0 <= mid && mid <= e.t1)?.room ?? null;
        const pos = edges.find((e) => e.side === 'pos' && e.t0 <= mid && mid <= e.t1)?.room ?? null;
        if (!neg && !pos) continue;
        const last = segs[segs.length - 1];
        if (last && near(last.b, a) && last.neg === neg && last.pos === pos) last.b = b;
        else segs.push({ a, b, neg, pos });
      }
      for (const s of segs) {
        const exterior = !s.neg || !s.pos;
        const inside = s.neg ?? s.pos!;
        const lv = levels[Math.min(L, levels.length - 1)]!;
        let side: FacadeSide | undefined;
        if (exterior) {
          if (axis === 'x') side = s.pos ? 'entrance' : 'garden';
          else side = s.pos ? 'west' : 'east';
        }
        const conservatoryOnly = (s.neg?.zone ?? 'conservatory') === 'conservatory' && (s.pos?.zone ?? 'conservatory') === 'conservatory';
        const glazed = exterior && inside.zone === 'conservatory';
        const crossMass = !exterior && s.neg!.massId !== s.pos!.massId;
        const thickness = glazed ? GLASS_T : exterior ? EXTERIOR_T : crossMass ? MASS_JOINT_T : INTERIOR_T;
        // Mass that owns the wall: sample just inside the building.
        const mid = (s.a + s.b) / 2;
        const inward = s.neg ? -0.3 : 0.3;
        const px = axis === 'x' ? mid : line + inward;
        const pz = axis === 'x' ? line + inward : mid;
        const owner = massAt(masses, px, pz)?.id ?? inside.massId;
        const a = axis === 'x' ? { x: s.a, z: line } : { x: line, z: s.a };
        const b = axis === 'x' ? { x: s.b, z: line } : { x: line, z: s.b };
        walls.push({
          id: `w${L}-${n++}`,
          level: L,
          massId: owner,
          a,
          b,
          axis,
          thickness,
          y0: lv.floorY,
          y1: conservatoryOnly ? lv.floorY + conservatoryHeight : lv.floorY + lv.height,
          exterior,
          side,
          neg: s.neg?.id ?? null,
          pos: s.pos?.id ?? null,
          openings: [],
          glazed: glazed || undefined,
        });
      }
    }
  }
  return walls;
}

export const wallLength = (w: Wall): number => (w.axis === 'x' ? w.b.x - w.a.x : w.b.z - w.a.z);

/** Clear interior rectangle: room rect inset by half the thickest wall on each edge. */
export function innerRect(room: RoomDraft, walls: Wall[]): Rect {
  const { x0, z0, x1, z1 } = room.rect;
  const L = room.level;
  const onEdge = (axis: 'x' | 'z', line: number, t0: number, t1: number): number => {
    let t = 0;
    for (const w of walls) {
      if (w.axis !== axis || (w.level !== L && !(room.doubleHeight && w.level === L + 1))) continue;
      const wl = axis === 'x' ? w.a.z : w.a.x;
      if (!near(wl, line, 1e-3)) continue;
      const a = axis === 'x' ? w.a.x : w.a.z;
      const b = axis === 'x' ? w.b.x : w.b.z;
      if (b <= t0 + 1e-3 || a >= t1 - 1e-3) continue;
      if (w.neg !== room.id && w.pos !== room.id) continue;
      t = Math.max(t, w.thickness);
    }
    return t / 2;
  };
  return {
    x0: x0 + onEdge('z', x0, z0, z1),
    x1: x1 - onEdge('z', x1, z0, z1),
    z0: z0 + onEdge('x', z0, x0, x1),
    z1: z1 - onEdge('x', z1, x0, x1),
  };
}
