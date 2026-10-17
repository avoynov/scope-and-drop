/**
 * The bolt rifle's two ways to an elevation, the player's choice:
 *  - Manual: the Speed Drop method. Elevation (mil) = range in hundreds − a factor worked out once for the load,
 *    good inside a band of ranges; the shooter ranges with the reticle and does the sum in his head.
 *  - Pro: a rifle-mounted laser rangefinder with a ballistic solver (after the Wilcox RAPTAR-S). It ranges what the
 *    crosshair is on, reads the slope off its inclinometer, and shows the elevation to dial or hold.
 */
import { ROUNDS, holdRad } from "./ballistics";
import { BATTLE_ZERO_M, dialTiltRad, firstHit, fly, type Rifle, type Vec3 } from "./shot";

export type AimAid = "manual" | "lrf";

export interface SpeedDrop {
  /** The factor, to 0.1 mil, as a shooter writes it. */
  factor: number;
  /** The band of ranges (m) over which range/100 − factor stays within `tolMil` of the true elevation. */
  minM: number;
  maxM: number;
  tolMil: number;
}

/**
 * The Speed Drop factor for a rifle's load and zero, worked out as the method's users do it from their come-ups:
 * the factor (to 0.1) whose band, holding within `tolMil` of the true elevation, is widest. The band is one
 * stretch of ranges, read every 5 m.
 */
export function speedDrop(rf: Rifle, tolMil = 0.2): SpeedDrop {
  const r = ROUNDS[rf.round];
  const rows: [number, number][] = [];
  for (let m = 100; m <= 1200; m += 5) rows.push([m, holdRad(r, m, BATTLE_ZERO_M, rf.sightM) * 1000]);
  let best: SpeedDrop = { factor: 0, minM: 0, maxM: 0, tolMil };
  for (let k = 0; k <= 40; k++) {
    const factor = k / 10;
    const ok = ([m, e]: [number, number]) => Math.abs(m / 100 - factor - e) <= tolMil + 1e-9;
    for (let i = 0; i < rows.length; i++) {
      if (!ok(rows[i]!)) continue;
      let j = i;
      while (j + 1 < rows.length && ok(rows[j + 1]!)) j++;
      if (rows[j]![0] - rows[i]![0] > best.maxM - best.minM) best = { factor, minM: rows[i]![0], maxM: rows[j]![0], tolMil };
      i = j;
    }
  }
  return best;
}

/**
 * The elevation (mil over the 100 m zero) a ballistic solver gives for a target `slantM` metres away along a line
 * of sight `slopeRad` up (negative down): the hold that puts the bullet on the aim point, found by flying it.
 * Standard air, no wind (the shooter holds the wind).
 */
export function solveElevationMil(rf: Rifle, slantM: number, slopeRad: number): number {
  const r = ROUNDS[rf.round];
  const a = slopeRad;
  const ty = slantM * Math.sin(a);
  const tz = -slantM * Math.cos(a);
  const along = (q: Vec3) => (q[1] - ty) * Math.sin(a) - (q[2] - tz) * Math.cos(a);
  /** Where the bullet crosses the target's plane, in mil above the aim point, with `hold` dialled. */
  const miss = (hold: number) => {
    const up = a + dialTiltRad(rf, 0) + hold;
    // The bore sits square under the line of sight, which runs up or down the slope.
    const p = fly({ round: r, mv: r.mv, origin: [0, -rf.sightM * Math.cos(a), -rf.sightM * Math.sin(a)], dir: [0, Math.sin(up), -Math.cos(up)], floor: 1e4 });
    const h = firstHit(
      p,
      () => -1e9,
      (A, B) => (along(A) < 0 && along(B) >= 0 ? { f: -along(A) / (along(B) - along(A)), what: "plane" } : null),
    );
    return (((h.pos[1] - ty) * Math.cos(a) + (h.pos[2] - tz) * Math.sin(a)) / slantM) * 1000;
  };
  // The level hold is close; a few secant steps finish it.
  let h0 = holdRad(r, slantM, BATTLE_ZERO_M, rf.sightM) * Math.cos(a);
  let m0 = miss(h0);
  let h1 = h0 - m0 / 1000;
  for (let i = 0; i < 6 && Math.abs(h1 - h0) > 1e-7; i++) {
    const m1 = miss(h1);
    const next = h1 - (m1 * (h1 - h0)) / (m1 - m0);
    [h0, m0, h1] = [h1, m1, next];
  }
  return h1 * 1000;
}

/** How far the RAPTAR-S ranges (m) and how its readout rounds. */
export const LRF_MAX_M = 1500;
export const LRF_MIN_M = 5;
