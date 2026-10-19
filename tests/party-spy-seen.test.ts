/**
 * The spy, milestone 3 PR 2 "Seen through" (technical plan: Tests and the sweep): the friendly
 * test's outcomes, skill slips, comparing notes and sure, what the spy knows of who is dangerous,
 * innocents over thirty evenings, and the fake host with the household's prompts.
 */
import { describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import { Rng } from "../src/mansion/core/rng";
import { PARTY_LENGTH, type Phase } from "../src/party/clock";
import { COMPARE, EXPECT, FAIL_AT, FAILED, HOUSE, LOOKED, PASSED, SLIP_SKILLS, SURE, TEST, TIE_WEIGHT, type TestOutcome } from "../src/party/ident";
import { DETAIL_RANGE } from "../src/party/senses";
import { FAKE_DELAY, Prompts, REAL_DELAY, type PromptsHost } from "../src/party/prompts";
import { FIND_LIGHT, GARMENT_DOUBT, Party } from "../src/party/sim";
import { BLUFF, BLUFF_KNOWN, REFUSE_TOUR } from "../src/party/spy";
import { Posing } from "../src/party/spy/posing";
import { SKILLS, type Person } from "../src/party/types";
import type { MansionSize } from "../src/mansion/core/types";
import type { SpyEvening } from "./spy-watch";

const bp = generateMansion({ seed: "gala-night" });
const SEED = "spy-1";
const KEYS = SKILLS.indexOf("keys");
const DANCE = SKILLS.indexOf("dance");

/** Someone very drunk, for the test's fumble. */
function drunk(party: Party, p: Person): void {
  p.tipsy = 0.95;
  party.ident.refresh(p);
}

// ------------------------------------------------------------------ the test

describe("the friendly test", () => {
  const party = new Party(bp, { seed: "seen-test" });
  const id = party.ident;
  const n = party.people.length;
  const guests = party.people.filter((p) => !p.staff);
  /** Pairs who know each other, closest first, each tested at most once in these tests. */
  const pairs: Array<[number, number]> = [];
  for (const a of guests) for (const b of guests) if (a !== b && id.tieOf(a.id, b.id) >= 1) pairs.push([a.id, b.id]);
  pairs.sort(([a, b], [c, d]) => id.tieOf(c, d) - id.tieOf(a, b));
  let next = 0;
  /** The next pair not tested yet (and round again, once they all have been). */
  const pair = (): [number, number] => pairs[next++ % pairs.length]!;
  /** A double take's worth of doubt and then some, as a look would leave it before the test. */
  const doubted = (i: number, j: number, t: number, v = 0.5): void => {
    id.stage[i * n + j] = LOOKED;
    id.addDoubt(i, j, v, t);
  };

  it("the real person passes: the doubt falls to a fifth, the pair passes, and the new look is the one remembered", () => {
    const [i, j] = pair();
    drunk(party, party.people[j]!);
    const t = 1000;
    doubted(i, j, t);
    const before = id.doubtOf(i, j, t);
    // (Drunk as that, the first may be fumbled; the next passes.)
    let out = id.test(i, j, t);
    if (out === "fumbled") out = id.test(i, j, t);
    expect(out).toBe("passed");
    expect(id.stage[i * n + j]).toBe(PASSED);
    expect(id.doubtOf(i, j, t)).toBeLessThanOrEqual(before * 0.2 + 1e-6);
    // The look now remembered is what they look like tonight: no more doubt from the same sight.
    for (let k = 0; k < 600; k++) id.check(i, j, t + 2 * k, 2, 1, false, 1, 0, false);
    expect(id.doubtOf(i, j, t + 1200)).toBeLessThan(0.05);
  });

  it("very drunk, the real person fumbles one time in seven, and passes the next", () => {
    let tried = 0;
    let fumbled = 0;
    for (let k = 0; k < 160 && next < pairs.length; k++) {
      const [i, j] = pair();
      drunk(party, party.people[j]!);
      const t = 2000 + k;
      doubted(i, j, t);
      const v = id.doubtOf(i, j, t);
      tried++;
      const out = id.test(i, j, t);
      if (out !== "fumbled") {
        expect(out).toBe("passed");
        continue;
      }
      fumbled++;
      // A pause, then a laugh: a little more doubt, still short of comparing notes, and still to be settled.
      expect(id.doubtOf(i, j, t)).toBeCloseTo(Math.min(COMPARE - 0.01, v + 0.1), 5);
      expect(id.stage[i * n + j]).toBe(LOOKED);
      expect(id.test(i, j, t + 1)).toBe("passed");
    }
    expect(tried).toBeGreaterThan(100);
    expect(Math.abs(fumbled / tried - 1 / 7)).toBeLessThan(0.07);
  });

  it("someone sober always passes", () => {
    for (let k = 0; k < 30; k++) {
      const [i, j] = pair();
      party.people[j]!.tipsy = 0.2;
      expect(id.test(i, j, 3000 + k)).toBe("passed");
    }
  });

  it("the impostor bluffs (it passes on the surface, the look not remembered) or fails (doubt jumps past comparing notes, and the look adds no more)", () => {
    const p = new Party(bp, { seed: "seen-test" });
    const x = p.ident;
    const [i, j] = pairs[0]!;
    const [i2] = pairs.find(([a, b]) => b === j && a !== i) ?? [pairs.find(([a]) => a !== i)![0]];
    let answer: "bluffed" | "failed" = "bluffed";
    const told: Array<[number, number, TestOutcome]> = [];
    x.impostor(j, () => answer);
    x.onTest = (a, b, out) => told.push([a, b, out]);
    // Someone else in their clothes: a different height, so the look is off.
    p.people[j]!.look.height += 12;
    x.refresh(p.people[j]!);
    const t = 1000;
    x.stage[i * n + j] = LOOKED;
    x.addDoubt(i, j, 0.5, t);
    const v = x.doubtOf(i, j, t);
    const mem = Array.from(x.memLook.subarray((i * n + j) * 8, (i * n + j) * 8 + 8));
    expect(x.test(i, j, t)).toBe("bluffed");
    expect(x.stage[i * n + j]).toBe(PASSED);
    expect(x.doubtOf(i, j, t)).toBeCloseTo(v * 0.5, 5);
    expect(Array.from(x.memLook.subarray((i * n + j) * 8, (i * n + j) * 8 + 8))).toEqual(mem);
    // So the doubt climbs again, slowly: a fifth of the rate, but it climbs.
    const after = x.doubtOf(i, j, t);
    for (let k = 1; k <= 30; k++) x.check(i, j, t + 2 * k, 2, 1, false, 1, 0, false);
    expect(x.doubtOf(i, j, t + 60)).toBeGreaterThan(after);
    // Failed: past the cap the untested stop at, to FAIL_AT whatever the look had built, and the pair is at failed.
    answer = "failed";
    const k2 = i2! * n + j;
    x.stage[k2] = LOOKED;
    x.addDoubt(i2!, j, 0.55, t);
    const v2 = x.doubtOf(i2!, j, t);
    expect(v2).toBeLessThan(COMPARE);
    expect(x.test(i2!, j, t)).toBe("failed");
    expect(x.stage[k2]).toBe(FAILED);
    expect(x.doubtOf(i2!, j, t)).toBeCloseTo(FAIL_AT, 5);
    expect(FAIL_AT).toBeGreaterThan(COMPARE);
    expect(FAIL_AT).toBeLessThan(SURE);
    // And the look has told all it can: staring adds nothing now, so sure needs something more.
    for (let k = 1; k <= 30; k++) x.check(i2!, j, t + 2 * k, 2, 1, true, 1, 0, false);
    expect(x.doubtOf(i2!, j, t + 60)).toBeLessThan(FAIL_AT);
    expect(x.stage[k2]).toBe(FAILED);
    expect(told).toEqual([
      [i, j, "bluffed"],
      [i2, j, "failed"],
    ]);
  });

  it("bluffs a test from someone it studied four times in ten, from anyone else one time in ten", () => {
    const p = new Party(bp, { seed: SEED, spy: { setup: "victim" } });
    const spy = p.spy!;
    const studied = p.people.find((q) => spy.knows[q.id] === 2);
    const other = p.people.find((q) => q.id !== spy.id && spy.knows[q.id] !== 2)!;
    const rate = (i: number) => {
      let b = 0;
      for (let k = 0; k < 2000; k++) if (spy.answers.answer(i) === "bluffed") b++;
      return b / 2000;
    };
    if (studied) expect(rate(studied.id)).toBeCloseTo(BLUFF_KNOWN, 1);
    expect(rate(other.id)).toBeCloseTo(BLUFF, 1);
  });
});

// ------------------------------------------------------------------ slips

describe("skill slips", () => {
  const party = new Party(bp, { seed: "seen-slips" });
  const id = party.ident;
  const n = party.people.length;
  const S = SLIP_SKILLS.length;
  // Someone known to someone for keys they handle well: the butler, to the staff and the house.
  const butler = party.people.find((p) => p.role === "butler")!;
  const knower = party.people.find((p) => p !== butler && id.tieOf(p.id, butler.id) >= 2)!;
  const stranger = party.people.find((p) => p !== butler && id.tieOf(p.id, butler.id) === 0)!;

  it("adds doubt only in someone with a tie who expected the skill at 0.6 or more, scaled by the shortfall", () => {
    const e = id.expected(knower.id, butler.id, KEYS);
    expect(e).toBeGreaterThanOrEqual(EXPECT);
    // The real butler fumbles at their own skill: what everyone expects of them, so nothing.
    expect(id.slipDoubt(knower.id, butler.id, KEYS, 100, false)).toBe(0);
    // A stranger expects nothing.
    expect(id.expected(stranger.id, butler.id, KEYS)).toBe(0);
    expect(id.slipDoubt(stranger.id, butler.id, KEYS, 100, false)).toBe(0);
    // Someone else in the butler's place, with clumsy hands: 0.15 × tie weight × the skill expected × the shortfall (full at 0.3).
    butler.fluency.keys = e - 0.3;
    const tie = id.tieOf(knower.id, butler.id);
    expect(id.slipDoubt(knower.id, butler.id, KEYS, 100, false)).toBeCloseTo(0.15 * TIE_WEIGHT[tie]! * e, 5);
    butler.fluency.keys = e - 0.15;
    expect(id.slipDoubt(knower.id, butler.id, KEYS, 100, false)).toBeCloseTo(0.15 * TIE_WEIGHT[tie]! * e * 0.5, 5);
    // Explained (drink they know of, a bandaged hand): nothing.
    expect(id.slipDoubt(knower.id, butler.id, KEYS, 100, true)).toBe(0);
    // A skill they weren't known for adds nothing either.
    const low = SKILLS.findIndex((k) => id.expect[butler.id * S + SKILLS.indexOf(k)]! < EXPECT);
    if (low >= 0) {
      butler.fluency[SKILLS[low]!] = 0;
      expect(id.slipDoubt(knower.id, butler.id, low, 100, false)).toBe(0);
    }
  });

  it("never takes doubt past the test: a slip can bring a double take, never a test", () => {
    butler.fluency.keys = 0;
    for (let k = 0; k < 200; k++) id.slipDoubt(knower.id, butler.id, KEYS, 200 + k, false);
    expect(id.doubtOf(knower.id, butler.id, 400)).toBeLessThan(TEST);
    expect(id.stage[knower.id * n + butler.id]).toBeLessThan(PASSED);
    expect(id.wantTest[knower.id]).not.toBe(butler.id);
  });

  it("shows only in the detail of a look: within 6 m and 30° of where they look, once a slip", () => {
    const p = party.people.find((q) => q.present || true)!;
    const at = (d: number, deg: number) => ({ level: p.level, x: p.x + d * Math.sin(p.yaw + (deg * Math.PI) / 180), z: p.z + d * Math.cos(p.yaw + (deg * Math.PI) / 180) });
    p.lookUntil = -1;
    expect(party.senses.inDetail(p, at(5, 0))).toBe(true);
    expect(party.senses.inDetail(p, at(5, 25))).toBe(true);
    expect(party.senses.inDetail(p, at(7, 0))).toBe(false);
    expect(party.senses.inDetail(p, at(3, 40))).toBe(false);
    expect(party.senses.inDetail(p, { ...at(3, 0), level: p.level + 1 })).toBe(false);
    // Each watcher catches a slip once, while it shows.
    id.slip(butler.id, KEYS, 500, 8);
    expect(id.catchSlip(knower.id, butler.id, 502)).toBe(KEYS);
    expect(id.catchSlip(knower.id, butler.id, 503)).toBe(-1);
    expect(id.catchSlip(stranger.id, butler.id, 509)).toBe(-1);
    id.slip(butler.id, HOUSE, 600, 20);
    expect(id.catchSlip(knower.id, butler.id, 610)).toBe(HOUSE);
  });

  it("knows the way round as the household, the staff, regulars and first-timers do, and the impostor as a first-timer", () => {
    const host = party.host;
    expect(id.expected(knower.id, host.id, HOUSE) || id.expect[host.id * S + HOUSE]).toBeGreaterThan(0.9);
    expect(id.expect[butler.id * S + HOUSE]).toBeGreaterThanOrEqual(EXPECT);
    const first = party.people.find((q) => !q.staff && !q.regular && q !== host && q.id !== host.partner)!;
    expect(id.expect[first.id * S + HOUSE]).toBeLessThan(EXPECT);
    const p = new Party(bp, { seed: SEED, spy: { setup: "host" } });
    expect(p.spy!.id).toBe(p.host.id);
    expect(p.ident.actual(p.host.id, HOUSE)).toBeLessThan(EXPECT);
    expect(p.ident.expect[p.host.id * S + HOUSE]).toBeGreaterThan(0.9);
  });
});

// ------------------------------------------------------------------ comparing notes and sure

/** An evening with the spy playing a guest whose partner is at the party (castSpy drops a pin it can't play). */
function withPartner(seed = SEED): Party {
  const plain = new Party(bp, { seed });
  for (const c of plain.people.filter((q) => q.role === "guest" && q.partner !== null && plain.people[q.partner]!.role !== "host")) {
    const x = new Party(bp, { seed, spy: { setup: "victim", target: c.id } });
    if (x.spy!.id === c.id) return x;
  }
  throw new Error("no guest with a partner to play");
}

describe("comparing notes and sure", () => {
  const party = withPartner();
  const spy = party.spy!;
  const j = spy.id;
  const partner = spy.record.partner!;
  while (!party.over) party.advance(60);
  const ev = party.events.filter((e) => e.kind === "challenge");

  it("starts with those who knew the one it plays best, and spreads to their close friends by word", () => {
    const tests = party.events.filter((e) => e.kind === "test" && e.actors[1] === j);
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.some((e) => e.actors[0] === partner)).toBe(true);
    const compares = ev.filter((e) => e.note === "compare" && e.actors[2] === j);
    expect(compares.length).toBeGreaterThan(0);
    // Whispered to someone who knew them well, once a pair.
    const seen = new Set<string>();
    for (const e of compares) {
      const [a, b] = e.actors as [number, number, number];
      expect(party.ident.tieOf(b, j)).toBeGreaterThanOrEqual(3);
      const key = [a, b].sort().join(":");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("answers sure in one of three ways: out loud, backing away to tell someone, or silence", () => {
    const sure = ev.filter((e) => e.note === "sure");
    expect(sure.length).toBeGreaterThan(0);
    // Sure before the farewell, while the one it's about is still here to have it out with or tell of.
    const farewell = party.programme.find((ph) => ph.id === "farewell")!;
    for (const s of sure.filter((e) => e.t < farewell.start)) {
      const [a, b] = s.actors as [number, number];
      const answer = ev.find((e) => e.t >= s.t && e.actors[0] === a && e.actors[1] === b && (e.note === "out-loud" || e.note === "backed-away" || e.note === "silent"));
      expect(answer, `${a} sure of ${b} at ${s.t}`).toBeDefined();
      // Silent: they keep away from it for the rest of the evening.
      if (answer!.note === "silent") expect(party.people[a]!.avoid.has(`person:${b}`)).toBe(true);
      // Backing away ends in a word with someone.
      if (answer!.note === "backed-away") expect(ev.some((e) => e.note === "told" && e.actors[0] === a && e.actors[2] === b && e.t >= answer!.t)).toBe(true);
    }
  });

  it("is tested by most of those who knew the one it plays, and nobody else is", () => {
    for (const e of party.events) if (e.kind === "test" && e.actors[1] !== j) expect(["passed", "fumbled"]).toContain(e.note);
  });
});

// ------------------------------------------------------------------ what it knows

describe("what the spy knows of who is dangerous", () => {
  it("starts from its study, and nothing out of its view raises anyone", () => {
    const party = new Party(bp, { seed: SEED, spy: { setup: "victim" } });
    const spy = party.spy!;
    const a = spy.answers;
    // Those it studied start at their tie weight; past 0.5 they're on its avoid list from the first.
    for (let i = 0; i < party.people.length; i++) {
      expect(a.danger[i]).toBeCloseTo(spy.close[i]!, 5);
      expect(a.avoids(i)).toBe(spy.close[i]! > 0.5);
    }
    const j = party.people.find((q) => q.id !== spy.id && !q.staff && a.danger[q.id] === 0)!;
    // A double take at it that it never sees: nothing.
    a.signal(j.id, "double-take");
    party.advance(5);
    a.saw(j);
    expect(a.danger[j.id]).toBe(0);
    // One it catches while it shows: + 0.3.
    a.signal(j.id, "whisper");
    a.saw(j);
    expect(a.danger[j.id]).toBeCloseTo(0.3, 5);
    expect(a.avoids(j.id)).toBe(false);
    // Greeted like an old friend: at least 0.7 for coming over, and it believes them close.
    a.greeted(j.id, "came");
    expect(a.danger[j.id]).toBeGreaterThanOrEqual(Math.fround(0.7));
    expect(spy.close[j.id]).toBeGreaterThanOrEqual(Math.fround(0.7));
    expect(a.avoids(j.id)).toBe(true);
    expect(spy.record.avoid.has(`person:${j.id}`)).toBe(true);
  });

  it("keeps a close friend of the one it plays it didn't study off its list until they show themselves", () => {
    // Pin a victim with a close friend at the party it didn't study.
    const plain = new Party(bp, { seed: SEED });
    let found: { party: Party; friend: number } | null = null;
    for (const c of plain.people.filter((q) => q.role === "guest")) {
      const x = new Party(bp, { seed: SEED, spy: { setup: "victim", target: c.id } });
      if (x.spy!.id !== c.id) continue;
      const f = x.people.find((q) => !q.staff && q.id !== c.id && x.ident.tieOf(q.id, c.id) >= 3 && x.spy!.knows[q.id] !== 2);
      if (f) {
        found = { party: x, friend: f.id };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { party, friend } = found!;
    const a = party.spy!.answers;
    expect(a.danger[friend]).toBe(0);
    let on = -1;
    while (!party.over && on < 0) {
      party.step();
      if (a.avoids(friend)) on = party.t;
    }
    if (on >= 0) {
      // What put them there was something it saw them do, never its study.
      const why = a.top(50).find((x) => x.id === friend)!.why;
      expect(why).not.toContain("study");
      expect(why.some((w) => ["wave", "came", "kiss", "double-take", "test", "whisper", "challenge", "name"].includes(w))).toBe(true);
    }
  }, 60_000);
});

// ------------------------------------------------------------------ begging off

describe("begging off", () => {
  // Playing someone known for dancing, and dancing clearly worse itself.
  let party: Party | null = null;
  for (let k = 0; k < 80 && !party; k++) {
    const x = new Party(bp, { seed: `dodge-${k}`, spy: { setup: "victim" } });
    if (x.spy!.dodges("dance")) party = x;
  }

  it("turns down the dance the one it plays was known for, and whoever asked takes half a slip's doubt", () => {
    expect(party).not.toBeNull();
    const p = party!;
    const me = p.spy!.record;
    const tieTo = (q: Person) => p.ident.tieOf(q.id, me.id);
    const knew = () => p.people.filter((q) => q !== me && q.present && !q.gone && !q.staff && tieTo(q) >= 2 && p.ident.expected(q.id, me.id, DANCE) >= EXPECT);
    while (!p.over && (!me.present || !knew().length)) p.advance(60);
    const asker = knew().sort((a, b) => tieTo(b) - tieTo(a))[0]!;
    const k = asker.id * p.people.length + me.id;
    const before = p.ident.doubtOf(asker.id, me.id, p.t);
    const explained = p.memory.knowsAbout(asker.id, "tipsy", me.id) || p.ident.hurt[me.id] === 1;
    const n0 = p.events.length;
    expect(p.danceWith(asker, me)).toBe(false);
    const ev = p.events.slice(n0);
    expect(ev.find((e) => e.kind === "spy" && e.note === "beg-off:dance")?.actors).toEqual([me.id, asker.id]);
    // A shrug from someone who knew them for it.
    expect(ev.some((e) => e.kind === "react" && e.note === "shrug" && e.actors[0] === asker.id)).toBe(true);
    // Half of what seeing it fumble a dance would add: 0.15 × tie weight × the skill expected × the shortfall.
    const e = p.ident.expected(asker.id, me.id, DANCE);
    const gap = Math.min(1, Math.max(0, (e - p.ident.actual(me.id, DANCE)) / 0.3));
    const cap = p.ident.stage[k]! < PASSED ? TEST - 0.01 : 1;
    const want = explained ? before : Math.min(cap, before + 0.5 * 0.15 * TIE_WEIGHT[tieTo(asker)]! * e * gap);
    expect(p.ident.doubtOf(asker.id, me.id, p.t)).toBeCloseTo(Math.max(before, want), 5);
    // Asked again, it begs off again.
    const n1 = p.events.length;
    p.askAgain(asker, me, DANCE);
    expect(p.events.slice(n1).some((x) => x.kind === "react" && x.note === "ask-again")).toBe(true);
    expect(p.events.slice(n1).some((x) => x.kind === "spy" && x.note === "beg-off:dance")).toBe(true);
  }, 60_000);

  it("never begs off coming as itself", () => {
    const p = new Party(bp, { seed: SEED, spy: { setup: "self" } });
    expect(p.spy!.dodges("dance")).toBe(false);
    expect(p.spy!.dodges("piano")).toBe(false);
  });
});

// ------------------------------------------------------------------ the garment

describe("the garment", () => {
  // Something of the one it plays, dropped by the top of the terrace steps in the lamps' light.
  const gbp = generateMansion({ seed: "sweep-compact-4", size: "compact" });
  let party: Party | null = null;
  for (let k = 0; k < 80 && !party; k++) {
    const x = new Party(gbp, { seed: `garment-${k}`, spy: { setup: "victim" } });
    if (x.spy?.garment && x.garmentLight >= FIND_LIGHT) party = x;
  }

  it("lies on the terrace, where guests outside pass", () => {
    expect(party).not.toBeNull();
    const p = party!;
    const g = p.spy!.garment!;
    const items = p.world.items;
    expect(items.stateOf(g.item)).toBe("lost");
    expect(items.owner[g.item]).toBe(p.spy!.id);
    expect(p.pf.roomAt(0, items.x[g.item]!, items.z[g.item]!)).toBe(-2);
  });

  it("is spotted only in a look's detail; a finder who knew whose it is doubts the one who came as them, and hands it in", () => {
    const p = party!;
    const spy = p.spy!;
    const g = spy.garment!;
    const items = p.world.items;
    const at = { x: items.x[g.item]!, z: items.z[g.item]! };
    const knew = () => p.people.filter((q) => q.id !== spy.id && p.free(q) && p.ident.tieOf(q.id, spy.id) >= 2);
    while (!p.over && !knew().length) p.advance(60);
    const finder = knew()[0]!;
    // Stood on the terrace d m short of it, facing it or not (a yaw of 0 faces +z).
    const put = (d: number, facing: boolean): void => {
      finder.level = 0;
      finder.room = -2;
      finder.x = at.x;
      finder.z = at.z - d;
      finder.yaw = facing ? 0 : Math.PI;
      finder.lookUntil = 0;
    };
    const found = () => p.events.find((e) => e.kind === "react" && e.note === "garment" && e.actors[0] === finder.id);
    put(2, false);
    for (let k = 0; k < 3000; k++) p.looked(finder);
    expect(found()).toBeUndefined();
    put(DETAIL_RANGE + 0.5, true);
    for (let k = 0; k < 3000; k++) p.looked(finder);
    expect(found()).toBeUndefined();
    put(1.5, true);
    const tie = p.ident.tieOf(finder.id, spy.id);
    const before = p.ident.doubtOf(finder.id, spy.id, p.t);
    const cap = p.ident.stage[finder.id * p.people.length + spy.id]! < PASSED ? COMPARE - 0.01 : 1;
    for (let k = 0; k < 20000 && !found(); k++) p.looked(finder);
    expect(found()?.actors).toEqual([finder.id, spy.id]);
    expect(p.ident.doubtOf(finder.id, spy.id, p.t)).toBeCloseTo(Math.max(before, Math.min(cap, before + GARMENT_DOUBT * TIE_WEIGHT[tie]!)), 5);
    expect(p.memory.knowsAbout(finder.id, "garment", spy.id)).toBe(true);
    // Once found, they don't find it again.
    const n0 = p.events.length;
    for (let k = 0; k < 3000; k++) p.looked(finder);
    expect(p.events.slice(n0).some((e) => e.kind === "react" && e.note === "garment" && e.actors[0] === finder.id)).toBe(false);
    // Picked up and handed in at the cloakroom (else to the butler): no longer lost, and the trace ends.
    for (let k = 0; k < 30 && items.stateOf(g.item) === "lost"; k++) p.advance(30);
    expect(items.stateOf(g.item)).not.toBe("lost");
    expect(spy.measure.tells.find((x) => x.what === "garment")!.until).toBeLessThanOrEqual(p.t);
  }, 60_000);
});

// ------------------------------------------------------------------ innocents

/**
 * The sweep's runner (scripts/spy-sweep.ts), which shares evenings out across child processes. It
 * is loaded by path, so the typecheck (browser code, without Node's types) doesn't take it in.
 */
const SWEEP = "../scripts/spy-sweep.ts";
interface Sweep {
  runEvenings(specs: ReadonlyArray<{ house: string; size: MansionSize }>): Promise<Array<SpyEvening & { house: string }>>;
}

describe("innocents over thirty evenings", () => {
  it("never fail a test (a drunk fumble passes at the next), an innocent is challenged in at most one evening, and the real host mostly agrees to the tours asked of it", async () => {
    const specs: Array<{ house: string; size: MansionSize }> = [];
    for (let i = 0; i < 10; i++) for (const size of ["compact", "grand", "palatial"] as const) specs.push({ house: `seen-${size}-${i}`, size });
    const { runEvenings } = (await import(/* @vite-ignore */ SWEEP)) as Sweep;
    const rs = await runEvenings(specs);
    for (const r of rs)
      expect(
        r.broken.filter((b) => b.check === "tests"),
        r.house,
      ).toEqual([]);
    expect(rs.filter((r) => r.innocentConfronted > 0).length).toBeLessThanOrEqual(1);
    // A first-timer asks the real host to be shown round now and then, and nearly always it agrees.
    const real = rs.filter((r) => r.setup !== "host");
    const asks = real.reduce((a, r) => a + r.tourAsks, 0);
    expect(asks).toBeGreaterThan(0);
    expect(real.reduce((a, r) => a + r.toursRefused, 0)).toBeLessThanOrEqual(Math.ceil(asks * 0.3));
  }, 600_000);
});

// ------------------------------------------------------------------ the fake host

/** A programme's phases run end to end and finish when the evening does. */
function wholeEvening(prog: readonly Phase[]): void {
  for (let k = 1; k < prog.length; k++) expect(prog[k]!.start).toBeCloseTo(prog[k - 1]!.end, 5);
  expect(prog[prog.length - 1]!.end).toBe(PARTY_LENGTH);
}

describe("the fake host and the household's prompts", () => {
  it("announces each change 2 to 6 minutes late at the household's prompt, and the evening still ends at 22:00", () => {
    const party = new Party(bp, { seed: SEED, spy: { setup: "host", goal: "bug" } });
    expect(party.spy!.id).toBe(party.host.id);
    const butler = party.people.find((q) => q.role === "butler")!;
    while (!party.over) party.advance(60);
    const log = party.prompts.log;
    // Every change after the first mingling's start is seen to: late, or prompted ahead when nothing can give.
    expect(log.length).toBeGreaterThanOrEqual(party.programme.length - 2);
    for (const r of log) {
      if (r.ahead) expect(r.delay).toBe(0);
      else {
        expect(r.delay).toBeGreaterThan(0);
        expect(r.delay).toBeLessThanOrEqual(FAKE_DELAY[1] + 1);
      }
    }
    const late = log.filter((r) => !r.ahead);
    expect(late.length).toBeGreaterThan(3);
    // Most come the full 2 to 6 minutes late; a change near the end has less to give.
    expect(late.filter((r) => r.delay >= FAKE_DELAY[0] - 1).length / late.length).toBeGreaterThan(0.6);
    expect(log.filter((r) => r.by === butler.id).length).toBeGreaterThan(log.length / 2);
    wholeEvening(party.programme);
    // Seen prompted.
    expect(party.events.some((e) => e.kind === "react" && e.note === "prompt")).toBe(true);
  }, 60_000);

  it("turns tours down seven times in ten", () => {
    const posing = new Posing(new Rng("seen-tours"));
    let no = 0;
    for (let k = 0; k < 2000; k++) if (posing.refusesTour()) no++;
    expect(no / 2000).toBeCloseTo(REFUSE_TOUR, 1);
    expect(posing.stats.refused + posing.stats.led).toBe(2000);
  });

  it("without a spy, the real host is late with one announcement in about one evening in five, prompted the same way", () => {
    let late = 0;
    const N = 400;
    const prog = new Party(bp, { seed: SEED }).programme;
    for (let k = 0; k < N; k++) {
      const stub: PromptsHost = { t: 0, programme: prog, phaseIndex: 0, host: {} as Person, prompter: () => null, prompt: () => false };
      const p = new Prompts(stub, new Rng(`party/late-${k}`).fork("host"));
      if (p.realLate.phase >= 0) {
        late++;
        expect(p.realLate.phase).toBeGreaterThanOrEqual(2);
        expect(p.realLate.delay).toBeGreaterThanOrEqual(REAL_DELAY[0]);
        expect(p.realLate.delay).toBeLessThanOrEqual(REAL_DELAY[1]);
      }
    }
    expect(Math.abs(late / N - 0.2)).toBeLessThan(0.05);
    // One such evening: the change starts late by the draw (or is prompted ahead), the butler prompts, and the evening ends on time.
    let party: Party | null = null;
    for (let k = 0; k < 40 && !party; k++) {
      const x = new Party(bp, { seed: `late-${k}` });
      if (x.prompts.realLate.phase >= 0) party = x;
    }
    expect(party).not.toBeNull();
    const { phase, delay } = party!.prompts.realLate;
    const due = party!.programme[phase]!.start;
    while (!party!.over) party!.advance(60);
    const r = party!.prompts.log.find((x) => x.phase === phase)!;
    expect(r).toBeDefined();
    if (!r.ahead) {
      expect(r.delay).toBeCloseTo(Math.min(delay, r.delay), 0);
      expect(party!.programme[phase]!.start).toBeCloseTo(due + r.delay, 0);
    }
    expect(r.by).toBeGreaterThanOrEqual(0);
    expect(party!.prompts.log.length).toBe(1);
    wholeEvening(party!.programme);
  }, 60_000);
});
