/**
 * The spy's goal in the house (milestone 3 technical plan: The planner, The crowd): the thing it
 * is after and where it is, the actions its plan can use, the facts as the spy sees them now, and
 * where each of its acts is done.
 *
 * The party makes the goal's things only with a spy, since only a spy is after them: a statuette
 * on one of the house's stands, the papers in the study's safe or in its target's bag, the phone
 * in its target's coat or pocket. A bug is made when it is planted; the ledger is copied, not
 * taken. Every draw here comes from the spy's own fork.
 */
import type { MansionBlueprint, Poi, Prop } from "../../mansion/core/types";
import type { Rng } from "../../mansion/core/rng";
import { TEST, type Ident } from "../ident";
import { KNOWN, type Memory, type Verb } from "../memory";
import type { Pathfinder } from "../path";
import { frontOf, type Places } from "../places";
import { actionIndex, DETAIL_RANGE, FOV, type Senses } from "../senses";
import type { Tasks } from "../tasks";
import type { Person, Pose, Spot } from "../types";
import type { Door, World } from "../world";
import { statuetteStands, type Knacks, type SpyGoal, type TheftFrom } from "./cast";
import type { TellId } from "./measure";
import { F, type PlanActionId } from "./planner";
import type { PrivacyMode, Spot3 } from "./privacy";

/** Where the bug goes: under the study desk, under the dining table, in the drawing room's sofa, or on the host's jacket in passing. */
export type BugPlace = "desk" | "table" | "sofa" | "host";
export const BUG_PLACES: readonly BugPlace[] = ["desk", "table", "sofa", "host"];

/** The acts that take nerve: each needs its moment (privacy.ts) and is a hard tell while it lasts. */
export type ActId = "lock" | "safe" | "papers" | "bag" | "coat" | "pocket" | "palm" | "plant" | "brush" | "ledger";

export interface ActSpec {
  /** The moment it needs; null: none (two seconds in a crowd). */
  mode: PrivacyMode | null;
  /** How long it takes (in-game s): the plan's ranges, a knack moving it toward the quick end. */
  secs: readonly [number, number];
  knack?: keyof Knacks;
  pose: Pose;
  /** What a witness makes of it (the notable while it lasts), and the tell it counts as. */
  verb: Verb | null;
  tell: TellId | null;
  /** A small act: only those within this can make it out (m). */
  within?: number;
}

/**
 * On one knee at the door, crouched at the safe, going through a bag or a coat as if its own, a
 * hand in a pocket, the statuette under the jacket, under the desk or the table, a camera to the
 * eye at the console. Palming the statuette reads as carrying it (milestone 2's `carrying`, the
 * thing the object), the bug and the ledger as `snooping`, as the plan has it. A hand at a pocket or
 * at the mantel is made out only from as close as the detail of a look reaches.
 */
export const ACTS: Record<ActId, ActSpec> = {
  lock: { mode: "alone", secs: [40, 90], knack: "lock", pose: "crouch", verb: "picking-lock", tell: "lock" },
  safe: { mode: "alone", secs: [120, 240], knack: "safe", pose: "crouch", verb: "at-safe", tell: "safe" },
  papers: { mode: "alone", secs: [4, 8], pose: "crouch", verb: "at-safe", tell: "safe" },
  bag: { mode: "unwatched", secs: [30, 60], pose: "serve", verb: "in-bag", tell: "bag" },
  coat: { mode: "unwatched", secs: [20, 40], pose: "serve", verb: "in-bag", tell: "bag" },
  pocket: { mode: "unwatched", secs: [2, 2], knack: "palm", pose: "stand", verb: "pocket", tell: "pocket", within: DETAIL_RANGE },
  palm: { mode: "unwatched", secs: [2, 2], knack: "palm", pose: "serve", verb: "carrying", tell: "palm", within: DETAIL_RANGE },
  plant: { mode: "alone", secs: [20, 40], pose: "crouch", verb: "snooping", tell: "plant" },
  brush: { mode: null, secs: [2, 2], pose: "stand", verb: null, tell: null },
  ledger: { mode: "alone", secs: [60, 120], pose: "camera", verb: "snooping", tell: "ledger" },
};

/**
 * The bug down the drawing room's sofa or under the dining table's edge: a hand slipped in for a
 * few seconds while nobody close looks, as anyone would do it in a room that is never empty (the
 * plan's 20 to 40 s alone found no moment there in the sweep: a bartender or a waiter is always
 * about). Under the study desk it is screwed in, alone, as ACTS has it.
 */
const SLIP_IN: ActSpec = { mode: "unwatched", secs: [3, 5], knack: "palm", pose: "serve", verb: "snooping", tell: "plant", within: DETAIL_RANGE };

/** The plan's actions that are acts, and which. */
export const ACT_OF: Partial<Record<PlanActionId, ActId>> = {
  "pick-lock": "lock",
  "open-safe": "safe",
  papers: "papers",
  bag: "bag",
  coat: "coat",
  pocket: "pocket",
  palm: "palm",
  plant: "plant",
  "brush-host": "brush",
  ledger: "ledger",
};

/** The parts a goal is planned in: its own, or a kill's and the theft before it. */
export type GoalPart = "statuette" | "safe" | "bag" | "coat" | "pocket" | "bug-room" | "bug-host" | "ledger" | "kill";

/** The actions each part of a goal can use (the tactics' own are left out unless switched on). */
export const GOAL_ACTIONS: Record<GoalPart, readonly PlanActionId[]> = {
  statuette: ["learn", "tour-alone", "go", "look-away", "commotion", "palm", "stash"],
  safe: ["learn", "tour-alone", "go", "pick-lock", "slip-in", "host-place", "open-safe", "papers", "stash"],
  bag: ["find-bag", "wait-owner", "spill", "bag", "stash"],
  coat: ["learn", "tour-alone", "go", "look-away", "commotion", "coat", "stash"],
  pocket: ["follow", "look-away", "pocket", "stash"],
  "bug-room": ["learn", "tour-alone", "go", "pick-lock", "slip-in", "host-place", "plant"],
  "bug-host": ["brush-host"],
  ledger: ["learn", "tour-alone", "go", "ledger"],
  kill: ["follow", "wait-alone", "embrace", "inject", "walk-off", "strangle", "friend-place", "aside", "lure"],
};

/** Someone was seen within this long (in-game s) for the spy to know where they and their bag are, and dancing or at the games this recently for it to know the bag is down. */
const FOUND_FOR = 300;
const DOWN_FOR = 60;
const PUT_DOWN = new Set([actionIndex("dance"), actionIndex("games")]);
/** Close to the target: the same room, within this (m). */
const CLOSE = 6;
/**
 * Rarely alone: their partner at the party, or a crowd round them (CROWD or more within CLOSE) in
 * most of the spy's sightings of them, which makes waiting for them alone dearer (RARELY_ALONE),
 * and the embrace and the walk off the cheaper way; alone somewhere private now (a bathroom, a
 * bedroom, the terrace) makes strangling cheaper (ALONE_NOW).
 */
const CROWD = 3;
const RARELY_ALONE = 4;
const ALONE_NOW = -1;
/** How much each sighting moves the spy's idea of the crowd round its target. */
const CROWD_EMA = 0.2;
const PRIVATE_NOW: ReadonlySet<string> = new Set(["bathroom", "bedroom", "dressing-room"]);
/** At a locked door: within this of the spot outside it (m). */
const AT_DOOR = 2.5;

/** What the goal needs from the party. */
export interface GoalHost {
  readonly t: number;
  readonly bp: MansionBlueprint;
  readonly people: Person[];
  readonly pf: Pathfinder;
  readonly places: Places;
  readonly world: World;
  readonly memory: Memory;
  readonly tasks: Tasks;
  readonly host: Person;
  readonly senses: Senses;
  readonly ident: Ident;
}

/** The goal as the plan sees it: the facts wanted, the actions it can use, their needs where they differ, and the room it is about. */
export interface GoalContext {
  goal: number;
  use: ReadonlySet<PlanActionId>;
  needs: Partial<Record<PlanActionId, number>>;
  /** What this goal adds to an action's cost now (planner.ts PlanProblem.costs). */
  costs: Partial<Record<PlanActionId, number>>;
  /** The room its place is in (-1 none: a bag, a pocket, a target). */
  room: number;
  /** The thing it is after now (-1 none yet). */
  thing: number;
}

/** Where an act is done: where to stand (facing the work), the point the privacy check asks about, and whose thing it is. */
export interface ActSite {
  spot: Spot;
  at: Spot3;
  /** Whose the thing is (-1 the house's), for a bag, a coat or a pocket. */
  owner: number;
  /** The notable's object: the thing, or whose pocket. */
  obj: number;
}

export class GoalThings {
  /** The statuette's stand, and the statuette (-1 without that goal). */
  readonly stand: Prop | null = null;
  statuette = -1;
  /** The safe, the ledger and the bug's place, when the goal is one of them. */
  readonly safe: Poi | null = null;
  readonly ledger: Poi | null = null;
  readonly bug: { place: BugPlace; prop: Prop | null; room: number } | null = null;
  /** The papers (in the safe, or in the target's bag), the phone (in their coat or pocket), the bug once planted (-1 none). */
  papers = -1;
  phone = -1;
  device = -1;
  /** The safe is open (until the papers are out), and when the ledger was copied (-1 not yet). */
  safeOpen = false;
  copiedAt = -1;
  /** When the theft before a kill was dropped (-1 not), at 21:00 if it wasn't done. */
  droppedFirst = -1;
  /** Who knew the statuette stood there when it went, and since when they last saw it (-1: didn't). */
  knewSince: Float32Array | null = null;
  /** A kill's target as the spy has seen them: how many about them, on the whole (0 before it has seen them). */
  crowd = 0;

  constructor(
    private readonly h: GoalHost,
    private readonly goal: SpyGoal,
    spyRecord: Person,
    rng: Rng,
  ) {
    const { bp, places, world } = h;
    const items = world.items;
    const host = h.host;
    const roomIndex = (id: string | null) => bp.rooms.find((r) => r.id === id)?.index ?? -1;
    if (goal.kind === "statuette") {
      const stands = statuetteStands(bp, places);
      if (stands.length) {
        this.stand = rng.pick(stands);
        const s = this.stand;
        this.statuette = items.add("statuette", "shelved", host.id, -1, { level: s.level, x: s.x, z: s.z, room: roomIndex(s.roomId) }, 0);
      }
    } else if (goal.kind === "safe") {
      this.safe = bp.pois.find((p) => p.type === "safe" && bp.rooms.find((r) => r.id === p.roomId)?.type === "study") ?? null;
      const s = this.safe;
      if (s) this.papers = items.add("papers", "shelved", host.id, -1, { level: s.level, x: s.x, z: s.z, room: roomIndex(s.roomId) }, 0);
    } else if (goal.kind === "ledger") {
      this.ledger = bp.pois.find((p) => p.type === "ledger") ?? null;
    } else if (goal.kind === "bug") {
      const study = bp.rooms.find((r) => r.type === "study");
      const drawing = bp.rooms.find((r) => r.type === "drawing-room");
      const propIn = (kind: string, roomId: string | undefined) => (roomId ? (bp.props.find((p) => p.kind === kind && p.roomId === roomId) ?? null) : null);
      const options: Array<{ place: BugPlace; prop: Prop | null; room: number }> = [];
      const desk = propIn("desk", study?.id);
      if (desk) options.push({ place: "desk", prop: desk, room: study!.index });
      const table = places.dining ? propIn("dining-table", places.dining.id) : null;
      if (table) options.push({ place: "table", prop: table, room: places.dining!.index });
      const sofa = propIn("sofa", drawing?.id);
      if (sofa) options.push({ place: "sofa", prop: sofa, room: drawing!.index });
      // Never on itself, playing the host.
      if (spyRecord.id !== host.id) options.push({ place: "host", prop: null, room: -1 });
      this.bug = options.length ? rng.pick(options) : null;
    }
  }

  /** In at the door (or there from the start): the papers in the target's bag, the phone in their coat or pocket. */
  arrived(p: Person): void {
    const g = this.goal;
    if (p.id !== g.target) return;
    const items = this.h.world.items;
    const from: TheftFrom | null = g.kind === "bag" ? "bag" : (g.first?.from ?? null);
    if (!from) return;
    if (from === "bag") {
      const bag = this.bagOf(p);
      if (bag < 0 || this.papers >= 0) return;
      this.papers = items.add("papers", "carried", p.id, -1, p, this.h.t);
      items.inside[this.papers] = bag;
    } else if (this.phone < 0) {
      this.phone = items.add("phone", "carried", p.id, from === "pocket" ? p.id : -1, p, this.h.t);
      if (from === "coat" && p.coat >= 0) items.inside[this.phone] = p.coat;
    }
  }

  /** Someone's own bag, carried or set down (-1 none). */
  bagOf(p: Person): number {
    const items = this.h.world.items;
    for (let i = 0; i < items.n; i++) if (items.owner[i] === p.id && items.kindOf(i) === "bag") return i;
    return -1;
  }

  /** The theft before a kill is still on: not done, not dropped. */
  firstOn(spy: Person): boolean {
    const g = this.goal;
    return g.kind === "kill" && g.first !== null && this.droppedFirst < 0 && !this.stashed(this.firstThing(), spy);
  }

  /** The thing of a theft first, or of the goal itself. */
  firstThing(): number {
    const g = this.goal;
    const from = g.kind === "bag" ? "bag" : g.first?.from;
    return from === "bag" ? this.papers : from ? this.phone : -1;
  }

  /** The thing the goal is after now (-1 none). */
  thing(spy: Person): number {
    const g = this.goal;
    if (g.kind === "statuette") return this.statuette;
    if (g.kind === "safe") return this.papers;
    if (g.kind === "bag") return this.papers;
    if (g.kind === "kill" && this.firstOn(spy)) return this.firstThing();
    return -1;
  }

  /** Into its coat, or (with no coat: the host, a waiter) on it. */
  stashed(thing: number, spy: Person): boolean {
    if (thing < 0) return false;
    const items = this.h.world.items;
    return spy.coat >= 0 ? items.inside[thing] === spy.coat : items.holder[thing] === spy.id;
  }

  /** The part of the goal the plan works on now, and what it can use. */
  context(spy: Person): GoalContext {
    const g = this.goal;
    const use = new Set<PlanActionId>();
    const needs: Partial<Record<PlanActionId, number>> = {};
    const costs: Partial<Record<PlanActionId, number>> = {};
    let goal = 0;
    let room = -1;
    const add = (k: GoalPart) => {
      for (const a of GOAL_ACTIONS[k]) use.add(a);
    };
    const theft = (from: TheftFrom) => {
      add(from);
      goal |= F.holding | F.stashed;
      if (from === "coat") room = this.h.places.chains.coats.room ?? -1;
      // At a pocket, the moment comes at the target's side.
      if (from === "pocket") needs["look-away"] = F.close;
    };
    if (g.kind === "statuette") {
      add("statuette");
      goal = F.holding | F.stashed;
      room = this.standRoom();
    } else if (g.kind === "safe") {
      add("safe");
      goal = F.holding | F.stashed;
      room = this.safeRoom();
    } else if (g.kind === "bag") theft("bag");
    else if (g.kind === "ledger") {
      add("ledger");
      goal = F.copied;
      room = this.ledgerRoom();
    } else if (g.kind === "bug") {
      add(this.bug?.place === "host" ? "bug-host" : "bug-room");
      goal = F.planted;
      room = this.bug?.room ?? -1;
    } else {
      add("kill");
      goal = F.dead;
      if (this.firstOn(spy)) {
        theft(g.first!.from);
        goal |= F.stashed;
        // The theft always comes first: following the target waits for it, or (a pocket, picked at their side) waiting for them alone and the embrace do.
        if (g.first!.from === "pocket") {
          needs["wait-alone"] = F.close | F.stashed;
          needs.embrace = F.close | F.stashed;
        } else needs.follow = F.stashed;
        needs.aside = F.trusted | F.close | F.stashed;
        needs.lure = F.close | F.stashed;
      }
      const target = g.target >= 0 ? this.h.people[g.target]! : null;
      if (target) {
        const partner = target.partner !== null ? this.h.people[target.partner]! : null;
        if ((partner?.present && !partner.gone) || this.crowd >= CROWD) costs["wait-alone"] = RARELY_ALONE;
        if (this.aloneNow(target, spy)) costs.strangle = ALONE_NOW;
      }
    }
    return { goal, use, needs, costs, room, thing: this.thing(spy) };
  }

  /** The spy sees its target: how many stand about them (within CLOSE, in their room) moves its idea of the crowd round them. */
  sawTarget(q: Person): void {
    let c = 0;
    for (const o of this.h.people) if (o !== q && o.present && !o.gone && o.level === q.level && o.room === q.room && Math.hypot(o.x - q.x, o.z - q.z) <= CLOSE) c++;
    this.crowd += CROWD_EMA * (c - this.crowd);
  }

  /** The target alone somewhere private now: a bathroom, a bedroom or the terrace, nobody else within CLOSE (the spy aside). */
  private aloneNow(q: Person, spy: Person): boolean {
    if (!q.present || q.gone || q.down) return false;
    const type = q.room >= 0 ? this.h.bp.rooms[q.room]!.type : q.room === -2 ? "terrace" : null;
    if (!type || (type !== "terrace" && !PRIVATE_NOW.has(type))) return false;
    return !this.h.people.some((o) => o !== q && o !== spy && o.present && !o.gone && o.level === q.level && Math.hypot(o.x - q.x, o.z - q.z) <= CLOSE);
  }

  standRoom(): number {
    return this.stand ? (this.h.bp.rooms.find((r) => r.id === this.stand!.roomId)?.index ?? -1) : -1;
  }

  safeRoom(): number {
    return this.safe ? (this.h.bp.rooms.find((r) => r.id === this.safe!.roomId)?.index ?? -1) : -1;
  }

  ledgerRoom(): number {
    return this.ledger ? (this.h.bp.rooms.find((r) => r.id === this.ledger!.roomId)?.index ?? -1) : -1;
  }

  /**
   * The way in when the spy can't walk into a room: a key-locked door into it whose other side it
   * can get to (the study's, off a landing). Null when some way in is open to it, or none is.
   */
  lockedDoor(room: number, spy: Person): Door | null {
    if (room < 0) return null;
    const w = this.h.world;
    if (w.reachable(spy.room, room, spy)) return null;
    return w.doors.find((d) => d.rooms.includes(room) && d.lock === "key" && d.locked && !w.canPass(d, spy) && w.reachable(spy.room, w.otherSide(d, room), spy)) ?? null;
  }

  /** The facts as the spy sees them now. */
  facts(spy: Person, c: GoalContext): number {
    const h = this.h;
    const { memory, world } = h;
    const items = world.items;
    const g = this.goal;
    const n = h.people.length;
    let m = 0;
    if (c.room < 0 || memory.familiarity(spy.id, c.room) >= KNOWN) m |= F.way;
    if (c.room >= 0) {
      const inside = spy.room === c.room;
      const door = inside ? null : this.lockedDoor(c.room, spy);
      if (inside || world.reachable(spy.room, c.room, spy)) m |= F.door;
      const out = door ? h.tasks.outside(door, c.room) : null;
      if (inside || (out && spy.level === out.level && Math.hypot(spy.x - out.x, spy.z - out.z) <= AT_DOOR)) m |= F.there;
    }
    if (this.safeOpen) m |= F.safe;
    const target = g.target >= 0 ? h.people[g.target]! : null;
    if (target && memory.lastT[spy.id * n + target.id]! > h.t - FOUND_FOR) m |= F.found;
    // The bag down where they left it, as far as the spy knows: in its view, or its owner seen dancing or at the games just now;
    // or in its own hands, carried off to go through somewhere quiet (tactics.ts).
    const bag = target ? this.bagOf(target) : -1;
    if (bag >= 0 && items.holder[bag] === spy.id) m |= F.free;
    else if (bag >= 0 && items.holder[bag] === -1 && items.stateOf(bag) === "down") {
      const k = spy.id * n + target!.id;
      const room = items.room[bag]!;
      const at = { level: items.level[bag]!, x: items.x[bag]!, z: items.z[bag]!, y: room >= 0 ? h.bp.rooms[room]!.floorY : spy.y, room };
      if ((memory.lastT[k]! > h.t - DOWN_FOR && PUT_DOWN.has(memory.lastAct[k]!)) || h.senses.visibleAt(spy, at, FOV)) m |= F.free;
    }
    const thing = c.thing;
    if (thing >= 0 && items.holder[thing] === spy.id) m |= F.holding;
    if (thing >= 0 && this.stashed(thing, spy)) m |= F.stashed | F.holding;
    if (this.device >= 0) m |= F.planted;
    if (this.copiedAt >= 0) m |= F.copied;
    if (target?.present && !target.gone && target.level === spy.level && target.room === spy.room && Math.hypot(target.x - spy.x, target.z - spy.z) <= CLOSE) m |= F.close;
    if (target?.down === "dead") m |= F.dead;
    // Its target trusts the face it wears: a friend of theirs, as far as they can tell (a swap into one, or playing one from the start).
    if (target && h.ident.tieOf(target.id, spy.id) >= 3 && h.ident.doubtOf(target.id, spy.id, h.t) < TEST) m |= F.trusted;
    return m;
  }

  /** Where an act is done, or null when it can't be now (no stand, no coat, the bag not down). */
  site(act: ActId, spy: Person): ActSite | null {
    const h = this.h;
    const { pf, world } = h;
    const items = world.items;
    const g = this.goal;
    const y = (s: Spot) => (s.room >= 0 ? h.bp.rooms[s.room]!.floorY : spy.y);
    const of = (s: Spot | null, owner = -1, obj = -1): ActSite | null => (s ? { spot: s, at: { level: s.level, x: s.x, z: s.z, y: y(s), room: s.room }, owner, obj } : null);
    const standAt = (x: number, z: number, level: number, yaw: number): Spot | null => {
      const w = pf.snap(level, x, z, 1);
      const room = w ? pf.roomAt(level, w.x, w.z) : -1;
      return w && room !== -1 ? { level, x: w.x, z: w.z, yaw, room } : null;
    };
    const target = g.target >= 0 ? h.people[g.target]! : null;
    switch (act) {
      case "lock": {
        const room = this.context(spy).room;
        const door = this.lockedDoor(room, spy);
        return door ? of(h.tasks.outside(door, room)) : null;
      }
      case "safe":
      case "papers":
        return this.safe ? of(standAt(this.safe.stand.x, this.safe.stand.z, this.safe.level, this.safe.stand.yaw), -1, this.papers) : null;
      case "ledger":
        return this.ledger ? of(standAt(this.ledger.stand.x, this.ledger.stand.z, this.ledger.level, this.ledger.stand.yaw)) : null;
      case "palm":
        return this.stand ? of(frontOf(pf, this.stand), -1, this.statuette) : null;
      case "plant":
        return this.bug?.prop ? of(frontOf(pf, this.bug.prop)) : null;
      case "coat": {
        if (!target || target.coat < 0 || items.stateOf(target.coat) !== "hung") return null;
        const c = target.coat;
        return of(standAt(items.x[c]!, items.z[c]!, items.level[c]!, spy.yaw), target.id, c);
      }
      case "bag": {
        const bag = target ? this.bagOf(target) : -1;
        if (bag < 0 || items.holder[bag] !== -1 || items.stateOf(bag) !== "down") return null;
        const s = standAt(items.x[bag]!, items.z[bag]!, items.level[bag]!, 0);
        if (s) s.yaw = Math.atan2(items.x[bag]! - s.x, items.z[bag]! - s.z);
        return of(s, target!.id, bag);
      }
      case "pocket":
      case "brush": {
        const q = act === "brush" ? h.host : target;
        if (!q?.present || q.gone || q.room === -1) return null;
        return of({ level: q.level, x: q.x, z: q.z, yaw: q.yaw, room: q.room }, q.id, q.id);
      }
    }
  }

  /** An act as it is done in this house: the bug slipped into a sofa or under a table quickly, under a desk as ACTS has it. */
  spec(act: ActId): ActSpec {
    return act === "plant" && (this.bug?.place === "sofa" || this.bug?.place === "table") ? SLIP_IN : ACTS[act];
  }

  /** Who would know a bag or a coat isn't the spy's: its owner, their partner and friends, the cloakroom attendant. */
  knowsWhose(owner: number): (q: Person) => boolean {
    const o = this.h.people[owner]!;
    return (q) => q.id === owner || q.id === o.partner || o.friends.includes(q.id) || q.role === "cloakroom";
  }
}
