/**
 * Navigation grids (per storey) with per-cell room index and perch visibility.
 * The terrace is part of level 0 (room index -2).
 */
import { containsPoint, type Rect } from '../core/geom';
import type { LevelSpec, Mass, NavLevel, Portico, Prop, Room, Site, Wall } from '../core/types';
import type { SightlineTracer } from './sightlines';

export interface NavInput {
  rooms: Room[];
  walls: Wall[];
  levels: LevelSpec[];
  masses: Mass[];
  props: Prop[];
  porticos: Portico[];
  site: Site;
  /** Extra blocked plan areas per room (stair footprints / holes). */
  blocked: Map<string, Rect[]>;
  cell: number;
}

/** Looser than the furniture placer's 0.28 m so placer-connected rooms stay connected here. */
const AGENT = 0.12;
/** Visibility is sampled on 2×2 cell blocks (rays are the expensive part). */
const VIS_BLOCK = 2;

export function buildNav(input: NavInput, tracer: SightlineTracer): NavLevel[] {
  const out: NavLevel[] = [];
  const terrace = input.site.terrace;
  const roomIndex = new Map(input.rooms.map((r) => [r.id, r.index]));
  for (const lv of input.levels) {
    const rooms = input.rooms.filter((r) => r.level === lv.index);
    if (!rooms.length) continue;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    const grow = (r: Rect) => {
      x0 = Math.min(x0, r.x0);
      z0 = Math.min(z0, r.z0);
      x1 = Math.max(x1, r.x1);
      z1 = Math.max(z1, r.z1);
    };
    rooms.forEach((r) => grow(r.rect));
    if (lv.index === 0) grow(terrace.rect);
    x0 -= 1;
    z0 -= 1;
    x1 += 1;
    z1 += 1;
    const cell = input.cell;
    const cols = Math.ceil((x1 - x0) / cell);
    const rows = Math.ceil((z1 - z0) / cell);
    const walk = new Uint8Array(cols * rows);
    const room = new Int16Array(cols * rows).fill(-1);
    const vis = new Uint8Array(cols * rows);

    const propRects = new Map<string, Rect[]>();
    for (const p of input.props) {
      if (!p.blocksNav || p.level !== lv.index) continue;
      const q = Math.round(p.yaw / (Math.PI / 2)) & 1;
      const hw = (q ? p.d : p.w) / 2 + AGENT;
      const hd = (q ? p.w : p.d) / 2 + AGENT;
      const key = p.roomId ?? 'terrace';
      let list = propRects.get(key);
      if (!list) propRects.set(key, (list = []));
      list.push({ x0: p.x - hw, z0: p.z - hd, x1: p.x + hw, z1: p.z + hd });
    }
    const terraceBlocks: Rect[] = [];
    if (lv.index === 0) {
      for (const b of terrace.balustrades) {
        terraceBlocks.push({ x0: Math.min(b.a.x, b.b.x) - 0.25, z0: Math.min(b.a.z, b.b.z) - 0.25, x1: Math.max(b.a.x, b.b.x) + 0.25, z1: Math.max(b.a.z, b.b.z) + 0.25 });
      }
      for (const p of input.porticos) for (const c of p.columns) terraceBlocks.push({ x0: c.x - p.columnRadius - AGENT, z0: c.z - p.columnRadius - AGENT, x1: c.x + p.columnRadius + AGENT, z1: c.z + p.columnRadius + AGENT });
      terraceBlocks.push(...(propRects.get('terrace') ?? []));
    }
    const masses = input.masses;
    const visCache = new Map<number, number>();
    const visAt = (c: number, r: number, floorY: number): number => {
      const bc = Math.floor(c / VIS_BLOCK);
      const br = Math.floor(r / VIS_BLOCK);
      const key = (br * 4096 + bc) * 2 + (floorY === lv.floorY ? 0 : 1);
      let v = visCache.get(key);
      if (v === undefined) {
        const x = x0 + (bc + 0.5) * VIS_BLOCK * cell;
        const z = z0 + (br + 0.5) * VIS_BLOCK * cell;
        v = Math.round(tracer.person(x, z, floorY) * 255);
        visCache.set(key, v);
      }
      return v;
    };

    for (let r = 0; r < rows; r++) {
      const z = z0 + (r + 0.5) * cell;
      for (let c = 0; c < cols; c++) {
        const x = x0 + (c + 0.5) * cell;
        const k = r * cols + c;
        let idx = -1;
        let ok = false;
        let floorY = lv.floorY;
        const rm = rooms.find((q) => x > q.inner.x0 + AGENT && x < q.inner.x1 - AGENT && z > q.inner.z0 + AGENT && z < q.inner.z1 - AGENT);
        if (rm) {
          idx = rm.index;
          floorY = rm.floorY;
          ok = !(propRects.get(rm.id) ?? []).some((b) => containsPoint(b, x, z)) && !(input.blocked.get(rm.id) ?? []).some((b) => containsPoint(b, x, z, AGENT));
        } else if (lv.index === 0 && containsPoint(terrace.rect, x, z) && !masses.some((m) => containsPoint(m.rect, x, z, 0.35))) {
          idx = -2;
          floorY = terrace.y;
          ok = !terraceBlocks.some((b) => containsPoint(b, x, z));
        }
        room[k] = idx;
        walk[k] = ok ? 1 : 0;
        if (ok) vis[k] = visAt(c, r, floorY);
      }
    }

    // Carve doorways through walls.
    for (const w of input.walls) {
      if (w.level !== lv.index) continue;
      for (const o of w.openings) {
        if (!o.passable || o.y0 > lv.floorY + 0.3) continue;
        const base = w.axis === 'x' ? w.a.x : w.a.z;
        const line = w.axis === 'x' ? w.a.z : w.a.x;
        const half = w.thickness / 2 + AGENT + cell;
        const ownIdx = w.neg ? (roomIndex.get(w.neg) ?? -1) : w.pos ? (roomIndex.get(w.pos) ?? -1) : -1;
        for (let t = base + o.u0 + 0.25; t <= base + o.u1 - 0.25 + 1e-6; t += cell / 2) {
          for (let s = -half; s <= half + 1e-6; s += cell / 2) {
            const x = w.axis === 'x' ? t : line + s;
            const z = w.axis === 'x' ? line + s : t;
            const c = Math.floor((x - x0) / cell);
            const r = Math.floor((z - z0) / cell);
            if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
            const k = r * cols + c;
            if (walk[k]) continue;
            // Only carve cells that are not inside furniture or a stairwell.
            walk[k] = 1;
            if (room[k] === -1) room[k] = w.exterior && w.side !== 'entrance' && lv.index === 0 && Math.sign(s) === (w.neg ? 1 : -1) ? -2 : ownIdx;
            const fy = room[k] === -2 ? terrace.y : lv.floorY;
            vis[k] = visAt(c, r, fy);
          }
        }
      }
    }

    const n: NavLevel = { level: lv.index, y: lv.floorY, originX: x0, originZ: z0, cell, cols, rows, walk, room, vis };
    // Drop pockets that furniture seals off: only the storey's main component is walkable.
    const comp = navComponents(n);
    const sizes = new Map<number, number>();
    comp.forEach((q) => q >= 0 && sizes.set(q, (sizes.get(q) ?? 0) + 1));
    const main = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (let k = 0; k < walk.length; k++) if (walk[k] && comp[k] !== main) walk[k] = 0;
    out.push(n);
  }
  return out;
}

/** Connected components flood fill over walkable cells of one level (4-neighbour). */
export function navComponents(n: NavLevel): Int32Array {
  const comp = new Int32Array(n.cols * n.rows).fill(-1);
  let id = 0;
  for (let k = 0; k < comp.length; k++) {
    if (!n.walk[k] || comp[k]! >= 0) continue;
    const stack = [k];
    comp[k] = id;
    while (stack.length) {
      const q = stack.pop()!;
      const c = q % n.cols;
      const r = (q - c) / n.cols;
      const nbs = [c > 0 ? q - 1 : -1, c < n.cols - 1 ? q + 1 : -1, r > 0 ? q - n.cols : -1, r < n.rows - 1 ? q + n.cols : -1];
      for (const nb of nbs) {
        if (nb >= 0 && n.walk[nb] && comp[nb]! < 0) {
          comp[nb] = id;
          stack.push(nb);
        }
      }
    }
    id++;
  }
  return comp;
}

export function navCellAt(n: NavLevel, x: number, z: number): number {
  const c = Math.floor((x - n.originX) / n.cell);
  const r = Math.floor((z - n.originZ) / n.cell);
  if (c < 0 || r < 0 || c >= n.cols || r >= n.rows) return -1;
  return r * n.cols + c;
}
