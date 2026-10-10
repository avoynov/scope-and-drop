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
 */
import type { Rng } from '../mansion/core/rng';
import type { PhaseId } from './clock';
import type { Places, RoomCells } from './places';
import type { Pathfinder } from './path';
import type { ActionId, ActionState, Group, Held, NeedId, Needs, Person, Pose, Seat, Spot } from './types';

/** How fitting each action is in each phase (0 = never chosen). */
export const PHASE_WEIGHTS: Record<PhaseId, Partial<Record<ActionId, number>>> = {
  arrival: { mingle: 1, drink: 0.9, toilet: 1, sit: 0.3, art: 0.6, terrace: 0.5, wander: 0.35 },
  mingle: { mingle: 1.4, drink: 1, toilet: 1, sit: 0.5, art: 0.7, terrace: 0.6, dance: 0.1, games: 0.3, wander: 0.3 },
  champagne: { champagne: 4, mingle: 0.6, toilet: 0.4, sit: 0.15, art: 0.15, terrace: 0.15, wander: 0.05 },
  toast: { toast: 8, toilet: 0.15 },
  dinner: { dinner: 10, toilet: 0.3 },
  dancing: { dance: 2.4, mingle: 0.9, drink: 1, sit: 0.8, terrace: 0.6, toilet: 1, art: 0.2, wander: 0.15 },
  games: { games: 1.6, mingle: 0.8, drink: 1, sit: 0.7, terrace: 0.6, toilet: 1, dance: 0.3, art: 0.3, wander: 0.15 },
  farewell: { toast: 8, mingle: 0.4, drink: 0.2, toilet: 0.3, leave: 0 },
};

/** Share of the farewell phase spent on the last toast before people start to leave. */
export const LAST_TOAST = 0.35;

/** Need decay per in-game minute. */
export function decayRates(p: Person): Needs {
  const t = p.traits;
  const limp = p.quirks.includes('limp') ? 1 : 0;
  const smoker = p.quirks.includes('smoker') ? 1 : 0;
  const tipsy = Math.min(4, p.drinks);
  return {
    thirst: 0.01 * (0.6 + 0.8 * t.thirst),
    hunger: 0.004,
    bladder: 0.003 + 0.0015 * tipsy,
    social: 0.012 * (0.4 + 1.2 * t.social),
    dance: 0.006 * (0.3 + 1.4 * t.dance) + 0.002 * tipsy,
    rest: 0.003 + 0.004 * limp,
    air: 0.003 + 0.01 * smoker,
    curiosity: 0.006 * (0.4 + 1.2 * t.curiosity),
    companion: 0,
  };
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
  groups: Map<number, Group>;
  taken(key: string): boolean;
  seatTaken(seat: Seat): boolean;
  bathroomBusy(i: number): boolean;
  /** Phase the person believes is running, and how far into it. */
  phaseOf(p: Person): { id: PhaseId; progress: number };
}

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

/** A conversation slot: the biggest gap round the group's centre, at a radius that grows with its size. */
export function groupSlot(g: Group, people: Person[], pf: Pathfinder): Spot | null {
  // Members still walking over count where they are headed.
  const at = (m: number) => people[m]!.action?.target ?? people[m]!;
  const angles = g.members.map((m) => Math.atan2(at(m).x - g.x, at(m).z - g.z)).sort((a, b) => a - b);
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
  const r = 0.55 + 0.12 * (g.members.length + 1);
  for (const da of [0, 0.4, -0.4, 0.8, -0.8]) {
    const x = g.x + Math.sin(a + da) * r;
    const z = g.z + Math.cos(a + da) * r;
    if (pf.walkable(g.level, x, z)) return { level: g.level, x, z, yaw: Math.atan2(g.x - x, g.z - z), room: g.room };
  }
  return null;
}

/** Every action this person could start now, before scoring. */
export function candidates(p: Person, w: MindWorld): Candidate[] {
  const { rng, places, cells, people } = w;
  const out: Candidate[] = [];
  const phase = w.phaseOf(p);
  const W = PHASE_WEIGHTS[phase.id];
  const has = (a: ActionId) => (W[a] ?? 0) > 0 || (a === 'leave' && phase.id === 'farewell');

  if (has('mingle')) {
    for (const g of w.groups.values()) {
      if (g.members.length >= 6 || g.members.includes(p.id)) continue;
      const slot = groupSlot(g, people, w.pf);
      if (!slot) continue;
      let mod = 1;
      for (const m of g.members) {
        const o = people[m]!;
        mod += 0.35 * o.traits.talk;
        if (o.id === p.partner) mod += 1.2;
        if (p.friends.includes(o.id)) mod += 0.6;
      }
      if (g.members.length >= 5) mod *= 0.6;
      out.push({ id: 'mingle', target: slot, duration: rng.range(240, 720), pose: 'talk', gain: { social: 0.6 }, ref: g.id, mod });
    }
    for (let i = 0; i < 2; i++) {
      const room = rng.pick(places.mingleRooms.length ? places.mingleRooms : [places.toastRoom.index]);
      // Ground floor rooms draw most people; upstairs and the terrace less.
      const s = cells.random(rng.chance(0.15) && places.terrace.length ? -2 : room, rng, 0.9);
      if (s) out.push({ id: 'mingle', target: s, duration: rng.range(240, 600), pose: 'talk', gain: { social: 0.5 }, ref: -1, mod: (s.level === 0 ? 0.7 : 0.4) * (0.6 + p.traits.talk * 0.6) });
    }
  }
  if (has('drink') && p.held !== 'wine' && p.held !== 'beer' && p.held !== 'whisky') {
    for (const s of nearest(p, places.bars.filter((b) => !w.taken(spotKey(b))), 2, rng)) {
      const gives: Held = rng.weighted([['wine', 4], ['beer', 2], ['whisky', 1.5], ['water', 1]] as const);
      out.push({ id: 'drink', target: s, duration: rng.range(90, 200), pose: 'drink', gain: { thirst: 0.8, social: 0.1 }, gives, key: spotKey(s) });
    }
  }
  if (has('champagne') && p.held !== 'champagne') {
    out.push({ id: 'champagne', target: null, duration: 20, pose: 'stand', gain: {}, programme: true, gives: 'champagne' });
  }
  if (has('toilet')) {
    places.bathrooms.forEach((b, i) => {
      if ((p.avoid.get(`bath:${i}`) ?? -1) > w.t) return;
      out.push({ id: 'toilet', target: b.door, duration: rng.range(120, 240), pose: 'wait', gain: { bladder: 1 }, ref: i, note: 'door' });
    });
  }
  if (has('sit')) {
    const free = places.seats.filter((s) => !w.seatTaken(s));
    for (let i = 0; i < Math.min(4, free.length); i++) {
      const s = rng.pick(free);
      out.push({ id: 'sit', target: s.approach, seat: s, duration: rng.range(300, 900), pose: 'sit', gain: { rest: 0.7, social: 0.1 }, mod: p.quirks.includes('limp') ? 1.6 : 1 });
    }
  }
  if (has('art') && places.sights.length) {
    for (let i = 0; i < 3; i++) {
      const s = rng.pick(places.sights);
      if (w.taken(spotKey(s))) continue;
      out.push({ id: 'art', target: s, duration: rng.range(60, 180), pose: 'look', gain: { curiosity: 0.5 }, key: spotKey(s), mod: 0.5 + p.traits.curiosity });
    }
  }
  if (has('terrace') && places.terrace.length) {
    for (let i = 0; i < 2; i++) {
      const s = rng.pick(places.terrace);
      if (w.taken(spotKey(s))) continue;
      const smoker = p.quirks.includes('smoker');
      out.push({ id: 'terrace', target: s, duration: rng.range(180, 480), pose: smoker ? 'smoke' : 'stand', gain: { air: 0.8, curiosity: 0.1 }, key: spotKey(s), gives: smoker ? 'cigarette' : undefined, mod: smoker ? 1.8 : 1 });
    }
  }
  if (has('dance') && places.danceSpots.length) {
    const partner = p.partner !== null ? people[p.partner] : undefined;
    const partnerDancing = partner?.action?.id === 'dance';
    for (let i = 0; i < 3; i++) {
      let s = rng.pick(places.danceSpots);
      // Couples dance together: next to the partner's spot.
      if (partnerDancing && partner?.action?.target && i === 0) {
        const q = places.danceSpots.filter((d) => Math.hypot(d.x - partner.action!.target!.x, d.z - partner.action!.target!.z) < 1.4 && !w.taken(spotKey(d)));
        if (q.length) s = q[0]!;
      }
      if (w.taken(spotKey(s))) continue;
      const after = p.quirks.includes('dances-after-drink') && p.drinks > 0 ? 1.6 : 1;
      out.push({ id: 'dance', target: s, duration: rng.range(240, 600), pose: 'dance', gain: { dance: 0.8, social: 0.2 }, key: spotKey(s), mod: (0.4 + p.traits.dance) * (partnerDancing ? 1.6 : 1) * after });
    }
  }
  if (has('games')) {
    places.games.forEach((g, gi) => {
      const free = g.spots.filter((s, i) => !w.taken(spotKey(s)) && (g.kind !== 'piano' || i > 0 || p.role === 'pianist'));
      if (!free.length) return;
      const s = g.kind === 'piano' && p.role === 'pianist' && !w.taken(spotKey(g.spots[0]!)) ? g.spots[0]! : rng.pick(free);
      const plays = g.kind === 'billiards' || g.kind === 'cards' || (g.kind === 'piano' && s === g.spots[0]);
      const roleMatch = (g.kind === 'billiards' && p.role === 'billiards') || (g.kind === 'piano' && p.role === 'pianist') ? 2.5 : 1;
      out.push({
        id: 'games',
        target: s,
        duration: rng.range(300, 900),
        pose: plays ? 'play' : 'look',
        gain: { curiosity: 0.4, social: 0.3 },
        key: spotKey(s),
        ref: gi,
        note: g.kind,
        gives: g.kind === 'billiards' ? 'cue' : g.kind === 'cards' ? 'cards' : undefined,
        mod: (0.5 + 0.5 * p.traits.curiosity) * roleMatch,
      });
    });
  }
  if (has('wander')) {
    const s = cells.random(rng.pick(places.mingleRooms.length ? places.mingleRooms : [places.toastRoom.index]), rng);
    if (s) out.push({ id: 'wander', target: s, duration: rng.range(20, 60), pose: 'look', gain: { curiosity: 0.15 }, mod: 0.4 + p.traits.curiosity * 0.6 });
  }
  if (has('toast') && (phase.id === 'toast' || phase.progress < LAST_TOAST)) {
    const s = toastSpot(w);
    if (s) out.push({ id: 'toast', target: s, duration: 99999, pose: 'stand', gain: { social: 0.2 }, programme: true });
  }
  if (has('dinner')) {
    const seat = p.seat !== null ? places.diningSeats[p.seat] : undefined;
    if (seat) out.push({ id: 'dinner', target: seat.approach, seat, duration: 99999, pose: 'sit', gain: { hunger: 1, social: 0.4 }, programme: true });
    else {
      const free = places.buffet.filter((b) => !w.taken(spotKey(b)));
      const s = free.length ? rng.pick(free) : cells.random(places.toastRoom.index, rng);
      if (s) out.push({ id: 'dinner', target: s, duration: 99999, pose: 'stand', gain: { hunger: 1, social: 0.3 }, programme: true, key: spotKey(s) });
    }
  }
  if (phase.id === 'farewell' && phase.progress > LAST_TOAST) {
    // Leaving becomes ever more likely through the farewell.
    const ramp = (phase.progress - LAST_TOAST) / (1 - LAST_TOAST);
    out.push({ id: 'leave', target: places.entrance, duration: 0, pose: 'walk', gain: {}, programme: true, mod: 0.5 + 12 * ramp * ramp });
  }
  return out;
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
  const W = c.id === 'leave' ? 1 : (PHASE_WEIGHTS[phase.id][c.id] ?? 0);
  if (W <= 0) return 0;
  const needs = c.programme ? 1 : needTerm(p, c.gain);
  const d = distance(p, c.target);
  return W * needs * (c.mod ?? 1) * (1 / (1 + d / 30)) * w.rng.range(0.85, 1.15);
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
  return { id: c.id, target: c.target, seat: c.seat, duration: c.duration, startedAt: null, pose: c.pose, gain: c.gain, ref: c.ref, note: c.note, gives: c.gives };
}
