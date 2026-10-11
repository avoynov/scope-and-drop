/**
 * The cast of one evening, from the seed: 20–30 guests plus the host and staff.
 * Each person has a look (told apart at 4× by outfit colour and silhouette), a role,
 * traits, quirks and relationships (spec: The cast).
 */
import type { Rng } from "../mansion/core/rng";
import type { Places } from "./places";
import { NEED_IDS, SKILLS, STAFF_ROLES, type Archetype, type DrinkId, type Look, type Needs, type Outfit, type Person, type Quirk, type RoleId, type Sex, type Skill, type Traits } from "./types";

const FIRST: Record<Sex, string[]> = {
  f: [
    "Adela",
    "Beatrice",
    "Clara",
    "Daria",
    "Elena",
    "Flora",
    "Greta",
    "Helena",
    "Irina",
    "Julia",
    "Katya",
    "Lena",
    "Maren",
    "Nadia",
    "Olga",
    "Petra",
    "Rosa",
    "Sofia",
    "Tamara",
    "Vera",
    "Yana",
    "Zora",
    "Agnes",
    "Lidia",
    "Mila",
    "Ines",
    "Edith",
    "Vanya",
  ],
  m: [
    "Anton",
    "Boris",
    "Cyril",
    "Dimitar",
    "Emil",
    "Felix",
    "Georg",
    "Hugo",
    "Ivan",
    "Jonas",
    "Kiril",
    "Leon",
    "Marko",
    "Nikolai",
    "Oskar",
    "Pavel",
    "Rafael",
    "Stefan",
    "Teodor",
    "Viktor",
    "Yuri",
    "Zachary",
    "Arno",
    "Lucas",
    "Matthias",
    "Rolf",
    "Silvio",
    "Bogdan",
  ],
};
const SURNAMES = [
  "Albrecht",
  "Bellamy",
  "Castell",
  "Draganov",
  "Eckhart",
  "Falk",
  "Grisham",
  "Hartley",
  "Ivanova",
  "Jansen",
  "Kessler",
  "Lindqvist",
  "Marchetti",
  "Novak",
  "Orlov",
  "Petrov",
  "Quint",
  "Rossi",
  "Sterling",
  "Thorne",
  "Ulrich",
  "Varga",
  "Whitlock",
  "Zanetti",
  "Morrow",
  "Avery",
  "Delacroix",
  "Halloran",
];

/** Distinct outfit colourways, each a garment colour and an accent. Men's are mostly dark with a few standouts. */
const MEN: ReadonlyArray<readonly [Outfit, string, string]> = [
  ["tails", "#15161b", "#f1efe8"],
  ["suit", "#1d2a44", "#e8e6df"],
  ["suit", "#3a3d42", "#efece4"],
  ["dinner-jacket", "#eee6d2", "#17181c"],
  ["dinner-jacket", "#6b1f2c", "#ece8e0"],
  ["suit", "#24432f", "#e9e6dc"],
  ["suit", "#8a6e4b", "#f0ebe0"],
  ["dinner-jacket", "#2c2f6b", "#f1efe8"],
  ["suit", "#5e5f63", "#202226"],
  ["tails", "#2b1d17", "#f3efe5"],
  ["dinner-jacket", "#c9c5bb", "#15161b"],
  ["suit", "#4a2b52", "#ebe7df"],
  ["suit", "#0f3a4a", "#e9e6dc"],
  ["dinner-jacket", "#7a5a1e", "#efe9dc"],
  ["tails", "#2a2440", "#ece9e2"],
  ["suit", "#5a1c1c", "#e9e4da"],
];
const WOMEN: ReadonlyArray<readonly [Outfit, string, string]> = [
  ["long-dress", "#b3122b", "#e6c27a"],
  ["long-dress", "#0f6b4f", "#e0d6c0"],
  ["long-dress", "#d9b54a", "#3a2a12"],
  ["short-dress", "#c3c7cc", "#2a2c30"],
  ["long-dress", "#1f3f9a", "#d8d2c4"],
  ["short-dress", "#141416", "#d9c08a"],
  ["long-dress", "#f2ece0", "#7d6a4a"],
  ["long-dress", "#5e1f63", "#e1cfa0"],
  ["short-dress", "#16808a", "#ede6d6"],
  ["long-dress", "#d76d84", "#f3e9e0"],
  ["short-dress", "#e07a24", "#2a1b10"],
  ["long-dress", "#6f7d3a", "#efe7d0"],
  ["long-dress", "#8e1c1c", "#141416"],
  ["short-dress", "#7aa6d9", "#20222a"],
  ["short-dress", "#3b5a3a", "#e8e0cc"],
  ["long-dress", "#c0a0d8", "#2a2233"],
];
const SKIN = ["#f1d3bd", "#e7bf9f", "#d8a47f", "#b9805a", "#8f5a3b", "#5f3a26"];
const HAIR = ["#1b1512", "#3b2a1e", "#6a4a2f", "#a07a4a", "#cfb07a", "#8a8a86", "#d8d5cf", "#5a1e14"];
const QUIRKS: readonly Quirk[] = ["glasses", "limp", "cane", "ear-scratch", "hands-in-pockets", "tie-adjust", "big-laugh", "smoker", "watch-check", "dances-after-drink"];

/** How often each drink is someone's favourite (the evening's mix). */
const FAV: ReadonlyArray<readonly [DrinkId, number]> = [
  ["champagne", 3],
  ["red", 3],
  ["white", 2.5],
  ["beer", 1.5],
  ["whisky", 1.5],
  ["water", 0.6],
];
/** The drink someone never touches: most often red wine or beer (milestone 2 plan), so a refusal proves little. */
const NEVER: ReadonlyArray<readonly [DrinkId, number]> = [
  ["red", 3],
  ["beer", 3],
  ["whisky", 2],
  ["white", 1],
  ["champagne", 0.5],
];

export interface CastOptions {
  /** Number of guests (excluding host and staff). Default: 20–30 from the seed. */
  guests?: number;
}

/** Staff outfits: the butler in tails, the band in black dinner jackets, the cloakroom in a dark waistcoat. */
const STAFF_LOOK: Partial<Record<RoleId, Pick<Look, "outfit" | "color" | "accent">>> = {
  butler: { outfit: "tails", color: "#101115", accent: "#f1efe8" },
  waiter: { outfit: "waiter", color: "#ece9e1", accent: "#111214" },
  bartender: { outfit: "waiter", color: "#1a1b1f", accent: "#ece9e1" },
  cook: { outfit: "chef", color: "#f4f2ec", accent: "#f4f2ec" },
  kitchenHand: { outfit: "chef", color: "#dcdad2", accent: "#3a3a3a" },
  cloakroom: { outfit: "waiter", color: "#3b3542", accent: "#ece9e1" },
  musician: { outfit: "dinner-jacket", color: "#131418", accent: "#f1efe8" },
  photographer: { outfit: "suit", color: "#2e3036", accent: "#9aa0a8" },
};

/** Who does what fluently: the owner of a task about 0.95 (milestone 2 plan: Tasks). */
const FLUENT: Partial<Record<RoleId | Archetype, Partial<Record<Skill, number>>>> = {
  host: { tour: 0.95, keys: 0.95, errand: 0.6 },
  butler: { keys: 0.9, errand: 0.95, tour: 0.7, pour: 0.8, tray: 0.9 },
  waiter: { tray: 0.95, errand: 0.8, pour: 0.6 },
  bartender: { pour: 0.95, tray: 0.7, errand: 0.6 },
  cook: { errand: 0.6 },
  kitchenHand: { errand: 0.85, tray: 0.6 },
  cloakroom: { errand: 0.9 },
  musician: { piano: 0.9 },
  photographer: { photo: 0.95 },
  pianist: { piano: 0.95 },
  dancer: { dance: 0.95 },
  billiards: { billiards: 0.95 },
  child: { tour: 0.7, keys: 0.8, errand: 0.8 },
  "old-friend": { tour: 0.5 },
  young: { dance: 0.7 },
  life: { dance: 0.75 },
  employee: { errand: 0.7 },
};

/**
 * The deck of archetypes (A Real Party: Who comes): trait floors and ceilings applied on top of the
 * random draw, so an archetype reads at a glance and still differs from evening to evening.
 */
const PRESETS: Record<Archetype, { min?: Partial<Traits>; max?: Partial<Traits>; quirks?: Quirk[] }> = {
  honoree: { min: { social: 0.7, talk: 0.6 } },
  "old-friend": { min: { social: 0.6, propriety: 0.85 }, max: { nerves: 0.4 } },
  mother: { min: { nosy: 0.8, propriety: 0.9 }, max: { dance: 0.15, thirst: 0.4 }, quirks: ["cane"] },
  child: { min: { social: 0.6, curiosity: 0.5 } },
  boss: { min: { talk: 0.75, social: 0.75 } },
  employee: { min: { propriety: 0.85 }, max: { talk: 0.35 } },
  "plus-one": { min: { curiosity: 0.6, nerves: 0.55 }, max: { social: 0.35, talk: 0.35 } },
  young: { min: { dance: 0.75, social: 0.6 }, max: { propriety: 0.75 } },
  elderly: { min: { propriety: 0.9 }, max: { dance: 0.25, thirst: 0.45 } },
  life: { min: { talk: 0.85, social: 0.9, dance: 0.85, thirst: 0.75 }, max: { propriety: 0.65 }, quirks: ["big-laugh"] },
  gossip: { min: { talk: 0.9, nosy: 0.85, social: 0.75 } },
  bore: { min: { talk: 0.9 }, max: { social: 0.45, curiosity: 0.3 } },
  flirt: { min: { social: 0.8, dance: 0.7 }, max: { propriety: 0.7 } },
  ex: {},
};

const LIMIT_TRAITS = (t: Traits, min: Partial<Traits> = {}, max: Partial<Traits> = {}) => {
  for (const k of Object.keys(min) as Array<keyof Traits>) t[k] = Math.max(t[k], min[k]!);
  for (const k of Object.keys(max) as Array<keyof Traits>) t[k] = Math.min(t[k], max[k]!);
};

function traits(rng: Rng): Traits {
  const t = () => Math.max(0, Math.min(1, rng.normal(0.5, 0.2)));
  return { talk: t(), social: t(), curiosity: t(), nerves: t(), clumsy: t(), thirst: t(), dance: t(), nosy: t(), propriety: Math.max(0, Math.min(1, rng.normal(0.8, 0.12))), loyalty: t() };
}

function freshNeeds(rng: Rng): Needs {
  const n = {} as Needs;
  for (const id of NEED_IDS) n[id] = rng.range(0.55, 0.95);
  // Nobody arrives at a party tired, or wanting fresh air: they've just come in from outside.
  n.rest = 0.85 + 0.15 * n.rest;
  n.air = 0.85 + 0.15 * n.air;
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
    const pal = look?.outfit ? ([look.outfit, look.color ?? "#000000", look.accent ?? "#ffffff"] as const) : sex === "m" ? men[mi++ % men.length]! : women[wi++ % women.length]!;
    const lk: Look = {
      sex,
      height: Math.round(rng.normal(sex === "m" ? 1.78 : 1.65, 0.06) * 100) / 100,
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
      archetype: null,
      ex: -1,
      linked: -1,
      fluency: Object.fromEntries(SKILLS.map((k) => [k, 0.35])) as Record<Skill, number>,
      leaveAt: 0,
      early: null,
      regular: false,
      seat: null,
      supper: null,
      fav: "champagne",
      never: null,
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
      pose: "stand",
      held: null,
      heldUntil: 0,
      drinks: 0,
      drinkLog: [],
      tipsy: 0,
      item: -1,
      coat: -1,
      ring: role === "host" ? "host" : STAFF_ROLES.has(role) ? "staff" : "none",
      lentKey: -1,
      needs: freshNeeds(rng),
      action: null,
      path: [],
      pathIndex: 0,
      thinkAt: 0,
      avoid: new Map(),
      phaseSeen: 0,
      speed: rng.range(1.15, 1.45),
      gesture: null,
      gestureUntil: 0,
      lookX: 0,
      lookZ: 0,
      lookUntil: 0,
      notable: null,
      notableObj: -1,
      notableRoom: -1,
      notableUntil: 0,
      detour: null,
    };
    people.push(p);
    return p;
  };

  // Staff first: they are in place before anyone arrives.
  const host = make("host", rng.chance(0.7) ? "m" : "f");
  host.traits.talk = Math.max(host.traits.talk, 0.7);
  host.traits.social = Math.max(host.traits.social, 0.8);
  // About a dozen staff for 20 to 30 guests (A Real Party: The staff's choreography).
  const staff = (role: RoleId, pm: number) => make(role, rng.chance(pm) ? "m" : "f", STAFF_LOOK[role]);
  staff("butler", 0.85);
  const nWaiters = rng.int(4, 6);
  for (let i = 0; i < nWaiters; i++) staff("waiter", 0.5);
  if (places.bars.length) staff("bartender", 0.6);
  if (places.kitchen.length) {
    staff("cook", 0.6);
    staff("kitchenHand", 0.5);
  }
  staff("cloakroom", 0.35);
  for (let i = 0; i < 3; i++) staff("musician", 0.6);
  staff("photographer", 0.6);

  // Guests: roughly even men and women; special roles once each.
  const guestRoles: RoleId[] = ["politician", "dancer", "billiards"];
  if (rng.chance(0.6) && places.games.some((g) => g.kind === "piano")) guestRoles.push("pianist");
  if (rng.chance(0.6)) guestRoles.push("doctor");
  const first = people.length;
  for (let i = 0; i < nGuests; i++) {
    const sex: Sex = i % 2 === 0 ? (rng.chance(0.5) ? "m" : "f") : people[people.length - 1]!.look.sex === "m" ? "f" : "m";
    const p = make(i < guestRoles.length ? guestRoles[i]! : "guest", sex);
    // Some men in black tails or dinner jackets wear a hat in; most take it off at the door, a few keep it.
    p.look.hat = sex === "m" && rng.chance(0.08);
  }
  const guests = people.slice(first);
  const politician = guests.find((g) => g.role === "politician");
  if (politician) {
    politician.traits.talk = Math.max(0.85, politician.traits.talk);
    politician.traits.social = Math.max(0.8, politician.traits.social);
    if (places.globe) politician.quirks.push("globe-pointer");
  }
  const dancer = guests.find((g) => g.role === "dancer");
  if (dancer) dancer.traits.dance = Math.max(0.85, dancer.traits.dance);

  // Quirks: 1–3 per guest; glasses and a limp are common, a cane rarer.
  for (const g of [host, ...guests]) {
    const n = rng.int(1, 3) - g.quirks.length;
    const pool = rng.shuffle(QUIRKS.filter((q) => q !== "tie-adjust" || g.look.sex === "m"));
    for (const q of pool) {
      if (g.quirks.length >= n + (g.quirks.includes("globe-pointer") ? 1 : 0)) break;
      if (q === "cane" && (g.quirks.includes("limp") || !rng.chance(0.3))) continue;
      if (q === "limp" && !rng.chance(0.4)) continue;
      g.quirks.push(q);
    }
    if (g.quirks.includes("cane") && !g.quirks.includes("limp")) g.quirks.push("limp");
    if (g.quirks.includes("limp")) g.speed *= 0.75;
    if (g.quirks.includes("smoker")) g.traits.thirst = Math.min(1, g.traits.thirst + 0.1);
  }

  // Couples: mostly a man and a woman, about half the guests; the host may bring a partner.
  const single = rng.shuffle(guests.filter((g) => g.role !== "politician" || rng.chance(0.5)));
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
    if (g.partner !== null && g.partner < g.id && people[g.partner]!.role !== "host") {
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
    // Those the table can't take sit down to supper in the ballroom, couples side by side, then the buffet.
    let sup = 0;
    for (const g of order) {
      if (next < seats) g.seat = next++;
      else if (sup < places.supperSeats.length) g.supper = sup++;
    }
  } else {
    let sup = 0;
    for (const g of [host, ...guests]) if (sup < places.supperSeats.length) g.supper = sup++;
  }

  // Drinks last, so the draws above stay as they were: a favourite for everyone, and one they never touch for about 1 in 5.
  for (const g of [host, ...guests]) {
    g.fav = rng.weighted(FAV);
    if (rng.chance(0.2)) g.never = rng.weighted(NEVER.filter(([d]) => d !== g.fav));
  }
  // Regulars, drawn after everything else: about a third of the guests have been here before, and the host's partner lives here.
  for (const g of guests) g.regular = rng.chance(1 / 3);
  if (host.partner !== null) people[host.partner]!.regular = true;

  // Archetypes, fluency and when each guest goes: drawn last, so everything above stays as it was.
  castArchetypes(rng, host, guests, people);
  for (const p of people) {
    for (const k of SKILLS) p.fluency[k] = rng.range(0.2, 0.5);
    for (const src of [FLUENT[p.role], p.archetype ? FLUENT[p.archetype] : undefined]) if (src) for (const k of Object.keys(src) as Skill[]) p.fluency[k] = Math.max(p.fluency[k], src[k]!);
  }
  // Departures cascade: each guest leaves once enough others have gone (skewed low, so a few goodbyes tip the rest).
  for (const g of guests) {
    const u = rng.next();
    g.leaveAt = 0.55 * u * u;
  }
  for (const g of guests) if (g.partner !== null && people[g.partner]!.role !== "host") g.leaveAt = Math.min(g.leaveAt, people[g.partner]!.leaveAt);
  // One or two go after dessert: the elderly couple tire, now and then a babysitter or feeling unwell.
  const early = guests.filter((g) => g.archetype === "elderly");
  for (const g of early) g.early = "tired";
  const alone = guests.filter((q) => q.partner === null && q.archetype === null);
  if (!early.length && alone.length && rng.chance(0.6)) rng.pick(alone).early = rng.chance(0.5) ? "babysitter" : "unwell";
  return people;
}

/** 6 to 12 guests from the deck of archetypes; the rest stay ordinary. Pairs (couples, the exes, boss and employee) are cast together. */
function castArchetypes(rng: Rng, host: Person, guests: Person[], people: Person[]): void {
  const free = () => guests.filter((g) => g.archetype === null && g.partner !== host.id);
  const set = (g: Person, a: Archetype) => {
    g.archetype = a;
    const pr = PRESETS[a];
    LIMIT_TRAITS(g.traits, pr.min, pr.max);
    for (const q of pr.quirks ?? []) if (!g.quirks.includes(q)) g.quirks.push(q);
    if (g.quirks.includes("cane") && !g.quirks.includes("limp")) {
      g.quirks.push("limp");
      g.speed *= 0.75;
    }
  };
  const one = (a: Archetype, pick: (g: Person) => boolean = () => true): Person | null => {
    const pool = free().filter(pick);
    if (!pool.length) return null;
    const g = rng.pick(pool);
    set(g, a);
    return g;
  };
  const couple = (a: Archetype) => {
    const pool = free().filter((q) => q.partner !== null && people[q.partner]!.archetype === null && people[q.partner]!.role !== "host");
    if (!pool.length) return;
    const g = rng.pick(pool);
    set(g, a);
    set(people[g.partner!]!, a);
  };
  const tie = (a: Person, b: Person) => {
    if (!a.friends.includes(b.id)) a.friends.push(b.id);
    if (!b.friends.includes(a.id)) b.friends.push(a.id);
  };
  // The guest of honour and an old friend of the house come every time.
  const honoree = one("honoree", (g) => g.role === "guest");
  if (honoree) tie(honoree, host);
  const old = one("old-friend", (g) => g.role === "guest");
  if (old) {
    old.regular = true;
    tie(old, host);
  }
  if (rng.chance(0.5)) {
    const m = one("mother", (g) => g.look.sex === "f" && g.partner === null && g.role === "guest");
    if (m) {
      m.regular = true;
      m.look.color = "#b9a3cf";
      tie(m, host);
    }
  }
  if (rng.chance(0.5)) {
    const c = one("child", (g) => g.partner === null && g.role === "guest");
    if (c) {
      c.regular = true;
      tie(c, host);
    }
  }
  if (rng.chance(0.5)) {
    const b = one("boss", (g) => g.partner === null);
    const e = b ? one("employee", (g) => g.partner === null) : null;
    if (b && e) {
      b.linked = e.id;
      e.linked = b.id;
      tie(b, e);
    }
  }
  if (rng.chance(0.7)) {
    const p = one("plus-one", (g) => g.partner !== null);
    if (p) {
      // Knows nobody but their partner.
      for (const f of p.friends) people[f]!.friends = people[f]!.friends.filter((x) => x !== p.id);
      p.friends = [];
      p.regular = false;
    }
  }
  if (rng.chance(0.6)) couple("young");
  if (rng.chance(0.5)) couple("elderly");
  one("life");
  one("gossip");
  one("bore");
  if (rng.chance(0.6)) one("flirt", (g) => g.partner === null);
  if (rng.chance(0.4)) {
    const a = one("ex", (g) => g.partner === null);
    const b = a ? one("ex", (g) => g.partner === null && g.look.sex !== a.look.sex && !a.friends.includes(g.id)) : null;
    if (a && b) {
      a.ex = b.id;
      b.ex = a.id;
    } else if (a) a.archetype = null;
  }
}
