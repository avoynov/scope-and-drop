import { describe, expect, it } from "vitest";
import { CAN, CanHeat } from "../src/scope/can";

const MOA = Math.PI / (180 * 60);

describe("the can", () => {
  it("takes about 10 K a round of full-power .30 and 2 K of a subsonic load, and cools over minutes", () => {
    const a = new CanHeat();
    a.fire(0, "m118lr");
    expect(a.riseAt(0)).toBeCloseTo(9.3, 1);
    expect(a.riseAt(CAN.tauS) / a.riseAt(0)).toBeCloseTo(Math.exp(-1), 6);
    const b = new CanHeat();
    b.fire(0, "sub200");
    expect(b.riseAt(0)).toBeCloseTo(2.1, 1);
    // Half a dozen shots in a minute: too hot to touch, as shooters find.
    const c = new CanHeat();
    for (let i = 0; i < 6; i++) c.fire(i * 10, "7n1");
    expect(c.riseAt(60)).toBeGreaterThan(50);
  });

  it("throws the first shot from a cold can about 1 MOA high, and not the next", () => {
    const c = new CanHeat();
    const first = c.fire(0, "7n1");
    expect(first.shift[1]).toBeCloseTo(MOA, 12);
    expect(first.shift[0]).toBeCloseTo(0.25 * MOA, 12);
    expect(first.pop).toBe(true);
    const second = c.fire(3, "7n1");
    expect(second.shift).toEqual([0, 0]);
    expect(second.pop).toBe(false);
    // Left to cool for 20 minutes it is cold again, and full of fresh air.
    const later = c.fire(1200, "7n1");
    expect(later.shift[1]).toBeGreaterThan(0.5 * MOA);
    expect(later.pop).toBe(true);
  });

  it("shimmers only once it is hot, less in a breeze, and hardly at all under its sleeve", () => {
    const c = new CanHeat();
    expect(c.hazeRad(0, 0, false)).toBe(0);
    for (let i = 0; i < 12; i++) c.fire(i * 5, "7n1");
    const t = 60;
    const still = c.hazeRad(t, 0, false);
    expect(still).toBeGreaterThan(0.5 * CAN.haze.rad);
    expect(still).toBeLessThanOrEqual(CAN.haze.rad);
    expect(c.hazeRad(t, CAN.haze.windMs, false) / still).toBeCloseTo(0.5, 9);
    expect(c.hazeRad(t, 0, true) / still).toBeCloseTo(CAN.haze.sleeve, 9);
  });

});
