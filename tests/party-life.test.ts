import { beforeAll, describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import { PARTY_LENGTH } from "../src/party/clock";
import { ringRadius } from "../src/party/groups";
import { Party } from "../src/party/sim";
import type { Group, Person } from "../src/party/types";

const HOUSES = ["gala-night", "match-42", "orangery-1"] as const;
const guestsOf = (party: Party): Person[] => party.people.filter((p) => !p.staff && p.role !== "host");
/** Circles with two or more standing in them. */
const standing = (party: Party): Group[] => [...party.groups.values()].filter((g) => party.circles.settled(g).length >= 2);
const median = (a: readonly number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1]!;

describe("circles", () => {
  it("stand people on a ring round the middle, and split a circle grown past four a clear step away", () => {
    const party = new Party(generateMansion({ seed: "gala-night" }), { seed: "rings" });
    const mingle = party.programme.find((p) => p.id === "mingle")!;
    party.advance(mingle.start + (mingle.end - mingle.start) * 0.6);
    let checked = 0;
    for (const g of standing(party)) {
      const r = ringRadius(g.members.length);
      for (const m of party.circles.settled(g)) {
        const p = party.people[m]!;
        expect(Math.abs(Math.hypot(p.x - g.x, p.z - g.z) - r), `${p.id} in circle ${g.id}`).toBeLessThan(0.45);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(6);

    // Crowd one circle with guests from the others until it's too big to keep together.
    const g = standing(party).sort((a, b) => b.members.length - a.members.length)[0]!;
    const extra = guestsOf(party).filter((q) => q.action?.id === "mingle" && q.action.note === "in" && q.action.startedAt !== null && q.action.ref !== g.id);
    for (const q of extra.slice(0, 6 - g.members.length)) {
      party.circles.left(q, party.groups.get(q.action!.ref!)!);
      q.action!.ref = g.id;
      g.members.push(q.id);
    }
    expect(g.members.length).toBe(6);
    const ng = party.circles.maybeSplit(g)!;
    expect(ng).not.toBeNull();
    expect(g.members.length + ng.members.length).toBe(6);
    expect(Math.max(g.members.length, ng.members.length)).toBeLessThanOrEqual(4);
    for (const m of ng.members) expect(party.people[m]!.action!.ref).toBe(ng.id);
    // The new ring stands clear of the old one, and of every other circle.
    for (const o of party.groups.values()) {
      if (o === ng || o.level !== ng.level) continue;
      expect(Math.hypot(o.x - ng.x, o.z - ng.z), `circle ${o.id}`).toBeGreaterThan(ringRadius(o.members.length) + ringRadius(ng.members.length));
    }
    expect(party.events.some((e) => e.kind === "split")).toBe(true);
  });
});

describe("everyday evenings", () => {
  interface Run {
    party: Party;
    /** Standing circles, sampled through the middle of the first two minglings. */
    circles: number[];
    /** Tours that ended, with how well their guests knew the rooms shown before and after. */
    tours: Array<{ before: number; after: number }>;
    /** Anyone but the host couple dancing in the opening dance. */
    openingOthers: number;
    openingSamples: number;
  }
  const runs: Run[] = [];

  beforeAll(() => {
    for (const seed of HOUSES) {
      const party = new Party(generateMansion({ seed }), { seed });
      const run: Run = { party, circles: [], tours: [], openingOthers: 0, openingSamples: 0 };
      const mingles = party.programme.filter((p) => p.id === "mingle").slice(0, 2);
      const known = (who: number[], rooms: number[]) => {
        let s = 0;
        for (const i of who) for (const r of rooms) s += party.memory.familiarity(i, r);
        return s / (who.length * rooms.length);
      };
      const watching = new Map<number, { who: number[]; rooms: number[]; before: Map<number, number>; done: boolean }>();
      const host = party.host;
      while (!party.over) {
        party.advance(10);
        for (const ph of mingles) {
          const f = (party.t - ph.start) / (ph.end - ph.start);
          if (f >= 0.3 && f <= 0.9 && party.t % 30 === 0) run.circles.push(standing(party).length);
        }
        for (const t of party.tasks.list) {
          if (t.kind !== "tour") continue;
          if (!watching.has(t.id) && t.outcome === null) {
            const rooms = [...new Set(t.steps.flatMap((s) => (s.do === "goto" && s.label === "to-room" ? [s.to.room] : [])))];
            watching.set(t.id, { who: [...t.party], rooms, before: new Map(t.party.map((i) => [i, known([i], rooms)])), done: false });
          }
          const w = watching.get(t.id);
          // Those who stayed with it to the end.
          const stayed = w ? w.who.filter((i) => t.party.includes(i)) : [];
          if (w && t.outcome === "done" && !w.done && stayed.length) {
            run.tours.push({ before: stayed.reduce((a, i) => a + w.before.get(i)!, 0) / stayed.length, after: known(stayed, w.rooms) });
            w.done = true;
          }
        }
        if (party.practices.opening && party.t - party.practices.fired.get("open-dance")! >= 20) {
          run.openingSamples++;
          run.openingOthers += party.people.filter((p) => p.present && p.action?.id === "dance" && p.action.startedAt !== null && p !== host && p.id !== host.partner).length;
        }
      }
      runs.push(run);
    }
  }, 180_000);

  it("runs the evening’s tasks in the numbers the plan asks for", () => {
    for (const { party } of runs) {
      const st = party.stats;
      const seed = party.bp.seed;
      expect(st.tours, seed).toBeLessThanOrEqual(4);
      expect(st.errands, seed).toBeGreaterThanOrEqual(4);
      expect(st.errands, seed).toBeLessThanOrEqual(12);
      expect(st.searches, seed).toBeGreaterThanOrEqual(1);
      expect(st.searches, seed).toBeLessThanOrEqual(15);
      expect(st.photos, seed).toBe(1);
      expect(party.tasks.stats.stalled, seed).toBeLessThanOrEqual(1);
    }
    // A tour needs the host free beside a first-timer who is free too: over twelve houses about one evening in five has none.
    expect(runs.filter(({ party }) => party.stats.tours >= 1).length).toBeGreaterThanOrEqual(1);
    // Searches are partners looking for each other: about half the guests come as couples, and
    // there's a search for every three couples or so over the three houses.
    const couples = runs.reduce((s, { party }) => s + party.people.filter((p) => !p.staff && p.partner !== null).length / 2, 0);
    expect(runs.reduce((s, { party }) => s + party.stats.searches, 0)).toBeGreaterThanOrEqual(couples / 3);
  });

  it("talks in a handful of small circles that people stay in for minutes, not seconds", () => {
    // One evening can run thin (over twelve evenings in one house the median was 2 once, 3–5 otherwise): 3–6 on average, never under 2.
    const medians = runs.map(({ circles }) => median(circles));
    expect(medians.reduce((a, b) => a + b, 0) / medians.length).toBeGreaterThanOrEqual(3);
    for (const { party, circles } of runs) {
      const seed = party.bp.seed;
      expect(median(circles), seed).toBeGreaterThanOrEqual(2);
      expect(median(circles), seed).toBeLessThanOrEqual(6);
      const sizes = party.circles.stats.sizes;
      const all = sizes.reduce((a, b) => a + b, 0);
      expect(sizes.slice(5).reduce((a, b) => a + b, 0) / all, seed).toBeLessThan(0.1);
      const stay = median(party.circles.stats.stays) / 60;
      expect(stay, seed).toBeGreaterThanOrEqual(5);
      expect(stay, seed).toBeLessThanOrEqual(15);
      // Circles let people in, and sometimes don't.
      expect(party.stats.joins, seed).toBeGreaterThan(20);
      expect(party.stats.rebuffs, seed).toBeGreaterThan(0);
    }
  });

  it("shows guests round rooms they then know better", () => {
    const tours = runs.flatMap((r) => r.tours);
    expect(tours.length).toBeGreaterThan(0);
    for (const t of tours) expect(t.after).toBeGreaterThan(t.before);
  });

  it("hands a fetched drink to whoever asked for it, glass and all", () => {
    let drinks = 0;
    for (const { party } of runs) {
      const ends = party.events.filter((e) => e.kind === "task" && e.note === "errand:done");
      for (const t of party.tasks.list) {
        if (t.kind !== "errand" || t.errand !== "drink" || t.outcome !== "done") continue;
        const end = ends.find((e) => e.actors[0] === t.owner && e.t >= t.startedAt)!;
        const asker = party.people[t.other]!;
        expect(
          asker.drinkLog.some((d) => d.t >= t.startedAt && d.t <= end.t),
          `${party.bp.seed} task ${t.id}`,
        ).toBe(true);
        drinks++;
      }
    }
    expect(drinks).toBeGreaterThan(0);
  });

  it("keeps to the evening’s rituals: each beat once and in order, the opening dance left to the host couple, breaches frowned on", () => {
    const order = ["tap", "hush", "procession", "table-turn", "open-dance", "surge", "band-break", "band-back", "last-call", "thanks"] as const;
    for (const { party, openingOthers, openingSamples } of runs) {
      const seed = party.bp.seed;
      const beats = party.events.filter((e) => e.kind === "beat").map((e) => e.note!);
      expect(new Set(beats).size, seed).toBe(beats.length);
      const at = order.map((b) => party.practices.fired.get(b));
      for (const t of at) expect(t, seed).toBeDefined();
      for (let i = 1; i < at.length; i++) expect(at[i]!, `${seed} ${order[i]}`).toBeGreaterThanOrEqual(at[i - 1]!);
      expect(party.practices.fired.has("host-sits"), seed).toBe(true);
      expect(openingSamples, seed).toBeGreaterThan(0);
      expect(openingOthers / openingSamples, seed).toBeLessThan(1);
      const breaches = party.events.filter((e) => e.kind === "breach");
      expect(breaches.length, seed).toBe(party.stats.breaches);
      const once = new Set(breaches.map((e) => `${e.note}:${e.actors[0]}`));
      expect(once.size, seed).toBe(breaches.length);
      for (const e of breaches) {
        expect(["quiet", "host-first"]).toContain(e.note);
        expect(e.actors.length - 1).toBeLessThanOrEqual(4);
      }
    }
    expect(runs.reduce((s, r) => s + r.party.stats.breaches, 0)).toBeGreaterThan(0);
  });

  it("sends everyone home at the end, most in the last quarter hour, couples together", () => {
    for (const { party } of runs) {
      const seed = party.bp.seed;
      const guests = guestsOf(party);
      expect(
        guests.every((g) => g.gone),
        seed,
      ).toBe(true);
      const leaves = party.events.filter((e) => e.kind === "leave");
      expect(leaves.filter((e) => e.t >= PARTY_LENGTH - 15 * 60).length / leaves.length, seed).toBeGreaterThanOrEqual(0.8);
      for (const t of party.tasks.list) {
        if (t.kind !== "leave") continue;
        expect(t.outcome, `${seed} task ${t.id}`).toBe("done");
        for (const m of t.party) expect(party.people[m]!.gone).toBe(true);
      }
    }
  });
});
