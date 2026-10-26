/**
 * Connecting the dots (milestone 2 technical plan: The register).
 *
 * Each person keeps three kinds of entry: cases (something happened with a blank in it: a thing
 * gone and nobody knows who took it), sightings (someone was somewhere) and claims (what someone
 * said about themselves). Sightings and claims share one record, any slot of which may be open:
 * who (a person, or only a description), verb, object, room, a window of time, confidence, the
 * teller and the original witness, and hops.
 *
 * Whenever something is filed it is checked against the rest. A sighting that falls in a case's
 * room and window makes whoever was seen a candidate; each original witness counts once, and a
 * clear lead settles the case. A sighting that can't be true beside another (two places at once),
 * or that breaks someone's claim, costs the teller some trust, or makes the holder doubt or
 * suspect the person. A description resolves to a name when one known face fits it clearly, and
 * is checked again. Drink blurs what is filed: the window widens and drifts, the room can slip to
 * the next one, looks lose detail, and who said it can be forgotten.
 *
 * What a case looks like is data (`CASES`): a new kind of connecting the dots is a new row.
 * Nothing here ticks: every check runs when something is filed.
 */
import type { Rng } from "../mansion/core/rng";
import { TIE_WEIGHT, type Ident } from "./ident";
import { PASS_ON, VERB_IDS, VERBS, type Memory, type Verb } from "./memory";
import type { PartyEvent, Person } from "./types";
import type { World } from "./world";

const MIN = 60;

// ----------------------------------------------------------------- case templates

export type CaseKind = "gone" | "person-gone" | "dark" | "locked" | "noise" | "cheating" | "not-themselves" | "planted";
export const CASE_KINDS: readonly CaseKind[] = ["gone", "person-gone", "dark", "locked", "noise", "cheating", "not-themselves", "planted"];

export interface CaseTemplate {
  /**
   * What fills the blank. place: whoever was seen in the room around then. pair: whoever the
   * subject was seen close with. doubt: nobody; things about the subject that don't fit add up.
   */
  match: "place" | "pair" | "doubt";
  /** Suspicion of the one to blame, at full certainty (0 when it is nobody's fault). */
  severity: number;
  /** The leading candidate's share that settles it (the next must be under half of it). */
  settle: number;
  /** How far before it was noticed the window opens, when nobody knows better (in-game s). */
  lookBack: number;
  /** How much people want to talk about it. */
  juicy: number;
  /** The memory verb it travels as. */
  verb: Verb;
}

/**
 * The case templates. A thing gone is serious enough that a settled case makes the holder wary
 * of the one they blame (0.6 × 0.6 > WARY); a crash is nobody's fault, only gossip. A thing
 * gone settles on one's own eyes or two independent tellers; cheating on a friend's word or two
 * acquaintances (the user's call, 2026-10-10).
 */
export const CASES: Record<CaseKind, CaseTemplate> = {
  gone: { match: "place", severity: 0.6, settle: 0.6, lookBack: 20 * MIN, juicy: 0.8, verb: "gone" },
  "person-gone": { match: "place", severity: 0.5, settle: 0.6, lookBack: 20 * MIN, juicy: 0.9, verb: "missing" },
  dark: { match: "place", severity: 0.15, settle: 0.6, lookBack: 2 * MIN, juicy: 0.5, verb: "dark" },
  locked: { match: "place", severity: 0.1, settle: 0.6, lookBack: 5 * MIN, juicy: 0.4, verb: "locked-door" },
  noise: { match: "place", severity: 0, settle: 0.6, lookBack: 1 * MIN, juicy: 0.6, verb: "crash" },
  cheating: { match: "pair", severity: 0, settle: 0.52, lookBack: 90 * MIN, juicy: 1, verb: "cheating" },
  "not-themselves": { match: "doubt", severity: 0.05, settle: 0.6, lookBack: 0, juicy: 0.5, verb: "not-themselves" },
  // A bug found under a table or a sofa (milestone 3, PR 3): whoever sat or lingered there in the last two hours.
  planted: { match: "place", severity: 0.5, settle: 0.6, lookBack: 120 * MIN, juicy: 1, verb: "planted" },
};

// ----------------------------------------------------------------------- sizes

/** Sightings, then claims, per person (one record shape). */
export const SIGHTINGS = 48;
export const CLAIMS = 16;
const E = SIGHTINGS + CLAIMS;
/** Cases per person, and the candidates kept on each. */
export const CASE_SLOTS = 8;
export const CANDIDATES = 6;
/** Features in a description: sex, height (cm), build, colour (r, g, b), visible quirks (bits). */
const D = 7;
const F_SEX = 1;
const F_HEIGHT = 2;
const F_BUILD = 4;
const F_COLOUR = 8;
const F_QUIRKS = 16;
const ALL = F_SEX | F_HEIGHT | F_BUILD | F_COLOUR | F_QUIRKS;
/** What drink takes first from a description. */
const FORGET_ORDER = [F_COLOUR, F_BUILD, F_HEIGHT] as const;

/** Teller of an entry seen with one's own eyes, and of one whose source is forgotten. */
export const OWN = -1;
export const FORGOT = -2;

// ---------------------------------------------------------------------- numbers

/** The same person in the same room within this long (in-game s) of the last look is one sighting. */
const MERGE = 60;
/** An entry's confidence halves over this long (in-game s). */
const HALF = 45 * MIN;
/** Windows this far apart (in-game s) no longer fit at all. */
const FIT_GAP = 10 * MIN;
/** A room joined to the case's room by a doorway or stair fits this well. */
const NEXT_ROOM = 0.4;
/** Two sightings in rooms not joined that overlap by this long (in-game s) can't both be true. */
const CLASH = 2 * MIN;
/** A sighting this strong (confidence × source weight) doesn't give way. */
const FIRM = 0.6;
/** Trust lost in a teller whose story gave way, at most; it comes back over an hour. */
const BELIEF_DROP = 0.2;
const BELIEF_HALF = 60 * MIN;
const BELIEF_FLOOR = 0.2;
/** Two firm sources that can't both be true: doubt and suspicion of the person. */
const FIRM_DOUBT = 0.15;
const FIRM_SUSPECT = 0.05;
/** A claim broken when it answered no case. */
const CLAIM_NONE = 0.1;
/** A description binds to a name when the best fit is this good and the next under RESOLVE_NEXT. */
const RESOLVE = 0.8;
const RESOLVE_NEXT = 0.5;
/** Weight left for someone the holder hasn't heard about: P = w / (Σw + UNKNOWN). */
const UNKNOWN = 0.5;
/** An unresolved description votes this share for each known face that fits it. */
const SPREAD = 0.5;
/** A claim of having been elsewhere takes at most this share off a candidate's weight. */
const ALIBI = 0.5;
/** Drink: the window widens by (1 + 6t) min each side, drifts by σ = 4t min, slips a room with chance 0.3t; a feature goes with chance t; the source with chance 0.5t. */
const BLUR = 1 * MIN;
const BLUR_TIPSY = 6 * MIN;
const DRIFT_TIPSY = 4 * MIN;
const SLIP = 0.3;
const FORGET_SOURCE = 0.5;
/** Talk: asking around about a case this serious, at most this often, at this chance (× 0.4 + talk). */
const ASK_SEVERITY = 0.3;
const ASK_EVERY = 10 * MIN;
const ASK = 0.5;
/** Passing on what points at someone, once they lead with this share. */
const LEAD = 0.3;
const LEAD_TALK = 0.3;
/** Evidence worth giving when asked (fit × confidence). */
const WORTH = 0.15;
/** Saying where one has just been on joining a conversation: a stay this long, ended this recently. */
const CLAIM_TALK = 0.3;
const STAY = 60;
const CLAIM_RECENT = 10 * MIN;
/** A settled case about the household's things: a guest who knows the host goes and tells them with this chance, within this long. */
const TELL = 0.5;
const TELL_FOR = 30 * MIN;

/** What the register needs from the party. */
export interface RegisterHost {
  readonly t: number;
  readonly people: Person[];
  readonly memory: Memory;
  readonly ident: Ident;
  readonly world: World;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
}

/** A case as the lab shows it. */
export interface CaseView {
  slot: number;
  kind: CaseKind;
  subject: number;
  object: number;
  room: number;
  from: number;
  to: number;
  state: "open" | "settled" | "closed";
  firstHand: boolean;
  teller: number;
  candidates: Array<{ who: number; p: number }>;
}

/** A sighting or claim as the lab shows it. */
export interface EntryView {
  slot: number;
  claim: boolean;
  who: number;
  verb: Verb;
  room: number;
  from: number;
  to: number;
  conf: number;
  teller: number;
  witness: number;
}

/** What a turn of case talk did, for the party to show. */
export interface CaseTalk {
  what: "ask" | "lead";
  kind: CaseKind;
  room: number;
  /** Whoever answered (ask), or the one pointed at (lead). */
  others: number[];
}

export class Register {
  readonly n: number;
  /** Rooms plus the terrace (index R). */
  private readonly R: number;
  /** Rooms joined by a doorway, French window or stair, (R + 1) × (R + 1). */
  private readonly adj: Uint8Array;
  private readonly nbrs: number[][];
  /** Rooms a guest has no business in: anyone seen there is noted. */
  private readonly watchedRoom: Uint8Array;

  // ---- sightings and claims, n × E
  readonly used: Uint8Array;
  private readonly gen: Uint32Array;
  readonly who: Int16Array;
  readonly verb: Uint8Array;
  readonly obj: Int16Array;
  readonly room: Int16Array;
  /** The window as filed (in-game s), before drink's drift and blur. */
  private readonly from: Float32Array;
  private readonly to: Float32Array;
  private readonly drift: Float32Array;
  private readonly blur: Float32Array;
  /** How long they were seen there (or said they were): within the window, the stretch they surely were. */
  private readonly span: Float32Array;
  private readonly conf: Float32Array;
  private readonly at: Float32Array;
  readonly teller: Int16Array;
  readonly witness: Int16Array;
  readonly hops: Uint8Array;
  /** The memory fact it came with (-1 none): a fact told on carries this entry with it. */
  private readonly fact: Int32Array;
  /** Own eyes only: whom they were watching and where, to run on a continuous sighting. Never read as knowledge. */
  private readonly track: Int16Array;
  private readonly trackRoom: Int16Array;
  private readonly desc: Float32Array;
  private readonly mask: Uint8Array;

  // ---- cases, n × CASE_SLOTS
  readonly cUsed: Uint8Array;
  readonly cKind: Uint8Array;
  readonly cSubject: Int16Array;
  readonly cObj: Int16Array;
  readonly cRoom: Int16Array;
  readonly cFrom: Float32Array;
  readonly cTo: Float32Array;
  private readonly cAt: Float32Array;
  readonly cTeller: Int16Array;
  private readonly cWitness: Int16Array;
  private readonly cHops: Uint8Array;
  private readonly cFact: Int32Array;
  /** 0 open, 1 settled, 2 closed with nobody to blame. */
  readonly cState: Uint8Array;
  /** Evidence for a doubt case. */
  private readonly cWeight: Float32Array;
  private readonly cAsked: Float32Array;
  /** The 'blamed' fact a settled case made (-1 none). */
  private readonly cBlamed: Int32Array;
  readonly cand: Int16Array;
  readonly candP: Float32Array;
  /** Suspicion already added per case and person, so a case only ever adds its rise. */
  private readonly given: Float32Array;
  private readonly openN: Uint8Array;

  // ---- per pair and per person
  /** Trust lost in a teller (n × n), and when. */
  private readonly beliefLoss: Float32Array;
  private readonly beliefT: Float32Array;
  /** Claims of someone's found broken (n × n). */
  private readonly broke: Uint8Array;
  /** Where each person is and has been, from their own feet: for saying where they've just been. */
  private readonly curRoom: Int16Array;
  private readonly curFrom: Float32Array;
  private readonly prevRoom: Int16Array;
  private readonly prevFrom: Float32Array;
  private readonly prevTo: Float32Array;
  /** A case to tell the host about (-1 none), and by when. */
  readonly wantTell: Int32Array;
  private readonly wantTellUntil: Float32Array;
  /** How each person looks, as a description (n × D). */
  private readonly looks: Float32Array;

  private readonly judged = new Set<string>();
  private readonly votes = new Map<number, number>();
  private readonly totals: Float32Array;
  readonly stats = { filed: 0, cases: 0, settled: 0, conflicts: 0, broken: 0, recognised: 0, claims: 0, asked: 0, leads: 0, told: 0 };

  constructor(
    private readonly host: RegisterHost,
    rooms: number,
    watched: (room: number) => boolean,
    private readonly rng: Rng,
  ) {
    const n = host.people.length;
    this.n = n;
    this.R = rooms;
    const RR = rooms + 1;
    this.adj = new Uint8Array(RR * RR);
    this.nbrs = Array.from({ length: RR }, () => []);
    host.world.graph.forEach((edges, a) => {
      for (const e of edges) {
        const b = e.to < 0 ? rooms : e.to;
        if (a === b || this.adj[a * RR + b]) continue;
        this.adj[a * RR + b] = this.adj[b * RR + a] = 1;
        this.nbrs[a]!.push(b);
        this.nbrs[b]!.push(a);
      }
    });
    this.watchedRoom = new Uint8Array(rooms);
    for (let r = 0; r < rooms; r++) this.watchedRoom[r] = watched(r) ? 1 : 0;

    const N = n * E;
    this.used = new Uint8Array(N);
    this.gen = new Uint32Array(N);
    this.who = new Int16Array(N).fill(-1);
    this.verb = new Uint8Array(N);
    this.obj = new Int16Array(N).fill(-1);
    this.room = new Int16Array(N).fill(-1);
    this.from = new Float32Array(N);
    this.to = new Float32Array(N);
    this.drift = new Float32Array(N);
    this.blur = new Float32Array(N);
    this.span = new Float32Array(N);
    this.conf = new Float32Array(N);
    this.at = new Float32Array(N);
    this.teller = new Int16Array(N);
    this.witness = new Int16Array(N);
    this.hops = new Uint8Array(N);
    this.fact = new Int32Array(N).fill(-1);
    this.track = new Int16Array(N).fill(-1);
    this.trackRoom = new Int16Array(N).fill(-1);
    this.desc = new Float32Array(N * D);
    this.mask = new Uint8Array(N);

    const C = n * CASE_SLOTS;
    this.cUsed = new Uint8Array(C);
    this.cKind = new Uint8Array(C);
    this.cSubject = new Int16Array(C).fill(-1);
    this.cObj = new Int16Array(C).fill(-1);
    this.cRoom = new Int16Array(C).fill(-1);
    this.cFrom = new Float32Array(C);
    this.cTo = new Float32Array(C);
    this.cAt = new Float32Array(C);
    this.cTeller = new Int16Array(C);
    this.cWitness = new Int16Array(C);
    this.cHops = new Uint8Array(C);
    this.cFact = new Int32Array(C).fill(-1);
    this.cState = new Uint8Array(C);
    this.cWeight = new Float32Array(C);
    this.cAsked = new Float32Array(C).fill(-1e9);
    this.cBlamed = new Int32Array(C).fill(-1);
    this.cand = new Int16Array(C * CANDIDATES).fill(-1);
    this.candP = new Float32Array(C * CANDIDATES);
    this.given = new Float32Array(C * n);
    this.openN = new Uint8Array(n);

    this.beliefLoss = new Float32Array(n * n);
    this.beliefT = new Float32Array(n * n);
    this.broke = new Uint8Array(n * n);
    this.curRoom = new Int16Array(n).fill(-1);
    this.curFrom = new Float32Array(n);
    this.prevRoom = new Int16Array(n).fill(-1);
    this.prevFrom = new Float32Array(n);
    this.prevTo = new Float32Array(n);
    this.wantTell = new Int32Array(n).fill(-1);
    this.wantTellUntil = new Float32Array(n);
    this.looks = new Float32Array(n * D);
    for (const p of host.people) this.refreshLook(p);
    this.totals = new Float32Array(n);
  }

  // ------------------------------------------------------------------ helpers

  private ri(room: number): number {
    return room === -2 ? this.R : room;
  }

  /** Whether two rooms are the same or joined by a doorway, French window or stair. */
  joined(a: number, b: number): boolean {
    if (a === -1 || b === -1) return false;
    if (a === b) return true;
    return this.adj[this.ri(a) * (this.R + 1) + this.ri(b)] === 1;
  }

  /** How well a room fits a case's room: the same 1, joined 0.4, else 0. */
  roomFit(a: number, b: number): number {
    if (a === -1 || b === -1) return 0;
    if (a === b) return 1;
    return this.joined(a, b) ? NEXT_ROOM : 0;
  }

  /** 1 when two windows overlap, falling to 0 at ten minutes apart. */
  static timeFit(a0: number, a1: number, b0: number, b1: number): number {
    const gap = Math.max(b0 - a1, a0 - b1, 0);
    return Math.max(0, 1 - gap / FIT_GAP);
  }

  private static overlap(a0: number, a1: number, b0: number, b1: number): number {
    return Math.min(a1, b1) - Math.max(a0, b0);
  }

  /**
   * Whether two entries must have had someone in both places at once. Each says they were there
   * for a stretch (l) somewhere in a window; the stretch they surely were is the window less its
   * slack. Two sure stretches overlapping by two minutes can't both be true, nor can a whole
   * window that falls well inside the other's sure stretch. Vague gossip ("around half nine")
   * never contradicts anything.
   */
  static atOnce(a0: number, a1: number, la: number, b0: number, b1: number, lb: number): boolean {
    const ca0 = a1 - la;
    const ca1 = a0 + la;
    const cb0 = b1 - lb;
    const cb1 = b0 + lb;
    if (ca1 > ca0 && cb1 > cb0 && Math.min(ca1, cb1) - Math.max(ca0, cb0) >= CLASH) return true;
    const m = CLASH / 2;
    if (ca1 - ca0 > CLASH && b0 >= ca0 + m && b1 <= ca1 - m) return true;
    return cb1 - cb0 > CLASH && a0 >= cb0 + m && a1 <= cb1 - m;
  }

  /** An entry's window as the holder remembers it. */
  winFrom(s: number): number {
    return this.from[s]! + this.drift[s]! - this.blur[s]!;
  }

  winTo(s: number): number {
    return this.to[s]! + this.drift[s]! + this.blur[s]!;
  }

  /** An entry's confidence now. */
  confAt(s: number): number {
    return this.used[s] ? this.conf[s]! * 0.5 ** ((this.host.t - this.at[s]!) / HALF) : 0;
  }

  private isClaim(s: number): boolean {
    return s % E >= SIGHTINGS;
  }

  /** How much i trusts what a teller says, 0.2 to 1: it drops when their story gives way, and comes back. */
  beliefIn(i: number, j: number): number {
    const k = i * this.n + j;
    return 1 - this.beliefLoss[k]! * 0.5 ** ((this.host.t - this.beliefT[k]!) / BELIEF_HALF);
  }

  private loseBelief(i: number, j: number, v: number): void {
    if (j < 0 || v <= 0) return;
    const k = i * this.n + j;
    this.beliefLoss[k] = Math.min(1 - BELIEF_FLOOR, 1 - this.beliefIn(i, j) + v);
    this.beliefT[k] = this.host.t;
  }

  /** What an entry's source is worth to its holder: own eyes 1, a forgotten source 0.3, a teller 0.3 + 0.6 × tie, times trust in them. */
  sourceWeight(i: number, s: number): number {
    const t = this.teller[s]!;
    if (t === OWN) return 1;
    if (t === FORGOT) return 0.3;
    return (0.3 + 0.6 * TIE_WEIGHT[this.host.ident.tieOf(i, t)]!) * this.beliefIn(i, t);
  }

  private strength(i: number, s: number): number {
    return this.confAt(s) * this.sourceWeight(i, s);
  }

  /** How someone looks, as a description (call again when it changes). */
  refreshLook(p: Person): void {
    describe(p, this.looks, p.id * D);
  }

  /** How well a description fits someone's looks, 0 to 1. */
  similarity(s: number, j: number): number {
    return likeness(this.desc, s * D, this.mask[s]!, this.looks, j * D);
  }

  // ------------------------------------------------------------------ filing

  private newEntry(i: number, claim: boolean): number {
    const base = i * E + (claim ? SIGHTINGS : 0);
    const cap = claim ? CLAIMS : SIGHTINGS;
    let s = base;
    let worst = Infinity;
    for (let k = base; k < base + cap; k++) {
      if (!this.used[k]) {
        s = k;
        break;
      }
      const v = this.confAt(k);
      if (v < worst) {
        worst = v;
        s = k;
      }
    }
    this.used[s] = 1;
    this.gen[s]!++;
    this.who[s] = -1;
    this.obj[s] = -1;
    this.room[s] = -1;
    this.fact[s] = -1;
    this.track[s] = -1;
    this.trackRoom[s] = -1;
    this.mask[s] = 0;
    this.drift[s] = 0;
    this.blur[s] = 0;
    this.span[s] = 0;
    this.hops[s] = 0;
    this.stats.filed++;
    return s;
  }

  /** Drink blurs what is filed: the window, the room, the looks, and (for anything told) who said it. */
  private blurIt(i: number, s: number, told: boolean): void {
    const tip = this.host.people[i]!.tipsy;
    this.blur[s] = BLUR + BLUR_TIPSY * tip;
    if (tip <= 0) return;
    const rng = this.rng;
    this.drift[s] = rng.normal(0, DRIFT_TIPSY * tip);
    const r = this.room[s]!;
    if (r !== -1 && rng.chance(SLIP * tip)) {
      const nb = this.nbrs[this.ri(r)]!;
      if (nb.length) {
        const to = rng.pick(nb);
        this.room[s] = to === this.R ? -2 : to;
      }
    }
    if (this.who[s]! < 0 && this.mask[s] && rng.chance(tip)) {
      const f = FORGET_ORDER.find((x) => this.mask[s]! & x);
      if (f) this.mask[s]! &= ~f;
    }
    if (told && rng.chance(FORGET_SOURCE * tip)) {
      this.teller[s] = FORGOT;
      this.witness[s] = FORGOT;
    }
  }

  /**
   * Whether i notes everyone they see in a room: the private rooms, and any room an open case of
   * theirs is about, for as long after it as the case looks back before it (a crash a minute, a
   * theft ten: after that no sighting fits its window).
   */
  watching(i: number, room: number): boolean {
    if (room >= 0 && this.watchedRoom[room]) return true;
    if (!this.openN[i]) return false;
    const base = i * CASE_SLOTS;
    const t = this.host.t;
    for (let c = base; c < base + CASE_SLOTS; c++)
      if (this.cUsed[c] && this.cState[c] === 0 && t - this.cTo[c]! < Math.min(FIT_GAP, CASES[CASE_KINDS[this.cKind[c]!]!].lookBack) && this.joined(this.cRoom[c]!, room)) return true;
    return false;
  }

  /**
   * i sees someone with their own eyes: somewhere private, or doing something notable. Seen
   * again in the same room within a minute, it is the same sighting, running on. Someone i
   * hasn't met is filed as a description.
   */
  see(i: number, b: Person, verb: Verb, room: number, obj = -1, fact = -1): void {
    if (i === b.id || room === -1) return;
    const t = this.host.t;
    const base = i * E;
    for (let s = base; s < base + SIGHTINGS; s++) {
      if (!this.used[s] || this.track[s] !== b.id || this.trackRoom[s] !== room || t - this.to[s]! > MERGE) continue;
      this.to[s] = t;
      this.span[s] = t - this.from[s]!;
      this.conf[s] = 1;
      this.at[s] = t;
      if (verb !== "was-in") {
        this.verb[s] = VERB_IDS.indexOf(verb);
        this.obj[s] = obj;
        if (fact >= 0) this.fact[s] = fact;
      }
      if (this.openN[i]) this.checkCases(i, s);
      return;
    }
    const s = this.newEntry(i, false);
    if (this.host.ident.tieOf(i, b.id) >= 1) this.who[s] = b.id;
    else {
      describe(b, this.desc, s * D);
      this.mask[s] = ALL;
    }
    this.verb[s] = VERB_IDS.indexOf(verb);
    this.obj[s] = obj;
    this.room[s] = room;
    this.from[s] = t;
    this.to[s] = t;
    this.conf[s] = 1;
    this.at[s] = t;
    this.teller[s] = OWN;
    this.witness[s] = i;
    this.fact[s] = fact;
    this.track[s] = b.id;
    this.trackRoom[s] = room;
    this.blurIt(i, s, false);
    if (this.who[s]! < 0) this.resolve(i, s);
    else this.check(i, s);
  }

  /** i was told a fact (memory's hook): a case travels whole, a sighting as the teller has it. */
  told(i: number, f: number, from: number): void {
    const m = this.host.memory;
    const verb = m.verbOf(f);
    if (verb === "blamed") return this.toldBlame(i, f, from);
    const c = this.caseByFact(from, f);
    if (c >= 0) {
      this.copyCase(i, from, c);
      return;
    }
    if (verb === "gone" || verb === "missing" || verb === "planted") {
      const kind: CaseKind = verb === "gone" ? "gone" : verb === "planted" ? "planted" : "person-gone";
      const t0 = m.t[f]!;
      this.open(i, kind, m.subject[f]!, verb === "missing" ? -1 : m.object[f]!, m.room[f]!, t0 - CASES[kind].lookBack, t0, f, from, from, 1);
      return;
    }
    const e = this.entryByFact(from, f);
    if (e >= 0) {
      this.copyEntry(i, from, e);
      return;
    }
    const subj = m.subject[f]!;
    const room = m.room[f]!;
    if (subj < 0 || room === -1 || subj === i || VERBS[verb].elsewhere) return;
    // The teller no longer has it as a sighting: file it from the fact itself.
    if (this.heldFact(i, f, from)) return;
    const s = this.newEntry(i, false);
    this.who[s] = subj;
    this.verb[s] = m.verb[f]!;
    this.obj[s] = VERBS[verb].thing ? -1 : m.object[f]!;
    this.room[s] = room;
    this.from[s] = m.t[f]!;
    this.to[s] = m.lastAt[f]!;
    this.span[s] = m.lastAt[f]! - m.t[f]!;
    this.conf[s] = m.confidence(i, f);
    this.at[s] = this.host.t;
    this.teller[s] = from;
    this.witness[s] = from;
    this.hops[s] = 1;
    this.fact[s] = f;
    this.blurIt(i, s, true);
    this.check(i, s);
  }

  /** i already holds this fact from this witness. */
  private heldFact(i: number, f: number, w: number): boolean {
    const base = i * E;
    for (let k = base; k < base + SIGHTINGS; k++) if (this.used[k] && this.fact[k] === f && (this.witness[k] === w || this.teller[k] === OWN)) return true;
    return false;
  }

  private entryByFact(i: number, f: number): number {
    const base = i * E;
    for (let k = base; k < base + SIGHTINGS; k++) if (this.used[k] && this.fact[k] === f) return k;
    return -1;
  }

  private caseByFact(i: number, f: number): number {
    const base = i * CASE_SLOTS;
    for (let c = base; c < base + CASE_SLOTS; c++) if (this.cUsed[c] && this.cFact[c] === f) return c;
    return -1;
  }

  /** i files a copy of the teller's entry: noise compounds, the original witness travels with it. */
  copyEntry(i: number, from: number, e: number): number {
    const w = this.witness[e] === FORGOT ? FORGOT : this.teller[e] === OWN ? from : this.witness[e]!;
    if (w === i) return -1;
    const claim = this.isClaim(e);
    const base = i * E + (claim ? SIGHTINGS : 0);
    const cap = claim ? CLAIMS : SIGHTINGS;
    // Already held from the same witness: the same fact, or the same person in the same room around then.
    if (w !== FORGOT) {
      for (let k = base; k < base + cap; k++) {
        if (!this.used[k] || (this.witness[k] !== w && this.teller[k] !== OWN)) continue;
        const same =
          this.fact[e]! >= 0
            ? this.fact[k] === this.fact[e]
            : this.who[k] === this.who[e] && this.joined(this.room[k]!, this.room[e]!) && Register.overlap(this.winFrom(k), this.winTo(k), this.winFrom(e), this.winTo(e)) > 0;
        if (!same) continue;
        const c = this.confAt(e) * PASS_ON;
        if (this.teller[k] !== OWN && c > this.confAt(k)) {
          this.conf[k] = c;
          this.at[k] = this.host.t;
        }
        return k;
      }
    }
    const s = this.newEntry(i, claim);
    this.who[s] = this.who[e]!;
    if (this.who[s]! < 0) {
      for (let f = 0; f < D; f++) this.desc[s * D + f] = this.desc[e * D + f]!;
      this.mask[s] = this.mask[e]!;
    }
    this.verb[s] = this.verb[e]!;
    this.obj[s] = this.obj[e]!;
    this.room[s] = this.room[e]!;
    this.from[s] = this.winFrom(e);
    this.to[s] = this.winTo(e);
    this.span[s] = Math.min(this.span[e]!, this.to[s]! - this.from[s]!);
    this.conf[s] = this.confAt(e) * PASS_ON;
    this.at[s] = this.host.t;
    this.teller[s] = from;
    this.witness[s] = w;
    this.hops[s] = Math.min(255, this.hops[e]! + 1);
    this.fact[s] = this.fact[e]!;
    this.blurIt(i, s, true);
    if (this.who[s]! < 0) this.resolve(i, s);
    else this.check(i, s);
    return s;
  }

  /**
   * Someone says where they've just been (on joining a conversation, now and then): each listener
   * files the claim. Innocents tell the truth; milestone 3's spy may not.
   */
  claim(i: number, x: number, room: number, from: number, to: number, obj = -1): number {
    if (i === x || room === -1) return -1;
    const base = i * E + SIGHTINGS;
    for (let k = base; k < base + CLAIMS; k++) {
      if (this.used[k] && this.who[k] === x && this.joined(this.room[k]!, room) && Register.overlap(this.winFrom(k), this.winTo(k), from, to) > 0) {
        this.conf[k] = 1;
        this.at[k] = this.host.t;
        return k;
      }
    }
    const s = this.newEntry(i, true);
    this.who[s] = x;
    this.verb[s] = VERB_IDS.indexOf("was-in");
    this.obj[s] = obj;
    this.room[s] = room;
    this.from[s] = from;
    this.to[s] = to;
    this.span[s] = to - from;
    this.conf[s] = 1;
    this.at[s] = this.host.t;
    this.teller[s] = x;
    this.witness[s] = x;
    this.blurIt(i, s, false);
    this.stats.claims++;
    this.check(i, s);
    return s;
  }

  // -------------------------------------------------------------------- cases

  private newCase(i: number): number {
    const base = i * CASE_SLOTS;
    let c = base;
    let worst = Infinity;
    for (let k = base; k < base + CASE_SLOTS; k++) {
      if (!this.cUsed[k]) {
        c = k;
        break;
      }
      // Closed cases go first, then settled ones, then the oldest and least serious.
      const v = (this.cState[k] === 2 ? 0 : this.cState[k] === 1 ? 1 : 2) + CASES[CASE_KINDS[this.cKind[k]!]!].severity + this.cAt[k]! / 86400;
      if (v < worst) {
        worst = v;
        c = k;
      }
    }
    if (this.cUsed[c] && this.cState[c] !== 2) this.openN[i]!--;
    this.cUsed[c] = 1;
    this.cState[c] = 0;
    this.cWeight[c] = 0;
    this.cAsked[c] = -1e9;
    this.cBlamed[c] = -1;
    this.cand.fill(-1, c * CANDIDATES, (c + 1) * CANDIDATES);
    this.candP.fill(0, c * CANDIDATES, (c + 1) * CANDIDATES);
    this.given.fill(0, c * this.n, (c + 1) * this.n);
    this.openN[i]!++;
    this.stats.cases++;
    return c;
  }

  /** The case i holds about the same thing, if any. */
  private sameCase(i: number, kind: number, subject: number, obj: number, room: number, from: number, to: number): number {
    const base = i * CASE_SLOTS;
    for (let c = base; c < base + CASE_SLOTS; c++) {
      if (!this.cUsed[c] || this.cKind[c] !== kind || this.cSubject[c] !== subject || this.cObj[c] !== obj) continue;
      if (CASES[CASE_KINDS[kind]!].match === "doubt") return c;
      if (this.joined(this.cRoom[c]!, room) && Register.overlap(this.cFrom[c]!, this.cTo[c]!, from, to) > -FIT_GAP) return c;
    }
    return -1;
  }

  /**
   * i opens a case: something happened, with a blank in it. Seen first-hand (teller OWN) or told.
   * Everything i already holds is weighed against it at once (hindsight).
   */
  open(i: number, kind: CaseKind, subject: number, obj: number, room: number, from: number, to: number, fact = -1, teller = OWN, witness = i, hops = 0): number {
    const k = CASE_KINDS.indexOf(kind);
    const have = this.sameCase(i, k, subject, obj, room, from, to);
    if (have >= 0) {
      if (fact >= 0 && this.cFact[have]! < 0) this.cFact[have] = fact;
      return have;
    }
    const c = this.newCase(i);
    this.cKind[c] = k;
    this.cSubject[c] = subject;
    this.cObj[c] = obj;
    this.cRoom[c] = room;
    this.cFrom[c] = from;
    this.cTo[c] = to;
    this.cAt[c] = this.host.t;
    this.cTeller[c] = teller;
    this.cWitness[c] = witness;
    this.cHops[c] = hops;
    this.cFact[c] = fact;
    this.weigh(i, c);
    return c;
  }

  /** i is told about a case: the room and window come with the teller's blur and i's own. */
  copyCase(i: number, from: number, c: number): number {
    const k = this.cKind[c]!;
    const have = this.sameCase(i, k, this.cSubject[c]!, this.cObj[c]!, this.cRoom[c]!, this.cFrom[c]!, this.cTo[c]!);
    if (have >= 0) return have;
    const tip = this.host.people[i]!.tipsy;
    let room = this.cRoom[c]!;
    let a = this.cFrom[c]!;
    let b = this.cTo[c]!;
    if (tip > 0) {
      const d = this.rng.normal(0, DRIFT_TIPSY * tip);
      a += d - BLUR_TIPSY * tip;
      b += d + BLUR_TIPSY * tip;
      if (room !== -1 && this.rng.chance(SLIP * tip)) {
        const nb = this.nbrs[this.ri(room)]!;
        if (nb.length) {
          const to = this.rng.pick(nb);
          room = to === this.R ? -2 : to;
        }
      }
    }
    const w = this.cTeller[c] === OWN ? from : this.cWitness[c]!;
    return this.open(i, CASE_KINDS[k]!, this.cSubject[c]!, this.cObj[c]!, room, a, b, this.cFact[c]!, from, w, Math.min(255, this.cHops[c]! + 1));
  }

  /** i hears a crash or a scream (a memory fact with no subject): who made it? */
  heard(i: number, f: number): void {
    const m = this.host.memory;
    const v = m.verbOf(f);
    if (v !== "crash" && v !== "scream") return;
    this.open(i, "noise", -1, -1, m.room[f]!, m.t[f]! - CASES.noise.lookBack, this.host.t, f);
  }

  /** A case settled by the teller: i learns the case, and the teller's word counts as one vote. */
  private toldBlame(i: number, f: number, from: number): void {
    const m = this.host.memory;
    const base = from * CASE_SLOTS;
    let c = -1;
    // The teller's case: the one they settled, else the one about the same thing.
    for (let k = base; k < base + CASE_SLOTS && c < 0; k++) if (this.cUsed[k] && this.cBlamed[k] === f) c = k;
    for (let k = base; k < base + CASE_SLOTS && c < 0; k++) {
      if (this.cUsed[k] && CASES[CASE_KINDS[this.cKind[k]!]!].match === "place" && this.cObj[k] === m.object[f] && this.joined(this.cRoom[k]!, m.room[f]!)) c = k;
    }
    const lc = c >= 0 ? this.copyCase(i, from, c) : -1;
    const blamed = m.subject[f]!;
    if (blamed === i) return;
    const ib = i * E;
    for (let k = ib; k < ib + SIGHTINGS; k++) {
      if (this.used[k] && this.fact[k] === f && this.witness[k] === from) {
        this.conf[k] = Math.max(this.confAt(k), m.confidence(i, f));
        this.at[k] = this.host.t;
        if (lc >= 0) this.weigh(i, lc);
        return;
      }
    }
    const s = this.newEntry(i, false);
    this.who[s] = blamed;
    this.verb[s] = m.verb[f]!;
    this.obj[s] = m.object[f]!;
    this.room[s] = m.room[f]!;
    this.from[s] = c >= 0 ? this.cFrom[c]! : m.t[f]!;
    this.to[s] = c >= 0 ? this.cTo[c]! : m.t[f]!;
    this.conf[s] = m.confidence(i, f);
    this.at[s] = this.host.t;
    this.teller[s] = from;
    this.witness[s] = from;
    this.hops[s] = 1;
    this.fact[s] = f;
    this.blurIt(i, s, true);
    this.check(i, s);
  }

  /** A thing is back, or an errand explains it: the case closes with nobody to blame. */
  close(i: number, c: number): void {
    if (!this.cUsed[c] || this.cState[c] === 2) return;
    this.cState[c] = 2;
    this.openN[i]!--;
    if (this.wantTell[i] === c) this.wantTell[i] = -1;
  }

  /** Everyone holding a case about this thing closes it (it turned up). */
  found(obj: number, room: number): void {
    for (let i = 0; i < this.n; i++) {
      const base = i * CASE_SLOTS;
      for (let c = base; c < base + CASE_SLOTS; c++) if (this.cUsed[c] && this.cObj[c] === obj && (obj >= 0 || this.joined(this.cRoom[c]!, room))) this.close(i, c);
    }
  }

  // ------------------------------------------------------------------ checking

  /** Something new was filed for i: weigh the cases it bears on, and see whether it fits what i holds. */
  private check(i: number, s: number): void {
    if (this.openN[i]) this.checkCases(i, s);
    if (this.who[s]! >= 0) this.clashes(i, s);
  }

  private checkCases(i: number, s: number): void {
    const base = i * CASE_SLOTS;
    for (let c = base; c < base + CASE_SLOTS; c++) {
      if (!this.cUsed[c] || this.cState[c] === 2) continue;
      if (this.isClaim(s) ? this.cand.subarray(c * CANDIDATES, (c + 1) * CANDIDATES).includes(this.who[s]!) : this.fits(c, s) > 0) this.weigh(i, c);
    }
  }

  private bearsOnCase(i: number, s: number): boolean {
    const base = i * CASE_SLOTS;
    for (let c = base; c < base + CASE_SLOTS; c++) if (this.cUsed[c] && this.cState[c] !== 2 && this.fits(c, s) > 0) return true;
    return false;
  }

  /** How well a held sighting bears on a case, 0 to 1 (its candidate is whoever it's about). */
  fits(c: number, s: number): number {
    const T = CASES[CASE_KINDS[this.cKind[c]!]!];
    if (this.isClaim(s)) return 0;
    const v = VERB_IDS[this.verb[s]!]!;
    if (T.match === "place") {
      // Someone's settled word on the same thing fits whenever it was said.
      if (v === "blamed") return this.obj[s] === this.cObj[c] && (this.cObj[c]! >= 0 || this.joined(this.cRoom[c]!, this.room[s]!)) ? 1 : 0;
      return this.roomFit(this.cRoom[c]!, this.room[s]!) * Register.timeFit(this.cFrom[c]!, this.cTo[c]!, this.winFrom(s), this.winTo(s));
    }
    if (T.match === "pair") {
      if (v !== "flirting" && v !== "couple" && v !== "cheating") return 0;
      const x = this.cSubject[c]!;
      if (this.who[s] !== x && this.obj[s] !== x) return 0;
      return Register.timeFit(this.cFrom[c]!, this.cTo[c]!, this.winFrom(s), this.winTo(s));
    }
    return 0;
  }

  /** The one a sighting points at for a pair case: whoever the subject was with. */
  private pointsAt(c: number, s: number): number {
    if (CASES[CASE_KINDS[this.cKind[c]!]!].match !== "pair") return this.who[s]!;
    return this.who[s] === this.cSubject[c] ? this.obj[s]! : this.who[s]!;
  }

  /** Nobody is a candidate for their own loss, for something the holder did, or (the household) for taking the house's own things. */
  private excluded(i: number, c: number, j: number): boolean {
    if (j < 0 || j === i) return true;
    const x = this.cSubject[c]!;
    if (j === x) return true;
    const T = CASES[CASE_KINDS[this.cKind[c]!]!];
    if (T.match === "pair") return this.host.people[x]?.partner === j;
    const hh = this.host.memory.household;
    return x >= 0 && hh[x] === 1 && hh[j] === 1;
  }

  /**
   * Weigh a case from everything i holds: each held sighting and i's own last sight of everyone,
   * fit × confidence × source weight, one vote per original witness at their best. A claim of
   * having been elsewhere takes up to half off; an errand that explains it, all of it.
   * P = w / (Σw + 0.5); the 0.5 is someone i hasn't heard about.
   */
  weigh(i: number, c: number): void {
    const T = CASES[CASE_KINDS[this.cKind[c]!]!];
    const K = c * CANDIDATES;
    if (T.match === "doubt") {
      const w = this.cWeight[c]!;
      this.cand[K] = this.cSubject[c]!;
      this.candP[K] = w / (w + UNKNOWN);
      return;
    }
    const n = this.n;
    const KEYS = n + E;
    const votes = this.votes;
    votes.clear();
    const vote = (j: number, key: number, w: number) => {
      if (w <= 0 || this.excluded(i, c, j)) return;
      const k = j * KEYS + key;
      if (w > (votes.get(k) ?? 0)) votes.set(k, w);
    };
    const ident = this.host.ident;
    const base = i * E;
    for (let s = base; s < base + SIGHTINGS; s++) {
      if (!this.used[s]) continue;
      const f = this.fits(c, s);
      if (f <= 0) continue;
      const w = f * this.confAt(s) * this.sourceWeight(i, s);
      const key = this.witness[s]! >= 0 ? this.witness[s]! : n + (s - base);
      if (this.who[s]! >= 0) vote(this.pointsAt(c, s), key, w);
      else if (T.match === "place") {
        // Not yet a name: a share for every face i knows that fits the description.
        for (let j = 0; j < n; j++) {
          if (!ident.tieOf(i, j)) continue;
          const sim = this.similarity(s, j);
          if (sim >= 0.5) vote(j, key, w * SPREAD * sim);
        }
      }
    }
    if (T.match === "place") {
      // i's own last sight of each person, as one more sighting.
      const m = this.host.memory;
      for (let j = 0; j < n; j++) {
        const k = i * n + j;
        if (m.secondHand[k] || m.lastT[k]! < -1e8) continue;
        const lt = m.lastT[k]!;
        vote(j, i, this.roomFit(this.cRoom[c]!, m.lastRoom[k]!) * Register.timeFit(this.cFrom[c]!, this.cTo[c]!, lt, lt));
      }
    }
    const tot = this.totals;
    tot.fill(0);
    for (const [k, w] of votes) tot[Math.floor(k / KEYS)]! += w;
    // Claims: an errand that explains it, or having been elsewhere then.
    for (let s = base + SIGHTINGS; s < base + E; s++) {
      if (!this.used[s]) continue;
      const j = this.who[s]!;
      if (j < 0 || !tot[j]) continue;
      if (this.obj[s]! >= 0 && this.obj[s] === this.cObj[c] && this.joined(this.room[s]!, this.cRoom[c]!)) {
        tot[j] = 0;
        continue;
      }
      if (this.joined(this.room[s]!, this.cRoom[c]!)) continue;
      const span = Math.max(1, this.cTo[c]! - this.cFrom[c]!);
      const cover = Math.max(0, Register.overlap(this.winFrom(s), this.winTo(s), this.cFrom[c]!, this.cTo[c]!)) / span;
      tot[j]! *= 1 - ALIBI * Math.min(1, cover) * this.strength(i, s);
    }
    let sum = 0;
    for (let j = 0; j < n; j++) sum += tot[j]!;
    // The top candidates, by share (ties to the lower id).
    const top: number[] = [];
    for (let j = 0; j < n; j++) {
      if (tot[j]! <= 0) continue;
      let at = top.length;
      while (at > 0 && tot[top[at - 1]!]! < tot[j]!) at--;
      if (at < CANDIDATES) {
        top.splice(at, 0, j);
        if (top.length > CANDIDATES) top.pop();
      }
    }
    for (let k = 0; k < CANDIDATES; k++) {
      const j = top[k];
      this.cand[K + k] = j ?? -1;
      this.candP[K + k] = j === undefined ? 0 : tot[j]! / (sum + UNKNOWN);
    }
    // Suspicion: only the rise since last time, so the same thing heard twice adds nothing.
    if (T.severity > 0) {
      const m = this.host.memory;
      for (const j of top) {
        const want = T.severity * (tot[j]! / (sum + UNKNOWN)) * (1 - m.trustIn(i, j));
        const g = c * n + j;
        if (want > this.given[g]!) {
          m.addSuspicion(i, j, want - this.given[g]!);
          this.given[g] = want;
        }
      }
    }
    const p0 = this.candP[K]!;
    const lead = this.cand[K]!;
    if (lead >= 0 && p0 >= T.settle && this.candP[K + 1]! < p0 / 2 && !(this.cState[c] === 1 && this.cLeadIs(c, lead))) this.settle(i, c, lead, p0);
  }

  private cLeadIs(c: number, j: number): boolean {
    const f = this.cBlamed[c]!;
    return f >= 0 && this.host.memory.subject[f] === j;
  }

  /** A clear lead: i settles it on them, and it becomes something to pass on. */
  private settle(i: number, c: number, lead: number, p: number): void {
    const m = this.host.memory;
    const kind = CASE_KINDS[this.cKind[c]!]!;
    const T = CASES[kind];
    this.cState[c] = 1;
    const f = m.fact("blamed", lead, this.cObj[c]!, this.cRoom[c]!, T.juicy, 0);
    // Their own conclusion: the case has already added the suspicion.
    m.learn(i, f, p, -1, 0, true);
    this.cBlamed[c] = f;
    this.stats.settled++;
    this.host.log("blame", [i, lead], this.cRoom[c]!, kind);
    const x = this.cSubject[c]!;
    const people = this.host.people;
    const host = people.find((q) => q.role === "host");
    // The house's own things: a guest who knows the host (and half of those) goes and tells them.
    if (host && T.severity > 0 && x >= 0 && m.household[x] && !m.household[i] && !people[i]!.staff && this.host.ident.tieOf(i, host.id) >= 2 && this.rng.chance(TELL)) {
      this.wantTell[i] = c;
      this.wantTellUntil[i] = this.host.t + TELL_FOR;
    }
  }

  /** A case i wants to tell the host about, or -1 (and forget it once it's stale). */
  tellFor(i: number): number {
    const c = this.wantTell[i]!;
    if (c >= 0 && this.host.t > this.wantTellUntil[i]!) this.wantTell[i] = -1;
    return this.wantTell[i]!;
  }

  /** i has just noticed something serious first-hand and says so out loud: everyone in earshot learns the case. */
  raise(i: number, c: number, earshot: readonly number[]): void {
    for (const o of earshot) if (o !== i) this.copyCase(o, i, c);
  }

  /** i tells the host what they settled: the case, and their word on it. */
  tellHost(i: number, hostId: number): void {
    const c = this.wantTell[i]!;
    this.wantTell[i] = -1;
    if (c < 0 || !this.cUsed[c]) return;
    this.copyCase(hostId, i, c);
    const f = this.cBlamed[c]!;
    if (f >= 0) this.host.memory.tell(hostId, f, i);
    this.stats.told++;
  }

  // --------------------------------------------------------------- not fitting

  private pairKey(a: number, b: number): string {
    return a < b ? `${a}.${this.gen[a]}|${b}.${this.gen[b]}` : `${b}.${this.gen[b]}|${a}.${this.gen[a]}`;
  }

  /**
   * A new entry about someone against everything else i holds about them: their other
   * sightings, their claims, and i's own last sight of them. Two sources can't put one person
   * in rooms not joined for more than two minutes at once.
   */
  private clashes(i: number, s: number): void {
    const x = this.who[s]!;
    if (x === i) return;
    const claim = this.isClaim(s);
    const base = i * E;
    const a0 = this.winFrom(s);
    const a1 = this.winTo(s);
    const la = Math.min(this.span[s]!, a1 - a0);
    const rs = this.room[s]!;
    if (rs === -1) return;
    for (let k = base; k < base + E; k++) {
      if (k === s || !this.used[k] || this.who[k] !== x || this.room[k] === -1) continue;
      const kClaim = this.isClaim(k);
      if (claim && kClaim) continue;
      // One witness saw them in turn, never in two places.
      if (this.witness[k] === this.witness[s] && this.witness[s]! !== FORGOT) continue;
      if (this.joined(rs, this.room[k]!)) continue;
      const b0 = this.winFrom(k);
      const b1 = this.winTo(k);
      if (!Register.atOnce(a0, a1, la, b0, b1, Math.min(this.span[k]!, b1 - b0))) continue;
      const key = this.pairKey(s, k);
      if (this.judged.has(key)) continue;
      this.judged.add(key);
      if (claim || kClaim) this.broken(i, x, claim ? s : k, claim ? k : s);
      else this.twoPlaces(i, x, s, k);
    }
    // i's own last sight of them, a moment that the entry's window covers well inside.
    const m = this.host.memory;
    const n = this.n;
    const lk = i * n + x;
    if (m.secondHand[lk] || this.witness[s] === i) return;
    const lt = m.lastT[lk]!;
    const lr = m.lastRoom[lk]!;
    if (lr === -1 || this.joined(rs, lr) || !Register.atOnce(a0, a1, la, lt, lt, 0)) return;
    const key = `${s}.${this.gen[s]}|L${x}.${Math.round(lt)}`;
    if (this.judged.has(key)) return;
    this.judged.add(key);
    if (claim) this.broken(i, x, s, -1);
    else this.twoPlaces(i, x, s, -1);
  }

  /** Two sightings of x that can't both be true (b = -1: i's own last sight of them). */
  private twoPlaces(i: number, x: number, a: number, b: number): void {
    const sa = this.strength(i, a);
    const sb = b >= 0 ? this.strength(i, b) : 1;
    const own = this.teller[a] === OWN || b < 0 || this.teller[b] === OWN;
    this.stats.conflicts++;
    if (sa >= FIRM && sb >= FIRM && own) {
      this.firmClash(i, x, Math.min(sa, sb));
      this.host.log("conflict", [i, x], this.room[a]!, "not-themselves");
      return;
    }
    // The weaker gives way, and whoever told it is believed a little less.
    const weak = b < 0 || sa < sb ? a : b;
    const ratio = Math.min(sa, sb) / Math.max(sa, sb, 1e-6);
    this.giveWay(i, weak, ratio);
    this.host.log("conflict", [i, x], this.room[weak]!, "two-places");
  }

  private giveWay(i: number, e: number, ratio: number): void {
    this.conf[e] = this.confAt(e) * 0.5;
    this.at[e] = this.host.t;
    this.loseBelief(i, this.teller[e]!, BELIEF_DROP * (1 - ratio));
  }

  /** Neither gives way: i doubts it is really x, and suspects them a little. */
  private firmClash(i: number, x: number, w: number): void {
    const t = this.host.t;
    const c = this.open(i, "not-themselves", x, -1, -1, t, t);
    this.cWeight[c]! += w;
    this.weigh(i, c);
    this.host.ident.addDoubt(i, x, FIRM_DOUBT, t);
    const m = this.host.memory;
    m.addSuspicion(i, x, FIRM_SUSPECT * (1 - m.trustIn(i, x)));
  }

  /**
   * A claim of x's against a sighting of them elsewhere (s = -1: i's own last sight). Own eyes,
   * or a stronger source, break it: suspicion by how serious the case it answered is (0.1 when
   * none), times the source weight for hearsay. Broken twice, i doubts it is really them.
   */
  private broken(i: number, x: number, cl: number, s: number): void {
    const own = s < 0 || this.teller[s] === OWN;
    const ss = s < 0 ? 1 : this.strength(i, s);
    const sc = this.strength(i, cl);
    this.stats.conflicts++;
    if (!own && ss <= sc) {
      this.giveWay(i, s, ss / Math.max(sc, 1e-6));
      this.host.log("conflict", [i, x], this.room[s]!, "two-places");
      return;
    }
    let sev = CLAIM_NONE;
    const base = i * CASE_SLOTS;
    for (let c = base; c < base + CASE_SLOTS; c++) {
      if (!this.cUsed[c] || this.cState[c] === 2 || !this.cand.subarray(c * CANDIDATES, (c + 1) * CANDIDATES).includes(x)) continue;
      if (Register.overlap(this.winFrom(cl), this.winTo(cl), this.cFrom[c]!, this.cTo[c]!) > 0) sev = Math.max(sev, CASES[CASE_KINDS[this.cKind[c]!]!].severity);
    }
    const m = this.host.memory;
    m.addSuspicion(i, x, sev * (own ? 1 : this.sourceWeight(i, s)) * (1 - m.trustIn(i, x)));
    this.conf[cl] = this.confAt(cl) * 0.3;
    this.at[cl] = this.host.t;
    this.stats.broken++;
    const k = i * this.n + x;
    if (this.broke[k]! < 255) this.broke[k]!++;
    if (this.broke[k] === 2) this.firmClash(i, x, 0.5);
    this.host.log("conflict", [i, x], s >= 0 ? this.room[s]! : this.room[cl]!, "claim");
    // The case it answered: weigh again without the alibi.
    if (this.openN[i]) this.checkCases(i, cl);
  }

  // ---------------------------------------------------------------- who it was

  /** A description with no name: bind it to a known face that fits it clearly, then check it. */
  private resolve(i: number, s: number): void {
    let best = 0;
    let next = 0;
    let bj = -1;
    const ident = this.host.ident;
    for (let j = 0; j < this.n; j++) {
      if (j === i || !ident.tieOf(i, j)) continue;
      const v = this.similarity(s, j);
      if (v > best) {
        next = best;
        best = v;
        bj = j;
      } else if (v > next) next = v;
    }
    if (bj >= 0 && best >= RESOLVE && next < RESOLVE_NEXT) {
      this.who[s] = bj;
      this.stats.recognised++;
      // Worth a line in the log when it bears on a case.
      if (this.openN[i] && this.bearsOnCase(i, s)) this.host.log("recognised", [i, bj], this.room[s]!);
    }
    this.check(i, s);
  }

  /** i has just met j: any description of theirs that fits j is looked at again. */
  met(i: number, j: number): void {
    const base = i * E;
    for (let s = base; s < base + SIGHTINGS; s++) if (this.used[s] && this.who[s]! < 0 && this.similarity(s, j) >= RESOLVE) this.resolve(i, s);
  }

  // --------------------------------------------------------------------- talk

  /** Someone walks into a room (their own feet): a stay of a minute or more is something to mention later. */
  moved(p: Person, room: number): void {
    const i = p.id;
    const t = this.host.t;
    if (this.curRoom[i] !== -1 && t - this.curFrom[i]! >= STAY) {
      this.prevRoom[i] = this.curRoom[i]!;
      this.prevFrom[i] = this.curFrom[i]!;
      this.prevTo[i] = t;
    }
    this.curRoom[i] = room;
    this.curFrom[i] = t;
  }

  /** Someone joins a conversation and may say where they've just been. */
  joinsGroup(p: Person, others: readonly number[]): void {
    const i = p.id;
    if (!others.length || this.prevRoom[i] === -1 || this.host.t - this.prevTo[i]! > CLAIM_RECENT) return;
    if (!this.rng.chance(CLAIM_TALK * (0.4 + p.traits.talk))) return;
    for (const o of others) this.claim(o, i, this.prevRoom[i]!, this.prevFrom[i]!, this.prevTo[i]!);
  }

  /**
   * A speaker's turn: someone with an open case may ask the group about it (each listener who
   * holds something that fits says so, and everyone hears), or pass on what points at their
   * leading candidate. Evidence travels, not hunches; only a settled case travels as a verdict.
   */
  talk(members: readonly number[], sp: number): CaseTalk | null {
    if (!this.openN[sp]) return null;
    const p = this.host.people[sp]!;
    const t = this.host.t;
    const listeners = members.filter((m) => m !== sp);
    if (!listeners.length) return null;
    const base = sp * CASE_SLOTS;
    let ask = -1;
    let lead = -1;
    for (let c = base; c < base + CASE_SLOTS; c++) {
      if (!this.cUsed[c] || this.cState[c] !== 0) continue;
      const T = CASES[CASE_KINDS[this.cKind[c]!]!];
      if (T.match === "doubt") continue;
      if (T.severity >= ASK_SEVERITY && t - this.cAsked[c]! >= ASK_EVERY && (ask < 0 || T.severity > CASES[CASE_KINDS[this.cKind[ask]!]!].severity)) ask = c;
      if (this.candP[c * CANDIDATES]! >= LEAD && !listeners.includes(this.cand[c * CANDIDATES]!) && (lead < 0 || this.candP[c * CANDIDATES]! > this.candP[lead * CANDIDATES]!)) lead = c;
    }
    const chatty = 0.4 + p.traits.talk;
    if (ask >= 0 && this.rng.chance(ASK * chatty)) return this.askAround(sp, ask, listeners);
    if (lead >= 0 && this.rng.chance(LEAD_TALK * chatty)) return this.passLead(sp, lead, listeners);
    return null;
  }

  /** sp asks a group about a case (public for the tests): each listener learns it, and whoever holds something that fits says so to all. */
  askAround(sp: number, c: number, listeners: number[]): CaseTalk {
    this.cAsked[c] = this.host.t;
    const answered: number[] = [];
    for (const l of listeners) {
      const lc = this.copyCase(l, sp, c);
      const ev = this.evidence(l, lc, 2);
      if (!ev.length) continue;
      answered.push(l);
      for (const e of ev) for (const o of [sp, ...listeners]) if (o !== l) this.copyEntry(o, l, e);
    }
    this.stats.asked++;
    return { what: "ask", kind: CASE_KINDS[this.cKind[c]!]!, room: this.cRoom[c]!, others: answered };
  }

  private passLead(sp: number, c: number, listeners: number[]): CaseTalk {
    const j = this.cand[c * CANDIDATES]!;
    const e = this.support(sp, c, j);
    for (const l of listeners) {
      this.copyCase(l, sp, c);
      if (e >= 0) this.copyEntry(l, sp, e);
    }
    this.stats.leads++;
    return { what: "lead", kind: CASE_KINDS[this.cKind[c]!]!, room: this.cRoom[c]!, others: [j] };
  }

  /** What i holds that fits a case best: up to k entries, i's own last sights filed as sightings first. */
  private evidence(i: number, c: number, k: number): number[] {
    const m = this.host.memory;
    const n = this.n;
    const T = CASES[CASE_KINDS[this.cKind[c]!]!];
    if (T.match === "place") {
      for (let j = 0; j < n; j++) {
        const lk = i * n + j;
        if (m.secondHand[lk] || m.lastT[lk]! < -1e8 || this.excluded(i, c, j)) continue;
        const lt = m.lastT[lk]!;
        const f = this.roomFit(this.cRoom[c]!, m.lastRoom[lk]!) * Register.timeFit(this.cFrom[c]!, this.cTo[c]!, lt, lt);
        if (f >= WORTH) this.recall(i, j, m.lastRoom[lk]!, lt);
      }
    }
    const out: Array<readonly [number, number]> = [];
    const base = i * E;
    for (let s = base; s < base + SIGHTINGS; s++) {
      if (!this.used[s]) continue;
      const v = this.fits(c, s) * this.confAt(s);
      if (v >= WORTH && !this.excluded(i, c, this.pointsAt(c, s))) out.push([s, v]);
    }
    out.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    return out.slice(0, k).map((x) => x[0]);
  }

  /** The entry that counts most for j on a case of i's (own last sight filed first if it's best), or -1. */
  private support(i: number, c: number, j: number): number {
    const m = this.host.memory;
    const lk = i * this.n + j;
    if (!m.secondHand[lk] && m.lastT[lk]! > -1e8) {
      const lt = m.lastT[lk]!;
      if (this.roomFit(this.cRoom[c]!, m.lastRoom[lk]!) * Register.timeFit(this.cFrom[c]!, this.cTo[c]!, lt, lt) >= WORTH) this.recall(i, j, m.lastRoom[lk]!, lt);
    }
    let best = -1;
    let bv = 0;
    const base = i * E;
    for (let s = base; s < base + SIGHTINGS; s++) {
      if (!this.used[s] || this.pointsAt(c, s) !== j) continue;
      const v = this.fits(c, s) * this.strength(i, s);
      if (v > bv) {
        bv = v;
        best = s;
      }
    }
    return best;
  }

  /** i's own last sight of j, filed as a sighting (to pass on). */
  private recall(i: number, j: number, room: number, at: number): void {
    const base = i * E;
    for (let s = base; s < base + SIGHTINGS; s++) if (this.used[s] && this.track[s] === j && this.trackRoom[s] === room && Math.abs(this.to[s]! - at) <= MERGE) return;
    const b = this.host.people[j]!;
    const s = this.newEntry(i, false);
    if (this.host.ident.tieOf(i, j) >= 1) this.who[s] = j;
    else {
      describe(b, this.desc, s * D);
      this.mask[s] = ALL;
    }
    this.verb[s] = VERB_IDS.indexOf("was-in");
    this.room[s] = room;
    this.from[s] = at;
    this.to[s] = at;
    this.conf[s] = 1;
    this.at[s] = at;
    this.teller[s] = OWN;
    this.witness[s] = i;
    this.track[s] = j;
    this.trackRoom[s] = room;
    this.blurIt(i, s, false);
    if (this.who[s]! < 0) this.resolve(i, s);
    else this.check(i, s);
  }

  // ----------------------------------------------------------------- things

  /** The things i is missing: the objects of i's open or settled cases (none for most people). */
  soughtThings(i: number): number[] {
    const out: number[] = [];
    if (!this.openN[i]) return out;
    const base = i * CASE_SLOTS;
    for (let c = base; c < base + CASE_SLOTS; c++) if (this.cUsed[c] && this.cState[c] !== 2 && this.cObj[c]! >= 0) out.push(this.cObj[c]!);
    return out;
  }

  /** Whether i has heard who took a thing and why (an errand's claim names it). */
  knowsWhy(i: number, obj: number): boolean {
    const base = i * E;
    for (let s = base + SIGHTINGS; s < base + E; s++) if (this.used[s] && this.obj[s] === obj) return true;
    return false;
  }

  // ---------------------------------------------------------------------- lab

  /** i's cases, open first. */
  casesOf(i: number): CaseView[] {
    const out: CaseView[] = [];
    const base = i * CASE_SLOTS;
    for (let c = base; c < base + CASE_SLOTS; c++) {
      if (!this.cUsed[c]) continue;
      const candidates: Array<{ who: number; p: number }> = [];
      for (let k = 0; k < CANDIDATES; k++) {
        const j = this.cand[c * CANDIDATES + k]!;
        if (j >= 0) candidates.push({ who: j, p: this.candP[c * CANDIDATES + k]! });
      }
      out.push({
        slot: c,
        kind: CASE_KINDS[this.cKind[c]!]!,
        subject: this.cSubject[c]!,
        object: this.cObj[c]!,
        room: this.cRoom[c]!,
        from: this.cFrom[c]!,
        to: this.cTo[c]!,
        state: this.cState[c] === 0 ? "open" : this.cState[c] === 1 ? "settled" : "closed",
        firstHand: this.cTeller[c] === OWN,
        teller: this.cTeller[c]!,
        candidates,
      });
    }
    return out.sort((a, b) => (a.state === "open" ? 0 : 1) - (b.state === "open" ? 0 : 1) || b.from - a.from);
  }

  /** i's sightings and claims, newest first. */
  entriesOf(i: number): EntryView[] {
    const out: EntryView[] = [];
    const base = i * E;
    for (let s = base; s < base + E; s++) {
      if (!this.used[s]) continue;
      out.push({
        slot: s,
        claim: this.isClaim(s),
        who: this.who[s]!,
        verb: VERB_IDS[this.verb[s]!]!,
        room: this.room[s]!,
        from: this.winFrom(s),
        to: this.winTo(s),
        conf: this.confAt(s),
        teller: this.teller[s]!,
        witness: this.witness[s]!,
      });
    }
    return out.sort((a, b) => b.to - a.to);
  }

  /** How many hold a case settled on j (for the lab and the tests). */
  blamedBy(j: number): number {
    let c = 0;
    for (let i = 0; i < this.n; i++) {
      const base = i * CASE_SLOTS;
      for (let k = base; k < base + CASE_SLOTS; k++) {
        if (this.cUsed[k] && this.cState[k] === 1 && this.cLeadIs(k, j)) {
          c++;
          break;
        }
      }
    }
    return c;
  }
}

// ------------------------------------------------------------------ descriptions

const QUIRK_SEEN = ["glasses", "limp", "cane"] as const;

/** Write someone's looks as a description: sex, height (cm), build, outfit colour, visible quirks. */
function describe(p: Person, out: Float32Array, o: number): void {
  const L = p.look;
  const v = parseInt(L.color.slice(1), 16);
  out[o] = L.sex === "f" ? 1 : 0;
  out[o + 1] = L.height * 100;
  out[o + 2] = L.build;
  out[o + 3] = ((v >> 16) & 255) / 255;
  out[o + 4] = ((v >> 8) & 255) / 255;
  out[o + 5] = (v & 255) / 255;
  let bits = 0;
  QUIRK_SEEN.forEach((q, i) => {
    if (p.quirks.includes(q)) bits |= 1 << i;
  });
  out[o + 6] = bits;
}

/** How well a description (with some features forgotten) fits a look, 0 to 1. */
function likeness(d: Float32Array, o: number, mask: number, L: Float32Array, l: number): number {
  let v = 1;
  if (mask & F_SEX && d[o] !== L[l]) v *= 0.05;
  let z = 0;
  if (mask & F_HEIGHT) z += ((d[o + 1]! - L[l + 1]!) / 6) ** 2;
  if (mask & F_BUILD) z += ((d[o + 2]! - L[l + 2]!) / 0.15) ** 2;
  if (mask & F_COLOUR) z += (Math.hypot(d[o + 3]! - L[l + 3]!, d[o + 4]! - L[l + 4]!, d[o + 5]! - L[l + 5]!) / 0.2) ** 2;
  v *= Math.exp(-0.5 * z);
  if (mask & F_QUIRKS) {
    let x = (d[o + 6]! ^ L[l + 6]!) & 7;
    while (x) {
      x &= x - 1;
      v *= 0.3;
    }
  }
  return v;
}
