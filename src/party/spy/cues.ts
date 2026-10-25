/**
 * What the spy knows of the programme (milestone 3 technical plan: Following the programme).
 * It has no programme of its own: it catches each change from the host's announcement, if it
 * hears it, or from the room moving, if it sees three people acting on the new phase. Then it
 * follows with the crowd's tail: 60 to 150 s after an announcement it heard, 1.5 to 3 minutes
 * after it saw the room move. Someone beckoning it in is a cue too. Its phase only ever steps to
 * the one running and only on a cue, so it is never ahead of the room; out of earshot and out of
 * sight of everyone, it notices anyway after 20 minutes. Out of step (PR 4's habit), a change it
 * heard or saw waits 5 to 20 minutes, from the same one draw.
 */
import type { Rng } from "../../mansion/core/rng";
import { phaseIndexAt, type Phase, type PhaseId } from "../clock";
import type { ActionId, Person } from "../types";

/** How it caught a change: it came in on it, heard it, saw the room move, was beckoned, or noticed at last. */
export type CueHow = "start" | "heard" | "seen" | "told" | "late";

/** After an announcement it heard (in-game s): it moves with the crowd's tail (guests lag 20 to 150 s). */
export const DELAY_HEARD: readonly [number, number] = [60, 150];
/** After the room seen moving, having missed the announcement. */
export const DELAY_SEEN: readonly [number, number] = [90, 180];
/** Out of step: a change heard or seen (beckoned in, it still comes in DELAY_TOLD). */
export const DELAY_OUT: readonly [number, number] = [5 * 60, 20 * 60];
/** Beckoned in by someone, or the way pointed. */
export const DELAY_TOLD: readonly [number, number] = [5, 15];
/** People seen acting on the new phase that make the room seen moving. */
const SEEN_COUNT = 3;
/** Out of earshot and out of sight, it notices the change anyway after this long (in-game s). */
export const NOTICE = 20 * 60;

/**
 * What someone acting on a phase is seen doing: going for a flute or holding one, heading for
 * the toast's ring or standing in it, going in to dinner, on the floor, at the tables. A phase
 * with none of its own shows as the last one's ending.
 */
const SHOWS: Partial<Record<PhaseId, readonly ActionId[]>> = {
  champagne: ["champagne", "toast"],
  toast: ["toast", "champagne"],
  dinner: ["dinner"],
  dancing: ["dance"],
  games: ["games"],
  farewell: ["toast"],
};
const PROGRAMME_ACTS: ReadonlySet<ActionId> = new Set(["toast", "dinner", "dance", "games"]);

/** Whether someone is visibly acting on phase `k`: on it themselves, and doing what it calls for. */
export function onPhase(b: Person, k: number, programme: readonly Phase[]): boolean {
  if (b.staff || b.phaseSeen !== k) return false;
  const id = programme[k]!.id;
  if (id === "champagne" && b.held === "champagne") return true;
  const a = b.action;
  if (!a) return false;
  const shows = SHOWS[id];
  return shows ? shows.includes(a.id) : !PROGRAMME_ACTS.has(a.id);
}

/** What the cues need from the party. */
export interface CuesHost {
  readonly t: number;
  readonly programme: readonly Phase[];
  /** The announcement being made now: the phase it calls and where the host stands, or null. */
  announcing(): { phase: number; at: { level: number; x: number; z: number; room: number } } | null;
  /** Whether p would hear the announcement made at a point now (the sound model; it queues nothing). */
  wouldHear(at: { level: number; x: number; z: number; room: number }, p: Person): boolean;
  /** The spy acted on a new phase (for the log). */
  cued(k: number, how: CueHow): void;
}

/** One change caught and acted on, for the tests, the sweep and the lab's card. */
export interface CueRecord {
  phase: number;
  how: CueHow;
  /** When it caught the change, and when it acted on it (in-game s). */
  caught: number;
  acted: number;
  /** Caught out of step: the longer wait. */
  out: boolean;
}

/** A change caught and not yet acted on: the phase, when it will act on it, how and when it caught it. */
export interface Pending {
  phase: number;
  at: number;
  how: CueHow;
  caught: number;
  out: boolean;
}

export class Cues {
  /** The phase it acts on, since when, and how it caught it. */
  phase = 0;
  since = 0;
  how: CueHow = "start";
  /** The change caught and not yet acted on, and a newer one caught meanwhile, each on its own delay. */
  pending: Pending | null = null;
  next: Pending | null = null;
  /** Every change it acted on, oldest first. */
  readonly log: CueRecord[] = [];
  /** Who it has seen acting on the newest phase, and which phase that is. */
  private readonly seen = new Set<number>();
  private seenFor = -1;

  /** `slow`: whether it is out of step just now (the habit, scheduler.ts). */
  constructor(
    private readonly host: CuesHost,
    private readonly rng: Rng,
    private readonly slow: () => boolean = () => false,
  ) {}

  /** In at the door: it knows what anyone coming in would, the phase running for the slowest guest. */
  arrive(): void {
    const h = this.host;
    this.phase = phaseIndexAt(h.programme, h.t - DELAY_HEARD[1]);
    this.since = h.t;
    this.how = "start";
  }

  /** The newest phase it knows of, acted on or not. */
  get known(): number {
    return Math.max(this.phase, this.pending?.phase ?? -1, this.next?.phase ?? -1);
  }

  /** Once a step, while the spy is at the party: a delay running out, the announcement, or the late notice. */
  step(p: Person): void {
    const h = this.host;
    const t = h.t;
    // The newer change caught is acted on at its own time, even before the older one still waiting (out of step, that one waits
    // long): the room has moved on twice, and it goes straight to the newer.
    if (this.next && t >= this.next.at) {
      const c = this.next;
      this.pending = this.next = null;
      this.act(c);
    }
    while (this.pending && t >= this.pending.at) {
      const c = this.pending;
      this.pending = this.next;
      this.next = null;
      this.act(c);
    }
    const cur = phaseIndexAt(h.programme, t);
    if (cur <= this.known) return;
    const a = h.announcing();
    if (a && a.phase === cur && h.wouldHear(a.at, p)) return this.caught(cur, "heard");
    if (t - h.programme[cur]!.start >= NOTICE) {
      this.pending = this.next = null;
      this.act({ phase: cur, at: t, how: "late", caught: t, out: false });
    }
  }

  /** The spy saw someone: three on the newest phase are the room moving. */
  saw(b: Person): void {
    const h = this.host;
    const cur = phaseIndexAt(h.programme, h.t);
    if (cur <= this.known || !onPhase(b, cur, h.programme)) return;
    if (this.seenFor !== cur) {
      this.seenFor = cur;
      this.seen.clear();
    }
    this.seen.add(b.id);
    if (this.seen.size >= SEEN_COUNT) this.caught(cur, "seen");
  }

  /** Someone beckoned it in or pointed the way: it comes in a few seconds, or sooner than it meant to, straight to what is on now. */
  told(): void {
    const h = this.host;
    const cur = phaseIndexAt(h.programme, h.t);
    if (cur <= this.phase) return;
    let at = h.t + this.rng.range(DELAY_TOLD[0], DELAY_TOLD[1]);
    for (const c of [this.pending, this.next]) if (c && c.phase >= cur) at = Math.min(at, c.at);
    this.pending = { phase: cur, at, how: "told", caught: h.t, out: false };
    this.next = null;
  }

  /** A change caught: the delay it waits before acting on it, by how it was caught (out of step, longer). One caught while another waits is acted on after its own delay: once the first is, or first if it comes due first. */
  private caught(k: number, how: "heard" | "seen"): void {
    const t = this.host.t;
    const out = this.slow();
    const [lo, hi] = out ? DELAY_OUT : how === "heard" ? DELAY_HEARD : DELAY_SEEN;
    const c: Pending = { phase: k, at: t + this.rng.range(lo, hi), how, caught: t, out };
    if (this.pending) this.next = c;
    else this.pending = c;
  }

  private act(c: Pending): void {
    if (c.phase <= this.phase) return;
    const t = this.host.t;
    this.phase = c.phase;
    this.since = t;
    this.how = c.how;
    this.log.push({ phase: c.phase, how: c.how, caught: c.caught, acted: t, out: c.out });
    this.host.cued(c.phase, c.how);
  }
}
