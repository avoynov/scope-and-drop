/**
 * The spy's planner (milestone 3 technical plan: The planner): goal-oriented action planning in
 * the small, after Jeff Orkin's for F.E.A.R. The world as the spy sees it is a set of true or
 * false facts in one mask. Each action needs some facts, brings others about, and costs rough
 * minutes of exposure. An A* search forward over masks finds the cheapest chain of actions from
 * what is true now to the goal's facts.
 *
 * It draws nothing, and its ties break by the table's order, so the same state always gives the
 * same plan. Facts are only ever added along a plan: the spy plans again from the world as it is
 * whenever an action ends (steps.ts), which is what takes a fact away.
 */

export const FACTS = ["way", "there", "door", "safe", "found", "free", "unwatched", "holding", "stashed", "planted", "copied", "close", "alone"] as const;
export type Fact = (typeof FACTS)[number];
/** Each fact's bit in the mask. */
export const F = Object.fromEntries(FACTS.map((f, i) => [f, 1 << i])) as Record<Fact, number>;

/** What switches an action on, off until its pull request: touring alone and commotion are PR 4's tactics, other people's things too, the host's place PR 5's murder. */
export type Tactic = "touring" | "things" | "commotion" | "murder" | "tour";

export type PlanActionId =
  | "learn"
  | "tour-alone"
  | "go"
  | "pick-lock"
  | "slip-in"
  | "host-place"
  | "open-safe"
  | "find-bag"
  | "wait-owner"
  | "spill"
  | "bag"
  | "coat"
  | "pocket"
  | "papers"
  | "palm"
  | "look-away"
  | "commotion"
  | "stash"
  | "plant"
  | "brush-host"
  | "ledger"
  | "follow"
  | "wait-alone";

export interface PlanAction {
  id: PlanActionId;
  needs: number;
  brings: number;
  /** Rough minutes of exposure. */
  cost: number;
  /** Left out unless this is on. */
  tactic?: Tactic;
}

/**
 * The plan's table, in its order (which breaks ties). Slipping in behind a tour needs a tour
 * heading there, which isn't a fact yet: it waits on a tactic of its own (see the docs' gaps).
 */
export const ACTIONS: readonly PlanAction[] = [
  { id: "learn", needs: 0, brings: F.way, cost: 2 },
  { id: "tour-alone", needs: 0, brings: F.way, cost: 1, tactic: "touring" },
  { id: "go", needs: F.way, brings: F.there, cost: 1 },
  { id: "pick-lock", needs: F.there, brings: F.door, cost: 4 },
  { id: "slip-in", needs: 0, brings: F.door | F.there, cost: 3, tactic: "tour" },
  { id: "host-place", needs: 0, brings: F.door, cost: 12, tactic: "murder" },
  { id: "open-safe", needs: F.there | F.door, brings: F.safe, cost: 3 },
  { id: "find-bag", needs: 0, brings: F.found, cost: 2 },
  { id: "wait-owner", needs: F.found, brings: F.free, cost: 2 },
  { id: "spill", needs: F.found, brings: F.free, cost: 3, tactic: "things" },
  { id: "bag", needs: F.free, brings: F.holding, cost: 2 },
  { id: "coat", needs: F.there | F.unwatched, brings: F.holding, cost: 2 },
  { id: "pocket", needs: F.close | F.unwatched, brings: F.holding, cost: 2 },
  { id: "papers", needs: F.safe, brings: F.holding, cost: 1 },
  { id: "palm", needs: F.there | F.unwatched, brings: F.holding, cost: 2 },
  { id: "look-away", needs: F.there, brings: F.unwatched, cost: 2 },
  { id: "commotion", needs: F.there, brings: F.unwatched, cost: 3, tactic: "commotion" },
  { id: "stash", needs: F.holding, brings: F.stashed, cost: 1 },
  { id: "plant", needs: F.there | F.door, brings: F.planted, cost: 2 },
  { id: "brush-host", needs: 0, brings: F.planted, cost: 1 },
  { id: "ledger", needs: F.there, brings: F.copied, cost: 3 },
  { id: "follow", needs: 0, brings: F.close, cost: 1 },
  { id: "wait-alone", needs: F.close, brings: F.alone, cost: 2 },
];
export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/** A failed action costs this many times as much, for this long (in-game s). */
export const BLOCK_COST = 4;
export const BLOCK_FOR = 15 * 60;
/** The search gives up after this many expansions. */
export const MAX_EXPANSIONS = 200;

export interface PlanProblem {
  /** What is true now. */
  start: number;
  goal: number;
  /** The actions this goal can use (its context), in any order: the table's order is kept. */
  use: ReadonlySet<PlanActionId>;
  /** Tactics switched on. */
  tactics?: ReadonlySet<Tactic>;
  /**
   * An action's needs for this goal, in place of the table's: following the target waits for the
   * theft first (stashed) while that is on, and at a pocket, waiting for the moment needs the
   * target close rather than a place.
   */
  needs?: Partial<Record<PlanActionId, number>>;
  /** Actions that failed, and until when they cost BLOCK_COST times as much. */
  blocked?: ReadonlyMap<PlanActionId, number>;
  t?: number;
}

export interface Plan {
  steps: PlanActionId[];
  cost: number;
  expansions: number;
}

const bits = (m: number): number => {
  let c = 0;
  for (let v = m; v; v &= v - 1) c++;
  return c;
};

/** The goal facts still false: one action brings at most one of them, and every action costs at least 1, so this never overestimates. */
const heuristic = (m: number, goal: number): number => bits(goal & ~m);

/** What an action costs now. */
export function costOf(a: PlanAction, p: Pick<PlanProblem, "blocked" | "t">): number {
  const until = p.blocked?.get(a.id);
  return until !== undefined && (p.t ?? 0) < until ? a.cost * BLOCK_COST : a.cost;
}

/**
 * The cheapest chain of actions from `start` to every fact of `goal`, or null when none is found
 * within MAX_EXPANSIONS. Already there: an empty plan.
 */
export function plan(p: PlanProblem): Plan | null {
  const acts = ACTIONS.filter((a) => p.use.has(a.id) && (!a.tactic || p.tactics?.has(a.tactic)));
  const needs = acts.map((a) => p.needs?.[a.id] ?? a.needs);
  const costs = acts.map((a) => costOf(a, p));
  if ((p.start & p.goal) === p.goal) return { steps: [], cost: 0, expansions: 0 };
  interface Node {
    m: number;
    g: number;
    f: number;
    seq: number;
    steps: PlanActionId[];
  }
  const open: Node[] = [{ m: p.start, g: 0, f: heuristic(p.start, p.goal), seq: 0, steps: [] }];
  const best = new Map<number, number>([[p.start, 0]]);
  let seq = 1;
  let expansions = 0;
  while (open.length && expansions < MAX_EXPANSIONS) {
    // The lowest f, and among equals the earliest pushed, which keeps the table's order.
    let k = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!;
      const b = open[k]!;
      if (a.f < b.f || (a.f === b.f && a.seq < b.seq)) k = i;
    }
    const node = open.splice(k, 1)[0]!;
    if (node.g > (best.get(node.m) ?? Infinity)) continue;
    if ((node.m & p.goal) === p.goal) return { steps: node.steps, cost: node.g, expansions };
    expansions++;
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i]!;
      if ((node.m & needs[i]!) !== needs[i]! || (node.m | a.brings) === node.m) continue;
      const m = node.m | a.brings;
      const g = node.g + costs[i]!;
      if (g >= (best.get(m) ?? Infinity)) continue;
      best.set(m, g);
      open.push({ m, g, f: g + heuristic(m, p.goal), seq: seq++, steps: [...node.steps, a.id] });
    }
  }
  return null;
}

/** The facts of a mask by name, for the lab's card and the tests. */
export function factNames(m: number): Fact[] {
  return FACTS.filter((f) => m & F[f]);
}
