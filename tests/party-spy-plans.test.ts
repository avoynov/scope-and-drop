/**
 * The spy, milestone 3 PR 3 "Plans and privacy" (technical plan: Tests and the sweep): the
 * planner on hand-made fact masks, the privacy check in scenes set by hand on a house's own
 * sight, the goals' things in the house and what the crowd finds of them, and ten evenings under
 * every monitor (the privacy and the steps monitors among them).
 */
import { describe, expect, it } from "vitest";
import { generateMansion } from "../src/mansion";
import { Rng } from "../src/mansion/core/rng";
import type { MansionSize } from "../src/mansion/core/types";
import { frontOf, yawTo } from "../src/party/places";
import { DETAIL_RANGE, FOV } from "../src/party/senses";
import { Party } from "../src/party/sim";
import type { GoalKind, SpyOptions, SpySetup } from "../src/party/spy";
import { Finds } from "../src/party/spy/finds";
import { GOAL_ACTIONS, type GoalPart } from "../src/party/spy/goals";
import { ACTION_BY_ID, ACTIONS, BLOCK_COST, BLOCK_FOR, costOf, F, MAX_EXPANSIONS, plan, type PlanActionId, type PlanProblem, type Tactic } from "../src/party/spy/planner";
import { absorbed, check, CLOSE_BY, doorsNow, held, noticed, type PrivacyAsk, type Spot3 } from "../src/party/spy/privacy";
import type { ActionState, Person } from "../src/party/types";
import type { SpyEvening } from "./spy-watch";

const MIN = 60;
const bp = generateMansion({ seed: "gala-night" });
const SEED = "spy-1";
const THEFT = F.holding | F.stashed;

// ------------------------------------------------------------------ the planner

describe("the planner", () => {
  const use = (...parts: GoalPart[]) => new Set(parts.flatMap((k) => GOAL_ACTIONS[k]));
  const steps = (p: PlanProblem) => plan(p)?.steps ?? null;
  const MURDER = new Set<Tactic>(["murder"]);

  it("plans every goal from scratch the cheapest way, and nothing once the goal holds", () => {
    const want: Array<[string, PlanProblem, PlanActionId[]]> = [
      ["statuette", { start: 0, goal: THEFT, use: use("statuette") }, ["learn", "go", "look-away", "palm", "stash"]],
      ["statuette, the way known", { start: F.way, goal: THEFT, use: use("statuette") }, ["go", "look-away", "palm", "stash"]],
      ["safe, the study open", { start: F.door, goal: THEFT, use: use("safe") }, ["learn", "go", "open-safe", "papers", "stash"]],
      ["safe, the study locked", { start: 0, goal: THEFT, use: use("safe") }, ["learn", "go", "pick-lock", "open-safe", "papers", "stash"]],
      ["bag", { start: 0, goal: THEFT, use: use("bag") }, ["find-bag", "wait-owner", "bag", "stash"]],
      ["coat", { start: 0, goal: THEFT, use: use("coat") }, ["learn", "go", "look-away", "coat", "stash"]],
      ["pocket", { start: 0, goal: THEFT, use: use("pocket"), needs: { "look-away": F.close } }, ["follow", "look-away", "pocket", "stash"]],
      ["bug in a room", { start: F.door, goal: F.planted, use: use("bug-room") }, ["learn", "go", "plant"]],
      ["bug in a locked room", { start: 0, goal: F.planted, use: use("bug-room") }, ["learn", "go", "pick-lock", "plant"]],
      ["bug on the host", { start: 0, goal: F.planted, use: use("bug-host") }, ["brush-host"]],
      ["ledger", { start: 0, goal: F.copied, use: use("ledger") }, ["learn", "go", "ledger"]],
      ["kill", { start: 0, goal: F.dead, use: use("kill"), tactics: MURDER }, ["follow", "wait-alone", "strangle"]],
    ];
    for (const [name, p, s] of want) expect(steps(p), name).toEqual(s);
    expect(plan({ start: THEFT, goal: THEFT, use: use("statuette") })).toEqual({ steps: [], cost: 0, expansions: 0 });
    // A goal its actions can't bring about: no plan.
    expect(plan({ start: 0, goal: F.copied, use: use("statuette") })).toBeNull();
  });

  it("kills the cheaper way: from behind when they're alone, the embrace when they're rarely alone; with murder off, not at all", () => {
    const kill = (costs?: PlanProblem["costs"], start = 0): PlanProblem => ({ start, goal: F.dead, use: use("kill"), tactics: MURDER, costs });
    expect(steps(kill())).toEqual(["follow", "wait-alone", "strangle"]);
    // Rarely alone (their partner by them, a crowd round them): waiting dearer, so the embrace, the jab and the walk off.
    expect(steps(kill({ "wait-alone": 4 }))).toEqual(["follow", "embrace", "inject", "walk-off"]);
    // Alone somewhere private right now: straight to it.
    expect(plan(kill({ strangle: -1 }, F.close | F.alone))).toMatchObject({ steps: ["strangle"], cost: 1 });
    // A goal's own cost never takes an action below 1.
    expect(plan(kill({ strangle: -9 }, F.close | F.alone))!.cost).toBe(1);
    expect(steps({ start: 0, goal: F.dead, use: use("kill") })).toBeNull();
  });

  it("puts a kill's theft first: following the target waits for the thing stashed, and a pocket is picked at their side first", () => {
    const first = (from: "bag" | "coat" | "pocket"): PlanProblem => ({
      start: 0,
      goal: F.dead | THEFT,
      use: use("kill", from),
      tactics: MURDER,
      needs: from === "pocket" ? { "look-away": F.close, "wait-alone": F.close | F.stashed, embrace: F.close | F.stashed } : { follow: F.stashed },
    });
    expect(steps(first("bag"))).toEqual(["find-bag", "wait-owner", "bag", "stash", "follow", "wait-alone", "strangle"]);
    expect(steps(first("coat"))).toEqual(["learn", "go", "look-away", "coat", "stash", "follow", "wait-alone", "strangle"]);
    expect(steps(first("pocket"))).toEqual(["follow", "look-away", "pocket", "stash", "wait-alone", "strangle"]);
  });

  it("a locked door makes it plan again, picking the lock", () => {
    // At the study door with the way known: the door open or not is the difference.
    expect(steps({ start: F.way | F.there | F.door, goal: THEFT, use: use("safe") })).toEqual(["open-safe", "papers", "stash"]);
    expect(steps({ start: F.way | F.there, goal: THEFT, use: use("safe") })).toEqual(["pick-lock", "open-safe", "papers", "stash"]);
    // The same in a house: gala-night's study is locked with a key, so the spy, come as itself for the safe, plans to pick it.
    const party = new Party(bp, { seed: SEED, spy: { setup: "self", goal: "safe" } });
    party.advance(16 * MIN);
    const spy = party.spy!;
    const p = spy.record;
    expect(p.present).toBe(true);
    const ctx = spy.things.context(p);
    const door = spy.things.lockedDoor(ctx.room, p);
    expect(door).not.toBeNull();
    const now = () => plan({ start: spy.things.facts(p, ctx), goal: ctx.goal, use: ctx.use, needs: ctx.needs })!.steps;
    expect(now()).toContain("pick-lock");
    party.world.setLocked(door!, false, -1);
    expect(spy.things.lockedDoor(ctx.room, p)).toBeNull();
    expect(now()).not.toContain("pick-lock");
  });

  it("breaks equal costs by the table's order, whatever order the goal gives its actions in", () => {
    const at = F.there | F.unwatched | F.close;
    for (const order of [
      ["palm", "coat", "pocket"],
      ["pocket", "palm", "coat"],
      ["coat", "pocket", "palm"],
    ] as PlanActionId[][]) {
      // The three cost the same and need what holds: the table has the coat first.
      expect(steps({ start: at, goal: F.holding, use: new Set(order) }), order.join()).toEqual(["coat"]);
    }
    const a = ACTIONS.findIndex((x) => x.id === "coat");
    expect(a).toBeLessThan(ACTIONS.findIndex((x) => x.id === "pocket"));
    expect(a).toBeLessThan(ACTIONS.findIndex((x) => x.id === "palm"));
    // The same state always gives the same plan.
    const p: PlanProblem = { start: 0, goal: F.dead | THEFT, use: use("kill", "coat"), tactics: MURDER, needs: { follow: F.stashed } };
    expect(plan(p)).toEqual(plan({ ...p, use: new Set([...p.use].reverse()) }));
  });

  it("leaves a tactic's actions out until it is switched on", () => {
    expect(steps({ start: 0, goal: THEFT, use: use("statuette"), tactics: new Set<Tactic>(["touring"]) })).toEqual(["tour-alone", "go", "look-away", "palm", "stash"]);
    for (const a of ACTIONS) if (a.tactic) expect(steps({ start: a.needs, goal: a.brings, use: new Set([a.id]) }), a.id).toBeNull();
  });

  it("makes a failed action cost four times as much for 15 minutes", () => {
    const wait = ACTION_BY_ID.get("wait-owner")!;
    const blocked = new Map<PlanActionId, number>([["wait-owner", BLOCK_FOR]]);
    expect(BLOCK_COST).toBe(4);
    expect(BLOCK_FOR).toBe(15 * MIN);
    expect(costOf(wait, { blocked, t: 0 })).toBe(wait.cost * 4);
    expect(costOf(wait, { blocked, t: BLOCK_FOR - 1 })).toBe(wait.cost * 4);
    expect(costOf(wait, { blocked, t: BLOCK_FOR })).toBe(wait.cost);
    // With a spill to make the owner put the bag down (PR 4's tactic), a failed wait turns the plan to it, and back after.
    const bag = (t: number): PlanProblem => ({ start: 0, goal: THEFT, use: use("bag"), tactics: new Set<Tactic>(["things"]), blocked, t });
    expect(steps(bag(0))).toEqual(["find-bag", "spill", "bag", "stash"]);
    expect(steps(bag(BLOCK_FOR))).toEqual(["find-bag", "wait-owner", "bag", "stash"]);
    // With no other way it plans the failed one again, at the higher cost.
    const p: PlanProblem = { start: 0, goal: THEFT, use: use("bag"), blocked, t: 0 };
    expect(plan(p)).toMatchObject({ steps: ["find-bag", "wait-owner", "bag", "stash"], cost: 7 + wait.cost * 3 });
  });

  it("gives up past 200 expansions", () => {
    expect(MAX_EXPANSIONS).toBe(200);
    const all = new Set(ACTIONS.map((a) => a.id));
    const tactics = new Set<Tactic>(["touring", "things", "commotion", "murder", "tour"]);
    const every = ACTIONS.reduce((m, a) => m | a.brings, 0) & ~(F.alone | F.arms | F.sagging | F.dead | F.trusted);
    // Every fact first, then the target alone: such a plan exists...
    const chain: PlanActionId[] = ["learn", "go", "pick-lock", "open-safe", "find-bag", "wait-owner", "look-away", "papers", "stash", "plant", "ledger", "follow", "wait-alone"];
    const needs = { "wait-alone": every };
    let m = 0;
    for (const id of chain) {
      const need = id === "wait-alone" ? every : ACTION_BY_ID.get(id)!.needs;
      expect(m & need, id).toBe(need);
      m |= ACTION_BY_ID.get(id)!.brings;
    }
    expect(m & F.alone).toBe(F.alone);
    // ...but finding it takes more than 200 expansions, so the search gives up; with three facts first it finds one within them.
    expect(plan({ start: 0, goal: F.alone, use: all, tactics, needs })).toBeNull();
    const three = plan({ start: 0, goal: F.alone, use: all, tactics, needs: { "wait-alone": F.close | F.copied | F.planted } });
    expect(three).not.toBeNull();
    expect(three!.expansions).toBeLessThanOrEqual(MAX_EXPANSIONS);
  });
});

// ------------------------------------------------------------------ the privacy check

/** gala-night at 19:40 with everyone out of play, for scenes set by hand on the house's own sight. */
function emptyHouse(seed: string): Party {
  const party = new Party(bp, { seed });
  party.advance(40 * MIN);
  for (const q of party.people) q.present = false;
  return party;
}

/** Someone stood at a point facing `yaw`, with nothing to do and nowhere to go. */
function stand(party: Party, q: Person, at: { level: number; x: number; z: number }, yaw: number): Person {
  q.present = true;
  q.gone = false;
  q.level = at.level;
  q.x = at.x;
  q.z = at.z;
  q.yaw = yaw;
  q.room = party.pf.roomAt(at.level, at.x, at.z);
  q.y = bp.rooms[q.room]?.floorY ?? 0;
  q.path = [];
  q.pathIndex = 0;
  q.action = null;
  q.lookUntil = -1e9;
  return q;
}

/** Doing something that holds the eyes since now, for `secs`. */
function doing(party: Party, q: Person, id: "dance" | "toast", secs: number): void {
  q.action = { id, target: null, duration: secs, startedAt: party.t, pose: id === "dance" ? "dance" : "stand", gain: {} } as ActionState;
}

/** A spot in a room and a point `d` from it with a clear line between, both on open floor. */
function twoPoints(party: Party, room: number, d: number): { at: Spot3; w: { level: number; x: number; z: number } } {
  const rng = new Rng(`scene/${room}/${d}`);
  for (let k = 0; k < 400; k++) {
    const s = party.cells.random(room, rng, 1);
    if (!s) break;
    const a = rng.next() * 2 * Math.PI;
    const w = party.pf.snap(s.level, s.x + d * Math.sin(a), s.z + d * Math.cos(a), 0.3);
    if (!w || party.pf.roomAt(w.level, w.x, w.z) !== room || Math.abs(Math.hypot(w.x - s.x, w.z - s.z) - d) > 0.3) continue;
    if (!party.sight.clear(s.level, s.x, s.z, w.x, w.z)) continue;
    return { at: { level: s.level, x: s.x, z: s.z, y: bp.rooms[room]!.floorY, room }, w };
  }
  throw new Error(`no clear pair in room ${room}`);
}

describe("the privacy check", () => {
  it("sees a point by the same rules as a person: visibleAt() agrees with canSee() for every pair, and a wider view sees no less", () => {
    const party = new Party(bp, { seed: "plans-sight" });
    let pairs = 0;
    let seen = 0;
    for (const t of [40 * MIN, 95 * MIN, 130 * MIN]) {
      party.advance(t - party.t);
      const here = party.people.filter((q) => q.present && !q.gone);
      for (const a of here)
        for (const b of here) {
          if (a === b) continue;
          const at = { level: b.level, x: b.x, z: b.z, y: b.y, room: b.room };
          const can = party.senses.canSee(a, b);
          expect(party.senses.visibleAt(a, at, FOV, b) !== null, `${a.id} ${b.id} at ${t}`).toBe(can);
          if (can) expect(party.senses.visibleAt(a, at, Math.PI, b)).not.toBeNull();
          pairs++;
          if (can) seen++;
        }
    }
    expect(pairs).toBeGreaterThan(3000);
    expect(seen).toBeGreaterThan(100);
  }, 30_000);

  const party = emptyHouse("plans-scene");
  const room = party.places.toastRoom.index;
  const { at, w: wAt } = twoPoints(party, room, 3);
  const [self, w, x] = party.people.filter((q) => !q.staff && q.role === "guest");
  const toward = yawTo(wAt.x, wAt.z, at.x, at.z);
  const ask = (mode: "alone" | "unwatched", more: Partial<PrivacyAsk> = {}): PrivacyAsk => ({ mode, at, secs: 30, self: self!, who: null, ...more });
  const reset = () => {
    for (const q of party.people) q.present = false;
    stand(party, self!, at, toward);
  };

  it("alone counts anyone present whichever way they face; unwatched only those facing the spot", () => {
    reset();
    stand(party, w!, wAt, toward);
    expect(check(party, ask("alone"))).toEqual({ ok: false, by: [{ who: w!.id, why: "sees" }] });
    expect(check(party, ask("unwatched"))).toEqual({ ok: false, by: [{ who: w!.id, why: "sees" }] });
    w!.yaw = toward + Math.PI;
    expect(check(party, ask("alone")).by).toEqual([{ who: w!.id, why: "sees" }]);
    expect(check(party, ask("unwatched")).ok).toBe(true);
    // The one at the spot is never in its own way.
    w!.present = false;
    expect(check(party, ask("alone")).ok).toBe(true);
  });

  it("unwatched leaves out whoever the floor or the toast holds, but never the owner of the things; alone counts them all", () => {
    reset();
    stand(party, w!, wAt, toward);
    doing(party, w!, "dance", 600);
    expect(held(party, w!)).toBe(true);
    expect(absorbed(party, { mode: "unwatched" }, w!)).toBe(true);
    expect(absorbed(party, { mode: "unwatched", owner: w!.id }, w!)).toBe(false);
    expect(absorbed(party, { mode: "alone" }, w!)).toBe(false);
    expect(check(party, ask("unwatched")).ok).toBe(true);
    expect(check(party, ask("unwatched", { owner: w!.id })).by).toEqual([{ who: w!.id, why: "sees" }]);
    expect(check(party, ask("alone")).by).toEqual([{ who: w!.id, why: "sees" }]);
    // A dance that ends before the step is done lets them go where they would see it.
    doing(party, w!, "dance", 10);
    expect(check(party, ask("unwatched")).by).toEqual([{ who: w!.id, why: "let-go" }]);
    doing(party, w!, "toast", 600);
    expect(check(party, ask("unwatched")).ok).toBe(true);
  });

  it("counts only those who'd know whose the things are, and for a small act only those close enough to make it out", () => {
    reset();
    stand(party, w!, wAt, toward);
    expect(check(party, ask("unwatched", { who: (q) => q.id === x!.id })).ok).toBe(true);
    expect(check(party, ask("unwatched", { who: (q) => q.id === w!.id })).ok).toBe(false);
    // Three metres off: within the detail of a look, not within two.
    expect(check(party, ask("unwatched", { within: DETAIL_RANGE })).ok).toBe(false);
    expect(check(party, ask("unwatched", { within: 2 })).ok).toBe(true);
  });

  it("blocks a step someone's route brings them in on before it is done, as far as they walk in the time", () => {
    reset();
    // Someone across the room with their back to the spot, about to walk past it.
    const far = twoPoints(party, room, 7);
    stand(party, self!, far.at, 0);
    stand(party, w!, far.w, yawTo(far.at.x, far.at.z, far.w.x, far.w.z));
    const ask7 = (secs: number): PrivacyAsk => ({ mode: "unwatched", at: far.at, secs, self: self!, who: null });
    expect(check(party, ask7(30)).ok).toBe(true);
    const beyond = party.pf.snap(far.at.level, 2 * far.at.x - far.w.x, 2 * far.at.z - far.w.z, 3);
    const route = beyond ? party.pf.route({ level: w!.level, x: w!.x, z: w!.z }, beyond) : null;
    expect(route?.length).toBeGreaterThan(0);
    w!.path = route!;
    w!.pathIndex = 0;
    w!.speed = 1.3;
    expect(check(party, ask7(30)).by).toEqual([{ who: w!.id, why: "coming" }]);
    // So slow that the step is done before they get anywhere.
    w!.speed = 0.05;
    expect(check(party, ask7(2)).ok).toBe(true);
  });

  it("foresees only whoever it sees or hears: the same walker, out of its sight and earshot, may walk in on it", () => {
    reset();
    const far = twoPoints(party, room, 7);
    stand(party, w!, far.w, yawTo(far.at.x, far.at.z, far.w.x, far.w.z));
    const beyond = party.pf.snap(far.at.level, 2 * far.at.x - far.w.x, 2 * far.at.z - far.w.z, 3);
    w!.path = party.pf.route({ level: w!.level, x: w!.x, z: w!.z }, beyond!)!;
    w!.pathIndex = 0;
    w!.speed = 1.3;
    const ask7: PrivacyAsk = { mode: "unwatched", at: far.at, secs: 30, self: self!, who: null };
    // Waiting a storey away, it neither sees nor hears them.
    const upstairs = bp.rooms.find((r) => r.level !== far.at.level && !r.doubleHeight && party.cells.random(r.index, new Rng("up"), 1));
    stand(party, self!, party.cells.random(upstairs!.index, new Rng("up"), 1)!, 0);
    expect(check(party, ask7).ok).toBe(true);
    // Back across the room from them, it sees them coming.
    stand(party, self!, far.at, 0);
    expect(check(party, ask7).by).toEqual([{ who: w!.id, why: "coming" }]);
  });

  it("waits for someone next door by an open doorway when it needs the room alone, not for an act done as if its own", () => {
    reset();
    // Someone just through an open doorway in the next room, out of view of the spot, facing away from the doorway.
    let found: { spot: { level: number; x: number; z: number }; yaw: number } | null = null;
    for (const e of party.world.graph[room]!) {
      if (e.kind !== "door" || e.to < 0 || e.level !== at.level || (e.door >= 0 && party.world.doors[e.door]!.open < 0.5)) continue;
      for (let r = 1; r <= 4 && !found; r += 0.5)
        for (let k = 0; k < 16 && !found; k++) {
          const s = party.pf.snap(e.level, e.x + r * Math.sin((k * Math.PI) / 8), e.z + r * Math.cos((k * Math.PI) / 8), 0.2);
          if (!s || party.pf.roomAt(s.level, s.x, s.z) !== e.to || Math.hypot(s.x - e.x, s.z - e.z) > 4) continue;
          stand(party, w!, s, yawTo(e.x, e.z, s.x, s.z));
          if (party.senses.visibleAt(w!, at, Math.PI, self!) === null) found = { spot: s, yaw: w!.yaw };
        }
    }
    expect(found).not.toBeNull();
    stand(party, w!, found!.spot, found!.yaw);
    expect(check(party, ask("alone")).by).toEqual([{ who: w!.id, why: "doorway" }]);
    expect(check(party, ask("unwatched")).ok).toBe(true);
  });

  it("while it works knows only its own senses: whoever comes within three metres, into its view, or through a shut door", () => {
    reset();
    const shut = doorsNow(party, new Float32Array(party.world.doors.length));
    // At work with its back to w, five metres off: unnoticed.
    const far = twoPoints(party, room, 5);
    const back = yawTo(far.w.x, far.w.z, far.at.x, far.at.z);
    const work: PrivacyAsk = { mode: "alone", at: far.at, secs: 30, self: self!, who: null };
    stand(party, self!, far.at, back);
    stand(party, w!, far.w, back);
    expect(noticed(party, work, shut)).toBe(-1);
    // Closer than three metres behind it: heard.
    const k = (CLOSE_BY - 0.5) / Math.hypot(far.w.x - far.at.x, far.w.z - far.at.z);
    stand(party, w!, { level: far.at.level, x: far.at.x + (far.w.x - far.at.x) * k, z: far.at.z + (far.w.z - far.at.z) * k }, back);
    expect(noticed(party, work, shut)).toBe(w!.id);
    // Five metres off again, with the spy turned toward them: seen.
    stand(party, w!, far.w, back);
    self!.yaw = back + Math.PI;
    expect(noticed(party, work, shut)).toBe(w!.id);
    // A door into the room opening from shut: whoever is at it.
    self!.yaw = back;
    w!.present = false;
    const d = party.world.doors.find((q) => q.rooms.includes(room) && q.level === far.at.level);
    expect(d).toBeDefined();
    const by = party.pf.snap(d!.level, d!.x, d!.z, 1.5)!;
    stand(party, x!, by, 0);
    expect(Math.hypot(x!.x - d!.x, x!.z - d!.z)).toBeLessThan(2.5);
    const was = d!.open;
    shut[d!.id] = 0;
    d!.open = 1;
    expect(noticed(party, work, shut)).toBe(x!.id);
    d!.open = was;
  });
});

// ------------------------------------------------------------------ the goals' things

/** The items of the spy's goals. */
const GOAL_ITEMS = new Set(["statuette", "papers", "device", "phone"]);

describe("the goals' things", () => {
  it("are in the house only with a spy after them: the statuette on a stand, the papers in the safe or the target's bag, the phone in a coat or a pocket", () => {
    const kinds = (party: Party) => {
      const items = party.world.items;
      const out: string[] = [];
      for (let i = 0; i < items.n; i++) if (GOAL_ITEMS.has(items.kindOf(i))) out.push(items.kindOf(i));
      return out;
    };
    const plain = new Party(bp, { seed: SEED });
    plain.advance(16 * MIN);
    expect(kinds(plain)).toEqual([]);
    const statuette = new Party(bp, { seed: SEED, spy: { setup: "self", goal: "statuette" } });
    const th = statuette.spy!.things;
    const items = statuette.world.items;
    expect(kinds(statuette)).toEqual(["statuette"]);
    expect(items.stateOf(th.statuette)).toBe("shelved");
    expect(items.owner[th.statuette]).toBe(statuette.host.id);
    expect(Math.hypot(items.x[th.statuette]! - th.stand!.x, items.z[th.statuette]! - th.stand!.z)).toBeLessThan(0.01);
    const safe = new Party(bp, { seed: SEED, spy: { setup: "self", goal: "safe" } });
    expect(kinds(safe)).toEqual(["papers"]);
    expect(safe.world.items.stateOf(safe.spy!.things.papers)).toBe("shelved");
    // A kill's theft first, from each place (seeds whose theft comes from there).
    for (const [seed, from] of [
      ["first-2", "bag"],
      ["first-1", "coat"],
      ["first-0", "pocket"],
    ] as const) {
      const party = new Party(bp, { seed, spy: { setup: "self", goal: "kill", steal: 1 } });
      const spy = party.spy!;
      expect(spy.goal.first?.from, seed).toBe(from);
      const target = party.people[spy.goal.target]!;
      party.advance(Math.max(0, target.arriveAt + 30 - party.t));
      const it = party.world.items;
      const thing = spy.things.firstThing();
      expect(kinds(party), seed).toEqual([from === "bag" ? "papers" : "phone"]);
      if (from === "bag") expect(it.inside[thing]).toBe(spy.things.bagOf(target));
      if (from === "coat") expect(it.inside[thing]).toBe(target.coat);
      if (from === "pocket") expect(it.holder[thing]).toBe(target.id);
      expect(it.owner[thing]).toBe(target.id);
    }
  }, 30_000);
});

// ------------------------------------------------------------------ what the crowd finds

describe("what the crowd finds", () => {
  it("the statuette is missed only by someone who saw it on its stand tonight, or knew it from before", () => {
    // Before 19:20, when nothing risky has started: the statuette is still on its stand.
    const party = new Party(bp, { seed: SEED, spy: { setup: "self", goal: "statuette" } });
    party.advance(15 * MIN);
    const finding = party.finding!;
    const th = party.spy!.things;
    const stand0 = th.stand!;
    const front = frontOf(party.pf, stand0)!;
    for (const q of party.people) q.present = false;
    const household = (q: Person) => party.memory.household[q.id] || q.role === "butler" || q.regular;
    const [b, c] = party.people.filter((q) => !q.staff && q.role === "guest" && q.id !== party.spyId && !household(q));
    const face = (q: Person) => stand(party, q, front, yawTo(front.x, front.z, stand0.x, stand0.z));
    // b looks at it on its stand; c never does.
    expect(finding.knewAt[b!.id]).toBe(-1);
    face(b!);
    finding.looked(b!);
    expect(finding.knewAt[b!.id]).toBe(party.t);
    b!.present = false;
    // Gone (palmed, as the spy's act leaves it).
    const items = party.world.items;
    items.holder[th.statuette] = party.spyId;
    items.set(th.statuette, "carried", party.t);
    face(c!);
    for (let k = 0; k < 2000; k++) finding.looked(c!);
    expect(finding.stats.missed).toBe(0);
    c!.present = false;
    face(b!);
    for (let k = 0; k < 2000 && !finding.stats.missed; k++) finding.looked(b!);
    expect(finding.stats.missed).toBe(1);
    const gasp = party.events.find((e) => e.kind === "react" && e.note === "statuette-gone");
    expect(gasp?.actors).toEqual([b!.id]);
    const cs = party.register.casesOf(b!.id).find((x) => x.kind === "gone" && x.object === th.statuette);
    expect(cs).toBeDefined();
    expect(cs!.room).toBe(th.standRoom());
    expect(cs!.from).toBeLessThanOrEqual(finding.knewAt[b!.id]! + 1);
    // The household knew it was there without looking tonight.
    b!.present = false;
    const h = party.host;
    expect(finding.knewAt[h.id]).toBe(0);
    face(h);
    for (let k = 0; k < 2000 && finding.stats.missed < 2; k++) finding.looked(h);
    expect(finding.stats.missed).toBe(2);
  });

  it("the owner finds what was taken the next time they open the bag, reach into the coat or for the phone, and opens a case where they think it went", () => {
    for (const [seed, from] of [
      ["first-2", "bag"],
      ["first-1", "coat"],
      ["first-0", "pocket"],
    ] as const) {
      const party = new Party(bp, { seed, spy: { setup: "self", goal: "kill", steal: 1 } });
      const spy = party.spy!;
      const target = party.people[spy.goal.target]!;
      party.advance(Math.max(25 * MIN, target.arriveAt + 60) - party.t);
      // Taken, as the spy's act leaves it.
      const items = party.world.items;
      const thing = spy.things.firstThing();
      const takenAt = party.t;
      items.holder[thing] = spy.id;
      items.inside[thing] = -1;
      items.set(thing, "carried", party.t);
      items.place(thing, spy.record);
      const found = () => party.events.find((e) => e.kind === "react" && e.note === `gone:${items.kindOf(thing)}`);
      while (!party.over && !found()) party.advance(30);
      const e = found();
      expect(e?.actors, seed).toEqual([target.id]);
      const cs = party.register.casesOf(target.id).filter((x) => x.kind === "gone" && x.object === thing);
      expect(cs.length, seed).toBeGreaterThan(0);
      for (const x of cs) expect(x.to, seed).toBeGreaterThanOrEqual(x.from);
      // A coat's pocket: gone from the cloakroom, some time since they last had it. (A bag or a pocket is put down to
      // the chairs and crowds since, which may all come after the theft: they can't know.)
      if (from === "coat") {
        expect(cs.map((x) => x.room)).toContain(items.room[target.coat]);
        expect(Math.min(...cs.map((x) => x.from))).toBeLessThanOrEqual(takenAt);
      }
    }
  }, 120_000);

  it("the host looks into the study in about one evening in five, after 21:00, and finds the papers gone", () => {
    const party = new Party(bp, { seed: SEED, spy: { setup: "self", goal: "safe" } });
    // The draw, from as many forks: one in five, between 21:00 and the farewell, never playing the host itself.
    const farewell = party.programme.find((ph) => ph.id === "farewell")!.start;
    let drawn = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const f = new Finds(party, party.spy!, new Rng(`study/${i}`));
      if (f.studyAt < 0) continue;
      drawn++;
      expect(f.studyAt).toBeGreaterThanOrEqual(2 * 3600);
      expect(f.studyAt).toBeLessThan(farewell);
    }
    expect(Math.abs(drawn / N - 0.2)).toBeLessThan(0.04);
    const host = new Party(bp, { seed: SEED, spy: { setup: "host", goal: "safe" } });
    expect(host.spy!.id).toBe(host.host.id);
    for (let i = 0; i < 100; i++) expect(new Finds(host, host.spy!, new Rng(`study/${i}`)).studyAt).toBe(-1);
    // Tonight it does, the papers already gone.
    const finding = party.finding!;
    finding.studyAt = 2 * 3600 + 10 * MIN;
    party.advance(2 * 3600 - party.t);
    const papers = party.spy!.things.papers;
    const items = party.world.items;
    items.holder[papers] = party.spyId;
    items.set(papers, "carried", party.t);
    const gone = () => party.events.find((e) => e.kind === "react" && e.note === "gone:papers");
    while (party.t < 2 * 3600 + 40 * MIN && !gone()) party.advance(30);
    expect(finding.stats.study).toBe(1);
    expect(gone()?.actors).toEqual([party.host.id]);
    const cs = party.register.casesOf(party.host.id).find((x) => x.kind === "gone" && x.object === papers);
    expect(cs?.room).toBe(party.spy!.things.safeRoom());
  }, 60_000);

  it("a bug is found by one sitting on that sofa in twenty, by a waiter clearing glasses at that table one time in ten, and opens a planted case", () => {
    const plant = (party: Party) => {
      const th = party.spy!.things;
      const pr = th.bug!.prop!;
      th.device = party.world.items.add("device", "down", -1, -1, { level: pr.level, x: pr.x, z: pr.z, room: th.bug!.room }, party.t);
    };
    const putBack = (party: Party) => {
      const items = party.world.items;
      const d = party.spy!.things.device;
      items.holder[d] = -1;
      items.set(d, "down", party.t);
    };
    // The drawing room's sofa (gala-night's draw for this seed).
    const sofaParty = new Party(bp, { seed: SEED, spy: { setup: "self", goal: "bug" } });
    sofaParty.advance(40 * MIN);
    const bug = sofaParty.spy!.things.bug!;
    expect(bug.place).toBe("sofa");
    plant(sofaParty);
    const seats = sofaParty.places.seats;
    const on = seats.filter((s) => s.id === bug.prop!.id || s.id.startsWith(`${bug.prop!.id}:`));
    const off = seats.find((s) => !on.includes(s))!;
    expect(on.length).toBeGreaterThan(0);
    const sitter = sofaParty.people.find((q) => q.role === "guest" && q.id !== sofaParty.spyId)!;
    const f = sofaParty.finding!;
    for (let k = 0; k < 500; k++) f.sat(sitter, off);
    expect(f.stats.bugs).toBe(0);
    for (let k = 0; k < 2000; k++) {
      const before = f.stats.bugs;
      f.sat(sitter, on[k % on.length]!);
      if (f.stats.bugs > before) putBack(sofaParty);
    }
    expect(Math.abs(f.stats.bugs / 2000 - 1 / 20)).toBeLessThan(0.02);
    const found = sofaParty.events.find((e) => e.kind === "react" && e.note === "bug");
    expect(found?.actors).toEqual([sitter.id]);
    const cs = sofaParty.register.casesOf(sitter.id).find((x) => x.kind === "planted");
    expect(cs?.room).toBe(bug.room);
    expect(cs!.to - cs!.from).toBeCloseTo(120 * MIN, 0);
    // Under the dining table (this seed's draw).
    const tableParty = new Party(bp, { seed: "bug-7", spy: { setup: "self", goal: "bug" } });
    tableParty.advance(40 * MIN);
    const tb = tableParty.spy!.things.bug!;
    expect(tb.place).toBe("table");
    plant(tableParty);
    const waiter = tableParty.people.find((q) => q.role === "waiter" && q.id !== tableParty.spyId)!;
    const pr = tb.prop!;
    const tf = tableParty.finding!;
    // At the table's long side, and well away from it.
    const side = { level: pr.level, x: pr.x + Math.cos(pr.yaw) * (pr.w / 2 + 0.4), z: pr.z - Math.sin(pr.yaw) * (pr.w / 2 + 0.4) };
    stand(tableParty, waiter, { level: pr.level, x: pr.x + 8, z: pr.z + 8 }, 0);
    for (let k = 0; k < 500; k++) tf.served(waiter, 2);
    expect(tf.stats.bugs).toBe(0);
    stand(tableParty, waiter, side, 0);
    for (let k = 0; k < 500; k++) tf.served(waiter, 0);
    expect(tf.stats.bugs).toBe(0);
    for (let k = 0; k < 2000; k++) {
      const before = tf.stats.bugs;
      tf.served(waiter, 1);
      if (tf.stats.bugs > before) putBack(tableParty);
    }
    expect(Math.abs(tf.stats.bugs / 2000 - 1 / 10)).toBeLessThan(0.03);
  }, 30_000);
});

// ------------------------------------------------------------------ evenings

/**
 * The sweep's runner (scripts/spy-sweep.ts), which shares evenings out across child processes. It
 * is loaded by path, so the typecheck (browser code, without Node's types) doesn't take it in.
 */
const SWEEP = "../scripts/spy-sweep.ts";
interface Sweep {
  runEvenings(specs: ReadonlyArray<{ house: string; size: MansionSize; party?: string; spy?: SpyOptions }>): Promise<Array<SpyEvening & { house: string }>>;
}

describe("ten evenings with a plan", () => {
  it("keep every monitor (privacy and steps among them), take a kill's thing before following its target, and mostly get the goal done", async () => {
    const pin = (party: string, setup: SpySetup, goal: GoalKind, steal?: number) => ({ house: "gala-night", size: "grand" as const, party, spy: { setup, goal, steal } });
    const specs = [
      pin(SEED, "self", "statuette"),
      pin(SEED, "self", "safe"),
      pin(SEED, "victim", "bag"),
      pin(SEED, "host", "bug"),
      pin(SEED, "self", "ledger"),
      pin("first-2", "self", "kill", 1),
      pin("first-1", "self", "kill", 1),
      pin("first-0", "self", "kill", 1),
      { house: "match-42", size: "grand" as const, party: "spy-2" },
      { house: "orangery-1", size: "grand" as const, party: "spy-3" },
    ];
    const { runEvenings } = (await import(/* @vite-ignore */ SWEEP)) as Sweep;
    const rs = await runEvenings(specs);
    for (const [k, r] of rs.entries()) expect(r.broken, `${specs[k]!.party} ${r.goal}`).toEqual([]);
    for (const r of rs.filter((x) => x.goal === "kill" && x.theft && x.followedAt >= 0)) {
      const first = Math.min(...[r.stashedAt, r.droppedAt].filter((t) => t >= 0));
      expect(first).toBeLessThanOrEqual(r.followedAt);
    }
    // Something taken, planted or copied in most evenings with a goal it can finish in PR 3 (not a kill, not playing a waiter).
    const can = rs.filter((r) => r.goal !== "kill" && r.setup !== "waiter");
    expect(can.filter((r) => r.doneAt >= 0).length).toBeGreaterThanOrEqual(Math.ceil(can.length / 2));
    for (const r of rs) if (r.doneAt >= 0) expect(r.triedAt).toBeLessThanOrEqual(r.doneAt);
  }, 600_000);
});
