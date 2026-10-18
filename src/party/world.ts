/**
 * The house as things that change during the evening: doors that swing and lock, keys,
 * curtains, room lights and the items people carry, set down and lose (milestone 2 plan:
 * World objects).
 *
 * Everything is worked out once from the blueprint and kept here as plain data. The
 * blueprint itself is never changed, so the generator's output and tests stay as they are.
 */
import { collectOccluders } from "../mansion/analysis/occluders";
import { SightlineTracer } from "../mansion/analysis/sightlines";
import { VIS_BLOCK } from "../mansion/analysis/nav";
import type { Rng } from "../mansion/core/rng";
import type { MansionBlueprint, Opening, Room, RoomType, Wall } from "../mansion/core/types";
import type { DoorGate, Pathfinder, Walker } from "./path";
import type { DrinkId } from "./types";

// ------------------------------------------------------------------- doors

/** How a door locks: not at all, a bolt on the inside, or a key. */
export type LockKind = "none" | "inside" | "key";

export interface Door {
  id: number;
  /** Opening.id, the same as NavLink.via. */
  opening: string;
  kind: "door" | "double-door";
  /** Room index on the wall's negative and positive sides. */
  rooms: [number, number];
  level: number;
  /** Centre of the doorway on the wall line. */
  x: number;
  z: number;
  /** The wall runs along this axis; the doorway is crossed along the other. */
  axis: "x" | "z";
  width: number;
  /** Nav cells inside the wall band: every route through the doorway crosses one. */
  cells: Int32Array;
  /** 0 closed to 1 open, eased toward `target`. */
  open: number;
  target: number;
  lock: LockKind;
  locked: boolean;
  /** Who bolted it from inside, or -1. */
  lockedBy: number;
  /** The room its bolt is on (the bathroom or guest bedroom side), or -1. Anyone in there can draw it back. */
  inner: number;
  /** The ring that opens it when it is locked with a key. */
  ring: "staff" | "host";
  /** Closes behind whoever walks through: bedrooms, the study, guest bedrooms. */
  closes: boolean;
  /** Leads only into a private room, so nobody walks through it on the way elsewhere. */
  dead: boolean;
}

/** A door left ajar: a free bathroom, readable from across the room. */
export const AJAR = 0.3;
/** In-game seconds a door takes to swing fully (half a real second). */
export const SWING = 1.5;
/** Extra route cost of a closed (unlocked) door, in nav cells: about 1.5 in-game s of walking. */
export const CLOSED_COST = 3;
/** Route cost of walking through a private room to reach somewhere else, in nav cells. */
export const DEAD_COST = 60;

/** What a person brings to a locked door: their id (for a bolt they drew), their ring and any lent key. */
export type Access = Walker;

const PRIVATE: ReadonlySet<RoomType> = new Set(["bedroom", "bathroom", "dressing-room", "study"]);

// ---------------------------------------------------------------- curtains

export type CurtainState = "open" | "sheer" | "drawn";

export interface Curtain {
  id: number;
  opening: string;
  /** Room index the window lights. */
  room: number;
  level: number;
  x: number;
  z: number;
  state: CurtainState;
  /** As the house was generated: what the baked visibility grid already includes. */
  base: CurtainState;
  /** Someone at the party may draw or open it (bedrooms, dressing and sitting rooms, the study, the cinema). */
  movable: boolean;
  /** The window faces the sniper's perch, so its state changes what the perch sees in that room. */
  towardPerch: boolean;
}

/** How much of the light a window lets through, as the occluders weigh it (occluders.ts). */
export const CURTAIN_TRANSMIT: Record<CurtainState, number> = { open: 0.92, sheer: 0.45, drawn: 0 };

export const MOVABLE_CURTAINS: ReadonlySet<RoomType> = new Set(["bedroom", "dressing-room", "sitting-room", "study", "cinema"]);

// ------------------------------------------------------------------ lights

/** A room's light scale when switched off: the room still reads by spill from next door. */
export const LIGHT_OFF = 0.08;

// ------------------------------------------------------------------- items

/** An earring lost on the floor, the shards of a vase, red wine on the carpet: the small dramas' things. */
export type ItemKind = "glass" | "tray" | "bottle" | "kit" | "bandage" | "bag" | "coat" | "spectacles" | "camera" | "earring" | "shards" | "stain";
export const ITEM_KINDS: readonly ItemKind[] = ["glass", "tray", "bottle", "kit", "bandage", "bag", "coat", "spectacles", "camera", "earring", "shards", "stain"];

/**
 * full: a glass with drink in it. empty: drunk. down: set down somewhere, drink and all.
 * carried, worn, hung (a coat in the coat room), shelved (where it lives), lost, broken,
 * cleared (taken away by staff: out of play).
 */
export type ItemState = "full" | "empty" | "down" | "carried" | "worn" | "hung" | "shelved" | "lost" | "broken" | "cleared";
export const ITEM_STATES: readonly ItemState[] = ["full", "empty", "down", "carried", "worn", "hung", "shelved", "lost", "broken", "cleared"];

export const DRINK_IDS: readonly DrinkId[] = ["champagne", "red", "white", "beer", "whisky", "water"];

/**
 * Every item in play, struct-of-arrays. Ids are dense and never reused, so an id held
 * anywhere stays valid for the evening.
 */
export class Items {
  n = 0;
  kind = new Uint8Array(0);
  state = new Uint8Array(0);
  owner = new Int16Array(0);
  holder = new Int16Array(0);
  level = new Int8Array(0);
  x = new Float32Array(0);
  z = new Float32Array(0);
  room = new Int16Array(0);
  /** In-game time of the last state change. */
  since = new Float32Array(0);
  /** Glasses and trays: what is in them (index into DRINK_IDS). */
  drink = new Uint8Array(0);
  /** Glasses: 1 full to 0 empty. */
  fill = new Float32Array(0);
  /** Trays: glasses left on it. */
  count = new Uint8Array(0);

  constructor(capacity = 512) {
    this.grow(capacity);
  }

  private grow(cap: number): void {
    const keep = <T extends { set(a: ArrayLike<number>): void }>(a: T, b: T): T => (b.set(a as unknown as ArrayLike<number>), b);
    this.kind = keep(this.kind, new Uint8Array(cap));
    this.state = keep(this.state, new Uint8Array(cap));
    this.owner = keep(this.owner, new Int16Array(cap));
    this.holder = keep(this.holder, new Int16Array(cap));
    this.level = keep(this.level, new Int8Array(cap));
    this.x = keep(this.x, new Float32Array(cap));
    this.z = keep(this.z, new Float32Array(cap));
    this.room = keep(this.room, new Int16Array(cap));
    this.since = keep(this.since, new Float32Array(cap));
    this.drink = keep(this.drink, new Uint8Array(cap));
    this.fill = keep(this.fill, new Float32Array(cap));
    this.count = keep(this.count, new Uint8Array(cap));
  }

  add(kind: ItemKind, state: ItemState, owner: number, holder: number, at: { level: number; x: number; z: number; room: number }, t: number): number {
    if (this.n >= this.kind.length) this.grow(this.kind.length * 2);
    const i = this.n++;
    this.kind[i] = ITEM_KINDS.indexOf(kind);
    this.state[i] = ITEM_STATES.indexOf(state);
    this.owner[i] = owner;
    this.holder[i] = holder;
    this.place(i, at);
    this.since[i] = t;
    this.fill[i] = 0;
    this.count[i] = 0;
    this.drink[i] = 0;
    return i;
  }

  kindOf(i: number): ItemKind {
    return ITEM_KINDS[this.kind[i]!]!;
  }

  stateOf(i: number): ItemState {
    return ITEM_STATES[this.state[i]!]!;
  }

  drinkOf(i: number): DrinkId {
    return DRINK_IDS[this.drink[i]!]!;
  }

  set(i: number, state: ItemState, t: number): void {
    this.state[i] = ITEM_STATES.indexOf(state);
    this.since[i] = t;
  }

  place(i: number, at: { level: number; x: number; z: number; room: number }): void {
    this.level[i] = at.level;
    this.x[i] = at.x;
    this.z[i] = at.z;
    this.room[i] = at.room;
  }

  /** Ids of items in a state, optionally of one kind (for tests and the lab). */
  where(state: ItemState, kind?: ItemKind): number[] {
    const s = ITEM_STATES.indexOf(state);
    const k = kind ? ITEM_KINDS.indexOf(kind) : -1;
    const out: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.state[i] === s && (k < 0 || this.kind[i] === k)) out.push(i);
    return out;
  }
}

// ------------------------------------------------------------------- world

/** One way out of a room: a doorway, a French window or a stair. */
export interface RoomEdge {
  /** Room index on the other side; -2 is the terrace. */
  to: number;
  via: string;
  kind: "door" | "french-window" | "stair";
  /** World door id when the doorway has a door, else -1. */
  door: number;
  level: number;
  x: number;
  z: number;
}

export interface WorldOptions {
  /** Rooms of the guest bedrooms to leave unlocked (default: chosen from the seed). */
  guestBedrooms?: number[];
}

export class World implements DoorGate {
  readonly doors: Door[] = [];
  /** Per storey: nav cell -> door id, -1 elsewhere. */
  private readonly doorCells = new Map<number, Int16Array>();
  /** Room graph from nav.links, indexed by room index; the terrace is the last entry. */
  readonly graph: RoomEdge[][];
  readonly curtains: Curtain[] = [];
  /** Curtain ids per room index. */
  readonly roomCurtains: number[][];
  readonly lightOn: Uint8Array;
  readonly items = new Items();
  /** Bedrooms left open for guests (the coat room and a spare), by room index. */
  readonly guestBedrooms: number[];
  /** Bumped whenever a lock changes (the room graph's components are recomputed). */
  epoch = 0;
  /**
   * Bumped when a door that isn't a private room's own unlocks: a cached route that went round it may now be long.
   * Private rooms are never a way through, so a bathroom bolting and unbolting all evening leaves the cache alone.
   */
  unlocks = 0;
  /** Who has a door bolted from inside right now, and the rooms bolted. */
  private readonly bolters = new Set<number>();
  private readonly boltedRooms = new Set<number>();
  /** Connected rooms per kind of walker, for the current epoch. */
  private comps = new Map<string, Int32Array>();
  private compsEpoch = -1;

  private visOpenTracer: SightlineTracer | null = null;
  private visOpen = new Map<number, Map<number, number>>();

  constructor(
    private readonly bp: MansionBlueprint,
    private readonly pf: Pathfinder,
    rng: Rng,
    opts: WorldOptions = {},
  ) {
    const R = bp.rooms.length;
    const byId = new Map(bp.rooms.map((r) => [r.id, r]));
    this.guestBedrooms = opts.guestBedrooms ?? pickGuestBedrooms(bp, rng);
    for (const n of pf.levels.values()) this.doorCells.set(n.level, new Int16Array(n.cols * n.rows).fill(-1));

    for (const w of bp.walls) {
      if (w.exterior || !w.neg || !w.pos) continue;
      for (const o of w.openings) {
        if (!o.passable || (o.kind !== "door" && o.kind !== "double-door")) continue;
        const a = byId.get(w.neg);
        const b = byId.get(w.pos);
        if (!a || !b) continue;
        this.addDoor(w, o, a, b);
      }
    }

    this.graph = Array.from({ length: R + 1 }, () => []);
    const doorOf = new Map(this.doors.map((d) => [d.opening, d.id]));
    const idx = (id: string): number | null => (id === "terrace" ? -2 : (byId.get(id)?.index ?? null));
    for (const l of bp.nav.links) {
      const a = idx(l.from);
      const b = idx(l.to);
      if (a === null || b === null) continue;
      const edge = (to: number): RoomEdge => ({ to, via: l.via, kind: l.kind, door: doorOf.get(l.via) ?? -1, level: l.level, x: l.x, z: l.z });
      if (l.kind === "stair") {
        // Stair links come once per end; the end's own room is `from`.
        this.graph[a < 0 ? R : a]!.push(edge(b));
      } else {
        this.graph[a < 0 ? R : a]!.push(edge(b));
        this.graph[b < 0 ? R : b]!.push(edge(a));
      }
    }

    this.roomCurtains = Array.from({ length: R }, () => []);
    const eye = bp.site.perch.eye;
    for (const w of bp.walls) {
      if (!w.exterior) continue;
      const inside = w.neg ?? w.pos;
      const room = inside ? byId.get(inside) : undefined;
      if (!room) continue;
      // The outside face looks toward the side with no room.
      const out = w.neg ? 1 : -1;
      for (const o of w.openings) {
        if (!o.glazed || o.frosted || !o.curtain) continue;
        const u = (o.u0 + o.u1) / 2;
        const x = w.axis === "x" ? w.a.x + u : w.a.x;
        const z = w.axis === "x" ? w.a.z : w.a.z + u;
        const toward = (w.axis === "x" ? (eye.z - z) * out : (eye.x - x) * out) > 0;
        const c: Curtain = {
          id: this.curtains.length,
          opening: o.id,
          room: room.index,
          level: w.level,
          x,
          z,
          state: o.curtain,
          base: o.curtain,
          movable: MOVABLE_CURTAINS.has(room.type),
          towardPerch: toward,
        };
        this.curtains.push(c);
        this.roomCurtains[room.index]!.push(c.id);
      }
    }

    this.lightOn = new Uint8Array(R);
    for (const r of bp.rooms) this.lightOn[r.index] = r.lit > 0 ? 1 : 0;
  }

  private addDoor(w: Wall, o: Opening, a: Room, b: Room): void {
    const id = this.doors.length;
    const base = w.axis === "x" ? w.a.x : w.a.z;
    const line = w.axis === "x" ? w.a.z : w.a.x;
    const n = this.pf.levels.get(w.level);
    const cellsOut: number[] = [];
    if (n) {
      // The band inside the wall, at least one cell deep so that no route can step over it.
      const half = Math.max(w.thickness / 2, n.cell / 2 + 1e-3);
      const t0 = base + o.u0;
      const t1 = base + o.u1;
      const x0 = w.axis === "x" ? t0 : line - half;
      const x1 = w.axis === "x" ? t1 : line + half;
      const z0 = w.axis === "x" ? line - half : t0;
      const z1 = w.axis === "x" ? line + half : t1;
      const c0 = Math.max(0, Math.floor((x0 - n.originX) / n.cell));
      const c1 = Math.min(n.cols - 1, Math.floor((x1 - n.originX) / n.cell));
      const r0 = Math.max(0, Math.floor((z0 - n.originZ) / n.cell));
      const r1 = Math.min(n.rows - 1, Math.floor((z1 - n.originZ) / n.cell));
      const at = this.doorCells.get(w.level)!;
      for (let r = r0; r <= r1; r++) {
        const cz = n.originZ + (r + 0.5) * n.cell;
        if (cz < z0 || cz > z1) continue;
        for (let c = c0; c <= c1; c++) {
          const cx = n.originX + (c + 0.5) * n.cell;
          if (cx < x0 || cx > x1) continue;
          const k = r * n.cols + c;
          if (!n.walk[k] || at[k]! >= 0) continue;
          at[k] = id;
          cellsOut.push(k);
        }
      }
    }
    const types = [a.type, b.type];
    const bath = types.includes("bathroom");
    const guest = this.guestBedrooms.includes(a.index) || this.guestBedrooms.includes(b.index);
    // A room's own entrance: the private room on one side, a room you can come from on the other.
    const entranceTo = (t: RoomType) => types.includes(t) && types.some((x) => !PRIVATE.has(x) || x === "bathroom");
    let lock: LockKind = "none";
    let locked = false;
    let open = 1;
    let ring: Door["ring"] = "host";
    let closes = false;
    let inner = -1;
    if (bath) {
      lock = "inside";
      open = AJAR;
      inner = a.type === "bathroom" ? a.index : b.index;
    } else if (guest && types.includes("bedroom")) {
      // A guest bedroom: unlocked with the key inside, so it bolts from inside like a bathroom.
      lock = "inside";
      open = 0;
      closes = true;
      inner = this.guestBedrooms.includes(a.index) ? a.index : b.index;
    } else if (entranceTo("bedroom") || types.includes("study")) {
      lock = "key";
      locked = true;
      open = 0;
      closes = true;
    } else if (types.includes("pantry")) {
      lock = "key";
      ring = "staff";
    }
    const dead = types.some((t) => PRIVATE.has(t));
    this.doors.push({
      id,
      opening: o.id,
      kind: o.kind === "double-door" ? "double-door" : "door",
      rooms: [a.index, b.index],
      level: w.level,
      x: w.axis === "x" ? base + (o.u0 + o.u1) / 2 : line,
      z: w.axis === "x" ? line : base + (o.u0 + o.u1) / 2,
      axis: w.axis,
      width: o.u1 - o.u0,
      cells: Int32Array.from(cellsOut),
      open,
      target: open,
      lock,
      locked,
      lockedBy: -1,
      inner,
      ring,
      closes,
      dead,
    });
  }

  // ---------------------------------------------------- the gate for routes

  doorAt(level: number): Int16Array | undefined {
    return this.doorCells.get(level);
  }

  count(): number {
    return this.doors.length;
  }

  cost(d: number, who: Walker | null, a: number, b: number): number {
    const door = this.doors[d]!;
    if (!this.canPass(door, who)) return Infinity;
    let c = door.open < 0.5 ? CLOSED_COST : 0;
    if (door.dead && !door.rooms.includes(a) && !door.rooms.includes(b)) c += DEAD_COST;
    return c;
  }

  passable(d: number, who: Walker | null): boolean {
    return this.canPass(this.doors[d]!, who);
  }

  /**
   * Whether any route joins two rooms for this walker, from the room graph alone (-2 is the terrace).
   * Lets a route to somewhere behind a locked door fail at once instead of searching the whole storey.
   */
  reachable(a: number, b: number, who: Walker | null): boolean {
    if (a === b) return true;
    // Someone behind a bolt can draw it; let the search decide.
    if (who && (this.bolters.has(who.id) || this.boltedRooms.has(who.room))) return true;
    if (this.compsEpoch !== this.epoch) {
      this.comps.clear();
      this.compsEpoch = this.epoch;
    }
    const key = who ? `${who.ring}:${who.lentKey}` : "-";
    let c = this.comps.get(key);
    if (!c) this.comps.set(key, (c = this.components(who)));
    const R = this.graph.length - 1;
    return c[a < 0 ? R : a] === c[b < 0 ? R : b];
  }

  /** Union-find over the room graph, crossing only the doors this walker can pass. */
  private components(who: Walker | null): Int32Array {
    const n = this.graph.length;
    const up = new Int32Array(n);
    for (let i = 0; i < n; i++) up[i] = i;
    const find = (i: number): number => {
      while (up[i] !== i) i = up[i] = up[up[i]!]!;
      return i;
    };
    const R = n - 1;
    this.graph.forEach((edges, a) => {
      for (const e of edges) {
        if (e.door >= 0 && !this.canPass(this.doors[e.door]!, who)) continue;
        const ra = find(a);
        const rb = find(e.to < 0 ? R : e.to);
        if (ra !== rb) up[ra] = rb;
      }
    });
    for (let i = 0; i < n; i++) up[i] = find(i);
    return up;
  }

  /** Door id at a nav cell, or -1. */
  doorAtCell(level: number, k: number): number {
    return k >= 0 ? (this.doorCells.get(level)?.[k] ?? -1) : -1;
  }

  /** Door id at a point, or -1. */
  doorAtPoint(level: number, x: number, z: number): number {
    return this.doorAtCell(level, this.pf.cellOf(level, x, z));
  }

  /** Whether someone with this access can walk through a door now. */
  canPass(d: Door, who: Access | null): boolean {
    if (!d.locked) return true;
    if (!who) return false;
    if (d.lock === "inside") return d.lockedBy === who.id || who.room === d.inner;
    return who.ring === "host" || (who.ring === "staff" && d.ring === "staff") || who.lentKey === d.id;
  }

  /** Lock or unlock a door. `by` is who turns the key or the bolt. */
  setLocked(d: Door, locked: boolean, by: number): void {
    if (d.locked === locked) return;
    if (d.lockedBy >= 0) {
      this.bolters.delete(d.lockedBy);
      this.boltedRooms.delete(d.inner);
    }
    d.locked = locked;
    if (!locked && !d.dead) this.unlocks++;
    d.lockedBy = locked && d.lock === "inside" ? by : -1;
    if (d.lockedBy >= 0) {
      this.bolters.add(d.lockedBy);
      this.boltedRooms.add(d.inner);
    }
    this.epoch++;
  }

  /** Start a door swinging toward open (1), ajar or shut (0). */
  swing(d: Door, target: number): void {
    d.target = target;
  }

  /** Ease the doors toward where they are being pushed. */
  step(dt: number): void {
    const k = dt / SWING;
    for (const d of this.doors) {
      if (d.open === d.target) continue;
      d.open = d.open < d.target ? Math.min(d.target, d.open + k) : Math.max(d.target, d.open - k);
    }
  }

  roomType(room: number): RoomType {
    return this.bp.rooms[room]!.type;
  }

  /** The room a door opens onto from a given side (its other room). */
  otherSide(d: Door, room: number): number {
    return d.rooms[0] === room ? d.rooms[1] : d.rooms[0];
  }

  // -------------------------------------------------------------- lights

  /** A room's light scale: 1 on, LIGHT_OFF off. */
  lightLevel(room: number): number {
    return this.lightOn[room] ? 1 : LIGHT_OFF;
  }

  /** How well lit a room is now, 0 to 1: its party lighting times the switch. */
  lit(room: number): number {
    const r = this.bp.rooms[room];
    if (!r) return 1;
    return this.lightOn[room] ? Math.max(r.lit, 0.35) : r.lit * LIGHT_OFF;
  }

  /** Whether the room's lights were on when the evening began. */
  litAtStart(room: number): boolean {
    return (this.bp.rooms[room]?.lit ?? 0) > 0;
  }

  setLight(room: number, on: boolean): boolean {
    const v = on ? 1 : 0;
    if (this.lightOn[room] === v) return false;
    this.lightOn[room] = v;
    return true;
  }

  // ------------------------------------------------------------ curtains

  setCurtain(c: Curtain, state: CurtainState): void {
    c.state = state;
  }

  /**
   * Perch visibility (0..1) at a nav cell, with the curtains as they are now.
   * The baked grid already includes the starting curtains. Closing them scales it down;
   * opening one that started drawn needs the room traced again with its curtains open,
   * done once per room on first need.
   */
  visAt(level: number, k: number): number {
    const n = this.pf.levels.get(level);
    if (!n || k < 0) return 0;
    const baked = n.vis[k]! / 255;
    const room = n.room[k]!;
    if (room < 0) return baked;
    const ids = this.roomCurtains[room];
    if (!ids?.length) return baked;
    let cur = 0;
    let base = 0;
    let open = 0;
    let moved = false;
    for (const id of ids) {
      const c = this.curtains[id]!;
      if (!c.towardPerch) continue;
      cur += CURTAIN_TRANSMIT[c.state];
      base += CURTAIN_TRANSMIT[c.base];
      open += c.movable ? CURTAIN_TRANSMIT.open : CURTAIN_TRANSMIT[c.base];
      if (c.state !== c.base) moved = true;
    }
    if (!moved) return baked;
    if (cur <= base) return base > 0 ? (baked * cur) / base : 0;
    return open > 0 ? (this.openVis(room, level, k) * cur) / open : 0;
  }

  /** Perch visibility at a cell with every movable curtain open, traced on first need. */
  private openVis(room: number, level: number, k: number): number {
    let m = this.visOpen.get(room);
    if (!m) {
      m = this.traceRoom(room);
      this.visOpen.set(room, m);
    }
    return m.get(level * 1e7 + k) ?? 0;
  }

  private traceRoom(room: number): Map<number, number> {
    const bp = this.bp;
    if (!this.visOpenTracer) {
      const open = new Set(this.curtains.filter((c) => c.movable).map((c) => c.opening));
      const walls = bp.walls.map((w) => (w.openings.some((o) => open.has(o.id)) ? { ...w, openings: w.openings.map((o) => (open.has(o.id) ? { ...o, curtain: "open" as const } : o)) } : w));
      const occ = collectOccluders({
        walls,
        rooms: bp.rooms,
        levels: bp.levels,
        masses: bp.masses,
        porticos: bp.porticos,
        props: bp.props,
        site: bp.site,
        atrium: bp.atrium,
        stairs: bp.stairs,
        roofTerraces: bp.roofTerraces,
        withProps: true,
      });
      this.visOpenTracer = new SightlineTracer(bp.site.perch.eye, occ);
    }
    const tracer = this.visOpenTracer;
    const out = new Map<number, number>();
    const r = bp.rooms[room]!;
    const n = this.pf.levels.get(r.level);
    if (!n) return out;
    const blocks = new Map<number, number>();
    for (let k = 0; k < n.walk.length; k++) {
      if (!n.walk[k] || n.room[k] !== room) continue;
      const c = k % n.cols;
      const rr = (k - c) / n.cols;
      const bc = Math.floor(c / VIS_BLOCK);
      const br = Math.floor(rr / VIS_BLOCK);
      const key = br * 4096 + bc;
      let v = blocks.get(key);
      if (v === undefined) {
        v = Math.round(tracer.person(n.originX + (bc + 0.5) * VIS_BLOCK * n.cell, n.originZ + (br + 0.5) * VIS_BLOCK * n.cell, r.floorY) * 255) / 255;
        blocks.set(key, v);
      }
      out.set(r.level * 1e7 + k, v);
    }
    return out;
  }
}

/**
 * One or two bedrooms stay open for guests: the coat room when the house has no cloakroom,
 * and a spare. They are the bedrooms nearest the top of a stair on the first floor up.
 */
function pickGuestBedrooms(bp: MansionBlueprint, rng: Rng): number[] {
  const beds = bp.rooms.filter((r) => r.type === "bedroom");
  if (!beds.length) return [];
  const tops = bp.nav.links.filter((l) => l.kind === "stair" && l.level > 0);
  const lowest = Math.min(...beds.map((r) => r.level));
  const dist = (r: Room) => {
    const cx = (r.inner.x0 + r.inner.x1) / 2;
    const cz = (r.inner.z0 + r.inner.z1) / 2;
    const d = Math.min(Infinity, ...tops.filter((t) => t.level === r.level).map((t) => Math.hypot(t.x - cx, t.z - cz)));
    return (Number.isFinite(d) ? d : 50) + 30 * (r.level - lowest);
  };
  const sorted = [...beds].sort((a, b) => dist(a) - dist(b) || a.index - b.index);
  const cloak = bp.rooms.some((r) => r.type === "cloakroom");
  const n = cloak ? (rng.chance(0.5) ? 2 : 1) : 2;
  return sorted.slice(0, Math.min(n, sorted.length)).map((r) => r.index);
}
