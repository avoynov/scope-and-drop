import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { generateMansion, movePerch, type MansionBlueprint, type MansionOptions } from '../src/mansion';
import { buildMansion, type BuiltMansion, type Quality } from '../src/mansion/build';
import { createGradePass } from '../src/mansion/build/grade';
import { createBriefing, labelForms } from './briefing';

type View = 'scope' | 'wide' | 'orbit' | 'iso' | 'plan' | 'free';

const params = new URLSearchParams(location.search);
const shot = params.has('shot');
if (shot) document.body.classList.add('shot');
const W = Number(params.get('w') ?? 0) || innerWidth;
const H = Number(params.get('h') ?? 0) || innerHeight;
/** Live size of the view: fixed for scripted stills, the window otherwise. */
const viewSize = (): { w: number; h: number } => (params.has('w') ? { w: W, h: H } : { w: innerWidth, h: innerHeight });

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: shot });
renderer.setPixelRatio(shot ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(params.get('exposure') ?? 1.4);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(10, W / H, 0.5, 9000);
const ortho = new THREE.OrthographicCamera(-50, 50, 30, -30, 0.5, 2000);
// Flat work light for the plan view only: upstairs rooms are dark at party time, and a plan has to be readable.
// It stays in the scene at zero intensity elsewhere, so switching views never recompiles shaders.
const planLight = new THREE.AmbientLight(0xfff1dc, 0);
scene.add(planLight);
const PLAN_LIGHT = Number(params.get('planlight') ?? 0.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
controls.enableDamping = true;

const rt = new THREE.WebGLRenderTarget(W * renderer.getPixelRatio(), H * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: Number(params.get('msaa') ?? 4) });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.55, 1.4);
composer.addPass(renderPass);
composer.addPass(bloom);
if (!params.has('nograde')) composer.addPass(createGradePass({ splitStrength: Number(params.get('split') ?? 0.18), saturation: Number(params.get('sat') ?? 1.12) }));
composer.addPass(new OutputPass());

let bp: MansionBlueprint;
let built: BuiltMansion | null = null;
let lastGenMs = 0;
const briefing = createBriefing((chosen) => deploy(chosen));
let view: View = (params.get('view') as View) ?? 'scope';
let aim = { yaw: 0, pitch: 0, fov: Number(params.get('fov') ?? 9) };
const overlays = { sight: params.has('sight'), pois: params.has('pois') };
const overlayGroup = new THREE.Group();
/** Storey shown by the plan view (0 = ground floor). */
let planLevel = Math.max(0, Math.floor(Number(params.get('level') ?? 0)) || 0);
/** Plan view zoom (1 = whole estate in view) and pan, in metres off the centre of the house. */
let planZoom = Math.max(1, Math.min(14, Number(params.get('zoom') ?? 1) || 1));
const planPan = { x: 0, z: 0 };
const PLAN_ZOOM_MAX = 14;
const LEVEL_NAMES = ['ground', 'first', 'second', 'third'];

const $ = (id: string) => document.getElementById(id)!;
const seedInput = $('seed') as HTMLInputElement;
const styleSel = $('style') as HTMLSelectElement;
const massSel = $('massing') as HTMLSelectElement;
const sizeSel = $('size') as HTMLSelectElement;
const hallSel = $('hall') as HTMLSelectElement;
hallSel.value = params.get('hall') ?? 'gallery';
const minVisInput = $('minvis') as HTMLInputElement;
minVisInput.value = params.get('minvis') ?? '30';
const roofGlassInput = $('roofglass') as HTMLInputElement;
roofGlassInput.value = params.get('roofglass') ?? '70';
seedInput.value = params.get('seed') ?? 'gala-night';
styleSel.value = params.get('style') ?? '';
massSel.value = params.get('massing') ?? '';
sizeSel.value = params.get('size') ?? 'grand';

function build(): void {
  const t0 = performance.now();
  const opts: MansionOptions = {
    seed: seedInput.value || 'gala-night',
    style: (styleSel.value || undefined) as MansionOptions['style'],
    massing: (massSel.value || undefined) as MansionOptions['massing'],
    size: sizeSel.value as MansionOptions['size'],
    hall: hallSel.value as MansionOptions['hall'],
    minVisible: Math.max(0, Math.min(70, Number(minVisInput.value) || 0)) / 100,
  };
  bp = generateMansion(opts);
  // A bearing in the URL skips the choice (used by the render scripts and shared links).
  if (params.has('az') || params.has('el')) bp = movePerch(bp, Number(params.get('az') ?? bp.site.perch.azimuthDeg), Number(params.get('el') ?? bp.site.perch.elevationDeg));
  const genMs = performance.now() - t0;
  if (built) {
    scene.remove(built.root);
    built.dispose();
  }
  built = buildMansion(bp, {
    renderer,
    quality: (params.get('quality') as Quality) ?? 'high',
    lightScale: params.has('light') ? Number(params.get('light')) : undefined,
    skyIntensity: params.has('sky') ? Number(params.get('sky')) : undefined,
    roofGlassOpacity: Number(roofGlassInput.value) / 100,
  });
  scene.add(built.root);
  scene.fog = built.fog;
  scene.environment = null;
  planLevel = Math.min(planLevel, bp.levels.length - 1);
  planPan.x = planPan.z = 0;
  buildFloorButtons();
  buildOverlays();
  aim = { yaw: 0, pitch: 0, fov: Number(params.get('fov') ?? 9) };
  setView(view);
  showStats(genMs);
  const url = new URL(location.href);
  url.searchParams.set('seed', opts.seed as string);
  url.searchParams.set('hall', hallSel.value);
  url.searchParams.set('minvis', minVisInput.value || '0');
  if (url.searchParams.has('level')) url.searchParams.set('level', String(planLevel));
  history.replaceState(null, '', url);
  // Before the mission: show the plan and let the sniper pick a bearing.
  if ((!shot && !params.has('az') && !params.has('el') && !params.has('nobrief')) || params.has('brief')) briefing.open(bp);
}

function showStats(genMs?: number): void {
  if (!built) return;
  if (genMs !== undefined) lastGenMs = genMs;
  const v = bp.validation;
  const errors = v.issues.filter((i) => i.severity === 'error');
  $('stats').textContent = [
    `${bp.style.name} · ${bp.massing} · ${bp.bays} bays × ${bp.bay} m · ${bp.levels.length} storeys`,
    `rooms ${bp.stats.rooms} (party ${bp.stats.partyRooms}) · props ${bp.stats.props} · lights ${bp.stats.lights} · POIs ${bp.pois.length}`,
    `perch ${bp.site.perch.distance} m @ ${bp.site.perch.azimuthDeg}°, up ${bp.site.perch.elevationDeg}° · indoor party in view ${(bp.sightlines.partyVisible * 100).toFixed(0)}% · terrace ${(bp.sightlines.terrace * 100).toFixed(0)}%`,
    `out of sight ${(bp.sightlines.hiddenShare * 100).toFixed(0)}% of the ground floor · ${bp.atrium ? `${bp.atrium.shape} dome hall` : 'no dome hall'}${bp.roofTerraces.length ? ` · ${bp.roofTerraces.length} roof terrace${bp.roofTerraces.length > 1 ? 's' : ''}` : ''}`,
    `valid ${v.ok ? 'yes' : `NO: closest of ${bp.options.maxAttempts} tries`} (attempt ${bp.attempt}) · minimum in view ${(bp.options.partyVisibility[0] * 100).toFixed(0)}%${errors.length ? '\n' + errors.map((e) => '× ' + e.message).join('\n') : ''}`,
    `generate ${lastGenMs.toFixed(0)} ms · build ${built.stats.buildMs} ms · ${(built.stats.triangles / 1000).toFixed(0)}k tris · ${built.stats.meshes} meshes`,
  ].join('\n');
}

/** The sniper has chosen a bearing: same house, new eye. */
function deploy(next: MansionBlueprint): void {
  bp = next;
  if (!built) return;
  const e = bp.site.perch.eye;
  built.perch.position.set(e.x, e.y, e.z);
  buildOverlays();
  aim = { yaw: 0, pitch: 0, fov: Number(params.get('fov') ?? 9) };
  setView(view === 'plan' || view === 'iso' || view === 'orbit' ? 'scope' : view);
  showStats();
}

/** One button per storey; rebuilt per house because storey counts differ. */
function buildFloorButtons(): void {
  const row = $('floors');
  row.replaceChildren();
  for (const lv of bp.levels) {
    const b = document.createElement('button');
    const name = LEVEL_NAMES[lv.index] ?? `level ${lv.index}`;
    // Short labels so three storeys fit on one row of the panel.
    b.textContent = name;
    b.title = `${name} floor, +${lv.floorY.toFixed(2)} m`;
    b.dataset.level = String(lv.index);
    b.classList.toggle('on', lv.index === planLevel);
    b.onclick = () => setPlanLevel(lv.index);
    row.appendChild(b);
  }
}

function setPlanLevel(level: number): void {
  planLevel = Math.max(0, Math.min(bp.levels.length - 1, level));
  for (const b of document.querySelectorAll<HTMLButtonElement>('#floors button')) b.classList.toggle('on', Number(b.dataset.level) === planLevel);
  buildOverlays();
  setView(view);
  if (!shot) {
    const url = new URL(location.href);
    url.searchParams.set('level', String(planLevel));
    history.replaceState(null, '', url);
  }
}

/** Storey the overlays describe: the chosen one in the plan view, the ground floor (where the party is) elsewhere. */
function overlayLevel(): number {
  return view === 'plan' ? planLevel : 0;
}

/** Sightline heat map of one storey + POI markers. */
function buildOverlays(): void {
  overlayGroup.clear();
  scene.add(overlayGroup);
  const level = overlayLevel();
  const n = bp.nav.levels.find((l) => l.level === level) ?? bp.nav.levels[0]!;
  const data = new Uint8Array(n.cols * n.rows * 4);
  for (let k = 0; k < n.walk.length; k++) {
    if (!n.walk[k]) continue;
    const v = n.vis[k]! / 255;
    data[k * 4] = Math.round(255 * (1 - v));
    data[k * 4 + 1] = Math.round(200 * v + 30);
    data[k * 4 + 2] = 60;
    data[k * 4 + 3] = 150;
  }
  const tex = new THREE.DataTexture(data, n.cols, n.rows);
  tex.needsUpdate = true;
  tex.magFilter = THREE.NearestFilter;
  const w = n.cols * n.cell;
  const d = n.rows * n.cell;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(n.originX + w / 2, n.y + 0.06, n.originZ + d / 2);
  // Plane UV v runs toward -z after rotation; flip to match row-major z.
  plane.scale.z = 1;
  tex.flipY = false;
  plane.geometry.attributes.uv!.array.forEach((_, i, arr) => {
    if (i % 2 === 1) (arr as Float32Array)[i] = 1 - (arr as Float32Array)[i]!;
  });
  plane.renderOrder = 5;
  plane.name = 'sight';
  plane.visible = overlays.sight;
  overlayGroup.add(plane);
  const colors: Record<string, string> = { statue: '#f0f0f0', bar: '#ff6b3d', bookshelf: '#c08a4a', painting: '#d4b14a', piano: '#9a7cff', fireplace: '#ff3b2f', ledger: '#3dc6ff', clock: '#58e07a', window: '#7fd6ff', safe: '#999', globe: '#5aa' };
  for (const p of bp.pois) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: colors[p.type] ?? '#fff', fog: false, toneMapped: false, depthTest: false }));
    const floor = bp.levels[p.level]?.floorY ?? 0;
    m.position.set(p.stand.x, floor + 1.7, p.stand.z);
    m.name = 'poi';
    // Markers draw through walls and floors, so the plan view keeps only its own storey's.
    m.userData.level = p.level;
    m.visible = overlays.pois && (view !== 'plan' || p.level === planLevel);
    m.renderOrder = 6;
    overlayGroup.add(m);
  }
  // Sniper marker.
  const e = bp.site.perch.eye;
  const sniper = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3, 12), new THREE.MeshBasicMaterial({ color: '#ff3355', fog: false, toneMapped: false }));
  sniper.position.set(e.x, e.y + 2, e.z);
  sniper.rotation.x = Math.PI;
  sniper.name = 'sniper';
  sniper.visible = view !== 'scope' && view !== 'wide';
  overlayGroup.add(sniper);
}

function setView(v: View): void {
  const overlaysStale = (v === 'plan') !== (view === 'plan') && planLevel !== 0;
  view = v;
  document.body.classList.toggle('plan', v === 'plan');
  if (!built) return;
  // The overlays follow the plan view's storey; entering or leaving it swaps them back to the ground floor.
  if (overlaysStale) buildOverlays();
  for (const c of overlayGroup.children) if (c.name === 'poi') c.visible = overlays.pois && (v !== 'plan' || c.userData.level === planLevel);
  const fp = bp.stats.footprint;
  const cx = (fp.x0 + fp.x1) / 2;
  const cz = (fp.z0 + fp.z1) / 2;
  controls.enabled = v === 'orbit';
  // Fog is tuned for the perch distance; orthographic views sit at arbitrary range.
  scene.fog = v === 'iso' || v === 'plan' ? null : built.fog;
  $('reticle').classList.toggle('on', v === 'scope' && !params.has('noreticle'));
  // Plan = horizontal cut through the chosen storey, a little above head height.
  planLight.intensity = v === 'plan' ? PLAN_LIGHT : 0;
  const cut = bp.levels[planLevel]!;
  renderer.clippingPlanes = v === 'plan' ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), cut.floorY + Math.min(2.6, cut.height * 0.75))] : [];
  overlayGroup.getObjectByName('sniper')!.visible = v !== 'scope' && v !== 'wide';
  if (v === 'scope' || v === 'wide') {
    renderPass.camera = camera;
    camera.position.copy(built.perch.position);
    camera.fov = v === 'wide' ? Number(params.get('fov') ?? 26) : aim.fov;
    camera.near = 1;
    camera.far = 9000;
    camera.updateProjectionMatrix();
    aimCamera();
  } else if (v === 'free') {
    // Debug camera from the URL: ?view=free&cam=x,y,z&look=x,y,z[&camfov=50]
    const num = (k: string, d: number[]) => (params.get(k)?.split(',').map(Number) ?? d) as [number, number, number];
    renderPass.camera = camera;
    camera.fov = Number(params.get('camfov') ?? 55);
    camera.near = 0.1;
    camera.updateProjectionMatrix();
    camera.position.set(...num('cam', [cx, 30, cz + 40]));
    camera.lookAt(...num('look', [cx, 5, cz]));
    scene.fog = null;
  } else if (v === 'orbit') {
    renderPass.camera = camera;
    camera.fov = 35;
    camera.near = 0.5;
    camera.updateProjectionMatrix();
    camera.position.set(cx + 70, 45, cz + 85);
    controls.target.set(cx, 6, cz);
    controls.update();
  } else {
    renderPass.camera = ortho;
    const span = Math.max(fp.x1 - fp.x0, fp.z1 - fp.z0) * 0.62 + 12;
    const a = viewSize().w / viewSize().h;
    ortho.left = -span * a;
    ortho.right = span * a;
    ortho.top = span;
    ortho.bottom = -span;
    ortho.near = 1;
    ortho.far = 3000;
    if (v === 'plan') {
      // Zoomed and panned by the wheel and by dragging.
      const half = span / planZoom;
      ortho.left = -half * a;
      ortho.right = half * a;
      ortho.top = half;
      ortho.bottom = -half;
      ortho.position.set(cx + planPan.x, 400, cz + planPan.z + 0.01);
      ortho.up.set(0, 0, -1);
      ortho.lookAt(cx + planPan.x, 0, cz + planPan.z);
    } else {
      // Isometric-ish: from the perch bearing, 35° down.
      const dir = built.perch.position.clone().sub(new THREE.Vector3(cx, 0, cz)).setY(0).normalize();
      ortho.position.set(cx + dir.x * 300, 300 * Math.tan((35 * Math.PI) / 180), cz + dir.z * 300);
      ortho.up.set(0, 1, 0);
      ortho.lookAt(cx, 4, cz);
    }
    ortho.updateProjectionMatrix();
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views button')) b.classList.toggle('on', b.dataset.v === v);
  layoutPlanLabels();
}

/** Plan view: half the height of the view in metres, and the world point at its centre. */
function planFrame(): { half: number; x: number; z: number } {
  const fp = bp.stats.footprint;
  return { half: (Math.max(fp.x1 - fp.x0, fp.z1 - fp.z0) * 0.62 + 12) / planZoom, x: (fp.x0 + fp.x1) / 2 + planPan.x, z: (fp.z0 + fp.z1) / 2 + planPan.z };
}

/** Room names over the plan view: one per room of the storey shown, shortened or dropped when the room is too small on screen. */
function layoutPlanLabels(): void {
  const box = $('plan-labels');
  box.replaceChildren();
  if (view !== 'plan' || !built || params.has('nolabels')) return;
  const f = planFrame();
  const { w: W, h: H } = viewSize();
  const pxPerM = H / (2 * f.half);
  for (const r of bp.rooms) {
    if (r.level !== planLevel) continue;
    const w = (r.inner.x1 - r.inner.x0) * pxPerM;
    const h = (r.inner.z1 - r.inner.z0) * pxPerM;
    if (h < 15) continue;
    // 6.7 px per character at the label's size.
    const fits = (t: string) => t.length * 6.7 + 10 <= w;
    const text = labelForms(r.label).find(fits);
    if (!text) continue;
    const x = W / 2 + ((r.inner.x0 + r.inner.x1) / 2 - f.x) * pxPerM;
    const y = H / 2 + ((r.inner.z0 + r.inner.z1) / 2 - f.z) * pxPerM;
    if (x < 0 || x > W || y < 0 || y > H) continue;
    const el = document.createElement('span');
    el.textContent = text;
    el.title = `${r.label} · ${(r.inner.x1 - r.inner.x0).toFixed(1)} × ${(r.inner.z1 - r.inner.z0).toFixed(1)} m`;
    el.className = r.role;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    box.appendChild(el);
  }
}

function aimCamera(): void {
  if (!built) return;
  const base = built.perch.target.clone().sub(built.perch.position).normalize();
  const yaw0 = Math.atan2(base.x, base.z);
  const pitch0 = Math.asin(base.y);
  const yaw = yaw0 + aim.yaw;
  const pitch = pitch0 + aim.pitch;
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  camera.lookAt(camera.position.clone().add(dir));
}

// UI wiring.
for (const v of ['scope', 'wide', 'orbit', 'iso', 'plan'] as View[]) {
  const b = document.createElement('button');
  b.textContent = v;
  b.dataset.v = v;
  b.onclick = () => setView(v);
  $('views').appendChild(b);
}
for (const [k, label] of [
  ['sight', 'sightlines'],
  ['pois', 'missions'],
] as const) {
  const b = document.createElement('button');
  b.textContent = label;
  b.classList.toggle('on', overlays[k]);
  b.onclick = () => {
    overlays[k] = !overlays[k];
    b.classList.toggle('on', overlays[k]);
    overlayGroup.children.forEach((c) => {
      if (k === 'sight' && c.name === 'sight') c.visible = overlays.sight;
      if (k === 'pois' && c.name === 'poi') c.visible = overlays.pois && (view !== 'plan' || c.userData.level === planLevel);
    });
  };
  $('overlays').appendChild(b);
}
$('go').onclick = build;
hallSel.onchange = build;
minVisInput.onchange = build;
// Looks only, so no rebuild: the material is shared by every glass roof.
roofGlassInput.oninput = () => {
  if (built) built.materials.get('roof-glass').opacity = Number(roofGlassInput.value) / 100;
  const url = new URL(location.href);
  url.searchParams.set('roofglass', roofGlassInput.value);
  history.replaceState(null, '', url);
};
$('rebrief').onclick = () => briefing.open(bp);
$('rnd').onclick = () => {
  seedInput.value = Math.random().toString(36).slice(2, 8);
  build();
};
seedInput.onkeydown = (e) => e.key === 'Enter' && build();

let dragging = false;
renderer.domElement.addEventListener('pointerdown', () => (dragging = true));
addEventListener('pointerup', () => (dragging = false));
addEventListener('pointermove', (e) => {
  if (dragging && view === 'plan' && built) {
    // Drag the plan: the point under the cursor follows it.
    const mPerPx = (2 * planFrame().half) / viewSize().h;
    planPan.x -= e.movementX * mPerPx;
    planPan.z -= e.movementY * mPerPx;
    clampPlanPan();
    setView('plan');
    return;
  }
  if (!dragging || (view !== 'scope' && view !== 'wide')) return;
  const k = (camera.fov / 60) * 0.004;
  aim.yaw -= e.movementX * k;
  aim.pitch = Math.max(-0.4, Math.min(0.4, aim.pitch - e.movementY * k));
  aimCamera();
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
    if (view !== 'plan' || !built) return;
    e.preventDefault();
    // Zoom about the cursor: the room under it stays under it.
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
renderer.domElement.addEventListener('wheel', (e) => {
  if (view !== 'scope' || !built) return;
  aim.fov = Math.max(built.perch.fovMin, Math.min(built.perch.fovMax, aim.fov * Math.exp(e.deltaY * 0.001)));
  camera.fov = aim.fov;
  camera.updateProjectionMatrix();
});
addEventListener('resize', () => {
  if (shot) return;
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  setView(view);
});

build();
let frames = 0;
let lastInfo = { calls: 0, triangles: 0 };
function loop(): void {
  if (view === 'orbit') controls.update();
  renderer.info.reset();
  // The briefing covers the scene: no need to draw it underneath.
  if (!briefing.isOpen || shot) composer.render();
  lastInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  frames++;
  if (shot && frames === Number(params.get('frames') ?? 2)) {
    (window as unknown as { __ready: boolean }).__ready = true;
    return;
  }
  requestAnimationFrame(loop);
}
loop();
(window as unknown as { __stats: () => unknown }).__stats = () => ({ ...lastInfo, programs: renderer.info.programs?.length, buildMs: built?.stats.buildMs, meshTris: built?.stats.triangles, valid: bp.validation.ok });
