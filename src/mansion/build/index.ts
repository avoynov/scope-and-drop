/**
 * buildMansion: blueprint → three.js scene graph.
 *
 * Static geometry is merged per material (a few dozen draw calls for the whole
 * estate), lit by scoped room lights + sky IBL + one soft skylight key with
 * shadows. Returns handles the game needs: the root group, the perch camera
 * pose, materials (for quality toggles) and a dispose().
 */
import * as THREE from 'three';
import type { LightSpec, MansionBlueprint } from '../core/types';
import { buildFacades, buildInteriors, buildReveals, type ArchContext } from './arch';
import { buildAtrium, buildDome } from './atrium';
import { GeometryBuilder } from './geometry';
import { ScopedLighting } from './lighting';
import { MaterialLibrary, RECIPES } from './materials';
import { buildLanterns, buildProps } from './props';
import { buildPorticos, buildRoofs } from './roofs';
import { buildGardens, buildTerrain, buildTrees } from './site';
import { dirFromAzEl, TwilightSky } from './sky';
import { buildStairs } from './stairs';
import { TextureLibrary } from './textures';

export type Quality = 'low' | 'medium' | 'high';

export interface BuildOptions {
  renderer: THREE.WebGLRenderer;
  quality?: Quality;
  /** Multiplier on all scoped (room + exterior) light intensities. */
  lightScale?: number;
  skyIntensity?: number;
  /** Opacity of roof glazing seen square-on, 0 (clear) to 1 (solid); default 0.7. The dome and windows are not affected. Also settable later: `materials.get('roof-glass').opacity`. */
  roofGlassOpacity?: number;
  shadows?: boolean;
}

export interface BuiltMansion {
  root: THREE.Group;
  sky: TwilightSky;
  envMap: THREE.Texture;
  keyLight: THREE.DirectionalLight;
  fog: THREE.FogExp2;
  lighting: ScopedLighting;
  materials: MaterialLibrary;
  /** Perch camera pose. */
  perch: { position: THREE.Vector3; target: THREE.Vector3; fovMin: number; fovMax: number };
  stats: { triangles: number; meshes: number; buildMs: number };
  dispose(): void;
}

const QUALITY: Record<Quality, { tex: number; aniso: number; shadow: number; level: number }> = {
  low: { tex: 0.5, aniso: 2, shadow: 1024, level: 0 },
  medium: { tex: 1, aniso: 4, shadow: 2048, level: 1 },
  high: { tex: 1, aniso: 8, shadow: 4096, level: 2 },
};

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildMansion(bp: MansionBlueprint, opts: BuildOptions): BuiltMansion {
  const t0 = performance.now();
  const q = QUALITY[opts.quality ?? 'medium'];
  const renderer = opts.renderer;
  const root = new THREE.Group();
  root.name = `mansion:${bp.seed}`;

  const sky = new TwilightSky(bp.site.sky, { intensity: opts.skyIntensity ?? 0.85 });
  const envMap = sky.bakeEnvironment(renderer);
  // Interior lights are in candela; this scale balances them against the sky so lit
  // windows read about as bright as the horizon, the blue-hour rule of thumb.
  const lighting = new ScopedLighting(bp, opts.lightScale ?? 0.08);
  const textures = new TextureLibrary(Math.min(q.aniso, renderer.capabilities.getMaxAnisotropy()), q.tex);
  const materials = new MaterialLibrary(textures, lighting, envMap);
  if (opts.roofGlassOpacity !== undefined) materials.get('roof-glass').opacity = Math.max(0, Math.min(1, opts.roofGlassOpacity));

  const g = new GeometryBuilder();
  const rand = mulberry(bp.seed.length * 7919 + bp.attempt);
  const ctx: ArchContext = { bp, g, rooms: new Map(bp.rooms.map((r) => [r.id, r])), style: bp.style, rand };
  buildInteriors(ctx);
  buildAtrium(ctx);
  buildReveals(ctx);
  buildFacades(ctx);
  const roofMark = g.mark();
  buildRoofs(ctx);
  buildDome(ctx, roofMark);
  buildPorticos(ctx);
  buildStairs(ctx);
  buildProps(bp, g, rand);
  buildLanterns(bp.lights, g, (l: LightSpec) => (l.z > 0 ? 0 : Math.PI));
  buildGardens(ctx);

  let triangles = 0;
  let meshes = 0;
  for (const [key, geo] of g.build()) {
    const mat = materials.get(RECIPES[key] ? key : 'white');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = key;
    const transparent = mat.transparent;
    mesh.castShadow = !transparent && !key.startsWith('floor-') && key !== 'ceiling' && !key.startsWith('rug');
    mesh.receiveShadow = !transparent;
    if (transparent) mesh.renderOrder = 2;
    root.add(mesh);
    triangles += (geo.index?.count ?? 0) / 3;
    meshes++;
  }
  const terrain = new THREE.Mesh(buildTerrain(bp, q.level), materials.get('grass'));
  terrain.name = 'terrain';
  terrain.receiveShadow = true;
  root.add(terrain);
  triangles += (terrain.geometry.index?.count ?? 0) / 3;
  const trees = buildTrees(bp, materials, true);
  root.add(trees);
  root.add(sky.mesh);

  // Soft skylight key from the glow side: gives the façade form and lets the
  // sunset side rim the roofline. Shadows keep it out of the interiors.
  const s = bp.site.sky;
  const keyDir = dirFromAzEl(s.sunAzimuthDeg, 32);
  const keyLight = new THREE.DirectionalLight(new THREE.Color(0.72, 0.68, 0.86), 0.55);
  const fp = bp.stats.footprint;
  const cx = (fp.x0 + fp.x1) / 2;
  const cz = (fp.z0 + fp.z1) / 2;
  const radius = Math.hypot(fp.x1 - fp.x0, fp.z1 - fp.z0) / 2 + 25;
  keyLight.position.set(cx + keyDir.x * 150, keyDir.y * 150, cz + keyDir.z * 150);
  keyLight.target.position.set(cx, 4, cz);
  keyLight.castShadow = opts.shadows ?? true;
  keyLight.shadow.mapSize.setScalar(q.shadow);
  const cam = keyLight.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = 1;
  cam.far = 400;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.04;
  keyLight.shadow.radius = 4;
  root.add(keyLight);
  root.add(keyLight.target);

  const fog = new THREE.FogExp2(sky.hazeColor.clone(), 0.0016);

  const eye = bp.site.perch.eye;
  const tgt = bp.site.perch.target;
  return {
    root,
    sky,
    envMap,
    keyLight,
    fog,
    lighting,
    materials,
    perch: {
      position: new THREE.Vector3(eye.x, eye.y, eye.z),
      target: new THREE.Vector3(tgt.x, tgt.y, tgt.z),
      fovMin: bp.site.perch.fovMinDeg,
      fovMax: bp.site.perch.fovMaxDeg,
    },
    stats: { triangles: Math.round(triangles), meshes, buildMs: Math.round(performance.now() - t0) },
    dispose() {
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      });
      materials.dispose();
      textures.dispose();
      lighting.texture.dispose();
      envMap.dispose();
      sky.dispose();
    },
  };
}

export { ScopedLighting } from './lighting';
export { TwilightSky } from './sky';
