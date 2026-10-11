/**
 * Party lab: one evening at a generated mansion, watched from the perch or from above.
 *
 *   /party/?seed=gala-night&t=90&speed=5&view=plan&sel=4&follow=1&ov=sight,map
 *
 * t is minutes after 19:00 (or a clock time such as 20:30); speed multiplies the
 * game's own pace, where 1× plays the three-hour party in one real hour. ov turns on
 * plan overlays (sight, sound, gossip, suspicion, map, mood); tension= sets everyone's
 * tension and energy= scales everyone's energy at time t.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { generateMansion, type MansionBlueprint, type MansionOptions } from '../../src/mansion';
import { buildMansion, type BuiltMansion, type Quality } from '../../src/mansion/build';
import { createGradePass } from '../../src/mansion/build/grade';
import { clockLabel, LIGHT_OFF, MOVABLE_CURTAINS, Party, PARTY_LENGTH, PARTY_START, phaseIndexAt, STEP, TIME_SCALE, type PhaseId } from '../../src/party';
import { KNOWN, SLOTS, SUSPICIOUS, VERBS, type FactKind, type Verb } from '../../src/party/memory';
import type { MoodOverride, RoomMood } from '../../src/party/mood';
import { DETAIL_FOV, DETAIL_RANGE, FOV } from '../../src/party/senses';
import { CASES, type CaseKind } from '../../src/party/register';
import type { Provocation } from '../../src/party/sim';
import { Crowd, type FrameState } from '../../src/party/render/crowd';
import { Fixtures } from '../../src/party/render/fixtures';
import { DRINKS, NEED_IDS, type ActionId, type Held, type PartyEvent, type Person, type RoleId } from '../../src/party/types';
import { labelForms } from '../briefing';

type View = 'scope' | 'wide' | 'plan' | 'orbit';

const params = new URLSearchParams(location.search);
const shot = params.has('shot');
if (shot) document.body.classList.add('shot');
if (params.has('ui')) document.body.classList.add('ui');
const W = Number(params.get('w') ?? 0) || innerWidth;
const H = Number(params.get('h') ?? 0) || innerHeight;
const viewSize = (): { w: number; h: number } => (params.has('w') ? { w: W, h: H } : { w: innerWidth, h: innerHeight });

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: shot });
renderer.setPixelRatio(shot ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(params.get('exposure') ?? 1.4);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(4, W / H, 1, 9000);
const ortho = new THREE.OrthographicCamera(-50, 50, 30, -30, 1, 3000);
// Flat work light for the plan view only (upstairs rooms are dark); zero elsewhere, so views never recompile shaders.
const planLight = new THREE.AmbientLight(0xfff1dc, 0);
scene.add(planLight);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
controls.enableDamping = true;

const rt = new THREE.WebGLRenderTarget(W * renderer.getPixelRatio(), H * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: Number(params.get('msaa') ?? 4) });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.55, 1.4));
composer.addPass(createGradePass({ splitStrength: 0.18, saturation: 1.12 }));
composer.addPass(new OutputPass());

const $ = (id: string) => document.getElementById(id)!;
const seedInput = $('seed') as HTMLInputElement;
seedInput.value = params.get('seed') ?? 'gala-night';

const LEVEL_NAMES = ['ground', 'first', 'second', 'third'];
const PHASE_COLOR: Record<PhaseId, string> = {
  arrival: '#4f6f93',
  mingle: '#6d604c',
  champagne: '#c9a15c',
  toast: '#e6c98a',
  dinner: '#97553f',
  dancing: '#7b58a0',
  games: '#4a7e64',
  farewell: '#565c72',
};
const ROLE_LABEL: Record<RoleId, string> = {
  host: 'host',
  waiter: 'waiter',
  bartender: 'bartender',
  cook: 'cook',
  politician: 'politician',
  pianist: 'pianist',
  doctor: 'doctor',
  dancer: 'dancer',
  billiards: 'billiards player',
  guest: '',
};
const ACTION_LABEL: Record<ActionId, string> = {
  arrive: 'arriving',
  mingle: 'in conversation',
  drink: 'at the bar',
  champagne: 'getting champagne',
  toilet: 'in the bathroom',
  sit: 'sitting',
  art: 'looking at the art',
  terrace: 'on the terrace',
  dance: 'dancing',
  dinner: 'at dinner',
  toast: 'at the toast',
  ask: 'asking someone',
  games: 'at the games',
  wander: 'wandering',
  leave: 'leaving',
  staff: 'working',
};
const NOTE_LABEL: Record<string, string> = {
  bar: 'tending the bar',
  load: 'loading a tray',
  serve: 'serving',
  cook: 'cooking',
  door: 'at the door',
  queue: 'queueing for the bathroom',
  supper: 'at supper in the ballroom',
  billiards: 'playing billiards',
  cards: 'playing cards',
  cinema: 'watching a film',
};

let bp: MansionBlueprint;
let built: BuiltMansion | null = null;
let party: Party;
let crowd: Crowd | null = null;
/** Door leaves and the curtains people can draw, moved from the sim each frame. */
let fixtures: Fixtures | null = null;
let view: View = (params.get('view') as View) ?? 'scope';
let aim = { yaw: 0, pitch: 0, fov: Number(params.get('fov') ?? 4) };
let planLevel = Math.max(0, Math.floor(Number(params.get('level') ?? 0)) || 0);
let planZoom = Math.max(1, Math.min(14, Number(params.get('zoom') ?? 1) || 1));
const planPan = { x: 0, z: 0 };
const PLAN_ZOOM_MAX = 14;

/** Each person's state before the last sim step, so frames between steps can be interpolated. */
interface Snap {
  x: number;
  y: number;
  z: number;
  yaw: number;
  level: number;
  present: boolean;
}
let prev: Snap[] = [];
/** In-game seconds banked toward the next sim step. */
let acc = 0;
const SPEEDS = [0, 1, 5, 20, 60];
let speed = Number(params.get('speed') ?? (shot ? 0 : 1));
let selected = params.has('sel') ? Number(params.get('sel')) : -1;
let follow = params.has('follow');
/** Clock for gestures: frozen when paused, so a paused frame stays still. */
let animClock = 0;

type Overlay = 'sight' | 'sound' | 'gossip' | 'suspicion' | 'cases' | 'map' | 'mood';
const OVERLAYS: readonly Overlay[] = ['sight', 'sound', 'gossip', 'suspicion', 'cases', 'map', 'mood'];
const overlays = new Set<Overlay>((params.get('ov') ?? '').split(',').filter((o): o is Overlay => (OVERLAYS as readonly string[]).includes(o)));

/** What the lab has done to this evening (rumours, things gone, sightings, mood nudges), replayed whenever a seek goes back. */
let planted: Provocation[] = [];
/** Where the lab last made something go missing: "seen there" puts someone in that room. */
let goneRoom = -1;
/** The URL's provocations apply to the house it names, not to one built later. */
let built0 = true;
let nudges: MoodOverride[] = [];

/** The URL's mood: everyone's tension set, or their energy scaled, at time t. */
function urlNudges(): MoodOverride[] {
  const tension = params.get('tension');
  const energy = params.get('energy');
  if (tension === null && energy === null) return [];
  return [{ t: parseTime(params.get('t')), target: 'all', tension: tension !== null ? Number(tension) : undefined, energy: energy !== null ? Number(energy) : undefined }];
}

/**
 * The URL's provocations: `gone=80:5` (something of the house's goes missing from room 5 at
 * 80 min), `seen=75:16:5` (person 16 seen poking round room 5 at 75 min). Several are joined by commas.
 */
function urlProvocations(): Provocation[] {
  const out: Provocation[] = [];
  for (const g of (params.get('gone') ?? '').split(',').filter(Boolean)) {
    const [t, room] = g.split(':').map(Number);
    if (Number.isFinite(t) && Number.isFinite(room)) out.push({ t: t! * 60, kind: 'gone', subject: -1, room });
  }
  for (const g of (params.get('seen') ?? '').split(',').filter(Boolean)) {
    const [t, who, room] = g.split(':').map(Number);
    if (Number.isFinite(t) && Number.isFinite(who) && Number.isFinite(room)) out.push({ t: t! * 60, kind: 'seen', subject: who!, room });
  }
  return out.sort((a, b) => a.t - b.t);
}

// ------------------------------------------------------------------ setup

function build(): void {
  const seed = seedInput.value.trim() || 'gala-night';
  bp = generateMansion({ seed, size: (params.get('size') as MansionOptions['size']) ?? undefined });
  if (built) {
    scene.remove(built.root);
    built.dispose();
  }
  built = buildMansion(bp, { renderer, quality: (params.get('quality') as Quality) ?? 'high', dynamicDoors: true, dynamicCurtains: (r) => MOVABLE_CURTAINS.has(r.type) });
  scene.add(built.root);
  if (fixtures) {
    scene.remove(fixtures.root);
    fixtures.dispose();
  }
  fixtures = new Fixtures(built.doorLeaves, built.curtains, built.lighting, { materials: built.materials });
  scene.add(fixtures.root);
  planLevel = Math.min(planLevel, bp.levels.length - 1);
  planPan.x = planPan.z = 0;
  aim = { yaw: 0, pitch: 0, fov: aim.fov };
  buildFloorButtons();
  // A new house is a new cast: what was planted in the last one doesn't carry over (the URL's own, on the first build, does).
  planted = built0 ? urlProvocations() : [];
  built0 = false;
  goneRoom = [...planted].reverse().find((v) => v.kind === 'gone')?.room ?? -1;
  nudges = urlNudges();
  newParty();
  if (selected >= party.people.length) selected = -1;
  setView(view);
  if (!shot) {
    const url = new URL(location.href);
    url.searchParams.set('seed', seed);
    history.replaceState(null, '', url);
  }
}

/** A fresh evening in the current house (the same seed always gives the same evening). */
function newParty(): void {
  party = new Party(bp, { seed: params.get('party') ?? bp.seed, guests: params.has('guests') ? Number(params.get('guests')) : undefined, provoke: planted, mood: nudges, profile: params.has('profile') });
  if (crowd) {
    scene.remove(crowd.root);
    crowd.dispose();
  }
  crowd = new Crowd(party.people, { lighting: built!.lighting });
  scene.add(crowd.root);
  acc = 0;
  snapshot();
  buildTimeline();
  buildPeople();
}

function snapshot(): void {
  prev = party.people.map((p) => ({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, level: p.level, present: p.present }));
}

/** Jump to in-game second `t`: forward by simulating, backward by replaying from 19:00. */
function seek(t: number): void {
  t = Math.max(0, Math.min(PARTY_LENGTH, t));
  if (t < party.t) newParty();
  party.advance(t - party.t);
  acc = 0;
  snapshot();
  refreshPanel();
}

/** Seek with a "simulating" note painted first: replaying a whole evening takes a moment. */
function seekSoon(t: number): void {
  $('busy').classList.add('on');
  requestAnimationFrame(() =>
    setTimeout(() => {
      seek(t);
      $('busy').classList.remove('on');
    }, 0),
  );
}

function parseTime(s: string | null): number {
  if (!s) return 0;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) return (Number(m[1]) * 3600 + Number(m[2]) * 60 - PARTY_START + 86400) % 86400;
  return Number(s) * 60 || 0;
}

// ------------------------------------------------------------------ views

function buildFloorButtons(): void {
  const row = $('floors');
  row.replaceChildren();
  for (const lv of bp.levels) {
    const b = document.createElement('button');
    b.textContent = LEVEL_NAMES[lv.index] ?? `level ${lv.index}`;
    b.dataset.level = String(lv.index);
    b.classList.toggle('on', lv.index === planLevel);
    b.onclick = () => setPlanLevel(lv.index);
    row.appendChild(b);
  }
}

function planFrame(): { half: number; x: number; z: number } {
  const fp = bp.stats.footprint;
  return { half: (Math.max(fp.x1 - fp.x0, fp.z1 - fp.z0) * 0.62 + 12) / planZoom, x: (fp.x0 + fp.x1) / 2 + planPan.x, z: (fp.z0 + fp.z1) / 2 + planPan.z };
}

function setView(v: View): void {
  view = v;
  document.body.classList.toggle('plan', v === 'plan');
  if (!built) return;
  controls.enabled = v === 'orbit';
  scene.fog = v === 'plan' ? null : built.fog;
  $('reticle').classList.toggle('on', v === 'scope');
  planLight.intensity = v === 'plan' ? 0.6 : 0;
  const cut = bp.levels[planLevel]!;
  renderer.clippingPlanes = v === 'plan' ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), cut.floorY + Math.min(2.6, cut.height * 0.75))] : [];
  if (crowd) {
    crowd.markerLevel = v === 'plan' ? planLevel : null;
    // At least 9 px across, whatever the zoom.
    crowd.markerScale = Math.max(1, 9 / (0.76 * (viewSize().h / (2 * planFrame().half))));
  }
  const fp = bp.stats.footprint;
  const cx = (fp.x0 + fp.x1) / 2;
  const cz = (fp.z0 + fp.z1) / 2;
  if (v === 'scope' || v === 'wide') {
    renderPass.camera = camera;
    camera.position.copy(built.perch.position);
    camera.fov = v === 'wide' ? 26 : aim.fov;
    camera.near = 1;
    camera.far = 9000;
    camera.updateProjectionMatrix();
    aimCamera();
  } else if (v === 'orbit') {
    renderPass.camera = camera;
    camera.fov = 35;
    camera.near = 0.5;
    camera.updateProjectionMatrix();
    camera.position.set(cx + 50, 32, cz + 60);
    controls.target.set(cx, 3, cz);
    controls.update();
  } else {
    renderPass.camera = ortho;
    const f = planFrame();
    const a = viewSize().w / viewSize().h;
    ortho.left = -f.half * a;
    ortho.right = f.half * a;
    ortho.top = f.half;
    ortho.bottom = -f.half;
    ortho.position.set(f.x, 400, f.z + 0.01);
    ortho.up.set(0, 0, -1);
    ortho.lookAt(f.x, 0, f.z);
    ortho.updateProjectionMatrix();
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views button')) b.classList.toggle('on', b.dataset.v === v);
  layoutPlanLabels();
}

function layoutPlanLabels(): void {
  const box = $('plan-labels');
  box.replaceChildren();
  if (view !== 'plan' || !built) return;
  const f = planFrame();
  const { w, h } = viewSize();
  const pxPerM = h / (2 * f.half);
  for (const r of bp.rooms) {
    if (r.level !== planLevel) continue;
    const rw = (r.inner.x1 - r.inner.x0) * pxPerM;
    if ((r.inner.z1 - r.inner.z0) * pxPerM < 15) continue;
    const text = labelForms(r.label).find((t) => t.length * 6.7 + 10 <= rw);
    if (!text) continue;
    // Room names sit at the top edge of the room, out of the crowd's way.
    const x = w / 2 + ((r.inner.x0 + r.inner.x1) / 2 - f.x) * pxPerM;
    const y = h / 2 + (r.inner.z0 - f.z) * pxPerM + 10;
    if (x < 0 || x > w || y < 0 || y > h) continue;
    const el = document.createElement('span');
    el.textContent = text;
    el.className = r.role;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    box.appendChild(el);
  }
}

function perchAngles(): { yaw0: number; pitch0: number } {
  const base = built!.perch.target.clone().sub(built!.perch.position).normalize();
  return { yaw0: Math.atan2(base.x, base.z), pitch0: Math.asin(base.y) };
}

function aimCamera(): void {
  if (!built) return;
  const { yaw0, pitch0 } = perchAngles();
  const yaw = yaw0 + aim.yaw;
  const pitch = pitch0 + aim.pitch;
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  camera.lookAt(camera.position.clone().add(dir));
}

/** Turn the scope onto a world point (the followed person). */
function aimAt(x: number, y: number, z: number): void {
  const d = new THREE.Vector3(x, y, z).sub(camera.position).normalize();
  const { yaw0, pitch0 } = perchAngles();
  aim.yaw = Math.atan2(d.x, d.z) - yaw0;
  aim.pitch = Math.asin(d.y) - pitch0;
  aimCamera();
}

// ------------------------------------------------------------------ frame

function angleLerp(a: number, b: number, f: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

function frameStates(): FrameState[] {
  const f = Math.min(1, acc / STEP);
  const speaking = new Set<number>();
  for (const g of party.groups.values()) speaking.add(g.speaker);
  return party.people.map((p, i) => {
    const q = prev[i]!;
    // No smoothing across a teleport (arrival, a seat, the top of a stair).
    const k = q.present && q.level === p.level && Math.hypot(p.x - q.x, p.z - q.z) < 1.5 ? f : 1;
    return {
      x: q.x + (p.x - q.x) * k,
      y: q.y + (p.y - q.y) * k,
      z: q.z + (p.z - q.z) * k,
      yaw: angleLerp(q.yaw, p.yaw, k),
      pose: p.pose,
      speaking: p.pose === 'talk' && speaking.has(p.id),
      room: p.room,
      visible: p.present && !p.gone,
      gesture: party.t < p.gestureUntil ? p.gesture : null,
      // A glance, or the way someone is pointing.
      headYaw: party.t < p.lookUntil || (p.gesture === 'point' && party.t < p.gestureUntil) ? angleLerp(0, Math.atan2(p.lookX - p.x, p.lookZ - p.z) - p.yaw, 1) : 0,
    };
  });
}

const activeCamera = (): THREE.Camera => (view === 'plan' ? ortho : camera);

/** Screen position of a world point in the current view, or null behind the camera. */
function toScreen(x: number, y: number, z: number): { x: number; y: number } | null {
  const v = new THREE.Vector3(x, y, z).project(activeCamera());
  if (v.z > 1 || v.z < -1) return null;
  const { w, h } = viewSize();
  return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
}

/** Doors swing, curtains draw and rooms go dark as the sim has them. */
function syncFixtures(): void {
  if (!fixtures || !built) return;
  const w = party.world;
  for (const d of w.doors) fixtures.setDoor(d.opening, d.open);
  for (const c of w.curtains) if (c.movable) fixtures.setCurtain(c.opening, c.state === 'drawn' ? 1 : 0, c.state === 'sheer');
  fixtures.update();
  // A room built dark has no lamps to switch on, so only rooms lit at the start can go dark.
  for (let r = 0; r < bp.rooms.length; r++) built.lighting.setScopeScale(r, w.lightOn[r] || !w.litAtStart(r) ? 1 : LIGHT_OFF);
}

function draw(): void {
  syncFixtures();
  const states = frameStates();
  const sel = party.people[selected];
  const s = sel ? states[selected] : undefined;
  if (follow && s?.visible && (view === 'scope' || view === 'wide')) aimAt(s.x, s.y + 1.2, s.z);
  if (crowd) {
    crowd.selected = selected;
    crowd.update(states, animClock);
  }
  drawOverlays(states);
  // Name tag over the selected person.
  const tag = $('tag');
  const at = sel && s?.visible && (view !== 'plan' || sel.level === planLevel) ? toScreen(s.x, s.y + (view === 'plan' ? 2.2 : sel.look.height + 0.25), s.z) : null;
  tag.classList.toggle('on', !!at);
  if (at) {
    tag.textContent = sel!.name;
    tag.style.left = `${at.x}px`;
    tag.style.top = `${at.y - (view === 'plan' ? 12 : 4)}px`;
  }
}

// ------------------------------------------------------------------ overlays

const overlay = $('overlay') as HTMLCanvasElement;
const octx = overlay.getContext('2d')!;
let overlayDrawn = false;

const MOOD_RGB: Record<RoomMood, string> = { festive: '224,181,106', relaxed: '111,163,200', uneasy: '217,137,74', tense: '212,82,74' };
const KIND_COLOR: Record<FactKind, string> = { romance: '#e58fb0', odd: '#e0b56a', mishap: '#8fc7e5', house: '#a9b6c8', request: '#b6e58f', whereabouts: '#9a9486', case: '#c99ae0' };
const CASE_RGB = '201, 154, 224';
const CASE_LABEL: Record<CaseKind, string> = { gone: 'something gone', 'person-gone': 'someone missing', dark: 'lights out', locked: 'a door locked', noise: 'a crash', cheating: 'cheating?', 'not-themselves': 'not themselves' };
/** How long a sound or a piece of gossip stays drawn (in-game s). */
const SOUND_FADE = 20;
const GOSSIP_FADE = 40;

/** Screen position of a point on the plan. */
function planPx(x: number, z: number): [number, number] {
  const f = planFrame();
  const { w, h } = viewSize();
  const k = h / (2 * f.half);
  return [w / 2 + (x - f.x) * k, h / 2 + (z - f.z) * k];
}

/** A small label on a dark ground; skipped when it won't fit in `room` px. */
function chip(text: string, x: number, y: number, color: string, room = Infinity): void {
  octx.font = '11px ui-monospace, Menlo, monospace';
  const w = octx.measureText(text).width + 8;
  if (w > room) return;
  octx.fillStyle = 'rgba(7, 8, 12, 0.66)';
  octx.fillRect(x - w / 2, y - 8, w, 15);
  octx.fillStyle = color;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillText(text, x, y);
}

function line(a: [number, number], b: [number, number], color: string, width: number, dash: number[] = []): void {
  octx.strokeStyle = color;
  octx.lineWidth = width;
  octx.setLineDash(dash);
  octx.beginPath();
  octx.moveTo(a[0], a[1]);
  octx.lineTo(b[0], b[1]);
  octx.stroke();
  octx.setLineDash([]);
}

/**
 * The plan's overlays: the picked person's sight and mental map, who suspects whom, sounds
 * and who heard them, gossip as it passes, and each room's mood.
 */
function drawOverlays(states: FrameState[]): void {
  if (view !== 'plan' || !overlays.size) {
    if (overlayDrawn) octx.clearRect(0, 0, overlay.width, overlay.height);
    overlayDrawn = false;
    return;
  }
  const { w, h } = viewSize();
  const dpr = renderer.getPixelRatio();
  if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
    overlay.width = Math.round(w * dpr);
    overlay.height = Math.round(h * dpr);
    overlay.style.width = `${w}px`;
    overlay.style.height = `${h}px`;
  }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, w, h);
  overlayDrawn = true;
  const pxPerM = h / (2 * planFrame().half);
  const t = party.t;
  const sel = party.people[selected];
  const here = (i: number): [number, number] | null => {
    const p = party.people[i];
    const st = states[i];
    return p && st?.visible && p.level === planLevel ? planPx(st.x, st.z) : null;
  };

  // Rooms: the mood under the picked person's map.
  bp.rooms.forEach((r, i) => {
    if (r.level !== planLevel) return;
    const [x0, y0] = planPx(r.inner.x0, r.inner.z0);
    const [x1, y1] = planPx(r.inner.x1, r.inner.z1);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    // The room's name sits at its top edge; these go in the middle, one above the other when there's room.
    const both = overlays.has('mood') && overlays.has('map') && sel && y1 - y0 > 64;
    const fits = y1 - y0 > 40 ? x1 - x0 - 4 : 0;
    if (overlays.has('mood')) {
      const m = party.mood.room(i);
      if (m) {
        octx.fillStyle = `rgba(${MOOD_RGB[m.label]}, 0.16)`;
        octx.fillRect(x0, y0, x1 - x0, y1 - y0);
        if (both || !(overlays.has('map') && sel)) chip(m.label, cx, cy + (both ? 9 : 4), `rgb(${MOOD_RGB[m.label]})`, fits);
      }
    }
    if (overlays.has('map') && sel) {
      const k = party.familiarity(sel, i);
      // Rooms they couldn't find their way to go dark.
      octx.fillStyle = k < KNOWN ? 'rgba(0, 0, 0, 0.5)' : `rgba(120, 180, 255, ${0.06 + 0.22 * k})`;
      octx.fillRect(x0, y0, x1 - x0, y1 - y0);
      chip(`${Math.round(k * 100)}%`, cx, cy - (both ? 9 : -4), k < KNOWN ? '#9a9486' : '#bcd8ff', fits);
    }
  });

  // Sight: the field of view, the sharper cone for detail, and who is in view.
  if (overlays.has('sight') && sel) {
    const from = here(sel.id);
    const st = states[sel.id]!;
    if (from) {
      const face = party.senses.facing(sel);
      const wedge = (r: number, half: number, fill: string) => {
        octx.beginPath();
        octx.moveTo(from[0], from[1]);
        for (let a = -half; a <= half + 1e-6; a += half / 16) {
          const [x, y] = planPx(st.x + r * Math.sin(face + a), st.z + r * Math.cos(face + a));
          octx.lineTo(x, y);
        }
        octx.closePath();
        octx.fillStyle = fill;
        octx.fill();
        octx.strokeStyle = 'rgba(224, 181, 106, 0.55)';
        octx.lineWidth = 1;
        octx.stroke();
      };
      wedge(party.senses.range(sel.room), FOV, 'rgba(255, 236, 190, 0.16)');
      wedge(DETAIL_RANGE, DETAIL_FOV, 'rgba(255, 236, 190, 0.2)');
      // Solid: taken in on their last look. Dashed: in view, but their mind was elsewhere.
      const took = new Set(party.senses.seenLast[sel.id]);
      for (const q of party.people) {
        if (q === sel || !q.present) continue;
        const to = here(q.id);
        if (!to) continue;
        if (took.has(q.id)) line(from, to, 'rgba(224, 181, 106, 0.9)', 1.5);
        else if (party.senses.canSee(sel, q)) line(from, to, 'rgba(224, 181, 106, 0.45)', 1, [3, 4]);
      }
    }
  }

  // Sounds: a ring where each was made, fading, and a line to everyone who heard it.
  if (overlays.has('sound')) {
    for (const snd of party.senses.recent) {
      const age = (t - snd.t) / SOUND_FADE;
      if (age < 0 || age > 1 || snd.level !== planLevel) continue;
      const at = planPx(snd.x, snd.z);
      octx.strokeStyle = `rgba(143, 199, 229, ${1 - age})`;
      octx.lineWidth = 2;
      octx.beginPath();
      octx.arc(at[0], at[1], (0.6 + 5 * age) * pxPerM, 0, Math.PI * 2);
      octx.stroke();
      for (const i of snd.heard) {
        const to = here(i);
        if (to) line(at, to, `rgba(143, 199, 229, ${0.6 * (1 - age)})`, 1, [2, 3]);
      }
      chip(snd.kind.replace('-', ' '), at[0], at[1] - 14, `rgba(143, 199, 229, ${Math.max(0.4, 1 - age)})`);
    }
  }

  // Gossip: speaker to listeners, coloured by the kind of fact.
  if (overlays.has('gossip')) {
    for (let k = party.events.length - 1; k >= 0; k--) {
      const e = party.events[k]!;
      if (t - e.t > GOSSIP_FADE) break;
      if (e.kind !== 'gossip') continue;
      const from = here(e.actors[0]!);
      if (!from) continue;
      const color = KIND_COLOR[VERBS[e.note as Verb]?.kind ?? 'odd'];
      octx.globalAlpha = 1 - (t - e.t) / GOSSIP_FADE;
      for (const i of e.actors.slice(1)) {
        const to = here(i);
        if (to) line(from, to, color, 2);
      }
      chip((e.note ?? '').replace(/-/g, ' '), from[0], from[1] - 16, color);
      octx.globalAlpha = 1;
    }
  }

  // Cases: the picked person's (their rooms outlined, a line to each candidate with their share),
  // or, with nobody picked, how many hold an open case about each room.
  if (overlays.has('cases')) {
    const outline = (room: number, a: number) => {
      const r = bp.rooms[room];
      if (!r || r.level !== planLevel) return null;
      const [x0, y0] = planPx(r.inner.x0, r.inner.z0);
      const [x1, y1] = planPx(r.inner.x1, r.inner.z1);
      octx.fillStyle = `rgba(${CASE_RGB}, ${0.08 * a})`;
      octx.fillRect(x0, y0, x1 - x0, y1 - y0);
      octx.strokeStyle = `rgba(${CASE_RGB}, ${0.4 + 0.5 * a})`;
      octx.lineWidth = 2;
      octx.setLineDash([6, 4]);
      octx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      octx.setLineDash([]);
      return [(x0 + x1) / 2, (y0 + y1) / 2] as [number, number];
    };
    if (sel) {
      for (const c of party.register.casesOf(sel.id)) {
        if (c.state === 'closed' || c.room < 0) continue;
        const mid = outline(c.room, c.state === 'settled' ? 1 : 0.6);
        if (!mid) continue;
        chip(`${CASE_LABEL[c.kind]}${c.state === 'settled' ? ' · settled' : ''}`, mid[0], mid[1] + 20, `rgb(${CASE_RGB})`);
        for (const k of c.candidates) {
          const to = here(k.who);
          if (!to || k.p < 0.05) continue;
          line(mid, to, `rgba(${CASE_RGB}, ${0.35 + 0.65 * Math.min(1, k.p / CASES[c.kind].settle)})`, 1 + 3 * k.p, c.state === 'settled' ? undefined : [4, 3]);
          chip(pct(k.p), to[0], to[1] - 16, `rgb(${CASE_RGB})`);
        }
      }
    } else {
      const holders = new Map<number, number>();
      for (const q of party.people) for (const c of party.register.casesOf(q.id)) if (c.state !== 'closed' && c.room >= 0) holders.set(c.room, (holders.get(c.room) ?? 0) + 1);
      for (const [room, k] of holders) {
        const mid = outline(room, Math.min(1, k / 10));
        if (mid) chip(`${k} know`, mid[0], mid[1] + 20, `rgb(${CASE_RGB})`);
      }
    }
  }

  // Suspicion: how much the picked person suspects each other person, or, with nobody picked,
  // how suspected each person is on average by everyone there.
  if (overlays.has('suspicion')) {
    const present = party.people.filter((q) => q.present);
    for (const q of present) {
      if (q === sel) continue;
      const at = here(q.id);
      if (!at) continue;
      const v = sel ? party.suspects(sel.id, q.id) : party.memory.suspectedBy(q.id, present);
      if (v < 0.01) continue;
      const a = Math.min(1, v / SUSPICIOUS);
      const r = Math.max(7, 0.62 * (crowd?.markerScale ?? 1) * pxPerM);
      octx.strokeStyle = `rgba(212, 82, 74, ${0.35 + 0.65 * a})`;
      octx.lineWidth = 1 + 3 * a;
      octx.beginPath();
      octx.arc(at[0], at[1], r, 0, Math.PI * 2);
      octx.stroke();
      chip(`${Math.round(v * 100)}`, at[0], at[1] + r + 9, '#e98a80');
    }
  }
}

function buildOverlayButtons(): void {
  for (const o of OVERLAYS) {
    const b = document.createElement('button');
    b.textContent = o;
    b.classList.toggle('on', overlays.has(o));
    b.onclick = () => {
      if (overlays.has(o)) overlays.delete(o);
      else overlays.add(o);
      b.classList.toggle('on', overlays.has(o));
    };
    $('overlays').appendChild(b);
  }
}

// ------------------------------------------------------------------ panel

function buildTimeline(): void {
  const box = $('timeline');
  box.replaceChildren();
  for (const ph of party.programme) {
    const i = document.createElement('i');
    i.style.width = `${((ph.end - ph.start) / PARTY_LENGTH) * 100}%`;
    i.style.background = PHASE_COLOR[ph.id];
    i.title = `${ph.label} ${clockLabel(ph.start)}–${clockLabel(ph.end)}`;
    box.appendChild(i);
  }
  box.appendChild(document.createElement('b'));
}

let rows: { b: HTMLButtonElement; doing: HTMLElement }[] = [];

function buildPeople(): void {
  const box = $('people');
  box.replaceChildren();
  rows = party.people.map((p) => {
    const b = document.createElement('button');
    b.className = 'person';
    const dot = document.createElement('i');
    dot.style.background = p.look.color;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = p.name;
    if (ROLE_LABEL[p.role]) {
      const r = document.createElement('small');
      r.textContent = ` ${ROLE_LABEL[p.role]}`;
      who.appendChild(r);
    }
    const doing = document.createElement('span');
    doing.className = 'doing';
    b.append(dot, who, doing);
    b.onclick = () => select(p.id === selected ? -1 : p.id);
    box.appendChild(b);
    return { b, doing };
  });
}

/** Pick someone: the scope follows them, and the plan turns to their floor. */
function select(id: number): void {
  selected = id;
  follow = id >= 0;
  const p = party.people[id];
  if (p?.present && view === 'plan' && p.level !== planLevel) setPlanLevel(p.level);
  refreshPanel();
  rows[id]?.b.scrollIntoView({ block: 'nearest' });
}

function setPlanLevel(level: number): void {
  planLevel = level;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#floors button')) b.classList.toggle('on', Number(b.dataset.level) === level);
  setView('plan');
}

function describe(p: Person): string {
  if (p.gone) return 'gone home';
  if (!p.present) return `arrives ${clockLabel(p.arriveAt)}`;
  const a = p.action;
  if (!a) return 'standing about';
  const note = a.note ?? '';
  let s = NOTE_LABEL[note] ?? ACTION_LABEL[a.id];
  if (a.id === 'games' && note === 'piano') s = a.pose === 'play' ? 'playing the piano' : 'listening to the piano';
  if (a.id === 'toilet') s = note === 'queue' ? (p.pose === 'knock' ? 'knocking on the bathroom door' : 'queueing for the bathroom') : note === 'inside' && a.startedAt !== null ? 'in the bathroom' : 'to the bathroom';
  if (a.id === 'drink') s = note === 'bar-wait' ? 'waiting at the bar' : note === 'bar' ? 'having a drink at the bar' : 'to the bar';
  if (a.id === 'mingle' && p.pose === 'talk' && party.groups.get(a.ref ?? -1)?.speaker === p.id) s = 'talking';
  return (p.pose === 'walk' || p.pose === 'climb') && a.id !== 'leave' && !s.startsWith('to ') ? `→ ${s}` : s;
}

const DRINK_NAME: Partial<Record<Held, string>> = { champagne: 'champagne', red: 'red wine', white: 'white wine', beer: 'beer', whisky: 'whisky', water: 'water' };

/** What's in their hand, how full, and how much they've had. */
function inHand(p: Person): string {
  const parts: string[] = [];
  if (p.held && DRINKS.has(p.held)) {
    const fill = party.glassFill(p);
    parts.push(`${DRINK_NAME[p.held]}, ${fill > 0.75 ? 'full' : fill > 0.4 ? 'half full' : 'nearly finished'}`);
  } else if (p.held) parts.push(`holding ${p.held === 'tray' ? `a tray of ${party.body.trayCount(p)} ${DRINK_NAME[party.body.trayDrink(p) ?? 'champagne']}` : p.held}`);
  if (p.drinkLog.length) parts.push(`${p.drinkLog.length} drink${p.drinkLog.length > 1 ? 's' : ''} so far`);
  if (p.tipsy >= 0.05) parts.push(p.tipsy > 0.6 ? 'drunk' : p.tipsy > 0.3 ? 'tipsy' : 'merry');
  return parts.join(' · ');
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
/** Facts that name a second person. */
const PAIRED: ReadonlySet<Verb> = new Set(['flirting', 'couple', 'cheating', 'spill', 'slapped']);

function factText(f: number): string {
  const m = party.memory;
  const verb = m.verbOf(f);
  const subj = m.subject[f]!;
  const obj = m.object[f]!;
  const room = m.room[f]!;
  const where = room === -2 ? 'terrace' : room >= 0 ? bp.rooms[room]?.label.toLowerCase() : null;
  if (verb === 'gone') return `something of ${party.people[subj]?.name ?? 'the house'}'s gone${where ? ` · ${where}` : ''}`;
  if (verb === 'blamed') return `${party.people[subj]?.name ?? '?'} took it${where ? ` · ${where}` : ''}`;
  return [
    subj >= 0 ? `${party.people[subj]?.name ?? '?'}:` : null,
    verb.replace(/-/g, ' '),
    PAIRED.has(verb) && obj >= 0 ? `with ${party.people[obj]?.name ?? '?'}` : null,
    where ? `· ${where}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** What's on their mind: mood, the house as they know it, whom they doubt or suspect, what they know. */
function mindText(p: Person): string {
  if (!p.present && !p.gone) return '';
  const m = party.memory;
  const name = (i: number) => party.people[i]?.name ?? '?';
  const lines: string[] = [];
  let known = 0;
  for (let r = 0; r < bp.rooms.length; r++) if (party.familiarity(p, r) >= KNOWN) known++;
  lines.push(`energy ${pct(party.energy(p))} · tension ${pct(party.tension(p))}`);
  const tie = party.memory.household[p.id] ? 'lives here' : p.staff ? 'works here' : p.regular ? 'been here before' : 'first time here';
  lines.push(`${tie} · knows ${known} of ${bp.rooms.length} rooms`);
  const top = (f: (q: Person) => number, min: number, k: number) =>
    party.people
      .filter((q) => q !== p)
      .map((q) => [q.id, f(q)] as const)
      .filter(([, v]) => v >= min)
      .sort((a, b) => b[1] - a[1])
      .slice(0, k);
  const doubts = top((q) => party.ident.doubtOf(p.id, q.id, party.t), 0.05, 3);
  if (doubts.length) lines.push(`not sure it's really ${doubts.map(([i, v]) => `${name(i)} ${pct(v)}`).join(', ')}`);
  const sus = top((q) => party.suspects(p.id, q.id), 0.005, 5);
  lines.push(sus.length ? `suspects ${sus.map(([i, v]) => `${name(i)} ${pct(v)}`).join(', ')}` : 'suspects nobody');
  const facts: Array<{ f: number; c: number; from: number }> = [];
  for (let sl = p.id * SLOTS; sl < p.id * SLOTS + m.held[p.id]!; sl++) {
    const c = m.confAt(p.id, sl);
    if (c >= 0.05) facts.push({ f: m.sFact[sl]!, c, from: m.sFrom[sl]! });
  }
  facts.sort((a, b) => b.c - a.c);
  lines.push(facts.length ? `knows ${facts.length} thing${facts.length > 1 ? 's' : ''}:` : 'knows nothing worth telling');
  for (const x of facts.slice(0, 6)) lines.push(`  ${factText(x.f)} (${x.from < 0 ? 'saw it' : `from ${name(x.from)}`}, ${pct(x.c)})`);
  // Connecting the dots: open cases first, each with its room, window and who it points at.
  const reg = party.register;
  const cases = reg.casesOf(p.id).filter((c) => c.state !== 'closed');
  const entries = reg.entriesOf(p.id);
  const claims = entries.filter((e) => e.claim).length;
  lines.push(`register: ${entries.length - claims} sightings · ${claims} claims${cases.length ? ' · cases:' : ''}`);
  for (const c of cases.slice(0, 4)) {
    const where = c.room === -2 ? 'terrace' : c.room >= 0 ? bp.rooms[c.room]?.label.toLowerCase() : null;
    const what = c.kind === 'gone' && c.subject >= 0 ? `something of ${name(c.subject)}'s gone` : `${CASE_LABEL[c.kind]}${c.subject >= 0 && c.kind !== 'noise' ? `: ${name(c.subject)}` : ''}`;
    const span = c.room >= 0 || c.room === -2 ? ` · ${clockLabel(c.from)}–${clockLabel(c.to)}` : '';
    const who = c.candidates.filter((k) => k.p >= 0.05).slice(0, 3);
    lines.push(`  ${what}${where ? ` · ${where}` : ''}${span}${c.state === 'settled' ? ' · settled' : ''}${c.firstHand ? ' (saw it)' : c.teller >= 0 ? ` (from ${name(c.teller)})` : ''}`);
    lines.push(`    ${who.length ? who.map((k) => `${name(k.who)} ${pct(k.p)}`).join(', ') : 'nobody in mind yet'}`);
  }
  return lines.join('\n');
}

function roomName(p: Person): string {
  if (p.room === -2) return 'terrace';
  const r = bp.rooms[p.room];
  return r ? r.label : 'outside';
}

type Kinds = ReadonlySet<PartyEvent['kind']>;
/** The event log's filters. */
const LOG_FILTERS: Record<string, Kinds> = {
  'the evening': new Set(['phase', 'arrive', 'leave', 'toast', 'bathroom-taken', 'knock', 'bump', 'double-take', 'test', 'gossip', 'wrong-turn', 'hush', 'ask', 'heard', 'case', 'blame', 'tell', 'conflict']),
  gossip: new Set(['gossip']),
  'connecting the dots': new Set(['case', 'ask-around', 'lead', 'blame', 'tell', 'conflict', 'recognised']),
  noticing: new Set(['double-take', 'test', 'hush', 'heard']),
  'finding the way': new Set(['wrong-turn', 'ask']),
  'the house': new Set(['bathroom-taken', 'knock', 'bump', 'light']),
  programme: new Set(['phase', 'announce', 'arrive', 'leave', 'toast']),
};
let logFilter = params.get('log') ?? 'the evening';
if (!LOG_FILTERS[logFilter]) logFilter = 'the evening';

/** " in the study", for an event that names a room. */
function roomOf(e: PartyEvent): string {
  if (e.room === undefined || e.room === -1) return '';
  return e.room === -2 ? ' on the terrace' : ` in the ${bp.rooms[e.room]?.label.toLowerCase() ?? 'room'}`;
}

function eventText(e: PartyEvent): string {
  const n = (i: number | undefined) => (i !== undefined ? (party.people[i]?.name ?? '?') : '?');
  switch (e.kind) {
    case 'phase':
      return `— ${e.note} —`;
    case 'arrive':
      return `${n(e.actors[0])} arrives`;
    case 'leave':
      return `${n(e.actors[0])} leaves`;
    case 'toast':
      return `${n(e.actors[0])} raises a glass`;
    case 'bathroom-taken':
      return `${n(e.actors[0])} finds the bathroom taken`;
    case 'knock':
      return `${n(e.actors[0])} knocks on the bathroom door`;
    case 'bump':
      return `${n(e.actors[0])} bumps into ${n(e.actors[1])}${e.note === 'slop' ? ', drink slops' : ''}`;
    case 'announce':
      return `${n(e.actors[0])} announces ${e.note?.toLowerCase() ?? ''}`;
    case 'light':
      return `lights ${e.note} in the ${e.room !== undefined ? (bp.rooms[e.room]?.label.toLowerCase() ?? 'room') : 'room'}`;
    case 'double-take':
      return `${n(e.actors[0])} looks twice at ${n(e.actors[1])}`;
    case 'test':
      return `${n(e.actors[0])} tries a shared joke on ${n(e.actors[1])}: it's them`;
    case 'gossip': {
      const to = e.actors.length > 2 ? `${n(e.actors[1])} and ${e.actors.length - 2} more` : n(e.actors[1]);
      return `${n(e.actors[0])} tells ${to}: ${(e.note ?? '').replace(/-/g, ' ')}`;
    }
    case 'wrong-turn':
      return `${n(e.actors[0])} takes a wrong turn${e.note === 'door' ? ' and tries a locked door' : ''}`;
    case 'hush':
      return `talk stops as ${n(e.actors[0])} joins`;
    case 'ask':
      return `${n(e.actors[0])} asks ${n(e.actors[1])} the way${e.note === 'shrug' ? ", who doesn't know" : ''}`;
    case 'heard':
      return `${n(e.actors[0])} hears a ${(e.note ?? 'noise').replace('-', ' ')} and goes to look`;
    case 'case':
      return `${n(e.actors[0])} notices ${e.note === 'gone' ? `something of ${e.actors[1] === e.actors[0] ? 'theirs' : `${n(e.actors[1])}'s`} gone` : CASE_LABEL[e.note as CaseKind] ?? e.note}${roomOf(e)}`;
    case 'ask-around':
      return `${n(e.actors[0])} asks round about ${CASE_LABEL[e.note as CaseKind] ?? e.note}${e.actors.length > 1 ? `: ${e.actors.slice(1).map(n).join(', ')} saw something` : ', nobody saw anything'}`;
    case 'lead':
      return `${n(e.actors[0])} says it points at ${n(e.actors[1])}`;
    case 'blame':
      return `${n(e.actors[0])} puts it together: ${n(e.actors[1])}${e.note === 'gone' ? ' took it' : ''}${roomOf(e)}`;
    case 'tell':
      return `${n(e.actors[0])} tells ${n(e.actors[1])} what they worked out`;
    case 'conflict':
      return e.note === 'claim' ? `${n(e.actors[0])} catches ${n(e.actors[1])} out: not where they said` : e.note === 'not-themselves' ? `${n(e.actors[0])}: ${n(e.actors[1])} seen in two places at once?` : `${n(e.actors[0])} hears ${n(e.actors[1])} was somewhere they can't have been`;
    case 'recognised':
      return `${n(e.actors[0])} realises who they saw: ${n(e.actors[1])}`;
    default:
      return e.kind;
  }
}

let lastPanel = 0;

function refreshPanel(): void {
  const t = party.t + acc;
  $('time').textContent = clockLabel(t);
  const ph = party.programme[phaseIndexAt(party.programme, t)]!;
  $('phase').textContent = party.over ? 'Over' : ph.label;
  const guests = party.people.filter((p) => !p.staff && p.role !== 'host');
  const inside = guests.filter((p) => p.present).length;
  $('count').textContent = `${inside}/${guests.length} in`;
  const cur = $('timeline').querySelector('b');
  if (cur) cur.style.left = `${(t / PARTY_LENGTH) * 100}%`;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#speeds button[data-speed]')) b.classList.toggle('on', Number(b.dataset.speed) === speed);

  // The latest few events worth reading.
  const lines: string[] = [];
  const kinds = LOG_FILTERS[logFilter]!;
  for (let i = party.events.length - 1; i >= 0 && lines.length < 7; i--) {
    const e = party.events[i]!;
    // Bumps are many; only one that slops a drink is worth a line.
    if (kinds.has(e.kind) && (e.kind !== 'bump' || e.note === 'slop')) lines.push(`${clockLabel(e.t)}  ${eventText(e)}`);
  }
  $('events').textContent = lines.join('\n');

  const count = (f: (p: Person) => boolean) => guests.filter((p) => p.present && f(p)).length;
  const st = party.stats;
  const talking = [...party.groups.values()].filter((g) => g.members.length > 1).length;
  $('stats').textContent = [
    `${talking} conversations · ${count((p) => p.pose === 'dance')} dancing · ${count((p) => p.pose === 'sit')} seated · ${count((p) => p.pose === 'walk' || p.pose === 'climb')} walking`,
    `${party.body.stats.taken} found a bathroom taken · ${party.body.stats.knocks} knocks · ${party.body.stats.bumps} bumps`,
    `${st.told} things told · ${st.overheard} overheard · ${st.doubleTakes} double takes · ${st.tests} tests · ${st.hushes} hushes`,
    `${st.wrongTurns} wrong turns · ${st.asks} asked the way · ${st.heard} went to see a noise${planted.length ? ` · ${planted.length} planted` : ''}`,
    `${st.cases} cases · ${st.askedAround} asked round · ${st.blames} settled on someone · ${st.conflicts} didn't fit · ${st.recognised} faces put a name to · ${st.claims} said where they'd been`,
    `${bp.style.name} · ${bp.levels.length} storeys · perch ${bp.site.perch.distance} m · coats: ${party.places.chains.coats.link} · whisky: ${party.places.chains.spirits.link}`,
    // With profile in the URL: ms spent in each stage of the step so far.
    party.profile ? `ms ${Object.entries(party.profile).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  party.people.forEach((p, i) => {
    const r = rows[i];
    if (!r) return;
    r.doing.textContent = describe(p);
    r.b.classList.toggle('away', !p.present);
    r.b.classList.toggle('sel', i === selected);
  });

  const card = $('detail');
  const p = party.people[selected];
  card.classList.toggle('on', !!p);
  $('follow').classList.toggle('on', follow);
  if (!p) return;
  card.querySelector('.name')!.textContent = p.name;
  const partner = p.partner !== null ? party.people[p.partner]?.name : null;
  card.querySelector('.meta')!.textContent = [
    [ROLE_LABEL[p.role] || 'guest', p.look.outfit.replace('-', ' '), `${p.look.height.toFixed(2)} m`].join(' · '),
    p.quirks.length ? p.quirks.join(', ').replace(/-/g, ' ') : 'no habits',
    partner ? `with ${partner}` : 'came alone',
    describe(p),
    inHand(p),
    p.present ? `${roomName(p)} · ${LEVEL_NAMES[p.level] ?? p.level} floor · ${Math.round(party.visibility(p) * 100)}% in view of the perch` : '',
  ]
    .filter(Boolean)
    .join('\n');
  card.querySelector('.mind')!.textContent = mindText(p);
  const needs = $('needs');
  needs.replaceChildren();
  if (!p.staff) {
    for (const id of NEED_IDS) {
      const label = document.createElement('span');
      label.textContent = id;
      const bar = document.createElement('div');
      const fill = document.createElement('i');
      fill.style.width = `${Math.round(p.needs[id] * 100)}%`;
      bar.appendChild(fill);
      needs.append(label, bar);
    }
  }
}

// ------------------------------------------------------------------ input

for (const s of SPEEDS) {
  const b = document.createElement('button');
  b.textContent = s ? `${s}×` : '❚❚';
  b.title = s ? `${s}× (1× plays the evening in one hour)` : 'pause';
  b.dataset.speed = String(s);
  b.onclick = () => {
    speed = s;
    refreshPanel();
  };
  $('speeds').appendChild(b);
}
{
  const restart = document.createElement('button');
  restart.textContent = '⏮';
  restart.title = 'back to 19:00';
  restart.onclick = () => seekSoon(0);
  const next = document.createElement('button');
  next.textContent = 'next ›';
  next.title = 'skip to the next part of the programme';
  next.onclick = () => {
    const t = party.t;
    const ph = party.programme.find((p) => p.start > t + 1);
    seekSoon(ph ? ph.start + 1 : PARTY_LENGTH);
  };
  $('speeds').append(restart, next);
}
for (const v of ['scope', 'wide', 'plan', 'orbit'] as View[]) {
  const b = document.createElement('button');
  b.textContent = v;
  b.dataset.v = v;
  b.onclick = () => setView(v);
  $('views').appendChild(b);
}
$('timeline').addEventListener('click', (e) => {
  const r = $('timeline').getBoundingClientRect();
  seekSoon(((e.clientX - r.left) / r.width) * PARTY_LENGTH);
});
$('go').onclick = build;
$('rnd').onclick = () => {
  seedInput.value = Math.random().toString(36).slice(2, 8);
  build();
};
seedInput.onkeydown = (e) => e.key === 'Enter' && build();
$('follow').onclick = () => {
  follow = !follow;
  if (follow && view !== 'scope' && view !== 'wide') setView('scope');
  refreshPanel();
};
$('unsel').onclick = () => select(-1);
buildOverlayButtons();
{
  const sel = $('evfilter') as HTMLSelectElement;
  for (const k of Object.keys(LOG_FILTERS)) sel.add(new Option(k, k, k === logFilter, k === logFilter));
  sel.onchange = () => {
    logFilter = sel.value;
    refreshPanel();
  };
}
// Lab provocations go in at the current time and are kept, so a seek back replays them.
const provoke = (v: Provocation) => {
  planted.push(v);
  party.plant(v);
  refreshPanel();
};
$('rumour').onclick = () => {
  if (party.people[selected]) provoke({ t: party.t, subject: selected });
};
$('gone').onclick = () => {
  const p = party.people[selected];
  if (!p?.present || p.room === -1) return;
  goneRoom = p.room;
  provoke({ t: party.t, kind: 'gone', subject: -1, witness: p.id, room: p.room });
};
$('seen').onclick = () => {
  const p = party.people[selected];
  if (!p?.present) return;
  provoke({ t: party.t, kind: 'seen', subject: p.id, room: goneRoom !== -1 ? goneRoom : p.room });
};
{
  const who = document.createElement('select');
  who.title = "Whose mood: everyone, whoever is in the picked person's room, or just them";
  for (const [v, label] of [
    ['all', 'everyone'],
    ['room', 'their room'],
    ['person', 'them'],
  ]) who.add(new Option(label, v));
  const nudge = (label: string, title: string, o: { tension?: number; energy?: number }) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.onclick = () => {
      const p = party.people[selected];
      const target: MoodOverride['target'] = who.value === 'person' && p ? { person: p.id } : who.value === 'room' && p?.present ? { room: p.room } : 'all';
      const n: MoodOverride = { t: party.t, target, ...o };
      nudges.push(n);
      party.nudge(n);
      refreshPanel();
    };
    return b;
  };
  $('mood').append(
    who,
    nudge('tense', 'Set tension to 60%', { tension: 0.6 }),
    nudge('calm', 'Set tension to 0', { tension: 0 }),
    nudge('liven', 'Energy × 1.5', { energy: 1.5 }),
    nudge('dampen', 'Energy × 0.5', { energy: 0.5 }),
  );
}
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === ' ') {
    e.preventDefault();
    speed = speed ? 0 : 1;
    refreshPanel();
  }
});

/** Pick the person nearest a click on screen. */
function pick(cx: number, cy: number): void {
  let best = -1;
  let bd = 28;
  const states = frameStates();
  party.people.forEach((p, i) => {
    const s = states[i]!;
    if (!s.visible || (view === 'plan' && p.level !== planLevel)) return;
    const at = toScreen(s.x, s.y + (view === 'plan' ? 2.2 : 1.1), s.z);
    if (!at) return;
    const d = Math.hypot(at.x - cx, at.y - cy);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  if (best >= 0) select(best);
}

let down: { x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && e.target === renderer.domElement) pick(e.clientX, e.clientY);
  down = null;
});
addEventListener('pointermove', (e) => {
  if (!down || !built) return;
  if (view === 'plan') {
    const mPerPx = (2 * planFrame().half) / viewSize().h;
    planPan.x -= e.movementX * mPerPx;
    planPan.z -= e.movementY * mPerPx;
    clampPlanPan();
    setView('plan');
  } else if (view === 'scope' || view === 'wide') {
    // Taking the scope by hand stops following.
    follow = false;
    const k = (camera.fov / 60) * 0.004;
    aim.yaw -= e.movementX * k;
    aim.pitch = Math.max(-0.4, Math.min(0.4, aim.pitch - e.movementY * k));
    aimCamera();
  }
});
function clampPlanPan(): void {
  const fp = bp.stats.footprint;
  const rx = (fp.x1 - fp.x0) / 2 + 10;
  const rz = (fp.z1 - fp.z0) / 2 + 10;
  planPan.x = Math.max(-rx, Math.min(rx, planPan.x));
  planPan.z = Math.max(-rz, Math.min(rz, planPan.z));
}
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    if (!built) return;
    if (view === 'scope') {
      aim.fov = Math.max(built.perch.fovMin, Math.min(built.perch.fovMax, aim.fov * Math.exp(e.deltaY * 0.001)));
      camera.fov = aim.fov;
      camera.updateProjectionMatrix();
      return;
    }
    if (view !== 'plan') return;
    e.preventDefault();
    // Zoom about the cursor.
    const before = planFrame();
    const r = renderer.domElement.getBoundingClientRect();
    const u = ((e.clientX - r.left) / r.width - 0.5) * 2 * (r.width / r.height);
    const v = ((e.clientY - r.top) / r.height - 0.5) * 2;
    const wx = before.x + u * before.half;
    const wz = before.z + v * before.half;
    planZoom = Math.max(1, Math.min(PLAN_ZOOM_MAX, planZoom * Math.exp(-e.deltaY * 0.0015)));
    const after = planFrame();
    planPan.x += wx - (after.x + u * after.half);
    planPan.z += wz - (after.z + v * after.half);
    if (planZoom === 1) planPan.x = planPan.z = 0;
    clampPlanPan();
    setView('plan');
  },
  { passive: false },
);
renderer.domElement.addEventListener('dblclick', () => {
  if (view !== 'plan') return;
  planZoom = 1;
  planPan.x = planPan.z = 0;
  setView('plan');
});
addEventListener('resize', () => {
  if (shot) return;
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  setView(view);
});

// ------------------------------------------------------------------ run

build();
if (params.has('t')) seek(parseTime(params.get('t')));
if (params.has('zoom') && params.has('px')) {
  planPan.x = Number(params.get('px'));
  planPan.z = Number(params.get('pz') ?? 0);
  setView(view);
}
refreshPanel();

let frames = 0;
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (!shot && speed > 0 && !party.over) {
    acc += dt * TIME_SCALE * speed;
    // Catch up in fixed steps; drop the backlog if the machine can't keep up.
    for (let n = 0; acc >= STEP && n < 1200 && !party.over; n++) {
      snapshot();
      party.step();
      acc -= STEP;
    }
    if (acc >= STEP || party.over) acc = 0;
  }
  animClock = shot ? party.t / TIME_SCALE : animClock + dt * Math.min(speed, 4);
  if (view === 'orbit') controls.update();
  draw();
  composer.render();
  if (now - lastPanel > 250) {
    lastPanel = now;
    refreshPanel();
  }
  frames++;
  if (shot && frames === Number(params.get('frames') ?? 2)) {
    refreshPanel();
    (window as unknown as { __ready: boolean }).__ready = true;
    return;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
(window as unknown as { __stats: () => unknown }).__stats = () => ({ t: clockLabel(party.t), phase: party.phase.id, present: party.people.filter((p) => p.present).length });
(window as unknown as { __party: () => Party }).__party = () => party;
