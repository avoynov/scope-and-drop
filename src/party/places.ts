/**
 * Where the party happens: everything the minds need from the mansion blueprint,
 * resolved once into walkable spots and seats.
 */
import type { MansionBlueprint, Prop, PropKind, Room, RoomType, Wall } from "../mansion/core/types";
import type { Rng } from "../mansion/core/rng";
import type { Pathfinder } from "./path";
import type { Seat, Spot } from "./types";
import type { Door, World } from "./world";

export interface Bathroom {
  room: Room;
  /** Where to stand inside while using it. */
  inside: Spot;
  /** Where to stand outside the door, facing it. */
  door: Spot;
  /** World door id of that door, or -1 when the way in has no door. */
  doorId: number;
  /** Up to two places to wait along the wall beside the door, first in line first. */
  queue: Spot[];
}

/**
 * Behaviour that names a place resolves down a chain of fallbacks, so nothing depends on a
 * room the house might not have (milestone 2 plan: Every room the house can have).
 */
export type ChainId = "coats" | "spirits" | "lockAway" | "proposal" | "film" | "act" | "cards" | "billiards" | "lateDance" | "water" | "note" | "photo" | "dinner";
export const CHAIN_IDS: readonly ChainId[] = ["coats", "spirits", "lockAway", "proposal", "film", "act", "cards", "billiards", "lateDance", "water", "note", "photo", "dinner"];
/** Chains whose last link is "not tonight": a house without a cinema shows no film. */
export const OPTIONAL_CHAINS: ReadonlySet<ChainId> = new Set(["film", "billiards", "water"]);

export interface ChainLink {
  /** Which link of the chain the house resolved to, e.g. 'cloakroom' or 'guest bedroom'; 'none' when nothing fits. */
  link: string;
  room: number | null;
  spots: Spot[];
}

export interface GameTable {
  kind: "billiards" | "cards" | "piano" | "cinema";
  room: Room;
  /** Places to play from (the first is the player's spot at a piano). */
  spots: Spot[];
}

export interface Places {
  /** Inside the main entrance: where guests appear and leave. */
  entrance: Spot;
  entranceRoom: Room | null;
  /** Party rooms by room index, with walkable cells for random spots. */
  partyRooms: Room[];
  /** Ground floor party rooms first; upstairs ones are reached from the gallery. */
  mingleRooms: number[];
  /** Where toasts gather, and the host's spot in it. */
  toastRoom: Room;
  toastSpot: Spot;
  dining: Room | null;
  /** Dining chairs, head of the table first. */
  diningSeats: Seat[];
  /** Standing spots for those without a chair: the buffet or cocktail tables. */
  buffet: Spot[];
  danceSpots: Spot[];
  danceRoom: Room | null;
  bars: Spot[];
  /** Which counter each bar spot belongs to (parallel to `bars`). */
  barCounter: number[];
  bathrooms: Bathroom[];
  /** Sofas, armchairs and loose chairs outside the dining room. */
  seats: Seat[];
  /** Paintings, statues, the globe, bookshelves: things to look at. */
  sights: Spot[];
  games: GameTable[];
  terrace: Spot[];
  kitchen: Spot[];
  globe: Spot | null;
  /** Ballroom sofas, armchairs and gilt chairs: a seated supper for those the dining room can't take. */
  supperSeats: Seat[];
  /** Tables, consoles, the bar and the buffet: where a glass is set down. */
  surfaces: Spot[];
  /** Each room's light switch, just inside its main door (by room index; null when it has none). */
  switches: Array<Spot | null>;
  /** Bedrooms left open for guests. */
  guestBedrooms: Room[];
  chains: Record<ChainId, ChainLink>;
}

const PRIVATE: ReadonlySet<RoomType> = new Set(["bedroom", "dressing-room", "bathroom", "study"]);
const SURFACES: ReadonlySet<PropKind> = new Set([
  "coffee-table",
  "side-table",
  "cocktail-table",
  "console",
  "sideboard",
  "buffet",
  "bar-counter",
  "card-table",
  "dining-table",
  "kitchen-island",
  "desk",
]);
const CIRCULATION: ReadonlySet<RoomType> = new Set(["corridor", "hall-gallery", "landing", "entrance-hall", "stair-hall"]);

const roomOf = (bp: MansionBlueprint, id: string | null): Room | undefined => (id ? bp.rooms.find((r) => r.id === id) : undefined);

/** Unit vector a prop or person faces for a yaw (local +z is the front). */
export const facing = (yaw: number): { x: number; z: number } => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

export class RoomCells {
  private cells = new Map<number, Array<[number, number]>>();
  constructor(private pf: Pathfinder) {
    for (const n of pf.levels.values()) {
      for (let k = 0; k < n.walk.length; k++) {
        if (!n.walk[k]) continue;
        const room = n.room[k]!;
        if (room === -1) continue;
        const key = room === -2 ? -2 : room;
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push([n.level, k]);
      }
    }
  }

  count(room: number): number {
    return this.cells.get(room)?.length ?? 0;
  }

  /** A random walkable spot in a room, away from its walls when it can be. */
  random(room: number, rng: Rng, margin = 0.6): Spot | null {
    const list = this.cells.get(room);
    if (!list?.length) return null;
    for (let tries = 0; tries < 12; tries++) {
      const [level, k] = rng.pick(list);
      const n = this.pf.levels.get(level)!;
      const c = k % n.cols;
      const r = (k - c) / n.cols;
      const x = n.originX + (c + 0.5) * n.cell;
      const z = n.originZ + (r + 0.5) * n.cell;
      // Prefer open floor: all cells within the margin walkable.
      const m = Math.max(1, Math.ceil(margin / n.cell));
      let open = true;
      for (let dr = -m; dr <= m && open; dr += m) for (let dc = -m; dc <= m && open; dc += m) if (!this.pf.walkable(level, x + dc * n.cell, z + dr * n.cell)) open = false;
      if (open || tries === 11) return { level, x, z, yaw: rng.range(-Math.PI, Math.PI), room };
    }
    return null;
  }
}

function spotAt(pf: Pathfinder, level: number, x: number, z: number, yaw: number, maxR = 1.5): Spot | null {
  const w = pf.snap(level, x, z, maxR);
  if (!w) return null;
  return { level, x: w.x, z: w.z, yaw, room: pf.roomAt(level, w.x, w.z) };
}

/** Yaw that looks from (x0,z0) toward (x1,z1). */
export const yawTo = (x0: number, z0: number, x1: number, z1: number): number => Math.atan2(x1 - x0, z1 - z0);

function seatFrom(pf: Pathfinder, p: Prop, kind: Seat["kind"], offset = 0): Seat | null {
  const f = facing(p.yaw);
  // Offset along the seat's width (sofas seat three).
  const sx = p.x + Math.cos(p.yaw) * offset;
  const sz = p.z - Math.sin(p.yaw) * offset;
  const front = spotAt(pf, p.level, sx + f.x * 0.55, sz + f.z * 0.55, p.yaw, 1.6);
  if (!front) return null;
  return { id: `${p.id}${offset ? `:${offset.toFixed(1)}` : ""}`, kind, x: sx, z: sz, y: p.y, yaw: p.yaw, approach: front };
}

/** Inside of the main entrance door. */
function findEntrance(bp: MansionBlueprint, pf: Pathfinder): { spot: Spot; room: Room | null } {
  const doors: Array<{ w: Wall; u: number }> = [];
  for (const w of bp.walls) {
    if (w.level !== 0 || !w.exterior) continue;
    for (const o of w.openings) if (o.kind === "entrance" || (o.passable && w.side === "entrance")) doors.push({ w, u: (o.u0 + o.u1) / 2 });
  }
  doors.sort((a, b) => (a.w.side === "entrance" ? 0 : 1) - (b.w.side === "entrance" ? 0 : 1));
  for (const { w, u } of doors) {
    const roomId = w.neg ?? w.pos;
    const room = roomOf(bp, roomId);
    if (!room) continue;
    const inward = w.neg ? -1 : 1;
    const along = w.axis === "x" ? { x: w.a.x + u, z: w.a.z } : { x: w.a.x, z: w.a.z + u };
    const x = w.axis === "x" ? along.x : along.x + inward * 1.4;
    const z = w.axis === "x" ? along.z + inward * 1.4 : along.z;
    const s = spotAt(pf, 0, x, z, yawTo(along.x, along.z, x, z), 2.5);
    if (s) return { spot: s, room };
  }
  // No door found: the middle of the entrance hall, or of any ground floor room.
  const hall = bp.rooms.find((r) => r.type === "entrance-hall") ?? bp.rooms.find((r) => r.level === 0)!;
  const s = spotAt(pf, hall.level, (hall.inner.x0 + hall.inner.x1) / 2, (hall.inner.z0 + hall.inner.z1) / 2, 0, 6)!;
  return { spot: s, room: hall };
}

export function resolvePlaces(bp: MansionBlueprint, pf: Pathfinder, cells: RoomCells, world: World): Places {
  const { spot: entrance, room: entranceRoom } = findEntrance(bp, pf);
  const partyRooms = bp.rooms.filter((r) => r.role === "party" && cells.count(r.index) > 20);
  const mingleRooms = partyRooms
    .filter((r) => !["bathroom", "kitchen", "cinema", "gym", "spa", "theatre"].includes(r.type))
    .sort((a, b) => a.level - b.level)
    .map((r) => r.index);

  const ground = partyRooms.filter((r) => r.level === 0);
  const area = (r: Room) => (r.inner.x1 - r.inner.x0) * (r.inner.z1 - r.inner.z0);
  const atriumRoom = bp.atrium ? roomOf(bp, bp.atrium.roomId) : undefined;
  const toastRoom =
    (atriumRoom && atriumRoom.level === 0 ? atriumRoom : undefined) ??
    ground.find((r) => r.type === "ballroom") ??
    ground.find((r) => r.type === "great-room") ??
    [...ground].sort((a, b) => area(b) - area(a))[0] ??
    partyRooms[0]!;
  const tcx = (toastRoom.inner.x0 + toastRoom.inner.x1) / 2;
  const tcz = (toastRoom.inner.z0 + toastRoom.inner.z1) / 2;
  const toastSpot = spotAt(pf, toastRoom.level, tcx, tcz, 0, 6) ?? entrance;

  const dining = bp.rooms.filter((r) => r.type === "dining-room").sort((a, b) => area(b) - area(a))[0] ?? null;
  const diningSeats: Seat[] = [];
  if (dining) {
    const chairs = bp.props.filter((p) => p.roomId === dining.id && p.kind === "chair");
    // Head chairs are the larger ones at the table's ends.
    chairs.sort((a, b) => b.w - a.w || a.x - b.x || a.z - b.z);
    for (const c of chairs) {
      const s = seatFrom(pf, c, "dining");
      if (s) diningSeats.push(s);
    }
  }

  const buffet: Spot[] = [];
  for (const p of bp.props) {
    if (p.kind !== "buffet" && p.kind !== "cocktail-table") continue;
    const f = facing(p.yaw);
    const reach = p.kind === "buffet" ? p.d / 2 + 0.6 : 0.75;
    for (const a of p.kind === "buffet" ? [-1.2, 0, 1.2] : [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const dir = p.kind === "buffet" ? f : facing(p.yaw + a);
      const side = p.kind === "buffet" ? { x: Math.cos(p.yaw) * a, z: -Math.sin(p.yaw) * a } : { x: 0, z: 0 };
      const x = p.x + dir.x * reach + side.x;
      const z = p.z + dir.z * reach + side.z;
      const s = spotAt(pf, p.level, x, z, yawTo(x, z, p.x, p.z), 0.6);
      if (s && pf.roomAt(p.level, s.x, s.z) >= 0) buffet.push(s);
    }
  }

  const danceSpots: Spot[] = [];
  let danceRoom: Room | null = null;
  const floor = bp.props.find((p) => p.kind === "dance-floor") ?? bp.props.find((p) => p.kind === "disco-floor");
  if (floor) {
    danceRoom = roomOf(bp, floor.roomId) ?? null;
    const n = pf.levels.get(floor.level);
    if (n) {
      for (let x = floor.x - floor.w / 2 + 0.4; x <= floor.x + floor.w / 2 - 0.4; x += 0.9) {
        for (let z = floor.z - floor.d / 2 + 0.4; z <= floor.z + floor.d / 2 - 0.4; z += 0.9) {
          if (pf.walkable(floor.level, x, z)) danceSpots.push({ level: floor.level, x, z, yaw: 0, room: pf.roomAt(floor.level, x, z) });
        }
      }
    }
  }
  if (!danceSpots.length) {
    danceRoom = toastRoom;
    for (let i = 0; i < 24; i++) {
      const x = tcx + Math.cos(i * 2.4) * (1 + (i % 4));
      const z = tcz + Math.sin(i * 2.4) * (1 + (i % 4));
      const s = spotAt(pf, toastRoom.level, x, z, 0, 0.6);
      if (s) danceSpots.push(s);
    }
  }

  const bars: Spot[] = [];
  const barCounter: number[] = [];
  let counters = 0;
  const kitchen: Spot[] = [];
  const sights: Spot[] = [];
  const games: GameTable[] = [];
  let globe: Spot | null = null;
  for (const poi of bp.pois) {
    const s = spotAt(pf, poi.level, poi.stand.x, poi.stand.z, poi.stand.yaw, 1.2);
    if (!s) continue;
    if (poi.type === "bar") {
      bars.push(s);
      barCounter.push(counters);
      // A second and third place along the counter.
      for (const d of [-0.9, 0.9]) {
        const q = spotAt(pf, poi.level, poi.stand.x + Math.cos(poi.stand.yaw) * d, poi.stand.z - Math.sin(poi.stand.yaw) * d, poi.stand.yaw, 0.5);
        if (q) {
          bars.push(q);
          barCounter.push(counters);
        }
      }
      counters++;
    } else if (poi.type === "painting" || poi.type === "statue" || poi.type === "bookshelf" || poi.type === "clock" || poi.type === "fireplace") {
      if (poi.roomId && roomOf(bp, poi.roomId)?.role === "party") sights.push(s);
    } else if (poi.type === "globe") {
      globe = s;
      sights.push(s);
    }
  }
  for (const r of bp.rooms) {
    if (r.type === "kitchen" || r.type === "pantry") {
      const s = spotAt(pf, r.level, (r.inner.x0 + r.inner.x1) / 2, (r.inner.z0 + r.inner.z1) / 2, 0, 4);
      if (s) kitchen.push(s);
    }
  }

  // Games: billiards, cards, the piano, the cinema.
  for (const p of bp.props) {
    const room = roomOf(bp, p.roomId);
    if (!room) continue;
    if (p.kind === "billiard-table") {
      const spots: Spot[] = [];
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const f = facing(p.yaw + a);
        const reach = (a === 0 || a === Math.PI ? p.d : p.w) / 2 + 0.55;
        const s = spotAt(pf, p.level, p.x + f.x * reach, p.z + f.z * reach, p.yaw + a + Math.PI, 0.8);
        if (s) spots.push(s);
      }
      if (spots.length >= 2) games.push({ kind: "billiards", room, spots });
    } else if (p.kind === "card-table") {
      const chairs = bp.props.filter((c) => c.kind === "chair" && c.roomId === p.roomId && Math.hypot(c.x - p.x, c.z - p.z) < 1.2);
      const spots = chairs.map((c) => seatFrom(pf, c, "chair")?.approach).filter((s): s is Spot => !!s);
      if (spots.length >= 2) games.push({ kind: "cards", room, spots });
    } else if (p.kind === "grand-piano") {
      const f = facing(p.yaw);
      // The keyboard is at the back of the case, opposite its front.
      const bench = spotAt(pf, p.level, p.x - f.x * (p.d / 2 + 0.5), p.z - f.z * (p.d / 2 + 0.5), p.yaw, 1.0);
      if (!bench) continue;
      const spots = [bench];
      for (const a of [0.7, 1.2, -0.7, -1.2]) {
        const s = spotAt(pf, p.level, p.x + Math.sin(p.yaw + a) * 2.4, p.z + Math.cos(p.yaw + a) * 2.4, p.yaw + a + Math.PI, 0.8);
        if (s) spots.push(s);
      }
      games.push({ kind: "piano", room, spots });
    } else if (p.kind === "cinema-screen") {
      const f = facing(p.yaw);
      const spots: Spot[] = [];
      for (let i = 0; i < 6; i++) {
        const along = (i % 3) - 1;
        const back = 2.5 + Math.floor(i / 3) * 1.2;
        const s = spotAt(pf, p.level, p.x + f.x * back + Math.cos(p.yaw) * along * 1.1, p.z + f.z * back - Math.sin(p.yaw) * along * 1.1, p.yaw + Math.PI, 0.6);
        if (s) spots.push(s);
      }
      if (spots.length >= 2) games.push({ kind: "cinema", room, spots });
    }
  }

  const bathrooms: Bathroom[] = [];
  for (const r of bp.rooms) {
    if (r.type !== "bathroom" || cells.count(r.index) < 4) continue;
    const inside = spotAt(pf, r.level, (r.inner.x0 + r.inner.x1) / 2, (r.inner.z0 + r.inner.z1) / 2, 0, 3);
    if (!inside) continue;
    // The way in: a door from somewhere anyone can reach, not from a bedroom or dressing room.
    const doors = world.doors.filter((d) => d.rooms.includes(r.index));
    const way = doors.find((d) => !PRIVATE.has(bp.rooms[world.otherSide(d, r.index)]!.type)) ?? doors[0];
    const at = way ? doorFront(bp, pf, world, way, world.otherSide(way, r.index)) : null;
    if (way && at) {
      bathrooms.push({ room: r, inside, door: at.front, doorId: way.id, queue: at.queue });
      continue;
    }
    // No door on the way in (an arch): wait just outside it.
    const link = bp.nav.links.find((l) => l.kind === "door" && (l.from === r.id || l.to === r.id));
    let door: Spot | null = null;
    if (link) {
      const other = link.from === r.id ? link.to : link.from;
      const or = roomOf(bp, other);
      const ox = or ? Math.max(or.inner.x0 + 0.5, Math.min(or.inner.x1 - 0.5, link.x)) : link.x;
      const oz = or ? Math.max(or.inner.z0 + 0.5, Math.min(or.inner.z1 - 0.5, link.z)) : link.z;
      door = spotAt(pf, r.level, ox, oz, yawTo(ox, oz, link.x, link.z), 1.5);
    }
    const front = door ?? inside;
    bathrooms.push({ room: r, inside, door: front, doorId: -1, queue: [] });
  }

  const seats: Seat[] = [];
  for (const p of bp.props) {
    const room = roomOf(bp, p.roomId);
    if (!room || room.role !== "party" || room === dining) continue;
    if (p.kind === "sofa")
      for (const o of [-0.6, 0, 0.6]) {
        const s = seatFrom(pf, p, "sofa", o);
        if (s) seats.push(s);
      }
    else if (p.kind === "armchair") {
      const s = seatFrom(pf, p, "armchair");
      if (s) seats.push(s);
    }
  }

  const terrace: Spot[] = [];
  const tr = bp.site.terrace.rect;
  for (let x = tr.x0 + 1; x < tr.x1 - 1; x += 2.2) {
    for (let z = tr.z0 + 1; z < tr.z1 - 1; z += 2.2) {
      if (pf.roomAt(0, x, z) === -2 && pf.walkable(0, x, z)) terrace.push({ level: 0, x, z, yaw: Math.PI, room: -2 });
    }
  }

  // A seated supper in the ballroom for the overflow: sofas and armchairs round the coffee tables, then the gilt chairs along the walls.
  const supperSeats: Seat[] = [];
  const ballroom = toastRoom.type === "ballroom" ? toastRoom : bp.rooms.find((r) => r.type === "ballroom");
  if (ballroom) {
    const inRoom = bp.props.filter((p) => p.roomId === ballroom.id);
    const band = inRoom.filter((p) => p.kind === "music-stand" || p.kind === "harp" || p.kind === "grand-piano");
    const buffetProp = inRoom.find((p) => p.kind === "buffet");
    for (const p of inRoom) {
      if (p.kind === "sofa")
        for (const o of [-0.6, 0, 0.6]) {
          const st = seatFrom(pf, p, "sofa", o);
          if (st) supperSeats.push(st);
        }
      else if (p.kind === "armchair") {
        const st = seatFrom(pf, p, "armchair");
        if (st) supperSeats.push(st);
      }
    }
    const near = (p: Prop) => (buffetProp ? Math.hypot(p.x - buffetProp.x, p.z - buffetProp.z) : 0);
    const chairs = inRoom.filter((p) => p.kind === "chair" && !band.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < 2.5)).sort((a, b) => near(a) - near(b) || a.x - b.x || a.z - b.z);
    for (const c of chairs) {
      const st = seatFrom(pf, c, "chair");
      if (st) supperSeats.push(st);
    }
  }

  const surfaces: Spot[] = [];
  for (const p of bp.props) {
    if (!SURFACES.has(p.kind)) continue;
    const room = roomOf(bp, p.roomId);
    surfaces.push({ level: p.level, x: p.x, z: p.z, yaw: 0, room: room ? room.index : -2 });
  }

  const switches: Array<Spot | null> = bp.rooms.map((r) => switchSpot(pf, world, r));
  const guestBedrooms = world.guestBedrooms.map((i) => bp.rooms[i]!);

  const places: Omit<Places, "chains"> = {
    entrance,
    entranceRoom,
    partyRooms,
    mingleRooms,
    toastRoom,
    toastSpot,
    dining,
    diningSeats,
    buffet,
    danceSpots,
    danceRoom,
    bars,
    barCounter,
    bathrooms,
    seats,
    sights,
    games,
    terrace,
    kitchen,
    globe,
    supperSeats,
    surfaces,
    switches,
    guestBedrooms,
  };
  return { ...places, chains: resolveChains(bp, pf, places) };
}

/** Where to stand facing a door from one side, and two places to queue along the wall beside it. */
function doorFront(bp: MansionBlueprint, pf: Pathfinder, world: World, d: Door, side: number): { front: Spot; queue: Spot[] } | null {
  const room = bp.rooms[side]!;
  const cx = (room.inner.x0 + room.inner.x1) / 2;
  const cz = (room.inner.z0 + room.inner.z1) / 2;
  // Into the room on this side, across the wall.
  const nx = d.axis === "z" ? Math.sign(cx - d.x) || 1 : 0;
  const nz = d.axis === "x" ? Math.sign(cz - d.z) || 1 : 0;
  const ax = d.axis === "x" ? 1 : 0;
  const az = d.axis === "z" ? 1 : 0;
  const ok = (x: number, z: number, r: number) => {
    const w = pf.snap(d.level, x, z, r);
    if (!w || pf.roomAt(d.level, w.x, w.z) !== side || world.doorAtPoint(d.level, w.x, w.z) >= 0) return null;
    return w;
  };
  const f = ok(d.x + nx * 0.8, d.z + nz * 0.8, 0.6);
  if (!f) return null;
  const front: Spot = { level: d.level, x: f.x, z: f.z, yaw: yawTo(f.x, f.z, d.x, d.z), room: side };
  let queue: Spot[] = [];
  for (const s of [1, -1]) {
    const q: Spot[] = [];
    for (let k = 0; k < 2; k++) {
      const off = d.width / 2 + 0.55 + 0.65 * k;
      const w = ok(d.x + nx * 0.7 + ax * s * off, d.z + nz * 0.7 + az * s * off, 0.3);
      if (!w || Math.hypot(w.x - f.x, w.z - f.z) < 0.5 || q.some((o) => Math.hypot(o.x - w.x, o.z - w.z) < 0.45)) break;
      q.push({ level: d.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, d.x, d.z), room: side });
    }
    if (q.length > queue.length) queue = q;
    if (queue.length === 2) break;
  }
  return { front, queue };
}

/** A room's light switch: just inside its main door (one from a hall or corridor if it has one). */
function switchSpot(pf: Pathfinder, world: World, r: Room): Spot | null {
  const edges = (world.graph[r.index] ?? []).filter((e) => e.kind !== "stair" && e.level === r.level);
  if (!edges.length) return null;
  const main = edges.find((e) => e.to >= 0 && CIRCULATION.has(world.roomType(e.to))) ?? edges[0]!;
  const cx = (r.inner.x0 + r.inner.x1) / 2;
  const cz = (r.inner.z0 + r.inner.z1) / 2;
  const d = Math.hypot(cx - main.x, cz - main.z) || 1;
  const x = main.x + ((cx - main.x) / d) * 0.7;
  const z = main.z + ((cz - main.z) / d) * 0.7;
  const w = pf.snap(r.level, x, z, 0.8);
  if (!w || pf.roomAt(r.level, w.x, w.z) !== r.index) return null;
  return { level: r.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, main.x, main.z), room: r.index };
}

/** A few standing spots spread over a room. */
function roomSpots(pf: Pathfinder, r: Room, n = 4): Spot[] {
  const out: Spot[] = [];
  const w = r.inner.x1 - r.inner.x0;
  const d = r.inner.z1 - r.inner.z0;
  for (const [fx, fz] of [
    [0.5, 0.5],
    [0.3, 0.3],
    [0.7, 0.7],
    [0.3, 0.7],
    [0.7, 0.3],
  ] as const) {
    if (out.length >= n) break;
    const s = spotAt(pf, r.level, r.inner.x0 + w * fx, r.inner.z0 + d * fz, 0, Math.min(w, d) / 3);
    if (s && s.room === r.index && !out.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 0.6)) out.push(s);
  }
  return out;
}

/** Standing in front of a prop, facing it. */
function frontOf(pf: Pathfinder, p: Prop): Spot | null {
  const f = facing(p.yaw);
  const reach = p.d / 2 + 0.55;
  const x = p.x + f.x * reach;
  const z = p.z + f.z * reach;
  return spotAt(pf, p.level, x, z, yawTo(x, z, p.x, p.z), 1.0);
}

function resolveChains(bp: MansionBlueprint, pf: Pathfinder, pl: Omit<Places, "chains">): Record<ChainId, ChainLink> {
  const room = (t: RoomType) => bp.rooms.find((r) => r.type === t && pf.levels.has(r.level));
  const propIn = (kind: PropKind, r: Room | undefined) => (r ? bp.props.find((p) => p.kind === kind && p.roomId === r.id) : undefined);
  const link = (name: string, r: Room | null | undefined, spots: Spot[]): ChainLink | null => (spots.length ? { link: name, room: r ? r.index : null, spots } : null);
  const none: ChainLink = { link: "none", room: null, spots: [] };
  const first = (...links: Array<() => ChainLink | null>): ChainLink => {
    for (const l of links) {
      const v = l();
      if (v) return v;
    }
    return none;
  };
  const spotOf = (p: Prop | undefined) => (p ? frontOf(pf, p) : null);
  const ballroom = bp.rooms.find((r) => r.type === "ballroom") ?? pl.toastRoom;
  const fountain = bp.site.fountain;
  const byFountain = (): ChainLink | null => {
    if (!fountain || !pl.terrace.length) return null;
    const s = [...pl.terrace].sort((a, b) => Math.hypot(a.x - fountain.x, a.z - fountain.z) - Math.hypot(b.x - fountain.x, b.z - fountain.z))[0]!;
    return link("fountain", null, [s]);
  };
  const cardGames = pl.games.filter((g) => g.kind === "cards");
  const grand = bp.stairs.find((s) => s.kind === "grand");
  const grandFoot = grand ? bp.nav.links.find((l) => l.kind === "stair" && l.via === grand.id && l.level === grand.fromLevel) : undefined;
  const library = room("library");
  return {
    coats: first(
      () => link("cloakroom", room("cloakroom"), room("cloakroom") ? roomSpots(pf, room("cloakroom")!) : []),
      () => {
        const g = pl.guestBedrooms[0];
        if (!g) return null;
        const bed = spotOf(propIn("bed", g));
        return link("guest bedroom", g, bed ? [bed] : roomSpots(pf, g, 2));
      },
      () => {
        const hall = pl.entranceRoom;
        const c = spotOf(propIn("console", hall ?? undefined));
        return link("hall console", hall, c ? [c] : []);
      },
      () => link("entrance", pl.entranceRoom, [pl.entrance]),
    ),
    spirits: first(
      () => {
        const r = room("pantry");
        const c = spotOf(propIn("cabinet", r)) ?? spotOf(propIn("wine-rack", r));
        return link("pantry cabinet", r, c ? [c] : []);
      },
      () => {
        const r = room("kitchen");
        const c = spotOf(propIn("cabinet", r)) ?? spotOf(propIn("kitchen-island", r));
        return link("kitchen cabinet", r, c ? [c] : r ? roomSpots(pf, r, 1) : []);
      },
      () => link("bar", null, pl.bars.slice(0, 1)),
      () => link("kitchen", null, pl.kitchen.slice(0, 1)),
    ),
    lockAway: first(() =>
      link(`bathrooms and ${pl.guestBedrooms.length} guest bedroom${pl.guestBedrooms.length === 1 ? "" : "s"}`, null, [
        ...pl.bathrooms.map((b) => b.inside),
        ...pl.guestBedrooms.flatMap((g) => roomSpots(pf, g, 1)),
      ]),
    ),
    proposal: first(
      () => link("conservatory", room("conservatory"), room("conservatory") ? roomSpots(pf, room("conservatory")!, 2) : []),
      byFountain,
      () => link("terrace", null, pl.terrace.slice(0, 2)),
    ),
    film: first(() => {
      const g = pl.games.find((x) => x.kind === "cinema");
      return g ? link("cinema", g.room, g.spots) : null;
    }),
    act: first(
      () => link("theatre", room("theatre"), room("theatre") ? roomSpots(pf, room("theatre")!, 2) : []),
      () => {
        const piano = pl.games.find((g) => g.kind === "piano" && g.room.id === ballroom.id);
        return piano ? link("ballroom music corner", ballroom, piano.spots.slice(1)) : null;
      },
      () => link("ballroom", ballroom, [pl.toastSpot]),
    ),
    cards: first(
      () => {
        const g = cardGames.find((x) => x.room.type === "card-room");
        return g ? link("card room", g.room, g.spots) : null;
      },
      () => {
        const g = cardGames.find((x) => x.room.type === "drawing-room" || x.room.type === "grand-salon") ?? cardGames[0];
        return g ? link(`card table in the ${g.room.type.replace("-", " ")}`, g.room, g.spots) : null;
      },
      () =>
        link(
          "dining table",
          pl.dining,
          pl.diningSeats.slice(0, 4).map((s) => s.approach),
        ),
    ),
    billiards: first(() => {
      const g = pl.games.find((x) => x.kind === "billiards");
      return g ? link("billiard room", g.room, g.spots) : null;
    }),
    lateDance: first(
      () => link("disco", room("disco"), room("disco") ? roomSpots(pf, room("disco")!) : []),
      () => link("ballroom", pl.danceRoom, pl.danceSpots),
    ),
    water: first(() => {
      const r = room("spa");
      const pool = spotOf(propIn("pool", r));
      return link("spa pool", r, pool ? [pool] : []);
    }, byFountain),
    note: first(
      () => {
        const r = room("morning-room");
        const d = spotOf(propIn("desk", r));
        return link("morning-room desk", r, d ? [d] : []);
      },
      () => {
        const d = spotOf(propIn("desk", library)) ?? spotOf(propIn("side-table", library));
        return link("library reading table", library, d ? [d] : library ? roomSpots(pf, library, 1) : []);
      },
      () => {
        const d = bp.props.find((p) => (p.kind === "desk" || p.kind === "side-table") && pl.partyRooms.some((r) => r.id === p.roomId));
        const s = spotOf(d);
        return link("side table", d ? (bp.rooms.find((r) => r.id === d.roomId) ?? null) : null, s ? [s] : []);
      },
      () => link("ballroom", pl.toastRoom, [pl.toastSpot]),
    ),
    photo: first(
      () => {
        const s = grandFoot ? spotAt(pf, grandFoot.level, grandFoot.x, grandFoot.z, 0, 2) : null;
        return s
          ? link(
              "grand stair",
              bp.rooms.find((r) => r.id === grand!.bottomRoom),
              [s],
            )
          : null;
      },
      () => link("ballroom", pl.toastRoom, [pl.toastSpot]),
    ),
    dinner: first(() =>
      link(`dining room ${pl.diningSeats.length}, ballroom supper ${pl.supperSeats.length}, buffet ${pl.buffet.length}`, pl.dining, [
        ...pl.diningSeats.map((s) => s.approach),
        ...pl.supperSeats.map((s) => s.approach),
        ...pl.buffet,
      ]),
    ),
  };
}
