/**
 * Wind near the ground: a mean wind, gusts carried along with the air, and what the ground does to it.
 *
 * Gusts are eddies frozen into the air and carried downwind at the mean speed (Taylor's hypothesis), changing
 * slowly as they go. A gust seen bending the bushes upwind reaches the bullet's path a few seconds later, so
 * every cue that shows the wind (flags, bushes, grass) and the bullet read one field.
 *
 * The eddies live in a periodic noise tile, the same numbers on the CPU (bullets, flags, the wind meter) and on
 * the GPU (bushes and grass, see demo/reticle/wind-gl.ts). Values are kept to what a half float holds exactly,
 * so both read the same field.
 *
 * Over ground (`terrain`), as linear hill-flow theory has it (Jackson & Hunt 1975, and the WAsP rules of thumb):
 *  - the air is slower low down: a log profile over open grass and sage (roughness 3 cm), speed quoted at 3 m;
 *  - it follows the ground: wind up a slope lifts, down a slope sinks (vertical = wind · slope), fading with
 *    height above the ground;
 *  - it speeds up over crests and slows in hollows, by about 1.6 × height ÷ half-width for a round hill;
 *  - it drops behind lee slopes too steep for it to follow (past ~17°).
 *
 * Trees and buildings (`shelter`), baked once for the match's mean wind direction: no wind inside a building,
 * less inside a tree's crown, and a sheltered wake downwind that is deepest a few heights behind and gone by
 * 15–20 heights, as measured behind windbreaks (Heisler & DeWalle 1988; Cornelis & Gabriels 2005). Eddies shed
 * by the obstacles themselves are left out: a bullet crosses one in a few milliseconds.
 *
 * Frame: the scene frame of shot.ts. x right, y up, z toward the shooter (the range runs down -z). Metres,
 * seconds, radians.
 */
import type { Vec3 } from './shot';

export interface Wind {
  /** Mean speed, 3 m above open ground (a flag's height). */
  speed: number;
  /** Clock direction it blows from: 12 from downrange, 3 from the right, 9 from the left. */
  fromClock: number;
  /** Gust strength: the speed swings by about ±`gust` of the mean, the direction by about ±12°. */
  gust: number;
  /** The ground under it. Without it the wind is the same at every height. */
  terrain?: TerrainWind;
  /** Trees and buildings, baked for one mean direction (see `shelterWind`). */
  shelter?: ShelterWind;
}

/** Texels per side of the gust tile. */
export const GUST_TILE_N = 256;
/** Eddy size of the first octave along and across the wind: gusts are longer than they are wide. */
export const GUST_CELL_M = { along: 80, across: 45 } as const;
/** Lattice cells of the first octave across the tile, so the tile spans 1280 × 720 m before it repeats. */
const CELLS = 16;
export const GUST_TILE_M = { along: CELLS * GUST_CELL_M.along, across: CELLS * GUST_CELL_M.across } as const;
/** How long an eddy lasts as it is carried along, before the air has turned over into a new one. */
export const GUST_LIFE_S = 20;
/** Direction swing (rad) at full gust noise with the default gust of 0.3: about ±12°. Scales with the gust. */
export const GUST_SWING = 0.21;
/** The swing for a gust strength: none in a steady wind. */
export const gustSwing = (gust: number): number => (GUST_SWING * gust) / 0.3;

/** Roughness length of open grass and sage, and the height the speed is quoted at. */
export const ROUGHNESS_M = 0.03;
export const WIND_REF_M = 3;
const LOG_REF = Math.log(WIND_REF_M / ROUGHNESS_M);

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e3779b9, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Rounds to what a half float holds exactly (inside ±2, to 2⁻¹¹), so CPU and GPU see the same tile. */
export function halfExact(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const step = 2 ** (Math.floor(Math.log2(Math.abs(v))) - 10);
  return Math.round(v / step) * step;
}

/** Periodic value noise in [-1, 1] on an L × L lattice over the unit tile, at tile coordinates (u, v). */
function periodicNoise(u: number, v: number, L: number, seed: number): number {
  const x = u * L, y = v * L;
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (a: number, b: number) => hash(((a % L) + L) % L + seed * 4099, ((b % L) + L) % L) * 2 - 1;
  const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

let tile: Float32Array | null = null;
/**
 * The gust tile: two channels per texel, row-major, u (along the wind) fastest. R: the speed's gust, two
 * octaves (eddies 80 × 45 m and 30 × 17 m). G: the direction's swing, its own two octaves.
 */
export function gustTile(): Float32Array {
  if (tile) return tile;
  const N = GUST_TILE_N;
  tile = new Float32Array(N * N * 2);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N;
      tile[(j * N + i) * 2] = halfExact(0.65 * periodicNoise(u, v, CELLS, 11) + 0.35 * periodicNoise(u, v, 43, 12));
      tile[(j * N + i) * 2 + 1] = halfExact(0.7 * periodicNoise(u, v, 13, 13) + 0.3 * periodicNoise(u, v, 37, 14));
    }
  }
  return tile;
}

/** Bilinear lookup in the gust tile with wrap-around, as the GPU's linear filter does it. */
function tileAt(u: number, v: number, out: [number, number]): [number, number] {
  const t = gustTile();
  const N = GUST_TILE_N;
  const x = u * N - 0.5, y = v * N - 0.5;
  const fx0 = Math.floor(x), fy0 = Math.floor(y);
  const fx = x - fx0, fy = y - fy0;
  const i0 = ((fx0 % N) + N) % N, j0 = ((fy0 % N) + N) % N;
  const i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
  for (let c = 0; c < 2; c++) {
    const a = t[(j0 * N + i0) * 2 + c]!, b = t[(j0 * N + i1) * 2 + c]!;
    const d = t[(j1 * N + i0) * 2 + c]!, e = t[(j1 * N + i1) * 2 + c]!;
    out[c] = (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
  }
  return out;
}

/**
 * What changes with time but not with place: the mean wind's heading, where the eddies have been carried to
 * (two slices of the tile, faded from one to the next over GUST_LIFE_S), and how to keep the fade from
 * weakening the gusts halfway. The GPU gets these as uniforms once a frame.
 */
export interface GustFrame {
  /** Unit vector the mean wind blows toward, (x, z). */
  dir: [number, number];
  /** Tile offsets of the two slices (u, v), with the drift downwind folded in. */
  a: [number, number];
  b: [number, number];
  /** Weight of slice b, and 1 / the blend's standard deviation. */
  mix: number;
  norm: number;
}

const frac = (x: number) => x - Math.floor(x);

export function gustFrame(w: Wind, t: number, out?: GustFrame): GustFrame {
  const f = out ?? { dir: [0, 0], a: [0, 0], b: [0, 0], mix: 0, norm: 1 };
  const a0 = (w.fromClock * Math.PI) / 6;
  // Coming from bearing a0 (clockwise from downrange), the air blows the other way.
  f.dir[0] = -Math.sin(a0);
  f.dir[1] = Math.cos(a0);
  const carried = (w.speed * t) / GUST_TILE_M.along;
  const tau = t / GUST_LIFE_S;
  const k = Math.floor(tau);
  const s = tau - k;
  f.mix = s * s * (3 - 2 * s);
  f.norm = 1 / Math.hypot(1 - f.mix, f.mix);
  f.a[0] = frac(hash(k, 1) - carried);
  f.a[1] = hash(k, 2);
  f.b[0] = frac(hash(k + 1, 1) - carried);
  f.b[1] = hash(k + 1, 2);
  return f;
}

/**
 * The ground's hand in the wind, on a grid: per cell the height above its surroundings (ground height minus
 * its Gaussian-weighted mean over ~100 m), the slope (dh/dx, dh/dz) and the height itself. Bilinear between
 * cells, values half-float exact so the GPU reads the same.
 */
export interface TerrainWind {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  /** rel, dh/dx, dh/dz, h per cell, row-major (x fastest). */
  data: Float32Array;
}

/** How fast the ground's effect fades with height above it (m). */
export const TERRAIN_FADE_M = 30;
/** Crest speed-up per metre of height above the surroundings: 1.6 × H / L for a round hill, as a rise over ~100 m. */
export const CREST_PER_M = 0.045;
/** Lee slopes (falling downwind) past which the flow comes away from the ground (about 17° to 24°), and how much slower the air is behind them. */
export const LEE_SLOPE = [0.3, 0.45] as const;
export const LEE_DROP = 0.6;

/**
 * Samples `height(x, z)` on a grid over [x0, x1] × [z0, z1] and works out the terrain's wind terms. `cell` is
 * the grid step; the surroundings' mean uses a Gaussian of σ = 50 m.
 */
export function terrainWind(height: (x: number, z: number) => number, x0: number, z0: number, x1: number, z1: number, cell = 10): TerrainWind {
  const nx = Math.ceil((x1 - x0) / cell) + 1;
  const nz = Math.ceil((z1 - z0) / cell) + 1;
  const h = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = height(x0 + i * cell, z0 + j * cell);
  // Separable Gaussian, edges clamped.
  const sigma = 50 / cell;
  const r = Math.ceil(sigma * 2.5);
  const k: number[] = [];
  let ks = 0;
  for (let d = -r; d <= r; d++) { const w = Math.exp(-(d * d) / (2 * sigma * sigma)); k.push(w); ks += w; }
  const blurX = new Float64Array(nx * nz);
  const mean = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += k[d + r]! * h[j * nx + Math.min(nx - 1, Math.max(0, i + d))]!;
    blurX[j * nx + i] = s / ks;
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += k[d + r]! * blurX[Math.min(nz - 1, Math.max(0, j + d)) * nx + i]!;
    mean[j * nx + i] = s / ks;
  }
  const data = new Float32Array(nx * nz * 4);
  const H = (i: number, j: number) => h[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]!;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const o = (j * nx + i) * 4;
    data[o] = halfExact(H(i, j) - mean[j * nx + i]!);
    data[o + 1] = halfExact((H(i + 1, j) - H(i - 1, j)) / (2 * cell));
    data[o + 2] = halfExact((H(i, j + 1) - H(i, j - 1)) / (2 * cell));
    data[o + 3] = halfExact(H(i, j));
  }
  return { x0, z0, cell, nx, nz, data };
}

/**
 * A tree or a building: a round footprint (`r`) or an axis-aligned box (`hx`, `hz` half sizes) centred on
 * (x, z), standing from `base` (ground level, absolute y) to `base + height`. `porosity` is the share of the air
 * that gets through: 0 for a building, about 0.3 for a dense conifer and 0.45 for a broadleaf tree in leaf.
 */
export interface Obstacle {
  x: number;
  z: number;
  r?: number;
  hx?: number;
  hz?: number;
  base: number;
  height: number;
  porosity: number;
}

/**
 * Shelter on a grid, for one mean wind direction: per cell how much of the wind is taken away (0 to 1), the
 * height (absolute y) up to which it all is, and the height by which it is all back. Bilinear between cells.
 */
export interface ShelterWind {
  /** The `fromClock` it was baked for. */
  fromClock: number;
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  /** deficit, full-to y, gone-by y, spare: per cell, row-major (x fastest). */
  data: Float32Array;
}

/**
 * The wake behind an obstacle `x` metres past its lee edge, as a share of the wind taken away. Deepest from the
 * obstacle to `xm` behind it, then recovering exponentially: a medium-porosity windbreak (0.5) keeps the wind
 * to 40 % at 2.5 H, 80 % at 10 H and 95 % at 20 H; a wall cuts it to 10 % close behind and lets it back by
 * about 10 H. A narrow obstacle (a lone tree) is passed round as well as over, so its wake is weaker and shorter.
 */
export function wakeDeficit(x: number, height: number, width: number, porosity: number): number {
  const narrow = Math.min(1, Math.max(0.5, 0.4 + (0.3 * width) / height));
  const top = (0.9 - 0.6 * porosity) * narrow;
  const xm = (1 + 3 * porosity) * height;
  const lr = (4 + 6 * porosity) * height * narrow;
  return x <= xm ? top : top * Math.exp(-(x - xm) / lr);
}

/**
 * Bakes the shelter of `obstacles` for wind from `fromClock`, on a grid over [x0, x1] × [z0, z1] with `cell`
 * spacing. `height(x, z)` is the ground, so a wake's layer follows it.
 *
 * Trees in a belt shelter as one windbreak, not as a stack of lone trees: each obstacle's wake is worked out
 * for the width of the crowd it stands in across the wind, and for the rows upwind of it (each row lets
 * through its share of what reached it), and where wakes overlap the deepest counts. So a wood shelters like
 * a dense windbreak of its height, a lone tree like a lone tree, and it is calmer deep in a wood than at its edge.
 */
export function shelterWind(obstacles: readonly Obstacle[], fromClock: number, height: (x: number, z: number) => number, x0: number, z0: number, x1: number, z1: number, cell = 4): ShelterWind {
  const nx = Math.ceil((x1 - x0) / cell) + 1;
  const nz = Math.ceil((z1 - z0) / cell) + 1;
  const deficit = new Float64Array(nx * nz);
  const full = new Float64Array(nx * nz);
  const gone = new Float64Array(nx * nz);
  const ground = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) ground[j * nx + i] = height(x0 + i * cell, z0 + j * cell);
  const a0 = (fromClock * Math.PI) / 6;
  // Downwind, and across it, as (x, z).
  const ux = -Math.sin(a0), uz = Math.cos(a0);
  const cx = -uz, cz = ux;
  // Each footprint's half-extent along the wind and across it, and where it sits in the wind's frame.
  const geo = obstacles.map((o) => {
    const round = o.r !== undefined;
    const hx = round ? o.r! : o.hx!, hz = round ? o.r! : o.hz!;
    return {
      ea: round ? o.r! : Math.abs(ux) * hx + Math.abs(uz) * hz,
      ec: round ? o.r! : Math.abs(cx) * hx + Math.abs(cz) * hz,
      a: o.x * ux + o.z * uz,
      c: o.x * cx + o.z * cz,
      H: Math.max(0.5, o.height),
    };
  });
  // The crowd: across the wind, the span of the obstacles standing within two heights along it and three
  // across, counted as wide only as far as they fill it; and the rows upwind whose footprints overlap this one.
  const order = geo.map((_, i) => i).sort((p, q) => geo[p]!.a - geo[q]!.a);
  const width = geo.map((g) => 2 * g.ec);
  const porosity = obstacles.map((o) => o.porosity);
  for (let n = 0; n < order.length; n++) {
    const i = order[n]!;
    const g = geo[i]!;
    let lo = -g.ec, hi = g.ec, filled = 2 * g.ec, upwind = 0;
    for (let m = 0; m < order.length; m++) {
      const k = order[m]!;
      if (k === i) continue;
      const h = geo[k]!;
      const da = h.a - g.a, dc = h.c - g.c;
      if (da > 2 * g.H) break;
      if (da < -4 * g.H) continue;
      if (Math.abs(da) <= 2 * g.H && Math.abs(dc) <= 3 * g.H) {
        lo = Math.min(lo, dc - h.ec);
        hi = Math.max(hi, dc + h.ec);
        filled += 2 * h.ec;
      }
      if (da < -(g.ea + h.ea) * 0.5 && Math.abs(dc) < g.ec + h.ec && h.H > 0.5 * g.H) upwind++;
    }
    width[i] = Math.max(2 * g.ec, (hi - lo) * Math.min(1, filled / (hi - lo) / 0.5));
    porosity[i] = obstacles[i]!.porosity ** (1 + 0.5 * Math.min(6, upwind));
  }
  obstacles.forEach((o, n) => {
    const { ea, ec, H } = geo[n]!;
    const round = o.r !== undefined;
    const hx = round ? o.r! : o.hx!, hz = round ? o.r! : o.hz!;
    const phi = porosity[n]!;
    const reach = (1 + 3 * phi) * H + 5 * (4 + 6 * phi) * H;
    const up = 4 * H;
    const side = ec + 0.3 * H + 0.15 * reach;
    // Grid box covering upwind, the footprint and the wake.
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const [a, c] of [[-ea - up, -side], [-ea - up, side], [ea + reach, -side], [ea + reach, side]] as const) {
      const x = o.x + a * ux + c * cx, z = o.z + a * uz + c * cz;
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z);
    }
    const i0 = Math.max(0, Math.floor((bx0 - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((bx1 - x0) / cell));
    const j0 = Math.max(0, Math.floor((bz0 - z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((bz1 - z0) / cell));
    const top = o.base + H;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        const px = x0 + i * cell - o.x, pz = z0 + j * cell - o.z;
        const a = px * ux + pz * uz;
        const lat = Math.abs(px * cx + pz * cz) - ec;
        const inFoot = round ? Math.hypot(px, pz) <= o.r! : Math.abs(px) <= hx && Math.abs(pz) <= hz;
        let d = 0, f = 0, g = 0;
        if (inFoot) {
          // Inside: no wind in a building, what gets through the leaves in a crown; all of it up to the top.
          d = 1 - phi;
          f = top;
          g = top + 1;
        } else if (a > ea) {
          const x = a - ea;
          const m = 0.3 * H + 0.15 * x;
          d = wakeDeficit(x, H, width[n]!, phi) * (lat <= 0 ? 1 : Math.max(0, 1 - lat / m));
          f = ground[k]! + 0.3 * H;
          g = ground[k]! + (1.2 + (0.03 * x) / H) * H;
        } else if (a < -ea) {
          // Upwind the air already slows as it starts to climb over.
          const u = -a - ea;
          d = 0.25 * (1 - phi) * Math.exp(-u / (1.5 * H)) * (lat <= 0 ? 1 : Math.max(0, 1 - lat / (0.3 * H)));
          f = ground[k]! + 0.2 * H;
          g = ground[k]! + H;
        }
        if (d <= deficit[k]!) continue;
        deficit[k] = d;
        full[k] = f;
        gone[k] = g;
      }
    }
  });
  const data = new Float32Array(nx * nz * 4);
  for (let k = 0; k < nx * nz; k++) {
    const d = deficit[k]!;
    data[k * 4] = halfExact(d);
    data[k * 4 + 1] = halfExact(d > 0 ? full[k]! : ground[k]!);
    data[k * 4 + 2] = halfExact(d > 0 ? Math.max(gone[k]!, full[k]! + 0.5) : ground[k]! + 1);
  }
  return { fromClock, x0, z0, cell, nx, nz, data };
}

/** Bilinear lookup in a node grid (terrain or shelter), clamped at its edge as the GPU's clamp-to-edge is. */
function gridAt(g: { x0: number; z0: number; cell: number; nx: number; nz: number; data: Float32Array }, x: number, z: number, out: number[]): number[] {
  const fx = Math.min(g.nx - 1, Math.max(0, (x - g.x0) / g.cell));
  const fz = Math.min(g.nz - 1, Math.max(0, (z - g.z0) / g.cell));
  const i0 = Math.min(g.nx - 2, Math.floor(fx)), j0 = Math.min(g.nz - 2, Math.floor(fz));
  const u = fx - i0, v = fz - j0;
  const d = g.data;
  for (let c = 0; c < 4; c++) {
    const a = d[(j0 * g.nx + i0) * 4 + c]!, b = d[(j0 * g.nx + i0 + 1) * 4 + c]!;
    const e = d[((j0 + 1) * g.nx + i0) * 4 + c]!, h = d[((j0 + 1) * g.nx + i0 + 1) * 4 + c]!;
    out[c] = (a + (b - a) * u) * (1 - v) + (e + (h - e) * u) * v;
  }
  return out;
}

/** The terrain's four terms at (x, z): height above the surroundings, slope x, slope z, height. */
export const terrainAt = (tw: TerrainWind, x: number, z: number, out: number[] = [0, 0, 0, 0]): number[] => gridAt(tw, x, z, out);

/** The shelter at (x, z): deficit, full-to y, gone-by y. */
export const shelterAt = (sw: ShelterWind, x: number, z: number, out: number[] = [0, 0, 0, 0]): number[] => gridAt(sw, x, z, out);

/** Share of the wind left at height `y` under a shelter of deficit `d`, all of it taken to `f`, none by `g`. */
export function shelterShare(d: number, f: number, g: number, y: number): number {
  const q = Math.min(1, Math.max(0, (y - f) / Math.max(0.01, g - f)));
  return 1 - d * (1 - q * q * (3 - 2 * q));
}

/** Wind speed at `agl` metres over open ground, as a share of the speed at 3 m (log law, held below 0.3 m). */
export function profileShare(agl: number): number {
  return Math.min(1.6, Math.log(Math.max(0.3, agl) / ROUGHNESS_M) / LOG_REF);
}

const frameTmp: GustFrame = { dir: [0, 0], a: [0, 0], b: [0, 0], mix: 0, norm: 1 };
const ta: [number, number] = [0, 0];
const tb: [number, number] = [0, 0];
const tt = [0, 0, 0, 0];
const st = [0, 0, 0, 0];
const shelteredShare = (sw: ShelterWind, x: number, y: number, z: number) => {
  shelterAt(sw, x, z, st);
  return shelterShare(st[0]!, st[1]!, st[2]!, y);
};

/**
 * Air velocity (m/s, scene frame) at (x, y, z) and time `t`. Without terrain or shelter, `y` is ignored and
 * the wind is the same at every height.
 */
export function windAt(w: Wind, x: number, y: number, z: number, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  if (w.speed <= 0) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  const f = gustFrame(w, t, frameTmp);
  const [ux, uz] = f.dir;
  const s = (x * ux + z * uz) / GUST_TILE_M.along;
  const n = (-x * uz + z * ux) / GUST_TILE_M.across;
  tileAt(s + f.a[0], n + f.a[1], ta);
  tileAt(s + f.b[0], n + f.b[1], tb);
  const gs = (ta[0] + (tb[0] - ta[0]) * f.mix) * f.norm;
  const gd = (ta[1] + (tb[1] - ta[1]) * f.mix) * f.norm;
  let sp = Math.max(0, w.speed * (1 + w.gust * gs));
  const d = gustSwing(w.gust) * gd;
  const c = Math.cos(d), sn = Math.sin(d);
  let hx = ux * c - uz * sn, hz = ux * sn + uz * c;
  let vy = 0;
  if (w.terrain) {
    const [rel, gx, gz, h] = terrainAt(w.terrain, x, z, tt) as [number, number, number, number];
    const agl = Math.max(0, y - h);
    const fade = Math.exp(-agl / TERRAIN_FADE_M);
    // Lee slope: the ground falls away downwind faster than the air can follow it.
    const fall = -(hx * gx + hz * gz);
    const lee = Math.min(1, Math.max(0, (fall - LEE_SLOPE[0]) / (LEE_SLOPE[1] - LEE_SLOPE[0])));
    sp *= profileShare(agl) * Math.max(0.3, 1 + fade * (CREST_PER_M * rel - LEE_DROP * lee * lee * (3 - 2 * lee)));
    if (w.shelter) sp *= shelteredShare(w.shelter, x, y, z);
    hx *= sp;
    hz *= sp;
    // The air follows the ground: up a slope it lifts, down one it sinks.
    vy = fade * (hx * gx + hz * gz);
  } else {
    if (w.shelter) sp *= shelteredShare(w.shelter, x, y, z);
    hx *= sp;
    hz *= sp;
  }
  out[0] = hx;
  out[1] = vy;
  out[2] = hz;
  return out;
}
