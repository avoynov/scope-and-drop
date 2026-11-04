/**
 * The shooter's body behind the hold: breathing they control, a heart that speeds up, muscles that tire and strain,
 * and the hands' own inertia on a swing. Angles in radians, times in seconds. Stateful: `step` once a frame with what
 * the shooter is doing, then `swayAt(t)` adds what the body does to the bore on top of the rest's hold (hold.ts).
 *
 * What it replaces in `holdAt`: the breathing figure-eight and the fixed 69 bpm heartbeat (the caller zeroes those
 * two in the hold it passes on). What it keeps: the slow postural wander, the rest's tremor and the wind's buffet.
 *
 * Sources (marksmanship manuals and sport-science papers; where none measures a number, it is a game value, said so):
 *  - Breathing: a cycle of 4–5 s with a natural respiratory pause of 2–3 s after the exhale (USMC Rifle Marksmanship,
 *    2012). The pause can be stretched; 6–8 s is the safe most before CO₂ and falling O₂ blur the vision and the
 *    muscles start to shake (NRA, Everyday Marksman). Breathing lifts a prone rifle by about 2 MOA (≈0.6 mrad) peak to
 *    peak, mostly vertical. Holding with the lungs full is steadier than breathing but shakier than at the pause.
 *  - Heart: each beat kicks a rested rifle (visible in the reticle; "shooting between beats"). The kick grows with
 *    the stroke force, taken here as (rate / rest)². A long breath hold and its gasp raise the rate; it falls back
 *    over about half a minute (biathlon recovery studies show the hold shrinking over 10–20 s as the rate drops).
 *  - Tremor: physiological tremor at 8–12 Hz, grown by fatigue, by holding against the body's natural point of aim
 *    (muscle tension), by oxygen debt and just after a swing.
 *  - Natural point of aim: prone, the body points the rifle somewhere when relaxed. A few mrad either side are taken
 *    by loading the bipod or the shoulder, which costs nothing; further off the shooter is muscling it: the shake
 *    grows and, as the muscles let go, the rifle creeps back toward where the body points. The body resettles to the
 *    new aim over several seconds (the shooter shifting their hips), which ends the strain.
 *  - Swings: turning the rifle far moves the whole body; the hands and rifle lag and overshoot a fast swing, and the
 *    hold is unsettled for a second or two after, while the body settles. Slow, small moves are clean.
 */

/** The breath cycle at rest: inhale, exhale, natural pause (s). 5 s, 12 breaths a minute. */
export const BREATH = { inhaleS: 1.7, exhaleS: 1.9, pauseS: 1.4 } as const;
/** Breathing's sway peak to peak (rad) on the lab's bipod, before the rest's breath scale: pitch, yaw. */
export const BREATH_PP: [number, number] = [0.0006, 0.00012];
/** Resting heart rate (bpm) and the heartbeat's kick at rest (rad), as the lab's old twitch. */
export const HEART = { restBpm: 66, kick: 0.00006, maxBpm: 150 } as const;
/** Physiological tremor of a trained shooter, prone, fresh and relaxed (rad, amplitude). */
export const TREMOR = 0.000015;
/** A held breath: steady this long (s), then the O₂ debt grows to its worst by `badS`; past `gaspS` the body breathes. */
export const BREATH_HOLD = { steadyS: 5, badS: 13, gaspS: 40 } as const;
/** Free give round the natural point of aim (rad) before it strains, and how far off it strains fully. */
export const NPA = {
  freeRad: 0.003,
  fullRad: 0.02,
  settleS: 6,
  creep: 0.3,
} as const;
/** The hands and rifle on a swing: a spring-damper the body drives (rad/s, damping ratio). */
export const SWING = { wn: 13, zeta: 0.6 } as const;
/** A swing this fast (rad/s) unsettles the hold fully; below `quiet` none. */
export const UNSETTLE = {
  quiet: 0.006,
  full: 0.12,
  settleS: 1.3,
  sway: 0.0005,
} as const;
/** Fatigue on the scope: builds over minutes on the weld, rests off it (s). */
export const FATIGUE = { buildS: 240, restS: 45 } as const;

export interface BodyInput {
  /** The shooter is holding their breath. */
  holdBreath: boolean;
  /** The head is down on the scope (the neck and shoulders working). */
  onScope: boolean;
}

/** What the body is doing now, for the view (vision dims with O₂ debt) and the tests. */
export interface BodyState {
  /** Lung fill 0 (out) … 1 (in). */
  lung: number;
  /** Seconds into the current breath hold, or 0. */
  heldS: number;
  /** Oxygen debt 0 … 1: tunnel vision, shaking. */
  hypoxia: number;
  /** Heart rate (bpm). */
  bpm: number;
  /** Fatigue 0 … 1. */
  fatigue: number;
  /** Strain against the natural point of aim 0 … 1. */
  tension: number;
  /** Unsettled by a swing 0 … 1. */
  unsettled: number;
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ease = (v: number, target: number, dt: number, tau: number) => v + (target - v) * (1 - Math.exp(-dt / tau));

/** Lung fill at a point `s` (s) into a breath cycle with the given phase lengths. */
export function lungAt(s: number, inhale: number, exhale: number): number {
  if (s < inhale) return 0.5 - 0.5 * Math.cos((Math.PI * s) / inhale);
  if (s < inhale + exhale) return 0.5 + 0.5 * Math.cos((Math.PI * (s - inhale)) / exhale);
  return 0;
}

export class Body {
  /** Seconds into the current breath cycle. */
  private cycleS = BREATH.inhaleS + BREATH.exhaleS;
  /** Breath depth and pace: 1 at rest, more while paying back a hold. */
  private depth = 1;
  private pace = 1;
  private heldS = 0;
  /** After a hold to the last, the body takes a couple of breaths before it can hold again. */
  private gaspUntil = -Infinity;
  private debt = 0;
  private bpm: number = HEART.restBpm;
  /** Beats since the start, for the kick's timing. */
  private beats = 0;
  private beatAt = -Infinity;
  private fatigue = 0;
  private unsettled = 0;
  private tension = 0;
  /** The swing's lag behind the hands: the rifle's bore minus where the hands send it (rad), and its rate. */
  private lag = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0 };
  /** Where the body points the rifle when relaxed (rad), and the creep toward it now. */
  private npa: { yaw: number; pitch: number } | null = null;
  private creep = { yaw: 0, pitch: 0 };
  private lung = 0;

  constructor(
    /** The rest's breath scale [yaw, pitch] and heartbeat scale (hold.ts), and its tremor floor (rad). */
    private rest: {
      breath: readonly [number, number];
      pulse: number;
      tremor: number;
    },
  ) {}

  setRest(rest: { breath: readonly [number, number]; pulse: number; tremor: number }): void {
    this.rest = rest;
  }

  /** The hands moved the aim by (dYaw, dPitch) at once: the rifle trails it on the swing. */
  push(dYaw: number, dPitch: number): void {
    this.lag.yaw -= dYaw;
    this.lag.pitch -= dPitch;
  }

  /** The rifle as the swing has it: add to where the hands aim. */
  get offset(): { yaw: number; pitch: number } {
    return {
      yaw: this.lag.yaw + this.creep.yaw,
      pitch: this.lag.pitch + this.creep.pitch,
    };
  }

  /** Settles the body at once (stills, a new rifle, a re-set position). */
  settle(yaw: number, pitch: number): void {
    this.lag = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0 };
    this.creep = { yaw: 0, pitch: 0 };
    this.npa = { yaw, pitch };
    this.unsettled = 0;
    this.tension = 0;
  }

  /** The whole rifle moved without the hands (recoil's rise, the action): the body's point of aim goes with it. */
  shift(dYaw: number, dPitch: number): void {
    if (this.npa) {
      this.npa.yaw += dYaw;
      this.npa.pitch += dPitch;
    }
  }

  private hypoxia(): number {
    return Math.max(this.debt, smooth((this.heldS - BREATH_HOLD.steadyS) / (BREATH_HOLD.badS - BREATH_HOLD.steadyS)));
  }

  /** Advances the body to `t` with the hands aiming at (yaw, pitch) (rad). */
  step(t: number, dt: number, aimYaw: number, aimPitch: number, input: BodyInput): BodyState {
    if (dt <= 0) return this.state();
    dt = Math.min(dt, 0.1);
    // Breathing: held, the lungs stay where they were; past the gasp the body takes over.
    if (this.heldS >= BREATH_HOLD.gaspS) this.gaspUntil = t + 2 * (BREATH.inhaleS + BREATH.exhaleS + BREATH.pauseS);
    const holding = input.holdBreath && this.heldS < BREATH_HOLD.gaspS && t >= this.gaspUntil;
    if (holding) {
      this.heldS += dt;
      // The debt that outlasts the hold, for the gasp and the heart.
      this.debt = Math.max(this.debt, 0.6 * smooth((this.heldS - BREATH_HOLD.steadyS) / (BREATH_HOLD.badS * 2 - BREATH_HOLD.steadyS)));
    } else {
      if (this.heldS > 0) {
        // Let go: the next breath comes at once, deeper and quicker for a while, by how long it was held.
        const over = Math.max(0, this.heldS - BREATH_HOLD.steadyS) / (BREATH_HOLD.badS - BREATH_HOLD.steadyS);
        this.depth = Math.max(this.depth, 1 + Math.min(1.6, 0.4 + 0.8 * over));
        this.pace = Math.max(this.pace, 1 + Math.min(0.8, 0.2 + 0.4 * over));
        if (this.lung < 0.5) this.cycleS = 0;
        this.heldS = 0;
        // Held right at the pause there is no gasp: a short hold leaves the rhythm as it was.
        if (over <= 0) {
          this.depth = Math.min(this.depth, 1.15);
          this.pace = Math.min(this.pace, 1.1);
        }
      }
      this.depth = ease(this.depth, 1, dt, 9);
      this.pace = ease(this.pace, 1, dt, 9);
      this.debt = ease(this.debt, 0, dt, 6);
      const cycle = (BREATH.inhaleS + BREATH.exhaleS + BREATH.pauseS) / this.pace;
      this.cycleS = (this.cycleS + dt) % cycle;
      this.lung = lungAt(this.cycleS * this.pace, BREATH.inhaleS, BREATH.exhaleS);
    }
    // The heart: up with the O₂ debt and the work of a swing, back down over about half a minute.
    const hyp = this.hypoxia();
    const target = HEART.restBpm + 40 * hyp + 30 * this.debt + 18 * this.unsettled;
    this.bpm = Math.min(HEART.maxBpm, ease(this.bpm, target, dt, target > this.bpm ? 6 : 25));
    const beatsBefore = Math.floor(this.beats);
    this.beats += (this.bpm / 60) * dt;
    if (Math.floor(this.beats) > beatsBefore) this.beatAt = t - ((this.beats % 1) * 60) / this.bpm;
    // Fatigue: the neck and shoulders on the weld; breath holds take it out of the shooter too.
    this.fatigue = input.onScope ? Math.min(1, this.fatigue + (dt / FATIGUE.buildS) * (1 + 2 * hyp)) : this.fatigue * Math.exp(-dt / FATIGUE.restS);
    // The swing: the rifle trails the hands as a damped spring, so a fast swing lags and overshoots.
    const l = this.lag;
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      l.vYaw += (-SWING.wn * SWING.wn * l.yaw - 2 * SWING.zeta * SWING.wn * l.vYaw) * h;
      l.vPitch += (-SWING.wn * SWING.wn * l.pitch - 2 * SWING.zeta * SWING.wn * l.vPitch) * h;
      l.yaw += l.vYaw * h;
      l.pitch += l.vPitch * h;
    }
    // How fast the bore swings, from the hands and the lag together.
    const boreYaw = aimYaw + l.yaw;
    const borePitch = aimPitch + l.pitch;
    if (!this.npa) this.npa = { yaw: boreYaw, pitch: borePitch };
    const rate = this.lastBore ? Math.hypot(boreYaw - this.lastBore.yaw, borePitch - this.lastBore.pitch) / dt : 0;
    this.lastBore = { yaw: boreYaw, pitch: borePitch };
    const kick = smooth((rate - UNSETTLE.quiet) / (UNSETTLE.full - UNSETTLE.quiet));
    this.unsettled = Math.min(1, Math.max(this.unsettled * Math.exp(-dt / UNSETTLE.settleS), kick));
    // The natural point of aim: the body resettles under the aim, and while it is off the muscles hold it there.
    const offY = boreYaw - this.npa.yaw;
    const offP = borePitch - this.npa.pitch;
    const off = Math.hypot(offY, offP);
    this.tension = smooth((off - NPA.freeRad) / (NPA.fullRad - NPA.freeRad));
    // A swing in progress moves the body with it; held still the hips shift under it over a few seconds.
    const follow = 1 - Math.exp(-dt / (NPA.settleS / (1 + 4 * kick)));
    this.npa.yaw += offY * follow;
    this.npa.pitch += offP * follow;
    // As the strained muscles give, the rifle creeps back toward where the body points.
    const k = off > 0 ? (NPA.creep * this.tension * Math.max(0, off - NPA.freeRad)) / off : 0;
    this.creep.yaw = ease(this.creep.yaw, -offY * k, dt, 1.5);
    this.creep.pitch = ease(this.creep.pitch, -offP * k, dt, 1.5);
    return this.state();
  }
  private lastBore: { yaw: number; pitch: number } | null = null;

  state(): BodyState {
    return {
      lung: this.lung,
      heldS: this.heldS,
      hypoxia: this.hypoxia(),
      bpm: this.bpm,
      fatigue: this.fatigue,
      tension: this.tension,
      unsettled: this.unsettled,
    };
  }

  /**
   * What the body does to the bore at `t` (for a `t` at or a moment past the last step): breathing, the heartbeat,
   * tremor and the swing's unsettled wobble. [yaw, pitch], yaw positive to the left.
   */
  swayAt(t: number): [number, number] {
    const r = this.rest;
    // Breathing: the chest lifts the stock, so the muzzle dips and the reticle rides up and down; held, it stays put.
    // Held with full lungs is a strain: it shakes a little more (below).
    // At the natural pause (lungs out) the bore is where the hands put it; each breath lifts it off that and back.
    const b = this.lung * this.depth;
    let yaw = BREATH_PP[1] * r.breath[0] * b;
    let pitch = -BREATH_PP[0] * r.breath[1] * b;
    // The heartbeat's kick, stronger as it beats harder.
    const sinceBeat = t - this.beatAt;
    const beat = sinceBeat >= 0 && sinceBeat < 0.6 ? Math.exp(-sinceBeat * 18 * (this.bpm / HEART.restBpm) ** 0.5) : 0;
    const force = (this.bpm / HEART.restBpm) ** 2;
    pitch -= HEART.kick * r.pulse * force * beat;
    yaw += 0.25 * HEART.kick * r.pulse * force * beat;
    // Tremor at 8–12 Hz, a little drift of strain under it.
    const hyp = this.hypoxia();
    const fullLung = this.heldS > 0 ? 0.6 * this.lung : 0;
    const grow = 1 + 1.5 * this.fatigue + 3 * this.tension + 4 * hyp + 2.5 * this.unsettled + fullLung;
    const tr = (TREMOR + r.tremor) * grow;
    yaw += tr * (0.5 * Math.sin(t * 53.4 + 0.3) + 0.3 * Math.sin(t * 64.9 + 2.1) + 0.2 * Math.sin(t * 75.1 + 4));
    pitch += tr * (0.5 * Math.sin(t * 57.2 + 1.2) + 0.3 * Math.sin(t * 68.3 + 0.7) + 0.2 * Math.sin(t * 79.6 + 2.6));
    const strain = 0.00008 * (this.tension + 1.5 * hyp + 0.5 * this.fatigue);
    yaw += strain * (0.6 * Math.sin(t * 6.1 + 0.9) + 0.4 * Math.sin(t * 9.7 + 2.2));
    pitch += strain * (0.6 * Math.sin(t * 7.3 + 1.7) + 0.4 * Math.sin(t * 11.3 + 0.4));
    // Just after a swing the body wobbles as it settles, at 1–3 Hz.
    const u = UNSETTLE.sway * this.unsettled;
    yaw += u * (0.6 * Math.sin(t * 8.2 + 0.4) + 0.4 * Math.sin(t * 15.1 + 1.9));
    pitch += u * (0.6 * Math.sin(t * 9.4 + 2.8) + 0.4 * Math.sin(t * 17.3 + 0.2));
    return [yaw, pitch];
  }
}

/**
 * The mouse, pointer-locked on the scope: an angle per count that grows with how fast the hand moves. Slow, the
 * hand is loading the bipod or the shoulder and the rifle moves a fraction of a mrad per count, the same at any
 * magnification (so more zoom shows every twitch bigger); fast, the whole body turns. `sens` scales both.
 * Returns radians for `px` counts moved at `pxPerS`.
 */
export const MOUSE = {
  fineRad: 0.00002,
  speedPx: 500,
  power: 1.2,
  maxGain: 60,
} as const;
export function mouseAngle(px: number, pxPerS: number, sens = 1): number {
  const gain = Math.min(MOUSE.maxGain, 1 + (Math.max(0, pxPerS) / MOUSE.speedPx) ** MOUSE.power);
  return px * MOUSE.fineRad * gain * sens;
}
