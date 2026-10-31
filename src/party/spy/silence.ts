/**
 * Silencing a doubter (milestone 3 technical plan: The spy's answers). Someone it has seen for
 * itself to be sure of it (a challenge to its face, a test it had no answer to, a kill they saw
 * or came to after) can undo it, and while they are the only one it knows of, silencing them
 * might still save it: with two or more it would only be another body. So with a lone doubter it
 * holds murder on for the rest of the evening and may silence them, at most once an evening: only
 * alone with them, out of everyone's sight, and never before 19:20, through a programme beat that
 * gathers everyone on their feet, or once the farewell's first goodbye is said. Feeling watched
 * doesn't hold it back: lying low keeps its plan and its habits quiet, but the one who can undo it
 * comes first.
 *
 * Meanwhile it keeps them in view (the rooms they were last seen in score higher for it, as for
 * anyone keeping someone in view), and when it sees them set off somewhere quiet (the bathroom,
 * the terrace, a wander, a search of the house) it drops whatever it is idly doing, or a step of
 * its plan that only waits, and follows a step behind, a few minutes at a time, as it follows a
 * kill's target (steps.ts); in the bathroom, it waits for them to come out. At dinner, them
 * getting up from the table, it excuses itself a moment later, as it would for a face it means to
 * take (swap.ts). Playing a waiter, its rounds take it to the room it last saw them in, and seeing
 * them set off it breaks off its round at the end of that stop, its tray set down first, as it
 * does for its plan's steps (sim.ts waiterThink). The moment, the grip, the struggle and the
 * hiding are the kill's (kill.ts), and only strangling: a needle needs them walked off in view,
 * for a goal worth that. Dead, they are a second person missing; let go alive, they tell.
 *
 * It draws only from its own fork.
 */
import type { Rng } from "../../mansion/core/rng";
import type { Task } from "../tasks";
import type { Person } from "../types";
import type { Spy } from "./index";
import type { KillHost, KillOutcome } from "./kill";
import { AFTER_BREAK, FIRST_STEP, LOOSE, OFF_ALONE, TRAIL_BETWEEN, TRAIL_GAP, TRAIL_TRY } from "./steps";

/** Between the programme's beats, when it can be away from the room; and at dinner, them getting up from the table, it can excuse itself too. */
const FREE: ReadonlySet<string> = new Set(["arrival", "mingle", "dinner", "dancing", "games"]);
/** It saw them set off within this long (in-game s): it knows where they're going. */
const SEEN = 10;
/** Lost them, or something else took it away: a minute or two before it follows anyone again (in-game s). */
const AFTER_LOST: readonly [number, number] = [60, 120];
/** A step behind them in the bathroom, it waits for them to come out, this long at most from setting off (in-game s). */
const WAIT_OUT = 12 * 60;
/** Playing a waiter, it saw them set off this long ago at most and still breaks off its round for them, at the end of a stop (in-game s; a stop is 35 to 70 s). */
const CUE_FOR = 90;

export class Silencing {
  readonly stats = { trails: 0, moments: 0, dead: 0, survived: 0, broken: 0, lost: 0 };
  /** Past the grip once tonight (dead or let go alive): never again. */
  done = false;
  /** Whom it follows and the trail's task (-1 none), when it set off and for how long, and when it may set off again. */
  private who = -1;
  private task = -1;
  private from = 0;
  private tryFor = 0;
  private nextAt = 0;
  private ticks = 0;
  /** The one person still about it knows to be sure of it (-1 none, or more than one), looked at every few steps; and whether it has held murder on for them. */
  private lone = -1;
  private held = false;
  /** Playing a waiter: the lone doubter it saw set off somewhere quiet while on its round (-1 none), and when. */
  private cue = -1;
  private cueAt = 0;

  constructor(
    private readonly h: KillHost,
    private readonly spy: Spy,
    private readonly rng: Rng,
  ) {}

  /** Following someone sure of it. */
  get busy(): boolean {
    return this.task >= 0;
  }

  /** Whom it follows now, a step behind (-1 nobody). */
  get trailing(): number {
    return this.task >= 0 ? this.who : -1;
  }

  /** Whom it keeps in view, meaning to silence them (-1 nobody): its lone doubter, while murder is on and the evening allows. */
  get watching(): number {
    const h = this.h;
    if (this.done || this.lone < 0 || h.byeAt >= 0 || h.t < FIRST_STEP || !this.spy.covers.active("murder")) return -1;
    return this.lone;
  }

  /** Once a step, after its plan's: on a trail, the moment (the kill runner's to take) or the try's end; else, every few steps, whether its lone doubter is off somewhere quiet. */
  step(): void {
    const p = this.spy.record;
    this.ticks++;
    if (this.task >= 0) return this.trail(p);
    if (this.ticks % 4 !== 0 || this.done) return;
    this.lone = this.loneDoubter(p);
    if (this.lone < 0) return;
    if (!this.held && this.h.t >= FIRST_STEP && this.h.byeAt < 0) {
      this.held = true;
      this.spy.covers.hold("murder");
    }
    if (!this.free(p)) return;
    const q = this.h.people[this.lone]!;
    const n = this.h.people.length;
    if (!this.offAlone(q) || this.h.memory.lastT[p.id * n + q.id]! < this.h.t - SEEN) return;
    // A waiter on its rounds breaks off at the end of this stop, its tray set down first (think()); from a step of its plan that only waits, it goes at once, as anyone.
    if (p.staff && !this.spy.plans.busy) {
      this.cue = q.id;
      this.cueAt = this.h.t;
    } else this.follow(p, q);
  }

  /** Playing a waiter, whether it breaks off its round at the end of this stop: it saw its lone doubter set off somewhere quiet a moment ago, and they are off there still. */
  get breaking(): boolean {
    if (this.cue < 0 || this.cue !== this.lone || this.task >= 0 || this.h.t - this.cueAt > CUE_FOR) return false;
    return this.offAlone(this.h.people[this.cue]!);
  }

  /** Playing a waiter, between its rounds (sim.ts waiterThink): after its lone doubter, if it broke off its round for them (true: on their trail). */
  think(p: Person): boolean {
    const go = this.breaking && this.free(p);
    const j = this.cue;
    this.cue = -1;
    if (!go) return false;
    this.follow(p, this.h.people[j]!);
    return this.task >= 0;
  }

  /** Free to go after someone: murder on, no kill under way and nothing of its plan begun, between the programme's beats or at dinner; only idling or at the table, or a waiter, whose round gives way (think()). */
  private free(p: Person): boolean {
    const h = this.h;
    const spy = this.spy;
    if (h.byeAt >= 0 || h.t < FIRST_STEP || h.t < this.nextAt) return false;
    if (!spy.covers.active("murder") || spy.kill.busy || (spy.plans.busy && !spy.plans.waiting) || !FREE.has(h.programme[spy.phase]?.id ?? "")) return false;
    return p.staff || spy.plans.busy || !p.action || LOOSE.has(p.action.id) || p.action.id === "dinner";
  }

  /** The one person still about it has seen to be sure of it, or -1 when there is nobody or more than one (a kill's target is its plan's). */
  private loneDoubter(p: Person): number {
    const h = this.h;
    const spy = this.spy;
    let one = -1;
    for (const q of h.people) {
      if (q === p || !q.present || q.gone || q.down || !spy.answers.sureOfIt(q.id)) continue;
      if (one >= 0) return -1;
      one = q.id;
    }
    return spy.goal.kind === "kill" && one === spy.goal.target ? -1 : one;
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
    const t = h.tasks.spy(p, "silence", "wander", [{ do: "shadow", who: q.id, gap: this.spy.habits.trailGap(TRAIL_GAP), label: "silence:trail" }]);
    if (t.outcome !== null) {
      this.nextAt = h.t + this.rng.range(AFTER_LOST[0], AFTER_LOST[1]);
      return;
    }
    this.task = t.id;
    this.who = q.id;
    this.from = h.t;
    this.tryFor = this.rng.range(TRAIL_TRY[0], TRAIL_TRY[1]);
    this.stats.trails++;
    this.note(`silence:follow:${q.id}`);
  }

  /** A step behind: alone with them, the kill; them gone, the beat over or murder off, it lets them go; the try over (once they're out of the bathroom), back to the party a while. */
  private trail(p: Person): void {
    const h = this.h;
    const spy = this.spy;
    const t = h.tasks.get(this.task);
    if (!t) return;
    const q = h.people[this.who]!;
    if (!q.present || q.gone || q.down || h.byeAt >= 0 || !spy.covers.active("murder") || !FREE.has(h.programme[spy.phase]?.id ?? "")) {
      this.nextAt = h.t + this.rng.range(AFTER_LOST[0], AFTER_LOST[1]);
      return this.stop(t, "gone");
    }
    if (this.ticks % 2 === 0) {
      const m = spy.kill.moment(p, q, { strangle: true, inject: false });
      if (m) {
        this.stats.moments++;
        this.stop(t, "kill");
        if (!spy.kill.begin(p, q, m, "silence")) this.nextAt = h.t + this.rng.range(AFTER_LOST[0], AFTER_LOST[1]);
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

  /** One of its tasks ended: the trail's, however it went. */
  finished(t: Task): void {
    if (t.id === this.task) this.task = -1;
  }

  /** The kill it began ended (kill.ts): past the grip, that was its once tonight; broken off or lost, it may follow them again later. */
  killEnded(out: KillOutcome): void {
    const h = this.h;
    this.stats[out]++;
    if (out === "dead" || out === "survived") {
      this.done = true;
      this.note(`silence:${out}:${this.who}`);
      return;
    }
    const [lo, hi] = out === "broken" ? AFTER_BREAK : AFTER_LOST;
    this.nextAt = Math.max(this.nextAt, h.t + this.rng.range(lo, hi));
  }

  /** Its line in the spy's digest: trails, moments, and how they ended. */
  digest(): string {
    const s = this.stats;
    return `${s.trails},${s.moments},${s.dead},${s.survived},${s.broken},${s.lost}`;
  }

  private note(s: string): void {
    const p = this.spy.record;
    this.h.log("spy", [p.id], p.room, s);
  }
}
