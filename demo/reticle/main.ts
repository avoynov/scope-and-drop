import * as THREE from 'three';
import { ROUNDS, at } from '../../src/scope/ballistics';
import { HEAD_UP, ON_WELD, adsEye, adsRoll, adsVelocity, planScopeIn, planScopeOut, type AdsMotion, type Vec3 } from '../../src/scope/ads';
import { SCOPE, exitPupilMm, eyeboxTransmission, parallaxShiftRad, tanHalfApparent, trueFovRad, type Eye } from '../../src/scope/optics';
import { RECOIL, followHead, recoilAt, shotVariation, type RecoilSpec, type RecoilState, type ShotVariation } from '../../src/scope/recoil';
import { RETICLES, drawReticle, type Reticle } from '../../src/scope/reticles';
import { createComposite } from './composite';
import { buildRifle, createNearPasses } from './near';
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
  /** Pan shadow: how far the head trails a quick swing (0 = glued to the stock, 1 = a firm cheek weld, 2 = loose). */
  pan: num('pan', 1),
  yaw: 0,
  pitch: 0,
};

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: shot });
const dpr = shot ? 1 : Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(dpr);
renderer.setSize(W, H);
renderer.shadowMap.enabled = !params.has('noshadow');
renderer.shadowMap.type = THREE.PCFShadowMap;
// The range and the sun never move, so the shadow map is the same every frame: draw it once, on the first
// render that has the sun in it, instead of before every view.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
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

/**
 * Panning. Prone, the rifle swings about its front support (bipod or bag) about 600 mm ahead of the eye,
 * so the eyepiece moves the opposite way to the muzzle. The head rides along on the cheek weld but
 * trails it by a moment, which leaves the eye off the exit pupil toward the way the muzzle is going: a
 * crescent creeps in from that edge and clears once the swing stops. Pan shadow scales the lag.
 */
const PAN_LAG = 0.03; // s, at Pan shadow 1
const SUPPORT_TO_EYE_MM = 600;
const panHead = { yaw: state.yaw, pitch: state.pitch };

let R = 0;
let scopeRT: THREE.WebGLRenderTarget;
let wideRT: THREE.WebGLRenderTarget;
let wideLoRT: THREE.WebGLRenderTarget;
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
const rifle = buildRifle();
const near = createNearPasses(renderer, rifle);
const toSun = range.sun.position.clone().sub(range.sun.target.position).normalize();

function layout(): void {
  const bw = Math.round(W * dpr);
  const bh = Math.round(H * dpr);
  R = Math.round(0.44 * Math.min(bw, bh));
  const S = Math.min(4096, 2 * R);
  scopeRT?.dispose();
  wideRT?.dispose();
  wideLoRT?.dispose();
  scopeRT = new THREE.WebGLRenderTarget(S, S, { type: THREE.HalfFloatType, samples: 4 });
  // Full resolution: with the head up the naked eye is the whole view. Mips give the on-glass blur cheaply.
  wideRT = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  // On the glass the surroundings are blurred anyway: a third of the resolution is plenty and much cheaper.
  wideLoRT = new THREE.WebGLRenderTarget(Math.ceil(bw / 3), Math.ceil(bh / 3), { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  near.setSize(bw, bh);
  retCanvas.width = retCanvas.height = S;
  if (!comp) {
    comp = createComposite(scopeRT.texture, wideRT.texture, retTex, near.eyepiece, near.lens, near.body);
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
  rifle.camera.fov = wideCam.fov;
  rifle.camera.aspect = wideCam.aspect;
  rifle.camera.updateProjectionMatrix();
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
const panIn = $('pan') as HTMLInputElement;

// Parallax dial: 50 m … 1500 m on a log scale, then ∞ at the stop.
const parToSlider = (m: number) => (Number.isFinite(m) ? (Math.log(m / 50) / Math.log(30)) * 100 : 105);
const sliderToPar = (v: number) => (v > 101 ? Infinity : 50 * Math.pow(30, v / 100));

/**
 * Ammo card for the mil tree: the tree is generic, so the shooter works the hold out from the bullet's
 * speed. Speeds every 200 m, as printed on a box of match ammunition. The SVD's PSO is cut for its
 * round, so it needs no card.
 */
const DOPE_RANGES = [0, 200, 400, 600, 800, 1000];
const dope = $('dope');
function syncDope(): void {
  const show = state.reticle === 'tree';
  dope.hidden = !show;
  if (!show) return;
  const r = ROUNDS[RETICLES.tree().round];
  dope.innerHTML =
    `<div class="dope-head"><b>${r.name}</b> ${r.cartridge} · ${r.bulletGr} gr<span>zero 0 m</span></div>` +
    `<table><tr><th>m</th>${DOPE_RANGES.map((d) => `<td>${d}</td>`).join('')}</tr>` +
    `<tr><th>m/s</th>${DOPE_RANGES.map((d) => `<td>${Math.round(at(r, d).v)}</td>`).join('')}</tr></table>`;
}

function syncUi(): void {
  syncDope();
  magIn.value = String(state.mag);
  parIn.value = String(parToSlider(state.parallax));
  exIn.value = String(state.eye.x);
  eyIn.value = String(state.eye.y);
  ezIn.value = String(state.eye.z);
  panIn.value = String(state.pan);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ret]')) b.classList.toggle('on', b.dataset.ret === state.reticle);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-flag]')) b.classList.toggle('on', state[b.dataset.flag as 'illum'] as boolean);
  $('scope').textContent = adsIn ? 'Scope out · F' : 'Scope in · F';
}
magIn.oninput = () => (state.mag = Number(magIn.value));
parIn.oninput = () => (state.parallax = sliderToPar(Number(parIn.value)));
exIn.oninput = () => (state.eye.x = Number(exIn.value));
eyIn.oninput = () => (state.eye.y = Number(eyIn.value));
ezIn.oninput = () => (state.eye.z = Number(ezIn.value));
panIn.oninput = () => (state.pan = Number(panIn.value));
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ret]')) b.onclick = () => { state.reticle = b.dataset.ret as Reticle['id']; syncUi(); };
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-flag]')) b.onclick = () => { const k = b.dataset.flag as 'illum'; state[k] = !state[k]; syncUi(); };
$('center').onclick = () => { state.eye.x = state.eye.y = 0; state.eye.z = 0; syncUi(); };

/**
 * Recoil (no bullet). The SVD and the bolt rifle behind the tree kick differently. When the motion has
 * died away its lasting rise is folded into the aim, so the rifle stays where it ended up and the
 * shooter has to drag it back down.
 */
let recoil: { start: number; spec: RecoilSpec; v: ShotVariation } | null = null;
let shots = 0;
let clock = 0;
const REST: RecoilState = { pitch: 0, yaw: 0, tiltPitch: 0, tiltYaw: 0, eye: { x: 0, y: 0, z: 0 } };
/** A frame stands for a 1/60 s exposure: recoil moves far enough within one to smear. */
const EXPOSURE = 1 / 60;
function foldRecoil(r: RecoilState): void {
  const pitch = Math.max(-0.3, Math.min(0.3, state.pitch + r.pitch));
  // The head comes along, so folding the rise into the aim is not a swing.
  panHead.pitch += pitch - state.pitch;
  panHead.yaw -= r.yaw;
  state.pitch = pitch;
  state.yaw -= r.yaw; // three.js yaw is positive to the left
}
function fire(): void {
  // A second shot before the first settles starts from wherever the rifle is now.
  if (recoil) foldRecoil(recoilAt(recoil.spec, recoil.v, clock - recoil.start));
  recoil = { start: clock, spec: state.reticle === 'pso' ? RECOIL.svd : RECOIL.bolt, v: shotVariation(shots++) };
}
$('fire').onclick = () => fire();

/**
 * Scope-in and scope-out (see src/scope/ads.ts). The rifle stays on its bipod and the head moves: down onto
 * the cheek weld until the eye finds the exit pupil, or up to look over the scope with the naked eye.
 * `adapt` is how far the eye has adapted to the picture in the glass (1) rather than the open range (0):
 * it sets exposure and how blurred the surroundings look, and lags the head like real light adaptation.
 */
let ads: AdsMotion | null = null;
let adsIn = !params.has('out');
let adsMoves = 0;
let headRest: Vec3 = adsIn ? { ...ON_WELD } : { ...HEAD_UP };
let adapt = adsIn ? 1 : 0;
function headAt(t: number): Vec3 {
  return ads ? adsEye(ads, t) : headRest;
}
function toggleScope(): void {
  const from = headAt(clock);
  const vel = ads ? adsVelocity(ads, clock) : { x: 0, y: 0, z: 0 };
  adsIn = !adsIn;
  ads = (adsIn ? planScopeIn : planScopeOut)(clock, from, vel, adsMoves++);
  syncUi();
}
$('scope').onclick = () => toggleScope();

/** Share of the field that reaches the eye: eyebox light inside the eyepiece glass, averaged over the field. */
function imageShare(eye: Eye, tilt: { x: number; y: number }): number {
  const th = tanHalfApparent(SCOPE);
  const dist = SCOPE.eyeReliefMm + 2.5 + eye.z;
  const lr = 20.5 / dist;
  const lx = tilt.x - eye.x / dist;
  const ly = tilt.y - eye.y / dist;
  let sum = 0;
  let n = 0;
  for (let j = -4; j <= 4; j++) {
    for (let i = -4; i <= 4; i++) {
      const tx = (i / 4) * th;
      const ty = (j / 4) * th;
      if (tx * tx + ty * ty > th * th) continue;
      n++;
      if (Math.hypot(tx + tilt.x - lx, ty + tilt.y - ly) > lr) continue;
      sum += Math.min(1, eyeboxTransmission(SCOPE, state.mag, eye, tx, ty));
    }
  }
  return sum / n;
}
/**
 * True when the eyebox passes no light for any direction the composite can show, so the image counts for
 * nothing. Mirrors glass() in composite.ts: light needs |eye.xy + (eye.z + aberration·r²)·t| < exit + eye
 * pupil radii, and the field stop zeroes everything past r = 1 + 0.6/R. `sweep` is the eye's travel over
 * the exposure, which the recoil path samples ±½ of. The 1 % margin covers float32 in the shader.
 */
function eyeboxDark(eye: Eye, sweep: THREE.Vector3, exitR: number, pupilR: number, th: number): boolean {
  const rMax = 1 + 0.6 / R;
  const tMax = th * rMax;
  const zMax = Math.abs(eye.z) + Math.abs(sweep.z) / 2 + SCOPE.pupilAberrationMm * rMax * rMax;
  const lateral = Math.hypot(eye.x, eye.y) - Math.hypot(sweep.x, sweep.y) / 2;
  return lateral - zMax * tMax > (exitR + pupilR) * 1.01 + 0.01;
}

/** Light adaptation is quick, dark adaptation slower: the eye takes longer to settle into the dimmer glass. */
function stepAdapt(target: number, dt: number): void {
  const tau = target > adapt ? 0.45 : 0.2;
  adapt += (target - adapt) * (1 - Math.exp(-dt / tau));
}

// Aim: drag (mouse or one finger). Zoom: wheel or pinch.
const canvas = renderer.domElement;
const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) { toggleScope(); return; }
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerup', (e) => { pointers.delete(e.pointerId); pinch = 0; });
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = 0; });
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  if (pointers.size === 1) {
    // One screen px of drag moves the view one apparent px: locked to the glass on the weld, to the
    // naked-eye view with the head up.
    const k = tanHalfApparent(SCOPE) / (1 + (state.mag - 1) * adapt) / (R / dpr);
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
  if (e.code === 'KeyF' && !e.repeat) toggleScope();
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) fire();
  }
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  // Space must not also click whichever panel button has focus.
  if (e.code === 'Space') e.preventDefault();
});
for (const b of document.querySelectorAll('button')) b.addEventListener('click', () => b.blur());
addEventListener('resize', () => { if (!shot) location.reload(); });

const fmt = (m: number) => (Number.isFinite(m) ? `${Math.round(m)} m` : '∞');
const readout = $('readout');
let lastReadout = 0;

const dir = new THREE.Vector3();
const nearVel = new THREE.Vector2();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
function frame(t: number, dt: number): void {
  clock = t;
  // Recoil now, and half an exposure either side of now (for motion blur).
  let rc = REST;
  let rcA = REST;
  let rcB = REST;
  if (recoil) {
    const s = t - recoil.start;
    if (s >= recoil.spec.duration) {
      foldRecoil(recoilAt(recoil.spec, recoil.v, s));
      recoil = null;
    } else {
      rc = recoilAt(recoil.spec, recoil.v, s);
      rcA = recoilAt(recoil.spec, recoil.v, s - EXPOSURE / 2);
      rcB = recoilAt(recoil.spec, recoil.v, s + EXPOSURE / 2);
    }
  }
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
  eye.x += rc.eye.x;
  eye.y += rc.eye.y;
  eye.z += rc.eye.z;
  // How far a swing has carried the scope ahead of the head (up and right), and where that puts the eye.
  const lag = PAN_LAG * state.pan;
  panHead.yaw = followHead(panHead.yaw, state.yaw, dt, lag);
  panHead.pitch = followHead(panHead.pitch, state.pitch, dt, lag);
  const panPitch = state.pitch - panHead.pitch;
  const panYaw = panHead.yaw - state.yaw;
  eye.x += SUPPORT_TO_EYE_MM * panYaw;
  eye.y += SUPPORT_TO_EYE_MM * panPitch;
  const tiltPitch = rc.tiltPitch + panPitch;
  const tiltYaw = rc.tiltYaw + panYaw;
  // Head down onto the weld or up off it.
  let roll = 0;
  let adsA: Vec3 = headRest;
  let adsB: Vec3 = headRest;
  if (ads) {
    if (t - ads.start >= ads.duration) {
      headRest = adsEye(ads, ads.start + ads.duration);
      ads = null;
    } else {
      roll = adsRoll(ads, t);
      adsA = adsEye(ads, t - EXPOSURE / 2);
      adsB = adsEye(ads, t + EXPOSURE / 2);
    }
  }
  const head = headAt(t);
  eye.x += head.x;
  eye.y += head.y;
  eye.z += head.z;
  if (!shot) stepAdapt(imageShare(eye, { x: Math.tan(tiltYaw), y: Math.tan(tiltPitch) }), dt);

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
  // The scope looks where the rifle points; the naked eye looks where the head points, which lags it.
  euler.set(pitch + rc.pitch, yaw - rc.yaw, 0);
  scopeCam.quaternion.setFromEuler(euler);
  euler.set(pitch + rc.pitch - tiltPitch, yaw - rc.yaw + tiltYaw, 0);
  wideCam.quaternion.setFromEuler(euler);
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
  u.uSaep!.value = SCOPE.pupilAberrationMm;
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
  // Recoil: the scope tilts against the eye. Across one exposure the whole picture swings in the eye's
  // view (apparent tan), the scene sweeps through it at the rifle's rate magnified (scope-canvas uv),
  // and the eye slides over the exit pupil (mm).
  u.uTilt!.value.set(Math.tan(tiltYaw), Math.tan(tiltPitch));
  u.uSweep!.value.set(Math.tan(rcB.tiltYaw) - Math.tan(rcA.tiltYaw), Math.tan(rcB.tiltPitch) - Math.tan(rcA.tiltPitch));
  u.uBlur!.value.set((rcB.yaw - rcA.yaw) * toUv, (rcB.pitch - rcA.pitch) * toUv);
  u.uEyeSweep!.value.set(rcB.eye.x - rcA.eye.x + adsB.x - adsA.x, rcB.eye.y - rcA.eye.y + adsB.y - adsA.y, rcB.eye.z - rcA.eye.z + adsB.z - adsA.z);
  u.uRoll!.value = roll;
  u.uExposure!.value = 1 / (1 + 0.7 * (1 - adapt));
  u.uWorldBlur!.value = 9 * dpr * adapt;
  // Mirage boil: ~25 µrad near the ground at midday, seen bigger the more you magnify.
  u.uMirage!.value = state.mirage ? 0.000025 * toUv * Math.min(1, D / 300) : 0;

  // The rifle from the eye: the head looks along the scope, less the recoil and swing tilt between them.
  const cam = rifle.camera;
  cam.position.set(eye.x / 1000, eye.y / 1000, eye.z / 1000);
  cam.rotation.set(-tiltPitch, tiltYaw, 0, 'YXZ');
  cam.updateMatrixWorld();
  rifle.setLight(toSun.clone().applyQuaternion(scopeCam.quaternion.clone().invert()));
  // Blur radius of a point 1 m away in half-res px: half the eye pupil over the distance, as apparent tan.
  const kNear = (0.5 * (eye.pupilMm / 1000) / th) * (R / 2);
  // The eyepiece's sweep across the view during one exposure, for the smear.
  const ocular = (e: Vec3, r: RecoilState) => {
    const d = SCOPE.eyeReliefMm + e.z + r.eye.z;
    return [Math.tan(r.tiltYaw) - (e.x + r.eye.x) / d, Math.tan(r.tiltPitch) - (e.y + r.eye.y) / d];
  };
  const [ax, ay] = ocular(adsA, rcA);
  const [bx, by] = ocular(adsB, rcB);
  nearVel.set(((bx! - ax!) / th) * (R / 2), ((by! - ay!) / th) * (R / 2));
  near.render(kNear, nearVel, shot ? 0 : (t * 60) % 97);

  drawRet();
  // The magnified image only reaches the screen through the eyebox. When no direction in the field can send
  // light into the eye pupil, the composite multiplies the image by exactly zero, so skip rendering it.
  if (!eyeboxDark(eye, u.uEyeSweep!.value, ep / 2, eye.pupilMm / 2, th)) {
    renderer.setRenderTarget(scopeRT);
    renderer.render(scene, scopeCam);
  }
  const wide = adapt > 0.6 ? wideLoRT : wideRT;
  u.tWide!.value = wide.texture;
  u.uWideLod!.value = wide === wideLoRT ? -Math.log2(3) : 0;
  renderer.setRenderTarget(wide);
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
      ['Head', ads ? (ads.dir === 'in' ? 'going down' : 'coming up') : adsIn ? 'on the weld' : 'up'],
      ['Magnification', `${state.mag.toFixed(1)}×`],
      ['True field', `${((tf * 180) / Math.PI).toFixed(2)}° · ${(tf * 1000).toFixed(0)} mil`],
      ['Exit pupil', `${ep.toFixed(1)} mm`],
      ['Parallax set', fmt(state.parallax)],
      // Turrets are left at 0: nothing is dialled, so every hold comes from the reticle.
      ['Zero', '0 m · turrets 0'],
      ['Round', `${ROUNDS[ret.round].name} · ${ROUNDS[ret.round].cartridge}`],
      ...(ret.id === 'tree' ? [['Bullet speed', `${ROUNDS[ret.round].mv} m/s`]] : []),
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
  // recoil=<s>: the still is taken that long after the trigger.
  if (params.has('recoil')) recoil = { start: t - num('recoil', 0), spec: state.reticle === 'pso' ? RECOIL.svd : RECOIL.bolt, v: shotVariation(0) };
  // panrate=<right>,<up> (deg/s): the still is taken mid-swing, with the head trailing as it would.
  if (params.has('panrate')) {
    const [right = 0, up = 0] = params.get('panrate')!.split(',').map(Number);
    const lag = PAN_LAG * state.pan;
    panHead.yaw = state.yaw + ((right * Math.PI) / 180) * lag;
    panHead.pitch = state.pitch - ((up * Math.PI) / 180) * lag;
  }
  // adsin=<s> / adsout=<s>: the still is taken that long after the head starts down / up.
  for (const [k, inward] of [['adsin', true], ['adsout', false]] as const) {
    if (!params.has(k)) continue;
    const start = t - num(k, 0);
    headRest = inward ? { ...HEAD_UP } : { ...ON_WELD };
    adsIn = inward;
    ads = (inward ? planScopeIn : planScopeOut)(start, headRest, { x: 0, y: 0, z: 0 }, 0);
    // Replay the eye's adaptation from well before the move.
    adapt = inward ? 0 : 1;
    for (let u = start - 0.5; u < t; u += 1 / 240) {
      const e = { ...state.eye, ...(u < start ? headRest : adsEye(ads, u)) } as Eye;
      e.pupilMm = state.eye.pupilMm;
      stepAdapt(imageShare(e, { x: 0, y: 0 }), 1 / 240);
    }
  }
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
