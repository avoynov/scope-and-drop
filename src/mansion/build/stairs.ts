/** Stair mesher: solid stone (grand) or timber (service) U-return stairs. */
import type { StairFlight } from '../core/types';
import type { ArchContext } from './arch';

function dirVec(d: StairFlight['dir']): [number, number] {
  switch (d) {
    case '+x':
      return [1, 0];
    case '-x':
      return [-1, 0];
    case '+z':
      return [0, 1];
    case '-z':
      return [0, -1];
  }
}

export function buildStairs(ctx: ArchContext): void {
  const { bp, g, rooms } = ctx;
  for (const s of bp.stairs) {
    // The dome hall's curved stair is built by the atrium mesher.
    if (s.arms) continue;
    const room = rooms.get(s.bottomRoom)!;
    g.scope = room.index;
    const grand = s.kind === 'grand';
    const key = grand ? 'marble' : 'wood-mid';
    const floorY = bp.levels[s.fromLevel]!.floorY;
    g.setTint(grand ? '#ece6da' : '#7a5236');
    for (const f of s.flights) {
      const [dx, dz] = dirVec(f.dir);
      const px = -dz;
      const pz = dx;
      const tread = f.run / f.steps;
      const riser = f.rise / f.steps;
      for (let i = 0; i < f.steps; i++) {
        const a = i * tread;
        const b = (i + 1) * tread + 0.03;
        const top = f.y + (i + 1) * riser;
        const xs = [f.x + dx * a + px * (f.width / 2), f.x + dx * b + px * (-f.width / 2)];
        const zs = [f.z + dz * a + pz * (f.width / 2), f.z + dz * b + pz * (-f.width / 2)];
        g.box(key, Math.min(...xs), floorY, Math.min(...zs), Math.max(...xs), top, Math.max(...zs));
      }
      // Handrail: iron balusters and a timber rail along the inner (well) side.
      g.setTint(grand ? '#16181a' : '#5a3a22');
      const side = f === s.flights[0] ? 1 : -1;
      for (let i = 0; i < f.steps; i += grand ? 1 : 2) {
        const a = (i + 0.5) * tread;
        const top = f.y + (i + 1) * riser;
        const x = f.x + dx * a + px * side * (f.width / 2 - 0.06);
        const z = f.z + dz * a + pz * side * (f.width / 2 - 0.06);
        g.box(grand ? 'iron' : 'wood-mid', x - 0.015, top, z - 0.015, x + 0.015, top + 0.9, z + 0.015);
      }
      g.setTint(grand ? '#4a2a1a' : '#5a3a22');
      for (let i = 0; i < f.steps; i++) {
        const a = i * tread;
        const b = (i + 1) * tread;
        const top = f.y + (i + 1) * riser + 0.9;
        const xa = f.x + dx * a + px * side * (f.width / 2 - 0.06);
        const za = f.z + dz * a + pz * side * (f.width / 2 - 0.06);
        const xb = f.x + dx * b + px * side * (f.width / 2 - 0.06);
        const zb = f.z + dz * b + pz * side * (f.width / 2 - 0.06);
        g.box('wood-dark', Math.min(xa, xb) - 0.035, top - 0.05, Math.min(za, zb) - 0.035, Math.max(xa, xb) + 0.035, top + 0.03, Math.max(za, zb) + 0.035);
      }
      g.setTint(grand ? '#ece6da' : '#7a5236');
    }
    for (const l of s.landings) g.box(key, l.rect.x0, floorY, l.rect.z0, l.rect.x1, l.y, l.rect.z1);
  }
  g.scope = -1;
}
