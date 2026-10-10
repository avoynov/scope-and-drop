/**
 * Where the party happens: everything the minds need from the mansion blueprint,
 * resolved once into walkable spots and seats.
 */
import type { MansionBlueprint, Prop, Room, Wall } from '../mansion/core/types';
import type { Rng } from '../mansion/core/rng';
import type { Pathfinder } from './path';
import type { Seat, Spot } from './types';

export interface Bathroom {
  room: Room;
  /** Where to stand inside while using it. */
  inside: Spot;
  /** Where to wait outside the door. */
  door: Spot;
}

export interface GameTable {
  kind: 'billiards' | 'cards' | 'piano' | 'cinema';
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
  bathrooms: Bathroom[];
  /** Sofas, armchairs and loose chairs outside the dining room. */
  seats: Seat[];
  /** Paintings, statues, the globe, bookshelves: things to look at. */
  sights: Spot[];
  games: GameTable[];
  terrace: Spot[];
  kitchen: Spot[];
  globe: Spot | null;
}

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
      const m = Math.ceil(margin / n.cell);
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

function seatFrom(pf: Pathfinder, p: Prop, kind: Seat['kind'], offset = 0): Seat | null {
  const f = facing(p.yaw);
  // Offset along the seat's width (sofas seat three).
  const sx = p.x + Math.cos(p.yaw) * offset;
  const sz = p.z - Math.sin(p.yaw) * offset;
  const front = spotAt(pf, p.level, sx + f.x * 0.55, sz + f.z * 0.55, p.yaw, 1.6);
  if (!front) return null;
  return { id: `${p.id}${offset ? `:${offset.toFixed(1)}` : ''}`, kind, x: sx, z: sz, y: p.y, yaw: p.yaw, approach: front };
}

/** Inside of the main entrance door. */
function findEntrance(bp: MansionBlueprint, pf: Pathfinder): { spot: Spot; room: Room | null } {
  const doors: Array<{ w: Wall; u: number }> = [];
  for (const w of bp.walls) {
    if (w.level !== 0 || !w.exterior) continue;
    for (const o of w.openings) if (o.kind === 'entrance' || (o.passable && w.side === 'entrance')) doors.push({ w, u: (o.u0 + o.u1) / 2 });
  }
  doors.sort((a, b) => (a.w.side === 'entrance' ? 0 : 1) - (b.w.side === 'entrance' ? 0 : 1));
  for (const { w, u } of doors) {
    const roomId = w.neg ?? w.pos;
    const room = roomOf(bp, roomId);
    if (!room) continue;
    const inward = w.neg ? -1 : 1;
    const along = w.axis === 'x' ? { x: w.a.x + u, z: w.a.z } : { x: w.a.x, z: w.a.z + u };
    const x = w.axis === 'x' ? along.x : along.x + inward * 1.4;
    const z = w.axis === 'x' ? along.z + inward * 1.4 : along.z;
    const s = spotAt(pf, 0, x, z, yawTo(along.x, along.z, x, z), 2.5);
    if (s) return { spot: s, room };
  }
  // No door found: the middle of the entrance hall, or of any ground floor room.
  const hall = bp.rooms.find((r) => r.type === 'entrance-hall') ?? bp.rooms.find((r) => r.level === 0)!;
  const s = spotAt(pf, hall.level, (hall.inner.x0 + hall.inner.x1) / 2, (hall.inner.z0 + hall.inner.z1) / 2, 0, 6)!;
  return { spot: s, room: hall };
}

export function resolvePlaces(bp: MansionBlueprint, pf: Pathfinder, cells: RoomCells): Places {
  const { spot: entrance, room: entranceRoom } = findEntrance(bp, pf);
  const partyRooms = bp.rooms.filter((r) => r.role === 'party' && cells.count(r.index) > 20);
  const mingleRooms = partyRooms
    .filter((r) => !['bathroom', 'kitchen', 'cinema', 'gym', 'spa', 'theatre'].includes(r.type))
    .sort((a, b) => a.level - b.level)
    .map((r) => r.index);

  const ground = partyRooms.filter((r) => r.level === 0);
  const area = (r: Room) => (r.inner.x1 - r.inner.x0) * (r.inner.z1 - r.inner.z0);
  const atriumRoom = bp.atrium ? roomOf(bp, bp.atrium.roomId) : undefined;
  const toastRoom =
    (atriumRoom && atriumRoom.level === 0 ? atriumRoom : undefined) ??
    ground.find((r) => r.type === 'ballroom') ??
    ground.find((r) => r.type === 'great-room') ??
    [...ground].sort((a, b) => area(b) - area(a))[0] ??
    partyRooms[0]!;
  const tcx = (toastRoom.inner.x0 + toastRoom.inner.x1) / 2;
  const tcz = (toastRoom.inner.z0 + toastRoom.inner.z1) / 2;
  const toastSpot = spotAt(pf, toastRoom.level, tcx, tcz, 0, 6) ?? entrance;

  const dining = bp.rooms.filter((r) => r.type === 'dining-room').sort((a, b) => area(b) - area(a))[0] ?? null;
  const diningSeats: Seat[] = [];
  if (dining) {
    const chairs = bp.props.filter((p) => p.roomId === dining.id && p.kind === 'chair');
    // Head chairs are the larger ones at the table's ends.
    chairs.sort((a, b) => b.w - a.w || a.x - b.x || a.z - b.z);
    for (const c of chairs) {
      const s = seatFrom(pf, c, 'dining');
      if (s) diningSeats.push(s);
    }
  }

  const buffet: Spot[] = [];
  for (const p of bp.props) {
    if (p.kind !== 'buffet' && p.kind !== 'cocktail-table') continue;
    const f = facing(p.yaw);
    const reach = p.kind === 'buffet' ? p.d / 2 + 0.6 : 0.75;
    for (const a of p.kind === 'buffet' ? [-1.2, 0, 1.2] : [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const dir = p.kind === 'buffet' ? f : facing(p.yaw + a);
      const side = p.kind === 'buffet' ? { x: Math.cos(p.yaw) * a, z: -Math.sin(p.yaw) * a } : { x: 0, z: 0 };
      const x = p.x + dir.x * reach + side.x;
      const z = p.z + dir.z * reach + side.z;
      const s = spotAt(pf, p.level, x, z, yawTo(x, z, p.x, p.z), 0.6);
      if (s && pf.roomAt(p.level, s.x, s.z) >= 0) buffet.push(s);
    }
  }

  const danceSpots: Spot[] = [];
  let danceRoom: Room | null = null;
  const floor = bp.props.find((p) => p.kind === 'dance-floor') ?? bp.props.find((p) => p.kind === 'disco-floor');
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
  const kitchen: Spot[] = [];
  const sights: Spot[] = [];
  const games: GameTable[] = [];
  let globe: Spot | null = null;
  for (const poi of bp.pois) {
    const s = spotAt(pf, poi.level, poi.stand.x, poi.stand.z, poi.stand.yaw, 1.2);
    if (!s) continue;
    if (poi.type === 'bar') {
      bars.push(s);
      // A second and third place along the counter.
      for (const d of [-0.9, 0.9]) {
        const q = spotAt(pf, poi.level, poi.stand.x + Math.cos(poi.stand.yaw) * d, poi.stand.z - Math.sin(poi.stand.yaw) * d, poi.stand.yaw, 0.5);
        if (q) bars.push(q);
      }
    } else if (poi.type === 'painting' || poi.type === 'statue' || poi.type === 'bookshelf' || poi.type === 'clock' || poi.type === 'fireplace') {
      if (poi.roomId && roomOf(bp, poi.roomId)?.role === 'party') sights.push(s);
    } else if (poi.type === 'globe') {
      globe = s;
      sights.push(s);
    }
  }
  for (const r of bp.rooms) {
    if (r.type === 'kitchen' || r.type === 'pantry') {
      const s = spotAt(pf, r.level, (r.inner.x0 + r.inner.x1) / 2, (r.inner.z0 + r.inner.z1) / 2, 0, 4);
      if (s) kitchen.push(s);
    }
  }

  // Games: billiards, cards, the piano, the cinema.
  for (const p of bp.props) {
    const room = roomOf(bp, p.roomId);
    if (!room) continue;
    if (p.kind === 'billiard-table') {
      const spots: Spot[] = [];
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const f = facing(p.yaw + a);
        const reach = (a === 0 || a === Math.PI ? p.d : p.w) / 2 + 0.55;
        const s = spotAt(pf, p.level, p.x + f.x * reach, p.z + f.z * reach, p.yaw + a + Math.PI, 0.8);
        if (s) spots.push(s);
      }
      if (spots.length >= 2) games.push({ kind: 'billiards', room, spots });
    } else if (p.kind === 'card-table') {
      const chairs = bp.props.filter((c) => c.kind === 'chair' && c.roomId === p.roomId && Math.hypot(c.x - p.x, c.z - p.z) < 1.2);
      const spots = chairs.map((c) => seatFrom(pf, c, 'chair')?.approach).filter((s): s is Spot => !!s);
      if (spots.length >= 2) games.push({ kind: 'cards', room, spots });
    } else if (p.kind === 'grand-piano') {
      const f = facing(p.yaw);
      // The keyboard is at the back of the case, opposite its front.
      const bench = spotAt(pf, p.level, p.x - f.x * (p.d / 2 + 0.5), p.z - f.z * (p.d / 2 + 0.5), p.yaw, 1.0);
      if (!bench) continue;
      const spots = [bench];
      for (const a of [0.7, 1.2, -0.7, -1.2]) {
        const s = spotAt(pf, p.level, p.x + Math.sin(p.yaw + a) * 2.4, p.z + Math.cos(p.yaw + a) * 2.4, p.yaw + a + Math.PI, 0.8);
        if (s) spots.push(s);
      }
      games.push({ kind: 'piano', room, spots });
    } else if (p.kind === 'cinema-screen') {
      const f = facing(p.yaw);
      const spots: Spot[] = [];
      for (let i = 0; i < 6; i++) {
        const along = (i % 3) - 1;
        const back = 2.5 + Math.floor(i / 3) * 1.2;
        const s = spotAt(pf, p.level, p.x + f.x * back + Math.cos(p.yaw) * along * 1.1, p.z + f.z * back - Math.sin(p.yaw) * along * 1.1, p.yaw + Math.PI, 0.6);
        if (s) spots.push(s);
      }
      if (spots.length >= 2) games.push({ kind: 'cinema', room, spots });
    }
  }

  const bathrooms: Bathroom[] = [];
  for (const r of bp.rooms) {
    if (r.type !== 'bathroom' || cells.count(r.index) < 4) continue;
    const inside = spotAt(pf, r.level, (r.inner.x0 + r.inner.x1) / 2, (r.inner.z0 + r.inner.z1) / 2, 0, 3);
    if (!inside) continue;
    // Outside the door: the nearest walkable cell just beyond the room's walls, toward the route in.
    const link = bp.nav.links.find((l) => l.kind === 'door' && (l.from === r.id || l.to === r.id));
    let door: Spot | null = null;
    if (link) {
      const other = link.from === r.id ? link.to : link.from;
      const or = roomOf(bp, other);
      const ox = or ? Math.max(or.inner.x0 + 0.5, Math.min(or.inner.x1 - 0.5, link.x)) : link.x;
      const oz = or ? Math.max(or.inner.z0 + 0.5, Math.min(or.inner.z1 - 0.5, link.z)) : link.z;
      door = spotAt(pf, r.level, ox, oz, yawTo(ox, oz, link.x, link.z), 1.5);
    }
    bathrooms.push({ room: r, inside, door: door ?? inside });
  }

  const seats: Seat[] = [];
  for (const p of bp.props) {
    const room = roomOf(bp, p.roomId);
    if (!room || room.role !== 'party' || room === dining) continue;
    if (p.kind === 'sofa') for (const o of [-0.6, 0, 0.6]) {
      const s = seatFrom(pf, p, 'sofa', o);
      if (s) seats.push(s);
    }
    else if (p.kind === 'armchair') {
      const s = seatFrom(pf, p, 'armchair');
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

  return { entrance, entranceRoom, partyRooms, mingleRooms, toastRoom, toastSpot, dining, diningSeats, buffet, danceSpots, danceRoom, bars, bathrooms, seats, sights, games, terrace, kitchen, globe };
}
