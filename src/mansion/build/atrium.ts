/**
 * Dome hall mesher: ring galleries with balustrades, the curved split stair,
 * gallery columns, the rotunda's curved wall, the oculus ceiling, and outside,
 * the drum and glass dome standing through the roof.
 */
import type { Rect, Vec2 } from '../core/geom';
import { roofSurfaceY } from '../core/roofs';
import type { Atrium, Room, StairArm, Wall } from '../core/types';
import { archFill, archSoffit, vquad, wallMaterialKey, wbox, type ArchContext } from './arch';
import { pointInPoly } from '../layout/atrium';
import { ALL, PY, type GeometryBuilder, type V3 } from './geometry';

const tup = (p: Vec2): [number, number] => [p.x, p.z];
const STONE = '#ece6da';

/** Turned baluster (interior or exterior stone). */
function turned(g: GeometryBuilder, key: string, x: number, z: number, y: number, h: number): void {
  g.frame(x, y, z, 0);
  g.lathe(
    key,
    0,
    0,
    [
      [0.06, 0],
      [0.06, h * 0.08],
      [0.045, h * 0.14],
      [0.085, h * 0.38],
      [0.05, h * 0.7],
      [0.04, h * 0.82],
      [0.06, h * 0.9],
      [0.06, h],
    ],
    6,
    false,
  );
  g.frame();
}

/** Arc-length walker over a plan polyline. */
function walker(pts: Vec2[]): { total: number; at: (s: number) => { x: number; z: number; tx: number; tz: number } } {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  const total = cum[cum.length - 1]!;
  return {
    total,
    at(s: number) {
      const t = Math.max(0, Math.min(total, s));
      let i = 1;
      while (i < cum.length - 1 && cum[i]! < t) i++;
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const span = cum[i]! - cum[i - 1]! || 1;
      const k = (t - cum[i - 1]!) / span;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, tx: (b.x - a.x) / span, tz: (b.z - a.z) / span };
    },
  };
}

/** Stone balustrade along a plan polyline at floor height y. */
function balustrade(g: GeometryBuilder, key: string, pts: Vec2[], y: number): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    g.beam(key, [a.x, y + 0.06, a.z], [b.x, y + 0.06, b.z], 0.2, 0.12);
    g.beam(key, [a.x, y + 0.99, a.z], [b.x, y + 0.99, b.z], 0.22, 0.1);
  }
  const w = walker(pts);
  const n = Math.max(1, Math.round(w.total / 0.3));
  for (let k = 0; k <= n; k++) {
    const p = w.at((w.total * k) / n);
    if (k === 0 || k === n) g.box(key, p.x - 0.13, y, p.z - 0.13, p.x + 0.13, y + 1.1, p.z + 0.13);
    else turned(g, key, p.x, p.z, y + 0.12, 0.82);
  }
}

function column(g: GeometryBuilder, key: string, x: number, z: number, r: number, y0: number, y1: number): void {
  g.box(key, x - r * 1.45, y0, z - r * 1.45, x + r * 1.45, y0 + 0.16, z + r * 1.45);
  const b = y0 + 0.16;
  const cap = y1 - 0.3;
  g.lathe(
    key,
    x,
    z,
    [
      [r * 1.3, b],
      [r * 1.3, b + 0.06],
      [r * 1.08, b + 0.14],
      [r, b + 0.22],
      [r * 0.98, b + (cap - b) * 0.35],
      [r * 0.86, cap],
      [r * 0.95, cap + 0.05],
      [r * 1.3, cap + 0.2],
    ],
    12,
    false,
  );
  g.box(key, x - r * 1.45, y1 - 0.1, z - r * 1.45, x + r * 1.45, y1, z + r * 1.45);
}

/** One curved arm: treads, risers, sloping soffit, stringers and a balustrade each side. */
function stairArm(g: GeometryBuilder, arm: StairArm): void {
  const w = walker(arm.path);
  const tread = w.total / arm.steps;
  const riser = arm.rise / arm.steps;
  const hw = arm.width / 2;
  const key = 'marble';
  const edge = (s: number) => {
    const p = w.at(s);
    // Left of travel.
    const nx = -p.tz;
    const nz = p.tx;
    return { p, nx, nz, L: [p.x + nx * hw, p.z + nz * hw] as const, R: [p.x - nx * hw, p.z - nz * hw] as const };
  };
  const rails: V3[][] = [[], []];
  g.setTint(STONE);
  for (let i = 0; i < arm.steps; i++) {
    const A = edge(i * tread);
    const B = edge((i + 1) * tread);
    const yPrev = arm.y0 + i * riser;
    const yTop = arm.y0 + (i + 1) * riser;
    const uA = Math.max(arm.y0, yPrev - 0.3);
    const uB = Math.max(arm.y0, yTop - 0.3);
    // The top tread is the gallery floor itself; its own surface sits a hair lower so the two never share a plane.
    const yTread = i === arm.steps - 1 ? yTop - 0.012 : yTop;
    g.quadFacing(key, [A.L[0], yTread, A.L[1]], [A.R[0], yTread, A.R[1]], [B.R[0], yTread, B.R[1]], [B.L[0], yTread, B.L[1]], 0, 1, 0);
    g.quadFacing(key, [A.L[0], yPrev, A.L[1]], [A.R[0], yPrev, A.R[1]], [A.R[0], yTop, A.R[1]], [A.L[0], yTop, A.L[1]], -A.p.tx, 0, -A.p.tz);
    if (uB > arm.y0 + 1e-3) g.quadFacing(key, [A.L[0], uA, A.L[1]], [A.R[0], uA, A.R[1]], [B.R[0], uB, B.R[1]], [B.L[0], uB, B.L[1]], 0, -1, 0);
    g.quadFacing(key, [A.L[0], uA, A.L[1]], [B.L[0], uB, B.L[1]], [B.L[0], yTop, B.L[1]], [A.L[0], yTop, A.L[1]], A.nx, 0, A.nz);
    g.quadFacing(key, [A.R[0], uA, A.R[1]], [B.R[0], uB, B.R[1]], [B.R[0], yTop, B.R[1]], [A.R[0], yTop, A.R[1]], -A.nx, 0, -A.nz);
    // Balusters on both edges of the tread.
    const M = edge((i + 0.5) * tread);
    const inset = hw - 0.09;
    [1, -1].forEach((side, k) => {
      const x = M.p.x + M.nx * inset * side;
      const z = M.p.z + M.nz * inset * side;
      if (i === 0) g.box(key, x - 0.12, yPrev, z - 0.12, x + 0.12, yTop + 1.08, z + 0.12);
      else turned(g, key, x, z, yTop, 0.9);
      rails[k]!.push([x, yTop + 0.95, z]);
    });
  }
  // Handrails, run on to the gallery balustrade height at the top.
  for (const rail of rails) {
    const end = edge(w.total);
    const side = rail === rails[0] ? 1 : -1;
    rail.push([end.p.x + end.nx * (hw - 0.09) * side, arm.y0 + arm.rise + 0.99, end.p.z + end.nz * (hw - 0.09) * side]);
    for (let i = 0; i + 1 < rail.length; i++) g.beam(key, rail[i]!, rail[i + 1]!, 0.2, 0.1);
  }
}

/** Openings in the rectangular walls of a room, as plan spans, so the rotunda's curved wall can leave doorways. */
function doorways(walls: Wall[], roomId: string): { axis: 'x' | 'z'; line: number; t0: number; t1: number; y1: number }[] {
  const out: { axis: 'x' | 'z'; line: number; t0: number; t1: number; y1: number }[] = [];
  for (const w of walls) {
    if (w.neg !== roomId && w.pos !== roomId) continue;
    const base = w.axis === 'x' ? w.a.x : w.a.z;
    const line = w.axis === 'x' ? w.a.z : w.a.x;
    for (const o of w.openings) out.push({ axis: w.axis, line, t0: base + o.u0 - 0.14, t1: base + o.u1 + 0.14, y1: o.y1 });
  }
  return out;
}

function curvedWall(ctx: ArchContext, a: Atrium, run: Vec2[], room: Room, y0: number, y1: number): void {
  const { g, bp } = ctx;
  const f = room.finish;
  const key = `wall-${f.wall}`;
  const doors = doorways(bp.walls, room.id);
  const cx = a.dome.x;
  const cz = a.dome.z;
  const w = walker(run);
  g.setTint(f.wallColor);
  let s = 0;
  let prevDoor: (typeof doors)[number] | undefined;
  const hit = (p: Vec2) => doors.find((d) => (d.axis === 'x' ? p.x > d.t0 && p.x < d.t1 && Math.abs(p.z - d.line) < 1.1 : p.z > d.t0 && p.z < d.t1 && Math.abs(p.x - d.line) < 1.1));
  const face = (p: Vec2, q: Vec2, ya: number, yb: number, sa: number, sb: number) => {
    if (yb - ya < 1e-3) return;
    const mx = (p.x + q.x) / 2;
    const mz = (p.z + q.z) / 2;
    const A: V3 = [p.x, ya, p.z];
    const B: V3 = [q.x, ya, q.z];
    const C: V3 = [q.x, yb, q.z];
    const D: V3 = [p.x, yb, p.z];
    const e1 = [q.x - p.x, 0, q.z - p.z];
    // Normal of (A,B,C,D) is e1 × up; flip so the face looks into the hall.
    const nx = -e1[2]!;
    const nz = e1[0]!;
    const inward = nx * (cx - mx) + nz * (cz - mz) >= 0;
    const uv: [number, number][] = [
      [sa, ya - room.floorY],
      [sb, ya - room.floorY],
      [sb, yb - room.floorY],
      [sa, yb - room.floorY],
    ];
    if (inward) g.quad(key, A, B, C, D, uv);
    else g.quad(key, B, A, D, C, [uv[1]!, uv[0]!, uv[3]!, uv[2]!]);
  };
  for (let i = 0; i + 1 < run.length; i++) {
    const p = run[i]!;
    const q = run[i + 1]!;
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const door = hit({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
    if (door && door.y1 > y0 + 0.5) face(p, q, Math.min(y1, door.y1), y1, s, s + len);
    else face(p, q, y0, y1, s, s + len);
    // Jamb where the wall stops for a doorway: return to the flat wall behind.
    const jambDoor = door && door.y1 > y0 + 0.5 ? door : undefined;
    if (jambDoor !== prevDoor) {
      const d = (jambDoor ?? prevDoor)!;
      const back: Vec2 = d.axis === 'x' ? { x: p.x, z: d.line } : { x: d.line, z: p.z };
      const top = Math.min(y1, d.y1);
      g.setTint(f.trimColor);
      g.quad('int-trim', [p.x, y0, p.z], [back.x, y0, back.z], [back.x, top, back.z], [p.x, top, p.z]);
      g.quad('int-trim', [back.x, y0, back.z], [p.x, y0, p.z], [p.x, top, p.z], [back.x, top, back.z]);
      g.setTint(f.wallColor);
    }
    prevDoor = jambDoor;
    s += len;
  }
  void w;
}

export function buildAtrium(ctx: ArchContext): void {
  const { bp, g, rooms } = ctx;
  const a = bp.atrium;
  if (!a) return;
  const hall = rooms.get(a.roomId)!;
  const f = hall.finish;
  const levels = bp.levels;
  const top = levels[levels.length - 1]!;
  const roomAt = (level: number): Room => (level === 0 ? hall : rooms.get(a.galleries.find((q) => q.level === level)!.roomId)!);
  const cx = a.dome.x;
  const cz = a.dome.z;

  for (const gl of a.galleries) {
    const room = rooms.get(gl.roomId)!;
    const below = roomAt(gl.level - 1);
    const soffit = levels[gl.level - 1]!.ceilingY;
    g.scope = room.index;
    g.setTint(f.floorColor);
    g.flatPoly(`floor-${f.floor}`, gl.outline.map(tup), gl.y, true);
    g.scope = below.index;
    g.setTint(f.ceilingColor);
    g.flatPoly('ceiling', gl.outline.map(tup), soffit, false);
    // Slab edge facing the void.
    g.setTint(f.trimColor);
    for (const rail of gl.rails) {
      for (let i = 0; i + 1 < rail.length; i++) {
        const p = rail[i]!;
        const q = rail[i + 1]!;
        const nx = -(q.z - p.z);
        const nz = q.x - p.x;
        const sgn = nx * (cx - (p.x + q.x) / 2) + nz * (cz - (p.z + q.z) / 2) >= 0 ? 1 : -1;
        g.quadFacing('int-trim', [p.x, soffit, p.z], [q.x, soffit, q.z], [q.x, gl.y, q.z], [p.x, gl.y, p.z], nx * sgn, 0, nz * sgn);
      }
    }
    // The floor zone on the garden wall, which no gallery covers.
    g.quadFacing('int-trim', [a.inner.x0, soffit, a.inner.z1], [a.inner.x1, soffit, a.inner.z1], [a.inner.x1, gl.y, a.inner.z1], [a.inner.x0, gl.y, a.inner.z1], 0, 0, -1);
    g.scope = room.index;
    for (const rail of gl.rails) balustrade(g, 'int-trim', rail, gl.y);
  }

  // Columns under the gallery edge, storey by storey.
  g.setTint(STONE);
  // A column carries the gallery above it, so the top gallery, open to the glass roof, has none.
  for (const lv of levels) {
    if (lv.index >= top.index) continue;
    g.scope = roomAt(lv.index).index;
    for (const c of a.columns) column(g, 'marble', c.x, c.z, a.columnRadius, lv.floorY, lv.ceilingY);
  }

  // The stair.
  g.scope = hall.index;
  const stair = bp.stairs.find((s) => s.id === a.stairId);
  for (const arm of stair?.arms ?? []) stairArm(g, arm);

  // No ceiling: above the top storey the hall's walls go on as a glazed attic under a glass roof (see buildDome).

  // Rotunda: the curved wall, full height, and the dead corners behind it.
  for (const run of a.curvedWalls) {
    for (const lv of levels) {
      const room = roomAt(lv.index);
      g.scope = room.index;
      g.vOffset = 0;
      curvedWall(ctx, a, run, room, lv.floorY, lv.index === top.index ? lv.ceilingY : levels[lv.index + 1]!.floorY);
    }
    // Solid in plan: the corner behind the curve is masonry, not floor.
    g.scope = hall.index;
    g.setTint('#050505');
    const corner: Vec2 = { x: run[run.length - 1]!.x, z: run[0]!.z };
    g.flatPoly('lacquer', [...run.map(tup), tup(corner)], hall.floorY + 0.03, true);
  }

  // Chain from the crown of the dome to the chandelier.
  const fitting = bp.props.find((p) => p.roomId === hall.id && p.kind === 'chandelier' && p.w > 2.5);
  if (fitting) {
    g.scope = hall.index;
    g.setTint('#ffffff');
    g.beam('brass', [fitting.x, fitting.y + fitting.h, fitting.z], [cx, a.dome.springY + a.dome.height, cz], 0.05);
  }
  g.scope = -1;
}

/** Plan rectangle of the hall's lantern (the inside face of its attic walls); the house roof is opened here. */
export function domeBase(a: Atrium): Rect {
  return { x0: a.inner.x0, z0: a.inner.z0, x1: a.inner.x1, z1: a.inner.z1 };
}

const ATTIC_T = 0.42;

/**
 * Outside, above the eaves: the hall goes on up as a glazed attic, clear of every roof round it,
 * so the house roof simply dies into its walls. On the attic a glass roof spans the hall, and from
 * that a glazed drum carries the glass dome. Call after the roofs.
 */
export function buildDome(ctx: ArchContext, roofMark: Map<string, number>): void {
  const { bp, g, style } = ctx;
  const a = bp.atrium;
  if (!a) return;
  const d = a.dome;
  const base = domeBase(a);
  // Everything the roofs put over the hall goes: slates, ridge trims, glazing bars.
  g.cutRectHole(roofMark, () => true, { x0: base.x0 - ATTIC_T + 0.04, z0: base.z0 - ATTIC_T + 0.04, x1: base.x1 + ATTIC_T - 0.04, z1: base.z1 + ATTIC_T - 0.04 });
  const main = bp.masses.find((m) => m.kind === 'main')!;
  const eave = main.roof.eaveY;
  const y0 = eave - 0.3;
  const R = d.radius;
  const topGallery = a.galleries[a.galleries.length - 1];
  const inside = bp.rooms.find((r) => r.id === (topGallery?.roomId ?? a.roomId))?.index ?? -1;
  const wallKey = wallMaterialKey(style);
  const wallTint = style.wallMaterial === 'brick' ? '#ffffff' : style.wallColor;

  // Attic: stone sill and entablature, piers, arched lights between them. Each wall is built as an
  // outer skin (weather side, lit by the sky) and an inner skin (lit with the top gallery).
  const sill = eave + 0.5;
  const head = d.deckY - 0.4;
  const sides: { axis: 'x' | 'z'; line: number; sgn: 1 | -1; t0: number; t1: number }[] = [
    { axis: 'x', line: base.z1, sgn: 1, t0: base.x0 - ATTIC_T, t1: base.x1 + ATTIC_T },
    { axis: 'x', line: base.z0, sgn: -1, t0: base.x0 - ATTIC_T, t1: base.x1 + ATTIC_T },
    { axis: 'z', line: base.x1, sgn: 1, t0: base.z0, t1: base.z1 },
    { axis: 'z', line: base.x0, sgn: -1, t0: base.z0, t1: base.z1 },
  ];
  for (const sd of sides) {
    const n = Math.max(2, Math.round((sd.t1 - sd.t0) / 2.3));
    const step = (sd.t1 - sd.t0) / n;
    const pier = 0.24;
    // Corner piers are wider; every light starts where its piers end, so no glass is buried in stone.
    const pierAt = (i: number) => (i === 0 || i === n ? pier + ATTIC_T : pier);
    const half = ATTIC_T / 2;
    const skins: { n0: number; n1: number; scope: number; stone: string; tint: string; trim: string; face: number; fsgn: 1 | -1 }[] = [
      { n0: half, n1: ATTIC_T, scope: -1, stone: wallKey, tint: wallTint, trim: 'ext-trim', face: ATTIC_T, fsgn: sd.sgn },
      { n0: 0, n1: half, scope: inside, stone: 'int-trim', tint: STONE, trim: 'int-trim', face: 0, fsgn: (-sd.sgn) as 1 | -1 },
    ];
    // How high the roof outside stands against each light: below that the light is blind (stone).
    const blind: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = sd.t0 + (i + 0.5) * step;
      const out = sd.line + sd.sgn * (ATTIC_T + 0.25);
      const roof = sd.axis === 'x' ? roofSurfaceY(bp.masses, t, out) : roofSurfaceY(bp.masses, out, t);
      blind.push(Number.isFinite(roof) ? Math.max(sill, roof + 0.25) : sill);
    }
    for (const sk of skins) {
      g.scope = sk.scope;
      g.setTint(sk.tint);
      wbox(g, sk.stone, sd.axis, sd.line, sd.sgn, sd.t0, sd.t1, sk.n0, sk.n1, y0, sill);
      // No top face: the lead of the glass roof's border lies on this plane.
      wbox(g, sk.stone, sd.axis, sd.line, sd.sgn, sd.t0, sd.t1, sk.n0, sk.n1, head, d.deckY, ALL & ~PY);
      for (let i = 0; i <= n; i++) {
        const t = sd.t0 + i * step;
        wbox(g, sk.stone, sd.axis, sd.line, sd.sgn, Math.max(sd.t0, t - pierAt(i)), Math.min(sd.t1, t + pierAt(i)), sk.n0, sk.n1, sill, head);
      }
      const plane = sd.line + sd.sgn * sk.face;
      for (let i = 0; i < n; i++) {
        const ta = sd.t0 + i * step + pierAt(i);
        const tb = sd.t0 + (i + 1) * step - pierAt(i + 1);
        const rise = Math.min((tb - ta) / 2, (head - sill) * 0.45);
        if (blind[i]! > head - rise - 0.5) {
          wbox(g, sk.stone, sd.axis, sd.line, sd.sgn, ta, tb, sk.n0, sk.n1, sill, head);
          continue;
        }
        if (blind[i]! > sill) wbox(g, sk.stone, sd.axis, sd.line, sd.sgn, ta, tb, sk.n0, sk.n1, sill, blind[i]!);
        g.setTint(sk.tint);
        archFill(g, sk.stone, sd.axis, plane, sk.fsgn, ta, tb, head, rise);
        g.setTint(sk.scope < 0 ? style.trimColor : STONE);
        archFill(g, sk.trim, sd.axis, plane + sk.fsgn * 0.012, sk.fsgn, ta, tb, head, rise, 0.1);
        g.setTint(sk.tint);
      }
    }
    // Glass and its bars, once, in the middle of the wall.
    g.scope = -1;
    const mid = sd.line + sd.sgn * half;
    for (let i = 0; i < n; i++) {
      const ta = sd.t0 + i * step + pierAt(i);
      const tb = sd.t0 + (i + 1) * step - pierAt(i + 1);
      const rise = Math.min((tb - ta) / 2, (head - sill) * 0.45);
      const lo = blind[i]!;
      if (lo > head - rise - 0.5) continue;
      g.setTint('#ffffff');
      vquad(g, 'glass', sd.axis, mid, sd.sgn, ta, tb, lo, head);
      g.setTint(style.windowFrameColor);
      const tm = (ta + tb) / 2;
      wbox(g, 'frame', sd.axis, mid, sd.sgn, tm - 0.025, tm + 0.025, -0.03, 0.03, lo, head);
      wbox(g, 'frame', sd.axis, mid, sd.sgn, ta, tb, -0.03, 0.03, head - rise - 0.03, head - rise + 0.03);
      wbox(g, 'frame', sd.axis, mid, sd.sgn, ta, tb, -0.03, 0.03, lo, lo + 0.07);
      archSoffit(g, 'frame', sd.axis, mid - 0.03, mid + 0.03, ta, tb, head, rise);
    }
    // Cornice.
    g.setTint(style.trimColor);
    wbox(g, 'ext-trim', sd.axis, sd.line, sd.sgn, sd.t0 - (sd.axis === 'x' ? 0.22 : 0), sd.t1 + (sd.axis === 'x' ? 0.22 : 0), ATTIC_T, ATTIC_T + 0.1, d.deckY - 0.5, d.deckY - 0.3);
    wbox(g, 'ext-trim', sd.axis, sd.line, sd.sgn, sd.t0 - (sd.axis === 'x' ? 0.34 : 0), sd.t1 + (sd.axis === 'x' ? 0.34 : 0), ATTIC_T, ATTIC_T + 0.22, d.deckY - 0.16, d.deckY + 0.06);
  }

  // The glass roof on the attic, the drum rising from the middle of it.
  g.scope = -1;
  const deck = d.deckY;
  const corners: [number, number][] = [
    [base.x0 - ATTIC_T, base.z0 - ATTIC_T],
    [base.x1 + ATTIC_T, base.z0 - ATTIC_T],
    [base.x1 + ATTIC_T, base.z1 + ATTIC_T],
    [base.x0 - ATTIC_T, base.z1 + ATTIC_T],
  ];
  const seg = 56;
  const circle = (r: number): [number, number][] => Array.from({ length: seg }, (_, i) => [d.x + Math.cos((i / seg) * Math.PI * 2) * r, d.z + Math.sin((i / seg) * Math.PI * 2) * r]);
  const foot = a.footprint.map(tup);
  g.setTint('#ffffff');
  g.flatPoly('roof-lead', corners, deck, true, [foot]);
  g.flatPoly('roof-glass', foot, deck, true, [circle(R + 0.3)]);
  g.setTint(style.windowFrameColor);
  const inFoot = (x: number, z: number) => pointInPoly(a.footprint, x, z);
  const bar = (x0: number, z0: number, x1: number, z1: number, w: number) => {
    // Glazing bar, drawn only where it runs over glass outside the drum.
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.4));
    let from: [number, number] | null = null;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = z0 + ((z1 - z0) * i) / n;
      const on = Math.hypot(x - d.x, z - d.z) > R + 0.3 && inFoot(x, z);
      if (on && !from) from = [x, z];
      if (from && (!on || i === n)) {
        const to: [number, number] = on ? [x, z] : [x0 + ((x1 - x0) * (i - 1)) / n, z0 + ((z1 - z0) * (i - 1)) / n];
        if (Math.hypot(to[0] - from[0], to[1] - from[1]) > 0.3) g.beam('frame', [from[0], deck + 0.075, from[1]], [to[0], deck + 0.075, to[1]], w, 0.08);
        from = null;
      }
    }
  };
  const nxBars = Math.max(2, Math.round((base.x1 - base.x0) / 0.8));
  for (let i = 1; i < nxBars; i++) {
    const x = base.x0 + ((base.x1 - base.x0) * i) / nxBars;
    bar(x, base.z0, x, base.z1, i % 4 === 0 ? 0.12 : 0.05);
  }
  const nzBars = Math.max(2, Math.round((base.z1 - base.z0) / 3.2));
  for (let i = 1; i < nzBars; i++) {
    const z = base.z0 + ((base.z1 - base.z0) * i) / nzBars;
    bar(base.x0, z, base.x1, z, 0.12);
  }

  // Drum: a stone kerb, slender piers with arched lights between, and a cornice ring under the dome.
  const ribs = R > 6 ? 24 : 16;
  const dy0 = deck + 0.35;
  const dy1 = d.springY - 0.3;
  g.setTint(style.trimColor);
  g.lathe(
    'ext-trim',
    d.x,
    d.z,
    [
      [R + 0.5, deck],
      [R + 0.5, deck + 0.22],
      [R + 0.36, dy0],
      [R + 0.02, dy0],
    ],
    seg,
    false,
  );
  g.lathe(
    'ext-trim',
    d.x,
    d.z,
    [
      [R + 0.04, dy1],
      [R + 0.3, dy1],
      [R + 0.34, dy1 + 0.12],
      [R + 0.46, dy1 + 0.2],
      [R + 0.46, d.springY],
      [R + 0.06, d.springY],
    ],
    seg,
    false,
  );
  const ring = (t: number, r: number): [number, number] => [d.x + Math.cos(t) * r, d.z + Math.sin(t) * r];
  for (let i = 0; i < ribs; i++) {
    const t0 = (i / ribs) * Math.PI * 2;
    const t1 = ((i + 1) / ribs) * Math.PI * 2;
    const [px, pz] = ring(t0, R + 0.2);
    g.setTint(style.trimColor);
    g.beam('ext-trim', [px, dy0, pz], [px, dy1, pz], 0.3);
    // Arched head of each light, as a bent bar.
    g.setTint(style.windowFrameColor);
    const steps = 6;
    const rise = Math.min(0.7, (dy1 - dy0) * 0.35);
    let prev: [number, number, number] | null = null;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const [x, z] = ring(t0 + (t1 - t0) * u, R + 0.16);
      const y = dy1 - rise + rise * Math.sqrt(Math.max(0, 1 - (2 * u - 1) * (2 * u - 1)));
      const pt: [number, number, number] = [x, y, z];
      if (prev) g.beam('frame', prev, pt, 0.07);
      prev = pt;
    }
    const [mx, mz] = ring((t0 + t1) / 2, R + 0.16);
    g.beam('frame', [mx, dy0, mz], [mx, dy1 - 0.02, mz], 0.05);
  }
  g.setTint('#ffffff');
  // Inside every bar of the drum, clear of their faces.
  g.lathe('glass', d.x, d.z, [[R + 0.09, dy0], [R + 0.09, dy1]], seg, false);

  // The dome: parabolic, as on the great iron conservatories, ribbed and hooped.
  const rg = R + 0.12;
  const profile: [number, number][] = [];
  const stepsUp = 14;
  const phiMax = Math.acos(0.09);
  for (let k = 0; k <= stepsUp; k++) {
    const phi = (k / stepsUp) * phiMax;
    profile.push([rg * Math.cos(phi), d.springY + d.height * Math.sin(phi) * Math.sin(phi)]);
  }
  g.lathe('glass', d.x, d.z, profile, seg, false);
  g.setTint(style.windowFrameColor);
  for (let i = 0; i < ribs; i++) {
    const t = (i / ribs) * Math.PI * 2;
    for (let k = 0; k + 1 < profile.length; k++) {
      const [r0, ya] = profile[k]!;
      const [r1, yb] = profile[k + 1]!;
      const o = 0.07;
      g.beam('frame', [d.x + Math.cos(t) * (r0 + o), ya, d.z + Math.sin(t) * (r0 + o)], [d.x + Math.cos(t) * (r1 + o), yb, d.z + Math.sin(t) * (r1 + o)], i % 2 === 0 ? 0.12 : 0.06);
    }
  }
  for (const k of [2, 4, 6, 8, 10, 12]) {
    const [r, y] = profile[k]!;
    g.lathe('frame', d.x, d.z, [[r + 0.02, y - 0.05], [r + 0.1, y], [r + 0.02, y + 0.05]], seg, false);
  }
  // Crown: a small cupola and finial.
  const [rTop, yTop] = profile[profile.length - 1]!;
  g.setTint(style.trimColor);
  g.lathe(
    'ext-trim',
    d.x,
    d.z,
    [
      [rTop + 0.14, yTop - 0.08],
      [rTop + 0.18, yTop + 0.06],
      [rTop + 0.06, yTop + 0.12],
      [rTop + 0.06, yTop + 0.9],
      [rTop + 0.2, yTop + 0.98],
      [rTop + 0.2, yTop + 1.08],
      [rTop * 0.75, yTop + 1.4],
      [0.14, yTop + 1.75],
      [0.2, yTop + 1.9],
      [0.03, yTop + 2.7],
    ],
    20,
    true,
  );
}
