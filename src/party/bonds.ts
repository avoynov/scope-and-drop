/**
 * Ties that form and break during the evening (milestone 2 technical plan: Bonds and
 * relationships): chemistry and affinity between every pair, flirting that can become a couple,
 * friendships that grow from talk, an affair now and then and the partner finding out, grudges
 * that boil over into rows, friends falling out and making up, friends drawing friends onto the
 * dance floor, and a tipsy couple slipping away to a bedroom.
 *
 * Everything is n × n typed arrays filled at construction from the `bonds` stream. Growth runs
 * every four steps over the pairs the mood already finds (within 3 m in the same room), so it
 * costs nothing new; fading is worked out lazily when a pair next meets. The rest is driven by
 * what other systems see and log: a sighting (senses.ts), a bump (body.ts), a fact told
 * (memory.ts), a game ending (games at a table).
 */
import type { Rng } from "../mansion/core/rng";
import type { PhaseId } from "./clock";
import type { Ident, Tie } from "./ident";
import { PHASE_WEIGHTS, type Candidate } from "./mind";
import { SLOTS, VERBS, type Memory, type Verb } from "./memory";
import type { Mood } from "./mood";
import type { Sight } from "./sight";
import type { SoundKind } from "./senses";
import type { Gesture, PartyEvent, Person, Spot } from "./types";

const MIN = 60;

/** Growth runs every this many steps (2 in-game s). */
export const BOND_EVERY = 4;

// ------------------------------------------------------------------ growth

/** Flirting and friendship grow by r × (chemistry or affinity) × closeness × activity × … per in-game minute. */
const R_FLIRT = 0.14;
const R_FRIEND = 0.07;
/** Closeness by distance (m): within 0.6, 1.2 and 2.5. */
const CLOSE: readonly (readonly [number, number])[] = [
  [0.6, 1],
  [1.2, 0.7],
  [2.5, 0.35],
];
/** What a pair is doing together, and how much each kind of bond grows from it. */
type Activity = "dance" | "talk" | "seat" | "bar" | "game" | "near";
const FLIRT_W: Record<Activity, number> = { dance: 1, talk: 0.7, seat: 0.25, bar: 0.5, game: 0.3, near: 0.08 };
const FRIEND_W: Record<Activity, number> = { dance: 0.5, talk: 1, seat: 0.8, bar: 0.6, game: 0.8, near: 0.08 };
/** A friend in common in the same circle makes friendship come easier. */
const MUTUAL = 1.5;
/** Apart, flirting halves over an hour; a friendship short of 1 over an hour and a half. A friendship never fades. */
const FLIRT_HALF = 60 * MIN;
const FRIEND_HALF = 90 * MIN;
/** The friend bond's ceiling. */
const FRIEND_MAX = 2;
/** Staff and a guest: the guests' rate, but only while serving within this distance (m; across the bar counter, further, and counted as close). */
const STAFF_RATE = 1.3;
const SERVE_NEAR = 1.2;
const BAR_NEAR = 2.2;
/** A pair seen apart this long (in-game s) meets afresh next time. */
const MEETING = 90;

/** The stages. */
export const NOTICING = 0.15;
export const FLIRTING = 0.35;
export const COUPLE = 1;
export const ACQUAINTANCE = 0.3;
export const FRIEND = 1;
export const CLOSE_FRIEND = 1.5;
/** A friendship that drops below this after a row has ended. */
const FALLEN = 0.6;
/** A friend list holds this many. */
const FRIENDS_MAX = 8;
/** Below this chemistry the cool one steps back when the other starts flirting. */
const COOL = 0.2;

// ---------------------------------------------------------------- jealousy

/** What a stray will leave to drift over to the one they have an eye on. */
const DRIFT_FROM: ReadonlySet<string> = new Set(["mingle", "sit", "art", "use", "snack", "wander", "terrace", "drink"]);

/** About one couple in this many has a partner who strays. */
const STRAY_ONE_IN = 10;
/** A stray, out of the partner's sight, seeks out the one they have an eye on: this much on a circle's score, and on the floor. */
const EYE_PULL = 4;
const EYE_DANCE = 2.5;
/** A stray who spots the one they have an eye on this near (m), partner away, drifts over: at most this often (in-game s). */
const EYE_SEEN = 12;
const EYE_GAP = 4 * 60;
/** A stray's flirting grows this much quicker. */
const STRAY_KEEN = 2.2;
/** A stray flirts only when the partner hasn't been seen for this long (in-game s), and with none of the partner's close friends this near (m). */
const OUT_OF_SIGHT = 30;
const WATCH_NEAR = 4;
/** Doubt halves over an hour; a told cheating from a friend, an acquaintance or anyone else adds this much (flirting half). */
const DOUBT_HALF = 60 * MIN;
const TOLD_FRIEND = 1.15;
const TOLD_KNOWN = 0.5;
const TOLD_OTHER = 0.3;
/** A circle going quiet as the partner joins: a hint. */
const HUSH_HINT = 0.1;
/** Sources counted per person, each once. */
const SOURCES = 8;
/** From this doubt the partner keeps an eye out; from CONFRONT they go and have it out. */
export const WATCHFUL = 0.3;
export const CONFRONT = 0.7;
/** Witnesses of a row or an eruption tense up by this much. */
const ROW_TENSION = 0.1;
const ERUPT_TENSION = 0.15;

// ----------------------------------------------------------------- grudges

/** A grudge halves over half an hour. */
const GRUDGE_HALF = 30 * MIN;
const BUMP = 0.05;
const LOST = 0.1;
const GLOAT = 0.2;
const HEAVY = 0.15;
const JEALOUS = 0.2;
const REBUFFED = 0.2;
const GOSSIPED = 0.3;
const GOSSIPED_FRIEND = 0.5;
/** Heat that starts a spat, a row, and (tipsier than ACT_TIPSY) a row with an act in it. */
const SPAT = 0.15;
const ROW = 0.35;
const ACT = 0.6;
const ACT_TIPSY = 0.5;
/** Heat is grudge × temper × (1 + tipsiness) × (1 + tension), scaled so a temper of 0.5 reads as the plan's 1 (tuned). */
const HEAT_K = 4;
/** A pair rows at most once in this long (in-game s); after it they keep apart for 20 to 40 minutes. */
const ROW_GAP = 20 * MIN;
const AVOID: readonly [number, number] = [20 * MIN, 40 * MIN];
/** What a spat, a row and an act cost a friendship. */
const COST: Record<RowKind, number> = { spat: 0.15, row: 0.8, act: 1.2, hiss: 0.4, pull: 0, scuffle: 1.2, jealous: 1 };
/** Making up: after this long apart, for a friendship that was this strong, one roll per meeting. */
const MAKE_UP_AFTER = 30 * MIN;
const MAKE_UP_FROM = 1.5;

// --------------------------------------------------------------- the floor

/** A friend seen starting to dance pulls with chance 0.25 × the bond (2.4 for a partner) × …, once per pair in this long. */
const PULL = 1;
const PULL_PARTNER = 2.4;
const PULL_GAP = 10 * MIN;
/** A hit draws them to the floor for this long (in-game s), the dance score × PULL_BOOST. */
const PULL_FOR = 120;
export const PULL_BOOST = 3;
/** A dancer waves a close friend standing this near the floor over (m). */
const WAVE_NEAR = 6;
/** Slipping away: every 10 minutes, a tipsy couple close together. */
export const SLIP_EVERY = 10 * MIN;
const SLIP_TIPSY = 0.4;
const SLIP_CHANCE = 0.5;
/** Once a night a couple, and two couples an evening at most. */
const SLIPS_MAX = 2;
/** How long the dishevelled look lasts (in-game s). */
export const DISHEVELLED = 10 * MIN;

/** Kinds of row: a spat, a row, a row with an act in it, a hissed word, a pull by the arm, a scuffle, the jealous partner's eruption. */
export type RowKind = "spat" | "row" | "act" | "hiss" | "pull" | "scuffle" | "jealous";
/** The act at the height of a row. */
export type RowAct = "slap" | "shove" | "throw";

/** What bonds need from the party. */
export interface BondsHost {
  readonly t: number;
  readonly people: Person[];
  readonly memory: Memory;
  readonly ident: Ident;
  readonly mood: Mood;
  readonly sight: Sight;
  readonly phaseId: PhaseId;
  /** The record the spy lives in, or -1: its heat counts half and it never strikes, and it answers a row with an apology. */
  readonly spyId: number;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
  gesture(p: Person, g: Gesture, secs: number): void;
  glance(p: Person, x: number, z: number, secs: number): void;
  notable(p: Person, verb: Verb, obj: number, secs: number, room?: number): void;
  sound(kind: SoundKind, at: { level: number; x: number; z: number; room: number }, source: number, ref?: number): void;
  end(p: Person, done: boolean): void;
  start(p: Person, c: Candidate): void;
  beside(q: Person, from: { x: number; z: number }, gap?: number, free?: Person): Spot | null;
  /** Whether someone could be drawn into something now: present, a guest, and not in a ritual, a task, the bathroom or leaving. */
  free(p: Person): boolean;
  /** Two people take to the floor together. */
  danceWith(a: Person, b: Person): boolean;
  /** Off to the terrace, or home. */
  stormOff(p: Person, home: boolean): void;
  /** A couple go off to a guest bedroom and lock the door. */
  slipAway(lead: Person, follow: Person): boolean;
  /** A stray goes over to the one they have an eye on (false when there's no way to). */
  seekOut(p: Person, q: Person): boolean;
  /** Go and find one's partner, meaning to have it out. */
  confrontSearch(h: Person, f: Person): boolean;
}

export interface BondStats {
  noticing: number;
  flirting: number;
  couples: number;
  acquaintances: number;
  friendships: number;
  closeFriends: number;
  rebuffs: number;
  strays: number;
  affairs: number;
  /** Partners who reached the confronting line, and how many of them got there without seeing it themselves. */
  foundOut: number;
  foundByWord: number;
  confrontations: number;
  /** Confrontations started below the line: always 0. */
  unfounded: number;
  eruptions: number;
  spats: number;
  rows: number;
  acts: number;
  scuffles: number;
  fellOut: number;
  madeUp: number;
  /** Dance starts in the dancing phase, and those a friend drew onto the floor. */
  danceStarts: number;
  pulled: number;
  waves: number;
  /** A stray drifting over to the one they have an eye on. */
  drifts: number;
  staffFriends: number;
  slipAways: number;
  games: number;
  gloats: number;
  accusations: number;
  apologies: number;
}

/** Stages, as bits of `reached`. */
const S_NOTICED = 1;
const S_FLIRTED = 2;
const S_ACQUAINTED = 4;
const S_FRIENDS = 8;
const S_CLOSE = 16;

/** The pair key, smaller id first, for symmetric tables. */
const sym = (n: number, i: number, j: number): number => (i < j ? i * n + j : j * n + i);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const wrap = (a: number): number => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class Bonds {
  readonly n: number;
  /** How drawn i is to j (one value each way), and how well i and j get on (symmetric). */
  readonly chem: Float32Array;
  readonly aff: Float32Array;
  /** The two bonds (symmetric, smaller id first) and when the pair was last together. */
  readonly flirt: Float32Array;
  readonly friend: Float32Array;
  readonly together: Float32Array;
  /** How much i holds against j, and when it was last brought up to date. */
  readonly grudge: Float32Array;
  private readonly grudgeT: Float32Array;
  /** Ended tonight (symmetric): no regrowing, no joining the same circle. */
  readonly fellOut: Uint8Array;
  private readonly fellAt: Float32Array;
  /** The friend bond just before the row that ended it. */
  private readonly before: Float32Array;
  /** One side's chemistry was too low: no more flirting tonight (symmetric). */
  readonly rebuffed: Uint8Array;
  /** Stages a pair has reached tonight (symmetric bits), so each is told once. */
  private readonly reached: Uint8Array;
  /** When a friend last drew i onto the floor toward j (i × n + j), and when a pair last rowed (symmetric). */
  private readonly lastPull: Float32Array;
  private readonly lastRow: Float32Array;
  /** Per person: a temper (0 to 1), a stray partner, the lover, attracted to their own sex. */
  readonly temper: Float32Array;
  readonly stray: Uint8Array;
  readonly lover: Int16Array;
  /** Whom a stray has an eye on from the start (-1 none). */
  readonly eye: Int16Array;
  private readonly samesex: Uint8Array;
  /** Whom each is flirting with right now (refreshed while together), -1 none. */
  readonly flirtingWith: Int16Array;
  private readonly flirtUntil: Float32Array;
  /** When a couple formed tonight (-1 the cast's own couples). */
  readonly coupledAt: Float32Array;
  /** A couple who had it out: apart for the rest of the night. */
  readonly apart: Uint8Array;
  /** How sure each is that their partner is cheating, its last update, and who has said so (each counts once). */
  private readonly doubtV: Float32Array;
  private readonly doubtT: Float32Array;
  private readonly sources: Int16Array;
  private readonly nSources: Uint8Array;
  /** 1 once doubt first reached WATCHFUL, 2 once it reached CONFRONT (each logged once). */
  private readonly watched: Uint8Array;
  /** Has slipped away tonight (once a night is enough). */
  private readonly slipped: Uint8Array;
  /** The partner has been confronted (once a night), and the one they think it's with. */
  readonly confronted: Uint8Array;
  readonly suspectWith: Int16Array;
  /** Drawn onto the floor toward someone until a time; waved over by a close friend at a time. */
  readonly pullTo: Int16Array;
  readonly pullUntil: Float32Array;
  private readonly wavedAt: Float32Array;
  /** Left with no friends present after falling out. */
  readonly sulk: Uint8Array;
  readonly stats: BondStats = {
    noticing: 0,
    flirting: 0,
    couples: 0,
    acquaintances: 0,
    friendships: 0,
    closeFriends: 0,
    rebuffs: 0,
    strays: 0,
    affairs: 0,
    foundOut: 0,
    foundByWord: 0,
    confrontations: 0,
    unfounded: 0,
    eruptions: 0,
    spats: 0,
    rows: 0,
    acts: 0,
    scuffles: 0,
    fellOut: 0,
    madeUp: 0,
    danceStarts: 0,
    pulled: 0,
    waves: 0,
    drifts: 0,
    staffFriends: 0,
    slipAways: 0,
    games: 0,
    gloats: 0,
    accusations: 0,
    apologies: 0,
  };

  constructor(
    private readonly host: BondsHost,
    private readonly rng: Rng,
  ) {
    const people = host.people;
    const n = people.length;
    this.n = n;
    const nn = n * n;
    this.chem = new Float32Array(nn);
    this.aff = new Float32Array(nn);
    this.flirt = new Float32Array(nn);
    this.friend = new Float32Array(nn);
    this.together = new Float32Array(nn).fill(-1e9);
    this.grudge = new Float32Array(nn);
    this.grudgeT = new Float32Array(nn);
    this.fellOut = new Uint8Array(nn);
    this.fellAt = new Float32Array(nn).fill(-1e9);
    this.before = new Float32Array(nn);
    this.rebuffed = new Uint8Array(nn);
    this.reached = new Uint8Array(nn);
    this.lastPull = new Float32Array(nn).fill(-1e9);
    this.lastRow = new Float32Array(nn).fill(-1e9);
    this.temper = new Float32Array(n);
    this.stray = new Uint8Array(n);
    this.lover = new Int16Array(n).fill(-1);
    this.eye = new Int16Array(n).fill(-1);
    this.samesex = new Uint8Array(n);
    this.flirtingWith = new Int16Array(n).fill(-1);
    this.flirtUntil = new Float32Array(n).fill(-1e9);
    this.coupledAt = new Float32Array(n).fill(-1);
    this.apart = new Uint8Array(n);
    this.doubtV = new Float32Array(n);
    this.doubtT = new Float32Array(n);
    this.sources = new Int16Array(n * SOURCES);
    this.nSources = new Uint8Array(n);
    this.confronted = new Uint8Array(n);
    this.watched = new Uint8Array(n);
    this.slipped = new Uint8Array(n);
    this.suspectWith = new Int16Array(n).fill(-1);
    this.pullTo = new Int16Array(n).fill(-1);
    this.pullUntil = new Float32Array(n).fill(-1e9);
    this.wavedAt = new Float32Array(n).fill(-1e9);
    this.sulk = new Uint8Array(n);
    this.draw();
  }

  /** Chemistry, affinity, tempers, who strays, and the bonds the cast brings with it. */
  private draw(): void {
    const { rng, n } = this;
    const people = this.host.people;
    const ident = this.host.ident;
    for (const p of people) {
      this.temper[p.id] = clamp01(rng.normal(0.4, 0.2));
      this.samesex[p.id] = rng.chance(0.06) ? 1 : 0;
    }
    const drawn = (p: Person): number => (p.archetype === "flirt" ? 1.4 : p.archetype === "young" ? 1.15 : p.archetype === "mother" || p.archetype === "elderly" ? 0.3 : 1);
    const quirks = (p: Person) => p.quirks.filter((q) => q !== "limp" && q !== "cane");
    for (let i = 0; i < n; i++) {
      const a = people[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = people[j]!;
        // Chemistry mostly runs both ways or neither: a shared draw and one's own.
        const s = rng.next();
        const ca = (0.55 * s + 0.45 * rng.next()) ** 1.7 * 1.25 * drawn(a);
        const cb = (0.55 * s + 0.45 * rng.next()) ** 1.7 * 1.25 * drawn(b);
        const fits = a.look.sex !== b.look.sex || (this.samesex[i] && this.samesex[j]);
        this.chem[i * n + j] = fits ? clamp01(ca) : 0;
        this.chem[j * n + i] = fits ? clamp01(cb) : 0;
        // Affinity: like talks to like, dancers to dancers, a shared habit, a friend in common.
        const shared = quirks(a).some((q) => b.quirks.includes(q)) ? 0.08 : 0;
        const mutual = a.friends.some((f) => b.friends.includes(f)) ? 0.1 : 0;
        const v = clamp01(0.15 + 0.35 * rng.next() + 0.2 * (1 - Math.abs(a.traits.talk - b.traits.talk)) + 0.1 * (1 - Math.abs(a.traits.dance - b.traits.dance)) + shared + mutual);
        this.aff[i * n + j] = v;
        this.aff[j * n + i] = v;
        // The bonds the cast brings: friends 1.3 to 2 (a close friend from 1.5), people they know a little, partners.
        const k = i * n + j;
        const tie = ident.tieOf(i, j);
        if (a.partner === j) this.friend[k] = FRIEND_MAX;
        else if (a.friends.includes(j)) this.friend[k] = tie >= 4 ? rng.range(CLOSE_FRIEND, FRIEND_MAX) : rng.range(1.3, CLOSE_FRIEND - 0.01);
        else if (tie >= 3) this.friend[k] = 0.9;
        else if (tie === 2) this.friend[k] = rng.range(0.3, 0.6);
      }
    }
    // About one couple in ten has a partner who strays: the less loyal of the two.
    for (const p of people) {
      const q = p.partner !== null ? people[p.partner]! : null;
      if (!q || q.id < p.id || p.staff || p.role === "host" || q.role === "host" || !rng.chance(1 / STRAY_ONE_IN)) continue;
      const s = p.traits.loyalty <= q.traits.loyalty ? p : q;
      this.stray[s.id] = 1;
      this.stats.strays++;
      // Someone at the party has caught their eye already.
      const pool = people.filter(
        (o) => o.partner === null && !o.staff && o.role === "guest" && o.archetype !== "mother" && o.archetype !== "elderly" && o.look.sex !== s.look.sex && !this.host.memory.household[o.id],
      );
      if (!pool.length) continue;
      const o = rng.pick(pool);
      this.eye[s.id] = o.id;
      this.chem[s.id * n + o.id] = Math.max(this.chem[s.id * n + o.id]!, rng.range(0.75, 0.95));
      this.chem[o.id * n + s.id] = Math.max(this.chem[o.id * n + s.id]!, rng.range(0.6, 0.9));
    }
  }

  // --------------------------------------------------------------- reading

  /** The flirt bond now, faded for the time apart. */
  flirtOf(i: number, j: number): number {
    const k = sym(this.n, i, j);
    const v = this.flirt[k]!;
    const gap = this.host.t - this.together[k]!;
    return v > 0 && gap > MEETING ? v * 0.5 ** (gap / FLIRT_HALF) : v;
  }

  /** The friend bond now (a friendship short of 1 fades apart). */
  friendOf(i: number, j: number): number {
    const k = sym(this.n, i, j);
    const v = this.friend[k]!;
    const gap = this.host.t - this.together[k]!;
    return v > 0 && v < FRIEND && gap > MEETING ? v * 0.5 ** (gap / FRIEND_HALF) : v;
  }

  /** How much i holds against j now. */
  grudgeOf(i: number, j: number): number {
    const k = i * this.n + j;
    const v = this.grudge[k]!;
    return v > 0 ? v * 0.5 ** ((this.host.t - this.grudgeT[k]!) / GRUDGE_HALF) : 0;
  }

  /** How sure someone is now that their partner is cheating. */
  doubt(i: number): number {
    const v = this.doubtV[i]!;
    return v > 0 ? v * 0.5 ** ((this.host.t - this.doubtT[i]!) / DOUBT_HALF) : 0;
  }

  /** Whether i and j fell out tonight. */
  outWith(i: number, j: number): boolean {
    return this.fellOut[sym(this.n, i, j)] === 1;
  }

  /** Whether i is flirting with someone right now (or with j). */
  flirtingNow(i: number, j = -1): boolean {
    const w = this.flirtingWith[i]!;
    return w >= 0 && this.host.t < this.flirtUntil[i]! && (j < 0 || w === j);
  }

  /** How much more i wants to join a circle with j in it: a friend, someone they're drawn to. */
  joinPull(i: number, j: number): number {
    const people = this.host.people;
    // A stray seeks out the one they have an eye on, while the partner isn't looking.
    if (this.eye[i] === j && this.lover[i] < 0 && this.hidden(people[i]!, people[j]!)) return EYE_PULL;
    // And doesn't stick to the partner's side.
    if (this.stray[i] && people[i]!.partner === j) return -1;
    const f = this.flirtOf(i, j);
    if (f < NOTICING || this.rebuffed[sym(this.n, i, j)] || !this.mayFlirt(people[i]!, people[j]!)) return 0;
    return Math.min(1, f / FLIRTING) * 0.8;
  }

  /** Whether i wants nothing to do with j for now: fallen out, or keeping apart after a row. */
  shuns(p: Person, j: number): boolean {
    return this.outWith(p.id, j) || (p.avoid.get(`person:${j}`) ?? -1) > this.host.t || (p.partner === j && this.apart[p.id] === 1);
  }

  /** The dancer someone is drawn to dance near: the friend who pulled them, their partner, or whoever they're flirting with. */
  danceNear(p: Person): { who: number; k: number; mode: "beside" | "face" | "front" } | null {
    const people = this.host.people;
    const dancing = (j: number) => people[j]!.present && people[j]!.action?.id === "dance";
    if (this.host.t < this.pullUntil[p.id]! && this.pullTo[p.id]! >= 0) {
      const j = this.pullTo[p.id]!;
      if (dancing(j)) return { who: j, k: PULL_BOOST, mode: p.partner === j ? "face" : "beside" };
    }
    // A stray dances near the one they have an eye on, when the partner isn't looking.
    const e = this.eye[p.id]!;
    if (e >= 0 && this.lover[p.id] < 0 && dancing(e) && this.hidden(p, people[e]!)) return { who: e, k: EYE_DANCE, mode: "beside" };
    if (p.partner !== null && !this.apart[p.id] && dancing(p.partner)) return { who: p.partner, k: 1.6, mode: "face" };
    const w = this.flirtingWith[p.id]!;
    if (w >= 0 && this.host.t < this.flirtUntil[p.id]! + 60 && dancing(w)) {
      // Tipsy enough, club-style: in front of them, back to them.
      const club = (p.tipsy + people[w]!.tipsy) / 2 > 0.35;
      return { who: w, k: 1.8, mode: club ? "front" : "face" };
    }
    return null;
  }

  // --------------------------------------------------------------- growth

  /** Whether two people may flirt: two single guests (or a stray out of the partner's sight), not the household, not the exes, attracted that way. */
  mayFlirt(a: Person, b: Person): boolean {
    if (a.staff || b.staff || a.role === "host" || b.role === "host" || a.ex === b.id) return false;
    const hh = this.host.memory.household;
    if (hh[a.id] || hh[b.id] || (!this.chem[a.id * this.n + b.id] && !this.chem[b.id * this.n + a.id])) return false;
    if (a.partner === b.id) return false;
    const ok = (x: Person, y: Person) => x.partner === null || (this.stray[x.id] === 1 && (this.lover[x.id] < 0 || this.lover[x.id] === y.id) && y.partner === null);
    return ok(a, b) && ok(b, a);
  }

  /** A stray flirts only out of their partner's sight, and away from their partner's close friends. */
  private hidden(s: Person, other: Person): boolean {
    const h = this.host;
    if (s.partner === null || !this.stray[s.id]) return true;
    const partner = h.people[s.partner]!;
    if (partner.present && ((partner.level === s.level && partner.room === s.room) || h.memory.lastT[s.id * this.n + partner.id]! > h.t - OUT_OF_SIGHT)) return false;
    // Nor with the partner's close friends standing by.
    for (const q of h.people) {
      if (!q.present || q === s || q === other || q === partner || q.room !== s.room || q.level !== s.level || Math.hypot(q.x - s.x, q.z - s.z) > WATCH_NEAR) continue;
      if (this.friendOf(q.id, partner.id) >= CLOSE_FRIEND) return false;
    }
    return true;
  }

  /** What a pair is doing together. */
  private activity(a: Person, b: Person, d: number): Activity {
    const x = a.action;
    const y = b.action;
    if (!x || !y || x.startedAt === null || y.startedAt === null) return "near";
    if (x.id === "dance" && y.id === "dance" && d < 1.6) return "dance";
    // A stray's word with the one they have an eye on.
    if ((x.id === "ask" && x.note === "eye" && x.ref === b.id) || (y.id === "ask" && y.note === "eye" && y.ref === a.id)) return d < 1.6 ? "talk" : "near";
    if (x.id === "mingle" && y.id === "mingle" && x.ref === y.ref && x.note === "in" && y.note === "in") return "talk";
    if (x.id === "games" && y.id === "games" && x.ref === y.ref) return "game";
    if (x.id === "drink" && y.id === "drink") return "bar";
    const side = (id: string) => id === "dinner" || id === "sit" || id === "snack" || id === "use" || id === "terrace";
    if (side(x.id) && side(y.id) && d < 1.3) return "seat";
    return "near";
  }

  /** A staff member serving a guest close by: a tray stop or the bar. */
  private serving(s: Person, g: Person, d: number): boolean {
    const a = s.action;
    if (!a || a.startedAt === null) return false;
    if (a.id === "staff" && a.note === "serve") return d <= SERVE_NEAR;
    return s.role === "bartender" && g.action?.id === "drink" && d <= BAR_NEAR;
  }

  /**
   * Every BOND_EVERY steps, over the pairs within 3 m in the same room (from the mood's pass):
   * bonds grow, stages fire, grudges boil over and old friends make up.
   */
  step(pairs: Int16Array, dist: Float32Array, count: number, dt: number): void {
    const h = this.host;
    const people = h.people;
    const n = this.n;
    const k = dt / 60;
    const { energy } = h.mood;
    for (let c = 0; c < count; c++) {
      const d = dist[c]!;
      if (d >= 2.5) continue;
      const i = pairs[2 * c]!;
      const j = pairs[2 * c + 1]!;
      const a = people[i]!;
      const b = people[j]!;
      if (a.staff && b.staff) continue;
      const key = sym(n, i, j);
      const close = CLOSE.find(([r]) => d < r)![1];
      // Lazy fading: apply the time apart, and note a fresh meeting.
      const gap = h.t - this.together[key]!;
      const fresh = gap > MEETING;
      if (fresh) {
        this.flirt[key] = this.flirtOf(i, j);
        this.friend[key] = this.friendOf(i, j);
      }
      this.together[key] = h.t;
      const tipsy = (a.tipsy + b.tipsy) / 2;
      const lively = 0.5 + (energy[i]! + energy[j]!) / 2;
      if (a.staff !== b.staff) {
        this.staffPair(a.staff ? a : b, a.staff ? b : a, d, close, tipsy, lively, k);
        continue;
      }
      const act = this.activity(a, b, d);
      // Friendship: talk counts most, a friend in common helps.
      if (!this.fellOut[key]) {
        const mutual = act === "talk" && this.mutualHere(a, b) ? MUTUAL : 1;
        const before = this.friend[key]!;
        const v = Math.min(FRIEND_MAX, before + R_FRIEND * this.aff[i * n + j]! * close * FRIEND_W[act] * (1 + 0.5 * tipsy) * lively * mutual * k);
        this.friend[key] = v;
        this.friendStages(a, b, before, v);
      } else if (fresh) this.maybeMakeUp(a, b, key);
      // Flirting: chemistry both ways, and drink.
      if (!this.rebuffed[key] && this.mayFlirt(a, b) && this.hidden(a, b) && this.hidden(b, a)) {
        const chem = (this.chem[i * n + j]! + this.chem[j * n + i]!) / 2;
        const before = this.flirt[key]!;
        // A stray is looking: it comes quicker, and never to a couple.
        const stray = this.stray[i] || this.stray[j];
        const v = Math.min(stray ? COUPLE - 0.01 : Infinity, before + R_FLIRT * (stray ? STRAY_KEEN : 1) * chem * close * FLIRT_W[act] * (1 + tipsy) * lively * k);
        this.flirt[key] = v;
        this.flirtStages(a, b, before, v, act);
      }
      // Grudges: face to face within 2 m.
      if (d < 2) {
        this.heat(a, b, d);
        this.heat(b, a, d);
      }
    }
  }

  /** A friend of both in the same circle. */
  private mutualHere(a: Person, b: Person): boolean {
    const people = this.host.people;
    const ref = a.action?.ref;
    for (const f of a.friends) {
      if (!b.friends.includes(f)) continue;
      const q = people[f]!;
      if (q.action?.id === "mingle" && q.action.ref === ref) return true;
    }
    return false;
  }

  /** Whether a pair reaches a stage for the first time tonight (and mark it). */
  private first(a: Person, b: Person, bit: number): boolean {
    const k = sym(this.n, a.id, b.id);
    if (this.reached[k]! & bit) return false;
    this.reached[k]! |= bit;
    return true;
  }

  private friendStages(a: Person, b: Person, before: number, v: number): void {
    const h = this.host;
    if (before < ACQUAINTANCE && v >= ACQUAINTANCE && this.first(a, b, S_ACQUAINTED)) {
      this.stats.acquaintances++;
      this.raiseTie(a, b, 2);
    }
    if (before < FRIEND && v >= FRIEND && this.first(a, b, S_FRIENDS)) {
      this.stats.friendships++;
      this.raiseTie(a, b, 3);
      this.befriend(a, b);
      h.log("bond", [a.id, b.id], a.room, "friend");
    }
    if (before < CLOSE_FRIEND && v >= CLOSE_FRIEND && this.first(a, b, S_CLOSE)) {
      this.stats.closeFriends++;
      this.raiseTie(a, b, 4);
    }
  }

  private raiseTie(a: Person, b: Person, t: Tie): void {
    this.host.ident.bond(a.id, b.id, t);
  }

  /** Into each other's friends (up to eight each). */
  private befriend(a: Person, b: Person): void {
    if (!a.friends.includes(b.id) && a.friends.length < FRIENDS_MAX) a.friends.push(b.id);
    if (!b.friends.includes(a.id) && b.friends.length < FRIENDS_MAX) b.friends.push(a.id);
  }

  private flirtStages(a: Person, b: Person, before: number, v: number, act: Activity): void {
    const h = this.host;
    const n = this.n;
    if (before < NOTICING && v >= NOTICING && this.first(a, b, S_NOTICED)) {
      this.stats.noticing++;
      h.glance(a, b.x, b.z, 2);
      h.log("bond", [a.id, b.id], a.room, "noticing");
    }
    if (v >= FLIRTING) {
      // Not that way inclined: the cool one steps back, and that's the end of it tonight.
      if (before < FLIRTING) {
        const ab = this.chem[a.id * n + b.id]!;
        const ba = this.chem[b.id * n + a.id]!;
        if (Math.min(ab, ba) < COOL) return this.rebuff(ab < ba ? a : b, ab < ba ? b : a);
        if (this.first(a, b, S_FLIRTED)) {
          this.stats.flirting++;
          h.log("bond", [a.id, b.id], a.room, "flirting");
        }
        // A stray's flirting is an affair.
        for (const [s, o] of [
          [a, b],
          [b, a],
        ] as const) {
          if (!this.stray[s.id] || this.lover[s.id] >= 0) continue;
          this.lover[s.id] = o.id;
          this.stats.affairs++;
          h.log("bond", [s.id, o.id, s.partner ?? -1], s.room, "affair");
        }
      }
      const until = h.t + 2 * BOND_EVERY * 0.5 + 1;
      this.flirtingWith[a.id] = b.id;
      this.flirtingWith[b.id] = a.id;
      this.flirtUntil[a.id] = until;
      this.flirtUntil[b.id] = until;
      // Talking or by the bar during the dancing: one asks the other to dance.
      if (act !== "dance" && (PHASE_WEIGHTS[h.phaseId].dance ?? 0) >= 1 && h.free(a) && h.free(b) && this.rng.chance(0.01 * (0.5 + Math.max(a.traits.dance, b.traits.dance)))) {
        const asker = a.traits.dance >= b.traits.dance ? a : b;
        if (h.danceWith(asker, asker === a ? b : a)) h.gesture(asker, "ask", 2);
      }
    }
    if (before < COUPLE && v >= COUPLE && a.partner === null && b.partner === null) this.formCouple(a, b);
  }

  /** The cool one steps back; the keen one minds a little. */
  private rebuff(cool: Person, keen: Person): void {
    const h = this.host;
    this.rebuffed[sym(this.n, cool.id, keen.id)] = 1;
    this.stats.rebuffs++;
    if (cool.action?.id === "mingle" && h.free(cool)) h.end(cool, false);
    cool.avoid.set(`person:${keen.id}`, h.t + 15 * MIN);
    h.gesture(keen, "shrug", 2);
    this.addGrudge(keen.id, cool.id, REBUFFED);
    h.log("rebuff", [cool.id, keen.id], cool.room);
  }

  /** A couple: partners both ways, a partner's tie, and the news for whoever sees them. */
  private formCouple(a: Person, b: Person): void {
    const h = this.host;
    a.partner = b.id;
    b.partner = a.id;
    this.coupledAt[a.id] = h.t;
    this.coupledAt[b.id] = h.t;
    // Eyes only for each other now: whatever else was going on stops.
    for (const x of h.people) {
      const w = this.flirtingWith[x.id]!;
      if (x === a || x === b || w === a.id || w === b.id) this.flirtUntil[x.id] = -1e9;
    }
    this.raiseTie(a, b, 5);
    this.stats.couples++;
    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    h.memory.observe(a.id, "couple", x, y, a.room);
    h.memory.observe(b.id, "couple", x, y, a.room);
    h.log("bond", [a.id, b.id], a.room, "couple");
  }

  /** Staff and a guest: flirting only while serving, and at the flirting line they're friends for the night. */
  private staffPair(s: Person, g: Person, d: number, close: number, tipsy: number, lively: number, k: number): void {
    if (!this.serving(s, g, d) || g.partner !== null || g.role === "host" || this.host.memory.household[g.id]) return;
    const key = sym(this.n, s.id, g.id);
    const chem = (this.chem[s.id * this.n + g.id]! + this.chem[g.id * this.n + s.id]!) / 2;
    const before = this.flirt[key]!;
    const v = Math.min(COUPLE - 0.01, before + R_FLIRT * STAFF_RATE * chem * Math.max(close, 0.7) * (1 + tipsy) * lively * k);
    this.flirt[key] = v;
    if (before < FLIRTING && v >= FLIRTING) {
      this.stats.staffFriends++;
      this.friend[key] = Math.max(this.friend[key]!, FRIEND);
      this.raiseTie(s, g, 3);
      this.befriend(s, g);
      this.host.log("bond", [s.id, g.id], g.room, "staff-friend");
    }
  }

  // ------------------------------------------------------------ the senses

  /**
   * a sees b (senses.ts, after the sighting's own notes). What a bond makes of it: someone
   * flirting (and whether a witness knows they're spoken for), a partner caught at it, a friend
   * taking to the floor, a close friend to wave over, club dancing in front of the proper.
   */
  saw(a: Person, b: Person, d: number): void {
    const h = this.host;
    if (a.staff || !a.present) return;
    const g = this.flirtingWith[b.id]!;
    if (g >= 0 && g !== a.id && this.flirtingNow(b.id)) this.sawFlirting(a, b, h.people[g]!);
    const act = b.action;
    if (act?.id === "dance" && act.startedAt !== null) {
      if (a.action?.id !== "dance") this.maybePull(a, b);
      else if (b.pose === "front" && a.traits.propriety > 0.85 && a.partner !== b.id && this.rng.chance(0.2) && h.free(a)) {
        // Not on a dance floor they're on.
        h.gesture(a, "frown", 2);
        h.end(a, false);
      }
    }
    // A stray spots the one they have an eye on, with the partner away: they drift over.
    if (this.eye[a.id] === b.id && this.lover[a.id] < 0 && d < EYE_SEEN) this.drift(a, b);
    // A dancer waves a close friend standing by the floor over.
    if (
      a.action?.id === "dance" &&
      a.action.startedAt !== null &&
      b.action?.id !== "dance" &&
      !b.staff &&
      d < WAVE_NEAR &&
      this.friendOf(a.id, b.id) >= CLOSE_FRIEND &&
      h.t - this.wavedAt[b.id]! > PULL_GAP
    ) {
      this.wavedAt[b.id] = h.t;
      this.stats.waves++;
      h.gesture(a, "wave", 2);
    }
    // A couple just together tonight: the news.
    if (b.partner !== null && this.coupledAt[b.id]! >= 0 && h.t - this.coupledAt[b.id]! < 30 * MIN) {
      const q = h.people[b.partner]!;
      if (q !== a && q.level === b.level && Math.hypot(q.x - b.x, q.z - b.z) < 1.6) h.memory.observe(a.id, "couple", Math.min(b.id, q.id), Math.max(b.id, q.id), b.room);
    }
  }

  /** A stray leaves what they're doing for a chance to be near the one they have an eye on; the next choice then leans their way. */
  private drift(a: Person, b: Person): void {
    const h = this.host;
    const x = a.action;
    const y = b.action;
    if (!x || !DRIFT_FROM.has(x.id) || !h.free(a) || !b.present || (a.avoid.get("eye") ?? -1) > h.t) return;
    if (x.id === "mingle" && y?.id === "mingle" && x.ref === y.ref) return;
    if (!this.hidden(a, b)) return;
    a.avoid.set("eye", h.t + EYE_GAP);
    if (!this.rng.chance(0.6) || !h.seekOut(a, b)) return;
    this.stats.drifts++;
    h.glance(a, b.x, b.z, 2);
  }

  /** a sees f flirting with g: the partner erupts, a witness who knows f is spoken for sees cheating, anyone else flirting. */
  private sawFlirting(a: Person, f: Person, g: Person): void {
    const h = this.host;
    const m = h.memory;
    for (const [x, y] of [
      [f, g],
      [g, f],
    ] as const) {
      if (a.partner !== x.id) continue;
      // Their own partner, at it.
      this.addGrudge(a.id, y.id, JEALOUS);
      this.suspectWith[a.id] = y.id;
      this.setDoubt(a, 1, true);
      if (!this.confronted[a.id] && h.free(a) && h.free(x)) this.erupt(a, x, y, true);
      return;
    }
    const spoken = (x: Person) => x.partner !== null && x.partner !== a.id && (h.ident.tieOf(a.id, x.partner) >= 2 || h.ident.tieOf(a.id, x.id) >= 3);
    const cheat = spoken(f) ? f : spoken(g) ? g : null;
    if (cheat) m.observe(a.id, "cheating", cheat.id, cheat === f ? g.id : f.id, cheat.room);
    else m.observe(a.id, "flirting", Math.min(f.id, g.id), Math.max(f.id, g.id), f.room);
  }

  /** A friend (or partner) seen taking to the floor: maybe follow them on. */
  private maybePull(a: Person, b: Person): void {
    const h = this.host;
    if (a.role === "host" || (PHASE_WEIGHTS[h.phaseId].dance ?? 0) <= 0) return;
    const k = a.id * this.n + b.id;
    if (h.t - this.lastPull[k]! < PULL_GAP) return;
    const s = a.partner === b.id ? (this.apart[a.id] ? 0 : PULL_PARTNER) : this.outWith(a.id, b.id) ? 0 : this.friendOf(a.id, b.id);
    if (s < ACQUAINTANCE) return;
    this.lastPull[k] = h.t;
    const waved = h.t - this.wavedAt[a.id]! < 60 ? 2 : 1;
    const p = PULL * s * (0.4 + a.traits.dance) * (0.6 + 0.8 * h.mood.energy[a.id]!) * waved;
    if (!this.rng.chance(Math.min(0.95, p))) return;
    this.pullTo[a.id] = b.id;
    this.pullUntil[a.id] = h.t + PULL_FOR;
    // Off what they're doing, if it can be dropped, to think again.
    const x = a.action;
    if (x && x.startedAt !== null && ["mingle", "sit", "art", "use", "snack", "wander", "terrace", "greet", "drink"].includes(x.id) && !(x.id === "drink" && x.note === "bar-wait") && h.free(a)) {
      h.glance(a, b.x, b.z, 2);
      h.end(a, false);
      a.thinkAt = h.t + 1;
    }
  }

  /** Someone started dancing (sim.ts): counted, and whether a friend drew them. */
  danced(p: Person): void {
    if (this.host.phaseId !== "dancing") return;
    this.stats.danceStarts++;
    // Drawn by a friend on the floor (whichever spot they took).
    if (this.pullTo[p.id]! >= 0 && this.host.t < this.pullUntil[p.id]!) {
      this.stats.pulled++;
      this.pullUntil[p.id] = -1e9;
      this.host.log("pull", [this.pullTo[p.id]!, p.id], p.room);
    }
  }

  // ---------------------------------------------------------------- doubt

  /** Raise someone's doubt about their partner (seen: their own eyes). */
  private setDoubt(p: Person, v: number, seen: boolean): void {
    const h = this.host;
    const before = this.doubt(p.id);
    const now = Math.min(1, Math.max(before, v));
    this.doubtV[p.id] = now;
    this.doubtT[p.id] = h.t;
    if (before < CONFRONT && now >= CONFRONT && this.watched[p.id]! < 2) {
      this.watched[p.id] = 2;
      this.stats.foundOut++;
      if (!seen) this.stats.foundByWord++;
      h.log("doubt", [p.id, p.partner ?? -1], p.room, seen ? "seen" : "told");
    } else if (before < WATCHFUL && now >= WATCHFUL && !this.watched[p.id]) {
      this.watched[p.id] = 1;
      h.log("doubt", [p.id, p.partner ?? -1], p.room, "watchful");
    }
  }

  /** Doubt from someone's word (or a hint), once per source. */
  private hint(p: Person, from: number, v: number): void {
    const base = p.id * SOURCES;
    const c = this.nSources[p.id]!;
    for (let s = base; s < base + c; s++) if (this.sources[s] === from) return;
    if (c < SOURCES) {
      this.sources[base + c] = from;
      this.nSources[p.id] = c + 1;
    }
    this.setDoubt(p, this.doubt(p.id) + v, false);
  }

  /** The one their partner is thought to be with, from what they hold (-1 nobody in particular). */
  private likelyWith(p: Person): number {
    const m = this.host.memory;
    const f = p.partner;
    if (f === null) return -1;
    if (this.suspectWith[p.id]! >= 0) return this.suspectWith[p.id]!;
    let best = -1;
    let bc = 0;
    const base = p.id * SLOTS;
    for (let s = base; s < base + m.held[p.id]!; s++) {
      const fact = m.sFact[s]!;
      const v = m.verbOf(fact);
      if (v !== "cheating" && v !== "flirting" && v !== "slipped-away") continue;
      const x = m.subject[fact]!;
      const y = m.object[fact]!;
      const other = x === f ? y : y === f ? x : -1;
      const c = m.confAt(p.id, s);
      if (other >= 0 && other !== p.id && c > bc) {
        bc = c;
        best = other;
      }
    }
    return best;
  }

  /**
   * i was told a fact (memory's hook). About their own partner and someone: doubt, by how well
   * they know the teller. Flirting heard of someone known to be spoken for is cheating. Gossip
   * about themselves, overheard: a grudge against whoever was saying it.
   */
  told(i: number, f: number, from: number): void {
    const h = this.host;
    const m = h.memory;
    const p = h.people[i]!;
    const verb = m.verbOf(f);
    const x = m.subject[f]!;
    const y = VERBS[verb].thing ? -1 : m.object[f]!;
    if (verb === "cheating" || verb === "flirting" || verb === "slipped-away") {
      const f0 = p.partner;
      // Not something from before they were together.
      if (f0 !== null && (x === f0 || y === f0) && x !== i && y !== i && m.t[f]! >= this.coupledAt[i]!) {
        const conf = m.confidence(i, f);
        const tie = this.friendOf(i, from) >= FRIEND ? TOLD_FRIEND : h.ident.tieOf(i, from) >= 2 ? TOLD_KNOWN : TOLD_OTHER;
        const other = x === f0 ? y : x;
        if (other >= 0 && this.suspectWith[i]! < 0) this.suspectWith[i] = other;
        this.hint(p, from, tie * conf * (verb === "flirting" ? 0.5 : 1));
        return;
      }
      if (verb === "flirting") {
        // They know one of them is spoken for: that's cheating.
        for (const [s, o] of [
          [x, y],
          [y, x],
        ] as const) {
          const q = s >= 0 ? h.people[s] : undefined;
          if (!q || q.partner === null || q.partner === o || q.partner === i || h.ident.tieOf(i, q.partner) < 2) continue;
          // Flirting from before they were a couple isn't cheating.
          if (m.t[f]! < this.coupledAt[s]!) continue;
          m.learn(i, m.fact("cheating", s, o, m.room[f]!), m.confidence(i, f), from, 1);
          break;
        }
      }
    }
    // Gossip about themselves, overheard.
    if (x === i && from >= 0 && from !== i && m.juicy[f]! >= 0.6 && (VERBS[verb].kind === "romance" || VERBS[verb].kind === "odd")) {
      this.addGrudge(i, from, this.friendOf(i, from) >= FRIEND ? GOSSIPED_FRIEND : GOSSIPED);
    }
  }

  /**
   * What gossip may say in front of whom (memory.ts asks per fact): news of someone's partner
   * cheating is for a friend to tell them, and nobody else says it in front of them.
   */
  gossipWeight(f: number, speaker: number, listeners: readonly number[]): number {
    const h = this.host;
    const m = h.memory;
    const verb = m.verbOf(f);
    if (verb !== "cheating" && verb !== "flirting" && verb !== "slipped-away") return 1;
    const x = m.subject[f]!;
    const y = m.object[f]!;
    let w = 1;
    for (const l of listeners) {
      const q = h.people[l]!;
      if (q.partner === null || (q.partner !== x && q.partner !== y)) continue;
      if (this.friendOf(speaker, l) < FRIEND) return 0;
      w = 3;
    }
    return w;
  }

  /** Someone joins a circle: those who know something about their partner, and aren't their friends, go quiet a moment. */
  joined(p: Person, members: readonly number[]): number {
    const h = this.host;
    if (p.partner === null) return 0;
    let quiet = 0;
    for (const o of members) {
      if (this.friendOf(o, p.id) >= FRIEND || !this.knowsWith(o, p.partner)) continue;
      const q = h.people[o]!;
      h.glance(q, p.x, p.z, 2);
      this.hint(p, o, HUSH_HINT);
      quiet = this.rng.range(2, 4);
    }
    return quiet;
  }

  /** Whether i holds a fact of the partner flirting with someone, as its object. */
  private knowsWith(i: number, j: number): boolean {
    const m = this.host.memory;
    const base = i * SLOTS;
    for (let s = base; s < base + m.held[i]!; s++) {
      const f = m.sFact[s]!;
      const v = m.verbOf(f);
      if ((v === "cheating" || v === "flirting") && (m.subject[f] === j || m.object[f] === j) && m.confAt(i, s) > 0.2) return true;
    }
    return false;
  }

  /** Whether someone means to have it out with their partner (and hasn't yet). */
  wantsConfront(p: Person): boolean {
    return p.partner !== null && !this.confronted[p.id] && !this.apart[p.id] && this.doubt(p.id) >= CONFRONT;
  }

  /** The partner search found them (tasks.ts): with the one they're thought to be with, an eruption; alone, words. */
  confront(h0: Person, f: Person): void {
    const h = this.host;
    if (this.confronted[h0.id] || f.gone || !f.present) return;
    const g = this.flirtingNow(f.id) ? this.flirtingWith[f.id]! : this.likelyWith(h0);
    const q = g >= 0 ? h.people[g]! : null;
    if (q && q.present && q.level === f.level && Math.hypot(q.x - f.x, q.z - f.z) < 3) return this.erupt(h0, f, q, false);
    this.confronted[h0.id] = 1;
    this.stats.confrontations++;
    if (this.doubt(h0.id) < CONFRONT) this.stats.unfounded++;
    // Found alone: a hissed word, a row half the time.
    const kind: RowKind = this.rng.chance(0.5) ? "row" : "hiss";
    h.log("confront", [h0.id, f.id, g], h0.room, kind);
    this.startRow(h0, f, kind, null, true);
  }

  /**
   * The partner sees it, or finds them together: scaled by how sure they are, their nerves and
   * drink. A stare and a pull by the arm; a row; a row with an act in it (a thrown drink, a slap, a
   * shove), which between two tipsy men is a scuffle one time in five.
   */
  private erupt(h0: Person, f: Person, g: Person, seen: boolean): void {
    const h = this.host;
    this.confronted[h0.id] = 1;
    this.stats.confrontations++;
    this.stats.eruptions++;
    if (this.doubt(h0.id) < CONFRONT) this.stats.unfounded++;
    const s = this.doubt(h0.id) * (0.5 + h0.traits.nerves) * (1 + h0.tipsy) * (seen ? 1.3 : 1);
    let kind: RowKind = s < 0.55 ? "pull" : s < 1 ? "jealous" : "act";
    let at = f;
    let act: RowAct | null = null;
    if (kind === "act") {
      act = this.rng.weighted<RowAct>([
        ["slap", 2],
        ["throw", h0.held && h0.item >= 0 ? 1.5 : 0],
        ["shove", 1],
      ]);
      at = act === "slap" ? f : act === "throw" ? (this.rng.chance(0.5) ? g : f) : g;
      if (act === "shove" && h0.look.sex === "m" && at.look.sex === "m" && h0.tipsy > ACT_TIPSY && at.tipsy > ACT_TIPSY && this.rng.chance(0.2)) kind = "scuffle";
      // The spy strikes nobody, and is struck by nobody: it takes a jealous word with an apology (startRow cuts it short).
      if (h0.id === h.spyId || at.id === h.spyId) {
        kind = "jealous";
        act = null;
      }
    }
    // The news, shouted: whoever is in the room hears what it's about.
    for (const o of h.people) {
      if (!o.present || o === h0 || o.level !== h0.level || o.room !== h0.room || Math.hypot(o.x - h0.x, o.z - h0.z) > 10) continue;
      if (o !== f && o !== g) h.memory.observe(o.id, "cheating", f.id, g.id, f.room);
      h.mood.witness(o.id, ERUPT_TENSION);
    }
    this.addGrudge(h0.id, g.id, 1);
    this.addGrudge(h0.id, f.id, 0.5);
    // A friend who did that: the friendship is over.
    if (this.friendOf(h0.id, g.id) >= FRIEND) this.fallOut(h0, g, this.friend[sym(this.n, h0.id, g.id)]!);
    this.apart[h0.id] = 1;
    this.apart[f.id] = 1;
    h.log("confront", [h0.id, f.id, g.id], h0.room, act ?? kind);
    this.startRow(h0, at, kind, act);
  }

  /** Lab and tests: draw two people to each other; they flirt when next together. */
  spark(i: number, j: number): void {
    if (i === j) return;
    const n = this.n;
    this.chem[i * n + j] = Math.max(this.chem[i * n + j]!, 0.85);
    this.chem[j * n + i] = Math.max(this.chem[j * n + i]!, 0.85);
    const k = sym(n, i, j);
    this.rebuffed[k] = 0;
    this.flirt[k] = Math.max(this.flirtOf(i, j), FLIRTING - 0.01);
    this.together[k] = this.host.t;
  }

  // --------------------------------------------------------------- grudges

  /** j did something to i: a grudge, by i's temper. */
  addGrudge(i: number, j: number, v: number): void {
    if (i === j || i < 0 || j < 0) return;
    const k = i * this.n + j;
    this.grudge[k] = Math.min(1, this.grudgeOf(i, j) + v * (0.5 + this.temper[i]!));
    this.grudgeT[k] = this.host.t;
  }

  /** Two people walked into each other (body.ts): a sorry cancels it. */
  bumped(fast: Person, hit: Person, slop: boolean): void {
    if (fast.staff || hit.staff) return;
    const h = this.host;
    if (this.rng.chance(0.8 * (0.5 + fast.traits.propriety) * (1 - 0.5 * fast.tipsy))) {
      this.stats.apologies++;
      h.gesture(fast, "shrug", 1.5);
      return;
    }
    this.addGrudge(hit.id, fast.id, BUMP * (slop ? 3 : 1));
  }

  /** A frame of billiards or a hand of cards ended: a winner by skill and luck, and the loser may mind (more if the winner gloats). */
  gameOver(p: Person, q: Person, kind: "billiards" | "cards"): void {
    const h = this.host;
    if (p.staff || q.staff) return;
    this.stats.games++;
    const skill = (x: Person) => (kind === "billiards" ? x.fluency.billiards : 0.3 + 0.3 * x.traits.curiosity);
    const margin = skill(p) - skill(q) + this.rng.normal(0, 0.25);
    const [won, lost] = margin >= 0 ? [p, q] : [q, p];
    let g = LOST;
    if (this.rng.chance(0.25 * (1 - won.traits.propriety) * (1 + won.tipsy))) {
      g += GLOAT;
      this.stats.gloats++;
      h.gesture(won, "point", 2);
    }
    if (Math.abs(margin) > 0.35) g += HEAVY;
    this.addGrudge(lost.id, won.id, g);
    h.log("won", [won.id, lost.id], won.room, kind);
    // A bad loser at cards cries foul.
    if (kind === "cards" && this.heatOf(lost, won) >= ROW && h.free(lost) && h.free(won)) {
      this.stats.accusations++;
      this.startRow(lost, won, "row");
    }
  }

  /** How hot a's grudge against b runs now: temper, drink and tension stoke it; the spy's at half. */
  heatOf(a: Person, b: Person): number {
    return this.grudgeOf(a.id, b.id) * this.temper[a.id]! * (1 + a.tipsy) * (1 + this.host.mood.tension[a.id]!) * HEAT_K * (a.id === this.host.spyId ? 0.5 : 1);
  }

  /** Someone else's temper in this record (the spy moved into its victim's). */
  setTemper(i: number, v: number): void {
    this.temper[i] = clamp01(v);
  }

  /** a, facing b within 2 m: a grudge that's hot enough comes out. */
  private heat(a: Person, b: Person, d: number): void {
    const h = this.host;
    if (a.staff || b.staff || a.role === "host" || this.grudge[a.id * this.n + b.id]! <= 0) return;
    const heat = this.heatOf(a, b);
    if (heat < SPAT || h.t - this.lastRow[sym(this.n, a.id, b.id)]! < ROW_GAP) return;
    if (d > 1.2 && Math.abs(wrap(Math.atan2(b.x - a.x, b.z - a.z) - a.yaw)) > 1.2) return;
    if (!h.free(a) || !h.free(b)) return;
    this.startRow(a, b, heat >= ACT && a.tipsy > ACT_TIPSY && a.id !== h.spyId ? "act" : heat >= ROW ? "row" : "spat");
  }

  /** A row begins: the sim walks it through (sim.ts: the 'row' action). */
  private startRow(a: Person, b: Person, kind: RowKind, act: RowAct | null = null, logged = false): void {
    const h = this.host;
    // The spy never strikes; answering someone else's grudge, it takes the sharp word and apologises, so the row is a spat.
    const sorry = b.id === h.spyId && kind !== "spat" && kind !== "hiss";
    if (sorry) {
      kind = "spat";
      act = null;
    } else if (a.id === h.spyId && (kind === "act" || kind === "scuffle")) {
      kind = "row";
      act = null;
    }
    this.lastRow[sym(this.n, a.id, b.id)] = h.t;
    if (kind === "act" && !act)
      act = this.rng.weighted<RowAct>([
        ["shove", 1],
        ["slap", 1],
        ["throw", a.held && a.item >= 0 ? 1 : 0],
      ]);
    const len = kind === "spat" || kind === "hiss" ? this.rng.range(3, 6) : kind === "pull" ? this.rng.range(8, 14) : kind === "scuffle" ? this.rng.range(10, 20) : this.rng.range(15, 45);
    const s = h.beside(b, a, kind === "pull" || kind === "hiss" ? 0.8 : 1.1);
    if (!s) return;
    h.end(a, false);
    h.end(b, false);
    h.start(a, { id: "row", target: s, duration: len, pose: "argue", gain: {}, ref: b.id, note: act ? `${kind}:${act}` : kind });
    h.start(b, { id: "row", target: null, duration: len + 40, pose: "argue", gain: {}, ref: a.id, note: "answer" });
    if (sorry) {
      this.stats.apologies++;
      h.gesture(b, "shrug", 2);
    }
    // An eruption has its own entry in the log.
    if (!logged && kind !== "jealous" && kind !== "pull" && kind !== "scuffle" && !this.apart[a.id]) h.log("row", [a.id, b.id], a.room, act ? `${kind}:${act}` : kind);
  }

  /**
   * The row is over (sim.ts): what it cost. A friendship takes its knock and may end; the pair
   * keep apart a while; the grudge halves; witnesses tense up; after an eruption one of the three
   * storms off.
   */
  rowOver(a: Person, b: Person, note: string): void {
    const h = this.host;
    const kind = note.split(":")[0] as RowKind;
    const key = sym(this.n, a.id, b.id);
    if (kind === "spat") this.stats.spats++;
    else if (kind === "row" || kind === "hiss" || kind === "jealous") this.stats.rows++;
    else if (kind === "act") this.stats.acts++;
    else if (kind === "scuffle") this.stats.scuffles++;
    // The row is news for those who saw it.
    if (kind !== "spat" && kind !== "hiss") {
      h.notable(a, "row", b.id, 20);
      h.notable(b, "row", a.id, 20);
      for (const o of h.people) if (o.present && o !== a && o !== b && o.level === a.level && o.room === a.room && Math.hypot(o.x - a.x, o.z - a.z) < 8) h.mood.witness(o.id, ROW_TENSION);
    }
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const g = x.id * this.n + y.id;
      this.grudge[g] = this.grudgeOf(x.id, y.id) * 0.5;
      this.grudgeT[g] = h.t;
      x.avoid.set(`person:${y.id}`, h.t + this.rng.range(AVOID[0], AVOID[1]));
    }
    const was = this.friend[key]!;
    if (!this.fellOut[key] && a.partner !== b.id) {
      const v = Math.max(0, was - COST[kind]);
      this.friend[key] = v;
      if (was >= FRIEND && v < FALLEN) this.fallOut(a, b, was);
    }
    // After the eruption, someone goes: the partner, the one caught, or the one they were with.
    if (kind === "jealous" || kind === "act" || kind === "scuffle" || kind === "pull") {
      if (a.partner !== null && this.apart[a.id]) {
        const g = this.likelyWith(a);
        const three = [a, h.people[a.partner]!, ...(g >= 0 ? [h.people[g]!] : [])].filter((q) => q.present && !q.gone);
        const who = this.rng.pick(three);
        if (who && h.free(who)) h.stormOff(who, this.rng.chance(1 / 3));
      }
    }
  }

  /** A friendship ends: out of each other's friends, gossip, mutual friends take sides, and the one left alone sulks. */
  private fallOut(a: Person, b: Person, was: number): void {
    const h = this.host;
    const key = sym(this.n, a.id, b.id);
    this.fellOut[key] = 1;
    this.fellAt[key] = h.t;
    this.before[key] = was;
    this.friend[key] = Math.min(this.friend[key]!, FALLEN - 0.01);
    a.friends = a.friends.filter((x) => x !== b.id);
    b.friends = b.friends.filter((x) => x !== a.id);
    this.stats.fellOut++;
    h.log("bond", [a.id, b.id], a.room, "fell-out");
    h.memory.observe(a.id, "fell-out", a.id, b.id, a.room);
    h.memory.observe(b.id, "fell-out", a.id, b.id, a.room);
    // Mutual friends take sides: a little cooler toward the one they're less close to, unless close to both.
    for (const c of h.people) {
      if (c === a || c === b || !c.friends.includes(a.id) || !c.friends.includes(b.id)) continue;
      const fa = this.friendOf(c.id, a.id);
      const fb = this.friendOf(c.id, b.id);
      if (fa >= CLOSE_FRIEND && fb >= CLOSE_FRIEND) continue;
      const far = fa < fb ? a : b;
      const k = sym(this.n, c.id, far.id);
      this.friend[k] = Math.max(0, this.friend[k]! - 0.2);
    }
    for (const x of [a, b]) {
      const any = x.friends.some((f) => h.people[f]!.present && !h.people[f]!.gone) || (x.partner !== null && h.people[x.partner]!.present && !this.apart[x.id]);
      if (any || x.staff || x.role === "host") continue;
      this.sulk[x.id] = 1;
      x.early ??= "sulking";
    }
  }

  /** A fallen-out pair meet again: after half an hour, a friendship that was close may be made up. */
  private maybeMakeUp(a: Person, b: Person, key: number): void {
    const h = this.host;
    if (h.t - this.fellAt[key]! < MAKE_UP_AFTER || this.before[key]! < MAKE_UP_FROM || !h.free(a) || !h.free(b)) return;
    const who = a.traits.loyalty >= b.traits.loyalty ? a : b;
    if (!this.rng.chance((1 / 3) * (0.5 + who.traits.loyalty))) return;
    this.fellOut[key] = 0;
    this.friend[key] = FRIEND;
    this.befriend(a, b);
    a.avoid.delete(`person:${b.id}`);
    b.avoid.delete(`person:${a.id}`);
    this.sulk[a.id] = 0;
    this.sulk[b.id] = 0;
    this.stats.madeUp++;
    h.memory.observe(a.id, "made-up", a.id, b.id, a.room);
    h.memory.observe(b.id, "made-up", a.id, b.id, a.room);
    h.log("bond", [who.id, who === a ? b.id : a.id], a.room, "made-up");
    const s = h.beside(who === a ? b : a, who, 0.7);
    if (!s) return;
    const other = who === a ? b : a;
    h.end(who, false);
    h.end(other, false);
    h.start(who, { id: "row", target: s, duration: 4, pose: "hug", gain: { social: 0.3 }, ref: other.id, note: "hug" });
    h.start(other, { id: "row", target: null, duration: 44, pose: "hug", gain: { social: 0.3 }, ref: who.id, note: "answer" });
  }

  // ---------------------------------------------------------------- slipping away

  /** Every SLIP_EVERY: a tipsy couple (or a stray and their lover) standing close may slip off to a bedroom. */
  slipCheck(): void {
    const h = this.host;
    const ph = h.phaseId;
    if (ph === "toast" || ph === "dinner" || ph === "champagne" || ph === "arrival") return;
    for (const a of h.people) for (const j of [a.partner !== null && a.partner > a.id ? a.partner : -1, this.stray[a.id] ? this.lover[a.id]! : -1]) this.maySlip(a, j);
  }

  /** a and j (a partner, or a stray's lover), close together and tipsy: maybe off they go. */
  private maySlip(a: Person, j: number): void {
    const h = this.host;
    if (j < 0 || this.slipped[a.id] || this.slipped[j] || this.stats.slipAways >= SLIPS_MAX) return;
    const b = h.people[j]!;
    if (!a.present || !b.present || a.staff || b.staff || a.role === "host" || b.role === "host" || this.apart[a.id] || this.apart[b.id]) return;
    if (a.tipsy < SLIP_TIPSY || b.tipsy < SLIP_TIPSY || a.level !== b.level || a.room !== b.room || Math.hypot(a.x - b.x, a.z - b.z) > 3) return;
    if (!h.free(a) || !h.free(b) || (this.lover[a.id] === j && !this.hidden(a, b))) return;
    if (!this.rng.chance(SLIP_CHANCE)) return;
    const lead = a.tipsy >= b.tipsy ? a : b;
    if (!h.slipAway(lead, lead === a ? b : a)) return;
    this.stats.slipAways++;
    this.slipped[a.id] = 1;
    this.slipped[b.id] = 1;
  }

  /** They come out (tasks.ts): dishevelled, and anyone who sees them come out knows. */
  cameOut(a: Person, b: Person, room: number): void {
    const h = this.host;
    h.notable(a, "slipped-away", b.id, DISHEVELLED, room);
    h.notable(b, "slipped-away", a.id, DISHEVELLED, room);
    h.log("slip-away", [a.id, b.id], room, "out");
  }
}
