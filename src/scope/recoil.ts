/**
 * Recoil of a scoped rifle fired prone, as the eye behind the scope sees it. No bullet is simulated:
 * this is the gun's motion only. Times in seconds, angles in radians, eye offsets in millimetres in the
 * same frame as `Eye` in optics.ts (x right, y up, z behind the exit pupil).
 *
 * Three motions overlap:
 *  1. The rifle slams back into the shoulder within ~15 ms, so the scope sits ~2 cm closer to the eye
 *     than its eye relief. The shoulder only pushes it forward again over a few tenths of a second, and
 *     until then the picture is a tunnel inside a ring of black (see eyeboxTransmission).
 *  2. The rifle rotates muzzle-up (and a little right) about the shoulder. A kick peaks ~90 ms after
 *     the shot and falls back to a smaller rise that stays: the shooter has to bring the rifle back down.
 *  3. The head rides the stock but is jolted off the cheek weld and settles back over a few tenths of a
 *     second. Until then the scope is tilted against the eye: the sight picture jumps in the eye's view
 *     and the eye drops below the exit pupil, so the picture blacks out and comes back as a crescent.
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
  /** Scope travel toward the eye at its peak, how fast it arrives and how slowly the shoulder returns it. */
  travelMm: number;
  travelOnset: number;
  travelRecover: number;
  /** Scope tube ring-down after the impulse. */
  shake: number;
  shakeHz: number;
  shakeDecay: number;
  /** The jolted head settles back onto the stock with this time constant. */
  headLag: number;
  /** Shoulder pivot to eye, along the bore: turns a tilt into an eye offset at the exit pupil. */
  pivotToEyeMm: number;
  /** After this the motion is over and the lasting rise belongs to the aim. */
  duration: number;
}

export const RECOIL = {
  svd: {
    impulseNs: 12.5, rifleKg: 4.3,
    rise: 1.4 * DEG, drift: 0.35 * DEG, kick: 2.2 * DEG, kickPeak: 0.09, riseTime: 0.03,
    travelMm: 24, travelOnset: 0.004, travelRecover: 0.45,
    shake: 0.07 * DEG, shakeHz: 26, shakeDecay: 0.05,
    headLag: 0.28, pivotToEyeMm: 120, duration: 3,
  },
  bolt: {
    impulseNs: 12.9, rifleKg: 6.8,
    rise: 0.9 * DEG, drift: 0.25 * DEG, kick: 1.4 * DEG, kickPeak: 0.1, riseTime: 0.035,
    travelMm: 17, travelOnset: 0.005, travelRecover: 0.38,
    shake: 0.05 * DEG, shakeHz: 22, shakeDecay: 0.05,
    headLag: 0.28, pivotToEyeMm: 120, duration: 3,
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

/** Arrives within about `on` seconds, dies away over `off` (≫ on), and peaks at 1. */
function surge(t: number, on: number, off: number): number {
  if (t <= 0) return 0;
  const f = (u: number) => Math.exp(-u / off) - Math.exp(-u / on);
  return f(t) / f((Math.log(off / on) * on * off) / (off - on));
}

/**
 * One step of a head that follows the rifle through the cheek weld with a first-order lag (exact for
 * any step). With no lag it is glued to the rifle.
 */
export function followHead(head: number, rifle: number, dt: number, lag: number): number {
  return lag > 0 ? head + (rifle - head) * (1 - Math.exp(-dt / lag)) : rifle;
}

function rifle(s: RecoilSpec, v: ShotVariation, t: number): [number, number] {
  if (t <= 0) return [0, 0];
  const settle = 1 - Math.exp(-t / s.riseTime);
  const kick = s.kick * v.kick * pulse(t / s.kickPeak);
  const shake = s.shake * Math.exp(-t / s.shakeDecay) * Math.sin(2 * Math.PI * s.shakeHz * t);
  const pitch = s.rise * v.rise * settle + kick + shake;
  const yaw = s.drift * v.drift * settle + 0.25 * kick * v.drift + 0.6 * shake;
  return [pitch, yaw];
}

/**
 * The head's integration for one shot, kept so each frame continues it instead of starting again from the
 * trigger: entry k is the state after k + 1 steps of 1 ms, computed in the same order with the same
 * arithmetic as a fresh loop, so a lookup is bit-identical to recomputing.
 */
interface HeadTrack {
  spec: RecoilSpec;
  dt: number;
  a: number;
  u: number;
  steps: number[];
  hp: number[];
  hy: number[];
}
const tracks = new WeakMap<ShotVariation, HeadTrack>();

/** hp, hy after the steps `for (u = dt; u <= t + 1e-9; u += dt) h += (rifle(u) − h)·a` takes, from 0. */
function headAt(s: RecoilSpec, v: ShotVariation, t: number, dt: number, a: number): [number, number] {
  let tr = tracks.get(v);
  if (!tr || tr.spec !== s || tr.dt !== dt || tr.a !== a) {
    tr = { spec: s, dt, a, u: dt, steps: [], hp: [], hy: [] };
    tracks.set(v, tr);
  }
  // Extend the track to every step the loop would take for this t.
  let hp = tr.hp.length ? tr.hp[tr.hp.length - 1]! : 0;
  let hy = tr.hy.length ? tr.hy[tr.hy.length - 1]! : 0;
  while (tr.u <= t + 1e-9) {
    const [rp, ry] = rifle(s, v, tr.u);
    hp += (rp - hp) * tr.a;
    hy += (ry - hy) * tr.a;
    tr.steps.push(tr.u);
    tr.hp.push(hp);
    tr.hy.push(hy);
    tr.u += dt;
  }
  // Steps the loop would take for this t: the u values are increasing, so binary-search the last one.
  let lo = 0;
  let hi = tr.steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tr.steps[mid]! <= t + 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? [0, 0] : [tr.hp[lo - 1]!, tr.hy[lo - 1]!];
}

/** The rifle and eye `t` seconds after the shot (t ≤ 0: before it). */
export function recoilAt(s: RecoilSpec, v: ShotVariation, t: number): RecoilState {
  const [pitch, yaw] = rifle(s, v, t);
  // Head orientation: the rifle's rotation low-passed by the cheek weld, in exact 1 ms followHead steps.
  const dt = 0.001;
  const a = 1 - Math.exp(-dt / s.headLag);
  const [hp, hy] = headAt(s, v, t, dt, a);
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
      z: -s.travelMm * surge(t, s.travelOnset, s.travelRecover),
    },
  };
}
