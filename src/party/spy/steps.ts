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
 * While it acts it knows only its own senses: whoever it notices makes it break off, clear its
 * notable and look at something else, and it tries again a few minutes later. Someone who comes in
 * silently behind it sees the act, which is how a guest sees a hard tell.
 *
 * Pacing: nothing before 19:20, while the host still watches the door; nothing new at dinner (it
 * sits through it; PR 4's alibis get it up); nothing while it lies low; a kill's theft first
 * dropped at 21:00; and whatever it waits for given up at the farewell's first goodbye. Until PR 5
 * a kill's plan ends at the target alone: the spy notes it and goes back to the party.
 */
import type { Rng } from "../../mansion/core/rng";
import { VERBS, type Verb } from "../memory";
import { yawTo, type RoomCells } from "../places";
import type { SoundKind } from "../senses";
import type { Step, Task } from "../tasks";
import type { PartyEvent, Person } from "../types";
import { ACT_OF, ACTS, type ActId, type ActSite, type GoalContext, type GoalHost, type GoalThings } from "./goals";
import type { Spy } from "./index";
import { BLOCK_FOR, F, plan, type PlanActionId } from "./planner";
import { check, doorsNow, held, nearRooms, noticed, type PrivacyHost, type PrivacyResult, type Spot3 } from "./privacy";

/** What running the plan needs from the party, besides the goal's and the privacy check's. */
export interface StepsHost extends GoalHost, PrivacyHost {
  readonly cells: RoomCells;
  /** When the farewell's first goodbye was said (-1 not yet). */
  readonly byeAt: number;
  notable(p: Person, verb: Verb, obj: number, secs: number, room?: number): void;
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
/** Following the target: one try, and the wait before the next. */
const TRAIL_TRY: readonly [number, number] = [180, 360];
const TRAIL_BETWEEN: readonly [number, number] = [300, 600];
/** How far behind it follows, and how close it comes for a pocket or the host's jacket (m). */
const TRAIL_GAP = 4;
const BRUSH_GAP = 0.9;
/** Close enough for a hand to reach (m). */
const REACH = 1.5;
/** Close to the target while following: the same room, within this (m), as goals.ts has it. */
const CLOSE = 6;
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
/** How long a kill would take, for the alone check while following (PR 5 sets the methods' own). */
const ALONE_SECS = 60;
/** Interrupted from outside (a spill, a word): back to it in a minute or two. */
const INTERRUPTED: readonly [number, number] = [60, 120];
/** What it drops to follow the target, and where the target going suggests a moment alone. */
const LOOSE: ReadonlySet<string> = new Set(["mingle", "drink", "art", "wander", "sit", "snack", "use", "terrace"]);
const OFF_ALONE: ReadonlySet<string> = new Set(["toilet", "terrace", "wander"]);
/** At dinner it gets up for a step only between these shares of the dinner: once everyone is seated, before the dessert. */
const UP: readonly [number, number] = [0.15, 0.8];
/** The plan's moves that fold into the step they lead to. */
const FOLD: ReadonlySet<PlanActionId> = new Set(["go", "look-away", "follow"]);

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
}

/** One line of the plan's history, for the lab's card. */
export interface PlanRecord {
  t: number;
  what: PlanActionId;
  how: string;
}

const spotOf = (p: Person): Spot3 => ({ level: p.level, x: p.x, z: p.z, y: p.y, room: p.room });

export class Plans {
  /** The plan as last made and the facts it was made from, and the last privacy check, for the lab. */
  steps: PlanActionId[] = [];
  facts = 0;
  check: PrivacyResult | null = null;
  readonly history: PlanRecord[] = [];
  /** Actions that failed, and until when they cost the planner four times as much. */
  readonly blocked = new Map<PlanActionId, number>();
  /** A kill's plan reached the target alone (PR 5 kills): it is over for tonight. */
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
    if (!act || ACTS[act].mode !== "alone") return false;
    this.upAt = ph.start;
    this.up = true;
    this.note("up-from-dinner");
    return true;
  }

  /** Nothing in the way of a step starting: not parked, not done, not given up, not between tries, not lying low. */
  private free(): boolean {
    const h = this.h;
    const spy = this.spy;
    if (this.parked || spy.goal.doneAt !== null || h.byeAt >= 0 || this.task >= 0) return false;
    return h.t >= FIRST_STEP && h.t >= this.retryAt && h.t >= spy.answers.lowUntil;
  }

  private plan(p: Person): boolean {
    const h = this.h;
    const spy = this.spy;
    const g = spy.goal;
    if (!this.free()) return false;
    if (h.programme[spy.phase]?.id === "dinner" && !this.up) return false;
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

  /** The cheapest plan from what is true now, or null when there is none (or nothing left to do). */
  private make(p: Person, ctx = this.things.context(p)): { steps: PlanActionId[] } | null {
    const facts = this.things.facts(p, ctx);
    const pl = plan({ start: facts, goal: ctx.goal, use: ctx.use, needs: ctx.needs, blocked: this.blocked, t: this.h.t });
    return pl?.steps.length ? pl : null;
  }

  /** Where the plan's first real step is: the moves that lead to an act fold into it. */
  private lead(steps: readonly PlanActionId[]): number {
    let k = 0;
    while (k < steps.length - 1 && FOLD.has(steps[k]!)) k++;
    return k;
  }

  /** Once a step, after everyone has moved and before anyone looks: the wait for the moment, the act's own watch, the trail; between steps, an eye on a target. */
  step(): void {
    const h = this.h;
    this.ticks++;
    const run = this.run;
    const t = this.task >= 0 ? h.tasks.get(this.task) : undefined;
    if (!run || !t) {
      if (this.task < 0 && this.ticks % 4 === 0) this.watchTarget();
      return;
    }
    const p = this.spy.record;
    const st = t.steps[t.i];
    if (!st) return;
    const waiting = st.label.startsWith("await:") || st.label === "trail" || st.label === "watch-bag";
    // The farewell's first goodbye: whatever it still waits for is given up (an act under way it finishes).
    if (h.byeAt >= 0 && waiting) return this.stop(t, "given-up");
    if (st.label.startsWith("await:")) this.await(run, t, p);
    else if (st.label.startsWith("risky:")) this.watch(run, t, p);
    else if (st.label === "trail") this.trail(run, t, p);
    else if (st.label === "watch-bag") this.watchBag(run, t, p);
  }

  /** A step of one of its tasks finished: what the act leaves behind. */
  stepDone(t: Task, st: Step): void {
    const run = this.run;
    if (t.owner !== this.spy.id || !run) return;
    const p = this.spy.record;
    if (st.label.startsWith("risky:")) this.effect(run, p);
    else if (st.label === "stash") this.stashIn(p);
    else if (st.label === "learn" && run.room >= 0) this.h.memory.startKnowing(p.id, run.room, 0.8, 2);
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

  /** Its line in the spy's digest: steps started, done, broken off and failed, and whether a kill's plan reached its end. */
  digest(): string {
    const s = this.stats;
    return `${s.started},${s.done},${s.broken},${s.failed},${this.parked ? 1 : 0}`;
  }

  // ------------------------------------------------------------------ starting

  /** The plan's next step that does something: the moves that lead to an act fold into it. */
  private next(p: Person, steps: readonly PlanActionId[], ctx: GoalContext): boolean {
    const a = steps[this.lead(steps)]!;
    if (a !== "wait-owner") this.freeSince = -1;
    const act = ACT_OF[a];
    if (act) return this.startAct(p, a, act, ctx);
    switch (a) {
      case "follow":
      case "wait-alone":
        // Only after them when they're off somewhere quiet; meanwhile it keeps an eye on them (watchTarget()).
        return OFF_ALONE.has(this.h.people[this.spy.goal.target]?.action?.id ?? "mingle") && this.startTrail(p);
      case "find-bag":
        return this.startFind(p);
      case "wait-owner":
        return this.startWatch(p);
      case "learn":
      case "tour-alone":
      case "go":
        return this.startLearn(p, a, ctx);
      case "stash":
        return this.startStash(p);
      default:
        // The tactics' own steps (a spill, the lights, a tour slipped into, the host's place) wait for their pull requests.
        this.retryAt = this.h.t + LATER;
        return false;
    }
  }

  /** An act: to its spot (or to the side of the one it robs), a wait for the moment, then the act. */
  private startAct(p: Person, action: PlanActionId, act: ActId, ctx: GoalContext): boolean {
    const h = this.h;
    const site = this.things.site(act, p);
    if (!site) {
      // Not there to be had yet (the coat not hung, the bag not down): later.
      this.retryAt = h.t + LATER;
      return false;
    }
    const spec = ACTS[act];
    const secs = this.secsFor(act);
    const person = act === "pocket" || act === "brush";
    const steps: Step[] = person
      ? [{ do: "shadow", who: site.owner, gap: BRUSH_GAP, label: `await:${act}` }]
      : [
          { do: "goto", to: site.spot, label: `to:${act}` },
          { do: "wait", s: 99999, pose: "look", label: `await:${act}` },
        ];
    steps.push({ do: "wait", s: secs, pose: spec.pose, label: `risky:${act}` });
    const door = act === "lock" ? (this.things.lockedDoor(ctx.room, p)?.id ?? -1) : -1;
    this.run = { action, act, site, room: act === "lock" ? ctx.room : site.spot.room, secs, awaitFrom: -1, riskyAt: -1, tryFor: this.rng.range(TRY[0], TRY[1]), near: null, door, end: null };
    return this.launch(p, action, act === "palm" ? "art" : "wander", steps);
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
    if (spy.goal.kind !== "kill" || !p.present || p.gone || !this.free() || this.things.firstOn(p)) return;
    if (h.programme[spy.phase]?.id === "dinner" && !this.up) return;
    const a = p.action;
    if (a && !LOOSE.has(a.id)) return;
    const q = h.people[spy.goal.target];
    if (!q?.present || q.gone || !OFF_ALONE.has(q.action?.id ?? "mingle")) return;
    if (h.memory.lastT[p.id * h.people.length + q.id]! < h.t - 10) return;
    const steps = this.make(p);
    const head = steps ? steps.steps[this.lead(steps.steps)] : undefined;
    if (head === "wait-alone" || head === "follow") this.startTrail(p);
  }

  /** Following the target until they're alone somewhere (PR 5 kills them there). */
  private startTrail(p: Person): boolean {
    const h = this.h;
    const q = h.people[this.spy.goal.target];
    if (!q?.present || q.gone) return false;
    this.run = { action: "wait-alone", act: null, site: null, room: -1, secs: ALONE_SECS, awaitFrom: h.t, riskyAt: -1, tryFor: this.rng.range(TRAIL_TRY[0], TRAIL_TRY[1]), near: null, door: -1, end: null };
    return this.launch(p, "follow", "wander", [{ do: "shadow", who: q.id, gap: TRAIL_GAP, label: "trail" }]);
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

  /** Learning the way to the goal's room: a look in, or at its door when it is locked. */
  private startLearn(p: Person, action: PlanActionId, ctx: GoalContext): boolean {
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
    return this.launch(p, action, "wander", [
      { do: "goto", to: s, label: "to:learn" },
      { do: "wait", s: this.rng.range(3, 6), pose: "look", label: "learn" },
    ]);
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
    return { action, act: null, site: null, room, secs: 0, awaitFrom: -1, riskyAt: -1, tryFor: 0, near: null, door: -1, end: null };
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
    const spec = ACTS[act];
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
      this.waitedFor(run.action, h.t - run.awaitFrom);
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
    const mode = ACTS[act].mode;
    if (!mode) return true;
    if (act === "pocket" && !held(h, h.people[site.owner]!)) return false;
    const at = act === "pocket" ? spotOf(p) : site.at;
    if (!run.near || act === "pocket") run.near = nearRooms(h, at);
    this.check = check(h, { mode, at, secs: run.secs, self: p, who: this.whoCounts(act, site), owner: this.ownerOf(act, site), within: ACTS[act].within }, run.near);
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
    const spec = ACTS[act];
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
    const mode = ACTS[act].mode;
    if (!mode) return;
    const at = act === "pocket" ? spotOf(p) : site.at;
    const by = noticed(h, { mode, at, secs: run.secs, self: p, who: this.whoCounts(act, site), owner: this.ownerOf(act, site), within: ACTS[act].within }, this.shut);
    doorsNow(h, this.shut);
    if (by >= 0) this.breakOff(run, t, p, by);
  }

  /** Someone came: it stands, clears what it showed, looks at something else, and tries again later. */
  private breakOff(run: Running, t: Task, p: Person, by: number): void {
    const h = this.h;
    this.clear(run);
    this.stats.broken++;
    h.log("spy", [p.id, by], p.room, `broke:${run.act}`);
    const n = (this.breaks.get(run.action) ?? 0) + 1;
    if (n >= BREAKS) {
      this.breaks.delete(run.action);
      this.fail(run.action, "seen");
    } else {
      this.breaks.set(run.action, n);
      this.retryAt = Math.max(this.retryAt, h.t + this.rng.range(AFTER_BREAK[0], AFTER_BREAK[1]));
    }
    run.end = "broken";
    h.tasks.finish(t, "broken");
    this.launch(p, "cover", "art", [{ do: "wait", s: this.rng.range(COVER_LOOK[0], COVER_LOOK[1]), pose: "look", label: "cover" }]);
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

  /** A step a step behind the target: alone somewhere, nobody seeing and nobody coming, is where PR 5's kill would be. */
  private trail(run: Running, t: Task, p: Person): void {
    const h = this.h;
    const q = h.people[this.spy.goal.target]!;
    if (!q.present || q.gone) return this.stop(t, "gone");
    if (this.ticks % 2 === 0 && q.room === p.room && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) <= CLOSE) {
      this.check = check(h, { mode: "alone", at: spotOf(q), secs: ALONE_SECS, self: p, who: null, skip: q.id });
      if (this.check.ok) {
        this.parked = true;
        h.log("spy", [p.id, q.id], q.room, `alone:${q.id}`);
        return this.stop(t, "done");
      }
    }
    if (h.t - run.awaitFrom >= run.tryFor) {
      this.waitedFor("wait-alone", h.t - run.awaitFrom);
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
    this.note(`done:${run.act}`);
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
    this.note("stashed");
  }

  /** A step done: the goal reached, unless it is a kill's (PR 5 kills). */
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

  /** An act ended before its time: its notable and its tell stop showing. */
  private clear(run: Running): void {
    if (run.riskyAt < 0 || !run.act) return;
    const p = this.spy.record;
    const spec = ACTS[run.act];
    if (spec.verb && p.notable === spec.verb) {
      p.notable = null;
      p.notableUntil = this.h.t;
    }
    if (spec.tell) this.spy.measure.end(spec.tell, this.h.t);
  }

  /** A try's wait, added to the step's: ten minutes in all is a failure, else back to the party for a while. */
  private waitedFor(action: PlanActionId, secs: number): void {
    const h = this.h;
    this.stats.tries++;
    const w = (this.waited.get(action) ?? 0) + secs;
    if (w >= WAIT_MAX) {
      this.waited.delete(action);
      this.fail(action, "no-moment");
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
