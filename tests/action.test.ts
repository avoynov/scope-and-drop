import { describe, expect, it } from "vitest";
import { canSafe, cycle, loaded, needsCycle, pull, reload, reloadCharges, setSafe } from "../src/scope/action";

describe("the trigger, the action and the magazine, each on its own", () => {
  it("bolt rifle: one shot, then a dead trigger until the bolt is worked", () => {
    const g = loaded("bolt");
    expect(pull(g, "bolt")).toBe("fire");
    expect(g.chamber).toBe("spent");
    expect(pull(g, "bolt")).toBe("dead");
    expect(pull(g, "bolt")).toBe("dead");
    expect(needsCycle(g)).toBe(true);
    cycle(g, "bolt");
    expect(g.chamber).toBe("live");
    expect(pull(g, "bolt")).toBe("fire");
  });

  it("bolt rifle: worked over an empty box, the striker clicks once on the empty chamber, then nothing", () => {
    const g = loaded("bolt");
    for (let i = 0; i < 5; i++) {
      expect(pull(g, "bolt")).toBe("fire");
      cycle(g, "bolt");
    }
    expect(g.mag).toBe(0);
    expect(g.chamber).toBe("empty");
    expect(pull(g, "bolt")).toBe("click");
    expect(pull(g, "bolt")).toBe("dead");
  });

  it("working the action with a live round chambered is not needed", () => {
    for (const rifle of ["bolt", "svd", "vss"] as const) expect(needsCycle(loaded(rifle))).toBe(false);
    // Still, if it is done, it throws that round out and costs one.
    const g = loaded("svd");
    cycle(g, "svd");
    expect(g.mag).toBe(8);
    expect(g.chamber).toBe("live");
  });

  it("SVD: ten shots, then the carrier is held open and the trigger dead", () => {
    const g = loaded("svd");
    for (let i = 0; i < 10; i++) expect(pull(g, "svd")).toBe("fire");
    expect(g.held).toBe(true);
    expect(pull(g, "svd")).toBe("dead");
  });

  it("VSS: after the last round it shuts on an empty chamber; the next pull is a click", () => {
    const g = loaded("vss");
    for (let i = 0; i < 10; i++) expect(pull(g, "vss")).toBe("fire");
    expect(g.held).toBe(false);
    expect(pull(g, "vss")).toBe("click");
    expect(pull(g, "vss")).toBe("dead");
  });
});

describe("chambering only when it is needed", () => {
  it("a magazine change with a round chambered keeps it, and the rifle is ready: a full magazine plus one", () => {
    for (const rifle of ["svd", "vss"] as const) {
      const g = loaded(rifle);
      pull(g, rifle);
      expect(reloadCharges(g)).toBe(false);
      reload(g, rifle);
      expect(g.chamber).toBe("live");
      expect(g.mag).toBe(10);
      expect(needsCycle(g)).toBe(false);
      expect(pull(g, rifle)).toBe("fire");
    }
  });

  it("after the last round, the magazine change chambers from the new one", () => {
    for (const rifle of ["svd", "vss"] as const) {
      const g = loaded(rifle);
      for (let i = 0; i < 10; i++) pull(g, rifle);
      expect(reloadCharges(g)).toBe(true);
      reload(g, rifle);
      // The SVD's carrier let off its bolt stop and home on a round.
      expect(g.held).toBe(false);
      expect(g.chamber).toBe("live");
      expect(g.mag).toBe(9);
      expect(pull(g, rifle)).toBe("fire");
    }
    // Bolt rifle: the last fired case still in, or already thrown out over an empty box.
    for (const work of [false, true]) {
      const g = loaded("bolt");
      for (let i = 0; i < 5; i++) {
        pull(g, "bolt");
        if (i < 4 || work) cycle(g, "bolt");
      }
      expect(reloadCharges(g)).toBe(true);
      reload(g, "bolt");
      expect(g.chamber).toBe("live");
      expect(g.mag).toBe(4);
      expect(pull(g, "bolt")).toBe("fire");
    }
  });

  it("bolt rifle: a box change mid-string leaves a fired case for the bolt to work, as after every shot", () => {
    const g = loaded("bolt");
    pull(g, "bolt");
    expect(reloadCharges(g)).toBe(false);
    reload(g, "bolt");
    expect(g.chamber).toBe("spent");
    expect(g.mag).toBe(5);
    cycle(g, "bolt");
    expect(pull(g, "bolt")).toBe("fire");
  });
});

describe("the safety", () => {
  it("locks the trigger on every rifle, and comes off again", () => {
    for (const rifle of ["bolt", "svd", "vss"] as const) {
      const g = loaded(rifle);
      expect(setSafe(g, rifle, true)).toBe(true);
      expect(pull(g, rifle)).toBe("safe");
      expect(g.chamber).toBe("live");
      expect(setSafe(g, rifle, false)).toBe(true);
      expect(pull(g, rifle)).toBe("fire");
    }
  });

  it("stops the action being worked, and the chambering after a magazine change, but not the change", () => {
    const g = loaded("vss");
    for (let i = 0; i < 10; i++) pull(g, "vss");
    setSafe(g, "vss", true);
    expect(cycle(g, "vss")).toBe(false);
    expect(reloadCharges(g)).toBe(false);
    reload(g, "vss");
    expect(g.mag).toBe(10);
    expect(g.chamber).toBe("empty");
    // Off safe, the handle goes all the way.
    setSafe(g, "vss", false);
    expect(needsCycle(g)).toBe(true);
    expect(cycle(g, "vss")).toBe(true);
    expect(pull(g, "vss")).toBe("fire");
  });

  it("SVD: won't go up with the carrier held open", () => {
    const g = loaded("svd");
    for (let i = 0; i < 10; i++) pull(g, "svd");
    expect(canSafe(g, "svd")).toBe(false);
    expect(setSafe(g, "svd", true)).toBe(false);
    expect(g.safe).toBe(false);
  });

  it("bolt rifle: goes on only with the striker cocked", () => {
    const g = loaded("bolt");
    pull(g, "bolt");
    // Fired: the striker is down, and the safety springs back off.
    expect(setSafe(g, "bolt", true)).toBe(false);
    cycle(g, "bolt");
    expect(setSafe(g, "bolt", true)).toBe(true);
    // ON locks the bolt shut.
    expect(cycle(g, "bolt")).toBe(false);
    expect(g.mag).toBe(3);
  });
});
