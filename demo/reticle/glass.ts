/**
 * The glass screens: a glazed window frame standing 4 m in front of each mannequin, so every rifle can be fired
 * through glass at the range it is meant for. The panel picks the glazing (src/scope/glass.ts) and turns the
 * frame up to 60° either way; "New pane" glazes it again.
 *
 * What the shooter sees through the scope:
 *  - The pane itself: both faces reflect the sky by Fresnel (4 % square-on, much more at a slant) and the sun
 *    glints off it; behind it the range shows through, dimmed by what the glass reflects and absorbs.
 *  - A bullet hole, drawn when the bullet gets there: annealed glass breaks into a star of radial cracks with
 *    a few concentric ones and a frosted cone blown out of the back face around a hole the size of the bullet;
 *    a slow bullet cracks it further than a fast one, which is through before the plate can bend. Laminated
 *    glass crazes into a dense spider web round a crushed white disc and keeps its PVB. Tempered glass dices
 *    all over at once (its cracks run at ~1500 m/s) and falls out of the frame in a glittering cascade.
 *  - Glass fragments sprayed out of the back face, mostly square to the pane, some along the bullet, and a few
 *    blown back toward the shooter (spray.ts-style closed-form particles, in shooting.ts's sprite batch).
 * Everything is a function of the time since the bullet arrived, so stills are exact.
 */
import * as THREE from 'three';
import { GLAZING, glazingDepth, type Glazing, type GlazingId, type Sheet, type Through } from '../../src/scope/glass';
import type { Vec3 } from '../../src/scope/shot';
import { heightAt, type Range } from './scene';

/** The glazed opening (m), its sill height, the frame's timber, and how far in front of the mannequin it stands. */
const PANE_W = 1.0, PANE_H = 1.3, SILL = 0.62, BAR = 0.06, BEFORE_M = 4;
const TEX = 512;
const WOOD = 0x7a6248;
/** Mean glass colour for the flecks: pale, a touch green at the edges. */
const FLECK = new THREE.Color(0.8, 0.88, 0.88);

/** Repeatable random numbers in [0, 1). */
function rnd(seed: number, i: number): number {
  let h = Math.imul(seed * 7919 + i * 104729, 0x27d4eb2d) ^ 0x2545f491;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const vert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWPos;
  varying vec3 vN;
  void main(){
    vUv = uv;
    vec4 w = modelMatrix*vec4(position, 1.);
    vWPos = w.xyz;
    vN = normalize(mat3(modelMatrix)*normal);
    gl_Position = projectionMatrix*viewMatrix*w;
  }`;
const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D tDamage;
  uniform vec3 uSun;
  uniform vec4 uCraze;
  uniform float uTime;
  uniform vec2 uSize;
  uniform float uTrans;
  varying vec2 vUv;
  varying vec3 vWPos;
  varying vec3 vN;
  vec2 h22(vec2 p){ vec3 q = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz)*q.zy); }
  float h12(vec2 p){ vec3 q = fract(vec3(p.xyx)*.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y)*q.z); }
  void main(){
    vec3 V = normalize(vWPos - cameraPosition);
    vec3 N = normalize(vN);
    if (dot(N, V) > 0.) N = -N;
    float c = clamp(-dot(N, V), 0., 1.);
    // Schlick's Fresnel for one face, n = 1.52; both faces of the sheet together.
    float F = .043 + .957*pow(1. - c, 5.);
    float R = 2.*F/(1. + F);
    vec3 r = reflect(V, N);
    // The sky as the dome draws it, the sunlit ground below the horizon, and the sun's glint.
    vec3 refl = r.y > 0. ? mix(vec3(.80,.84,.88), vec3(.42,.58,.78), pow(r.y, .55)) : mix(vec3(.72,.70,.64), vec3(.56,.48,.36), clamp(-r.y*8., 0., 1.));
    refl += vec3(1., .95, .87)*40.*pow(max(dot(r, uSun), 0.), 4000.);
    vec4 d = texture2D(tDamage, vUv);
    float crack = d.r, frost = d.g;
    if (d.b > .5) discard;
    vec2 p = (vUv - .5)*uSize;
    if (uCraze.w > .5) {
      // Tempered glass dices all over at once, finer near the impact; then the dice let go, from the impact out.
      float t = uTime - uCraze.z;
      float dist = length(p - uCraze.xy);
      float cell = mix(.007, .016, smoothstep(0., .35, dist));
      vec2 q = p/cell, qi = floor(q), qf = fract(q);
      float d1 = 9., d2 = 9.;
      vec2 best = qi;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 rr = g + h22(qi + g) - qf;
        float dd = dot(rr, rr);
        if (dd < d1) { d2 = d1; d1 = dd; best = qi + g; } else if (dd < d2) d2 = dd;
      }
      if (t > .12 + dist*.6 + h12(best)*.3) discard;
      float edge = sqrt(d2) - sqrt(d1);
      float px = fwidth(q.x) + fwidth(q.y);
      float line = 1. - smoothstep(0., .1 + px, edge);
      // Finer than a pixel the net averages out to a silvery frost.
      line = mix(line, .28, smoothstep(.25, 1., px));
      crack = max(crack, line);
      frost = max(frost, .12);
    }
    // Crack faces catch the sun and sky like little mirrors.
    vec3 lit = vec3(.9, .93, .95)*(.55 + .7*max(dot(N, uSun), 0.));
    vec3 col = refl*R + lit*(crack*.65 + frost*.8);
    float a = 1. - uTrans*(1. - R);
    a = max(a, max(crack*.65, frost*.85));
    gl_FragColor = vec4(col, a);
  }`;

interface Hole {
  u: number;
  v: number;
  r: number;
}
interface SheetState {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  tempered: boolean;
  laminated: boolean;
  /** For later bullets: where it is already holed, and when (in the bullet's terms) it fell out. */
  holes: Hole[];
  goneAt: number;
}
interface Screen {
  group: THREE.Group;
  frame: THREE.Mesh[];
  sheets: SheetState[];
  /** Front face's centre, its normal toward the shooter, and the pane's right and up. */
  centre: THREE.Vector3;
  normal: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** Faces the shooter at this yaw; the panel turns it from there. */
  face: number;
}
/** A bullet through one sheet, for drawing. */
interface Mark {
  at: number;
  screen: number;
  sheet: number;
  u: number;
  v: number;
  speed: number;
  obliquity: number;
  diaM: number;
  seed: number;
  /** It glanced off: cracks and a scuff, no hole. */
  chip: boolean;
  drawn: boolean;
}

/** One sheet's pass, for the spray: where, which way the pane faces, which way the bullet went. */
export interface GlassSpray {
  at: number;
  pos: Vec3;
  normal: Vec3;
  dir: Vec3;
  tempered: boolean;
  /** It glanced off the front face, which throws its chips back toward the shooter. */
  chip: boolean;
  /** For tempered glass: the pane's centre, right and up, to drop its dice from. */
  centre: Vec3;
  right: Vec3;
  up: Vec3;
  ground: number;
  seed: number;
}

export type GlassScreens = ReturnType<typeof createGlass>;

export type AddSprite = (x: number, y: number, z: number, size: number, alpha: number, c: THREE.Color, seed: number, hard: number) => void;

export function createGlass(range: Range, eye: THREE.Vector3) {
  const wood = new THREE.MeshLambertMaterial({ color: WOOD });
  const screens: Screen[] = [];
  const marks: Mark[] = [];
  let glazing: Glazing | null = null;
  let glazingId: GlazingId | null = null;
  let angle = 0;
  const sun = new THREE.Vector3();
  for (const m of range.targets) {
    const toEye = new THREE.Vector3(eye.x - m.foot.x, 0, eye.z - m.foot.z).normalize();
    const base = m.foot.clone().addScaledVector(toEye, BEFORE_M);
    base.y = heightAt(base.x, base.z);
    const group = new THREE.Group();
    group.position.copy(base);
    const face = Math.atan2(toEye.x, toEye.z);
    group.rotation.y = face;
    // The frame: head, sill and stiles round the opening, the stiles run down to the ground on splayed feet.
    const box = (w: number, h: number, dz: number, x: number, y: number, z = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, dz), wood);
      b.position.set(x, y, z);
      b.name = 'frame';
      b.castShadow = b.receiveShadow = true;
      group.add(b);
      return b;
    };
    const top = SILL + PANE_H;
    const frame = [
      box(PANE_W + 2 * BAR, BAR, 0.07, 0, top + BAR / 2),
      box(PANE_W + 2 * BAR, BAR, 0.09, 0, SILL - BAR / 2),
      box(BAR, top + BAR, 0.07, -(PANE_W + BAR) / 2, (top + BAR) / 2),
      box(BAR, top + BAR, 0.07, (PANE_W + BAR) / 2, (top + BAR) / 2),
      box(BAR, BAR, 0.7, -(PANE_W + BAR) / 2, BAR / 2),
      box(BAR, BAR, 0.7, (PANE_W + BAR) / 2, BAR / 2),
    ];
    group.visible = false;
    range.scene.add(group);
    screens.push({ group, frame, sheets: [], centre: new THREE.Vector3(), normal: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), face });
  }

  const paneGeo = new THREE.PlaneGeometry(PANE_W, PANE_H);
  function makeSheet(sh: Sheet, depth: number, thick: number): SheetState {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TEX;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    const glassMm = sh.plies.filter((p) => p.k !== 'pvb').reduce((a, p) => a + p.mm, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        tDamage: { value: tex },
        uSun: { value: sun },
        uCraze: { value: new THREE.Vector4(0, 0, 0, 0) },
        uTime: { value: 0 },
        uSize: { value: new THREE.Vector2(PANE_W, PANE_H) },
        // Float glass absorbs about 0.6 % per mm; the PVB a little more.
        uTrans: { value: Math.exp(-0.006 * glassMm) * (sh.plies.some((p) => p.k === 'pvb') ? 0.97 : 1) },
      },
    });
    const mesh = new THREE.Mesh(paneGeo, mat);
    mesh.position.set(0, SILL + PANE_H / 2, -(depth + thick / 2));
    mesh.name = 'pane';
    mesh.renderOrder = 1;
    return {
      mesh, mat, ctx, tex,
      tempered: sh.plies.some((p) => p.k === 'tempered'),
      laminated: sh.plies.some((p) => p.k === 'pvb'),
      holes: [],
      goneAt: Infinity,
    };
  }

  /** Glazes both frames afresh with `id` (null takes them away), turned `deg` from square-on (+ turns the pane's face to the shooter's right). */
  function set(id: GlazingId | null, deg: number): void {
    glazingId = id;
    glazing = id ? GLAZING[id] : null;
    angle = (deg * Math.PI) / 180;
    marks.length = 0;
    for (const s of screens) {
      for (const sh of s.sheets) {
        s.group.remove(sh.mesh);
        sh.mat.dispose();
        sh.tex.dispose();
      }
      s.sheets = [];
      s.group.visible = !!glazing;
      s.group.rotation.y = s.face + angle;
      s.group.updateMatrixWorld(true);
      s.normal.set(0, 0, 1).applyQuaternion(s.group.quaternion);
      s.right.set(1, 0, 0).applyQuaternion(s.group.quaternion);
      s.centre.set(0, SILL + PANE_H / 2, 0).applyMatrix4(s.group.matrixWorld);
      if (!glazing) continue;
      let depth = 0;
      for (const sh of glazing.sheets) {
        depth += sh.gapMm / 1000;
        const thick = sh.plies.reduce((a, p) => a + p.mm, 0) / 1000;
        const st = makeSheet(sh, depth, thick);
        s.sheets.push(st);
        s.group.add(st.mesh);
        depth += thick;
      }
    }
  }

  /** Pane coordinates (m from its centre, right and up) of a world point. */
  const local = (s: Screen, p: Vec3): [number, number] => {
    const dx = p[0] - s.centre.x, dy = p[1] - s.centre.y, dz = p[2] - s.centre.z;
    return [dx * s.right.x + dy * s.right.y + dz * s.right.z, dx * s.up.x + dy * s.up.y + dz * s.up.z];
  };
  /** Whether sheet `k` still has glass at (u, v). */
  const intact = (st: SheetState, u: number, v: number) => st.goneAt === Infinity && !st.holes.some((h) => Math.hypot(u - h.u, v - h.v) < h.r);

  /**
   * Where the segment a→b meets the front of a pane that still has glass there: the fraction along it and the
   * screen. Only from the shooter's side, so a bullet leaving the glass does not meet it again.
   */
  function cross(a: Vec3, b: Vec3): { f: number; screen: number } | null {
    if (!glazing) return null;
    let best: { f: number; screen: number } | null = null;
    screens.forEach((s, i) => {
      const n = s.normal;
      const da = (a[0] - s.centre.x) * n.x + (a[1] - s.centre.y) * n.y + (a[2] - s.centre.z) * n.z;
      const db = (b[0] - s.centre.x) * n.x + (b[1] - s.centre.y) * n.y + (b[2] - s.centre.z) * n.z;
      if (!(da > 0 && db <= 0)) return;
      const f = da / (da - db);
      const p: Vec3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      const [u, v] = local(s, p);
      if (Math.abs(u) > PANE_W / 2 || Math.abs(v) > PANE_H / 2) return;
      if (!s.sheets.some((st) => intact(st, u, v))) return;
      if (!best || f < best.f) best = { f, screen: i };
    });
    return best;
  }

  /** The glazing a bullet meets at `p` on screen `i`: the sheets still whole there, the gaps of the rest folded in. */
  function glazingAt(i: number, p: Vec3): Glazing | null {
    if (!glazing) return null;
    const s = screens[i]!;
    const [u, v] = local(s, p);
    const sheets: Sheet[] = [];
    let carry = 0;
    glazing.sheets.forEach((sh, k) => {
      const thick = sh.plies.reduce((a, q) => a + q.mm, 0);
      if (intact(s.sheets[k]!, u, v)) {
        sheets.push({ plies: sh.plies, gapMm: sh.gapMm + carry });
        carry = 0;
      } else carry += sh.gapMm + thick;
    });
    // The first sheet whole here may sit behind holed ones: the bullet meets it that much deeper.
    return sheets.length ? { name: glazing.name, sheets } : null;
  }

  /**
   * A bullet through screen `i`, arriving at `at`: hole the sheets it went through (for later bullets at
   * once; drawn when it gets there) and return the spray for each.
   */
  function punch(i: number, t: Through, at: number, diaM: number, seed: number): GlassSpray[] {
    const s = screens[i]!;
    const out: GlassSpray[] = [];
    const g = glazingAt(i, t.sheets[0]?.at ?? [s.centre.x, s.centre.y, s.centre.z]);
    // Map the pass's sheets back onto the glazing's (holed ones were skipped).
    const whole = glazing!.sheets.map((_, k) => k).filter((k) => {
      const [u, v] = local(s, t.sheets[0]!.at);
      return intact(s.sheets[k]!, u, v);
    });
    t.sheets.forEach((h, j) => {
      const k = whole[j];
      if (k === undefined || !g) return;
      const st = s.sheets[k]!;
      const [u, v] = local(s, h.at);
      // A glancing bullet still breaks tempered glass: its skin is breached and the whole pane lets go.
      if (st.tempered) st.goneAt = at;
      else if (!h.ricochet) st.holes.push({ u, v, r: diaM * (st.laminated ? 0.45 : 0.75) });
      marks.push({ at, screen: i, sheet: k, u, v, speed: h.speedIn, obliquity: h.obliquity, diaM, seed: seed * 5 + j, chip: h.ricochet, drawn: false });
      out.push({
        at, pos: h.at, normal: [s.normal.x, s.normal.y, s.normal.z], dir: t.speed > 0 ? norm3(t.vel) : [-s.normal.x, -s.normal.y, -s.normal.z],
        tempered: st.tempered, chip: h.ricochet, centre: [s.centre.x, s.centre.y, s.centre.z], right: [s.right.x, s.right.y, s.right.z], up: [s.up.x, s.up.y, s.up.z],
        ground: s.group.position.y, seed: seed * 5 + j,
      });
    });
    return out;
  }

  /** Draws the holes whose bullets have arrived by `now`, and runs tempered glass's collapse. */
  function update(now: number, sunWorld: THREE.Vector3): void {
    sun.copy(sunWorld);
    for (const m of marks) {
      if (m.drawn || now < m.at) continue;
      m.drawn = true;
      const st = screens[m.screen]!.sheets[m.sheet];
      if (!st) continue;
      if (st.tempered) st.mat.uniforms.uCraze!.value.set(m.u, m.v, m.at, 1);
      else {
        drawHole(st.ctx, m, st.laminated);
        st.tex.needsUpdate = true;
      }
    }
    for (const s of screens) for (const st of s.sheets) st.mat.uniforms.uTime!.value = now;
  }

  return {
    set,
    cross,
    glazingAt,
    punch,
    update,
    normal: (i: number): Vec3 => [screens[i]!.normal.x, screens[i]!.normal.y, screens[i]!.normal.z],
    /** The frames, for the bullets' raycasts: they stop a bullet as the fence posts do. */
    frames: (i: number) => screens[i]!.frame,
    centre: (i: number) => screens[i]!.centre,
    count: screens.length,
    get id() { return glazingId; },
    get glazing() { return glazing; },
    get depth() { return glazing ? glazingDepth(glazing) : 0; },
  };
}

function norm3(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * A bullet hole in annealed or laminated glass, into the damage canvas: red = crack, green = frosted, blue =
 * open. Radial cracks reach further from a slow bullet (the plate has time to bend before it is through) and
 * on a slant; concentric cracks join them. The back face spalls in a cone around the hole. Laminated glass
 * crazes into a finer, denser web round a crushed disc, and its PVB keeps the hole small.
 */
function drawHole(ctx: CanvasRenderingContext2D, m: Mark, laminated: boolean): void {
  const R = (i: number) => rnd(m.seed, i);
  const sx = TEX / PANE_W, sy = TEX / PANE_H;
  const X = (u: number) => (u / PANE_W + 0.5) * TEX;
  const Y = (v: number) => (0.5 - v / PANE_H) * TEX;
  const reach = Math.min(0.7, Math.max(0.05, 0.1 * Math.pow(600 / Math.max(150, m.speed), 0.8) * (1 + 0.8 * Math.min(4, Math.tan(m.obliquity))) * (laminated ? 1.1 : 1) * (m.chip ? 0.6 : 1)));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  // Radial cracks: jagged, now and then forking.
  const nRad = laminated ? 14 + Math.floor(R(1) * 9) : 7 + Math.floor(R(1) * 6);
  const ends: [number, number][][] = [];
  let k = 10;
  const crack = (u0: number, v0: number, a0: number, len: number, w: number) => {
    const pts: [number, number][] = [[u0, v0]];
    let u = u0, v = v0, a = a0;
    for (let s = 0; s < len; s += 0.012) {
      a += (R(k++) - 0.5) * 0.35;
      u += Math.cos(a) * 0.012;
      v += Math.sin(a) * 0.012;
      pts.push([u, v]);
    }
    ctx.lineWidth = w * sx;
    ctx.strokeStyle = 'rgba(255,0,0,0.85)';
    ctx.beginPath();
    pts.forEach(([pu, pv], i) => (i ? ctx.lineTo(X(pu), Y(pv)) : ctx.moveTo(X(pu), Y(pv))));
    ctx.stroke();
    return pts;
  };
  for (let i = 0; i < nRad; i++) {
    const a = (2 * Math.PI * (i + 0.3 * R(k++))) / nRad;
    const pts = crack(m.u, m.v, a, reach * (0.4 + 0.8 * R(k++)), 0.0022);
    ends.push(pts);
    if (R(k++) < 0.25) {
      const j = Math.floor(pts.length * (0.3 + 0.5 * R(k++)));
      const p = pts[Math.min(j, pts.length - 1)]!;
      crack(p[0], p[1], a + (R(k++) < 0.5 ? -1 : 1) * (0.3 + 0.4 * R(k++)), reach * 0.3 * R(k++), 0.0018);
    }
  }
  // Concentric cracks: chords from one radial to the next at about the same distance out.
  const rings = laminated ? 4 + Math.floor(R(k++) * 4) : 1 + Math.floor(R(k++) * 3);
  ctx.strokeStyle = 'rgba(255,0,0,0.7)';
  ctx.lineWidth = 0.0018 * sx;
  for (let r = 0; r < rings; r++) {
    const rho = reach * (laminated ? 0.08 + 0.55 * (r + R(k++)) / rings : 0.15 + 0.35 * R(k++));
    ctx.beginPath();
    for (let i = 0; i < nRad; i++) {
      if (R(k++) > (laminated ? 0.85 : 0.65)) continue;
      const p = ends[i]!, q = ends[(i + 1) % nRad]!;
      const a = p[Math.min(p.length - 1, Math.round(rho / 0.012))]!;
      const b = q[Math.min(q.length - 1, Math.round(rho / 0.012))]!;
      ctx.moveTo(X(a[0]), Y(a[1]));
      ctx.lineTo(X(b[0]), Y(b[1]));
    }
    ctx.stroke();
  }
  // The frosted cone blown off the back face (larger for a slow bullet), or laminated glass's crushed disc.
  const frost = laminated ? 0.025 + 0.015 * R(k++) : m.diaM * (1.4 + 1.2 * R(k++)) * (1 + 150 / Math.max(150, m.speed));
  const gr = ctx.createRadialGradient(X(m.u), Y(m.v), 0, X(m.u), Y(m.v), frost * sx);
  gr.addColorStop(0, 'rgba(0,255,0,1)');
  gr.addColorStop(0.6, 'rgba(0,200,0,0.8)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.ellipse(X(m.u), Y(m.v), frost * sx, frost * sy, 0, 0, 2 * Math.PI);
  ctx.fill();
  if (m.chip) {
    ctx.restore();
    return;
  }
  // The hole: about the bullet, ragged, a little bigger for a slow one that knocks chips out of annealed glass.
  const hole = (m.diaM / 2) * (laminated ? 0.9 : 1.05 + 0.4 * R(k++) + (m.speed < 400 ? 0.6 : 0));
  ctx.fillStyle = 'rgba(0,0,255,1)';
  ctx.beginPath();
  for (let i = 0; i < 9; i++) {
    const a = (2 * Math.PI * i) / 9;
    const r = hole * (0.8 + 0.4 * R(k++));
    const x = X(m.u + Math.cos(a) * r), y = Y(m.v + Math.sin(a) * r);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const GRAV = 9.81;
const TMP = new THREE.Color();

/**
 * The glass a bullet throws, `age` s after it went through: fragments blown out of the back face in a cone
 * mostly square to the pane (Hornady: the cloud opens about 3.5 in per foot), some following the bullet,
 * braked hard by the air and falling; a few blown back toward the shooter; a puff of glass dust. Tempered
 * glass then lets go: its dice pour out of the frame onto the ground. Each fleck glints as it tumbles.
 */
export function spray(s: GlassSpray, age: number, add: AddSprite): void {
  if (age < 0 || age > 4) return;
  const R = (i: number) => rnd(s.seed + 911, i);
  const [nx, ny, nz] = s.normal;
  const [dx, dy, dz] = s.dir;
  const glint = (i: number, t: number) => Math.min(2.6, 0.55 + 2.2 * Math.pow(Math.max(0, Math.sin(t * (18 + 40 * R(i)) + 6.3 * R(i + 1))), 12));
  const fleck = (i: number, x: number, y: number, z: number, size: number, t: number) => {
    if (y < s.ground) return;
    add(x, y, z, size, 1, TMP.copy(FLECK).multiplyScalar(glint(i, t)), R(i + 2), 1);
  };
  for (let i = 0; i < 26; i++) {
    // A glancing bullet chips the front face: a handful of flecks, all thrown back off it.
    if (s.chip && i >= 10) break;
    const back = s.chip || i >= 20;
    const k = i * 7;
    // Out of the back face (−normal), leaning toward the bullet's path; back-spray off the front face.
    const lean = back ? 0 : 0.25 + 0.5 * R(k);
    let ux = back ? nx : -nx * (1 - lean) + dx * lean;
    let uy = back ? ny : -ny * (1 - lean) + dy * lean;
    let uz = back ? nz : -nz * (1 - lean) + dz * lean;
    // Within about 16° of that: off along two directions square to it.
    const l0 = Math.hypot(ux, uy, uz) || 1;
    ux /= l0;
    uy /= l0;
    uz /= l0;
    const h = Math.hypot(ux, uz) || 1;
    const a = 2 * Math.PI * R(k + 1), c = 0.28 * Math.sqrt(R(k + 2));
    const ca = c * Math.cos(a), sa = c * Math.sin(a);
    // e1 is level and square to u, e2 = u × e1.
    const e1x = uz / h, e1z = -ux / h;
    const e2x = uy * e1z, e2y = uz * e1x - ux * e1z, e2z = -uy * e1x;
    ux += ca * e1x + sa * e2x;
    uy += sa * e2y;
    uz += ca * e1z + sa * e2z;
    const l = Math.hypot(ux, uy, uz) || 1;
    const sp = back ? 4 + 18 * R(k + 3) : 15 + 120 * R(k + 3) * R(k + 3);
    const tau = 0.04 + 0.3 * R(k + 4);
    const slow = tau * (1 - Math.exp(-age / tau));
    const x = s.pos[0] + (ux / l) * sp * slow;
    const y = s.pos[1] + (uy / l) * sp * slow - 0.5 * GRAV * age * age * Math.min(1, age / (2 * tau) + 0.3);
    const z = s.pos[2] + (uz / l) * sp * slow;
    fleck(k + 5, x, y, z, 0.0012 + 0.004 * R(k + 6), age);
  }
  // Glass dust: a faint pale puff behind the pane, slowing and spreading.
  if (age < 1.5) for (let i = 0; i < 4; i++) {
    const k = 300 + i * 5;
    const slow = 0.15 * (1 - Math.exp(-age / 0.15));
    const sp = 4 + 10 * R(k);
    add(s.pos[0] + (-nx + dx) * 0.5 * sp * slow, s.pos[1] + 0.05 * age, s.pos[2] + (-nz + dz) * 0.5 * sp * slow, 0.03 + 0.12 * Math.sqrt(age), 0.22 * Math.exp(-age / 0.5) * Math.min(1, age / 0.02), FLECK, R(k + 1), 0);
  }
  if (!s.tempered) return;
  // Tempered glass: the dice pour out of the frame, from the impact outward, a little forward and back.
  for (let i = 0; i < 70; i++) {
    const k = 400 + i * 6;
    const u = (R(k) - 0.5) * PANE_W, v = (R(k + 1) - 0.5) * PANE_H;
    const [iu, iv] = [
      (s.pos[0] - s.centre[0]) * s.right[0] + (s.pos[1] - s.centre[1]) * s.right[1] + (s.pos[2] - s.centre[2]) * s.right[2],
      (s.pos[0] - s.centre[0]) * s.up[0] + (s.pos[1] - s.centre[1]) * s.up[1] + (s.pos[2] - s.centre[2]) * s.up[2],
    ];
    const go = 0.12 + Math.hypot(u - iu, v - iv) * 0.6 + 0.3 * R(k + 2);
    const t = age - go;
    if (t < 0) continue;
    const out = (R(k + 3) - 0.6) * 1.2;
    const x = s.centre[0] + s.right[0] * u + s.up[0] * v - nx * out * t;
    const z = s.centre[2] + s.right[2] * u + s.up[2] * v - nz * out * t;
    const y = s.centre[1] + v - 0.5 * GRAV * t * t;
    fleck(k + 4, x, y, z, 0.006 + 0.006 * R(k + 5), age);
  }
}
