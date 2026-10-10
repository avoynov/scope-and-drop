/**
 * One evening at the mansion, stepped on a fixed in-game tick.
 *
 *   const party = new Party(generateMansion({ seed: 'gala-night' }), { seed: 'gala-night' });
 *   party.advance(60);            // one in-game minute
 *   party.people[3].action?.id;   // what someone is doing
 *
 * Pure data and deterministic: the same blueprint and seed give the same night.
 */
import type { MansionBlueprint } from '../mansion/core/types';
import { Rng } from '../mansion/core/rng';
import { makeProgramme, PARTY_LENGTH, phaseIndexAt, phaseProgress, TIME_SCALE, type Phase, type PhaseId } from './clock';
import { generateCast, type CastOptions } from './cast';
import { choose, decayRates, LAST_TOAST, PHASE_WEIGHTS, spotKey, toAction, type Candidate, type MindWorld } from './mind';
import { Pathfinder } from './path';
import { resolvePlaces, RoomCells, yawTo, type Places } from './places';
import { NEED_IDS, type ActionState, type Group, type Held, type PartyEvent, type Person, type Seat, type Spot, type Waypoint } from './types';

export interface PartyOptions extends CastOptions {
  /** Seed for the cast and every choice; defaults to the blueprint's seed. */
  seed?: string;
}

/** In-game seconds per sim step (a sixth of a real second). */
export const STEP = 0.5;
/** Metres per real second on a stair. */
const CLIMB_SPEED = 0.55;
/** How long a drink lasts in hand (in-game s). */
const DRINK_LIFE: Partial<Record<Held, number>> = { champagne: 1500, wine: 900, beer: 900, whisky: 700, water: 600, cigarette: 400 };
const ALCOHOL: ReadonlySet<Held> = new Set(['champagne', 'wine', 'beer', 'whisky']);
/** When, within the toast phase, glasses go up. */
const RAISE = [0.45, 0.62] as const;

export class Party implements MindWorld {
  readonly bp: MansionBlueprint;
  readonly pf: Pathfinder;
  readonly cells: RoomCells;
  readonly places: Places;
  readonly programme: Phase[];
  readonly people: Person[];
  readonly groups = new Map<number, Group>();
  readonly events: PartyEvent[] = [];
  readonly rng: Rng;
  t = 0;
  private phaseIdx = 0;
  private nextGroup = 1;
  private reserved = new Map<string, number>();
  private seats = new Map<string, number>();
  private bathOcc: number[];
  private announceUntil = -1;
  private stops = new Map<number, number>();
  private floorY: number[] = [];
  private levelY = new Map<number, number>();
  private terraceY: number;

  constructor(bp: MansionBlueprint, opts: PartyOptions = {}) {
    this.bp = bp;
    const root = new Rng(`party/${opts.seed ?? bp.seed}`);
    this.rng = root.fork('minds');
    this.pf = new Pathfinder(bp);
    this.cells = new RoomCells(this.pf);
    this.places = resolvePlaces(bp, this.pf, this.cells);
    this.programme = makeProgramme(root.fork('programme'));
    this.people = generateCast(root.fork('cast'), this.places, opts);
    this.bathOcc = this.places.bathrooms.map(() => -1);
    for (const r of bp.rooms) this.floorY[r.index] = r.floorY;
    for (const l of bp.levels) this.levelY.set(l.index, l.floorY);
    this.terraceY = bp.site.terrace.y;
    // Staff and the host are in place before the first guest arrives.
    for (const p of this.people) {
      if (!p.staff && p.role !== 'host') continue;
      const at = this.staffPost(p) ?? this.places.entrance;
      this.place(p, at);
      p.present = true;
    }
  }

  get host(): Person {
    return this.people.find((p) => p.role === 'host')!;
  }

  get phase(): Phase {
    return this.programme[this.phaseIdx]!;
  }

  get over(): boolean {
    return this.t >= PARTY_LENGTH;
  }

  phaseOf(p: Person): { id: PhaseId; progress: number } {
    const ph = this.programme[p.phaseSeen]!;
    return { id: ph.id, progress: phaseProgress(ph, this.t) };
  }

  taken(key: string): boolean {
    return this.reserved.has(key);
  }

  seatTaken(seat: Seat): boolean {
    return this.seats.has(seat.id);
  }

  bathroomBusy(i: number): boolean {
    return this.bathOcc[i]! >= 0;
  }

  /** Advance by `seconds` of in-game time in fixed steps. */
  advance(seconds: number): void {
    const end = this.t + seconds;
    while (this.t + STEP <= end + 1e-9 && !this.over) this.step();
  }

  step(): void {
    const dt = STEP;
    this.t += dt;
    const idx = phaseIndexAt(this.programme, this.t);
    if (idx !== this.phaseIdx) {
      this.phaseIdx = idx;
      this.log('phase', [], undefined, this.phase.label);
      this.announceUntil = this.t + 15;
      this.log('announce', [this.host.id], this.host.room, this.phase.label);
    }
    const ph = this.phase;
    if (ph.id === 'toast' && Math.abs(phaseProgress(ph, this.t) - RAISE[0]) < dt / (ph.end - ph.start)) this.log('toast', [this.host.id], this.host.room);

    for (const p of this.people) {
      if (p.gone) continue;
      if (!p.present) {
        if (this.t >= p.arriveAt) this.arrive(p);
        continue;
      }
      this.updateNeeds(p, dt);
      this.updatePhase(p);
      // Last guests out: everyone heads for the door before the clock runs out.
      if (!p.staff && p.role !== 'host' && ph.id === 'farewell' && phaseProgress(ph, this.t) > 0.75 && p.action?.id !== 'leave') {
        this.end(p, false);
        this.start(p, { id: 'leave', target: this.places.entrance, duration: 0, pose: 'walk', gain: {}, programme: true });
      }
      if (p.held && this.t >= p.heldUntil && p.held !== 'tray') p.held = null;
      if (!p.action) {
        if (this.t >= p.thinkAt) this.think(p);
      }
      if (p.action) this.act(p, dt);
      this.updatePose(p);
    }
    this.separate();
    this.updateGroups();
  }

  // ----------------------------------------------------------------- people

  private place(p: Person, s: Spot | Waypoint): void {
    p.level = s.level;
    p.x = s.x;
    p.z = s.z;
    if ('yaw' in s) p.yaw = s.yaw;
    p.room = this.pf.roomAt(s.level, s.x, s.z);
    p.y = this.floorAt(p.level, p.room);
  }

  private floorAt(level: number, room: number): number {
    if (room >= 0) return this.floorY[room] ?? this.levelY.get(level) ?? 0;
    if (room === -2) return this.terraceY;
    return this.levelY.get(level) ?? 0;
  }

  private arrive(p: Person): void {
    const e = this.places.entrance;
    const off = this.pf.snap(e.level, e.x + this.rng.range(-0.6, 0.6), e.z + this.rng.range(-0.6, 0.6), 1) ?? e;
    this.place(p, { ...e, x: off.x, z: off.z });
    p.present = true;
    p.phaseSeen = phaseIndexAt(this.programme, this.t - p.phaseLag);
    this.log('arrive', [p.id], p.room);
    // Greet the host if they are by the door, else step into the hall.
    const host = this.host;
    let target: Spot | null = null;
    if (host.present && host.level === e.level && Math.hypot(host.x - e.x, host.z - e.z) < 8) {
      const a = this.rng.range(-0.8, 0.8) + host.yaw;
      const w = this.pf.snap(host.level, host.x + Math.sin(a) * 1.0, host.z + Math.cos(a) * 1.0, 0.8);
      if (w) target = { level: w.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, host.x, host.z), room: this.pf.roomAt(w.level, w.x, w.z) };
    }
    target ??= this.places.entranceRoom ? this.cells.random(this.places.entranceRoom.index, this.rng) : null;
    if (target) this.start(p, { id: 'arrive', target, duration: this.rng.range(20, 40), pose: 'greet', gain: { social: 0.1 } });
  }

  private updateNeeds(p: Person, dt: number): void {
    const r = decayRates(p);
    const k = dt / 60;
    for (const id of NEED_IDS) p.needs[id] = Math.max(0, p.needs[id] - r[id] * k);
    if (p.partner !== null) {
      const q = this.people[p.partner]!;
      const near = q.present && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 8;
      p.needs.companion = Math.max(0, Math.min(1, p.needs.companion + (near ? 0.03 : -0.01) * k));
    } else p.needs.companion = 1;
    // Sipping a drink in hand keeps thirst at bay.
    if (p.held && ALCOHOL.has(p.held)) p.needs.thirst = Math.min(1, p.needs.thirst + 0.008 * k);
  }

  /** People act on the phase they believe is running, a little after it starts. */
  private updatePhase(p: Person): void {
    const lag = p.staff || p.role === 'host' ? 0 : p.phaseLag;
    const idx = phaseIndexAt(this.programme, this.t - lag);
    const a = p.action;
    if (idx !== p.phaseSeen) {
      p.phaseSeen = idx;
      if (!a) return;
      const id = this.programme[idx]!.id;
      const keep = p.staff ? true : p.role === 'host' ? false : (PHASE_WEIGHTS[id][a.id] ?? 0) >= 0.3 && a.id !== 'toast' && a.id !== 'dinner';
      if (!keep && a.id !== 'leave' && a.id !== 'arrive') this.end(p, false);
      return;
    }
    // The last toast ends partway through the farewell.
    if (a?.id === 'toast' && this.programme[p.phaseSeen]!.id === 'farewell' && this.phaseOf(p).progress >= LAST_TOAST) this.end(p, false);
  }

  private think(p: Person): void {
    // Safety net: never plan from somewhere nobody can stand.
    if (!this.pf.walkable(p.level, p.x, p.z)) {
      const w = this.pf.snap(p.level, p.x, p.z, 6);
      if (w) this.place(p, w);
    }
    if (p.staff) return this.staffThink(p);
    if (p.role === 'host') {
      const c = this.hostPlan(p);
      if (c) return void this.start(p, c);
    }
    const c = choose(p, this);
    if (!c) {
      p.thinkAt = this.t + 5;
      return;
    }
    this.start(p, c);
  }

  /** The host keeps the programme: greets at the door, leads toasts, heads the table, sees guests off. */
  private hostPlan(p: Person): Candidate | null {
    const ph = this.phase;
    const pr = phaseProgress(ph, this.t);
    const door = this.doorPost();
    if (ph.id === 'arrival' || (ph.id === 'farewell' && pr >= LAST_TOAST)) return door ? { id: 'staff', target: door, duration: 90, pose: 'greet', gain: { social: 0.2 }, note: 'door' } : null;
    if (ph.id === 'champagne' || ph.id === 'toast' || ph.id === 'farewell') return { id: 'toast', target: this.places.toastSpot, duration: 99999, pose: 'stand', gain: { social: 0.2 }, programme: true };
    if (ph.id === 'dinner') {
      const seat = p.seat !== null ? this.places.diningSeats[p.seat] : undefined;
      if (seat) return { id: 'dinner', target: seat.approach, seat, duration: 99999, pose: 'sit', gain: { hunger: 1 }, programme: true };
    }
    return null;
  }

  private doorPost(): Spot | null {
    const e = this.places.entrance;
    const w = this.pf.snap(e.level, e.x + Math.sin(e.yaw) * 1.6, e.z + Math.cos(e.yaw) * 1.6, 1.2);
    return w ? { level: w.level, x: w.x, z: w.z, yaw: e.yaw + Math.PI, room: this.pf.roomAt(w.level, w.x, w.z) } : null;
  }

  /** Where a member of staff starts the evening. */
  private staffPost(p: Person): Spot | null {
    const pl = this.places;
    if (p.role === 'host') return this.doorPost();
    if (p.role === 'bartender') return pl.bars[pl.bars.length - 1] ?? null;
    if (p.role === 'cook') return pl.kitchen[0] ?? null;
    if (p.role === 'waiter') return (pl.kitchen.length ? this.rng.pick(pl.kitchen) : pl.bars[0]) ?? null;
    return this.cells.random(pl.toastRoom.index, this.rng);
  }

  private staffThink(p: Person): void {
    const pl = this.places;
    const rng = this.rng;
    if (p.role === 'bartender') {
      const s = pl.bars[pl.bars.length - 1];
      if (s) return void this.start(p, { id: 'staff', target: s, duration: rng.range(300, 900), pose: 'serve', gain: {}, key: spotKey(s), note: 'bar' });
    }
    if (p.role === 'cook') {
      const room = pl.kitchen[0]?.room;
      const s = room !== undefined && room >= 0 ? this.cells.random(room, rng) : null;
      if (s) return void this.start(p, { id: 'staff', target: s, duration: rng.range(60, 200), pose: 'stand', gain: {}, note: 'cook' });
    }
    if (p.role === 'waiter') {
      const stops = this.stops.get(p.id) ?? 0;
      if (p.held !== 'tray' || stops >= 4) {
        const src = pl.bars.length && (!pl.kitchen.length || rng.chance(0.5)) ? rng.pick(pl.bars) : pl.kitchen.length ? rng.pick(pl.kitchen) : null;
        if (src) {
          this.stops.set(p.id, 0);
          return void this.start(p, { id: 'staff', target: src, duration: rng.range(25, 45), pose: 'serve', gain: {}, gives: 'tray', note: 'load' });
        }
      }
      const room = this.phase.id === 'dinner' && pl.dining ? pl.dining.index : rng.pick(pl.mingleRooms.length ? pl.mingleRooms : [pl.toastRoom.index]);
      const s = this.cells.random(room, rng, 0.5);
      if (s) {
        this.stops.set(p.id, stops + 1);
        return void this.start(p, { id: 'staff', target: s, duration: rng.range(35, 70), pose: 'serve', gain: {}, note: 'serve' });
      }
    }
    p.thinkAt = this.t + 10;
  }

  private start(p: Person, c: Candidate): void {
    const a = toAction(c);
    if (c.id === 'champagne') {
      // Take a glass from the nearest waiter with a tray, or from the bar.
      const w = this.nearestWaiter(p);
      const bar = this.places.bars[0];
      if (w) {
        a.ref = w.id;
        a.target = { level: w.level, x: w.x, z: w.z, yaw: 0, room: w.room };
      } else if (bar) a.target = bar;
      else return void (p.thinkAt = this.t + 10);
    }
    if (c.id === 'mingle' && c.ref === -1 && a.target) {
      // Start a conversation: its centre a step in front of the first person.
      const yaw = a.target.yaw;
      const cx = a.target.x + Math.sin(yaw) * 0.7;
      const cz = a.target.z + Math.cos(yaw) * 0.7;
      const g: Group = { id: this.nextGroup++, level: a.target.level, x: cx, z: cz, room: a.target.room, members: [], speaker: p.id, speakerUntil: 0 };
      this.groups.set(g.id, g);
      a.ref = g.id;
    }
    if (c.id === 'mingle' && a.ref !== undefined) this.groups.get(a.ref)?.members.push(p.id);
    if (c.key) this.reserved.set(c.key, p.id);
    if (c.seat) this.seats.set(c.seat.id, p.id);
    a.note = c.key ? `${a.note ?? ''}|${c.key}` : a.note;
    if (['dance', 'games', 'toilet', 'dinner', 'leave'].includes(c.id) && p.held && p.held !== 'tray') p.held = null;
    if (!a.target) {
      p.action = a;
      a.startedAt = this.t;
      return;
    }
    const route = this.pf.route({ level: p.level, x: p.x, z: p.z }, a.target);
    p.action = a;
    if (!route) {
      // Can't get there: forget it for a while and choose again.
      p.avoid.set(spotKey(a.target), this.t + 600);
      this.end(p, false);
      p.thinkAt = this.t + 3;
      return;
    }
    p.path = route;
    p.pathIndex = 1;
  }

  private nearestWaiter(p: Person): Person | null {
    let best: Person | null = null;
    let bd = Infinity;
    for (const q of this.people) {
      if (q.role !== 'waiter' || !q.present || q.held !== 'tray') continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z) + 10 * Math.abs(q.level - p.level);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  private act(p: Person, dt: number): void {
    const a = p.action!;
    if (a.note === 'queue') {
      // Waiting at a bathroom door.
      if (this.bathOcc[a.ref!]! < 0) {
        if (!this.enterBathroom(p, a)) a.startedAt = this.t;
      } else if (this.t >= a.until!) {
        p.avoid.set(`bath:${a.ref}`, this.t + this.rng.range(240, 600));
        this.end(p, false);
      }
      return;
    }
    if (a.startedAt === null) {
      if (a.id === 'champagne' && a.ref !== undefined) this.followWaiter(p, a);
      if (!p.action) return;
      this.walk(p, dt);
      return;
    }
    // At the target: refill needs over the action's duration.
    const k = Math.min(1, dt / Math.max(1, a.duration));
    for (const id in a.gain) {
      const n = id as keyof typeof a.gain;
      p.needs[n] = Math.min(1, p.needs[n] + (a.gain[n] ?? 0) * k);
    }
    if (this.t - a.startedAt >= a.duration) this.end(p, true);
  }

  private followWaiter(p: Person, a: ActionState): void {
    const w = this.people[a.ref!]!;
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    if (w.level === p.level && d < 1.4 && w.held === 'tray') {
      this.give(p, 'champagne');
      this.log('champagne', [p.id, w.id], p.room);
      this.end(p, true);
      return;
    }
    // Re-aim every few metres the waiter moves (never halfway up a stair).
    const tgt = a.target!;
    if (p.path[p.pathIndex]?.climb) return;
    if (Math.hypot(w.x - tgt.x, w.z - tgt.z) > 1.5 || p.pathIndex >= p.path.length) {
      const near = this.pf.snap(w.level, w.x - Math.sin(w.yaw) * 0.8, w.z - Math.cos(w.yaw) * 0.8, 1) ?? w;
      const route = this.pf.route({ level: p.level, x: p.x, z: p.z }, near);
      if (!route) return this.end(p, false);
      a.target = { level: near.level, x: near.x, z: near.z, yaw: 0, room: w.room };
      p.path = route;
      p.pathIndex = 1;
    }
  }

  private walk(p: Person, dt: number): void {
    let budget = (p.speed * dt) / TIME_SCALE;
    while (budget > 1e-6 && p.pathIndex < p.path.length) {
      const wp = p.path[p.pathIndex]!;
      if (wp.climb) {
        const y1 = this.floorAt(wp.level, this.pf.roomAt(wp.level, wp.x, wp.z));
        const dx = wp.x - p.x;
        const dz = wp.z - p.z;
        const dy = y1 - p.y;
        const len = Math.hypot(dx, dz, dy);
        const stepLen = (CLIMB_SPEED * dt) / TIME_SCALE;
        p.pose = 'climb';
        if (len <= stepLen) {
          p.x = wp.x;
          p.z = wp.z;
          p.y = y1;
          p.level = wp.level;
          p.room = this.pf.roomAt(wp.level, wp.x, wp.z);
          p.pathIndex++;
        } else {
          p.x += (dx / len) * stepLen;
          p.z += (dz / len) * stepLen;
          p.y += (dy / len) * stepLen;
          if (Math.hypot(dx, dz) > 0.05) p.yaw = Math.atan2(dx, dz);
        }
        return;
      }
      const dx = wp.x - p.x;
      const dz = wp.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.02) p.yaw = Math.atan2(dx, dz);
      if (d <= budget) {
        p.x = wp.x;
        p.z = wp.z;
        budget -= d;
        p.pathIndex++;
      } else {
        const nx = p.x + (dx / d) * budget;
        const nz = p.z + (dz / d) * budget;
        if (!this.pf.walkable(p.level, nx, nz)) {
          // Nudged off the line (by someone in the way): find a fresh route from here.
          this.reroute(p);
          return;
        }
        p.x = nx;
        p.z = nz;
        budget = 0;
      }
    }
    const room = this.pf.roomAt(p.level, p.x, p.z);
    if (room !== -1) {
      p.room = room;
      p.y = this.floorAt(p.level, room);
    }
    if (p.pathIndex >= p.path.length) this.arrived(p);
  }

  private reroute(p: Person): void {
    const goal = p.path[p.path.length - 1];
    const here = this.pf.walkable(p.level, p.x, p.z) ? { level: p.level, x: p.x, z: p.z } : (this.pf.snap(p.level, p.x, p.z, 1) ?? this.pf.snap(p.level, p.x, p.z, 6));
    const route = goal && here ? this.pf.route(here, goal) : null;
    if (!route) return this.end(p, false);
    if (here) {
      p.x = here.x;
      p.z = here.z;
    }
    p.path = route;
    p.pathIndex = 1;
  }

  private arrived(p: Person): void {
    const a = p.action!;
    if (a.id === 'toilet' && a.note?.startsWith('door')) {
      const i = a.ref!;
      if (this.bathOcc[i]! >= 0) {
        this.log('bathroom-busy', [p.id, this.bathOcc[i]!], p.room);
        // Busy: queue at the door when it's urgent, else remember it and come back later.
        if (p.needs.bladder < 0.35) {
          a.note = 'queue';
          a.until = this.t + this.rng.range(120, 240);
          p.yaw = a.target?.yaw ?? p.yaw;
          return;
        }
        p.avoid.set(`bath:${i}`, this.t + this.rng.range(240, 600));
        this.end(p, false);
        p.thinkAt = this.t + 2;
        return;
      }
      if (this.enterBathroom(p, a)) return;
    }
    if (a.id === 'leave') {
      this.release(p);
      p.action = null;
      p.present = false;
      p.gone = true;
      this.log('leave', [p.id], p.room);
      return;
    }
    if (a.id === 'champagne' && a.ref === undefined) {
      // Took a glass at the bar.
      this.give(p, 'champagne');
      this.end(p, true);
      return;
    }
    if (a.id === 'champagne') return;
    if (a.seat) {
      p.x = a.seat.x;
      p.z = a.seat.z;
      p.y = a.seat.y;
      p.yaw = a.seat.yaw;
      if (a.id === 'dinner') this.log('seated', [p.id], p.room);
    } else if (a.id === 'mingle' && a.ref !== undefined) {
      const g = this.groups.get(a.ref);
      if (g) p.yaw = yawTo(p.x, p.z, g.x, g.z);
    } else if (a.target) p.yaw = a.target.yaw;
    a.startedAt = this.t;
  }

  /** Lock the bathroom and walk in; false when there is no way in (the person uses the door spot). */
  private enterBathroom(p: Person, a: ActionState): boolean {
    const i = a.ref!;
    this.bathOcc[i] = p.id;
    a.note = 'inside';
    const route = this.pf.route({ level: p.level, x: p.x, z: p.z }, this.places.bathrooms[i]!.inside);
    if (!route) return false;
    p.path = route;
    p.pathIndex = 1;
    return true;
  }

  private give(p: Person, h: Held): void {
    p.held = h;
    p.heldUntil = this.t + (DRINK_LIFE[h] ?? 99999);
    if (ALCOHOL.has(h)) p.drinks++;
  }

  /** Finish or abandon the current action and free what it held. */
  private end(p: Person, done: boolean): void {
    const a = p.action;
    if (!a) return;
    if (done && a.gives !== undefined && a.id !== 'champagne') {
      if (a.gives) this.give(p, a.gives);
      else p.held = null;
    }
    if (done && a.note === 'load') p.held = 'tray';
    this.release(p);
    if (a.seat && a.startedAt !== null) this.place(p, a.seat.approach);
    // Never stop on a stair: finish the flight first.
    const wp = p.path[p.pathIndex];
    if (wp?.climb) this.place(p, wp);
    p.action = null;
    p.path = [];
    p.pathIndex = 0;
    p.pose = 'stand';
    p.thinkAt = this.t + (p.staff ? 2 : this.rng.range(2, 12));
  }

  private release(p: Person): void {
    const a = p.action;
    if (!a) return;
    const key = a.note?.split('|')[1];
    if (key && this.reserved.get(key) === p.id) this.reserved.delete(key);
    if (a.seat && this.seats.get(a.seat.id) === p.id) this.seats.delete(a.seat.id);
    if (a.id === 'toilet' && a.ref !== undefined && this.bathOcc[a.ref] === p.id) this.bathOcc[a.ref] = -1;
    if (a.id === 'mingle' && a.ref !== undefined) {
      const g = this.groups.get(a.ref);
      if (g) {
        g.members = g.members.filter((m) => m !== p.id);
        if (!g.members.length) this.groups.delete(g.id);
      }
    }
  }

  private updatePose(p: Person): void {
    const a = p.action;
    if (a?.note === 'queue') {
      p.pose = 'wait';
      return;
    }
    if (!a || a.startedAt === null) {
      p.pose = !a ? 'stand' : p.path[p.pathIndex]?.climb === true ? 'climb' : 'walk';
      return;
    }
    let pose = a.pose;
    if (a.id === 'toilet') pose = 'wait';
    const ph = this.phase;
    if (a.id === 'toast') {
      const pr = phaseProgress(ph, this.t);
      const raising = (ph.id === 'toast' && pr >= RAISE[0] && pr <= RAISE[1]) || (ph.id === 'farewell' && pr >= LAST_TOAST * 0.55 && pr <= LAST_TOAST * 0.85);
      pose = raising ? 'toast' : 'stand';
    }
    if (p.role === 'host' && this.t < this.announceUntil) pose = 'announce';
    p.pose = pose;
  }

  /** People don't stand inside each other: push apart anyone closer than 0.42 m. */
  private separate(): void {
    const ps = this.people;
    const R = 0.42;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]!;
      if (!a.present || a.pose === 'sit' || a.pose === 'climb') continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]!;
        if (!b.present || b.level !== a.level || b.pose === 'sit' || b.pose === 'climb') continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= R) continue;
        const ux = d > 1e-4 ? dx / d : 1;
        const uz = d > 1e-4 ? dz / d : 0;
        const push = (R - d) / 2;
        if (this.pf.walkable(a.level, a.x - ux * push, a.z - uz * push)) {
          a.x -= ux * push;
          a.z -= uz * push;
        }
        if (this.pf.walkable(b.level, b.x + ux * push, b.z + uz * push)) {
          b.x += ux * push;
          b.z += uz * push;
        }
      }
    }
  }

  private updateGroups(): void {
    for (const g of this.groups.values()) {
      if (this.t < g.speakerUntil) continue;
      const here = g.members.filter((m) => this.people[m]!.action?.startedAt != null);
      if (!here.length) continue;
      g.speaker = this.rng.weighted(here.map((m) => [m, 0.05 + this.people[m]!.traits.talk ** 2] as const));
      g.speakerUntil = this.t + this.rng.range(3, 9);
    }
  }

  private log(kind: PartyEvent['kind'], actors: number[], room?: number, note?: string): void {
    this.events.push({ t: this.t, kind, actors, room, note });
  }

  /** A short digest of everyone's state, for determinism checks. */
  digest(): string {
    let h = 0;
    for (const p of this.people) {
      const s = `${p.id}:${p.present ? 1 : 0}${p.gone ? 1 : 0}:${Math.round(p.x * 100)},${Math.round(p.z * 100)},${p.level}:${p.action?.id ?? '-'}`;
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    }
    return `${this.t}:${(h >>> 0).toString(16)}`;
  }

  /** Perch visibility of a person (0..1), from the house's visibility grid. */
  visibility(p: Person): number {
    return p.present ? this.pf.visAt(p.level, p.x, p.z) : 0;
  }
}
