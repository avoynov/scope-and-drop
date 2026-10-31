/**
 * Observers on other bearings (armoury task 7): spotters in the treeline who see the party from their own bearing
 * and call what they see over the radio, without anything they say reaching the party.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import type { MansionBlueprint } from "../src/mansion/core/types";
import { PARTY_LENGTH } from "../src/party/clock";
import { BACK_AFTER, colourName, LOST_AFTER, Observers, SEEN, sayLooks, type ObserverCall, type ObserverHire } from "../src/party/observers";
import { describeLooks, F_BUILD, F_COLOUR, F_HEIGHT, F_QUIRKS, F_SEX, LOOKS_D } from "../src/party/register";
import { chestOf, straightShot } from "../src/party/shot";
import { Party } from "../src/party/sim";

const HIRES: ObserverHire[] = [
  { tier: "rookie", azDeg: -25 },
  { tier: "veteran", azDeg: 25 },
];
/** Ten evenings: five houses, two parties each, the spy among the guests (its acts are most of what is worth a call). */
const HOUSES = ["gala-night", "match-42", "orangery-1", "ridge-7", "palazzo-3"] as const;
const WATCH_AT = 30 * 60;

interface Evening {
  seed: string;
  party: Party;
  obs: Observers;
  /** By observer: whom they were told to watch at 19:30 (-1 nobody they could see). */
  watched: number[];
  /** By observer, each step from 19:30: whether they had the watched guest in view, and whether the perch did. */
  seen: { t: number; them: boolean; perch: boolean }[][];
  /** The guest the shot at 19:30 struck, and whether an observer could see where. */
  shotAt: number;
  shotSeen: boolean[];
}

/** One evening with the observers: a watch order each at 19:30 and a shot at a guest, then on to the end. */
function evening(bp: MansionBlueprint, seed: string, observers = true): Evening {
  const party = new Party(bp, { seed, spy: true, observers: observers ? { hires: HIRES } : undefined });
  party.advance(WATCH_AT);
  const obs = party.observers!;
  const watched: number[] = [];
  const shotSeen: boolean[] = [];
  let shotAt = -1;
  if (observers) {
    for (let i = 0; i < obs.list.length; i++) {
      const g = party.people.find((p) => p.present && !p.staff && obs.sees(i, p) >= SEEN && !watched.includes(p.id));
      watched[i] = g ? g.id : -1;
      if (g) obs.order({ t: party.t, to: i, kind: "watch", who: g.id });
    }
    // A shot at a guest the perch has a clear line to and someone else can see, not one of the watched.
    const eye = party.bp.site.perch.eye;
    const target = party.people.find(
      (p) =>
        p.present &&
        !p.staff &&
        p.room >= 0 &&
        !watched.includes(p.id) &&
        obs.list.some((_, i) => obs.sees(i, p) >= SEEN) &&
        !straightShot(party, eye, chestOf(p), { report: "open", round: "m118lr" }).blocked,
    );
    if (target) {
      const s = straightShot(party, eye, chestOf(target), { report: "open", round: "m118lr" });
      shotAt = target.id;
      for (let i = 0; i < obs.list.length; i++) shotSeen[i] = obs.sees(i, target) >= SEEN;
      obs.shot(s.to, s.room, s.struck, s.blocked);
    }
  }
  const seen: Evening["seen"] = watched.map(() => []);
  while (party.t < PARTY_LENGTH) {
    party.step();
    watched.forEach((id, i) => {
      if (id < 0) return;
      const p = party.people[id]!;
      seen[i]!.push({ t: party.t, them: obs.sees(i, p) >= SEEN, perch: party.visibility(p) >= SEEN });
    });
  }
  return { seed, party, obs, watched, seen, shotAt, shotSeen };
}

const evenings: Evening[] = [];

beforeAll(() => {
  for (const house of HOUSES) {
    const bp = generateMansion({ seed: house });
    for (const k of [1, 2]) evenings.push(evening(bp, `${house}/${k}`));
  }
}, 600_000);

const calls = (e: Evening, by: number, what?: string): ObserverCall[] => e.obs.calls.filter((c) => c.by === by && (!what || c.what === what));

describe("observers' words", () => {
  it("names the cast's colours as one would", () => {
    const hex = (h: string) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] as const;
    expect(colourName(...hex("#b3122b"))).toBe("red");
    expect(colourName(...hex("#1d2a44"))).toBe("navy");
    expect(colourName(...hex("#141416"))).toBe("black");
    expect(colourName(...hex("#0f6b4f"))).toBe("green");
    expect(colourName(...hex("#ece9e1"))).toBe("white");
  });

  it("says a description in the register's shape, leaving out what the mask leaves out", () => {
    const d = new Float32Array(LOOKS_D);
    // A tall slim woman in red with glasses and a cane.
    d.set([1, 175, 0.15, 0.7, 0.07, 0.17, 0b101]);
    const all = F_SEX | F_HEIGHT | F_BUILD | F_COLOUR | F_QUIRKS;
    expect(sayLooks(d, 0, all)).toBe("tall slim woman in red with a cane, glasses");
    expect(sayLooks(d, 0, all & ~F_COLOUR)).toBe("tall slim woman with a cane, glasses");
    expect(sayLooks(d, 0, all & ~F_HEIGHT & ~F_QUIRKS)).toBe("slim woman in red");
  });
});

describe("observers on other bearings", () => {
  it("found guests to watch and somewhere to shoot", () => {
    for (const e of evenings) expect(e.watched.filter((w) => w >= 0).length).toBeGreaterThan(0);
    expect(evenings.filter((e) => e.shotAt >= 0).length).toBeGreaterThan(5);
  });

  it("change nothing in the evening: the party's digest is the same without them", () => {
    const bp = generateMansion({ seed: HOUSES[0] });
    const plain = evening(bp, `${HOUSES[0]}/1`, false);
    expect(evenings[0]!.party.digest()).toBe(plain.party.digest());
    expect(plain.party.observers).toBeNull();
  }, 120_000);

  it("are deterministic: the same evening says the same", () => {
    const bp = generateMansion({ seed: HOUSES[0] });
    const again = evening(bp, `${HOUSES[0]}/1`);
    expect(again.obs.digest()).toBe(evenings[0]!.obs.digest());
    expect(again.obs.radio.log.map((a) => a.call.text)).toEqual(evenings[0]!.obs.radio.log.map((a) => a.call.text));
  }, 120_000);

  it("notice about 60% (rookie) and 95% (veteran) of the acts in view over ten evenings", () => {
    const sum = (i: number, k: "events" | "noticed") => evenings.reduce((n, e) => n + e.obs.list[i]!.stats[k], 0);
    const rookie = sum(0, "noticed") / sum(0, "events");
    const veteran = sum(1, "noticed") / sum(1, "events");
    console.log(`acts in view: rookie ${sum(0, "events")} (${(rookie * 100).toFixed(1)}% noticed), veteran ${sum(1, "events")} (${(veteran * 100).toFixed(1)}%)`);
    expect(sum(0, "events")).toBeGreaterThan(150);
    expect(sum(1, "events")).toBeGreaterThan(150);
    expect(Math.abs(rookie - 0.6)).toBeLessThan(0.08);
    expect(Math.abs(veteran - 0.95)).toBeLessThan(0.04);
  });

  it("call a watched guest lost only once they are out of view, and most times they are", () => {
    let leavings = 0;
    let lost = 0;
    for (const e of evenings)
      e.watched.forEach((id, i) => {
        if (id < 0) return;
        const log = e.seen[i]!;
        for (const c of calls(e, i, "lost")) {
          // Out of their view all through the LOST_AFTER before the call (the step it was made in included).
          const before = log.filter((s) => s.t <= c.t && s.t > c.t - LOST_AFTER);
          expect(before.length).toBeGreaterThan(0);
          expect(before.every((s) => !s.them)).toBe(true);
          lost++;
        }
        // Each time they went out of view for LOST_AFTER or more is a leaving (and back in it for BACK_AFTER, a return).
        let out = -1;
        let inView = log[0]?.them ?? false;
        for (const s of log) {
          if (s.them === inView) out = -1;
          else if (out < 0) out = s.t;
          if (out >= 0 && s.t - out >= (inView ? LOST_AFTER : BACK_AFTER)) {
            inView = s.them;
            out = -1;
            if (!inView) leavings++;
          }
        }
      });
    console.log(`watched guests out of an observer's view: ${leavings}, called lost: ${lost}`);
    expect(leavings).toBeGreaterThan(5);
    expect(lost / leavings).toBeGreaterThan(0.5);
    expect(lost).toBeLessThanOrEqual(leavings);
  });

  it("call a watched guest leaving the sniper's view: moving, lost or back, around the time", () => {
    let left = 0;
    let called = 0;
    for (const e of evenings)
      e.watched.forEach((id, i) => {
        if (id < 0) return;
        const log = e.seen[i]!;
        const said = calls(e, i).filter((c) => c.about === id && (c.what === "moved" || c.what === "lost" || c.what === "back"));
        // The perch loses them for good measure (LOST_AFTER or more) while the observer still has them or just lost them.
        let out = -1;
        let perch = log[0]?.perch ?? false;
        for (const s of log) {
          if (s.perch === perch) out = -1;
          else if (out < 0) out = s.t;
          if (out >= 0 && s.t - out >= LOST_AFTER) {
            perch = s.perch;
            const from = out;
            out = -1;
            if (perch) continue;
            left++;
            if (said.some((c) => c.t >= from - 10 && c.t <= s.t + 20)) called++;
          }
        }
      });
    console.log(`watched guests leaving the sniper's view: ${left}, with a call around then: ${called}`);
    expect(left).toBeGreaterThan(5);
    expect(called / left).toBeGreaterThan(0.5);
  });

  it("never talk over each other: one call at a time, none before its speaker is ready", () => {
    for (const e of evenings) {
      const log = e.obs.radio.log;
      expect(log.length).toBeGreaterThan(0);
      for (let k = 0; k < log.length; k++) {
        expect(log[k]!.start).toBeGreaterThanOrEqual(log[k]!.call.at);
        if (k) expect(log[k]!.start).toBeGreaterThanOrEqual(log[k - 1]!.end);
      }
      // Whatever waited too long was dropped, never a shot call.
      expect(e.obs.radio.dropped.every((c) => c.kind !== "shot")).toBe(true);
    }
  });

  it("call the shot's impact when they can see where it struck, a rookie only hit or miss", () => {
    let seen = 0;
    let said = 0;
    for (const e of evenings) {
      if (e.shotAt < 0) continue;
      for (let i = 0; i < e.obs.list.length; i++) {
        const c = calls(e, i).filter((c) => c.kind === "shot");
        if (!e.shotSeen[i]) {
          expect(c.length).toBe(0);
          continue;
        }
        seen++;
        said += c.length;
        for (const x of c) expect(i === 0 ? /^(One|Two), (hit|miss)\.$/.test(x.text) : /^(One|Two), (hit|miss)\b/.test(x.text)).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(3);
    expect(said / seen).toBeGreaterThan(0.5);
  });

  it("describe as the register does, a rookie further from the truth than a veteran", () => {
    const off = [0, 0];
    const n = [0, 0];
    const truth = new Float32Array(LOOKS_D);
    for (const e of evenings)
      for (const c of e.obs.calls) {
        if (!c.desc || c.about < 0) continue;
        describeLooks(e.party.people[c.about]!, truth, 0);
        n[c.by]++;
        // A colour mis-named shows in the description's numbers; a feature left out shows in the words.
        const colour = colourName(truth[3]!, truth[4]!, truth[5]!);
        if (colourName(c.desc[3]!, c.desc[4]!, c.desc[5]!) !== colour || !c.text.includes(sayLooks(truth, 0, F_SEX | F_HEIGHT | F_BUILD | F_COLOUR | F_QUIRKS, colour))) off[c.by]++;
      }
    const rookie = off[0]! / n[0]!;
    const veteran = off[1]! / n[1]!;
    console.log(`descriptions off the truth: rookie ${(rookie * 100).toFixed(0)}% of ${n[0]}, veteran ${(veteran * 100).toFixed(0)}% of ${n[1]}`);
    expect(rookie).toBeGreaterThan(veteran + 0.2);
    expect(veteran).toBeLessThan(0.2);
  });
});
