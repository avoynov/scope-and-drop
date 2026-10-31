/**
 * The spy's habits (milestone 3 technical plan: The scheduler, habits and tactics): what shows
 * between its plan's steps while each is on (scheduler.ts), each a hook into something that
 * already runs. Every habit pauses while it feels watched, but keeping out of the picture while it
 * plays someone (scheduler.ts active()).
 *
 * - Out of step: a change in the programme caught 5 to 20 minutes late (cues.ts), and its choices
 *   weighed halfway toward even between what the phase calls for and the everyday.
 * - Returns: one to three trips in the evening back to an out-of-the-way place where it did
 *   something (the study door, the cloakroom where its coat holds what it took, the bathroom of
 *   its alibi), a while after, for 30 to 90 s of looking round; in a private room it pokes round.
 * - Odd places: bedrooms, upstairs corridors and the study door tempt it twice as much when it
 *   wanders, and following its target it keeps 1 to 2 m behind; ten seconds of that in a quiet
 *   room is one figure close behind another.
 * - Startles: caught at it, or walked in on somewhere private, a jerk and a step back, then a
 *   sudden interest in the nearest painting or bookshelf.
 * - Tours: every 15 to 30 minutes a walk through two to four rooms it knows least, upstairs first,
 *   trying the private doors' handles and looking in where one gives.
 * - Out of the picture: when the photographer comes to shoot its room, or the group photo is
 *   called, it walks out for an ordinary reason if it can slip away cleanly; when it can't, it
 *   plays along and is in the photo like anyone.
 * - Drops everything: on an errand when a step of its plan comes up, it puts the glass down where
 *   it stands and goes; the one who asked waits, then comes looking.
 *
 * It draws only from its own fork, and only when a habit acts.
 */
import type { Rng } from "../../mansion/core/rng";
import type { RoomType } from "../../mansion/core/types";
import { PARTY_LENGTH, type PhaseId } from "../clock";
import { KNOWN } from "../memory";
import { PHASE_WEIGHTS, spotKey, type Candidate } from "../mind";
import type { Step, Task } from "../tasks";
import type { ActionId, Gesture, Group, Person, Spot } from "../types";
import type { Door } from "../world";
import type { TellId } from "./measure";
import type { Spy } from "./index";
import { FIRST_STEP, type StepsHost } from "./steps";

/** What the habits need from the party, besides running the plan's. */
export interface HabitsHost extends StepsHost {
  start(p: Person, c: Candidate): void;
  end(p: Person, done: boolean): void;
  gesture(p: Person, g: Gesture, secs: number): void;
  glance(p: Person, x: number, z: number, secs: number): void;
  /** The circle someone stands in, or undefined. */
  circleOf(p: Person): Group | undefined;
  /** Whether this person would try this bathroom, from what they've seen of its door. */
  worthTrying(p: Person, i: number): boolean;
  taken(key: string): boolean;
  /** Put down the glass in hand: where they stand (`here`), else on the nearest surface. */
  setDown(p: Person, here?: boolean): void;
}

/** Out of step: the everyday things it weighs evenly with what the phase calls for. */
const EVERYDAY: readonly ActionId[] = ["mingle", "drink", "toilet", "sit", "art", "terrace", "wander", "use", "snack"];
/** Returns: trips in the evening, how long after the deed or the last trip, and the look round (in-game s). */
const TRIPS: readonly [number, number] = [1, 3];
const RETURN_AFTER: readonly [number, number] = [5 * 60, 20 * 60];
const RETURN_LOOK: readonly [number, number] = [30, 90];
/** On a return to a private room it pokes round this long (in-game s), as milestone 2's snoop shows. */
const POKE = 12;
/** A place it couldn't reach is tried again this much later (in-game s). */
const LATER = 5 * 60;
/** Odd places: how much more they tempt it, how far behind its target it keeps (m), and close behind in a quiet room: within this, this long, with at most this many others there. */
const ODD = 2;
const TRAIL_CLOSE: readonly [number, number] = [1, 2];
const FOLLOW_NEAR = 2;
const FOLLOW_SECS = 10;
const QUIET = 3;
/** Followed once, not again for this long (in-game s). */
const FOLLOW_GAP = 30;
/** Startles: at whoever comes in within this (m), no more often than this (in-game s); the cover look after, at a painting or a bookshelf within LOOK_NEAR. */
const STARTLE_NEAR = 10;
const STARTLE_GAP = 30;
const COVER_LOOK: readonly [number, number] = [6, 10];
const LOOK_NEAR = 8;
/** Tours: one this long after the last while on, through this many rooms. */
const TOUR_EVERY: readonly [number, number] = [15 * 60, 30 * 60];
const TOUR_ROOMS: readonly [number, number] = [2, 4];
/** Out of the picture: the camera on its circle within this (m), a doorway out within this, the photographer bound for its room from within this; a bladder below this is a reason. */
const CAMERA_NEAR = 6;
const DOOR_NEAR = 8;
const HEADING = 15;
const BLADDER = 0.6;
/** Facing someone: within this angle of their heading (rad), and seeing them go within this (m). */
const FACING = Math.PI / 4;
const SEES_GO = 10;
/** Drops everything: the one who asked waits this long before coming to look (in-game s). */
const ASKER_WAITS: readonly [number, number] = [120, 240];

/** Rooms a figure has no business in: the private ones. */
const PRIVATE: ReadonlySet<RoomType> = new Set(["bedroom", "dressing-room", "study"]);
/** Upstairs, the halls between rooms are odd places too. */
const UPSTAIRS: ReadonlySet<RoomType> = new Set(["corridor", "landing", "stair-hall", "hall-gallery"]);
/** Rooms worth a look on a tour of its own. */
const TOURED: ReadonlySet<RoomType> = new Set([
  "bedroom",
  "dressing-room",
  "study",
  "sitting-room",
  "library",
  "gallery",
  "hall-gallery",
  "music-room",
  "morning-room",
  "card-room",
  "conservatory",
  "landing",
  "corridor",
  "spa",
  "gym",
  "cinema",
  "theatre",
]);
/** Things to take a sudden interest in. */
const SIGHTS: ReadonlySet<string> = new Set(["painting", "statue", "bookshelf", "clock", "fireplace", "globe"]);
/** What it drops to slip out of a photo: loose things, not a dance, a seat at a game or a task. */
const LOOSE: ReadonlySet<ActionId> = new Set(["mingle", "drink", "art", "wander", "sit", "snack", "use", "terrace"]);
const NONE: readonly Candidate[] = [];

/** A place it did something worth coming back to: where to stand, when, and when it may next go back. */
export interface Deed {
  spot: Spot;
  at: number;
  next: number;
}

/** Its phase weights out of step: halfway between the phase's own and even over the phase's things and the everyday (each phase's worked out once). */
const blended = new Map<PhaseId, Partial<Record<ActionId, number>>>();
export function outOfStep(id: PhaseId): Partial<Record<ActionId, number>> {
  const have = blended.get(id);
  if (have) return have;
  const W = PHASE_WEIGHTS[id];
  const keys = new Set<ActionId>([...EVERYDAY, ...(Object.keys(W) as ActionId[])]);
  let sum = 0;
  for (const k of keys) sum += W[k] ?? 0;
  const even = sum / keys.size;
  const w: Partial<Record<ActionId, number>> = {};
  for (const k of keys) w[k] = ((W[k] ?? 0) + even) / 2;
  blended.set(id, w);
  return w;
}

export class Habits {
  readonly stats = { returns: 0, tours: 0, rattles: 0, peeks: 0, startles: 0, followed: 0, slipped: 0, stayed: 0, drops: 0, asked: 0 };
  /** Where it did something worth coming back to, oldest first. */
  readonly deeds: Deed[] = [];
  /** Trips back still to make tonight. */
  private trips: number;
  private tourAt = 0;
  /** Close behind its target since, and not again until. */
  private followFrom = -1;
  private followNext = 0;
  private startleAt = -1e9;
  /** The candid round it last answered (task id), and the glass it left behind. */
  private camera = -1;
  private glass = -1;
  /** Those who asked it for a drink it never brought, and when they come looking. */
  private readonly askers: Array<{ who: number; at: number }> = [];
  /** The odd places it can wander to (room index), the spots outside the study's doors, and things to look at, by room. */
  private readonly odd: number[];
  private readonly studyDoors: Spot[];
  private readonly sights = new Map<number, Spot[]>();
  private ticks = 0;

  constructor(
    private readonly h: HabitsHost,
    private readonly spy: Spy,
    private readonly rng: Rng,
  ) {
    const { bp, pf, cells, world } = h;
    this.trips = rng.int(TRIPS[0], TRIPS[1]);
    this.odd = bp.rooms.filter((r) => pf.levels.has(r.level) && cells.count(r.index) > 0 && (PRIVATE.has(r.type) || (r.level > 0 && UPSTAIRS.has(r.type)))).map((r) => r.index);
    this.studyDoors = [];
    for (const d of world.doors) {
      const room = d.rooms.find((r) => r >= 0 && bp.rooms[r]!.type === "study");
      const s = room === undefined ? null : h.tasks.outside(d, room);
      if (s) this.studyDoors.push(s);
    }
    for (const poi of bp.pois) {
      if (!SIGHTS.has(poi.type) || !pf.levels.has(poi.level)) continue;
      const w = pf.snap(poi.level, poi.stand.x, poi.stand.z, 1.2);
      const room = w ? pf.roomAt(poi.level, w.x, w.z) : -1;
      if (!w || room < 0) continue;
      const list = this.sights.get(room) ?? [];
      list.push({ level: poi.level, x: w.x, z: w.z, yaw: poi.stand.yaw, room });
      this.sights.set(room, list);
    }
  }

  // --------------------------------------------------------------- the mind

  /** The phase weights its choices use: halfway to even while it's out of step. */
  weights(id: PhaseId): Partial<Record<ActionId, number>> {
    return this.spy.covers.active("out-of-step") ? outOfStep(id) : PHASE_WEIGHTS[id];
  }

  /** Out of step: a change caught late (cues.ts). */
  slow(): boolean {
    return this.spy.covers.active("out-of-step");
  }

  /** With odd places on, a wander there tempts it twice as much: a bedroom or an upstairs hall it can get to, and the study's door. */
  oddPlaces(p: Person): readonly Candidate[] {
    if (!this.spy.covers.active("odd-places")) return NONE;
    const h = this.h;
    const out: Candidate[] = [];
    const mod = ODD * (0.4 + p.traits.curiosity * 0.6);
    const rooms = this.odd.filter((r) => r !== p.room && (p.room < 0 || h.world.reachable(p.room, r, p)));
    const s = rooms.length ? h.cells.random(this.rng.pick(rooms), this.rng, 0.8) : null;
    if (s) out.push({ id: "wander", target: s, duration: this.rng.range(20, 60), pose: "look", gain: { curiosity: 0.15 }, mod });
    const door = this.studyDoors.length ? this.rng.pick(this.studyDoors) : null;
    if (door) out.push({ id: "wander", target: door, duration: this.rng.range(20, 60), pose: "look", gain: { curiosity: 0.15 }, mod });
    return out;
  }

  /** How far behind its target it follows: a step behind with odd places on, else `far`. */
  trailGap(far: number): number {
    return this.spy.covers.active("odd-places") ? this.rng.range(TRAIL_CLOSE[0], TRAIL_CLOSE[1]) : far;
  }

  // ---------------------------------------------------------------- outings

  /** Its mind is free and its plan has nothing to start: a trip back or a tour of its own, when one is on and due (true). */
  think(p: Person): boolean {
    if (!this.out(p)) return false;
    const c = this.spy.covers;
    if (c.active("returns") && this.goBack(p)) return true;
    if (c.active("tours") && this.h.t >= this.tourAt && this.tour(p)) return true;
    return false;
  }

  /** Something done somewhere out of the way (not a party room, nor a hall downstairs where everyone passes): a place to come back to later. */
  did(spot: Spot): void {
    const h = this.h;
    const r = spot.room >= 0 ? h.bp.rooms[spot.room]! : null;
    if (!r || r.role === "party" || (r.role === "circulation" && r.level === 0)) return;
    const at = h.t;
    const next = at + this.rng.range(RETURN_AFTER[0], RETURN_AFTER[1]);
    const d = this.deeds.find((x) => x.spot.room === spot.room);
    if (d) {
      d.at = at;
      d.next = Math.max(d.next, next);
    } else this.deeds.push({ spot, at, next });
  }

  /** Free to go off on its own: after 19:20, between the programme's beats, before the first goodbye. */
  private out(p: Person): boolean {
    const h = this.h;
    const ph = h.programme[this.spy.phase]?.id;
    return h.t >= FIRST_STEP && h.byeAt < 0 && !p.staff && (ph === "arrival" || ph === "mingle" || ph === "dancing" || ph === "games");
  }

  /** Back to the latest place it did something, when it's time: a look round, poking about in a private room. */
  private goBack(p: Person): boolean {
    const h = this.h;
    if (this.trips <= 0) return false;
    let best: Deed | null = null;
    for (const d of this.deeds) if (h.t >= d.next && d.spot.room !== p.room && (!best || d.at > best.at)) best = d;
    if (!best) return false;
    const to = this.reach(p, best.spot);
    if (!to) {
      best.next = h.t + LATER;
      return false;
    }
    const t = h.tasks.spy(p, "return", "wander", [
      { do: "goto", to, label: "to:return" },
      { do: "wait", s: 0, pose: "look", label: "return" },
      { do: "wait", s: this.rng.range(RETURN_LOOK[0], RETURN_LOOK[1]), pose: "look", label: "return-look" },
    ]);
    if (t.outcome !== null) {
      best.next = h.t + LATER;
      return false;
    }
    this.trips--;
    for (const d of this.deeds) d.next = Math.max(d.next, h.t + this.rng.range(RETURN_AFTER[0], RETURN_AFTER[1]));
    this.stats.returns++;
    this.note("return");
    return true;
  }

  /** Where to stand for a place: there, or outside its door when it can't get in now. */
  private reach(p: Person, s: Spot): Spot | null {
    const h = this.h;
    if (p.room < 0 || h.world.reachable(p.room, s.room, p)) return s;
    let best: Spot | null = null;
    let bd = Infinity;
    for (const d of h.world.doors) {
      if (!d.rooms.includes(s.room)) continue;
      const o = h.tasks.outside(d, s.room);
      const dist = o ? Math.hypot(o.x - p.x, o.z - p.z) + 12 * Math.abs(o.level - p.level) : Infinity;
      if (o && dist < bd && h.world.reachable(p.room, o.room, p)) {
        best = o;
        bd = dist;
      }
    }
    return best;
  }

  /** A tour of its own, while tours are on. */
  private tour(p: Person): boolean {
    const h = this.h;
    this.tourAt = h.t + this.rng.range(TOUR_EVERY[0], TOUR_EVERY[1]);
    const steps = this.tourSteps(p, this.rng.int(TOUR_ROOMS[0], TOUR_ROOMS[1]));
    if (!steps.length) return false;
    const t = h.tasks.spy(p, "tour", "wander", steps);
    if (t.outcome !== null) return false;
    this.stats.tours++;
    this.note("tour");
    return true;
  }

  /**
   * A walk through `n` rooms it knows least, upstairs first, nearest next (a walk, not a zigzag):
   * at a private room's door it tries the handle, into any other room it looks. `end` is a room
   * it ends at, which the walk leaves out (its goal's, on the plan's tour alone).
   */
  tourSteps(p: Person, n: number, end = -1): Step[] {
    const h = this.h;
    const { bp, memory } = h;
    const left: Array<{ r: number; k: number }> = [];
    for (const r of bp.rooms) {
      if (r.index === p.room || r.index === end || !TOURED.has(r.type) || !h.pf.levels.has(r.level) || h.cells.count(r.index) < 4) continue;
      if ((r.type === "corridor" || r.type === "landing") && r.level === 0) continue;
      left.push({ r: r.index, k: memory.familiarity(p.id, r.index) + (r.level === 0 ? 0.5 : 0) + this.rng.range(0, 0.3) });
    }
    left.sort((a, b) => a.k - b.k || a.r - b.r);
    const pool = left.slice(0, Math.max(n * 2, 4)).map((x) => x.r);
    const steps: Step[] = [];
    let at = { level: p.level, x: p.x, z: p.z };
    let made = 0;
    while (made < n && pool.length) {
      let k = 0;
      let bd = Infinity;
      pool.forEach((r, i) => {
        const b = bp.rooms[r]!;
        const d = Math.hypot((b.inner.x0 + b.inner.x1) / 2 - at.x, (b.inner.z0 + b.inner.z1) / 2 - at.z) + 12 * Math.abs(b.level - at.level);
        if (d < bd) {
          bd = d;
          k = i;
        }
      });
      const r = pool.splice(k, 1)[0]!;
      const door = PRIVATE.has(bp.rooms[r]!.type) ? this.doorInto(r) : null;
      const outside = door ? h.tasks.outside(door, r) : null;
      if (door && outside && (p.room < 0 || h.world.reachable(p.room, outside.room, p))) {
        steps.push({ do: "goto", to: outside, label: "to-door" }, { do: "wait", s: 3, pose: "rattle", label: `try:${door.id}:${r}` });
        at = outside;
        made++;
        continue;
      }
      if (p.room >= 0 && !h.world.reachable(p.room, r, p)) continue;
      const s = h.cells.random(r, this.rng, 0.8);
      if (!s) continue;
      steps.push({ do: "goto", to: s, label: "to-room" }, { do: "wait", s: 0, pose: "look", label: "look" }, { do: "wait", s: this.rng.range(4, 8), pose: "look", label: "look-in" });
      at = s;
      made++;
    }
    return steps;
  }

  /** A door into a private room from somewhere that isn't private (a landing, a corridor). */
  private doorInto(room: number): Door | null {
    const h = this.h;
    for (const d of h.world.doors) {
      if (!d.rooms.includes(room)) continue;
      const from = h.world.otherSide(d, room);
      if (from >= 0 && !PRIVATE.has(h.bp.rooms[from]!.type) && h.bp.rooms[from]!.type !== "bathroom") return d;
    }
    return null;
  }

  /** At a private door on its tour: a rattle when it's locked, a look inside when it gives. */
  private tryDoor(t: Task, p: Person, label: string): void {
    const h = this.h;
    const [, d, r] = label.split(":").map(Number) as [number, number, number];
    const door = h.world.doors[d];
    if (!door) return;
    if (!h.world.canPass(door, p)) {
      h.sound("rattle", { level: door.level, x: door.x, z: door.z, room: p.room }, p.id, d);
      h.notable(p, "locked-door", d, 10);
      this.tell("touring", p, 10);
      this.stats.rattles++;
      return;
    }
    const inside = h.cells.random(r, this.rng, 0.8);
    if (!inside) return;
    const back = t.steps[t.i - 1];
    t.steps.splice(
      t.i + 1,
      0,
      { do: "goto", to: inside, label: "peek-in" },
      { do: "wait", s: 0, pose: "look", label: "look" },
      { do: "wait", s: this.rng.range(4, 8), pose: "look", label: "peek" },
      { do: "goto", to: back?.do === "goto" ? back.to : inside, label: "peek-out" },
    );
    this.stats.peeks++;
  }

  /** A step of one of its own tasks done: what it shows. */
  stepDone(t: Task, st: Step): void {
    if (t.owner !== this.spy.id || t.kind !== "spy") return;
    const h = this.h;
    const p = this.spy.record;
    const label = st.label;
    if (label.startsWith("try:")) return this.tryDoor(t, p, label);
    const next = t.steps[t.i + 1];
    const secs = next?.do === "wait" ? next.s : 6;
    if (label === "return") {
      this.tell("returns", p, secs);
      if (p.room >= 0 && PRIVATE.has(h.bp.rooms[p.room]!.type)) h.notable(p, "snooping", -1, Math.min(POKE, secs), p.room);
    } else if (label === "look") {
      // Alone upstairs, or in someone's room, on a tour of its own.
      const r = p.room >= 0 ? h.bp.rooms[p.room]! : null;
      if (r && (r.level > 0 || PRIVATE.has(r.type))) this.tell("touring", p, secs);
    }
  }

  // ---------------------------------------------------------------- startles

  /** Caught at it, or walked in on, with startles on: a jerk and a step back, eyes on whoever it was (true). */
  startle(p: Person, by: Person): boolean {
    const h = this.h;
    if (!this.spy.covers.active("startles") || h.t - this.startleAt < STARTLE_GAP) return false;
    this.startleAt = h.t;
    h.gesture(p, "startle", 1);
    h.glance(p, by.x, by.z, 1.5);
    this.stepBack(p, by, 0.2);
    // What it was caught at still shows a moment (steps.ts CAUGHT): the jerk doesn't hide it.
    if (!p.notable || p.notableUntil <= h.t) h.notable(p, "startled", by.id, 6);
    this.tell("startled", p, 6);
    this.stats.startles++;
    this.note(`startle:${by.id}`);
    return true;
  }

  /** The cover act after a startle: hands behind its back before the nearest painting or bookshelf in the room, within 8 m (null: none). */
  sight(p: Person): Spot | null {
    let best: Spot | null = null;
    let bd = LOOK_NEAR;
    for (const s of this.sights.get(p.room) ?? []) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (s.level === p.level && d < bd) {
        best = s;
        bd = d;
      }
    }
    return best;
  }

  private stepBack(p: Person, from: { x: number; z: number }, m: number): void {
    const h = this.h;
    const d = Math.hypot(p.x - from.x, p.z - from.z) || 1;
    const s = h.pf.snap(p.level, p.x + ((p.x - from.x) / d) * m, p.z + ((p.z - from.z) / d) * m, 0.15);
    if (s && h.pf.roomAt(s.level, s.x, s.z) === p.room) {
      p.x = s.x;
      p.z = s.z;
    }
  }

  /**
   * Someone walked into a room: the photographer coming to shoot the spy's, or anyone walking in
   * on it somewhere private while it's out on its own (not at a step of its plan, which keeps its
   * own watch).
   */
  entered(q: Person): void {
    const h = this.h;
    const p = this.spy.record;
    if (q === p || !p.present || p.gone || q.room !== p.room || q.level !== p.level || p.room < 0) return;
    if (q.role === "photographer") {
      if (this.spy.covers.active("out-of-picture")) this.candid(p, q);
      return;
    }
    if (this.spy.plans.busy || p.pose === "walk" || !PRIVATE.has(h.bp.rooms[p.room]!.type) || Math.hypot(q.x - p.x, q.z - p.z) > STARTLE_NEAR) return;
    if (!this.startle(p, q)) return;
    const s = this.sight(p);
    h.end(p, false);
    h.tasks.spy(p, "startle", "art", [
      ...(s ? [{ do: "goto" as const, to: s, label: "to-art" }] : []),
      { do: "wait", s: this.rng.range(COVER_LOOK[0], COVER_LOOK[1]), pose: "look", label: "cover-look" },
    ]);
  }

  // ------------------------------------------------------------- the camera

  /** Once a step, after its plan's: following close, the photographer's next candid, the dropped errand and whoever comes looking. */
  step(): void {
    const h = this.h;
    const spy = this.spy;
    const p = spy.record;
    this.ticks++;
    if (!p.present || p.gone) return;
    const c = spy.covers;
    if (c.active("odd-places")) this.follow(p);
    if (this.ticks % 4 === 0) {
      if (c.active("out-of-picture")) {
        const ph = h.people.find((q) => q.role === "photographer" && q.present && !q.gone);
        if (ph) this.candid(p, ph);
      }
      if (c.active("drops")) this.drop(p);
    }
    for (let i = this.askers.length - 1; i >= 0; i--) {
      const a = this.askers[i]!;
      if (h.t < a.at) continue;
      this.askers.splice(i, 1);
      this.comeLooking(h.people[a.who]!, p);
    }
    if (this.glass >= 0 && this.ticks % 60 === 0) {
      const items = h.world.items;
      const st = items.stateOf(this.glass);
      if (items.holder[this.glass] !== -1 || (st !== "down" && st !== "empty")) {
        spy.measure.end("abandoned", h.t);
        this.glass = -1;
      }
    }
  }

  /** The photographer is out for a candid in its room (on the way, or there): out of the frame if it can be. */
  private candid(p: Person, ph: Person): void {
    const h = this.h;
    const t = h.tasks.of(ph);
    if (!t || t.kind !== "candid" || t.owner !== ph.id || t.id === this.camera) return;
    const frame = t.steps[0];
    if (frame?.do !== "goto" || frame.to.room !== p.room || frame.to.level !== p.level) return;
    if (ph.room !== p.room && (ph.level !== p.level || Math.hypot(ph.x - p.x, ph.z - p.z) > HEADING)) return;
    this.camera = t.id;
    const f = frame.to;
    this.slip(p, ph, f, { x: f.x + Math.sin(f.yaw) * 8, z: f.z + Math.cos(f.yaw) * 8 }, p.room);
  }

  /** The group photo is called: true when it is in the line like anyone, false when it slipped away. */
  forPhoto(ph: Person, cam: { level: number; x: number; z: number }, foot: { x: number; z: number; room: number }): boolean {
    const p = this.spy.record;
    if (!this.spy.covers.active("out-of-picture")) return true;
    // The host is the photo's middle: there's no slipping out of that.
    if (p.role === "host") return !this.stays("named");
    // In the middle of something (the toast still, a dance): called over like everyone.
    if (p.action && !LOOSE.has(p.action.id)) return !this.stays("busy");
    return !this.slip(p, ph, cam, foot, foot.room);
  }

  /**
   * Out of the camera's way if it can go cleanly (true): not in the middle of something (a dance,
   * dinner, a game: nothing to decide), not talking, the camera not on its circle, a doorway near
   * that doesn't cross the camera's line, and an ordinary reason to go. It ends what it's doing and
   * walks out at its usual pace; only someone who sees it go as the photographer faces it notes
   * anything. Otherwise it plays along (false): in the photo like anyone.
   */
  private slip(p: Person, ph: Person, from: { level: number; x: number; z: number }, to: { x: number; z: number }, room: number): boolean {
    const h = this.h;
    const a = p.action;
    if (a && !LOOSE.has(a.id)) return false;
    if (h.circleOf(p)?.speaker === p.id) return this.stays("talking");
    if (ph.room === p.room && ph.level === p.level && Math.hypot(ph.x - p.x, ph.z - p.z) <= CAMERA_NEAR && this.facing(ph, p)) return this.stays("camera");
    if (p.room === room && p.level === from.level && !this.doorway(p, from, to)) return this.stays("no-door");
    const go = this.reason(p, room);
    if (!go) return this.stays("no-reason");
    if (a) h.end(p, false);
    h.start(p, go);
    if (ph.room === p.room && ph.level === p.level && Math.hypot(ph.x - p.x, ph.z - p.z) <= SEES_GO && this.facing(ph, p)) h.notable(p, "camera-shy", ph.id, 10);
    this.tell("camera-shy", p, 10);
    this.stats.slipped++;
    this.note(`slip:${go.id}`);
    return true;
  }

  /** It plays along, and says why it couldn't slip away (false: it didn't). */
  private stays(why: string): false {
    this.stats.stayed++;
    this.note(`photo-stays:${why}`);
    return false;
  }

  /** Whether a faces b: b within FACING of a's heading. */
  private facing(a: Person, b: Person): boolean {
    let d = Math.atan2(b.x - a.x, b.z - a.z) - a.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) <= FACING;
  }

  /** A doorway out of its room within DOOR_NEAR whose way from it doesn't cross the camera's line (from the camera to what it shoots). */
  private doorway(p: Person, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
    const h = this.h;
    const R = h.bp.rooms.length;
    for (const e of h.world.graph[p.room < 0 ? R : p.room] ?? []) {
      if (e.kind === "stair" || e.level !== p.level || Math.hypot(e.x - p.x, e.z - p.z) > DOOR_NEAR) continue;
      if (e.door >= 0 && !h.world.canPass(h.world.doors[e.door]!, p)) continue;
      if (!crosses(p, e, from, to)) return true;
    }
    return false;
  }

  /** An ordinary reason to walk out of `room`: an empty hand or glass takes it to the bar, its bladder to a bathroom, else a fresh drink. */
  private reason(p: Person, room: number): Candidate | null {
    const items = this.h.world.items;
    const empty = !p.held || (p.item >= 0 && items.kindOf(p.item) === "glass" && items.fill[p.item]! <= 0.1);
    const bar = () => this.toBar(p, room);
    const bath = () => (p.needs.bladder < BLADDER ? this.toBathroom(p, room) : null);
    return empty ? (bar() ?? bath()) : (bath() ?? bar());
  }

  private toBar(p: Person, room: number): Candidate | null {
    const h = this.h;
    const pl = h.places;
    let best: Spot | null = null;
    let bd = Infinity;
    for (const s of pl.bars) {
      if (s.room === room || h.taken(spotKey(s))) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z) + 15 * Math.abs(s.level - p.level);
      if (d < bd) {
        best = s;
        bd = d;
      }
    }
    if (!best) return null;
    return { id: "drink", target: best, duration: this.rng.range(90, 200), pose: "drink", gain: { thirst: 0.8, social: 0.1 }, ref: pl.bars.indexOf(best), note: "bar-go", key: spotKey(best) };
  }

  private toBathroom(p: Person, room: number): Candidate | null {
    const h = this.h;
    let best = -1;
    let bd = Infinity;
    h.places.bathrooms.forEach((b, i) => {
      if (b.room.index === room || h.memory.familiarity(p.id, b.room.index) < KNOWN || !h.worthTrying(p, i)) return;
      const d = Math.hypot(b.door.x - p.x, b.door.z - p.z) + 15 * Math.abs(b.door.level - p.level);
      if (d < bd) {
        best = i;
        bd = d;
      }
    });
    if (best < 0) return null;
    return { id: "toilet", target: h.places.bathrooms[best]!.door, duration: this.rng.range(120, 240), pose: "wait", gain: { bladder: 1 }, ref: best, note: "door" };
  }

  // ---------------------------------------------------------------- following

  /** A step behind whoever it follows (its target, or someone sure of it) in a quiet room for ten seconds: one figure close behind another. */
  private follow(p: Person): void {
    const h = this.h;
    const j = this.spy.trailing;
    const q = j >= 0 ? h.people[j]! : null;
    let close = !!q && q.room === p.room && q.level === p.level && p.room !== -1 && Math.hypot(q.x - p.x, q.z - p.z) <= FOLLOW_NEAR;
    if (close) {
      let others = 0;
      for (const o of h.people) if (o !== p && o !== q && o.present && o.room === p.room && o.level === p.level) others++;
      close = others <= QUIET;
    }
    if (!close) {
      this.followFrom = -1;
      return;
    }
    if (this.followFrom < 0) this.followFrom = h.t;
    if (h.t - this.followFrom < FOLLOW_SECS || h.t < this.followNext) return;
    h.notable(p, "followed", q!.id, 10);
    this.tell("followed", p, 10);
    this.followNext = h.t + FOLLOW_GAP;
    this.followFrom = -1;
    this.stats.followed++;
  }

  // ---------------------------------------------------------------- errands

  /** Sent for a drink when a step of its plan comes up: the glass down where it stands, and off. */
  private drop(p: Person): void {
    const h = this.h;
    const t = h.tasks.of(p);
    if (!t || t.kind !== "errand" || t.owner !== p.id || t.errand !== "drink") return;
    // Once it has said yes: on its way to the bar, or back with the drink.
    const agreed = t.steps.findIndex((s) => s.label === "agree");
    if (t.i <= agreed || !this.spy.plans.ready(p)) return;
    const asker = h.people[t.other];
    const items = h.world.items;
    const glass = p.item >= 0 && items.kindOf(p.item) === "glass" ? p.item : -1;
    if (glass >= 0) {
      h.setDown(p, true);
      h.notable(p, "abandoned", glass, 10);
      this.glass = glass;
      this.spy.measure.tell("abandoned", h.t, PARTY_LENGTH, p.room, h.visibility(p));
    }
    h.tasks.finish(t, "dropped");
    p.thinkAt = h.t;
    if (asker && asker !== p) this.askers.push({ who: asker.id, at: h.t + this.rng.range(ASKER_WAITS[0], ASKER_WAITS[1]) });
    this.stats.drops++;
    this.note(glass >= 0 ? "drop:glass" : "drop");
  }

  /** The drink never came: the one who asked goes to look, at the bar first, asking round, still empty-handed. */
  private comeLooking(q: Person, p: Person): void {
    const h = this.h;
    if (!q.present || q.gone || (q.held && q.held !== "tray") || !q.action || !LOOSE.has(q.action.id)) return;
    let bar: Spot | null = null;
    let bd = Infinity;
    for (const s of h.places.bars) {
      const d = Math.hypot(s.x - q.x, s.z - q.z) + 15 * Math.abs(s.level - q.level);
      if (d < bd) {
        bar = s;
        bd = d;
      }
    }
    if (h.tasks.search(q, p, "errand", bar ?? undefined)) this.stats.asked++;
  }

  // ---------------------------------------------------------------- inside

  /** A tell where it stands, showing this long (in-game s). */
  private tell(what: TellId, p: Person, secs: number): void {
    const h = this.h;
    this.spy.measure.tell(what, h.t, h.t + secs, p.room, h.visibility(p));
  }

  private note(s: string): void {
    const p = this.spy.record;
    this.h.log("spy", [p.id], p.room, s);
  }
}

/** Whether the way from a to b crosses the segment c to d (the camera's line). */
function crosses(a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }, d: { x: number; z: number }): boolean {
  const o = (p: { x: number; z: number }, q: { x: number; z: number }, r: { x: number; z: number }) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
