/**
 * Walking routes on the mansion's nav grids: A* per storey (8-neighbour, no corner
 * cutting), string-pulled to a few waypoints, with stairs linking storeys.
 */
import type { MansionBlueprint, NavLevel } from '../mansion/core/types';
import type { Waypoint } from './types';

interface Stair {
  via: string;
  bottom: Waypoint;
  top: Waypoint;
}

class Heap {
  private k: number[] = [];
  private f: number[] = [];
  get size(): number {
    return this.k.length;
  }
  clear(): void {
    this.k.length = 0;
    this.f.length = 0;
  }
  push(key: number, pri: number): void {
    const k = this.k;
    const f = this.f;
    let i = k.length;
    k.push(key);
    f.push(pri);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[p]! <= pri) break;
      k[i] = k[p]!;
      f[i] = f[p]!;
      i = p;
    }
    k[i] = key;
    f[i] = pri;
  }
  pop(): number {
    const k = this.k;
    const f = this.f;
    const top = k[0]!;
    const lk = k.pop()!;
    const lf = f.pop()!;
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        const a = 2 * i + 1;
        if (a >= n) break;
        const b = a + 1;
        const c = b < n && f[b]! < f[a]! ? b : a;
        if (f[c]! >= lf) break;
        k[i] = k[c]!;
        f[i] = f[c]!;
        i = c;
      }
      k[i] = lk;
      f[i] = lf;
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;

export class Pathfinder {
  readonly levels = new Map<number, NavLevel>();
  readonly stairs: Stair[] = [];
  private g = new Map<number, Float32Array>();
  private came = new Map<number, Int32Array>();
  private stamp = new Map<number, Uint32Array>();
  private closed = new Map<number, Uint32Array>();
  private run = 0;
  private heap = new Heap();

  constructor(bp: MansionBlueprint) {
    for (const n of bp.nav.levels) {
      this.levels.set(n.level, n);
      const size = n.cols * n.rows;
      this.g.set(n.level, new Float32Array(size));
      this.came.set(n.level, new Int32Array(size));
      this.stamp.set(n.level, new Uint32Array(size));
      this.closed.set(n.level, new Uint32Array(size));
    }
    // Stair links are pushed in pairs: up from the foot, down from the top.
    const st = bp.nav.links.filter((l) => l.kind === 'stair');
    for (let i = 0; i + 1 < st.length; i += 2) {
      const a = st[i]!;
      const b = st[i + 1]!;
      if (a.via !== b.via || a.level === b.level) continue;
      const lo = a.level < b.level ? a : b;
      const hi = lo === a ? b : a;
      const bottom = this.snap(lo.level, lo.x, lo.z, 3);
      const top = this.snap(hi.level, hi.x, hi.z, 3);
      if (bottom && top) this.stairs.push({ via: a.via, bottom, top });
    }
  }

  cellOf(level: number, x: number, z: number): number {
    const n = this.levels.get(level);
    if (!n) return -1;
    const c = Math.floor((x - n.originX) / n.cell);
    const r = Math.floor((z - n.originZ) / n.cell);
    if (c < 0 || r < 0 || c >= n.cols || r >= n.rows) return -1;
    return r * n.cols + c;
  }

  walkable(level: number, x: number, z: number): boolean {
    const n = this.levels.get(level);
    const k = this.cellOf(level, x, z);
    return !!n && k >= 0 && n.walk[k] === 1;
  }

  /** Room index under a point (-1 outside, -2 terrace). */
  roomAt(level: number, x: number, z: number): number {
    const n = this.levels.get(level);
    const k = this.cellOf(level, x, z);
    return n && k >= 0 ? n.room[k]! : -1;
  }

  /** Perch visibility (0..1) of a person standing at a point. */
  visAt(level: number, x: number, z: number): number {
    const n = this.levels.get(level);
    const k = this.cellOf(level, x, z);
    return n && k >= 0 ? n.vis[k]! / 255 : 0;
  }

  /** Centre of the walkable cell nearest a point, within `maxR` metres. */
  snap(level: number, x: number, z: number, maxR = 2): Waypoint | null {
    const n = this.levels.get(level);
    if (!n) return null;
    const c0 = Math.floor((x - n.originX) / n.cell);
    const r0 = Math.floor((z - n.originZ) / n.cell);
    const R = Math.ceil(maxR / n.cell);
    let best = -1;
    let bestD = Infinity;
    for (let dr = -R; dr <= R; dr++) {
      const r = r0 + dr;
      if (r < 0 || r >= n.rows) continue;
      for (let dc = -R; dc <= R; dc++) {
        const c = c0 + dc;
        if (c < 0 || c >= n.cols) continue;
        const k = r * n.cols + c;
        if (!n.walk[k]) continue;
        const cx = n.originX + (c + 0.5) * n.cell;
        const cz = n.originZ + (r + 0.5) * n.cell;
        const d = (cx - x) ** 2 + (cz - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
    }
    if (best < 0 || bestD > maxR * maxR) return null;
    const c = best % n.cols;
    const r = (best - c) / n.cols;
    return { level, x: n.originX + (c + 0.5) * n.cell, z: n.originZ + (r + 0.5) * n.cell };
  }

  /** Waypoints from a point to a point, possibly across storeys; null when unreachable. */
  route(from: Waypoint, to: Waypoint): Waypoint[] | null {
    if (from.level === to.level) return this.levelRoute(from, to);
    // Go one storey at a time toward the target, through the stair that makes the shortest straight-line detour.
    const up = to.level > from.level;
    const options = this.stairs.filter((s) => (up ? s.bottom.level === from.level : s.top.level === from.level) && (up ? s.top.level <= to.level : s.bottom.level >= to.level));
    if (!options.length) return null;
    const enter = (s: Stair) => (up ? s.bottom : s.top);
    const exit = (s: Stair) => (up ? s.top : s.bottom);
    options.sort((a, b) => cost(a) - cost(b));
    function cost(s: Stair): number {
      return Math.hypot(enter(s).x - from.x, enter(s).z - from.z) + Math.hypot(exit(s).x - to.x, exit(s).z - to.z);
    }
    for (const s of options.slice(0, 3)) {
      const a = this.levelRoute(from, enter(s));
      if (!a) continue;
      const b = this.route(exit(s), to);
      if (!b) continue;
      return [...a, { ...exit(s), climb: true }, ...b.slice(1)];
    }
    return null;
  }

  private levelRoute(from: Waypoint, to: Waypoint): Waypoint[] | null {
    const n = this.levels.get(from.level);
    if (!n) return null;
    const s = this.cellOf(from.level, from.x, from.z);
    const t = this.cellOf(to.level, to.x, to.z);
    if (s < 0 || t < 0 || !n.walk[t]) return null;
    if (s === t) return [from, to];
    const cells = this.astar(n, n.walk[s] ? s : this.cellOf(from.level, ...this.snapXZ(from)), t);
    if (!cells) return null;
    const pts: Waypoint[] = [from];
    // String pulling: keep a waypoint only where the straight line to the next kept one would leave the walkable floor.
    let anchor = { x: from.x, z: from.z };
    for (let i = 1; i < cells.length; i++) {
      const p = this.centre(n, cells[i]!);
      if (!this.clear(n, anchor.x, anchor.z, p.x, p.z)) {
        const q = this.centre(n, cells[i - 1]!);
        pts.push({ level: n.level, x: q.x, z: q.z });
        anchor = q;
      }
    }
    pts.push(to);
    return pts;
  }

  private snapXZ(p: Waypoint): [number, number] {
    const q = this.snap(p.level, p.x, p.z, 3);
    return q ? [q.x, q.z] : [p.x, p.z];
  }

  private centre(n: NavLevel, k: number): { x: number; z: number } {
    const c = k % n.cols;
    const r = (k - c) / n.cols;
    return { x: n.originX + (c + 0.5) * n.cell, z: n.originZ + (r + 0.5) * n.cell };
  }

  /** True when every cell the straight segment passes through is walkable (grid traversal, Amanatides–Woo). */
  clear(n: NavLevel, x0: number, z0: number, x1: number, z1: number): boolean {
    const fx0 = (x0 - n.originX) / n.cell;
    const fz0 = (z0 - n.originZ) / n.cell;
    const fx1 = (x1 - n.originX) / n.cell;
    const fz1 = (z1 - n.originZ) / n.cell;
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
    const ok = (cc: number, rr: number) => cc >= 0 && rr >= 0 && cc < n.cols && rr < n.rows && n.walk[rr * n.cols + cc] === 1;
    if (!ok(c, r)) return false;
    for (let guard = 0; guard < 4096 && (c !== c1 || r !== r1); guard++) {
      if (Math.abs(tx - tz) < 1e-9) {
        // Through a corner: both side cells must be open, as A* requires.
        if (!ok(c + sc, r) || !ok(c, r + sr)) return false;
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
      if (!ok(c, r)) return false;
    }
    return true;
  }

  private astar(n: NavLevel, s: number, t: number): number[] | null {
    if (s < 0 || !n.walk[s]) return null;
    const g = this.g.get(n.level)!;
    const came = this.came.get(n.level)!;
    const stamp = this.stamp.get(n.level)!;
    const closed = this.closed.get(n.level)!;
    const run = ++this.run;
    const cols = n.cols;
    const tc = t % cols;
    const tr = (t - tc) / cols;
    const h = (k: number) => {
      const c = k % cols;
      const r = (k - c) / cols;
      const dx = Math.abs(c - tc);
      const dz = Math.abs(r - tr);
      return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
    };
    const heap = this.heap;
    heap.clear();
    g[s] = 0;
    came[s] = -1;
    stamp[s] = run;
    heap.push(s, h(s));
    const walk = n.walk;
    while (heap.size) {
      const k = heap.pop();
      if (closed[k] === run) continue;
      closed[k] = run;
      if (k === t) {
        const out: number[] = [];
        for (let q = t; q >= 0; q = came[q]!) out.push(q);
        return out.reverse();
      }
      const c = k % cols;
      const r = (k - c) / cols;
      const gk = g[k]!;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= n.rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          const nk = rr * cols + cc;
          if (!walk[nk] || closed[nk] === run) continue;
          // No corner cutting.
          if (dr && dc && (!walk[r * cols + cc] || !walk[rr * cols + c])) continue;
          const ng = gk + (dr && dc ? SQRT2 : 1);
          if (stamp[nk] === run && g[nk]! <= ng) continue;
          stamp[nk] = run;
          g[nk] = ng;
          came[nk] = k;
          heap.push(nk, ng + h(nk));
        }
      }
    }
    return null;
  }
}
