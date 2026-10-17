import { beforeAll, describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import { CARD_IDS, type Habit } from "../src/party/dramas";
import { Party } from "../src/party/sim";
import type { Person } from "../src/party/types";

const guestsOf = (party: Party): Person[] => party.people.filter((p) => !p.staff && p.role !== "host");
const mean = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
const MIN = 60;

/** A guest present and free to be drawn into something, in a room. */
function freeGuest(party: Party, ok: (p: Person) => boolean = () => true): Person {
  const p = guestsOf(party).find((q) => party.free(q) && q.room >= 0 && ok(q));
  if (!p) throw new Error("nobody free");
  return p;
}

describe("casting the trouble", () => {
  const SEEDS = ["gala-night", "match-42", "orangery-1", "manor-7", "villa-3", "house-11", "a", "b", "c", "d"] as const;
  const parties = SEEDS.map((seed) => new Party(generateMansion({ seed }), { seed }));

  it("seeds 0 to 2 oddballs and deals 3 to 6 cards the house can hold", () => {
    for (const party of parties) {
      const d = party.dramas;
      const seed = party.bp.seed;
      expect(d.oddballs.length, seed).toBeLessThanOrEqual(2);
      expect(d.stats.dealt, seed).toBeGreaterThanOrEqual(3);
      expect(d.stats.dealt, seed).toBeLessThanOrEqual(6);
      for (const s of d.slots) {
        expect(CARD_IDS).toContain(s.card);
        if (s.card === "piano")
          expect(
            party.places.games.some((g) => g.kind === "piano"),
            seed,
          ).toBe(true);
        if (s.card === "fuse") expect(party.places.danceRoom, seed).toBeTruthy();
      }
      for (const o of d.oddballs) {
        const p = party.people[o.who]!;
        expect(p.staff || p.role === "host", seed).toBe(false);
        expect(d.habit[o.who]).toBe(o.habit);
      }
    }
    expect(parties.some((p) => p.dramas.oddballs.length > 0)).toBe(true);
  });

  it("brings the latecomer in after the toast, alone of everyone", () => {
    for (const party of parties) {
      const late = party.dramas.oddballs.find((o) => o.habit === "latecomer");
      const toastEnd = party.programme.find((ph) => ph.id === "toast")!.end;
      for (const p of guestsOf(party)) {
        if (p.id === late?.who) expect(p.arriveAt).toBeGreaterThan(toastEnd);
        else if (late && p.id !== party.dramas.stranger) expect(p.arriveAt).toBeLessThan(40 * MIN);
      }
    }
  });

  it("makes the stranger someone nobody here knows", () => {
    let strangers = 0;
    for (const party of parties) {
      const s = party.dramas.stranger;
      if (s < 0) continue;
      strangers++;
      const p = party.people[s]!;
      expect(p.friends).toEqual([]);
      expect(p.partner).toBeNull();
      expect(p.regular).toBe(false);
      for (const q of party.people) expect(q.friends).not.toContain(s);
    }
    expect(strangers).toBeLessThan(parties.length);
  });
});

describe("mishaps", () => {
  it("spills a drink down someone: a stain the drink's colour, a grudge, then a change of clothes or a dab at the bar", () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "spill" });
    party.advance(24 * MIN);
    const v = freeGuest(party, (p) => !p.stain);
    expect(party.dramas.mishap("spill", v, undefined, true)).toBe(true);
    expect(v.stain).not.toBeNull();
    const by = [...party.events].reverse().find((e) => e.kind === "mishap" && e.note === "spill")!;
    expect(by.actors[0]).toBe(v.id);
    if (by.actors.length > 1) expect(party.bonds.grudgeOf(v.id, by.actors[1]!)).toBeGreaterThan(0.3);
    const ep = party.dramas.episodeOf(v)!;
    expect(ep.what).toBe("spill");
    party.advance(15 * MIN);
    // Either in something of the host's, the stain gone with the shirt, or still stained after a dab.
    if (party.dramas.changed(v)) expect(v.stain).toBeNull();
    else expect(v.stain).not.toBeNull();
    expect(ep.done).toBe(true);
  });

  it("breaks a glass in someone's hand: glass on the floor, a wash, the kit fetched, and a bandage for the night", () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "cut" });
    party.advance(24 * MIN);
    const p = freeGuest(party);
    expect(party.dramas.mishap("cut", p, undefined, true)).toBe(true);
    const items = party.world.items;
    let broken = 0;
    for (let i = 0; i < items.n; i++) if (items.kindOf(i) === "glass" && items.stateOf(i) === "broken") broken++;
    expect(broken).toBeGreaterThan(0);
    expect(p.held).toBeNull();
    const ep = party.dramas.episodeOf(p)!;
    for (let k = 0; k < 60 && !ep.done; k++) party.advance(30);
    expect(ep.done).toBe(true);
    expect(p.bandage).toBe(true);
    // Once it's over the kit is back on its shelf, and the glass swept up.
    for (let i = 0; i < items.n; i++) if (items.kindOf(i) === "kit") expect(items.stateOf(i)).toBe("shelved");
    let still = 0;
    for (let i = 0; i < items.n; i++) if (items.kindOf(i) === "glass" && items.stateOf(i) === "broken") still++;
    expect(still).toBeLessThan(broken);
    while (!party.over) party.advance(10 * MIN);
    expect(p.bandage).toBe(true);
  });

  it("loses someone's glasses or bag where they sat, and it comes back to them or stays lost, never in someone else's hands", () => {
    const party = new Party(generateMansion({ seed: "orangery-1" }), { seed: "lost" });
    party.advance(24 * MIN);
    const items = party.world.items;
    const mine = (p: Person) => {
      for (let i = 0; i < items.n; i++) if (items.holder[i] === p.id && items.owner[i] === p.id && (items.kindOf(i) === "spectacles" || items.kindOf(i) === "bag")) return i;
      return -1;
    };
    const p = freeGuest(party, (q) => mine(q) >= 0);
    expect(party.dramas.mishap("lost", p, undefined, true)).toBe(true);
    const ep = [...party.dramas.episodes].reverse().find((e) => e.what === "lost")!;
    const it0 = ep.item;
    expect(items.stateOf(it0)).toBe("lost");
    expect(items.holder[it0]).toBe(-1);
    party.advance(45 * MIN);
    expect([p.id, -1]).toContain(items.holder[it0]);
    if (items.holder[it0] === p.id) expect(["worn", "carried"]).toContain(items.stateOf(it0));
  });

  it("puts the lights out for 10 to 30 s when someone leans on the switch", () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "switch" });
    party.advance(25 * MIN);
    const p = freeGuest(party, (q) => party.world.lightOn[q.room] === 1);
    const room = p.room;
    expect(party.dramas.mishap("switch", p, undefined, true)).toBe(true);
    expect(party.world.lightOn[room]).toBe(0);
    party.advance(40);
    expect(party.world.lightOn[room]).toBe(1);
  });

  it("draws exactly one number per person per check from the mishap stream, whatever happens", () => {
    const party = new Party(generateMansion({ seed: "match-42" }), { seed: "match-42" });
    party.advance(40 * MIN);
    const s = party.dramas.stats;
    expect(s.rolls).toBe(s.checks * party.people.length);
  });
});

describe("small dramas", () => {
  it("blows the fuse: the dance floor's storey dark for 20 to 40 s, the band and the dancers standing still", () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "fuse" });
    const dancing = party.programme.find((ph) => ph.id === "dancing")!;
    party.advance(dancing.start + 6 * MIN);
    const room = party.places.danceRoom!.index;
    expect(party.dramas.play("fuse")).toBe(true);
    expect(party.world.lightOn[room]).toBe(0);
    party.advance(2);
    for (const p of party.people)
      if (p.present && p.level === party.places.danceRoom!.level && (p.action?.id === "dance" || p.role === "musician") && p.action?.startedAt != null)
        expect(["stand", "walk", "climb"]).toContain(p.pose);
    party.advance(45);
    expect(party.world.lightOn[room]).toBe(1);
  });

  it("has a couple quarrel, then one storm off or shut themselves in a bathroom", () => {
    const party = new Party(generateMansion({ seed: "match-42" }), { seed: "quarrel" });
    const mingle2 = party.programme[4]!;
    party.advance(mingle2.start + 3 * MIN);
    const a = guestsOf(party).find((p) => p.partner !== null && party.free(p) && party.free(party.people[p.partner]!) && party.people[p.partner]!.role !== "host");
    expect(a).toBeDefined();
    expect(party.dramas.play("quarrel", a)).toBe(true);
    const b = party.people[a!.partner!]!;
    expect([a!.action?.note, b.action?.note].sort()).toEqual(["answer", "quarrel"]);
    party.advance(3 * MIN);
    const notes = party.events.filter((e) => e.kind === "drama").map((e) => e.note);
    expect(notes.some((n) => n === "quarrel:storms-off" || n === "quarrel:bathroom")).toBe(true);
  });

  it("stands someone up at dinner for a speech that runs long", () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "speech" });
    const dinner = party.programme.find((ph) => ph.id === "dinner")!;
    party.advance(dinner.start + (dinner.end - dinner.start) * 0.4);
    const p = party.people.find((q) => !q.staff && q.role !== "host" && q.action?.id === "dinner" && q.pose === "sit");
    expect(p).toBeDefined();
    expect(party.dramas.play("speech", p)).toBe(true);
    party.advance(2);
    expect(p!.pose).toBe("announce");
    party.advance(3 * MIN);
    expect(party.events.some((e) => e.kind === "drama" && e.note === "speech:end")).toBe(true);
  });
});

describe("oddballs at it", () => {
  it("has each habit do its thing in an evening", () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "oddballs" });
    const d = party.dramas;
    // Hand out the habits that go out by hand, on guests who aren't oddballs already.
    const picks = guestsOf(party).filter((p) => !d.habit[p.id] && p.archetype === null && p.id !== d.stranger);
    const want: Habit[] = ["creep", "wanderer", "snoop", "nervous"];
    want.forEach((habit, k) => {
      const p = picks[k]!;
      d.habit[p.id] = habit;
      const at = habit === "nervous" ? [] : [40, 75, 100, 120, 140, 160].map((m) => m * MIN + k * 90);
      d.oddballs.push({ who: p.id, habit, at });
    });
    while (!party.over) party.advance(10 * MIN);
    const notes = party.events.filter((e) => e.kind === "habit").map((e) => e.note ?? "");
    expect(notes.some((n) => n.startsWith("creep"))).toBe(true);
    expect(notes.some((n) => n.startsWith("wanderer"))).toBe(true);
    expect(notes).toContain("snoop");
    expect(d.stats.startles).toBeGreaterThan(0);
  }, 60_000);
});

describe("evenings of trouble", () => {
  const SEEDS = ["gala-night", "match-42", "orangery-1", "manor-7", "villa-3", "house-11", "b", "f"] as const;
  const runs: Party[] = [];

  beforeAll(() => {
    for (const seed of SEEDS) {
      const party = new Party(generateMansion({ seed }), { seed });
      while (!party.over) party.advance(60);
      runs.push(party);
    }
  }, 240_000);

  it("has 2 to 8 mishaps an evening on average, never a pile-up", () => {
    const n = runs.map((p) => p.stats.mishaps);
    expect(mean(n)).toBeGreaterThanOrEqual(2);
    expect(mean(n)).toBeLessThanOrEqual(8);
    for (const party of runs) expect(party.stats.mishaps, party.bp.seed).toBeLessThanOrEqual(15);
  });

  it("plays 3 to 6 dramas an evening, each seen by someone", () => {
    for (const party of runs) {
      const seed = party.bp.seed;
      expect(party.stats.dramas, seed).toBeGreaterThanOrEqual(3);
      expect(party.stats.dramas, seed).toBeLessThanOrEqual(6);
      expect(party.dramas.unseen, seed).toBe(0);
    }
  });

  it("lets nobody see an oddball at it never", () => {
    for (const party of runs) for (const o of party.dramas.oddballs) expect(party.dramas.habitSeen[o.who], `${party.bp.seed} ${o.habit}`).toBeGreaterThan(0);
  });

  it("keeps every bandage on to the end, and leaves no mishap or drama hanging", () => {
    for (const party of runs) {
      const seed = party.bp.seed;
      const d = party.dramas;
      expect(party.people.filter((p) => p.bandage).length, seed).toBe(d.stats.bandaged);
      for (const e of d.episodes) if (!e.done) expect(PARTY_END - e.started, `${seed} ${e.what}:${e.stage}`).toBeLessThan(45 * MIN);
      // Lost things are back with their owner or still lost: never left in someone else's hands.
      const items = party.world.items;
      for (let i = 0; i < items.n; i++) {
        const k = items.kindOf(i);
        if (k === "spectacles" || k === "bag" || k === "earring") expect([items.owner[i], -1], seed).toContain(items.holder[i]);
      }
    }
  });
});

const PARTY_END = 3 * 3600;
