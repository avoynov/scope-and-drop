/**
 * What the cards in the shooter's pocket say for the load in the rifle. Every number is worked out from the same
 * ballistics the bullet flies by, with the rifle zeroed for that load at 100 m, so a hold read off a card is the
 * hold the bullet needs, to the card's rounding.
 *  - `loadCard`: a reticle cut for one load (the PSO's chevrons, the ACSS's) with another in the rifle: for each
 *    chevron, how far below (+) or above (−) it to hold, in the reticle's unit, with the drum on 1.
 *  - `comeUps`: the elevation (mil over the 100 m zero) by range, for a turret: past a Speed Drop band, or for a load
 *    with no useful band at all (the subsonic one).
 *  - `steepCard`: from a tower, the elevation (mil over the 100 m zero) by slant range and angle down, flown for the
 *    load: past 30° the cosine rule holds high by up to half a mil.
 *  - `dotValues`: what one wind dot of the TReMoR3-style grid is worth for the load (m/s of full-value crosswind),
 *    row by row.
 */
import { solveElevationMil } from "./aids";
import { ROUNDS, holdRad, type RoundId } from "./ballistics";
import { MRAD } from "./optics";
import { tremorDotMil } from "./reticles";
import { BATTLE_ZERO_M, crossDriftPerMs, type Rifle } from "./shot";

export interface LoadRow {
  rangeM: number;
  /** Where the chevron is cut, and the hold the load needs there (reticle units below the centre). */
  chevron: number;
  hold: number;
  /** hold − chevron: hold that much below the chevron (+) or above it (−). */
  corr: number;
}

export function loadCard(rf: Rifle, cutFor: RoundId, ranges: readonly number[], unitRad: number): LoadRow[] {
  return ranges.map((rangeM) => {
    const chevron = holdRad(ROUNDS[cutFor], rangeM, BATTLE_ZERO_M, rf.sightM) / unitRad;
    const hold = holdRad(ROUNDS[rf.round], rangeM, BATTLE_ZERO_M, rf.sightM) / unitRad;
    return { rangeM, chevron, hold, corr: hold - chevron };
  });
}

/** Whether a load card is worth carrying: some chevron is off by `tol` units or more. */
export const loadCardNeeded = (rows: readonly LoadRow[], tol = 0.05) => rows.some((r) => Math.abs(r.corr) >= tol);

/** Elevation (mil over the 100 m zero) for each range, for the load in the rifle. */
export function comeUps(rf: Rifle, ranges: readonly number[]): { rangeM: number; mil: number }[] {
  return ranges.map((rangeM) => ({ rangeM, mil: holdRad(ROUNDS[rf.round], rangeM, BATTLE_ZERO_M, rf.sightM) / MRAD }));
}

/** The range (m) at which the load needs `mil` of elevation over the 100 m zero. */
export function rangeForMil(rf: Rifle, mil: number): number {
  const r = ROUNDS[rf.round];
  let lo = BATTLE_ZERO_M;
  let hi = 2500;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (holdRad(r, mid, BATTLE_ZERO_M, rf.sightM) / MRAD < mil) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** For each grid row: the range where the load's come-up is that row, and what one wind dot there is worth (m/s). */
export function dotValues(rf: Rifle, rows: readonly number[]): { row: number; rangeM: number; msPerDot: number }[] {
  return rows.map((row) => {
    const rangeM = rangeForMil(rf, row);
    const milPerMs = crossDriftPerMs(ROUNDS[rf.round], [rangeM])[0]! / rangeM / MRAD;
    return { row, rangeM, msPerDot: tremorDotMil(row) / milPerMs };
  });
}

/** The tower card's angles (° down) and slant ranges (m); a slow load's ranges stop at 300 m. */
export const STEEP_DEG = [30, 40, 50, 55] as const;
export const steepRanges = (rf: Rifle): number[] => (ROUNDS[rf.round].mv < 330 ? [150, 200, 250, 300] : [150, 200, 300, 400]);

/**
 * Elevation (mil over the 100 m zero) for each slant range and angle down, as a solver flies it for the load: rows
 * by range, columns by angle. Short and steep it falls below the zero (negative: hold under, the turret stops at 0).
 */
export function steepCard(rf: Rifle, ranges: readonly number[] = steepRanges(rf), degs: readonly number[] = STEEP_DEG): { rangeM: number; mil: number[] }[] {
  return ranges.map((rangeM) => ({ rangeM, mil: degs.map((d) => solveElevationMil(rf, rangeM, (-d * Math.PI) / 180)) }));
}
