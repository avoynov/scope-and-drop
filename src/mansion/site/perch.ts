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

/** Highest the sniper may go: looking down at 60° is enough to see the dance floor through the dome. */
export const PERCH_MAX_ELEVATION_DEG = 60;

/**
 * Eye position at a bearing and an elevation (degrees above the horizon, seen from the garden front).
 * Elevation keeps the range: the eye moves up and in along a sphere centred on the front of the house.
 * At 0, or below what the treeline already gives, the sniper is prone on the ground. Higher positions
 * have no ground under them; they are an aerial vantage.
 */
export function perchEyeAt(terrain: TerrainSpec, zGarden: number, groundFloorY: number, azimuthDeg: number, elevationDeg: number, distance: number): Vec3 {
  const ground = perchEye(terrain, zGarden, groundFloorY, azimuthDeg, distance);
  if (elevationDeg <= 0) return ground;
  const el = (Math.min(PERCH_MAX_ELEVATION_DEG, elevationDeg) * Math.PI) / 180;
  const y = groundFloorY + 3 + distance * Math.sin(el);
  if (y <= ground.y) return ground;
  const p = perchPlan(zGarden, azimuthDeg, distance * Math.cos(el));
  return { x: p.x, y: snap(y, 0.01), z: p.z };
}
