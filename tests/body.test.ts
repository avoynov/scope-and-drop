import { describe, expect, it } from "vitest";
import { BREATH_HOLD, Body, mouseAngle } from "../src/scope/body";
import { HOLD } from "../src/scope/hold";

const DT = 1 / 120;
/** Runs a body for `s` seconds from `t0`, and returns the peak-to-peak pitch and yaw of its sway over that time. */
function run(b: Body, t0: number, s: number, input: { holdBreath: boolean; onScope: boolean }, aim = { yaw: 0, pitch: 0 }) {
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (let t = t0; t < t0 + s; t += DT) {
    b.step(t, DT, aim.yaw, aim.pitch, input);
    const [y, p] = b.swayAt(t);
    lo = [Math.min(lo[0]!, y), Math.min(lo[1]!, p)];
    hi = [Math.max(hi[0]!, y), Math.max(hi[1]!, p)];
  }
  return { yaw: hi[0]! - lo[0]!, pitch: hi[1]! - lo[1]!, end: t0 + s };
}
const breathe = { holdBreath: false, onScope: true };
const hold = { holdBreath: true, onScope: true };

describe("the body behind the hold", () => {
  it("breathing lifts the reticle about 0.6 mrad; held at the pause it is several times steadier", () => {
    const b = new Body(HOLD.harris);
    const free = run(b, 0, 10, breathe);
    expect(free.pitch).toBeGreaterThan(0.00055);
    expect(free.pitch).toBeLessThan(0.0008);
    // Wait for the natural pause, then hold.
    let t = free.end;
    while (b.state().lung > 0.01 || b.state().lung === 0) {
      b.step(t, DT, 0, 0, breathe);
      t += DT;
      if (b.state().lung === 0) break;
    }
    const held = run(b, t, 4, hold);
    expect(held.pitch * 4).toBeLessThan(free.pitch);
  });

  it("a hold past its steady seconds shakes harder and dims the eye", () => {
    const b = new Body(HOLD.harris);
    run(b, 0, 6, breathe);
    const early = run(b, 6, BREATH_HOLD.steadyS - 1, hold);
    const late = run(b, early.end, BREATH_HOLD.badS, hold);
    expect(b.state().hypoxia).toBeGreaterThan(0.9);
    expect(late.yaw).toBeGreaterThan(3 * early.yaw);
  });

  it("the heart races after a long hold and settles over about half a minute", () => {
    const b = new Body(HOLD.harris);
    const rest = b.state().bpm;
    const h = run(b, 0, 20, hold);
    const peak = b.state().bpm;
    expect(peak).toBeGreaterThan(rest + 25);
    run(b, h.end, 60, breathe);
    expect(b.state().bpm).toBeLessThan(rest + 6);
  });

  it("past its last seconds the body breathes whatever the shooter wants", () => {
    const b = new Body(HOLD.harris);
    let t = 0;
    for (; t < BREATH_HOLD.gaspS + 6; t += DT) b.step(t, DT, 0, 0, hold);
    const l0 = b.state().lung;
    for (let u = 0; u < 3; u += DT, t += DT) b.step(t, DT, 0, 0, hold);
    expect(b.state().lung).not.toBe(l0);
  });

  it("a fast swing lags, overshoots and unsettles the hold; a slow nudge does neither", () => {
    const slow = new Body(HOLD.harris);
    let t = 0;
    let aim = 0;
    for (; t < 2; t += DT) {
      // 2 mrad over 2 s.
      slow.push(0.001 * DT, 0);
      aim += 0.001 * DT;
      slow.step(t, DT, aim, 0, breathe);
    }
    expect(Math.abs(slow.offset.yaw)).toBeLessThan(0.0002);
    expect(slow.state().unsettled).toBeLessThan(0.05);
    const fast = new Body(HOLD.harris);
    fast.push(0.2, 0);
    let over = 0;
    for (t = 0; t < 1; t += DT) {
      fast.step(t, DT, 0.2, 0, breathe);
      over = Math.max(over, fast.offset.yaw);
    }
    expect(over).toBeGreaterThan(0.005);
    expect(fast.state().unsettled).toBeGreaterThan(0.3);
  });

  it("aims far off the body's natural point strain and creep back; the body resettles in seconds", () => {
    const b = new Body(HOLD.harris);
    b.settle(0, 0);
    b.step(0, DT, 0.03, 0, breathe);
    expect(b.state().tension).toBeGreaterThan(0.9);
    let t = DT;
    for (; t < 1.5; t += DT) b.step(t, DT, 0.03, 0, breathe);
    expect(b.offset.yaw).toBeLessThan(-0.001);
    for (; t < 30; t += DT) b.step(t, DT, 0.03, 0, breathe);
    expect(b.state().tension).toBeLessThan(0.05);
    // Small moves round the natural point cost nothing.
    const c = new Body(HOLD.harris);
    c.settle(0, 0);
    c.step(0, DT, 0.002, 0, breathe);
    expect(c.state().tension).toBe(0);
  });

  it("the mouse is fine when slow, the same angle at any zoom, and coarse when fast", () => {
    expect(mouseAngle(1, 50)).toBeLessThan(0.000025);
    expect(mouseAngle(1, 3000) / mouseAngle(1, 50)).toBeGreaterThan(5);
  });
});
