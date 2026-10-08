import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { generateMansion, type MansionBlueprint, type MansionOptions } from '../src/mansion';
import { buildMansion, type BuiltMansion, type Quality } from '../src/mansion/build';
import { createGradePass } from '../src/mansion/build/grade';

type View = 'scope' | 'wide' | 'orbit' | 'iso' | 'plan';

const params = new URLSearchParams(location.search);
const shot = params.has('shot');
if (shot) document.body.classList.add('shot');
const W = Number(params.get('w') ?? 0) || innerWidth;
const H = Number(params.get('h') ?? 0) || innerHeight;

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
let view: View = (params.get('view') as View) ?? 'scope';
let aim = { yaw: 0, pitch: 0, fov: Number(params.get('fov') ?? 9) };
const overlays = { sight: params.has('sight'), pois: params.has('pois') };
const overlayGroup = new THREE.Group();

const $ = (id: string) => document.getElementById(id)!;
const seedInput = $('seed') as HTMLInputElement;
const styleSel = $('style') as HTMLSelectElement;
const massSel = $('massing') as HTMLSelectElement;
const sizeSel = $('size') as HTMLSelectElement;
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
  };
  bp = generateMansion(opts);
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
  });
  scene.add(built.root);
  scene.fog = built.fog;
  scene.environment = null;
  buildOverlays();
  aim = { yaw: 0, pitch: 0, fov: Number(params.get('fov') ?? 9) };
  setView(view);
  const v = bp.validation;
  const errors = v.issues.filter((i) => i.severity === 'error');
  $('stats').textContent = [
    `${bp.style.name} · ${bp.massing} · ${bp.bays} bays × ${bp.bay} m · ${bp.levels.length} storeys`,
    `rooms ${bp.stats.rooms} (party ${bp.stats.partyRooms}) · props ${bp.stats.props} · lights ${bp.stats.lights} · POIs ${bp.pois.length}`,
    `perch ${bp.site.perch.distance} m @ ${bp.site.perch.azimuthDeg}° · party visible ${(bp.sightlines.partyVisible * 100).toFixed(0)}% · blind spots ${v.metrics.blindSpots}`,
    `valid ${v.ok ? 'yes' : 'NO'} (attempt ${bp.attempt})${errors.length ? '\n' + errors.map((e) => '× ' + e.message).join('\n') : ''}`,
    `generate ${genMs.toFixed(0)} ms · build ${built.stats.buildMs} ms · ${(built.stats.triangles / 1000).toFixed(0)}k tris · ${built.stats.meshes} meshes`,
  ].join('\n');
  const url = new URL(location.href);
  url.searchParams.set('seed', opts.seed as string);
  history.replaceState(null, '', url);
}

/** Sightline heat map on the ground floor + POI markers. */
function buildOverlays(): void {
  overlayGroup.clear();
  scene.add(overlayGroup);
  const n = bp.nav.levels[0]!;
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
    m.visible = overlays.pois;
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
  view = v;
  if (!built) return;
  const fp = bp.stats.footprint;
  const cx = (fp.x0 + fp.x1) / 2;
  const cz = (fp.z0 + fp.z1) / 2;
  controls.enabled = v === 'orbit';
  // Fog is tuned for the perch distance; orthographic views sit at arbitrary range.
  scene.fog = v === 'iso' || v === 'plan' ? null : built.fog;
  $('reticle').classList.toggle('on', v === 'scope' && !params.has('noreticle'));
  renderer.clippingPlanes = v === 'plan' ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), bp.levels[0]!.floorY + 2.6)] : [];
  overlayGroup.getObjectByName('sniper')!.visible = v !== 'scope' && v !== 'wide';
  if (v === 'scope' || v === 'wide') {
    renderPass.camera = camera;
    camera.position.copy(built.perch.position);
    camera.fov = v === 'wide' ? Number(params.get('fov') ?? 26) : aim.fov;
    camera.near = 1;
    camera.far = 9000;
    camera.updateProjectionMatrix();
    aimCamera();
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
    const a = W / H;
    ortho.left = -span * a;
    ortho.right = span * a;
    ortho.top = span;
    ortho.bottom = -span;
    ortho.near = 1;
    ortho.far = 3000;
    if (v === 'plan') {
      ortho.position.set(cx, 400, cz + 0.01);
      ortho.up.set(0, 0, -1);
      ortho.lookAt(cx, 0, cz);
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
      if ((k === 'sight' && c.name === 'sight') || (k === 'pois' && c.name === 'poi')) c.visible = overlays[k];
    });
  };
  $('overlays').appendChild(b);
}
$('go').onclick = build;
$('rnd').onclick = () => {
  seedInput.value = Math.random().toString(36).slice(2, 8);
  build();
};
seedInput.onkeydown = (e) => e.key === 'Enter' && build();

let dragging = false;
renderer.domElement.addEventListener('pointerdown', () => (dragging = true));
addEventListener('pointerup', () => (dragging = false));
addEventListener('pointermove', (e) => {
  if (!dragging || (view !== 'scope' && view !== 'wide')) return;
  const k = (camera.fov / 60) * 0.004;
  aim.yaw -= e.movementX * k;
  aim.pitch = Math.max(-0.4, Math.min(0.4, aim.pitch - e.movementY * k));
  aimCamera();
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
  composer.render();
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
