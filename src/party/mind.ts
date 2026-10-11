/**
 * The guest mind: needs that fall over time, actions that advertise what they refill,
 * and a utility score that picks among them (spec: Guest mind).
 *
 *   U(a) = W_phase(a) · (Σ g_n · c(1 − v_n)) · T(a) · D(a) · K(a)
 *
 * W is how fitting the action is in the phase the person believes is running, g what
 * it refills, c a response curve on urgency, T traits, D a distance penalty and K
 * whether the person knows it is possible (their memory of a busy bathroom, say).
 * The choice is a weighted draw over the best few, not the maximum.
 *
 * Minds that notice (milestone 2): people only plan toward rooms they know; with no bathroom
 * known they ask someone the way. Energy draws them to the dance floor, tension toward friends,
 * and they keep clear of conversations with someone they're wary of.
 *
 * Everyday life (milestone 2, PR 3a): what the house offers comes from the advertisement table
 * (ads.ts), conversations from the circles (groups.ts), and the evening's rituals pull on every
 * score through their beats (practices.ts).
 */
import type { Rng } from "../mansion/core/rng";
import type { Offer } from "./ads";
import { PARTY_LENGTH, type PhaseId } from "./clock";
import type { Groups } from "./groups";
import type { Places, RoomCells } from "./places";
import type { Pathfinder } from "./path";
import { KNOWN } from "./memory";
import { DRINKS, type ActionId, type ActionState, type Held, type NeedId, type Needs, type Person, type Pose, type Seat, type Spot } from "./types";

/** How fitting each action is in each phase (0 = never chosen). */
export const PHASE_WEIGHTS: Record<PhaseId, Partial<Record<ActionId, number>>> = {
  arrival: { mingle: 1, drink: 0.9, toilet: 1, sit: 0.3, art: 0.6, terrace: 0.5, wander: 0.35, use: 0.45, snack: 0.3 },
  mingle: { mingle: 1.4, drink: 1, toilet: 1, sit: 0.5, art: 0.7, terrace: 0.6, dance: 0.1, games: 0.3, wander: 0.3, use: 0.6, snack: 0.45 },
  champagne: { champagne: 4, mingle: 0.6, toilet: 0.4, sit: 0.15, art: 0.15, terrace: 0.15, wander: 0.05, use: 0.1 },
  toast: { toast: 8, champagne: 5, toilet: 0.15 },
  dinner: { dinner: 10, toilet: 0.3 },
  dancing: { dance: 2.4, mingle: 0.9, drink: 1, sit: 0.8, terrace: 0.6, toilet: 1, art: 0.2, wander: 0.15, use: 0.3, snack: 0.25 },
  games: { games: 1.6, mingle: 0.8, drink: 1, sit: 0.7, terrace: 0.6, toilet: 1, dance: 0.3, art: 0.3, wander: 0.15, use: 0.55, snack: 0.3 },
  farewell: { toast: 8, mingle: 0.4, drink: 0.2, toilet: 0.3, use: 0.1 },
};

/** Share of the farewell phase spent on the last toast before people start to leave. */
export const LAST_TOAST = 0.35;

/** Need decay per in-game minute. */
/** Run each need down over k in-game minutes, at rates set by traits, habits and drink (in place: it runs for everyone every step). */
export function decay(p: Person, k: number): void {
  const t = p.traits;
  const n = p.needs;
  const tipsy = p.tipsy;
  const limp = p.quirks.includes("limp") ? 1 : 0;
  const smoker = p.quirks.includes("smoker") ? 1 : 0;
  n.thirst = Math.max(0, n.thirst - 0.01 * (0.6 + 0.8 * t.thirst) * k);
  n.hunger = Math.max(0, n.hunger - 0.004 * k);
  n.bladder = Math.max(0, n.bladder - (0.003 + 0.009 * tipsy) * k);
  n.social = Math.max(0, n.social - 0.024 * (0.4 + 1.2 * t.social) * k);
  n.dance = Math.max(0, n.dance - (0.006 * (0.3 + 1.4 * t.dance) + 0.025 * tipsy) * k);
  n.rest = Math.max(0, n.rest - (0.003 + 0.004 * limp) * k);
  n.air = Math.max(0, n.air - (0.003 + 0.01 * smoker) * k);
  n.curiosity = Math.max(0, n.curiosity - 0.006 * (0.4 + 1.2 * t.curiosity) * k);
}

export interface Candidate {
  id: ActionId;
  target: Spot | null;
  seat?: Seat;
  duration: number;
  pose: Pose;
  gain: Partial<Needs>;
  /** Fixed programme actions ignore needs. */
  programme?: boolean;
  ref?: number;
  note?: string;
  gives?: Held | null;
  /** Reservation key for the spot (one person per spot). */
  key?: string;
  /** Trait and context multiplier. */
  mod?: number;
}

/** What a mind can ask of the world when choosing. */
export interface MindWorld {
  t: number;
  rng: Rng;
  places: Places;
  cells: RoomCells;
  pf: Pathfinder;
  people: Person[];
  /** What the house offers, resolved from the advertisement table. */
  offers: readonly Offer[];
  /** Conversation circles. */
  circles: Groups;
  taken(key: string): boolean;
  seatTaken(seat: Seat): boolean;
  /** Whether this person would try this bathroom, from what they've seen of its door. */
  worthTrying(p: Person, i: number): boolean;
  /** How full the glass in their hand is (0 with none). */
  glassFill(p: Person): number;
  /** Phase the person believes is running, and how far into it. */
  phaseOf(p: Person): { id: PhaseId; progress: number };
  /** How well this person knows a room (-2 the terrace), 0 to 1. */
  familiarity(p: Person, room: number): number;
  /** How much i suspects j, 0 to 1. */
  suspects(i: number, j: number): number;
  /** How lively and how uneasy this person feels, 0 to 1. */
  energy(p: Person): number;
  tension(p: Person): number;
  /** Someone near and known to ask the way, or null. */
  answerer(p: Person): Person | null;
  /** How the evening's practices pull on an action right now (1 leaves it as it is). */
  beat(p: Person, a: ActionId): number;
}

/** Actions that go wherever the evening or the crowd goes, known room or not. */
const ANYWHERE: ReadonlySet<ActionId> = new Set(["champagne", "toast", "dinner", "leave", "wander", "ask"]);
/** Below this bladder level someone goes looking for any bathroom, known or not. */
const DESPERATE = 0.1;
/** Offers kept for full scoring after the quick prefilter (need over distance). */
const SHORTLIST = 24;

export const spotKey = (s: Spot): string => `${s.level}:${s.x.toFixed(2)},${s.z.toFixed(2)}`;

const urgency = (v: number): number => {
  const u = 1 - Math.max(0, Math.min(1, v));
  return u * u;
};

function needTerm(p: Person, gain: Partial<Needs>): number {
  let s = 0.05;
  for (const k in gain) s += (gain[k as NeedId] ?? 0) * 2.5 * urgency(p.needs[k as NeedId]);
  return s;
}

function distance(p: Person, s: Spot | null): number {
  if (!s) return 0;
  return Math.hypot(s.x - p.x, s.z - p.z) + 8 * Math.abs(s.level - p.level);
}

function nearest<T extends Spot>(p: Person, list: T[], n: number, rng: Rng): T[] {
  if (list.length <= n) return list;
  // Mostly the nearest, sometimes a random one so people don't always use the same corner.
  const sorted = [...list].sort((a, b) => distance(p, a) - distance(p, b));
  const out = sorted.slice(0, Math.max(1, n - 1));
  out.push(rng.pick(list));
  return out;
}

/** Every action this person could start now, before scoring. */
export function candidates(p: Person, w: MindWorld): Candidate[] {
  const all = allCandidates(p, w);
  // Only toward rooms they know (a desperate bathroom trip aside).
  return all.filter((c) => ANYWHERE.has(c.id) || !c.target || (c.id === "toilet" && p.needs.bladder < DESPERATE) || w.familiarity(p, destination(c, w.places)) >= KNOWN);
}

/** The room someone has in mind when they set off: the bathroom itself, not the corridor outside its door. */
export function destination(a: { id: ActionId; target: Spot | null; ref?: number }, places: Places): number {
  if (a.id === "toilet" && a.ref !== undefined) return places.bathrooms[a.ref]?.room.index ?? a.target?.room ?? -1;
  return a.target?.room ?? -1;
}

function allCandidates(p: Person, w: MindWorld): Candidate[] {
  const { rng, places, cells, people } = w;
  const out: Candidate[] = [];
  const phase = w.phaseOf(p);
  const W = PHASE_WEIGHTS[phase.id];
  const has = (a: ActionId) => (W[a] ?? 0) > 0;
  const tension = w.tension(p);

  if (has("mingle")) {
    out.push(...w.circles.candidates(p, w, tension));
    for (let i = 0; i < 2; i++) {
      const room = rng.pick(places.mingleRooms.length ? places.mingleRooms : [places.toastRoom.index]);
      // Ground floor rooms draw most people; upstairs and the terrace less.
      const s = cells.random(rng.chance(0.15) && places.terrace.length ? -2 : room, rng, 0.9);
      // Not on top of a conversation already going.
      if (s && w.circles.crowds(s)) continue;
      if (s) out.push({ id: "mingle", target: s, duration: 99999, pose: "talk", gain: { social: 0.5 }, ref: -1, note: "new", mod: (s.level === 0 ? 0.7 : 0.4) * (0.6 + p.traits.talk * 0.6) });
    }
  }
  if (has("drink") && !(p.held && DRINKS.has(p.held) && p.held !== "champagne")) {
    // The bar pours what they ask for when their turn comes (body.ts).
    for (const s of nearest(
      p,
      places.bars.filter((b) => !w.taken(spotKey(b))),
      2,
      rng,
    )) {
      out.push({ id: "drink", target: s, duration: rng.range(90, 200), pose: "drink", gain: { thirst: 0.8, social: 0.1 }, ref: places.bars.indexOf(s), note: "bar-go", key: spotKey(s) });
    }
  }
  // A fresh glass for the toast unless the one in hand will last it.
  if (has("champagne") && p.never !== "champagne" && !(p.held === "champagne" && w.glassFill(p) > 0.5)) {
    out.push({ id: "champagne", target: null, duration: 20, pose: "stand", gain: {}, programme: true, gives: "champagne" });
  }
  // In the last 20 minutes only if it can't wait: the bathroom may be two floors up at the far end of the house.
  if (has("toilet") && !(w.t > PARTY_LENGTH - 20 * 60 && p.needs.bladder > 0.2)) {
    places.bathrooms.forEach((b, i) => {
      if ((p.avoid.get(`bath:${i}`) ?? -1) > w.t || !w.worthTrying(p, i)) return;
      out.push({ id: "toilet", target: b.door, duration: rng.range(120, 240), pose: "wait", gain: { bladder: 1 }, ref: i, note: "door" });
    });
    // No idea where one is: ask someone (scored as the bathroom itself).
    if (places.bathrooms.length && places.bathrooms.every((b) => w.familiarity(p, b.room.index) < KNOWN)) {
      const q = w.answerer(p);
      const s = q ? beside(q, p, w.pf) : null;
      if (q && s) out.push({ id: "ask", target: s, duration: 4, pose: "talk", gain: { bladder: 1 }, ref: q.id, note: "bathroom" });
    }
  }
  out.push(...offerCandidates(p, w, phase.id));
  if (has("dance") && places.danceSpots.length) {
    const partner = p.partner !== null ? people[p.partner] : undefined;
    const partnerDancing = partner?.action?.id === "dance";
    for (let i = 0; i < 3; i++) {
      let s = rng.pick(places.danceSpots);
      // Couples dance together: next to the partner's spot.
      if (partnerDancing && partner?.action?.target && i === 0) {
        const q = places.danceSpots.filter((d) => Math.hypot(d.x - partner.action!.target!.x, d.z - partner.action!.target!.z) < 1.4 && !w.taken(spotKey(d)));
        if (q.length) s = q[0]!;
      }
      if (w.taken(spotKey(s))) continue;
      const after = p.quirks.includes("dances-after-drink") && p.tipsy > 0.15 ? 1.6 : 1;
      // Lively people take to the floor.
      const energy = 0.6 + 0.8 * w.energy(p);
      out.push({
        id: "dance",
        target: s,
        duration: rng.range(240, 600),
        pose: "dance",
        gain: { dance: 0.8, social: 0.2 },
        key: spotKey(s),
        mod: (0.4 + p.traits.dance) * (partnerDancing ? 1.6 : 1) * after * energy,
      });
    }
  }
  if (has("wander")) {
    const s = cells.random(rng.pick(places.mingleRooms.length ? places.mingleRooms : [places.toastRoom.index]), rng);
    if (s) out.push({ id: "wander", target: s, duration: rng.range(20, 60), pose: "look", gain: { curiosity: 0.15 }, mod: 0.4 + p.traits.curiosity * 0.6 });
  }
  if (has("toast") && (phase.id === "toast" || phase.progress < LAST_TOAST)) {
    const s = toastSpot(w);
    if (s) out.push({ id: "toast", target: s, duration: 99999, pose: "stand", gain: { social: 0.2 }, programme: true });
  }
  if (has("dinner")) {
    const seat = p.seat !== null ? places.diningSeats[p.seat] : undefined;
    const supper = !seat && p.supper !== null ? places.supperSeats[p.supper] : undefined;
    if (seat) out.push({ id: "dinner", target: seat.approach, seat, duration: 99999, pose: "sit", gain: { hunger: 1, social: 0.4 }, programme: true });
    else if (supper && !w.seatTaken(supper))
      out.push({ id: "dinner", target: supper.approach, seat: supper, duration: 99999, pose: "sit", gain: { hunger: 1, social: 0.3 }, programme: true, note: "supper" });
    else {
      const free = places.buffet.filter((b) => !w.taken(spotKey(b)));
      const s = free.length ? rng.pick(free) : cells.random(places.toastRoom.index, rng);
      if (s) out.push({ id: "dinner", target: s, duration: 99999, pose: "stand", gain: { hunger: 1, social: 0.3 }, programme: true, key: spotKey(s) });
    }
  }
  return out;
}

/**
 * What the house offers this person now: every offer in a room they know, fitting the phase, with
 * a free spot. A quick prefilter (need over distance, with a little chance so people don't always
 * use the same corner) keeps the best few for full scoring.
 */
function offerCandidates(p: Person, w: MindWorld, phase: PhaseId): Candidate[] {
  const W = PHASE_WEIGHTS[phase];
  const pre: Array<{ o: Offer; s: Spot; spot: number; v: number }> = [];
  for (const o of w.offers) {
    const ad = o.ad;
    const k = (W[ad.action] ?? 0) * (ad.phases?.[phase] ?? 1);
    if (k <= 0 || (ad.gate && !ad.gate(p)) || w.familiarity(p, o.room) < KNOWN) continue;
    let spot = -1;
    if (o.seat) spot = w.seatTaken(o.seat) ? -1 : 0;
    else {
      for (let i = 0; i < o.spots.length && spot < 0; i++) {
        // The piano stool is the pianist's when they want it.
        if (ad.note === "piano" && i === 0 && p.role !== "pianist") continue;
        if (!w.taken(spotKey(o.spots[i]!))) spot = i;
      }
    }
    if (spot < 0) continue;
    const s = o.spots[spot]!;
    if ((p.avoid.get(spotKey(s)) ?? -1) > w.t) continue;
    const like = (p.archetype && ad.likes?.[p.archetype]) || 1;
    pre.push({ o, s, spot, v: (k * like * needTerm(p, ad.gains) * w.rng.range(0.5, 1.5)) / (1 + distance(p, s) / 30) });
  }
  pre.sort((a, b) => b.v - a.v);
  const out: Candidate[] = [];
  for (const { o, s, spot } of pre.slice(0, SHORTLIST)) {
    const ad = o.ad;
    const like = (p.archetype && ad.likes?.[p.archetype]) || 1;
    // Smokers take a cigarette out to the terrace.
    const smoke = ad.id === "terrace" && p.quirks.includes("smoker");
    const plays = ad.note === "piano" ? spot === 0 : ad.pose === "play";
    out.push({
      id: ad.action,
      target: s,
      seat: o.seat,
      duration: w.rng.range(ad.duration[0], ad.duration[1]),
      pose: smoke ? "smoke" : ad.note === "piano" ? (plays ? "play" : "look") : ad.pose,
      gain: ad.gains,
      key: o.seat ? undefined : spotKey(s),
      ref: o.game,
      note: ad.note ?? ad.id,
      gives: smoke ? "cigarette" : ad.gives,
      mod: (ad.mod ? ad.mod(p) : 1) * like * (ad.phases?.[phase] ?? 1),
    });
  }
  return out;
}

/** Turns tried, in order, when the side toward the other person is a wall or a doorway. */
const AROUND = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI];

/**
 * A walkable spot a step from someone, on the side toward another person (or the nearest side
 * free), facing them. With `crowd`, a side where someone else already stands is passed over too.
 */
export function beside(q: Person, from: { x: number; z: number }, pf: Pathfinder, gap = 0.9, crowd?: { people: readonly Person[]; self: number }): Spot | null {
  const d = Math.hypot(from.x - q.x, from.z - q.z);
  const ux = d > 1e-3 ? (from.x - q.x) / d : Math.sin(q.yaw);
  const uz = d > 1e-3 ? (from.z - q.z) / d : Math.cos(q.yaw);
  let first: Spot | null = null;
  for (const a of AROUND) {
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const s = pf.snap(q.level, q.x + (ux * c - uz * sn) * gap, q.z + (ux * sn + uz * c) * gap, 0.8);
    if (!s) continue;
    const room = pf.roomAt(s.level, s.x, s.z);
    if (room === -1) continue;
    const spot = { level: s.level, x: s.x, z: s.z, yaw: Math.atan2(q.x - s.x, q.z - s.z), room };
    if (!crowd) return spot;
    first ??= spot;
    const taken = crowd.people.some((o) => o.present && o.id !== crowd.self && o !== q && o.level === s.level && Math.hypot(o.x - s.x, o.z - s.z) < 0.6);
    if (!taken) return spot;
  }
  return first;
}

/** Round the host, facing in: a ring 2–5 m from the toast spot. */
export function toastSpot(w: MindWorld): Spot | null {
  const c = w.places.toastSpot;
  for (let i = 0; i < 8; i++) {
    const a = w.rng.range(-Math.PI, Math.PI);
    const r = w.rng.range(2, 5.5);
    const x = c.x + Math.sin(a) * r;
    const z = c.z + Math.cos(a) * r;
    const s = w.pf.snap(c.level, x, z, 0.6);
    if (s && !w.taken(spotKey({ ...s, yaw: 0, room: 0 }))) return { level: c.level, x: s.x, z: s.z, yaw: Math.atan2(c.x - s.x, c.z - s.z), room: w.pf.roomAt(c.level, s.x, s.z) };
  }
  return null;
}

export function score(p: Person, c: Candidate, w: MindWorld): number {
  const phase = w.phaseOf(p);
  const W = PHASE_WEIGHTS[phase.id][c.id === "ask" ? "toilet" : c.id] ?? 0;
  if (W <= 0) return 0;
  const needs = c.programme ? 1 : needTerm(p, c.gain);
  const d = distance(p, c.target);
  return W * needs * (c.mod ?? 1) * w.beat(p, c.id) * (1 / (1 + d / 30)) * w.rng.range(0.85, 1.15);
}

/**
 * Weighted draw over the best few kinds of action (scores squared, so the best usually wins).
 * Only each kind's best target competes, so a house with six bathrooms doesn't make the bathroom six times as tempting.
 */
export function choose(p: Person, w: MindWorld): Candidate | null {
  const best = new Map<ActionId, readonly [Candidate, number]>();
  for (const c of candidates(p, w)) {
    const s = score(p, c, w);
    if (s <= 0) continue;
    const prev = best.get(c.id);
    if (!prev || s > prev[1]) best.set(c.id, [c, s]);
  }
  const scored = [...best.values()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!scored.length) return null;
  return w.rng.weighted(scored.map(([c, s]) => [c, s * s] as const));
}

export function toAction(c: Candidate): ActionState {
  return { id: c.id, target: c.target, seat: c.seat, duration: c.duration, startedAt: null, pose: c.pose, gain: c.gain, ref: c.ref, note: c.note, gives: c.gives, key: c.key };
}
