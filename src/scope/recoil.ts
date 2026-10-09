/**
 * Recoil of a scoped rifle fired prone, as the eye behind the scope sees it. No bullet is simulated:
 * this is the gun's motion only. Times in seconds, angles in radians, eye offsets in millimetres in the
 * same frame as `Eye` in optics.ts (x right, y up, z behind the exit pupil).
 *
 * Three motions overlap:
 *  1. The rifle rotates muzzle-up (and a little right) about the shoulder. A fast kick peaks ~70 ms after
 *     the shot and falls back to a smaller rise that stays: the shooter has to bring the rifle back down.
 *  2. It slides back into the shoulder, so for a few tens of milliseconds the scope sits ~2 cm closer
 *     to the eye than its eye relief, then springs forward a little past it. Too close shrinks the
 *     visible field to a tunnel with a ring of black (see eyeboxTransmission).
 *  3. The head rides the stock but lags the rifle. Until it catches up, the scope is tilted against the
 *     eye: the sight picture jumps in the eye's view and the eye drops below the exit pupil.
 *
 * Free recoil (SAAMI: powder gas leaves at 1.75 × muzzle velocity):
 *  - SVD, 7N1: 9.8 g × 823 + 3.1 g × 1440 ≈ 12.5 N·s into 4.3 kg → 2.9 m/s, 18 J.
 *  - Bolt rifle, M118LR: 11.3 g × 790 + 2.9 g × 1380 ≈ 12.9 N·s into 6.8 kg → 1.9 m/s, 12 J.
 * The lighter SVD kicks harder, so its numbers below are larger.
 */

const DEG = Math.PI / 180;

export interface RecoilSpec {
  /** Free recoil, for the record (impulse N·s, rifle kg). */
  impulseNs: number;
  rifleKg: number;
  /** Muzzle rise and drift right that remain once the rifle settles. */
  rise: number;
  drift: number;
  /** Extra transient rise on top, and when it peaks. */
  kick: number;
  kickPeak: number;
  /** How fast the lasting rise builds. */
  riseTime: number;
  /** Scope travel toward the eye at its peak, when, and the forward rebound after. */
  travelMm: number;
  travelPeak: number;
  reboundMm: number;
  reboundPeak: number;
  /** Scope tube ring-down after the impulse. */
  shake: number;
  shakeHz: number;
  shakeDecay: number;
  /** The head follows the stock with this time constant. */
  headLag: number;
  /** Shoulder pivot to eye, along the bore: turns a tilt into an eye offset at the exit pupil. */
  pivotToEyeMm: number;
  /** After this the motion is over and the lasting rise belongs to the aim. */
  duration: number;
}

export const RECOIL = {
  svd: {
    impulseNs: 12.5, rifleKg: 4.3,
    rise: 1.4 * DEG, drift: 0.35 * DEG, kick: 2.2 * DEG, kickPeak: 0.07, riseTime: 0.03,
    travelMm: 24, travelPeak: 0.016, reboundMm: 5, reboundPeak: 0.15,
    shake: 0.07 * DEG, shakeHz: 26, shakeDecay: 0.05,
    headLag: 0.12, pivotToEyeMm: 120, duration: 1.6,
  },
  bolt: {
    impulseNs: 12.9, rifleKg: 6.8,
    rise: 0.9 * DEG, drift: 0.25 * DEG, kick: 1.4 * DEG, kickPeak: 0.075, riseTime: 0.035,
    travelMm: 17, travelPeak: 0.018, reboundMm: 4, reboundPeak: 0.16,
    shake: 0.05 * DEG, shakeHz: 22, shakeDecay: 0.05,
    headLag: 0.12, pivotToEyeMm: 120, duration: 1.6,
  },
} as const satisfies Record<string, RecoilSpec>;

/** Shot-to-shot spread: no two shots kick the same way. */
export interface ShotVariation {
  rise: number;
  drift: number;
  kick: number;
}

/** Deterministic variation for the n-th shot (±20 % rise, ±50 % drift, ±15 % kick). */
export function shotVariation(n: number): ShotVariation {
  const r = (k: number) => {
    let h = Math.imul(n + 1, 0x27d4eb2d) ^ Math.imul(k + 7, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return { rise: 0.8 + 0.4 * r(1), drift: 0.5 + r(2), kick: 0.85 + 0.3 * r(3) };
}

export interface RecoilState {
  /** Rifle rotation from where it was aimed: up and right. */
  pitch: number;
  yaw: number;
  /** Scope axis relative to the head's line of sight: up and right. */
  tiltPitch: number;
  tiltYaw: number;
  /** Eye offset from the exit pupil caused by the recoil (mm). */
  eye: { x: number; y: number; z: number };
}

/** x·e^(1−x): rises to 1 at x = 1 and dies away. */
const pulse = (x: number) => (x <= 0 ? 0 : x * Math.exp(1 - x));

function rifle(s: RecoilSpec, v: ShotVariation, t: number): [number, number] {
  if (t <= 0) return [0, 0];
  const settle = 1 - Math.exp(-t / s.riseTime);
  const kick = s.kick * v.kick * pulse(t / s.kickPeak);
  const shake = s.shake * Math.exp(-t / s.shakeDecay) * Math.sin(2 * Math.PI * s.shakeHz * t);
  const pitch = s.rise * v.rise * settle + kick + shake;
  const yaw = s.drift * v.drift * settle + 0.25 * kick * v.drift + 0.6 * shake;
  return [pitch, yaw];
}

/** The rifle and eye `t` seconds after the shot (t ≤ 0: before it). */
export function recoilAt(s: RecoilSpec, v: ShotVariation, t: number): RecoilState {
  const [pitch, yaw] = rifle(s, v, t);
  // Head orientation: the rifle's rotation low-passed by the cheek weld (exact exponential steps).
  let hp = 0;
  let hy = 0;
  const dt = 0.001;
  const a = 1 - Math.exp(-dt / s.headLag);
  for (let u = dt; u <= t + 1e-9; u += dt) {
    const [rp, ry] = rifle(s, v, u);
    hp += (rp - hp) * a;
    hy += (ry - hy) * a;
  }
  const tiltPitch = pitch - hp;
  const tiltYaw = yaw - hy;
  return {
    pitch,
    yaw,
    tiltPitch,
    tiltYaw,
    eye: {
      // The ocular swings up and right about the shoulder faster than the head follows.
      x: -s.pivotToEyeMm * tiltYaw,
      y: -s.pivotToEyeMm * tiltPitch,
      z: -s.travelMm * pulse(t / s.travelPeak) + s.reboundMm * pulse(t / s.reboundPeak),
    },
  };
}
