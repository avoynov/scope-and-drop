import { describe, expect, it } from 'vitest';
import { PARTS, inBody, type Vec3 } from '../src/body/anatomy';
import { assess, pressureAt, woundTrack, type TerminalId } from '../src/body/wound';
import { ROUNDS, at } from '../src/scope/ballistics';

/** A shot from the front, level, at a point on the body's front (x left, y up). */
const front = (x: number, y: number, round: TerminalId, speed: number, seed = 0) =>
  assess({ entry: [x, y, 0.2], dir: [0, 0, -1], speed, round, seed });
const maxCavity = (x: number, y: number, round: TerminalId, speed: number) =>
  Math.max(...woundTrack({ entry: [x, y, 0.2], dir: [0, 0, -1], speed, round, seed: 0 }).track.map((q) => q.cavity));
const SPEEDS: [TerminalId, number][] = [['sp5', at(ROUNDS.sp5, 183).v], ['7n1', at(ROUNDS['7n1'], 412).v], ['m118lr', at(ROUNDS.m118lr, 412).v]];

describe('anatomy', () => {
  it('puts every structure inside the body', () => {
    for (const p of PARTS) {
      const c: Vec3 = p.shape.kind === 'e' ? p.shape.c : [(p.shape.a[0] + p.shape.b[0]) / 2, (p.shape.a[1] + p.shape.b[1]) / 2, (p.shape.a[2] + p.shape.b[2]) / 2];
      expect(inBody(c), p.id).toBe(true);
    }
  });
});

describe('wound model', () => {
  it('a heart shot leaves 5–16 s of consciousness and kills, whatever the round', () => {
    for (const [round, v] of SPEEDS) for (let seed = 0; seed < 6; seed++) {
      const w = front(0.03, 1.25, round, v, seed);
      expect(w.outcome, round).toBe('killed');
      expect(w.unconsciousS).toBeGreaterThan(5);
      expect(w.unconsciousS).toBeLessThan(16);
      expect(w.fallS).toBeLessThanOrEqual(w.unconsciousS);
      expect(w.deathS).toBeLessThan(180);
    }
  });

  it('a brain shot drops them at once', () => {
    for (const [round, v] of SPEEDS) {
      const w = front(0.02, 1.63, round, v);
      expect(w.fallS).toBe(0);
      expect(w.unconsciousS).toBe(0);
      expect(w.outcome).toBe('killed');
    }
  });

  it('a hip joint drops them conscious; a broken pelvis is not by itself fatal', () => {
    const w = assess({ entry: [0.092, 0.885, 0.2], dir: [0.15, 0, -1], speed: 260, round: 'sp5', seed: 3 });
    expect(w.damage.some((d) => d.part.tissue === 'hip' && d.direct)).toBe(true);
    expect(w.fallS).toBeLessThan(1);
    expect(w.unconsciousS).toBeGreaterThan(w.fallS);
  });

  it('the spinal cord in the back drops them at once', () => {
    const w = assess({ entry: [0, 1.2, -0.2], dir: [0, 0, 1], speed: 260, round: 'sp5', seed: 1 });
    expect(w.damage[0]!.part.tissue).toBe('cord');
    expect(w.fallS).toBeLessThanOrEqual(0.1);
    expect(w.outcome).not.toBe('wounded');
  });

  it('a graze through the side of the chest wall is survivable', () => {
    for (let seed = 0; seed < 8; seed++) {
      const w = assess({ entry: [0.2, 1.38, 0.05], dir: [0.3, 0, -1], speed: 260, round: 'sp5', seed });
      expect(w.outcome, w.cause).not.toBe('killed');
      expect(w.deathS).toBe(Infinity);
    }
  });

  it('a near miss of the outline is no wound', () => {
    const w = front(0.3, 1.2, '7n1', 600);
    expect(w.trackM).toBe(0);
    expect(w.outcome).toBe('wounded');
    expect(w.damage).toEqual([]);
  });

  it('the temporary cavity grows with striking speed as in the 200/800 m sniper-round study (≈1.44×)', () => {
    const ratio = maxCavity(-0.08, 1.2, '7n1', at(ROUNDS['7n1'], 200).v) / maxCavity(-0.08, 1.2, '7n1', at(ROUNDS['7n1'], 800).v);
    expect(ratio).toBeGreaterThan(1.25);
    expect(ratio).toBeLessThan(1.65);
  });

  it('a tumbling 7.62 at 700 m/s opens a cavity ~20 cm across; the subsonic SP-5 a pistol-sized one', () => {
    const fast = 2 * maxCavity(-0.08, 1.2, '7n1', 700);
    const slow = 2 * maxCavity(-0.08, 1.2, 'sp5', at(ROUNDS.sp5, 183).v);
    expect(fast).toBeGreaterThan(0.15);
    expect(fast).toBeLessThan(0.26);
    // Like an expanded 9 mm hollow point (10–12 cm in gelatin): a 36 mm bullet going sideways.
    expect(slow).toBeLessThan(0.7 * fast);
    expect(slow).toBeGreaterThan(0.08);
  });

  it('the same liver hit is worse from a faster bullet', () => {
    const slow = front(-0.06, 1.12, '7n1', 400);
    const fast = front(-0.06, 1.12, '7n1', 750);
    const liver = (w: typeof slow) => w.damage.find((d) => d.part.id === 'liver')?.frac ?? 0;
    expect(liver(fast)).toBeGreaterThan(liver(slow) * 1.5);
    expect(fast.bloodLost60).toBeGreaterThan(slow.bloodLost60);
  });

  it('is repeatable for a seed', () => {
    expect(front(-0.1, 1.3, 'sp5', 260, 7)).toEqual(front(-0.1, 1.3, 'sp5', 260, 7));
  });

  it('holds blood pressure through the first 15 % lost, then loses it', () => {
    expect(pressureAt(0.1)).toBe(1);
    expect(pressureAt(0.35)).toBeLessThan(0.75);
    expect(pressureAt(0.6)).toBe(0);
  });
});
