/**
 * Constraint-checked furniture placement inside one room.
 *
 * Every blocking prop must (1) sit inside the clear interior, (2) avoid other
 * props, door clearances and stairwells, (3) not stand in front of a window it
 * would block, and (4) keep every door and mission stand-point reachable,
 * verified by a flood fill after each placement (rejected props are dropped).
 */
import { overlaps, rect, type Rect } from '../core/geom';
import type { Rng } from '../core/rng';
import type { LightSpec, OpeningKind, Prop, PropKind, Room, Wall } from '../core/types';

export type Side = 'n' | 's' | 'e' | 'w';
/** Yaw that makes a prop's front (+z local) face into the room from each wall. */
export const SIDE_YAW: Record<Side, number> = { n: Math.PI, s: 0, e: -Math.PI / 2, w: Math.PI / 2 };
export const SIDES: Side[] = ['n', 's', 'e', 'w'];

export interface SideOpening {
  t0: number;
  t1: number;
  y0: number;
  y1: number;
  kind: OpeningKind;
  exterior: boolean;
  passable: boolean;
}

export interface SideInfo {
  side: Side;
  /** Coordinate of the inner wall face (z for n/s, x for e/w). */
  line: number;
  t0: number;
  t1: number;
  openings: SideOpening[];
  exterior: boolean;
  windows: number;
}

interface WallBand {
  propId?: string;
  side: Side;
  t0: number;
  t1: number;
  /** Top of floor-standing item against the wall, or [y0,y1] of a hung item. */
  y0: number;
  y1: number;
}

export class Placer {
  readonly room: Room;
  readonly sides: Record<Side, SideInfo>;
  readonly occ: { r: Rect; prop: Prop }[] = [];
  readonly keep: Rect[] = [];
  readonly blocked: Rect[];
  readonly props: Prop[] = [];
  readonly lights: LightSpec[] = [];
  readonly bands: WallBand[] = [];
  readonly mustReach: { x: number; z: number }[] = [];
  private readonly doorPoints: { x: number; z: number }[] = [];
  /** Set for the dome hall and its galleries: where the great chandelier hangs. */
  dome: { x: number; z: number; y: number } | null = null;

  constructor(
    room: Room,
    walls: Wall[],
    blocked: Rect[],
    readonly rng: Rng,
    private readonly ids: { prop: () => string; light: () => string },
  ) {
    this.room = room;
    this.blocked = blocked;
    const r = room.rect;
    const i = room.inner;
    const mk = (side: Side, line: number, t0: number, t1: number): SideInfo => ({ side, line, t0, t1, openings: [], exterior: false, windows: 0 });
    this.sides = {
      n: mk('n', i.z1, i.x0, i.x1),
      s: mk('s', i.z0, i.x0, i.x1),
      e: mk('e', i.x1, i.z0, i.z1),
      w: mk('w', i.x0, i.z0, i.z1),
    };
    for (const w of walls) {
      if (w.neg !== room.id && w.pos !== room.id) continue;
      let side: Side | null = null;
      if (w.axis === 'x' && Math.abs(w.a.z - r.z1) < 1e-3 && w.neg === room.id) side = 'n';
      else if (w.axis === 'x' && Math.abs(w.a.z - r.z0) < 1e-3 && w.pos === room.id) side = 's';
      else if (w.axis === 'z' && Math.abs(w.a.x - r.x1) < 1e-3 && w.neg === room.id) side = 'e';
      else if (w.axis === 'z' && Math.abs(w.a.x - r.x0) < 1e-3 && w.pos === room.id) side = 'w';
      if (!side) continue;
      const info = this.sides[side];
      if (w.exterior) info.exterior = true;
      const base = w.axis === 'x' ? w.a.x : w.a.z;
      for (const o of w.openings) {
        info.openings.push({ t0: base + o.u0, t1: base + o.u1, y0: o.y0, y1: o.y1, kind: o.kind, exterior: w.exterior, passable: o.passable });
        if (w.exterior && o.glazed && !o.frosted) info.windows++;
        if (o.passable && o.y0 < room.floorY + 0.5) {
          // Door clearance zone and a reachability probe just inside the door.
          const tc = base + (o.u0 + o.u1) / 2;
          const depth = o.kind === 'french-window' ? 0.9 : 1.15;
          const half = (o.u1 - o.u0) / 2 + 0.15;
          const inward = side === 'n' || side === 'e' ? -1 : 1;
          if (side === 'n' || side === 's') {
            this.keep.push(rect(tc - half, info.line, tc + half, info.line + inward * depth));
            this.doorPoints.push({ x: tc, z: info.line + inward * 0.45 });
          } else {
            this.keep.push(rect(info.line, tc - half, info.line + inward * depth, tc + half));
            this.doorPoints.push({ x: info.line + inward * 0.45, z: tc });
          }
        }
      }
    }
  }

  /**
   * Restrict the stretch of each wall that furniture may use (the rotunda's curved
   * wall hides the back corners of the rectangle the room is planned on).
   */
  limitWalls(backX: [number, number], sideZ: [number, number]): void {
    const clamp = (info: SideInfo, lo: number, hi: number) => {
      info.t0 = Math.max(info.t0, lo);
      info.t1 = Math.max(info.t0, Math.min(info.t1, hi));
    };
    clamp(this.sides.s, backX[0], backX[1]);
    clamp(this.sides.e, sideZ[0], sideZ[1]);
    clamp(this.sides.w, sideZ[0], sideZ[1]);
  }

  get floorY(): number {
    return this.room.floorY;
  }
  get ceilY(): number {
    return this.room.ceilingY;
  }
  get inner(): Rect {
    return this.room.inner;
  }
  get width(): number {
    return this.inner.x1 - this.inner.x0;
  }
  get depth(): number {
    return this.inner.z1 - this.inner.z0;
  }
  get cx(): number {
    return (this.inner.x0 + this.inner.x1) / 2;
  }
  get cz(): number {
    return (this.inner.z0 + this.inner.z1) / 2;
  }
  get longAxis(): 'x' | 'z' {
    return this.width >= this.depth ? 'x' : 'z';
  }

  /** Sides with exterior glazing, most windows first. */
  windowSides(): Side[] {
    return SIDES.filter((s) => this.sides[s].windows > 0).sort((a, b) => this.sides[b].windows - this.sides[a].windows);
  }

  /** Sides ordered by how much uninterrupted wall they offer. */
  solidSides(): Side[] {
    const score = (s: Side) => {
      const info = this.sides[s];
      const len = info.t1 - info.t0;
      const cut = info.openings.reduce((a, o) => a + (o.t1 - o.t0), 0);
      return len - cut * 1.5 - info.windows * 2;
    };
    return SIDES.slice().sort((a, b) => score(b) - score(a));
  }

  footprint(x: number, z: number, yaw: number, w: number, d: number): Rect {
    const q = Math.round(yaw / (Math.PI / 2)) & 1;
    const hw = (q ? d : w) / 2;
    const hd = (q ? w : d) / 2;
    return rect(x - hw, z - hd, x + hw, z + hd);
  }

  isFree(r: Rect, ignoreKeep = false): boolean {
    const i = this.inner;
    if (r.x0 < i.x0 - 1e-3 || r.x1 > i.x1 + 1e-3 || r.z0 < i.z0 - 1e-3 || r.z1 > i.z1 + 1e-3) return false;
    if (this.occ.some((o) => overlaps(o.r, r, 1e-3))) return false;
    if (this.blocked.some((b) => overlaps(b, r, 1e-3))) return false;
    if (!ignoreKeep && this.keep.some((k) => overlaps(k, r, 1e-3))) return false;
    return true;
  }

  /** Flood fill on a 0.25 m grid: are all doors and stand points mutually reachable? */
  connected(): boolean {
    const pts = [...this.doorPoints, ...this.mustReach];
    if (pts.length <= 1) return true;
    const cell = 0.25;
    const i = this.inner;
    const cols = Math.max(1, Math.ceil((i.x1 - i.x0) / cell));
    const rows = Math.max(1, Math.ceil((i.z1 - i.z0) / cell));
    const grid = new Uint8Array(cols * rows);
    // Stricter than the nav grid's agent so placer-connected implies nav-connected.
    const agent = 0.28;
    const obstacles = [...this.occ.map((o) => o.r), ...this.blocked];
    for (let r = 0; r < rows; r++) {
      const z = i.z0 + (r + 0.5) * cell;
      for (let c = 0; c < cols; c++) {
        const x = i.x0 + (c + 0.5) * cell;
        let blocked = x < i.x0 + agent || x > i.x1 - agent || z < i.z0 + agent || z > i.z1 - agent;
        if (!blocked) {
          for (const o of obstacles) {
            if (x > o.x0 - agent && x < o.x1 + agent && z > o.z0 - agent && z < o.z1 + agent) {
              blocked = true;
              break;
            }
          }
        }
        grid[r * cols + c] = blocked ? 1 : 0;
      }
    }
    const idx = (p: { x: number; z: number }) => {
      const c = Math.min(cols - 1, Math.max(0, Math.floor((p.x - i.x0) / cell)));
      const r = Math.min(rows - 1, Math.max(0, Math.floor((p.z - i.z0) / cell)));
      return r * cols + c;
    };
    const start = idx(pts[0]!);
    if (grid[start]) return false;
    const seen = new Uint8Array(cols * rows);
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const k = queue.pop()!;
      const c = k % cols;
      const r = (k - c) / cols;
      const nb = [c > 0 ? k - 1 : -1, c < cols - 1 ? k + 1 : -1, r > 0 ? k - cols : -1, r < rows - 1 ? k + cols : -1];
      for (const n of nb) {
        if (n >= 0 && !seen[n] && !grid[n]) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }
    return pts.every((p) => seen[idx(p)] === 1);
  }

  add(
    kind: PropKind,
    x: number,
    z: number,
    yaw: number,
    w: number,
    d: number,
    h: number,
    opts: { y?: number; blocks?: boolean; occludes?: boolean; mount?: Prop['mount']; variant?: number; color?: string; ignoreKeep?: boolean; force?: boolean } = {},
  ): Prop | null {
    const blocks = opts.blocks ?? true;
    const fp = this.footprint(x, z, yaw, w, d);
    if (blocks && !opts.force && !this.isFree(fp, opts.ignoreKeep)) return null;
    const prop: Prop = {
      id: this.ids.prop(),
      kind,
      roomId: this.room.id,
      level: this.room.level,
      x: round(x),
      y: round(opts.y ?? this.floorY),
      z: round(z),
      yaw: round(yaw),
      w: round(w),
      d: round(d),
      h: round(h),
      variant: opts.variant ?? 0,
      color: opts.color,
      mount: opts.mount ?? 'floor',
      blocksNav: blocks,
      occludes: opts.occludes ?? false,
    };
    if (blocks) {
      this.occ.push({ r: fp, prop });
      if (!opts.force && !this.connected()) {
        this.occ.pop();
        return null;
      }
    }
    this.props.push(prop);
    return prop;
  }

  remove(prop: Prop): void {
    const i = this.props.indexOf(prop);
    if (i >= 0) this.props.splice(i, 1);
    const j = this.occ.findIndex((o) => o.prop === prop);
    if (j >= 0) this.occ.splice(j, 1);
    for (let k = this.bands.length - 1; k >= 0; k--) if (this.bands[k]!.propId === prop.id) this.bands.splice(k, 1);
  }

  /** Is span [t0,t1] on a side clear of openings that an item of height h would clash with? */
  spanClear(side: Side, t0: number, t1: number, yTop: number, yBottom = this.floorY): boolean {
    const info = this.sides[side];
    if (t0 < info.t0 - 1e-3 || t1 > info.t1 + 1e-3) return false;
    for (const o of info.openings) {
      if (t1 > o.t0 - 0.12 && t0 < o.t1 + 0.12 && yTop > o.y0 - 0.05 && yBottom < o.y1 + 0.05) return false;
    }
    for (const b of this.bands) {
      if (b.side === side && t1 > b.t0 && t0 < b.t1 && yTop > b.y0 && yBottom < b.y1) return false;
    }
    return true;
  }

  /** Free stretches of a side for items of height h (sorted by length, longest first). */
  freeRuns(side: Side, h: number, minLen: number): [number, number][] {
    const info = this.sides[side];
    const cuts: [number, number][] = [];
    for (const o of info.openings) if (h + this.floorY > o.y0 - 0.05) cuts.push([o.t0 - 0.15, o.t1 + 0.15]);
    for (const b of this.bands) if (b.side === side && this.floorY + h > b.y0 && this.floorY < b.y1) cuts.push([b.t0, b.t1]);
    cuts.sort((a, b) => a[0] - b[0]);
    const runs: [number, number][] = [];
    let cur = info.t0 + 0.05;
    for (const [a, b] of cuts) {
      if (a > cur) runs.push([cur, Math.min(a, info.t1 - 0.05)]);
      cur = Math.max(cur, b);
    }
    if (info.t1 - 0.05 > cur) runs.push([cur, info.t1 - 0.05]);
    return runs.filter(([a, b]) => b - a >= minLen).sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
  }

  /** Plan point at distance `off` from a side's wall face, at position t along it. */
  at(side: Side, t: number, off: number): { x: number; z: number } {
    const info = this.sides[side];
    switch (side) {
      case 'n':
        return { x: t, z: info.line - off };
      case 's':
        return { x: t, z: info.line + off };
      case 'e':
        return { x: info.line - off, z: t };
      case 'w':
        return { x: info.line + off, z: t };
    }
  }

  /** Place a floor item with its back to a wall. Tries `prefer` first, then sweeps. */
  againstWall(
    side: Side,
    kind: PropKind,
    w: number,
    d: number,
    h: number,
    opts: { prefer?: number; gap?: number; occludes?: boolean; variant?: number; color?: string; blocks?: boolean; sweep?: boolean } = {},
  ): Prop | null {
    const info = this.sides[side];
    const gap = opts.gap ?? 0.04;
    const mid = (info.t0 + info.t1) / 2;
    const prefer = opts.prefer ?? mid;
    const cands = [prefer];
    if (opts.sweep !== false) for (let k = 1; k < 40; k++) cands.push(prefer + k * 0.3, prefer - k * 0.3);
    for (const t of cands) {
      if (t - w / 2 < info.t0 + 0.02 || t + w / 2 > info.t1 - 0.02) continue;
      if (!this.spanClear(side, t - w / 2, t + w / 2, this.floorY + h)) continue;
      const p = this.at(side, t, gap + d / 2);
      const prop = this.add(kind, p.x, p.z, SIDE_YAW[side], w, d, h, { occludes: opts.occludes, variant: opts.variant, color: opts.color, blocks: opts.blocks });
      if (prop) {
        this.bands.push({ propId: prop.id, side, t0: t - w / 2, t1: t + w / 2, y0: this.floorY, y1: this.floorY + h });
        return prop;
      }
    }
    return null;
  }

  /** Hang an item on a wall (painting, mirror, sconce). */
  onWall(side: Side, kind: PropKind, w: number, h: number, yc: number, opts: { prefer?: number; sweep?: boolean; variant?: number; color?: string } = {}): Prop | null {
    const info = this.sides[side];
    const mid = (info.t0 + info.t1) / 2;
    const prefer = opts.prefer ?? mid;
    const cands = [prefer];
    if (opts.sweep !== false) for (let k = 1; k < 30; k++) cands.push(prefer + k * 0.35, prefer - k * 0.35);
    for (const t of cands) {
      const t0 = t - w / 2;
      const t1 = t + w / 2;
      if (t0 < info.t0 + 0.15 || t1 > info.t1 - 0.15) continue;
      if (!this.spanClear(side, t0, t1, yc + h / 2, yc - h / 2)) continue;
      const p = this.at(side, t, 0.04);
      const prop = this.add(kind, p.x, p.z, SIDE_YAW[side], w, 0.08, h, { y: yc - h / 2, blocks: false, mount: 'wall', variant: opts.variant, color: opts.color });
      if (prop) {
        this.bands.push({ propId: prop.id, side, t0: t0 - 0.2, t1: t1 + 0.2, y0: yc - h / 2 - 0.15, y1: yc + h / 2 + 0.15 });
        return prop;
      }
    }
    return null;
  }

  light(kind: LightSpec['kind'], x: number, y: number, z: number, color: [number, number, number], intensity: number, range: number): void {
    this.lights.push({ id: this.ids.light(), kind, scope: this.room.id, x: round(x), y: round(y), z: round(z), color, intensity: round(intensity), range: round(range) });
  }

  pick<T>(items: readonly T[]): T {
    return this.rng.pick(items);
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
