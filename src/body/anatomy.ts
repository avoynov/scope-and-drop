/**
 * A standing adult (about 1.70 m, 70 kg) as the wound model sees them: the body's outline and the
 * structures inside it that decide whether a bullet stops, downs or kills.
 *
 * Coordinates are metres in the body's own frame: origin on the ground between the feet, y up, z forward
 * (the way the person faces), x to the person's LEFT. Seen from the front (as a shooter facing them sees
 * them) +x is on the viewer's right, so the heart sits at small +x.
 *
 * The outline is the range mannequin's (the torso is the same lathe profile, flattened front to back, and the
 * head the same ellipsoid), so a hit on the mannequin's mesh enters this body where it hit. Landmark heights
 * are those of a 1.70 m man: shoulders 1.44, sternal notch 1.39, nipples 1.24, xiphoid 1.14, iliac crest 1.03,
 * hip joints 0.88. Organ sizes and positions follow standard adult anatomy (Gray's; CT atlases): heart about
 * 12 × 9 × 8 cm, left of the midline behind the sternum; liver under the right dome of the diaphragm reaching
 * across; spleen high on the left behind the stomach; kidneys at T12–L3 against the back; the cord in the
 * canal behind the vertebral bodies, ending at L1 (conus), the cauda equina below it.
 */

export type Vec3 = [number, number, number];

/** Ellipsoid: centre and semi-axes. */
export interface Ellipsoid { kind: 'e'; c: Vec3; r: Vec3 }
/** Capsule: segment a–b and radius. */
export interface Capsule { kind: 'c'; a: Vec3; b: Vec3; r: number }
export type Shape = Ellipsoid | Capsule;

export type Tissue =
  | 'brain' | 'brainstem' | 'cord' | 'skull' | 'face'
  | 'heart' | 'artery' | 'vein' | 'hilum' | 'lung' | 'airway'
  | 'liver' | 'spleen' | 'kidney' | 'stomach' | 'gut'
  | 'vertebra' | 'pelvis' | 'hip' | 'femur' | 'sternum' | 'rib';

/** Spinal levels, which decide what a cord injury does. */
export type CordLevel = 'C1-C4' | 'C5-T1' | 'T2-L1' | 'cauda';

export interface Part {
  id: string;
  /** What the readout calls it. */
  name: string;
  tissue: Tissue;
  shape: Shape;
  level?: CordLevel;
}

const e = (c: Vec3, r: Vec3): Ellipsoid => ({ kind: 'e', c, r });
const cap = (a: Vec3, b: Vec3, r: number): Capsule => ({ kind: 'c', a, b, r });
/** Both sides: a left one (x as given) and a right one (x mirrored). */
const pair = (id: string, name: string, tissue: Tissue, shape: (s: 1 | -1) => Shape): Part[] => [
  { id: `${id}-l`, name: `left ${name}`, tissue, shape: shape(1) },
  { id: `${id}-r`, name: `right ${name}`, tissue, shape: shape(-1) },
];

/**
 * Inside the body, most specific first: a point inside several shapes belongs to the first (the heart lies in
 * the notch between the lungs, the aorta against the spine, the cord inside the vertebrae).
 */
export const PARTS: Part[] = [
  // ---- head and neck ----
  { id: 'brainstem', name: 'brainstem', tissue: 'brainstem', shape: cap([0, 1.585, -0.012], [0, 1.528, -0.026], 0.015) },
  { id: 'cerebellum', name: 'cerebellum', tissue: 'brain', shape: e([0, 1.56, -0.05], [0.05, 0.028, 0.032]) },
  { id: 'cerebrum', name: 'brain', tissue: 'brain', shape: e([0, 1.622, 0.004], [0.066, 0.062, 0.08]) },
  { id: 'cord-c1', name: 'spinal cord (C1–C4)', tissue: 'cord', level: 'C1-C4', shape: cap([0, 1.528, -0.028], [0, 1.47, -0.03], 0.008) },
  { id: 'cord-c5', name: 'spinal cord (C5–T1)', tissue: 'cord', level: 'C5-T1', shape: cap([0, 1.47, -0.03], [0, 1.395, -0.05], 0.008) },
  ...pair('carotid', 'carotid artery', 'artery', (s) => cap([s * 0.022, 1.525, 0.012], [s * 0.026, 1.4, 0.012], 0.0045)),
  ...pair('jugular', 'jugular vein', 'vein', (s) => cap([s * 0.033, 1.525, 0.002], [s * 0.03, 1.4, 0.006], 0.007)),
  { id: 'cervical', name: 'cervical spine', tissue: 'vertebra', shape: cap([0, 1.53, -0.022], [0, 1.4, -0.038], 0.022) },
  { id: 'trachea', name: 'windpipe', tissue: 'airway', shape: cap([0, 1.515, 0.03], [0, 1.33, 0.025], 0.011) },
  { id: 'face', name: 'face and jaw', tissue: 'face', shape: e([0, 1.528, 0.045], [0.056, 0.052, 0.045]) },
  { id: 'skull', name: 'skull', tissue: 'skull', shape: e([0, 1.59, 0], [0.081, 0.114, 0.09]) },

  // ---- chest ----
  { id: 'cord-t', name: 'spinal cord (T2–L1)', tissue: 'cord', level: 'T2-L1', shape: cap([0, 1.395, -0.072], [0, 1.08, -0.078], 0.006) },
  { id: 'heart', name: 'heart', tissue: 'heart', shape: e([0.022, 1.25, 0.022], [0.058, 0.062, 0.045]) },
  { id: 'aorta-arch', name: 'aortic arch', tissue: 'artery', shape: cap([0.005, 1.29, 0.04], [0.012, 1.35, -0.01], 0.014) },
  { id: 'aorta-t', name: 'thoracic aorta', tissue: 'artery', shape: cap([0.022, 1.35, -0.035], [0.012, 1.1, -0.035], 0.013) },
  { id: 'svc', name: 'vena cava', tissue: 'vein', shape: cap([-0.028, 1.37, 0.025], [-0.024, 1.28, 0.025], 0.01) },
  ...pair('hilum', 'lung root', 'hilum', (s) => e([s * 0.058, 1.3, 0.0], [0.024, 0.032, 0.026])),
  { id: 'sternum', name: 'breastbone', tissue: 'sternum', shape: cap([0, 1.385, 0.078], [0, 1.15, 0.078], 0.012) },
  { id: 'spine-t', name: 'thoracic spine', tissue: 'vertebra', shape: cap([0, 1.395, -0.062], [0, 1.08, -0.064], 0.026) },
  ...pair('lung', 'lung', 'lung', (s) => e([s * 0.092, 1.27, -0.005], [0.072, 0.135, 0.088])),

  // ---- abdomen ----
  { id: 'aorta-a', name: 'abdominal aorta', tissue: 'artery', shape: cap([0.012, 1.1, -0.03], [0.008, 0.99, -0.015], 0.011) },
  { id: 'ivc', name: 'vena cava', tissue: 'vein', shape: cap([-0.022, 1.2, -0.012], [-0.02, 0.99, -0.018], 0.011) },
  ...pair('iliac', 'iliac artery', 'artery', (s) => cap([s * 0.008, 0.99, -0.015], [s * 0.075, 0.885, 0.03], 0.0065)),
  { id: 'cauda', name: 'cauda equina (L1–S)', tissue: 'cord', level: 'cauda', shape: cap([0, 1.08, -0.078], [0, 0.92, -0.075], 0.007) },
  { id: 'spine-l', name: 'lumbar spine', tissue: 'vertebra', shape: cap([0, 1.08, -0.06], [0, 0.97, -0.055], 0.028) },
  { id: 'spleen', name: 'spleen', tissue: 'spleen', shape: e([0.105, 1.12, -0.045], [0.03, 0.055, 0.035]) },
  ...pair('kidney', 'kidney', 'kidney', (s) => e([s * 0.065, s > 0 ? 1.065 : 1.045, -0.06], [0.03, 0.055, 0.026])),
  { id: 'liver', name: 'liver', tissue: 'liver', shape: e([-0.045, 1.115, 0.015], [0.1, 0.062, 0.075]) },
  { id: 'stomach', name: 'stomach', tissue: 'stomach', shape: e([0.06, 1.1, 0.045], [0.05, 0.05, 0.04]) },

  // ---- pelvis and legs ----
  ...pair('hipjoint', 'hip joint', 'hip', (s) => e([s * 0.092, 0.885, 0.005], [0.035, 0.035, 0.035])),
  { id: 'sacrum', name: 'sacrum', tissue: 'pelvis', shape: e([0, 0.93, -0.075], [0.05, 0.06, 0.025]) },
  { id: 'pubis', name: 'pubic bone', tissue: 'pelvis', shape: e([0, 0.875, 0.06], [0.06, 0.022, 0.02]) },
  ...pair('ilium', 'pelvic wing', 'pelvis', (s) => e([s * 0.115, 0.985, -0.02], [0.022, 0.06, 0.07])),
  { id: 'gut', name: 'intestines', tissue: 'gut', shape: e([0, 0.98, 0.025], [0.13, 0.11, 0.08]) },
  ...pair('femoral', 'femoral artery', 'artery', (s) => cap([s * 0.08, 0.86, 0.04], [s * 0.07, 0.55, 0.0], 0.004)),
  ...pair('femur', 'thigh bone', 'femur', (s) => cap([s * 0.1, 0.87, 0.0], [s * 0.085, 0.47, 0.0], 0.015)),
];

/** The mannequin's torso: lathe profile (radius, height above its base) from the hips to the neck. */
export const TORSO_PROFILE: [number, number][] = [
  [0.0, 0.0], [0.16, 0.0], [0.17, 0.08], [0.15, 0.24], [0.17, 0.4], [0.21, 0.52], [0.22, 0.58], [0.15, 0.63], [0.06, 0.66], [0.055, 0.7], [0, 0.7],
];
/** The torso's base above the ground, and how much it is flattened front to back. */
export const TORSO_BASE = 0.86;
export const TORSO_DEPTH = 0.55;
/** The head: an ellipsoid. */
export const HEAD = e([0, 1.59, 0], [0.081, 0.114, 0.09]);
/** Thighs, which the mannequin (on its stake) does not have. */
const THIGHS = [cap([0.09, 0.86, 0], [0.08, 0.47, 0], 0.075), cap([-0.09, 0.86, 0], [-0.08, 0.47, 0], 0.075)];

/** Radius of the torso at height y (0 outside it). */
export function torsoRadius(y: number): number {
  const h = y - TORSO_BASE;
  const p = TORSO_PROFILE;
  if (h < 0 || h > p[p.length - 1]![1]) return 0;
  for (let i = 1; i < p.length; i++) {
    const [r0, y0] = p[i - 1]!, [r1, y1] = p[i]!;
    if (h <= y1 && y1 > y0) return r0 + ((r1 - r0) * (h - y0)) / (y1 - y0);
  }
  return 0;
}

/** Signed distance from p to a shape's surface (negative inside). Ellipsoids are approximate off the surface. */
export function sdf(s: Shape, p: Vec3): number {
  if (s.kind === 'e') {
    const qx = (p[0] - s.c[0]) / s.r[0], qy = (p[1] - s.c[1]) / s.r[1], qz = (p[2] - s.c[2]) / s.r[2];
    return (Math.hypot(qx, qy, qz) - 1) * Math.min(s.r[0], s.r[1], s.r[2]);
  }
  const bx = s.b[0] - s.a[0], by = s.b[1] - s.a[1], bz = s.b[2] - s.a[2];
  const px = p[0] - s.a[0], py = p[1] - s.a[1], pz = p[2] - s.a[2];
  const f = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)));
  return Math.hypot(px - bx * f, py - by * f, pz - bz * f) - s.r;
}

/** Volume of a shape (m³). */
export function volume(s: Shape): number {
  if (s.kind === 'e') return (4 / 3) * Math.PI * s.r[0] * s.r[1] * s.r[2];
  const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);
  return Math.PI * s.r * s.r * len + (4 / 3) * Math.PI * s.r ** 3;
}

/** Whether p is inside the body (torso, head or thighs). */
export function inBody(p: Vec3): boolean {
  const r = torsoRadius(p[1]);
  if (r > 0 && Math.hypot(p[0], p[2] / TORSO_DEPTH) < r) return true;
  if (sdf(HEAD, p) < 0) return true;
  return THIGHS.some((t) => sdf(t, p) < 0);
}

/**
 * Ribs: twelve pairs from the spine round to the front, each about 1.5 cm wide with 2 cm between them, sloping
 * down toward the front. A point in the chest wall (the outer 2.5 cm of the torso between the sternal notch and
 * the bottom of the cage) is on a rib if it falls on one of these bands.
 */
export function onRib(p: Vec3): boolean {
  const y = p[1];
  if (y < 1.09 || y > 1.4) return false;
  const r = torsoRadius(y);
  const depth = r - Math.hypot(p[0], p[2] / TORSO_DEPTH);
  if (depth < 0 || depth > 0.025) return false;
  // The cartilage at the front lower cage (below the xiphoid, near the midline) does not count.
  if (p[2] > 0.06 && Math.abs(p[0]) < 0.06 && y < 1.15) return false;
  // Each rib drops about 6 cm from its back end to its front end.
  const phase = (y + 0.06 * Math.max(0, p[2] / (TORSO_DEPTH * r))) / 0.035;
  return phase - Math.floor(phase) < 0.43;
}
