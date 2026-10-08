/**
 * Stairs (stage 4): U-return stairs fitted inside stair rooms.
 *
 * Built in a local frame (u along the flights, v across) and mapped to the
 * plan. The upper floor gets a stairwell hole over everything but the
 * approach zone, which is where the top flight arrives.
 */
import { intersect, rect, type Rect } from '../core/geom';
import type { LevelSpec, Stair, StairFlight } from '../core/types';

export interface StairParams {
  maxRiser: number;
  treads: number[];
  minWidth: number;
  maxWidth: number;
  gap: number;
  approachMin: number;
}

export const GRAND_STAIR: StairParams = {
  maxRiser: 0.18,
  treads: [0.3, 0.28, 0.27, 0.26, 0.25],
  minWidth: 1.2,
  maxWidth: 1.8,
  gap: 0.25,
  approachMin: 1.2,
};

export const SERVICE_STAIR: StairParams = {
  maxRiser: 0.2,
  treads: [0.26, 0.25, 0.24],
  minWidth: 0.9,
  maxWidth: 1.1,
  gap: 0.15,
  approachMin: 0.9,
};

export interface StairFit {
  flights: StairFlight[];
  landings: { rect: Rect; y: number }[];
  /** Hole to cut in the upper floor. */
  hole: Rect;
  /** Plan area occupied by flights and landing (blocked for walking at the lower level). */
  footprint: Rect;
  /** Free approach zone at the near end. */
  approach: Rect;
}

/**
 * Fit a U-return stair in `region`.
 * @param along  axis the flights run along
 * @param nearAtMin  true if the approach (near) end is at the region's min coordinate along `along`
 * @param bandsAtMin true if the flights hug the region's min edge across the flights
 */
export function fitUStair(
  region: Rect,
  along: 'x' | 'z',
  nearAtMin: boolean,
  bandsAtMin: boolean,
  y0: number,
  rise: number,
  p: StairParams,
): StairFit | null {
  const len = along === 'x' ? region.x1 - region.x0 : region.z1 - region.z0;
  const span = along === 'x' ? region.z1 - region.z0 : region.x1 - region.x0;
  const fw = Math.min(p.maxWidth, (span - p.gap) / 2);
  if (fw < p.minWidth) return null;
  const n = Math.ceil(rise / p.maxRiser);
  const riser = rise / n;
  const f1 = Math.ceil(n / 2);
  const f2 = n - f1;
  for (const tread of p.treads) {
    const run1 = f1 * tread;
    const run2 = f2 * tread;
    const approach = len - fw - Math.max(run1, run2);
    if (approach < p.approachMin) continue;
    const bands = 2 * fw + p.gap;
    // Local (u, v) -> plan (x, z).
    const toPlan = (u: number, v: number): { x: number; z: number } => {
      const U = nearAtMin ? u : len - u;
      const V = bandsAtMin ? v : span - v;
      return along === 'x' ? { x: region.x0 + U, z: region.z0 + V } : { x: region.x0 + V, z: region.z0 + U };
    };
    const rectUV = (u0: number, v0: number, u1: number, v1: number): Rect => {
      const a = toPlan(u0, v0);
      const b = toPlan(u1, v1);
      return rect(a.x, a.z, b.x, b.z);
    };
    const farward: StairFlight['dir'] = along === 'x' ? (nearAtMin ? '+x' : '-x') : nearAtMin ? '+z' : '-z';
    const nearward: StairFlight['dir'] = along === 'x' ? (nearAtMin ? '-x' : '+x') : nearAtMin ? '-z' : '+z';
    const foot1 = toPlan(approach, fw / 2);
    const foot2 = toPlan(len - fw, fw + p.gap + fw / 2);
    const flights: StairFlight[] = [
      { x: foot1.x, y: y0, z: foot1.z, dir: farward, width: fw, run: run1, rise: f1 * riser, steps: f1 },
      { x: foot2.x, y: y0 + f1 * riser, z: foot2.z, dir: nearward, width: fw, run: run2, rise: f2 * riser, steps: f2 },
    ];
    return {
      flights,
      landings: [{ rect: rectUV(len - fw, 0, len, bands), y: y0 + f1 * riser }],
      // Starts where the top flight arrives, so the arrival tread has floor.
      hole: rectUV(len - fw - run2, 0, len, bands),
      footprint: rectUV(approach, 0, len, bands),
      approach: rectUV(0, 0, approach, span),
    };
  }
  return null;
}

/**
 * Fit a stair connecting two stacked rooms. Tries both axes and orientations,
 * preferring flights along the room's long side and an approach near `prefer`.
 */
export function fitStairBetween(
  id: string,
  kind: Stair['kind'],
  bottom: { id: string; inner: Rect },
  top: { id: string; inner: Rect },
  from: LevelSpec,
  to: LevelSpec,
  prefer: { x: number; z: number },
): { stair: Stair; fit: StairFit } | null {
  const region0 = intersect(bottom.inner, top.inner);
  if (!region0) return null;
  const region = rect(region0.x0 + 0.05, region0.z0 + 0.05, region0.x1 - 0.05, region0.z1 - 0.05);
  const params = kind === 'grand' ? GRAND_STAIR : SERVICE_STAIR;
  const w = region.x1 - region.x0;
  const d = region.z1 - region.z0;
  const axes: ('x' | 'z')[] = w >= d ? ['x', 'z'] : ['z', 'x'];
  const cx = (region.x0 + region.x1) / 2;
  const cz = (region.z0 + region.z1) / 2;
  for (const along of axes) {
    // Approach at the end nearest the preferred entry; flights against the far side.
    const nearAtMin = along === 'x' ? prefer.x <= cx : prefer.z <= cz;
    const bandsAtMin = along === 'x' ? prefer.z > cz : prefer.x > cx;
    for (const [nm, bm] of [
      [nearAtMin, bandsAtMin],
      [nearAtMin, !bandsAtMin],
      [!nearAtMin, bandsAtMin],
    ] as const) {
      const fit = fitUStair(region, along, nm, bm, from.floorY, to.floorY - from.floorY, params);
      if (fit) {
        return {
          fit,
          stair: {
            id,
            kind,
            fromLevel: from.index,
            toLevel: to.index,
            bottomRoom: bottom.id,
            topRoom: top.id,
            rect: fit.footprint,
            flights: fit.flights,
            landings: fit.landings,
          },
        };
      }
    }
  }
  return null;
}
