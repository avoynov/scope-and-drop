/**
 * A loadout: the rifle, at most one item in each slot, and up to two spotters. `checkLoadout` says what is wrong
 * with one; `payFactor` is what the pay meter shows: the product of every carried item's (1 − decay), then less
 * the spotters' shares.
 */
import type { RifleId } from "../scope/shot";
import { ITEMS, MAX_SPOTTERS, SPOTTERS, fits, isItemId, type ItemId, type Slot, type SpotterTier } from "./catalogue";

export interface SpotterHire {
  tier: SpotterTier;
  /** Beside you (wind, range and shot calls), or on another bearing on the perch arc (an observer). */
  place: "beside" | "bearing";
  /** An observer's bearing off the garden axis (deg), on the treeline arc (±PERCH_ARC_DEG) at ground level. */
  azDeg?: number;
}

export interface Loadout {
  rifle: RifleId;
  items: Partial<Record<Slot, ItemId>>;
  spotters: SpotterHire[];
}

export const emptyLoadout = (rifle: RifleId): Loadout => ({ rifle, items: {}, spotters: [] });

/** The items carried, in slot order. */
export const carried = (l: Loadout): ItemId[] => Object.values(l.items).filter((x): x is ItemId => !!x);

export interface LoadoutProblem {
  item?: ItemId;
  why: string;
}

/**
 * Everything wrong with a loadout: an item in the wrong slot, one that doesn't fit the rifle, one not owned (when
 * `owned` is given), a sleeve with no can, too many spotters. An empty list means it can be taken.
 */
export function checkLoadout(l: Loadout, owned?: ReadonlySet<ItemId>): LoadoutProblem[] {
  const out: LoadoutProblem[] = [];
  for (const [slot, id] of Object.entries(l.items) as [Slot, ItemId | undefined][]) {
    if (!id) continue;
    if (!isItemId(id)) {
      out.push({ why: `unknown item "${String(id)}"` });
      continue;
    }
    const it = ITEMS[id];
    if (it.slot !== slot) out.push({ item: id, why: `${it.name} goes in the ${it.slot} slot, not ${slot}` });
    if (!fits(id, l.rifle)) out.push({ item: id, why: `${it.name} doesn't fit the ${l.rifle}` });
    if (owned && !owned.has(id)) out.push({ item: id, why: `${it.name} isn't owned` });
    if (it.needs && !carried(l).includes(it.needs)) out.push({ item: id, why: `${it.name} needs the ${ITEMS[it.needs].name.toLowerCase()}` });
  }
  if (l.spotters.length > MAX_SPOTTERS) out.push({ why: `at most ${MAX_SPOTTERS} spotters` });
  for (const s of l.spotters) if (!Object.hasOwn(SPOTTERS, s.tier)) out.push({ why: `unknown spotter tier "${String(s.tier)}"` });
  return out;
}

/** Product of (1 − decay) over the carried items, before spotters. Items the dossier calls for decay at half rate. */
export function kitFactor(l: Loadout, calledFor: ReadonlySet<ItemId> = new Set()): number {
  let f = 1;
  for (const id of carried(l)) {
    const d = ITEMS[id].decay[l.rifle];
    if (d === null) continue;
    f *= 1 - d * (calledFor.has(id) ? 0.5 : 1);
  }
  return f;
}

/** The spotters' combined share (0–1). */
export const spotterShare = (l: Loadout): number => l.spotters.reduce((s, h) => s + SPOTTERS[h.tier].share, 0);

/** What the pay meter shows: the fee is multiplied by this (before the contract's result). */
export const payFactor = (l: Loadout, calledFor?: ReadonlySet<ItemId>): number => kitFactor(l, calledFor) * Math.max(0, 1 - spotterShare(l));

/**
 * A loadout as a URL parameter, `kit=atlas,bag,kilo`, and back. Unknown ids, ones that don't fit the rifle and a
 * second item for a slot already taken are dropped, so a hand-edited URL never breaks the lab.
 */
export const encodeKit = (l: Loadout): string => carried(l).join(",");
export function decodeKit(rifle: RifleId, kit: string | null | undefined): Loadout {
  const l = emptyLoadout(rifle);
  for (const raw of (kit ?? "").split(",")) {
    const id = raw.trim().toLowerCase();
    if (!isItemId(id) || !fits(id, rifle)) continue;
    const slot = ITEMS[id].slot;
    if (!l.items[slot]) l.items[slot] = id;
  }
  // A sleeve with no can to go on is left behind.
  if (l.items.muzzleExtra && !carried(l).includes(ITEMS[l.items.muzzleExtra].needs!)) delete l.items.muzzleExtra;
  return l;
}
