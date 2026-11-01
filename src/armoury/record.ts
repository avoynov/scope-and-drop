/**
 * The service record (armoury task 10): service marks for contracts settled, and medals re-struck in better material at
 * each threshold. Recognition only, never money. The game's own order with the same grammar as a real one: a real
 * decoration would pin a valour award on an assassination. Everything here reads the career's counters, never the
 * history, which keeps only 50 receipts.
 *
 * Also wear: kit gets slightly cheaper to carry with use.
 */
import type { ItemId } from "./catalogue";

export const MEDALS = {
  "clean-hands": { name: "Clean Hands", earnedBy: "A kill carrying only issued kit", at: [1, 10, 50, 100] },
  unbroken: { name: "Unbroken", earnedBy: "Clean contracts in a row", at: [10, 25, 100] },
  "first-look": { name: "First Look", earnedBy: "The spy shot before it tries its goal", at: [1, 5, 20, 50] },
  "glass-roof": { name: "Glass Roof", earnedBy: "A kill from above 45° through the hall's glass", at: [1, 20, 50] },
  "nobody-heard": { name: "Nobody Heard", earnedBy: "A kill no guest heard", at: [1, 5, 20, 70, 150, 350] },
  "second-bearing": { name: "Second Bearing", earnedBy: "The spy first named on the radio by an observer", at: [1] },
  "called-shot": { name: "Called Shot", earnedBy: "A miss, the spotter's correction, a hit with the next round", at: [1, 3] },
  gale: { name: "Gale", earnedBy: "A kill in wind over 8 m/s", at: [1, 10, 50, 100] },
  "one-breath": { name: "One Breath", earnedBy: "A hit within 3 s of scoping in", at: [1, 10, 50, 100] },
  "every-rifle": { name: "Every Rifle", earnedBy: "A kill with each rifle in each house size", at: [1] },
} as const satisfies Record<string, { name: string; earnedBy: string; at: readonly number[] }>;

export type MedalId = keyof typeof MEDALS;
export const MEDAL_IDS = Object.keys(MEDALS) as MedalId[];
export const isMedalId = (s: string): s is MedalId => Object.hasOwn(MEDALS, s);

/** The materials a medal is struck in, one per threshold. */
export const MATERIALS = ["tin", "bronze", "silver", "gold", "enamelled gold", "platinum"] as const;
export type Material = (typeof MATERIALS)[number];

/** How many of a medal's thresholds a count has passed (0: not earned). */
export const medalLevel = (id: MedalId, count: number): number => MEDALS[id].at.filter((t) => count >= t).length;

/** The material a medal is struck in at `count`, or null before its first threshold. */
export const medalMaterial = (id: MedalId, count: number): Material | null => {
  const l = medalLevel(id, count);
  return l ? MATERIALS[l - 1]! : null;
};

/** Service marks, by contracts settled; a title at 100 and at 1,000 (placeholder titles until the look is designed). */
export const SERVICE_MARKS = [10, 25, 50, 100, 250, 500, 1000] as const;
export const TITLES: Record<number, string> = { 100: "Old Hand", 1000: "The Long Arm" };

/** The highest service mark reached (0 before the first), and the title it carries, if any. */
export function serviceMark(contracts: number): { mark: number; title: string | null } {
  const mark = SERVICE_MARKS.filter((m) => contracts >= m).at(-1) ?? 0;
  const title = [1000, 100].find((t) => contracts >= t);
  return { mark, title: title ? TITLES[title]! : null };
}

/** Wear: at 10, 30 and 75 uses an item's decay drops by a tenth each time (to 0.729 of new). */
export const WEAR_AT = [10, 30, 75] as const;
export const WEAR_STEP = 0.9;
export const wearFactor = (uses: number): number => WEAR_STEP ** WEAR_AT.filter((n) => uses >= n).length;

/** What wear shows on the bench, in words. */
export function wearLook(id: ItemId, uses: number): string | null {
  const steps = WEAR_AT.filter((n) => uses >= n).length;
  if (!steps) return null;
  return ["Handled", "Worn in", "Well worn"][steps - 1]! + (id === "bag" ? ", the leather darkened" : id === "harris" || id === "atlas" ? ", the paint rubbed through" : "");
}
