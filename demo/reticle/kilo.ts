/**
 * The Sig KILO8K-ABS in the lab (its behaviour is in src/scope/kilo.ts): the body as the eye sees it on the way up,
 * the hands that hold it, how it comes up from beside the rifle to the eye and goes back, and its red OLED drawn
 * pixel by pixel over the image in the eyepiece.
 *
 * Its frame (mm): origin at the eye point, 16 mm behind the eyepiece lens; −z out through the objective, +y up.
 * The body is a vertical monocular, 112 long (eyecup rim to objective bezel) × 76 tall (with the buttons) × 33
 * wide, the optical axis high in it: the objective over the laser's transmitter on the front, the eyepiece over
 * the CR2's screw cap at the back, RANGE (front) and MODE on top, the lanyard eye under the back. Flat Dark Earth
 * with darker rubber grip panels, the eyecup black rubber, the diopter ring just ahead of it.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { KILO8K, KILO_PX_PER_MRAD, type KiloReticle, type OledOp } from "../../src/scope/kilo";
import { armOf, blendPose, compose, minJerk, qBasis, qSlerp, type FingerPose, type Frame, type HandState, type Quat, type Side, type V3 } from "../../src/scope/handling";

export interface KiloModel {
  group: THREE.Group;
  /** Places it: its frame in the scope's frame (mm, quaternion). */
  setPose(f: Frame): void;
}

/** Builds the body. `mat(base, gloss, spec, lens)` makes a material; `place` puts a mesh on its render layer. */
export function buildKilo(mat: (base: number, gloss: number, spec: number, lens?: number) => THREE.Material, place: (o: THREE.Mesh) => void): KiloModel {
  const root = new THREE.Group();
  const group = new THREE.Group();
  group.scale.setScalar(0.001);
  root.add(group);
  const fde = mat(0x8c7a5b, 10, 0.08);
  const rubber = mat(0x4a4236, 4, 0.05);
  const black = mat(0x141414, 6, 0.08);
  const metal = mat(0x1c1c1c, 40, 0.3);
  const coated = mat(0x07080b, 120, 0.9);
  const eyeGlass = mat(0x000000, 0, 0, 1);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.frustumCulled = false;
    o.name = "kilo";
    place(o);
    group.add(o);
    return o;
  };
  const cylZ = (r0: number, r1: number, z0: number, z1: number, seg = 40, open = false) => {
    const g = new THREE.CylinderGeometry(r1, r0, Math.abs(z1 - z0), seg, 1, open);
    g.rotateX(z1 < z0 ? -Math.PI / 2 : Math.PI / 2);
    g.translate(0, 0, (z0 + z1) / 2);
    return g;
  };
  const disc = (r: number, back = false) => {
    const g = new THREE.CircleGeometry(r, 40);
    if (!back) g.rotateY(Math.PI);
    return g;
  };
  // Body: rear face 28 mm ahead of the eye, front 120; the axis 16 mm under its top.
  const [zr, zf, top, bot] = [-28, -120, 16, -56];
  mesh(new RoundedBoxGeometry(33, top - bot, zr - zf, 3, 7), fde, 0, (top + bot) / 2, (zr + zf) / 2);
  // Rubber grip panels on both sides, slightly proud.
  for (const s of [-1, 1]) mesh(new RoundedBoxGeometry(1.6, 52, 62, 2, 0.7), rubber, s * 16.6, -22, -78);
  // Front: the objective (25 mm) in a black bezel, the transmitter under it.
  mesh(cylZ(16, 15, zf + 1, zf - 4), black);
  mesh(cylZ(12.5, 12.5, zf - 4, zf - 4.5), black);
  mesh(disc(12.5), coated, 0, 0, zf - 3.2);
  mesh(cylZ(10.5, 10, zf + 1, zf - 2.5), black, 0, -35);
  mesh(disc(8), coated, 0, -35, zf - 1.8);
  // Back: the diopter ring (knurled), the twist-up eyecup, the eyepiece lens 16 mm ahead of the eye.
  const knurl = cylZ(16.5, 16.5, zr, zr + 6, 48);
  {
    const p = knurl.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getY(i), p.getX(i));
      const k = 1 + 0.025 * Math.sign(Math.sin(a * 24));
      p.setXY(i, p.getX(i) * k, p.getY(i) * k);
    }
  }
  mesh(knurl, black);
  mesh(cylZ(15.5, 15, zr + 6, -12, 48, true), black);
  mesh(new THREE.RingGeometry(10.5, 15, 48), black, 0, 0, -12);
  mesh(cylZ(10.5, 10.5, -16, -12, 40, true), black);
  mesh(disc(10.5, true), eyeGlass, 0, 0, -16);
  // The CR2 compartment's screw cap, low on the back, with its coin slot.
  mesh(cylZ(9.5, 9.5, zr, zr + 2.2), metal, 0, -37);
  mesh(new THREE.BoxGeometry(12, 1.2, 0.6), black, 0, -37, zr + 2.3);
  // Top: RANGE, a broad domed key at the front; MODE, smaller, behind it.
  const key = (r: number, z: number) => {
    const g = new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, 0.4, 1);
    return mesh(g, black, 0, top - 0.3, z);
  };
  key(7, -98);
  key(4.6, -70);
  // Lanyard eye under the back.
  const eyeR = new THREE.TorusGeometry(4, 1.3, 8, 20);
  eyeR.rotateY(Math.PI / 2);
  mesh(eyeR, black, 0, bot - 2, zr - 8);
  return {
    group: root,
    setPose(f) {
      root.position.set(f.p[0] / 1000, f.p[1] / 1000, f.p[2] / 1000);
      root.quaternion.set(...f.q);
    },
  };
}

// ---- holding it ----

/**
 * Both hands, binocular fashion: the right wraps the body's back half from the right, fingers forward and up over
 * the top with the index on RANGE; the left cradles the front from under it. The held point of each (see GRASP in
 * handling.ts) in the device's frame, and the finger poses.
 */
const HOLD: Record<Side, { at: V3; fwd: V3; palm: V3; grasp: V3; pose: FingerPose }> = {
  R: {
    at: [0, -22, -76],
    fwd: [0, 0.45, -0.89],
    palm: [-1, 0, 0],
    grasp: [-2, -30, -90],
    pose: {
      f: [0.35, 0.55, 0.35, 1.0, 1.35, 0.8, 1.1, 1.4, 0.8, 1.2, 1.35, 0.8],
      t: [0.85, 0.35, 0.3],
    },
  },
  L: {
    at: [0, -48, -96],
    fwd: [0.15, 0.25, -0.96],
    palm: [0.15, 1, 0],
    grasp: [0, -30, -80],
    pose: {
      f: [0.35, 0.8, 0.45, 0.4, 0.85, 0.5, 0.45, 0.85, 0.5, 0.5, 0.85, 0.5],
      t: [0.6, 0.3, 0.25],
    },
  },
};
const holdFrame = (s: Side): Frame => {
  const h = HOLD[s];
  const g: V3 = s === "L" ? [-h.grasp[0], h.grasp[1], h.grasp[2]] : h.grasp;
  const q = qBasis(h.fwd, h.palm);
  // The wrist sits back from the held point by the grasp, in the hand's own frame.
  const held: Frame = { p: h.at, q };
  return compose(held, { p: [-g[0], -g[1], -g[2]], q: [0, 0, 0, 1] });
};
const WRIST = { R: holdFrame("R"), L: holdFrame("L") };

/** Lying on the ground by the right hand, on its left side, eyepiece toward the shooter (scope frame, mm). */
const STOWED: Frame = { p: [165, -215, -170], q: [0.0, 0.17, -0.69, 0.7] };

/** Seconds: the right hand reaches it, lifts it to the eye; the left hand joins on the way. */
export const KILO_UP_S = 1.15;
export const KILO_DOWN_S = 1.0;
const REACH = [0, 0.35] as const;
const LIFT = [0.35, 1.05] as const;
const JOIN = [0.45, 0.95] as const;

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const phase = (u: number, [a, b]: readonly [number, number]) => minJerk(Math.max(0, Math.min(1, (u - a) / (b - a))));

export interface KiloRig {
  device: Frame;
  hands: Record<Side, HandState>;
  /** How far it has come to the eye: 0 on the ground, 1 at the eye. */
  at: number;
}

/**
 * Where the device and the hands are `u` seconds into bringing it up (or, for `down`, putting it down: the same
 * moves backwards), with `eye` its frame at the eye and `rest` the hands where they live on the rifle.
 */
export function kiloRig(u: number, dir: "up" | "down", eye: Frame, rest: Record<Side, HandState>): KiloRig {
  const s = dir === "up" ? u : KILO_UP_S * (1 - Math.min(1, u / KILO_DOWN_S));
  const b = phase(s, LIFT);
  // Out from the ground and up in an arc, turning upright on the way.
  const arc: V3 = [-20, 40, 30];
  const k = Math.sin(Math.PI * b);
  const base = lerp3(STOWED.p, eye.p, b);
  const device: Frame = { p: [base[0] + arc[0] * k, base[1] + arc[1] * k, base[2] + arc[2] * k], q: qSlerp(STOWED.q, eye.q, b) };
  const hand = (side: Side, w: number): HandState => {
    const held = compose(device, WRIST[side]);
    const r = rest[side];
    const wrist: Frame = { p: lerp3(r.wrist.p, held.p, w), q: qSlerp(r.wrist.q, held.q, w) };
    return { wrist, pose: blendPose(r.pose, HOLD[side].pose, Math.min(1, w * 1.15)), arm: armOf(wrist, side) };
  };
  return { device, hands: { R: hand("R", phase(s, REACH)), L: hand("L", phase(s, JOIN)) }, at: b };
}

// ---- its screen ----

/** 5 × 7 pixel glyphs, rows top to bottom. ^ v < > draw the arrows, * the degree sign. */
const FONT: Record<string, string> = {
  "0": "01110 10001 10011 10101 11001 10001 01110",
  "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111",
  "3": "11111 00010 00100 00010 00001 10001 01110",
  "4": "00010 00110 01010 10010 11111 00010 00010",
  "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110",
  "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110",
  "9": "01110 10001 10001 01111 00001 00010 01100",
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11100 10010 10001 10001 10001 10010 11100",
  E: "11111 10000 10000 11110 10000 10000 11111",
  F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110",
  J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 10001 11001 10101 10011 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101",
  R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010",
  X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 10001 01010 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  ".": "00000 00000 00000 00000 00000 01100 01100",
  "-": "00000 00000 00000 11111 00000 00000 00000",
  ":": "00000 01100 01100 00000 01100 01100 00000",
  "/": "00001 00010 00010 00100 01000 01000 10000",
  " ": "00000 00000 00000 00000 00000 00000 00000",
  "^": "00000 00100 01110 11111 00000 00000 00000",
  v: "00000 00000 00000 11111 01110 00100 00000",
  "<": "00010 00110 01110 11110 01110 00110 00010",
  ">": "01000 01100 01110 01111 01110 01100 01000",
  "*": "01100 10010 10010 01100 00000 00000 00000",
};

/** Lights the OLED's pixels for a list of draw operations. */
export function rasterOled(ops: OledOp[]): Uint8Array {
  const { w, h } = KILO8K.oled;
  const px = new Uint8Array(w * h);
  const set = (x: number, y: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = 1;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y);
  };
  const cx = w / 2;
  const cy = h / 2;
  for (const op of ops) {
    if (op.k === "text") {
      const adv = 6 * op.size;
      const width = op.s.length * adv - op.size;
      let x = op.align === "l" ? op.x : op.align === "c" ? op.x - width / 2 : op.x - width;
      x = Math.round(x);
      for (const ch of op.s) {
        const rows = (FONT[ch] ?? FONT[" "]!).split(" ");
        rows.forEach((row, j) => {
          for (let i = 0; i < 5; i++) if (row[i] === "1") rect(x + i * op.size, op.y + j * op.size, x + i * op.size + op.size - 1, op.y + j * op.size + op.size - 1);
        });
        x += adv;
      }
    } else if (op.k === "battery") {
      // Outline, a nub, three bars: full.
      rect(op.x, op.y, op.x + 20, op.y);
      rect(op.x, op.y + 8, op.x + 20, op.y + 8);
      rect(op.x, op.y, op.x, op.y + 8);
      rect(op.x + 20, op.y, op.x + 20, op.y + 8);
      rect(op.x + 21, op.y + 3, op.x + 22, op.y + 5);
      for (let b = 0; b < 3; b++) rect(op.x + 2 + b * 6, op.y + 2, op.x + 6 + b * 6, op.y + 6);
    } else drawReticle(op.style, cx, cy, set, rect);
  }
  return px;
}

/**
 * The five reticles, sized in the OLED's pixels (≈ 3.2 to the mrad). Sizes are not published: the circle is taken
 * at 3 mrad across, about twice the beam's width, so the beam falls inside it; the grids are ticked every mrad.
 */
function drawReticle(style: KiloReticle, cx: number, cy: number, set: (x: number, y: number) => void, rect: (x0: number, y0: number, x1: number, y1: number) => void): void {
  const ring = (r: number) => {
    for (let a = 0; a < 360; a += 2) set(cx - 0.5 + r * Math.cos((a * Math.PI) / 180), cy - 0.5 + r * Math.sin((a * Math.PI) / 180));
  };
  const mil = KILO_PX_PER_MRAD;
  if (style === "BOX") {
    const r = Math.round(1.6 * mil);
    rect(cx - r, cy - r, cx + r, cy - r);
    rect(cx - r, cy + r, cx + r, cy + r);
    rect(cx - r, cy - r, cx - r, cy + r);
    rect(cx + r, cy - r, cx + r, cy + r);
    return;
  }
  if (style === "DUPLEX") {
    // Thin cross through a gap at the centre, heavy posts outside 12 mrad.
    const g = Math.round(1.5 * mil);
    const p = Math.round(12 * mil);
    const e = Math.round(26 * mil);
    rect(cx + g, cy, cx + p, cy);
    rect(cx - p, cy, cx - g, cy);
    rect(cx, cy + g, cx, cy + p);
    rect(cx, cy - p, cx, cy - g);
    rect(cx + p, cy - 1, cx + e, cy + 1);
    rect(cx - e, cy - 1, cx - p, cy + 1);
    rect(cx - 1, cy + p, cx + 1, cy + e);
    rect(cx - 1, cy - e, cx + 1, cy - p);
    return;
  }
  ring(1.5 * mil);
  if (style === "CIRCLE") return;
  const ticks = (vertical: boolean) => {
    for (let m = -10; m <= 10; m++) {
      if (m === 0) continue;
      const o = Math.round(m * mil);
      const l = m % 5 === 0 ? 4 : 2;
      if (vertical) rect(cx - l, cy + o, cx + l, cy + o);
      else rect(cx + o, cy - l, cx + o, cy + l);
    }
    const end = Math.round(10 * mil);
    if (vertical) rect(cx, cy + Math.round(2 * mil), cx, cy + end), rect(cx, cy - end, cx, cy - Math.round(2 * mil));
    else rect(cx + Math.round(2 * mil), cy, cx + end, cy), rect(cx - end, cy, cx - Math.round(2 * mil), cy);
  };
  ticks(false);
  if (style === "GRID") ticks(true);
}

/**
 * Paints the lit pixels into the eyepiece overlay: a canvas spanning the field stop's diameter, the panel centred
 * and `KILO8K.oledSpan` of it wide. Each pixel a slightly rounded red square with a dark gap round it, and a faint
 * glow, as an OLED looks under 7× eyepiece magnification. Straight alpha; the composite adds the light.
 */
export function paintOled(ctx: CanvasRenderingContext2D, size: number, px: Uint8Array): void {
  const { w, h } = KILO8K.oled;
  const p = (KILO8K.oledSpan * size) / w;
  const x0 = size / 2 - (w * p) / 2;
  const y0 = size / 2 - (h * p) / 2;
  if (lit.width !== size) lit.width = lit.height = size;
  const g = lit.getContext("2d")!;
  g.clearRect(0, 0, size, size);
  g.fillStyle = "rgb(255, 44, 18)";
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (px[y * w + x]) g.fillRect(x0 + (x + 0.08) * p, y0 + (y + 0.08) * p, p * 0.84, p * 0.84);
    }
  ctx.clearRect(0, 0, size, size);
  // The glow once over the whole panel (a canvas filter applies per drawing call), then the pixels themselves.
  ctx.save();
  ctx.filter = `blur(${Math.max(1, p * 0.9)}px)`;
  ctx.globalAlpha = 0.35;
  ctx.drawImage(lit, 0, 0);
  ctx.restore();
  ctx.drawImage(lit, 0, 0);
}
const lit = document.createElement("canvas");

/** Quaternion [x, y, z, w] of a THREE quaternion, and back. */
export const toQuat = (q: THREE.Quaternion): Quat => [q.x, q.y, q.z, q.w];
