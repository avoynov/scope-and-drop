/**
 * Posing as the host (milestone 3 technical plan: Posing as the host and as staff). What changes
 * when the record the spy wears has a job: the host comes in PR 2, a waiter in PR 5.
 *
 * The fake host keeps its own map (casting gave it one), so it takes wrong turns like a
 * first-timer, leads a tour it can't refuse by that map, and asks the butler where the good
 * whisky or the first-aid kit is when the evening sends it for them. It opens doors at its own
 * keys skill. It follows the programme by its cues; the household's prompt (prompts.ts) is what
 * keeps the evening going. It turns most tours down ("later"), comes to the table late by its
 * cues, and leaves before dessert: at 70% of dinner it takes a call or goes to the bathroom.
 * A host never goes home, so at its moment it walks a leaving guest out and doesn't come back.
 */
import type { Rng } from "../../mansion/core/rng";

/** Asked for a tour, the fake host turns it down this often (the real host agrees nine times in ten). */
export const REFUSE_TOUR = 0.7;
export const AGREE_TOUR = 0.9;
/** It leaves the table this far into dinner, once: a call, or the bathroom. */
export const DINNER_LEAVE = 0.7;
const CALL = 0.5;

export class Posing {
  /** Tours turned down and led, and the dinner it left. */
  readonly stats = { refused: 0, led: 0, leftDinner: 0, asked: 0 };
  /** Whether it has left the dinner table yet. */
  leftDinner = false;

  constructor(private readonly rng: Rng) {}

  /** Asked for a tour: turned down seven times in ten. */
  refusesTour(): boolean {
    const no = this.rng.chance(REFUSE_TOUR);
    this.stats[no ? "refused" : "led"]++;
    return no;
  }

  /** At its seat this far into dinner: time to go, by a call or to the bathroom (null: not yet, or already gone). */
  leaveDinner(progress: number): "call" | "bathroom" | null {
    if (this.leftDinner || progress < DINNER_LEAVE) return null;
    this.leftDinner = true;
    this.stats.leftDinner++;
    return this.rng.chance(CALL) ? "call" : "bathroom";
  }

  /** Sent for something it doesn't know where to find: it asks first. */
  asks(): void {
    this.stats.asked++;
  }
}
