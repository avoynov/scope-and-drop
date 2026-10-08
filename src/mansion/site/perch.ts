/**
 * Sniper perch geometry. The sniper may lie anywhere along an arc of the
 * treeline facing the garden front; the bearing is chosen before the mission.
 */
import type { Vec3 } from '../core/geom';
import { snap } from '../core/rng';
import type { TerrainSpec } from '../core/types';
import { terrainHeight } from './terrain';

/** Half-width of the arc the sniper can choose from, degrees off the garden axis. */
export const PERCH_ARC_DEG = 38;

export function perchPlan(zGarden: number, azimuthDeg: number, distance: number): { x: number; z: number } {
  const a = (azimuthDeg * Math.PI) / 180;
  return { x: snap(Math.sin(a) * distance, 0.01), z: snap(zGarden + Math.cos(a) * distance, 0.01) };
}

/** Eye position for a prone sniper at a bearing: on the ground, lifted onto a mound if the brow of the hill would cut the sightline. */
export function perchEye(terrain: TerrainSpec, zGarden: number, groundFloorY: number, azimuthDeg: number, distance: number): Vec3 {
  const { x: px, z: pz } = perchPlan(zGarden, azimuthDeg, distance);
  let eyeY = terrainHeight(terrain, px, pz) + 0.55;
  const torsoY = groundFloorY + 1.3;
  let lift = 0;
  for (let i = 1; i < 40; i++) {
    const t = i / 40;
    const x = px + (0 - px) * t;
    const z = pz + (zGarden - pz) * t;
    const rayY = eyeY + (torsoY - eyeY) * t;
    lift = Math.max(lift, terrainHeight(terrain, x, z) + 0.3 - rayY);
  }
  eyeY += Math.min(2.5, Math.max(0, lift) * 1.15);
  return { x: px, y: snap(eyeY, 0.01), z: pz };
}
