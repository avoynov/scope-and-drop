/**
 * Reticle patterns as resolution-free primitives in the reticle's own angular unit.
 * x grows right, y grows DOWN (holdover is positive). Line widths are angular too, so the whole
 * pattern, strokes included, scales with magnification as on a first-focal-plane scope.
 */
import { ROUNDS, holdRad, type RoundId } from "./ballistics";
import { MRAD, THOUSANDTH } from "./optics";
import { BATTLE_ZERO_M, RIFLES } from "./shot";

export type Prim =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; w: number; dash?: number; lit?: boolean }
  | { kind: "poly"; pts: [number, number][]; w: number; lit?: boolean }
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
 * Mil tree in MRAD for the bolt rifle, after two real FFP reticles the user picked, drawn from their published
 * descriptions (not traced from the makers' drawings):
 *  - Leupold PR2-MIL: every intersection open, a 0.05 mil floating dot, half-mil ticks on one side of the line
 *    only, odd-numbered rows thinned so the view stays clear for spotting trace and splash.
 *  - Vortex EBR-7D: 0.2 mil hashes near the centre for fine holds, and a tree of holdover dots on every whole
 *    mil below the centre, widening with drop for wind holds.
 * Heavy posts from 10.5 mil (20.5 mil below, past the tree). Nothing is cut for a load: the shooter dials the
 * DOPE card's elevation on the turret, or holds it on the tree, and holds wind on the rows.
 */
export function treeReticle(): Reticle {
  const p: Prim[] = [];
  const fine = 0.04;
  const thin = 0.025;
  const post = 0.4;
  const gap = 0.25;
  const arm = 10.5;
  const stem = 20.5;
  // Posts.
  p.push({ kind: "line", x1: -EDGE, y1: 0, x2: -arm, y2: 0, w: post });
  p.push({ kind: "line", x1: arm, y1: 0, x2: EDGE, y2: 0, w: post });
  p.push({ kind: "line", x1: 0, y1: -EDGE, x2: 0, y2: -arm, w: post });
  p.push({ kind: "line", x1: 0, y1: stem, x2: 0, y2: EDGE, w: post });
  // Fine crosshair, open at the centre round the floating dot.
  p.push({ kind: "line", x1: -arm, y1: 0, x2: -gap, y2: 0, w: fine, lit: true });
  p.push({ kind: "line", x1: gap, y1: 0, x2: arm, y2: 0, w: fine, lit: true });
  p.push({ kind: "line", x1: 0, y1: -arm, x2: 0, y2: -gap, w: fine, lit: true });
  p.push({ kind: "line", x1: 0, y1: gap, x2: 0, y2: stem, w: fine, lit: true });
  p.push({ kind: "dot", x: 0, y: 0, r: 0.025, lit: true });
  // Horizontal line and the stem above: whole mils across the line, half mils on one side only (below the
  // horizontal, left of the stem), 0.2 mil hashes inside 2 mil.
  for (let k = 1; k < arm * 10; k++) {
    const v = k / 10;
    const whole = k % 10 === 0;
    const half = k % 5 === 0 && !whole;
    const tenth = !whole && !half && k % 2 === 0 && v < 2;
    if (!whole && !half && !tenth) continue;
    const l = whole ? 0.25 : half ? 0.18 : 0.1;
    for (const sgn of [-1, 1]) {
      const x = sgn * v;
      p.push({ kind: "line", x1: x, y1: whole ? -l : 0, x2: x, y2: l, w: whole ? fine : thin });
    }
    p.push({ kind: "line", x1: -l, y1: -v, x2: whole ? l : 0, y2: -v, w: whole ? fine : thin });
  }
  for (const v of [2, 4, 6, 8, 10]) {
    for (const sgn of [-1, 1]) p.push({ kind: "text", x: sgn * v, y: -0.55, size: 0.36, text: String(v) });
    p.push({ kind: "text", x: -0.6, y: -v, size: 0.36, text: String(v), align: "right" });
  }
  // Stem below: 0.2 mil hashes to 2 mil, half mils on the left after.
  for (let k = 1; k < 20 * 5; k++) {
    const v = k / 5;
    if (v % 1 === 0) continue;
    if (v > 2 && Math.abs((v % 1) - 0.5) > 1e-9) continue;
    const l = Math.abs((v % 1) - 0.5) < 1e-9 ? 0.18 : 0.1;
    p.push({ kind: "line", x1: -l, y1: v, x2: v < 2 ? l : 0, y2: v, w: thin });
  }
  // Tree: a row on every whole mil to 20, holdover dots every mil across, widening with drop. Even rows carry a
  // short line across the stem and their number; odd rows are dots only, smaller.
  for (let y = 1; y <= 20; y++) {
    const even = y % 2 === 0;
    const hw = Math.min(10, Math.floor(1 + y * 0.5));
    for (let x = -hw; x <= hw; x++) {
      if (x === 0) continue;
      p.push({ kind: "dot", x, y, r: even ? 0.05 : 0.035 });
    }
    p.push({ kind: "line", x1: -(even ? 0.3 : 0.18), y1: y, x2: even ? 0.3 : 0.18, y2: y, w: even ? fine : thin });
    if (even) p.push({ kind: "text", x: hw + 0.5, y, size: 0.36, text: String(y), align: "left" });
  }
  return { id: "tree", name: "PR2 · EBR TREE", unitRad: MRAD, unitName: "mrad", prims: p, round: "m118lr", illum: "rgb(255,52,30)" };
}

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
        ctx.stroke();
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
