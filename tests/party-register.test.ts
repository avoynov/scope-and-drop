/**
 * Connecting the dots (register.ts): cases, sightings and claims, weighed against each other;
 * things that don't fit; drink's blur; names put to descriptions; talk; whole evenings with a
 * planted theft.
 */
import { describe, expect, it } from 'vitest';
import { generateMansion } from '../src/mansion';
import type { MansionBlueprint } from '../src/mansion/core/types';
import { PARTY_LENGTH } from '../src/party/clock';
import { CASES, FORGOT, OWN, Register } from '../src/party/register';
import { Party, type Provocation } from '../src/party/sim';
import type { Person } from '../src/party/types';

const bp = generateMansion({ seed: 'gala-night' });
const HOUSES = ['gala-night', 'match-42', 'orangery-1'] as const;
const blueprint = (seed: string): MansionBlueprint => (seed === 'gala-night' ? bp : generateMansion({ seed }));
const guestsOf = (party: Party): Person[] => party.people.filter((p) => !p.staff && p.role !== 'host');

/** A fresh evening at 19:00, everyone sober: the register is driven by hand. */
function fresh(): { party: Party; reg: Register; guests: Person[] } {
  const party = new Party(bp, { seed: bp.seed });
  return { party, reg: party.register, guests: guestsOf(party) };
}

/** A room with a neighbour, and a room joined to neither. */
function rooms(reg: Register): { a: number; next: number; far: number } {
  const n = bp.rooms.length;
  for (let a = 0; a < n; a++) {
    const next = [...Array(n).keys()].find((b) => b !== a && reg.joined(a, b));
    const far = [...Array(n).keys()].find((b) => b !== a && !reg.joined(a, b));
    if (next !== undefined && far !== undefined) return { a, next, far };
  }
  throw new Error('no rooms');
}

/** Someone i knows by name, and someone i has never met. */
function knownAndStranger(party: Party, i: number): { known: number; stranger: number } {
  const others = guestsOf(party).filter((q) => q.id !== i);
  const known = others.find((q) => party.ident.tieOf(i, q.id) >= 2)!.id;
  const stranger = others.find((q) => party.ident.tieOf(i, q.id) === 0)!.id;
  return { known, stranger };
}

const pOf = (reg: Register, i: number, c: number, j: number): number => reg.casesOf(i).find((k) => k.slot === c)!.candidates.find((k) => k.who === j)?.p ?? 0;

describe('the register', () => {
  it('fits a sighting to a case by room and time', () => {
    const { reg } = fresh();
    const { a, next, far } = rooms(reg);
    expect(reg.roomFit(a, a)).toBe(1);
    expect(reg.roomFit(a, next)).toBe(0.4);
    expect(reg.roomFit(a, far)).toBe(0);
    expect(Register.timeFit(0, 600, 300, 400)).toBe(1);
    expect(Register.timeFit(0, 600, 900, 900)).toBeCloseTo(0.5);
    expect(Register.timeFit(0, 600, 1300, 1400)).toBe(0);
  });

  it('connects the dots in either order: a case looks back at what is held, a sighting looks at open cases', () => {
    const run = (caseFirst: boolean) => {
      const { party, reg, guests } = fresh();
      const { a } = rooms(reg);
      const [h, owner] = [guests[0]!, guests[1]!];
      const { known: x } = knownAndStranger(party, h.id);
      party.t = 1200;
      let c = -1;
      const open = () => (c = reg.open(h.id, 'gone', owner.id, -1, a, 0, 1200));
      if (caseFirst) open();
      reg.see(h.id, party.people[x]!, 'was-in', a);
      if (!caseFirst) open();
      reg.weigh(h.id, c);
      return { p: pOf(reg, h.id, c, x), x };
    };
    const a = run(true);
    const b = run(false);
    expect(a.p).toBeGreaterThan(0.6);
    expect(a.p).toBeCloseTo(b.p, 6);
  });

  it('counts each original witness once, however many tell it; a second witness adds', () => {
    const { party, reg, guests } = fresh();
    const { a } = rooms(reg);
    const [h, owner, w, w2, t1, t2, t3] = guests;
    const x = guests.find((q) => q.id > 7 && party.ident.tieOf(w!.id, q.id) >= 1 && party.ident.tieOf(w2!.id, q.id) >= 1 && party.ident.tieOf(h!.id, q.id) >= 1)!;
    party.t = 600;
    reg.see(w!.id, x, 'was-in', a);
    const e = reg.entriesOf(w!.id).find((k) => k.who === x.id)!.slot;
    const c = reg.open(h!.id, 'gone', owner!.id, -1, a, 0, 900);
    const relay = (teller: Person) => {
      const k = reg.copyEntry(teller.id, w!.id, e);
      reg.copyEntry(h!.id, teller.id, k);
    };
    relay(t1!);
    const once = pOf(reg, h!.id, c, x.id);
    relay(t2!);
    relay(t3!);
    expect(once).toBeGreaterThan(0);
    // Three tellers, one witness: still one vote (the best of them).
    expect(pOf(reg, h!.id, c, x.id)).toBeLessThanOrEqual(once * 1.25 + 1e-6);
    // An independent witness, told straight to them.
    reg.see(w2!.id, x, 'was-in', a);
    const e2 = reg.entriesOf(w2!.id).find((k) => k.who === x.id)!.slot;
    reg.copyEntry(h!.id, w2!.id, e2);
    expect(pOf(reg, h!.id, c, x.id)).toBeGreaterThan(once + 0.05);
  });

  it('settles on own eyes, not on a stranger’s word; settling makes a fact to pass on and the holder wary', () => {
    const { party, reg, guests } = fresh();
    const { a } = rooms(reg);
    const [h, owner] = [guests[0]!, guests[1]!];
    const { known: x, stranger: s } = knownAndStranger(party, h.id);
    party.t = 1200;
    // A stranger's word: a lead, not a verdict.
    const told = reg.open(guests[2]!.id, 'gone', owner.id, -1, a, 0, 1200);
    reg.see(s, party.people[x]!, 'was-in', a);
    reg.copyEntry(guests[2]!.id, s, reg.entriesOf(s).filter((k) => k.room === a).pop()!.slot);
    const viewTold = reg.casesOf(guests[2]!.id).find((k) => k.slot === told)!;
    if (party.ident.tieOf(guests[2]!.id, s) === 0) expect(viewTold.state).toBe('open');
    // Own eyes: settled, a 'blamed' fact held, suspicion over the wary line.
    const c = reg.open(h.id, 'gone', owner.id, -1, a, 0, 1200);
    reg.see(h.id, party.people[x]!, 'was-in', a);
    const view = reg.casesOf(h.id).find((k) => k.slot === c)!;
    expect(view.state).toBe('settled');
    expect(view.candidates[0]!.who).toBe(x);
    expect(reg.blamedBy(x)).toBeGreaterThanOrEqual(1);
    const m = party.memory;
    expect([...Array(m.count).keys()].some((f) => m.verbOf(f) === 'blamed' && m.subject[f] === x && m.knows(h.id, f))).toBe(true);
    expect(m.suspects(h.id, x)).toBeCloseTo(CASES.gone.severity * view.candidates[0]!.p * (1 - m.trustIn(h.id, x)), 5);
  });

  it('adds suspicion only for the rise: the same thing heard again adds nothing', () => {
    const { party, reg, guests } = fresh();
    const { a } = rooms(reg);
    const [h, owner, w] = [guests[0]!, guests[1]!, guests[2]!];
    const x = guests.find((q) => q.id > 3 && party.ident.tieOf(w.id, q.id) >= 1)!;
    party.t = 600;
    reg.see(w.id, x, 'was-in', a);
    const e = reg.entriesOf(w.id).find((k) => k.who === x.id)!.slot;
    const c = reg.open(h.id, 'gone', owner.id, -1, a, 0, 900);
    reg.copyEntry(h.id, w.id, e);
    const s1 = party.memory.suspects(h.id, x.id);
    reg.copyEntry(h.id, w.id, e);
    reg.weigh(h.id, c);
    reg.weigh(h.id, c);
    expect(s1).toBeGreaterThan(0);
    expect(party.memory.suspects(h.id, x.id)).toBeCloseTo(s1, 6);
  });

  it('never counts the owner, or the household for the house’s own things', () => {
    const { party, reg, guests } = fresh();
    const { a } = rooms(reg);
    const h = guests[0]!;
    const host = party.host;
    party.t = 600;
    const c = reg.open(h.id, 'gone', host.id, -1, a, 0, 900);
    reg.see(h.id, host, 'was-in', a);
    expect(reg.casesOf(h.id).find((k) => k.slot === c)!.candidates.map((k) => k.who)).not.toContain(host.id);
  });
});

describe('drink blurs what is filed', () => {
  it('a tipsy filer puts about 0.3 × tipsiness of sightings in the next room; a sober one never', () => {
    const { party, reg, guests } = fresh();
    const { a } = rooms(reg);
    let slips = 0;
    let filed = 0;
    let soberSlips = 0;
    for (const [k, h] of guests.entries()) {
      h.tipsy = k % 4 === 0 ? 0 : 0.8;
      for (const q of party.people) {
        if (q === h) continue;
        reg.see(h.id, q, 'was-in', a);
      }
      for (const e of reg.entriesOf(h.id)) {
        if (h.tipsy) {
          filed++;
          if (e.room !== a) slips++;
        } else if (e.room !== a) soberSlips++;
      }
    }
    expect(soberSlips).toBe(0);
    expect(slips / filed).toBeGreaterThan(0.17);
    expect(slips / filed).toBeLessThan(0.31);
  });

  it('a tipsy listener loses who said it some of the time, and a stranger’s description loses detail', () => {
    const { party, reg, guests } = fresh();
    const { a } = rooms(reg);
    const w = guests[0]!;
    for (const q of party.people) if (q !== w) reg.see(w.id, q, 'was-in', a);
    const listener = guests[1]!;
    listener.tipsy = 1;
    for (const e of reg.entriesOf(w.id)) reg.copyEntry(listener.id, w.id, e.slot);
    const got = reg.entriesOf(listener.id);
    const forgot = got.filter((e) => e.teller === FORGOT).length;
    expect(forgot / got.length).toBeGreaterThan(0.3);
    expect(forgot / got.length).toBeLessThan(0.7);
    expect(got.every((e) => e.teller === FORGOT || e.teller === w.id)).toBe(true);
  });
});

describe('things that don’t fit', () => {
  /** h watches x in room a for ten minutes. */
  function watch(party: Party, reg: Register, h: number, x: number, room: number, from: number, to: number): void {
    for (let t = from; t <= to; t += 30) {
      party.t = t;
      reg.see(h, party.people[x]!, 'was-in', room);
    }
  }

  it('own eyes beat a stranger’s word: the story gives way and the teller is believed less', () => {
    const { party, reg, guests } = fresh();
    const { a, far } = rooms(reg);
    // h knows x; the teller knows x too, but is a stranger to h.
    const tie = (i: Person, j: Person) => party.ident.tieOf(i.id, j.id);
    let h = guests[0]!;
    let x: Person | undefined;
    let teller: Person | undefined;
    for (const hh of guests) {
      for (const xx of guests) {
        if (xx === hh || tie(hh, xx) < 1) continue;
        teller = guests.find((q) => q !== hh && q !== xx && tie(hh, q) === 0 && tie(q, xx) >= 1);
        if (teller) {
          h = hh;
          x = xx;
          break;
        }
      }
      if (teller) break;
    }
    expect(x && teller).toBeTruthy();
    if (!x || !teller) return;
    watch(party, reg, h.id, x.id, a, 1000, 1600);
    watch(party, reg, teller.id, x.id, far, 1100, 1500);
    const e = reg.entriesOf(teller.id).find((k) => k.who === x.id)!.slot;
    const before = reg.stats.conflicts;
    reg.copyEntry(h.id, teller.id, e);
    expect(reg.stats.conflicts).toBe(before + 1);
    expect(reg.beliefIn(h.id, teller.id)).toBeLessThan(1);
    expect(party.events.some((ev) => ev.kind === 'conflict' && ev.note === 'two-places' && ev.actors[1] === x.id)).toBe(true);
  });

  it('two firm sources that can’t both be true: doubt that it’s really them', () => {
    const { party, reg, guests } = fresh();
    const { a, far } = rooms(reg);
    const h = guests.find((q) => q.partner !== null && !party.people[q.partner]!.staff)!;
    const partner = h.partner!;
    const x = guests.find((q) => q.id !== h.id && q.id !== partner)!;
    party.ident.meet(h.id, x.id);
    party.ident.meet(partner, x.id);
    watch(party, reg, h.id, x.id, a, 1000, 1600);
    watch(party, reg, partner, x.id, far, 1100, 1500);
    const e = reg.entriesOf(partner).find((k) => k.who === x.id)!.slot;
    reg.copyEntry(h.id, partner, e);
    expect(reg.casesOf(h.id).some((c) => c.kind === 'not-themselves' && c.subject === x.id)).toBe(true);
    expect(party.ident.doubtOf(h.id, x.id, party.t)).toBeGreaterThan(0.1);
  });

  it('a claim broken by their own eyes makes them suspicious; vague gossip never contradicts anything', () => {
    const { party, reg, guests } = fresh();
    const { a, far } = rooms(reg);
    const h = guests[0]!;
    const x = guests.find((q) => q.id !== h.id && party.ident.tieOf(h.id, q.id) >= 1 && q.partner !== h.id && !h.friends.includes(q.id))!;
    watch(party, reg, h.id, x.id, a, 1000, 1600);
    // A sighting half an hour wide somewhere else contradicts nothing.
    const vague = guests.find((q) => q !== h && q !== x)!;
    party.t = 1700;
    reg.claim(vague.id, x.id, far, 0, 3600);
    expect(reg.stats.conflicts).toBe(0);
    // "I was out on the terrace all along": they weren't.
    const s0 = party.memory.suspects(h.id, x.id);
    reg.claim(h.id, x.id, far, 1050, 1550);
    expect(reg.stats.broken).toBe(1);
    expect(party.memory.suspects(h.id, x.id)).toBeGreaterThanOrEqual(s0 + 0.09);
  });

  it('a claimed errand explains a sighting, and a thing that turns up closes the case', () => {
    const { party, reg, guests } = fresh();
    const { a } = rooms(reg);
    const [h, owner] = [guests[0]!, guests[1]!];
    const { known: x } = knownAndStranger(party, h.id);
    party.t = 1200;
    const c = reg.open(h.id, 'gone', owner.id, 7, a, 0, 1200);
    reg.see(h.id, party.people[x]!, 'was-in', a);
    expect(pOf(reg, h.id, c, x)).toBeGreaterThan(0.5);
    // "I only went in to fetch it for them."
    reg.claim(h.id, x, a, 900, 1300, 7);
    expect(pOf(reg, h.id, c, x)).toBe(0);
    reg.found(7, a);
    expect(reg.casesOf(h.id).find((k) => k.slot === c)!.state).toBe('closed');
  });
});

describe('who it was', () => {
  it('a stranger seen is a description; meeting them puts a name to it, and the case counts it', () => {
    const { party, reg } = fresh();
    const { a } = rooms(reg);
    // A guest, a stranger to them whose looks only they fit clearly, and an owner.
    let found: { h: Person; x: Person } | null = null;
    for (const h of guestsOf(party)) {
      for (const x of guestsOf(party)) {
        if (x === h || party.ident.tieOf(h.id, x.id)) continue;
        reg.see(h.id, x, 'was-in', a);
        const e = reg.entriesOf(h.id).find((k) => k.who === -1);
        if (!e) continue;
        const others = party.people.filter((q) => q !== h && party.ident.tieOf(h.id, q.id));
        if (others.every((q) => reg.similarity(e.slot, q.id) < 0.5)) {
          found = { h, x };
          break;
        }
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const { h, x } = found!;
    const owner = guestsOf(party).find((q) => q !== h && q !== x)!;
    const c = reg.open(h.id, 'gone', owner.id, -1, a, -600, 600);
    expect(pOf(reg, h.id, c, x.id)).toBe(0);
    party.ident.meet(h.id, x.id);
    reg.met(h.id, x.id);
    expect(reg.entriesOf(h.id).some((e) => e.who === x.id && e.room === a)).toBe(true);
    expect(pOf(reg, h.id, c, x.id)).toBeGreaterThan(0.5);
  });
});

describe('talking about cases', () => {
  it('asking round: whoever saw something says so, and the asker files it under that witness', () => {
    const { party, reg, guests } = fresh();
    const { a } = rooms(reg);
    const [h, owner, w] = [guests[0]!, guests[1]!, guests[2]!];
    const x = guests.find((q) => q.id > 3 && party.ident.tieOf(w.id, q.id) >= 1 && party.ident.tieOf(h.id, q.id) >= 1)!;
    party.t = 600;
    reg.see(w.id, x, 'was-in', a);
    party.t = 900;
    const c = reg.open(h.id, 'gone', owner.id, -1, a, 0, 900);
    const r = reg.askAround(h.id, c, [w.id, owner.id]);
    expect(r.others).toContain(w.id);
    // Both listeners now know of the case; the asker holds w's sighting as w's.
    expect(reg.casesOf(owner.id).some((k) => k.kind === 'gone')).toBe(true);
    expect(reg.entriesOf(h.id).some((e) => e.who === x.id && e.witness === w.id && e.teller === w.id)).toBe(true);
    expect(pOf(reg, h.id, c, x.id)).toBeGreaterThan(0);
  });

  it('own eyes never come back as someone else’s word', () => {
    const { party, reg, guests } = fresh();
    const { a } = rooms(reg);
    const [h, t] = [guests[0]!, guests[1]!];
    const x = guests.find((q) => q.id > 2 && party.ident.tieOf(h.id, q.id) >= 1)!;
    party.t = 600;
    reg.see(h.id, x, 'was-in', a);
    const e = reg.entriesOf(h.id)[0]!.slot;
    const k = reg.copyEntry(t.id, h.id, e);
    expect(reg.copyEntry(h.id, t.id, k)).toBe(-1);
    expect(reg.entriesOf(h.id).filter((v) => v.who === x.id)).toHaveLength(1);
    expect(reg.entriesOf(h.id)[0]!.teller).toBe(OWN);
  });
});

describe('evenings', () => {
  /** Something of the host's goes from a private room at 80 min; one guest was seen poking round it at 75. */
  function theft(seed: string): { party: Party; x: number; room: number } {
    const b = blueprint(seed);
    const room = b.rooms.find((q) => q.type === 'study' || q.type === 'bedroom')!.index;
    const probe = new Party(b, { seed });
    const x = guestsOf(probe)[5]!.id;
    const provoke: Provocation[] = [
      { t: 75 * 60, kind: 'seen', subject: x, room },
      { t: 80 * 60, kind: 'gone', subject: -1, room },
    ];
    return { party: new Party(b, { seed, provoke }), x, room };
  }

  it('with nothing gone, the register stays quiet: no cases, nothing out of place, suspicion as low as before', () => {
    for (const seed of HOUSES) {
      const party = new Party(blueprint(seed), { seed });
      party.advance(PARTY_LENGTH);
      const st = party.stats;
      expect(st.cases, seed).toBe(0);
      expect(st.blames, seed).toBe(0);
      expect(st.conflicts, seed).toBeLessThanOrEqual(3);
      expect(st.claims, seed).toBeGreaterThan(5);
      expect(party.register.stats.filed, seed).toBeGreaterThan(100);
      let max = 0;
      for (const p of party.people) for (const q of party.people) max = Math.max(max, party.memory.suspects(p.id, q.id));
      expect(max, seed).toBeLessThan(0.15);
    }
  }, 120_000);

  it('a planted theft travels, gets asked about, and settles on the one seen there more than on anyone else', () => {
    let blamedX = 0;
    let blamedOthers = 0;
    let asked = 0;
    for (const seed of HOUSES) {
      const { party, x } = theft(seed);
      party.advance(140 * 60);
      const holders = party.people.filter((p) => party.register.casesOf(p.id).some((c) => c.kind === 'gone')).length;
      expect(holders, seed).toBeGreaterThanOrEqual(5);
      asked += party.stats.askedAround;
      for (const e of party.events) if (e.kind === 'blame') e.actors[1] === x ? blamedX++ : blamedOthers++;
    }
    expect(asked).toBeGreaterThan(0);
    expect(blamedX).toBeGreaterThanOrEqual(6);
    expect(blamedX).toBeGreaterThan(2 * blamedOthers);
  }, 120_000);

  it('plants a theft and a sighting live exactly as a replay given them up front', () => {
    const T = 70 * 60;
    const room = bp.rooms.find((q) => q.type === 'bedroom')!.index;
    const seen: Provocation = { t: T, kind: 'seen', subject: 9, room };
    const gone: Provocation = { t: T, kind: 'gone', subject: -1, room };
    const live = new Party(bp, { seed: bp.seed });
    live.advance(T);
    live.plant(seen);
    live.plant(gone);
    live.advance(30 * 60);
    const replay = new Party(bp, { seed: bp.seed, provoke: [seen, gone] });
    replay.advance(T + 30 * 60);
    expect(live.digest()).toBe(replay.digest());
    expect(live.stats).toEqual(replay.stats);
    expect(live.stats.cases).toBeGreaterThan(0);
  }, 60_000);
});
