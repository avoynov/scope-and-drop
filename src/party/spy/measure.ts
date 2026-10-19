/**
 * Counting what the spy gives away (milestone 3 technical plan: The lab, Counting twins): its
 * tells, the innocent twins of each, and how the crowd ranks everyone. The lab and the sweep read
 * these; nothing the sim chooses does.
 */
import type { Ident } from "../ident";
import type { Memory, Verb } from "../memory";
import type { Person } from "../types";

/** The tells PR 1 can give: being out of step with the programme, and the garment left outside. Later PRs add the rest of the plan's catalogue. */
export type TellId = "out-of-step" | "garment";

/** A cover is a soft tell an innocent can give too, a trace is something left behind, a hard tell is an act only the spy does. */
export type TellKind = "cover" | "trace" | "hard";

/** The plan's catalogue: each tell's kind and the zoom that reads it. */
export const TELLS: Record<TellId, { kind: TellKind; zoom: number }> = {
  "out-of-step": { kind: "cover", zoom: 4 },
  garment: { kind: "trace", zoom: 10 },
};

/** The verbs of innocents' notables that look like a tell: the innocent twins. */
export const TWIN_VERBS: ReadonlySet<Verb> = new Set<Verb>(["out-of-step", "camera-shy", "startled", "wrong-turn", "locked-door", "fumbled", "bandage-gone", "snooping"]);

/** A tell, written by the spy's own code at the moment it acts. */
export interface Tell {
  t: number;
  what: TellId;
  kind: TellKind;
  room: number;
  /** The perch's view of the spot then (0 to 1), and the zoom that reads it. */
  view: number;
  zoom: number;
  /** Until when it shows; the guests whose sighting picked it up meanwhile, first sight first. */
  until: number;
  seenBy: number[];
}

export class Measure {
  readonly tells: Tell[] = [];
  /** Innocents' notables of a tell's verb, oldest first. */
  readonly twins: Array<{ t: number; who: number; verb: Verb }> = [];

  /** The spy gives a tell; the same one again while it still shows only keeps it showing. */
  tell(what: TellId, t: number, until: number, room: number, view: number): Tell {
    let last: Tell | undefined;
    for (let i = this.tells.length - 1; i >= 0 && !last; i--) if (this.tells[i]!.what === what) last = this.tells[i];
    if (last && last.until >= t && last.room === room) {
      last.until = Math.max(last.until, until);
      last.view = Math.max(last.view, view);
      return last;
    }
    const spec = TELLS[what];
    const x: Tell = { t, what, kind: spec.kind, room, view, zoom: spec.zoom, until, seenBy: [] };
    this.tells.push(x);
    return x;
  }

  /** A guest's sighting of the spy picked up whatever tell shows on it now. */
  seen(by: number, t: number): void {
    // Only the last few can still show.
    for (let i = this.tells.length - 1; i >= Math.max(0, this.tells.length - 8); i--) {
      const x = this.tells[i]!;
      if (x.kind !== "trace" && x.t <= t && t <= x.until && !x.seenBy.includes(by)) x.seenBy.push(by);
    }
  }

  /** An innocent's notable that looks like one of the spy's tells. */
  twin(who: number, verb: Verb, t: number): void {
    if (!TWIN_VERBS.has(verb)) return;
    const last = this.twins[this.twins.length - 1];
    if (last && last.who === who && last.verb === verb && t - last.t < 30) return;
    this.twins.push({ t, who, verb });
  }

  /** Tells and twins in an hour of the evening (in-game s from 19:00), for the lab's stats and the sweep. */
  inHour(h: number): { tells: number; twins: number } {
    const a = h * 3600;
    const b = a + 3600;
    return { tells: this.tells.filter((x) => x.t >= a && x.t < b).length, twins: this.twins.filter((x) => x.t >= a && x.t < b).length };
  }
}

/**
 * The people the crowd suspects most: each person's score is the mean, over the guests present,
 * of the larger of their suspicion and their doubt about them (the lab's measure; milestone 4
 * decides how the crowd pools for real). Highest first.
 */
export function ranks(people: readonly Person[], memory: Memory, ident: Ident, t: number, top = 10): Array<{ id: number; score: number }> {
  const n = people.length;
  const guests = people.filter((p) => p.present && !p.gone && !p.staff);
  const out: Array<{ id: number; score: number }> = [];
  for (let j = 0; j < n; j++) {
    const q = people[j]!;
    if (q.gone || !q.present) continue;
    let s = 0;
    let c = 0;
    for (const p of guests) {
      if (p.id === j) continue;
      s += Math.max(memory.suspicion[p.id * n + j]!, ident.doubtOf(p.id, j, t));
      c++;
    }
    out.push({ id: j, score: c ? s / c : 0 });
  }
  return out.sort((a, b) => b.score - a.score || a.id - b.id).slice(0, top);
}
