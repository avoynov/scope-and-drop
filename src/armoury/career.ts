/**
 * A career: the money in hand, the kit owned (for good once bought), and the receipts of past contracts.
 * Plain data in and out (`toJSON` / `Career.fromJSON`), so it can live in localStorage now and on a server later;
 * whatever comes back from storage is checked, never trusted.
 *
 * Pay for a contract: fee × result × the loadout's kit factor, then each spotter's share of that. A failed contract
 * (result 0) pays nothing and still owes each spotter a retainer. The receipt has a line for each item: what its
 * decay cost tonight. Decay multiplies, so how the total splits between items is shared out by each item's
 * ln(1 − decay), which is fair whatever the order and sums to the total exactly.
 */
import { ITEMS, RETAINER, SPOTTERS, START_BALANCE, isItemId, type ItemId, type SpotterTier } from "./catalogue";
import { carried, checkLoadout, kitFactor, type Loadout } from "./loadout";

export interface Contract {
  /** What the client pays for a clean job (€). */
  fee: number;
  label?: string;
}

export interface ContractResult {
  /** 1 the spy killed, 0.6 downed, 0.2 wounded and gone, 0 failed (the pay formula's R, coded later). */
  factor: number;
  label: string;
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
  /** One line per carried item, then one per spotter (share or retainer). */
  kit: ReceiptLine[];
  spotters: ReceiptLine[];
  /** What was paid in (can be negative: a failure's retainers). */
  total: number;
  /** Carried but never touched: what each cost tonight, to teach a leaner loadout. */
  unused: ReceiptLine[];
  balanceAfter: number;
}

export interface CareerData {
  v: 1;
  balance: number;
  owned: ItemId[];
  history: Receipt[];
}

const round = (x: number) => Math.round(x);

/** A contract settled: the receipt, with nothing changed yet (`Career.settle` books it). */
export function settleContract(contract: Contract, result: ContractResult, loadout: Loadout, touched?: ReadonlySet<ItemId>, balance = 0): Receipt {
  const gross = contract.fee * Math.max(0, result.factor);
  const items = carried(loadout);
  const kf = kitFactor(loadout);
  const afterKit = gross * kf;
  const logs = items.map((id) => Math.log(1 - (ITEMS[id].decay[loadout.rifle] ?? 0)));
  const logSum = logs.reduce((a, b) => a + b, 0);
  const kitCost = gross - afterKit;
  const kit = items.map((id, i) => ({ label: ITEMS[id].name, amount: -round(logSum < 0 ? (kitCost * logs[i]!) / logSum : 0) }));
  const failed = gross <= 0;
  const spotters = loadout.spotters.map((s) => {
    const name = `${s.tier[0]!.toUpperCase()}${s.tier.slice(1)} spotter`;
    return failed ? { label: `${name}: retainer`, amount: -RETAINER } : { label: `${name}: ${Math.round(SPOTTERS[s.tier].share * 100)}%`, amount: -round(afterKit * SPOTTERS[s.tier].share) };
  });
  // The total is worked out once and the lines rounded to it, so they always add up.
  const total = round(gross) + kit.reduce((s, l) => s + l.amount, 0) + spotters.reduce((s, l) => s + l.amount, 0);
  const unused = touched ? items.filter((id) => !touched.has(id)).map((id) => ({ label: `${ITEMS[id].name}: carried, never used`, amount: kit[items.indexOf(id)]!.amount })) : [];
  return { contract: contract.label ?? "Contract", result: result.label, fee: contract.fee, gross: round(gross), kit, spotters, total, unused, balanceAfter: balance + total };
}

export class Career {
  balance: number;
  readonly owned: Set<ItemId>;
  readonly history: Receipt[];

  constructor(data?: Partial<CareerData>) {
    this.balance = data?.balance ?? START_BALANCE;
    this.owned = new Set(data?.owned ?? []);
    this.history = [...(data?.history ?? [])];
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

  /** Settles a contract taken with `loadout` and books the pay. Throws if the loadout can't be taken. */
  settle(contract: Contract, result: ContractResult, loadout: Loadout, touched?: ReadonlySet<ItemId>): Receipt {
    const problems = checkLoadout(loadout, this.owned);
    if (problems.length) throw new Error(`Loadout can't be taken: ${problems.map((p) => p.why).join("; ")}`);
    const r = settleContract(contract, result, loadout, touched, this.balance);
    this.balance = r.balanceAfter;
    this.history.unshift(r);
    if (this.history.length > 50) this.history.length = 50;
    return r;
  }

  toJSON(): CareerData {
    return { v: 1, balance: this.balance, owned: [...this.owned], history: this.history };
  }

  /** A career from stored data. Anything malformed is dropped; nothing unknown is let in. */
  static fromJSON(raw: unknown): Career {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (o.v !== 1) return new Career();
    const balance = typeof o.balance === "number" && Number.isFinite(o.balance) ? Math.round(o.balance) : START_BALANCE;
    const owned = Array.isArray(o.owned) ? o.owned.filter((x): x is ItemId => typeof x === "string" && isItemId(x)) : [];
    const history = Array.isArray(o.history) ? (o.history.filter((r) => r && typeof r === "object" && typeof (r as Receipt).total === "number") as Receipt[]).slice(0, 50) : [];
    return new Career({ balance, owned, history });
  }
}

/** The spotters' tiers, for menus. */
export const SPOTTER_TIERS = Object.keys(SPOTTERS) as SpotterTier[];
