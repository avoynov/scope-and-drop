/**
 * The evening's clock and programme.
 *
 * A party runs 19:00–22:00 in-game and plays in one real hour: only the clock
 * is compressed. People walk and gesture at real speed, so a sim step of `dt`
 * in-game seconds moves them `dt / TIME_SCALE` seconds' worth of distance.
 */
import type { Rng } from "../mansion/core/rng";

/** In-game seconds per real second. */
export const TIME_SCALE = 3;
/** 19:00, in seconds after midnight. */
export const PARTY_START = 19 * 3600;
/** Three in-game hours. */
export const PARTY_LENGTH = 3 * 3600;

export type PhaseId = "arrival" | "mingle" | "champagne" | "toast" | "dinner" | "dancing" | "games" | "farewell";

export interface Phase {
  id: PhaseId;
  label: string;
  /** In-game seconds after 19:00. */
  start: number;
  end: number;
}

/** The generic gala programme, in in-game minutes (spec: Match structure). */
const PROGRAMME: ReadonlyArray<readonly [PhaseId, string, number]> = [
  ["arrival", "Arrival", 15],
  ["mingle", "Mingling", 15],
  ["champagne", "Champagne", 6],
  ["toast", "Toast", 6],
  ["mingle", "Mingling", 18],
  ["dinner", "Dinner", 40],
  ["dancing", "Dancing", 30],
  ["games", "Evening games", 25],
  ["mingle", "Mingling", 10],
  ["farewell", "Last toasts and departures", 15],
];

/** Each inner boundary moves by up to this much per seed (in-game seconds). */
export const PHASE_JITTER = 180;

export function makeProgramme(rng: Rng): Phase[] {
  const out: Phase[] = [];
  let t = 0;
  for (const [id, label, min] of PROGRAMME) {
    out.push({ id, label, start: t, end: t + min * 60 });
    t += min * 60;
  }
  // Jitter inner boundaries; short phases (champagne, the toast) move less, so none is squeezed away.
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    const j = Math.min(PHASE_JITTER, 0.25 * PROGRAMME[i - 1]![2] * 60, 0.25 * PROGRAMME[i]![2] * 60);
    const lo = prev.start + 120;
    const hi = cur.end - 120;
    const b = Math.round(Math.max(lo, Math.min(hi, cur.start + rng.range(-j, j))));
    prev.end = b;
    cur.start = b;
  }
  return out;
}

/** The phases that give way when one before them starts late: the minglings and the games. */
export const FLEXIBLE: ReadonlySet<PhaseId> = new Set(["mingle", "games"]);
/** A flexible phase gives way down to this length (in-game s), never less. */
export const FLEX_MIN = 300;

/**
 * How much later phase `i` can start (in-game s): what the flexible phases from it on can give,
 * each down to FLEX_MIN. The evening never runs past its end.
 */
export function phaseSlack(prog: readonly Phase[], i: number): number {
  let slack = 0;
  for (let j = Math.max(1, i); j < prog.length; j++) if (FLEXIBLE.has(prog[j]!.id)) slack += Math.max(0, prog[j]!.end - prog[j]!.start - FLEX_MIN);
  return slack;
}

/**
 * Start phase `i` later by `delay` (the host announced it late): the phase before runs on, and
 * the flexible phases from `i` on give the time back, nearest first, so the evening still ends
 * when it would have. A fixed phase (the toast, dinner) keeps its length and moves whole. The
 * delay is capped at what the flexible phases can give; returns the delay applied.
 */
export function shiftPhase(prog: Phase[], i: number, delay: number): number {
  if (i < 1 || i >= prog.length) return 0;
  const d = Math.round(Math.max(0, Math.min(delay, phaseSlack(prog, i))));
  if (d <= 0) return 0;
  let carry = d;
  prog[i - 1]!.end += d;
  prog[i]!.start += d;
  for (let j = i; j < prog.length && carry > 0; j++) {
    const ph = prog[j]!;
    // Its start has moved by `carry`; a flexible phase shrinks to take it, down to FLEX_MIN.
    if (FLEXIBLE.has(ph.id)) carry -= Math.min(carry, Math.max(0, ph.end - (ph.start - carry) - FLEX_MIN));
    if (carry <= 0 || j + 1 >= prog.length) break;
    ph.end += carry;
    prog[j + 1]!.start += carry;
  }
  return d;
}

/** Index of the phase running at `t` (clamped to the programme). */
export function phaseIndexAt(prog: readonly Phase[], t: number): number {
  if (t < prog[0]!.start) return 0;
  for (let i = 0; i < prog.length; i++) if (t < prog[i]!.end) return i;
  return prog.length - 1;
}

/** 0 at the phase's start, 1 at its end. */
export function phaseProgress(p: Phase, t: number): number {
  return Math.max(0, Math.min(1, (t - p.start) / Math.max(1, p.end - p.start)));
}

/** "20:07" for `t` in-game seconds after 19:00. */
export function clockLabel(t: number): string {
  const s = Math.max(0, Math.floor(PARTY_START + t));
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
