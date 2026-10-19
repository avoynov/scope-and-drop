/**
 * The spy sweep (milestone 3 technical plan: Tests and the sweep): evenings with a spy in every
 * one, a third on each house size, nothing pinned, so arrivals and goals come as drawn. Child
 * processes share the evenings out across the machine's cores. Every evening runs the monitors
 * (tests/spy-watch.ts), and the plan's targets are printed beside what was measured; the parts a
 * later pull request brings are marked with it. A miss on a target is reported, not failed.
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
import type { SpyOptions } from "../src/party/spy";
import { GOALS, SETUPS } from "../src/party/spy/cast";
import { watchSpy, type SpyEvening } from "../tests/spy-watch";

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
  const soft = mean(rs.map((r) => r.tells.filter((x) => x.what === "out-of-step").length));
  const rows: Array<[string, string, string]> = [
    ["The spy's goal done", "55 to 80% of evenings", "– (PR 3 brings the plans)"],
    [
      "First tell anyone could see, median",
      "10 real min or sooner",
      firsts.length ? `${median(firsts).toFixed(1)} real min in ${firsts.length} of ${n} evenings (PR 1's tells: out of step, the garment)` : "none seen yet",
    ],
    ["Innocent twins", "1 per 5 real min, ≥ soft tells", `${twinsRate.toFixed(2)} per 5 real min; ${mean(rs.map((r) => r.twins)).toFixed(1)} a night against ${soft.toFixed(1)} soft tells`],
    ["A guest sees a hard tell", "~1 evening in 15 to 20", "– (PR 3: no hard tells yet)"],
    ["A hard tell in a perch's view", "1 evening in 3 or more", "– (PR 3)"],
    ["Playing someone: tested by the end of dinner", "60% or more", `${pct(playing.filter((r) => r.tested).length, playing.length)} of ${playing.length}`],
    ["Playing someone: someone sure by the last toast", "30 to 60%", `${pct(playing.filter((r) => r.sure).length, playing.length)} of ${playing.length}`],
    ["An innocent confronted", "slightly under 1 in 20", `${pct(rs.filter((r) => r.innocentConfronted > 0).length, n)} of ${n} evenings`],
    ["Spy in the crowd's top three when its goal left a trace", "half or more", "– (PR 3)"],
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

  // Seen through.
  const night = (f: (r: EveningResult) => number, of: readonly EveningResult[] = playing) => mean(of.map(f)).toFixed(1);
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
  return L;
}

// ------------------------------------------------------------------ run

if (process.argv.includes("--evening")) {
  // A child of runEvenings(): one evening per message until disconnected.
  process.on("message", (m: { i: number; spec: EveningSpec }) => process.send!({ i: m.i, r: runEvening(m.spec) }));
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
