/**
 * Mansion generator: seed in, validated blueprint out.
 *
 * Pipeline: style → massing grammar → room partitions → walls → stairs →
 * windows/doors → site/perch → first-pass sightlines → furnishing/POIs →
 * nav + final sightlines → validation. Invalid results are regenerated from a
 * derived seed (`seed#attempt`), so output stays deterministic.
 */
import { rect, type Rect } from './core/geom';
import { Rng, snap } from './core/rng';
import { ROOM_LABELS, roomFinish, STYLE_IDS, STYLES } from './core/styles';
import type { LevelSpec, LightSpec, MansionBlueprint, MansionOptions, Mass, NavLink, Poi, Prop, Room, Stair, StyleDef } from './core/types';
import { collectOccluders } from './analysis/occluders';
import { buildNav } from './analysis/nav';
import { SightlineTracer } from './analysis/sightlines';
import { DEFAULT_REQUIRED_POIS, POI_VISIBLE, validate } from './analysis/validate';
import { furnish } from './interior/furnish';
import { planMassing, type MassingPlan } from './layout/massing';
import { collectLinks, placeWindows, planDoors, resetOpeningIds, type PlacedRoom } from './layout/openings';
import { planPorticos } from './layout/porticos';
import { isPassThrough, planRooms, ROLE, type RoomDraft } from './layout/rooms';
import { fitStairBetween } from './layout/stairs';
import { deriveWalls, innerRect } from './layout/walls';
import { planSite } from './site/site';

export const SCHEMA = 'scope-and-drop/mansion@1' as const;
const CONSERVATORY_HEIGHT = 4.3;

type Resolved = MansionBlueprint['options'];

export function resolveOptions(o: MansionOptions): Resolved {
  return {
    seed: String(o.seed),
    size: o.size ?? 'grand',
    style: o.style,
    massing: o.massing,
    perchDistance: o.perchDistance,
    perchAzimuthDeg: o.perchAzimuthDeg,
    requiredPois: { ...DEFAULT_REQUIRED_POIS, ...(o.requiredPois ?? {}) },
    partyVisibility: o.partyVisibility ?? [0.28, 0.85],
    maxAttempts: o.maxAttempts ?? 16,
    navCell: o.navCell ?? 0.25,
  };
}

export function generateMansion(options: MansionOptions): MansionBlueprint {
  const t0 = now();
  const opts = resolveOptions(options);
  let best: MansionBlueprint | null = null;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    const bp = generateOnce(opts, attempt);
    const errors = bp.validation.issues.filter((i) => i.severity === 'error').length;
    if (!best || errors < best.validation.issues.filter((i) => i.severity === 'error').length) best = bp;
    if (bp.validation.ok) break;
  }
  best!.stats.generationMs = Math.round(now() - t0);
  return best!;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function buildMasses(m: MassingPlan, style: StyleDef, rng: Rng): Mass[] {
  const top = m.levels[m.levels.length - 1]!;
  const eave = snap(top.floorY + top.height, 0.01);
  const pitch = snap(rng.range(style.roofPitchDeg[0], style.roofPitchDeg[1]), 0.5);
  const masses: Mass[] = [
    {
      id: 'main',
      kind: 'main',
      rect: rect(-m.W / 2, m.zEntrance, m.W / 2, m.zGarden),
      levels: m.mainLevels,
      roof: {
        kind: style.roof,
        eaveY: eave,
        pitchDeg: pitch,
        balustrade: style.balustradeParapet,
        dormers: style.roof === 'mansard' || (style.id === 'georgian' && rng.chance(0.7)) || rng.chance(0.25),
      },
      exposed: [],
    },
  ];
  if (m.gardenPavilion) {
    const half = (m.gardenPavilion.bays * m.bay) / 2;
    masses.push({
      id: 'pavilion-garden',
      kind: 'pavilion',
      rect: rect(-half, m.zGarden, half, snap(m.zGarden + m.gardenPavilion.depth, 0.01)),
      levels: m.mainLevels,
      roof: { kind: 'hipped', eaveY: eave, pitchDeg: 22.5, balustrade: false, pediment: 'garden', dormers: false },
      exposed: [],
    });
  }
  if (m.entrancePavilion) {
    const half = (m.entrancePavilion.bays * m.bay) / 2;
    masses.push({
      id: 'pavilion-entrance',
      kind: 'pavilion',
      rect: rect(-half, snap(m.zEntrance - m.entrancePavilion.depth, 0.01), half, m.zEntrance),
      levels: m.mainLevels,
      roof: { kind: 'hipped', eaveY: eave, pitchDeg: 22.5, balustrade: false, pediment: 'entrance', dormers: false },
      exposed: [],
    });
  }
  const wingRoof = style.roof === 'mansard' ? 'mansard' : style.balustradeParapet && rng.chance(0.5) ? 'flat' : 'hipped';
  for (const w of m.wings) {
    const wl = m.levels[w.levels - 1]!;
    masses.push({
      id: w.id,
      kind: 'wing',
      rect: w.rect,
      levels: w.levels,
      roof: {
        kind: wingRoof,
        eaveY: snap(wl.floorY + wl.height, 0.01),
        pitchDeg: pitch,
        balustrade: style.balustradeParapet || wingRoof === 'flat',
        dormers: false,
      },
      exposed: [],
    });
  }
  if (m.conservatory) {
    masses.push({
      id: 'conservatory',
      kind: 'conservatory',
      rect: m.conservatory.rect,
      levels: 1,
      roof: { kind: 'glass', eaveY: snap(m.groundFloorY + CONSERVATORY_HEIGHT, 0.01), pitchDeg: 30, balustrade: false, dormers: false },
      exposed: [],
    });
  }
  return masses;
}

function litFor(rng: Rng, r: RoomDraft): number {
  const role = ROLE[r.type];
  if (role === 'party') return 1;
  if (role === 'circulation') return r.level === 0 ? 0.9 : r.type === 'service-stair' ? 0.35 : 0.6;
  if (role === 'service') return rng.pick([0, 0.4, 0.6]);
  if (r.level >= 2) return rng.weighted([
    [0, 0.6],
    [0.4, 0.3],
    [0.8, 0.1],
  ]);
  if (r.level === 0) return 0.8;
  return rng.weighted([
    [0, 0.35],
    [0.35, 0.25],
    [0.7, 0.25],
    [1, 0.15],
  ]);
}

export function generateOnce(opts: Resolved, attempt: number): MansionBlueprint {
  const rng = new Rng(attempt === 0 ? opts.seed : `${opts.seed}#${attempt}`);
  const style = STYLES[opts.style ?? rng.fork('style').pick(STYLE_IDS)];
  const m = planMassing(rng.fork('massing'), style, opts.size, opts.massing);
  const levels: LevelSpec[] = m.levels;
  const porticos = planPorticos(m, style);
  const masses = buildMasses(m, style, rng.fork('roof'));

  const plan = planRooms(rng.fork('rooms'), m);
  const walls = deriveWalls(plan.rooms, levels, masses, CONSERVATORY_HEIGHT);
  const placed = new Map<string, PlacedRoom>();
  for (const d of plan.rooms) placed.set(d.id, { ...d, inner: innerRect(d, walls) });

  // Stairs.
  const stairs: Stair[] = [];
  const blocked = new Map<string, Rect[]>();
  const block = (id: string, r: Rect) => {
    let l = blocked.get(id);
    if (!l) blocked.set(id, (l = []));
    l.push(r);
  };
  const missingStairs: string[] = [];
  const at = (type: string, level: number) => [...placed.values()].find((r) => r.type === type && r.level === level);
  if (levels.length > 1) {
    const hall = at('stair-hall', 0);
    const landing = at('landing', 1);
    const entrance = at('entrance-hall', 0);
    if (hall && landing) {
      const prefer = entrance ? { x: (entrance.rect.x0 + entrance.rect.x1) / 2, z: (hall.rect.z0 + hall.rect.z1) / 2 } : { x: 0, z: 0 };
      const res = fitStairBetween('stair-grand', 'grand', hall, landing, levels[0]!, levels[1]!, prefer);
      if (res) {
        stairs.push(res.stair);
        block(hall.id, res.fit.footprint);
        block(landing.id, res.fit.hole);
        landing.floorHoles.push(res.fit.hole);
      } else missingStairs.push('grand');
    } else missingStairs.push('grand-rooms');
    for (let L = 0; L + 1 < levels.length; L++) {
      const lo = at('service-stair', L);
      const hi = at('service-stair', L + 1);
      if (!lo || !hi) {
        missingStairs.push(`service-${L}`);
        continue;
      }
      const res = fitStairBetween(`stair-service-${L}`, 'service', lo, hi, levels[L]!, levels[L + 1]!, { x: (lo.rect.x0 + lo.rect.x1) / 2, z: m.zFrontInner });
      if (res) {
        stairs.push(res.stair);
        block(lo.id, res.fit.footprint);
        block(hi.id, res.fit.hole);
        hi.floorHoles.push(res.fit.hole);
      } else missingStairs.push(`service-${L}`);
    }
  }

  // Openings.
  resetOpeningIds();
  const octx = { rng: rng.fork('openings'), m, style, levels, masses, rooms: placed, walls, blocked };
  placeWindows(octx);
  const doors = planDoors(octx);

  // Finalise rooms.
  const finishRng = rng.fork('finish');
  const drafts = [...placed.values()];
  const rooms: Room[] = drafts.map((d, index) => {
    const stage = walls.some(
      (w) =>
        (w.neg === d.id || w.pos === d.id) &&
        w.exterior &&
        w.level === d.level &&
        w.openings.some((o) => o.kind === 'french-window' || (o.glazed && w.side === 'garden')),
    );
    return {
      id: d.id,
      index,
      type: d.type,
      role: ROLE[d.type],
      label: ROOM_LABELS[d.type],
      level: d.level,
      massId: d.massId,
      rect: d.rect,
      inner: d.inner,
      floorY: levels[d.level]!.floorY,
      ceilingY: d.doubleHeight ? levels[d.level + 1]!.ceilingY : d.zone === 'conservatory' ? snap(m.groundFloorY + CONSERVATORY_HEIGHT - 0.1, 0.01) : levels[d.level]!.ceilingY,
      floorHoles: d.floorHoles,
      doubleHeight: d.doubleHeight,
      passThrough: isPassThrough(d.type),
      stage,
      lit: litFor(finishRng, d),
      finish: roomFinish(d.type, finishRng),
    };
  });
  disambiguateLabels(rooms);
  for (const ms of masses) {
    ms.exposed = [...new Set(walls.filter((w) => w.exterior && w.massId === ms.id && w.side).map((w) => w.side!))];
  }

  // Site + perch.
  const footprint = boundsOf([...masses.map((q) => q.rect), ...porticos.map((p) => p.rect)]);
  const siteOut = planSite({ rng: rng.fork('site'), m, style, porticos, footprint, perchDistance: opts.perchDistance, perchAzimuthDeg: opts.perchAzimuthDeg });
  const site = siteOut.site;

  // First-pass sightlines (architecture only) steer where the bar and mission props go.
  const tracer0 = new SightlineTracer(site.perch.eye, collectOccluders({ walls, rooms, levels, masses, porticos, props: [], site, withProps: false }));
  const visHint = new Map<string, number>();
  for (const r of rooms) {
    if (r.level > 1) continue;
    let sum = 0;
    let n = 0;
    for (let x = r.inner.x0 + 0.6; x < r.inner.x1 - 0.3; x += 1.2) {
      for (let z = r.inner.z0 + 0.6; z < r.inner.z1 - 0.3; z += 1.2) {
        sum += tracer0.person(x, z, r.floorY);
        n++;
      }
    }
    visHint.set(r.id, n ? sum / n : 0);
  }

  // Furnishing.
  const fur = furnish({
    rng: rng.fork('furnish'),
    rooms,
    walls,
    blocked,
    visHint,
    visAt: (x, z, y) => tracer0.person(x, z, y),
    required: opts.requiredPois,
    visibleAt: POI_VISIBLE + 0.1,
  });
  const props: Prop[] = [...fur.props, ...siteOut.props];
  const lights: LightSpec[] = [...fur.lights, ...siteOut.lights, ...facadeLights(walls, levels, rooms)];

  // Final sightlines + nav.
  const tracer = new SightlineTracer(site.perch.eye, collectOccluders({ walls, rooms, levels, masses, porticos, props, site, withProps: true }));
  const navLevels = buildNav({ rooms, walls, levels, masses, props, porticos, site, blocked, cell: opts.navCell }, tracer);
  const links: NavLink[] = collectLinks(octx);
  for (const s of stairs) {
    const f0 = s.flights[0]!;
    const f1 = s.flights[s.flights.length - 1]!;
    const end = stepAlong(f1.x, f1.z, f1.dir, f1.run + 0.3);
    links.push({ kind: 'stair', from: s.bottomRoom, to: s.topRoom, via: s.id, x: f0.x, z: f0.z, level: s.fromLevel });
    links.push({ kind: 'stair', from: s.topRoom, to: s.bottomRoom, via: s.id, x: end.x, z: end.z, level: s.toLevel });
  }

  const roomVis: Record<string, number> = {};
  let partySum = 0;
  let partyN = 0;
  let terrSum = 0;
  let terrN = 0;
  const byIndex = new Map(rooms.map((r) => [r.index, r]));
  const sums = new Map<number, [number, number]>();
  for (const n of navLevels) {
    for (let k = 0; k < n.walk.length; k++) {
      if (!n.walk[k]) continue;
      const v = n.vis[k]! / 255;
      const ri = n.room[k]!;
      if (ri === -2) {
        terrSum += v;
        terrN++;
        partySum += v;
        partyN++;
      } else if (ri >= 0) {
        const s = sums.get(ri) ?? [0, 0];
        s[0] += v;
        s[1]++;
        sums.set(ri, s);
        const r = byIndex.get(ri)!;
        if (r.role === 'party' && r.level === 0) {
          partySum += v;
          partyN++;
        }
      }
    }
  }
  for (const r of rooms) {
    const s = sums.get(r.index);
    roomVis[r.id] = s ? Math.round((s[0] / s[1]) * 1000) / 1000 : 0;
  }
  const pois: Poi[] = fur.pois.map((p) => {
    const room = p.roomId ? rooms.find((r) => r.id === p.roomId) : undefined;
    return { ...p, visibility: Math.round(tracer.person(p.stand.x, p.stand.z, room?.floorY ?? site.terrace.y) * 1000) / 1000 };
  });

  const partial = {
    schema: SCHEMA,
    seed: opts.seed,
    attempt,
    options: opts,
    style,
    massing: m.type,
    bay: m.bay,
    bays: m.bays,
    levels,
    groundFloorY: m.groundFloorY,
    masses,
    rooms,
    walls,
    stairs,
    porticos,
    props,
    pois,
    lights,
    site,
    nav: { levels: navLevels, links },
    sightlines: {
      eye: site.perch.eye,
      rooms: roomVis,
      terrace: terrN ? Math.round((terrSum / terrN) * 1000) / 1000 : 0,
      partyVisible: partyN ? Math.round((partySum / partyN) * 1000) / 1000 : 0,
    },
  };
  const validation = validate(partial, { unreachable: doors.unreachable, passViolations: doors.passViolations, missingStairs });
  if (doors.retyped.length) validation.metrics.retypedRooms = doors.retyped.length;
  return {
    ...partial,
    validation,
    stats: {
      rooms: rooms.length,
      partyRooms: rooms.filter((r) => r.role === 'party').length,
      partyArea: validation.metrics.partyArea ?? 0,
      walls: walls.length,
      openings: walls.reduce((a, w) => a + w.openings.length, 0),
      props: props.length,
      lights: lights.length,
      footprint,
      generationMs: 0,
    },
  };
}

function stepAlong(x: number, z: number, dir: '+x' | '-x' | '+z' | '-z', d: number): { x: number; z: number } {
  switch (dir) {
    case '+x':
      return { x: x + d, z };
    case '-x':
      return { x: x - d, z };
    case '+z':
      return { x, z: z + d };
    case '-z':
      return { x, z: z - d };
  }
}

function boundsOf(rs: Rect[]): Rect {
  return {
    x0: Math.min(...rs.map((r) => r.x0)),
    z0: Math.min(...rs.map((r) => r.z0)),
    x1: Math.max(...rs.map((r) => r.x1)),
    z1: Math.max(...rs.map((r) => r.z1)),
  };
}

/** "West Drawing Room" / "East Drawing Room" when a type repeats on a floor. */
function disambiguateLabels(rooms: Room[]): void {
  const groups = new Map<string, Room[]>();
  for (const r of rooms) {
    const k = `${r.level}:${r.type}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(r);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    for (const r of g) {
      const cx = (r.rect.x0 + r.rect.x1) / 2;
      const cz = (r.rect.z0 + r.rect.z1) / 2;
      const ew = cx < -1 ? 'West' : cx > 1 ? 'East' : '';
      const ns = g.some((q) => q !== r && Math.abs((q.rect.x0 + q.rect.x1) / 2 - cx) < 1) ? (cz > 0 ? 'Garden' : 'North') : '';
      r.label = [ns, ew, ROOM_LABELS[r.type]].filter(Boolean).join(' ');
    }
    // Still clashing (e.g. two west bedrooms): number them.
    const seen = new Map<string, number>();
    for (const r of g) {
      const n = (seen.get(r.label) ?? 0) + 1;
      seen.set(r.label, n);
      if (n > 1) r.label = `${r.label} ${n}`;
    }
  }
}

/** Lanterns flanking the entrance and garden doors, and warm spill from lit windows. */
function facadeLights(walls: MansionBlueprint['walls'], levels: LevelSpec[], rooms: Room[]): LightSpec[] {
  const out: LightSpec[] = [];
  let n = 0;
  const y = levels[0]!.floorY + 2.7;
  const byId = new Map(rooms.map((r) => [r.id, r]));
  for (const w of walls) {
    if (!w.exterior || w.level !== 0) continue;
    const room = byId.get((w.neg ?? w.pos)!);
    if (!room) continue;
    const sgn = w.neg ? 1 : -1;
    const nx = w.axis === 'z' ? sgn : 0;
    const nz = w.axis === 'x' ? sgn : 0;
    const face = (w.axis === 'x' ? w.a.z : w.a.x) + sgn * (w.thickness / 2);
    const base = w.axis === 'x' ? w.a.x : w.a.z;
    // Spill: a downward-outward spot just outside each lit window paints the paving, not the wall.
    if (room.lit >= 0.5) {
      for (const o of w.openings) {
        if (!o.glazed || o.frosted || o.curtain === 'drawn') continue;
        const t = base + (o.u0 + o.u1) / 2;
        const out1 = face + sgn * 0.35;
        const k = o.kind === 'french-window' ? 1.0 : 0.6;
        const d = [nx * 0.62, -0.78, nz * 0.62] as [number, number, number];
        out.push({
          id: `lw${n++}`,
          kind: 'spill',
          scope: 'exterior',
          x: w.axis === 'x' ? t : out1,
          y: o.y0 + Math.min(2.4, (o.y1 - o.y0) * 0.7),
          z: w.axis === 'x' ? out1 : t,
          color: [1, 0.56, 0.26],
          intensity: 70 * room.lit * k * (o.curtain === 'sheer' ? 0.5 : 1),
          range: 9,
          dir: d,
          cone: 0.35,
        });
      }
    }
    if ((w.side !== 'garden' && w.side !== 'entrance') || (room.type !== 'ballroom' && room.type !== 'entrance-hall')) continue;
    const off = w.side === 'garden' ? 0.45 : -0.45;
    const main = w.openings.filter((o) => o.passable && Math.abs(w.a.x + (o.u0 + o.u1) / 2) < 2.5);
    for (const o of main) {
      for (const u of [o.u0 - 0.55, o.u1 + 0.55]) {
        out.push({ id: `lf${n++}`, kind: 'lantern', scope: 'exterior', x: w.a.x + u, y, z: w.a.z + off * 1.4, color: [1, 0.6, 0.3], intensity: 35, range: 9, dir: [0, -0.8, Math.sign(off) * 0.6], cone: 0.15 });
      }
    }
  }
  return out;
}
