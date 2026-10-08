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
export const PAVILION_PITCH = 22.5;

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

/** Pitch and base lift the renderer uses for a hipped roof. */
export function hipParams(m: Mass): { pitchDeg: number; lift: number } {
  return m.roof.balustrade ? { pitchDeg: Math.min(m.roof.pitchDeg, 24), lift: 0.2 } : { pitchDeg: m.roof.pitchDeg, lift: 0 };
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
        best = Math.max(best, d < inset ? yb + (d / inset) * height : yb + height + (d - inset) * Math.tan(16 * DEG));
        break;
      }
      default: {
        const { pitchDeg, lift } = hipParams(m);
        best = Math.max(best, yb + lift + d * Math.tan(pitchDeg * DEG));
      }
    }
  }
  return best;
}
