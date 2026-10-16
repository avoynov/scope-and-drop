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

/** The bolt rifle's two reticles. Both are plain MRAD trees: nothing on them is cut for a load. */
export type TreeStyle = "pr2" | "ebr";

/**
 * Leupold PR2-MIL, drawn from its published descriptions (Leupold's drawing was not reachable): every
 * intersection open (marks stand clear of the line), a 0.05 mil floating dot, staggered ticks with half mils
 * on one side only, odd-numbered rows thinned so the view stays clear for trace and splash. A holdover tree of
 * small dots on every whole mil, numbered every 2 mil. Posts from 10 mil.
 */
function pr2Reticle(): Reticle {
  const p: Prim[] = [];
  const fine = 0.035;
  const post = 0.35;
  const gap = 0.3;
  const open = 0.06;
  const arm = 10;
  const stem = 20.5;
  posts(p, post, arm, stem);
  p.push({ kind: "line", x1: -arm, y1: 0, x2: -gap, y2: 0, w: fine, lit: true });
  p.push({ kind: "line", x1: gap, y1: 0, x2: arm, y2: 0, w: fine, lit: true });
  p.push({ kind: "line", x1: 0, y1: -arm, x2: 0, y2: -gap, w: fine, lit: true });
  p.push({ kind: "line", x1: 0, y1: gap, x2: 0, y2: stem, w: fine, lit: true });
  p.push({ kind: "dot", x: 0, y: 0, r: 0.025, lit: true });
  // Ticks stand clear of the line: whole mils both sides, half mils below the horizontal (left of the stem) only.
  for (let k = 1; k < arm * 2; k++) {
    const v = k / 2;
    const whole = k % 2 === 0;
    const l = whole ? 0.3 : 0.18;
    for (const sgn of [-1, 1]) {
      p.push({ kind: "line", x1: sgn * v, y1: open, x2: sgn * v, y2: open + l, w: fine });
      if (whole) p.push({ kind: "line", x1: sgn * v, y1: -open, x2: sgn * v, y2: -open - l, w: fine });
    }
    p.push({ kind: "line", x1: -open, y1: -v, x2: -open - l, y2: -v, w: fine });
    if (whole) p.push({ kind: "line", x1: open, y1: -v, x2: open + l, y2: -v, w: fine });
  }
  for (const v of [2, 4, 6, 8]) {
    for (const sgn of [-1, 1]) p.push({ kind: "text", x: sgn * v, y: -0.7, size: 0.36, text: String(v) });
    p.push({ kind: "text", x: 0.55, y: -v, size: 0.36, text: String(v), align: "left" });
  }
  // Tree: rows on every whole mil; even rows dotted every mil out to their width, odd rows only near the stem.
  for (let y = 1; y <= 20; y++) {
    const even = y % 2 === 0;
    const hw = even ? Math.min(10, Math.floor(1 + y * 0.5)) : Math.min(3, Math.floor(1 + y * 0.25));
    for (let x = -hw; x <= hw; x++) if (x) p.push({ kind: "dot", x, y, r: even ? 0.04 : 0.025 });
    // Half mils on the stem, clear of it, on the left.
    p.push({ kind: "line", x1: -open, y1: y - 0.5, x2: -open - 0.18, y2: y - 0.5, w: fine });
    p.push({ kind: "line", x1: -open - (even ? 0.3 : 0.18), y1: y, x2: -open, y2: y, w: fine });
    p.push({ kind: "line", x1: open, y1: y, x2: open + (even ? 0.3 : 0.18), y2: y, w: fine });
    if (even) p.push({ kind: "text", x: -hw - 0.5, y, size: 0.36, text: String(y), align: "right" });
  }
  return { id: "tree", name: "PR2-MIL", unitRad: MRAD, unitName: "mrad", prims: p, round: "m118lr", illum: "rgb(255,52,30)" };
}

/**
 * Vortex EBR-7D, drawn from its published descriptions and manual (the drawing's values were readable, not
 * which feature each belongs to): a 0.03 mil centre dot on a closed crosshair, 0.2 mil hashes along the
 * horizontal and down the stem for fine holds, longer marks on whole mils, numbers every 2 mil, and a tree of
 * holdover dots below the centre on every whole mil, every mil across, widening with drop for wind. Posts
 * from 10.5 mil.
 */
function ebrReticle(): Reticle {
  const p: Prim[] = [];
  const fine = 0.04;
  const thin = 0.025;
  const post = 0.4;
  const arm = 10.5;
  const stem = 16.5;
  posts(p, post, arm, stem);
  p.push({ kind: "line", x1: -arm, y1: 0, x2: arm, y2: 0, w: fine, lit: true });
  p.push({ kind: "line", x1: 0, y1: -arm, x2: 0, y2: stem, w: fine, lit: true });
  p.push({ kind: "dot", x: 0, y: 0, r: 0.015, lit: true });
  // 0.2 mil hashes, half mils longer, whole mils longest: across the horizontal, up the stem and down it.
  const hash = (v: number) => {
    const k = Math.round(v * 10);
    return k % 10 === 0 ? 0.3 : k % 5 === 0 ? 0.2 : 0.1;
  };
  for (let k = 2; k < arm * 10; k += 2) {
    const v = k / 10;
    const l = hash(v);
    const w = l > 0.25 ? fine : thin;
    for (const sgn of [-1, 1]) p.push({ kind: "line", x1: sgn * v, y1: -l / 2, x2: sgn * v, y2: l / 2, w });
    p.push({ kind: "line", x1: -l / 2, y1: -v, x2: l / 2, y2: -v, w });
  }
  for (let k = 1; k < (stem - 0.5) * 10; k++) {
    if (k % 2 && k % 5) continue;
    const v = k / 10;
    const l = hash(v);
    p.push({ kind: "line", x1: -l / 2, y1: v, x2: l / 2, y2: v, w: l > 0.25 ? fine : thin });
  }
  for (const v of [2, 4, 6, 8, 10]) {
    for (const sgn of [-1, 1]) p.push({ kind: "text", x: sgn * v, y: -0.5, size: 0.34, text: String(v) });
    p.push({ kind: "text", x: -0.5, y: -v, size: 0.34, text: String(v), align: "right" });
  }
  // Tree of holdover dots: every whole mil down, every mil across, widening with drop.
  for (let y = 1; y <= 16; y++) {
    const hw = Math.min(8, Math.floor(1 + y * 0.5));
    for (let x = -hw; x <= hw; x++) if (x) p.push({ kind: "dot", x, y, r: 0.045 });
    if (y % 2 === 0) p.push({ kind: "text", x: hw + 0.5, y, size: 0.34, text: String(y), align: "left" });
  }
  return { id: "tree", name: "EBR-7D", unitRad: MRAD, unitName: "mrad", prims: p, round: "m118lr", illum: "rgb(255,52,30)" };
}

/** Heavy posts on three sides from `arm`, and below from `stem`. */
function posts(p: Prim[], w: number, arm: number, stem: number): void {
  p.push({ kind: "line", x1: -EDGE, y1: 0, x2: -arm, y2: 0, w });
  p.push({ kind: "line", x1: arm, y1: 0, x2: EDGE, y2: 0, w });
  p.push({ kind: "line", x1: 0, y1: -EDGE, x2: 0, y2: -arm, w });
  p.push({ kind: "line", x1: 0, y1: stem, x2: 0, y2: EDGE, w });
}

/** The bolt rifle's reticle, PR2-MIL or EBR-7D. */
export const treeReticle = (style: TreeStyle = "pr2"): Reticle => (style === "ebr" ? ebrReticle() : pr2Reticle());

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
