/**
 * The wind field of src/scope/wind.ts on the GPU, for the cues drawn in shaders (bushes, grass). The same gust
 * tile, terrain grid and shelter grid go up as half-float textures, and `windAt()` in GLSL does the same sums
 * as the CPU's, so a bush sways to the very gust the bullet flies through.
 */
import * as THREE from 'three';
import { CREST_PER_M, GUST_TILE_M, GUST_TILE_N, LEE_DROP, LEE_SLOPE, ROUGHNESS_M, TERRAIN_FADE_M, WIND_REF_M, gustFrame, gustSwing, gustTile, type GustFrame, type ShelterWind, type TerrainWind, type Wind } from '../../src/scope/wind';

/** Uniforms every wind-aware material shares, and the GLSL that reads them. */
export interface WindGL {
  uniforms: Record<string, THREE.IUniform>;
  /** Declarations, `vec2 gustAt(vec2 xz)` (the gust noise, speed and swing) and `vec3 windAt(vec3 p)` (m/s). */
  glsl: string;
  /** Once a frame: carry the gusts on to time `t`, and pick up a re-baked shelter. */
  update: (t: number) => void;
}

function halfTexture(data: Float32Array, w: number, h: number, format: THREE.PixelFormat, wrap: THREE.Wrapping): THREE.DataTexture {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]!);
  const tex = new THREE.DataTexture(half, w, h, format, THREE.HalfFloatType);
  tex.wrapS = tex.wrapT = wrap;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

type Grid = TerrainWind | ShelterWind;
const gridTexture = (g: Grid | undefined) =>
  g ? halfTexture(g.data, g.nx, g.nz, THREE.RGBAFormat, THREE.ClampToEdgeWrapping) : halfTexture(new Float32Array(16), 2, 2, THREE.RGBAFormat, THREE.ClampToEdgeWrapping);
// Texel centres sit on the grid's nodes: node i at uv (i + 0.5) / n.
const gridBox = (g: Grid | undefined, out = new THREE.Vector4()) =>
  g ? out.set(g.x0 - g.cell / 2, g.z0 - g.cell / 2, 1 / (g.nx * g.cell), 1 / (g.nz * g.cell)) : out.set(0, 0, 1, 1);

export function createWindGL(wind: Wind): WindGL {
  let shelter = wind.shelter;
  const uniforms: Record<string, THREE.IUniform> = {
    uGustTile: { value: halfTexture(gustTile(), GUST_TILE_N, GUST_TILE_N, THREE.RGFormat, THREE.RepeatWrapping) },
    uTerrainWind: { value: gridTexture(wind.terrain) },
    uTerrainBox: { value: gridBox(wind.terrain) },
    uShelterWind: { value: gridTexture(shelter) },
    uShelterBox: { value: gridBox(shelter) },
    // speed, gust, swing, then terrain (bit 1) and shelter (bit 2)
    uWindPar: { value: new THREE.Vector4() },
    uWindDir: { value: new THREE.Vector2() },
    uGustOff: { value: new THREE.Vector4() },
    uGustMix: { value: new THREE.Vector2() },
    uWindTime: { value: 0 },
  };
  const f: GustFrame = { dir: [0, 0], a: [0, 0], b: [0, 0], mix: 0, norm: 1 };
  const update = (t: number) => {
    if (wind.shelter !== shelter) {
      shelter = wind.shelter;
      (uniforms.uShelterWind!.value as THREE.Texture).dispose();
      uniforms.uShelterWind!.value = gridTexture(shelter);
      gridBox(shelter, uniforms.uShelterBox!.value);
    }
    gustFrame(wind, t, f);
    uniforms.uWindPar!.value.set(wind.speed, wind.gust, gustSwing(wind.gust), (wind.terrain ? 1 : 0) + (shelter ? 2 : 0));
    uniforms.uWindDir!.value.set(f.dir[0], f.dir[1]);
    uniforms.uGustOff!.value.set(f.a[0], f.a[1], f.b[0], f.b[1]);
    uniforms.uGustMix!.value.set(f.mix, f.norm);
    uniforms.uWindTime!.value = t;
  };
  update(0);
  const glsl = /* glsl */ `
    uniform sampler2D uGustTile, uTerrainWind, uShelterWind;
    uniform vec4 uTerrainBox, uShelterBox, uWindPar, uGustOff;
    uniform vec2 uWindDir, uGustMix;
    uniform float uWindTime;
    // Wind speed at height a over open ground, as a share of the speed at 3 m (log law).
    float windProfile(float a){ return min(1.6, log(max(.3, a)/${ROUGHNESS_M.toFixed(3)})/${Math.log(WIND_REF_M / ROUGHNESS_M).toFixed(6)}); }
    // The gust noise at a point: x the speed's, y the direction's, each about ±1.
    vec2 gustAt(vec2 xz){
      vec2 sn = vec2(dot(xz, uWindDir), dot(xz, vec2(-uWindDir.y, uWindDir.x))) / vec2(${GUST_TILE_M.along.toFixed(1)}, ${GUST_TILE_M.across.toFixed(1)});
      return mix(texture(uGustTile, sn + uGustOff.xy).rg, texture(uGustTile, sn + uGustOff.zw).rg, uGustMix.x) * uGustMix.y;
    }
    vec3 windAt(vec3 p){
      if (uWindPar.x <= 0.) return vec3(0.);
      vec2 g = gustAt(p.xz);
      float sp = max(0., uWindPar.x*(1. + uWindPar.y*g.x));
      float d = uWindPar.z*g.y;
      vec2 h = vec2(uWindDir.x*cos(d) - uWindDir.y*sin(d), uWindDir.x*sin(d) + uWindDir.y*cos(d));
      vec2 slope = vec2(0.);
      float fade = 0.;
      if (mod(uWindPar.w, 2.) > .5) {
        vec4 tr = texture(uTerrainWind, (p.xz - uTerrainBox.xy)*uTerrainBox.zw);
        float agl = max(0., p.y - tr.w);
        fade = exp(-agl/${TERRAIN_FADE_M.toFixed(1)});
        slope = tr.yz;
        float lee = smoothstep(${LEE_SLOPE[0].toFixed(3)}, ${LEE_SLOPE[1].toFixed(3)}, -dot(h, slope));
        sp *= windProfile(agl)*max(.3, 1. + fade*(${CREST_PER_M.toFixed(4)}*tr.x - ${LEE_DROP.toFixed(3)}*lee));
      }
      if (uWindPar.w > 1.5) {
        vec4 sh = texture(uShelterWind, (p.xz - uShelterBox.xy)*uShelterBox.zw);
        sp *= 1. - sh.x*(1. - smoothstep(sh.y, max(sh.z, sh.y + .01), p.y));
      }
      h *= sp;
      return vec3(h.x, fade*dot(h, slope), h.y);
    }
  `;
  return { uniforms, glsl, update };
}
