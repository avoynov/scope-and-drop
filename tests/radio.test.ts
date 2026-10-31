import { describe, expect, it } from "vitest";
import { RADIO, Radio, callDuration, quarter, sayHold, sayRange, type CallKind, type RadioCall } from "../src/scope/radio";
import { Rng } from "../src/mansion/core/rng";

const KINDS: CallKind[] = ["shot", "moving", "sighting", "range", "wind"];
const call = (kind: CallKind, at: number, text = "Wind left, hold point five left"): RadioCall => ({ kind, text, at });

describe("the radio", () => {
  it("speaks at about 2.5 words a second, with the squelch tail after", () => {
    expect(callDuration("Low one point five, right point five")).toBeCloseTo(7 / 2.5 + RADIO.tailS, 9);
    expect(callDuration("Hit")).toBeCloseTo(0.4 + RADIO.tailS, 9);
  });

  it("never talks over itself, however the calls come, and steps the same in long or short steps", () => {
    const rng = new Rng("radio");
    const calls = Array.from({ length: 200 }, () => call(rng.pick(KINDS), rng.range(0, 300), "word ".repeat(rng.int(1, 9)).trim()));
    const fine = new Radio();
    const coarse = new Radio();
    for (const c of calls) {
      fine.push(c);
      coarse.push(c);
    }
    for (let t = 0; t <= 400; t += 0.05) fine.step(t);
    for (let t = 0; t <= 400; t += 7) coarse.step(t);
    coarse.step(400);
    for (let i = 1; i < fine.log.length; i++) expect(fine.log[i]!.start).toBeGreaterThanOrEqual(fine.log[i - 1]!.end - 1e-9);
    // Every call either went out or was dropped as stale, and never before it was ready.
    expect(fine.log.length + fine.dropped.length).toBe(calls.length);
    for (const a of fine.log) expect(a.start).toBeGreaterThanOrEqual(a.call.at);
    // Long steps catch up call by call: the same order, the same times.
    expect(coarse.log.map((a) => [a.call, a.start])).toEqual(fine.log.map((a) => [a.call, a.start]));
  });

  it("puts the most urgent ready call on next: shot, moving, sighting, range, wind", () => {
    const r = new Radio();
    r.push(call("wind", 0, "one two three four five"));
    r.step(0);
    for (const k of ["wind", "range", "sighting", "moving", "shot"] as const) r.push(call(k, 0.5, k));
    for (let t = 0; t < 30; t += 0.1) r.step(t);
    expect(r.log.map((a) => a.call.kind)).toEqual(["wind", "shot", "moving", "sighting", "range", "wind"]);
  });

  it("drops a waiting call older than 20 s, but never a shot call", () => {
    const r = new Radio();
    // A long call holds the channel for 40 s.
    r.push(call("sighting", 0, "word ".repeat(99).trim()));
    r.step(0);
    r.push(call("wind", 1));
    r.push(call("shot", 1, "Hit"));
    r.push(call("moving", 30, "Target moving"));
    for (let t = 0; t < 80; t += 0.1) r.step(t);
    expect(r.dropped.map((c) => c.kind)).toEqual(["wind"]);
    expect(r.log.map((a) => a.call.kind)).toEqual(["sighting", "shot", "moving"]);
  });

  it("says holds in quarters and ranges digit by digit", () => {
    expect(quarter(0.62)).toBe(0.5);
    expect(quarter(0.63)).toBe(0.75);
    expect(sayHold(0.5)).toBe("point five");
    expect(sayHold(-1.25)).toBe("one point two five");
    expect(sayHold(2)).toBe("two");
    expect(sayHold(0.74)).toBe("point seven five");
    expect(sayRange(183)).toBe("one eight three");
    expect(sayRange(412.4)).toBe("four one two");
  });
});
