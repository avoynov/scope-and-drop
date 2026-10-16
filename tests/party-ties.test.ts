import { beforeAll, describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import { CLOSE_FRIEND, CONFRONT, FLIRTING, FRIEND, WATCHFUL } from "../src/party/bonds";
import { SLOTS } from "../src/party/memory";
import { Party } from "../src/party/sim";
import type { Person } from "../src/party/types";

const guestsOf = (party: Party): Person[] => party.people.filter((p) => !p.staff && p.role !== "host");
const mean = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
/** Reach into the bonds for what only the tests set up by hand. */
interface BondsInside {
  formCouple(a: Person, b: Person): void;
}

describe("the cast's ties", () => {
  it("puts about half the guests in couples, and gives the odd stray an eye for a single guest", () => {
    let strays = 0;
    let couples = 0;
    const shares: number[] = [];
    for (const seed of ["gala-night", "match-42", "orangery-1", "manor-7", "villa-3", "house-11"]) {
      const party = new Party(generateMansion({ seed }), { seed });
      const guests = guestsOf(party);
      shares.push(guests.filter((p) => p.partner !== null).length / guests.length);
      couples += guests.filter((p) => p.partner !== null && p.id < p.partner).length;
      const b = party.bonds;
      for (const s of party.people) {
        if (!b.stray[s.id]) continue;
        strays++;
        expect(s.partner, seed).not.toBeNull();
        const e = b.eye[s.id]!;
        if (e < 0) continue;
        const o = party.people[e]!;
        expect(o.partner, seed).toBeNull();
        expect(o.look.sex, seed).not.toBe(s.look.sex);
        expect(b.chem[s.id * party.people.length + e]!, seed).toBeGreaterThanOrEqual(0.75);
        expect(b.chem[e * party.people.length + s.id]!, seed).toBeGreaterThanOrEqual(0.6);
      }
    }
    expect(mean(shares)).toBeGreaterThan(0.3);
    expect(mean(shares)).toBeLessThan(0.7);
    // One couple in ten, give or take: a handful across six evenings, never most couples.
    expect(strays).toBeGreaterThan(0);
    expect(strays).toBeLessThanOrEqual(couples * 0.25);
  });

  it("starts cast friends as friends, partners closest of all", () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "gala-night" });
    const b = party.bonds;
    for (const p of guestsOf(party)) {
      for (const f of p.friends) expect(b.friendOf(p.id, f)).toBeGreaterThanOrEqual(1.3);
      if (p.partner !== null) expect(b.friendOf(p.id, p.partner)).toBeGreaterThan(CLOSE_FRIEND);
    }
  });
});

describe("who may flirt", () => {
  const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "flirt" });
  const b = party.bonds;
  const n = party.people.length;
  const chem = (a: Person, c: Person) => b.chem[a.id * n + c.id]! + b.chem[c.id * n + a.id]!;
  const singles = guestsOf(party).filter((p) => p.partner === null && !party.memory.household[p.id]);

  it("lets two single guests drawn to each other, and keeps the host and the spoken-for out of it", () => {
    const pair = singles.flatMap((a) => singles.filter((c) => c.id > a.id && a.ex !== c.id && chem(a, c) > 0).map((c) => [a, c] as const))[0];
    expect(pair).toBeDefined();
    expect(b.mayFlirt(pair![0], pair![1])).toBe(true);
    const host = party.host;
    for (const s of singles) expect(b.mayFlirt(host, s)).toBe(false);
    const taken = guestsOf(party).find((p) => p.partner !== null && !b.stray[p.id])!;
    for (const s of singles) expect(b.mayFlirt(taken, s)).toBe(false);
    expect(b.mayFlirt(taken, party.people[taken.partner!]!)).toBe(false);
  });

  it("brings a spark up to the flirting line", () => {
    const [a, c] = [singles[0]!, singles.find((q) => q.look.sex !== singles[0]!.look.sex)!];
    b.spark(a.id, c.id);
    expect(b.flirtOf(a.id, c.id)).toBeGreaterThan(FLIRTING - 0.02);
    expect(b.mayFlirt(a, c)).toBe(a.ex !== c.id);
  });
});

describe("doubt about a partner", () => {
  /** A couple of guests, someone else, and a friend of the first who can tell them. */
  const setup = () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "doubt" });
    const b = party.bonds;
    const x = guestsOf(party).find((p) => p.partner !== null && party.people[p.partner]!.role === "guest" && p.friends.some((f) => f !== p.partner))!;
    const y = party.people[x.partner!]!;
    const friend = party.people[x.friends.find((f) => f !== y.id)!]!;
    const other = guestsOf(party).find((q) => q !== x && q !== y && q !== friend && q.partner === null)!;
    return { party, b, x, y, friend, other };
  };

  it("grows on a friend's word, once per teller", () => {
    const { party, b, x, y, friend, other } = setup();
    const m = party.memory;
    expect(b.friendOf(x.id, friend.id)).toBeGreaterThanOrEqual(FRIEND);
    const f = m.fact("cheating", y.id, other.id, -1);
    m.learn(friend.id, f, 1, -1, 0);
    m.tell(x.id, f, friend.id);
    const once = b.doubt(x.id);
    expect(once).toBeGreaterThanOrEqual(WATCHFUL);
    expect(party.events.some((e) => e.kind === "doubt" && e.actors[0] === x.id)).toBe(true);
    // The same teller again adds nothing.
    m.tell(x.id, f, friend.id);
    expect(b.doubt(x.id)).toBeCloseTo(once, 5);
  });

  it("takes a friend's word and another's together past the line to have it out", () => {
    const { party, b, x, y, friend, other } = setup();
    const m = party.memory;
    const f = m.fact("cheating", y.id, other.id, -1);
    m.learn(friend.id, f, 1, -1, 0);
    m.tell(x.id, f, friend.id);
    const second = guestsOf(party).find((q) => q !== x && q !== y && q !== friend && q !== other && party.ident.tieOf(x.id, q.id) >= 2)!;
    m.learn(second.id, f, 1, -1, 0);
    m.tell(x.id, f, second.id);
    expect(b.doubt(x.id)).toBeGreaterThanOrEqual(CONFRONT);
    expect(b.wantsConfront(x)).toBe(true);
  });

  it("doesn't count flirting from before a couple got together as cheating", () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "before" });
    const b = party.bonds;
    const m = party.memory;
    const singles = guestsOf(party).filter((p) => p.partner === null && !party.memory.household[p.id]);
    const a = singles[0]!;
    const c = singles.find((q) => q.look.sex !== a.look.sex)!;
    const d = singles.find((q) => q !== a && q !== c)!;
    // a flirts with d, seen by a witness who knows c; later a and c get together.
    const witness = guestsOf(party).find((q) => q !== a && q !== c && q !== d && party.ident.tieOf(q.id, c.id) >= 2) ?? guestsOf(party).find((q) => q !== a && q !== c && q !== d)!;
    party.ident.bond(witness.id, c.id, 2);
    const f = m.fact("flirting", Math.min(a.id, d.id), Math.max(a.id, d.id), -1);
    m.learn(witness.id, f, 1, -1, 0);
    party.advance(120);
    (b as unknown as BondsInside).formCouple(a, c);
    expect(a.partner).toBe(c.id);
    // Told the old flirting now: news, not cheating, to the witness's friend; and no doubt for c.
    const hearer = guestsOf(party).find((q) => q !== a && q !== c && q !== d && q !== witness)!;
    party.ident.bond(hearer.id, c.id, 2);
    m.tell(hearer.id, f, witness.id);
    const cheating = (i: number) => {
      for (let s = i * SLOTS; s < i * SLOTS + m.held[i]!; s++) if (m.verbOf(m.sFact[s]!) === "cheating") return true;
      return false;
    };
    expect(cheating(hearer.id)).toBe(false);
    m.tell(c.id, f, witness.id);
    expect(b.doubt(c.id)).toBe(0);
  });
});

describe("grudges", () => {
  it("run hotter for a short temper, drink and tension, and halve after a row", () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "grudge" });
    const b = party.bonds;
    const [a, c] = guestsOf(party);
    b.addGrudge(a!.id, c!.id, 0.4);
    const cold = b.heatOf(a!, c!);
    expect(cold).toBeGreaterThan(0);
    a!.tipsy = 0.8;
    expect(b.heatOf(a!, c!)).toBeGreaterThan(cold * 1.7);
    b.temper[a!.id] = b.temper[a!.id]! * 2;
    expect(b.heatOf(a!, c!)).toBeGreaterThan(cold * 3.4);
    const g = b.grudgeOf(a!.id, c!.id);
    b.rowOver(a!, c!, "row");
    expect(b.grudgeOf(a!.id, c!.id)).toBeLessThan(g * 0.55);
    expect(a!.avoid.get(`person:${c!.id}`)).toBeGreaterThan(party.t);
  });
});

describe("evenings of ties", () => {
  const SEEDS = ["gala-night", "match-42", "orangery-1", "manor-7", "villa-3", "house-11", "g", "e"] as const;
  const runs: Party[] = [];

  beforeAll(() => {
    for (const seed of SEEDS) {
      const party = new Party(generateMansion({ seed }), { seed });
      while (!party.over) party.advance(60);
      runs.push(party);
    }
  }, 240_000);

  it("makes friends and the odd couple, mostly once the dancing starts", () => {
    const couples: number[] = [];
    const friendships: number[] = [];
    let late = 0;
    let formed = 0;
    for (const party of runs) {
      const st = party.stats;
      const seed = party.bp.seed;
      expect(st.couples, seed).toBeLessThanOrEqual(4);
      expect(st.friendships, seed).toBeGreaterThanOrEqual(2);
      expect(st.friendships, seed).toBeLessThanOrEqual(14);
      couples.push(st.couples);
      friendships.push(st.friendships);
      for (const e of party.events) {
        if (e.kind !== "bond" || e.note !== "couple") continue;
        formed++;
        const ph = party.programme.find((p) => e.t >= p.start && e.t < p.end)?.id;
        if (ph === "dancing" || ph === "games" || ph === "farewell") late++;
      }
    }
    expect(mean(friendships)).toBeGreaterThanOrEqual(3);
    expect(mean(friendships)).toBeLessThanOrEqual(9);
    expect(mean(couples)).toBeGreaterThan(0.4);
    expect(mean(couples)).toBeLessThan(2);
    if (formed) expect(late / formed).toBeGreaterThanOrEqual(0.7);
  });

  it("has a row or two an evening, and the odd friendship that doesn't survive one", () => {
    const rows = runs.map((p) => p.stats.rows);
    expect(mean(rows)).toBeGreaterThanOrEqual(0.75);
    expect(mean(rows)).toBeLessThanOrEqual(4);
    for (const party of runs) {
      expect(party.stats.rows, party.bp.seed).toBeLessThanOrEqual(10);
      expect(party.stats.fellOut, party.bp.seed).toBeLessThanOrEqual(2);
      expect(party.stats.slipAways, party.bp.seed).toBeLessThanOrEqual(2);
      // Every row is between two people who were there.
      for (const e of party.events) if (e.kind === "row") expect(e.actors.length).toBe(2);
    }
  });

  it("pulls friends onto the floor for a good share of the dancing", () => {
    const starts = runs.reduce((s, p) => s + p.bonds.stats.danceStarts, 0);
    const pulled = runs.reduce((s, p) => s + p.bonds.stats.pulled, 0);
    expect(pulled / starts).toBeGreaterThanOrEqual(0.25);
    expect(pulled / starts).toBeLessThanOrEqual(0.6);
  });

  it("lets staff befriend a guest only now and then", () => {
    const evenings = runs.filter((p) => p.stats.staffFriends > 0).length;
    expect(evenings).toBeLessThanOrEqual(runs.length / 2);
  });

  it("has affairs in some evenings, and never a confrontation short of being sure", () => {
    expect(runs.some((p) => p.stats.affairs > 0)).toBe(true);
    for (const party of runs) {
      const b = party.bonds;
      expect(b.stats.unfounded, party.bp.seed).toBe(0);
      // A lover only for a stray, and at most one.
      for (const p of party.people) if (b.lover[p.id] >= 0) expect(b.stray[p.id]).toBe(1);
      // Everyone who confronts was sure first, and logged it once.
      for (const e of party.events) {
        if (e.kind !== "confront") continue;
        const sure = party.events.filter((d) => d.kind === "doubt" && d.note !== "watchful" && d.actors[0] === e.actors[0]);
        expect(sure.length, `${party.bp.seed} ${e.actors[0]}`).toBe(1);
        expect(sure[0]!.t).toBeLessThanOrEqual(e.t);
      }
    }
  });
});
