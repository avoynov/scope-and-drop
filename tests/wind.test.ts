import { describe, expect, it } from 'vitest';
import { ROUNDS } from '../src/scope/ballistics';
import { fly } from '../src/scope/shot';
import { GUST_TILE_N, gustTile, halfExact, profileShare, shelterWind, terrainWind, wakeDeficit, windAt, type Obstacle, type Wind } from '../src/scope/wind';
import { generateMansion, matchWind, windObstacles } from '../src/mansion';

const speed = (w: Wind, x: number, y: number, z: number, t: number) => Math.hypot(...windAt(w, x, y, z, t));
const corr = (a: number[], b: number[]) => {
  const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
  let sab = 0, saa = 0, sbb = 0;
  a.forEach((v, i) => { sab += (v - ma) * (b[i]! - mb); saa += (v - ma) ** 2; sbb += (b[i]! - mb) ** 2; });
  return sab / Math.sqrt(saa * sbb);
};

describe('gusts', () => {
  it('blows from the clock direction it is set to, and gusts around its mean', () => {
    const v = windAt({ speed: 4, fromClock: 9, gust: 0 }, 0, 1, 0, 0);
    // From 9 o'clock it blows left to right, at full value.
    expect(v[0]).toBeCloseTo(4, 0);
    expect(Math.abs(v[2])).toBeLessThan(1);
    expect(windAt({ speed: 4, fromClock: 12, gust: 0 }, 0, 1, 0, 0)[2]).toBeGreaterThan(3.5);
    const g = { speed: 4, fromClock: 9, gust: 0.35 };
    let lo = Infinity, hi = 0, sum = 0;
    for (let t = 0; t < 600; t += 0.5) {
      const s = speed(g, 0, 1, 0, t);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
      sum += s;
    }
    expect(sum / 1200).toBeGreaterThan(3.4);
    expect(sum / 1200).toBeLessThan(4.6);
    expect(hi - lo).toBeGreaterThan(1.5);
    // Not the same wind at the target as at the shooter.
    expect(windAt(g, 0, 1, -412, 30)[0]).not.toBeCloseTo(windAt(g, 0, 1, 0, 30)[0], 2);
  });

  it('carries each gust downwind at the wind speed, so what passes a bush upwind reaches the line later', () => {
    // 5 m/s from 9 o'clock blows along +x: the air at x = 0 now is at x = 50 ten seconds on.
    const w = { speed: 5, fromClock: 9, gust: 0.3 };
    const here: number[] = [], carried: number[] = [], sameTime: number[] = [];
    for (let t = 0; t < 2000; t += 1.7) {
      here.push(speed(w, 0, 1, -100, t));
      carried.push(speed(w, 50, 1, -100, t + 10));
      sameTime.push(speed(w, 50, 1, -100, t));
    }
    expect(corr(here, carried)).toBeGreaterThan(0.6);
    expect(corr(here, carried)).toBeGreaterThan(corr(here, sameTime) + 0.25);
  });

  it('keeps the gusts as strong halfway between two eddy generations as at either', () => {
    // The fade between tile slices is normalised, so the gusts don't pulse every 20 s.
    const w = { speed: 4, fromClock: 9, gust: 0.3 };
    const spread = (phase: number) => {
      const v: number[] = [];
      for (let k = 0; k < 400; k++) v.push(speed(w, k * 37.3, 1, -k * 11.9, k * 20 + phase));
      const m = v.reduce((s, x) => s + x, 0) / v.length;
      return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
    };
    expect(spread(10) / spread(0.01)).toBeGreaterThan(0.8);
    expect(spread(10) / spread(0.01)).toBeLessThan(1.25);
  });

  it('holds its tile in numbers a half float carries exactly, so the GPU reads the same field', () => {
    const t = gustTile();
    expect(t.length).toBe(GUST_TILE_N * GUST_TILE_N * 2);
    for (let i = 0; i < t.length; i += 97) {
      const v = t[i]!;
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      // Eleven significant bits: what a half float's mantissa holds.
      if (v !== 0) {
        const step = 2 ** (Math.floor(Math.log2(Math.abs(v))) - 10);
        expect(v / step).toBe(Math.round(v / step));
      }
    }
    expect(halfExact(0.123456)).toBeCloseTo(0.123456, 3);
  });
});

describe('the ground', () => {
  const flat = terrainWind(() => 0, -500, -500, 500, 500, 10);
  const still = (terrain: Wind['terrain'], fromClock = 9, speed = 5): Wind => ({ speed, fromClock, gust: 0, terrain });

  it('slows the air near the ground: a log profile, quoted at 3 m', () => {
    const w = still(flat);
    expect(speed(w, 0, 3, 0, 0)).toBeCloseTo(5, 1);
    expect(speed(w, 0, 0.5, 0, 0)).toBeCloseTo(5 * profileShare(0.5), 1);
    expect(profileShare(0.5)).toBeCloseTo(0.61, 2);
    expect(speed(w, 0, 10, 0, 0)).toBeGreaterThan(6);
  });

  // A ridge across the wind from 9 o'clock: 20 m high, crest at x = 0, slopes ±10° or so.
  const ridgeH = (x: number) => 20 * Math.exp(-((x / 80) ** 2));
  const ridge = terrainWind((x) => ridgeH(x), -600, -300, 600, 300, 5);

  it('lifts the air up a windward slope, drops it down the lee, and speeds it up over the crest', () => {
    const w = still(ridge);
    const at = (x: number, agl: number) => windAt(w, x, ridgeH(x) + agl, 0, 0);
    // Windward slope (x < 0, the ground rising to the right, the way the wind goes): it climbs.
    expect(at(-60, 2)[1]).toBeGreaterThan(0.3);
    // Lee slope: it sinks.
    expect(at(60, 2)[1]).toBeLessThan(-0.3);
    // Following the ground: vertical ≈ horizontal × slope near the ground.
    const slope = (ridgeH(-59.5) - ridgeH(-60.5)) / 1;
    const v = at(-60, 2);
    expect(v[1] / v[0]).toBeCloseTo(slope * Math.exp(-2 / 30), 1);
    // Crest speed-up: faster at 3 m on the crest than at 3 m on the flat far off.
    expect(speed(w, 0, ridgeH(0) + 3, 0, 0) / speed(w, -500, 3, 0, 0)).toBeGreaterThan(1.1);
    // High above the ground the hill hardly matters.
    expect(Math.abs(windAt(w, -60, 400, 0, 0)[1])).toBeLessThan(0.02);
  });

  it('runs along a ridge without lifting when it blows along it', () => {
    const w = still(ridge, 12);
    expect(Math.abs(windAt(w, -60, ridgeH(-60) + 2, 0, 0)[1])).toBeLessThan(0.05);
  });

  it('leaves a lull behind a lee slope too steep to follow', () => {
    // A 30 m step falling away downwind at about 30°.
    const cliffH = (x: number) => 30 / (1 + Math.exp(x / 12));
    const cliff = terrainWind((x) => cliffH(x), -400, -100, 400, 100, 4);
    const w = still(cliff);
    const lee = speed(w, 0, cliffH(0) + 3, 0, 0) / speed(w, 300, 3, 0, 0);
    expect(lee).toBeLessThan(0.75);
  });
});

describe('trees and buildings', () => {
  const ground = () => 0;
  const house: Obstacle = { x: 0, z: 0, hx: 15, hz: 10, base: 0, height: 12, porosity: 0 };
  const oak: Obstacle = { x: 0, z: 0, r: 6, base: 0, height: 18, porosity: 0.45 };
  const bake = (o: Obstacle[], fromClock = 9) => shelterWind(o, fromClock, ground, -300, -300, 400, 300, 2);
  const w = (o: Obstacle[], fromClock = 9): Wind => ({ speed: 5, fromClock, gust: 0, shelter: bake(o, fromClock) });

  it('has no wind inside a building, below its roof', () => {
    expect(speed(w([house]), 0, 3, 0, 0)).toBeLessThan(0.01);
    expect(speed(w([house]), 0, 30, 0, 0)).toBeCloseTo(5, 1);
  });

  it('keeps the wind down for 10–20 heights behind, deepest a few heights behind, and not beside', () => {
    const s = w([house]);
    // From 9 o'clock the wake runs off along +x from the lee wall at x = 15.
    const behind = (h: number) => speed(s, 15 + h * 12, 2, 0, 0) / 5;
    expect(behind(1)).toBeLessThan(0.2);
    expect(behind(5)).toBeGreaterThan(behind(1));
    expect(behind(12)).toBeGreaterThan(0.8);
    expect(behind(25)).toBeGreaterThan(0.98);
    // Off to the side of the wake, and well above it, the wind is whole.
    expect(speed(s, 40, 2, 60, 0)).toBeCloseTo(5, 1);
    expect(speed(s, 40, 40, 0, 0)).toBeCloseTo(5, 1);
    // A little slower in front of it, where the air starts to climb over.
    expect(speed(s, -20, 2, 0, 0) / 5).toBeLessThan(0.95);
  });

  it('lets wind through a tree, and shelters less behind a lone tree than behind a wall of the same height', () => {
    expect(speed(w([oak]), 0, 8, 0, 0) / 5).toBeCloseTo(0.45, 1);
    expect(wakeDeficit(36, 18, 12, 0.45)).toBeLessThan(wakeDeficit(36, 18, 200, 0.45));
    expect(wakeDeficit(36, 18, 200, 0)).toBeGreaterThan(wakeDeficit(36, 18, 200, 0.45));
  });

  it('turns the wake with the wind', () => {
    const s = w([house], 12);
    // From 12 the air goes toward +z: the wake is behind the wall at z = 10, not off to +x.
    expect(speed(s, 0, 2, 40, 0) / 5).toBeLessThan(0.7);
    expect(speed(s, 60, 2, 0, 0) / 5).toBeGreaterThan(0.95);
  });

  it('takes the wind off the last metres of a shot into a room', () => {
    // A VSS shot across 183 m whose last 8 m are inside the house: a touch less drift than in the open.
    const sp5 = ROUNDS.sp5;
    const room: Obstacle = { x: 0, z: -186, hx: 10, hz: 7, base: -5, height: 15, porosity: 0 };
    const open: Wind = { speed: 5, fromClock: 9, gust: 0 };
    const sheltered: Wind = { ...open, shelter: shelterWind([room], 9, () => -5, -100, -260, 100, 20, 2) };
    const drift = (wd: Wind) => {
      const p = fly({ round: sp5, mv: sp5.mv, origin: [0, 0, 0], dir: [0, 0.012, -1], wind: (x, y, z, t, o) => windAt(wd, x, y, z, t, o) });
      const i = Array.from({ length: p.n }, (_, k) => k).find((k) => p.pos[k * 3 + 2]! <= -183)!;
      return p.pos[i * 3]!;
    };
    expect(drift(sheltered)).toBeLessThan(drift(open));
    expect(drift(sheltered)).toBeGreaterThan(0.9 * drift(open));
  });
});

describe('a match on the mansion site', () => {
  const bp = generateMansion({ seed: 'wind-1' });

  it('bakes the house and the trees for the match in well under a second', () => {
    const obstacles = windObstacles(bp);
    expect(obstacles.length).toBe(bp.masses.length + bp.site.trees.length);
    const t0 = performance.now();
    const w = matchWind(bp, 5, 9);
    expect(performance.now() - t0).toBeLessThan(1500);
    // Inside the house, nothing; on the open lawn in front of it, about the wind at 3 m.
    const m = bp.masses[0]!.rect;
    expect(speed(w, (m.x0 + m.x1) / 2, 3, (m.z0 + m.z1) / 2, 0)).toBeLessThan(0.05);
    const eye = bp.site.perch.eye;
    const lawn = { x: (eye.x + 0) / 2, z: (eye.z + bp.site.perch.target.z) / 2 };
    expect(speed(w, lawn.x, 3, lawn.z, 0)).toBeGreaterThan(2.5);
  });
});
