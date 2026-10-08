/**
 * Scoped (clustered) static lighting.
 *
 * Hundreds of warm interior lights are the whole look at blue hour, but
 * forward-rendered point lights cost every fragment and leak through walls.
 * Instead every static light belongs to a scope: a room, or an exterior grid
 * cell. Light data lives in one float texture; each vertex carries its scope
 * (aScope; -1 = exterior, resolved per fragment from world position). A
 * fragment shades only its own scope's lights (max 8), plus a per-room bounce
 * term, and indoor fragments mute the sky IBL. Any MeshStandard/Physical
 * material can be patched.
 */
import * as THREE from 'three';
import type { LightSpec, MansionBlueprint } from '../core/types';

export const SCOPE_MAX = 8;
/** Texels per light: position+range, colour, spot direction+cone. */
const TEXELS = 3;
/** Exterior lights are binned into square cells of this size (m). */
const EXT_CELL = 8;
/** Mean surface reflectance used for the per-room bounce estimate. */
const RHO = 0.42;

interface PackedLight {
  x: number;
  y: number;
  z: number;
  range: number;
  r: number;
  g: number;
  b: number;
  /** Spot aim and cos(cone); cone = -2 marks an omni light. */
  dx: number;
  dy: number;
  dz: number;
  cone: number;
}

function pack(l: LightSpec): PackedLight {
  const d = l.dir ?? [0, -1, 0];
  return { x: l.x, y: l.y, z: l.z, range: l.range, r: l.color[0] * l.intensity, g: l.color[1] * l.intensity, b: l.color[2] * l.intensity, dx: d[0], dy: d[1], dz: d[2], cone: l.dir ? (l.cone ?? 0.5) : -2 };
}

/** Keep the strongest lights; fold the rest into one at their weighted centroid. */
function budget(ls: LightSpec[]): PackedLight[] {
  const sorted = ls.slice().sort((a, b) => b.intensity - a.intensity);
  if (sorted.length <= SCOPE_MAX) return sorted.map(pack);
  const keep = sorted.slice(0, SCOPE_MAX - 1).map(pack);
  const rest = sorted.slice(SCOPE_MAX - 1);
  const w = rest.reduce((a, l) => a + l.intensity, 0);
  const m: PackedLight = { x: 0, y: 0, z: 0, range: 0, r: 0, g: 0, b: 0, dx: 0, dy: -1, dz: 0, cone: -2 };
  for (const l of rest) {
    const k = l.intensity / w;
    m.x += l.x * k;
    m.y += l.y * k;
    m.z += l.z * k;
    m.range = Math.max(m.range, l.range * 1.5);
    m.r += l.color[0] * l.intensity;
    m.g += l.color[1] * l.intensity;
    m.b += l.color[2] * l.intensity;
  }
  keep.push(m);
  return keep;
}

export interface ScopedLightingUniforms {
  [key: string]: THREE.IUniform;
  uLightTex: THREE.IUniform<THREE.DataTexture>;
  uExtGrid: THREE.IUniform<THREE.Vector4>;
  uExtInfo: THREE.IUniform<THREE.Vector2>;
  uLightScale: THREE.IUniform<number>;
}

export class ScopedLighting {
  readonly texture: THREE.DataTexture;
  readonly uniforms: ScopedLightingUniforms;
  readonly roomCount: number;
  /** Per-room bounce irradiance (linear RGB), useful for lighting dynamic actors. */
  readonly ambient: THREE.Color[] = [];

  constructor(bp: MansionBlueprint, intensityScale = 1) {
    const rooms = bp.rooms;
    this.roomCount = rooms.length;
    const byScope = new Map<string, LightSpec[]>();
    for (const l of bp.lights) {
      let list = byScope.get(l.scope);
      if (!list) byScope.set(l.scope, (list = []));
      list.push(l);
    }
    // Exterior grid over the reach of exterior lights.
    const ext = byScope.get('exterior') ?? [];
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const l of ext) {
      x0 = Math.min(x0, l.x - l.range);
      z0 = Math.min(z0, l.z - l.range);
      x1 = Math.max(x1, l.x + l.range);
      z1 = Math.max(z1, l.z + l.range);
    }
    if (!ext.length) {
      x0 = z0 = 0;
      x1 = z1 = EXT_CELL;
    }
    const cols = Math.max(1, Math.ceil((x1 - x0) / EXT_CELL));
    const rows = Math.max(1, Math.ceil((z1 - z0) / EXT_CELL));
    const scopes = rooms.length + cols * rows;
    const width = 1 + SCOPE_MAX * TEXELS;
    const data = new Float32Array(width * scopes * 4);
    const put = (scope: number, texel: number, a: number, b: number, c: number, d: number) => {
      const o = (scope * width + texel) * 4;
      data[o] = a;
      data[o + 1] = b;
      data[o + 2] = c;
      data[o + 3] = d;
    };
    const putLight = (scope: number, i: number, p: PackedLight) => {
      put(scope, 1 + i * TEXELS, p.x, p.y, p.z, Math.max(0.5, p.range));
      put(scope, 2 + i * TEXELS, p.r, p.g, p.b, 0);
      put(scope, 3 + i * TEXELS, p.dx, p.dy, p.dz, p.cone);
    };
    for (const r of rooms) {
      const ls = byScope.get(r.id) ?? [];
      const packed = budget(ls);
      packed.forEach((p, i) => putLight(r.index, i, p));
      // Bounce: total flux × reflectance / (area × absorption), the integrating-sphere estimate.
      const w = r.inner.x1 - r.inner.x0;
      const d = r.inner.z1 - r.inner.z0;
      const h = r.ceilingY - r.floorY;
      const area = 2 * (w * d + w * h + d * h);
      let fr = 0;
      let fg = 0;
      let fb = 0;
      for (const l of ls) {
        const flux = 4 * Math.PI * l.intensity;
        fr += flux * l.color[0];
        fg += flux * l.color[1];
        fb += flux * l.color[2];
      }
      const k = RHO / (area * (1 - RHO));
      const amb = new THREE.Color(fr * k, fg * k, fb * k);
      this.ambient[r.index] = amb;
      put(r.index, 0, amb.r, amb.g, amb.b, 0.035);
    }
    for (let cz = 0; cz < rows; cz++) {
      for (let cx = 0; cx < cols; cx++) {
        const scope = rooms.length + cz * cols + cx;
        const bx0 = x0 + cx * EXT_CELL;
        const bz0 = z0 + cz * EXT_CELL;
        const mx = bx0 + EXT_CELL / 2;
        const mz = bz0 + EXT_CELL / 2;
        const near = ext
          .map((l) => {
            const dx = Math.max(bx0 - l.x, 0, l.x - (bx0 + EXT_CELL));
            const dz = Math.max(bz0 - l.z, 0, l.z - (bz0 + EXT_CELL));
            return { l, d: Math.hypot(dx, dz), c: l.intensity / Math.max(1, (l.x - mx) ** 2 + (l.z - mz) ** 2) };
          })
          .filter((q) => q.d < q.l.range)
          .sort((a, b) => b.c - a.c)
          .slice(0, SCOPE_MAX);
        near.forEach(({ l }, i) => putLight(scope, i, pack(l)));
        put(scope, 0, 0, 0, 0, 1);
      }
    }
    this.texture = new THREE.DataTexture(data, width, scopes, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniforms = {
      uLightTex: { value: this.texture },
      uExtGrid: { value: new THREE.Vector4(x0, z0, EXT_CELL, cols) },
      uExtInfo: { value: new THREE.Vector2(rows, rooms.length) },
      uLightScale: { value: intensityScale },
    };
  }

  /** Install scoped lighting on a standard/physical material (shares uniforms). */
  patch<T extends THREE.MeshStandardMaterial>(material: T): T {
    const uniforms = this.uniforms;
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prev?.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aScope;
flat varying float vScope;
varying vec3 vScopeWorld;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
{
  vec4 sw = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
  sw = batchingMatrix * sw;
  #endif
  #ifdef USE_INSTANCING
  sw = instanceMatrix * sw;
  #endif
  vScopeWorld = ( modelMatrix * sw ).xyz;
  vScope = aScope;
}`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform highp sampler2D uLightTex;
uniform vec4 uExtGrid;
uniform vec2 uExtInfo;
uniform float uLightScale;
flat varying float vScope;
varying vec3 vScopeWorld;`,
        )
        .replace(
          '#include <lights_fragment_begin>',
          `#include <lights_fragment_begin>
vec3 scopeAmbient = vec3( 0.0 );
float scopeSky = 1.0;
{
  int scope = int( floor( vScope + 0.5 ) );
  if ( vScope < -0.5 ) {
    vec2 g = ( vScopeWorld.xz - uExtGrid.xy ) / uExtGrid.z;
    scope = ( g.x >= 0.0 && g.y >= 0.0 && g.x < uExtGrid.w && g.y < uExtInfo.x )
      ? int( uExtInfo.y ) + int( floor( g.y ) ) * int( uExtGrid.w ) + int( floor( g.x ) )
      : -1;
  }
  if ( scope >= 0 ) {
    vec4 amb = texelFetch( uLightTex, ivec2( 0, scope ), 0 );
    scopeAmbient = amb.rgb * uLightScale;
    scopeSky = amb.a;
    #if defined( RE_Direct )
    #ifdef STANDARD
    float scopeEss = material.dfg.x + material.dfg.y;
    material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / scopeEss - 1.0 );
    #endif
    IncidentLight scopeLight;
    for ( int i = 0; i < ${SCOPE_MAX}; i ++ ) {
      vec4 pr = texelFetch( uLightTex, ivec2( 1 + i * ${TEXELS}, scope ), 0 );
      if ( pr.w <= 0.0 ) break;
      vec4 cl = texelFetch( uLightTex, ivec2( 2 + i * ${TEXELS}, scope ), 0 );
      vec4 sp = texelFetch( uLightTex, ivec2( 3 + i * ${TEXELS}, scope ), 0 );
      vec3 lv = ( viewMatrix * vec4( pr.xyz, 1.0 ) ).xyz - geometryPosition;
      float ld = length( lv );
      scopeLight.direction = lv / max( ld, 1e-4 );
      float spot = 1.0;
      if ( sp.w > -1.5 ) {
        vec3 aimV = normalize( ( viewMatrix * vec4( sp.xyz, 0.0 ) ).xyz );
        spot = smoothstep( sp.w, min( 1.0, sp.w + 0.3 ), dot( -scopeLight.direction, aimV ) );
      }
      scopeLight.color = cl.rgb * uLightScale * spot * getDistanceAttenuation( ld, pr.w, 2.0 );
      scopeLight.visible = true;
      RE_Direct( scopeLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    }
    #endif
  }
}`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#if defined( RE_IndirectDiffuse )
irradiance += scopeAmbient;
iblIrradiance *= scopeSky;
#endif
#if defined( RE_IndirectSpecular )
radiance = radiance * scopeSky + scopeAmbient * ( 0.12 * ( 1.0 - scopeSky ) );
#endif
#include <lights_fragment_end>`,
        );
    };
    const key = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `scoped|${key()}`;
    return material;
  }
}
