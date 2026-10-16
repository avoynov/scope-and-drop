/**
 * Conversation circles (milestone 2 technical plan: Mingling). A group stands in an F-formation:
 * members on a ring round an empty middle, facing in. A pair stands face to face. Newcomers
 * walk up to the edge where the members can see them and wait a few seconds; an open group
 * shifts to make a gap, a closed one doesn't, and the newcomer walks off. Above what one
 * conversation holds (four in a quiet room, three in a loud one) a circle splits at its next
 * turn. Each member stays 5 to 15 minutes, then takes an exit. People who know each other
 * greet when they first see each other tonight: a wave, the approach, a handshake or a kiss.
 */
import type { Rng } from "../mansion/core/rng";
import type { Candidate, MindWorld } from "./mind";
import type { Pathfinder } from "./path";
import { yawTo } from "./places";
import { SUSPICIOUS, WARY, type Memory } from "./memory";
import { TIE_WEIGHT, type Ident } from "./ident";
import type { ActionState, Gesture, Group, PartyEvent, Person, Pose, Spot } from "./types";
import type { Verb } from "./memory";

/** A pair stands face to face this far apart (m). */
export const PAIR_GAP = 0.9;
/** How far outside the ring a newcomer waits (m). */
const EDGE = 0.8;
/** A newcomer waits this long at the edge (in-game s) before the group shows whether it's open. */
const WAIT: readonly [number, number] = [2, 6];
/** The shy linger on at a closed circle this much longer (in-game s), hoping: the party ghost. */
const HOVER: readonly [number, number] = [6, 10];
/** Each member's stay (in-game s), before trait and company. */
const STAY: readonly [number, number] = [300, 900];
/** Above this room noise (dB) a conversation holds three, not four. */
const LOUD = 70;
/** A rebuffed newcomer keeps away from that circle this long (in-game s). */
const REBUFF = 600;
/** Greeting: seen within this range tonight for the first time (m); the kiss or handshake at 1.5 m, then a half step back. */
const GREET_RANGE = 8;

export interface GroupsHost {
  readonly t: number;
  readonly people: Person[];
  readonly pf: Pathfinder;
  readonly ident: Ident;
  readonly memory: Memory;
  /** Room noise in dB by room index (the terrace last). */
  noiseIn(room: number): number;
  /** 0 before dinner, rising to 1 by the dancing: how far the evening has mixed people. */
  readonly mixing: number;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
  gesture(p: Person, g: Gesture, secs: number): void;
  glance(p: Person, x: number, z: number, secs: number): void;
  notable(p: Person, verb: Verb, obj: number, secs: number): void;
  goTo(p: Person, s: Spot): boolean;
  end(p: Person, done: boolean): void;
  /** People each person took in on their last look. */
  seenLast(i: number): readonly number[];
  /** Whether p wants nothing to do with j for now (fallen out, keeping apart after a row). */
  shuns(p: Person, j: number): boolean;
  /** How much more p wants to join a circle with j in it for the bonds (noticing, flirting). */
  joinPull(i: number, j: number): number;
}

/** Room kept between one conversation's ring and the next one started (m). */
const CLEAR = 1.6;
/** Room between the rings of a circle that splits and the one that splits off (m). */
const SPLIT_GAP = 0.9;

/** A ring slot's radius for n members. */
export const ringRadius = (n: number): number => (n <= 2 ? PAIR_GAP / 2 : 0.45 + 0.12 * n);

export class Groups {
  readonly map = new Map<number, Group>();
  private next = 1;
  /** Who has greeted whom tonight (n × n, both ways). */
  private readonly met: Uint8Array;
  readonly stats = { joins: 0, rebuffs: 0, ghosts: 0, splits: 0, greetings: 0, stays: [] as number[], sizes: [0, 0, 0, 0, 0, 0, 0] };

  constructor(
    private readonly host: GroupsHost,
    private readonly rng: Rng,
  ) {
    const n = host.people.length;
    this.met = new Uint8Array(n * n);
  }

  /** How many one conversation holds in a room this loud. */
  maxSize(room: number): number {
    return this.host.noiseIn(room) > LOUD ? 3 : 4;
  }

  /** Members who are in the circle and standing in it (not still walking over). */
  settled(g: Group): number[] {
    return g.members.filter((m) => this.host.people[m]!.action?.startedAt != null);
  }

  /** A new circle round a spot a step in front of whoever starts it. */
  open(p: Person, at: Spot): Group {
    const g: Group = {
      id: this.next++,
      level: at.level,
      x: at.x + (Math.sin(at.yaw) * PAIR_GAP) / 2,
      z: at.z + (Math.cos(at.yaw) * PAIR_GAP) / 2,
      room: at.room,
      members: [p.id],
      speaker: p.id,
      speakerUntil: 0,
      quietUntil: 0,
    };
    this.map.set(g.id, g);
    return g;
  }

  /**
   * Where a newcomer waits: just outside the ring, in the widest gap between members (so they
   * can see them), facing the middle.
   */
  edge(g: Group): Spot | null {
    const people = this.host.people;
    const at = (m: number) => people[m]!.action?.target ?? people[m]!;
    // The widest gap in the ring, counting those already waiting at its edge.
    const round = [...g.members];
    for (const q of people) if (q.present && q.action?.id === "mingle" && q.action.ref === g.id && q.action.note !== "in") round.push(q.id);
    const angles = round.map((m) => Math.atan2(at(m).x - g.x, at(m).z - g.z)).sort((a, b) => a - b);
    let a = 0;
    if (angles.length === 1) a = angles[0]! + Math.PI;
    else if (angles.length > 1) {
      let best = -1;
      for (let i = 0; i < angles.length; i++) {
        const lo = angles[i]!;
        const hi = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 2 * Math.PI;
        if (hi - lo > best) {
          best = hi - lo;
          a = (lo + hi) / 2;
        }
      }
    }
    const r = ringRadius(g.members.length + 1) + EDGE;
    for (const da of [0, 0.35, -0.35, 0.7, -0.7]) {
      const x = g.x + Math.sin(a + da) * r;
      const z = g.z + Math.cos(a + da) * r;
      if (!this.host.pf.walkable(g.level, x, z)) continue;
      const room = this.host.pf.roomAt(g.level, x, z);
      if (room !== -1) return { level: g.level, x, z, yaw: yawTo(x, z, g.x, g.z), room };
    }
    return null;
  }

  /**
   * Joining candidates for the mind: the edge of every circle worth joining, scored by who is in
   * it, plus a couple of places to start a conversation of one's own.
   */
  candidates(p: Person, w: MindWorld, tension: number): Candidate[] {
    const out: Candidate[] = [];
    const people = this.host.people;
    for (const g of this.map.values()) {
      if (g.members.length >= 6 || g.members.includes(p.id) || Math.abs(g.level - p.level) > 1) continue;
      if ((p.avoid.get(`group:${g.id}`) ?? -1) > this.host.t) continue;
      const slot = this.edge(g);
      if (!slot) continue;
      if (g.members.some((m) => this.host.shuns(p, m))) continue;
      let mod = 1;
      let wary = false;
      let suspect = false;
      let same = 0;
      for (const m of g.members) {
        const o = people[m]!;
        mod += this.host.joinPull(p.id, m);
        mod += 0.35 * o.traits.talk;
        // Uneasy people keep closer to their own.
        if (o.id === p.partner) mod += (p.archetype === "plus-one" ? 2.5 : 1.2) * (1 + tension);
        if (p.friends.includes(o.id)) mod += 0.6 * (1 + tension);
        if (o.id === p.linked && p.archetype === "employee") mod += 2;
        if (o.archetype === "honoree") mod += 0.6;
        if (o.archetype === "bore" && p.id !== o.id) mod *= 0.5;
        if (o.id === p.ex) mod *= 0.1;
        if (o.look.sex === p.look.sex) same++;
        const s = w.suspects(p.id, m);
        if (s >= WARY) wary = true;
        if (s >= SUSPICIOUS) suspect = true;
      }
      // Early on people keep to their own sex; it fades by the dancing.
      mod *= 1 + 0.6 * (1 - this.host.mixing) * (same / g.members.length - 0.5);
      if (g.members.length >= this.maxSize(g.room)) mod *= 0.35;
      if (p.archetype === "gossip") mod *= 1.3;
      // Nobody seeks out a quiet word with someone they're wary of.
      if (wary && g.members.length === 1) mod *= 0.2;
      else if (suspect) mod *= 0.5;
      out.push({ id: "mingle", target: slot, duration: 99999, pose: "talk", gain: { social: 0.6 }, ref: g.id, note: "edge", mod: Math.max(0.01, mod) });
    }
    return out;
  }

  /** Whether a new conversation started at a spot would stand on top of one already going. */
  crowds(s: Spot): boolean {
    for (const g of this.map.values()) if (g.level === s.level && Math.hypot(g.x - s.x, g.z - s.z) < ringRadius(g.members.length + 1) + CLEAR) return true;
    return false;
  }

  /** Whether a circle of n centred here would rub shoulders with another one (other than skip). */
  private near(level: number, x: number, z: number, n: number, skip: Group): boolean {
    for (const o of this.map.values()) if (o !== skip && o.level === level && Math.hypot(o.x - x, o.z - z) < ringRadius(o.members.length) + ringRadius(n) + SPLIT_GAP) return true;
    return false;
  }

  /** How long a newcomer waits at the edge before the circle shows whether it's open (in-game s). */
  waitFor(): number {
    return this.rng.range(WAIT[0], WAIT[1]);
  }

  /** Waiting at the edge is over: the circle opens and shifts to make a gap (true), or stays closed and they walk off. */
  decide(p: Person, a: ActionState): boolean {
    const h = this.host;
    const g = this.map.get(a.ref ?? -1);
    if (!g || !g.members.length) {
      // The circle broke up while they waited: they start one where they stand.
      const here: Spot = { level: p.level, x: p.x, z: p.z, yaw: p.yaw, room: p.room };
      const ng = this.open(p, here);
      a.ref = ng.id;
      a.note = "in";
      a.until = h.t + this.stay(p, ng);
      a.duration = a.until - h.t;
      return false;
    }
    const open = this.openness(g, p);
    const hovering = a.note === "hover";
    const members = this.settled(g);
    if (this.rng.chance(hovering ? open * 0.5 : open)) {
      this.stats.joins++;
      h.log("join", [p.id, ...members], g.room, "open");
      g.members.push(p.id);
      a.note = "in";
      a.until = h.t + this.stay(p, g);
      a.duration = a.until - h.t;
      this.reslot(g, p.id);
      return true;
    }
    // Closed: nobody moves, nobody looks up. Most walk off rather than push; the shy linger a little longer first.
    if (!hovering && (p.traits.nerves > 0.6 || p.archetype === "plus-one") && this.rng.chance(0.5)) {
      a.note = "hover";
      a.until = h.t + this.rng.range(HOVER[0], HOVER[1]);
      return false;
    }
    this.stats.rebuffs++;
    h.log("join", [p.id, ...members], g.room, "closed");
    p.avoid.set(`group:${g.id}`, h.t + REBUFF);
    if (hovering) {
      this.stats.ghosts++;
      h.notable(p, "hovering", -1, 10);
    }
    h.end(p, false);
    return false;
  }

  /** How open a circle is to someone: the members' ties to them, friends and partners, a small circle, less any suspicion. */
  openness(g: Group, p: Person): number {
    const h = this.host;
    let aff = 0;
    let friend = 0;
    let partner = 0;
    let susp = 0;
    let ex = 0;
    for (const m of g.members) {
      // Someone fallen out with the newcomer, or keeping apart from them, keeps the circle shut.
      if (h.shuns(h.people[m]!, p.id)) return 0.03;
      aff += TIE_WEIGHT[h.ident.tieOf(m, p.id)]!;
      if (h.people[m]!.friends.includes(p.id)) friend = 0.3;
      if (h.people[m]!.partner === p.id || h.people[m]!.linked === p.id) partner = 0.5;
      if (h.people[m]!.ex === p.id) ex = 0.5;
      susp = Math.max(susp, h.memory.suspects(m, p.id));
    }
    const n = g.members.length;
    const size = n <= 2 ? 0.1 : n === 3 ? 0 : -0.15;
    const full = n >= this.maxSize(g.room) ? 0.35 : 0;
    return Math.max(0.03, Math.min(0.97, 0.62 + 0.4 * (aff / n) + friend + partner + size - full - 1.2 * susp - ex));
  }

  /** A member's stay: 5 to 15 minutes, longer with a partner or a friend in the circle, shorter with the bore, and the gossip moves on sooner. */
  stay(p: Person, g: Group): number {
    const people = this.host.people;
    let k = 1;
    for (const m of g.members) {
      if (m === p.id) continue;
      if (m === p.partner || p.friends.includes(m)) k = Math.max(k, 1.3);
      if (people[m]!.archetype === "bore") k *= 0.6;
    }
    if (p.archetype === "gossip") k *= 0.5;
    if (p.archetype === "bore") k *= 1.4;
    return this.rng.range(STAY[0], STAY[1]) * k;
  }

  /**
   * Slots at equal angles round the middle, turned so members move least; whoever is walking in
   * or standing far from their slot goes to it. `joiner` keeps the angle they came in from.
   */
  reslot(g: Group, joiner = -1): void {
    const h = this.host;
    const people = h.people;
    const n = g.members.length;
    if (!n) return;
    const r = ringRadius(n);
    const at = (m: number) => (m === joiner || people[m]!.action?.startedAt == null ? (people[m]!.action?.target ?? people[m]!) : people[m]!);
    const cur = g.members.map((m) => ({ m, a: Math.atan2(at(m).x - g.x, at(m).z - g.z) }));
    cur.sort((x, y) => x.a - y.a);
    // The rotation that moves members least: the circular mean of (current angle − slot angle).
    let sx = 0;
    let sz = 0;
    cur.forEach((c, i) => {
      const d = c.a - (2 * Math.PI * i) / n;
      sx += Math.sin(d);
      sz += Math.cos(d);
    });
    const rot = Math.atan2(sx, sz);
    cur.forEach((c, i) => {
      const a = rot + (2 * Math.PI * i) / n;
      const x = g.x + Math.sin(a) * r;
      const z = g.z + Math.cos(a) * r;
      const s = h.pf.snap(g.level, x, z, 0.4);
      if (!s) return;
      const room = h.pf.roomAt(g.level, s.x, s.z);
      if (room === -1) return;
      const p = people[c.m]!;
      const act = p.action;
      if (!act || act.id !== "mingle") return;
      const here = act.startedAt == null ? act.target : p;
      if (c.m !== joiner && here && Math.hypot(here.x - s.x, here.z - s.z) < 0.25) return;
      const spot: Spot = { level: g.level, x: s.x, z: s.z, yaw: yawTo(s.x, s.z, g.x, g.z), room };
      const keep = act.until;
      if (h.goTo(p, spot)) act.until = keep;
    });
  }

  /** Someone left (having joined at `since`, for the stays): the rest close up. */
  left(p: Person, g: Group, since = -1): void {
    if (since >= 0 && g.members.includes(p.id)) this.stats.stays.push(this.host.t - since);
    g.members = g.members.filter((m) => m !== p.id);
    if (!g.members.length) {
      this.map.delete(g.id);
      return;
    }
    if (g.members.length >= 2) this.reslot(g);
  }

  /**
   * At a new speaker's turn, a circle past what one conversation holds splits: the speaker and
   * their nearest neighbour keep the spot, the rest form a circle 1.5 m away. Returns the new circle.
   */
  maybeSplit(g: Group): Group | null {
    const h = this.host;
    const people = h.people;
    const here = this.settled(g);
    if (here.length < 5 || here.length <= this.maxSize(g.room)) return null;
    const sp = people[g.speaker] ?? people[here[0]!]!;
    const near = here.filter((m) => m !== sp.id).sort((a, b) => Math.hypot(people[a]!.x - sp.x, people[a]!.z - sp.z) - Math.hypot(people[b]!.x - sp.x, people[b]!.z - sp.z))[0]!;
    const keep = new Set([sp.id, near]);
    // Those who move off are on the far side from the speaker.
    const off = g.members.filter((m) => !keep.has(m)).sort((a, b) => Math.hypot(people[b]!.x - sp.x, people[b]!.z - sp.z) - Math.hypot(people[a]!.x - sp.x, people[a]!.z - sp.z));
    const go = off.slice(0, Math.max(2, Math.floor(g.members.length / 2)));
    let mx = 0;
    let mz = 0;
    for (const m of go) {
      mx += people[m]!.x;
      mz += people[m]!.z;
    }
    mx /= go.length;
    mz /= go.length;
    // The new circle forms a clear step away on their side, or wherever round the old one there's room.
    const base = Math.atan2(mx - g.x, mz - g.z);
    const reach = ringRadius(g.members.length - go.length) + ringRadius(go.length) + SPLIT_GAP;
    let c: { x: number; z: number } | null = null;
    let room = -1;
    for (const da of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
      const s = h.pf.snap(g.level, g.x + Math.sin(base + da) * reach, g.z + Math.cos(base + da) * reach, 0.3);
      if (!s || Math.hypot(s.x - g.x, s.z - g.z) < reach - 0.3) continue;
      const r = h.pf.roomAt(g.level, s.x, s.z);
      if (r === -1 || this.near(g.level, s.x, s.z, go.length, g)) continue;
      c = s;
      room = r;
      break;
    }
    if (!c) return null;
    const ng: Group = { id: this.next++, level: g.level, x: c.x, z: c.z, room, members: go, speaker: go[0]!, speakerUntil: 0, quietUntil: 0 };
    this.map.set(ng.id, ng);
    g.members = g.members.filter((m) => !go.includes(m));
    for (const m of go) {
      const a = people[m]!.action;
      if (a?.id === "mingle") a.ref = ng.id;
    }
    this.stats.splits++;
    h.log("split", go, g.room);
    this.reslot(g);
    this.reslot(ng);
    return ng;
  }

  /** Sizes of circles with two or more standing in them, for the stats. */
  sample(): void {
    for (const g of this.map.values()) {
      const k = this.settled(g).length;
      if (k >= 2) this.stats.sizes[Math.min(6, k)]!++;
    }
  }

  // ---------------------------------------------------------------- greeting

  /** Whether i and j have greeted each other tonight. */
  hasGreeted(i: number, j: number): boolean {
    return this.met[i * this.host.people.length + j] === 1;
  }

  markGreeted(i: number, j: number): void {
    const n = this.host.people.length;
    this.met[i * n + j] = 1;
    this.met[j * n + i] = 1;
  }

  /**
   * The first sighting tonight of someone known within 8 m: a wave, and for those free to, the
   * approach. Returns the person to go and greet, or -1.
   */
  greetWho(p: Person, free: boolean): number {
    const h = this.host;
    const people = h.people;
    for (const j of h.seenLast(p.id)) {
      const q = people[j]!;
      if (q.staff || q === p || this.hasGreeted(p.id, j) || h.ident.tieOf(p.id, j) < 2 || q.level !== p.level) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > GREET_RANGE) continue;
      this.markGreeted(p.id, j);
      h.gesture(p, "wave", 2);
      h.glance(p, q.x, q.z, 2);
      // Close friends and family, or anyone they're fond of, come over; acquaintances just wave.
      if (free && d > 1.6 && (h.ident.tieOf(p.id, j) >= 3 || this.rng.chance(0.3)) && q.action?.id !== "toilet" && q.action?.id !== "leave") return j;
      this.stats.greetings++;
      h.log("greet", [p.id, j], p.room, "wave");
      return -1;
    }
    return -1;
  }

  /** Close enough: a handshake or a kiss on the cheek by how well they know each other. */
  greetPose(p: Person, q: Person): Pose {
    const tie = this.host.ident.tieOf(p.id, q.id);
    const twoMen = p.look.sex === "m" && q.look.sex === "m";
    return tie >= 3 && !twoMen ? "kiss" : "shake";
  }

  /** The kiss or handshake happened. */
  greeted(p: Person, q: Person, pose: Pose): void {
    this.stats.greetings++;
    this.host.log("greet", [p.id, q.id], p.room, pose);
  }
}
