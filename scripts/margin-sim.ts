/**
 * The new player's safety margin (armoury task 11), simulated from a fresh career, so its constants can be checked
 * and re-tuned. Reference implementation of the margin rules in the handover doc; `src/armoury/margin.ts`, when it is
 * built, must give the same numbers on the same seeds.
 *
 *   npx tsx scripts/margin-sim.ts            # summary per player type
 *   npx tsx scripts/margin-sim.ts --series   # median margin per contract, as JSON rows (the doc's chart)
 *
 * Model (deliberately simple, all angles in mrad):
 *  - one shot at the spy per contract, aimed at the chest centre, at 183 m (the VSS's game range);
 *  - the shot's error is a 2D normal with σ per axis falling by the power law of practice:
 *    σ(n) = σ∞ + (σ₀ − σ∞)·n^(−α) for contract n = 1, 2, …;
 *  - the target is an ellipse round the chest centre standing in for the torso, 45 cm wide and 90 cm tall; the chest's
 *    half-width for the quality measure is 20 cm;
 *  - the miss beyond the outline is measured along the ray from the chest centre to the impact.
 *
 * Importable (tests/margin.test.ts checks margin.ts against `career` here); it prints only when run directly.
 */
import { fileURLToPath } from "node:url";

const MARGIN = {
  career0: 1.1, // starting career margin
  rifle0: 0.4, // starting margin of each rifle
  k: 0.35, // pay cut at the margin's edge
  f: 0.3, // how fast quality shrinks it
  drift: 0.02, // shrink per contract, as a share of the part's starting size
  snap: 0.05, // a part below this is gone
  missGrow: [0.1, 0.05], // share of career0 given back on the 2nd miss in a row, and on each further one
  growCap: 0.5, // growth from misses never takes the career margin above this share of career0
};
export const RANGE_M = 183;
const SEMI_W = 0.225; // torso stand-in: semi-axes (m)
const SEMI_H = 0.45;
const CHEST_HALF_M = 0.2;

/** Mulberry32 and Box–Muller: the same draws on every machine for a seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
  return { u, gauss };
}

/** Angular miss beyond the ellipse's outline (0 inside), along the ray from its centre. */
export function missBeyond(dx: number, dy: number): number {
  const a = (SEMI_W / RANGE_M) * 1000;
  const b = (SEMI_H / RANGE_M) * 1000;
  const r = Math.hypot(dx / a, dy / b);
  return r <= 1 ? 0 : Math.hypot(dx, dy) * (1 - 1 / r);
}

/** The outcome of a margin hit that used `u` of the margin: killed 1 − 0.6u, downed 0.45u, wounded 0.15u. */
function outcomeFactor(u: number, x: number): number {
  if (x < 1 - 0.6 * u) return 1;
  if (x < 1 - 0.15 * u) return 0.6;
  return 0.2;
}

type Kind = "hit" | "margin" | "miss";
export interface Profile {
  name: string;
  s0: number;
  sInf: number;
  alpha: number;
}
export const PROFILES: Profile[] = [
  { name: "Quick learner", s0: 1.6, sInf: 0.25, alpha: 0.8 },
  { name: "Typical", s0: 1.6, sInf: 0.4, alpha: 0.45 },
  { name: "Stagnant", s0: 1.6, sInf: 1.2, alpha: 0.1 },
];

/** One career of `n` contracts with one rifle: the margin before each contract, what the shot was and what it paid. */
export function career(p: Profile, n: number, seed: number) {
  const r = rng(seed * 7919 + 17);
  let mc = MARGIN.career0;
  let mr = MARGIN.rifle0;
  let missesInRow = 0;
  const out: { margin: number; kind: Kind; pay: number; dx: number; dy: number; marginAfter: number }[] = [];
  for (let i = 1; i <= n; i++) {
    const s = p.sInf + (p.s0 - p.sInf) * i ** -p.alpha;
    const dx = r.gauss() * s;
    const dy = r.gauss() * s;
    const m = mc + mr;
    const d = missBeyond(dx, dy);
    const e = Math.hypot(dx, dy);
    const E = (CHEST_HALF_M / RANGE_M) * 1000 + m;
    let kind: Kind;
    let pay: number;
    let q: number;
    if (d === 0) {
      kind = "hit";
      pay = 1;
      q = Math.max(0, 1 - e / E);
    } else if (d <= m) {
      const u = d / m;
      kind = "margin";
      pay = outcomeFactor(u, r.u()) * (1 - MARGIN.k * u);
      q = Math.max(0, 1 - e / E);
    } else {
      kind = "miss";
      pay = 0;
      q = 0;
    }
    // 1. Misses in a row give some back (career margin only), never above growCap × career0.
    if (kind === "miss") {
      missesInRow++;
      if (missesInRow >= 2) {
        const give = (missesInRow === 2 ? MARGIN.missGrow[0]! : MARGIN.missGrow[1]!) * MARGIN.career0;
        mc = Math.min(mc + give, Math.max(mc, MARGIN.growCap * MARGIN.career0));
      }
    } else missesInRow = 0;
    // 2. Quality shrinks each part, and the drift takes a little more whatever happened.
    mc = Math.max(0, mc * (1 - MARGIN.f * q) - MARGIN.drift * MARGIN.career0);
    mr = Math.max(0, mr * (1 - MARGIN.f * q) - MARGIN.drift * MARGIN.rifle0);
    // 3. Each part snaps to 0 below the snap.
    if (mc < MARGIN.snap) mc = 0;
    if (mr < MARGIN.snap) mr = 0;
    out.push({ margin: m, kind, pay, dx, dy, marginAfter: mc + mr });
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))]!;

const CAREERS = 400;
const N = 60;
const direct = !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (direct && process.argv.includes("--series")) {
  const rows: { contract: number; player: string; margin: number }[] = [];
  for (const p of PROFILES) {
    const cs = Array.from({ length: CAREERS }, (_, s) => career(p, 40, s));
    for (let i = 0; i < 40; i++) rows.push({ contract: i + 1, player: p.name, margin: Math.round(median(cs.map((c) => c[i]!.margin)) * 1000) / 1000 });
  }
  console.log(JSON.stringify(rows));
} else if (direct) {
  for (const p of PROFILES) {
    const cs = Array.from({ length: CAREERS }, (_, s) => career(p, N, s));
    // The first contract that starts with no margin left (N + 1 if it never runs out).
    const gone = cs.map((c) => c.findIndex((x) => x.margin < 0.01) + 1 || N + 1);
    const first20 = cs.flatMap((c) => c.slice(0, 20));
    const share = (k: Kind) => (first20.filter((x) => x.kind === k).length / first20.length).toFixed(2);
    const at = (i: number) => median(cs.map((c) => c[i - 1]!.margin)).toFixed(2);
    console.log(
      `${p.name.padEnd(14)} gone at contract: median ${median(gone)}, p10–p90 ${quantile(gone, 0.1)}–${quantile(gone, 0.9)} | ` +
        `first 20: hit ${share("hit")}, margin ${share("margin")}, miss ${share("miss")}, mean pay ×${(first20.reduce((s, x) => s + x.pay, 0) / first20.length).toFixed(2)} | ` +
        `median margin at 1/10/20/30/40: ${[1, 10, 20, 30, 40].map(at).join(" / ")} mrad`,
    );
  }
}
