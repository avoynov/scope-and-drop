/**
 * The cast of one evening, from the seed: 20–30 guests plus the host and staff.
 * Each person has a look (told apart at 4× by outfit colour and silhouette), a role,
 * traits, quirks and relationships (spec: The cast).
 */
import type { Rng } from '../mansion/core/rng';
import type { Places } from './places';
import { NEED_IDS, STAFF_ROLES, type Look, type Needs, type Outfit, type Person, type Quirk, type RoleId, type Sex, type Traits } from './types';

const FIRST: Record<Sex, string[]> = {
  f: ['Adela', 'Beatrice', 'Clara', 'Daria', 'Elena', 'Flora', 'Greta', 'Helena', 'Irina', 'Julia', 'Katya', 'Lena', 'Maren', 'Nadia', 'Olga', 'Petra', 'Rosa', 'Sofia', 'Tamara', 'Vera', 'Yana', 'Zora', 'Agnes', 'Lidia', 'Mila', 'Ines', 'Edith', 'Vanya'],
  m: ['Anton', 'Boris', 'Cyril', 'Dimitar', 'Emil', 'Felix', 'Georg', 'Hugo', 'Ivan', 'Jonas', 'Kiril', 'Leon', 'Marko', 'Nikolai', 'Oskar', 'Pavel', 'Rafael', 'Stefan', 'Teodor', 'Viktor', 'Yuri', 'Zachary', 'Arno', 'Lucas', 'Matthias', 'Rolf', 'Silvio', 'Bogdan'],
};
const SURNAMES = ['Albrecht', 'Bellamy', 'Castell', 'Draganov', 'Eckhart', 'Falk', 'Grisham', 'Hartley', 'Ivanova', 'Jansen', 'Kessler', 'Lindqvist', 'Marchetti', 'Novak', 'Orlov', 'Petrov', 'Quint', 'Rossi', 'Sterling', 'Thorne', 'Ulrich', 'Varga', 'Whitlock', 'Zanetti', 'Morrow', 'Avery', 'Delacroix', 'Halloran'];

/** Distinct outfit colourways, each a garment colour and an accent. Men's are mostly dark with a few standouts. */
const MEN: ReadonlyArray<readonly [Outfit, string, string]> = [
  ['tails', '#15161b', '#f1efe8'],
  ['suit', '#1d2a44', '#e8e6df'],
  ['suit', '#3a3d42', '#efece4'],
  ['dinner-jacket', '#eee6d2', '#17181c'],
  ['dinner-jacket', '#6b1f2c', '#ece8e0'],
  ['suit', '#24432f', '#e9e6dc'],
  ['suit', '#8a6e4b', '#f0ebe0'],
  ['dinner-jacket', '#2c2f6b', '#f1efe8'],
  ['suit', '#5e5f63', '#202226'],
  ['tails', '#2b1d17', '#f3efe5'],
  ['dinner-jacket', '#c9c5bb', '#15161b'],
  ['suit', '#4a2b52', '#ebe7df'],
  ['suit', '#0f3a4a', '#e9e6dc'],
  ['dinner-jacket', '#7a5a1e', '#efe9dc'],
  ['tails', '#2a2440', '#ece9e2'],
  ['suit', '#5a1c1c', '#e9e4da'],
];
const WOMEN: ReadonlyArray<readonly [Outfit, string, string]> = [
  ['long-dress', '#b3122b', '#e6c27a'],
  ['long-dress', '#0f6b4f', '#e0d6c0'],
  ['long-dress', '#d9b54a', '#3a2a12'],
  ['short-dress', '#c3c7cc', '#2a2c30'],
  ['long-dress', '#1f3f9a', '#d8d2c4'],
  ['short-dress', '#141416', '#d9c08a'],
  ['long-dress', '#f2ece0', '#7d6a4a'],
  ['long-dress', '#5e1f63', '#e1cfa0'],
  ['short-dress', '#16808a', '#ede6d6'],
  ['long-dress', '#d76d84', '#f3e9e0'],
  ['short-dress', '#e07a24', '#2a1b10'],
  ['long-dress', '#6f7d3a', '#efe7d0'],
  ['long-dress', '#8e1c1c', '#141416'],
  ['short-dress', '#7aa6d9', '#20222a'],
  ['short-dress', '#3b5a3a', '#e8e0cc'],
  ['long-dress', '#c0a0d8', '#2a2233'],
];
const SKIN = ['#f1d3bd', '#e7bf9f', '#d8a47f', '#b9805a', '#8f5a3b', '#5f3a26'];
const HAIR = ['#1b1512', '#3b2a1e', '#6a4a2f', '#a07a4a', '#cfb07a', '#8a8a86', '#d8d5cf', '#5a1e14'];
const QUIRKS: readonly Quirk[] = ['glasses', 'limp', 'cane', 'ear-scratch', 'hands-in-pockets', 'tie-adjust', 'big-laugh', 'smoker', 'watch-check', 'dances-after-drink'];

export interface CastOptions {
  /** Number of guests (excluding host and staff). Default: 20–30 from the seed. */
  guests?: number;
}

function traits(rng: Rng): Traits {
  const t = () => Math.max(0, Math.min(1, rng.normal(0.5, 0.2)));
  return { talk: t(), social: t(), curiosity: t(), nerves: t(), clumsy: t(), thirst: t(), dance: t(), nosy: t(), propriety: Math.max(0, Math.min(1, rng.normal(0.8, 0.12))), loyalty: t() };
}

function freshNeeds(rng: Rng): Needs {
  const n = {} as Needs;
  for (const id of NEED_IDS) n[id] = rng.range(0.55, 0.95);
  return n;
}

export function generateCast(rng: Rng, places: Places, opts: CastOptions = {}): Person[] {
  const nGuests = opts.guests ?? rng.int(20, 30);
  const names = new Set<string>();
  const name = (sex: Sex): string => {
    for (let i = 0; i < 50; i++) {
      const n = `${rng.pick(FIRST[sex])} ${rng.pick(SURNAMES)}`;
      if (!names.has(n)) {
        names.add(n);
        return n;
      }
    }
    return `${rng.pick(FIRST[sex])} ${names.size}`;
  };
  const men = rng.shuffle(MEN);
  const women = rng.shuffle(WOMEN);
  let mi = 0;
  let wi = 0;
  const people: Person[] = [];
  const make = (role: RoleId, sex: Sex, look?: Partial<Look>): Person => {
    const pal = sex === 'm' ? men[mi++ % men.length]! : women[wi++ % women.length]!;
    const lk: Look = {
      sex,
      height: Math.round(rng.normal(sex === 'm' ? 1.78 : 1.65, 0.06) * 100) / 100,
      build: Math.max(0, Math.min(1, rng.normal(0.45, 0.2))),
      outfit: pal[0],
      color: pal[1],
      accent: pal[2],
      skin: rng.pick(SKIN),
      hair: rng.pick(HAIR),
      hat: false,
      ...look,
    };
    const p: Person = {
      id: people.length,
      name: name(sex),
      role,
      staff: STAFF_ROLES.has(role),
      look: lk,
      traits: traits(rng),
      quirks: [],
      partner: null,
      friends: [],
      seat: null,
      arriveAt: 0,
      phaseLag: rng.range(20, 150),
      present: false,
      gone: false,
      level: places.entrance.level,
      x: places.entrance.x,
      z: places.entrance.z,
      y: 0,
      yaw: places.entrance.yaw,
      room: places.entrance.room,
      pose: 'stand',
      held: null,
      heldUntil: 0,
      drinks: 0,
      needs: freshNeeds(rng),
      action: null,
      path: [],
      pathIndex: 0,
      thinkAt: 0,
      avoid: new Map(),
      phaseSeen: 0,
      speed: rng.range(1.15, 1.45),
    };
    people.push(p);
    return p;
  };

  // Staff first: they are in place before anyone arrives.
  const host = make('host', rng.chance(0.7) ? 'm' : 'f');
  host.traits.talk = Math.max(host.traits.talk, 0.7);
  host.traits.social = Math.max(host.traits.social, 0.8);
  const nWaiters = rng.int(2, 3);
  for (let i = 0; i < nWaiters; i++) make('waiter', rng.chance(0.5) ? 'm' : 'f', { outfit: 'waiter', color: '#ece9e1', accent: '#111214' });
  if (places.bars.length) make('bartender', rng.chance(0.6) ? 'm' : 'f', { outfit: 'waiter', color: '#1a1b1f', accent: '#ece9e1' });
  if (places.kitchen.length) make('cook', rng.chance(0.6) ? 'm' : 'f', { outfit: 'chef', color: '#f4f2ec', accent: '#f4f2ec' });

  // Guests: roughly even men and women; special roles once each.
  const guestRoles: RoleId[] = ['politician', 'dancer', 'billiards'];
  if (rng.chance(0.6) && places.games.some((g) => g.kind === 'piano')) guestRoles.push('pianist');
  if (rng.chance(0.6)) guestRoles.push('doctor');
  const first = people.length;
  for (let i = 0; i < nGuests; i++) {
    const sex: Sex = i % 2 === 0 ? (rng.chance(0.5) ? 'm' : 'f') : people[people.length - 1]!.look.sex === 'm' ? 'f' : 'm';
    const p = make(i < guestRoles.length ? guestRoles[i]! : 'guest', sex);
    // Some men in black tails or dinner jackets wear a hat in; most take it off at the door, a few keep it.
    p.look.hat = sex === 'm' && rng.chance(0.08);
  }
  const guests = people.slice(first);
  const politician = guests.find((g) => g.role === 'politician');
  if (politician) {
    politician.traits.talk = Math.max(0.85, politician.traits.talk);
    politician.traits.social = Math.max(0.8, politician.traits.social);
    if (places.globe) politician.quirks.push('globe-pointer');
  }
  const dancer = guests.find((g) => g.role === 'dancer');
  if (dancer) dancer.traits.dance = Math.max(0.85, dancer.traits.dance);

  // Quirks: 1–3 per guest; glasses and a limp are common, a cane rarer.
  for (const g of [host, ...guests]) {
    const n = rng.int(1, 3) - g.quirks.length;
    const pool = rng.shuffle(QUIRKS.filter((q) => q !== 'tie-adjust' || g.look.sex === 'm'));
    for (const q of pool) {
      if (g.quirks.length >= n + (g.quirks.includes('globe-pointer') ? 1 : 0)) break;
      if (q === 'cane' && (g.quirks.includes('limp') || !rng.chance(0.3))) continue;
      if (q === 'limp' && !rng.chance(0.4)) continue;
      g.quirks.push(q);
    }
    if (g.quirks.includes('cane') && !g.quirks.includes('limp')) g.quirks.push('limp');
    if (g.quirks.includes('limp')) g.speed *= 0.75;
    if (g.quirks.includes('smoker')) g.traits.thirst = Math.min(1, g.traits.thirst + 0.1);
  }

  // Couples: mostly a man and a woman, about half the guests; the host may bring a partner.
  const single = rng.shuffle(guests.filter((g) => g.role !== 'politician' || rng.chance(0.5)));
  for (let i = 0; i < single.length; i++) {
    const a = single[i]!;
    if (a.partner !== null || !rng.chance(0.55)) continue;
    const b = single.find((q) => q !== a && q.partner === null && (q.look.sex !== a.look.sex || rng.chance(0.1)));
    if (!b) continue;
    a.partner = b.id;
    b.partner = a.id;
  }
  const spouse = guests.find((g) => g.partner === null && g.look.sex !== host.look.sex);
  if (spouse && rng.chance(0.6)) {
    host.partner = spouse.id;
    spouse.partner = host.id;
  }
  // Friends: each guest knows 1–3 others; ties are mutual.
  for (const g of guests) {
    const want = rng.int(1, 3);
    for (const o of rng.shuffle(guests)) {
      if (g.friends.length >= want) break;
      if (o === g || o.id === g.partner || g.friends.includes(o.id) || o.friends.length >= 4) continue;
      g.friends.push(o.id);
      o.friends.push(g.id);
    }
  }

  // Arrivals over the first 15 minutes; couples together; one latecomer now and then.
  for (const g of guests) {
    if (g.partner !== null && g.partner < g.id && people[g.partner]!.role !== 'host') {
      g.arriveAt = people[g.partner]!.arriveAt + rng.range(0, 8);
      continue;
    }
    g.arriveAt = Math.round(rng.range(20, 14 * 60));
  }
  if (rng.chance(0.25)) rng.pick(guests).arriveAt = Math.round(rng.range(40 * 60, 50 * 60));
  if (host.partner !== null) people[host.partner]!.arriveAt = 0;

  // Dinner seats: the host at the head and a partner at the foot; couples together, the rest shuffled.
  const seats = places.diningSeats.length;
  if (seats) {
    host.seat = 0;
    let next = 1;
    const order: Person[] = [];
    const placed = new Set<number>([host.id]);
    if (host.partner !== null && seats > 1) {
      people[host.partner]!.seat = next++;
      placed.add(host.partner);
    }
    for (const g of rng.shuffle(guests)) {
      if (placed.has(g.id)) continue;
      order.push(g);
      placed.add(g.id);
      if (g.partner !== null && !placed.has(g.partner)) {
        order.push(people[g.partner]!);
        placed.add(g.partner);
      }
    }
    for (const g of order) if (next < seats) g.seat = next++;
  }
  return people;
}
