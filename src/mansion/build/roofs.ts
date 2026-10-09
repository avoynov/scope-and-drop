/**
 * Roofs and porticos: hipped, mansard, flat and glass roofs; pavilion
 * pediments; dormers; chimney stacks; columns with entablature and pediment.
 */
import { expand, rectMinus, type Rect } from '../core/geom';
import { HIP_MAX_RISE, MANSARD_TOP_PITCH, PAVILION_PITCH, hipParams } from '../core/roofs';
import type { Mass, Portico } from '../core/types';
import type { ArchContext } from './arch';
import { baluster, vquad } from './arch';
import { domeBase } from './atrium';
import type { V3 } from './geometry';

const DEG = Math.PI / 180;

type Uv = (p: V3) => [number, number];

function faceQuad(ctx: ArchContext, key: string, a: V3, b: V3, c: V3, d: V3, n: V3, uv: Uv): void {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  const pts = cr[0]! * n[0] + cr[1]! * n[1] + cr[2]! * n[2] >= 0 ? [a, b, c, d] : [d, c, b, a];
  ctx.g.quad(key, pts[0]!, pts[1]!, pts[2]!, pts[3]!, pts.map(uv));
}

/** Slope-aligned UVs: u along the eave, v up the slope. */
function slopeUv(axis: 'x' | 'z', yb: number, sinP: number): Uv {
  return (p) => [axis === 'x' ? p[0] : p[2], (p[1] - yb) / Math.max(0.2, sinP)];
}

/** Hipped roof over a rect; returns ridge height. */
export function hipRoof(ctx: ArchContext, key: string, r: Rect, yb: number, pitchDeg: number): { ridgeY: number; alongX: boolean; ridge: [number, number] } {
  const W = r.x1 - r.x0;
  const D = r.z1 - r.z0;
  const t = Math.tan(pitchDeg * DEG);
  const s = Math.sin(pitchDeg * DEG);
  const zm = (r.z0 + r.z1) / 2;
  const xm = (r.x0 + r.x1) / 2;
  if (W >= D) {
    const h = (D / 2) * t;
    const yr = yb + h;
    const ra = r.x0 + D / 2;
    const rb = r.x1 - D / 2;
    faceQuad(ctx, key, [r.x0, yb, r.z1], [r.x1, yb, r.z1], [rb, yr, zm], [ra, yr, zm], [0, 1, 1], slopeUv('x', yb, s));
    faceQuad(ctx, key, [r.x1, yb, r.z0], [r.x0, yb, r.z0], [ra, yr, zm], [rb, yr, zm], [0, 1, -1], slopeUv('x', yb, s));
    faceQuad(ctx, key, [r.x1, yb, r.z1], [r.x1, yb, r.z0], [rb, yr, zm], [rb, yr, zm], [1, 1, 0], slopeUv('z', yb, s));
    faceQuad(ctx, key, [r.x0, yb, r.z0], [r.x0, yb, r.z1], [ra, yr, zm], [ra, yr, zm], [-1, 1, 0], slopeUv('z', yb, s));
    return { ridgeY: yr, alongX: true, ridge: [ra, rb] };
  }
  const h = (W / 2) * t;
  const yr = yb + h;
  const ra = r.z0 + W / 2;
  const rb = r.z1 - W / 2;
  faceQuad(ctx, key, [r.x1, yb, r.z1], [r.x1, yb, r.z0], [xm, yr, ra], [xm, yr, rb], [1, 1, 0], slopeUv('z', yb, s));
  faceQuad(ctx, key, [r.x0, yb, r.z0], [r.x0, yb, r.z1], [xm, yr, rb], [xm, yr, ra], [-1, 1, 0], slopeUv('z', yb, s));
  faceQuad(ctx, key, [r.x0, yb, r.z1], [r.x1, yb, r.z1], [xm, yr, rb], [xm, yr, rb], [0, 1, 1], slopeUv('x', yb, s));
  faceQuad(ctx, key, [r.x1, yb, r.z0], [r.x0, yb, r.z0], [xm, yr, ra], [xm, yr, ra], [0, 1, -1], slopeUv('x', yb, s));
  return { ridgeY: yr, alongX: false, ridge: [ra, rb] };
}

/** Steep-sided frustum (mansard lower slopes). */
function frustum(ctx: ArchContext, key: string, r: Rect, inset: number, yb: number, h: number): Rect {
  const i: Rect = { x0: r.x0 + inset, z0: r.z0 + inset, x1: r.x1 - inset, z1: r.z1 - inset };
  const s = Math.sin(Math.atan2(h, inset));
  const yt = yb + h;
  faceQuad(ctx, key, [r.x0, yb, r.z1], [r.x1, yb, r.z1], [i.x1, yt, i.z1], [i.x0, yt, i.z1], [0, 0.3, 1], slopeUv('x', yb, s));
  faceQuad(ctx, key, [r.x1, yb, r.z0], [r.x0, yb, r.z0], [i.x0, yt, i.z0], [i.x1, yt, i.z0], [0, 0.3, -1], slopeUv('x', yb, s));
  faceQuad(ctx, key, [r.x1, yb, r.z1], [r.x1, yb, r.z0], [i.x1, yt, i.z0], [i.x1, yt, i.z1], [1, 0.3, 0], slopeUv('z', yb, s));
  faceQuad(ctx, key, [r.x0, yb, r.z0], [r.x0, yb, r.z1], [i.x0, yt, i.z1], [i.x0, yt, i.z0], [-1, 0.3, 0], slopeUv('z', yb, s));
  return i;
}

function roofKey(ctx: ArchContext, m: Mass): string {
  if (m.roof.kind === 'glass') return 'glass';
  return `roof-${ctx.style.roofMaterial}`;
}

export function buildRoofs(ctx: ArchContext): void {
  const { bp, g } = ctx;
  g.scope = -1;
  for (const m of bp.masses) {
    const key = roofKey(ctx, m);
    g.setTint('#ffffff');
    const yb = m.roof.eaveY + 0.06;
    // Roof plane starts at the cornice edge, or behind the parapet.
    const r = m.roof.balustrade ? expand(m.rect, 0.0) : expand(m.rect, 0.62);
    if (m.kind === 'pavilion') {
      pavilionRoof(ctx, m, key, yb);
      continue;
    }
    switch (m.roof.kind) {
      case 'flat': {
        // A roof guests walk on is paved; any other flat roof is leaded.
        const paved = bp.roofTerraces.some((t) => t.massId === m.id);
        if (paved) g.setTint('#d9d2c2');
        g.box(paved ? 'terrace' : 'roof-lead', r.x0, yb - 0.05, r.z0, r.x1, yb + 0.05, r.z1);
        g.setTint('#ffffff');
        break;
      }
      case 'glass': {
        const res = hipRoof(ctx, 'glass', expand(m.rect, 0.12), yb, 32);
        g.setTint('#f4f2ec');
        // Glazing ribs.
        const rr = expand(m.rect, 0.12);
        const W = rr.x1 - rr.x0;
        const D = rr.z1 - rr.z0;
        const n = Math.max(2, Math.round(Math.max(W, D) / 0.9));
        for (let i = 0; i <= n; i++) {
          if (res.alongX) {
            const x = rr.x0 + (W * i) / n;
            const xr = Math.min(Math.max(x, res.ridge[0]), res.ridge[1]);
            rib(ctx, [x, yb, rr.z1], [xr, res.ridgeY, (rr.z0 + rr.z1) / 2]);
            rib(ctx, [x, yb, rr.z0], [xr, res.ridgeY, (rr.z0 + rr.z1) / 2]);
          } else {
            const z = rr.z0 + (D * i) / n;
            const zr = Math.min(Math.max(z, res.ridge[0]), res.ridge[1]);
            rib(ctx, [rr.x1, yb, z], [(rr.x0 + rr.x1) / 2, res.ridgeY, zr]);
            rib(ctx, [rr.x0, yb, z], [(rr.x0 + rr.x1) / 2, res.ridgeY, zr]);
          }
        }
        break;
      }
      case 'mansard': {
        const hb = Math.min(3.2, 0.3 * Math.min(r.x1 - r.x0, r.z1 - r.z0));
        const inset = hb / Math.tan(70 * DEG);
        const inner = frustum(ctx, key, r, inset, yb, hb);
        const top = hipRoof(ctx, key, inner, yb + hb, MANSARD_TOP_PITCH);
        g.setTint(ctx.style.trimColor);
        // Curb moulding at the break.
        for (const [a, b] of [
          [inner.x0, inner.x1],
        ] as const) {
          g.box('ext-trim', a - 0.08, yb + hb - 0.08, inner.z1 - 0.06, b + 0.08, yb + hb + 0.06, inner.z1 + 0.08);
          g.box('ext-trim', a - 0.08, yb + hb - 0.08, inner.z0 - 0.08, b + 0.08, yb + hb + 0.06, inner.z0 + 0.06);
        }
        if (m.kind === 'main') {
          mansardDormers(ctx, m, r, inset, yb, hb);
          chimneys(ctx, m, { ridgeY: top.ridgeY, alongX: top.alongX, ridge: top.ridge }, inner);
        }
        break;
      }
      default: {
        const hp = hipParams(m);
        const base = yb + hp.lift;
        const glazed = m.roof.glazed ?? [];
        const mark = g.mark();
        const glaze = () => {
          if (!glazed.length) return;
          // Rafters and purlins for the whole roof, kept only where it is glass.
          g.setTint(ctx.style.windowFrameColor);
          hipBars(ctx, r, base, hp.pitchDeg, hp.inset);
          for (const q of glazed) {
            g.splitRect(mark, (k) => k === key || k === 'roof-lead', q, () => 'glass');
            g.splitRect(mark, (k) => k === BARS, q, () => 'frame');
          }
          g.discardSince(mark, BARS);
          g.setTint('#ffffff');
          atticDeck(ctx, m);
        };
        if (Number.isFinite(hp.inset)) {
          // Deep block: slopes up to a leaded flat instead of a ridge.
          const inner = frustum(ctx, key, r, hp.inset, base, HIP_MAX_RISE);
          g.box('roof-lead', inner.x0, base + HIP_MAX_RISE - 0.06, inner.z0, inner.x1, base + HIP_MAX_RISE + 0.04, inner.z1);
          g.setTint(ctx.style.trimColor);
          g.box('ext-trim', inner.x0 - 0.1, base + HIP_MAX_RISE - 0.08, inner.z1 - 0.06, inner.x1 + 0.1, base + HIP_MAX_RISE + 0.1, inner.z1 + 0.1);
          g.box('ext-trim', inner.x0 - 0.1, base + HIP_MAX_RISE - 0.08, inner.z0 - 0.1, inner.x1 + 0.1, base + HIP_MAX_RISE + 0.1, inner.z0 + 0.06);
          g.box('ext-trim', inner.x0 - 0.1, base + HIP_MAX_RISE - 0.08, inner.z0, inner.x0 + 0.06, base + HIP_MAX_RISE + 0.1, inner.z1);
          g.box('ext-trim', inner.x1 - 0.06, base + HIP_MAX_RISE - 0.08, inner.z0, inner.x1 + 0.1, base + HIP_MAX_RISE + 0.1, inner.z1);
          g.setTint('#ffffff');
          if (m.kind === 'main') {
            glaze();
            if (m.roof.dormers && !m.roof.balustrade && !ctx.style.glassRoofs) hipDormers(ctx, m, r, yb, hp.pitchDeg);
            if (!ctx.style.glassRoofs) chimneys(ctx, m, { ridgeY: base + HIP_MAX_RISE, alongX: true, ridge: [inner.x0, inner.x1] }, r);
          } else glaze();
          break;
        }
        const res = hipRoof(ctx, key, r, base, hp.pitchDeg);
        glaze();
        if (m.kind === 'main' && !ctx.style.glassRoofs) {
          if (m.roof.dormers && !m.roof.balustrade) hipDormers(ctx, m, r, yb, hp.pitchDeg);
          chimneys(ctx, m, res, r);
        }
      }
    }
  }
}

/** Scratch bucket for glazing bars before they are clipped to the glass. */
const BARS = 'bars-tmp';

/**
 * Rafters, hips, purlins and ridge of a hipped (or flat-topped) glass roof over rect r, as iron bars.
 * Drawn for the whole roof; the caller keeps the parts over glass.
 */
function hipBars(ctx: ArchContext, r: Rect, base: number, pitchDeg: number, inset: number): void {
  const { g } = ctx;
  const t = Math.tan(pitchDeg * DEG);
  const W = r.x1 - r.x0;
  const D = r.z1 - r.z0;
  const reach = Math.min(W / 2, D / 2, inset);
  const lift = 0.04;
  const bar = (a: V3, b: V3, w: number) => g.beam(BARS, [a[0], a[1] + lift, a[2]], [b[0], b[1] + lift, b[2]], w, 0.08);
  // Each eave: rafters run straight in until they meet a hip or the top.
  const edges: { o: [number, number]; along: [number, number]; inward: [number, number]; len: number }[] = [
    { o: [r.x0, r.z1], along: [1, 0], inward: [0, -1], len: W },
    { o: [r.x0, r.z0], along: [1, 0], inward: [0, 1], len: W },
    { o: [r.x0, r.z0], along: [0, 1], inward: [1, 0], len: D },
    { o: [r.x1, r.z0], along: [0, 1], inward: [-1, 0], len: D },
  ];
  for (const e of edges) {
    const n = Math.max(2, Math.round(e.len / 0.75));
    for (let i = 1; i < n; i++) {
      const u = (e.len * i) / n;
      const d = Math.min(u, e.len - u, reach);
      if (d < 0.4) continue;
      const x = e.o[0] + e.along[0] * u;
      const z = e.o[1] + e.along[1] * u;
      bar([x, base, z], [x + e.inward[0] * d, base + d * t, z + e.inward[1] * d], i % 4 === 0 ? 0.11 : 0.045);
    }
  }
  // Hips, then purlins as rings.
  for (const [cx, cz, sx, sz] of [
    [r.x0, r.z0, 1, 1],
    [r.x1, r.z0, -1, 1],
    [r.x1, r.z1, -1, -1],
    [r.x0, r.z1, 1, -1],
  ] as const) {
    bar([cx, base, cz], [cx + sx * reach, base + reach * t, cz + sz * reach], 0.14);
  }
  const ringAt = (d: number, w: number) => {
    const y = base + d * t;
    const q = { x0: r.x0 + d, z0: r.z0 + d, x1: r.x1 - d, z1: r.z1 - d };
    if (q.x1 - q.x0 > 0.05) {
      bar([q.x0, y, q.z0], [q.x1, y, q.z0], w);
      bar([q.x0, y, q.z1], [q.x1, y, q.z1], w);
    }
    if (q.z1 - q.z0 > 0.05) {
      bar([q.x0, y, q.z0], [q.x0, y, q.z1], w);
      bar([q.x1, y, q.z0], [q.x1, y, q.z1], w);
    }
  };
  for (let d = 2.2; d < reach - 0.8; d += 2.2) ringAt(d, 0.09);
  ringAt(reach, 0.14);
  // A flat top is glazed on a grid.
  const top = { x0: r.x0 + reach, z0: r.z0 + reach, x1: r.x1 - reach, z1: r.z1 - reach };
  if (top.x1 - top.x0 > 1 && top.z1 - top.z0 > 1) {
    const y = base + reach * t + 0.05;
    const n = Math.round((top.x1 - top.x0) / 0.75);
    for (let i = 1; i < n; i++) {
      const x = top.x0 + ((top.x1 - top.x0) * i) / n;
      bar([x, y, top.z0], [x, y, top.z1], i % 4 === 0 ? 0.11 : 0.045);
    }
    const mz = Math.max(1, Math.round((top.z1 - top.z0) / 2.4));
    for (let j = 1; j < mz; j++) {
      const z = top.z0 + ((top.z1 - top.z0) * j) / mz;
      bar([top.x0, y, z], [top.x1, y, z], 0.09);
    }
  }
}

/**
 * Under a part-glazed roof: a leaded deck at the eaves over everything that is not glass, with a
 * plastered well down into each skylit room. Without it one would look through the glass,
 * past the tops of the walls, into the rooms that are meant to be roofed over.
 */
function atticDeck(ctx: ArchContext, m: Mass): void {
  const { g, bp } = ctx;
  const y = m.roof.eaveY + 0.03;
  const skylit = bp.rooms.filter((q) => q.skylit && q.massId === m.id);
  const holes = skylit.map((q) => q.inner);
  if (bp.atrium && m.kind === 'main') holes.push(domeBase(bp.atrium));
  g.scope = -1;
  g.setTint('#ffffff');
  for (const p of rectMinus(expand(m.rect, -0.05), holes)) g.quad('roof-lead', [p.x0, y, p.z1], [p.x1, y, p.z1], [p.x1, y, p.z0], [p.x0, y, p.z0]);
  for (const q of skylit) {
    g.scope = q.index;
    g.setTint(q.finish.ceilingColor);
    const i = q.inner;
    vquad(g, 'int-trim', 'x', i.z0, 1, i.x0, i.x1, q.ceilingY, y);
    vquad(g, 'int-trim', 'x', i.z1, -1, i.x0, i.x1, q.ceilingY, y);
    vquad(g, 'int-trim', 'z', i.x0, 1, i.z0, i.z1, q.ceilingY, y);
    vquad(g, 'int-trim', 'z', i.x1, -1, i.z0, i.z1, q.ceilingY, y);
  }
  g.scope = -1;
}

/** Is a roof feature at (x, z) in the way of the dome's base? */
function nearDome(ctx: ArchContext, x: number, z: number, margin: number): boolean {
  const a = ctx.bp.atrium;
  if (!a) return false;
  const b = domeBase(a);
  return x > b.x0 - margin && x < b.x1 + margin && z > b.z0 - margin - 1.6 && z < b.z1 + margin + 1.6;
}

function rib(ctx: ArchContext, a: V3, b: V3, w = 0.06): void {
  ctx.g.beam('frame', [a[0], a[1] + 0.03, a[2]], [b[0], b[1] + 0.03, b[2]], w, 0.07);
}

function pavilionRoof(ctx: ArchContext, m: Mass, key: string, yb: number): void {
  const { g, style, bp } = ctx;
  const side = m.roof.pediment ?? 'garden';
  const dir = side === 'garden' ? 1 : -1;
  const ov = 0.62;
  const x0 = m.rect.x0 - ov;
  const x1 = m.rect.x1 + ov;
  const front = side === 'garden' ? m.rect.z1 + ov : m.rect.z0 - ov;
  const main = bp.masses.find((q) => q.kind === 'main')!;
  const back = side === 'garden' ? main.rect.z1 - 2.5 : main.rect.z0 + 2.5;
  const half = (x1 - x0) / 2;
  const xm = (x0 + x1) / 2;
  const pitch = PAVILION_PITCH;
  const yr = yb + half * Math.tan(pitch * DEG);
  const s = Math.sin(pitch * DEG);
  g.setTint('#ffffff');
  faceQuad(ctx, key, [x0, yb, front], [x0, yb, back], [xm, yr, back], [xm, yr, front], [-1, 1, 0], slopeUv('z', yb, s));
  faceQuad(ctx, key, [x1, yb, back], [x1, yb, front], [xm, yr, front], [xm, yr, back], [1, 1, 0], slopeUv('z', yb, s));
  // Tympanum on the façade plane, raking cornices proud of it.
  const face = side === 'garden' ? m.rect.z1 + 0.3 : m.rect.z0 - 0.3;
  const tx0 = m.rect.x0 - 0.3;
  const tx1 = m.rect.x1 + 0.3;
  const th = ((tx1 - tx0) / 2) * Math.tan(pitch * DEG);
  const tm = (tx0 + tx1) / 2;
  g.setTint(style.wallMaterial === 'brick' ? style.trimColor : style.wallColor);
  g.triFacing('ext-trim', [tx0, yb, face], [tx1, yb, face], [tm, yb + th, face], 0, 0, dir);
  g.setTint(style.trimColor);
  const rake = (xa: number, xb: number, ya: number, yc: number) => {
    const n0 = face;
    const n1 = face + dir * 0.62;
    const P = (x: number, y: number, z: number): V3 => [x, y, z];
    const up = 0.32;
    g.quadFacing('ext-trim', P(xa, ya + up, n0), P(xb, yc + up, n0), P(xb, yc + up, n1), P(xa, ya + up, n1), 0, 1, 0);
    g.quadFacing('ext-trim', P(xa, ya, n1), P(xb, yc, n1), P(xb, yc + up, n1), P(xa, ya + up, n1), 0, 0, dir);
    g.quadFacing('ext-trim', P(xa, ya, n0), P(xb, yc, n0), P(xb, yc, n1), P(xa, ya, n1), 0, -1, 0);
  };
  rake(x0, xm, yb, yr);
  rake(xm, x1, yr, yb);
}

function halfWidth(ctx: ArchContext): number {
  return ctx.bp.masses.find((q) => q.kind === 'main')!.rect.x1;
}

function hipDormers(ctx: ArchContext, m: Mass, r: Rect, yb: number, pitch: number): void {
  const { bp, g, style, rand } = ctx;
  const t = Math.tan(pitch * DEG);
  const D = r.z1 - r.z0;
  const W = r.x1 - r.x0;
  if (W < D) return;
  const rise = 0.95;
  const h = 1.55;
  const dw = 1.25;
  const inset = rise / t;
  if (inset + (h + 0.4) / t > D / 2 - 0.3) return;
  for (const side of [1, -1] as const) {
    const zf = side > 0 ? r.z1 - inset : r.z0 + inset;
    for (let i = 0; i < bp.bays; i += 2) {
      const x = -halfWidth(ctx) + (i + 0.5) * bp.bay;
      if (x - dw / 2 < r.x0 + D / 2 + 0.4 || x + dw / 2 > r.x1 - D / 2 - 0.4) continue;
      if (nearDome(ctx, x, zf, dw / 2 + 0.5)) continue;
      const depth = (h + 0.3) / t + 0.3;
      const zb = zf - side * depth;
      const y0 = yb + rise;
      g.setTint(style.wallMaterial === 'brick' ? style.trimColor : style.wallColor);
      g.box('ext-trim', x - dw / 2, y0, Math.min(zf, zb), x + dw / 2, y0 + h, Math.max(zf, zb), side > 0 ? 1 | 2 | 16 : 1 | 2 | 32);
      // Little gable roof.
      g.setTint('#ffffff');
      const key = `roof-${style.roofMaterial}`;
      const yr = y0 + h + dw * 0.35;
      faceQuad(ctx, key, [x - dw / 2 - 0.15, y0 + h, zf + side * 0.15], [x - dw / 2 - 0.15, y0 + h, zb], [x, yr, zb], [x, yr, zf + side * 0.15], [-1, 1, 0], (p) => [p[2], p[1]]);
      faceQuad(ctx, key, [x + dw / 2 + 0.15, y0 + h, zb], [x + dw / 2 + 0.15, y0 + h, zf + side * 0.15], [x, yr, zf + side * 0.15], [x, yr, zb], [1, 1, 0], (p) => [p[2], p[1]]);
      g.setTint(style.trimColor);
      g.triFacing('ext-trim', [x - dw / 2 - 0.1, y0 + h, zf + side * 0.05], [x + dw / 2 + 0.1, y0 + h, zf + side * 0.05], [x, yr - 0.05, zf + side * 0.05], 0, 0, side);
      dormerWindow(ctx, x, y0 + 0.15, zf + side * 0.02, side, dw - 0.35, h - 0.35, rand() < 0.3);
    }
  }
  void m;
}

function mansardDormers(ctx: ArchContext, m: Mass, r: Rect, inset: number, yb: number, hb: number): void {
  const { bp, g, style, rand } = ctx;
  const dw = 1.3;
  const h = Math.min(2.1, hb - 0.6);
  for (const side of [1, -1] as const) {
    const zf = side > 0 ? r.z1 - inset * 0.35 : r.z0 + inset * 0.35;
    for (let i = 0; i < bp.bays; i++) {
      const x = -halfWidth(ctx) + (i + 0.5) * bp.bay;
      if (x - dw / 2 < r.x0 + 1.2 || x + dw / 2 > r.x1 - 1.2) continue;
      if (m.rect.x0 > x || m.rect.x1 < x) continue;
      if (nearDome(ctx, x, zf, dw / 2 + 0.5)) continue;
      const y0 = yb + 0.35;
      const zb = zf - side * 1.6;
      g.setTint(style.trimColor);
      g.box('ext-trim', x - dw / 2, y0, Math.min(zf, zb), x + dw / 2, y0 + h, Math.max(zf, zb), side > 0 ? 1 | 2 | 4 | 16 : 1 | 2 | 4 | 32);
      // Segmental hood.
      for (let k = 0; k < 6; k++) {
        const a = x - dw / 2 - 0.1 + ((dw + 0.2) * k) / 6;
        const b = x - dw / 2 - 0.1 + ((dw + 0.2) * (k + 1)) / 6;
        const yy = y0 + h + Math.sin(((k + 0.5) / 6) * Math.PI) * 0.28;
        g.box('ext-trim', a, y0 + h - 0.05, Math.min(zf + side * 0.12, zb), b, yy + 0.08, Math.max(zf + side * 0.12, zb));
      }
      dormerWindow(ctx, x, y0 + 0.12, zf + side * 0.02, side, dw - 0.36, h - 0.3, rand() < 0.35);
    }
  }
}

function dormerWindow(ctx: ArchContext, x: number, y0: number, z: number, side: 1 | -1, w: number, h: number, lit: boolean): void {
  const { g, style } = ctx;
  g.setTint(style.windowFrameColor);
  const fr = (a: number, b: number, c: number, d: number) => g.box('frame', a, c, z - 0.04, b, d, z + 0.04);
  fr(x - w / 2, x - w / 2 + 0.06, y0, y0 + h);
  fr(x + w / 2 - 0.06, x + w / 2, y0, y0 + h);
  fr(x - w / 2, x + w / 2, y0, y0 + 0.06);
  fr(x - w / 2, x + w / 2, y0 + h - 0.06, y0 + h);
  fr(x - 0.015, x + 0.015, y0, y0 + h);
  fr(x - w / 2, x + w / 2, y0 + h / 2 - 0.015, y0 + h / 2 + 0.015);
  g.setTint('#ffffff');
  const key = lit ? 'glass-lit' : 'glass';
  if (side > 0) g.quad(key, [x - w / 2, y0, z], [x + w / 2, y0, z], [x + w / 2, y0 + h, z], [x - w / 2, y0 + h, z]);
  else g.quad(key, [x + w / 2, y0, z], [x - w / 2, y0, z], [x - w / 2, y0 + h, z], [x + w / 2, y0 + h, z]);
}

function chimneys(ctx: ArchContext, m: Mass, roof: { ridgeY: number; alongX: boolean; ridge: [number, number] }, r: Rect): void {
  const { g, style } = ctx;
  const brick = style.wallMaterial === 'brick';
  const xs: number[] = [];
  if (roof.alongX) {
    const [a, b] = roof.ridge;
    const span = b - a;
    if (span > 6) xs.push(a + 1.2, b - 1.2);
    if (span > 26) xs.push(a + span * 0.36, b - span * 0.36);
  }
  const zm = (r.z0 + r.z1) / 2;
  for (const x of xs) {
    if (nearDome(ctx, x, zm, 1.4)) continue;
    const y0 = roof.ridgeY - 2.2;
    const y1 = roof.ridgeY + 2.0;
    g.setTint(brick ? '#ffffff' : style.wallColor);
    g.box(brick ? 'chimney' : 'ext-wall-limestone', x - 0.85, y0, zm - 0.42, x + 0.85, y1, zm + 0.42);
    g.setTint(style.trimColor);
    g.box('ext-trim', x - 0.95, y1, zm - 0.52, x + 0.95, y1 + 0.22, zm + 0.52);
    g.box('ext-trim', x - 0.9, y1 - 0.55, zm - 0.47, x + 0.9, y1 - 0.42, zm + 0.47);
    g.setTint('#8c5034');
    for (const dx of [-0.5, 0, 0.5]) g.cylinder('ext-trim', x + dx, y1 + 0.22, zm, 0.15, 0.12, 0.55, 8, true);
  }
  void m;
}

/* ------------------------------------------------------------------ */
/* Porticos                                                            */
/* ------------------------------------------------------------------ */

export function buildPorticos(ctx: ArchContext): void {
  for (const p of ctx.bp.porticos) portico(ctx, p);
}

function portico(ctx: ArchContext, p: Portico): void {
  const { g, style } = ctx;
  g.scope = -1;
  g.setTint(style.trimColor);
  const dir = p.side === 'garden' ? 1 : -1;
  const r = p.columnRadius;
  const giant = p.topY - p.baseY > 7.5;
  const entH = giant ? 1.7 : 1.15;
  const capH = p.order === 'doric' ? r * 0.9 : p.order === 'ionic' ? r * 1.0 : r * 2.2;
  const shaftTop = p.topY - entH - capH;
  const face = dir > 0 ? p.rect.z0 : p.rect.z1;
  const colZ = p.columns[0]!.z;
  // Podium + steps on the entrance side (the garden side stands on the terrace).
  if (p.side === 'entrance') {
    g.box('ext-base', p.rect.x0 - 0.4, -0.3, Math.min(face, colZ - r - 0.6), p.rect.x1 + 0.4, p.baseY, face);
    const n = Math.max(3, Math.ceil(p.baseY / 0.16));
    const zFront = colZ - r - 0.6;
    for (let i = 0; i < n; i++) {
      const y = p.baseY - (i + 1) * (p.baseY / n);
      g.box('ext-trim', p.rect.x0 + 0.6, -0.3, zFront - (i + 1) * 0.38, p.rect.x1 - 0.6, y + p.baseY / n, zFront - i * 0.38);
    }
  }
  for (const c of p.columns) {
    g.box('ext-trim', c.x - r * 1.35, p.baseY, c.z - r * 1.35, c.x + r * 1.35, p.baseY + 0.2, c.z + r * 1.35);
    const b0 = p.baseY + 0.2;
    const prof: [number, number][] = [
      [r * 1.28, b0],
      [r * 1.3, b0 + 0.07],
      [r * 1.12, b0 + 0.13],
      [r * 1.18, b0 + 0.19],
      [r * 1.03, b0 + 0.26],
      [r, b0 + 0.32],
      [r * 0.985, b0 + (shaftTop - b0) * 0.33],
      [r * 0.86, shaftTop],
      [r * 0.92, shaftTop + 0.05],
      [r * 0.88, shaftTop + 0.1],
    ];
    if (p.order === 'doric') prof.push([r * 1.12, shaftTop + capH * 0.6], [r * 1.18, shaftTop + capH * 0.65]);
    else if (p.order === 'corinthian') prof.push([r * 1.0, shaftTop + capH * 0.4], [r * 1.25, shaftTop + capH * 0.85]);
    else prof.push([r * 0.98, shaftTop + capH * 0.5]);
    g.lathe('ext-trim', c.x, c.z, prof, 14, false);
    const abY = p.topY - entH - (p.order === 'doric' ? capH * 0.35 : 0.14);
    g.box('ext-trim', c.x - r * 1.35, abY, c.z - r * 1.35, c.x + r * 1.35, abY + (p.order === 'doric' ? capH * 0.35 : 0.14), c.z + r * 1.35);
    if (p.order === 'ionic') {
      // Volutes: scrolls either side, parallel to the façade.
      for (const s of [-1, 1]) g.cylinder('ext-trim', c.x + s * r * 1.05, abY - r * 0.42, c.z - r * 1.05, r * 0.36, r * 0.36, r * 2.1, 10, true);
    }
    if (p.order === 'corinthian') {
      // Leaf tufts.
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.sphere('ext-trim', c.x + Math.cos(a) * r * 0.95, shaftTop + capH * 0.35, c.z + Math.sin(a) * r * 0.95, r * 0.22, capH * 0.28, r * 0.22, 6, 4);
      }
    }
  }
  // Entablature: architrave, frieze, cornice.
  const zb = face;
  const zf = colZ + dir * (r + 0.35);
  const lo = Math.min(zb, zf);
  const hi = Math.max(zb, zf);
  const y0 = p.topY - entH;
  g.box('ext-trim', p.rect.x0, y0, lo, p.rect.x1, y0 + entH * 0.36, hi);
  g.box('ext-trim', p.rect.x0 - 0.05, y0 + entH * 0.36, lo, p.rect.x1 + 0.05, y0 + entH * 0.72, hi + (dir > 0 ? 0.05 : 0));
  g.box('ext-trim', p.rect.x0 - 0.35, y0 + entH * 0.72, lo - (dir < 0 ? 0.35 : 0), p.rect.x1 + 0.35, p.topY, hi + (dir > 0 ? 0.35 : 0));
  // Pediment: tympanum, raking cornices, roof slopes back to the façade.
  const pitch = 22.5;
  const xa = p.rect.x0 - 0.35;
  const xb = p.rect.x1 + 0.35;
  const xm = (xa + xb) / 2;
  const ph = ((xb - xa) / 2) * Math.tan(pitch * DEG);
  const zt = dir > 0 ? hi + 0.35 : lo - 0.35;
  g.triFacing('ext-trim', [xa + 0.35, p.topY, zt - dir * 0.25], [xb - 0.35, p.topY, zt - dir * 0.25], [xm, p.topY + ph * 0.86, zt - dir * 0.25], 0, 0, dir);
  const key = `roof-${style.roofMaterial === 'zinc' ? 'zinc' : 'lead'}`;
  g.setTint('#ffffff');
  const back = dir > 0 ? lo - 0.2 : hi + 0.2;
  faceQuad(ctx, key, [xa, p.topY, zt], [xa, p.topY, back], [xm, p.topY + ph, back], [xm, p.topY + ph, zt], [-1, 1, 0], (q) => [q[2], q[1]]);
  faceQuad(ctx, key, [xb, p.topY, back], [xb, p.topY, zt], [xm, p.topY + ph, zt], [xm, p.topY + ph, back], [1, 1, 0], (q) => [q[2], q[1]]);
  g.setTint(style.trimColor);
  const rake = (x0: number, x1: number, ya: number, yc: number) => {
    const n0 = zt - dir * 0.3;
    const n1 = zt + dir * 0.05;
    g.quadFacing('ext-trim', [x0, ya + 0.3, n0], [x1, yc + 0.3, n0], [x1, yc + 0.3, n1], [x0, ya + 0.3, n1], 0, 1, 0);
    g.quadFacing('ext-trim', [x0, ya, n1], [x1, yc, n1], [x1, yc + 0.3, n1], [x0, ya + 0.3, n1], 0, 0, dir);
    g.quadFacing('ext-trim', [x0, ya, n0], [x1, yc, n0], [x1, yc, n1], [x0, ya, n1], 0, -1, 0);
  };
  rake(xa, xm, p.topY, p.topY + ph);
  rake(xm, xb, p.topY + ph, p.topY);
  // Soffit (ceiling of the porch).
  g.quadFacing('ext-trim', [p.rect.x0, y0 - 0.01, lo], [p.rect.x1, y0 - 0.01, lo], [p.rect.x1, y0 - 0.01, hi], [p.rect.x0, y0 - 0.01, hi], 0, -1, 0);
  // Balustrade between the outer columns on a giant garden portico? Keep the porch open for guests.
  void baluster;
}
