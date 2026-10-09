/**
 * Procedural, tileable PBR texture synthesis (CPU, deterministic).
 *
 * Each generator fills albedo (sRGB 0..1), height (0..1) and roughness (0..1)
 * for a tile of known real-world size, so texel density is consistent across
 * the house. Most albedos are near-neutral and get their colour from vertex
 * tints (room finishes, stone tone), which lets every room share one material.
 */
import * as THREE from 'three';
import { clamp01, fbm, hash2i, lerp, smoothstep, vnoise, worley } from './noise';

export interface TexFields {
  col: Float32Array;
  h: Float32Array;
  r: Float32Array;
}

export interface TexSpec {
  /** Real-world size of one tile (m) along u and v. */
  size: [number, number];
  res: number;
  normalStrength: number;
  gen: (u: number, v: number, out: { c: [number, number, number]; h: number; r: number }) => void;
}

export interface TexSet {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  size: [number, number];
}

function generate(spec: TexSpec): TexFields {
  const N = spec.res;
  const col = new Float32Array(N * N * 3);
  const h = new Float32Array(N * N);
  const r = new Float32Array(N * N);
  const out = { c: [0, 0, 0] as [number, number, number], h: 0, r: 0.8 };
  for (let j = 0; j < N; j++) {
    const v = (j + 0.5) / N;
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      out.h = 0.5;
      out.r = 0.8;
      spec.gen(u, v, out);
      const k = j * N + i;
      col[k * 3] = out.c[0];
      col[k * 3 + 1] = out.c[1];
      col[k * 3 + 2] = out.c[2];
      h[k] = out.h;
      r[k] = out.r;
    }
  }
  return { col, h, r };
}

function toTextures(f: TexFields, spec: TexSpec, anisotropy: number): TexSet {
  const N = spec.res;
  const a = new Uint8Array(N * N * 4);
  const n = new Uint8Array(N * N * 4);
  const o = new Uint8Array(N * N * 4);
  // Height gradient in metres per metre: scale by texel size so strength is resolution independent.
  const sx = (spec.normalStrength * N) / spec.size[0];
  const sy = (spec.normalStrength * N) / spec.size[1];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      a[k * 4] = Math.round(clamp01(f.col[k * 3]!) * 255);
      a[k * 4 + 1] = Math.round(clamp01(f.col[k * 3 + 1]!) * 255);
      a[k * 4 + 2] = Math.round(clamp01(f.col[k * 3 + 2]!) * 255);
      a[k * 4 + 3] = 255;
      const l = f.h[j * N + ((i - 1 + N) % N)]!;
      const rr = f.h[j * N + ((i + 1) % N)]!;
      const d = f.h[((j - 1 + N) % N) * N + i]!;
      const uu = f.h[((j + 1) % N) * N + i]!;
      let nx = -(rr - l) * 0.5 * sx * 0.01;
      let ny = -(uu - d) * 0.5 * sy * 0.01;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      n[k * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      n[k * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      n[k * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      n[k * 4 + 3] = 255;
      o[k * 4] = 255;
      o[k * 4 + 1] = Math.round(clamp01(f.r[k]!) * 255);
      o[k * 4 + 2] = 0;
      o[k * 4 + 3] = 255;
    }
  }
  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.repeat.set(1 / spec.size[0], 1 / spec.size[1]);
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(a, true), normalMap: mk(n, false), roughnessMap: mk(o, false), size: spec.size };
}

/* ------------------------------------------------------------------ */
/* Generators                                                          */
/* ------------------------------------------------------------------ */

const grey = (out: { c: [number, number, number] }, v: number) => {
  out.c[0] = v;
  out.c[1] = v;
  out.c[2] = v;
};

/** Running-bond blocks: returns [joint distance (tile units, min of u/v), block id]. */
function blocks(u: number, v: number, rows: number, perRow: number, seed: number, jitter = 0.35): [number, number, number, number] {
  const row = Math.floor(v * rows);
  const fv = v * rows - row;
  const off = hash2i(row, 7, seed);
  const uu = (((u + off) % 1) + 1) % 1;
  // Jittered splits per row, periodic in u.
  const x = uu * perRow;
  const k = Math.floor(x);
  const split = (i: number) => i + (hash2i(row, ((i % perRow) + perRow) % perRow, seed + 3) - 0.5) * jitter;
  let a = split(k);
  let b = split(k + 1);
  let idx = k;
  if (x < a) {
    b = a;
    a = split(k - 1);
    idx = k - 1;
  } else if (x > b) {
    a = b;
    b = split(k + 2);
    idx = k + 1;
  }
  const du = Math.min(x - a, b - x) / perRow;
  const dv = Math.min(fv, 1 - fv) / rows;
  return [du, dv, hash2i(row, ((idx % perRow) + perRow) % perRow, seed + 9), fv];
}

function ashlar(seed: number): TexSpec {
  return {
    size: [3.6, 3.6],
    res: 512,
    normalStrength: 1.2,
    gen: (u, v, o) => {
      const [du, dv, id] = blocks(u, v, 8, 3, seed);
      const jm = Math.min(du * 3.6, dv * 3.6); // metres to nearest joint
      const joint = 1 - smoothstep(0.004, 0.012, jm);
      const bevel = smoothstep(0.004, 0.03, jm);
      const grain = fbm(u * 48, v * 48, 48, 4, seed + 1);
      const cloud = fbm(u * 6, v * 6, 6, 3, seed + 2);
      const tone = 0.9 + (id - 0.5) * 0.09 + (grain - 0.5) * 0.06 + (cloud - 0.5) * 0.08;
      const streak = (fbm(u * 24, v * 3, 24, 3, seed + 5) - 0.5) * 0.05;
      const l = lerp(tone + streak, 0.62, joint);
      o.c[0] = l * 1.0;
      o.c[1] = l * 0.985;
      o.c[2] = l * 0.95;
      o.h = bevel * 0.9 + grain * 0.1;
      o.r = 0.82 + (grain - 0.5) * 0.1;
    },
  };
}

function rusticated(seed: number): TexSpec {
  return {
    size: [4, 4],
    res: 512,
    normalStrength: 2.2,
    gen: (u, v, o) => {
      const rows = 8;
      const [du, , id, fv] = blocks(u, v, rows, 3, seed, 0.2);
      const groove = Math.min(fv, 1 - fv) * (4 / rows); // metres from horizontal joint
      const vj = du * 4;
      const g = smoothstep(0.0, 0.035, groove);
      const vg = smoothstep(0.002, 0.012, vj);
      const grain = fbm(u * 56, v * 56, 56, 4, seed + 1);
      const tone = 0.88 + (id - 0.5) * 0.08 + (grain - 0.5) * 0.07;
      const l = lerp(0.58, tone, Math.min(g, vg));
      o.c[0] = l;
      o.c[1] = l * 0.98;
      o.c[2] = l * 0.94;
      o.h = Math.min(g, vg) * 0.85 + grain * 0.15;
      o.r = 0.85;
    },
  };
}

function brick(seed: number): TexSpec {
  const W = 1.35;
  const H = 1.2;
  return {
    size: [W, H],
    res: 512,
    normalStrength: 1.6,
    gen: (u, v, o) => {
      const x = u * W;
      const y = v * H;
      const course = Math.floor(y / 0.075);
      const fy = y - course * 0.075;
      const xs = (x + (course % 2 ? 0.16875 : 0)) % W;
      const unit = Math.floor(xs / 0.3375);
      const pos = xs - unit * 0.3375;
      const header = pos >= 0.225;
      const bx = header ? pos - 0.225 : pos;
      const bw = header ? 0.1125 : 0.225;
      const mortar = Math.min(bx, bw - bx, fy, 0.075 - fy) < 0.005;
      const id = hash2i(course, unit * 2 + (header ? 1 : 0), seed);
      const grain = fbm(u * 64, v * 64, 64, 3, seed + 4);
      if (mortar) {
        const m = 0.74 + (grain - 0.5) * 0.08;
        o.c[0] = m;
        o.c[1] = m * 0.96;
        o.c[2] = m * 0.88;
        o.h = 0.25;
        o.r = 0.95;
        return;
      }
      const burnt = header && hash2i(course, unit, seed + 7) < 0.45;
      let r = 0.56 + (id - 0.5) * 0.12;
      let g = 0.25 + (id - 0.5) * 0.06;
      let b = 0.17 + (id - 0.5) * 0.04;
      if (burnt) {
        r = 0.36 + (id - 0.5) * 0.06;
        g = 0.23;
        b = 0.24;
      }
      const t = 0.92 + (grain - 0.5) * 0.18;
      o.c[0] = r * t;
      o.c[1] = g * t;
      o.c[2] = b * t;
      o.h = 0.9 + grain * 0.1;
      o.r = 0.86;
    },
  };
}

function stucco(seed: number): TexSpec {
  return {
    size: [3, 3],
    res: 256,
    normalStrength: 0.5,
    gen: (u, v, o) => {
      const n = fbm(u * 24, v * 24, 24, 4, seed);
      const c = fbm(u * 4, v * 4, 4, 3, seed + 3);
      grey(o, 0.93 + (c - 0.5) * 0.06 + (n - 0.5) * 0.03);
      o.h = n;
      o.r = 0.86;
    },
  };
}

function slate(seed: number): TexSpec {
  return {
    size: [2.4, 2.4],
    res: 512,
    normalStrength: 2.4,
    gen: (u, v, o) => {
      const rows = 12;
      const [du, , id, fv] = blocks(u, v, rows, 8, seed, 0.25);
      const edge = smoothstep(0.0, 0.012, du * 2.4);
      const grain = fbm(u * 64, v * 64, 64, 3, seed + 2);
      // Each slate is thicker at its exposed lower edge.
      const ramp = 0.35 + 0.65 * (1 - fv);
      const t = 0.9 + (id - 0.5) * 0.3 + (grain - 0.5) * 0.12;
      const purple = hash2i(Math.floor(v * rows), Math.floor(u * 8), seed + 5) < 0.2 ? 0.05 : 0;
      o.c[0] = (0.25 + purple) * t * lerp(0.5, 1, edge);
      o.c[1] = 0.28 * t * lerp(0.5, 1, edge);
      o.c[2] = (0.32 + purple * 0.5) * t * lerp(0.5, 1, edge);
      o.h = ramp * edge;
      o.r = 0.58 + (grain - 0.5) * 0.2;
    },
  };
}

function zinc(seed: number): TexSpec {
  return {
    size: [2, 2],
    res: 256,
    normalStrength: 2.0,
    gen: (u, v, o) => {
      const s = (u * 4) % 1; // standing seam every 0.5 m
      const seam = 1 - smoothstep(0.0, 0.025, Math.min(s, 1 - s));
      const m = fbm(u * 12, v * 12, 12, 4, seed);
      const l = 0.5 + (m - 0.5) * 0.12;
      o.c[0] = l * 0.92;
      o.c[1] = l * 0.98;
      o.c[2] = l * 1.04;
      o.h = 0.5 + seam * 0.5;
      o.r = 0.42 + (m - 0.5) * 0.15;
    },
  };
}

function lead(seed: number): TexSpec {
  return {
    size: [2.4, 2.4],
    res: 256,
    normalStrength: 2.0,
    gen: (u, v, o) => {
      const s = (u * 4) % 1;
      const roll = Math.exp(-((Math.min(s, 1 - s) * 10) ** 2));
      const m = fbm(u * 10, v * 10, 10, 4, seed);
      grey(o, 0.4 + (m - 0.5) * 0.1);
      o.h = 0.4 + roll * 0.6;
      o.r = 0.7;
    },
  };
}

/** Rolled roof glass: near-white (the tint comes from the material), faintly streaked down the slope, gently rippled. */
function roofGlass(seed: number): TexSpec {
  return {
    size: [1.6, 1.6],
    res: 256,
    normalStrength: 1.2,
    gen: (u, v, o) => {
      const streak = fbm(u * 28, v * 3, 28, 3, seed);
      const cloud = fbm(u * 5, v * 5, 5, 4, seed + 7);
      const ripple = fbm(u * 9, v * 14, 9, 3, seed + 3);
      grey(o, 0.82 + (streak - 0.5) * 0.22 + (cloud - 0.5) * 0.22);
      o.h = 0.5 + (ripple - 0.5) * 0.5;
      o.r = 0.14 + cloud * 0.16;
    },
  };
}

/** Point de Hongrie (chevron) parquet, luminance only. */
function chevron(seed: number): TexSpec {
  const T = 1.2;
  const W = 0.3;
  const pw = 0.1;
  return {
    size: [T, T],
    res: 512,
    normalStrength: 0.8,
    gen: (u, v, o) => {
      const x = u * T;
      const y = v * T;
      const c = Math.floor(x / W);
      const l = x - c * W;
      const even = c % 2 === 0;
      const s = y + (even ? l : W - l);
      const k = Math.floor(s / pw);
      const fs = s / pw - k;
      const seamS = Math.min(fs, 1 - fs) * pw;
      const seamC = Math.min(l, W - l);
      const seam = Math.min(seamS * 0.7071, seamC);
      const id = hash2i(c, ((k % 12) + 12) % 12, seed);
      const t = y - (even ? l : W - l);
      const grain = vnoise(t * 90 + id * 13, fs * 4, 9999, seed) * 0.6 + fbm(u * 40, v * 40, 40, 3, seed + 1) * 0.4;
      const lum = 0.8 + (id - 0.5) * 0.22 + (grain - 0.5) * 0.16;
      grey(o, seam < 0.0015 ? lum * 0.55 : lum);
      o.h = smoothstep(0.0, 0.003, seam);
      o.r = 0.38 + (grain - 0.5) * 0.12;
    },
  };
}

function planks(seed: number, width: number, length: number): TexSpec {
  const T = 2.4;
  const rows = Math.round(T / width);
  return {
    size: [T, T],
    res: 512,
    normalStrength: 0.8,
    gen: (u, v, o) => {
      const perRow = Math.max(1, Math.round(T / length));
      const [du, dv, id] = blocks(u, v, rows, perRow, seed, 0.6);
      const seam = Math.min(du * T, dv * T);
      const grain = vnoise(u * 160, v * rows * 1.5 + id * 31, 160, seed) * 0.5 + fbm(u * 30, v * 30, 30, 3, seed + 2) * 0.5;
      const lum = 0.8 + (id - 0.5) * 0.2 + (grain - 0.5) * 0.18;
      grey(o, seam < 0.0016 ? lum * 0.55 : lum);
      o.h = smoothstep(0, 0.003, seam);
      o.r = 0.42 + (grain - 0.5) * 0.12;
    },
  };
}

function marbleLum(u: number, v: number, seed: number, scale: number): number {
  const turb = fbm(u * 3 * scale, v * 3 * scale, 3 * scale, 5, seed);
  const vein = Math.abs(Math.sin((u * 2 + v * 1) * Math.PI * 2 * scale + turb * 9));
  const v2 = Math.abs(Math.sin((u * 1 - v * 3) * Math.PI * 2 * scale + turb * 6 + 1.3));
  const cloud = fbm(u * 5 * scale, v * 5 * scale, 5 * scale, 4, seed + 3);
  const main = Math.pow(vein, 0.18);
  const fine = Math.pow(v2, 0.08);
  return 0.93 - (1 - main) * 0.32 - (1 - fine) * 0.12 + (cloud - 0.5) * 0.07;
}

function marble(seed: number, joints: number): TexSpec {
  return {
    size: [2.4, 2.4],
    res: 512,
    normalStrength: 0.4,
    gen: (u, v, o) => {
      let l = marbleLum(u, v, seed, 1);
      let h = 1;
      if (joints > 0) {
        const fu = (u * joints) % 1;
        const fv = (v * joints) % 1;
        const j = Math.min(fu, 1 - fu, fv, 1 - fv) * (2.4 / joints);
        if (j < 0.0018) {
          l *= 0.7;
          h = 0.3;
        }
        // Each tile its own slab.
        l += (hash2i(Math.floor(u * joints), Math.floor(v * joints), seed + 11) - 0.5) * 0.04;
      }
      o.c[0] = l;
      o.c[1] = l * 0.985;
      o.c[2] = l * 0.96;
      o.h = h;
      o.r = 0.16;
    },
  };
}

function checker(seed: number): TexSpec {
  return {
    size: [1.2, 1.2],
    res: 512,
    normalStrength: 0.4,
    gen: (u, v, o) => {
      const cu = Math.floor(u * 2);
      const cv = Math.floor(v * 2);
      const black = (cu + cv) % 2 === 1;
      const m = marbleLum(u * 2, v * 2, seed + (black ? 5 : 0), 1);
      let l = black ? 0.06 + (1 - m) * 0.25 : m;
      const fu = (u * 2) % 1;
      const fv = (v * 2) % 1;
      const j = Math.min(fu, 1 - fu, fv, 1 - fv) * 0.6;
      if (j < 0.0015) l = 0.4;
      grey(o, l);
      o.h = j < 0.0015 ? 0.3 : 1;
      o.r = 0.14;
    },
  };
}

function flagstone(seed: number): TexSpec {
  return {
    size: [3.2, 3.2],
    res: 512,
    normalStrength: 1.4,
    gen: (u, v, o) => {
      const [du, dv, id] = blocks(u, v, 6, 4, seed, 0.6);
      const j = Math.min(du * 3.2, dv * 3.2);
      const joint = 1 - smoothstep(0.004, 0.01, j);
      const grain = fbm(u * 40, v * 40, 40, 4, seed + 1);
      const wear = fbm(u * 8, v * 8, 8, 3, seed + 2);
      const l = lerp(0.78 + (id - 0.5) * 0.14 + (grain - 0.5) * 0.1 + (wear - 0.5) * 0.08, 0.42, joint);
      o.c[0] = l;
      o.c[1] = l * 0.97;
      o.c[2] = l * 0.9;
      o.h = (1 - joint) * 0.9 + grain * 0.1;
      o.r = 0.8 - wear * 0.15;
    },
  };
}

function damask(seed: number): TexSpec {
  return {
    size: [0.53, 0.53],
    res: 256,
    normalStrength: 0.15,
    gen: (u, v, o) => {
      // Half-drop repeat of a mirrored medallion.
      const cells = 2;
      let x = u * cells;
      let y = v * cells;
      const col = Math.floor(x);
      if (col % 2) y += 0.5;
      x = (x % 1) - 0.5;
      y = (((y % 1) + 1) % 1) - 0.5;
      const ax = Math.abs(x);
      const r = Math.hypot(ax, y);
      const th = Math.atan2(y, ax);
      const petal = 0.28 + 0.1 * Math.cos(th * 4) + 0.05 * Math.cos(th * 9);
      const inner = 0.1 + 0.04 * Math.cos(th * 6);
      const ring = smoothstep(petal + 0.015, petal, r) * smoothstep(inner - 0.01, inner + 0.01, r);
      const stem = smoothstep(0.03, 0.0, Math.abs(ax - 0.25 - 0.06 * Math.sin(y * 12))) * smoothstep(0.45, 0.2, Math.abs(y));
      const motif = Math.max(ring, stem * 0.8, smoothstep(0.06, 0.04, r));
      const n = fbm(u * 30, v * 30, 30, 2, seed);
      grey(o, 0.86 + motif * 0.1 + (n - 0.5) * 0.02);
      o.h = 0.5 + motif * 0.1;
      o.r = lerp(0.62, 0.32, motif);
    },
  };
}

function silk(seed: number): TexSpec {
  return {
    size: [1.2, 1.2],
    res: 256,
    normalStrength: 0.1,
    gen: (u, v, o) => {
      const slub = vnoise(u * 8, v * 220, 8, seed);
      const band = fbm(u * 6, v * 2, 6, 3, seed + 1);
      grey(o, 0.9 + (slub - 0.5) * 0.06 + (band - 0.5) * 0.05);
      o.h = slub;
      o.r = 0.36;
    },
  };
}

function stripe(seed: number): TexSpec {
  return {
    size: [0.48, 0.48],
    res: 256,
    normalStrength: 0.05,
    gen: (u, v, o) => {
      const p = (u * 2) % 1;
      let l = p < 0.42 ? 0.97 : p < 0.46 ? 0.8 : p < 0.5 ? 0.97 : p < 0.92 ? 0.84 : p < 0.96 ? 0.97 : 0.84;
      l += (vnoise(u * 40, v * 40, 40, seed) - 0.5) * 0.02;
      grey(o, l);
      o.r = p < 0.5 ? 0.5 : 0.62;
    },
  };
}

/** Raised panelling; v is metres above the room floor. */
function paneling(seed: number): TexSpec {
  const W = 1.2;
  const H = 4.8;
  return {
    size: [W, H],
    res: 512,
    normalStrength: 2.0,
    gen: (u, v, o) => {
      const x = u * W;
      const y = v * H;
      const stile = 0.11;
      // Panel bands: dado 0.15-0.85, upper 1.05-3.6, frieze 3.75-4.6.
      const bands: [number, number][] = [
        [0.17, 0.85],
        [1.02, 3.55],
        [3.72, 4.55],
      ];
      let inPanel = 0;
      let bevel = 1;
      for (const [a, b] of bands) {
        if (y > a && y < b && x > stile && x < W - stile) {
          const d = Math.min(x - stile, W - stile - x, y - a, b - y);
          inPanel = 1;
          bevel = smoothstep(0.0, 0.045, d);
        }
      }
      const vertical = !inPanel && x < stile + 0.001 ? 1 : !inPanel && x > W - stile ? 1 : 0;
      const grain = vertical || inPanel ? vnoise(u * 30, v * 260, 30, seed) : vnoise(u * 240, v * 40, 240, seed);
      const fine = fbm(u * 20, v * 80, 20, 3, seed + 3);
      const lum = 0.78 + (grain - 0.5) * 0.14 + (fine - 0.5) * 0.1 - (inPanel ? (1 - bevel) * 0.12 : 0);
      grey(o, lum);
      o.h = inPanel ? 0.35 + bevel * 0.45 : 1;
      o.r = 0.45;
    },
  };
}

function plaster(seed: number): TexSpec {
  return {
    size: [2.5, 2.5],
    res: 256,
    normalStrength: 0.25,
    gen: (u, v, o) => {
      const n = fbm(u * 20, v * 20, 20, 4, seed);
      grey(o, 0.95 + (n - 0.5) * 0.04);
      o.h = n;
      o.r = 0.9;
    },
  };
}

function woodGrain(seed: number): TexSpec {
  return {
    size: [1, 1],
    res: 256,
    normalStrength: 0.3,
    gen: (u, v, o) => {
      const ring = Math.sin((u * 26 + fbm(u * 4, v * 30, 4, 4, seed) * 6) * Math.PI * 2);
      const fine = vnoise(u * 200, v * 12, 200, seed + 1);
      grey(o, 0.78 + ring * 0.06 + (fine - 0.5) * 0.1);
      o.h = 0.5 + ring * 0.1;
      o.r = 0.4;
    },
  };
}

function fabric(seed: number): TexSpec {
  return {
    size: [0.6, 0.6],
    res: 256,
    normalStrength: 0.3,
    gen: (u, v, o) => {
      const weave = (Math.sin(u * 256 * Math.PI) * Math.sin(v * 256 * Math.PI) + 1) / 2;
      const n = fbm(u * 16, v * 16, 16, 3, seed);
      grey(o, 0.82 + (n - 0.5) * 0.12 + weave * 0.04);
      o.h = weave;
      o.r = 0.82;
    },
  };
}

const BOOK_COLOURS: [number, number, number][] = [
  [0.42, 0.08, 0.07],
  [0.12, 0.22, 0.13],
  [0.1, 0.12, 0.26],
  [0.48, 0.3, 0.14],
  [0.08, 0.07, 0.06],
  [0.55, 0.42, 0.22],
  [0.33, 0.06, 0.1],
  [0.2, 0.28, 0.24],
];

function books(seed: number): TexSpec {
  const W = 1.2;
  const shelfH = 0.36;
  return {
    size: [W, shelfH * 4],
    res: 512,
    normalStrength: 1.0,
    gen: (u, v, o) => {
      const shelf = Math.floor(v * 4);
      const y = v * 4 - shelf; // 0..1 within the shelf
      const yMeters = y * shelfH;
      if (yMeters < 0.025) {
        // Shelf board edge.
        grey(o, 0.32);
        o.c[0] = 0.3;
        o.c[1] = 0.19;
        o.c[2] = 0.11;
        o.h = 1;
        o.r = 0.5;
        return;
      }
      // Books: walk widths along u deterministically per shelf.
      const x = u * W;
      let acc = 0;
      let i = 0;
      let w = 0;
      for (; i < 80; i++) {
        w = 0.022 + hash2i(shelf, i, seed) * 0.045;
        if (acc + w > x) break;
        acc += w;
      }
      // Last book on the shelf wraps to the tile edge.
      const id = hash2i(shelf, i, seed + 1);
      const height = 0.2 + hash2i(shelf, i, seed + 2) * 0.11;
      const top = 0.025 + height;
      if (yMeters > top || acc + w > W + 1e-6) {
        grey(o, 0.04);
        o.h = 0.1;
        o.r = 0.9;
        return;
      }
      const c = BOOK_COLOURS[Math.floor(id * BOOK_COLOURS.length)]!;
      const bx = (x - acc) / w;
      const round = 0.75 + 0.25 * Math.sin(bx * Math.PI);
      const band = Math.abs(yMeters - (top - 0.03)) < 0.006 || Math.abs(yMeters - (top - 0.055)) < 0.004;
      const gilt = band && id > 0.3;
      o.c[0] = gilt ? 0.62 : c[0] * round;
      o.c[1] = gilt ? 0.45 : c[1] * round;
      o.c[2] = gilt ? 0.18 : c[2] * round;
      o.h = 0.6 + round * 0.3;
      o.r = gilt ? 0.3 : 0.6;
    },
  };
}

function grass(seed: number): TexSpec {
  return {
    size: [5, 5],
    res: 512,
    normalStrength: 0.6,
    gen: (u, v, o) => {
      // Two mowing stripes per tile.
      const stripe = Math.floor(u * 2) % 2 ? 1.06 : 0.94;
      const blades = vnoise(u * 900, v * 300, 900, seed);
      const clump = fbm(u * 24, v * 24, 24, 4, seed + 1);
      const l = stripe * (0.85 + (blades - 0.5) * 0.25 + (clump - 0.5) * 0.2);
      o.c[0] = 0.2 * l;
      o.c[1] = 0.33 * l;
      o.c[2] = 0.12 * l;
      o.h = blades;
      o.r = 0.92;
    },
  };
}

function gravel(seed: number): TexSpec {
  return {
    size: [1.6, 1.6],
    res: 256,
    normalStrength: 1.5,
    gen: (u, v, o) => {
      const [f1, , id] = worley(u * 48, v * 48, 48, seed);
      const pebble = smoothstep(0.55, 0.15, f1);
      const l = 0.55 + (id - 0.5) * 0.25;
      o.c[0] = lerp(0.35, l, pebble);
      o.c[1] = lerp(0.33, l * 0.95, pebble);
      o.c[2] = lerp(0.3, l * 0.86, pebble);
      o.h = pebble;
      o.r = 0.9;
    },
  };
}

function foliage(seed: number): TexSpec {
  return {
    size: [2, 2],
    res: 256,
    normalStrength: 2.5,
    gen: (u, v, o) => {
      const [f1, f2, id] = worley(u * 28, v * 28, 28, seed);
      const leaf = smoothstep(0.0, 0.35, f2 - f1);
      const n = fbm(u * 8, v * 8, 8, 3, seed + 1);
      const l = (0.6 + id * 0.4) * (0.55 + leaf * 0.45) * (0.8 + n * 0.4);
      o.c[0] = 0.16 * l;
      o.c[1] = 0.27 * l;
      o.c[2] = 0.13 * l;
      o.h = leaf;
      o.r = 0.8;
    },
  };
}

function bark(seed: number): TexSpec {
  return {
    size: [1, 2],
    res: 128,
    normalStrength: 2.0,
    gen: (u, v, o) => {
      const n = fbm(u * 10, v * 2, 10, 4, seed);
      const ridge = Math.abs(Math.sin(u * 40 + n * 8));
      grey(o, 0.3 + ridge * 0.12);
      o.c[0] *= 1.05;
      o.c[2] *= 0.9;
      o.h = ridge;
      o.r = 0.95;
    },
  };
}

function soil(seed: number): TexSpec {
  return {
    size: [2, 2],
    res: 256,
    normalStrength: 1.0,
    gen: (u, v, o) => {
      const n = fbm(u * 30, v * 30, 30, 4, seed);
      const [f1, , id] = worley(u * 20, v * 20, 20, seed + 4);
      const flower = f1 < 0.12 ? 1 : 0;
      const hue = id;
      o.c[0] = flower ? (hue < 0.5 ? 0.6 : 0.85) : 0.11 + n * 0.06;
      o.c[1] = flower ? (hue < 0.5 ? 0.18 : 0.82) : 0.12 + n * 0.08;
      o.c[2] = flower ? (hue < 0.5 ? 0.3 : 0.8) : 0.07 + n * 0.03;
      o.h = flower ? 1 : n * 0.6;
      o.r = 0.9;
    },
  };
}

/** Oriental rug, mapped once per rug (not tiling). Palette varies by variant. */
function rug(seed: number, variant: number): TexSpec {
  const palettes: [number, number, number][][] = [
    [
      [0.42, 0.06, 0.05],
      [0.08, 0.1, 0.24],
      [0.72, 0.52, 0.2],
      [0.82, 0.76, 0.6],
    ],
    [
      [0.1, 0.14, 0.3],
      [0.45, 0.08, 0.06],
      [0.8, 0.7, 0.5],
      [0.62, 0.44, 0.18],
    ],
    [
      [0.2, 0.3, 0.22],
      [0.55, 0.1, 0.1],
      [0.85, 0.78, 0.6],
      [0.15, 0.12, 0.1],
    ],
    [
      [0.6, 0.45, 0.25],
      [0.25, 0.08, 0.06],
      [0.12, 0.18, 0.32],
      [0.88, 0.82, 0.68],
    ],
    [
      [0.38, 0.05, 0.06],
      [0.7, 0.5, 0.18],
      [0.1, 0.1, 0.18],
      [0.38, 0.05, 0.06],
    ],
  ];
  const pal = palettes[variant % palettes.length]!;
  return {
    size: [1, 1],
    res: 256,
    normalStrength: 0.4,
    gen: (u, v, o) => {
      const bx = Math.min(u, 1 - u);
      const by = Math.min(v, 1 - v);
      const b = Math.min(bx, by);
      let c: [number, number, number];
      if (b < 0.035) c = pal[1]!;
      else if (b < 0.045) c = pal[3]!;
      else if (b < 0.1) {
        const m = Math.sin((bx < by ? v : u) * 80) * Math.sin(b * 120);
        c = m > 0.2 ? pal[2]! : pal[1]!;
      } else if (b < 0.11) c = pal[3]!;
      else {
        const x = (u - 0.5) * 2;
        const y = (v - 0.5) * 2;
        const r = Math.hypot(x * 1.4, y);
        const th = Math.atan2(y, x);
        const med = r < 0.42 + 0.08 * Math.cos(th * 8);
        const field = Math.sin(u * 50) * Math.sin(v * 50) > 0.35;
        c = med ? (r < 0.18 ? pal[2]! : pal[1]!) : field ? pal[2]! : pal[0]!;
      }
      const n = fbm(u * 64, v * 64, 64, 2, seed);
      const wear = 0.9 + (n - 0.5) * 0.2;
      o.c[0] = c[0] * wear;
      o.c[1] = c[1] * wear;
      o.c[2] = c[2] * wear;
      o.h = n;
      o.r = 0.92;
    },
  };
}

/** Sixteen old-master style paintings in a 4×4 atlas (square cells). */
export const PAINTING_CELLS = 4;
function paintings(seed: number): TexSpec {
  return {
    size: [1, 1],
    res: 1024,
    normalStrength: 0.2,
    gen: (u, v, o) => {
      const cx = Math.floor(u * PAINTING_CELLS);
      const cy = Math.floor(v * PAINTING_CELLS);
      const x = u * PAINTING_CELLS - cx;
      const y = v * PAINTING_CELLS - cy;
      const idx = cx + cy * PAINTING_CELLS;
      const kind = idx % 8;
      const n = fbm(x * 8 + idx * 3, y * 8, 1e6, 4, seed + idx);
      let r: number;
      let g: number;
      let b: number;
      if (kind < 4) {
        // Landscape: warm sky, hills, dark trees, a glint of water.
        const horizon = 0.42 + (fbm(x * 3 + idx, 0.5, 1e6, 3, seed + 20) - 0.5) * 0.18;
        if (y > horizon) {
          const t = (y - horizon) / (1 - horizon);
          r = lerp(0.85, 0.35, t) + n * 0.05;
          g = lerp(0.7, 0.42, t);
          b = lerp(0.45, 0.5, t);
          const cloud = fbm(x * 5, y * 9, 1e6, 4, seed + idx + 40);
          if (cloud > 0.58) {
            r += 0.12;
            g += 0.1;
            b += 0.08;
          }
        } else {
          const hill = horizon - 0.12 + (fbm(x * 4 + 7, 0.3, 1e6, 3, seed + idx + 9) - 0.5) * 0.2;
          const tree = (fbm(x * 10, y * 14, 1e6, 4, seed + idx + 60) > 0.56 && y > hill - 0.1) || (Math.abs(x - 0.22 - (idx % 3) * 0.2) < 0.07 && y < horizon + 0.25 && y > 0.2);
          r = tree ? 0.1 : y > hill ? 0.36 + n * 0.08 : 0.24 + n * 0.08;
          g = tree ? 0.13 : y > hill ? 0.36 + n * 0.06 : 0.22 + n * 0.06;
          b = tree ? 0.07 : y > hill ? 0.3 : 0.1;
          if (y < 0.16 && Math.abs(x - 0.6) < 0.28) {
            r = 0.55;
            g = 0.52;
            b = 0.45;
          }
        }
      } else if (kind < 7) {
        // Portrait: dark ground, sitter in a dark coat, lit face.
        const bg = 0.08 + n * 0.05 + (1 - Math.hypot(x - 0.5, y - 0.6)) * 0.08;
        r = bg * 1.2;
        g = bg;
        b = bg * 0.7;
        const face = ((x - 0.5) / 0.115) ** 2 + ((y - 0.63) / 0.15) ** 2 < 1;
        const hair = ((x - 0.5) / 0.13) ** 2 + ((y - 0.68) / 0.15) ** 2 < 1 && y > 0.66;
        const shoulders = y < 0.47 - ((x - 0.5) / 0.42) ** 2 * 0.25 && Math.abs(x - 0.5) < 0.42;
        const collar = Math.abs(x - 0.5) < 0.1 && y > 0.4 && y < 0.48;
        if (shoulders) {
          const sash = kind === 5 && Math.abs(x - 0.5 - (0.42 - y) * 0.9) < 0.05;
          r = sash ? 0.55 : 0.07 + n * 0.03;
          g = sash ? 0.08 : 0.06;
          b = sash ? 0.08 : kind === 6 ? 0.16 : 0.05;
        }
        if (collar) {
          r = 0.85;
          g = 0.82;
          b = 0.74;
        }
        if (hair) {
          r = kind === 6 ? 0.45 : 0.12;
          g = kind === 6 ? 0.3 : 0.08;
          b = 0.05;
        }
        if (face && !hair) {
          const shade = 0.78 + (0.45 - x) * 0.9;
          r = 0.84 * shade;
          g = 0.62 * shade;
          b = 0.47 * shade;
        }
      } else {
        // Still life.
        r = 0.07 + n * 0.04;
        g = 0.06;
        b = 0.04;
        if (y < 0.3) {
          r = 0.3;
          g = 0.18;
          b = 0.08;
        }
        for (const [fx, fy, fr, cr, cg, cb] of [
          [0.4, 0.38, 0.09, 0.75, 0.15, 0.08],
          [0.55, 0.36, 0.07, 0.8, 0.6, 0.1],
          [0.48, 0.47, 0.08, 0.35, 0.45, 0.1],
        ] as const) {
          if ((x - fx) ** 2 + (y - fy) ** 2 < fr * fr) {
            r = cr;
            g = cg;
            b = cb;
          }
        }
      }
      // Varnish: warm, slightly darkened.
      o.c[0] = r * 0.95;
      o.c[1] = g * 0.88;
      o.c[2] = b * 0.7;
      o.h = n;
      o.r = 0.35;
    },
  };
}

function carpetTile(seed: number): TexSpec {
  return {
    size: [0.6, 0.6],
    res: 256,
    normalStrength: 0.3,
    gen: (u, v, o) => {
      const x = (u * 2) % 1;
      const y = (v * 2) % 1;
      const motif = Math.hypot(x - 0.5, y - 0.5) < 0.12 + 0.05 * Math.cos(Math.atan2(y - 0.5, x - 0.5) * 4);
      const n = fbm(u * 50, v * 50, 50, 2, seed);
      grey(o, (motif ? 1.0 : 0.82) + (n - 0.5) * 0.06);
      o.h = n;
      o.r = 0.95;
    },
  };
}

/* ------------------------------------------------------------------ */

export type TextureKey =
  | 'ashlar'
  | 'rusticated'
  | 'brick'
  | 'stucco'
  | 'slate'
  | 'zinc'
  | 'lead'
  | 'roofglass'
  | 'herringbone'
  | 'parquet'
  | 'boards'
  | 'marble'
  | 'marble-floor'
  | 'checker'
  | 'flagstone'
  | 'damask'
  | 'silk'
  | 'stripe'
  | 'paneling'
  | 'plaster'
  | 'wood'
  | 'fabric'
  | 'books'
  | 'grass'
  | 'gravel'
  | 'foliage'
  | 'bark'
  | 'soil'
  | 'paintings'
  | 'carpet'
  | `rug${number}`;

function specFor(key: TextureKey): TexSpec {
  if (key.startsWith('rug')) return rug(31, Number(key.slice(3)));
  switch (key) {
    case 'ashlar':
      return ashlar(11);
    case 'rusticated':
      return rusticated(12);
    case 'brick':
      return brick(13);
    case 'stucco':
      return stucco(14);
    case 'slate':
      return slate(15);
    case 'zinc':
      return zinc(16);
    case 'lead':
      return lead(17);
    case 'roofglass':
      return roofGlass(18);
    case 'herringbone':
      return chevron(18);
    case 'parquet':
      return planks(19, 0.12, 1.2);
    case 'boards':
      return planks(20, 0.2, 2.4);
    case 'marble':
      return marble(21, 0);
    case 'marble-floor':
      return marble(22, 3);
    case 'checker':
      return checker(23);
    case 'flagstone':
      return flagstone(24);
    case 'damask':
      return damask(25);
    case 'silk':
      return silk(26);
    case 'stripe':
      return stripe(27);
    case 'paneling':
      return paneling(28);
    case 'plaster':
      return plaster(29);
    case 'wood':
      return woodGrain(30);
    case 'fabric':
      return fabric(32);
    case 'books':
      return books(33);
    case 'grass':
      return grass(34);
    case 'gravel':
      return gravel(35);
    case 'foliage':
      return foliage(36);
    case 'bark':
      return bark(37);
    case 'soil':
      return soil(38);
    case 'paintings':
      return paintings(39);
    case 'carpet':
      return carpetTile(40);
  }
  throw new Error(`unknown texture ${key}`);
}

/** Lazily generated, cached texture sets. */
export class TextureLibrary {
  private cache = new Map<string, TexSet>();
  constructor(
    private readonly anisotropy = 8,
    private readonly resScale = 1,
  ) {}

  get(key: TextureKey): TexSet {
    let t = this.cache.get(key);
    if (!t) {
      const spec = specFor(key);
      const s = { ...spec, res: Math.max(64, Math.round(spec.res * this.resScale)) };
      t = toTextures(generate(s), s, this.anisotropy);
      this.cache.set(key, t);
    }
    return t;
  }

  dispose(): void {
    for (const t of this.cache.values()) {
      t.map.dispose();
      t.normalMap.dispose();
      t.roughnessMap.dispose();
    }
    this.cache.clear();
  }
}

/** For tests / previews in Node: raw fields without three.js upload. */
export function synthesize(key: TextureKey, res?: number): TexFields & { res: number } {
  const spec = specFor(key);
  const s = { ...spec, res: res ?? spec.res };
  return { ...generate(s), res: s.res };
}
