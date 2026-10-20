/**
 * The Sig Sauer KILO8K-ABS (first generation, SOK8K701): a handheld 7×25 laser rangefinding monocular with an
 * Applied Ballistics Elite solver on board, the Pro way to an elevation for the bolt rifle. Everything here is the
 * device's own behaviour, independent of how the lab draws it (demo/reticle/kilo.ts):
 *  - its optics, laser and body (KILO8K);
 *  - which return the laser reports (pickReturn), for a beam 1.25 × 0.25 mrad that can straddle a target;
 *  - the firing solution its solver puts on the screen (solveFiring);
 *  - its two buttons, menus, power and timers, and what its 304 × 256 OLED shows at any moment (Kilo, screen()).
 *
 * Sources: Sig's operator's manual (7402064-01 rev 04) and product page; reviews by Ocabj, GunsAmerica, Rifle
 * Shooter (KILO10K, same Applied Ballistics display family), Snipers Hide, LongRangeHunting. Where the manual's
 * pictures were not readable, the layout is inferred and says so.
 */
import { ROUNDS, holdRad } from "./ballistics";
import { solveElevationMil } from "./aids";
import { BATTLE_ZERO_M, dialTiltRad, firstHit, fly, millerStability, type Rifle, type Vec3 } from "./shot";

const YD = 0.9144;
const MPH = 0.44704;

export const KILO8K = {
  /** 7×25, 6.78° true field (35.67 ft at 100 yd), 3.6 mm exit pupil, 16 mm eye relief with the cup down. */
  mag: 7,
  objectiveMm: 25,
  fovDeg: 6.78,
  eyeReliefMm: 16,
  /** 112 long × 76 tall × 33 wide (mm), 215 g with its CR2. Flat Dark Earth. */
  bodyMm: { l: 112, h: 76, w: 33 },
  massG: 215,
  /** Red active-matrix OLED in the eyepiece, 304 × 256 pixels. */
  oled: { w: 304, h: 256 },
  /**
   * How much of the field's width the OLED spans. Not published: taken so its corners just touch the field stop
   * (the panel fills the view, as in Sig's mock-up), which makes a pixel 0.31 mrad.
   */
  oledSpan: 0.8,
  /** 905 nm, class 3R. Beam 1.25 × 0.25 mrad (wide, flat). Answer 0.25 s after the press. */
  beamMrad: [1.25, 0.25] as const,
  responseS: 0.25,
  /** Held, RANGE scans: up to 4 readings a second, for 20 s at most (eye safety), then it needs a new press. */
  scanHz: 4,
  scanLimitS: 20,
  /** Rated reach: 8000 yd reflective, 2500 yd trees, 2000 yd deer. Nothing under 5 m (not published). */
  reachM: { reflective: 8000 * YD, trees: 2500 * YD, deer: 2000 * YD },
  minM: 5,
  /** After the first range of a power-up the screen drops the status lines (≈ 2 s); it turns off unused (30 s). */
  declutterS: 2,
  autoOffS: 30,
  splashS: 1,
  /** MODE held this long opens the menu; RANGE and MODE together this long open the hot keys. */
  menuHoldS: 1,
  hotHoldS: 3,
};

/** Pixels per mrad on the OLED (true angle). */
export const KILO_PX_PER_MRAD = KILO8K.oled.w / (KILO8K.oledSpan * ((KILO8K.fovDeg * Math.PI) / 180) * 1000);

/** Rays across a beam's footprint (mrad right, up from its centre): a 7 × 3 grid over its width and height. */
export function beamRays(beam: readonly [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 7; i++) out.push([((i - 3) / 6) * beam[0], ((j - 1) / 2) * beam[1]]);
  return out;
}
/** The KILO's beam, 1.25 × 0.25 mrad. */
export const BEAM_RAYS = beamRays(KILO8K.beamMrad);

/**
 * The armoury's plain laser rangefinder, a hunting-class unit: range and angle on its display and nothing else (no
 * solver, no menus, no target modes: it reports the strongest return). Its beam is wider and rounder than the
 * KILO's (2 × 1 mrad, typical of the class), so at 400 m a man fills only part of it and a rock behind him can win;
 * it reaches a person to about 640 m, answers in a third of a second, and is good to about ±1 m.
 */
export const PLAIN_LRF = {
  beamMrad: [2, 1] as const,
  responseS: 0.33,
  sigmaM: 0.5,
  reachM: { reflective: 1500 * YD, trees: 900 * YD, deer: 700 * YD },
  target: "BEST" as TargetMode,
};
export const PLAIN_RAYS = beamRays(PLAIN_LRF.beamMrad);

/** What one ray of the beam meets: its distance (m) and how well that surface sends the pulse back. */
export interface RayHit {
  m: number;
  kind: "person" | "rock" | "ground" | "none";
}
export type TargetMode = "FIRST" | "BEST" | "LAST" | "XR" | "FOG";

/**
 * The distance the receiver reports for one pulse, or null for no return. Rays that meet surfaces within 2 m of
 * each other are one return, as strong as the share of the beam on it; a return carries as far as the rated
 * reach for its kind (a person like a deer, rock and ground like trees) times the square root of that share (an
 * extended target's echo falls with the square of its distance). FIRST takes the nearest return, LAST (the
 * default) the farthest, BEST the strongest; XR samples four times, so reaches further, and FOG is LAST past
 * the first 100 m of haze.
 */
export function pickReturn(hits: RayHit[], mode: TargetMode, rated: { trees: number; deer: number } = KILO8K.reachM): number | null {
  const reach = { person: rated.deer, rock: rated.trees, ground: rated.trees, none: 0 };
  const sorted = hits.filter((h) => h.kind !== "none" && Number.isFinite(h.m)).sort((a, b) => a.m - b.m);
  const groups: { m: number; n: number; reach: number }[] = [];
  for (const h of sorted) {
    const g = groups[groups.length - 1];
    if (g && h.m - g.m < 2) {
      g.n++;
      g.reach = Math.max(g.reach, reach[h.kind]);
    } else groups.push({ m: h.m, n: 1, reach: reach[h.kind] });
  }
  const boost = mode === "XR" ? Math.SQRT2 : 1;
  const ok = groups.filter((g) => g.m >= KILO8K.minM && g.m <= g.reach * boost * Math.sqrt(g.n / hits.length) && !(mode === "FOG" && g.m < 100));
  if (!ok.length) return null;
  if (mode === "FIRST") return ok[0]!.m;
  if (mode === "BEST") return ok.reduce((a, b) => (b.n > a.n ? b : a)).m;
  return ok[ok.length - 1]!.m;
}

/** Accuracy: ±0.5 yd to 500 yd, ±1 yd to 1000 yd, ±2 yd beyond (taken as two standard deviations). */
export const rangeSigmaM = (m: number) => (m <= 500 * YD ? 0.5 : m <= 1000 * YD ? 1 : 2) * YD * 0.5;

/** The wind as the shooter sets it on the device: speed and the clock it blows from (3 = from the right). */
export interface KiloWind {
  mph: number;
  clock: number;
}
/** What the solver puts on the screen for one range. Holds in mil; wind hold positive to the right. */
export interface Solution {
  losM: number;
  slopeDeg: number;
  /** Angle-modified range: the level range that takes the same elevation (the "shoot-for" range). */
  amrM: number;
  elevMil: number;
  windMil: number;
  velMs: number;
  energyJ: number;
}

/**
 * Applied Ballistics Elite for the loaded profile: the elevation over the 100 m zero for the line-of-sight range
 * and the slope off the inclinometer, the wind hold for the wind set on the device (full value from its clock,
 * spin drift included), and the bullet's speed and energy there. Standard air.
 */
export function solveFiring(rf: Rifle, losM: number, slopeRad: number, wind: KiloWind): Solution {
  const r = ROUNDS[rf.round];
  const elev = solveElevationMil(rf, losM, slopeRad);
  // AMR: the level range whose come-up is that elevation.
  let lo = 0;
  let hi = losM * 1.2 + 50;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (holdRad(r, mid, BATTLE_ZERO_M, rf.sightM) * 1000 < elev) lo = mid;
    else hi = mid;
  }
  // Fly it with that hold in the set wind: where it crosses the target's plane, and how fast.
  const a = slopeRad;
  const ty = losM * Math.sin(a);
  const tz = -losM * Math.cos(a);
  const th = (wind.clock * Math.PI) / 6;
  const w: Vec3 = [-Math.sin(th) * wind.mph * MPH, 0, Math.cos(th) * wind.mph * MPH];
  const up = a + dialTiltRad(rf, 0) + elev / 1000;
  const p = fly({
    round: r,
    mv: r.mv,
    origin: [0, -rf.sightM * Math.cos(a), -rf.sightM * Math.sin(a)],
    dir: [0, Math.sin(up), -Math.cos(up)],
    wind: (_x, _y, _z, _t, out) => ((out[0] = w[0]), (out[1] = w[1]), (out[2] = w[2]), out),
    sg: millerStability(rf, r.mv),
    floor: 1e4,
  });
  const along = (q: Vec3) => (q[1] - ty) * Math.sin(a) - (q[2] - tz) * Math.cos(a);
  const h = firstHit(
    p,
    () => -1e9,
    (A, B) => (along(A) < 0 && along(B) >= 0 ? { f: -along(A) / (along(B) - along(A)), what: "plane" } : null),
  );
  const massKg = r.bulletGr * 6.479891e-5;
  return {
    losM,
    slopeDeg: (a * 180) / Math.PI,
    amrM: (lo + hi) / 2,
    elevMil: Math.max(0, elev),
    windMil: (-h.pos[0] / losM) * 1000,
    velMs: h.speed,
    energyJ: 0.5 * massKg * h.speed * h.speed,
  };
}

export type RangeMode = "BDX" | "AMR" | "LOS";
export type KiloReticle = "CIRCLE" | "DUPLEX" | "BOX" | "H-GRID" | "GRID";
export const BRIGHTNESS = ["AUTO", "L1", "L2", "L3", "M1", "M2", "M3", "H1", "H2", "H3"] as const;
export type Brightness = (typeof BRIGHTNESS)[number];
export interface KiloSettings {
  rangeMode: RangeMode;
  target: TargetMode;
  brightness: Brightness;
  reticle: KiloReticle;
  wind: KiloWind;
}
/** Out of the box: Applied Ballistics mode, LAST target, AUTO brightness, the circle, 5 mph full value. */
export const KILO_DEFAULTS: KiloSettings = { rangeMode: "BDX", target: "LAST", brightness: "AUTO", reticle: "CIRCLE", wind: { mph: 5, clock: 3 } };

/** The menu as the MODE button steps through it (Gen I order, trimmed to what the lab models), and the hot keys. */
const MENU = ["RANGE MODE", "TARGET", "BRIGHTNESS", "RETICLE", "EXIT"] as const;
const HOT = ["WIND SPEED", "WIND DIR"] as const;
const cycle = <T>(list: readonly T[], v: T) => list[(list.indexOf(v) + 1) % list.length]!;

/** One thing drawn on the OLED, in its pixels (origin top left, y down). */
export type OledOp = { k: "text"; s: string; x: number; y: number; size: number; align: "l" | "c" | "r" } | { k: "reticle"; style: KiloReticle } | { k: "battery"; x: number; y: number };

/** A measurement the host makes when the device fires its laser: what came back and the slope it read. */
export type Measure = () => { losM: number | null; slopeRad: number };

type Button = "range" | "mode";

/**
 * The device: its buttons, timers and screen. Times are seconds on one clock. `kind` "plain" makes it the plain
 * rangefinder (PLAIN_LRF): the same two buttons, a tap ranges and a hold scans, but no menus and only range and angle.
 */
export class Kilo {
  kind: "abs" | "plain" = "abs";
  settings: KiloSettings = { ...KILO_DEFAULTS, wind: { ...KILO_DEFAULTS.wind } };
  private on = false;
  private onAt = 0;
  private lastInput = -Infinity;
  private firstRangeAt = Infinity;
  private down: Record<Button, number | null> = { range: null, mode: null };
  /** A press used up by something else (waking it, a hold that opened a menu): its release does nothing. */
  private spent: Record<Button, boolean> = { range: false, mode: false };
  private due: number | null = null;
  private scanFrom: number | null = null;
  private nextScan = 0;
  private page: { list: "menu" | "hot"; i: number } | null = null;
  /** The last reading: a solution, or no return. */
  reading: { sol: Solution | null; at: number } | null = null;
  /** Called with each reading as it is made. */
  onReading: ((r: Solution | null) => void) | null = null;

  constructor(
    private rifle: Rifle,
    private measure: Measure,
  ) {}

  /** Loads the profile for the rifle as it is loaded; a reading for another profile no longer stands. */
  setRifle(rf: Rifle): void {
    if (rf.id !== this.rifle.id || rf.round !== this.rifle.round || rf.sightM !== this.rifle.sightM) this.reading = null;
    this.rifle = rf;
  }
  /** The profile's name on the status line: P1 and the load. */
  profile(): string {
    return `P1 ${this.rifle.round.toUpperCase()}`;
  }

  isOn(): boolean {
    return this.on;
  }
  isScanning(): boolean {
    return this.scanFrom !== null;
  }
  menuOpen(): boolean {
    return this.page !== null;
  }

  press(b: Button, t: number): void {
    this.update(t);
    if (this.down[b] !== null) return;
    this.down[b] = t;
    this.lastInput = t;
    this.spent[b] = false;
    if (!this.on) {
      // Either button wakes it; that press does nothing else.
      this.on = true;
      this.onAt = t;
      this.firstRangeAt = Infinity;
      this.reading = null;
      this.spent[b] = true;
      return;
    }
    if (t < this.onAt + KILO8K.splashS) {
      this.spent[b] = true;
      return;
    }
    if (this.page) {
      // In a menu RANGE changes the value at once; MODE acts on release (step) or hold (save and leave).
      if (b === "range") {
        this.change();
        this.spent.range = true;
      }
      return;
    }
    if (b === "range" && this.down.mode === null) {
      this.due = t + (this.kind === "plain" ? PLAIN_LRF.responseS : KILO8K.responseS);
    }
  }

  release(b: Button, t: number): void {
    this.update(t);
    const at = this.down[b];
    if (at === null) return;
    this.down[b] = null;
    this.lastInput = t;
    if (b === "range") this.scanFrom = null;
    if (this.spent[b]) return;
    if (this.page && b === "mode") this.step();
  }

  /** Advances the clocks: holds, scan readings, the laser's answer, the declutter and the power-off. */
  update(t: number): void {
    if (!this.on) return;
    const { range, mode } = this.down;
    const menus = this.kind === "abs";
    if (menus && range !== null && mode !== null && !this.spent.mode && t - Math.max(range, mode) >= KILO8K.hotHoldS) {
      this.page = { list: "hot", i: 0 };
      this.spent.range = this.spent.mode = true;
      this.due = null;
      this.scanFrom = null;
    } else if (menus && mode !== null && range === null && !this.spent.mode && t - mode >= KILO8K.menuHoldS) {
      if (this.page) this.page = null;
      else this.page = { list: "menu", i: 0 };
      this.spent.mode = true;
    }
    if (range !== null && mode === null && !this.page && !this.spent.range && this.scanFrom === null && t - range >= 0.5 && t - range < KILO8K.scanLimitS) {
      this.scanFrom = range;
      this.nextScan = t;
    }
    if (this.scanFrom !== null) {
      if (t - this.scanFrom >= KILO8K.scanLimitS) {
        this.scanFrom = null;
        this.spent.range = true;
      } else if (t >= this.nextScan) {
        const hz = this.settings.target === "XR" && this.kind === "abs" ? 1 : KILO8K.scanHz;
        this.nextScan += 1 / hz;
        this.take(t);
      }
    }
    if (this.due !== null && t >= this.due) {
      this.due = null;
      this.take(t);
    }
    if (range === null && mode === null && t - this.lastInput >= KILO8K.autoOffS) {
      this.on = false;
      this.page = null;
      this.scanFrom = null;
      this.due = null;
    }
  }

  private take(t: number): void {
    const m = this.measure();
    const sol = m.losM === null ? null : this.kind === "plain" ? rangeOnly(m.losM, m.slopeRad) : solveFiring(this.rifle, m.losM, m.slopeRad, this.settings.wind);
    this.reading = { sol, at: t };
    if (this.firstRangeAt === Infinity) this.firstRangeAt = t;
    this.onReading?.(sol);
  }

  private step(): void {
    const p = this.page!;
    const list = p.list === "menu" ? MENU : HOT;
    if (p.list === "menu" && list[p.i] === "EXIT") {
      this.page = null;
      return;
    }
    p.i = (p.i + 1) % list.length;
  }

  private change(): void {
    const s = this.settings;
    const p = this.page!;
    const item = (p.list === "menu" ? MENU : HOT)[p.i];
    if (item === "RANGE MODE") s.rangeMode = cycle(["BDX", "AMR", "LOS"] as const, s.rangeMode);
    else if (item === "TARGET") s.target = cycle(["FIRST", "BEST", "LAST", "XR", "FOG"] as const, s.target);
    else if (item === "BRIGHTNESS") s.brightness = cycle(BRIGHTNESS, s.brightness);
    else if (item === "RETICLE") s.reticle = cycle(["CIRCLE", "DUPLEX", "BOX", "H-GRID", "GRID"] as const, s.reticle);
    else if (item === "WIND SPEED") s.wind.mph = (s.wind.mph + 1) % 31;
    else if (item === "WIND DIR") s.wind.clock = (s.wind.clock % 12) + 1;
    else if (item === "EXIT") this.page = null;
  }

  /** Display brightness, 0 (off) to 1; AUTO reads its ambient sensor, which in daylight means bright. */
  level(): number {
    if (!this.on) return 0;
    const b = this.settings.brightness;
    return b === "AUTO" ? 0.85 : 0.25 + (0.75 * (BRIGHTNESS.indexOf(b) - 1)) / 8;
  }

  /**
   * What the OLED shows at `t`, in its pixels (304 × 256, centre 152,128). Documented: line-of-sight range upper
   * left, incline upper right, the angle-modified range centred under the reticle (in AMR or LOS mode only that
   * one range), the status lines until ≈ 2 s after the first range. Inferred from the KILO10K's Applied Ballistics
   * display: elevation with an arrow on the left, wind with an arrow on the right, speed and energy under them.
   * Not documented: the status lines' places, and no return (shown as dashes).
   */
  screen(t: number): OledOp[] {
    this.update(t);
    if (!this.on) return [];
    const ops: OledOp[] = [];
    const text = (s: string, x: number, y: number, size = 1, align: "l" | "c" | "r" = "l") => ops.push({ k: "text", s, x, y, size, align });
    if (t < this.onAt + KILO8K.splashS) {
      if (this.kind === "plain") {
        text("LRF", 152, 112, 3, "c");
        text("RANGE · ANGLE", 152, 146, 1, "c");
      } else {
        text("SIG SAUER", 152, 112, 3, "c");
        text("KILO8K-ABS", 152, 146, 1, "c");
      }
      return ops;
    }
    const s = this.settings;
    if (this.page) {
      const item = (this.page.list === "menu" ? MENU : HOT)[this.page.i]!;
      const value: Record<string, string> = {
        "RANGE MODE": s.rangeMode,
        TARGET: s.target,
        BRIGHTNESS: s.brightness,
        RETICLE: s.reticle,
        EXIT: "",
        "WIND SPEED": `${s.wind.mph} MPH`,
        "WIND DIR": `${s.wind.clock}:00`,
      };
      text(item, 152, 92, 2, "c");
      if (value[item]) text(value[item], 152, 124, 3, "c");
      return ops;
    }
    if (this.kind === "plain") return [...ops, ...this.plainScreen(t)];
    ops.push({ k: "reticle", style: s.reticle });
    if (t < this.firstRangeAt + KILO8K.declutterS) {
      ops.push({ k: "battery", x: 140, y: 14 });
      text(s.rangeMode, 56, 16);
      text(s.target, 248, 16, 1, "r");
      text(this.profile(), 56, 232);
      text(`${s.wind.mph}MPH ${s.wind.clock}:00`, 248, 232, 1, "r");
    }
    const r = this.reading;
    if (!r) return ops;
    const one = (m: number) => m.toFixed(1);
    if (!r.sol) {
      text("- - - -", 152, 150, 3, "c");
      return ops;
    }
    const sol = r.sol;
    if (s.rangeMode !== "BDX") {
      text(one(s.rangeMode === "AMR" ? sol.amrM : sol.losM), 152, 150, 3, "c");
      text("M", 152 + 52, 158, 1);
      return ops;
    }
    text("LOS", 34, 44);
    text(`${one(sol.losM)}M`, 34, 54, 2);
    const inc = Math.round(sol.slopeDeg);
    text("INC", 270, 44, 1, "r");
    text(`${inc > 0 ? "^" : inc < 0 ? "v" : ""}${Math.abs(inc)}*`, 270, 54, 2, "r");
    text(one(sol.amrM), 152, 150, 3, "c");
    text("M", 152 + 52, 158, 1);
    text("ELV MIL", 34, 106);
    text(`^${sol.elevMil.toFixed(1)}`, 34, 116, 2);
    const wd = sol.windMil;
    text("WND MIL", 270, 106, 1, "r");
    text(`${wd > 0.05 ? ">" : wd < -0.05 ? "<" : ""}${Math.abs(wd).toFixed(1)}`, 270, 116, 2, "r");
    text(`${Math.round(sol.velMs)} M/S`, 34, 196);
    text(`${Math.round(sol.energyJ)} J`, 270, 196, 1, "r");
    return ops;
  }

  /** The plain rangefinder's screen: a circle, the battery until the first range, then the range and the angle. */
  private plainScreen(t: number): OledOp[] {
    const ops: OledOp[] = [{ k: "reticle", style: "CIRCLE" }];
    const text = (s: string, x: number, y: number, size = 1, align: "l" | "c" | "r" = "l") => ops.push({ k: "text", s, x, y, size, align });
    if (t < this.firstRangeAt + KILO8K.declutterS) ops.push({ k: "battery", x: 140, y: 14 });
    const r = this.reading;
    if (!r) return ops;
    if (!r.sol) {
      text("- - - -", 152, 150, 3, "c");
      return ops;
    }
    text(r.sol.losM.toFixed(1), 152, 150, 3, "c");
    text("M", 152 + 52, 158, 1);
    const inc = Math.round(r.sol.slopeDeg);
    text(`${inc > 0 ? "^" : inc < 0 ? "v" : ""}${Math.abs(inc)}*`, 152, 196, 2, "c");
    return ops;
  }
}

/** What the plain rangefinder knows: the range and the angle. Everything a solver would add is left unknown. */
function rangeOnly(losM: number, slopeRad: number): Solution {
  return { losM, slopeDeg: (slopeRad * 180) / Math.PI, amrM: NaN, elevMil: NaN, windMil: NaN, velMs: NaN, energyJ: NaN };
}

/**
 * The hand on the device, prone with the elbows down and the eyecup against the brow: mostly slow wander under
 * 2 Hz, breathing, and a little physiological tremor near 10 Hz. Measured for binoculars held with the elbows
 * supported and a forehead rest: ≈ 0.5 mrad RMS on each axis (BirdForum gyro log), with tremor peaks at 6.5,
 * 9.8 and 10.9 Hz. Returns mrad (right, up).
 */
export function handShakeMrad(t: number): [number, number] {
  const x = 0.42 * Math.sin(t * 2.1 + 0.3) + 0.3 * Math.sin(t * 5.3 + 1.1) + 0.18 * Math.sin(t * 9.7) + 0.035 * Math.sin(t * 61.6) + 0.025 * Math.sin(t * 68.5 + 2);
  const y =
    0.3 * Math.sin(t * 1.7 + 2.2) + 0.28 * Math.sin(t * 4.6 + 0.4) + 0.25 * Math.sin(t * 1.57) + 0.16 * Math.sin(t * 8.9 + 1) + 0.03 * Math.sin(t * 40.8 + 1.3) + 0.03 * Math.sin(t * 61.6 + 0.7);
  return [x * 1.3, y * 1.35];
}
