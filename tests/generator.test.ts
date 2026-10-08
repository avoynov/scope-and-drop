import { describe, expect, it } from 'vitest';
import { generateMansion, navCellAt, navComponents, SightlineTracer, collectOccluders } from '../src/mansion';
import type { MansionBlueprint, MansionSize, MassingType, StyleId } from '../src/mansion';

const json = (bp: MansionBlueprint) => JSON.stringify(bp, (k, v) => (k === 'generationMs' ? 0 : v instanceof Uint8Array || v instanceof Int16Array ? Array.from(v) : v));

describe('determinism', () => {
  it('same seed gives a byte-identical blueprint', () => {
    expect(json(generateMansion({ seed: 'determinism' }))).toBe(json(generateMansion({ seed: 'determinism' })));
  });
  it('different seeds give different mansions', () => {
    const a = generateMansion({ seed: 'one' });
    const b = generateMansion({ seed: 'two' });
    expect(json(a)).not.toBe(json(b));
  });
  it('numeric and string seeds are equivalent', () => {
    expect(json(generateMansion({ seed: 42 }))).toBe(json(generateMansion({ seed: '42' })));
  });
});

describe('validity across seeds', () => {
  const styles: StyleId[] = ['palladian', 'georgian', 'beauxarts'];
  const massings: MassingType[] = ['block', 'u-garden', 'u-entrance', 'h'];
  const sizes: MansionSize[] = ['compact', 'grand', 'palatial'];
  const cases: [StyleId, MassingType, MansionSize][] = [];
  for (const s of styles) for (const m of massings) for (const z of sizes) cases.push([s, m, z]);
  it.each(cases)('%s / %s / %s', (style, massing, size) => {
    for (let i = 0; i < 3; i++) {
      const bp = generateMansion({ seed: `t-${style}-${massing}-${size}-${i}`, style, massing, size });
      const errors = bp.validation.issues.filter((x) => x.severity === 'error');
      expect(errors, errors.map((e) => e.message).join('\n')).toEqual([]);
      expect(bp.style.id).toBe(style);
    }
  });
  it('100 random seeds are all valid', () => {
    let attempts = 0;
    for (let i = 0; i < 100; i++) {
      const bp = generateMansion({ seed: `random-${i}` });
      expect(bp.validation.ok, `${bp.seed}: ${bp.validation.issues.map((x) => x.message).join('; ')}`).toBe(true);
      attempts += bp.attempt + 1;
    }
    expect(attempts / 100).toBeLessThan(1.5);
  });
});

describe('structure', () => {
  const bp = generateMansion({ seed: 'structure', massing: 'h', size: 'grand' });

  it('rooms on a storey never overlap and every room has a clear interior', () => {
    for (const r of bp.rooms) {
      expect(r.inner.x1 - r.inner.x0).toBeGreaterThan(1.5);
      expect(r.inner.z1 - r.inner.z0).toBeGreaterThan(1.5);
    }
  });

  it('walls sit exactly on room edges and openings fit inside their wall', () => {
    for (const w of bp.walls) {
      const len = w.axis === 'x' ? w.b.x - w.a.x : w.b.z - w.a.z;
      expect(len).toBeGreaterThan(0);
      for (const o of w.openings) {
        expect(o.u0).toBeGreaterThanOrEqual(0);
        expect(o.u1).toBeLessThanOrEqual(len + 1e-6);
        expect(o.y1).toBeGreaterThan(o.y0);
      }
      const sorted = w.openings.slice().sort((a, b) => a.u0 - b.u0);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.u0).toBeGreaterThanOrEqual(sorted[i - 1]!.u1);
    }
  });

  it('every storey is one walkable component reaching every room', () => {
    for (const n of bp.nav.levels) {
      const comp = navComponents(n);
      const ids = new Set<number>();
      comp.forEach((c) => c >= 0 && ids.add(c));
      expect(ids.size).toBe(1);
      for (const r of bp.rooms.filter((q) => q.level === n.level && q.type !== 'service-stair')) {
        let cells = 0;
        for (let k = 0; k < n.room.length; k++) if (n.room[k] === r.index && n.walk[k]) cells++;
        expect(cells, r.label).toBeGreaterThan(0);
      }
    }
  });

  it('storeys are linked by stairs', () => {
    for (let L = 0; L + 1 < bp.levels.length; L++) {
      expect(bp.stairs.some((s) => s.fromLevel === L && s.toLevel === L + 1)).toBe(true);
    }
    expect(bp.nav.links.some((l) => l.kind === 'stair')).toBe(true);
  });

  it('mission POIs stand on walkable floor', () => {
    for (const p of bp.pois) {
      const n = bp.nav.levels.find((q) => q.level === p.level)!;
      const near = [-1, 0, 1].flatMap((a) => [-1, 0, 1].map((b) => navCellAt(n, p.stand.x + a * n.cell, p.stand.z + b * n.cell)));
      expect(near.some((k) => k >= 0 && n.walk[k] === 1), `${p.id} ${p.type}`).toBe(true);
    }
  });

  it('serialises to JSON and back', () => {
    const s = json(bp);
    const back = JSON.parse(s);
    expect(back.schema).toBe('scope-and-drop/mansion@1');
    expect(back.rooms.length).toBe(bp.rooms.length);
  });
});

describe('sightlines', () => {
  const bp = generateMansion({ seed: 'sight', massing: 'block' });
  const tracer = new SightlineTracer(bp.site.perch.eye, collectOccluders({ ...bp, props: bp.props, site: bp.site, withProps: true }));

  it('the terrace in front of the house is in plain view', () => {
    const t = bp.site.terrace;
    expect(tracer.person(0, t.rect.z1 - 1.5, t.y)).toBeGreaterThan(0.8);
  });

  it('a point behind the house is hidden', () => {
    expect(tracer.person(0, bp.stats.footprint.z0 - 3, 0)).toBe(0);
  });

  it('the back pile is mostly a blind spot while the garden front is watchable', () => {
    const front = bp.rooms.filter((r) => r.level === 0 && r.stage && r.role === 'party');
    const back = bp.rooms.filter((r) => r.level === 0 && r.massId === 'main' && r.rect.z1 <= 0.01);
    const avg = (rs: typeof front) => rs.reduce((a, r) => a + (bp.sightlines.rooms[r.id] ?? 0), 0) / Math.max(1, rs.length);
    expect(avg(front)).toBeGreaterThan(avg(back) + 0.2);
  });

  it('party visibility sits inside the configured band', () => {
    const [lo, hi] = bp.options.partyVisibility;
    expect(bp.sightlines.partyVisible).toBeGreaterThanOrEqual(lo);
    expect(bp.sightlines.partyVisible).toBeLessThanOrEqual(hi);
  });
});

describe('performance', () => {
  it('generates a grand mansion in well under a second', () => {
    generateMansion({ seed: 'warmup' });
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) generateMansion({ seed: `perf-${i}` });
    expect((performance.now() - t0) / 5).toBeLessThan(400);
  });
});
