import { describe, expect, it } from "vitest";
import { canSafe, cycle, loaded, pull, reload, setSafe } from "../src/scope/action";

describe("the trigger, the action and the magazine, each on its own", () => {
  it("bolt rifle: one shot, then a dead trigger until the bolt is worked", () => {
    const g = loaded("bolt");
    expect(pull(g, "bolt")).toBe("fire");
    expect(g.chamber).toBe("spent");
    expect(pull(g, "bolt")).toBe("dead");
    expect(pull(g, "bolt")).toBe("dead");
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
    // A fresh box chambers nothing by itself.
    reload(g, "bolt");
    expect(pull(g, "bolt")).toBe("dead");
    cycle(g, "bolt");
    expect(pull(g, "bolt")).toBe("fire");
  });

  it("working the action with a round chambered throws it out and costs a round", () => {
    const g = loaded("svd");
    cycle(g, "svd");
    expect(g.mag).toBe(8);
    expect(g.chamber).toBe("live");
  });

  it("SVD: ten shots, then the carrier is held open and the trigger dead, through a magazine change", () => {
    const g = loaded("svd");
    for (let i = 0; i < 10; i++) expect(pull(g, "svd")).toBe("fire");
    expect(g.held).toBe(true);
    expect(pull(g, "svd")).toBe("dead");
    reload(g, "svd");
    expect(g.held).toBe(true);
    expect(pull(g, "svd")).toBe("dead");
    cycle(g, "svd");
    expect(g.held).toBe(false);
    expect(pull(g, "svd")).toBe("fire");
  });

  it("VSS: after the last round it shuts on an empty chamber; the next pull is a click", () => {
    const g = loaded("vss");
    for (let i = 0; i < 10; i++) expect(pull(g, "vss")).toBe("fire");
    expect(g.held).toBe(false);
    expect(pull(g, "vss")).toBe("click");
    expect(pull(g, "vss")).toBe("dead");
    reload(g, "vss");
    expect(pull(g, "vss")).toBe("dead");
    cycle(g, "vss");
    expect(pull(g, "vss")).toBe("fire");
  });

  it("a magazine change with a round chambered keeps it: a full magazine plus one", () => {
    const g = loaded("vss");
    pull(g, "vss");
    reload(g, "vss");
    expect(g.chamber).toBe("live");
    expect(g.mag).toBe(10);
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

  it("stops the action being worked, but not a magazine change", () => {
    const g = loaded("vss");
    for (let i = 0; i < 10; i++) pull(g, "vss");
    setSafe(g, "vss", true);
    expect(cycle(g, "vss")).toBe(false);
    expect(g.chamber).toBe("empty");
    reload(g, "vss");
    expect(g.mag).toBe(10);
    expect(g.chamber).toBe("empty");
    // Off safe, the handle goes all the way and chambers.
    setSafe(g, "vss", false);
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

  it("bolt rifle: goes on only with the striker cocked, and then locks the bolt", () => {
    const g = loaded("bolt");
    pull(g, "bolt");
    // Fired: the striker is down, and the safety springs back off.
    expect(setSafe(g, "bolt", true)).toBe(false);
    cycle(g, "bolt");
    expect(setSafe(g, "bolt", true)).toBe(true);
    expect(cycle(g, "bolt")).toBe(false);
    expect(g.mag).toBe(3);
  });
});
