import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { START_BALANCE } from "../src/armoury/catalogue";

/** A localStorage that lives in a Map, or one that throws like a blocked one. */
function stub(blocked = false) {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => {
      if (blocked) throw new Error("SecurityError");
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (blocked) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  };
  return m;
}

describe("the armoury's store", () => {
  // A fresh module each time, so its fallback memory starts empty.
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("keeps the career and the chosen loadout between visits", async () => {
    const m = stub();
    const s = await import("../demo/armoury/store");
    const c = s.loadCareer();
    c.buy("bag");
    s.saveCareer(c);
    s.saveChosen({ rifle: "bolt", kits: { vss: "", svd: "", bolt: "bag" }, spotters: [{ tier: "veteran", place: "beside" }] });
    expect(m.size).toBe(2);
    const again = s.loadCareer();
    expect([...again.owned]).toEqual(["bag"]);
    const chosen = s.loadChosen(again.owned);
    expect(s.chosenLoadout(chosen)).toEqual({ rifle: "bolt", items: { rear: "bag" }, spotters: [{ tier: "veteran", place: "beside" }] });
    expect(s.persistent).toBe(true);
  });

  it("trusts nothing it reads back: unknown items, unowned kit, a sleeve without its can, bad spotters", async () => {
    const m = stub();
    m.set(
      "scope-and-drop.loadout.v1",
      JSON.stringify({
        rifle: "laser",
        kits: { vss: "atlas,laser,acss", bolt: "can,sleeve", svd: 7 },
        spotters: [{ tier: "general" }, { tier: "rookie", place: "bearing", azDeg: 400, elDeg: "high" }, { tier: "veteran" }, { tier: "seasoned" }],
      }),
    );
    const s = await import("../demo/armoury/store");
    const c = s.loadChosen(new Set(["atlas", "sleeve"]));
    expect(c.rifle).toBe("vss");
    expect(c.kits).toEqual({ vss: "atlas", svd: "", bolt: "" });
    expect(c.spotters).toEqual([
      { tier: "rookie", place: "bearing", azDeg: 60, elDeg: 0 },
      { tier: "veteran", place: "beside" },
    ]);
  });

  it("works for the visit when storage is blocked, and says so", async () => {
    stub(true);
    const s = await import("../demo/armoury/store");
    const c = s.loadCareer();
    expect(c.balance).toBe(START_BALANCE);
    c.buy("bag");
    s.saveCareer(c);
    expect(s.persistent).toBe(false);
    expect([...s.loadCareer().owned]).toEqual(["bag"]);
  });
});
