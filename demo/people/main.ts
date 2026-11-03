/**
 * People lab (milestone 5 spike): the 3D guests in a row of poses, under plain lights.
 *   /people/?lod=0&fov=20&dist=8      lod forces a level (else picked by screen height)
 * The camera sits at `dist` metres; `fov` is the vertical field (degrees).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { People, type ModelId } from "../../src/party/render/people";
import type { FrameState } from "../../src/party/render/crowd";
import type { Gesture, Person, Pose } from "../../src/party/types";

const params = new URLSearchParams(location.search);
const shot = params.has("shot");
const W = Number(params.get("w") ?? 0) || innerWidth;
const H = Number(params.get("h") ?? 0) || innerHeight;
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: shot,
});
renderer.setSize(W, H);
renderer.setPixelRatio(shot ? 1 : devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2d35);
scene.add(new THREE.HemisphereLight(0xfff4e6, 0x30343c, 1.4));
const sun = new THREE.DirectionalLight(0xffe2c0, 2.2);
sun.position.set(3, 6, 8);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

type Row = {
  sex: "m" | "f";
  outfit: Person["look"]["outfit"];
  pose: Pose;
  gesture?: Gesture;
  speaking?: boolean;
};
const POSES: Array<[Pose, Gesture | undefined, boolean?]> = [
  ["stand", undefined],
  ["walk", undefined],
  ["talk", undefined, true],
  ["drink", undefined],
  ["toast", undefined],
  ["stand", "point"],
  ["stand", "wave"],
  ["stand", "shrug"],
  ["phone", undefined],
  ["sit", undefined],
  ["dance", undefined],
];
const only = params.get("poses")?.split(",");
const rows: Row[] = [];
for (const [sex, outfit] of [
  ["m", "dinner-jacket"],
  ["f", "short-dress"],
] as const)
  for (const [pose, gesture, speaking] of POSES) if (!only || only.includes(gesture ?? pose)) rows.push({ sex, outfit, pose, gesture, speaking });
const cols = Math.ceil(rows.length / 2);
const people = rows.map(
  (r, i) =>
    ({
      id: i,
      name: `${r.pose}${r.gesture ? "+" + r.gesture : ""}`,
      look: {
        sex: r.sex,
        height: r.sex === "m" ? 1.78 : 1.66,
        build: 0.5,
        outfit: r.outfit,
        color: "#111",
        accent: "#fff",
        skin: "#c99",
        hair: "#432",
        hat: false,
      },
      speed: 1.3,
      quirks: [],
      tipsy: 0,
    }) as unknown as Person,
);
const states: FrameState[] = rows.map((r, i) => ({
  x: ((i % cols) - (cols - 1) / 2) * 1.1,
  y: 0,
  z: Math.floor(i / cols) * -2.2,
  yaw: 0,
  pose: r.pose,
  gesture: r.gesture ?? null,
  speaking: r.speaking ?? false,
  room: -1,
  visible: true,
}));

const fov = Number(params.get("fov") ?? 30);
const dist = Number(params.get("dist") ?? 14);
const camera = new THREE.PerspectiveCamera(fov, W / H, 0.1, 500);
camera.position.set(Number(params.get("cx") ?? 0), Number(params.get("cy") ?? 1.6), dist);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(Number(params.get("tx") ?? 0), Number(params.get("ty") ?? 1.0), Number(params.get("tz") ?? -1));
controls.update();

const urls: Record<ModelId, string> = {
  "m-dinner": new URL("../party/people/m-dinner.glb", import.meta.url).href,
  "f-dress": new URL("../party/people/f-dress.glb", import.meta.url).href,
};
const templates = await People.load(urls, null);
const crowd = new People(templates, people);
scene.add(crowd.root);
const forced = params.has("lod") ? Number(params.get("lod")) : null;
const info = document.getElementById("info")!;
const t0 = Number(params.get("t") ?? 0);
let frames = 0;
const times: number[] = [];
function loop(now: number): void {
  const time = shot ? t0 : t0 + now / 1000;
  const a = performance.now();
  crowd.update(people, states, time, camera, H);
  if (forced !== null) for (const g of crowd.root.children) g.traverse((o) => o.userData.lod !== undefined && (o.visible = o.userData.lod === forced));
  renderer.render(scene, camera);
  times.push(performance.now() - a);
  info.textContent = `${rows.length} people  drawn by level ${crowd.drawn.join("/")}  ${renderer.info.render.triangles} tris  ${renderer.info.render.calls} calls`;
  if (shot && ++frames >= 3) {
    (window as unknown as { __ready: boolean }).__ready = true;
    return;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
/** ?bench=N: time N pose updates (CPU only, after a warm-up) and report the mean per guest. */
let bench: number | null = null;
if (params.has("bench")) {
  const n = Number(params.get("bench")) || 500;
  for (let k = 0; k < 200; k++) crowd.update(people, states, k / 60, camera, H);
  const a = performance.now();
  for (let k = 0; k < n; k++) crowd.update(people, states, k / 60, camera, H);
  bench = (performance.now() - a) / n / rows.length;
}
(window as unknown as { __stats: () => unknown }).__stats = () => ({
  benchMsPerGuest: bench?.toFixed(4),
  drawn: crowd.drawn,
  tris: renderer.info.render.triangles,
  calls: renderer.info.render.calls,
  ms: times.slice(-1)[0]?.toFixed(1),
});
