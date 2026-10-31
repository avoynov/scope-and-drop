/**
 * The new player's safety margin (armoury task 11): an invisible zone round the spy's torso, in mrad, that counts a
 * near miss as a hit, pays less the more of it a shot uses, and shrinks with every accurate shot. A career part plus a
 * smaller part per rifle. Numbers from scripts/margin-sim.ts (game values, to be re-tuned against real play).
 */
import type { RifleId } from "../scope/shot";

export const MARGIN = {
  /** Starting career part (mrad): 20 cm at 183 m. */
  career0: 1.1,
  /** Starting part of each rifle (mrad); 1.5 mrad in all on a first contract. */
  rifle0: 0.4,
} as const;

export interface MarginState {
  /** The career part (mrad). */
  career: number;
  /** Each rifle's part (mrad). */
  rifle: Record<RifleId, number>;
  /** Contracts in a row whose first shot at the spy missed beyond the margin. */
  missesInRow: number;
  /** ISO date of the last contract with a shot at the spy, for the break rule; null before the first. */
  lastContractAt: string | null;
}

/** A new career's margin: every part at its starting size. */
export const freshMargin = (): MarginState => ({ career: MARGIN.career0, rifle: { vss: MARGIN.rifle0, svd: MARGIN.rifle0, bolt: MARGIN.rifle0 }, missesInRow: 0, lastContractAt: null });
