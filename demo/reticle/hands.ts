/**
 * The shooter's hands and forearms, seen from the eye while they work the action (see src/scope/handling.ts
 * for where they go). Built in millimetres in the scope's frame, like the parts in actions.ts.
 *
 * A hand is a palm and fifteen phalanges, each a capsule hinged at its joint, in a shooting glove; the wrist
 * runs into a sleeve, the forearm to the elbow and the upper arm on to the shoulder (solved in handling.ts).
 */
import * as THREE from 'three';
import { HAND, type HandState, type Side } from '../../src/scope/handling';

export interface Hand {
  group: THREE.Group;
  apply(state: HandState): void;
}

/** Capsule from its joint at the origin along −z, `len` between the cap centres. */
function bone(r: number, len: number): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(r, len, 6, 14);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, -len / 2);
  return g;
}

export function buildHand(side: Side, glove: THREE.Material, sleeve: THREE.Material, place: (o: THREE.Mesh) => void): Hand {
  const group = new THREE.Group();
  const hand = new THREE.Group();
  if (side === 'L') hand.scale.x = -1;
  group.add(hand);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D) => {
    const o = new THREE.Mesh(g, m);
    o.frustumCulled = false;
    place(o);
    parent.add(o);
    return o;
  };
  // Palm: a superellipsoid, flat-sided but round-edged, narrowing toward the wrist and thinner at its edges.
  const P = HAND.palm;
  const palm = new THREE.SphereGeometry(1, 40, 28);
  const pos = palm.attributes.position!;
  const se = (v: number) => Math.sign(v) * Math.abs(v) ** 0.62;
  for (let i = 0; i < pos.count; i++) {
    const x = se(pos.getX(i));
    const y = se(pos.getY(i));
    const z = se(pos.getZ(i));
    // z: −1 at the knuckles, 1 at the wrist.
    const u = (1 - z) / 2;
    const w = (P.width / 2) * (0.78 + 0.22 * u);
    pos.setXYZ(i, x * w - 2, y * (P.thick / 2) * (1 - 0.25 * x * x), -u * P.length);
  }
  palm.computeVertexNormals();
  mesh(palm, glove, hand);
  // The ball of the thumb.
  const thenar = new THREE.SphereGeometry(22, 20, 14);
  thenar.scale(0.9, 0.62, 1.25);
  mesh(thenar, glove, hand).position.set(-24, -6, -34);
  // Glove cuff over the wrist.
  const cuff = new THREE.CylinderGeometry(31, 33, 60, 24, 1);
  cuff.rotateX(Math.PI / 2);
  cuff.scale(1, 0.72, 1);
  mesh(cuff, glove, hand).position.set(-2, 0, 22);

  const joints: THREE.Group[][] = [];
  for (const f of HAND.fingers) {
    const chain: THREE.Group[] = [];
    let parent: THREE.Object3D = hand;
    let z: number = f.z;
    f.len.forEach((L, k) => {
      const j = new THREE.Group();
      j.position.set(k === 0 ? f.x : 0, 0, z);
      parent.add(j);
      mesh(bone(f.r * (1 - 0.06 * k), L), glove, j);
      chain.push(j);
      parent = j;
      z = -L;
    });
    // The fingers fan slightly from the middle one.
    chain[0]!.rotation.y = -f.x * 0.0012;
    joints.push(chain);
  }
  const T = HAND.thumb;
  const thumb: THREE.Group[] = [];
  {
    let parent: THREE.Object3D = hand;
    let z = 0;
    T.len.forEach((L, k) => {
      const j = new THREE.Group();
      if (k === 0) j.position.set(...T.base);
      else j.position.set(0, 0, z);
      parent.add(j);
      mesh(bone(T.r * (1 - 0.07 * k), L), glove, j);
      thumb.push(j);
      parent = j;
      z = -L;
    });
  }

  // Forearm and upper arm in the sleeve: unit cylinders stretched between the joints each frame.
  const limb = (r0: number, r1: number) => {
    const g = new THREE.CylinderGeometry(r1, r0, 1, 20, 1);
    g.translate(0, 0.5, 0);
    const o = mesh(g, sleeve, group);
    return o;
  };
  const fore = limb(36, 46);
  const upper = limb(48, 56);
  const elbowBall = mesh(new THREE.SphereGeometry(46, 16, 12), sleeve, group);
  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  const stretch = (o: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) => {
    tmp.subVectors(to, from);
    o.position.copy(from);
    o.scale.set(1, tmp.length(), 1);
    o.quaternion.setFromUnitVectors(up, tmp.normalize());
  };
  const S = new THREE.Vector3();
  const wristEnd = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const q = new THREE.Quaternion();

  return {
    group,
    apply(s) {
      hand.position.set(...s.wrist.p);
      q.set(...s.wrist.q);
      hand.quaternion.copy(q);
      joints.forEach((chain, i) => chain.forEach((j, k) => (j.rotation.x = -s.pose.f[i * 3 + k]!)));
      const [opp, mcp, ip] = s.pose.t as [number, number, number];
      // Opposition swings the thumb under the palm and turns it so that it bends toward the fingers.
      thumb[0]!.rotation.set(-(0.25 + 0.2 * opp), 0.5 - 0.45 * opp, 0.9 * opp, 'YXZ');
      thumb[1]!.rotation.x = -mcp;
      thumb[2]!.rotation.x = -ip;
      wristEnd.set(...s.arm.wrist);
      elbow.set(...s.arm.elbow);
      S.set(...s.arm.shoulder);
      stretch(fore, wristEnd, elbow);
      stretch(upper, elbow, S);
      elbowBall.position.copy(elbow);
    },
  };
}
