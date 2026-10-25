/**
 * What the crowd finds of the spy's work (milestone 3 technical plan: The crowd). Nothing new runs
 * the crowd's suspicion: each find opens a case with nobody to blame yet, and milestone 2's
 * memory, gossip and register do the rest.
 *
 * - The statuette is missed by someone who saw it on its stand tonight, or who knew it from
 *   before (the household, the butler, a regular), once a look takes in the empty spot: a gasp, and
 *   those free close by come over to look. A `gone` case from their last sight of it.
 * - What a bag, a coat or a pocket held is missed by its owner when they next open the bag or
 *   reach for the phone: once or twice in the evening, on taking back a bag left on a chair, and
 *   going home. A `gone` case where and when they think it went: the chair the bag lay on, while it
 *   lay there; the cloakroom, since they last had the coat; the crowd they last stood in.
 * - The safe's papers: the host looks into the study in one evening in five, after 21:00, crouched
 *   at the safe for ten seconds.
 * - A bug: whoever sits on that sofa (one sitting in twenty), a waiter clearing glasses at that
 *   table (one clearing in ten). A `planted` case over the last two hours.
 * - The ledger copied leaves no gap, and nobody searches the host's jacket.
 *
 * Guests set their bags down on a chair or a table and take them back every evening (bags.ts);
 * the finds hear of the target's. Every draw comes from its own fork.
 */
import type { Rng } from "../../mansion/core/rng";
import type { Prop } from "../../mansion/core/types";
import { standBy, type Bags, type BagsListener } from "../bags";
import type { Memory } from "../memory";
import { facing, frontOf, yawTo } from "../places";
import { CASES, type Register } from "../register";
import { DETAIL_RANGE, DETAIL_FOV } from "../senses";
import type { Step, Task } from "../tasks";
import type { Gesture, PartyEvent, Person, Seat, Spot } from "../types";
import type { TheftFrom } from "./cast";
import type { Spy } from "./index";
import { held, type PrivacyHost, type Spot3 } from "./privacy";
import { FIRST_STEP } from "./steps";

/** What the finds need from the party. */
export interface FindsHost extends PrivacyHost {
  readonly memory: Memory;
  readonly register: Register;
  readonly host: Person;
  readonly dramas: { busy(p: Person): boolean };
  readonly bags: Bags;
  /** Whether a guest could be drawn into something now (outside the rituals, not busy). */
  free(p: Person): boolean;
  gesture(p: Person, g: Gesture, secs: number): void;
  glance(p: Person, x: number, z: number, secs: number): void;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
  /** w finds something of owner's gone (or a bug planted) in a room, over a window: a case with nobody to blame yet. */
  openCase(kind: "gone" | "planted", w: Person, owner: Person, obj: number, room: number, from: number, to?: number): void;
}

/** Taking a bag back, a glance inside: one in two. */
const BAG_LOOK = 0.5;
/** Opening the bag or reaching for the phone: once or twice in the evening, between 19:20 and the farewell. */
const CHECKS: readonly [number, number] = [1, 2];
/** Busy when a check comes round (dancing, at the toast, in the middle of something): again this much later (in-game s). */
const RETRY = 60;
/** A trip to the coat for what's in its pocket: one owner in two, once, after 19:30; a few seconds at the hook. */
const COAT_TRIP = 0.5;
const COAT_FROM = 30 * 60;
const AT_COAT: readonly [number, number] = [4, 6];
/** Missing the statuette: the chance that a look taking in the empty spot notices, at its keenest and closest; twice that for those who know the house. */
const MISS = 0.03;
const KNOW_HOUSE = 2;
/** Those free within this (m) of whoever gasps come to look, at most this many besides them, for this long (in-game s). */
const LOOK_NEAR = 4;
const LOOKERS = 3;
const LOOK_FOR: readonly [number, number] = [20, 40];
/** The host's look into the study: one evening in five, from 21:00 to the farewell, crouched at the safe this long (in-game s). */
const STUDY = 0.2;
const STUDY_FROM = 2 * 3600;
const SAFE_LOOK = 10;
/** A bug in a sofa found by one sitting in twenty; under the table by one clearing in ten: a waiter's stop within this of its edge that clears a glass (m). */
const SOFA = 1 / 20;
const TABLE = 1 / 10;
const AT_TABLE = 1;
/** What holds someone too busy to open a bag or reach for a phone just now, or to be drawn away. */
const BUSY: ReadonlySet<string> = new Set(["toast", "dinner", "champagne", "task", "toilet", "leave", "row", "ask", "arrive", "greet", "staff", "dance"]);

/** Where a thing might have gone since its owner last had it: the chair a bag lay on, a crowd a pocket stood in. */
interface Where {
  room: number;
  from: number;
  to: number;
}

export class Finds implements BagsListener {
  readonly stats = { checks: 0, gone: 0, missed: 0, lookers: 0, study: 0, bugs: 0 };
  /** What the spy is after in someone's things: whose, and where it is kept (null: nothing of anyone's). */
  private readonly mark: { owner: number; from: TheftFrom } | null;
  /** When its owner last had it, and where it could have gone since; whether it has been missed. */
  private lastHad = 0;
  private readonly since: Where[] = [];
  private lost = false;
  /** The owner's drawn checks still to come, and their trip to the coat (-1 none). */
  private readonly checks: number[] = [];
  private coatTrip = -1;
  /** The statuette: when each person last saw it on its stand (-1 never; 0 for those who knew it from before), and who has missed it. */
  readonly knewAt: Float32Array;
  private readonly missed: Uint8Array;
  /** When the host looks into the study (-1 not tonight, or done). */
  studyAt = -1;
  private readonly farewell: number;
  private ticks = 0;

  constructor(
    private readonly h: FindsHost,
    private readonly spy: Spy,
    private readonly rng: Rng,
  ) {
    const n = h.people.length;
    const g = spy.goal;
    this.farewell = h.programme.find((ph) => ph.id === "farewell")?.start ?? 9900;
    this.knewAt = new Float32Array(n).fill(-1);
    this.missed = new Uint8Array(n);
    if (spy.things.statuette >= 0) for (const p of h.people) if (h.memory.household[p.id] || p.role === "butler" || p.regular) this.knewAt[p.id] = 0;
    const from: TheftFrom | null = g.kind === "bag" ? "bag" : (g.first?.from ?? null);
    this.mark = from && g.target >= 0 ? { owner: g.target, from } : null;
    if (this.mark?.from === "coat") {
      if (rng.chance(COAT_TRIP)) this.coatTrip = rng.range(COAT_FROM, this.farewell);
    } else if (this.mark) {
      const k = rng.int(CHECKS[0], CHECKS[1]);
      for (let i = 0; i < k; i++) this.checks.push(rng.range(FIRST_STEP, this.farewell));
      this.checks.sort((a, b) => a - b);
    }
    if (g.kind === "safe" && spy.things.safe && spy.id !== h.host.id && rng.chance(STUDY)) this.studyAt = rng.range(STUDY_FROM, this.farewell);
  }

  /** Its line in the party's digest. */
  digest(): string {
    const s = this.stats;
    return `f${s.checks},${s.gone},${s.missed},${s.lookers},${s.study},${s.bugs}`;
  }

  /** Every step: the owner's checks and crowds, and the host's look into the study, every other second. */
  step(): void {
    if (++this.ticks % 4) return;
    const h = this.h;
    const mark = this.mark;
    if (mark && !this.lost) {
      const q = h.people[mark.owner]!;
      if (q.present && !q.gone) {
        if (mark.from === "pocket" && held(h, q)) this.crowd(q);
        if (this.checks.length && this.checks[0]! <= h.t) {
          if (this.mayCheck(q)) {
            this.checks.shift();
            this.check(q, mark.from);
          } else this.checks[0] = h.t + RETRY;
        }
        if (this.coatTrip >= 0 && this.coatTrip <= h.t) this.toCoat(q);
      }
    }
    if (this.studyAt >= 0 && this.studyAt <= h.t) this.toStudy();
  }

  // ---------------------------------------------------------------------- bags

  /** Its target's bag set down on a chair or a table (bags.ts): a place it could go from, from now. */
  down(p: Person, _bag: number, at: Spot): void {
    if (this.mark?.owner === p.id && this.mark.from === "bag") this.where(at.room, this.h.t);
  }

  /** Its target's bag back on the arm: a glance inside one time in two, and always on the way out. */
  back(owner: Person, _bag: number, how: "taken" | "leaving" | "carried"): void {
    const mark = this.mark;
    if (mark?.owner !== owner.id || mark.from !== "bag") return;
    const w = this.since[this.since.length - 1];
    if (w) w.to = this.h.t;
    if (how === "leaving" || (how === "taken" && this.rng.chance(BAG_LOOK))) this.check(owner, "bag");
  }

  /** Setting off home: a hand into the bag already on their arm, or the pocket for the phone. */
  goingHome(party: readonly Person[]): void {
    const mark = this.mark;
    for (const q of party) if (mark && q.id === mark.owner && (mark.from === "pocket" || (mark.from === "bag" && this.h.bags.downOf(q.id) < 0))) this.check(q, mark.from);
  }

  /** A task step done: a hand in a coat's pocket at the hook, the host at the safe. */
  stepDone(t: Task, p: Person, st: Step): void {
    if (st.label === "coat-check" || (t.kind === "leave" && st.label === "coat")) {
      for (const id of [t.owner, ...t.party]) this.check(this.h.people[id]!, "coat");
    } else if (st.label === "safe-check") this.atSafe(p);
  }

  // ----------------------------------------------------------- owners' checks

  private mayCheck(q: Person): boolean {
    const a = q.action;
    if (a && BUSY.has(a.id) && a.id !== "dinner") return false;
    if (a?.id === "games" && a.note === "billiards") return false;
    if (this.mark?.from !== "bag") return true;
    const bag = this.spy.things.bagOf(q);
    return bag >= 0 && this.h.world.items.holder[bag] === q.id;
  }

  /** Where it might have gone: a new chair or crowd, from now. */
  private where(room: number, t: number): void {
    this.since.push({ room, from: t, to: t });
    if (this.since.length > 4) this.since.shift();
  }

  /** In a press of people (dancing, at the toast): the crowd a pocket could have been picked in. */
  private crowd(q: Person): void {
    const w = this.since[this.since.length - 1];
    if (w && w.room === q.room && this.h.t - w.to <= 30) w.to = this.h.t;
    else this.where(q.room, this.h.t);
  }

  /** The owner opens the bag, or reaches into the coat or the pocket for the phone: still there, or gone. */
  private check(p: Person, at: TheftFrom): void {
    const mark = this.mark;
    if (!mark || this.lost || p.id !== mark.owner || mark.from !== at || p.gone) return;
    const h = this.h;
    const items = h.world.items;
    const thing = this.spy.things.firstThing();
    if (thing < 0) return;
    this.stats.checks++;
    const there = at === "bag" ? items.inside[thing] === this.spy.things.bagOf(p) : at === "coat" ? p.coat >= 0 && items.inside[thing] === p.coat : items.holder[thing] === p.id;
    if (there) {
      this.lastHad = h.t;
      this.since.length = 0;
      return;
    }
    this.lost = true;
    this.stats.gone++;
    h.gesture(p, "startle", 1.5);
    h.log("react", [p.id], p.room, `gone:${items.kindOf(thing)}`);
    // Where they think it went: the coat's hook since they last had it; the last chair or crowd or two since (else where they are).
    const had = Math.max(this.lastHad, p.arriveAt);
    const where: Where[] = at === "coat" ? [{ room: p.coat >= 0 ? items.room[p.coat]! : p.room, from: had, to: h.t }] : this.since.slice(-2);
    if (!where.length) where.push({ room: p.room, from: had, to: h.t });
    for (const w of where) h.openCase("gone", p, p, thing, w.room, w.from, w.to);
  }

  /** A trip to the coat for something in its pocket, when they're free to. */
  private toCoat(q: Person): void {
    const h = this.h;
    if (h.t >= this.farewell) {
      this.coatTrip = -1;
      return;
    }
    const s = q.coat >= 0 && h.world.items.stateOf(q.coat) === "hung" ? standBy(h, q.coat) : null;
    if (!s) {
      this.coatTrip = -1;
      return;
    }
    if (!h.free(q)) {
      this.coatTrip = h.t + RETRY;
      return;
    }
    this.coatTrip = -1;
    h.tasks.chore(
      q,
      [
        { do: "goto", to: s, label: "to-coat" },
        { do: "wait", s: this.rng.range(AT_COAT[0], AT_COAT[1]), pose: "serve", label: "coat-check" },
      ],
      q.coat,
      "coat-check",
    );
  }

  // -------------------------------------------------------------- the study

  /** The host looks into the study and crouches at the safe, once, when free to. */
  private toStudy(): void {
    const h = this.h;
    const host = h.host;
    const safe = this.spy.things.safe;
    if (h.t >= this.farewell || !safe || host.gone) {
      this.studyAt = -1;
      return;
    }
    const a = host.action;
    if (!host.present || h.dramas.busy(host) || (a && BUSY.has(a.id))) {
      this.studyAt = h.t + RETRY;
      return;
    }
    const w = h.pf.snap(safe.level, safe.stand.x, safe.stand.z, 1);
    const room = w ? h.pf.roomAt(w.level, w.x, w.z) : -1;
    this.studyAt = -1;
    if (!w || room === -1) return;
    this.stats.study++;
    h.tasks.chore(
      host,
      [
        { do: "goto", to: { level: w.level, x: w.x, z: w.z, yaw: safe.stand.yaw, room }, label: "to-safe" },
        { do: "wait", s: SAFE_LOOK, pose: "crouch", label: "safe-check" },
      ],
      this.spy.things.papers,
      "safe-check",
    );
  }

  /** At the safe: the papers gone, or the safe found open (shut again, the papers still there). */
  private atSafe(p: Person): void {
    const h = this.h;
    const things = this.spy.things;
    const items = h.world.items;
    const papers = things.papers;
    if (papers < 0) return;
    if (items.holder[papers] === -1 && items.stateOf(papers) === "shelved") {
      if (!things.safeOpen) return;
      things.safeOpen = false;
      h.gesture(p, "startle", 1.5);
      h.log("react", [p.id], p.room, "safe-open");
      return;
    }
    h.gesture(p, "startle", 1.5);
    h.log("react", [p.id], p.room, "gone:papers");
    h.openCase("gone", p, h.host, papers, things.safeRoom(), 0, h.t);
  }

  // ------------------------------------------------------------ the statuette

  /** A look ended: the statuette's stand in its detail, with the statuette on it (seen) or not (perhaps missed). */
  looked(a: Person): void {
    const things = this.spy.things;
    const st = things.statuette;
    const stand = things.stand;
    if (st < 0 || !stand || a.id === this.spy.id || this.missed[a.id]) return;
    const h = this.h;
    const room = things.standRoom();
    if (room < 0 || (a.room !== room && !h.sight.seeRooms(a.room, room))) return;
    const at: Spot3 = { level: stand.level, x: stand.x, z: stand.z, y: h.bp.rooms[room]!.floorY, room };
    if (!h.senses.inDetail(a, at) || !h.senses.visibleAt(a, at, DETAIL_FOV)) return;
    const items = h.world.items;
    if (items.holder[st] === -1 && items.stateOf(st) === "shelved") {
      this.knewAt[a.id] = h.t;
      return;
    }
    if (this.knewAt[a.id]! < 0) return;
    const near = 1 - Math.hypot(at.x - a.x, at.z - a.z) / DETAIL_RANGE;
    const knows = h.memory.household[a.id] || a.role === "butler" || a.regular ? KNOW_HOUSE : 1;
    if (this.rng.chance(MISS * knows * near * h.senses.attention(a))) this.missStatuette(a, stand, room);
  }

  /** It's gone: a gasp and a stare, the case said out loud, and those free close by come to look. */
  private missStatuette(a: Person, stand: Prop, room: number): void {
    const h = this.h;
    this.missed[a.id] = 1;
    this.stats.missed++;
    h.gesture(a, "startle", 1.5);
    h.glance(a, stand.x, stand.z, 3);
    h.log("react", [a.id], room, "statuette-gone");
    h.openCase("gone", a, h.host, this.spy.things.statuette, room, this.knewAt[a.id]!, h.t);
    const front = frontOf(h.pf, stand);
    const lookers = [a];
    for (const q of h.people) {
      if (lookers.length > LOOKERS) break;
      if (q === a || q.id === this.spy.id || !q.present || q.gone || q.level !== a.level || q.room !== a.room || Math.hypot(q.x - a.x, q.z - a.z) > LOOK_NEAR) continue;
      this.missed[q.id] = 1;
      lookers.push(q);
    }
    if (!front) return;
    const side = facing(stand.yaw + Math.PI / 2);
    lookers.forEach((q, k) => {
      if (!h.free(q)) return;
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.8;
      const w = h.pf.snap(front.level, front.x + side.x * off, front.z + side.z * off, 0.8);
      const r = w ? h.pf.roomAt(w.level, w.x, w.z) : -1;
      if (!w || r === -1) return;
      this.stats.lookers++;
      h.tasks.chore(
        q,
        [
          { do: "goto", to: { level: w.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, stand.x, stand.z), room: r }, label: "to-stand" },
          { do: "wait", s: this.rng.range(LOOK_FOR[0], LOOK_FOR[1]), pose: "look", label: "gone-look" },
        ],
        this.spy.things.statuette,
        "gone-look",
      );
    });
  }

  // ------------------------------------------------------------------ the bug

  /** Someone sat down: on the sofa with the bug in it, one sitting in twenty finds it. */
  sat(p: Person, seat: Seat): void {
    const bug = this.spy.things.bug;
    if (bug?.place !== "sofa" || !bug.prop || !this.bugThere() || p.id === this.spy.id) return;
    if (seat.id !== bug.prop.id && !seat.id.startsWith(`${bug.prop.id}:`)) return;
    if (this.rng.chance(SOFA)) this.foundBug(p, bug.room);
  }

  /** A waiter's stop cleared glasses: at the table with the bug under it, one clearing in ten finds it. */
  served(w: Person, cleared: number): void {
    const bug = this.spy.things.bug;
    if (cleared <= 0 || bug?.place !== "table" || !bug.prop || !this.bugThere() || w.id === this.spy.id || w.level !== bug.prop.level) return;
    if (toEdge(bug.prop, w.x, w.z) > AT_TABLE) return;
    if (this.rng.chance(TABLE)) this.foundBug(w, bug.room);
  }

  private bugThere(): boolean {
    const d = this.spy.things.device;
    const items = this.h.world.items;
    return d >= 0 && items.holder[d] === -1 && items.stateOf(d) === "down";
  }

  /** A bug! Taken out, and a case over whoever sat or lingered there in the last two hours. */
  private foundBug(w: Person, room: number): void {
    const h = this.h;
    const items = h.world.items;
    const d = this.spy.things.device;
    items.holder[d] = w.id;
    items.set(d, "carried", h.t);
    items.place(d, w);
    this.stats.bugs++;
    h.gesture(w, "startle", 1.5);
    h.log("react", [w.id], room, "bug");
    h.openCase("planted", w, h.host, d, room, h.t - CASES.planted.lookBack, h.t);
  }
}

/** How far a point is outside a prop's footprint (0 inside it). */
function toEdge(p: Prop, x: number, z: number): number {
  const f = facing(p.yaw);
  const dx = x - p.x;
  const dz = z - p.z;
  const along = Math.abs(dx * f.x + dz * f.z) - p.d / 2;
  const across = Math.abs(dx * f.z - dz * f.x) - p.w / 2;
  return Math.hypot(Math.max(0, along), Math.max(0, across));
}
