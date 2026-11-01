/**
 * A loadout made into what the mission plays with: the rifle as loaded (its round, precision, magazine, muzzle dust,
 * barrel), its recoil, its hold and how it swings on its rest, the stock's fit, the aids, the optic, the magazine's
 * geometry and the hide. The simulations read the rig where they read constants before; with nothing carried the
 * rig is the issued rifle on its pack, and `rigFor(l, { lab: true })` is the scope lab's rifle as it always was.
 */
import { TERMINAL } from "../body/wound";
import { ROUNDS, type RoundId } from "../scope/ballistics";
import { ACTIONS, MAG_VSS20, type MagGeom } from "../scope/handling";
import type { Report } from "../scope/can";
import { BAG, HOLD, LAB_REST, REST, cloneHold, muzzleSteadying, type HoldSpec, type RestKind, type RestSpec } from "../scope/hold";
import { GAS_THROUGH, scaleRecoil, type RecoilSpec } from "../scope/recoil";
import { RIFLES, type Rifle, type RifleId } from "../scope/shot";
import { ISSUED, ITEMS, type ItemEffects, type ItemId, type OpticId } from "./catalogue";
import { carried, emptyLoadout, type Loadout } from "./loadout";

const MOA = Math.PI / (180 * 60);

/**
 * Each load's precision with the rifle (σ per axis, MOA) and its muzzle-velocity spread (m/s). The issued loads keep
 * the lab's figures (shot.ts). The SP-6 is built for armour, not groups; the soft point is a hunting load; the
 * bonded round groups about 1 MOA; the subsonic about the same, and its speed spread is kept low (every m/s counts).
 */
export const PRECISION: Record<RoundId, { moa: number; mvSd: number }> = {
  "7n1": { moa: 0.4, mvSd: 8 },
  m118lr: { moa: 0.25, mvSd: 4 },
  sp5: { moa: 0.45, mvSd: 4 },
  sp6: { moa: 0.6, mvSd: 4 },
  "7n14": { moa: 0.4, mvSd: 8 },
  sb180sp: { moa: 0.5, mvSd: 10 },
  tbt168: { moa: 0.33, mvSd: 6 },
  sub200: { moa: 0.33, mvSd: 5 },
};

/** How the stock fits the shooter. 1 everywhere is the issued stock. */
export interface FitSpec {
  /** Scope-in: how far off the first stroke lands, and how long the move takes (× the issued). */
  adsError: number;
  adsPace: number;
  /** Head wander on the weld and the pan shadow (×). */
  wander: number;
  panLag: number;
  /** The spread of the hidden hold draw that varies each shot's recoil (×). */
  holdSpread: number;
}
const ISSUED_FIT: FitSpec = { adsError: 1, adsPace: 1, wander: 1, panLag: 1, holdSpread: 1 };
const RISER_FIT: FitSpec = { adsError: 0.5, adsPace: 0.85, wander: 0.5, panLag: 0.7, holdSpread: 0.6 };

export type { Report } from "../scope/can";

export interface Rig {
  loadout: Loadout;
  /** The rifle as loaded. `rifle.round` is the load in the magazine. */
  rifle: Rifle;
  /** The round the rifle's etched reticle and range drum are cut for. */
  issuedRound: RoundId;
  recoil: RecoilSpec;
  hold: HoldSpec;
  rest: RestSpec;
  restKind: RestKind | "lab";
  bag: boolean;
  fit: FitSpec;
  /** What is on the muzzle: a can (and its sleeve), a weight, and the mass out there (kg). */
  can: boolean;
  sleeve: boolean;
  muzzleKg: number;
  report: Report;
  /** The bullet stays below the speed of sound: no crack along its path, no trace to see. */
  subsonic: boolean;
  ranging: "none" | "plain" | "kilo";
  windMeter: boolean;
  optic: OpticId;
  mag: MagGeom;
  hide: boolean;
  /** Half the arc the hide's window lets the rifle cover (rad), or null for no limit. */
  arcRad: number | null;
}

const effectsOf = (l: Loadout): ItemEffects => Object.assign({}, ...carried(l).map((id: ItemId) => ITEMS[id].effects));

/**
 * The rig for a loadout. `lab` keeps the scope lab's own rest and hold, whatever the front rest. `tower` puts the
 * shooter on a tower's platform: seated behind the tripod if one is carried, otherwise on the railing (a bipod can't
 * be laid 30–55° down, and the lab's own bipod hold gives way to these too).
 */
export function rigFor(l: Loadout, opts: { lab?: boolean; tower?: boolean } = {}): Rig {
  const id = l.rifle;
  const base = RIFLES[id];
  const fx = effectsOf(l);
  const issuedRound = ISSUED[id].round;
  const round: RoundId = fx.round ?? issuedRound;
  const r = ROUNDS[round];
  const term = TERMINAL[round];
  const can = fx.muzzle?.kind === "can";
  const muzzleKg = fx.muzzle?.kg ?? 0;
  const mag = fx.mag20 && id === "vss" ? MAG_VSS20 : ACTIONS[id].mag;
  const subsonic = r.mv < 330;
  const fit = fx.fit ? RISER_FIT : ISSUED_FIT;

  const rifle: Rifle = {
    ...base,
    round,
    sigmaRad: PRECISION[round].moa * MOA,
    mvSd: PRECISION[round].mvSd,
    bulletLenMm: round === issuedRound ? base.bulletLenMm : term.lenM * 1000,
    bulletDiaMm: round === issuedRound ? base.bulletDiaMm : term.diaM * 1000,
    twistMm: fx.barrelTwistMm ?? base.twistMm,
    // Barrel time goes with the bullet's speed down the bore.
    barrelS: base.barrelS * (ROUNDS[issuedRound].mv / r.mv),
    magazine: mag.rounds,
    // A can catches the blast that lifts the dust; a subsonic load has little blast to begin with.
    blastDust: base.blastDust * (can ? 0.1 : 1) * (subsonic && id !== "vss" ? 0.6 : 1),
  };

  const gas = can ? GAS_THROUGH.can : GAS_THROUGH[id];
  const addedKg = muzzleKg + (fx.mag20 ? 0.35 : 0);
  const recoil = scaleRecoil(id, { round, gas, addedKg, muzzleKg, pad: !!fx.fit && id === "svd" });

  const restKind: RestKind = opts.tower ? (fx.rest === "tripod" ? "towerTripod" : "railing") : (fx.rest ?? "pack");
  const lab = !!opts.lab && !opts.tower;
  const hold = cloneHold(lab ? HOLD.harris : HOLD[restKind]);
  if (fx.bag) {
    hold.breath[1] *= 0.5;
    hold.wander[1] *= 0.7;
    hold.pulse *= 0.85;
  }
  if (fx.mag20) {
    hold.breath = [hold.breath[0] * 1.1, hold.breath[1] * 1.1];
    hold.wander = [hold.wander[0] * 1.1, hold.wander[1] * 1.1];
  }
  if (muzzleKg > 0) {
    const k = muzzleSteadying(muzzleKg);
    hold.pulse *= k;
    hold.tremor *= k;
  }
  const restBase = lab ? LAB_REST : REST[restKind];
  const rest: RestSpec = { ...restBase, panLag: restBase.panLag * fit.panLag, bag: fx.bag ? BAG : null, muzzleKg };

  const report: Report = id === "vss" ? "integral" : can ? (subsonic ? "can-sub" : "can") : "open";
  return {
    loadout: l,
    rifle,
    issuedRound,
    recoil,
    hold,
    rest,
    restKind: lab ? "lab" : restKind,
    bag: !!fx.bag,
    fit,
    can,
    sleeve: !!fx.sleeve && can,
    muzzleKg,
    report,
    subsonic,
    ranging: fx.ranging ?? "none",
    windMeter: !!fx.windMeter,
    optic: fx.optic ?? ISSUED[id].optic,
    mag,
    hide: !!fx.hide,
    arcRad: fx.hide ? (12 * Math.PI) / 180 : null,
  };
}

/** The issued rifle, nothing carried. */
export const issuedRig = (rifle: RifleId) => rigFor(emptyLoadout(rifle));
