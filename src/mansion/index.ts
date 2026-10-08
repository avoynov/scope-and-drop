/**
 * scope-and-drop mansion module.
 *
 *   const bp = generateMansion({ seed: 'match-42' });   // pure data, runs anywhere
 *   const built = buildMansion(bp, { renderer });        // three.js scene (browser)
 */
export { generateMansion, movePerch, resolveOptions, SCHEMA } from './generate';
export { PERCH_ARC_DEG, PERCH_MAX_ELEVATION_DEG, perchEye, perchEyeAt, perchPlan } from './site/perch';
export { STYLES, STYLE_IDS } from './core/styles';
export { Rng } from './core/rng';
export { terrainHeight } from './site/terrain';
export { SightlineTracer } from './analysis/sightlines';
export { collectOccluders } from './analysis/occluders';
export { navCellAt, navComponents } from './analysis/nav';
export { DEFAULT_REQUIRED_POIS, POI_VISIBLE } from './analysis/validate';
export type * from './core/types';
export type { Rect, Vec2, Vec3 } from './core/geom';
