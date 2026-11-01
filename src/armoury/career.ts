/**
 * A career: the money in hand, the kit owned (for good once bought), and the receipts of past contracts.
 * Plain data in and out (`toJSON` / `Career.fromJSON`), so it can live in localStorage now and on a server later;
 * whatever comes back from storage is checked, never trusted.
 *
 * Pay for a contract, in this order: the fee × the grade's multiplier × (1 + the client terms' premiums), then × the result R,
 * then × the early-finish boost, then × the safety margin's factor, then × the loadout's kit factor (kit the dossier calls
 * for decays at half rate), then less each spotter's share of that. (Grades and terms are 1 for now: task 10 fills them
 * in.) A failed contract
 * (result 0) pays nothing and still owes each spotter a retainer. The receipt has a line for each item: what its
 * decay cost tonight. Decay multiplies, so how the total splits between items is shared out by each item's
 * ln(1 − decay), which is fair whatever the order and sums to the total exactly.
 */
import { PARTY_LENGTH } from "../party/clock";
import { EARLY_BEND, EARLY_MAX, ITEMS, RETAINER, SPOTTERS, START_BALANCE, isItemId, type ItemId, type SpotterTier } from "./catalogue";
import { carried, checkLoadout, kitFactor, type Loadout } from "./loadout";
import { afterContract, freshMargin, MARGIN, usedInWords, type MarginState } from "./margin";
import type { ShotReport } from "./report";
import type { RifleId } from "../scope/shot";

export interface Contract {
  /** What the client pays for a clean job (€). */
  fee: number;
  label?: string;
  /** The kit the dossier calls for: it decays at half rate on this contract. */
  calledFor?: readonly ItemId[];
}

export interface ContractResult {
  /** 1 the spy killed, 0.6 downed, 0.2 wounded and gone, 0 failed (the pay formula's R, coded later). */
  factor: number;
  label: string;
  /** When the job was done, in in-game seconds after the evening started (the party clock). Left out: no boost. */
  doneAt?: number;
  /**
   * The safety margin, when a margin hit counted (task 11): the largest share of the margin used among the contract's
   * margin hits at the spy, and how far wide of the torso that shot passed (cm). Pay × (1 − k·used).
   */
  margin?: { used: number; wideCm: number; spy?: "him" | "her" };
}

export interface ReceiptLine {
  label: string;
  /** Euros: negative for what came off the pay. */
  amount: number;
}

export interface Receipt {
  contract: string;
  result: string;
  fee: number;
  /** Fee × result. */
  gross: number;
  /** The boost for finishing before the evening's end (never negative); kit and spotters come off the boosted pay. Absent on older receipts. */
  early?: ReceiptLine;
  /** What a margin hit took off: "Counted as a hit: 14 cm wide of him, half the margin used, pay ×0.83". Absent on a clean hit. */
  margin?: ReceiptLine;
  /** One line per carried item, then one per spotter (share or retainer). */
  kit: ReceiptLine[];
  spotters: ReceiptLine[];
  /** What was paid in (can be negative: a failure's retainers). */
  total: number;
  /** Carried but never touched: what each cost tonight, to teach a leaner loadout. */
  unused: ReceiptLine[];
  balanceAfter: number;
}

/** The service record's medals (task 10). Each counts what earned it; the medal's material comes from its thresholds. */
export const MEDAL_IDS = ["clean-hands", "unbroken", "first-look", "glass-roof", "nobody-heard", "second-bearing", "called-shot", "gale", "one-breath", "every-rifle"] as const;
export type MedalId = (typeof MEDAL_IDS)[number];
const isMedalId = (s: string): s is MedalId => (MEDAL_IDS as readonly string[]).includes(s);

/**
 * A career as stored (version 2). Everything v1 had (balance, kit owned, the last 50 receipts) plus counters that outlive
 * the history, since medals and service marks must never be counted by scanning it.
 */
export interface CareerData {
  v: 2;
  balance: number;
  owned: ItemId[];
  history: Receipt[];
  /** Contracts settled, ever. */
  contracts: number;
  /** The unbroken run of clean contracts that sets the broker's grade (a margin hit holds it). */
  streak: number;
  /** Clean contracts in a row for the Unbroken medal (a margin hit doesn't add to it). */
  cleanInRow: number;
  medals: Record<MedalId, number>;
  /** Contracts on which each item was carried and used (wear). */
  uses: Partial<Record<ItemId, number>>;
  /** The safety margin (task 11), mrad. */
  margin: MarginState;
}

const noMedals = (): Record<MedalId, number> => Object.fromEntries(MEDAL_IDS.map((m) => [m, 0])) as Record<MedalId, number>;

const round = (x: number) => Math.round(x);

/**
 * The early-finish boost, as a fraction of the pay: EARLY_MAX for a job done as the evening starts, 0 at its end. In between a
 * softened 1/x: with f the share of the evening left, EARLY_MAX × f / (1 + EARLY_BEND × (1 − f)). Small for a job done late,
 * climbing faster the earlier it is done. Never below 0, whatever the clock says.
 */
export function earlyBoost(doneAt: number | undefined, evening = PARTY_LENGTH): number {
  if (doneAt === undefined || !Number.isFinite(doneAt) || evening <= 0) return 0;
  const left = Math.max(0, Math.min(evening, evening - doneAt));
  const f = left / evening;
  return (EARLY_MAX * f) / (1 + EARLY_BEND * (1 - f));
}

/** "Done 1 h 30 min before the evening's end", "Done 40 min before the evening's end". */
function earlyLabel(secondsLeft: number): string {
  const m = Math.round(secondsLeft / 60);
  const hrs = Math.floor(m / 60);
  const min = m % 60;
  return `Done ${hrs ? `${hrs} h ${min ? `${min} min ` : ""}` : `${min} min `}before the evening's end`;
}

/** A contract settled: the receipt, with nothing changed yet (`Career.settle` books it). */
export function settleContract(contract: Contract, result: ContractResult, loadout: Loadout, touched?: ReadonlySet<ItemId>, balance = 0): Receipt {
  // Task 10's grade and client terms: 1 until they land.
  const gradeMult = 1;
  const termPremiums = 0;
  const used = result.margin ? Math.max(0, Math.min(1, result.margin.used)) : 0;
  const marginFactor = 1 - MARGIN.k * used;
  const fee = contract.fee * gradeMult * (1 + termPremiums);
  const gross = fee * Math.max(0, result.factor);
  // A failed job earns no boost.
  const boost = gross > 0 ? earlyBoost(result.doneAt) : 0;
  const bonus = round(gross * boost);
  const boosted = round(gross) + bonus;
  const afterMargin = boosted * marginFactor;
  const items = carried(loadout);
  const kf = kitFactor(loadout, new Set(contract.calledFor ?? []));
  const afterKit = afterMargin * kf;
  const logs = items.map((id) => Math.log(1 - (ITEMS[id].decay[loadout.rifle] ?? 0)));
  const logSum = logs.reduce((a, b) => a + b, 0);
  const kitCost = afterMargin - afterKit;
  const kit = items.map((id, i) => ({ label: ITEMS[id].name, amount: -round(logSum < 0 ? (kitCost * logs[i]!) / logSum : 0) }));
  const failed = gross <= 0;
  const spotters = loadout.spotters.map((s) => {
    const name = `${s.tier[0]!.toUpperCase()}${s.tier.slice(1)} spotter`;
    return failed ? { label: `${name}: retainer`, amount: -RETAINER } : { label: `${name}: ${Math.round(SPOTTERS[s.tier].share * 100)}%`, amount: -round(afterKit * SPOTTERS[s.tier].share) };
  });
  // The total is worked out once and the lines rounded to it, so they always add up.
  const marginCut = -round(boosted - afterMargin);
  const total = boosted + marginCut + kit.reduce((s, l) => s + l.amount, 0) + spotters.reduce((s, l) => s + l.amount, 0);
  const unused = touched ? items.filter((id) => !touched.has(id)).map((id) => ({ label: `${ITEMS[id].name}: carried, never used`, amount: kit[items.indexOf(id)]!.amount })) : [];
  const early = bonus > 0 ? { label: `${earlyLabel(PARTY_LENGTH - (result.doneAt ?? PARTY_LENGTH))}: +${Math.round(boost * 100)}%`, amount: bonus } : undefined;
  return {
    contract: contract.label ?? "Contract",
    result: result.label,
    fee: contract.fee,
    gross: round(gross),
    ...(early ? { early } : {}),
    ...(result.margin && gross > 0
      ? {
          margin: {
            label: `Counted as a hit: ${Math.round(result.margin.wideCm)} cm wide of ${result.margin.spy ?? "him"}, ${usedInWords(used)} used, pay ×${marginFactor.toFixed(2)}`,
            amount: marginCut,
          },
        }
      : {}),
    kit,
    spotters,
    total,
    unused,
    balanceAfter: balance + total,
  };
}

export class Career {
  balance: number;
  readonly owned: Set<ItemId>;
  readonly history: Receipt[];
  contracts: number;
  streak: number;
  cleanInRow: number;
  readonly medals: Record<MedalId, number>;
  readonly uses: Partial<Record<ItemId, number>>;
  margin: MarginState;

  constructor(data?: Partial<Omit<CareerData, "v">>) {
    this.balance = data?.balance ?? START_BALANCE;
    this.owned = new Set(data?.owned ?? []);
    this.history = [...(data?.history ?? [])];
    this.contracts = data?.contracts ?? 0;
    this.streak = data?.streak ?? 0;
    this.cleanInRow = data?.cleanInRow ?? 0;
    this.medals = { ...noMedals(), ...data?.medals };
    this.uses = { ...data?.uses };
    const m = data?.margin ?? freshMargin();
    this.margin = { ...m, rifle: { ...m.rifle } };
  }

  /** Whether an item can be bought now, and why not. */
  canBuy(id: ItemId): { ok: boolean; why?: string } {
    if (!isItemId(id)) return { ok: false, why: "no such item" };
    if (this.owned.has(id)) return { ok: false, why: "already owned" };
    if (this.balance < ITEMS[id].price) return { ok: false, why: `€${(ITEMS[id].price - this.balance).toLocaleString("en-GB")} short` };
    return { ok: true };
  }

  /** Buys an item for good. Throws if it can't be bought. */
  buy(id: ItemId): void {
    const c = this.canBuy(id);
    if (!c.ok) throw new Error(`Can't buy ${id}: ${c.why}`);
    this.balance -= ITEMS[id].price;
    this.owned.add(id);
  }

  /**
   * Settles a contract taken with `loadout` and books the pay. Counts the contract and a use of each item touched (each
   * item carried when `touched` isn't given). Throws if the loadout can't be taken.
   */
  settle(contract: Contract, result: ContractResult, loadout: Loadout, touched?: ReadonlySet<ItemId>): Receipt {
    const problems = checkLoadout(loadout, this.owned);
    if (problems.length) throw new Error(`Loadout can't be taken: ${problems.map((p) => p.why).join("; ")}`);
    const r = settleContract(contract, result, loadout, touched, this.balance);
    this.balance = r.balanceAfter;
    this.history.unshift(r);
    if (this.history.length > 50) this.history.length = 50;
    this.contracts++;
    for (const id of carried(loadout)) if (!touched || touched.has(id)) this.uses[id] = (this.uses[id] ?? 0) + 1;
    return r;
  }

  /**
   * The safety margin after a contract with `rifle`, from its first shot at the spy (null when it had none: the margin
   * stays as it was). `endedAt` is the contract's end (ISO), never read from the clock.
   */
  updateMargin(rifle: RifleId, firstShotAtSpy: Pick<ShotReport, "kind" | "fromChestMrad" | "rangeM"> | null, endedAt: string): void {
    this.margin = afterContract(this.margin, rifle, firstShotAtSpy, endedAt);
  }

  toJSON(): CareerData {
    return {
      v: 2,
      balance: this.balance,
      owned: [...this.owned],
      history: this.history,
      contracts: this.contracts,
      streak: this.streak,
      cleanInRow: this.cleanInRow,
      medals: { ...this.medals },
      uses: { ...this.uses },
      margin: { ...this.margin, rifle: { ...this.margin.rifle } },
    };
  }

  /**
   * A career from stored data: version 2 as it is, version 1 upgraded (counters at 0, contracts = the receipts kept, the
   * margin at its starting sizes), anything else a fresh start. Anything malformed is dropped; nothing unknown is let in.
   */
  static fromJSON(raw: unknown): Career {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (o.v !== 1 && o.v !== 2) return new Career();
    const balance = typeof o.balance === "number" && Number.isFinite(o.balance) ? Math.round(o.balance) : START_BALANCE;
    const owned = Array.isArray(o.owned) ? o.owned.filter((x): x is ItemId => typeof x === "string" && isItemId(x)) : [];
    const history = Array.isArray(o.history) ? (o.history.filter((r) => r && typeof r === "object" && typeof (r as Receipt).total === "number") as Receipt[]).slice(0, 50) : [];
    // Version 1 (balance, owned, history) upgraded: no counters yet, and the receipts kept are the contracts known.
    if (o.v === 1) return new Career({ balance, owned, history, contracts: history.length });
    const count = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
    const record = (x: unknown) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
    const medals = noMedals();
    for (const [k, n] of Object.entries(record(o.medals))) if (isMedalId(k)) medals[k] = count(n);
    const uses: Partial<Record<ItemId, number>> = {};
    for (const [k, n] of Object.entries(record(o.uses))) if (isItemId(k) && count(n)) uses[k] = count(n);
    return new Career({
      balance,
      owned,
      history,
      contracts: Math.max(count(o.contracts), history.length),
      streak: count(o.streak),
      cleanInRow: count(o.cleanInRow),
      medals,
      uses,
      margin: marginFromJSON(o.margin),
    });
  }
}

/** A stored margin, checked: each part a finite number in [0, its starting size]; anything missing at its start. */
function marginFromJSON(raw: unknown): MarginState {
  const m = freshMargin();
  if (!raw || typeof raw !== "object") return m;
  const o = raw as Record<string, unknown>;
  const part = (x: unknown, max: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(max, x)) : d);
  m.career = part(o.career, MARGIN.career0, m.career);
  const rifle = (o.rifle && typeof o.rifle === "object" ? o.rifle : {}) as Record<string, unknown>;
  for (const id of Object.keys(m.rifle) as (keyof MarginState["rifle"])[]) m.rifle[id] = part(rifle[id], MARGIN.rifle0, m.rifle[id]);
  m.missesInRow = typeof o.missesInRow === "number" && Number.isFinite(o.missesInRow) && o.missesInRow > 0 ? Math.floor(o.missesInRow) : 0;
  m.lastContractAt = typeof o.lastContractAt === "string" && !Number.isNaN(Date.parse(o.lastContractAt)) ? o.lastContractAt : null;
  return m;
}

/** The spotters' tiers, for menus. */
export const SPOTTER_TIERS = Object.keys(SPOTTERS) as SpotterTier[];
