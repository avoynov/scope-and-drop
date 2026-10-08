/**
 * Mansion generator: seed in, validated blueprint out.
 *
 * Pipeline: style → massing grammar → room partitions → walls → stairs →
 * windows/doors → site/perch → first-pass sightlines → furnishing/POIs →
 * nav + final sightlines → validation. Invalid results are regenerated from a
 * derived seed (`seed#attempt`), so output stays deterministic.
 */
import { rect, type Rect, type Vec3 } from './core/geom';
import { Rng, snap } from './core/rng';
import { ROOM_LABELS, roomFinish, STYLE_IDS, STYLES } from './core/styles';
import { roofSurfaceY } from './core/roofs';
import type { Atrium, LevelSpec, LightSpec, MansionBlueprint, MansionOptions, Mass, NavLevel, NavLink, Poi, Prop, RoofTerrace, Room, Sightlines, Site, Stair, StyleDef } from './core/types';
import { collectOccluders } from './analysis/occluders';
import { buildNav, VIS_BLOCK } from './analysis/nav';
import { SightlineTracer } from './analysis/sightlines';
import { DEFAULT_REQUIRED_POIS, POI_VISIBLE, validate } from './analysis/validate';
import { furnish } from './interior/furnish';
import { planAtriumGeometry, type AtriumGeometry } from './layout/atrium';
import { planMassing, type MassingPlan } from './layout/massing';
import { collectLinks, placeTerraceDoors, placeWindows, planDoors, resetOpeningIds, type PlacedRoom } from './layout/openings';
import { planPorticos } from './layout/porticos';
import { isPassThrough, planRooms, ROLE, type RoomDraft } from './layout/rooms';
import { fitStairBetween } from './layout/stairs';
import { deriveWalls, innerRect } from './layout/walls';
import { perchEye } from './site/perch';
import { planSite } from './site/site';

export const SCHEMA = 'scope-and-drop/mansion@2' as const;
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
    partyVisibility: o.partyVisibility ?? [0.3, 0.8],
    maxAttempts: o.maxAttempts ?? 16,
    navCell: o.navCell ?? 0.25,
    hall: o.hall ?? 'gallery',
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
  if (r.type === 'hall-gallery') return 0.9;
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
  // The dome hall: void, ring galleries and the split stair, all inside the ball room's rectangle.
  let atrium: Atrium | null = null;
  let atriumGeo: AtriumGeometry | null = null;
  if (levels.length > 1) {
    const hall = at('ballroom', 0);
    const first = at('hall-gallery', 1);
    atriumGeo = hall && first ? planAtriumGeometry(hall.inner, opts.hall, levels[0]!.floorY, levels[1]!.floorY - levels[0]!.floorY) : null;
    if (hall && first && atriumGeo) {
      const geo = atriumGeo;
      for (const r of [...geo.blocked0, ...geo.columnBlocks]) block(hall.id, r);
      const galleries: Atrium['galleries'] = [];
      for (let L = 1; L < levels.length; L++) {
        const g = at('hall-gallery', L);
        if (!g) continue;
        const holes = L === 1 ? geo.holesFirst : geo.holesPlain;
        for (const r of [...holes, ...geo.columnBlocks]) block(g.id, r);
        g.floorHoles.push(...holes);
        galleries.push({ level: L, roomId: g.id, y: levels[L]!.floorY, outline: L === 1 ? geo.outlineWithLandings : geo.outlinePlain, rails: L === 1 ? geo.railsWithLandings : geo.railsPlain });
      }
      const xs = geo.arms.flatMap((a) => a.path.map((p) => p.x));
      const zs = geo.arms.flatMap((a) => a.path.map((p) => p.z));
      stairs.push({
        id: 'stair-grand',
        kind: 'grand',
        fromLevel: 0,
        toLevel: 1,
        bottomRoom: hall.id,
        topRoom: first.id,
        rect: rect(Math.min(...xs) - geo.stairWidth / 2, Math.min(...zs) - geo.stairWidth / 2, Math.max(...xs) + geo.stairWidth / 2, Math.max(...zs) + geo.stairWidth / 2),
        flights: [],
        landings: geo.landings.map((r) => ({ rect: r, y: levels[1]!.floorY })),
        arms: geo.arms,
      });
      // The drum carries the dome clear of whatever roof it stands in.
      const top = levels[levels.length - 1]!;
      const reach = geo.dome.radius + 0.6;
      let roofY = top.floorY + top.height;
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) roofY = Math.max(roofY, roofSurfaceY(masses, geo.dome.x + (i / 2) * reach, geo.dome.z + (j / 2) * reach));
      }
      atrium = {
        roomId: hall.id,
        shape: geo.shape,
        inner: geo.inner,
        galleryWidth: geo.galleryWidth,
        void: geo.void,
        footprint: geo.footprint,
        curvedWalls: geo.curvedWalls,
        galleries,
        columns: geo.columns,
        columnRadius: geo.columnRadius,
        stairId: 'stair-grand',
        dome: { ...geo.dome, baseY: top.ceilingY, springY: snap(roofY + 1.7, 0.01), height: snap(geo.dome.radius * 0.62, 0.01) },
      };
    } else missingStairs.push('grand');
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
  // Roof terraces: lower wings whose roof is already flat. (No roof is flattened for this.)
  const terraceSpecs = masses
    .filter((ms) => ms.kind === 'wing' && ms.roof.kind === 'flat' && ms.levels < levels.length)
    .map((ms) => ({ id: `${ms.levels}:T-${ms.id.replace('wing-', '')}`, rect: ms.rect, level: ms.levels, massId: ms.id }));
  const terraceDoors = placeTerraceDoors(octx, terraceSpecs);
  const doors = planDoors(octx);
  const roofTerraces: RoofTerrace[] = [];
  for (const t of terraceSpecs) {
    const door = terraceDoors.get(t.id);
    if (!door) continue;
    // Added after door planning: a terrace hangs off one outside door, it is not part of the room graph.
    placed.set(t.id, {
      id: t.id,
      type: 'roof-terrace',
      level: t.level,
      massId: t.massId,
      rect: t.rect,
      zone: 'wing',
      doubleHeight: false,
      floorHoles: [],
      inner: rect(t.rect.x0 + 0.4, t.rect.z0 + 0.4, t.rect.x1 - 0.4, t.rect.z1 - 0.4),
    });
    roofTerraces.push({ roomId: t.id, massId: t.massId, level: t.level, rect: t.rect, y: snap(levels[t.level]!.floorY, 0.01), door });
  }

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
  // The galleries are the upper part of the hall: same walls, same floor.
  const hallRoom = atrium ? rooms.find((r) => r.id === atrium!.roomId) : undefined;
  if (hallRoom) for (const r of rooms) if (r.type === 'hall-gallery') r.finish = { ...hallRoom.finish };
  disambiguateLabels(rooms);
  for (const ms of masses) {
    ms.exposed = [...new Set(walls.filter((w) => w.exterior && w.massId === ms.id && w.side).map((w) => w.side!))];
  }

  // Site + perch.
  const footprint = boundsOf([...masses.map((q) => q.rect), ...porticos.map((p) => p.rect)]);
  const siteOut = planSite({ rng: rng.fork('site'), m, style, porticos, footprint, perchDistance: opts.perchDistance, perchAzimuthDeg: opts.perchAzimuthDeg });
  const site = siteOut.site;

  // First-pass sightlines (architecture only) steer where the bar and mission props go.
  const tracer0 = new SightlineTracer(site.perch.eye, collectOccluders({ walls, rooms, levels, masses, porticos, props: [], site, atrium, stairs, withProps: false }));
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
    terraceDoors: new Map(roofTerraces.map((t) => [t.roomId, t.door])),
    atrium:
      atrium && atriumGeo
        ? {
            roomIds: [atrium.roomId, ...atrium.galleries.map((g) => g.roomId)],
            // Hung low enough to be seen through the upper windows, high enough to clear the dancers.
            dome: { x: atrium.dome.x, z: atrium.dome.z, y: snap(levels[1]!.floorY + 2.2, 0.01) },
            backX: atriumGeo.wallSpan.backX,
            sideZ: atriumGeo.wallSpan.sideZ,
          }
        : undefined,
  });
  const props: Prop[] = [...fur.props, ...siteOut.props];
  const lights: LightSpec[] = [...fur.lights, ...siteOut.lights, ...facadeLights(walls, levels, rooms)];
  // Lamps at the outer corners of each roof terrace (open air: exterior lights).
  roofTerraces.forEach((t, i) => {
    const far = (v0: number, v1: number, at: number) => (Math.abs(at - v0) > Math.abs(at - v1) ? v0 + 0.9 : v1 - 0.9);
    const z = far(t.rect.z0, t.rect.z1, t.door.z);
    const x = far(t.rect.x0, t.rect.x1, t.door.x);
    const spots = Math.abs(t.rect.z1 - t.rect.z0) >= Math.abs(t.rect.x1 - t.rect.x0) ? [[t.rect.x0 + 0.9, z], [t.rect.x1 - 0.9, z]] : [[x, t.rect.z0 + 0.9], [x, t.rect.z1 - 0.9]];
    spots.forEach(([lx, lz], k) => {
      props.push({ id: `pt${i}-${k}`, kind: 'lamppost', roomId: t.roomId, level: t.level, x: snap(lx!, 0.01), y: t.y, z: snap(lz!, 0.01), yaw: 0, w: 0.5, d: 0.5, h: 3.4, variant: 0, mount: 'floor', blocksNav: true, occludes: false });
      lights.push({ id: `lt${i}-${k}`, kind: 'lamppost', scope: 'exterior', x: snap(lx!, 0.01), y: snap(t.y + 3.25, 0.01), z: snap(lz!, 0.01), color: [1, 0.66, 0.36], intensity: 120, range: 14 });
    });
  });

  // Final sightlines + nav.
  const tracer = new SightlineTracer(site.perch.eye, collectOccluders({ walls, rooms, levels, masses, porticos, props, site, atrium, stairs, roofTerraces, withProps: true }));
  const navLevels = buildNav({ rooms, walls, levels, masses, props, porticos, site, blocked, cell: opts.navCell }, tracer);
  const links: NavLink[] = collectLinks(octx);
  for (const t of roofTerraces) {
    for (const l of links) {
      if (l.via !== t.door.openingId) continue;
      if (l.from !== t.door.from) l.from = t.roomId;
      else l.to = t.roomId;
    }
  }
  for (const s of stairs) {
    if (s.arms && atriumGeo) {
      // One link pair per arm: at the foot on the dance floor, and on the landing at the gallery.
      atriumGeo.foot.forEach((f, i) => {
        const l = atriumGeo!.landings[i]!;
        links.push({ kind: 'stair', from: s.bottomRoom, to: s.topRoom, via: s.id, x: f.x, z: f.z, level: s.fromLevel });
        links.push({ kind: 'stair', from: s.topRoom, to: s.bottomRoom, via: s.id, x: snap((l.x0 + l.x1) / 2, 0.01), z: snap((l.z0 + l.z1) / 2, 0.01), level: s.toLevel });
      });
      continue;
    }
    const f0 = s.flights[0]!;
    const f1 = s.flights[s.flights.length - 1]!;
    const end = stepAlong(f1.x, f1.z, f1.dir, f1.run + 0.3);
    links.push({ kind: 'stair', from: s.bottomRoom, to: s.topRoom, via: s.id, x: f0.x, z: f0.z, level: s.fromLevel });
    links.push({ kind: 'stair', from: s.topRoom, to: s.bottomRoom, via: s.id, x: end.x, z: end.z, level: s.toLevel });
  }

  const sight = summariseSightlines(navLevels, rooms, site.perch.eye);
  const pois: Poi[] = fur.pois.map((p) => {
    const room = p.roomId ? rooms.find((r) => r.id === p.roomId) : undefined;
    return { ...p, visibility: Math.round(tracer.person(p.stand.x, p.stand.z, room?.floorY ?? site.terrace.y) * 1000) / 1000 };
  });
  // What the sniper would see from other bearings on the arc (coarse), for the briefing.
  const occluders = collectOccluders({ walls, rooms, levels, masses, porticos, props, site, atrium, stairs, roofTerraces, withProps: true });
  const [arcLo, arcHi] = site.perch.arcDeg;
  for (let i = 0; i <= 8; i++) {
    const az = snap(arcLo + ((arcHi - arcLo) * i) / 8, 0.1);
    const eye = perchEye(site.terrain, m.zGarden, m.groundFloorY, az, site.perch.distance);
    site.perch.options.push({ azimuthDeg: az, partyVisible: coarsePartyVisible(new SightlineTracer(eye, occluders), rooms) });
  }

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
    atrium,
    roofTerraces,
    porticos,
    props,
    pois,
    lights,
    site,
    nav: { levels: navLevels, links },
    sightlines: sight,
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

/** Per-room, terrace and indoor-party visibility from the nav grids. */
function summariseSightlines(navLevels: NavLevel[], rooms: Room[], eye: Vec3): Sightlines {
  const roomVis: Record<string, number> = {};
  let partySum = 0;
  let partyN = 0;
  let terrSum = 0;
  let terrN = 0;
  let publicN = 0;
  let hiddenN = 0;
  const byIndex = new Map(rooms.map((r) => [r.index, r]));
  const sums = new Map<number, [number, number]>();
  for (const n of navLevels) {
    for (let k = 0; k < n.walk.length; k++) {
      if (!n.walk[k]) continue;
      const v = n.vis[k]! / 255;
      const ri = n.room[k]!;
      if (ri === -2) {
        // The terrace is in plain view by design; it is reported on its own so it cannot mask an opaque house.
        terrSum += v;
        terrN++;
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
        if (r.level === 0 && (r.role === 'party' || r.role === 'circulation')) {
          publicN++;
          if (v < 0.1) hiddenN++;
        }
      }
    }
  }
  for (const r of rooms) {
    const s = sums.get(r.index);
    roomVis[r.id] = s ? Math.round((s[0] / s[1]) * 1000) / 1000 : 0;
  }
  return {
    eye,
    rooms: roomVis,
    terrace: terrN ? Math.round((terrSum / terrN) * 1000) / 1000 : 0,
    partyVisible: partyN ? Math.round((partySum / partyN) * 1000) / 1000 : 0,
    hiddenShare: publicN ? Math.round((hiddenN / publicN) * 1000) / 1000 : 0,
  };
}

/** Indoor party visibility on a 1 m grid: cheap enough to sample several bearings. */
function coarsePartyVisible(tracer: SightlineTracer, rooms: Room[]): number {
  let sum = 0;
  let n = 0;
  for (const r of rooms) {
    if (r.level !== 0 || r.role !== 'party') continue;
    for (let x = r.inner.x0 + 0.5; x < r.inner.x1; x += 1) {
      for (let z = r.inner.z0 + 0.5; z < r.inner.z1; z += 1) {
        sum += tracer.person(x, z, r.floorY);
        n++;
      }
    }
  }
  return n ? Math.round((sum / n) * 1000) / 1000 : 0;
}

/**
 * Move the sniper to another bearing on the perch arc. The house, furniture and
 * mission objects are untouched; only what depends on the eye is recomputed
 * (visibility grids, per-room and party visibility, mission-object visibility).
 * Pure: returns a new blueprint.
 */
export function movePerch(bp: MansionBlueprint, azimuthDeg: number): MansionBlueprint {
  const [lo, hi] = bp.site.perch.arcDeg;
  const az = snap(Math.max(lo, Math.min(hi, azimuthDeg)), 0.1);
  const zGarden = bp.site.perch.target.z;
  const eye = perchEye(bp.site.terrain, zGarden, bp.groundFloorY, az, bp.site.perch.distance);
  const site: Site = { ...bp.site, perch: { ...bp.site.perch, eye, azimuthDeg: az } };
  const tracer = new SightlineTracer(eye, collectOccluders({ walls: bp.walls, rooms: bp.rooms, levels: bp.levels, masses: bp.masses, porticos: bp.porticos, props: bp.props, site, atrium: bp.atrium, stairs: bp.stairs, roofTerraces: bp.roofTerraces, withProps: true }));
  const levels = bp.nav.levels.map((n) => {
    const vis = new Uint8Array(n.vis.length);
    const cache = new Map<number, number>();
    for (let k = 0; k < n.walk.length; k++) {
      if (!n.walk[k]) continue;
      const c = k % n.cols;
      const r = (k - c) / n.cols;
      const ri = n.room[k]!;
      const floorY = ri === -2 ? site.terrace.y : ri >= 0 ? bp.rooms[ri]!.floorY : n.y;
      const bc = Math.floor(c / VIS_BLOCK);
      const br = Math.floor(r / VIS_BLOCK);
      const key = (br * 4096 + bc) * 2 + (floorY === n.y ? 0 : 1);
      let v = cache.get(key);
      if (v === undefined) {
        v = Math.round(tracer.person(n.originX + (bc + 0.5) * VIS_BLOCK * n.cell, n.originZ + (br + 0.5) * VIS_BLOCK * n.cell, floorY) * 255);
        cache.set(key, v);
      }
      vis[k] = v;
    }
    return { ...n, vis };
  });
  const pois = bp.pois.map((p) => {
    const room = p.roomId ? bp.rooms.find((r) => r.id === p.roomId) : undefined;
    return { ...p, visibility: Math.round(tracer.person(p.stand.x, p.stand.z, room?.floorY ?? site.terrace.y) * 1000) / 1000 };
  });
  return { ...bp, site, pois, nav: { ...bp.nav, levels }, sightlines: summariseSightlines(levels, bp.rooms, eye) };
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
