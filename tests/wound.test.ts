import { describe, expect, it } from 'vitest';
import { PARTS, classify, inBody, partVolume, torsoDepth, torsoRadius, type Vec3 } from '../src/body/anatomy';
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

  it('gives the organs their real volumes', () => {
    const mL = (pred: (id: string) => boolean) => PARTS.filter((p) => pred(p.id)).reduce((a, p) => a + partVolume(p), 0) * 1e6;
    const brain = mL((id) => ['cerebrum', 'cerebellum', 'deep', 'brainstem'].includes(id));
    expect(brain).toBeGreaterThan(1150); // adult male brain 1.2–1.45 L
    expect(brain).toBeLessThan(1500);
    expect(mL((id) => id === 'heart')).toBeGreaterThan(500); // heart with its chambers full
    expect(mL((id) => id === 'heart')).toBeLessThan(800);
    expect(mL((id) => id.startsWith('liver'))).toBeGreaterThan(1300); // 1.4–1.6 kg
    expect(mL((id) => id.startsWith('liver'))).toBeLessThan(1900);
    expect(mL((id) => id === 'spleen')).toBeGreaterThan(120);
    expect(mL((id) => id === 'spleen')).toBeLessThan(300);
    expect(mL((id) => id === 'kidney-l')).toBeGreaterThan(100);
    expect(mL((id) => id === 'kidney-l')).toBeLessThan(200);
  });

  it('puts organs at their real heights', () => {
    const at = (p: Vec3) => classify(p)?.id;
    // Under the right dome at the 5th rib: liver, with lung above it.
    expect(at([-0.07, 1.23, 0])).toBe('liver');
    expect(at([-0.07, 1.27, 0])).toBe('lung-r');
    // The heart behind the sternum at the nipples, its apex in the left 5th space.
    expect(classify([0.02, 1.25, 0.05])?.tissue).toBe('heart');
    expect(classify([0.075, 1.21, 0.045])?.tissue).toBe('heart');
    // Spleen at the left 10th rib behind, kidneys at L1 against the back.
    expect(at([0.105, 1.19, -0.05])).toBe('spleen');
    expect(at([0.07, 1.12, -0.03])).toBe('kidney-l');
    // The cord ends at L1/L2; below it the cauda equina.
    expect(at([0, 1.14, -0.051])).toBe('cord-t2');
    expect(at([0, 1.1, -0.049])).toBe('cauda');
  });

  it('lays the cord 4.5–6.5 cm under the skin of the back, and the torso as deep as a lean man', () => {
    for (const y of [1.2, 1.3]) {
      const back = torsoRadius(y) * torsoDepth(y);
      const cord = PARTS.find((p) => p.id === (y > 1.3 ? 'cord-t' : 'cord-t2'))!;
      const z = cord.shape.kind === 'c' ? cord.shape.a[2] + ((cord.shape.b[2] - cord.shape.a[2]) * (y - cord.shape.a[1])) / (cord.shape.b[1] - cord.shape.a[1]) : 0;
      expect(back + z).toBeGreaterThan(0.045);
      expect(back + z).toBeLessThan(0.065);
    }
    const depth = (y: number) => 2 * torsoRadius(y) * torsoDepth(y);
    expect(depth(1.24)).toBeGreaterThan(0.2); // chest at the nipples, 20–24 cm
    expect(depth(1.24)).toBeLessThan(0.24);
    expect(depth(1.1)).toBeGreaterThan(0.18); // waist
    expect(depth(1.1)).toBeLessThan(0.22);
  });
});

describe('wound model', () => {
  it('a heart shot leaves 5–16 s of consciousness and kills, whatever the round', () => {
    let fast = 0;
    for (const [round, v] of SPEEDS) for (let seed = 0; seed < 6; seed++) {
      const w = front(0.03, 1.25, round, v, seed);
      expect(w.outcome, round).toBe('killed');
      expect(w.unconsciousS).toBeGreaterThan(5);
      expect(w.unconsciousS).toBeLessThan(60);
      if (w.unconsciousS < 16) fast++;
      expect(w.fallS).toBeLessThanOrEqual(w.unconsciousS);
      expect(w.deathS).toBeLessThan(180);
    }
    // Now and then a small hole lets the heart beat on a little longer.
    expect(fast).toBeGreaterThanOrEqual(15);
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
    const w = assess({ entry: [0.09, 0.895, 0.2], dir: [0, 0, -1], speed: 260, round: 'sp5', seed: 3 });
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
      const w = assess({ entry: [0.17, 1.3, 0.2], dir: [0, 0, -1], speed: 260, round: 'sp5', seed });
      expect(w.trackM, w.cause).toBeGreaterThan(0.02);
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

  it('the temporary cavity grows with striking speed by about v^0.8 (fitted to the 200/800 m sniper-round study)', () => {
    const ratio = maxCavity(0, 1.0, '7n1', 700) / maxCavity(0, 1.0, '7n1', 400);
    expect(ratio).toBeGreaterThan(1.4);
    expect(ratio).toBeLessThan(1.7);
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

  it('holds blood pressure through class II, loses it through classes III and IV', () => {
    expect(pressureAt(0.1)).toBe(1);
    expect(pressureAt(0.25)).toBeGreaterThan(0.9);
    expect(pressureAt(0.35)).toBeLessThan(0.85);
    expect(pressureAt(0.45)).toBeLessThan(0.55);
    expect(pressureAt(0.6)).toBe(0);
  });

  it('cutting the cord high in the neck stops breathing but leaves them conscious for a minute or two', () => {
    const w = assess({ entry: [0, 1.505, -0.2], dir: [0, 0, 1], speed: 260, round: 'sp5', seed: 2 });
    expect(w.damage.some((d) => d.part.level === 'C1-C4' && d.direct)).toBe(true);
    expect(w.cause).toContain('cannot breathe');
    expect(w.fallS).toBe(0);
    // Sooner than breath-holding alone: the same bullet cut both carotids.
    expect(w.unconsciousS).toBeGreaterThan(25);
    expect(w.unconsciousS).toBeLessThan(130);
    expect(w.deathS).toBeGreaterThan(w.unconsciousS);
    expect(w.outcome).toBe('killed');
  });

  it('a hole through the edge of a lung is survivable; through its root it is not', () => {
    for (let seed = 0; seed < 4; seed++) {
      const edge = front(-0.12, 1.3, 'sp5', 260, seed);
      expect(edge.outcome, edge.cause).not.toBe('killed');
      const root = front(-0.055, 1.3, '7n1', at(ROUNDS['7n1'], 412).v, seed);
      expect(root.outcome, root.cause).toBe('killed');
      expect(root.deathS).toBeLessThan(600);
    }
  });

  it('a femoral artery bleeds them unconscious in minutes, not seconds', () => {
    const w = front(0.07, 0.88, 'sp5', 260, 0);
    expect(w.damage.some((d) => d.part.id === 'femoral-l' && d.direct)).toBe(true);
    expect(w.unconsciousS).toBeGreaterThan(90);
    expect(w.unconsciousS).toBeLessThan(300);
    expect(w.deathS).toBeLessThan(480);
  });
});
