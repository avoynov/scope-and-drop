/**
 * The three rifles below the scope, with the parts that move when the action is worked: the bolt rifle's
 * receiver, bolt and box magazine; the SVD's and VSS's receivers, charging handles and magazines; their stocks,
 * barrels and scope mounts; spent cases and the round going into the chamber; and the shooter's hands. Sizes
 * and positions come from src/scope/handling.ts (ACTIONS), in millimetres in the scope's frame, so the hands
 * land on the parts they reach for.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ACTIONS, type HandlingPose, type MagGeom } from '../../src/scope/handling';
import type { RifleId } from '../../src/scope/shot';
import { buildHand } from './hands';

export type MatFn = (base: number, gloss: number, spec: number) => THREE.Material;

export interface Actions {
  setRifle(id: RifleId): void;
  apply(p: HandlingPose): void;
}

const TAU = Math.PI * 2;

export function buildActions(root: THREE.Group, mat: MatFn, place: (o: THREE.Mesh) => void): Actions {
  const steel = mat(0x151515, 45, 0.32);
  const blued = mat(0x0e0e10, 70, 0.45);
  const dark = mat(0x050505, 4, 0.02);
  const polymer = mat(0x23251f, 9, 0.08);
  const svdWood = mat(0x3c1b0d, 22, 0.14);
  const vssWood = mat(0x2e1a0f, 20, 0.12);
  const magSteel = mat(0x181817, 28, 0.25);
  const brass = mat(0x9c7a3c, 70, 0.75);
  const lacquer = mat(0x4f4527, 35, 0.3);
  const copper = mat(0x8a4f2e, 60, 0.6);
  const glove = mat(0x3a3125, 6, 0.06);
  const sleeve = mat(0x4c4a3b, 4, 0.03);

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.frustumCulled = false;
    place(o);
    parent.add(o);
    return o;
  };
  const box = (w: number, h: number, l: number, r = 1.5) => new RoundedBoxGeometry(w, h, l, 2, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, l / 2 - 0.01));
  /** Cylinder along z from z0 (radius r0) to z1 (radius r1). */
  const cylZ = (r0: number, r1: number, z0: number, z1: number, seg = 32, open = false) => {
    const g = new THREE.CylinderGeometry(r1, r0, Math.abs(z1 - z0), seg, 1, open);
    g.rotateX(z1 < z0 ? -Math.PI / 2 : Math.PI / 2);
    g.translate(0, 0, (z0 + z1) / 2);
    return g;
  };
  /** A tube's wall between two radii, solid from angle a0 to a1 (from +x toward +y), between z0 and z1. */
  const arcPrism = (rOut: number, rIn: number, a0: number, a1: number, z0: number, z1: number) => {
    const s = new THREE.Shape();
    s.absarc(0, 0, rOut, a0, a1, false);
    s.absarc(0, 0, rIn, a1, a0, true);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.abs(z1 - z0), bevelEnabled: false, curveSegments: 40 });
    g.translate(0, 0, Math.min(z0, z1));
    return g;
  };
  /** A cartridge with its head at the origin and its bullet toward −z. */
  const cartridge = (c: MagGeom['cartridge'], caseMat: THREE.Material, rim = false) => {
    const g = new THREE.Group();
    const r = c.dia / 2;
    const neck = 4.4;
    mesh(cylZ(r, r * 0.94, 0, -(c.caseLen - 9), 20), caseMat, g);
    mesh(cylZ(r * 0.94, neck, -(c.caseLen - 9), -(c.caseLen - 5), 20), caseMat, g);
    mesh(cylZ(neck, neck, -(c.caseLen - 5), -c.caseLen, 16), caseMat, g);
    if (rim) mesh(cylZ(r + 1.3, r + 1.3, 0, -1.6, 20), caseMat, g);
    mesh(cylZ(3.9, 3.9, -c.caseLen, -c.caseLen - 5, 16), copper, g);
    mesh(cylZ(3.9, 0.7, -c.caseLen - 5, -c.oal, 16), copper, g);
    // The primer, a dull disc in the head.
    const primer = new THREE.CircleGeometry(2.6, 16);
    mesh(primer, steel, g, 0, 0, 0.05);
    return g;
  };

  interface MagParts {
    group: THREE.Group;
    top: THREE.Group;
    follower: THREE.Mesh;
  }
  /** A magazine with its origin at the front-top pivot (see magFrame), body down and back from it. */
  const magazine = (parent: THREE.Group, m: MagGeom, caseMat: THREE.Material, rim: boolean, ribs: boolean): MagParts => {
    const group = new THREE.Group();
    parent.add(group);
    const [w, h, l] = m.size;
    mesh(box(w, h, l, 2.5), magSteel, group, 0, -h / 2, l / 2);
    // Floorplate, a little proud of the body.
    mesh(box(w + 3, 6, l + 4, 1.5), magSteel, group, 0, -h - 1, l / 2);
    // Feed lips.
    for (const s of [-1, 1]) mesh(box(2, 4, l * 0.7, 0.8), magSteel, group, s * (w / 2 - 3), 1.5, l * 0.6);
    if (ribs) for (const s of [-1, 1]) for (const y of [0.35, 0.62]) mesh(box(1.2, 6, l * 0.8, 0.5), magSteel, group, s * (w / 2 + 0.4), -h * y, l / 2);
    const top = cartridge(m.cartridge, caseMat, rim);
    top.position.set(0, -m.cartridge.dia / 2 - 1, l - 10);
    group.add(top);
    const follower = mesh(box(w - 6, 3, l - 8, 1), dark, group, 0, -6, l / 2);
    return { group, top, follower };
  };

  const rifles = {} as Record<RifleId, THREE.Group>;
  const mags = {} as Record<RifleId, [MagParts, MagParts]>;

  // ---- bolt rifle: M24 class ----
  const boltParts = (() => {
    const g = new THREE.Group();
    root.add(g);
    rifles.bolt = g;
    const A = ACTIONS.bolt;
    const B = A.bolt!;
    const y = B.axisY;
    const rec = (geo: THREE.BufferGeometry) => mesh(geo, blued, g, 0, y, 0);
    rec(arcPrism(17.5, 9.9, 0, TAU, -290, -195));
    // The ejection port: the wall is cut away on the right, from below level to the top.
    rec(arcPrism(17.5, 9.9, 62 * Math.PI / 180, 320 * Math.PI / 180, -382, -290));
    rec(arcPrism(17.5, 9.9, 0, TAU, -420, -382));
    // Recoil lug, barrel and brake.
    mesh(box(26, 12, 10, 1), blued, g, 0, y - 18, -425);
    mesh(cylZ(12.5, 10.5, -420, -1080), blued, g, 0, y, 0);
    mesh(cylZ(13, 13, -1080, -1160), blued, g, 0, y, 0);
    // Scope rail.
    mesh(box(21, 8, 370, 1), steel, g, 0, -36, -295);
    // The bolt: slides back and forth; the body and handle turn with the lift, the shroud does not.
    const slide = new THREE.Group();
    g.add(slide);
    const turn = new THREE.Group();
    turn.position.y = y;
    slide.add(turn);
    mesh(cylZ(B.bodyR, B.bodyR, B.faceZ, B.rearZ), steel, turn);
    // Spiral flutes read as dark bands along the polished body.
    for (let i = 0; i < 3; i++) {
      const f = mesh(box(2.2, 2.2, 120, 1), dark, turn, 0, 0, B.faceZ + 80 + 60);
      f.position.x = Math.cos((i * TAU) / 3) * (B.bodyR - 0.5);
      f.position.y = Math.sin((i * TAU) / 3) * (B.bodyR - 0.5);
    }
    const a = B.closedRad;
    const root0 = new THREE.Vector3(B.bodyR * Math.cos(a), B.bodyR * Math.sin(a), B.rootZ);
    const knob = new THREE.Vector3(B.handleLen * Math.cos(a), B.handleLen * Math.sin(a), B.rootZ + B.sweep);
    const stem = new THREE.CylinderGeometry(4.2, 5.6, root0.distanceTo(knob), 16);
    stem.translate(0, root0.distanceTo(knob) / 2, 0);
    const st = mesh(stem, steel, turn);
    st.position.copy(root0);
    st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), knob.clone().sub(root0).normalize());
    const k = new THREE.SphereGeometry(B.knobR, 24, 16);
    k.scale(1, 1, 1.15);
    mesh(k, steel, turn).position.copy(knob);
    mesh(cylZ(11.5, 10, B.rearZ, B.rearZ + 18), blued, slide, 0, y, 0);
    mesh(box(4, 5, 6, 0.8), steel, slide, 0, y - 10, B.rearZ + 15);
    // Stock: a fibreglass stock bedded round the action, the receiver's upper half showing above it.
    mesh(box(56, 50, 260, 6), polymer, g, 0, -87, -310);
    mesh(box(54, 44, 330, 8), polymer, g, 0, -86, -605);
    mesh(box(44, 54, 90, 8), polymer, g, 0, -91, -150);
    const gripG = box(32, 105, 46, 9);
    const grip = mesh(gripG, polymer, g, 0, -165, -175);
    grip.rotation.x = 0.32;
    // Comb under the face.
    mesh(box(40, 34, 370, 8), polymer, g, 0, -69, 85);
    // Bottom metal: the trigger guard, the trigger and the magazine catch.
    mesh(box(18, 4, 78, 1.5), steel, g, 0, -142, -258);
    mesh(box(18, 22, 4, 1.5), steel, g, 0, -131, -296);
    mesh(box(5, 22, 5, 1.5), steel, g, 0, -124, A.trigger[2]).rotation.x = 0.25;
    mesh(box(14, 4, 9, 1), steel, g, ...A.release).rotation.x = -0.4;
    const ms = magazine(g, A.mag, brass, false, false);
    const ms2 = magazine(g, A.mag, brass, false, false);
    mags.bolt = [ms, ms2];
    return { slide, turn };
  })();

  // ---- SVD and VSS: AK-type receivers ----
  const akParts = (id: 'svd' | 'vss') => {
    const g = new THREE.Group();
    root.add(g);
    rifles[id] = g;
    const A = ACTIONS[id];
    const C = A.carrier!;
    const y = A.boreY;
    const svd = id === 'svd';
    const wood = svd ? svdWood : vssWood;
    const [z0, z1] = svd ? [-170, -430] : [-180, -380];
    const half = svd ? 15 : 14;
    const top = svd ? -54 : -56;
    const bot = svd ? -106 : -100;
    mesh(box(half * 2, top - bot, z0 - z1, 3), blued, g, 0, (top + bot) / 2, (z0 + z1) / 2);
    if (svd) {
      // The receiver cover, rounded over the top.
      const cover = arcPrism(half + 0.5, half - 1, 0, Math.PI, z1 + 5, z0 - 5);
      mesh(cover, blued, g, 0, top, 0);
    }
    // Ejection port on the right, and the slot the charging handle runs in.
    const portZ = svd ? [-330, -405] : [-300, -350];
    mesh(box(1, 20, portZ[0]! - portZ[1]!, 0.4), dark, g, half + 0.1, y + 4, (portZ[0]! + portZ[1]!) / 2);
    mesh(box(1, 5, C.stroke + 20, 0.4), dark, g, half + 0.1, C.knob[1], C.knob[2] + C.stroke / 2);
    // The charging handle, on the bolt carrier.
    const charge = new THREE.Group();
    g.add(charge);
    const stemG = new THREE.CylinderGeometry(4, 4.5, C.knob[0] - half, 12);
    stemG.rotateZ(Math.PI / 2);
    mesh(stemG, steel, charge, (half + C.knob[0]) / 2 - 2, C.knob[1], C.knob[2]);
    const kn = new THREE.CylinderGeometry(svd ? 7 : 6.5, svd ? 7 : 6.5, 10, 20);
    kn.rotateZ(Math.PI / 2);
    mesh(kn, steel, charge, C.knob[0] + 2, C.knob[1], C.knob[2]);
    // Safety lever: a long flat plate on the right side, its front end turned out.
    const lever = mesh(box(2, svd ? 16 : 11, svd ? 150 : 75, 0.8), steel, g, half + 1.6, svd ? -74 : -84, svd ? -262 : -248);
    lever.rotation.x = svd ? 0.06 : 0.04;
    // Trigger guard, trigger and magazine catch.
    const tz = A.trigger[2];
    mesh(box(16, 4, 66, 1.5), steel, g, 0, A.trigger[1] - 14, tz - 6);
    mesh(box(5, 20, 5, 1.5), steel, g, 0, A.trigger[1] - 2, tz).rotation.x = 0.2;
    mesh(box(14, 3, 10, 1), steel, g, ...A.release).rotation.x = 0.5;
    // Skeleton stock with a thumbhole: comb, grip and lower bar.
    mesh(box(32, 34, 420, 8), wood, g, 0, -77, 30 + (z0 + 175));
    mesh(box(36, 12, 170, 5), wood, g, 0, -55, 60);
    const grip = mesh(box(30, 120, 40, 9), wood, g, 0, -150, -200);
    grip.rotation.x = 0.25;
    mesh(box(30, 26, 440, 8), wood, g, 0, -214, 30);
    // Side-mount bracket from the receiver's left rail up to a dovetail base under the scope.
    mesh(box(24, 8, 190, 1.5), steel, g, 0, -38, -285);
    mesh(box(8, 52, 120, 1.5), steel, g, -22, -62, -290);
    mesh(box(6, 6, 42, 1.5), steel, g, -28, -52, -290);
    if (svd) {
      // Wooden handguards round the barrel, vented, and the slotted flash hider.
      mesh(cylZ(24, 23, -435, -645, 32), wood, g, 0, y + 4, 0);
      for (let i = 0; i < 3; i++) mesh(box(1, 7, 28, 0.5), dark, g, 23.5, y + 12, -470 - i * 55);
      mesh(cylZ(10, 9, -430, -1060), blued, g, 0, y, 0);
      mesh(cylZ(11, 11, -1060, -1140), blued, g, 0, y, 0);
      mesh(box(14, 34, 22, 2), blued, g, 0, y + 20, -700);
    } else {
      // The integral suppressor, a wooden forend under its rear half, and the front sight at its end.
      mesh(cylZ(22, 22, -380, -885, 40), mat(0x121212, 10, 0.12), g, 0, y, 0);
      mesh(cylZ(22, 17, -885, -895, 40), mat(0x121212, 10, 0.12), g, 0, y, 0);
      mesh(box(46, 34, 170, 9), wood, g, 0, y - 18, -470);
      mesh(box(5, 20, 8, 1.5), blued, g, 0, y + 30, -865);
    }
    const caseMat = lacquer;
    const m0 = magazine(g, A.mag, caseMat, svd, true);
    const m1 = magazine(g, A.mag, caseMat, svd, true);
    mags[id] = [m0, m1];
    return { charge };
  };
  const svd = akParts('svd');
  const vss = akParts('vss');

  // ---- spent cases and the round going into the chamber (bolt rifle) ----
  const caseG = () => {
    const c = cartridge({ ...ACTIONS.bolt.mag.cartridge, oal: ACTIONS.bolt.mag.cartridge.caseLen }, brass);
    // Fired: no bullet, the case centred on its own middle.
    c.children.slice(3, 5).forEach((o) => (o.visible = false));
    const wrap = new THREE.Group();
    c.position.z = ACTIONS.bolt.mag.cartridge.caseLen / 2;
    wrap.add(c);
    rifles.bolt.add(wrap);
    return wrap;
  };
  const cases = [caseG(), caseG()];
  const feed = cartridge(ACTIONS.bolt.mag.cartridge, brass);
  rifles.bolt.add(feed);

  const hands = { R: buildHand('R', glove, sleeve, place), L: buildHand('L', glove, sleeve, place) };
  root.add(hands.R.group, hands.L.group);

  let rifle: RifleId = 'svd';
  const q = new THREE.Quaternion();
  return {
    setRifle(id) {
      rifle = id;
      for (const k of Object.keys(rifles) as RifleId[]) rifles[k].visible = k === id;
    },
    apply(p) {
      const b = ACTIONS.bolt.bolt!;
      if (rifle === 'bolt') {
        boltParts.slide.position.z = b.stroke * p.bolt.travel;
        boltParts.turn.rotation.z = b.liftRad * p.bolt.lift;
        cases.forEach((c, i) => {
          const f = p.cases[i];
          c.visible = !!f;
          if (f) {
            c.position.set(...f.p);
            c.quaternion.copy(q.set(...f.q));
          }
        });
        feed.visible = !!p.feed;
        if (p.feed) {
          feed.position.set(...p.feed.p);
          feed.quaternion.copy(q.set(...p.feed.q));
        }
      } else {
        const parts = rifle === 'svd' ? svd : vss;
        parts.charge.position.z = ACTIONS[rifle].carrier!.stroke * p.carrier;
      }
      mags[rifle].forEach((m, i) => {
        const s = p.mags[i]!;
        m.group.visible = s.visible;
        if (!s.visible) return;
        m.group.position.set(...s.frame.p);
        m.group.quaternion.copy(q.set(...s.frame.q));
        m.top.visible = s.rounds > 0;
        m.follower.visible = s.rounds === 0;
        // Rounds sit staggered, alternately left and right of the middle.
        m.top.position.x = s.rounds % 2 ? 3 : -3;
      });
      hands.R.apply(p.hands.R);
      hands.L.apply(p.hands.L);
    },
  };
}
