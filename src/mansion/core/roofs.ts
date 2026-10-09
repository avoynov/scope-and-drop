/**
 * Roof surface heights, as pure maths shared by the generator (which sizes
 * the dome's drum) and the renderer (which builds the same roofs).
 */
import type { Mass } from './types';

const DEG = Math.PI / 180;
/** Roof planes start this far above the eave line (top of the cornice). */
export const ROOF_BASE = 0.06;
/** Eaves overhang of roofs without a parapet. */
export const EAVE_OVERHANG = 0.62;
/** Low, as on a temple front: a steep pediment would stand between the sniper and the hall's glass roof. */
export const PAVILION_PITCH = 15;

/** A roof lantern: a kerb this high on the flat roof, then a hipped glass roof of at most LANTERN_RISE. */
export const LANTERN_KERB = 0.55;
export const LANTERN_RISE = 1.7;
export const LANTERN_PITCH = 30;

/** Pitch of a lantern over a rect: 30 degrees, flatter over a wide room so it never stands too tall. */
export function lanternPitch(r: { x0: number; z0: number; x1: number; z1: number }): number {
  const half = Math.min(r.x1 - r.x0, r.z1 - r.z0) / 2;
  return Math.min(LANTERN_PITCH, Math.atan(LANTERN_RISE / half) / DEG);
}

/** Pitch of the shallow upper slopes of a mansard. */
export const MANSARD_TOP_PITCH = 8;

/** Plan rectangle a mass's roof covers. */
export function roofRect(m: Mass): { x0: number; z0: number; x1: number; z1: number } {
  const e = m.roof.balustrade ? 0 : EAVE_OVERHANG;
  return { x0: m.rect.x0 - e, z0: m.rect.z0 - e, x1: m.rect.x1 + e, z1: m.rect.z1 + e };
}

/** Mansard break height above the roof base, and how far the steep slope leans in. */
export function mansardBreak(m: Mass): { height: number; inset: number } {
  const r = roofRect(m);
  const height = Math.min(3.2, 0.3 * Math.min(r.x1 - r.x0, r.z1 - r.z0));
  return { height, inset: height / Math.tan(70 * DEG) };
}

/**
 * A hipped roof over a deep block does not run up to a ridge: it stops at this rise and is
 * leaded flat on top, as on real double-pile houses. It also keeps the dome's base low.
 */
export const HIP_MAX_RISE = 3.0;

/** Pitch and base lift the renderer uses for a hipped roof, and how far in the slopes run before the flat top (Infinity: to the ridge). */
export function hipParams(m: Mass): { pitchDeg: number; lift: number; inset: number } {
  const p = m.roof.balustrade ? { pitchDeg: Math.min(m.roof.pitchDeg, 24), lift: 0.2 } : { pitchDeg: m.roof.pitchDeg, lift: 0 };
  const r = roofRect(m);
  const t = Math.tan(p.pitchDeg * DEG);
  const full = (Math.min(r.x1 - r.x0, r.z1 - r.z0) / 2) * t;
  return { ...p, inset: full > HIP_MAX_RISE + 0.4 ? HIP_MAX_RISE / t : Infinity };
}

/**
 * Height of the roof surface over plan point (x, z), or -Infinity where no roof covers it.
 * `main` is the main block (a pavilion's roof runs back into it).
 */
export function roofSurfaceY(masses: Mass[], x: number, z: number): number {
  const main = masses.find((m) => m.kind === 'main');
  let best = -Infinity;
  for (const m of masses) {
    const yb = m.roof.eaveY + ROOF_BASE;
    if (m.kind === 'pavilion') {
      if (!main) continue;
      const garden = (m.roof.pediment ?? 'garden') === 'garden';
      const x0 = m.rect.x0 - EAVE_OVERHANG;
      const x1 = m.rect.x1 + EAVE_OVERHANG;
      const zA = garden ? main.rect.z1 - 2.5 : m.rect.z0 - EAVE_OVERHANG;
      const zB = garden ? m.rect.z1 + EAVE_OVERHANG : main.rect.z0 + 2.5;
      if (x < x0 || x > x1 || z < zA || z > zB) continue;
      const half = (x1 - x0) / 2;
      best = Math.max(best, yb + (half - Math.abs(x - (x0 + x1) / 2)) * Math.tan(PAVILION_PITCH * DEG));
      continue;
    }
    const r = roofRect(m);
    if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
    const d = Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z);
    switch (m.roof.kind) {
      case 'flat':
        best = Math.max(best, yb + 0.05);
        break;
      case 'glass':
        best = Math.max(best, yb + d * Math.tan(32 * DEG));
        break;
      case 'mansard': {
        const { height, inset } = mansardBreak(m);
        best = Math.max(best, d < inset ? yb + (d / inset) * height : yb + height + (d - inset) * Math.tan(MANSARD_TOP_PITCH * DEG));
        break;
      }
      default: {
        const { pitchDeg, lift, inset } = hipParams(m);
        best = Math.max(best, yb + lift + Math.min(d, inset) * Math.tan(pitchDeg * DEG));
      }
    }
  }
  return best;
}
