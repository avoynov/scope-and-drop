/**
 * Moving the spy into another person's record (milestone 3 technical plan: What the swap moves).
 * The record keeps who the person is to everyone else: the name, the role, the clothes, the
 * partner and friends, the seat, the coat, and every memory of them. Its body and mind become
 * the spy's own. Before the party it has studied its victim, so it copies what it could: their
 * mannerisms (the smoking among them) and glasses in place of its own, and the favourite drink.
 *
 * The voice and the temper live in `Ident` and `Bonds`; the party recasts those after `dress()`.
 *
 * Taking someone's place mid-party (PR 5, `Swapping`). Every evening it comes as itself (cast.ts),
 * it means to become someone else when a good chance comes: whatever it does after, the face that
 * came in at the door isn't there to answer for it. Its plan can ask for a face: the host's keys
 * for the study and the safe, when nothing else gets it in (host-place), or a friend of its
 * target, to take them aside alone (friend-place, then a word in private). Otherwise it picks a
 * face of its own for the second half of the evening, and once two or more people about it have
 * grown watchful of it (on its avoid list) a new face also drops their doubt, at the cost of a
 * second missing person.
 *
 * Whom it plays: a guest casting would let it play (no archetype, not the host's partner, an
 * oddball or the stranger; the host only for the keys), not caught up in a drama, within 15 cm of
 * its own height (best within 8), of its own sex for the clothes nine times in ten, with as few
 * people it has seen close to them as it can find. It judges only from what it has seen tonight
 * (`pairs`: how close each pair has looked to it), so an old friend it never saw with them may be
 * here, and a friend of its target may turn out not to be one. With none asked for, it picks one
 * of those it has seen in the last ten minutes, the better they'd pass and the fewer it has seen
 * close to them the likelier, and goes after anyone else who would do as well when they set off
 * first. Whoever it means to play it keeps in view, and follows a step behind when it sees them
 * set off somewhere quiet (the bathroom, where it waits for them to come out; the terrace; a
 * wander). Or, a stranger to them, it goes up to them for a word ("let me show you something
 * upstairs"): half of those it asks come along, to a guest bedroom with a bolt, which it draws
 * behind them. Three tries with no moment, and it lets them be for a while and picks again. A
 * step behind, it waits for either moment: alone with them, or close and unwatched (the needle,
 * and walked off like a drunk friend); behind the bolt, alone with them. It kills them either way,
 * takes them somewhere it can bolt itself in with them (a bathroom, a bedroom: kill.ts), changes
 * behind the bolt for two to four minutes (their jacket or dress, hat and main things on; its own
 * clothes onto the body or into a wardrobe, half and half), hides the body, and comes out as them
 * (the party's swapSpy()). Its old self never comes back: gone with no goodbye, a second missing
 * person for whoever goes looking.
 *
 * It takes a place at most once an evening, never before 19:40, never once the farewell's first
 * goodbye is said, only with murder on (held on all evening when it means to: index.ts), nothing
 * of its goal in hand (a thing stashed in its old coat would stay there) and no step of its plan
 * begun. At dinner, the house empty, someone it would play getting up from the table is the best
 * chance of the evening, and it excuses itself a moment later. It draws only from its own fork.
 */
import type { Rng } from "../../mansion/core/rng";
import type { Dramas } from "../dramas";
import { TEST } from "../ident";
import type { Step, Task } from "../tasks";
import type { Group, Person, Quirk } from "../types";
import type { SpyOwn } from "./cast";
import type { Spy } from "./index";
import type { KillHost, KillOutcome } from "./kill";
import { AFTER_BREAK, ASIDE_GAP, ASIDE_PHASES, ASK_SECS, boltedBedroom, COME_ALONG, IN_BESIDE, IN_WAIT, LOOSE, OFF_ALONE, REACH_PAUSE, TRAIL_BETWEEN, TRAIL_GAP, TRAIL_TRY, WORDS } from "./steps";

/**
 * Coming as itself, before anyone knows anyone (so before `Ident`): the record is its own, so
 * nobody here knows it, as nobody knows the stranger. Its friendships are cut both ways, it has
 * never been to the house, it has no manner from the deck of archetypes, and it keeps the
 * steadier head.
 */
export function asItself(p: Person, own: SpyOwn, people: readonly Person[]): void {
  for (const f of p.friends) people[f]!.friends = people[f]!.friends.filter((x) => x !== p.id);
  p.friends = [];
  p.regular = false;
  p.archetype = null;
  p.traits = { ...own.traits };
  p.leaveAt = own.leaveAt;
  p.early = null;
}

/** What a spy who studied its victim copies, in place of its own: every habit but a limp (and never a cane). */
export const COPIED: ReadonlySet<Quirk> = new Set<Quirk>(["glasses", "ear-scratch", "globe-pointer", "dances-after-drink", "hands-in-pockets", "tie-adjust", "big-laugh", "smoker", "watch-check"]);

/** Put the spy's own body and mind into a record. `studied`: it watched the victim first, and copies what can be copied. */
export function dress(p: Person, own: SpyOwn, studied: boolean): void {
  p.look.height = own.height;
  p.look.build = own.build;
  p.speed = own.speed;
  // Its own habits, never a cane; a studied spy has their mannerisms and glasses for its own, and lights up where they would.
  p.quirks = studied ? [...own.quirks.filter((q) => !COPIED.has(q)), ...p.quirks.filter((q) => COPIED.has(q))] : [...own.quirks];
  p.traits = { ...own.traits };
  p.fluency = { ...own.fluency };
  p.fav = studied ? p.fav : own.fav;
  p.never = own.never !== p.fav ? own.never : null;
  // It leaves by its own rule (spy/index.ts), never for a reason of the victim's.
  p.leaveAt = own.leaveAt;
  p.early = null;
}

/** Why it takes someone's place: the host's keys, a friend of its target, a new face once people grow watchful, a face for the second half of the evening, or the lab's ask. */
export type SwapWhy = "host" | "friend" | "face" | "halfway" | "lab";

/** What taking someone's place needs from the party, besides what a kill does. */
export interface SwapHost extends KillHost {
  /** The circle someone stands in, or undefined. */
  circleOf(p: Person): Group | undefined;
  /** Someone held by a drama (dramas.ts): not to be drawn into anything else. */
  readonly dramas: Dramas;
  /** Out as the one it killed: their record takes the spy's body, mind and memory of the evening, and its old self leaves play with no goodbye (sim.ts). */
  swapSpy(v: Person): void;
}

/** Never before 19:40 (in-game s from 19:00). */
export const SWAP_FROM = 40 * 60;
/** Between the programme's beats, when it can be away from the room; and at dinner, when someone it would play gets up from the table, it can excuse itself too. */
const FREE: ReadonlySet<string> = new Set(["arrival", "mingle", "dinner", "dancing", "games"]);
/** It saw them set off within this long (in-game s): it knows where they're going. A face of its own is one it has seen within LATELY. */
const SEEN = 10;
const LATELY = 10 * 60;
/** A step behind someone in the bathroom, it waits for them to come out, this long at most from setting off (in-game s). */
const WAIT_OUT = 12 * 60;
/**
 * Drawing a face of its own off, a stranger to them: up to them for a word ("let me show you
 * something upstairs"), between the programme's beats, at most once in LURE_EVERY; they come along
 * COME_ALONG of the time, unless they doubt it, and it has LURE_MAX to get the word said. The room
 * it takes them to is the plan's for a word in private (steps.ts boltedBedroom).
 */
const LURE_EVERY: readonly [number, number] = [12 * 60, 20 * 60];
const LURE_MAX = 90;
/** Near enough to go up to them for a word: in the same room, within this (m). */
const LURE_NEAR = 10;
/** Lost them, or something else took it away: a minute or two before it follows anyone again (in-game s). */
const AFTER_LOST: readonly [number, number] = [60, 120];
/** Followed the face it means to play this many times with no moment: a while before it tries anyone again (in-game s). */
const TRIES = 3;
const AFTER_TRIES: readonly [number, number] = [10 * 60, 20 * 60];
/** Two or more about it watchful of it (on its avoid list): time for a new face. */
export const WATCHFUL = 2;
/** Passing in their clothes: within this of its own height (m) fits well, within FAR at FAR_FIT; of the other sex at OTHER_SEX. */
export const NEAR = 0.08;
export const FAR = 0.15;
const FAR_FIT = 0.3;
const OTHER_SEX = 0.1;
/** Seen this close to its target (pairs), someone is a friend of theirs as far as it can tell. */
export const FRIEND_SEEN = 0.5;
/** How close a pair looks to it: a partner at their side, a hug, a greeting kiss, a handshake; and talking in one circle, a little a look up to TALK_MAX. */
const PARTNER_SIDE = 0.9;
const SIDE = 2;
const HUG = 0.9;
const KISS = 0.8;
const SHAKE = 0.3;
const TALK = 0.01;
const TALK_MAX = 0.7;
/** The body in its old clothes this often; else in its own, the spy's into a wardrobe. */
const WEARS = 0.5;

export class Swapping {
  readonly stats = { picks: 0, trails: 0, lures: 0, moments: 0, swaps: 0, failed: 0 };
  /** How close each pair has looked to it tonight, from its own sightings (n × n, both ways). */
  readonly pairs: Float32Array;
  /** Whom it means to play (-1 nobody yet), and why: the one its plan asked for until it has them, or whoever it is after now. */
  face = -1;
  why: SwapWhy | null = null;
  /** Taken a place tonight, or past trying: never again. */
  done = false;
  /** Whom casting would let it play (cast.ts). */
  private readonly playable: ReadonlySet<number>;
  private tonight: boolean;
  /** The kill behind the bolt over and the body hidden: whose place it comes out in, at its next step (-1 none). */
  private ready = -1;
  /** The trail's task (-1 none), when it set off and for how long, how many trails after this face, and when it may set off again. */
  private task = -1;
  private from = 0;
  private tryFor = 0;
  private tries = 0;
  private nextAt = 0;
  private ticks = 0;
  /** The task is a word in private (a lure), not a trail; when the talk in the quiet room began (-1 not yet); and when it may try a lure again. */
  private luring = false;
  private wordsFrom = -1;
  private lureAt = 0;

  /** `cast` is casting's word (cast.ts): whether it means to take a place tonight, and whom it could play. */
  constructor(
    private readonly h: SwapHost,
    private readonly spy: Spy,
    cast: { may: boolean; playable: readonly number[] },
    private readonly rng: Rng,
  ) {
    const n = h.people.length;
    this.pairs = new Float32Array(n * n);
    this.tonight = cast.may;
    this.playable = new Set(cast.playable);
  }

  /** It may still take someone's place tonight. */
  get may(): boolean {
    return this.tonight && !this.done;
  }

  /** Following the one whose place it means to take, or about to come out as them. */
  get busy(): boolean {
    return this.task >= 0 || this.ready >= 0;
  }

  /** The body hidden behind the bolt: it comes out as them at its next step. */
  get settling(): boolean {
    return this.ready >= 0;
  }

  /** Whom it follows now, a step behind (-1 nobody). */
  get trailing(): number {
    return this.task >= 0 ? this.face : -1;
  }

  /** The one it means to play, kept in view meanwhile (-1 nobody): while it may, from 19:40, with murder on and before the first goodbye. */
  get watching(): number {
    const h = this.h;
    if (!this.may || this.face < 0 || h.t < SWAP_FROM || h.byeAt >= 0 || !this.spy.covers.active("murder")) return -1;
    return this.face;
  }

  /** Its plan asked for this face (the host's, or a friend's of its target), or the lab did. */
  private asked(): boolean {
    return this.face >= 0 && (this.why === "host" || this.why === "friend" || this.why === "lab");
  }

  // ------------------------------------------------------------ what it sees

  /**
   * The spy sees b: whom they're close to, as it looks. A partner at their side, a hug or a kiss
   * hello says close; a handshake an acquaintance; talking in the same circle adds a little at
   * every look, up to a friend's.
   */
  saw(b: Person): void {
    const h = this.h;
    const me = this.spy.id;
    if (b.staff) return;
    const a = b.action;
    if (b.partner !== null && b.partner !== me) {
      const c = h.people[b.partner]!;
      if (c.present && !c.gone && c.level === b.level && Math.hypot(c.x - b.x, c.z - b.z) <= SIDE) this.close(b.id, c.id, PARTNER_SIDE);
    }
    if (a?.ref !== undefined && a.ref !== me && a.startedAt !== null) {
      if (a.id === "greet") this.close(b.id, a.ref, a.pose === "kiss" ? KISS : SHAKE);
      else if (a.id === "row" && a.note === "hug") this.close(b.id, a.ref, HUG);
    }
    const g = h.circleOf(b);
    if (g) for (const m of g.members) if (m !== b.id && m !== me) this.close(b.id, m, 0, TALK);
  }

  /** A pair looks at least `v` close to it, and `add` more, up to a friend's for talk. */
  private close(i: number, j: number, v: number, add = 0): void {
    const n = this.h.people.length;
    const k = i * n + j;
    const was = this.pairs[k]!;
    const now = add > 0 ? Math.max(was, Math.min(TALK_MAX, was + add)) : Math.max(was, v);
    this.pairs[k] = now;
    this.pairs[j * n + i] = now;
  }

  /** How many it has seen close to v tonight, summed, of those still here. */
  private known(v: number): number {
    const h = this.h;
    const n = h.people.length;
    let s = 0;
    for (const q of h.people) if (q.id !== v && q.id !== this.spy.id && q.present && !q.gone) s += this.pairs[v * n + q.id]!;
    return s;
  }

  // ---------------------------------------------------------------- whose face

  /** How well it could pass in their clothes: by height (within 8 cm 1, within 15 cm 0.3, else 0), and a tenth for the other sex. */
  fit(v: Person): number {
    const own = this.spy.own;
    const d = Math.abs(v.look.height - own.height);
    const hf = d <= NEAR + 1e-6 ? 1 : d <= FAR + 1e-6 ? FAR_FIT : 0;
    return hf * (v.look.sex === own.sex ? 1 : OTHER_SEX);
  }

  /** A guest whose place it could take: one casting would let it play, here, up and about, not caught up in a drama, not its target, and not itself. */
  private candidate(v: Person): boolean {
    const spy = this.spy;
    return this.playable.has(v.id) && v.id !== spy.id && v.present && !v.gone && !v.down && v.id !== spy.goal.target && !this.h.dramas.busy(v);
  }

  /** Nothing of its goal on it or in its coat, which stays on its hook: neither the thing it is after nor a kill's theft first in hand or stashed. */
  private clean(p: Person): boolean {
    const things = this.spy.things;
    for (const x of [things.thing(p), things.firstThing()]) if (x >= 0 && (this.h.world.items.holder[x] === p.id || things.stashed(x, p))) return false;
    return true;
  }

  /** The friend of its target it would play: the one it has seen closest to them, if close enough and someone it could pass as (-1 none). */
  friendOf(target: number): number {
    const h = this.h;
    const n = h.people.length;
    if (target < 0) return -1;
    let best = -1;
    let score = 0;
    for (const v of h.people) {
      if (!this.candidate(v)) continue;
      const c = this.pairs[target * n + v.id]!;
      const s = c * this.fit(v);
      if (c >= FRIEND_SEEN && s > score) {
        best = v.id;
        score = s;
      }
    }
    return best;
  }

  /** Whether its plan can take a place now, with nothing of its goal on it: the host's (as someone it could pass as well), or a friend of its target's it has seen. */
  offers(place: "host-place" | "friend-place"): boolean {
    const h = this.h;
    if (!this.may || h.byeAt >= 0 || !this.clean(this.spy.record)) return false;
    const host = h.host;
    if (place === "host-place") return host.id !== this.spy.id && host.present && !host.gone && !host.down && !h.dramas.busy(host) && this.fit(host) >= 1;
    return this.spy.goal.kind === "kill" && this.friendOf(this.spy.goal.target) >= 0;
  }

  /** The plan wants a place (host-place, friend-place): whose, from now on until it is taken or the plan moves on. False when there is nobody to play. */
  aim(why: "host" | "friend"): boolean {
    if (!this.may) return false;
    if (this.why === why && this.face >= 0) return true;
    const v = why === "host" ? (this.offers("host-place") ? this.h.host.id : -1) : this.friendOf(this.spy.goal.target);
    if (v < 0) return false;
    this.set(v, why);
    return true;
  }

  /**
   * The lab's ask (a provocation): v's place at its first good chance from now, whatever casting
   * said and whoever v is, followed as a face its plan asked for and never let go until taken or
   * v is gone. Nothing once it has taken a place.
   */
  ask(v: Person): void {
    if (this.done || v.id === this.spy.id || v.staff) return;
    this.tonight = true;
    this.set(v.id, "lab");
  }

  private set(v: number, why: SwapWhy): void {
    this.face = v;
    this.why = why;
    this.tries = 0;
    this.stats.picks++;
    this.note(`swap:face:${v}:${why}`);
  }

  /** Two or more people about it on its avoid list. */
  private watchful(): number {
    let c = 0;
    for (const q of this.h.people) if (q.present && !q.gone && !q.down && this.spy.answers.avoids(q.id)) c++;
    return c;
  }

  /** The face it means to play holds while they're here (one of its own, while it could still play them) and it hasn't followed them in vain too often; then a while before it, or the plan, picks again. Never while it kills. */
  private keep(): void {
    const h = this.h;
    if (this.face < 0 || this.spy.kill.busy || this.ready >= 0) return;
    const v = h.people[this.face]!;
    const here = this.asked() ? v.present && !v.gone && !v.down : this.candidate(v);
    if (here && (this.tries < TRIES || this.why === "lab")) return;
    if (this.tries >= TRIES) this.nextAt = Math.max(this.nextAt, h.t + this.rng.range(AFTER_TRIES[0], AFTER_TRIES[1]));
    this.face = -1;
    this.why = null;
    this.tries = 0;
  }

  /**
   * A good chance now: the face it means to play (its plan's, else one of its own, picked now if
   * need be) seen setting off somewhere quiet; with one of its own, anyone else it would pass as
   * at least as well seen setting off so, whom it goes after instead.
   */
  private chance(p: Person): Person | null {
    const h = this.h;
    const n = h.people.length;
    const off = (q: Person) => this.offAlone(q) && h.memory.lastT[p.id * n + q.id]! >= h.t - SEEN;
    if (this.face < 0) this.pick(p);
    if (this.face < 0) return null;
    const q = h.people[this.face]!;
    if (off(q)) return q;
    if (this.asked()) return null;
    let best: Person | null = null;
    let most = this.weight(q);
    for (const v of h.people) {
      if (v === q || !this.candidate(v) || !off(v)) continue;
      const w = this.weight(v);
      if (w > 0 && w >= most) {
        best = v;
        most = w;
      }
    }
    if (best) this.set(best.id, this.reason());
    return best;
  }

  /** How much it would like to play v: the better they'd pass and the fewer it has seen close to them, the more. */
  private weight(v: Person): number {
    return this.fit(v) / (1 + this.known(v.id));
  }

  /**
   * A face of its own: anyone it could pass as whom it has seen lately, the better they'd pass and
   * the fewer it has seen close to them the likelier (a new face once two or more about it are
   * watchful of it, else one for the second half of the evening).
   */
  private pick(p: Person): void {
    const h = this.h;
    const n = h.people.length;
    const pool: Array<readonly [Person, number]> = [];
    for (const v of h.people) {
      if (!this.candidate(v) || h.memory.lastT[p.id * n + v.id]! < h.t - LATELY) continue;
      const w = this.weight(v);
      if (w > 0) pool.push([v, w]);
    }
    if (pool.length) this.set(this.rng.weighted(pool).id, this.reason());
  }

  /** Why it wants a face of its own now: two or more about it watchful of it, or the second half of the evening. */
  private reason(): SwapWhy {
    return this.watchful() >= WATCHFUL ? "face" : "halfway";
  }

  // ------------------------------------------------------------- each step

  /** Once a step, before anything else of the spy's: the kill behind the bolt over, it comes out as them. */
  settle(): void {
    if (this.ready < 0) return;
    const h = this.h;
    const spy = this.spy;
    const v = h.people[this.ready]!;
    const a = spy.record;
    this.ready = -1;
    this.done = true;
    // Their jacket or dress on it now: its own clothes onto the body half the time, else into a wardrobe, the body left in shirtsleeves or a slip.
    const body = spy.bodies[spy.bodies.length - 1];
    if (body?.who === v.id) {
      if (this.rng.chance(WEARS)) {
        body.wears = a.id;
        body.look = { ...body.look, outfit: a.look.outfit, color: a.look.color, accent: a.look.accent, hat: a.look.hat };
      } else {
        body.stripped = true;
        body.look = { ...body.look, hat: false };
      }
    }
    this.stats.swaps++;
    h.swapSpy(v);
    h.log("spy", [v.id, a.id], v.room, `swap:${a.id}:${v.id}:${this.why}`);
  }

  /** Once a step, after its plan's: on a trail, the moment (the kill runner's to take) or the try's end; else, every few steps, a good chance to go after someone. */
  step(): void {
    const p = this.spy.record;
    this.ticks++;
    if (this.task >= 0) return this.luring ? this.words(p) : this.trail(p);
    if (!this.may || this.ticks % 4 !== 0 || this.h.t < SWAP_FROM) return;
    this.keep();
    if (!this.free(p)) return;
    const q = this.chance(p);
    if (q) return this.follow(p, q);
    const v = this.lurable(p);
    if (v) this.lure(p, v);
  }

  /** A face of its own it could go up to for a word now: standing about near it in a beat of the evening that lets people wander off, in its view. */
  private lurable(p: Person): Person | null {
    const h = this.h;
    if (this.face < 0 || this.asked() || h.t < this.lureAt || !ASIDE_PHASES.has(h.programme[this.spy.phase]?.id ?? "")) return null;
    const q = h.people[this.face]!;
    if (!this.candidate(q) || (q.action && !LOOSE.has(q.action.id)) || q.level !== p.level || q.room !== p.room || Math.hypot(q.x - p.x, q.z - p.z) > LURE_NEAR) return null;
    return h.memory.lastT[p.id * h.people.length + q.id]! >= h.t - SEEN ? q : null;
  }

  /**
   * Up to them for a word, and once they come along (stepDone), to a guest bedroom with nobody in
   * it, the bolt drawn behind them, to talk while it waits for its moment; the talk over with none,
   * the bolt back and out. No such room, and not now.
   */
  private lure(p: Person, q: Person): void {
    const h = this.h;
    this.lureAt = h.t + this.rng.range(LURE_EVERY[0], LURE_EVERY[1]);
    const to = boltedBedroom(this.h, p, q, this.rng);
    if (!to) return;
    if (this.spy.plans.busy && !this.spy.plans.yieldStep()) return;
    const steps: Step[] = [
      { do: "meet", who: q.id, label: "swap:to" },
      { do: "say", who: q.id, s: this.rng.range(ASK_SECS[0], ASK_SECS[1]), pose: "talk", label: "swap:ask" },
      { do: "goto", to: to.at, label: "swap:go" },
      { do: "wait", s: 99999, pose: "stand", label: "swap:in" },
      { do: "bolt", door: to.door, room: to.room, label: "swap:bolt" },
      { do: "wait", s: 99999, pose: "talk", label: "swap:words" },
      { do: "unbolt", door: to.door, room: to.room, label: "swap:unbolt" },
    ];
    // Whoever comes along follows it, as on its plan's word in private (tasks.ts).
    const t = h.tasks.spy(p, "swap-lure", "talk", steps, [], ASIDE_GAP);
    if (t.outcome !== null) return;
    this.task = t.id;
    this.luring = true;
    this.wordsFrom = -1;
    this.from = h.t;
    this.tryFor = this.rng.range(WORDS[0], WORDS[1]);
    this.tries++;
    this.stats.lures++;
    this.note(`swap:lure:${q.id}`);
  }

  /** A step of its task done: the word said, they come along if they don't doubt it, are still free to, and will; else it was only a word. */
  stepDone(t: Task, st: Step): void {
    if (t.id !== this.task || !this.luring || st.label !== "swap:ask") return;
    const h = this.h;
    const p = this.spy.record;
    const q = h.people[this.face]!;
    const free = !q.action || LOOSE.has(q.action.id);
    if (!this.candidate(q) || !free || q.level !== p.level || Math.hypot(q.x - p.x, q.z - p.z) > 3 || h.ident.doubtOf(q.id, p.id, h.t) >= TEST || !this.rng.chance(COME_ALONG)) {
      this.nextAt = h.t + this.rng.range(AFTER_LOST[0], AFTER_LOST[1]);
      return this.stop(t, "refused");
    }
    h.tasks.join(t, q);
    // Walking together: at the slower one's pace (the task puts its own back as it ends).
    p.speed = Math.min(p.speed, q.speed);
    this.note(`swap:aside:${q.id}`);
  }

  /** A word in private: talking behind the bolt, the moment, the kill; them gone off, the beat over or the word never said, it lets them be; the talk over with no moment, the bolt back and back to the party a while. */
  private words(p: Person): void {
    const h = this.h;
    const spy = this.spy;
    const t = h.tasks.get(this.task);
    if (!t) return;
    const q = h.people[this.face]!;
    const label = t.steps[t.i]?.label;
    const talking = label === "swap:words";
    const waitIn = label === "swap:in" && (!t.party.includes(q.id) || h.t - t.stepAt > IN_WAIT);
    if (
      !q.present ||
      q.gone ||
      q.down ||
      h.byeAt >= 0 ||
      h.t < spy.answers.lowUntil ||
      !spy.covers.active("murder") ||
      !ASIDE_PHASES.has(h.programme[spy.phase]?.id ?? "") ||
      (talking && !t.party.includes(q.id)) ||
      waitIn
    ) {
      this.nextAt = h.t + this.rng.range(AFTER_LOST[0], AFTER_LOST[1]);
      return this.stop(t, "gone");
    }
    // In the room: once they've caught up, the bolt.
    if (label === "swap:in") {
      if (q.level === p.level && q.room === p.room && Math.hypot(q.x - p.x, q.z - p.z) <= IN_BESIDE) h.tasks.next(t);
      return;
    }
    if (!talking) {
      if (h.t - this.from >= LURE_MAX && !t.party.includes(q.id)) {
        this.nextAt = h.t + this.rng.range(AFTER_LOST[0], AFTER_LOST[1]);
        this.stop(t, "not-yet");
      }
      return;
    }
    if (this.wordsFrom < 0) this.wordsFrom = h.t;
    if (this.ticks % 2 === 0) {
      const m = spy.kill.moment(p, q, { strangle: true, inject: false, shut: true });
      if (m) {
        this.stats.moments++;
        // The bolt stays drawn for the kill behind it (a task's bolts are drawn back as it ends).
        t.steps = t.steps.filter((s) => s.do !== "bolt");
        this.stop(t, "kill");
        // A pause in the talk: they stand a moment for what it says next.
        q.thinkAt = Math.max(q.thinkAt, h.t + REACH_PAUSE);
        if (!this.asked()) this.why = this.reason();
        if (spy.kill.begin(p, q, m, "swap")) return;
        this.nextAt = h.t + this.rng.range(AFTER_LOST[0], AFTER_LOST[1]);
        return;
      }
    }
    if (h.t - this.wordsFrom >= this.tryFor) {
      this.nextAt = h.t + this.rng.range(TRAIL_BETWEEN[0], TRAIL_BETWEEN[1]);
      // The bolt back and out (the task's last step), as if it had only been a word.
      this.wordsFrom = Infinity;
      h.tasks.next(t);
    }
  }

  /** Free to go after them: murder on, no kill under way, nothing of its plan begun, nothing of its goal on it, no alibi out, between the programme's beats or at dinner, only idling or at the table. */
  private free(p: Person): boolean {
    const h = this.h;
    const spy = this.spy;
    if (p.staff || h.byeAt >= 0 || h.t < this.nextAt || h.t < spy.answers.lowUntil || spy.kill.busy || spy.silence.busy || spy.tactics.alibi) return false;
    if (!spy.covers.active("murder") || (spy.plans.busy && !spy.plans.waiting) || !FREE.has(h.programme[spy.phase]?.id ?? "") || !this.clean(p)) return false;
    return spy.plans.busy || !p.action || LOOSE.has(p.action.id) || p.action.id === "dinner";
  }

  /** Off somewhere quiet: the bathroom, the terrace, a wander, a search of the house. */
  private offAlone(q: Person): boolean {
    const a = q.action?.id ?? "mingle";
    return OFF_ALONE.has(a) || (a === "task" && this.h.tasks.of(q)?.kind === "search");
  }

  /** After them, a step behind: a step of its plan that only waits gives way. */
  private follow(p: Person, q: Person): void {
    const h = this.h;
    if (this.spy.plans.busy && !this.spy.plans.yieldStep()) return;
    const t = h.tasks.spy(p, "swap", "wander", [{ do: "shadow", who: q.id, gap: this.spy.habits.trailGap(TRAIL_GAP), label: "swap:trail" }]);
    if (t.outcome !== null) {
      this.nextAt = h.t + this.rng.range(AFTER_LOST[0], AFTER_LOST[1]);
      return;
    }
    this.task = t.id;
    this.from = h.t;
    this.tryFor = this.rng.range(TRAIL_TRY[0], TRAIL_TRY[1]);
    this.tries++;
    this.stats.trails++;
    this.note(`swap:follow:${q.id}`);
  }

  /** A step behind: alone with them behind a door it can bolt, the kill; them gone, the beat over, murder off or feeling watched, it lets them go; the try over (once they're out of the bathroom), back to the party a while. */
  private trail(p: Person): void {
    const h = this.h;
    const spy = this.spy;
    const t = h.tasks.get(this.task);
    if (!t) return;
    const q = h.people[this.face]!;
    if (!q.present || q.gone || q.down || h.byeAt >= 0 || h.t < spy.answers.lowUntil || !spy.covers.active("murder") || !FREE.has(h.programme[spy.phase]?.id ?? "")) {
      this.nextAt = h.t + this.rng.range(AFTER_LOST[0], AFTER_LOST[1]);
      return this.stop(t, "gone");
    }
    if (this.ticks % 2 === 0) {
      const m = spy.kill.moment(p, q, { strangle: true, inject: true, shut: true });
      if (m) {
        this.stats.moments++;
        this.stop(t, "kill");
        if (!this.asked()) this.why = this.reason();
        if (spy.kill.begin(p, q, m, "swap")) return;
        this.nextAt = h.t + this.rng.range(AFTER_LOST[0], AFTER_LOST[1]);
        return;
      }
    }
    // In the bathroom still, it waits for them to come out, up to a while.
    if (h.t - this.from >= this.tryFor && (q.action?.id !== "toilet" || h.t - this.from >= WAIT_OUT)) {
      this.nextAt = h.t + this.rng.range(TRAIL_BETWEEN[0], TRAIL_BETWEEN[1]);
      this.stop(t, "not-yet");
    }
  }

  private stop(t: Task, why: string): void {
    this.h.tasks.finish(t, why);
  }

  /** One of its tasks ended: the trail's or the word's, however it went. */
  finished(t: Task): void {
    if (t.id !== this.task) return;
    this.task = -1;
    this.luring = false;
    this.wordsFrom = -1;
  }

  /**
   * The kill it began ended (kill.ts): dead and hidden behind the bolt, it comes out as them at its
   * next step; dead where someone could find them, or let go alive, the swap is off for tonight;
   * broken off or lost, it may follow them again later.
   */
  killEnded(out: KillOutcome): void {
    const h = this.h;
    const spy = this.spy;
    if (out === "dead") {
      const body = spy.bodies[spy.bodies.length - 1];
      if (body?.who === this.face && body.hides > 0.1) {
        this.ready = this.face;
        return;
      }
    }
    if (out === "dead" || out === "survived") {
      this.done = true;
      this.stats.failed++;
      this.note(`swap:failed:${out}`);
      return;
    }
    const [lo, hi] = out === "broken" ? AFTER_BREAK : AFTER_LOST;
    this.nextAt = Math.max(this.nextAt, h.t + this.rng.range(lo, hi));
  }

  /** Its line in the spy's digest: faces picked, trails, words asked, moments, places taken, and swaps that went wrong. */
  digest(): string {
    const s = this.stats;
    return `${s.picks},${s.trails},${s.lures},${s.moments},${s.swaps},${s.failed}`;
  }

  private note(s: string): void {
    const p = this.spy.record;
    this.h.log("spy", [p.id], p.room, s);
  }
}
