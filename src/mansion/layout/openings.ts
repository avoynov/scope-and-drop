/**
 * Openings (stage 5): façade windows on the bay rhythm, then doors chosen as a
 * graph problem so that every room is reachable and private rooms are never
 * the only way through (cf. GFLAN's pass-through rule).
 */
import { containsPoint, type Rect } from '../core/geom';
import type { Rng } from '../core/rng';
import type { LevelSpec, Mass, NavLink, Opening, OpeningDressing, OpeningKind, RoomType, StyleDef, Wall } from '../core/types';
import type { MassingPlan } from './massing';
import { isPassThrough, ROLE, type RoomDraft } from './rooms';
import { wallLength } from './walls';

export interface PlacedRoom extends RoomDraft {
  inner: Rect;
}

export interface OpeningContext {
  rng: Rng;
  m: MassingPlan;
  style: StyleDef;
  levels: LevelSpec[];
  masses: Mass[];
  rooms: Map<string, PlacedRoom>;
  walls: Wall[];
  /** Plan areas a door must not open onto, per room (stairs, stairwells). */
  blocked: Map<string, Rect[]>;
}

let seq = 0;
const nextId = (p: string) => `${p}${seq++}`;

export function resetOpeningIds(): void {
  seq = 0;
}

/** Plan position of a point `u` metres along the wall. */
export function wallPoint(w: Wall, u: number): { x: number; z: number } {
  return w.axis === 'x' ? { x: w.a.x + u, z: w.a.z } : { x: w.a.x, z: w.a.z + u };
}

function uOf(w: Wall, x: number, z: number): number {
  return w.axis === 'x' ? x - w.a.x : z - w.a.z;
}

function fits(w: Wall, u0: number, u1: number, gap = 0.22, margin = 0.3): boolean {
  if (u0 < margin || u1 > wallLength(w) - margin) return false;
  return w.openings.every((o) => u1 + gap <= o.u0 || u0 >= o.u1 + gap);
}

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

interface WindowSpec {
  kind: OpeningKind;
  width: number;
  sill: number;
  head: number;
  panes: [number, number];
  leaves: 1 | 2;
  passable: boolean;
}

function windowSpec(ctx: OpeningContext, w: Wall, room: PlacedRoom, terraceFacing: boolean): WindowSpec {
  const { m, levels } = ctx;
  const lv = levels[w.level]!;
  const b = m.bay;
  if (w.level === 0 && terraceFacing && ROLE[room.type] !== 'service') {
    // Wide glazing on the stage front: about 70% of each bay is glass, so the sniper reads the room, not the piers.
    const width = Math.min(3.1, Math.max(2.4, 0.7 * b));
    return {
      kind: 'french-window',
      width,
      sill: lv.floorY,
      head: lv.floorY + Math.min(3.9, lv.height - 1.1),
      panes: [3, 5],
      leaves: 2,
      passable: true,
    };
  }
  if (w.level === 0) {
    const width = Math.min(1.7, Math.max(1.3, 0.38 * b));
    const sill = lv.floorY + 0.75;
    return { kind: 'window', width, sill, head: sill + Math.min(2.95, lv.height - 1.85), panes: [3, 4], leaves: 1, passable: false };
  }
  if (w.level === 1) {
    const width = Math.min(1.6, Math.max(1.25, 0.36 * b));
    const sill = lv.floorY + 0.65;
    return { kind: 'window', width, sill, head: sill + Math.min(2.8, lv.height - 1.3), panes: [3, 4], leaves: 1, passable: false };
  }
  const width = Math.min(1.3, Math.max(1.0, 0.3 * b));
  const sill = lv.floorY + 0.75;
  return { kind: 'window', width, sill, head: sill + Math.min(1.7, lv.height - 1.35), panes: [2, 3], leaves: 1, passable: false };
}

function dressingFor(style: StyleDef, level: number, side: Wall['side'], bayIndex: number): OpeningDressing {
  const main = side === 'garden' || side === 'entrance';
  switch (style.id) {
    case 'palladian':
      if (level === 0 && main) return { surround: true, pediment: bayIndex % 2 === 0 ? 'triangle' : 'segment' };
      return { surround: true };
    case 'georgian':
      return { surround: true, keystone: true };
    case 'beauxarts':
      if (level === 0) return { surround: true, keystone: true };
      if (level === 1 && main) return { surround: true, balconette: true, pediment: 'segment' };
      return { surround: true };
  }
}

function curtainFor(rng: Rng, room: PlacedRoom): Opening['curtain'] {
  const role = ROLE[room.type];
  const r = rng.next();
  if (role === 'party' || role === 'circulation') return r < 0.08 ? 'sheer' : 'open';
  if (r < 0.22) return 'drawn';
  if (r < 0.45) return 'sheer';
  return 'open';
}

/** Is the ground just outside this wall covered by another (lower) mass? */
function facesRoof(ctx: OpeningContext, w: Wall): boolean {
  const len = wallLength(w);
  const outward = w.neg ? 0.8 : -0.8;
  for (const t of [0.25, 0.5, 0.75]) {
    const p = wallPoint(w, len * t);
    const x = w.axis === 'z' ? p.x + outward : p.x;
    const z = w.axis === 'x' ? p.z + outward : p.z;
    if (ctx.masses.some((ms) => containsPoint(ms.rect, x, z, -0.05))) return true;
  }
  return false;
}

export function placeWindows(ctx: OpeningContext): void {
  const { m, style, rng } = ctx;
  for (const w of ctx.walls) {
    if (!w.exterior) continue;
    const room = ctx.rooms.get((w.neg ?? w.pos)!)!;
    const len = wallLength(w);
    const lv = ctx.levels[w.level]!;

    if (w.glazed) {
      // Conservatory curtain wall: one continuous glazed band above a low stone sill.
      w.openings.push({
        id: nextId('o'),
        kind: 'window',
        u0: 0.25,
        u1: len - 0.25,
        y0: lv.floorY + 0.55,
        y1: w.y1 - 0.25,
        glazed: true,
        passable: false,
        panes: [Math.max(2, Math.round(len / 0.8)), 4],
        leaves: 1,
        curtain: 'open',
      });
      continue;
    }
    if (facesRoof(ctx, w)) continue;
    if (w.level > 0 && room.type === 'service-stair' && len < 3) continue;

    const wing = m.wings.find((wg) => wg.id === w.massId);
    const terraceFacing =
      w.side === 'garden' || (!!wing && wing.toward === 'garden' && ((wing.side === 'west' && w.side === 'east') || (wing.side === 'east' && w.side === 'west')));
    const spec = windowSpec(ctx, w, room, terraceFacing);
    const centres: { u: number; bay: number }[] = [];
    if (w.axis === 'x') {
      for (let i = 0; i < m.bays; i++) {
        const x = -m.W / 2 + (i + 0.5) * m.bay;
        centres.push({ u: uOf(w, x, w.a.z), bay: i });
      }
    } else if (wing) {
      for (let j = 0; j < wing.bays; j++) {
        const z = wing.toward === 'garden' ? m.zGarden + (j + 0.5) * m.bay : m.zEntrance - (j + 0.5) * m.bay;
        centres.push({ u: uOf(w, w.a.x, z), bay: j });
      }
    } else {
      if (len < 2.2) continue; // pavilion returns
      const count = Math.max(1, Math.min(3, Math.floor(len / 3.3)));
      for (let k = 0; k < count; k++) centres.push({ u: ((k + 0.5) * len) / count, bay: k });
    }
    let width = spec.width;
    if (w.axis === 'z' && !wing && len < 3.2) width = Math.min(width, Math.max(0.9, len - 1.2));
    for (const c of centres) {
      const u0 = c.u - width / 2;
      const u1 = c.u + width / 2;
      if (!fits(w, u0, u1, 0.3, 0.45)) continue;
      w.openings.push({
        id: nextId('o'),
        kind: spec.kind,
        u0,
        u1,
        y0: spec.sill,
        y1: spec.head,
        glazed: true,
        passable: spec.passable,
        frosted: room.type === 'bathroom' || undefined,
        panes: spec.panes,
        leaves: spec.leaves,
        dressing: dressingFor(style, w.level, w.side, c.bay),
        curtain: curtainFor(rng, room),
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Roof terraces                                                       */
/* ------------------------------------------------------------------ */

export interface TerraceSpec {
  id: string;
  rect: Rect;
  level: number;
}

export interface TerraceDoor {
  x: number;
  z: number;
  from: string;
  openingId: string;
}

/**
 * A glazed door from the main block onto each flat wing roof. The wall above a lower
 * wing is otherwise blank (no window looks onto a roof), so there is always room.
 * Terraces that get no door are left out: a terrace nobody can reach is just a roof.
 */
export function placeTerraceDoors(ctx: OpeningContext, specs: TerraceSpec[]): Map<string, TerraceDoor> {
  const out = new Map<string, TerraceDoor>();
  for (const t of specs) {
    const lv = ctx.levels[t.level];
    if (!lv) continue;
    const cands: { w: Wall; a: number; b: number; room: PlacedRoom }[] = [];
    for (const w of ctx.walls) {
      if (!w.exterior || w.level !== t.level || w.glazed) continue;
      const line = w.axis === 'x' ? w.a.z : w.a.x;
      const onEdge = w.axis === 'x' ? Math.abs(line - t.rect.z0) < 1e-3 || Math.abs(line - t.rect.z1) < 1e-3 : Math.abs(line - t.rect.x0) < 1e-3 || Math.abs(line - t.rect.x1) < 1e-3;
      if (!onEdge) continue;
      const a = Math.max(w.axis === 'x' ? w.a.x : w.a.z, w.axis === 'x' ? t.rect.x0 : t.rect.z0);
      const b = Math.min(w.axis === 'x' ? w.b.x : w.b.z, w.axis === 'x' ? t.rect.x1 : t.rect.z1);
      const room = ctx.rooms.get((w.neg ?? w.pos)!);
      if (!room || b - a < 2.6 || room.type === 'service-stair' || room.type === 'hall-gallery') continue;
      cands.push({ w, a, b, room });
    }
    // Rooms guests may already cross first, bathrooms only if nothing else touches the terrace.
    const rank = (r: PlacedRoom) => (isPassThrough(r.type) ? 2 : r.type === 'bathroom' ? 0 : 1);
    cands.sort((p, q) => rank(q.room) - rank(p.room) || q.b - q.a - (p.b - p.a));
    for (const c of cands) {
      const base = c.w.axis === 'x' ? c.w.a.x : c.w.a.z;
      const u = (c.a + c.b) / 2 - base;
      const width = 1.6;
      if (!fits(c.w, u - width / 2, u + width / 2, 0.3, 0.45) || !floorBothSides(ctx, c.w, u, width)) continue;
      const o: Opening = {
        id: nextId('o'),
        kind: 'french-window',
        u0: u - width / 2,
        u1: u + width / 2,
        y0: lv.floorY,
        y1: lv.floorY + Math.min(2.7, lv.height - 1.0),
        glazed: true,
        passable: true,
        panes: [2, 4],
        leaves: 2,
        dressing: { surround: true },
        curtain: 'open',
      };
      c.w.openings.push(o);
      // Guests cross this room to reach the terrace, so it cannot stay a bedroom.
      if (!isPassThrough(c.room.type)) {
        if (c.room.type === 'bathroom') for (const w of ctx.walls) if (w.neg === c.room.id || w.pos === c.room.id) for (const q of w.openings) delete q.frosted;
        c.room.type = 'sitting-room';
      }
      const p = wallPoint(c.w, u);
      out.set(t.id, { x: p.x, z: p.z, from: c.room.id, openingId: o.id });
      break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Doors                                                               */
/* ------------------------------------------------------------------ */

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface Adjacency {
  a: string;
  b: string;
  wall: Wall;
}

function interiorAdjacency(ctx: OpeningContext, level: number): Adjacency[] {
  const out: Adjacency[] = [];
  for (const w of ctx.walls) {
    if (w.level !== level || w.exterior) continue;
    const ra = ctx.rooms.get(w.neg!)!;
    const rb = ctx.rooms.get(w.pos!)!;
    if (ra.level !== level || rb.level !== level) continue; // skip double-height voids
    out.push({ a: ra.id, b: rb.id, wall: w });
  }
  return out;
}

function doorDims(ctx: OpeningContext, a: PlacedRoom, b: PlacedRoom, kind: OpeningKind, level: number): { width: number; height: number } {
  const lv = ctx.levels[level]!;
  const clear = lv.height - ctx.m.slab;
  switch (kind) {
    case 'arch':
      return { width: 2.6, height: Math.min(3.8, clear - 0.7) };
    case 'double-door':
      return { width: level === 0 ? 1.8 : 1.5, height: Math.min(level === 0 ? 3.4 : 2.8, clear - 0.8) };
    case 'entrance':
      return { width: 2.2, height: Math.min(3.9, clear - 0.6) };
    default: {
      const party = ROLE[a.type] === 'party' && ROLE[b.type] === 'party';
      return { width: party ? 1.4 : 1.0, height: Math.min(level === 0 ? 2.9 : 2.5, clear - 0.8) };
    }
  }
}

/** Both sides of an opening need floor, not a stairwell or the side of a flight. */
function floorBothSides(ctx: OpeningContext, w: Wall, u: number, width: number): boolean {
  const p = wallPoint(w, u);
  const ts = [-width / 2 + 0.1, 0, width / 2 - 0.1];
  if (width > 2) ts.push(-width / 4, width / 4);
  for (const id of [w.neg, w.pos]) {
    if (!id) continue;
    const dir = id === w.pos ? 1 : -1;
    for (const probe of [0.45, 1.0]) {
      const x = w.axis === 'z' ? p.x + dir * probe : p.x;
      const z = w.axis === 'x' ? p.z + dir * probe : p.z;
      for (const t of ts) {
        const px = w.axis === 'x' ? x + t : x;
        const pz = w.axis === 'z' ? z + t : z;
        if ((ctx.blocked.get(id) ?? []).some((r) => containsPoint(r, px, pz))) return false;
      }
    }
  }
  return true;
}

/**
 * Column screen: open a wall between two party rooms bay by bay, leaving piers.
 * The sniper looks in at an angle, so only wide openings let a view carry from
 * the garden front through to the room behind. Returns the number of bays opened.
 */
function cutScreen(ctx: OpeningContext, w: Wall): number {
  const len = wallLength(w);
  const lv = ctx.levels[w.level]!;
  const n = Math.max(1, Math.round(len / ctx.m.bay));
  const span = len / n;
  const width = Math.min(span - 0.8, 3.6);
  if (width < 1.6) return 0;
  const height = Math.min(3.6, lv.height - ctx.m.slab - 0.7);
  let cut = 0;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) * span;
    const u0 = u - width / 2;
    const u1 = u + width / 2;
    if (!fits(w, u0, u1, 0.25, 0.35) || !floorBothSides(ctx, w, u, width)) continue;
    w.openings.push({ id: nextId('o'), kind: 'arch', u0, u1, y0: lv.floorY, y1: lv.floorY + height, glazed: false, passable: true, leaves: 2 });
    cut++;
  }
  return cut;
}

/** Try to cut a door into `w` near `preferU`; returns the opening or null. */
function cutDoor(ctx: OpeningContext, w: Wall, preferU: number, kind: OpeningKind, width: number, height: number, glazed = false): Opening | null {
  const len = wallLength(w);
  const margin = width / 2 + 0.4;
  if (len < width + 0.8) return null;
  const candidates: number[] = [];
  const clampU = (u: number) => Math.min(len - margin, Math.max(margin, u));
  candidates.push(clampU(preferU));
  for (let k = 1; k <= 40; k++) {
    candidates.push(clampU(preferU + k * 0.35), clampU(preferU - k * 0.35));
  }
  for (const u of candidates) {
    const u0 = u - width / 2;
    const u1 = u + width / 2;
    if (!fits(w, u0, u1, 0.25, 0.35)) continue;
    if (!floorBothSides(ctx, w, u, width)) continue;
    const y0 = ctx.levels[w.level]!.floorY;
    const o: Opening = {
      id: nextId('o'),
      kind,
      u0,
      u1,
      y0,
      y1: y0 + height,
      glazed,
      passable: true,
      leaves: kind === 'door' ? 1 : 2,
    };
    w.openings.push(o);
    return o;
  }
  return null;
}

export interface DoorPlanResult {
  /** Rooms retyped to keep circulation sensible. */
  retyped: { id: string; from: RoomType; to: RoomType }[];
  unreachable: string[];
  passViolations: string[];
  /** Walls opened as column screens. */
  screens: string[];
}

export function planDoors(ctx: OpeningContext): DoorPlanResult {
  const { m } = ctx;
  const retyped: DoorPlanResult['retyped'] = [];
  const unreachable: string[] = [];
  const passViolations: string[] = [];
  const doorPairs = new Set<string>();
  const screens: string[] = [];
  const maxLevel = Math.max(...[...ctx.rooms.values()].map((r) => r.level));

  const addDoor = (adj: Adjacency, kind: OpeningKind, preferU?: number, glazed = false): boolean => {
    const key = pairKey(adj.a, adj.b);
    if (doorPairs.has(key)) return true;
    const ra = ctx.rooms.get(adj.a)!;
    const rb = ctx.rooms.get(adj.b)!;
    const { width, height } = doorDims(ctx, ra, rb, kind, adj.wall.level);
    const u = preferU ?? wallLength(adj.wall) / 2;
    const o = cutDoor(ctx, adj.wall, u, kind, width, height, glazed);
    if (!o) return false;
    doorPairs.add(key);
    return true;
  };

  for (let L = 0; L <= maxLevel; L++) {
    const adjs = interiorAdjacency(ctx, L);
    const byPair = new Map<string, Adjacency[]>();
    for (const a of adjs) {
      const k = pairKey(a.a, a.b);
      let list = byPair.get(k);
      if (!list) byPair.set(k, (list = []));
      list.push(a);
    }
    const longest = (list: Adjacency[]) => list.slice().sort((p, q) => wallLength(q.wall) - wallLength(p.wall));
    const tryPair = (a: string, b: string, kind: OpeningKind, at?: (w: Wall) => number, glazed = false): boolean => {
      const list = byPair.get(pairKey(a, b));
      if (!list) return false;
      for (const adj of longest(list)) {
        if (addDoor(adj, kind, at ? at(adj.wall) : undefined, glazed)) return true;
      }
      return false;
    };
    const roomsL = [...ctx.rooms.values()].filter((r) => r.level === L);
    const typeOf = (id: string) => ctx.rooms.get(id)!.type;

    if (L === 0) {
      // 1. The grand axis: entrance hall -> (corridor) -> ballroom.
      const axisAt = (w: Wall) => uOf(w, 0, 0);
      const hall = roomsL.find((r) => r.type === 'entrance-hall');
      const ball = roomsL.find((r) => r.type === 'ballroom');
      const corr = roomsL.find((r) => r.type === 'corridor' && r.zone === 'corridor');
      if (hall && ball) {
        if (corr) {
          tryPair(hall.id, corr.id, 'double-door', axisAt);
          tryPair(corr.id, ball.id, 'double-door', axisAt);
        } else tryPair(hall.id, ball.id, 'double-door', axisAt);
      }
      // 3. Enfilade along the garden front, near the windows.
      const front = roomsL.filter((r) => r.zone === 'front').sort((p, q) => p.rect.x0 - q.rect.x0);
      const zEnf = m.zGarden - 0.3 - 1.25 - 0.9;
      for (let i = 0; i + 1 < front.length; i++) {
        tryPair(front[i]!.id, front[i + 1]!.id, 'double-door', (w) => uOf(w, w.a.x, zEnf));
      }
      // 3b. Column screens: party rooms that sit one behind the other open into each other, so the
      // garden-front view carries through. Capped by rule: only party-to-party walls parallel to the
      // garden front. Halls, corridors, service and private rooms keep solid walls and stay blind.
      for (const adj of adjs) {
        if (adj.wall.axis !== 'x') continue;
        const ra = ctx.rooms.get(adj.a)!;
        const rb = ctx.rooms.get(adj.b)!;
        if (ROLE[ra.type] !== 'party' || ROLE[rb.type] !== 'party') continue;
        if (ra.zone === 'conservatory' || rb.zone === 'conservatory') continue;
        if (cutScreen(ctx, adj.wall) > 0) {
          doorPairs.add(pairKey(adj.a, adj.b));
          screens.push(adj.wall.id);
        }
      }
      // 4. Conservatory.
      for (const r of roomsL.filter((q) => q.type === 'conservatory')) {
        for (const [k, list] of byPair) {
          if (!k.split('|').includes(r.id)) continue;
          for (const adj of longest(list)) if (addDoor(adj, 'double-door', undefined, true)) break;
        }
      }
    }

    // 5. Wings: chain rooms along the wing, and join the wing to the main block.
    for (const wing of m.wings) {
      const fromMain = (r: PlacedRoom) => (wing.toward === 'garden' ? r.rect.z0 - m.zGarden : m.zEntrance - r.rect.z1);
      const wr = roomsL.filter((r) => r.massId === wing.id && r.type !== 'corridor').sort((p, q) => fromMain(p) - fromMain(q));
      if (L === 0) {
        for (let i = 0; i + 1 < wr.length; i++) tryPair(wr[i]!.id, wr[i + 1]!.id, 'double-door');
        const first = wr[0];
        if (first) {
          const neighbours = [...byPair.keys()]
            .filter((k) => k.split('|').includes(first.id))
            .map((k) => k.split('|').find((id) => id !== first.id)!)
            .filter((id) => ctx.rooms.get(id)!.massId !== wing.id)
            .sort((p, q) => Number(isPassThrough(typeOf(q))) - Number(isPassThrough(typeOf(p))));
          for (const nb of neighbours) if (tryPair(first.id, nb, 'double-door')) break;
        }
      }
    }

    // 5b. Ring gallery of the dome hall: a door into every room beside it. (The corridor behind it
    // is joined in step 6.) Doors go near the garden end, where the gallery runs straight.
    const gallery = roomsL.find((r) => r.type === 'hall-gallery');
    if (gallery) {
      for (const k of [...byPair.keys()]) {
        const ids = k.split('|');
        if (!ids.includes(gallery.id)) continue;
        const other = ctx.rooms.get(ids.find((id) => id !== gallery.id)!)!;
        if (other.type === 'corridor') continue;
        tryPair(gallery.id, other.id, 'door', (w) => (w.axis === 'z' ? uOf(w, w.a.x, m.zGarden - 2.4) : wallLength(w) / 2));
      }
    }

    // 6. Every room opening onto a corridor or landing gets a door to it.
    for (const r of roomsL) {
      if (r.type !== 'corridor' && r.type !== 'landing') continue;
      for (const [k] of byPair) {
        const ids = k.split('|');
        if (!ids.includes(r.id)) continue;
        const other = ctx.rooms.get(ids.find((id) => id !== r.id)!)!;
        const kind: OpeningKind = (ROLE[other.type] === 'party' && L === 0) || other.type === 'hall-gallery' ? 'double-door' : 'door';
        tryPair(r.id, other.id, kind, (w) => {
          // Aim for the middle of the other room's span along the wall.
          const c = w.axis === 'x' ? (other.rect.x0 + other.rect.x1) / 2 : (other.rect.z0 + other.rect.z1) / 2;
          return w.axis === 'x' ? c - w.a.x : c - w.a.z;
        });
      }
    }

    // 7. Connectivity: grow from the root, adding doors to unreached neighbours.
    const root =
      L === 0
        ? roomsL.find((r) => r.type === 'entrance-hall')
        : ((L === 1 ? gallery : undefined) ?? roomsL.find((r) => r.type === 'landing') ?? roomsL.find((r) => r.type === 'service-stair') ?? roomsL.find((r) => r.type === 'corridor'));
    if (!root) continue;
    const neighboursWithDoor = (id: string): string[] =>
      [...doorPairs].filter((k) => k.split('|').includes(id)).map((k) => k.split('|').find((x) => x !== id)!).filter((x) => ctx.rooms.get(x)!.level === L);
    const priority = (t: RoomType) => (ROLE[t] === 'circulation' ? 3 : ROLE[t] === 'party' ? 2 : t === 'sitting-room' ? 1 : 0);
    const reach = (passOnly: boolean): Set<string> => {
      const seen = new Set<string>([root.id]);
      const queue = [root.id];
      while (queue.length) {
        const id = queue.shift()!;
        if (passOnly && id !== root.id && !isPassThrough(typeOf(id))) continue;
        for (const nb of neighboursWithDoor(id)) {
          if (!seen.has(nb)) {
            seen.add(nb);
            queue.push(nb);
          }
        }
      }
      return seen;
    };
    for (let iter = 0; iter < 40; iter++) {
      const seen = reach(false);
      const missing = roomsL.filter((r) => !seen.has(r.id));
      if (missing.length === 0) break;
      let progressed = false;
      for (const r of missing) {
        const cands = [...byPair.keys()]
          .filter((k) => k.split('|').includes(r.id))
          .map((k) => k.split('|').find((x) => x !== r.id)!)
          .filter((x) => seen.has(x))
          .sort((p, q) => priority(typeOf(q)) - priority(typeOf(p)));
        for (const c of cands) {
          if (tryPair(r.id, c, 'door')) {
            progressed = true;
            break;
          }
        }
      }
      if (!progressed) break;
    }
    const seenAll = reach(false);
    for (const r of roomsL) if (!seenAll.has(r.id)) unreachable.push(r.id);

    // 8. Pass-through repair: no private room may be the only way in.
    for (let iter = 0; iter < 20; iter++) {
      const ok = reach(true);
      const bad = roomsL.filter((r) => seenAll.has(r.id) && !ok.has(r.id));
      if (bad.length === 0) break;
      let progressed = false;
      for (const v of bad) {
        // Prefer a new door to a properly reachable pass-through neighbour.
        const cands = [...byPair.keys()]
          .filter((k) => k.split('|').includes(v.id))
          .map((k) => k.split('|').find((x) => x !== v.id)!)
          .filter((x) => ok.has(x) && isPassThrough(typeOf(x)));
        if (cands.some((c) => tryPair(v.id, c, 'door'))) {
          progressed = true;
          continue;
        }
        // Otherwise promote the blocking room to circulation.
        const blocker = neighboursWithDoor(v.id).find((x) => ok.has(x) && !isPassThrough(typeOf(x)));
        if (blocker) {
          const br = ctx.rooms.get(blocker)!;
          const to: RoomType = L === 0 ? 'morning-room' : 'landing';
          retyped.push({ id: br.id, from: br.type, to });
          br.type = to;
          progressed = true;
        }
      }
      if (!progressed) {
        passViolations.push(...bad.map((b) => b.id));
        break;
      }
    }
  }

  // Exterior doors.
  const hall = [...ctx.rooms.values()].find((r) => r.type === 'entrance-hall');
  if (hall) {
    const w = ctx.walls.find((q) => q.exterior && q.side === 'entrance' && q.level === 0 && (q.neg === hall.id || q.pos === hall.id));
    if (w) {
      const lv = ctx.levels[0]!;
      const u = uOf(w, 0, w.a.z);
      // Replace a window on the axis if one is there.
      w.openings = w.openings.filter((o) => o.u1 < u - 1.3 || o.u0 > u + 1.3);
      const h = Math.min(3.9, lv.height - ctx.m.slab - 0.6);
      w.openings.push({ id: nextId('o'), kind: 'entrance', u0: u - 1.1, u1: u + 1.1, y0: lv.floorY, y1: lv.floorY + h, glazed: false, passable: true, leaves: 2 });
    }
  }
  const cons = [...ctx.rooms.values()].find((r) => r.type === 'conservatory');
  if (cons) {
    const w = ctx.walls.find((q) => q.exterior && q.side === 'garden' && (q.neg === cons.id || q.pos === cons.id));
    const g = w?.openings[0];
    if (w && g) {
      // Split the glazed band around a central garden door.
      const mid = wallLength(w) / 2;
      const lv = ctx.levels[0]!;
      w.openings = [
        { ...g, id: nextId('o'), u1: mid - 1.0 },
        { ...g, id: nextId('o'), u0: mid + 1.0 },
        { id: nextId('o'), kind: 'double-door', u0: mid - 0.85, u1: mid + 0.85, y0: lv.floorY, y1: lv.floorY + 2.8, glazed: true, passable: true, leaves: 2 },
      ];
    }
  }

  return { retyped, unreachable, passViolations, screens };
}

/** Navigation links for every passable opening. */
export function collectLinks(ctx: OpeningContext): NavLink[] {
  const links: NavLink[] = [];
  for (const w of ctx.walls) {
    for (const o of w.openings) {
      if (!o.passable) continue;
      const p = wallPoint(w, (o.u0 + o.u1) / 2);
      const outside = w.side === 'entrance' ? 'outside' : 'terrace';
      links.push({
        kind: o.kind === 'french-window' ? 'french-window' : 'door',
        from: w.neg ?? outside,
        to: w.pos ?? outside,
        via: o.id,
        x: p.x,
        z: p.z,
        level: w.level,
      });
    }
  }
  return links;
}
