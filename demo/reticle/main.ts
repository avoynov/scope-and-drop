import * as THREE from 'three';
import { SCOPE, exitPupilMm, parallaxShiftRad, tanHalfApparent, trueFovRad, type Eye } from '../../src/scope/optics';
import { RETICLES, drawReticle, type Reticle } from '../../src/scope/reticles';
import { createComposite } from './composite';
import { EYE_HEIGHT, RANGE_M, buildRange, heightAt } from './scene';

const params = new URLSearchParams(location.search);
const shot = params.has('shot');
if (shot) document.body.classList.add('shot');
if (params.get('hud') === '0') document.body.classList.add('nohud');
const W = Number(params.get('w') ?? 0) || innerWidth;
const H = Number(params.get('h') ?? 0) || innerHeight;
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);

const state = {
  reticle: (params.get('reticle') === 'tree' ? 'tree' : 'pso') as Reticle['id'],
  mag: num('mag', 8),
  parallax: num('par', RANGE_M), // metres; Infinity = ∞
  // A good scope, well set up: parallax on the target, eye centred at full eye relief.
  eye: { x: num('ex', 0), y: num('ey', 0), z: num('ez', 0), pupilMm: num('pupil', 3) } as Eye,
  illum: params.has('illum'),
  sway: !params.has('nosway'),
  mirage: !params.has('nomirage'),
  drift: !params.has('nodrift'),
  yaw: 0,
  pitch: 0,
};

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: shot });
const dpr = shot ? 1 : Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(dpr);
renderer.setSize(W, H);
renderer.shadowMap.enabled = !params.has('noshadow');
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = true;
document.getElementById('view')!.appendChild(renderer.domElement);

const range = buildRange();
const { scene } = range;
const eyePos = new THREE.Vector3(0, heightAt(0, 0) + EYE_HEIGHT, 0);
const scopeCam = new THREE.PerspectiveCamera(5, 1, 0.5, 12000);
const wideCam = new THREE.PerspectiveCamera(30, W / H, 0.3, 12000);
scopeCam.position.copy(eyePos);
wideCam.position.copy(eyePos);

// Aim at the mannequin's chest.
{
  const d = range.targetHead.clone().setY(range.targetHead.y - 0.55).sub(eyePos);
  state.yaw = Math.atan2(-d.x, -d.z);
  state.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
}

let R = 0;
let scopeRT: THREE.WebGLRenderTarget;
let wideRT: THREE.WebGLRenderTarget;
const retCanvas = document.createElement('canvas');
const retCtx = retCanvas.getContext('2d')!;
const retTex = new THREE.CanvasTexture(retCanvas);
retTex.colorSpace = THREE.NoColorSpace;
retTex.premultiplyAlpha = false;
retTex.generateMipmaps = false;
retTex.minFilter = THREE.LinearFilter;

const quad = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)));
quad.frustumCulled = false;
const quadScene = new THREE.Scene();
quadScene.add(quad);
const quadCam = new THREE.Camera();
let comp: THREE.ShaderMaterial;

function layout(): void {
  const bw = Math.round(W * dpr);
  const bh = Math.round(H * dpr);
  R = Math.round(0.44 * Math.min(bw, bh));
  const S = Math.min(4096, 2 * R);
  scopeRT?.dispose();
  wideRT?.dispose();
  scopeRT = new THREE.WebGLRenderTarget(S, S, { type: THREE.HalfFloatType, samples: 4 });
  wideRT = new THREE.WebGLRenderTarget(Math.ceil(bw / 3), Math.ceil(bh / 3), { type: THREE.HalfFloatType });
  retCanvas.width = retCanvas.height = S;
  if (!comp) {
    comp = createComposite(scopeRT.texture, wideRT.texture, retTex);
    quad.material = comp;
  }
  comp.uniforms.tScope!.value = scopeRT.texture;
  comp.uniforms.tWide!.value = wideRT.texture;
  comp.uniforms.uRes!.value.set(bw, bh);
  comp.uniforms.uR!.value = R;
  // Naked-eye camera shares the scope's angular mapping at 1×: R px ↔ tan(half apparent field).
  const f = R / tanHalfApparent(SCOPE);
  wideCam.fov = (2 * Math.atan(bh / 2 / f) * 180) / Math.PI;
  wideCam.aspect = bw / bh;
  wideCam.updateProjectionMatrix();
  retKey = '';
}

let retKey = '';
function drawRet(): void {
  const key = `${state.reticle}|${state.mag.toFixed(3)}|${state.illum}|${retCanvas.width}`;
  if (key === retKey) return;
  retKey = key;
  const r = RETICLES[state.reticle]();
  const S = retCanvas.width;
  retCtx.clearRect(0, 0, S, S);
  // FFP: units → canvas px grows with magnification. Canvas half-width ↔ tan(half apparent field).
  const pxPerUnit = ((S / 2) * state.mag * Math.tan(r.unitRad)) / tanHalfApparent(SCOPE);
  drawReticle(retCtx, r, S / 2, S / 2, pxPerUnit, 'rgba(6,6,6,0.97)', state.illum ? r.illum : null);
  retTex.needsUpdate = true;
}

/** Distance to whatever the reticle centre rests on (ground, or the target board). */
function aimDistance(dir: THREE.Vector3): number {
  const tgt = range.targetHead;
  const toT = tgt.clone().sub(eyePos);
  const along = toT.dot(dir);
  const miss = toT.clone().addScaledVector(dir, -along);
  if (along > 0 && Math.abs(miss.x) < 3 && miss.y > -2 && miss.y < 1) return along;
  let d = 5;
  while (d < 9000) {
    const p = eyePos.clone().addScaledVector(dir, d);
    if (p.y < heightAt(p.x, p.z)) return d;
    d += Math.max(1, d * 0.01);
  }
  return Infinity;
}

const $ = (id: string) => document.getElementById(id)!;
const magIn = $('mag') as HTMLInputElement;
const parIn = $('par') as HTMLInputElement;
const exIn = $('ex') as HTMLInputElement;
const eyIn = $('ey') as HTMLInputElement;
const ezIn = $('ez') as HTMLInputElement;

// Parallax dial: 50 m … 1500 m on a log scale, then ∞ at the stop.
const parToSlider = (m: number) => (Number.isFinite(m) ? (Math.log(m / 50) / Math.log(30)) * 100 : 105);
const sliderToPar = (v: number) => (v > 101 ? Infinity : 50 * Math.pow(30, v / 100));

function syncUi(): void {
  magIn.value = String(state.mag);
  parIn.value = String(parToSlider(state.parallax));
  exIn.value = String(state.eye.x);
  eyIn.value = String(state.eye.y);
  ezIn.value = String(state.eye.z);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ret]')) b.classList.toggle('on', b.dataset.ret === state.reticle);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-flag]')) b.classList.toggle('on', state[b.dataset.flag as 'illum'] as boolean);
}
magIn.oninput = () => (state.mag = Number(magIn.value));
parIn.oninput = () => (state.parallax = sliderToPar(Number(parIn.value)));
exIn.oninput = () => (state.eye.x = Number(exIn.value));
eyIn.oninput = () => (state.eye.y = Number(eyIn.value));
ezIn.oninput = () => (state.eye.z = Number(ezIn.value));
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ret]')) b.onclick = () => { state.reticle = b.dataset.ret as Reticle['id']; syncUi(); };
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-flag]')) b.onclick = () => { const k = b.dataset.flag as 'illum'; state[k] = !state[k]; syncUi(); };
$('center').onclick = () => { state.eye.x = state.eye.y = 0; state.eye.z = 0; syncUi(); };

// Aim: drag (mouse or one finger). Zoom: wheel or pinch.
const canvas = renderer.domElement;
const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
canvas.addEventListener('pointerup', (e) => { pointers.delete(e.pointerId); pinch = 0; });
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = 0; });
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  if (pointers.size === 1) {
    // One screen px of drag moves the view one apparent px: feels locked to the glass.
    const k = tanHalfApparent(SCOPE) / state.mag / (R / dpr);
    state.yaw += (e.clientX - prev.x) * k;
    state.pitch = Math.max(-0.3, Math.min(0.3, state.pitch + (e.clientY - prev.y) * k));
  }
  prev.x = e.clientX;
  prev.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (pinch) state.mag = clampMag(state.mag * (d / pinch));
    pinch = d;
    syncUi();
  }
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); state.mag = clampMag(state.mag * Math.pow(1.0015, -e.deltaY)); syncUi(); }, { passive: false });
const clampMag = (m: number) => Math.max(SCOPE.minMag, Math.min(SCOPE.maxMag, m));
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  if (e.code === 'KeyR') { state.reticle = state.reticle === 'pso' ? 'tree' : 'pso'; syncUi(); }
  if (e.code === 'KeyL') { state.illum = !state.illum; syncUi(); }
  if (e.code === 'KeyH') document.body.classList.toggle('nohud');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('resize', () => { if (!shot) location.reload(); });

const fmt = (m: number) => (Number.isFinite(m) ? `${Math.round(m)} m` : '∞');
const readout = $('readout');
let lastReadout = 0;

const dir = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
function frame(t: number, dt: number): void {
  // Head keys: WASD slide the eye across the exit pupil, Q/E change eye relief.
  const k = dt * 6;
  if (keys.has('KeyA')) state.eye.x -= k;
  if (keys.has('KeyD')) state.eye.x += k;
  if (keys.has('KeyW')) state.eye.y += k;
  if (keys.has('KeyS')) state.eye.y -= k;
  if (keys.has('KeyQ')) state.eye.z -= k * 3;
  if (keys.has('KeyE')) state.eye.z += k * 3;
  if (keys.size) syncUi();
  const eye = { ...state.eye };
  if (state.drift) {
    // Even with a solid cheek weld the head wanders a fraction of a millimetre.
    eye.x += 0.3 * Math.sin(t * 0.31) + 0.12 * Math.sin(t * 0.83 + 1);
    eye.y += 0.22 * Math.sin(t * 0.27 + 2) + 0.1 * Math.sin(t * 0.71);
    eye.z += 1.0 * Math.sin(t * 0.19 + 0.5);
  }

  // Wobble: breathing (≈0.25 Hz figure-eight) plus heartbeat twitch, in object-space radians.
  let yaw = state.yaw;
  let pitch = state.pitch;
  if (state.sway) {
    const b = 0.00032;
    yaw += b * (Math.sin(t * 1.55) * 0.6 + Math.sin(t * 0.37 + 1) * 0.8);
    pitch += b * (Math.sin(t * 3.1 + 0.4) * 0.5 + Math.sin(t * 0.29) * 0.9);
    const beat = Math.exp(-((t * 1.15) % 1) * 18);
    pitch -= 0.00006 * beat;
  }
  euler.set(pitch, yaw, 0);
  scopeCam.quaternion.setFromEuler(euler);
  wideCam.quaternion.copy(scopeCam.quaternion);
  scopeCam.fov = (trueFovRad(SCOPE, state.mag) * 180) / Math.PI;
  scopeCam.updateProjectionMatrix();
  scopeCam.getWorldDirection(dir);

  const D = aimDistance(dir);
  const ep = exitPupilMm(SCOPE, state.mag);
  const th = tanHalfApparent(SCOPE);
  const u = comp.uniforms;
  u.uTanHalf!.value = th;
  u.uMag!.value = state.mag;
  u.uExitR!.value = ep / 2;
  u.uEye!.value.set(eye.x, eye.y, eye.z);
  u.uEyePupilR!.value = eye.pupilMm / 2;
  u.uEyeRelief!.value = SCOPE.eyeReliefMm;
  u.uHousing!.value = SCOPE.ocularHousingMm;
  // Partial auto-exposure: a pupil-starved image is darker, but the eye/camera adapts some of it back.
  const centre = Math.min(ep / 2, eye.pupilMm / 2) ** 2 / (eye.pupilMm / 2) ** 2;
  u.uTnorm!.value = Math.sqrt(centre);
  const Dr = Number.isFinite(D) ? D : 1e9;
  // Reticle shift in canvas uv: object radians → apparent tan (×mag) → field-stop units (/th) → uv (×½).
  const toUv = (state.mag / th) * 0.5;
  u.uPar!.value.set(
    parallaxShiftRad(SCOPE, state.mag, eye.x, Dr, state.parallax) * toUv,
    parallaxShiftRad(SCOPE, state.mag, eye.y, Dr, state.parallax) * toUv,
  );
  // Focus: parallax knob is also focus. Blur circle = aperture · |1/D − 1/P|.
  const invP = Number.isFinite(state.parallax) ? 1 / state.parallax : 0;
  u.uFocus!.value = (SCOPE.objectiveMm / 1000) * Math.abs(1 / Dr - invP) * 0.5 * toUv;
  // ~1.5 px of rim softness, whatever the screen size.
  u.uEdge!.value = 1.5 / (R * 2);
  u.uTime!.value = t;
  // Mirage boil: ~25 µrad near the ground at midday, seen bigger the more you magnify.
  u.uMirage!.value = state.mirage ? 0.000025 * toUv * Math.min(1, D / 300) : 0;

  drawRet();
  renderer.setRenderTarget(scopeRT);
  renderer.render(scene, scopeCam);
  renderer.setRenderTarget(wideRT);
  renderer.render(scene, wideCam);
  renderer.setRenderTarget(null);
  renderer.render(quadScene, quadCam);

  if (t - lastReadout > 0.15 || shot) {
    lastReadout = t;
    const ret = RETICLES[state.reticle]();
    const tf = trueFovRad(SCOPE, state.mag);
    const par = parallaxShiftRad(SCOPE, state.mag, Math.hypot(eye.x, eye.y), Dr, state.parallax) / ret.unitRad;
    const fig = 1.7 / RANGE_M / ret.unitRad;
    readout.innerHTML = [
      ['Magnification', `${state.mag.toFixed(1)}×`],
      ['True field', `${((tf * 180) / Math.PI).toFixed(2)}° · ${(tf * 1000).toFixed(0)} mil`],
      ['Exit pupil', `${ep.toFixed(1)} mm`],
      ['Parallax set', fmt(state.parallax)],
      // Turrets are left at 0: nothing is dialled, so every hold comes from the reticle.
      ['Zero', '0 m · turrets 0'],
      ['Aim point', fmt(D)],
      ['Parallax error', `${Math.abs(par).toFixed(2)} ${ret.id === 'pso' ? 'th' : 'mil'}`],
      ['Target 1.7 m', `${fig.toFixed(2)} ${ret.id === 'pso' ? 'th' : 'mil'}`],
    ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  }
}

layout();
syncUi();
if (shot) {
  // Deterministic still: fixed clock, a couple of frames so shadows and MSAA settle.
  const t = num('t', 2.4);
  frame(t, 0);
  frame(t, 0);
  (window as unknown as { __ready: boolean }).__ready = true;
  (window as unknown as { __stats: () => unknown }).__stats = () => ({ reticle: state.reticle, mag: state.mag });
} else {
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(now / 1000, dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
