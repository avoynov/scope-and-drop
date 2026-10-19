/**
 * The party's people in three.js: simple jointed figures, one InstancedMesh per body
 * part, lit by the mansion's scoped room lights (an instanced `aScope` per person).
 *
 * Poses are drawn procedurally from the simulation's pose and a clock, so the same
 * state always draws the same picture. Proportions follow height and build; the
 * outfit's colour and silhouette tell people apart at 4×.
 */
import * as THREE from "three";
import type { ScopedLighting } from "../../mansion/build/lighting";
import { DRINKS, type DrinkId, type Gesture, type Held, type Person, type Pose } from "../types";

/** The colour of what's in the glass. */
const DRINK_COLOR: Partial<Record<Held, string>> = { champagne: "#e9d9a0", red: "#6e1424", white: "#e6dca6", beer: "#c98a2a", whisky: "#9a5a1e", water: "#d8e2e6" };

/** Things held that aren't a glass or a tray: size (m) and colour. */
const ITEMS: Partial<Record<Held, { size: [number, number, number]; color: string }>> = {
  bottle: { size: [0.075, 0.3, 0.075], color: "#1f3a24" },
  coat: { size: [0.42, 0.07, 0.55], color: "#2b2724" },
  bag: { size: [0.2, 0.13, 0.06], color: "#5a2a22" },
  camera: { size: [0.14, 0.09, 0.08], color: "#141416" },
  cards: { size: [0.065, 0.012, 0.09], color: "#eae6da" },
  cue: { size: [0.022, 1.45, 0.022], color: "#c9a36a" },
  cigarette: { size: [0.009, 0.009, 0.085], color: "#f2efe8" },
  kit: { size: [0.26, 0.17, 0.09], color: "#b3241e" },
};

/** A spilt drink on a shirt or a dress: a darker patch the drink's colour. */
const STAIN_COLOR: Record<DrinkId, string> = { champagne: "#a8945a", red: "#4e0d1a", white: "#a99c6c", beer: "#6e4a1c", whisky: "#4e2c10", water: "#3c4048" };

/** Things on the floor (broken glass, a vase in pieces, wine on the carpet, a lost bag): size (m) and colour. */
export type LitterKind = "glass" | "shards" | "stain" | "bag" | "spectacles" | "earring" | "garment";
const LITTER: Record<LitterKind, { size: [number, number, number]; color: string }> = {
  glass: { size: [0.26, 0.012, 0.2], color: "#cfe1e6" },
  shards: { size: [0.26, 0.03, 0.2], color: "#e9e3d6" },
  stain: { size: [0.9, 0.004, 0.65], color: "#3e0a14" },
  bag: { size: [0.2, 0.13, 0.06], color: "#5a2a22" },
  spectacles: { size: [0.15, 0.03, 0.05], color: "#1a1a1a" },
  earring: { size: [0.035, 0.035, 0.035], color: "#e6c45a" },
  /** A scarf, a glove or a pocket square dropped in the garden, in a colour of its own. */
  garment: { size: [0.3, 0.02, 0.16], color: "#c8e05a" },
};
const LITTER_MAX = 48;

/** A thing on the floor this frame. */
export interface Litter {
  kind: LitterKind;
  x: number;
  y: number;
  z: number;
  /** Turned about the vertical (radians). */
  yaw: number;
  /** Its own colour, instead of its kind's. */
  color?: string;
}

/** Camera flashes drawn at once, and how long each lasts (game s). */
const FLASHES = 8;
const FLASH_FOR = 0.6;

type PartId = "thigh" | "shin" | "skirt" | "torso" | "shirt" | "stain" | "head" | "hair" | "arm" | "held" | "item" | "tray" | "hat" | "glasses" | "cane" | "bandage" | "halo" | "marker";

interface Part {
  mesh: THREE.InstancedMesh;
  /** Instances per person. */
  per: number;
  scope: THREE.InstancedBufferAttribute | null;
}

export interface CrowdOptions {
  lighting: ScopedLighting;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Interpolated state of one person for a frame. */
export interface FrameState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pose: Pose;
  /** Their group's current speaker (for talk gestures). */
  speaking: boolean;
  /** Room index for lighting (-1 = outside). */
  room: number;
  visible: boolean;
  /** A gesture over the pose (asking, pointing, a shrug, leaning in), or null. */
  gesture?: Gesture | null;
  /** Head turned from the body for a glance (radians, the same sense as yaw). */
  headYaw?: number;
  /** Just back from slipping away: hair and shirt awry. */
  dishevelled?: boolean;
}

/** A camera flash: where, and how long ago (game s). */
export interface Flash {
  x: number;
  y: number;
  z: number;
  age: number;
}

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export class Crowd {
  readonly root = new THREE.Group();
  private parts = new Map<PartId, Part>();
  private people: Person[];
  /** Plan-view markers: shown only on the storey the plan shows. */
  markerLevel: number | null = null;
  /** Plan markers grow when the plan is zoomed out, so they stay a few pixels wide. */
  markerScale = 1;
  selected = -1;

  constructor(people: Person[], opts: CrowdOptions) {
    this.people = people;
    this.root.name = "crowd";
    const n = people.length;
    const std = (rough = 0.75, metal = 0) => opts.lighting.patch(new THREE.MeshStandardMaterial({ roughness: rough, metalness: metal }));
    const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 3, 8).translate(0, -len / 2 - r, 0);
    this.add("thigh", capsule(0.075, 0.3), std(0.8), 2, n);
    this.add("shin", capsule(0.058, 0.334), std(0.8), 2, n);
    this.add("skirt", new THREE.CylinderGeometry(0.17, 0.34, 1, 14, 1, true).translate(0, -0.5, 0), std(0.55), 1, n);
    this.add("torso", new THREE.CylinderGeometry(0.2, 0.15, 1, 12).translate(0, 0.5, 0), std(0.6), 1, n);
    this.add("shirt", new THREE.BoxGeometry(0.12, 0.26, 0.04), std(0.5), 1, n);
    this.add("head", new THREE.SphereGeometry(0.105, 14, 10), std(0.6), 1, n);
    this.add("hair", new THREE.SphereGeometry(0.112, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), std(0.7), 1, n);
    this.add("arm", capsule(0.048, 0.52), std(0.65), 2, n);
    this.add("held", new THREE.CylinderGeometry(0.035, 0.025, 0.14, 8).translate(0, 0.07, 0), std(0.15, 0.1), 1, n);
    this.add("item", new THREE.BoxGeometry(1, 1, 1), std(0.5), 1, n);
    this.add("tray", new THREE.CylinderGeometry(0.2, 0.2, 0.02, 16), std(0.3, 0.6), 1, n);
    this.add("hat", new THREE.CylinderGeometry(0.1, 0.11, 0.17, 12).translate(0, 0.085, 0), std(0.5), 1, n);
    this.add("glasses", new THREE.BoxGeometry(0.15, 0.03, 0.02), std(0.2, 0.5), 1, n);
    this.add("cane", new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6).translate(0, 0.45, 0), std(0.4), 1, n);
    this.add("stain", new THREE.SphereGeometry(0.5, 10, 6).scale(1, 1, 0.05), std(0.35), 1, n);
    this.add("bandage", new THREE.CylinderGeometry(0.05, 0.05, 0.09, 10), std(0.9), 1, n);
    // Plan markers: the outfit colour on a pale halo, so dark suits show on dark floors. Drawn over everything.
    for (const [id, r, order] of [
      ["halo", 0.48, 10],
      ["marker", 0.38, 11],
    ] as const) {
      const mesh = new THREE.InstancedMesh(
        new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, fog: false, toneMapped: false }),
        n,
      );
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      this.parts.set(id, { mesh, per: 1, scope: null });
      this.root.add(mesh);
    }
    // Flashes: a bright disc that blooms, facing every way.
    this.flash = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, fog: false, toneMapped: false }), FLASHES);
    this.flash.frustumCulled = false;
    (this.flash.material as THREE.MeshBasicMaterial).color.setScalar(8);
    this.root.add(this.flash);
    // An uneven seven-sided slab: a puddle, a scatter of pieces, a bag on its side.
    this.litter = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 7).translate(0, 0.5, 0), std(0.4), LITTER_MAX);
    this.litter.frustumCulled = false;
    this.litter.name = "crowd-litter";
    this.litterScope = new THREE.InstancedBufferAttribute(new Float32Array(LITTER_MAX), 1);
    this.litter.geometry.setAttribute("aScope", this.litterScope);
    for (let k = 0; k < LITTER_MAX; k++) this.litter.setMatrixAt(k, ZERO);
    this.root.add(this.litter);
    this.paint();
  }

  private readonly litter: THREE.InstancedMesh;
  private readonly litterScope: THREE.InstancedBufferAttribute;
  /** Each instance's kind and colour, so a colour is set only when it changes. */
  private litterKinds: Array<string | null> = [];

  /** What lies on the floor: glass and a vase broken, wine on the carpet, things lost. `room` lights each (-1 outside). */
  setLitter(list: ReadonlyArray<Litter & { room: number }>): void {
    const c = new THREE.Color();
    let dirty = false;
    let k = 0;
    for (const l of list) {
      if (k >= LITTER_MAX) break;
      const [sx, sy, sz] = LITTER[l.kind].size;
      this.litter.setMatrixAt(k, tmpM.compose(tmpP.set(l.x, l.y + 0.003, l.z), tmpQ.setFromAxisAngle(UP, l.yaw), tmpS.set(sx, sy, sz)));
      this.litterScope.setX(k, l.room >= 0 ? l.room : -1);
      const look = l.color ?? LITTER[l.kind].color;
      if (this.litterKinds[k] !== `${l.kind}${look}`) {
        this.litterKinds[k] = `${l.kind}${look}`;
        this.litter.setColorAt(k, c.set(look));
        dirty = true;
      }
      k++;
    }
    for (; k < LITTER_MAX; k++) this.litter.setMatrixAt(k, ZERO);
    this.litter.instanceMatrix.needsUpdate = true;
    this.litterScope.needsUpdate = true;
    if (dirty && this.litter.instanceColor) this.litter.instanceColor.needsUpdate = true;
  }

  private readonly flash: THREE.InstancedMesh;

  /** The camera flashes still lit: a pulse that swells and fades. */
  setFlashes(list: readonly Flash[]): void {
    let k = 0;
    for (const f of list) {
      if (k >= FLASHES || f.age < 0 || f.age > FLASH_FOR) continue;
      const r = 1 + 3 * (f.age / FLASH_FOR);
      const fade = 1 - f.age / FLASH_FOR;
      this.flash.setMatrixAt(k++, tmpM.compose(tmpP.set(f.x, f.y, f.z), tmpQ.identity(), tmpS.setScalar(r * fade)));
    }
    for (; k < FLASHES; k++) this.flash.setMatrixAt(k, ZERO);
    this.flash.instanceMatrix.needsUpdate = true;
  }

  private add(id: PartId, geo: THREE.BufferGeometry, mat: THREE.Material, per: number, n: number): void {
    const scope = new THREE.InstancedBufferAttribute(new Float32Array(n * per), 1);
    geo.setAttribute("aScope", scope);
    const mesh = new THREE.InstancedMesh(geo, mat, n * per);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = `crowd-${id}`;
    this.parts.set(id, { mesh, per, scope });
    this.root.add(mesh);
  }

  /** Selection the halo colours were painted for. */
  private painted = -1;
  /** The drink each glass was last painted for, and the thing each hand held. */
  private glass: Array<Held | null> = [];
  private thing: Array<Held | null> = [];

  /** The outfit colour each person was painted in (a jacket borrowed after a spill repaints them), and the drink stain on each. */
  private outfit: string[] = [];
  private stained: Array<DrinkId | null> = [];

  /** Colours from each person's look. */
  private paint(): void {
    this.painted = this.selected;
    const c = new THREE.Color();
    const set = (id: PartId, i: number, hex: string, k = 0) => {
      const part = this.parts.get(id)!;
      part.mesh.setColorAt(i * part.per + k, c.set(hex));
    };
    this.people.forEach((p, i) => {
      const L = p.look;
      const dress = L.outfit === "long-dress" || L.outfit === "short-dress";
      const legColor = dress ? (L.outfit === "short-dress" ? "#2a2422" : L.color) : L.outfit === "waiter" && L.color !== "#1a1b1f" ? "#141518" : L.color;
      for (const k of [0, 1]) {
        set("thigh", i, legColor, k);
        set("shin", i, legColor, k);
      }
      set("skirt", i, L.color);
      set("torso", i, L.color);
      set("shirt", i, L.accent);
      set("head", i, L.skin);
      set("hair", i, L.hair);
      // Dresses are sleeveless: bare arms; jackets have sleeves.
      set("arm", i, dress ? L.skin : L.color, 0);
      set("arm", i, dress ? L.skin : L.color, 1);
      set("held", i, "#e8e2c8");
      set("item", i, "#2b2724");
      set("tray", i, "#c8c6c0");
      set("hat", i, "#111114");
      set("glasses", i, "#1a1a1a");
      set("cane", i, "#2a1a10");
      set("marker", i, L.color);
      set("halo", i, i === this.selected ? "#e0b56a" : "#f4efe4");
      set("bandage", i, "#f2f0ea");
      set("stain", i, p.stain ? STAIN_COLOR[p.stain] : "#000000");
      this.outfit[i] = L.color;
      this.stained[i] = p.stain;
    });
    for (const part of this.parts.values()) if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
  }

  /** Draw everyone for this frame. `time` is real seconds, for gesture cycles. */
  update(states: FrameState[], time: number): void {
    const P = this.parts;
    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i]!;
      const s = states[i]!;
      const scope = s.room >= 0 ? s.room : -1;
      for (const part of P.values()) if (part.scope) for (let k = 0; k < part.per; k++) part.scope.setX(i * part.per + k, scope);
      if (!s.visible) {
        for (const part of P.values()) for (let k = 0; k < part.per; k++) part.mesh.setMatrixAt(i * part.per + k, ZERO);
        continue;
      }
      this.pose(i, p, s, time);
      // Plan marker.
      if (this.markerLevel !== null && p.level === this.markerLevel) {
        const k = this.markerScale * (i === this.selected ? 1.6 : 1);
        tmpM.compose(tmpP.set(s.x, s.y + 2.2, s.z), tmpQ.identity(), tmpS.set(k, 1, k));
      } else tmpM.copy(ZERO);
      P.get("marker")!.mesh.setMatrixAt(i, tmpM);
      P.get("halo")!.mesh.setMatrixAt(i, tmpM);
    }
    if (this.painted !== this.selected || this.people.some((p, i) => p.look.color !== this.outfit[i] || p.stain !== this.stained[i])) this.paint();
    this.paintGlasses();
    this.paintItems();
    for (const part of P.values()) {
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.scope) part.scope.needsUpdate = true;
    }
  }

  /** A glass shows the colour of its drink; repainted only when what's held changes. */
  private paintGlasses(): void {
    const part = this.parts.get("held")!;
    const c = new THREE.Color();
    let dirty = false;
    this.people.forEach((p, i) => {
      const h = p.held && DRINKS.has(p.held) ? p.held : null;
      if (h === (this.glass[i] ?? null)) return;
      this.glass[i] = h;
      part.mesh.setColorAt(i * part.per, c.set((h && DRINK_COLOR[h]) ?? "#e8e2c8"));
      dirty = true;
    });
    if (dirty && part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
  }

  /** A bottle, a coat, a camera: each its own colour, repainted only when it changes. */
  private paintItems(): void {
    const part = this.parts.get("item")!;
    const c = new THREE.Color();
    let dirty = false;
    this.people.forEach((p, i) => {
      const h = p.held && ITEMS[p.held] ? p.held : null;
      if (h === (this.thing[i] ?? null)) return;
      this.thing[i] = h;
      if (h) part.mesh.setColorAt(i, c.set(ITEMS[h]!.color));
      dirty = true;
    });
    if (dirty && part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
  }

  private pose(i: number, p: Person, s: FrameState, time: number): void {
    const L = p.look;
    const k = L.height / 1.7;
    const wide = 1 + L.build * 0.35;
    const t = time + hash(i) * 10;
    const dress = L.outfit === "long-dress" || L.outfit === "short-dress";
    const sit = s.pose === "sit";
    // Down on the heels: looking under a table for something lost, sweeping up glass.
    const crouch = s.pose === "crouch";
    const walking = s.pose === "walk" || s.pose === "climb";
    // The slow dance, and club style (one in front, back to the other behind): dancing too.
    const close = s.pose === "slow" || s.pose === "front" || s.pose === "behind";
    const dance = s.pose === "dance" || close;
    const tempo = s.pose === "slow" ? 0.4 : 1;
    const limp = p.quirks.includes("limp");
    const gait = t * 7.2 * (p.speed / 1.3);
    const stride = walking ? Math.sin(gait) : 0;
    const bob = walking ? Math.abs(Math.cos(gait)) * 0.025 * k * (limp && stride > 0 ? 2.2 : 1) : 0;
    const sway = dance ? Math.sin(t * 3.2 * tempo) * (s.pose === "slow" ? 0.4 : 1) : 0;
    // Past 0.6 tipsiness a slow side-to-side list, more the drunker they are.
    const list = p.tipsy > 0.6 && !sit ? Math.min(1, (p.tipsy - 0.6) / 0.4) * 0.07 * Math.sin(t * 1.3) : 0;
    // Singing, they sway on their feet.
    const sing = s.pose === "sing" ? Math.sin(t * 1.9) * 0.6 : 0;
    const hipY = (sit ? 0.47 : crouch ? 0.52 * k : 0.92 * k) + bob + (dance ? Math.abs(Math.sin(t * 6.4 * tempo)) * 0.03 : 0);
    const base = new THREE.Matrix4().compose(tmpP.set(s.x, s.y, s.z), tmpQ.setFromAxisAngle(UP, s.yaw + sway * 0.5 + sing * 0.15), tmpS.set(1, 1, 1));
    const g = s.gesture ?? null;
    const lean =
      g === "startle"
        ? -0.14
        : crouch
          ? 0.42
          : s.pose === "rattle" || s.pose === "dab"
            ? 0.1
            : g === "shove"
              ? 0.18
              : g === "pull"
                ? -0.12
                : s.pose === "play"
                  ? 0.35
                  : s.pose === "look"
                    ? 0.05
                    : s.pose === "kiss" || s.pose === "hug"
                      ? 0.16
                      : s.pose === "argue"
                        ? 0.1
                        : s.pose === "behind"
                          ? 0.08
                          : s.pose === "shake"
                            ? 0.06
                            : g === "lean"
                              ? 0.14
                              : 0;
    const local = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")), new THREE.Vector3(sx, sy, sz));
    const stretch = local(0, 0, 0, 0, 0, 0, 1, k, 1);
    const set = (id: PartId, kk: number, m: THREE.Matrix4) => {
      const part = this.parts.get(id)!;
      part.mesh.setMatrixAt(i * part.per + kk, m);
    };
    const hide = (id: PartId, kk = 0) => set(id, kk, ZERO);

    // Upper body frame: hips, leaning forward from the hips.
    const hips = base.clone().multiply(local(0, hipY, sit ? -0.05 : 0, lean, 0, (dance ? sway * 0.08 : 0) + list + sing * 0.06));
    // Legs: thigh from the hip, shin from the knee. Positive pitch swings a limb back.
    for (const side of [-1, 1] as const) {
      const kk = side < 0 ? 0 : 1;
      if (L.outfit === "long-dress" && !sit) {
        hide("thigh", kk);
        hide("shin", kk);
        continue;
      }
      const ph = stride * side;
      const swing = sit ? -1.5 : crouch ? -1.35 : walking ? -ph * 0.45 : dance ? Math.sin(t * 6.4 * tempo + side) * (s.pose === "slow" ? 0.1 : 0.2) : 0;
      const bend = sit
        ? 1.5
        : crouch
          ? 2.35
          : walking
            ? 0.08 + Math.max(0, ph) * 0.65 + (s.pose === "climb" ? 0.35 : 0)
            : dance
              ? 0.15 + Math.max(0, Math.sin(t * 6.4 * tempo + side)) * (s.pose === "slow" ? 0.1 : 0.3)
              : 0.03;
      const hip = base.clone().multiply(local(side * 0.095 * wide, hipY, sit ? -0.05 : 0, swing));
      set("thigh", kk, hip.clone().multiply(stretch));
      set("shin", kk, hip.multiply(local(0, -0.45 * k, 0, bend)).multiply(stretch));
    }
    if (dress) {
      const len = L.outfit === "long-dress" ? (sit ? 0.5 : crouch ? 0.48 : hipY - 0.02) : 0.4 * k;
      set("skirt", 0, base.clone().multiply(local(0, hipY + 0.02, sit ? 0.05 : 0, sit ? -0.5 : 0, 0, 0, wide, len, wide)));
    } else hide("skirt");
    const torsoLen = 0.5 * k;
    set("torso", 0, hips.clone().multiply(local(0, 0, 0, 0, 0, 0, wide, torsoLen, wide * 0.78)));
    if (!dress) set("shirt", 0, hips.clone().multiply(local(s.dishevelled ? 0.03 : 0, torsoLen * 0.78, 0.13 * wide, -0.08, 0, s.dishevelled ? 0.35 : 0, 1, k, 1)));
    else hide("shirt");
    // A spilt drink down the front.
    if (p.stain) set("stain", 0, hips.clone().multiply(local(0.035 * wide, torsoLen * 0.58, 0.148 * wide, -0.1, 0, 0.25, 0.13 * wide, 0.21 * k, 1)));
    else hide("stain");

    // Head: nods while talking; thrown back for a big laugh.
    const talking = s.pose === "talk";
    const laugh = talking && p.quirks.includes("big-laugh") && Math.sin(t * 0.7) > 0.93;
    const nod = talking ? Math.sin(t * 2.3) * 0.08 : 0;
    // A glance turns the head (no further than the neck allows); otherwise a talker looks round the group.
    const turn = s.headYaw ? Math.max(-1.3, Math.min(1.3, s.headYaw)) : talking ? Math.sin(t * 0.9) * 0.3 : 0;
    const cheek = s.pose === "kiss" || s.pose === "hug" || s.pose === "slow";
    const tilt = g === "ask" ? 0 : g === "shrug" ? 0.12 : cheek ? 0.3 : 0;
    // A frown: chin down, eyes up at whoever did it.
    // Arguing: chin out, jabbing with it.
    const jut = s.pose === "argue" ? -0.12 + Math.sin(t * 4.1) * 0.08 : 0;
    // Eyes down at the floor, the stain, the watch or the phone; head back to sing.
    const down = crouch ? 0.3 : s.pose === "dab" ? 0.4 : g === "watch" || s.pose === "phone" ? 0.3 : s.pose === "sing" ? -0.3 : 0;
    const pitchHead = laugh ? -0.45 : nod + jut + down + (s.pose === "look" ? -0.12 : 0) + (g === "lean" ? 0.15 : 0) + (g === "frown" ? 0.22 : 0) + (s.pose === "camera" ? 0.1 : 0);
    const head = hips.clone().multiply(local(0, torsoLen + 0.16 * k, 0.01, pitchHead, turn + (cheek ? 0.35 : 0), tilt, k, k, k));
    set("head", 0, head);
    set("hair", 0, head.clone().multiply(local(s.dishevelled ? 0.015 : 0, 0.012, -0.012, -0.25, 0, s.dishevelled ? 0.3 : 0)));
    if (p.quirks.includes("glasses")) set("glasses", 0, head.clone().multiply(local(0, 0.015, 0.1)));
    else hide("glasses");
    if (L.hat && !sit && !s.dishevelled) set("hat", 0, head.clone().multiply(local(0, 0.07, 0, -0.08)));
    else hide("hat");

    // Arms: pitch forward (positive) from the shoulder, roll out from the body.
    const shoulderY = torsoLen * 0.94;
    const arm = (side: -1 | 1, pitch: number, roll: number) => {
      const m = hips.clone().multiply(local(side * 0.23 * wide, shoulderY, 0, -pitch, 0, side * roll));
      set("arm", side < 0 ? 0 : 1, m.clone().multiply(stretch));
      return m;
    };
    let rp = 0;
    let rr = 0.08;
    let lp = 0;
    let lr = 0.08;
    if (walking) {
      rp = -stride * 0.45;
      lp = stride * 0.45;
    }
    const cycle = (period: number, on: number) => (t % period) / period < on;
    switch (s.pose) {
      case "talk":
        if (s.speaking) {
          rp = 0.9 + Math.sin(t * 3.1) * 0.35;
          rr = 0.3 + Math.sin(t * 2.2) * 0.2;
          if (p.traits.talk > 0.7) lp = 0.6 + Math.sin(t * 2.7) * 0.3;
        } else if (p.held) rp = 0.75;
        break;
      case "drink":
        rp = cycle(6, 0.3) ? 2.5 : 0.8;
        rr = 0.25;
        break;
      case "toast":
        rp = 2.75;
        rr = 0.15;
        break;
      case "dance":
        rp = 1.6 + Math.sin(t * 3.2) * 0.6;
        lp = 1.6 - Math.sin(t * 3.2) * 0.6;
        rr = lr = 0.5;
        break;
      case "slow":
        // Arms round the other, swaying.
        rp = lp = 1.3;
        rr = lr = -0.4;
        break;
      case "front":
        // Back to the one behind: arms loose and low, hips doing the work.
        rp = 0.7 + Math.sin(t * 3.2) * 0.4;
        lp = 0.7 - Math.sin(t * 3.2) * 0.4;
        rr = lr = 0.25;
        break;
      case "behind":
        // Hands on the dancer in front.
        rp = lp = 0.95;
        rr = lr = -0.25;
        break;
      case "argue":
        // Jabbing a finger, the other hand thrown out.
        rp = 1.2 + Math.sin(t * 5.3) * 0.35;
        rr = 0.1;
        lp = 0.5 + Math.abs(Math.sin(t * 3.7)) * 0.6;
        lr = 0.35;
        break;
      case "hug":
        rp = lp = 1.45;
        rr = lr = -0.55;
        break;
      case "sit":
        rp = lp = 0.6;
        rr = lr = 0.15;
        break;
      case "play":
        rp = lp = 1.2;
        rr = lr = 0.25;
        break;
      case "serve":
        rp = 1.45;
        rr = 0.05;
        break;
      case "smoke":
        rp = cycle(8, 0.25) ? 2.6 : 0.6;
        rr = 0.3;
        break;
      case "greet":
        rp = cycle(5, 0.4) ? 1.1 : 0;
        break;
      case "announce":
        rp = 2.9;
        lp = 0.9;
        rr = 0.2;
        break;
      case "knock":
        // Knuckles to the door, two quick taps.
        rp = 1.75 + (cycle(0.5, 0.5) ? 0.15 : 0);
        rr = 0.12;
        break;
      case "look":
        // Hands behind the back.
        rp = lp = -0.45;
        rr = lr = -0.25;
        break;
      case "shake":
        // Right hand out, pumping.
        rp = 1.15 + Math.sin(t * 9) * 0.08;
        rr = -0.05;
        break;
      case "kiss":
        // A light hold on the other's arms.
        rp = lp = 0.75;
        rr = lr = 0.05;
        break;
      case "camera":
        // Both hands up to the face.
        rp = lp = 2.15;
        rr = lr = -0.42;
        break;
      case "carry":
        rp = lp = 1.05;
        rr = lr = -0.2;
        break;
      case "line":
        // Hands clasped in front, for the photograph.
        rp = lp = 0.3;
        rr = lr = -0.22;
        break;
      case "fan":
        // A hand flapping air at someone's face.
        rp = 1.55 + Math.sin(t * 11) * 0.3;
        rr = 0.15;
        break;
      case "crouch":
        // Hands down feeling the floor.
        rp = 0.95 + Math.sin(t * 2.1) * 0.15;
        lp = 0.85;
        rr = lr = 0.12;
        break;
      case "dab":
        // A napkin dabbing at the front.
        rp = 1.95 + Math.sin(t * 7) * 0.12;
        rr = -0.62;
        lp = 0.4;
        break;
      case "sing":
        // An arm flung out, the other conducting.
        rp = 2.1 + Math.sin(t * 1.9) * 0.3;
        rr = 0.65;
        lp = 1.3 + Math.sin(t * 2.4) * 0.3;
        lr = 0.4;
        break;
      case "phone":
        // Reading a message, the phone held up before the face.
        rp = 1.95;
        rr = -0.45;
        lp = 0.2;
        break;
      case "rattle":
        // A hand on the handle, shaking it.
        rp = 1.2 + Math.sin(t * 15) * 0.1;
        rr = 0.06;
        break;
      default:
        if (p.held) rp = 0.75;
    }
    // Habits while standing about.
    const idle = s.pose === "stand" || s.pose === "wait" || (talking && !s.speaking);
    if (idle && p.quirks.includes("ear-scratch") && cycle(14, 0.12)) {
      rp = 2.5;
      rr = 0.7;
    } else if (idle && p.quirks.includes("watch-check") && cycle(19, 0.1)) {
      lp = 1.3;
      lr = -0.4;
    } else if (idle && p.quirks.includes("hands-in-pockets") && !p.held) {
      rp = lp = -0.15;
      rr = lr = 0.02;
    }
    // A gesture over the pose: a hand out palm up to ask, an arm out to point, both hands up for a shrug.
    if (g === "ask") {
      rp = 1.05;
      rr = 0.35;
    } else if (g === "point") {
      rp = 1.55;
      rr = 0.05 + (s.headYaw ? Math.max(-0.6, Math.min(0.6, s.headYaw * 0.5)) : 0);
    } else if (g === "shrug") {
      rp = lp = 0.55;
      rr = lr = 0.55;
    } else if (g === "wave") {
      rp = 2.75;
      rr = 0.3 + Math.sin(t * 8) * 0.25;
    } else if (g === "beckon") {
      // Arm out, the hand curling them in.
      rp = 1.25 + Math.sin(t * 6) * 0.2;
      rr = 0.1;
    } else if (g === "frown") {
      // Arms folded.
      rp = lp = 1.25;
      rr = lr = -0.7;
    } else if (g === "slap") {
      // Open hand swung across.
      rp = 1.5;
      rr = 0.5 - 1.1 * Math.min(1, (t % 0.7) / 0.25);
    } else if (g === "shove") {
      // Both hands out flat.
      rp = lp = 1.5;
      rr = lr = -0.05;
    } else if (g === "throw") {
      // The glass flung forward and up.
      rp = 2.1;
      rr = 0.05;
    } else if (g === "pull") {
      // A hand out holding theirs, leaning back.
      rp = 1.35;
      rr = 0.05;
    } else if (g === "startle") {
      // A jerk: both hands up and in.
      rp = lp = 1.15;
      rr = lr = -0.3;
    } else if (g === "grope") {
      // In the dark: arms out, feeling the way.
      rp = 1.45 + Math.sin(t * 2.6) * 0.15;
      lp = 1.45 - Math.sin(t * 2.6) * 0.15;
      rr = lr = 0.2;
    } else if (g === "watch") {
      // A look at the watch.
      lp = 1.3;
      lr = -0.45;
    }
    if (p.quirks.includes("cane") && !sit) lp = Math.max(lp, 0.35);
    const right = arm(1, rp, rr);
    arm(-1, lp, lr);
    // A cut hand, bandaged for the night.
    if (p.bandage) set("bandage", 0, right.clone().multiply(local(0, -0.56 * k, 0)));
    else hide("bandage");

    // What's in the right hand: kept upright whatever the arm does.
    const drink = p.held !== null && DRINKS.has(p.held);
    if (drink && s.pose !== "serve") set("held", 0, right.multiply(local(0, -0.62 * k, 0.02, rp)));
    else hide("held");
    if (p.held === "tray" && !sit) set("tray", 0, hips.clone().multiply(local(0.3, shoulderY + 0.08, 0.42)));
    else hide("tray");
    const it = p.held ? ITEMS[p.held] : undefined;
    if (it) {
      const [sx, sy, sz] = it.size;
      // Held to the eye, carried before them in both hands, a coat over the arm, or simply in the hand.
      const at =
        p.held === "camera" && s.pose === "camera"
          ? head.clone().multiply(local(0, 0, 0.17))
          : s.pose === "carry" || p.held === "coat"
            ? hips.clone().multiply(local(0, shoulderY - 0.42 * k, 0.36, p.held === "coat" ? 0.25 : 0))
            : p.held === "cigarette"
              ? right.clone().multiply(local(0, -0.6 * k, 0.04, rp - 1.2))
              : right.clone().multiply(local(0, -0.62 * k, 0.03, p.held === "cue" ? rp - 0.3 : rp));
      set("item", 0, at.multiply(local(0, 0, 0, 0, 0, 0, sx, sy, sz)));
    } else hide("item");
    if (p.quirks.includes("cane") && !sit) set("cane", 0, base.clone().multiply(local(-0.32, 0, 0.18)));
    else hide("cane");
  }

  dispose(): void {
    for (const part of this.parts.values()) {
      part.mesh.geometry.dispose();
      (part.mesh.material as THREE.Material).dispose();
      part.mesh.dispose();
    }
  }
}
