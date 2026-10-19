/**
 * Everything people know (milestone 2 technical plan: Memory): where they last saw each
 * other, the facts they saw or were told, gossip, suspicion, and their mental map of the house.
 *
 * `observe()` (from the senses) and `tell()` (from gossip and asking) are the only ways a
 * fact gets into someone's head. Confidence fades lazily from each fact's half-life, so
 * nothing ticks per step; familiarity with rooms fades the same way.
 */
import type { Rng } from "../mansion/core/rng";
import type { Person } from "./types";

export type FactKind = "romance" | "odd" | "mishap" | "house" | "request" | "whereabouts" | "case";

/** What a fact says. Odd acts carry a suspicion weight (the plan's starting values). */
export type Verb =
  | "flirting"
  | "couple"
  | "cheating"
  | "left-bedroom"
  | "startled"
  | "fumbled"
  | "no-champagne"
  | "out-of-step"
  | "slapped"
  | "bandage-gone"
  | "not-themselves"
  | "wrong-turn"
  | "locked-door"
  | "rumour"
  | "spill"
  | "cut"
  | "tipsy"
  | "bathroom-taken"
  | "dark"
  | "crash"
  | "raised-voices"
  | "scream"
  | "looking-for"
  | "was-in"
  | "gone"
  | "missing"
  | "blamed"
  | "snooping"
  | "hovering"
  | "rude"
  | "carrying"
  | "row"
  | "fell-out"
  | "made-up"
  | "slipped-away"
  | "twisted-ankle"
  | "fainted"
  | "lost-thing"
  | "crying"
  | "drunk"
  | "broke"
  | "camera-shy";

export interface VerbSpec {
  kind: FactKind;
  /** How much people want to pass it on, 0 to 1. */
  juicy: number;
  /** Suspicion weight; 0 for most facts. */
  odd: number;
  /** In-game seconds for confidence to halve. */
  halfLife: number;
  /** The object is a thing (an item id), not a person. */
  thing?: boolean;
  /** The room is where it happened, not where the subject was then (a thing gone, a case settled). */
  elsewhere?: boolean;
}

const MIN = 60;
export const VERBS: Record<Verb, VerbSpec> = {
  flirting: { kind: "romance", juicy: 0.9, odd: 0, halfLife: 90 * MIN },
  couple: { kind: "romance", juicy: 0.9, odd: 0, halfLife: 90 * MIN },
  cheating: { kind: "romance", juicy: 1, odd: 0, halfLife: 90 * MIN },
  "left-bedroom": { kind: "odd", juicy: 0.8, odd: 0.15, halfLife: 45 * MIN },
  startled: { kind: "odd", juicy: 0.6, odd: 0.1, halfLife: 45 * MIN },
  fumbled: { kind: "odd", juicy: 0.6, odd: 0.1, halfLife: 45 * MIN },
  "no-champagne": { kind: "odd", juicy: 0.4, odd: 0.05, halfLife: 45 * MIN },
  "out-of-step": { kind: "odd", juicy: 0.4, odd: 0.05, halfLife: 45 * MIN },
  slapped: { kind: "odd", juicy: 0.9, odd: 0.2, halfLife: 45 * MIN },
  "bandage-gone": { kind: "odd", juicy: 0.7, odd: 0.25, halfLife: 45 * MIN },
  "not-themselves": { kind: "odd", juicy: 0.5, odd: 0.02, halfLife: 45 * MIN },
  "wrong-turn": { kind: "odd", juicy: 0.2, odd: 0.03, halfLife: 45 * MIN },
  "locked-door": { kind: "odd", juicy: 0.4, odd: 0.05, halfLife: 45 * MIN },
  rumour: { kind: "odd", juicy: 1, odd: 0.15, halfLife: 45 * MIN },
  spill: { kind: "mishap", juicy: 0.6, odd: 0, halfLife: 60 * MIN },
  cut: { kind: "mishap", juicy: 0.7, odd: 0, halfLife: 60 * MIN },
  tipsy: { kind: "mishap", juicy: 0.3, odd: 0, halfLife: 60 * MIN },
  "bathroom-taken": { kind: "house", juicy: 0.2, odd: 0, halfLife: 20 * MIN },
  dark: { kind: "house", juicy: 0.5, odd: 0, halfLife: 20 * MIN },
  crash: { kind: "house", juicy: 0.5, odd: 0, halfLife: 20 * MIN },
  "raised-voices": { kind: "house", juicy: 0.6, odd: 0, halfLife: 20 * MIN },
  scream: { kind: "house", juicy: 1, odd: 0, halfLife: 20 * MIN },
  "looking-for": { kind: "request", juicy: 0.7, odd: 0, halfLife: Infinity },
  "was-in": { kind: "whereabouts", juicy: 0.2, odd: 0, halfLife: 30 * MIN },
  // Connecting the dots (register.ts): something gone with nobody to blame yet, someone missing,
  // a case settled on someone, and someone seen poking round a private room. Suspicion from a
  // case comes through the register, so these carry none of their own.
  gone: { kind: "case", juicy: 0.8, odd: 0, halfLife: 90 * MIN, thing: true, elsewhere: true },
  missing: { kind: "case", juicy: 0.9, odd: 0, halfLife: 90 * MIN },
  blamed: { kind: "case", juicy: 0.9, odd: 0, halfLife: 90 * MIN, thing: true, elsewhere: true },
  snooping: { kind: "odd", juicy: 0.7, odd: 0.05, halfLife: 45 * MIN },
  // Everyday life (PR 3a): hovering at the edge of a circle nobody opened, breaking a practice's
  // norm (talking through the speech, sitting before the host), and carrying something of the
  // house's (the object is the thing).
  hovering: { kind: "odd", juicy: 0.3, odd: 0.03, halfLife: 45 * MIN },
  rude: { kind: "odd", juicy: 0.4, odd: 0.03, halfLife: 45 * MIN },
  carrying: { kind: "whereabouts", juicy: 0.3, odd: 0, halfLife: 30 * MIN, thing: true },
  // Ties (PR 3b): words between two, a friendship ended or made up, a couple seen coming out of a bedroom.
  row: { kind: "mishap", juicy: 0.8, odd: 0, halfLife: 60 * MIN },
  "fell-out": { kind: "mishap", juicy: 0.8, odd: 0, halfLife: 90 * MIN },
  "made-up": { kind: "mishap", juicy: 0.5, odd: 0, halfLife: 60 * MIN },
  "slipped-away": { kind: "romance", juicy: 1, odd: 0, halfLife: 90 * MIN, elsewhere: true },
  // Mishaps and small dramas (dramas.ts): innocent, and worth telling.
  "twisted-ankle": { kind: "mishap", juicy: 0.5, odd: 0, halfLife: 60 * MIN },
  fainted: { kind: "mishap", juicy: 0.7, odd: 0, halfLife: 60 * MIN },
  "lost-thing": { kind: "mishap", juicy: 0.4, odd: 0, halfLife: 45 * MIN, thing: true },
  crying: { kind: "mishap", juicy: 0.9, odd: 0, halfLife: 60 * MIN },
  drunk: { kind: "mishap", juicy: 0.8, odd: 0, halfLife: 60 * MIN },
  broke: { kind: "mishap", juicy: 0.7, odd: 0, halfLife: 60 * MIN },
  /** Turned away from a camera, or slipped out of a photograph: the baseline for keeping out of the picture. */
  "camera-shy": { kind: "odd", juicy: 0.3, odd: 0.04, halfLife: 45 * MIN },
};
export const VERB_IDS = Object.keys(VERBS) as Verb[];

/** Facts each person can hold; a full memory drops the weakest. */
export const SLOTS = 48;
/** Below this confidence a fact is not passed on. */
export const PASS_MIN = 0.2;
/** Listeners learn a fact at this share of the teller's confidence. */
export const PASS_ON = 0.8;
/** The same thing seen again within this long (in-game s) of its last sighting is the same fact. */
const SAME_FACT = 60;
/** Suspicion halves over this long (in-game s). */
const SUSPICION_HALF = 40 * MIN;
export const WARY = 0.35;
export const SUSPICIOUS = 0.55;
/** Trust lowers how much an odd fact counts against a friend or a partner. */
const TRUST_FRIEND = 0.5;
const TRUST_PARTNER = 0.8;

/** Familiarity with a room halves toward its floor over this long (in-game s), sober. */
const MAP_HALF = 45 * MIN;
/** Each visit to a room keeps this much of it for the evening (up to 0.6): once there, the way is remembered; twice, never lost. */
const VISIT_FLOOR = 0.45;
/** Seeing into a room teaches it at most this often (in-game s). */
const SEE_INTO_EVERY = 60;
/** Below this familiarity a person doesn't plan through or toward a room. */
export const KNOWN = 0.3;
/** Below this, a junction toward the room can go wrong. */
export const SURE = 0.5;

/** What memory needs from the party. */
export interface MemoryHost {
  readonly t: number;
  readonly people: Person[];
  /** Each person's tension (0 to 1), from the mood. */
  tensionOf(i: number): number;
  /** How much more (or, at 0, not at all) a speaker passes a fact on in front of these listeners (bonds.ts: who tells a partner). */
  gossipWeight?(f: number, speaker: number, listeners: readonly number[]): number;
}

/** Told about a fact: the register files its own copy (register.ts). */
export type ToldHook = (i: number, f: number, from: number) => void;

export interface Gossip {
  fact: number;
  speaker: number;
  listeners: number[];
  overheard: number[];
}

export class Memory {
  readonly n: number;
  /** Rooms plus the terrace (index M - 1). */
  readonly M: number;

  // ---- last seen: n × n, row = who saw, column = whom
  readonly lastT: Float32Array;
  readonly lastRoom: Int16Array;
  /** Their action then, as an index into ACTIONS + 1 (0 = none). */
  readonly lastAct: Uint8Array;
  /** 1 when the note came from someone else. */
  readonly secondHand: Uint8Array;
  /** When each person last saw each other holding an alcoholic drink. */
  readonly sawDrinking: Float32Array;

  // ---- facts, struct-of-arrays, growing in chunks of 256
  count = 0;
  verb = new Uint8Array(0);
  subject = new Int16Array(0);
  object = new Int16Array(0);
  room = new Int16Array(0);
  t = new Float32Array(0);
  juicy = new Float32Array(0);
  odd = new Float32Array(0);
  settled = new Uint8Array(0);
  /** When each fact was last seen happening (a state like being tipsy stays one fact while it's watched). */
  lastAt = new Float32Array(0);
  private readonly recent = new Map<string, number>();

  // ---- each person's slots: n × SLOTS
  readonly held: Uint8Array;
  readonly sFact: Int32Array;
  readonly sConf: Float32Array;
  readonly sT: Float32Array;
  readonly sFrom: Int16Array;
  readonly sHops: Uint8Array;

  // ---- suspicion, n × n: how much i suspects j
  readonly suspicion: Float32Array;

  // ---- the mental map, n × M
  readonly know: Float32Array;
  readonly knowT: Float32Array;
  readonly visits: Uint8Array;
  private readonly seenIntoT: Float32Array;
  /** The household never forgets the house. */
  readonly household: Uint8Array;
  /** Someone of the household who learns the house like anyone else (the spy playing the host): the household still counts them, their map is their own. */
  readonly ownMap: Uint8Array;

  readonly stats = { told: 0, overheard: 0, facts: 0 };
  /** Called whenever someone is told a fact, news or not (the register listens). */
  onTold: ToldHook | null = null;

  constructor(
    private readonly host: MemoryHost,
    rooms: number,
    private readonly rng: Rng,
  ) {
    const n = host.people.length;
    this.n = n;
    this.M = rooms + 1;
    this.lastT = new Float32Array(n * n).fill(-1e9);
    this.lastRoom = new Int16Array(n * n).fill(-1);
    this.lastAct = new Uint8Array(n * n);
    this.secondHand = new Uint8Array(n * n);
    this.sawDrinking = new Float32Array(n * n).fill(-1e9);
    this.held = new Uint8Array(n);
    this.sFact = new Int32Array(n * SLOTS).fill(-1);
    this.sConf = new Float32Array(n * SLOTS);
    this.sT = new Float32Array(n * SLOTS);
    this.sFrom = new Int16Array(n * SLOTS);
    this.sHops = new Uint8Array(n * SLOTS);
    this.suspicion = new Float32Array(n * n);
    this.know = new Float32Array(n * this.M);
    this.knowT = new Float32Array(n * this.M);
    this.visits = new Uint8Array(n * this.M);
    this.seenIntoT = new Float32Array(n * this.M).fill(-1e9);
    this.household = new Uint8Array(n);
    this.ownMap = new Uint8Array(n);
    this.grow(256);
  }

  private grow(cap: number): void {
    const keep = <T extends { set(a: ArrayLike<number>): void }>(a: T, b: T): T => (b.set(a as unknown as ArrayLike<number>), b);
    this.verb = keep(this.verb, new Uint8Array(cap));
    this.subject = keep(this.subject, new Int16Array(cap));
    this.object = keep(this.object, new Int16Array(cap));
    this.room = keep(this.room, new Int16Array(cap));
    this.t = keep(this.t, new Float32Array(cap));
    this.juicy = keep(this.juicy, new Float32Array(cap));
    this.odd = keep(this.odd, new Float32Array(cap));
    this.settled = keep(this.settled, new Uint8Array(cap));
    this.lastAt = keep(this.lastAt, new Float32Array(cap));
  }

  // ---------------------------------------------------------------- last seen

  /** i sees j now, in a room, doing something. */
  seen(i: number, j: number, room: number, act: number): void {
    const k = i * this.n + j;
    this.lastT[k] = this.host.t;
    this.lastRoom[k] = room;
    this.lastAct[k] = act;
    this.secondHand[k] = 0;
  }

  /** i is told where j was, and when (an older time than a sighting of their own wins). */
  toldWhere(i: number, j: number, room: number, t: number): void {
    const k = i * this.n + j;
    if (this.lastT[k]! >= t) return;
    this.lastT[k] = t;
    this.lastRoom[k] = room;
    this.lastAct[k] = 0;
    this.secondHand[k] = 1;
  }

  // -------------------------------------------------------------------- facts

  verbOf(f: number): Verb {
    return VERB_IDS[this.verb[f]!]!;
  }

  /**
   * The fact that something happened, created once and shared: the same thing (the same verb,
   * subject, object and room) seen again within a minute of its last sighting is the same fact.
   */
  fact(verb: Verb, subject: number, object = -1, room = -1, juicy?: number, odd?: number): number {
    const key = `${verb}:${subject}:${object}:${room}`;
    const at = this.recent.get(key);
    if (at !== undefined && this.host.t - this.lastAt[at]! <= SAME_FACT) {
      this.lastAt[at] = this.host.t;
      return at;
    }
    if (this.count >= this.verb.length) this.grow(this.verb.length + 256);
    const f = this.count++;
    const spec = VERBS[verb];
    this.verb[f] = VERB_IDS.indexOf(verb);
    this.subject[f] = subject;
    this.object[f] = object;
    this.room[f] = room;
    this.t[f] = this.host.t;
    this.juicy[f] = juicy ?? spec.juicy;
    this.odd[f] = odd ?? spec.odd;
    this.settled[f] = 0;
    this.lastAt[f] = this.host.t;
    this.recent.set(key, f);
    this.stats.facts++;
    return f;
  }

  /** i saw it happen. */
  observe(i: number, verb: Verb, subject: number, object = -1, room = -1): number {
    const f = this.fact(verb, subject, object, room);
    this.learn(i, f, 1, -1, 0);
    return f;
  }

  /** The slot holding a fact for i, or -1. */
  slotOf(i: number, f: number): number {
    const base = i * SLOTS;
    const h = this.held[i]!;
    for (let s = 0; s < h; s++) if (this.sFact[base + s] === f) return base + s;
    return -1;
  }

  knows(i: number, f: number): boolean {
    return this.slotOf(i, f) >= 0;
  }

  /** Whether i holds any fact of this kind about someone, still believed. */
  knowsAbout(i: number, verb: Verb, subject: number): boolean {
    const v = VERB_IDS.indexOf(verb);
    const base = i * SLOTS;
    for (let s = base; s < base + this.held[i]!; s++) {
      const f = this.sFact[s]!;
      if (this.verb[f] === v && this.subject[f] === subject && this.confAt(i, s) > PASS_MIN) return true;
    }
    return false;
  }

  /** Confidence in a slot now: it halves over the fact's half-life, half again as long for facts about a friend or partner. */
  confAt(i: number, slot: number): number {
    const f = this.sFact[slot]!;
    if (f < 0) return 0;
    let hl = VERBS[this.verbOf(f)].halfLife;
    if (hl === Infinity) return this.settled[f] ? 0 : this.sConf[slot]!;
    const p = this.host.people[i]!;
    const s = this.subject[f]!;
    if (s >= 0 && (p.partner === s || p.friends.includes(s))) hl *= 1.5;
    return this.sConf[slot]! * 0.5 ** ((this.host.t - this.sT[slot]!) / hl);
  }

  /** How sure i is of a fact (0 when they don't hold it). */
  confidence(i: number, f: number): number {
    const s = this.slotOf(i, f);
    return s < 0 ? 0 : this.confAt(i, s);
  }

  /**
   * i comes to hold a fact, seen (from = -1) or told. Returns true when it is news to them.
   * An odd fact about someone raises i's suspicion of them, less for a friend or a partner
   * (unless `quiet`: a conclusion the register has already weighed).
   */
  learn(i: number, f: number, conf: number, from: number, hops: number, quiet = false): boolean {
    const t = this.host.t;
    const have = this.slotOf(i, f);
    if (have >= 0) {
      if (conf > this.confAt(i, have)) {
        this.sConf[have] = conf;
        this.sT[have] = t;
      }
      if (hops < this.sHops[have]!) this.sHops[have] = hops;
      return false;
    }
    const base = i * SLOTS;
    let slot: number;
    if (this.held[i]! < SLOTS) slot = base + this.held[i]!++;
    else {
      // Full: drop the weakest, by confidence times juiciness.
      slot = base;
      let worst = Infinity;
      for (let s = base; s < base + SLOTS; s++) {
        const v = this.confAt(i, s) * this.juicy[this.sFact[s]!]!;
        if (v < worst) {
          worst = v;
          slot = s;
        }
      }
    }
    this.sFact[slot] = f;
    this.sConf[slot] = conf;
    this.sT[slot] = t;
    this.sFrom[slot] = from;
    this.sHops[slot] = Math.min(255, hops);
    const odd = this.odd[f]!;
    const j = this.subject[f]!;
    // Tense people make more of it.
    if (odd > 0 && j >= 0 && j !== i && !quiet) this.addSuspicion(i, j, odd * conf * (1 - this.trustIn(i, j)) * (1 + this.host.tensionOf(i)));
    return true;
  }

  /** i is told a fact by someone, at a share of the teller's confidence. */
  tell(i: number, f: number, from: number): boolean {
    const s = this.slotOf(from, f);
    if (s < 0) return false;
    const news = this.learn(i, f, this.confAt(from, s) * PASS_ON, from, this.sHops[s]! + 1);
    this.onTold?.(i, f, from);
    return news;
  }

  /** Lab and tests: put a fact straight into someone's head, as if they'd seen it. */
  plant(i: number, verb: Verb, subject: number, odd?: number): number {
    const f = this.fact(verb, subject, -1, -1, undefined, odd);
    this.learn(i, f, 1, -1, 0);
    return f;
  }

  /** How many people present hold a fact (above the pass-on floor). */
  reach(f: number, among: readonly Person[]): number {
    let c = 0;
    for (const p of among) if (this.confidence(p.id, f) > 0) c++;
    return c;
  }

  /**
   * A new speaker in a conversation may pass on one thing they know: weighted by how juicy it is,
   * how sure they are, how many listeners haven't heard it, whether it concerns a listener's friend
   * or partner, and how talkative the speaker is. Nobody gossips about someone standing there.
   */
  onTurn(members: readonly number[], speaker: number, nearby: readonly number[]): Gossip | null {
    const people = this.host.people;
    const sp = people[speaker]!;
    const listeners = members.filter((m) => m !== speaker);
    if (!listeners.length) return null;
    const base = speaker * SLOTS;
    const top: Array<readonly [number, number]> = [];
    for (let s = base; s < base + this.held[speaker]!; s++) {
      const f = this.sFact[s]!;
      const conf = this.confAt(speaker, s);
      if (conf <= PASS_MIN || this.settled[f]) continue;
      const subj = this.subject[f]!;
      const obj = VERBS[this.verbOf(f)].thing ? -1 : this.object[f]!;
      if (members.includes(subj) || (obj >= 0 && members.includes(obj))) continue;
      let unknown = 0;
      let concern = 1;
      for (const l of listeners) {
        if (!this.knows(l, f)) unknown++;
        const q = people[l]!;
        if (subj >= 0 && (q.partner === subj || q.friends.includes(subj))) concern = 2;
      }
      if (!unknown) continue;
      const rule = this.host.gossipWeight?.(f, speaker, listeners) ?? 1;
      if (rule <= 0) continue;
      const score = this.juicy[f]! * conf * unknown * concern * rule * (0.3 + sp.traits.talk);
      top.push([f, score]);
    }
    if (!top.length) return null;
    top.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const f = this.rng.weighted(top.slice(0, 3));
    // Dull things are seldom worth mentioning.
    if (!this.rng.chance(this.juicy[f]!)) return null;
    const told: number[] = [];
    for (const l of listeners) if (this.tell(l, f, speaker)) told.push(l);
    const overheard: number[] = [];
    for (const o of nearby) if (this.rng.chance(0.3) && this.tell(o, f, speaker)) overheard.push(o);
    this.stats.told += told.length;
    this.stats.overheard += overheard.length;
    return { fact: f, speaker, listeners: told, overheard };
  }

  // ---------------------------------------------------------------- suspicion

  suspects(i: number, j: number): number {
    return this.suspicion[i * this.n + j]!;
  }

  /** How much i's trust lowers what counts against j: a partner most, a friend some, anyone else not at all. */
  trustIn(i: number, j: number): number {
    const p = this.host.people[i]!;
    return p.partner === j ? TRUST_PARTNER : p.friends.includes(j) ? TRUST_FRIEND : 0;
  }

  addSuspicion(i: number, j: number, v: number): void {
    const k = i * this.n + j;
    this.suspicion[k] = Math.min(1, this.suspicion[k]! + v);
  }

  /** How suspected someone is on average by everyone else present. */
  suspectedBy(j: number, among: readonly Person[]): number {
    let s = 0;
    let c = 0;
    for (const p of among) {
      if (p.id === j) continue;
      s += this.suspicion[p.id * this.n + j]!;
      c++;
    }
    return c ? s / c : 0;
  }

  // ---------------------------------------------------------------- the house

  private mi(room: number): number {
    return room < 0 ? this.M - 1 : room;
  }

  /** Whether i knows the whole house by heart: the household, unless their map is their own. */
  knowsHouse(i: number): boolean {
    return this.household[i] === 1 && this.ownMap[i] === 0;
  }

  /** How well i knows a room (-2 the terrace) now, 0 to 1. Fades toward a floor for rooms used often. */
  familiarity(i: number, room: number): number {
    if (room === -1) return 0;
    if (this.knowsHouse(i)) return 1;
    const k = i * this.M + this.mi(room);
    const k0 = this.know[k]!;
    if (k0 <= 0) return 0;
    // Never more than was ever learnt: a room crossed in a haze leaves a hazy floor.
    const floor = Math.min(0.6, VISIT_FLOOR * this.visits[k]!, k0);
    const hl = MAP_HALF / (1 + this.host.people[i]!.tipsy);
    return floor + Math.max(0, k0 - floor) * 0.5 ** ((this.host.t - this.knowT[k]!) / hl);
  }

  private setKnow(i: number, room: number, v: number): void {
    const k = i * this.M + this.mi(room);
    this.know[k] = Math.max(0, Math.min(1, v));
    this.knowT[k] = this.host.t;
  }

  /** What someone knows before the evening starts (or learns all at once): at least `v`, and at least `visits` visits' worth of floor. */
  startKnowing(i: number, room: number, v: number, visits = 0): void {
    if (room === -1) return;
    this.setKnow(i, room, Math.max(v, this.familiarity(i, room)));
    const k = i * this.M + this.mi(room);
    this.visits[k] = Math.max(this.visits[k]!, Math.min(255, visits));
  }

  /** Someone who has never been here after all (the spy in another's record): their map wiped, to be learnt afresh. */
  forgetHouse(i: number): void {
    const a = i * this.M;
    this.know.fill(0, a, a + this.M);
    this.knowT.fill(0, a, a + this.M);
    this.visits.fill(0, a, a + this.M);
    this.seenIntoT.fill(-1e9, a, a + this.M);
  }

  /** Walking into a room: learnt well, less so when tipsy. */
  walkInto(i: number, room: number): void {
    if (room === -1 || this.knowsHouse(i)) return;
    const k = this.familiarity(i, room);
    this.setKnow(i, room, k + 0.5 * (1 - k) * (1 - 0.5 * this.host.people[i]!.tipsy));
    const v = i * this.M + this.mi(room);
    if (this.visits[v]! < 255) this.visits[v]!++;
  }

  /** Seeing into a room through a doorway or glass (at most once a minute per room). */
  seeInto(i: number, room: number): void {
    if (room === -1 || this.knowsHouse(i)) return;
    const v = i * this.M + this.mi(room);
    if (this.host.t - this.seenIntoT[v]! < SEE_INTO_EVERY) return;
    this.seenIntoT[v] = this.host.t;
    const k = this.familiarity(i, room);
    this.setKnow(i, room, k + 0.1 * (1 - k));
  }

  /** Someone pointed the way: a rough idea of every room along it. */
  pointed(i: number, rooms: readonly number[]): void {
    if (this.knowsHouse(i)) return;
    for (const r of rooms) {
      if (r === -1) continue;
      const k = this.familiarity(i, r);
      this.setKnow(i, r, k + 0.3 * (1 - k));
    }
  }

  /** The chance of a wrong turn at a junction toward a room known this well. */
  static wrongTurnChance(k: number, tipsy: number): number {
    return Math.max(0, Math.min(0.9, (SURE - k) * (1 + tipsy)));
  }

  // ------------------------------------------------------------------- upkeep

  /** Once an in-game minute: suspicion fades. Facts and rooms fade lazily when read. */
  upkeep(dt: number): void {
    const k = 0.5 ** (dt / SUSPICION_HALF);
    const s = this.suspicion;
    for (let i = 0; i < s.length; i++) if (s[i]! > 0) s[i]! *= k;
  }
}
