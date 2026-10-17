/**
 * The evening's innocent trouble (milestone 2 technical plan: Mishaps, oddballs and small
 * dramas): accidents anyone can have, the few oddballs who do one spy-like thing all night, and
 * three to six small dramas dealt from a deck of thirteen.
 *
 * One scheduler runs it all every 20 steps (10 in-game s). Mishaps draw from a stream of their
 * own, exactly one number per person per check whatever happens, so nothing elsewhere shifts
 * their rolls; everything else (who, where, for how long) draws from the dramas stream.
 *
 * A mishap, a drama or a habit's outing is an episode: a cast, a stage, a time for its next beat
 * and the tasks it has running (tasks.ts). The scheduler moves it on, and so do its tasks' steps,
 * its cast's actions ending and what its cast is seen doing: an episode someone outside the cast
 * saw counts as seen.
 */
import type { Rng } from "../mansion/core/rng";
import type { MansionBlueprint, PropKind, RoomType } from "../mansion/core/types";
import type { Bonds } from "./bonds";
import { PARTY_LENGTH, type Phase, type PhaseId } from "./clock";
import type { Ident } from "./ident";
import { KNOWN, type Memory, type Verb } from "./memory";
import type { Candidate } from "./mind";
import type { Mood } from "./mood";
import type { Pathfinder } from "./path";
import { frontOf, yawTo, type Places, type RoomCells } from "./places";
import type { SoundKind } from "./senses";
import type { Step, Task, Tasks } from "./tasks";
import type { ActionState, DrinkId, Gesture, Group, PartyEvent, Person, Pose, Seat, Spot } from "./types";
import type { World } from "./world";

const MIN = 60;

/** The scheduler runs every this many steps (10 in-game s). */
export const DRAMA_EVERY = 20;
const CHECK = 10;
const CHECKS = PARTY_LENGTH / CHECK;

// ---------------------------------------------------------------- mishaps

export type MishapId = "spill" | "cut" | "lost" | "ankle" | "faint" | "switch" | "tray";
export const MISHAP_IDS: readonly MishapId[] = ["spill", "cut", "lost", "ankle", "faint", "switch", "tray"];

/**
 * Each mishap's chance per guest per evening at average clumsiness (milestone 2 plan: Mishaps), in
 * the order a draw is read, and the share of a guest's evening its context holds (a glass in hand
 * by someone standing for a spill, walking for an ankle; measured over a sweep). A mishap only
 * happens in its context, so its hazard is spread over that share of the evening, not all of it.
 */
const CHANCE: ReadonlyArray<readonly [Exclude<MishapId, "tray">, number, number]> = [
  ["spill", 0.1, 0.036],
  ["cut", 0.04, 0.12],
  ["lost", 0.03, 0.28],
  ["ankle", 0.02, 0.053],
  ["faint", 0.02, 0.28],
  ["switch", 0.01, 0.049],
];
const TOTAL = CHANCE.reduce((s, [, c, ctx]) => s + c / ctx, 0);
/**
 * Clumsiness (0.5 + clumsy), drink (1 + 2 × tipsiness) and a crowd (1 + those within 2 m / 4) multiply
 * the chance. Over a guest's evening they come to about this much, so the chances stay per evening (tuned).
 */
const NORM = 3;
/** The crowd counts up to this many. */
const CROWD_MAX = 8;
/** The most a hazard can be: most checks miss by more, and skip working out the crowd. */
const MAX_HAZARD = (TOTAL * 1.5 * 3 * (1 + CROWD_MAX / 4)) / CHECKS / NORM;
/** A tray dropped: per check carried, × (1 − tray fluency) × the crowd. */
const TRAY = 0.003;
/** Doing any of these, nobody has an accident: the programme, a task, the bathroom, leaving, arriving, words. */
const NO_MISHAP: ReadonlySet<string> = new Set(["toast", "dinner", "champagne", "toilet", "task", "leave", "arrive", "row"]);

/** A spill's victim stands this close (m). A third borrow something of the host's to change into; the rest dab at it by the bar. */
const SPILL_NEAR = 1.2;
const CHANGE = 1 / 3;
/** What the host lends: a dark jacket, or a pale shawl. */
const LOAN = { m: "#2c2f36", f: "#d9cdb8" } as const;
/** Washing a cut takes this much longer than a visit. */
const WASH = 3 * MIN;
/** Dressing a cut: the doctor, the host, anyone else fumbling the bandage (in-game s). */
const DRESS = { doctor: 20, host: 25, other: 45 } as const;
/** Lost things are noticed this long after (in-game s); the owner looks in up to LOOKS places, asking as they go. */
const NOTICE: readonly [number, number] = [60, 600];
const LOOKS = 4;
/** Someone this near a lost thing while its owner looks for it may spot it: per check, SPOT × (0.5 + nosiness). */
const SPOT_NEAR = 2.5;
const SPOT = 0.15;
/** Leaning on a switch: within this of it (m); the room is dark for 10 to 30 s. */
const SWITCH_NEAR = 3;

// --------------------------------------------------------------- oddballs

export type Habit = "creep" | "wanderer" | "nervous" | "latecomer" | "snoop" | "camera-shy";
export const HABITS: readonly Habit[] = ["creep", "wanderer", "nervous", "latecomer", "snoop", "camera-shy"];

/** Outings over the evening for the habits that go out (the plan's rates). */
const OUTINGS: Record<"creep" | "wanderer" | "snoop", readonly [number, number]> = { creep: [2, 4], wanderer: [3, 6], snoop: [4, 8] };
/** An outing not begun this long after its time (the oddball busy) is let go. */
const OUTING_LATE = 5 * MIN;
/** A target who notices the creep slaps them this often. */
const CREEP_SLAP = 0.4;
/** The nervous one startles at most this often (in-game s). */
const STARTLE_GAP = 20;
/** The private rooms a wanderer tries, and the furniture a snoop goes through. */
const PRIVATE: ReadonlySet<RoomType> = new Set(["bedroom", "study", "dressing-room"]);
const DRAWERS: ReadonlySet<PropKind> = new Set(["desk", "cabinet", "sideboard", "console", "wardrobe"]);

// ------------------------------------------------------------------- deck

/** The small-dramas deck (A Real Party: Small dramas). */
export type CardId = "quarrel" | "drunk" | "tears" | "speech" | "earring" | "wine" | "bore" | "early" | "stranger" | "piano" | "photo" | "vase" | "fuse";
export const CARD_IDS: readonly CardId[] = ["quarrel", "drunk", "tears", "speech", "earring", "wine", "bore", "early", "stranger", "piano", "photo", "vase", "fuse"];
/** A card that finds nobody to play it tries again this much later, until its window closes. */
const RETRY = 2 * MIN;
/** A couple quarrel when their tipsiness, tension (× 2) and an eye for someone else add up to this. */
const QUARREL_FROM = 0.5;
/** One drink too many: past 0.85, or from 0.6 after two quick whiskies at the bar. */
const DRUNK = 0.85;
const DRUNK_FROM = 0.6;
/** Tears in the bathroom follow a quarrel or a row within this long (in-game s). */
const UPSET_FOR = 30 * MIN;

export type EpisodeKind = "mishap" | "drama" | "habit";

/** One mishap, drama or outing, from its start until its last beat. */
export interface Episode {
  id: number;
  kind: EpisodeKind;
  what: MishapId | CardId | Habit;
  /** Who it happens to first, then whoever else it involves. */
  cast: number[];
  stage: string;
  /** In-game time of its next beat. */
  at: number;
  started: number;
  room: number;
  /** Someone outside the cast saw it. */
  seen: boolean;
  /** A thing it is about (a lost bag, an earring, broken glass), or -1. */
  item: number;
  /** A number of its own: a bathroom, a group, a storey, looks so far. */
  n: number;
  done: boolean;
}

/** What the dramas need from the party. */
export interface DramasHost {
  readonly t: number;
  readonly bp: MansionBlueprint;
  readonly people: Person[];
  readonly programme: Phase[];
  readonly phaseId: PhaseId;
  readonly places: Places;
  readonly cells: RoomCells;
  readonly pf: Pathfinder;
  readonly world: World;
  readonly memory: Memory;
  readonly mood: Mood;
  readonly ident: Ident;
  readonly bonds: Bonds;
  readonly tasks: Tasks;
  readonly groups: Map<number, Group>;
  readonly host: Person;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
  gesture(p: Person, g: Gesture, secs: number): void;
  glance(p: Person, x: number, z: number, secs: number): void;
  notable(p: Person, verb: Verb, obj: number, secs: number, room?: number): void;
  sound(kind: SoundKind, at: { level: number; x: number; z: number; room: number }, source: number, ref?: number): void;
  start(p: Person, c: Candidate): void;
  end(p: Person, done: boolean): void;
  /** Present, a guest, outside the rituals, not busy with a task, the bathroom, leaving or words. */
  free(p: Person): boolean;
  goHome(p: Person, hurry: boolean): void;
  stormOff(p: Person, home: boolean): void;
  beside(q: Person, from: { x: number; z: number }, gap?: number, free?: Person): Spot | null;
  /** A free seat within reach (m), or null. */
  seatNear(p: Person, within: number): Seat | null;
  /** The bathroom someone would make for, or -1. */
  bathFor(p: Person): number;
  /** Someone near and known to ask, or null. */
  answerer(p: Person): Person | null;
  /** Something of p's gone from a room: a case with nobody to blame yet (register.ts). */
  missing(p: Person, obj: number, room: number): void;
  /** It turned up: every case about it closes. */
  turnedUp(obj: number, room: number): void;
  /** Hand someone a drink they asked for, poured (the whiskies at the bar). */
  pour(p: Person, d: DrinkId): void;
  setDown(p: Person): void;
}

/** What the scheduler has done so far, for the lab and the tests. */
export interface DramaStats {
  /** Draws made on the mishap stream: always one per person per check. */
  rolls: number;
  checks: number;
  mishaps: number;
  byMishap: Record<MishapId, number>;
  /** After a spill: changed into the host's loan; cuts dressed; lost things back with their owner. */
  changed: number;
  bandaged: number;
  returned: number;
  oddballs: number;
  outings: number;
  startles: number;
  slaps: number;
  rattles: number;
  dealt: number;
  dramas: number;
  byCard: Record<CardId, number>;
  /** Cards whose window closed with nobody to play them. */
  expired: number;
}

/** Cast at the start of the evening, before anyone knows anyone (the party's constructor runs this right after the cast). */
export interface DramaCast {
  oddballs: Array<{ who: number; habit: Habit; at: number[] }>;
  /** The deck after shuffling (only the cards this house can hold), and how many were dealt. */
  deck: CardId[];
  dealt: number;
  /** The stranger nobody knows, or -1. */
  stranger: number;
}

interface Slot {
  card: CardId;
  at: number;
  until: number;
  state: "waiting" | "played" | "gone";
}

/** The programme's phases by position: 1 the first mingling, 4 after the toast, 8 after the games. */
const P = { arrival: 0, mingle1: 1, champagne: 2, toast: 3, mingle2: 4, dinner: 5, dancing: 6, games: 7, mingle3: 8, farewell: 9 } as const;

/** When each card can be played (in-game s after 19:00). */
function windowOf(card: CardId, pg: readonly Phase[]): [number, number] {
  const ph = (i: number) => pg[i]!;
  const at = (i: number, k: number) => ph(i).start + (ph(i).end - ph(i).start) * k;
  switch (card) {
    case "quarrel":
    case "tears":
      return [ph(P.mingle2).start, ph(P.mingle3).end];
    case "drunk":
      return [ph(P.dancing).start, at(P.farewell, 0.3)];
    case "speech":
      return [at(P.dinner, 0.3), at(P.dinner, 0.75)];
    case "earring":
    case "bore":
    case "vase":
      return [at(P.mingle1, 0.2), ph(P.mingle3).end];
    case "wine":
      return [ph(P.dancing).start, ph(P.mingle3).end];
    case "early":
      return [ph(P.mingle2).start, ph(P.dinner).start - 3 * MIN];
    case "stranger":
      return [ph(P.mingle2).start + MIN, at(P.mingle2, 0.6)];
    case "piano":
      return [ph(P.games).start, ph(P.mingle3).end];
    case "photo":
      return [ph(P.dancing).start, ph(P.farewell).start];
    case "fuse":
      return [at(P.dancing, 0.15), at(P.dancing, 0.6)];
  }
}

/** Whether the house can hold a card at all. */
function houseHolds(card: CardId, pl: Places): boolean {
  if (card === "piano") return pl.games.some((g) => g.kind === "piano");
  if (card === "photo") return pl.terrace.length >= 6;
  if (card === "fuse") return !!pl.danceRoom;
  if (card === "tears") return pl.bathrooms.length > 0;
  return true;
}

/** Times spread over the evening outside the programme's fixed moments, from `from` on. */
function outingTimes(rng: Rng, pg: readonly Phase[], from: number, k: number): number[] {
  const out: number[] = [];
  const busy = (t: number) => pg.some((ph, i) => (i === P.champagne || i === P.toast || i === P.dinner) && t >= ph.start - 2 * MIN && t < ph.end);
  for (let i = 0; i < k * 4 && out.length < k; i++) {
    const t = rng.range(from, PARTY_LENGTH - 25 * MIN);
    if (!busy(t) && out.every((o) => Math.abs(o - t) > 6 * MIN)) out.push(Math.round(t));
  }
  return out.sort((a, b) => a - b);
}

/**
 * Before anyone knows anyone: 0 to 2 oddballs with a habit each, the deck shuffled and dealt,
 * and if the stranger is dealt, a guest made a stranger (no friends here, arriving after the toast).
 */
export function castDramas(rng: Rng, people: Person[], programme: readonly Phase[], places: Places): DramaCast {
  const host = people.find((p) => p.role === "host")!;
  const guests = people.filter((p) => !p.staff && p.role === "guest" && p !== host && p.id !== host.partner);
  const used = new Set<number>();
  const toastEnd = programme[P.toast]!.end;
  const pick = (ok: (g: Person) => boolean): Person | null => {
    const c = guests.filter((g) => !used.has(g.id) && ok(g));
    if (!c.length) return null;
    const g = rng.pick(c);
    used.add(g.id);
    return g;
  };
  const oddballs: DramaCast["oddballs"] = [];
  const n = rng.weighted<number>([
    [0, 1],
    [1, 2],
    [2, 1],
  ]);
  for (const habit of rng.shuffle(HABITS).slice(0, n)) {
    const solo = (g: Person) => g.partner === null && g.archetype === null;
    const g = pick(habit === "latecomer" ? solo : (x) => x.archetype !== "mother" && x.archetype !== "elderly" && x.archetype !== "child");
    if (!g) continue;
    const t = g.traits;
    if (habit === "nervous") t.nerves = Math.max(t.nerves, 0.75);
    else if (habit === "camera-shy") t.nerves = Math.max(t.nerves, 0.6);
    else if (habit === "creep") t.propriety = Math.min(t.propriety, 0.55);
    else if (habit === "snoop") t.nosy = Math.max(t.nosy, 0.8);
    else if (habit === "wanderer") t.curiosity = Math.max(t.curiosity, 0.8);
    else if (habit === "latecomer") {
      // Today's occasional latecomer gives way to this one, who comes after the toast.
      for (const q of guests) if (q !== g && q.arriveAt >= 40 * MIN) q.arriveAt = Math.round(rng.range(20, 14 * MIN));
      g.arriveAt = Math.round(toastEnd + rng.range(MIN, 8 * MIN));
    }
    const out = habit === "creep" || habit === "wanderer" || habit === "snoop" ? OUTINGS[habit] : null;
    const at = out ? outingTimes(rng, programme, Math.max(g.arriveAt, 0) + 10 * MIN, rng.int(out[0], out[1])) : [];
    oddballs.push({ who: g.id, habit, at });
  }
  const deck = rng.shuffle(CARD_IDS).filter((c) => houseHolds(c, places));
  let dealt = Math.min(deck.length, rng.int(3, 6));
  let stranger = -1;
  const s = deck.indexOf("stranger");
  if (s >= 0 && s < dealt) {
    const g = pick((x) => x.partner === null && x.archetype === null);
    if (g) {
      // Nobody here knows them: a late plus-one, or a gatecrasher.
      for (const f of g.friends) people[f]!.friends = people[f]!.friends.filter((x) => x !== g.id);
      g.friends = [];
      g.regular = false;
      const [a, b] = windowOf("stranger", programme);
      g.arriveAt = Math.round(rng.range(a, b));
      stranger = g.id;
    } else {
      deck.splice(s, 1);
      dealt = Math.min(dealt, deck.length);
    }
  }
  return { oddballs, deck, dealt, stranger };
}

/** Relative luminance of a hex colour, 0 to 1. */
function lum(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
}

export class Dramas {
  readonly stats: DramaStats;
  readonly episodes: Episode[] = [];
  /** Each person's habit, if they're one of the oddballs. */
  readonly habit: Array<Habit | null>;
  readonly oddballs: DramaCast["oddballs"];
  readonly slots: Slot[] = [];
  readonly stranger: number;
  /** Outings each oddball has had seen by someone. */
  readonly habitSeen: Int16Array;
  private readonly deck: CardId[];
  private nextCard: number;
  private readonly outingNext: Int16Array;
  /** Held by a drama until then: not free to be drawn into anything else. */
  private readonly busyUntil: Float32Array;
  /** Drinks spilled on others tonight. */
  private readonly spilled: Uint8Array;
  /** In the host's jacket or shawl after a spill. */
  private readonly borrowed: Uint8Array;
  /** The episode each person is in now (-1 none), for who saw it. */
  private readonly inEp: Int16Array;
  /** A pose held for a while over whatever they're doing (standing for a speech, the band stopping in a blackout). */
  private readonly poseAs: Array<Pose | null>;
  private readonly poseUntil: Float32Array;
  private readonly startleAt: Float32Array;
  /** When each person last quarrelled or had a row. */
  private readonly upsetAt: Float32Array;
  /** Tasks the episodes run, task id -> episode id. */
  private readonly taskEp = new Map<number, number>();
  /** Rooms dark from a switch or the fuse: how many reasons each has. */
  private readonly darkN: Uint8Array;
  /** Where the first-aid kit lives. */
  private kitHome: { level: number; x: number; z: number; room: number } | null = null;

  constructor(
    private readonly host: DramasHost,
    cast: DramaCast,
    private readonly rng: Rng,
    private readonly roll: Rng,
  ) {
    const n = host.people.length;
    this.habit = Array.from({ length: n }, () => null);
    this.oddballs = cast.oddballs;
    for (const o of cast.oddballs) this.habit[o.who] = o.habit;
    this.habitSeen = new Int16Array(n);
    this.outingNext = new Int16Array(n);
    this.busyUntil = new Float32Array(n);
    this.spilled = new Uint8Array(n);
    this.borrowed = new Uint8Array(n);
    this.inEp = new Int16Array(n).fill(-1);
    this.poseAs = Array.from({ length: n }, () => null);
    this.poseUntil = new Float32Array(n);
    this.startleAt = new Float32Array(n).fill(-1e9);
    this.upsetAt = new Float32Array(n).fill(-1e9);
    this.darkN = new Uint8Array(host.bp.rooms.length);
    this.stranger = cast.stranger;
    this.deck = cast.deck;
    this.nextCard = cast.dealt;
    const zero = <K extends string>(ks: readonly K[]) => Object.fromEntries(ks.map((k) => [k, 0])) as Record<K, number>;
    this.stats = {
      rolls: 0,
      checks: 0,
      mishaps: 0,
      byMishap: zero(MISHAP_IDS),
      changed: 0,
      bandaged: 0,
      returned: 0,
      oddballs: cast.oddballs.length,
      outings: 0,
      startles: 0,
      slaps: 0,
      rattles: 0,
      dealt: cast.dealt,
      dramas: 0,
      byCard: zero(CARD_IDS),
      expired: 0,
    };
    for (const card of cast.deck.slice(0, cast.dealt)) this.slot(card, false);
  }

  /** A card on the table: a time inside its window (the stranger's is their arrival). */
  private slot(card: CardId, late: boolean): void {
    const h = this.host;
    const [a, b] = windowOf(card, h.programme);
    const from = Math.max(a, late ? h.t + CHECK : a);
    if (from > b - CHECK) return;
    const at = card === "stranger" ? b : this.rng.range(from, from + (b - from) * 0.7);
    this.slots.push({ card, at, until: b, state: "waiting" });
  }

  /** The first-aid kit's place, once the house has shelved it. */
  setKit(at: { level: number; x: number; z: number; room: number }): void {
    this.kitHome = at;
  }

  // -------------------------------------------------------------- queries

  /** Held by a drama: not to be drawn into anything else. */
  busy(p: Person): boolean {
    return this.host.t < this.busyUntil[p.id]!;
  }

  /** In something borrowed after a spill. */
  changed(p: Person): boolean {
    return this.borrowed[p.id] === 1;
  }

  /** A pose a drama holds them in, or null. */
  pose(p: Person): Pose | null {
    return this.poseAs[p.id] && this.host.t < this.poseUntil[p.id]! ? this.poseAs[p.id]! : null;
  }

  /** The episode someone is in now, if any. */
  episodeOf(p: Person): Episode | undefined {
    const e = this.inEp[p.id]!;
    return e >= 0 ? this.episodes[e] : undefined;
  }

  /** Dramas played tonight that nobody outside them saw. */
  get unseen(): number {
    return this.episodes.filter((e) => e.kind === "drama" && !e.seen).length;
  }

  // ------------------------------------------------------------ scheduler

  /** Every DRAMA_EVERY steps: the mishap draws, oddballs' outings, the deck, and episodes due a beat. */
  step(): void {
    const h = this.host;
    this.stats.checks++;
    this.rollMishaps();
    this.outings();
    this.deal();
    for (const e of this.episodes) {
      if (e.done) continue;
      if (e.item >= 0 && (e.stage === "search" || e.stage === "given-up")) this.spotting(e);
      if (h.t >= e.at) this.beat(e);
      else this.during(e);
    }
  }

  private ep(kind: EpisodeKind, what: Episode["what"], cast: Person[], stage: string, at: number, room: number): Episode {
    const e: Episode = { id: this.episodes.length, kind, what, cast: cast.map((p) => p.id), stage, at, started: this.host.t, room, seen: false, item: -1, n: 0, done: false };
    this.episodes.push(e);
    for (const p of cast) this.inEp[p.id] = e.id;
    if (kind === "mishap") {
      this.stats.mishaps++;
      this.stats.byMishap[what as MishapId]++;
    } else if (kind === "drama") {
      this.stats.dramas++;
      this.stats.byCard[what as CardId]++;
    } else this.stats.outings++;
    return e;
  }

  private close(e: Episode): void {
    e.done = true;
    for (const i of e.cast) if (this.inEp[i] === e.id) this.inEp[i] = -1;
  }

  /** Start a task for an episode (tasks.ts); it reports back through finished and stepDone. */
  private task(e: Episode, owner: Person, party: Person[], steps: Step[], gap?: number): Task | null {
    const kind = e.kind === "habit" ? "habit" : e.kind;
    const t = this.host.tasks.run(kind, e.what, owner, party, steps, gap);
    if (t.outcome !== null) return null;
    this.taskEp.set(t.id, e.id);
    for (const q of [owner, ...party]) if (!e.cast.includes(q.id)) e.cast.push(q.id);
    for (const q of [owner, ...party]) this.inEp[q.id] = e.id;
    return t;
  }

  /** The running task of an episode owned by someone, if any. */
  private taskOf(e: Episode, p: Person): Task | undefined {
    const t = this.host.tasks.of(p);
    return t && t.owner === p.id && this.taskEp.get(t.id) === e.id ? t : undefined;
  }

  private hold(p: Person, secs: number): void {
    this.busyUntil[p.id] = Math.max(this.busyUntil[p.id]!, this.host.t + secs);
  }

  /** Free for a drama to draw in: a guest outside the rituals and not busy (the host and staff by `staffOk`). */
  private available(p: Person, staffOk = false): boolean {
    if (!p.present || p.gone || this.busy(p)) return false;
    if (!staffOk || (!p.staff && p.role !== "host")) return this.host.free(p);
    const a = p.action;
    return !a || !["task", "toilet", "leave", "row", "toast", "dinner", "champagne", "arrive"].includes(a.id);
  }

  /** People present within r (m) of a point on the same storey and in the same room. */
  private around(at: { level: number; x: number; z: number; room: number }, r: number, except?: Person): Person[] {
    return this.host.people.filter((q) => q !== except && q.present && q.level === at.level && q.room === at.room && Math.hypot(q.x - at.x, q.z - at.z) < r);
  }

  private crowdAround(p: Person, r: number): number {
    let c = 0;
    for (const q of this.host.people) if (q !== p && q.present && q.level === p.level && q.room === p.room && Math.hypot(q.x - p.x, q.z - p.z) < r) c++;
    return Math.min(CROWD_MAX, c);
  }

  /** A walkable spot within r (m) of a point, in the same room. */
  private spotNear(at: { level: number; x: number; z: number; room: number }, r: number, face?: { x: number; z: number }): Spot | null {
    const h = this.host;
    for (let i = 0; i < 6; i++) {
      const a = this.rng.range(-Math.PI, Math.PI);
      const d = this.rng.range(r * 0.5, r);
      const w = h.pf.snap(at.level, at.x + Math.sin(a) * d, at.z + Math.cos(a) * d, 0.4);
      if (!w || h.pf.roomAt(w.level, w.x, w.z) !== at.room) continue;
      const f = face ?? at;
      return { level: w.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, f.x, f.z), room: at.room };
    }
    return null;
  }

  /** The nearest of some people to a point, within r (m), counting a storey as 15 m. */
  private nearest(qs: Person[], at: { level: number; x: number; z: number }, r: number): Person | null {
    let best: Person | null = null;
    let bd = r;
    for (const q of qs) {
      const d = Math.hypot(q.x - at.x, q.z - at.z) + 15 * Math.abs(q.level - at.level);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  /** A friend or the partner, present and free, near enough to come over. */
  private friendOf(p: Person, r = 20): Person | null {
    const h = this.host;
    const ties = h.people.filter((q) => q !== p && (q.id === p.partner || p.friends.includes(q.id)) && this.available(q));
    return this.nearest(ties, p, r);
  }

  /** The nearest waiter (or kitchen hand) not already busy with a task. */
  private staffNear(at: { level: number; x: number; z: number }, r = 40, except?: Person): Person | null {
    const h = this.host;
    return this.nearest(
      h.people.filter((q) => q !== except && (q.role === "waiter" || q.role === "kitchenHand" || q.role === "butler") && this.available(q, true)),
      at,
      r,
    );
  }

  /**
   * Mark who saw what: someone outside an episode's cast laid eyes on someone in it (senses.ts,
   * through the party). A habit counts only while the oddball is at it (lingering, rattling a
   * door, at the drawers, startled), not on the way there.
   */
  saw(a: Person, b: Person): void {
    const k = this.inEp[b.id]!;
    if (k < 0) return;
    const e = this.episodes[k]!;
    if (e.done || e.seen || e.cast.includes(a.id)) return;
    if (e.kind === "habit" && (b.id !== e.cast[0] || !b.notable || this.host.t >= b.notableUntil)) return;
    e.seen = true;
    if (e.kind === "habit") this.habitSeen[e.cast[0]!]!++;
  }

  // -------------------------------------------------------------- mishaps

  /** One draw per person, whatever happens: read against each mishap's slice of the hazard. */
  private rollMishaps(): void {
    const h = this.host;
    for (const p of h.people) {
      const u = this.roll.next();
      this.stats.rolls++;
      if (!p.present || p.gone) continue;
      if (p.held === "tray") {
        if (p.item >= 0 && h.world.items.count[p.item]! > 0 && u < (TRAY * (1 - p.fluency.tray) * (1 + this.crowdAround(p, 2) / 4)) / NORM) this.dropTray(p);
        continue;
      }
      if (p.staff || u >= MAX_HAZARD || this.busy(p) || (p.action && NO_MISHAP.has(p.action.id))) continue;
      const near = this.crowdAround(p, 2);
      const k = ((0.5 + p.traits.clumsy) * (1 + 2 * p.tipsy) * (1 + near / 4)) / CHECKS / NORM;
      let acc = 0;
      for (const [m, c, ctx] of CHANCE) {
        acc += (c / ctx) * k;
        if (u >= acc) continue;
        this.mishap(m, p, near);
        break;
      }
    }
  }

  /** A mishap, if its context is there (a spill needs a glass and someone close, a cut a glass in hand). */
  mishap(m: MishapId, p: Person, near = this.crowdAround(p, 2), forced = false): boolean {
    switch (m) {
      case "spill":
        return this.spill(p, forced);
      case "cut":
        return this.cut(p, forced);
      case "lost":
        return this.lose(p);
      case "ankle":
        return this.ankle(p, forced);
      case "faint":
        return this.faint(p, near, forced);
      case "switch":
        return this.leanOnSwitch(p, forced);
      case "tray":
        return this.dropTray(p);
    }
  }

  /**
   * A drink down someone: their shirt stained the drink's colour, a grudge against whoever did it
   * (0.35, plus 0.25 without an apology and 0.2 on a light outfit, twice for a repeat offender),
   * then off to change into something the host lends, or to dab at it by the bar.
   */
  private spill(p: Person, forced: boolean): boolean {
    const h = this.host;
    const items = h.world.items;
    const glass = p.item >= 0 && items.kindOf(p.item) === "glass" && items.fill[p.item]! > 0.2 ? p.item : -1;
    // Forced from the lab, the selected person is the one it lands on: whoever stands near with a glass spilled it.
    let by = p;
    let v: Person | null = null;
    if (forced) {
      v = p;
      const g = this.around(p, 2, p).find((q) => !q.staff && q.item >= 0 && items.kindOf(q.item) === "glass");
      if (g) by = g;
    } else {
      if (glass < 0) return false;
      v = this.nearest(
        this.around(p, SPILL_NEAR, p).filter((q) => !q.staff && !q.stain && q.pose !== "sit"),
        p,
        SPILL_NEAR,
      );
    }
    if (!v) return false;
    const from = by.item >= 0 && items.kindOf(by.item) === "glass" ? by.item : -1;
    const drink: DrinkId = from >= 0 ? items.drinkOf(from) : "red";
    if (from >= 0) {
      items.fill[from] = Math.max(0, items.fill[from]! - 0.5);
      if (items.fill[from]! <= 0) h.setDown(by);
    }
    v.stain = drink;
    h.ident.refresh(v);
    h.gesture(v, "startle", 1);
    h.notable(v, "spill", by.id, 40);
    h.memory.observe(v.id, "spill", v.id, by.id, v.room);
    if (by !== v) {
      const sorry = this.rng.chance(by.traits.propriety * (1 - 0.5 * by.tipsy));
      if (sorry) h.gesture(by, "lean", 2);
      h.memory.observe(by.id, "spill", v.id, by.id, v.room);
      const dress = v.look.outfit === "long-dress" || v.look.outfit === "short-dress";
      const light = lum(dress ? v.look.color : v.look.accent) > 0.6;
      h.bonds.addGrudge(v.id, by.id, (0.35 + (sorry ? 0 : 0.25) + (light ? 0.2 : 0)) * (this.spilled[by.id] ? 2 : 1));
      this.spilled[by.id]!++;
    }
    const e = this.ep("mishap", "spill", by !== v ? [v, by] : [v], "clean", h.t + 20 * MIN, v.room);
    h.log("mishap", by !== v ? [v.id, by.id] : [v.id], v.room, "spill");
    this.cleanUp(e, v);
    return true;
  }

  /** After a spill: borrow the host's jacket or shawl and change upstairs, or dab at it by the bar. */
  private cleanUp(e: Episode, v: Person): void {
    const h = this.host;
    const host = h.host;
    const room = this.changingRoom(v);
    const lender = v === host || this.available(host, true);
    if (room !== null && lender && this.rng.chance(CHANGE)) {
      const steps: Step[] =
        v === host
          ? []
          : [
              { do: "meet", who: host.id, label: "to-host" },
              { do: "say", who: host.id, s: 4, pose: "talk", label: "borrow" },
            ];
      steps.push({ do: "goto", to: room, label: "to-change" }, { do: "wait", s: this.rng.range(90, 150), pose: "stand", label: "change" });
      if (this.task(e, v, [], steps)) {
        e.stage = "change";
        return;
      }
    }
    const bars = h.places.bars;
    const bar = [...bars].sort((a, b) => Math.hypot(a.x - v.x, a.z - v.z) + 15 * Math.abs(a.level - v.level) - (Math.hypot(b.x - v.x, b.z - v.z) + 15 * Math.abs(b.level - v.level)))[0];
    const steps: Step[] = bar ? [{ do: "goto", to: bar, label: "to-bar" }] : [];
    steps.push({ do: "wait", s: this.rng.range(40, 80), pose: "dab", label: "dab" });
    e.stage = "dab";
    if (!this.task(e, v, [], steps)) this.close(e);
  }

  /** Somewhere to change: the dressing room, else a guest bedroom nobody is in (the host: any bedroom). */
  private changingRoom(v: Person): Spot | null {
    const h = this.host;
    const { bp, world } = h;
    const ok = (r: number) => {
      const room = bp.rooms[r]!;
      if (!h.pf.levels.has(room.level) || h.people.some((q) => q.present && q.room === r)) return false;
      if (world.doors.some((d) => d.rooms.includes(r) && d.locked && d.lock === "inside")) return false;
      return v.room < 0 || world.reachable(v.room, r, v);
    };
    const host = v === h.host;
    const rooms = bp.rooms.filter((r) => (r.type === "dressing-room" || (host ? r.type === "bedroom" : world.guestBedrooms.includes(r.index))) && ok(r.index));
    if (!rooms.length) return null;
    const by = (r: (typeof rooms)[number]) =>
      Math.hypot((r.inner.x0 + r.inner.x1) / 2 - v.x, (r.inner.z0 + r.inner.z1) / 2 - v.z) + 12 * Math.abs(r.level - v.level) - (r.type === "dressing-room" ? 6 : 0);
    rooms.sort((a, b) => by(a) - by(b));
    return h.cells.random(rooms[0]!.index, this.rng, 0.8);
  }

  /**
   * A glass breaks in the hand (a loud crash): off to wash it in a bathroom, three minutes longer
   * than a visit, while the doctor, the host or the butler fetches the kit and waits at the door;
   * then a bandage for the night.
   */
  private cut(p: Person, forced: boolean): boolean {
    const h = this.host;
    const items = h.world.items;
    if (forced && (p.item < 0 || items.kindOf(p.item) !== "glass")) h.pour(p, "red");
    if (p.item < 0 || items.kindOf(p.item) !== "glass" || p.bandage) return false;
    const g = p.item;
    items.holder[g] = -1;
    items.set(g, "broken", h.t);
    items.place(g, p);
    p.item = -1;
    p.held = null;
    h.sound("breaking-glass", p, p.id);
    h.gesture(p, "startle", 1.5);
    h.notable(p, "cut", -1, 90);
    h.memory.observe(p.id, "cut", p.id, -1, p.room);
    const e = this.ep("mishap", "cut", [p], "wash", h.t + 20 * MIN, p.room);
    e.item = g;
    h.log("mishap", [p.id], p.room, "cut");
    this.sweep(e, p, [g], "sweep");
    const b = h.bathFor(p);
    e.n = b;
    h.end(p, false);
    if (b >= 0) {
      const bath = h.places.bathrooms[b]!;
      h.start(p, { id: "toilet", target: bath.door, duration: this.rng.range(120, 240) + WASH, pose: "wait", gain: { bladder: 1 }, ref: b, note: "door" });
    }
    if (p.action?.id !== "toilet") {
      e.n = -1;
      e.stage = "await";
      this.task(e, p, [], [{ do: "wait", s: 10 * MIN, pose: "wait", label: "await-kit" }]);
    }
    this.hold(p, 25 * MIN);
    const carrier = this.carrierFor(p);
    const kit = this.kit();
    if (!carrier) return true;
    const steps: Step[] = [];
    if (kit >= 0) {
      const at = this.kitSpot(kit);
      if (at) steps.push({ do: "goto", to: at, label: "to-kit" }, { do: "pick", item: kit, label: "pick" });
    }
    if (b >= 0 && p.action?.id === "toilet") steps.push({ do: "goto", to: h.places.bathrooms[b]!.door, label: "to-bathroom" }, { do: "wait", s: 15 * MIN, pose: "wait", label: "await" });
    steps.push(
      { do: "meet", who: p.id, label: "to-patient" },
      { do: "say", who: p.id, s: carrier.role === "doctor" ? DRESS.doctor : carrier.role === "host" ? DRESS.host : DRESS.other, pose: "serve", label: "dress" },
    );
    this.task(e, carrier, [], steps);
    return true;
  }

  /** Who dresses a cut: the doctor, else the host, else the butler. */
  private carrierFor(p: Person): Person | null {
    const h = this.host;
    for (const role of ["doctor", "host", "butler"] as const) {
      const q = h.people.find((x) => x.role === role && x !== p && this.available(x, true));
      if (q) return q;
    }
    return null;
  }

  /** The first-aid kit, when it's on its shelf. */
  private kit(): number {
    const items = this.host.world.items;
    for (let i = 0; i < items.n; i++) if (items.kindOf(i) === "kit" && items.stateOf(i) === "shelved") return i;
    return -1;
  }

  private kitSpot(kit: number): Spot | null {
    const h = this.host;
    const items = h.world.items;
    const w = h.pf.snap(items.level[kit]!, items.x[kit]!, items.z[kit]!, 1.2);
    if (!w) return null;
    const room = h.pf.roomAt(w.level, w.x, w.z);
    return room === -1 ? null : { level: w.level, x: w.x, z: w.z, yaw: 0, room };
  }

  /** The bandage goes on, and the kit back on its shelf. */
  private dressed(e: Episode, p: Person, carrier: Person): void {
    const h = this.host;
    const items = h.world.items;
    p.bandage = true;
    h.ident.refresh(p);
    this.stats.bandaged++;
    h.log("mishap", [p.id, carrier.id], p.room, "cut:dressed");
    for (let i = 0; i < items.n; i++) {
      if (items.kindOf(i) !== "kit" || items.holder[i] !== carrier.id) continue;
      items.holder[i] = -1;
      items.set(i, "shelved", h.t);
      if (this.kitHome) items.place(i, this.kitHome);
    }
    if (carrier.held === "kit") carrier.held = null;
    // Whoever waited for the bandage is free again.
    const t = this.taskOf(e, p);
    if (t && p !== carrier) h.tasks.next(t);
    this.busyUntil[p.id] = 0;
    this.close(e);
  }

  /** Someone puts their spectacles or bag down and forgets them: noticed a few minutes later, and a search begins. */
  private lose(p: Person): boolean {
    const h = this.host;
    const items = h.world.items;
    const mine: number[] = [];
    for (let i = 0; i < items.n; i++) {
      if (items.owner[i] !== p.id || items.holder[i] !== p.id) continue;
      const k = items.kindOf(i);
      if ((k === "spectacles" && items.stateOf(i) === "worn") || (k === "bag" && items.stateOf(i) === "carried")) mine.push(i);
    }
    if (!mine.length || p.room === -1) return false;
    const it = this.rng.pick(mine);
    const rest = this.restingSpot(p);
    items.holder[it] = -1;
    items.set(it, "lost", h.t);
    items.place(it, rest);
    if (items.kindOf(it) === "spectacles") {
      p.quirks = p.quirks.filter((q) => q !== "glasses");
      h.ident.refresh(p);
    }
    const e = this.ep("mishap", "lost", [p], "unnoticed", h.t + this.rng.range(NOTICE[0], NOTICE[1]), rest.room);
    e.item = it;
    h.log("mishap", [p.id], p.room, `lost:${items.kindOf(it)}`);
    return true;
  }

  /** The nearest table or seat (within 4 m), else where they stand. */
  private restingSpot(p: Person): { level: number; x: number; z: number; room: number } {
    const h = this.host;
    let best: { level: number; x: number; z: number; room: number } = { level: p.level, x: p.x, z: p.z, room: p.room };
    let bd = 4;
    for (const s of [...h.places.surfaces, ...h.places.seats.map((x) => x.approach)]) {
      if (s.level !== p.level || s.room !== p.room) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** Looking for a lost thing: one place, a crouch to look, then ask round (the first look: where it was left, more often than not). */
  private search(e: Episode, p: Person, first: boolean): boolean {
    const h = this.host;
    const items = h.world.items;
    const room = first && this.rng.chance(0.6) ? items.room[e.item]! : p.room >= 0 ? p.room : items.room[e.item]!;
    const s = h.cells.random(room, this.rng, 0.6);
    if (!s) return false;
    const steps: Step[] = [
      { do: "goto", to: s, label: "to-look" },
      { do: "wait", s: 6, pose: "crouch", label: "look" },
    ];
    return !!this.task(e, p, [], steps);
  }

  /** Each check while a thing is lost and missed: anyone close to it may spot it, pick it up and hand it back. */
  private spotting(e: Episode): void {
    const h = this.host;
    const items = h.world.items;
    if (items.stateOf(e.item) !== "lost") return;
    const owner = h.people[e.cast[0]!]!;
    if (!owner.present || owner.gone) return;
    const at = { level: items.level[e.item]!, x: items.x[e.item]!, z: items.z[e.item]!, room: items.room[e.item]! };
    if (owner.level === at.level && owner.room === at.room && Math.hypot(owner.x - at.x, owner.z - at.z) < 1.5) return this.foundIt(e, owner, owner);
    for (const q of this.around(at, SPOT_NEAR, owner)) {
      if (!this.available(q, true) || q.role === "host") continue;
      const k = (e.stage === "given-up" ? 0.3 : 1) * (q.staff ? 1.5 : 1);
      if (!this.rng.chance(SPOT * k * (0.5 + q.traits.nosy))) continue;
      const s = h.pf.snap(at.level, at.x, at.z, 1.2);
      if (!s) continue;
      const to: Spot = { level: s.level, x: s.x, z: s.z, yaw: 0, room: at.room };
      if (
        this.task(
          e,
          q,
          [],
          [
            { do: "goto", to, label: "to-item" },
            { do: "wait", s: 2, pose: "crouch", label: "spot" },
            { do: "pick", item: e.item, label: "pick" },
            { do: "meet", who: owner.id, label: "to-owner" },
            { do: "give", item: e.item, who: owner.id, label: "give" },
          ],
        )
      ) {
        e.stage = "returning";
        h.gesture(q, "point", 2);
        return;
      }
    }
  }

  /** The owner has it again: spectacles back on, the bag on the arm, the earring in. */
  private foundIt(e: Episode, owner: Person, finder: Person): void {
    const h = this.host;
    const items = h.world.items;
    const k = items.kindOf(e.item);
    items.holder[e.item] = owner.id;
    items.set(e.item, k === "bag" ? "carried" : "worn", h.t);
    items.place(e.item, owner);
    if (k === "spectacles" && !owner.quirks.includes("glasses")) {
      owner.quirks.push("glasses");
      h.ident.refresh(owner);
    }
    h.turnedUp(e.item, items.room[e.item]!);
    this.stats.returned++;
    h.log(e.kind, finder === owner ? [owner.id] : [owner.id, finder.id], owner.room, `${e.what}:found`);
    if (finder !== owner) h.gesture(owner, "wave", 2);
    // The search is over, for the owner and anyone helping.
    for (const i of e.cast) {
      const q = h.people[i]!;
      const t = h.tasks.of(q);
      if (t && t.owner === q.id && this.taskEp.get(t.id) === e.id && q !== finder) h.tasks.finish(t, "done");
    }
    this.close(e);
  }

  /** Walking, a foot goes over: they sit a while, and limp for the rest of the night. */
  private ankle(p: Person, forced: boolean): boolean {
    const h = this.host;
    if ((!forced && p.pose !== "walk") || p.quirks.includes("limp") || p.path[p.pathIndex]?.climb) return false;
    p.quirks.push("limp");
    p.speed *= 0.75;
    h.ident.hurt[p.id] = 1;
    h.ident.refresh(p);
    h.gesture(p, "startle", 1);
    h.notable(p, "twisted-ankle", -1, 120);
    h.memory.observe(p.id, "twisted-ankle", p.id, -1, p.room);
    const e = this.ep("mishap", "ankle", [p], "sit", h.t + 15 * MIN, p.room);
    h.log("mishap", [p.id], p.room, "ankle");
    h.end(p, false);
    const secs = this.rng.range(240, 600);
    this.sitDown(e, p, secs, "ankle");
    return true;
  }

  /** Sit them on the nearest free seat, or have them stand still a while where they are. */
  private sitDown(e: Episode, p: Person, secs: number, note: string): void {
    const h = this.host;
    this.hold(p, secs + 30);
    const seat = h.seatNear(p, 12);
    if (seat) h.start(p, { id: "sit", target: seat.approach, seat, duration: secs, pose: "sit", gain: { rest: 0.6 }, note });
    if (p.action?.id !== "sit") this.task(e, p, [], [{ do: "wait", s: secs, pose: "crouch", label: note }]);
  }

  /** Hot, crowded or tipsy: a sit, a friend fanning them, then the terrace for air. */
  private faint(p: Person, near: number, forced: boolean): boolean {
    const h = this.host;
    if (!forced && near < 2 && p.tipsy < 0.5) return false;
    h.gesture(p, "startle", 1);
    h.notable(p, "fainted", -1, 120);
    h.memory.observe(p.id, "fainted", p.id, -1, p.room);
    const e = this.ep("mishap", "faint", [p], "sit", h.t + 15 * MIN, p.room);
    h.log("mishap", [p.id], p.room, "faint");
    h.end(p, false);
    this.sitDown(e, p, this.rng.range(120, 240), "faint");
    const f =
      this.friendOf(p, 15) ??
      this.nearest(
        this.around(p, 4, p).filter((q) => this.available(q)),
        p,
        4,
      );
    if (f)
      this.task(
        e,
        f,
        [],
        [
          { do: "meet", who: p.id, label: "to-friend" },
          { do: "wait", s: this.rng.range(60, 120), pose: "fan", label: "fan" },
        ],
      );
    return true;
  }

  /** A shoulder against the switch: the room goes dark for 10 to 30 s, and people inside put their arms out. */
  private leanOnSwitch(p: Person, forced: boolean): boolean {
    const h = this.host;
    const r = p.room;
    const sw = r >= 0 ? h.places.switches[r] : null;
    if (r < 0 || !h.world.lightOn[r] || (!forced && (!sw || sw.level !== p.level || Math.hypot(sw.x - p.x, sw.z - p.z) > SWITCH_NEAR || p.pose === "walk"))) return false;
    const secs = this.rng.range(10, 30);
    this.dark(r, 1);
    h.log("light", [p.id], r, "off");
    this.inTheDark(r, p.level, secs, 0.03);
    const e = this.ep("mishap", "switch", [p], "dark", h.t + secs, r);
    e.n = r;
    h.log("mishap", [p.id], r, "switch");
    return true;
  }

  /** The lights go out: arms out, heads turning, a little unease, and everyone there knows it went dark. */
  private inTheDark(room: number, level: number, secs: number, tension: number): void {
    const h = this.host;
    for (const q of h.people) {
      if (!q.present || q.level !== level || (room >= 0 && q.room !== room)) continue;
      if (room < 0 && (q.room < 0 || h.bp.rooms[q.room]!.level !== level)) continue;
      h.gesture(q, "grope", Math.min(secs, 6));
      const a = this.rng.range(-Math.PI, Math.PI);
      h.glance(q, q.x + Math.sin(a) * 3, q.z + Math.cos(a) * 3, 2);
      h.mood.witness(q.id, tension);
      h.memory.observe(q.id, "dark", -1, -1, q.room);
    }
  }

  /** A room switched off (+1) or back on (−1) for one reason; the light comes back when no reason is left. */
  private dark(room: number, d: 1 | -1): void {
    const w = this.host.world;
    this.darkN[room] = Math.max(0, this.darkN[room]! + d);
    if (d > 0) w.setLight(room, false);
    else if (!this.darkN[room]) w.setLight(room, true);
  }

  /** A tray goes over: a crash, glasses broken on the floor, and the one who dropped it sweeps up. */
  private dropTray(p: Person): boolean {
    const h = this.host;
    const items = h.world.items;
    if (p.item < 0 || items.kindOf(p.item) !== "tray") return false;
    const n = items.count[p.item]!;
    if (n <= 0) return false;
    items.count[p.item] = 0;
    const drink = items.drink[p.item]!;
    h.sound("dropped-tray", p, p.id);
    h.sound("breaking-glass", p, p.id);
    h.gesture(p, "startle", 1.5);
    const shards: number[] = [];
    for (let k = 0; k < Math.min(n, 6); k++) {
      const s = this.spotNear(p, 0.6) ?? p;
      const g = items.add("glass", "broken", -1, -1, s, h.t);
      items.drink[g] = drink;
      shards.push(g);
    }
    const e = this.ep("mishap", "tray", [p], "sweep", h.t + 10 * MIN, p.room);
    e.item = shards[0] ?? -1;
    h.log("mishap", [p.id], p.room, "tray");
    h.end(p, false);
    this.task(
      e,
      p,
      [],
      [
        { do: "wait", s: 3, pose: "stand", label: "dismay" },
        { do: "wait", s: this.rng.range(20, 40), pose: "crouch", label: "sweep" },
      ],
    );
    this.shards.set(e.id, shards);
    return true;
  }

  /** Broken things each episode leaves for a sweep. */
  private readonly shards = new Map<number, number[]>();

  /** Staff come over and sweep something up. */
  private sweep(e: Episode, at: { level: number; x: number; z: number; room: number }, things: number[], label: string, who?: Person | null): void {
    this.shards.set(e.id, [...(this.shards.get(e.id) ?? []), ...things]);
    const q = who === undefined ? this.staffNear(at, 30) : who;
    const s = q ? this.spotNear(at, 0.9, at) : null;
    if (!q || !s) return;
    this.task(
      e,
      q,
      [],
      [
        { do: "goto", to: s, label: "to-mess" },
        { do: "wait", s: this.rng.range(25, 45), pose: "crouch", label },
      ],
    );
  }

  /** Swept up: out of play. */
  private swept(e: Episode): void {
    const items = this.host.world.items;
    for (const i of this.shards.get(e.id) ?? []) items.set(i, "cleared", this.host.t);
    this.shards.delete(e.id);
  }

  // ------------------------------------------------------------- oddballs

  /** Oddballs' outings that are due: begun when they're free, let go when they never are. */
  private outings(): void {
    const h = this.host;
    for (const o of this.oddballs) {
      const k = this.outingNext[o.who]!;
      const at = o.at[k];
      if (at === undefined || h.t < at) continue;
      const p = h.people[o.who]!;
      if (h.t > at + OUTING_LATE || p.gone) {
        this.outingNext[o.who]!++;
        continue;
      }
      if (!p.present || !this.available(p)) continue;
      if (this.outing(p, o.habit as "creep" | "wanderer" | "snoop")) this.outingNext[o.who]!++;
    }
  }

  private outing(p: Person, habit: "creep" | "wanderer" | "snoop"): boolean {
    if (habit === "creep") return this.creep(p);
    if (habit === "wanderer") return this.wander(p);
    return this.snoop(p);
  }

  /** Stands too close behind someone for 10 to 30 s, or lingers by a bedroom door. */
  private creep(p: Person): boolean {
    const h = this.host;
    const still = (q: Person) =>
      q.action?.startedAt != null && ["mingle", "drink", "art", "use", "snack", "terrace", "sit", "dance", "games"].includes(q.action.id) && q.pose !== "sit" && q.pose !== "play";
    const targets = h.people.filter((q) => q !== p && q.present && !q.staff && q.id !== p.partner && q.level === p.level && still(q) && Math.hypot(q.x - p.x, q.z - p.z) < 25);
    const q =
      this.nearest(
        targets.filter((x) => x.look.sex !== p.look.sex),
        p,
        25,
      ) ?? this.nearest(targets, p, 25);
    if (q && this.rng.chance(0.85)) {
      const back = h.pf.snap(q.level, q.x - Math.sin(q.yaw) * 0.55, q.z - Math.cos(q.yaw) * 0.55, 0.3);
      if (back && h.pf.roomAt(back.level, back.x, back.z) === q.room) {
        const s: Spot = { level: back.level, x: back.x, z: back.z, yaw: q.yaw, room: q.room };
        const e = this.ep("habit", "creep", [p, q], "linger", h.t + 5 * MIN, q.room);
        if (
          this.task(
            e,
            p,
            [],
            [
              { do: "goto", to: s, label: "to-behind" },
              { do: "wait", s: 0, pose: "stand", label: "arrive" },
              { do: "wait", s: this.rng.range(10, 30), pose: "stand", label: "linger" },
            ],
          )
        )
          return true;
        this.close(e);
      }
    }
    // A bedroom door instead.
    const d = this.privateDoors(p)[0];
    const out = d ? h.tasks.outside(d.door, d.room) : null;
    if (!d || !out) return false;
    const e = this.ep("habit", "creep", [p], "door", h.t + 5 * MIN, out.room);
    if (
      this.task(
        e,
        p,
        [],
        [
          { do: "goto", to: out, label: "to-door" },
          { do: "wait", s: 0, pose: "stand", label: "arrive" },
          { do: "wait", s: this.rng.range(20, 40), pose: "look", label: "linger-door" },
        ],
      )
    )
      return true;
    this.close(e);
    return false;
  }

  /**
   * Doors into private rooms, nearest first, with the room each opens. Oddballs do their thing in
   * plain view, so a door off a room with people in it counts as nearer (6 m a person, up to 3).
   */
  private privateDoors(p: Person): Array<{ door: World["doors"][number]; room: number }> {
    const h = this.host;
    const out: Array<{ door: World["doors"][number]; room: number; d: number }> = [];
    const inRoom = new Int16Array(h.bp.rooms.length);
    for (const q of h.people) if (q !== p && q.present && q.room >= 0) inRoom[q.room]!++;
    for (const d of h.world.doors) {
      const room = d.rooms.find((r) => r >= 0 && PRIVATE.has(h.bp.rooms[r]!.type));
      const from = room === undefined ? -1 : h.world.otherSide(d, room);
      if (room === undefined || from < 0 || PRIVATE.has(h.bp.rooms[from]?.type ?? "corridor")) continue;
      const watched = Math.min(3, inRoom[from]!);
      out.push({ door: d, room, d: Math.hypot(d.x - p.x, d.z - p.z) + 12 * Math.abs(d.level - p.level) - 6 * watched + this.rng.range(0, 8) });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /** Off exploring without the host: two to four private doors tried in turn, peeking in where one gives. */
  private wander(p: Person): boolean {
    const h = this.host;
    const doors = this.privateDoors(p).slice(0, this.rng.int(2, 4));
    const steps: Step[] = [];
    for (const d of doors) {
      const out = h.tasks.outside(d.door, d.room);
      if (out) steps.push({ do: "goto", to: out, label: "to-door" }, { do: "wait", s: 3, pose: "rattle", label: `try:${d.door.id}:${d.room}` });
    }
    if (!steps.length) return false;
    const e = this.ep("habit", "wanderer", [p], "out", h.t + 15 * MIN, p.room);
    if (this.task(e, p, [], steps)) return true;
    this.close(e);
    return false;
  }

  /** Alone in a room with a desk or a cabinet: drawers opened and gone through for 5 to 10 s. */
  private snoop(p: Person): boolean {
    const h = this.host;
    const { bp, world } = h;
    const empty = (r: number) => !h.people.some((q) => q !== p && q.present && q.room === r);
    let best: { s: Spot; d: number } | null = null;
    for (const pr of bp.props) {
      if (!DRAWERS.has(pr.kind) || !pr.roomId) continue;
      const room = bp.rooms.find((r) => r.id === pr.roomId);
      if (!room || room.type === "bathroom" || room.type === "kitchen" || !h.pf.levels.has(room.level) || h.memory.familiarity(p.id, room.index) < KNOWN || !empty(room.index)) continue;
      if (p.room >= 0 && !world.reachable(p.room, room.index, p)) continue;
      const s = frontOf(h.pf, pr);
      if (!s) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z) + 12 * Math.abs(s.level - p.level) + this.rng.range(0, 6);
      if (!best || d < best.d) best = { s, d };
    }
    if (!best || best.d > 40) return false;
    const e = this.ep("habit", "snoop", [p], "go", h.t + 10 * MIN, best.s.room);
    if (
      this.task(
        e,
        p,
        [],
        [
          { do: "goto", to: best.s, label: "to-drawers" },
          { do: "wait", s: 0, pose: "stand", label: "arrive" },
          { do: "wait", s: this.rng.range(5, 10), pose: "serve", label: "rummage" },
        ],
      )
    )
      return true;
    this.close(e);
    return false;
  }

  /** Someone walked into a room: the nervous one there startles; the camera-shy one slips out ahead of the photographer. */
  entered(p: Person): void {
    const h = this.host;
    if (!p.present) return;
    for (const o of this.oddballs) {
      const q = h.people[o.who]!;
      if (q === p || !q.present || q.room !== p.room || q.level !== p.level || q.room === -1) continue;
      if (o.habit === "nervous") {
        if (h.t - this.startleAt[q.id]! < STARTLE_GAP || q.pose === "walk" || Math.hypot(q.x - p.x, q.z - p.z) > 10) continue;
        this.startleAt[q.id] = h.t;
        this.stats.startles++;
        h.gesture(q, "startle", 1);
        h.glance(q, p.x, p.z, 1.5);
        this.stepBack(q, p, 0.2);
        h.notable(q, "startled", p.id, 6);
        this.flash(q, "nervous", p);
      } else if (o.habit === "camera-shy" && p.role === "photographer" && this.available(q)) {
        const next = (h.world.graph[q.room] ?? []).filter((e) => e.to >= 0 && e.kind !== "stair").map((e) => e.to);
        const s = next.length ? h.cells.random(this.rng.pick(next), this.rng, 0.8) : null;
        if (!s) continue;
        h.end(q, false);
        h.start(q, { id: "wander", target: s, duration: this.rng.range(60, 120), pose: "look", gain: { curiosity: 0.1 } });
        h.notable(q, "camera-shy", p.id, 10);
        this.flash(q, "camera-shy", p);
      }
    }
  }

  /** A moment's habit (a startle, a turn from the camera): an episode of its own, seen or not. */
  private flash(q: Person, habit: Habit, other: Person): void {
    const e = this.ep("habit", habit, [q], "once", this.host.t + 4, q.room);
    e.cast.push(other.id);
    this.inEp[q.id] = e.id;
  }

  private stepBack(q: Person, from: { x: number; z: number }, m: number): void {
    const h = this.host;
    const d = Math.hypot(q.x - from.x, q.z - from.z) || 1;
    const s = h.pf.snap(q.level, q.x + ((q.x - from.x) / d) * m, q.z + ((q.z - from.z) / d) * m, 0.15);
    if (s && h.pf.roomAt(s.level, s.x, s.z) === q.room) {
      q.x = s.x;
      q.z = s.z;
    }
  }

  /** A camera flashed: the camera-shy one in the room turns away. */
  flashed(ph: Person): void {
    const h = this.host;
    for (const o of this.oddballs) {
      if (o.habit !== "camera-shy") continue;
      const q = h.people[o.who]!;
      if (q === ph || !q.present || q.level !== ph.level || q.room !== ph.room || Math.hypot(q.x - ph.x, q.z - ph.z) > 10) continue;
      if (q.pose !== "sit" && q.pose !== "walk") q.yaw = yawTo(ph.x, ph.z, q.x, q.z);
      h.glance(q, q.x + (q.x - ph.x), q.z + (q.z - ph.z), 2);
      h.notable(q, "camera-shy", ph.id, 10);
      this.flash(q, "camera-shy", ph);
    }
  }

  /** The group photo: the camera-shy slip out (half the time) or stand at the back. */
  forPhoto(who: Person[]): { who: Person[]; back: Set<number> } {
    const h = this.host;
    const back = new Set<number>();
    const out: Person[] = [];
    for (const q of who) {
      if (this.habit[q.id] !== "camera-shy") {
        out.push(q);
        continue;
      }
      const ph = h.people.find((x) => x.role === "photographer") ?? h.host;
      if (this.rng.chance(0.5)) {
        const next = q.room >= 0 ? (h.world.graph[q.room] ?? []).filter((e) => e.to >= 0 && e.kind !== "stair").map((e) => e.to) : [];
        const s = next.length ? h.cells.random(this.rng.pick(next), this.rng, 0.8) : null;
        if (s) {
          h.end(q, false);
          h.start(q, { id: "wander", target: s, duration: this.rng.range(120, 240), pose: "look", gain: { curiosity: 0.1 } });
        }
      } else {
        back.add(q.id);
        out.push(q);
      }
      h.notable(q, "camera-shy", ph.id, 30);
      this.flash(q, "camera-shy", ph);
    }
    return { who: out, back };
  }

  /** Someone came in at the front door: the stranger is greeted stiffly by the host; the latecomer's arrival is noticed. */
  arrived(p: Person): void {
    const h = this.host;
    if (this.habit[p.id] === "latecomer") {
      // In after the toast, with no champagne: out of step with the evening.
      this.ep("habit", "latecomer", [p], "in", h.t + 3 * MIN, p.room);
      h.notable(p, "out-of-step", -1, 3 * MIN);
      h.log("habit", [p.id], p.room, "latecomer");
    }
    if (p.id !== this.stranger) return;
    const s = this.slots.find((x) => x.card === "stranger" && x.state === "waiting");
    if (s) s.state = "played";
    const host = h.host;
    const e = this.ep("drama", "stranger", [p], "greet", h.t + 4 * MIN, p.room);
    h.log("drama", [p.id, host.id], p.room, "stranger");
    if (this.available(host, true))
      this.task(
        e,
        host,
        [],
        [
          { do: "meet", who: p.id, label: "to-stranger" },
          { do: "say", who: p.id, s: 4, pose: "shake", label: "stiff" },
        ],
      );
  }

  // ----------------------------------------------------------------- deck

  /** Cards whose time has come: played if someone fits, tried again later, or given up for the next card in the deck. */
  private deal(): void {
    const h = this.host;
    for (const s of [...this.slots]) {
      if (s.state !== "waiting" || h.t < s.at || s.card === "stranger") continue;
      if (this.play(s.card)) {
        s.state = "played";
        continue;
      }
      s.at = h.t + RETRY;
      if (s.at <= s.until) continue;
      s.state = "gone";
      this.stats.expired++;
      // The next card in the deck, if its window is still open.
      while (this.nextCard < this.deck.length) {
        const c = this.deck[this.nextCard++]!;
        if (c === "stranger") continue;
        const before = this.slots.length;
        this.slot(c, true);
        if (this.slots.length > before) {
          this.stats.dealt++;
          break;
        }
      }
    }
  }

  /** Play a card now, with whoever fits (the lab can name who). */
  play(card: CardId, who?: Person): boolean {
    switch (card) {
      case "quarrel":
        return this.quarrel(who);
      case "drunk":
        return this.drunk(who);
      case "tears":
        return this.tears(who);
      case "speech":
        return this.speech(who);
      case "earring":
        return this.earring(who);
      case "wine":
        return this.wine(who);
      case "bore":
        return this.bore(who);
      case "early":
        return this.early(who);
      case "stranger":
        return false;
      case "piano":
        return this.piano(who);
      case "photo":
        return this.photo(who);
      case "vase":
        return this.vase(who);
      case "fuse":
        return this.fuse(who);
    }
  }

  /** A guest picked by weight (a weighted draw over those who fit). */
  private choose(qs: Person[], w: (q: Person) => number): Person | null {
    const c = qs.map((q) => [q, Math.max(0, w(q))] as const).filter(([, v]) => v > 0);
    return c.length ? this.rng.weighted(c) : null;
  }

  /** Free guests present, not the host. */
  private freeGuests(): Person[] {
    return this.host.people.filter((q) => !q.staff && q.role !== "host" && this.available(q));
  }

  /**
   * A couple's quarrel: tension built of drink, unease and an eye for someone else; sharp words,
   * then one storms off to the terrace or a bathroom, and the other follows or stays. Later they
   * make up, or one goes home early.
   */
  private quarrel(who?: Person): boolean {
    const h = this.host;
    const n = h.people.length;
    let best: [Person, Person, number] | null = null;
    for (const a of who ? [who] : this.freeGuests()) {
      if (a.partner === null || (!who && a.partner < a.id)) continue;
      const b = h.people[a.partner]!;
      if (b.role === "host" || !this.available(b) || h.bonds.apart[a.id]) continue;
      const eye = (x: Person) => (h.people.some((q) => q.id !== x.partner && q !== x && h.bonds.flirtOf(x.id, q.id) >= 0.15) ? 0.5 : 0);
      const v = a.tipsy + b.tipsy + 2 * (h.mood.tension[a.id]! + h.mood.tension[b.id]!) + eye(a) + eye(b) + this.rng.range(0, 0.1);
      if ((who || v >= QUARREL_FROM) && (!best || v > best[2])) best = [a, b, v];
    }
    void n;
    if (!best) return false;
    const [x, y] = best[0].tipsy >= best[1].tipsy ? [best[0], best[1]] : [best[1], best[0]];
    const s = h.beside(y, x, 1.1);
    if (!s) return false;
    const len = this.rng.range(20, 40);
    h.end(x, false);
    h.end(y, false);
    h.start(x, { id: "row", target: s, duration: len, pose: "argue", gain: {}, ref: y.id, note: "quarrel" });
    h.start(y, { id: "row", target: null, duration: len + 40, pose: "argue", gain: {}, ref: x.id, note: "answer" });
    this.ep("drama", "quarrel", [x, y], "words", h.t + 10 * MIN, x.room);
    h.log("drama", [x.id, y.id], x.room, "quarrel");
    return true;
  }

  /** The quarrel's words are over (sim.ts): one storms off, the other follows or not; they'll keep apart a while. */
  quarrelOver(a: Person, b: Person): void {
    const h = this.host;
    const e = this.episodeOf(a);
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      h.notable(x, "row", y.id, 20);
      x.avoid.set(`person:${y.id}`, h.t + this.rng.range(10 * MIN, 20 * MIN));
      this.upsetAt[x.id] = h.t;
    }
    for (const o of this.around(a, 8, a)) if (o !== b) h.mood.witness(o.id, 0.1);
    if (!e || e.what !== "quarrel") return;
    const off = this.rng.chance(0.5) ? a : b;
    const other = off === a ? b : a;
    const bath = h.bathFor(off);
    if (bath >= 0 && this.rng.chance(0.4)) {
      h.end(off, false);
      h.start(off, { id: "toilet", target: h.places.bathrooms[bath]!.door, duration: this.rng.range(300, 480), pose: "wait", gain: { bladder: 1 }, ref: bath, note: "door" });
      h.log("drama", [off.id], off.room, "quarrel:bathroom");
    } else {
      h.stormOff(off, false);
      h.log("drama", [off.id], off.room, "quarrel:storms-off");
      if (this.rng.chance(0.4) && h.free(other))
        this.task(
          e,
          other,
          [],
          [
            { do: "meet", who: off.id, label: "after" },
            { do: "say", who: off.id, s: this.rng.range(15, 30), pose: "argue", label: "words" },
          ],
        );
    }
    e.stage = "apart";
    e.at = h.t + this.rng.range(10 * MIN, 25 * MIN);
  }

  /** A row (bonds.ts) or a quarrel: upset for a while (tears in the bathroom may follow). */
  upset(a: Person, b: Person): void {
    this.upsetAt[a.id] = this.host.t;
    this.upsetAt[b.id] = this.host.t;
  }

  /** One drink too many: loud, swaying, singing; friends steer them to a sofa, a waiter brings water; they doze, or are sent home. */
  private drunk(who?: Person): boolean {
    const h = this.host;
    const p = who ?? this.choose(this.freeGuests(), (q) => (q.tipsy >= DRUNK_FROM ? q.tipsy : 0));
    if (!p) return false;
    const e = this.ep("drama", "drunk", [p], "loud", h.t + 20 * MIN, p.room);
    h.log("drama", [p.id], p.room, "drunk");
    const steps: Step[] = [];
    if (p.tipsy < DRUNK) {
      const bar = [...h.places.bars].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) + 15 * Math.abs(a.level - p.level) - Math.hypot(b.x - p.x, b.z - p.z) - 15 * Math.abs(b.level - p.level))[0];
      if (bar) steps.push({ do: "goto", to: bar, label: "to-bar" }, { do: "wait", s: 30, pose: "drink", label: "shots" });
      else this.shots(p);
    }
    steps.push({ do: "wait", s: this.rng.range(60, 90), pose: "sing", label: "sing" });
    this.hold(p, 30 * MIN);
    if (!this.task(e, p, [], steps)) {
      this.close(e);
      return true;
    }
    return true;
  }

  /** Two quick whiskies. */
  private shots(p: Person): void {
    const h = this.host;
    for (let k = 0; k < 2; k++) {
      p.drinks++;
      p.drinkLog.push({ drink: "whisky", t: h.t });
      if (p.drinkLog.length > 24) p.drinkLog.shift();
    }
    p.tipsy = Math.min(1, Math.max(p.tipsy + 0.3, DRUNK + 0.03));
  }

  /** Tears in the bathroom after a quarrel or a row: the door stays shut, a friend knocks, they come out together. */
  private tears(who?: Person): boolean {
    const h = this.host;
    const p = who ?? this.choose(this.freeGuests(), (q) => (h.t - this.upsetAt[q.id]! < UPSET_FOR ? 1 + q.traits.nerves : h.mood.tension[q.id]! >= 0.25 && q.traits.nerves >= 0.55 ? 0.3 : 0));
    if (!p) return false;
    const b = h.bathFor(p);
    if (b < 0) return false;
    h.end(p, false);
    h.start(p, { id: "toilet", target: h.places.bathrooms[b]!.door, duration: this.rng.range(600, 900), pose: "wait", gain: { bladder: 1 }, ref: b, note: "door" });
    if (p.action?.id !== "toilet") return false;
    const e = this.ep("drama", "tears", [p], "inside", h.t + this.rng.range(120, 240), p.room);
    e.n = b;
    this.hold(p, 20 * MIN);
    h.log("drama", [p.id], p.room, "tears");
    return true;
  }

  /** The speech that runs long, at dinner: everyone looks one way; fidgeting, glances at watches, a partner's tug at the sleeve. */
  private speech(who?: Person): boolean {
    const h = this.host;
    const diners = h.people.filter((q) => q.present && q.action?.id === "dinner" && q.action.startedAt !== null && q.pose === "sit");
    const bonus = (q: Person) => (q.archetype === "bore" || q.archetype === "old-friend" || q.archetype === "life" || q.archetype === "honoree" ? 0.4 : 0);
    const p =
      who ??
      this.choose(
        diners.filter((q) => q.role !== "host" && !q.staff && q.traits.talk >= 0.6),
        (q) => q.traits.talk + q.tipsy + bonus(q),
      );
    if (!p || p.action?.id !== "dinner") return false;
    const secs = this.rng.range(90, 150);
    this.poseAs[p.id] = "announce";
    this.poseUntil[p.id] = h.t + secs;
    h.sound("clink", p, p.id);
    for (const q of diners) if (q !== p) h.glance(q, p.x, p.z, secs);
    const e = this.ep("drama", "speech", [p], "speaking", h.t + secs * 0.75, p.room);
    e.n = Math.round(secs);
    this.hold(p, secs);
    h.log("drama", [p.id], p.room, "speech");
    return true;
  }

  /** The lost earring: a search on hands and knees, friends crouching to help, until a waiter finds it. */
  private earring(who?: Person): boolean {
    const h = this.host;
    const p =
      who ??
      this.choose(
        this.freeGuests().filter((q) => q.look.sex === "f" && q.room >= 0),
        (q) => 0.5 + q.traits.clumsy,
      );
    if (!p || p.room === -1) return false;
    const items = h.world.items;
    const at = this.spotNear(p, 2.5) ?? p;
    const it = items.add("earring", "lost", p.id, -1, at, h.t);
    const e = this.ep("drama", "earring", [p], "search", h.t + this.rng.range(90, 240), p.room);
    e.item = it;
    h.gesture(p, "ask", 2);
    h.log("drama", [p.id], p.room, "earring");
    if (!this.search(e, p, true)) {
      this.close(e);
      items.set(it, "cleared", h.t);
      return false;
    }
    // Friends and those near get down to look too.
    const helpers = this.around(p, 6, p)
      .filter((q) => !q.staff && this.available(q))
      .sort((a, b) => (p.friends.includes(b.id) ? 1 : 0) - (p.friends.includes(a.id) ? 1 : 0))
      .slice(0, this.rng.int(1, 3));
    for (const q of helpers) {
      const s = this.spotNear(at, 1.6, at);
      if (s)
        this.task(
          e,
          q,
          [],
          [
            { do: "goto", to: s, label: "to-floor" },
            { do: "wait", s: this.rng.range(20, 40), pose: "crouch", label: "help" },
          ],
        );
    }
    return true;
  }

  /** Red wine on the carpet: waiters hurry over with cloths and salt, guests step aside, the host fusses. */
  private wine(who?: Person): boolean {
    const h = this.host;
    const items = h.world.items;
    const red = (q: Person) => q.item >= 0 && items.kindOf(q.item) === "glass" && items.drinkOf(q.item) === "red" && items.fill[q.item]! > 0.3;
    const p =
      who ??
      this.choose(
        this.freeGuests().filter((q) => red(q) && q.room >= 0 && this.crowdAround(q, 4) >= 3),
        (q) => 0.5 + q.traits.clumsy + q.tipsy,
      );
    if (!p || p.room === -1) return false;
    if (red(p)) {
      items.fill[p.item] = 0;
      h.setDown(p);
    }
    const st = items.add("stain", "down", -1, -1, p, h.t);
    h.gesture(p, "startle", 1.5);
    h.notable(p, "spill", -1, 60);
    const e = this.ep("drama", "wine", [p], "scrub", h.t + 10 * MIN, p.room);
    e.item = st;
    h.log("drama", [p.id], p.room, "wine");
    // Two waiters with cloths, the host fussing, and a ring of guests stepping back.
    const w1 = this.staffNear(p, 40);
    this.sweep(e, p, [st], "scrub", w1);
    const w2 = this.staffNear(p, 40, w1 ?? undefined);
    if (w2) this.sweep(e, p, [], "scrub", w2);
    const host = h.host;
    if (this.available(host, true)) {
      const s = this.spotNear(p, 1.6, p);
      if (s)
        this.task(
          e,
          host,
          [],
          [
            { do: "goto", to: s, label: "to-mess" },
            { do: "wait", s: 15, pose: "talk", label: "fuss" },
          ],
        );
      h.bonds.addGrudge(host.id, p.id, 0.1);
    }
    for (const q of this.around(p, 1.6, p)) {
      if (!this.available(q)) continue;
      const s = this.spotNear(p, 2.2, p);
      if (!s) continue;
      h.end(q, false);
      h.start(q, { id: "wander", target: s, duration: this.rng.range(20, 30), pose: "look", gain: {} });
    }
    for (const q of this.around(p, 8, p)) h.mood.witness(q.id, 0.02);
    return true;
  }

  /** The bore holds the floor; listeners glance away and peel off one by one with an excuse until the bore is alone. */
  private bore(who?: Person): boolean {
    const h = this.host;
    const circle = (q: Person) => {
      const a = q.action;
      const g = a?.id === "mingle" && a.note === "in" && a.startedAt !== null ? h.groups.get(a.ref ?? -1) : undefined;
      return g && g.members.filter((m) => m !== q.id && h.people[m]!.action?.startedAt != null).length >= 2 ? g : undefined;
    };
    const p =
      who ??
      this.choose(
        this.freeGuests().filter((q) => circle(q)),
        (q) => (q.archetype === "bore" ? 3 : q.traits.talk >= 0.85 && q.traits.social <= 0.5 ? 1 : 0),
      );
    const g = p ? circle(p) : undefined;
    if (!p || !g) return false;
    const e = this.ep("drama", "bore", [p, ...g.members.filter((m) => m !== p.id).map((m) => h.people[m]!)], "holding", h.t + this.rng.range(40, 90), g.room);
    e.n = g.id;
    this.hold(p, 10 * MIN);
    h.log("drama", [p.id], g.room, "bore");
    return true;
  }

  /** The early leaver: a call before dinner, a word with the host, out; at dinner a waiter clears their place. */
  private early(who?: Person): boolean {
    const h = this.host;
    const p =
      who ??
      this.choose(
        this.freeGuests().filter((q) => h.t - q.arriveAt > 10 * MIN && !h.memory.household[q.id] && q.id !== this.stranger),
        () => 1,
      );
    if (!p) return false;
    const e = this.ep("drama", "early", [p], "call", h.t + 20 * MIN, p.room);
    h.log("drama", [p.id], p.room, "early");
    if (!this.task(e, p, [], [{ do: "wait", s: this.rng.range(25, 40), pose: "phone", label: "call" }])) {
      this.close(e);
      return false;
    }
    return true;
  }

  /** Music round the piano: a guest plays and others gather to sing. */
  private piano(who?: Person): boolean {
    const h = this.host;
    const pianos = h.places.games.filter((g) => g.kind === "piano");
    const playing = h.people.find((q) => q.present && q.pose === "play" && q.action?.note === "piano");
    const near = (q: Person, g: (typeof pianos)[number]) => Math.hypot(g.spots[0]!.x - q.x, g.spots[0]!.z - q.z) + 15 * Math.abs(g.spots[0]!.level - q.level);
    const player = who ?? playing ?? this.choose(this.freeGuests(), (q) => (q.role === "pianist" ? 4 : q.fluency.piano >= 0.5 ? 1 : q.traits.talk >= 0.7 ? 0.2 : 0));
    if (!player || !pianos.length) return false;
    const g = [...pianos].sort((a, b) => near(player, a) - near(player, b))[0]!;
    const seat = g.spots[0]!;
    const secs = this.rng.range(180, 300);
    const singers = this.freeGuests()
      .filter((q) => q !== player && q.level === seat.level && Math.hypot(q.x - seat.x, q.z - seat.z) < 25)
      .sort((a, b) => b.traits.social + b.tipsy - (a.traits.social + a.tipsy) + 0.05 * (Math.hypot(a.x - seat.x, a.z - seat.z) - Math.hypot(b.x - seat.x, b.z - seat.z)))
      .slice(0, this.rng.int(3, 7));
    if (singers.length < 2) return false;
    const e = this.ep("drama", "piano", [player], "playing", h.t + secs + 60, g.room.index);
    if (player !== playing) {
      if (
        !this.task(
          e,
          player,
          [],
          [
            { do: "goto", to: seat, label: "to-piano" },
            { do: "wait", s: secs, pose: "play", label: "piano" },
          ],
        )
      ) {
        this.close(e);
        return false;
      }
    }
    singers.forEach((q, k) => {
      const a = seat.yaw + Math.PI * (0.35 + (0.3 * k) / Math.max(1, singers.length - 1)) * (k % 2 ? 1 : -1);
      const w = h.pf.snap(seat.level, seat.x + Math.sin(a) * 1.5, seat.z + Math.cos(a) * 1.5, 0.6);
      if (!w || h.pf.roomAt(w.level, w.x, w.z) !== seat.room) return;
      const s: Spot = { level: w.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, seat.x, seat.z), room: seat.room };
      this.task(
        e,
        q,
        [],
        [
          { do: "goto", to: s, label: "to-piano" },
          { do: "wait", s: secs, pose: "sing", label: "sing" },
        ],
      );
    });
    h.log("drama", [player.id, ...singers.map((q) => q.id)], g.room.index, "piano");
    return true;
  }

  /** An impromptu photo on the terrace: a guest lines up their friends with a phone; a flash. */
  private photo(who?: Person): boolean {
    const h = this.host;
    const terrace = h.places.terrace;
    const friendsOf = (q: Person) =>
      h.people.filter((x) => x !== q && (q.friends.includes(x.id) || x.id === q.partner) && this.available(x) && x.level === terrace[0]?.level && Math.hypot(x.x - q.x, x.z - q.z) < 25);
    const p =
      who ??
      this.choose(
        this.freeGuests().filter((q) => friendsOf(q).length >= 2),
        (q) => (q.room === -2 ? 2 : 0.5) + q.traits.social,
      );
    if (!p || !terrace.length) return false;
    const foot = this.rng.pick(terrace);
    const who2 = friendsOf(p).slice(0, 6);
    const { who: line, back } = this.forPhoto(who2);
    if (line.length < 2) return false;
    const t = h.tasks.groupPhoto(p, foot, foot.yaw, line, { impromptu: true, back });
    if (!t || t.outcome !== null) return false;
    const e = this.ep("drama", "photo", [p, ...line], "line-up", h.t + 6 * MIN, -2);
    this.taskEp.set(t.id, e.id);
    for (const q of [p, ...line]) this.inEp[q.id] = e.id;
    p.held = "camera";
    p.heldUntil = h.t + 99999;
    h.log("drama", [p.id, ...line.map((q) => q.id)], -2, "photo");
    return true;
  }

  /** A broken vase: someone backs into a stand, a smash, the host upset, staff sweeping up. */
  private vase(who?: Person): boolean {
    const h = this.host;
    const party = new Set(h.places.mingleRooms);
    const p =
      who ??
      this.choose(
        this.freeGuests().filter((q) => party.has(q.room) && q.pose !== "sit" && q.pose !== "walk"),
        (q) => 0.3 + q.traits.clumsy + q.tipsy,
      );
    if (!p || p.room === -1) return false;
    const at = this.spotNear(p, 0.7) ?? p;
    const items = h.world.items;
    const shards = items.add("shards", "broken", -1, -1, at, h.t);
    h.sound("smash", at, p.id);
    h.gesture(p, "startle", 1.5);
    h.notable(p, "broke", -1, 120);
    h.memory.observe(p.id, "broke", p.id, -1, p.room);
    const e = this.ep("drama", "vase", [p], "sweep", h.t + 10 * MIN, p.room);
    e.item = shards;
    h.log("drama", [p.id], p.room, "vase");
    const host = h.host;
    if (this.available(host, true)) {
      this.task(
        e,
        host,
        [],
        [
          { do: "meet", who: p.id, label: "to-culprit" },
          { do: "say", who: p.id, s: 6, pose: "talk", label: "upset" },
        ],
      );
      h.bonds.addGrudge(host.id, p.id, 0.15);
    }
    this.sweep(e, at, [shards], "sweep");
    return true;
  }

  /** The fuse: the band's amplifier blows it, and the dance floor's whole storey goes dark for 20 to 40 s. */
  private fuse(who?: Person): boolean {
    const h = this.host;
    const level = who ? who.level : h.places.danceRoom?.level;
    if (level === undefined || (!who && h.phaseId !== "dancing")) return false;
    const secs = this.rng.range(20, 40);
    const rooms = h.bp.rooms.filter((r) => r.level === level && h.world.lightOn[r.index]).map((r) => r.index);
    if (!rooms.length) return false;
    for (const r of rooms) this.dark(r, 1);
    // The band stops; the dancers stand.
    for (const q of h.people) {
      if (!q.present || q.level !== level) continue;
      if (q.pose === "play" || q.pose === "dance" || q.pose === "slow" || q.pose === "front" || q.pose === "behind") {
        this.poseAs[q.id] = "stand";
        this.poseUntil[q.id] = h.t + secs;
      }
    }
    this.inTheDark(-1, level, secs, 0.05);
    const e = this.ep("drama", "fuse", [], "dark", h.t + secs, h.places.danceRoom?.index ?? rooms[0]!);
    e.n = level;
    this.fused.set(e.id, rooms);
    e.seen = h.people.some((q) => q.present && q.level === level);
    h.log("drama", [], e.room, "fuse");
    return true;
  }

  /** Rooms each blackout put out. */
  private readonly fused = new Map<number, number[]>();

  // ----------------------------------------------------------- beats

  /** Something to do every check while an episode runs. */
  private during(e: Episode): void {
    const h = this.host;
    if (e.what === "bore" && e.stage === "holding") {
      const g = h.groups.get(e.n);
      const p = h.people[e.cast[0]!]!;
      if (!g || !g.members.includes(p.id)) return this.boreDone(e, "bore:moved-on");
      g.speaker = p.id;
      g.speakerUntil = h.t + CHECK + 1;
      // Eyes elsewhere.
      const listeners = g.members.filter((m) => m !== p.id);
      if (listeners.length) {
        const q = h.people[this.rng.pick(listeners)]!;
        const a = this.rng.range(-Math.PI, Math.PI);
        h.glance(q, q.x + Math.sin(a) * 4, q.z + Math.cos(a) * 4, 3);
      }
    } else if (e.what === "drunk" && e.stage === "loud") {
      const p = h.people[e.cast[0]!]!;
      if (p.action?.note === "sing") {
        h.sound("raised-voice", p, p.id);
        if (this.rng.chance(0.5)) h.gesture(p, "wave", 2);
        h.notable(p, "drunk", -1, 30);
      }
    } else if (e.what === "speech" && e.stage === "speaking") {
      // Fidgeting at table: a glance at a watch, a whisper.
      const diners = h.people.filter((q) => q.present && q.action?.id === "dinner" && q.pose === "sit" && !e.cast.includes(q.id));
      for (let k = 0; k < Math.min(diners.length, this.rng.int(1, 3)); k++) h.gesture(this.rng.pick(diners), this.rng.chance(0.6) ? "watch" : "lean", 2);
    } else if (e.what === "piano" && this.rng.chance(0.3)) {
      const p = h.people[e.cast[0]!]!;
      if (p.pose === "play") h.sound("laugh", p, p.id);
    }
  }

  /** An episode's timed beat. */
  private beat(e: Episode): void {
    const h = this.host;
    const p = h.people[e.cast[0]!];
    switch (e.what) {
      case "lost":
        if (e.stage === "unnoticed") {
          if (!p || p.gone) return this.close(e);
          if (!this.available(p)) {
            e.at = h.t + MIN;
            return;
          }
          if (!this.search(e, p, true)) {
            e.at = h.t + MIN;
            return;
          }
          e.stage = "search";
          e.n = 0;
          e.at = h.t + 30 * MIN;
          h.gesture(p, "shrug", 2);
          h.log("mishap", [p.id], p.room, "lost:search");
          return;
        }
        return this.close(e);
      case "switch":
        this.dark(e.n, -1);
        h.log("light", [e.cast[0]!], e.n, "on");
        if (p) h.gesture(p, "shrug", 2);
        return this.close(e);
      case "fuse":
        for (const r of this.fused.get(e.id) ?? []) this.dark(r, -1);
        this.fused.delete(e.id);
        h.log("drama", [], e.room, "fuse:on");
        return this.close(e);
      case "quarrel":
        if (e.stage === "apart" && p) return this.makeUp(e);
        return this.close(e);
      case "tears":
        if (e.stage === "inside" && p) return this.knock(e, p);
        return this.close(e);
      case "speech":
        if (e.stage === "speaking" && p) {
          // Near the end, the partner's tug at the sleeve.
          const q = p.partner !== null ? h.people[p.partner] : undefined;
          if (q?.action?.id === "dinner") h.gesture(q, "pull", 2);
          e.stage = "end";
          e.at = h.t + e.n * 0.25;
          return;
        }
        if (p) h.log("drama", [p.id], p.room, "speech:end");
        return this.close(e);
      case "bore":
        return this.peelOff(e);
      case "earring":
        if (e.stage === "search" && p) return this.waiterFinds(e, p);
        if (e.stage === "search") return this.close(e);
        e.at = h.t + 5 * MIN;
        return;
      case "early":
        if (e.stage === "gone") return this.clearPlace(e, p);
        return this.close(e);
      default:
        return this.close(e);
    }
  }

  /** After the quarrel: a hug and they're made up, or one goes home, or they stay cool. */
  private makeUp(e: Episode): void {
    const h = this.host;
    const [a, b] = e.cast.map((i) => h.people[i]!) as [Person, Person];
    const here = (q: Person) => q.present && !q.gone;
    // Either still caught up in something: a little later (three times at most).
    if (here(a) && here(b) && (!this.available(a) || !this.available(b)) && e.n < 3) {
      e.n++;
      e.at = h.t + 2 * MIN;
      return;
    }
    if (here(a) && here(b) && this.available(a) && this.available(b) && this.rng.chance(0.6)) {
      const s = h.beside(b, a, 0.7);
      if (s) {
        a.avoid.delete(`person:${b.id}`);
        b.avoid.delete(`person:${a.id}`);
        h.end(a, false);
        h.end(b, false);
        h.start(a, { id: "row", target: s, duration: 4, pose: "hug", gain: { social: 0.3 }, ref: b.id, note: "hug" });
        h.start(b, { id: "row", target: null, duration: 44, pose: "hug", gain: { social: 0.3 }, ref: a.id, note: "answer" });
        h.log("drama", [a.id, b.id], a.room, "quarrel:made-up");
        return this.close(e);
      }
    }
    if (here(a) && here(b) && this.rng.chance(0.3)) {
      const q = a.traits.nerves >= b.traits.nerves ? a : b;
      if (h.free(q)) {
        h.goHome(q, false);
        h.log("drama", [q.id], q.room, "quarrel:home");
        return this.close(e);
      }
    }
    h.log("drama", [a.id, b.id], a.room, "quarrel:cool");
    this.close(e);
  }

  /** A friend comes to the shut bathroom door and knocks. */
  private knock(e: Episode, p: Person): void {
    const h = this.host;
    if (p.action?.id !== "toilet") return this.close(e);
    const f = this.friendOf(p, 40);
    const bath = h.places.bathrooms[e.n];
    e.stage = "knock";
    e.at = h.t + 15 * MIN;
    if (!f || !bath) return;
    this.task(
      e,
      f,
      [],
      [
        { do: "goto", to: bath.door, label: "to-door" },
        { do: "wait", s: 4, pose: "knock", label: "knock" },
        { do: "wait", s: this.rng.range(60, 120), pose: "wait", label: "wait-door" },
      ],
    );
  }

  /** A waiter on their round spots the earring and brings it back. */
  private waiterFinds(e: Episode, p: Person): void {
    const h = this.host;
    const items = h.world.items;
    if (items.stateOf(e.item) !== "lost") return;
    const at = { level: items.level[e.item]!, x: items.x[e.item]!, z: items.z[e.item]!, room: items.room[e.item]! };
    const w = h.people.filter((q) => q.role === "waiter" && this.available(q, true));
    const q = this.nearest(w, at, 60);
    const s = h.pf.snap(at.level, at.x, at.z, 1.2);
    if (!q || !s) {
      e.at = h.t + MIN;
      return;
    }
    const to: Spot = { level: s.level, x: s.x, z: s.z, yaw: 0, room: at.room };
    if (
      this.task(
        e,
        q,
        [],
        [
          { do: "goto", to, label: "to-item" },
          { do: "wait", s: 3, pose: "crouch", label: "spot" },
          { do: "pick", item: e.item, label: "pick" },
          { do: "meet", who: p.id, label: "to-owner" },
          { do: "give", item: e.item, who: p.id, label: "give" },
        ],
      )
    ) {
      e.stage = "returning";
      e.at = h.t + 10 * MIN;
    } else e.at = h.t + MIN;
  }

  /** One of the bore's listeners peels off with an excuse: a look at the watch, an empty glass. */
  private peelOff(e: Episode): void {
    const h = this.host;
    const p = h.people[e.cast[0]!]!;
    const g = h.groups.get(e.n);
    if (!g || !g.members.includes(p.id)) return this.boreDone(e, "bore:moved-on");
    const left = g.members.filter((m) => m !== p.id).map((m) => h.people[m]!);
    if (!left.length) return this.boreDone(e, "bore:alone");
    const q = this.rng.pick(left);
    h.gesture(q, q.held ? "shrug" : "watch", 2);
    h.end(q, false);
    q.avoid.set(`person:${p.id}`, h.t + 20 * MIN);
    h.log("drama", [q.id, p.id], g.room, "bore:escape");
    e.at = h.t + this.rng.range(40, 90);
  }

  private boreDone(e: Episode, note: string): void {
    const p = this.host.people[e.cast[0]!]!;
    this.busyUntil[p.id] = 0;
    this.host.log("drama", [p.id], p.room, note);
    this.close(e);
  }

  /** At dinner, a waiter clears the early leaver's place. */
  private clearPlace(e: Episode, p: Person | undefined): void {
    const h = this.host;
    const seat = p?.seat !== null && p?.seat !== undefined ? h.places.diningSeats[p.seat] : undefined;
    if (h.phaseId !== "dinner") {
      e.at = h.t + MIN;
      if (h.t > h.programme[P.dinner]!.end) this.close(e);
      return;
    }
    const w = seat ? this.staffNear(seat.approach, 60) : null;
    if (seat && w)
      this.task(
        e,
        w,
        [],
        [
          { do: "goto", to: seat.approach, label: "to-place" },
          { do: "wait", s: 8, pose: "serve", label: "clear-place" },
        ],
      );
    e.stage = "cleared";
    e.at = h.t + 5 * MIN;
  }

  // ------------------------------------------------------------- hooks

  /** A task step finished (tasks.ts, through the party). */
  stepDone(t: Task, p: Person, st: Step): void {
    const k = this.taskEp.get(t.id);
    if (k === undefined) return;
    const e = this.episodes[k]!;
    const h = this.host;
    const label = st.label;
    if (label === "change") {
      p.look.color = LOAN[p.look.sex];
      p.stain = null;
      this.borrowed[p.id] = 1;
      h.ident.refresh(p);
      this.stats.changed++;
      h.log("mishap", [p.id], p.room, "spill:changed");
    } else if (label === "dress") {
      const v = st.do === "say" ? h.people[st.who]! : p;
      if (e.what === "cut") this.dressed(e, v, p);
    } else if (label === "look" && e.item >= 0) this.looked(e, t, p);
    else if (label === "give" && e.item >= 0 && st.do === "give") {
      const owner = h.people[st.who]!;
      this.foundIt(e, owner, p);
    } else if (label === "shots") {
      this.shots(p);
    } else if (label === "sing" && e.what === "drunk") {
      this.steer(e, p);
    } else if (label === "call" && e.what === "early") {
      p.early = "called away";
      h.goHome(p, false);
      e.stage = "gone";
      e.at = h.programme[P.dinner]!.start + 30;
      h.log("drama", [p.id], p.room, "early:leaves");
    } else if (label === "knock" && e.what === "tears") {
      const q = h.people[e.cast[0]!]!;
      h.sound("knock", p, p.id, e.n);
      h.memory.observe(p.id, "crying", q.id, -1, q.room);
    } else if (label === "wait-door" && e.what === "tears") {
      // They open up and come out together.
      const q = h.people[e.cast[0]!]!;
      if (q.action?.id === "toilet") h.end(q, true);
      t.steps.push({ do: "meet", who: q.id, label: "to-friend" }, { do: "say", who: q.id, s: 8, pose: "hug", label: "comfort" });
    } else if (label === "comfort") {
      this.close(e);
    } else if (label === "arrive") this.arrive(e, t, p);
    else if (label === "linger" && e.what === "creep") this.noticed(e, p);
    else if (label.startsWith("try:")) this.tryDoor(t, p, label);
    else if (label === "rummage") h.log("habit", [p.id], p.room, "snoop");
    // Seen coming out of someone's bedroom.
    else if (label.startsWith("peek-out:")) h.notable(p, "left-bedroom", -1, 8, Number(label.slice(9)));
    else if ((label === "sweep" || label === "scrub") && !e.done) {
      this.swept(e);
      if (e.what === "tray" || e.what === "vase" || e.what === "wine") this.close(e);
    } else if (label === "stiff") {
      h.gesture(h.host, "frown", 1);
      this.close(e);
    } else if (label === "clear-place") this.close(e);
  }

  /** A task an episode ran has ended, however it went. */
  finished(t: Task): void {
    const k = this.taskEp.get(t.id);
    if (k === undefined) return;
    this.taskEp.delete(t.id);
    const e = this.episodes[k]!;
    const h = this.host;
    const p = h.people[t.owner]!;
    if (t.kind === "photo") {
      if (p.held === "camera") p.held = null;
      return this.close(e);
    }
    if (e.done) return;
    // Something carried that never got where it was going is set down there.
    const items = h.world.items;
    if (e.item >= 0 && items.holder[e.item] === p.id && items.stateOf(e.item) === "carried") {
      items.holder[e.item] = -1;
      items.set(e.item, "lost", h.t);
      items.place(e.item, p);
      e.stage = "given-up";
    }
    if ((e.what === "spill" && e.cast[0] === p.id) || (e.what === "ankle" && t.what === "ankle") || e.what === "photo") this.close(e);
    if (e.what === "cut" && p.id !== e.cast[0] && t.outcome !== "done") {
      // The kit never came: they see to it themselves.
      const v = h.people[e.cast[0]!]!;
      if (v.present && !v.bandage) this.selfDress(e, v);
    }
    if (e.kind === "habit") this.close(e);
  }

  /** No one came with the kit: dress it oneself, fumbling. */
  private selfDress(e: Episode, v: Person): void {
    const h = this.host;
    if (h.tasks.of(v) && this.taskEp.get(h.tasks.of(v)!.id) === e.id) h.tasks.finish(h.tasks.of(v)!, "done");
    const kit = this.kit();
    const steps: Step[] = [];
    const at = kit >= 0 ? this.kitSpot(kit) : null;
    if (kit >= 0 && at) steps.push({ do: "goto", to: at, label: "to-kit" }, { do: "pick", item: kit, label: "pick" });
    steps.push({ do: "wait", s: DRESS.other, pose: "serve", label: "dress" });
    e.stage = "self";
    if (!this.task(e, v, [], steps)) this.close(e);
  }

  /** Someone's action ended (the party's end()). */
  ended(p: Person, a: ActionState): void {
    const k = this.inEp[p.id]!;
    if (k < 0) return;
    const e = this.episodes[k]!;
    if (e.done) return;
    const h = this.host;
    if (e.what === "cut" && a.id === "toilet" && e.cast[0] === p.id && e.stage === "wash") {
      // Out of the bathroom: wait for the kit, or see to it oneself.
      e.stage = "await";
      const carrier = e.cast
        .slice(1)
        .map((i) => h.people[i]!)
        .find((q) => this.taskOf(e, q));
      const ct = carrier ? this.taskOf(e, carrier) : undefined;
      if (ct && ct.steps[ct.i]?.label === "await") h.tasks.next(ct);
      if (ct) p.thinkAt = h.t + 20;
      else p.thinkAt = h.t + 5;
      this.pending.push({ e: e.id, who: p.id, carrier: !!ct });
    } else if (e.what === "faint" && a.id === "sit" && a.note === "faint" && e.cast[0] === p.id) {
      // Out for some air.
      const s = h.places.terrace.length ? this.rng.pick(h.places.terrace) : null;
      if (s) {
        p.thinkAt = h.t + 1;
        this.pending.push({ e: e.id, who: p.id, carrier: false, air: s });
      } else this.close(e);
    } else if (e.what === "drunk" && a.id === "sit" && a.note === "doze" && e.cast[0] === p.id) {
      this.busyUntil[p.id] = 0;
      if (this.rng.chance(0.3) && p.present && !p.gone) {
        p.thinkAt = h.t + 1;
        this.pending.push({ e: e.id, who: p.id, carrier: false, home: true });
      } else this.close(e);
    } else if (e.what === "ankle" && a.id === "sit" && a.note === "ankle") this.close(e);
    else if (e.what === "tears" && a.id === "toilet" && e.cast[0] === p.id) {
      h.notable(p, "crying", -1, 5 * MIN);
      this.busyUntil[p.id] = 0;
      if (e.stage !== "knock") this.close(e);
    }
  }

  /** Follow-ups to an action ending, started outside the party's end() (so nothing is started while one ends). */
  private pending: Array<{ e: number; who: number; carrier: boolean; air?: Spot; home?: boolean }> = [];

  /** Every step: follow-ups queued while an action ended. */
  afterStep(): void {
    if (!this.pending.length) return;
    const h = this.host;
    const due = this.pending;
    this.pending = [];
    for (const d of due) {
      const e = this.episodes[d.e]!;
      const p = h.people[d.who]!;
      if (e.done || !p.present || p.gone) continue;
      if (d.air) {
        h.end(p, false);
        h.start(p, { id: "terrace", target: d.air, duration: this.rng.range(300, 600), pose: "stand", gain: { air: 0.8, rest: 0.3 } });
        this.close(e);
      } else if (d.home) {
        h.goHome(p, false);
        h.log("drama", [p.id], p.room, "drunk:home");
        this.close(e);
      } else if (d.carrier) {
        h.end(p, false);
        this.task(e, p, [], [{ do: "wait", s: 4 * MIN, pose: "wait", label: "await-kit" }]);
      } else this.selfDress(e, p);
    }
  }

  /** At the end of a crouch to look: there it is, or ask round and try somewhere else (up to LOOKS places). */
  private looked(e: Episode, t: Task, p: Person): void {
    const h = this.host;
    const items = h.world.items;
    if (items.stateOf(e.item) !== "lost" || p.id !== e.cast[0]) return;
    const room = items.room[e.item]!;
    if (p.level === items.level[e.item] && p.room === room && Math.hypot(items.x[e.item]! - p.x, items.z[e.item]! - p.z) < 3) return this.foundIt(e, p, p);
    e.n++;
    // A bag nobody can find: something of theirs gone (register.ts), with nobody to blame yet.
    if (e.n === 1 && items.kindOf(e.item) === "bag") h.missing(p, e.item, room);
    if (e.n >= LOOKS) {
      e.stage = "given-up";
      h.gesture(p, "shrug", 2);
      h.log(e.kind, [p.id], p.room, `${e.what}:given-up`);
      return;
    }
    const a = h.answerer(p);
    let next = -1;
    if (a) {
      h.gesture(p, "ask", 2);
      h.glance(a, p.x, p.z, 2);
      // Someone who was there points the way.
      const n = h.people.length;
      if (h.memory.lastRoom[a.id * n + p.id] === room || a.room === room) {
        h.gesture(a, "point", 2);
        next = room;
      } else h.gesture(a, "shrug", 2);
    }
    if (next < 0) next = this.rng.chance(0.4) ? room : this.rng.pick(h.places.mingleRooms.length ? h.places.mingleRooms : [room]);
    const s = h.cells.random(next, this.rng, 0.6);
    if (s) t.steps.push({ do: "goto", to: s, label: "to-look" }, { do: "wait", s: 6, pose: "crouch", label: "look" });
  }

  /** At the drawers, the bedroom door or behind someone: what they do there is seen while they do it. */
  private arrive(e: Episode, t: Task, p: Person): void {
    const h = this.host;
    if (e.what === "snoop") {
      // Not alone after all: they think better of it.
      if (h.people.some((q) => q !== p && q.present && q.room === p.room && q.level === p.level)) {
        h.tasks.finish(t, "done");
        return;
      }
      h.notable(p, "snooping", -1, 12, p.room);
    } else if (e.what === "creep") {
      const q = e.cast[1] !== undefined ? h.people[e.cast[1]] : undefined;
      h.notable(p, "hovering", q?.id ?? -1, 40);
      h.log("habit", q ? [p.id, q.id] : [p.id], p.room, q ? "creep" : "creep:door");
    }
  }

  /** The creep's target turns round: a slap (loud and juicy), or a frown and a step away. */
  private noticed(e: Episode, p: Person): void {
    const h = this.host;
    const q = e.cast[1] !== undefined ? h.people[e.cast[1]]! : null;
    if (!q || !q.present || Math.hypot(q.x - p.x, q.z - p.z) > 1.5 || !this.rng.chance(0.3 + 0.4 * q.traits.nosy)) return;
    // The one they stood behind saw it, if nobody else did.
    if (!e.seen) {
      e.seen = true;
      this.habitSeen[p.id]!++;
    }
    h.glance(q, p.x, p.z, 2);
    h.bonds.addGrudge(q.id, p.id, 0.2);
    if (this.rng.chance(CREEP_SLAP)) {
      h.gesture(q, "slap", 1.5);
      h.sound("slap", q, q.id);
      h.notable(p, "slapped", q.id, 30);
      this.stats.slaps++;
      h.log("habit", [p.id, q.id], p.room, "creep:slapped");
    } else {
      h.gesture(q, "frown", 1.5);
      this.stepBack(q, p, 0.4);
      h.log("habit", [p.id, q.id], p.room, "creep:noticed");
    }
  }

  /** The wanderer at a private door: a rattle when it's locked, a peek inside when it gives. */
  private tryDoor(t: Task, p: Person, label: string): void {
    const h = this.host;
    const [, d, r] = label.split(":").map(Number) as [number, number, number];
    const door = h.world.doors[d];
    if (!door) return;
    if (!h.world.canPass(door, p)) {
      h.sound("rattle", { level: door.level, x: door.x, z: door.z, room: p.room }, p.id);
      h.notable(p, "locked-door", d, 10);
      this.stats.rattles++;
      h.log("habit", [p.id], p.room, "wanderer:rattle");
      return;
    }
    const inside = h.cells.random(r, this.rng, 0.8);
    if (!inside) return;
    t.steps.splice(
      t.i + 1,
      0,
      { do: "goto", to: inside, label: "peek-in" },
      { do: "wait", s: this.rng.range(4, 8), pose: "look", label: "peek" },
      { do: "goto", to: t.steps[t.i - 1]?.do === "goto" ? (t.steps[t.i - 1] as { to: Spot }).to : inside, label: `peek-out:${r}` },
    );
    h.log("habit", [p.id], r, "wanderer:peek");
  }

  /** After the singing: a friend steers them to a sofa or outside, a waiter brings water, and they doze. */
  private steer(e: Episode, p: Person): void {
    const h = this.host;
    e.stage = "steered";
    const f = this.friendOf(p, 25) ?? (this.available(h.host, true) ? h.host : null);
    const seat = h.seatNear(p, 20);
    const w = this.staffNear(p, 30);
    const bar = h.places.bars[0];
    if (w && bar) h.tasks.errand("drink", w, p, -1, bar, p, "water");
    if (f && seat) {
      if (
        this.task(
          e,
          f,
          [p],
          [
            { do: "meet", who: p.id, label: "to-drunk" },
            { do: "goto", to: seat.approach, label: "steer" },
            { do: "wait", s: 3, pose: "talk", label: "settle" },
          ],
          0.8,
        )
      ) {
        h.log("drama", [f.id, p.id], p.room, "drunk:steered");
      }
    }
    // When they get there (or straight away, with nobody to steer them), they doze.
    this.dozeAt.set(p.id, f && seat ? -1 : h.t);
  }

  /** The drunk guest sits down to doze once steered there (-1 while still on the way). */
  private readonly dozeAt = new Map<number, number>();

  /** Every check after the dramas' own step: a drunk guest no longer being steered sits down to doze. */
  settle(): void {
    const h = this.host;
    for (const [i, at] of [...this.dozeAt]) {
      const p = h.people[i]!;
      const steered = h.tasks.of(p)?.kind === "drama";
      if (at < 0 && steered) continue;
      this.dozeAt.delete(i);
      if (!p.present || p.gone) continue;
      const e = this.episodeOf(p);
      h.end(p, false);
      const seat = h.seatNear(p, 12);
      if (seat) h.start(p, { id: "sit", target: seat.approach, seat, duration: this.rng.range(15 * MIN, 25 * MIN), pose: "sit", gain: { rest: 0.8 }, note: "doze" });
      if (p.action?.id !== "sit" && e) this.close(e);
    }
  }
}
