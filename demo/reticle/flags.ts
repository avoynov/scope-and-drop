/**
 * Range wind flags: red nylon flags, 1.2 × 0.6 m, on 3.5 m poles beside the lanes, as on a range. Each reads
 * the wind where it stands, at its own height, from the same field the bullet flies through (src/scope/wind.ts):
 * it streams downwind at the angle the old flag rule reads back (FM 23-10: degrees from the pole ÷ 4 = mph, so
 * about 9° per m/s and straight out from 10 m/s) and flaps faster the harder it blows. Seen end-on, a flag in a
 * head or tail wind shows almost nothing of its width, which is the cue that the wind is worth little.
 */
import * as THREE from 'three';
import { windAt, type Wind } from '../../src/scope/wind';

export const FLAG_POLE_M = 3.5;
const FLAG_L = 1.2;
const FLAG_H = 0.6;

/** Degrees from the pole per m/s of wind: 4° per mph. */
export const FLAG_DEG_PER_MS = 4 / 0.44704;

export interface Flags {
  group: THREE.Group;
  /** Once a frame: the wind at each flag, and how far its flapping has got (`dt` 0 for a still at time `t`). */
  update: (t: number, dt: number, wind: Wind) => void;
}

export function createFlags(spots: readonly { x: number; z: number }[], heightAt: (x: number, z: number) => number): Flags {
  const group = new THREE.Group();
  const poleGeo = new THREE.CylinderGeometry(0.018, 0.024, FLAG_POLE_M, 8);
  poleGeo.translate(0, FLAG_POLE_M / 2, 0);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xd9d6cf });
  const clothGeo = new THREE.PlaneGeometry(1, 1, 24, 8);
  const flags = spots.map(({ x, z }, i) => {
    const y = heightAt(x, z);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, y - 0.1, z);
    pole.castShadow = true;
    pole.receiveShadow = true;
    const uniforms = {
      uFlagWind: { value: new THREE.Vector2(1, 0) },
      uFlagPhase: { value: 0 },
      uFlagSeed: { value: i * 2.17 },
    };
    const mat = new THREE.MeshLambertMaterial({ color: 0xf0552a, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uFlagWind;\nuniform float uFlagPhase, uFlagSeed;')
        .replace('#include <beginnormal_vertex>', /* glsl */ `
          // Plane x along the fly (0 at the pole), y up the hoist; the hoist hangs from the pole top.
          float fu = position.x + .5;
          float fv = .5 - position.y;
          float v = length(uFlagWind);
          vec2 dw = v > 1e-3 ? uFlagWind/v : vec2(1., 0.);
          float th = radians(clamp(${FLAG_DEG_PER_MS.toFixed(3)}*v, 4., 88.));
          vec3 dir = vec3(sin(th)*dw.x, -cos(th), sin(th)*dw.y);
          vec3 nrm = vec3(-dw.y, 0., dw.x);
          // A slack flag bunches into folds: it hangs shorter than its length.
          float L = ${FLAG_L.toFixed(2)}*(.35 + .65*sin(th));
          // Ripples run from the pole to the free end, bigger toward it and in a stronger wind.
          float a0 = .02 + .012*min(v, 10.);
          float amp = a0*fu*(.4 + .6*fu);
          float k = 6.2832/.75;
          float ph = uFlagPhase - k*fu*L + 1.3*fv + uFlagSeed;
          float wave = amp*sin(ph);
          // The free corners also lift and drop in the flag's own plane, so the flutter shows side on too.
          float lift = .55*amp*fu*sin(ph - 1.1)*(.5 + fv);
          vec3 up = vec3(0., 1., 0.);
          vec3 flagP = vec3(0., -fv*${FLAG_H.toFixed(2)}, 0.) + dir*fu*L + nrm*wave + up*lift;
          vec3 pu = dir*L + nrm*(a0*(.4 + 1.2*fu)*sin(ph) - amp*cos(ph)*k*L);
          vec3 pv = vec3(0., -${FLAG_H.toFixed(2)}, 0.) + nrm*amp*cos(ph)*1.3;
          // pv runs down the hoist (fv), the plane's -y: the front face's normal is pv × pu.
          vec3 objectNormal = normalize(cross(pv, pu));
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( tangent.xyz );
          #endif
        `)
        .replace('#include <begin_vertex>', 'vec3 transformed = flagP;');
    };
    mat.customProgramCacheKey = () => 'range-flag';
    const cloth = new THREE.Mesh(clothGeo, mat);
    cloth.position.set(x, y - 0.1 + FLAG_POLE_M - 0.02, z);
    // The shadow map is drawn once; a flapping flag would leave its shadow behind, so it casts none.
    cloth.receiveShadow = true;
    cloth.frustumCulled = false;
    group.add(pole, cloth);
    return { at: [x, y - 0.1 + FLAG_POLE_M - FLAG_H / 2, z] as const, uniforms, phase: 0 };
  });
  const W: [number, number, number] = [0, 0, 0];
  const update = (t: number, dt: number, wind: Wind) => {
    for (const f of flags) {
      windAt(wind, f.at[0], f.at[1], f.at[2], t, W);
      f.uniforms.uFlagWind.value.set(W[0], W[2]);
      // Flapping rate, Hz: about 0.5 in a breath of air, 3.7 at 10 m/s. Integrated, so a gust doesn't jump it.
      const rate = 2 * Math.PI * (0.5 + 0.32 * Math.hypot(W[0], W[2]));
      f.phase = dt > 0 ? (f.phase + rate * dt) % (2 * Math.PI * 1000) : rate * t;
      f.uniforms.uFlagPhase.value = f.phase;
    }
  };
  return { group, update };
}
