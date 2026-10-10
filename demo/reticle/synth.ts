/**
 * Synthesised rifle sounds, sample by sample, for when no recording of the real thing is in demo/reticle/sounds/
 * (see audio.ts). Built from the physics of what makes each sound:
 *  - a report is a blast wave: a Friedlander pulse (a near-instant rise, then a decay through zero into a
 *    shallower negative phase), its reflection off the ground a fraction of a millisecond later, and the
 *    terrain's roll after it. A suppressor stretches and weakens the pulse until the action's clatter is as
 *    loud as it is;
 *  - steel parts that strike a stop ring at their own inharmonic modes for a few tens of milliseconds, after a
 *    broadband contact click; heavier parts ring lower and longer, and a blow is felt as a low thump;
 *  - parts sliding on each other make friction noise, a band of noise chopped by stick-slip;
 *  - a coil spring compressed or let go sings for a moment;
 *  - a brass case in the dirt is a soft thud and a short, damped ring.
 * Pure numbers, no audio API: `render` returns a mono buffer peaking at 1.
 */
import type { SoundEvent } from '../../src/scope/handling';
import type { RifleId } from '../../src/scope/shot';

export type Synth = SoundEvent | 'shot';

/** Mulberry32: a small seeded generator, so each variant is repeatable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per rifle: how much heavier its parts are than the bolt rifle's, and how much higher they ring. */
const PARTS: Record<RifleId, { mass: number; pitch: number; steelCase: boolean }> = {
  bolt: { mass: 1, pitch: 1, steelCase: false },
  svd: { mass: 1.2, pitch: 0.86, steelCase: true },
  vss: { mass: 0.9, pitch: 1.12, steelCase: true },
};

type Mode = [freq: number, tau: number, amp: number];

class Buf {
  readonly d: Float32Array;
  constructor(readonly sr: number, seconds: number, readonly r: () => number) {
    this.d = new Float32Array(Math.ceil(sr * seconds));
  }
  /** Ringing modes struck at t0, each with a little random detune and phase. */
  modes(t0: number, amp: number, modes: Mode[], pitch = 1): void {
    const i0 = Math.round(t0 * this.sr);
    for (const [f0, tau, a] of modes) {
      const f = f0 * pitch * (0.97 + 0.06 * this.r());
      const ph = this.r() * Math.PI * 2;
      const w = (2 * Math.PI * f) / this.sr;
      const n = Math.min(this.d.length - i0, Math.ceil(tau * 7 * this.sr));
      const k = Math.exp(-1 / (tau * this.sr));
      let e = amp * a;
      for (let i = 0; i < n; i++) {
        // A 0.15 ms onset keeps the strike from clicking digitally.
        const on = Math.min(1, i / (0.00015 * this.sr));
        this.d[i0 + i]! += e * on * Math.sin(w * i + ph);
        e *= k;
      }
    }
    this.click(t0, amp * 0.5, 0.00025);
  }
  /** Broadband contact click: a few hundred microseconds of decaying, differentiated noise. */
  click(t0: number, amp: number, tau: number): void {
    const i0 = Math.round(t0 * this.sr);
    const n = Math.min(this.d.length - i0, Math.ceil(tau * 8 * this.sr));
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const x = this.r() * 2 - 1;
      this.d[i0 + i]! += amp * (x - prev) * 0.7 * Math.exp(-i / (tau * this.sr));
      prev = x;
    }
  }
  /** A low thump felt through the stock: a sine dropping in pitch. */
  thump(t0: number, amp: number, f: number, tau: number): void {
    const i0 = Math.round(t0 * this.sr);
    const n = Math.min(this.d.length - i0, Math.ceil(tau * 6 * this.sr));
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / this.sr;
      ph += (2 * Math.PI * f * (0.7 + 0.3 * Math.exp(-t / tau))) / this.sr;
      this.d[i0 + i]! += amp * Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.0008);
    }
  }
  /**
   * Friction: noise through a band-pass swept from f0 to f1, chopped by stick-slip (a fresh grain every so
   * often, `rough` 0 smooth … 1 gritty), under a rise-and-fall envelope.
   */
  scrape(t0: number, dur: number, amp: number, f0: number, f1: number, rough: number, q = 1.6): void {
    const i0 = Math.round(t0 * this.sr);
    const n = Math.min(this.d.length - i0, Math.ceil(dur * this.sr));
    let z1 = 0;
    let z2 = 0;
    let grain = 1;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      if (i % 32 === 0) {
        // Stick-slip: the grain's level jumps at a few hundred times a second.
        if (this.r() < (32 / this.sr) * (200 + 700 * rough)) grain = 0.35 + 0.65 * this.r() + rough * (this.r() < 0.15 ? 1.2 : 0);
      }
      const f = f0 * Math.pow(f1 / f0, u);
      // State-variable band-pass.
      const g = Math.tan((Math.PI * f) / this.sr);
      const x = this.r() * 2 - 1;
      const hp = (x - (1 / q + g) * z1 - z2) / (1 + g / q + g * g);
      const bp = g * hp + z1;
      z1 = g * hp + bp;
      const lp = g * bp + z2;
      z2 = g * bp + lp;
      const env = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7;
      this.d[i0 + i]! += amp * bp * env * grain;
    }
  }
  /** A coil spring singing: a few close, beating modes under a short swell. */
  spring(t0: number, dur: number, amp: number, f: number): void {
    const i0 = Math.round(t0 * this.sr);
    const n = Math.min(this.d.length - i0, Math.ceil((dur + 0.08) * this.sr));
    const fs = [f, f * 1.013, f * 2.74, f * 4.9];
    const ph = fs.map(() => this.r() * 6.28);
    for (let i = 0; i < n; i++) {
      const t = i / this.sr;
      const env = Math.min(1, t / (dur * 0.6)) * Math.exp(-Math.max(0, t - dur * 0.6) / 0.03);
      let s = 0;
      fs.forEach((x, k) => (s += Math.sin(2 * Math.PI * x * t + ph[k]!) / (k + 1)));
      this.d[i0 + i]! += amp * env * s * (0.7 + 0.3 * (this.r() * 2 - 1));
    }
  }
  /**
   * A blast wave: Friedlander pulse p(t) = P (1 − t/T) e^(−b t/T), positive for T, then the shallower negative
   * phase; its ground reflection `refl` later; then low, decaying noise for the terrain's roll.
   */
  blast(t0: number, amp: number, T: number, b: number, refl: number, roll: number, rollTau: number, rollTop: number): void {
    const i0 = Math.round(t0 * this.sr);
    const fried = (t: number) => (t < 0 ? 0 : (1 - t / T) * Math.exp((-b * t) / T));
    const n = Math.min(this.d.length - i0, Math.ceil(T * 14 * this.sr));
    for (let i = 0; i < n; i++) {
      const t = i / this.sr;
      this.d[i0 + i]! += amp * (fried(t) + 0.55 * fried(t - refl));
    }
    // Roll: noise low-passed ever lower as it dies away (the ground and the air take the treble first).
    const m = Math.min(this.d.length - i0, Math.ceil(rollTau * 6 * this.sr));
    let y = 0;
    for (let i = 0; i < m; i++) {
      const t = i / this.sr;
      const fc = rollTop * Math.exp(-t / (rollTau * 1.5)) + 120;
      const a = 1 - Math.exp((-2 * Math.PI * fc) / this.sr);
      y += a * (this.r() * 2 - 1 - y);
      this.d[i0 + i]! += amp * roll * y * Math.min(1, t / 0.006) * Math.exp(-t / rollTau);
    }
  }
}

/** Seconds of buffer each sound needs. */
const LENGTH: Record<Synth, number> = {
  shot: 2.2, 'bolt-up': 0.2, 'bolt-back': 0.32, 'bolt-forward': 0.32, 'bolt-down': 0.18, 'case-land': 0.22,
  'mag-release': 0.08, 'mag-out': 0.3, 'mag-in': 0.45, 'carrier-close': 0.35, 'charge-back': 0.3, 'charge-release': 0.4,
};

/** One take of a sound, `seed` choosing the variant, at `sr` samples per second. */
export function render(ev: Synth, rifle: RifleId, seed: number, sr: number): Float32Array {
  const r = rng(seed * 7919 + ev.length * 131 + rifle.length);
  const b = new Buf(sr, LENGTH[ev], r);
  const P = PARTS[rifle];
  const p = P.pitch;
  const heavy = P.mass;
  switch (ev) {
    case 'shot':
      if (rifle === 'vss') {
        // Suppressed and subsonic: a muffled pop and the gas easing out of the can, with the bolt carrier
        // slamming back and home as loud as the shot itself, and the case pinging off the ejector.
        b.blast(0, 0.32, 0.0032, 1.6, 0.0004, 0.5, 0.05, 1400);
        b.scrape(0.002, 0.06, 0.16, 1200, 500, 0.3, 0.9);
        b.modes(0.009, 0.42, [[1350, 0.035, 1], [2350, 0.024, 0.75], [3800, 0.014, 0.5], [6100, 0.007, 0.3]], p);
        b.thump(0.009, 0.25, 160, 0.03);
        b.modes(0.024, 0.08, [[4200, 0.02, 1], [6900, 0.012, 0.5]], 1);
        b.modes(0.058, 0.5, [[1180, 0.04, 1], [2050, 0.028, 0.7], [3300, 0.016, 0.45], [5200, 0.008, 0.3]], p);
      } else {
        // Open muzzle, 160 dB at the ear: a sharp crack-boom, the ground's echo almost on top of it, and the
        // desert's short roll. The SVD's action cycles under it; the bolt rifle's brake throws the blast back.
        const svd = rifle === 'svd';
        b.blast(0, 1, svd ? 0.00095 : 0.0008, 1.25, 0.0006, svd ? 0.18 : 0.22, 0.45, 2600);
        b.thump(0, 0.55, 75, 0.06);
        b.click(0, 0.6, 0.0003);
        if (svd) {
          b.modes(0.012, 0.22, [[1150, 0.04, 1], [1950, 0.03, 0.7], [3100, 0.018, 0.45]], p);
          b.modes(0.07, 0.3, [[1250, 0.05, 1], [2100, 0.035, 0.7], [3300, 0.02, 0.45]], p);
        } else {
          // The barrel and brake ring for a moment after the blast.
          b.modes(0.001, 0.05, [[2900, 0.06, 1], [5300, 0.04, 0.5]], 1);
        }
      }
      break;
    case 'bolt-up':
      // The cocking cam lifts the striker: a rough rising scrape, then the cocking piece drops into its notch.
      b.scrape(0, 0.085, 0.13, 2400, 3600, 0.7);
      b.modes(0.085, 0.33, [[3150, 0.018, 1], [5230, 0.012, 0.6], [7900, 0.006, 0.35]], p);
      b.modes(0.088, 0.08, [[1200, 0.02, 1]], p);
      break;
    case 'bolt-back':
      // The bolt body runs back along the raceways; the ejector flicks the case out and the bolt stop catches it.
      b.scrape(0, 0.16, 0.15, 1700, 2600, 0.35, 1.2);
      b.modes(0.14, 0.18, [[4300, 0.03, 1], [6900, 0.02, 0.5], [9800, 0.01, 0.3]], 1);
      b.modes(0.166, 0.55, [[1850, 0.035, 1], [3250, 0.022, 0.7], [5100, 0.012, 0.45], [7400, 0.006, 0.3]], p);
      b.thump(0.166, 0.14, 220, 0.025);
      break;
    case 'bolt-forward':
      // Forward: the bolt face strips the top round off the magazine lips, the round chambers, the bolt stops.
      b.scrape(0, 0.17, 0.14, 1900, 2500, 0.35, 1.2);
      b.scrape(0.045, 0.03, 0.2, 3400, 4800, 0.8, 2);
      b.modes(0.05, 0.12, [[3000, 0.012, 1], [5500, 0.007, 0.5]], 1);
      b.scrape(0.1, 0.07, 0.08, 2800, 3600, 0.5);
      b.modes(0.176, 0.6, [[1400, 0.04, 1], [2600, 0.025, 0.6], [4100, 0.014, 0.4], [6300, 0.007, 0.25]], p);
      b.thump(0.176, 0.18, 160, 0.03);
      break;
    case 'bolt-down':
      // The lugs turn into their recesses and the handle seats in its notch.
      b.scrape(0, 0.06, 0.07, 2600, 3400, 0.5);
      b.modes(0.07, 0.42, [[2300, 0.02, 1], [4400, 0.012, 0.5], [6900, 0.006, 0.3]], p);
      b.thump(0.07, 0.08, 200, 0.02);
      break;
    case 'case-land': {
      // A fired case in the dirt a metre to the right: a soft thud and a damped ring, then a smaller bounce.
      const ring: Mode[] = P.steelCase ? [[4300, 0.008, 1], [7100, 0.005, 0.6], [10400, 0.003, 0.3]] : [[5600, 0.012, 1], [8800, 0.007, 0.6], [12100, 0.004, 0.3]];
      b.scrape(0, 0.006, 0.12, 500, 300, 1, 0.8);
      b.modes(0, 0.07, ring, 1);
      const t2 = 0.06 + 0.04 * r();
      b.scrape(t2, 0.005, 0.05, 500, 300, 1, 0.8);
      b.modes(t2, 0.028, ring, 1.02);
      break;
    }
    case 'mag-release':
      b.modes(0, 0.18 * heavy, [[3600, 0.01, 1], [6200, 0.006, 0.5]], p);
      break;
    case 'mag-out':
      if (rifle === 'bolt') {
        // The box slides down out of the well, its spring and follower rattling.
        b.scrape(0, 0.07, 0.12, 1500, 1100, 0.6);
        b.modes(0.06, 0.2, [[950, 0.04, 1], [1750, 0.03, 0.7], [2600, 0.02, 0.5]], 1);
      } else {
        // Rocked forward off the catch: the steel body grinds round its front lug and drops off it.
        b.scrape(0, 0.12, 0.13, 1300, 900, 0.6);
        b.modes(0.11, 0.3 * heavy, [[820, 0.05, 1], [1500, 0.035, 0.7], [2300, 0.02, 0.5]], p);
        b.thump(0.11, 0.1, 180, 0.03);
      }
      break;
    case 'mag-in':
      if (rifle === 'bolt') {
        // Pushed straight up the well until the catch snaps over, with the heel of the hand behind it.
        b.scrape(0, 0.13, 0.12, 1300, 1900, 0.5);
        b.modes(0.145, 0.6, [[2800, 0.02, 1], [4600, 0.014, 0.6], [7000, 0.007, 0.35]], p);
        b.thump(0.145, 0.22, 180, 0.03);
      } else {
        // Front lug into its recess (a clunk), rocked back with a grind, and the catch snaps over the rear lug.
        b.modes(0, 0.25 * heavy, [[900, 0.04, 1], [1600, 0.025, 0.6]], p);
        b.scrape(0.01, 0.23, 0.11, 1000, 1500, 0.55);
        b.modes(0.245, 0.65, [[2500, 0.025, 1], [4100, 0.016, 0.6], [6300, 0.008, 0.35]], p);
        b.thump(0.245, 0.25, 170, 0.035);
      }
      break;
    case 'carrier-close':
      // The follower lets the carrier go: the recoil spring drives it home on an empty chamber.
      b.spring(0, 0.045, 0.06, 1650 * p);
      b.scrape(0, 0.045, 0.1, 1800, 2400, 0.4);
      b.modes(0.045, 0.75, [[1150, 0.06, 1], [1950, 0.045, 0.8], [3100, 0.028, 0.55], [4700, 0.014, 0.35]], p);
      b.thump(0.045, 0.28, 140, 0.04);
      break;
    case 'charge-back':
      // Hand-pulled against the recoil spring until the carrier hits the back of its travel.
      b.spring(0, 0.16, 0.05, 1500 * p);
      b.scrape(0, 0.16, 0.13, 1500, 2200, 0.45);
      b.modes(0.16, 0.4, [[1600, 0.03, 1], [2900, 0.02, 0.6], [4500, 0.01, 0.35]], p);
      b.thump(0.16, 0.1, 190, 0.025);
      break;
    case 'charge-release':
      // Let go: the spring slams the carrier home, stripping a round on the way and locking the bolt.
      b.spring(0, 0.045, 0.07, 1700 * p);
      b.scrape(0, 0.045, 0.12, 2000, 2800, 0.5);
      b.scrape(0.018, 0.02, 0.18, 3000, 4200, 0.9, 2);
      b.modes(0.046, 0.85, [[1250, 0.055, 1], [2100, 0.04, 0.75], [3300, 0.025, 0.5], [5200, 0.012, 0.3]], p);
      b.thump(0.046, 0.3, 150, 0.04);
      break;
  }
  // Every take peaks at full scale: how loud each sound plays against the others is set where it is played.
  let peak = 0;
  for (const x of b.d) peak = Math.max(peak, Math.abs(x));
  if (peak > 0) for (let i = 0; i < b.d.length; i++) b.d[i]! /= peak;
  return b.d;
}
