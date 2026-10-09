import { describe, expect, it } from 'vitest';
import { generateMansion } from '../src/mansion';
import type { MansionSize, MassingType, StyleId } from '../src/mansion';
import { buildFacades, buildInteriors, buildReveals, type ArchContext } from '../src/mansion/build/arch';
import { buildAtrium, buildDome } from '../src/mansion/build/atrium';
import { GeometryBuilder } from '../src/mansion/build/geometry';
import { RECIPES } from '../src/mansion/build/materials';
import { buildLanterns, buildProps } from '../src/mansion/build/props';
import { buildPorticos, buildRoofs } from '../src/mansion/build/roofs';
import { buildGardens, buildTerrain } from '../src/mansion/build/site';
import { buildStairs } from '../src/mansion/build/stairs';
import { synthesize } from '../src/mansion/build/textures';

/** Geometry-only pass of the renderer (no WebGL needed). */
function mesh(style: StyleId, massing: MassingType, size: MansionSize, seed: string) {
  const bp = generateMansion({ seed, style, massing, size });
  const g = new GeometryBuilder();
  let s = 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const ctx: ArchContext = { bp, g, rooms: new Map(bp.rooms.map((r) => [r.id, r])), style: bp.style, rand };
  buildInteriors(ctx);
  buildAtrium(ctx);
  buildReveals(ctx);
  buildFacades(ctx);
  const roofMark = g.mark();
  buildRoofs(ctx);
  buildDome(ctx, roofMark);
  buildPorticos(ctx);
  buildStairs(ctx);
  buildProps(bp, g, rand);
  buildLanterns(bp.lights, g, (l) => (l.z > 0 ? 0 : Math.PI));
  buildGardens(ctx);
  return { bp, g, geos: g.build() };
}

describe('renderer geometry', () => {
  const cases: [StyleId, MassingType, MansionSize][] = [
    ['palladian', 'block', 'grand'],
    ['georgian', 'u-garden', 'compact'],
    ['beauxarts', 'h', 'palatial'],
    ['palladian', 'u-entrance', 'grand'],
    ['orangery', 'u-garden', 'grand'],
    ['orangery', 'block', 'palatial'],
  ];
  it.each(cases)('%s / %s / %s meshes cleanly', (style, massing, size) => {
    const { geos } = mesh(style, massing, size, `mesh-${style}-${massing}`);
    let tris = 0;
    for (const [key, geo] of geos) {
      expect(RECIPES[key], `bucket ${key} has no material`).toBeDefined();
      const pos = geo.getAttribute('position').array as Float32Array;
      for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i]!), `${key} NaN`).toBe(true);
      expect(geo.getAttribute('aScope').count).toBe(geo.getAttribute('position').count);
      tris += (geo.index?.count ?? 0) / 3;
    }
    // A whole estate (house, furniture, gardens) stays well inside a real-time budget.
    expect(tris).toBeGreaterThan(20_000);
    expect(tris).toBeLessThan(900_000);
  });

  it('interior geometry carries room scopes; façades are exterior', () => {
    const { bp, geos } = mesh('palladian', 'block', 'grand', 'scopes');
    const floor = [...geos.entries()].find(([k]) => k.startsWith('floor-'))![1];
    const sc = floor.getAttribute('aScope').array as Float32Array;
    expect(Math.min(...sc)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...sc)).toBeLessThan(bp.rooms.length);
    const ext = geos.get(`ext-wall-${bp.style.wallMaterial}`) ?? geos.get('ext-rustic')!;
    expect(Array.from(ext.getAttribute('aScope').array as Float32Array).every((v) => v === -1)).toBe(true);
  });

  it('the roof is opened where the dome stands, and the hall has its stair, galleries and glass', () => {
    for (const hall of ['gallery', 'rotunda'] as const) {
      const bp = generateMansion({ seed: `dome-mesh-${hall}`, hall });
      const g = new GeometryBuilder();
      const ctx: ArchContext = { bp, g, rooms: new Map(bp.rooms.map((r) => [r.id, r])), style: bp.style, rand: () => 0.5 };
      buildInteriors(ctx);
      const before = g.mark();
      buildAtrium(ctx);
      // The hall mesher adds marble (stair, columns), gallery floors and balustrades.
      expect((g.buckets.get('marble')?.idx.length ?? 0) - (before.get('marble') ?? 0)).toBeGreaterThan(3000);
      const roofMark = g.mark();
      buildRoofs(ctx);
      buildDome(ctx, roofMark);
      const d = bp.atrium!.dome;
      const half = d.radius + 0.5;
      const roof = g.buckets.get(`roof-${bp.style.roofMaterial}`)!;
      for (let t = roofMark.get(`roof-${bp.style.roofMaterial}`) ?? 0; t < roof.idx.length; t += 3) {
        let cx = 0;
        let cz = 0;
        for (let k = 0; k < 3; k++) {
          cx += roof.pos.data[roof.idx.data[t + k]! * 3]! / 3;
          cz += roof.pos.data[roof.idx.data[t + k]! * 3 + 2]! / 3;
        }
        expect(Math.abs(cx - d.x) < half && Math.abs(cz - d.z) < half, `${hall}: roof triangle inside the dome base`).toBe(false);
      }
      expect(g.buckets.get('glass')!.idx.length).toBeGreaterThan(0);
    }
  });

  it('terrain is finite and covers the perch', () => {
    const bp = generateMansion({ seed: 'terrain' });
    const t = buildTerrain(bp, 0);
    const pos = t.getAttribute('position').array as Float32Array;
    expect(Array.from(pos).every(Number.isFinite)).toBe(true);
    t.computeBoundingBox();
    const bb = t.boundingBox!;
    expect(bb.max.z).toBeGreaterThan(bp.site.perch.eye.z);
  });

  it('procedural textures stay in range and noise textures tile seamlessly', () => {
    for (const key of ['ashlar', 'brick', 'herringbone', 'damask', 'books', 'slate', 'rug0'] as const) {
      const f = synthesize(key, 64);
      expect(f.col.every((v) => v >= 0 && v <= 1.0001), key).toBe(true);
    }
    // For continuous noise, the step across the wrap must look like any other step.
    for (const key of ['grass', 'gravel', 'foliage', 'stucco', 'plaster'] as const) {
      const N = 128;
      const f = synthesize(key, N);
      let wrap = 0;
      let inner = 0;
      for (let j = 0; j < N; j++) {
        wrap += Math.abs(f.h[j * N]! - f.h[j * N + N - 1]!);
        for (let i = 0; i + 1 < N; i++) inner += Math.abs(f.h[j * N + i]! - f.h[j * N + i + 1]!);
      }
      expect(wrap / N / (inner / (N * (N - 1))), key).toBeLessThan(2);
    }
  });
});

/**
 * Z-fighting guard. Two surfaces of different materials in one plane, facing the same way and
 * overlapping, flicker as the camera moves. Returns such overlaps (m2) by material pair, above `minY`.
 */
function coplanarOverlaps(g: GeometryBuilder, minY: number): Map<string, number> {
  const TRANSPARENT = new Set(['glass', 'roof-glass', 'sheer']);
  type Tri = { key: string; p: number[][]; n: number[]; d: number };
  const groups = new Map<string, Tri[]>();
  for (const [key, b] of g.buckets) {
    // Drapes are double-sided cloth hung on the wall plane; their backs are never seen.
    if (key === 'fabric') continue;
    for (let i = 0; i + 2 < b.idx.length; i += 3) {
      const p = [0, 1, 2].map((k) => {
        const v = b.idx.data[i + k]!;
        return [b.pos.data[v * 3]!, b.pos.data[v * 3 + 1]!, b.pos.data[v * 3 + 2]!];
      });
      if (Math.max(p[0]![1]!, p[1]![1]!, p[2]![1]!) < minY) continue;
      const e1 = [0, 1, 2].map((k) => p[1]![k]! - p[0]![k]!);
      const e2 = [0, 1, 2].map((k) => p[2]![k]! - p[0]![k]!);
      const c = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const len = Math.hypot(c[0]!, c[1]!, c[2]!);
      if (len < 1e-4) continue;
      const n0 = c.map((v) => v / len);
      // Glass is seen from both sides.
      for (const sgn of TRANSPARENT.has(key) ? [1, -1] : [1]) {
        const n = n0.map((v) => v * sgn);
        const d = n[0]! * p[0]![0]! + n[1]! * p[0]![1]! + n[2]! * p[0]![2]!;
        for (const off of [0, 0.5]) {
          const gk = `${n.map((v) => Math.round(v * 40)).join(',')}|${Math.floor(d / 0.006 + off)}|${off}`;
          let l = groups.get(gk);
          if (!l) groups.set(gk, (l = []));
          l.push({ key, p, n, d });
        }
      }
    }
  }
  const area2 = (P: number[][]) => P.reduce((s, q, i) => s + q[0]! * P[(i + 1) % P.length]![1]! - P[(i + 1) % P.length]![0]! * q[1]!, 0) / 2;
  const overlap = (a: Tri, b: Tri): number => {
    const m = a.n.map(Math.abs);
    const ax = m[0]! > m[1]! && m[0]! > m[2]! ? 0 : m[1]! > m[2]! ? 1 : 2;
    const u = (ax + 1) % 3;
    const v = (ax + 2) % 3;
    let poly = a.p.map((q) => [q[u]!, q[v]!]);
    const B = b.p.map((q) => [q[u]!, q[v]!]);
    const sB = Math.sign(area2(B)) || 1;
    for (let i = 0; i < 3 && poly.length; i++) {
      const c0 = B[i]!;
      const c1 = B[(i + 1) % 3]!;
      const side = (q: number[]) => sB * ((c1[0]! - c0[0]!) * (q[1]! - c0[1]!) - (c1[1]! - c0[1]!) * (q[0]! - c0[0]!));
      const out: number[][] = [];
      poly.forEach((q, j) => {
        const r = poly[(j + 1) % poly.length]!;
        const sq = side(q);
        const sr = side(r);
        if (sq >= 0) out.push(q);
        if (sq >= 0 !== sr >= 0) out.push([q[0]! + ((r[0]! - q[0]!) * sq) / (sq - sr), q[1]! + ((r[1]! - q[1]!) * sq) / (sq - sr)]);
      });
      poly = out;
    }
    return poly.length >= 3 ? Math.abs(area2(poly)) / Math.max(0.2, m[ax]!) : 0;
  };
  const found = new Map<string, number>();
  const seen = new Set<string>();
  for (const l of groups.values()) {
    for (let i = 0; i < l.length; i++) {
      for (let j = i + 1; j < l.length; j++) {
        const a = l[i]!;
        const b = l[j]!;
        if (a.key === b.key || (TRANSPARENT.has(a.key) && TRANSPARENT.has(b.key))) continue;
        if (Math.abs(a.d - b.d) > 0.004 || a.n[0]! * b.n[0]! + a.n[1]! * b.n[1]! + a.n[2]! * b.n[2]! < 0.9995) continue;
        const id = JSON.stringify([a.p, b.p]);
        if (seen.has(id)) continue;
        seen.add(id);
        const ar = overlap(a, b);
        if (ar < 0.004) continue;
        const k = [a.key, b.key].sort().join(' x ');
        found.set(k, (found.get(k) ?? 0) + ar);
      }
    }
  }
  return found;
}

describe('no z-fighting on the roofs', () => {
  const cases: [StyleId, MassingType, string][] = [
    ['orangery', 'u-garden', 'or-1'],
    ['orangery', 'h', 'pv-1'],
    ['orangery', 'block', 'c-1'],
    ['georgian', 'block', 'e-1'],
    ['beauxarts', 'h', 'opq-7'],
    ['palladian', 'u-garden', 'e-5'],
  ];
  it.each(cases)('%s / %s: no two materials share a plane from the eaves up', (style, massing, seed) => {
    const { bp, g } = mesh(style, massing, 'grand', seed);
    const eave = bp.masses.find((m) => m.kind === 'main')!.roof.eaveY;
    const found = coplanarOverlaps(g, eave - 0.7);
    // Lanterns, the hall's attic and glass roof, glazing bars: nothing larger than a bar's end may coincide.
    for (const [pair, area] of found) expect(area, `${pair} share a plane over ${area.toFixed(2)} m2`).toBeLessThan(0.3);
  });
});

