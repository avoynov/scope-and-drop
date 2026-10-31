/**
 * The shot heard (armoury task 8): who in the house hears a shot from the treeline, sound by sound, as a query
 * that changes nothing in the evening.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import type { Report } from "../src/scope/can";
import type { RoundId } from "../src/scope/ballistics";
import { AIR, at, ROUNDS } from "../src/scope/ballistics";
import { chestOf, GLAZING_DB, hearShot, nWave, outdoors, REPORT_STEP, reportDb, straightShot, type ShotHeard, type ShotIn } from "../src/party/shot";
import { Party } from "../src/party/sim";
import type { Person } from "../src/party/types";

const KITS = { open: ["open", "m118lr"], can: ["can", "m118lr"], sub: ["can-sub", "sub200"], vss: ["integral", "sp5"], svd: ["open", "7n1"] } as const satisfies Record<
  string,
  readonly [Report, RoundId]
>;
type KitId = keyof typeof KITS;

const HOUSES = ["gala-night", "match-42", "orangery-1"] as const;
/** Each house's evening at 19:50 (mingling) and 20:50 (dancing). */
const TIMES = [50, 110] as const;

interface Evening {
  seed: string;
  min: number;
  party: Party;
  /** Guests the perch has a clear line to (through glass, not walls), a few per evening. */
  targets: Person[];
  /** By target, by kit: who heard what. */
  shots: { target: Person; kit: KitId; shot: ShotIn; heard: ShotHeard }[];
}

const fire = (party: Party, target: Person, kit: KitId, extra: Partial<ShotIn> = {}) => {
  const [report, round] = KITS[kit];
  const shot = straightShot(party, party.bp.site.perch.eye, chestOf(target), { report, round });
  return { shot, heard: hearShot(party, { ...shot, ...extra }) };
};

const evenings: Evening[] = [];

beforeAll(() => {
  for (const seed of HOUSES) {
    const bp = generateMansion({ seed });
    for (const min of TIMES) {
      // An evening of its own for each time, so each stands as it was when the shots went off.
      const party = new Party(bp, { seed });
      party.advance(min * 60);
      // Guests in rooms seen from the perch, the line to them through glass: up to four, spread over the cast.
      const clear = party.people.filter((p) => p.present && !p.staff && p.room >= 0 && !straightShot(party, party.bp.site.perch.eye, chestOf(p), { report: "open", round: "m118lr" }).blocked);
      const targets = [0, 1, 2, 3].map((k) => clear[Math.floor((k * clear.length) / 4)]).filter((p, i, a): p is Person => !!p && a.indexOf(p) === i);
      const shots: Evening["shots"] = [];
      for (const target of targets) for (const kit of Object.keys(KITS) as KitId[]) shots.push({ target, kit, ...fire(party, target, kit) });
      evenings.push({ seed, min, party, targets, shots });
    }
  }
}, 240_000);

const total = (kit: KitId, f: (h: ShotHeard) => number): number => evenings.reduce((n, e) => n + e.shots.filter((s) => s.kit === kit).reduce((m, s) => m + f(s.heard), 0), 0);

describe("the numbers", () => {
  it("an open report at 170 m is 120 dB at a garden window, 95 inside single glazing, 80 heard as a steady sound", () => {
    const window = outdoors(reportDb("open", "m118lr"), 170);
    expect(window).toBeCloseTo(119.4, 0);
    expect(window - GLAZING_DB.single).toBeCloseTo(94.4, 0);
    expect(REPORT_STEP).toBeCloseTo(15, 1);
    expect(window - GLAZING_DB.single - REPORT_STEP).toBeGreaterThan(78);
    // Through a can about 50, the subsonic package about 43.
    expect(outdoors(reportDb("can", "m118lr"), 170) - GLAZING_DB.single - REPORT_STEP).toBeCloseTo(49.4, 0);
    expect(outdoors(reportDb("can-sub", "sub200"), 170) - GLAZING_DB.single - REPORT_STEP).toBeCloseTo(42.4, 0);
    // An open muzzle on the subsonic charge: the cube root of its powder.
    expect(reportDb("open", "sub200")).toBeCloseTo(160.6, 0);
  });

  it("a .308's crack is about 155 dB at a metre (152.6 measured), falling 15 dB a tenfold, over in a fraction of a millisecond", () => {
    const m = at(ROUNDS.m118lr, 170).v / AIR.sound;
    const one = nWave("m118lr", m, 1);
    const ten = nWave("m118lr", m, 10);
    expect(one.peak).toBeGreaterThan(152);
    expect(one.peak).toBeLessThan(158);
    expect(one.peak - ten.peak).toBeCloseTo(15, 1);
    expect(ten.T).toBeGreaterThan(1.5e-4);
    expect(ten.T).toBeLessThan(3.5e-4);
    // Its energy over the ear's 0.2 s: some 35 dB under its peak.
    expect(ten.peak - ten.db).toBeGreaterThan(30);
    expect(ten.peak - ten.db).toBeLessThan(40);
  });

  it("double glazing is barely better than single against a gunshot, and an open window much worse", () => {
    expect(GLAZING_DB.double - GLAZING_DB.single).toBeLessThanOrEqual(3);
    expect(GLAZING_DB.laminated).toBeGreaterThan(GLAZING_DB.single);
  });
});

describe("the shot heard", () => {
  it("found guests to shoot at in every evening", () => {
    for (const e of evenings) expect(e.targets.length, `${e.seed} at ${e.min}`).toBeGreaterThan(0);
  });

  it("is a query: the evening runs on exactly as if it had never gone off", () => {
    const seed = "gala-night";
    const quiet = new Party(generateMansion({ seed }), { seed });
    const shot = new Party(generateMansion({ seed }), { seed });
    for (const p of [quiet, shot]) p.advance(40 * 60);
    const target = shot.people.find((p) => p.present && !p.staff && p.room >= 0)!;
    for (const kit of Object.keys(KITS) as KitId[]) fire(shot, target, kit);
    expect(shot.digest()).toBe(quiet.digest());
    expect(shot.senses.stats).toEqual(quiet.senses.stats);
    for (const p of [quiet, shot]) p.advance(20 * 60);
    expect(shot.digest()).toBe(quiet.digest());
    expect(shot.events.length).toBe(quiet.events.length);
  });

  it("is the same asked twice, and draws apart for a second shot in the same step", () => {
    const e = evenings[1]!;
    const s = e.shots[0]!;
    expect(hearShot(e.party, s.shot)).toEqual(hearShot(e.party, s.shot));
    const a = hearShot(e.party, { ...s.shot, n: 0 });
    const b = hearShot(e.party, { ...s.shot, n: 1 });
    expect(a.ears.map((x) => x?.db)).toEqual(b.ears.map((x) => x?.db));
  });

  it("a can cuts who hears the report; the subsonic package through a can is heard by fewer still", () => {
    const report = (kit: KitId) => total(kit, (h) => h.heard.report.length);
    expect(report("open")).toBeGreaterThan(50);
    expect(report("can")).toBeLessThan(0.25 * report("open"));
    expect(report("sub")).toBeLessThanOrEqual(report("can"));
    const shot = (kit: KitId) => total(kit, (h) => h.heardBy);
    expect(shot("sub")).toBeLessThan(0.25 * shot("can"));
    expect(shot("sub")).toBeLessThan(0.25 * shot("open"));
    // The strike near them is heard whatever the kit.
    expect(total("sub", (h) => h.heardAny)).toBeGreaterThan(shot("sub"));
  });

  it("a can leaves the crack: a supersonic bullet is heard along its path either way", () => {
    const crack = (kit: KitId) => total(kit, (h) => h.heard.crack.length);
    expect(crack("open")).toBeGreaterThan(0);
    expect(crack("can")).toBe(crack("open"));
  });

  it("a subsonic bullet never cracks", () => {
    for (const e of evenings)
      for (const s of e.shots) {
        const sub = s.kit === "sub" || s.kit === "vss";
        expect(s.heard.cracked).toBe(!sub);
        if (sub) expect(s.heard.heard.crack).toEqual([]);
      }
  });

  it("the strike and a breaking pane are heard near them, whatever the rifle, but for the band", () => {
    let near = 0;
    let heard = 0;
    for (const e of evenings)
      for (const s of e.shots) {
        if (s.kit !== "vss") continue;
        const open = e.shots.find((o) => o.target === s.target && o.kit === "open")!;
        expect(open.heard.ears.map((x) => x?.db.strike)).toEqual(s.heard.ears.map((x) => x?.db.strike));
        const spots = [{ x: s.shot.to.x, z: s.shot.to.z, room: s.shot.room }, ...s.shot.panes];
        for (const p of e.party.people) {
          const ear = s.heard.ears[p.id];
          // Within a few steps, in a room quieter than the band: the dance floor can drown it.
          if (!ear || e.party.senses.noiseIn(p.room) >= 70 || !spots.some((q) => q.room === p.room && Math.hypot(p.x - q.x, p.z - q.z) < 3)) continue;
          near++;
          if (ear.heard.strike) heard++;
        }
      }
    expect(near).toBeGreaterThan(5);
    expect(heard / near).toBeGreaterThan(0.8);
  });

  it("a loud room hears least, and so does a drunk", () => {
    let loud = 0;
    let loudHeard = 0;
    let quiet = 0;
    let quietHeard = 0;
    for (const e of evenings)
      for (const s of e.shots) {
        if (s.kit !== "open") continue;
        for (const p of e.party.people) {
          const ear = s.heard.ears[p.id];
          if (!ear || p.room < 0) continue;
          const noise = e.party.senses.noiseIn(p.room);
          if (noise >= 70) ((loud += 1), (loudHeard += ear.heard.report ? 1 : 0));
          else if (noise <= 50) ((quiet += 1), (quietHeard += ear.heard.report ? 1 : 0));
        }
      }
    expect(loud).toBeGreaterThan(20);
    expect(quiet).toBeGreaterThan(5);
    expect(loudHeard / loud).toBeLessThan(quietHeard / quiet);
    // The same shot with everyone sober, then with everyone drunk.
    const e = evenings.find((x) => x.min === 110)!;
    const s = e.shots.find((x) => x.kit === "open")!;
    const tipsy = e.party.people.map((p) => p.tipsy);
    const count = (v: number) => {
      for (const p of e.party.people) p.tipsy = v;
      return hearShot(e.party, s.shot).heard.report.length;
    };
    const sober = count(0);
    const drunk = count(1);
    e.party.people.forEach((p, i) => (p.tipsy = tipsy[i]!));
    expect(drunk).toBeLessThan(sober);
  });

  it("windows standing open let a suppressed report in; better glass keeps more of it out", () => {
    let shut = 0;
    let open = 0;
    let single = 0;
    let laminated = 0;
    for (const e of evenings) {
      const ids = new Set(e.party.bp.walls.filter((w) => w.exterior).flatMap((w) => w.openings.filter((o) => o.glazed).map((o) => o.id)));
      for (const s of e.shots) {
        if (s.kit === "can") {
          shut += s.heard.heard.report.length;
          open += hearShot(e.party, { ...s.shot, open: ids }).heard.report.length;
        }
        if (s.kit === "open") {
          single += s.heard.heard.report.length;
          laminated += hearShot(e.party, { ...s.shot, glazing: "laminated" }).heard.report.length;
        }
      }
    }
    expect(open).toBeGreaterThan(shut);
    expect(laminated).toBeLessThanOrEqual(single);
  });

  it("the one struck, and anyone not there, hear nothing; heardBy counts who heard a shot, heardAny who heard anything", () => {
    for (const e of evenings)
      for (const s of e.shots) {
        const h = s.heard;
        if (s.shot.hit >= 0) expect(h.ears[s.shot.hit]).toBeNull();
        for (const p of e.party.people) if (!p.present) expect(h.ears[p.id]).toBeNull();
        expect(h.heardBy).toBe(h.ears.filter((x) => x && (x.heard.report || x.heard.crack)).length);
        expect(h.heardAny).toBe(h.ears.filter((x) => x && (x.heard.report || x.heard.crack || x.heard.strike)).length);
        expect(h.ears.length).toBe(e.party.people.length);
      }
  });
});
