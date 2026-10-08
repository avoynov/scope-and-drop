/**
 * Dome hall mesher: ring galleries with balustrades, the curved split stair,
 * gallery columns, the rotunda's curved wall, the oculus ceiling, and outside,
 * the drum and glass dome standing through the roof.
 */
import type { Rect, Vec2 } from '../core/geom';
import { roofSurfaceY } from '../core/roofs';
import type { Atrium, Room, StairArm, Wall } from '../core/types';
import { wallMaterialKey, type ArchContext } from './arch';
import { pointInPoly } from '../layout/atrium';
import { type GeometryBuilder, type V3 } from './geometry';

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
    g.quadFacing(key, [A.L[0], yTop, A.L[1]], [A.R[0], yTop, A.R[1]], [B.R[0], yTop, B.R[1]], [B.L[0], yTop, B.L[1]], 0, 1, 0);
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
  for (const lv of levels) {
    g.scope = roomAt(lv.index).index;
    for (const c of a.columns) column(g, 'marble', c.x, c.z, a.columnRadius, lv.floorY, lv.ceilingY);
  }

  // The stair.
  g.scope = hall.index;
  const stair = bp.stairs.find((s) => s.id === a.stairId);
  for (const arm of stair?.arms ?? []) stairArm(g, arm);

  // No ceiling: the hall is roofed in glass from wall to wall (see buildDome).
  const topRoom = roomAt(top.index);
  void topRoom;

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

/** Plan rectangle of the hall's glass roof; the house roof is opened here. */
export function domeBase(a: Atrium): Rect {
  return { x0: a.inner.x0 - 0.15, z0: a.inner.z0 - 0.15, x1: a.inner.x1 + 0.15, z1: a.inner.z1 + 0.15 };
}

/** Outside: a low curb in a well cut through the roof, and the glass dome on it. Call after the roofs. */
export function buildDome(ctx: ArchContext, roofMark: Map<string, number>): void {
  const { bp, g, style } = ctx;
  const a = bp.atrium;
  if (!a) return;
  const d = a.dome;
  const base = domeBase(a);
  g.cutRectHole(roofMark, (k) => k.startsWith('roof-'), { x0: base.x0 + 0.06, z0: base.z0 + 0.06, x1: base.x1 - 0.06, z1: base.z1 - 0.06 });
  const main = bp.masses.find((m) => m.kind === 'main')!;
  const y0 = main.roof.eaveY - 0.3;
  const deck = d.springY - 0.3;
  const R = d.radius;
  g.scope = -1;
  // Well walls: they follow the roof where it stands higher than the curb, so nothing rises above the roof line.
  const wallKey = wallMaterialKey(style);
  const topGallery = a.galleries[a.galleries.length - 1];
  const inside = bp.rooms.find((r) => r.id === (topGallery?.roomId ?? a.roomId))?.index ?? -1;
  const corners: [number, number][] = [
    [base.x0, base.z0],
    [base.x1, base.z0],
    [base.x1, base.z1],
    [base.x0, base.z1],
  ];
  const mx = (base.x0 + base.x1) / 2;
  const mz = (base.z0 + base.z1) / 2;
  for (let e = 0; e < 4; e++) {
    const p = corners[e]!;
    const q = corners[(e + 1) % 4]!;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.max(2, Math.round(len / 0.6));
    // Outward normal of this edge.
    const ex = (p[0] + q[0]) / 2 - mx;
    const ez = (p[1] + q[1]) / 2 - mz;
    const nx = Math.abs(ex) > Math.abs(ez) ? Math.sign(ex) : 0;
    const nz = nx ? 0 : Math.sign(ez);
    const topAt = (t: number): [number, number, number] => {
      const x = p[0] + (q[0] - p[0]) * t;
      const z = p[1] + (q[1] - p[1]) * t;
      const roof = roofSurfaceY(bp.masses, x + nx * 0.12, z + nz * 0.12);
      return [x, Math.max(deck + 0.12, Number.isFinite(roof) ? roof + 0.1 : -Infinity), z];
    };
    for (let i = 0; i < n; i++) {
      const A = topAt(i / n);
      const B = topAt((i + 1) / n);
      g.setTint(style.wallMaterial === 'brick' ? '#ffffff' : style.wallColor);
      g.quadFacing(wallKey, [A[0], y0, A[2]], [B[0], y0, B[2]], B, A, nx, 0, nz);
      // Seen from the hall, the well is plastered and lit like the top gallery.
      g.scope = inside;
      g.setTint(STONE);
      g.quadFacing('int-trim', [A[0], y0, A[2]], [B[0], y0, B[2]], B, A, -nx, 0, -nz);
      g.scope = -1;
      g.setTint(style.trimColor);
      g.beam('ext-trim', A, B, 0.22, 0.12);
    }
  }
  const seg = 56;
  const circle = (r: number): [number, number][] => Array.from({ length: seg }, (_, i) => [d.x + Math.cos((i / seg) * Math.PI * 2) * r, d.z + Math.sin((i / seg) * Math.PI * 2) * r]);
  g.setTint('#ffffff');
  // The roof of the hall: glass from wall to wall, the dome rising from the middle of it.
  const foot = a.footprint.map(tup);
  g.flatPoly('roof-lead', corners, deck, true, [foot]);
  g.flatPoly('glass', foot, deck, true, [circle(R + 0.3)]);
  g.setTint('#e9e5db');
  const inFoot = (x: number, z: number) => pointInPoly(a.footprint, x, z);
  const bar = (x0: number, z0: number, x1: number, z1: number) => {
    // Glazing bar, drawn only where it runs over glass outside the dome.
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.5));
    let from: [number, number] | null = null;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = z0 + ((z1 - z0) * i) / n;
      const on = Math.hypot(x - d.x, z - d.z) > R + 0.3 && inFoot(x, z);
      if (on && !from) from = [x, z];
      if (from && (!on || i === n)) {
        const to: [number, number] = on ? [x, z] : [x0 + ((x1 - x0) * (i - 1)) / n, z0 + ((z1 - z0) * (i - 1)) / n];
        if (Math.hypot(to[0] - from[0], to[1] - from[1]) > 0.3) g.beam('frame', [from[0], deck + 0.03, from[1]], [to[0], deck + 0.03, to[1]], 0.08, 0.06);
        from = null;
      }
    }
  };
  const nxBars = Math.max(2, Math.round((base.x1 - base.x0) / 1.4));
  for (let i = 1; i < nxBars; i++) {
    const x = base.x0 + ((base.x1 - base.x0) * i) / nxBars;
    bar(x, base.z0, x, base.z1);
  }
  const nzBars = Math.max(2, Math.round((base.z1 - base.z0) / 4.2));
  for (let i = 1; i < nzBars; i++) {
    const z = base.z0 + ((base.z1 - base.z0) * i) / nzBars;
    bar(base.x0, z, base.x1, z);
  }
  // Curb ring the glass stands on.
  g.setTint(style.trimColor);
  g.lathe(
    'ext-trim',
    d.x,
    d.z,
    [
      [R + 0.46, deck],
      [R + 0.46, deck + 0.14],
      [R + 0.36, deck + 0.2],
      [R + 0.4, d.springY - 0.06],
      [R + 0.44, d.springY],
      [R + 0.08, d.springY],
    ],
    seg,
    false,
  );
  // Glass shell and its ribs.
  const rg = R + 0.12;
  const profile: [number, number][] = [];
  const stepsUp = 12;
  for (let k = 0; k <= stepsUp; k++) {
    const phi = (k / stepsUp) * (Math.PI / 2) * 0.93;
    profile.push([rg * Math.cos(phi), d.springY + d.height * Math.sin(phi)]);
  }
  g.setTint('#ffffff');
  g.lathe('glass', d.x, d.z, profile, seg, false);
  g.setTint('#e9e5db');
  const ribs = R > 6 ? 24 : 16;
  for (let i = 0; i < ribs; i++) {
    const t = (i / ribs) * Math.PI * 2;
    for (let k = 0; k + 1 < profile.length; k++) {
      const [r0, ya] = profile[k]!;
      const [r1, yb] = profile[k + 1]!;
      g.beam('frame', [d.x + Math.cos(t) * r0, ya, d.z + Math.sin(t) * r0], [d.x + Math.cos(t) * r1, yb, d.z + Math.sin(t) * r1], 0.1);
    }
  }
  for (const k of [3, 6, 9]) {
    const [r, y] = profile[k]!;
    g.lathe('frame', d.x, d.z, [[r - 0.01, y - 0.04], [r + 0.05, y], [r - 0.01, y + 0.04]], seg, false);
  }
  // Crown: a small lantern cap and finial.
  const [rTop, yTop] = profile[profile.length - 1]!;
  g.setTint(style.trimColor);
  g.lathe(
    'ext-trim',
    d.x,
    d.z,
    [
      [rTop + 0.1, yTop - 0.05],
      [rTop + 0.14, yTop + 0.08],
      [rTop * 0.7, yTop + 0.3],
      [0.12, yTop + 0.5],
      [0.16, yTop + 0.62],
      [0.03, yTop + 1.2],
    ],
    16,
    true,
  );
}
