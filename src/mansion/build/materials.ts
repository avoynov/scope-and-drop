/**
 * Material table. Bucket keys used by the meshers map to a material recipe;
 * colour comes mostly from vertex tints, so one material serves every room.
 */
import * as THREE from 'three';
import type { ScopedLighting } from './lighting';
import type { TextureKey, TextureLibrary } from './textures';

export interface MaterialRecipe {
  tex?: TextureKey;
  color?: string;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  /** Not lit by scoped lights (emissive-only things). */
  unlit?: boolean;
  envMapIntensity?: number;
  depthWrite?: boolean;
  /** Skip roughness map (use constant roughness). */
  flatRoughness?: boolean;
}

/** Default opacity of roof glazing, seen square-on. */
export const ROOF_GLASS_OPACITY = 0.7;

export const RECIPES: Record<string, MaterialRecipe> = {
  // Exterior masonry
  'ext-wall-limestone': { tex: 'ashlar', normalScale: 1 },
  'ext-wall-brick': { tex: 'brick', normalScale: 1 },
  'ext-wall-stucco': { tex: 'stucco', normalScale: 0.6 },
  'ext-rustic': { tex: 'rusticated', normalScale: 1.2 },
  'ext-base': { tex: 'ashlar', normalScale: 1 },
  'ext-trim': { tex: 'stucco', normalScale: 0.5, roughness: 0.75 },
  chimney: { tex: 'brick', normalScale: 1 },
  'roof-slate': { tex: 'slate', normalScale: 1.2 },
  'roof-zinc': { tex: 'zinc', metalness: 0.55, normalScale: 1 },
  'roof-lead': { tex: 'lead', metalness: 0.25, normalScale: 1 },
  frame: { color: '#ffffff', roughness: 0.55 },
  door: { tex: 'wood', roughness: 0.4, normalScale: 0.3 },
  iron: { color: '#1b1d1f', roughness: 0.45, metalness: 0.7 },
  glass: { color: '#0c1116', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6 },
  // Roof glazing (not the dome): darker than window glass, blue-grey, lightly textured. Opacity is adjustable (BuildOptions.roofGlassOpacity).
  'roof-glass': { tex: 'roofglass', color: '#4a5d70', normalScale: 0.6, transparent: true, opacity: ROOF_GLASS_OPACITY, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.3 },
  'glass-lit': { color: '#1a1206', emissive: '#ffb066', emissiveIntensity: 2.2, roughness: 0.1, unlit: true },
  sheer: { color: '#f2ede2', roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false },
  // Interior shells
  'wall-damask': { tex: 'damask', normalScale: 0.6 },
  'wall-silk': { tex: 'silk', normalScale: 0.4 },
  'wall-stripe': { tex: 'stripe', normalScale: 0.3 },
  'wall-paneling': { tex: 'paneling', normalScale: 1 },
  'wall-paint': { tex: 'plaster', normalScale: 0.4 },
  'wall-stone': { tex: 'ashlar', normalScale: 0.6 },
  'floor-herringbone': { tex: 'herringbone' },
  'floor-parquet': { tex: 'parquet' },
  'floor-boards': { tex: 'boards' },
  'floor-marble': { tex: 'marble-floor' },
  'floor-checker': { tex: 'checker' },
  'floor-stone': { tex: 'flagstone' },
  'floor-carpet': { tex: 'carpet' },
  ceiling: { tex: 'plaster', normalScale: 0.3 },
  'int-trim': { tex: 'plaster', roughness: 0.5, normalScale: 0.2 },
  // Furniture & fittings
  'wood-dark': { tex: 'wood', roughness: 0.38 },
  'wood-mid': { tex: 'wood', roughness: 0.45 },
  gilt: { color: '#c9a24a', roughness: 0.32, metalness: 0.9 },
  brass: { color: '#b8913e', roughness: 0.28, metalness: 0.95 },
  fabric: { tex: 'fabric', normalScale: 0.5, side: THREE.DoubleSide },
  leather: { tex: 'fabric', roughness: 0.5, normalScale: 0.3, color: '#ffffff' },
  marble: { tex: 'marble', roughness: 0.22 },
  lacquer: { color: '#060606', roughness: 0.12, metalness: 0.1 },
  felt: { tex: 'fabric', color: '#ffffff', roughness: 0.95 },
  books: { tex: 'books', normalScale: 0.8 },
  painting: { tex: 'paintings', roughness: 0.35, normalScale: 0.2 },
  mirror: { color: '#8f98a0', roughness: 0.06, metalness: 1 },
  bulb: { color: '#ffd9a0', emissive: '#ffc27a', emissiveIntensity: 6, unlit: true },
  shade: { color: '#f0dcb8', emissive: '#ffb468', emissiveIntensity: 0.9, roughness: 0.9 },
  fire: { color: '#ff7a1a', emissive: '#ff6a10', emissiveIntensity: 5, unlit: true },
  crystal: { color: '#ffffff', emissive: '#ffe2b0', emissiveIntensity: 1.6, roughness: 0.1, unlit: true },
  bottles: { color: '#3b5a3a', roughness: 0.15 },
  // A cinema screen showing a picture, and a lit indoor pool.
  screen: { color: '#0a0e14', emissive: '#a9c8ff', emissiveIntensity: 1.5, roughness: 0.6, unlit: true },
  'pool-water': { color: '#0b2a33', emissive: '#2f9fb8', emissiveIntensity: 0.55, roughness: 0.08, envMapIntensity: 1.6 },
  rug0: { tex: 'rug0', roughness: 0.95, normalScale: 0.5 },
  rug1: { tex: 'rug1', roughness: 0.95, normalScale: 0.5 },
  rug2: { tex: 'rug2', roughness: 0.95, normalScale: 0.5 },
  rug3: { tex: 'rug3', roughness: 0.95, normalScale: 0.5 },
  rug4: { tex: 'rug4', roughness: 0.95, normalScale: 0.5 },
  white: { color: '#ffffff', roughness: 0.6 },
  // Site
  grass: { tex: 'grass', normalScale: 0.6 },
  gravel: { tex: 'gravel', normalScale: 1 },
  terrace: { tex: 'flagstone', normalScale: 1 },
  hedge: { tex: 'foliage', normalScale: 0.8 },
  soil: { tex: 'soil' },
  bark: { tex: 'bark' },
  foliage: { tex: 'foliage', normalScale: 0.55, roughness: 0.85 },
  // Not mirror-smooth: the fountain's uplight sits just above the surface, and a mirror highlight
  // that close blows out the bloom and veils the house from the perch.
  water: { color: '#05080b', roughness: 0.16, metalness: 0.0, envMapIntensity: 2.2 },
  lamp: { color: '#ffd29a', emissive: '#ffbe73', emissiveIntensity: 2.4, unlit: true },
};

export class MaterialLibrary {
  private cache = new Map<string, THREE.MeshStandardMaterial>();

  constructor(
    private readonly textures: TextureLibrary,
    private readonly lighting: ScopedLighting,
    private readonly env: THREE.Texture | null,
  ) {}

  get(key: string): THREE.MeshStandardMaterial {
    let m = this.cache.get(key);
    if (m) return m;
    const r = RECIPES[key];
    if (!r) throw new Error(`no material recipe for ${key}`);
    m = new THREE.MeshStandardMaterial({
      color: r.color ?? '#ffffff',
      roughness: r.roughness ?? 1,
      metalness: r.metalness ?? 0,
      vertexColors: true,
      transparent: r.transparent ?? false,
      opacity: r.opacity ?? 1,
      side: r.side ?? THREE.FrontSide,
      depthWrite: r.depthWrite ?? true,
    });
    m.name = key;
    if (r.tex) {
      const t = this.textures.get(r.tex);
      m.map = t.map;
      m.normalMap = t.normalMap;
      m.normalScale.setScalar(r.normalScale ?? 1);
      if (!r.flatRoughness && r.roughness === undefined) m.roughnessMap = t.roughnessMap;
    }
    if (r.emissive) {
      m.emissive = new THREE.Color(r.emissive);
      m.emissiveIntensity = r.emissiveIntensity ?? 1;
    }
    if (this.env && !r.unlit) {
      m.envMap = this.env;
      m.envMapIntensity = r.envMapIntensity ?? 1;
    }
    if (!r.unlit) this.lighting.patch(m);
    if (key === 'glass' || key === 'roof-glass') patchGlass(m);
    this.cache.set(key, m);
    return m;
  }

  all(): THREE.MeshStandardMaterial[] {
    return [...this.cache.values()];
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

/** Fresnel-weighted alpha: clear head-on, mirror-like at grazing angles. */
function patchGlass(m: THREE.MeshStandardMaterial): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
{
  float fres = pow( 1.0 - saturate( abs( dot( normalize( vViewPosition ), normal ) ) ), 4.0 );
  gl_FragColor.a = mix( opacity, 0.92, fres );
}`,
    );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `glass|${key()}`;
}
