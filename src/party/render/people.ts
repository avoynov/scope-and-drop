/**
 * Milestone 5 spike: real 3D people (MPFB 2 / MakeHuman meshes) in place of the jointed
 * block figures, for the guests whose outfit has a model so far.
 *
 * Each model is one GLB (tools/people/): a 53-bone skeleton (MPFB's "game_engine" rig) and three
 * skinned meshes on it, `guest_lod0` (about 20k triangles), `guest_lod1` (about 5.5k) and
 * `guest_lod2` (about 1.5k). The level shown is picked by the person's height on screen, so
 * the swap happens where the simpler mesh differs by under a pixel or so.
 *
 * Poses are procedural placeholders until the mocap clips exist: the limbs are aimed in model
 * space from the sim's pose and the clock, so the same state always draws the same picture.
 * A person off screen is neither posed nor drawn.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import type { ScopedLighting } from "../../mansion/build/lighting";
import type { Outfit, Person, Sex } from "../types";
import type { FrameState } from "./crowd";

/** A model per outfit drawn in 3D so far; the rest keep the block figures. */
export type ModelId = "m-dinner" | "f-dress";
const MODEL_FOR: Partial<Record<`${Sex}:${Outfit}`, ModelId>> = {
  "m:dinner-jacket": "m-dinner",
  "m:suit": "m-dinner",
  "m:tails": "m-dinner",
  "f:short-dress": "f-dress",
};

/** Height (m) of each model as built: the figure is scaled to the person's own height. */
const MODEL_HEIGHT: Record<ModelId, number> = {
  "m-dinner": 1.78,
  "f-dress": 1.66,
};

/** Screen height (px) above which each level is shown: LOD0 over 300 px, LOD1 over 120 px. */
export const LOD_PX = [300, 120] as const;
/** A level changes only when the size is this far past its threshold, so it doesn't flicker. */
const HYSTERESIS = 0.08;

/** Materials that are cut-outs (hair cards, brows, lashes): alpha-tested, never blended. */
const CUTOUT = /eyebrow|eyelash|hair|short0|bob0|long0/i;
/** Hair materials, tinted to the person's hair colour. */
const HAIR = /hair|short0|bob0|long0/i;

const BONES = [
  "Root",
  "pelvis",
  "spine_01",
  "spine_02",
  "spine_03",
  "neck_01",
  "head",
  "clavicle_l",
  "upperarm_l",
  "lowerarm_l",
  "hand_l",
  "clavicle_r",
  "upperarm_r",
  "lowerarm_r",
  "hand_r",
  "thigh_l",
  "calf_l",
  "foot_l",
  "thigh_r",
  "calf_r",
  "foot_r",
] as const;
type BoneId = (typeof BONES)[number];

interface Template {
  scene: THREE.Group;
  materials: Map<THREE.Material, THREE.MeshStandardMaterial>;
}

interface Guest {
  index: number;
  model: ModelId;
  group: THREE.Group;
  /** Each level's meshes (one per material). */
  lods: THREE.SkinnedMesh[][];
  lod: number;
  bones: Record<BoneId, THREE.Bone>;
  /** Each bone's rest rotation in model space, and its parent's. */
  rest: Record<BoneId, THREE.Quaternion>;
  /** Rest direction (model space) of each limb segment: upper arm, forearm, thigh, shin. */
  dirs: Record<"upperarm_l" | "lowerarm_l" | "upperarm_r" | "lowerarm_r" | "thigh_l" | "calf_l" | "thigh_r" | "calf_r", THREE.Vector3>;
  scope: THREE.BufferAttribute[];
  room: number;
  /** The pelvis's rest height and position (model space), and model space to the root bone's space. */
  pelvisY: number;
  pelvisRest: THREE.Vector3;
  rootInv: THREE.Matrix4;
  /** Materials only this guest uses (its hair colour). */
  own: THREE.Material[];
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpSphere = new THREE.Sphere();
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** A direction in the body's frame (x to its left, y up, z ahead) from a pitch forward and a spread outward. */
function aim(out: THREE.Vector3, pitch: number, spread: number, side: number): THREE.Vector3 {
  // Hanging straight down, pitched forward about x, then spread out to the side about z.
  return out.set(0, -1, 0).applyEuler(tmpE.set(-pitch, 0, side * spread, "ZXY"));
}

export class People {
  readonly root = new THREE.Group();
  private guests: Guest[] = [];
  private byIndex = new Map<number, Guest>();
  /** People drawn here, not as block figures. */
  readonly covered = new Set<number>();
  /** How many guests were posed and drawn at each level in the last frame (for the perf readout). */
  readonly drawn = [0, 0, 0];
  /** CPU time of the last update (ms): culling, levels and posing. */
  ms = 0;

  static async load(urls: Record<ModelId, string>, lighting: ScopedLighting | null): Promise<Map<ModelId, Template>> {
    const loader = new GLTFLoader();
    const out = new Map<ModelId, Template>();
    for (const [id, url] of Object.entries(urls) as [ModelId, string][]) {
      const gltf = await loader.loadAsync(url);
      const materials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of list) {
          if (materials.has(m)) continue;
          const src = m as THREE.MeshStandardMaterial;
          const cut = CUTOUT.test(src.name);
          // Opaque, or an alpha-tested cut-out: nothing is sorted or blended (MSAA smooths the cut edges).
          const mat = new THREE.MeshStandardMaterial({
            name: src.name,
            map: src.map,
            normalMap: src.normalMap,
            color: src.color,
            roughness: cut ? 0.8 : 0.7,
            metalness: 0,
            transparent: false,
            alphaTest: cut ? 0.5 : 0,
            alphaToCoverage: cut,
            side: cut ? THREE.DoubleSide : THREE.FrontSide,
          });
          materials.set(m, lighting ? lighting.patch(mat) : mat);
        }
      });
      out.set(id, { scene: gltf.scene, materials });
    }
    return out;
  }

  constructor(templates: Map<ModelId, Template>, people: Person[]) {
    this.root.name = "people";
    people.forEach((p, i) => {
      const model = MODEL_FOR[`${p.look.sex}:${p.look.outfit}`];
      const t = model && templates.get(model);
      if (!model || !t) return;
      const g = this.makeGuest(i, model, t, p.look.hair);
      this.guests.push(g);
      this.byIndex.set(i, g);
      this.covered.add(i);
      this.root.add(g.group);
    });
  }

  private makeGuest(index: number, model: ModelId, t: Template, hair: string): Guest {
    const own = new Map<THREE.Material, THREE.Material>();
    const group = SkeletonUtils.clone(t.scene) as THREE.Group;
    group.name = `guest-${index}`;
    const lods: THREE.SkinnedMesh[][] = [];
    const scope: THREE.BufferAttribute[] = [];
    group.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const lod = Number(/lod(\d)/.exec(mesh.name)?.[1] ?? /lod(\d)/.exec(mesh.parent?.name ?? "")?.[1] ?? 0);
      // Share every vertex buffer with the template; only the room index (for the scoped lights) is the guest's own.
      const src = mesh.geometry;
      const geo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(src.attributes)) geo.setAttribute(name, attr);
      geo.setIndex(src.index);
      for (const gr of src.groups) geo.addGroup(gr.start, gr.count, gr.materialIndex);
      geo.boundingSphere = src.boundingSphere;
      geo.boundingBox = src.boundingBox;
      const a = new THREE.BufferAttribute(new Float32Array(src.attributes.position!.count).fill(-1), 1);
      geo.setAttribute("aScope", a);
      scope.push(a);
      mesh.geometry = geo;
      const swap = (m: THREE.Material): THREE.Material => {
        const shared = t.materials.get(m) ?? m;
        if (!HAIR.test(shared.name)) return shared;
        // Hair is the person's own colour: one material per guest (same shader, its own colour).
        let mine = own.get(shared);
        if (!mine) {
          mine = (shared as THREE.MeshStandardMaterial).clone();
          mine.onBeforeCompile = shared.onBeforeCompile;
          (mine as THREE.MeshStandardMaterial).color.set(hair).convertSRGBToLinear();
          own.set(shared, mine);
        }
        return mine;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
      mesh.frustumCulled = false; // culled per person below, by a sphere round them
      mesh.castShadow = mesh.receiveShadow = false;
      mesh.userData.lod = lod;
      (lods[lod] ??= []).push(mesh);
    });
    const skel = lods[0]![0]!.skeleton;
    const bones = {} as Record<BoneId, THREE.Bone>;
    for (const id of BONES) {
      const b = skel.bones.find((x) => x.name === id);
      if (!b) throw new Error(`people: model ${model} has no bone ${id}`);
      bones[id] = b;
    }
    // Rest rotations and limb directions in the model's frame (the armature's parent space).
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const rest = {} as Record<BoneId, THREE.Quaternion>;
    const pos = {} as Record<BoneId, THREE.Vector3>;
    for (const id of BONES) {
      const m = new THREE.Matrix4().multiplyMatrices(inv, bones[id].matrixWorld);
      const q = new THREE.Quaternion();
      const p = new THREE.Vector3();
      m.decompose(p, q, new THREE.Vector3());
      rest[id] = q;
      pos[id] = p;
    }
    const seg = (a: BoneId, b: BoneId) => pos[b].clone().sub(pos[a]).normalize();
    const dirs = {
      upperarm_l: seg("upperarm_l", "lowerarm_l"),
      lowerarm_l: seg("lowerarm_l", "hand_l"),
      upperarm_r: seg("upperarm_r", "lowerarm_r"),
      lowerarm_r: seg("lowerarm_r", "hand_r"),
      thigh_l: seg("thigh_l", "calf_l"),
      calf_l: seg("calf_l", "foot_l"),
      thigh_r: seg("thigh_r", "calf_r"),
      calf_r: seg("calf_r", "foot_r"),
    };
    // Model space to the space the pelvis is positioned in (its parent, the root bone).
    const rootInv = new THREE.Matrix4().multiplyMatrices(inv, bones.pelvis.parent!.matrixWorld).invert();
    return {
      index,
      model,
      group,
      lods,
      lod: -1,
      bones,
      rest,
      dirs,
      scope,
      room: -2,
      pelvisY: pos.pelvis.y,
      pelvisRest: pos.pelvis.clone(),
      rootInv,
      own: [...own.values()],
    };
  }

  /**
   * Pose and place everyone drawn here. `pxPerMetre` is the screen size of a metre at 1 m
   * (viewport height / (2 tan(fov/2))), for picking each level by on-screen height.
   */
  update(people: Person[], states: FrameState[], time: number, camera: THREE.PerspectiveCamera, viewportH: number): void {
    const t0 = performance.now();
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    const pxPerM = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.drawn.fill(0);
    for (const g of this.guests) {
      const s = states[g.index]!;
      const p = people[g.index]!;
      const h = p.look.height;
      tmpSphere.center.set(s.x, s.y + h / 2, s.z);
      tmpSphere.radius = h * 0.75;
      if (!s.visible || !frustum.intersectsSphere(tmpSphere)) {
        g.group.visible = false;
        continue;
      }
      g.group.visible = true;
      // On-screen height, and the level for it (with a little hysteresis).
      const dist = tmpV.set(s.x, s.y + h / 2, s.z).distanceTo(camera.position);
      const px = (h / dist) * pxPerM;
      let lod = px > LOD_PX[0] ? 0 : px > LOD_PX[1] ? 1 : 2;
      if (g.lod >= 0 && lod !== g.lod) {
        const edge = LOD_PX[Math.min(lod, g.lod)]!;
        if (Math.abs(px - edge) < edge * HYSTERESIS) lod = g.lod;
      }
      if (lod !== g.lod) {
        g.lods.forEach((list, k) => list.forEach((m) => (m.visible = k === lod)));
        g.lod = lod;
      }
      this.drawn[lod]!++;
      // The room lights them; rewritten only when they change rooms.
      if (s.room !== g.room) {
        g.room = s.room;
        for (const a of g.scope) {
          (a.array as Float32Array).fill(s.room >= 0 ? s.room : -1);
          a.needsUpdate = true;
        }
      }
      const k = h / MODEL_HEIGHT[g.model];
      g.group.position.set(s.x, s.y, s.z);
      g.group.rotation.set(0, s.yaw, 0);
      g.group.scale.setScalar(k);
      this.pose(g, p, s, time);
    }
    this.ms = performance.now() - t0;
  }

  /** Aim each bone: `abs[id]` is its rotation from rest in model space (parents included). */
  private pose(g: Guest, p: Person, s: FrameState, time: number): void {
    const t = time + hash(g.index) * 10;
    const walking = s.pose === "walk" || s.pose === "climb";
    const sit = s.pose === "sit";
    const dance = s.pose === "dance" || s.pose === "slow";
    const gait = t * 7.2 * (p.speed / 1.3);
    const stride = walking ? Math.sin(gait) : 0;
    const lean = sit ? 0.05 : s.gesture === "lean" ? 0.14 : s.pose === "look" ? 0.05 : 0;
    const sway = dance ? Math.sin(t * 3.2) * 0.12 : Math.sin(t * 0.7) * 0.012;
    const breathe = Math.sin(t * 1.6) * 0.012;

    const torso = new THREE.Quaternion().setFromEuler(tmpE.set(lean + breathe, sway * 0.5, sway * 0.4, "YXZ"));
    const hips = new THREE.Quaternion().setFromEuler(tmpE.set(0, walking ? stride * 0.08 : sway * 0.3, 0, "YXZ"));
    const head = new THREE.Quaternion().setFromEuler(tmpE.set(-lean * 0.6, s.headYaw ?? 0, 0, "YXZ")).premultiply(torso);
    const abs = {} as Record<BoneId, THREE.Quaternion>;
    abs.Root = new THREE.Quaternion();
    abs.pelvis = hips;
    abs.spine_01 = hips.clone().slerp(torso, 0.4);
    abs.spine_02 = hips.clone().slerp(torso, 0.75);
    abs.spine_03 = torso;
    abs.neck_01 = torso.clone().slerp(head, 0.5);
    abs.head = head;
    abs.clavicle_l = torso;
    abs.clavicle_r = torso;

    // Arms: pitch forward, spread, elbow bend; the right hand does the gestures.
    const talk = s.pose === "talk" && s.speaking;
    const arm = (side: 1 | -1): [number, number, number] => {
      const swing = walking ? -stride * side * 0.35 : 0;
      let pitch = swing + 0.04;
      let spread = 0.09;
      let elbow = 0.18 + (walking ? 0.15 : 0);
      if (dance) [pitch, spread, elbow] = [0.5 + Math.sin(t * 6.4 + side) * 0.2, 0.25, 1.4];
      if (sit) [pitch, spread, elbow] = [0.35, 0.12, 0.9];
      const right = side < 0;
      if (talk && (right || hash(g.index + 7) < 0.4)) {
        const beat = Math.sin(t * (right ? 2.3 : 1.7) + side);
        [pitch, spread, elbow] = [0.45 + beat * 0.15, 0.18, 1.35 + beat * 0.25];
      }
      if (right && (s.pose === "drink" || s.pose === "toast")) {
        const sip = s.pose === "toast" ? 1 : Math.max(0, Math.sin(t * 0.9)) ** 4;
        [pitch, spread, elbow] = s.pose === "toast" ? [2.4, 0.15, 0.25] : [0.5 + sip * 0.35, 0.2, 1.6 + sip * 0.7];
      }
      if (right && s.gesture === "point") [pitch, spread, elbow] = [1.45, 0.1, 0.05];
      if (right && s.gesture === "wave") [pitch, spread, elbow] = [2.6, 0.35, 0.5 + Math.sin(t * 9) * 0.35];
      if (s.gesture === "shrug") [pitch, spread, elbow] = [0.35, 0.45, 1.5];
      if (right && s.pose === "phone") [pitch, spread, elbow] = [0.75, 0.55, 2.45];
      return [pitch, spread, elbow];
    };
    for (const side of [1, -1] as const) {
      const L = side > 0 ? "l" : "r";
      const [pitch, spread, elbow] = arm(side);
      const upper = aim(tmpV2, pitch, spread, side).applyQuaternion(torso);
      const qa = new THREE.Quaternion().setFromUnitVectors(g.dirs[`upperarm_${L}`], upper.clone());
      // The forearm bends forward from the upper arm (about the arm's own sideways axis).
      const fore = aim(new THREE.Vector3(), pitch + elbow, spread * 0.6, side).applyQuaternion(torso);
      const qf = new THREE.Quaternion().setFromUnitVectors(g.dirs[`lowerarm_${L}`], fore);
      abs[`upperarm_${L}`] = qa;
      abs[`lowerarm_${L}`] = qf;
      abs[`hand_${L}`] = qf;

      // Legs: the thigh swings from the hip, the knee bends back.
      const ph = stride * side;
      let swing = walking ? -ph * 0.45 : dance ? Math.sin(t * 6.4 + side) * 0.12 : 0;
      let bend = walking ? Math.max(0, Math.sin(gait + (side > 0 ? 0 : Math.PI) + 1.2)) * 0.9 : dance ? 0.15 : 0.03;
      if (sit) [swing, bend] = [-1.5, 1.5];
      const thigh = aim(new THREE.Vector3(), -swing, 0.03, side).applyQuaternion(hips);
      const shin = aim(new THREE.Vector3(), -swing - bend, 0.02, side).applyQuaternion(hips);
      abs[`thigh_${L}`] = new THREE.Quaternion().setFromUnitVectors(g.dirs[`thigh_${L}`], thigh);
      abs[`calf_${L}`] = new THREE.Quaternion().setFromUnitVectors(g.dirs[`calf_${L}`], shin);
      // Feet stay level, turned with the hips.
      abs[`foot_${L}`] = hips;
    }

    // World = abs * rest; local = parent's world⁻¹ * world.
    const world = (id: BoneId) => tmpQ.copy(abs[id]).multiply(g.rest[id]);
    for (const id of BONES) {
      if (id === "Root") continue; // the root keeps its rest pose: everything below is posed relative to it
      const b = g.bones[id];
      const parent = b.parent as THREE.Bone | null;
      const pid = parent && (BONES as readonly string[]).includes(parent.name) ? (parent.name as BoneId) : null;
      const w = world(id).clone();
      if (pid) tmpQ2.copy(abs[pid]).multiply(g.rest[pid]).invert();
      else tmpQ2.identity();
      b.quaternion.copy(tmpQ2.multiply(w));
    }
    // Hips drop onto a seat (to 0.47 m at 1.70 m) and bob a little in the stride: moved in model space, set in the root's.
    const drop = sit ? g.pelvisY - 0.47 * (MODEL_HEIGHT[g.model] / 1.7) : walking ? -Math.abs(Math.cos(gait)) * 0.02 : 0;
    g.bones.pelvis.position.copy(
      tmpV
        .copy(g.pelvisRest)
        .add(tmpV2.set(0, -drop, 0))
        .applyMatrix4(g.rootInv),
    );
  }

  dispose(): void {
    for (const g of this.guests) for (const list of g.lods) for (const m of list) m.geometry.dispose();
    for (const g of this.guests) for (const m of g.own) m.dispose();
    this.root.clear();
  }
}
