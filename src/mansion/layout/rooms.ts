/**
 * Floor plans (stage 2): split each pile of the bay grid into rooms and assign
 * the programme.
 *
 * Partitions are symmetric compositions of bays about the axis, so walls fall
 * on bay lines and every room gets whole window bays. Upper floors reuse the
 * ground-floor partition lines so walls stack.
 */
import { rect, type Rect } from '../core/geom';
import { snap, type Rng } from '../core/rng';
import type { RoomRole, RoomType } from '../core/types';
import { bayLine, type MassingPlan, type WingSpec } from './massing';

export interface RoomDraft {
  id: string;
  type: RoomType;
  level: number;
  massId: string;
  rect: Rect;
  zone: 'front' | 'back' | 'corridor' | 'wing' | 'conservatory';
  doubleHeight: boolean;
  floorHoles: Rect[];
}

export const ROLE: Record<RoomType, RoomRole> = {
  ballroom: 'party',
  'grand-salon': 'party',
  'drawing-room': 'party',
  'music-room': 'party',
  library: 'party',
  'dining-room': 'party',
  gallery: 'party',
  'billiard-room': 'party',
  'card-room': 'party',
  'morning-room': 'party',
  conservatory: 'party',
  'entrance-hall': 'circulation',
  'stair-hall': 'circulation',
  corridor: 'circulation',
  landing: 'circulation',
  'hall-gallery': 'circulation',
  'roof-terrace': 'party',
  'service-stair': 'circulation',
  'great-room': 'party',
  bar: 'party',
  cinema: 'party',
  spa: 'party',
  theatre: 'party',
  disco: 'party',
  gym: 'private',
  kitchen: 'service',
  study: 'private',
  bedroom: 'private',
  'sitting-room': 'private',
  'dressing-room': 'private',
  bathroom: 'private',
  cloakroom: 'service',
  pantry: 'service',
};

export function isPassThrough(type: RoomType): boolean {
  const role = ROLE[type];
  // Caterers come and go through the kitchen all evening: it may be walked through.
  return role === 'party' || role === 'circulation' || type === 'sitting-room' || type === 'kitchen';
}

/**
 * Random composition of `k` bays into parts (listed from the axis outward).
 * `first`/`last` pin the innermost/outermost part sizes when feasible.
 */
export function composeBays(
  rng: Rng,
  k: number,
  weights: ReadonlyArray<readonly [number, number]>,
  first?: number,
  last?: number,
): number[] {
  const sizes = weights.map(([s]) => s);
  const canMake = (n: number): boolean => {
    // Reachability with unbounded parts from `sizes` (tiny DP).
    const ok = new Array<boolean>(n + 1).fill(false);
    ok[0] = true;
    for (let i = 1; i <= n; i++) ok[i] = sizes.some((s) => s <= i && ok[i - s]);
    return ok[n]!;
  };
  for (let attempt = 0; attempt < 64; attempt++) {
    const parts: number[] = [];
    let rem = k;
    if (first !== undefined && first <= rem) {
      parts.push(first);
      rem -= first;
    }
    let tail = 0;
    if (last !== undefined && rem >= last && canMake(rem - last)) {
      tail = last;
      rem -= last;
    }
    let guard = 0;
    while (rem > 0 && guard++ < 64) {
      const options = weights.filter(([s]) => s <= rem && canMake(rem - s));
      if (options.length === 0) break;
      const s = rng.weighted(options);
      parts.push(s);
      rem -= s;
    }
    if (rem !== 0) continue;
    if (tail) parts.push(tail);
    return parts;
  }
  // Fallback: single parts (always valid).
  return new Array<number>(k).fill(1);
}

/** Mirror side compositions into bay index ranges, west to east. */
function symmetricRanges(bays: number, center: number, side: number[]): [number, number][] {
  const k = (bays - center) / 2;
  const ranges: [number, number][] = [];
  // West side: outermost first.
  let i = 0;
  for (const s of side.slice().reverse()) {
    ranges.push([i, i + s]);
    i += s;
  }
  ranges.push([k, k + center]);
  i = k + center;
  for (const s of side) {
    ranges.push([i, i + s]);
    i += s;
  }
  return ranges;
}

// Party rooms on the garden front are two or three bays wide: no one-bay rooms in a house like this.
const FRONT_WEIGHTS = [
  [2, 0.55],
  [3, 0.45],
] as const;

const BACK_WEIGHTS = [
  [1, 0.18],
  [2, 0.5],
  [3, 0.32],
] as const;

// No single-bay wing rooms: a wing bay is too narrow for a party room.
const WING_WEIGHTS = [
  [2, 0.55],
  [3, 0.45],
] as const;

/** With fewer party rooms than this on the ground floor, reception rooms are added upstairs. */
export const MIN_GROUND_PARTY_ROOMS = 7;
/** Narrowest side (m) a room may have and still be a room of the party. */
const MIN_PARTY_SPAN = 5;

export interface FloorPlan {
  rooms: RoomDraft[];
  /** Front/back partitions as bay index ranges (west→east). */
  frontRanges: [number, number][];
  backRanges: [number, number][];
}

export function planRooms(rng: Rng, m: MassingPlan): FloorPlan {
  const rooms: RoomDraft[] = [];
  const n = m.bays;
  const kF = (n - m.centerFront) / 2;
  const kB = (n - m.centerBack) / 2;

  // Wing junction rooms should not be split by the wing wall, so pin the
  // outermost front part to the wing width (2 bays) when wings face the garden.
  const gardenWings = m.wings.some((w) => w.toward === 'garden');
  const frontSide = composeBays(rng.fork('front'), kF, FRONT_WEIGHTS, undefined, gardenWings && kF >= 2 ? 2 : undefined);
  // Back pile, from the axis outward: a one-bay room beside the entrance hall (behind the dome
  // hall), then rooms of the back pile proper, ending in a one-bay service column.
  const backSide = composeBays(rng.fork('back'), kB, BACK_WEIGHTS, (m.centerFront - m.centerBack) / 2, 1);
  const frontRanges = symmetricRanges(n, m.centerFront, frontSide);
  const backRanges = symmetricRanges(n, m.centerBack, backSide);

  const xr = (r: [number, number]) => [bayLine(m, r[0]), bayLine(m, r[1])] as const;
  const centerIndexF = frontSide.length;
  const centerIndexB = backSide.length;
  const pz = m.gardenPavilion?.depth ?? 0;
  const pe = m.entrancePavilion?.depth ?? 0;
  const [hallX0, hallX1] = xr(frontRanges[centerIndexF]!);
  const hallRect = rect(hallX0, m.zHallBack, hallX1, m.zGarden + pz);
  /** Back-pile rooms directly behind the dome hall: the entrance hall and the room either side of it. */
  const behindHall = (i: number) => Math.abs(i - centerIndexB) <= 1;

  /* ---------------- Ground floor (level 0): the party floor ---------------- */
  const typeRng = rng.fork('types');
  const required: RoomType[] = typeRng.shuffle(['drawing-room', 'dining-room', 'library'] as RoomType[]);
  const optional: RoomType[] = typeRng.shuffle([
    'music-room',
    'card-room',
    'morning-room',
    'billiard-room',
    'gallery',
    'drawing-room',
    'music-room',
  ] as RoomType[]);
  const takeFront = (bays: number): RoomType => {
    if (required.length) return required.shift()!;
    const idx = optional.findIndex((t) => t !== 'gallery' || bays >= 3);
    if (idx >= 0) return optional.splice(idx, 1)[0]!;
    return typeRng.pick(['drawing-room', 'card-room', 'morning-room'] as RoomType[]);
  };

  // Pair types from the axis outward so mirrored rooms differ.
  const frontTypes: RoomType[] = new Array(frontRanges.length);
  frontTypes[centerIndexF] = 'ballroom';
  for (let j = 0; j < frontSide.length; j++) {
    const west = centerIndexF - 1 - j;
    const east = centerIndexF + 1 + j;
    frontTypes[west] = takeFront(frontSide[j]!);
    frontTypes[east] = takeFront(frontSide[j]!);
  }
  frontRanges.forEach((r, i) => {
    const [x0, x1] = xr(r);
    const isCenter = i === centerIndexF;
    rooms.push({
      id: `0:F${i}`,
      type: frontTypes[i]!,
      level: 0,
      massId: 'main',
      rect: isCenter ? hallRect : rect(x0, m.zFrontInner, x1, m.zGarden),
      zone: 'front',
      doubleHeight: false,
      floorHoles: [],
    });
  });

  const backTypes: RoomType[] = new Array(backRanges.length);
  backTypes[centerIndexB] = 'entrance-hall';
  const serviceWest = m.serviceSide === 'west';
  // Rooms the party can use first: a deep back pile has space for several.
  const backPool: RoomType[] = [...required.splice(0), ...typeRng.shuffle(['billiard-room', 'card-room', 'morning-room', 'music-room', 'study', 'gallery'] as RoomType[])];
  for (let j = 0; j < backSide.length; j++) {
    const west = centerIndexB - 1 - j;
    const east = centerIndexB + 1 + j;
    const outermost = j === backSide.length - 1;
    if (j === 0 && backSide[0]! < 2) {
      // Either side of the entrance hall.
      const pair = typeRng.shuffle(['study', 'cloakroom', 'cloakroom', 'pantry'] as RoomType[]);
      backTypes[west] = pair[0]!;
      backTypes[east] = pair[1]!;
    } else if (outermost) {
      backTypes[serviceWest ? west : east] = 'service-stair';
      backTypes[serviceWest ? east : west] = typeRng.pick(['cloakroom', 'pantry'] as RoomType[]);
    } else {
      const pick = (bays: number): RoomType => {
        const idx = backPool.findIndex((t) => t !== 'gallery' || bays >= 3);
        return idx >= 0 ? backPool.splice(idx, 1)[0]! : 'card-room';
      };
      backTypes[west] = pick(backSide[j]!);
      backTypes[east] = pick(backSide[j]!);
    }
  }
  // The service stair is a full-depth column at one end of the back pile on
  // every storey, so stacked flights always have room; corridors stop at it.
  const serviceIndex = serviceWest ? 0 : backRanges.length - 1;
  const [sx0, sx1] = xr(backRanges[serviceIndex]!);
  const corrX0 = serviceWest ? sx1 : -m.W / 2;
  const corrX1 = serviceWest ? m.W / 2 : sx0;
  backRanges.forEach((r, i) => {
    const [x0, x1] = xr(r);
    const isCenter = i === centerIndexB;
    rooms.push({
      id: `0:B${i}`,
      type: backTypes[i]!,
      level: 0,
      massId: 'main',
      rect: rect(x0, isCenter ? m.zEntrance - pe : m.zEntrance, x1, behindHall(i) ? m.zHallBack : i === serviceIndex ? m.zFrontInner : m.zBackInner),
      zone: 'back',
      doubleHeight: false,
      floorHoles: [],
    });
  });

  // The spine corridor stops at the dome hall on either side of it.
  const corridorHalves = (L: number, z0: number, z1: number) => {
    for (const [tag, x0, x1] of [
      ['w', corrX0, hallX0],
      ['e', hallX1, corrX1],
    ] as const) {
      if (x1 - x0 < 1) continue;
      rooms.push({ id: `${L}:C${tag}`, type: 'corridor', level: L, massId: 'main', rect: rect(x0, z0, x1, z1), zone: 'corridor', doubleHeight: false, floorHoles: [] });
    }
  };
  if (m.dc > 0) corridorHalves(0, m.zBackInner, m.zFrontInner);

  /* ---------------- Wings ---------------- */
  const wingRng = rng.fork('wings');
  const wingComps = new Map<string, number[]>();
  for (const toward of ['garden', 'entrance'] as const) {
    const pair = m.wings.filter((w) => w.toward === toward);
    if (pair.length === 0) continue;
    const nb = pair[0]!.bays;
    const comp =
      nb >= 3 && toward === 'garden' && wingRng.chance(0.35) ? [nb] : composeBays(wingRng, nb, WING_WEIGHTS);
    wingComps.set(toward, comp);
  }
  for (const w of m.wings) {
    const comp = wingComps.get(w.toward)!;
    const pool: RoomType[] =
      w.toward === 'garden'
        ? wingRng.shuffle(['music-room', 'card-room', 'billiard-room', 'morning-room', 'drawing-room'] as RoomType[])
        : wingRng.shuffle(['billiard-room', 'study', 'card-room', 'pantry', 'cloakroom', 'morning-room'] as RoomType[]);
    let start = 0;
    comp.forEach((s, j) => {
      const r = wingPartRect(m, w, start, start + s);
      start += s;
      const type: RoomType = comp.length === 1 ? 'gallery' : s >= 3 && j === 0 && w.toward === 'garden' ? 'gallery' : pool[j % pool.length]!;
      rooms.push({
        id: `0:${w.side === 'west' ? 'W' : 'E'}${w.toward === 'garden' ? 'g' : 'e'}${j}`,
        type,
        level: 0,
        massId: w.id,
        rect: r,
        zone: 'wing',
        doubleHeight: false,
        floorHoles: [],
      });
    });
  }

  if (m.conservatory) {
    rooms.push({
      id: '0:K',
      type: 'conservatory',
      level: 0,
      massId: 'conservatory',
      rect: m.conservatory.rect,
      zone: 'conservatory',
      doubleHeight: false,
      floorHoles: [],
    });
  }

  // A grand house has no narrow reception rooms: anything under five metres across is a study, not a salon.
  for (const r of rooms) {
    if (ROLE[r.type] !== 'party' || r.type === 'ballroom' || r.type === 'conservatory') continue;
    if (Math.min(r.rect.x1 - r.rect.x0, r.rect.z1 - r.rect.z0) < MIN_PARTY_SPAN) r.type = 'study';
  }

  /* ---------------- Upper floors ---------------- */
  const upRng = rng.fork('upper');
  const groundParty = rooms.filter((r) => r.level === 0 && ROLE[r.type] === 'party').length;
  const partyUpstairs = groundParty < MIN_GROUND_PARTY_ROOMS || m.partyUpstairs;
  const upstairsParty = upRng.shuffle(['morning-room', 'music-room', 'card-room', 'drawing-room'] as RoomType[]);
  const upstairsMore = upRng.shuffle(['gallery', 'morning-room', 'card-room', 'music-room', 'drawing-room', 'billiard-room'] as RoomType[]);
  const [uc0, uc1] = m.upperCorridor;
  for (let L = 1; L < m.mainLevels; L++) {
    const attic = L >= 2;
    frontRanges.forEach((r, i) => {
      const isCenter = i === centerIndexF;
      const [x0, x1] = xr(r);
      if (isCenter) {
        // Over the ball room: the hall stays open, ringed by a gallery on this floor.
        rooms.push({ id: `${L}:G`, type: 'hall-gallery', level: L, massId: 'main', rect: hallRect, zone: 'front', doubleHeight: false, floorHoles: [] });
        return;
      }
      // When the hall has taken much of the ground floor, the party spills upstairs: the rooms either
      // side of the first gallery become reception rooms, reached straight off the stair.
      const besideGallery = L === 1 && Math.abs(i - centerIndexF) === 1;
      // Where the windows show both storeys, the whole first-floor garden front is the party's.
      const wide = x1 - x0 >= MIN_PARTY_SPAN;
      const type: RoomType =
        besideGallery && partyUpstairs
          ? upstairsParty[i < centerIndexF ? 0 : 1]!
          : L === 1 && m.partyUpstairs && wide
            ? upstairsMore[i % upstairsMore.length]!
            : attic
              ? 'bedroom'
              : upRng.pick(['bedroom', 'bedroom', 'sitting-room'] as RoomType[]);
      rooms.push({
        id: `${L}:F${i}`,
        type,
        level: L,
        massId: 'main',
        rect: rect(x0, m.zFrontInner, x1, m.zGarden),
        zone: 'front',
        doubleHeight: false,
        floorHoles: [],
      });
    });
    corridorHalves(L, uc0, uc1);
    backRanges.forEach((r, i) => {
      const [x0, x1] = xr(r);
      const isCenter = i === centerIndexB;
      if (i === serviceIndex) {
        rooms.push({
          id: `${L}:B${i}`,
          type: 'service-stair',
          level: L,
          massId: 'main',
          rect: rect(x0, m.zEntrance, x1, m.zFrontInner),
          zone: 'back',
          doubleHeight: false,
          floorHoles: [],
        });
        return;
      }
      let type: RoomType;
      if (isCenter) type = attic ? 'bedroom' : upRng.pick(['sitting-room', 'bedroom'] as RoomType[]);
      else if (attic) type = r[1] - r[0] >= 2 ? 'bedroom' : upRng.pick(['bathroom', 'dressing-room'] as RoomType[]);
      else type = r[1] - r[0] >= 2 ? upRng.pick(['bedroom', 'bedroom', 'sitting-room'] as RoomType[]) : upRng.pick(['bathroom', 'dressing-room'] as RoomType[]);
      rooms.push({
        id: `${L}:B${i}`,
        type,
        level: L,
        massId: 'main',
        rect: rect(x0, isCenter ? m.zEntrance - pe : m.zEntrance, x1, behindHall(i) ? m.zHallBack : uc0),
        zone: 'back',
        doubleHeight: false,
        floorHoles: [],
      });
    });

    for (const w of m.wings) {
      if (L >= w.levels) continue;
      const comp = wingComps.get(w.toward)!;
      // Corridor strip along the court-facing side keeps bedrooms off the route.
      const inner = w.side === 'west' ? 'x1' : 'x0';
      const cw = 2.8;
      const corr =
        inner === 'x1'
          ? rect(snap(w.rect.x1 - cw, 0.01), w.rect.z0, w.rect.x1, w.rect.z1)
          : rect(w.rect.x0, w.rect.z0, snap(w.rect.x0 + cw, 0.01), w.rect.z1);
      rooms.push({
        id: `${L}:${w.side === 'west' ? 'W' : 'E'}${w.toward === 'garden' ? 'g' : 'e'}C`,
        type: 'corridor',
        level: L,
        massId: w.id,
        rect: corr,
        zone: 'wing',
        doubleHeight: false,
        floorHoles: [],
      });
      let start = 0;
      comp.forEach((s, j) => {
        const full = wingPartRect(m, w, start, start + s);
        start += s;
        const r = inner === 'x1' ? rect(full.x0, full.z0, corr.x0, full.z1) : rect(corr.x1, full.z0, full.x1, full.z1);
        rooms.push({
          id: `${L}:${w.side === 'west' ? 'W' : 'E'}${w.toward === 'garden' ? 'g' : 'e'}${j}`,
          type: s >= 2 ? 'bedroom' : upRng.pick(['dressing-room', 'bathroom'] as RoomType[]),
          level: L,
          massId: w.id,
          rect: r,
          zone: 'wing',
          doubleHeight: false,
          floorHoles: [],
        });
      });
    }
  }

  assignProgramme(rng.fork('programme'), rooms);
  return { rooms, frontRanges, backRanges };
}

/* ------------------------------------------------------------------ */
/* The programme: which room is what                                    */
/* ------------------------------------------------------------------ */

interface ProgrammeItem {
  type: RoomType;
  /** Least clear span and floor area (m, m2) the room needs. */
  span: number;
  area: number;
  /** Storeys it may be on, in order of preference. */
  levels: number[];
  /** Added to a slot's score by its zone. */
  zones: Partial<Record<RoomDraft['zone'], number>>;
  /** +1: takes the largest slot that fits; -1: the smallest. */
  size: 1 | -1;
}

/** Every house has these, placed in this order (the hungriest for space first). */
const REQUIRED: ProgrammeItem[] = [
  { type: 'great-room', span: 6, area: 60, levels: [0], zones: { front: 1 }, size: 1 },
  { type: 'dining-room', span: 5.5, area: 48, levels: [0], zones: { front: 0.5, back: 0.2 }, size: 1 },
  { type: 'kitchen', span: 4.5, area: 30, levels: [0], zones: { back: 1.5, wing: 0.5 }, size: -1 },
  { type: 'library', span: 5, area: 38, levels: [0, 1], zones: { front: 0.3, back: 0.3 }, size: 1 },
  { type: 'bar', span: 4.6, area: 28, levels: [0, 1], zones: { back: 1, wing: 0.6 }, size: -1 },
  { type: 'drawing-room', span: 5, area: 40, levels: [0, 1], zones: { front: 0.8 }, size: 1 },
  { type: 'study', span: 3.2, area: 14, levels: [0, 1], zones: { back: 0.6 }, size: -1 },
];

/** Rooms a house may have, each with its chance. */
const OPTIONAL: (ProgrammeItem & { chance: number })[] = [
  { type: 'disco', chance: 0.8, span: 6.5, area: 68, levels: [0, 1], zones: { wing: 0.9, back: 0.6, front: 0.3 }, size: 1 },
  { type: 'grand-salon', chance: 0.6, span: 6, area: 55, levels: [0, 1], zones: { front: 1 }, size: 1 },
  { type: 'cinema', chance: 0.6, span: 5, area: 36, levels: [0, 1], zones: { back: 1.2, wing: 0.4 }, size: -1 },
  { type: 'gym', chance: 0.62, span: 4.5, area: 30, levels: [0, 1], zones: { back: 1, wing: 0.8 }, size: -1 },
  { type: 'spa', chance: 0.5, span: 6, area: 60, levels: [0], zones: { wing: 1.2, front: 0.4, back: 0.2 }, size: 1 },
  { type: 'theatre', chance: 0.3, span: 6, area: 55, levels: [0, 1], zones: { wing: 0.8, back: 0.5, front: 0.3 }, size: 1 },
];

/** What fills the reception rooms left over, each once before any repeats. */
const FILLERS: RoomType[] = ['music-room', 'billiard-room', 'card-room', 'morning-room', 'gallery'];
/** Once those are used up: rooms a great house may have more than one of. */
const REPEATABLE: RoomType[] = ['drawing-room', 'morning-room', 'card-room'];
/** What fills the rooms too narrow for the party, in order. */
const SMALL: RoomType[] = ['cloakroom', 'pantry', 'bathroom', 'study'];
const FIXED = new Set<RoomType>(['ballroom', 'entrance-hall', 'service-stair', 'corridor', 'hall-gallery', 'conservatory', 'landing', 'roof-terrace', 'stair-hall']);
/** Bathrooms every house has at least, and the number it aims for. */
export const MIN_BATHROOMS = 2;
const WANT_BATHROOMS = 3;

/**
 * Decide what each room is. The plan above fixes the shell (hall, entrance, stairs, corridors) and
 * the size of every other room; this hands those rooms out: first the rooms every house must have,
 * then the optional ones by chance, then one each of the remaining reception rooms. No type repeats
 * while another is still unused, so a house gets a cinema before it gets a second music room.
 */
function assignProgramme(rng: Rng, rooms: RoomDraft[]): void {
  const span = (r: RoomDraft) => Math.min(r.rect.x1 - r.rect.x0, r.rect.z1 - r.rect.z0) - 0.4;
  const area = (r: RoomDraft) => (r.rect.x1 - r.rect.x0 - 0.4) * (r.rect.z1 - r.rect.z0 - 0.4);
  const slots = rooms.filter((r) => !FIXED.has(r.type) && r.level <= 1);
  const free = new Set(slots.filter((r) => r.level === 0));
  // Upstairs, a bedroom or sitting room can give way to a room the house must have; bathrooms and dressing rooms stay.
  const spare = new Set(slots.filter((r) => r.level === 1 && r.type !== 'bathroom' && r.type !== 'dressing-room'));
  const jitter = new Map(slots.map((r) => [r, rng.range(0, 0.4)]));

  const place = (it: ProgrammeItem, relax = 1): boolean => {
    for (const level of it.levels) {
      const pool = [...(level === 0 ? free : spare)].filter((r) => r.level === level && span(r) >= it.span * relax && area(r) >= it.area * relax);
      if (!pool.length) continue;
      const score = (r: RoomDraft) => (it.zones[r.zone] ?? 0) + (it.size * area(r)) / 120 + jitter.get(r)!;
      const best = pool.sort((a, b) => score(b) - score(a))[0]!;
      best.type = it.type;
      free.delete(best);
      spare.delete(best);
      return true;
    }
    return false;
  };
  for (const it of REQUIRED) {
    // A tight house makes do with a smaller room, on either storey, rather than go without.
    if (!place(it) && !place(it, 0.7) && !place({ ...it, levels: [0, 1] }, 0.5)) place({ ...it, levels: [0, 1], span: 3, area: 10 });
  }
  for (const it of rng.shuffle([...OPTIONAL])) if (rng.chance(it.chance)) place(it);

  // The rest of the ground floor.
  const fillers = rng.shuffle([...FILLERS]);
  let f = 0;
  let s = 0;
  for (const r of [...free].sort((a, b) => area(b) - area(a))) {
    if (span(r) >= MIN_PARTY_SPAN - 0.4) {
      // A picture gallery wants a long room.
      const long = Math.max(r.rect.x1 - r.rect.x0, r.rect.z1 - r.rect.z0) >= 10;
      const k = fillers.findIndex((t) => t !== 'gallery' || long);
      // Each once; after that only the kinds of room a great house has several of. Never a second music or billiard room.
      r.type = k >= 0 ? fillers.splice(k, 1)[0]! : REPEATABLE[f++ % REPEATABLE.length]!;
    } else r.type = SMALL[s++ % SMALL.length]!;
  }

  // Upstairs reception rooms were handed out before the ground floor was settled: one that repeats a
  // music or billiard room downstairs becomes a drawing room.
  for (const r of rooms) {
    if (r.level < 1 || (r.type !== 'music-room' && r.type !== 'billiard-room' && r.type !== 'gallery')) continue;
    if (rooms.some((q) => q !== r && q.type === r.type)) r.type = 'drawing-room';
  }

  // Bathrooms: dressing rooms, then the smallest bedrooms, become bathrooms until there are enough.
  const count = () => rooms.filter((r) => r.type === 'bathroom').length;
  const give = (types: RoomType[], target: number) => {
    const pool = rooms.filter((r) => r.level >= 1 && types.includes(r.type)).sort((a, b) => area(a) - area(b));
    while (count() < target && pool.length) pool.shift()!.type = 'bathroom';
  };
  give(['dressing-room'], WANT_BATHROOMS);
  give(['bedroom', 'sitting-room'], MIN_BATHROOMS);
}

/** Rect of wing bays [s, e) counted from the junction with the main block. */
export function wingPartRect(m: MassingPlan, w: WingSpec, s: number, e: number): Rect {
  if (w.toward === 'garden') {
    return rect(w.rect.x0, snap(m.zGarden + s * m.bay, 0.01), w.rect.x1, snap(m.zGarden + e * m.bay, 0.01));
  }
  return rect(w.rect.x0, snap(m.zEntrance - e * m.bay, 0.01), w.rect.x1, snap(m.zEntrance - s * m.bay, 0.01));
}
