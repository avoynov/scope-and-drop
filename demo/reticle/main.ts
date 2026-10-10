import * as THREE from 'three';
import { ROUNDS, at } from '../../src/scope/ballistics';
import { HEAD_UP, ON_WELD, adsEye, adsRoll, adsVelocity, planScopeIn, planScopeOut, type AdsMotion, type Vec3 } from '../../src/scope/ads';
import { SCOPE, exitPupilMm, eyeboxTransmission, parallaxShiftRad, tanHalfApparent, trueFovRad, type Eye } from '../../src/scope/optics';
import { RECOIL, followHead, recoilAt, shotVariation, type RecoilSpec, type RecoilState, type ShotVariation } from '../../src/scope/recoil';
import { RETICLES, drawReticle, type Reticle } from '../../src/scope/reticles';
import { BATTLE_ZERO_M, RIFLES, crossDriftPerMs, type RifleId } from '../../src/scope/shot';
import { WIND_REF_M, shelterWind, terrainWind, windAt, type Wind } from '../../src/scope/wind';
import { createSound } from './audio';
import { createComposite } from './composite';
import { GLAZING, type GlazingId } from '../../src/scope/glass';
import { createGlass } from './glass';
import { DRUM_R_MM, DRUM_STEP, createDrum, drumHome } from './drum';
import { FLAG_DEG_PER_MS } from './flags';
import { buildRifle, createNearPasses } from './near';
import { EYE_HEIGHT, NEAR_M, RANGE_M, buildRange, heightAt } from './scene';
import { createShooting, type Aim } from './shooting';
import { createWindGL } from './wind-gl';
import { woundSvg, woundText } from './wound-card';

const params = new URLSearchParams(location.search);
const shot = params.has('shot');
if (shot) document.body.classList.add('shot');
if (params.get('hud') === '0') document.body.classList.add('nohud');
const W = Number(params.get('w') ?? 0) || innerWidth;
const H = Number(params.get('h') ?? 0) || innerHeight;
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);

/**
 * The rifle behind each reticle, and the mannequin it is meant for: the SVD and the bolt rifle shoot the one at
 * 412 m, the VSS the one at the game's range, 183 m (range.targets[1]).
 */
const RIFLE = { pso: 'svd', tree: 'bolt', vss: 'vss' } as const satisfies Record<Reticle['id'], RifleId>;
const HOME = { pso: 0, tree: 0, vss: 1 } as const satisfies Record<Reticle['id'], number>;
const reticleParam = params.get('reticle');

const state = {
  reticle: (reticleParam === 'tree' || reticleParam === 'vss' ? reticleParam : 'pso') as Reticle['id'],
  mag: num('mag', 8),
  parallax: num('par', reticleParam === 'vss' ? NEAR_M : RANGE_M), // metres; Infinity = ∞
  // A good scope, well set up: parallax on the target, eye centred at full eye relief.
  eye: { x: num('ex', 0), y: num('ey', 0), z: num('ez', 0), pupilMm: num('pupil', 3) } as Eye,
  illum: params.has('illum'),
  sway: !params.has('nosway'),
  mirage: !params.has('nomirage'),
  drift: !params.has('nodrift'),
  /** Pan shadow: how far the head trails a quick swing (0 = glued to the stock, 1 = a firm cheek weld, 2 = loose). */
  pan: num('pan', 1),
  /**
   * Wind over the range: speed (m/s at 3 m), the clock direction it blows from, and how much it gusts. It
   * follows the ground (`flatwind` turns that off); the boulder's shelter is baked below, once the range is built.
   */
  wind: (() => {
    const [speed = 2.5, from = 9.5] = (params.get('wind') ?? '').split(',').filter(Boolean).map(Number);
    const w: Wind = { speed, fromClock: from, gust: params.has('nogust') ? 0 : 0.3 };
    // Everything the scope can see: the sage runs out to 1.84 km over ±26°.
    if (!params.has('flatwind')) w.terrain = terrainWind(heightAt, -900, -2000, 900, 150, 10);
    return w;
  })(),
  /** Easy: a wind meter at the hide gives the wind in m/s. Otherwise only the range itself tells it. */
  easy: params.has('easy'),
  sound: !params.has('mute'),
  /** Where each rifle's elevation drum is set, in metres: on 1, the 100 m zero, unless `zero=` says otherwise. */
  zero: (() => {
    const z = num('zero', BATTLE_ZERO_M);
    return { pso: z, tree: z, vss: z } as Record<Reticle['id'], number>;
  })(),
  /** The glass screens in front of the mannequins: the glazing (or off), and how far they are turned (deg). */
  glass: ((g) => (g && g in GLAZING ? g : 'off'))(params.get('glass')) as GlazingId | 'off',
  glassAngle: num('glassangle', 0),
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

const windGL = createWindGL(state.wind);
const range = buildRange(windGL);
const { scene } = range;
/** The boulder's shelter, for the mean wind direction. Baked again when the direction changes. */
const bakeShelter = () => {
  if (params.has('flatwind')) return;
  state.wind.shelter = shelterWind(range.obstacles, state.wind.fromClock, heightAt, -60, -560, 100, -300, 2);
};
bakeShelter();
let shelterDue = 0;
const eyePos = new THREE.Vector3(0, heightAt(0, 0) + EYE_HEIGHT, 0);
const scopeCam = new THREE.PerspectiveCamera(5, 1, 0.5, 12000);
const wideCam = new THREE.PerspectiveCamera(30, W / H, 0.3, 12000);
scopeCam.position.copy(eyePos);
wideCam.position.copy(eyePos);

// Aim at the chest of the mannequin this rifle is meant for.
{
  const home = range.targets[HOME[state.reticle]]!.head;
  const d = home.clone().setY(home.y - 0.55).sub(eyePos);
  state.yaw = Math.atan2(-d.x, -d.z);
  state.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  // hold=<units>: aim that many reticle units high (and hold=<up>,<right> for wind), so a chevron sits on the chest.
  const [up = 0, right = 0] = (params.get('hold') ?? '').split(',').filter(Boolean).map(Number);
  const unit = RETICLES[state.reticle]().unitRad;
  state.pitch += up * unit;
  state.yaw -= right * unit;
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
const sound = createSound();
const glass = createGlass(range, eyePos);
const shooting = createShooting(range, sound, glass);
/** Glazes the frames afresh (or takes them away); their shadows change, so the shadow map is redrawn. */
function glaze(): void {
  glass.set(state.glass === 'off' ? null : state.glass, state.glassAngle);
  renderer.shadowMap.needsUpdate = true;
}
glaze();
const GLASS_NEXT = { off: 'single', single: 'double', double: 'laminated', laminated: 'tempered', tempered: 'off' } as const satisfies Record<GlazingId | 'off', GlazingId | 'off'>;

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
  wideDrawn = null;
}

let retKey = '';
/** The surround last drawn into wideLoRT, and where the naked eye was looking, so a still view can reuse it. */
let wideDrawn: THREE.WebGLRenderTarget | null = null;
const wideDrawnQ = new THREE.Quaternion();
/** Pixels per radian at the centre of a perspective view `px` pixels tall. */
const pxPerRad = (cam: THREE.PerspectiveCamera, px: number) => px / 2 / Math.tan(((cam.fov / 2) * Math.PI) / 180);

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

/**
 * Ceiling of `heightAt` at horizontal distance r: each fbm is below 1, so the swells stay under 7 + 0.8 m,
 * the hide adds at most 6 m and the far hills at most 0.08 m per metre beyond 1.5 km.
 */
const terrainCeiling = (r: number) => 13.8 + 0.08 * Math.max(0, r - 1500);
const toT = new THREE.Vector3();
const miss = new THREE.Vector3();
const probe = new THREE.Vector3();
/** Distance to whatever the reticle centre rests on (ground, or a target board). */
function aimDistance(dir: THREE.Vector3): number {
  let board = Infinity;
  for (const m of range.targets) {
    toT.copy(m.head).sub(eyePos);
    const along = toT.dot(dir);
    miss.copy(toT).addScaledVector(dir, -along);
    if (along > 0 && Math.abs(miss.x) < 3 && miss.y > -2 && miss.y < 1) board = Math.min(board, along);
  }
  if (board < Infinity) return board;
  let d = 5;
  while (d < 9000) {
    const p = probe.copy(eyePos).addScaledVector(dir, d);
    // Above the ceiling the ground cannot be hit here, so the terrain need not be evaluated.
    if (p.y < terrainCeiling(Math.hypot(p.x, p.z)) && p.y < heightAt(p.x, p.z)) return d;
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
    `<div class="dope-head"><b>${r.name}</b> ${r.cartridge} · ${r.bulletGr} gr<span>zero ${state.zero.tree} m · scope ${Math.round(RIFLES.bolt.sightM * 1000)} mm over bore</span></div>` +
    `<table><tr><th>m</th>${DOPE_RANGES.map((d) => `<td>${d}</td>`).join('')}</tr>` +
    `<tr><th>m/s</th>${DOPE_RANGES.map((d) => `<td>${Math.round(at(r, d).v)}</td>`).join('')}</tr></table>`;
}

/**
 * Wind card: how far to hold into the wind for what the flags show, at a few ranges, in the reticle's own
 * units. No wind speeds on it: the shooter reads the flags, not a number. The holds are the solver's, for a
 * full-value crosswind as a flag at 3 m reads it, rounded to the quarter mark a shooter can hold.
 */
const CARD_FLAGS = [20, 45, 70, 90];
const CARD_RANGES = { pso: [200, 400, 600, 800], tree: [200, 400, 600, 800], vss: [100, 200, 300] } as const satisfies Record<Reticle['id'], readonly number[]>;
const windCard = $('windcard');
let windCardFor = '';
const quarters = (h: number) => {
  const q = Math.round(h * 4);
  if (q === 0) return '0';
  const whole = Math.floor(q / 4);
  const part = ['', '¼', '½', '¾'][q % 4]!;
  return `${whole || ''}${part}` || '0';
};
const flagIcon = (deg: number) => {
  const a = (Math.min(88, deg) * Math.PI) / 180;
  // The fly streams out at `deg` from the pole: hoist 5 px, fly 11 px.
  const p = (along: number, down: number) => `${(4 + along * Math.sin(a)).toFixed(1)},${(2 + down + along * Math.cos(a)).toFixed(1)}`;
  return `<svg width="22" height="20" viewBox="0 0 22 20"><line x1="4" y1="1" x2="4" y2="20" stroke="currentColor" stroke-width="1.2"/>` +
    `<polygon points="${p(0, 0)} ${p(11, 0)} ${p(11, 5)} ${p(0, 5)}" fill="#f0552a"/></svg>`;
};
function syncWindCard(): void {
  const key = `${state.reticle}|${state.easy}`;
  if (key === windCardFor) return;
  windCardFor = key;
  const ret = RETICLES[state.reticle]();
  const ranges = CARD_RANGES[state.reticle];
  const drift = crossDriftPerMs(ROUNDS[ret.round], ranges);
  const unit = ret.id === 'tree' ? 'mil' : 'thousandths';
  windCard.innerHTML =
    `<div class="dope-head"><b>WIND</b> ${RIFLES[RIFLE[state.reticle]].name} · ${ROUNDS[ret.round].name}<span>${unit} into the wind</span></div>` +
    `<table><tr><th>flag</th>${CARD_FLAGS.map((d) => `<td>${flagIcon(d)}</td>`).join('')}</tr>` +
    // Easy: what the meter reads for each flag, to go from its number to a column.
    (state.easy ? `<tr class="card-sub"><th>m/s</th>${CARD_FLAGS.map((d) => `<td>${d >= 90 ? 10 : Math.round(d / FLAG_DEG_PER_MS)}</td>`).join('')}</tr>` : '') +
    ranges.map((r, i) => `<tr><th>${r} m</th>${CARD_FLAGS.map((d) => `<td>${quarters(((d >= 90 ? 10 : d / FLAG_DEG_PER_MS) * drift[i]!) / r / ret.unitRad)}</td>`).join('')}</tr>`).join('') +
    `</table><div class="card-note">From 10–11 or 1–2 o'clock: half. From 12 or 6: none.<br>Read the near flags first: the first third of the way counts most.</div>`;
}

const windIn = $('wind') as HTMLInputElement;
const windDirIn = $('winddir') as HTMLInputElement;
windIn.oninput = () => (state.wind.speed = Number(windIn.value));
windDirIn.oninput = () => {
  state.wind.fromClock = Number(windDirIn.value);
  // Wakes point downwind: bake them again once the dial has stopped moving.
  shelterDue = performance.now() + 250;
};
const glassAngleIn = $('glassangle') as HTMLInputElement;
glassAngleIn.oninput = () => { state.glassAngle = Number(glassAngleIn.value); glaze(); };
$('glass').onclick = () => { state.glass = GLASS_NEXT[state.glass]; glaze(); syncUi(); };
$('pane').onclick = () => glaze();

/**
 * The elevation drum on top of the scope (see drum.ts), engraved on the 3D rifle. Each rifle keeps its own drum
 * where it was left; turning it moves the bore against the scope, so the zero, and with it every chevron,
 * moves with it. With the head up the shooter looks down at it and turns it by hand; on the weld `[` and `]`
 * click it by feel.
 */
const drumRifle = () => RIFLES[RIFLE[state.reticle]];
const drum = createDrum((i) => {
  sound.unlock();
  sound.drumClick();
  state.zero[state.reticle] = drumRifle().drumM[i]!;
  syncUi();
});
let drumShown = '';
function syncDrum(): void {
  const r = drumRifle();
  if (drumShown !== r.id) {
    drumShown = r.id;
    // A zero between the marks (a `zero=` still) snaps to the nearest one.
    const z = state.zero[state.reticle];
    const i = r.drumM.reduce((b, m, k) => (Math.abs(m - z) < Math.abs(r.drumM[b]! - z) ? k : b), 0);
    state.zero[state.reticle] = r.drumM[i]!;
    drum.set(r.drumM, i);
    rifle.setDrumMarks(r.drumM);
  }
  shooting.setZero(state.zero[state.reticle]);
}

function syncUi(): void {
  shooting.setRifle(RIFLE[state.reticle]);
  syncDrum();
  syncDope();
  sound.enabled = state.sound;
  windIn.value = String(state.wind.speed);
  windDirIn.value = String(state.wind.fromClock);
  glassAngleIn.value = String(state.glassAngle);
  $('glass').textContent = `Glass · ${state.glass}`;
  $('glass').classList.toggle('on', state.glass !== 'off');
  magIn.value = String(state.mag);
  parIn.value = String(parToSlider(state.parallax));
  exIn.value = String(state.eye.x);
  eyIn.value = String(state.eye.y);
  ezIn.value = String(state.eye.z);
  panIn.value = String(state.pan);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ret]')) b.classList.toggle('on', b.dataset.ret === state.reticle);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-flag]')) b.classList.toggle('on', state[b.dataset.flag as 'illum'] as boolean);
  syncWindCard();
  $('fire').textContent = shooting.status(clock).state === 'ready' ? 'Fire · Space' : 'Action · Space';
  $('scope').textContent = shooting.busy() ? 'Hands on the action' : adsIn ? 'Scope out · F' : 'Scope in · F';
  rifle.setRifle(RIFLE[state.reticle]);
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
 * Firing (see shooting.ts). The SVD, the bolt rifle behind the tree and the VSS kick differently. When the
 * motion has died away its lasting rise is folded into the aim, so the rifle stays where it ended up and the
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
/** Breathing (≈0.25 Hz figure-eight) plus heartbeat twitch, in object-space radians: [yaw, pitch]. */
function swayAt(t: number): [number, number] {
  if (!state.sway) return [0, 0];
  const b = 0.00032;
  const beat = Math.exp(-((t * 1.15) % 1) * 18);
  return [
    b * (Math.sin(t * 1.55) * 0.6 + Math.sin(t * 0.37 + 1) * 0.8),
    b * (Math.sin(t * 3.1 + 0.4) * 0.5 + Math.sin(t * 0.29) * 0.9) - 0.00006 * beat,
  ];
}
/** The hands working the action: offsets to the aim (see shooting.act). */
let hand: { yaw: number; pitch: number } | null = null;
/** Where the bore points at time t: the aim, sway, the hands on the action and any recoil still running. */
function aimAt(t: number): Aim {
  const [sy, sp] = swayAt(t);
  const rc = recoil ? recoilAt(recoil.spec, recoil.v, t - recoil.start) : REST;
  return { yaw: state.yaw + sy - rc.yaw - (hand?.yaw ?? 0), pitch: state.pitch + sp + rc.pitch + (hand?.pitch ?? 0) };
}
function fire(): void {
  const exit = shooting.press(clock, eyePos, aimAt, state.wind);
  // Working the action takes the firing hand off the grip, and the head comes up off the scope with it.
  if (shooting.busy() && adsIn) toggleScope();
  syncUi();
  if (exit === null) return;
  // A second shot before the first settles starts from wherever the rifle is when the bullet leaves.
  if (recoil) foldRecoil(recoilAt(recoil.spec, recoil.v, exit - recoil.start));
  recoil = { start: exit, spec: RECOIL[RIFLE[state.reticle]], v: shotVariation(shots++) };
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
  // No settling back onto the scope while the hands are on the action.
  if (!adsIn && shooting.busy()) return;
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
/**
 * The drum under the pointer, with the head up: where the ray from the eye meets it, its distance (m) and
 * how many screen px one detent of the drum's rim moves.
 */
const picker = new THREE.Raycaster();
picker.layers.enableAll();
const ndc = new THREE.Vector2();
function pickDrum(e: { clientX: number; clientY: number }): { dist: number; arcPx: number; side: number } | null {
  // The drum is turned with the head up, and not while the hands are busy with the action.
  if (adsIn || shooting.busy()) return null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  picker.setFromCamera(ndc, rifle.camera);
  const hit = picker.intersectObject(rifle.drum, true).find((h) => h.object.name === 'drum');
  if (!hit) return null;
  const pxPerM = r.height / 2 / Math.tan((rifle.camera.fov * Math.PI) / 360) / hit.distance;
  // Which side of the drum's axis the pointer is on, as the shooter sees it.
  const axis = rifle.drum.getWorldPosition(new THREE.Vector3()).project(rifle.camera);
  return { dist: hit.distance, arcPx: (DRUM_R_MM / 1000) * DRUM_STEP * pxPerM, side: Math.sign(ndc.x - axis.x) };
}
/**
 * Where the eye looks, and so focuses. The rifle stays blurred, as the eye is on the range, until the shooter
 * looks at the drum: the pointer on it, or a click of `[` or `]`. The eye stays on it while the pointer does and
 * for LOOK_HOLD s after the last click or after the pointer leaves, then goes back to the range.
 * `focusInv` is 1 / the focus distance, eased like accommodation; `focus=<m>` pins it for stills.
 */
const LOOK_HOLD = 1.5;
let focusInv = 0;
let drumLook = false;
let lookUntil = -Infinity;
const focusPinned = params.has('focus') ? num('focus', 0.29) : 0;
const lookAway = () => {
  if (drumLook) lookUntil = clock + LOOK_HOLD;
  drumLook = false;
};
let drumDrag: { x: number; acc: number; moved: number; arcPx: number; side: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) { toggleScope(); return; }
  canvas.setPointerCapture(e.pointerId);
  const d = pickDrum(e);
  if (d) {
    drumDrag = { x: e.clientX, acc: 0, moved: 0, arcPx: d.arcPx, side: d.side };
    drumLook = true;
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
const endDrumDrag = () => {
  // A tap without a drag clicks it once, toward the side that was tapped.
  if (drumDrag && drumDrag.moved < 4) drum.turn(drumDrag.side || 1);
  if (drumDrag) lookAway();
  drumDrag = null;
};
canvas.addEventListener('pointerup', (e) => { endDrumDrag(); pointers.delete(e.pointerId); pinch = 0; });
canvas.addEventListener('pointercancel', (e) => { if (drumDrag) lookAway(); drumDrag = null; pointers.delete(e.pointerId); pinch = 0; });
canvas.addEventListener('pointermove', (e) => {
  if (drumDrag) {
    // Turning by its rim: the side facing the eye follows the finger, so dragging left brings higher numbers in.
    const dx = e.clientX - drumDrag.x;
    drumDrag.x = e.clientX;
    drumDrag.moved += Math.abs(dx);
    drumDrag.acc -= dx;
    while (Math.abs(drumDrag.acc) >= drumDrag.arcPx) {
      const s = Math.sign(drumDrag.acc);
      drum.turn(s);
      drumDrag.acc -= s * drumDrag.arcPx;
    }
    return;
  }
  if (!pointers.size && e.pointerType === 'mouse') {
    const d = pickDrum(e);
    if (d) drumLook = true;
    else lookAway();
    canvas.style.cursor = d ? 'ew-resize' : '';
  }
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
let drumWheel = 0;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (pickDrum(e)) {
    lookUntil = clock + LOOK_HOLD;
    drumWheel += e.deltaY + e.deltaX;
    while (Math.abs(drumWheel) >= 40) {
      const s = Math.sign(drumWheel);
      drum.turn(-s);
      drumWheel -= s * 40;
    }
    return;
  }
  state.mag = clampMag(state.mag * Math.pow(1.0015, -e.deltaY));
  syncUi();
}, { passive: false });
const clampMag = (m: number) => Math.max(SCOPE.minMag, Math.min(SCOPE.maxMag, m));
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  if (e.code === 'KeyR') { state.reticle = ({ pso: 'tree', tree: 'vss', vss: 'pso' } as const)[state.reticle]; syncUi(); }
  if (e.code === 'KeyL') { state.illum = !state.illum; syncUi(); }
  if (e.code === 'KeyG') { state.glass = GLASS_NEXT[state.glass]; glaze(); syncUi(); }
  if (e.code === 'KeyH') document.body.classList.toggle('nohud');
  if (e.code === 'KeyF' && !e.repeat) toggleScope();
  if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && !shooting.busy()) {
    drum.turn(e.code === 'BracketLeft' ? -1 : 1);
    lookUntil = clock + LOOK_HOLD;
  }
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

/** Easy: a wind meter on a mast beside the hide, at the flags' height, so its reading goes straight onto the card. */
function windText(): string {
  const [x, , z] = windAt(state.wind, eyePos.x, heightAt(eyePos.x, eyePos.z) + WIND_REF_M, eyePos.z, clock, windTmp);
  const sp = Math.hypot(x, z);
  if (sp < 0.2) return 'calm';
  // It blows toward (x, z); it comes from the opposite bearing, clockwise from downrange.
  let c = (Math.atan2(-x, z) * 6) / Math.PI;
  c = ((Math.round(c * 2) / 2 + 11.5) % 12) + 0.5;
  const h = Math.floor(c);
  return `${sp.toFixed(1)} m/s · from ${h === 0 ? 12 : h}${c % 1 ? ':30' : ''}`;
}
const fmt = (m: number) => (Number.isFinite(m) ? `${Math.round(m)} m` : '∞');
const readout = $('readout');
let lastReadout = 0;
const woundCard = $('wound');
let woundDrawn = -1;

const dir = new THREE.Vector3();
const sunView = new THREE.Vector3();
/** Mirage drift: how far the crosswind has carried the shimmer (mrad) and the boil clock. */
const mirFlow = new THREE.Vector2();
let boil = 0;
const windTmp: [number, number, number] = [0, 0, 0];
const nearVel = new THREE.Vector2();
/** The mannequin the sun's shadow box is on: whichever the scope points nearest, with 0.2° of hysteresis. */
let watched = 0;
const offAim = (i: number, dir: THREE.Vector3) => {
  const f = range.targets[i]!.foot;
  return toT.set(f.x, f.y + 1, f.z).sub(eyePos).angleTo(dir);
};
function watch(dir: THREE.Vector3): void {
  const cur = offAim(watched, dir);
  for (let i = 0; i < range.targets.length; i++) {
    if (i !== watched && offAim(i, dir) < cur - 0.0035) {
      watched = i;
      break;
    }
  }
  if (range.shadowOn(watched)) renderer.shadowMap.needsUpdate = true;
}
const sunLocal = new THREE.Vector3();
const rifleFrame = new THREE.Quaternion();
const headQ = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
function frame(t: number, dt: number): void {
  clock = t;
  if (shelterDue && performance.now() > shelterDue) {
    shelterDue = 0;
    bakeShelter();
  }
  windGL.update(t);
  range.flags.update(t, dt, state.wind);
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
  // Working the bolt or changing the magazine moves the rifle and the cheek on the stock; the rifle stays
  // where the hands leave it.
  const acted = shooting.act(t);
  hand = acted.hand;
  const hp = acted.pose;
  if (acted.fold) {
    state.yaw -= acted.fold[0];
    state.pitch += acted.fold[1];
    panHead.yaw -= acted.fold[0];
    panHead.pitch += acted.fold[1];
    syncUi();
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
  // Working the action the eyes leave the target for the hands: the head's view turns down and right.
  const tiltPitch = rc.tiltPitch + panPitch - hp.gaze.pitch;
  const tiltYaw = rc.tiltYaw + panYaw - hp.gaze.yaw;
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
  eye.x += head.x + hp.head[0];
  eye.y += head.y + hp.head[1];
  eye.z += head.z + hp.head[2];
  if (!shot) stepAdapt(imageShare(eye, { x: Math.tan(tiltYaw), y: Math.tan(tiltPitch) }), dt);

  // Wobble: breathing and heartbeat, and the hands on the action.
  const [swYaw, swPitch] = swayAt(t);
  const yaw = state.yaw + swYaw - (hand?.yaw ?? 0);
  const pitch = state.pitch + swPitch + (hand?.pitch ?? 0);
  // The scope looks where the rifle points; the naked eye looks where the head points, which lags it.
  euler.set(pitch + rc.pitch, yaw - rc.yaw, 0);
  scopeCam.quaternion.setFromEuler(euler);
  // The head's view relative to the scope, which the rifle is drawn from too, so the two line up exactly.
  headQ.setFromEuler(euler.set(-tiltPitch, tiltYaw, 0));
  wideCam.quaternion.multiplyQuaternions(scopeCam.quaternion, headQ);
  scopeCam.fov = (trueFovRad(SCOPE, state.mag) * 180) / Math.PI;
  scopeCam.updateProjectionMatrix();
  scopeCam.getWorldDirection(dir);
  watch(dir);

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
  // The eye focuses where it looks (accommodation takes a few tenths of a second): on the hands and the action
  // while it works them (the plan's gaze carries its own focus), on the drum while the shooter looks at it with
  // the head up, far away otherwise. Focused near, the range blurs by pupil / distance.
  // The drum's rear face is 253 mm ahead of the exit pupil and 30 mm up, in the scope's frame.
  const drumDist = Math.hypot(eye.x, eye.y - 30, eye.z + 253) / 1000;
  const looking = drumLook || t < lookUntil;
  const working = acted.busy;
  const wantFocus = focusPinned ? 1 / focusPinned : working ? hp.invF : adsIn || !looking ? 0 : 1 / drumDist;
  focusInv = shot || working ? wantFocus : focusInv + (wantFocus - focusInv) * (1 - Math.exp(-dt / 0.3));
  u.uWorldBlur!.value = Math.max(9 * dpr * adapt, ((0.5 * eye.pupilMm) / 1000 / th) * focusInv * R);
  // Mirage boil: ~25 µrad near the ground at midday, seen bigger the more you magnify.
  u.uMirage!.value = state.mirage ? 0.000025 * toUv * Math.min(1, D / 300) : 0;
  // A crosswind carries the shimmer sideways at roughly its own angular rate, weighted toward where the
  // heat is (the near two thirds of the path); with little wind across, it boils in place.
  const mirD = Math.min(Number.isFinite(D) ? D : 2000, 2000);
  probe.copy(eyePos).addScaledVector(dir, 0.6 * mirD);
  const crossM = windAt(state.wind, probe.x, probe.y, probe.z, t, windTmp)[0];
  const flowRate = (0.6 * crossM * 1000) / Math.max(50, mirD);
  const boilRate = 1 / (1 + Math.abs(crossM) / 1.5);
  if (shot) {
    mirFlow.set(flowRate * t, 0);
    boil = boilRate * t;
  } else {
    mirFlow.x += flowRate * dt;
    boil += boilRate * dt;
  }
  u.uMirFlow!.value.copy(mirFlow);
  u.uBoil!.value = boil;
  // Bullets in flight and what they hit.
  scopeCam.updateMatrixWorld();
  sunView.copy(toSun).transformDirection(scopeCam.matrixWorldInverse);
  const fx = shooting.update(t, scopeCam, eyePos, state.wind, sunView, state.parallax);
  u.uTrS!.value = fx.trace.s;
  u.uTrA!.value.copy(fx.trace.a);
  u.uTrB!.value.copy(fx.trace.b);
  u.uTrW!.value.copy(fx.trace.w);
  u.uTrSeed!.value = fx.trace.seed;
  u.uDust!.value = fx.dust;
  // The blast dust hangs a metre or two out: a metre of drift is about half a screen height.
  u.uDustDrift!.value = fx.dustDrift * 0.5;
  u.uDustTop!.value = fx.dustTop;
  if (fx.shadow) renderer.shadowMap.needsUpdate = true;
  glass.update(t, toSun);

  // The rifle from the eye: the head looks along the scope, less the recoil and swing tilt between them.
  const cam = rifle.camera;
  cam.position.set(eye.x / 1000, eye.y / 1000, eye.z / 1000);
  cam.quaternion.copy(headQ);
  cam.updateMatrixWorld();
  rifle.pose(hp);
  rifle.setLight(sunLocal.copy(toSun).applyQuaternion(rifleFrame.copy(scopeCam.quaternion).invert()));
  drum.step(shot ? 1 : dt);
  rifle.setDrum((drum.pos - drumHome(drumRifle().drumM)) * DRUM_STEP);
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
  near.render(kNear, nearVel, shot ? 0 : (t * 60) % 97, focusInv);

  drawRet();
  // The magnified image only reaches the screen through the eyebox. When no direction in the field can send
  // light into the eye pupil, the composite multiplies the image by exactly zero, so skip rendering it.
  if (!eyeboxDark(eye, u.uEyeSweep!.value, ep / 2, eye.pupilMm / 2, th)) {
    // Far bushes swap to their low-detail version once the difference is under half a pixel.
    range.bushLod(scopeCam, pxPerRad(scopeCam, scopeRT.height), 0.5);
    renderer.setRenderTarget(scopeRT);
    renderer.render(scene, scopeCam);
  }
  const wide = adapt > 0.6 ? wideLoRT : wideRT;
  u.tWide!.value = wide.texture;
  u.uWideLod!.value = wide === wideLoRT ? -Math.log2(3) : 0;
  // The range is static, so the surround depends only on where the eye looks. On the glass it is a third of the
  // resolution and blurred by several of its pixels: keep last frame's until the view has turned half a pixel.
  const widePx = pxPerRad(wideCam, wide.height);
  const turned = 2 * Math.acos(Math.min(1, Math.abs(wideDrawnQ.dot(wideCam.quaternion)))) * widePx;
  if (wide !== wideLoRT || wideDrawn !== wide || turned >= 0.5) {
    // Behind that blur a whole pixel of bush outline is invisible; in the sharp view, half a pixel.
    range.bushLod(wideCam, widePx, wide === wideLoRT ? 1 : 0.5);
    renderer.setRenderTarget(wide);
    renderer.render(scene, wideCam);
    wideDrawn = wide;
    wideDrawnQ.copy(wideCam.quaternion);
  }
  renderer.setRenderTarget(null);
  renderer.render(quadScene, quadCam);

  if (t - lastReadout > 0.15 || shot) {
    lastReadout = t;
    const ret = RETICLES[state.reticle]();
    const tf = trueFovRad(SCOPE, state.mag);
    const par = parallaxShiftRad(SCOPE, state.mag, Math.hypot(eye.x, eye.y), Dr, state.parallax) / ret.unitRad;
    const fig = 1.7 / range.targets[watched]!.range / ret.unitRad;
    const unit = ret.id === 'tree' ? 'mil' : 'th';
    const status = shooting.status(t);
    readout.innerHTML = [
      ['Head', acted.busy ? 'up · hands on the action' : ads ? (ads.dir === 'in' ? 'going down' : 'coming up') : adsIn ? 'on the weld' : 'up'],
      ['Magnification', `${state.mag.toFixed(1)}×`],
      ['True field', `${((tf * 180) / Math.PI).toFixed(2)}° · ${(tf * 1000).toFixed(0)} mil`],
      ['Exit pupil', `${ep.toFixed(1)} mm`],
      ['Parallax set', fmt(state.parallax)],
      // The drum's number is the zero: 1 is 100 m, where the cut reticles are true.
      ['Zero', `${state.zero[state.reticle]} m · drum ${state.zero[state.reticle] / 100}`],
      ['Round', `${ROUNDS[ret.round].name} · ${ROUNDS[ret.round].cartridge}`],
      ...(ret.id === 'tree' ? [['Bullet speed', `${ROUNDS[ret.round].mv} m/s`]] : []),
      ['Rounds', `${status.rounds} · ${status.state}`],
      ...(state.easy ? [['Wind meter', windText()]] : []),
      ...(state.glass !== 'off' ? [['Glass', `${GLAZING[state.glass].name} · ${state.glassAngle ? `${Math.abs(state.glassAngle)}° ${state.glassAngle > 0 ? 'right' : 'left'}` : 'square-on'}`]] : []),
      ['Last shot', status.shot],
      ['Aim point', fmt(D)],
      ['Parallax error', `${Math.abs(par).toFixed(2)} ${unit}`],
      ['Target 1.7 m', `${fig.toFixed(2)} ${unit}`],
    ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    const w = status.wound;
    woundCard.hidden = !w;
    if (w) {
      $('wound-text').innerHTML = woundText(w.wound, w.speed, w.since, w.glass);
      if (woundDrawn !== w.n) { $('wound-svg').innerHTML = woundSvg(w.wound); woundDrawn = w.n; }
    }
  }
}

layout();
syncUi();
if (shot) {
  // Deterministic still: fixed clock, a couple of frames so shadows and MSAA settle.
  const t = num('t', 2.4);
  // recoil=<s>: the still is taken that long after the trigger.
  if (params.has('recoil')) recoil = { start: t - num('recoil', 0), spec: RECOIL[RIFLE[state.reticle]], v: shotVariation(0) };
  // fire=<s>: the still is taken that long after the bullet left the muzzle (recoil and all).
  if (params.has('fire')) {
    const exit = t - num('fire', 0);
    shooting.fireAt(exit, eyePos, aimAt(exit), state.wind);
    // norecoil: keep the rifle still, to look at the impact.
    if (!params.has('norecoil')) recoil = { start: exit, spec: RECOIL[RIFLE[state.reticle]], v: shotVariation(0) };
  }
  // panrate=<right>,<up> (deg/s): the still is taken mid-swing, with the head trailing as it would.
  if (params.has('panrate')) {
    const [right = 0, up = 0] = params.get('panrate')!.split(',').map(Number);
    const lag = PAN_LAG * state.pan;
    panHead.yaw = state.yaw + ((right * Math.PI) / 180) * lag;
    panHead.pitch = state.pitch - ((up * Math.PI) / 180) * lag;
  }
  // act=<s> / reload=<s>: the still is taken that long after the hands start working the bolt (a magazine
  // change on the SVD and VSS) or changing the magazine; the head comes up off the weld as they start.
  const handStart = params.has('act') ? t - num('act', 0) : params.has('reload') ? t - num('reload', 0) : null;
  if (handStart !== null) shooting.handleAt(handStart, params.has('reload'));
  // adsin=<s> / adsout=<s>: the still is taken that long after the head starts down / up.
  for (const [k, inward] of [['adsin', true], ['adsout', false]] as const) {
    if (!params.has(k) && !(k === 'adsout' && handStart !== null)) continue;
    const start = k === 'adsout' && handStart !== null ? handStart : t - num(k, 0);
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
