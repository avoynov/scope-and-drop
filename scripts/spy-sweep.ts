/**
 * The spy sweep (milestone 3 technical plan: Tests and the sweep): evenings with a spy in every
 * one, a third on each house size, nothing pinned, so arrivals and goals come as drawn. Child
 * processes share the evenings out across the machine's cores. Every evening runs the monitors
 * (tests/spy-watch.ts), and the plan's targets are printed beside what was measured. A miss on a
 * target is reported, not failed.
 *
 *   npx tsx scripts/spy-sweep.ts [n] [--check] [--json file]
 *
 * n evenings (60), seeds sweep-<size>-<i>; --check exits with an error if any monitor broke;
 * --json writes every evening's numbers to a file. `runEvenings()` is the runner, for tests too.
 */
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { generateMansion } from "../src/mansion";
import type { MansionSize } from "../src/mansion/core/types";
import { PARTY_LENGTH, TIME_SCALE } from "../src/party/clock";
import { Party } from "../src/party/sim";
import { COVERS, TELLS, type Cover, type HidePlace, type KillWhy, type SpyOptions, type SwapWhy, type TellId } from "../src/party/spy";
import { GOALS, SETUPS } from "../src/party/spy/cast";
import { isHard, watchSpy, type SpyEvening } from "../tests/spy-watch";

export const SIZES: readonly MansionSize[] = ["compact", "grand", "palatial"];

/** One evening to run: the house, its size and the party's seed (the house's by default), and anything pinned. */
export interface EveningSpec {
  house: string;
  size: MansionSize;
  party?: string;
  spy?: SpyOptions;
}

/** What one evening gave: its house, and what the monitors measured (tests/spy-watch.ts). */
export interface EveningResult extends SpyEvening {
  house: string;
  size: MansionSize;
}

/** One evening with a spy, watched by every monitor. */
export function runEvening(spec: EveningSpec): EveningResult {
  const bp = generateMansion({ seed: spec.house, size: spec.size });
  const party = new Party(bp, { seed: spec.party ?? spec.house, spy: spec.spy ?? {} });
  return { house: spec.house, size: spec.size, ...watchSpy(party) };
}

/** The sweep's evenings: n split evenly over the sizes, seeds sweep-<size>-<i>. */
export function sweepSpecs(n: number): EveningSpec[] {
  const out: EveningSpec[] = [];
  for (let i = 0; out.length < n; i++) for (const size of SIZES) if (out.length < n) out.push({ house: `sweep-${size}-${i}`, size });
  return out;
}

/** Run evenings across child processes, one a core (each loads tsx), results in the order given. */
export async function runEvenings(specs: readonly EveningSpec[], jobs = Math.min(availableParallelism(), specs.length)): Promise<EveningResult[]> {
  const out: EveningResult[] = new Array(specs.length);
  let next = 0;
  const file = fileURLToPath(import.meta.url);
  const one = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const child = fork(file, ["--evening"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
      const feed = () => {
        if (next >= specs.length) return void child.disconnect();
        const i = next++;
        child.send({ i, spec: specs[i] });
      };
      child.on("message", (m: { i: number; r: EveningResult }) => {
        out[m.i] = m.r;
        feed();
      });
      child.on("error", reject);
      child.on("exit", (code) => (code ? reject(new Error(`an evening's process exited with ${code}`)) : resolve()));
      feed();
    });
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, one));
  return out;
}

// ------------------------------------------------------------------ the report

/** The tells each cover gives. */
const COVER_TELLS: Record<Cover, readonly TellId[]> = {
  "out-of-step": ["out-of-step"],
  returns: ["returns"],
  "odd-places": ["followed", "odd-place"],
  startles: ["startled"],
  tours: ["touring"],
  "out-of-picture": ["camera-shy"],
  drops: ["abandoned"],
  alibi: ["cut-off", "bare-hand", "spill-off", "clean-shirt", "lost-off", "call"],
  "others-things": ["their-bag"],
  commotion: ["dark"],
  poison: ["dose", "bar-dose", "refused-tray", "fallen"],
  murder: ["embrace", "jab", "propped", "struggle", "drag", "body"],
};

/** Why it killed, why it took a place, and where a body went, in the report's order. */
const KILL_WHYS: readonly KillWhy[] = ["goal", "silence", "swap"];
const SWAP_WHYS: readonly SwapWhy[] = ["host", "friend", "face", "halfway"];
const HIDE_PLACES: readonly HidePlace[] = ["bath", "bathroom", "store", "bed", "wardrobe", "outside", "fell"];

const pct = (a: number, b: number): string => (b ? `${Math.round((100 * a) / b)}%` : "–");
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: readonly number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const span = (xs: readonly number[], f = (v: number) => v.toFixed(0)): string => (xs.length ? `${f(Math.min(...xs))} to ${f(Math.max(...xs))}` : "–");
/** In-game seconds as real minutes (the game runs three times as fast). */
const real = (s: number): number => s / TIME_SCALE / 60;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 60);
  const check = args.includes("--check");
  const json = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
  const specs = sweepSpecs(n);
  const t0 = performance.now();
  const rs = await runEvenings(specs);
  const secs = (performance.now() - t0) / 1000;
  if (json) writeFileSync(json, `${JSON.stringify(rs, null, 2)}\n`);
  for (const line of report(rs, secs)) console.log(line);
  const broken = rs.reduce((s, r) => s + r.broken.length, 0);
  if (check && broken) process.exitCode = 1;
}

/** The sweep's report: the evenings, the monitors, the plan's targets beside what was measured, then the details. */
export function report(rs: readonly EveningResult[], secs: number): string[] {
  const L: string[] = [];
  const n = rs.length;
  const jobs = Math.min(availableParallelism(), n);
  const sizes = SIZES.map((s) => `${rs.filter((r) => r.size === s).length} ${s}`).join(", ");
  L.push(`${n} evenings (${sizes}) in ${secs.toFixed(0)} s on ${jobs} cores`);
  L.push(`arrivals: ${SETUPS.map((s) => `${s} ${rs.filter((r) => r.setup === s).length}`).join(" · ")}`);
  const kills = rs.filter((r) => r.goal === "kill");
  L.push(`goals: ${GOALS.map((g) => `${g} ${rs.filter((r) => r.goal === g).length}`).join(" · ")} (kills stealing first ${pct(kills.filter((r) => r.theft).length, kills.length)})`);

  // The monitors.
  const broken = rs.flatMap((r) => r.broken.map((b) => ({ ...b, house: r.house })));
  L.push("");
  L.push(broken.length ? `monitors: ${broken.length} broke` : "monitors: all held");
  for (const b of broken.slice(0, 20)) L.push(`  ${b.house} ${b.check} at ${(b.t / 60).toFixed(1)} min: ${b.what}`);

  // The plan's targets.
  const playing = rs.filter((r) => r.setup !== "self");
  const firsts = rs
    .map((r) => r.tells.filter((x) => x.seen || x.view >= 0.5).map((x) => Math.max(0, x.t - r.arrivedAt)))
    .filter((xs) => xs.length)
    .map((xs) => real(Math.min(...xs)));
  const twinsRate = mean(rs.map((r) => r.twins / (real(PARTY_LENGTH) / 5)));
  const soft = mean(rs.map((r) => r.tells.filter((x) => TELLS[x.what].kind === "cover").length));
  // Its plan: every arrival plans (a waiter between its rounds), and a kill is done at its target's death.
  const others = rs.filter((r) => r.goal !== "kill");
  const self = rs.filter((r) => r.setup === "self");
  const dead = (r: EveningResult, why: KillWhy) => r.kills.filter((k) => k.why === why && k.out === "dead");
  const how = (rows: readonly EveningResult[], why: KillWhy) => {
    const ks = rows.flatMap((r) => dead(r, why));
    return `strangled ${ks.filter((k) => k.how === "strangled").length}, the needle ${ks.filter((k) => k.how === "injection").length}`;
  };
  const swapped = self.filter((r) => r.swap.at >= 0);
  const silenced = rs.filter((r) => dead(r, "silence").length > 0);
  const hardSeen = rs.filter((r) => r.tells.some((x) => isHard(x.what) && x.seen)).length;
  const hardPerch = rs.filter((r) => r.tells.some((x) => isHard(x.what) && x.view >= 0.5)).length;
  const traced = rs.filter((r) => r.traces > 0);
  const oneIn = (k: number) => (k ? `, 1 in ${(n / k).toFixed(1)}` : "");
  const rows: Array<[string, string, string]> = [
    [
      "The spy's goal done",
      "55 to 80% of evenings",
      `${pct(rs.filter((r) => r.doneAt >= 0).length, n)} of ${n} · kills ${kills.filter((r) => r.doneAt >= 0).length} of ${kills.length} (${how(kills, "goal")}) · the rest ${others.filter((r) => r.doneAt >= 0).length} of ${others.length}`,
    ],
    [
      "Coming as itself: a mid-party swap",
      "about 1 in 5",
      `${pct(swapped.length, self.length)} of ${self.length}${swapped.length ? ` (${SWAP_WHYS.map((w) => `${w} ${swapped.filter((r) => r.swap.why === w).length}`).join(", ")})` : ""}; gone wrong in ${self.filter((r) => r.swap.failed > 0).length}`,
    ],
    ["A lone doubter silenced", "rare", `${silenced.length} of ${n} evenings${oneIn(silenced.length)} (${how(rs, "silence")}); followed in ${rs.filter((r) => r.silenced > 0).length}`],
    [
      "First tell anyone could see, median",
      "10 real min or sooner",
      firsts.length ? `${median(firsts).toFixed(1)} real min in ${firsts.length} of ${n} evenings (out of step, the garment, the plan's acts)` : "none seen yet",
    ],
    ["Innocent twins", "1 per 5 real min, ≥ soft tells", `${twinsRate.toFixed(2)} per 5 real min; ${mean(rs.map((r) => r.twins)).toFixed(1)} a night against ${soft.toFixed(1)} soft tells`],
    ["A guest sees a hard tell", "~1 evening in 15 to 20", `${hardSeen} of ${n} evenings${oneIn(hardSeen)}`],
    ["A hard tell in a perch's view", "1 evening in 3 or more", `${hardPerch} of ${n} evenings${oneIn(hardPerch)} (its view 0.5 or more)`],
    ["Playing someone: tested by the end of dinner", "60% or more", `${pct(playing.filter((r) => r.tested).length, playing.length)} of ${playing.length}`],
    ["Playing someone: someone sure by the last toast", "30 to 60%", `${pct(playing.filter((r) => r.sure).length, playing.length)} of ${playing.length}`],
    ["An innocent confronted", "slightly under 1 in 20", `${pct(rs.filter((r) => r.innocentConfronted > 0).length, n)} of ${n} evenings`],
    [
      "Spy in the crowd's top three when its goal left a trace",
      "half or more",
      traced.length ? `${pct(traced.filter((r) => r.rankAtGo >= 1 && r.rankAtGo <= 3).length, traced.length)} of ${traced.length} evenings with a trace (as it set off home)` : "no trace left yet",
    ],
    [
      "One evening, headless",
      "under 5 s",
      `median ${(median(rs.map((r) => r.ms)) / 1000).toFixed(1)} s (${span(
        rs.map((r) => r.ms / 1000),
        (v) => v.toFixed(1),
      )}) with ${jobs} running at once; party-perf.test.ts times one alone`,
    ],
  ];
  L.push("");
  L.push("the plan's targets");
  for (const [m, t, got] of rows) L.push(`  ${m.padEnd(56)} ${t.padEnd(34)} ${got}`);

  // The programme.
  const cues = rs.flatMap((r) => r.cues);
  L.push("");
  L.push(`programme: ${cues.length} changes acted on, ${(cues.length / n).toFixed(1)} a night`);
  for (const how of ["heard", "seen", "told", "late"] as const) {
    const cs = cues.filter((c) => c.how === how);
    if (cs.length)
      L.push(
        `  ${how.padEnd(6)} ${String(cs.length).padStart(4)} · waited ${span(cs.map((c) => c.wait))} s (mean ${mean(cs.map((c) => c.wait)).toFixed(0)}) · acted ${span(cs.map((c) => c.after))} s after the change`,
      );
  }
  const shares = rs.flatMap((r) => r.shares);
  L.push(`  moved on after ${(100 * mean(shares)).toFixed(0)}% of the guests in its room on average (${shares.length} moves with company; fewest ${(100 * Math.min(...shares)).toFixed(0)}%)`);

  // Exit, drink, reactions, tells.
  const gone = rs.filter((r) => r.leftAt >= 0);
  L.push("");
  const going = rs.filter((r) => r.goingAt >= 0);
  const share = (xs: number[]) => `${span(xs, (v) => `${(100 * v).toFixed(0)}%`)} (mean ${(100 * mean(xs)).toFixed(0)}%)`;
  L.push(
    `exit: set off with ${share(going.map((r) => r.goingShare))} of the farewell's leavers on their way, ${span(
      going.map((r) => (r.goingAt - r.byeAt) / 60),
      (v) => v.toFixed(1),
    )} min after its first goodbye`,
  );
  L.push(`  out of the door with ${share(gone.map((r) => r.leftShare))} of them gone before it · gave up ${rs.filter((r) => r.exitWhy === "gave-up").length}`);
  L.push(
    `drink: tipsiness at most ${Math.max(...rs.map((r) => r.tipsyMax)).toFixed(2)} (mean of the nights' highest ${mean(rs.map((r) => r.tipsyMax)).toFixed(2)}) · ${mean(rs.map((r) => r.drinks)).toFixed(1)} drinks a night`,
  );
  L.push(
    `reactions a night: ${mean(rs.map((r) => r.late)).toFixed(1)} late · ${mean(rs.map((r) => r.beckons)).toFixed(1)} beckoned in · ${mean(rs.map((r) => r.points)).toFixed(1)} pointed the way · ${mean(rs.map((r) => r.flutes)).toFixed(1)} brought a flute; the spy drew one in ${rs.filter((r) => r.drawn > 0).length} of ${n}`,
  );
  const garment = rs.filter((r) => r.garment);
  const steps = rs.map((r) => r.tells.filter((x) => x.what === "out-of-step"));
  L.push(
    `tells: out of step ${mean(steps.map((s) => s.length)).toFixed(1)} a night (seen by someone ${pct(steps.flat().filter((x) => x.seen).length, steps.flat().length)}) · the garment in ${garment.length} of ${playing.length} pre-party evenings`,
  );

  // Its covers (PR 4).
  const night = (f: (r: EveningResult) => number, of: readonly EveningResult[] = playing) => mean(of.map(f)).toFixed(1);
  L.push("");
  L.push("covers: the evenings each came on, its minutes on a night when it did, and its tells a night (seen by a guest)");
  for (const c of COVERS) {
    const on = rs.filter((r) => r.covers[c].spells > 0);
    const tells = rs.map((r) => r.tells.filter((x) => COVER_TELLS[c].includes(x.what)));
    const seen = tells.flat();
    const said = c === "poison" ? "never built: on, it changes nothing" : `tells ${mean(tells.map((x) => x.length)).toFixed(1)} (${pct(seen.filter((x) => x.seen).length, seen.length)})`;
    L.push(`  ${c.padEnd(15)} on in ${String(on.length).padStart(2)} of ${n} · ${on.length ? mean(on.map((r) => r.covers[c].mins)).toFixed(0) : "–"} min · ${said}`);
  }
  const hb = (k: keyof EveningResult["habits"]) => night((r) => r.habits[k], rs);
  const tc = (k: keyof EveningResult["tactics"]) => night((r) => r.tactics[k], rs);
  L.push(
    `  habits a night: returns ${hb("returns")} · tours ${hb("tours")} (doors tried ${hb("rattles")}, peeks ${hb("peeks")}) · startles ${hb("startles")} · followed close ${hb("followed")} · out of the picture ${hb("slipped")} (stayed in ${hb("stayed")}) · errands dropped ${hb("drops")} (came looking ${hb("asked")})`,
  );
  L.push(
    `  tactics a night: alibis ${tc("alibis")} (cut ${tc("cut")}, spill ${tc("spill")}, lost ${tc("lost")}, call ${tc("call")}) · washes ${tc("washes")} · bandages off ${tc("bandageOff")} · claims ${tc("claims")} · kept quiet ${tc("quiet")} · spills on an owner ${tc("spills")} · bags carried ${tc("carried")} · lights ${tc("lights")}`,
  );
  L.push(
    `  felt watched a night: wary glances ${night((r) => r.watched.glances, rs)} · tests failed ${night((r) => r.watched.tests, rs)} · circles hushed ${night((r) => r.watched.hushes, rs)} · lying low ${(100 * mean(playing.map((r) => r.lowShare))).toFixed(0)}% of its evening playing someone, ${(100 * mean(self.map((r) => r.lowShare))).toFixed(0)}% as itself`,
  );

  // Seen through.
  L.push("");
  L.push(`seen through, a night playing someone (${playing.length} evenings):`);
  L.push(
    `  tests of it ${night((r) => r.spyTests.bluffed + r.spyTests.failed)} (bluffed ${night((r) => r.spyTests.bluffed)}, failed ${night((r) => r.spyTests.failed)}) · notes compared about it ${night((r) => r.compared)}`,
  );
  L.push(`  sure of it ${night((r) => r.sureOfSpy)}: out loud ${night((r) => r.outLoud)} · backed away and told ${night((r) => r.told)} · kept silent ${night((r) => r.silent)}`);
  L.push(`  slips that added doubt ${night((r) => r.slips)} · cool greetings ${night((r) => r.cool)} · names it didn't know ${night((r) => r.names)} · begged off ${night((r) => r.begOffs)}`);
  L.push(
    `innocents: someone sure of one in ${rs.filter((r) => r.innocentSure > 0).length} of ${n} evenings, confronted in ${rs.filter((r) => r.innocentConfronted > 0).length} · tours asked of the host ${night((r) => r.tourAsks, rs)} a night`,
  );
  const hosts = rs.filter((r) => r.setup === "host");
  if (hosts.length)
    L.push(
      `playing the host (${hosts.length}): prompted ${night((r) => r.prompts, hosts)} times a night · tours asked ${night((r) => r.tourAsks, hosts)}, turned down ${night((r) => r.toursRefused, hosts)}`,
    );
  const withGarment = rs.filter((r) => r.garment);
  if (withGarment.length) L.push(`the garment found in ${withGarment.filter((r) => r.finds > 0).length} of the ${withGarment.length} evenings with one`);

  // By arrival.
  L.push("");
  L.push("by arrival");
  for (const s of SETUPS) {
    const g = rs.filter((r) => r.setup === s);
    if (!g.length) continue;
    const moved = g.flatMap((r) => r.shares);
    L.push(
      `  ${s.padEnd(7)} ${String(g.length).padStart(3)} · ${moved.length ? `moved on after ${(100 * mean(moved)).toFixed(0)}%` : "not by cues"} · set off with ${(100 * mean(g.filter((r) => r.goingAt >= 0).map((r) => r.goingShare))).toFixed(0)}% on their way · tested ${g.filter((r) => r.tested).length} · sure ${g.filter((r) => r.sure).length}`,
    );
  }

  // By goal: how far its plan got, how it went, and what it left showing.
  L.push("");
  L.push("by goal");
  const clock = (t: number) => `${19 + Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
  for (const goal of GOALS) {
    const g = rs.filter((r) => r.goal === goal);
    if (!g.length) continue;
    const tried = g.filter((r) => r.triedAt >= 0);
    const done = g.filter((r) => r.doneAt >= 0);
    const end = `done ${done.length}${done.length ? ` (median ${clock(median(done.map((r) => r.doneAt)))}${goal === "kill" ? `; ${how(g, "goal")}` : ""})` : ""}`;
    const theft =
      goal === "kill" && g.some((r) => r.theft)
        ? ` · stole first ${g.filter((r) => r.stashedAt >= 0).length} of ${g.filter((r) => r.theft).length}, dropped ${g.filter((r) => r.droppedAt >= 0).length}`
        : "";
    const hard = g.map((r) => r.tells.filter((x) => isHard(x.what)));
    L.push(
      `  ${goal.padEnd(9)} ${String(g.length).padStart(3)} · tried ${tried.length} · ${end}${theft} · steps a night ${night((r) => r.plan.started, g)} (broken off ${night((r) => r.plan.broken, g)}, failed ${night((r) => r.plan.failed, g)}) · hard tells ${night((r) => r.tells.filter((x) => isHard(x.what)).length, g)} (seen in ${hard.filter((h) => h.some((x) => x.seen)).length}, perch ${hard.filter((h) => h.some((x) => x.view >= 0.5)).length}) · traces in ${g.filter((r) => r.traces > 0).length}`,
    );
  }

  // Its killing (PR 5): every kill it set off on, the bodies, those missed, and poison (never built).
  const ks = rs.flatMap((r) => r.kills);
  const bodies = rs.flatMap((r) => r.bodies);
  const ended = (out: string) => ks.filter((k) => k.out === out).length;
  L.push("");
  L.push(
    `killing: ${ks.length} kills set off on in ${rs.filter((r) => r.kills.length).length} evenings (${KILL_WHYS.map((w) => `${w} ${ks.filter((k) => k.why === w).length}`).join(", ")}): dead ${ended("dead")} (strangled ${ks.filter((k) => k.out === "dead" && k.how === "strangled").length}, the needle ${ks.filter((k) => k.out === "dead" && k.how === "injection").length}), broken off ${ended("broken")}, lost ${ended("lost")}, let go alive ${ended("survived")}`,
  );
  L.push(
    `  bodies: ${bodies.length} left tonight (${HIDE_PLACES.map((k) => `${k} ${bodies.filter((b) => b.kind === k).length}`).join(", ")}), hidden ${bodies.length ? mean(bodies.map((b) => b.hides)).toFixed(2) : "–"} on average · someone missed out loud in ${rs.filter((r) => r.missed > 0).length} evenings (${rs.reduce((a, r) => a + r.missed, 0)} cases)`,
  );
  L.push(`  poison: never built (its cover comes on and changes nothing; no dose, no tells)`);
  return L;
}

// ------------------------------------------------------------------ run

if (process.argv.includes("--evening")) {
  // A child of runEvenings(): one evening per message until disconnected.
  process.on("message", (m: { i: number; spec: EveningSpec }) => process.send!({ i: m.i, r: runEvening(m.spec) }));
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
