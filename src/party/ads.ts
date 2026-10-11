/**
 * What the house offers (milestone 2 technical plan: Advertisements). Each kind of object, room or
 * place advertises what it does for people: the needs it refills, how long, the pose, how many at
 * once, the phases it suits and who takes to it. At construction the table resolves into concrete
 * offers for this house (one per object, with its standing spots), so a new activity is a row
 * here, not new code, and a room a house lacks simply offers nothing.
 *
 * The programme (champagne, the toast, dinner, leaving), the bar, the bathrooms, conversations and
 * the dance floor keep their own rules in mind.ts; everything else people do comes from here.
 */
import type { MansionBlueprint, Prop, PropKind, RoomType } from '../mansion/core/types';
import { Rng } from '../mansion/core/rng';
import type { PhaseId } from './clock';
import type { Pathfinder } from './path';
import { facing, yawTo, type Places, type RoomCells } from './places';
import type { ActionId, Archetype, Held, NeedId, Person, Pose, Seat, Spot } from './types';

export interface Ad {
  id: string;
  /** The kind of action it is, for the phase weights. */
  action: ActionId;
  gains: Partial<Record<NeedId, number>>;
  /** In-game seconds, drawn between the two. */
  duration: readonly [number, number];
  pose: Pose;
  /** Multiplies the action's phase weight; a phase left out keeps it as it is, 0 rules it out. */
  phases?: Partial<Record<PhaseId, number>>;
  /** Trait and habit pull: 1 is neutral. */
  mod?: (p: Person) => number;
  /** Who takes to it more, by archetype. */
  likes?: Partial<Record<Archetype, number>>;
  /** Who may use it at all. */
  gate?: (p: Person) => boolean;
  /** What is in hand when they finish (a cue, cards, a cigarette). */
  gives?: Held;
  /** Passed on to the action (the game's kind for games). */
  note?: string;
}

/** One concrete offer in this house: an ad at an object, with its spots (one person each). */
export interface Offer {
  ad: Ad;
  room: number;
  spots: Spot[];
  /** A seat when the offer is somewhere to sit (one per offer). */
  seat?: Seat;
  /** Index into Places.games for a game table. */
  game?: number;
}

const look = (p: Person) => 0.5 + p.traits.curiosity;

/** The rows (A Real Party: Everything in the house people can use). */
export const ADS: Record<string, Ad> = {
  art: { id: 'art', action: 'art', gains: { curiosity: 0.5 }, duration: [60, 180], pose: 'look', mod: look, likes: { 'plus-one': 2.2, bore: 0.6 } },
  fire: {
    id: 'fire',
    action: 'use',
    gains: { rest: 0.25, social: 0.3 },
    duration: [180, 480],
    pose: 'stand',
    phases: { arrival: 0.8, mingle: 1, dancing: 0.5, games: 1.4, farewell: 0.6 },
    mod: (p) => 0.6 + 0.4 * p.traits.social,
    likes: { elderly: 2.5, mother: 2, 'old-friend': 1.6 },
  },
  browse: { id: 'browse', action: 'use', gains: { curiosity: 0.6, rest: 0.1 }, duration: [120, 400], pose: 'look', mod: (p) => 0.3 + p.traits.curiosity, likes: { 'plus-one': 2, bore: 1.5 } },
  globe: { id: 'globe', action: 'use', gains: { curiosity: 0.4 }, duration: [40, 120], pose: 'look', mod: (p) => (p.quirks.includes('globe-pointer') ? 4 : 0.4 + p.traits.curiosity) },
  rail: { id: 'rail', action: 'use', gains: { curiosity: 0.3, air: 0.1 }, duration: [60, 200], pose: 'look', mod: (p) => 0.3 + 0.7 * p.traits.nosy, likes: { gossip: 1.5 } },
  plants: { id: 'plants', action: 'use', gains: { curiosity: 0.3, air: 0.3 }, duration: [90, 240], pose: 'look', mod: look, likes: { young: 1.6, 'plus-one': 1.4 } },
  pool: { id: 'pool', action: 'use', gains: { curiosity: 0.3, air: 0.2 }, duration: [60, 180], pose: 'look', mod: look, likes: { young: 1.8 } },
  fountain: {
    id: 'fountain',
    action: 'use',
    gains: { air: 0.5, curiosity: 0.2, social: 0.1 },
    duration: [120, 300],
    pose: 'stand',
    phases: { dancing: 1.4, games: 1.4 },
    likes: { young: 2.5, flirt: 1.5 },
  },
  /** The kitchen magnet: counters to lean on, the bustle, a word with the cook. */
  kitchen: { id: 'kitchen', action: 'use', gains: { social: 0.45, hunger: 0.2 }, duration: [180, 420], pose: 'talk', mod: (p) => 0.4 + p.traits.social, likes: { life: 1.5, gossip: 1.5, child: 1.8 } },
  buffet: { id: 'buffet', action: 'snack', gains: { hunger: 0.5, social: 0.15 }, duration: [60, 180], pose: 'drink', phases: { dinner: 0 }, likes: { 'plus-one': 1.6 } },
  sit: {
    id: 'sit',
    action: 'sit',
    gains: { rest: 0.7, social: 0.1 },
    duration: [300, 900],
    pose: 'sit',
    mod: (p) => (p.quirks.includes('limp') ? 1.6 : 1),
    likes: { elderly: 2.5, mother: 4, life: 0.5, young: 0.6 },
  },
  terrace: {
    id: 'terrace',
    action: 'terrace',
    gains: { air: 0.8, curiosity: 0.1 },
    duration: [180, 480],
    pose: 'stand',
    mod: (p) => (p.quirks.includes('smoker') ? 1.8 : 1),
    likes: { young: 1.5 },
  },
  billiards: { id: 'billiards', action: 'games', gains: { curiosity: 0.4, social: 0.3 }, duration: [300, 900], pose: 'play', note: 'billiards', gives: 'cue', mod: (p) => (0.5 + 0.5 * p.traits.curiosity) * (p.role === 'billiards' ? 2.5 : 1), likes: { boss: 1.5, 'old-friend': 1.4 } },
  cards: { id: 'cards', action: 'games', gains: { curiosity: 0.4, social: 0.3 }, duration: [300, 900], pose: 'play', note: 'cards', gives: 'cards', mod: (p) => 0.5 + 0.5 * p.traits.curiosity, likes: { elderly: 1.6, 'old-friend': 1.4 } },
  piano: { id: 'piano', action: 'games', gains: { curiosity: 0.4, social: 0.3 }, duration: [300, 900], pose: 'look', note: 'piano', mod: (p) => (0.5 + 0.5 * p.traits.curiosity) * (p.role === 'pianist' ? 2.5 : 1), likes: { life: 1.8 } },
  cinema: { id: 'cinema', action: 'games', gains: { curiosity: 0.4, rest: 0.3 }, duration: [300, 900], pose: 'look', note: 'cinema', mod: (p) => 0.5 + 0.5 * p.traits.curiosity, likes: { young: 1.4 } },
};

const SIGHT_POIS = new Set(['painting', 'statue', 'clock']);
const SIGHT_PROPS: ReadonlySet<PropKind> = new Set(['bust', 'statue']);
/** Rooms where a guest browses the shelves. */
const SHELVES: ReadonlySet<RoomType> = new Set(['library', 'morning-room', 'gallery', 'drawing-room', 'great-room']);
/** Rooms nobody idles in, whatever is in them. */
const NOT_HERE: ReadonlySet<RoomType> = new Set(['bathroom', 'bedroom', 'dressing-room', 'study', 'pantry', 'service-stair', 'cloakroom']);

/** Resolve the table into this house's offers. Draws come from their own stream, so nothing else shifts. */
export function resolveOffers(bp: MansionBlueprint, pf: Pathfinder, cells: RoomCells, places: Places): Offer[] {
  const rng = new Rng(`ads/${bp.seed}`);
  const out: Offer[] = [];
  const roomIdx = new Map(bp.rooms.map((r) => [r.id, r.index]));
  const typeOf = (room: number): RoomType | null => (room >= 0 ? bp.rooms[room]!.type : null);
  const ok = (room: number) => room !== -1 && !(room >= 0 && NOT_HERE.has(typeOf(room)!));
  const spotAt = (level: number, x: number, z: number, yaw: number, r = 0.8): Spot | null => {
    const w = pf.snap(level, x, z, r);
    if (!w) return null;
    const room = pf.roomAt(level, w.x, w.z);
    return room === -1 ? null : { level, x: w.x, z: w.z, yaw, room };
  };
  /** Up to n spots in an arc in front of a point, facing it. */
  const arc = (level: number, x: number, z: number, yaw: number, reach: number, n: number): Spot[] => {
    const spots: Spot[] = [];
    for (const a of [0, 0.7, -0.7, 1.3, -1.3].slice(0, n + 1)) {
      if (spots.length >= n) break;
      const f = facing(yaw + a);
      const sx = x + f.x * reach;
      const sz = z + f.z * reach;
      const s = spotAt(level, sx, sz, yawTo(sx, sz, x, z), 0.5);
      if (s && !spots.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 0.6)) spots.push(s);
    }
    return spots;
  };
  const add = (ad: Ad, spots: Spot[], extra: Partial<Offer> = {}) => {
    const live = spots.filter((s) => ok(s.room));
    if (live.length) out.push({ ad, room: live[0]!.room, spots: live, ...extra });
  };

  for (const poi of bp.pois) {
    const room = poi.roomId ? (roomIdx.get(poi.roomId) ?? -1) : -1;
    if (room < 0 || !ok(room)) continue;
    const role = bp.rooms[room]!.role;
    if (SIGHT_POIS.has(poi.type) && (role === 'party' || role === 'circulation')) {
      const s = spotAt(poi.level, poi.stand.x, poi.stand.z, poi.stand.yaw, 1.2);
      if (s) add(ADS.art!, [s]);
    } else if (poi.type === 'fireplace' && role === 'party') {
      const prop = poi.propId ? bp.props.find((p) => p.id === poi.propId) : undefined;
      add(ADS.fire!, prop ? arc(prop.level, prop.x, prop.z, prop.yaw, prop.d / 2 + 1.1, 3) : [spotAt(poi.level, poi.stand.x, poi.stand.z, poi.stand.yaw, 1.2)].filter((s): s is Spot => !!s));
    } else if (poi.type === 'bookshelf' && SHELVES.has(bp.rooms[room]!.type)) {
      const s = spotAt(poi.level, poi.stand.x, poi.stand.z, poi.stand.yaw, 1.2);
      if (s) add(ADS.browse!, [s]);
    } else if (poi.type === 'globe') {
      const s = spotAt(poi.level, poi.stand.x, poi.stand.z, poi.stand.yaw, 1.2);
      if (s) add(ADS.globe!, [s]);
    }
  }
  const front = (p: Prop): Spot | null => {
    const f = facing(p.yaw);
    const x = p.x + f.x * (p.d / 2 + 0.55);
    const z = p.z + f.z * (p.d / 2 + 0.55);
    return spotAt(p.level, x, z, yawTo(x, z, p.x, p.z), 1);
  };
  for (const p of bp.props) {
    const room = p.roomId ? (roomIdx.get(p.roomId) ?? -1) : -1;
    if (room < 0 || !ok(room)) continue;
    if (SIGHT_PROPS.has(p.kind) && !p.poi && (bp.rooms[room]!.role === 'party' || bp.rooms[room]!.role === 'circulation')) {
      const s = front(p);
      if (s) add(ADS.art!, [s]);
    } else if (p.kind === 'kitchen-island') {
      add(ADS.kitchen!, [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => {
        const f = facing(p.yaw + a);
        const reach = (a === 0 || a === Math.PI ? p.d : p.w) / 2 + 0.5;
        const x = p.x + f.x * reach;
        const z = p.z + f.z * reach;
        return spotAt(p.level, x, z, yawTo(x, z, p.x, p.z), 0.5);
      }).filter((s): s is Spot => !!s));
    }
  }
  // Rooms that offer themselves: the gallery rail over the hall, a stroll among the plants, the pool.
  for (const r of bp.rooms) {
    const t = r.type;
    const ad = t === 'hall-gallery' ? ADS.rail : t === 'conservatory' ? ADS.plants : t === 'spa' ? ADS.pool : undefined;
    if (!ad) continue;
    const spots: Spot[] = [];
    for (let i = 0; i < 6 && spots.length < 3; i++) {
      const s = cells.random(r.index, rng, 0.8);
      if (s && !spots.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 1.2)) spots.push(s);
    }
    for (const s of spots) out.push({ ad, room: r.index, spots: [s] });
  }
  for (const s of places.buffet) add(ADS.buffet!, [s]);
  for (const seat of places.seats) out.push({ ad: ADS.sit!, room: seat.approach.room, spots: [seat.approach], seat });
  for (const s of places.terrace) out.push({ ad: ADS.terrace!, room: -2, spots: [s] });
  const fountain = places.chains.water.link === 'fountain' ? places.chains.water.spots : places.chains.proposal.link === 'fountain' ? places.chains.proposal.spots : [];
  for (const s of fountain) out.push({ ad: ADS.fountain!, room: -2, spots: [s] });
  places.games.forEach((g, gi) => out.push({ ad: ADS[g.kind]!, room: g.room.index, spots: g.spots, game: gi }));
  return out;
}
