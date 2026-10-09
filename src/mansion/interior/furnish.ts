/**
 * Furnishing (stage 7): run room recipes, pick the bar room, derive mission
 * points of interest (POIs) with reachable stand points.
 */
import type { Rect } from '../core/geom';
import type { Rng } from '../core/rng';
import type { LightSpec, Poi, PoiType, Prop, PropKind, Room, Wall } from '../core/types';
import { Placer, SIDES, type Side } from './placer';
import { bar, RECIPES } from './recipes';

export interface FurnishInput {
  rng: Rng;
  rooms: Room[];
  walls: Wall[];
  blocked: Map<string, Rect[]>;
  /** First-pass visibility per room id (architecture only). */
  visHint: Map<string, number>;
  /** Person visibility at a plan point (architecture-only tracer). */
  visAt: (x: number, z: number, floorY: number) => number;
  required: Partial<Record<PoiType, { min: number; visible: number }>>;
  /** Threshold used for "visible" while placing (a margin above validation's). */
  visibleAt: number;
  /** Doors onto roof terraces (the terrace has no walls of its own for the placer to find them on). */
  terraceDoors?: Map<string, { x: number; z: number }>;
  /** Dome hall: its rooms, the chandelier position and the wall stretches furniture may use. */
  atrium?: { roomIds: string[]; dome: { x: number; z: number; y: number }; backX: [number, number]; sideZ: [number, number] };
}

export interface FurnishOutput {
  props: Prop[];
  lights: LightSpec[];
  pois: Poi[];
  placers: Map<string, Placer>;
}

const BAR_ROOMS = new Set(['drawing-room', 'billiard-room', 'card-room', 'morning-room', 'music-room', 'grand-salon', 'ballroom', 'gallery', 'library', 'dining-room']);

export function furnish(input: FurnishInput): FurnishOutput {
  const { rng, rooms } = input;
  let pn = 0;
  let ln = 0;
  const ids = { prop: () => `p${pn++}`, light: () => `l${ln++}` };

  // The bar goes where the sniper can watch it, with a little randomness.
  const barCands = rooms
    .filter((r) => r.level === 0 && BAR_ROOMS.has(r.type))
    .map((r) => ({ r, score: (input.visHint.get(r.id) ?? 0) + rng.range(0, 0.15) + (r.type === 'ballroom' ? -0.1 : 0) }))
    .sort((a, b) => b.score - a.score);
  const barRoom = barCands[0]?.r.id;

  const placers = new Map<string, Placer>();
  const props: Prop[] = [];
  const lights: LightSpec[] = [];
  for (const room of rooms) {
    const walls = input.walls.filter((w) => w.neg === room.id || w.pos === room.id);
    const p = new Placer(room, walls, input.blocked.get(room.id) ?? [], rng.fork(room.id), ids);
    const door = input.terraceDoors?.get(room.id);
    if (door) {
      // Keep the way out of the door clear, and everything on the terrace reachable from it.
      const at = { x: Math.min(room.inner.x1 - 0.4, Math.max(room.inner.x0 + 0.4, door.x)), z: Math.min(room.inner.z1 - 0.4, Math.max(room.inner.z0 + 0.4, door.z)) };
      p.keep.push({ x0: at.x - 1.3, z0: at.z - 1.3, x1: at.x + 1.3, z1: at.z + 1.3 });
      p.mustReach.push(at);
    }
    if (input.atrium?.roomIds.includes(room.id)) {
      p.dome = input.atrium.dome;
      p.limitWalls(input.atrium.backX, input.atrium.sideZ);
    }
    // The bar claims its wall before anything else in its room.
    if (room.id === barRoom) bar(p);
    RECIPES[room.type](p, { wantBar: false });
    placers.set(room.id, p);
  }
  // Fallback: if the chosen room had no wall long enough for a bar, try the next best.
  const hasBar = () => [...placers.values()].some((p) => p.props.some((q) => q.poi === 'bar'));
  for (const c of barCands.slice(1)) {
    if (hasBar()) break;
    bar(placers.get(c.r.id)!);
  }

  // POIs with reachable stand points.
  const pois: Poi[] = [];
  let poiN = 0;
  const addPoi = (room: Room, p: Placer, prop: Prop): boolean => {
    const stand = standPoint(p, prop);
    if (!stand) {
      prop.poi = undefined;
      return false;
    }
    pois.push({ id: `poi${poiN++}`, type: prop.poi!, propId: prop.id, roomId: room.id, level: room.level, x: prop.x, y: prop.y, z: prop.z, stand, visibility: 0 });
    return true;
  };
  for (const room of rooms) {
    const p = placers.get(room.id)!;
    for (const prop of p.props) if (prop.poi) addPoi(room, p, prop);
  }

  // Repair: top up mission objects (and visible ones) that the recipes left short.
  const roomOf = new Map(rooms.map((r) => [r.id, r]));
  const isVisible = (q: Poi) => input.visAt(q.stand.x, q.stand.z, roomOf.get(q.roomId!)?.floorY ?? 0) >= input.visibleAt;
  for (const [type, need] of Object.entries(input.required) as [PoiType, { min: number; visible: number }][]) {
    const spec = FALLBACK[type];
    if (!spec) continue;
    for (let guard = 0; guard < 8; guard++) {
      const all = pois.filter((q) => q.type === type);
      const vis = all.filter(isVisible);
      const wantVisible = vis.length < need.visible;
      if (!wantVisible && all.length >= need.min) break;
      const cands = rooms
        .filter((r) => r.level === 0 && spec.rooms.includes(r.role))
        .map((r) => ({ r, score: wantVisible ? (input.visHint.get(r.id) ?? 0) : rng.next() }))
        .filter((c) => !wantVisible || c.score > 0.05)
        .sort((a, b) => b.score - a.score);
      let placed: Prop | null = null;
      for (const c of cands) {
        placed = placeFallback(placers.get(c.r.id)!, type, spec, wantVisible ? input.visAt : null, input.visibleAt);
        if (placed && addPoi(c.r, placers.get(c.r.id)!, placed)) break;
        if (placed) placers.get(c.r.id)!.remove(placed);
        placed = null;
      }
      if (!placed) break;
    }
  }
  for (const room of rooms) {
    const p = placers.get(room.id)!;
    props.push(...p.props);
    lights.push(...p.lights);
  }

  // Window spots: guests lingering at the stage French windows.
  for (const room of rooms) {
    if (room.level !== 0 || room.role !== 'party' || !room.stage) continue;
    const p = placers.get(room.id)!;
    const ws = p.windowSides()[0];
    if (!ws) continue;
    const info = p.sides[ws];
    const win = info.openings.find((o) => o.exterior && o.kind === 'french-window');
    if (!win) continue;
    const t = (win.t0 + win.t1) / 2;
    const at = p.at(ws, t, 0.75);
    const yaw = { n: 0, s: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 }[ws];
    p.mustReach.push(at);
    if (!p.connected()) {
      p.mustReach.pop();
      continue;
    }
    pois.push({ id: `poi${poiN++}`, type: 'window', roomId: room.id, level: 0, x: at.x, y: room.floorY, z: at.z, stand: { x: round(at.x), z: round(at.z), yaw }, visibility: 0 });
  }
  return { props, lights, pois, placers };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Where an NPC stands to use a prop: in front of it, else beside it; must be reachable. */
function standPoint(p: Placer, prop: Prop): Poi['stand'] | null {
  const fx = Math.sin(prop.yaw);
  const fz = Math.cos(prop.yaw);
  const dirs: [number, number][] =
    prop.mount === 'wall' || prop.kind === 'fireplace' || prop.kind === 'bookcase' || prop.kind === 'bar-counter' || prop.kind === 'clock'
      ? [[fx, fz]]
      : [
          [fx, fz],
          [-fx, -fz],
          [fz, -fx],
          [-fz, fx],
        ];
  const reach = prop.mount === 'wall' ? 1.3 : prop.kind === 'bar-counter' ? -(prop.d / 2 + 0.45) : prop.d / 2 + 0.55;
  for (const [dx, dz] of dirs) {
    // Bar: stand on the guest side (in front of the counter).
    const s = prop.kind === 'bar-counter' ? prop.d / 2 + 0.5 : reach;
    const x = prop.x + dx * s;
    const z = prop.z + dz * s;
    if (!p.isFree({ x0: x - 0.2, z0: z - 0.2, x1: x + 0.2, z1: z + 0.2 }, true)) continue;
    p.mustReach.push({ x, z });
    if (p.connected()) return { x: round(x), z: round(z), yaw: round(Math.atan2(prop.x - x, prop.z - z)) };
    p.mustReach.pop();
  }
  return null;
}

interface FallbackSpec {
  kind: PropKind;
  /** Placement modes to try, in order. */
  modes: ('wall' | 'free' | 'hang')[];
  w: number;
  d: number;
  h: number;
  gap?: number;
  occludes?: boolean;
  rooms: Room['role'][];
}

const FALLBACK: Partial<Record<PoiType, FallbackSpec>> = {
  statue: { kind: 'statue', modes: ['free'], w: 0.8, d: 0.8, h: 2.25, occludes: true, rooms: ['party', 'circulation'] },
  // An island bar facing the windows is the fallback when no wall spot is watchable.
  bar: { kind: 'bar-counter', modes: ['wall', 'free'], w: 2.6, d: 0.7, h: 1.1, gap: 0.9, rooms: ['party'] },
  painting: { kind: 'painting', modes: ['hang'], w: 1.2, d: 0.08, h: 1.0, rooms: ['party', 'circulation', 'private'] },
  piano: { kind: 'grand-piano', modes: ['free'], w: 1.55, d: 2.1, h: 1.0, rooms: ['party'] },
  ledger: { kind: 'console', modes: ['wall'], w: 1.4, d: 0.5, h: 0.88, rooms: ['circulation', 'party'] },
  fireplace: { kind: 'fireplace', modes: ['wall'], w: 2.0, d: 0.55, h: 1.4, rooms: ['party'] },
  bookshelf: { kind: 'bookcase', modes: ['wall'], w: 1.2, d: 0.45, h: 2.4, occludes: true, rooms: ['party', 'private'] },
  clock: { kind: 'clock', modes: ['wall'], w: 0.55, d: 0.38, h: 2.15, occludes: true, rooms: ['circulation', 'party'] },
  globe: { kind: 'globe', modes: ['free'], w: 0.7, d: 0.7, h: 1.05, rooms: ['party', 'private'] },
  safe: { kind: 'safe', modes: ['wall'], w: 0.7, d: 0.6, h: 1.0, rooms: ['private'] },
};

const INWARD: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], e: [-1, 0], w: [1, 0] };

/** Place one mission prop in room `p`, at a spot whose stand point is visible when `visAt` is given. */
function placeFallback(p: Placer, type: PoiType, spec: FallbackSpec, visAt: ((x: number, z: number, y: number) => number) | null, need: number): Prop | null {
  for (const mode of spec.modes) {
    const prop = mode === 'free' ? placeFree(p, type, spec, visAt, need) : placeOnWall(p, type, spec, mode, visAt, need);
    if (prop) return prop;
  }
  return null;
}

function placeFree(p: Placer, type: PoiType, spec: FallbackSpec, visAt: ((x: number, z: number, y: number) => number) | null, need: number): Prop | null {
  // Face the windows so whoever uses it stands between it and the sniper.
  const face: Side = p.windowSides()[0] ?? 'n';
  const [ix, iz] = INWARD[face];
  const dir: [number, number] = [-ix, -iz];
  const yaw = Math.round(Math.atan2(dir[0], dir[1]) / (Math.PI / 2)) * (Math.PI / 2);
  const cands: { x: number; z: number; v: number }[] = [];
  const i = p.inner;
  const m = Math.max(spec.w, spec.d) / 2 + 0.6;
  for (let x = i.x0 + m; x <= i.x1 - m; x += 0.5) {
    for (let z = i.z0 + m; z <= i.z1 - m; z += 0.5) {
      const sx = x + dir[0] * (spec.d / 2 + 0.55);
      const sz = z + dir[1] * (spec.d / 2 + 0.55);
      const v = visAt ? visAt(sx, sz, p.floorY) : 1;
      if (v >= (visAt ? need : 0)) cands.push({ x, z, v: v + p.rng.next() * 0.05 });
    }
  }
  cands.sort((a, b) => b.v - a.v);
  for (const c of cands.slice(0, 40)) {
    const prop = p.add(spec.kind, c.x, c.z, yaw, spec.w, spec.d, spec.h, { occludes: spec.occludes, variant: p.rng.int(0, 3) });
    if (prop) {
      prop.poi = type;
      return prop;
    }
  }
  return null;
}

function placeOnWall(p: Placer, type: PoiType, spec: FallbackSpec, mode: 'wall' | 'hang', visAt: ((x: number, z: number, y: number) => number) | null, need: number): Prop | null {
  const windowSide = p.windowSides()[0];
  const ok = (x: number, z: number) => !visAt || visAt(x, z, p.floorY) >= need;
  for (const side of SIDES.filter((s) => s !== windowSide)) {
    const info = p.sides[side];
    for (let t = info.t0 + spec.w / 2 + 0.2; t <= info.t1 - spec.w / 2 - 0.2; t += 0.5) {
      const reach = mode === 'hang' ? 1.3 : (spec.gap ?? 0.04) + spec.d + 0.55;
      const st = p.at(side, t, reach);
      if (!ok(st.x, st.z)) continue;
      const prop =
        mode === 'hang'
          ? p.onWall(side, spec.kind, spec.w, spec.h, p.floorY + 1.75, { prefer: t, sweep: false, variant: p.rng.int(0, 7) })
          : p.againstWall(side, spec.kind, spec.w, spec.d, spec.h, { prefer: t, sweep: false, gap: spec.gap, occludes: spec.occludes });
      if (prop) {
        prop.poi = type;
        return prop;
      }
    }
  }
  return null;
}
