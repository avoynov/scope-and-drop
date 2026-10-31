/**
 * The kit sweep (armoury task 10): does carrying kit pay? A headless shooter, built from the pure pieces (rigFor,
 * holdAt, the G7 trajectory, holdRad, kitFactor), fires one cold shot at the spy's torso per contract over many
 * ranges, winds and seeds, with a skill profile's errors sampled. Expected pay = P(a killing hit) × the pay factor,
 * less what a failure costs: the streak's better pay lost on the climb back.
 *
 *   npx tsx scripts/kit-sweep.ts            # the table and the two checks
 *   npx tsx scripts/kit-sweep.ts --json     # the rows, as JSON
 *
 * The two checks the decay is tuned against (handover, task 10):
 *  - a novice with a streak of two or more at stake earns more with a sensible kit (rest, bag, rangefinder) than bare;
 *  - an expert with no streak at stake earns most bare (the user's call, 2026-10-31: always is out of reach, since a
 *    rest and bag lift even an expert's kills at the SVD's and the Sako's ranges).
 * And pacing: the full catalogue in about 10–12 contracts at a typical hit rate.
 *
 * The shooter (all angles in rad, at the aim point):
 *  - Range: drawn per rifle over its game's distances. Estimated by the reticle (σ 10 m) or, with a rangefinder, to
 *    σ 1 m; the hold is then exact for the estimate (the truth rule: cards, the KILO), so the elevation error is
 *    holdRad(true) − holdRad(estimate) from the 100 m zero.
 *  - Wind: a crosswind drawn 0–6 m/s from any direction; the drift by Didion's lag rule, v⊥ × (tof − R / v₀)
 *    (McCoy, Modern Exterior Ballistics, ch. 8). Read with an error by skill (novice σ 30%, expert σ 10%); a Kestrel
 *    reads it where you lie, so its error is the downrange change, σ 10% (a game value); a hide stills the wind at the
 *    rifle (×0.2), which only changes the buffet.
 *  - Hold: rig.hold through holdAt at the moment the shot breaks, with the wind's dynamic pressure at the rifle. A
 *    novice breaks it anywhere in the breath; an expert at the natural pause (breath phase within ±0.3 rad of its zero).
 *  - Trigger: a normal error per axis, novice σ 0.25 mrad, expert 0.08 (game values).
 *  - Precision: the load's σ (rig.rifle.sigmaRad) per axis, and its muzzle-velocity SD flown through the trajectory.
 *  - The spy stands square to the rifle, aimed at the chest centre (1.15 m). Where the bullet meets the body
 *    (src/body/anatomy.ts, head and arms included) the wound model (src/body/wound.ts) decides at the striking speed:
 *    killed (R 1), downed (0.6, clean), wounded and gone (0.2, breaks the streak), or a miss.
 */
import { fileURLToPath } from "node:url";
import { ITEMS, ITEM_IDS, SPOTTERS, fits, type ItemId } from "../src/armoury/catalogue";
import { BASE_FEE, GRADE_MULT, gradeFor } from "../src/armoury/dossier";
import { emptyLoadout, kitFactor, spotterShare, type Loadout } from "../src/armoury/loadout";
import { marginRng } from "../src/armoury/margin";
import { rigFor } from "../src/armoury/rig";
import { inBody, type Vec3 } from "../src/body/anatomy";
import { assess, type Outcome, type TerminalId } from "../src/body/wound";
import { ROUNDS, at, holdRad } from "../src/scope/ballistics";
import { dynamicPressure, holdAt } from "../src/scope/hold";
import type { RifleId } from "../src/scope/shot";

export interface Skill {
  name: string;
  /** Wind read error, σ as a share of the speed. */
  wind: number;
  /** Trigger error per axis (rad). */
  trigger: number;
  /** Breaks the shot at the breath's pause. */
  pause: boolean;
}
export const SKILLS: Skill[] = [
  { name: "novice", wind: 0.3, trigger: 0.25e-3, pause: false },
  { name: "expert", wind: 0.1, trigger: 0.08e-3, pause: true },
];

/** The ranges each rifle's contracts are shot at (m): the VSS near its 183 m game range, the SVD and the Sako further out. */
export const RANGES: Record<RifleId, [number, number]> = { vss: [130, 240], svd: [250, 450], bolt: [300, 650] };

const CHEST_M = 1.15;
const ZERO_M = 100;

/** The kits compared on each rifle (only what fits it). */
export function kitsFor(rifle: RifleId): { name: string; items: ItemId[]; spotter?: "rookie" | "seasoned" | "veteran" }[] {
  const ok = (ids: ItemId[]) => ids.filter((id) => fits(id, rifle));
  return [
    { name: "bare", items: [] },
    { name: "bag", items: ok(["bag"]) },
    { name: "rest+bag", items: ok(["atlas", "bag"]) },
    { name: "rest+bag+lrf", items: ok(["atlas", "bag", "lrf"]) },
    { name: "rest+bag+kilo", items: ok(["atlas", "bag", "kilo"]) },
    { name: "rest+bag+lrf+kestrel", items: ok(["atlas", "bag", "lrf", "kestrel"]) },
    { name: "lrf", items: ok(["lrf"]) },
    { name: "rest+bag+lrf, seasoned", items: ok(["atlas", "bag", "lrf"]), spotter: "seasoned" },
  ];
}

const loadoutOf = (rifle: RifleId, items: ItemId[], spotter?: "rookie" | "seasoned" | "veteran"): Loadout => {
  const l = emptyLoadout(rifle);
  for (const id of items) l.items[ITEMS[id].slot] = id;
  if (spotter) l.spotters = [{ tier: spotter, place: "beside" }];
  return l;
};

export interface Odds {
  killed: number;
  downed: number;
  wounded: number;
}

/** Where the bullet meets the body, flying straight in from the front at (x, y) in the body's frame, or null for a miss. */
function entryAt(x: number, y: number): Vec3 | null {
  for (let z = 0.3; z >= -0.3; z -= 0.005) if (inBody([x, y, z])) return [x, y, z + 0.005];
  return null;
}

/**
 * The wound model takes tens of milliseconds a shot, so it is run once per cell of a 3 cm grid over the body, for
 * each load at a few striking speeds (range bins), and each shot looks up its cell. `null` where the cell's centre
 * misses the body.
 */
const CELL = 0.03;
const BINS = 4;
const maps = new Map<string, Map<string, Outcome | null>>();
function outcomeAt(round: TerminalId, speed: number, x: number, y: number): Outcome | null {
  const key = `${round}|${Math.round(speed / 20) * 20}`;
  let m = maps.get(key);
  if (!m) maps.set(key, (m = new Map()));
  const ix = Math.round(x / CELL);
  const iy = Math.round(y / CELL);
  const ck = `${ix},${iy}`;
  if (m.has(ck)) return m.get(ck)!;
  const entry = entryAt(ix * CELL, iy * CELL);
  const o = entry ? assess({ entry, dir: [0, 0, -1], speed: Math.round(speed / 20) * 20, round, seed: ix * 131 + iy }).outcome : null;
  m.set(ck, o);
  return o;
}

/** The odds of each outcome for a loadout and skill, over `n` seeded shots. */
export function hitChance(l: Loadout, skill: Skill, n: number, seed = 1): Odds {
  const rig = rigFor(l);
  const rf = rig.rifle;
  const round = ROUNDS[rf.round];
  const r = marginRng(seed * 104729 + 7);
  const [r0, r1] = RANGES[l.rifle];
  const spot = l.spotters.find((s) => s.place === "beside");
  const windErr = Math.min(skill.wind, rig.windMeter ? 0.1 : Infinity, spot ? SPOTTERS[spot.tier].windError : Infinity);
  const odds: Odds = { killed: 0, downed: 0, wounded: 0 };
  for (let i = 0; i < n; i++) {
    const R = r0 + (r1 - r0) * r.u();
    // Range, and the elevation error it leaves.
    const est = Math.max(50, R + r.gauss() * (rig.ranging === "none" ? 10 : 1));
    let pitch = holdRad(round, R, ZERO_M, rf.sightM) - holdRad(round, est, ZERO_M, rf.sightM);
    // The muzzle velocity of this round: the drop it gives against the mean load's.
    const dv = Math.round(r.gauss() * rf.mvSd);
    if (dv) pitch += (at({ ...round, mv: round.mv + dv }, R).drop - at(round, R).drop) / R;
    // Wind: the drift by the lag rule, and the part of it the shooter's read misses.
    const speed = 6 * r.u();
    const cross = speed * Math.sin(2 * Math.PI * r.u());
    const s = at(round, R);
    const lag = s.tof - R / round.mv;
    let yaw = (cross * lag * (r.gauss() * windErr)) / R;
    // The hold when the shot breaks, with the buffet of the wind at the rifle.
    const t = skill.pause ? (Math.PI * Math.floor(r.u() * 40) + (r.u() - 0.5) * 0.6) / 1.55 : 60 * r.u();
    const atRifle = rig.hide ? speed * 0.2 : speed;
    const [hy, hp] = holdAt(rig.hold, t, dynamicPressure([atRifle, 0, 0]));
    yaw += hy + r.gauss() * skill.trigger + r.gauss() * rf.sigmaRad;
    pitch += hp + r.gauss() * skill.trigger + r.gauss() * rf.sigmaRad;
    // Where it strikes, and what the wound model makes of it.
    // The striking speed of the range bin the shot falls in.
    const bin = r0 + ((r1 - r0) * (Math.floor(((R - r0) / (r1 - r0)) * BINS) + 0.5)) / BINS;
    const o = outcomeAt(rf.round as TerminalId, at(round, bin).v, yaw * R, CHEST_M + pitch * R);
    if (o) odds[o] += 1 / n;
  }
  return odds;
}

/** What a failure at streak `s` costs: the better pay of the old grades lost while the streak climbs back from 0. */
export function failureCost(s: number, fee: number): number {
  let cost = 0;
  for (let j = 0; j < 10; j++) cost += fee * (GRADE_MULT[gradeFor(s + j)] - GRADE_MULT[gradeFor(j)]);
  return cost;
}

export interface Row {
  rifle: RifleId;
  skill: string;
  kit: string;
  odds: Odds;
  payFactor: number;
  /** Expected € per contract at each streak at stake (0, 2, 5, 9). */
  ev: Record<number, number>;
}

export const STREAKS = [0, 2, 5, 9];

export function sweep(n = 4000): Row[] {
  const fee = BASE_FEE.grand;
  const rows: Row[] = [];
  for (const rifle of ["vss", "svd", "bolt"] as const)
    for (const skill of SKILLS)
      for (const k of kitsFor(rifle)) {
        const l = loadoutOf(rifle, k.items, k.spotter);
        const o = hitChance(l, skill, n);
        const pf = kitFactor(l) * (1 - spotterShare(l));
        const failed = 1 - o.killed - o.downed - o.wounded;
        const ev: Record<number, number> = {};
        for (const s of STREAKS) {
          const win = fee * GRADE_MULT[gradeFor(s)] * pf;
          // Killed or downed keeps the streak; wounded and gone pays a fifth and breaks it; a miss also owes a spotter the retainer.
          ev[s] = Math.round((o.killed + 0.6 * o.downed + 0.2 * o.wounded) * win - (1 - o.killed - o.downed) * failureCost(s, fee) - failed * l.spotters.length * 400);
        }
        rows.push({ rifle, skill: skill.name, kit: k.name, odds: o, payFactor: pf, ev });
      }
  return rows;
}

/** The two checks: novice with a streak ≥ 2 does better with rest+bag+lrf than bare; expert does best bare. */
export function checks(rows: Row[]): { name: string; ok: boolean; detail: string }[] {
  const out: { name: string; ok: boolean; detail: string }[] = [];
  for (const rifle of ["vss", "svd", "bolt"] as const) {
    const of = (skill: string, kit: string) => rows.find((r) => r.rifle === rifle && r.skill === skill && r.kit === kit)!;
    for (const s of STREAKS.filter((x) => x >= 2)) {
      const bare = of("novice", "bare").ev[s]!;
      const kit = of("novice", "rest+bag+lrf").ev[s]!;
      out.push({ name: `${rifle}: novice, streak ${s}: kit beats bare`, ok: kit > bare, detail: `€${kit} vs €${bare}` });
    }
    // The user's rule (2026-10-31): with nothing at stake an expert does best bare; with a streak at stake kit may pay.
    for (const s of [0]) {
      const best = rows.filter((r) => r.rifle === rifle && r.skill === "expert").sort((a, b) => b.ev[s]! - a.ev[s]!)[0]!;
      out.push({ name: `${rifle}: expert, streak ${s}: bare pays most`, ok: best.kit === "bare", detail: `best ${best.kit} €${best.ev[s]} vs bare €${of("expert", "bare").ev[s]}` });
    }
  }
  return out;
}

/** Pacing: contracts to buy everything that fits the rifle, at the typical (novice with a sensible kit) pay at streak 0 to 5. */
export function pacing(rows: Row[]): Record<RifleId, number> {
  const out = {} as Record<RifleId, number>;
  for (const rifle of ["vss", "svd", "bolt"] as const) {
    const cost = ITEM_IDS.filter((id) => fits(id, rifle)).reduce((s, id) => s + ITEMS[id].price, 0);
    const row = rows.find((r) => r.rifle === rifle && r.skill === "novice" && r.kit === "rest+bag+lrf")!;
    // Mean pay per contract, without the streak's loss (money in hand, not its expectation).
    const pay = (row.odds.killed + 0.6 * row.odds.downed + 0.2 * row.odds.wounded) * BASE_FEE.grand * GRADE_MULT[gradeFor(3)] * row.payFactor;
    out[rifle] = Math.round((cost / pay) * 10) / 10;
  }
  return out;
}

const direct = !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (direct) {
  const rows = sweep();
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows));
  else {
    console.log(`rifle  skill   kit                       kill   down   wound  pay×   EV@${STREAKS.join("/")}`);
    for (const r of rows)
      console.log(
        `${r.rifle.padEnd(6)} ${r.skill.padEnd(7)} ${r.kit.padEnd(25)} ${r.odds.killed.toFixed(3)}  ${r.odds.downed.toFixed(3)}  ${r.odds.wounded.toFixed(3)}  ${r.payFactor.toFixed(3)}  ${STREAKS.map((s) => r.ev[s]).join(" / ")}`,
      );
    console.log("");
    for (const c of checks(rows)) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
    console.log("");
    console.log(
      `contracts to buy everything that fits: ${Object.entries(pacing(rows))
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}`,
    );
    console.log(`failure cost by streak: ${STREAKS.map((s) => `${s}: €${Math.round(failureCost(s, BASE_FEE.grand))}`).join(", ")}`);
  }
}
