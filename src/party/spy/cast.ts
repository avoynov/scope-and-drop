/**
 * Casting the spy (milestone 3 technical plan: Casting and the record swap). Before anyone
 * knows anyone it decides how the spy comes (as itself, or as someone killed before the
 * party), whom it plays, its goal and target (and a kill's theft first), its own body and
 * mind, which of its victim's people it watched first, and where the pre-party body and the
 * garment lie. It reads the cast and changes no record: the party applies the swap (swap.ts)
 * once the systems that remember people exist.
 *
 * Every draw comes from its own child of the spy's fork, one per part, so pinning or changing
 * one part (the lab's goal odds) leaves the others as they were.
 */
import type { MansionBlueprint, Prop, RoomType } from "../../mansion/core/types";
import type { Rng } from "../../mansion/core/rng";
import type { DramaCast } from "../dramas";
import { TIE_WEIGHT, type Tie } from "../ident";
import type { Places } from "../places";
import { SKILLS, type Archetype, type DrinkId, type Look, type Person, type Quirk, type Sex, type Skill, type Traits } from "../types";
import type { HidePlace } from "./kill";
import type { Cover } from "./scheduler";

/** How it comes: as itself, or as someone killed before the party (a guest, the host, a waiter). */
export type SpySetup = "self" | "victim" | "host" | "waiter";
export const SETUPS: readonly SpySetup[] = ["self", "victim", "host", "waiter"];

export type GoalKind = "kill" | "statuette" | "safe" | "bag" | "bug" | "ledger";
export const GOALS: readonly GoalKind[] = ["kill", "statuette", "safe", "bag", "bug", "ledger"];
/** The plan's shares (Its goal, one an evening). */
export const GOAL_SHARES: Readonly<Record<GoalKind, number>> = { kill: 35, statuette: 15, safe: 15, bag: 10, bug: 15, ledger: 10 };

/** Where a kill's theft first takes the thing from: papers from a bag, a phone from a coat on its hook or from a pocket. */
export type TheftFrom = "bag" | "coat" | "pocket";

/** What the game, the tests and the lab can pin; anything left out is drawn. */
export interface SpyOptions {
  setup?: SpySetup;
  goal?: GoalKind;
  /** Weights for the goals, as `{ kill: 50, bug: 0 }`: a goal left out keeps its share, 0 switches one off. */
  odds?: Partial<Record<GoalKind, number>>;
  /** How often a kill steals first, 0 to 1 (0.5). */
  steal?: number;
  /** A person id: whom to kill, whose bag, or (with a victim setup) whom to play. */
  target?: number;
  /** Covers held on all evening, past the caps (scheduler.ts). */
  on?: readonly Cover[];
  /** Taking someone's place mid-party (swap.ts): true it means to tonight (playing a guest too), false never. */
  swap?: boolean;
}

/** As itself in 55% of evenings; otherwise as someone killed before the party. */
const SELF = 0.55;
/** Of those, the host in 55% of the evenings the host has no partner (about one evening in ten), then a waiter one time in ten, else a guest. */
const AS_HOST = 0.55;
const AS_WAITER = 0.1;
/** A kill steals first this often, unless the options say. */
export const STEAL = 0.5;
/** Meaning to take someone's place mid-party: this share of the evenings it comes as itself (the plan: about a fifth of them swap). */
export const SWAP = 0.3;
/** The odds of a bag at the door (sim.ts), which a kill's theft from a bag follows. */
const BAG: Record<Sex, number> = { f: 0.6, m: 0.08 };
/** What it saw of each of its victim's people before the party, by tie: an acquaintance, a friend, a close friend, the partner; and each of the staff when it plays the host. */
const STUDY: Partial<Record<Tie, number>> = { 2: 0.1, 3: 0.35, 4: 0.5, 5: 0.9 };
const STUDY_STAFF = 0.8;
/** Its own body, playing someone: the victim's sex nine times in ten, height within 15 cm (sd 5), build sd 0.15. */
const SAME_SEX = 0.9;
const HEIGHT_SD = 0.05;
const HEIGHT_MAX = 0.15;
const BUILD_SD = 0.15;
/** Its four knacks, which nobody else has. */
const KNACK: readonly [number, number] = [0.6, 0.9];
/** Something the victim wore, left in the garden: this share of pre-party evenings (decided 2026-10-18). */
export const GARMENT_SHARE = 1 / 3;
/** What it is, by the victim's sex, and the colours such things come in: none an outfit's, so a find can't be matched to a guest by colour. */
const GARMENT: Record<Sex, readonly string[]> = { f: ["scarf", "glove"], m: ["pocket square", "glove"] };
const GARMENT_COLORS: readonly string[] = ["#9fe0cf", "#c8e05a", "#ff8f8f", "#f3ec8a", "#3fd0d4", "#ffc49b"];
/** How far out from the garden door the garment lies (m). */
const GARMENT_OUT = 1.5;
/** How well the pre-party body is hidden (milestone 4's chance a look there misses it). */
const BODY_HIDES = 0.9;

const QUIRKS: readonly Quirk[] = ["glasses", "limp", "ear-scratch", "hands-in-pockets", "tie-adjust", "big-laugh", "smoker", "watch-check", "dances-after-drink"];
const FAV: ReadonlyArray<readonly [DrinkId, number]> = [
  ["champagne", 3],
  ["red", 3],
  ["white", 2.5],
  ["beer", 1.5],
  ["whisky", 1.5],
  ["water", 0.6],
];
const NEVER: ReadonlyArray<readonly [DrinkId, number]> = [
  ["red", 3],
  ["beer", 3],
  ["whisky", 2],
  ["white", 1],
  ["champagne", 0.5],
];

/** The skills nobody else has: picking a lock, opening the safe, a quiet kill, palming small things. */
export interface Knacks {
  lock: number;
  safe: number;
  kill: number;
  palm: number;
}

/** The spy's own body and mind, carried into every record it wears. */
export interface SpyOwn {
  sex: Sex;
  height: number;
  build: number;
  /** Walking speed (m per real second), a limp already in it. */
  speed: number;
  voice: number;
  quirks: Quirk[];
  traits: Traits;
  fluency: Record<Skill, number>;
  knack: Knacks;
  temper: number;
  fav: DrinkId;
  never: DrinkId | null;
  /** When it goes home with its goal undone: the share of the farewell's leavers on their way out by then, drawn evenly over the first half, so it isn't always among the very first goodbyes (decided 2026-10-18). */
  leaveAt: number;
}

export interface SpyGoal {
  kind: GoalKind;
  /** Whom to kill, or whose bag (-1 for the other goals). */
  target: number;
  /** A kill's theft first: papers from the target's bag, or their phone from their coat or pocket; null without one. */
  first: { from: TheftFrom; thing: "papers" | "phone" } | null;
}

/** A body in the bodies list (milestone 3 plan: the pre-party body; PR 5 adds the rest). The renderer draws bodies from it, never from a person. */
export interface SpyBody {
  who: number;
  /** Where it lies: outside on the lawn before the party; since, where the kill left or hid it. */
  at: { level: number; x: number; z: number; room: number };
  /** The way it lies (radians, as a person's yaw: its head lies the other way). */
  yaw: number;
  /** The hiding place, for the lab's card, and what kind of place: in a bath behind its curtain, a wardrobe or under a bed it is out of sight. */
  place: string;
  kind: HidePlace;
  /** 0 to 1: milestone 4's chance a look there misses it. */
  hides: number;
  /** In-game seconds after 19:00 (negative: before the party). */
  t: number;
  how: "before" | "injection" | "strangled" | "poison";
  /** How it looks where it lies: its own height, build, face and hair, in the clothes it died in (after a swap, the spy's old ones, `wears`). */
  look: Look;
  /** Whose clothes it has on, when not its own: after a swap, the spy's old self's. */
  wears?: number;
  /** Its jacket or dress on the spy (killed before the party, or a swap with the spy's own clothes put away): in shirtsleeves or a slip. */
  stripped?: boolean;
}

export interface SpyCast {
  setup: SpySetup;
  /** The record it lives in: its own (as itself) or its victim's. */
  record: number;
  /** Whom it killed before the party (-1 as itself). */
  victim: number;
  goal: SpyGoal;
  own: SpyOwn;
  /** One uniform draw per person, in id order: which of the victim's people it watched first (see `studied()`). */
  study: Float32Array;
  body: SpyBody | null;
  /** Something the victim wore and the spy left behind, half-hidden in the garden: what it is and its colour; null when none was left. */
  garment: { at: { level: number; x: number; z: number; room: number }; what: string; color: string } | null;
  /** The target the spy means to rob of a bag is given one at the door when the usual draw gives them none. */
  bagFor: number;
  /** Taking someone's place mid-party (swap.ts): whether it means to tonight, and whom it could play, by casting's own rule. */
  swap: { may: boolean; playable: readonly number[] };
}

const PARTY_TYPES: ReadonlySet<RoomType> = new Set(["entrance-hall", "stair-hall", "hall-gallery"]);

/** Where a statuette can stand: a mantel or a console in a party room or a hall. */
export function statuetteStands(bp: MansionBlueprint, places: Places): Prop[] {
  const party = new Set(places.partyRooms.map((r) => r.id));
  return bp.props.filter(
    (p) => (p.kind === "fireplace" || p.kind === "console") && p.roomId !== null && (party.has(p.roomId) || PARTY_TYPES.has(bp.rooms.find((r) => r.id === p.roomId)?.type ?? "corridor")),
  );
}

/** Whether this house can hold a goal: a safe in a study, somewhere for a statuette, a ledger on the hall console. A kill, a bag and a bug fit any house. */
export function houseHolds(goal: GoalKind, bp: MansionBlueprint, places: Places): boolean {
  if (goal === "safe") return bp.pois.some((p) => p.type === "safe" && bp.rooms.find((r) => r.id === p.roomId)?.type === "study");
  if (goal === "ledger") return bp.pois.some((p) => p.type === "ledger");
  if (goal === "statuette") return statuetteStands(bp, places).length > 0;
  return true;
}

/**
 * The rooms a goal needs, which the spy learnt the way to before it came: the stands a statuette
 * could be on, the study with the safe, the ledger's hall, the rooms a bag is left in, the rooms a
 * bug goes in; for a kill whose theft comes from a coat, the cloakroom. A kill alone needs none.
 */
export function goalRooms(goal: SpyGoal, bp: MansionBlueprint, places: Places): number[] {
  const index = (id: string | null) => bp.rooms.find((r) => r.id === id)?.index ?? -1;
  const coats = places.chains.coats.room;
  const out = new Set<number>();
  const kind = goal.kind;
  if (kind === "statuette") for (const s of statuetteStands(bp, places)) out.add(index(s.roomId));
  else if (kind === "safe" || kind === "ledger") {
    for (const p of bp.pois) if (p.type === kind && (kind === "ledger" || bp.rooms.find((r) => r.id === p.roomId)?.type === "study")) out.add(index(p.roomId));
  } else if (kind === "bag") {
    if (coats !== null) out.add(coats);
    for (const r of places.guestBedrooms) out.add(r.index);
  } else if (kind === "bug") {
    for (const r of bp.rooms) if (r.type === "study" || r.type === "drawing-room") out.add(r.index);
    if (places.dining) out.add(places.dining.index);
  } else if (goal.first?.from === "coat" && coats !== null) out.add(coats);
  out.delete(-1);
  return [...out].sort((a, b) => a - b);
}

/**
 * Each goal's chance for this house: the given weights (a goal left out keeps the plan's share,
 * 0 switches it off), a goal the house can't hold at 0, the rest scaled to 1. With every goal
 * switched off it falls back on the plan's shares, so an evening always has a goal.
 */
export function goalOdds(bp: MansionBlueprint, places: Places, odds: Partial<Record<GoalKind, number>> = {}): Record<GoalKind, number> {
  const w = {} as Record<GoalKind, number>;
  const pick = (use: (g: GoalKind) => number): number => {
    let total = 0;
    for (const g of GOALS) total += w[g] = houseHolds(g, bp, places) ? Math.max(0, use(g)) : 0;
    return total;
  };
  let total = pick((g) => (Number.isFinite(odds[g]) ? odds[g]! : GOAL_SHARES[g]));
  if (total <= 0) total = pick((g) => GOAL_SHARES[g]);
  for (const g of GOALS) w[g] = w[g] / total;
  return w;
}

/** Personalities from the deck a guest can shed (swap.ts asItself), when the spy comes as itself and no ordinary guest is alone tonight. */
const SHED: ReadonlySet<Archetype> = new Set(["young", "life", "gossip", "bore", "flirt"]);

/**
 * Who the spy can take over coming as itself: a guest alone, ordinary, with no special part
 * tonight; failing that (8% of the evenings it comes as itself), one alone whose archetype is
 * only a manner, which the spy doesn't keep.
 */
export function selfCandidates(people: readonly Person[], drama: DramaCast): Person[] {
  const odd = new Set(drama.oddballs.map((o) => o.who));
  const alone = people.filter((p) => !p.staff && p.role === "guest" && p.partner === null && !odd.has(p.id) && p.id !== drama.stranger);
  const ordinary = alone.filter((p) => p.archetype === null);
  return ordinary.length ? ordinary : alone.filter((p) => p.archetype !== null && SHED.has(p.archetype));
}

/** Whom it can play: a guest who is not the host's partner, an oddball or the stranger, and has no archetype (special roles allowed). */
function victimCandidates(people: readonly Person[], drama: DramaCast): Person[] {
  const host = people.find((p) => p.role === "host");
  const odd = new Set(drama.oddballs.map((o) => o.who));
  return people.filter((p) => !p.staff && p !== host && p.id !== host?.partner && p.archetype === null && !odd.has(p.id) && p.id !== drama.stranger);
}

/** Its own body and mind, drawn like any guest's with a steadier head; playing someone, close to the victim's height and build. */
function drawOwn(rng: Rng, like: Person): SpyOwn {
  const sex: Sex = rng.chance(SAME_SEX) ? like.look.sex : like.look.sex === "m" ? "f" : "m";
  const height = Math.round((like.look.height + Math.max(-HEIGHT_MAX, Math.min(HEIGHT_MAX, rng.normal(0, HEIGHT_SD)))) * 100) / 100;
  const build = Math.max(0, Math.min(1, like.look.build + rng.normal(0, BUILD_SD)));
  let speed = rng.range(1.15, 1.45);
  const voice = (sex === "f" ? 0.65 : 0.35) + rng.range(-0.1, 0.1);
  // One to three quirks, never a cane; a limp now and then, slowing the walk.
  const quirks: Quirk[] = [];
  const n = rng.int(1, 3);
  for (const q of rng.shuffle(QUIRKS.filter((q) => q !== "tie-adjust" || like.look.sex === "m"))) {
    if (quirks.length >= n) break;
    if (q === "limp" && !rng.chance(0.4)) continue;
    quirks.push(q);
  }
  if (quirks.includes("limp")) speed *= 0.75;
  const t = () => Math.max(0, Math.min(1, rng.normal(0.5, 0.2)));
  const traits: Traits = {
    talk: t(),
    social: t(),
    curiosity: t(),
    nerves: t(),
    clumsy: t(),
    thirst: t(),
    dance: t(),
    nosy: t(),
    propriety: Math.max(0, Math.min(1, rng.normal(0.8, 0.12))),
    loyalty: t(),
  };
  steady(traits);
  const fluency = Object.fromEntries(SKILLS.map((k) => [k, rng.range(0.2, 0.5)])) as Record<Skill, number>;
  const knack: Knacks = { lock: rng.range(KNACK[0], KNACK[1]), safe: rng.range(KNACK[0], KNACK[1]), kill: rng.range(KNACK[0], KNACK[1]), palm: rng.range(KNACK[0], KNACK[1]) };
  const temper = Math.max(0, Math.min(1, rng.normal(0.4, 0.2)));
  const fav = rng.weighted(FAV);
  const never = rng.chance(0.2) ? rng.weighted(NEVER.filter(([d]) => d !== fav)) : null;
  const u = rng.next();
  return { sex, height, build, speed, voice, quirks, traits, fluency, knack, temper, fav, never, leaveAt: 0.5 * u };
}

/** The steadier head: low nerves, middling sociability, a light drinker. */
export function steady(t: Traits): void {
  t.nerves = Math.min(t.nerves, 0.3);
  t.social = Math.max(0.4, Math.min(0.6, t.social));
  t.thirst = Math.min(t.thirst, 0.35);
}

/** Where the pre-party body lies: behind the topiary or parterre hedge farthest from the terrace lamps, on the side away from the house. */
function bodySpot(bp: MansionBlueprint, rng: Rng): { at: SpyBody["at"]; place: string } {
  const site = bp.site;
  const lamps = bp.lights.filter((l) => l.scope === "exterior" && (l.kind === "lamppost" || l.kind === "lantern"));
  const dark = (x: number, z: number) => (lamps.length ? Math.min(...lamps.map((l) => Math.hypot(l.x - x, l.z - z))) : Math.hypot(x, z));
  const spots: Array<{ x: number; z: number; place: string }> = [];
  for (const t of site.topiary) spots.push({ x: t.x, z: t.z + t.radius + 0.6, place: "behind the far topiary" });
  for (const p of site.parterres) {
    const r = p.rect;
    spots.push(
      { x: r.x0 - 0.6, z: r.z1, place: "behind the parterre hedge" },
      { x: r.x1 + 0.6, z: r.z1, place: "behind the parterre hedge" },
      { x: (r.x0 + r.x1) / 2, z: r.z1 + 0.6, place: "behind the parterre hedge" },
    );
  }
  if (!spots.length) {
    // A bare lawn: under the trees, as far from the lamps as there is.
    for (const t of site.trees) spots.push({ x: t.x, z: t.z + 1, place: "under the trees" });
  }
  if (!spots.length) {
    const r = site.lawn;
    spots.push({ x: rng.chance(0.5) ? r.x0 + 2 : r.x1 - 2, z: r.z1 - 2, place: "at the far edge of the lawn" });
  }
  let best = spots[0]!;
  for (const s of spots) if (dark(s.x, s.z) > dark(best.x, best.z)) best = s;
  return { at: { level: 0, x: best.x, z: best.z, room: -1 }, place: best.place };
}

/**
 * Where the garment lies: dropped as the spy came back in from the garden, just outside one of the
 * garden doors onto the terrace (half under a planter by the wall), where guests going out pass:
 * the terrace spot nearest the door, a little to one side. With no garden door, by the house in the
 * middle of the terrace.
 */
function garmentSpot(bp: MansionBlueprint, places: Places, rng: Rng): { level: number; x: number; z: number; room: number } {
  const doors: Array<{ x: number; z: number }> = [];
  for (const w of bp.walls) {
    if (w.level !== 0 || !w.exterior || w.side !== "garden") continue;
    for (const o of w.openings) {
      if (!o.passable) continue;
      const u = (o.u0 + o.u1) / 2;
      const out = w.neg === null ? -1 : 1;
      doors.push(w.axis === "x" ? { x: w.a.x + u, z: w.a.z + out * GARMENT_OUT } : { x: w.a.x + out * GARMENT_OUT, z: w.a.z + u });
    }
  }
  const tr = bp.site.terrace.rect;
  const at = doors.length ? rng.pick(doors) : { x: (tr.x0 + tr.x1) / 2, z: tr.z0 + GARMENT_OUT };
  const d = (q: { x: number; z: number }) => Math.hypot(q.x - at.x, q.z - at.z);
  const s = [...places.terrace].sort((a, b) => d(a) - d(b))[0] ?? at;
  return { level: 0, x: s.x + rng.range(-0.5, 0.5), z: s.z + rng.range(-0.5, 0.5), room: -2 };
}

/**
 * The spy, from the cast before anyone knows anyone. `opts` pins any draw; a value that doesn't
 * fit (a setup the cast can't give, a goal the house can't hold, a target the goal can't have)
 * is dropped, so that draw is made as usual.
 */
export function castSpy(rng: Rng, people: readonly Person[], drama: DramaCast, bp: MansionBlueprint, places: Places, opts: SpyOptions = {}): SpyCast {
  const host = people.find((p) => p.role === "host")!;
  const r = { setup: rng.fork("setup"), goal: rng.fork("goal"), own: rng.fork("own"), study: rng.fork("study"), site: rng.fork("site"), swap: rng.fork("swap") };

  // How it comes, and whom it plays.
  const selves = selfCandidates(people, drama);
  const victims = victimCandidates(people, drama);
  const waiters = people.filter((p) => p.role === "waiter");
  let setup: SpySetup;
  if (opts.setup && SETUPS.includes(opts.setup)) setup = opts.setup;
  else if (r.setup.chance(SELF)) setup = "self";
  else if (host.partner === null && r.setup.chance(AS_HOST)) setup = "host";
  else setup = r.setup.chance(AS_WAITER) ? "waiter" : "victim";
  if (setup === "host" && host.partner !== null) setup = "victim";
  if (setup === "waiter" && !waiters.length) setup = "victim";
  if (setup === "self" && !selves.length) setup = "victim";
  if (setup === "victim" && !victims.length) setup = selves.length ? "self" : "host";
  let record: Person;
  const pinned = opts.target !== undefined ? people[opts.target] : undefined;
  if (setup === "host") record = host;
  else if (setup === "waiter") record = r.setup.pick(waiters);
  else if (setup === "self") record = r.setup.weighted(selves.map((p) => [p, 1 / (1 + p.friends.length)] as const));
  else if (pinned && opts.goal === undefined && victims.includes(pinned)) record = pinned;
  else record = r.setup.weighted(victims.map((p) => [p, (p.partner === null ? 1 : 0.1) / (1 + p.friends.length + (p.regular ? 1 : 0))] as const));

  // The goal: one draw from this house's odds, then its target and any theft first.
  const odds = goalOdds(bp, places, opts.odds);
  const kind: GoalKind = opts.goal && odds[opts.goal] !== undefined && houseHolds(opts.goal, bp, places) ? opts.goal : r.goal.weighted(GOALS.map((g) => [g, odds[g]] as const));
  const marks = kind === "kill" ? people.filter((p) => !p.staff && p !== record) : kind === "bag" ? people.filter((p) => !p.staff && p.role !== "host" && p !== record) : [];
  let target = -1;
  if (marks.length) target = pinned && marks.includes(pinned) && (opts.goal !== undefined || setup !== "victim" || pinned !== record) ? pinned.id : r.goal.pick(marks).id;
  let first: SpyGoal["first"] = null;
  const steal = Number.isFinite(opts.steal) ? Math.max(0, Math.min(1, opts.steal!)) : STEAL;
  if (kind === "kill" && target >= 0 && r.goal.chance(steal)) {
    const t = people[target]!;
    if (t.role === "host") first = { from: "pocket", thing: "phone" };
    else if (r.goal.chance(BAG[t.look.sex])) first = { from: "bag", thing: "papers" };
    else first = { from: r.goal.chance(0.5) ? "coat" : "pocket", thing: "phone" };
  }
  const bagFor = kind === "bag" || first?.from === "bag" ? target : -1;

  // Its own body and mind (as itself all of it is the record's, with the steadier head), and one draw per person for its study.
  const own = drawOwn(r.own, record);
  if (setup === "self") {
    own.sex = record.look.sex;
    own.height = record.look.height;
    own.build = record.look.build;
    own.speed = record.speed;
    own.quirks = [...record.quirks];
    own.traits = { ...record.traits };
    steady(own.traits);
    own.fluency = { ...record.fluency };
    own.fav = record.fav;
    own.never = record.never;
  }
  const study = new Float32Array(people.length);
  for (let i = 0; i < people.length; i++) study[i] = r.study.next();

  // Before the party: the victim's body hidden outside, its jacket or dress on the spy now (so in shirtsleeves or a slip), and now and then something they wore dropped on the way back in.
  let body: SpyBody | null = null;
  let garment: SpyCast["garment"] = null;
  if (setup !== "self") {
    const b = bodySpot(bp, r.site);
    body = {
      who: record.id,
      at: b.at,
      yaw: Math.PI / 2,
      place: b.place,
      kind: "outside",
      hides: BODY_HIDES,
      t: -r.site.range(20, 90) * 60,
      how: "before",
      look: { ...record.look },
      stripped: true,
    };
    if (r.site.chance(GARMENT_SHARE)) garment = { at: garmentSpot(bp, places, r.site), what: r.site.pick(GARMENT[record.look.sex]), color: r.site.pick(GARMENT_COLORS) };
  }
  // Mid-party it may take someone's place: drawn every evening, kept only coming as itself, unless the options say (and then playing a guest too).
  const ready = r.swap.chance(SWAP);
  const may = opts.swap !== undefined ? opts.swap && (setup === "self" || setup === "victim") : setup === "self" && ready;
  const swap = { may, playable: victimCandidates(people, drama).map((p) => p.id) };
  return { setup, record: record.id, victim: setup === "self" ? -1 : record.id, goal: { kind, target, first }, own, study, body, garment, bagFor, swap };
}

/**
 * Which of the victim's people it watched before the party, from the ties as `Ident` has them
 * and the cast's draws: each gets `knows` 2 and `close` at its tie's weight. Coming as itself
 * it knows nobody.
 */
export function studied(cast: SpyCast, people: readonly Person[], tieOf: (i: number, j: number) => Tie): { knows: Uint8Array; close: Float32Array } {
  const n = people.length;
  const knows = new Uint8Array(n);
  const close = new Float32Array(n);
  if (cast.victim < 0) return { knows, close };
  for (let j = 0; j < n; j++) {
    if (j === cast.record) continue;
    const tie = tieOf(cast.record, j);
    const chance = cast.setup === "host" && people[j]!.staff ? STUDY_STAFF : (STUDY[tie] ?? 0);
    if (chance <= 0 || cast.study[j]! >= chance) continue;
    knows[j] = 2;
    close[j] = TIE_WEIGHT[tie] ?? 0;
  }
  return { knows, close };
}
