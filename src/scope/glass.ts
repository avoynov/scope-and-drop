/**
 * A bullet through window glass: how much speed it loses, which way the pane turns it, how much it sets it
 * yawing, and whether the jacket comes off, for the three rounds in the lab.
 *
 * What the literature measures, and what the model takes from it (docs/reticle-demo.md §11 has the sources):
 *  - Square-on, glass barely turns a rifle bullet. Lambert (1994) fired M118 (173 gr FMJ, ≈ 760 m/s) through
 *    6 mm tempered glass with the target 5 yd behind it: the bullets landed 1.5 cm right of the line (0.2°),
 *    SD 1.2 cm. Forensic work agrees: "virtually no deflection" square-on.
 *  - Oblique, the spread opens and the bullet turns. Lambert's cores went 3.3 cm right at 30° and 5.5 cm right
 *    at 45° (SD 2.5 and 3.6 cm) with the rifle on the right of the pane's normal, and still went right with the
 *    rifle on the left; at 45° they also went 1.8 cm high. Handgun bullets through windshields turn 1–10°
 *    toward the normal (Haag; ±5° is the usual allowance). Hornady's LE guidance: above 15° groups open
 *    0.4–0.8 in per foot behind the glass.
 *  - It yaws the bullet and strips jackets: Lambert saw keyholes within 5 yd, and every jacket came off at 45°.
 *    Open-tip match bullets break up even square-on (FBI 1992: 168 gr HPBT through insulated glass kept 50 gr).
 *
 * The model, per sheet of glass the bullet meets (glass sheets bonded with PVB count as one sheet):
 *  1. Speed: the column of glass in the bullet's presented area along its path is taken up to the bullet's
 *     speed (an inelastic collision), then the work of crushing the glass, the nose and the PVB comes off its
 *     energy. Fitted to Osnes et al.'s laminated plates (7.62 mm AP, 11.4 mm glass + 3 mm PVB): ballistic
 *     limit 232 m/s (model 240), 520 → 413 m/s (model 414), and the bare core through a second plate
 *     413 → 241 m/s (model 203). Window glass costs a rifle bullet 5–6 %, laminated glass 9–14 %.
 *  2. Turn, with f the share of speed lost and θ the obliquity: 0.044·f·tan θ toward the normal, as a ray is
 *     refracted; 0.046·f·(1 + 0.67 tan θ) to the side the bullet spins; 0.039·f·tan θ up or down, the spinning
 *     flank that meets the glass first being rubbed back (up when the right flank leads, with a right-hand
 *     twist); and a scatter of 0.039·f·(1 + 1.2 tan θ) in the plane of the obliquity, 0.039·f·(1 + 0.5 tan θ)
 *     across it. This reproduces Lambert's means above to within a millimetre and his spreads to within 3 mm.
 *  3. Yaw: the glass knocks the nose sideways. The bullet swings out to 1.2·f·(1 + 2 tan θ) (±40 %) within the
 *     first metre or two, nutates with a period of a few metres and settles over ~80 m. An estimate: no yaw
 *     cards behind glass are published.
 *  4. Jacket: stripped with a likelihood rising with (v / v_strip)² · (1 + 3 tan² θ) · √(glass / 6 mm). M118 FMJ
 *     keeps it square-on, loses it a third of the time at 30° and always at 45° (Lambert); an open-tip match
 *     bullet loses it square-on above ~500 m/s; the subsonic SP-5 keeps it unless the pane is very steep.
 *
 * Everything is deterministic for a seed, and costs a few microseconds a sheet.
 */
import type { RoundId } from './ballistics';
import { ROUNDS } from './ballistics';
import type { Vec3 } from './shot';

/** One ply of a glazing. Glass is annealed float unless tempered; PVB is the laminating interlayer. */
export interface Ply {
  k: 'glass' | 'tempered' | 'pvb';
  mm: number;
}
/** A sheet: plies bonded together, with an air gap in front of it (0 for the first). */
export interface Sheet {
  plies: readonly Ply[];
  gapMm: number;
}
export interface Glazing {
  name: string;
  sheets: readonly Sheet[];
}

/** The windows a house has: old single glazing, a sealed double unit, laminated safety glass, toughened glass. */
export const GLAZING = {
  single: { name: 'single 4 mm', sheets: [{ plies: [{ k: 'glass', mm: 4 }], gapMm: 0 }] },
  double: { name: 'double 4-16-4', sheets: [{ plies: [{ k: 'glass', mm: 4 }], gapMm: 0 }, { plies: [{ k: 'glass', mm: 4 }], gapMm: 16 }] },
  laminated: { name: 'laminated 6.8 mm', sheets: [{ plies: [{ k: 'glass', mm: 3 }, { k: 'pvb', mm: 0.76 }, { k: 'glass', mm: 3 }], gapMm: 0 }] },
  tempered: { name: 'tempered 6 mm', sheets: [{ plies: [{ k: 'tempered', mm: 6 }], gapMm: 0 }] },
} as const satisfies Record<string, Glazing>;
export type GlazingId = keyof typeof GLAZING;

/** Front face to back face (m). */
export const glazingDepth = (g: Glazing): number => g.sheets.reduce((s, sh) => s + (sh.gapMm + sh.plies.reduce((a, p) => a + p.mm, 0)) / 1000, 0);

/** How a bullet takes glass. */
export interface GlassBullet {
  diaM: number;
  lenM: number;
  /** The jacket's share of the mass, shed when it strips. */
  jacket: number;
  /** Square-on, above about this speed the glass tears the jacket off. */
  stripV: number;
  /** How much its nose crushes, as a share of the glass's own impact energy (a hard nose 0, a hollow point 0.4). */
  deform: number;
  /** Share of the mass that breaks away besides the jacket when it strips (a soft match core). */
  breakup: number;
}

/**
 * The lab's three bullets.
 *  - 7N1: steel core, lead knocker and an air pocket under a bimetal (clad steel) jacket. The steel jacket is
 *    stronger than M118's gilding metal: it strips a little later. Jacket ≈ 38 % of the mass, as in the LPS
 *    bullet it was built from.
 *  - M118LR: Sierra MatchKing open tip, thin jacket, lead core. It breaks up on glass square-on: the FBI's
 *    168 gr HPBT kept 30 % of its weight through insulated glass and 24 % through a windshield.
 *  - SP-5: mild steel and lead core with an air pocket in a bimetal jacket. At 260 m/s the glass loads it an
 *    eighth as hard as a 7.62 at 750 m/s, so it stays whole unless the pane is steep.
 */
export const GLASS_BULLET: Record<RoundId, GlassBullet> = {
  '7n1': { diaM: 0.00792, lenM: 0.0323, jacket: 0.38, stripV: 850, deform: 0.25, breakup: 0 },
  m118lr: { diaM: 0.00782, lenM: 0.0315, jacket: 0.3, stripV: 420, deform: 0.4, breakup: 0.3 },
  sp5: { diaM: 0.00925, lenM: 0.036, jacket: 0.28, stripV: 520, deform: 0.15, breakup: 0 },
};

const RHO_GLASS = 2500;
/** Work of crushing glass and of stretching PVB, per metre of path per metre of presented width (J/m²). */
const CRUSH: Record<Ply['k'], number> = { glass: 0.4e6, tempered: 0.55e6, pvb: 8.2e6 };
/** Turn toward the normal, to the spin side and from the rub, scatter, and yaw, per unit of speed lost (see the header). */
const TURN = 0.044, SPIN_SIDE = 0.046, SPIN_SIDE_TAN = 0.67, RUB = 0.039;
const SCATTER = 0.039, SCATTER_IN = 1.2, SCATTER_OUT = 0.5, YAW = 1.2;
/** The yaw dies away over this distance (m). */
const YAW_SETTLE_M = 80;
/** Drag grows by this much per rad² of yaw (C_D = C_D0·(1 + k·δ²), k ≈ 15 for spitzers). */
const YAW_DRAG = 15;
const TAN_MAX = Math.tan((75 * Math.PI) / 180);

/** Repeatable uniform and normal numbers for a seed. */
function rng(seed: number) {
  let s = (Math.imul(seed | 0, 0x9e3779b9) ^ 0x5bd1e995) >>> 0;
  const u = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, u()))) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Where the bullet went through one sheet, for drawing the hole. */
export interface SheetHit {
  /** Index into the glazing's sheets. */
  sheet: number;
  /** Where it went in (front face of that sheet), world frame. */
  at: Vec3;
  speedIn: number;
  speedOut: number;
  /** Angle between the bullet's path and the pane's normal (rad). */
  obliquity: number;
  /** It glanced off this sheet instead of going through. */
  ricochet: boolean;
}

/** The bullet after the glass. */
export interface Through {
  outcome: 'through' | 'ricochet' | 'stopped';
  /** Where it leaves the last face, and its velocity there. */
  pos: Vec3;
  vel: Vec3;
  speed: number;
  /** What is left of it: the core alone if the jacket stripped. */
  massKg: number;
  stripped: boolean;
  /** How far it swings in yaw (rad), and the length of one swing (m). */
  yawMax: number;
  swingM: number;
  /** How far the glass turned its path (rad). */
  turn: number;
  sheets: SheetHit[];
}

export interface GlassShot {
  round: RoundId;
  /** Where it meets the front face, and its velocity there. */
  pos: Vec3;
  vel: Vec3;
  /** The pane's normal, pointing back toward the shooter's side. */
  normal: Vec3;
  glazing: Glazing;
  /** The rifle's twist (m per turn), its hand (1 right, the default; −1 left), and the bullet's gyroscopic stability. */
  twistM: number;
  twistSign?: number;
  sg: number;
  /** Its mass, if not the round's own, and whether it has lost its jacket (to an earlier pane). */
  massKg?: number;
  stripped?: boolean;
  /** A bullet other than the round's own (for fitting to tests of other loads). */
  bullet?: GlassBullet;
  /** Yaw it already carries in from an earlier pane, and how far it has flown since. */
  yawMax?: number;
  swingM?: number;
  sinceM?: number;
  seed: number;
}

/**
 * One swing of yaw (m): the nutation of a spinning bullet whose nose has been knocked sideways. Its yaw
 * magnitude beats at the difference of the fast and slow modes, (Ix/Iy)·p·√(1 − 1/Sg), so one swing takes
 * twist / ((Ix/Iy)·√(1 − 1/Sg)) metres whatever the speed. Ix/Iy is a cylinder's, raised 20 % for the
 * mass a spitzer carries aft.
 */
export function swingLength(b: GlassBullet, twistM: number, sg: number): number {
  const l = b.lenM / b.diaM;
  const ratio = (1.2 * (1 / 8)) / ((l * l) / 12 + 1 / 16);
  return twistM / (ratio * Math.sqrt(Math.max(0.05, 1 - 1 / Math.max(1.05, sg))));
}

/**
 * The yaw `x` metres after the glass: out to its full swing within the first quarter swing, then beating
 * between a fifth of it and all of it, dying away over ~80 m.
 */
export function yawAfter(yawMax: number, swingM: number, x: number): number {
  if (yawMax <= 0) return 0;
  const beat = Math.abs(Math.sin((Math.PI * x) / swingM));
  const floor = 0.2 * Math.min(1, x / (0.25 * swingM));
  return yawMax * Math.exp(-x / YAW_SETTLE_M) * Math.max(beat, floor);
}

/** The drag multiplier `x` metres after the glass: yaw adds drag, and a core without its jacket is blunter. */
export function dragAfter(t: Through, x: number): number {
  const y = yawAfter(t.yawMax, t.swingM, x);
  return (1 + YAW_DRAG * y * y) * (t.stripped ? 1.25 : 1);
}

/**
 * The critical grazing angle (rad, from the surface) below which a bullet glances off glass instead of
 * breaking through: about 10° for a 9 mm at 360 m/s (AAFS 2017: ricochet at 10°, through at 20°), less for
 * faster bullets, which break the glass before they can turn.
 */
export function ricochetAngle(speed: number): number {
  return (Math.min(20, 3 + 3000 / Math.max(50, speed)) * Math.PI) / 180;
}

/** The bullet through every sheet of the glazing, front to back. */
export function throughGlass(o: GlassShot): Through {
  const b = o.bullet ?? GLASS_BULLET[o.round];
  const r = rng(o.seed * 7 + 3);
  const n = norm(o.normal);
  let m = o.massKg ?? ROUNDS[o.round].bulletGr * 0.0000648;
  let stripped = o.stripped ?? false;
  let v = Math.hypot(...o.vel);
  let dir = norm(o.vel);
  let pos: Vec3 = [...o.pos];
  const swingM = swingLength(b, o.twistM, o.sg);
  let yawMax = o.yawMax ?? 0;
  const yawSwing = o.swingM ?? swingM;
  let since = o.sinceM ?? Infinity;
  const v0dir = dir;
  const turned = () => Math.acos(Math.max(-1, Math.min(1, dot(dir, v0dir))));
  const sheets: SheetHit[] = [];
  for (let k = 0; k < o.glazing.sheets.length; k++) {
    const sh = o.glazing.sheets[k]!;
    // Across the gap to this sheet's front face.
    const cos0 = Math.max(1e-3, -dot(dir, n));
    const gap = sh.gapMm / 1000;
    if (gap > 0) {
      const l = gap / cos0;
      pos = [pos[0] + dir[0] * l, pos[1] + dir[1] * l, pos[2] + dir[2] * l];
      since = since === Infinity ? l : since + l;
    }
    const cos = -dot(dir, n);
    const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
    const tan = Math.min(TAN_MAX, Math.tan(theta));
    const hit: SheetHit = { sheet: k, at: [...pos], speedIn: v, speedOut: v, obliquity: theta, ricochet: false };
    sheets.push(hit);
    // Too shallow: it glances off.
    if (Math.PI / 2 - theta < ricochetAngle(v) || cos <= 0) {
      const graze = Math.max(0, Math.PI / 2 - theta);
      const tang = norm([dir[0] + n[0] * cos, dir[1] + n[1] * cos, dir[2] + n[2] * cos]);
      const out = 0.8 * graze;
      dir = norm([tang[0] * Math.cos(out) + n[0] * Math.sin(out), tang[1] * Math.cos(out) + n[1] * Math.sin(out), tang[2] * Math.cos(out) + n[2] * Math.sin(out)]);
      v *= 0.85;
      hit.speedOut = v;
      hit.ricochet = true;
      return { outcome: 'ricochet', pos, vel: [dir[0] * v, dir[1] * v, dir[2] * v], speed: v, massKg: m, stripped, yawMax: 1, swingM, turn: turned(), sheets };
    }
    // What it presents: its point if it is straight, more of its side the more it is yawed. A bare core is
    // about 0.87 of the calibre.
    const yaw = since === Infinity ? 0 : yawAfter(yawMax, yawSwing, since);
    const area = ((Math.PI * b.diaM * b.diaM) / 4) * (stripped ? 0.75 : 1) * Math.cos(yaw) + b.lenM * b.diaM * 0.8 * Math.sin(yaw);
    const width = b.diaM * (stripped ? 0.87 : 1) * Math.cos(yaw) + b.lenM * Math.sin(yaw);
    let glassM = 0, crush = 0;
    for (const p of sh.plies) {
      const path = p.mm / 1000 / Math.max(0.2, cos);
      if (p.k !== 'pvb') glassM += path;
      crush += CRUSH[p.k] * path * width;
    }
    // The glass in its path taken up to its speed, then the crushing work off its energy.
    const mg = RHO_GLASS * glassM * area;
    const v1 = (v * m) / (m + mg);
    const nose = b.deform * 0.5 * mg * v * v * ((v * v) / (v * v + 300 * 300));
    const e = 0.5 * m * v1 * v1 - crush - nose;
    if (e <= 0.5 * m * 20 * 20) {
      hit.speedOut = 0;
      return { outcome: 'stopped', pos, vel: [0, 0, 0], speed: 0, massKg: m, stripped, yawMax, swingM, turn: turned(), sheets };
    }
    const v2 = Math.sqrt((2 * e) / m);
    const f = 1 - v2 / v;
    // The turn (see the header): toward the normal; to the side it spins; up or down from the spinning flank
    // rubbing on the glass it meets first; and scatter, wider in the plane of the obliquity.
    const toward: Vec3 = [-n[0] - dir[0] * cos, -n[1] - dir[1] * cos, -n[2] - dir[2] * cos];
    const inPlane = Math.hypot(...toward) > 1e-6 ? norm(toward) : norm(cross(dir, [0, 1, 0]));
    const across = norm(cross(dir, inPlane));
    const right = norm(cross(dir, [0, 1, 0]));
    const tw = o.twistSign ?? 1;
    // A right-hand twist spins it clockwise seen from behind: the flank that meets the glass first moves
    // across, and the glass rubs it the other way (inPlane × dir).
    const rub: Vec3 = cross(inPlane, dir);
    const dIn = TURN * f * tan + SCATTER * f * (1 + SCATTER_IN * tan) * r.n();
    const dOut = SCATTER * f * (1 + SCATTER_OUT * tan) * r.n();
    const spin = tw * SPIN_SIDE * f * (1 + SPIN_SIDE_TAN * tan);
    const fr = tw * RUB * f * tan;
    dir = norm([
      dir[0] + inPlane[0] * dIn + across[0] * dOut + right[0] * spin + rub[0] * fr,
      dir[1] + inPlane[1] * dIn + across[1] * dOut + right[1] * spin + rub[1] * fr,
      dir[2] + inPlane[2] * dIn + across[2] * dOut + right[2] * spin + rub[2] * fr,
    ]);
    v = v2;
    // The jacket: torn off by fast glass, sooner the steeper the pane.
    if (!stripped) {
      const x = (hit.speedIn / b.stripV) ** 2 * (1 + 3 * tan * tan) * Math.sqrt((glassM * cos) / 0.006);
      if (r.u() < smooth(1, 2.5, x)) {
        stripped = true;
        // A match bullet's soft core breaks up with it, the more the faster it was going.
        m *= 1 - b.jacket * (0.75 + 0.25 * r.u()) - b.breakup * Math.min(1, x / 3);
      }
    } else r.u();
    // The kick sets it yawing. A fresh kick adds to what is still swinging, at a random phase.
    const kick = YAW * f * (1 + 2 * tan) * (0.6 + 0.8 * r.u()) * (stripped ? 1.5 : 1);
    const left = since === Infinity ? 0 : yawMax * Math.exp(-since / YAW_SETTLE_M);
    yawMax = Math.min(1.4, Math.hypot(left, kick));
    since = 0;
    hit.speedOut = v;
    // Through the sheet to its back face.
    const thick = sh.plies.reduce((a, p) => a + p.mm, 0) / 1000;
    const l = thick / Math.max(0.2, -dot(dir, n));
    pos = [pos[0] + dir[0] * l, pos[1] + dir[1] * l, pos[2] + dir[2] * l];
  }
  return {
    outcome: 'through',
    pos,
    vel: [dir[0] * v, dir[1] * v, dir[2] * v],
    speed: v,
    massKg: m,
    stripped,
    yawMax,
    swingM,
    turn: turned(),
    sheets,
  };
}
