import { describe, expect, it } from 'vitest';
import { generateMansion } from '../src/mansion';
import { Rng } from '../src/mansion/core/rng';
import { clockLabel, makeProgramme, PARTY_LENGTH, PHASE_JITTER, phaseIndexAt } from '../src/party/clock';
import { Party } from '../src/party/sim';
import type { ActionId, Person } from '../src/party/types';

const bp = generateMansion({ seed: 'gala-night' });
const guestsOf = (party: Party): Person[] => party.people.filter((p) => !p.staff && p.role !== 'host');

describe('programme', () => {
  it('runs 19:00 to 22:00 in contiguous phases, jittered within bounds', () => {
    for (const seed of ['a', 'b', 'c']) {
      const prog = makeProgramme(new Rng(seed));
      expect(prog[0]!.start).toBe(0);
      expect(prog.at(-1)!.end).toBe(PARTY_LENGTH);
      for (let i = 1; i < prog.length; i++) {
        expect(prog[i]!.start).toBe(prog[i - 1]!.end);
        expect(prog[i]!.end - prog[i]!.start).toBeGreaterThanOrEqual(120);
      }
      const plain = makeProgramme(new Rng(seed));
      expect(plain).toEqual(prog);
      // Every boundary within the jitter of its nominal minute.
      const nominal = [15, 30, 36, 42, 60, 100, 130, 155, 165].map((m) => m * 60);
      prog.slice(1).forEach((ph, i) => expect(Math.abs(ph.start - nominal[i]!)).toBeLessThanOrEqual(PHASE_JITTER));
    }
  });
  it('labels the clock and finds the phase', () => {
    expect(clockLabel(0)).toBe('19:00');
    expect(clockLabel(97 * 60 + 30)).toBe('20:37');
    const prog = makeProgramme(new Rng('x'));
    expect(prog[phaseIndexAt(prog, 1)]!.id).toBe('arrival');
    expect(prog[phaseIndexAt(prog, PARTY_LENGTH - 1)]!.id).toBe('farewell');
  });
});

describe('cast', () => {
  const party = new Party(bp, { seed: 'cast' });
  const guests = guestsOf(party);
  it('has 20–30 guests, one host and a serving staff', () => {
    expect(guests.length).toBeGreaterThanOrEqual(20);
    expect(guests.length).toBeLessThanOrEqual(30);
    expect(party.people.filter((p) => p.role === 'host')).toHaveLength(1);
    expect(party.people.filter((p) => p.role === 'waiter').length).toBeGreaterThanOrEqual(2);
  });
  it('gives every guest a distinct look and name', () => {
    const looks = new Set(guests.map((g) => `${g.look.outfit}/${g.look.color}`));
    expect(looks.size).toBe(guests.length);
    expect(new Set(party.people.map((p) => p.name)).size).toBe(party.people.length);
  });
  it('keeps relationships mutual', () => {
    for (const p of party.people) {
      if (p.partner !== null) expect(party.people[p.partner]!.partner).toBe(p.id);
      for (const f of p.friends) expect(party.people[f]!.friends).toContain(p.id);
    }
  });
  it('seats each diner once', () => {
    const seats = party.people.map((p) => p.seat).filter((s) => s !== null);
    expect(new Set(seats).size).toBe(seats.length);
  });
  it('respects a requested guest count', () => {
    expect(guestsOf(new Party(bp, { seed: 'cast', guests: 24 }))).toHaveLength(24);
  });
});

describe('the evening', () => {
  it('is deterministic per seed', () => {
    const a = new Party(bp, { seed: 'same' });
    const b = new Party(bp, { seed: 'same' });
    a.advance(20 * 60);
    b.advance(20 * 60);
    expect(a.digest()).toBe(b.digest());
    const c = new Party(bp, { seed: 'other' });
    c.advance(20 * 60);
    expect(c.digest()).not.toBe(a.digest());
  });

  it('follows the programme, on the floor, from arrival to the last guest out', () => {
    const party = new Party(bp, { seed: 'evening' });
    const guests = guestsOf(party);
    const at = (id: string, f: number) => {
      const ph = party.programme.find((p) => p.id === id)!;
      return ph.start + (ph.end - ph.start) * f;
    };
    const share = (ids: ActionId[]) => {
      const here = guests.filter((g) => g.present);
      return here.filter((g) => g.action && ids.includes(g.action.id)).length / here.length;
    };
    let offFloor = 0;
    let samples = 0;
    const t0 = performance.now();
    const checkpoints = new Map<number, () => void>([
      [at('toast', 0.85), () => expect(share(['toast'])).toBeGreaterThanOrEqual(0.7)],
      [at('dinner', 0.6), () => {
        expect(share(['dinner'])).toBeGreaterThanOrEqual(0.9);
        expect(guests.filter((g) => g.pose === 'sit').length).toBeGreaterThanOrEqual(Math.min(party.places.diningSeats.length - 1, guests.length) * 0.8);
      }],
      [at('dancing', 0.5), () => expect(share(['dance'])).toBeGreaterThanOrEqual(0.3)],
    ]);
    while (!party.over) {
      party.advance(30);
      for (const [t, check] of checkpoints) {
        if (party.t >= t) {
          check();
          checkpoints.delete(t);
        }
      }
      for (const p of party.people) {
        if (!p.present || p.pose === 'sit' || p.pose === 'climb') continue;
        samples++;
        if (!party.pf.walkable(p.level, p.x, p.z)) offFloor++;
      }
    }
    expect(checkpoints.size).toBe(0);
    // Nobody walks through walls: everyone on their feet stands on walkable floor at every sample.
    expect(samples).toBeGreaterThan(1000);
    expect(offFloor).toBe(0);
    expect(guests.every((g) => g.gone)).toBe(true);
    expect(party.events.filter((e) => e.kind === 'arrive')).toHaveLength(guests.length);
    expect(party.events.filter((e) => e.kind === 'phase')).toHaveLength(party.programme.length - 1);
    // Most guests got a glass of champagne for the toast.
    expect(new Set(party.events.filter((e) => e.kind === 'champagne').map((e) => e.actors[0])).size).toBeGreaterThanOrEqual(guests.length * 0.6);
    // A whole evening runs headless in seconds.
    expect(performance.now() - t0).toBeLessThan(20_000);
  });
});
