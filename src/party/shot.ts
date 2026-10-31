/**
 * The shot heard (armoury task 8): who in the house hears a shot from the treeline, sound by sound. Three
 * sounds: the report at the muzzle, the crack along a supersonic bullet's path, and the strike where it lands
 * (and every pane it breaks on the way in). This is a query: it decides and returns who heard what, and writes
 * nothing into anyone's mind, so the evening runs on exactly as it would have. What they make of it is party
 * milestone 4. It uses the party's own sound model (senses.ts) but never senses.sound(), which turns heads.
 *
 * The numbers, and where they come from (docs/party.md, The shot heard, has the links):
 *  - The report, peak at 1 m to the side of the muzzle (MIL-STD-1474's position): an open .308 or 7.62×54R 165 dB
 *    (an unsuppressed .308 is 155–165 dB at the muzzle; an M4 164 dB, an AR-15 162–163 dB at 1 m), through a
 *    .30 can 135 (SilencerCo's Scythe on a 20" bolt rifle: 128.6–134.1 dB; Larson Davis: 164 to 136 dB, 28 dB
 *    off), the VSS 130 (Small Arms Defense Journal measured 129.7 dB with SP-5 at 1 m), and the Sako's subsonic
 *    package through a can 128 (the same small charge as the VSS's through a can). An open muzzle on a lighter
 *    charge is quieter by the cube root of the charge (Hopkinson–Cranz blast scaling): an open subsonic load
 *    about 161.
 *  - Outdoors: spherical spreading, −20·log₁₀(r), and air absorption, 0.005 dB/m (ISO 9613-1 at 1 kHz, 20 °C,
 *    70% humidity: 5 dB/km). The perch is 135–205 m out. A window on a side of the house turned away from the
 *    sound is in its shadow: 20 dB less, the ISO 9613-2 limit for sound bent over one edge. A glass roof or the
 *    dome's lantern stands above the roofs and is never in it.
 *  - Into a room, by its loudest opening: a shut window takes off Rw + Ctr, its weighted sound reduction index
 *    with the adaptation for low-pitched noise, since a report is mostly low notes. Single 4 mm glass, Rw 29
 *    (Ctr −3, EN 12758), in an old frame 25; a sealed 4-16-4 unit Rw 31 (Ctr −4, AGC): 27, so double glazing is
 *    barely better against a gunshot (its air gap resonates near 250 Hz); laminated 6.8 mm about 29, tempered
 *    6 mm 28. An open window, French window or archway takes off 10 (10 dB with 0.05 m² open, 13–15 partly open:
 *    Waters-Fuller and Lurcock). A drawn curtain 3 more (heavy curtains: 0–4 dB). A room with no opening to the
 *    outside hears through the house's walls, 45 down (Approved Document E asks 45 dB of a wall between homes).
 *    Windows are shut unless the shot names them open (they have no open state yet), French windows included.
 *    The terrace has no façade: it hears the sound where it stands.
 *  - The ear judges a short sound by its energy over about 0.2 s (temporal integration: thresholds rise
 *    10 dB per tenfold shortening below that), so each impulse is heard as a steady sound of its equal energy
 *    over 0.2 s. A report at the house lasts a few milliseconds with its echo off the ground: about 6 ms of its
 *    peak, so 15 dB down. A crack is an N-wave, Whitham's: peak Δp = 0.53·p₀·(M²−1)^⅛·d / (b^¾·l^¼) at b metres
 *    from the path, lasting T = 1.82·M·b^¼·d / (c·(M²−1)^⅜·l^¼), its energy Δp²·T/3. A 7.62 mm bullet at Mach 2
 *    gives 155 dB at 1 m (Larson Davis measured 152.6 dB beside a .308's path), falling 15 dB per tenfold
 *    distance (the ¾ power, as DuMond et al. measured), lasting about 0.2 ms at 10 m: 35 dB down. So a crack
 *    is heard a little less than the handover's 140 dB peak with the 15 dB step had it; but heard it is, past
 *    any can. Only where the bullet was supersonic: each point hears the shock shed where the bullet was
 *    b·√(M²−1) back along the path (the Mach cone), so it must have been flying faster than sound there.
 *    Outdoors that shock comes in through the windows as the report does; indoors, in the room it flies
 *    through, it is heard where it stands.
 *  - The strike, on the party's own scale (its breaking glass is 80): a body 80 dB at 1 m, a wall or a floor
 *    80, a pane breaking 80, carried through the room graph from where it struck (0.5 dB/m, an open door 6, a
 *    shut one 20, an arch 3, a stair 15), with no step: the party's sounds are steady levels already.
 *  - Heard when the level at the ear beats the room's noise by 6 dB (the party's rule) + 3·z + 6·tipsy, with z a
 *    standard normal drawn for each person and sound from the evening's shot stream, forked by the shot's time.
 *
 * Checked at 170 m: an open report reaches a garden window at 120 dB, 95 inside single glazing, 80 heard as a
 * steady sound: every garden-side room hears it, the dance floor about half the time (band 75 + 6). Through a
 * can 50 inside: only a quiet room with a window open. The subsonic package 43: almost nobody.
 */
import type { Vec3 } from "../mansion/core/geom";
import type { MansionBlueprint } from "../mansion/core/types";
import type { Rng } from "../mansion/core/rng";
import { AIR, at as flight, ROUNDS, type RoundId } from "../scope/ballistics";
import type { Report } from "../scope/can";
import { GLASS_BULLET, type GlazingId } from "../scope/glass";
import { CHARGE_G } from "../scope/recoil";
import type { Curtain } from "./world";
import type { RoomLevels, Senses } from "./senses";
import type { Person } from "./types";

/** The report, peak at 1 m beside the muzzle (dB). */
export const REPORT_DB: Record<Report, number> = { open: 165, can: 135, "can-sub": 128, integral: 130 };
/** A full-power .30 load's powder (g): an open muzzle's report goes with the cube root of the charge. */
const FULL_CHARGE_G = 3;
/** What a shut window takes off a gunshot (Rw + Ctr, dB), by the house's glass. */
export const GLAZING_DB: Record<GlazingId, number> = { single: 25, double: 27, laminated: 29, tempered: 28 };
/** An open window, French window or archway; no opening to the outside, the house's walls; a drawn curtain (dB). */
export const OPEN_DB = 10;
export const WALLS_DB = 45;
export const CURTAIN_DB = 3;
/** A window on a side turned away from the sound: the house's shadow (dB). */
export const SHADOW_DB = 20;
/** Air absorption (dB/m). */
const AIR_DB_M = 0.005;
/** The ear's integration time (s), and how long a report at the house lasts at its peak, energy for energy (s). */
const EAR_S = 0.2;
const REPORT_S = 0.0063;
/** A report heard as a steady sound: this far under its peak (dB). */
export const REPORT_STEP = 10 * Math.log10(EAR_S / REPORT_S);
/** The strike at 1 m: a body, a wall or a floor, a pane (dB, the party's scale). */
export const STRIKE_DB = 80;
/** Heard over the room's noise by the party's margin (dB), less sure by this much a standard deviation, and this much harder when drunk. */
const MASK = 6;
const Z_DB = 3;
const TIPSY_DB = 6;
/** Air at sea level (Pa) and the faintest sound (Pa). */
const P0 = 101325;
const P_REF = 2e-5;
/** Nearer the path than this (m), Whitham's far-field shock is taken at this distance. */
const NEAR_M = 1;
/** Ear height over the floor standing, sitting, lying (m). */
const EAR_STAND = 1.6;
const EAR_SIT = 1.2;
const EAR_LIE = 0.3;
/** Chest height over the floor, where the lab aims (m). */
export const CHEST = 1.3;

export type ShotSound = "report" | "crack" | "strike";
export const SHOT_SOUNDS: readonly ShotSound[] = ["report", "crack", "strike"];

/** A pane the bullet broke, or a door it went through: where, and the room behind it. */
export interface Pane {
  x: number;
  y: number;
  z: number;
  room: number;
  level: number;
}

/** A shot from the treeline, as the party hears it. */
export interface ShotIn {
  /** The muzzle (the perch's eye will do) and where the bullet stopped (world m). */
  from: Vec3;
  to: Vec3;
  /** The room it stopped in (-2 the terrace, -1 outdoors) and the storey. */
  room: number;
  level: number;
  /** What it struck there: someone, or a wall or the floor. */
  struck: "body" | "surface";
  /** Whom it struck (-1 nobody): they hear none of it. */
  hit: number;
  /** The panes it broke and the doors it went through on the way in. */
  panes: readonly Pane[];
  /** The muzzle and the load: an open muzzle, a can, a can on a subsonic load, the VSS's own. */
  report: Report;
  round: RoundId;
  /** The house's window glass (default single: old sash windows). */
  glazing?: GlazingId;
  /** Openings standing open, by id (default none: every window and French window shut). */
  open?: ReadonlySet<string>;
  /** The shot's number tonight, for its own draws when two go off in one step (default 0). */
  n?: number;
}

/** What reached one person's ear (dB heard as a steady sound, -Infinity none) and which sounds they heard. */
export interface Ear {
  db: Record<ShotSound, number>;
  heard: Record<ShotSound, boolean>;
}

export interface ShotHeard {
  /** By person id; null for anyone not there to hear: gone, not yet come, fallen, or the one struck. */
  ears: (Ear | null)[];
  /** Who heard each sound (ids, in order). */
  heard: Record<ShotSound, number[]>;
  /** How many heard a shot, the report or the crack (ShotReport.heardBy: the client's "Quiet job", the medal "Nobody Heard"). */
  heardBy: number;
  /** How many heard anything of it, the strike or a pane breaking near them included. */
  heardAny: number;
  /** The report at 1 m (dB peak), and whether the bullet left the muzzle faster than sound (it cracks along its path). */
  reportDb: number;
  cracked: boolean;
}

/** What the shot heard needs from the party. */
export interface ShotHost {
  readonly t: number;
  readonly bp: MansionBlueprint;
  readonly people: readonly Person[];
  readonly senses: Senses;
  readonly world: { readonly curtains: readonly Curtain[] };
  readonly shots: Rng;
}

// ------------------------------------------------------------------ the house

/** An opening to the outside: where it is, which way it faces, and what it is. */
interface Port {
  room: number;
  id: string;
  x: number;
  y: number;
  z: number;
  /** Outward normal in plan (0, 0 for glass overhead). */
  nx: number;
  nz: number;
  /** Glass overhead (a glass roof, the dome's lantern): never in the house's shadow. */
  up: boolean;
  kind: "glass" | "door" | "open";
}

/** A wall to the outside, for the bullet's way in. */
interface Shell {
  axis: "x" | "z";
  /** The wall's line (z for an x wall, x for a z wall), and its span along the other axis. */
  at: number;
  a: number;
  b: number;
  y0: number;
  y1: number;
  room: number;
  level: number;
  openings: { id: string; u0: number; u1: number; y0: number; y1: number; glazed: boolean; passable: boolean }[];
}

interface House {
  ports: Port[];
  /** Rooms with no opening to the outside. */
  bare: boolean[];
  shell: Shell[];
  /** The room whose air each room shares: the dome hall's, for its galleries; else its own. */
  space: Int32Array;
  hall: number;
}

const houses = new WeakMap<MansionBlueprint, House>();

function houseOf(bp: MansionBlueprint): House {
  const hit = houses.get(bp);
  if (hit) return hit;
  const byId = new Map(bp.rooms.map((r) => [r.id, r]));
  const ports: Port[] = [];
  const shell: Shell[] = [];
  for (const w of bp.walls) {
    if (!w.exterior) continue;
    const inside = w.neg ?? w.pos;
    const room = inside ? byId.get(inside) : undefined;
    if (!room) continue;
    // The outside face looks toward the side with no room (as world.ts reads it).
    const out = w.neg ? 1 : -1;
    const nx = w.axis === "z" ? out : 0;
    const nz = w.axis === "x" ? out : 0;
    const at = (u: number): { x: number; z: number } => (w.axis === "x" ? { x: w.a.x + u, z: w.a.z } : { x: w.a.x, z: w.a.z + u });
    for (const o of w.openings) {
      const p = at((o.u0 + o.u1) / 2);
      ports.push({ room: room.index, id: o.id, x: p.x, y: (o.y0 + o.y1) / 2, z: p.z, nx, nz, up: false, kind: o.kind === "arch" ? "open" : o.glazed ? "glass" : "door" });
    }
    // A conservatory's wall is glass from end to end.
    if (w.glazed) {
      const p = at(w.axis === "x" ? (w.b.x - w.a.x) / 2 : (w.b.z - w.a.z) / 2);
      ports.push({ room: room.index, id: `${w.id}:glass`, x: p.x, y: (w.y0 + w.y1) / 2, z: p.z, nx, nz, up: false, kind: "glass" });
    }
    shell.push({
      axis: w.axis,
      at: w.axis === "x" ? w.a.z : w.a.x,
      a: w.axis === "x" ? w.a.x : w.a.z,
      b: w.axis === "x" ? w.b.x : w.b.z,
      y0: w.y0,
      y1: w.y1,
      room: room.index,
      level: w.level,
      openings: w.openings.map((o) => ({ id: o.id, u0: o.u0, u1: o.u1, y0: o.y0, y1: o.y1, glazed: o.glazed || !!w.glazed, passable: o.passable })),
    });
  }
  // Glass overhead: a lantern or a glass roof over a top-storey room.
  for (const r of bp.rooms) {
    const s = r.skylight;
    if (s) ports.push({ room: r.index, id: `${r.id}:roof`, x: (s.x0 + s.x1) / 2, y: r.ceilingY, z: (s.z0 + s.z1) / 2, nx: 0, nz: 0, up: true, kind: "glass" });
  }
  // The dome hall: its glazed attic, drum and dome stand above the roofs, and its galleries share its air.
  const space = new Int32Array(bp.rooms.length + 1).map((_, i) => i);
  let hall = -1;
  const at = bp.atrium;
  const h = at ? byId.get(at.roomId) : undefined;
  if (at && h) {
    hall = h.index;
    for (const g of at.galleries) {
      const r = byId.get(g.roomId);
      if (r) space[r.index] = hall;
    }
    ports.push({ room: hall, id: `${h.id}:dome`, x: at.dome.x, y: (at.dome.deckY + at.dome.springY) / 2, z: at.dome.z, nx: 0, nz: 0, up: true, kind: "glass" });
  }
  const bare = bp.rooms.map((r) => !ports.some((p) => space[p.room] === space[r.index]));
  const house: House = { ports, bare, shell, space, hall };
  houses.set(bp, house);
  return house;
}

/** The room a point is in (-1 none: outdoors, or inside a wall). */
export function roomAt(bp: MansionBlueprint, x: number, y: number, z: number): number {
  for (const r of bp.rooms) {
    const i = r.inner;
    if (x >= i.x0 && x <= i.x1 && z >= i.z0 && z <= i.z1 && y >= r.floorY - 0.05 && y < r.ceilingY) return r.index;
  }
  return -1;
}

// ------------------------------------------------------------------- the sounds

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The report at 1 m (dB peak): an open muzzle by the load's charge. */
export function reportDb(report: Report, round: RoundId): number {
  return report === "open" ? REPORT_DB.open + (20 / 3) * Math.log10(CHARGE_G[round] / FULL_CHARGE_G) : REPORT_DB[report];
}

/** A point source outdoors at `r` metres: spreading and the air (dB). */
export const outdoors = (db1m: number, r: number): number => db1m - 20 * Math.log10(Math.max(1, r)) - AIR_DB_M * r;

/** The bullet's path: from the muzzle, its direction, length, and the load's speed along it. */
class Path {
  readonly ux: number;
  readonly uy: number;
  readonly uz: number;
  readonly len: number;
  /** Horizontal metres per metre along the path (the ballistics are tabled by horizontal range). */
  private readonly flat: number;

  constructor(
    readonly from: Vec3,
    to: Vec3,
    private readonly round: RoundId,
  ) {
    this.len = Math.max(1e-6, dist(from, to));
    this.ux = (to.x - from.x) / this.len;
    this.uy = (to.y - from.y) / this.len;
    this.uz = (to.z - from.z) / this.len;
    this.flat = Math.hypot(this.ux, this.uz);
  }

  point(s: number): Vec3 {
    return { x: this.from.x + this.ux * s, y: this.from.y + this.uy * s, z: this.from.z + this.uz * s };
  }

  /** The bullet's Mach number `s` metres out. */
  mach(s: number): number {
    return flight(ROUNDS[this.round], s * this.flat).v / AIR.sound;
  }

  /**
   * The crack at a point, heard as a steady sound (dB), and where along the path it was shed; null where no
   * shock reaches it (the bullet subsonic there, or the point off either end of its flight).
   */
  crackAt(p: Vec3): { db: number; s: number } | null {
    const rx = p.x - this.from.x;
    const ry = p.y - this.from.y;
    const rz = p.z - this.from.z;
    const s = rx * this.ux + ry * this.uy + rz * this.uz;
    const b = Math.max(NEAR_M, Math.hypot(rx - this.ux * s, ry - this.uy * s, rz - this.uz * s));
    let m = this.mach(Math.max(0, Math.min(this.len, s)));
    if (m <= 1) return null;
    // Shed where the bullet was b·cot θ back, θ the Mach angle (sin θ = 1/M): twice round, as M changes slowly.
    let se = s;
    for (let i = 0; i < 2; i++) {
      se = s - b * Math.sqrt(m * m - 1);
      if (se < 0 || se > this.len) return null;
      m = this.mach(se);
      if (m <= 1) return null;
    }
    return { db: nWave(this.round, m, b).db, s: se };
  }
}

/**
 * A bullet's shock at Mach `m`, `b` metres from its path (Whitham): its peak (dB), how long it lasts (s), and
 * how loud it is heard, as the steady sound of its energy over the ear's 0.2 s (dB).
 */
export function nWave(round: RoundId, m: number, b: number): { peak: number; T: number; db: number } {
  const { diaM: d, lenM: l } = GLASS_BULLET[round];
  const k = m * m - 1;
  const r = Math.max(NEAR_M, b);
  const dp = (0.53 * P0 * k ** 0.125 * d) / (r ** 0.75 * l ** 0.25);
  const T = (1.82 * m * r ** 0.25 * d) / (AIR.sound * k ** 0.375 * l ** 0.25);
  const peak = 20 * Math.log10(dp / P_REF);
  return { peak, T, db: peak + 10 * Math.log10(T / (3 * EAR_S)) };
}

/** Ear height over the floor. */
const earOf = (p: Person): Vec3 => ({ x: p.x, y: p.y + (p.pose === "sit" ? EAR_SIT : p.down ? EAR_LIE : EAR_STAND), z: p.z });

/** Not there to hear: gone, not come, fallen, dying or dead (feeling unwell still hears). */
const deaf = (p: Person): boolean => !p.present || p.gone || (!!p.down && p.down !== "ill");

/**
 * Who hears a shot, sound by sound: a query, which writes nothing into the evening. Each person's three draws
 * come from the evening's shot stream forked by the shot's time and number, so a shot heard twice is heard alike.
 */
export function hearShot(h: ShotHost, shot: ShotIn): ShotHeard {
  const { bp, senses } = h;
  const house = houseOf(bp);
  const R = bp.rooms.length + 1;
  const path = new Path(shot.from, shot.to, shot.round);
  const glass = GLAZING_DB[shot.glazing ?? "single"];
  const open = shot.open ?? NONE;
  const curtains = new Map(h.world.curtains.map((c) => [c.opening, c.state]));
  const loss = (p: Port): number => (p.kind === "open" || open.has(p.id) ? OPEN_DB : glass + (curtains.get(p.id) === "drawn" ? CURTAIN_DB : 0));
  // Turned away from the sound's source: in the house's shadow.
  const shadow = (p: Port, src: Vec3): number => (p.up || (src.x - p.x) * p.nx + (src.z - p.z) * p.nz >= 0 ? 0 : SHADOW_DB);
  const indoors = (s: number): boolean => {
    const q = path.point(s);
    return roomAt(bp, q.x, q.y, q.z) >= 0;
  };
  const rep = reportDb(shot.report, shot.round);
  const heardAs = rep - REPORT_STEP;

  // Into each room through its loudest opening (or its walls), then on through the house.
  const seed = (): RoomLevels => ({ level: new Float32Array(R).fill(-Infinity), ex: new Float32Array(R), ez: new Float32Array(R) });
  const put = (lv: RoomLevels, room: number, db: number, x: number, z: number): void => {
    if (db <= lv.level[room]!) return;
    lv.level[room] = db;
    lv.ex[room] = x;
    lv.ez[room] = z;
  };
  /** The dome hall's galleries hear what comes in anywhere in its air; then on through the house. */
  const carry = (lv: RoomLevels): RoomLevels => {
    if (house.hall >= 0) {
      for (let i = 0; i < R - 1; i++) if (house.space[i] === house.hall && i !== house.hall) put(lv, house.hall, lv.level[i]!, lv.ex[i]!, lv.ez[i]!);
      for (let i = 0; i < R - 1; i++) if (house.space[i] === house.hall && i !== house.hall) put(lv, i, lv.level[house.hall]!, lv.ex[house.hall]!, lv.ez[house.hall]!);
    }
    return senses.spread(lv.level, lv.ex, lv.ez);
  };
  /** A sound made outdoors at `src`, `db1m` at 1 m (heard as a steady sound), into every room. */
  const fromOutside = (src: Vec3, db1m: number): RoomLevels => {
    const lv = seed();
    for (const p of house.ports) put(lv, p.room, outdoors(db1m, dist(src, p)) - shadow(p, src) - loss(p), p.x, p.z);
    bp.rooms.forEach((r, i) => {
      if (!house.bare[i]) return;
      const c = { x: (r.inner.x0 + r.inner.x1) / 2, y: r.floorY + EAR_STAND, z: (r.inner.z0 + r.inner.z1) / 2 };
      put(lv, i, outdoors(db1m, dist(src, c)) - WALLS_DB, c.x, c.z);
    });
    return carry(lv);
  };

  // The report.
  const report = fromOutside(shot.from, heardAs);

  // The crack: in through the windows where it was shed outdoors.
  const cracked = path.mach(0) > 1;
  const crack = seed();
  if (cracked) {
    for (const p of house.ports) {
      const c = path.crackAt(p);
      if (!c || indoors(c.s)) continue;
      put(crack, p.room, c.db - shadow(p, path.point(c.s)) - loss(p), p.x, p.z);
    }
    carry(crack);
  }

  // The strike where it stopped, and every pane on the way in.
  const strikes: RoomLevels[] = [];
  const outdoorStrike = shot.room === -1;
  if (outdoorStrike) strikes.push(fromOutside(shot.to, STRIKE_DB));
  else strikes.push(senses.levels({ kind: shot.struck === "body" ? "thud" : "breaking-glass", level: shot.level, x: shot.to.x, z: shot.to.z, room: shot.room, source: -1, ref: -1 }, STRIKE_DB));
  for (const q of shot.panes) strikes.push(senses.levels({ kind: "breaking-glass", level: q.level, x: q.x, z: q.z, room: q.room, source: -1, ref: -1 }, STRIKE_DB));

  const rng = h.shots.fork(`${Math.round(h.t * 2)}:${shot.n ?? 0}`);
  const ears: (Ear | null)[] = [];
  const heard: Record<ShotSound, number[]> = { report: [], crack: [], strike: [] };
  let heardBy = 0;
  let heardAny = 0;
  for (const p of h.people) {
    // Every person's draws are made, there or not, so nobody's depend on anyone else's.
    const z: Record<ShotSound, number> = { report: rng.normal(0, 1), crack: rng.normal(0, 1), strike: rng.normal(0, 1) };
    if (deaf(p) || p.id === shot.hit) {
      ears.push(null);
      continue;
    }
    const ear = earOf(p);
    // Between rooms (a doorway), the room they stand in by the plan; else outdoors.
    const room = p.room === -1 ? roomAt(bp, ear.x, ear.y, ear.z) : p.room;
    const at = { x: p.x, z: p.z, room };
    const db: Record<ShotSound, number> = { report: -Infinity, crack: -Infinity, strike: -Infinity };
    const c = cracked ? path.crackAt(ear) : null;
    if (room < 0) {
      // Outdoors (the terrace): no façade, the sound where they stand.
      db.report = outdoors(heardAs, dist(shot.from, ear));
      if (c && !indoors(c.s)) db.crack = c.db;
      if (outdoorStrike) db.strike = outdoors(STRIKE_DB, dist(shot.to, ear));
    } else {
      db.report = senses.levelIn(report, at);
      db.crack = senses.levelIn(crack, at);
      // In the room the bullet flies through, the shock shed in that room's own air.
      if (c) {
        const q = path.point(c.s);
        const r = roomAt(bp, q.x, q.y, q.z);
        if (r >= 0 && house.space[r] === house.space[room]) db.crack = Math.max(db.crack, c.db);
      }
    }
    for (const lv of strikes) db.strike = Math.max(db.strike, senses.levelIn(lv, at));
    const over = senses.noiseIn(room) + MASK + TIPSY_DB * p.tipsy;
    const got = { report: false, crack: false, strike: false };
    for (const k of SHOT_SOUNDS) {
      got[k] = db[k] > over + Z_DB * z[k];
      if (got[k]) heard[k].push(p.id);
    }
    if (got.report || got.crack) heardBy++;
    if (got.report || got.crack || got.strike) heardAny++;
    ears.push({ db, heard: got });
  }
  return { ears, heard, heardBy, heardAny, reportDb: rep, cracked };
}

const NONE: ReadonlySet<string> = new Set();

// ------------------------------------------------------------- a straight shot

/**
 * A shot along a straight line from the muzzle to a point (the lab's stand-in until the mission passes its real
 * path; drop doesn't matter for hearing): through the panes and doors of the house's outer walls in its way, and
 * stopped by the first solid wall. Interior partitions are left out.
 */
export function straightShot(
  h: { readonly bp: MansionBlueprint; readonly people: readonly Person[] },
  from: Vec3,
  aim: { x: number; y: number; z: number; room: number; level: number; who: number },
  kit: { report: Report; round: RoundId; glazing?: GlazingId; open?: ReadonlySet<string> },
): ShotIn & { blocked: boolean } {
  const house = houseOf(h.bp);
  const open = kit.open ?? NONE;
  const dx = aim.x - from.x;
  const dy = aim.y - from.y;
  const dz = aim.z - from.z;
  const crossings: { f: number; pane: Pane | null }[] = [];
  for (const w of house.shell) {
    // Where the line crosses the wall's plane, and whether it does so within the wall.
    const d = w.axis === "x" ? dz : dx;
    if (Math.abs(d) < 1e-9) continue;
    const f = (w.at - (w.axis === "x" ? from.z : from.x)) / d;
    if (f <= 0 || f >= 1) continue;
    const u = (w.axis === "x" ? from.x + dx * f : from.z + dz * f) - w.a;
    const y = from.y + dy * f;
    if (u < 0 || u > w.b - w.a || y < w.y0 || y >= w.y1) continue;
    const o = w.openings.find((q) => u >= q.u0 && u <= q.u1 && y >= q.y0 && y <= q.y1);
    const x = from.x + dx * f;
    const z = from.z + dz * f;
    if (!o) crossings.push({ f, pane: null });
    else if (o.glazed && !open.has(o.id)) crossings.push({ f, pane: { x, y, z, room: w.room, level: w.level } });
    else if (!o.glazed && o.passable && !open.has(o.id)) crossings.push({ f, pane: { x, y, z, room: w.room, level: w.level } });
  }
  crossings.sort((a, b) => a.f - b.f);
  const panes: Pane[] = [];
  for (const c of crossings) {
    if (c.pane) {
      panes.push(c.pane);
      continue;
    }
    // A solid wall: the bullet stops in it, on the outside face.
    const to = { x: from.x + dx * c.f, y: from.y + dy * c.f, z: from.z + dz * c.f };
    return { from, to, room: -1, level: aim.level, struck: "surface", hit: -1, panes, ...kit, blocked: true };
  }
  return { from, to: { x: aim.x, y: aim.y, z: aim.z }, room: aim.room, level: aim.level, struck: aim.who >= 0 ? "body" : "surface", hit: aim.who, panes, ...kit, blocked: false };
}

/** Aim at a person's chest. */
export const chestOf = (p: Person): { x: number; y: number; z: number; room: number; level: number; who: number } => ({ x: p.x, y: p.y + CHEST, z: p.z, room: p.room, level: p.level, who: p.id });
