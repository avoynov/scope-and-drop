/**
 * How people react to someone out of step with the programme (milestone 3 technical plan: How
 * people react). It sits outside the spy's folder because innocents are late too, back from the
 * bathroom or kept by an errand, and get the same: the one still not with the programme three
 * minutes after a change (longer than anyone's own lag) carries milestone 2's `out-of-step`; a
 * partner or friend in view beckons them in, and at dinner the host points the way. Someone in
 * the toast's ring with nothing to raise is brought a flute by the nearest waiter with a tray of
 * them. Each reaction is a gesture and a `react` event; the doubt it can raise comes later
 * (milestone 3, PR 2).
 *
 * Every 20 steps through the champagne, the toast and dinner, with or without a spy.
 */
import type { Rng } from "../mansion/core/rng";
import { phaseProgress, type Phase } from "./clock";
import type { Verb } from "./memory";
import type { ActionId, Gesture, PartyEvent, Person } from "./types";

/** Not with the programme this long after it changed, or after coming in (in-game s): longer than anyone's own lag (20 to 150 s). */
export const LATE = 180;
/** Glasses go up by this far into the toast (sim.ts RAISE); a flute brought later is no use. */
const RAISE_BY = 0.62;
/** What is with the programme, by phase. */
const WITH: Partial<Record<Phase["id"], readonly ActionId[]>> = { toast: ["toast", "champagne"], dinner: ["dinner"] };
/** Busy with something that can't be dropped: nobody calls them in. */
const EXCUSED: ReadonlySet<ActionId> = new Set(["toilet", "leave", "row", "arrive"]);

/** What the reactions need from the party. */
export interface ReactionsHost {
  readonly t: number;
  readonly people: Person[];
  readonly programme: Phase[];
  /** The phase running now (the real programme). */
  readonly phaseIndex: number;
  readonly host: Person;
  /** Whether a can see b now, attention aside (the senses' own geometry). */
  canSee(a: Person, b: Person): boolean;
  /** Whether someone's task can't be dropped (leaving, the photo, a mishap, a drama, a habit, slipping away). */
  committedTask(p: Person): boolean;
  /** Whether someone would take a glass of champagne if offered. */
  wantsChampagne(p: Person): boolean;
  /** The nearest waiter with flutes left on the tray who is free to bring one, or null. */
  flutesFor(p: Person): Person | null;
  /** Send a waiter to stand beside someone with the tray for a while (false when there is no spot). */
  bringGlass(w: Person, q: Person, secs: number): boolean;
  /** Called in: drop what they're doing and think again (the spy takes it as a cue). */
  callIn(p: Person): void;
  notable(p: Person, verb: Verb, obj: number, secs: number): void;
  gesture(p: Person, g: Gesture, secs: number): void;
  glance(p: Person, x: number, z: number, secs: number): void;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
}

export class Reactions {
  /** People found late (once a phase each), beckoned in, pointed the way in, and brought a glass. */
  readonly stats = { late: 0, beckons: 0, points: 0, glasses: 0 };
  /** The phase in which each person was last found late, beckoned in, pointed the way, or brought a glass: each happens once a phase. */
  private readonly lateIn: Int16Array;
  private readonly beckoned: Int16Array;
  private readonly pointed: Int16Array;
  private readonly glassed: Int16Array;

  constructor(
    private readonly host: ReactionsHost,
    private readonly rng: Rng,
  ) {
    const n = host.people.length;
    this.lateIn = new Int16Array(n).fill(-1);
    this.beckoned = new Int16Array(n).fill(-1);
    this.pointed = new Int16Array(n).fill(-1);
    this.glassed = new Int16Array(n).fill(-1);
  }

  /** Every 20 steps: who is late or empty-handed, and who reacts. */
  step(): void {
    const h = this.host;
    const k = h.phaseIndex;
    const ph = h.programme[k]!;
    if (ph.id !== "champagne" && ph.id !== "toast" && ph.id !== "dinner") return;
    for (const p of h.people) {
      if (!p.present || p.gone || p.staff || p.role === "host") continue;
      if (this.glassless(p, ph) && this.glassed[p.id] !== k) this.glass(p, k);
      if (!this.late(p, ph)) continue;
      if (this.lateIn[p.id] !== k) {
        this.lateIn[p.id] = k;
        this.stats.late++;
      }
      h.notable(p, "out-of-step", -1, 12);
      if (this.beckoned[p.id] !== k) this.beckon(p, k);
      if (ph.id === "dinner" && this.pointed[p.id] !== k) this.point(p, k);
    }
  }

  /** Not with the programme three minutes after it changed (or after coming in), and not kept by something that can't be dropped. */
  late(p: Person, ph: Phase): boolean {
    const h = this.host;
    const withIt = WITH[ph.id];
    if (!withIt || h.t - Math.max(ph.start, p.arriveAt) < LATE) return false;
    const a = p.action;
    if (a && (withIt.includes(a.id) || EXCUSED.has(a.id) || (a.id === "task" && h.committedTask(p)))) return false;
    return true;
  }

  /** Nothing in hand when the glasses are wanted: in the toast's ring before the raise, or three minutes into the champagne. */
  private glassless(p: Person, ph: Phase): boolean {
    const h = this.host;
    if (p.held || !h.wantsChampagne(p)) return false;
    const a = p.action;
    if (ph.id === "toast") return a?.id === "toast" && a.startedAt !== null && phaseProgress(ph, h.t) < RAISE_BY;
    if (ph.id !== "champagne" || h.t - Math.max(ph.start, p.arriveAt) < LATE) return false;
    return !a || a.id === "mingle" || a.id === "toast" || a.id === "sit" || a.id === "art" || a.id === "wander" || a.id === "terrace";
  }

  /** The nearest waiter with flutes comes over with the tray. */
  private glass(p: Person, k: number): void {
    const h = this.host;
    const w = h.flutesFor(p);
    if (!w || !h.bringGlass(w, p, this.rng.range(12, 20))) return;
    this.glassed[p.id] = k;
    this.stats.glasses++;
    h.log("react", [w.id, p.id], p.room, "glass");
  }

  /** A partner or a friend who is with the programme and can see them beckons them in. */
  private beckon(p: Person, k: number): void {
    const h = this.host;
    const ph = h.programme[k]!;
    const withIt = WITH[ph.id] ?? [];
    for (const j of [...(p.partner !== null ? [p.partner] : []), ...p.friends]) {
      const q = h.people[j]!;
      const a = q.action;
      if (!q.present || q.gone || !a || !withIt.includes(a.id) || a.startedAt === null || !h.canSee(q, p)) continue;
      this.beckoned[p.id] = k;
      this.stats.beckons++;
      h.gesture(q, "beckon", 2);
      h.glance(q, p.x, p.z, 2);
      h.log("react", [q.id, p.id], q.room, "beckon");
      h.callIn(p);
      return;
    }
  }

  /** At dinner the host, seeing someone still not at the table, points the way in. */
  private point(p: Person, k: number): void {
    const h = this.host;
    const host = h.host;
    if (!host.present || host.gone || host === p || !h.canSee(host, p)) return;
    this.pointed[p.id] = k;
    this.stats.points++;
    h.gesture(host, "point", 2);
    h.glance(host, p.x, p.z, 2);
    h.log("react", [host.id, p.id], host.room, "point");
    h.callIn(p);
  }
}
