/**
 * Milestone 2, part 2 (Minds that notice): sight, hearing, memory and gossip, the mental map,
 * mood, recognising people, and evenings that show all of it at work.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generateMansion } from '../src/mansion';
import type { MansionBlueprint } from '../src/mansion/core/types';
import { Rng } from '../src/mansion/core/rng';
import { COMPARE, DOUBLE_TAKE, TEST } from '../src/party/ident';
import { Memory, KNOWN, PASS_MIN, SLOTS, SUSPICIOUS } from '../src/party/memory';
import { Mood } from '../src/party/mood';
import { Pathfinder } from '../src/party/path';
import { RoomCells } from '../src/party/places';
import { SOUNDS, type Sound } from '../src/party/senses';
import { SEE_CURTAIN, SEE_OPEN, SEE_SCREEN, Sight } from '../src/party/sight';
import { Party } from '../src/party/sim';
import type { Person } from '../src/party/types';
import { World } from '../src/party/world';

const bp = generateMansion({ seed: 'gala-night' });
const guestsOf = (party: Party): Person[] => party.people.filter((p) => !p.staff && p.role !== 'host');
const HOUSES = ['gala-night', 'match-42', 'orangery-1'] as const;
/** Evenings for the statistical checks: enough houses that one odd layout doesn't decide them. */
const EVENINGS = [...HOUSES, 'ridge-7', 'palazzo-3'] as const;
const blueprint = (seed: string): MansionBlueprint => (seed === 'gala-night' ? bp : generateMansion({ seed }));

function sightOf(seed: string): { bp: MansionBlueprint; pf: Pathfinder; world: World; sight: Sight; cells: RoomCells } {
  const b = blueprint(seed);
  const pf = new Pathfinder(b);
  const world = new World(b, pf, new Rng(`world/${seed}`));
  pf.setGate(world);
  return { bp: b, pf, world, sight: new Sight(b, pf, world), cells: new RoomCells(pf) };
}

/** Two open points either side of a cell, 0.8 m out along x or z, or null. */
function across(sight: Sight, level: number, x: number, z: number, axis?: 'x' | 'z'): [number, number, number, number] | null {
  for (const ax of axis ? [axis] : (['x', 'z'] as const)) {
    const dx = ax === 'x' ? 0.8 : 0;
    const dz = ax === 'z' ? 0.8 : 0;
    if (sight.kindAt(level, x - dx, z - dz) === SEE_OPEN && sight.kindAt(level, x + dx, z + dz) === SEE_OPEN) return [x - dx, z - dz, x + dx, z + dz];
  }
  return null;
}

/** Centres of every cell of a kind on a storey. */
function cellsOf(f: ReturnType<typeof sightOf>, level: number, kind: number): Array<[number, number]> {
  const n = f.pf.levels.get(level)!;
  const out: Array<[number, number]> = [];
  for (let k = 0; k < n.cols * n.rows; k++) {
    const x = n.originX + ((k % n.cols) + 0.5) * n.cell;
    const z = n.originZ + (Math.floor(k / n.cols) + 0.5) * n.cell;
    if (f.sight.kindAt(level, x, z) === kind) out.push([x, z]);
  }
  return out;
}

describe('sight', () => {
  const houses = HOUSES.map(sightOf);

  it('never sees through a wall between rooms that are not joined', () => {
    for (const f of houses) {
      const rng = new Rng(`walls/${f.bp.seed}`);
      const rooms = f.bp.rooms.filter((r) => f.cells.count(r.index) > 20);
      let tried = 0;
      for (let i = 0; i < 3000; i++) {
        const r = rng.pick(rooms);
        const q = rng.pick(rooms.filter((o) => o.level === r.level && o !== r));
        if (!q || f.sight.seeRooms(r.index, q.index)) continue;
        const a = f.cells.random(r.index, rng, 0.3);
        const b = f.cells.random(q.index, rng, 0.3);
        if (!a || !b) continue;
        // Only lines through these two rooms and the wall between: none out of a window and back in.
        const seq = new Set<number>();
        let outside = false;
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n;
          const z = a.z + ((b.z - a.z) * k) / n;
          const room = f.pf.roomAt(a.level, x, z);
          const kind = f.sight.kindAt(a.level, x, z);
          if (kind === SEE_CURTAIN || (room === -1 && kind === SEE_OPEN)) outside = true;
          seq.add(room);
        }
        seq.delete(-1);
        if (outside || seq.size > 2) continue;
        tried++;
        expect(f.sight.clear(a.level, a.x, a.z, b.x, b.z), `${f.bp.seed} ${r.type} -> ${q.type}`).toBe(false);
      }
      expect(tried).toBeGreaterThan(100);
    }
  });

  it('is blocked by frosted glass', () => {
    let checked = 0;
    for (const f of houses) {
      for (const level of f.pf.levels.keys()) {
        for (const [x, z] of cellsOf(f, level, SEE_SCREEN)) {
          // From inside the room, out through the pane to just beyond it.
          for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const ax = x - ux * 0.8;
            const az = z - uz * 0.8;
            if (f.sight.kindAt(level, ax, az) !== SEE_OPEN || f.pf.roomAt(level, ax, az) < 0) continue;
            const bx = x + ux * 0.3;
            const bz = z + uz * 0.3;
            if (f.sight.kindAt(level, bx, bz) === SEE_SCREEN) continue;
            checked++;
            expect(f.sight.clear(level, ax, az, bx, bz)).toBe(false);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('passes a window while its curtain is open, not once it is drawn', () => {
    let checked = 0;
    for (const f of houses) {
      for (const c of f.world.curtains.filter((c) => c.movable && c.level === 0)) {
        const cell = cellsOf(f, 0, SEE_CURTAIN).find(([x, z]) => Math.hypot(x - c.x, z - c.z) < 0.2);
        const ends = cell && across(f.sight, 0, cell[0], cell[1]);
        if (!ends) continue;
        f.world.setCurtain(c, 'open');
        const open = f.sight.clear(0, ...ends);
        f.world.setCurtain(c, 'drawn');
        const drawn = f.sight.clear(0, ...ends);
        if (!open) continue;
        checked++;
        expect(drawn).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('sees through a doorway while its door stands open, not once it swings past half shut', () => {
    let checked = 0;
    for (const f of houses) {
      for (const d of f.world.doors) {
        const ends = across(f.sight, d.level, d.x, d.z, d.axis === 'x' ? 'z' : 'x');
        if (!ends) continue;
        d.open = 1;
        if (!f.sight.clear(d.level, ...ends)) continue;
        checked++;
        d.open = 0.4;
        expect(f.sight.clear(d.level, ...ends)).toBe(false);
        d.open = 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('makes people out less far in a room whose lights are off', () => {
    const party = new Party(bp, { seed: 'sight' });
    const room = party.places.toastRoom.index;
    const lit = party.senses.range(room);
    party.world.setLight(room, false);
    expect(party.senses.range(room)).toBeLessThan(lit - 3);
    expect(party.senses.range(room)).toBeGreaterThanOrEqual(4);
  });
});

describe('hearing', () => {
  const party = new Party(bp, { seed: 'hearing' });
  const s = party.senses;
  const at = (kind: Sound['kind'], level: number, x: number, z: number, room: number): Sound => ({ kind, level, x, z, room, source: -1, ref: -1 });
  const listener = party.people.find((p) => p.staff)!;
  const put = (p: Person, level: number, x: number, z: number) => {
    p.level = level;
    p.x = x;
    p.z = z;
    p.room = party.pf.roomAt(level, x, z);
    p.present = true;
  };

  it('loses 6 dB through an open door and 20 through a shut one', () => {
    let checked = 0;
    for (const d of party.world.doors) {
      const [a, b] = d.rooms;
      if (a < 0 || b < 0) continue;
      const snd = at('laugh', d.level, d.x, d.z, a);
      d.open = 1;
      const open = s.levels(snd).level[b]!;
      d.open = 0;
      const shut = s.levels(snd).level[b]!;
      d.open = 1;
      // The door itself is the loudest way when the sound is made in the doorway.
      expect(open).toBeCloseTo(SOUNDS.laugh.db - 6, 5);
      expect(shut).toBeLessThanOrEqual(open);
      if (shut === SOUNDS.laugh.db - 20) checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('is masked by a noisy room', () => {
    const r = party.places.toastRoom;
    const c = party.cells.random(r.index, party.rng, 1)!;
    put(listener, c.level, c.x, c.z);
    const snd = at('laugh', c.level, c.x + 3, c.z, r.index);
    s.noise[r.index] = 45;
    expect(s.hears(snd, listener)).toBe(true);
    s.noise[r.index] = 70;
    expect(s.hears(snd, listener)).toBe(false);
    s.noise[r.index] = 45;
  });

  it('carries a knock on a bathroom door down the corridor, never through the shut door', () => {
    let checked = 0;
    for (const b of party.places.bathrooms) {
      if (b.doorId < 0) continue;
      const d = party.world.doors[b.doorId]!;
      const knock = at('knock', b.door.level, b.door.x, b.door.z, b.door.room);
      put(listener, b.inside.level, b.inside.x, b.inside.z);
      d.open = 0;
      expect(s.hears(knock, listener)).toBe(false);
      const near = party.pf.snap(b.door.level, b.door.x + Math.sin(b.door.yaw + Math.PI) * 2, b.door.z + Math.cos(b.door.yaw + Math.PI) * 2, 1);
      if (near && party.pf.roomAt(near.level, near.x, near.z) === b.door.room) {
        put(listener, near.level, near.x, near.z);
        if (s.noise[b.door.room < 0 ? party.sight.R - 1 : b.door.room]! <= 45) expect(s.hears(knock, listener)).toBe(true);
        checked++;
      }
      d.open = 0.3;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('carries a scream across the storey, further than a laugh', () => {
    const r = party.places.toastRoom;
    const c = party.cells.random(r.index, party.rng, 1)!;
    const level = (kind: Sound['kind']) => s.levels(at(kind, c.level, c.x, c.z, r.index)).level;
    const rooms = party.bp.rooms.filter((q) => q.level === c.level);
    const heard = (lv: Float32Array) => rooms.filter((q) => lv[q.index]! >= 45 + 6).length;
    const scream = heard(level('scream'));
    expect(scream).toBeGreaterThan(rooms.length / 2);
    expect(scream).toBeGreaterThan(heard(level('laugh')));
  });
});

describe('memory', () => {
  const party = new Party(bp, { seed: 'memory' });
  const m = party.memory;
  const [a, b, c, d] = guestsOf(party).filter((p) => p.partner === null);
  const stranger = guestsOf(party).find((p) => ![a, b, c, d].includes(p) && !a!.friends.includes(p.id) && !b!.friends.includes(p.id))!;

  it('fades confidence over each fact’s half-life', () => {
    party.t = 1000;
    const f = m.plant(a!.id, 'flirting', stranger.id);
    expect(m.confidence(a!.id, f)).toBeCloseTo(1, 5);
    party.t = 1000 + 90 * 60;
    expect(m.confidence(a!.id, f)).toBeCloseTo(0.5, 3);
  });

  it('passes a fact on at 0.8 of the teller’s confidence, and nothing below 0.2', () => {
    party.t = 2000;
    const f = m.plant(b!.id, 'spill', stranger.id);
    expect(m.tell(c!.id, f, b!.id)).toBe(true);
    expect(m.confidence(c!.id, f)).toBeCloseTo(0.8, 5);
    expect(m.tell(c!.id, f, b!.id)).toBe(false);
    // An hour on, then nine more: below the floor, so nobody hears it from them.
    party.t = 2000 + 10 * 3600;
    expect(m.confidence(b!.id, f)).toBeLessThan(PASS_MIN);
    expect(m.onTurn([b!.id, d!.id], b!.id, [])).toBeNull();
  });

  it('drops the weakest fact when a memory is full', () => {
    party.t = 50_000;
    const who = d!.id;
    const weak = m.fact('was-in', stranger.id, -1, 1, 0.01);
    m.learn(who, weak, 0.3, -1, 0);
    for (let i = 0; i < SLOTS + 4; i++) m.learn(who, m.fact('tipsy', i % party.people.length, -1, i), 1, -1, 0);
    expect(m.held[who]).toBe(SLOTS);
    expect(m.knows(who, weak)).toBe(false);
  });

  it('raises suspicion for an odd fact, less about a friend', () => {
    const p = guestsOf(party).find((q) => q.friends.length > 0)!;
    const friend = p.friends[0]!;
    const other = guestsOf(party).find((q) => q !== p && !p.friends.includes(q.id) && q.id !== p.partner)!;
    m.plant(p.id, 'left-bedroom', friend);
    m.plant(p.id, 'left-bedroom', other.id);
    expect(m.suspects(p.id, other.id)).toBeGreaterThan(m.suspects(p.id, friend));
  });
});

describe('the mental map', () => {
  const party = new Party(bp, { seed: 'map' });
  const m = party.memory;
  const g = guestsOf(party).find((p) => !p.regular)!;
  const h = guestsOf(party).find((p) => p !== g && !p.regular)!;
  const room = party.bp.rooms.find((r) => m.familiarity(g.id, r.index) === 0 && m.familiarity(h.id, r.index) === 0)!.index;

  it('learns a room by walking into it, less when tipsy', () => {
    party.t = 100;
    m.walkInto(g.id, room);
    expect(m.familiarity(g.id, room)).toBeCloseTo(0.5, 5);
    h.tipsy = 1;
    m.walkInto(h.id, room);
    expect(m.familiarity(h.id, room)).toBeCloseTo(0.25, 5);
    h.tipsy = 0;
  });

  it('forgets toward a floor set by visits, faster when tipsy', () => {
    const k0 = m.familiarity(g.id, room);
    party.t = 100 + 45 * 60;
    const floor = 0.45;
    expect(m.familiarity(g.id, room)).toBeCloseTo(floor + (k0 - floor) / 2, 4);
    g.tipsy = 1;
    expect(m.familiarity(g.id, room)).toBeCloseTo(floor + (k0 - floor) / 4, 4);
    g.tipsy = 0;
  });

  it('never lets the host forget', () => {
    party.t = 3 * 3600;
    for (const r of party.bp.rooms) expect(m.familiarity(party.host.id, r.index)).toBe(1);
  });

  it('starts guests on the hall and the rooms off it, regulars on the party rooms too', () => {
    const fresh = new Party(bp, { seed: 'map' });
    const hall = fresh.places.entranceRoom!.index;
    for (const p of guestsOf(fresh)) {
      expect(fresh.memory.familiarity(p.id, hall)).toBeGreaterThanOrEqual(0.6 - 1e-6);
      if (p.regular) expect(fresh.memory.familiarity(p.id, fresh.places.toastRoom.index)).toBeGreaterThanOrEqual(0.8 - 1e-6);
    }
    expect(guestsOf(fresh).filter((p) => p.regular).length).toBeGreaterThan(2);
  });

  it('turns wrong at (0.5 − k)(1 + tipsy), never once sure', () => {
    expect(Memory.wrongTurnChance(0.3, 0)).toBeCloseTo(0.2, 9);
    expect(Memory.wrongTurnChance(0.3, 1)).toBeCloseTo(0.4, 9);
    expect(Memory.wrongTurnChance(0.5, 1)).toBe(0);
    expect(Memory.wrongTurnChance(0.9, 0)).toBe(0);
    expect(KNOWN).toBeLessThan(0.5);
  });
});

describe('mood', () => {
  const party = new Party(bp, { seed: 'mood' });
  const [a, b] = guestsOf(party);

  it('pulls energy both ways and tension one way between people close together', () => {
    a!.present = b!.present = true;
    const idle = { dancing: false, music: false, talking: false, alone: false, crowd: 1 };
    const pairs = Int16Array.from([a!.id, b!.id]);
    const run = (contact: boolean) => {
      const mood = new Mood(party.people);
      mood.energy[a!.id] = 0.9;
      mood.energy[b!.id] = 0.1;
      mood.tension[a!.id] = 0.8;
      for (let i = 0; i < 60; i++) mood.step(1, () => idle, pairs, Float32Array.from([0.8]), contact ? 1 : 0);
      return mood;
    };
    const near = run(true);
    const apart = run(false);
    expect(near.energy[a!.id]).toBeLessThan(apart.energy[a!.id]! - 0.05);
    expect(near.energy[b!.id]).toBeGreaterThan(apart.energy[b!.id]! + 0.05);
    expect(near.tension[b!.id]).toBeGreaterThan(0.01);
    expect(apart.tension[b!.id]).toBe(0);
    // The calm one never makes the tense one calmer: it only fades.
    expect(near.tension[a!.id]).toBeCloseTo(apart.tension[a!.id]!, 6);
  });

  it('labels a room from the people in it', () => {
    const mood = new Mood(party.people);
    for (const p of party.people) p.present = false;
    a!.present = true;
    a!.room = 3;
    mood.tension[a!.id] = 0.5;
    expect(mood.room(3)?.label).toBe('tense');
    mood.tension[a!.id] = 0;
    mood.energy[a!.id] = 0.6;
    expect(mood.room(3)?.label).toBe('festive');
    expect(mood.room(4)).toBeNull();
  });
});

describe('recognising people', () => {
  const party = new Party(bp, { seed: 'ident' });
  const id = party.ident;
  const n = party.people.length;
  const pair = (() => {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && id.tieOf(i, j) >= 3 && !party.people[j]!.staff) return [i, j] as const;
    throw new Error('no friends');
  })();

  it('never doubts a sober friend', () => {
    const [i, j] = pair;
    for (let t = 0; t < 3600; t += 2) expect(id.check(i, j, t, 2, 1, true, 1, 0, false)).toBeNull();
    expect(id.doubtOf(i, j, 3600)).toBeLessThan(DOUBLE_TAKE);
  });

  it('looks twice at a friend gone unsteady without seeing them drink, and settles it with a test', () => {
    const [i, j] = pair;
    party.people[j]!.tipsy = 0.95;
    id.refresh(party.people[j]!);
    const seen: string[] = [];
    let t = 4000;
    for (; t < 4000 + 3600 && !seen.includes('want-test'); t += 2) {
      const e = id.check(i, j, t, 2, 3, false, 1, 0, false);
      if (e) seen.push(e);
    }
    expect(seen[0]).toBe('double-take');
    expect(seen).toContain('want-test');
    expect(id.doubtOf(i, j, t)).toBeLessThan(COMPARE);
    expect(id.test(i, j, t)).toBe(true);
    expect(id.doubtOf(i, j, t)).toBeLessThan(TEST / 2);
    // Passed: the new look is the one remembered, so the same sight raises no more doubt.
    for (let k = 0; k < 1800; k++) id.check(i, j, t + 2 * k, 2, 3, false, 1, 0, false);
    expect(id.doubtOf(i, j, t + 3600)).toBeLessThan(DOUBLE_TAKE);
  });

  it('minds a change it can explain far less', () => {
    const doubt = (explained: boolean) => {
      const p = new Party(bp, { seed: 'ident' });
      const [i, j] = pair;
      p.people[j]!.tipsy = 0.95;
      p.ident.refresh(p.people[j]!);
      for (let t = 0; t < 60; t += 2) p.ident.check(i, j, t, 2, 3, false, 1, 0, explained);
      return p.ident.doubtOf(i, j, 60);
    };
    expect(doubt(true)).toBeLessThan(doubt(false) * 0.25);
  });
});

describe('a conversation that goes quiet', () => {
  it('hushes when someone the members are wary of joins, and only then', () => {
    const party = new Party(bp, { seed: 'hush' });
    // Someone on their way to join a conversation already going.
    let x: Person | undefined;
    let members: number[] = [];
    while (!x && party.t < 60 * 60) {
      party.advance(5);
      for (const p of guestsOf(party)) {
        const a = p.action;
        if (a?.id !== 'mingle' || a.startedAt !== null || a.ref === undefined) continue;
        const here = (party.groups.get(a.ref)?.members ?? []).filter((m) => m !== p.id && party.people[m]!.action?.startedAt != null);
        if (here.filter((m) => !p.friends.includes(m) && p.partner !== m).length >= 1) {
          x = p;
          members = here;
          break;
        }
      }
    }
    expect(x).toBeDefined();
    // Everyone there has heard something odd about them.
    for (const m of members) party.memory.plant(m, 'rumour', x!.id, 0.9);
    expect(members.some((m) => party.memory.suspects(m, x!.id) >= SUSPICIOUS)).toBe(true);
    const before = party.events.filter((e) => e.kind === 'hush').length;
    expect(before).toBe(0);
    const going = x!.action;
    for (let i = 0; i < 600 && x!.action === going && going?.startedAt === null; i++) party.advance(1);
    expect(x!.action).toBe(going);
    const hush = party.events.filter((e) => e.kind === 'hush');
    expect(hush.length).toBe(1);
    expect(hush[0]!.actors[0]).toBe(x!.id);
    expect(party.stats.hushes).toBe(1);
    const g = party.groups.get(x!.action!.ref!)!;
    expect(g.speaker).toBe(-1);
    expect(g.quietUntil).toBeGreaterThan(party.t);
  }, 60_000);
});

describe('evenings that notice', () => {
  interface Run {
    party: Party;
    rumour: { at: number; subject: number; reach: Array<[number, number]> };
    suspicious: number;
    doubtedAfterTest: number;
  }
  const runs: Run[] = [];

  beforeAll(() => {
    for (const seed of EVENINGS) {
      const b = blueprint(seed);
      const probe = new Party(b, { seed });
      // A juicy rumour about a guest, planted with someone in conversation a few minutes into the second mingling.
      const mingle = probe.programme.filter((p) => p.id === 'mingle')[1]!;
      const at = mingle.start + 3 * 60;
      const subject = guestsOf(probe)[5]!.id;
      const party = new Party(b, { seed, provoke: [{ t: at, subject }] });
      const run: Run = { party, rumour: { at, subject, reach: [] }, suspicious: 0, doubtedAfterTest: 0 };
      const n = party.people.length;
      let fact = -1;
      while (!party.over) {
        party.advance(30);
        const m = party.memory;
        if (fact < 0 && party.t > at) for (let f = 0; f < m.count; f++) if (m.verbOf(f) === 'rumour') fact = f;
        if (fact >= 0 && party.t <= at + 60 * 60) {
          const here = party.people.filter((p) => p.present && !p.staff && p.id !== subject);
          run.rumour.reach.push([party.t - at, m.reach(fact, here) / here.length]);
        }
        // Suspicion of anyone but the rumour's subject, and doubt after a passed test.
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (j !== subject && m.suspicion[i * n + j]! >= SUSPICIOUS) run.suspicious++;
            if (party.ident.stage[i * n + j] === 2 && party.ident.doubtOf(i, j, party.t) >= TEST) run.doubtedAfterTest++;
          }
        }
      }
      runs.push(run);
    }
  }, 300_000);

  it('spreads a juicy rumour to half the party in about 15–30 minutes', () => {
    const halves: number[] = [];
    for (const r of runs) {
      const at45 = r.rumour.reach.find(([dt]) => dt >= 45 * 60)![1];
      expect(at45, r.party.bp.seed).toBeGreaterThanOrEqual(0.3);
      halves.push(r.rumour.reach.find(([, s]) => s >= 0.5)?.[0] ?? Infinity);
    }
    const mean = halves.reduce((a, b) => a + b, 0) / halves.length;
    expect(mean).toBeGreaterThanOrEqual(10 * 60);
    expect(mean).toBeLessThanOrEqual(35 * 60);
  });

  it('takes fewer wrong turns as the house is learnt, and the host never one', () => {
    let first = 0;
    let last = 0;
    for (const r of runs) {
      const wt = r.party.events.filter((e) => e.kind === 'wrong-turn');
      expect(wt.length).toBe(r.party.stats.wrongTurns);
      expect(wt.some((e) => e.actors[0] === r.party.host.id || r.party.people[e.actors[0]!]!.staff)).toBe(false);
      first += wt.filter((e) => e.t < 3600).length;
      last += wt.filter((e) => e.t >= 2 * 3600).length;
    }
    expect(first).toBeGreaterThan(5);
    expect(last * 3).toBeLessThanOrEqual(first);
  });

  it('asks the way to a bathroom no one has shown them, mostly with an answer', () => {
    for (const r of runs) {
      const asks = r.party.events.filter((e) => e.kind === 'ask');
      expect(asks.length).toBeGreaterThan(5);
      expect(asks.filter((e) => e.note === 'pointed').length).toBeGreaterThan(asks.length / 2);
    }
  });

  it('looks twice at a few people, and never doubts anyone past a passed test', () => {
    for (const r of runs) {
      const takes = r.party.events.filter((e) => e.kind === 'double-take').length;
      expect(takes).toBe(r.party.stats.doubleTakes);
      expect(takes).toBeGreaterThan(0);
      expect(takes).toBeLessThanOrEqual(30);
      expect(r.doubtedAfterTest).toBe(0);
    }
  });

  it('lets no innocent become suspicious', () => {
    for (const r of runs) expect(r.suspicious, r.party.bp.seed).toBe(0);
  });

  it('passes things on in conversation, and keeps mood within bounds', () => {
    for (const r of runs) {
      const { party } = r;
      expect(party.stats.told).toBeGreaterThan(50);
      for (const p of party.people) {
        expect(party.mood.energy[p.id]).toBeGreaterThanOrEqual(0);
        expect(party.mood.energy[p.id]).toBeLessThanOrEqual(1);
        expect(party.mood.tension[p.id]).toBeGreaterThanOrEqual(0);
        expect(party.mood.tension[p.id]).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('the lab’s provocations', () => {
  it('plants a rumour and nudges the mood live exactly as a replay given them up front', () => {
    const T = 70 * 60;
    const rumour = { t: T, subject: 9 };
    const tense = { t: T, target: 'all' as const, tension: 0.6, energy: 1.4 };
    const live = new Party(bp, { seed: bp.seed });
    live.advance(T);
    live.plant(rumour);
    live.nudge(tense);
    live.advance(20 * 60);
    const replay = new Party(bp, { seed: bp.seed, provoke: [rumour], mood: [tense] });
    replay.advance(T + 20 * 60);
    const plain = new Party(bp, { seed: bp.seed });
    plain.advance(T + 20 * 60);
    expect(live.digest()).toBe(replay.digest());
    expect(live.stats.told).toBe(replay.stats.told);
    expect(live.digest()).not.toBe(plain.digest());
  }, 30_000);
});

describe('golden evenings', () => {
  // Any change to what people do, see or remember changes these. When a change is meant, check the lab and the numbers in
  // docs/party.md, then regenerate with npx vitest run tests/party-minds.test.ts -u.
  const TIMES = [30 * 60, 75 * 60, 150 * 60];

  it('match the digests on file', async () => {
    const got: Record<string, string[]> = {};
    for (const seed of HOUSES) {
      const party = new Party(blueprint(seed), { seed: 'golden' });
      got[seed] = TIMES.map((t) => {
        party.advance(t - party.t);
        return party.digest();
      });
    }
    await expect(`${JSON.stringify(got, null, 2)}\n`).toMatchFileSnapshot('./golden/party-digests.json');
  }, 60_000);
});
