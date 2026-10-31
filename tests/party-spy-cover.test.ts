/**
 * The spy, milestone 3 PR 4 "Cover" (technical plan: Tests and the sweep): the scheduler on its
 * own, each cover forced on leaving its tell, the false alibi seen through from the cut to the
 * bare hand and its claim caught out, keeping out of the picture both ways, a dropped errand, the
 * lights put out, someone else's bag carried off and put back, and the innocent twins the covers
 * need: drinks fetched for a friend and bags set down, every evening.
 */
import { describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import { Rng } from "../src/mansion/core/rng";
import type { MansionSize } from "../src/mansion/core/types";
import { PARTY_LENGTH } from "../src/party/clock";
import { yawTo } from "../src/party/places";
import { Party, STEP, type Provocation } from "../src/party/sim";
import type { GoalKind, SpyOptions } from "../src/party/spy";
import {
  CAP_WAIT,
  COVERS,
  Covers,
  FIRST,
  GOAL_TILT,
  HABIT_COVERS,
  MAX_ON,
  MAX_TOTAL,
  MOOD_MIN,
  MURDER_TILT,
  OFF,
  ON,
  PICTURE_OFF,
  PLAYING_TILT,
  POISON_TILT,
  WATCHED,
  type Cover,
  type CoversHost,
  type CoversSpy,
  type Spell,
} from "../src/party/spy/scheduler";
import type { Task } from "../src/party/tasks";
import type { Person } from "../src/party/types";
import type { SpyEvening } from "./spy-watch";

const MIN = 60;

// ------------------------------------------------------------------ the scheduler

/** A scheduler on its own: a stand-in party of five on one spot, the spy among them, and the clock moved by hand. */
function scheduler(o: { seed: string; goal?: GoalKind; playing?: boolean; forced?: Cover[]; energy?: number; tension?: number; stealing?: boolean }) {
  const crowd = Array.from({ length: 5 }, (_, id) => ({ id, present: true, gone: false, level: 0, x: id, z: 0, room: 0 }) as unknown as Person);
  const host: CoversHost & { t: number } = {
    t: 0,
    people: crowd,
    mood: { energy: new Float32Array(5).fill(o.energy ?? 0), tension: new Float32Array(5).fill(o.tension ?? 0) },
    log: () => {},
  };
  const spy: CoversSpy = { record: crowd[0]!, goal: { kind: o.goal ?? "statuette" }, playing: !!o.playing, stealing: () => !!o.stealing, answers: { lowUntil: -1 } };
  const covers = new Covers(host, spy, o.forced ?? [], new Rng(o.seed));
  return { host, spy, covers };
}

/** Three hours from its arrival at `from`, a step at a time: the most counted against the caps at once, and the spells. */
function evening(s: ReturnType<typeof scheduler>, from = 0): { most: number; spells: Spell[] } {
  const { host, spy, covers } = s;
  host.t = from;
  covers.arrived();
  let most = 0;
  for (; host.t < from + PARTY_LENGTH; host.t += STEP) {
    covers.step();
    most = Math.max(most, covers.list.filter((c) => !covers.state[COVERS.indexOf(c)]!.forced && !(c === "out-of-picture" && spy.playing)).length);
  }
  covers.left();
  return { most, spells: covers.spells };
}

/** A cover's spells in order, and what lay between them. */
const spellsOf = (spells: readonly Spell[], c: Cover) => spells.filter((x) => x.cover === c);
const gaps = (xs: readonly Spell[]) => xs.slice(1).map((x, k) => x.from - xs[k]!.to);

describe("the covers' scheduler", () => {
  it("brings each cover on for 10 to 40 minutes and off for at least 15, never more than three at once nor any for more than 90 minutes, one or two of them early", () => {
    const end = PARTY_LENGTH + 20 * MIN;
    let early = 0;
    let mean = 0;
    const seeds = 40;
    for (let k = 0; k < seeds; k++) {
      const s = scheduler({ seed: `sched-${k}`, goal: (["statuette", "kill", "bug", "ledger", "safe", "bag"] as const)[k % 6] });
      const { most, spells } = evening(s, 20 * MIN);
      expect(most).toBeLessThanOrEqual(MAX_ON);
      for (const c of COVERS) {
        const xs = spellsOf(spells, c);
        let total = 0;
        for (const x of xs) {
          const len = x.to - x.from;
          total += len;
          expect(x.from).toBeGreaterThanOrEqual(20 * MIN);
          expect(len).toBeLessThanOrEqual(ON[1] + STEP);
          // Shorter only when its 90 minutes run out, or the evening does.
          if (len < ON[0] - STEP) expect(total >= MAX_TOTAL - STEP || x.to >= end - STEP, `${c} on ${len} s`).toBe(true);
        }
        for (const g of gaps(xs)) expect(g).toBeGreaterThanOrEqual(OFF[0] - STEP);
        expect(total).toBeLessThanOrEqual(MAX_TOTAL + STEP);
      }
      if (spells.some((x) => x.from < 20 * MIN + FIRST[1])) early++;
      mean += spells.reduce((a, x) => a + x.to - x.from, 0) / PARTY_LENGTH / seeds;
    }
    // Something on in its first hour nearly every evening, and between one and three on at a time over the evening.
    expect(early).toBeGreaterThanOrEqual(seeds - 2);
    expect(mean).toBeGreaterThan(1);
    expect(mean).toBeLessThanOrEqual(MAX_ON);
  });

  it("holds the covers named in the options on all evening past the caps, makes a cover that would break a cap wait 5 to 10 minutes, and is done with one that has had its 90", () => {
    // Four habits held on hold nothing else back: the caps count only the rest.
    const held: Cover[] = ["out-of-step", "returns", "odd-places", "startles"];
    const { host, spy, covers } = scheduler({ seed: "caps", forced: held });
    covers.arrived();
    let waits = 0;
    for (; host.t < PARTY_LENGTH; host.t += STEP) {
      const before = covers.state.map((st) => st.next);
      const capped = covers.stats.capped;
      covers.step();
      if (covers.stats.capped > capped) {
        const waited = covers.state.filter((st, k) => !st.on && st.next !== before[k]).map((st) => st.next - host.t);
        expect(
          waited.some((w) => w >= CAP_WAIT[0] && w <= CAP_WAIT[1]),
          `${waited}`,
        ).toBe(true);
        waits++;
      }
      expect(covers.list.filter((c) => !held.includes(c) && !(c === "out-of-picture" && spy.playing)).length).toBeLessThanOrEqual(MAX_ON);
    }
    covers.left();
    for (const c of held) expect(spellsOf(covers.spells, c)).toEqual([{ cover: c, from: 0, to: PARTY_LENGTH }]);
    expect(waits).toBeGreaterThan(0);
    // A cover with its 90 minutes had has no next chance.
    for (const [k, st] of covers.state.entries()) if (!st.forced && st.total >= MAX_TOTAL - STEP) expect(st.next, COVERS[k]).toBe(Infinity);
  });

  it("keeps out of the picture nearly all evening while it plays someone, off only 5 to 10 minutes at a time and outside the caps", () => {
    let on = 0;
    const seeds = 20;
    for (let k = 0; k < seeds; k++) {
      const s = scheduler({ seed: `picture-${k}`, playing: true });
      const { most, spells } = evening(s);
      expect(most).toBeLessThanOrEqual(MAX_ON);
      const xs = spellsOf(spells, "out-of-picture");
      for (const g of gaps(xs)) expect(g).toBeGreaterThanOrEqual(PICTURE_OFF[0] - STEP);
      on += xs.reduce((a, x) => a + x.to - x.from, 0) / PARTY_LENGTH / seeds;
    }
    expect(on).toBeGreaterThan(0.6);
  });

  it("tilts the chances by the goal, by playing someone, and the risky ones by the mood about it", () => {
    const tilt = (o: Parameters<typeof scheduler>[0], c: Cover) => scheduler(o).covers.tilt(c);
    expect(tilt({ seed: "t", goal: "statuette" }, "commotion")).toBeCloseTo(GOAL_TILT);
    expect(tilt({ seed: "t", goal: "statuette" }, "tours")).toBeCloseTo(GOAL_TILT);
    expect(tilt({ seed: "t", goal: "statuette" }, "returns")).toBeCloseTo(1);
    expect(tilt({ seed: "t", goal: "ledger" }, "returns")).toBeCloseTo(GOAL_TILT);
    expect(tilt({ seed: "t", goal: "kill" }, "odd-places")).toBeCloseTo(GOAL_TILT);
    expect(tilt({ seed: "t", goal: "kill" }, "murder")).toBeCloseTo(MURDER_TILT);
    expect(tilt({ seed: "t", goal: "kill" }, "poison")).toBeCloseTo(POISON_TILT);
    // A kill's theft first tilts as a theft until it is done.
    expect(tilt({ seed: "t", goal: "kill", stealing: true }, "commotion")).toBeCloseTo(GOAL_TILT);
    expect(tilt({ seed: "t", goal: "kill", stealing: true }, "odd-places")).toBeCloseTo(1);
    expect(tilt({ seed: "t", playing: true }, "out-of-picture")).toBeCloseTo(PLAYING_TILT);
    // Lively, easy people about it: risks; tense ones: it lies low, never below 0.3; the habits that take no risk don't mind.
    expect(tilt({ seed: "t", goal: "bug", energy: 1 }, "alibi")).toBeCloseTo(1.5);
    expect(tilt({ seed: "t", goal: "bug", tension: 1 }, "alibi")).toBeCloseTo(MOOD_MIN);
    expect(tilt({ seed: "t", goal: "bug", tension: 1 }, "startles")).toBeCloseTo(1);
  });

  it("feeling watched pauses the habits, not the tactics, for 10 to 20 minutes; a glance while it already does adds nothing, a failed test does", () => {
    const { host, spy, covers } = scheduler({ seed: "watched", forced: [...COVERS] });
    covers.arrived();
    host.t = 30 * MIN;
    covers.step();
    const active = () => COVERS.filter((c) => covers.active(c));
    expect(active()).toEqual([...COVERS]);
    covers.watched("glance");
    const low = spy.answers.lowUntil;
    expect(low - host.t).toBeGreaterThanOrEqual(WATCHED[0]);
    expect(low - host.t).toBeLessThanOrEqual(WATCHED[1]);
    // Out of step, returns, odd places, startles, tours, the camera and the errands pause; the tactics don't (the plan's own steps wait instead).
    expect(active()).toEqual(COVERS.filter((c) => !HABIT_COVERS.has(c)));
    expect(covers.list).toEqual([...COVERS]);
    host.t += 60;
    covers.watched("glance");
    expect(spy.answers.lowUntil).toBe(low);
    expect(covers.stats.glances).toBe(1);
    covers.watched("test");
    expect(spy.answers.lowUntil).toBeGreaterThanOrEqual(low);
    expect(covers.stats.tests).toBe(1);
    host.t = spy.answers.lowUntil;
    expect(active()).toEqual([...COVERS]);
    // Playing someone, keeping out of the picture never pauses: the photos would show a face that isn't theirs.
    const playing = scheduler({ seed: "watched", forced: [...COVERS], playing: true });
    playing.covers.arrived();
    playing.host.t = 30 * MIN;
    playing.covers.watched("glance");
    expect(COVERS.filter((c) => playing.covers.active(c))).toEqual(COVERS.filter((c) => !HABIT_COVERS.has(c) || c === "out-of-picture"));
  });

  it("draws only from its own fork: one seed, one evening of covers", () => {
    const a = evening(scheduler({ seed: "same", goal: "kill" })).spells;
    const b = evening(scheduler({ seed: "same", goal: "kill" })).spells;
    expect(a).toEqual(b);
    expect(evening(scheduler({ seed: "other", goal: "kill" })).spells).not.toEqual(a);
  });
});

// ------------------------------------------------------------------ each cover's tell

/**
 * The sweep's runner (scripts/spy-sweep.ts), which shares evenings out across child processes. It
 * is loaded by path, so the typecheck (browser code, without Node's types) doesn't take it in.
 */
const SWEEP = "../scripts/spy-sweep.ts";
interface Sweep {
  runEvenings(specs: ReadonlyArray<{ house: string; size: MansionSize; party?: string; spy?: { on?: Cover[]; goal?: GoalKind } }>): Promise<Array<SpyEvening & { house: string }>>;
}

describe("each cover held on", () => {
  it("leaves its tell, under every monitor: out of step, the returns, following close, the startle, the tours, camera-shy, the alibi's opener, someone's bag", async () => {
    const at = (house: string, on: Cover[], goal?: GoalKind) => ({ house, size: "grand" as const, party: `cov-${house}`, spy: { on, goal } });
    const want: Array<[ReturnType<typeof at>, string[]]> = [
      [at("match-42", ["out-of-step"]), ["out-of-step"]],
      [at("gala-night", ["returns"], "safe"), ["returns"]],
      [at("gala-night", ["odd-places"]), ["followed"]],
      [at("gala-night", ["startles"], "ledger"), ["startled"]],
      [at("gala-night", ["tours"]), ["touring"]],
      [at("match-42", ["out-of-picture"]), ["camera-shy"]],
      [at("gala-night", ["alibi"], "safe"), ["call", "lost-off"]],
      [at("match-42", ["others-things"], "bag"), ["their-bag"]],
      [at("gala-night", ["poison", "murder"], "kill"), []],
    ];
    const { runEvenings } = (await import(/* @vite-ignore */ SWEEP)) as Sweep;
    const rs = await runEvenings(want.map(([spec]) => spec));
    for (const [k, r] of rs.entries()) {
      const [spec, tells] = want[k]!;
      const name = `${spec.spy.on.join(",")} on ${spec.house}`;
      expect(r.broken, name).toEqual([]);
      const left = new Set(r.tells.map((x) => x.what));
      for (const w of tells) expect(left.has(w as never), `${name}: ${w} among ${[...left].join(", ")}`).toBe(true);
      // Held on from its arrival until it went home.
      for (const c of spec.spy.on) {
        expect(r.covers[c].spells, name).toBe(1);
        expect(r.covers[c].mins, name).toBeCloseTo((r.leftAt - r.arrivedAt) / MIN, 1);
      }
    }
    // Out of step, it caught some of the changes late.
    expect(rs[0]!.cues.filter((c) => c.out).length).toBeGreaterThan(0);
  }, 600_000);
});

// ------------------------------------------------------------------ in one evening

type House = ReturnType<typeof generateMansion>;
const houses = new Map<string, House>();
const house = (seed: string): House => houses.get(seed) ?? houses.set(seed, generateMansion({ seed })).get(seed)!;

/** One evening a step at a time, `look` after each step until it says stop (true) or the party ends. */
function play(where: string, seed: string, spy: SpyOptions, look: (party: Party) => boolean | void = () => {}, provoke?: Provocation[]): Party {
  const party = new Party(house(where), { seed, spy, provoke });
  while (!party.over && look(party) !== true) party.step();
  return party;
}

/** The spy's notes in the log ("alibi:cut", "claim:31", ...), with their times. */
const notes = (party: Party, re: RegExp) => party.events.filter((e) => e.kind === "spy" && e.note !== undefined && re.test(e.note)).map((e) => ({ t: e.t, note: e.note! }));

describe("the false alibi", () => {
  // At dinner on orangery-1 the spy has a glass in hand and the ledger to copy: it cuts itself.
  const cutAt = { where: "orangery-1", seed: "orangery-1", spy: { on: ["alibi"], goal: "ledger" } as SpyOptions };

  /** The cut evening, watched: the wave, the wash inside, the bandage, and where it stood at the act. */
  function cutEvening(provoke?: Provocation[]) {
    let waved = -1;
    let washed = 0;
    let washRoom = -1;
    let bandaged = -1;
    let bare = -1;
    let back = -1;
    const act: { t: number; room: number } = { t: -1, room: -1 };
    const party = play(
      cutAt.where,
      cutAt.seed,
      cutAt.spy,
      (party) => {
        const spy = party.spy;
        if (!spy) return;
        const p = spy.record;
        const a = spy.tactics.alibi;
        if (a?.kind === "cut" && a.opened && waved < 0 && p.gesture === "wave") waved = party.t;
        const label = party.tasks.of(p)?.steps[party.tasks.of(p)!.i]?.label ?? "";
        if (a?.kind === "cut" && a.stage === "away" && act.t < 0 && label.startsWith("await:")) Object.assign(act, { t: party.t, room: p.room });
        if (a?.kind === "cut" && a.to >= 0 && back < 0) back = a.to;
        if (a?.stage === "washing" && p.action?.note === "inside") {
          washed += STEP;
          washRoom = p.room;
        }
        if (p.bandage && bandaged < 0) bandaged = party.t;
        if (bandaged >= 0 && !p.bandage && bare < 0) bare = party.t;
      },
      provoke,
    );
    return { party, waved, washed, washRoom, bandaged, bare, back, act };
  }

  it("a cut at dinner: the crash and the help waved off, a wash far longer than anyone's, the bandage once it's back and off again within the hour", () => {
    const { party, waved, washed, washRoom, bandaged, bare, act } = cutEvening();
    const spy = party.spy!;
    const cut = party.events.find((e) => e.kind === "mishap" && e.actors[0] === spy.id && e.note === "cut:staged")!;
    expect(cut).toBeDefined();
    // Up from the table with the glass in its hand.
    expect(notes(party, /^up-from-dinner$/).some((x) => cut.t - x.t >= 0 && cut.t - x.t <= 1)).toBe(true);
    expect(notes(party, /^alibi:cut$/).map((x) => x.t)).toEqual([cut.t]);
    expect(waved - cut.t).toBeGreaterThanOrEqual(0);
    expect(waved - cut.t).toBeLessThanOrEqual(3);
    // Off to the act first, then the wash: six minutes or more inside, where milestone 2's visits take three at most.
    expect(act.t).toBeGreaterThan(cut.t);
    expect(act.room).not.toBe(washRoom);
    expect(washed).toBeGreaterThanOrEqual(6 * MIN);
    expect(bandaged).toBeGreaterThan(act.t + washed);
    // The bandage off within the hour, in a bathroom, and the bare hand seen for what it is by someone who saw the bandage.
    expect(bare - bandaged).toBeGreaterThanOrEqual(15 * MIN);
    expect(bare - bandaged).toBeLessThanOrEqual(60 * MIN);
    expect(notes(party, /^bandage-off$/).map((x) => x.t)).toEqual([bare]);
    expect(spy.measure.tells.filter((x) => x.what === "cut-off" || x.what === "bare-hand").map((x) => x.what)).toEqual(["cut-off", "bare-hand"]);
    expect(party.people.filter((q) => party.memory.witnessed(q.id, "bandage-gone", spy.id)).length).toBeGreaterThan(0);
  }, 60_000);

  it("back at table, it says it was in the bathroom all along; anyone who saw it elsewhere then finds it in two places at once", () => {
    const base = cutEvening();
    const spy = base.party.spy!;
    const claims = notes(base.party, /^claim:/);
    expect(claims.length).toBeGreaterThan(0);
    const [told] = claims;
    expect(told!.note).toBe(`claim:${base.washRoom}`);
    // Those beside it at table hold the claim (as well as they took it in): the bathroom, from about the cut until it was back.
    const heard = base.party.people.filter((q) => base.party.register.entriesOf(q.id).some((x) => x.claim && x.who === spy.id));
    expect(heard.length).toBeGreaterThan(0);
    const p = spy.record;
    for (const q of heard) expect(Math.hypot(q.x - p.x, q.z - p.z) < 3 || !q.present, `${q.id} beside it`).toBe(true);
    expect(heard.filter((q) => base.party.register.entriesOf(q.id).some((x) => x.claim && x.who === spy.id && x.room === base.washRoom)).length).toBeGreaterThan(heard.length / 2);
    expect(base.party.events.some((e) => e.kind === "conflict" && e.actors[1] === spy.id)).toBe(false);
    // The same evening, each of them having seen it in the act's room halfway through, with their own eyes: as well as they
    // remember the times (wine at dinner blurs them), one or more of them can't have it both ways.
    const cut = base.party.events.find((e) => e.kind === "mishap" && e.actors[0] === spy.id && e.note === "cut:staged")!;
    const seen: Provocation[] = heard.map((q) => ({ t: (cut.t + base.back) / 2, kind: "seen", subject: spy.id, room: base.act.room, witness: q.id }));
    const again = cutEvening(seen);
    const caught = again.party.events.filter((e) => e.kind === "conflict" && e.actors[1] === spy.id && heard.some((q) => q.id === e.actors[0]));
    expect(caught.length).toBeGreaterThan(0);
    for (const e of caught) expect(e.t).toBeGreaterThanOrEqual(told!.t);
    expect(caught.some((e) => e.note === "claim")).toBe(true);
    expect(again.party.register.stats.broken).toBeGreaterThan(base.party.register.stats.broken);
  }, 120_000);

  it("a lost thing, a call and a spill: back at once with the thing, the call held in the act's room facing the wall, back clean in the same clothes", () => {
    // On villa-3 the spy is after the guest ledger in the hall, and stages all three in one evening.
    const lost = { from: -1, back: -1, knew: [] as number[], found: [] as number[] };
    const spill = { from: -1, back: -1, washed: 0, color: "", after: "", stain: "" as string | null, clean: [] as number[], sawIt: [] as number[] };
    let call: { room: number; yaw: number; wall: number; alone: boolean } | null = null;
    const party = play("villa-3", "cov-villa-3", { on: ["alibi"], goal: "ledger" }, (party) => {
      const spy = party.spy;
      if (!spy) return;
      const p = spy.record;
      const a = spy.tactics.alibi;
      const m = party.memory;
      const t = party.tasks.of(p);
      if (a?.kind === "lost" && a.opened) {
        if (lost.from < 0) lost.from = a.from;
        if (a.to >= 0 && lost.back < 0) {
          lost.back = a.to;
          lost.knew = party.people.filter((q) => m.witnessed(q.id, "lost-thing", p.id, lost.from)).map((q) => q.id);
        }
      }
      if (lost.back >= 0 && !lost.found.length && party.t >= lost.back + 20 * MIN) lost.found = party.people.filter((q) => m.witnessed(q.id, "found-at-once", p.id)).map((q) => q.id);
      if (!call && t?.steps[t.i]?.label === "call" && p.action?.startedAt !== null) {
        const r = party.bp.rooms[p.room]!.inner;
        const walls = [
          { d: p.x - r.x0, x: r.x0, z: p.z },
          { d: r.x1 - p.x, x: r.x1, z: p.z },
          { d: p.z - r.z0, x: p.x, z: r.z0 },
          { d: r.z1 - p.z, x: p.x, z: r.z1 },
        ].sort((u, v) => u.d - v.d);
        const alone = !party.people.some((q) => q !== p && q.present && !q.gone && q.room === p.room);
        call = { room: p.room, yaw: p.yaw, wall: yawTo(p.x, p.z, walls[0]!.x, walls[0]!.z), alone };
      }
      if (a?.kind === "spill" && a.opened) {
        if (spill.from < 0) {
          spill.from = a.from;
          spill.color = p.look.color;
        }
        if (a.stage === "washing" && p.action?.note === "inside") spill.washed += STEP;
        if (a.to >= 0 && spill.back < 0) {
          spill.back = a.to;
          spill.after = p.look.color;
          spill.stain = p.stain;
        }
      }
      if (spill.back >= 0 && !spill.clean.length && party.t >= spill.back + 20 * MIN) {
        spill.clean = party.people.filter((q) => m.witnessed(q.id, "no-stain", p.id)).map((q) => q.id);
        spill.sawIt = spill.clean.filter((i) => m.witnessed(i, "spill", p.id, spill.from, p.id));
      }
    });
    const spy = party.spy!;
    const p = spy.record;
    const told = (what: string) => spy.measure.tells.filter((x) => x.what === what);
    // The lost thing: a pat at its pockets, the thing named to those beside it, and back with it at once, no searching.
    expect(told("lost-off").length).toBe(1);
    expect(lost.knew.length).toBeGreaterThan(0);
    expect(lost.found.length).toBeGreaterThan(0);
    for (const i of lost.found) expect(lost.knew).toContain(i);
    // Where it says it was: the cloakroom its coat hangs in.
    expect(notes(party, /^claim:/).some((x) => x.t > lost.back && x.note === `claim:${party.world.items.room[p.coat]}`)).toBe(true);
    // The call: the phone to its ear where it stood, then held in the act's room, empty, turned to the nearest wall.
    expect(call).not.toBeNull();
    expect(spy.goal.rooms).toContain(call!.room);
    expect(call!.alone).toBe(true);
    expect(Math.abs(Math.atan2(Math.sin(call!.yaw - call!.wall), Math.cos(call!.yaw - call!.wall)))).toBeLessThan(0.05);
    expect(told("call").length).toBeGreaterThan(0);
    // The spill: down itself, sponged out in a bathroom (a visit and one and a half to two and a half minutes more), back
    // clean in the same clothes, which those who saw the spill make something of.
    expect(told("spill-off").length).toBe(1);
    expect(spill.washed).toBeGreaterThanOrEqual(3.5 * MIN);
    expect(spill.washed).toBeLessThanOrEqual(6.5 * MIN + STEP);
    expect(spill.stain).toBeNull();
    expect(spill.after).toBe(spill.color);
    expect(told("clean-shirt").length).toBe(1);
    expect(spill.clean.length).toBeGreaterThan(0);
    expect(spill.sawIt).toEqual(spill.clean);
  }, 60_000);
});

describe("keeping out of the picture", () => {
  it("with a clean way out it walks off ahead of the candid shot, for a drink or the bathroom; with none, it stands in the group photo like anyone, facing the camera", () => {
    const shots: Array<{ t: number; kind: string; with: boolean; facing: number }> = [];
    let seen = 0;
    const party = play("gala-night", "gala-night", { on: ["out-of-picture"] }, (party) => {
      const spy = party.spy;
      if (!spy) return;
      for (; seen < party.events.length; seen++) {
        const e = party.events[seen]!;
        if (e.kind !== "photo") continue;
        const ph = party.people[e.actors[0]!]!;
        const p = spy.record;
        const d = Math.atan2(ph.x - p.x, ph.z - p.z) - p.yaw;
        shots.push({ t: e.t, kind: e.note!, with: e.actors.slice(1).includes(spy.id), facing: Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) });
      }
    });
    const spy = party.spy!;
    // Slipping out: an ordinary errand, never caught in the next shot.
    const slips = notes(party, /^slip:/);
    expect(slips.length).toBeGreaterThan(0);
    for (const x of slips) {
      expect(x.note).toMatch(/^slip:(drink|toilet)$/);
      const next = shots.find((y) => y.t > x.t)!;
      expect(next.t - x.t).toBeLessThan(2 * MIN);
      expect(next.with, `the shot after ${x.note} at ${x.t}`).toBe(false);
    }
    expect(spy.measure.tells.some((x) => x.what === "camera-shy")).toBe(true);
    // The group photo called with no clean way out: in the line like anyone, facing the camera at each flash.
    const call = party.events.find((e) => e.kind === "beat" && e.note === "photo-call")!;
    expect(notes(party, /^photo-stays:/).some((x) => Math.abs(x.t - call.t) < 1)).toBe(true);
    const group = shots.filter((x) => x.kind === "group");
    expect(group.length).toBeGreaterThan(0);
    for (const g of group) {
      expect(g.with).toBe(true);
      expect(g.facing).toBeLessThan(Math.PI / 4);
    }
  }, 60_000);
});

describe("dropping what it's doing", () => {
  it("fetching a drink for someone as a step of its plan comes up, it sets the drink down where it stands and goes; the one who asked waits, then comes looking", () => {
    // On gala-night with the bag to go through: asked for a drink by whoever stands nearest it, early in the evening.
    let errand: Task | null = null;
    let asker = -1;
    let agreed = false;
    let dropped = -1;
    let looked = -1;
    const party = play("gala-night", "gala-night", { on: ["drops"], goal: "bag" }, (party) => {
      const spy = party.spy;
      if (!spy) return;
      const p = spy.record;
      if (!errand) {
        if (party.t < 20 * MIN || party.phase.id !== "mingle" || !p.present || party.tasks.of(p) || !p.action || !["mingle", "drink", "art", "wander"].includes(p.action.id)) return;
        const near = party.people.filter(
          (q) => q !== p && q.present && !q.staff && q.role !== "host" && q.room === p.room && Math.hypot(q.x - p.x, q.z - p.z) < 3 && q.action?.id === "mingle" && !party.tasks.of(q),
        );
        const q = near.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        if (!q) return;
        errand = party.tasks.errand("drink", p, q, -1, party.places.bars.find((b) => b.room !== p.room) ?? party.places.bars[0]!, q);
        asker = q.id;
        return;
      }
      if (errand.outcome === null) agreed ||= errand.i > errand.steps.findIndex((x) => x.label === "agree");
      if (dropped < 0 && errand.outcome === "dropped") dropped = party.t;
      if (dropped >= 0 && looked < 0 && party.tasks.of(party.people[asker]!)?.kind === "search") looked = party.t;
      return looked >= 0;
    });
    const spy = party.spy!;
    expect(errand).not.toBeNull();
    // It said yes, went for the drink, and left it somewhere when the moment came.
    expect(agreed).toBe(true);
    expect(dropped).toBeGreaterThan(0);
    expect(notes(party, /^drop/)).toEqual([{ t: dropped, note: "drop:glass" }]);
    expect(spy.measure.tells.filter((x) => x.what === "abandoned").map((x) => x.t)).toEqual([dropped]);
    expect(spy.habits.stats.drops).toBe(1);
    // Two to four minutes on, the one who asked goes looking for it.
    expect(looked - dropped).toBeGreaterThanOrEqual(2 * MIN);
    expect(looked - dropped).toBeLessThanOrEqual(4 * MIN + 2);
    expect(spy.habits.stats.asked).toBe(1);
  }, 60_000);
});

describe("a commotion", () => {
  it("the room never looking away, it leans on the switch: 10 to 30 s of dark, and the statuette palmed in it", () => {
    let dark = -1;
    let room = -1;
    let palmed = -1;
    let litAtPalm = true;
    let back = -1;
    let seen = 0;
    const party = play("gala-night", "cov-gala-night", { on: ["commotion"], goal: "statuette" }, (party) => {
      const spy = party.spy;
      if (!spy) return;
      // The crowd never looks away for it.
      if (!seen) spy.plans.blocked.set("look-away", Infinity);
      for (; seen < party.events.length; seen++) {
        const e = party.events[seen]!;
        if (e.kind !== "spy" || e.actors[0] !== spy.id) continue;
        if (e.note === "lights" && dark < 0) {
          dark = e.t;
          room = spy.record.room;
        } else if (e.note === "did:palm") {
          palmed = e.t;
          litAtPalm = !!party.world.lightOn[room];
        }
      }
      if (dark >= 0 && back < 0 && party.world.lightOn[room]) back = party.t;
      return spy.goal.doneAt !== null && back >= 0;
    });
    const spy = party.spy!;
    expect(notes(party, /^plan:/)[0]!.note).toContain("commotion");
    expect(dark).toBeGreaterThan(0);
    expect(spy.goal.rooms).toContain(room);
    expect(party.events.some((e) => e.kind === "mishap" && e.actors[0] === spy.id && e.note === "switch" && e.t === dark)).toBe(true);
    expect(spy.measure.tells.filter((x) => x.what === "dark").map((x) => x.t)).toEqual([dark]);
    // In the dark, and the lights back by themselves 10 to 30 s after they went.
    expect(palmed).toBeGreaterThan(dark);
    expect(litAtPalm).toBe(false);
    expect(back - dark).toBeGreaterThanOrEqual(10);
    expect(back - dark).toBeLessThanOrEqual(30 + STEP);
    expect(spy.tactics.stats.lights).toBe(1);
  }, 60_000);
});

describe("other people's things", () => {
  it("its drink down the bag's owner, who leaves the bag on a chair to go and change; the bag carried to an empty room, gone through there and put back where it lay", () => {
    let seen = 0;
    let carry: { t: number; bag: number; room: number; x: number; z: number; owner: number; ownerHeld: boolean } | null = null;
    let act: { room: number; alone: boolean } | null = null;
    let back: { t: number; room: number; x: number; z: number; state: string } | null = null;
    const party = play("match-42", "cov-match-42", { on: ["others-things"], goal: "bag" }, (party) => {
      const spy = party.spy;
      if (!spy) return;
      const items = party.world.items;
      const p = spy.record;
      for (; seen < party.events.length; seen++) {
        const e = party.events[seen]!;
        if (e.kind !== "spy" || e.actors[0] !== spy.id) continue;
        if (e.note?.startsWith("carry:")) {
          const c = spy.tactics.carry!;
          const owner = items.owner[c.bag]!;
          carry = { t: e.t, bag: c.bag, room: c.at.room, x: c.at.x, z: c.at.z, owner, ownerHeld: party.people[owner]!.held === "bag" };
        } else if (e.note === "risky:bag") act = { room: p.room, alone: !party.people.some((q) => q !== p && q.present && !q.gone && q.room === p.room) };
        else if (e.note === "put-back" && carry) back = { t: e.t, room: items.room[carry.bag]!, x: items.x[carry.bag]!, z: items.z[carry.bag]!, state: items.stateOf(carry.bag) };
      }
      return back !== null;
    });
    const spy = party.spy!;
    // The spill: its drink down the bag's owner.
    const spill = party.events.find((e) => e.kind === "mishap" && e.note === "spill" && e.actors[1] === spy.id)!;
    expect(spill).toBeDefined();
    expect(carry).not.toBeNull();
    expect(spill.actors[0]).toBe(carry!.owner);
    expect(notes(party, /^spill:/).map((x) => x.note)).toEqual([`spill:${carry!.owner}`]);
    expect(carry!.t).toBeGreaterThan(spill.t);
    expect(carry!.ownerHeld).toBe(false);
    // Gone through somewhere else, with nobody there; put back within a step or two of where it lay.
    expect(act).not.toBeNull();
    expect(act!.room).not.toBe(carry!.room);
    expect(act!.alone).toBe(true);
    expect(back).not.toBeNull();
    expect(back!.state).toBe("down");
    expect(back!.room).toBe(carry!.room);
    expect(Math.hypot(back!.x - carry!.x, back!.z - carry!.z)).toBeLessThanOrEqual(3);
    // Carrying someone's bag shows the whole time it has it.
    const tell = spy.measure.tells.find((x) => x.what === "their-bag")!;
    expect(tell.t).toBe(carry!.t);
    expect(tell.until).toBe(back!.t);
    expect(spy.tactics.stats.carried).toBe(1);
  }, 60_000);
});

describe("the innocent twins", () => {
  it("guests fetch each other drinks and set their bags down every evening, with no spy at all; with one, its soft tells never outnumber the innocents' twins", () => {
    for (const [where, seed] of [
      ["gala-night", "twins-1"],
      ["villa-3", "twins-2"],
    ] as const) {
      const party = new Party(house(where), { seed });
      party.advance(PARTY_LENGTH);
      expect(party.spy).toBeNull();
      expect(party.stats.fetched, where).toBeGreaterThan(0);
      expect(party.bags.stats.down, where).toBeGreaterThan(0);
      expect(party.bags.stats.back, where).toBeGreaterThan(0);
    }
    for (const [where, seed] of [
      ["gala-night", "twins-3"],
      ["match-42", "twins-4"],
      ["orangery-1", "twins-5"],
    ] as const) {
      const party = new Party(house(where), { seed, spy: true });
      party.advance(PARTY_LENGTH);
      const m = party.spy!.measure;
      const soft = m.tells.filter((x) => x.kind === "cover").length;
      expect(m.twins.length, `${where}: ${m.twins.length} twins, ${soft} soft tells`).toBeGreaterThanOrEqual(soft);
    }
  }, 120_000);
});
