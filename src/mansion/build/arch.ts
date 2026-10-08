/**
 * Architecture mesher: room shells, façades, openings, window joinery.
 *
 * Walls are rendered as faces, not boxes: each room gets its own inner faces
 * (its finish, its lighting scope) clipped to its clear interior, and façades
 * get outer faces mitred at convex/concave corners. Openings are cut from both
 * and lined with reveals.
 */
import * as THREE from 'three';
import type { MansionBlueprint, Opening, Room, StyleDef, Wall } from '../core/types';
import { ALL, NX, NY, NZ, PX, PY, PZ, type GeometryBuilder } from './geometry';

export interface ArchContext {
  bp: MansionBlueprint;
  g: GeometryBuilder;
  rooms: Map<string, Room>;
  style: StyleDef;
  /** Seeded 0..1 for cosmetic choices. */
  rand: () => number;
}

type Hole = { t0: number; t1: number; y0: number; y1: number };

export function rectsMinusHoles(t0: number, t1: number, y0: number, y1: number, holes: Hole[]): [number, number, number, number][] {
  const ts = new Set<number>([t0, t1]);
  for (const h of holes) {
    if (h.t1 <= t0 || h.t0 >= t1 || h.y1 <= y0 || h.y0 >= y1) continue;
    ts.add(Math.min(t1, Math.max(t0, h.t0)));
    ts.add(Math.min(t1, Math.max(t0, h.t1)));
  }
  const sorted = [...ts].sort((a, b) => a - b);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (b - a < 1e-4) continue;
    const mid = (a + b) / 2;
    const cover = holes
      .filter((h) => h.t0 < mid && h.t1 > mid)
      .map((h) => [Math.max(h.y0, y0), Math.min(h.y1, y1)] as [number, number])
      .filter(([p, q]) => q > p)
      .sort((p, q) => p[0] - q[0]);
    let y = y0;
    for (const [p, q] of cover) {
      if (p > y + 1e-4) out.push([a, b, y, p]);
      y = Math.max(y, q);
    }
    if (y1 > y + 1e-4) out.push([a, b, y, y1]);
  }
  return out;
}

/** Vertical quad on a wall plane. axis: wall run axis; line: plane coordinate; sgn: normal direction. */
export function vquad(g: GeometryBuilder, key: string, axis: 'x' | 'z', line: number, sgn: 1 | -1, t0: number, t1: number, y0: number, y1: number): void {
  if (axis === 'x') {
    if (sgn > 0) g.quad(key, [t0, y0, line], [t1, y0, line], [t1, y1, line], [t0, y1, line]);
    else g.quad(key, [t1, y0, line], [t0, y0, line], [t0, y1, line], [t1, y1, line]);
  } else {
    if (sgn > 0) g.quad(key, [line, y0, t1], [line, y0, t0], [line, y1, t0], [line, y1, t1]);
    else g.quad(key, [line, y0, t0], [line, y0, t1], [line, y1, t1], [line, y1, t0]);
  }
}

/** Box aligned to a wall: along t in [t0,t1], out from plane `line` by [n0,n1] (signed along sgn), y in [y0,y1]. */
export function wbox(g: GeometryBuilder, key: string, axis: 'x' | 'z', line: number, sgn: 1 | -1, t0: number, t1: number, n0: number, n1: number, y0: number, y1: number, faces = ALL): void {
  const a = line + sgn * n0;
  const b = line + sgn * n1;
  if (axis === 'x') g.box(key, t0, y0, Math.min(a, b), t1, y1, Math.max(a, b), faces);
  else g.box(key, Math.min(a, b), y0, t0, Math.max(a, b), y1, t1, faces);
}

const wallLine = (w: Wall) => (w.axis === 'x' ? w.a.z : w.a.x);
const wallT0 = (w: Wall) => (w.axis === 'x' ? w.a.x : w.a.z);
const wallT1 = (w: Wall) => (w.axis === 'x' ? w.b.x : w.b.z);

function holesOf(w: Wall): (Hole & { o: Opening })[] {
  const base = wallT0(w);
  return w.openings.map((o) => ({ t0: base + o.u0, t1: base + o.u1, y0: o.y0, y1: o.y1, o }));
}

export function wallMaterialKey(style: StyleDef): string {
  return `ext-wall-${style.wallMaterial}`;
}

/* ------------------------------------------------------------------ */
/* Interiors                                                           */
/* ------------------------------------------------------------------ */

export function buildInteriors(ctx: ArchContext): void {
  const { bp, g } = ctx;
  for (const room of bp.rooms) {
    g.scope = room.index;
    g.vOffset = 0;
    const f = room.finish;
    // Floor (minus stairwell holes).
    g.setTint(f.floorColor);
    for (const [x0, x1, z0, z1] of rectsMinusHoles(room.rect.x0, room.rect.x1, room.rect.z0, room.rect.z1, room.floorHoles.map((h) => ({ t0: h.x0, t1: h.x1, y0: h.z0, y1: h.z1 })))) {
      g.quad(`floor-${f.floor}`, [x0, room.floorY, z1], [x1, room.floorY, z1], [x1, room.floorY, z0], [x0, room.floorY, z0]);
    }
    // Slab edge around holes in this floor.
    g.setTint(f.ceilingColor);
    for (const h of room.floorHoles) {
      const y0 = room.floorY - 0.4;
      const y1 = room.floorY;
      g.quad('ceiling', [h.x0, y0, h.z0], [h.x1, y0, h.z0], [h.x1, y1, h.z0], [h.x0, y1, h.z0]);
      g.quad('ceiling', [h.x1, y0, h.z1], [h.x0, y0, h.z1], [h.x0, y1, h.z1], [h.x1, y1, h.z1]);
      g.quad('ceiling', [h.x0, y0, h.z1], [h.x0, y0, h.z0], [h.x0, y1, h.z0], [h.x0, y1, h.z1]);
      g.quad('ceiling', [h.x1, y0, h.z0], [h.x1, y0, h.z1], [h.x1, y1, h.z1], [h.x1, y1, h.z0]);
    }
    // Ceiling, minus holes in the storey above that open into this room.
    const above = bp.rooms.filter((r) => r.level === room.level + (room.doubleHeight ? 2 : 1));
    const ceilHoles = above.flatMap((r) => r.floorHoles).map((h) => ({ t0: h.x0, t1: h.x1, y0: h.z0, y1: h.z1 }));
    for (const [x0, x1, z0, z1] of rectsMinusHoles(room.rect.x0, room.rect.x1, room.rect.z0, room.rect.z1, ceilHoles)) {
      g.quad('ceiling', [x0, room.ceilingY, z0], [x1, room.ceilingY, z0], [x1, room.ceilingY, z1], [x0, room.ceilingY, z1]);
    }

    // Wall faces.
    for (const w of bp.walls) {
      const onNeg = w.neg === room.id;
      const onPos = w.pos === room.id;
      if (!onNeg && !onPos) continue;
      const sgn: 1 | -1 = onNeg ? -1 : 1;
      const face = wallLine(w) + sgn * (w.thickness / 2);
      const lo = w.axis === 'x' ? room.inner.x0 : room.inner.z0;
      const hi = w.axis === 'x' ? room.inner.x1 : room.inner.z1;
      const t0 = Math.max(wallT0(w), lo);
      const t1 = Math.min(wallT1(w), hi);
      if (t1 - t0 < 1e-3) continue;
      const y0 = Math.max(room.floorY, w.y0);
      const y1 = Math.min(room.ceilingY, w.y1);
      if (y1 - y0 < 1e-3) continue;
      const holes = holesOf(w);
      g.setTint(f.wallColor);
      g.vOffset = room.floorY;
      for (const [a, b, c, d] of rectsMinusHoles(t0, t1, y0, y1, holes)) vquad(g, `wall-${f.wall}`, w.axis, face, sgn, a, b, c, d);
      g.vOffset = 0;

      // Joinery on this face.
      g.setTint(f.trimColor);
      const doorGaps = holes.filter((h) => h.y0 < room.floorY + 0.3);
      if (y0 <= room.floorY + 1e-3) {
        for (const [a, b] of spans(t0, t1, doorGaps)) wbox(g, 'int-trim', w.axis, face, sgn, a, b, 0, 0.025, room.floorY, room.floorY + 0.22, ALL & ~NY);
        if (f.dado) {
          const dy = room.floorY + 0.9;
          for (const [a, b] of spans(t0, t1, holes.filter((h) => h.y0 < dy + 0.05 && h.y1 > dy))) wbox(g, 'int-trim', w.axis, face, sgn, a, b, 0, 0.03, dy, dy + 0.06);
        }
      }
      if (y1 >= room.ceilingY - 1e-3) {
        const top = room.ceilingY;
        for (const [a, b] of spans(t0, t1, holes.filter((h) => h.y1 > top - 0.35))) {
          wbox(g, 'int-trim', w.axis, face, sgn, a, b, 0, 0.09, top - 0.28, top, ALL & ~PY);
          wbox(g, 'int-trim', w.axis, face, sgn, a, b, 0, 0.18, top - 0.1, top, ALL & ~PY);
        }
      }
      // Casings around openings on the room side.
      for (const h of holes) {
        if (h.t1 <= t0 || h.t0 >= t1) continue;
        const cw = h.o.kind === 'arch' ? 0.18 : 0.12;
        const top = Math.min(h.y1 + cw, room.ceilingY - 0.3);
        if (h.y1 > y1 || h.y0 < y0 - 1e-3) continue;
        wbox(g, 'int-trim', w.axis, face, sgn, h.t0 - cw, h.t0, 0, 0.025, Math.max(y0, h.y0 - (h.o.passable ? 0 : 0.05)), top);
        wbox(g, 'int-trim', w.axis, face, sgn, h.t1, h.t1 + cw, 0, 0.025, Math.max(y0, h.y0 - (h.o.passable ? 0 : 0.05)), top);
        wbox(g, 'int-trim', w.axis, face, sgn, h.t0 - cw, h.t1 + cw, 0, 0.03, h.y1, top);
        if (!h.o.passable && w.exterior) wbox(g, 'int-trim', w.axis, face, sgn, h.t0 - 0.05, h.t1 + 0.05, -0.02, 0.06, h.y0 - 0.04, h.y0);
      }
    }
  }
  g.scope = -1;
}

/** Complement of hole spans along t (for skirting runs etc). */
function spans(t0: number, t1: number, holes: Hole[]): [number, number][] {
  const cuts = holes.map((h) => [h.t0, h.t1] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let t = t0;
  for (const [a, b] of cuts) {
    if (a > t + 1e-3) out.push([t, Math.min(a, t1)]);
    t = Math.max(t, b);
  }
  if (t1 > t + 1e-3) out.push([t, t1]);
  return out.filter(([a, b]) => b - a > 1e-3);
}

/* ------------------------------------------------------------------ */
/* Reveals + door leaves                                               */
/* ------------------------------------------------------------------ */

export function buildReveals(ctx: ArchContext): void {
  const { bp, g, rooms } = ctx;
  for (const w of bp.walls) {
    const line = wallLine(w);
    for (const h of holesOf(w)) {
      // Each half of the wall thickness belongs to the space on that side.
      for (const side of [-1, 1] as const) {
        const roomId = side < 0 ? w.neg : w.pos;
        const room = roomId ? rooms.get(roomId) : undefined;
        const n0 = 0;
        const n1 = w.thickness / 2;
        if (room) {
          g.scope = room.index;
          g.setTint(room.finish.trimColor);
        } else {
          g.scope = -1;
          g.setTint(ctx.style.trimColor);
        }
        const key = room ? 'int-trim' : 'ext-trim';
        const a = line + side * n0;
        const b = line + side * n1;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        // Jambs face into the opening, head faces down, sill faces up.
        const e = 0.001;
        const sill = h.y0 > (room?.floorY ?? -1) + 0.05;
        if (w.axis === 'x') {
          g.box(key, h.t0 - e, h.y0, lo, h.t0, h.y1, hi, PX);
          g.box(key, h.t1, h.y0, lo, h.t1 + e, h.y1, hi, NX);
          g.box(key, h.t0, h.y1, lo, h.t1, h.y1 + e, hi, NY);
          if (sill) g.box(key, h.t0, h.y0 - e, lo, h.t1, h.y0, hi, PY);
        } else {
          g.box(key, lo, h.y0, h.t0 - e, hi, h.y1, h.t0, PZ);
          g.box(key, lo, h.y0, h.t1, hi, h.y1, h.t1 + e, NZ);
          g.box(key, lo, h.y1, h.t0, hi, h.y1 + e, h.t1, NY);
          if (sill) g.box(key, lo, h.y0 - e, h.t0, hi, h.y0, h.t1, PY);
        }
      }
      // Interior door leaves, swung open into the positive-side room.
      const o = h.o;
      if (!w.exterior && (o.kind === 'door' || o.kind === 'double-door') && w.pos) {
        const room = rooms.get(w.pos)!;
        g.scope = room.index;
        g.setTint(shade(room.finish.trimColor, 0.92));
        const leaves = o.leaves ?? 1;
        const lw = (h.t1 - h.t0) / leaves;
        const face = line + w.thickness / 2;
        const hingeTs = leaves === 2 ? [h.t0 + 0.02, h.t1 - 0.02] : [h.t0 + 0.02];
        for (const ht of hingeTs) {
          const t0 = ht - 0.025;
          const t1 = ht + 0.025;
          wbox(g, 'int-trim', w.axis, face, 1, t0, t1, 0.02, 0.02 + lw * 0.96, h.y0 + 0.01, h.y1 - 0.02);
        }
      }
    }
  }
  g.scope = -1;
}

function shade(hex: string, k: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}

/* ------------------------------------------------------------------ */
/* Façades                                                             */
/* ------------------------------------------------------------------ */

interface Corner {
  /** Extension (+) or trim (−) of the outer face at the wall's a/b ends. */
  ea: number;
  eb: number;
  convexA: boolean;
  convexB: boolean;
}

function outwardSign(w: Wall): 1 | -1 {
  return w.neg ? 1 : -1;
}

/** Corner analysis among exterior walls of one storey. */
function corners(walls: Wall[]): Map<Wall, Corner> {
  const out = new Map<Wall, Corner>();
  const ext = walls.filter((w) => w.exterior);
  const key = (x: number, z: number) => `${Math.round(x * 100)}:${Math.round(z * 100)}`;
  const at = new Map<string, Wall[]>();
  for (const w of ext) {
    for (const p of [w.a, w.b]) {
      const k = key(p.x, p.z);
      let l = at.get(k);
      if (!l) at.set(k, (l = []));
      l.push(w);
    }
  }
  for (const w of ext) {
    const c: Corner = { ea: 0, eb: 0, convexA: false, convexB: false };
    const nA = outwardSign(w);
    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      const others = (at.get(key(p.x, p.z)) ?? []).filter((q) => q !== w && q.axis !== w.axis && q.level === w.level);
      for (const q of others) {
        const far = Math.abs(q.a.x - p.x) + Math.abs(q.a.z - p.z) < 1e-3 ? q.b : q.a;
        const dir = w.axis === 'x' ? Math.sign(far.z - p.z) : Math.sign(far.x - p.x);
        const ext = q.thickness / 2;
        if (dir * nA < 0) {
          if (end === 'a') {
            c.ea = ext;
            c.convexA = true;
          } else {
            c.eb = ext;
            c.convexB = true;
          }
        } else if (end === 'a') c.ea = -ext;
        else c.eb = -ext;
      }
    }
    out.set(w, c);
  }
  return out;
}

export function buildFacades(ctx: ArchContext): void {
  const { bp, g, style } = ctx;
  const wallKey = wallMaterialKey(style);
  const wallTint = style.wallMaterial === 'brick' ? '#ffffff' : style.wallColor;
  const baseTint = new THREE.Color(style.wallMaterial === 'brick' ? '#cdc4b4' : style.wallColor).multiplyScalar(0.9);
  const trim = style.trimColor;
  const levels = bp.levels;
  const floor0 = levels[0]!.floorY;
  g.scope = -1;
  const byLevel = new Map<number, Wall[]>();
  for (const w of bp.walls) {
    let l = byLevel.get(w.level);
    if (!l) byLevel.set(w.level, (l = []));
    l.push(w);
  }
  const extAbove = (w: Wall) =>
    bp.walls.some(
      (q) => q.level === w.level + 1 && q.exterior && q.axis === w.axis && Math.abs(wallLine(q) - wallLine(w)) < 1e-3 && Math.min(wallT1(q), wallT1(w)) - Math.max(wallT0(q), wallT0(w)) > 0.1,
    );
  const anyAbove = (w: Wall) =>
    bp.walls.some((q) => q.level === w.level + 1 && q.axis === w.axis && Math.abs(wallLine(q) - wallLine(w)) < 1e-3 && Math.min(wallT1(q), wallT1(w)) - Math.max(wallT0(q), wallT0(w)) > 0.1);
  const pavilionIds = new Set(bp.masses.filter((m) => m.kind === 'pavilion').map((m) => m.id));

  for (const [level, walls] of byLevel) {
    const cmap = corners(walls);
    for (const w of walls) {
      if (!w.exterior) continue;
      const c = cmap.get(w)!;
      const sgn = outwardSign(w);
      const line = wallLine(w);
      const face = line + sgn * (w.thickness / 2);
      const t0 = wallT0(w) - c.ea;
      const t1 = wallT1(w) + c.eb;
      const holes = holesOf(w);
      if (w.glazed) {
        buildCurtainWall(ctx, w, face, sgn, t0, t1);
        continue;
      }
      const yBot = level === 0 ? -0.4 : w.y0;
      const yTop = w.y1;
      // Plinth below the piano nobile, rusticated or plain masonry above.
      if (level === 0) {
        g.setTint(baseTint);
        for (const [a, b, y0, y1] of rectsMinusHoles(t0, t1, yBot, floor0, holes)) vquad(g, 'ext-base', w.axis, face, sgn, a, b, y0, y1);
        const rustic = style.baseMaterial === 'rusticated';
        g.setTint(rustic ? baseTint.clone().multiplyScalar(1.08) : wallTint);
        for (const [a, b, y0, y1] of rectsMinusHoles(t0, t1, floor0, yTop, holes)) vquad(g, rustic ? 'ext-rustic' : wallKey, w.axis, face, sgn, a, b, y0, y1);
        // Water table / plinth cap.
        g.setTint(trim);
        const capT0 = t0 - (c.convexA ? 0.12 : 0);
        const capT1 = t1 + (c.convexB ? 0.12 : 0);
        for (const [a, b] of spans(capT0, capT1, holes.filter((h) => h.y0 < floor0 + 0.1))) wbox(g, 'ext-trim', w.axis, face, sgn, a, b, 0, 0.12, floor0 - 0.18, floor0 + 0.02);
      } else {
        g.setTint(wallTint);
        for (const [a, b, y0, y1] of rectsMinusHoles(t0, t1, yBot, yTop, holes)) vquad(g, wallKey, w.axis, face, sgn, a, b, y0, y1);
      }
      g.setTint(trim);
      const ext = (d: number): [number, number] => [t0 - (c.convexA ? d : 0), t1 + (c.convexB ? d : 0)];
      // String course where another storey continues above, cornice where the mass ends.
      if (extAbove(w) || anyAbove(w)) {
        const [a, b] = ext(0.08);
        wbox(g, 'ext-trim', w.axis, face, sgn, a, b, 0, 0.08, yTop - 0.38, yTop - 0.12);
      } else {
        const [a1, b1] = ext(0.15);
        const [a2, b2] = ext(0.36);
        const [a3, b3] = ext(0.6);
        wbox(g, 'ext-trim', w.axis, face, sgn, a1, b1, 0, 0.15, yTop - 0.62, yTop - 0.3);
        wbox(g, 'ext-trim', w.axis, face, sgn, a2, b2, 0, 0.36, yTop - 0.3, yTop - 0.08);
        wbox(g, 'ext-trim', w.axis, face, sgn, a3, b3, 0, 0.6, yTop - 0.08, yTop + 0.06);
        const mass = bp.masses.find((m) => m.id === w.massId);
        if (mass?.roof.balustrade) parapet(ctx, w.axis, line, sgn, wallT0(w) - (c.convexA ? w.thickness / 2 : 0), wallT1(w) + (c.convexB ? w.thickness / 2 : 0), yTop + 0.06, c.convexA, c.convexB);
      }
      // Quoins on convex corners.
      if (style.quoins) {
        for (const [isA, conv] of [
          [true, c.convexA],
          [false, c.convexB],
        ] as const) {
          if (!conv) continue;
          const tEdge = isA ? t0 : t1;
          const dir = isA ? 1 : -1;
          let k = 0;
          for (let y = level === 0 ? floor0 + 0.05 : w.y0 + 0.02; y + 0.3 < yTop - (extAbove(w) || anyAbove(w) ? 0.4 : 0.65); y += 0.36) {
            const len = k++ % 2 ? 0.45 : 0.85;
            const a = Math.min(tEdge, tEdge + dir * len);
            const b = Math.max(tEdge, tEdge + dir * len);
            wbox(g, 'ext-trim', w.axis, face, sgn, a, b, 0, 0.035, y, y + 0.3);
          }
        }
      }
      // Pilasters on pavilion fronts (giant order).
      if (pavilionIds.has(w.massId) && (w.side === 'garden' || w.side === 'entrance') && level === 0) {
        const top = (bp.masses.find((m) => m.id === w.massId)?.roof.eaveY ?? yTop) - 0.62;
        for (let x = wallT0(w); x <= wallT1(w) + 1e-3; x += bp.bay) {
          wbox(g, 'ext-trim', w.axis, face, sgn, x - 0.3, x + 0.3, 0, 0.1, floor0 + 0.02, top - 0.3);
          wbox(g, 'ext-trim', w.axis, face, sgn, x - 0.38, x + 0.38, 0, 0.16, top - 0.3, top);
        }
      }
      for (const h of holes) windowDressing(ctx, w, h.o, face, sgn, line);
    }
  }
}

/** Balustraded parapet along a run (centreline), with piers. */
export function parapet(ctx: ArchContext, axis: 'x' | 'z', line: number, sgn: 1 | -1, t0: number, t1: number, y: number, pierA = true, pierB = true): void {
  const { g } = ctx;
  const c = line;
  const half = 0.28;
  // Pedestal and coping.
  wbox(g, 'ext-trim', axis, c, 1, t0, t1, -half, half, y, y + 0.28);
  wbox(g, 'ext-trim', axis, c, 1, t0 - 0.05, t1 + 0.05, -half - 0.05, half + 0.05, y + 0.9, y + 1.04);
  const piers: number[] = [];
  if (pierA) piers.push(t0 + 0.25);
  if (pierB) piers.push(t1 - 0.25);
  const n = Math.max(1, Math.round((t1 - t0) / 3.6));
  for (let i = 1; i < n; i++) piers.push(t0 + ((t1 - t0) * i) / n);
  for (const p of piers) wbox(g, 'ext-trim', axis, c, 1, p - 0.25, p + 0.25, -0.32, 0.32, y, y + 1.0);
  for (let t = t0 + 0.32; t < t1 - 0.2; t += 0.3) {
    if (piers.some((p) => Math.abs(p - t) < 0.38)) continue;
    const [x, z] = axis === 'x' ? [t, c] : [c, t];
    baluster(g, x, z, y + 0.28, 0.62);
  }
  void sgn;
}

export function baluster(g: GeometryBuilder, x: number, z: number, y: number, h: number): void {
  g.frame(x, y, z, 0);
  g.lathe(
    'ext-trim',
    0,
    0,
    [
      [0.07, 0],
      [0.07, h * 0.08],
      [0.05, h * 0.14],
      [0.1, h * 0.38],
      [0.06, h * 0.7],
      [0.045, h * 0.82],
      [0.07, h * 0.9],
      [0.07, h],
    ],
    6,
    false,
  );
  g.frame();
}

function windowDressing(ctx: ArchContext, w: Wall, o: Opening, face: number, sgn: 1 | -1, line: number): void {
  const { g, style, bp } = ctx;
  const base = wallT0(w);
  const t0 = base + o.u0;
  const t1 = base + o.u1;
  const room = ctx.rooms.get((w.neg ?? w.pos)!);
  const d = o.dressing ?? {};
  g.scope = -1;
  g.setTint(style.trimColor);
  // Surround (architrave) and sill.
  if (d.surround || o.kind === 'entrance') {
    const s = o.kind === 'entrance' ? 0.22 : 0.16;
    wbox(g, 'ext-trim', w.axis, face, sgn, t0 - s, t0, 0, 0.05, o.y0, o.y1 + s);
    wbox(g, 'ext-trim', w.axis, face, sgn, t1, t1 + s, 0, 0.05, o.y0, o.y1 + s);
    wbox(g, 'ext-trim', w.axis, face, sgn, t0 - s, t1 + s, 0, 0.05, o.y1, o.y1 + s);
  }
  if (o.glazed && o.y0 > bp.levels[w.level]!.floorY + 0.1) wbox(g, 'ext-trim', w.axis, face, sgn, t0 - 0.12, t1 + 0.12, 0, 0.14, o.y0 - 0.1, o.y0);
  if (d.keystone) {
    const c = (t0 + t1) / 2;
    wbox(g, 'ext-trim', w.axis, face, sgn, c - 0.13, c + 0.13, 0, 0.08, o.y1 - 0.05, o.y1 + 0.3);
  }
  const top = o.y1 + (d.surround ? 0.16 : 0);
  if (d.pediment || o.kind === 'entrance') {
    const a = t0 - 0.3;
    const b = t1 + 0.3;
    const yb = top + 0.16;
    wbox(g, 'ext-trim', w.axis, face, sgn, a, b, 0, 0.2, top + 0.02, yb);
    const kind = o.kind === 'entrance' ? 'triangle' : d.pediment!;
    const n0 = face + sgn * 0.02;
    const n1 = face + sgn * 0.19;
    const P = (t: number, y: number, n: number): [number, number, number] => (w.axis === 'x' ? [t, y, n] : [n, y, t]);
    const out: [number, number, number] = w.axis === 'x' ? [0, 0, sgn] : [sgn, 0, 0];
    if (kind === 'triangle') {
      const hgt = Math.min(0.55, (b - a) * 0.22);
      const m = (a + b) / 2;
      g.triFacing('ext-trim', P(a, yb, n1), P(b, yb, n1), P(m, yb + hgt, n1), ...out);
      g.quadFacing('ext-trim', P(a, yb, n0), P(a, yb, n1), P(m, yb + hgt, n1), P(m, yb + hgt, n0), -1 * (w.axis === 'x' ? 1 : 0), 1, -1 * (w.axis === 'z' ? 1 : 0));
      g.quadFacing('ext-trim', P(m, yb + hgt, n0), P(m, yb + hgt, n1), P(b, yb, n1), P(b, yb, n0), w.axis === 'x' ? 1 : 0, 1, w.axis === 'z' ? 1 : 0);
    } else {
      // Segmental: a shallow arc band (front face + curved top), not stepped slabs.
      const hgt = Math.min(0.4, (b - a) * 0.16);
      const steps = 16;
      const band = 0.16;
      const yArc = (u: number) => yb + Math.sin(u * Math.PI) * hgt;
      for (let i = 0; i < steps; i++) {
        const u0 = i / steps;
        const u1 = (i + 1) / steps;
        const ta = a + (b - a) * u0;
        const tb = a + (b - a) * u1;
        const ya = yArc(u0);
        const yc = yArc(u1);
        // Front face of the band between the arc and an offset arc below it.
        g.quadFacing('ext-trim', P(ta, Math.max(yb, ya - band), n1), P(tb, Math.max(yb, yc - band), n1), P(tb, yc + 0.06, n1), P(ta, ya + 0.06, n1), ...out);
        // Curved top surface.
        g.quadFacing('ext-trim', P(ta, ya + 0.06, n0), P(tb, yc + 0.06, n0), P(tb, yc + 0.06, n1), P(ta, ya + 0.06, n1), 0, 1, 0);
      }
      // Tympanum fill under the arc.
      for (let i = 0; i < steps; i++) {
        const u0 = i / steps;
        const u1 = (i + 1) / steps;
        const ta = a + (b - a) * u0;
        const tb = a + (b - a) * u1;
        g.quadFacing('ext-trim', P(ta, yb, n1 - (sgn * 0.04)), P(tb, yb, n1 - sgn * 0.04), P(tb, Math.max(yb, yArc(u1) - band), n1 - sgn * 0.04), P(ta, Math.max(yb, yArc(u0) - band), n1 - sgn * 0.04), ...out);
      }
    }
  }
  if (d.balconette) {
    const y = o.y0;
    g.setTint('#ffffff');
    wbox(g, 'ext-trim', w.axis, face, sgn, t0 - 0.2, t1 + 0.2, 0, 0.42, y - 0.12, y);
    wbox(g, 'iron', w.axis, face, sgn, t0 - 0.15, t1 + 0.15, 0.36, 0.39, y + 0.85, y + 0.89);
    for (let t = t0 - 0.12; t <= t1 + 0.13; t += 0.12) wbox(g, 'iron', w.axis, face, sgn, t - 0.009, t + 0.009, 0.36, 0.38, y, y + 0.86);
    for (const t of [t0 - 0.15, t1 + 0.15]) wbox(g, 'iron', w.axis, face, sgn, t - 0.01, t + 0.01, 0.02, 0.38, y + 0.84, y + 0.88);
  }
  joinery(ctx, w, o, line, room);
}

/** Frames, glazing bars, glass, door leaves and curtains for one exterior opening. */
function joinery(ctx: ArchContext, w: Wall, o: Opening, line: number, room: Room | undefined): void {
  const { g, style, rand } = ctx;
  const base = wallT0(w);
  const t0 = base + o.u0;
  const t1 = base + o.u1;
  const sgn = outwardSign(w);
  // Joinery plane: a third of the way in from the outer face.
  const plane = line + sgn * (w.thickness / 2 - 0.16);
  const fw = 0.07;
  const fd = 0.07;
  g.scope = -1;
  g.setTint(style.windowFrameColor);
  const fb = (a: number, b: number, y0: number, y1: number, dd = fd, key = 'frame') => wbox(g, key, w.axis, plane, sgn, a, b, -dd / 2, dd / 2, y0, y1);
  if (o.kind === 'entrance') {
    g.setTint(style.doorColor);
    const doorTop = o.y1 - 0.85;
    const mid = (t0 + t1) / 2;
    fb(t0, mid - 0.005, o.y0, doorTop, 0.09, 'door');
    fb(mid + 0.005, t1, o.y0, doorTop, 0.09, 'door');
    // Raised panels.
    for (const [a, b] of [
      [t0 + 0.12, mid - 0.12],
      [mid + 0.12, t1 - 0.12],
    ] as const) {
      for (const [y0, y1] of [
        [o.y0 + 0.25, o.y0 + 1.1],
        [o.y0 + 1.3, doorTop - 0.2],
      ] as const) {
        wbox(g, 'door', w.axis, plane, sgn, a, b, 0.045, 0.07, y0, y1);
      }
    }
    // Fanlight.
    g.setTint(style.windowFrameColor);
    fb(t0, t1, doorTop, doorTop + 0.08);
    fb(t0, t1, o.y1 - 0.06, o.y1);
    for (let i = 1; i < 6; i++) {
      const t = t0 + ((t1 - t0) * i) / 6;
      fb(t - 0.015, t + 0.015, doorTop + 0.08, o.y1 - 0.06, 0.04);
    }
    g.setTint('#ffffff');
    vquad(g, room && room.lit > 0 ? 'glass-lit' : 'glass', w.axis, plane, sgn, t0, t1, doorTop + 0.08, o.y1 - 0.06);
    return;
  }
  if (!o.glazed) return;
  // Outer frame.
  fb(t0, t0 + fw, o.y0, o.y1);
  fb(t1 - fw, t1, o.y0, o.y1);
  fb(t0, t1, o.y1 - fw, o.y1);
  fb(t0, t1, o.y0, o.y0 + (o.kind === 'french-window' ? 0.14 : fw));
  const leaves = o.leaves ?? 1;
  const [cols, rows] = o.panes ?? [2, 3];
  const inner0 = t0 + fw;
  const inner1 = t1 - fw;
  const iy0 = o.y0 + (o.kind === 'french-window' ? 0.14 : fw);
  const iy1 = o.y1 - fw;
  const leafW = (inner1 - inner0) / leaves;
  for (let l = 0; l < leaves; l++) {
    const a = inner0 + l * leafW;
    const b = a + leafW;
    if (l > 0) fb(a - 0.035, a + 0.035, iy0, iy1, fd * 1.1);
    for (let i = 1; i < cols; i++) {
      const t = a + ((b - a) * i) / cols;
      fb(t - 0.013, t + 0.013, iy0, iy1, 0.035);
    }
    for (let j = 1; j < rows; j++) {
      const y = iy0 + ((iy1 - iy0) * j) / rows;
      const thick = o.kind === 'window' && j === rows / 2 ? 0.04 : 0.013;
      fb(a, b, y - thick, y + thick, thick > 0.02 ? fd : 0.035);
    }
    if (o.kind === 'french-window') fb(a, b, iy0, iy0 + 0.45, 0.05); // kick panel
  }
  if (!o.frosted) {
    g.setTint('#ffffff');
    vquad(g, 'glass', w.axis, plane + sgn * 0.005, sgn, inner0, inner1, iy0, iy1);
  } else {
    g.setTint('#ffffff');
    g.scope = room ? room.index : -1;
    vquad(g, 'sheer', w.axis, plane - sgn * 0.01, sgn, inner0, inner1, iy0, iy1);
    g.scope = -1;
  }
  if (!room) return;
  // Curtains inside.
  g.scope = room.index;
  g.setTint(room.finish.drapery);
  const inFace = line - sgn * (w.thickness / 2);
  const isg = (-sgn) as 1 | -1;
  const yTop = Math.min(o.y1 + 0.35, room.ceilingY - 0.3);
  const yBot = room.floorY + 0.02;
  if (o.curtain === 'drawn') {
    pleat(g, w.axis, inFace, isg, t0 - 0.25, t1 + 0.25, yBot, yTop, 0.1, 0.06);
  } else {
    // Drapes overlap the glass so they frame the window from outside.
    const over = Math.min(0.32, (t1 - t0) * 0.18) * (0.8 + rand() * 0.4);
    pleat(g, w.axis, inFace, isg, t0 - 0.32, t0 + over, yBot, yTop, 0.09, 0.07);
    pleat(g, w.axis, inFace, isg, t1 - over, t1 + 0.32, yBot, yTop, 0.09, 0.07);
    if (o.curtain === 'sheer') {
      g.setTint('#ffffff');
      vquad(g, 'sheer', w.axis, inFace + isg * 0.06, isg, t0 - 0.1, t1 + 0.1, iy0, yTop - 0.2);
      vquad(g, 'sheer', w.axis, inFace + isg * 0.06, (-isg) as 1 | -1, t0 - 0.1, t1 + 0.1, iy0, yTop - 0.2);
      g.setTint(room.finish.drapery);
    }
  }
  // Pelmet.
  wbox(g, 'fabric', w.axis, inFace, isg, t0 - 0.38, t1 + 0.38, 0, 0.16, yTop - 0.32, yTop);
  g.scope = -1;
}

/** Pleated drape: a zig-zag surface hanging off a wall face, facing into the room. */
function pleat(g: GeometryBuilder, axis: 'x' | 'z', face: number, sgn: 1 | -1, t0: number, t1: number, y0: number, y1: number, depth: number, pitch: number): void {
  const n = Math.max(2, Math.round((t1 - t0) / pitch));
  const P = (t: number, y: number, d: number): [number, number, number] => (axis === 'x' ? [t, y, face + sgn * d] : [face + sgn * d, y, t]);
  const nx = axis === 'z' ? sgn : 0;
  const nz = axis === 'x' ? sgn : 0;
  for (let i = 0; i < n; i++) {
    const a = t0 + ((t1 - t0) * i) / n;
    const b = t0 + ((t1 - t0) * (i + 1)) / n;
    const da = i % 2 ? depth : 0.02;
    const db = i % 2 ? 0.02 : depth;
    g.quadFacing('fabric', P(a, y0, da), P(b, y0, db), P(b, y1, db), P(a, y1, da), nx, 0, nz);
  }
}

/** Conservatory curtain wall: low stone sill, white glazing frame grid, glass. */
function buildCurtainWall(ctx: ArchContext, w: Wall, face: number, sgn: 1 | -1, t0: number, t1: number): void {
  const { g, style } = ctx;
  const line = wallLine(w);
  const y0 = w.y0;
  const sill = y0 + 0.55;
  g.scope = -1;
  g.setTint(style.trimColor);
  wbox(g, 'ext-trim', w.axis, line, sgn, t0, t1, -0.12, 0.18, -0.4, sill);
  g.setTint('#f4f2ec');
  const yTop = w.y1;
  wbox(g, 'frame', w.axis, line, sgn, t0, t1, -0.05, 0.05, yTop - 0.12, yTop);
  wbox(g, 'frame', w.axis, line, sgn, t0, t1, -0.05, 0.05, sill, sill + 0.08);
  const n = Math.max(2, Math.round((t1 - t0) / 0.9));
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    wbox(g, 'frame', w.axis, line, sgn, t - 0.035, t + 0.035, -0.05, 0.05, sill, yTop);
  }
  for (const f of [0.55, 0.82]) {
    const y = sill + (yTop - sill) * f;
    wbox(g, 'frame', w.axis, line, sgn, t0, t1, -0.03, 0.03, y - 0.02, y + 0.02);
  }
  for (const o of w.openings) {
    const base = wallT0(w);
    const a = base + o.u0;
    const b = base + o.u1;
    if (o.passable) continue;
    g.setTint('#ffffff');
    vquad(g, 'glass', w.axis, line, sgn, Math.max(a, t0), Math.min(b, t1), o.y0 + 0.08, o.y1 - 0.12);
  }
  void face;
}
