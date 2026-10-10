/**
 * A standing adult (about 1.70 m, 70 kg) as the wound model sees them: the body's outline and the
 * structures inside it that decide whether a bullet stops, downs or kills.
 *
 * Coordinates are metres in the body's own frame: origin on the ground between the feet, y up, z forward
 * (the way the person faces), x to the person's LEFT. Seen from the front (as a shooter facing them sees
 * them) +x is on the viewer's right, so the heart sits at small +x.
 *
 * The outline is the range mannequin's (the scene builds its torso and head from TORSO_PROFILE and HEAD), so a
 * hit on the mannequin's mesh enters this body where it hit. Its depth front to back follows a lean man's
 * (anthropometric surveys scaled to 1.70 m): chest about 22 cm deep at the nipples, 20 cm at the waist, 23 cm
 * at the buttocks, a neck 11–12 cm deep, a head 15 cm wide and 19.5 cm long.
 *
 * Landmark heights (stature fractions from anthropometric surveys, vertebral levels from surface anatomy):
 *  - skull base (foramen magnum) 1.555, C3/C4 1.505, C7/T1 1.455, sternal notch 1.39 (T2/T3), nipples 1.24,
 *    xiphisternal joint 1.19, T12/L1 1.165, L1/L2 1.13 (transpyloric plane, where the cord ends: the conus lies
 *    at L1 in most adults, T12–L2 in nearly all), iliac crests 1.03 (L4), hip joints 0.895, pubis 0.885.
 *  - Heart behind the sternum from the 3rd costal cartilage to the 6th, its right border 1–2 cm past the
 *    sternum's right edge, its apex in the left 5th intercostal space 8–9 cm from the midline; it sits on the
 *    diaphragm and against the descending aorta behind. Those are the lying-down (textbook and CT) figures.
 *    Standing, the diaphragm sits lower (the lungs hold 0.5–1 L more at rest) and the heart, slung from it by the
 *    pericardium, hangs about 1 cm lower and more upright (upright CT: its axis turns down and back), the apex
 *    1.5 cm lower, at the 6th rib.
 *  - Diaphragm domes, standing: right ≈1.23 (the 5th rib lying down), left a little lower. The liver fills the
 *    right dome and reaches across to the left; spleen under the left 9th–11th ribs at the back; kidneys T12–L3
 *    against the back (the right one lower), 4–5 cm under the skin; stomach under the left dome behind the
 *    liver's left lobe.
 *  - The cord lies 5–6 cm under the skin of the back (as epidural needle depths show), behind vertebral bodies
 *    about 3 cm deep and in front of the laminae and spinous processes.
 *
 * Shapes overlap freely: a point belongs to the first structure in PARTS that contains it (`classify`), so the
 * heart carves its notch out of the lungs, the liver and spleen their domes out of the lungs' bases, the cord
 * its canal out of nothing. Damage is counted the same way, so nothing is counted twice.
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

/**
 * Spinal cord levels by what an injury there does: C1–C4 takes the diaphragm (breathing stops), C5–T1 the arms
 * and everything below, T2–L1 the legs (the cord's lumbar and sacral segments lie at vertebrae T11–L1), and
 * below L1/L2 only the cauda equina's nerve roots run.
 */
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

/** The head: an ellipsoid 15.2 cm wide, 22.8 cm from crown to chin, 19.4 cm long. */
export const HEAD = e([0, 1.59, 0], [0.076, 0.114, 0.097]);

/**
 * The spinal canal's centre line (height, depth): it follows the neck's lordosis, the thoracic kyphosis and the
 * lumbar lordosis, 5–6 cm under the skin of the back.
 */
const CANAL: [number, number][] = [
  [1.555, -0.024], [1.505, -0.021], [1.455, -0.036], [1.3, -0.058], [1.165, -0.052], [1.13, -0.05], [0.985, -0.048], [0.95, -0.072],
];
const canal = (i: number, dz = 0): Vec3 => [0, CANAL[i]![0], CANAL[i]![1] + dz];

/**
 * Inside the body, most specific first: a point inside several shapes belongs to the first.
 */
export const PARTS: Part[] = [
  // ---- head and neck ----
  { id: 'brainstem', name: 'brainstem', tissue: 'brainstem', shape: cap([0, 1.605, -0.004], [0, 1.557, -0.022], 0.012) },
  { id: 'cerebellum', name: 'cerebellum', tissue: 'brain', shape: e([0, 1.565, -0.055], [0.048, 0.028, 0.028]) },
  // The ventricles, thalami and basal ganglia: a track through them is the deadliest kind of head wound.
  { id: 'deep', name: 'deep brain and ventricles', tissue: 'brain', shape: e([0, 1.625, -0.008], [0.025, 0.025, 0.035]) },
  ...pair('orbit', 'eye socket', 'face', (s) => e([s * 0.032, 1.592, 0.07], [0.018, 0.017, 0.023])),
  { id: 'cerebrum', name: 'brain', tissue: 'brain', shape: e([0, 1.632, -0.002], [0.064, 0.056, 0.077]) },
  { id: 'cord-c1', name: 'spinal cord (C1–C4)', tissue: 'cord', level: 'C1-C4', shape: cap(canal(0), canal(1), 0.0055) },
  { id: 'cord-c5', name: 'spinal cord (C5–T1)', tissue: 'cord', level: 'C5-T1', shape: cap(canal(1), canal(2), 0.0055) },
  ...pair('vertebral', 'vertebral artery', 'artery', (s) => cap([s * 0.023, 1.455, -0.012], [s * 0.022, 1.545, -0.006], 0.002)),
  ...pair('carotid', 'carotid artery', 'artery', (s) => cap([s * 0.022, 1.405, 0.02], [s * 0.026, 1.535, 0.006], 0.0045)),
  ...pair('jugular', 'jugular vein', 'vein', (s) => cap([s * 0.036, 1.53, 0.002], [s * 0.033, 1.405, 0.014], 0.007)),
  { id: 'cervical', name: 'cervical spine', tissue: 'vertebra', shape: cap([0, 1.545, -0.0085], [0, 1.455, -0.0205], 0.0085) },
  { id: 'cervical-arch', name: 'cervical spine', tissue: 'vertebra', shape: cap([0, 1.545, -0.042], [0, 1.455, -0.0565], 0.011) },
  { id: 'larynx', name: 'larynx', tissue: 'airway', shape: cap([0, 1.505, 0.03], [0, 1.455, 0.029], 0.014) },
  { id: 'trachea', name: 'windpipe', tissue: 'airway', shape: cap([0, 1.455, 0.026], [0, 1.335, 0.008], 0.009) },
  { id: 'face', name: 'face and jaw', tissue: 'face', shape: e([0, 1.53, 0.05], [0.05, 0.055, 0.045]) },
  // Only the shell of bone round the brain counts as skull; the scalp and the nape below it are soft (classify).
  { id: 'skull', name: 'skull', tissue: 'skull', shape: HEAD },

  // ---- chest ----
  { id: 'cord-t', name: 'spinal cord (T2–L1)', tissue: 'cord', level: 'T2-L1', shape: cap(canal(2), canal(3), 0.0045) },
  { id: 'cord-t2', name: 'spinal cord (T2–L1)', tissue: 'cord', level: 'T2-L1', shape: cap(canal(3), canal(5), 0.0045) },
  { id: 'aorta-asc', name: 'ascending aorta', tissue: 'artery', shape: cap([0.005, 1.295, 0.045], [0.008, 1.365, 0.04], 0.0145) },
  { id: 'aorta-arch', name: 'aortic arch', tissue: 'artery', shape: cap([0.008, 1.365, 0.04], [0.024, 1.375, -0.008], 0.013) },
  { id: 'aorta-t', name: 'thoracic aorta', tissue: 'artery', shape: cap([0.024, 1.375, -0.008], [0.006, 1.17, -0.001], 0.012) },
  { id: 'pulmonary', name: 'pulmonary trunk', tissue: 'artery', shape: cap([0.018, 1.3, 0.07], [0.012, 1.345, 0.035], 0.012) },
  { id: 'svc', name: 'vena cava', tissue: 'vein', shape: cap([-0.027, 1.39, 0.042], [-0.025, 1.3, 0.045], 0.01) },
  ...pair('subclavian', 'subclavian artery', 'artery', (s) => cap([s * 0.02, 1.405, 0.025], [s * 0.16, 1.395, 0.03], 0.004)),
  ...pair('clavicle', 'collarbone', 'rib', (s) => cap([s * 0.02, 1.395, 0.08], [s * 0.17, 1.43, 0.03], 0.008)),
  // The heart lies obliquely, its apex down, left and forward: the base and ventricles, and the apex. Standing,
  // it hangs a centimetre lower than the lying-down textbook figures and more upright, its apex lower still.
  { id: 'heart', name: 'heart', tissue: 'heart', shape: e([0.012, 1.248, 0.04], [0.055, 0.055, 0.043]) },
  { id: 'heart-apex', name: 'heart', tissue: 'heart', shape: e([0.058, 1.2, 0.046], [0.035, 0.03, 0.032]) },
  { id: 'hilum-l', name: 'left lung root', tissue: 'hilum', shape: e([0.058, 1.315, 0.005], [0.02, 0.03, 0.025]) },
  { id: 'hilum-r', name: 'right lung root', tissue: 'hilum', shape: e([-0.055, 1.3, 0.008], [0.02, 0.03, 0.025]) },
  { id: 'manubrium', name: 'breastbone', tissue: 'sternum', shape: e([0, 1.36, 0.083], [0.025, 0.025, 0.007]) },
  { id: 'sternum', name: 'breastbone', tissue: 'sternum', shape: e([0, 1.25, 0.093], [0.016, 0.085, 0.007]) },
  { id: 'spine-t', name: 'thoracic spine', tissue: 'vertebra', shape: cap(canal(2, 0.0215), canal(3, 0.0215), 0.014) },
  { id: 'spine-t2', name: 'thoracic spine', tissue: 'vertebra', shape: cap(canal(3, 0.0215), canal(4, 0.0215), 0.014) },
  { id: 'spine-t-arch', name: 'thoracic spine', tissue: 'vertebra', shape: cap(canal(2, -0.0205), canal(3, -0.0205), 0.013) },
  { id: 'spine-t2-arch', name: 'thoracic spine', tissue: 'vertebra', shape: cap(canal(3, -0.0205), canal(4, -0.0205), 0.013) },

  // ---- abdomen ----
  { id: 'aorta-a', name: 'abdominal aorta', tissue: 'artery', shape: cap([0.006, 1.17, -0.001], [0.01, 1.03, 0.016], 0.01) },
  { id: 'ivc', name: 'vena cava', tissue: 'vein', shape: cap([-0.022, 1.205, 0.012], [-0.02, 1.0, 0.008], 0.011) },
  ...pair('iliac', 'iliac artery', 'artery', (s) => cap([s * 0.01, 1.03, 0.016], [s * 0.04, 0.985, 0.005], 0.0055)),
  ...pair('ext-iliac', 'iliac artery', 'artery', (s) => cap([s * 0.04, 0.985, 0.005], [s * 0.07, 0.9, 0.062], 0.0045)),
  ...pair('femoral', 'femoral artery', 'artery', (s) => cap([s * 0.07, 0.9, 0.062], [s * 0.06, 0.56, -0.005], 0.0045)),
  { id: 'cauda', name: 'cauda equina (L1–S)', tissue: 'cord', level: 'cauda', shape: cap(canal(5), canal(6), 0.007) },
  { id: 'cauda-s', name: 'cauda equina (L1–S)', tissue: 'cord', level: 'cauda', shape: cap(canal(6), canal(7), 0.005) },
  { id: 'spine-l', name: 'lumbar spine', tissue: 'vertebra', shape: cap([0, 1.165, -0.025], [0, 0.985, -0.019], 0.018) },
  { id: 'spine-l-arch', name: 'lumbar spine', tissue: 'vertebra', shape: cap([0, 1.165, -0.076], [0, 0.985, -0.072], 0.015) },
  ...pair('kidney', 'kidney', 'kidney', (s) => e([s * 0.07, s > 0 ? 1.12 : 1.105, -0.027], [0.028, 0.055, 0.019])),
  { id: 'spleen', name: 'spleen', tissue: 'spleen', shape: e([0.105, 1.175, -0.045], [0.025, 0.05, 0.032]) },
  { id: 'liver', name: 'liver', tissue: 'liver', shape: e([-0.07, 1.16, 0], [0.068, 0.072, 0.065]) },
  { id: 'liver-left', name: 'liver', tissue: 'liver', shape: e([0.02, 1.17, 0.05], [0.065, 0.04, 0.035]) },
  { id: 'stomach', name: 'stomach', tissue: 'stomach', shape: e([0.065, 1.155, 0.03], [0.045, 0.055, 0.035]) },
  // The lungs fill what the heart, great vessels, liver, spleen and stomach leave of each half of the chest.
  ...pair('lung', 'lung', 'lung', (s) => e([s * 0.085, 1.295, -0.005], [0.063, 0.145, 0.08])),

  // ---- pelvis and legs ----
  ...pair('hipjoint', 'hip joint', 'hip', (s) => e([s * 0.09, 0.895, 0.005], [0.03, 0.03, 0.03])),
  ...pair('femur-neck', 'thigh bone', 'femur', (s) => cap([s * 0.09, 0.895, 0.005], [s * 0.12, 0.875, -0.005], 0.015)),
  ...pair('femur', 'thigh bone', 'femur', (s) => cap([s * 0.12, 0.875, -0.005], [s * 0.075, 0.49, 0.005], 0.014)),
  { id: 'sacrum', name: 'sacrum', tissue: 'pelvis', shape: cap([0, 0.98, -0.045], [0, 0.885, -0.085], 0.022) },
  { id: 'pubis', name: 'pubic bone', tissue: 'pelvis', shape: e([0, 0.885, 0.065], [0.06, 0.02, 0.018]) },
  ...pair('ilium', 'pelvic wing', 'pelvis', (s) => e([s * 0.12, 0.975, 0.025], [0.011, 0.05, 0.045])),
  ...pair('ilium-back', 'pelvic wing', 'pelvis', (s) => e([s * 0.075, 0.965, -0.06], [0.028, 0.045, 0.022])),
  { id: 'gut', name: 'intestines', tissue: 'gut', shape: e([0, 1.0, 0.03], [0.125, 0.11, 0.07]) },
];

/**
 * The mannequin's torso: a lathe profile (radius, height above its base, depth front to back as a share of
 * the width) from the hips to the neck. The depth makes the cross-section an ellipse: deep at the hips and
 * chest, shallower at the waist, flat across the shoulders and round at the neck.
 */
export const TORSO_PROFILE: [number, number, number][] = [
  [0.0, 0.0, 0.72], [0.16, 0.0, 0.72], [0.17, 0.08, 0.68], [0.15, 0.24, 0.65], [0.17, 0.4, 0.66], [0.21, 0.52, 0.45],
  [0.22, 0.58, 0.36], [0.15, 0.63, 0.38], [0.06, 0.66, 0.95], [0.055, 0.7, 0.95], [0, 0.7, 0.95],
];
/** The torso's base above the ground. */
export const TORSO_BASE = 0.86;
/** Thighs, which the mannequin (on its stake) does not have. */
const THIGHS = [cap([0.09, 0.86, 0], [0.08, 0.47, 0], 0.075), cap([-0.09, 0.86, 0], [-0.08, 0.47, 0], 0.075)];

/** The torso at height y: half its width and its depth as a share of the width ([0, 0] outside it). */
function torsoAt(y: number): [number, number] {
  const h = y - TORSO_BASE;
  const p = TORSO_PROFILE;
  if (h < 0 || h > p[p.length - 1]![1]) return [0, 0];
  for (let i = 1; i < p.length; i++) {
    const [r0, y0, f0] = p[i - 1]!, [r1, y1, f1] = p[i]!;
    if (h <= y1 && y1 > y0) {
      const t = (h - y0) / (y1 - y0);
      return [r0 + (r1 - r0) * t, f0 + (f1 - f0) * t];
    }
  }
  return [0, 0];
}
/** Half-width of the torso at height y (0 outside it). */
export const torsoRadius = (y: number): number => torsoAt(y)[0];
/** Depth of the torso at height y as a share of its width. */
export const torsoDepth = (y: number): number => torsoAt(y)[1];

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
  const [r, f] = torsoAt(p[1]);
  if (r > 0 && Math.hypot(p[0], p[2] / f) < r) return true;
  if (sdf(HEAD, p) < 0) return true;
  return THIGHS.some((t) => sdf(t, p) < 0);
}

const BRAIN_PARTS = PARTS.filter((p) => p.tissue === 'brain' || p.tissue === 'brainstem');
/** The skull's bone: 8 mm round the brain (bone and meninges), inside the head. */
const SKULL_BONE_M = 0.008;

/**
 * What lies at p: the first structure that contains it, or null for muscle, fat and skin. Inside the head, only
 * the shell of bone round the brain is skull; the scalp and the muscles of the nape below the occiput are soft.
 */
export function classify(p: Vec3): Part | null {
  for (const part of PARTS) {
    if (sdf(part.shape, p) >= 0) continue;
    if (part.tissue !== 'skull') return part;
    let m = Infinity;
    for (const b of BRAIN_PARTS) m = Math.min(m, sdf(b.shape, p));
    return m < SKULL_BONE_M ? part : null;
  }
  return null;
}

const effective = new Map<Part, number>();
/**
 * A structure's own volume (m³): the part of its shape that is inside the body and not claimed by a structure
 * before it. Counted on a grid once and kept.
 */
export function partVolume(part: Part): number {
  const known = effective.get(part);
  if (known !== undefined) return known;
  const s = part.shape;
  const lo: Vec3 = s.kind === 'e' ? [s.c[0] - s.r[0], s.c[1] - s.r[1], s.c[2] - s.r[2]]
    : [Math.min(s.a[0], s.b[0]) - s.r, Math.min(s.a[1], s.b[1]) - s.r, Math.min(s.a[2], s.b[2]) - s.r];
  const hi: Vec3 = s.kind === 'e' ? [s.c[0] + s.r[0], s.c[1] + s.r[1], s.c[2] + s.r[2]]
    : [Math.max(s.a[0], s.b[0]) + s.r, Math.max(s.a[1], s.b[1]) + s.r, Math.max(s.a[2], s.b[2]) + s.r];
  const thin = s.kind === 'e' ? Math.min(...s.r) : s.r;
  const h = Math.max(0.001, Math.min(0.006, thin / 4));
  let n = 0;
  for (let x = lo[0] + h / 2; x < hi[0]; x += h)
    for (let y = lo[1] + h / 2; y < hi[1]; y += h)
      for (let z = lo[2] + h / 2; z < hi[2]; z += h) {
        const q: Vec3 = [x, y, z];
        if (sdf(s, q) < 0 && inBody(q) && classify(q) === part) n++;
      }
  // Never zero: a structure wholly hidden by others still divides cleanly.
  const v = Math.max(n * h * h * h, 0.01 * volume(s));
  effective.set(part, v);
  return v;
}

/**
 * Ribs: twelve pairs from the spine round to the front, each about 1.5 cm wide with 2 cm between them,
 * sloping down 8 cm from back to front, about 1 cm thick under 1.2 cm of skin and muscle (4 cm beside the
 * spine, under the long back muscles). They run from the first rib (T1 behind, under the collarbone in front)
 * to the 12th behind and the costal margin at the side; beside the sternum and across the front of the lower
 * cage they are cartilage, which does not count.
 */
export function onRib(p: Vec3): boolean {
  const [x, y, z] = p;
  const [r, f] = torsoAt(y);
  if (r <= 0) return false;
  const d = r * f;
  const rho = Math.hypot(x / r, z / d);
  if (rho >= 1 || rho < 0.3) return false;
  const depth = (Math.hypot(x, z) * (1 - rho)) / rho;
  const back = z < 0 ? Math.max(0, 1 - Math.abs(x) / 0.08) : 0;
  const d0 = 0.012 + 0.03 * back;
  if (depth < d0 || depth > d0 + 0.011) return false;
  if (z < 0 && Math.abs(x) < 0.025) return false;
  if (z > 0 && Math.abs(x) < 0.045) return false;
  if (z > 0.04 && Math.abs(x) < 0.09 && y < 1.19) return false;
  // Round the body from the back (0) to the front (1).
  const a = Math.max(0, Math.min(1, (z / d + 1) / 2));
  const top = 1.45 - 0.08 * a;
  const bottom = a < 0.5 ? 1.15 - 0.12 * a : 1.09 + 0.12 * (a - 0.5);
  if (y > top || y < bottom) return false;
  const phase = (y + 0.08 * a) / 0.035;
  return phase - Math.floor(phase) < 0.43;
}
