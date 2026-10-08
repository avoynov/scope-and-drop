/** Published viewer: same generator and renderer as the repo, with a field-dossier UI. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { generateMansion, POI_VISIBLE, type MansionBlueprint, type MansionOptions, type PoiType } from '../src/mansion';
import { buildMansion, type BuiltMansion } from '../src/mansion/build';
import { createGradePass } from '../src/mansion/build/grade';

type View = 'scope' | 'wide' | 'estate' | 'iso' | 'plan';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $('stage');
const small = Math.min(innerWidth, innerHeight) < 560;
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(8, 1, 0.5, 9000);
const ortho = new THREE.OrthographicCamera(-50, 50, 30, -30, 1, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;

const size = () => new THREE.Vector2(stage.clientWidth * renderer.getPixelRatio(), stage.clientHeight * renderer.getPixelRatio());
const rt = new THREE.WebGLRenderTarget(size().x, size().y, { type: THREE.HalfFloatType, samples: small ? 0 : 4 });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(stage.clientWidth, stage.clientHeight), 0.55, 0.55, 1.4));
composer.addPass(createGradePass());
composer.addPass(new OutputPass());

let bp: MansionBlueprint | null = null;
let built: BuiltMansion | null = null;
let view: View = 'scope';
const aim = { yaw: 0, pitch: 0, fov: 8 };
const overlays = { sight: false, missions: false };
const overlayGroup = new THREE.Group();
scene.add(overlayGroup);

/* ---------------- UI ---------------- */

const VIEWS: [View, string][] = [
  ['scope', 'Scope'],
  ['wide', 'Perch'],
  ['estate', 'Estate'],
  ['iso', 'Isometric'],
  ['plan', 'Plan'],
];
const bar = $('bar');
for (const [v, label] of VIEWS) {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.v = v;
  b.onclick = () => setView(v);
  bar.appendChild(b);
}
const sep = document.createElement('span');
sep.className = 'sep';
bar.appendChild(sep);
for (const [k, label] of [
  ['sight', 'Sightlines'],
  ['missions', 'Missions'],
] as const) {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = 'toggle';
  b.onclick = () => {
    overlays[k] = !overlays[k];
    b.classList.toggle('on', overlays[k]);
    applyOverlays();
  };
  bar.appendChild(b);
}

// Mil-dots along the reticle arms (every 10 units of the 200-unit field).
const mils = $('mils');
for (let i = -5; i <= 5; i++) {
  if (i === 0) continue;
  for (const [x, y] of [
    [i * 10, 0],
    [0, i * 10],
  ] as const) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', String(x));
    c.setAttribute('cy', String(y));
    c.setAttribute('r', '1.1');
    mils.appendChild(c);
  }
}

const dossier = $('dossier');
const fold = $<HTMLButtonElement>('fold');
const setFold = (f: boolean) => {
  dossier.classList.toggle('folded', f);
  fold.textContent = f ? '+' : '–';
  fold.setAttribute('aria-expanded', String(!f));
  fold.setAttribute('aria-label', f ? 'Expand dossier' : 'Collapse dossier');
};
fold.onclick = () => setFold(!dossier.classList.contains('folded'));
if (small) setFold(true);

const seedInput = $<HTMLInputElement>('seed');
const styleSel = $<HTMLSelectElement>('style');
const massSel = $<HTMLSelectElement>('massing');
const sizeSel = $<HTMLSelectElement>('size');
$('survey').onclick = () => survey();
$('random').onclick = () => {
  const words = ['gala', 'vesper', 'orchid', 'ambassador', 'crescent', 'ledger', 'marquis', 'nocturne', 'silk', 'harrier', 'vauxhall', 'cypress'];
  seedInput.value = `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
  survey();
};
seedInput.addEventListener('keydown', (e) => e.key === 'Enter' && survey());

const STYLE_NAMES: Record<string, string> = { palladian: 'Palladian', georgian: 'Georgian', beauxarts: 'Beaux-Arts' };
const PLAN_NAMES: Record<string, string> = { block: 'Block', 'u-garden': 'U, garden court', 'u-entrance': 'U, entrance court', h: 'H-plan' };
const POI_NAMES: Partial<Record<PoiType, string>> = { bar: 'Bar', statue: 'Statues', painting: 'Paintings', bookshelf: 'Bookshelves', piano: 'Piano', fireplace: 'Fireplaces', ledger: 'Guest ledger', clock: 'Clocks', safe: 'Safe', globe: 'Globe', window: 'Window spots' };

function renderDossier(genMs: number): void {
  if (!bp || !built) return;
  const v = bp.validation;
  const party = bp.rooms.filter((r) => r.level === 0 && r.role === 'party');
  const blind = bp.rooms.filter((r) => r.level === 0 && (r.role === 'party' || r.role === 'circulation') && (bp!.sightlines.rooms[r.id] ?? 0) < 0.05);
  const rows: [string, string][] = [
    ['Status', ''],
    ['Style', bp.style.name],
    ['Plan', `${PLAN_NAMES[bp.massing]} · ${bp.bays} bays of ${bp.bay.toFixed(1)} m`],
    ['Storeys', `${bp.levels.length}, piano nobile at +${bp.groundFloorY.toFixed(2)} m`],
    ['Rooms', `${bp.rooms.length} (${party.length} for the party)`],
    ['Perch', `${bp.site.perch.distance.toFixed(0)} m, bearing ${bp.site.perch.azimuthDeg > 0 ? '+' : ''}${bp.site.perch.azimuthDeg.toFixed(0)}°`],
    ['Party in view', `${Math.round(bp.sightlines.partyVisible * 100)}%`],
    ['Blind spots', blind.length ? blind.map((r) => r.label).slice(0, 3).join(', ') + (blind.length > 3 ? ` +${blind.length - 3}` : '') : 'none'],
    ['Built in', `${Math.round(genMs)} ms + ${built.stats.buildMs} ms`],
  ];
  const facts = $('facts');
  facts.replaceChildren();
  for (const [k, val] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    if (k === 'Status') {
      const s = document.createElement('span');
      s.className = `status${v.ok ? '' : ' bad'}`;
      s.textContent = v.ok ? `Valid · attempt ${bp.attempt + 1}` : 'Invalid';
      dd.appendChild(s);
    } else dd.textContent = val;
    facts.append(dt, dd);
  }
  const missions = $('missions');
  missions.replaceChildren();
  const counts = new Map<PoiType, [number, number]>();
  for (const p of bp.pois) {
    const c = counts.get(p.type) ?? [0, 0];
    c[0]++;
    if (p.visibility >= POI_VISIBLE) c[1]++;
    counts.set(p.type, c);
  }
  for (const [type, [all, vis]] of [...counts.entries()].sort((a, b) => b[1][1] - a[1][1])) {
    const c = document.createElement('span');
    c.className = 'chip';
    c.title = `${vis} of ${all} visible from the perch`;
    c.innerHTML = `${POI_NAMES[type] ?? type} <b>${vis}/${all}</b>`;
    missions.appendChild(c);
  }
  $('title').textContent = `${STYLE_NAMES[bp.style.id] ?? ''} house, ${bp.seed}`;
}

/* ---------------- Build ---------------- */

const veil = $('veil');
function survey(): void {
  veil.classList.remove('gone');
  $('veil-title').textContent = 'Surveying the grounds';
  $('veil-sub').textContent = `seed ${seedInput.value || 'gala-night'}`;
  // Let the veil paint before the (synchronous) generation and build.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      buildNow();
      $('error').hidden = true;
    } catch (e) {
      $('error').hidden = false;
      $('error').textContent = `Could not build this estate: ${(e as Error).message}`;
    }
    veil.classList.add('gone');
  }));
}

function buildNow(): void {
  const t0 = performance.now();
  const opts: MansionOptions = {
    seed: seedInput.value.trim() || 'gala-night',
    style: (styleSel.value || undefined) as MansionOptions['style'],
    massing: (massSel.value || undefined) as MansionOptions['massing'],
    size: sizeSel.value as MansionOptions['size'],
  };
  bp = generateMansion(opts);
  const genMs = performance.now() - t0;
  if (built) {
    scene.remove(built.root);
    built.dispose();
  }
  built = buildMansion(bp, { renderer, quality: small ? 'low' : 'medium' });
  scene.add(built.root);
  buildOverlays();
  aim.yaw = 0;
  aim.pitch = 0;
  aim.fov = 8;
  setView(view);
  renderDossier(genMs);
}

function buildOverlays(): void {
  overlayGroup.clear();
  if (!bp) return;
  const n = bp.nav.levels[0]!;
  const data = new Uint8Array(n.cols * n.rows * 4);
  for (let k = 0; k < n.walk.length; k++) {
    if (!n.walk[k]) continue;
    const v = n.vis[k]! / 255;
    data[k * 4] = Math.round(240 * (1 - v) + 40 * v);
    data[k * 4 + 1] = Math.round(70 * (1 - v) + 210 * v);
    data[k * 4 + 2] = Math.round(70 * (1 - v) + 140 * v);
    data[k * 4 + 3] = 165;
  }
  const tex = new THREE.DataTexture(data, n.cols, n.rows);
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const w = n.cols * n.cell;
  const d = n.rows * n.cell;
  const geo = new THREE.PlaneGeometry(w, d);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const plane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(n.originX + w / 2, n.y + 0.06, n.originZ + d / 2);
  plane.renderOrder = 5;
  plane.name = 'sight';
  overlayGroup.add(plane);
  const colors: Partial<Record<PoiType, string>> = { statue: '#f2efe8', bar: '#ff7a45', bookshelf: '#c99a5b', painting: '#e3c15a', piano: '#a38bff', fireplace: '#ff5040', ledger: '#55c8ff', clock: '#6fe08e', window: '#9edcff', safe: '#bbbbbb', globe: '#5ab8b0' };
  const g = new THREE.SphereGeometry(0.32, 12, 8);
  for (const p of bp.pois) {
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colors[p.type] ?? '#ffffff', fog: false, toneMapped: false, depthTest: false }));
    m.position.set(p.stand.x, (bp.levels[p.level]?.floorY ?? 0) + 1.7, p.stand.z);
    m.name = 'poi';
    m.renderOrder = 6;
    overlayGroup.add(m);
  }
  const e = bp.site.perch.eye;
  const sniper = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.4, 16), new THREE.MeshBasicMaterial({ color: '#ff4848', fog: false, toneMapped: false }));
  sniper.position.set(e.x, e.y + 2.2, e.z);
  sniper.rotation.x = Math.PI;
  sniper.name = 'sniper';
  overlayGroup.add(sniper);
  applyOverlays();
}

function applyOverlays(): void {
  for (const c of overlayGroup.children) {
    if (c.name === 'sight') c.visible = overlays.sight;
    else if (c.name === 'poi') c.visible = overlays.missions && view !== 'scope' && view !== 'wide';
    else if (c.name === 'sniper') c.visible = view === 'estate' || view === 'iso' || view === 'plan';
  }
}

/* ---------------- Cameras ---------------- */

function setView(v: View): void {
  view = v;
  for (const b of bar.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.classList.toggle('on', b.dataset.v === v);
  $('scope').hidden = v !== 'scope';
  if (!built || !bp) return;
  const fp = bp.stats.footprint;
  const cx = (fp.x0 + fp.x1) / 2;
  const cz = (fp.z0 + fp.z1) / 2;
  controls.enabled = v === 'estate';
  scene.fog = v === 'iso' || v === 'plan' ? null : built.fog;
  renderer.clippingPlanes = v === 'plan' ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), bp.levels[0]!.floorY + 2.6)] : [];
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  if (v === 'scope' || v === 'wide') {
    renderPass.camera = camera;
    camera.position.copy(built.perch.position);
    camera.near = 1;
    camera.fov = v === 'wide' ? 26 : aim.fov;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    aimCamera();
  } else if (v === 'estate') {
    renderPass.camera = camera;
    camera.fov = 35;
    camera.near = 0.5;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    camera.position.set(cx + 62, 40, cz + 78);
    controls.target.set(cx, 5, cz);
    controls.update();
  } else {
    renderPass.camera = ortho;
    const span = Math.max(fp.x1 - fp.x0, fp.z1 - fp.z0) * 0.62 + 12;
    const a = W / H;
    const sx = a >= 1 ? span * a : span;
    const sy = a >= 1 ? span : span / a;
    Object.assign(ortho, { left: -sx, right: sx, top: sy, bottom: -sy });
    if (v === 'plan') {
      ortho.position.set(cx, 400, cz + 0.01);
      ortho.up.set(0, 0, -1);
      ortho.lookAt(cx, 0, cz);
    } else {
      const dir = built.perch.position.clone().sub(new THREE.Vector3(cx, 0, cz)).setY(0).normalize();
      ortho.position.set(cx + dir.x * 300, 300 * Math.tan((35 * Math.PI) / 180), cz + dir.z * 300);
      ortho.up.set(0, 1, 0);
      ortho.lookAt(cx, 4, cz);
    }
    ortho.updateProjectionMatrix();
  }
  applyOverlays();
  updateReadout();
}

function aimCamera(): void {
  if (!built) return;
  const base = built.perch.target.clone().sub(built.perch.position).normalize();
  const yaw = Math.atan2(base.x, base.z) + aim.yaw;
  const pitch = Math.asin(base.y) + aim.pitch;
  camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))));
}

function updateReadout(): void {
  if (!bp || view !== 'scope') return;
  const scope = $('scope');
  const r = Math.min(stage.clientWidth, stage.clientHeight) * 0.36;
  scope.style.setProperty('--r', `${r}px`);
  // Range to whatever the crosshair is on, approximated by the façade distance.
  $('readout').innerHTML = `RANGE <b>${bp.site.perch.distance.toFixed(0)} m</b> · FOV <b>${aim.fov.toFixed(1)}°</b> · <b>×${(25 / aim.fov).toFixed(1)}</b>`;
}

function zoom(k: number): void {
  if (!built || view !== 'scope') return;
  aim.fov = Math.max(built.perch.fovMin, Math.min(18, aim.fov * k));
  camera.fov = aim.fov;
  camera.updateProjectionMatrix();
  updateReadout();
}

/* ---------------- Input ---------------- */

const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointerup', (e) => {
  pointers.delete(e.pointerId);
  pinch = 0;
});
renderer.domElement.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId));
renderer.domElement.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (view !== 'scope' && view !== 'wide') return;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (pinch) zoom(pinch / d);
    pinch = d;
    return;
  }
  const k = (camera.fov / 60) * 0.005;
  aim.yaw -= (e.clientX - prev.x) * k;
  aim.pitch = Math.max(-0.35, Math.min(0.35, aim.pitch + (e.clientY - prev.y) * k));
  aimCamera();
});
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    zoom(Math.exp(e.deltaY * 0.0012));
  },
  { passive: false },
);
addEventListener('resize', () => {
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  composer.setSize(stage.clientWidth, stage.clientHeight);
  setView(view);
});

function loop(): void {
  if (view === 'estate') controls.update();
  composer.render();
  requestAnimationFrame(loop);
}

setView('scope');
survey();
loop();
