/**
 * Massing grammar (stage 1).
 *
 * Follows the first steps of Stiny & Mitchell's Palladian grammar: a bay grid
 * mirrored about the garden axis (x = 0), then the parti (main block, wings,
 * pavilions, portico, conservatory). Everything downstream snaps to this grid,
 * which is what keeps windows, walls and rooms in classical alignment.
 */
import { rect, type Rect } from '../core/geom';
import { snap, type Rng } from '../core/rng';
import type { LevelSpec, MansionSize, MassingType, StyleDef } from '../core/types';

export interface WingSpec {
  id: string;
  side: 'west' | 'east';
  /** Which front the wing projects from. */
  toward: 'garden' | 'entrance';
  rect: Rect;
  /** Length in bays along z. */
  bays: number;
  levels: number;
}

export interface MassingPlan {
  type: MassingType;
  bay: number;
  /** Bays across the main block (odd). */
  bays: number;
  /** Main block width / depth (wall centrelines). */
  W: number;
  D: number;
  /** Pile depths: front (garden) pile, corridor (0 = none), back (entrance) pile. */
  df: number;
  dc: number;
  db: number;
  zGarden: number;
  zEntrance: number;
  /** Wall between front pile and corridor/back pile. */
  zFrontInner: number;
  /** Wall between corridor and back pile (== zFrontInner when no corridor). */
  zBackInner: number;
  /** Upper-floor corridor band [z0, z1]. */
  upperCorridor: [number, number];
  levels: LevelSpec[];
  mainLevels: number;
  groundFloorY: number;
  slab: number;
  /** Bays of the central front (garden) room and central back room (entrance hall). */
  centerFront: number;
  centerBack: number;
  /** Projecting central pavilion on the garden front. */
  gardenPavilion: { bays: number; depth: number } | null;
  entrancePavilion: { bays: number; depth: number } | null;
  gardenPortico: { depth: number; giant: boolean } | null;
  entrancePortico: { depth: number } | null;
  wings: WingSpec[];
  conservatory: { side: 'west' | 'east'; rect: Rect } | null;
  /** Side of the back pile carrying the service stair; the grand stair goes on `grandStairSide`. */
  serviceSide: 'west' | 'east';
  grandStairSide: 'west' | 'east';
  ballroomDoubleHeight: boolean;
}

const SIZE_BAYS: Record<MansionSize, number[]> = {
  compact: [7, 9],
  grand: [9, 11, 11, 13],
  palatial: [13, 15],
};

export function planMassing(rng: Rng, style: StyleDef, size: MansionSize, forced?: MassingType): MassingPlan {
  const bay = snap(rng.range(style.bayWidth[0], style.bayWidth[1]), 0.1);
  const bays = rng.pick(SIZE_BAYS[size]);
  const W = snap(bays * bay, 0.01);

  let type: MassingType =
    forced ?? rng.weighted(Object.entries(style.massingWeights) as [MassingType, number][]);
  // Wings need enough façade between them to read as a court.
  if (bays < 9 && type !== 'block') type = forced && bays >= 7 ? type : 'block';

  const mainLevels = rng.int(style.floors[0], style.floors[1]);
  const slab = 0.4;
  const groundFloorY = snap(rng.range(style.plinth[0], style.plinth[1]));
  const levels: LevelSpec[] = [];
  let y = groundFloorY;
  for (let i = 0; i < mainLevels; i++) {
    const [lo, hi] = style.levelHeights[Math.min(i, 2)];
    const height = snap(rng.range(lo, hi));
    levels.push({ index: i, floorY: snap(y), height, ceilingY: snap(y + height - slab) });
    y += height;
  }

  // Piles. A corridor-less double pile needs a deeper back pile so an upper
  // corridor can be carved from it.
  const dc = rng.chance(0.45) ? snap(rng.range(2.4, 3.0), 0.1) : 0;
  const df = snap(rng.range(8.0, 10.2), 0.1);
  const db = snap(dc > 0 ? rng.range(5.6, 7.4) : rng.range(6.4, 7.8), 0.1);
  const D = snap(df + dc + db, 0.01);
  const zGarden = snap(D / 2, 0.01);
  const zEntrance = snap(-D / 2, 0.01);
  const zFrontInner = snap(zGarden - df, 0.01);
  const zBackInner = snap(zFrontInner - dc, 0.01);
  const upperCorridor: [number, number] = dc > 0 ? [zBackInner, zFrontInner] : [snap(zFrontInner - 2.2, 0.01), zFrontInner];

  // Central rooms: the ballroom straddles the axis; so does the entrance hall.
  const centerFront = bays >= 11 ? rng.pick([3, 5, 5]) : 3;
  const centerBack = bays <= 7 ? 1 : bays >= 13 ? rng.pick([3, 3, 1]) : rng.pick([1, 3]);

  const gardenPavilion = rng.chance(style.pavilionChance)
    ? { bays: centerFront, depth: snap(rng.range(1.2, 2.4), 0.1) }
    : null;
  // Pavilions only ever widen the central room, so they always cover whole rooms.
  const entrancePavilion = rng.chance(0.5) ? { bays: centerBack, depth: snap(rng.range(1.0, 2.0), 0.1) } : null;
  const gardenPortico = rng.chance(style.porticoChance)
    ? { depth: snap(rng.range(2.8, 3.6), 0.1), giant: mainLevels >= 2 && rng.chance(0.7) }
    : null;
  const entrancePortico = rng.chance(0.6) ? { depth: snap(rng.range(2.6, 3.2), 0.1) } : null;
  // A portico is at least three bays wide; never stand one in front of a narrower frontispiece.
  const entrancePav = entrancePortico && entrancePavilion && entrancePavilion.bays < 3 ? null : entrancePavilion;

  // Wings: two bays wide, aligned with the main grid so walls stack and
  // window rhythm carries round the corner.
  const wings: WingSpec[] = [];
  const ww = 2 * bay;
  const wingLevels = mainLevels >= 3 && rng.chance(0.6) ? 2 : 1;
  const addWings = (toward: 'garden' | 'entrance') => {
    const nb = rng.int(3, size === 'palatial' ? 6 : 5);
    const L = snap(nb * bay, 0.01);
    for (const side of ['west', 'east'] as const) {
      const x0 = side === 'west' ? -W / 2 : W / 2 - ww;
      const z0 = toward === 'garden' ? zGarden : zEntrance - L;
      wings.push({
        id: `wing-${toward}-${side}`,
        side,
        toward,
        rect: rect(snap(x0, 0.01), snap(z0, 0.01), snap(x0 + ww, 0.01), snap(z0 + L, 0.01)),
        bays: nb,
        levels: wingLevels,
      });
    }
  };
  if (type === 'u-garden' || type === 'h') addWings('garden');
  if (type === 'u-entrance' || type === 'h') addWings('entrance');

  // Conservatory on an open end of the front pile.
  let conservatory: MassingPlan['conservatory'] = null;
  if ((type === 'block' || type === 'u-entrance') && rng.chance(0.45)) {
    const side = rng.pick(['west', 'east'] as const);
    const cw = snap(rng.range(6.5, 9.0), 0.1);
    const x0 = side === 'east' ? W / 2 : -W / 2 - cw;
    conservatory = { side, rect: rect(snap(x0, 0.01), zFrontInner, snap(x0 + cw, 0.01), zGarden) };
  }

  const serviceSide = rng.pick(['west', 'east'] as const);
  const grandStairSide = rng.pick(['west', 'east'] as const);
  const ballroomDoubleHeight = mainLevels >= 2 && rng.chance(0.55);

  return {
    type,
    bay,
    bays,
    W,
    D,
    df,
    dc,
    db,
    zGarden,
    zEntrance,
    zFrontInner,
    zBackInner,
    upperCorridor,
    levels,
    mainLevels,
    groundFloorY,
    slab,
    centerFront,
    centerBack,
    gardenPavilion,
    entrancePavilion: entrancePav,
    gardenPortico,
    entrancePortico,
    wings,
    conservatory,
    serviceSide,
    grandStairSide,
    ballroomDoubleHeight,
  };
}

/** x coordinate of bay grid line i (0..bays). */
export function bayLine(m: MassingPlan, i: number): number {
  return snap(-m.W / 2 + i * m.bay, 0.01);
}
