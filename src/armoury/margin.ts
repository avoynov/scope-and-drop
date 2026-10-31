/**
 * The new player's safety margin (armoury task 11): an invisible zone round the spy's torso, in mrad, that counts a
 * near miss as a hit, pays less the more of it a shot uses, and shrinks with every accurate shot. A career part plus a
 * smaller part per rifle. Numbers from scripts/margin-sim.ts (game values, to be re-tuned against real play); this
 * module gives the same numbers as the simulation on the same seeds (tests/margin.test.ts).
 *
 * Pure: no clock (the contract's end date is passed in), no Math.random (the caller passes a seeded `MarginRng`).
 * The margin never shows before the shot: only the receipt (after) and the armoury's worded hint read it.
 */
import type { Outcome } from "../body/wound";
import type { RifleId } from "../scope/shot";
import type { ShotReport } from "./report";

export const MARGIN = {
  /** Starting career part (mrad): 20 cm at 183 m, 45 cm at 412 m. */
  career0: 1.1,
  /** Starting part of each rifle (mrad); 1.5 mrad in all on a first contract. */
  rifle0: 0.4,
  /** Pay cut at the margin's edge, before the outcome's own cut: pay × (1 − k·u). */
  k: 0.35,
  /** How fast accurate shots shrink it: M ← M·(1 − f·q). */
  f: 0.3,
  /** Drift per contract with a shot at the spy, as a share of the part's starting size. */
  drift: 0.02,
  /** A part below this (mrad) is gone. */
  snap: 0.05,
  /** Share of the career part's start given back on the 2nd miss in a row, and on each further one. */
  missGrow: [0.1, 0.05] as const,
  /** Misses never lift the career part above this share of its start. */
  growCap: 0.5,
  /** A break: each full `breakDays` since the last contract with a shot at the spy gives back `breakStep` of each part's start, at most `breakMax`. */
  breakDays: 14,
  breakStep: 0.05,
  breakMax: 0.15,
  /** The chest's half-width (m), for a shot's quality. */
  chestHalfM: 0.2,
  /** Training mode's margin, for practice only (the lab's switch). */
  training: 1.5,
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

/** The margin a shot with `rifle` gets (mrad): the career part plus the rifle's. */
export const effectiveMargin = (s: MarginState, rifle: RifleId): number => s.career + s.rifle[rifle];

/** A seeded source of uniform draws in [0, 1). */
export interface MarginRng {
  u(): number;
}

/** Mulberry32, the simulation's generator: the same draws on every machine for a seed. `gauss` is Box–Muller, as the simulation draws its shots. */
export function marginRng(seed: number): MarginRng & { gauss(): number } {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
  return { u, gauss };
}

/** The chest's half-width as an angle (mrad) at `rangeM`. */
const chestHalfMrad = (rangeM: number) => (MARGIN.chestHalfM / rangeM) * 1000;

/** A shot's quality, 0–1: how near the chest centre it struck, against the chest's half-width plus the margin at the shot. 0 for a miss. */
export function shotQuality(kind: ShotReport["kind"], fromChestMrad: number, rangeM: number, margin: number): number {
  if (kind === "miss") return 0;
  const E = chestHalfMrad(rangeM) + margin;
  return Math.max(0, Math.min(1, 1 - fromChestMrad / E));
}

export interface MarginJudgement {
  kind: ShotReport["kind"];
  /** Share of the margin used, 0–1; 0 for a body hit or a miss. */
  used: number;
  /** A margin hit's drawn outcome (a body hit's comes from the wound model). */
  outcome?: Outcome;
  /** What the margin leaves of the pay: 1 − k·u for a margin hit, 1 otherwise. */
  payFactor: number;
  /** The shot's quality, 0–1 (0 for a miss). */
  quality: number;
}

/**
 * A shot at the spy judged against the margin `margin` (mrad). `missMrad` is the closest approach beyond the torso's
 * outline (0 for a body hit), `fromChestMrad` the impact's angle from the chest centre. A margin hit draws its outcome
 * (one draw from `rng`): killed 1 − 0.6u, downed 0.45u, wounded 0.15u. Only shots at the spy come here.
 */
export function judgeShot(shot: { missMrad: number; fromChestMrad: number; rangeM: number }, margin: number, rng: MarginRng): MarginJudgement {
  const m = Math.max(0, margin);
  if (!(shot.missMrad > 0)) return { kind: "hit", used: 0, payFactor: 1, quality: shotQuality("hit", shot.fromChestMrad, shot.rangeM, m) };
  if (shot.missMrad > m) return { kind: "miss", used: 0, payFactor: 1, quality: 0 };
  const u = shot.missMrad / m;
  const x = rng.u();
  const outcome: Outcome = x < 1 - 0.6 * u ? "killed" : x < 1 - 0.15 * u ? "downed" : "wounded";
  return { kind: "margin", used: u, outcome, payFactor: 1 - MARGIN.k * u, quality: shotQuality("margin", shot.fromChestMrad, shot.rangeM, m) };
}

/** What a contract's margin hits leave of the pay: the largest share used among its margin hits at the spy decides. */
export function contractMarginUsed(shots: readonly Pick<ShotReport, "at" | "kind" | "marginUsed">[]): number {
  return shots.reduce((u, s) => (s.at === "spy" && s.kind === "margin" ? Math.max(u, s.marginUsed) : u), 0);
}

const DAY_MS = 86_400_000;

/**
 * The margin after a contract, from its first shot at the spy (the cold shot is the skill being taught), in this
 * order: (a) a break gives back a little (to the career part and every rifle's); (b) the 2nd miss in a row gives back 10% of the career part's start and each
 * further one 5%, never above half its start by this route (the rifle part doesn't grow from misses); (c) quality
 * shrinks each part, and the drift takes a little more: M ← M·(1 − f·q) − d·M₀; (d) each part clamped to [0, M₀];
 * (e) a part below the snap is gone. No shot at the spy: the margin stays as it was. Returns a new state.
 */
export function afterContract(state: MarginState, rifle: RifleId, firstShot: Pick<ShotReport, "kind" | "fromChestMrad" | "rangeM"> | null, endedAt: string): MarginState {
  const s: MarginState = { ...state, rifle: { ...state.rifle } };
  if (!firstShot) return s;
  const q = shotQuality(firstShot.kind, firstShot.fromChestMrad, firstShot.rangeM, effectiveMargin(state, rifle));
  // (a) A break.
  const end = Date.parse(endedAt);
  if (s.lastContractAt !== null && Number.isFinite(end)) {
    const days = (end - Date.parse(s.lastContractAt)) / DAY_MS;
    const give = Math.min(MARGIN.breakMax, MARGIN.breakStep * Math.floor(Math.max(0, days) / MARGIN.breakDays));
    s.career += give * MARGIN.career0;
    // Every rifle's part: the time away was away from all of them.
    for (const id of Object.keys(s.rifle) as RifleId[]) s.rifle[id] += give * MARGIN.rifle0;
  }
  // (b) Misses in a row.
  if (firstShot.kind === "miss") {
    s.missesInRow++;
    if (s.missesInRow >= 2) {
      const give = (s.missesInRow === 2 ? MARGIN.missGrow[0] : MARGIN.missGrow[1]) * MARGIN.career0;
      s.career = Math.min(s.career + give, Math.max(s.career, MARGIN.growCap * MARGIN.career0));
    }
  } else s.missesInRow = 0;
  // (c) Quality, and the drift.
  s.career = s.career * (1 - MARGIN.f * q) - MARGIN.drift * MARGIN.career0;
  s.rifle[rifle] = s.rifle[rifle] * (1 - MARGIN.f * q) - MARGIN.drift * MARGIN.rifle0;
  // (d) Clamp, (e) snap.
  const settle = (x: number, max: number) => {
    const c = Math.max(0, Math.min(max, x));
    return c < MARGIN.snap ? 0 : c;
  };
  s.career = settle(s.career, MARGIN.career0);
  for (const id of Object.keys(s.rifle) as RifleId[]) s.rifle[id] = settle(s.rifle[id], MARGIN.rifle0);
  if (Number.isFinite(end)) s.lastContractAt = new Date(end).toISOString();
  return s;
}

/** The armoury's hint on a rifle's card, in words, never a number: null once the margin is gone. */
export function marginHint(s: MarginState, rifle: RifleId): "Forgiving" | "Steadying" | "Almost on your own" | null {
  const share = effectiveMargin(s, rifle) / (MARGIN.career0 + MARGIN.rifle0);
  if (share > 2 / 3) return "Forgiving";
  if (share > 1 / 5) return "Steadying";
  if (share > 0) return "Almost on your own";
  return null;
}

/** "half", "a third of", …: the share of the margin a shot used, in words, to the nearest common fraction. */
export function usedInWords(u: number): string {
  const words: [number, string][] = [
    [0.1, "a sliver of the margin"],
    [0.25, "a quarter of the margin"],
    [1 / 3, "a third of the margin"],
    [0.5, "half the margin"],
    [2 / 3, "two-thirds of the margin"],
    [0.75, "three-quarters of the margin"],
    [0.9, "nearly all the margin"],
    [1, "all the margin"],
  ];
  return words.reduce((best, w) => (Math.abs(w[0] - u) < Math.abs(best[0] - u) ? w : best))[1];
}
