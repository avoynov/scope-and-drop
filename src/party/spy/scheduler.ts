/**
 * The spy's covers (milestone 3 technical plan: The scheduler, habits and tactics): twelve
 * habits and tactics, each switched on and off through the evening. Habits show between the
 * plan's steps (habits.ts); tactics are ways of doing a step that the planner may use only while
 * they are on (tactics.ts, steps.ts). Poison and murder are kept here from the first so the
 * evening's draws don't move when they come (PR 5); until then they change nothing.
 *
 * Each cover starts off, with its first chance drawn in the first hour after the spy arrives, so
 * one or two come on early. When a chance comes it turns on with 0.5 times its tilts (at most
 * 0.9); a miss leaves it off another 5 to 15 minutes. On for 10 to 40 in-game minutes, then off
 * for 15 to 60. At most three on at once and none on for more than 90 minutes in all: a cover
 * that would break a cap waits 5 to 10 minutes, and one that has had its 90 is done for the
 * night. The goal tilts the odds, the mood of the people about it tilts the risky ones (lively,
 * easy people: risks; tense ones: lie low), and feeling watched pauses every habit and every
 * risky step for 10 to 20 minutes. Keeping out of the picture is the exception while it plays
 * someone, whose face the photos would not match: outside the caps, off only 5 to 10 minutes at
 * a time, and never paused. Covers named in the options are on all evening, past the caps.
 *
 * It draws only from its own fork, and reads the people about it only when a chance comes.
 */
import type { Rng } from "../../mansion/core/rng";
import type { PartyEvent, Person } from "../types";
import type { GoalKind } from "./cast";

export const COVERS = ["out-of-step", "returns", "odd-places", "startles", "tours", "out-of-picture", "drops", "alibi", "others-things", "commotion", "poison", "murder"] as const;
export type Cover = (typeof COVERS)[number];
/** The habits, which show between steps and pause while it feels watched; the rest are tactics. */
export const HABIT_COVERS: ReadonlySet<Cover> = new Set<Cover>(COVERS.slice(0, 7));
/** The covers that take a risk, which the mood about it tilts. */
export const RISKY: ReadonlySet<Cover> = new Set<Cover>(["commotion", "tours", "odd-places", "others-things", "alibi", "murder", "poison"]);

/** On this long, then off this long (in-game s). */
export const ON: readonly [number, number] = [10 * 60, 40 * 60];
export const OFF: readonly [number, number] = [15 * 60, 60 * 60];
/** The first chance, within this long of its arrival. */
export const FIRST: readonly [number, number] = [0, 60 * 60];
/** A chance missed: the next comes this much later. */
export const MISS: readonly [number, number] = [5 * 60, 15 * 60];
/** A cover that would break a cap waits this long. */
export const CAP_WAIT: readonly [number, number] = [5 * 60, 10 * 60];
/** The chance of coming on: this times its tilts, at most ROLL_MAX. */
export const ROLL = 0.5;
export const ROLL_MAX = 0.9;
/** At most this many on at once, and none on for more than this in all (in-game s). */
export const MAX_ON = 3;
export const MAX_TOTAL = 90 * 60;
/** Keeping out of the picture while it plays someone: off this long at a time. */
export const PICTURE_OFF: readonly [number, number] = [5 * 60, 10 * 60];
/** The goal's tilt on the covers it favours, and the kill's on murder (a place it means to take tonight's too) and poison; playing someone, on keeping out of the picture. */
export const GOAL_TILT = 1.6;
export const MURDER_TILT = 1.8;
export const POISON_TILT = 1.5;
export const PLAYING_TILT = 3;
/** The mood that tilts the risky covers: the people within this (m), on its storey, the spy among them; the tilt is at least MOOD_MIN. */
export const MOOD_NEAR = 6;
export const MOOD_MIN = 0.3;
/** Feeling watched (a wary glance its way, a test it failed): back to ordinary life this long (in-game s). */
export const WATCHED: readonly [number, number] = [10 * 60, 20 * 60];

/** What the goals favour: a theft commotion and touring alone, a kill following (odd places), a bug or the ledger lingering and coming back. */
const FAVOURS: Record<GoalKind, readonly Cover[]> = {
  statuette: ["commotion", "tours"],
  safe: ["commotion", "tours"],
  bag: ["commotion", "tours"],
  kill: ["odd-places"],
  bug: ["odd-places", "returns"],
  ledger: ["odd-places", "returns"],
};

/** One cover's state: on or off, since when, its minutes on so far, its next chance or change, whether the options hold it on. */
export interface CoverState {
  on: boolean;
  since: number;
  total: number;
  next: number;
  forced: boolean;
}

/** A spell a cover was on, for the lab's timeline, the monitor and the sweep (`to` -1 while it lasts). */
export interface Spell {
  cover: Cover;
  from: number;
  to: number;
}

/** What the scheduler needs from the party. */
export interface CoversHost {
  readonly t: number;
  readonly people: Person[];
  readonly mood: { readonly energy: Float32Array; readonly tension: Float32Array };
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
}

/** What it needs from the spy. */
export interface CoversSpy {
  readonly record: Person;
  readonly goal: { readonly kind: GoalKind };
  /** Playing someone: its face isn't theirs. */
  readonly playing: boolean;
  /** A kill's theft first still on (it tilts as a theft until done or dropped). */
  stealing(): boolean;
  /** Meaning to take someone's place tonight (swap.ts), which is a kill too. */
  readonly swap: { readonly may: boolean };
  /** Its lying low, which feeling watched extends. */
  readonly answers: { lowUntil: number };
}

export class Covers {
  readonly state: CoverState[];
  readonly spells: Spell[] = [];
  /** Feeling watched, for the lab: how often, and why. */
  readonly stats = { chances: 0, on: 0, missed: 0, capped: 0, glances: 0, tests: 0 };
  /** Each cover's first chance after its arrival (in-game s), drawn at once so the order of draws never depends on when it comes. */
  private readonly first: number[];
  private nextAny = Infinity;
  private arrivedAt = -1;

  constructor(
    private readonly host: CoversHost,
    private readonly spy: CoversSpy,
    forced: readonly Cover[],
    private readonly rng: Rng,
  ) {
    this.first = COVERS.map(() => rng.range(FIRST[0], FIRST[1]));
    this.state = COVERS.map((c) => ({ on: false, since: -1, total: 0, next: Infinity, forced: forced.includes(c) }));
  }

  /** In at the door: the forced covers come on, the rest have their first chances from now. */
  arrived(): void {
    const t = this.host.t;
    if (this.arrivedAt >= 0) return;
    this.arrivedAt = t;
    COVERS.forEach((c, k) => {
      const s = this.state[k]!;
      if (s.forced) {
        s.on = true;
        s.since = t;
        this.spells.push({ cover: c, from: t, to: -1 });
        this.host.log("spy", [this.spy.record.id], this.spy.record.room, `cover:${c}:on`);
      } else s.next = t + this.first[k]!;
    });
    this.refreshNext();
  }

  /** Once a step: any chance or change that has come. */
  step(): void {
    const t = this.host.t;
    if (t < this.nextAny) return;
    COVERS.forEach((c, k) => {
      if (t >= this.state[k]!.next) this.change(c, k);
    });
    this.refreshNext();
  }

  /** Whether a cover is on. */
  on(c: Cover): boolean {
    return this.state[COVERS.indexOf(c)]!.on;
  }

  /**
   * Whether a cover is at work now: on, and for a habit not paused by feeling watched. Keeping out
   * of the picture while it plays someone never pauses: the photos would show a face that isn't
   * theirs, and it only ever slips away when nobody would see anything in it.
   */
  active(c: Cover): boolean {
    return this.on(c) && (!HABIT_COVERS.has(c) || this.host.t >= this.spy.answers.lowUntil || (c === "out-of-picture" && this.spy.playing));
  }

  /** The covers on now, in their order. */
  get list(): Cover[] {
    return COVERS.filter((_, k) => this.state[k]!.on);
  }

  /** Minutes on so far, including a spell still running (in-game s). */
  totalOf(c: Cover): number {
    const s = this.state[COVERS.indexOf(c)]!;
    return s.total + (s.on ? this.host.t - s.since : 0);
  }

  /** Feeling watched: a wary glance its way, or a test it failed. Back to ordinary life a while. */
  watched(why: "glance" | "test"): void {
    const t = this.host.t;
    const a = this.spy.answers;
    if (why === "glance" && t < a.lowUntil) return;
    this.stats[why === "glance" ? "glances" : "tests"]++;
    a.lowUntil = Math.max(a.lowUntil, t + this.rng.range(WATCHED[0], WATCHED[1]));
    this.host.log("spy", [this.spy.record.id], this.spy.record.room, `watched:${why}`);
  }

  /** The tilt on a cover's chance now: its goal's, playing someone's, and for the risky ones the mood about it. */
  tilt(c: Cover): number {
    const spy = this.spy;
    const g = spy.goal.kind;
    let k = 1;
    const favours = g === "kill" && spy.stealing() ? FAVOURS.bag : FAVOURS[g];
    if (favours.includes(c)) k *= GOAL_TILT;
    if (c === "murder" && (g === "kill" || spy.swap.may)) k *= MURDER_TILT;
    if (g === "kill" && c === "poison") k *= POISON_TILT;
    if (c === "out-of-picture" && spy.playing) k *= PLAYING_TILT;
    if (RISKY.has(c)) k *= this.moodTilt();
    return k;
  }

  /** Lively, easy people about it tilt the risky covers up, tense ones down: 1 + 0.5 × energy − tension over those within MOOD_NEAR, at least MOOD_MIN. */
  moodTilt(): number {
    const h = this.host;
    const me = this.spy.record;
    let e = 0;
    let ten = 0;
    let c = 0;
    for (const q of h.people) {
      if (!q.present || q.gone || q.level !== me.level || Math.hypot(q.x - me.x, q.z - me.z) > MOOD_NEAR) continue;
      e += h.mood.energy[q.id]!;
      ten += h.mood.tension[q.id]!;
      c++;
    }
    if (!c) return 1;
    return Math.max(MOOD_MIN, 1 + (0.5 * e) / c - ten / c);
  }

  /** Its line in the spy's digest: each cover on or off, and its minutes on so far. */
  digest(): string {
    return COVERS.map((c, k) => `${this.state[k]!.on ? 1 : 0}${Math.round(this.totalOf(c) / 60)}`).join(".");
  }

  /** Held on from now to the end of the evening, past the caps, as one the options hold on (the lab's ask to take a place needs murder). */
  hold(c: Cover): void {
    const t = this.host.t;
    const s = this.state[COVERS.indexOf(c)]!;
    s.forced = true;
    s.next = Infinity;
    if (!s.on) {
      s.on = true;
      s.since = t;
      this.spells.push({ cover: c, from: t, to: -1 });
      this.host.log("spy", [this.spy.record.id], this.spy.record.room, `cover:${c}:on`);
    }
    this.refreshNext();
  }

  /** Gone home: every spell still running ends now. */
  left(): void {
    const t = this.host.t;
    for (const s of this.spells) if (s.to < 0) s.to = t;
  }

  // ---------------------------------------------------------------- inside

  /** Whether a cover counts against the caps: not one the options hold on, nor keeping out of the picture while it plays someone. */
  private capped(c: Cover, s: CoverState): boolean {
    return !s.forced && !(c === "out-of-picture" && this.spy.playing);
  }

  private change(c: Cover, k: number): void {
    const t = this.host.t;
    const s = this.state[k]!;
    if (s.on) return this.off(c, s);
    this.stats.chances++;
    const counted = COVERS.filter((x, j) => this.state[j]!.on && this.capped(x, this.state[j]!)).length;
    const uncapped = !this.capped(c, s);
    if (!uncapped && s.total >= MAX_TOTAL) {
      s.next = Infinity;
      return;
    }
    if (!uncapped && counted >= MAX_ON) {
      this.stats.capped++;
      s.next = t + this.rng.range(CAP_WAIT[0], CAP_WAIT[1]);
      return;
    }
    if (!this.rng.chance(Math.min(ROLL_MAX, ROLL * this.tilt(c)))) {
      this.stats.missed++;
      s.next = t + this.rng.range(MISS[0], MISS[1]);
      return;
    }
    this.stats.on++;
    s.on = true;
    s.since = t;
    const len = this.rng.range(ON[0], ON[1]);
    s.next = t + (uncapped ? len : Math.min(len, MAX_TOTAL - s.total));
    this.spells.push({ cover: c, from: t, to: -1 });
    this.host.log("spy", [this.spy.record.id], this.spy.record.room, `cover:${c}:on`);
  }

  private off(c: Cover, s: CoverState): void {
    const t = this.host.t;
    s.on = false;
    s.total += t - s.since;
    s.since = t;
    const picture = c === "out-of-picture" && this.spy.playing;
    s.next = !picture && s.total >= MAX_TOTAL ? Infinity : t + (picture ? this.rng.range(PICTURE_OFF[0], PICTURE_OFF[1]) : this.rng.range(OFF[0], OFF[1]));
    for (let i = this.spells.length - 1; i >= 0; i--) {
      const sp = this.spells[i]!;
      if (sp.cover === c && sp.to < 0) {
        sp.to = t;
        break;
      }
    }
    this.host.log("spy", [this.spy.record.id], this.spy.record.room, `cover:${c}:off`);
  }

  private refreshNext(): void {
    let m = Infinity;
    for (const s of this.state) if (s.next < m) m = s.next;
    this.nextAny = m;
  }
}
