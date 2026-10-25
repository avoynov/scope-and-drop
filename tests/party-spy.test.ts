/**
 * The spy, milestone 3 PR 1 "The spy arrives" (technical plan: Tests and the sweep): off means
 * off, one seed gives one evening, casting and the goal odds, what it studied, the record swap,
 * following the programme, the ordinary guest, the exit, programme reactions, and its goldens.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import { Rng } from "../src/mansion/core/rng";
import type { MansionBlueprint } from "../src/mansion/core/types";
import { generateCast } from "../src/party/cast";
import { makeProgramme } from "../src/party/clock";
import { castDramas } from "../src/party/dramas";
import { FEATURES, Ident, TIE_WEIGHT, type Tie } from "../src/party/ident";
import type { Places } from "../src/party/places";
import { Party } from "../src/party/sim";
import { castSpy, goalOdds, GOALS, selfCandidates, studied, type GoalKind, type SpyCast, type SpyOptions, type SpySetup } from "../src/party/spy/cast";
import { DELAY_HEARD, DELAY_OUT, DELAY_SEEN, DELAY_TOLD } from "../src/party/spy/cues";
import type { Person } from "../src/party/types";
import { SOBER, watchSpy, type Check, type SpyEvening } from "./spy-watch";

const MIN = 60;
const bp = generateMansion({ seed: "gala-night" });
/** A party seed whose host has no partner, so every arrival can be pinned in one house. */
const SEED = "spy-1";

// ------------------------------------------------------------------ casting

/** The spy as the party casts it, from the sim's own forks, without the rest of the evening; and whether it could have come as itself. */
function drawCast(house: MansionBlueprint, places: Places, seed: string, opts: SpyOptions = {}): { people: Person[]; cast: SpyCast; root: Rng; canSelf: boolean } {
  const root = new Rng(`party/${seed}`);
  const people = generateCast(root.fork("cast"), places, {});
  const drama = castDramas(root.fork("dramas"), people, makeProgramme(root.fork("programme")), places);
  return { people, cast: castSpy(root.fork("spy").fork("cast"), people, drama, house, places, opts), root, canSelf: selfCandidates(people, drama).length > 0 };
}

describe("casting the spy", () => {
  const HOUSES = ["gala-night", "match-42", "orangery-1"];
  const N = 300;
  const houses = HOUSES.map((seed) => {
    const house = seed === "gala-night" ? bp : generateMansion({ seed });
    return { house, places: new Party(house, { seed }).places };
  });
  const draws = houses.flatMap(({ house, places }, h) => Array.from({ length: N }, (_, i) => ({ house, places, ...drawCast(house, places, `cast-${HOUSES[h]}-${i}`) })));

  it("casts as the party does", () => {
    const party = new Party(bp, { seed: SEED, spy: true });
    const { cast } = drawCast(bp, party.places, SEED);
    expect(party.spy!.id).toBe(cast.record);
    expect(party.spy!.setup).toBe(cast.setup);
    expect(party.spy!.goal.kind).toBe(cast.goal.kind);
  });

  it("comes as itself or as a victim in the plan's shares, the host only when partnerless", () => {
    const got: Record<SpySetup, number> = { self: 0, victim: 0, host: 0, waiter: 0 };
    const want: Record<SpySetup, number> = { self: 0, victim: 0, host: 0, waiter: 0 };
    for (const { people, cast, canSelf } of draws) {
      got[cast.setup]++;
      // The plan's table: itself 55%; else the host in 55% of evenings it has no partner, then a waiter one time in ten, else a guest.
      // An arrival the cast can't give (nobody alone to come as, about one evening in thirty) is drawn as a guest instead.
      const alone = people.find((p) => p.role === "host")!.partner === null;
      want.self += canSelf ? 0.55 : 0;
      want.host += alone ? 0.45 * 0.55 : 0;
      const rest = 0.45 * (alone ? 0.45 : 1);
      want.waiter += rest * 0.1;
      want.victim += rest * 0.9 + (canSelf ? 0 : 0.55);
      if (cast.setup === "host") expect(alone).toBe(true);
    }
    expect(draws.filter((d) => !d.canSelf).length / draws.length).toBeLessThan(0.05);
    for (const s of Object.keys(got) as SpySetup[]) expect(Math.abs(got[s] - want[s]) / draws.length, s).toBeLessThan(0.05);
  });

  it("draws its goal by the house's odds, a kill stealing first half the time, never a staff target", () => {
    const got = Object.fromEntries(GOALS.map((g) => [g, 0])) as Record<GoalKind, number>;
    const want = Object.fromEntries(GOALS.map((g) => [g, 0])) as Record<GoalKind, number>;
    let kills = 0;
    let thefts = 0;
    for (const { house, places, people, cast } of draws) {
      got[cast.goal.kind]++;
      const odds = goalOdds(house, places);
      for (const g of GOALS) want[g] += odds[g];
      const t = cast.goal.target;
      if (cast.goal.kind === "kill" || cast.goal.kind === "bag") {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(people[t]!.staff).toBe(false);
        expect(t).not.toBe(cast.record);
        if (cast.goal.kind === "bag") expect(people[t]!.role).not.toBe("host");
      } else expect(t).toBe(-1);
      if (cast.goal.kind === "kill") {
        kills++;
        if (cast.goal.first) thefts++;
      } else expect(cast.goal.first).toBeNull();
      // A theft from a bag, or a bag goal, makes sure the target has a bag at the door.
      expect(cast.bagFor).toBe(cast.goal.kind === "bag" || cast.goal.first?.from === "bag" ? t : -1);
    }
    for (const g of GOALS) expect(Math.abs(got[g] - want[g]) / draws.length, g).toBeLessThan(0.05);
    expect(Math.abs(thefts / kills - 0.5)).toBeLessThan(0.05);
  });

  it("follows the lab's odds and steal, and never draws a goal at 0 or one the house can't hold", () => {
    const { house, places } = houses[0]!;
    const odds = { kill: 50, bug: 0, ledger: 0 };
    const want = goalOdds(house, places, odds);
    const got = Object.fromEntries(GOALS.map((g) => [g, 0])) as Record<GoalKind, number>;
    let kills = 0;
    let thefts = 0;
    for (let i = 0; i < N; i++) {
      const { cast } = drawCast(house, places, `cast-${i}`, { odds, steal: 0.8 });
      got[cast.goal.kind]++;
      if (cast.goal.kind === "kill") {
        kills++;
        if (cast.goal.first) thefts++;
      }
    }
    expect(got.bug + got.ledger).toBe(0);
    for (const g of GOALS) expect(Math.abs(got[g] / N - want[g]), g).toBeLessThan(0.05);
    expect(Math.abs(thefts / kills - 0.8)).toBeLessThan(0.07);
    // A house with no safe in a study: the safe is never drawn, and pinning it draws as usual instead.
    const bare = generateMansion({ seed: "sweep-compact-6", size: "compact" });
    const barePlaces = new Party(bare, { seed: "bare" }).places;
    expect(goalOdds(bare, barePlaces).safe).toBe(0);
    for (let i = 0; i < 100; i++) {
      expect(drawCast(bare, barePlaces, `cast-${i}`).cast.goal.kind).not.toBe("safe");
      expect(drawCast(bare, barePlaces, `cast-${i}`, { goal: "safe" }).cast.goal.kind).not.toBe("safe");
    }
  });

  it("plays someone close to its own height, and studies their people by how close they are", () => {
    const CHANCE: Partial<Record<Tie, number>> = { 2: 0.1, 3: 0.35, 4: 0.5, 5: 0.9 };
    const seen = new Map<string, { n: number; studied: number; want: number }>();
    for (const { people, cast, root } of draws) {
      if (cast.setup === "self") {
        expect(cast.victim).toBe(-1);
        expect(cast.body).toBeNull();
        expect(cast.garment).toBeNull();
        continue;
      }
      expect(cast.victim).toBe(cast.record);
      expect(Math.abs(cast.own.height - people[cast.record]!.look.height)).toBeLessThanOrEqual(0.155);
      expect(cast.body!.t).toBeLessThan(0);
      const ident = new Ident(people, root.fork("ident"));
      const tieOf = (i: number, j: number) => ident.tieOf(i, j);
      const s = studied(cast, people, tieOf);
      for (let j = 0; j < people.length; j++) {
        if (j === cast.record) continue;
        const tie = tieOf(cast.record, j);
        const key = cast.setup === "host" && people[j]!.staff ? "staff" : `tie ${tie}`;
        const want = key === "staff" ? 0.8 : (CHANCE[tie] ?? 0);
        const row = seen.get(key) ?? { n: 0, studied: 0, want };
        row.n++;
        if (s.knows[j] === 2) {
          row.studied++;
          expect(s.close[j]).toBeCloseTo(TIE_WEIGHT[tie]!, 5);
        }
        seen.set(key, row);
      }
    }
    for (const [key, r] of seen) {
      if (r.want === 0) expect(r.studied, key).toBe(0);
      else if (r.n >= 100) expect(Math.abs(r.studied / r.n - r.want), key).toBeLessThan(0.05);
    }
  });
});

// ------------------------------------------------------------------ the record swap

describe("the record swap", () => {
  it("leaves everyone remembering the victim, and shows the spy's height, habits and temper in the victim's clothes", () => {
    const plain = new Party(bp, { seed: SEED });
    const party = new Party(bp, { seed: SEED, spy: { setup: "victim", goal: "bug" } });
    const spy = party.spy!;
    const j = spy.id;
    const p = party.people[j]!;
    const was = plain.people[j]!;
    const n = party.people.length;
    expect(spy.victim).toBe(j);
    // Who the record is to everyone else stays.
    expect(p.name).toBe(was.name);
    expect(p.role).toBe(was.role);
    expect(p.seat).toBe(was.seat);
    expect(p.coat).toBe(was.coat);
    expect(p.partner).toBe(was.partner);
    expect(p.friends).toEqual(was.friends);
    expect(p.look.outfit).toBe(was.look.outfit);
    for (let i = 0; i < n; i++) expect(party.ident.tieOf(i, j)).toBe(plain.ident.tieOf(i, j));
    // Everyone's memory of them is the victim's...
    for (let i = 0; i < n; i++) {
      const at = (i * n + j) * FEATURES;
      expect(Array.from(party.ident.memLook.subarray(at, at + FEATURES))).toEqual(Array.from(plain.ident.memLook.subarray(at, at + FEATURES)));
    }
    // ...while what they see is the spy: its height, its habits, its temper.
    expect(p.look.height).toBe(spy.own.height);
    expect(party.ident.look[j * FEATURES]).not.toBe(plain.ident.look[j * FEATURES]);
    for (const q of spy.own.quirks) expect(p.quirks).toContain(q);
    expect(party.bonds.temper[j]).toBeCloseTo(spy.own.temper, 5);
  });

  it("makes the victim's partner doubt them over the first hour", () => {
    const plain = new Party(bp, { seed: SEED });
    // Pin a victim with a partner at the party (castSpy drops a pin it can't play).
    let party: Party | null = null;
    for (const c of plain.people.filter((q) => q.role === "guest" && q.partner !== null && plain.people[q.partner]!.role !== "host")) {
      const x = new Party(bp, { seed: SEED, spy: { setup: "victim", target: c.id } });
      if (x.spy!.id === c.id) {
        party = x;
        break;
      }
    }
    expect(party).not.toBeNull();
    const spy = party!.spy!;
    const partner = spy.record.partner!;
    let most = 0;
    let doubtedAt = -1;
    while (party!.t < 60 * MIN) {
      party!.advance(30);
      const d = party!.ident.doubtOf(partner, spy.id, party!.t);
      if (d > most) most = d;
      if (doubtedAt < 0 && d > 0.05) doubtedAt = party!.t;
    }
    expect(most).toBeGreaterThan(0.2);
    expect(doubtedAt).toBeGreaterThan(0);
    // Without the spy the same partner never doubts them.
    plain.advance(60 * MIN);
    expect(plain.ident.doubtOf(partner, spy.id, plain.t)).toBeLessThan(0.05);
  }, 30_000);
});

// ------------------------------------------------------------------ evenings with a spy

/** The goldens' six pinned evenings in one house, every arrival and goal at least once. */
const GOLDEN: ReadonlyArray<readonly [string, SpySetup, GoalKind]> = [
  ["self-safe", "self", "safe"],
  ["self-statuette", "self", "statuette"],
  ["victim-kill", "victim", "kill"],
  ["victim-bag", "victim", "bag"],
  ["host-bug", "host", "bug"],
  ["waiter-ledger", "waiter", "ledger"],
];
/** Four more evenings in other houses, nothing pinned. */
const MORE: ReadonlyArray<readonly [string, string]> = [
  ["match-42", "spy-2"],
  ["orangery-1", "spy-3"],
  ["villa-3", "spy-4"],
  ["house-11", "spy-5"],
];
const TIMES = [30 * MIN, 75 * MIN, 150 * MIN];

interface Run {
  name: string;
  party: Party;
  ev: SpyEvening;
  digests: string[];
  /** The spy's ties as the evening began: a greeting to anyone else needs a tie made tonight. */
  ties0: Uint8Array;
  /** Whom it knew from its study as it came, and how close it believed them: tonight it only learns more (a name it hadn't, someone greeting it like an old friend). */
  knows0: Uint8Array;
  close0: Float32Array;
}

describe("evenings with a spy", () => {
  const runs: Run[] = [];

  beforeAll(() => {
    const evening = (name: string, house: MansionBlueprint, seed: string, spy: SpyOptions) => {
      const party = new Party(house, { seed, spy });
      const s = party.spy!;
      const ties0 = new Uint8Array(party.people.length).map((_, j) => party.ident.tieOf(s.id, j));
      const knows0 = new Uint8Array(s.knows);
      const close0 = new Float32Array(s.close);
      const digests: string[] = [];
      const at: Check = {
        name: "digests",
        step: (p) => {
          if (TIMES.includes(p.t)) digests.push(p.digest());
          return null;
        },
      };
      runs.push({ name, party, ev: watchSpy(party, [at]), digests, ties0, knows0, close0 });
    };
    for (const [name, setup, goal] of GOLDEN) evening(name, bp, SEED, { setup, goal });
    for (const [house, seed] of MORE) evening(`${house}/${seed}`, generateMansion({ seed: house }), seed, {});
  }, 240_000);

  it("arrives as pinned, and every monitor holds: the exit, the programme, staying sober", () => {
    GOLDEN.forEach(([name, setup, goal], i) => {
      expect(runs[i]!.ev.setup, name).toBe(setup);
      expect(runs[i]!.ev.goal, name).toBe(goal);
    });
    for (const r of runs) expect(r.ev.broken, r.name).toEqual([]);
  });

  it("matches the spy's golden digests", async () => {
    const got = Object.fromEntries(GOLDEN.map(([name], i) => [name, runs[i]!.digests.map((d, k) => `${TIMES[k]}:${d}`)]));
    await expect(`${JSON.stringify(got, null, 2)}\n`).toMatchFileSnapshot("./golden/spy-digests.json");
  });

  it("gives the same evening for the same seed, and a provocation planted live matches one given up front", () => {
    const again = new Party(bp, { seed: SEED, spy: { setup: "victim", goal: "kill" } });
    const first = runs[GOLDEN.findIndex(([n]) => n === "victim-kill")]!;
    TIMES.forEach((t, k) => {
      again.advance(t - again.t);
      expect(again.digest()).toBe(first.digests[k]);
    });
    const spyId = first.party.spy!.id;
    const T = 50 * MIN;
    const rumour = { t: T, subject: spyId };
    const grudge = { t: T, kind: "grudge" as const, subject: spyId };
    const live = new Party(bp, { seed: SEED, spy: { setup: "victim", goal: "kill" } });
    live.advance(T);
    live.plant(rumour);
    live.plant(grudge);
    live.advance(20 * MIN);
    const upFront = new Party(bp, { seed: SEED, spy: { setup: "victim", goal: "kill" }, provoke: [rumour, grudge] });
    upFront.advance(T + 20 * MIN);
    expect(live.digest()).toBe(upFront.digest());
  }, 60_000);

  it("follows the programme by its cues: behind the room, never ahead, on the plan's delays", () => {
    const waits = { heard: [] as number[], seen: [] as number[], told: [] as number[], out: [] as number[] };
    const shares: number[] = [];
    for (const r of runs) {
      shares.push(...r.ev.shares);
      // Out of step (the habit), a change heard or seen waits longer; beckoned in, it still comes at once.
      for (const c of r.ev.cues) if (c.how !== "late") waits[c.out ? "out" : (c.how as "heard" | "seen" | "told")].push(c.wait);
      // Playing a waiter, the household keeps it to the programme for now (PR 5). Playing the host, it is prompted at each
      // change and goes by its own announcement, a few seconds after making it.
      if (r.ev.setup === "waiter") expect(r.ev.cues, r.name).toEqual([]);
      if (r.ev.setup === "host") for (const c of r.ev.cues) expect(c.how, r.name).toBe("told");
    }
    expect(waits.heard.length).toBeGreaterThan(20);
    expect(waits.seen.length).toBeGreaterThan(5);
    for (const w of waits.heard) (expect(w).toBeGreaterThanOrEqual(DELAY_HEARD[0]), expect(w).toBeLessThanOrEqual(DELAY_HEARD[1] + 0.5));
    for (const w of waits.seen) (expect(w).toBeGreaterThanOrEqual(DELAY_SEEN[0]), expect(w).toBeLessThanOrEqual(DELAY_SEEN[1] + 0.5));
    for (const w of waits.told) expect(w).toBeLessThanOrEqual(DELAY_TOLD[1] + 0.5);
    for (const w of waits.out) (expect(w).toBeGreaterThanOrEqual(DELAY_OUT[0]), expect(w).toBeLessThanOrEqual(DELAY_OUT[1] + 0.5));
    // After most of the guests in its room, on average.
    expect(shares.reduce((a, b) => a + b, 0) / shares.length).toBeGreaterThan(0.5);
  });

  it("lives the evening as an ordinary guest: sober, and warm only to those it believes close", () => {
    for (const r of runs) {
      const spy = r.party.spy!;
      expect(r.ev.tipsyMax, r.name).toBeLessThan(SOBER);
      // As itself it studied nobody; playing someone, those it studied are the victim's people, as close as their tie. It
      // believes them no less close by the end.
      for (let j = 0; j < spy.knows.length; j++) {
        if (r.knows0[j] === 2) expect(r.close0[j]).toBeCloseTo(TIE_WEIGHT[r.ties0[j]!]!, 5);
        expect(spy.close[j]).toBeGreaterThanOrEqual(r.close0[j]!);
      }
      if (spy.setup === "self") expect(spy.knows.includes(2)).toBe(false);
      const believes = (j: number) => spy.close[j]! >= 0.5 || r.party.ident.tieOf(spy.id, j) > r.ties0[j]!;
      for (const e of r.party.events) {
        if (e.kind !== "greet") continue;
        const [a, b] = e.actors as [number, number];
        if (a === spy.id) expect(believes(b), `${r.name} greets ${b}`).toBe(true);
        if (e.note === "kiss" && (a === spy.id || b === spy.id)) expect(believes(a === spy.id ? b : a), `${r.name} kiss`).toBe(true);
      }
      if (spy.setup === "self")
        expect(
          r.party.events.some((e) => e.kind === "greet" && e.actors[0] === spy.id && !believes(e.actors[1]!)),
          r.name,
        ).toBe(false);
    }
  });

  it("goes home among the first half of the farewell's leavers, never before its first goodbye", () => {
    const shares: number[] = [];
    for (const r of runs) {
      expect(r.ev.byeAt, r.name).toBeGreaterThanOrEqual(0);
      expect(r.ev.goingAt, r.name).toBeGreaterThanOrEqual(r.ev.byeAt);
      expect(r.ev.leftAt, r.name).toBeGreaterThan(r.ev.goingAt);
      // Its goal done by the first goodbye, it goes for that; otherwise it gives the goal up then.
      const done = r.party.spy!.goal.doneAt;
      expect(r.ev.exitWhy, r.name).toBe(done !== null && done <= r.ev.byeAt ? "done" : "gave-up");
      expect(r.ev.goingShare, r.name).toBeLessThanOrEqual(0.6);
      shares.push(r.ev.goingShare);
    }
    // Drawn evenly over the first half, not bunched at the very first goodbyes.
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    expect(mean).toBeGreaterThan(0.1);
    expect(mean).toBeLessThan(0.4);
  });
});

// ------------------------------------------------------------------ rows

describe("the spy in a row", () => {
  it("never strikes, and answers anyone's grudge with an apology", () => {
    const first = new Party(bp, { seed: SEED, spy: { setup: "victim", goal: "bag" } });
    const spyId = first.spy!.id;
    // Everyone takes against the spy at half past seven.
    const grudges = first.people.filter((q) => !q.staff && q.role === "guest" && q.id !== spyId).map((q) => ({ t: 30 * MIN, kind: "grudge" as const, subject: spyId, witness: q.id }));
    const party = new Party(bp, { seed: SEED, spy: { setup: "victim", goal: "bag" }, provoke: grudges });
    party.advance(150 * MIN);
    const rows = party.events.filter((e) => e.kind === "row" && e.actors.includes(spyId));
    expect(rows.length).toBeGreaterThan(0);
    for (const e of rows) {
      if (e.actors[1] === spyId) expect(e.note).toBe("spat");
      if (e.actors[0] === spyId) expect(e.note!.startsWith("act") || e.note!.startsWith("scuffle")).toBe(false);
    }
    expect(party.bonds.stats.apologies).toBeGreaterThan(0);
  }, 60_000);
});

// ------------------------------------------------------------------ reactions

describe("people reacting to someone out of step", () => {
  for (const spy of [false, true] as const) {
    it(`beckon a guest kept from dinner in, and bring a flute to one with nothing to raise ${spy ? "with" : "without"} a spy`, () => {
      const party = new Party(bp, { seed: SEED, spy: spy ? { setup: "self", goal: "bug" } : false });
      const dinner = party.programme.find((p) => p.id === "dinner")!;
      const toast = party.programme.find((p) => p.id === "toast")!;
      party.advance(toast.end - party.t);
      // Flutes brought in the toast's ring: each to someone with nothing in hand, who then has champagne.
      const flutes = party.events.filter((e) => e.kind === "react" && e.note === "glass");
      expect(flutes.length).toBeGreaterThan(0);
      for (const e of flutes) expect(party.people[e.actors[1]!]!.drinkLog.some((d) => d.drink === "champagne" && d.t >= e.t)).toBe(true);
      // From three and a half minutes into dinner, a seated guest is sent on an errand while a partner or friend at the table can see them.
      party.advance(dinner.start + 210 - party.t);
      const seated = (q: Person) => q.present && q.action?.id === "dinner" && q.action.startedAt !== null;
      // (Called in once a phase: not someone already called in to the table.)
      const called = (q: Person) => party.events.some((e) => e.kind === "react" && e.actors[1] === q.id && e.t >= dinner.start && /beckon|point/.test(e.note ?? ""));
      const watched = (skip: ReadonlySet<number>) =>
        party.people.find(
          (q) =>
            !q.staff &&
            q.role === "guest" &&
            q.id !== party.spyId &&
            !skip.has(q.id) &&
            seated(q) &&
            !called(q) &&
            [...(q.partner !== null ? [q.partner] : []), ...q.friends].some((j) => seated(party.people[j]!) && party.canSee(party.people[j]!, q)),
        );
      // Walking to the bar they can pass out of everyone's sight before anyone looks round (every 10 s), so up to five try.
      const bar = party.places.bars[0]!;
      const tried = new Set<number>();
      let p: Person | undefined;
      let call: (typeof party.events)[number] | undefined;
      for (let k = 0; k < 5 && !call; k++) {
        while (!watched(tried) && party.t < dinner.start + 10 * MIN) party.advance(15);
        p = watched(tried);
        if (!p) break;
        tried.add(p.id);
        party.end(p, false);
        expect(party.tasks.errand("drink", p, p, -1, bar, p)).not.toBeNull();
        const from = party.events.length;
        party.advance(15);
        call = party.events.slice(from).find((e) => e.kind === "react" && e.actors[1] === p!.id && /beckon|point/.test(e.note ?? ""));
      }
      expect(call?.note).toMatch(/beckon|point/);
      p = party.people[call!.actors[1]!]!;
      // Called in, they drop the errand and go back to the table.
      party.advance(30);
      expect(party.tasks.of(p)?.kind).not.toBe("errand");
      expect(p.action?.id).toBe("dinner");
    }, 30_000);
  }
});
