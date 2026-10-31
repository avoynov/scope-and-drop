/**
 * What a contract reports when it ends: one `ShotReport` per round fired and a `MissionReport` for the whole job. The
 * joined mission (or a test, or the kit sweep) fills these in and hands them to the career; the pay, the streak, the
 * medals, wear and the safety margin are all read from them. Plain data, so a report can be stored or sent as it is.
 *
 * Where the fields come from: the hit test (`kind`, `marginUsed`, `missMrad`, `fromChestMrad`, task 11); the wound
 * model (`outcome`, src/body/wound.ts); the shot heard (`heardBy`, task 8); the party (`spyTriedGoal` from
 * `spy.goal.triedAt` and its `tried:<kind>` event, `doneAt` from the party clock, docs/party.md "Entry points").
 */
import type { Outcome } from "../body/wound";
import type { ItemId } from "./catalogue";
import type { Loadout } from "./loadout";

/** The broker's grades, set by the streak of clean contracts (task 10). A higher grade is a different crowd, never a harder one. */
export type Grade = "routine" | "priority" | "critical" | "named";
export const GRADES: readonly Grade[] = ["routine", "priority", "critical", "named"];

/** What a client can ask for on top of the job (task 10's terms; a contract can carry several). */
export type ClientTerm = "quiet" | "glass" | "one-round" | "storm" | "blind" | "before-deed" | "confirmed";
export const CLIENT_TERMS: readonly ClientTerm[] = ["quiet", "glass", "one-round", "storm", "blind", "before-deed", "confirmed"];

export type HouseSize = "small" | "grand" | "palatial";

/** One round fired during a contract. */
export interface ShotReport {
  /** Seconds into the contract. */
  t: number;
  /** What the bullet was fired at: the nearest person to the aim, set against the party's spy, or none. */
  at: "spy" | "guest" | "none";
  /** A body hit, a near miss counted by the safety margin (task 11), or a miss. */
  kind: "hit" | "margin" | "miss";
  /** For a hit or a margin hit: what the wound model (or the margin's draw) made of it. */
  outcome?: Outcome;
  /** Share of the safety margin the shot used, 0–1; 0 for a body hit or a miss. */
  marginUsed: number;
  /** The impact's angular distance from the chest centre (mrad): the shot's quality for the margin. */
  fromChestMrad: number;
  /** The angular miss beyond the torso's outline (mrad), 0 for a hit. */
  missMrad: number;
  /** Seconds since the shooter last scoped in (One Breath). */
  sinceScopeInS: number;
  /** The shot's slope (deg, down positive), for Glass Roof. */
  elevationDeg: number;
  throughGlass: boolean;
  /** Wind at the shooter at the shot (m/s), for Gale. */
  windMs: number;
  /** Guests who heard it (task 8). */
  heardBy: number;
}

/** A whole contract, as handed to the career. */
export interface MissionReport {
  contract: { fee: number; terms: ClientTerm[]; grade: Grade; house: HouseSize; label?: string; calledFor?: ItemId[] };
  loadout: Loadout;
  shots: ShotReport[];
  /** The shot that ended it decides: R is 1 killed, 0.6 downed, 0.2 wounded and gone, 0 failed. */
  result: { outcome: Outcome | "failed"; factor: number };
  /** The kit that was touched, for the receipt and wear. */
  usedItems: ItemId[];
  /** The spy tried its goal before it was shot (First Look, Before the deed). */
  spyTriedGoal: boolean;
  /** The body was seen to fall and stay down (Confirmed). */
  confirmedDown: boolean;
  /** Who first named the spy on the radio (Second Bearing). */
  firstNamedBy?: "observer" | "sniper";
  /** ISO date the contract ended, for the margin's break rule (task 11). */
  endedAt: string;
  /** When the job was done, in in-game seconds after the evening started (the party clock), for the early-finish boost. */
  doneAt?: number;
}
