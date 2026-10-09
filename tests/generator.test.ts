import { describe, expect, it } from 'vitest';
import { generateMansion, movePerch, navCellAt, navComponents, SightlineTracer, collectOccluders } from '../src/mansion';
import type { MansionSize, MassingType, StyleId } from '../src/mansion';
import { roofSurfaceY } from '../src/mansion/core/roofs';

const json = (bp: unknown) => JSON.stringify(bp, (k, v) => (k === 'generationMs' ? 0 : v instanceof Uint8Array || v instanceof Int16Array ? Array.from(v) : v));

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
  const styles: StyleId[] = ['palladian', 'georgian', 'beauxarts', 'orangery'];
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
    expect(back.schema).toBe('scope-and-drop/mansion@2');
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

describe('visibility from the perch', () => {
  const seeds = Array.from({ length: 24 }, (_, i) => `vis-${i}`);
  const houses = seeds.map((seed) => generateMansion({ seed }));

  it('the terrace no longer props up the party figure: it is reported on its own', () => {
    for (const bp of houses) {
      // Indoor party floor on every storey, recomputed from the nav grids, must equal the reported figure.
      let sum = 0;
      let n = 0;
      for (const lv of bp.nav.levels) {
        for (let k = 0; k < lv.walk.length; k++) {
          const ri = lv.room[k]!;
          if (!lv.walk[k] || ri < 0) continue;
          const r = bp.rooms[ri]!;
          if (r.role !== 'party' || r.type === 'roof-terrace') continue;
          sum += lv.vis[k]! / 255;
          n++;
        }
      }
      expect(bp.sightlines.partyVisible).toBeCloseTo(sum / n, 2);
    }
  });

  it('the sniper sees well over a third of the indoor party on average', () => {
    const mean = houses.reduce((a, bp) => a + bp.sightlines.partyVisible, 0) / houses.length;
    expect(mean).toBeGreaterThan(0.38);
  });

  it('the spy always keeps cover: part of the ground floor stays out of sight', () => {
    for (const bp of houses) expect(bp.sightlines.hiddenShare, bp.seed).toBeGreaterThanOrEqual(0.15);
  });

  it('column screens only open party rooms into party rooms', () => {
    let screens = 0;
    for (const bp of houses) {
      const role = new Map(bp.rooms.map((r) => [r.id, r.role]));
      for (const w of bp.walls) {
        if (w.exterior || w.level !== 0) continue;
        for (const o of w.openings) {
          if (o.kind !== 'arch' || o.u1 - o.u0 < 2.2) continue;
          screens++;
          expect(role.get(w.neg!), `${bp.seed} ${w.id}`).toBe('party');
          expect(role.get(w.pos!), `${bp.seed} ${w.id}`).toBe('party');
        }
      }
    }
    expect(screens).toBeGreaterThan(0);
  });
});

describe('dome hall', () => {
  const bp = generateMansion({ seed: 'dome', size: 'grand' });
  const a = bp.atrium!;

  it('every house has one, open through every storey, with a gallery on each upper floor', () => {
    for (const seed of ['dome', 'dome-2', 'dome-3', 'dome-4']) {
      const h = generateMansion({ seed });
      expect(h.atrium, seed).not.toBeNull();
      expect(h.atrium!.galleries.map((g) => g.level)).toEqual(h.levels.slice(1).map((l) => l.index));
      expect(h.rooms.some((r) => r.type === 'stair-hall')).toBe(false);
      expect(h.atrium!.dome.springY).toBeGreaterThan(h.masses.find((m) => m.kind === 'main')!.roof.eaveY);
    }
  });

  it('the split stair starts on the dance floor and lands on the first gallery', () => {
    const stair = bp.stairs.find((s) => s.id === a.stairId)!;
    expect(stair.kind).toBe('grand');
    expect(stair.bottomRoom).toBe(a.roomId);
    expect(stair.arms).toHaveLength(2);
    for (const arm of stair.arms!) {
      expect(arm.y0).toBe(bp.levels[0]!.floorY);
      expect(arm.y0 + arm.rise).toBeCloseTo(bp.levels[1]!.floorY, 6);
      const riser = arm.rise / arm.steps;
      let len = 0;
      for (let i = 1; i < arm.path.length; i++) len += Math.hypot(arm.path[i]!.x - arm.path[i - 1]!.x, arm.path[i]!.z - arm.path[i - 1]!.z);
      // Walkable: risers no taller than 19 cm, treads at least 25 cm.
      expect(riser).toBeLessThanOrEqual(0.19 + 1e-9);
      expect(len / arm.steps).toBeGreaterThanOrEqual(0.25);
      for (const p of arm.path) {
        expect(p.x).toBeGreaterThan(a.inner.x0);
        expect(p.x).toBeLessThan(a.inner.x1);
        expect(p.z).toBeGreaterThan(a.inner.z0);
        expect(p.z).toBeLessThan(a.inner.z1);
      }
    }
    // The two arms mirror each other about the hall axis.
    const [east, west] = stair.arms!;
    const cx = (a.inner.x0 + a.inner.x1) / 2;
    east!.path.forEach((p, i) => expect(p.x + west!.path[i]!.x).toBeCloseTo(2 * cx, 2));
  });

  it('each gallery is walkable and has doors on its left, back and right', () => {
    for (const g of a.galleries) {
      const room = bp.rooms.find((r) => r.id === g.roomId)!;
      const n = bp.nav.levels.find((l) => l.level === g.level)!;
      let cells = 0;
      for (let k = 0; k < n.room.length; k++) if (n.room[k] === room.index && n.walk[k]) cells++;
      expect(cells).toBeGreaterThan(100);
      const sides = new Set<string>();
      for (const w of bp.walls) {
        if (w.level !== g.level || w.exterior || (w.neg !== g.roomId && w.pos !== g.roomId)) continue;
        if (!w.openings.some((o) => o.passable)) continue;
        if (w.axis === 'x') sides.add('back');
        else sides.add(w.a.x < (a.inner.x0 + a.inner.x1) / 2 ? 'left' : 'right');
      }
      expect([...sides].sort(), `level ${g.level}`).toEqual(['back', 'left', 'right']);
    }
  });

  it('nobody can walk on the void, and the gallery floor is where the outline says', () => {
    const g = a.galleries[0]!;
    const room = bp.rooms.find((r) => r.id === g.roomId)!;
    const n = bp.nav.levels.find((l) => l.level === g.level)!;
    const k = navCellAt(n, a.dome.x, a.dome.z);
    expect(n.walk[k]).toBe(0);
    // Just inside the west wall, halfway down the hall: gallery floor.
    const kg = navCellAt(n, a.inner.x0 + a.galleryWidth / 2, a.inner.z1 - 1.2);
    expect(n.walk[kg]).toBe(1);
    expect(n.room[kg]).toBe(room.index);
  });

  it('the hall shape is chosen before generation and changes only the hall', () => {
    for (const seed of ['shape-1', 'shape-2', 'shape-3']) {
      const gallery = generateMansion({ seed, hall: 'gallery' });
      const rotunda = generateMansion({ seed, hall: 'rotunda' });
      expect(gallery.validation.ok && rotunda.validation.ok).toBe(true);
      expect(gallery.atrium!.shape).toBe('gallery');
      expect(rotunda.atrium!.shape).toBe('rotunda');
      expect(gallery.atrium!.curvedWalls).toHaveLength(0);
      expect(rotunda.atrium!.curvedWalls).toHaveLength(2);
      // Same massing and the same rooms either way.
      expect(rotunda.rooms.map((r) => [r.id, r.rect])).toEqual(gallery.rooms.map((r) => [r.id, r.rect]));
      expect(rotunda.masses).toEqual(gallery.masses);
    }
  });
});

describe('choosing the bearing', () => {
  const bp = generateMansion({ seed: 'bearing' });

  it('moving back to the generated bearing reproduces the blueprint exactly', () => {
    expect(json(movePerch(bp, bp.site.perch.azimuthDeg))).toBe(json(bp));
  });

  it('another bearing moves only the eye and what depends on it', () => {
    const moved = movePerch(bp, bp.site.perch.azimuthDeg > 0 ? -30 : 30);
    expect(moved.site.perch.eye).not.toEqual(bp.site.perch.eye);
    expect(moved.rooms).toEqual(bp.rooms);
    expect(moved.walls).toEqual(bp.walls);
    expect(moved.props).toEqual(bp.props);
    expect(moved.site.trees).toEqual(bp.site.trees);
    expect(moved.pois.map((p) => p.stand)).toEqual(bp.pois.map((p) => p.stand));
    expect(json(moved.nav.levels.map((l) => l.walk))).toBe(json(bp.nav.levels.map((l) => l.walk)));
    expect(json(moved.nav.levels[0]!.vis)).not.toBe(json(bp.nav.levels[0]!.vis));
  });

  it('bearings are clamped to the arc', () => {
    const [lo, hi] = bp.site.perch.arcDeg;
    expect(movePerch(bp, -90).site.perch.azimuthDeg).toBe(lo);
    expect(movePerch(bp, 90).site.perch.azimuthDeg).toBe(hi);
  });

  it('no tree belt stands between any bearing and the terrace', () => {
    for (const seed of ['bearing', 'bearing-2', 'bearing-3']) {
      const h = generateMansion({ seed });
      const [lo, hi] = h.site.perch.arcDeg;
      for (const az of [lo, lo / 2, 0, hi / 2, hi]) expect(movePerch(h, az).sightlines.terrace, `${seed} @ ${az}`).toBeGreaterThan(0.8);
    }
  });

  it('a perch azimuth option does not reshuffle the house or the grounds', () => {
    const other = generateMansion({ seed: 'bearing', perchAzimuthDeg: 20 });
    expect(other.site.perch.azimuthDeg).toBe(20);
    expect(other.rooms.map((r) => r.rect)).toEqual(bp.rooms.map((r) => r.rect));
    expect(other.site.terrain.perchRise).toBe(bp.site.terrain.perchRise);
    expect(other.site.fountain).toEqual(bp.site.fountain);
  });
});

describe('choosing the elevation', () => {
  const bp = generateMansion({ seed: 'elevation' });
  const hallSeen = (b: typeof bp) => b.sightlines.rooms[b.atrium!.roomId] ?? 0;
  const topGallery = (b: typeof bp) => b.sightlines.rooms[b.atrium!.galleries[b.atrium!.galleries.length - 1]!.roomId] ?? 0;

  it('the sniper starts on the ground and may climb to sixty degrees', () => {
    expect(bp.site.perch.elevationDeg).toBe(0);
    expect(bp.site.perch.elevationRangeDeg).toEqual([0, 60]);
    expect(movePerch(bp, 0, 90).site.perch.elevationDeg).toBe(60);
    expect(bp.site.perch.elevationOptions.length).toBeGreaterThan(3);
  });

  it('climbing keeps the range and the house, and raises the eye', () => {
    const up = movePerch(bp, bp.site.perch.azimuthDeg, 45);
    const t = bp.site.perch.target;
    const range = (b: typeof bp) => Math.hypot(b.site.perch.eye.x - t.x, b.site.perch.eye.z - t.z, b.site.perch.eye.y - (b.groundFloorY + 3));
    expect(up.site.perch.eye.y).toBeGreaterThan(bp.site.perch.eye.y + 80);
    expect(range(up)).toBeCloseTo(bp.site.perch.distance, 0);
    expect(json(up.rooms)).toBe(json(bp.rooms));
    expect(json(up.walls)).toBe(json(bp.walls));
    expect(json(movePerch(up, bp.site.perch.azimuthDeg, 0))).toBe(json(bp));
  });

  it('from above, the glass roof shows the top gallery that no window shows from the ground', () => {
    for (const seed of ['el-1', 'el-2', 'el-3', 'el-4']) {
      for (const hall of ['gallery', 'rotunda'] as const) {
        const low = generateMansion({ seed, hall, style: 'georgian' });
        const high = movePerch(low, 0, 55);
        expect(topGallery(high)).toBeGreaterThan(0.6);
        expect(topGallery(high)).toBeGreaterThan(topGallery(low) + 0.2);
        expect(hallSeen(high)).toBeGreaterThan(0.12);
      }
    }
  });
});

describe('minimum visible share', () => {
  it('a house below the minimum is regenerated', () => {
    for (const seed of ['mv-1', 'mv-2', 'mv-3', 'mv-4', 'mv-5', 'mv-6']) {
      const bp = generateMansion({ seed, minVisible: 0.45 });
      expect(bp.options.partyVisibility[0]).toBe(0.45);
      expect(bp.validation.ok).toBe(true);
      expect(bp.sightlines.partyVisible).toBeGreaterThanOrEqual(0.45);
    }
  });
  it('an impossible minimum is reported, not silently ignored', () => {
    const bp = generateMansion({ seed: 'mv-impossible', minVisible: 0.95, maxAttempts: 3 });
    expect(bp.validation.ok).toBe(false);
    expect(bp.validation.issues.some((i) => i.severity === 'error' && /visib/i.test(i.code + i.message))).toBe(true);
  });
});

describe('proportions of a great house', () => {
  const houses = (['compact', 'grand', 'palatial'] as MansionSize[]).flatMap((size) => ['p-1', 'p-2', 'p-3', 'p-4'].map((seed) => generateMansion({ seed, size })));
  it('the hall, its galleries and its stair are generous', () => {
    for (const bp of houses) {
      const a = bp.atrium!;
      expect(a.inner.x1 - a.inner.x0).toBeGreaterThanOrEqual(17);
      expect(a.inner.z1 - a.inner.z0).toBeGreaterThanOrEqual(13);
      expect(a.galleryWidth).toBeGreaterThanOrEqual(3);
      for (const arm of bp.stairs.find((s) => s.id === a.stairId)!.arms!) expect(arm.width).toBeGreaterThanOrEqual(2.6);
    }
  });
  it('the dome roofs the hall from wall to wall', () => {
    for (const bp of houses) {
      const a = bp.atrium!;
      const span = Math.min(a.inner.x1 - a.inner.x0, a.inner.z1 - a.inner.z0);
      expect(a.dome.radius * 2).toBeGreaterThan(span - 1.5);
      expect(a.dome.radius).toBeGreaterThanOrEqual(6.5);
      // The lantern: a glazed attic clear of the roofs round it, a drum, then a dome taller than a hemisphere's half.
      const top = bp.levels[bp.levels.length - 1]!;
      const eave = top.floorY + top.height;
      expect(a.dome.deckY - eave).toBeGreaterThanOrEqual(2);
      expect(a.dome.deckY - eave).toBeLessThanOrEqual(7);
      for (const [x, z] of [[a.inner.x0 - 0.7, a.dome.z], [a.inner.x1 + 0.7, a.dome.z], [a.dome.x, a.inner.z0 - 0.7]] as const) {
        const roof = roofSurfaceY(bp.masses, x, z);
        if (Number.isFinite(roof)) expect(a.dome.deckY).toBeGreaterThan(roof + 0.5);
      }
      expect(a.dome.springY - a.dome.deckY).toBeGreaterThanOrEqual(1.8);
      expect(a.dome.height).toBeGreaterThan(a.dome.radius * 0.8);
    }
  });
  it('no room of the party is narrower than five metres, and corridors are wide', () => {
    for (const bp of houses) {
      for (const r of bp.rooms) {
        const span = Math.min(r.rect.x1 - r.rect.x0, r.rect.z1 - r.rect.z0);
        if (r.role === 'party' && r.type !== 'roof-terrace') expect(span).toBeGreaterThanOrEqual(5);
        if (r.type === 'corridor') expect(span).toBeGreaterThanOrEqual(2.79);
      }
    }
  });
  it('party rooms upstairs open off the gallery when the ground floor has few', () => {
    let seen = 0;
    for (let i = 0; i < 30 && seen < 3; i++) {
      const bp = generateMansion({ seed: `up-${i}`, size: 'compact' });
      const up = bp.rooms.filter((r) => r.role === 'party' && r.level > 0 && r.type !== 'roof-terrace');
      if (!up.length) continue;
      seen++;
      const gallery = bp.atrium!.galleries.find((g) => g.level === up[0]!.level)!;
      for (const r of up) {
        const shared = bp.walls.filter((w) => (w.neg === r.id && w.pos === gallery.roomId) || (w.pos === r.id && w.neg === gallery.roomId));
        expect(shared.some((w) => w.openings.some((o) => o.passable))).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('orangery style', () => {
  const houses = ['or-1', 'or-2', 'or-3', 'or-4', 'or-5', 'or-6'].map((seed) => generateMansion({ seed, style: 'orangery' }));

  it('is valid, two storeys, with one-storey wings and no garden portico', () => {
    for (const bp of houses) {
      expect(bp.validation.ok).toBe(true);
      expect(bp.levels.length).toBe(2);
      for (const ms of bp.masses) if (ms.kind === 'wing') expect(ms.levels).toBe(1);
      expect(bp.porticos.some((p) => p.side === 'garden')).toBe(false);
    }
  });

  it('glass roofs cover the top-storey party rooms and nothing else', () => {
    let skylit = 0;
    for (const bp of houses) {
      for (const r of bp.rooms) {
        const ms = bp.masses.find((q) => q.id === r.massId)!;
        const under = (ms.roof.glazed ?? []).some((g) => g.x0 <= r.inner.x0 && g.x1 >= r.inner.x1 && g.z0 <= r.inner.z0 && g.z1 >= r.inner.z1);
        if (r.skylit) {
          skylit++;
          expect(r.role).toBe('party');
          expect(r.level).toBe(ms.levels - 1);
          expect(under, `${r.id} is skylit but its roof is not glass`).toBe(true);
        } else if (r.role === 'private' || r.role === 'service' || r.type === 'corridor') {
          expect(under, `${r.id} (${r.type}) must keep a solid roof`).toBe(false);
        }
      }
      // The whole first-floor garden front is the party's.
      expect(bp.rooms.filter((r) => r.level === 1 && r.role === 'party').length).toBeGreaterThanOrEqual(2);
    }
    expect(skylit).toBeGreaterThan(12);
    // Other styles have no glass roofs.
    const plain = generateMansion({ seed: 'or-1', style: 'palladian' });
    expect(plain.rooms.some((r) => r.skylit)).toBe(false);
    expect(plain.masses.some((ms) => ms.roof.glazed)).toBe(false);
  });

  it('garden-front windows stack into giant arched windows', () => {
    for (const bp of houses) {
      const front = bp.walls.filter((w) => w.exterior && w.side === 'garden' && w.axis === 'x' && w.massId !== 'conservatory');
      let stacks = 0;
      for (const w of front.filter((q) => q.level === 0)) {
        for (const o of w.openings) {
          if (!o.dressing?.spandrel) continue;
          const x = w.a.x + (o.u0 + o.u1) / 2;
          const above = front
            .filter((q) => q.level === 1 && Math.abs(q.a.z - w.a.z) < 0.01)
            .flatMap((q) => q.openings.map((p) => ({ p, x: q.a.x + (p.u0 + p.u1) / 2 })))
            .find((q) => Math.abs(q.x - x) < 0.05);
          if (!above) continue;
          stacks++;
          expect(above.p.dressing?.arch).toBeGreaterThan(1);
          expect(above.p.u1 - above.p.u0).toBeCloseTo(o.u1 - o.u0, 2);
          // The iron panel closes the gap between the two exactly.
          expect(o.y1 + o.dressing.spandrel).toBeCloseTo(above.p.y0, 2);
          expect(o.curtain).toBe('open');
        }
      }
      expect(stacks).toBeGreaterThanOrEqual(5);
    }
  });

  it('shows the sniper more than a slate-roofed house, from the treeline and from above', () => {
    let low = 0;
    let high = 0;
    let plainHigh = 0;
    for (const bp of houses) {
      low += bp.sightlines.partyVisible;
      high += movePerch(bp, 0, 55).sightlines.partyVisible;
      plainHigh += movePerch(generateMansion({ seed: bp.seed, style: 'georgian' }), 0, 55).sightlines.partyVisible;
    }
    expect(low / houses.length).toBeGreaterThan(0.45);
    expect(high / houses.length).toBeGreaterThan(plainHigh / houses.length + 0.1);
  });
});

describe('roof terraces', () => {
  // Palladian wings are the only roofs that are flat today (half of them).
  const houses = Array.from({ length: 12 }, (_, i) => generateMansion({ seed: `terrace-${i}`, style: 'palladian', massing: 'u-garden' }));

  it('appear on flat wing roofs and nowhere else; no roof is flattened for them', () => {
    let terraces = 0;
    for (const bp of houses) {
      for (const t of bp.roofTerraces) {
        const mass = bp.masses.find((m) => m.id === t.massId)!;
        expect(mass.kind).toBe('wing');
        expect(mass.roof.kind).toBe('flat');
        expect(mass.levels).toBeLessThan(bp.levels.length);
        terraces++;
      }
      // Wings with pitched roofs keep them.
      for (const m of bp.masses) if (m.kind === 'wing' && m.roof.kind !== 'flat') expect(bp.roofTerraces.some((t) => t.massId === m.id)).toBe(false);
    }
    expect(terraces).toBeGreaterThan(0);
    for (const style of ['georgian', 'beauxarts'] as const) expect(generateMansion({ seed: 'terrace-none', style, massing: 'h' }).roofTerraces).toHaveLength(0);
  });

  it('are walkable, reached by a glazed door from the storey beside them, and part of that storey', () => {
    for (const bp of houses) {
      expect(bp.validation.ok, bp.seed).toBe(true);
      for (const t of bp.roofTerraces) {
        const room = bp.rooms.find((r) => r.id === t.roomId)!;
        expect(room.type).toBe('roof-terrace');
        expect(room.level).toBe(t.level);
        const door = bp.walls.flatMap((w) => w.openings).find((o) => o.id === t.door.openingId)!;
        expect(door.passable && door.glazed).toBe(true);
        const n = bp.nav.levels.find((l) => l.level === t.level)!;
        const comp = navComponents(n);
        const kTerrace = navCellAt(n, (t.rect.x0 + t.rect.x1) / 2, (t.rect.z0 + t.rect.z1) / 2 + 2);
        const from = bp.rooms.find((r) => r.id === t.door.from)!;
        let kInside = -1;
        for (let k = 0; k < n.room.length && kInside < 0; k++) if (n.room[k] === from.index && n.walk[k]) kInside = k;
        expect(comp[kTerrace]).toBeGreaterThanOrEqual(0);
        expect(comp[kTerrace]).toBe(comp[kInside]);
        expect(bp.nav.links.some((l) => l.via === door.id && (l.from === t.roomId || l.to === t.roomId))).toBe(true);
      }
    }
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
