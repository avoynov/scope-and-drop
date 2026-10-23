/**
 * A suppressor's heat, and what a cold one does to the shot.
 *
 * Heat: each shot dumps part of the powder gas's energy into the baffles. Makers' rules of thumb are about 4–5.5 K
 * a round of 5.56 (some 1.6 g of powder) and 300–500 °F after a couple of 30-round magazines; the field says a .308
 * can is too hot to touch after half a dozen shots. So the rise is taken as 3.2 K per gram of powder burnt: about
 * 10 K a round of 7N1 or M118LR, 2 K of a subsonic load. A can of half a kilogram, losing heat to still air by
 * convection and radiation, stays hot for many minutes: Newton cooling with a time constant of 5 minutes.
 *
 * Cold: the first round through a cold can often lands off the group, usually high, by about 1–1.5 MOA in shooters'
 * reports, and back on the next; it is put down to the air in the can ("first-round pop", which also makes that
 * shot louder). Here a can at the air's temperature puts its first shot 1 MOA high and a quarter right, fading out
 * once it is 6 K warm; after 45 s without a shot fresh air is back in it and the next shot pops.
 *
 * Mirage: hot air rising off the can passes through the line of sight just in front of the objective. A plume some
 * 20 K warm over a few centimetres bends light by tens of microradians, so a hot can waves the whole picture
 * (8e-5 rad at full heat); a breeze carries the plume off the line of sight, and a mirage sleeve over the can keeps
 * most of the heat in.
 */
import type { RoundId } from "./ballistics";
import { CHARGE_G } from "./recoil";

/** How the report sounds: an open muzzle, a can on a supersonic round, a can on a subsonic one, the VSS's own. */
export type Report = "open" | "can" | "can-sub" | "integral";

const MOA = Math.PI / (180 * 60);

export const CAN = {
  /** Temperature rise per gram of powder burnt (K/g). */
  heatPerGram: 3.2,
  /** Cooling time constant (s). */
  tauS: 300,
  /** Warmer than this over the air (K), the can no longer throws its first shot off. */
  coldK: 6,
  /** Idle this long (s), fresh air is back in the can and the next shot pops. */
  popS: 45,
  /** A cold can's first shot: MOA right and up. */
  shiftMoa: [0.25, 1] as const,
  /** Heat shimmer: its size at full heat (rad), the rise it starts at and is full by (K), the breeze that halves it (m/s), and what gets past a sleeve. */
  haze: { rad: 8e-5, fromK: 8, fullK: 90, windMs: 1.2, sleeve: 0.12 },
} as const;

const smooth = (a: number, b: number, x: number) => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** One can's temperature over time, from the shots through it. */
export class CanHeat {
  /** Rise over the air (K) at `at`. */
  private rise = 0;
  private at = 0;
  private last = -Infinity;

  /** How much warmer than the air it is at `t` (K). */
  riseAt(t: number): number {
    return this.rise * Math.exp(-Math.max(0, t - this.at) / CAN.tauS);
  }

  /** 1 at the air's temperature, 0 once it is `coldK` warm. */
  coldness(t: number): number {
    return Math.max(0, 1 - this.riseAt(t) / CAN.coldK);
  }

  /** Sets it `riseK` over the air at `t`, as if just fired (for stills). */
  warm(t: number, riseK: number): void {
    this.rise = Math.max(0, riseK);
    this.at = t;
    this.last = t;
  }

  /**
   * A round of `round` fired through it at `t`: where the cold can sends it (rad, right and up) and whether it
   * pops; then the can takes the shot's heat.
   */
  fire(t: number, round: RoundId): { shift: [number, number]; pop: boolean } {
    const c = this.coldness(t);
    const pop = t - this.last >= CAN.popS;
    this.rise = this.riseAt(t) + CAN.heatPerGram * CHARGE_G[round];
    this.at = t;
    this.last = t;
    return { shift: [CAN.shiftMoa[0] * MOA * c, CAN.shiftMoa[1] * MOA * c], pop };
  }

  /** The shimmer off it into the line of sight at `t` (rad), for the wind at the rifle (m/s), with or without its sleeve. */
  hazeRad(t: number, windMs: number, sleeve: boolean): number {
    const h = CAN.haze;
    const heat = smooth(h.fromK, h.fullK, this.riseAt(t));
    if (heat === 0) return 0;
    return h.rad * heat * (1 / (1 + (windMs / h.windMs) ** 2)) * (sleeve ? h.sleeve : 1);
  }
}
