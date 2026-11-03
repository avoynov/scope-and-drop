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
import { BROKER_PRICE, EARLY_BEND, EARLY_MAX, FINISHES, FIXER_PRICE, ITEMS, RETAINER, SPOTTERS, START_BALANCE, isFinishId, isItemId, type FinishId, type ItemId, type SpotterTier } from "./catalogue";
import { GRADE_MULT, TERMS, gradeAbove, gradeFor, judgeTerms } from "./dossier";
import { carried, checkLoadout, itemDecay, kitFactor, type Loadout } from "./loadout";
import { afterContract, contractMarginUsed, freshMargin, MARGIN, usedInWords, type MarginState } from "./margin";
import { MEDAL_IDS, isMedalId, medalLevel, medalMaterial, serviceMark, type Material, type MedalId } from "./record";
import type { ClientTerm, Grade, HouseSize, MissionReport, ShotReport } from "./report";
import type { RifleId } from "../scope/shot";

export interface Contract {
  /** What the client pays for a clean job (€). */
  fee: number;
  label?: string;
  /** The kit the dossier calls for: it decays at half rate on this contract. */
  calledFor?: readonly ItemId[];
  /** The broker's grade (fee × its multiplier); routine when left out. */
  grade?: Grade;
  /** The client's terms (fee × (1 + Σ premiums)). */
  terms?: readonly ClientTerm[];
  /** Terms whose premium was lost (Before the deed, Confirmed: see `judgeTerms`). */
  forfeited?: readonly ClientTerm[];
  /** Quiet job: share of the fee taken off for the guests who heard (at most 0.5). */
  quietCut?: number;
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
  /** The fee for a clean job: the base fee × grade × (1 + premiums) less a Quiet job's cut. */
  fee: number;
  /** How the fee was made up (base, grade, each term, a Quiet job's cut); sums to `fee`. Absent when it is only the base fee. */
  feeLines?: ReceiptLine[];
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
  /** What the same result would have paid with nothing carried and no spotters: the bet the kit was. */
  bare?: number;
  /** Carried but never touched: what each cost tonight, to teach a leaner loadout. */
  unused: ReceiptLine[];
  balanceAfter: number;
}

export { MEDAL_IDS, type MedalId } from "./record";

/** A kill's rifle and house size, for Every Rifle. */
export type KillKey = `${RifleId}:${HouseSize}`;
const KILL_KEYS: KillKey[] = (["vss", "svd", "bolt"] as const).flatMap((r) => (["small", "grand", "palatial"] as const).map((h) => `${r}:${h}` as KillKey));

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
  /** Kills by rifle and house size (Every Rifle). */
  kills: Partial<Record<KillKey, number>>;
  /** The next contract was bought from the broker, one grade up (€2,000, lost on a failure). */
  brokered: boolean;
  /** The fixer is held: the next contract that would break the streak doesn't (€5,000, one at a time). */
  fixer: boolean;
  /** Finishes on owned kit (cosmetic). */
  finishes: Partial<Record<ItemId, FinishId>>;
}

/** What settling a mission did to the career, beyond the receipt: for the screen that follows a contract. */
export interface Settled {
  receipt: Receipt;
  /** Clean (the spy killed or downed, no margin used), a margin contract (holds the streak), or one that broke it. */
  run: "clean" | "margin" | "broken" | "saved";
  streak: number;
  grade: Grade;
  /** Medals newly struck or re-struck in better material. */
  medals: { id: MedalId; material: Material }[];
  /** A service mark reached on this contract, if any. */
  serviceMark?: { mark: number; title: string | null };
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
export function settleContract(contract: Contract, result: ContractResult, loadout: Loadout, touched?: ReadonlySet<ItemId>, balance = 0, uses: Partial<Record<ItemId, number>> = {}): Receipt {
  const grade = contract.grade ?? "routine";
  const paidTerms = (contract.terms ?? []).filter((t) => !contract.forfeited?.includes(t));
  const graded = contract.fee * GRADE_MULT[grade];
  const premiums = paidTerms.map((t) => ({ t, amount: round(graded * TERMS[t].premium) }));
  const quietCut = Math.max(0, Math.min(0.5, contract.quietCut ?? 0));
  const beforeQuiet = round(graded) + premiums.reduce((a, p) => a + p.amount, 0);
  const quiet = round(beforeQuiet * quietCut);
  const fee = beforeQuiet - quiet;
  const feeLines: ReceiptLine[] = [{ label: "Fee", amount: contract.fee }];
  if (grade !== "routine") feeLines.push({ label: `${grade[0]!.toUpperCase()}${grade.slice(1)} grade: ×${GRADE_MULT[grade]}`, amount: round(graded) - contract.fee });
  for (const p of premiums) feeLines.push({ label: `${TERMS[p.t].name}: +${Math.round(TERMS[p.t].premium * 100)}%`, amount: p.amount });
  for (const t of contract.forfeited ?? []) if (contract.terms?.includes(t)) feeLines.push({ label: `${TERMS[t].name}: not met, no premium`, amount: 0 });
  if (quiet) feeLines.push({ label: `Quiet job: heard, −${Math.round(quietCut * 100)}%`, amount: -quiet });
  const used = result.margin ? Math.max(0, Math.min(1, result.margin.used)) : 0;
  const marginFactor = 1 - MARGIN.k * used;
  const gross = fee * Math.max(0, result.factor);
  // A failed job earns no boost.
  const boost = gross > 0 ? earlyBoost(result.doneAt) : 0;
  const bonus = round(gross * boost);
  const boosted = round(gross) + bonus;
  const afterMargin = boosted * marginFactor;
  const items = carried(loadout);
  const called = new Set(contract.calledFor ?? []);
  const kf = kitFactor(loadout, called, uses);
  const afterKit = afterMargin * kf;
  const logs = items.map((id) => Math.log(1 - itemDecay(loadout, id, called, uses)));
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
    fee,
    ...(feeLines.length > 1 ? { feeLines } : {}),
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
    ...(items.length || loadout.spotters.length ? { bare: failed ? 0 : boosted + marginCut } : {}),
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
  readonly kills: Partial<Record<KillKey, number>>;
  brokered: boolean;
  fixer: boolean;
  readonly finishes: Partial<Record<ItemId, FinishId>>;

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
    this.kills = { ...data?.kills };
    this.brokered = data?.brokered ?? false;
    this.fixer = data?.fixer ?? false;
    this.finishes = { ...data?.finishes };
  }

  /** The grade the broker offers now: from the streak, one up for a contract bought from the broker. */
  get grade(): Grade {
    const g = gradeFor(this.streak);
    return this.brokered ? gradeAbove(g) : g;
  }

  /** The broker sells the next contract one grade up (paid now, lost on a failure); one at a time, and not past named. */
  canBroker(): { ok: boolean; why?: string } {
    if (this.brokered) return { ok: false, why: "already bought" };
    if (gradeFor(this.streak) === "named") return { ok: false, why: "nothing above named" };
    if (this.balance < BROKER_PRICE) return { ok: false, why: `€${(BROKER_PRICE - this.balance).toLocaleString("en-GB")} short` };
    return { ok: true };
  }
  buyBroker(): void {
    const c = this.canBroker();
    if (!c.ok) throw new Error(`Can't buy from the broker: ${c.why}`);
    this.balance -= BROKER_PRICE;
    this.brokered = true;
  }

  /** The fixer covers one failed contract so the streak survives; one held at a time. */
  canFix(): { ok: boolean; why?: string } {
    if (this.fixer) return { ok: false, why: "already held" };
    if (this.balance < FIXER_PRICE) return { ok: false, why: `€${(FIXER_PRICE - this.balance).toLocaleString("en-GB")} short` };
    return { ok: true };
  }
  buyFixer(): void {
    const c = this.canFix();
    if (!c.ok) throw new Error(`Can't hire the fixer: ${c.why}`);
    this.balance -= FIXER_PRICE;
    this.fixer = true;
  }

  /** A finish on owned kit: changes nothing in the simulation, keeps the item's uses (and so its wear). */
  buyFinish(id: ItemId, finish: FinishId): void {
    if (!this.owned.has(id)) throw new Error(`Can't finish ${id}: not owned`);
    if (!isFinishId(finish)) throw new Error(`No such finish: ${String(finish)}`);
    if (this.finishes[id] === finish && finish !== "refinish") throw new Error(`${ITEMS[id].name} already has that finish`);
    if (this.balance < FINISHES[finish].price) throw new Error(`Can't finish ${id}: €${(FINISHES[finish].price - this.balance).toLocaleString("en-GB")} short`);
    this.balance -= FINISHES[finish].price;
    this.finishes[id] = finish;
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
    const r = settleContract(contract, result, loadout, touched, this.balance, this.uses);
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

  /**
   * Settles a whole contract from its report (task 10 and 11): the client's terms, the grade, R, the early boost, the
   * margin, worn and called-for kit, spotters; then the streak, the medals, wear and the safety margin. Throws if the
   * loadout can't be taken.
   */
  settleReport(report: MissionReport): Settled {
    const { contract, loadout, shots } = report;
    const t = judgeTerms(report);
    const used = contractMarginUsed(shots);
    const widest = shots.filter((s) => s.at === "spy" && s.kind === "margin").sort((a, b) => b.marginUsed - a.marginUsed)[0];
    const factor = t.factor;
    const outcome = factor > 0 ? report.result.outcome : "failed";
    const touched = new Set(report.usedItems);
    const marksBefore = serviceMark(this.contracts).mark;
    const receipt = this.settle(
      { fee: contract.fee, label: contract.label, calledFor: contract.calledFor, grade: contract.grade, terms: contract.terms, forfeited: t.forfeited, quietCut: t.quietCut },
      { factor, label: outcome, doneAt: report.doneAt, ...(widest ? { margin: { used, wideCm: (widest.missMrad * widest.rangeM) / 10 } } : {}) },
      loadout,
      touched,
    );
    this.brokered = false;

    // The run: clean adds to both counts, a margin contract holds them, anything else breaks them (the fixer saves the streak).
    const spyDown = factor > 0 && (outcome === "killed" || outcome === "downed");
    let run: Settled["run"];
    if (spyDown && used === 0) {
      run = "clean";
      this.streak++;
      this.cleanInRow++;
    } else if (factor > 0 && used > 0) run = "margin";
    else {
      this.cleanInRow = 0;
      if (this.fixer) {
        this.fixer = false;
        run = "saved";
      } else {
        this.streak = 0;
        run = "broken";
      }
    }

    // Medals, counted here and never from the history: a few checks on the report, once per contract.
    const before = { ...this.medals };
    const killed = factor > 0 && outcome === "killed";
    const lastAtSpy = [...shots].reverse().find((s) => s.at === "spy" && s.kind !== "miss");
    if (killed && carried(loadout).length === 0 && used === 0) this.medals["clean-hands"]++;
    this.medals.unbroken = Math.max(this.medals.unbroken, this.cleanInRow);
    if (spyDown && !report.spyTriedGoal) this.medals["first-look"]++;
    if (killed && lastAtSpy && lastAtSpy.windMs > 8) this.medals.gale++;
    if (used === 0 && shots.some((s) => s.at === "spy" && s.kind === "hit" && s.sinceScopeInS <= 3)) this.medals["one-breath"]++;
    if (killed && shots.every((s) => s.heardBy === 0)) this.medals["nobody-heard"]++;
    if (spyDown && report.firstNamedBy === "observer") this.medals["second-bearing"]++;
    if (killed && lastAtSpy && lastAtSpy.elevationDeg > 45 && lastAtSpy.throughGlass) this.medals["glass-roof"]++;
    // A miss at the spy, the spotter's correction heard out, the next round a hit on the spy: once a contract.
    if (shots.some((s, i) => i > 0 && s.at === "spy" && s.kind === "hit" && s.afterCall === true && shots[i - 1]!.at === "spy" && shots[i - 1]!.kind === "miss")) this.medals["called-shot"]++;
    if (killed) {
      const key: KillKey = `${loadout.rifle}:${contract.house}`;
      this.kills[key] = (this.kills[key] ?? 0) + 1;
      if (KILL_KEYS.every((k) => (this.kills[k] ?? 0) > 0)) this.medals["every-rifle"] = 1;
    }
    const medals = MEDAL_IDS.filter((id) => medalLevel(id, this.medals[id]) > medalLevel(id, before[id])).map((id) => ({ id, material: medalMaterial(id, this.medals[id])! }));

    // The safety margin, from the first shot at the spy.
    const first = shots.find((s) => s.at === "spy") ?? null;
    this.updateMargin(loadout.rifle, first, report.endedAt);

    const sm = serviceMark(this.contracts);
    return { receipt, run, streak: this.streak, grade: this.grade, medals, ...(sm.mark > marksBefore ? { serviceMark: sm } : {}) };
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
      kills: { ...this.kills },
      brokered: this.brokered,
      fixer: this.fixer,
      finishes: { ...this.finishes },
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
    const kills: Partial<Record<KillKey, number>> = {};
    for (const [k, n] of Object.entries(record(o.kills))) if ((KILL_KEYS as string[]).includes(k) && count(n)) kills[k as KillKey] = count(n);
    const finishes: Partial<Record<ItemId, FinishId>> = {};
    for (const [k, f] of Object.entries(record(o.finishes))) if (isItemId(k) && owned.includes(k) && typeof f === "string" && isFinishId(f)) finishes[k] = f;
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
      kills,
      brokered: o.brokered === true,
      fixer: o.fixer === true,
      finishes,
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
