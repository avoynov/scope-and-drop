/**
 * The spy's invariant monitors (milestone 3 technical plan: Tests and the sweep). Not a test
 * itself: the spy tests and the sweep share it. `watch()` runs an evening one step at a time and
 * asks each check after every step, so a failure names the moment to open in the lab. Each pull
 * request adds the checks for its part; PR 1 has the exit, the programme and staying sober.
 * `watchSpy()` runs an evening under them all and measures it, for the tests and the sweep alike.
 */
import { PARTY_LENGTH, phaseIndexAt } from "../src/party/clock";
import { SURE } from "../src/party/ident";
import { LAST_TOAST } from "../src/party/mind";
import { HURRY_OUT, type Party } from "../src/party/sim";
import type { CueHow, GoalKind, SpySetup } from "../src/party/spy";
import type { TellId } from "../src/party/spy/measure";

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

/** How long after a change the spy may act on it at the soonest: never with the change itself. */
export const PROGRAMME_MIN = 60;

/**
 * Programme: following its cues it is never on a phase before the room is, nor within a minute of
 * the change. Each time it moves on, `shares` gets the share of the other guests in its room
 * already on that phase, which the tests average (after most of them, on average).
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
      if (k <= phaseIndexAt(party.programme, party.t - PROGRAMME_MIN) || told.has(k)) return null;
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

/** Every check PR 1 has, fresh for one evening. */
export function spyChecks(): { exit: Check; programme: ReturnType<typeof programmeCheck>; sober: Check; all: Check[] } {
  const exit = exitCheck();
  const programme = programmeCheck();
  const sober = soberCheck();
  return { exit, programme, sober, all: [exit, programme, sober] };
}

/** What one watched evening gave, in plain numbers (in-game seconds after 19:00 unless said). */
export interface SpyEvening {
  setup: SpySetup;
  goal: GoalKind;
  theft: boolean;
  garment: boolean;
  broken: Broken[];
  /** Each change it acted on: the phase, how it caught it, the wait from catching to acting, and how long after the phase began it acted. */
  cues: Array<{ phase: string; how: CueHow; wait: number; after: number }>;
  /** Share of the other guests in its room already on each phase it moved on to. */
  shares: number[];
  arrivedAt: number;
  byeAt: number;
  /** When it set off home, and the share of the farewell's leavers already on their way out then; when it was gone, and the share of them gone before it; why it went (its goal done, or given up). */
  goingAt: number;
  goingShare: number;
  leftAt: number;
  leftShare: number;
  exitWhy: string | null;
  tipsyMax: number;
  drinks: number;
  /** The evening's reactions to anyone out of step, and those the spy drew. */
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
  /** Wall time of the evening (ms), monitors included. */
  ms: number;
}

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
  let leftAt = -1;
  let leftShare = -1;
  let before = 0;
  /** The guests still here at the farewell's first goodbye (the household aside). */
  let stayers: number[] | null = null;
  let sure = false;
  const notes: Check = {
    name: "notes",
    step(p) {
      const me = spy.record;
      tipsyMax = Math.max(tipsyMax, me.tipsy);
      if (!stayers && p.byeAt >= 0) stayers = p.people.filter((q) => q.id !== spy.id && !q.staff && q.role !== "host" && !p.memory.household[q.id] && !q.gone).map((q) => q.id);
      if (goingAt < 0 && p.byeAt >= 0) {
        if (me.gone || me.action?.id === "leave" || p.tasks.of(me)?.kind === "leave") {
          goingAt = p.t;
          goingShare = before;
        } else before = p.farewellGoing();
      }
      if (leftAt < 0 && me.gone) {
        leftAt = p.t;
        const f = stayers ?? [];
        leftShare = f.length ? f.filter((i) => p.people[i]!.gone).length / f.length : 0;
      }
      if (!sure && spy.victim >= 0 && p.t >= lastToast && p.t < lastToast + 1) sure = p.people.some((q) => q.id !== spy.id && p.ident.doubtOf(q.id, spy.id, p.t) >= SURE);
      return null;
    },
  };
  const broken = watch(party, [...checks.all, notes, ...also]);
  const ms = performance.now() - t0;
  const ev = party.events;
  const prog = party.programme;
  const dinner = prog.find((p) => p.id === "dinner")!;
  return {
    setup: spy.setup,
    goal: spy.goal.kind,
    theft: !!spy.goal.first,
    garment: !!spy.garment,
    broken,
    cues: spy.cues.log.filter((c) => c.how !== "start").map((c) => ({ phase: prog[c.phase]!.id, how: c.how, wait: c.acted - c.caught, after: c.acted - prog[c.phase]!.start })),
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
    drawn: ev.filter((e) => e.kind === "react" && e.actors[1] === spy.id).length,
    tells: spy.measure.tells.map((x) => ({ what: x.what, t: x.t, seen: x.seenBy.length > 0, view: x.view })),
    twins: spy.measure.twins.length,
    tested: spy.victim >= 0 && ev.some((e) => e.kind === "test" && e.actors[1] === spy.id && e.t <= dinner.end),
    sure,
    ms,
  };
}
