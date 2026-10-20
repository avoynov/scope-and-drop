/**
 * The aids tell the truth: whatever a card, an etched mark, a device or a spotter's arithmetic gives the shooter for
 * the load in the rifle, flown, puts the bullet on the aim point (to a centimetre, before the card's own rounding),
 * in still air or in the steady wind it is for.
 */
import { describe, expect, it } from "vitest";
import { speedDrop } from "../src/scope/aids";
import { ROUNDS, type RoundId } from "../src/scope/ballistics";
import { comeUps, dotValues, loadCard } from "../src/scope/cards";
import { solveFiring } from "../src/scope/kilo";
import { MRAD, THOUSANDTH } from "../src/scope/optics";
import { ACSS, ACSS_RANGES, PSO_CHEVRON_RANGES, VSS_CHEVRON_RANGES, acssChevronY, acssWindX, tremorDotMil } from "../src/scope/reticles";
import { BATTLE_ZERO_M, dialTiltLoaded, firstHit, fly, millerStability, type Rifle, type Vec3 } from "../src/scope/shot";
import { ISSUED, ITEMS, ITEM_IDS, fits } from "../src/armoury/catalogue";
import { decodeKit } from "../src/armoury/loadout";
import { rigFor } from "../src/armoury/rig";
import type { RifleId } from "../src/scope/shot";

/** Every load each rifle can carry, as the rig loads it. */
const loads = (id: RifleId): Rifle[] => [rigFor(decodeKit(id, "")).rifle, ...ITEM_IDS.filter((x) => ITEMS[x].effects.round && fits(x, id)).map((x) => rigFor(decodeKit(id, x === "sub200" ? "can,sub200" : x)).rifle)];

/**
 * Where the bullet crosses the target's plane, against the aim point (m right, m up), for a target `losM` away
 * along a line of sight `slopeRad` up, held `upRad` over and `rightRad` right, the drum on its first mark (the
 * 100 m zero), in a steady wind (`ms` from `clock`). Spin drift only if asked: the marks and cards are for the wind.
 */
function impact(rf: Rifle, losM: number, upRad: number, opts: { slopeRad?: number; rightRad?: number; ms?: number; clock?: number; spin?: boolean } = {}): [number, number] {
  const a = opts.slopeRad ?? 0;
  const r = ROUNDS[rf.round];
  const th = ((opts.clock ?? 0) * Math.PI) / 6;
  const ms = opts.ms ?? 0;
  const w: Vec3 = [-Math.sin(th) * ms, 0, Math.cos(th) * ms];
  const up = a + dialTiltLoaded(rf, ISSUED[rf.id].round, 0) + upRad;
  const yaw = opts.rightRad ?? 0;
  const p = fly({
    round: r,
    mv: r.mv,
    origin: [0, -rf.sightM * Math.cos(a), -rf.sightM * Math.sin(a)],
    dir: [Math.sin(yaw) * Math.cos(up), Math.sin(up), -Math.cos(yaw) * Math.cos(up)],
    wind: (_x, _y, _z, _t, o) => ((o[0] = w[0]), (o[1] = w[1]), (o[2] = w[2]), o),
    ...(opts.spin ? { sg: millerStability(rf, r.mv) } : {}),
    floor: 1e4,
  });
  const ty = losM * Math.sin(a);
  const tz = -losM * Math.cos(a);
  const along = (q: Vec3) => (q[1] - ty) * Math.sin(a) - (q[2] - tz) * Math.cos(a);
  const h = firstHit(p, () => -1e9, (A, B) => (along(A) < 0 && along(B) >= 0 ? { f: -along(A) / (along(B) - along(A)), what: "plane" } : null));
  return [h.pos[0], (h.pos[1] - ty) * Math.cos(a) + (h.pos[2] - tz) * Math.sin(a)];
}

describe("the aids tell the truth", () => {
  it("zeroes every load at 100 m with the drum on 1", () => {
    for (const id of ["svd", "bolt", "vss"] as const) for (const rf of loads(id)) expect(Math.abs(impact(rf, BATTLE_ZERO_M, 0)[1]), rf.round).toBeLessThan(0.001);
  });

  it("PSO chevrons and their load card: every chevron, corrected, lands on the aim point", () => {
    for (const rf of loads("svd")) {
      for (const row of loadCard(rf, "7n1", PSO_CHEVRON_RANGES, THOUSANDTH)) {
        expect(Math.abs(impact(rf, row.rangeM, row.hold * THOUSANDTH)[1]), `${rf.round} ${row.rangeM}`).toBeLessThan(0.01);
        // The card's hold is the etched chevron and its correction.
        expect(row.chevron + row.corr).toBeCloseTo(row.hold, 9);
      }
    }
    // The 7N14 flies so like the 7N1 that its card is tenths at most; the soft point's is not.
    const card = (round: RoundId) => loadCard(loads("svd").find((r) => r.round === round)!, "7n1", PSO_CHEVRON_RANGES, THOUSANDTH);
    expect(Math.max(...card("7n14").map((r) => Math.abs(r.corr)))).toBeLessThan(0.3);
    expect(Math.max(...card("sb180sp").map((r) => Math.abs(r.corr)))).toBeGreaterThan(1.5);
  });

  it("the VSS's chevrons, the PSO-1-1's and the ACSS's, hold for the SP-5 and the SP-6 alike", () => {
    for (const rf of loads("vss")) {
      for (const row of loadCard(rf, "sp5", VSS_CHEVRON_RANGES, THOUSANDTH)) expect(Math.abs(impact(rf, row.rangeM, row.hold * THOUSANDTH)[1])).toBeLessThan(0.01);
      for (const range of ACSS_RANGES) {
        const corr = loadCard(rf, ACSS.round, [range], MRAD)[0]!.corr;
        expect(Math.abs(impact(rf, range, (acssChevronY(range) + corr) * MRAD)[1])).toBeLessThan(0.01);
        // So little apart that no card is needed.
        expect(Math.abs(corr)).toBeLessThan(0.05);
      }
    }
  });

  it("the ACSS's wind dots hold off a full-value crosswind of 2 and 4 m/s", () => {
    const rf = loads("vss")[0]!;
    for (const range of ACSS_RANGES)
      for (const ms of ACSS.windMs) {
        // From 9 o'clock it blows the bullet right: hold the dot left.
        const [x] = impact(rf, range, acssChevronY(range) * MRAD, { rightRad: -acssWindX(range, ms) * MRAD, ms, clock: 9 });
        expect(Math.abs(x), `${range} m ${ms} m/s`).toBeLessThan(0.01);
      }
  });

  it("a turret's come-ups, for every load the bolt rifle takes", () => {
    for (const rf of loads("bolt"))
      for (const { rangeM, mil } of comeUps(rf, [150, 250, 300, 500, 800].filter((m) => ROUNDS[rf.round].mv > 330 || m <= 300)))
        expect(Math.abs(impact(rf, rangeM, mil * MRAD)[1]), `${rf.round} ${rangeM}`).toBeLessThan(0.01);
  });

  it("a Speed Drop factor holds within its stated tolerance across its band, for each load that has one", () => {
    for (const rf of loads("bolt")) {
      const sd = speedDrop(rf);
      if (sd.maxM - sd.minM < 150) {
        // The subsonic load gets a come-up card instead.
        expect(rf.round).toBe("sub200");
        continue;
      }
      for (let m = sd.minM; m <= sd.maxM; m += 10) expect(Math.abs(m / 100 - sd.factor - comeUps(rf, [m])[0]!.mil)).toBeLessThanOrEqual(sd.tolMil + 1e-9);
    }
  });

  it("the TReMoR3-style grid's dots are worth what the card says, row by row, for every load", () => {
    for (const rf of loads("bolt"))
      for (const d of dotValues(rf, [2, 4, 6, 8])) {
        const [x] = impact(rf, d.rangeM, d.row * MRAD, { rightRad: -tremorDotMil(d.row) * MRAD, ms: d.msPerDot, clock: 9 });
        expect(Math.abs(x), `${rf.round} row ${d.row}`).toBeLessThan(0.01);
      }
  });

  it("the KILO's elevation, for every rifle and load, level and on a slope, with its wind hold spin drift and all", () => {
    for (const id of ["svd", "bolt", "vss"] as const)
      for (const rf of loads(id)) {
        const sub = ROUNDS[rf.round].mv < 330;
        for (const losM of sub ? [150, 250] : [300, 600]) {
          for (const slopeRad of [0, 0.2, -0.15]) {
            const sol = solveFiring(rf, losM, slopeRad, { mph: 0, clock: 12 });
            expect(Math.abs(impact(rf, losM, sol.elevMil * MRAD, { slopeRad })[1]), `${rf.round} ${losM} ${slopeRad}`).toBeLessThan(0.01);
          }
          const sol = solveFiring(rf, losM, 0, { mph: 8, clock: 3 });
          const [x] = impact(rf, losM, sol.elevMil * MRAD, { rightRad: sol.windMil * MRAD, ms: 8 * 0.44704, clock: 3, spin: true });
          expect(Math.abs(x), `${rf.round} wind`).toBeLessThan(0.01);
        }
      }
  });
});
