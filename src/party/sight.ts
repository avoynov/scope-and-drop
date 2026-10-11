/**
 * What can be seen from where: a sight grid per storey and a table of which rooms can see
 * into which (milestone 2 technical plan: Senses).
 *
 * The grid shares the nav grid's cells, so a person's cell is the same in both. The nav grid
 * can't double as it: furniture is unwalkable, but most of it doesn't block sight. Each cell
 * is open floor, wall, a doorway (open or shut with its door), a curtained window (blocked
 * while the curtain is drawn) or a screen (frosted glass).
 *
 * Walls are rasterised conservatively (any cell a wall touches is wall), so no line slips
 * through a thin wall on a diagonal; doorways and arches are cut back in by their centres.
 */
import type { Vec2 } from '../mansion/core/geom';
import type { MansionBlueprint, NavLevel, Opening, PropKind, Wall } from '../mansion/core/types';
import type { Pathfinder } from './path';
import type { World } from './world';

export const SEE_OPEN = 0;
export const SEE_WALL = 1;
export const SEE_DOOR = 2;
export const SEE_CURTAIN = 3;
export const SEE_SCREEN = 4;

/** A door lets sight through once it stands at least this open. */
export const SEE_DOOR_OPEN = 0.5;

/** Tall furniture that hides whoever stands behind it (its occluder lets through 40% or less). */
const BLOCKS_SIGHT: ReadonlySet<PropKind> = new Set(['bookcase', 'wardrobe', 'cabinet', 'bar-shelf', 'clock', 'statue']);
/** Eye height above the floor (m): a window passes sight when its glass spans it. */
const EYE = 1.6;

interface Grid {
  n: NavLevel;
  kind: Uint8Array;
  /** Door id (doorways) or curtain id (curtained windows), else -1. */
  ref: Int16Array;
}

/** The dome hall: which rooms are open to each other through the void. */
interface Atrium {
  /** Room index of the hall's floor (the ballroom). */
  floor: number;
  /** Room indices of the galleries, on the storeys above. */
  galleries: Set<number>;
  void: Vec2[];
  galleryWidth: number;
}

export class Sight {
  private readonly grids = new Map<number, Grid>();
  /** Rooms plus the terrace (the last index). */
  readonly R: number;
  /** Room pairs that always see each other: the same room, an arch, clear glass, the dome hall. */
  private readonly always: Uint8Array;
  /** Room pairs joined by a door (seen through while it stands open), and by a curtained window. */
  private readonly viaDoors = new Map<number, number[]>();
  private readonly viaCurtains = new Map<number, number[]>();
  /** Per room: every room it might see into (for "seeing into a room" and the look schedule). */
  readonly neighbours: number[][];
  readonly atrium: Atrium | null;
  /** Per storey, per nav cell: 1 where someone stands close enough to the dome hall's void to see across it. */
  private readonly rail = new Map<number, Uint8Array>();

  constructor(
    private readonly bp: MansionBlueprint,
    private readonly pf: Pathfinder,
    private readonly world: World,
  ) {
    const R = bp.rooms.length + 1;
    this.R = R;
    this.always = new Uint8Array(R * R);
    this.neighbours = Array.from({ length: R }, () => []);
    for (let r = 0; r < R; r++) this.always[r * R + r] = 1;

    const curtainOf = new Map(world.curtains.map((c) => [c.opening, c.id]));
    const doorOf = new Map(world.doors.map((d) => [d.opening, d.id]));
    for (const n of pf.levels.values()) this.grids.set(n.level, this.build(n, curtainOf, doorOf));

    // The room table.
    const idx = new Map(bp.rooms.map((r) => [r.id, r.index]));
    const T = R - 1;
    const pair = (a: number, b: number) => (a < 0 ? T : a) * R + (b < 0 ? T : b);
    const join = (a: number, b: number) => {
      this.always[pair(a, b)] = 1;
      this.always[pair(b, a)] = 1;
    };
    const via = (m: Map<number, number[]>, a: number, b: number, id: number) => {
      for (const k of [pair(a, b), pair(b, a)]) {
        const list = m.get(k);
        if (!list) m.set(k, [id]);
        else if (!list.includes(id)) list.push(id);
      }
    };
    for (const [a, edges] of world.graph.entries()) {
      const from = a === T ? -2 : a;
      for (const e of edges) {
        if (e.kind === 'stair') continue;
        if (e.door >= 0) via(this.viaDoors, from, e.to, e.door);
        else join(from, e.to);
      }
    }
    for (const w of bp.walls) {
      const a = w.neg ? idx.get(w.neg) : undefined;
      const b = w.pos ? idx.get(w.pos) : undefined;
      for (const o of w.openings) {
        if (!this.seeThroughGlass(w, o)) continue;
        if (!w.exterior && a !== undefined && b !== undefined) join(a, b);
        else if (w.exterior && w.level === 0 && (a ?? b) !== undefined) {
          // A window or French window onto the terrace.
          const c = curtainOf.get(o.id);
          if (c !== undefined && world.curtains[c]!.movable) via(this.viaCurtains, (a ?? b)!, -2, c);
          else join((a ?? b)!, -2);
        }
      }
    }
    const at = bp.atrium;
    this.atrium = null;
    if (at) {
      const floor = idx.get(at.roomId);
      const galleries = new Set(at.galleries.map((g) => idx.get(g.roomId)).filter((i): i is number => i !== undefined));
      if (floor !== undefined) {
        this.atrium = { floor, galleries, void: at.void, galleryWidth: at.galleryWidth };
        const all = [floor, ...galleries];
        for (const a of all) for (const b of all) join(a, b);
        // Which cells see across the void: the floor within 1.5 m of it (or under it), the galleries near the rail.
        for (const n of pf.levels.values()) {
          const g = new Uint8Array(n.cols * n.rows);
          for (let k = 0; k < g.length; k++) {
            const room = n.room[k]!;
            if (room !== floor && !galleries.has(room)) continue;
            const c = k % n.cols;
            const x = n.originX + (c + 0.5) * n.cell;
            const z = n.originZ + ((k - c) / n.cols + 0.5) * n.cell;
            const d = distToPolygon(at.void, x, z);
            g[k] = room === floor ? (d <= 1.5 || inPolygon(at.void, x, z) ? 1 : 0) : d <= at.galleryWidth + 0.6 ? 1 : 0;
          }
          this.rail.set(n.level, g);
        }
      }
    }
    for (let a = 0; a < R; a++) {
      for (let b = 0; b < R; b++) {
        if (a === b) continue;
        const k = a * R + b;
        if (this.always[k] || this.viaDoors.has(k) || this.viaCurtains.has(k)) this.neighbours[a]!.push(b === T ? -2 : b);
      }
    }
  }

  private seeThroughGlass(w: Wall, o: Opening): boolean {
    if (!o.glazed || o.frosted) return false;
    const floor = this.bp.levels[w.level]?.floorY ?? 0;
    return o.y0 - floor < EYE - 0.1 && o.y1 - floor > EYE;
  }

  private build(n: NavLevel, curtainOf: Map<string, number>, doorOf: Map<string, number>): Grid {
    const { cols, rows, cell, originX: x0, originZ: z0 } = n;
    const kind = new Uint8Array(cols * rows).fill(SEE_WALL);
    const ref = new Int16Array(cols * rows).fill(-1);
    const bp = this.bp;
    const cellRange = (a: number, b: number, o: number, max: number, overlap: boolean): [number, number] => {
      // Cells whose span overlaps [a, b] (conservative), or whose centre lies in it.
      const lo = overlap ? Math.floor((a - o) / cell) : Math.ceil((a - o) / cell - 0.5);
      const hi = overlap ? Math.ceil((b - o) / cell) - 1 : Math.floor((b - o) / cell - 0.5);
      return [Math.max(0, lo), Math.min(max - 1, hi)];
    };
    const fillRect = (rx0: number, rz0: number, rx1: number, rz1: number, v: number, overlap: boolean, r = -1) => {
      const [c0, c1] = cellRange(rx0, rx1, x0, cols, overlap);
      const [r0, r1] = cellRange(rz0, rz1, z0, rows, overlap);
      for (let rr = r0; rr <= r1; rr++) {
        for (let c = c0; c <= c1; c++) {
          kind[rr * cols + c] = v;
          ref[rr * cols + c] = r;
        }
      }
    };

    // Open floor: every room's clear interior, and on the ground floor everything outside the house.
    const rooms = bp.rooms.filter((r) => r.level === n.level);
    for (const r of rooms) fillRect(r.inner.x0, r.inner.z0, r.inner.x1, r.inner.z1, SEE_OPEN, false);
    if (n.level === 0) {
      for (let rr = 0; rr < rows; rr++) {
        const z = z0 + (rr + 0.5) * cell;
        for (let c = 0; c < cols; c++) {
          const x = x0 + (c + 0.5) * cell;
          if (!bp.masses.some((m) => x > m.rect.x0 && x < m.rect.x1 && z > m.rect.z0 && z < m.rect.z1)) kind[rr * cols + c] = SEE_OPEN;
        }
      }
    }
    // The dome hall's void: the galleries see across it.
    const at = bp.atrium;
    if (at && n.level > 0) {
      for (let rr = 0; rr < rows; rr++) {
        const z = z0 + (rr + 0.5) * cell;
        for (let c = 0; c < cols; c++) {
          const x = x0 + (c + 0.5) * cell;
          if (inPolygon(at.void, x, z)) kind[rr * cols + c] = SEE_OPEN;
        }
      }
    }
    // Tall furniture.
    for (const p of bp.props) {
      if (p.level !== n.level || !p.occludes || !BLOCKS_SIGHT.has(p.kind) || p.mount === 'ceiling') continue;
      const q = Math.round(p.yaw / (Math.PI / 2)) & 1;
      const hw = (q ? p.d : p.w) / 2;
      const hd = (q ? p.w : p.d) / 2;
      fillRect(p.x - hw, p.z - hd, p.x + hw, p.z + hd, SEE_WALL, false);
    }
    // Walls, then their openings cut back in.
    for (const w of bp.walls) {
      if (w.level !== n.level) continue;
      const half = w.thickness / 2;
      const line = w.axis === 'x' ? w.a.z : w.a.x;
      const t0 = w.axis === 'x' ? w.a.x : w.a.z;
      const t1 = w.axis === 'x' ? w.b.x : w.b.z;
      const band = (a: number, b: number, v: number, overlapAlong: boolean, r = -1) => {
        if (w.axis === 'x') {
          const [c0, c1] = cellRange(a, b, x0, cols, overlapAlong);
          const [r0, r1] = cellRange(line - half, line + half, z0, rows, true);
          for (let rr = r0; rr <= r1; rr++) for (let c = c0; c <= c1; c++) ((kind[rr * cols + c] = v), (ref[rr * cols + c] = r));
        } else {
          const [c0, c1] = cellRange(line - half, line + half, x0, cols, true);
          const [r0, r1] = cellRange(a, b, z0, rows, overlapAlong);
          for (let rr = r0; rr <= r1; rr++) for (let c = c0; c <= c1; c++) ((kind[rr * cols + c] = v), (ref[rr * cols + c] = r));
        }
      };
      band(t0, t1, w.glazed && !w.exterior ? SEE_OPEN : SEE_WALL, true);
      if (w.glazed && w.exterior) {
        // A conservatory's glass wall.
        band(t0, t1, SEE_OPEN, false);
        continue;
      }
      for (const o of w.openings) {
        const a = t0 + o.u0;
        const b = t0 + o.u1;
        const door = doorOf.get(o.id);
        if (door !== undefined) band(a, b, SEE_DOOR, false, door);
        else if (o.kind === 'arch' || (o.passable && !o.glazed && !w.exterior)) band(a, b, SEE_OPEN, false);
        else if (o.glazed && o.frosted) band(a, b, SEE_SCREEN, false);
        else if (this.seeThroughGlass(w, o)) {
          const c = curtainOf.get(o.id);
          if (c !== undefined) band(a, b, SEE_CURTAIN, false, c);
          else band(a, b, SEE_OPEN, false);
        }
      }
    }
    return { n, kind, ref };
  }

  /** What a cell is, for the lab and the tests. */
  kindAt(level: number, x: number, z: number): number {
    const g = this.grids.get(level);
    const k = this.pf.cellOf(level, x, z);
    return g && k >= 0 ? g.kind[k]! : SEE_WALL;
  }

  /** Whether a cell lets sight through now. */
  private passes(g: Grid, k: number): boolean {
    const v = g.kind[k]!;
    if (v === SEE_OPEN) return true;
    if (v === SEE_DOOR) return this.world.doors[g.ref[k]!]!.open >= SEE_DOOR_OPEN;
    if (v === SEE_CURTAIN) return this.world.curtains[g.ref[k]!]!.state !== 'drawn';
    return false;
  }

  private ok(g: Grid, cc: number, rr: number, c1: number, r1: number): boolean {
    if (cc < 0 || rr < 0 || cc >= g.n.cols || rr >= g.n.rows) return false;
    if (cc === c1 && rr === r1) return true;
    return this.passes(g, rr * g.n.cols + cc);
  }

  /**
   * True when nothing blocks the straight line between two points on a storey: the same
   * exact traversal and corner rule as the routes use. The two end cells are not checked,
   * since a person pressed against a wall stands in a wall cell.
   */
  clear(level: number, ax: number, az: number, bx: number, bz: number): boolean {
    const g = this.grids.get(level);
    if (!g) return false;
    const n = g.n;
    const fx0 = (ax - n.originX) / n.cell;
    const fz0 = (az - n.originZ) / n.cell;
    const fx1 = (bx - n.originX) / n.cell;
    const fz1 = (bz - n.originZ) / n.cell;
    let c = Math.floor(fx0);
    let r = Math.floor(fz0);
    const c1 = Math.floor(fx1);
    const r1 = Math.floor(fz1);
    const dx = fx1 - fx0;
    const dz = fz1 - fz0;
    const sc = dx > 0 ? 1 : -1;
    const sr = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tx = dx !== 0 ? (dx > 0 ? c + 1 - fx0 : fx0 - c) * tdx : Infinity;
    let tz = dz !== 0 ? (dz > 0 ? r + 1 - fz0 : fz0 - r) * tdz : Infinity;
    for (let guard = 0; guard < 4096 && (c !== c1 || r !== r1); guard++) {
      if (Math.abs(tx - tz) < 1e-9) {
        if (!this.ok(g, c + sc, r, c1, r1) || !this.ok(g, c, r + sr, c1, r1)) return false;
        c += sc;
        r += sr;
        tx += tdx;
        tz += tdz;
      } else if (tx < tz) {
        c += sc;
        tx += tdx;
      } else {
        r += sr;
        tz += tdz;
      }
      if (tx > 1 + 1e-9 && tz > 1 + 1e-9 && (c !== c1 || r !== r1)) break;
      if (!this.ok(g, c, r, c1, r1)) return false;
    }
    return true;
  }

  /** Whether two rooms (-2 the terrace) can see into each other now: the same room, or joined by an arch, clear glass or an open door. */
  seeRooms(a: number, b: number): boolean {
    if (a === -1 || b === -1) return false;
    const R = this.R;
    const k = (a < 0 ? R - 1 : a) * R + (b < 0 ? R - 1 : b);
    if (this.always[k]) return true;
    const doors = this.viaDoors.get(k);
    if (doors) for (const d of doors) if (this.world.doors[d]!.open >= SEE_DOOR_OPEN) return true;
    const curtains = this.viaCurtains.get(k);
    if (curtains) for (const c of curtains) if (this.world.curtains[c]!.state !== 'drawn') return true;
    return false;
  }

  /** Whether someone standing here can see across the dome hall's void. */
  atRail(level: number, x: number, z: number): boolean {
    const g = this.rail.get(level);
    const k = this.pf.cellOf(level, x, z);
    return !!g && k >= 0 && g[k] === 1;
  }

  /**
   * Across storeys, only in the dome hall: whoever stands near the gallery rail and whoever is
   * on the floor under the void see each other. Plan positions; heights are the caller's.
   */
  acrossVoid(aLevel: number, ax: number, az: number, bLevel: number, bx: number, bz: number): boolean {
    return this.atRail(aLevel, ax, az) && this.atRail(bLevel, bx, bz);
  }
}

export function inPolygon(poly: readonly Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function distToPolygon(poly: readonly Vec2[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = ex * ex + ez * ez;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len)) : 0;
    best = Math.min(best, Math.hypot(a.x + ex * t - x, a.z + ez * t - z));
  }
  return best;
}
