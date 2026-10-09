/**
 * Prop meshes from primitives, in each prop's local frame (+z = front).
 * Stylised but recognisable at scope distance; lit by their room's scope.
 */
import * as THREE from 'three';
import type { LightSpec, MansionBlueprint, Prop, Room } from '../core/types';
import type { GeometryBuilder } from './geometry';
import { PAINTING_CELLS } from './textures';

const WOODS = ['#5a2e1c', '#5b3a24', '#7d5634', '#2c1c13'];
const UPHOLSTERY = ['#7d1f22', '#2d4b39', '#8a6a1f', '#3f2f5a', '#d8c9a8', '#6a1d33', '#284058', '#b9a27a'];
const MARBLE = '#f1ede4';

interface PropCtx {
  g: GeometryBuilder;
  room: Room | undefined;
  rand: () => number;
}

function pick<T>(items: readonly T[], r: number): T {
  return items[Math.floor(r * items.length) % items.length]!;
}

export function buildProps(bp: MansionBlueprint, g: GeometryBuilder, seedRand: () => number): void {
  const rooms = new Map(bp.rooms.map((r) => [r.id, r]));
  for (const p of bp.props) {
    const room = p.roomId ? rooms.get(p.roomId) : undefined;
    // Roof terraces are open air: their furniture is lit by the exterior lights.
    g.scope = room && room.type !== 'roof-terrace' ? room.index : -1;
    // Per-prop deterministic randomness from its id.
    let h = 2166136261;
    for (let i = 0; i < p.id.length; i++) h = Math.imul(h ^ p.id.charCodeAt(i), 16777619);
    let state = h >>> 0;
    const rand = () => {
      state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
      return state / 4294967296;
    };
    void seedRand;
    g.frame(p.x, p.y, p.z, p.yaw);
    const ctx: PropCtx = { g, room, rand };
    BUILDERS[p.kind]?.(ctx, p);
  }
  g.frame();
  g.scope = -1;
}

/** Wall lanterns flanking doors (exterior lights of kind 'lantern'). */
export function buildLanterns(lights: LightSpec[], g: GeometryBuilder, facadeOut: (l: LightSpec) => number): void {
  g.scope = -1;
  for (const l of lights) {
    if (l.kind !== 'lantern') continue;
    g.frame(l.x, l.y, l.z, facadeOut(l));
    g.setTint('#ffffff');
    g.box('iron', -0.05, -0.05, -0.45, 0.05, 0.05, 0.0);
    g.box('iron', -0.14, -0.35, -0.14, 0.14, -0.3, 0.14);
    g.box('lamp', -0.11, -0.3, -0.11, 0.11, 0.1, 0.11);
    g.box('iron', -0.15, 0.1, -0.15, 0.15, 0.16, 0.15);
  }
  g.frame();
}

type Builder = (c: PropCtx, p: Prop) => void;

const legs = (g: GeometryBuilder, key: string, w: number, d: number, h: number, t = 0.05, inset = 0.06) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(key, sx * (w / 2 - inset) - t / 2, 0, sz * (d / 2 - inset) - t / 2, sx * (w / 2 - inset) + t / 2, h, sz * (d / 2 - inset) + t / 2);
};

const seatColour = (c: PropCtx) => (c.room ? (c.rand() < 0.5 ? c.room.finish.drapery : pick(UPHOLSTERY, c.rand())) : pick(UPHOLSTERY, c.rand()));

const BUILDERS: Partial<Record<Prop['kind'], Builder>> = {
  sofa: (c, p) => {
    const { g } = c;
    const { w, d, h } = p;
    g.setTint(pick(WOODS, c.rand()));
    legs(g, 'wood-dark', w, d, 0.12, 0.06, 0.08);
    g.setTint(seatColour(c));
    g.box('fabric', -w / 2, 0.12, -d / 2, w / 2, 0.42, d / 2);
    g.box('fabric', -w / 2, 0.42, -d / 2, w / 2, h, -d / 2 + 0.2);
    for (const s of [-1, 1]) g.box('fabric', s * (w / 2 - 0.13) - 0.065, 0.42, -d / 2, s * (w / 2 - 0.13) + 0.065, 0.66, d / 2);
    const n = w > 1.6 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = -w / 2 + 0.15 + ((w - 0.3) * i) / n;
      g.box('fabric', a + 0.02, 0.42, -d / 2 + 0.2, a + (w - 0.3) / n - 0.02, 0.52, d / 2 - 0.04);
    }
  },
  armchair: (c, p) => {
    const { g } = c;
    const { w, d, h } = p;
    g.setTint(pick(WOODS, c.rand()));
    legs(g, 'wood-dark', w, d, 0.14, 0.05, 0.07);
    g.setTint(p.variant === 2 ? '#d9c79f' : p.variant === 1 ? '#5a2a18' : seatColour(c));
    const key = p.variant === 1 ? 'leather' : 'fabric';
    g.box(key, -w / 2, 0.14, -d / 2, w / 2, 0.44, d / 2);
    g.box(key, -w / 2, 0.44, -d / 2, w / 2, h, -d / 2 + 0.18);
    for (const s of [-1, 1]) g.box(key, s * (w / 2 - 0.08) - 0.08, 0.44, -d / 2, s * (w / 2 - 0.08) + 0.08, 0.68, d / 2);
  },
  chair: (c, p) => {
    const { g } = c;
    const { w, d, h } = p;
    const gilt = p.variant === 1;
    g.setTint(gilt ? '#ffffff' : pick(WOODS, c.rand()));
    const fk = gilt ? 'gilt' : 'wood-dark';
    legs(g, fk, w, d, 0.45, 0.04, 0.04);
    g.box(fk, -w / 2 + 0.02, 0.45, -d / 2 + 0.02, -w / 2 + 0.06, h, -d / 2 + 0.06);
    g.box(fk, w / 2 - 0.06, 0.45, -d / 2 + 0.02, w / 2 - 0.02, h, -d / 2 + 0.06);
    g.box(fk, -w / 2 + 0.02, h - 0.08, -d / 2 + 0.02, w / 2 - 0.02, h, -d / 2 + 0.06);
    g.setTint(gilt ? '#c9b48a' : p.variant === 2 ? '#4a2416' : seatColour(c));
    g.box(p.variant === 2 ? 'leather' : 'fabric', -w / 2, 0.42, -d / 2, w / 2, 0.5, d / 2);
    g.box(p.variant === 2 ? 'leather' : 'fabric', -w / 2 + 0.07, 0.55, -d / 2 + 0.025, w / 2 - 0.07, h - 0.1, -d / 2 + 0.06);
  },
  'coffee-table': (c, p) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand()));
    legs(g, 'wood-dark', p.w, p.d, p.h - 0.04);
    g.box('wood-dark', -p.w / 2, p.h - 0.05, -p.d / 2, p.w / 2, p.h, p.d / 2);
  },
  'side-table': (c, p) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand()));
    g.cylinder('wood-dark', 0, 0, 0, 0.05, 0.04, p.h - 0.03, 8, false);
    g.cylinder('wood-dark', 0, p.h - 0.03, 0, p.w / 2, p.w / 2, 0.03, 12, true);
  },
  'card-table': (c, p) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand()));
    legs(g, 'wood-dark', p.w, p.d, p.h - 0.04, 0.045);
    g.box('wood-dark', -p.w / 2, p.h - 0.06, -p.d / 2, p.w / 2, p.h - 0.01, p.d / 2);
    g.setTint('#1f4a2c');
    g.box('felt', -p.w / 2 + 0.05, p.h - 0.01, -p.d / 2 + 0.05, p.w / 2 - 0.05, p.h, p.d / 2 - 0.05);
  },
  'dining-table': (c, p) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand()));
    const n = Math.max(2, Math.round(p.d / 2.2));
    for (let i = 0; i < n; i++) {
      const z = -p.d / 2 + 0.6 + ((p.d - 1.2) * i) / Math.max(1, n - 1);
      g.cylinder('wood-dark', 0, 0, z, 0.32, 0.1, 0.12, 10, true);
      g.cylinder('wood-dark', 0, 0.12, z, 0.07, 0.07, p.h - 0.16, 8, false);
    }
    g.box('wood-dark', -p.w / 2, p.h - 0.05, -p.d / 2, p.w / 2, p.h, p.d / 2);
    if (p.variant === 0) {
      g.setTint('#f6f2e8');
      g.box('white', -p.w / 2 + 0.08, p.h, -p.d / 2 + 0.05, p.w / 2 - 0.08, p.h + 0.005, p.d / 2 - 0.05);
    }
  },
  'cocktail-table': (c, p) => {
    const { g } = c;
    const r = p.w / 2;
    if (p.variant === 1) {
      g.setTint('#f4f0e6');
      g.cylinder('white', 0, 0, 0, r + 0.08, r + 0.02, p.h, 16, true);
      g.setTint('#d8c9a0');
      g.cylinder('crystal', -0.1, p.h, 0.05, 0.035, 0.03, 0.18, 6, true);
      g.cylinder('crystal', 0.12, p.h, -0.05, 0.035, 0.03, 0.18, 6, true);
      return;
    }
    g.setTint(p.variant === 3 ? '#c8a979' : pick(WOODS, c.rand()));
    g.cylinder(p.variant === 3 ? 'wood-mid' : 'wood-dark', 0, 0, 0, r * 0.45, 0.06, 0.06, 10, true);
    g.cylinder(p.variant === 3 ? 'wood-mid' : 'wood-dark', 0, 0.06, 0, 0.05, 0.05, p.h - 0.09, 8, false);
    g.cylinder(p.variant === 3 ? 'wood-mid' : 'wood-dark', 0, p.h - 0.03, 0, r, r, 0.03, 16, true);
    if (p.variant === 2) {
      g.setTint('#f4f0e6');
      g.cylinder('white', 0, p.h - 0.2, 0, r + 0.06, r + 0.02, 0.2, 16, false);
    }
  },
  console: (c, p) => {
    const { g } = c;
    g.setTint('#ffffff');
    const gilt = c.rand() < 0.5;
    if (!gilt) g.setTint(pick(WOODS, c.rand()));
    const fk = gilt ? 'gilt' : 'wood-dark';
    legs(g, fk, p.w, p.d, p.h - 0.05, 0.05, 0.05);
    g.box(fk, -p.w / 2 + 0.05, p.h - 0.2, -p.d / 2 + 0.05, p.w / 2 - 0.05, p.h - 0.05, p.d / 2 - 0.05);
    g.setTint(MARBLE);
    g.box('marble', -p.w / 2 - 0.02, p.h - 0.05, -p.d / 2 - 0.02, p.w / 2 + 0.02, p.h, p.d / 2 + 0.02);
    // A vase or a guest ledger.
    g.setTint(p.poi === 'ledger' ? '#5a1a14' : '#e8e2d4');
    if (p.poi === 'ledger') g.box('leather', -0.2, p.h, -0.12, 0.2, p.h + 0.06, 0.15);
    else g.lathe('marble', 0.25, 0, [[0.06, p.h], [0.12, p.h + 0.15], [0.07, p.h + 0.32], [0.09, p.h + 0.38]], 10, true);
  },
  sideboard: (c, p) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand()));
    g.box('wood-dark', -p.w / 2, 0.12, -p.d / 2, p.w / 2, p.h - 0.04, p.d / 2);
    legs(g, 'wood-dark', p.w, p.d, 0.12, 0.06, 0.05);
    g.box('wood-dark', -p.w / 2 - 0.03, p.h - 0.04, -p.d / 2 - 0.03, p.w / 2 + 0.03, p.h, p.d / 2 + 0.03);
    for (let i = 0; i < 3; i++) g.box('wood-dark', -p.w / 2 + 0.08 + (i * (p.w - 0.16)) / 3, 0.2, p.d / 2, -p.w / 2 + 0.08 + ((i + 1) * (p.w - 0.16)) / 3 - 0.04, p.h - 0.12, p.d / 2 + 0.015);
  },
  desk: (c, p) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand()));
    g.box('wood-dark', -p.w / 2, 0, -p.d / 2, -p.w / 2 + 0.42, p.h - 0.04, p.d / 2);
    g.box('wood-dark', p.w / 2 - 0.42, 0, -p.d / 2, p.w / 2, p.h - 0.04, p.d / 2);
    g.box('wood-dark', -p.w / 2 - 0.02, p.h - 0.04, -p.d / 2 - 0.02, p.w / 2 + 0.02, p.h, p.d / 2 + 0.02);
    g.setTint('#264a33');
    g.box('leather', -p.w / 2 + 0.1, p.h, -p.d / 2 + 0.1, p.w / 2 - 0.1, p.h + 0.004, p.d / 2 - 0.1);
  },
  bookcase: (c, p) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand() * 0.5));
    const { w, d, h } = p;
    g.box('wood-dark', -w / 2, 0, -d / 2, -w / 2 + 0.05, h, d / 2);
    g.box('wood-dark', w / 2 - 0.05, 0, -d / 2, w / 2, h, d / 2);
    g.box('wood-dark', -w / 2 - 0.03, h - 0.12, -d / 2, w / 2 + 0.03, h, d / 2 + 0.04);
    g.box('wood-dark', -w / 2, 0, -d / 2, w / 2, 0.15, d / 2 + 0.01);
    g.box('wood-dark', -w / 2, 0, -d / 2, w / 2, h, -d / 2 + 0.02);
    g.setTint('#ffffff');
    // Books: textured front, offset per prop so shelves don't repeat in step.
    const u0 = c.rand() * 4;
    const zf = d / 2 - 0.04;
    const bh = h - 0.27;
    g.quad('books', [-w / 2 + 0.05, 0.15, zf], [w / 2 - 0.05, 0.15, zf], [w / 2 - 0.05, 0.15 + bh, zf], [-w / 2 + 0.05, 0.15 + bh, zf], [
      [u0, 0],
      [u0 + (w - 0.1) / 1.2, 0],
      [u0 + (w - 0.1) / 1.2, bh / 1.44],
      [u0, bh / 1.44],
    ]);
  },
  'grand-piano': (c, p) => {
    const { g } = c;
    g.setTint('#ffffff');
    const w = p.w;
    const d = p.d;
    // Case outline: straight bass side, curved treble side.
    const pts: [number, number][] = [
      [-w / 2, d / 2],
      [w / 2, d / 2],
      [w / 2, d / 2 - 0.35],
      [w * 0.38, -d * 0.05],
      [w * 0.12, -d * 0.3],
      [-w * 0.05, -d / 2],
      [-w / 2, -d / 2],
    ];
    g.prism('lacquer', pts, 0.62, 0.98, true, true);
    for (const [x, z] of [
      [-w / 2 + 0.12, d / 2 - 0.15],
      [w / 2 - 0.12, d / 2 - 0.15],
      [-w / 2 + 0.2, -d / 2 + 0.25],
    ] as const) g.box('lacquer', x - 0.06, 0, z - 0.06, x + 0.06, 0.62, z + 0.06);
    // Keyboard and open lid.
    g.setTint('#f2efe6');
    g.box('white', -w / 2 + 0.05, 0.7, d / 2, w / 2 - 0.05, 0.74, d / 2 + 0.16);
    g.setTint('#ffffff');
    g.quadFacing('lacquer', [-w / 2, 0.98, d / 2 - 0.1], [-w / 2, 0.98, -d / 2], [w * 0.1, 1.7, -d / 2 + 0.1], [w * 0.1, 1.7, d / 2 - 0.2], 1, 0.4, 0);
    g.quadFacing('lacquer', [-w / 2, 0.98, d / 2 - 0.1], [-w / 2, 0.98, -d / 2], [w * 0.1, 1.7, -d / 2 + 0.1], [w * 0.1, 1.7, d / 2 - 0.2], -1, -0.4, 0);
    g.box('lacquer', -0.4, 0, d / 2 + 0.45, 0.4, 0.48, d / 2 + 0.8);
  },
  'bar-counter': (c, p) => {
    const { g } = c;
    g.setTint('#3a1f14');
    g.box('wood-dark', -p.w / 2, 0, -p.d / 2, p.w / 2, p.h - 0.05, p.d / 2);
    for (let i = 0; i < 4; i++) g.box('wood-dark', -p.w / 2 + 0.1 + (i * (p.w - 0.2)) / 4, 0.15, p.d / 2, -p.w / 2 + 0.06 + ((i + 1) * (p.w - 0.2)) / 4, p.h - 0.2, p.d / 2 + 0.02);
    g.setTint('#e8e2d6');
    g.box('marble', -p.w / 2 - 0.04, p.h - 0.05, -p.d / 2 - 0.02, p.w / 2 + 0.04, p.h, p.d / 2 + 0.08);
    g.setTint('#ffffff');
    g.box('brass', -p.w / 2, 0.12, p.d / 2 + 0.12, p.w / 2, 0.15, p.d / 2 + 0.15);
    for (let i = 0; i < 5; i++) {
      g.setTint(pick(['#d8c890', '#e8e0c8', '#c03028'], c.rand()));
      g.cylinder('crystal', -p.w / 2 + 0.3 + i * 0.5 + c.rand() * 0.2, p.h, (c.rand() - 0.5) * 0.3, 0.035, 0.03, 0.16, 6, true);
    }
  },
  'bar-shelf': (c, p) => {
    const { g } = c;
    g.setTint('#3a1f14');
    g.box('wood-dark', -p.w / 2, 0, -p.d / 2, p.w / 2, p.h, -p.d / 2 + 0.04);
    g.box('wood-dark', -p.w / 2, 0, -p.d / 2, p.w / 2, 0.9, p.d / 2);
    g.setTint('#ffffff');
    g.box('mirror', -p.w / 2 + 0.1, 1.0, -p.d / 2 + 0.04, p.w / 2 - 0.1, p.h - 0.15, -p.d / 2 + 0.05);
    for (const y of [1.25, 1.65]) {
      g.setTint('#3a1f14');
      g.box('wood-dark', -p.w / 2 + 0.05, y - 0.03, -p.d / 2, p.w / 2 - 0.05, y, p.d / 2 - 0.08);
      for (let x = -p.w / 2 + 0.15; x < p.w / 2 - 0.1; x += 0.11 + c.rand() * 0.06) {
        g.setTint(pick(['#2f5a2a', '#6a3a14', '#c9b07a', '#3a2a4a', '#8a1a14'], c.rand()));
        const bh = 0.24 + c.rand() * 0.1;
        g.cylinder('bottles', x, y, -p.d / 2 + 0.2, 0.04, 0.04, bh * 0.7, 6, false);
        g.cylinder('bottles', x, y + bh * 0.7, -p.d / 2 + 0.2, 0.04, 0.014, bh * 0.3, 6, true);
      }
    }
  },
  'billiard-table': (c, p) => {
    const { g } = c;
    g.setTint('#3a1f14');
    for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) g.box('wood-dark', sx * (p.w / 2 - 0.15) - 0.08, 0, sz * (p.d / 2 - 0.2) - 0.08, sx * (p.w / 2 - 0.15) + 0.08, 0.66, sz * (p.d / 2 - 0.2) + 0.08);
    g.box('wood-dark', -p.w / 2, 0.66, -p.d / 2, p.w / 2, p.h, p.d / 2, 0b111011);
    g.setTint('#1d5c34');
    g.box('felt', -p.w / 2 + 0.1, p.h - 0.04, -p.d / 2 + 0.1, p.w / 2 - 0.1, p.h - 0.02, p.d / 2 - 0.1);
    g.setTint('#3a1f14');
    for (const s of [-1, 1]) {
      g.box('wood-dark', s * (p.w / 2 - 0.05) - 0.05, p.h - 0.04, -p.d / 2, s * (p.w / 2 - 0.05) + 0.05, p.h + 0.04, p.d / 2);
      g.box('wood-dark', -p.w / 2, p.h - 0.04, s * (p.d / 2 - 0.05) - 0.05, p.w / 2, p.h + 0.04, s * (p.d / 2 - 0.05) + 0.05);
    }
  },
  fireplace: (c, p) => {
    const { g } = c;
    g.setTint(p.variant === 2 ? '#2a2624' : MARBLE);
    const key = 'marble';
    g.box(key, -p.w / 2, 0, -p.d / 2, -p.w / 2 + 0.32, p.h - 0.12, p.d / 2);
    g.box(key, p.w / 2 - 0.32, 0, -p.d / 2, p.w / 2, p.h - 0.12, p.d / 2);
    g.box(key, -p.w / 2, p.h - 0.42, -p.d / 2, p.w / 2, p.h - 0.12, p.d / 2);
    g.box(key, -p.w / 2 - 0.08, p.h - 0.12, -p.d / 2, p.w / 2 + 0.08, p.h, p.d / 2 + 0.08);
    g.box(key, -p.w / 2 - 0.1, 0, p.d / 2 - 0.05, p.w / 2 + 0.1, 0.04, p.d / 2 + 0.45);
    g.setTint('#0d0b0a');
    g.box('iron', -p.w / 2 + 0.32, 0, -p.d / 2, p.w / 2 - 0.32, p.h - 0.42, -p.d / 2 + 0.05);
    g.box('iron', -p.w / 2 + 0.32, p.h - 0.44, -p.d / 2, p.w / 2 - 0.32, p.h - 0.42, p.d / 2);
    if (c.room && c.room.lit > 0) {
      g.setTint('#ffffff');
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 0.14 + (c.rand() - 0.5) * 0.05;
        g.sphere('fire', x, 0.12 + c.rand() * 0.06, 0, 0.08, 0.14 + c.rand() * 0.1, 0.06, 6, 4);
      }
    }
  },
  statue: (c, p) => {
    const { g } = c;
    g.setTint(MARBLE);
    const k = 'marble';
    const ped = p.h * 0.42;
    g.box(k, -p.w / 2 + 0.05, 0, -p.d / 2 + 0.05, p.w / 2 - 0.05, ped, p.d / 2 - 0.05);
    g.box(k, -p.w / 2, ped - 0.08, -p.d / 2, p.w / 2, ped, p.d / 2);
    g.box(k, -p.w / 2, 0, -p.d / 2, p.w / 2, 0.08, p.d / 2);
    const H = p.h - ped;
    const v = p.variant % 4;
    if (v === 3) {
      // Urn.
      g.lathe(k, 0, 0, [[0.12, ped], [0.22, ped + 0.12], [0.3, ped + H * 0.5], [0.18, ped + H * 0.8], [0.24, ped + H * 0.9], [0.2, ped + H]], 12, true);
      return;
    }
    // Figure: legs, draped torso, head, one arm raised for variant 1.
    const s = H / 1.75;
    g.cylinder(k, -0.08 * s, ped, 0, 0.07 * s, 0.06 * s, 0.82 * s, 8, false);
    g.cylinder(k, 0.08 * s, ped, 0.04 * s, 0.07 * s, 0.06 * s, 0.82 * s, 8, false);
    g.lathe(k, 0, 0, [[0.2 * s, ped + 0.2 * s], [0.17 * s, ped + 0.85 * s], [0.19 * s, ped + 1.15 * s], [0.2 * s, ped + 1.38 * s], [0.08 * s, ped + 1.48 * s]], 10, true);
    g.sphere(k, 0, ped + 1.6 * s, 0, 0.11 * s, 0.13 * s, 0.11 * s, 8, 6);
    if (v === 1) {
      g.cylinder(k, 0.22 * s, ped + 1.32 * s, 0, 0.05 * s, 0.04 * s, 0.55 * s, 6, true);
    } else {
      for (const sx of [-1, 1]) g.cylinder(k, sx * 0.24 * s, ped + 0.75 * s, 0, 0.045 * s, 0.05 * s, 0.6 * s, 6, true);
    }
    if (v === 2) g.lathe(k, 0, 0, [[0.36 * s, ped], [0.22 * s, ped + 0.7 * s], [0.18 * s, ped + 0.9 * s]], 10, false); // drapery
  },
  bust: (c) => {
    const { g } = c;
    g.setTint(MARBLE);
    g.lathe('marble', 0, 0, [[0.2, 0], [0.16, 0.08], [0.13, 0.12], [0.12, 1.05], [0.17, 1.12], [0.2, 1.18]], 10, true);
    g.sphere('marble', 0, 1.36, 0, 0.21, 0.16, 0.12, 8, 5);
    g.sphere('marble', 0, 1.6, 0, 0.1, 0.13, 0.11, 8, 6);
  },
  painting: (c, p) => {
    const { g } = c;
    const { w, h } = p;
    g.setTint('#ffffff');
    const f = 0.07;
    g.box('gilt', -w / 2 - f, 0 - f, 0, w / 2 + f, 0, 0.06);
    g.box('gilt', -w / 2 - f, h, 0, w / 2 + f, h + f, 0.06);
    g.box('gilt', -w / 2 - f, 0, 0, -w / 2, h, 0.06);
    g.box('gilt', w / 2, 0, 0, w / 2 + f, h, 0.06);
    const cell = p.variant % (PAINTING_CELLS * PAINTING_CELLS);
    // Landscape cells (kind 0-3 of 8) for wide frames, portraits for tall.
    const wide = w > h;
    let idx = cell;
    const kind = idx % 8;
    if (wide && kind >= 4) idx = (idx + 4) % 16;
    if (!wide && kind < 4) idx = (idx + 4) % 16;
    const cu = (idx % PAINTING_CELLS) / PAINTING_CELLS;
    const cv = Math.floor(idx / PAINTING_CELLS) / PAINTING_CELLS;
    const e = 1 / PAINTING_CELLS;
    g.quad('painting', [-w / 2, 0, 0.03], [w / 2, 0, 0.03], [w / 2, h, 0.03], [-w / 2, h, 0.03], [
      [cu + 0.01, cv + 0.01],
      [cu + e - 0.01, cv + 0.01],
      [cu + e - 0.01, cv + e - 0.01],
      [cu + 0.01, cv + e - 0.01],
    ]);
  },
  mirror: (c, p) => {
    const { g } = c;
    const { w, h } = p;
    g.setTint('#ffffff');
    const f = 0.09;
    g.box('gilt', -w / 2 - f, -f, 0, w / 2 + f, 0, 0.06);
    g.box('gilt', -w / 2 - f, h, 0, w / 2 + f, h + f * 1.6, 0.07);
    g.box('gilt', -w / 2 - f, 0, 0, -w / 2, h, 0.06);
    g.box('gilt', w / 2, 0, 0, w / 2 + f, h, 0.06);
    g.quad('mirror', [-w / 2, 0, 0.02], [w / 2, 0, 0.02], [w / 2, h, 0.02], [-w / 2, h, 0.02]);
  },
  clock: (c, p) => {
    const { g } = c;
    g.setTint('#4a2616');
    g.box('wood-dark', -p.w / 2, 0, -p.d / 2, p.w / 2, 0.5, p.d / 2);
    g.box('wood-dark', -p.w / 2 + 0.06, 0.5, -p.d / 2 + 0.03, p.w / 2 - 0.06, 1.55, p.d / 2 - 0.03);
    g.box('wood-dark', -p.w / 2 - 0.02, 1.55, -p.d / 2, p.w / 2 + 0.02, p.h - 0.08, p.d / 2);
    g.box('wood-dark', -p.w / 2 - 0.05, p.h - 0.08, -p.d / 2 - 0.02, p.w / 2 + 0.05, p.h, p.d / 2 + 0.02);
    g.setTint('#f4ecd8');
    g.box('white', -0.17, 1.62, p.d / 2, 0.17, 1.96, p.d / 2 + 0.01);
    g.setTint('#ffffff');
    g.box('brass', -0.04, 0.9, p.d / 2 - 0.02, 0.04, 1.3, p.d / 2 - 0.01);
  },
  plant: (c, p) => {
    const { g } = c;
    g.setTint(c.rand() < 0.5 ? '#e9e4da' : '#8c5034');
    g.lathe('ext-trim', 0, 0, [[0.2, 0], [0.26, 0.15], [0.32, 0.45], [0.34, 0.5]], 12, true);
    g.setTint('#ffffff');
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + c.rand();
      const r = 0.3 + c.rand() * 0.15;
      const y = 0.5 + (p.h - 0.6) * (0.5 + c.rand() * 0.5);
      g.sphere('foliage', Math.cos(a) * r, y, Math.sin(a) * r, 0.32, 0.09, 0.14, 6, 4);
    }
    g.cylinder('bark', 0, 0.45, 0, 0.04, 0.03, p.h * 0.75, 6, false);
  },
  rug: (c, p) => {
    const { g } = c;
    g.setTint('#ffffff');
    const key = `rug${Math.min(4, p.variant)}`;
    g.quad(key, [-p.w / 2, 0.006, p.d / 2], [p.w / 2, 0.006, p.d / 2], [p.w / 2, 0.006, -p.d / 2], [-p.w / 2, 0.006, -p.d / 2], [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
  },
  chandelier: (c, p) => {
    const { g } = c;
    const lit = (c.room?.lit ?? 0) > 0;
    const r = p.w / 2;
    const top = p.h;
    g.setTint('#ffffff');
    g.cylinder('brass', 0, top * 0.55, 0, 0.02, 0.02, top * 0.45, 6, false);
    g.disc('int-trim', 0, top - 0.002, 0, Math.max(0.35, r * 0.6), 16, false);
    if (p.variant === 2) {
      g.lathe(lit ? 'shade' : 'white', 0, 0, [[0.06, top * 0.1], [0.24, top * 0.15], [0.26, top * 0.55], [0.12, top * 0.6]], 10, true);
      return;
    }
    const tiers = p.variant === 1 ? 1 : 2;
    for (let t = 0; t < tiers; t++) {
      const ry = top * (0.28 + t * 0.22);
      const rr = r * (1 - t * 0.38);
      const n = t === 0 ? 10 : 6;
      g.lathe('brass', 0, 0, [[rr, ry - 0.02], [rr, ry + 0.02]], 16, false);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        g.box('brass', x - 0.015, ry, z - 0.015, x + 0.015, ry + 0.1, z + 0.015);
        g.sphere(lit ? 'bulb' : 'white', x, ry + 0.16, z, 0.03, 0.06, 0.03, 5, 3);
        g.box(lit ? 'crystal' : 'white', x - 0.012, ry - 0.16, z - 0.012, x + 0.012, ry - 0.02, z + 0.012);
      }
    }
    g.sphere(lit ? 'crystal' : 'white', 0, top * 0.18, 0, 0.09, 0.16, 0.09, 8, 6);
  },
  sconce: (c, p) => {
    const { g } = c;
    const lit = (c.room?.lit ?? 0) > 0;
    g.setTint('#ffffff');
    g.box('brass', -0.06, 0.05, 0, 0.06, p.h - 0.05, 0.03);
    for (const s of [-1, 1]) {
      g.box('brass', s * 0.12 - 0.012, p.h * 0.45, 0.03, s * 0.12 + 0.012, p.h * 0.5, 0.2);
      g.sphere(lit ? 'bulb' : 'white', s * 0.12, p.h * 0.62, 0.18, 0.025, 0.05, 0.025, 5, 3);
    }
  },
  lamp: (c, p) => {
    const { g } = c;
    const lit = (c.room?.lit ?? 0) > 0;
    g.setTint('#ffffff');
    if (p.variant === 2) {
      // Candelabrum.
      g.cylinder('brass', 0, 0, 0, 0.08, 0.02, 0.32, 8, false);
      for (const x of [-0.12, 0, 0.12]) {
        g.cylinder('white', x, 0.32, 0, 0.012, 0.012, 0.16, 5, true);
        g.sphere(lit ? 'bulb' : 'white', x, 0.52, 0, 0.012, 0.03, 0.012, 4, 3);
      }
      return;
    }
    if (p.variant === 3) {
      g.box('brass', -0.01, p.h, -0.01, 0.01, p.h + 0.8, 0.01);
      g.setTint('#1f4a2c');
      g.box(lit ? 'shade' : 'felt', -p.w / 2, 0, -p.d / 2, p.w / 2, 0.18, p.d / 2);
      return;
    }
    g.cylinder('brass', 0, 0, 0, 0.09, 0.03, p.h * 0.6, 8, true);
    if (p.variant === 1) g.setTint('#2a6a3a');
    g.lathe(lit ? 'shade' : 'white', 0, 0, [[0.2, p.h * 0.55], [0.12, p.h]], 12, false);
  },
  bed: (c, p) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand()));
    g.box('wood-dark', -p.w / 2, 0, -p.d / 2, p.w / 2, 0.38, p.d / 2);
    g.box('wood-dark', -p.w / 2, 0, -p.d / 2, p.w / 2, 1.3, -p.d / 2 + 0.08);
    if (p.variant === 1) for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box('wood-dark', sx * (p.w / 2) - 0.05, 0, sz * (p.d / 2) - 0.05, sx * (p.w / 2) + 0.05, 2.25, sz * (p.d / 2) + 0.05);
    g.setTint('#f2eee4');
    g.box('white', -p.w / 2 + 0.05, 0.38, -p.d / 2 + 0.08, p.w / 2 - 0.05, 0.55, p.d / 2 - 0.02);
    g.box('white', -p.w / 2 + 0.15, 0.55, -p.d / 2 + 0.12, -0.05, 0.68, -p.d / 2 + 0.55);
    g.box('white', 0.05, 0.55, -p.d / 2 + 0.12, p.w / 2 - 0.15, 0.68, -p.d / 2 + 0.55);
    g.setTint(c.room?.finish.drapery ?? '#7d1f22');
    g.box('fabric', -p.w / 2 + 0.02, 0.5, -p.d / 2 + 0.7, p.w / 2 - 0.02, 0.6, p.d / 2);
  },
  wardrobe: (c, p) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand()));
    g.box('wood-dark', -p.w / 2, 0.1, -p.d / 2, p.w / 2, p.h - 0.12, p.d / 2);
    g.box('wood-dark', -p.w / 2 - 0.04, p.h - 0.12, -p.d / 2 - 0.03, p.w / 2 + 0.04, p.h, p.d / 2 + 0.04);
    g.box('wood-dark', -0.01, 0.2, p.d / 2, 0.01, p.h - 0.2, p.d / 2 + 0.01);
  },
  cabinet: (c, p) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand()));
    g.box('wood-dark', -p.w / 2, 0, -p.d / 2, p.w / 2, p.h, p.d / 2);
  },
  safe: (c, p) => {
    const { g } = c;
    g.setTint('#1e2a22');
    g.box('iron', -p.w / 2, 0.05, -p.d / 2, p.w / 2, p.h, p.d / 2);
    g.setTint('#ffffff');
    g.box('brass', -0.08, p.h * 0.5, p.d / 2, 0.08, p.h * 0.5 + 0.16, p.d / 2 + 0.03);
  },
  'kitchen-island': (c, p) => {
    const { g } = c;
    g.setTint('#e9e4d6');
    g.box('wood-mid', -p.w / 2 + 0.06, 0.08, -p.d / 2 + 0.06, p.w / 2 - 0.06, p.h - 0.05, p.d / 2 - 0.06);
    g.setTint('#3a3a3a');
    g.box('iron', -p.w / 2 + 0.1, 0, -p.d / 2 + 0.1, p.w / 2 - 0.1, 0.08, p.d / 2 - 0.1);
    g.setTint(MARBLE);
    g.box('marble', -p.w / 2, p.h - 0.05, -p.d / 2, p.w / 2, p.h, p.d / 2);
    // Hob at one end, a bowl of fruit and a row of copper pans at the other.
    g.setTint('#ffffff');
    g.box('lacquer', -p.w / 2 + 0.25, p.h, -0.3, -p.w / 2 + 1.05, p.h + 0.012, 0.3);
    g.setTint('#b5683a');
    for (let k = 0; k < 3; k++) g.cylinder('brass', p.w / 2 - 0.4 - k * 0.42, p.h, 0, 0.15 - k * 0.02, 0.13 - k * 0.02, 0.13, 10, false);
    // Stools along the room side.
    for (let x = -p.w / 2 + 0.6; x < p.w / 2 - 0.3; x += 0.75) {
      g.setTint('#2a2a2a');
      g.cylinder('iron', x, 0, p.d / 2 + 0.32, 0.03, 0.03, 0.66, 6, false);
      g.setTint('#6a3a22');
      g.cylinder('leather', x, 0.66, p.d / 2 + 0.32, 0.18, 0.18, 0.06, 10, true);
    }
  },
  range: (c, p) => {
    const { g } = c;
    // Range cooker flanked by counters, a canopy hood above, pans on a rail.
    g.setTint('#20262b');
    g.box('iron', -0.75, 0, -p.d / 2, 0.75, 0.92, p.d / 2 - 0.02);
    g.setTint('#ffffff');
    for (const x of [-0.5, 0, 0.5]) g.box('brass', x - 0.18, 0.7, p.d / 2 - 0.02, x + 0.18, 0.74, p.d / 2 + 0.03);
    g.box('lacquer', -0.72, 0.92, -p.d / 2 + 0.05, 0.72, 0.935, p.d / 2 - 0.08);
    g.setTint('#e9e4d6');
    for (const s of [-1, 1]) g.box('wood-mid', s > 0 ? 0.75 : -p.w / 2, 0, -p.d / 2, s > 0 ? p.w / 2 : -0.75, 0.88, p.d / 2 - 0.05);
    g.setTint(MARBLE);
    for (const s of [-1, 1]) g.box('marble', s > 0 ? 0.75 : -p.w / 2, 0.88, -p.d / 2, s > 0 ? p.w / 2 : -0.75, 0.92, p.d / 2);
    g.setTint('#b5683a');
    g.box('brass', -0.95, 1.75, -p.d / 2, 0.95, 1.85, p.d / 2 - 0.1);
    g.box('brass', -0.7, 1.85, -p.d / 2, 0.7, Math.min(p.h, 2.4), p.d / 2 - 0.3);
    g.setTint('#8a8a8a');
    g.box('iron', -p.w / 2 + 0.1, 1.55, -p.d / 2 + 0.03, -1.05, 1.57, -p.d / 2 + 0.06);
    g.setTint('#b5683a');
    for (let k = 0; k < 3; k++) g.cylinder('brass', -p.w / 2 + 0.25 + k * 0.22, 1.3, -p.d / 2 + 0.1, 0.09, 0.08, 0.22, 8, false);
  },
  'cinema-screen': (c, p) => {
    const { g } = c;
    const { w, h } = p;
    g.setTint('#101010');
    g.box('lacquer', -w / 2 - 0.08, -0.08, 0, w / 2 + 0.08, h + 0.08, 0.05);
    g.setTint('#ffffff');
    g.quad('screen', [-w / 2, 0, 0.055], [w / 2, 0, 0.055], [w / 2, h, 0.055], [-w / 2, h, 0.055]);
    // Curtains drawn back either side.
    g.setTint(c.room?.finish.drapery ?? '#6a1d33');
    for (const s of [-1, 1]) g.box('fabric', s * (w / 2 + 0.1), -0.6, 0, s * (w / 2 + 0.55), h + 0.3, 0.12);
  },
  'wine-rack': (c, p) => {
    const { g } = c;
    g.setTint('#3a2416');
    g.box('wood-dark', -p.w / 2, 0, -p.d / 2, p.w / 2, p.h, -p.d / 2 + 0.04);
    g.box('wood-dark', -p.w / 2, 0, -p.d / 2, -p.w / 2 + 0.04, p.h, p.d / 2);
    g.box('wood-dark', p.w / 2 - 0.04, 0, -p.d / 2, p.w / 2, p.h, p.d / 2);
    g.box('wood-dark', -p.w / 2, p.h - 0.05, -p.d / 2, p.w / 2, p.h, p.d / 2);
    for (let y = 0.12; y < p.h - 0.2; y += 0.2) {
      g.setTint('#3a2416');
      g.box('wood-dark', -p.w / 2, y - 0.02, -p.d / 2, p.w / 2, y, p.d / 2 - 0.02);
      // Bottles lying on their sides, necks out.
      for (let x = -p.w / 2 + 0.12; x < p.w / 2 - 0.08; x += 0.13) {
        if (c.rand() < 0.18) continue;
        g.setTint(pick(['#1f3a1c', '#2a1a12', '#3a2a14', '#14241a', '#4a1414'], c.rand()));
        g.box('bottles', x - 0.04, y + 0.01, -p.d / 2 + 0.06, x + 0.04, y + 0.09, p.d / 2 - 0.06);
        g.setTint('#8a1a14');
        g.box('bottles', x - 0.018, y + 0.032, p.d / 2 - 0.06, x + 0.018, y + 0.068, p.d / 2);
      }
    }
  },
  pool: (c, p) => {
    const { g } = c;
    // A stone coping round still water, set a hand's height above the floor.
    const e = 0.32;
    g.setTint(MARBLE);
    g.box('marble', -p.w / 2, 0, -p.d / 2, p.w / 2, p.h, -p.d / 2 + e);
    g.box('marble', -p.w / 2, 0, p.d / 2 - e, p.w / 2, p.h, p.d / 2);
    g.box('marble', -p.w / 2, 0, -p.d / 2 + e, -p.w / 2 + e, p.h, p.d / 2 - e);
    g.box('marble', p.w / 2 - e, 0, -p.d / 2 + e, p.w / 2, p.h, p.d / 2 - e);
    g.setTint('#5fb6c8');
    g.quad('pool-water', [-p.w / 2 + e, p.h - 0.04, p.d / 2 - e], [p.w / 2 - e, p.h - 0.04, p.d / 2 - e], [p.w / 2 - e, p.h - 0.04, -p.d / 2 + e], [-p.w / 2 + e, p.h - 0.04, -p.d / 2 + e]);
    // Steps and a brass rail at one end.
    g.setTint('#ffffff');
    for (const s of [-1, 1]) {
      g.cylinder('brass', -p.w / 2 + 0.16, 0, s * 0.35, 0.02, 0.02, 0.9, 6, false);
      g.cylinder('brass', -p.w / 2 + 0.6, 0, s * 0.35, 0.02, 0.02, 0.9, 6, false);
      g.beam('brass', [-p.w / 2 + 0.16, 0.9, s * 0.35], [-p.w / 2 + 0.6, 0.9, s * 0.35], 0.04);
    }
  },
  treadmill: (c, p) => {
    const { g } = c;
    g.setTint('#202326');
    g.box('iron', -p.w / 2 + 0.08, 0.08, -p.d / 2 + 0.1, p.w / 2 - 0.08, 0.2, p.d / 2);
    g.setTint('#0c0c0c');
    g.box('lacquer', -p.w / 2 + 0.14, 0.2, -p.d / 2 + 0.3, p.w / 2 - 0.14, 0.215, p.d / 2 - 0.05);
    g.setTint('#9aa0a6');
    for (const s of [-1, 1]) {
      g.beam('iron', [s * (p.w / 2 - 0.1), 0.2, -p.d / 2 + 0.25], [s * (p.w / 2 - 0.1), p.h - 0.2, -p.d / 2 + 0.05], 0.06);
      g.beam('iron', [s * (p.w / 2 - 0.1), p.h - 0.35, -p.d / 2 + 0.1], [s * (p.w / 2 - 0.1), p.h - 0.4, -p.d / 2 + 0.75], 0.05);
    }
    g.setTint('#101418');
    g.box('lacquer', -p.w / 2 + 0.12, p.h - 0.32, -p.d / 2, p.w / 2 - 0.12, p.h, -p.d / 2 + 0.12);
  },
  weights: (c, p) => {
    const { g } = c;
    // Two-tier dumbbell rack with a barbell leaning beside it.
    g.setTint('#24272a');
    for (const s of [-1, 1]) g.box('iron', s * (p.w / 2 - 0.06) - 0.04, 0, -p.d / 2, s * (p.w / 2 - 0.06) + 0.04, p.h, p.d / 2);
    for (const y of [0.45, 0.9]) {
      g.setTint('#24272a');
      g.box('iron', -p.w / 2, y - 0.03, -p.d / 2 + 0.1, p.w / 2, y, p.d / 2 - 0.1);
      for (let x = -p.w / 2 + 0.25; x < p.w / 2 - 0.15; x += 0.34) {
        g.setTint('#0e0e0e');
        const r = 0.07 + 0.03 * c.rand();
        for (const dz of [-0.16, 0.16]) g.sphere('lacquer', x, y + r, dz, r, r, 0.06, 8, 5);
        g.setTint('#9aa0a6');
        g.box('iron', x - 0.015, y + r - 0.015, -0.14, x + 0.015, y + r + 0.015, 0.14);
      }
    }
  },
  stage: (c, p) => {
    const { g } = c;
    const col = c.room?.finish.drapery ?? '#6a1d33';
    g.setTint('#5a3a22');
    g.box('wood-mid', -p.w / 2, 0, -p.d / 2, p.w / 2, p.h, p.d / 2);
    g.setTint('#2a1a12');
    g.box('wood-dark', -p.w / 2, p.h - 0.08, p.d / 2, p.w / 2, p.h, p.d / 2 + 0.05);
    // Proscenium: curtains drawn back at the sides, a pelmet across the top, a backcloth behind.
    const top = Math.min(4.2, (c.room ? c.room.ceilingY - c.room.floorY : 4.4) - 0.25);
    g.setTint(col);
    for (const s of [-1, 1]) g.box('fabric', s > 0 ? p.w / 2 - 0.9 : -p.w / 2, p.h, p.d / 2 - 0.25, s > 0 ? p.w / 2 : -p.w / 2 + 0.9, top, p.d / 2 - 0.1);
    g.box('fabric', -p.w / 2, top - 0.55, p.d / 2 - 0.28, p.w / 2, top, p.d / 2 - 0.07);
    g.setTint('#1a2230');
    g.box('fabric', -p.w / 2 + 0.2, p.h, -p.d / 2 + 0.04, p.w / 2 - 0.2, top - 0.3, -p.d / 2 + 0.1);
    // Steps up at one side.
    g.setTint('#5a3a22');
    g.box('wood-mid', p.w / 2 - 1.6, 0, p.d / 2, p.w / 2 - 0.6, p.h / 2, p.d / 2 + 0.6);
  },
  bathtub: (c, p) => {
    const { g } = c;
    g.setTint('#f4f2ec');
    g.box('marble', -p.w / 2, 0.12, -p.d / 2, p.w / 2, p.h, p.d / 2, 0b111011);
    g.setTint('#cfd8dc');
    g.quad('marble', [-p.w / 2 + 0.08, p.h - 0.1, p.d / 2 - 0.08], [p.w / 2 - 0.08, p.h - 0.1, p.d / 2 - 0.08], [p.w / 2 - 0.08, p.h - 0.1, -p.d / 2 + 0.08], [-p.w / 2 + 0.08, p.h - 0.1, -p.d / 2 + 0.08]);
    g.setTint('#ffffff');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.sphere('brass', sx * (p.w / 2 - 0.15), 0.06, sz * (p.d / 2 - 0.12), 0.07, 0.06, 0.07, 6, 4);
    g.cylinder('brass', -p.w / 2 + 0.1, p.h, 0, 0.02, 0.02, 0.3, 6, false);
  },
  bench: (c, p) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand()));
    legs(g, 'wood-dark', p.w, p.d, p.h - 0.1, 0.05);
    g.setTint(seatColour(c));
    g.box('fabric', -p.w / 2, p.h - 0.12, -p.d / 2, p.w / 2, p.h, p.d / 2);
  },
  globe: (c) => {
    const { g } = c;
    g.setTint(pick(WOODS, c.rand()));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      g.box('wood-dark', Math.cos(a) * 0.22 - 0.025, 0, Math.sin(a) * 0.22 - 0.025, Math.cos(a) * 0.22 + 0.025, 0.6, Math.sin(a) * 0.22 + 0.025);
    }
    g.lathe('wood-dark', 0, 0, [[0.34, 0.6], [0.34, 0.65]], 16, false);
    g.setTint('#c8a870');
    g.sphere('leather', 0, 0.75, 0, 0.27, 0.27, 0.27, 12, 8);
  },
  'music-stand': (c, p) => {
    const { g } = c;
    g.setTint('#ffffff');
    g.cylinder('iron', 0, 0, 0, 0.012, 0.012, 1.0, 5, false);
    g.quadFacing('iron', [-0.22, 0.95, 0.02], [0.22, 0.95, 0.02], [0.22, 1.25, -0.12], [-0.22, 1.25, -0.12], 0, 0.5, 1);
    void p;
  },
  harp: (c, p) => {
    const { g } = c;
    g.setTint('#ffffff');
    g.cylinder('gilt', 0, 0, 0.3, 0.05, 0.04, p.h, 8, true);
    g.box('gilt', -0.04, 0, -0.35, 0.04, 0.12, 0.35);
    g.setTint('#8a5a2c');
    g.quadFacing('wood-mid', [-0.02, 0.15, -0.35], [-0.02, 0.15, 0.25], [-0.02, p.h - 0.1, 0.25], [-0.02, p.h * 0.7, -0.3], -1, 0, 0);
  },
  urn: (c, p) => {
    const { g } = c;
    g.setTint(c.room ? MARBLE : '#ddd6c8');
    g.lathe('ext-trim', 0, 0, [[0.15, 0], [0.2, 0.08], [0.12, 0.15], [0.26, 0.45], [0.2, 0.75], [0.25, 0.8], [0.23, p.h]], 10, true);
  },
  lamppost: (c, p) => {
    const { g } = c;
    g.setTint('#ffffff');
    g.cylinder('iron', 0, 0, 0, 0.16, 0.12, 0.35, 8, true);
    g.cylinder('iron', 0, 0.35, 0, 0.055, 0.045, p.h - 0.85, 8, false);
    g.box('iron', -0.17, p.h - 0.5, -0.17, 0.17, p.h - 0.45, 0.17);
    g.box('lamp', -0.13, p.h - 0.45, -0.13, 0.13, p.h - 0.08, 0.13);
    g.lathe('iron', 0, 0, [[0.2, p.h - 0.08], [0.04, p.h + 0.12]], 8, true);
  },
};

export function colorOf(hex: string): THREE.Color {
  return new THREE.Color(hex);
}
