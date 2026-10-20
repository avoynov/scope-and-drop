/**
 * Reticle patterns as resolution-free primitives in the reticle's own angular unit.
 * x grows right, y grows DOWN (holdover is positive). Line widths are angular too, so the whole
 * pattern, strokes included, scales with magnification as on a first-focal-plane scope.
 */
import { ROUNDS, holdRad, type RoundId } from "./ballistics";
import { MRAD, THOUSANDTH } from "./optics";
import { BATTLE_ZERO_M, RIFLES, crossDriftPerMs } from "./shot";

export type Prim =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; w: number; dash?: number; lit?: boolean }
  | { kind: "poly"; pts: [number, number][]; w: number; lit?: boolean; fill?: boolean }
  | { kind: "dot"; x: number; y: number; r: number; lit?: boolean }
  | { kind: "text"; x: number; y: number; size: number; text: string; align?: "left" | "center" | "right"; lit?: boolean };

export interface Reticle {
  id: "pso" | "tree" | "vss";
  name: string;
  /** Radians per reticle unit. */
  unitRad: number;
  unitName: string;
  prims: Prim[];
  /** The load the rifle behind this reticle fires. */
  round: RoundId;
  /** Illumination colour (the PSO-1 lights the whole pattern; modern trees light the centre). */
  illum: string;
}

/** Edge of the drawable world in units: lines that run "to the field stop" stop here. */
const EDGE = 120;

/** Height of the PSO-1 rangefinder curve above its base line at range n×100 m, for a 1.7 m man. */
export const psoCurveHeight = (n: number) => 1.7 / (n * 100) / THOUSANDTH;

/** Ranges marked by the PSO's three holdover chevrons. */
export const PSO_CHEVRON_RANGES = [400, 600, 800] as const;

/**
 * Where a PSO holdover chevron sits below the aiming chevron: the 7N1's hold with the SVD zeroed at 100 m
 * (drum on 1) and its scope 70 mm over the bore, in thousandths. Glass cannot move, so the chevrons are true
 * only with the drum on 1.
 */
export const psoChevronY = (rangeM: number) => holdRad(ROUNDS["7n1"], rangeM, BATTLE_ZERO_M, RIFLES.svd.sightM) / THOUSANDTH;

/**
 * SVD / PSO-1 style, tailored to the 7N1 round. Main chevron is the aiming point; three holdover chevrons
 * below sit at the 7N1's computed hold for 400, 600 and 800 m with the drum on 1, the 100 m zero (the
 * PSO-1's own chevrons serve 1100–1300 m with the drum on 10). A vertical stadia runs from the last
 * chevron down; a lateral scale every 1 thousandth to ±10 with longer marks at 5 and 10; the
 * stadiametric rangefinder at lower left (base line, dashed 1.7 m curve, ranges 2–10 ×100 m).
 */
export function psoReticle(): Reticle {
  const p: Prim[] = [];
  const W = 0.13; // stroke
  const chevron = (y: number, hw: number, h: number) =>
    p.push({
      kind: "poly",
      pts: [
        [-hw, y + h],
        [0, y],
        [hw, y + h],
      ],
      w: W,
      lit: true,
    });
  chevron(0, 0.5, 1.0);
  let last = 0;
  for (const range of PSO_CHEVRON_RANGES) {
    last = psoChevronY(range);
    chevron(last, 0.42, 0.85);
    p.push({ kind: "text", x: 0.75, y: last + 0.45, size: 0.8, text: String(range / 100), align: "left", lit: true });
  }
  p.push({ kind: "line", x1: 0, y1: last + 1.1, x2: 0, y2: EDGE, w: W, lit: true });
  // Lateral scale.
  for (let i = 1; i <= 10; i++) {
    const len = i === 10 ? 1.3 : i === 5 ? 0.85 : 0.5;
    for (const s of [-1, 1]) p.push({ kind: "line", x1: s * i, y1: 0, x2: s * i, y2: len, w: W, lit: true });
  }
  p.push({ kind: "line", x1: -10, y1: 0, x2: -1, y2: 0, w: W * 0.8, lit: true });
  p.push({ kind: "line", x1: 1, y1: 0, x2: 10, y2: 0, w: W * 0.8, lit: true });
  for (const s of [-1, 1]) p.push({ kind: "text", x: s * 10, y: -0.55, size: 1.0, text: "10", lit: true });
  // Rangefinder: n = 2 at the far left, n = 10 near the centre.
  const base = 7.5;
  const xOf = (n: number) => -13.5 + ((n - 2) / 8) * 8.5;
  p.push({ kind: "line", x1: xOf(2) - 0.4, y1: base, x2: xOf(10) + 0.3, y2: base, w: W, lit: true });
  const curve: [number, number][] = [];
  for (let n = 2; n <= 10.001; n += 0.1) curve.push([xOf(n), base - psoCurveHeight(n)]);
  for (let i = 0; i < curve.length - 1; i += 2) {
    const [x1, y1] = curve[i]!;
    const [x2, y2] = curve[i + 1]!;
    p.push({ kind: "line", x1, y1, x2, y2, w: W * 0.8, lit: true });
  }
  for (let n = 2; n <= 10; n++) {
    const y = base - psoCurveHeight(n);
    p.push({ kind: "line", x1: xOf(n), y1: y, x2: xOf(n), y2: y - 0.35, w: W * 0.8, lit: true });
    if (n % 2 === 0) p.push({ kind: "text", x: xOf(n), y: y - 0.75, size: 0.85, text: String(n), lit: true });
  }
  return { id: "pso", name: "SVD · PSO", unitRad: THOUSANDTH, unitName: "thousandth", prims: p, round: "7n1", illum: "rgb(255,46,24)" };
}

/**
 * Ranges marked by the VSS reticle's holdover chevrons: every 100 m numbered, the 50 m steps between plain.
 * 100 m is the zero, so the aiming chevron is its mark.
 */
export const VSS_CHEVRON_RANGES = [150, 200, 250, 300, 350, 400] as const;

/** Where a VSS holdover chevron sits below the aiming chevron: the SP-5's hold with the drum on 1, in thousandths. */
export const vssChevronY = (rangeM: number) => holdRad(ROUNDS.sp5, rangeM, BATTLE_ZERO_M, RIFLES.vss.sightM) / THOUSANDTH;

/** The VSS rangefinder's marks, ×100 m: 1.7 m curve heights from 100 to 400 m in 50 m steps. */
export const VSS_RANGEFINDER = [1, 1.5, 2, 2.5, 3, 3.5, 4] as const;

/**
 * VSS / PSO-1-1 style, tailored to the SP-5. The real 9×39 scopes (PSO-1-1, PSO-1M2-1) have a single aiming
 * chevron, a range drum cut for the round and a rangefinder out to 400 m; with the drum left on 1 (the 100 m
 * zero) the drum's job beyond it moves onto the glass, as on the SVD's PSO. Past the zero the subsonic bullet
 * needs 3 thousandths more at 150 m and 20 at 400 m, so the holdover chevrons run far down the field: one at
 * the SP-5's hold for every 100 m, numbered 2–4, and a smaller plain one at each 50 m step, because between
 * 150 and 200 m the hold changes by a thousandth every 16 m. The vertical stadia starts below
 * the last chevron; the lateral scale is the PSO's. The rangefinder is re-cut for 100–400 m, as on those scopes:
 * base line and dashed 1.7 m curve, ticks every 50 m and numbers 1–4 (×100 m).
 */
export function vssReticle(): Reticle {
  const p: Prim[] = [];
  const W = 0.13;
  const chevron = (y: number, hw: number, h: number) =>
    p.push({
      kind: "poly",
      pts: [
        [-hw, y + h],
        [0, y],
        [hw, y + h],
      ],
      w: W,
      lit: true,
    });
  chevron(0, 0.5, 1.0);
  let last = 0;
  for (const range of VSS_CHEVRON_RANGES) {
    last = vssChevronY(range);
    const whole = range % 100 === 0;
    if (whole) {
      chevron(last, 0.42, 0.85);
      p.push({ kind: "text", x: 0.75, y: last + 0.45, size: 0.8, text: String(range / 100), align: "left", lit: true });
    } else chevron(last, 0.28, 0.55);
  }
  p.push({ kind: "line", x1: 0, y1: last + 1.1, x2: 0, y2: EDGE, w: W, lit: true });
  // Lateral scale, as on the PSO.
  for (let i = 1; i <= 10; i++) {
    const len = i === 10 ? 1.3 : i === 5 ? 0.85 : 0.5;
    for (const s of [-1, 1]) p.push({ kind: "line", x1: s * i, y1: 0, x2: s * i, y2: len, w: W, lit: true });
  }
  p.push({ kind: "line", x1: -10, y1: 0, x2: -1, y2: 0, w: W * 0.8, lit: true });
  p.push({ kind: "line", x1: 1, y1: 0, x2: 10, y2: 0, w: W * 0.8, lit: true });
  for (const s of [-1, 1]) p.push({ kind: "text", x: s * 10, y: -0.55, size: 1.0, text: "10", lit: true });
  // Rangefinder at lower left: n = 1 (100 m) at the far left, where the curve stands 16 thousandths tall.
  const base = 17.5;
  const xOf = (n: number) => -15 + ((n - 1) / 3) * 9.5;
  p.push({ kind: "line", x1: xOf(1) - 0.4, y1: base, x2: xOf(4) + 0.3, y2: base, w: W, lit: true });
  const curve: [number, number][] = [];
  for (let n = 1; n <= 4.0001; n += 0.04) curve.push([xOf(n), base - psoCurveHeight(n)]);
  for (let i = 0; i < curve.length - 1; i += 2) {
    const [x1, y1] = curve[i]!;
    const [x2, y2] = curve[i + 1]!;
    p.push({ kind: "line", x1, y1, x2, y2, w: W * 0.8, lit: true });
  }
  for (const n of VSS_RANGEFINDER) {
    const y = base - psoCurveHeight(n);
    const whole = n % 1 === 0;
    p.push({ kind: "line", x1: xOf(n), y1: y, x2: xOf(n), y2: y - (whole ? 0.35 : 0.22), w: W * 0.8, lit: true });
    if (whole) p.push({ kind: "text", x: xOf(n), y: y - 0.75, size: 0.85, text: String(n), lit: true });
  }
  return { id: "vss", name: "VSS · PSO-1-1", unitRad: THOUSANDTH, unitName: "thousandth", prims: p, round: "sp5", illum: "rgb(255,46,24)" };
}

/**
 * The VSS's ACSS-style scope (kit `acss`), after Primary Arms' Advanced Combined Sighting System, cut for the SP-5
 * in mrad: a horseshoe round the aiming chevron for quick shots; below it a holdover chevron for every 50 m from 150
 * to 400 m with the drum on 1 (numbered at the hundreds); under each a ranging bar as wide as a man's shoulders
 * (46 cm) at that range, so a man whose shoulders fill the bar is at that range; and either side of each, wind dots
 * for a full-value crosswind of 2 and 4 m/s. The SP-6 flies the SP-5's path, so it holds the same.
 */
export const ACSS_RANGES = [150, 200, 250, 300, 350, 400] as const;
/** The ACSS cut: the round and the shoulder width its bars are for, and the winds its dots are for (m/s). */
export const ACSS = { round: "sp5" as RoundId, shoulderM: 0.46, windMs: [2, 4] as const };
export const acssChevronY = (rangeM: number) => holdRad(ROUNDS[ACSS.round], rangeM, BATTLE_ZERO_M, RIFLES.vss.sightM) / MRAD;
/** Where the wind dot for `ms` m/s sits off the stem at `rangeM` (mrad). */
export const acssWindX = (rangeM: number, ms: number) => (crossDriftPerMs(ROUNDS[ACSS.round], [rangeM])[0]! * ms) / rangeM / MRAD;

export function acssReticle(): Reticle {
  const p: Prim[] = [];
  const w = 0.07;
  // The horseshoe, open at the bottom, and the aiming chevron's tip at its centre.
  const R = 2.6;
  const arc: [number, number][] = [];
  for (let a = -(Math.PI - 0.6); a <= Math.PI - 0.6 + 1e-9; a += 0.05) arc.push([R * Math.sin(a), -R * Math.cos(a)]);
  p.push({ kind: "poly", pts: arc, w: w * 1.6, lit: true });
  const chev = (y: number, hw: number, h: number, lit: boolean) =>
    p.push({
      kind: "poly",
      pts: [
        [-hw, y + h],
        [0, y],
        [hw, y + h],
      ],
      w: w * 1.3,
      lit,
    });
  chev(0, 0.45, 0.45, true);
  // The stem from under the chevron to the last bar, and on to the field stop.
  let last = 0;
  for (const range of ACSS_RANGES) {
    const y = acssChevronY(range);
    last = y;
    const whole = range % 100 === 0;
    chev(y, whole ? 0.32 : 0.22, whole ? 0.3 : 0.2, false);
    // The shoulder bar under the chevron, with its ends turned down.
    const half = ACSS.shoulderM / 2 / range / MRAD;
    const by = y + 0.55;
    p.push({ kind: "line", x1: -half, y1: by, x2: half, y2: by, w });
    for (const s of [-1, 1]) p.push({ kind: "line", x1: s * half, y1: by - 0.12, x2: s * half, y2: by + 0.12, w });
    for (const ms of ACSS.windMs) for (const s of [-1, 1]) p.push({ kind: "dot", x: s * acssWindX(range, ms), y, r: ms === ACSS.windMs[0] ? 0.07 : 0.1 });
    if (whole) p.push({ kind: "text", x: -half - 0.5, y: by, size: 0.65, text: String(range / 100), align: "right" });
  }
  p.push({ kind: "line", x1: 0, y1: 0.6, x2: 0, y2: acssChevronY(ACSS_RANGES[0]) - 0.1, w });
  p.push({ kind: "line", x1: 0, y1: last + 0.8, x2: 0, y2: EDGE, w });
  // The horizontal, from outside the horseshoe to the field stop, marked at 5 and 10 mrad.
  for (const s of [-1, 1]) {
    p.push({ kind: "line", x1: s * (R + 0.6), y1: 0, x2: s * EDGE, y2: 0, w });
    for (const v of [5, 10]) p.push({ kind: "line", x1: s * v, y1: -0.3, x2: s * v, y2: 0.3, w });
  }
  return { id: "vss", name: "VSS · ACSS", unitRad: MRAD, unitName: "mrad", prims: p, round: ACSS.round, illum: "rgb(255,46,24)" };
}

/** The bolt rifle's reticles. All are plain MRAD reticles: nothing on them is cut for a load. */
export type TreeStyle = "pr2" | "ebr" | "tremor";

/** Half-width of each tree row 1–10 (mil), read off the reference drawings. Rows widen in pairs. */
export const PR2_ROWS = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5] as const;
export const EBR_ROWS = [2, 2, 3, 3, 4, 4, 5, 5, 6, 6] as const;

const isWhole = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;
const isHalf = (v: number) => !isWhole(v) && isWhole(v * 2);
const isTenth = (v: number, parity: 0 | 1) => isWhole(v * 10) && Math.abs(Math.round(v * 10)) % 2 === parity;

/** A tick across an axis line (`at` across it) at `v` along it, running from `a` to `b` across; split over the line by `gap`. */
function tick(p: Prim[], axis: "x" | "y", at: number, v: number, [a, b]: readonly [number, number], w: number, gap = 0, lit?: boolean): void {
  const seg = (u1: number, u2: number) => p.push(axis === "x" ? { kind: "line", x1: v, y1: at + u1, x2: v, y2: at + u2, w, lit } : { kind: "line", x1: at + u1, y1: v, x2: at + u2, y2: v, w, lit });
  if (gap > 0 && a < 0 && b > 0) {
    seg(a, -gap / 2);
    seg(gap / 2, b);
  } else seg(a, b);
}

/** An axis line through sorted `marks` that stops `gap` short of each one, as on the PR2-MIL whose intersections are all open. */
function openLine(p: Prim[], axis: "x" | "y", at: number, marks: number[], gap: number, w: number, lit?: boolean): void {
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i]! + gap / 2;
    const b = marks[i + 1]! - gap / 2;
    if (b > a) p.push(axis === "x" ? { kind: "line", x1: a, y1: at, x2: b, y2: at, w, lit } : { kind: "line", x1: at, y1: a, x2: at, y2: b, w, lit });
  }
}

/** Steps from `from` to `to` by `step`, rounded so 0.1 mil steps land on exact tenths. */
const steps = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let k = Math.round(from / step); k * step <= to + 1e-9; k++) out.push(Math.round(k * step * 1000) / 1000);
  return out;
};

/**
 * Leupold PR2-MIL, measured off Leupold's drawing. Every intersection is open (lines stop short of each mark).
 * Horizontal to ±10 mil: whole mils crossed, half mils above, quarters below, a 0.1 mil ladder from 3 to 4 (even tenths
 * above, odd below), numbers every 2 below, tapered posts from 10.3 mil out. Above the centre only a short stem to 2 mil
 * ending in a T. Below, the stem is crossed every half mil with the same 3–4 ladder (even tenths right, odd left), and the
 * tree alternates: even rows are scales like the horizontal, capped and numbered at both ends; odd rows are dots every
 * half mil. Rows widen a mil every second row.
 */
function pr2Reticle(): Reticle {
  const p: Prim[] = [];
  const w = 0.045;
  const gap = 0.075;
  const big = 0.25;
  const small = 0.13;
  const ladder = (v: number) => v > 3 && v < 4;
  // Marks along one side of a scale: quarter mils, with tenths in the ladder (the horizontal has one, the rows don't).
  const marks = (to: number, withLadder: boolean) => (withLadder ? [...steps(0.25, 3, 0.25), ...steps(3.1, 3.9, 0.1), ...steps(4, to, 0.25)] : steps(0.25, to, 0.25)).filter((v) => v <= to);
  /** Ticks along a horizontal scale at height `y` out to `hw` each side; the even rows and the horizontal share it. */
  const scale = (y: number, hw: number) => {
    const m = marks(hw, y === 0);
    for (const s of [-1, 1])
      for (const v of m) {
        const x = s * v;
        if (isWhole(v)) tick(p, "x", y, x, [-big, big], w, gap);
        else if (ladder(v)) tick(p, "x", y, x, isTenth(v, 0) ? [-small, 0] : [0, small], w);
        else if (isHalf(v)) tick(p, "x", y, x, [-small, 0], w);
        else tick(p, "x", y, x, [0, small], w);
      }
    return [...m.map((v) => -v).reverse(), 0, ...m];
  };
  // Horizontal, its posts and numbers.
  scale(0, 10);
  for (const s of [-1, 1])
    openLine(
      p,
      "x",
      0,
      [...marks(10, true), 10.25].map((v) => s * v).sort((a, b) => a - b),
      gap,
      w,
      true,
    );
  for (const s of [-1, 1])
    p.push({
      kind: "poly",
      fill: true,
      w,
      pts: [
        [s * 10.3, 0],
        [s * 12.5, -0.35],
        [s * EDGE, -0.35],
        [s * EDGE, 0.35],
        [s * 12.5, 0.35],
      ],
    });
  for (let v = 2; v <= 10; v += 2) for (const s of [-1, 1]) p.push({ kind: "text", x: s * v, y: 0.55, size: 0.32, text: String(v) });
  p.push({ kind: "dot", x: 0, y: 0, r: 0.03, lit: true });
  // The short stem above: an open line from the centre gap to a T at 2 mil.
  openLine(p, "y", 0, [-2, -1.5, -1, -0.5, -0.25], gap, w, true);
  for (const v of [0.5, 1, 1.5]) tick(p, "y", 0, -v, [isWhole(v) ? -big : -small, isWhole(v) ? big : small], w, gap);
  p.push({ kind: "line", x1: -big, y1: -2, x2: big, y2: -2, w });
  // The stem below: crossed every half mil (the even rows cross it themselves), the 3–4 ladder, plain past 15 mil.
  const stem = [...steps(0.5, 3, 0.5), ...steps(3.1, 3.9, 0.1), ...steps(4, 15, 0.5)];
  openLine(p, "y", 0, [0.25, ...stem], gap, w, true);
  p.push({ kind: "line", x1: 0, y1: 15 + gap / 2, x2: 0, y2: EDGE, w });
  for (const v of stem) {
    if (isWhole(v) && v <= 10 && v % 2 === 0) continue;
    if (ladder(v)) tick(p, "y", 0, v, isTenth(v, 0) ? [0, small] : [-small, 0], w);
    else tick(p, "y", 0, v, [isWhole(v) ? -big : -small, isWhole(v) ? big : small], w, gap);
  }
  // The tree.
  PR2_ROWS.forEach((hw, i) => {
    const y = i + 1;
    if (y % 2) {
      for (const x of steps(0.5, hw, 0.5)) for (const s of [-1, 1]) p.push({ kind: "dot", x: s * x, y, r: 0.03 });
      return;
    }
    openLine(p, "x", y, scale(y, hw), gap, w);
    for (const s of [-1, 1]) p.push({ kind: "text", x: s * (hw + 0.45), y, size: 0.34, text: String(y), align: s < 0 ? "right" : "left" });
  });
  return { id: "tree", name: "PR2-MIL", unitRad: MRAD, unitName: "mrad", prims: p, round: "m118lr", illum: "rgb(255,52,30)" };
}

/**
 * Vortex EBR-7D MRAD, measured off Vortex's drawing. A thin crosshair to the field stop, open at the centre around a
 * 0.03 mil dot. The lit centre runs to 6 mil left, right and up, and 10 mil down: on the horizontal, 0.2 mil hashes above
 * and half mils below; up and down the stem, 0.2 mil crosses. From 6 to 10 mil left, right and up, an unlit 0.1 mil
 * ladder (0.2 mil hashes on each side of the line, offset 0.1). Numbers every 2 mil. The tree's rows are dotted every
 * 0.2 mil from 0.4 mil off the stem, whole mils bolder, a mil wider every second row, numbered on even rows.
 */
function ebrReticle(): Reticle {
  const p: Prim[] = [];
  const w = 0.045;
  const big = 0.18;
  const half = 0.16;
  const fine = 0.1;
  const centre = 0.12;
  // Crosshair: lit to 6 mil (10 down), thin black beyond; the stem breaks for a moment past its last mark.
  for (const s of [-1, 1]) {
    p.push({ kind: "line", x1: s * centre, y1: 0, x2: s * 6, y2: 0, w, lit: true });
    p.push({ kind: "line", x1: s * 6, y1: 0, x2: s * EDGE, y2: 0, w });
  }
  p.push({ kind: "line", x1: 0, y1: -centre, x2: 0, y2: -6, w, lit: true });
  p.push({ kind: "line", x1: 0, y1: -6, x2: 0, y2: -EDGE, w });
  p.push({ kind: "line", x1: 0, y1: centre, x2: 0, y2: 10, w, lit: true });
  p.push({ kind: "line", x1: 0, y1: 10.45, x2: 0, y2: EDGE, w });
  p.push({ kind: "dot", x: 0, y: 0, r: 0.03, lit: true });
  for (const v of steps(0.1, 10, 0.1)) {
    const lit = v <= 6;
    for (const s of [-1, 1]) {
      const x = s * v;
      // Horizontal: lit, 0.2 hashes above and half mils below; beyond 6, even tenths above and odd tenths below.
      if (isWhole(v)) tick(p, "x", 0, x, [-big, big], w, 0, lit);
      else if (lit && isHalf(v)) tick(p, "x", 0, x, [0, half], w, 0, true);
      else if (lit && isTenth(v, 0)) tick(p, "x", 0, x, [-fine, 0], w, 0, true);
      else if (!lit) tick(p, "x", 0, x, isTenth(v, 0) ? [-fine, 0] : [0, isHalf(v) ? half : fine], w);
    }
    // Up: lit 0.2 crosses to 6, then the ladder (odd tenths left, even right).
    if (isWhole(v)) tick(p, "y", 0, -v, [-big, big], w, 0, lit);
    else if (lit && isTenth(v, 0)) tick(p, "y", 0, -v, [-fine * 0.7, fine * 0.7], w, 0, true);
    else if (!lit) tick(p, "y", 0, -v, isTenth(v, 0) ? [0, fine] : [isHalf(v) ? -half : -fine, 0], w);
    // Down: lit 0.2 crosses all the way to 10.
    if (isWhole(v)) tick(p, "y", 0, v, [-big, big], w, 0, true);
    else if (isTenth(v, 0)) tick(p, "y", 0, v, [-fine * 0.7, fine * 0.7], w, 0, true);
  }
  for (let v = 2; v <= 10; v += 2) {
    for (const s of [-1, 1]) p.push({ kind: "text", x: s * v, y: -0.5, size: 0.34, text: String(v) });
    if (v <= 6) p.push({ kind: "text", x: 0.55, y: -v, size: 0.34, text: String(v), align: "left" });
  }
  // The tree.
  EBR_ROWS.forEach((hw, i) => {
    const y = i + 1;
    for (const x of steps(0.4, hw, 0.2)) for (const s of [-1, 1]) p.push({ kind: "dot", x: s * x, y, r: isWhole(x) ? 0.04 : 0.028 });
    if (y % 2 === 0) for (const s of [-1, 1]) p.push({ kind: "text", x: s * (hw + 0.4), y, size: 0.34, text: String(y), align: s < 0 ? "right" : "left" });
  });
  return { id: "tree", name: "EBR-7D", unitRad: MRAD, unitName: "mrad", prims: p, round: "m118lr", illum: "rgb(255,52,30)" };
}

/** Rows of the TReMoR3-style grid (mil down), and how wide each is either side of the stem. */
export const TREMOR_ROWS = Array.from({ length: 12 }, (_, i) => i + 1);
const tremorHalf = (row: number) => Math.min(8, 2 + 0.5 * row);
/**
 * The wind dots' spacing on each grid row (mil): the drift of 2 m/s of full-value crosswind for the M118LR at the
 * range whose come-up is that row, as Horus spaces its time-of-flight dots. For another load the dots are a little
 * off that value; the come-up card gives what a dot is worth for the load in the rifle, row by row.
 */
const dotMemo = new Map<number, number>();
export const tremorDotMil = (row: number): number => {
  const known = dotMemo.get(row);
  if (known !== undefined) return known;
  const r = ROUNDS.m118lr;
  let lo = 100;
  let hi = 2000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (holdRad(r, mid, BATTLE_ZERO_M, RIFLES.bolt.sightM) / MRAD < row) lo = mid;
    else hi = mid;
  }
  const range = (lo + hi) / 2;
  const dx = (crossDriftPerMs(r, [range])[0]! * 2) / range / MRAD;
  dotMemo.set(row, dx);
  return dx;
};

/**
 * TReMoR3-style grid (kit `tremor`), after Horus Vision's: a fine crosshair marked every 0.1 mil with small
 * chevron-like hashes for measuring, open at the centre round a small dot; below it a grid of whole-mil rows, each
 * scaled every 0.2 mil and widening down the tree, numbered every second mil; on each row, time-of-flight wind dots,
 * four each side. Like the other mil reticles it is cut for no load: the shooter learns what its dots are worth.
 */
function tremorReticle(): Reticle {
  const p: Prim[] = [];
  const w = 0.035;
  const fine = 0.07;
  const half = 0.12;
  const big = 0.2;
  const centre = 0.15;
  p.push({ kind: "dot", x: 0, y: 0, r: 0.035, lit: true });
  for (const s of [-1, 1]) {
    p.push({ kind: "line", x1: s * centre, y1: 0, x2: s * 10, y2: 0, w, lit: true });
    p.push({ kind: "line", x1: s * 10, y1: 0, x2: s * EDGE, y2: 0, w: w * 2.5 });
  }
  p.push({ kind: "line", x1: 0, y1: -centre, x2: 0, y2: -5, w, lit: true });
  p.push({ kind: "line", x1: 0, y1: -5, x2: 0, y2: -EDGE, w: w * 2.5 });
  p.push({ kind: "line", x1: 0, y1: centre, x2: 0, y2: 12.4, w, lit: true });
  for (const v of steps(0.1, 10, 0.1)) {
    for (const s of [-1, 1]) {
      const x = s * v;
      if (isWhole(v)) tick(p, "x", 0, x, [-big, big], w, 0, true);
      else if (isHalf(v)) tick(p, "x", 0, x, [-half, half], w, 0, true);
      else tick(p, "x", 0, x, [0, fine], w, 0, true);
    }
    if (v <= 5) {
      if (isWhole(v)) tick(p, "y", 0, -v, [-big, big], w, 0, true);
      else if (isHalf(v)) tick(p, "y", 0, -v, [-half, half], w, 0, true);
      else tick(p, "y", 0, -v, [-fine, 0], w, 0, true);
    }
  }
  for (let v = 2; v <= 10; v += 2) for (const s of [-1, 1]) p.push({ kind: "text", x: s * v, y: -0.45, size: 0.3, text: String(v) });
  // The grid below the centre.
  for (const row of TREMOR_ROWS) {
    const hw = tremorHalf(row);
    p.push({ kind: "line", x1: -hw, y1: row, x2: hw, y2: row, w });
    for (const v of steps(0.2, hw, 0.2)) for (const s of [-1, 1]) tick(p, "x", row, s * v, isWhole(v) ? [-0.14, 0.14] : [0, 0.07], w);
    // The stem between rows, scaled every 0.2 mil.
    for (const v of steps(row - 0.8, row - 0.2, 0.2)) tick(p, "y", 0, v, [-0.07, 0.07], w);
    const dx = tremorDotMil(row);
    for (let j = 1; j <= 4; j++) for (const s of [-1, 1]) if (j * dx < hw) p.push({ kind: "dot", x: s * j * dx, y: row - 0.15, r: 0.035 });
    if (row % 2 === 0) p.push({ kind: "text", x: -hw - 0.35, y: row, size: 0.32, text: String(row), align: "right" });
  }
  return { id: "tree", name: "TReMoR3", unitRad: MRAD, unitName: "mrad", prims: p, round: "m118lr", illum: "rgb(255,52,30)" };
}

/** The bolt rifle's reticle: PR2-MIL, EBR-7D or the TReMoR3-style grid. */
export const treeReticle = (style: TreeStyle = "pr2"): Reticle => (style === "ebr" ? ebrReticle() : style === "tremor" ? tremorReticle() : pr2Reticle());

export const RETICLES = { pso: psoReticle, tree: treeReticle, vss: vssReticle } as const;

/**
 * Paints a reticle onto a 2D canvas. `pxPerUnit` is set by magnification (FFP), so strokes thin out at
 * low power exactly like etched glass does; sub-pixel strokes are left to the canvas's coverage AA.
 */
export function drawReticle(ctx: CanvasRenderingContext2D, r: Reticle, cx: number, cy: number, pxPerUnit: number, ink: string, lit: string | null): void {
  const k = pxPerUnit;
  const X = (x: number) => cx + x * k;
  const Y = (y: number) => cy + y * k;
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  for (const pass of lit ? [0, 1] : [0]) {
    for (const p of r.prims) {
      if (pass === 1 && !p.lit) continue;
      const col = pass === 1 ? lit! : ink;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      if (p.kind === "line") {
        ctx.lineWidth = p.w * k;
        ctx.beginPath();
        ctx.moveTo(X(p.x1), Y(p.y1));
        ctx.lineTo(X(p.x2), Y(p.y2));
        ctx.stroke();
      } else if (p.kind === "poly") {
        ctx.lineWidth = p.w * k;
        ctx.beginPath();
        p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        if (p.fill) {
          ctx.closePath();
          ctx.fill();
        } else ctx.stroke();
      } else if (p.kind === "dot") {
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), Math.max(p.r * k, 0.35), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const px = p.size * k;
        // Below ~3 px etched numerals are unreadable smudges; draw them faint rather than as blobs.
        if (px < 2) continue;
        ctx.globalAlpha = Math.min(1, px / 5);
        ctx.font = `600 ${px}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
        ctx.textAlign = p.align ?? "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.text, X(p.x), Y(p.y));
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
}
