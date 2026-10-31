/**
 * The spotter beside you (task 7): a second pair of eyes on the radio. Pure: the lab hands it the wind it can see,
 * the shots it watches and the ranges it knows, and it hands back calls for the radio (src/scope/radio.ts).
 *
 * By tier (SPOTTERS in catalogue.ts; the distributions are the handover's defaults):
 *  - Notices: the chance that an impact becomes a call. A shot call needs the impact seen.
 *  - Wind: read off the flags at three points along the path, nearer ones weighted more (the first third of the
 *    way counts most), then misread: the speed by a normal, multiplicative error (σ 0.4 / 0.25 / 0.15), the
 *    direction by σ 0.5 / 0.25 / 0 clock hours. From that reading the arithmetic is exact for your round (the truth
 *    rule): the hold is the solver's for the reading (aids.windHoldMil), in the reticle's unit, rounded to a quarter.
 *  - Delay: uniform in the tier's range, from the event to the start of speaking.
 *  - Range calls: exact ("range is range"), and only a veteran makes them.
 */
import { Rng } from "../mansion/core/rng";
import { windHoldMil } from "../scope/aids";
import { MRAD } from "../scope/optics";
import { quarter, sayHold, sayRange, type RadioCall } from "../scope/radio";
import type { Rifle } from "../scope/shot";
import { SPOTTERS, type SpotterTier } from "./catalogue";

/** Direction error by tier (σ, clock hours). */
export const DIR_SIGMA: Readonly<Record<SpotterTier, number>> = { rookie: 0.5, seasoned: 0.25, veteran: 0 };
/** How much each of the three flags along the path counts: near, middle, far. */
export const FLAG_WEIGHTS = [3, 2, 1] as const;
/** How often a spotter looks the flags over again (s); a new hold is called when it changes. */
export const WIND_LOOK_S = 6;

/** A wind as a spotter reads it: speed (m/s) and the clock it blows from, relative to the line of fire (3 = from the right). */
export interface WindRead {
  ms: number;
  clock: number;
}

/**
 * The wind across the line of fire at the three flags, as one reading. `w` are scene wind vectors [x, y, z] (m/s)
 * near, middle and far; `yaw` is the bore's yaw (three.js: positive to the left, 0 down −Z).
 */
export function flagReading(w: readonly (readonly [number, number, number])[], yaw: number): WindRead {
  let x = 0;
  let z = 0;
  let sum = 0;
  w.forEach((v, i) => {
    const k = FLAG_WEIGHTS[i] ?? 1;
    x += v[0] * k;
    z += v[2] * k;
    sum += k;
  });
  x /= sum;
  z /= sum;
  // In the rifle's frame: across to the right, and back toward the shooter; the clock it blows from.
  const across = x * Math.cos(yaw) - z * Math.sin(yaw);
  const back = x * Math.sin(yaw) + z * Math.cos(yaw);
  const clock = ((((Math.atan2(-across, back) * 6) / Math.PI) % 12) + 12) % 12;
  return { ms: Math.hypot(x, z), clock };
}

/** Which side a wind from `clock` comes from, as said. */
const fromSide = (clock: number) => {
  const c = ((clock % 12) + 12) % 12;
  if (c < 0.75 || c > 11.25) return "head on";
  if (c > 5.25 && c < 6.75) return "from behind";
  return c < 6 ? "right" : "left";
};

export class Spotter {
  readonly spec: (typeof SPOTTERS)[SpotterTier];
  private readonly rng: Rng;
  private lastWind: number | null = null;
  private nextLook = 0;

  constructor(
    readonly tier: SpotterTier,
    seed: string | number,
    /** Who the calls are from, for the log. */
    readonly label: string = tier,
  ) {
    this.spec = SPOTTERS[tier];
    this.rng = new Rng(`spotter/${seed}/${tier}`);
  }

  /** The delay from an event to speaking (s). */
  delay(): number {
    const [a, b] = this.spec.delayS;
    return this.rng.range(a, b);
  }

  /** The tier's misreading of what the flags show (drawn once per call). */
  misread(w: WindRead): WindRead {
    const ms = Math.max(0, w.ms * (1 + this.rng.normal(0, this.spec.windError)));
    const s = DIR_SIGMA[this.tier];
    const clock = s > 0 ? (((w.clock + this.rng.normal(0, s)) % 12) + 12) % 12 : w.clock;
    return { ms, clock };
  }

  /** The hold for a reading, exact for the round (not rounded): positive right, in units of `unitRad`. */
  static windHold(rf: Rifle, rangeM: number, read: WindRead, unitRad: number): number {
    return (windHoldMil(rf, rangeM, read.ms, read.clock) * MRAD) / unitRad;
  }

  /**
   * Looks the flags over at `t` (every WIND_LOOK_S); if what they show has moved the hold by a quarter since the
   * last call, returns a call for the tier's reading of them. `read` is what the flags truly show.
   */
  windCall(t: number, rf: Rifle, rangeM: number, read: WindRead, unitRad: number): RadioCall | null {
    if (t < this.nextLook) return null;
    this.nextLook = t + WIND_LOOK_S;
    // A new call when what the flags show has changed by a quarter of the hold; the misreading is drawn for the call.
    const truth = quarter(Spotter.windHold(rf, rangeM, read, unitRad));
    if (truth === this.lastWind) return null;
    this.lastWind = truth;
    const seen = this.misread(read);
    const hold = quarter(Spotter.windHold(rf, rangeM, seen, unitRad));
    const text =
      hold === 0 ? (seen.ms < 0.5 ? "Wind calm, hold centre" : `Wind ${fromSide(seen.clock)}, hold centre`) : `Wind ${fromSide(seen.clock)}, hold ${sayHold(hold)} ${hold > 0 ? "right" : "left"}`;
    return { kind: "wind", text, at: t + this.delay(), from: this.label };
  }

  /**
   * The call for an impact the spotter watched land at `t`: "Hit", the miss as elevation then windage in the
   * reticle's unit to a quarter ("Low one point five, right point five"), or a word for a bullet that never reached
   * the target. `miss` is where it crossed the target's plane against the aim point (m right, m up). Null if the
   * spotter didn't see it land.
   */
  shotCall(t: number, s: { hit: boolean; miss: readonly [number, number] | null; rangeM: number; note?: string }, unitRad: number): RadioCall | null {
    if (!this.rng.chance(this.spec.notices)) return null;
    let text: string;
    if (s.hit) text = "Hit";
    else if (s.note) text = s.note;
    else if (!s.miss) text = "Miss, short";
    else {
      const up = quarter(s.miss[1] / s.rangeM / unitRad);
      const right = quarter(s.miss[0] / s.rangeM / unitRad);
      const parts: string[] = [];
      if (up !== 0) parts.push(`${up > 0 ? "high" : "low"} ${sayHold(up)}`);
      if (right !== 0) parts.push(`${right > 0 ? "right" : "left"} ${sayHold(right)}`);
      text = parts.length ? parts.join(", ") : "Miss, just off him";
      text = text[0]!.toUpperCase() + text.slice(1);
    }
    return { kind: "shot", text, at: t + this.delay(), from: this.label };
  }

  /** A veteran's range call, exact to the metre; null for anyone else. */
  rangeCall(t: number, rangeM: number): RadioCall | null {
    if (this.tier !== "veteran") return null;
    return { kind: "range", text: `Range ${sayRange(rangeM)}`, at: t + this.delay(), from: this.label };
  }
}

/** `spot=veteran` or `spot=rookie,seasoned`: the spotters beside you, at most two, unknown tiers left out. */
export function parseSpotters(param: string | null): SpotterTier[] {
  if (!param) return [];
  return param
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is SpotterTier => Object.hasOwn(SPOTTERS, s))
    .slice(0, 2);
}
