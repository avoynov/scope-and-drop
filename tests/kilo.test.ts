import { describe, expect, it } from "vitest";
import { ROUNDS, holdRad } from "../src/scope/ballistics";
import { BEAM_RAYS, KILO8K, KILO_PX_PER_MRAD, Kilo, handShakeMrad, pickReturn, solveFiring, type RayHit } from "../src/scope/kilo";
import { BATTLE_ZERO_M, RIFLES } from "../src/scope/shot";

const rf = RIFLES.bolt;
const comeUp = (m: number) => holdRad(ROUNDS[rf.round], m, BATTLE_ZERO_M, rf.sightM) * 1000;
const calm = { mph: 0, clock: 3 };

describe("KILO8K-ABS solver", () => {
  it("on level ground gives the come-up, the AMR is the range itself, and in calm air it holds off the spin drift", () => {
    let drift = 0;
    for (const m of [300, 600, 900]) {
      const s = solveFiring(rf, m, 0, calm);
      expect(s.elevMil).toBeCloseTo(comeUp(m), 1);
      expect(Math.abs(s.amrM - m)).toBeLessThan(1);
      // A right-hand twist drifts the bullet right: the hold is a little left, more the further it goes.
      expect(s.windMil).toBeLessThan(drift);
      expect(s.windMil).toBeGreaterThan(-0.4);
      drift = s.windMil;
    }
  });

  it("up or down a slope shortens the AMR and the hold", () => {
    for (const d of [-25, 20]) {
      const s = solveFiring(rf, 700, (d * Math.PI) / 180, calm);
      expect(s.amrM).toBeLessThan(700);
      expect(s.amrM).toBeGreaterThan(700 * Math.cos((d * Math.PI) / 180) - 20);
      expect(s.elevMil).toBeLessThan(comeUp(700));
    }
  });

  it("holds into a 5 mph wind from 3 o'clock, about 0.6 mil at 500 m, and nothing for a head wind", () => {
    const right = solveFiring(rf, 500, 0, { mph: 5, clock: 3 });
    expect(right.windMil).toBeGreaterThan(0.45);
    expect(right.windMil).toBeLessThan(0.8);
    const left = solveFiring(rf, 500, 0, { mph: 5, clock: 9 });
    expect(left.windMil).toBeLessThan(-0.45);
    const head = solveFiring(rf, 500, 0, { mph: 5, clock: 12 });
    expect(Math.abs(head.windMil - solveFiring(rf, 500, 0, calm).windMil)).toBeLessThan(0.05);
  });

  it("gives the M118LR's speed and energy at the target", () => {
    const s = solveFiring(rf, 400, 0, calm);
    expect(s.velMs).toBeGreaterThan(560);
    expect(s.velMs).toBeLessThan(650);
    expect(s.energyJ).toBeCloseTo(0.5 * 175 * 6.479891e-5 * s.velMs ** 2, 0);
  });
});

describe("KILO8K-ABS laser", () => {
  const beam = (on: number, target: RayHit, behind: RayHit): RayHit[] => BEAM_RAYS.map((_, i) => (i % 7 < on ? target : behind));

  it("LAST reads the ground behind a target the beam only half covers, FIRST reads the target", () => {
    const hits = beam(4, { m: 412, kind: "person" }, { m: 640, kind: "ground" });
    expect(pickReturn(hits, "LAST")).toBe(640);
    expect(pickReturn(hits, "FIRST")).toBe(412);
    expect(pickReturn(hits, "BEST")).toBe(412);
  });

  it("loses a sliver of a far target, and anything past its reach", () => {
    expect(pickReturn(beam(7, { m: 1700, kind: "person" }, { m: Infinity, kind: "none" }), "LAST")).toBe(1700);
    expect(pickReturn(beam(1, { m: 1700, kind: "person" }, { m: Infinity, kind: "none" }), "LAST")).toBeNull();
    expect(pickReturn(beam(7, { m: 2100, kind: "person" }, { m: Infinity, kind: "none" }), "LAST")).toBeNull();
  });

  it("is a wide, flat beam a third of a mrad to a pixel", () => {
    const xs = BEAM_RAYS.map((r) => r[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(KILO8K.beamMrad[0], 6);
    expect(KILO_PX_PER_MRAD).toBeGreaterThan(3);
    expect(KILO_PX_PER_MRAD).toBeLessThan(3.4);
  });
});

describe("KILO8K-ABS buttons and screen", () => {
  const make = () => {
    let n = 0;
    const k = new Kilo(rf, () => (n++, { losM: 412, slopeRad: 0 }));
    return { k, count: () => n };
  };
  const texts = (k: Kilo, t: number) => k.screen(t).flatMap((o) => (o.k === "text" ? [o.s] : []));

  it("wakes on the first press, ranges on the next, a quarter second later", () => {
    const { k, count } = make();
    k.press("range", 0);
    k.release("range", 0.1);
    expect(k.isOn()).toBe(true);
    expect(texts(k, 0.5)).toContain("SIG SAUER");
    k.update(2);
    expect(count()).toBe(0);
    k.press("range", 2);
    k.release("range", 2.1);
    k.update(2.2);
    expect(count()).toBe(0);
    k.update(2.26);
    expect(count()).toBe(1);
    expect(texts(k, 2.3)).toContain("412.0");
    expect(texts(k, 2.3)).toContain("P1 M118LR");
    // The status lines go a couple of seconds after the first range; the reading stays.
    expect(texts(k, 4.5)).not.toContain("P1 M118LR");
    expect(texts(k, 4.5)).toContain("412.0");
  });

  it("scans four times a second while held, for 20 s at most, and turns itself off after 30 s", () => {
    const { k, count } = make();
    k.press("mode", 0);
    k.release("mode", 0.1);
    k.press("range", 2);
    for (let t = 2; t <= 25; t += 0.05) k.update(t);
    expect(k.isScanning()).toBe(false);
    expect(count()).toBeGreaterThan(70);
    expect(count()).toBeLessThan(85);
    k.release("range", 25);
    k.update(54);
    expect(k.isOn()).toBe(true);
    k.update(55.1);
    expect(k.isOn()).toBe(false);
  });

  it("opens the menu on a held MODE, steps with MODE, changes with RANGE, and sets the wind on the hot keys", () => {
    const { k, count } = make();
    k.press("mode", 0);
    k.release("mode", 0.1);
    k.press("mode", 2);
    k.update(3.1);
    expect(k.menuOpen()).toBe(true);
    k.release("mode", 3.2);
    expect(texts(k, 3.3)).toContain("RANGE MODE");
    k.press("mode", 4);
    k.release("mode", 4.1);
    expect(texts(k, 4.2)).toContain("TARGET");
    k.press("range", 5);
    k.release("range", 5.1);
    expect(k.settings.target).toBe("XR");
    k.press("mode", 6);
    k.update(7.1);
    k.release("mode", 7.2);
    expect(k.menuOpen()).toBe(false);
    expect(count()).toBe(0);
    // RANGE and MODE together for 3 s: wind speed, then direction.
    k.press("range", 10);
    k.press("mode", 10.05);
    k.update(13.1);
    expect(texts(k, 13.2)).toContain("WIND SPEED");
    k.release("range", 13.3);
    k.release("mode", 13.3);
    k.press("range", 14);
    k.release("range", 14.1);
    expect(k.settings.wind.mph).toBe(6);
    k.press("mode", 15);
    k.release("mode", 15.1);
    k.press("range", 16);
    k.release("range", 16.1);
    expect(k.settings.wind.clock).toBe(4);
  });
});

describe("hand on the device", () => {
  it("shakes about half a mrad RMS on each axis", () => {
    let sx = 0;
    let sy = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const [x, y] = handShakeMrad(i * 0.01);
      sx += x * x;
      sy += y * y;
    }
    expect(Math.sqrt(sx / n)).toBeGreaterThan(0.4);
    expect(Math.sqrt(sx / n)).toBeLessThan(0.6);
    expect(Math.sqrt(sy / n)).toBeGreaterThan(0.4);
    expect(Math.sqrt(sy / n)).toBeLessThan(0.6);
  });
});
