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
  return { bp, geos: g.build() };
}

describe('renderer geometry', () => {
  const cases: [StyleId, MassingType, MansionSize][] = [
    ['palladian', 'block', 'grand'],
    ['georgian', 'u-garden', 'compact'],
    ['beauxarts', 'h', 'palatial'],
    ['palladian', 'u-entrance', 'grand'],
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
