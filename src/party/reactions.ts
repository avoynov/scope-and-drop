/**
 * How people react to someone out of step with the programme, or fumbling what they do well
 * (milestone 3 technical plan: How people react). It sits outside the spy's folder because
 * innocents are late too, back from the bathroom or kept by an errand, and fumble now and then,
 * and get the same.
 *
 * Out of step: the one still not with the programme three minutes after a change (longer than
 * anyone's own lag) carries milestone 2's `out-of-step`; a partner or friend in view beckons them
 * in, and at dinner the host points the way. Someone in the toast's ring with nothing to raise is
 * brought a flute by the nearest waiter with a tray of them. Every 20 steps through the
 * champagne, the toast and dinner. When the one out of step knew the evening's ways (the host's
 * household), those who know them and see it doubt them a little.
 *
 * A fumble of what someone was known to do well (the senses report it from a look's detail): a
 * partner, family or a close friend does a double take and frowns, and half the time steps over
 * to help; a friend or acquaintance gives a puzzled second look and has a word about it later;
 * anyone else just glances. Asked for what they were known for and begging off (the spy dodging
 * its victim's skills): a shrug back, and from those closest the same ask again later.
 *
 * Each reaction is a gesture and a `react` event; the doubt itself is the ident's.
 */
import type { Rng } from "../mansion/core/rng";
import { phaseProgress, type Phase } from "./clock";
import { EXPECT, TIE_WEIGHT, type Ident } from "./ident";
import type { Memory, Verb } from "./memory";
import { SKILLS, type ActionId, type Gesture, type PartyEvent, type Person } from "./types";

/** Not with the programme this long after it changed, or after coming in (in-game s): longer than anyone's own lag (20 to 150 s). */
export const LATE = 180;
/** Glasses go up by this far into the toast (sim.ts RAISE); a flute brought later is no use. */
const RAISE_BY = 0.62;
/** What is with the programme, by phase. */
const WITH: Partial<Record<Phase["id"], readonly ActionId[]>> = { toast: ["toast", "champagne"], dinner: ["dinner"] };
/** Busy with something that can't be dropped: nobody calls them in. */
const EXCUSED: ReadonlySet<ActionId> = new Set(["toilet", "leave", "row", "arrive"]);
/** Doubt from seeing someone out of step who knew the evening's ways: this × tie weight. */
const OUT_OF_STEP = 0.08;
/** Fumbles a friend steps over to help with (taking the keys or the tray), and how long they stay by (in-game s). */
const HELP_WITH: ReadonlySet<number> = new Set([SKILLS.indexOf("keys"), SKILLS.indexOf("tray")]);
const HELP: readonly [number, number] = [5, 10];
/** Confidence of the word a friend has about a fumble ("is he all right?"). */
const PUZZLED = 0.6;
/** Turned down, those closest ask again this much later (in-game s). */
const ASK_AGAIN: readonly [number, number] = [10 * 60, 20 * 60];

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
  readonly ident: Ident;
  readonly memory: Memory;
  /** The record the spy lives in (-1 none): it keeps no programme but its cues, even playing the host. */
  readonly spyId: number;
  /** Whether a can leave what they're doing to step over to someone (free, not in a ritual or a task). */
  free(p: Person): boolean;
  /** a steps over beside b for a few seconds, to help. */
  helpOut(a: Person, b: Person, secs: number): boolean;
  /** Asked again for what they were known for (spy/answers.ts begs off again, or not). */
  askAgain(asker: Person, of: Person, skill: number): void;
  notable(p: Person, verb: Verb, obj: number, secs: number): void;
  gesture(p: Person, g: Gesture, secs: number): void;
  glance(p: Person, x: number, z: number, secs: number): void;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
}

export class Reactions {
  /** People found late (once a phase each), beckoned in, pointed the way in, brought a glass; fumbles frowned at, helped with, puzzled over; requests turned down and asked again. */
  readonly stats = { late: 0, beckons: 0, points: 0, glasses: 0, frowns: 0, helps: 0, puzzled: 0, shrugs: 0, asksAgain: 0 };
  /** Asks to come again: who, of whom, for what skill, and when; and every ask ever queued (each is asked again once). */
  private readonly again: Array<{ who: number; of: number; skill: number; at: number }> = [];
  private readonly askedAgain = new Set<string>();
  /** Draws for fumbles and begging off, apart from the programme's. */
  private readonly slips: Rng;
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
    this.slips = rng.fork("slips");
  }

  /** Every 20 steps: who is late or empty-handed, and who reacts; and asks due again. */
  step(): void {
    const h = this.host;
    if (this.again.length && this.again[0]!.at <= h.t) this.askDue();
    const k = h.phaseIndex;
    const ph = h.programme[k]!;
    if (ph.id !== "champagne" && ph.id !== "toast" && ph.id !== "dinner") return;
    for (const p of h.people) {
      // The real host keeps the programme; playing the host, the spy keeps only its cues, and can be late like anyone.
      if (!p.present || p.gone || p.staff || (p.role === "host" && p.id !== h.spyId)) continue;
      if (this.glassless(p, ph) && this.glassed[p.id] !== k) this.glass(p, k);
      if (!this.late(p, ph)) continue;
      if (this.lateIn[p.id] !== k) {
        this.lateIn[p.id] = k;
        this.stats.late++;
        if (h.memory.household[p.id]) this.knewBetter(p);
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

  /** Late, though they knew the evening's ways: whoever knows them and sees it doubts them a little. */
  private knewBetter(p: Person): void {
    const h = this.host;
    for (const q of h.people) {
      const tie = h.ident.tieOf(q.id, p.id);
      if (!tie || !q.present || q.gone || !h.canSee(q, p)) continue;
      h.ident.addDoubt(q.id, p.id, OUT_OF_STEP * TIE_WEIGHT[tie]!, h.t);
    }
  }

  /**
   * a caught b fumbling a skill (an index into SLIP_SKILLS) in a look's detail. Only a fumble of
   * what b was known to do well (EXPECT or more, to a) draws more than a glance: a double take
   * and a frown from a partner, family or close friend, who half the time steps over to help
   * with the keys or the tray (and leads, dancing with them); a puzzled second look from a friend
   * or acquaintance, and a word about it later. Explained (a bandage, a limp, drink they know
   * of), it's only a glance.
   */
  slip(a: Person, b: Person, skill: number, explained: boolean): void {
    const h = this.host;
    const tie = h.ident.tieOf(a.id, b.id);
    const known = !explained && tie >= 2 && h.ident.expected(a.id, b.id, skill) >= EXPECT;
    if (!known) return void (a.pose !== "walk" && h.glance(a, b.x, b.z, 1));
    if (tie >= 4) {
      h.glance(a, b.x, b.z, 1.5);
      h.gesture(a, "frown", 2);
      this.stats.frowns++;
      h.log("react", [a.id, b.id], a.room, "frown");
      if (!this.slips.chance(0.5)) return;
      const leading = a.action?.id === "dance" && b.action?.id === "dance" && (a.action.ref === b.id || b.action.ref === a.id);
      if (leading || (HELP_WITH.has(skill) && h.free(a) && h.helpOut(a, b, this.slips.range(HELP[0], HELP[1])))) {
        this.stats.helps++;
        h.log("react", [a.id, b.id], a.room, "help");
      }
      return;
    }
    h.glance(a, b.x, b.z, 2);
    this.stats.puzzled++;
    h.memory.learn(a.id, h.memory.fact("not-themselves", b.id, -1, b.room), PUZZLED, -1, 0);
    h.log("react", [a.id, b.id], a.room, "puzzled");
  }

  /**
   * b turned down what they were known for (`skill`), asked by `asker`; `by` are the others who
   * saw it. A shrug from each who knew them well enough to expect it, a look to someone else from
   * a partner, family or a close friend, and the asker, among those, asks again 10 to 20 minutes
   * later. The doubt is the ident's (half a slip's), added by the caller.
   */
  beggedOff(asker: Person, b: Person, skill: number, by: readonly Person[]): void {
    const h = this.host;
    for (const a of [asker, ...by]) {
      const tie = h.ident.tieOf(a.id, b.id);
      if (tie < 2 || h.ident.expected(a.id, b.id, skill) < EXPECT) continue;
      h.gesture(a, "shrug", 2);
      this.stats.shrugs++;
      h.log("react", [a.id, b.id], a.room, "shrug");
      if (tie < 4) continue;
      const other = h.people.find((q) => q !== a && q !== b && q.present && !q.gone && q.level === a.level && Math.hypot(q.x - a.x, q.z - a.z) < 4);
      if (other) h.glance(a, other.x, other.z, 1.5);
      const key = `${a.id}:${b.id}:${skill}`;
      if (a === asker && !this.askedAgain.has(key)) {
        this.askedAgain.add(key);
        this.again.push({ who: a.id, of: b.id, skill, at: h.t + this.slips.range(ASK_AGAIN[0], ASK_AGAIN[1]) });
        this.again.sort((x, y) => x.at - y.at);
      }
    }
  }

  /** Asks whose time has come: once, if the two are still about and in sight of each other. */
  private askDue(): void {
    const h = this.host;
    while (this.again.length && this.again[0]!.at <= h.t) {
      const x = this.again.shift()!;
      const a = h.people[x.who]!;
      const b = h.people[x.of]!;
      if (!a.present || a.gone || !b.present || b.gone || a.level !== b.level || Math.hypot(a.x - b.x, a.z - b.z) > 8 || !h.canSee(a, b)) continue;
      this.stats.asksAgain++;
      h.askAgain(a, b, x.skill);
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
