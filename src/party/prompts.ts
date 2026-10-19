/**
 * The household keeping the host to the programme (milestone 3 technical plan: Posing as the
 * host, The programme). It sits outside the spy's folder because the real host is late too, now
 * and then, with or without a spy.
 *
 * At a change the host is late for, the change is held: the butler (or, without one, a waiter)
 * walks over to the host, leans in and says a word (6×), and anyone who sees it learns
 * `prompted`. The host announces a little later and the phase starts then: `shiftPhase()` takes
 * the time back from the flexible phases after it, so the evening still ends at 22:00 and
 * everyone follows the shifted programme. When the flexible phases have nothing left to give
 * (the farewell, late in the evening), the household prompts ahead of the change instead and the
 * host announces on time. A prompt or a late announcement alone proves nothing.
 *
 * The real host is late rarely: in one evening in five, one of its announcements comes 1 to 3
 * minutes late, drawn on its own fork so it runs the same with the spy off. The spy playing the
 * host doesn't know the programme at all: it is prompted at every change and announces 2 to 6
 * minutes later.
 */
import type { Rng } from "../mansion/core/rng";
import { phaseSlack, shiftPhase, type Phase } from "./clock";
import type { Person } from "./types";

/** The real host is late with one announcement in this share of evenings, by this much (in-game s). */
export const REAL_LATE = 0.2;
export const REAL_DELAY: readonly [number, number] = [60, 180];
/** The spy playing the host announces this long after each change it is prompted for (in-game s). */
export const FAKE_DELAY: readonly [number, number] = [120, 360];
/** Below this much slack after a change, the household prompts ahead of it instead, this far ahead (in-game s). */
const MIN_LATE = 60;
const AHEAD = 90;

export interface PromptsHost {
  readonly t: number;
  readonly programme: Phase[];
  /** The phase running now. */
  readonly phaseIndex: number;
  readonly host: Person;
  /** Someone of the household free to prompt the host: the butler, else a waiter; null when nobody is. */
  prompter(): Person | null;
  /** Send them over to the host with a word; false when they can't get there. */
  prompt(by: Person, host: Person): boolean;
}

/** A change the host was late for, or prompted ahead of. */
export interface PromptRecord {
  phase: number;
  /** When it was due, how late it started (0 when prompted ahead), and who prompted (-1 nobody could). */
  due: number;
  delay: number;
  ahead: boolean;
  by: number;
}

export class Prompts {
  /** The real host's late change this evening and its delay (phase -1: none), drawn whatever plays the host. */
  readonly realLate: { phase: number; delay: number };
  /** The spy plays the host: every change is late. */
  fake = false;
  readonly log: PromptRecord[] = [];
  /** Changes already seen to, by phase. */
  private readonly done: Uint8Array;
  private readonly fakeRng: Rng;

  constructor(
    private readonly host: PromptsHost,
    rng: Rng,
  ) {
    const n = host.programme.length;
    this.done = new Uint8Array(n);
    // Any change after the first mingling's start, the farewell included (it is prompted ahead, having no slack after it).
    this.realLate = rng.chance(REAL_LATE) ? { phase: rng.int(2, n - 1), delay: rng.range(REAL_DELAY[0], REAL_DELAY[1]) } : { phase: -1, delay: 0 };
    this.fakeRng = rng.fork("fake");
  }

  /** How late the host would announce phase k (0: on time). */
  private lateFor(k: number): number {
    if (this.fake) return this.fakeRng.range(FAKE_DELAY[0], FAKE_DELAY[1]);
    return k === this.realLate.phase ? this.realLate.delay : 0;
  }

  /**
   * Once a step, after the clock moves and before the phase is read: the next change, if the host
   * is late for it, is held and the household prompts; with no slack left, the prompt comes ahead.
   */
  step(): void {
    const h = this.host;
    const prog = h.programme;
    const k = h.phaseIndex + 1;
    if (k >= prog.length || this.done[k]) return;
    const due = prog[k]!.start;
    if (h.t < due - AHEAD) return;
    if (!this.fake && k !== this.realLate.phase) {
      if (h.t >= due) this.done[k] = 1;
      return;
    }
    if (phaseSlack(prog, k) < MIN_LATE) {
      this.done[k] = 1;
      this.record(k, due, 0, true);
      return;
    }
    if (h.t < due) return;
    this.done[k] = 1;
    const d = shiftPhase(prog, k, this.lateFor(k));
    if (d > 0) this.record(k, due, d, false);
  }

  private record(k: number, due: number, delay: number, ahead: boolean): void {
    const h = this.host;
    const by = h.prompter();
    const sent = !!by && h.host.present && !h.host.gone && h.prompt(by, h.host);
    this.log.push({ phase: k, due, delay, ahead, by: sent ? by!.id : -1 });
  }
}
