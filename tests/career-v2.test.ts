import { describe, expect, it } from "vitest";
import { Career, MEDAL_IDS, settleContract, type Receipt } from "../src/armoury/career";
import { ITEMS, START_BALANCE, type ItemId } from "../src/armoury/catalogue";
import { emptyLoadout, kitFactor, payFactor, type Loadout } from "../src/armoury/loadout";
import { MARGIN, freshMargin } from "../src/armoury/margin";
import type { RifleId } from "../src/scope/shot";

const loadout = (rifle: RifleId, ids: ItemId[], spotters: Loadout["spotters"] = []): Loadout => {
  const l = emptyLoadout(rifle);
  for (const id of ids) l.items[ITEMS[id].slot] = id;
  l.spotters = spotters;
  return l;
};
const lineSum = (r: Receipt) => r.gross + (r.early?.amount ?? 0) + [...r.kit, ...r.spotters].reduce((s, x) => s + x.amount, 0);

/** A version 1 save as the armoury page wrote it before version 2. */
function v1Save() {
  const c = new Career({ balance: 3000 });
  c.buy("bag");
  for (let i = 0; i < 3; i++) c.settle({ fee: 6000, label: `Job ${i}` }, { factor: 1, label: "killed", doneAt: 3600 }, loadout("vss", ["bag"]));
  const { balance, owned, history } = c.toJSON();
  return JSON.parse(JSON.stringify({ v: 1, balance, owned, history }));
}

describe("the career, version 2", () => {
  it("upgrades a version 1 save with nothing lost: counters at 0, contracts from the receipts, the margin at its start", () => {
    const old = v1Save();
    const c = Career.fromJSON(old);
    expect(c.balance).toBe(old.balance);
    expect([...c.owned]).toEqual(old.owned);
    expect(c.history).toEqual(old.history);
    expect(c.contracts).toBe(3);
    expect(c.streak).toBe(0);
    expect(c.cleanInRow).toBe(0);
    expect(Object.values(c.medals)).toEqual(MEDAL_IDS.map(() => 0));
    expect(c.uses).toEqual({});
    expect(c.margin).toEqual(freshMargin());
    expect(c.margin.career + c.margin.rifle.vss).toBeCloseTo(1.5, 9);
    const saved = c.toJSON();
    expect(saved.v).toBe(2);
    // And the upgraded save reads back the same.
    expect(Career.fromJSON(JSON.parse(JSON.stringify(saved))).toJSON()).toEqual(saved);
  });

  it("round-trips version 2", () => {
    const c = new Career({ balance: 40000, streak: 4, cleanInRow: 2, contracts: 61 });
    c.buy("bag");
    c.buy("kilo");
    c.medals["clean-hands"] = 7;
    c.medals.gale = 1;
    c.margin.career = 0.37;
    c.margin.rifle.svd = 0;
    c.margin.missesInRow = 1;
    c.margin.lastContractAt = "2026-10-31T20:15:00.000Z";
    c.settle({ fee: 6000 }, { factor: 1, label: "killed" }, loadout("bolt", ["bag", "kilo"]), new Set<ItemId>(["kilo"]));
    expect(c.contracts).toBe(62);
    expect(c.uses).toEqual({ kilo: 1 });
    const back = Career.fromJSON(JSON.parse(JSON.stringify(c)));
    expect(back.toJSON()).toEqual(c.toJSON());
  });

  it("counts a use of every item carried when nobody said what was touched", () => {
    const c = new Career();
    c.buy("bag");
    c.settle({ fee: 6000 }, { factor: 1, label: "killed" }, loadout("vss", ["bag"]));
    expect(c.uses).toEqual({ bag: 1 });
  });

  it("starts fresh for an unknown version, and checks whatever a version 2 save holds", () => {
    for (const v of [0, 3, "2", undefined]) {
      const c = Career.fromJSON({ v, balance: 99999, owned: ["bag"], contracts: 12 });
      expect(c.balance).toBe(START_BALANCE);
      expect(c.owned.size).toBe(0);
      expect(c.contracts).toBe(0);
    }
    const c = Career.fromJSON({
      v: 2,
      balance: 5000,
      owned: ["bag", "laser-sword"],
      history: [],
      contracts: -4,
      streak: "lots",
      cleanInRow: 2.7,
      medals: { gale: 3, "silver-star": 9, "one-breath": -1 },
      uses: { bag: 4, "laser-sword": 2, kilo: "x" },
      margin: { career: 9, rifle: { vss: -1, svd: "x" }, missesInRow: 2, lastContractAt: "not a date" },
    });
    expect(c.contracts).toBe(0);
    expect(c.streak).toBe(0);
    expect(c.cleanInRow).toBe(2);
    expect(c.medals.gale).toBe(3);
    expect(c.medals["one-breath"]).toBe(0);
    expect(Object.keys(c.medals)).toEqual([...MEDAL_IDS]);
    expect(c.uses).toEqual({ bag: 4 });
    expect(c.margin).toEqual({ career: MARGIN.career0, rifle: { vss: 0, svd: MARGIN.rifle0, bolt: MARGIN.rifle0 }, missesInRow: 2, lastContractAt: null });
  });
});

describe("settling, version 2", () => {
  it("halves the decay of kit the dossier calls for", () => {
    const l = loadout("vss", ["atlas", "bag"]);
    const plain = settleContract({ fee: 10000 }, { factor: 1, label: "killed" }, l);
    const called = settleContract({ fee: 10000, calledFor: ["bag"] }, { factor: 1, label: "killed" }, l);
    expect(called.total).toBeGreaterThan(plain.total);
    expect(called.total).toBeCloseTo(10000 * kitFactor(l, new Set<ItemId>(["bag"])), -1);
    expect(lineSum(called)).toBe(called.total);
  });

  it("keeps every receipt's lines adding up exactly with the early-finish boost, across fees, results, times and kits", () => {
    const kits: Loadout[] = [
      loadout("vss", []),
      loadout("vss", ["atlas", "bag", "kilo"], [{ tier: "veteran", place: "beside" }]),
      loadout(
        "svd",
        ["bag", "can"],
        [
          { tier: "rookie", place: "beside" },
          { tier: "seasoned", place: "bearing", azDeg: 12 },
        ],
      ),
      loadout("bolt", ["kilo", "bag"]),
    ];
    for (const l of kits)
      for (const fee of [5000, 6123, 8999])
        for (const factor of [1, 0.6, 0.2, 0])
          for (const doneAt of [undefined, 0, 1234, 5400, 10800]) {
            const r = settleContract({ fee, calledFor: ["bag"] }, { factor, label: "x", doneAt }, l);
            expect(lineSum(r)).toBe(r.total);
            if (factor > 0) expect(r.total).toBeCloseTo(r.gross * (1 + (r.early ? r.early.amount / r.gross : 0)) * payFactor(l, new Set<ItemId>(["bag"])), -1);
          }
  });
});
