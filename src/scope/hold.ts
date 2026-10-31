/**
 * How the rifle moves while the shooter holds it, by what it rests on. Angles in radians, times in seconds.
 *
 * Two parts:
 *  - `holdAt`: the hold's own motion. A breathing figure-eight (≈0.25 Hz), a slow postural wander (≈0.05 Hz),
 *    the heartbeat's twitch, a physiological tremor (8–12 Hz) and, new, buffeting by the wind on the rifle and the
 *    shooter. The lab's hold until now is the bipod's: `HOLD.harris` reproduces it exactly with the wind still.
 *  - `RestDynamics`: how the rifle follows the hands when it is swung. A rigid rest follows at once; a muzzle
 *    weight or a suppressor adds inertia, so a fast swing overshoots and settles; a tripod's saddle drags; a bipod
 *    swung past what its legs allow lifts and re-settles with a jolt; a rear bag lets the stock sag and settle back
 *    after a swing and has to be lifted past a few degrees.
 *
 * Buffeting: the wind pushes on the rifle and the shooter with its dynamic pressure q = ½ρv², and the gusts in it
 * make the push fluctuate. The swing it causes is taken as proportional to q, through a band-limited noise of
 * about 0.7–3 Hz (the rifle on its rest is a stiff, well-damped system; slower gusts the shooter rides out). No
 * published study measures aim sway by rest or by wind, so the gains are game values: at 8 m/s (q ≈ 39 Pa) a
 * bipod-rested rifle buffets about 0.15 mrad, half its breathing sway; at the lab's 2.5 m/s it is a tenth of that.
 */

/** The breathing sway's amplitude (rad) behind the lab's bipod hold. */
export const BASE_SWAY = 0.00032;
/** Air density for the wind's dynamic pressure (kg/m³). */
const RHO = 1.225;

export interface HoldSpec {
  /** Breathing figure-eight, as a scale on the lab's (yaw, pitch). */
  breath: [number, number];
  /** Slow postural wander, as a scale on the lab's (yaw, pitch). */
  wander: [number, number];
  /** Heartbeat twitch, as a scale on the lab's. */
  pulse: number;
  /** Physiological tremor amplitude (rad); the lab's bipod hold shows none. */
  tremor: number;
  /** Buffeting: radians of swing per pascal of the wind's dynamic pressure at the rifle. */
  buffet: number;
}

/** What each rest gives, before the rear bag, a muzzle mass or the magazine change it. */
export const HOLD = {
  /** The lab's hold until now: the rifle on a bipod, prone. */
  harris: { breath: [1, 1], wander: [1, 1], pulse: 1, tremor: 0, buffet: 3.8e-6 },
  /** A rolled pack under the handguard: softer and higher, so everything moves half as much again. */
  pack: { breath: [1.5, 1.5], wander: [1.5, 1.5], pulse: 1.3, tremor: 1.2e-5, buffet: 6e-6 },
  /** The Atlas holds like the Harris; what it changes is how it swings (REST.atlas). */
  atlas: { breath: [1, 1], wander: [1, 1], pulse: 1, tremor: 0, buffet: 3.8e-6 },
  /** A tripod with a saddle, prone on the ground: taller and springier than a bipod. Its place is the tower. */
  tripod: { breath: [1.2, 1.2], wander: [1.2, 1.2], pulse: 1.1, tremor: 6e-6, buffet: 5e-6 },
  /**
   * The tower's platform, seated behind the tripod: a bipod can't be laid at 30–55° down, so the tripod is the steady
   * way. Breathing, wander, heartbeat and tremor 0.9× the pack's (seated, braced, but higher off the ground than
   * prone); the buffet as the pack's, since the shooter sits up in the wind.
   */
  towerTripod: { breath: [1.35, 1.35], wander: [1.35, 1.35], pulse: 1.17, tremor: 1.08e-5, buffet: 6e-6 },
  /** The tower without a tripod: the handguard on the platform's railing. The same four 2.5× the pack's, buffet 1.5×. */
  railing: { breath: [3.75, 3.75], wander: [3.75, 3.75], pulse: 3.25, tremor: 3e-5, buffet: 9e-6 },
} as const satisfies Record<string, HoldSpec>;
export type RestKind = keyof typeof HOLD;

/** Copies a hold so its arrays can be scaled without touching the presets. */
export const cloneHold = (h: HoldSpec): HoldSpec => ({ breath: [h.breath[0], h.breath[1]], wander: [h.wander[0], h.wander[1]], pulse: h.pulse, tremor: h.tremor, buffet: h.buffet });

/** The wind's dynamic pressure (Pa) for a wind vector (m/s). */
export const dynamicPressure = (w: readonly [number, number, number]) => 0.5 * RHO * (w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);

/**
 * Where the hold has the bore at `t`, against the aim: [yaw, pitch] (yaw positive to the left, as three.js turns).
 * `q` is the wind's dynamic pressure at the rifle now (Pa).
 */
export function holdAt(h: HoldSpec, t: number, q = 0): [number, number] {
  const b = BASE_SWAY;
  const beat = Math.exp(-((t * 1.15) % 1) * 18);
  let yaw = b * (h.breath[0] * Math.sin(t * 1.55) * 0.6 + h.wander[0] * Math.sin(t * 0.37 + 1) * 0.8);
  let pitch = b * (h.breath[1] * Math.sin(t * 3.1 + 0.4) * 0.5 + h.wander[1] * Math.sin(t * 0.29) * 0.9) - 0.00006 * h.pulse * beat;
  if (h.tremor > 0) {
    yaw += h.tremor * (Math.sin(t * 59.7 + 0.3) * 0.6 + Math.sin(t * 71.3 + 2.1) * 0.4);
    pitch += h.tremor * (Math.sin(t * 63.1 + 1.2) * 0.6 + Math.sin(t * 77.9 + 0.7) * 0.4);
  }
  if (q > 0 && h.buffet > 0) {
    // Band-limited, about 0.7–3 Hz: the side push of a crosswind swings the yaw most; the pitch takes less.
    const k = h.buffet * q;
    yaw += k * (Math.sin(t * 4.7 + 0.3) * 0.5 + Math.sin(t * 7.9 + 1.1) * 0.35 + Math.sin(t * 13.1 + 2) * 0.15);
    pitch += 0.45 * k * (Math.sin(t * 5.3 + 2.4) * 0.5 + Math.sin(t * 9.7 + 0.6) * 0.35 + Math.sin(t * 15.7 + 1.7) * 0.15);
  }
  return [yaw, pitch];
}

/**
 * The mast under a tower's platform sways with the wind. Tall lattice masts have their first bending mode at a few
 * tenths of a hertz; the eye goes round at 0.25 Hz, in yaw and pitch, by 0.1 mrad at the dynamic pressure of an
 * 8 m/s wind (39 Pa) and in proportion to the platform's dynamic pressure. No published measurement of a platform's
 * angular sway was found, so the amplitude is a game value. It sits well inside what towers are built to: the
 * EIA/TIA-222 twist-and-sway limits for microwave dishes on them are 0.7–3.5° in a design wind.
 */
export const MAST = { hz: 0.25, mrad: 0.1, refPa: 39 } as const;

/** The mast's sway at the eye at `t` for the platform's dynamic pressure `q` (Pa): [yaw, pitch] (rad). */
export function mastSwayAt(t: number, q: number): [number, number] {
  if (q <= 0) return [0, 0];
  const a = MAST.mrad * 1e-3 * (q / MAST.refPa);
  const w = 2 * Math.PI * MAST.hz * t;
  // An orbit rather than a line: the along-wind and the across-wind modes run a little out of step.
  return [a * Math.sin(w), a * Math.sin(w + 1.3)];
}

/** How the rifle swings on its rest. */
export interface RestSpec {
  /** A swing this far from where the legs stand makes them lift and re-settle (rad); Infinity for never. */
  resetRad: number;
  /** Fastest the rest lets the rifle turn (rad/s): a tripod's saddle drags. Infinity for no limit. */
  panRate: number;
  /** Pan shadow: how far the head trails a quick swing, against the lab's firm weld (1). */
  panLag: number;
  /** A rear bag under the stock: how long it takes to settle after a swing (s), and the swing past which it must be lifted (rad). */
  bag: { settleS: number; liftRad: number } | null;
  /** Mass out at the muzzle (kg): it gives the swing inertia, so a quick swing overshoots and settles. */
  muzzleKg: number;
}

const DEG = Math.PI / 180;
/** The lab's rest: it follows the hands exactly, as it always has. */
export const LAB_REST: RestSpec = { resetRad: Infinity, panRate: Infinity, panLag: 1, bag: null, muzzleKg: 0 };
export const REST: Record<RestKind, RestSpec> = {
  /** A pack moves with the rifle; it never has to be re-set. */
  pack: { resetRad: Infinity, panRate: Infinity, panLag: 1.1, bag: null, muzzleKg: 0 },
  /** The Harris swivels a little; past about 5° the legs have to come up and be set down again. */
  harris: { resetRad: 5 * DEG, panRate: Infinity, panLag: 1, bag: null, muzzleKg: 0 },
  /** The Atlas pans and cants 15° each way on its preloaded head: smooth swings, a steadier head (pan shadow 0.7). */
  atlas: { resetRad: 15 * DEG, panRate: Infinity, panLag: 0.7, bag: null, muzzleKg: 0 },
  /** The saddle turns smoothly but drags: about 12°/s at most. */
  tripod: { resetRad: Infinity, panRate: 12 * DEG, panLag: 0.9, bag: null, muzzleKg: 0 },
  /** On the platform the saddle is the same saddle. */
  towerTripod: { resetRad: Infinity, panRate: 12 * DEG, panLag: 0.9, bag: null, muzzleKg: 0 },
  /** The handguard slides along the rail: nothing to re-set, but the head trails a swing as off a pack. */
  railing: { resetRad: Infinity, panRate: Infinity, panLag: 1.1, bag: null, muzzleKg: 0 },
};
/** The squeeze bag: about a second to settle after a swing, and lifted past 6°. */
export const BAG = { settleS: 1, liftRad: 6 * DEG } as const;

/**
 * Inertia of the swing for a mass at the muzzle: a spring-damper the hands drive. The 0.4 kg weight gives about a
 * 0.4 s settle (ζ 0.55, ωn 18 rad/s); more mass swings slower. Returns ωn (rad/s) and ζ.
 */
export function muzzleInertia(kg: number): { wn: number; zeta: number } | null {
  if (kg <= 0) return null;
  return { wn: 18 * Math.sqrt(0.4 / kg), zeta: 0.55 };
}

/** The heartbeat twitch and the tremor are damped by mass at the muzzle: 0.7× for 0.4 kg. */
export const muzzleSteadying = (kg: number) => 1 / (1 + 1.07 * Math.max(0, kg));

/** One jolt of the legs (or the bag) being lifted and set down again. */
interface Jolt {
  at: number;
  yaw: number;
  pitch: number;
}
/** The jolt's shape: a quick hop and a ringing settle, over about 0.8 s. */
function joltAt(j: Jolt, t: number): [number, number] {
  const s = t - j.at;
  if (s < 0 || s > 0.9) return [0, 0];
  // Up as the legs lift, down onto them, ringing out at about 6 Hz.
  const hop = Math.sin(Math.PI * Math.min(1, s / 0.18)) * (s < 0.18 ? 1 : 0);
  const ring = s > 0.18 ? Math.sin(2 * Math.PI * 6 * (s - 0.18)) * Math.exp(-(s - 0.18) / 0.14) : 0;
  return [j.yaw * (0.6 * hop + 0.5 * ring), j.pitch * (hop + 0.7 * ring)];
}

export interface RestState {
  /** Where the bore points from the rest's motion (before the hold's own sway). */
  yaw: number;
  pitch: number;
  /** How unsettled a rear bag is (0 settled … 1 just swung). */
  bagUnsettled: number;
  /** A re-set under way (for the readout). */
  resetting: boolean;
}

/**
 * The rifle on its rest, following where the hands send it. `step` with the hands' aim each frame; `shift` moves the
 * whole rifle at once (recoil's lasting rise, a hand on the action), which the rest does not resist.
 */
export class RestDynamics {
  private yaw: number;
  private pitch: number;
  private vYaw = 0;
  private vPitch = 0;
  private anchorYaw: number;
  private anchorPitch: number;
  private bagAnchorYaw: number;
  private bagAnchorPitch: number;
  private unsettled = 0;
  private jolts: Jolt[] = [];
  private n = 0;
  private readonly inertia: { wn: number; zeta: number } | null;

  constructor(
    readonly spec: RestSpec,
    yaw: number,
    pitch: number,
  ) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.anchorYaw = this.bagAnchorYaw = yaw;
    this.anchorPitch = this.bagAnchorPitch = pitch;
    this.inertia = muzzleInertia(spec.muzzleKg);
  }

  /** The whole rifle moved by (dYaw, dPitch) without the hands: the rest moves with it. */
  shift(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch += dPitch;
    this.anchorYaw += dYaw;
    this.anchorPitch += dPitch;
    this.bagAnchorYaw += dYaw;
    this.bagAnchorPitch += dPitch;
  }

  /** Puts the rifle where the hands are at once, settled: for stills and a new rifle. */
  reset(yaw: number, pitch: number): void {
    this.yaw = this.anchorYaw = this.bagAnchorYaw = yaw;
    this.pitch = this.anchorPitch = this.bagAnchorPitch = pitch;
    this.vYaw = this.vPitch = 0;
    this.unsettled = 0;
    this.jolts = [];
  }

  /** Advances to `t` with the hands aiming at (yaw, pitch); returns where the bore points. */
  step(yaw: number, pitch: number, t: number, dt: number): RestState {
    const s = this.spec;
    const y0 = this.yaw;
    const p0 = this.pitch;
    if (dt > 0) {
      if (this.inertia) {
        // A spring-damper driven by the hands, integrated in small steps so a long frame stays stable.
        const { wn, zeta } = this.inertia;
        const n = Math.max(1, Math.ceil(dt / 0.004));
        const h = dt / n;
        for (let i = 0; i < n; i++) {
          this.vYaw += (wn * wn * (yaw - this.yaw) - 2 * zeta * wn * this.vYaw) * h;
          this.vPitch += (wn * wn * (pitch - this.pitch) - 2 * zeta * wn * this.vPitch) * h;
          this.yaw += this.vYaw * h;
          this.pitch += this.vPitch * h;
        }
      } else {
        this.yaw = yaw;
        this.pitch = pitch;
      }
      if (Number.isFinite(s.panRate)) {
        const max = s.panRate * dt;
        this.yaw = y0 + Math.max(-max, Math.min(max, this.yaw - y0));
        this.pitch = p0 + Math.max(-max, Math.min(max, this.pitch - p0));
      }
    } else {
      this.yaw = yaw;
      this.pitch = pitch;
    }
    // Past what the legs allow they come up and are set down again where the rifle now points.
    if (Math.hypot(this.yaw - this.anchorYaw, this.pitch - this.anchorPitch) > s.resetRad) this.resettle(t, 0.0011);
    if (s.bag) {
      // A swing unsettles the stock in the bag; it sags a little and settles back over about a second.
      // About 3°/s counts as a full swing; it settles with a third of the settle time as its time constant.
      if (dt > 0) {
        const rate = Math.hypot(this.yaw - y0, this.pitch - p0) / dt;
        this.unsettled = Math.min(1, this.unsettled + Math.min(1, rate / 0.05) * dt * 8) * Math.exp(-dt / (s.bag.settleS / 3));
      }
      if (Math.hypot(this.yaw - this.bagAnchorYaw, this.pitch - this.bagAnchorPitch) > s.bag.liftRad) {
        this.bagAnchorYaw = this.yaw;
        this.bagAnchorPitch = this.pitch;
        this.jolts.push({ at: t, yaw: 0.0003 * (this.n++ % 2 ? 1 : -1), pitch: 0.0007 });
      }
    }
    if (this.jolts.length && t - this.jolts[0]!.at >= 1) this.jolts = this.jolts.filter((j) => t - j.at < 1);
    let jy = 0;
    let jp = 0;
    for (const j of this.jolts) {
      const [a, b] = joltAt(j, t);
      jy += a;
      jp += b;
    }
    const sag = s.bag ? -0.0004 * this.unsettled : 0;
    return { yaw: this.yaw + jy, pitch: this.pitch + jp + sag, bagUnsettled: this.unsettled, resetting: this.jolts.length > 0 };
  }

  private resettle(t: number, size: number): void {
    this.anchorYaw = this.yaw;
    this.anchorPitch = this.pitch;
    // Each re-set lands a little differently: the jolt's sideways part alternates.
    this.jolts.push({ at: t, yaw: size * 0.4 * (this.n++ % 2 ? 1 : -1), pitch: size });
  }
}
