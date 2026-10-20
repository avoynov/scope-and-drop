import { describe, expect, it } from "vitest";
import { latch, loaded, unlatch } from "../src/scope/action";
import { HEAD_UP, ON_WELD, adsEye, planScopeIn } from "../src/scope/ads";
import { ACTIONS, MAG_VSS20, planHandling, poseAt, restPose } from "../src/scope/handling";
import { shotVariation } from "../src/scope/recoil";
import { rigFor } from "../src/armoury/rig";
import { decodeKit } from "../src/armoury/loadout";

describe("the kit in the lab", () => {
  it("loads, empties and refills the magazine the kit put in", () => {
    const g = loaded("vss", MAG_VSS20.rounds);
    expect(g.mag).toBe(19);
    unlatch(g);
    latch(g, "vss");
    expect(g.mag).toBe(20);
    // The issued box is still the default.
    expect(loaded("vss").mag).toBe(ACTIONS.vss.mag.rounds - 1);
  });

  it("works the action with the bigger box's geometry", () => {
    const plan = planHandling("vss", "reload", 0, 0, { mag: MAG_VSS20 });
    expect(plan.geom.mag).toBe(MAG_VSS20);
    expect(planHandling("vss", "reload", 0).geom).toBe(ACTIONS.vss);
    expect(() => poseAt(plan, plan.dur / 2)).not.toThrow();
    expect(restPose("vss", 19, false, MAG_VSS20).mags[0]!.visible).toBe(true);
  });

  it("brings the eye down closer and sooner on a stock that fits", () => {
    const fit = rigFor(decodeKit("svd", "fit")).fit;
    for (let n = 0; n < 20; n++) {
      const a = planScopeIn(0, HEAD_UP, { x: 0, y: 0, z: 0 }, n);
      const b = planScopeIn(0, HEAD_UP, { x: 0, y: 0, z: 0 }, n, fit);
      expect(b.duration).toBeLessThan(a.duration);
      // How far off the weld the eye is as the first stroke ends.
      const miss = (m: typeof a) => {
        const e = adsEye(m, m.contact / 0.85);
        return Math.hypot(e.x - ON_WELD.x, e.y - ON_WELD.y, e.z - ON_WELD.z);
      };
      expect(miss(b)).toBeLessThan(0.75 * miss(a));
      // It ends on the weld, but for the last of the cheek's give (hundredths of a millimetre).
      const end = adsEye(b, b.duration);
      expect(Math.hypot(end.x, end.y, end.z)).toBeLessThan(0.05);
    }
  });

  it("evens out the hold behind each shot with a stock that fits, and leaves the issued draw as it was", () => {
    const spread = (k: number) => {
      const xs = Array.from({ length: 400 }, (_, n) => shotVariation(n, k).travel);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };
    expect(shotVariation(7, 1)).toEqual(shotVariation(7));
    expect(spread(0.6)).toBeLessThan(spread(1));
  });
});
