/**
 * Working the action by hand, prone: the bolt rifle's bolt, and magazine changes on all three rifles.
 *
 * A hand that leaves the grip takes the head off the scope with it: the shooter lifts the head (see ads.ts,
 * scope-out), glances down at the action, works it, looks back downrange and has to settle onto the cheek weld
 * again to aim. Everything here is a function of the time since the hands started, so stills are exact:
 *  - the rifle's moving parts: the bolt (lift, travel), the AK-type bolt carrier and its charging handle, the
 *    magazines (in the well, rocked or dropped, or in a hand), the spent case flying out of the port and the
 *    next round being stripped into the chamber;
 *  - the hands: each reaches for a point on the rifle (a minimum-jerk stroke, Flash & Hogan 1985) and then
 *    rides with it, so a hand on the bolt knob follows the knob as the bolt swings up and slides back;
 *  - where the eye looks and what it focuses on, and how far the head moves off its head-up spot;
 *  - sound cues at the moments the parts move and stop (audio.ts plays them).
 *
 * Two things the shooter does, each on its own key: work the action ('cycle') and change the magazine
 * ('reload'). Neither does the other's job, so a fresh magazine still needs the action worked to chamber a round.
 *  - Bolt rifle (M24 class, detachable 5-round box). Cycle: lift the handle 90° (this cocks the striker), pull
 *    the bolt back (the extractor pulls whatever is in the chamber and the ejector flicks it out of the port to
 *    the right), push it forward (the bolt face strips the top round out of the magazine and pushes it into
 *    the chamber, if there is one) and turn it down. Reload: the box out and a full one in, bolt untouched.
 *  - SVD (hammer fired). Cycle: the charging handle pulled fully back and let go; the carrier throws out
 *    whatever was chambered and strips the next round. After the last round the empty magazine's follower lifts
 *    the bolt stop, which holds the carrier back; the bolt pressing on it keeps it up when the magazine comes
 *    out, so it stays open until the handle is pulled back again (SVD manual, §33). Reload: the old magazine
 *    rocked out, the new one in front lug first and rocked back until the catch clicks.
 *  - VSS (striker fired): as the SVD, but with no bolt stop found in any source, the carrier shuts on an empty
 *    chamber after the last round, striker cocked.
 *
 * Frame: the scope's, as in near.ts and ads.ts, in millimetres: x right, y up, z toward the shooter (−z is
 * downrange), origin at the exit pupil. Times in seconds from when the hands start. Angles in radians.
 */
import { HEAD_UP } from './ads';
import type { RifleId } from './shot';

export type V3 = [number, number, number];
/** Unit quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];
export interface Frame {
  p: V3;
  q: Quat;
}
export type HandlingKind = 'cycle' | 'reload';
export type Side = 'R' | 'L';

// ---- small vector and quaternion helpers ----
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const qId: Quat = [0, 0, 0, 1];
export function qMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export function qRot(q: Quat, v: V3): V3 {
  const u: V3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}
export function qAxis(axis: V3, angle: number): Quat {
  const a = norm(axis);
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}
export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb: Quat = d < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  d = Math.abs(d);
  let k0 = 1 - t;
  let k1 = t;
  if (d < 0.9995) {
    const th = Math.acos(d);
    const s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = Math.sin(t * th) / s;
  }
  const q: Quat = [a[0] * k0 + bb[0] * k1, a[1] * k0 + bb[1] * k1, a[2] * k0 + bb[2] * k1, a[3] * k0 + bb[3] * k1];
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
/**
 * The orientation of a hand whose fingers (straightened) point along `fwd` and whose palm faces `palm`. The
 * hand's own frame has the fingers along −z and the palm facing −y, the thumb on −x for a right hand.
 */
export function qBasis(fwd: V3, palm: V3): Quat {
  const z = scale(norm(fwd), -1);
  const pn = norm(palm);
  const y = norm(sub(scale(pn, -1), scale(z, dot(scale(pn, -1), z))));
  const x = cross(y, z);
  // Rotation matrix with columns x, y, z → quaternion.
  const [m00, m10, m20] = x;
  const [m01, m11, m21] = y;
  const [m02, m12, m22] = z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
export const compose = (a: Frame, b: Frame): Frame => ({ p: add(a.p, qRot(a.q, b.p)), q: qMul(a.q, b.q) });
export const invert = (a: Frame): Frame => {
  const q = qConj(a.q);
  return { p: scale(qRot(q, a.p), -1), q };
};

// ---- the hand ----

/**
 * A gloved hand, in its own frame (mm): wrist at the origin, fingers along −z, palm facing −y, thumb on −x
 * (a right hand; the left is its mirror image). Knuckle positions and phalanx lengths are an adult man's,
 * thickened by a shooting glove.
 */
export const HAND = {
  palm: { width: 84, thick: 30, length: 98 },
  /** Index, middle, ring, little: knuckle (x, z), the three phalanx lengths and the finger radius. */
  fingers: [
    { x: -27, z: -97, len: [44, 26, 21], r: 10.2 },
    { x: -8.5, z: -100, len: [49, 30, 23], r: 10.5 },
    { x: 9.5, z: -96, len: [46, 28, 22], r: 10 },
    { x: 26, z: -88, len: [36, 21, 19], r: 9 },
  ],
  thumb: { base: [-30, -6, -22] as V3, len: [44, 32, 27], r: 10.8 },
} as const;

/**
 * Joint angles: for each finger the flexion at its three joints, and for the thumb [opposition (swinging it
 * across under the palm toward the fingers), flexion at its knuckle, flexion at its last joint]. 0 is a flat hand.
 */
export interface FingerPose {
  f: number[];
  t: number[];
}
export type HandPose = 'relaxed' | 'grip' | 'pinch' | 'hook' | 'mag' | 'press' | 'open';
const fp = (f: number[][], t: number[]): FingerPose => ({ f: f.flat(), t });
export const POSES: Record<HandPose, FingerPose> = {
  relaxed: fp([[0.3, 0.45, 0.25], [0.35, 0.5, 0.3], [0.42, 0.55, 0.3], [0.48, 0.6, 0.35]], [0.25, 0.25, 0.2]),
  // Round the pistol grip, the index finger on the trigger.
  grip: fp([[0.55, 0.9, 0.5], [1.25, 1.5, 0.8], [1.3, 1.5, 0.8], [1.35, 1.45, 0.8]], [0.8, 0.3, 0.3]),
  // The bolt knob inside the bent index and middle fingers, the thumb over it.
  pinch: fp([[0.85, 1.15, 0.7], [1.05, 1.3, 0.8], [1.3, 1.55, 0.9], [1.4, 1.55, 0.9]], [0.9, 0.25, 0.3]),
  // Two fingers hooked in front of the charging handle.
  hook: fp([[0.75, 1.5, 1.0], [0.8, 1.55, 1.0], [1.0, 1.5, 0.9], [1.1, 1.5, 0.9]], [0.35, 0.25, 0.2]),
  // Fingers flat along a magazine's side, curled round its front edge.
  mag: fp([[0.15, 1.3, 0.6], [0.15, 1.35, 0.6], [0.2, 1.35, 0.6], [0.25, 1.3, 0.6]], [0.85, 0.15, 0.15]),
  // The index finger straight, pressing the magazine catch.
  press: fp([[0.15, 0.15, 0.1], [1.2, 1.5, 0.8], [1.25, 1.5, 0.8], [1.3, 1.45, 0.8]], [0.75, 0.3, 0.3]),
  open: fp([[0.12, 0.15, 0.1], [0.12, 0.15, 0.1], [0.14, 0.15, 0.1], [0.16, 0.18, 0.1]], [0.1, 0.05, 0.05]),
};
/** Where the held thing sits in the hand's frame, for each pose (mm). */
export const GRASP: Record<HandPose, V3> = {
  relaxed: [0, -30, -80],
  grip: [-2, -30, -90],
  pinch: [-20, -38, -104],
  hook: [-18, -30, -108],
  mag: [-4, -27, -95],
  press: [-32, -22, -188],
  open: [0, -30, -80],
};
function blendPose(a: FingerPose, b: FingerPose, t: number): FingerPose {
  return { f: a.f.map((v, i) => v + (b.f[i]! - v) * t), t: a.t.map((v, i) => v + (b.t[i]! - v) * t) };
}

// ---- the rifles' actions ----

export interface MagGeom {
  /** Front-top corner of the magazine, at the lug or the catch, where it sits in the well. */
  pivot: V3;
  /** Width (x), height (y, downward from the pivot) and length (z, back from the pivot). */
  size: V3;
  /** Forward cant of the magazine in the well (bottom forward). */
  tilt: number;
  rounds: number;
  /** The cartridge: case length, case diameter, overall length (mm). */
  cartridge: { caseLen: number; dia: number; oal: number };
}
export interface BoltGeom {
  /** Bolt axis height (the bore). */
  axisY: number;
  bodyR: number;
  /** Bolt face and rear of the bolt body with the bolt closed, and how far back it travels. */
  faceZ: number;
  rearZ: number;
  stroke: number;
  /** The handle: its root on the bolt, length to the knob centre, angle closed (from +x toward +y), lift. */
  rootZ: number;
  handleLen: number;
  closedRad: number;
  liftRad: number;
  /** How far the handle sweeps back from root to knob. */
  sweep: number;
  knobR: number;
  /** The ejection port's middle, where the case leaves. */
  port: V3;
}
export interface CarrierGeom {
  /** The charging handle's knob, carrier forward. */
  knob: V3;
  stroke: number;
  /** Whether the empty magazine holds the carrier back after the last round (SVD). */
  holdOpen: boolean;
}
export interface ActionGeom {
  boreY: number;
  trigger: V3;
  /** Where the right hand holds the grip. */
  grip: V3;
  release: V3;
  mag: MagGeom;
  bolt?: BoltGeom;
  carrier?: CarrierGeom;
}

const DEG = Math.PI / 180;
const CART_308 = { caseLen: 51.2, dia: 11.9, oal: 71 };
export const ACTIONS: Record<RifleId, ActionGeom> = {
  // M24 class: round receiver, the bolt handle over the grip, a 5-round box ahead of the trigger guard. The
  // handle closes 35° below level and lifts 90°, so the knob clears the eyepiece bell on its way back.
  bolt: {
    boreY: -58,
    trigger: [0, -118, -255],
    grip: [0, -145, -198],
    release: [0, -128, -293],
    mag: { pivot: [0, -84, -392], size: [24, 96, 92], tilt: 0, rounds: 5, cartridge: CART_308 },
    bolt: {
      axisY: -58, bodyR: 9.5, faceZ: -405, rearZ: -205, stroke: 100,
      rootZ: -214, handleLen: 66, closedRad: -35 * DEG, liftRad: 90 * DEG, sweep: 15, knobR: 9.5,
      port: [14, -50, -335],
    },
  },
  // SVD: the charging handle rides at the front of the receiver's right side; 125 mm of carrier travel.
  svd: {
    boreY: -70,
    trigger: [0, -122, -270],
    grip: [0, -150, -205],
    release: [0, -113, -312],
    mag: { pivot: [0, -100, -420], size: [28, 125, 100], tilt: 0.1, rounds: 10, cartridge: { caseLen: 53.6, dia: 12.4, oal: 77 } },
    carrier: { knob: [25, -64, -398], stroke: 125, holdOpen: true },
  },
  // VSS: a short milled receiver with the charging handle at its rear right; the 9×39 needs only 85 mm.
  vss: {
    boreY: -70,
    trigger: [0, -116, -260],
    grip: [0, -148, -205],
    release: [0, -106, -300],
    mag: { pivot: [0, -96, -372], size: [25, 92, 64], tilt: 0.05, rounds: 10, cartridge: { caseLen: 39, dia: 11.3, oal: 56 } },
    carrier: { knob: [22, -66, -300], stroke: 85, holdOpen: false },
  },
};

/** The bolt knob's centre for a lift (0…1) and travel (0…1). */
export function knobAt(b: BoltGeom, lift: number, travel: number): V3 {
  const a = b.closedRad + b.liftRad * lift;
  return [b.handleLen * Math.cos(a), b.axisY + b.handleLen * Math.sin(a), b.rootZ + b.sweep + b.stroke * travel];
}
/** The magazine's frame (origin at its front-top pivot) dropped `drop` mm along itself and rocked `rock` forward. */
export function magFrame(m: MagGeom, drop: number, rock: number): Frame {
  const q = qAxis([1, 0, 0], m.tilt + rock);
  return { p: add(m.pivot, qRot(q, [0, -drop, 0])), q };
}

// ---- plans ----

type Channel = 'boltLift' | 'boltTravel' | 'carrier' | 'oldDrop' | 'oldRock' | 'newDrop' | 'newRock' | 'headX' | 'headY' | 'headZ' | 'gazeYaw' | 'gazePitch' | 'invF';
type Ease = 'mj' | 'push' | 'spring' | 'fall' | 'lin';
interface ChMove { t0: number; T: number; to: number; ease: Ease }
type Get = (c: Channel) => number;
/** Where a hand is going, as a frame for the held point (see GRASP), from the parts' state at that moment. */
type Anchor = (c: Get) => Frame;
interface HandMove { t0: number; T: number; anchor: Anchor; pose: HandPose; via: V3 }
type MagMode = 'well' | Side | 'gone';
interface MagTrack { events: { t: number; mode: MagMode }[]; rounds: { t: number; n: number }[]; grasp: Frame }

export type SoundEvent =
  | 'bolt-up' | 'bolt-back' | 'bolt-forward' | 'bolt-down'
  | 'case-land'
  | 'mag-release' | 'mag-out' | 'mag-in'
  | 'charge-back' | 'charge-release'
  // The trigger pulled with nothing to fire: the hammer or striker falling on an empty chamber, or a dead trigger.
  | 'dry-fire' | 'trigger';
export interface Cue {
  t: number;
  ev: SoundEvent;
}

export interface Plan {
  rifle: RifleId;
  kind: HandlingKind;
  dur: number;
  ch: Map<Channel, ChMove[]>;
  init: Record<Channel, number>;
  hands: Record<Side, { init: Anchor; pose: HandPose; moves: HandMove[] }>;
  mags: [MagTrack, MagTrack];
  /** When a spent case leaves the port. */
  ejects: number[];
  /** Bolt rifle: forward strokes that strip a round into the chamber, [start, end]. */
  feeds: [number, number][];
  cues: Cue[];
}

const minJerk = (s: number) => s * s * s * (10 - 15 * s + 6 * s * s);
const EASE: Record<Ease, (s: number) => number> = {
  mj: minJerk,
  // Driven by the hand into a stop: speeding up to the end.
  push: (s) => s * s * (2 - s),
  // Let go against a compressed spring: accelerating all the way to the slam.
  spring: (s) => 1 - Math.cos((Math.PI / 2) * s),
  fall: (s) => s * s,
  lin: (s) => s,
};
const clamp01 = (s: number) => Math.max(0, Math.min(1, s));

/** Deterministic 0…1 values per handling, so no two bolt cycles are quite the same. */
function rnd(seed: number, k: number): number {
  let h = Math.imul(seed + 101, 0x27d4eb2d) ^ Math.imul(k + 7, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const at = (p: V3, fwd: V3, palm: V3): Frame => ({ p, q: qBasis(fwd, palm) });
/** Gaze angles (yaw right, pitch up) and focus (1/m) for looking at `target` from the head-up eye moved by `head`. */
function look(target: V3, head: V3): { yaw: number; pitch: number; invF: number } {
  const eye: V3 = [HEAD_UP.x + head[0], HEAD_UP.y + head[1], HEAD_UP.z + head[2]];
  const d = sub(target, eye);
  return { yaw: Math.atan2(d[0], -d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])), invF: 1000 / len(d) };
}

/** Hand frames at rest and the stations they visit off the rifle, shared by every rifle. */
// The magazine pouches are on the belt under the chest; the elbow tucks back to reach them.
const POUCH_R = at([215, -330, 110], [-0.28, -0.16, -0.95], [-0.87, -0.38, 0.32]);
const POUCH_L = at([-225, -320, 70], [0.28, -0.16, -0.95], [0.87, -0.38, 0.32]);
/** The support hand on the rear bag under the butt, out of sight. */
const REST_L = at([-25, -185, 150], [0.3, 0.55, -0.78], [0.2, 0.75, 0.6]);

/** What is in the chamber: a round, a fired case (the bolt rifle, until its bolt is worked) or nothing. */
export type Chamber = 'live' | 'spent' | 'empty';
export interface HandlingState {
  /** What the cycle pulls out of the chamber and throws clear. Default: a fired case on the bolt rifle, else nothing. */
  chamber?: Chamber;
  /** The SVD's carrier held open by its bolt stop. Default: on a magazine change with the magazine empty. */
  held?: boolean;
}

/**
 * The plan for working the action of `rifle` ('cycle': the bolt, or the charging handle) or changing its
 * magazine ('reload'). `rounds` is what is left in the magazine in the rifle; `seed` varies the timing a little
 * from one to the next.
 */
export function planHandling(rifle: RifleId, kind: HandlingKind, rounds: number, seed = 0, state: HandlingState = {}): Plan {
  const g = ACTIONS[rifle];
  const r = (k: number) => rnd(seed, k);
  // A practised shooter's pace varies by some ±6 % from one time to the next.
  const k = 0.94 + 0.12 * r(0);
  const ch = new Map<Channel, ChMove[]>();
  const init: Record<Channel, number> = { boltLift: 0, boltTravel: 0, carrier: 0, oldDrop: 0, oldRock: 0, newDrop: 0, newRock: 0, headX: 0, headY: 0, headZ: 0, gazeYaw: 0, gazePitch: 0, invF: 0 };
  const cues: Cue[] = [];
  const ejects: number[] = [];
  const feeds: [number, number][] = [];
  const mv = (c: Channel, t0: number, T: number, to: number, ease: Ease = 'mj') => {
    if (!ch.has(c)) ch.set(c, []);
    ch.get(c)!.push({ t0: t0 * k, T: T * k, to, ease });
  };
  const cue = (t: number, ev: SoundEvent) => cues.push({ t: t * k, ev });
  const hands: Plan['hands'] = {
    R: { init: () => at(g.grip, [-0.3, -0.12, -0.95], [-0.95, -0.05, 0.3]), pose: 'grip', moves: [] },
    L: { init: () => REST_L, pose: 'relaxed', moves: [] },
  };
  const hand = (s: Side, t0: number, T: number, anchor: Anchor, pose: HandPose, via: V3 = [0, 0, 0]) =>
    hands[s].moves.push({ t0: t0 * k, T: T * k, anchor, pose, via });
  let head: V3 = [0, 0, 0];
  const headTo = (t0: number, T: number, to: V3) => {
    mv('headX', t0, T, to[0]);
    mv('headY', t0, T, to[1]);
    mv('headZ', t0, T, to[2]);
    head = to;
  };
  // The eyes jump (a saccade) and the head turns after them; focusing near takes a little longer.
  const gaze = (t0: number, target: V3 | null) => {
    const l = target ? look(target, head) : { yaw: 0, pitch: 0, invF: 0 };
    mv('gazeYaw', t0, 0.26, l.yaw);
    mv('gazePitch', t0, 0.26, l.pitch);
    mv('invF', t0 + 0.04, 0.34, l.invF);
  };
  const grip = hands.R.init;
  const mags: [MagTrack, MagTrack] = [
    { events: [{ t: 0, mode: 'well' }], rounds: [{ t: 0, n: rounds }], grasp: { p: [0, 0, 0], q: qId } },
    { events: [{ t: 0, mode: 'gone' }], rounds: [{ t: 0, n: g.mag.rounds }], grasp: { p: [0, 0, 0], q: qId } },
  ];
  const magEvent = (i: 0 | 1, t: number, mode: MagMode) => mags[i].events.push({ t: t * k, mode });
  const magRounds = (i: 0 | 1, t: number, n: number) => mags[i].rounds.push({ t: t * k, n });
  const m = g.mag;
  /** The hand's frame on a magazine dropped and rocked so, for whichever hand holds it. */
  const onMag = (i: 0 | 1, drop: number | Channel, rock: number | Channel): Anchor => (c) =>
    compose(magFrame(m, typeof drop === 'number' ? drop : c(drop), typeof rock === 'number' ? rock : c(rock)), mags[i].grasp);

  if (g.bolt) {
    const b = g.bolt;
    // Pinching the knob from below and behind on the right, palm toward the rifle, thumb on top; the wrist rolls
    // a quarter as far as the handle as it lifts.
    const knobQ = qBasis([-0.45, 0.2, -0.87], [-0.8, -0.45, 0.35]);
    const knob: Anchor = (c) => {
      const lift = c('boltLift');
      return { p: knobAt(b, lift, c('boltTravel')), q: qMul(qAxis([0, 0, 1], b.liftRad * lift * 0.25), knobQ) };
    };
    const knobView: V3 = [44, -72, -175];
    const out = state.chamber ?? 'spent';
    const open = (t: number) => {
      hand('R', t, 0.3, knob, 'pinch', [18, 22, 0]);
      mv('boltLift', t + 0.3, 0.1, 1);
      cue(t + 0.3, 'bolt-up');
      mv('boltTravel', t + 0.42, 0.17, 1);
      cue(t + 0.42, 'bolt-back');
      if (out === 'empty') return;
      ejects.push((t + 0.56) * k);
      // The case (or an unfired round) tumbles out to the right and lands in the dirt a metre away.
      cue(t + 0.56 + 0.42 + 0.06 * r(3), 'case-land');
    };
    const close = (t: number, mag: 0 | 1, n: number) => {
      mv('boltTravel', t, 0.18, 0, 'push');
      cue(t, 'bolt-forward');
      if (n > 0) {
        feeds.push([t * k, (t + 0.18) * k]);
        // Once the top round is on its way the next one rises into the lips under it.
        magRounds(mag, t + 0.07, n - 1);
      }
      mv('boltLift', t + 0.2, 0.08, 0, 'push');
      cue(t + 0.2, 'bolt-down');
    };
    // Gripping the protruding box from the right, palm on its side, fingers round its front.
    mags[0].grasp = mags[1].grasp = at([0, -64, 46], [0, 0.35, -0.94], [-1, 0, 0]);
    if (kind === 'cycle') {
      headTo(0.1, 0.4, [38 + 8 * r(1), 30, 28]);
      gaze(0.12, knobView);
      open(0);
      close(0.66, 0, rounds);
      hand('R', 0.96, 0.32, grip, 'grip', [10, 15, 0]);
      gaze(0.98, null);
      headTo(1.0, 0.4, [0, 0, 0]);
      return finish(1.42);
    }
    // The magazine catch: a paddle in front of the trigger guard, pressed with the index finger. The head comes
    // over to the right to see under the stock.
    headTo(0.05, 0.45, [105, -5, 30]);
    gaze(0.1, [24, -130, -330]);
    hand('R', 0.1, 0.3, () => at(g.release, [-0.25, 0.45, -0.86], [-0.92, -0.3, 0.1]), 'press', [30, -10, 0]);
    cue(0.4, 'mag-release');
    mv('oldDrop', 0.41, 0.07, 22, 'fall');
    cue(0.43, 'mag-out');
    hand('R', 0.48, 0.16, onMag(0, 22, 0), 'mag', [12, -8, 0]);
    magEvent(0, 0.64, 'R');
    hand('R', 0.66, 0.5, () => POUCH_R, 'mag', [30, -40, 0]);
    magEvent(0, 1.16, 'gone');
    magEvent(1, 1.43, 'R');
    hand('R', 1.46, 0.55, onMag(1, 42, 0), 'mag', [40, -50, 0]);
    hand('R', 2.03, 0.15, onMag(1, 0, 0), 'mag');
    cue(2.03, 'mag-in');
    magEvent(1, 2.18, 'well');
    hand('R', 2.22, 0.32, grip, 'grip', [10, 15, 0]);
    gaze(2.24, null);
    headTo(2.27, 0.45, [0, 0, 0]);
    return finish(2.74);
  }

  // SVD and VSS: the support hand changes the magazine by its body, thumb on the catch; the firing hand then
  // comes off the grip to rack the charging handle.
  const c = g.carrier!;
  const held = state.held ?? (kind === 'reload' && c.holdOpen && rounds === 0);
  if (held) init.carrier = 1;
  // Fingers hooked in front of the knob from the right, palm toward the receiver.
  const knobFrame: Anchor = (cc) => at([c.knob[0], c.knob[1], c.knob[2] + c.stroke * cc('carrier')], [-0.3, -0.25, -0.92], [-0.95, -0.15, 0.28]);
  const knobView: V3 = [c.knob[0] + 5, c.knob[1] - 10, c.knob[2] + 50];
  const off = at([c.knob[0] + 22, c.knob[1] + 8, c.knob[2] + c.stroke + 18], [-0.3, -0.25, -0.92], [-0.95, -0.15, 0.28]);
  if (kind === 'cycle') {
    // The firing hand comes off the grip, hooks the knob and pulls it fully back against the spring.
    headTo(0.05, 0.4, [55, 25, 20]);
    gaze(0.1, knobView);
    hand('R', 0.05, 0.34, knobFrame, 'hook', [30, 25, 0]);
    mv('carrier', 0.42, 0.16, 1);
    if (!held) cue(0.42, 'charge-back');
    // Whatever was chambered comes out of the port and lands in the dirt to the right.
    if (state.chamber === 'live') cue(0.58 + 0.4 + 0.06 * r(3), 'case-land');
    if (c.holdOpen && rounds === 0) {
      // Let go over an empty magazine: its follower has the bolt stop up, and that catches the carrier.
      if (!held) cue(0.62, 'mag-release');
    } else {
      // Let go at the back: the spring drives the carrier home, stripping the top round into the chamber.
      mv('carrier', 0.6, 0.045, 0, 'spring');
      cue(0.6, 'charge-release');
      if (rounds > 0) magRounds(0, 0.64, rounds - 1);
    }
    hand('R', 0.6, 0.12, () => off, 'open');
    hand('R', 0.74, 0.34, grip, 'grip', [10, 15, 0]);
    gaze(0.76, null);
    headTo(0.79, 0.45, [0, 0, 0]);
    return finish(1.26);
  }
  mags[0].grasp = mags[1].grasp = at([0, -72, m.size[2] / 2], [0.1, 0.3, -0.95], [1, 0, 0]);
  const magView: V3 = [14, -150, m.pivot[2] + m.size[2] / 2];
  // Rolled a little onto the left side, the head comes over to the right to see under the receiver.
  headTo(0.05, 0.5, [105, -8, 30]);
  gaze(0.14, magView);
  hand('L', 0, 0.42, onMag(0, 0, 0), 'mag', [-30, -20, 0]);
  cue(0.42, 'mag-release');
  // Rocked forward off the catch about its front lug, then down off the lug.
  mv('oldRock', 0.44, 0.13, 0.42);
  cue(0.44, 'mag-out');
  // A carrier held open stays open: the bolt stop keeps it until the charging handle is pulled again.
  hand('L', 0.44, 0.13, onMag(0, 0, 'oldRock'), 'mag');
  mv('oldDrop', 0.6, 0.14, 34);
  hand('L', 0.6, 0.14, onMag(0, 'oldDrop', 0.42), 'mag');
  magEvent(0, 0.74, 'L');
  hand('L', 0.76, 0.5, () => POUCH_L, 'mag', [-30, -40, 0]);
  magEvent(0, 1.26, 'gone');
  magEvent(1, 1.5, 'L');
  // Front lug first, tilted forward, then rocked back until the catch snaps over.
  hand('L', 1.52, 0.55, onMag(1, 22, 0.42), 'mag', [-40, -50, 0]);
  hand('L', 2.07, 0.12, onMag(1, 0, 0.42), 'mag');
  cue(2.07, 'mag-in');
  hand('L', 2.19, 0.13, onMag(1, 0, 0), 'mag');
  magEvent(1, 2.32, 'well');
  hand('L', 2.36, 0.5, () => REST_L, 'relaxed', [-20, -40, 0]);
  gaze(2.36, null);
  headTo(2.4, 0.45, [0, 0, 0]);
  return finish(2.9);

  function finish(dur: number): Plan {
    cues.sort((a, b) => a.t - b.t);
    return { rifle, kind, dur: dur * k, ch, init, hands, mags, ejects, feeds, cues };
  }
}

// ---- evaluating a plan ----

export interface HandState {
  wrist: Frame;
  pose: FingerPose;
  /** Where the forearm's sleeve starts, the elbow and the shoulder (mm). */
  arm: { wrist: V3; elbow: V3; shoulder: V3 };
}

/**
 * Shoulder joints, prone with the cheek on the stock (mm): the butt in the pocket inside the right shoulder, the
 * eye some 20 cm ahead of the joints. And the bones' lengths.
 */
export const SHOULDER: Record<Side, V3> = { R: [150, -180, 230], L: [-180, -185, 215] };
export const UPPER_ARM = 300;
export const FOREARM = 262;
/** How far a shoulder rolls forward (the shoulder blade sliding round the ribs) to reach past the arm's length. */
export const PROTRACT = 130;
/** The way each elbow points: out to the side, down to the ground and a little back. */
const POLE: Record<Side, V3> = { R: [1, -0.9, 0.4], L: [-1, -0.9, 0.4] };
/**
 * Two-bone arm: the elbow sits where both bones reach from the wrist and the shoulder, bent toward the pole. A
 * hand reaching further than the arm is long brings the shoulder forward after it.
 */
function armOf(wrist: Frame, s: Side): HandState['arm'] {
  const w = add(wrist.p, qRot(wrist.q, [0, 0, 48]));
  const reach = UPPER_ARM + FOREARM - 1;
  const S0 = SHOULDER[s];
  const S = add(S0, scale(norm(sub(w, S0)), Math.min(PROTRACT, Math.max(0, len(sub(w, S0)) - reach))));
  const ax = sub(w, S);
  const d = Math.min(len(ax), reach);
  const a = norm(ax);
  const along = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - along * along));
  const pole = norm(POLE[s]);
  const b = norm(sub(pole, scale(a, dot(pole, a))));
  return { wrist: w, elbow: add(add(S, scale(a, along)), scale(b, h)), shoulder: S };
}
/** How far the wrist is bent: the angle between the forearm and the back of the hand's long axis (rad). */
export function wristBend(h: HandState): number {
  const fore = norm(sub(h.arm.wrist, h.arm.elbow));
  const hand = qRot(h.wrist.q, [0, 0, -1]);
  return Math.acos(Math.max(-1, Math.min(1, dot(fore, hand))));
}
export interface MagState {
  frame: Frame;
  visible: boolean;
  /** Rounds in it, for the top round showing at its lips. */
  rounds: number;
}
export interface HandlingPose {
  /** Head offset from its head-up spot (mm), gaze (yaw right, pitch up) and the eye's focus (1/m; 0 = far). */
  head: V3;
  gaze: { yaw: number; pitch: number };
  invF: number;
  bolt: { lift: number; travel: number };
  carrier: number;
  mags: [MagState, MagState];
  hands: Record<Side, HandState>;
  /** Spent cases in the air. */
  cases: Frame[];
  /** A round being stripped into the chamber: the frame of its case head, cartridge along −z. */
  feed: Frame | null;
}

function channel(plan: Plan, c: Channel, t: number): number {
  let v = plan.init[c];
  // Moves on one channel follow each other: each starts from where the last one ended.
  for (const m of plan.ch.get(c) ?? []) {
    if (t < m.t0) break;
    if (t < m.t0 + m.T) return v + (m.to - v) * EASE[m.ease]((t - m.t0) / m.T);
    v = m.to;
  }
  return v;
}

/** The held point in a hand's own frame: the left hand is the right one mirrored across its x. */
export function graspOf(pose: HandPose, s: Side): V3 {
  const g = GRASP[pose];
  return s === 'L' ? [-g[0], g[1], g[2]] : g;
}
function wristOf(a: Frame, pose: HandPose, s: Side): Frame {
  return { q: a.q, p: sub(a.p, qRot(a.q, graspOf(pose, s))) };
}

function handAt(plan: Plan, s: Side, t: number): HandState {
  const h = plan.hands[s];
  const get = (u: number): Get => (c) => channel(plan, c, u);
  let i = -1;
  while (i + 1 < h.moves.length && h.moves[i + 1]!.t0 <= t) i++;
  if (i < 0) {
    const wrist = wristOf(h.init(get(t)), h.pose, s);
    return { wrist, pose: POSES[h.pose], arm: armOf(wrist, s) };
  }
  const m = h.moves[i]!;
  const prev = i > 0 ? h.moves[i - 1]! : null;
  const fromPose = prev ? prev.pose : h.pose;
  const from = wristOf((prev ? prev.anchor : h.init)(get(m.t0)), fromPose, s);
  const to = wristOf(m.anchor(get(t)), m.pose, s);
  const s01 = clamp01((t - m.t0) / m.T);
  const b = minJerk(s01);
  // The hand clears the rifle on its way: an arc out along `via`, greatest mid-move.
  const p = add(lerp3(from.p, to.p, b), scale(m.via, Math.sin(Math.PI * s01)));
  // The fingers shape for the grasp on the way in and close as the hand arrives.
  const pose = blendPose(POSES[fromPose], POSES[m.pose], minJerk(clamp01(s01 * 1.15)));
  const wrist = { p, q: qSlerp(from.q, to.q, b) };
  return { wrist, pose, arm: armOf(wrist, s) };
}

/** The state of everything at `t` seconds into the plan. */
export function poseAt(plan: Plan, t: number): HandlingPose {
  const g = ACTIONS[plan.rifle];
  const c = (x: Channel) => channel(plan, x, t);
  const hands = { R: handAt(plan, 'R', t), L: handAt(plan, 'L', t) };
  const mags = plan.mags.map((track, i) => {
    let mode: MagMode = 'gone';
    for (const e of track.events) if (e.t <= t) mode = e.mode;
    let rounds = 0;
    for (const e of track.rounds) if (e.t <= t) rounds = e.n;
    let frame: Frame;
    if (mode === 'L' || mode === 'R') {
      const hs = hands[mode];
      frame = compose(compose(hs.wrist, { p: graspOf('mag', mode), q: qId }), invert(track.grasp));
    } else {
      frame = i === 0 ? magFrame(g.mag, c('oldDrop'), c('oldRock')) : magFrame(g.mag, c('newDrop'), c('newRock'));
    }
    return { frame, visible: mode !== 'gone', rounds };
  }) as [MagState, MagState];
  const cases: Frame[] = [];
  for (const te of plan.ejects) {
    const a = t - te;
    if (a < 0 || a > 0.7 || !g.bolt) continue;
    // Flicked out to the right and a little up and back, tumbling end over end.
    const v: V3 = [3100, 1300, 700];
    const p = add(add(g.bolt.port, scale(v, a)), [0, -0.5 * 9810 * a * a, 0]);
    cases.push({ p, q: qMul(qAxis([0.25, 1, 0.3], 2 * Math.PI * 14 * a), qAxis([0, 1, 0], 0.4)) });
  }
  let feed: Frame | null = null;
  if (g.bolt) {
    const b = g.bolt;
    for (const [t0, t1] of plan.feeds) {
      if (t < t0 || t >= t1) continue;
      const face = b.faceZ + b.stroke * c('boltTravel');
      // The top round's head sits just ahead of the open bolt face; the face picks it up and drives it up the
      // feed ramp into the chamber over the first 35 mm.
      const rest = b.faceZ + b.stroke - 7;
      const head = Math.min(rest, face);
      const pushed = clamp01((rest - head) / 35);
      const cart = g.mag.cartridge;
      const yTop = g.mag.pivot[1] - cart.dia / 2 - 1;
      const y = yTop + (b.axisY - yTop) * minJerk(pushed);
      // Nose up while it climbs the ramp.
      feed = { p: [0, y, head], q: qAxis([1, 0, 0], 0.14 * Math.sin(Math.PI * pushed)) };
    }
  }
  return {
    head: [c('headX'), c('headY'), c('headZ')],
    gaze: { yaw: c('gazeYaw'), pitch: c('gazePitch') },
    invF: c('invF'),
    bolt: { lift: c('boltLift'), travel: c('boltTravel') },
    carrier: c('carrier'),
    mags,
    hands,
    cases,
    feed,
  };
}

/** The rifle at rest, hands where they live: the firing hand on the grip, the support hand under the butt. */
export function restPose(rifle: RifleId, rounds: number, carrierOpen = false): HandlingPose {
  const plan = planHandling(rifle, rifle === 'bolt' ? 'cycle' : 'reload', rounds);
  const p = poseAt(plan, 0);
  p.carrier = carrierOpen ? 1 : 0;
  p.mags[1].visible = false;
  return p;
}
