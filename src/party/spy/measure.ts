/**
 * Counting what the spy gives away (milestone 3 technical plan: The lab, Counting twins): its
 * tells, the innocent twins of each, and how the crowd ranks everyone. The lab and the sweep read
 * these; nothing the sim chooses does.
 */
import type { Ident } from "../ident";
import type { Memory, Verb } from "../memory";
import type { Person } from "../types";

/**
 * The tells so far: being out of step with the programme and the garment left outside (PR 1); the
 * hard tells of the plan's acts (PR 3): on one knee at a locked door, crouched at the safe, going
 * through a bag or a coat, a hand in a pocket, the statuette palmed, the bug planted, the ledger
 * photographed; and its covers' (PR 4): back in the same out-of-the-way room, coming out of a
 * bedroom, a step behind someone in a quiet room, a jerk and a step back, alone upstairs trying
 * handles, out of the room as the photographer comes in, what it was fetching left on a stair,
 * the crash and the held hand off alone, off to change, straight off for a lost thing, a phone to
 * the ear in an empty room, the bare hand and the clean shirt after, someone else's bag in its
 * hands, and the room gone dark.
 */
export type TellId =
  | "out-of-step"
  | "garment"
  | "lock"
  | "safe"
  | "bag"
  | "pocket"
  | "palm"
  | "plant"
  | "ledger"
  | "returns"
  | "odd-place"
  | "followed"
  | "startled"
  | "touring"
  | "camera-shy"
  | "abandoned"
  | "cut-off"
  | "spill-off"
  | "lost-off"
  | "call"
  | "bare-hand"
  | "clean-shirt"
  | "their-bag"
  | "dark";

/** A cover is a soft tell an innocent can give too, a trace is something left behind, a hard tell is an act only the spy does. */
export type TellKind = "cover" | "trace" | "hard";

/**
 * The plan's catalogue: each tell's kind and the zoom that reads it. The hard tells' zooms are ours
 * (the spec gives none): a figure kneeling or crouched reads at 6×, someone at a bag or the console
 * with a camera at 8×, a hand under a table or at a mantel at 10×, a hand in a pocket at 12×.
 */
export const TELLS: Record<TellId, { kind: TellKind; zoom: number }> = {
  "out-of-step": { kind: "cover", zoom: 4 },
  garment: { kind: "trace", zoom: 10 },
  lock: { kind: "hard", zoom: 6 },
  safe: { kind: "hard", zoom: 6 },
  bag: { kind: "hard", zoom: 8 },
  pocket: { kind: "hard", zoom: 12 },
  palm: { kind: "hard", zoom: 10 },
  plant: { kind: "hard", zoom: 10 },
  ledger: { kind: "hard", zoom: 8 },
  returns: { kind: "cover", zoom: 4 },
  "odd-place": { kind: "cover", zoom: 4 },
  followed: { kind: "cover", zoom: 4 },
  startled: { kind: "cover", zoom: 6 },
  touring: { kind: "cover", zoom: 4 },
  "camera-shy": { kind: "cover", zoom: 4 },
  abandoned: { kind: "trace", zoom: 8 },
  "cut-off": { kind: "cover", zoom: 4 },
  "spill-off": { kind: "cover", zoom: 4 },
  "lost-off": { kind: "cover", zoom: 4 },
  call: { kind: "cover", zoom: 6 },
  "bare-hand": { kind: "trace", zoom: 8 },
  "clean-shirt": { kind: "trace", zoom: 8 },
  "their-bag": { kind: "cover", zoom: 8 },
  dark: { kind: "cover", zoom: 4 },
};

/**
 * The verbs of innocents' notables that look like a tell: the innocent twins. Coming out of a
 * bedroom (couples, a change after a spill, the wanderer's peek), hovering close (the creep), a
 * real cut, a real spill and a real search for a lost thing are the covers' (PR 4).
 */
export const TWIN_VERBS: ReadonlySet<Verb> = new Set<Verb>([
  "out-of-step",
  "camera-shy",
  "startled",
  "wrong-turn",
  "locked-door",
  "fumbled",
  "bandage-gone",
  "snooping",
  "left-bedroom",
  "hovering",
  "cut",
  "spill",
  "lost-thing",
]);

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
  /** Whose bag or coat it was going through (-1 none): only those who know it isn't the spy's read it. */
  whose: number;
}

export class Measure {
  readonly tells: Tell[] = [];
  /** Innocents' notables of a tell's verb, oldest first. */
  readonly twins: Array<{ t: number; who: number; verb: Verb }> = [];

  /** The spy gives a tell; the same one again while it still shows only keeps it showing. */
  tell(what: TellId, t: number, until: number, room: number, view: number, whose = -1): Tell {
    let last: Tell | undefined;
    for (let i = this.tells.length - 1; i >= 0 && !last; i--) if (this.tells[i]!.what === what) last = this.tells[i];
    if (last && last.until >= t && last.room === room) {
      last.until = Math.max(last.until, until);
      last.view = Math.max(last.view, view);
      return last;
    }
    const spec = TELLS[what];
    const x: Tell = { t, what, kind: spec.kind, room, view, zoom: spec.zoom, until, seenBy: [], whose };
    this.tells.push(x);
    return x;
  }

  /** A tell broken off: the last of its kind stops showing now. */
  end(what: TellId, t: number): void {
    for (let i = this.tells.length - 1; i >= 0; i--) {
      const x = this.tells[i]!;
      if (x.what !== what) continue;
      if (x.until > t) x.until = t;
      return;
    }
  }

  /** A guest's sighting of the spy picked up whatever tell shows on it now, that `reads` says they read (whose bag it is, what holds their eyes). */
  seen(by: number, t: number, reads?: (x: Tell) => boolean): void {
    // Only the last few can still show.
    for (let i = this.tells.length - 1; i >= Math.max(0, this.tells.length - 8); i--) {
      const x = this.tells[i]!;
      if (x.kind === "trace" || x.t > t || t > x.until || x.seenBy.includes(by) || (reads && !reads(x))) continue;
      x.seenBy.push(by);
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

/** Someone's place among everyone the crowd suspects, by the same measure (1 the most, sharing a place with any as suspected; 0 when they're not at the party), and their score. */
export function rankOf(people: readonly Person[], memory: Memory, ident: Ident, t: number, id: number): { rank: number; score: number } {
  const all = ranks(people, memory, ident, t, people.length);
  const me = all.find((r) => r.id === id);
  return me ? { rank: 1 + all.filter((r) => r.score > me.score).length, score: me.score } : { rank: 0, score: 0 };
}
