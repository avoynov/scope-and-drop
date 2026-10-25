/**
 * The spy's invariant monitors (milestone 3 technical plan: Tests and the sweep). Not a test
 * itself: the spy tests and the sweep share it. `watch()` runs an evening one step at a time and
 * asks each check after every step, so a failure names the moment to open in the lab. Each pull
 * request adds the checks for its part; PR 1 has the exit, the programme and staying sober, PR 2
 * the tests, PR 3 the plan's privacy and steps, PR 4 the covers.
 * `watchSpy()` runs an evening under them all and measures it, for the tests and the sweep alike.
 */
import { PARTY_LENGTH, phaseIndexAt } from "../src/party/clock";
import { LAST_TOAST } from "../src/party/mind";
import { HURRY_OUT, STEP, type Party } from "../src/party/sim";
import type { CueHow, GoalKind, SpySetup } from "../src/party/spy";
import { DELAY_TOLD } from "../src/party/spy/cues";
import type { ActId } from "../src/party/spy/goals";
import type { Habits } from "../src/party/spy/habits";
import { ranks, TELLS, type TellId } from "../src/party/spy/measure";
import { ACTION_BY_ID, F, factNames, type PlanActionId } from "../src/party/spy/planner";
import { held } from "../src/party/spy/privacy";
import { COVERS, MAX_ON, MAX_TOTAL, OFF, ON, PICTURE_OFF, type Cover } from "../src/party/spy/scheduler";
import type { Tactics } from "../src/party/spy/tactics";

/** What broke, which check saw it, and when (in-game s after 19:00). */
export interface Broken {
  check: string;
  t: number;
  what: string;
}

export interface Check {
  readonly name: string;
  /** After every step: what broke just now, or null. */
  step(party: Party): string | null;
  /** At the end of the evening: what broke over it, or null. */
  end?(party: Party): string | null;
}

/** Run the evening to `until`, one step at a time, asking every check after each. */
export function watch(party: Party, checks: readonly Check[], until = PARTY_LENGTH): Broken[] {
  const out: Broken[] = [];
  while (!party.over && party.t < until) {
    party.step();
    for (const c of checks) {
      const what = c.step(party);
      if (what) out.push({ check: c.name, t: party.t, what });
    }
  }
  if (party.over) {
    for (const c of checks) {
      const what = c.end?.(party);
      if (what) out.push({ check: c.name, t: party.t, what });
    }
  }
  return out;
}

/** Exit: the spy is at the party until the farewell's first goodbye (in the last hurry it goes anyway), and gone by the end. */
export function exitCheck(): Check {
  let told = false;
  return {
    name: "exit",
    step(party) {
      const spy = party.spy;
      if (!spy || told || !spy.record.gone) return null;
      told = true;
      if (party.t >= PARTY_LENGTH - HURRY_OUT) return null;
      return party.byeAt < 0 ? "gone before anyone said goodbye in the farewell" : party.byeAt > party.t ? "gone before the first goodbye" : null;
    },
    end(party) {
      return party.spy && !party.spy.record.gone ? "still at the party at the end" : null;
    },
  };
}

/** How long after a change the spy may act on it at the soonest: never with the change itself. Playing the host, it goes a few seconds after its own announcement. */
export const PROGRAMME_MIN = 60;

/**
 * Programme: following its cues it is never on a phase before the room is, nor within a minute of
 * the change (playing the host, the change is its own announcement, made late at the household's
 * prompt, and it follows it 5 to 15 s later). Each time it moves on, `shares` gets the share of the
 * other guests in its room already on that phase, which the tests average (after most of them, on
 * average).
 */
export function programmeCheck(): Check & { shares: number[] } {
  const told = new Set<number>();
  let seen = 0;
  const shares: number[] = [];
  return {
    name: "programme",
    shares,
    step(party) {
      const spy = party.spy;
      if (!spy || !spy.byCues) return null;
      const p = spy.record;
      if (!p.present || p.gone) return null;
      const log = spy.cues.log;
      for (; seen < log.length; seen++) {
        const c = log[seen]!;
        const others = party.people.filter((q) => q !== p && q.present && !q.gone && !q.staff && q.level === p.level && q.room === p.room);
        if (others.length >= 2) shares.push(others.filter((q) => q.phaseSeen >= c.phase).length / others.length);
      }
      const k = spy.phase;
      const soonest = spy.setup === "host" ? DELAY_TOLD[0] : PROGRAMME_MIN;
      if (k <= phaseIndexAt(party.programme, party.t - soonest) || told.has(k)) return null;
      told.add(k);
      const ph = party.programme[k]!;
      return `on ${ph.id} ${Math.round(party.t - ph.start)} s after it began`;
    },
  };
}

/** Under this tipsiness all evening. */
export const SOBER = 0.25;

/** Sober: its tipsiness stays under 0.25, and it never leads a drama or faints. */
export function soberCheck(): Check {
  let told = false;
  return {
    name: "sober",
    step(party) {
      const spy = party.spy;
      if (!spy || told || spy.record.tipsy < SOBER) return null;
      told = true;
      return `tipsy ${spy.record.tipsy.toFixed(2)}`;
    },
    end(party) {
      const spy = party.spy;
      if (!spy) return null;
      const led = party.dramas.episodes.filter((e) => e.cast[0] === spy.id && (e.kind === "drama" || (e.kind === "mishap" && e.what === "faint")));
      return led.length ? `led ${led.map((e) => e.what).join(", ")}` : null;
    },
  };
}

/**
 * Tests (PR 2): nobody but the spy fails or bluffs a friendly test. Someone drunk may fumble one,
 * and passes the next the same person puts to them. Holds with or without a spy.
 */
export function testsCheck(): Check {
  let seen = 0;
  const fumbled = new Set<string>();
  return {
    name: "tests",
    step(party) {
      const ev = party.events;
      while (seen < ev.length) {
        const e = ev[seen++]!;
        if (e.kind !== "test") continue;
        const [i, j] = e.actors as [number, number];
        if (j === party.spyId) continue;
        const key = `${i}:${j}`;
        if (e.note === "failed" || e.note === "bluffed") return `${j} ${e.note} a test by ${i}`;
        if (e.note !== "fumbled") fumbled.delete(key);
        else if (fumbled.has(key)) return `${j} fumbled a second test by ${i}`;
        else fumbled.add(key);
      }
      return null;
    },
  };
}

/**
 * The spy's notes as it makes them: the party's `log` wrapped, so a check hears each `spy` event in
 * the call that logs it, with the world exactly as the spy saw it then. By the end of the step a
 * glance at a sound can have turned a head.
 */
function onSpyNote(party: Party, fn: (note: string) => void): void {
  const log = party.log.bind(party);
  party.log = (kind, actors, room, note) => {
    log(kind, actors, room, note);
    if (kind === "spy" && note) fn(note);
  };
}

/** A check that listens to the spy's notes from its first step on (nothing it does before 19:20 needs one). */
function noteCheck(name: string, hear: (party: Party, note: string, out: string[]) => void): Check {
  let hooked: Party | null = null;
  const out: string[] = [];
  return {
    name,
    step(party) {
      if (!party.spy) return null;
      if (hooked !== party) {
        hooked = party;
        onSpyNote(party, (note) => hear(party, note, out));
      }
      return out.length ? out.splice(0).join("; ") : null;
    },
  };
}

/**
 * Privacy (PR 3): the moment an act that waits for its moment begins, nobody who counts can see
 * it by the senses' own answer (`canSee`), apart from the privacy check's geometry. Who counts is
 * the plan's: for an act done alone, anyone present (but a kill's target, whose spot it is);
 * unwatched, anyone not held by the toast, the speech, the piano or the floor, the owner of the
 * things always, for a bag or a coat only those who'd know whose it is, and for a hand at a pocket
 * or the mantel only those within the detail of a look.
 */
export function privacyCheck(): Check {
  return noteCheck("privacy", (party, note, out) => {
    const alone = note.startsWith("alone:");
    if (!alone && !note.startsWith("risky:")) return;
    const spy = party.spy!;
    const act = alone ? null : (note.slice(6) as ActId);
    const spec = act ? spy.things.spec(act) : null;
    const mode = spec ? spec.mode : "alone";
    if (!mode) return;
    const p = spy.record;
    // The spot asked about: where the act is done, or where the target stands.
    const at = alone ? party.people[spy.goal.target]! : p;
    const owner = act === "bag" || act === "coat" ? spy.goal.target : -1;
    const knows = owner >= 0 ? spy.things.knowsWhose(owner) : null;
    for (const q of party.people) {
      if (q === p || q === at || !q.present || q.gone) continue;
      if (knows && !knows(q)) continue;
      if (mode === "unwatched" && q.id !== owner && held(party, q)) continue;
      if (spec?.within !== undefined && (q.level !== at.level || Math.hypot(q.x - at.x, q.z - at.z) > spec.within)) continue;
      if (party.senses.canSee(q, at)) out.push(`${q.id} could see it as it began ${act ?? "alone with its target"}`);
    }
  });
}

/** What the plan's moves that fold into the step they lead to bring: there, the moment, the target close. */
const FOLDED = F.there | F.unwatched | F.close;

/**
 * Steps (PR 3): each step of the plan starts with its needs holding, by the facts as the spy sees
 * them then (goals.ts): a step as it sets off, but for what the moves folded into it bring (going
 * there, the room looking away, coming close to the target); an act as it begins, but for the
 * moment the privacy check has just found. A kill's target is never followed while its theft
 * first is on, and a goal is done only with its facts holding.
 */
export function stepsCheck(): Check {
  return noteCheck("steps", (party, note, out) => {
    const spy = party.spy!;
    const p = spy.record;
    const things = spy.things;
    const ctx = things.context(p);
    const needs = (a: PlanActionId) => ctx.needs[a] ?? ACTION_BY_ID.get(a)!.needs;
    const lacking = (want: number) => factNames(want & ~things.facts(p, ctx)).join(", ");
    const [kind, what, end] = note.split(":");
    if (kind === "task" && end === undefined && ACTION_BY_ID.has(what as PlanActionId)) {
      const a = what as PlanActionId;
      if (a === "follow" && things.firstOn(p)) out.push("followed its target with the theft first still on");
      const m = lacking(needs(a) & ~FOLDED);
      if (m) out.push(`set off on ${a} without ${m}`);
    } else if (kind === "risky") {
      const a = spy.plans.current?.action;
      const m = a ? lacking(needs(a) & ~F.unwatched) : "";
      if (!a) out.push(`began ${what} with no step under way`);
      else if (m) out.push(`began ${a} without ${m}`);
    } else if (kind === "alone") {
      if (things.firstOn(p)) out.push("alone with its target with the theft first still on");
      const m = lacking(needs("wait-alone"));
      if (m) out.push(`alone with its target without ${m}`);
    } else if (kind === "done") {
      const m = lacking(ctx.goal);
      if (m) out.push(`goal done without ${m}`);
    }
  });
}

/** Whether a cover counts against the caps: not one the options hold on, nor keeping out of the picture while the spy plays someone. */
const capped = (spy: NonNullable<Party["spy"]>, c: Cover): boolean => !spy.covers.state[COVERS.indexOf(c)]!.forced && !(c === "out-of-picture" && spy.playing);

/**
 * Covers (PR 4): each comes on for 10 to 40 minutes, less only when its 90 minutes in all run out
 * or the spy goes home, and then stays off at least 15 (keeping out of the picture while it plays
 * someone, at least 5); never more than three are on at once, none before it arrives, and none for
 * more than 90 minutes in all. A cover the options hold on is on from its arrival until it goes,
 * and keeping out of the picture while it plays someone is outside the caps.
 */
export function coversCheck(): Check {
  let told = false;
  return {
    name: "covers",
    step(party) {
      const spy = party.spy;
      if (!spy || told) return null;
      const on = spy.covers.list.filter((c) => capped(spy, c));
      if (on.length <= MAX_ON) return null;
      told = true;
      return `${on.length} on at once: ${on.join(", ")}`;
    },
    end(party) {
      const spy = party.spy;
      if (!spy) return null;
      const ev = party.events;
      const arrived = ev.find((e) => e.kind === "spy" && e.note?.startsWith("arrive"))?.t ?? -1;
      const left = ev.find((e) => e.kind === "leave" && e.actors[0] === spy.id)?.t ?? party.t;
      const mins = (s: number) => (s / 60).toFixed(1);
      const out: string[] = [];
      for (const c of COVERS) {
        const spells = spy.covers.spells.filter((x) => x.cover === c).map((x) => ({ from: x.from, to: x.to < 0 ? party.t : x.to }));
        if (spy.covers.state[COVERS.indexOf(c)]!.forced) {
          const x = spells[0];
          if (spells.length !== 1 || x!.from !== arrived || x!.to !== left) out.push(`${c}, held on, on ${spells.map((y) => `${mins(y.from)} to ${mins(y.to)}`).join(", ")} min`);
          continue;
        }
        const caps = capped(spy, c);
        let total = 0;
        let last = -1;
        for (const x of spells) {
          const len = x.to - x.from;
          total += len;
          if (x.from < arrived) out.push(`${c} on at ${mins(x.from)} min, before it arrived`);
          if (last >= 0 && x.from - last < (caps ? OFF[0] : PICTURE_OFF[0]) - STEP) out.push(`${c} off only ${mins(x.from - last)} min at ${mins(last)}`);
          if (len > ON[1] + STEP) out.push(`${c} on ${mins(len)} min from ${mins(x.from)}`);
          else if (len < ON[0] - STEP && x.to !== left && !(caps && total >= MAX_TOTAL - STEP)) out.push(`${c} on only ${mins(len)} min from ${mins(x.from)}`);
          last = x.to;
        }
        if (caps && total > MAX_TOTAL + STEP) out.push(`${c} on ${mins(total)} min in all`);
      }
      return out.length ? out.join("; ") : null;
    },
  };
}

/** Every check so far (PR 1: the exit, the programme, staying sober; PR 2: tests; PR 3: privacy and steps; PR 4: covers), fresh for one evening. */
export function spyChecks(): {
  exit: Check;
  programme: ReturnType<typeof programmeCheck>;
  sober: Check;
  tests: Check;
  privacy: Check;
  steps: Check;
  covers: Check;
  all: Check[];
} {
  const exit = exitCheck();
  const programme = programmeCheck();
  const sober = soberCheck();
  const tests = testsCheck();
  const privacy = privacyCheck();
  const steps = stepsCheck();
  const covers = coversCheck();
  return { exit, programme, sober, tests, privacy, steps, covers, all: [exit, programme, sober, tests, privacy, steps, covers] };
}

/** The reactions to someone out of step (PR 1): brought a flute, beckoned in, pointed the way. */
const CALLED_IN: ReadonlySet<string> = new Set(["glass", "beckon", "point"]);

/** What one watched evening gave, in plain numbers (in-game seconds after 19:00 unless said). */
export interface SpyEvening {
  setup: SpySetup;
  goal: GoalKind;
  theft: boolean;
  garment: boolean;
  broken: Broken[];
  /** Each change it acted on: the phase, how it caught it (and whether out of step), the wait from catching to acting, and how long after the phase began it acted. */
  cues: Array<{ phase: string; how: CueHow; out: boolean; wait: number; after: number }>;
  /** Share of the other guests in its room already on each phase it moved on to. */
  shares: number[];
  arrivedAt: number;
  byeAt: number;
  /**
   * When it set off home, and the share of the farewell's leavers already on their way out then
   * (playing the host, the share it had seen off: nobody gets past it without its goodbye, so all
   * of them can be on their way, waiting on it, while a mishap holds it up); when it was gone, and
   * the share of them gone before it; why it went (its goal done, or given up).
   */
  goingAt: number;
  goingShare: number;
  leftAt: number;
  leftShare: number;
  exitWhy: string | null;
  tipsyMax: number;
  drinks: number;
  /** The evening's reactions to anyone out of step, and those of them the spy drew. */
  late: number;
  beckons: number;
  points: number;
  flutes: number;
  drawn: number;
  tells: Array<{ what: TellId; t: number; seen: boolean; view: number }>;
  twins: number;
  /** Playing someone: tested by the end of dinner, and someone sure of it by the last toast. */
  tested: boolean;
  sure: boolean;
  /** Seen through (PR 2). The tests put to the spy all evening and what they came to. */
  spyTests: { bluffed: number; failed: number };
  /** Those sure it wasn't who it seemed, and what they did: had it out loud, backed away and told someone, or kept silent; notes compared about it. */
  sureOfSpy: number;
  outLoud: number;
  told: number;
  silent: number;
  compared: number;
  /** Doubt from its skill and manner: slips that added doubt, cool greetings, names it didn't know, requests it begged off. */
  slips: number;
  cool: number;
  names: number;
  begOffs: number;
  /** Innocents: people sure of someone else, and someone else confronted out loud. */
  innocentSure: number;
  innocentConfronted: number;
  /** Changes the host was prompted at (late or ahead), tours asked of the host and turned down, and guests who found the garment. */
  prompts: number;
  tourAsks: number;
  toursRefused: number;
  finds: number;
  /**
   * Its plan (PR 3): when it first tried and when its goal was done (-1 not), whether a kill's plan
   * got its target alone, and its steps started, done, broken off and failed, and the tries that
   * found no moment.
   */
  triedAt: number;
  doneAt: number;
  alone: boolean;
  plan: { started: number; done: number; broken: number; failed: number; tries: number };
  /** When what it took first went into its coat, when a kill's theft first was dropped, and when it first set off after a kill's target (-1 never). */
  stashedAt: number;
  droppedAt: number;
  followedAt: number;
  /** The cases the crowd opened over its work (something missed, a bug found), and its place among the ten most suspected as it set off home (0: not among them). */
  traces: number;
  rankAtGo: number;
  /**
   * Its covers (PR 4): each one's spells and minutes on in all, the habits' and tactics' doings,
   * and how often it felt watched (a wary glance, a test it failed, a circle hushed as it joined).
   */
  covers: Record<Cover, { spells: number; mins: number }>;
  habits: Habits["stats"];
  tactics: Tactics["stats"];
  watched: { glances: number; tests: number; hushes: number };
  /** The share of its time at the party it spent lying low (its habits paused, no risky step started). */
  lowShare: number;
  /** Wall time of the evening (ms), monitors included. */
  ms: number;
}

/** What the crowd says on finding the spy's work, each opening a case: the papers or the phone gone, the statuette missed, a bug. */
const TRACES: ReadonlySet<string> = new Set(["gone:papers", "gone:phone", "statuette-gone", "bug"]);

/** When the spy first noted something (-1 never). */
const spyNote = (ev: Party["events"], note: string): number => ev.find((e) => e.kind === "spy" && e.note === note)?.t ?? -1;

/** A tell only the spy gives (PR 3's acts). */
export const isHard = (what: TellId): boolean => TELLS[what].kind === "hard";

/** Run an evening with a spy to the end under every monitor (and `also`), and measure it. */
export function watchSpy(party: Party, also: readonly Check[] = []): SpyEvening {
  const t0 = performance.now();
  const spy = party.spy!;
  const farewell = party.programme.find((p) => p.id === "farewell")!;
  const lastToast = farewell.start + LAST_TOAST * (farewell.end - farewell.start);
  const checks = spyChecks();
  let tipsyMax = 0;
  let goingAt = -1;
  let goingShare = -1;
  let rankAtGo = 0;
  let leftAt = -1;
  let leftShare = -1;
  let before = 0;
  /** The guests still here at the farewell's first goodbye (the household aside). */
  let stayers: number[] | null = null;
  /** Playing the host, those it has said goodbye to since then. */
  const seenOff = new Set<number>();
  let read = 0;
  let here = 0;
  let low = 0;
  const notes: Check = {
    name: "notes",
    step(p) {
      const me = spy.record;
      tipsyMax = Math.max(tipsyMax, me.tipsy);
      if (me.present && !me.gone) {
        here++;
        if (p.t < spy.answers.lowUntil) low++;
      }
      if (!stayers && p.byeAt >= 0) stayers = p.people.filter((q) => q.id !== spy.id && !q.staff && q.role !== "host" && !p.memory.household[q.id] && !q.gone).map((q) => q.id);
      if (goingAt < 0 && p.byeAt >= 0) {
        for (; read < p.events.length; read++) {
          const e = p.events[read]!;
          if (e.kind === "goodbye" && e.t >= p.byeAt) for (const a of e.actors) if (a !== me.id) seenOff.add(a);
        }
        if (me.gone || me.action?.id === "leave" || p.tasks.of(me)?.kind === "leave") {
          goingAt = p.t;
          goingShare = before;
          rankAtGo = ranks(p.people, p.memory, p.ident, p.t).findIndex((r) => r.id === me.id) + 1;
        } else if (spy.setup !== "host") before = p.farewellGoing();
        else {
          const f = stayers ?? [];
          before = f.length ? f.filter((i) => seenOff.has(i) || p.people[i]!.gone).length / f.length : 0;
        }
      }
      if (leftAt < 0 && me.gone) {
        leftAt = p.t;
        const f = stayers ?? [];
        leftShare = f.length ? f.filter((i) => p.people[i]!.gone).length / f.length : 0;
      }
      return null;
    },
  };
  const broken = watch(party, [...checks.all, notes, ...also]);
  const ms = performance.now() - t0;
  const ev = party.events;
  const prog = party.programme;
  const dinner = prog.find((p) => p.id === "dinner")!;
  const me = spy.id;
  const challenge = (note: string, about: (e: (typeof ev)[number]) => boolean) => ev.filter((e) => e.kind === "challenge" && e.note === note && about(e)).length;
  const ofSpy = (e: (typeof ev)[number]) => e.actors[1] === me;
  const toldOf = (e: (typeof ev)[number]) => e.actors[2] === me;
  return {
    setup: spy.setup,
    goal: spy.goal.kind,
    theft: !!spy.goal.first,
    garment: !!spy.garment,
    broken,
    cues: spy.cues.log.filter((c) => c.how !== "start").map((c) => ({ phase: prog[c.phase]!.id, how: c.how, out: c.out, wait: c.acted - c.caught, after: c.acted - prog[c.phase]!.start })),
    shares: checks.programme.shares,
    arrivedAt: ev.find((e) => e.kind === "spy" && e.note?.startsWith("arrive"))?.t ?? 0,
    byeAt: party.byeAt,
    goingAt,
    goingShare,
    leftAt,
    leftShare,
    exitWhy: spy.exit.why,
    tipsyMax,
    drinks: spy.record.drinkLog.length,
    late: party.stats.late,
    beckons: party.stats.beckons,
    points: party.stats.points,
    flutes: party.stats.flutes,
    drawn: ev.filter((e) => e.kind === "react" && e.actors[1] === spy.id && CALLED_IN.has(e.note ?? "")).length,
    tells: spy.measure.tells.map((x) => ({ what: x.what, t: x.t, seen: x.seenBy.length > 0, view: x.view })),
    twins: spy.measure.twins.length,
    tested: spy.victim >= 0 && ev.some((e) => e.kind === "test" && e.actors[1] === spy.id && e.t <= dinner.end),
    sure: spy.victim >= 0 && ev.some((e) => e.kind === "challenge" && e.note === "sure" && ofSpy(e) && e.t <= lastToast),
    spyTests: {
      bluffed: ev.filter((e) => e.kind === "test" && ofSpy(e) && e.note === "bluffed").length,
      failed: ev.filter((e) => e.kind === "test" && ofSpy(e) && e.note === "failed").length,
    },
    sureOfSpy: challenge("sure", ofSpy),
    outLoud: challenge("out-loud", ofSpy),
    told: challenge("told", toldOf),
    silent: challenge("silent", ofSpy),
    compared: challenge("compare", toldOf),
    slips: party.stats.slips,
    cool: ev.filter((e) => e.kind === "react" && e.note === "cool" && ofSpy(e)).length,
    names: party.ident.stats.names,
    begOffs: ev.filter((e) => e.kind === "spy" && e.note?.startsWith("beg-off")).length,
    innocentSure: challenge("sure", (e) => !ofSpy(e)),
    innocentConfronted: challenge("out-loud", (e) => !ofSpy(e)),
    prompts: party.stats.prompts,
    tourAsks: party.stats.tourAsks,
    toursRefused: ev.filter((e) => e.kind === "react" && e.note === "later").length,
    finds: party.stats.finds,
    triedAt: spy.goal.triedAt ?? -1,
    doneAt: spy.goal.doneAt ?? -1,
    alone: ev.some((e) => e.kind === "spy" && e.note?.startsWith("alone:")),
    plan: { ...spy.plans.stats },
    stashedAt: spyNote(ev, "stashed"),
    droppedAt: spyNote(ev, "drop-first"),
    followedAt: spyNote(ev, "task:follow"),
    traces: ev.filter((e) => e.kind === "react" && TRACES.has(e.note ?? "")).length,
    rankAtGo,
    covers: Object.fromEntries(
      COVERS.map((c) => {
        const spells = spy.covers.spells.filter((x) => x.cover === c);
        return [c, { spells: spells.length, mins: spells.reduce((s, x) => s + (x.to < 0 ? party.t : x.to) - x.from, 0) / 60 }];
      }),
    ) as SpyEvening["covers"],
    habits: { ...spy.habits.stats },
    tactics: { ...spy.tactics.stats },
    watched: { glances: spy.covers.stats.glances, tests: spy.covers.stats.tests, hushes: spy.answers.stats.hushes },
    lowShare: here ? low / here : 0,
    ms,
  };
}
