/**
 * The dossier (armoury task 10): what the broker shows before a contract is accepted. The forecast, the house, how much
 * of the party floor the treeline sees, the grade (from the streak) and any client terms, each with its premium and the
 * kit it calls for. Kit called for decays at half rate on that contract (`kitFactor`'s calledFor).
 *
 * A higher grade is a different house and crowd, never a harder shot: the grade multiplies the fee and nothing else.
 * Fees are placeholders until the kit sweep has numbers to show the user.
 */
import { Rng } from "../mansion/core/rng";
import type { ItemId } from "./catalogue";
import { GRADES, type ClientTerm, type Grade, type HouseSize, type MissionReport } from "./report";

/** The broker's grade for a streak of clean contracts: routine 0–2, priority 3–5, critical 6–9, named 10 and up. */
export function gradeFor(streak: number): Grade {
  if (streak >= 10) return "named";
  if (streak >= 6) return "critical";
  if (streak >= 3) return "priority";
  return "routine";
}

/** The fee multiplier of each grade. */
export const GRADE_MULT: Record<Grade, number> = { routine: 1, priority: 1.2, critical: 1.35, named: 1.5 };

/** One grade up (the broker's sale), never past named. */
export const gradeAbove = (g: Grade): Grade => GRADES[Math.min(GRADES.length - 1, GRADES.indexOf(g) + 1)]!;

/** The client's fee for a clean job at routine grade, by house (€; placeholders until the sweep). */
export const BASE_FEE: Record<HouseSize, number> = { small: 5000, grand: 6000, palatial: 7500 };

export interface TermSpec {
  name: string;
  /** What the client wants, as the dossier says it. */
  wants: string;
  /** Added to the fee: fee × grade × (1 + Σ premiums). */
  premium: number;
  /** Kit the term calls for (half decay on this contract). */
  calledFor: ItemId[];
  /** What else helps, in words (rifles, spotters, observers). */
  helps: string;
}

/** The client terms (planning doc, "Special contracts"). */
export const TERMS: Record<ClientTerm, TermSpec> = {
  quiet: {
    name: "Quiet job",
    wants: "Nobody hears the shot; each guest who does takes 10% off the fee, at most half",
    premium: 0.3,
    calledFor: ["can", "sub200"],
    helps: "The VSS, a can, subsonic rounds",
  },
  glass: { name: "Through the glass", wants: "The spy keeps to rooms behind laminated or double glazing", premium: 0.2, calledFor: ["sp6", "7n14", "tbt168"], helps: "SP-6, 7N14 or the bonded .308" },
  "one-round": {
    name: "One round",
    wants: "Only the first shot counts; a miss or a non-fatal wound fails",
    premium: 0.4,
    calledFor: ["harris", "atlas", "bag", "lrf", "kilo"],
    helps: "A rest and bag, a rangefinder, a spotter beside you",
  },
  storm: { name: "Storm", wants: "A gale is forecast: 8–14 m/s, gusting", premium: 0.25, calledFor: ["hide", "kestrel"], helps: "The hide, the Kestrel, a spotter's wind calls" },
  blind: { name: "Blind house", wants: "The treeline sees under a quarter of the party floor", premium: 0.2, calledFor: ["tripod"], helps: "An observer; the tower and the tripod" },
  "before-deed": { name: "Before the deed", wants: "The spy must die before it tries its goal", premium: 0.3, calledFor: [], helps: "Observers, and time on the scope" },
  confirmed: { name: "Confirmed", wants: "The body must be seen to fall and stay down", premium: 0.1, calledFor: [], helps: "A spotter who reads wounds" },
};

export interface Forecast {
  /** Mean wind at 3 m (m/s) and its gusts. */
  windMs: number;
  gustMs: number;
  rain: "none" | "light" | "heavy";
  fog: "none" | "mist" | "fog";
  /** Sunset, minutes after 19:00 (negative: before). */
  sunsetMin: number;
  /** How dark it is by 21:00. */
  darkBy21: "light" | "dusk" | "dark";
}

export interface Dossier {
  seed: string;
  house: HouseSize;
  /** Share of the party floor the treeline sees (0–1). */
  treelineSees: number;
  /** The house has a glass roof (the orangery's, the dome hall's). */
  glassRoof: boolean;
  forecast: Forecast;
  grade: Grade;
  terms: ClientTerm[];
  /** fee × grade × (1 + Σ premiums), €. */
  fee: number;
  /** Every item the terms call for. */
  calledFor: ItemId[];
}

export interface DossierOptions {
  seed: string;
  /** The streak at stake; the grade comes from it (one above it when bought from the broker). */
  streak: number;
  brokered?: boolean;
  /** From the mansion, when the house is known; otherwise drawn. */
  house?: HouseSize;
  treelineSees?: number;
  glassRoof?: boolean;
}

/** A contract's dossier, drawn from its seed: the same seed gives the same dossier. */
export function makeDossier(o: DossierOptions): Dossier {
  const rng = new Rng(`dossier:${o.seed}`);
  const house = o.house ?? rng.pick(["small", "grand", "palatial"] as const);
  const treelineSees = o.treelineSees ?? Math.round(rng.range(0.15, 0.7) * 100) / 100;
  const glassRoof = o.glassRoof ?? rng.chance(0.35);
  // The weather first: a gale is what makes a storm contract.
  const gale = rng.chance(0.12);
  const windMs = Math.round((gale ? rng.range(8, 14) : rng.range(0, 7)) * 10) / 10;
  const gustMs = Math.round(windMs * rng.range(1.3, 1.7) * 10) / 10;
  const rain = rng.chance(0.7) ? "none" : rng.chance(0.7) ? "light" : "heavy";
  const fog = rng.chance(0.8) ? "none" : rng.chance(0.6) ? "mist" : "fog";
  const sunsetMin = Math.round(rng.range(-150, 140) / 5) * 5;
  // Civil dusk lasts about 35 min at mid-latitudes.
  const darkBy21 = sunsetMin + 35 <= 120 ? "dark" : sunsetMin <= 120 ? "dusk" : "light";
  const forecast: Forecast = { windMs, gustMs, rain, fog, sunsetMin, darkBy21 };

  // The terms the evening allows, then up to two of them, about half of contracts carrying one or more.
  const possible: ClientTerm[] = ["quiet", "glass", "one-round", "before-deed", "confirmed"];
  if (gale) possible.push("storm");
  if (glassRoof && treelineSees < 0.25) possible.push("blind");
  const terms: ClientTerm[] = [];
  if (gale) terms.push("storm");
  if (possible.includes("blind") && rng.chance(0.6)) terms.push("blind");
  const extra = rng.chance(0.5) ? (rng.chance(0.3) ? 2 : 1) : 0;
  for (let i = 0; i < extra && terms.length < 2; i++) {
    const left = possible.filter((t) => !terms.includes(t));
    if (left.length) terms.push(rng.pick(left));
  }
  const base = gradeFor(Math.max(0, o.streak));
  const grade = o.brokered ? gradeAbove(base) : base;
  return { seed: o.seed, house, treelineSees, glassRoof, forecast, grade, terms, fee: feeFor(BASE_FEE[house], grade, terms), calledFor: calledFor(terms) };
}

/** fee × grade multiplier × (1 + Σ term premiums), to the euro. */
export const feeFor = (base: number, grade: Grade, terms: readonly ClientTerm[]): number => Math.round(base * GRADE_MULT[grade] * (1 + terms.reduce((s, t) => s + TERMS[t].premium, 0)));

/** Every item the terms call for, once each. */
export const calledFor = (terms: readonly ClientTerm[]): ItemId[] => [...new Set(terms.flatMap((t) => TERMS[t].calledFor))];

/** What the terms make of a finished contract: the result factor after "One round", and what's lost from the fee. */
export interface TermsOutcome {
  /** The result factor once the terms are applied (One round fails a miss or a non-fatal first shot). */
  factor: number;
  /** Premiums forfeited (their share of the fee): Before the deed if the spy tried its goal, Confirmed if not seen down. */
  forfeited: ClientTerm[];
  /** Quiet job: share of the fee taken off, 10% per guest who heard, at most 50%. */
  quietCut: number;
  /** Guests who heard (the loudest shot's count: the report gives no names, so this is the least it can be). */
  heard: number;
}

export function judgeTerms(r: Pick<MissionReport, "contract" | "shots" | "result" | "spyTriedGoal" | "confirmedDown">): TermsOutcome {
  const terms = r.contract.terms;
  let factor = r.result.factor;
  if (terms.includes("one-round")) {
    const first = r.shots[0];
    if (!first || first.at !== "spy" || first.kind === "miss" || first.outcome !== "killed") factor = 0;
  }
  const forfeited: ClientTerm[] = [];
  if (terms.includes("before-deed") && r.spyTriedGoal) forfeited.push("before-deed");
  if (terms.includes("confirmed") && !r.confirmedDown) forfeited.push("confirmed");
  const heard = r.shots.reduce((m, s) => Math.max(m, s.heardBy), 0);
  const quietCut = terms.includes("quiet") ? Math.min(0.5, 0.1 * heard) : 0;
  return { factor, forfeited, quietCut, heard };
}
