/**
 * Knowing each other by sight (milestone 2 technical plan: Recognising people). The innocent
 * half of seeing through a disguise: people remember how those they know look and behave,
 * compare whenever they see them, and an unexplained change grows into a double take, then a
 * friendly test. The real person always passes, so this milestone never goes further;
 * milestone 3 lets an impostor fail.
 */
import type { Rng } from "../mansion/core/rng";
import type { Person, Quirk } from "./types";

/** Features per look: height (cm), build, gait, voice, quirks (bits), drink, outfit hue, outfit state. */
export const FEATURES = 8;
const F_HEIGHT = 0;
const F_BUILD = 1;
const F_GAIT = 2;
const F_VOICE = 3;
const F_QUIRKS = 4;
const F_HUE = 6;
const F_STATE = 7;

/** 0 stranger, 1 met tonight, 2 acquaintance, 3 friend, 4 close friend or family, 5 partner. */
export type Tie = 0 | 1 | 2 | 3 | 4 | 5;
export const TIE_WEIGHT: readonly number[] = [0, 0.2, 0.5, 0.7, 0.9, 1];

/** Doubt halves over this long (in-game s). */
const DOUBT_HALF = 20 * 60;
/** Getting used to a known change: half-way over this long (in-game s). */
const USED_TO = 15 * 60;
export const DOUBLE_TAKE = 0.2;
export const TEST = 0.45;
export const COMPARE = 0.6;
export const SURE = 0.85;

const QUIRK_BITS: readonly Quirk[] = ["glasses", "limp", "cane", "ear-scratch", "globe-pointer", "dances-after-drink", "hands-in-pockets", "tie-adjust", "big-laugh", "smoker", "watch-check"];

/** What a sighting brings about. */
export type IdentEvent = "double-take" | "test" | "want-test" | null;

export class Ident {
  readonly n: number;
  /** How each person looks now, as others perceive it (n × FEATURES). */
  readonly look: Float32Array;
  readonly tie: Uint8Array;
  /** How i remembers j (n × n × FEATURES). */
  readonly memLook: Float32Array;
  /** How strongly i feels j is "not themselves", and when it was last brought up to date. */
  readonly doubt: Float32Array;
  private readonly doubtT: Float32Array;
  /** 0 nothing yet, 1 a double take, 2 tested and passed. */
  readonly stage: Uint8Array;
  /** Each person's own voice, before drink raises it. */
  private readonly voice: Float32Array;
  /** A test i wants to put to j, or -1. */
  readonly wantTest: Int16Array;
  /** Limping on an ankle turned tonight (dramas.ts): someone hurt, not someone else, so the limp is no part of how they look. */
  readonly hurt: Uint8Array;
  readonly stats = { doubleTakes: 0, tests: 0, passed: 0, compared: 0, sure: 0, met: 0 };

  constructor(people: Person[], rng: Rng) {
    const n = people.length;
    this.n = n;
    this.look = new Float32Array(n * FEATURES);
    this.tie = new Uint8Array(n * n);
    this.memLook = new Float32Array(n * n * FEATURES);
    this.doubt = new Float32Array(n * n);
    this.doubtT = new Float32Array(n * n);
    this.stage = new Uint8Array(n * n);
    this.voice = new Float32Array(n);
    this.wantTest = new Int16Array(n).fill(-1);
    this.hurt = new Uint8Array(n);
    for (const p of people) this.voice[p.id] = (p.look.sex === "f" ? 0.65 : 0.35) + rng.range(-0.1, 0.1);
    for (const p of people) this.refresh(p);

    // Ties from the cast: partners, friends (some close), the household, regulars, friends of friends.
    const host = people.find((p) => p.role === "host");
    const set = (a: Person, b: Person, t: Tie) => {
      if (a === b) return;
      if (this.tie[a.id * n + b.id]! >= t) return;
      this.tie[a.id * n + b.id] = t;
      this.tie[b.id * n + a.id] = t;
    };
    for (const p of people) {
      if (p.partner !== null) set(p, people[p.partner]!, 5);
      for (const f of p.friends) if (f > p.id) set(p, people[f]!, rng.chance(0.3) ? 4 : 3);
    }
    for (const p of people) {
      if (p.staff) for (const q of people) if (q.staff || q.role === "host") set(p, q, 3);
      if (host && !p.staff && p !== host) set(host, p, p.regular ? 3 : 2);
      if (p.regular) for (const q of people) if (q.regular && q !== p) set(p, q, 2);
      for (const f of p.friends) for (const ff of people[f]!.friends) if (ff !== p.id && rng.chance(0.5)) set(p, people[ff]!, 2);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (this.tie[i * n + j]) this.remember(i, j);
  }

  tieOf(i: number, j: number): Tie {
    return this.tie[i * this.n + j] as Tie;
  }

  /** Work out how someone looks now: drink loosens the walk and raises the voice. */
  refresh(p: Person): void {
    const o = p.id * FEATURES;
    const L = p.look;
    const sway = Math.max(0, Math.min(1, (p.tipsy - 0.6) / 0.4));
    let bits = 0;
    const limp = p.quirks.includes("limp") && !this.hurt[p.id];
    QUIRK_BITS.forEach((q, i) => {
      if (p.quirks.includes(q) && (q !== "limp" || limp)) bits |= 1 << i;
    });
    this.look[o + F_HEIGHT] = L.height * 100;
    this.look[o + F_BUILD] = L.build;
    this.look[o + F_GAIT] = (limp ? 1 : 0) + 0.5 * sway;
    this.look[o + F_VOICE] = this.voice[p.id]! + 0.6 * Math.max(0, p.tipsy - 0.3);
    this.look[o + F_QUIRKS] = bits;
    this.look[o + F_HUE] = hue(L.color);
    // A stain down the front, a bandaged hand.
    this.look[o + F_STATE] = (p.stain ? 0.5 : 0) + (p.bandage ? 0.5 : 0);
  }

  /** Someone else's voice in this record (the spy moved into its victim's): their own pitch, before drink. Nobody's memory of them changes. */
  recast(p: Person, voice: number): void {
    this.voice[p.id] = voice;
    this.refresh(p);
  }

  /** i takes a fresh mental picture of j. */
  private remember(i: number, j: number): void {
    const m = (i * this.n + j) * FEATURES;
    for (let f = 0; f < FEATURES; f++) this.memLook[m + f] = this.look[j * FEATURES + f]!;
  }

  /** Two strangers meet tonight (in a conversation): a first tie and a first picture. */
  meet(i: number, j: number): void {
    if (i === j || this.tie[i * this.n + j]) return;
    this.tie[i * this.n + j] = 1;
    this.tie[j * this.n + i] = 1;
    this.remember(i, j);
    this.remember(j, i);
    this.stats.met++;
  }

  /** A bond formed tonight (bonds.ts): the tie rises to at least `t` both ways, never falls. */
  bond(i: number, j: number, t: Tie): void {
    if (i === j) return;
    this.meet(i, j);
    if (this.tie[i * this.n + j]! < t) this.tie[i * this.n + j] = t;
    if (this.tie[j * this.n + i]! < t) this.tie[j * this.n + i] = t;
  }

  /**
   * How different j looks to i from how i remembers them, weighted as the plan has it. At a
   * distance only height and walk show; explained changes (i knows j has been drinking, or of
   * the spill that sent them off to change) barely count.
   */
  mismatch(i: number, j: number, salience: number, explained: boolean, dressed = false): number {
    const a = j * FEATURES;
    const m = (i * this.n + j) * FEATURES;
    const L = this.look;
    const M = this.memLook;
    const why = explained ? 0.2 : 1;
    const worn = dressed ? 0.2 : 1;
    let s = Math.abs(L[a + F_HEIGHT]! - M[m + F_HEIGHT]!) / 15;
    s += Math.min(1, Math.abs(L[a + F_GAIT]! - M[m + F_GAIT]!)) * 0.5 * why;
    if (salience < 0.4) return s;
    s += Math.min(1, Math.abs(L[a + F_VOICE]! - M[m + F_VOICE]!)) * 0.5 * why;
    s += popcount((L[a + F_QUIRKS]! ^ M[m + F_QUIRKS]!) >>> 0) * 0.4;
    s += Math.min(1, 2 * Math.abs(L[a + F_HUE]! - M[m + F_HUE]!)) * 0.2 * worn;
    s += Math.min(1, Math.abs(L[a + F_STATE]! - M[m + F_STATE]!)) * 0.2 * worn;
    s += Math.abs(L[a + F_BUILD]! - M[m + F_BUILD]!) * 0.3;
    return s;
  }

  /** Doubt now, faded since it was last brought up to date. */
  doubtOf(i: number, j: number, t: number): number {
    const k = i * this.n + j;
    return this.doubt[k]! * 0.5 ** ((t - this.doubtT[k]!) / DOUBT_HALF);
  }

  /** Something i was told doesn't fit with j being themselves (the register's two places at once). */
  addDoubt(i: number, j: number, v: number, t: number): void {
    const k = i * this.n + j;
    this.doubt[k] = this.doubtOf(i, j, t) + v;
    this.doubtT[k] = t;
  }

  /**
   * i sees j, whom they know. Salience is 1 face to face, 0.4 within 4 m, 0.15 within 10 m,
   * times the light and a clear head. Returns what the sighting brings about.
   */
  check(i: number, j: number, t: number, dt: number, d: number, faceToFace: boolean, light: number, tipsy: number, explained: boolean, dressed = false): IdentEvent {
    const k = i * this.n + j;
    const tie = this.tie[k]!;
    if (!tie) return null;
    const sal = (faceToFace && d < 1.5 ? 1 : d < 4 ? 0.4 : d < 10 ? 0.15 : 0) * light * (1 - 0.6 * tipsy);
    if (sal <= 0) return null;
    // Getting used to a change they understand.
    if (explained) {
      const a = j * FEATURES;
      const m = k * FEATURES;
      const f = 1 - 0.5 ** (dt / USED_TO);
      for (const x of [F_GAIT, F_VOICE]) this.memLook[m + x]! += (this.look[a + x]! - this.memLook[m + x]!) * f;
    }
    if (dressed) {
      const a = j * FEATURES;
      const m = k * FEATURES;
      const f = 1 - 0.5 ** (dt / USED_TO);
      for (const x of [F_HUE, F_STATE]) this.memLook[m + x]! += (this.look[a + x]! - this.memLook[m + x]!) * f;
    }
    const mis = this.mismatch(i, j, sal, explained, dressed);
    let v = this.doubtOf(i, j, t);
    // Once someone has passed a test, they're themselves for the rest of the evening.
    const trust = this.stage[k] === 2 ? 0.2 : 1;
    v += 0.08 * TIE_WEIGHT[tie]! * sal * mis * dt * trust;
    // Doubt about someone not yet tested stops short of comparing notes: the test settles it first.
    if (this.stage[k]! < 2) v = Math.min(v, COMPARE - 0.01);
    this.doubt[k] = v;
    this.doubtT[k] = t;
    if (this.stage[k] === 0 && v >= DOUBLE_TAKE) {
      this.stage[k] = 1;
      this.stats.doubleTakes++;
      return "double-take";
    }
    if (this.stage[k] === 1 && v >= TEST) {
      if (faceToFace && d < 1.5) {
        this.test(i, j, t);
        return "test";
      }
      this.wantTest[i] = j;
      return "want-test";
    }
    return null;
  }

  /**
   * A beat in conversation: a nickname, a shared joke, an offered drink. The real person always
   * passes; the doubt goes and the new look becomes the one remembered.
   */
  test(i: number, j: number, t: number): boolean {
    const k = i * this.n + j;
    this.stats.tests++;
    this.stats.passed++;
    this.doubt[k] = this.doubtOf(i, j, t) * 0.2;
    this.doubtT[k] = t;
    this.stage[k] = 2;
    if (this.wantTest[i] === j) this.wantTest[i] = -1;
    this.remember(i, j);
    return true;
  }
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** Hue of a hex colour, 0 to 1. */
function hue(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) / 255;
  const g = ((v >> 8) & 255) / 255;
  const b = (v & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h / 6;
}
