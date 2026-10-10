/**
 * The party's people in three.js: simple jointed figures, one InstancedMesh per body
 * part, lit by the mansion's scoped room lights (an instanced `aScope` per person).
 *
 * Poses are drawn procedurally from the simulation's pose and a clock, so the same
 * state always draws the same picture. Proportions follow height and build; the
 * outfit's colour and silhouette tell people apart at 4×.
 */
import * as THREE from 'three';
import type { ScopedLighting } from '../../mansion/build/lighting';
import type { Person, Pose } from '../types';

type PartId = 'thigh' | 'shin' | 'skirt' | 'torso' | 'shirt' | 'head' | 'hair' | 'arm' | 'held' | 'tray' | 'hat' | 'glasses' | 'cane' | 'halo' | 'marker';

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
    this.root.name = 'crowd';
    const n = people.length;
    const std = (rough = 0.75, metal = 0) => opts.lighting.patch(new THREE.MeshStandardMaterial({ roughness: rough, metalness: metal }));
    const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 3, 8).translate(0, -len / 2 - r, 0);
    this.add('thigh', capsule(0.075, 0.3), std(0.8), 2, n);
    this.add('shin', capsule(0.058, 0.334), std(0.8), 2, n);
    this.add('skirt', new THREE.CylinderGeometry(0.17, 0.34, 1, 14, 1, true).translate(0, -0.5, 0), std(0.55), 1, n);
    this.add('torso', new THREE.CylinderGeometry(0.2, 0.15, 1, 12).translate(0, 0.5, 0), std(0.6), 1, n);
    this.add('shirt', new THREE.BoxGeometry(0.12, 0.26, 0.04), std(0.5), 1, n);
    this.add('head', new THREE.SphereGeometry(0.105, 14, 10), std(0.6), 1, n);
    this.add('hair', new THREE.SphereGeometry(0.112, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), std(0.7), 1, n);
    this.add('arm', capsule(0.048, 0.52), std(0.65), 2, n);
    this.add('held', new THREE.CylinderGeometry(0.035, 0.025, 0.14, 8).translate(0, 0.07, 0), std(0.15, 0.1), 1, n);
    this.add('tray', new THREE.CylinderGeometry(0.2, 0.2, 0.02, 16), std(0.3, 0.6), 1, n);
    this.add('hat', new THREE.CylinderGeometry(0.1, 0.11, 0.17, 12).translate(0, 0.085, 0), std(0.5), 1, n);
    this.add('glasses', new THREE.BoxGeometry(0.15, 0.03, 0.02), std(0.2, 0.5), 1, n);
    this.add('cane', new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6).translate(0, 0.45, 0), std(0.4), 1, n);
    // Plan markers: the outfit colour on a pale halo, so dark suits show on dark floors. Drawn over everything.
    for (const [id, r, order] of [
      ['halo', 0.48, 10],
      ['marker', 0.38, 11],
    ] as const) {
      const mesh = new THREE.InstancedMesh(new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, fog: false, toneMapped: false }), n);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      this.parts.set(id, { mesh, per: 1, scope: null });
      this.root.add(mesh);
    }
    this.paint();
  }

  private add(id: PartId, geo: THREE.BufferGeometry, mat: THREE.Material, per: number, n: number): void {
    const scope = new THREE.InstancedBufferAttribute(new Float32Array(n * per), 1);
    geo.setAttribute('aScope', scope);
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
      const dress = L.outfit === 'long-dress' || L.outfit === 'short-dress';
      const legColor = dress ? (L.outfit === 'short-dress' ? '#2a2422' : L.color) : L.outfit === 'waiter' && L.color !== '#1a1b1f' ? '#141518' : L.color;
      for (const k of [0, 1]) {
        set('thigh', i, legColor, k);
        set('shin', i, legColor, k);
      }
      set('skirt', i, L.color);
      set('torso', i, L.color);
      set('shirt', i, L.accent);
      set('head', i, L.skin);
      set('hair', i, L.hair);
      // Dresses are sleeveless: bare arms; jackets have sleeves.
      set('arm', i, dress ? L.skin : L.color, 0);
      set('arm', i, dress ? L.skin : L.color, 1);
      set('held', i, '#e8e2c8');
      set('tray', i, '#c8c6c0');
      set('hat', i, '#111114');
      set('glasses', i, '#1a1a1a');
      set('cane', i, '#2a1a10');
      set('marker', i, L.color);
      set('halo', i, i === this.selected ? '#e0b56a' : '#f4efe4');
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
      P.get('marker')!.mesh.setMatrixAt(i, tmpM);
      P.get('halo')!.mesh.setMatrixAt(i, tmpM);
    }
    if (this.painted !== this.selected) this.paint();
    for (const part of P.values()) {
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.scope) part.scope.needsUpdate = true;
    }
  }

  private pose(i: number, p: Person, s: FrameState, time: number): void {
    const L = p.look;
    const k = L.height / 1.7;
    const wide = 1 + L.build * 0.35;
    const t = time + hash(i) * 10;
    const dress = L.outfit === 'long-dress' || L.outfit === 'short-dress';
    const sit = s.pose === 'sit';
    const walking = s.pose === 'walk' || s.pose === 'climb';
    const dance = s.pose === 'dance';
    const limp = p.quirks.includes('limp');
    const gait = t * 7.2 * (p.speed / 1.3);
    const stride = walking ? Math.sin(gait) : 0;
    const bob = walking ? Math.abs(Math.cos(gait)) * 0.025 * k * (limp && stride > 0 ? 2.2 : 1) : 0;
    const sway = dance ? Math.sin(t * 3.2) : 0;
    const hipY = (sit ? 0.47 : 0.92 * k) + bob + (dance ? Math.abs(Math.sin(t * 6.4)) * 0.03 : 0);
    const base = new THREE.Matrix4().compose(tmpP.set(s.x, s.y, s.z), tmpQ.setFromAxisAngle(UP, s.yaw + sway * 0.5), tmpS.set(1, 1, 1));
    const lean = s.pose === 'play' ? 0.35 : s.pose === 'look' ? 0.05 : 0;
    const local = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
      new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    const stretch = local(0, 0, 0, 0, 0, 0, 1, k, 1);
    const set = (id: PartId, kk: number, m: THREE.Matrix4) => {
      const part = this.parts.get(id)!;
      part.mesh.setMatrixAt(i * part.per + kk, m);
    };
    const hide = (id: PartId, kk = 0) => set(id, kk, ZERO);

    // Upper body frame: hips, leaning forward from the hips.
    const hips = base.clone().multiply(local(0, hipY, sit ? -0.05 : 0, lean, 0, dance ? sway * 0.08 : 0));
    // Legs: thigh from the hip, shin from the knee. Positive pitch swings a limb back.
    for (const side of [-1, 1] as const) {
      const kk = side < 0 ? 0 : 1;
      if (L.outfit === 'long-dress' && !sit) {
        hide('thigh', kk);
        hide('shin', kk);
        continue;
      }
      const ph = stride * side;
      const swing = sit ? -1.5 : walking ? -ph * 0.45 : dance ? Math.sin(t * 6.4 + side) * 0.2 : 0;
      const bend = sit ? 1.5 : walking ? 0.08 + Math.max(0, ph) * 0.65 + (s.pose === 'climb' ? 0.35 : 0) : dance ? 0.15 + Math.max(0, Math.sin(t * 6.4 + side)) * 0.3 : 0.03;
      const hip = base.clone().multiply(local(side * 0.095 * wide, hipY, sit ? -0.05 : 0, swing));
      set('thigh', kk, hip.clone().multiply(stretch));
      set('shin', kk, hip.multiply(local(0, -0.45 * k, 0, bend)).multiply(stretch));
    }
    if (dress) {
      const len = L.outfit === 'long-dress' ? (sit ? 0.5 : hipY - 0.02) : 0.4 * k;
      set('skirt', 0, base.clone().multiply(local(0, hipY + 0.02, sit ? 0.05 : 0, sit ? -0.5 : 0, 0, 0, wide, len, wide)));
    } else hide('skirt');
    const torsoLen = 0.5 * k;
    set('torso', 0, hips.clone().multiply(local(0, 0, 0, 0, 0, 0, wide, torsoLen, wide * 0.78)));
    if (!dress) set('shirt', 0, hips.clone().multiply(local(0, torsoLen * 0.78, 0.13 * wide, -0.08, 0, 0, 1, k, 1)));
    else hide('shirt');

    // Head: nods while talking; thrown back for a big laugh.
    const talking = s.pose === 'talk';
    const laugh = talking && p.quirks.includes('big-laugh') && Math.sin(t * 0.7) > 0.93;
    const nod = talking ? Math.sin(t * 2.3) * 0.08 : 0;
    const head = hips.clone().multiply(local(0, torsoLen + 0.16 * k, 0.01, laugh ? -0.45 : nod + (s.pose === 'look' ? -0.12 : 0), talking ? Math.sin(t * 0.9) * 0.3 : 0, 0, k, k, k));
    set('head', 0, head);
    set('hair', 0, head.clone().multiply(local(0, 0.012, -0.012, -0.25)));
    if (p.quirks.includes('glasses')) set('glasses', 0, head.clone().multiply(local(0, 0.015, 0.1)));
    else hide('glasses');
    if (L.hat && !sit) set('hat', 0, head.clone().multiply(local(0, 0.07, 0, -0.08)));
    else hide('hat');

    // Arms: pitch forward (positive) from the shoulder, roll out from the body.
    const shoulderY = torsoLen * 0.94;
    const arm = (side: -1 | 1, pitch: number, roll: number) => {
      const m = hips.clone().multiply(local(side * 0.23 * wide, shoulderY, 0, -pitch, 0, side * roll));
      set('arm', side < 0 ? 0 : 1, m.clone().multiply(stretch));
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
      case 'talk':
        if (s.speaking) {
          rp = 0.9 + Math.sin(t * 3.1) * 0.35;
          rr = 0.3 + Math.sin(t * 2.2) * 0.2;
          if (p.traits.talk > 0.7) lp = 0.6 + Math.sin(t * 2.7) * 0.3;
        } else if (p.held) rp = 0.75;
        break;
      case 'drink':
        rp = cycle(6, 0.3) ? 2.5 : 0.8;
        rr = 0.25;
        break;
      case 'toast':
        rp = 2.75;
        rr = 0.15;
        break;
      case 'dance':
        rp = 1.6 + Math.sin(t * 3.2) * 0.6;
        lp = 1.6 - Math.sin(t * 3.2) * 0.6;
        rr = lr = 0.5;
        break;
      case 'sit':
        rp = lp = 0.6;
        rr = lr = 0.15;
        break;
      case 'play':
        rp = lp = 1.2;
        rr = lr = 0.25;
        break;
      case 'serve':
        rp = 1.45;
        rr = 0.05;
        break;
      case 'smoke':
        rp = cycle(8, 0.25) ? 2.6 : 0.6;
        rr = 0.3;
        break;
      case 'greet':
        rp = cycle(5, 0.4) ? 1.1 : 0;
        break;
      case 'announce':
        rp = 2.9;
        lp = 0.9;
        rr = 0.2;
        break;
      case 'look':
        // Hands behind the back.
        rp = lp = -0.45;
        rr = lr = -0.25;
        break;
      default:
        if (p.held) rp = 0.75;
    }
    // Habits while standing about.
    const idle = s.pose === 'stand' || s.pose === 'wait' || (talking && !s.speaking);
    if (idle && p.quirks.includes('ear-scratch') && cycle(14, 0.12)) {
      rp = 2.5;
      rr = 0.7;
    } else if (idle && p.quirks.includes('watch-check') && cycle(19, 0.1)) {
      lp = 1.3;
      lr = -0.4;
    } else if (idle && p.quirks.includes('hands-in-pockets') && !p.held) {
      rp = lp = -0.15;
      rr = lr = 0.02;
    }
    if (p.quirks.includes('cane') && !sit) lp = Math.max(lp, 0.35);
    const right = arm(1, rp, rr);
    arm(-1, lp, lr);

    // What's in the right hand: kept upright whatever the arm does.
    const drink = p.held === 'champagne' || p.held === 'wine' || p.held === 'beer' || p.held === 'whisky' || p.held === 'water';
    if (drink && s.pose !== 'serve') set('held', 0, right.multiply(local(0, -0.62 * k, 0.02, rp)));
    else hide('held');
    if (p.held === 'tray' && !sit) set('tray', 0, hips.clone().multiply(local(0.3, shoulderY + 0.08, 0.42)));
    else hide('tray');
    if (p.quirks.includes('cane') && !sit) set('cane', 0, base.clone().multiply(local(-0.32, 0, 0.18)));
    else hide('cane');
  }

  dispose(): void {
    for (const part of this.parts.values()) {
      part.mesh.geometry.dispose();
      (part.mesh.material as THREE.Material).dispose();
      part.mesh.dispose();
    }
  }
}
