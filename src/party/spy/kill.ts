/**
 * The kill (milestone 3 technical plan: Killing, bodies and poison). One kill at a time, for its
 * goal (steps.ts), for a doubter it silences (answers.ts) or for the one whose place it takes
 * (swap.ts). Following its victim a step behind, the spy waits for one of two moments, and the
 * moment picks the method:
 *
 * - Strangling: the victim alone (the privacy check's alone mode, as long as the struggle and a
 *   little more), not behind a bolt, with somewhere to hide them reached by a way through no room
 *   with anyone in it. It comes up from behind, and once within reach and still alone, the grip
 *   is the point of no return: 20 to 40 s of struggle (its knack toward the quick end) until they
 *   go limp, the thud as they go down, the drag to the hiding place, and there it holds on two to
 *   four minutes more, until they're dead: out cold isn't dead, and they'd come to.
 * - The injection: the victim standing about (a drink, a circle's edge, the paintings, on their
 *   way to the bathroom, dancing on their own), nobody within 6 m facing them and none of their
 *   partner or friends seeing them, and a free bathroom or an empty guest bedroom it can walk them
 *   to. It comes up beside them, an embrace of a few seconds, and the jab is the point of no
 *   return: it walks them off like a drunk friend, bolts the door, and they die there a minute or
 *   two after the jab (never before they're in).
 *
 * Up to the grip or the jab it can stop like any step: the grip a hand on the shoulder, the
 * embrace a hug, then a word and on. After it, it finishes. Whoever it notices looking its way
 * then it knows saw it (answers.ts). Noticed during the struggle, the drag or the holding on, it
 * lets go and walks off: once the struggle is over, or there and then on the drag or the holding
 * on. Not yet dead, they lie out cold where it left them and come to a minute or so later, and
 * tell someone; dead, the body stays where it is. Whoever sees the struggle, the drag or the
 * holding on sees the notable `attacked`; whoever sees the walk off, `propped-up`, and
 * `propped-sober` too when they saw the victim sober within the hour.
 *
 * Hiding the body (the plan's table): the nearest place on its own storey by a way through no
 * room with anyone in it, within 30 m: a bath behind a shut door (0.85), a pantry, the spa or the
 * gym (0.8), behind a topiary or parterre hedge off the terrace (0.8 in the dark, 0.3 by a lamp),
 * under a bed or in a wardrobe (0.6), a bathroom without a tub (0.5), else where it fell (0.1).
 * The lawn isn't walkable, so a body taken outside goes from the terrace's garden edge to the
 * hedge in the hiding step's time. The record then leaves play: `down` dead, present no more, its
 * glass where it fell, its bag and coat where they were; the bodies list keeps where it lies.
 *
 * It draws only from its own fork.
 */
import type { Rng } from "../../mansion/core/rng";
import type { Prop, Room } from "../../mansion/core/types";
import { TIME_SCALE } from "../clock";
import { frontOf, yawTo } from "../places";
import { FOV } from "../senses";
import type { Step, Task } from "../tasks";
import type { Person, Pose, Spot } from "../types";
import type { SpyBody } from "./cast";
import type { Spy } from "./index";
import { check, doorsNow, noticed, type Spot3 } from "./privacy";
import type { StepsHost } from "./steps";

/** What the kill needs from the party, besides what running the plan needs. */
export interface KillHost extends StepsHost {
  readonly body: {
    readonly baths: ReadonlyArray<{ occupant: number; queue: readonly number[]; hold: number }>;
    holdBath(i: number, p: Person): boolean;
    unholdBath(i: number): void;
  };
  /** The glass in hand set down where they stand. */
  setDown(p: Person, here?: boolean): void;
  /** A body out of play: present no more, its glass where it fell, its bag and coat where they were. */
  leavePlay(p: Person): void;
  /** Off to another room, drawn on the given fork. */
  walkAway(p: Person, rng: Rng): void;
  /** a saw the spy at a kill (the struggle, the drag, the holding on), or came to after it let them go: sure at once, and off to tell someone. */
  attacked?(a: Person, spy: Person, victim: number): void;
}

export type KillHow = "strangled" | "injection";
/** Whom it kills for: its goal, a doubter it silences, the one whose place it takes. */
export type KillWhy = "goal" | "silence" | "swap";
/** How a kill ended: dead, broken off before the point of no return, lost (the victim moved off, or something else took the spy away first), or survived (it let go after the point of no return, before they died). */
export type KillOutcome = "dead" | "broken" | "lost" | "survived";
export type HidePlace = "bath" | "bathroom" | "store" | "bed" | "wardrobe" | "outside" | "fell";

/** Where a body goes. */
export interface Hide {
  place: HidePlace;
  /** What the bodies list says. */
  name: string;
  hides: number;
  /** Where the spy takes them (a spot it can stand on), and where the body is laid there (outside: behind the hedge). */
  to: Spot;
  lay: { level: number; x: number; z: number; room: number };
  /** The door bolted behind them (-1 none), the bathroom held (-1 none), and where it steps out to (null: it just goes). */
  door: number;
  bath: number;
  out: Spot | null;
  /** How far by its way there (m), and outside, how far on from the terrace to the hedge. */
  len: number;
  beyond: number;
}

/** Where a kill has got to. */
export type KillStage = "close" | "embrace" | "struggle" | "drag" | "finish" | "walk-off" | "dying" | "hide" | "out";

interface Kill {
  why: KillWhy;
  how: KillHow;
  victim: number;
  task: number;
  stage: KillStage;
  /** When it began closing in, the point of no return (-1 not yet), when the victim dies (the injection), and when they died (-1 not yet). */
  from: number;
  noReturn: number;
  diesAt: number;
  deadAt: number;
  hide: Hide | null;
  /** It noticed someone after the point of no return: the body stays where it is. And whom. */
  seen: boolean;
  saw: Set<number>;
  /** Whoever saw the victim sober within the hour before the jab. */
  sober: ReadonlySet<number> | null;
  /** Out of play, hidden or left. */
  laid: boolean;
  /** How the runner itself ended it (null: it ran to its end, or something else ended it). */
  end: KillOutcome | null;
}

/** The struggle until they go limp (in-game s), its knack moving it toward the quick end; then holding on where they'll lie until they're dead; the embrace. */
export const STRUGGLE: readonly [number, number] = [20, 40];
export const FINISH: readonly [number, number] = [120, 240];
export const EMBRACE: readonly [number, number] = [2, 4];
/** Let go out cold: they come to this long after (in-game s). */
const WAKE: readonly [number, number] = [20, 90];
/** Injected: dead this long after the jab, and never before they're in. */
export const DYING: readonly [number, number] = [60, 150];
/** Hiding them: in a bath, under a bed or in a wardrobe; into a cupboard; behind a hedge outside, and the walk on from the terrace (in-game s per m). */
const HIDE_IN: readonly [number, number] = [20, 40];
const HIDE_SHUT = 10;
const HIDE_OUT: readonly [number, number] = [10, 20];
/** Dragging, and walking someone off (m per real s); and how far each goes at most (m). */
export const DRAG_SPEED = 0.8;
export const WALK_OFF_SPEED = 0.9;
const MAX_DRAG = 30;
/** As far as they can be walked before the poison takes them (60 to 150 s at the walk off's pace). */
const MAX_WALK = 40;
/** Closing in: from behind for the grip, at their side for the embrace (m), within reach to begin, and this long at most (in-game s). */
const BEHIND = 0.6;
const BESIDE = 0.9;
const REACH = 1.5;
const CLOSE_FOR = 20;
/** A step behind: the same room, within this (m), as goals.ts has it. */
const CLOSE = 6;
/** The injection: only those this close count, and the victim is standing about (or on their way to the bathroom, or dancing on their own). */
const JAB_WITHIN = 6;
const STANDING: ReadonlySet<string> = new Set(["mingle", "drink", "art", "wander", "terrace", "snack", "use"]);
/** Sober: under this at the jab, and seen within this long before it. */
const SOBER = 0.35;
const SOBER_SEEN = 3600;
/** Outside: a hedge this far on from the terrace's garden edge at most (m), and how dark it is there (the garden's light under this). */
const HEDGE_REACH = 10;
const DARK = 0.2;
/** The extra the struggle's privacy check looks ahead (in-game s), beyond the longest struggle. */
const STRUGGLE_SOON = 10;
/** A word and on, after it broke off (in-game s). */
const WORD: readonly [number, number] = [4, 8];
/** How far apart they are while it holds them (m): the victim in front during the struggle, behind on the drag, at its side on the walk off, facing it in the embrace. */
const HOLD_FRONT = 0.4;
const DRAG_BEHIND = 0.7;
const PROP_SIDE = 0.45;
const HUG = 0.35;
/** A pantry, the spa, the gym: shut away. */
const STORES: ReadonlySet<string> = new Set(["pantry", "spa", "gym"]);
/** Where people pass through all evening: never somewhere to strangle anyone. */
const PASSAGES: ReadonlySet<string> = new Set(["corridor", "service-stair", "landing", "entrance-hall", "hall-gallery"]);

const spot3 = (p: Person): Spot3 => ({ level: p.level, x: p.x, z: p.z, y: p.y, room: p.room });

export class Killing {
  readonly stats = { strangled: 0, injected: 0, hugs: 0, broken: 0, lost: 0, left: 0, hidden: 0, seen: 0, survived: 0 };
  /** The last kill's hiding place considered, for the lab. */
  lastHide: Hide | null = null;
  private k: Kill | null = null;
  private ticks = 0;
  /** Let go out cold: who, and when they come to. */
  private readonly waking: Array<{ who: number; at: number }> = [];
  /** How far each door was open on the last step, for hearing one open from shut. */
  private readonly shut: Float32Array;

  constructor(
    private readonly h: KillHost,
    private readonly spy: Spy,
    private readonly rng: Rng,
  ) {
    this.shut = new Float32Array(h.world.doors.length);
  }

  /** A kill under way, from closing in to stepping out. */
  get busy(): boolean {
    return this.k !== null;
  }

  /** Whom it holds now: past closing in (-1 nobody). */
  get victim(): number {
    return this.k && this.k.stage !== "close" ? this.k.victim : -1;
  }

  /** Where the kill has got to (null none), for the lab. */
  get stage(): KillStage | null {
    return this.k?.stage ?? null;
  }

  /** Whether the kill shows a notable of its own on the spy now: the struggle, the drag, holding on, the walk off. */
  showing(p: Person): boolean {
    const s = this.k?.stage;
    return p.id === this.spy.id && (s === "struggle" || s === "drag" || s === "finish" || s === "walk-off");
  }

  // ---------------------------------------------------------------- the moment

  /**
   * Following q a step behind: whether this is a moment, and for which method. Strangling first,
   * the quieter death, when alone with them; else the injection, when it's on.
   */
  moment(p: Person, q: Person, ways: { strangle: boolean; inject: boolean }): { how: KillHow; hide: Hide } | null {
    if (!q.present || q.gone || q.down || q.level !== p.level || q.room !== p.room || Math.hypot(q.x - p.x, q.z - p.z) > CLOSE) return null;
    if (ways.strangle) {
      const hide = this.strangling(p, q);
      if (hide) return { how: "strangled", hide };
    }
    if (ways.inject) {
      const to = this.jabbing(p, q);
      if (to) return { how: "injection", hide: to };
    }
    return null;
  }

  /** Alone with q, off the stairs and out of the passages, not behind a bolt, and somewhere to hide them: where. */
  private strangling(p: Person, q: Person): Hide | null {
    const h = this.h;
    if (q.pose === "climb" || q.path[q.pathIndex]?.climb || (q.room >= 0 && PASSAGES.has(h.bp.rooms[q.room]!.type)) || this.bolted(q.room)) return null;
    // Anyone else in the room: the privacy check would say no.
    for (const o of h.people) if (o !== p && o !== q && o.present && !o.gone && (!o.down || o.down === "ill") && o.room === q.room) return null;
    const c = check(h, { mode: "alone", at: spot3(q), secs: STRUGGLE[1] + STRUGGLE_SOON, self: p, who: null, skip: q.id });
    this.spy.plans.check = c;
    if (!c.ok) return null;
    const hide = this.hiding(p, q);
    this.lastHide = hide;
    return hide;
  }

  /** Standing about, nobody close facing them, none of theirs seeing them, and somewhere to walk them to: where. */
  private jabbing(p: Person, q: Person): Hide | null {
    const h = this.h;
    if (Math.hypot(q.x - p.x, q.z - p.z) > JAB_WITHIN || q.pose === "sit") return null;
    // In the embrace they're in its task already.
    const a = q.action;
    const about =
      !a ||
      (a.id === "task" && a.ref === this.k?.task) ||
      (STANDING.has(a.id) && !(a.id === "drink" && a.note === "bar-wait")) ||
      (a.id === "toilet" && a.startedAt === null && a.note !== "queue") ||
      (a.id === "dance" && a.ref === undefined);
    if (!about) return null;
    const c = check(h, { mode: "unwatched", at: spot3(q), secs: EMBRACE[1] + 2, self: p, who: null, skip: q.id, within: JAB_WITHIN });
    this.spy.plans.check = c;
    if (!c.ok || this.theirsSee(q, p)) return null;
    return this.walkTo(p, q);
  }

  /** Whether q's partner or a friend of theirs can see them now: they'd come along. */
  private theirsSee(q: Person, p: Person): boolean {
    const h = this.h;
    const at = spot3(q);
    const theirs = q.partner !== null ? [q.partner, ...q.friends] : q.friends;
    for (const j of theirs) {
      const f = h.people[j]!;
      if (f === p || !f.present || f.gone || (f.down && f.down !== "ill")) continue;
      if (h.senses.visibleAt(f, at, FOV, q)) return true;
    }
    return false;
  }

  /** Begin: closing in on them, from behind for the grip or at their side for the embrace. False when it couldn't even set off. */
  begin(p: Person, q: Person, m: { how: KillHow; hide: Hide }, why: KillWhy): boolean {
    const h = this.h;
    if (this.k) return false;
    const gap = m.how === "strangled" ? BEHIND : BESIDE;
    const t = h.tasks.spy(p, `kill:${m.how}`, "wander", [{ do: "shadow", who: q.id, gap, label: "kill:close" }]);
    if (t.outcome !== null) return false;
    this.k = {
      why,
      how: m.how,
      victim: q.id,
      task: t.id,
      stage: "close",
      from: h.t,
      noReturn: -1,
      diesAt: -1,
      deadAt: -1,
      hide: m.hide,
      seen: false,
      saw: new Set(),
      sober: null,
      laid: false,
      end: null,
    };
    this.note(`kill:${m.how}:${q.id}`);
    return true;
  }

  // ------------------------------------------------------------- each step

  /** Once a step, after everyone has moved: anyone let go coming to; closing in, holding the victim where the kill has them, the watch, the notable. */
  step(): void {
    if (this.waking.length) this.wake();
    const k = this.k;
    if (!k) return;
    const h = this.h;
    this.ticks++;
    const t = h.tasks.get(k.task);
    if (!t) return;
    const p = this.spy.record;
    const q = h.people[k.victim]!;
    switch (k.stage) {
      case "close":
        return this.closing(k, t, p, q);
      case "embrace":
        return this.hold(q, p, HUG, 0, p.yaw + Math.PI);
      case "struggle":
        this.hold(q, p, HOLD_FRONT, 0, p.yaw);
        h.notable(p, "attacked", q.id, 3, p.room);
        return this.watch(k, p, q);
      case "drag":
        this.hold(q, p, -DRAG_BEHIND, 0, p.yaw + Math.PI);
        h.notable(p, "attacked", q.id, 3, p.room);
        this.spy.measure.tell("drag", h.t, h.t + 2, p.room, h.visibility(p));
        return this.watch(k, p, q);
      case "finish":
        h.notable(p, "attacked", q.id, 3, p.room);
        this.spy.measure.tell("struggle", h.t, h.t + 2, p.room, h.visibility(p));
        return this.watch(k, p, q);
      case "walk-off":
        this.hold(q, p, 0, PROP_SIDE, p.yaw);
        h.notable(p, "propped-up", q.id, 3, p.room);
        this.spy.measure.tell("propped", h.t, h.t + 2, p.room, h.visibility(p));
        return;
      default:
        return;
    }
  }

  /** Closing in: within reach and the moment still there, the point of no return (or the embrace first); them moving off, or too long, and it falls back. */
  private closing(k: Kill, t: Task, p: Person, q: Person): void {
    const h = this.h;
    if (!q.present || q.gone || q.down) return this.end(t, "lost");
    if (h.byeAt >= 0 || h.t - k.from > CLOSE_FOR || q.level !== p.level || q.room !== p.room || Math.hypot(q.x - p.x, q.z - p.z) > CLOSE || this.bolted(q.room)) return this.end(t, "lost");
    if (this.ticks % 2 !== 0 || Math.hypot(q.x - p.x, q.z - p.z) > REACH) return;
    if (k.how === "strangled") {
      const hide = this.strangling(p, q);
      if (!hide) return this.breakOff(t, p, q);
      k.hide = hide;
      return this.grip(k, t, p, q);
    }
    const to = this.jabbing(p, q);
    if (!to) return this.breakOff(t, p, q);
    k.hide = to;
    this.embrace(k, t, p, q);
  }

  /** The victim where the kill has them: `along` ahead of the spy (behind when negative), `side` to its right, facing `yaw`. */
  private hold(q: Person, p: Person, along: number, side: number, yaw: number): void {
    const pf = this.h.pf;
    const sx = Math.sin(p.yaw);
    const cz = Math.cos(p.yaw);
    let x = p.x + sx * along + cz * side;
    let z = p.z + cz * along - sx * side;
    let room = pf.roomAt(p.level, x, z);
    if (room === -1 || !pf.walkable(p.level, x, z)) {
      x = p.x;
      z = p.z;
      room = p.room;
    }
    q.level = p.level;
    q.x = x;
    q.z = z;
    q.y = p.y;
    q.room = room;
    q.yaw = yaw;
  }

  /** After the point of no return, by its own senses: whoever it notices looking its way saw it. Once the struggle is over, or there and then on the drag or holding on, it lets go and walks off. */
  private watch(k: Kill, p: Person, q: Person): void {
    const h = this.h;
    if (this.ticks % 2 !== 0) return;
    const by = noticed(h, { mode: "unwatched", at: spot3(p), secs: 10, self: p, who: null, skip: q.id }, this.shut);
    doorsNow(h, this.shut);
    if (by < 0 || k.saw.has(by)) return;
    k.saw.add(by);
    this.spy.answers.sawKill(by);
    this.stats.seen++;
    h.log("spy", [p.id, by], p.room, `kill-seen:${k.stage}`);
    if (k.seen) return;
    k.seen = true;
    if (k.stage === "drag") this.leave(k, p, q, "dropped");
    else if (k.stage === "finish") this.leave(k, p, q, "seen");
  }

  // ------------------------------------------------------------ the grip

  /** The grip from behind: the point of no return. */
  private grip(k: Kill, t: Task, p: Person, q: Person): void {
    const h = this.h;
    const hide = k.hide!;
    if (hide.bath >= 0 && !h.body.holdBath(hide.bath, p)) k.hide = this.fell(q);
    this.seize(k, t, p, q);
    const [lo, hi] = STRUGGLE;
    const secs = lo + (hi - lo) * this.rng.next() * (1 - 0.6 * this.spy.knack.kill);
    p.yaw = yawTo(p.x, p.z, q.x, q.z);
    t.steps.splice(t.i + 1, t.steps.length, { do: "wait", s: secs, pose: "struggle", label: "kill:struggle" });
    h.tasks.next(t);
    k.stage = "struggle";
    h.notable(p, "attacked", q.id, 3, p.room);
    this.spy.measure.tell("struggle", h.t, h.t + secs, p.room, h.visibility(p));
    doorsNow(h, this.shut);
    this.stats.strangled++;
    this.note(`kill:grip:${q.id}`);
  }

  /** At the point of no return: the victim is held (in the task, down), both glasses go down where they stand, and the goal counts as tried. */
  private seize(k: Kill, t: Task, p: Person, q: Person): void {
    const h = this.h;
    k.noReturn = h.t;
    h.setDown(q, true);
    h.setDown(p, true);
    h.tasks.join(t, q);
    q.down = "dying";
    h.log("down", [q.id, p.id], q.room, "dying");
    if (k.why === "goal") this.spy.tried();
  }

  // ---------------------------------------------------------- the injection

  /** Within reach and unwatched: an embrace (a hug, a hand on the arm) of a few seconds, which can still be just that. */
  private embrace(k: Kill, t: Task, p: Person, q: Person): void {
    const h = this.h;
    const secs = this.rng.range(EMBRACE[0], EMBRACE[1]);
    h.tasks.join(t, q);
    p.yaw = yawTo(p.x, p.z, q.x, q.z);
    t.steps.splice(t.i + 1, t.steps.length, { do: "wait", s: secs, pose: "hug", label: "kill:embrace" });
    h.tasks.next(t);
    k.stage = "embrace";
    this.spy.measure.tell("embrace", h.t, h.t + secs, p.room, h.visibility(p));
  }

  /** The embrace's end: still unwatched, the jab (the point of no return) and the walk off; else it was only a hug. */
  private jab(k: Kill, t: Task, p: Person, q: Person): void {
    const h = this.h;
    const to = this.jabbing(p, q);
    const hide = to && (to.bath < 0 || h.body.holdBath(to.bath, p)) ? to : null;
    if (!hide) {
      this.stats.hugs++;
      // Only a hug: they go back to what they were doing.
      h.end(q, false);
      q.thinkAt = h.t;
      return this.breakOff(t, p, q);
    }
    k.hide = hide;
    this.seize(k, t, p, q);
    k.diesAt = h.t + this.rng.range(DYING[0], DYING[1]);
    // Whoever saw them sober within the hour makes something worse of the walk off.
    if (q.tipsy < SOBER) {
      const n = h.people.length;
      const sober = new Set<number>();
      for (const a of h.people) if (a !== p && a !== q && h.memory.lastT[a.id * n + q.id]! > h.t - SOBER_SEEN) sober.add(a.id);
      k.sober = sober;
    }
    this.spy.measure.tell("jab", h.t, h.t + 1, p.room, h.visibility(p));
    p.speed = WALK_OFF_SPEED;
    // From the embrace's end (tasks.ts moves on to these itself).
    const steps: Step[] = [{ do: "goto", to: hide.to, label: "kill:walk-off" }, { do: "wait", s: 0, pose: "serve", label: "kill:in" }, ...this.inside(hide, "injection")];
    t.steps.splice(t.i + 1, t.steps.length, ...steps);
    k.stage = "walk-off";
    h.notable(p, "propped-up", q.id, 3, p.room);
    this.stats.injected++;
    this.note(`kill:jab:${q.id}`);
  }

  /** The steps in the place it takes them: the bolt drawn behind them, their last minutes (injected) or holding on until they're dead (strangled), the hiding, the bolt back and out. */
  private inside(hide: Hide, how: KillHow): Step[] {
    const steps: Step[] = [];
    const room = hide.lay.room;
    if (hide.door >= 0) steps.push({ do: "bolt", door: hide.door, room, label: "kill:bolt" });
    if (how === "injection") steps.push({ do: "wait", s: 1, pose: "stand", label: "kill:dying" });
    else steps.push({ do: "wait", s: this.rng.range(FINISH[0], FINISH[1]), pose: "struggle", label: "kill:finish" });
    const secs =
      hide.place === "store" ? HIDE_SHUT : hide.place === "outside" ? this.rng.range(HIDE_OUT[0], HIDE_OUT[1]) + (2 * hide.beyond * TIME_SCALE) / DRAG_SPEED : this.rng.range(HIDE_IN[0], HIDE_IN[1]);
    steps.push({ do: "wait", s: secs, pose: "serve", label: "kill:hide" });
    if (hide.door >= 0) steps.push({ do: "unbolt", door: hide.door, room, label: "kill:unbolt" });
    if (hide.out) steps.push({ do: "goto", to: hide.out, label: "kill:out" });
    return steps;
  }

  // -------------------------------------------------------------- outcomes

  /** A step of the kill's task done. */
  stepDone(t: Task, st: Step): void {
    const k = this.k;
    if (!k || t.id !== k.task) return;
    const h = this.h;
    const p = this.spy.record;
    const q = h.people[k.victim]!;
    switch (st.label) {
      case "kill:embrace":
        return this.jab(k, t, p, q);
      case "kill:struggle":
        // Limp, and down with a thud.
        h.sound("thud", { level: q.level, x: q.x, z: q.z, room: q.room }, q.id);
        this.spy.measure.end("struggle", h.t);
        if (k.seen) return this.leave(k, p, q, "seen");
        // A look at the way before the drag: somewhere else if someone is in it now, else it holds on here.
        if (k.hide!.place !== "fell") this.rehide(k, p, q);
        if (k.hide!.place === "fell") {
          // Nowhere to take them: it holds on where they fell.
          t.steps.splice(t.i + 1, t.steps.length, { do: "wait", s: this.rng.range(FINISH[0], FINISH[1]), pose: "struggle", label: "kill:finish" });
          k.stage = "finish";
          return;
        }
        return this.drag(k, t, p, q);
      case "kill:in": {
        // In: laid where they'll lie, the spy back to its own pace.
        const hide = k.hide!;
        this.lay(q, hide);
        p.speed = t.speed;
        this.spy.measure.end(k.how === "strangled" ? "drag" : "propped", h.t);
        if (p.notable === "propped-up") p.notableUntil = h.t;
        k.stage = k.how === "injection" ? "dying" : "finish";
        return;
      }
      case "kill:bolt": {
        // Their last minutes behind the bolt: never before they're in.
        const next = t.steps[t.i + 1];
        if (k.how === "injection" && next?.do === "wait" && next.label === "kill:dying") next.s = Math.max(1, k.diesAt - h.t);
        return;
      }
      case "kill:dying":
      case "kill:finish":
        this.dead(k, p, q);
        if (p.notable === "attacked") p.notableUntil = h.t;
        this.spy.measure.end("struggle", h.t);
        if (k.hide!.place === "fell") return this.leave(k, p, q, "fell");
        k.stage = "hide";
        return;
      case "kill:hide":
        this.hidden(k, q, k.hide!);
        k.stage = "out";
        return;
    }
  }

  /** Dead: the record's `down`, the goal done. */
  private dead(k: Kill, p: Person, q: Person): void {
    const h = this.h;
    if (k.deadAt >= 0) return;
    k.deadAt = h.t;
    q.down = "dead";
    h.log("down", [q.id, p.id], q.room, "dead");
    if (k.why === "goal") this.spy.goalDone();
  }

  /** The hiding place again, from the way as it is now: the bathroom it held let go if it goes elsewhere, and where they fell if there's nowhere now. */
  private rehide(k: Kill, p: Person, q: Person): void {
    const h = this.h;
    const was = k.hide!;
    const now = this.hiding(p, q);
    this.lastHide = now;
    if (was.bath >= 0 && now?.bath !== was.bath) h.body.unholdBath(was.bath);
    if (now && now.bath >= 0 && now.bath !== was.bath && !h.body.holdBath(now.bath, p)) k.hide = this.fell(q);
    else k.hide = now ?? this.fell(q);
  }

  /** Out cold and unseen: the drag to the hiding place, at the drag's pace. */
  private drag(k: Kill, t: Task, p: Person, q: Person): void {
    const h = this.h;
    const hide = k.hide!;
    p.speed = DRAG_SPEED;
    t.steps.splice(t.i + 1, t.steps.length, { do: "goto", to: hide.to, label: "kill:drag" }, { do: "wait", s: 0, pose: "serve", label: "kill:in" }, ...this.inside(hide, "strangled"));
    k.stage = "drag";
    h.notable(p, "attacked", q.id, 3, p.room);
    this.note(`kill:drag:${hide.place}`);
  }

  /** Laid where they'll lie: on the hiding place's furniture, or where the spy stands. */
  private lay(q: Person, hide: Hide): void {
    const l = hide.place === "outside" ? hide.to : hide.lay;
    const room = this.h.pf.roomAt(l.level, l.x, l.z);
    const at = room === hide.to.room ? l : hide.to;
    q.level = at.level;
    q.x = at.x;
    q.z = at.z;
    q.room = hide.to.room;
  }

  /** The hiding step done: out of play, where the hiding place has them. */
  private hidden(k: Kill, q: Person, hide: Hide): void {
    if (k.laid) return;
    this.stats.hidden++;
    this.out(k, q, hide.place === "outside" ? hide.lay : { level: q.level, x: q.x, z: q.z, room: q.room }, hide.name, hide.hides);
    this.note(`kill:hidden:${hide.place}`);
  }

  /** It leaves them where they are (where they fell, or dropped on the drag when someone came), dead or out cold, and goes off elsewhere. */
  private leave(k: Kill, p: Person, q: Person, why: "seen" | "fell" | "dropped"): void {
    const h = this.h;
    const t = h.tasks.get(k.task);
    if (k.deadAt < 0) this.letGo(k, q);
    else if (!k.laid) {
      this.stats.left++;
      this.out(k, q, { level: q.level, x: q.x, z: q.z, room: q.room }, why === "dropped" ? "dropped where it was dragged" : "where it fell", 0.1);
    }
    if (k.hide && k.hide.bath >= 0) h.body.unholdBath(k.hide.bath);
    if (t) this.end(t, k.deadAt >= 0 ? "dead" : "survived");
    h.walkAway(p, this.rng);
    this.note(`kill:left:${why}`);
  }

  /** Let go before they died: out cold where they lie, out of its task, and coming to in a minute or so. It knows they'll talk. */
  private letGo(k: Kill, q: Person): void {
    const h = this.h;
    if (k.laid) return;
    k.laid = true;
    this.stats.survived++;
    q.down = "collapsed";
    h.end(q, false);
    this.waking.push({ who: q.id, at: h.t + this.rng.range(WAKE[0], WAKE[1]) });
    this.spy.answers.sawKill(q.id);
    h.log("down", [q.id], q.room, "collapsed");
  }

  /** Whoever it let go comes to when their time comes: up, and sure of what it did. */
  private wake(): void {
    const h = this.h;
    for (let i = 0; i < this.waking.length; ) {
      const w = this.waking[i]!;
      if (h.t < w.at) {
        i++;
        continue;
      }
      this.waking.splice(i, 1);
      const q = h.people[w.who]!;
      if (q.down !== "collapsed" || !q.present || q.gone) continue;
      q.down = null;
      q.thinkAt = h.t;
      h.log("down", [q.id], q.room, "came-to");
      h.attacked?.(q, this.spy.record, q.id);
    }
  }

  /** Out of play, into the bodies list. */
  private out(k: Kill, q: Person, at: { level: number; x: number; z: number; room: number }, place: string, hides: number): void {
    const h = this.h;
    k.laid = true;
    if (k.deadAt < 0) this.dead(k, this.spy.record, q);
    const body: SpyBody = { who: q.id, at: { ...at }, place, hides, t: k.deadAt, how: k.how };
    this.spy.bodies.push(body);
    h.leavePlay(q);
    h.log("down", [q.id], at.room, hides > 0.1 ? "hidden" : "left");
  }

  /** It broke off before the point of no return: a hand on their shoulder or a hug, a word, and on. */
  private breakOff(t: Task, p: Person, q: Person): void {
    const h = this.h;
    this.stats.broken++;
    this.end(t, "broken");
    p.yaw = yawTo(p.x, p.z, q.x, q.z);
    h.tasks.spy(p, "cover", "mingle", [{ do: "wait", s: this.rng.range(WORD[0], WORD[1]), pose: "talk", label: "cover" }]);
  }

  /** The runner ends the kill's task itself. */
  private end(t: Task, out: KillOutcome): void {
    if (this.k && t.id === this.k.task) this.k.end = out;
    this.h.tasks.finish(t, out === "dead" ? "done" : out);
  }

  /**
   * The kill's task ended, however it went. Before the point of no return the victim goes back to
   * what they were doing. After it, ended from outside before its end, it sees it through at once:
   * dead where they are if not yet, and the body left there if not yet laid.
   */
  finished(t: Task): void {
    const k = this.k;
    if (!k || t.id !== k.task) return;
    const h = this.h;
    const q = h.people[k.victim]!;
    this.k = null;
    if (k.hide && k.hide.bath >= 0) h.body.unholdBath(k.hide.bath);
    let out: KillOutcome;
    if (k.noReturn < 0) {
      out = k.end ?? "lost";
      if (out === "lost") this.stats.lost++;
    } else if (k.deadAt >= 0) {
      out = "dead";
      if (!k.laid) {
        this.stats.left++;
        this.out(k, q, { level: q.level, x: q.x, z: q.z, room: q.room }, "where it fell", 0.1);
      }
    } else {
      // Taken off it from outside before they died: it let go.
      out = "survived";
      this.letGo(k, q);
    }
    this.note(`kill:end:${out}`);
    this.spy.killEnded(k.why, out, k.how);
  }

  // -------------------------------------------------------------- what shows

  /** How the spy and its victim look while it holds them (null: as the sim has it). */
  pose(p: Person): Pose | null {
    const k = this.k;
    if (!k || k.stage === "close") return null;
    const me = p.id === this.spy.id;
    if (!me && p.id !== k.victim) return null;
    switch (k.stage) {
      case "embrace":
        return "hug";
      case "struggle":
        return "struggle";
      case "drag":
        return me ? "drag" : "lie";
      case "finish":
        return me ? "struggle" : "lie";
      case "walk-off":
        return me ? "prop" : "sag";
      default:
        return me ? null : p.down === "dead" ? "lie" : "sag";
    }
  }

  /** Someone sees the spy at the kill: the struggle, the drag or holding on is an attack; the walk off, one who saw the victim sober within the hour makes more of. */
  saw(a: Person, b: Person): void {
    const k = this.k;
    if (!k || b.id !== this.spy.id || this.h.t >= b.notableUntil) return;
    const h = this.h;
    if (b.notable === "attacked") h.attacked?.(a, b, k.victim);
    else if (b.notable === "propped-up" && k.sober?.has(a.id) && !h.memory.witnessed(a.id, "propped-sober", b.id)) h.memory.observe(a.id, "propped-sober", b.id, k.victim, b.room);
  }

  /** Its line in the spy's digest: kills by each method, hugs, break-offs, bodies hidden and left, and those it let go alive. */
  digest(): string {
    const s = this.stats;
    return `${s.strangled},${s.injected},${s.hugs},${s.broken},${s.hidden},${s.left},${s.survived}`;
  }

  // ------------------------------------------------------------ hiding places

  /** A room bolted from inside. */
  private bolted(room: number): boolean {
    return room >= 0 && this.h.world.doors.some((d) => d.locked && d.lock === "inside" && d.inner === room);
  }

  /** Where it fell: nowhere to take them. */
  private fell(q: Person): Hide {
    const at: Spot = { level: q.level, x: q.x, z: q.z, yaw: q.yaw, room: q.room };
    return { place: "fell", name: "where it fell", hides: 0.1, to: at, lay: at, door: -1, bath: -1, out: null, len: 0, beyond: 0 };
  }

  /** Whether a bathroom is free to hold: nobody in it, on the way in or waiting (or held by the spy already). */
  private bathFree(i: number): boolean {
    const b = this.h.body.baths[i]!;
    return (b.occupant < 0 || b.hold === this.spy.id) && !b.queue.length;
  }

  /** Nobody in a room (but the spy and its victim), awake or not: the dead and the fallen don't count. */
  private empty(room: number, p: Person, q: Person): boolean {
    for (const o of this.h.people) if (o !== p && o !== q && o.present && !o.gone && o.room === room && (!o.down || o.down === "ill")) return false;
    return true;
  }

  /** A spot in the middle of a room, or near it. */
  private middle(r: Room): Spot | null {
    const pf = this.h.pf;
    const w = pf.snap(r.level, (r.inner.x0 + r.inner.x1) / 2, (r.inner.z0 + r.inner.z1) / 2, 3);
    return w && pf.roomAt(r.level, w.x, w.z) === r.index ? { level: r.level, x: w.x, z: w.z, yaw: 0, room: r.index } : null;
  }

  /** A bedroom's or dressing room's own bolt (-1 none), with the spot outside it. */
  private boltOf(room: number): { door: number; out: Spot | null } {
    const h = this.h;
    const d = h.world.doors.find((x) => x.lock === "inside" && x.inner === room);
    return d ? { door: d.id, out: h.tasks.outside(d, room) } : { door: -1, out: null };
  }

  /** The places on a storey a body could go, unordered (outside on the ground floor). */
  private places(level: number, p: Person, q: Person): Hide[] {
    const h = this.h;
    const out: Hide[] = [];
    const lay = (pr: Prop, room: number) => ({ level: pr.level, x: pr.x, z: pr.z, room });
    h.places.bathrooms.forEach((b, i) => {
      if (b.room.level !== level || b.doorId < 0 || !this.bathFree(i) || !this.empty(b.room.index, p, q)) return;
      const tub = h.bp.props.find((x) => x.kind === "bathtub" && x.roomId === b.room.id);
      const d = h.world.doors[b.doorId]!;
      out.push({
        place: tub ? "bath" : "bathroom",
        name: tub ? "in the bath, the curtain drawn" : "in the bathroom",
        hides: tub ? 0.85 : 0.5,
        to: b.inside,
        lay: tub ? lay(tub, b.room.index) : { level, x: b.inside.x, z: b.inside.z, room: b.room.index },
        door: d.lock === "inside" ? d.id : -1,
        bath: i,
        out: b.door,
        len: 0,
        beyond: 0,
      });
    });
    for (const r of h.bp.rooms) {
      if (r.level !== level || !this.empty(r.index, p, q)) continue;
      if (STORES.has(r.type)) {
        const s = this.middle(r);
        if (s) out.push({ place: "store", name: `shut in the ${r.type}`, hides: 0.8, to: s, lay: s, door: -1, bath: -1, out: null, len: 0, beyond: 0 });
      } else if (r.type === "bedroom" || r.type === "dressing-room") {
        const bed = h.bp.props.find((x) => x.kind === "bed" && x.roomId === r.id);
        const wardrobe = h.bp.props.find((x) => x.kind === "wardrobe" && x.roomId === r.id);
        const pr = bed ?? wardrobe;
        const s = pr ? frontOf(h.pf, pr) : null;
        if (!pr || !s || s.room !== r.index) continue;
        const { door, out: o } = this.boltOf(r.index);
        out.push({ place: bed ? "bed" : "wardrobe", name: bed ? "under the bed" : "in the wardrobe", hides: 0.6, to: s, lay: lay(pr, r.index), door, bath: -1, out: o, len: 0, beyond: 0 });
      }
    }
    if (level === 0) {
      const o = this.outside(p, q);
      if (o) out.push(o);
    }
    return out;
  }

  /** Behind a topiary or a parterre hedge off the terrace's garden edge, the nearest within HEDGE_REACH of it: dark or by a lamp. */
  private outside(p: Person, q: Person): Hide | null {
    const h = this.h;
    const site = h.bp.site;
    const r = site.terrace.rect;
    if (!this.empty(-2, p, q)) return null;
    const hedges: Array<{ x: number; z: number; name: string }> = [];
    for (const t of site.topiary) hedges.push({ x: t.x, z: t.z + t.radius + 0.6, name: "behind a topiary" });
    for (const pt of site.parterres) {
      const pr = pt.rect;
      hedges.push(
        { x: (pr.x0 + pr.x1) / 2, z: pr.z1 + 0.6, name: "behind the parterre hedge" },
        { x: pr.x0 - 0.6, z: pr.z1, name: "behind the parterre hedge" },
        { x: pr.x1 + 0.6, z: pr.z1, name: "behind the parterre hedge" },
      );
    }
    let best: Hide | null = null;
    for (const hd of hedges) {
      const x = Math.max(r.x0 + 0.6, Math.min(r.x1 - 0.6, hd.x));
      const w = h.pf.snap(0, x, r.z1 - 0.6, 1.5);
      if (!w || h.pf.roomAt(0, w.x, w.z) !== -2) continue;
      const beyond = Math.hypot(hd.x - w.x, hd.z - w.z);
      if (beyond > HEDGE_REACH || (best && beyond >= best.beyond)) continue;
      const dark = this.gardenLight(hd.x, hd.z) < DARK;
      best = {
        place: "outside",
        name: `${hd.name} in the garden`,
        hides: dark ? 0.8 : 0.3,
        to: { level: 0, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, hd.x, hd.z), room: -2 },
        lay: { level: 0, x: hd.x, z: hd.z, room: -1 },
        door: -1,
        bath: -1,
        out: null,
        len: 0,
        beyond,
      };
    }
    return best;
  }

  /** The garden's light at a point, as the party has it: the nearest lamp's reach. */
  private gardenLight(x: number, z: number): number {
    let v = 0;
    for (const l of this.h.bp.lights) {
      if (l.scope !== "exterior" || (l.kind !== "lamppost" && l.kind !== "lantern" && l.kind !== "uplight")) continue;
      v = Math.max(v, 1 - Math.hypot(l.x - x, l.z - z) / l.range);
    }
    return v;
  }

  /**
   * The nearest hiding place by its way there, on the victim's storey, within MAX_DRAG, by a way
   * through no room with anyone in it (null: none). Nearest first by a straight line, so a way
   * longer than the best found ends the search.
   */
  private hiding(p: Person, q: Person): Hide | null {
    const from = spot3(q);
    const near = (c: Hide) => Math.hypot(c.to.x - from.x, c.to.z - from.z) + c.beyond;
    const cands = this.places(q.level, p, q).sort((a, b) => near(a) - near(b));
    let best: Hide | null = null;
    for (const c of cands) {
      const straight = near(c);
      if (straight > MAX_DRAG || (best && straight >= best.len + best.beyond)) break;
      const way = this.way(from, c.to, p, q, true);
      if (way === null || way + c.beyond > MAX_DRAG || (best && way + c.beyond >= best.len + best.beyond)) continue;
      best = { ...c, len: way };
    }
    return best;
  }

  /** Where to walk them off to: the nearest free bathroom or empty guest bedroom with a bolt, by its way, within MAX_WALK (null: none). */
  private walkTo(p: Person, q: Person): Hide | null {
    const h = this.h;
    const from = spot3(q);
    const cands: Hide[] = [];
    h.places.bathrooms.forEach((b, i) => {
      if (b.doorId < 0 || !this.bathFree(i) || !this.empty(b.room.index, p, q)) return;
      const d = h.world.doors[b.doorId]!;
      if (d.lock !== "inside" || d.locked) return;
      const tub = h.bp.props.find((x) => x.kind === "bathtub" && x.roomId === b.room.id);
      cands.push({
        place: tub ? "bath" : "bathroom",
        name: tub ? "in the bath, the curtain drawn" : "in the bathroom",
        hides: tub ? 0.85 : 0.5,
        to: b.inside,
        lay: tub ? { level: tub.level, x: tub.x, z: tub.z, room: b.room.index } : { level: b.room.level, x: b.inside.x, z: b.inside.z, room: b.room.index },
        door: d.id,
        bath: i,
        out: b.door,
        len: 0,
        beyond: 0,
      });
    });
    for (const r of h.places.guestBedrooms) {
      if (!this.empty(r.index, p, q) || this.bolted(r.index)) continue;
      const { door, out } = this.boltOf(r.index);
      if (door < 0) continue;
      const bed = h.bp.props.find((x) => x.kind === "bed" && x.roomId === r.id);
      const wardrobe = h.bp.props.find((x) => x.kind === "wardrobe" && x.roomId === r.id);
      const pr = bed ?? wardrobe;
      const s = pr ? frontOf(h.pf, pr) : this.middle(r);
      if (!s || s.room !== r.index) continue;
      cands.push({
        place: pr ? (bed ? "bed" : "wardrobe") : "bed",
        name: pr && !bed ? "in the wardrobe" : "under the bed",
        hides: 0.6,
        to: s,
        lay: pr ? { level: pr.level, x: pr.x, z: pr.z, room: r.index } : { level: s.level, x: s.x, z: s.z, room: r.index },
        door,
        bath: -1,
        out,
        len: 0,
        beyond: 0,
      });
    }
    const near = (c: Hide) => Math.hypot(c.to.x - from.x, c.to.z - from.z) + 6 * Math.abs(c.to.level - from.level);
    cands.sort((a, b) => near(a) - near(b));
    let best: Hide | null = null;
    for (const c of cands) {
      if (near(c) > MAX_WALK || (best && near(c) >= best.len)) break;
      const way = this.way(from, c.to, p, q, false);
      if (way === null || way > MAX_WALK || (best && way >= best.len)) continue;
      best = { ...c, len: way };
    }
    this.lastHide = best;
    return best;
  }

  /** How far the way from a point to a spot is for the spy (m), or null when there's none, or (`quiet`) it passes through a room with anyone in it. */
  private way(from: Spot3, to: Spot, p: Person, q: Person, quiet: boolean): number | null {
    const h = this.h;
    const route = h.pf.route({ level: from.level, x: from.x, z: from.z }, to, p);
    if (!route) return null;
    let len = 0;
    const rooms = new Set<number>();
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!;
      const b = route[i]!;
      const d = a.level === b.level ? Math.hypot(b.x - a.x, b.z - a.z) : 4;
      len += d;
      if (!quiet) continue;
      // The rooms it passes through, a point a metre.
      for (let s = 0; s <= d; s += 1) {
        const f = d > 0 ? s / d : 1;
        rooms.add(h.pf.roomAt(b.level, a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f));
      }
    }
    if (quiet) {
      rooms.delete(from.room);
      rooms.delete(-1);
      for (const r of rooms) if (!this.empty(r, p, q)) return null;
    }
    return len;
  }

  private note(s: string): void {
    const p = this.spy.record;
    this.h.log("spy", [p.id], p.room, s);
  }
}
