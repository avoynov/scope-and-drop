/**
 * Deterministic, forkable PRNG (sfc32 seeded through cyrb128).
 *
 * `fork(label)` derives a child stream from the parent's *key*, not its
 * current state, so adding or removing draws in one generation stage never
 * reshuffles the output of another stage. Never use Math.random in the
 * generator: same seed => byte-identical blueprint.
 */

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class Rng {
  readonly key: string;
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string | number) {
    this.key = String(seed);
    [this.a, this.b, this.c, this.d] = cyrb128(this.key);
    // Warm up so near-identical keys diverge immediately.
    for (let i = 0; i < 12; i++) this.nextUint();
  }

  /** Independent child stream, stable regardless of draws made on this one. */
  fork(label: string | number): Rng {
    return new Rng(`${this.key}/${label}`);
  }

  nextUint(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Weighted pick from [item, weight] pairs. Zero weights are never picked. */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
    let total = 0;
    for (const [, w] of entries) total += Math.max(0, w);
    if (total <= 0) throw new Error('Rng.weighted with no positive weights');
    let r = this.next() * total;
    for (const [item, w] of entries) {
      if (w <= 0) continue;
      r -= w;
      if (r < 0) return item;
    }
    return entries[entries.length - 1]![0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** Approximately normal (Irwin–Hall, 4 samples), clamped to ±3 sd. */
  normal(mean: number, sd: number): number {
    const s = this.next() + this.next() + this.next() + this.next() - 2;
    return mean + Math.max(-3, Math.min(3, s * 1.7320508)) * sd;
  }
}

/** Quantise to a grid step so plans stay on tidy dimensions (and JSON stays short). */
export function snap(v: number, step = 0.05): number {
  // Divide by an integer (1/step) so results print cleanly (3.65, not 3.6500000000000004).
  const k = Math.round(1 / step);
  return Math.round(v * k) / k;
}
