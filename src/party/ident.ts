/**
 * Knowing each other by sight (milestone 2 technical plan: Recognising people; milestone 3: Seen
 * through). People remember how those they know look and behave, compare whenever they see them,
 * and an unexplained change grows into a double take, then a friendly test. The real person
 * passes (very drunk, now and then fumbles and passes the next); the spy in someone else's record
 * bluffs or fails. Past a test doubt can grow on: to comparing notes with another of their
 * friends, and to sure. Manner (a cool greeting, a name not known) and skill (fumbling what they
 * did easily) add to it too.
 */
import type { Rng } from "../mansion/core/rng";
import { SKILLS, type Person, type Quirk, type Skill } from "./types";

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

/**
 * Doubt fades, the slower the surer they've been since last reassured: it halves over DOUBT_HALF
 * at a double take and twice as long for every DOUBT_DOUBLES more (about 35 minutes at a test's
 * 0.45, an hour at 0.6, an hour and 40 minutes at a failed test's 0.75, nearly two and a half
 * hours once sure). Something striking about them (a name they should have known, a scene, a word
 * from someone sure, the garment found) makes it fade STRIKING times slower still: an odd moment
 * is explained away within the hour, a shock stays with them all evening.
 */
const DOUBT_HALF = 15 * 60;
const DOUBT_DOUBLES = 0.2;
export const STRIKING = 3;
/** Getting used to a known change: half-way over this long (in-game s). */
const USED_TO = 15 * 60;
export const DOUBLE_TAKE = 0.2;
export const TEST = 0.45;
export const COMPARE = 0.6;
export const SURE = 0.85;
/** Doubt goes no higher: certain they aren't who they seem. */
export const MAX_DOUBT = 1;

/** Where each pair stands (`stage`): nothing yet, a double take, a test passed (or bluffed), a test failed, sure. */
export const NONE = 0;
export const LOOKED = 1;
export const PASSED = 2;
export const FAILED = 3;
export const SURE_OF = 4;

/** What a test came to: passed, fumbled by someone very drunk (who passes the next), bluffed or failed by an impostor. */
export type TestOutcome = "passed" | "fumbled" | "bluffed" | "failed";
/** A very drunk real person fumbles a test this often, past this tipsiness. */
const FUMBLE = 1 / 7;
const FUMBLE_TIPSY = 0.7;
/** Where a failed test leaves doubt: past comparing notes, short of sure. */
export const FAIL_AT = TEST + 0.3;
/** After a test, the same pair isn't tested again for this long (in-game s). */
const RETEST = 10 * 60;
/** After comparing notes, a doubter looks for someone else to compare with only after this long (in-game s). */
const RECOMPARE = 5 * 60;

/** The skills a slip can be of: the cast's own, then the way round the house (index HOUSE). */
export type SlipSkill = Skill | "house";
export const SLIP_SKILLS: readonly SlipSkill[] = [...SKILLS, "house"];
export const HOUSE = SKILLS.length;
/** How well people know the way round: the household, the staff, regulars, everyone else. */
const KNOWS_HOUSE = { household: 0.95, staff: 0.8, regular: 0.7, first: 0.3 };
/** A slip counts only when the one watching expected the skill at this or more. */
export const EXPECT = 0.6;
/** Doubt from a slip seen: this × tie weight × the skill expected × the gap between that and how they do now (a full gap at SLIP_GAP). */
const SLIP_DOUBT = 0.15;
const SLIP_GAP = 0.3;
/** A greeting colder than the tie calls for, and a name not known, add this × tie weight of doubt. */
export const COOL = 0.12;
export const NAME = 0.1;

const QUIRK_BITS: readonly Quirk[] = ["glasses", "limp", "cane", "ear-scratch", "globe-pointer", "dances-after-drink", "hands-in-pockets", "tie-adjust", "big-laugh", "smoker", "watch-check"];

/** What a sighting brings about. */
export type IdentEvent = "double-take" | "test" | "want-test" | "compare" | "sure" | null;

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
  /** How long i's doubt about j takes to halve now (in-game s), and whether something striking about j has happened to i. */
  private readonly half: Float32Array;
  private readonly struck: Uint8Array;
  /** Where i stands with j: NONE, LOOKED (a double take), PASSED (a test passed or bluffed), FAILED, SURE_OF. */
  readonly stage: Uint8Array;
  /** Each person's own voice, before drink raises it. */
  private readonly voice: Float32Array;
  /** A test i wants to put to j, or -1. */
  readonly wantTest: Int16Array;
  /** Someone i wants to compare notes about (doubt past COMPARE after a test), or -1. */
  readonly wantCompare: Int16Array;
  /** Limping on an ankle turned tonight (dramas.ts): someone hurt, not someone else, so the limp is no part of how they look. */
  readonly hurt: Uint8Array;
  /** How well each person does each skill (SLIP_SKILLS) as the cast drew them, before anyone took their place: what those who know them expect. */
  readonly expect: Float32Array;
  /** The record the spy lives in, playing someone (-1 none): the one person here who isn't who they seem. */
  fake = -1;
  /** How the impostor answers a test put by i: bluffed or failed (spy/answers.ts). */
  private answer: ((i: number, t: number) => "bluffed" | "failed") | null = null;
  /** The party hears of every test and what it came to. */
  onTest: ((i: number, j: number, out: TestOutcome) => void) | null = null;
  /** A slip someone is showing (an index into SLIP_SKILLS, -1 none), until when, and its number (each observer counts a slip once). */
  readonly slipping: Int8Array;
  readonly slipUntil: Float32Array;
  private readonly slipNo: Int32Array;
  private readonly slipSeen: Int32Array;
  private slips = 0;
  /** How well each knows the way round now: what they're expected to, but the spy's own for the record it wears. */
  private readonly house: Float32Array;
  /** When i last tested j, and when i may next look for someone to compare notes with about j. */
  private readonly lastTest: Float32Array;
  private readonly nextCompare: Float32Array;
  /** i has compared notes with j (once a pair, whomever about). */
  private readonly compared: Uint8Array;
  /** A very drunk j fumbled i's test: the next one passes. */
  private readonly fumbled: Uint8Array;
  private readonly people: readonly Person[];
  private readonly rng: Rng;
  readonly stats = { doubleTakes: 0, tests: 0, passed: 0, fumbled: 0, bluffed: 0, failed: 0, compared: 0, sure: 0, met: 0, slips: 0, cool: 0, names: 0 };

  constructor(people: Person[], rng: Rng) {
    const n = people.length;
    this.n = n;
    this.people = people;
    this.look = new Float32Array(n * FEATURES);
    this.tie = new Uint8Array(n * n);
    this.memLook = new Float32Array(n * n * FEATURES);
    this.doubt = new Float32Array(n * n);
    this.doubtT = new Float32Array(n * n);
    this.half = new Float32Array(n * n).fill(doubtHalfLife(0));
    this.struck = new Uint8Array(n * n);
    this.stage = new Uint8Array(n * n);
    this.voice = new Float32Array(n);
    this.wantTest = new Int16Array(n).fill(-1);
    this.wantCompare = new Int16Array(n).fill(-1);
    this.hurt = new Uint8Array(n);
    this.expect = new Float32Array(n * SLIP_SKILLS.length);
    this.slipping = new Int8Array(n).fill(-1);
    this.slipUntil = new Float32Array(n);
    this.slipNo = new Int32Array(n);
    this.slipSeen = new Int32Array(n * n);
    this.house = new Float32Array(n);
    this.lastTest = new Float32Array(n * n).fill(-1e9);
    this.nextCompare = new Float32Array(n * n);
    this.compared = new Uint8Array(n * n);
    this.fumbled = new Uint8Array(n * n);
    // Draws of its own for the tests, so the ties below come out as they always have.
    this.rng = rng.fork("test");
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
    // What everyone does well, as they came: the skills, and the way round the house.
    const S = SLIP_SKILLS.length;
    for (const p of people) {
      SKILLS.forEach((k, s) => (this.expect[p.id * S + s] = p.fluency[k]));
      const home = p === host || (host !== undefined && host.partner === p.id);
      this.house[p.id] = this.expect[p.id * S + HOUSE] = home ? KNOWS_HOUSE.household : p.staff ? KNOWS_HOUSE.staff : p.regular ? KNOWS_HOUSE.regular : KNOWS_HOUSE.first;
    }
  }

  /**
   * The spy plays this record: the one person here who isn't who they seem. It answers tests
   * with `answer`, and finds its way round the house as a first-timer, whatever the record's
   * owner knew.
   */
  impostor(id: number, answer: (i: number, t: number) => "bluffed" | "failed"): void {
    this.fake = id;
    this.answer = answer;
    this.house[id] = KNOWS_HOUSE.first;
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

  /**
   * Another mind in i's record (the spy, out of one record and into the one it killed): what the one
   * who lived there made of anyone (their doubts, their tests, their notes compared) goes with them,
   * and so does a turned ankle or a fumble showing. Their pictures of people stay, being of how
   * people look. What anyone makes of i stays too.
   */
  newMind(i: number): void {
    const n = this.n;
    const a = i * n;
    const b = a + n;
    this.doubt.fill(0, a, b);
    this.doubtT.fill(0, a, b);
    this.half.fill(doubtHalfLife(0), a, b);
    this.struck.fill(0, a, b);
    this.stage.fill(NONE, a, b);
    this.lastTest.fill(-1e9, a, b);
    this.nextCompare.fill(0, a, b);
    this.compared.fill(0, a, b);
    for (let j = 0; j < n; j++) this.compared[j * n + i] = 0;
    this.fumbled.fill(0, a, b);
    this.slipSeen.fill(0, a, b);
    this.wantTest[i] = -1;
    this.wantCompare[i] = -1;
    this.hurt[i] = 0;
    this.slipping[i] = -1;
    this.slipUntil[i] = 0;
  }

  /**
   * j has their spectacles back on: whoever knows them knows them in glasses, so a picture taken
   * while they were off (a test passed meanwhile) has them back.
   */
  glassesBack(j: number): void {
    const bit = 1 << QUIRK_BITS.indexOf("glasses");
    for (let i = 0; i < this.n; i++) {
      const m = (i * this.n + j) * FEATURES + F_QUIRKS;
      if (this.tie[i * this.n + j]) this.memLook[m] = this.memLook[m]! | bit;
    }
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
    return this.doubt[k]! * 0.5 ** ((t - this.doubtT[k]!) / this.half[k]!);
  }

  /** How long i's doubt about j takes to halve now (in-game s). */
  halfLifeOf(i: number, j: number): number {
    return this.half[i * this.n + j]!;
  }

  /** Doubt is now v (brought up to date at t): it fades as slowly as the surest they've been since last reassured, and STRIKING times slower once something striking has happened. */
  private setDoubt(k: number, v: number, t: number, striking = false): void {
    if (striking && !this.struck[k]) {
      this.struck[k] = 1;
      this.half[k] = this.half[k]! * STRIKING;
    }
    this.doubt[k] = v;
    this.doubtT[k] = t;
    this.half[k] = Math.max(this.half[k]!, doubtHalfLife(v) * (this.struck[k] ? STRIKING : 1));
  }

  /** Reassured by a test (passed or bluffed): doubt is now v, fading as its level calls for. A pass settles it, whatever struck them before. */
  private reassure(k: number, v: number, t: number, settled: boolean): void {
    if (settled) this.struck[k] = 0;
    this.doubt[k] = v;
    this.doubtT[k] = t;
    this.half[k] = doubtHalfLife(v) * (this.struck[k] ? STRIKING : 1);
  }

  /**
   * More doubt for i about j from something besides a look: told something that doesn't fit (the
   * register's two places at once), a cool greeting, a slip, notes compared. Until they've tested
   * j it stops short of comparing notes (or of `cap`, when lower), as a look's does. Something
   * `striking` (a name not known, a scene, a word from someone sure, the garment) makes it fade
   * STRIKING times slower.
   */
  addDoubt(i: number, j: number, v: number, t: number, cap = Infinity, striking = false): void {
    const k = i * this.n + j;
    const now = this.doubtOf(i, j, t);
    let d = now + v;
    if (this.stage[k]! < PASSED) d = Math.min(d, COMPARE - 0.01);
    this.setDoubt(k, Math.max(now, Math.min(d, cap, MAX_DOUBT)), t, striking);
  }

  /** i expected warmth from j (a wave back, a kiss) and got a stranger's greeting: a sulk, or someone who doesn't know them. */
  cool(i: number, j: number, t: number): void {
    const tie = this.tie[i * this.n + j]!;
    if (!tie) return;
    this.stats.cool++;
    this.addDoubt(i, j, COOL * TIE_WEIGHT[tie]!, t);
  }

  /** j didn't know i's name ("he didn't know my name"). */
  noName(i: number, j: number, t: number): void {
    const tie = this.tie[i * this.n + j]!;
    if (!tie) return;
    this.stats.names++;
    this.addDoubt(i, j, NAME * TIE_WEIGHT[tie]!, t, Infinity, true);
  }

  // ------------------------------------------------------------------ skill

  /** j fumbles something (an index into SLIP_SKILLS), showing for `secs`: whoever catches it in a look's detail may make something of it. */
  slip(j: number, skill: number, t: number, secs: number): void {
    this.slipping[j] = skill;
    this.slipUntil[j] = t + secs;
    this.slipNo[j] = ++this.slips;
  }

  /** The slip j is showing now, if i hasn't caught this one yet: its skill (marked as caught), else -1. */
  catchSlip(i: number, j: number, t: number): number {
    const s = this.slipping[j]!;
    if (s < 0 || t > this.slipUntil[j]!) return -1;
    const k = i * this.n + j;
    if (this.slipSeen[k] === this.slipNo[j]) return -1;
    this.slipSeen[k] = this.slipNo[j]!;
    return s;
  }

  /** How well j does a skill now (the spy's own, in a record it wears). */
  actual(j: number, skill: number): number {
    return skill === HOUSE ? this.house[j]! : this.people[j]!.fluency[SKILLS[skill]!];
  }

  /** How well i expects j to do a skill: what j did as the cast drew them (0 for a stranger, who expects nothing). */
  expected(i: number, j: number, skill: number): number {
    return this.tie[i * this.n + j] ? this.expect[j * SLIP_SKILLS.length + skill]! : 0;
  }

  /**
   * The doubt i takes from seeing j fumble a skill (`k` 0.5 for begging off it): 0.15 × tie weight
   * × the skill they expected, when that was EXPECT or more, scaled by how far short j now falls
   * of it, so a real person's fumble (what they always do now and then) counts nothing. Nothing
   * when they can explain it; and a slip alone never brings a test. Returns the doubt added.
   */
  slipDoubt(i: number, j: number, skill: number, t: number, explained: boolean, k = 1): number {
    const tie = this.tie[i * this.n + j]!;
    const e = this.expected(i, j, skill);
    if (!tie || e < EXPECT || explained) return 0;
    const gap = Math.max(0, Math.min(1, (e - this.actual(j, skill)) / SLIP_GAP));
    const v = SLIP_DOUBT * TIE_WEIGHT[tie]! * e * gap * k;
    if (v <= 0) return 0;
    this.stats.slips++;
    this.addDoubt(i, j, v, t, this.stage[i * this.n + j]! < PASSED ? TEST - 0.01 : Infinity);
    return v;
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
    const stage = this.stage[k]!;
    // Once someone has passed a test, they're themselves for the rest of the evening: what still looks off
    // (an impostor's bluff leaves the difference) counts a fifth. Once they've failed one, the look has
    // told all it can: only something new (a slip, a name not known, a word from someone else) adds doubt.
    const trust = stage === PASSED ? 0.2 : stage >= FAILED ? 0 : 1;
    v += 0.08 * TIE_WEIGHT[tie]! * sal * mis * dt * trust;
    // Doubt about someone not yet tested stops short of comparing notes: the test settles it first.
    if (stage < PASSED) v = Math.min(v, COMPARE - 0.01);
    v = Math.min(v, MAX_DOUBT);
    this.setDoubt(k, v, t);
    if (stage === NONE && v >= DOUBLE_TAKE) {
      this.stage[k] = LOOKED;
      this.stats.doubleTakes++;
      return "double-take";
    }
    if (stage === LOOKED && v >= TEST && t - this.lastTest[k]! >= RETEST) {
      if (faceToFace && d < 1.5) {
        this.test(i, j, t);
        return "test";
      }
      this.wantTest[i] = j;
      return "want-test";
    }
    if (stage >= PASSED && stage < SURE_OF && v >= SURE) {
      this.stage[k] = SURE_OF;
      this.stats.sure++;
      if (this.wantCompare[i] === j) this.wantCompare[i] = -1;
      return "sure";
    }
    if (stage >= PASSED && stage < SURE_OF && v >= COMPARE && this.wantCompare[i] !== j && t >= this.nextCompare[k]!) {
      this.wantCompare[i] = j;
      return "compare";
    }
    return null;
  }

  /**
   * A beat in conversation: a nickname, a shared joke, an offered drink. The real person passes:
   * the doubt goes and the new look becomes the one remembered; very drunk, one time in seven
   * they fumble it, and pass the next. The impostor bluffs (it passes on the surface, but the look
   * isn't remembered, so the doubt climbs again, slowly) or fails, and the doubt jumps.
   */
  test(i: number, j: number, t: number): TestOutcome {
    const k = i * this.n + j;
    this.stats.tests++;
    this.lastTest[k] = t;
    if (this.wantTest[i] === j) this.wantTest[i] = -1;
    let out: TestOutcome;
    if (j === this.fake && this.answer) out = this.answer(i, t);
    else if (this.people[j]!.tipsy > FUMBLE_TIPSY && !this.fumbled[k] && this.rng.chance(FUMBLE)) out = "fumbled";
    else out = "passed";
    const v = this.doubtOf(i, j, t);
    if (out === "passed") {
      this.stats.passed++;
      this.reassure(k, v * 0.2, t, true);
      this.stage[k] = PASSED;
      this.remember(i, j);
    } else if (out === "fumbled") {
      this.stats.fumbled++;
      this.fumbled[k] = 1;
      this.setDoubt(k, Math.min(COMPARE - 0.01, v + 0.1), t);
    } else if (out === "bluffed") {
      this.stats.bluffed++;
      this.reassure(k, v * 0.5, t, false);
      this.stage[k] = PASSED;
    } else {
      this.stats.failed++;
      // The test settles what the look raised: whatever it had built up, a blank look leaves doubt at
      // FAIL_AT, past comparing notes and short of sure, which needs something more. A blank look is odd,
      // not a shock: it fades as its level calls for, so a second witness has to come within the hour or so.
      this.setDoubt(k, Math.max(v, FAIL_AT), t);
      if (this.stage[k]! < FAILED) this.stage[k] = FAILED;
    }
    this.onTest?.(i, j, out);
    return out;
  }

  /** i compared notes about someone with j: once a pair (either way round), and i looks for someone else only a while later. */
  comparedWith(i: number, j: number, about: number, t: number): void {
    this.compared[i * this.n + j] = 1;
    this.compared[j * this.n + i] = 1;
    this.stats.compared++;
    if (this.wantCompare[i] === about) this.wantCompare[i] = -1;
    this.nextCompare[i * this.n + about] = t + RECOMPARE;
  }

  /** Whether i has compared notes with j yet. */
  hasCompared(i: number, j: number): boolean {
    return this.compared[i * this.n + j] === 1;
  }

  /** Nobody left to compare notes with about j for now: i looks again a while later. */
  noneToCompare(i: number, about: number, t: number): void {
    if (this.wantCompare[i] === about) this.wantCompare[i] = -1;
    this.nextCompare[i * this.n + about] = t + RECOMPARE;
  }
}

/** How long doubt at d takes to halve (in-game s): DOUBT_HALF at a double take, twice as long for every DOUBT_DOUBLES more. */
export function doubtHalfLife(d: number): number {
  return DOUBT_HALF * 2 ** ((d - DOUBLE_TAKE) / DOUBT_DOUBLES);
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
