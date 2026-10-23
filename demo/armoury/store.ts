/**
 * Where the career and the chosen loadout live between visits: localStorage, read back through Career.fromJSON and
 * decodeKit so nothing stored is trusted. If storage is unavailable (a private window, blocked site data) everything
 * still works for the visit, in memory, and `persistent` says so.
 */
import { Career } from "../../src/armoury/career";
import { ITEMS, MAX_SPOTTERS, SPOTTERS, type ItemId, type SpotterTier } from "../../src/armoury/catalogue";
import { carried, decodeKit, encodeKit, type Loadout, type SpotterHire } from "../../src/armoury/loadout";
import type { RifleId } from "../../src/scope/shot";

const CAREER_KEY = "scope-and-drop.career.v1";
const LOADOUT_KEY = "scope-and-drop.loadout.v1";
const RIFLE_IDS: RifleId[] = ["vss", "svd", "bolt"];

let memory: Record<string, string> = {};
export let persistent = true;

function read(key: string): unknown {
  try {
    const s = localStorage.getItem(key);
    return s === null ? null : JSON.parse(s);
  } catch {
    persistent = false;
    return memory[key] ? JSON.parse(memory[key]) : null;
  }
}
function write(key: string, value: unknown): void {
  const s = JSON.stringify(value);
  try {
    localStorage.setItem(key, s);
  } catch {
    persistent = false;
    memory = { ...memory, [key]: s };
  }
}

export const loadCareer = (): Career => Career.fromJSON(read(CAREER_KEY));
export const saveCareer = (c: Career): void => write(CAREER_KEY, c.toJSON());

/** What was last chosen: the rifle, a kit for each rifle, and the spotters hired. */
export interface Chosen {
  rifle: RifleId;
  kits: Record<RifleId, string>;
  spotters: SpotterHire[];
}

const clampNum = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);

/** The last choice, cleaned: unknown or unowned items dropped, spotters checked. */
export function loadChosen(owned?: ReadonlySet<ItemId>): Chosen {
  const o = (read(LOADOUT_KEY) ?? {}) as Partial<Record<keyof Chosen, unknown>>;
  const rifle = RIFLE_IDS.includes(o.rifle as RifleId) ? (o.rifle as RifleId) : "vss";
  const rawKits = (o.kits && typeof o.kits === "object" ? o.kits : {}) as Record<string, unknown>;
  const kits = {} as Record<RifleId, string>;
  for (const id of RIFLE_IDS) {
    const l = decodeKit(id, typeof rawKits[id] === "string" ? (rawKits[id] as string) : "");
    if (owned) for (const [slot, item] of Object.entries(l.items)) if (item && !owned.has(item)) delete l.items[slot as keyof typeof l.items];
    // A sleeve whose can was dropped goes too.
    if (l.items.muzzleExtra && !carried(l).includes(ITEMS[l.items.muzzleExtra].needs!)) delete l.items.muzzleExtra;
    kits[id] = encodeKit(l);
  }
  const spotters: SpotterHire[] = (Array.isArray(o.spotters) ? o.spotters : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && Object.hasOwn(SPOTTERS, (s as { tier: unknown }).tier as string))
    .slice(0, MAX_SPOTTERS)
    .map((s) =>
      s.place === "bearing"
        ? { tier: s.tier as SpotterTier, place: "bearing" as const, azDeg: clampNum(s.azDeg, -60, 60, 0), elDeg: clampNum(s.elDeg, 0, 25, 0) }
        : { tier: s.tier as SpotterTier, place: "beside" as const },
    );
  return { rifle, kits, spotters };
}

export const saveChosen = (c: Chosen): void => write(LOADOUT_KEY, c);

/** The loadout the mission takes: the chosen rifle, its kit and the spotters. */
export function chosenLoadout(c: Chosen): Loadout {
  const l = decodeKit(c.rifle, c.kits[c.rifle]);
  l.spotters = c.spotters.map((s) => ({ ...s }));
  return l;
}

/** Forgets the career and the choice: a fresh start. */
export function resetAll(): void {
  try {
    localStorage.removeItem(CAREER_KEY);
    localStorage.removeItem(LOADOUT_KEY);
  } catch {
    persistent = false;
  }
  memory = {};
}
