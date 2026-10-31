/**
 * The spy's answers to being seen through (milestone 3 technical plan: The spy's answers). It
 * knows only what it has seen. Who is dangerous starts at what its study showed it (`close`) and
 * rises only with what its own sightings show: someone greeting it like an old friend, a double
 * take at it, a whisper with a glance its way. What is put to its face counts too: a test, a
 * challenge, a name it should have known. A close friend of its victim it has never seen stays at
 * 0 until they show themselves, which lets them near enough to see through it.
 *
 * Anyone past AVOID goes on its avoid list (milestone 2's `person:` key, which the mind and the
 * circles already honour), so it keeps out of their circle and turns down their dance, and when
 * one of them joins its circle it finds an excuse within a minute. Playing someone, it sees one
 * of them coming over to it (within DODGE_SEEN, in its view) and, when it is only standing about,
 * slips off to another room before they reach it, once a person in DODGE_AGAIN (PR 5). Tested, it bluffs or fails,
 * laughs, changes the subject and leaves the circle within a minute. Confronted, it laughs it
 * off and walks to another room; it stays until the last half hour all the same. A circle going
 * quiet as it joins sends it back to ordinary life for 10 to 20 minutes (`lowUntil`, which PR 4's
 * scheduler reads).
 *
 * Out in someone else's place mid-party (PR 5, swap.ts), all of that was about its old face, and
 * starts again: those it saw close to the one it now plays are its danger list (`with`).
 */
import type { Rng } from "../../mansion/core/rng";
import { PARTY_LENGTH } from "../clock";
import type { Ident } from "../ident";
import type { Gesture, Group, PartyEvent, Person } from "../types";

/** Why it thinks someone dangerous: its study, seen with its victim (PR 5), a wave, coming over, a kiss, a double take, a test, a whisper, a challenge, a name, seeing it kill, and a test it failed (PR 5). */
export type DangerWhy = "study" | "with" | "wave" | "came" | "kiss" | "double-take" | "test" | "whisper" | "challenge" | "name" | "witness" | "failed";
export const DANGER_WHY: readonly DangerWhy[] = ["study", "with", "wave", "came", "kiss", "double-take", "test", "whisper", "challenge", "name", "witness", "failed"];
/** What it has seen for itself that says someone is sure of it: a challenge to its face, a kill they saw (or came to after), a test it failed them on. */
const SURE_WHY = (1 << DANGER_WHY.indexOf("challenge")) | (1 << DANGER_WHY.indexOf("witness")) | (1 << DANGER_WHY.indexOf("failed"));

/** Bluffing a test: having studied its victim and knowing the tester from that study, else anyone. */
export const BLUFF_KNOWN = 0.7;
export const BLUFF = 0.3;
/** Past this, someone goes on its avoid list. */
export const AVOID = 0.5;
/** A greeting raises danger, and how close it believes them, to at least this: a wave, coming over, a kiss. A name it didn't know, as a wave. */
const GREET: Readonly<Record<"wave" | "came" | "kiss" | "name", number>> = { wave: 0.4, came: 0.7, kiss: 0.9, name: 0.4 };
/** What a sighting adds while it shows: a double take at it, a whisper with a glance its way. And what is put to its face: a test, a challenge. */
const SIGNAL: Readonly<Record<"double-take" | "whisper", number>> = { "double-take": 0.3, whisper: 0.3 };
const TESTED = 0.5;
const CHALLENGED = 1;
/** How long a double take and a whisper show, for its looks to catch them (in-game s). */
const SHOWS: Readonly<Record<"double-take" | "whisper", number>> = { "double-take": 4, whisper: 6 };
/** Out of a circle within this long after a test, or after someone it keeps away from joins it (in-game s). */
const EXCUSE: readonly [number, number] = [20, 60];
/** Lying low after a circle goes quiet as it joins (in-game s). */
const LOW: readonly [number, number] = [10 * 60, 20 * 60];
/** "He didn't know my name": a speaker turn in ten that involves one the victim knew and it doesn't know by name. */
const NO_NAME = 0.1;
/** Someone it keeps away from coming over to it: seen within this (m), it slips off, once a person in DODGE_AGAIN (in-game s), and only from standing about. */
const DODGE_SEEN = 10;
const DODGE_AGAIN = 10 * 60;
const SLIPS_OFF: ReadonlySet<string> = new Set(["mingle", "drink", "art", "wander", "snack", "terrace", "use"]);

/** What the answers need of the spy. */
export interface AnswersSpy {
  readonly id: number;
  /** Whom it killed before the party (-1 as itself). */
  readonly victim: number;
  /** Playing someone: killed before the party, or taken mid-party. */
  readonly playing: boolean;
  readonly knows: Uint8Array;
  readonly close: Float32Array;
  /** Whether the one it plays knew j before tonight. */
  knewVictim(j: number): boolean;
  /** Busy with something of its own: a step of its plan, a kill, a doubter or a face it follows. */
  readonly busy: boolean;
}

/** What the answers need of the party. */
export interface AnswersHost {
  readonly t: number;
  readonly people: Person[];
  readonly ident: Ident;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
  gesture(p: Person, g: Gesture, secs: number): void;
  glance(p: Person, x: number, z: number, secs: number): void;
  /** A laugh where someone stands. */
  laugh(p: Person): void;
  /** Out of the circle it's in, to think again. */
  leaveCircle(p: Person): void;
  /** Off to another room, drawn on the answers' own fork. */
  walkAway(p: Person, rng: Rng): void;
  /** Whether a can see b now. */
  canSee(a: Person, b: Person): boolean;
  /** The circle someone stands in, or undefined. */
  circleOf(p: Person): Group | undefined;
}

const SIG_NONE = 0;
const SIG_DOUBLE = 1;
const SIG_WHISPER = 2;

export class Answers {
  /** How dangerous it thinks each person, 0 to 1 and more. */
  readonly danger: Float32Array;
  /** Why, a bit per DANGER_WHY. */
  readonly why: Uint16Array;
  /** Whom it keeps away from: on its avoid list. */
  readonly avoided: Uint8Array;
  /** Back to ordinary life until then, after a circle went quiet as it joined (-1 never). */
  lowUntil = -1;
  readonly stats = { bluffed: 0, failed: 0, laughedOff: 0, hushes: 0, names: 0, excuses: 0, dodges: 0 };
  /** A double take or a whisper showing toward it, by whom, and until when. */
  private readonly sig: Uint8Array;
  private readonly sigUntil: Float32Array;
  /** Out of its circle at this time (-1 none), and the circle it last made an excuse to leave. */
  private leaveAt = -1;
  private excusedFrom = -1;
  /** When it last slipped off as each person came over (-Infinity never). */
  private readonly dodged: Float32Array;

  constructor(
    private readonly host: AnswersHost,
    private readonly spy: AnswersSpy,
    private readonly rng: Rng,
  ) {
    const n = host.people.length;
    this.danger = new Float32Array(n);
    this.why = new Uint16Array(n);
    this.avoided = new Uint8Array(n);
    this.sig = new Uint8Array(n);
    this.sigUntil = new Float32Array(n);
    this.dodged = new Float32Array(n).fill(-Infinity);
    // Its study: those it watched with the one it plays.
    for (let j = 0; j < n; j++) if (spy.close[j]! > 0) this.raise(j, spy.close[j]!, "study");
  }

  /** Whether it keeps away from j (their circle, their dance). */
  avoids(j: number): boolean {
    return this.avoided[j] === 1;
  }

  /** Danger rises to at least `v` (or by `add`), for a reason; past AVOID they go on the avoid list. */
  private raise(j: number, v: number, why: DangerWhy, add = 0): void {
    if (j === this.spy.id) return;
    this.danger[j] = Math.max(this.danger[j]!, v) + add;
    this.why[j]! |= 1 << DANGER_WHY.indexOf(why);
    if (this.danger[j]! > AVOID && !this.avoided[j]) {
      this.avoided[j] = 1;
      this.host.people[this.spy.id]!.avoid.set(`person:${j}`, PARTY_LENGTH + 1);
    }
  }

  // ------------------------------------------------------------- what it sees

  /** Someone did something toward it that its looks may catch: a double take at it, a whisper with a glance its way. */
  signal(from: number, what: "double-take" | "whisper"): void {
    this.sig[from] = what === "double-take" ? SIG_DOUBLE : SIG_WHISPER;
    this.sigUntil[from] = this.host.t + SHOWS[what];
  }

  /** The spy sees b: whatever b is showing toward it, it now knows of. */
  saw(b: Person): void {
    const s = this.sig[b.id]!;
    if (s === SIG_NONE || this.host.t > this.sigUntil[b.id]!) return;
    this.sig[b.id] = SIG_NONE;
    const what = s === SIG_DOUBLE ? "double-take" : "whisper";
    this.raise(b.id, 0, what, SIGNAL[what]);
  }

  /** Greeted like an old friend (a wave it saw, someone coming over, a kiss): it now believes them close, and dangerous. */
  greeted(j: number, how: "wave" | "came" | "kiss"): void {
    const spy = this.spy;
    if (!spy.knows[j]) spy.knows[j] = 1;
    spy.close[j] = Math.max(spy.close[j]!, GREET[how]);
    this.raise(j, GREET[how], how);
  }

  /** It noticed j while it killed (kill.ts): they saw it. As dangerous as anyone can be. */
  sawKill(j: number): void {
    this.raise(j, 1, "witness");
  }

  // ------------------------------------------------------- what is put to it

  /** A test from i: a bluff, with the chance its study gives it (only of the one it studied: not of a place taken mid-party), else it fails. */
  answer(i: number): "bluffed" | "failed" {
    const spy = this.spy;
    const studied = spy.victim >= 0 && spy.id === spy.victim && spy.knows[i] === 2;
    const out = this.rng.chance(studied ? BLUFF_KNOWN : BLUFF) ? "bluffed" : "failed";
    this.stats[out]++;
    return out;
  }

  /** Tested by i, however it went (`failed`: it had no answer): a laugh, the subject changed, and out of the circle within a minute. */
  tested(i: number, failed = false): void {
    const h = this.host;
    const me = h.people[this.spy.id]!;
    this.raise(i, 0, "test", TESTED);
    if (failed) this.why[i]! |= 1 << DANGER_WHY.indexOf("failed");
    h.laugh(me);
    this.leaveAt = h.t + this.rng.range(EXCUSE[0], EXCUSE[1]);
    h.log("spy", [me.id, i], me.room, "tested");
  }

  /** Confronted out loud by i: it laughs it off with a wave of the hand ("you've had too much") and walks to another room. */
  confronted(i: number): void {
    const h = this.host;
    const me = h.people[this.spy.id]!;
    this.raise(i, 0, "challenge", CHALLENGED);
    this.stats.laughedOff++;
    h.laugh(me);
    h.gesture(me, "wave", 2);
    h.walkAway(me, this.rng);
    h.log("spy", [me.id, i], me.room, "laughed-off");
  }

  /** A circle went quiet as it joined: back to ordinary life a while. */
  hushed(): void {
    const h = this.host;
    this.stats.hushes++;
    this.lowUntil = Math.max(this.lowUntil, h.t + this.rng.range(LOW[0], LOW[1]));
    h.log("spy", [this.spy.id], h.people[this.spy.id]!.room, "lie-low");
  }

  /**
   * A speaker's turn in a circle it stands in: one turn in ten that involves someone the one it
   * plays knew (they speak, or it does) and whose name it doesn't know from its study, it doesn't
   * know their name. They doubt it a little and frown; it learns the name, and that they knew its
   * victim.
   */
  turn(members: readonly number[], speaker: number): void {
    const spy = this.spy;
    const h = this.host;
    if (!spy.playing || !members.includes(spy.id)) return;
    for (const m of members) {
      if (m === spy.id || (speaker !== spy.id && speaker !== m) || spy.knows[m]! >= 2 || !spy.knewVictim(m) || !this.rng.chance(NO_NAME)) continue;
      const q = h.people[m]!;
      spy.knows[m] = 2;
      this.stats.names++;
      h.ident.noName(m, spy.id, h.t);
      h.gesture(q, "frown", 1.5);
      h.log("react", [m, spy.id], q.room, "name");
      spy.close[m] = Math.max(spy.close[m]!, GREET.name);
      this.raise(m, GREET.name, "name");
    }
  }

  /** Once a step: out of a circle when its excuse comes due, and an excuse when someone it keeps away from joins its circle. */
  step(): void {
    const h = this.host;
    const me = h.people[this.spy.id]!;
    if (!me.present || me.gone) return;
    if (this.leaveAt >= 0 && h.t >= this.leaveAt) {
      this.leaveAt = -1;
      if (h.circleOf(me)) {
        this.stats.excuses++;
        h.leaveCircle(me);
      }
      return;
    }
    if (this.leaveAt >= 0 || this.dodge(me)) return;
    const g = h.circleOf(me);
    if (!g || g.id === this.excusedFrom || !g.members.some((m) => this.avoided[m] && m !== me.id)) return;
    this.excusedFrom = g.id;
    this.leaveAt = h.t + this.rng.range(EXCUSE[0], EXCUSE[1]);
  }

  /**
   * Playing someone, one it keeps away from coming over to it, seen in time: only standing about
   * (not at a post, at the table or the toast, on the floor, nor busy with a step of its own), it
   * slips off to another room before they reach it. Once a person in DODGE_AGAIN: the next time
   * they catch it.
   */
  private dodge(me: Person): boolean {
    const h = this.host;
    if (!this.spy.playing || this.spy.busy || (me.action && !SLIPS_OFF.has(me.action.id))) return false;
    for (const q of h.people) {
      const a = q.action;
      if (!this.avoided[q.id] || a?.id !== "ask" || a.ref !== me.id || q.level !== me.level || h.t - this.dodged[q.id]! < DODGE_AGAIN) continue;
      if (Math.hypot(q.x - me.x, q.z - me.z) > DODGE_SEEN || !h.canSee(me, q)) continue;
      this.dodged[q.id] = h.t;
      this.stats.dodges++;
      h.walkAway(me, this.rng);
      h.log("spy", [me.id, q.id], me.room, "dodge");
      return true;
    }
    return false;
  }

  /**
   * Out as someone else (swap.ts; `close` is now how close it saw each person to them): who was
   * dangerous, and why, was about its old face, and so were the signals it was catching, the excuse
   * it meant to make and the lying low. Those it saw close to the one it plays are its danger now,
   * and past AVOID on its avoid list (the party gave the record its old list, less anyone in it).
   */
  anew(): void {
    const spy = this.spy;
    this.danger.fill(0);
    this.why.fill(0);
    this.avoided.fill(0);
    this.sig.fill(SIG_NONE);
    this.sigUntil.fill(0);
    this.leaveAt = -1;
    this.excusedFrom = -1;
    this.lowUntil = -1;
    for (let j = 0; j < this.danger.length; j++) if (spy.close[j]! > 0) this.raise(j, spy.close[j]!, "with");
  }

  /** Whether it has seen for itself that j is sure of it (silence.ts): a challenge, a kill seen, a test it failed. */
  sureOfIt(j: number): boolean {
    return (this.why[j]! & SURE_WHY) !== 0;
  }

  /** Its five most dangerous and why, for the lab's card. */
  top(k = 5): Array<{ id: number; danger: number; why: DangerWhy[] }> {
    const out: Array<{ id: number; danger: number; why: DangerWhy[] }> = [];
    for (let j = 0; j < this.danger.length; j++) if (this.danger[j]! > 0) out.push({ id: j, danger: this.danger[j]!, why: DANGER_WHY.filter((_, b) => this.why[j]! & (1 << b)) });
    return out.sort((a, b) => b.danger - a.danger || a.id - b.id).slice(0, k);
  }

  /** The sum of its danger list, rounded (the digest). */
  get total(): number {
    let s = 0;
    for (let j = 0; j < this.danger.length; j++) s += this.danger[j]!;
    return Math.round(s * 100) / 100;
  }
}
