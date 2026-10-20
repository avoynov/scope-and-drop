import * as THREE from "three";
import { ROUNDS } from "../../src/scope/ballistics";
import { HEAD_UP, ON_WELD, adsEye, adsRoll, adsVelocity, planScopeIn, planScopeOut, type AdsMotion, type Vec3 } from "../../src/scope/ads";
import { SCOPE, exitPupilMm, eyeboxTransmission, parallaxShiftRad, tanHalfApparent, trueFovRad, type Eye } from "../../src/scope/optics";
import { followHead, recoilAt, shotVariation, type RecoilSpec, type RecoilState, type ShotVariation } from "../../src/scope/recoil";
import { RestDynamics, dynamicPressure, holdAt, type RestState } from "../../src/scope/hold";
import { rigFor, type Rig } from "../../src/armoury/rig";
import { decodeKit, emptyLoadout, encodeKit, payFactor, type Loadout } from "../../src/armoury/loadout";
import { ACSS_RANGES, PSO_CHEVRON_RANGES, RETICLES, TREMOR_ROWS, VSS_CHEVRON_RANGES, acssReticle, drawReticle, treeReticle, type Reticle, type TreeStyle } from "../../src/scope/reticles";
import { comeUps, dotValues, loadCard, loadCardNeeded } from "../../src/scope/cards";
import { speedDrop, windHoldMil, type AimAid } from "../../src/scope/aids";
import { BEAM_RAYS, KILO8K, Kilo, PLAIN_LRF, PLAIN_RAYS, handShakeMrad, pickReturn, rangeSigmaM, type KiloReticle, type RayHit, type TargetMode } from "../../src/scope/kilo";
import { compose, invert, qRot } from "../../src/scope/handling";
import { BATTLE_ZERO_M, RIFLES, shotRandom, crossDriftPerMs, dialDetents, dialReading, dialTiltLoaded, type Dial, type RifleId } from "../../src/scope/shot";
import { WIND_REF_M, shelterWind, terrainWind, windAt, type Wind } from "../../src/scope/wind";
import { createSound } from "./audio";
import { createComposite } from "./composite";
import { GLAZING, type GlazingId } from "../../src/scope/glass";
import { createGlass } from "./glass";
import { DRUM_R_MM, TURN_LIFT_MM, createDrum, drumHome, drumStep } from "./drum";
import { FLAG_DEG_PER_MS } from "./flags";
import { buildRifle, createNearPasses } from "./near";
import { KILO_DOWN_S, KILO_UP_S, kiloRig, paintOled, rasterOled, toQuat, type KiloRig } from "./kilo";
import { CHEST_M, EYE_HEIGHT, buildRange, configureTargets, heightAt, targetRanges, terrainLift, type TargetSpot } from "./scene";
import { createShooting, type Aim } from "./shooting";
import { createWindGL } from "./wind-gl";
import { buildHide } from "./hide";
import { woundSvg, woundText } from "./wound-card";

const params = new URLSearchParams(location.search);
const shot = params.has("shot");
if (shot) document.body.classList.add("shot");
if (params.get("hud") === "0") document.body.classList.add("nohud");
const W = Number(params.get("w") ?? 0) || innerWidth;
const H = Number(params.get("h") ?? 0) || innerHeight;
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
/**
 * Where the mannequins stand (`far=<m>,<deg>` for the 412 m one, `near=<m>,<deg>` for the 183 m one): slant range
 * to the chest and elevation, set from the panel. The terrain is raised to suit, so it is set before anything reads it.
 */
const spotParam = (k: string): TargetSpot | null => {
  const [r, e = 0] = (params.get(k) ?? "").split(",").filter(Boolean).map(Number);
  return r && Number.isFinite(r) && Number.isFinite(e) ? { rangeM: clampSpot(r, 50, 1500), elevDeg: clampSpot(e, -30, 30) } : null;
};
const clampSpot = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
configureTargets([spotParam("far"), spotParam("near")]);

/**
 * The rifle behind each reticle, and the mannequin it is meant for: the SVD and the bolt rifle shoot the one at
 * 412 m, the VSS the one at the game's range, 183 m (range.targets[1]).
 */
const RIFLE = { pso: "svd", tree: "bolt", vss: "vss" } as const satisfies Record<Reticle["id"], RifleId>;
const HOME = { pso: 0, tree: 0, vss: 1 } as const satisfies Record<Reticle["id"], number>;
const reticleParam = params.get("reticle");
/** What `kit=` asks for, before the kit itself is fitted (the reticle's unit is needed sooner). */
const kitAsks = new Set((params.get("kit") ?? "").split(",").map((x) => x.trim().toLowerCase()));

const state = {
  reticle: (reticleParam === "tree" || reticleParam === "vss" ? reticleParam : "pso") as Reticle["id"],
  /** The bolt rifle's reticle: Leupold PR2-MIL, Vortex EBR-7D or the TReMoR3-style grid (`tree=pr2|ebr|tremor`). */
  treeStyle: (kitAsks.has("tremor") ? "tremor" : kitAsks.has("ebr") ? "ebr" : params.get("tree") === "ebr" || params.get("tree") === "tremor" ? params.get("tree") : "pr2") as TreeStyle,
  /** How the bolt rifle gets its elevation: the Speed Drop sum (manual) or a handheld rangefinder (`aid=manual|lrf`). */
  aid: (params.get("aid") === "lrf" ? "lrf" : "manual") as AimAid,
  mag: num("mag", 8),
  parallax: num("par", targetRanges[reticleParam === "vss" ? 1 : 0]!), // metres; Infinity = ∞
  // A good scope, well set up: parallax on the target, eye centred at full eye relief.
  eye: { x: num("ex", 0), y: num("ey", 0), z: num("ez", 0), pupilMm: num("pupil", 3) } as Eye,
  illum: params.has("illum"),
  sway: !params.has("nosway"),
  mirage: !params.has("nomirage"),
  drift: !params.has("nodrift"),
  /** Pan shadow: how far the head trails a quick swing (0 = glued to the stock, 1 = a firm cheek weld, 2 = loose). */
  pan: num("pan", 1),
  /**
   * Wind over the range: speed (m/s at 3 m), the clock direction it blows from, and how much it gusts. It
   * follows the ground (`flatwind` turns that off); the boulder's shelter is baked below, once the range is built.
   */
  wind: (() => {
    const [speed = 2.5, from = 9.5] = (params.get("wind") ?? "").split(",").filter(Boolean).map(Number);
    const w: Wind = { speed, fromClock: from, gust: params.has("nogust") ? 0 : 0.3 };
    // Everything the scope can see: the sage runs out to 1.84 km over ±26°.
    if (!params.has("flatwind")) w.terrain = terrainWind(heightAt, -900, -2000, 900, 150, 10);
    return w;
  })(),
  /** Easy: a wind meter at the hide gives the wind in m/s. Otherwise only the range itself tells it. */
  easy: params.has("easy"),
  sound: !params.has("mute"),
  /**
   * Where each rifle's elevation dial is set, as a detent: the range drums on 1, the 100 m zero, unless `zero=<m>`
   * says otherwise (the nearest mark); the bolt rifle's mil turret on 0 unless `mils=<mil>` dials it up.
   */
  dial: (() => {
    const onDrum = (d: Dial) => {
      if (d.kind === "mil") return Math.max(0, Math.min(d.clicks, Math.round(num("mils", 0) / d.clickMil)));
      const z = num("zero", BATTLE_ZERO_M);
      return d.marksM.reduce((b, m, k) => (Math.abs(m - z) < Math.abs(d.marksM[b]! - z) ? k : b), 0);
    };
    return { pso: onDrum(RIFLES.svd.dial), tree: onDrum(RIFLES.bolt.dial), vss: onDrum(RIFLES.vss.dial) } as Record<Reticle["id"], number>;
  })(),
  /** The glass screens in front of the mannequins: the glazing (or off), and how far they are turned (deg). */
  glass: ((g) => (g && g in GLAZING ? g : "off"))(params.get("glass")) as GlazingId | "off",
  glassAngle: num("glassangle", 0),
  yaw: 0,
  pitch: 0,
};

/** The VSS's scope: the issued PSO-1-1, or the ACSS-style one in the kit. */
let vssStyle: "pso" | "acss" = kitAsks.has("acss") ? "acss" : "pso";
const reticles = new Map<string, Reticle>();
/** The reticle in the scope now, built once for each style. */
const currentReticle = (): Reticle => {
  const key = state.reticle === "tree" ? `tree|${state.treeStyle}` : state.reticle === "vss" ? `vss|${vssStyle}` : "pso";
  let r = reticles.get(key);
  if (!r) reticles.set(key, (r = state.reticle === "tree" ? treeReticle(state.treeStyle) : state.reticle === "vss" && vssStyle === "acss" ? acssReticle() : RETICLES[state.reticle]()));
  return r;
};
/** The reticle's unit for the readouts and cards. */
const unitShort = (r: Reticle) => (r.unitName === "mrad" ? "mil" : "th");

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: shot });
const dpr = shot ? 1 : Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(dpr);
renderer.setSize(W, H);
renderer.shadowMap.enabled = !params.has("noshadow");
renderer.shadowMap.type = THREE.PCFShadowMap;
// The range and the sun never move, so the shadow map is the same every frame: draw it once, on the first
// render that has the sun in it, instead of before every view.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.autoClear = true;
document.getElementById("view")!.appendChild(renderer.domElement);

const windGL = createWindGL(state.wind);
const range = buildRange(windGL);
const { scene } = range;
/** The boulder's shelter, for the mean wind direction. Baked again when the direction changes. */
const bakeShelter = () => {
  if (params.has("flatwind")) return;
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
  const d = home
    .clone()
    .setY(home.y - 0.55)
    .sub(eyePos);
  state.yaw = Math.atan2(-d.x, -d.z);
  state.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  // hold=<units>: aim that many reticle units high (and hold=<up>,<right> for wind), so a chevron sits on the chest.
  const [up = 0, right = 0] = (params.get("hold") ?? "").split(",").filter(Boolean).map(Number);
  const unit = currentReticle().unitRad;
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
const retCanvas = document.createElement("canvas");
const retCtx = retCanvas.getContext("2d")!;
const retTex = new THREE.CanvasTexture(retCanvas);
retTex.colorSpace = THREE.NoColorSpace;
retTex.premultiplyAlpha = false;
retTex.generateMipmaps = false;
retTex.minFilter = THREE.LinearFilter;

const quad = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)));
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

/**
 * The kit (src/armoury): `kit=atlas,bag,kilo` puts a loadout on whichever rifle is up, as the armoury would, and
 * leaves behind what doesn't fit it; the Pro, EBR and Easy buttons then follow the kit. Without it the lab is the
 * lab: its own bipod hold, and those buttons stand for the rangefinder, the reticle and the wind meter.
 */
const kitParam = params.get("kit");
const kitMode = kitParam !== null;
function loadoutNow(): Loadout {
  const id = RIFLE[state.reticle];
  if (kitMode) return decodeKit(id, kitParam);
  const l = emptyLoadout(id);
  if (id === "bolt" && state.aid === "lrf") l.items.ranging = "kilo";
  if (id === "bolt" && state.treeStyle !== "pr2") l.items.optic = state.treeStyle;
  return l;
}
/** The rifle as the kit has it: load, recoil, hold, rest, stock fit, magazine, aids (src/armoury/rig.ts). */
let rig: Rig = rigFor(loadoutNow(), { lab: !kitMode });
let rigKey = "";
/** How the rifle swings on its rest, and where that has it now (before the hold's own sway). */
let restDyn = new RestDynamics(rig.rest, state.yaw, state.pitch);
let restNow: RestState = { yaw: state.yaw, pitch: state.pitch, bagUnsettled: 0, resetting: false };
/** The wind's dynamic pressure on the rifle and the shooter now (Pa), for the buffeting in the hold, and its speed (m/s). */
let windLoad = 0;
let windAtMuzzle = 0;
/** How far a hot can's plume has risen (shader units), for its shimmer. */
let hazeT = 0;
/**
 * The hide's window faces between the two mannequins; with the hide carried the rifle (and the rangefinder) turn
 * only so far either side of that before the barrel meets its frame.
 */
const [arcYaw, arcPitch] = (() => {
  const a = range.targets.map((m) => {
    const d = m.foot.clone().setY(m.foot.y + CHEST_M).sub(eyePos);
    return [Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z))] as const;
  });
  return [a.reduce((x, y) => x + y[0], 0) / a.length, a.reduce((x, y) => x + y[1], 0) / a.length];
})();
/** How far the window lets the muzzle dip or rise from its middle (rad). */
const ARC_PITCH = (6 * Math.PI) / 180;
const clampArc = (yaw: number) => (rig.arcRad === null ? yaw : arcYaw + Math.max(-rig.arcRad, Math.min(rig.arcRad, yaw - arcYaw)));
const clampArcPitch = (pitch: number) => {
  const p = Math.max(-0.3, Math.min(0.3, pitch));
  return rig.arcRad === null ? p : arcPitch + Math.max(-ARC_PITCH, Math.min(ARC_PITCH, p - arcPitch));
};
const hide = buildHide(range.scene, eyePos, arcYaw, arcPitch, (12 * Math.PI) / 180, ARC_PITCH);
/** Rebuilds the rig when the rifle, or in the lab the buttons it follows, change; a new rig settles on its rest. */
function syncRig(): void {
  const id = RIFLE[state.reticle];
  const key = kitMode ? id : `${id}|${state.aid}|${state.treeStyle}`;
  if (key === rigKey) return;
  rigKey = key;
  rig = rigFor(loadoutNow(), { lab: !kitMode });
  if (kitMode) {
    state.aid = rig.ranging === "kilo" ? "lrf" : "manual";
    state.treeStyle = rig.optic === "ebr" || rig.optic === "tremor" ? rig.optic : "pr2";
    vssStyle = rig.optic === "acss" ? "acss" : "pso";
    // The lab's mast meter is not kit: the Kestrel is.
    state.easy = false;
  }
  kilo.setRifle(rig.rifle);
  kilo.kind = rig.ranging === "plain" ? "plain" : "abs";
  if (hide.group.visible !== rig.hide) {
    hide.group.visible = rig.hide;
    // The surround is redrawn only when the view turns; the hide's walls change it now.
    wideDrawn = null;
  }
  shooting.setRifle(rig.rifle, rig.mag, rig.report);
  rifle.setKit({ can: rig.can, sleeve: rig.sleeve, weight: rig.muzzleKg > 0 && !rig.can, mag: rig.mag });
  state.yaw = clampArc(state.yaw);
  state.pitch = clampArcPitch(state.pitch);
  restDyn = new RestDynamics(rig.rest, state.yaw, state.pitch);
  restNow = { yaw: state.yaw, pitch: state.pitch, bagUnsettled: 0, resetting: false };
}
const windAtRifle: [number, number, number] = [0, 0, 0];
/** The wind on the rifle and the shooter at `t`: in the hide a fifth of its speed gets in, a twenty-fifth of its push. */
function updateWindLoad(t: number): void {
  const w = windAt(state.wind, eyePos.x, eyePos.y, eyePos.z, t, windAtRifle);
  const inside = rig.hide ? 0.2 : 1;
  windAtMuzzle = Math.hypot(w[0], w[1], w[2]) * inside;
  windLoad = state.sway ? dynamicPressure(w) * inside * inside : 0;
}
/** Glazes the frames afresh (or takes them away); their shadows change, so the shadow map is redrawn. */
function glaze(): void {
  glass.set(state.glass === "off" ? null : state.glass, state.glassAngle);
  renderer.shadowMap.needsUpdate = true;
}
glaze();
const GLASS_NEXT = { off: "single", single: "double", double: "laminated", laminated: "tempered", tempered: "off" } as const satisfies Record<GlazingId | "off", GlazingId | "off">;

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
  retKey = "";
  wideDrawn = null;
}

let retKey = "";
/** The surround last drawn into wideLoRT, and where the naked eye was looking, so a still view can reuse it. */
let wideDrawn: THREE.WebGLRenderTarget | null = null;
const wideDrawnQ = new THREE.Quaternion();
/** Pixels per radian at the centre of a perspective view `px` pixels tall. */
const pxPerRad = (cam: THREE.PerspectiveCamera, px: number) => px / 2 / Math.tan(((cam.fov / 2) * Math.PI) / 180);

let kiloKey = "";
/** The rangefinder's OLED into the eyepiece overlay, whenever what it shows changes. */
function drawKilo(t: number): void {
  const ops = kilo.screen(t);
  const key = `${JSON.stringify(ops)}|${retCanvas.width}`;
  if (key === kiloKey) return;
  kiloKey = key;
  retKey = "";
  paintOled(retCtx, retCanvas.width, rasterOled(ops));
  retTex.needsUpdate = true;
}
function drawRet(): void {
  const key = `${state.reticle}|${state.treeStyle}|${vssStyle}|${state.mag.toFixed(3)}|${state.illum}|${retCanvas.width}`;
  if (key === retKey) return;
  retKey = key;
  kiloKey = "";
  const r = currentReticle();
  const S = retCanvas.width;
  retCtx.clearRect(0, 0, S, S);
  // FFP: units → canvas px grows with magnification. Canvas half-width ↔ tan(half apparent field).
  const pxPerUnit = ((S / 2) * state.mag * Math.tan(r.unitRad)) / tanHalfApparent(SCOPE);
  drawReticle(retCtx, r, S / 2, S / 2, pxPerUnit, "rgba(6,6,6,0.97)", state.illum ? r.illum : null);
  retTex.needsUpdate = true;
}

/**
 * Ceiling of `heightAt` at horizontal distance r: each fbm is below 1, so the swells stay under 7 + 0.8 m,
 * the hide adds at most 6 m, the hills raised for the targets their heights, and the far hills at most 0.08 m
 * per metre beyond 1.5 km.
 */
const terrainCeiling = (r: number) => 13.8 + terrainLift() + 0.08 * Math.max(0, r - 1500);
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
  return groundDistance(dir);
}
/** Distance along `dir` from the eye to the ground, or Infinity. */
function groundDistance(dir: THREE.Vector3): number {
  let d = 5;
  while (d < 9000) {
    const p = probe.copy(eyePos).addScaledVector(dir, d);
    // Above the ceiling the ground cannot be hit here, so the terrain need not be evaluated.
    if (p.y < terrainCeiling(Math.hypot(p.x, p.z)) && p.y < heightAt(p.x, p.z)) return d;
    d += Math.max(1, d * 0.01);
  }
  return Infinity;
}

/**
 * The Pro way: the shooter's handheld Sig KILO8K-ABS (src/scope/kilo.ts for the device, demo/reticle/kilo.ts for
 * its body, hands and screen). X brings it up from beside the rifle to the eye and puts it back. While it is up
 * the rifle cannot fire or be worked, Space is its RANGE button and M its MODE button, and the pointer turns it.
 * Its laser leaves along its own axis, hand shake and all, as a beam 1.25 × 0.25 mrad sampled by 21 rays; its
 * inclinometer reads that axis's slope. The device keeps its settings and its last reading while it is put down.
 */
type KiloPhase = "down" | "raising" | "up" | "lowering";
const kiloState = { phase: "down" as KiloPhase, since: -Infinity, yaw: 0, pitch: 0 };
const kiloRay = new THREE.Raycaster();
kiloRay.layers.enableAll();
const kiloDir = new THREE.Vector3();
const kiloEuler = new THREE.Euler(0, 0, 0, "YXZ");
let kiloShots = 0;
/** The device's orientation in the world at `t`: where it is turned, and the hand's shake. */
function kiloAimQ(t: number, out: THREE.Quaternion): THREE.Quaternion {
  const [sx, sy] = state.sway ? handShakeMrad(t) : [0, 0];
  return out.setFromEuler(kiloEuler.set(kiloState.pitch + sy / 1000, kiloState.yaw - sx / 1000, 0));
}
const kiloMeasQ = new THREE.Quaternion();
const kilo = new Kilo(RIFLES.bolt, () => {
  kiloAimQ(clock, kiloMeasQ);
  const solids = [range.boulder, ...range.targets.map((m) => m.group)];
  for (const o of solids) o.updateWorldMatrix(true, true);
  const rock = (o: THREE.Object3D | null): boolean => !!o && (o === range.boulder || rock(o.parent));
  const plain = kilo.kind === "plain";
  const hits: RayHit[] = (plain ? PLAIN_RAYS : BEAM_RAYS).map(([mx, my]) => {
    kiloDir
      .set(mx / 1000, my / 1000, -1)
      .normalize()
      .applyQuaternion(kiloMeasQ);
    kiloRay.set(eyePos, kiloDir);
    kiloRay.far = KILO8K.reachM.reflective;
    const h = kiloRay.intersectObjects(solids, true).find((x) => x.object.name !== "hole");
    const g = groundDistance(kiloDir);
    if (h && h.distance < g) return { m: h.distance, kind: rock(h.object) ? "rock" : "person" };
    return Number.isFinite(g) ? { m: g, kind: "ground" } : { m: Infinity, kind: "none" };
  });
  const m = plain ? pickReturn(hits, PLAIN_LRF.target, PLAIN_LRF.reachM) : pickReturn(hits, kilo.settings.target);
  kiloDir.set(0, 0, -1).applyQuaternion(kiloMeasQ);
  const slopeRad = Math.asin(Math.max(-1, Math.min(1, kiloDir.y)));
  return { losM: m === null ? null : m + (plain ? PLAIN_LRF.sigmaM : rangeSigmaM(m)) * shotRandom(1000 + kiloShots++)(), slopeRad };
});
/** Its settings from the URL, for stills: `kilomode=first|best|last|xr|fog`, `kiloret=circle|duplex|box|h-grid|grid`, `kilowind=<mph>,<clock>`. */
{
  const tm = params.get("kilomode")?.toUpperCase();
  if (tm && ["FIRST", "BEST", "LAST", "XR", "FOG"].includes(tm)) kilo.settings.target = tm as TargetMode;
  const kr = params.get("kiloret")?.toUpperCase();
  if (kr && ["CIRCLE", "DUPLEX", "BOX", "H-GRID", "GRID"].includes(kr)) kilo.settings.reticle = kr as KiloReticle;
  const [mph, clk] = (params.get("kilowind") ?? "").split(",").filter(Boolean).map(Number);
  if (mph !== undefined && Number.isFinite(mph)) kilo.settings.wind.mph = Math.max(0, Math.min(30, Math.round(mph)));
  if (clk !== undefined && Number.isFinite(clk)) kilo.settings.wind.clock = ((Math.round(clk) + 11) % 12) + 1;
}
/** A rangefinder in the kit (in the lab without a kit, the bolt rifle's Pro button). */
const kiloReady = () => rig.ranging !== "none";
/** X: up from the ground to the eye, or back down. The head comes up off the scope first. */
function toggleKilo(): void {
  if (kiloState.phase === "down") {
    if (!kiloReady() || shooting.busy()) return;
    if (adsIn) toggleScope();
    // It comes up looking where the head does.
    kiloState.yaw = state.yaw;
    kiloState.pitch = state.pitch;
    kiloState.phase = "raising";
    kiloState.since = clock;
  } else if (kiloState.phase === "up") {
    kilo.release("range", clock);
    kilo.release("mode", clock);
    kiloState.phase = "lowering";
    kiloState.since = clock;
  }
  syncUi();
}

const $ = (id: string) => document.getElementById(id)!;
const magIn = $("mag") as HTMLInputElement;
const parIn = $("par") as HTMLInputElement;
const exIn = $("ex") as HTMLInputElement;
const eyIn = $("ey") as HTMLInputElement;
const ezIn = $("ez") as HTMLInputElement;
const panIn = $("pan") as HTMLInputElement;

// Parallax dial: 50 m … 1500 m on a log scale, then ∞ at the stop.
const parToSlider = (m: number) => (Number.isFinite(m) ? (Math.log(m / 50) / Math.log(30)) * 100 : 105);
const sliderToPar = (v: number) => (v > 101 ? Infinity : 50 * Math.pow(30, v / 100));

/**
 * The bolt rifle's elevation card, for the manual way (the rangefinder needs none). Speed Drop: elevation in mil
 * over the 100 m zero = range in hundreds − the factor, worked out once from the load's come-ups (aids.ts), true to
 * 0.2 mil inside its band. Past the band the shooter goes back to his come-ups, so the card carries those rows, as
 * real cards do. In the margin what a real card keeps: the mil-to-cm relation at 100 m (the shooter scales it to
 * range), the click value, and the slope rule. The rule multiplies the solution, not the range: the elevation for
 * the slant range × the cosine read off the ACI, which holds up on steep, long shots where the classic rifleman's
 * rule (range × cosine) falls low. Wind is on the wind card.
 */
const dope = $("dope");
let dopeFor = "";
/** Signed hold off a chevron: ▼ below it, ▲ above, "on" within half a tenth. */
const offChevron = (c: number) => (Math.abs(c) < 0.05 ? "on" : `${c > 0 ? "▼" : "▲"}${Math.abs(c).toFixed(1)}`);
/**
 * The card for the rifle as loaded (src/scope/cards.ts), worked out from the load in the magazine:
 *  - the bolt rifle, the manual way: its Speed Drop card, or, for a load with no useful band (the subsonic one),
 *    a card of come-ups;
 *  - a reticle cut for another load than the one in the rifle (the PSO's chevrons, the ACSS's): a load card, how
 *    far below or above each chevron to hold, with the drum on 1.
 */
function syncDope(): void {
  const ret = currentReticle();
  const rf = rig.rifle;
  const r = ROUNDS[rf.round];
  const kind = state.reticle === "tree" ? (state.aid === "manual" ? "drop" : null) : rf.round !== ret.round ? "load" : null;
  const key = `${kind}|${rf.round}|${ret.name}`;
  if (key === dopeFor) return;
  dopeFor = key;
  dope.innerHTML = "";
  if (kind === "drop") {
    const sd = speedDrop(rf);
    const elev = (d: number) => comeUps(rf, [d])[0]!.mil.toFixed(1);
    if (sd.maxM - sd.minM >= 150) {
      const far = [500, 600, 700, 800, 900, 1000].filter((d) => d > sd.maxM);
      dope.innerHTML =
        `<div class="dope-head"><b>SPEED DROP</b> ${r.name} · ${r.bulletGr} gr<span>zero ${BATTLE_ZERO_M} m · mil</span></div>` +
        `<div class="sd"><span class="sd-n">${sd.factor.toFixed(1)}</span><span>elevation = range in hundreds − ${sd.factor.toFixed(1)}<br>good ${Math.ceil(sd.minM / 10) * 10}–${Math.floor(sd.maxM / 10) * 10} m, within ${sd.tolMil} mil</span></div>` +
        `<table><tr><th>past</th>${far.map((d) => `<td>${d}</td>`).join("")}</tr><tr><th>mil</th>${far.map((d) => `<td>${elev(d)}</td>`).join("")}</tr></table>` +
        `<div class="card-note">1 mil = 10 cm at 100 m · 1 click = 0.1 mil<br>Up or downhill: elevation for the slant range × the ACI's cosine</div>`;
    } else {
      // A slow load's drop grows too fast for one factor: the card is its come-ups, every 25 m.
      const rows = [125, 150, 175, 200, 225, 250, 275, 300];
      dope.innerHTML =
        `<div class="dope-head"><b>COME-UPS</b> ${r.name}<span>zero ${BATTLE_ZERO_M} m · mil</span></div>` +
        `<table><tr><th>m</th>${rows.slice(0, 4).map((d) => `<td>${d}</td>`).join("")}</tr><tr><th>mil</th>${rows.slice(0, 4).map((d) => `<td>${elev(d)}</td>`).join("")}</tr>` +
        `<tr><th>m</th>${rows.slice(4).map((d) => `<td>${d}</td>`).join("")}</tr><tr><th>mil</th>${rows.slice(4).map((d) => `<td>${elev(d)}</td>`).join("")}</tr></table>` +
        `<div class="card-note">No Speed Drop factor holds for this load: range it closely.<br>1 click = 0.1 mil · up or downhill: × the ACI's cosine</div>`;
    }
  } else if (kind === "load") {
    const ranges = vssStyle === "acss" && state.reticle === "vss" ? ACSS_RANGES : state.reticle === "vss" ? VSS_CHEVRON_RANGES : PSO_CHEVRON_RANGES;
    const rows = loadCard(rf, ret.round, ranges, ret.unitRad);
    if (loadCardNeeded(rows)) {
      const unit = ret.unitName === "mrad" ? "mil" : "thousandths";
      dope.innerHTML =
        `<div class="dope-head"><b>LOAD CARD</b> ${r.name}<span>${ret.name} cut for ${ROUNDS[ret.round].name} · ${unit}</span></div>` +
        `<table><tr><th>chevron</th>${rows.map((x) => `<td>${x.rangeM}</td>`).join("")}</tr><tr><th>hold</th>${rows.map((x) => `<td>${offChevron(x.corr)}</td>`).join("")}</tr></table>` +
        `<div class="card-note">▼ hold that far below the chevron, ▲ above it.<br>With the drum on 1: its marks are cut for ${ROUNDS[ret.round].name} too.</div>`;
    } else dope.innerHTML = `<div class="dope-head"><b>LOAD CARD</b> ${r.name}<span>flies as ${ROUNDS[ret.round].name}: every chevron holds</span></div>`;
  }
  dope.hidden = !dope.innerHTML;
}

/**
 * Wind card: how far to hold into the wind for what the flags show, at a few ranges, in the reticle's own
 * units. No wind speeds on it: the shooter reads the flags, not a number. The holds are the solver's, for a
 * full-value crosswind as a flag at 3 m reads it, rounded to the quarter mark a shooter can hold.
 */
const CARD_FLAGS = [20, 45, 70, 90];
const CARD_RANGES = { pso: [200, 400, 600, 800], tree: [200, 400, 600, 800], vss: [100, 200, 300] } as const satisfies Record<Reticle["id"], readonly number[]>;
const windCard = $("windcard");
let windCardFor = "";
const quarters = (h: number) => {
  const q = Math.round(h * 4);
  if (q === 0) return "0";
  const whole = Math.floor(q / 4);
  const part = ["", "¼", "½", "¾"][q % 4]!;
  return `${whole || ""}${part}` || "0";
};
const flagIcon = (deg: number) => {
  const a = (Math.min(88, deg) * Math.PI) / 180;
  // The fly streams out at `deg` from the pole: hoist 5 px, fly 11 px.
  const p = (along: number, down: number) => `${(4 + along * Math.sin(a)).toFixed(1)},${(2 + down + along * Math.cos(a)).toFixed(1)}`;
  return (
    `<svg width="22" height="20" viewBox="0 0 22 20"><line x1="4" y1="1" x2="4" y2="20" stroke="currentColor" stroke-width="1.2"/>` +
    `<polygon points="${p(0, 0)} ${p(11, 0)} ${p(11, 5)} ${p(0, 5)}" fill="#f0552a"/></svg>`
  );
};
function syncWindCard(): void {
  const ret = currentReticle();
  const round = rig.rifle.round;
  const key = `${state.reticle}|${state.easy}|${round}|${ret.name}`;
  if (key === windCardFor) return;
  windCardFor = key;
  // Short loads (the subsonic ones) are on the VSS's ranges.
  const ranges = ROUNDS[round].mv < 330 ? CARD_RANGES.vss : CARD_RANGES[state.reticle];
  const drift = crossDriftPerMs(ROUNDS[round], ranges);
  const unit = ret.unitName === "mrad" ? "mil" : "thousandths";
  // The grid's wind dots: what one is worth for this load, on a few rows.
  const dots = ret.name === "TReMoR3" ? dotValues(rig.rifle, TREMOR_ROWS.filter((k) => k % 2 === 0 && k <= 10)) : [];
  windCard.innerHTML =
    `<div class="dope-head"><b>WIND</b> ${RIFLES[RIFLE[state.reticle]].name} · ${ROUNDS[round].name}<span>${unit} into the wind</span></div>` +
    `<table><tr><th>flag</th>${CARD_FLAGS.map((d) => `<td>${flagIcon(d)}</td>`).join("")}</tr>` +
    // Easy: what the meter reads for each flag, to go from its number to a column.
    (state.easy ? `<tr class="card-sub"><th>m/s</th>${CARD_FLAGS.map((d) => `<td>${d >= 90 ? 10 : Math.round(d / FLAG_DEG_PER_MS)}</td>`).join("")}</tr>` : "") +
    ranges.map((r, i) => `<tr><th>${r} m</th>${CARD_FLAGS.map((d) => `<td>${quarters(((d >= 90 ? 10 : d / FLAG_DEG_PER_MS) * drift[i]!) / r / ret.unitRad)}</td>`).join("")}</tr>`).join("") +
    `</table>` +
    (dots.length ? `<table><tr><th>grid row</th>${dots.map((d) => `<td>${d.row}</td>`).join("")}</tr><tr><th>1 dot, m/s</th>${dots.map((d) => `<td>${d.msPerDot.toFixed(1)}</td>`).join("")}</tr></table>` : "") +
    `<div class="card-note">From 10–11 or 1–2 o'clock: half. From 12 or 6: none.<br>Read the near flags first: the first third of the way counts most.</div>`;
}

const windIn = $("wind") as HTMLInputElement;
const windDirIn = $("winddir") as HTMLInputElement;
windIn.oninput = () => (state.wind.speed = Number(windIn.value));
windDirIn.oninput = () => {
  state.wind.fromClock = Number(windDirIn.value);
  // Wakes point downwind: bake them again once the dial has stopped moving.
  shelterDue = performance.now() + 250;
};
const glassAngleIn = $("glassangle") as HTMLInputElement;
glassAngleIn.oninput = () => {
  state.glassAngle = Number(glassAngleIn.value);
  glaze();
};
$("glass").onclick = () => {
  state.glass = GLASS_NEXT[state.glass];
  glaze();
  syncUi();
};
$("pane").onclick = () => glaze();

/**
 * The elevation dial on top of the scope (see drum.ts), engraved on the 3D rifle. Each rifle keeps its own dial
 * where it was left; turning it moves the bore against the scope: a range drum moves the zero, and with it every
 * chevron; the mil turret moves the impact 0.1 mil a click. With the head up the shooter looks down at it and
 * turns it by hand; on the weld `[` and `]` click it by feel (with Shift, a whole mil of clicks at once).
 */
const drumRifle = () => RIFLES[RIFLE[state.reticle]];
const drum = createDrum((i) => {
  sound.unlock();
  sound.drumClick();
  state.dial[state.reticle] = i;
  syncUi();
});
let drumShown = "";
function syncDrum(): void {
  const r = drumRifle();
  if (drumShown !== r.id) {
    drumShown = r.id;
    drum.set(dialDetents(r.dial), state.dial[state.reticle]);
    rifle.setDrumMarks(r.dial);
  }
  // The rifle as loaded: a range drum's marks are cut for the issued load, the 100 m zero is the load's own.
  shooting.setTilt(dialTiltLoaded(rig.rifle, rig.issuedRound, state.dial[state.reticle]));
}

function syncUi(): void {
  syncRig();
  syncDrum();
  syncDope();
  sound.enabled = state.sound;
  windIn.value = String(state.wind.speed);
  windDirIn.value = String(state.wind.fromClock);
  glassAngleIn.value = String(state.glassAngle);
  $("glass").textContent = `Glass · ${state.glass}`;
  $("glass").classList.toggle("on", state.glass !== "off");
  magIn.value = String(state.mag);
  parIn.value = String(parToSlider(state.parallax));
  exIn.value = String(state.eye.x);
  eyIn.value = String(state.eye.y);
  ezIn.value = String(state.eye.z);
  panIn.value = String(state.pan);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-ret]")) b.classList.toggle("on", b.dataset.ret === state.reticle);
  // With a kit the rangefinder, the reticle and the wind meter are what was packed.
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-aid], [data-tree], [data-flag=easy]")) b.disabled = kitMode;
  $("treestyle").hidden = state.reticle !== "tree";
  $("aid").hidden = state.reticle !== "tree";
  syncTarget();
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-aid]")) b.classList.toggle("on", b.dataset.aid === state.aid);
  // Off the bolt rifle or back to the manual way, the rangefinder goes back down at once.
  if (kiloState.phase !== "down" && !kiloReady()) kiloState.phase = "down";
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tree]")) b.classList.toggle("on", b.dataset.tree === state.treeStyle);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-flag]")) b.classList.toggle("on", state[b.dataset.flag as "illum"] as boolean);
  syncWindCard();
  $("scope").textContent = shooting.busy() ? "Hands on the action" : adsIn ? "Scope out · F" : "Scope in · F";
  rifle.setRifle(RIFLE[state.reticle]);
}
magIn.oninput = () => (state.mag = Number(magIn.value));
parIn.oninput = () => (state.parallax = sliderToPar(Number(parIn.value)));
exIn.oninput = () => (state.eye.x = Number(exIn.value));
eyIn.oninput = () => (state.eye.y = Number(eyIn.value));
ezIn.oninput = () => (state.eye.z = Number(ezIn.value));
panIn.oninput = () => (state.pan = Number(panIn.value));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-ret]"))
  b.onclick = () => {
    state.reticle = b.dataset.ret as Reticle["id"];
    syncUi();
  };
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-tree]"))
  b.onclick = () => {
    if (kitMode) return;
    state.treeStyle = b.dataset.tree as TreeStyle;
    syncUi();
  };
/**
 * The target inputs: they show and set where the current rifle's mannequin stands. Moving it raises new ground, so
 * Move reloads the lab with `far=` or `near=` set, keeping the rest of the URL and the rifle.
 */
const tRange = $("trange") as HTMLInputElement;
const tElev = $("telev") as HTMLInputElement;
function syncTarget(): void {
  const m = range.targets[HOME[state.reticle]]!;
  const chest = toT.set(m.foot.x, m.foot.y + CHEST_M, m.foot.z).sub(eyePos);
  if (document.activeElement !== tRange) tRange.value = String(Math.round(chest.length()));
  if (document.activeElement !== tElev) tElev.value = ((Math.asin(chest.y / chest.length()) * 180) / Math.PI).toFixed(1);
}
function moveTarget(): void {
  const r = Number(tRange.value);
  const e = Number(tElev.value);
  if (!(r > 0) || !Number.isFinite(e)) return;
  const q = new URLSearchParams(location.search);
  q.set(HOME[state.reticle] ? "near" : "far", `${Math.round(clampSpot(r, 50, 1500))},${clampSpot(e, -30, 30)}`);
  q.set("reticle", state.reticle);
  // The parallax was set for the old range; let it follow the new one.
  q.delete("par");
  location.search = q.toString();
}
$("tmove").onclick = moveTarget;
for (const el of [tRange, tElev]) el.addEventListener("keydown", (e) => e.key === "Enter" && moveTarget());
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-aid]"))
  b.onclick = () => {
    if (kitMode) return;
    state.aid = b.dataset.aid as AimAid;
    syncUi();
  };
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-flag]"))
  b.onclick = () => {
    const k = b.dataset.flag as "illum";
    if (kitMode && k === ("easy" as string)) return;
    state[k] = !state[k];
    syncUi();
  };
$("center").onclick = () => {
  state.eye.x = state.eye.y = 0;
  state.eye.z = 0;
  syncUi();
};

/**
 * Firing (see shooting.ts). The SVD, the bolt rifle behind the tree and the VSS kick differently. When the
 * motion has died away its lasting rise is folded into the aim, so the rifle stays where it ended up and the
 * shooter has to drag it back down.
 */
let recoil: { start: number; spec: RecoilSpec; v: ShotVariation } | null = null;
/** How fast the squeeze bag is moving the muzzle now (rad/s, up +), and its most (0.6 mrad a second). */
let bagRate = 0;
const BAG_RATE = 0.0006;
let shots = 0;
let clock = 0;
const REST: RecoilState = { pitch: 0, yaw: 0, tiltPitch: 0, tiltYaw: 0, eye: { x: 0, y: 0, z: 0 } };
/** A frame stands for a 1/60 s exposure: recoil moves far enough within one to smear. */
const EXPOSURE = 1 / 60;
function foldRecoil(r: RecoilState): void {
  const pitch = Math.max(-0.3, Math.min(0.3, state.pitch + r.pitch));
  // The head and the rest come along, so folding the rise into the aim is not a swing.
  panHead.pitch += pitch - state.pitch;
  panHead.yaw -= r.yaw;
  restDyn.shift(-r.yaw, pitch - state.pitch);
  state.pitch = pitch;
  state.yaw -= r.yaw; // three.js yaw is positive to the left
}
/**
 * The hold (src/scope/hold.ts): breathing, wander, heartbeat and tremor as the rest and the kit allow, and the wind
 * buffeting the rifle. Object-space radians: [yaw, pitch].
 */
function swayAt(t: number): [number, number] {
  return state.sway ? holdAt(rig.hold, t, windLoad) : [0, 0];
}
/** The hands working the action: offsets to the aim (see shooting.act). */
let hand: { yaw: number; pitch: number } | null = null;
/** Where the bore points at time t: the rifle on its rest, sway, the hands on the action and any recoil still running. */
function aimAt(t: number): Aim {
  const [sy, sp] = swayAt(t);
  const rc = recoil ? recoilAt(recoil.spec, recoil.v, t - recoil.start) : REST;
  return { yaw: restNow.yaw + sy - rc.yaw - (hand?.yaw ?? 0), pitch: restNow.pitch + sp + rc.pitch + (hand?.pitch ?? 0) };
}
function fire(): void {
  if (kiloState.phase !== "down") return;
  const exit = shooting.press(clock, eyePos, aimAt, state.wind);
  syncUi();
  if (exit === null) return;
  // A second shot before the first settles starts from wherever the rifle is when the bullet leaves.
  if (recoil) foldRecoil(recoilAt(recoil.spec, recoil.v, exit - recoil.start));
  recoil = { start: exit, spec: rig.recoil, v: shotVariation(shots++, rig.fit.holdSpread) };
}
$("fire").onclick = () => fire();
/**
 * B works the action (the bolt, or the charging handle), R changes the magazine, C flicks the safety: whenever
 * asked, needed or not, and only what the real rifle does.
 */
function work(kind: "cycle" | "reload"): void {
  if (kiloState.phase !== "down" || !shooting.work(clock, kind)) return;
  // The hands leave the grip, and the head comes up off the scope with them.
  if (adsIn) toggleScope();
  syncUi();
}
$("bolt").onclick = () => work("cycle");
$("reload").onclick = () => work("reload");
/** The safety needs a hand on the rifle: not while both hands hold the rangefinder. */
function safety(): void {
  if (kiloState.phase === "down") shooting.safety();
}
$("safety").onclick = () => safety();

/**
 * Scope-in and scope-out (see src/scope/ads.ts). The rifle stays on its bipod and the head moves: down onto
 * the cheek weld until the eye finds the exit pupil, or up to look over the scope with the naked eye.
 * `adapt` is how far the eye has adapted to the picture in the glass (1) rather than the open range (0):
 * it sets exposure and how blurred the surroundings look, and lags the head like real light adaptation.
 */
let ads: AdsMotion | null = null;
let adsIn = !params.has("out");
let adsMoves = 0;
let headRest: Vec3 = adsIn ? { ...ON_WELD } : { ...HEAD_UP };
let adapt = adsIn ? 1 : 0;
function headAt(t: number): Vec3 {
  return ads ? adsEye(ads, t) : headRest;
}
function toggleScope(): void {
  // No settling back onto the scope while the hands are on the action or the rangefinder.
  if (!adsIn && (shooting.busy() || kiloState.phase !== "down")) return;
  const from = headAt(clock);
  const vel = ads ? adsVelocity(ads, clock) : { x: 0, y: 0, z: 0 };
  adsIn = !adsIn;
  // A stock that fits brings the eye down closer to the exit pupil, and sooner.
  ads = adsIn ? planScopeIn(clock, from, vel, adsMoves++, rig.fit) : planScopeOut(clock, from, vel, adsMoves++);
  syncUi();
}
$("scope").onclick = () => toggleScope();

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
  const hit = picker.intersectObject(rifle.drum, true).find((h) => h.object.name === "drum");
  if (!hit) return null;
  const pxPerM = r.height / 2 / Math.tan((rifle.camera.fov * Math.PI) / 360) / hit.distance;
  // Which side of the drum's axis the pointer is on, as the shooter sees it.
  const axis = rifle.drum.getWorldPosition(new THREE.Vector3()).project(rifle.camera);
  return { dist: hit.distance, arcPx: (DRUM_R_MM / 1000) * drumStep(drumRifle().dial) * pxPerM, side: Math.sign(ndc.x - axis.x) };
}
/** Whether the pointer is on the angle indicator, with the head up: the eye then looks, and focuses, there. */
function pickAci(e: { clientX: number; clientY: number }): boolean {
  if (adsIn || shooting.busy()) return false;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  picker.setFromCamera(ndc, rifle.camera);
  return picker.intersectObject(rifle.aci, true).some((h) => h.object.name === "aci");
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
/** What the eye looks at with the head up: the drum or the angle indicator. */
let lookAt: "drum" | "aci" = "drum";
let lookUntil = -Infinity;
const focusPinned = params.has("focus") ? num("focus", 0.29) : 0;
const lookAway = () => {
  if (drumLook) lookUntil = clock + LOOK_HOLD;
  drumLook = false;
};
let drumDrag: { x: number; acc: number; moved: number; arcPx: number; side: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 2) {
    toggleScope();
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  const d = pickDrum(e);
  if (d) {
    drumDrag = { x: e.clientX, acc: 0, moved: 0, arcPx: d.arcPx, side: d.side };
    drumLook = true;
    lookAt = "drum";
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
const endDrumDrag = () => {
  // A tap without a drag clicks it once, toward the side that was tapped.
  if (drumDrag && drumDrag.moved < 4) drum.turn(drumDrag.side || 1);
  if (drumDrag) lookAway();
  drumDrag = null;
};
canvas.addEventListener("pointerup", (e) => {
  endDrumDrag();
  pointers.delete(e.pointerId);
  pinch = 0;
});
canvas.addEventListener("pointercancel", (e) => {
  if (drumDrag) lookAway();
  drumDrag = null;
  pointers.delete(e.pointerId);
  pinch = 0;
});
canvas.addEventListener("pointermove", (e) => {
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
  if (!pointers.size && e.pointerType === "mouse") {
    const d = pickDrum(e);
    const a = !d && pickAci(e);
    if (d || a) {
      drumLook = true;
      lookAt = d ? "drum" : "aci";
    } else lookAway();
    canvas.style.cursor = d ? "ew-resize" : "";
  }
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  if (pointers.size === 1) {
    // One screen px of drag moves the view one apparent px: locked to the glass on the weld, to the
    // naked-eye view with the head up.
    const k = tanHalfApparent(SCOPE) / (1 + (state.mag - 1) * adapt) / (R / dpr);
    if (kiloState.phase === "up") {
      // Turning the rangefinder: one px moves its view one px (its field fills the same circle on screen).
      const kk = Math.tan((KILO8K.fovDeg * Math.PI) / 360) / (R / dpr);
      kiloState.yaw = clampArc(kiloState.yaw + (e.clientX - prev.x) * kk);
      kiloState.pitch = rig.arcRad === null ? Math.max(-0.4, Math.min(0.4, kiloState.pitch + (e.clientY - prev.y) * kk)) : clampArcPitch(kiloState.pitch + (e.clientY - prev.y) * kk);
    } else {
      state.yaw = clampArc(state.yaw + (e.clientX - prev.x) * k);
      state.pitch = clampArcPitch(state.pitch + (e.clientY - prev.y) * k);
    }
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
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (pickDrum(e)) {
      lookUntil = clock + LOOK_HOLD;
      lookAt = "drum";
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
  },
  { passive: false },
);
const clampMag = (m: number) => Math.max(SCOPE.minMag, Math.min(SCOPE.maxMag, m));
const keys = new Set<string>();
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  // The arrows squeeze the bag (in the frame loop), not scroll the page.
  if (e.code === "ArrowUp" || e.code === "ArrowDown") e.preventDefault();
  if (e.code === "KeyT") {
    state.reticle = ({ pso: "tree", tree: "vss", vss: "pso" } as const)[state.reticle];
    syncUi();
  }
  if (e.code === "KeyB" && !e.repeat) work("cycle");
  if (e.code === "KeyR" && !e.repeat) work("reload");
  if (e.code === "KeyC" && !e.repeat) safety();
  if (e.code === "KeyL") {
    state.illum = !state.illum;
    syncUi();
  }
  if (e.code === "KeyM" && kiloState.phase === "up") {
    // At the eye, M is the rangefinder's MODE button.
    if (!e.repeat) kilo.press("mode", clock);
  } else if (e.code === "KeyM" && state.reticle === "tree" && !kitMode) {
    state.aid = state.aid === "manual" ? "lrf" : "manual";
    syncUi();
  }
  if (e.code === "KeyX" && !e.repeat) toggleKilo();
  if (e.code === "KeyV" && state.reticle === "tree" && !kitMode) {
    state.treeStyle = ({ pr2: "ebr", ebr: "tremor", tremor: "pr2" } as const)[state.treeStyle];
    syncUi();
  }
  if (e.code === "KeyG") {
    state.glass = GLASS_NEXT[state.glass];
    glaze();
    syncUi();
  }
  if (e.code === "KeyH") document.body.classList.toggle("nohud");
  // The Kestrel's target range: , and . step it 25 m (with Shift, 100 m).
  if ((e.code === "Comma" || e.code === "Period") && rig.windMeter) {
    const step = (e.shiftKey ? 100 : 25) * (e.code === "Comma" ? -1 : 1);
    kestrel.rangeM = Math.max(50, Math.min(1500, kestrel.rangeM + step));
  }
  if (e.code === "KeyF" && !e.repeat) {
    if (kiloState.phase === "up") toggleKilo();
    else if (kiloState.phase === "down") toggleScope();
  }
  if ((e.code === "BracketLeft" || e.code === "BracketRight") && !shooting.busy()) {
    // Shift: a whole mil of clicks on the mil turret, turned in one go.
    const n = e.shiftKey && drumRifle().dial.kind === "mil" ? 10 : 1;
    drum.turn(e.code === "BracketLeft" ? -n : n);
    lookUntil = clock + LOOK_HOLD;
    lookAt = "drum";
  }
  if (e.code === "Space") {
    e.preventDefault();
    // At the eye, Space is the rangefinder's RANGE button (held, it scans).
    if (!e.repeat) kiloState.phase === "up" ? kilo.press("range", clock) : fire();
  }
});
addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (e.code === "Space") kilo.release("range", clock);
  if (e.code === "KeyM") kilo.release("mode", clock);
  // Space must not also click whichever panel button has focus.
  if (e.code === "Space") e.preventDefault();
});
for (const b of document.querySelectorAll("button")) b.addEventListener("click", () => b.blur());
addEventListener("resize", () => {
  if (!shot) location.reload();
});

/** Easy: a wind meter on a mast beside the hide, at the flags' height, so its reading goes straight onto the card. */
function windText(): string {
  const [x, , z] = windAt(state.wind, eyePos.x, heightAt(eyePos.x, eyePos.z) + WIND_REF_M, eyePos.z, clock, windTmp);
  const sp = Math.hypot(x, z);
  if (sp < 0.2) return "calm";
  // It blows toward (x, z); it comes from the opposite bearing, clockwise from downrange.
  let c = (Math.atan2(-x, z) * 6) / Math.PI;
  c = ((Math.round(c * 2) / 2 + 11.5) % 12) + 0.5;
  const h = Math.floor(c);
  return `${sp.toFixed(1)} m/s · from ${h === 0 ? 12 : h}${c % 1 ? ":30" : ""}`;
}
/**
 * The Kestrel 5700 Elite on its vane mount (kit `kestrel`), beside the shooter about a metre up: the wind where it
 * stands (in the hide, the hide's still air), averaged over a few seconds as shooters read it, and its Applied
 * Ballistics solver's wind hold for the loaded round at the range set on it (`,` and `.`), for the way the rifle
 * points. The hold is exact for that wind; the wind along the bullet's way is still the shooter's to judge.
 */
const kestrel = { rangeM: Math.round(Math.max(50, Math.min(1500, num("kestrel", 300)))), x: 0, z: 0, primed: false };
const KESTREL_UP_M = 1;
const kestrelTmp: [number, number, number] = [0, 0, 0];
function stepKestrel(t: number, dt: number): void {
  if (!rig.windMeter) {
    kestrel.primed = false;
    return;
  }
  const kx = eyePos.x + 0.6;
  const w = windAt(state.wind, kx, heightAt(kx, eyePos.z) + KESTREL_UP_M, eyePos.z, t, kestrelTmp);
  const inside = rig.hide ? 0.2 : 1;
  const a = shot || !kestrel.primed ? 1 : 1 - Math.exp(-dt / 3);
  kestrel.x += (w[0] * inside - kestrel.x) * a;
  kestrel.z += (w[2] * inside - kestrel.z) * a;
  kestrel.primed = true;
}
function kestrelText(): string {
  const { x, z, rangeM } = kestrel;
  const sp = Math.hypot(x, z);
  if (sp < 0.2) return `calm · ${rangeM} m: no hold`;
  // In the rifle's frame: across to the right, and back toward the shooter; the clock it blows from.
  const across = x * Math.cos(state.yaw) - z * Math.sin(state.yaw);
  const back = x * Math.sin(state.yaw) + z * Math.cos(state.yaw);
  const clockF = ((((Math.atan2(-across, back) * 6) / Math.PI) % 12) + 12) % 12;
  const hold = windHoldMil(rig.rifle, rangeM, sp, clockF);
  const c = Math.round(clockF * 2) / 2;
  const side = hold >= 0.05 ? " right" : hold <= -0.05 ? " left" : "";
  return `${sp.toFixed(1)} m/s from ${Math.floor(c) || 12}${c % 1 ? ":30" : ""} · ${rangeM} m: hold ${Math.abs(hold).toFixed(1)} mil${side}`;
}
const fmt = (m: number) => (Number.isFinite(m) ? `${Math.round(m)} m` : "∞");
/** The can's heat over the air, whether it is still cold enough to throw its first shot, and its sleeve. */
function canText(t: number): string {
  const can = shooting.can()!;
  const parts = [`+${Math.round(can.riseAt(t))} °C`];
  if (rig.report !== "integral" && can.coldness(t) > 0.5) parts.push("cold: first shot high");
  if (rig.sleeve) parts.push("sleeve");
  return parts.join(" · ");
}
const REST_NAMES = { lab: "bipod", pack: "pack", harris: "Harris bipod", atlas: "Atlas bipod", tripod: "tripod" } as const satisfies Record<Rig["restKind"], string>;
/** What the rifle rests on, and what the rest is doing: the legs re-set, the bag settling, the hide's frame reached. */
function restText(): string {
  const parts: string[] = [REST_NAMES[rig.restKind]];
  if (rig.bag) parts.push("squeeze bag");
  if (rig.hide) parts.push("hide");
  if (restNow.resetting) parts.push("re-setting");
  else if (restNow.bagUnsettled > 0.15) parts.push("bag settling");
  if (rig.arcRad !== null && (Math.abs(Math.abs(state.yaw - arcYaw) - rig.arcRad) < 1e-6 || Math.abs(Math.abs(state.pitch - arcPitch) - ARC_PITCH) < 1e-6)) parts.push("at the frame");
  return parts.join(" · ");
}
const readout = $("readout");
let lastReadout = 0;
const woundCard = $("wound");
let woundDrawn = -1;
/** The hit whose wound card the shooter closed. */
let woundClosed = -1;

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
  return toT
    .set(f.x, f.y + 1, f.z)
    .sub(eyePos)
    .angleTo(dir);
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
/** The rifle's orientation this frame, the rangefinder's in the world and in the rifle's frame. */
const rifleQ = new THREE.Quaternion();
const kiloQ = new THREE.Quaternion();
const kiloRel = new THREE.Quaternion();
const headQ = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, "YXZ");
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
  let hp = acted.pose;
  if (acted.fold) {
    state.yaw -= acted.fold[0];
    state.pitch += acted.fold[1];
    panHead.yaw -= acted.fold[0];
    panHead.pitch += acted.fold[1];
    restDyn.shift(-acted.fold[0], acted.fold[1]);
    syncUi();
  }
  // Head keys: WASD slide the eye across the exit pupil, Q/E change eye relief.
  const k = dt * 6;
  if (keys.has("KeyA")) state.eye.x -= k;
  if (keys.has("KeyD")) state.eye.x += k;
  if (keys.has("KeyW")) state.eye.y += k;
  if (keys.has("KeyS")) state.eye.y -= k;
  if (keys.has("KeyQ")) state.eye.z -= k * 3;
  if (keys.has("KeyE")) state.eye.z += k * 3;
  if (keys.size) syncUi();
  // The squeeze bag under the stock: squeeze it (↓) and the stock rises, so the muzzle dips; ease off (↑) and it
  // comes up. Elevation a hair at a time without touching the grip, the hand closing and opening over about 0.15 s.
  const squeeze = rig.bag && !acted.busy && kiloState.phase === "down" ? Number(keys.has("ArrowUp")) - Number(keys.has("ArrowDown")) : 0;
  bagRate += (squeeze * BAG_RATE - bagRate) * (1 - Math.exp(-dt / 0.15));
  if (Math.abs(bagRate) < 1e-7) bagRate = 0;
  if (bagRate) state.pitch = clampArcPitch(state.pitch + bagRate * dt);
  // The rifle on its rest follows the hands, as the rest lets it; the wind buffets the hold.
  updateWindLoad(t);
  stepKestrel(t, dt);
  restNow = restDyn.step(state.yaw, state.pitch, t, dt);
  const eye = { ...state.eye };
  if (state.drift) {
    // Even with a solid cheek weld the head wanders a fraction of a millimetre; less on a riser set to the eye.
    const wd = rig.fit.wander;
    eye.x += wd * (0.3 * Math.sin(t * 0.31) + 0.12 * Math.sin(t * 0.83 + 1));
    eye.y += wd * (0.22 * Math.sin(t * 0.27 + 2) + 0.1 * Math.sin(t * 0.71));
    eye.z += wd * 1.0 * Math.sin(t * 0.19 + 0.5);
  }
  eye.x += rc.eye.x;
  eye.y += rc.eye.y;
  eye.z += rc.eye.z;
  // How far a swing has carried the scope ahead of the head (up and right), and where that puts the eye.
  // The head follows the rifle as it moves on its rest: a jolt of the legs or a sagging bag shows here too.
  const lag = PAN_LAG * state.pan * rig.rest.panLag;
  panHead.yaw = followHead(panHead.yaw, restNow.yaw, dt, lag);
  panHead.pitch = followHead(panHead.pitch, restNow.pitch, dt, lag);
  const panPitch = restNow.pitch - panHead.pitch;
  const panYaw = panHead.yaw - restNow.yaw;
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
  const scopeShare = imageShare(eye, { x: Math.tan(tiltYaw), y: Math.tan(tiltPitch) });

  // Wobble: breathing and heartbeat, and the hands on the action.
  const [swYaw, swPitch] = swayAt(t);
  const yaw = restNow.yaw + swYaw - (hand?.yaw ?? 0);
  const pitch = restNow.pitch + swPitch + (hand?.pitch ?? 0);
  // The scope looks where the rifle points; the naked eye looks where the head points, which lags it.
  euler.set(pitch + rc.pitch, yaw - rc.yaw, 0);
  scopeCam.quaternion.setFromEuler(euler);
  // The head's view relative to the scope, which the rifle is drawn from too, so the two line up exactly.
  headQ.setFromEuler(euler.set(-tiltPitch, tiltYaw, 0));
  wideCam.quaternion.multiplyQuaternions(scopeCam.quaternion, headQ);
  rifleQ.copy(scopeCam.quaternion);
  // The rangefinder: where it and the hands are, and the eye going to it. At the eye the head looks down its axis,
  // and the magnified image is its own.
  if (kiloState.phase === "raising" && t - kiloState.since >= KILO_UP_S) kiloState.phase = "up";
  if (kiloState.phase === "lowering" && t - kiloState.since >= KILO_DOWN_S) kiloState.phase = "down";
  let kr: KiloRig | null = null;
  if (kiloState.phase !== "down") {
    kiloAimQ(t, kiloQ);
    kiloRel.copy(rifleQ).invert().multiply(kiloQ);
    const lowering = kiloState.phase === "lowering";
    kr = kiloRig(lowering ? t - kiloState.since : Math.min(KILO_UP_S, t - kiloState.since), lowering ? "down" : "up", { p: [eye.x, eye.y, eye.z], q: toQuat(kiloRel) }, hp.hands);
    hp = { ...hp, hands: kr.hands };
    headQ.slerp(kiloRel, kr.at);
    wideCam.quaternion.multiplyQuaternions(rifleQ, headQ);
    scopeCam.quaternion.copy(kiloQ);
  }
  rifle.kilo.group.visible = !!kr;
  // The eye in the rangefinder's frame (mm from its eye point), and the share of the view its image fills.
  const kiloEye = { x: 0, y: 0, z: 0, pupilMm: eye.pupilMm } as Eye;
  if (kr) {
    rifle.kilo.setPose(kr.device);
    const local = compose(invert(kr.device), { p: [eye.x, eye.y, eye.z], q: [0, 0, 0, 1] }).p;
    [kiloEye.x, kiloEye.y, kiloEye.z] = local;
  }
  kilo.update(t);
  if (!shot) stepAdapt(kr ? Math.max(0, Math.min(1, (kr.at - 0.85) / 0.15)) : scopeShare, dt);
  scopeCam.fov = kr ? KILO8K.fovDeg : (trueFovRad(SCOPE, state.mag) * 180) / Math.PI;
  scopeCam.updateProjectionMatrix();
  scopeCam.getWorldDirection(dir);
  watch(dir);

  const D = aimDistance(dir);
  const ep = kr ? KILO8K.objectiveMm / KILO8K.mag : exitPupilMm(SCOPE, state.mag);
  const th = tanHalfApparent(SCOPE);
  // The rangefinder's whole field is drawn in the same circle as the scope's: its 6.78° true field over the
  // circle's radius, so the screen shows it as this magnification.
  const optMag = kr ? th / Math.tan((KILO8K.fovDeg * Math.PI) / 360) : state.mag;
  const u = comp.uniforms;
  u.uTanHalf!.value = th;
  u.uMag!.value = optMag;
  u.uExitR!.value = ep / 2;
  u.uEye!.value.set(kr ? kiloEye.x : eye.x, kr ? kiloEye.y : eye.y, kr ? kiloEye.z : eye.z);
  u.uEyePupilR!.value = eye.pupilMm / 2;
  u.uSaep!.value = kr ? 1 : SCOPE.pupilAberrationMm;
  // Partial auto-exposure: a pupil-starved image is darker, but the eye/camera adapts some of it back.
  const centre = Math.min(ep / 2, eye.pupilMm / 2) ** 2 / (eye.pupilMm / 2) ** 2;
  u.uTnorm!.value = Math.sqrt(centre);
  const Dr = Number.isFinite(D) ? D : 1e9;
  // Reticle shift in canvas uv: object radians → apparent tan (×mag) → field-stop units (/th) → uv (×½).
  const toUv = (optMag / th) * 0.5;
  if (kr) {
    // The OLED sits in the eyepiece's focal plane: no parallax. Its objective is fixed-focus (taken at 250 m).
    u.uPar!.value.set(0, 0);
    u.uFocus!.value = (KILO8K.objectiveMm / 1000) * Math.abs(1 / Dr - 1 / 250) * 0.5 * toUv;
  } else {
    u.uPar!.value.set(parallaxShiftRad(SCOPE, state.mag, eye.x, Dr, state.parallax) * toUv, parallaxShiftRad(SCOPE, state.mag, eye.y, Dr, state.parallax) * toUv);
    // Focus: parallax knob is also focus. Blur circle = aperture · |1/D − 1/P|.
    const invP = Number.isFinite(state.parallax) ? 1 / state.parallax : 0;
    u.uFocus!.value = (SCOPE.objectiveMm / 1000) * Math.abs(1 / Dr - invP) * 0.5 * toUv;
  }
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
  if (kr) {
    // The rangefinder's axis as the head sees it; no recoil on it.
    const ax = qRot(compose(invert({ p: [0, 0, 0], q: toQuat(headQ) }), kr.device).q, [0, 0, -1]);
    u.uTilt!.value.set(ax[0] / -ax[2], ax[1] / -ax[2]);
    u.uSweep!.value.set(0, 0);
    u.uBlur!.value.set(0, 0);
    u.uEyeSweep!.value.set(0, 0, 0);
  }
  // Its OLED's light over the image, and its glass: a touch dim and blue (first generation), less pincushion.
  u.uRetAdd!.value = kr ? kilo.level() * 1.5 : 0;
  u.uTint!.value.set(...((kr ? [0.84, 0.9, 1.0] : [1, 1, 1]) as [number, number, number]));
  u.uDist!.value = kr ? 0.012 : 0.025;
  u.uCA!.value = kr ? 0.009 : 0.006;
  u.uRoll!.value = roll;
  u.uExposure!.value = 1 / (1 + 0.7 * (1 - adapt));
  // The eye focuses where it looks (accommodation takes a few tenths of a second): on the hands and the action
  // while it works them (the plan's gaze carries its own focus), on the drum while the shooter looks at it with
  // the head up, far away otherwise. Focused near, the range blurs by pupil / distance.
  // The drum's rear face is 253 mm ahead of the exit pupil and 30 mm up, in the scope's frame.
  const lookMm = lookAt === "aci" ? rifle.aciMm : null;
  const drumDist = lookMm ? Math.hypot(eye.x - lookMm.x, eye.y - lookMm.y, eye.z - lookMm.z) / 1000 : Math.hypot(eye.x, eye.y - 30, eye.z + 253) / 1000;
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
  // A hot can's plume rising through the line of sight; not in the rangefinder, held up clear of it.
  const can = shooting.can();
  u.uHaze!.value = can && !kr && state.mirage ? can.hazeRad(t, windAtMuzzle, rig.sleeve) * toUv : 0;
  // The plume rises at about half a metre a second, a few of the shader's swells a second at the objective.
  hazeT = shot ? 2.5 * t : hazeT + 2.5 * dt;
  u.uHazeT!.value = hazeT;
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
  rifle.setLight(sunLocal.copy(toSun).applyQuaternion(rifleFrame.copy(rifleQ).invert()));
  drum.step(shot ? 1 : dt);
  {
    const dial = drumRifle().dial;
    const turned = drum.pos - drumHome(dial);
    // The mil turret climbs its thread a turn at a time; the lift is the turn it is on.
    rifle.setDrum(turned * drumStep(dial), dial.kind === "mil" ? (turned / dial.clicksPerRev) * TURN_LIFT_MM : 0);
  }
  // The angle indicator's pendulum hangs true, so its needle shows the bore's slope.
  rifle.setSlope(pitch);
  // Blur radius of a point 1 m away in half-res px: half the eye pupil over the distance, as apparent tan.
  const kNear = ((0.5 * (eye.pupilMm / 1000)) / th) * (R / 2);
  // The eyepiece's sweep across the view during one exposure, for the smear.
  const ocular = (e: Vec3, r: RecoilState) => {
    const d = SCOPE.eyeReliefMm + e.z + r.eye.z;
    return [Math.tan(r.tiltYaw) - (e.x + r.eye.x) / d, Math.tan(r.tiltPitch) - (e.y + r.eye.y) / d];
  };
  const [ax, ay] = ocular(adsA, rcA);
  const [bx, by] = ocular(adsB, rcB);
  nearVel.set(kr ? 0 : ((bx! - ax!) / th) * (R / 2), kr ? 0 : ((by! - ay!) / th) * (R / 2));
  near.render(kNear, nearVel, shot ? 0 : (t * 60) % 97, focusInv);

  if (kr) drawKilo(t);
  else drawRet();
  // The magnified image only reaches the screen through the eyebox. When no direction in the field can send
  // light into the eye pupil, the composite multiplies the image by exactly zero, so skip rendering it.
  if (!eyeboxDark(kr ? kiloEye : eye, u.uEyeSweep!.value, ep / 2, eye.pupilMm / 2, th)) {
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
    const ret = currentReticle();
    const tf = trueFovRad(SCOPE, state.mag);
    const par = parallaxShiftRad(SCOPE, state.mag, Math.hypot(eye.x, eye.y), Dr, state.parallax) / ret.unitRad;
    const fig = 1.7 / range.targets[watched]!.range / ret.unitRad;
    const unit = unitShort(ret);
    const status = shooting.status(t);
    readout.innerHTML = [
      [
        "Head",
        kiloState.phase === "up"
          ? "up · rangefinder at the eye"
          : kiloState.phase === "raising"
            ? "up · bringing the rangefinder up"
            : kiloState.phase === "lowering"
              ? "up · putting the rangefinder down"
              : acted.busy
                ? "up · hands on the action"
                : ads
                  ? ads.dir === "in"
                    ? "going down"
                    : "coming up"
                  : adsIn
                    ? "on the weld"
                    : "up",
      ],
      ["Magnification", `${state.mag.toFixed(1)}×`],
      ["True field", `${((tf * 180) / Math.PI).toFixed(2)}° · ${(tf * 1000).toFixed(0)} mil`],
      ["Exit pupil", `${ep.toFixed(1)} mm`],
      ["Parallax set", fmt(state.parallax)],
      // A range drum's number is the zero (1 is 100 m, where the cut reticles are true); the turret's is mils over the 100 m zero.
      ((dial) =>
        dial.kind === "range"
          ? ["Zero", `${dialReading(dial, state.dial[state.reticle])} m · drum ${dialReading(dial, state.dial[state.reticle]) / 100}`]
          : ["Turret", `${dialReading(dial, state.dial[state.reticle]).toFixed(1)} mil up · zero ${BATTLE_ZERO_M} m`])(drumRifle().dial),
      ["Round", `${ROUNDS[rig.rifle.round].name} · ${ROUNDS[rig.rifle.round].cartridge}`],
      ["Rounds", status.state ? `${status.rounds} · ${status.state}` : status.rounds],
      ["Rest", restText()],
      ...(shooting.can() ? [["Suppressor", canText(t)]] : []),
      ...(kitMode ? [["Kit", `${encodeKit(rig.loadout).replaceAll(",", ", ") || "issued"} · pay ×${payFactor(rig.loadout).toFixed(2)}`]] : []),
      ...(state.easy ? [["Wind meter", windText()]] : []),
      ...(rig.windMeter ? [["Kestrel", kestrelText()]] : []),
      ...(state.glass !== "off" ? [["Glass", `${GLAZING[state.glass].name} · ${state.glassAngle ? `${Math.abs(state.glassAngle)}° ${state.glassAngle > 0 ? "right" : "left"}` : "square-on"}`]] : []),
      ["Last shot", status.shot],
      ["Aim point", fmt(D)],
      ["Parallax error", `${Math.abs(par).toFixed(2)} ${unit}`],
      ["Target 1.7 m", `${fig.toFixed(2)} ${unit}`],
    ]
      .map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`)
      .join("");
    const w = status.wound;
    woundCard.hidden = !w || w.n === woundClosed;
    if (w) {
      $("wound-text").innerHTML = woundText(w.wound, w.speed, w.since, w.glass);
      const closeBtn = document.createElement("button");
      closeBtn.innerText = "×";
      closeBtn.className = "close-btn";
      closeBtn.onclick = () => {
        // Stays closed until the next hit.
        woundClosed = w.n;
        woundCard.hidden = true;
      };
      $("wound-text").appendChild(closeBtn);

      if (woundDrawn !== w.n) {
        $("wound-svg").innerHTML = woundSvg(w.wound);
        woundDrawn = w.n;
      }
    }
  }
}

layout();
syncUi();
if (shot) {
  // Deterministic still: fixed clock, a couple of frames so shadows and MSAA settle.
  const t = num("t", 2.4);
  // recoil=<s>: the still is taken that long after the trigger.
  if (params.has("recoil")) recoil = { start: t - num("recoil", 0), spec: rig.recoil, v: shotVariation(0, rig.fit.holdSpread) };
  // canheat=<K>: the suppressor that much over the air, as after a string of shots.
  if (params.has("canheat")) shooting.can()?.warm(t - 0.5, num("canheat", 60));
  updateWindLoad(t);
  // fire=<s>: the still is taken that long after the bullet left the muzzle (recoil and all).
  if (params.has("fire")) {
    const exit = t - num("fire", 0);
    shooting.fireAt(exit, eyePos, aimAt(exit), state.wind);
    // norecoil: keep the rifle still, to look at the impact.
    if (!params.has("norecoil")) recoil = { start: exit, spec: rig.recoil, v: shotVariation(0, rig.fit.holdSpread) };
  }
  // panrate=<right>,<up> (deg/s): the still is taken mid-swing, with the head trailing as it would.
  if (params.has("panrate")) {
    const [right = 0, up = 0] = params.get("panrate")!.split(",").map(Number);
    const lag = PAN_LAG * state.pan * rig.rest.panLag;
    panHead.yaw = state.yaw + ((right * Math.PI) / 180) * lag;
    panHead.pitch = state.pitch - ((up * Math.PI) / 180) * lag;
  }
  // act=<s> / reload=<s>: the still is taken that long after the hands start working the bolt (a magazine
  // change on the SVD and VSS) or changing the magazine; the head comes up off the weld as they start.
  const handStart = params.has("act") ? t - num("act", 0) : params.has("reload") ? t - num("reload", 0) : null;
  if (handStart !== null) shooting.handleAt(handStart, params.has("reload"));
  // adsin=<s> / adsout=<s>: the still is taken that long after the head starts down / up.
  for (const [k, inward] of [
    ["adsin", true],
    ["adsout", false],
  ] as const) {
    if (!params.has(k) && !(k === "adsout" && handStart !== null)) continue;
    const start = k === "adsout" && handStart !== null ? handStart : t - num(k, 0);
    headRest = inward ? { ...HEAD_UP } : { ...ON_WELD };
    adsIn = inward;
    ads = inward ? planScopeIn(start, headRest, { x: 0, y: 0, z: 0 }, 0, rig.fit) : planScopeOut(start, headRest, { x: 0, y: 0, z: 0 }, 0);
    // Replay the eye's adaptation from well before the move.
    adapt = inward ? 0 : 1;
    for (let u = start - 0.5; u < t; u += 1 / 240) {
      const e = { ...state.eye, ...(u < start ? headRest : adsEye(ads, u)) } as Eye;
      e.pupilMm = state.eye.pupilMm;
      stepAdapt(imageShare(e, { x: 0, y: 0 }), 1 / 240);
    }
  }
  // Stills: `ranged` presses the rangefinder once the range is built.
  // kilo=up: the rangefinder at the eye; kiloat=<s>: that long into bringing it up. ranged=<s>: woken, then ranged
  // that long before the still (default 3 s, after the status lines have gone).
  if (params.has("kilo") || params.has("kiloat")) {
    adsIn = false;
    headRest = { ...HEAD_UP };
    adapt = params.has("kiloat") ? 0 : 1;
    kiloState.yaw = state.yaw;
    kiloState.pitch = state.pitch;
    kiloState.phase = "raising";
    kiloState.since = t - (params.has("kiloat") ? num("kiloat", 0.6) : 5);
  }
  if (params.has("ranged")) {
    const r = t - num("ranged", 3) - KILO8K.responseS;
    kilo.press("range", r - 2.5);
    kilo.release("range", r - 2.4);
    kilo.press("range", r);
    kilo.release("range", r + 0.1);
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
