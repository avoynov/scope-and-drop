import { describe, expect, it } from "vitest";
import { BAG, HOLD, LAB_REST, REST, RestDynamics, cloneHold, dynamicPressure, holdAt, muzzleInertia, type RestSpec } from "../src/scope/hold";

/** The lab's hold before hold.ts: breathing, wander and the heartbeat, on a bipod. */
function oldSway(t: number): [number, number] {
  const b = 0.00032;
  const beat = Math.exp(-((t * 1.15) % 1) * 18);
  return [b * (Math.sin(t * 1.55) * 0.6 + Math.sin(t * 0.37 + 1) * 0.8), b * (Math.sin(t * 3.1 + 0.4) * 0.5 + Math.sin(t * 0.29) * 0.9) - 0.00006 * beat];
}
const rms = (f: (t: number) => number, T = 120) => {
  let s = 0;
  let n = 0;
  for (let t = 0; t < T; t += 0.01, n++) s += f(t) ** 2;
  return Math.sqrt(s / n);
};

describe("the hold", () => {
  it("is the lab's hold on the bipod, to the last digit, in still air", () => {
    for (let t = 0; t < 60; t += 0.137) {
      const [a, b] = holdAt(HOLD.harris, t);
      const [c, d] = oldSway(t);
      expect(a).toBe(c);
      expect(b).toBe(d);
    }
  });

  it("moves half as much again on a pack, and the bag halves the vertical breathing", () => {
    expect(rms((t) => holdAt(HOLD.pack, t)[0]) / rms((t) => holdAt(HOLD.harris, t)[0])).toBeCloseTo(1.5, 1);
    const bagged = cloneHold(HOLD.harris);
    bagged.breath[1] *= 0.5;
    // The breathing part alone: the pitch at the breath's own frequency.
    const breath = (h: typeof bagged) => rms((t) => holdAt(h, t)[1] - holdAt({ ...h, breath: [h.breath[0], 0] }, t)[1]);
    expect(breath(bagged) / breath(HOLD.harris)).toBeCloseTo(0.5, 6);
  });

  it("is buffeted by the wind as its dynamic pressure: about 0.15 mrad on a bipod at 8 m/s, a tenth of that at 2.5", () => {
    const at = (v: number) => rms((t) => holdAt(HOLD.harris, t, dynamicPressure([v, 0, 0]))[0] - holdAt(HOLD.harris, t)[0]);
    let peak = 0;
    for (let t = 0; t < 120; t += 0.005) peak = Math.max(peak, Math.abs(holdAt(HOLD.harris, t, dynamicPressure([8, 0, 0]))[0] - holdAt(HOLD.harris, t)[0]));
    expect(peak).toBeGreaterThan(0.00012);
    expect(peak).toBeLessThan(0.00016);
    expect(at(2.5) / at(8)).toBeCloseTo((2.5 / 8) ** 2, 6);
    // In the hide the wind there is a fifth: a twenty-fifth of the push.
    expect(at(8 * 0.2) / at(8)).toBeCloseTo(0.04, 6);
  });
});

describe("the rest", () => {
  const swing = (spec: RestSpec, path: (t: number) => number, T = 2, dt = 1 / 120) => {
    const r = new RestDynamics(spec, path(0), 0);
    const out: { t: number; yaw: number; resetting: boolean }[] = [];
    for (let t = 0; t <= T; t += dt) {
      const s = r.step(path(t), 0, t, dt);
      out.push({ t, yaw: s.yaw, resetting: s.resetting });
    }
    return out;
  };
  const ramp = (to: number, T: number) => (t: number) => to * Math.min(1, t / T);

  it("follows the hands exactly on the lab's rest", () => {
    for (const s of swing(LAB_REST, (t) => 0.02 * Math.sin(3 * t))) expect(s.yaw).toBeCloseTo(0.02 * Math.sin(3 * s.t), 12);
  });

  it("with 0.4 kg at the muzzle overshoots a quick swing and settles in about 0.4 s", () => {
    const out = swing({ ...LAB_REST, muzzleKg: 0.4 }, ramp(0.02, 0.15));
    const peak = Math.max(...out.map((s) => s.yaw));
    expect(peak).toBeGreaterThan(0.02 * 1.03);
    const settled = out.find((s) => s.t > 0.15 && out.filter((u) => u.t >= s.t).every((u) => Math.abs(u.yaw - 0.02) < 0.0004))!;
    expect(settled.t - 0.15).toBeGreaterThan(0.25);
    expect(settled.t - 0.15).toBeLessThan(0.6);
    expect(muzzleInertia(0)).toBeNull();
  });

  it("drags on the tripod's saddle: no faster than 12°/s", () => {
    const out = swing(REST.tripod, ramp(0.3, 0.1), 2);
    for (let i = 1; i < out.length; i++) expect(Math.abs(out[i]!.yaw - out[i - 1]!.yaw)).toBeLessThanOrEqual(REST.tripod.panRate / 120 + 1e-12);
  });

  it("lifts the Harris's legs past 5° and jolts as they set down; the Atlas pans 15° without", () => {
    const deg = Math.PI / 180;
    expect(swing(REST.harris, ramp(4 * deg, 0.5)).some((s) => s.resetting)).toBe(false);
    expect(swing(REST.harris, ramp(6 * deg, 0.5)).some((s) => s.resetting)).toBe(true);
    expect(swing(REST.atlas, ramp(12 * deg, 0.5)).some((s) => s.resetting)).toBe(false);
  });

  it("lets the stock sag in the bag after a swing and settle back within about a second", () => {
    const r = new RestDynamics({ ...LAB_REST, bag: BAG }, 0, 0);
    let t = 0;
    const dt = 1 / 120;
    for (; t < 0.3; t += dt) r.step(0.02 * (t / 0.3), 0, t, dt);
    const just = r.step(0.02, 0, t, dt);
    expect(just.bagUnsettled).toBeGreaterThan(0.5);
    expect(just.pitch).toBeLessThan(-0.0002);
    for (; t < 1.4; t += dt) r.step(0.02, 0, t, dt);
    expect(r.step(0.02, 0, t, dt).bagUnsettled).toBeLessThan(0.06);
  });

  it("moves with the rifle when recoil or the hands shift it, without a swing", () => {
    const r = new RestDynamics({ ...REST.harris, muzzleKg: 0.4 }, 0, 0);
    r.step(0, 0, 0, 1 / 60);
    r.shift(0.2, 0.05);
    const s = r.step(0.2, 0.05, 1 / 60, 1 / 60);
    expect(s.yaw).toBeCloseTo(0.2, 9);
    expect(s.pitch).toBeCloseTo(0.05, 9);
    expect(s.resetting).toBe(false);
  });
});
