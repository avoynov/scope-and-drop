/**
 * Bags set down (milestone 3, PR 4: the innocent twin of the spy going through someone's bag). A
 * guest carrying a bag puts it on the nearest chair or table within 6 m to dance (85%) or to play a
 * frame of billiards (95%), and before going up to change after a spill (60%); done, they take it
 * back at once, or 40% of the time 5 to 20 minutes later, and on the way home any bag still down
 * comes first. The spy never puts its own down. Every evening's: the spy's finds (spy/finds.ts)
 * listen for its target's. Every draw comes from its own fork.
 */
import type { Rng } from "../mansion/core/rng";
import type { Pathfinder } from "./path";
import { yawTo, type Places } from "./places";
import type { Step, Task, Tasks } from "./tasks";
import type { ActionState, Person, Spot } from "./types";
import type { World } from "./world";

/** What the bags need from the party. */
export interface BagsHost {
  readonly t: number;
  readonly people: Person[];
  readonly pf: Pathfinder;
  readonly places: Places;
  readonly world: World;
  readonly tasks: Tasks;
  /** The record the spy lives in, or -1. */
  readonly spyId: number;
}

/** Who hears of a bag set down and taken back (the spy's finds): taken back from its chair (`taken`), on the way out (`leaving`), or with no way back to it (`carried`). */
export interface BagsListener {
  down(p: Person, bag: number, at: Spot): void;
  back(owner: Person, bag: number, how: "taken" | "leaving" | "carried"): void;
}

/** A carried bag goes down on a chair or a table within this (m), this often, to dance, to play a frame of billiards, or to go and change. */
const BAG_REACH = 6;
const BAG_DOWN = { dance: 0.85, billiards: 0.95, change: 0.6 } as const;
/** Done, a bag is fetched at once more often than not; otherwise it stays on its chair a while (they'll come back for it). */
const LEAVE_IT = 0.4;
const LEFT_FOR: readonly [number, number] = [5 * 60, 20 * 60];
/** Taking back a bag: anything of theirs and their party's within this (m). Not there (someone has it): back for it this much later (in-game s). */
const REACH = 2.5;
const MISSING: readonly [number, number] = [120, 300];

export class Bags {
  readonly stats = { down: 0, back: 0 };
  listener: BagsListener | null = null;
  /** Bags down, by item: whose, since when, and not to be fetched before when (-1 not settled yet). */
  private readonly down = new Map<number, { owner: number; since: number; until: number }>();

  constructor(
    private readonly h: BagsHost,
    private readonly rng: Rng,
  ) {}

  /** Its line in the party's digest. */
  digest(): string {
    return `b${this.stats.down},${this.stats.back},${this.down.size}`;
  }

  /** Someone's own bag, carried or set down (-1 none). */
  bagOf(p: Person): number {
    const items = this.h.world.items;
    for (let i = 0; i < items.n; i++) if (items.owner[i] === p.id && items.kindOf(i) === "bag") return i;
    return -1;
  }

  /** The bag of someone's set down on a chair or a table (-1 none). */
  downOf(owner: number): number {
    for (const [bag, d] of this.down) if (d.owner === owner) return bag;
    return -1;
  }

  /** An action has begun at its spot: to dance or play billiards, a bag goes down on the nearest chair or table. */
  begun(p: Person, a: ActionState): void {
    const what = a.id === "dance" ? "dance" : a.id === "games" && a.note === "billiards" ? "billiards" : null;
    if (what) this.put(p, what);
  }

  /** Off to change after a spill: the bag left on a chair. */
  spilled(p: Person): void {
    this.put(p, "change");
  }

  private put(p: Person, why: keyof typeof BAG_DOWN): void {
    if (p.staff || p.id === this.h.spyId || p.room === -1) return;
    const h = this.h;
    const items = h.world.items;
    const bag = this.bagOf(p);
    if (bag < 0 || items.holder[bag] !== p.id || items.stateOf(bag) !== "carried" || !this.rng.chance(BAG_DOWN[why])) return;
    const s = this.restingSpot(p);
    if (!s) return;
    items.holder[bag] = -1;
    items.set(bag, "down", h.t);
    items.place(bag, s);
    this.down.set(bag, { owner: p.id, since: h.t, until: -1 });
    this.stats.down++;
    this.listener?.down(p, bag, s);
  }

  /** Free again with a bag left down: back for it first (true: on the way), or later. */
  fetch(p: Person): boolean {
    const bag = this.downOf(p.id);
    if (bag < 0) return false;
    const d = this.down.get(bag)!;
    if (d.until < 0) d.until = this.rng.chance(LEAVE_IT) ? this.h.t + this.rng.range(LEFT_FOR[0], LEFT_FOR[1]) : this.h.t;
    if (this.h.t < d.until) return false;
    const s = this.by(bag);
    if (!s) {
      this.pickUp(bag, p, "carried");
      return false;
    }
    const t = this.h.tasks.chore(
      p,
      [
        { do: "goto", to: s, label: "to-bag" },
        { do: "wait", s: 2, pose: "serve", label: "bag-back" },
      ],
      bag,
      "bag-back",
    );
    if (t.outcome === null) return true;
    // No way back to it: it comes along all the same.
    this.pickUp(bag, p, "carried");
    return false;
  }

  /** Setting off home: the steps back for any bag of theirs still down, to go first. */
  goingHome(party: readonly Person[]): Step[] {
    const steps: Step[] = [];
    for (const q of party) {
      const bag = this.downOf(q.id);
      if (bag < 0) continue;
      const s = this.by(bag);
      if (s) steps.push({ do: "goto", to: s, label: "to-bag" }, { do: "wait", s: 2, pose: "serve", label: "bag-back" });
      else this.pickUp(bag, q, "carried");
    }
    return steps;
  }

  /** Out of the door: a bag still down (no way back to it) goes with them. */
  departed(p: Person): void {
    const bag = this.downOf(p.id);
    if (bag >= 0) this.pickUp(bag, p, "carried");
  }

  /** A task step done: a bag taken back. One not where they left it (someone has it) they come back for a few minutes later. */
  stepDone(t: Task, p: Person, st: Step): void {
    if (st.label !== "bag-back") return;
    const h = this.h;
    const how = t.kind === "leave" ? "leaving" : "taken";
    const party = [t.owner, ...t.party];
    const items = h.world.items;
    for (const [bag, d] of [...this.down]) {
      if (!party.includes(d.owner)) continue;
      const here = items.level[bag] === p.level && Math.hypot(items.x[bag]! - p.x, items.z[bag]! - p.z) <= REACH;
      if (here && items.stateOf(bag) === "down" && items.holder[bag] === -1) this.pickUp(bag, h.people[d.owner]!, how);
      else if (how === "taken" && items.holder[bag] !== -1) d.until = h.t + this.rng.range(MISSING[0], MISSING[1]);
    }
  }

  /** Back on the arm. */
  private pickUp(bag: number, owner: Person, how: "taken" | "leaving" | "carried"): void {
    const h = this.h;
    const items = h.world.items;
    if (items.stateOf(bag) !== "down" || items.holder[bag] !== -1) return;
    this.down.delete(bag);
    items.holder[bag] = owner.id;
    items.set(bag, "carried", h.t);
    items.place(bag, owner);
    this.stats.back++;
    this.listener?.back(owner, bag, how);
  }

  /** The nearest seat or surface in their room within BAG_REACH. */
  private restingSpot(p: Person): Spot | null {
    const pl = this.h.places;
    let best: Spot | null = null;
    let bd = BAG_REACH;
    const near = (s: Spot) => {
      if (s.level !== p.level || s.room !== p.room) return;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    };
    for (const s of pl.surfaces) near(s);
    for (const s of pl.seats) near(s.approach);
    return best;
  }

  /** Where to stand to take something from where it lies, facing it. */
  by(item: number): Spot | null {
    return standBy(this.h, item);
  }
}

/** Where to stand to take something from where it lies, facing it (null: nowhere to stand). */
export function standBy(h: { readonly pf: Pathfinder; readonly world: World }, item: number): Spot | null {
  const items = h.world.items;
  const x = items.x[item]!;
  const z = items.z[item]!;
  const w = h.pf.snap(items.level[item]!, x, z, 1.2);
  const room = w ? h.pf.roomAt(w.level, w.x, w.z) : -1;
  return w && room !== -1 ? { level: w.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, x, z), room } : null;
}
