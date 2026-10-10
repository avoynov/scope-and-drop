/**
 * Party lab: one evening at a generated mansion, watched from the perch or from above.
 *
 *   /party/?seed=gala-night&t=90&speed=5&view=plan&sel=4&follow=1
 *
 * t is minutes after 19:00 (or a clock time such as 20:30); speed multiplies the
 * game's own pace, where 1× plays the three-hour party in one real hour.
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
import { clockLabel, Party, PARTY_LENGTH, PARTY_START, phaseIndexAt, STEP, TIME_SCALE, type PhaseId } from '../../src/party';
import { Crowd, type FrameState } from '../../src/party/render/crowd';
import { NEED_IDS, type ActionId, type PartyEvent, type Person, type RoleId } from '../../src/party/types';
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
  billiards: 'playing billiards',
  cards: 'playing cards',
  cinema: 'watching a film',
};

let bp: MansionBlueprint;
let built: BuiltMansion | null = null;
let party: Party;
let crowd: Crowd | null = null;
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

// ------------------------------------------------------------------ setup

function build(): void {
  const seed = seedInput.value.trim() || 'gala-night';
  bp = generateMansion({ seed, size: (params.get('size') as MansionOptions['size']) ?? undefined });
  if (built) {
    scene.remove(built.root);
    built.dispose();
  }
  built = buildMansion(bp, { renderer, quality: (params.get('quality') as Quality) ?? 'high' });
  scene.add(built.root);
  planLevel = Math.min(planLevel, bp.levels.length - 1);
  planPan.x = planPan.z = 0;
  aim = { yaw: 0, pitch: 0, fov: aim.fov };
  buildFloorButtons();
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
  party = new Party(bp, { seed: params.get('party') ?? bp.seed, guests: params.has('guests') ? Number(params.get('guests')) : undefined });
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

function draw(): void {
  const states = frameStates();
  const sel = party.people[selected];
  const s = sel ? states[selected] : undefined;
  if (follow && s?.visible && (view === 'scope' || view === 'wide')) aimAt(s.x, s.y + 1.2, s.z);
  if (crowd) {
    crowd.selected = selected;
    crowd.update(states, animClock);
  }
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
  const note = a.note?.split('|')[0] ?? '';
  let s = NOTE_LABEL[note] ?? ACTION_LABEL[a.id];
  if (a.id === 'games' && note === 'piano') s = a.pose === 'play' ? 'playing the piano' : 'listening to the piano';
  if (a.id === 'toilet' && note === 'door') s = 'to the bathroom';
  if (a.id === 'mingle' && p.pose === 'talk' && party.groups.get(a.ref ?? -1)?.speaker === p.id) s = 'talking';
  return a.startedAt === null && note !== 'queue' && a.id !== 'leave' ? `→ ${s}` : s;
}

function roomName(p: Person): string {
  if (p.room === -2) return 'terrace';
  const r = bp.rooms[p.room];
  return r ? r.label : 'outside';
}

const EVENT_KINDS: ReadonlySet<PartyEvent['kind']> = new Set(['phase', 'arrive', 'leave', 'toast', 'bathroom-busy']);

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
    case 'bathroom-busy':
      return `${n(e.actors[0])} finds the bathroom taken`;
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
  for (let i = party.events.length - 1; i >= 0 && lines.length < 7; i--) {
    const e = party.events[i]!;
    if (EVENT_KINDS.has(e.kind)) lines.push(`${clockLabel(e.t)}  ${eventText(e)}`);
  }
  $('events').textContent = lines.join('\n');

  const count = (f: (p: Person) => boolean) => guests.filter((p) => p.present && f(p)).length;
  const talking = [...party.groups.values()].filter((g) => g.members.length > 1).length;
  $('stats').textContent = [
    `${talking} conversations · ${count((p) => p.pose === 'dance')} dancing · ${count((p) => p.pose === 'sit')} seated · ${count((p) => p.pose === 'walk' || p.pose === 'climb')} walking`,
    `${bp.style.name} · ${bp.levels.length} storeys · perch ${bp.site.perch.distance} m`,
  ].join('\n');

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
    `${describe(p)}${p.held ? ` · holding ${p.held}` : ''}${p.drinks ? ` · ${p.drinks} drink${p.drinks > 1 ? 's' : ''}` : ''}`,
    p.present ? `${roomName(p)} · ${LEVEL_NAMES[p.level] ?? p.level} floor · ${Math.round(party.visibility(p) * 100)}% in view of the perch` : '',
  ]
    .filter(Boolean)
    .join('\n');
  (card.querySelector('.meta') as HTMLElement).style.whiteSpace = 'pre-wrap';
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
