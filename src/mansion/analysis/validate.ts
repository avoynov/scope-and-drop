/**
 * Validity rules. A mansion is accepted only if it is a sound building AND a
 * fair level: the sniper can watch enough of the party (but not all of it),
 * mission objects exist and are reachable, and every room can be walked to.
 */
import { overlaps } from '../core/geom';
import type { MansionBlueprint, PoiType, ValidationIssue, ValidationReport } from '../core/types';
import { navCellAt, navComponents } from './nav';

export const DEFAULT_REQUIRED_POIS: Partial<Record<PoiType, { min: number; visible: number }>> = {
  statue: { min: 3, visible: 1 },
  bookshelf: { min: 1, visible: 0 },
  bar: { min: 1, visible: 1 },
  painting: { min: 6, visible: 2 },
  piano: { min: 1, visible: 0 },
  fireplace: { min: 1, visible: 0 },
  ledger: { min: 1, visible: 0 },
};

/** A POI counts as visible from the perch above this person-visibility. */
export const POI_VISIBLE = 0.35;

export interface ValidateExtras {
  unreachable: string[];
  passViolations: string[];
  missingStairs: string[];
}

export function validate(bp: Omit<MansionBlueprint, 'validation' | 'stats'>, extras: ValidateExtras): ValidationReport {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, ref?: string) => issues.push({ code, severity: 'error', message, ref });
  const warn = (code: string, message: string, ref?: string) => issues.push({ code, severity: 'warn', message, ref });
  const metrics: Record<string, number> = {};

  // Geometry: rooms within a storey never overlap and are large enough.
  for (const lv of bp.levels) {
    const rs = bp.rooms.filter((r) => r.level === lv.index || (r.doubleHeight && r.level === lv.index - 1));
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        if (overlaps(rs[i]!.rect, rs[j]!.rect, 0.01)) err('room-overlap', `${rs[i]!.id} overlaps ${rs[j]!.id}`, rs[i]!.id);
      }
    }
  }
  for (const r of bp.rooms) {
    const w = r.inner.x1 - r.inner.x0;
    const d = r.inner.z1 - r.inner.z0;
    const min = r.type === 'corridor' ? 1.6 : r.role === 'party' ? 3.0 : 2.0;
    if (Math.min(w, d) < min) err('room-too-small', `${r.label} (${r.id}) is ${w.toFixed(1)}×${d.toFixed(1)} m`, r.id);
  }

  // Circulation.
  for (const id of extras.unreachable) err('unreachable', `Room ${id} has no route from the stairs/entrance`, id);
  for (const id of extras.passViolations) warn('pass-through', `Room ${id} is only reachable through a private room`, id);
  for (const s of extras.missingStairs) err('stair-fit', `No stair fits: ${s}`, s);
  const hasGrand = bp.stairs.some((s) => s.kind === 'grand');
  if (bp.levels.length > 1 && !hasGrand) err('no-grand-stair', 'Grand stair missing');

  // Windows: habitable rooms on a façade need daylight.
  for (const r of bp.rooms) {
    // Internal dressing rooms and bathrooms behind a wing roof are fine; party rooms are not.
    if (r.role !== 'party') continue;
    const glazed = bp.walls.some((w) => w.exterior && (w.neg === r.id || w.pos === r.id) && w.openings.some((o) => o.glazed));
    const onFacade = bp.walls.some((w) => w.exterior && (w.neg === r.id || w.pos === r.id));
    if (onFacade && !glazed) warn('no-window', `${r.label} (${r.id}) has façade but no window`, r.id);
  }

  // Sightlines: watchable, but not a fishbowl.
  const [lo, hi] = bp.options.partyVisibility;
  metrics.partyVisible = round(bp.sightlines.partyVisible);
  metrics.terraceVisible = round(bp.sightlines.terrace);
  if (bp.sightlines.partyVisible < lo) err('too-hidden', `Only ${(bp.sightlines.partyVisible * 100).toFixed(0)}% of the party is visible (min ${lo * 100}%)`);
  if (bp.sightlines.partyVisible > hi) err('too-exposed', `${(bp.sightlines.partyVisible * 100).toFixed(0)}% of the party is visible (max ${hi * 100}%)`);
  const stageRooms = bp.rooms.filter((r) => r.level === 0 && r.role === 'party' && r.stage);
  const watchable = stageRooms.filter((r) => (bp.sightlines.rooms[r.id] ?? 0) >= 0.2);
  metrics.watchableStageRooms = watchable.length;
  if (watchable.length < Math.min(2, stageRooms.length)) err('stage-blind', `Only ${watchable.length} garden-front party rooms can be watched`);
  const hidden = bp.rooms.filter((r) => r.level === 0 && (r.role === 'party' || r.role === 'circulation') && (bp.sightlines.rooms[r.id] ?? 0) < 0.05);
  metrics.blindSpots = hidden.length;
  if (hidden.length === 0) warn('no-blind-spots', 'Every ground-floor room is visible: the spy has nowhere to hide');

  // Mission objects.
  const req = bp.options.requiredPois;
  for (const [type, need] of Object.entries(req) as [PoiType, { min: number; visible: number }][]) {
    const all = bp.pois.filter((p) => p.type === type);
    const vis = all.filter((p) => p.visibility >= POI_VISIBLE);
    metrics[`poi.${type}`] = all.length;
    metrics[`poi.${type}.visible`] = vis.length;
    if (all.length < need.min) err('poi-missing', `Need ≥${need.min} ${type}, have ${all.length}`, type);
    else if (vis.length < need.visible) err('poi-hidden', `Need ≥${need.visible} visible ${type}, have ${vis.length}`, type);
  }

  // Navigation: one connected walkable component per storey contains all POI stand points and doors.
  for (const n of bp.nav.levels) {
    const comp = navComponents(n);
    const sizes = new Map<number, number>();
    comp.forEach((c) => c >= 0 && sizes.set(c, (sizes.get(c) ?? 0) + 1));
    const main = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    for (const p of bp.pois.filter((q) => q.level === n.level)) {
      const k = navCellAt(n, p.stand.x, p.stand.z);
      if (k < 0 || comp[k] !== main) {
        // Snap within one cell before declaring it stranded.
        const near = [-1, 0, 1].flatMap((a) => [-1, 0, 1].map((b) => navCellAt(n, p.stand.x + a * n.cell, p.stand.z + b * n.cell)));
        if (!near.some((q) => q >= 0 && comp[q] === main)) err('poi-stranded', `POI ${p.id} (${p.type}) stand point not on the main walkable area`, p.id);
      }
    }
    for (const r of bp.rooms.filter((q) => q.level === n.level)) {
      let cells = 0;
      let inMain = 0;
      for (let k = 0; k < n.room.length; k++) {
        if (n.room[k] === r.index && n.walk[k]) {
          cells++;
          if (comp[k] === main) inMain++;
        }
      }
      if (cells === 0 && r.type !== 'service-stair') err('room-unwalkable', `${r.label} (${r.id}) has no walkable floor`, r.id);
      else if (cells > 0 && inMain === 0) err('room-cut-off', `${r.label} (${r.id}) is cut off from the storey`, r.id);
    }
    metrics[`nav.L${n.level}.components`] = sizes.size;
  }

  // Party capacity.
  const partyArea = bp.rooms.filter((r) => r.level === 0 && r.role === 'party').reduce((a, r) => a + (r.inner.x1 - r.inner.x0) * (r.inner.z1 - r.inner.z0), 0);
  metrics.partyArea = round(partyArea);
  if (partyArea < 180) err('party-too-small', `Party floor only ${partyArea.toFixed(0)} m²`);

  return { ok: !issues.some((i) => i.severity === 'error'), issues, metrics };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
