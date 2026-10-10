/**
 * Shooting on the range: the rifle's state (magazine, chamber, bolt), real bullets flown with
 * src/scope/shot.ts, what they hit, and what the shooter sees and hears of it.
 *
 * Everything visible is a closed-form function of the time since its event (shot, impact), so stills are
 * exact and the per-frame cost does not depend on the frame rate:
 *  - the trace: the bullet's wake bending the light, seen through the scope as a ripple running downrange
 *    and dropping into the target (supersonic bullets only);
 *  - the bullet itself, true size and as out of focus as the scope makes it: a subsonic VSS bullet can be
 *    watched falling into the target;
 *  - impact splashes: dirt clods and a dust cloud thrown forward along the bullet's path (at 412 m it
 *    comes in at well under a degree, so it ploughs rather than digs), which then drift with the wind;
 *    rock dust; white plastic flecks; a hole in the mannequin, which rocks on its stake;
 *  - muzzle-blast dust: prone on dry ground the blast lifts a veil of dust in front of the muzzle that
 *    hazes the view for a second and drifts off downwind;
 *  - sound, delayed by the bullet's flight and the sound's return (audio.ts);
 *  - what the hit would have done to a person standing where the mannequin is (src/body/wound.ts);
 *  - glass: a bullet that meets a pane (glass.ts) is slowed, turned and set yawing by src/scope/glass.ts,
 *    and flown on from the back face; the pane cracks and throws its spray when the bullet gets there.
 */
import * as THREE from 'three';
import { AIR, ROUNDS, zeroTiltRad } from '../../src/scope/ballistics';
import { planHandling, poseAt, restPose, type HandlingPose, type Plan } from '../../src/scope/handling';
import { SCOPE } from '../../src/scope/optics';
import { assess, type Wound } from '../../src/body/wound';
import { dragAfter, throughGlass, yawAfter, type Through } from '../../src/scope/glass';
import { BATTLE_ZERO_M, RANGE_SPIN, RIFLES, aeroJumpRad, dispersion, firstHit, fly, millerStability, pathAt, type Hit, type Path, type Rifle, type RifleId, type Vec3 } from '../../src/scope/shot';
import { windAt, type Wind } from '../../src/scope/wind';
import type { ImpactSound, Sound } from './audio';
import { spray, type GlassScreens, type GlassSpray } from './glass';
import { heightAt, type Range } from './scene';

type Kind = ImpactSound;
const KIND: Record<string, Kind> = {
  ground: 'dirt', boulder: 'rock', torso: 'plastic', head: 'plastic', stake: 'wood', tripod: 'steel', 'post-steel': 'steel', 'post-wood': 'wood',
  frame: 'wood',
};

/** A bullet through (or off) a pane: what the glass did to it, and what the pane throws. */
interface GlassPass {
  th: Through;
  spray: GlassSpray[];
}

interface Shot {
  n: number;
  rifle: Rifle;
  /** Absolute time the bullet left the muzzle. */
  exit: number;
  path: Path;
  hit: Hit;
  kind: Kind | null;
  /** Where it crossed the plane of the mannequin it came closest to, relative to that one's chest (m, right/up). */
  miss: [number, number] | null;
  /** The mannequin it hit or came closest to (index into range.targets), if it got that far. */
  target: number;
  /** What it hit, for the readout. */
  what: string;
  /** Muzzle-blast dust strength. */
  blast: number;
  /** The hole is in the mannequin. */
  holed: boolean;
  /** A hit on a mannequin's torso or head: the wound it would have made in a person. */
  wound: Wound | null;
  /** The panes it met on the way, in order. */
  glass: GlassPass[];
}

interface Handling {
  kind: 'cycle' | 'reload';
  start: number;
  dur: number;
  /** Where the rifle is left when it is done (yaw right, pitch up, rad). */
  shift: [number, number];
  seed: number;
  /** The hands, parts, eyes and sounds, second by second (src/scope/handling.ts). */
  plan: Plan;
  /** Stops the action's sounds if the handling is cut short. */
  hush: () => void;
}

export interface Aim {
  yaw: number;
  pitch: number;
}

export interface TraceUniforms {
  a: THREE.Vector2;
  b: THREE.Vector2;
  w: THREE.Vector2;
  s: number;
  seed: number;
}

const MAX_P = 320;
const SOIL = new THREE.Color(0.72, 0.61, 0.45);
const CLOD = new THREE.Color(0.3, 0.25, 0.19);
const ROCK = new THREE.Color(0.7, 0.66, 0.6);
const WHITE = new THREE.Color(0.95, 0.94, 0.9);
const STEEL = new THREE.Color(0.5, 0.49, 0.47);
const WOOD = new THREE.Color(0.55, 0.43, 0.3);
/** A bullet's base: dull tombac-clad steel or copper. */
const BULLET = new THREE.Color(0.55, 0.36, 0.24);

/** Repeatable per-impact random numbers in [0, 1). */
function rnd(seed: number, i: number): number {
  let h = Math.imul(seed * 977 + i * 7919, 0x27d4eb2d) ^ 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Path `a` up to `tCut`, then `b` (flown on from `tCut`, after glass), resampled onto `a`'s time grid so the
 * spliced path reads as one flight.
 */
function splice(a: Path, tCut: number, b: Path): Path {
  const i0 = Math.min(a.n - 1, Math.floor(tCut / a.dt));
  const tail = b.n < 2 ? 0 : Math.max(0, Math.floor((tCut + (b.n - 1) * b.dt) / a.dt) - i0);
  const n = i0 + 1 + tail;
  const pos = new Float64Array(n * 3);
  const speed = new Float64Array(n);
  pos.set(a.pos.subarray(0, (i0 + 1) * 3));
  speed.set(a.speed.subarray(0, i0 + 1));
  const p: Vec3 = [0, 0, 0];
  for (let j = i0 + 1; j < n; j++) {
    const u = j * a.dt - tCut;
    pathAt(b, u, p);
    pos[j * 3] = p[0];
    pos[j * 3 + 1] = p[1];
    pos[j * 3 + 2] = p[2];
    const f = Math.max(0, Math.min(b.n - 1, u / b.dt));
    const k = Math.min(b.n - 2, Math.floor(f));
    speed[j] = b.speed[k]! + (b.speed[k + 1]! - b.speed[k]!) * (f - k);
  }
  return { dt: a.dt, n, pos, speed };
}

/** Dust and debris: camera-facing soft sprites, lit from the sun, one draw for every impact. */
function createParticles() {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const iCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 3), 3).setUsage(THREE.DynamicDrawUsage);
  // size (m), alpha, seed, hardness (0 = dust, 1 = a solid fleck, 2 = a bullet)
  const iPar = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iCol', iCol);
  geo.setAttribute('iPar', iPar);
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uSunView: { value: new THREE.Vector3(0, 1, 0) }, uHalfPx: { value: 400 } },
    vertexShader: /* glsl */ `
      uniform float uHalfPx;
      attribute vec3 iPos, iCol;
      attribute vec4 iPar;
      varying vec2 vUv;
      varying vec3 vCol;
      varying vec3 vPar;
      void main(){
        vUv = position.xy;
        vCol = iCol;
        vPar = iPar.yzw;
        vec4 mv = modelViewMatrix*vec4(iPos, 1.);
        // Never thinner than about a pixel, so a far fleck fades instead of vanishing.
        float px = 1.2*(-mv.z)/(projectionMatrix[1][1]*uHalfPx);
        float s = max(iPar.x, px);
        vPar.x *= min(1., (iPar.x/s)*(iPar.x/s));
        mv.xy += position.xy*s;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uSunView;
      varying vec2 vUv;
      varying vec3 vCol;
      varying vec3 vPar;
      float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
      void main(){
        float r = length(vUv);
        if (r > 1.) discard;
        float alpha = vPar.x, seed = vPar.y, hard = vPar.z;
        // A bullet seen from behind: its base faces the eye, lit by the sun over the shooter's shoulder and the
        // sky (the scene's 1.9 and about half its 0.8). Soft at the edge.
        if (hard > 1.5) { gl_FragColor = vec4(vCol*(.45 + 1.9*max(uSunView.z, 0.)), alpha*(1. - smoothstep(.55, 1., r))); return; }
        // A puff is a cauliflower of smaller billows: lumpy noise thresholded against a soft radial core,
        // lit on the side facing the sun and darker where it is thick.
        vec2 p = vUv*2.3 + seed*13.;
        float lump = vn(p)*.55 + vn(p*2.1 + 3.7)*.3 + vn(p*4.6 - 1.3)*.15;
        float core = 1. - r*r;
        float shape = hard > .5 ? step(r, .75 + .25*lump) : smoothstep(.42, .62, lump*.85 + core*.5)*smoothstep(1., .6, r);
        vec3 n = normalize(vec3(vUv + (lump - .5)*.8, sqrt(max(0., 1. - r*r)) + .2));
        float lit = .45 + .5*max(dot(n, uSunView), 0.) - .12*core;
        gl_FragColor = vec4(vCol*lit, clamp(alpha*shape, 0., 1.));
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  // The pixel floor needs the height of whichever view is drawing.
  mesh.onBeforeRender = (r) => { mat.uniforms.uHalfPx!.value = (r.getRenderTarget()?.height ?? r.domElement.height) / 2; };
  mesh.renderOrder = 2;
  let n = 0;
  return {
    mesh,
    mat,
    begin() { n = 0; },
    add(x: number, y: number, z: number, size: number, alpha: number, c: THREE.Color, seed: number, hard: number) {
      if (n >= MAX_P || alpha <= 0.002) return;
      iPos.setXYZ(n, x, y, z);
      iCol.setXYZ(n, c.r, c.g, c.b);
      iPar.setXYZW(n, size, alpha, seed, hard);
      n++;
    },
    end() {
      geo.instanceCount = n;
      mesh.visible = n > 0;
      iPos.needsUpdate = iCol.needsUpdate = iPar.needsUpdate = true;
      iPos.clearUpdateRanges(); iPos.addUpdateRange(0, n * 3);
      iCol.clearUpdateRanges(); iCol.addUpdateRange(0, n * 3);
      iPar.clearUpdateRanges(); iPar.addUpdateRange(0, n * 4);
    },
  };
}

export function createShooting(range: Range, sound: Sound, glass: GlassScreens) {
  const particles = createParticles();
  range.scene.add(particles.mesh);
  const shots: Shot[] = [];
  let shotCount = 0;
  let rifle: Rifle = RIFLES.svd;
  let chambered = true;
  let mag = rifle.magazine - 1;
  let handling: Handling | null = null;
  let handlingCount = 0;
  /** What the elevation drum is set to, in metres. */
  let zeroM = BATTLE_ZERO_M;

  // ---- what a bullet can hit ----
  const ray = new THREE.Raycaster();
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const D = new THREE.Vector3();
  const targetCentres = range.targets.map((m) => m.foot.clone().setY(m.foot.y + 1));
  const boulderCentre = range.boulder.position.clone();
  const posts = range.fence.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);
  /** Closest approach of segment a–b to point c. */
  const segDist = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    D.subVectors(b, a);
    const f = Math.max(0, Math.min(1, D.dot(B.copy(c).sub(a)) / Math.max(1e-9, D.lengthSq())));
    return B.copy(a).addScaledVector(D, f).distanceTo(c);
  };
  const solid = (a: Vec3, b: Vec3): { f: number; what: string } | null => {
    A.set(a[0], a[1], a[2]);
    const Bv = new THREE.Vector3(b[0], b[1], b[2]);
    const len = A.distanceTo(Bv);
    const hits: THREE.Intersection[] = [];
    const cast = (objs: THREE.Object3D[], recursive: boolean) => {
      ray.set(A, D.subVectors(Bv, A).normalize());
      ray.far = len;
      hits.push(...ray.intersectObjects(objs, recursive));
    };
    range.targets.forEach((m, i) => { if (segDist(A, Bv, targetCentres[i]!) < 1.6) cast([m.group], true); });
    if (segDist(A, Bv, boulderCentre) < 6.5) cast([range.boulder], false);
    // The fence runs z = −360 − 0.12·x for |x| ≤ 350.
    if (Math.max(a[2], b[2]) > -402 && Math.min(a[2], b[2]) < -318 && Math.min(a[1], b[1]) < heightAt(a[0], a[2]) + 1.4) cast(posts, false);
    // The glass screens: the panes by their plane, the frames by raycast.
    const pane = glass.cross(a, b);
    if (glass.glazing) for (let i = 0; i < glass.count; i++) if (segDist(A, Bv, glass.centre(i)) < 2.5) cast(glass.frames(i), false);
    const real = hits.filter((h) => h.object.name !== 'hole').sort((p, q) => p.distance - q.distance);
    const solidF = real.length ? real[0]!.distance / len : Infinity;
    if (pane && pane.f <= solidF) return { f: pane.f, what: `glass:${pane.screen}` };
    if (!real.length) return null;
    return { f: solidF, what: real[0]!.object.name || 'boulder' };
  };

  // ---- the mannequins' holes and rocking ----
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050505, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const holeGeos = new Map<number, THREE.CircleGeometry>();
  /** A true-size hole for a bullet of this diameter. */
  const holeGeo = (diaMm: number) => {
    let g = holeGeos.get(diaMm);
    if (!g) holeGeos.set(diaMm, (g = new THREE.CircleGeometry((diaMm / 1000) * 0.57, 10)));
    return g;
  };
  const rocks: { start: number; axis: THREE.Vector3; amp: number; target: number }[] = [];
  const rockQ = new THREE.Quaternion();
  /** The mannequin nearest a point on the ground plan. */
  const nearestTarget = (x: number, z: number) => {
    let best = 0;
    range.targets.forEach((m, i) => { if (Math.hypot(m.foot.x - x, m.foot.z - z) < Math.hypot(range.targets[best]!.foot.x - x, range.targets[best]!.foot.z - z)) best = i; });
    return best;
  };

  function setRifle(id: RifleId): void {
    if (rifle.id === id) return;
    rifle = RIFLES[id];
    chambered = true;
    mag = rifle.magazine - 1;
    handling?.hush();
    handling = null;
  }

  /** Starts working the action at `now`: the bolt, or a magazine change when the magazine is empty. */
  function handle(now: number): void {
    const reload = mag === 0;
    const kind = reload ? 'reload' : 'cycle';
    const seed = handlingCount++;
    const plan = planHandling(rifle.id, kind, mag, seed);
    handling = {
      kind,
      start: now,
      dur: plan.dur,
      // Prone, working the action nudges the rifle off the aim, more for a magazine change.
      shift: [(rnd(seed, 1) - 0.5) * (reload ? 0.006 : 0.0016), (rnd(seed, 2) - 0.35) * (reload ? 0.006 : 0.0014)],
      seed,
      plan,
      hush: sound.cues(plan.cues, rifle.id),
    };
  }

  /**
   * Space / the Fire button. Fires if a round is chambered, works the bolt if the rifle needs it, changes
   * the magazine if it is empty. `aimAt(t)` is where the bore points at time t (sway and any recoil still
   * running included); the bullet leaves after the lock time and barrel time, wherever the rifle points
   * then. Returns the moment it left, or null when the press did something else.
   */
  function press(now: number, eye: THREE.Vector3, aimAt: (t: number) => Aim, wind: Wind): number | null {
    sound.unlock();
    if (handling) return null;
    if (!chambered) {
      handle(now);
      return null;
    }
    const exit = now + rifle.lockS + rifle.barrelS;
    fireAt(exit, eye, aimAt(exit), wind, exit - now);
    return exit;
  }

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const W: Vec3 = [0, 0, 0];

  /** Flies a bullet that left the muzzle at `exit` along `aim`, and works out what it hits. */
  function fireAt(exit: number, eye: THREE.Vector3, aim: Aim, wind: Wind, delay: number | null): void {
    const n = shotCount++;
    const round = ROUNDS[rifle.round];
    const d = dispersion(rifle, n);
    euler.set(aim.pitch, aim.yaw, 0);
    fwd.set(0, 0, -1).applyEuler(euler);
    right.set(1, 0, 0).applyEuler(euler);
    up.set(0, 1, 0).applyEuler(euler);
    const sg = millerStability(rifle, d.mv);
    windAt(wind, eye.x, eye.y, eye.z, exit, W);
    const jump = aeroJumpRad(rifle, sg, W[0] * right.x + W[2] * right.z);
    // The bore runs under the scope, tilted up by the drum so the bullet climbs to the line of sight at the zero.
    const tilt = zeroTiltRad(round, zeroM, rifle.sightM);
    const dir = fwd.clone().addScaledVector(right, d.dx).addScaledVector(up, d.dy + jump + tilt).normalize();
    const air = {
      round, t0: exit, spin: RANGE_SPIN, sg,
      wind: (x: number, y: number, z: number, t: number, o: Vec3) => windAt(wind, x, y, z, t, o),
      // Nothing to fly for once it is in the ground.
      until: (x: number, y: number, z: number) => y < heightAt(x, z) - 0.5,
    };
    let path = fly({ ...air, mv: d.mv, origin: [eye.x - up.x * rifle.sightM, eye.y - up.y * rifle.sightM, eye.z - up.z * rifle.sightM], dir: [dir.x, dir.y, dir.z] });
    // Raycasts use world matrices, which a still may not have computed yet.
    range.scene.updateMatrixWorld();
    let hit = firstHit(path, heightAt, solid);
    // Through glass: what the pane does to the bullet, then on from its back face, yawing and perhaps without
    // its jacket, until it meets something else (another pane, at most a few).
    const passes: GlassPass[] = [];
    let carry: Through | null = null;
    for (let k = 0; k < 3 && hit.what.startsWith('glass:'); k++) {
      const i = Number(hit.what.slice(6));
      const glazing = glass.glazingAt(i, hit.pos);
      if (!glazing) break;
      const seed = n * 7 + k;
      const th: Through = throughGlass({
        round: rifle.round, pos: hit.pos, vel: hit.vel, normal: glass.normal(i), glazing, twistM: rifle.twistMm / 1000, sg, seed,
        ...(carry ? { massKg: carry.massKg, stripped: carry.stripped, yawMax: carry.yawMax, swingM: carry.swingM, sinceM: Math.hypot(hit.pos[0] - carry.pos[0], hit.pos[1] - carry.pos[1], hit.pos[2] - carry.pos[2]) } : {}),
      });
      passes.push({ th, spray: glass.punch(i, th, exit + hit.t, rifle.bulletDiaMm / 1000, seed) });
      carry = th;
      const tCut = hit.t;
      if (th.outcome === 'stopped') {
        hit = { t: tCut, pos: th.pos, vel: [0, 0, 0], speed: 0, what: 'glass' };
        break;
      }
      // The glass is a few hundredths of a millisecond deep: the flight picks up again at the same moment.
      const on = fly({
        ...air, mv: th.speed, origin: th.pos, dir: [th.vel[0] / th.speed, th.vel[1] / th.speed, th.vel[2] / th.speed],
        t0: exit + tCut, flown: tCut, maxT: Math.max(0.2, 3 - tCut),
        drag: (t) => dragAfter(th, th.speed * t),
      });
      path = splice(path, tCut, on);
      const h2 = firstHit(on, heightAt, solid);
      hit = { ...h2, t: h2.t + tCut };
    }
    // Where it crossed each mannequin's plane, against the chest (1.2 m up), for the readout: the closest one counts.
    let miss: [number, number] | null = null;
    let target = -1;
    range.targets.forEach((m, k) => {
      const tz = m.foot.z;
      for (let i = 0; i < path.n - 1; i++) {
        const z0 = path.pos[i * 3 + 2]!, z1 = path.pos[i * 3 + 5]!;
        if (z1 <= tz && z0 > tz) {
          if ((i + 1) * path.dt > hit.t + path.dt) break;
          const f = (tz - z0) / (z1 - z0);
          const x = path.pos[i * 3]! + (path.pos[i * 3 + 3]! - path.pos[i * 3]!) * f;
          const y = path.pos[i * 3 + 1]! + (path.pos[i * 3 + 4]! - path.pos[i * 3 + 1]!) * f;
          const off: [number, number] = [x - m.foot.x, y - (m.foot.y + 1.2)];
          if (!miss || Math.hypot(...off) < Math.hypot(...miss)) { miss = off; target = k; }
          break;
        }
      }
    });
    const kind = KIND[hit.what] ?? null;
    if (kind === 'plastic' || hit.what === 'stake' || hit.what === 'tripod') target = nearestTarget(hit.pos[0], hit.pos[2]);
    // The mannequin stands in for a person facing the shooter: the wound track runs in its own frame.
    let wound: Wound | null = null;
    if (kind === 'plastic') {
      const m = range.targets[target]!.group;
      const inv = m.quaternion.clone().invert();
      const entry = new THREE.Vector3(...hit.pos).sub(m.position).applyQuaternion(inv);
      const dirL = new THREE.Vector3(...hit.vel).normalize().applyQuaternion(inv);
      // Behind glass it may arrive yawing, and as a bare core.
      const after = carry ? { yawRad: yawAfter(carry.yawMax, carry.swingM, Math.hypot(hit.pos[0] - carry.pos[0], hit.pos[1] - carry.pos[1], hit.pos[2] - carry.pos[2])), massKg: carry.massKg } : {};
      wound = assess({ entry: [entry.x, entry.y, entry.z], dir: [dirL.x, dirL.y, dirL.z], speed: hit.speed, round: rifle.round, seed: n, ...after });
    }
    const shot: Shot = { n, rifle, exit, path, hit, kind, miss, target, what: hit.what, blast: rifle.blastDust, holed: false, wound, glass: passes };
    shots.push(shot);
    if (shots.length > 12) shots.shift();
    // Semi-auto: the action reloads itself while rounds last. Bolt: the spent case stays until the bolt is worked.
    if (rifle.action === 'semi' && mag > 0) mag--;
    else chambered = false;
    if (delay !== null) {
      sound.shot(delay, rifle.id);
      // A semi-automatic throws its case out as it fires; it lands in the dirt to the right half a second later.
      if (rifle.action === 'semi') sound.cue('case-land', rifle.id, delay + 0.45 + 0.12 * rnd(n, 9));
      if (kind) {
        const dist = Math.hypot(hit.pos[0] - eye.x, hit.pos[1] - eye.y, hit.pos[2] - eye.z);
        sound.impact(delay + hit.t + dist / 343, dist, kind);
      }
      // The pane breaking: a sharp crack and the tinkle of glass, or tempered glass pouring out of its frame.
      for (const g of passes) {
        const sp = g.spray[0];
        if (!sp) continue;
        const dist = Math.hypot(sp.pos[0] - eye.x, sp.pos[1] - eye.y, sp.pos[2] - eye.z);
        sound.impact(delay + sp.at - exit + dist / 343, dist, g.spray.some((x) => x.tempered) ? 'tempered' : 'glass');
      }
    }
    // The mannequin rocks on its stake. A 9.8 g bullet at 550 m/s carries 5.4 N·s; going straight through
    // the plastic it leaves perhaps a fifth of that, enough to rock it a degree or so.
    if (kind === 'plastic' || hit.what === 'stake' || hit.what === 'tripod') {
      const p = new THREE.Vector3(...hit.pos);
      const v = new THREE.Vector3(...hit.vel).normalize();
      const h = Math.max(0.2, p.y - range.targets[target]!.foot.y);
      const impulse = 0.2 * (ROUNDS[rifle.round].bulletGr * 0.0000648) * hit.speed;
      // About the foot, I ≈ 2.4 kg of mannequin and stake at ~1.1 m, ringing at ~2.2 Hz.
      const w = 2 * Math.PI * 2.2;
      const amp = (impulse * h) / (2.4 * 1.1 * 1.1 * w);
      rocks.push({ start: exit + hit.t, axis: new THREE.Vector3(-v.z, 0, v.x).normalize(), amp, target });
    }
  }

  // ---- per frame ----
  const P = new THREE.Vector3();
  const trace: TraceUniforms = { a: new THREE.Vector2(), b: new THREE.Vector2(), w: new THREE.Vector2(), s: 0, seed: 0 };
  const proj = new THREE.Vector3();
  const tmp: Vec3 = [0, 0, 0];

  /**
   * Updates the effects for time `now` and returns what the composite needs: the trace in the scope's image
   * uv, the muzzle-blast dust veil and its drift, and whether the shadow map must be redrawn. `focusM` is the
   * scope's parallax/focus setting (Infinity for ∞).
   */
  function update(now: number, scopeCam: THREE.PerspectiveCamera, eye: THREE.Vector3, wind: Wind, sunView: THREE.Vector3, focusM: number) {
    particles.mat.uniforms.uSunView!.value.copy(sunView);
    particles.begin();
    let dust = 0;
    let dustDrift = 0;
    let dustTop = 0;
    trace.s = 0;
    windAt(wind, eye.x, eye.y, eye.z, now, W);
    const cross = W[0];
    for (const s of shots) {
      const age = now - s.exit;
      if (age < 0) continue;
      // Muzzle blast: lifts within ~40 ms, thins over a second or so, and the crosswind carries it off.
      if (age < 4) {
        const k = s.blast * 0.6 * Math.min(1, age / 0.03) * Math.exp(-age / 0.8);
        if (k > dust) {
          dust = k;
          dustDrift = cross * age;
          // It boils up from the ground in front: the top edge climbs the view in the first few tenths.
          dustTop = 0.25 + 0.85 * (1 - Math.exp(-age / 0.22));
        }
      }
      // The bullet: true size, spread over the scope's blur circle wherever it is out of focus. At its own
      // distance D that circle is objective × |1 − D/P| across, so near the muzzle it is a faint smear the size
      // of the objective and it only firms up close to the focus distance P. A 9 mm subsonic bullet in the last
      // 50 m to a target at 183 m is a speck of a pixel or two at 12× on a 1080p screen, about as bright as the
      // sand, so it is easiest to catch against a bush or the sky; a 7.62 mm at 800 m/s is past its target
      // before the recoil lets the picture back.
      if (age > 0.06 && age < s.hit.t) {
        const b = pathAt(s.path, age, tmp);
        const dist = Math.hypot(b[0] - eye.x, b[1] - eye.y, b[2] - eye.z);
        const dia = s.rifle.bulletDiaMm / 1000;
        const blur = (SCOPE.objectiveMm / 1000) * Math.abs(1 - (Number.isFinite(focusM) ? dist / focusM : 0));
        const size = Math.max(dia, blur);
        particles.add(b[0], b[1], b[2], size / 2, (dia / size) ** 2, BULLET, 0, 2);
      }
      // Trace: the wake 0.06 s behind the bullet, from ~40 m out (closer, it is a blur all over the field),
      // collapsing into the impact point after the hit. A subsonic bullet has no shock and leaves none to see.
      const ta = Math.min(age, s.hit.t);
      const tb = Math.min(Math.max(0, age - 0.06), s.hit.t);
      if (age < s.hit.t + 0.08 && ta > 0.05 && s.path.speed[0]! > AIR.sound) {
        const fade = Math.min(1, (ta - 0.05) / 0.06) * (age > s.hit.t ? 1 - (age - s.hit.t) / 0.08 : 1);
        const head = pathAt(s.path, ta, tmp);
        P.set(head[0], head[1], head[2]);
        const dh = P.distanceTo(eye);
        proj.copy(P).project(scopeCam);
        const bx = proj.x * 0.5 + 0.5, by = proj.y * 0.5 + 0.5;
        const tail = pathAt(s.path, tb, tmp);
        P.set(tail[0], tail[1], tail[2]);
        const dt_ = Math.max(1, P.distanceTo(eye));
        proj.copy(P).project(scopeCam);
        const uvPerRad = 0.5 / Math.tan(((scopeCam.fov / 2) * Math.PI) / 180);
        if (fade > trace.s) {
          trace.a.set(proj.x * 0.5 + 0.5, proj.y * 0.5 + 0.5);
          trace.b.set(bx, by);
          // The wake widens behind the bullet: ~6 cm at it, ~25 cm 0.06 s back.
          trace.w.set((0.25 / dt_) * uvPerRad, (0.06 / Math.max(1, dh)) * uvPerRad);
          // A supersonic wake is the strong one; dry desert air keeps it faint.
          trace.s = fade * Math.max(0, Math.min(1, (s.path.speed[Math.min(s.path.n - 1, Math.floor(ta / s.path.dt))]! - 300) / 200));
          trace.seed = s.n;
        }
      }
      for (const g of s.glass) for (const sp of g.spray) spray(sp, now - sp.at, particles.add);
      if (age < s.hit.t || !s.kind) continue;
      splash(s, age - s.hit.t, wind, now);
    }
    particles.end();
    // Each mannequin rocks about its foot. Rocking first, so a new hole lands where the bullet met it.
    const q = new THREE.Quaternion();
    for (let i = rocks.length - 1; i >= 0; i--) if (now - rocks[i]!.start > 6) rocks.splice(i, 1);
    range.targets.forEach((m, k) => {
      rockQ.identity();
      for (const r of rocks) {
        const t = now - r.start;
        if (t < 0 || r.target !== k) continue;
        const w = 2 * Math.PI * 2.2;
        const a = r.amp * Math.sin(w * t) * Math.exp(-0.12 * w * t);
        rockQ.multiply(q.setFromAxisAngle(r.axis, a));
      }
      m.group.quaternion.copy(rockQ);
    });
    for (const s of shots) {
      if (s.holed || s.kind !== 'plastic' || now < s.exit + s.hit.t) continue;
      // A true-size hole: a 7.62 mm one is under a pixel at 412 m even at 20×, as in life.
      s.holed = true;
      const m = range.targets[s.target]!.group;
      const v = new THREE.Vector3(...s.hit.vel).normalize();
      m.updateMatrixWorld();
      const hole = new THREE.Mesh(holeGeo(s.rifle.bulletDiaMm), holeMat);
      hole.position.copy(m.worldToLocal(new THREE.Vector3(...s.hit.pos).addScaledVector(v, -0.002)));
      hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.negate().applyQuaternion(q.copy(m.quaternion).invert()));
      hole.name = 'hole';
      m.add(hole);
    }
    // The shadow map is drawn once for the static range; redraw it only while the rock is big enough to see.
    const w = 2 * Math.PI * 2.2;
    const shadow = rocks.some((r) => now >= r.start && r.amp * Math.exp(-0.12 * w * (now - r.start)) > 2e-4);
    return { trace, dust, dustDrift, dustTop, shadow };
  }

  let rest: { key: string; pose: HandlingPose } | null = null;
  /**
   * The hands on the rifle at `now`: while the bolt is worked or the magazine changed, how far the rifle is
   * pushed off the aim (rad, yaw right and pitch up), and where the hands, the parts, the head and the eyes
   * are (`pose`). `fold` comes once, when the action is done: where it left the rifle, for the aim to keep.
   */
  function act(now: number) {
    let hand: { yaw: number; pitch: number } | null = null;
    let fold: [number, number] | null = null;
    let pose: HandlingPose | null = null;
    if (handling) {
      const u = (now - handling.start) / handling.dur;
      if (u >= 1) {
        fold = handling.shift;
        if (handling.kind === 'reload') mag = rifle.magazine - 1;
        else mag--;
        chambered = true;
        handling = null;
      } else {
        const e = u * u * (3 - 2 * u);
        const bump = Math.sin(Math.PI * u);
        const shake = Math.sin(2 * Math.PI * (handling.kind === 'reload' ? 2.5 : 3.2) * u) * bump;
        const big = handling.kind === 'reload' ? 1 : 0.35;
        hand = {
          yaw: handling.shift[0] * e + 0.0012 * big * shake,
          pitch: handling.shift[1] * e + 0.0009 * big * shake * (rnd(handling.seed, 3) - 0.5) * 2,
        };
        pose = poseAt(handling.plan, now - handling.start);
      }
    }
    if (!pose) {
      // At rest. After the SVD's last round its empty magazine holds the carrier open.
      const open = rifle.id === 'svd' && !chambered && mag === 0;
      const key = `${rifle.id}|${mag}|${open}`;
      if (rest?.key !== key) rest = { key, pose: restPose(rifle.id, mag, open) };
      pose = rest.pose;
    }
    return { hand, fold, pose, busy: !!handling };
  }

  /** For stills: the rifle `s` seconds into working its action (a magazine change if `reload`). */
  function handleAt(now: number, reload: boolean): void {
    chambered = false;
    // A semi-automatic is only ever handled for a magazine change.
    mag = reload || rifle.action === 'semi' ? 0 : rifle.magazine - 2;
    handle(now);
  }

  /** One impact's debris and dust, `age` s after it. */
  function splash(s: Shot, age: number, wind: Wind, now: number): void {
    if (age > 7) return;
    const [hx, hy, hz] = s.hit.pos;
    const v = s.hit.vel;
    const vh = Math.hypot(v[0], v[2]) || 1;
    // Along the bullet's ground track, across it, and up.
    const fx = v[0] / vh, fz = v[2] / vh;
    const sx = -fz, sz = fx;
    const e = s.hit.speed * s.hit.speed * 0.5 * ROUNDS[s.rifle.round].bulletGr * 0.0000648;
    const scale = Math.min(1.3, Math.sqrt(e / 1500));
    const g = 9.81;
    windAt(wind, hx, hy + 0.5, hz, now, W);
    const seed = s.n * 31;
    const kind = s.kind!;
    const dusty = kind === 'dirt' ? 1 : kind === 'rock' ? 0.7 : kind === 'plastic' ? 0.18 : 0.25;
    const dustCol = kind === 'rock' ? ROCK : kind === 'plastic' ? WHITE : kind === 'steel' ? STEEL : kind === 'wood' ? WOOD : SOIL;
    const fleckCol = kind === 'dirt' ? CLOD : kind === 'rock' ? ROCK : kind === 'plastic' ? WHITE : kind === 'steel' ? STEEL : WOOD;
    const ground = kind === 'dirt' || kind === 'rock';
    // Flecks: clods, chips or plastic, thrown forward and up, falling back under gravity.
    const nFleck = ground ? 14 : 7;
    for (let i = 0; i < nFleck; i++) {
      const fwd = (ground ? 2 + 7 * rnd(seed, i * 5) : 1 + 4 * rnd(seed, i * 5)) * scale;
      const upv = (ground ? 1.5 + 5 * rnd(seed, i * 5 + 1) : 0.5 + 2 * rnd(seed, i * 5 + 1)) * scale;
      const side = (rnd(seed, i * 5 + 2) - 0.5) * 3 * scale;
      const land = (2 * upv) / g + 0.05;
      if (age > land) continue;
      const x = hx + (fx * fwd + sx * side) * age;
      const z = hz + (fz * fwd + sz * side) * age;
      const y = hy + upv * age - 0.5 * g * age * age;
      const size = (ground ? 0.015 + 0.035 * rnd(seed, i * 5 + 3) : 0.006 + 0.012 * rnd(seed, i * 5 + 3));
      particles.add(x, y, z, size, 1, fleckCol, rnd(seed, i * 5 + 4), 1);
    }
    // Dust: a forward-leaning cloud that slows in the air, swells, rises a little and drifts with the wind.
    // The first billows go up and forward fast in a narrow plume and are braked hard by the air; the cloud
    // then swells from the bottom and the wind takes it.
    const nDust = Math.round(26 * Math.max(0.35, dusty));
    for (let i = 0; i < nDust; i++) {
      const r = (k: number) => rnd(seed + 7, i * 9 + k);
      const tau = 0.12 + 0.3 * r(0);
      const v0f = (0.3 + 6 * r(1) * r(1)) * scale * (ground ? 1 : 0.4);
      const v0u = (0.4 + 5 * r(2) * r(2)) * scale * (ground ? 1 : 0.4);
      const v0s = (r(3) - 0.5) * 1.6 * scale;
      const slow = tau * (1 - Math.exp(-age / tau));
      const drift = age - slow;
      const x = hx + (fx * v0f + sx * v0s) * slow + W[0] * drift;
      const z = hz + (fz * v0f + sz * v0s) * slow + W[2] * drift;
      const s0 = (0.05 + 0.1 * r(4)) * (0.6 + 0.4 * scale);
      const size = s0 + (0.18 + 0.32 * r(5)) * Math.sqrt(age) * (0.5 + 0.5 * dusty);
      // Billows sit on the ground, not in it, and the warm cloud lifts slowly.
      const y = hy + (ground ? 0.6 * size : 0) + v0u * slow + 0.08 * age;
      const life = (1.8 + 2.8 * r(6)) * (0.4 + 0.6 * dusty);
      const alpha = dusty * 0.95 * Math.min(1, age / 0.015) * Math.pow(s0 / size, 0.6) * Math.exp(-age / life);
      particles.add(x, y, z, size, alpha, dustCol, r(7), 0);
    }
  }

  return {
    setRifle,
    /** Sets the elevation drum to a range mark (metres). */
    setZero: (m: number) => (zeroM = m),
    press,
    /** For stills: a bullet that left the muzzle at `exit`. */
    fireAt: (exit: number, eye: THREE.Vector3, aim: Aim, wind: Wind) => fireAt(exit, eye, aim, wind, null),
    update,
    act,
    handleAt,
    /** Whether the hands are off the grip, working the action. */
    busy: () => !!handling,
    status(now: number) {
      const last = shots[shots.length - 1];
      let shot = '–';
      if (last) {
        const landed = now >= last.exit + last.hit.t;
        const pane = last.glass.at(-1)?.th.outcome;
        if (!landed) shot = 'in flight';
        else if (pane === 'stopped') shot = 'stopped in the glass';
        else if (last.wound) shot = `hit ${last.what} · ${last.wound.outcome}`;
        else if (last.kind === 'plastic') shot = `hit · ${last.what}`;
        else if (last.miss) {
          const [mx, my] = last.miss;
          const cm = (m: number) => (Math.abs(m) < 1 ? `${Math.round(Math.abs(m) * 100)} cm` : `${Math.abs(m).toFixed(1)} m`);
          shot = `miss · ${cm(my)} ${my >= 0 ? 'high' : 'low'}, ${cm(mx)} ${mx >= 0 ? 'right' : 'left'}`;
        } else if (last.what === 'ground') {
          const short = Math.hypot(last.hit.pos[0], last.hit.pos[2]);
          shot = `miss · ground at ${Math.round(short)} m`;
        } else shot = `miss · ${last.what}`;
        if (landed && pane === 'through') shot = `through glass · ${shot}`;
        if (landed && pane === 'ricochet') shot = `glanced off the glass · ${shot}`;
      }
      const state = handling
        ? handling.kind === 'reload' ? 'changing magazine' : 'working the bolt'
        : chambered ? 'ready' : mag > 0 ? 'Space: work the bolt' : 'Space: reload';
      // The last bullet into a person, once it has struck: the wound, its striking speed, and how long ago.
      const hurt = [...shots].reverse().find((s) => s.wound && now >= s.exit + s.hit.t);
      const g = hurt?.glass.at(-1)?.th;
      const wound = hurt ? {
        n: hurt.n, wound: hurt.wound!, speed: hurt.hit.speed, since: now - hurt.exit - hurt.hit.t,
        // What the glass did to it on the way: share of its speed lost, the yaw it struck with, jacket gone.
        glass: g ? {
          lost: 1 - g.speed / hurt.glass[0]!.th.sheets[0]!.speedIn,
          stripped: g.stripped,
          yawRad: yawAfter(g.yawMax, g.swingM, Math.hypot(hurt.hit.pos[0] - g.pos[0], hurt.hit.pos[1] - g.pos[1], hurt.hit.pos[2] - g.pos[2])),
        } : null,
      } : null;
      return { rounds: `${mag + (chambered ? 1 : 0)} / ${rifle.magazine}`, state, shot, wound };
    },
  };
}
