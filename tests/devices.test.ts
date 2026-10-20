import { describe, expect, it } from "vitest";
import { windHoldMil } from "../src/scope/aids";
import { ROUNDS, holdRad } from "../src/scope/ballistics";
import { KILO8K, Kilo, PLAIN_LRF, beamRays, pickReturn, type RayHit } from "../src/scope/kilo";
import { BATTLE_ZERO_M, RIFLES, dialTiltRad, firstHit, fly, millerStability, type Rifle, type Vec3 } from "../src/scope/shot";
import { rigFor } from "../src/armoury/rig";
import { decodeKit } from "../src/armoury/loadout";

const texts = (k: Kilo, t: number) => k.screen(t).flatMap((o) => (o.k === "text" ? [o.s] : []));
/** Wakes the device and ranges once at t = 2. */
const rangeOnce = (k: Kilo) => {
  k.press("range", 0);
  k.release("range", 0.1);
  k.press("range", 2);
  k.release("range", 2.1);
  k.update(2.5);
};

describe("the KILO's profile", () => {
  it("solves for the rifle as loaded, and drops a reading made for another profile", () => {
    const k = new Kilo(RIFLES.bolt, () => ({ losM: 412, slopeRad: 0 }));
    rangeOnce(k);
    const m118 = k.reading!.sol!.elevMil;
    expect(texts(k, 2.6)).toContain("P1 M118LR");
    const sub = rigFor(decodeKit("bolt", "can,sub200")).rifle;
    k.setRifle(sub);
    expect(k.reading).toBeNull();
    k.press("range", 3);
    k.release("range", 3.1);
    k.update(3.5);
    // The subsonic load drops far more at 412 m.
    expect(k.reading!.sol!.elevMil).toBeGreaterThan(m118 + 5);
    expect(texts(k, 3.6)).toContain("P1 SUB200");
    // Profiles for the SVD and the VSS too.
    k.setRifle(RIFLES.vss);
    expect(k.profile()).toBe("P1 SP5");
  });
});

describe("the plain rangefinder", () => {
  it("gives the range and the angle and nothing else, a third of a second after the press", () => {
    let n = 0;
    const k = new Kilo(RIFLES.svd, () => (n++, { losM: 400.4, slopeRad: 0.05 }));
    k.kind = "plain";
    k.press("range", 0);
    k.release("range", 0.1);
    expect(texts(k, 0.5)).toContain("LRF");
    k.press("range", 2);
    k.release("range", 2.1);
    k.update(2.3);
    expect(n).toBe(0);
    k.update(2.34);
    expect(n).toBe(1);
    const shown = texts(k, 2.4);
    expect(shown).toContain("400.4");
    expect(shown).toContain("^3*");
    expect(shown.some((s) => /MIL|M\/S|P1/.test(s))).toBe(false);
    expect(Number.isNaN(k.reading!.sol!.elevMil)).toBe(true);
  });

  it("has no menus: holding MODE does nothing", () => {
    const k = new Kilo(RIFLES.svd, () => ({ losM: 400, slopeRad: 0 }));
    k.kind = "plain";
    k.press("mode", 0);
    k.release("mode", 0.1);
    k.press("mode", 2);
    k.update(4);
    expect(k.menuOpen()).toBe(false);
  });

  it("reaches a man only to about 640 m, and with its wide beam a rock behind him at 400 m can win", () => {
    const rays = beamRays(PLAIN_LRF.beamMrad);
    // A man 0.45 m wide at 400 m covers 1.1 of the beam's 2 mrad: the middle three columns of seven.
    const at = (m: number, rockBehind: boolean): RayHit[] => rays.map(([mx]) => (Math.abs(mx) < 0.5 ? { m, kind: "person" } : rockBehind ? { m: m + 4, kind: "rock" } : { m: Infinity, kind: "none" }));
    expect(pickReturn(at(400, true), PLAIN_LRF.target, PLAIN_LRF.reachM)).toBe(404);
    expect(pickReturn(at(400, false), PLAIN_LRF.target, PLAIN_LRF.reachM)).toBe(400);
    const full = (m: number): RayHit[] => rays.map(() => ({ m, kind: "person" }));
    expect(pickReturn(full(600), PLAIN_LRF.target, PLAIN_LRF.reachM)).toBe(600);
    expect(pickReturn(full(700), PLAIN_LRF.target, PLAIN_LRF.reachM)).toBeNull();
    // The KILO ranges him at 700 m.
    expect(pickReturn(full(700), "LAST")).toBe(700);
    expect(KILO8K.reachM.deer).toBeGreaterThan(1800);
  });
});

describe("the Kestrel's wind hold", () => {
  /** Where the bullet crosses the target's plane (m right of the aim) when held `holdMil` right in that wind. */
  const missRight = (rf: Rifle, rangeM: number, ms: number, clock: number, holdMil: number) => {
    const r = ROUNDS[rf.round];
    const th = (clock * Math.PI) / 6;
    const w: Vec3 = [-Math.sin(th) * ms, 0, Math.cos(th) * ms];
    const up = dialTiltRad(rf, 0) + holdRad(r, rangeM, BATTLE_ZERO_M, rf.sightM);
    const yaw = holdMil / 1000;
    const p = fly({
      round: r,
      mv: r.mv,
      origin: [0, -rf.sightM, 0],
      dir: [Math.sin(yaw) * Math.cos(up), Math.sin(up), -Math.cos(yaw) * Math.cos(up)],
      wind: (_x, _y, _z, _t, o) => ((o[0] = w[0]), (o[1] = w[1]), (o[2] = w[2]), o),
      sg: millerStability(rf, r.mv),
      floor: 1e4,
    });
    const h = firstHit(p, () => -1e9, (A, B) => (A[2] > -rangeM && B[2] <= -rangeM ? { f: (A[2] + rangeM) / (A[2] - B[2]), what: "plane" } : null));
    return h.pos[0];
  };

  it("puts the bullet on the aim point, within a centimetre, for the wind it reads and the round loaded", () => {
    const rifles = [RIFLES.svd, RIFLES.bolt, RIFLES.vss, rigFor(decodeKit("bolt", "can,sub200")).rifle, rigFor(decodeKit("svd", "sb180sp")).rifle];
    for (const rf of rifles) {
      const far = rf.round === "sp5" || rf.round === "sub200" ? 200 : 600;
      for (const [ms, clock] of [
        [4, 9],
        [6, 2.5],
        [2, 6],
      ] as const) {
        const hold = windHoldMil(rf, far, ms, clock);
        expect(Math.abs(missRight(rf, far, ms, clock, hold)), `${rf.round} ${ms} m/s from ${clock}`).toBeLessThan(0.01);
      }
    }
    // From 9 o'clock it blows the bullet right, so the hold is left.
    expect(windHoldMil(RIFLES.bolt, 400, 4, 9)).toBeLessThan(-0.5);
  });
});
