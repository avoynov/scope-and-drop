/**
 * The spy's tactics (milestone 3 technical plan: The scheduler, habits and tactics): ways of doing
 * a step of its plan, each only while it is on (scheduler.ts).
 *
 * - False alibi: before an act somewhere out of the way, with people about to wonder where it went
 *   (or at dinner), a reason to be away first: one of milestone 2's mishaps staged on itself
 *   (dramas.ts staged()). A cut: the crash and the held hand, help waved off. A spill down itself.
 *   A lost thing: a pat at its pockets and straight off for it, no searching. A call: the phone to
 *   its ear, then held in the act's empty room, turned to the wall. The act runs inside it, and then
 *   the cover drops: a cut washed far too long in the bathroom nearest the act and the bandage when
 *   it's back, off again within the hour; a spill sponged out, back clean in the same clothes; the
 *   lost thing back at once. Joining a circle while it's fresh, it says it was where its alibi puts
 *   it (register.ts: a claim), so anyone who saw it elsewhere then finds it in two places at once;
 *   and it never says where it has just done something.
 * - Other people's things: the planner's spill, its drink knocked down a bag's owner so they go and
 *   change (their bag left on a chair, bags.ts); and half the time the bag carried off to a quiet
 *   room near by, gone through there and put back where it lay.
 * - Commotion: a shoulder on the act's room's switch, 10 to 30 s of dark, and the act in it.
 *
 * Those who saw the staged mishap (the bandage, the spill, the pat at its pockets) and see the bare
 * hand, the clean shirt or the lost thing back at once make something of it: milestone 2's
 * bandage-gone, and the new no-stain and found-at-once. Hearing of it isn't enough.
 * It draws only from its own fork, and only when a tactic acts.
 */
import type { Rng } from "../../mansion/core/rng";
import type { RoomType } from "../../mansion/core/types";
import { PARTY_LENGTH } from "../clock";
import type { Dramas } from "../dramas";
import type { Ident } from "../ident";
import { yawTo } from "../places";
import { DETAIL_RANGE } from "../senses";
import type { Step, Task } from "../tasks";
import type { ActionState, DrinkId, Person, Spot } from "../types";
import type { HabitsHost } from "./habits";
import type { Spy } from "./index";
import type { TellId } from "./measure";
import { FIRST_STEP } from "./steps";

/** What the tactics need from the party, besides the habits'. */
export interface TacticsHost extends HabitsHost {
  readonly dramas: Dramas;
  readonly ident: Ident;
  /** A fresh drink in hand. */
  pour(p: Person, d: DrinkId): void;
  /** The bathroom someone would make for (-1 none). */
  bathFor(p: Person): number;
}

export type AlibiKind = "cut" | "spill" | "lost" | "call";
export const ALIBI_KINDS: readonly AlibiKind[] = ["cut", "spill", "lost", "call"];

/** The alibi under way: from its opener until its claim goes stale. */
export interface Alibi {
  kind: AlibiKind;
  /** Its opener has shown (the cut, the spill, the lost thing, the phone): from then on it has to be seen through. */
  opened: boolean;
  /** The staged cut's or spill's episode (dramas.ts), -1 none. */
  ep: number;
  /** When it left, and when it was back (-1 not yet). */
  from: number;
  to: number;
  /** Where it says it was: the bathroom of its wash, the cloakroom its coat hangs in for the lost thing, the hall for a call (-1: nothing). */
  room: number;
  /** The bathroom it washes in (an index into places.bathrooms), -1 none. */
  bath: number;
  /** Away at the act; to wash (washing); to have the cut dressed; back. */
  stage: "away" | "wash" | "washing" | "dress" | "back";
  tries: number;
  /** Circles it has told since it came back. */
  told: number;
  dinner: boolean;
}

/** Not again within this of the last (in-game s); a cut and a spill once an evening, a lost thing once, a call twice. */
const ALIBI_GAP = 15 * 60;
const ALIBI_MAX: Record<AlibiKind, number> = { cut: 1, spill: 1, lost: 1, call: 2 };
const ALIBI_WEIGHT: Record<AlibiKind, number> = { cut: 3, spill: 3, lost: 2, call: 2 };
/** Worth an alibi: at least this many others within this (m) who'd see it go. */
const WATCHERS = 2;
const WATCH_NEAR = 8;
/** A cut's wash: a visit and this much longer, far longer than anyone's (milestone 2's is three minutes); a spill's, a visit and the stain sponged out (in-game s). */
const VISIT: readonly [number, number] = [120, 240];
const CUT_WASH: readonly [number, number] = [240, 420];
const SPILL_WASH: readonly [number, number] = [90, 150];
/** A wash tried this many times in all: the bathroom nearest the act, then whichever it would try next when that one's taken. */
const WASH_TRIES = 3;
/** The bandage off within the hour of going on (in-game s); a visit that didn't get in, tried at once at the next bathroom, so many in a row, then again this much later. */
const BANDAGE_OFF: readonly [number, number] = [15 * 60, 50 * 60];
const OFF_TRIES = 3;
const OFF_AGAIN = 5 * 60;
/** Its claim holds this long after it's back; told to the first circle it joins, then at the everyday rate (register.ts). */
const CLAIM_FOR = 20 * 60;
const CLAIM_AGAIN = 0.3;
/** Where it did something it never mentions, for this long after (in-game s). */
const KEEPS_QUIET = 10 * 60;
/** A call: taken where it stands, then held in the act's empty room, facing the wall (in-game s). */
const CALL_TAKE: readonly [number, number] = [3, 5];
const CALL_HELD: readonly [number, number] = [15, 30];
/** A cut, a spill or a lost thing shows as it goes off this long (in-game s). */
const OFF_FOR = 60;
/** Back with the lost thing: odd to anyone who knew of it within this; the shirt made out within this (m). */
const BACK_FOR = 20 * 60;
const SEE_SHIRT = 8;
/**
 * Other people's things: a bag carried off this often while the tactic is on, to an empty room
 * within this (m), one of the party's own counting this much further; in its hands with no step
 * carrying it this long (in-game s), it's set down, where it lay when that's within PUT_NEAR (m).
 */
const CARRY = 0.5;
const QUIET_NEAR = 30;
const PARTY_ROOM = 8;
const LOOSE = 10;
const PUT_NEAR = 3;
const NOT_QUIET: ReadonlySet<RoomType> = new Set(["bathroom", "kitchen", "pantry", "service-stair", "corridor", "landing", "stair-hall", "entrance-hall", "hall-gallery"]);

export class Tactics {
  readonly stats = { alibis: 0, cut: 0, spill: 0, lost: 0, call: 0, washes: 0, bandageOff: 0, claims: 0, quiet: 0, spills: 0, carried: 0, lights: 0 };
  alibi: Alibi | null = null;
  /** A bag carried off: which, where to stand to put it back, and where it lay. */
  carry: { bag: number; spot: Spot; at: { level: number; x: number; z: number; room: number } } | null = null;
  /** Since when a bag has been in its hands with no step of its own carrying it (-1 not). */
  private looseAt = -1;
  private lastAlibi = -1e9;
  private readonly used: Record<AlibiKind, number> = { cut: 0, spill: 0, lost: 0, call: 0 };
  /** Who saw its bandage (1) and then the bare hand (2); who saw it clean after its spill; who saw it back with the lost thing. */
  private readonly sawBandage: Uint8Array;
  private readonly sawClean: Uint8Array;
  private readonly sawBack: Uint8Array;
  /** The staged cut's episode (-1 none), when the bandage went on, when it comes off (-1 none due), and a visit to take it off under way. */
  private cutEp = -1;
  private bandagedAt = -1;
  private offAt = -1;
  private offing = false;
  private offTries = 0;
  /** When it staged its spill and its loss, and when it was back clean after the one and back with the other (-1 not). */
  private spillAt = -1;
  private lostAt = -1;
  private cleanAt = -1;
  private backAt = -1;
  /** The room it put the lights out in (-1 none). */
  private darkRoom = -1;

  constructor(
    private readonly h: TacticsHost,
    private readonly spy: Spy,
    private readonly rng: Rng,
  ) {
    const n = h.people.length;
    this.sawBandage = new Uint8Array(n);
    this.sawClean = new Uint8Array(n);
    this.sawBack = new Uint8Array(n);
  }

  // ------------------------------------------------------------ false alibi

  /**
   * Before an act at `site`, away from its room: with the alibi on and people about (or at dinner),
   * the steps that stage a reason to be away (`before`, where it stands; `at`, at the act's spot
   * before its moment) and what the task looks like. Null: no alibi this time.
   */
  wrap(p: Person, site: Spot, dinner: boolean): { before: Step[]; at: Step[]; cover: string } | null {
    const h = this.h;
    if (!this.spy.covers.active("alibi") || this.alibi || h.t - this.lastAlibi < ALIBI_GAP || site.room === p.room) return null;
    if (!dinner && this.around(p) < WATCHERS) return null;
    const bath = this.bathNear(p, site);
    const kind = this.pick(p, dinner, bath);
    if (!kind) return null;
    const washes = kind === "cut" || kind === "spill";
    const items = h.world.items;
    const coat = p.coat >= 0 && items.stateOf(p.coat) === "hung" ? items.room[p.coat]! : -1;
    const room = washes ? h.places.bathrooms[bath]!.room.index : kind === "call" ? (h.places.entranceRoom?.index ?? -1) : coat;
    this.alibi = { kind, opened: false, ep: -1, from: h.t, to: -1, room, bath: washes ? bath : -1, stage: "away", tries: 0, told: 0, dinner };
    this.used[kind]++;
    const before: Step[] = [{ do: "wait", s: 0, pose: "stand", label: `alibi:${kind}` }];
    const at: Step[] = [];
    if (kind === "call") {
      before.push({ do: "wait", s: this.rng.range(CALL_TAKE[0], CALL_TAKE[1]), pose: "phone", label: "call-take" });
      at.push({ do: "wait", s: 0, pose: "phone", label: "call-in" }, { do: "wait", s: this.rng.range(CALL_HELD[0], CALL_HELD[1]), pose: "phone", label: "call" });
    } else before.push({ do: "wait", s: 1.5, pose: "stand", label: "alibi:wave" });
    return { before, at, cover: washes ? "toilet" : "wander" };
  }

  /** An alibi made for a step that ended before its opener showed: as if none was made. */
  cancel(): void {
    const a = this.alibi;
    if (!a || a.stage !== "away" || a.opened) return;
    this.used[a.kind]--;
    this.alibi = null;
  }

  /** Others within WATCH_NEAR in its room who'd see it go. */
  private around(p: Person): number {
    let k = 0;
    for (const q of this.h.people) if (q !== p && q.present && !q.gone && q.level === p.level && q.room === p.room && Math.hypot(q.x - p.x, q.z - p.z) <= WATCH_NEAR) k++;
    return k;
  }

  /** Which mishap, by what it has in hand and has used tonight: a cut or a spill needs a glass (at dinner, the one at its place) and a bathroom near the act. */
  private pick(p: Person, dinner: boolean, bath: number): AlibiKind | null {
    const items = this.h.world.items;
    const glass = p.item >= 0 && items.kindOf(p.item) === "glass" ? p.item : -1;
    const ok: Record<AlibiKind, boolean> = {
      cut: bath >= 0 && !p.bandage && (glass >= 0 || dinner),
      spill: !dinner && bath >= 0 && !p.stain && glass >= 0 && items.fill[glass]! > 0.2,
      lost: !dinner,
      call: true,
    };
    let sum = 0;
    for (const k of ALIBI_KINDS) if (ok[k] && this.used[k] < ALIBI_MAX[k]) sum += ALIBI_WEIGHT[k];
    if (sum <= 0) return null;
    let u = this.rng.next() * sum;
    for (const k of ALIBI_KINDS) {
      if (!ok[k] || this.used[k] >= ALIBI_MAX[k]) continue;
      u -= ALIBI_WEIGHT[k];
      if (u < 0) return k;
    }
    return null;
  }

  /** The bathroom nearest the act that it can get to (-1 none). */
  private bathNear(p: Person, site: Spot): number {
    const h = this.h;
    let best = -1;
    let bd = Infinity;
    h.places.bathrooms.forEach((b, i) => {
      if (p.room >= 0 && !h.world.reachable(p.room, b.door.room, p)) return;
      const d = Math.hypot(b.door.x - site.x, b.door.z - site.z) + 12 * Math.abs(b.door.level - site.level);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** Nothing more of its plan to do for now, the acts away over however they went: an alibi still away drops its cover (true: the wash under way). */
  done(p: Person): boolean {
    if (this.alibi?.stage !== "away") return false;
    this.actOver();
    return this.think(p);
  }

  /** The cover drops: a wash first for a cut or a spill; one that never showed is as if never made. */
  private actOver(): void {
    const a = this.alibi;
    if (!a || a.stage !== "away") return;
    if (!a.opened) return this.cancel();
    if (a.bath >= 0 && a.ep >= 0) {
      a.stage = "wash";
      this.spy.record.thinkAt = this.h.t;
    } else this.back(a);
  }

  /** Back among the party: its claim holds from now. */
  private back(a: Alibi): void {
    const h = this.h;
    a.to = h.t;
    a.stage = a.kind === "cut" && a.ep >= 0 ? "dress" : "back";
    if (a.kind === "lost") this.backAt = h.t;
    if (a.stage === "dress") this.spy.record.thinkAt = h.t;
  }

  /** Its mind is free: someone's bag back where it lay, the wash, the bandage, taking the bandage off (true: under way). */
  think(p: Person): boolean {
    const h = this.h;
    const a = this.alibi;
    if (this.carry) return this.takeBack(p);
    if (a?.stage === "wash") return this.wash(p, a);
    if (a?.stage === "dress") {
      a.stage = "back";
      h.dramas.dressNow(p, a.ep);
      return !!p.action;
    }
    if (this.offAt >= 0 && h.t >= this.offAt && p.bandage && !this.offing && this.free(p)) return this.takeOff(p);
    return false;
  }

  /** In to the bathroom of its alibi for far too long, or long enough to sponge the stain out; that one taken, another, and that's where it says it was. */
  private wash(p: Person, a: Alibi): boolean {
    const h = this.h;
    const i = a.tries === 0 ? a.bath : h.bathFor(p);
    const b = h.places.bathrooms[i];
    if (!b || a.tries >= WASH_TRIES) {
      this.back(a);
      return false;
    }
    a.tries++;
    a.bath = i;
    a.room = b.room.index;
    const extra = a.kind === "cut" ? this.rng.range(CUT_WASH[0], CUT_WASH[1]) : this.rng.range(SPILL_WASH[0], SPILL_WASH[1]);
    h.start(p, { id: "toilet", target: b.door, duration: this.rng.range(VISIT[0], VISIT[1]) + extra, pose: "wait", gain: { bladder: 1 }, ref: i, note: "door" });
    if (p.action?.id !== "toilet") {
      this.back(a);
      return false;
    }
    a.stage = "washing";
    this.stats.washes++;
    return true;
  }

  /** In a bathroom within the hour of the bandage going on, to take it off. */
  private takeOff(p: Person): boolean {
    const h = this.h;
    const i = h.bathFor(p);
    const b = h.places.bathrooms[i];
    if (b) h.start(p, { id: "toilet", target: b.door, duration: this.rng.range(VISIT[0], VISIT[1]), pose: "wait", gain: { bladder: 1 }, ref: i, note: "door" });
    if (p.action?.id !== "toilet") {
      this.offAt = h.t + OFF_AGAIN;
      this.offTries = 0;
      return false;
    }
    this.offing = true;
    return true;
  }

  /** Free to slip off to a bathroom: after 19:20, between the programme's beats, before the first goodbye. */
  private free(p: Person): boolean {
    const h = this.h;
    const ph = h.programme[this.spy.phase]?.id;
    return h.t >= FIRST_STEP && h.byeAt < 0 && !p.staff && (ph === "arrival" || ph === "mingle" || ph === "dancing" || ph === "games");
  }

  /** One of its actions ended (sim.ts end()): out of the bathroom washed, or with the bandage off. */
  ended(act: ActionState): void {
    if (act.id !== "toilet") return;
    const h = this.h;
    const p = this.spy.record;
    const inside = act.note === "inside";
    const a = this.alibi;
    if (a?.stage === "washing") {
      if (!inside) {
        a.stage = "wash";
        return;
      }
      if (a.kind === "spill" && p.stain) {
        p.stain = null;
        h.ident.refresh(p);
        this.cleanAt = h.t;
        this.tell("clean-shirt", p, PARTY_LENGTH - h.t);
      }
      // Somewhere to come back to (habits.ts): the bathroom of its alibi.
      this.spy.habits.did({ level: p.level, x: p.x, z: p.z, yaw: p.yaw, room: p.room });
      this.back(a);
    } else if (this.offing) {
      this.offing = false;
      if (!p.bandage) {
        this.offAt = -1;
        return;
      }
      if (!inside) {
        // Taken: the next bathroom it would try (that one is remembered busy), then a while later.
        this.offTries = (this.offTries + 1) % OFF_TRIES;
        this.offAt = this.offTries ? h.t : h.t + OFF_AGAIN;
        return;
      }
      p.bandage = false;
      h.ident.refresh(p);
      this.offAt = -1;
      this.offTries = 0;
      this.stats.bandageOff++;
      this.tell("bare-hand", p, PARTY_LENGTH - h.t);
      this.note("bandage-off");
    }
  }

  /** Back from an alibi with a place to put itself and nobody told yet. */
  owed(): boolean {
    const a = this.alibi;
    return !!a && a.to >= 0 && a.told === 0 && a.room >= 0 && this.h.t - a.to <= CLAIM_FOR;
  }

  /**
   * What it says it has been doing on joining a circle (register.ts joinsGroup()), or sitting back
   * down at table among those beside it (sim.ts sitDown()): while an alibi is
   * fresh, where the alibi puts it (to the first circle, then at the everyday rate) and never the
   * truth; nothing about a place where it has just done something; otherwise, like anyone (undefined).
   */
  tells(p: Person, room: number, from: number): { room: number; from: number; to: number } | null | undefined {
    const h = this.h;
    const a = this.alibi;
    if (a && a.to >= 0 && h.t - a.to <= CLAIM_FOR) {
      if (a.room < 0 || (a.told > 0 && !this.rng.chance(CLAIM_AGAIN * (0.4 + p.traits.talk)))) return null;
      a.told++;
      this.stats.claims++;
      this.note(`claim:${a.room}`);
      return { room: a.room, from: a.from, to: a.to };
    }
    if (room >= 0 && this.spy.habits.deeds.some((d) => d.spot.room === room && d.at >= from - 60 && h.t - d.at <= KEEPS_QUIET)) {
      this.stats.quiet++;
      return null;
    }
    return undefined;
  }

  /** Someone saw it (a sighting at d m): its bandage, then the bare hand; clean after the spill they saw; back at once with the lost thing it told them of. */
  saw(a: Person, d: number): void {
    const h = this.h;
    const p = this.spy.record;
    const i = a.id;
    if (this.cutEp >= 0 && d <= DETAIL_RANGE) {
      if (p.bandage) this.sawBandage[i] = 1;
      else if (this.sawBandage[i] === 1 && this.bandagedAt >= 0) {
        this.sawBandage[i] = 2;
        h.memory.observe(i, "bandage-gone", p.id, -1, p.room);
      }
    }
    // The spill down itself, not a drink slopped in a bump or someone else's down it.
    if (this.cleanAt >= 0 && !this.sawClean[i] && d <= SEE_SHIRT && !p.stain && h.memory.witnessed(i, "spill", p.id, this.spillAt, p.id)) {
      this.sawClean[i] = 1;
      h.memory.observe(i, "no-stain", p.id, -1, p.room);
    }
    if (this.backAt >= 0 && h.t - this.backAt <= BACK_FOR && !this.sawBack[i] && h.memory.witnessed(i, "lost-thing", p.id, this.lostAt)) {
      this.sawBack[i] = 1;
      h.memory.observe(i, "found-at-once", p.id, -1, p.room);
    }
  }

  // ------------------------------------------------- other people's things

  /** The planner's spill, at the owner's side: its drink knocked down them (true: it spilled). */
  spill(p: Person, q: Person): boolean {
    if (!this.h.dramas.spillOn(q, p)) return false;
    this.stats.spills++;
    this.note(`spill:${q.id}`);
    return true;
  }

  /** With the tactic on, half the time: an empty room near the bag to go through it in, a private one sooner than one of the party's (null: where it lies). */
  carryTo(bagAt: Spot): Spot | null {
    if (!this.spy.covers.active("others-things") || !this.rng.chance(CARRY)) return null;
    const h = this.h;
    const { bp, cells } = h;
    let best = -1;
    let bd = QUIET_NEAR;
    for (const r of bp.rooms) {
      if (r.index === bagAt.room || r.level !== bagAt.level || NOT_QUIET.has(r.type) || cells.count(r.index) < 4) continue;
      if (h.people.some((q) => q.present && !q.gone && q.room === r.index) || !h.world.reachable(bagAt.room, r.index, this.spy.record)) continue;
      const d = Math.hypot((r.inner.x0 + r.inner.x1) / 2 - bagAt.x, (r.inner.z0 + r.inner.z1) / 2 - bagAt.z) + (r.role === "party" ? PARTY_ROOM : 0);
      if (d < bd) {
        bd = d;
        best = r.index;
      }
    }
    return best >= 0 ? cells.random(best, this.rng, 0.6) : null;
  }

  /** Picked up to carry off, where it stands to take it (`spot`): someone else's bag in its hands until it's put back. False: it's gone from its chair meanwhile. */
  take(p: Person, bag: number, spot: Spot): boolean {
    const h = this.h;
    const items = h.world.items;
    if (items.stateOf(bag) !== "down" || items.holder[bag] !== -1) return false;
    this.carry = { bag, spot, at: { level: items.level[bag]!, x: items.x[bag]!, z: items.z[bag]!, room: items.room[bag]! } };
    if (p.item >= 0) h.setDown(p);
    items.holder[bag] = p.id;
    items.set(bag, "carried", h.t);
    items.place(bag, p);
    p.held = "bag";
    p.heldUntil = h.t + 99999;
    h.notable(p, "carrying", bag, 30);
    this.stats.carried++;
    this.spy.measure.tell("their-bag", h.t, PARTY_LENGTH, p.room, h.visibility(p));
    this.note(`carry:${bag}`);
    return true;
  }

  /** A bag in its hands with no step of its plan carrying it: back where it lay, as a step of its own (true: on its way). */
  private takeBack(p: Person): boolean {
    const c = this.carry!;
    const t = this.h.tasks.spy(p, "put-back", "wander", [
      { do: "goto", to: c.spot, label: "to:put-back" },
      { do: "wait", s: 0, pose: "serve", label: "put-back" },
    ]);
    if (t.outcome === null) return true;
    this.putBack(p, this.near(p, c.at));
    return false;
  }

  private near(p: Person, at: { level: number; x: number; z: number }): boolean {
    return p.level === at.level && Math.hypot(p.x - at.x, p.z - at.z) <= PUT_NEAR;
  }

  /** The bag down again: where it lay (`there`), or where it stands. */
  putBack(p: Person, there: boolean): void {
    const c = this.carry;
    if (!c) return;
    const h = this.h;
    const items = h.world.items;
    this.carry = null;
    this.looseAt = -1;
    items.holder[c.bag] = -1;
    items.set(c.bag, "down", h.t);
    items.place(c.bag, there ? c.at : { level: p.level, x: p.x, z: p.z, room: p.room });
    if (p.held === "bag") p.held = null;
    this.spy.measure.end("their-bag", h.t);
    this.note(there ? "put-back" : "put-down");
  }

  // -------------------------------------------------------------- commotion

  /** The act's room's switch to lean on, with its lights on (null: none). */
  switchFor(room: number): Spot | null {
    const h = this.h;
    return room >= 0 && h.world.lightOn[room] ? (h.places.switches[room] ?? null) : null;
  }

  // ------------------------------------------------------------------ steps

  /** Once a step: its alibi going stale, the bandage on, the lights back, a bag left in its hands. */
  step(): void {
    const h = this.h;
    const p = this.spy.record;
    const a = this.alibi;
    if (a?.stage === "back" && h.t - a.to > CLAIM_FOR) {
      this.alibi = null;
      this.lastAlibi = h.t;
    }
    if (p.bandage && this.cutEp >= 0 && this.bandagedAt < 0) {
      this.bandagedAt = h.t;
      this.offAt = h.t + this.rng.range(BANDAGE_OFF[0], BANDAGE_OFF[1]);
    }
    if (this.darkRoom >= 0 && h.world.lightOn[this.darkRoom]) {
      this.spy.measure.end("dark", h.t);
      this.darkRoom = -1;
    }
    // Someone's bag in its hands and something else taking it up (dinner, a word, the photo): set down a few seconds on, where it lay if that's close.
    if (this.carry && h.tasks.of(p)?.kind !== "spy") {
      if (this.looseAt < 0) this.looseAt = h.t;
      else if (h.t - this.looseAt >= LOOSE) this.putBack(p, this.near(p, this.carry.at));
    } else this.looseAt = -1;
  }

  /** A step of one of its tasks done: the alibi's opener, the call, the switch, a bag put back. */
  stepDone(t: Task, st: Step): void {
    if (t.owner !== this.spy.id || t.kind !== "spy") return;
    const h = this.h;
    const p = this.spy.record;
    const a = this.alibi;
    const label = st.label;
    if (label.startsWith("alibi:") && a?.stage === "away") this.opener(p, a, label.slice(6), t);
    else if (label === "call-in") {
      p.yaw = this.toWall(p);
      const next = t.steps[t.i + 1];
      this.tell("call", p, next?.do === "wait" ? next.s : CALL_HELD[0]);
    } else if (label === "switch") {
      if (!h.dramas.mishap("switch", p, 0, true)) return;
      this.darkRoom = p.room;
      this.stats.lights++;
      this.tell("dark", p, 30);
      this.note("lights");
    } else if (label === "put-back") this.putBack(p, true);
    // For the spill: a glass of red, the drink that shows most.
    else if (label === "red" && p.item < 0) h.pour(p, "red");
  }

  /** The opener's beat: the cut, the spill, the lost thing or the phone where it stands, the help waved off. */
  private opener(p: Person, a: Alibi, what: string, t: Task): void {
    const h = this.h;
    if (what === "wave") return void h.gesture(p, "wave", 2);
    if (what === "pat") return;
    if (what === "cut" || what === "spill") {
      if (what === "cut" && a.dinner && p.item < 0) h.pour(p, "red");
      a.ep = h.dramas.staged(what, p);
      // Nothing to stage after all (the glass gone): the act goes ahead with no reason given.
      if (a.ep < 0) return this.cancel();
      if (what === "cut") this.cutEp = a.ep;
      else this.spillAt = h.t;
      this.tell(what === "cut" ? "cut-off" : "spill-off", p, OFF_FOR);
    } else if (what === "lost") {
      this.lostAt = h.t;
      h.gesture(p, "shrug", 2);
      // It says so to those it stands with: the thing it's off to fetch.
      const g = h.circleOf(p);
      for (const q of h.people) {
        if (q === p || !q.present || q.level !== p.level || q.room !== p.room) continue;
        if (g ? g.members.includes(q.id) : Math.hypot(q.x - p.x, q.z - p.z) <= 2) h.memory.observe(q.id, "lost-thing", p.id, -1, p.room);
      }
      this.tell("lost-off", p, OFF_FOR);
      t.steps.splice(t.i + 1, 0, { do: "wait", s: 2, pose: "stand", label: "alibi:pat" });
    }
    a.opened = true;
    a.from = h.t;
    this.stats.alibis++;
    this.stats[a.kind]++;
    this.note(`alibi:${a.kind}`);
  }

  /** Facing the nearest wall of its room. */
  private toWall(p: Person): number {
    const r = p.room >= 0 ? this.h.bp.rooms[p.room] : undefined;
    if (!r) return p.yaw;
    const b = r.inner;
    const walls = [
      { d: p.x - b.x0, x: b.x0, z: p.z },
      { d: b.x1 - p.x, x: b.x1, z: p.z },
      { d: p.z - b.z0, x: p.x, z: b.z0 },
      { d: b.z1 - p.z, x: p.x, z: b.z1 },
    ];
    walls.sort((u, v) => u.d - v.d);
    return yawTo(p.x, p.z, walls[0]!.x, walls[0]!.z);
  }

  // ----------------------------------------------------------------- inside

  /** Its line in the spy's digest: alibis staged, washes, claims, spills, bags carried, lights. */
  digest(): string {
    const s = this.stats;
    return `${s.alibis},${s.washes},${s.claims},${s.spills},${s.carried},${s.lights}`;
  }

  private tell(what: TellId, p: Person, secs: number): void {
    const h = this.h;
    this.spy.measure.tell(what, h.t, h.t + secs, p.room, h.visibility(p));
  }

  private note(s: string): void {
    const p = this.spy.record;
    this.h.log("spy", [p.id], p.room, s);
  }
}
