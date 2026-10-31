/**
 * Observers on other bearings (armoury task 7, "On another bearing"): spotters hired to lie in the treeline
 * elsewhere on the perch arc and call what they see over the radio. Each has its own eye, perchEyeAt() at its
 * bearing on the ground, and its own SightlineTracer through the house's occluders, built once (movePerch() would
 * rebuild a whole blueprint). They look on the party's sight tick, right after senses.step().
 *
 * What becomes a call (SPOTTERS: notices, delayS):
 *  - The party's own noticeable acts (`p.notable`, the ones guests file in the register) that one can make out from
 *    the treeline: someone at the safe, going through a bag, coming out of a bedroom. Each act is one event, decided
 *    the first moment it is in the observer's view: a call with the tier's chance.
 *  - A watched person leaving the observer's view, or coming back into it ("target moving").
 *  - The shot's impact, when the observer can see where it struck (a shot call).
 *  - What the sniper asks for on the radio wheel: watch this person, report room X, quiet.
 * A sighting describes the person as the register does (describeLooks(): sex, height, build, outfit colour, the
 * quirks one can see) with the tier's noise on a copy: a feature left out, a colour mis-named in poor light.
 *
 * Calls go out on one channel (src/scope/radio.ts): the most urgent first, one at a time, about 2.5 words a second,
 * and a call waiting over 20 s is dropped (never a shot call). A call is evidence, not truth: nothing here writes into
 * the party, and the evening runs exactly as it would without observers (the party's digest doesn't move). Their
 * draws come from the party's own fork, `root.fork("observers")`.
 */
import { SPOTTERS, type SpotterTier } from "../armoury/catalogue";
import { collectOccluders } from "../mansion/analysis/occluders";
import { SightlineTracer } from "../mansion/analysis/sightlines";
import type { Vec3 } from "../mansion/core/geom";
import type { Rng } from "../mansion/core/rng";
import type { MansionBlueprint } from "../mansion/core/types";
import { perchEyeAt } from "../mansion/site/perch";
import { Radio, type CallKind, type RadioCall } from "../scope/radio";
import type { Verb } from "./memory";
import { describeLooks, F_BUILD, F_COLOUR, F_HEIGHT, F_QUIRKS, F_SEX, LOOKS_D, QUIRK_SEEN } from "./register";
import type { Person } from "./types";
import { curtained, type World } from "./world";

// ------------------------------------------------------------------ numbers

/** How much of someone must be in view (the tracer's 0 to 1, light weighed in) to make them out. Default. */
export const SEEN = 0.3;
/** A room's light at which colours and faces read fully through the glass: a room with its lights on (world.lit). Default. */
export const LIT_FULL = 0.35;
/** Light outdoors at night (the terrace, the garden), as senses.range() takes it. */
export const LIT_OUTSIDE = 0.6;
/**
 * A watched person out of view this long (s) is lost; back in view this long, they are back. Default: someone
 * dancing past a window frame, or a passer-by between, isn't a loss.
 */
export const LOST_AFTER = 8;
export const BACK_AFTER = 3;
/** A watched person seen in another room this long (s) has moved there: a doorway crossed and crossed back isn't a move. Default. */
export const MOVED_AFTER = 3;

/**
 * The tier's noise on a description (Default): the chance a feature is left out, and the chance the colour is
 * mis-named, more of it the poorer the light (`dark` at no light, added to `colour`). A rookie drops something one
 * time in two and mis-names a colour in a dim room more often than not; a veteran barely ever.
 */
export const DESCRIBE_NOISE: Record<SpotterTier, { drop: number; colour: number; dark: number }> = {
  rookie: { drop: 0.5, colour: 0.1, dark: 0.6 },
  seasoned: { drop: 0.2, colour: 0.03, dark: 0.3 },
  veteran: { drop: 0.05, colour: 0, dark: 0.08 },
};

/**
 * The acts one can make out from the treeline through a spotting scope, as an observer says them. What needs hearing
 * (raised voices aside, which show as an argument) or a close look (a fumbled name, a missing stain) isn't here, nor
 * what only the gossip knows (a rumour, a case, someone missing).
 */
export const ACT_CALLS: Partial<Record<Verb, string>> = {
  "at-safe": "at the safe",
  "picking-lock": "working a lock",
  "in-bag": "going through a bag",
  pocket: "into a coat pocket",
  planted: "leaving something",
  attacked: "attacking someone",
  collapsed: "collapsed",
  "propped-up": "holding someone up",
  followed: "following someone",
  "left-bedroom": "coming out of a bedroom",
  "locked-door": "trying a locked door",
  snooping: "poking about",
  "slipped-away": "slipping off",
  confronted: "being confronted",
  slapped: "slapped someone",
  "raised-voices": "arguing",
  row: "in a row",
  cheating: "kissing someone",
  fainted: "fainted",
  "twisted-ankle": "stumbled",
  crash: "knocked something over",
  broke: "broke something",
  spill: "spilled a drink",
  startled: "startled",
  "camera-shy": "turning from the camera",
  "out-of-step": "not with the others",
};

/** An observer as hired: tier and bearing off the garden axis (deg, on the treeline arc). */
export interface ObserverHire {
  tier: SpotterTier;
  azDeg: number;
}

/** What the sniper says on the radio wheel, at a time (in-game s), to one observer (`to`) or all (-1). */
export type ObserverOrder = { t: number; to: number; kind: "watch"; who: number } | { t: number; to: number; kind: "report"; room: number } | { t: number; to: number; kind: "quiet"; on: boolean };

export interface ObserverOptions {
  hires: ObserverHire[];
  /** Orders given so far, replayed at their times (the lab keeps them, so a replayed evening hears the same calls). */
  orders?: ObserverOrder[];
}

/** A call as an observer makes it: the radio's call, and what it is about. */
export interface ObserverCall extends RadioCall {
  /** Which observer. */
  by: number;
  /** When it happened (in-game s); `at` is when they start to say it. */
  t: number;
  /** What it is: an act's verb, "lost", "back", "moved", "watching", "report", "hit", "miss". */
  what: string;
  /** Who it is about (-1 nobody). */
  about: number;
  room: number;
  /** The description said, as the register's numbers (null when nobody is described). */
  desc: Float32Array | null;
}

export interface ObserverStats {
  /** Acts decided while in view, and how many of them became a call. */
  events: number;
  noticed: number;
  /** Watched people lost, found again and seen moving to another room, as calls. */
  lost: number;
  back: number;
  moved: number;
  calls: number;
  /** Impacts seen, and called. */
  shots: number;
}

/** What an observer's host needs: the party (sim.ts). */
export interface ObserverHost {
  readonly t: number;
  readonly bp: MansionBlueprint;
  readonly people: readonly Person[];
  readonly world: Pick<World, "lit" | "curtains" | "roomCurtains">;
}

// --------------------------------------------------------------------- view

/** Heights above the floor the tracer samples (m): standing torso and head (as tracer.person), sitting, lying. */
const STAND = [1.25, 1.62] as const;
const SIT = [0.85, 1.2] as const;
const LIE = [0.25] as const;

/** One observer's eye on the house: the tracer as generated, and with every movable curtain open (traced on first need). */
class View {
  readonly eye: Vec3;
  private readonly tracer: SightlineTracer;
  private openTracer: SightlineTracer | null = null;
  /** Per curtain id: its window faces this eye. */
  private readonly toward: Uint8Array;

  constructor(
    private readonly h: ObserverHost,
    azDeg: number,
  ) {
    const bp = h.bp;
    const zGarden = bp.site.perch.target.z;
    this.eye = perchEyeAt(bp.site.terrain, zGarden, bp.groundFloorY, azDeg, 0, bp.site.perch.distance);
    this.tracer = new SightlineTracer(this.eye, this.occluders(null));
    // Which windows face this eye, as World works it out for the perch's.
    const byOpening = new Map<string, number>();
    h.world.curtains.forEach((c) => byOpening.set(c.opening, c.id));
    this.toward = new Uint8Array(h.world.curtains.length);
    for (const w of bp.walls) {
      if (!w.exterior) continue;
      const out = w.neg ? 1 : -1;
      for (const o of w.openings) {
        const id = byOpening.get(o.id);
        if (id === undefined) continue;
        const u = (o.u0 + o.u1) / 2;
        const x = w.axis === "x" ? w.a.x + u : w.a.x;
        const z = w.axis === "x" ? w.a.z : w.a.z + u;
        this.toward[id] = (w.axis === "x" ? (this.eye.z - z) * out : (this.eye.x - x) * out) > 0 ? 1 : 0;
      }
    }
  }

  private occluders(open: ReadonlySet<string> | null) {
    const bp = this.h.bp;
    const walls = open
      ? bp.walls.map((w) => (w.openings.some((o) => open.has(o.id)) ? { ...w, openings: w.openings.map((o) => (open.has(o.id) ? { ...o, curtain: "open" as const } : o)) } : w))
      : bp.walls;
    return collectOccluders({
      walls,
      rooms: bp.rooms,
      levels: bp.levels,
      masses: bp.masses,
      porticos: bp.porticos,
      props: bp.props,
      site: bp.site,
      atrium: bp.atrium,
      stairs: bp.stairs,
      roofTerraces: bp.roofTerraces,
      withProps: true,
    });
  }

  private open(): SightlineTracer {
    if (!this.openTracer) {
      const ids = new Set(this.h.world.curtains.filter((c) => c.movable).map((c) => c.opening));
      this.openTracer = new SightlineTracer(this.eye, this.occluders(ids));
    }
    return this.openTracer;
  }

  /** How much of the points (0 to 1, the mean) reaches the eye, with the room's curtains as they are now. */
  private through(points: readonly Vec3[], room: number): number {
    const mean = (t: SightlineTracer) => points.reduce((s, p) => s + t.transmit(p), 0) / points.length;
    const baked = mean(this.tracer);
    const ids = room >= 0 ? this.h.world.roomCurtains[room] : undefined;
    if (!ids?.length) return baked;
    return curtained(baked, this.h.world.curtains, ids, this.toward, () => mean(this.open()));
  }

  /** Light on someone in a room (0 to 1 of what it takes to read them through glass). */
  light(room: number): number {
    return Math.min(1, (room >= 0 ? this.h.world.lit(room) : LIT_OUTSIDE) / LIT_FULL);
  }

  /** How well this eye makes someone out now (0 to 1): how much of them is in view, by their pose, and the light on them. */
  person(p: Person): number {
    if (!p.present) return 0;
    const hs = p.pose === "sit" ? SIT : p.pose === "lie" || (p.down && p.down !== "ill") ? LIE : STAND;
    return (
      this.through(
        hs.map((y) => ({ x: p.x, y: p.y + y, z: p.z })),
        p.room,
      ) * this.light(p.room)
    );
  }

  /** How well this eye makes out a point in a room now (an impact). */
  point(at: Vec3, room: number): number {
    return this.through([at], room) * this.light(room);
  }
}

// -------------------------------------------------------------------- words

/** Outfit colours as an observer names them, by reference colour (the cast's palette, cast.ts), and what each is mistaken for in poor light. */
const COLOURS: ReadonlyArray<{ name: string; hex: string; dim: readonly string[] }> = [
  { name: "black", hex: "#141416", dim: ["navy", "charcoal", "dark brown"] },
  { name: "charcoal", hex: "#3a3d42", dim: ["black", "grey", "navy"] },
  { name: "grey", hex: "#5e5f63", dim: ["charcoal", "green", "blue"] },
  { name: "silver", hex: "#c3c7cc", dim: ["white", "grey"] },
  { name: "white", hex: "#f4f2ec", dim: ["cream", "silver"] },
  { name: "cream", hex: "#eee6d2", dim: ["white", "gold"] },
  { name: "navy", hex: "#1d2a44", dim: ["black", "charcoal", "purple"] },
  { name: "dark blue", hex: "#2c2f6b", dim: ["navy", "purple", "black"] },
  { name: "blue", hex: "#1f3f9a", dim: ["dark blue", "purple", "teal"] },
  { name: "light blue", hex: "#7aa6d9", dim: ["grey", "silver", "lilac"] },
  { name: "teal", hex: "#16808a", dim: ["green", "blue", "grey"] },
  { name: "dark teal", hex: "#0f3a4a", dim: ["navy", "dark green", "black"] },
  { name: "green", hex: "#0f6b4f", dim: ["teal", "dark green", "grey"] },
  { name: "dark green", hex: "#24432f", dim: ["black", "charcoal", "green"] },
  { name: "olive", hex: "#6f7d3a", dim: ["green", "brown", "grey"] },
  { name: "red", hex: "#b3122b", dim: ["dark red", "burgundy", "brown"] },
  { name: "dark red", hex: "#8e1c1c", dim: ["burgundy", "brown", "black"] },
  { name: "burgundy", hex: "#6b1f2c", dim: ["dark red", "brown", "black"] },
  { name: "pink", hex: "#d76d84", dim: ["red", "lilac"] },
  { name: "orange", hex: "#e07a24", dim: ["gold", "red", "brown"] },
  { name: "gold", hex: "#d9b54a", dim: ["cream", "orange", "olive"] },
  { name: "tan", hex: "#8a6e4b", dim: ["brown", "olive", "grey"] },
  { name: "brown", hex: "#7a5a1e", dim: ["tan", "olive", "dark red"] },
  { name: "dark brown", hex: "#2b1d17", dim: ["black", "burgundy", "charcoal"] },
  { name: "purple", hex: "#5e1f63", dim: ["dark blue", "burgundy", "navy"] },
  { name: "plum", hex: "#4a2b52", dim: ["purple", "black", "navy"] },
  { name: "lilac", hex: "#c0a0d8", dim: ["light blue", "pink", "silver"] },
];

const rgbOf = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

/** CIE L*a*b* from sRGB (0 to 1), D65: nearest-colour naming by how far apart colours look. */
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const COLOUR_LAB = COLOURS.map((c) => lab(...rgbOf(c.hex)));

/** The name an observer gives a colour (r, g, b from 0 to 1): the nearest reference as it looks. */
export function colourName(r: number, g: number, b: number): string {
  const [L, A, B] = lab(r, g, b);
  let best = 0;
  let bd = Infinity;
  COLOUR_LAB.forEach(([l, a, bb], i) => {
    const d = (L - l) ** 2 + (A - a) ** 2 + (B - bb) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return COLOURS[best]!.name;
}

/** How tall someone reads for their sex: a standard deviation (6 cm) off the cast's mean (cast.ts). */
const HEIGHT_MEAN = { f: 165, m: 178 } as const;
const BUILD_WORDS = (b: number) => (b < 0.25 ? "slim" : b > 0.65 ? "heavy" : "");

/** A description (the register's numbers, `mask` the features it keeps) in an observer's words: "tall woman in red, glasses". */
export function sayLooks(d: Float32Array, o: number, mask: number, colour?: string): string {
  const f = d[o] === 1;
  const words: string[] = [];
  if (mask & F_HEIGHT) {
    const off = d[o + 1]! - HEIGHT_MEAN[f ? "f" : "m"];
    if (off > 6) words.push("tall");
    else if (off < -6) words.push("short");
  }
  if (mask & F_BUILD) {
    const b = BUILD_WORDS(d[o + 2]!);
    if (b) words.push(b);
  }
  words.push(mask & F_SEX ? (f ? "woman" : "man") : "someone");
  let s = words.join(" ");
  if (mask & F_COLOUR) s += ` in ${colour ?? colourName(d[o + 3]!, d[o + 4]!, d[o + 5]!)}`;
  if (mask & F_QUIRKS) {
    const has = (q: (typeof QUIRK_SEEN)[number]) => (d[o + 6]! & (1 << QUIRK_SEEN.indexOf(q))) !== 0;
    if (has("cane")) s += " with a cane";
    if (has("glasses")) s += ", glasses";
    if (has("limp")) s += ", limping";
  }
  return s;
}

/** How a room is named on the radio: "the study", "the terrace". */
function roomWords(bp: MansionBlueprint, room: number): string {
  if (room === -2) return "the terrace";
  if (room < 0) return "the garden";
  return `the ${bp.rooms[room]!.label.toLowerCase()}`;
}

/** Where someone is, on the radio: "in the study", "on the terrace". */
const roomIn = (bp: MansionBlueprint, room: number) => `${room === -2 ? "on" : "in"} ${roomWords(bp, room)}`;

/** A description, then where they are: a comma first when the description ends in one of its own ("..., limping, in the hall"). */
const at = (text: string, where: string) => `${text}${text.includes(",") ? "," : ""} ${where}`;

const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => NUMBERS[n] ?? String(n);

const CALLSIGNS = ["One", "Two", "Three", "Four"];

// ---------------------------------------------------------------- observers

interface Observer {
  index: number;
  hire: ObserverHire;
  view: View;
  rng: Rng;
  quiet: boolean;
  /** Whom they watch (-1 nobody), whether they have them in view (as last called), and the room they were settled in. */
  watch: number;
  watchSeen: boolean;
  watchRoom: number;
  /** Since when the view of them has differed from watchSeen, and since when they have stood in another room than watchRoom (-1 not). */
  flipAt: number;
  moveAt: number;
  stats: ObserverStats;
}

/** An act under way: one event per person, verb and stretch of time; `decided` per observer. */
interface Act {
  verb: Verb;
  start: number;
  /** Last step it was seen under way. */
  last: number;
  room: number;
  decided: Uint8Array;
}

export class Observers {
  readonly list: Observer[];
  /** One channel for them all. */
  readonly radio = new Radio();
  /** Every call made, in order (said or not). */
  readonly calls: ObserverCall[] = [];
  private readonly acts = new Map<number, Act>();
  private readonly orders: ObserverOrder[];
  private nextOrder = 0;

  constructor(
    private readonly h: ObserverHost,
    opts: ObserverOptions,
    rng: Rng,
  ) {
    this.list = opts.hires.map((hire, index) => ({
      index,
      hire,
      view: new View(h, hire.azDeg),
      rng: rng.fork(`o${index}`),
      quiet: false,
      watch: -1,
      watchSeen: false,
      watchRoom: -1,
      flipAt: -1,
      moveAt: -1,
      stats: { events: 0, noticed: 0, lost: 0, back: 0, moved: 0, calls: 0, shots: 0 },
    }));
    this.orders = [...(opts.orders ?? [])].sort((a, b) => a.t - b.t);
  }

  /** The observer's label in the log: "One (rookie, 20° left)". */
  label(i: number): string {
    const o = this.list[i]!;
    const a = Math.round(o.hire.azDeg);
    return `${CALLSIGNS[i] ?? i + 1} (${o.hire.tier}, ${a === 0 ? "on the axis" : `${Math.abs(a)}° ${a < 0 ? "left" : "right"}`})`;
  }

  /** The eye of an observer (for the lab's overlay). */
  eye(i: number): Vec3 {
    return this.list[i]!.view.eye;
  }

  /** How well observer `i` makes someone out now (0 to 1; SEEN or more is in view). */
  sees(i: number, p: Person): number {
    return this.list[i]!.view.person(p);
  }

  /**
   * An order given now (the lab's radio wheel, `o.t` the party's time). It is carried out on the next step, as the
   * same order replayed from the options would be, so a replayed evening hears exactly the same calls.
   */
  order(o: ObserverOrder): void {
    let i = this.orders.length;
    while (i > this.nextOrder && this.orders[i - 1]!.t > o.t) i--;
    this.orders.splice(i, 0, o);
  }

  /** One step, on the party's sight tick: orders given before it, acts in view, the watched, then the radio. */
  step(): void {
    const t = this.h.t;
    while (this.nextOrder < this.orders.length && this.orders[this.nextOrder]!.t < t) this.apply(this.orders[this.nextOrder++]!);
    this.lookAtActs(t);
    for (const o of this.list) if (o.watch >= 0) this.follow(o, t);
    this.radio.step(t);
  }

  /**
   * The bullet struck at `at` (a body or a surface; `blocked`: a wall stopped it short): each observer who sees the
   * spot may call it. Its draws come from a fork by the shot's time and number (`n`), so a shot fired from the lab
   * leaves the rest of the observers' evening as it was.
   */
  shot(at: Vec3, room: number, struck: "body" | "surface", blocked: boolean, t = this.h.t, n = 0): void {
    for (const o of this.list) {
      if (o.view.point(at, room) < SEEN) continue;
      o.stats.shots++;
      const rng = o.rng.fork(`shot:${Math.round(t * 2)}:${n}`);
      if (!rng.chance(SPOTTERS[o.hire.tier].notices)) continue;
      const hit = struck === "body" && !blocked;
      // A rookie reads hit or miss; the others say where it struck. Reading the wound is milestone 4's.
      const where = o.hire.tier === "rookie" ? "" : blocked ? ", it struck the wall" : ` ${roomIn(this.h.bp, room)}`;
      this.say(o, "shot", hit ? "hit" : "miss", t, `${hit ? "Hit" : "Miss"}${where}.`, -1, room, null, rng);
    }
  }

  /** A short digest of everything they said (determinism tests). */
  digest(): string {
    let h = 0;
    const mix = (s: string) => {
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    };
    for (const c of this.calls) mix(`${c.by}:${Math.round(c.t * 10)}:${Math.round(c.at * 10)}:${c.text}`);
    for (const a of this.radio.log) mix(`${Math.round(a.start * 10)}`);
    mix(`d${this.radio.dropped.length}`);
    return `${this.calls.length}:${(h >>> 0).toString(16)}`;
  }

  // ------------------------------------------------------------------ inside

  private apply(o: ObserverOrder): void {
    for (const ob of this.list) {
      if (o.to !== -1 && o.to !== ob.index) continue;
      if (o.kind === "quiet") {
        ob.quiet = o.on;
        if (o.on) this.radio.quiet();
      } else if (o.kind === "watch") this.watch(ob, o.who, o.t);
      else this.report(ob, o.room, o.t);
    }
  }

  private watch(o: Observer, who: number, t: number): void {
    o.watch = who;
    const p = this.h.people[who];
    if (!p) return;
    o.watchSeen = o.view.person(p) >= SEEN;
    o.watchRoom = p.room;
    o.flipAt = -1;
    o.moveAt = -1;
    const d = this.describe(o, p);
    this.say(o, "sighting", "watching", t, o.watchSeen ? `Watching the ${at(d.text, roomIn(this.h.bp, p.room))}.` : `No eyes on the ${d.text}.`, who, p.room, d.desc);
  }

  /** Who they can make out in a room, described; or that they can't see into it. */
  private report(o: Observer, room: number, t: number): void {
    const seen: Person[] = [];
    let any = false;
    for (const p of this.h.people) {
      if (!p.present || p.room !== room) continue;
      const v = o.view.person(p);
      if (v > 0) any = true;
      // A requested look is deliberate, but a rookie still overlooks some.
      if (v >= SEEN && o.rng.chance(SPOTTERS[o.hire.tier].notices)) seen.push(p);
    }
    const where = roomWords(this.h.bp, room);
    const Where = where[0]!.toUpperCase() + where.slice(1);
    let text: string;
    if (!seen.length) text = any ? `${Where}, nobody I can make out.` : `No view into ${where}.`;
    else {
      const ds = seen.slice(0, 4).map((p) => this.describe(o, p).text);
      const more = seen.length > 4 ? `; ${count(seen.length - 4)} more` : "";
      text = `${Where}, ${count(seen.length)}: ${ds.join("; ")}${more}.`;
    }
    this.say(o, "sighting", "report", t, text, -1, room, null);
  }

  private lookAtActs(t: number): void {
    const n = this.list.length;
    for (const p of this.h.people) {
      const verb = p.present && p.notable && t < p.notableUntil && ACT_CALLS[p.notable] ? p.notable : null;
      let a = this.acts.get(p.id);
      if (!verb) continue;
      // The same act carries on while it is seen under way step after step; anything else is a new one.
      if (!a || a.verb !== verb || a.last < t - 1) {
        a = { verb, start: t, last: t, room: p.room, decided: new Uint8Array(n) };
        this.acts.set(p.id, a);
      }
      a.last = t;
      for (const o of this.list) {
        if (a.decided[o.index] || o.view.person(p) < SEEN) continue;
        a.decided[o.index] = 1;
        o.stats.events++;
        if (!o.rng.chance(SPOTTERS[o.hire.tier].notices)) continue;
        o.stats.noticed++;
        if (o.quiet) continue;
        const d = this.describe(o, p);
        const room = p.notableRoom >= 0 ? p.notableRoom : p.room;
        this.say(o, "sighting", verb, t, `${cap(d.text)}, ${ACT_CALLS[verb]}, ${roomIn(this.h.bp, room)}.`, p.id, room, d.desc);
      }
    }
  }

  /**
   * The watched person, each change a "target moving" call by the tier's chance: lost once out of view for LOST_AFTER,
   * back once in view for BACK_AFTER, and moving when seen to settle in another room for MOVED_AFTER.
   */
  private follow(o: Observer, t: number): void {
    const p = this.h.people[o.watch]!;
    const seen = o.view.person(p) >= SEEN;
    if (seen !== o.watchSeen) {
      if (o.flipAt < 0) o.flipAt = t;
      if (t - o.flipAt < (seen ? BACK_AFTER : LOST_AFTER)) return;
      o.watchSeen = seen;
      o.flipAt = -1;
      o.moveAt = -1;
      const last = o.watchRoom;
      if (seen) o.watchRoom = p.room;
      if (!o.rng.chance(SPOTTERS[o.hire.tier].notices)) return;
      const d = this.describe(o, p);
      if (seen) {
        o.stats.back++;
        this.say(o, "moving", "back", t, `${cap(d.text)}, back in view ${roomIn(this.h.bp, p.room)}.`, p.id, p.room, d.desc);
      } else {
        o.stats.lost++;
        this.say(o, "moving", "lost", t, `Lost the ${at(d.text, roomIn(this.h.bp, last))}.`, p.id, last, d.desc);
      }
      return;
    }
    o.flipAt = -1;
    if (!seen || p.room === o.watchRoom) {
      o.moveAt = -1;
      return;
    }
    if (o.moveAt < 0) o.moveAt = t;
    if (t - o.moveAt < MOVED_AFTER) return;
    const from = o.watchRoom;
    o.watchRoom = p.room;
    o.moveAt = -1;
    if (!o.rng.chance(SPOTTERS[o.hire.tier].notices)) return;
    const d = this.describe(o, p);
    o.stats.moved++;
    this.say(o, "moving", "moved", t, `${cap(d.text)}, moving, from ${roomWords(this.h.bp, from)} to ${roomWords(this.h.bp, p.room)}.`, p.id, p.room, d.desc);
  }

  /** Someone's looks as this observer gives them: the register's description, with the tier's noise on the copy. */
  private describe(o: Observer, p: Person, rng = o.rng): { text: string; desc: Float32Array; mask: number } {
    const desc = new Float32Array(LOOKS_D);
    describeLooks(p, desc, 0);
    const noise = DESCRIBE_NOISE[o.hire.tier];
    let mask = F_SEX | F_HEIGHT | F_BUILD | F_COLOUR | F_QUIRKS;
    if (rng.chance(noise.drop)) {
      // Something left out: of what there is to say about them.
      const has = [F_HEIGHT, F_BUILD, F_COLOUR, ...(desc[6] ? [F_QUIRKS] : [])];
      mask &= ~rng.pick(has);
    }
    let colour = colourName(desc[3]!, desc[4]!, desc[5]!);
    const light = o.view.light(p.room);
    if (mask & F_COLOUR && rng.chance(noise.colour + noise.dark * (1 - light))) {
      colour = rng.pick(COLOURS.find((c) => c.name === colour)!.dim);
      const [r, g, b] = rgbOf(COLOURS.find((c) => c.name === colour)!.hex);
      desc[3] = r;
      desc[4] = g;
      desc[5] = b;
    }
    return { text: sayLooks(desc, 0, mask, colour), desc, mask };
  }

  private say(o: Observer, kind: CallKind, what: string, t: number, text: string, about: number, room: number, desc: Float32Array | null, rng = o.rng): void {
    const [lo, hi] = SPOTTERS[o.hire.tier].delayS;
    // With more than one on the channel, each opens with its callsign: "Two, woman in red at the safe".
    const said = this.list.length > 1 ? `${CALLSIGNS[o.index] ?? o.index + 1}, ${text[0]!.toLowerCase()}${text.slice(1)}` : text;
    const call: ObserverCall = { kind, text: said, at: t + rng.range(lo, hi), from: this.label(o.index), by: o.index, t, what, about, room, desc };
    o.stats.calls++;
    this.calls.push(call);
    this.radio.push(call);
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
