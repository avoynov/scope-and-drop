/**
 * Running the spy's plan (milestone 3 technical plan: Running a plan, When a step fails, Pacing).
 * Whenever its mind is free the spy asks what is true now (goals.ts), plans the cheapest way on to
 * its goal (planner.ts) and starts the plan's next step as a task of kind `spy`; when no step can
 * start it lives the evening like any guest, and asks again the next time it is free.
 *
 * An act is a walk to its spot, a wait there for the moment (privacy.ts) and then the act itself:
 * a timed `risky:` wait in its pose, a notable for whoever sees it and a hard tell while it lasts.
 * Going there, waiting for the room to look away and following the target fold into the act they
 * lead to. It waits for its moment a minute or two at a time and goes back to the party between
 * tries. Ten minutes' waiting in all, a place it can't get to, a bag its owner never puts down or a
 * third break-off is a failure: the planner makes that action cost four times as much for 15
 * minutes, and the spy plans again from what is true then.
 *
 * While it acts it knows only its own senses: whoever it notices makes it break off, stand, look
 * at something else and try again a few minutes later. Standing takes it a second (CAUGHT), so
 * whoever walked in looking its way sees the act as it stops, and someone who comes in silently
 * behind it sees it for longer: that is how a guest sees a hard tell.
 *
 * Pacing: nothing before 19:20, while the host still watches the door; nothing new at dinner as a
 * guest (it sits through it; PR 4's alibis get it up); nothing while it lies low; a kill's theft
 * first dropped at 21:00; and whatever it waits for given up at the farewell's first goodbye.
 *
 * A kill (PR 5): following the target a step behind, the kill runner (kill.ts) watches for either
 * moment, alone with them or close and unwatched, and takes it, whichever the plan expected; the
 * plan says only which wait counts against which method. Waiting for them alone starts when they
 * set off somewhere quiet; the embrace's wait whenever they're about.
 *
 * Someone else's place (PR 5, swap.ts): when the plan's way in is the host's keys, or a friend of
 * its target it has seen with them, the step only names whose place it wants; the swap takes it
 * when its own moment comes, and the plan goes on from what is true then. Wearing the friend's
 * face, a word in private: it asks the target for a moment where they stand about, takes them to
 * a guest bedroom with a bolt, draws it behind them, and while they talk the kill runner watches
 * for them alone. A stranger to them, it may ask the same ("let me show you something upstairs"):
 * half of those it asks come along, and twice told no it asks no more tonight.
 *
 * Playing a waiter (PR 5), it plans between its rounds (sim.ts), and dinner is work like any
 * other part of the evening.
 *
 * Its tactics (PR 4, tactics.ts), each only while it is on: an act away from the party wrapped in
 * a false alibi; a spill down a bag's owner, and their bag carried off half the time to be gone
 * through somewhere quiet and put back; the lights out in the act's room, with one try at the
 * moment while they're out. A moment that never came, or a third break-off, is the failure of the
 * move that was to bring it (looking away, the lights), so the planner tries the other next time.
 */
import type { Rng } from "../../mansion/core/rng";
import { TEST } from "../ident";
import { VERBS, type Verb } from "../memory";
import { yawTo, type RoomCells } from "../places";
import type { SoundKind } from "../senses";
import type { Step, Task } from "../tasks";
import type { PartyEvent, Person, Spot } from "../types";
import { ACT_OF, type ActId, type ActSite, type GoalContext, type GoalHost, type GoalThings } from "./goals";
import type { Spy } from "./index";
import { BLOCK_FOR, F, plan, type PlanActionId, type Tactic } from "./planner";
import { check, doorsNow, held, nearRooms, noticed, type PrivacyHost, type PrivacyResult, type Spot3 } from "./privacy";

/** What running the plan needs from the party, besides the goal's and the privacy check's. */
export interface StepsHost extends GoalHost, PrivacyHost {
  readonly cells: RoomCells;
  /** When the farewell's first goodbye was said (-1 not yet). */
  readonly byeAt: number;
  notable(p: Person, verb: Verb, obj: number, secs: number, room?: number): void;
  end(p: Person, done: boolean): void;
  sound(kind: SoundKind, at: { level: number; x: number; z: number; room: number }, source: number, ref?: number): void;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
  /** The perch's view of a person now (0 to 1). */
  visibility(p: Person): number;
}

/** Nothing risky starts before 19:20, while the host still watches the door (in-game s from 19:00). */
export const FIRST_STEP = 20 * 60;
/** A kill's theft first still undone at 21:00 is dropped, so the kill keeps the rest of the evening. */
export const DROP_FIRST = 2 * 3600;
/** One visit waiting for the moment, and the time back at the party before the next (in-game s). */
export const TRY: readonly [number, number] = [90, 150];
export const BETWEEN: readonly [number, number] = [120, 300];
/** Waiting this long in all for a step's moment is a failure. */
export const WAIT_MAX = 10 * 60;
/** A step broken off this many times is a failure; after a break-off it tries again 2 to 5 minutes later. */
export const BREAKS = 3;
export const AFTER_BREAK: readonly [number, number] = [120, 300];
/** After a failure, a while back at the party before it plans again. */
export const AFTER_FAIL: readonly [number, number] = [120, 300];
/** The look at something else once it has broken off. */
const COVER_LOOK: readonly [number, number] = [6, 10];
/** Caught at it, it takes about a real second to stand and turn away (in-game s): whoever looks meanwhile sees what it was doing. */
export const CAUGHT = 3;
/** Following the target: one try, and the wait before the next. */
export const TRAIL_TRY: readonly [number, number] = [180, 360];
export const TRAIL_BETWEEN: readonly [number, number] = [300, 600];
/** How far behind it follows, and how close it comes for a pocket or the host's jacket (m). */
export const TRAIL_GAP = 4;
const BRUSH_GAP = 0.9;
/** Close enough for a hand to reach (m). */
const REACH = 1.5;
/** A bag whose owner never puts it down for this long is a failure; meanwhile an eye on them a few minutes at a time. */
const FREE_MAX = 30 * 60;
const WATCH: readonly [number, number] = [120, 240];
/** With no plan, or nothing it can do yet, it looks again after this. */
const LATER = 300;
/** Looking for the bag's owner: a room looked round isn't looked in again for this long, and the next look waits a little (in-game s). */
const SEARCHED = 10 * 60;
const AFTER_LOOK: readonly [number, number] = [20, 40];
/** Putting what it took into its own coat (in-game s). */
const STASH: readonly [number, number] = [6, 10];
/** Interrupted from outside (a spill, a word): back to it in a minute or two. */
const INTERRUPTED: readonly [number, number] = [60, 120];
/** Its time back at the party over, within this it gets up from whatever it idly does for the next step (in-game s). */
const RESUME = 30;
/** What it drops to follow the target, and where the target going suggests a moment alone. */
export const LOOSE: ReadonlySet<string> = new Set(["mingle", "drink", "art", "wander", "sit", "snack", "use", "terrace"]);
export const OFF_ALONE: ReadonlySet<string> = new Set(["toilet", "terrace", "wander"]);
/** At dinner it gets up for a step only between these shares of the dinner: once everyone is seated, before the dessert. */
const UP: readonly [number, number] = [0.15, 0.8];
/** The plan's moves that fold into the step they lead to. */
const FOLD: ReadonlySet<PlanActionId> = new Set(["go", "look-away", "follow", "commotion"]);
/** A kill's steps: waiting for the target alone and strangling them, and the embrace, the jab and the walk off (kill.ts runs them). */
const ALONE_WAY: ReadonlySet<PlanActionId> = new Set(["wait-alone", "strangle"]);
const EMBRACE_WAY: ReadonlySet<PlanActionId> = new Set(["embrace", "inject", "walk-off"]);
/** The lights out: one try at the moment while they're out (in-game s). */
const DARK_TRY = 30;
/** Taking a bag up from its chair to carry it off (in-game s). */
const TAKE_SECS = 2;
/** A word in private: asking for a moment, and then talking behind the bolt while it waits for them alone (in-game s); following at this (m). */
export const ASK_SECS: readonly [number, number] = [3, 5];
export const WORDS: readonly [number, number] = [30, 60];
export const ASIDE_GAP = 0.8;
/** Asked aside only between the programme's beats, when people wander off; and they stand this long for what it says next (in-game s). */
export const ASIDE_PHASES: ReadonlySet<string> = new Set(["arrival", "mingle", "dancing", "games"]);
export const REACH_PAUSE = 6;
/** A stranger asking for a word in private: the share who come along, and its target telling it no this often ends its asking for tonight. */
export const COME_ALONG = 0.5;
const LURE_ASKS = 2;
/** The guest bedroom for a word in private: within this of them, by a straight line and 6 m a storey (m); there, it waits this long at most for them to catch up (in-game s), until they're this close (m). */
export const LURE_WALK = 40;
export const IN_WAIT = 90;
export const IN_BESIDE = 2.5;

/** The step under way: what it does, where, how long, and how far it has got. */
interface Running {
  action: PlanActionId;
  /** The act, or null for a walk of its own (learning the way, finding the bag, stashing, following). */
  act: ActId | null;
  site: ActSite | null;
  /** The room the step is about (the study behind the door it picks), or -1. */
  room: number;
  /** The act's length (in-game s). */
  secs: number;
  /** When it began waiting for its moment and began the act (-1 not yet), and how long this try lasts. */
  awaitFrom: number;
  riskyAt: number;
  tryFor: number;
  /** The rooms near the spot by the room graph, kept while it waits at one spot. */
  near: Set<number> | null;
  /** The locked door it picks (-1 none). */
  door: number;
  /** How the runner ended it, when it did (null: it ran out, or something else ended it). */
  end: string | null;
  /** The folded move that was to bring the moment (the room looking away, the lights out), whose failure the moment's is; null none. */
  via: PlanActionId | null;
  /** Someone's bag carried off to go through somewhere quiet: where, and whether it's in its hands yet. */
  carry: { to: Spot; picked: boolean } | null;
}

/** One line of the plan's history, for the lab's card. */
export interface PlanRecord {
  t: number;
  what: PlanActionId;
  how: string;
}

const spotOf = (p: Person): Spot3 => ({ level: p.level, x: p.x, z: p.z, y: p.y, room: p.room });

/** Somewhere for a word in private: the nearest guest bedroom with a bolt, empty and not bolted, within LURE_WALK of them; where in it, and its door (null: none). */
export function boltedBedroom(h: StepsHost, p: Person, q: Person, rng: Rng): { at: Spot; door: number; room: number } | null {
  let best: { at: Spot; door: number; room: number } | null = null;
  let bd = LURE_WALK;
  for (const r of h.places.guestBedrooms) {
    const d = h.world.doors.find((x) => x.lock === "inside" && x.inner === r.index);
    if (!d || d.locked || h.people.some((o) => o !== p && o !== q && o.present && !o.gone && o.room === r.index && (!o.down || o.down === "ill"))) continue;
    const at = h.cells.random(r.index, rng, 0.8);
    const dist = at ? Math.hypot(at.x - q.x, at.z - q.z) + 6 * Math.abs(at.level - q.level) : Infinity;
    if (at && dist <= bd) {
      best = { at, door: d.id, room: r.index };
      bd = dist;
    }
  }
  return best;
}

export class Plans {
  /** The plan as last made and the facts it was made from, and the last privacy check, for the lab. */
  steps: PlanActionId[] = [];
  facts = 0;
  check: PrivacyResult | null = null;
  readonly history: PlanRecord[] = [];
  /** Actions that failed, and until when they cost the planner four times as much. */
  readonly blocked = new Map<PlanActionId, number>();
  /** A kill's target gone home: it is over for tonight. */
  parked = false;
  readonly stats = { started: 0, done: 0, broken: 0, failed: 0, tries: 0 };
  /** Seconds waited for each step's moment, and its break-offs, since it last failed or was done. */
  private readonly waited = new Map<PlanActionId, number>();
  private readonly breaks = new Map<PlanActionId, number>();
  private retryAt = 0;
  private freeSince = -1;
  private run: Running | null = null;
  private task = -1;
  private ticks = 0;
  private quiet = false;
  /** Up from the dinner table for its steps (once a dinner), and the dinner it got up from. */
  private up = false;
  private upAt = -1;
  /** How far each door was open on the last step, for hearing one open from shut. */
  private readonly shut: Float32Array;
  /** Rooms it looked round for the bag's owner, and when. */
  private readonly searched = new Map<number, number>();
  /** Times its target said no to a stranger's word in private. */
  private refused = 0;

  constructor(
    private readonly h: StepsHost,
    private readonly spy: Spy,
    readonly things: GoalThings,
    private readonly rng: Rng,
  ) {
    this.shut = new Float32Array(h.world.doors.length);
  }

  /** The step under way, for the lab: its action and act, and its stage. */
  get current(): { action: PlanActionId; act: ActId | null; stage: "going" | "waiting" | "acting" } | null {
    const r = this.run;
    if (!r) return null;
    return { action: r.action, act: r.act, stage: r.riskyAt >= 0 ? "acting" : r.awaitFrom >= 0 ? "waiting" : "going" };
  }

  /** A step of the plan (or the look after a break-off) under way. */
  get busy(): boolean {
    return this.task >= 0;
  }

  /** Whether the step under way only waits for its moment (at the spot, a step behind the target, an eye on a bag): nothing begun that it can't leave. */
  get waiting(): boolean {
    const t = this.task >= 0 ? this.h.tasks.get(this.task) : undefined;
    const st = t?.steps[t.i];
    return !!this.run && !!st && (st.label.startsWith("await:") || st.label === "trail" || st.label === "watch-bag");
  }

  /** Something more pressing (silence.ts): a step that only waits is given up for now, and taken up again a minute or two later. */
  yieldStep(): boolean {
    const t = this.task >= 0 ? this.h.tasks.get(this.task) : undefined;
    if (!t || !this.waiting) return false;
    this.retryAt = Math.max(this.retryAt, this.h.t + this.rng.range(INTERRUPTED[0], INTERRUPTED[1]));
    this.stop(t, "yielded");
    return true;
  }

  /** Whom it follows now, a step behind (-1 nobody). */
  get trailing(): number {
    const t = this.task >= 0 ? this.h.tasks.get(this.task) : undefined;
    return t?.steps[t.i]?.label === "trail" ? this.spy.goal.target : -1;
  }

  /**
   * Whether a step could start now, as far as it can tell without starting it (habits.ts drops an
   * errand for one): nothing in the way, and the plan's first real step has what it needs.
   */
  ready(p: Person): boolean {
    const h = this.h;
    if (!this.free() || this.seated(p)) return false;
    const ctx = this.things.context(p);
    if ((this.things.facts(p, ctx) & ctx.goal) === ctx.goal) return false;
    const pl = this.make(p, ctx);
    if (!pl) return false;
    const a = pl.steps[this.lead(pl.steps)]!;
    const act = ACT_OF[a];
    if (act) return this.things.site(act, p) !== null;
    if (a === "follow" || ALONE_WAY.has(a)) return OFF_ALONE.has(h.people[this.spy.goal.target]?.action?.id ?? "mingle");
    if (EMBRACE_WAY.has(a)) return true;
    if (a === "stash") return p.coat >= 0 && h.world.items.stateOf(p.coat) === "hung";
    if (a === "spill") return this.spillable() !== null;
    if (a === "aside" || a === "lure") return this.asideFor() !== null;
    return a === "find-bag" || a === "wait-owner" || a === "learn" || a === "tour-alone" || a === "go";
  }

  /** At dinner as a guest, seated until it gets up (a waiter's dinner is work like any other). */
  private seated(p: Person): boolean {
    return !p.staff && this.h.programme[this.spy.phase]?.id === "dinner" && !this.up;
  }

  /**
   * Its mind is free: start the plan's next step if one can start now (true), or leave the spy to
   * the evening (false).
   */
  think(p: Person): boolean {
    const started = this.plan(p);
    // Back to the table once nothing more can be done away from it.
    if (!started) this.up = false;
    return started;
  }

  /**
   * At dinner, seated (sim.ts asks every few seconds): whether to get up now, once a dinner, for a
   * step that wants the rest of the house empty, as it is with everyone at the table. It just goes,
   * up mid-course (PR 4's alibis give it a reason), and does what it can before it sits again.
   */
  upFromDinner(p: Person, progress: number): boolean {
    const h = this.h;
    const ph = h.programme[this.spy.phase];
    if (!ph || ph.id !== "dinner" || this.upAt === ph.start || progress < UP[0] || progress > UP[1] || !this.free()) return false;
    const pl = this.make(p);
    if (!pl) return false;
    const act = ACT_OF[pl.steps[this.lead(pl.steps)]!];
    if (!act || this.things.spec(act).mode !== "alone") return false;
    this.upAt = ph.start;
    this.up = true;
    this.note("up-from-dinner");
    return true;
  }

  /** Nothing in the way of a step starting: not parked, not done, not given up, not between tries, not lying low, not killing, not after a doubter or a face. */
  private free(): boolean {
    const h = this.h;
    const spy = this.spy;
    if (this.parked || spy.goal.doneAt !== null || h.byeAt >= 0 || this.task >= 0 || spy.kill.busy || spy.silence.busy || spy.swap.busy) return false;
    return h.t >= FIRST_STEP && h.t >= this.retryAt && h.t >= spy.answers.lowUntil;
  }

  private plan(p: Person): boolean {
    const h = this.h;
    const spy = this.spy;
    const g = spy.goal;
    if (!this.free() || this.seated(p)) return false;
    const things = this.things;
    if (things.firstOn(p) && h.t >= DROP_FIRST) {
      things.droppedFirst = h.t;
      this.note("drop-first");
    }
    const target = g.target >= 0 ? h.people[g.target]! : null;
    if (target?.gone) {
      this.parked = true;
      this.note("target-gone");
      return false;
    }
    if (target && !target.present) {
      this.retryAt = h.t + LATER;
      return false;
    }
    const ctx = things.context(p);
    this.facts = things.facts(p, ctx);
    if ((this.facts & ctx.goal) === ctx.goal) {
      if (g.kind !== "kill") spy.goalDone();
      return false;
    }
    const pl = this.make(p, ctx);
    if (!pl) {
      if (!this.quiet) this.note("no-plan");
      this.quiet = true;
      this.retryAt = h.t + LATER;
      return false;
    }
    this.quiet = false;
    if (pl.steps.join() !== this.steps.join()) {
      this.steps = pl.steps;
      this.note(`plan:${pl.steps.join(",")}`);
    }
    return this.next(p, pl.steps, ctx);
  }

  /** The cheapest plan from what is true now, or null when there is none (or nothing left to do). Only the tactics switched on are offered. */
  private make(p: Person, ctx = this.things.context(p)): { steps: PlanActionId[] } | null {
    const facts = this.things.facts(p, ctx);
    const pl = plan({ start: facts, goal: ctx.goal, use: ctx.use, needs: ctx.needs, costs: ctx.costs, tactics: this.tactics(), blocked: this.blocked, t: this.h.t });
    return pl?.steps.length ? pl : null;
  }

  /**
   * The planner's tactics its covers have on now: touring alone, other people's things, commotion
   * and murder (slipping in behind a tour waits for a fact of its own; poison was never built); and
   * with murder on, someone else's place while one is to be had (swap.ts), and a stranger's word in
   * private until its target has twice said no.
   */
  private tactics(): ReadonlySet<Tactic> {
    const c = this.spy.covers;
    const swap = this.spy.swap;
    const on = new Set<Tactic>();
    if (c.active("tours")) on.add("touring");
    if (c.active("others-things")) on.add("things");
    if (c.active("commotion")) on.add("commotion");
    if (c.active("murder")) on.add("murder");
    if (c.active("murder") && (swap.offers("host-place") || swap.offers("friend-place"))) on.add("swap");
    if (c.active("murder") && this.refused < LURE_ASKS) on.add("lure");
    return on;
  }

  /** Where the plan's first real step is: the moves that lead to an act fold into it. */
  private lead(steps: readonly PlanActionId[]): number {
    let k = 0;
    while (k < steps.length - 1 && FOLD.has(steps[k]!)) k++;
    return k;
  }

  /** The folded move before step k that was to bring its moment (null none). */
  private via(steps: readonly PlanActionId[], k: number): PlanActionId | null {
    for (let i = k - 1; i >= 0; i--) if (steps[i] === "look-away" || steps[i] === "commotion") return steps[i]!;
    return null;
  }

  /** Once a step, after everyone has moved and before anyone looks: the wait for the moment, the act's own watch, the trail; between steps, an eye on a target. */
  step(): void {
    const h = this.h;
    this.ticks++;
    const run = this.run;
    const t = this.task >= 0 ? h.tasks.get(this.task) : undefined;
    if (!run || !t) {
      if (this.task < 0 && this.ticks % 4 === 0) {
        this.watchTarget();
        this.resume();
      }
      return;
    }
    const p = this.spy.record;
    const st = t.steps[t.i];
    if (!st) return;
    // The farewell's first goodbye: whatever it still waits for is given up (an act under way it finishes).
    if (h.byeAt >= 0 && this.waiting) return this.stop(t, "given-up");
    if (st.label.startsWith("await:")) this.await(run, t, p);
    else if (st.label.startsWith("risky:")) this.watch(run, t, p);
    else if (st.label === "trail") this.trail(run, t, p);
    else if (st.label === "watch-bag") this.watchBag(run, t, p);
    else if (st.label === "aside:in") this.inWith(t, p);
    else if (st.label === "aside:words") this.words(run, t, p);
  }

  /** A step of one of its tasks finished: what the act leaves behind; someone's bag taken up to carry off; the spill. */
  stepDone(t: Task, st: Step): void {
    const run = this.run;
    if (t.owner !== this.spy.id || !run || t.id !== this.task) return;
    const p = this.spy.record;
    if (st.label.startsWith("risky:")) this.effect(run, p);
    else if (st.label === "stash") this.stashIn(p);
    else if (st.label === "learn" && run.room >= 0) this.h.memory.startKnowing(p.id, run.room, 0.8, 2);
    else if (st.label === "carry") this.carried(run, t, p);
    else if (st.label === "spill") this.spilled(t, p);
    else if (st.label === "aside:ask") this.asked(t, p);
  }

  /** One of its tasks ended, however it went. */
  finished(t: Task): void {
    if (t.owner !== this.spy.id) return;
    if (t.id === this.task) this.task = -1;
    const run = this.run;
    if (t.what === "cover" || !run) return;
    this.run = null;
    const h = this.h;
    const how = run.end ?? t.outcome ?? "gave-up";
    this.record(run.action, how);
    if (how === "done") {
      this.stats.done++;
      this.waited.delete(run.action);
      this.breaks.delete(run.action);
      // A look round for the bag's owner: that room not again for a while, and a moment before the next.
      if (run.action === "find-bag") {
        this.searched.set(run.room, h.t);
        this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(AFTER_LOOK[0], AFTER_LOOK[1]));
      }
      this.checkGoal();
      return;
    }
    // The runner ended it and has seen to what follows.
    if (run.end) return;
    this.clear(run);
    // No way there from the start is a failure; anything else that took it away (a spill, a word, the programme) only delays it.
    if (t.i === 0 && t.startedAt === h.t) this.fail(run.action, "no-way");
    else this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(INTERRUPTED[0], INTERRUPTED[1]));
  }

  /**
   * A kill for its goal ended (kill.ts): dead is done; broken off before the point of no return
   * counts as a break of the method's first step (three, and the planner tries the other way);
   * lost (they moved off) only delays it; let go alive, the method fails for a while.
   */
  killEnded(out: "dead" | "broken" | "lost" | "survived", how: "strangled" | "injection"): void {
    const h = this.h;
    const action: PlanActionId = how === "strangled" ? "strangle" : "embrace";
    this.record(action, out === "dead" ? "done" : out);
    if (out === "dead") {
      this.stats.done++;
      this.waited.delete(action);
      this.breaks.delete(action);
      return;
    }
    if (out === "lost") {
      this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(INTERRUPTED[0], INTERRUPTED[1]));
      return;
    }
    if (out === "survived") {
      this.breaks.delete(action);
      this.fail(action, "survived");
      return;
    }
    this.stats.broken++;
    const n = (this.breaks.get(action) ?? 0) + 1;
    if (n >= BREAKS) {
      this.breaks.delete(action);
      this.fail(action, "seen");
    } else {
      this.breaks.set(action, n);
      this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(AFTER_BREAK[0], AFTER_BREAK[1]));
    }
  }

  /** Its line in the spy's digest: steps started, done, broken off and failed, and whether a kill's target went home first. */
  digest(): string {
    const s = this.stats;
    return `${s.started},${s.done},${s.broken},${s.failed},${this.parked ? 1 : 0}`;
  }

  // ------------------------------------------------------------------ starting

  /** The plan's next step that does something: the moves that lead to an act fold into it. */
  private next(p: Person, steps: readonly PlanActionId[], ctx: GoalContext): boolean {
    const k = this.lead(steps);
    const a = steps[k]!;
    if (a !== "wait-owner") this.freeSince = -1;
    const act = ACT_OF[a];
    if (act) return this.startAct(p, a, act, ctx, this.via(steps, k));
    switch (a) {
      case "follow":
      case "wait-alone":
      case "strangle":
        // Only after them when they're off somewhere quiet; meanwhile it keeps an eye on them (watchTarget()).
        return OFF_ALONE.has(this.h.people[this.spy.goal.target]?.action?.id ?? "mingle") && this.startTrail(p, a === "follow" ? "wait-alone" : a);
      case "embrace":
      case "inject":
      case "walk-off":
        // Close and unwatched can come anywhere they stand about: after them whenever they're here.
        return this.startTrail(p, "embrace");
      case "find-bag":
        return this.startFind(p);
      case "wait-owner":
        return this.startWatch(p);
      case "learn":
      case "go":
        return this.startLearn(p, a, ctx);
      case "tour-alone":
        return this.startLearn(p, a, ctx, this.spy.habits.tourSteps(p, this.rng.int(1, 2), ctx.room));
      case "stash":
        return this.startStash(p);
      case "spill":
        return this.startSpill(p);
      case "host-place":
      case "friend-place":
        return this.startPlace(a);
      case "aside":
      case "lure":
        return this.startAside(p, a);
      default:
        // A tour slipped into waits for a fact of its own.
        this.retryAt = this.h.t + LATER;
        return false;
    }
  }

  /**
   * Someone else's place (the host's for the keys, a friend's of its target): the plan only names
   * whose; the swap follows them and takes its own moment (swap.ts), and the plan goes on from what
   * is true then. Nobody it could play, and that way has failed for now.
   */
  private startPlace(a: "host-place" | "friend-place"): boolean {
    if (!this.spy.swap.aim(a === "host-place" ? "host" : "friend")) {
      this.fail(a, "no-face");
      return false;
    }
    this.retryAt = this.h.t + LATER;
    return false;
  }

  /** Its target, if it could ask them for a word now: here and up, standing about or sitting, through a beat of the evening that lets people wander off. */
  private asideFor(): Person | null {
    const h = this.h;
    const q = h.people[this.spy.goal.target];
    if (!q?.present || q.gone || q.down || !ASIDE_PHASES.has(h.programme[this.spy.phase]?.id ?? "")) return null;
    return !q.action || LOOSE.has(q.action.id) ? q : null;
  }

  /**
   * A word in private, wearing the face of someone its target trusts (aside) or a stranger to them
   * (lure): up to them, a word ("have you got a moment?"), and once they come along, to a guest
   * bedroom with a bolt where nobody is, the bolt drawn behind them, to talk while it waits for them
   * alone. Nowhere to take them, and that way has failed for now.
   */
  private startAside(p: Person, a: "aside" | "lure"): boolean {
    const h = this.h;
    const q = this.asideFor();
    if (!q) {
      this.retryAt = h.t + LATER;
      return false;
    }
    const to = boltedBedroom(h, p, q, this.rng);
    if (!to) {
      this.fail(a, "no-room");
      return false;
    }
    this.run = { ...this.walk(a, to.room), tryFor: this.rng.range(WORDS[0], WORDS[1]) };
    this.stats.started++;
    // Whoever comes along follows it (tasks.ts); the bolt is drawn back as the task ends, unless a kill keeps it.
    const t = h.tasks.spy(
      p,
      a,
      "talk",
      [
        { do: "meet", who: q.id, label: "to:aside" },
        { do: "say", who: q.id, s: this.rng.range(ASK_SECS[0], ASK_SECS[1]), pose: "talk", label: "aside:ask" },
        { do: "goto", to: to.at, label: "aside:go" },
        { do: "wait", s: 99999, pose: "stand", label: "aside:in" },
        { do: "bolt", door: to.door, room: to.room, label: "aside:bolt" },
        { do: "wait", s: 99999, pose: "talk", label: "aside:words" },
      ],
      [],
      ASIDE_GAP,
    );
    if (t.outcome !== null) return false;
    this.task = t.id;
    return true;
  }

  /** The word said: they come along if they don't doubt the face and are still free to, and from a stranger half the time; else it was only a word, and that way has failed for now. */
  private asked(t: Task, p: Person): void {
    const h = this.h;
    const a = this.run!.action;
    const q = this.asideFor();
    if (!q || q.level !== p.level || Math.hypot(q.x - p.x, q.z - p.z) > 3 || h.ident.doubtOf(q.id, p.id, h.t) >= TEST || (a === "lure" && !this.rng.chance(COME_ALONG))) {
      if (a === "lure" && q) this.refused++;
      this.fail(a, "refused");
      return this.stop(t, "refused");
    }
    h.tasks.join(t, q);
    // Walking together: at the slower one's pace (the task puts its own back as it ends).
    p.speed = Math.min(p.speed, q.speed);
    this.note(`${a}:${q.id}`);
  }

  /** In the room, waiting for them to catch up: in and beside it, the bolt; them gone off, or never come, and that's all it was. */
  private inWith(t: Task, p: Person): void {
    const h = this.h;
    const q = h.people[this.spy.goal.target]!;
    if (!q.present || q.gone || q.down || !t.party.includes(q.id) || h.t - t.stepAt > IN_WAIT) return this.stop(t, "gone");
    if (q.level === p.level && q.room === p.room && Math.hypot(q.x - p.x, q.z - p.z) <= IN_BESIDE) h.tasks.next(t);
  }

  /** Talking behind the bolt: alone with them, the grip (kill.ts); them gone off, or the words over with no moment, and that way has failed for now. */
  private words(run: Running, t: Task, p: Person): void {
    const h = this.h;
    const spy = this.spy;
    const q = h.people[spy.goal.target]!;
    if (run.awaitFrom < 0) run.awaitFrom = h.t;
    if (!q.present || q.gone || q.down || !t.party.includes(q.id)) return this.stop(t, "gone");
    if (this.ticks % 2 === 0 && spy.covers.active("murder")) {
      const m = spy.kill.moment(p, q, { strangle: true, inject: false });
      if (m) {
        // The bolt stays drawn for the kill behind it (a task's bolts are drawn back as it ends).
        t.steps = t.steps.filter((s) => s.do !== "bolt");
        this.stop(t, "kill");
        // A pause in the talk: they stand a moment for what it says next.
        q.thinkAt = Math.max(q.thinkAt, h.t + REACH_PAUSE);
        if (!spy.kill.begin(p, q, m, "goal")) this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(INTERRUPTED[0], INTERRUPTED[1]));
        return;
      }
    }
    if (h.t - run.awaitFrom >= run.tryFor) {
      this.fail(run.action, "no-moment");
      this.stop(t, "not-yet");
    }
  }

  /**
   * An act: to its spot (or to the side of the one it robs), a wait for the moment, then the act.
   * With its tactics on: away from the party, a false alibi first; the lights out on the way in,
   * and one try at the moment while they're out; someone's bag, half the time, taken up when
   * nobody who'd know it isn't the spy's is looking, gone through somewhere quiet and put back.
   */
  private startAct(p: Person, action: PlanActionId, act: ActId, ctx: GoalContext, via: PlanActionId | null): boolean {
    const h = this.h;
    const site = this.things.site(act, p);
    if (!site) {
      // Not there to be had yet (the coat not hung, the bag not down): later.
      this.retryAt = h.t + LATER;
      return false;
    }
    const tactics = this.spy.tactics;
    const spec = this.things.spec(act);
    const secs = this.secsFor(act);
    const person = act === "pocket" || act === "brush";
    // The lights: only in a room of the act's own, with them on.
    const sw = via === "commotion" && !person ? tactics.switchFor(site.spot.room) : null;
    if (via === "commotion" && !sw) {
      this.fail("commotion", "no-switch");
      return false;
    }
    const dinner = this.up && h.programme[this.spy.phase]?.id === "dinner";
    // An alibi already away covers this step too; one made for a step that never got going is dropped.
    tactics.cancel();
    const wrap = !sw && (spec.mode === "alone" || act === "coat") ? tactics.wrap(p, site.spot, dinner) : null;
    const carry = act === "bag" ? tactics.carryTo(site.spot) : null;
    const steps: Step[] = [...(wrap?.before ?? [])];
    if (sw) steps.push({ do: "goto", to: sw, label: "to:switch" }, { do: "wait", s: 0, pose: "stand", label: "switch" });
    if (person) steps.push({ do: "shadow", who: site.owner, gap: BRUSH_GAP, label: `await:${act}` });
    else steps.push({ do: "goto", to: site.spot, label: `to:${act}` }, ...(wrap?.at ?? []), { do: "wait", s: 99999, pose: "look", label: `await:${act}` });
    if (carry) steps.push({ do: "wait", s: TAKE_SECS, pose: "serve", label: "carry" }, { do: "goto", to: carry, label: "to:carry" }, { do: "wait", s: 99999, pose: "look", label: `await:${act}` });
    steps.push({ do: "wait", s: secs, pose: spec.pose, label: `risky:${act}` });
    if (carry) steps.push({ do: "goto", to: site.spot, label: "to:put-back" }, { do: "wait", s: 0, pose: "serve", label: "put-back" });
    const door = act === "lock" ? (this.things.lockedDoor(ctx.room, p)?.id ?? -1) : -1;
    this.run = {
      action,
      act,
      site,
      room: act === "lock" ? ctx.room : site.spot.room,
      // Taking the bag up first is quick; the act's own length once it's somewhere quiet.
      secs: carry ? TAKE_SECS : secs,
      awaitFrom: -1,
      riskyAt: -1,
      tryFor: sw ? DARK_TRY : this.rng.range(TRY[0], TRY[1]),
      near: null,
      door,
      end: null,
      via,
      carry: carry ? { to: carry, picked: false } : null,
    };
    return this.launch(p, action, wrap?.cover ?? (act === "palm" ? "art" : "wander"), steps);
  }

  /** Taken up from its chair: in its hands to somewhere quiet, where the act waits for its moment again (gone meanwhile: the moment's gone). */
  private carried(run: Running, t: Task, p: Person): void {
    const c = run.carry;
    const site = run.site;
    if (!c || !site || !this.spy.tactics.take(p, site.obj, site.spot)) return this.stop(t, "moved");
    c.picked = true;
    const room = c.to.room;
    run.site = { spot: c.to, at: { level: c.to.level, x: c.to.x, z: c.to.z, y: room >= 0 ? this.h.bp.rooms[room]!.floorY : p.y, room }, owner: site.owner, obj: site.obj };
    run.room = room;
    run.secs = this.secsFor(run.act!);
    run.awaitFrom = -1;
    run.near = null;
  }

  /** The bag's owner, if there's someone to spill a drink on: here, and clean. */
  private spillable(): Person | null {
    const q = this.h.people[this.spy.goal.target];
    return q?.present && !q.gone && !q.stain ? q : null;
  }

  /** A glass with something in it in their hand. */
  private full(x: Person): boolean {
    const items = this.h.world.items;
    return x.item >= 0 && items.kindOf(x.item) === "glass" && items.fill[x.item]! > 0.2;
  }

  /** Its drink down the bag's owner (other people's things): they go and change, their bag left on a chair more often than not. Nothing to spill, a glass of red from the nearest bar first. */
  private startSpill(p: Person): boolean {
    const h = this.h;
    const q = this.spillable();
    if (!q) {
      this.retryAt = h.t + LATER;
      return false;
    }
    const steps: Step[] = [];
    if (!this.full(p) && !this.full(q)) {
      let bar: Spot | null = null;
      let bd = Infinity;
      for (const b of h.places.bars) {
        const d = Math.hypot(b.x - p.x, b.z - p.z) + 15 * Math.abs(b.level - p.level);
        if (d < bd) {
          bd = d;
          bar = b;
        }
      }
      if (!bar) {
        this.fail("spill", "no-drink");
        return false;
      }
      steps.push({ do: "goto", to: bar, label: "to:bar" }, { do: "wait", s: this.rng.range(6, 12), pose: "stand", label: "red" });
    }
    this.run = this.walk("spill", q.room);
    steps.push({ do: "meet", who: q.id, label: "to:spill" }, { do: "wait", s: 0, pose: "stand", label: "spill" });
    return this.launch(p, "spill", "drink", steps);
  }

  /** At their side: the drink goes down them, or there's nothing to spill after all. Either way not again for a while: the planner would only spill once more. */
  private spilled(t: Task, p: Person): void {
    const q = this.h.people[this.spy.goal.target]!;
    if (!this.spy.tactics.spill(p, q)) {
      this.fail("spill", "no-drink");
      return this.stop(t, "no-drink");
    }
    this.blocked.set("spill", this.h.t + BLOCK_FOR);
  }

  /**
   * Between steps of a kill's plan, an eye on the target: seen setting off somewhere quiet (the
   * bathroom, the terrace, a wander off) while the spy is only chatting or having a drink, it
   * drops what it's doing and follows.
   */
  private watchTarget(): void {
    const h = this.h;
    const spy = this.spy;
    const p = spy.record;
    if (spy.goal.kind !== "kill" || !p.present || p.gone || !this.free() || this.things.firstOn(p) || this.seated(p)) return;
    const a = p.action;
    if (a && !LOOSE.has(a.id)) return;
    const q = h.people[spy.goal.target];
    if (!q?.present || q.gone || !OFF_ALONE.has(q.action?.id ?? "mingle")) return;
    if (h.memory.lastT[p.id * h.people.length + q.id]! < h.t - 10) return;
    const steps = this.make(p);
    const head = steps ? steps.steps[this.lead(steps.steps)] : undefined;
    if (head === "follow" || (head && ALONE_WAY.has(head))) this.startTrail(p, head === "follow" ? "wait-alone" : head);
  }

  /**
   * Its time back at the party over (between tries, after a failure, lying low): whatever it is
   * idly doing gives way to the plan's next step, when one can start, rather than a quarter of an
   * hour on a sofa first.
   */
  private resume(): void {
    const h = this.h;
    const p = this.spy.record;
    const from = Math.max(this.retryAt, this.spy.answers.lowUntil, FIRST_STEP);
    if (h.t < from || h.t - from > RESUME || !p.present || p.gone) return;
    const a = p.action;
    if (!a || !LOOSE.has(a.id) || p.id !== this.spy.id || !this.ready(p)) return;
    h.end(p, false);
    p.thinkAt = h.t;
  }

  /** Following the target a step behind until a moment comes (kill.ts takes it); `action` is the wait it counts against. */
  private startTrail(p: Person, action: PlanActionId): boolean {
    const h = this.h;
    const q = h.people[this.spy.goal.target];
    if (!q?.present || q.gone || q.down) return false;
    this.run = {
      action,
      act: null,
      site: null,
      room: -1,
      secs: 0,
      awaitFrom: h.t,
      riskyAt: -1,
      tryFor: this.rng.range(TRAIL_TRY[0], TRAIL_TRY[1]),
      near: null,
      door: -1,
      end: null,
      via: null,
      carry: null,
    };
    return this.launch(p, "follow", "wander", [{ do: "shadow", who: q.id, gap: this.spy.habits.trailGap(TRAIL_GAP), label: "trail" }]);
  }

  /** Looking for the one whose bag it wants: where it last saw them, else a party room it hasn't just looked round. */
  private startFind(p: Person): boolean {
    const h = this.h;
    const n = h.people.length;
    const last = h.memory.lastRoom[p.id * n + this.spy.goal.target]!;
    const fresh = (r: number) => (this.searched.get(r) ?? -1e9) < h.t - SEARCHED;
    const rooms = h.places.partyRooms.filter((r) => fresh(r.index));
    const pool = rooms.length ? rooms : h.places.partyRooms;
    const room = last >= 0 && fresh(last) ? last : pool.length ? this.rng.pick(pool).index : -1;
    const s = room >= 0 ? h.cells.random(room, this.rng, 0.8) : null;
    if (!s) {
      this.retryAt = h.t + LATER;
      return false;
    }
    this.run = this.walk("find-bag", room);
    return this.launch(p, "find-bag", "wander", [
      { do: "goto", to: s, label: "to:find" },
      { do: "wait", s: 4, pose: "look", label: "look-for" },
    ]);
  }

  /** Waiting for a bag's owner to put it down: about the room they're in, an eye on them; half an hour of it in all and that way is given up. */
  private startWatch(p: Person): boolean {
    const h = this.h;
    if (this.freeSince < 0) this.freeSince = h.t;
    else if (h.t - this.freeSince >= FREE_MAX) {
      this.freeSince = -1;
      this.fail("wait-owner", "kept");
      return false;
    }
    const room = h.memory.lastRoom[p.id * h.people.length + this.spy.goal.target]!;
    const s = room !== -1 ? h.cells.random(room, this.rng, 0.8) : null;
    if (!s) {
      this.retryAt = h.t + LATER;
      return false;
    }
    this.run = { ...this.walk("wait-owner", room), tryFor: this.rng.range(WATCH[0], WATCH[1]) };
    return this.launch(p, "wait-owner", "mingle", [
      { do: "goto", to: s, label: "to:watch" },
      { do: "wait", s: 99999, pose: "stand", label: "watch-bag" },
    ]);
  }

  /** Learning the way to the goal's room: a look in, or at its door when it is locked; touring alone, a walk through rooms it doesn't know on the way (`before`). */
  private startLearn(p: Person, action: PlanActionId, ctx: GoalContext, before: Step[] = []): boolean {
    const h = this.h;
    const room = ctx.room;
    if (room < 0) return false;
    const door = this.things.lockedDoor(room, p);
    const s = door ? h.tasks.outside(door, room) : h.cells.random(room, this.rng, 0.8);
    if (!s) {
      this.fail(action, "no-way");
      return false;
    }
    this.run = this.walk(action, room);
    return this.launch(p, action, "wander", [...before, { do: "goto", to: s, label: "to:learn" }, { do: "wait", s: this.rng.range(3, 6), pose: "look", label: "learn" }]);
  }

  /** What it took, into its own coat in the cloakroom: nothing anyone would look at twice. */
  private startStash(p: Person): boolean {
    const h = this.h;
    const items = h.world.items;
    const c = p.coat;
    if (c < 0 || items.stateOf(c) !== "hung") {
      this.retryAt = h.t + LATER;
      return false;
    }
    const w = h.pf.snap(items.level[c]!, items.x[c]!, items.z[c]!, 1);
    const room = w ? h.pf.roomAt(w.level, w.x, w.z) : -1;
    if (!w || room === -1) {
      this.fail("stash", "no-way");
      return false;
    }
    const to = { level: w.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, items.x[c]!, items.z[c]!), room };
    this.run = this.walk("stash", room);
    return this.launch(p, "stash", "wander", [
      { do: "goto", to, label: "to:stash" },
      { do: "wait", s: this.rng.range(STASH[0], STASH[1]), pose: "serve", label: "stash" },
    ]);
  }

  private walk(action: PlanActionId, room: number): Running {
    return { action, act: null, site: null, room, secs: 0, awaitFrom: -1, riskyAt: -1, tryFor: 0, near: null, door: -1, end: null, via: null, carry: null };
  }

  /** The task for a step. False when it couldn't even set off (finished() has counted it). */
  private launch(p: Person, what: string, cover: string, steps: Step[]): boolean {
    this.stats.started++;
    const t = this.h.tasks.spy(p, what, cover, steps);
    if (t.outcome !== null) return false;
    this.task = t.id;
    return true;
  }

  /** How long an act takes: anywhere in the plan's range, its knack moving it toward the quick end. */
  private secsFor(act: ActId): number {
    const spec = this.things.spec(act);
    const [lo, hi] = spec.secs;
    if (hi <= lo) return lo;
    const k = spec.knack ? this.spy.knack[spec.knack] : 0;
    return lo + (hi - lo) * this.rng.next() * (1 - 0.6 * k);
  }

  // ----------------------------------------------------------------- the moment

  /** Waiting at the spot (or at the target's side) for the moment, a minute or two at a time. */
  private await(run: Running, t: Task, p: Person): void {
    const h = this.h;
    if (run.awaitFrom < 0) run.awaitFrom = h.t;
    const site = this.still(run);
    if (!site) return this.stop(t, "moved");
    let close = true;
    if (run.act === "pocket" || run.act === "brush") {
      const q = h.people[site.owner]!;
      close = q.level === p.level && q.room === p.room && Math.hypot(q.x - p.x, q.z - p.z) <= REACH;
    }
    if (close && this.ticks % 2 === 0 && this.moment(run, site, p)) return this.goRisky(run, t, p);
    if (h.t - run.awaitFrom >= run.tryFor) {
      // The lights out and still no moment: that was the try.
      if (run.via === "commotion") this.fail("commotion", "no-moment");
      else this.waitedFor(run.action, h.t - run.awaitFrom, run.via);
      this.stop(t, "not-yet");
    }
  }

  /** The act's site as it is now, or null when the moment has gone: the bag picked up, the statuette moved, the door already open. */
  private still(run: Running): ActSite | null {
    const h = this.h;
    const items = h.world.items;
    const site = run.site!;
    switch (run.act) {
      case "bag":
        if (run.carry?.picked) return items.holder[site.obj] === this.spy.id ? site : null;
        return items.stateOf(site.obj) === "down" && items.holder[site.obj] === -1 ? site : null;
      case "coat":
        return items.stateOf(site.obj) === "hung" ? site : null;
      case "palm":
        return items.holder[site.obj] === -1 && items.stateOf(site.obj) === "shelved" ? site : null;
      case "papers":
        return this.things.safeOpen ? site : null;
      case "lock":
        return run.door >= 0 && h.world.doors[run.door]!.locked ? site : null;
      case "pocket":
      case "brush": {
        const q = h.people[site.owner]!;
        return q.present && !q.gone ? site : null;
      }
      default:
        return site;
    }
  }

  /** Whether the moment has come: nobody who counts can see the spot now or before it is done. A pocket also waits for its owner to dance or raise a glass. */
  private moment(run: Running, site: ActSite, p: Person): boolean {
    const h = this.h;
    const act = run.act!;
    const mode = this.things.spec(act).mode;
    if (!mode) return true;
    if (act === "pocket" && !held(h, h.people[site.owner]!)) return false;
    const at = act === "pocket" ? spotOf(p) : site.at;
    if (!run.near || act === "pocket") run.near = nearRooms(h, at);
    this.check = check(h, { mode, at, secs: run.secs, self: p, who: this.whoCounts(act, site), owner: this.ownerOf(act, site), within: this.things.spec(act).within }, run.near);
    return this.check.ok;
  }

  /** For someone's bag or coat, only those who would know it isn't the spy's; for the rest, everyone. */
  private whoCounts(act: ActId, site: ActSite): ((q: Person) => boolean) | null {
    return (act === "bag" || act === "coat") && site.owner >= 0 ? this.things.knowsWhose(site.owner) : null;
  }

  /** Whose bag or coat it goes through, who watches it whatever else holds them (-1 none). */
  private ownerOf(act: ActId, site: ActSite): number {
    return act === "bag" || act === "coat" ? site.owner : -1;
  }

  /** The moment has come: the act starts, showing from this step on. */
  private goRisky(run: Running, t: Task, p: Person): void {
    const h = this.h;
    const spy = this.spy;
    const act = run.act!;
    const spec = this.things.spec(act);
    const site = run.site!;
    h.tasks.next(t);
    if (t.outcome !== null || t.steps[t.i]?.label !== `risky:${act}`) return;
    run.riskyAt = h.t;
    // Facing the work: the door, the safe, the bag, the one whose pocket or jacket it is.
    const q = act === "pocket" || act === "brush" ? h.people[site.owner]! : null;
    p.yaw = q ? yawTo(p.x, p.z, q.x, q.z) : site.spot.yaw;
    if (spec.verb) {
      const obj = VERBS[spec.verb].thing ? site.obj : act === "pocket" ? site.owner : -1;
      h.notable(p, spec.verb, obj, run.secs, run.room >= 0 ? run.room : p.room);
    }
    if (spec.tell) spy.measure.tell(spec.tell, h.t, h.t + run.secs, p.room, h.visibility(p), act === "bag" || act === "coat" ? site.owner : -1);
    // A faint rattle as the pick goes in.
    if (act === "lock" && run.door >= 0) {
      const d = h.world.doors[run.door]!;
      h.sound("rattle", { level: d.level, x: d.x, z: d.z, room: p.room }, p.id, d.id);
    }
    doorsNow(h, this.shut);
    spy.tried();
    this.note(`risky:${act}`);
  }

  /** While it acts, by its own senses: anyone it notices makes it break off; someone it robs moving off ends the act. */
  private watch(run: Running, t: Task, p: Person): void {
    const h = this.h;
    const act = run.act!;
    const site = run.site!;
    if (act === "pocket" || act === "brush") {
      const q = h.people[site.owner]!;
      if (!q.present || q.gone || q.level !== p.level || Math.hypot(q.x - p.x, q.z - p.z) > REACH + 0.5) return this.stop(t, "moved");
    }
    const mode = this.things.spec(act).mode;
    if (!mode) return;
    const at = act === "pocket" ? spotOf(p) : site.at;
    const by = noticed(h, { mode, at, secs: run.secs, self: p, who: this.whoCounts(act, site), owner: this.ownerOf(act, site), within: this.things.spec(act).within }, this.shut);
    doorsNow(h, this.shut);
    if (by >= 0) this.breakOff(run, t, p, by);
  }

  /** Someone came: it stands, clears what it showed (a moment later: it was seen at it meanwhile), looks at something else, and tries again later. */
  private breakOff(run: Running, t: Task, p: Person, by: number): void {
    const h = this.h;
    this.clear(run, CAUGHT);
    this.stats.broken++;
    h.log("spy", [p.id, by], p.room, `broke:${run.act}`);
    const n = (this.breaks.get(run.action) ?? 0) + 1;
    if (n >= BREAKS) {
      this.breaks.delete(run.action);
      this.fail(run.via ?? run.action, "seen");
    } else {
      this.breaks.set(run.action, n);
      this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(AFTER_BREAK[0], AFTER_BREAK[1]));
    }
    run.end = "broken";
    h.tasks.finish(t, "broken");
    // Startles on: a jerk and a step back, then the nearest painting or bookshelf (habits.ts).
    const habits = this.spy.habits;
    const art = habits.startle(p, h.people[by]!) ? habits.sight(p) : null;
    const look: Step = { do: "wait", s: this.rng.range(COVER_LOOK[0], COVER_LOOK[1]), pose: "look", label: "cover" };
    const steps: Step[] = art ? [{ do: "goto", to: art, label: "to-art" }, look] : [look];
    // Someone's bag in its hands: back where it lay once it has looked.
    const c = this.spy.tactics.carry;
    if (c) steps.push({ do: "goto", to: c.spot, label: "to:put-back" }, { do: "wait", s: 0, pose: "serve", label: "put-back" });
    this.launch(p, "cover", "art", steps);
  }

  /** An eye on the bag's owner: the bag set down, as far as it can tell, ends the wait so it can plan the act; a few minutes of nothing and it goes back to the party. */
  private watchBag(run: Running, t: Task, p: Person): void {
    const h = this.h;
    if (run.awaitFrom < 0) run.awaitFrom = h.t;
    if (this.ticks % 2 === 0 && this.things.facts(p, this.things.context(p)) & F.free) return this.stop(t, "done");
    if (h.t - run.awaitFrom >= run.tryFor) {
      this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(BETWEEN[0], BETWEEN[1]));
      this.stop(t, "not-yet");
    }
  }

  /** A step behind the target: the moment for either way of killing them, with murder on, is the kill runner's to take (kill.ts). */
  private trail(run: Running, t: Task, p: Person): void {
    const h = this.h;
    const spy = this.spy;
    const q = h.people[spy.goal.target]!;
    if (!q.present || q.gone || q.down) return this.stop(t, "gone");
    if (this.ticks % 2 === 0 && spy.covers.active("murder")) {
      const m = spy.kill.moment(p, q, { strangle: true, inject: true });
      if (m) {
        this.stop(t, "kill");
        if (!spy.kill.begin(p, q, m, "goal")) this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(INTERRUPTED[0], INTERRUPTED[1]));
        return;
      }
    }
    if (h.t - run.awaitFrom >= run.tryFor) {
      this.waitedFor(run.action, h.t - run.awaitFrom);
      this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(TRAIL_BETWEEN[0], TRAIL_BETWEEN[1]));
      this.stop(t, "not-yet");
    }
  }

  // ---------------------------------------------------------------- outcomes

  /** What an act leaves behind. */
  private effect(run: Running, p: Person): void {
    const h = this.h;
    const things = this.things;
    const items = h.world.items;
    const take = (i: number) => {
      if (i < 0) return;
      items.holder[i] = p.id;
      items.inside[i] = -1;
      items.set(i, "carried", h.t);
      items.place(i, p);
    };
    switch (run.act) {
      case "lock":
        if (run.door >= 0) h.world.setLocked(h.world.doors[run.door]!, false, p.id);
        break;
      case "safe":
        things.safeOpen = true;
        break;
      case "papers":
        take(things.papers);
        things.safeOpen = false;
        break;
      case "bag":
        take(things.papers);
        break;
      case "coat":
      case "pocket":
        take(things.phone);
        break;
      case "palm":
        take(things.statuette);
        break;
      case "plant": {
        const pr = things.bug?.prop;
        if (pr) things.device = items.add("device", "down", -1, -1, { level: pr.level, x: pr.x, z: pr.z, room: things.bug!.room }, h.t);
        break;
      }
      case "brush":
        things.device = items.add("device", "worn", h.host.id, h.host.id, h.host, h.t);
        break;
      case "ledger":
        things.copiedAt = h.t;
        break;
    }
    // Somewhere to come back to (habits.ts): the door it picked, where it worked; not someone's pocket.
    if (run.site && run.act !== "pocket" && run.act !== "brush") this.spy.habits.did(run.site.spot);
    this.note(`did:${run.act}`);
  }

  /** Into its own coat: no longer on it, and nobody who saw it at the cloakroom saw anything. */
  private stashIn(p: Person): void {
    const items = this.h.world.items;
    const thing = this.things.thing(p);
    const c = p.coat;
    if (thing < 0 || c < 0 || items.holder[thing] !== p.id) return;
    items.holder[thing] = -1;
    items.inside[thing] = c;
    items.set(thing, "hung", this.h.t);
    items.place(thing, { level: items.level[c]!, x: items.x[c]!, z: items.z[c]!, room: items.room[c]! });
    this.spy.habits.did({ level: p.level, x: p.x, z: p.z, yaw: p.yaw, room: p.room });
    this.note("stashed");
  }

  /** A step done: the goal reached, unless it is a kill's (the kill runner says when it is done). */
  private checkGoal(): void {
    const spy = this.spy;
    if (spy.goal.kind === "kill" || spy.goal.doneAt !== null) return;
    const p = spy.record;
    const ctx = this.things.context(p);
    this.facts = this.things.facts(p, ctx);
    if ((this.facts & ctx.goal) === ctx.goal) spy.goalDone();
  }

  /** The runner ends a task itself: why, and nothing more showing. */
  private stop(t: Task, why: string): void {
    const run = this.run;
    if (run) {
      this.clear(run);
      run.end = why;
    }
    this.h.tasks.finish(t, why);
  }

  /** An act ended before its time: its notable and its tell stop showing, `linger` in-game s from now. */
  private clear(run: Running, linger = 0): void {
    if (run.riskyAt < 0 || !run.act) return;
    const p = this.spy.record;
    const spec = this.things.spec(run.act);
    const until = this.h.t + linger;
    if (spec.verb && p.notable === spec.verb) {
      if (linger > 0) p.notableUntil = Math.min(p.notableUntil, until);
      else {
        p.notable = null;
        p.notableUntil = this.h.t;
      }
    }
    if (spec.tell) this.spy.measure.end(spec.tell, until);
  }

  /** A try's wait, added to the step's: ten minutes in all is a failure (of the move that was to bring the moment, when there was one), else back to the party for a while. */
  private waitedFor(action: PlanActionId, secs: number, via: PlanActionId | null = null): void {
    const h = this.h;
    this.stats.tries++;
    const w = (this.waited.get(action) ?? 0) + secs;
    if (w >= WAIT_MAX) {
      this.waited.delete(action);
      this.fail(via ?? action, "no-moment");
    } else {
      this.waited.set(action, w);
      this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(BETWEEN[0], BETWEEN[1]));
    }
  }

  /** A failure the planner remembers: four times the cost for 15 minutes, and a while at the party first. */
  private fail(action: PlanActionId, why: string): void {
    const h = this.h;
    this.blocked.set(action, h.t + BLOCK_FOR);
    this.stats.failed++;
    this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(AFTER_FAIL[0], AFTER_FAIL[1]));
    this.record(action, `failed:${why}`);
    this.note(`fail:${action}:${why}`);
  }

  private record(what: PlanActionId, how: string): void {
    this.history.push({ t: this.h.t, what, how });
    if (this.history.length > 60) this.history.shift();
  }

  private note(s: string): void {
    const p = this.spy.record;
    this.h.log("spy", [p.id], p.room, s);
  }
}
