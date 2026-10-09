/**
 * The dome hall (stage 4b): the central ball room rises through every storey
 * to a glass dome. Ring galleries wrap its left, back and right sides on each
 * upper floor, and a split stair sweeps from the back of the dance floor round
 * both sides up to the first gallery.
 *
 * One outline drives everything: the *void edge*, a U open to the garden
 * windows whose back corners are rounded. Offsetting it inward gives the stair
 * arms, offsetting it outward gives the gallery (and, for the rotunda, the
 * curved wall). The rest of the generator still thinks in rectangles, so the
 * curved shapes are handed to it as thin rectangular strips.
 */
import { rect, type Rect, type Vec2 } from '../core/geom';
import { snap } from '../core/rng';
import type { HallShape, StairArm } from '../core/types';

export interface AtriumGeometry {
  shape: HallShape;
  inner: Rect;
  /** Gallery and stair widths. */
  galleryWidth: number;
  stairWidth: number;
  /** Void outline, closed along the garden wall. */
  void: Vec2[];
  /** Hall footprint at floor level (the inner rectangle, or the rotunda's curved outline). */
  footprint: Vec2[];
  /** Rotunda only: the two curved wall runs (west, east), each from the side wall round to the back wall. */
  curvedWalls: Vec2[][];
  /** Walkable gallery floor: with stair landings (first gallery) and without (galleries above). */
  outlineWithLandings: Vec2[];
  outlinePlain: Vec2[];
  /** Balustrade runs along the gallery edge (open polylines), with and without the landing openings. */
  railsWithLandings: Vec2[][];
  railsPlain: Vec2[][];
  arms: StairArm[];
  /** Where each arm lands on the first gallery. */
  landings: Rect[];
  columns: Vec2[];
  columnRadius: number;
  /** Ground floor: not walkable (rotunda corners, low headroom under the stair). */
  blocked0: Rect[];
  /** Gallery levels: where there is no floor (the void and rotunda corners). `first` keeps the stair landings. */
  holesFirst: Rect[];
  holesPlain: Rect[];
  /** Footprints of the gallery columns, blocked on every storey. */
  columnBlocks: Rect[];
  /** Lengths of straight wall a room may furnish, per side; the rotunda hides its back corners. */
  wallSpan: { backX: [number, number]; sideZ: [number, number] };
  foot: Vec2[];
  dome: { x: number; z: number; radius: number };
}

interface Sample extends Vec2 {
  nx: number;
  nz: number;
}

const ROW = 0.25;
const round = (v: number): number => snap(v, 0.001);

/** East half of the void edge from the back centre to the garden wall, with outward normals. */
function eastEdge(cx: number, vw: number, zV: number, zF: number, rx: number, rz: number): Sample[] {
  const out: Sample[] = [];
  const xs = cx + vw - rx;
  if (xs > cx + 1e-6) out.push({ x: cx, z: zV, nx: 0, nz: -1 });
  const steps = Math.max(8, Math.ceil(((Math.PI / 2) * Math.max(rx, rz)) / 0.12));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    const s = Math.sin(t);
    const c = Math.cos(t);
    const nl = Math.hypot(s / rx, c / rz) || 1;
    out.push({ x: xs + rx * s, z: zV + rz - rz * c, nx: s / rx / nl, nz: -c / rz / nl });
  }
  out.push({ x: cx + vw, z: zF, nx: 1, nz: 0 });
  return out;
}

const offset = (edge: Sample[], d: number): Vec2[] => edge.map((p) => ({ x: p.x + d * p.nx, z: p.z + d * p.nz }));
const mirror = (pts: Vec2[], cx: number): Vec2[] => pts.map((p) => ({ x: 2 * cx - p.x, z: p.z }));

function lengths(pts: Vec2[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  return out;
}

/** Point at arc length s along a polyline. */
export function pointAt(pts: Vec2[], cum: number[], s: number): Vec2 {
  const total = cum[cum.length - 1]!;
  const t = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < t) i++;
  const a = pts[i - 1]!;
  const b = pts[i]!;
  const span = cum[i]! - cum[i - 1]! || 1;
  const k = (t - cum[i - 1]!) / span;
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
}

/** Sub-polyline between two arc lengths (keeps the interior vertices). */
function slice(pts: Vec2[], cum: number[], s0: number, s1: number): Vec2[] {
  const out = [pointAt(pts, cum, s0)];
  for (let i = 0; i < pts.length; i++) if (cum[i]! > s0 + 1e-6 && cum[i]! < s1 - 1e-6) out.push(pts[i]!);
  out.push(pointAt(pts, cum, s1));
  return out;
}

/** x-intervals where the horizontal line at z lies inside a polygon. */
function scan(poly: Vec2[], z: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (a.z > z !== b.z > z) xs.push(a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x));
  }
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i]!, xs[i + 1]!]);
  return out;
}

/** Rows of rectangles covering the inside (or, within `bounds`, the outside) of a polygon; equal neighbours are merged. */
export function strips(poly: Vec2[], bounds: Rect, outside: boolean, shrink = 0): Rect[] {
  const rows: { z0: number; z1: number; spans: [number, number][] }[] = [];
  for (let z = bounds.z0; z < bounds.z1 - 1e-6; z += ROW) {
    const z1 = Math.min(bounds.z1, z + ROW);
    let spans = scan(poly, (z + z1) / 2).map(([a, b]) => [Math.max(bounds.x0, a), Math.min(bounds.x1, b)] as [number, number]);
    if (outside) {
      const inv: [number, number][] = [];
      let x = bounds.x0;
      for (const [a, b] of spans) {
        if (a > x + 1e-6) inv.push([x, a]);
        x = Math.max(x, b);
      }
      if (bounds.x1 > x + 1e-6) inv.push([x, bounds.x1]);
      spans = inv;
    }
    spans = spans.map(([a, b]) => [round(a + shrink), round(b - shrink)] as [number, number]).filter(([a, b]) => b - a > 0.02);
    const last = rows[rows.length - 1];
    if (last && last.spans.length === spans.length && last.spans.every((s, i) => Math.abs(s[0] - spans[i]![0]) < 0.02 && Math.abs(s[1] - spans[i]![1]) < 0.02)) last.z1 = z1;
    else rows.push({ z0: z, z1, spans });
  }
  return rows.flatMap((r) => r.spans.map(([a, b]) => rect(a, round(r.z0), b, round(r.z1))));
}

export function pointInPoly(poly: Vec2[], x: number, z: number): boolean {
  return scan(poly, z).some(([a, b]) => x >= a && x <= b);
}

/**
 * Lay out the dome hall inside the clear interior of the ball room.
 * Returns null when the room is too small for the stair to reach the gallery.
 */
export function planAtriumGeometry(inner: Rect, shape: HallShape, floorY: number, rise: number): AtriumGeometry | null {
  const cx = (inner.x0 + inner.x1) / 2;
  const A = (inner.x1 - inner.x0) / 2;
  const zB = inner.z0;
  const zF = inner.z1;
  // Generous by rule: a gallery two couples can pass on, a stair four can climb abreast.
  const gw = Math.min(4.2, Math.max(3.0, 0.33 * A));
  const sw = Math.min(3.6, Math.max(2.6, 0.29 * A));
  const vw = A - gw;
  const zV = zB + gw;
  const dv = zF - zV;
  const minRadius = sw + 0.4;
  // The stair lands on the straight run of the side gallery; keep that run long enough for the landing.
  const zMax = dv - 3.4;
  if (vw < sw + 2.0 || zMax < minRadius) return null;
  let rx: number;
  let rz: number;
  if (shape === 'rotunda') {
    // A true apse: the back of the hall is a half oval as wide as the hall allows.
    rz = Math.min(vw, zMax);
    rx = Math.min(vw, (rz * rz) / minRadius);
  } else {
    rx = rz = Math.max(minRadius, Math.min(0.7 * vw, 0.42 * dv, 5.0, zMax));
  }
  if (rx < minRadius - 1e-6) return null;

  const edge = eastEdge(cx, vw, zV, zF, rx, rz);
  const voidE = offset(edge, 0);
  const outerE: Vec2[] =
    shape === 'rotunda'
      ? offset(edge, gw)
      : [
          { x: cx, z: zB },
          { x: inner.x1, z: zB },
          { x: inner.x1, z: zF },
        ];
  if (shape === 'rotunda' && outerE[0]!.x > cx + 1e-6) outerE.unshift({ x: cx, z: zB });

  // Stair arm centreline, east side: from beside the axis door, round the back corner, up the side.
  const centre = offset(edge, -sw / 2);
  const cum = lengths(centre);
  const total = cum[cum.length - 1]!;
  const sSide = cum[cum.length - 2]!;
  const halfGap = 2.0;
  let s0 = 0;
  for (let s = 0; s < total; s += 0.05) {
    if (pointAt(centre, cum, s).x - cx >= halfGap) {
      s0 = s;
      break;
    }
  }
  const avail = total - s0;
  let fit: { n: number; tread: number } | null = null;
  for (const maxRiser of [0.15, 0.16, 0.17, 0.18, 0.19]) {
    const n = Math.ceil(rise / maxRiser);
    const tread = Math.min(0.36, (avail - 1.6) / n);
    if (tread >= 0.255 && (!fit || fit.tread < 0.3)) fit = { n, tread: snap(tread, 0.001) };
  }
  if (!fit) return null;
  const flight = fit.n * fit.tread;
  // Land where the side gallery runs straight, as near the back as the climb allows: that keeps the
  // garden end of the hall, and its windows, clear of the stair.
  let sFoot = Math.max(s0, sSide - (fit.n - 1) * fit.tread);
  if (sFoot + flight + 1.6 > total) sFoot = total - flight - 1.6;
  if (sFoot < s0 - 1e-6) return null;
  const landing = Math.min(3.0, total - sFoot - flight);
  // The last tread is at gallery height: it and the run beyond it are the landing.
  const sTop = sFoot + (fit.n - 1) * fit.tread;
  if (sTop < sSide - 1e-3) return null;
  const zLand0 = round(pointAt(centre, cum, sTop).z);
  const zLand1 = round(Math.min(zF, pointAt(centre, cum, sFoot + flight + landing).z));
  const toWall = zF - zLand1 < 0.6;
  const zEnd = toWall ? round(zF) : zLand1;
  const armPath = slice(centre, cum, sFoot, sFoot + flight).map((p) => ({ x: round(p.x), z: round(p.z) }));
  const arms: StairArm[] = [
    { path: armPath, width: round(sw), y0: floorY, rise, steps: fit.n },
    { path: mirror(armPath, cx).map((p) => ({ x: round(p.x), z: p.z })), width: round(sw), y0: floorY, rise, steps: fit.n },
  ];
  const landE = rect(round(cx + vw - sw), zLand0, round(cx + vw), zEnd);
  const landW = rect(round(cx - vw), zLand0, round(cx - vw + sw), zEnd);

  // Gallery floor outlines (from the west garden corner, round the walls, back along the void edge).
  const outerW = mirror(outerE, cx).reverse();
  const outer = [...outerW, ...outerE.slice(1)];
  const voidW = mirror(voidE, cx);
  const clean = (pts: Vec2[]): Vec2[] => pts.map((p) => ({ x: round(p.x), z: round(p.z) })).filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1]!.x, p.z - a[i - 1]!.z) > 1e-3);
  // East void edge walked from the garden wall to the back centre, with the landing as a step out into the void.
  const eastIn = (withLandings: boolean): Vec2[] => {
    const back = voidE.slice(0, -1).reverse();
    if (!withLandings) return [{ x: cx + vw, z: zF }, ...back];
    const bump: Vec2[] = [
      { x: landE.x0, z: zEnd },
      { x: landE.x0, z: zLand0 },
      { x: cx + vw, z: zLand0 },
    ];
    return toWall ? [...bump, ...back] : [{ x: cx + vw, z: zF }, { x: cx + vw, z: zEnd }, ...bump, ...back];
  };
  const inside = (withLandings: boolean): Vec2[] => {
    const e = eastIn(withLandings);
    return [...e, ...mirror(e, cx).reverse().slice(1)];
  };
  const outlineWithLandings = clean([...outer, ...inside(true)]);
  const outlinePlain = clean([...outer, ...inside(false)]);
  const voidPoly = clean([...voidW.slice().reverse(), ...voidE.slice(1)]);
  const footprint = clean(outer);
  const edgeAll = clean([...voidW.slice().reverse(), ...voidE.slice(1)]);
  // Balustrades: round the back between the two landings, then round each landing to the garden wall.
  const backRail = clean([{ x: cx - vw, z: zLand0 }, ...voidW.slice(0, -1).reverse(), ...voidE.slice(1, -1), { x: cx + vw, z: zLand0 }]);
  const landRail = (x0: number, xEdge: number): Vec2[] =>
    toWall
      ? [
          { x: x0, z: zLand0 },
          { x: x0, z: zEnd },
        ]
      : [
          { x: x0, z: zLand0 },
          { x: x0, z: zEnd },
          { x: xEdge, z: zEnd },
          { x: xEdge, z: round(zF) },
        ];
  const railsWithLandings: Vec2[][] = [backRail, landRail(landE.x0, round(cx + vw)), landRail(landW.x1, round(cx - vw))];

  // Columns carry the gallery edge, standing just behind it.
  const colLine = offset(edge, 0.5);
  const colCum = lengths(colLine);
  const colLen = colCum[colCum.length - 1]! - 0.6;
  const nCol = Math.max(2, Math.round(colLen / 4.4));
  const columns: Vec2[] = [];
  for (let k = 0; k < nCol; k++) {
    const p = pointAt(colLine, colCum, (colLen * (k + 0.5)) / nCol);
    if (p.x - cx < 2.8) continue;
    columns.push({ x: round(p.x), z: round(p.z) }, { x: round(2 * cx - p.x), z: round(p.z) });
  }
  const columnRadius = 0.3;
  const colBlocks = columns.map((c) => rect(round(c.x - 0.38), round(c.z - 0.38), round(c.x + 0.38), round(c.z + 0.38)));

  // Ground floor: you cannot walk where the stair is lower than head height.
  const lowTo = sFoot + flight * Math.min(1, 2.5 / rise);
  const band = (from: number, to: number): Vec2[] => {
    const mid = slice(centre, cum, from, to);
    const out: Vec2[] = [];
    const inn: Vec2[] = [];
    mid.forEach((p, i) => {
      const a = mid[Math.max(0, i - 1)]!;
      const b = mid[Math.min(mid.length - 1, i + 1)]!;
      const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      // Left of travel is the void side for the east arm (travel runs +x then +z).
      const nx = (b.z - a.z) / tl;
      const nz = -(b.x - a.x) / tl;
      out.push({ x: p.x + (nx * sw) / 2, z: p.z + (nz * sw) / 2 });
      inn.push({ x: p.x - (nx * sw) / 2, z: p.z - (nz * sw) / 2 });
    });
    return [...out, ...inn.reverse()];
  };
  const low = band(sFoot, lowTo);
  const blocked0 = [...strips(low, inner, false, -0.05), ...strips(mirror(low, cx), inner, false, -0.05)];
  if (shape === 'rotunda') blocked0.push(...strips(footprint, inner, true));

  const curvedWalls: Vec2[][] = [];
  if (shape === 'rotunda') {
    // The arc alone: the straight runs before and after it lie on the rectangular walls.
    const hasBack = cx + vw - rx > cx + 1e-6;
    const arc = clean(offset(edge.slice(hasBack ? 1 : 0, edge.length - 1), gw));
    curvedWalls.push(mirror(arc, cx).map((p) => ({ x: round(p.x), z: p.z })), arc);
  }
  const footPoint = pointAt(centre, cum, Math.max(0, sFoot - 0.45));
  return {
    shape,
    inner,
    galleryWidth: round(gw),
    stairWidth: round(sw),
    void: voidPoly,
    footprint,
    curvedWalls,
    outlineWithLandings,
    outlinePlain,
    railsWithLandings,
    railsPlain: [edgeAll],
    arms,
    landings: [landE, landW],
    columns,
    columnRadius,
    blocked0,
    holesFirst: strips(outlineWithLandings, inner, true),
    holesPlain: strips(outlinePlain, inner, true),
    columnBlocks: colBlocks,
    wallSpan: {
      backX: shape === 'rotunda' ? [round(cx - (vw - rx)), round(cx + (vw - rx))] : [inner.x0, inner.x1],
      sideZ: shape === 'rotunda' ? [round(zV + rz), inner.z1] : [inner.z0, inner.z1],
    },
    foot: [
      { x: round(footPoint.x), z: round(footPoint.z) },
      { x: round(2 * cx - footPoint.x), z: round(footPoint.z) },
    ],
    dome: inscribedDome(footprint, cx, zB, zF),
  };
}

/**
 * The largest dome the hall carries: a circle on the hall's axis, inscribed in its footprint.
 * It roofs the whole hall, galleries included; it is the sniper's window from above.
 */
function inscribedDome(footprint: Vec2[], cx: number, zB: number, zF: number): { x: number; z: number; radius: number } {
  const clear = (z: number): number => {
    let d = Infinity;
    for (let i = 0; i < footprint.length; i++) {
      const a = footprint[i]!;
      const b = footprint[(i + 1) % footprint.length]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((cx - a.x) * ex + (z - a.z) * ez) / len2));
      d = Math.min(d, Math.hypot(cx - a.x - ex * t, z - a.z - ez * t));
    }
    return d;
  };
  const mid = (zB + zF) / 2;
  let best = { z: mid, r: clear(mid) };
  for (let z = zB + 2; z <= zF - 2; z += 0.1) {
    const r = clear(z);
    if (r > best.r + 0.05) best = { z, r };
  }
  return { x: round(cx), z: round(best.z), radius: round(Math.min(12, Math.max(3, best.r - 0.45))) };
}

/** Does a hall of this clear size take the stair in both hall shapes? Used by the massing to size the hall. */
export function atriumFits(width: number, depth: number, rise: number): boolean {
  const inner = rect(-width / 2, 0, width / 2, depth);
  return !!planAtriumGeometry(inner, 'gallery', 0, rise) && !!planAtriumGeometry(inner, 'rotunda', 0, rise);
}
