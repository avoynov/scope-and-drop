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
 * one of them joins its circle it finds an excuse within a minute. Tested, it bluffs or fails,
 * laughs, changes the subject and leaves the circle within a minute. Confronted, it laughs it
 * off and walks to another room; it stays until the last half hour all the same. A circle going
 * quiet as it joins sends it back to ordinary life for 10 to 20 minutes (`lowUntil`, which PR 4's
 * scheduler reads).
 */
import type { Rng } from "../../mansion/core/rng";
import { PARTY_LENGTH } from "../clock";
import type { Ident } from "../ident";
import type { Gesture, Group, PartyEvent, Person } from "../types";

/** Why it thinks someone dangerous: its study, seen with its victim (PR 5), a wave, coming over, a kiss, a double take, a test, a whisper, a challenge, a name. */
export type DangerWhy = "study" | "with" | "wave" | "came" | "kiss" | "double-take" | "test" | "whisper" | "challenge" | "name";
export const DANGER_WHY: readonly DangerWhy[] = ["study", "with", "wave", "came", "kiss", "double-take", "test", "whisper", "challenge", "name"];

/** Bluffing a test: having studied its victim and knowing the tester from that study, else anyone. */
export const BLUFF_KNOWN = 0.4;
export const BLUFF = 0.1;
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

/** What the answers need of the spy. */
export interface AnswersSpy {
  readonly id: number;
  /** Whom it killed before the party (-1 as itself). */
  readonly victim: number;
  readonly knows: Uint8Array;
  readonly close: Float32Array;
  /** Whether the one it plays knew j before tonight. */
  knewVictim(j: number): boolean;
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
  readonly stats = { bluffed: 0, failed: 0, laughedOff: 0, hushes: 0, names: 0, excuses: 0 };
  /** A double take or a whisper showing toward it, by whom, and until when. */
  private readonly sig: Uint8Array;
  private readonly sigUntil: Float32Array;
  /** Out of its circle at this time (-1 none), and the circle it last made an excuse to leave. */
  private leaveAt = -1;
  private excusedFrom = -1;

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

  // ------------------------------------------------------- what is put to it

  /** A test from i: a bluff, with the chance its study gives it, else it fails. */
  answer(i: number): "bluffed" | "failed" {
    const studied = this.spy.victim >= 0 && this.spy.knows[i] === 2;
    const out = this.rng.chance(studied ? BLUFF_KNOWN : BLUFF) ? "bluffed" : "failed";
    this.stats[out]++;
    return out;
  }

  /** Tested by i, however it went: a laugh, the subject changed, and out of the circle within a minute. */
  tested(i: number): void {
    const h = this.host;
    const me = h.people[this.spy.id]!;
    this.raise(i, 0, "test", TESTED);
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
    if (spy.victim < 0 || !members.includes(spy.id)) return;
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
    if (this.leaveAt >= 0) return;
    const g = h.circleOf(me);
    if (!g || g.id === this.excusedFrom || !g.members.some((m) => this.avoided[m] && m !== me.id)) return;
    this.excusedFrom = g.id;
    this.leaveAt = h.t + this.rng.range(EXCUSE[0], EXCUSE[1]);
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
