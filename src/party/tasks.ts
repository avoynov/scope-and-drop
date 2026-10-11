/**
 * Jobs of several steps for one person or a small party (milestone 2 technical plan: Tasks):
 * the host's tour, errands, a search for a partner, the photographer's candid shots and the
 * group photo, and saying goodbye on the way out.
 *
 * A task is a list of steps for its owner. Its party either follows the owner in single file
 * (a tour, a couple leaving together) or has steps of its own (the group photo). Everyone in a
 * task does the action 'task' (ref: the task id, note: the step), so the rest of the sim treats
 * them as busy. A task yields to a beat that must happen (the toast, dinner): the sim ends the
 * owner's action and the task gives up where it is.
 */
import type { MansionBlueprint, RoomType } from "../mansion/core/types";
import type { Rng } from "../mansion/core/rng";
import type { Memory, Verb } from "./memory";
import type { Pathfinder } from "./path";
import { yawTo, type Places, type RoomCells } from "./places";
import type { Register } from "./register";
import type { SoundKind } from "./senses";
import type { ActionState, DrinkId, Gesture, Needs, PartyEvent, Person, Pose, Spot } from "./types";
import type { Door, World } from "./world";

export type TaskKind = "tour" | "errand" | "search" | "photo" | "candid" | "leave" | "check" | "chore";
export const TASK_KINDS: readonly TaskKind[] = ["tour", "errand", "search", "photo", "candid", "leave", "check", "chore"];

/** What an errand fetches: the good whisky to the bar, a coat to its owner, clean glasses for the bar, a drink for someone. */
export type ErrandKind = "whisky" | "coat" | "glasses" | "drink";

export type Step =
  | { do: "goto"; to: Spot; label: string }
  /** Walk up to someone (who may be moving) and stand beside them. */
  | { do: "meet"; who: number; label: string }
  | { do: "say"; who: number; s: number; pose: Pose; label: string }
  /** Turn a key in a door into `room`; a lock waits for the party to come out first. */
  | { do: "unlock" | "lock"; door: number; room: number; label: string }
  | { do: "pick"; item: number; label: string }
  | { do: "give"; item: number; who: number; label: string }
  | { do: "wait"; s: number; pose: Pose; label: string };

export interface Task {
  id: number;
  kind: TaskKind;
  owner: number;
  /** Who follows the owner (a tour, a partner on the way out) or takes part (the photo). */
  party: number[];
  steps: Step[];
  i: number;
  startedAt: number;
  /** When the current timed step began (-1 while walking). */
  stepAt: number;
  /** How it ended: 'done', 'gave-up' or 'found', or null while running. */
  outcome: string | null;
  /** The thing an errand fetches or a check looks for (-1 none). */
  item: number;
  errand?: ErrandKind;
  /** Who asked for an errand, or whom a search looks for. */
  other: number;
  /** A search has them in sight. */
  found: boolean;
  /** Doors a tour unlocked, to lock again on the way out. */
  unlocked: number[];
  /** The group photo's spots, by participant. */
  slots?: Map<number, Spot>;
  /** When each follower last re-aimed at the one ahead. */
  aimed: Map<number, number>;
  /** The owner's walking speed before a search hurried them. */
  speed: number;
}

export interface TaskHost {
  readonly t: number;
  readonly bp: MansionBlueprint;
  readonly people: Person[];
  readonly pf: Pathfinder;
  readonly cells: RoomCells;
  readonly places: Places;
  readonly world: World;
  readonly memory: Memory;
  readonly register: Register;
  readonly host: Person;
  start(p: Person, a: { id: "task"; target: Spot | null; duration: number; pose: Pose; gain: Partial<Needs>; ref: number; note: string }): void;
  end(p: Person, done: boolean): void;
  goTo(p: Person, s: Spot): boolean;
  /** A spot beside someone; with `free`, a side nobody else (but `free` themselves) stands on. */
  beside(q: Person, from: { x: number; z: number }, gap?: number, free?: Person): Spot | null;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
  gesture(p: Person, g: Gesture, secs: number): void;
  glance(p: Person, x: number, z: number, secs: number): void;
  notable(p: Person, verb: Verb, obj: number, secs: number, room?: number): void;
  sound(kind: SoundKind, at: { level: number; x: number; z: number; room: number }, source: number, ref?: number): void;
  /** Hand someone a fresh drink (the errand's end). */
  pour(p: Person, d: DrinkId): void;
  /** A glass to carry to someone else, and the hand-over of it. */
  carry(p: Person, d: DrinkId): void;
  handGlass(p: Person, q: Person): void;
  /** Someone near and known to ask (the way, or where someone is). */
  answerer(p: Person): Person | null;
  /** A camera flash (for the renderer's light pulse). */
  flash(p: Person): void;
  /** Out of the front door for good. */
  depart(p: Person): void;
  /** A step finished that the party acts on (looking in the cabinet). */
  stepDone(t: Task, p: Person, st: Step): void;
}

/** A follower re-aims at the one ahead when this far behind (m). */
const FOLLOW_GAP = 1.5;
/** A search hurries after this long (in-game s), and gives up after GIVE_UP. */
const HURRY = 180;
const GIVE_UP = 480;
/** Close enough to hand something over or say a word (m). */
const NEAR = 1.6;
/** A lock waits this long (in-game s) for the party to come out before it's left undone. */
const LOCK_WAIT = 20;
/** Rooms worth showing on a tour. */
const SHOW: ReadonlySet<RoomType> = new Set([
  "library",
  "gallery",
  "conservatory",
  "music-room",
  "study",
  "sitting-room",
  "bedroom",
  "cinema",
  "spa",
  "gym",
  "theatre",
  "morning-room",
  "billiard-room",
  "card-room",
  "hall-gallery",
  "roof-terrace",
  "disco",
]);

/** How long a timed step takes (in-game s). */
const stepLength = (st: Step): number => {
  switch (st.do) {
    case "unlock":
    case "lock":
      return 3;
    case "pick":
    case "give":
      return 2;
    case "say":
    case "wait":
      return st.s;
    default:
      return 0;
  }
};

export class Tasks {
  readonly list: Task[] = [];
  readonly stats = { tours: 0, errands: 0, searches: 0, found: 0, photos: 0, candids: 0, leaves: 0, checks: 0, stalled: 0, fumbles: 0, wrongRooms: 0 };

  constructor(
    private readonly host: TaskHost,
    private readonly rng: Rng,
  ) {}

  /** A running task by id (ids are 1-based positions in the list). */
  get(id: number): Task | undefined {
    const t = this.list[id - 1];
    return t && t.outcome === null ? t : undefined;
  }

  /** The running task someone is part of, if any. */
  of(p: Person): Task | undefined {
    const a = p.action;
    return a?.id === "task" && a.ref !== undefined ? this.get(a.ref) : undefined;
  }

  running(kind: TaskKind): Task[] {
    return this.list.filter((t) => t.kind === kind && t.outcome === null);
  }

  count(kind: TaskKind): number {
    return this.list.filter((t) => t.kind === kind).length;
  }

  private make(kind: TaskKind, owner: Person, party: Person[], steps: Step[], extra: Partial<Task> = {}): Task {
    const h = this.host;
    const t: Task = {
      id: this.list.length + 1,
      kind,
      owner: owner.id,
      party: party.map((q) => q.id),
      steps,
      i: 0,
      startedAt: h.t,
      stepAt: -1,
      outcome: null,
      item: -1,
      other: -1,
      found: false,
      unlocked: [],
      aimed: new Map(),
      speed: owner.speed,
      ...extra,
    };
    this.list.push(t);
    for (const q of [owner, ...party]) {
      h.end(q, false);
      h.start(q, { id: "task", target: null, duration: 99999, pose: "stand", gain: {}, ref: t.id, note: q === owner ? (steps[0]?.label ?? kind) : "follow" });
    }
    h.log("task", [owner.id, ...t.party], owner.room, kind);
    this.begin(t);
    return t;
  }

  // ------------------------------------------------------------------- tours

  /**
   * The host shows up to three guests round the house: three to six rooms they don't know,
   * unlocking with the ring on the way in and locking behind on the way out, a pause in each.
   */
  tour(guide: Person, guests: Person[]): Task | null {
    const h = this.host;
    const { world, bp } = h;
    const known = (r: number) => Math.max(...guests.map((g) => h.memory.familiarity(g.id, r)));
    const bolted = (r: number) => world.doors.some((d) => d.rooms.includes(r) && d.locked && d.lock === "inside");
    const rooms = bp.rooms
      .map((r) => r.index)
      .filter((r) => SHOW.has(bp.rooms[r]!.type) && h.cells.count(r) > 8 && known(r) < 0.6 && !bolted(r) && (guide.room < 0 || world.reachable(guide.room, r, guide)));
    if (rooms.length < 3) return null;
    // Nearest first, then onward from each: a walk, not a zigzag.
    const centre = (r: number) => {
      const b = bp.rooms[r]!;
      return { level: b.level, x: (b.inner.x0 + b.inner.x1) / 2, z: (b.inner.z0 + b.inner.z1) / 2 };
    };
    const pick: number[] = [];
    let at = { level: guide.level, x: guide.x, z: guide.z };
    const want = this.rng.int(3, Math.min(6, rooms.length));
    const left = [...rooms];
    while (pick.length < want && left.length) {
      let best = left[0]!;
      let bd = Infinity;
      for (const r of left) {
        const c = centre(r);
        const d = Math.hypot(c.x - at.x, c.z - at.z) + 12 * Math.abs(c.level - at.level) + this.rng.range(0, 6);
        if (d < bd) {
          bd = d;
          best = r;
        }
      }
      left.splice(left.indexOf(best), 1);
      pick.push(best);
      at = centre(best);
    }
    const steps: Step[] = [];
    for (const r of pick) {
      const s = h.cells.random(r, this.rng, 0.9);
      if (!s) continue;
      // A key-locked door into it: unlock on the way in, lock on the way out.
      const door = world.doors.find((d) => d.rooms.includes(r) && d.locked && d.lock === "key");
      const outside = door ? this.outside(door, r) : null;
      if (door && outside) steps.push({ do: "goto", to: outside, label: "to-door" }, { do: "unlock", door: door.id, room: r, label: "unlock" });
      steps.push({ do: "goto", to: s, label: "to-room" }, { do: "wait", s: this.rng.range(30, 60), pose: "talk", label: "show" });
      if (door && outside) steps.push({ do: "goto", to: outside, label: "out" }, { do: "lock", door: door.id, room: r, label: "lock" });
    }
    if (!steps.length) return null;
    this.stats.tours++;
    return this.make("tour", guide, guests, steps);
  }

  /** A spot just outside a door, on the side away from the room. */
  private outside(d: Door, room: number): Spot | null {
    const h = this.host;
    const other = h.world.otherSide(d, room);
    for (const k of [0.9, 1.3, 0.6]) {
      for (const sgn of [1, -1]) {
        const x = d.axis === "z" ? d.x + sgn * k : d.x;
        const z = d.axis === "x" ? d.z + sgn * k : d.z;
        const w = h.pf.snap(d.level, x, z, 0.3);
        if (w && h.pf.roomAt(d.level, w.x, w.z) === other) return { level: d.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, d.x, d.z), room: other };
      }
    }
    return null;
  }

  // ----------------------------------------------------------------- errands

  /**
   * Fetch something: walk to whoever asked and agree, go to where it is (now and then trying the
   * wrong room first), pick it up, carry it in view and hand it over.
   */
  errand(kind: ErrandKind, carrier: Person, asker: Person, item: number, from: Spot | null, to: Person): Task | null {
    const h = this.host;
    if (!from) return null;
    const steps: Step[] = [];
    if (asker !== carrier) steps.push({ do: "meet", who: asker.id, label: "asked" }, { do: "say", who: asker.id, s: 3, pose: "talk", label: "agree" });
    // The wrong room first: a look round, then the right one.
    if (from.room >= 0 && this.rng.chance((1 - carrier.fluency.errand) * 0.5)) {
      const near = (h.world.graph[from.room] ?? []).filter((e) => e.to >= 0 && e.kind !== "stair" && e.to !== carrier.room).map((e) => e.to);
      const wrong = near.length ? h.cells.random(this.rng.pick(near), this.rng, 0.8) : null;
      if (wrong) {
        steps.push({ do: "goto", to: wrong, label: "wrong-room" }, { do: "wait", s: 4, pose: "look", label: "look-round" });
        this.stats.wrongRooms++;
      }
    }
    steps.push({ do: "goto", to: from, label: "fetch" });
    if (item >= 0) steps.push({ do: "pick", item, label: "pick" });
    else steps.push({ do: "wait", s: kind === "drink" ? 12 : 8, pose: "serve", label: "pick" });
    steps.push({ do: "meet", who: to.id, label: "bring" }, { do: "give", item, who: to.id, label: "give" });
    this.stats.errands++;
    return this.make("errand", carrier, [], steps, { item, errand: kind, other: asker.id });
  }

  /** Go and look for something (the household at the spirits cabinet); the party acts on what's there when the look ends. */
  check(p: Person, at: Spot, item: number): Task {
    this.stats.checks++;
    return this.make(
      "check",
      p,
      [],
      [
        { do: "goto", to: at, label: "to-cabinet" },
        { do: "wait", s: 5, pose: "look", label: "look-in" },
      ],
      { item },
    );
  }

  /** A short job of the staff's own (the butler looking over the table, then a word with the host). */
  chore(p: Person, steps: Step[]): Task {
    return this.make("chore", p, [], steps);
  }

  // ---------------------------------------------------------------- searches

  /** Looking for a partner not seen for a while: where they were last seen, then asking round. */
  search(p: Person, q: Person): Task | null {
    const h = this.host;
    const room = h.memory.lastRoom[p.id * h.people.length + q.id]!;
    const s = room !== -1 ? h.cells.random(room, this.rng, 0.8) : null;
    if (!s) return null;
    this.stats.searches++;
    return this.make(
      "search",
      p,
      [],
      [
        { do: "goto", to: s, label: "last-seen" },
        { do: "wait", s: 4, pose: "look", label: "look-round" },
      ],
      { other: q.id },
    );
  }

  // ------------------------------------------------------------------ photos

  /** A candid round: a spot at the edge of the busiest room, the camera up, a flash. */
  candid(ph: Person, at: Spot): Task {
    this.stats.candids++;
    return this.make(
      "candid",
      ph,
      [],
      [
        { do: "goto", to: at, label: "frame" },
        { do: "wait", s: this.rng.range(6, 10), pose: "camera", label: "shoot" },
      ],
    );
  }

  /**
   * The group photo after the toast: everyone lined up by height before the grand stair, the
   * tallest at the back, the host and partner in the middle of the front row; up to two minutes
   * to line up, three flashes, then a few crowd round the camera. `yaw` faces from the stair
   * toward the camera.
   */
  groupPhoto(ph: Person, foot: Spot, yaw: number, who: Person[]): Task | null {
    const h = this.host;
    const host = h.host;
    const front = [host, ...(host.partner !== null ? [h.people[host.partner]!] : [])].filter((q) => who.includes(q));
    const rest = who.filter((q) => !front.includes(q)).sort((a, b) => b.look.height - a.look.height);
    const PER = 8;
    const rows: Person[][] = [];
    for (let i = 0; i < rest.length; i += PER) rows.push(rest.slice(i, i + PER));
    // The shortest row is the front one.
    rows.reverse();
    if (rows.length) rows[0] = [...rows[0]!.slice(0, Math.floor(rows[0]!.length / 2)), ...front, ...rows[0]!.slice(Math.floor(rows[0]!.length / 2))];
    else rows.push(front);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const slots = new Map<number, Spot>();
    const nRows = rows.length;
    rows.forEach((row, ri) => {
      // Row 0 stands nearest the camera; each row behind is 0.7 m further back toward the stair.
      const out = 0.6 + 0.7 * (nRows - 1 - ri);
      row.forEach((q, k) => {
        const side = (k - (row.length - 1) / 2) * 0.55 + (ri % 2 ? 0.27 : 0);
        const s = h.pf.snap(foot.level, foot.x + fx * out + fz * side, foot.z + fz * out - fx * side, 0.5);
        if (!s) return;
        const room = h.pf.roomAt(foot.level, s.x, s.z);
        if (room !== -1) slots.set(q.id, { level: foot.level, x: s.x, z: s.z, yaw, room });
      });
    });
    const back = 0.6 + 0.7 * nRows + 4.5;
    const cs = h.pf.snap(foot.level, foot.x + fx * back, foot.z + fz * back, 1.5);
    if (!cs || slots.size < 4) return null;
    const cam: Spot = { level: foot.level, x: cs.x, z: cs.z, yaw: yawTo(cs.x, cs.z, foot.x, foot.z), room: h.pf.roomAt(foot.level, cs.x, cs.z) };
    this.stats.photos++;
    const party = who.filter((q) => slots.has(q.id));
    h.log("beat", [host.id], foot.room, "photo-call");
    h.sound("call", host, host.id);
    return this.make(
      "photo",
      ph,
      party,
      [
        { do: "goto", to: cam, label: "set-up" },
        { do: "wait", s: 120, pose: "camera", label: "line-up" },
        { do: "wait", s: 6, pose: "camera", label: "flashes" },
        { do: "wait", s: 30, pose: "stand", label: "show" },
      ],
      { slots },
    );
  }

  // ------------------------------------------------------------------ leaving

  /**
   * Going home: find the host and say goodbye, then the cloakroom (the attendant hands the coat
   * over), then out of the front door. A partner comes along. In a hurry, straight to the coats.
   */
  leave(p: Person, partner: Person | null, attendant: Person | null, hurry: boolean): Task {
    const h = this.host;
    const host = h.host;
    const steps: Step[] = [];
    if (!hurry && host.present && !host.gone && host !== p)
      steps.push({ do: "meet", who: host.id, label: "to-host" }, { do: "say", who: host.id, s: this.rng.range(4, 6), pose: "shake", label: "goodbye" });
    const coat = h.places.chains.coats.spots[0];
    const hung = [p, ...(partner ? [partner] : [])].some((q) => q.coat >= 0 && h.world.items.stateOf(q.coat) === "hung");
    if (coat && hung) {
      if (attendant?.present && !hurry) steps.push({ do: "meet", who: attendant.id, label: "cloakroom" }, { do: "say", who: attendant.id, s: this.rng.range(8, 14), pose: "wait", label: "coat" });
      else steps.push({ do: "goto", to: coat, label: "cloakroom" }, { do: "wait", s: 6, pose: "serve", label: "coat" });
    }
    steps.push({ do: "goto", to: h.places.entrance, label: "out" });
    this.stats.leaves++;
    return this.make("leave", p, partner ? [partner] : [], steps);
  }

  // -------------------------------------------------------------------- steps

  private begin(t: Task): void {
    const h = this.host;
    const p = h.people[t.owner]!;
    const st = t.steps[t.i];
    if (!st) return this.finish(t, "done");
    const a = p.action;
    if (!a || a.id !== "task" || a.ref !== t.id) return this.finish(t, "gave-up");
    a.note = st.label;
    t.stepAt = -1;
    if (st.do === "goto") {
      if (!h.goTo(p, st.to)) return this.finish(t, "gave-up");
    } else if (st.do === "meet") {
      const q = h.people[st.who]!;
      const s = q.present && !q.gone ? this.toMeet(q, p) : null;
      if (!s || !h.goTo(p, s)) return this.finish(t, "gave-up");
    } else {
      a.target = null;
      a.startedAt = h.t;
      p.path = [];
      p.pathIndex = 0;
      t.stepAt = h.t;
      this.enter(t, p, st);
    }
  }

  /** A timed step starts: a key, picking up, a word, a wait. */
  private enter(t: Task, p: Person, st: Step): void {
    const h = this.host;
    const items = h.world.items;
    if (st.do === "unlock" || st.do === "lock") {
      const d = h.world.doors[st.door]!;
      p.yaw = yawTo(p.x, p.z, d.x, d.z);
      // The wrong key first, now and then.
      if (this.rng.chance(1 - p.fluency.keys)) {
        this.stats.fumbles++;
        t.stepAt += 5;
        h.notable(p, "fumbled", -1, 8);
      }
    } else if (st.do === "pick") {
      items.holder[st.item] = p.id;
      items.set(st.item, "carried", h.t);
      items.place(st.item, p);
      const kind = items.kindOf(st.item);
      if (kind === "bottle" || kind === "coat" || kind === "bag") {
        p.held = kind;
        p.heldUntil = h.t + 99999;
      }
      h.notable(p, "carrying", st.item, 30);
    } else if (st.do === "say") {
      const q = h.people[st.who]!;
      p.yaw = yawTo(p.x, p.z, q.x, q.z);
      h.glance(q, p.x, p.z, st.s);
      if (t.kind === "leave" && q === h.host) {
        h.log("goodbye", [p.id, ...t.party, q.id], p.room);
        h.gesture(q, "wave", 2);
      }
      if (st.label === "agree") h.gesture(q, "point", 2);
    } else if (st.do === "give") {
      const q = h.people[st.who]!;
      p.yaw = yawTo(p.x, p.z, q.x, q.z);
      h.glance(q, p.x, p.z, 2);
    }
  }

  /** One sim step for someone in a task. True when they should walk this step. */
  step(p: Person, a: ActionState): boolean {
    const h = this.host;
    const t = this.get(a.ref ?? -1);
    if (!t) {
      h.end(p, false);
      return false;
    }
    if (p.id !== t.owner) return this.member(t, p, a);
    if (t.kind === "search" && !t.found) {
      if (h.t - t.startedAt > GIVE_UP) {
        this.finish(t, "gave-up");
        return false;
      }
      // A search keeps an eye out the whole way.
      if (this.spotted(t, p)) return p.action === a && a.startedAt === null;
    }
    const st = t.steps[t.i]!;
    if (st.do === "meet") {
      const q = h.people[st.who]!;
      if (!q.present || q.gone) {
        this.finish(t, "gave-up");
        return false;
      }
      if (q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < NEAR) {
        this.advance(t);
        return false;
      }
      const tgt = a.target;
      if (!p.path[p.pathIndex]?.climb && (!tgt || Math.hypot(q.x - tgt.x, q.z - tgt.z) > 1.5 || q.level !== tgt.level || p.pathIndex >= p.path.length)) {
        const s = this.toMeet(q, p);
        if (!s || !h.goTo(p, s)) {
          this.finish(t, "gave-up");
          return false;
        }
      }
      return true;
    }
    if (st.do === "goto") return a.startedAt === null;
    // Timed steps. A lock waits at the door while anyone in the party is still inside.
    if (st.do === "lock" && h.t - t.stepAt < LOCK_WAIT && this.inside(t, st.room)) return false;
    if (st.do === "wait" && (t.kind === "photo" || t.kind === "candid")) this.shoot(t, p, st);
    if (h.t - t.stepAt >= stepLength(st)) {
      this.complete(t, p, st);
      this.advance(t);
    }
    return false;
  }

  /** Where to go to meet someone: beside them, or where they'll step off the stair they're on. */
  private toMeet(q: Person, p: Person): Spot | null {
    const h = this.host;
    // A free side of them: others may be waiting their turn (to say goodbye, for a coat).
    const s = h.beside(q, p, 1.0, p);
    if (s) return s;
    const wp = q.path[q.pathIndex];
    const off = wp?.climb ? wp : q;
    const w = h.pf.snap(off.level, off.x, off.z, 3);
    const room = w ? h.pf.roomAt(w.level, w.x, w.z) : -1;
    return w && room !== -1 ? { level: w.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, q.x, q.z), room } : null;
  }

  /** Whether anyone in the party is still in a room. */
  private inside(t: Task, room: number): boolean {
    return t.party.some((m) => this.host.people[m]!.room === room);
  }

  /** Called when someone in a task reaches the end of a walk. */
  arrived(p: Person): void {
    const t = this.of(p);
    if (!t || p.id !== t.owner) return;
    if (t.steps[t.i]?.do === "goto") this.advance(t);
  }

  private advance(t: Task): void {
    if (t.outcome !== null) return;
    t.i++;
    if (t.i >= t.steps.length) return this.finish(t, t.kind === "search" ? (t.found ? "found" : "gave-up") : "done");
    this.begin(t);
  }

  /** What a step leaves behind when it completes. */
  private complete(t: Task, p: Person, st: Step): void {
    const h = this.host;
    const items = h.world.items;
    if (st.do === "unlock") {
      h.world.setLocked(h.world.doors[st.door]!, false, p.id);
      t.unlocked.push(st.door);
    } else if (st.do === "lock") {
      // Left undone when someone is still in there.
      if (!this.inside(t, st.room)) h.world.setLocked(h.world.doors[st.door]!, true, p.id);
      t.unlocked = t.unlocked.filter((x) => x !== st.door);
    } else if (st.do === "give") {
      this.handOver(t, p, h.people[st.who]!, st.item);
    } else if (st.do === "wait" && st.label === "pick") {
      // A rack of clean glasses, or the drink they went for (on the waiter's tray, or a glass in hand).
      const q = h.people[t.other]!;
      if (t.errand === "drink" && p.held !== "tray") h.carry(p, q.fav !== q.never ? q.fav : "water");
      else if (!p.held) {
        p.held = "tray";
        p.heldUntil = h.t + 600;
      }
    } else if (st.do === "wait" && t.kind === "search" && st.label === "look-round") {
      this.ask(t, p);
    } else if (st.label === "coat" && t.kind === "leave") {
      for (const m of [t.owner, ...t.party]) {
        const q = h.people[m]!;
        if (q.coat < 0 || items.stateOf(q.coat) !== "hung") continue;
        items.holder[q.coat] = q.id;
        items.set(q.coat, "worn", h.t);
      }
    }
    h.stepDone(t, p, st);
  }

  /** The hand-over at the end of an errand. */
  private handOver(t: Task, p: Person, q: Person, item: number): void {
    const h = this.host;
    const items = h.world.items;
    if (item >= 0) {
      if (items.kindOf(item) === "coat") {
        items.holder[item] = q.id;
        items.set(item, "worn", h.t);
      } else {
        // The bottle stands at the bar from now on.
        items.holder[item] = -1;
        items.set(item, "down", h.t);
        items.place(item, q);
      }
      if (p.held === "bottle" || p.held === "coat" || p.held === "bag") p.held = null;
      // "I fetched it for them": a claim that explains anyone seen taking it, to whoever is by, and
      // to whoever asked for it (and the household with them: they know where the whisky goes).
      const src = t.steps.find((s) => s.do === "goto" && s.label === "fetch");
      if (src?.do === "goto") {
        const asker = t.other >= 0 ? h.people[t.other] : undefined;
        for (const o of h.people) {
          const by = o.present && o.level === p.level && Math.hypot(o.x - p.x, o.z - p.z) < 4;
          const knew = !!asker && (o === asker || (o.id === asker.partner && h.memory.household[o.id] === 1));
          if (o !== p && (by || knew)) h.register.claim(o.id, p.id, src.to.room, t.startedAt, h.t, item);
        }
      }
    } else if (t.errand === "drink") {
      if (p.held && p.held !== "tray") h.handGlass(p, q);
      else h.pour(q, q.fav !== q.never ? q.fav : "water");
    } else if (p.held === "tray" && p.role !== "waiter") p.held = null;
  }

  /** The partner's in sight: go over and say hello, and the search is over. */
  private spotted(t: Task, p: Person): boolean {
    const h = this.host;
    const q = h.people[t.other]!;
    if (!q.present || q.gone) {
      this.finish(t, "gave-up");
      return true;
    }
    const seen = h.memory.lastT[p.id * h.people.length + q.id]! > t.startedAt && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 10;
    if (!seen) {
      // In a hurry after a while.
      if (h.t - t.startedAt > HURRY && p.speed === t.speed) p.speed = t.speed * 1.3;
      return false;
    }
    t.found = true;
    t.steps.splice(t.i + 1, t.steps.length, { do: "meet", who: q.id, label: "found" }, { do: "say", who: q.id, s: 3, pose: "kiss", label: "hello" });
    h.gesture(p, "wave", 2);
    this.advance(t);
    return true;
  }

  /** Not where they were last seen: ask someone near who knows them, and go where they say; else try a party room. */
  private ask(t: Task, p: Person): void {
    const h = this.host;
    const n = h.people.length;
    const q = h.people[t.other]!;
    const a = h.answerer(p);
    let room = -1;
    if (a && h.memory.lastT[a.id * n + q.id]! > h.memory.lastT[p.id * n + q.id]!) {
      room = h.memory.lastRoom[a.id * n + q.id]!;
      h.gesture(a, "point", 2);
      h.gesture(p, "ask", 2);
      h.glance(a, p.x, p.z, 2);
    }
    const pointed = room !== -1;
    if (!pointed) room = this.rng.pick(h.places.mingleRooms.length ? h.places.mingleRooms : [h.places.toastRoom.index]);
    const s = h.cells.random(room, this.rng, 0.8);
    if (s && h.t - t.startedAt < GIVE_UP) t.steps.push({ do: "goto", to: s, label: pointed ? "pointed" : "try" }, { do: "wait", s: 4, pose: "look", label: "look-round" });
  }

  /** The camera's flashes: one for a candid, three for the group photo; stragglers beckoned over. */
  private shoot(t: Task, p: Person, st: Step & { do: "wait" }): void {
    const h = this.host;
    const el = h.t - t.stepAt;
    const flashAt = t.kind === "candid" ? [st.s - 1] : st.label === "flashes" ? [0, 2, 4] : [];
    for (const f of flashAt) {
      if (el < f || el - 0.5 >= f) continue;
      h.flash(p);
      h.sound("shutter", p, p.id);
      const subjects = t.kind === "photo" ? t.party : h.people.filter((o) => o !== p && o.present && o.level === p.level && o.room === p.room && Math.hypot(o.x - p.x, o.z - p.z) < 8).map((o) => o.id);
      h.log("photo", [p.id, ...subjects], p.room, t.kind === "photo" ? "group" : "candid");
    }
    if (t.kind === "photo" && st.label === "line-up") {
      const lined = t.party.filter((m) => h.people[m]!.action?.startedAt != null).length;
      if (el > 60 && el % 10 < 0.5) h.gesture(p, "beckon", 2);
      // Everyone's in place: no need to wait out the two minutes.
      if (lined >= t.party.length * 0.9 && el > 30) t.stepAt = h.t - st.s;
    }
  }

  /** Someone in the owner's party: follow in single file, or (the photo) take their place in line. */
  private member(t: Task, p: Person, a: ActionState): boolean {
    const h = this.host;
    if (t.kind === "photo") {
      const s = t.slots?.get(p.id);
      if (!s || t.steps[t.i]!.label === "show") return false;
      if (a.target !== s) {
        h.goTo(p, s);
        a.note = "line";
      }
      return a.startedAt === null;
    }
    const k = t.party.indexOf(p.id);
    const ahead = h.people[k <= 0 ? t.owner : t.party[k - 1]!]!;
    const d = Math.hypot(ahead.x - p.x, ahead.z - p.z) + 4 * Math.abs(ahead.level - p.level);
    const last = t.aimed.get(p.id) ?? -1e9;
    // Re-aim when they've stopped short, or the one ahead has moved well on from where they were heading.
    const tgt = a.target;
    const stale = a.startedAt !== null || !tgt || tgt.level !== ahead.level || Math.hypot(ahead.x - tgt.x, ahead.z - tgt.z) > FOLLOW_GAP + 1.5;
    if (d > FOLLOW_GAP + 0.6 && stale && h.t - last > 2 && !p.path[p.pathIndex]?.climb) {
      const s = h.beside(ahead, p, FOLLOW_GAP);
      if (s && h.goTo(p, s)) t.aimed.set(p.id, h.t);
    }
    if (a.startedAt !== null) {
      // Standing: face whoever leads.
      const lead = h.people[t.owner]!;
      if (Math.hypot(lead.x - p.x, lead.z - p.z) > 0.3) p.yaw = yawTo(p.x, p.z, lead.x, lead.z);
      return false;
    }
    return true;
  }

  /** What someone in a task looks like doing, when not walking. */
  poseOf(p: Person): Pose {
    const t = this.of(p);
    if (!t) return "stand";
    if (p.id !== t.owner) return t.kind === "photo" ? "line" : t.kind === "tour" ? "look" : "stand";
    const st = t.steps[t.i];
    if (!st) return "stand";
    if (st.do === "say" || st.do === "wait") return st.pose;
    if (st.do === "unlock" || st.do === "lock" || st.do === "pick" || st.do === "give") return "serve";
    return p.held === "bottle" || p.held === "coat" ? "carry" : "stand";
  }

  /** Someone's task action ended from outside (the programme, a nosy look): the owner's whole task gives up; a follower drops out. */
  drop(p: Person, ref: number): void {
    const t = this.get(ref);
    if (!t) return;
    if (p.id === t.owner) return this.finish(t, "gave-up");
    t.party = t.party.filter((m) => m !== p.id);
    t.slots?.delete(p.id);
  }

  /** End a task: everyone in it is free again, and doors it opened are locked behind when nobody's inside. */
  finish(t: Task, outcome: string): void {
    if (t.outcome !== null) return;
    const h = this.host;
    t.outcome = outcome;
    for (const id of t.unlocked) {
      const d = h.world.doors[id]!;
      if (!d.rooms.some((r) => h.people.some((q) => q.present && q.room === r && q.ring !== "host"))) h.world.setLocked(d, true, t.owner);
    }
    t.unlocked = [];
    const owner = h.people[t.owner]!;
    owner.speed = t.speed;
    if (t.item >= 0 && outcome !== "done" && h.world.items.holder[t.item] === owner.id) {
      // Set down nearby: the errand stalled.
      const items = h.world.items;
      items.holder[t.item] = -1;
      items.set(t.item, "down", h.t);
      items.place(t.item, owner);
      if (owner.held === "bottle" || owner.held === "coat" || owner.held === "bag") owner.held = null;
      this.stats.stalled++;
    }
    if (outcome === "found") this.stats.found++;
    h.log("task", [t.owner, ...t.party], owner.room, `${t.kind}:${outcome}`);
    for (const m of [t.owner, ...t.party]) {
      const q = h.people[m]!;
      if (q.action?.id !== "task" || q.action.ref !== t.id) continue;
      if (t.kind === "leave" && outcome === "done") h.depart(q);
      else h.end(q, outcome === "done" || outcome === "found");
    }
  }

  /** The deadline: whoever is still leaving goes straight out. */
  hurryOut(): void {
    for (const t of this.running("leave")) {
      const out = t.steps.length - 1;
      if (t.i >= out) continue;
      t.i = out - 1;
      this.advance(t);
    }
  }
}
