/**
 * The spy (milestone 3): one of the evening's people, with layers of its own on top of the mind
 * everyone has. The party owns one `Spy` when its `spy` option is on, and every hook into
 * milestone 2's modules asks it first; with the option off none of this is built.
 *
 * PR 1 makes it arrive and live the evening as an ordinary guest: it follows the programme by
 * its cues (cues.ts), drinks little, keeps out of trouble, greets warmly only those it believes
 * close to the one it plays, and goes home in the last half hour, never before the farewell's
 * first goodbye. Its goal is drawn from the first (cast.ts) and waits for its plan (PR 3).
 */
import type { Rng } from "../../mansion/core/rng";
import { PARTY_LENGTH, phaseIndexAt } from "../clock";
import type { Ident, Tie } from "../ident";
import type { Verb } from "../memory";
import type { PartyEvent, Person } from "../types";
import type { Knacks, SpyBody, SpyCast, SpyGoal, SpyOwn, SpySetup } from "./cast";
import { Cues, type CuesHost } from "./cues";
import { Measure, TWIN_VERBS } from "./measure";

export { castSpy, goalOdds, goalRooms, houseHolds, studied, GOALS, GOAL_SHARES, SETUPS, STEAL, type GoalKind, type SpyBody, type SpyCast, type SpyGoal, type SpyOptions, type SpySetup } from "./cast";
export { DELAY_HEARD, DELAY_SEEN, DELAY_TOLD, NOTICE, type CueHow, type CueRecord } from "./cues";
export { ranks, TELLS, type Tell, type TellId } from "./measure";

/** What the spy needs from the party. */
export interface SpyHost extends CuesHost {
  readonly people: Person[];
  readonly ident: Ident;
  /** When the farewell's first goodbye was said (-1 not yet). */
  readonly byeAt: number;
  /** Share of the farewell's leavers on their way out: of the guests still here after its first goodbye, those set off since. */
  farewellGoing(): number;
  /** The perch's view of a person now (0 to 1). */
  visibility(p: Person): number;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
}

/** Its goal as it stands: what, whom, the theft first, the rooms it needs, and when it was done. */
export interface SpyGoalState extends SpyGoal {
  rooms: number[];
  doneAt: number | null;
}

/** A deed done in the farewell keeps it among the guests this much longer (in-game s). */
const STAY: readonly [number, number] = [180, 360];
/** With its goal done it goes at a moment drawn among the first half of the farewell's leavers. */
const DONE_LEAVE: readonly [number, number] = [0, 0.5];

export class Spy {
  /** The record it lives in now. */
  id: number;
  readonly setup: SpySetup;
  /** Whom it killed before the party (-1 as itself). */
  readonly victim: number;
  readonly goal: SpyGoalState;
  /** Its own body and mind, carried into every record it wears. */
  readonly own: SpyOwn;
  readonly knack: Knacks;
  /** Every record it has worn, oldest first. */
  readonly selves: number[];
  /** How it knows each person: 0 not at all, 1 seen tonight, 2 from its study, by sight and name. */
  readonly knows: Uint8Array;
  /** How close it believes each person is to the one it plays, 0 to 1. */
  readonly close: Float32Array;
  readonly cues: Cues;
  readonly bodies: SpyBody[];
  /** Something the victim wore, left in the garden: its item, what it is and its colour. */
  readonly garment: { item: number; what: string; color: string } | null;
  /** The target it means to rob of a bag, given one at the door when the usual draw gives none (-1 none). */
  readonly bagFor: number;
  readonly measure = new Measure();
  /** Leaving: the share of the leavers it goes at, why (its goal done, or given up at the first goodbye), and how long a late deed keeps it. */
  readonly exit: { at: number; why: "done" | "gave-up" | null; stay: number } = { at: 0, why: null, stay: 0 };
  /** The record's ties as the evening began: a tie raised tonight is one it saw made. */
  private readonly castTie: Uint8Array;
  private readonly rng: Rng;

  /**
   * `rooms` are its goal's rooms (cast.ts goalRooms()); `garment` the item the party made for
   * the garment and the perch's view of where it lies.
   */
  constructor(
    private readonly host: SpyHost,
    cast: SpyCast,
    study: { knows: Uint8Array; close: Float32Array },
    rooms: number[],
    garment: { item: number; view: number } | null,
    rng: Rng,
  ) {
    this.id = cast.record;
    this.setup = cast.setup;
    this.victim = cast.victim;
    this.goal = { ...cast.goal, rooms, doneAt: null };
    this.own = cast.own;
    this.knack = cast.own.knack;
    this.selves = [cast.record];
    this.knows = study.knows;
    this.close = study.close;
    this.bodies = cast.body ? [cast.body] : [];
    this.garment = cast.garment && garment ? { item: garment.item, what: cast.garment.what, color: cast.garment.color } : null;
    this.bagFor = cast.bagFor;
    this.rng = rng.fork("mind");
    this.cues = new Cues(host, rng.fork("cues"));
    const n = host.people.length;
    this.castTie = new Uint8Array(n);
    for (let j = 0; j < n; j++) this.castTie[j] = host.ident.tieOf(this.id, j);
    this.exit.at = this.own.leaveAt;
    // Left behind before the party: a trace from the start, until someone picks it up (PR 2).
    if (this.garment) this.measure.tell("garment", cast.body?.t ?? 0, PARTY_LENGTH, -1, garment!.view);
  }

  /** The record it lives in. */
  get record(): Person {
    return this.host.people[this.id]!;
  }

  /** In at the door (or, as the host or staff, at the start): what it knows of the programme. */
  arrived(): void {
    const p = this.record;
    this.cues.arrive();
    this.host.log("spy", [p.id], p.room, `arrive:${this.setup}`);
  }

  /**
   * Whether its cues set the phase it acts on: as a guest. Playing the host or a waiter, the
   * household keeps it to the programme for now (PR 2 has the butler prompt a fake host).
   */
  get byCues(): boolean {
    const p = this.record;
    return !p.staff && p.role !== "host";
  }

  /** Once a step: its cues. */
  step(): void {
    const p = this.record;
    if (!p.present || p.gone || !this.byCues) return;
    this.cues.step(p);
  }

  /** A sighting: what the spy sees teaches it who is about and whether the room has moved on; a guest who sees the spy picks up whatever tell shows. */
  saw(a: Person, b: Person): void {
    if (a.id === this.id) {
      if (!this.knows[b.id]) this.knows[b.id] = 1;
      if (this.byCues) this.cues.saw(b);
    } else if (b.id === this.id && !a.staff) this.measure.seen(a.id, this.host.t);
  }

  /** Beckoned in, or the way pointed: a cue to come in a few seconds. */
  told(): void {
    if (this.byCues) this.cues.told();
  }

  /** Something notable about someone (sim.ts notable()): the spy's own is a tell, an innocent's of the same verbs a twin. */
  noted(p: Person, verb: Verb, secs: number): void {
    const t = this.host.t;
    if (p.id !== this.id) return void (TWIN_VERBS.has(verb) && this.measure.twin(p.id, verb, t));
    if (verb === "out-of-step") this.measure.tell("out-of-step", t, t + secs, p.room, this.host.visibility(p));
  }

  /**
   * The tie it greets someone by: its own idea of it. The record's tie for those it believes close
   * to the one it plays, and for any tie made tonight; none for anyone else, however well they knew
   * the victim. Everyone else's view of the spy is the ident's.
   */
  tieFor(i: number, j: number): Tie {
    const tie = this.host.ident.tieOf(i, j);
    if (i !== this.id) return tie;
    return tie > this.castTie[j]! || this.close[j]! >= 0.5 ? tie : 0;
  }

  /** The phase it acts on, for the minds (sim.ts updatePhase): its cue's as a guest, else the programme's. */
  get phase(): number {
    return this.byCues ? this.cues.phase : phaseIndexAt(this.host.programme, this.host.t);
  }

  /** Whether it may go home yet: never before the farewell's first goodbye. */
  mayGo(): boolean {
    return this.host.byeAt >= 0;
  }

  /**
   * Whether it goes home now. Never before the farewell's first goodbye, and then among the first
   * half of the farewell's leavers to set off: once the share of them on their way out reaches its
   * moment (guests gone before the farewell don't count). Either way that moment is drawn evenly
   * over the first half, so it isn't always among the very first goodbyes: with its goal done it is
   * drawn afresh (and a deed done in the farewell keeps it a few minutes more); with it undone by
   * then, it gives up and keeps the moment it came with.
   */
  wantsToGo(): boolean {
    const h = this.host;
    if (!this.mayGo()) return false;
    this.firstGoodbye();
    const done = this.goal.doneAt;
    const farewell = h.programme[h.programme.length - 1]!.start;
    if (done !== null && done >= farewell && h.t < done + this.exit.stay) return false;
    return h.farewellGoing() >= this.exit.at;
  }

  /** The farewell's first goodbye is said: its goal undone by then, it gives it up for tonight. */
  firstGoodbye(): void {
    if (this.exit.why !== null) return;
    this.exit.why = this.goal.doneAt !== null ? "done" : "gave-up";
    if (this.exit.why === "gave-up") this.host.log("spy", [this.id], this.record.room, "give-up");
  }

  /** Its goal done (PR 3 on): it now goes among the first half of the farewell's leavers. */
  goalDone(): void {
    const h = this.host;
    if (this.goal.doneAt !== null) return;
    this.goal.doneAt = h.t;
    this.exit.at = this.rng.range(DONE_LEAVE[0], DONE_LEAVE[1]);
    this.exit.stay = this.rng.range(STAY[0], STAY[1]);
    h.log("spy", [this.id], this.record.room, `done:${this.goal.kind}`);
  }

  /** Its line in the party's digest: the record, its cue, the goal, the covers (none yet), the bodies, whom it knows, its exit and its tells. */
  digest(): string {
    let k = 0;
    for (let j = 0; j < this.knows.length; j++) k += this.knows[j]!;
    const c = this.cues;
    return `spy${this.id}:${c.phase},${c.known}:${this.goal.doneAt === null ? 0 : 1}:0:${this.bodies.length}:${k}:${this.exit.why ?? "-"}:${this.measure.tells.length}`;
  }
}
