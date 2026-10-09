/**
 * Reticle patterns as resolution-free primitives in the reticle's own angular unit.
 * x grows right, y grows DOWN (holdover is positive). Line widths are angular too, so the whole
 * pattern, strokes included, scales with magnification as on a first-focal-plane scope.
 */
import { MRAD, THOUSANDTH } from './optics';

export type Prim =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; dash?: number; lit?: boolean }
  | { kind: 'poly'; pts: [number, number][]; w: number; lit?: boolean }
  | { kind: 'dot'; x: number; y: number; r: number; lit?: boolean }
  | { kind: 'text'; x: number; y: number; size: number; text: string; align?: 'left' | 'center' | 'right'; lit?: boolean };

export interface Reticle {
  id: 'pso' | 'tree';
  name: string;
  /** Radians per reticle unit. */
  unitRad: number;
  unitName: string;
  prims: Prim[];
  /** Illumination colour (the PSO-1 lights the whole pattern; modern trees light the centre). */
  illum: string;
}

/** Edge of the drawable world in units: lines that run "to the field stop" stop here. */
const EDGE = 120;

/** Height of the PSO-1 rangefinder curve above its base line at range n×100 m, for a 1.7 m man. */
export const psoCurveHeight = (n: number) => 1.7 / (n * 100) / THOUSANDTH;

/**
 * SVD / PSO-1 style. Main chevron is the aiming point; three holdover chevrons below; a vertical stadia
 * from the last chevron down; a lateral scale every 1 thousandth to ±10 with longer marks at 5 and 10;
 * the stadiametric rangefinder at lower left (base line, dashed 1.7 m curve, ranges 2–10 ×100 m).
 */
export function psoReticle(): Reticle {
  const p: Prim[] = [];
  const W = 0.13; // stroke
  const chevron = (y: number, hw: number, h: number) => p.push({ kind: 'poly', pts: [[-hw, y + h], [0, y], [hw, y + h]], w: W, lit: true });
  chevron(0, 0.5, 1.0);
  // Holdovers for 1100/1200/1300 m with the turret on 1000 (7N1 drops ≈1.5, 2.9, 4.3 thousandths further).
  for (const y of [1.5, 2.9, 4.3]) chevron(y, 0.42, 0.85);
  p.push({ kind: 'line', x1: 0, y1: 5.5, x2: 0, y2: EDGE, w: W, lit: true });
  // Lateral scale.
  for (let i = 1; i <= 10; i++) {
    const len = i === 10 ? 1.3 : i === 5 ? 0.85 : 0.5;
    for (const s of [-1, 1]) p.push({ kind: 'line', x1: s * i, y1: 0, x2: s * i, y2: len, w: W, lit: true });
  }
  p.push({ kind: 'line', x1: -10, y1: 0, x2: -1, y2: 0, w: W * 0.8, lit: true });
  p.push({ kind: 'line', x1: 1, y1: 0, x2: 10, y2: 0, w: W * 0.8, lit: true });
  for (const s of [-1, 1]) p.push({ kind: 'text', x: s * 10, y: -0.55, size: 1.0, text: '10', lit: true });
  // Rangefinder: n = 2 at the far left, n = 10 near the centre.
  const base = 7.5;
  const xOf = (n: number) => -13.5 + ((n - 2) / 8) * 8.5;
  p.push({ kind: 'line', x1: xOf(2) - 0.4, y1: base, x2: xOf(10) + 0.3, y2: base, w: W, lit: true });
  const curve: [number, number][] = [];
  for (let n = 2; n <= 10.001; n += 0.1) curve.push([xOf(n), base - psoCurveHeight(n)]);
  for (let i = 0; i < curve.length - 1; i += 2) {
    const [x1, y1] = curve[i]!;
    const [x2, y2] = curve[i + 1]!;
    p.push({ kind: 'line', x1, y1, x2, y2, w: W * 0.8, lit: true });
  }
  for (let n = 2; n <= 10; n++) {
    const y = base - psoCurveHeight(n);
    p.push({ kind: 'line', x1: xOf(n), y1: y, x2: xOf(n), y2: y - 0.35, w: W * 0.8, lit: true });
    if (n % 2 === 0) p.push({ kind: 'text', x: xOf(n), y: y - 0.75, size: 0.85, text: String(n), lit: true });
  }
  return { id: 'pso', name: 'SVD · PSO', unitRad: THOUSANDTH, unitName: 'thousandth', prims: p, illum: 'rgb(255,46,24)' };
}

/**
 * Mil-tree ("Christmas tree") in MRAD, after the reference footage: heavy posts from 8 mil, a fine
 * crosshair hashed every 0.5 mil with a floating centre dot, and a tree of hold rows every 2 mil whose
 * width grows with drop, crosses on whole mils and dots on halves, for wind holds at long range.
 */
export function treeReticle(): Reticle {
  const p: Prim[] = [];
  const fine = 0.05;
  const post = 0.32;
  const gap = 0.25;
  // Posts.
  p.push({ kind: 'line', x1: -EDGE, y1: 0, x2: -8, y2: 0, w: post });
  p.push({ kind: 'line', x1: 8, y1: 0, x2: EDGE, y2: 0, w: post });
  p.push({ kind: 'line', x1: 0, y1: -EDGE, x2: 0, y2: -8, w: post });
  p.push({ kind: 'line', x1: 0, y1: 12, x2: 0, y2: EDGE, w: post });
  // Fine crosshair with a gap around the floating dot.
  p.push({ kind: 'line', x1: -8, y1: 0, x2: -gap, y2: 0, w: fine, lit: true });
  p.push({ kind: 'line', x1: gap, y1: 0, x2: 8, y2: 0, w: fine, lit: true });
  p.push({ kind: 'line', x1: 0, y1: -8, x2: 0, y2: -gap, w: fine, lit: true });
  p.push({ kind: 'line', x1: 0, y1: gap, x2: 0, y2: 12, w: fine, lit: true });
  p.push({ kind: 'dot', x: 0, y: 0, r: 0.07, lit: true });
  // Hashes: whole mil 0.4 long, half mil 0.2.
  for (let i = 1; i < 16; i++) {
    const v = i / 2;
    const half = i % 2 === 1;
    const l = half ? 0.1 : 0.2;
    if (v < 8) for (const s of [-1, 1]) p.push({ kind: 'line', x1: s * v, y1: -l, x2: s * v, y2: l, w: fine });
    if (v < 8) p.push({ kind: 'line', x1: -l, y1: -v, x2: l, y2: -v, w: fine });
  }
  for (let i = 1; i < 24; i++) {
    const v = i / 2;
    const l = i % 2 === 1 ? 0.1 : 0.2;
    if (v % 2 !== 0) p.push({ kind: 'line', x1: -l, y1: v, x2: l, y2: v, w: fine });
  }
  for (const v of [2, 4, 6]) for (const s of [-1, 1]) p.push({ kind: 'text', x: s * v, y: -0.45, size: 0.32, text: String(v) });
  // Tree rows.
  for (let y = 2; y <= 10; y += 2) {
    const hw = 1 + y / 2;
    for (let k = -hw * 2; k <= hw * 2; k++) {
      const x = k / 2;
      if (x === 0) continue;
      if (k % 2 === 0) {
        const a = 0.12;
        p.push({ kind: 'line', x1: x - a, y1: y, x2: x + a, y2: y, w: fine });
        p.push({ kind: 'line', x1: x, y1: y - a, x2: x, y2: y + a, w: fine });
      } else p.push({ kind: 'dot', x, y, r: 0.05 });
    }
    p.push({ kind: 'line', x1: -0.2, y1: y, x2: 0.2, y2: y, w: fine });
    p.push({ kind: 'text', x: hw + 0.45, y: y + 0.12, size: 0.32, text: String(y), align: 'left' });
  }
  return { id: 'tree', name: 'MIL TREE', unitRad: MRAD, unitName: 'mrad', prims: p, illum: 'rgb(255,52,30)' };
}

export const RETICLES = { pso: psoReticle, tree: treeReticle } as const;

/**
 * Paints a reticle onto a 2D canvas. `pxPerUnit` is set by magnification (FFP), so strokes thin out at
 * low power exactly like etched glass does; sub-pixel strokes are left to the canvas's coverage AA.
 */
export function drawReticle(ctx: CanvasRenderingContext2D, r: Reticle, cx: number, cy: number, pxPerUnit: number, ink: string, lit: string | null): void {
  const k = pxPerUnit;
  const X = (x: number) => cx + x * k;
  const Y = (y: number) => cy + y * k;
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  for (const pass of lit ? [0, 1] : [0]) {
    for (const p of r.prims) {
      if (pass === 1 && !p.lit) continue;
      const col = pass === 1 ? lit! : ink;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      if (p.kind === 'line') {
        ctx.lineWidth = p.w * k;
        ctx.beginPath();
        ctx.moveTo(X(p.x1), Y(p.y1));
        ctx.lineTo(X(p.x2), Y(p.y2));
        ctx.stroke();
      } else if (p.kind === 'poly') {
        ctx.lineWidth = p.w * k;
        ctx.beginPath();
        p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        ctx.stroke();
      } else if (p.kind === 'dot') {
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), Math.max(p.r * k, 0.35), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const px = p.size * k;
        // Below ~3 px etched numerals are unreadable smudges; draw them faint rather than as blobs.
        if (px < 2) continue;
        ctx.globalAlpha = Math.min(1, px / 5);
        ctx.font = `600 ${px}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
        ctx.textAlign = p.align ?? 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.text, X(p.x), Y(p.y));
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
}
