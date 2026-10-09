/**
 * First-order riflescope optics, shared by the reticle demo and its tests.
 * Units: millimetres for the eye and the glass, metres for ranges, radians for angles.
 * The shader in demo/reticle/composite.ts mirrors `eyeboxTransmission` and `parallaxShiftRad`.
 */

export interface ScopeSpec {
  minMag: number;
  maxMag: number;
  /** Clear aperture of the objective lens. */
  objectiveMm: number;
  /** Apparent field of view through the eyepiece (constant across the zoom range on most modern scopes). */
  apparentFovDeg: number;
  /** Distance from the last lens surface to the exit pupil, where the eye belongs. */
  eyeReliefMm: number;
  /** Radius of the ocular housing as seen from the eye (the black ring around the image). */
  ocularHousingMm: number;
}

/** A 4–20×50 first-focal-plane tactical scope. At 4× the true field is ~6°, the PSO-1's own field. */
export const SCOPE: ScopeSpec = {
  minMag: 4,
  maxMag: 20,
  objectiveMm: 50,
  apparentFovDeg: 24,
  eyeReliefMm: 90,
  ocularHousingMm: 31,
};

/** One Soviet artillery "thousandth": 1/6000 of a circle, the PSO-1's unit (≈ 1.047 mrad). */
export const THOUSANDTH = (2 * Math.PI) / 6000;
export const MRAD = 1e-3;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** tan of half the apparent field: the eyepiece maps tan(apparent) = mag · tan(true). */
export const tanHalfApparent = (s: ScopeSpec) => Math.tan(rad(s.apparentFovDeg) / 2);

/** Full true (object-space) field of view at this magnification. */
export const trueFovRad = (s: ScopeSpec, mag: number) => 2 * Math.atan(tanHalfApparent(s) / mag);

/** Exit pupil diameter: the bundle of light leaving the eyepiece. Shrinks as magnification rises. */
export const exitPupilMm = (s: ScopeSpec, mag: number) => s.objectiveMm / mag;

/** Area of the lens-shaped overlap of two circles (radii a, b, centres d apart). */
export function circleOverlap(a: number, b: number, d: number): number {
  if (d >= a + b) return 0;
  const r = Math.min(a, b);
  if (d <= Math.abs(a - b)) return Math.PI * r * r;
  const a2 = a * a;
  const b2 = b * b;
  const alpha = Math.acos((d * d + a2 - b2) / (2 * d * a));
  const beta = Math.acos((d * d + b2 - a2) / (2 * d * b));
  return a2 * (alpha - Math.sin(2 * alpha) / 2) + b2 * (beta - Math.sin(2 * beta) / 2);
}

export interface Eye {
  /** Lateral offset of the eye pupil from the scope axis. */
  x: number;
  y: number;
  /** Error along the axis: positive is behind the exit pupil (too far back). */
  z: number;
  /** Eye pupil diameter (≈3 mm in daylight, 7 mm in the dark). */
  pupilMm: number;
}

/**
 * Fraction of the eye pupil filled with light from one field direction.
 * Every field direction leaves the eyepiece as a bundle as wide as the exit pupil. The bundles cross at
 * the exit pupil plane, so the bundle the eye sees in apparent direction `t` (tan) travels toward −t, and
 * `z` mm behind that plane it sits at −z·t. Where it misses the eye pupil, that part of the field goes
 * black: this is the crescent "scope shadow". Too far back, all the light still comes through the exit
 * pupil, so the image survives on the side away from the head and the crescent falls on the head's side;
 * too close, it flips.
 */
export function eyeboxTransmission(s: ScopeSpec, mag: number, eye: Eye, tx: number, ty: number): number {
  const a = exitPupilMm(s, mag) / 2;
  const b = eye.pupilMm / 2;
  const d = Math.hypot(eye.x + eye.z * tx, eye.y + eye.z * ty);
  return circleOverlap(a, b, d) / (Math.PI * b * b);
}

/**
 * Apparent sideways jump of the reticle against a target, in object-space radians.
 * The eye offset inside the exit pupil corresponds to a ray through the objective `mag` times further
 * off axis. If the target's image is not focused exactly on the reticle plane (parallax set ≠ range),
 * that off-axis ray lands on the reticle at a different point: shift = aperture offset · (1/D − 1/P).
 */
export function parallaxShiftRad(s: ScopeSpec, mag: number, eyeOffsetMm: number, rangeM: number, parallaxM: number): number {
  const aperture = Math.max(-s.objectiveMm / 2, Math.min(s.objectiveMm / 2, eyeOffsetMm * mag));
  const invP = Number.isFinite(parallaxM) ? 1 / parallaxM : 0;
  return (aperture / 1000) * (1 / rangeM - invP);
}

/** Stadiametric range from a known size and its angular subtension. */
export const stadiaRangeM = (sizeM: number, subtensionRad: number) => sizeM / subtensionRad;
