/** Porticos: free-standing colonnades with a pediment, on the bay grid. */
import { rect } from '../core/geom';
import { snap } from '../core/rng';
import type { Portico, StyleDef } from '../core/types';
import type { MassingPlan } from './massing';

export function planPorticos(m: MassingPlan, style: StyleDef): Portico[] {
  const out: Portico[] = [];
  const terraceY = snap(m.groundFloorY - 0.15, 0.01);
  if (m.gardenPortico) {
    const bays = m.centerFront;
    const half = (bays * m.bay) / 2;
    const zFace = m.zGarden + (m.gardenPavilion?.depth ?? 0);
    const giant = m.gardenPortico.giant && m.levels.length >= 2;
    const r = giant ? Math.min(0.5, Math.max(0.4, 0.11 * m.bay)) : 0.3;
    const z = snap(zFace + m.gardenPortico.depth - r - 0.15, 0.01);
    const top = giant ? m.levels[1]! : m.levels[0]!;
    out.push({
      id: 'portico-garden',
      side: 'garden',
      columns: Array.from({ length: bays + 1 }, (_, i) => ({ x: snap(-half + i * m.bay, 0.01), z })),
      columnRadius: r,
      baseY: terraceY,
      topY: snap(top.floorY + top.height, 0.01),
      order: style.columnOrder,
      rect: rect(snap(-half - r - 0.35, 0.01), zFace, snap(half + r + 0.35, 0.01), snap(zFace + m.gardenPortico.depth + 0.1, 0.01)),
      pediment: true,
    });
  }
  if (m.entrancePortico) {
    const bays = Math.max(3, m.centerBack);
    const half = (bays * m.bay) / 2;
    const zFace = m.zEntrance - (m.entrancePavilion?.depth ?? 0);
    const r = 0.3;
    const z = snap(zFace - m.entrancePortico.depth + r + 0.15, 0.01);
    const top = m.levels[0]!;
    out.push({
      id: 'portico-entrance',
      side: 'entrance',
      columns: Array.from({ length: bays + 1 }, (_, i) => ({ x: snap(-half + i * m.bay, 0.01), z })),
      columnRadius: r,
      baseY: terraceY,
      topY: snap(top.floorY + top.height, 0.01),
      order: style.columnOrder === 'corinthian' ? 'ionic' : style.columnOrder,
      rect: rect(snap(-half - r - 0.35, 0.01), snap(zFace - m.entrancePortico.depth - 0.1, 0.01), snap(half + r + 0.35, 0.01), zFace),
      pediment: true,
    });
  }
  return out;
}
