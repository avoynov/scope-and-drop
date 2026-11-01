/**
 * The armoury's catalogue: what can be bought, what it costs, how much of the pay it takes when it is carried, and
 * what it does to the rifle, all as data. `rig.ts` turns a loadout into the rifle, recoil, hold and aids the
 * mission plays with; nothing here is code that touches the simulation.
 *
 * Prices are game euros, the item's street price × 4 (untraceable kit, bought through an armourer), so the real
 * ratios between items hold. Decay is the share of the pay an item takes each contract it is carried, used or not,
 * set by how much of the shot it does for you on that rifle: a rangefinder on the VSS, whose subsonic round makes
 * the range the whole shot, takes the most.
 *
 * Sources are retailer and maker pages found on 19–20 October 2026; prices move, so they are for ratios.
 */
import type { RoundId } from "../scope/ballistics";
import type { RestKind } from "../scope/hold";
import type { RifleId } from "../scope/shot";

/** One item a slot. */
export type Slot = "front" | "rear" | "stock" | "magazine" | "muzzle" | "muzzleExtra" | "shelter" | "wind" | "ranging" | "optic" | "ammo";
export const SLOTS: readonly Slot[] = ["front", "rear", "stock", "magazine", "muzzle", "muzzleExtra", "shelter", "wind", "ranging", "optic", "ammo"];
export const SLOT_NAMES: Record<Slot, string> = {
  front: "Front rest",
  rear: "Rear rest",
  stock: "Stock",
  magazine: "Magazine",
  muzzle: "Muzzle",
  muzzleExtra: "Muzzle extra",
  shelter: "Shelter",
  wind: "Wind",
  ranging: "Ranging",
  optic: "Optic",
  ammo: "Ammunition",
};

/** The reticles a rifle can carry: the issued one first. */
export type OpticId = "pso1" | "pso11" | "acss" | "pr2" | "ebr" | "tremor";

/** What an item does, read by rig.ts. */
export interface ItemEffects {
  /** The front rest it puts under the rifle. */
  rest?: Exclude<RestKind, "pack" | "towerTripod" | "railing">;
  /** A squeeze bag under the stock. */
  bag?: true;
  /** Cheek riser and soft butt pad. */
  fit?: true;
  /** The VSS's 20-round magazine. */
  mag20?: true;
  /** Out at the muzzle: a suppressor or a weight, and its mass (kg). */
  muzzle?: { kind: "can" | "weight"; kg: number };
  /** The can's mirage sleeve. */
  sleeve?: true;
  /** The one-man prone hide. */
  hide?: true;
  /** The Kestrel on its vane mount. */
  windMeter?: true;
  /** A laser rangefinder: range and angle only, or the KILO with its ballistic solver. */
  ranging?: "plain" | "kilo";
  optic?: OpticId;
  /** The round it loads, and for the subsonic package the barrel it comes with (twist, mm a turn). */
  round?: RoundId;
  barrelTwistMm?: number;
}

export interface Item {
  id: ItemId;
  slot: Slot;
  name: string;
  /** The real product it copies (or its class), for the card. */
  model: string;
  /** Street price (USD) and the game's price (€, street × 4). */
  streetUsd: number;
  price: number;
  /** Share of the pay it takes on each rifle it fits; null where it doesn't fit. */
  decay: Record<RifleId, number | null>;
  /** One line each: what it does and what it costs in the field. */
  does: string;
  costs: string;
  effects: ItemEffects;
  /** Another item it can only be carried with (the sleeve needs a can). */
  needs?: ItemId;
  source?: string;
}

export const MARKUP = 4;
/** Money in hand at the start of a career: about one grand contract's fee. */
export const START_BALANCE = 6000;
/** Owed to each hired spotter when the contract fails. */
export const RETAINER = 400;
/** The early-finish boost on a job done the moment the evening starts; nothing at the evening's end. */
export const EARLY_MAX = 0.5;
/** How sharply the early-finish boost bends: 0 is a straight line, higher is closer to 1/x (small late, climbing fast as the job gets earlier). */
export const EARLY_BEND = 1.5;

const all = (d: number) => ({ svd: d, bolt: d, vss: d });
const only = (r: Partial<Record<RifleId, number>>) => ({ svd: r.svd ?? null, bolt: r.bolt ?? null, vss: r.vss ?? null });

const ITEM_LIST = [
  {
    id: "harris",
    slot: "front",
    name: "Harris bipod",
    model: "Harris S-BRM 6–9\", 13 oz",
    streetUsd: 150,
    decay: all(0.05),
    does: "The lab's hold: breathing and tremor at two thirds of the pack's.",
    costs: "Past about 5° of swing the legs lift and re-settle: a jolt in the glass.",
    effects: { rest: "harris" },
    source: "https://shop.gohunt.com/products/harris-s-brm-6-to-9-inch-bipod",
  },
  {
    id: "atlas",
    slot: "front",
    name: "Atlas bipod",
    model: "B&T Atlas BT46, pan and cant 15° each way",
    streetUsd: 350,
    decay: all(0.07),
    does: "Holds like the Harris and pans without lifting: smooth swings, a steadier head.",
    costs: "Price only.",
    effects: { rest: "atlas" },
    source: "https://www.primaryarms.com/atlas-psr-standard-height-bipod-no-clamp-bt46-nc",
  },
  {
    id: "tripod",
    slot: "front",
    name: "Tripod with a saddle",
    model: "Leofoto-class shooting tripod and saddle",
    streetUsd: 600,
    decay: all(0.03),
    does: "The rest for the tower's steep shot down, where a bipod can't be laid.",
    costs: "2 kg, a slow pan through the saddle; on the ground it is worse than a bipod.",
    effects: { rest: "tripod" },
    source: "https://www.snipershide.com/shooting/goto/post?id=7529339",
  },
  {
    id: "bag",
    slot: "rear",
    name: "Squeeze bag",
    model: "Rabbit-ear squeeze bag, Protektor #13 or Wiebad class",
    streetUsd: 100,
    decay: all(0.05),
    does: "Vertical breathing sway halved; squeezing it nudges the aim in fine steps.",
    costs: "The stock takes a second to settle after a swing; past 6° it must be lifted.",
    effects: { bag: true },
    source: "https://www.grafs.com/catalog/product/productId/12828",
  },
  {
    id: "fit",
    slot: "stock",
    name: "Cheek riser and soft pad",
    model: "Strap-on cheek riser and recoil pad",
    streetUsd: 100,
    decay: only({ svd: 0.04, vss: 0.04 }),
    does: "The eye finds the eyebox first time; head wander halved; a steadier, more even hold.",
    costs: "None: the natural first buy.",
    effects: { fit: true },
  },
  {
    id: "mag20",
    slot: "magazine",
    name: "20-round magazine",
    model: "6L25, from the AS Val",
    streetUsd: 75,
    decay: only({ vss: 0.02 }),
    does: "20 rounds instead of 10.",
    costs: "The longer box sits the rifle higher on its rest (sway 1.1×), 0.35 kg more loaded.",
    effects: { mag20: true },
    source: "https://modernfirearms.net/en/sniper-rifles/standart-caliber-rifles/russia-standart-caliber-rifles/vss-eng/",
  },
  {
    id: "can",
    slot: "muzzle",
    name: "Suppressor",
    model: ".30-calibre can, about 0.5 kg",
    streetUsd: 1200,
    decay: only({ svd: 0.1, bolt: 0.1 }),
    does: "Report from about 160 to 130 dB; no muzzle-blast dust; softer kick.",
    costs: "Weight out front; a cold can's first shot strays; a hot can boils the view; the bullet still cracks.",
    effects: { muzzle: { kind: "can", kg: 0.5 } },
    source: "https://athlonoutdoors.com/article/silencerco-scythe-stm-suppressor/",
  },
  {
    id: "sleeve",
    slot: "muzzleExtra",
    name: "Mirage sleeve",
    model: "Suppressor cover",
    streetUsd: 40,
    decay: only({ svd: 0.01, bolt: 0.01 }),
    does: "Stops the hot can's mirage boiling up in front of the objective.",
    costs: "Nothing.",
    effects: { sleeve: true },
    needs: "can",
  },
  {
    id: "weight",
    slot: "muzzle",
    name: "Muzzle weight",
    model: "0.4 kg muzzle weight, behind the brake",
    streetUsd: 200,
    decay: only({ svd: 0.04, bolt: 0.04 }),
    does: "Softer recoil, a lower lasting rise, the heartbeat's twitch and tremor at 0.7×.",
    costs: "Swings start and stop slower: a fast drag overshoots and settles in about 0.4 s.",
    effects: { muzzle: { kind: "weight", kg: 0.4 } },
    source: "https://snipershide.com/shooting/threads/barrel-tuners-and-bryan-litz%E2%80%99s-vol-3.7196832",
  },
  {
    id: "hide",
    slot: "shelter",
    name: "One-man prone hide",
    model: "Low-window prone blind",
    streetUsd: 250,
    decay: all(0.03),
    does: "Wind at the hide down about 80%: the gusts barely buffet the rifle.",
    costs: "Its window fixes the arc you can cover: ±12° round the bearing.",
    effects: { hide: true },
    source: "https://patents.google.com/patent/US10865584",
  },
  {
    id: "kestrel",
    slot: "wind",
    name: "Kestrel wind meter",
    model: "Kestrel 5700 Elite with Applied Ballistics, on a vane mount",
    streetUsd: 760,
    decay: only({ vss: 0.08, svd: 0.05, bolt: 0.05 }),
    does: "The wind where you lie, and a hold for it at a range you set.",
    costs: "It reads the wind at the hide, not along the way; inside the hide, the hide's still air.",
    effects: { windMeter: true },
    source: "https://www.grafs.com/catalog/product/productId/98038",
  },
  {
    id: "lrf",
    slot: "ranging",
    name: "Laser rangefinder",
    model: "Plain laser rangefinder: range and angle",
    streetUsd: 300,
    decay: only({ vss: 0.12, svd: 0.05, bolt: 0.1 }),
    does: "Range to about ±1 m in a third of a second.",
    costs: "Head off the scope and both hands on it; through a window the frame can answer first.",
    effects: { ranging: "plain" },
  },
  {
    id: "kilo",
    slot: "ranging",
    name: "Sig KILO8K-ABS",
    model: "Sig Sauer KILO8K-ABS, Applied Ballistics Elite",
    streetUsd: 1499,
    decay: only({ vss: 0.18, svd: 0.08, bolt: 0.14 }),
    does: "Range, slope, the elevation hold and the wind hold for the loaded round.",
    costs: "As the plain one, plus menus; its wind hold is only as good as the wind you give it.",
    effects: { ranging: "kilo" },
    source: "https://cdn-fastly.thefirearmblog.com/blog/sig-sauer-releases-kilo-8k-abs-gen-ii-swg-rangefinder-44827909",
  },
  {
    id: "acss",
    slot: "optic",
    name: "ACSS-style scope (VSS)",
    model: "A modern scope with a BDC reticle cut for the SP-5, after Primary Arms' ACSS",
    streetUsd: 800,
    decay: only({ vss: 0.08 }),
    does: "Chevrons every 50 m with wind dots for 2 and 4 m/s, and shoulder-width ranging bars.",
    costs: "A busier picture; the finest marks fade at low power.",
    effects: { optic: "acss" },
    source: "https://www.primaryarms.com/rifle-scopes/with-acss",
  },
  {
    id: "ebr",
    slot: "optic",
    name: "Vortex EBR-7D (Sako)",
    model: "Vortex EBR-7D MRAD, in place of the issued PR2-MIL",
    streetUsd: 1500,
    decay: only({ bolt: 0.03 }),
    does: "Finer holds: 0.2 mil hashes and tree rows dotted every 0.2 mil.",
    costs: "Past 6 mil only a thin unlit ladder; the dots fade at low power.",
    effects: { optic: "ebr" },
  },
  {
    id: "tremor",
    slot: "optic",
    name: "TReMoR3-style grid (Sako)",
    model: "Horus TReMoR3 class: a 0.2 mil grid in a scope of about $3,500",
    streetUsd: 3500,
    decay: only({ bolt: 0.07 }),
    does: "Holds for elevation and wind straight off the grid, no dialling.",
    costs: "A dense grid that hides a small target.",
    effects: { optic: "tremor" },
  },
  {
    id: "sp6",
    slot: "ammo",
    name: "SP-6",
    model: "9×39 SP-6, hardened steel core",
    streetUsd: 200,
    decay: only({ vss: 0.04 }),
    does: "Keeps more speed and line through glass; subsonic, like the SP-5.",
    costs: "Built to pierce, not to wound; less precise than the SP-5.",
    effects: { round: "sp6" },
    source: "https://en.wikipedia.org/wiki/9%C3%9739mm",
  },
  {
    id: "7n14",
    slot: "ammo",
    name: "7N14",
    model: "7.62×54R 7N14, hardened steel core, 9.8 g at 830 m/s",
    streetUsd: 200,
    decay: only({ svd: 0.04 }),
    does: "Better through glass than the 7N1.",
    costs: "A narrow track that tumbles late.",
    effects: { round: "7n14" },
    source: "https://en.wikipedia.org/wiki/7.62%C3%9754mmR",
  },
  {
    id: "sb180sp",
    slot: "ammo",
    name: "S&B 180 gr soft point",
    model: "Sellier & Bellot 7.62×54R 180 gr SP (SB76254RB)",
    streetUsd: 150,
    decay: only({ svd: 0.04 }),
    does: "Expands in the body: the SVD's round for heavier wounds.",
    costs: "Poor through glass: the soft nose flattens on the pane and turns more.",
    effects: { round: "sb180sp" },
    source: "https://www.midwestgunworks.com/page/mgwi/prod/SB76254RB",
  },
  {
    id: "tbt168",
    slot: "ammo",
    name: "Bonded 168 gr",
    model: "Bonded barrier-blind .308, Federal Tactical Bonded Tip class",
    streetUsd: 250,
    decay: only({ bolt: 0.06 }),
    does: "Holds together through glass and turns less; expands in the body.",
    costs: "Groups about 1 MOA instead of 0.75.",
    effects: { round: "tbt168" },
    source: "https://gundigest.com/gear-ammo/reloading/handson-through-glass",
  },
  {
    id: "sub200",
    slot: "ammo",
    name: "Subsonic package",
    model: "A 1:9 barrel and Lapua's .308 Subsonic 200 gr",
    streetUsd: 1500,
    decay: only({ bolt: 0.06 }),
    does: "No crack; with a can, the quietest rifle in the armoury.",
    costs: "Drops nearly as far as the SP-5 and needs all new holds.",
    effects: { round: "sub200", barrelTwistMm: 228.6 },
    source: "https://lapua.com/product/308-win-subsonic-fmjbt-tactical-cartridge-13g-200gr-4317340",
  },
] as const satisfies readonly (Omit<Item, "id" | "price" | "needs"> & { id: string; needs?: string })[];

export type ItemId = (typeof ITEM_LIST)[number]["id"];
export const ITEMS: Record<ItemId, Item> = Object.fromEntries(ITEM_LIST.map((it) => [it.id, { ...it, price: it.streetUsd * MARKUP } as Item])) as Record<ItemId, Item>;
export const ITEM_IDS = ITEM_LIST.map((it) => it.id) as ItemId[];
export const isItemId = (s: string): s is ItemId => Object.hasOwn(ITEMS, s);

/** Whether an item goes on a rifle. */
export const fits = (id: ItemId, rifle: RifleId) => ITEMS[id].decay[rifle] !== null;

/** What each rifle comes with: free, and decaying nothing. */
export const ISSUED: Record<RifleId, { optic: OpticId; round: RoundId; muzzle: string; magazine: number; stock: string }> = {
  vss: { optic: "pso11", round: "sp5", muzzle: "Integral suppressor", magazine: 10, stock: "Skeleton stock" },
  svd: { optic: "pso1", round: "7n1", muzzle: "Slotted flash hider", magazine: 10, stock: "Skeleton stock with its cheek rest" },
  bolt: { optic: "pr2", round: "m118lr", muzzle: "Muzzle brake", magazine: 10, stock: "Adjustable cheek piece and length of pull" },
};

export type SpotterTier = "rookie" | "seasoned" | "veteran";
/** Spotters take a share of the pay instead of a price; at most two on one radio net. */
export const SPOTTERS: Record<SpotterTier, { share: number; notices: number; windError: number; delayS: [number, number] }> = {
  rookie: { share: 0.15, notices: 0.6, windError: 0.4, delayS: [3, 5] },
  seasoned: { share: 0.25, notices: 0.8, windError: 0.25, delayS: [2, 3] },
  veteran: { share: 0.35, notices: 0.95, windError: 0.15, delayS: [1, 2] },
};
export const MAX_SPOTTERS = 2;
