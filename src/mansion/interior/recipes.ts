/**
 * Room recipes: what goes where, per room type. Recipes only describe intent;
 * the Placer enforces clearances, window rules and reachability.
 */
import type { PoiType, Prop, RoomType } from '../core/types';
import { SIDES, type Placer, type Side } from './placer';

export const TUNGSTEN: [number, number, number] = [1.0, 0.6, 0.3];
export const WARM: [number, number, number] = [1.0, 0.54, 0.24];
export const CANDLE: [number, number, number] = [1.0, 0.48, 0.17];
export const FIRE: [number, number, number] = [1.0, 0.36, 0.09];

export interface RecipeOptions {
  wantBar: boolean;
}

const opposite: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

function mark(prop: Prop | null, poi: PoiType): Prop | null {
  if (prop) prop.poi = poi;
  return prop;
}

/** The wall facing the windows: where a guest's front is seen from outside. */
function backSide(p: Placer): Side {
  const ws = p.windowSides();
  return ws.length ? opposite[ws[0]!] : p.solidSides()[0]!;
}

function perpendicularSides(s: Side): Side[] {
  return s === 'n' || s === 's' ? ['e', 'w'] : ['n', 's'];
}

/* ------------------------------------------------------------------ */
/* Shared groups                                                       */
/* ------------------------------------------------------------------ */

export function chandeliers(p: Placer, perArea = 42, max = 4): void {
  const long = Math.max(p.width, p.depth);
  const short = Math.min(p.width, p.depth);
  const area = p.width * p.depth;
  const n = Math.max(1, Math.min(max, Math.round(area / perArea), Math.round(long / 5.5)));
  const clear = p.ceilY - p.floorY;
  const h = Math.min(2.4, Math.max(0.9, clear * 0.3));
  const w = Math.min(2.2, Math.max(0.8, short * 0.2));
  const intensity = Math.min(900, Math.max(260, (area / n) * 9)) * p.room.lit;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : (i + 0.5) / n;
    const x = p.longAxis === 'x' ? p.inner.x0 + t * p.width : p.cx;
    const z = p.longAxis === 'z' ? p.inner.z0 + t * p.depth : p.cz;
    p.add('chandelier', x, z, 0, w, w, h, { y: p.ceilY - h, blocks: false, mount: 'ceiling', variant: p.room.role === 'party' ? 0 : 1 });
    if (p.room.lit > 0) p.light('chandelier', x, p.ceilY - h * 0.6, z, TUNGSTEN, intensity, Math.max(9, long * 0.9));
  }
}

export function sconces(p: Placer, spacing = 3.4): void {
  if (p.room.lit <= 0) return;
  const y = p.floorY + Math.min(2.3, (p.ceilY - p.floorY) * 0.5);
  let count = 0;
  for (const side of SIDES) {
    const info = p.sides[side];
    // Piers between windows on window walls; regular spacing elsewhere.
    const runs = p.freeRuns(side, 0, 0.6);
    for (const [a, b] of runs) {
      const n = Math.max(1, Math.floor((b - a) / spacing));
      for (let k = 0; k < n; k++) {
        if (count >= 10) return;
        const t = a + ((k + 0.5) * (b - a)) / n;
        if (info.windows === 0 && b - a < 1.0) continue;
        const prop = p.onWall(side, 'sconce', 0.32, 0.45, y, { prefer: t, sweep: false });
        if (prop) {
          const at = p.at(side, t, 0.25);
          p.light('sconce', at.x, y + 0.12, at.z, WARM, 55 * p.room.lit, 6);
          count++;
        }
      }
    }
  }
}

export function paintings(p: Placer, count: number, opts: { sides?: Side[]; poi?: boolean; big?: boolean } = {}): void {
  const clear = p.ceilY - p.floorY;
  const sides = opts.sides ?? p.solidSides();
  let placed = 0;
  for (let pass = 0; pass < 2 && placed < count; pass++) {
    for (const side of sides) {
      if (placed >= count) break;
      const runs = p.freeRuns(side, Math.min(clear - 0.5, 2.6), 1.0);
      for (const [a, b] of runs) {
        if (placed >= count) break;
        const portrait = p.rng.chance(0.55);
        const w = opts.big ? p.rng.range(1.4, 2.2) : portrait ? p.rng.range(0.7, 1.1) : p.rng.range(1.0, 1.7);
        const h = opts.big ? w * p.rng.range(0.6, 0.8) : portrait ? w * p.rng.range(1.2, 1.4) : w * p.rng.range(0.65, 0.8);
        if (b - a < w + 0.4) continue;
        const yc = p.floorY + Math.min(clear - h / 2 - 0.35, 1.25 + Math.max(0.6, h / 2) + (pass ? 0.2 : 0));
        const t = pass === 0 ? (a + b) / 2 : a + (b - a) * p.rng.range(0.25, 0.75);
        const prop = p.onWall(side, 'painting', w, h, yc, { prefer: t, variant: p.rng.int(0, 7) });
        if (prop) {
          if (opts.poi) prop.poi = 'painting';
          placed++;
        }
      }
    }
  }
}

function fireplace(p: Placer, sides: Side[]): Side | null {
  for (const side of sides) {
    const runs = p.freeRuns(side, 2.4, 2.6);
    if (!runs.length) continue;
    const [a, b] = runs[0]!;
    const t = (a + b) / 2;
    const fp = p.againstWall(side, 'fireplace', 2.0, 0.55, 1.4, { prefer: t, sweep: false, variant: p.rng.int(0, 2) });
    if (!fp) continue;
    fp.poi = 'fireplace';
    const clear = p.ceilY - p.floorY;
    const mh = Math.min(1.6, clear - 2.0);
    if (mh > 0.6) p.onWall(side, p.rng.chance(0.6) ? 'mirror' : 'painting', 1.3, mh, p.floorY + 1.45 + mh / 2 + 0.1, { prefer: t, sweep: false, variant: p.rng.int(0, 7) });
    if (p.room.lit > 0) {
      const at = p.at(side, t, 0.3);
      p.light('fire', at.x, p.floorY + 0.35, at.z, FIRE, 45, 5.5);
    }
    return side;
  }
  return null;
}

/** Sofa + two armchairs + table around a focus, facing `face` side's wall. */
function conversation(p: Placer, cx: number, cz: number, axis: 'x' | 'z', withRug = true): boolean {
  const added: Prop[] = [];
  const take = (q: Prop | null) => {
    if (q) added.push(q);
    return q;
  };
  // Sofa on one side of the axis, armchairs opposite or flanking.
  const sofa =
    axis === 'z'
      ? take(p.add('sofa', cx, cz + 1.3, Math.PI, 2.1, 0.9, 0.85, { variant: p.rng.int(0, 2) }))
      : take(p.add('sofa', cx + 1.3, cz, -Math.PI / 2, 2.1, 0.9, 0.85, { variant: p.rng.int(0, 2) }));
  if (!sofa) return false;
  take(p.add('coffee-table', cx, cz, axis === 'z' ? 0 : Math.PI / 2, 1.2, 0.65, 0.45));
  if (axis === 'z') {
    take(p.add('armchair', cx - 1.45, cz - 0.1, Math.PI / 2, 0.85, 0.85, 0.95));
    take(p.add('armchair', cx + 1.45, cz - 0.1, -Math.PI / 2, 0.85, 0.85, 0.95));
  } else {
    take(p.add('armchair', cx - 0.1, cz - 1.45, 0, 0.85, 0.85, 0.95));
    take(p.add('armchair', cx - 0.1, cz + 1.45, Math.PI, 0.85, 0.85, 0.95));
  }
  if (withRug) take(p.add('rug', cx, cz, axis === 'z' ? 0 : Math.PI / 2, 3.6, 2.8, 0.012, { blocks: false, variant: p.rng.int(0, 3) }));
  // Lamp on a side table at the sofa end.
  const st = axis === 'z' ? p.add('side-table', cx + 1.45, cz + 1.3, 0, 0.5, 0.5, 0.6) : p.add('side-table', cx + 1.3, cz + 1.45, 0, 0.5, 0.5, 0.6);
  if (st && p.room.lit > 0) {
    p.add('lamp', st.x, st.z, 0, 0.4, 0.4, 0.7, { y: p.floorY + 0.6, blocks: false });
    p.light('lamp', st.x, p.floorY + 1.15, st.z, WARM, 60 * p.room.lit, 5);
  }
  return true;
}

function cornerStatues(p: Placer, max: number, poi = true, kind: 'statue' | 'bust' | 'plant' = 'statue'): number {
  const i = p.inner;
  const off = 0.95;
  const corners = p.rng.shuffle([
    [i.x0 + off, i.z0 + off],
    [i.x1 - off, i.z0 + off],
    [i.x0 + off, i.z1 - off],
    [i.x1 - off, i.z1 - off],
  ] as const);
  let n = 0;
  for (const [x, z] of corners) {
    if (n >= max) break;
    const yaw = Math.atan2(p.cx - x, p.cz - z);
    const q = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
    const prop =
      kind === 'plant'
        ? p.add('plant', x, z, 0, 0.8, 0.8, 1.9, { occludes: true, variant: p.rng.int(0, 2) })
        : p.add(kind, x, z, q, 0.75, 0.75, kind === 'statue' ? 2.25 : 1.75, { occludes: true, variant: p.rng.int(0, 3) });
    if (prop) {
      if (poi && kind !== 'plant') prop.poi = 'statue';
      n++;
    }
  }
  return n;
}

function chairsAlong(p: Placer, side: Side, spacing: number, max: number): number {
  let n = 0;
  for (const [a, b] of p.freeRuns(side, 1.0, 0.8)) {
    const count = Math.floor((b - a) / spacing);
    for (let k = 0; k < count && n < max; k++) {
      const t = a + (k + 0.5) * ((b - a) / count);
      const at = p.at(side, t, 0.32);
      if (p.add('chair', at.x, at.z, sideYaw(side), 0.5, 0.52, 0.95, { variant: 1 })) n++;
    }
  }
  return n;
}

function sideYaw(side: Side): number {
  return { n: Math.PI, s: 0, e: -Math.PI / 2, w: Math.PI / 2 }[side];
}

function bar(p: Placer): boolean {
  const back = backSide(p);
  const order = [back, ...perpendicularSides(back), opposite[back]];
  // Full bar: back shelf against the wall, counter in front, guests on the room side.
  for (const side of order) {
    for (const [a, b] of p.freeRuns(side, 2.3, 3.4)) {
      for (const t of [(a + b) / 2, a + 1.7, b - 1.7]) {
        const shelf = p.againstWall(side, 'bar-shelf', 3.0, 0.42, 2.2, { prefer: t, sweep: false, occludes: true });
        if (!shelf) continue;
        const at = p.at(side, t, 0.42 + 1.05 + 0.35);
        const counter = p.add('bar-counter', at.x, at.z, sideYaw(side), 3.0, 0.7, 1.1, { occludes: false });
        if (!counter) {
          p.remove(shelf);
          continue;
        }
        counter.poi = 'bar';
        barLight(p, side, t);
        return true;
      }
    }
  }
  // Counter only (e.g. in front of low windows), bartender behind it.
  for (const side of order) {
    for (const [a, b] of p.freeRuns(side, 1.15, 2.8)) {
      const t = (a + b) / 2;
      const at = p.at(side, t, 0.9 + 0.35);
      const counter = p.add('bar-counter', at.x, at.z, sideYaw(side), 2.6, 0.7, 1.1, { occludes: false });
      if (!counter) continue;
      counter.poi = 'bar';
      barLight(p, side, t);
      return true;
    }
  }
  return false;
}

function barLight(p: Placer, side: Side, t: number): void {
  if (p.room.lit <= 0) return;
  const l = p.at(side, t, 1.0);
  p.light('lamp', l.x, p.floorY + 2.3, l.z, WARM, 80, 5);
}

function bookcases(p: Placer, sides: Side[], maxPoi: number): number {
  const h = Math.min(3.2, p.ceilY - p.floorY - 0.45);
  let n = 0;
  let pois = 0;
  for (const side of sides) {
    for (const [a, b] of p.freeRuns(side, h, 1.0)) {
      const count = Math.max(1, Math.floor((b - a) / 1.25));
      const w = (b - a) / count - 0.02;
      for (let k = 0; k < count; k++) {
        const t = a + (k + 0.5) * ((b - a) / count);
        const bc = p.againstWall(side, 'bookcase', w, 0.45, h, { prefer: t, sweep: false, occludes: true, variant: p.rng.int(0, 3) });
        if (bc) {
          n++;
          if (pois < maxPoi && k === Math.floor(count / 2)) {
            bc.poi = 'bookshelf';
            pois++;
          }
        }
      }
    }
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Recipes                                                             */
/* ------------------------------------------------------------------ */

type Recipe = (p: Placer, o: RecipeOptions) => void;

/** The great chandelier under the dome: one fitting, lighting the hall and every gallery round it. */
function domeChandelier(p: Placer, fitting: boolean): void {
  const d = p.dome!;
  if (fitting) p.add('chandelier', d.x, d.z, 0, 2.8, 2.8, 3.2, { y: d.y - 1.6, blocks: false, mount: 'ceiling', variant: 0 });
  if (p.room.lit > 0) p.light('chandelier', d.x, d.y, d.z, TUNGSTEN, (fitting ? 760 : 520) * p.room.lit, 22);
}

const ballroom: Recipe = (p, o) => {
  if (p.dome) domeChandelier(p, true);
  else chandeliers(p, 40, 4);
  const back = backSide(p);
  // Band corner: piano and stands at one end of the back wall.
  const ends = perpendicularSides(back);
  const end = p.rng.pick(ends);
  const bi = p.sides[back];
  const ei = p.sides[end];
  const tEnd = end === 'e' || end === 'n' ? ei.line - 2.4 : ei.line + 2.4;
  const pianoAt = p.at(back, back === 'n' || back === 's' ? tEnd : tEnd, 1.9);
  const pianoYaw = sideYaw(back) + (end === 'e' || end === 'n' ? -0.35 : 0.35);
  const piano = p.add('grand-piano', pianoAt.x, pianoAt.z, Math.round(pianoYaw / (Math.PI / 2)) * (Math.PI / 2), 1.55, 2.1, 1.0, { variant: 0 });
  if (piano) {
    piano.yaw = pianoYaw;
    piano.poi = 'piano';
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * 0.9;
      const s = p.at(back, (back === 'n' || back === 's' ? pianoAt.x : pianoAt.z) + (end === 'e' || end === 'n' ? -2.2 : 2.2) + off, 2.4);
      p.add('music-stand', s.x, s.z, sideYaw(back), 0.45, 0.4, 1.2);
      const c = p.at(back, (back === 'n' || back === 's' ? pianoAt.x : pianoAt.z) + (end === 'e' || end === 'n' ? -2.2 : 2.2) + off, 1.7);
      p.add('chair', c.x, c.z, sideYaw(back), 0.5, 0.52, 0.95, { variant: 1 });
    }
  }
  void bi;
  if (o.wantBar) bar(p);
  cornerStatues(p, 4, true);
  for (const s of [...perpendicularSides(back), back]) chairsAlong(p, s, 1.0, 10);
  // Two cocktail tables near the windows for mingling groups.
  const ws = p.windowSides()[0];
  if (ws) {
    for (const frac of [0.25, 0.75]) {
      const info = p.sides[ws];
      const t = info.t0 + frac * (info.t1 - info.t0);
      const at = p.at(ws, t, 2.2);
      p.add('cocktail-table', at.x, at.z, 0, 0.75, 0.75, 1.05, { variant: 1 });
    }
  }
  for (const s of perpendicularSides(back)) p.onWall(s, 'mirror', 1.4, Math.min(2.6, p.ceilY - p.floorY - 1.6), p.floorY + 1.0 + Math.min(2.6, p.ceilY - p.floorY - 1.6) / 2, {});
  paintings(p, 2, { sides: [back], big: true, poi: true });
  sconces(p, 3.0);
};

const drawingRoom: Recipe = (p, o) => {
  chandeliers(p, 45, 2);
  const back = backSide(p);
  const fs = fireplace(p, [...perpendicularSides(back), back]);
  // Conversation group in front of the fireplace, then a second one.
  if (fs) {
    const t = (p.sides[fs].t0 + p.sides[fs].t1) / 2;
    const c = p.at(fs, t, 2.3);
    conversation(p, c.x, c.z, fs === 'n' || fs === 's' ? 'z' : 'x');
  }
  if (o.wantBar) bar(p);
  if (Math.max(p.width, p.depth) > 8.5) {
    const along = p.longAxis;
    const cx = along === 'x' ? p.inner.x0 + p.width * (fs === 'w' ? 0.72 : 0.28) : p.cx;
    const cz = along === 'z' ? p.inner.z0 + p.depth * (fs === 's' ? 0.72 : 0.28) : p.cz;
    conversation(p, cx, cz, along === 'x' ? 'z' : 'x');
  }
  const cs = p.againstWall(back, p.rng.chance(0.5) ? 'console' : 'sideboard', 1.6, 0.5, 0.9);
  if (cs && p.room.lit > 0) {
    p.add('lamp', cs.x, cs.z, 0, 0.4, 0.4, 0.7, { y: p.floorY + 0.9, blocks: false });
    p.light('lamp', cs.x, p.floorY + 1.45, cs.z, WARM, 55 * p.room.lit, 5);
  }
  if (p.rng.chance(0.5)) cardTable(p, p.cx, p.cz);
  cornerStatues(p, 2, false, 'plant');
  if (p.rng.chance(0.5)) cornerStatues(p, 1, true, 'statue');
  paintings(p, 4, { poi: true });
  sconces(p);
};

function cardTable(p: Placer, x: number, z: number): boolean {
  const t = p.add('card-table', x, z, 0, 0.9, 0.9, 0.74, { variant: p.rng.int(0, 1) });
  if (!t) return false;
  p.add('chair', x, z - 0.75, 0, 0.5, 0.52, 0.95);
  p.add('chair', x, z + 0.75, Math.PI, 0.5, 0.52, 0.95);
  p.add('chair', x - 0.75, z, Math.PI / 2, 0.5, 0.52, 0.95);
  p.add('chair', x + 0.75, z, -Math.PI / 2, 0.5, 0.52, 0.95);
  return true;
}

const library: Recipe = (p, o) => {
  chandeliers(p, 50, 2);
  const back = backSide(p);
  fireplace(p, perpendicularSides(back));
  bookcases(p, [back, ...perpendicularSides(back)], 2);
  // Long reading table on the long axis.
  const along = p.longAxis;
  const tl = Math.min(3.0, Math.max(p.width, p.depth) - 4.5);
  if (tl >= 1.6) {
    const yaw = along === 'x' ? Math.PI / 2 : 0;
    const t = p.add('dining-table', p.cx, p.cz, yaw, 1.1, tl, 0.78, { variant: 2 });
    if (t && p.room.lit > 0) {
      p.add('lamp', p.cx, p.cz, 0, 0.35, 0.35, 0.55, { y: p.floorY + 0.78, blocks: false, variant: 1 });
      p.light('lamp', p.cx, p.floorY + 1.3, p.cz, WARM, 55 * p.room.lit, 5);
    }
    if (t) {
      for (const s of [-1, 1]) {
        if (along === 'x') {
          p.add('chair', p.cx - tl / 4, p.cz + s * 0.85, s > 0 ? Math.PI : 0, 0.5, 0.52, 0.95);
          p.add('chair', p.cx + tl / 4, p.cz + s * 0.85, s > 0 ? Math.PI : 0, 0.5, 0.52, 0.95);
        } else {
          p.add('chair', p.cx + s * 0.85, p.cz - tl / 4, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.5, 0.52, 0.95);
          p.add('chair', p.cx + s * 0.85, p.cz + tl / 4, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.5, 0.52, 0.95);
        }
      }
    }
  }
  const ws = p.windowSides()[0];
  if (ws) {
    const info = p.sides[ws];
    const g = p.at(ws, info.t0 + (info.t1 - info.t0) * 0.15, 1.3);
    mark(p.add('globe', g.x, g.z, 0, 0.7, 0.7, 1.05, { variant: 0 }), 'globe');
    const a = p.at(ws, info.t0 + (info.t1 - info.t0) * 0.85, 1.4);
    p.add('armchair', a.x, a.z, sideYaw(ws) + Math.PI, 0.85, 0.85, 0.95, { variant: 1 });
  }
  if (o.wantBar) bar(p);
  sconces(p, 4);
};

const diningRoom: Recipe = (p, o) => {
  const along = p.longAxis;
  const long = Math.max(p.width, p.depth);
  const tl = Math.min(9, Math.max(2.4, long - 3.4));
  const yaw = along === 'x' ? Math.PI / 2 : 0;
  const table = p.add('dining-table', p.cx, p.cz, yaw, 1.25, tl, 0.76, { variant: 0 });
  if (table) {
    const n = Math.max(2, Math.floor((tl - 0.6) / 0.75));
    for (let k = 0; k < n; k++) {
      const u = -tl / 2 + 0.55 + (k * (tl - 1.1)) / Math.max(1, n - 1);
      for (const s of [-1, 1]) {
        if (along === 'x') p.add('chair', p.cx + u, p.cz + s * 0.95, s > 0 ? Math.PI : 0, 0.5, 0.52, 1.05, { variant: 0 });
        else p.add('chair', p.cx + s * 0.95, p.cz + u, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.5, 0.52, 1.05, { variant: 0 });
      }
    }
    for (const s of [-1, 1]) {
      if (along === 'x') p.add('chair', p.cx + s * (tl / 2 + 0.45), p.cz, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0.55, 0.55, 1.15, { variant: 0 });
      else p.add('chair', p.cx, p.cz + s * (tl / 2 + 0.45), s > 0 ? Math.PI : 0, 0.55, 0.55, 1.15, { variant: 0 });
    }
    // Candelabra down the table.
    const nc = tl > 5 ? 3 : 2;
    for (let k = 0; k < nc; k++) {
      const u = -tl / 2 + ((k + 0.5) * tl) / nc;
      const x = along === 'x' ? p.cx + u : p.cx;
      const z = along === 'z' ? p.cz + u : p.cz;
      p.add('lamp', x, z, 0, 0.35, 0.35, 0.6, { y: p.floorY + 0.76, blocks: false, variant: 2 });
      if (p.room.lit > 0) p.light('candles', x, p.floorY + 1.3, z, CANDLE, 30 * p.room.lit, 4.5);
    }
  }
  chandeliers(p, 30, 2);
  const back = backSide(p);
  const sb = p.againstWall(back, 'sideboard', 2.2, 0.55, 0.95);
  if (sb && p.room.lit > 0) p.light('candles', sb.x, p.floorY + 1.3, sb.z, CANDLE, 25 * p.room.lit, 4);
  fireplace(p, perpendicularSides(back));
  if (o.wantBar) bar(p);
  paintings(p, 4, { poi: true });
  sconces(p);
};

const musicRoom: Recipe = (p, o) => {
  chandeliers(p, 45, 2);
  const ws = p.windowSides()[0] ?? p.solidSides()[0]!;
  const info = p.sides[ws];
  const t = info.t0 + (info.t1 - info.t0) * p.rng.range(0.3, 0.7);
  const at = p.at(ws, t, 2.0);
  const piano = p.add('grand-piano', at.x, at.z, sideYaw(ws) + Math.PI, 1.55, 2.1, 1.0);
  if (piano) {
    piano.yaw = sideYaw(ws) + Math.PI + p.rng.range(-0.4, 0.4);
    piano.poi = 'piano';
    const h = p.at(ws, t + (t > (info.t0 + info.t1) / 2 ? -1.9 : 1.9), 1.8);
    p.add('harp', h.x, h.z, sideYaw(ws) + Math.PI, 0.7, 1.0, 1.8, { occludes: true });
  }
  // Two rows of chairs facing the piano.
  for (let row = 0; row < 2; row++) {
    for (let k = -2; k <= 2; k++) {
      const c = p.at(ws, t + k * 0.75, 4.4 + row * 1.0);
      p.add('chair', c.x, c.z, sideYaw(ws) + Math.PI, 0.5, 0.52, 0.95, { variant: 1 });
    }
  }
  const back = opposite[ws];
  p.againstWall(back, 'sofa', 2.1, 0.9, 0.85);
  if (o.wantBar) bar(p);
  cornerStatues(p, 2, false, 'plant');
  paintings(p, 3, { poi: true });
  sconces(p);
};

const gallery: Recipe = (p, o) => {
  chandeliers(p, 36, 4);
  const along = p.longAxis;
  const long = Math.max(p.width, p.depth);
  const sides: Side[] = along === 'x' ? ['n', 's'] : ['e', 'w'];
  paintings(p, Math.max(4, Math.floor(long / 2.2) * 2), { sides, poi: true, big: p.rng.chance(0.4) });
  // Statues down the spine, benches between them.
  const n = Math.max(2, Math.floor(long / 5));
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    const x = along === 'x' ? p.inner.x0 + u * p.width : p.cx;
    const z = along === 'z' ? p.inner.z0 + u * p.depth : p.cz;
    if (k % 2 === 0) mark(p.add('statue', x, z, p.rng.pick([0, Math.PI]), 0.8, 0.8, 2.3, { occludes: true, variant: p.rng.int(0, 3) }), 'statue');
    else p.add('bench', x, z, along === 'x' ? 0 : Math.PI / 2, 1.6, 0.5, 0.45);
  }
  if (o.wantBar) bar(p);
  sconces(p, 4);
};

const billiardRoom: Recipe = (p, o) => {
  const yaw = p.longAxis === 'x' ? Math.PI / 2 : 0;
  const t = p.add('billiard-table', p.cx, p.cz, yaw, 1.7, 3.0, 0.82);
  if (t) {
    p.add('lamp', p.cx, p.cz, yaw, 0.6, 2.2, 0.5, { y: p.floorY + 1.55, blocks: false, mount: 'ceiling', variant: 3 });
    if (p.room.lit > 0) p.light('lamp', p.cx, p.floorY + 1.55, p.cz, WARM, 140 * p.room.lit, 4.5);
  }
  const back = backSide(p);
  if (o.wantBar) bar(p);
  p.onWall(perpendicularSides(back)[0]!, 'cabinet', 1.2, 1.3, p.floorY + 1.4, { variant: 2 });
  for (const s of perpendicularSides(back)) {
    const a = p.againstWall(s, 'armchair', 0.85, 0.85, 0.95, { variant: 1 });
    if (a) p.againstWall(s, 'side-table', 0.5, 0.5, 0.6);
  }
  fireplace(p, [back]);
  paintings(p, 3, { poi: true });
  sconces(p);
};

const cardRoom: Recipe = (p, o) => {
  chandeliers(p, 40, 2);
  const cols = Math.max(1, Math.min(3, Math.floor(p.width / 3.2)));
  const rows = Math.max(1, Math.min(2, Math.floor(p.depth / 3.2)));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      cardTable(p, p.inner.x0 + ((i + 0.5) * p.width) / cols, p.inner.z0 + ((j + 0.5) * p.depth) / rows);
    }
  }
  if (o.wantBar) bar(p);
  const back = backSide(p);
  fireplace(p, perpendicularSides(back));
  p.againstWall(back, 'sideboard', 2.0, 0.55, 0.95);
  paintings(p, 3, { poi: true });
  sconces(p);
};

const morningRoom: Recipe = (p, o) => {
  chandeliers(p, 45, 1);
  const ws = p.windowSides()[0];
  if (ws) {
    const info = p.sides[ws];
    const at = p.at(ws, (info.t0 + info.t1) / 2, 1.9);
    if (p.add('cocktail-table', at.x, at.z, 0, 1.1, 1.1, 0.75, { variant: 2 })) {
      for (const [dx, dz] of [
        [0.8, 0],
        [-0.8, 0],
        [0, 0.8],
        [0, -0.8],
      ] as const) {
        p.add('chair', at.x + dx, at.z + dz, Math.atan2(-dx, -dz), 0.5, 0.52, 0.95, { variant: 1 });
      }
    }
  }
  const back = backSide(p);
  const c = p.at(back, (p.sides[back].t0 + p.sides[back].t1) / 2, 2.4);
  conversation(p, c.x, c.z, back === 'n' || back === 's' ? 'z' : 'x');
  if (o.wantBar) bar(p);
  p.againstWall(perpendicularSides(back)[0]!, 'desk', 1.4, 0.7, 0.77);
  cornerStatues(p, 2, false, 'plant');
  paintings(p, 3, { poi: true });
  sconces(p);
};

const conservatory: Recipe = (p) => {
  // Palms along the glass, wicker groups inside, a statue at the heart.
  for (const s of SIDES) {
    const info = p.sides[s];
    if (!info.exterior) continue;
    const n = Math.floor((info.t1 - info.t0) / 1.8);
    for (let k = 0; k < n; k++) {
      const at = p.at(s, info.t0 + (k + 0.5) * ((info.t1 - info.t0) / n), 0.55);
      p.add('plant', at.x, at.z, 0, 0.8, 0.8, p.rng.range(1.6, 2.6), { occludes: true, variant: p.rng.int(0, 2) });
    }
  }
  mark(p.add('statue', p.cx, p.cz, 0, 0.9, 0.9, 2.2, { occludes: true, variant: p.rng.int(0, 3) }), 'statue');
  for (const dz of [-1, 1]) {
    const z = p.cz + dz * Math.min(2.6, p.depth / 3);
    const x = p.cx + (p.width > 5 ? dz * 1.6 : 0);
    if (p.add('cocktail-table', x, z, 0, 0.7, 0.7, 0.72, { variant: 3 })) {
      p.add('armchair', x - 0.8, z, Math.PI / 2, 0.75, 0.75, 0.9, { variant: 2 });
      p.add('armchair', x + 0.8, z, -Math.PI / 2, 0.75, 0.75, 0.9, { variant: 2 });
    }
  }
  if (p.room.lit > 0) p.light('lamp', p.cx, p.ceilY - 0.6, p.cz, WARM, 120 * p.room.lit, 9);
};

const entranceHall: Recipe = (p) => {
  chandeliers(p, 50, 2);
  // Statues flanking the axis, a ledger on a console by the door, a long-case clock.
  const along: 'x' | 'z' = 'z';
  void along;
  for (const s of [-1, 1]) {
    mark(p.add('statue', p.cx + s * Math.min(2.2, p.width / 2 - 1.0), p.cz, 0, 0.8, 0.8, 2.3, { occludes: true, variant: p.rng.int(0, 3) }), 'statue');
  }
  const sides = ['e', 'w'] as Side[];
  let led: Prop | null = null;
  for (const s of p.solidSides()) if ((led = p.againstWall(s, 'console', 1.5, 0.5, 0.88))) break;
  if (led) led.poi = 'ledger';
  p.againstWall(p.rng.pick(sides), 'console', 1.5, 0.5, 0.88);
  mark(p.againstWall(p.rng.pick(sides), 'clock', 0.55, 0.38, 2.15, { occludes: true }), 'clock');
  for (const s of sides) p.againstWall(s, 'bench', 1.6, 0.5, 0.45);
  paintings(p, 2, { poi: true });
  sconces(p);
};

const stairHall: Recipe = (p) => {
  chandeliers(p, 60, 1);
  paintings(p, 3, { poi: true, big: true });
  cornerStatues(p, 1, true, 'bust');
  sconces(p);
};

const corridor: Recipe = (p) => {
  const along = p.longAxis;
  const sides: Side[] = along === 'x' ? ['n', 's'] : ['e', 'w'];
  const long = Math.max(p.width, p.depth);
  const lit = p.room.lit;
  const n = Math.max(1, Math.floor(long / 6));
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    const x = along === 'x' ? p.inner.x0 + u * p.width : p.cx;
    const z = along === 'z' ? p.inner.z0 + u * p.depth : p.cz;
    p.add('chandelier', x, z, 0, 0.6, 0.6, 0.7, { y: p.ceilY - 0.7, blocks: false, mount: 'ceiling', variant: 2 });
    if (lit > 0) p.light('chandelier', x, p.ceilY - 0.5, z, TUNGSTEN, 120 * lit, 7);
  }
  if (Math.min(p.width, p.depth) >= 2.3) {
    for (const s of sides) p.againstWall(s, p.rng.chance(0.5) ? 'console' : 'bench', 1.3, 0.38, 0.85);
    if (long > 14) mark(p.againstWall(p.rng.pick(sides), 'clock', 0.55, 0.38, 2.15, { occludes: true }), 'clock');
  }
  paintings(p, Math.floor(long / 4), { sides, poi: true });
  if (long > 6) p.add('rug', p.cx, p.cz, along === 'x' ? Math.PI / 2 : 0, Math.min(p.width, p.depth) * 0.55, long - 1.2, 0.012, { blocks: false, variant: 4 });
};

/** Ring gallery round the dome hall: kept clear to walk, lit by the chandelier and wall lights. */
const hallGallery: Recipe = (p) => {
  if (p.dome) domeChandelier(p, false);
  sconces(p, 3.2);
  paintings(p, 3, { poi: true });
};

/** Roof terrace: open air, a few tables and planters; the lanterns are exterior lights. */
const roofTerrace: Recipe = (p) => {
  const long = Math.max(p.width, p.depth);
  const n = Math.max(1, Math.round(long / 6));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = p.longAxis === 'x' ? p.inner.x0 + t * p.width : p.cx;
    const z = p.longAxis === 'z' ? p.inner.z0 + t * p.depth : p.cz;
    p.add('cocktail-table', x, z, 0, 0.75, 0.75, 1.05, { variant: 1 });
  }
  const i = p.inner;
  for (const [x, z] of [
    [i.x0 + 0.5, i.z0 + 0.5],
    [i.x1 - 0.5, i.z0 + 0.5],
    [i.x0 + 0.5, i.z1 - 0.5],
    [i.x1 - 0.5, i.z1 - 0.5],
  ] as const) {
    p.add('plant', x, z, 0, 0.6, 0.6, 1.4, { occludes: true });
  }
};

const landing: Recipe = (p) => {
  chandeliers(p, 60, 1);
  p.againstWall(p.solidSides()[0]!, 'console', 1.4, 0.45, 0.85);
  paintings(p, 2, { poi: true });
  sconces(p);
};

const study: Recipe = (p) => {
  const ws = p.windowSides()[0];
  if (ws) {
    const info = p.sides[ws];
    const at = p.at(ws, (info.t0 + info.t1) / 2, 1.6);
    if (p.add('desk', at.x, at.z, sideYaw(ws), 1.6, 0.8, 0.77)) {
      p.add('chair', at.x + (ws === 'e' ? -0.7 : ws === 'w' ? 0.7 : 0), at.z + (ws === 'n' ? -0.7 : ws === 's' ? 0.7 : 0), sideYaw(ws) + Math.PI, 0.6, 0.6, 1.1, { variant: 2 });
      if (p.room.lit > 0) {
        p.add('lamp', at.x, at.z, 0, 0.35, 0.35, 0.55, { y: p.floorY + 0.77, blocks: false, variant: 1 });
        p.light('lamp', at.x, p.floorY + 1.3, at.z, WARM, 60 * p.room.lit, 5);
      }
    }
  }
  const back = backSide(p);
  bookcases(p, [back], 1);
  const i = p.inner;
  mark(p.add('safe', i.x0 + 0.5, i.z0 + 0.45, 0, 0.7, 0.6, 1.0), 'safe') ?? mark(p.add('safe', i.x1 - 0.5, i.z0 + 0.45, 0, 0.7, 0.6, 1.0), 'safe');
  fireplace(p, perpendicularSides(back));
  p.againstWall(perpendicularSides(back)[1]!, 'armchair', 0.85, 0.85, 0.95, { variant: 1 });
  paintings(p, 2);
  if (p.room.lit > 0) chandeliers(p, 60, 1);
};

const service: Recipe = (p) => {
  for (const s of p.solidSides().slice(0, 2)) p.againstWall(s, 'cabinet', 1.4, 0.5, 1.9, { occludes: true });
  if (p.room.lit > 0) p.light('lamp', p.cx, p.ceilY - 0.3, p.cz, TUNGSTEN, 60 * p.room.lit, 5);
};

const bedroom: Recipe = (p) => {
  const ws = p.windowSides()[0];
  const sides = ws ? [opposite[ws], ...perpendicularSides(ws)] : p.solidSides();
  let bed: Prop | null = null;
  for (const s of sides) {
    bed = p.againstWall(s, 'bed', 1.8, 2.2, 2.3, { variant: p.rng.int(0, 1) });
    if (bed) {
      const info = p.sides[s];
      const t = s === 'n' || s === 's' ? bed.x : bed.z;
      for (const d of [-1.35, 1.35]) {
        const st = p.againstWall(s, 'side-table', 0.5, 0.45, 0.62, { prefer: t + d, sweep: false });
        if (st && p.room.lit > 0) {
          p.add('lamp', st.x, st.z, 0, 0.32, 0.32, 0.5, { y: p.floorY + 0.62, blocks: false });
          p.light('lamp', st.x, p.floorY + 1.05, st.z, WARM, 45 * p.room.lit, 4.5);
        }
      }
      void info;
      break;
    }
  }
  for (const s of p.solidSides()) if (p.againstWall(s, 'wardrobe', 1.6, 0.6, 2.3, { occludes: true })) break;
  p.againstWall(p.solidSides()[1]!, 'console', 1.2, 0.5, 0.8);
  const a = p.add('armchair', p.inner.x0 + 1.0, p.inner.z1 - 1.0, Math.PI * 0.75, 0.85, 0.85, 0.95);
  void a;
  p.add('rug', p.cx, p.cz, 0, Math.min(3.2, p.width - 1.2), Math.min(2.4, p.depth - 1.2), 0.012, { blocks: false, variant: p.rng.int(0, 3) });
  paintings(p, 2);
  if (p.room.lit > 0.5) chandeliers(p, 60, 1);
};

const sittingRoom: Recipe = (p) => {
  const back = backSide(p);
  const c = p.at(back, (p.sides[back].t0 + p.sides[back].t1) / 2, 2.3);
  conversation(p, c.x, c.z, back === 'n' || back === 's' ? 'z' : 'x');
  p.againstWall(perpendicularSides(back)[0]!, 'bookcase', 1.2, 0.45, Math.min(2.4, p.ceilY - p.floorY - 0.4), { occludes: true });
  p.againstWall(perpendicularSides(back)[1]!, 'desk', 1.4, 0.7, 0.77);
  paintings(p, 2);
  if (p.room.lit > 0) chandeliers(p, 60, 1);
};

const dressingRoom: Recipe = (p) => {
  for (const s of p.solidSides().slice(0, 2)) p.againstWall(s, 'wardrobe', 1.6, 0.6, 2.3, { occludes: true });
  p.onWall(p.solidSides()[2] ?? 'n', 'mirror', 0.9, 1.6, p.floorY + 1.3);
  if (p.room.lit > 0) p.light('lamp', p.cx, p.ceilY - 0.3, p.cz, WARM, 40 * p.room.lit, 4);
};

const bathroom: Recipe = (p) => {
  p.againstWall(p.solidSides()[0]!, 'cabinet', 1.2, 0.55, 0.9, { variant: 1 });
  if (p.room.lit > 0) p.light('lamp', p.cx, p.ceilY - 0.3, p.cz, TUNGSTEN, 35 * p.room.lit, 4);
};

const none: Recipe = () => {};

export const RECIPES: Record<RoomType, Recipe> = {
  ballroom,
  'grand-salon': drawingRoom,
  'drawing-room': drawingRoom,
  'music-room': musicRoom,
  library,
  'dining-room': diningRoom,
  gallery,
  'billiard-room': billiardRoom,
  'card-room': cardRoom,
  'morning-room': morningRoom,
  conservatory,
  'entrance-hall': entranceHall,
  'stair-hall': stairHall,
  corridor,
  landing,
  'hall-gallery': hallGallery,
  'roof-terrace': roofTerrace,
  'service-stair': none,
  study,
  cloakroom: service,
  pantry: service,
  bedroom,
  'sitting-room': sittingRoom,
  'dressing-room': dressingRoom,
  bathroom,
};

export { bar };
