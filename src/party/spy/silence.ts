/**
 * Silencing a doubter (milestone 3 technical plan: The spy's answers). Someone it has seen for
 * itself to be sure of it (a challenge to its face, a test it had no answer to, a kill they saw
 * or came to after) can undo it, and while they are the only one it knows of, silencing them
 * might still save it: with two or more it would only be another body. So with murder on and a
 * lone doubter it may silence them, at most once an evening: only alone with them, out of
 * everyone's sight, and never before 19:20, through a programme beat that gathers everyone, or
 * once the farewell's first goodbye is said.
 *
 * Meanwhile it keeps them in view (the rooms they were last seen in score higher for it, as for
 * anyone keeping someone in view), and when it sees them set off somewhere quiet (the bathroom,
 * the terrace, a wander, a search of the house) it drops whatever it is idly doing, or a step of
 * its plan that only waits, and follows a step behind, a few minutes at a time, as it follows a
 * kill's target (steps.ts). The moment, the grip, the struggle and the hiding are the kill's
 * (kill.ts), and only strangling: a needle needs them walked off in view, for a goal worth that.
 * Dead, they are a second person missing; let go alive, they tell.
 *
 * It draws only from its own fork.
 */
import type { Rng } from "../../mansion/core/rng";
import type { Task } from "../tasks";
import type { Person } from "../types";
import type { Spy } from "./index";
import type { KillHost, KillOutcome } from "./kill";
import { AFTER_BREAK, FIRST_STEP, LOOSE, OFF_ALONE, TRAIL_BETWEEN, TRAIL_GAP, TRAIL_TRY } from "./steps";

/** Between the programme's beats: when it can be away from the room. */
const FREE: ReadonlySet<string> = new Set(["arrival", "mingle", "dancing", "games"]);
/** It saw them set off within this long (in-game s): it knows where they're going. */
const SEEN = 10;
/** Lost them, or something else took it away: a minute or two before it follows anyone again (in-game s). */
const AFTER_LOST: readonly [number, number] = [60, 120];

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
  /** The one person still about it knows to be sure of it (-1 none, or more than one), looked at every few steps. */
  private lone = -1;

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
    if (this.lone < 0 || !this.free(p)) return;
    const q = this.h.people[this.lone]!;
    const n = this.h.people.length;
    if (this.offAlone(q) && this.h.memory.lastT[p.id * n + q.id]! >= this.h.t - SEEN) this.follow(p, q);
  }

  /** Free to go after someone: murder on, no kill under way and nothing of its plan begun, not lying low, between the programme's beats, only idling. */
  private free(p: Person): boolean {
    const h = this.h;
    const spy = this.spy;
    if (p.staff || h.byeAt >= 0 || h.t < FIRST_STEP || h.t < this.nextAt || h.t < spy.answers.lowUntil) return false;
    if (!spy.covers.active("murder") || spy.kill.busy || (spy.plans.busy && !spy.plans.waiting) || !FREE.has(h.programme[spy.phase]?.id ?? "")) return false;
    return spy.plans.busy || !p.action || LOOSE.has(p.action.id);
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

  /** A step behind: alone with them, the kill; them gone, the beat over, murder off or feeling watched, it lets them go; the try over, back to the party a while. */
  private trail(p: Person): void {
    const h = this.h;
    const spy = this.spy;
    const t = h.tasks.get(this.task);
    if (!t) return;
    const q = h.people[this.who]!;
    if (!q.present || q.gone || q.down || h.byeAt >= 0 || h.t < spy.answers.lowUntil || !spy.covers.active("murder") || !FREE.has(h.programme[spy.phase]?.id ?? "")) {
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
    if (h.t - this.from >= this.tryFor) {
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
