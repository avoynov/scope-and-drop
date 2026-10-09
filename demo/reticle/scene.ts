/**
 * High-desert range after the reference footage: rolling sage flats, a lone boulder, a white mannequin
 * torso on an orange stake (1.7 m tall overall, so the PSO rangefinder reads it), a wire fence, haze.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

function hash(x: number, y: number): number {
  // murmur3-style finaliser over both coordinates; a single multiply-add leaves visible lattice streaks.
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x9e3779b9, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, oct: number): number {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    a *= 0.5;
  }
  return s;
}

function vnoise3(x: number, y: number, z: number): number {
  const zi = Math.floor(z);
  const fz = z - zi;
  const w = fz * fz * (3 - 2 * fz);
  // Two decorrelated 2D slices blended along z: cheap, and constant along no axis.
  return vnoise(x + zi * 31.7, y - zi * 17.3) * (1 - w) + vnoise(x + (zi + 1) * 31.7, y - (zi + 1) * 17.3) * w;
}
function fbm3(x: number, y: number, z: number, oct: number): number {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise3(x, y, z);
    x = x * 2.03 + 17.1; y = y * 2.03 - 9.7; z = z * 2.03 + 4.3;
    a *= 0.5;
  }
  return s;
}

/** Terrain height (m). Gentle swells, a shallow basin around the target line, hills beyond 1.5 km. */
export function heightAt(x: number, z: number): number {
  const d = Math.hypot(x, z);
  let h = (fbm(x / 420, z / 420, 4) - 0.5) * 14 + (fbm(x / 60, z / 60, 3) - 0.5) * 1.6;
  h += Math.max(0, d - 1500) * 0.08 * fbm(x / 900 + 3, z / 900, 3);
  // The shooter's hide: a low rise that looks down onto the flats.
  h += 6 * Math.exp(-((d / 70) ** 2));
  return h;
}

export const RANGE_M = 412;
/** Target lies down-range on -Z, a touch right of the camera's start bearing. */
export const TARGET = new THREE.Vector3(18, 0, -RANGE_M);
export const EYE_HEIGHT = 1.1;

/** Shared GLSL value noise. */
const NOISE = /* glsl */ `
  // Integer hash: float hashes fall apart into streaks at world coordinates of hundreds of metres.
  // pcg2d (Jarzynski & Olano 2020); cheaper hashes show diagonal streaks across a lattice.
  float h21(vec2 p){ uvec2 v = uvec2(ivec2(p) + 1048576) * 1664525u + 1013904223u;
    v.x += v.y*1664525u; v.y += v.x*1664525u; v ^= v >> 16u;
    v.x += v.y*1664525u; v.y += v.x*1664525u; v ^= v >> 16u;
    return float(v.x >> 8) * (1./16777216.); }
  float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
  // Band-limited fbm: octaves finer than a pixel fade out instead of shimmering.
  float fbmAA(vec2 p, float px){ float s=0., a=.5, f=1.;
    for(int i=0;i<7;i++){ float w = 1. - smoothstep(.25,.6, px*f); s += a*w*(vn(p*f)-.5); f*=2.07; a*=.5; }
    return s; }
`;

function proceduralLambert(color: THREE.ColorRepresentation, body: string): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vONrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.)).xyz;\nvONrm = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vONrm;\n${NOISE}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );\n{ ${body} }`);
  };
  return m;
}

export interface Range {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  targetHead: THREE.Vector3;
  targetFoot: THREE.Vector3;
}

export function buildRange(): Range {
  const scene = new THREE.Scene();
  const haze = new THREE.Color(0xc7d0d6);
  scene.background = haze.clone();
  scene.fog = new THREE.FogExp2(haze, 0.0002);

  // Sky dome: pale, washed-out high-desert sky, brighter at the horizon.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(8000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec3 vD; void main(){ float h = max(vD.y, 0.);
        vec3 c = mix(vec3(.80,.84,.88), vec3(.42,.58,.78), pow(h, .55));
        gl_FragColor = vec4(c, 1.); }`,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const sun = new THREE.DirectionalLight(0xfff2de, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  const sc = sun.shadow.camera;
  sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 300;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xc5d6ea, 0x8a7656, 0.8));

  // Ground: one big tessellated sheet, denser near the line of fire.
  const ground = new THREE.PlaneGeometry(9000, 9000, 360, 360);
  ground.rotateX(-Math.PI / 2);
  const gp = ground.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < gp.count; i++) {
    // Warp the grid so vertices crowd the first kilometre.
    let x = gp.getX(i);
    let z = gp.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0) {
      const k = Math.pow(r / 6364, 1.9) * 6364 / r;
      x *= k; z *= k;
    }
    gp.setXYZ(i, x, heightAt(x, z), z);
  }
  ground.computeVertexNormals();
  const groundMat = proceduralLambert(0xffffff, /* glsl */ `
    // Geometric mean of the footprint: keeps grain at grazing angles a pure isotropic filter would erase.
    vec2 fw = fwidth(vWPos.xz);
    float px = sqrt(fw.x*fw.y)*1.4;
    vec2 p = vWPos.xz;
    float big = fbmAA(p/38., px/38.);
    float mid = fbmAA(p/3.1 + 11., px/3.1);
    float fine = fbmAA(p*3.3, px*3.3);
    float blades = fbmAA(p*11.+3., px*11.);
    vec3 straw = vec3(.68,.60,.42);
    vec3 dirt = vec3(.52,.43,.32);
    vec3 dry = vec3(.80,.74,.60);
    vec3 c = mix(straw, dirt, smoothstep(-.1,.25, big + mid*.6));
    c = mix(c, dry, smoothstep(.05,.3, mid + fine*.5) * .55);
    c *= 1. + fine*.9 + blades*1.1;
    // Grass tufts: dark bases, sun-bleached tips.
    float tuft = fbmAA(p*27.+9., px*27.);
    c *= 1. + tuft*1.2;
    diffuseColor.rgb = c;
  `);
  const groundMesh = new THREE.Mesh(ground, groundMat);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Sagebrush: low silver-grey domes, scattered across the sector the shooter can see.
  // A sage clump: several lumpy lobes merged, so the silhouette is ragged rather than a pebble.
  const lobes: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const lobe = new THREE.IcosahedronGeometry(0.42 + hash(k, 41) * 0.25, 1);
    const a = (k / 7) * Math.PI * 2;
    const rr = k === 0 ? 0 : 0.45 + hash(k, 42) * 0.25;
    lobe.translate(Math.cos(a) * rr, 0.15 + hash(k, 43) * 0.35 - rr * 0.25, Math.sin(a) * rr);
    lobes.push(lobe.deleteAttribute('uv'));
  }
  const sage = mergeVertices(mergeGeometries(lobes).deleteAttribute('normal'));
  const sp = sage.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
    const n = 0.85 + 0.3 * hash(i, 77);
    sp.setXYZ(i, x * n, Math.max(y, -0.05) * n, z * n);
  }
  sage.computeVertexNormals();
  const sageMat = proceduralLambert(0xffffff, /* glsl */ `
    float px = length(fwidth(vWPos.xz));
    float n = fbmAA(vWPos.xz*9. + vWPos.y*7., px*9.);
    float leaf = fbmAA(vWPos.xz*31. - vWPos.y*23., px*31.);
    diffuseColor.rgb *= .85 + n*1.4 + leaf*1.6;
  `);
  const N = 40000;
  const bushes = new THREE.InstancedMesh(sage, sageMat, N);
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  let placed = 0;
  for (let i = 0; placed < N && i < N * 4; i++) {
    const t = hash(i, 1);
    const dist = 140 + Math.pow(t, 0.8) * 1700;
    const bearing = (hash(i, 2) - 0.5) * 0.9;
    const x = Math.sin(bearing) * dist;
    const z = -Math.cos(bearing) * dist;
    // Keep the boulder face and the target lane clear.
    if (Math.hypot(x - TARGET.x, z - TARGET.z - 8) < 7) continue;
    // Clumpy distribution.
    if (vnoise(x / 23, z / 23) < 0.33) continue;
    const s = 0.22 + hash(i, 3) * 0.4;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, 4) * 6.28);
    m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.05, z), q, new THREE.Vector3(s * (0.9 + hash(i, 5) * 0.6), s * (0.55 + hash(i, 6) * 0.35), s));
    bushes.setMatrixAt(placed, m);
    const g = hash(i, 7);
    col.setRGB(0.44 + g * 0.1, 0.48 + g * 0.08, 0.40 + g * 0.05);
    bushes.setColorAt(placed, col);
    placed++;
  }
  bushes.count = placed;
  scene.add(bushes);

  // The boulder.
  const rock = mergeVertices(new THREE.IcosahedronGeometry(1, 6).deleteAttribute('normal').deleteAttribute('uv'));
  const rp = rock.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < rp.count; i++) {
    v.fromBufferAttribute(rp, i);
    const n = fbm3(v.x * 1.3 + 5, v.y * 1.3, v.z * 1.3, 5);
    const crack = Math.abs(vnoise3(v.x * 4, v.y * 4, v.z * 4) - 0.5) < 0.035 ? -0.035 : 0;
    v.multiplyScalar(0.55 + n * 0.95 + crack);
    if (v.y > 0.7) v.y = 0.7 + (v.y - 0.7) * 0.5; // weathered, flattened crown
    rp.setXYZ(i, v.x, v.y, v.z);
  }
  rock.computeVertexNormals();
  const bx = TARGET.x + 0.6;
  const bz = TARGET.z - 7.2;
  const by = heightAt(bx, bz);
  const rockMat = proceduralLambert(0xffffff, /* glsl */ `
    float px = length(fwidth(vWPos));
    vec3 p = vWPos;
    // Tri-planar-ish: mix noise from the three planes so no face is stretched.
    vec3 an = abs(normalize(cross(dFdx(p), dFdy(p))));
    an /= an.x + an.y + an.z;
    float n = fbmAA(p.yz*1.7, px*1.7)*an.x + fbmAA(p.xz*1.7, px*1.7)*an.y + fbmAA(p.xy*1.7, px*1.7)*an.z;
    float f = fbmAA(p.yz*11., px*11.)*an.x + fbmAA(p.xz*11., px*11.)*an.y + fbmAA(p.xy*11., px*11.)*an.z;
    float cr = fbmAA(p.yz*3.3+7., px*3.3)*an.x + fbmAA(p.xz*3.3+7., px*3.3)*an.y + fbmAA(p.xy*3.3+7., px*3.3)*an.z;
    vec3 c = mix(vec3(.30,.23,.16), vec3(.56,.46,.33), smoothstep(-.3,.3,n));
    c = mix(c, vec3(.70,.68,.58), smoothstep(.1,.25, cr)*.55);    // pale lichen / weathered crust
    c *= mix(.45, 1., smoothstep(-.22,-.12, cr));                   // dark cracks and pits
    c *= 1. + f*.9;
    // Darker, damp base where it meets the ground.
    c *= mix(.72, 1., smoothstep(.0, .9, p.y - ${(by - 0.3).toFixed(3)}));
    diffuseColor.rgb = c;
  `);
  const boulder = new THREE.Mesh(rock, rockMat);
  boulder.position.set(bx, by + 1.1, bz);
  boulder.scale.set(4.3, 2.9, 3.4);
  boulder.rotation.y = 0.35;
  boulder.castShadow = true;
  boulder.receiveShadow = true;
  scene.add(boulder);

  // Target: white mannequin torso on an orange stake, braced by a wire tripod.
  const ty = heightAt(TARGET.x, TARGET.z);
  TARGET.y = ty;
  const tgt = new THREE.Group();
  tgt.position.copy(TARGET);
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f1ec });
  const orange = new THREE.MeshLambertMaterial({ color: 0xd8641c });
  const steel = new THREE.MeshLambertMaterial({ color: 0x6d6a66 });
  const stake = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.86, 0.05), orange);
  stake.position.y = 0.43;
  tgt.add(stake);
  const torsoProfile = [
    [0.0, 0.0], [0.16, 0.0], [0.17, 0.08], [0.15, 0.24], [0.17, 0.4], [0.21, 0.52], [0.22, 0.58], [0.15, 0.63], [0.06, 0.66], [0.055, 0.7], [0, 0.7],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 28), white);
  torso.scale.set(1, 1, 0.55);
  torso.position.y = 0.86;
  tgt.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 20, 16), white);
  head.scale.set(0.85, 1.2, 0.95);
  head.position.y = 0.86 + 0.7 + 0.03;
  tgt.add(head);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.95), steel);
    leg.position.set(Math.cos(a) * 0.18, 0.42, Math.sin(a) * 0.18);
    leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    tgt.add(leg);
  }
  tgt.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  scene.add(tgt);

  // Wire fence on a slant across the range, steel T-posts every 5 m with the odd wooden post.
  const postGeo = new THREE.BoxGeometry(0.05, 1.25, 0.05);
  const wood = new THREE.MeshLambertMaterial({ color: 0x7a6248 });
  const wirePts: number[] = [];
  const fence = new THREE.Group();
  for (let i = -70; i <= 70; i++) {
    const x = i * 5;
    const z = -360 - x * 0.12;
    const y = heightAt(x, z);
    const post = new THREE.Mesh(postGeo, i % 6 === 0 ? wood : steel);
    post.position.set(x, y + 0.6, z);
    post.rotation.z = (hash(i, 9) - 0.5) * 0.08;
    fence.add(post);
    if (i > -70) {
      const px = x - 5, pz = -360 - px * 0.12, py = heightAt(px, pz);
      for (const h of [0.55, 0.85, 1.12]) wirePts.push(px, py + h, pz, x, y + h, z);
    }
  }
  const wires = new THREE.BufferGeometry();
  wires.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  fence.add(new THREE.LineSegments(wires, new THREE.LineBasicMaterial({ color: 0x5c5853, transparent: true, opacity: 0.6 })));
  scene.add(fence);

  // Sun high and to the left, behind the shooter's shoulder, as in the footage.
  const toSun = new THREE.Vector3(-0.55, 0.62, 0.55).normalize();
  sun.target.position.copy(TARGET);
  sun.position.copy(TARGET).addScaledVector(toSun, 120);

  return {
    scene,
    sun,
    targetHead: new THREE.Vector3(TARGET.x, ty + 1.7, TARGET.z),
    targetFoot: new THREE.Vector3(TARGET.x, ty, TARGET.z),
  };
}
