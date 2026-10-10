/**
 * Point-mass exterior ballistics: standard G1/G7 drag, ICAO sea-level air, no wind, no spin drift.
 * Distances in metres, speeds in m/s, angles in radians. Drop is measured below the bore line.
 */

/** Standard drag functions, Mach → Cd (McCoy / JBM tables, as used by py-ballisticcalc). */
const G1 = [
  0, 0.2629, 0.05, 0.2558, 0.1, 0.2487, 0.15, 0.2413, 0.2, 0.2344, 0.25, 0.2278, 0.3, 0.2214, 0.35, 0.2155, 0.4, 0.2104, 0.45, 0.2061, 0.5, 0.2032, 0.55, 0.202,
  0.6, 0.2034, 0.7, 0.2165, 0.725, 0.223, 0.75, 0.2313, 0.775, 0.2417, 0.8, 0.2546, 0.825, 0.2706, 0.85, 0.2901, 0.875, 0.3136, 0.9, 0.3415, 0.925, 0.3734,
  0.95, 0.4084, 0.975, 0.4448, 1, 0.4805, 1.025, 0.5136, 1.05, 0.5427, 1.075, 0.5677, 1.1, 0.5883, 1.125, 0.6053, 1.15, 0.6191, 1.2, 0.6393, 1.25, 0.6518,
  1.3, 0.6589, 1.35, 0.6621, 1.4, 0.6625, 1.45, 0.6607, 1.5, 0.6573, 1.55, 0.6528, 1.6, 0.6474, 1.65, 0.6413, 1.7, 0.6347, 1.75, 0.628, 1.8, 0.621, 1.85, 0.6141,
  1.9, 0.6072, 1.95, 0.6003, 2, 0.5934, 2.05, 0.5867, 2.1, 0.5804, 2.15, 0.5743, 2.2, 0.5685, 2.25, 0.563, 2.3, 0.5577, 2.35, 0.5527, 2.4, 0.5481, 2.45, 0.5438,
  2.5, 0.5397, 2.6, 0.5325, 2.7, 0.5264, 2.8, 0.5211, 2.9, 0.5168, 3, 0.5133,
];
const G7 = [
  0, 0.1198, 0.05, 0.1197, 0.1, 0.1196, 0.15, 0.1194, 0.2, 0.1193, 0.25, 0.1194, 0.3, 0.1194, 0.35, 0.1194, 0.4, 0.1193, 0.45, 0.1193, 0.5, 0.1194, 0.55, 0.1193,
  0.6, 0.1194, 0.65, 0.1197, 0.7, 0.1202, 0.725, 0.1207, 0.75, 0.1215, 0.775, 0.1226, 0.8, 0.1242, 0.825, 0.1266, 0.85, 0.1306, 0.875, 0.1368, 0.9, 0.1464,
  0.925, 0.166, 0.95, 0.2054, 0.975, 0.2993, 1, 0.3803, 1.025, 0.4015, 1.05, 0.4043, 1.075, 0.4034, 1.1, 0.4014, 1.125, 0.3987, 1.15, 0.3955, 1.2, 0.3884,
  1.25, 0.381, 1.3, 0.3732, 1.35, 0.3657, 1.4, 0.358, 1.5, 0.344, 1.55, 0.3376, 1.6, 0.3315, 1.65, 0.326, 1.7, 0.3209, 1.75, 0.316, 1.8, 0.3117, 1.85, 0.3078,
  1.9, 0.3042, 1.95, 0.301, 2, 0.298, 2.05, 0.2951, 2.1, 0.2922, 2.15, 0.2892, 2.2, 0.2864, 2.25, 0.2835, 2.3, 0.2807, 2.35, 0.2779, 2.4, 0.2752, 2.45, 0.2725,
  2.5, 0.2697, 2.55, 0.267, 2.6, 0.2643, 2.65, 0.2615, 2.7, 0.2588, 2.75, 0.2561, 2.8, 0.2533, 2.85, 0.2506, 2.9, 0.2479, 2.95, 0.2451, 3, 0.2424,
];
const TABLES = { G1, G7 } as const;

function cdAt(table: readonly number[], mach: number): number {
  const n = table.length / 2;
  if (mach <= table[0]!) return table[1]!;
  for (let i = 1; i < n; i++) {
    const m1 = table[i * 2]!;
    if (mach <= m1) {
      const m0 = table[i * 2 - 2]!;
      const c0 = table[i * 2 - 1]!;
      return c0 + ((table[i * 2 + 1]! - c0) * (mach - m0)) / (m1 - m0);
    }
  }
  return table[n * 2 - 1]!;
}

/** Standard G7 drag coefficient at a Mach number. */
export const cdG7 = (mach: number): number => cdAt(G7, mach);

export interface Round {
  id: string;
  /** Load name as printed on the box. */
  name: string;
  cartridge: string;
  bulletGr: number;
  /** Muzzle velocity. */
  mv: number;
  /** Ballistic coefficient in lb/in² against `model`. */
  bc: number;
  model: keyof typeof TABLES;
}

export const ROUNDS = {
  /** SVD sniper load: 9.8 g boat-tail, 823 m/s, G7 ≈ 0.206 (G1 ≈ 0.411). */
  '7n1': { id: '7n1', name: '7N1', cartridge: '7.62×54R', bulletGr: 151, mv: 823, bc: 0.206, model: 'G7' },
  /** US sniper load: 175 gr Sierra MatchKing, ≈ 2600 ft/s from a 24" barrel, G7 0.243 (Litz). */
  m118lr: { id: 'm118lr', name: 'M118LR', cartridge: '7.62×51', bulletGr: 175, mv: 790, bc: 0.243, model: 'G7' },
  /**
   * VSS subsonic sniper load: 16.2 g (250 gr), 36 mm spire-point boat-tail. 280 m/s: chronographed at 905 ft/s
   * (276 m/s) from a VSS, published as 270–290 m/s. No BC is published; at Mach 0.8 a boat-tail drags about
   * 1.28 × the G7 shape, so G7 ≈ 0.21 (≈ G1 0.40 at this speed).
   */
  sp5: { id: 'sp5', name: 'SP-5', cartridge: '9×39', bulletGr: 250, mv: 280, bc: 0.21, model: 'G7' },
} as const satisfies Record<string, Round>;
export type RoundId = keyof typeof ROUNDS;

/** ICAO standard atmosphere at sea level. */
export const AIR = { density: 1.225, sound: 340.29, g: 9.80665 };
/** 1 lb/in² in kg/m², to put the BC in SI. */
const LB_IN2 = 703.0696;

export interface Sample {
  /** Horizontal distance from the muzzle. */
  range: number;
  /** Distance below the bore line (bore held level). */
  drop: number;
  /** Time of flight. */
  tof: number;
  /** Bullet speed. */
  v: number;
}

const cache = new Map<string, Sample[]>();

/**
 * Flies the bullet from a level bore and records it every metre out to `maxRange`.
 * Drag deceleration = (π/8)·ρ·v²·Cd_std(M) / BC (BC in kg/m²), integrated with RK4 at 0.5 ms.
 */
export function trajectory(r: Round, maxRange = 1500): Sample[] {
  const key = `${r.id}|${r.mv}|${r.bc}|${r.model}|${maxRange}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const table = TABLES[r.model];
  const k = ((Math.PI / 8) * AIR.density) / (r.bc * LB_IN2);
  const acc = (vx: number, vy: number): [number, number] => {
    const v = Math.hypot(vx, vy);
    const a = k * v * cdAt(table, v / AIR.sound);
    return [-a * vx, -a * vy - AIR.g];
  };
  const out: Sample[] = [{ range: 0, drop: 0, tof: 0, v: r.mv }];
  let x = 0, y = 0, vx = r.mv, vy = 0, t = 0;
  const dt = 0.0005;
  let next = 1;
  while (next <= maxRange && t < 10) {
    const [ax1, ay1] = acc(vx, vy);
    const [ax2, ay2] = acc(vx + ax1 * dt / 2, vy + ay1 * dt / 2);
    const [ax3, ay3] = acc(vx + ax2 * dt / 2, vy + ay2 * dt / 2);
    const [ax4, ay4] = acc(vx + ax3 * dt, vy + ay3 * dt);
    const nx = x + (vx + 2 * (vx + ax1 * dt / 2) + 2 * (vx + ax2 * dt / 2) + (vx + ax3 * dt)) * dt / 6;
    const ny = y + (vy + 2 * (vy + ay1 * dt / 2) + 2 * (vy + ay2 * dt / 2) + (vy + ay3 * dt)) * dt / 6;
    const nvx = vx + (ax1 + 2 * ax2 + 2 * ax3 + ax4) * dt / 6;
    const nvy = vy + (ay1 + 2 * ay2 + 2 * ay3 + ay4) * dt / 6;
    while (next <= maxRange && nx >= next) {
      const f = (next - x) / (nx - x);
      out.push({
        range: next,
        drop: -(y + (ny - y) * f),
        tof: t + dt * f,
        v: Math.hypot(vx + (nvx - vx) * f, vy + (nvy - vy) * f),
      });
      next++;
    }
    x = nx; y = ny; vx = nvx; vy = nvy; t += dt;
  }
  cache.set(key, out);
  return out;
}

/** The trajectory at any range (linear between the 1 m samples). */
export function at(r: Round, range: number): Sample {
  const s = trajectory(r);
  const i = Math.max(0, Math.min(s.length - 2, Math.floor(range)));
  const a = s[i]!;
  const b = s[i + 1]!;
  const f = Math.max(0, Math.min(1, range - a.range));
  return { range, drop: a.drop + (b.drop - a.drop) * f, tof: a.tof + (b.tof - a.tof) * f, v: a.v + (b.v - a.v) * f };
}

/**
 * How far the drum tilts the bore up from the line of sight to zero the rifle at `zero` metres, with the
 * scope `sight` metres above the bore: the bullet climbs to cross the line of sight at the zero range.
 * Zero 0 m is the drum's 0, the bore parallel to the line of sight. (Small angles throughout.)
 */
export function zeroTiltRad(r: Round, zero: number, sight = 0): number {
  return zero > 0 ? (at(r, zero).drop + sight) / zero : 0;
}

/**
 * Hold below the line of sight for a target at `range` with the sight zeroed at `zero` and the scope
 * `sight` metres above the bore. The bullet starts `sight` below the line of sight and the drum tilts the
 * bore up by `zeroTiltRad`. Zero 0 m and sight 0 means sight line and bore are one line: the hold is the
 * whole drop angle.
 */
export function holdRad(r: Round, range: number, zero = 0, sight = 0): number {
  return (at(r, range).drop + sight) / range - zeroTiltRad(r, zero, sight);
}

/**
 * The hand method the mil-tree player is expected to use with the ammo card:
 * flight time ≈ range / mean of muzzle and target speeds, drop ≈ ½·g·t², hold = drop / range.
 */
export function handHoldRad(muzzle: number, atTarget: number, range: number): number {
  const t = range / ((muzzle + atTarget) / 2);
  return (0.5 * AIR.g * t * t) / range;
}
