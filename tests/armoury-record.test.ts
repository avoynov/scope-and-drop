import { describe, expect, it } from "vitest";
import { Career, settleContract, type Receipt } from "../src/armoury/career";
import { BROKER_PRICE, FIXER_PRICE, ITEMS, START_BALANCE, type ItemId } from "../src/armoury/catalogue";
import { BASE_FEE, GRADE_MULT, SHOT_REF_M, baseFee, TERMS, calledFor, feeFor, gradeAbove, gradeFor, judgeTerms, makeDossier } from "../src/armoury/dossier";
import { emptyLoadout, kitFactor, type Loadout } from "../src/armoury/loadout";
import { MARGIN, freshMargin } from "../src/armoury/margin";
import { MEDAL_IDS, medalLevel, medalMaterial, serviceMark, wearFactor, wearLook } from "../src/armoury/record";
import type { ClientTerm, Grade, HouseSize, MissionReport, ShotReport } from "../src/armoury/report";
import type { RifleId } from "../src/scope/shot";

const loadout = (rifle: RifleId, ids: ItemId[] = [], spotters: Loadout["spotters"] = []): Loadout => {
  const l = emptyLoadout(rifle);
  for (const id of ids) l.items[ITEMS[id].slot] = id;
  l.spotters = spotters;
  return l;
};
const lineSum = (r: Receipt) => r.gross + (r.early?.amount ?? 0) + (r.margin?.amount ?? 0) + [...r.kit, ...r.spotters].reduce((s, x) => s + x.amount, 0);

const shot = (o: Partial<ShotReport> = {}): ShotReport => ({
  t: 30,
  at: "spy",
  kind: "hit",
  outcome: "killed",
  marginUsed: 0,
  fromChestMrad: 0.3,
  missMrad: 0,
  rangeM: 183,
  sinceScopeInS: 12,
  elevationDeg: 0,
  throughGlass: false,
  windMs: 2,
  heardBy: 0,
  ...o,
});

let day = 0;
function report(
  o: {
    rifle?: RifleId;
    items?: ItemId[];
    shots?: ShotReport[];
    outcome?: MissionReport["result"]["outcome"];
    terms?: ClientTerm[];
    grade?: Grade;
    house?: HouseSize;
    tried?: boolean;
    confirmed?: boolean;
  } = {},
): MissionReport {
  const outcome = o.outcome ?? "killed";
  const factor = { killed: 1, downed: 0.6, wounded: 0.2, failed: 0 }[outcome];
  const items = o.items ?? [];
  return {
    contract: { fee: 6000, terms: o.terms ?? [], grade: o.grade ?? "routine", house: o.house ?? "grand", calledFor: calledFor(o.terms ?? []) },
    loadout: loadout(o.rifle ?? "vss", items),
    shots: o.shots ?? [shot({ outcome: outcome === "failed" ? undefined : outcome, kind: outcome === "failed" ? "miss" : "hit" })],
    result: { outcome, factor },
    usedItems: items,
    spyTriedGoal: o.tried ?? false,
    confirmedDown: o.confirmed ?? true,
    endedAt: new Date(Date.UTC(2026, 10, 1) + day++ * 86_400_000).toISOString(),
  };
}

describe("the dossier", () => {
  it("grades the streak: routine 0–2, priority 3–5, critical 6–9, named 10 and up", () => {
    expect([0, 2, 3, 5, 6, 9, 10, 40].map(gradeFor)).toEqual(["routine", "routine", "priority", "priority", "critical", "critical", "named", "named"]);
    expect(GRADE_MULT).toEqual({ routine: 1, priority: 1.2, critical: 1.35, named: 1.5 });
    expect(gradeAbove("critical")).toBe("named");
    expect(gradeAbove("named")).toBe("named");
  });

  it("is the same for the same seed, offers a storm only in a gale and a blind house only with a glass roof", () => {
    expect(makeDossier({ seed: "a", streak: 4 })).toEqual(makeDossier({ seed: "a", streak: 4 }));
    let storms = 0;
    for (let i = 0; i < 400; i++) {
      const d = makeDossier({ seed: `s${i}`, streak: i % 12 });
      expect(d.grade).toBe(gradeFor(i % 12));
      expect(d.terms.length).toBeLessThanOrEqual(2);
      expect(new Set(d.terms).size).toBe(d.terms.length);
      if (d.terms.includes("storm")) {
        storms++;
        expect(d.forecast.windMs).toBeGreaterThanOrEqual(8);
      }
      if (d.forecast.windMs >= 8) expect(d.terms).toContain("storm");
      if (d.terms.includes("blind")) expect(d.glassRoof && d.treelineSees < 0.25).toBe(true);
      expect(d.fee).toBe(feeFor(baseFee(d.house, d.distanceM), d.grade, d.terms));
      expect(d.distanceM >= 135 && d.distanceM <= 205).toBe(true);
      expect(d.calledFor).toEqual(calledFor(d.terms));
      expect(d.forecast.gustMs).toBeGreaterThan(d.forecast.windMs - 1e-9);
    }
    expect(storms).toBeGreaterThan(20);
    expect(makeDossier({ seed: "a", streak: 4, brokered: true }).grade).toBe("critical");
  });

  it("pays a longer shot more: the house's fee in proportion to the distance", () => {
    expect(baseFee("grand", SHOT_REF_M)).toBe(BASE_FEE.grand);
    expect(baseFee("grand", 2 * SHOT_REF_M)).toBe(2 * BASE_FEE.grand);
    expect(baseFee("small", 135)).toBeLessThan(baseFee("small", 205));
    expect(makeDossier({ seed: "x", streak: 0, distanceM: 190 }).distanceM).toBe(190);
  });

  it("calls for kit by its terms", () => {
    expect(calledFor(["quiet", "glass"])).toEqual(["can", "sub200", "sp6", "7n14", "tbt168"]);
    for (const t of Object.values(TERMS)) for (const id of t.calledFor) expect(ITEMS[id]).toBeDefined();
  });

  it("judges the terms: One round fails a miss or a non-fatal first shot; Before the deed and Confirmed lose their premium; a Quiet job loses 10% a hearer, at most half", () => {
    const one = (first: ShotReport) => judgeTerms({ ...report({ terms: ["one-round"] }), shots: [first, shot()] }).factor;
    expect(one(shot())).toBe(1);
    expect(one(shot({ kind: "miss", outcome: undefined }))).toBe(0);
    expect(one(shot({ outcome: "downed" }))).toBe(0);
    expect(one(shot({ at: "guest" }))).toBe(0);
    expect(judgeTerms(report({ terms: ["before-deed", "confirmed"], tried: true, confirmed: false })).forfeited).toEqual(["before-deed", "confirmed"]);
    expect(judgeTerms(report({ terms: ["before-deed", "confirmed"] })).forfeited).toEqual([]);
    expect(judgeTerms({ ...report({ terms: ["quiet"] }), shots: [shot({ heardBy: 3 })] }).quietCut).toBeCloseTo(0.3, 12);
    expect(judgeTerms({ ...report({ terms: ["quiet"] }), shots: [shot({ heardBy: 9 })] }).quietCut).toBe(0.5);
    expect(judgeTerms({ ...report(), shots: [shot({ heardBy: 9 })] }).quietCut).toBe(0);
  });
});

describe("pay with grades, terms and wear", () => {
  it("multiplies the fee by the grade and the terms' premiums, with lines that add up", () => {
    const r = settleContract({ fee: 6000, grade: "critical", terms: ["quiet", "storm"], quietCut: 0.2 }, { factor: 1, label: "killed" }, loadout("vss", ["bag"]));
    const fee = Math.round(6000 * 1.35) + Math.round(6000 * 1.35 * 0.3) + Math.round(6000 * 1.35 * 0.25);
    expect(r.fee).toBe(fee - Math.round(fee * 0.2));
    expect(r.feeLines!.reduce((s, l) => s + l.amount, 0)).toBe(r.fee);
    expect(r.feeLines!.map((l) => l.label)).toEqual(["Fee", "Critical grade: ×1.35", "Quiet job: +30%", "Storm: +25%", "Quiet job: heard, −20%"]);
    expect(lineSum(r)).toBe(r.total);
    expect(r.bare).toBe(r.gross);
    const plain = settleContract({ fee: 6000 }, { factor: 1, label: "killed" }, loadout("vss"));
    expect(plain.feeLines).toBeUndefined();
    expect(plain.bare).toBeUndefined();
  });

  it("pays no premium for a term not met, and shows it", () => {
    const r = settleContract({ fee: 6000, terms: ["before-deed", "confirmed"], forfeited: ["before-deed"] }, { factor: 1, label: "killed" }, loadout("vss"));
    expect(r.fee).toBe(6600);
    expect(r.feeLines!.map((l) => l.label)).toEqual(["Fee", "Confirmed: +10%", "Before the deed: not met, no premium"]);
  });

  it("wears kit: a tenth off the decay at 10, 30 and 75 uses", () => {
    expect([0, 9, 10, 29, 30, 74, 75, 500].map(wearFactor)).toEqual([1, 1, 0.9, 0.9, 0.81, 0.81, 0.9 ** 3, 0.9 ** 3]);
    const l = loadout("bolt", ["kilo", "bag"]);
    const d = ITEMS.kilo.decay.bolt!;
    expect(kitFactor(l, new Set(), { kilo: 30 })).toBeCloseTo((1 - d * 0.81) * (1 - ITEMS.bag.decay.bolt!), 12);
    // Wear and the dossier's call stack.
    expect(kitFactor(l, new Set<ItemId>(["kilo"]), { kilo: 75 })).toBeCloseTo((1 - d * 0.5 * 0.729) * (1 - ITEMS.bag.decay.bolt!), 12);
    const worn = settleContract({ fee: 6000 }, { factor: 1, label: "killed" }, l, undefined, 0, { kilo: 75, bag: 10 });
    expect(worn.total).toBeGreaterThan(settleContract({ fee: 6000 }, { factor: 1, label: "killed" }, l).total);
    expect(lineSum(worn)).toBe(worn.total);
    expect(wearLook("bag", 12)).toBe("Handled, the leather darkened");
    expect(wearLook("atlas", 80)).toBe("Well worn, the paint rubbed through");
    expect(wearLook("kilo", 3)).toBeNull();
  });
});

describe("the service record", () => {
  it("strikes medals in better material at each threshold, and marks service", () => {
    expect(medalLevel("nobody-heard", 0)).toBe(0);
    expect(medalMaterial("nobody-heard", 350)).toBe("platinum");
    expect(medalMaterial("clean-hands", 10)).toBe("bronze");
    expect(medalMaterial("unbroken", 9)).toBeNull();
    expect(serviceMark(9)).toEqual({ mark: 0, title: null });
    expect(serviceMark(100)).toEqual({ mark: 100, title: "Old Hand" });
    expect(serviceMark(1200)).toEqual({ mark: 1000, title: "The Long Arm" });
  });
});

describe("settling a mission report", () => {
  it("counts the streak: clean adds, a margin hit holds, anything else breaks it", () => {
    const c = new Career();
    for (let i = 0; i < 3; i++) expect(c.settleReport(report()).run).toBe("clean");
    expect(c.streak).toBe(3);
    expect(c.grade).toBe("priority");
    const margin = c.settleReport(report({ shots: [shot({ kind: "margin", marginUsed: 0.5, missMrad: 0.4 })] }));
    expect(margin.run).toBe("margin");
    expect(margin.receipt.margin!.label).toMatch(/^Counted as a hit: 7 cm wide of him, half the margin used/);
    expect(c.streak).toBe(3);
    expect(c.cleanInRow).toBe(3);
    expect(c.settleReport(report({ outcome: "wounded" })).run).toBe("broken");
    expect(c.streak).toBe(0);
    expect(c.cleanInRow).toBe(0);
    expect(c.grade).toBe("routine");
    expect(c.contracts).toBe(5);
  });

  it("fails One round on a missed first shot, whatever the second did", () => {
    const c = new Career();
    const s = c.settleReport(report({ terms: ["one-round"], shots: [shot({ kind: "miss", outcome: undefined }), shot()] }));
    expect(s.run).toBe("broken");
    expect(s.receipt.total).toBe(0);
  });

  it("lets the fixer save one streak, and the broker sell one grade up for the next contract only", () => {
    const c = new Career({ balance: 20000, streak: 4, cleanInRow: 4 });
    c.buyFixer();
    expect(c.balance).toBe(20000 - FIXER_PRICE);
    expect(c.canFix().ok).toBe(false);
    expect(c.settleReport(report({ outcome: "failed" })).run).toBe("saved");
    expect(c.streak).toBe(4);
    expect(c.cleanInRow).toBe(0);
    expect(c.fixer).toBe(false);
    expect(c.settleReport(report({ outcome: "failed" })).run).toBe("broken");
    expect(c.streak).toBe(0);
    c.buyBroker();
    expect(c.balance).toBe(20000 - FIXER_PRICE - BROKER_PRICE);
    expect(c.grade).toBe("priority");
    expect(c.canBroker().ok).toBe(false);
    c.settleReport(report({ grade: "priority" }));
    expect(c.brokered).toBe(false);
    expect(c.grade).toBe("routine");
    expect(new Career({ streak: 12 }).canBroker()).toEqual({ ok: false, why: "nothing above named" });
  });

  it("counts medals in the counters: Clean Hands, Unbroken, First Look, Gale, One Breath, Every Rifle", () => {
    const c = new Career({ balance: 100000 });
    c.buy("bag");
    const first = c.settleReport(report());
    expect(first.medals).toEqual([
      { id: "clean-hands", material: "tin" },
      { id: "first-look", material: "tin" },
      { id: "nobody-heard", material: "tin" },
    ]);
    // Kit carried: no Clean Hands. The spy had tried its goal: no First Look.
    c.settleReport(report({ items: ["bag"], tried: true }));
    expect(c.medals["clean-hands"]).toBe(1);
    expect(c.medals["first-look"]).toBe(1);
    c.settleReport(report({ shots: [shot({ windMs: 9, sinceScopeInS: 2.5 })] }));
    expect(c.medals.gale).toBe(1);
    expect(c.medals["one-breath"]).toBe(1);
    // A margin contract earns no One Breath and no Clean Hands.
    c.settleReport(report({ shots: [shot({ kind: "margin", marginUsed: 0.2, missMrad: 0.2, sinceScopeInS: 1 })] }));
    expect(c.medals["one-breath"]).toBe(1);
    expect(c.medals["clean-hands"]).toBe(2);
    for (let i = 0; i < 10; i++) c.settleReport(report());
    expect(c.medals.unbroken).toBe(13);
    expect(medalMaterial("unbroken", c.medals.unbroken)).toBe("tin");
    // Every Rifle: a kill with each rifle in each house size.
    for (const rifle of ["vss", "svd", "bolt"] as const) for (const house of ["small", "grand", "palatial"] as const) c.settleReport(report({ rifle, house }));
    expect(c.medals["every-rifle"]).toBe(1);
    // None of these shots was heard, called or steep, and no observer named the spy.
    expect(c.medals["nobody-heard"]).toBe(Object.values(c.kills).reduce((a, b) => a + b, 0));
    expect(c.medals["second-bearing"] + c.medals["called-shot"] + c.medals["glass-roof"]).toBe(0);
    expect(c.history.length).toBe(23);
  });

  it("counts Nobody Heard, Second Bearing, Called Shot and Glass Roof from the report", () => {
    const c = new Career({ balance: 100000 });
    // Nobody Heard: every shot unheard, not only the killing one; and only for a kill.
    c.settleReport(report({ shots: [shot({ kind: "miss", outcome: undefined, missMrad: 2, heardBy: 1 }), shot()] }));
    c.settleReport(report({ outcome: "downed" }));
    expect(c.medals["nobody-heard"]).toBe(0);
    c.settleReport(report());
    expect(c.medals["nobody-heard"]).toBe(1);

    // Second Bearing: an observer named the spy first, and the spy went down.
    c.settleReport({ ...report(), firstNamedBy: "sniper" });
    c.settleReport({ ...report({ outcome: "failed" }), firstNamedBy: "observer" });
    expect(c.medals["second-bearing"]).toBe(0);
    c.settleReport({ ...report({ outcome: "downed" }), firstNamedBy: "observer" });
    expect(c.medals["second-bearing"]).toBe(1);

    // Called Shot: a miss at the spy, the correction finished, the next round a hit on the spy; once a contract.
    const miss = shot({ kind: "miss", outcome: undefined, missMrad: 1.5 });
    c.settleReport(report({ shots: [miss, shot({ outcome: "wounded" })] })); // fired before the correction finished
    c.settleReport(report({ shots: [shot({ at: "guest", kind: "miss", outcome: undefined }), shot({ afterCall: true })] })); // the miss wasn't at the spy
    c.settleReport(report({ shots: [miss, shot({ kind: "margin", marginUsed: 0.3, missMrad: 0.3, afterCall: true })] })); // a margin hit isn't a hit
    expect(c.medals["called-shot"]).toBe(0);
    c.settleReport(report({ shots: [miss, shot({ outcome: "wounded", afterCall: true }), miss, shot({ afterCall: true })] }));
    expect(c.medals["called-shot"]).toBe(1);

    // Glass Roof: the killing shot steeper than 45° and through glass.
    c.settleReport(report({ shots: [shot({ elevationDeg: 50 })] }));
    c.settleReport(report({ shots: [shot({ elevationDeg: 44, throughGlass: true })] }));
    c.settleReport(report({ outcome: "downed", shots: [shot({ outcome: "downed", elevationDeg: 55, throughGlass: true })] }));
    expect(c.medals["glass-roof"]).toBe(0);
    c.settleReport(report({ shots: [shot({ elevationDeg: 52, throughGlass: true })] }));
    expect(c.medals["glass-roof"]).toBe(1);
  });

  it("wears what was used, and keeps it through a refinish", () => {
    const c = new Career({ balance: 100000 });
    c.buy("bag");
    c.buy("kilo");
    for (let i = 0; i < 10; i++) c.settleReport({ ...report({ items: ["bag", "kilo"] }), usedItems: ["bag"] });
    expect(c.uses).toEqual({ bag: 10 });
    c.buyFinish("bag", "refinish");
    expect(c.uses.bag).toBe(10);
    expect(c.finishes.bag).toBe("refinish");
    expect(() => c.buyFinish("atlas", "black")).toThrow(/not owned/);
  });

  it("moves the safety margin from the first shot at the spy, and leaves it with none", () => {
    const c = new Career();
    c.settleReport(report({ shots: [shot({ at: "guest", kind: "miss", outcome: undefined })], outcome: "failed" }));
    expect(c.margin).toEqual(freshMargin());
    c.settleReport(report({ rifle: "svd" }));
    expect(c.margin.career).toBeLessThan(MARGIN.career0);
    expect(c.margin.rifle.svd).toBeLessThan(MARGIN.rifle0);
    expect(c.margin.rifle.vss).toBe(MARGIN.rifle0);
  });

  it("round-trips everything it now keeps, and an earlier version 2 save reads with the new fields at their defaults", () => {
    const c = new Career({ balance: 100000 });
    c.buy("bag");
    c.buyFixer();
    c.buyBroker();
    c.buyFinish("bag", "woodland");
    c.settleReport(report({ rifle: "bolt", house: "small" }));
    c.buyBroker();
    const back = Career.fromJSON(JSON.parse(JSON.stringify(c)));
    expect(back.toJSON()).toEqual(c.toJSON());
    const { kills, brokered, fixer, finishes, ...earlier } = c.toJSON();
    void [kills, brokered, fixer, finishes];
    const old = Career.fromJSON(JSON.parse(JSON.stringify(earlier)));
    expect(old.kills).toEqual({});
    expect(old.brokered).toBe(false);
    expect(old.fixer).toBe(false);
    expect(old.finishes).toEqual({});
    expect(Career.fromJSON({ v: 2, owned: ["bag"], finishes: { bag: "gold-plate", kilo: "black" }, kills: { "vss:small": 2, "laser:huge": 1 } }).toJSON()).toMatchObject({
      finishes: {},
      kills: { "vss:small": 2 },
    });
    expect(new Career().balance).toBe(START_BALANCE);
    expect(MEDAL_IDS.length).toBe(10);
  });
});
