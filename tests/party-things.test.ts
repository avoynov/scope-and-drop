/**
 * Milestone 2, part 1 (Things): doors and locks, routes through them, curtains, lights,
 * items, bathrooms with a queue, drinks and tipsiness, and the fallback chains.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generateMansion } from '../src/mansion';
import type { MansionBlueprint, MansionSize } from '../src/mansion/core/types';
import { Rng } from '../src/mansion/core/rng';
import { Pathfinder, type Walker } from '../src/party/path';
import { CHAIN_IDS, OPTIONAL_CHAINS, resolvePlaces, RoomCells } from '../src/party/places';
import { Party } from '../src/party/sim';
import { ALCOHOL, DRINKS, type DrinkId, type Person } from '../src/party/types';
import { AJAR, DRINK_IDS, Items, LIGHT_OFF, World } from '../src/party/world';

const bp = generateMansion({ seed: 'gala-night' });
const guestsOf = (party: Party): Person[] => party.people.filter((p) => !p.staff && p.role !== 'host');
const walker = (ring: Walker['ring'], room: number, id = 999): Walker => ({ id, ring, lentKey: -1, room });

function house(seed: string, size?: MansionSize): { bp: MansionBlueprint; pf: Pathfinder; world: World; cells: RoomCells } {
  const b = seed === 'gala-night' && !size ? bp : generateMansion({ seed, size });
  const pf = new Pathfinder(b);
  const world = new World(b, pf, new Rng(`world/${seed}`));
  pf.setGate(world);
  return { bp: b, pf, world, cells: new RoomCells(pf) };
}

/** Door ids a route's straight legs pass over, sampled every 5 cm. */
function doorsCrossed(world: World, route: Array<{ level: number; x: number; z: number; climb?: boolean }>): Set<number> {
  const out = new Set<number>();
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    if (b.climb || a.level !== b.level) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
    for (let k = 0; k <= n; k++) {
      const d = world.doorAtPoint(a.level, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n);
      if (d >= 0) out.add(d);
    }
  }
  return out;
}

describe('doors', () => {
  const { bp: b, pf, world, cells } = house('gala-night');
  const type = (r: number) => b.rooms[r]!.type;

  it('puts one door on every interior door between two rooms, with cells in its wall', () => {
    const ids = new Set(b.rooms.map((r) => r.id));
    let expected = 0;
    for (const w of b.walls) {
      if (w.exterior || !w.neg || !w.pos || !ids.has(w.neg) || !ids.has(w.pos)) continue;
      expected += w.openings.filter((o) => o.passable && (o.kind === 'door' || o.kind === 'double-door')).length;
    }
    expect(world.doors.length).toBe(expected);
    expect(expected).toBeGreaterThan(10);
    for (const d of world.doors) {
      expect(d.cells.length).toBeGreaterThan(0);
      for (const k of d.cells) expect(world.doorAtCell(d.level, k)).toBe(d.id);
    }
  });

  it('starts bathrooms ajar with a bolt, bedrooms and the study locked, guest bedrooms open to bolt', () => {
    for (const d of world.doors) {
      const t = d.rooms.map(type);
      if (t.includes('bathroom')) {
        expect(d.lock).toBe('inside');
        expect(d.open).toBe(AJAR);
        expect(d.locked).toBe(false);
        expect(type(d.inner)).toBe('bathroom');
      } else if (d.rooms.some((r) => world.guestBedrooms.includes(r)) && t.includes('bedroom')) {
        expect(d.lock).toBe('inside');
        expect(d.locked).toBe(false);
      } else if (t.includes('study')) {
        expect(d.lock).toBe('key');
        expect(d.locked).toBe(true);
      }
    }
    expect(world.guestBedrooms.length).toBeGreaterThanOrEqual(1);
    expect(world.doors.some((d) => d.locked && d.rooms.some((r) => type(r) === 'bedroom'))).toBe(true);
  });

  it('keeps guests out of a locked room and lets the host in', () => {
    const d = world.doors.find((x) => x.locked && x.lock === 'key')!;
    const inside = d.rooms.find((r) => type(r) === 'bedroom' || type(r) === 'study')!;
    const outside = world.otherSide(d, inside);
    const rng = new Rng('locked');
    const to = cells.random(inside, rng)!;
    const from = cells.random(outside, rng)!;
    expect(pf.route(from, to, walker('none', outside))).toBeNull();
    const r = pf.route(from, to, walker('host', outside));
    expect(r).not.toBeNull();
    expect(doorsCrossed(world, r!).has(d.id)).toBe(true);
  });

  it('lets a bolt be drawn only from inside, or by whoever drew it', () => {
    const d = world.doors.find((x) => x.lock === 'inside' && type(x.inner) === 'bathroom')!;
    const out = world.otherSide(d, d.inner);
    const rng = new Rng('bolt');
    const inBath = cells.random(d.inner, rng, 0.2)!;
    const outSpot = cells.random(out, rng)!;
    world.setLocked(d, true, 7);
    try {
      expect(pf.route(outSpot, inBath, walker('host', out))).toBeNull();
      expect(pf.route(outSpot, inBath, walker('none', out, 7))).not.toBeNull();
      expect(pf.route(inBath, outSpot, walker('none', d.inner))).not.toBeNull();
    } finally {
      world.setLocked(d, false, 7);
    }
    expect(pf.route(outSpot, inBath, walker('none', out))).not.toBeNull();
  });

  it('never routes a guest over a locked door, cached or not, and re-checks a cached route when a door locks', () => {
    const rng = new Rng('routes');
    const rooms = b.rooms.filter((r) => r.role === 'party' && cells.count(r.index) > 20).map((r) => r.index);
    let crossed = 0;
    for (let i = 0; i < 40; i++) {
      const a = cells.random(rng.pick(rooms), rng)!;
      const z = cells.random(rng.pick(rooms), rng)!;
      for (let rep = 0; rep < 2; rep++) {
        const r = pf.route(a, z, walker('none', a.room));
        if (!r) continue;
        for (const d of doorsCrossed(world, r)) {
          expect(world.canPass(world.doors[d]!, walker('none', a.room))).toBe(true);
          crossed++;
        }
      }
    }
    expect(crossed).toBeGreaterThan(0);
    expect(pf.stats.hits).toBeGreaterThan(0);

    // Lock a door a cached route crosses: the next route goes another way or not at all.
    for (let i = 0; i < 60; i++) {
      const a = cells.random(rng.pick(rooms), rng)!;
      const z = cells.random(rng.pick(rooms), rng)!;
      const who = walker('none', a.room);
      const r = pf.route(a, z, who);
      const open = r ? [...doorsCrossed(world, r)].map((d) => world.doors[d]!).find((d) => d.lock === 'none') : undefined;
      if (!open) continue;
      open.lock = 'key';
      world.setLocked(open, true, -1);
      try {
        const again = pf.route(a, z, who);
        if (again) expect(doorsCrossed(world, again).has(open.id)).toBe(false);
      } finally {
        world.setLocked(open, false, -1);
        open.lock = 'none';
      }
      expect(doorsCrossed(world, pf.route(a, z, who)!).has(open.id)).toBe(true);
      return;
    }
    throw new Error('no route crossed an ordinary door');
  });

  it('swings doors at a steady pace', () => {
    const d = world.doors.find((x) => x.lock === 'none')!;
    world.swing(d, 0);
    for (let i = 0; i < 20; i++) world.step(0.5);
    expect(d.open).toBe(0);
    world.swing(d, 1);
    world.step(0.5);
    expect(d.open).toBeGreaterThan(0);
    expect(d.open).toBeLessThan(1);
    for (let i = 0; i < 20; i++) world.step(0.5);
    expect(d.open).toBe(1);
  });
});

describe('the room graph', () => {
  // A quick "no" from the room graph skips a hopeless search, so the graph must join every pair of rooms the floor joins.
  it('joins every pair of rooms the walkable floor joins, across 12 houses', () => {
    for (const size of ['compact', 'grand', 'palatial'] as const) {
      for (let i = 0; i < 4; i++) {
        const { pf, world } = house(`census-${size}-${i}`, size);
        for (const d of world.doors) if (d.locked) world.setLocked(d, false, -1);
        const host = (room: number) => walker('host', room);
        for (const n of pf.levels.values()) {
          const seen = new Uint8Array(n.walk.length);
          for (let s = 0; s < n.walk.length; s++) {
            if (!n.walk[s] || seen[s]) continue;
            // Flood one patch of floor and collect its rooms.
            const rooms = new Set<number>();
            const stack = [s];
            seen[s] = 1;
            while (stack.length) {
              const k = stack.pop()!;
              if (n.room[k]! !== -1) rooms.add(n.room[k]!);
              const c = k % n.cols;
              for (const q of [k - n.cols, k + n.cols, c > 0 ? k - 1 : -1, c < n.cols - 1 ? k + 1 : -1]) {
                if (q < 0 || q >= n.walk.length || !n.walk[q] || seen[q]) continue;
                seen[q] = 1;
                stack.push(q);
              }
            }
            const list = [...rooms];
            for (let j = 1; j < list.length; j++) expect(world.reachable(list[0]!, list[j]!, host(list[0]!)), `${size}-${i} L${n.level} rooms ${list[0]} ${list[j]}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('curtains and lights', () => {
  const { bp: b, pf, world } = house('gala-night');

  it('reads the baked view until a curtain moves, and none through drawn curtains', () => {
    const room = b.rooms.find((r) => world.roomCurtains[r.index]!.some((c) => world.curtains[c]!.movable && world.curtains[c]!.towardPerch && world.curtains[c]!.base !== 'drawn'));
    expect(room).toBeDefined();
    const n = pf.levels.get(room!.level)!;
    const cellsIn: number[] = [];
    for (let k = 0; k < n.room.length; k++) if (n.room[k] === room!.index && n.vis[k]! > 0) cellsIn.push(k);
    expect(cellsIn.length).toBeGreaterThan(0);
    for (const k of cellsIn) expect(world.visAt(n.level, k)).toBe(n.vis[k]! / 255);
    const ids = world.roomCurtains[room!.index]!;
    for (const id of ids) world.setCurtain(world.curtains[id]!, 'drawn');
    for (const k of cellsIn) expect(world.visAt(n.level, k)).toBe(0);
    for (const id of ids) world.setCurtain(world.curtains[id]!, world.curtains[id]!.base);
    for (const k of cellsIn) expect(world.visAt(n.level, k)).toBe(n.vis[k]! / 255);
  });

  it('opens curtains drawn at the start onto a view the bake never had', () => {
    // Some such windows face the perch but are hidden behind another wing; at least one room must open up.
    let opened = 0;
    for (const c of world.curtains.filter((x) => x.movable && x.towardPerch && x.base === 'drawn')) {
      const n = pf.levels.get(c.level)!;
      const ids = world.roomCurtains[c.room]!;
      for (const id of ids) world.setCurtain(world.curtains[id]!, 'open');
      for (let k = 0; k < n.room.length; k++) {
        if (n.room[k] !== c.room) continue;
        const v = world.visAt(n.level, k);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        if (v > n.vis[k]! / 255) opened++;
      }
      for (const id of ids) world.setCurtain(world.curtains[id]!, world.curtains[id]!.base);
    }
    expect(opened).toBeGreaterThan(0);
  });

  it('switches a room dark and back', () => {
    const r = b.rooms.find((x) => x.lit > 0)!;
    expect(world.lit(r.index)).toBeGreaterThan(0);
    expect(world.setLight(r.index, false)).toBe(true);
    expect(world.setLight(r.index, false)).toBe(false);
    expect(world.lit(r.index)).toBeCloseTo(r.lit * LIGHT_OFF);
    expect(world.setLight(r.index, true)).toBe(true);
    expect(world.lit(r.index)).toBeGreaterThanOrEqual(r.lit);
  });
});

describe('items', () => {
  it('grows past its first 512 rows and keeps every field', () => {
    const items = new Items();
    for (let i = 0; i < 700; i++) {
      const id = items.add(i % 2 ? 'glass' : 'coat', i % 2 ? 'full' : 'hung', i, -1, { level: i % 3, x: i, z: -i, room: i % 7 }, i);
      expect(id).toBe(i);
    }
    expect(items.n).toBe(700);
    expect(items.kindOf(601)).toBe('glass');
    expect(items.stateOf(600)).toBe('hung');
    expect(items.x[650]).toBe(650);
    expect(items.where('hung', 'coat')).toHaveLength(350);
  });
});

describe('fallback chains', () => {
  it('resolve in every house, with walkable spots, and only the optional ones may be missing', () => {
    for (const size of ['compact', 'grand', 'palatial'] as const) {
      for (let i = 0; i < 4; i++) {
        const { bp: b, pf, world, cells } = house(`census-${size}-${i}`, size);
        const places = resolvePlaces(b, pf, cells, world);
        for (const id of CHAIN_IDS) {
          const c = places.chains[id];
          if (c.link === 'none') {
            expect(OPTIONAL_CHAINS.has(id), `${size}-${i} ${id}`).toBe(true);
            continue;
          }
          expect(c.spots.length, `${size}-${i} ${id} ${c.link}`).toBeGreaterThan(0);
          for (const s of c.spots) expect(pf.walkable(s.level, s.x, s.z)).toBe(true);
        }
        // Every bathroom has a place outside the door and a line of at most two beside it.
        for (const bath of places.bathrooms) {
          expect(pf.walkable(bath.door.level, bath.door.x, bath.door.z)).toBe(true);
          expect(bath.queue.length).toBeLessThanOrEqual(2);
          for (const q of bath.queue) expect(pf.walkable(q.level, q.x, q.z)).toBe(true);
        }
      }
    }
  });
});

describe('an evening with things', () => {
  interface Run {
    party: Party;
    maxQueue: number;
    sharedBath: number;
    boltMismatch: number;
    inLockedDoor: number;
    badTipsy: number;
    emptyInHand: number;
    heldWithoutGlass: number;
    toastShare: number;
  }
  const runs: Run[] = [];

  beforeAll(() => {
    for (const [house, seed] of [
      ['gala-night', 'evening'],
      ['match-42', 'match-42'],
      ['orangery-1', 'orangery-1'],
    ] as const) {
      const party = new Party(house === 'gala-night' ? bp : generateMansion({ seed: house }), { seed });
      const run: Run = { party, maxQueue: 0, sharedBath: 0, boltMismatch: 0, inLockedDoor: 0, badTipsy: 0, emptyInHand: 0, heldWithoutGlass: 0, toastShare: 0 };
      const toast = party.programme.find((p) => p.id === 'toast')!;
      const raise = toast.start + (toast.end - toast.start) * 0.5;
      const items = party.world.items;
      while (!party.over) {
        party.advance(30);
        if (!run.toastShare && party.t >= raise) {
          const here = guestsOf(party).filter((g) => g.present);
          run.toastShare = here.filter((g) => g.held === 'champagne').length / here.length;
        }
        party.places.bathrooms.forEach((bath, i) => {
          const st = party.body.baths[i]!;
          run.maxQueue = Math.max(run.maxQueue, st.queue.length);
          const using = party.people.filter((q) => q.present && q.room === bath.room.index && q.action?.id === 'toilet' && q.action.note === 'inside' && q.action.startedAt !== null);
          if (using.length > 1) run.sharedBath++;
          const d = bath.doorId >= 0 ? party.world.doors[bath.doorId]! : null;
          if (d?.locked && d.lockedBy !== st.occupant) run.boltMismatch++;
        });
        for (const p of party.people) {
          if (!p.present) continue;
          const d = party.world.doorAtPoint(p.level, p.x, p.z);
          if (d >= 0 && !party.world.canPass(party.world.doors[d]!, p)) run.inLockedDoor++;
          if (!(p.tipsy >= 0 && p.tipsy <= 1)) run.badTipsy++;
          if (p.held && DRINKS.has(p.held)) {
            if (p.item < 0 || items.kindOf(p.item) !== 'glass' || items.holder[p.item] !== p.id || items.drinkOf(p.item) !== p.held) run.heldWithoutGlass++;
            else if (items.fill[p.item]! <= 0) run.emptyInHand++;
          }
        }
      }
      runs.push(run);
    }
  }, 120_000);

  it('never puts two people in one bathroom, keeps the line to two, and bolts only for the person inside', () => {
    for (const r of runs) {
      expect(r.sharedBath).toBe(0);
      expect(r.maxQueue).toBeLessThanOrEqual(2);
      expect(r.boltMismatch).toBe(0);
    }
  });

  it('rarely sends anyone to a bathroom they find taken (target under 15 an evening)', () => {
    for (const r of runs) {
      const taken = r.party.events.filter((e) => e.kind === 'bathroom-taken').length;
      expect(taken).toBe(r.party.body.stats.taken);
      expect(taken).toBeLessThan(25);
    }
  });

  it('never leaves anyone standing in a doorway that is locked against them', () => {
    for (const r of runs) expect(r.inLockedDoor).toBe(0);
  });

  it('pours real glasses: each drink in hand is a glass item with something in it', () => {
    for (const r of runs) {
      expect(r.heldWithoutGlass).toBe(0);
      expect(r.emptyInHand).toBe(0);
      expect(r.party.body.stats.pours).toBeGreaterThan(10);
    }
  });

  it('keeps everyone off the drink they never touch, and counts what they drank', () => {
    for (const r of runs) {
      for (const p of r.party.people) {
        for (const e of p.drinkLog) {
          expect(DRINK_IDS).toContain(e.drink);
          expect(e.drink).not.toBe(p.never);
        }
        if (p.drinkLog.length < 24) expect(p.drinks).toBe(p.drinkLog.filter((e) => ALCOHOL.has(e.drink)).length);
      }
      const never = r.party.people.filter((p) => p.never !== null).length;
      expect(never).toBeGreaterThan(0);
    }
  });

  it('makes people tipsy, within bounds, more with more drink', () => {
    for (const r of runs) {
      expect(r.badTipsy).toBe(0);
      const guests = guestsOf(r.party);
      const mean = guests.reduce((s, g) => s + g.tipsy, 0) / guests.length;
      expect(mean).toBeGreaterThan(0.05);
      expect(mean).toBeLessThan(0.7);
      // More alcohol, more tipsy (rank correlation over the guests).
      const heavy = [...guests].sort((a, b) => b.drinks - a.drinks).slice(0, 5);
      const light = [...guests].sort((a, b) => a.drinks - b.drinks).slice(0, 5);
      const avg = (l: Person[]) => l.reduce((s, g) => s + g.tipsy, 0) / l.length;
      expect(avg(heavy)).toBeGreaterThan(avg(light));
    }
  });

  it('hands most guests a glass of champagne for the toast', () => {
    for (const r of runs) expect(r.toastShare).toBeGreaterThanOrEqual(0.6);
  });

  it('hangs every coat on arrival and gives it back at the door', () => {
    for (const r of runs) {
      const items = r.party.world.items;
      for (const g of guestsOf(r.party)) {
        expect(g.coat).toBeGreaterThanOrEqual(0);
        expect(items.kindOf(g.coat)).toBe('coat');
        expect(items.stateOf(g.coat)).toBe(g.gone ? 'worn' : 'hung');
      }
      expect(items.where('shelved', 'kit').length + items.where('carried', 'kit').length).toBeGreaterThan(0);
    }
  });

  it('logs bumps, and a slopped drink only when someone held one', () => {
    for (const r of runs) {
      const bumps = r.party.events.filter((e) => e.kind === 'bump');
      expect(bumps.length).toBe(r.party.body.stats.bumps);
      expect(bumps.length).toBeLessThan(400);
      expect(bumps.filter((e) => e.note === 'slop').length).toBe(r.party.body.stats.slops);
    }
  });
});

describe('determinism', () => {
  // The golden digests live in tests/golden/party-digests.json (tests/party-minds.test.ts).
  it('replays the same evening, doors, drinks and all', () => {
    const a = new Party(bp, { seed: 'twice' });
    const b = new Party(bp, { seed: 'twice' });
    a.advance(50 * 60);
    b.advance(50 * 60);
    expect(a.digest()).toBe(b.digest());
    expect(a.people.map((p) => p.drinkLog.map((e) => e.drink).join()).join('|')).toBe(b.people.map((p) => p.drinkLog.map((e) => e.drink).join()).join('|'));
    const drinks = new Set<DrinkId>(a.people.flatMap((p) => p.drinkLog.map((e) => e.drink)));
    expect(drinks.size).toBeGreaterThanOrEqual(3);
  });
});
