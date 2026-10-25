/**
 * The spy, milestone 3 PR 5 "Killing and faces" (technical plan: Killing, bodies and poison):
 * each way of killing set up by hand in a quiet room during dinner, from the moment to the body
 * hidden, and a witness at a strangling, who backs away to tell while the victim, let go out
 * cold, comes to. Then someone gone without a word, looked for and said to be missing, and the
 * spy silencing someone sure of it, once.
 */
import { describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import { yawTo } from "../src/party/places";
import { Party } from "../src/party/sim";
import { FINISH, STRUGGLE, type KillStage } from "../src/party/spy";
import type { Person } from "../src/party/types";

const MIN = 60;
const bp = generateMansion({ seed: "gala-night" });

/** A guest of gala-night's who came alone, for the spy to kill: nobody looks for them at dinner. */
function alone(seed: string): { party: Party; q: Person } {
  const probe = new Party(bp, { seed, spy: { setup: "self", goal: "kill" } });
  const q = probe.people.find((o) => !o.staff && o.role === "guest" && o.partner === null && o.id !== probe.spyId)!;
  const party = new Party(bp, { seed, spy: { setup: "self", goal: "kill", target: q.id, on: ["murder"] } });
  return { party, q: party.people[q.id]! };
}

/** Somewhere to stand in a room, a little off its middle. */
function spotIn(party: Party, room: number, dx = 0, dz = 0) {
  const r = bp.rooms[room]!;
  const w = party.pf.snap(r.level, (r.inner.x0 + r.inner.x1) / 2 + dx, (r.inner.z0 + r.inner.z1) / 2 + dz, 2)!;
  expect(party.pf.roomAt(r.level, w.x, w.z)).toBe(room);
  return { level: r.level, x: w.x, z: w.z, room };
}

/** Out of whatever they were doing and stood at a spot, facing a way, not thinking again for a while. */
function put(party: Party, p: Person, s: { level: number; x: number; z: number; room: number }, yaw: number, think = 30 * MIN): void {
  party.end(p, false);
  p.level = s.level;
  p.x = s.x;
  p.z = s.z;
  p.room = s.room;
  p.y = bp.rooms[s.room]!.floorY;
  p.yaw = yaw;
  p.path = [];
  p.pathIndex = 0;
  p.thinkAt = party.t + think;
}

/** The room the dinner is in, and an upstairs bedroom with nobody in it. */
function quietBedroom(party: Party): number {
  const r = bp.rooms.find((x) => x.level === 1 && x.type === "bedroom" && !party.places.guestBedrooms.includes(x) && !party.people.some((o) => o.present && o.room === x.index))!;
  return r.index;
}

/** Step until the kill ends (or `secs` pass), the stages it went through in order. */
function run(party: Party, secs: number, each?: (stage: KillStage | null) => void): KillStage[] {
  const spy = party.spy!;
  const seen: KillStage[] = [];
  const end = party.t + secs;
  while (party.t < end) {
    party.step();
    const s = spy.kill.stage;
    each?.(s);
    if (s && seen[seen.length - 1] !== s) seen.push(s);
    if (!s && seen.length) break;
  }
  return seen;
}

describe("killing", () => {
  it("strangles someone alone from behind, drags them off, holds on until they're dead, and hides the body", () => {
    const { party, q } = alone("kill-1");
    const dinner = party.programme.find((ph) => ph.id === "dinner")!;
    party.advance(dinner.start + 10 * MIN);
    const spy = party.spy!;
    const p = spy.record;
    expect(p.present && q.present).toBe(true);
    const room = quietBedroom(party);
    const at = spotIn(party, room);
    put(party, q, at, 0);
    // A step behind them.
    put(party, p, { ...at, z: at.z - 0.8 }, 0);
    const m = spy.kill.moment(p, q, { strangle: true, inject: false });
    expect(m?.how).toBe("strangled");
    expect(["bath", "bathroom", "store", "bed", "wardrobe"]).toContain(m!.hide.place);
    expect(spy.kill.begin(p, q, m!, "goal")).toBe(true);
    const t0 = party.t;
    let gripAt = -1;
    let deadAt = -1;
    const stages = run(party, 15 * MIN, (s) => {
      if (s === "struggle" && gripAt < 0) gripAt = party.t;
      if (q.down === "dead" && deadAt < 0) deadAt = party.t;
    });
    // Stepping out, when there's a door to step out of, ends with the task.
    expect(stages.filter((s) => s !== "out")).toEqual(["close", "struggle", "drag", "finish", "hide"]);
    // Out cold after the struggle, dead only after holding on.
    expect(gripAt - t0).toBeLessThan(5);
    expect(deadAt - gripAt).toBeGreaterThanOrEqual(STRUGGLE[0] + FINISH[0] - 1);
    expect(q.down).toBe("dead");
    expect(q.present).toBe(false);
    expect(spy.bodies).toHaveLength(1);
    expect(spy.bodies[0]).toMatchObject({ who: q.id, how: "strangled", hides: m!.hide.hides });
    expect(spy.goal.triedAt).not.toBeNull();
    expect(spy.goal.doneAt).toBe(deadAt);
    const notes = party.events.filter((e) => e.kind === "down" && e.actors[0] === q.id).map((e) => e.note);
    expect(notes).toEqual(["dying", "dead", "hidden"]);
    // Nothing held or bolted behind it.
    for (const b of party.body.baths) expect(b.hold).toBe(-1);
    expect(party.world.doors.some((d) => d.locked && d.lockedBy === p.id)).toBe(false);
  });

  it("embraces someone nobody near is watching, jabs them, walks them off like a drunk friend, and they die behind the bolt", () => {
    const { party, q } = alone("kill-2");
    const dinner = party.programme.find((ph) => ph.id === "dinner")!;
    party.advance(dinner.start + 10 * MIN);
    const spy = party.spy!;
    const p = spy.record;
    // On the upstairs landing nearest a bathroom with a lock, nobody about.
    const bath = party.places.bathrooms.findIndex((b) => b.room.level === 1 && party.world.doors[b.doorId]?.lock === "inside");
    expect(bath).toBeGreaterThanOrEqual(0);
    const b = party.places.bathrooms[bath]!;
    const at = { level: b.door.level, x: b.door.x, z: b.door.z, room: b.door.room };
    put(party, q, at, 0);
    put(party, p, { ...at, x: at.x + 0.8 }, yawTo(at.x + 0.8, at.z, at.x, at.z));
    const m = spy.kill.moment(p, q, { strangle: false, inject: true });
    expect(m?.how).toBe("injection");
    expect(spy.kill.begin(p, q, m!, "goal")).toBe(true);
    let held = false;
    let bolted = false;
    const stages = run(party, 15 * MIN, (s) => {
      if (s === "dying" && m!.hide.bath >= 0) held ||= party.body.baths[m!.hide.bath]!.hold === p.id;
      if (s === "dying" && m!.hide.door >= 0) bolted ||= party.world.doors[m!.hide.door]!.locked;
    });
    expect(stages.filter((s) => s !== "out")).toEqual(["close", "embrace", "walk-off", "dying", "hide"]);
    if (m!.hide.bath >= 0) expect(held).toBe(true);
    if (m!.hide.door >= 0) expect(bolted).toBe(true);
    expect(q.down).toBe("dead");
    expect(q.present).toBe(false);
    expect(spy.bodies[0]).toMatchObject({ who: q.id, how: "injection" });
    for (const x of party.body.baths) expect(x.hold).toBe(-1);
    expect(party.world.doors.some((d) => d.locked && d.lockedBy === p.id)).toBe(false);
  });

  it("seen at a strangling, lets go once they're limp: the witness backs away to tell, and the victim comes to and tells too", () => {
    const { party, q } = alone("kill-1");
    const dinner = party.programme.find((ph) => ph.id === "dinner")!;
    party.advance(dinner.start + 10 * MIN);
    const spy = party.spy!;
    const p = spy.record;
    const room = quietBedroom(party);
    const at = spotIn(party, room);
    put(party, q, at, 0);
    put(party, p, { ...at, z: at.z - 0.8 }, 0);
    const m = spy.kill.moment(p, q, { strangle: true, inject: false });
    expect(spy.kill.begin(p, q, m!, "goal")).toBe(true);
    run(party, 10, () => {});
    expect(spy.kill.stage).toBe("struggle");
    // Someone walks in on it: two metres off, facing it.
    const w = party.people.find((o) => !o.staff && o.role === "guest" && o.present && o.id !== q.id && o.id !== p.id && o.partner !== p.id)!;
    const ws = spotIn(party, room, 0, 2);
    put(party, w, ws, yawTo(ws.x, ws.z, p.x, p.z));
    const stages = run(party, 5 * MIN);
    expect(stages).toEqual(["struggle"]);
    expect(spy.answers.danger[w.id]).toBeGreaterThanOrEqual(1);
    const said = (note: string, who: number) => party.events.some((e) => e.kind === "challenge" && e.note === note && e.actors[0] === who);
    expect(said("attack-seen", w.id)).toBe(true);
    expect(party.memory.suspects(w.id, p.id)).toBeGreaterThan(0.95);
    // Let go alive: out cold, then up again within a minute and a half, sure of it.
    expect(party.events.some((e) => e.kind === "down" && e.note === "collapsed" && e.actors[0] === q.id)).toBe(true);
    party.advance(2 * MIN);
    expect(q.down).toBeNull();
    expect(q.present).toBe(true);
    expect(said("came-to", q.id)).toBe(true);
    expect(party.memory.suspects(q.id, p.id)).toBeGreaterThan(0.95);
    expect(spy.bodies).toHaveLength(0);
    expect(spy.goal.doneAt).toBeNull();
    expect(spy.kill.stats.survived).toBe(1);
  });
});

describe("someone missing, and silencing a doubter", () => {
  it("someone gone without a word is looked for, never found, and said to be missing; whoever settles it on someone keeps them in view", () => {
    const party = new Party(bp, { seed: "miss-1" });
    party.advance(100 * MIN);
    const n = party.people.length;
    const q = party.people[18]!;
    const r = party.people[q.partner!]!;
    const l = party.people[20]!;
    expect(q.present && r.present && l.present).toBe(true);
    // The last r sees of q: in the study with l.
    const room = bp.rooms.find((x) => x.type === "study")!.index;
    const a = spotIn(party, room, -0.6, 0);
    const b = spotIn(party, room, 0.6, 0);
    const c = spotIn(party, room, 0, -2.5);
    put(party, q, a, Math.PI / 2, 2 * MIN);
    put(party, l, b, -Math.PI / 2, 2 * MIN);
    put(party, r, c, 0, 30);
    party.advance(80);
    expect(party.memory.lastRoom[r.id * n + q.id]).toBe(room);
    party.leavePlay(q);
    l.thinkAt = party.t;
    const t0 = party.t;
    while (party.t < t0 + 60 * MIN && !party.events.some((e) => e.note === "keep-in-view")) party.step();
    // They looked as long as they would, found nobody, and said so: missing, last seen in the study.
    const searches = party.tasks.list.filter((t) => t.kind === "search" && t.owner === r.id);
    expect(searches.some((t) => t.looked && t.outcome === "gave-up")).toBe(true);
    expect(searches.some((t) => t.outcome === "found")).toBe(false);
    const cs = party.register.casesOf(r.id).filter((x) => x.kind === "person-gone" && x.subject === q.id);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ room, state: "settled", firstHand: true });
    expect(cs[0]!.candidates[0]!.who).toBe(l.id);
    // Their partner keeps whoever they blame in view: wherever they last saw them scores higher.
    expect(party.events.find((e) => e.note === "keep-in-view")?.actors).toEqual([r.id, l.id, q.id]);
    expect(party.keepInView(r)).toBe(party.memory.lastRoom[r.id * n + l.id]);
    // A stranger settling it keeps nobody in view.
    const x = party.people.find((o) => o.present && !o.staff && o !== r && o.partner !== q.id && !q.friends.includes(o.id))!;
    party.settled(x.id, "person-gone", q.id, l.id);
    expect(party.keepInView(x)).toBe(-1);
  });

  it("follows its one doubter off somewhere quiet, strangles them alone and hides them, and never does it twice", () => {
    /** At 20:50 with murder on: the spy, and the first two guests it could be after. */
    const evening = () => {
      const party = new Party(bp, { seed: "silence-1", spy: { setup: "self", goal: "statuette", on: ["murder"] } });
      party.advance(110 * MIN);
      const spy = party.spy!;
      expect(party.programme[spy.phase]!.id).toBe("dancing");
      const [q, q2] = party.people.filter((o) => !o.staff && o.role === "guest" && o.present && o.id !== spy.id) as [Person, Person];
      return { party, spy, p: spy.record, q, q2 };
    };
    /** Off on a wander through an empty bedroom upstairs, the spy idling a few metres behind, seeing them go. */
    const offAlone = (party: Party, p: Person, who: Person) => {
      const room = quietBedroom(party);
      const a = spotIn(party, room, 0, 1);
      const b = spotIn(party, room, 0, -2.5);
      put(party, who, a, 0);
      party.start(who, { id: "wander", target: { ...spotIn(party, room, 1, 1.5), yaw: 0 }, duration: 120, pose: "look", gain: {} });
      put(party, p, b, yawTo(b.x, b.z, a.x, a.z), 0);
    };
    {
      // Two who saw it kill: silencing one would only leave another body.
      const { party, spy, p, q, q2 } = evening();
      spy.answers.sawKill(q.id);
      spy.answers.sawKill(q2.id);
      offAlone(party, p, q);
      party.advance(3 * MIN);
      expect(spy.silence.stats.trails).toBe(0);
      expect(q.down).toBeNull();
    }
    const { party, spy, p, q, q2 } = evening();
    spy.answers.sawKill(q.id);
    expect(spy.answers.sureOfIt(q.id)).toBe(true);
    // Meaning to silence them, it keeps them in view: the room it last saw them in.
    party.advance(2);
    expect(spy.silence.watching).toBe(q.id);
    expect(party.keepInView(p)).toBe(party.memory.lastRoom[p.id * party.people.length + q.id]);
    const tried = spy.goal.triedAt;
    const done = spy.goal.doneAt;
    const bodies = spy.bodies.length;
    offAlone(party, p, q);
    let followed = -1;
    const stages = run(party, 10 * MIN, () => {
      if (followed < 0 && spy.silence.trailing >= 0) followed = spy.silence.trailing;
    });
    expect(followed).toBe(q.id);
    expect(stages.filter((s) => s !== "out")).toEqual(["close", "struggle", "drag", "finish", "hide"]);
    expect(q.down).toBe("dead");
    expect(q.present).toBe(false);
    expect(spy.bodies).toHaveLength(bodies + 1);
    expect(spy.bodies[bodies]).toMatchObject({ who: q.id, how: "strangled" });
    expect(spy.silence.done).toBe(true);
    // Its goal is its own business: a doubter silenced neither tries nor does it.
    expect(spy.goal.triedAt).toBe(tried);
    expect(spy.goal.doneAt).toBe(done);
    // Someone else sure of it, alone in the same way: once was its one time tonight.
    spy.answers.sawKill(q2.id);
    offAlone(party, p, q2);
    const t0 = party.t;
    while (party.t < t0 + 5 * MIN) {
      party.step();
      expect(spy.silence.busy || spy.kill.busy).toBe(false);
    }
    expect(q2.down).toBeNull();
  });
});
