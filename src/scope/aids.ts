/**
 * The bolt rifle's two ways to an elevation, the player's choice:
 *  - Manual: the Speed Drop method. Elevation (mil) = range in hundreds − a factor worked out once for the load,
 *    good inside a band of ranges; the shooter ranges with the reticle and does the sum in his head.
 *  - Pro: a handheld laser rangefinder with a ballistic solver (the Sig KILO8K-ABS, src/scope/kilo.ts). The shooter
 *    puts the rifle's sight down, ranges with it at the eye and reads the elevation and wind holds off its display.
 */
import { ROUNDS, holdRad } from "./ballistics";
import { BATTLE_ZERO_M, dialTiltRad, firstHit, fly, millerStability, type Rifle, type Vec3 } from "./shot";

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

/**
 * The wind hold (mil, positive right) a solver gives on the level at `rangeM` for a steady wind of `ms` m/s from
 * `clock` (3 = from the right), spin drift included: the Kestrel's Applied Ballistics answer for the wind it reads.
 * The bullet is flown with the come-up for that range, so it crosses the target's plane where it would.
 */
export function windHoldMil(rf: Rifle, rangeM: number, ms: number, clock: number): number {
  const r = ROUNDS[rf.round];
  const th = (clock * Math.PI) / 6;
  const w: Vec3 = [-Math.sin(th) * ms, 0, Math.cos(th) * ms];
  const up = dialTiltRad(rf, 0) + holdRad(r, rangeM, BATTLE_ZERO_M, rf.sightM);
  const p = fly({
    round: r,
    mv: r.mv,
    origin: [0, -rf.sightM, 0],
    dir: [0, Math.sin(up), -Math.cos(up)],
    wind: (_x, _y, _z, _t, out) => ((out[0] = w[0]), (out[1] = w[1]), (out[2] = w[2]), out),
    sg: millerStability(rf, r.mv),
    floor: 1e4,
  });
  const h = firstHit(
    p,
    () => -1e9,
    (A, B) => (A[2] > -rangeM && B[2] <= -rangeM ? { f: (A[2] + rangeM) / (A[2] - B[2]), what: "plane" } : null),
  );
  return (-h.pos[0] / rangeM) * 1000;
}
