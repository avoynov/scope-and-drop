/**
 * One evening at the mansion, stepped on a fixed in-game tick.
 *
 *   const party = new Party(generateMansion({ seed: 'gala-night' }), { seed: 'gala-night' });
 *   party.advance(60);            // one in-game minute
 *   party.people[3].action?.id;   // what someone is doing
 *
 * Pure data and deterministic: the same blueprint and seed give the same night.
 */
import type { MansionBlueprint, RoomType } from '../mansion/core/types';
import { Rng } from '../mansion/core/rng';
import { Body, type BodyHost } from './body';
import { makeProgramme, PARTY_LENGTH, phaseIndexAt, phaseProgress, TIME_SCALE, type Phase, type PhaseId } from './clock';
import { generateCast, type CastOptions } from './cast';
import { choose, decayRates, LAST_TOAST, PHASE_WEIGHTS, spotKey, toAction, type Candidate, type MindWorld } from './mind';
import { Pathfinder } from './path';
import { resolvePlaces, RoomCells, yawTo, type Places } from './places';
import { DRINKS, NEED_IDS, type ActionId, type ActionState, type DrinkId, type Group, type Held, type PartyEvent, type Person, type Seat, type Spot, type Waypoint } from './types';
import { DRINK_IDS, World } from './world';

export interface PartyOptions extends CastOptions {
  /** Seed for the cast and every choice; defaults to the blueprint's seed. */
  seed?: string;
}

/** In-game seconds per sim step (a sixth of a real second). */
export const STEP = 0.5;
/** Metres per real second on a stair. */
const CLIMB_SPEED = 0.55;
/** How long something other than a glass stays in hand (in-game s); a glass lasts as long as its drink (body.ts). */
const HOLD_LIFE: Partial<Record<Held, number>> = { cigarette: 400 };
/** When, within the toast phase, glasses go up. */
const RAISE = [0.45, 0.62] as const;
/** Actions that need both hands: a glass is set down first. */
const HANDS_FREE: ReadonlySet<ActionId> = new Set(['dance', 'games', 'toilet', 'dinner', 'leave']);
/** What people can be doing when a waiter offers a glass. */
const OFFER_TO: ReadonlySet<ActionId> = new Set(['arrive', 'mingle', 'sit', 'dinner', 'art', 'wander', 'terrace', 'toast']);
/** How far ahead (m) a walker looks for a door to open. */
const DOOR_LOOK = [0, 0.2, 0.4, 0.6] as const;
/** A door this open lets people through. */
const DOOR_PASS = 0.9;
/** Giving way: how far ahead (m) and how wide a lane walkers watch, and the most they shift aside in a step (m). */
const SIDESTEP_AHEAD = 1.5;
const SIDESTEP_LANE = 0.5;
const SIDESTEP_MAX = 0.15;
/** Rooms staff never step into on their rounds. */
const PRIVATE: ReadonlySet<RoomType> = new Set(['bathroom', 'bedroom', 'dressing-room', 'study']);

/** Which drinks the waiters carry: champagne before the toast, wine at dinner, a mix after. */
const bandOf = (id: PhaseId): Body['band'] => (id === 'dinner' ? 'dinner' : id === 'dancing' || id === 'games' || id === 'farewell' ? 'after' : 'before');

export class Party implements MindWorld, BodyHost {
  readonly bp: MansionBlueprint;
  readonly pf: Pathfinder;
  readonly cells: RoomCells;
  /** Doors, curtains, lights and every thing people carry, lock or lose. */
  readonly world: World;
  /** Bathrooms, drinks, tipsiness and bumps. */
  readonly body: Body;
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
  private announceUntil = -1;
  /** Draws for things (coats, bags), kept apart so they don't shift the minds' choices. */
  private readonly things: Rng;
  /** The door each person is standing in (-1 none), to close it behind them. */
  private readonly doorIn: Int32Array;
  /** When a waiter last set off toward each person, so two don't converge on the same one. */
  private readonly offeredAt: Float64Array;
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
    this.world = new World(bp, this.pf, root.fork('world'));
    this.pf.setGate(this.world);
    this.places = resolvePlaces(bp, this.pf, this.cells, this.world);
    this.programme = makeProgramme(root.fork('programme'));
    this.people = generateCast(root.fork('cast'), this.places, opts);
    this.body = new Body(this, root.fork('body'));
    this.things = root.fork('things');
    this.doorIn = new Int32Array(this.people.length).fill(-1);
    this.offeredAt = new Float64Array(this.people.length).fill(-1e9);
    this.shelveThings();
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

  worthTrying(p: Person, i: number): boolean {
    return this.body.worthTrying(p, i);
  }

  glassFill(p: Person): number {
    const items = this.world.items;
    return p.item >= 0 && items.kindOf(p.item) === 'glass' ? items.fill[p.item]! : 0;
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
      this.body.band = bandOf(this.phase.id);
      // Champagne is called: every waiter fetches a full tray of flutes.
      if (this.phase.id === 'champagne') {
        for (const w of this.people) {
          if (w.role !== 'waiter' || !w.present) continue;
          this.end(w, false);
          this.stops.set(w.id, 99);
          w.thinkAt = this.t;
        }
      }
      this.log('phase', [], undefined, this.phase.label);
      this.announceUntil = this.t + 15;
      this.log('announce', [this.host.id], this.host.room, this.phase.label);
    }
    const ph = this.phase;
    // Glasses go up once, on the step that crosses the raise.
    if (ph.id === 'toast' && phaseProgress(ph, this.t - dt) < RAISE[0] && phaseProgress(ph, this.t) >= RAISE[0]) this.log('toast', [this.host.id], this.host.room);

    this.body.beginStep();
    for (const p of this.people) {
      if (p.gone) continue;
      if (!p.present) {
        if (this.t >= p.arriveAt) this.arrive(p);
        continue;
      }
      this.updateNeeds(p, dt);
      this.updatePhase(p);
      // Last guests out: everyone heads for the door before the clock runs out.
      if (!p.staff && p.role !== 'host' && ph.id === 'farewell' && phaseProgress(ph, this.t) > 0.55 && p.action?.id !== 'leave') {
        this.end(p, false);
        this.start(p, { id: 'leave', target: this.places.entrance, duration: 0, pose: 'walk', gain: {}, programme: true });
      }
      // A cigarette burns down; a glass is set down when its drink runs out (body.ts).
      if (p.held && p.item < 0 && this.t >= p.heldUntil) p.held = null;
      if (!p.action) {
        if (this.t >= p.thinkAt) this.think(p);
      }
      if (p.action) this.act(p, dt);
      this.updatePose(p);
    }
    this.separate(dt);
    this.body.endStep(dt);
    this.world.step(dt);
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
    this.arriveWithThings(p);
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
    if (p.item >= 0 && p.held && DRINKS.has(p.held)) p.needs.thirst = Math.min(1, p.needs.thirst + 0.008 * k);
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
      // Someone in a bathroom or waiting at its door sees it through; most else gives way to the programme.
      const committed = a.id === 'toilet' && a.note !== 'door';
      const keep = p.staff ? true : p.role === 'host' ? false : committed || ((PHASE_WEIGHTS[id][a.id] ?? 0) >= 0.3 && a.id !== 'toast' && a.id !== 'dinner');
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
      if (this.body.trayCount(p) === 0 || stops >= 4) {
        // Reload at the bar or the kitchen; the nearest when a toast is waiting on it.
        const near = this.phase.id === 'champagne' || this.phase.id === 'toast';
        const away = (s: Spot) => Math.hypot(s.x - p.x, s.z - p.z) + 15 * Math.abs(s.level - p.level);
        const src = near
          ? ([...pl.bars, ...pl.kitchen].sort((a, b) => away(a) - away(b))[0] ?? null)
          : pl.bars.length && (!pl.kitchen.length || rng.chance(0.5))
            ? rng.pick(pl.bars)
            : pl.kitchen.length
              ? rng.pick(pl.kitchen)
              : null;
        if (src) {
          this.stops.set(p.id, 0);
          return void this.start(p, { id: 'staff', target: src, duration: rng.range(25, 45), pose: 'serve', gain: {}, note: 'load' });
        }
      }
      // Champagne and the toast: hop from one empty-handed guest to the next. Dinner: the dining room.
      const ph = this.phase.id;
      const toast = ph === 'champagne' || ph === 'toast';
      const s =
        (toast && this.emptyHanded(p)) ||
        this.cells.random(ph === 'dinner' && pl.dining ? pl.dining.index : ph === 'champagne' || ph === 'toast' ? pl.toastRoom.index : rng.pick(pl.mingleRooms.length ? pl.mingleRooms : [pl.toastRoom.index]), rng, 0.5);
      if (s) {
        this.stops.set(p.id, stops + 1);
        return void this.start(p, { id: 'staff', target: s, duration: toast ? rng.range(12, 25) : rng.range(35, 70), pose: 'serve', gain: {}, note: 'serve' });
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
    if (HANDS_FREE.has(c.id) && p.held && p.held !== 'tray') {
      if (p.item >= 0) this.body.setDown(p);
      else p.held = null;
    }
    if (!a.target) {
      p.action = a;
      a.startedAt = this.t;
      return;
    }
    const route = this.pf.route({ level: p.level, x: p.x, z: p.z }, a.target, p);
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

  /** A spot beside one of the nearest guests with nothing in hand, for a waiter's next stop. */
  private emptyHanded(w: Person): Spot | null {
    const away = (q: Person) => Math.hypot(q.x - w.x, q.z - w.z) + 15 * Math.abs(q.level - w.level);
    const want = this.people
      .filter((q) => q.present && !q.staff && !q.held && (!q.action || OFFER_TO.has(q.action.id)) && this.offeredAt[q.id]! < this.t - 30)
      .sort((a, b) => away(a) - away(b));
    if (!want.length) return null;
    const q = this.rng.pick(want.slice(0, 3));
    this.offeredAt[q.id] = this.t;
    const a = this.rng.range(-Math.PI, Math.PI);
    const s = this.pf.snap(q.level, q.x + Math.sin(a) * 0.8, q.z + Math.cos(a) * 0.8, 0.8);
    const room = s ? this.pf.roomAt(s.level, s.x, s.z) : -1;
    // Never into a bathroom or a bedroom, even when the guest stands by its door.
    if (!s || room === -1 || (room >= 0 && PRIVATE.has(this.bp.rooms[room]!.type))) return null;
    return { level: s.level, x: s.x, z: s.z, yaw: yawTo(s.x, s.z, q.x, q.z), room };
  }

  private nearestWaiter(p: Person): Person | null {
    let best: Person | null = null;
    let bd = Infinity;
    for (const q of this.people) {
      if (q.role !== 'waiter' || !q.present || this.body.trayCount(q) === 0) continue;
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
    if (a.id === 'toilet' && a.note === 'queue') {
      // Waiting by a bathroom door: body.ts moves the line along, knocks and gives up.
      this.body.queueStep(p);
      if (p.action === a && a.startedAt === null) this.walk(p, dt);
      return;
    }
    if (a.id === 'drink' && a.note === 'bar-wait') {
      // Waiting a turn at the bar; the bartender pours and starts the drink (body.ts).
      if (this.t >= a.until!) this.end(p, false);
      return;
    }
    if (a.startedAt === null) {
      if (a.id === 'champagne' && a.ref !== undefined) this.followWaiter(p, a);
      if (!p.action) return;
      this.walk(p, dt);
      return;
    }
    // A waiter at a stop keeps offering to whoever comes near, and moves on when the tray is empty.
    if (a.id === 'staff' && a.note === 'serve') {
      if ((this.t - a.startedAt) % 4 < dt) this.offer(p);
      if (!this.body.trayCount(p)) return this.end(p, true);
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
    if (!this.body.trayCount(w)) {
      // Their tray ran dry: look for another, or the bar.
      this.end(p, false);
      p.thinkAt = this.t + 1;
      return;
    }
    if (w.level === p.level && d < 1.4) {
      const drink = this.body.takeFrom(p, w);
      this.log('champagne', [p.id, w.id], p.room, drink ?? undefined);
      this.end(p, true);
      return;
    }
    // Re-aim every few metres the waiter moves (never halfway up a stair).
    const tgt = a.target!;
    if (p.path[p.pathIndex]?.climb) return;
    if (Math.hypot(w.x - tgt.x, w.z - tgt.z) > 1.5 || p.pathIndex >= p.path.length) {
      const near = this.pf.snap(w.level, w.x - Math.sin(w.yaw) * 0.8, w.z - Math.cos(w.yaw) * 0.8, 1) ?? w;
      const route = this.pf.route({ level: p.level, x: p.x, z: p.z }, near, p);
      if (!route) return this.end(p, false);
      a.target = { level: near.level, x: near.x, z: near.z, yaw: 0, room: w.room };
      p.path = route;
      p.pathIndex = 1;
    }
  }

  private walk(p: Person, dt: number): void {
    // Over 0.6 tipsiness people walk a little slower (and sway, in the renderer).
    let budget = ((p.speed * dt) / TIME_SCALE) * (p.tipsy > 0.6 ? 0.9 : 1);
    if (this.doorAhead(p)) return;
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
        let nx = p.x + (dx / d) * budget;
        let nz = p.z + (dz / d) * budget;
        if (!this.pf.walkable(p.level, nx, nz)) {
          // Nudged off the line (by someone in the way): find a fresh route from here.
          this.reroute(p);
          return;
        }
        // Step round whoever is just ahead, if there's floor to the side; the last stretch to the target goes straight in.
        const last = p.pathIndex === p.path.length - 1 && d < SIDESTEP_AHEAD;
        const side = last ? null : this.sidestep(p, dx / d, dz / d);
        if (side && this.pf.walkable(p.level, nx + side.x, nz + side.z) && this.world.doorAtPoint(p.level, nx + side.x, nz + side.z) === this.world.doorAtPoint(p.level, nx, nz)) {
          nx += side.x;
          nz += side.z;
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
    this.passDoor(p);
    if (p.pathIndex >= p.path.length) this.arrived(p);
  }

  /**
   * Walkers give way: the nearest person in a lane ahead (within 1.5 m, half a metre either side)
   * sends them sideways, more the closer they are. Returns the sideways shift for this step.
   */
  private sidestep(p: Person, ux: number, uz: number): { x: number; z: number } | null {
    let best: Person | null = null;
    let bestAhead = SIDESTEP_AHEAD;
    let lat = 0;
    for (const q of this.people) {
      if (q === p || !q.present || q.level !== p.level || q.pose === 'sit') continue;
      const rx = q.x - p.x;
      const rz = q.z - p.z;
      const ahead = rx * ux + rz * uz;
      if (ahead <= 0 || ahead >= bestAhead) continue;
      const l = rz * ux - rx * uz;
      if (Math.abs(l) > SIDESTEP_LANE) continue;
      best = q;
      bestAhead = ahead;
      lat = l;
    }
    if (!best) return null;
    // Away from the side they're on; dead ahead, pass on the right.
    const away = Math.abs(lat) < 0.05 ? -1 : -Math.sign(lat);
    const k = (1 - bestAhead / SIDESTEP_AHEAD) * SIDESTEP_MAX * away;
    // `lat` is measured along (-uz, ux); shift along the same axis, away from them.
    return { x: -uz * k, z: ux * k };
  }

  /**
   * A door on the way: open it and wait while it swings, or find another way when it's locked.
   * True when the person doesn't move this step. A door they're already standing in is never in the way.
   */
  private doorAhead(p: Person): boolean {
    const wp = p.path[p.pathIndex];
    if (!wp || wp.climb) return false;
    const w = this.world;
    const dx = wp.x - p.x;
    const dz = wp.z - p.z;
    const d = Math.hypot(dx, dz);
    const here = w.doorAtPoint(p.level, p.x, p.z);
    for (const ahead of DOOR_LOOK) {
      const k = Math.min(ahead, d);
      const id = d > 1e-6 ? w.doorAtPoint(p.level, p.x + (dx / d) * k, p.z + (dz / d) * k) : here;
      if (id >= 0 && id !== here) {
        const door = w.doors[id]!;
        if (!w.canPass(door, p)) {
          this.reroute(p);
          return true;
        }
        if (door.open < DOOR_PASS) {
          w.swing(door, 1);
          return true;
        }
      }
      if (k >= d) break;
    }
    return false;
  }

  /** Stepping out of a doorway: bedrooms, the study and guest bedrooms swing shut behind. */
  private passDoor(p: Person): void {
    const id = this.world.doorAtPoint(p.level, p.x, p.z);
    const prev = this.doorIn[p.id]!;
    if (id === prev) return;
    this.doorIn[p.id] = id;
    if (prev < 0) return;
    const d = this.world.doors[prev]!;
    if (d.closes && !this.doorIn.includes(prev)) this.world.swing(d, 0);
  }

  private reroute(p: Person): void {
    const goal = p.path[p.path.length - 1];
    const here = this.pf.walkable(p.level, p.x, p.z) ? { level: p.level, x: p.x, z: p.z } : (this.pf.snap(p.level, p.x, p.z, 1) ?? this.pf.snap(p.level, p.x, p.z, 6));
    const route = goal && here ? this.pf.route(here, goal, p) : null;
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
    if (a.id === 'toilet') {
      // At the door, inside, or at a place in the line (body.ts).
      if (a.target) p.yaw = a.target.yaw;
      if (a.note === 'door') return this.body.atDoor(p);
      if (a.note === 'inside') return this.body.inside(p);
      if (a.note === 'queue') return void (a.startedAt = this.t);
    }
    if (a.id === 'drink' && a.note === 'bar-go') {
      if (a.target) p.yaw = a.target.yaw;
      a.note = 'bar-wait';
      a.until = this.t + 180;
      this.body.atBar(p, a.ref!);
      return;
    }
    if (a.id === 'leave') {
      this.release(p);
      this.leaveWithThings(p);
      p.action = null;
      p.present = false;
      p.gone = true;
      this.log('leave', [p.id], p.room);
      return;
    }
    if (a.id === 'champagne' && a.ref === undefined) {
      // Took a glass at the bar.
      this.body.pour(p, 'champagne');
      this.log('champagne', [p.id], p.room, 'bar');
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
    // A stop on a waiter's round: empties onto the tray (glasses are offered while they stand there).
    if (a.id === 'staff' && a.note === 'serve') this.body.clearGlasses(p, 3);
    a.startedAt = this.t;
  }

  /** Walk to a spot as part of the current action (it starts when they get there); false when there is no way. */
  goTo(p: Person, s: Spot): boolean {
    const a = p.action;
    if (!a) return false;
    a.target = s;
    a.startedAt = null;
    const route = this.pf.route({ level: p.level, x: p.x, z: p.z }, s, p);
    if (!route) return false;
    p.path = route;
    p.pathIndex = 1;
    return true;
  }

  /** A waiter offers glasses round: guests close by with empty hands take one, more often when thirsty. */
  private offer(w: Person): void {
    const drink = this.body.trayDrink(w);
    if (!drink) return;
    // Nobody turns down a glass for the toast, and the waiters reach further through the crowd for it.
    const toast = drink === 'champagne' && (this.phase.id === 'champagne' || this.phase.id === 'toast');
    for (const q of this.people) {
      if (!q.present || q.staff || q.held || q.level !== w.level || Math.hypot(q.x - w.x, q.z - w.z) > (toast ? 3 : 2.5)) continue;
      if (q.action && !OFFER_TO.has(q.action.id)) continue;
      if (!this.body.wants(q, drink) || !this.rng.chance(toast ? 0.95 : 0.3 + 0.6 * (1 - q.needs.thirst))) continue;
      this.body.takeFrom(q, w);
      if (!this.body.trayCount(w)) break;
    }
  }

  /** What the waiters load: champagne before the toast, red or white at dinner, a mix after. */
  private trayDrink(): DrinkId {
    const band = this.body.band;
    if (band === 'before') return 'champagne';
    if (band === 'dinner') return this.rng.chance(0.5) ? 'red' : 'white';
    return this.rng.weighted([['champagne', 1], ['red', 1.2], ['white', 1], ['beer', 0.6], ['water', 0.8]] as const);
  }

  private give(p: Person, h: Held): void {
    if (DRINKS.has(h)) return this.body.pour(p, h as DrinkId);
    if (p.item >= 0) this.body.setDown(p);
    p.held = h;
    p.heldUntil = this.t + (HOLD_LIFE[h] ?? 99999);
  }

  /** The things in the house before anyone arrives: the first-aid kit and the good whisky. */
  private shelveThings(): void {
    const items = this.world.items;
    const pl = this.places;
    const kit = pl.kitchen[0] ?? pl.bathrooms[0]?.inside;
    if (kit) items.add('kit', 'shelved', -1, -1, kit, 0);
    const spirits = pl.chains.spirits.spots[0];
    if (spirits) {
      const id = items.add('bottle', 'shelved', this.host.id, -1, spirits, 0);
      items.drink[id] = DRINK_IDS.indexOf('whisky');
    }
  }

  /** At the door: the coat is hung (or laid on a guest bed), some keep a bag, spectacles are worn. */
  private arriveWithThings(p: Person): void {
    const items = this.world.items;
    const spots = this.places.chains.coats.spots;
    const hook = spots.length ? spots[p.id % spots.length]! : this.places.entrance;
    p.coat = items.add('coat', 'hung', p.id, -1, hook, this.t);
    if (this.things.chance(p.look.sex === 'f' ? 0.6 : 0.08)) items.add('bag', 'carried', p.id, p.id, p, this.t);
    if (p.quirks.includes('glasses')) items.add('spectacles', 'worn', p.id, p.id, p, this.t);
  }

  /** Out of the door: the coat goes back on, and whatever they carry goes with them. */
  private leaveWithThings(p: Person): void {
    const items = this.world.items;
    if (p.item >= 0) this.body.setDown(p);
    if (p.coat >= 0) {
      items.holder[p.coat] = p.id;
      items.set(p.coat, 'worn', this.t);
    }
  }

  /** Finish or abandon the current action and free what it held. */
  end(p: Person, done: boolean): void {
    const a = p.action;
    if (!a) return;
    if (done && a.gives !== undefined && a.id !== 'champagne') {
      if (a.gives) this.give(p, a.gives);
      else if (p.item < 0) p.held = null;
    }
    if (done && a.id === 'staff' && a.note === 'load') {
      const drink = this.trayDrink();
      this.body.loadTray(p, drink, drink === 'champagne' && (this.phase.id === 'champagne' || this.phase.id === 'toast'));
      this.body.clearGlasses(p, 3);
    }
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
    if (a.key && this.reserved.get(a.key) === p.id) this.reserved.delete(a.key);
    if (a.seat && this.seats.get(a.seat.id) === p.id) this.seats.delete(a.seat.id);
    if (a.id === 'toilet') this.body.release(p);
    if (a.id === 'drink') this.body.leaveBar(p);
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
    if (a?.id === 'toilet' && a.note === 'queue' && a.startedAt !== null) {
      p.pose = this.body.knocking(p) ? 'knock' : 'wait';
      return;
    }
    if (a?.id === 'drink' && a.note === 'bar-wait') {
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

  /** People don't stand inside each other: push apart anyone closer than 0.42 m (never through a locked door). Bumps are noted. */
  private separate(dt: number): void {
    const ps = this.people;
    const R = 0.42;
    const world = this.world;
    const canStand = (p: Person, x: number, z: number): boolean => {
      if (!this.pf.walkable(p.level, x, z)) return false;
      const d = world.doorAtPoint(p.level, x, z);
      return d < 0 || world.canPass(world.doors[d]!, p);
    };
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
        this.body.checkBump(a, b, dx, dz, d, dt);
        const ux = d > 1e-4 ? dx / d : 1;
        const uz = d > 1e-4 ? dz / d : 0;
        const push = (R - d) / 2;
        if (canStand(a, a.x - ux * push, a.z - uz * push)) {
          a.x -= ux * push;
          a.z -= uz * push;
        }
        if (canStand(b, b.x + ux * push, b.z + uz * push)) {
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

  log(kind: PartyEvent['kind'], actors: number[], room?: number, note?: string): void {
    this.events.push({ t: this.t, kind, actors, room, note });
  }

  /** A short digest of everyone's state, the doors and the things in hand, for determinism checks. */
  digest(): string {
    let h = 0;
    const mix = (s: string) => {
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    };
    for (const p of this.people) mix(`${p.id}:${p.present ? 1 : 0}${p.gone ? 1 : 0}:${Math.round(p.x * 100)},${Math.round(p.z * 100)},${p.level}:${p.action?.id ?? '-'}:${Math.round(p.tipsy * 100)}:${p.item}`);
    for (const d of this.world.doors) mix(`${d.id}:${Math.round(d.open * 10)}${d.locked ? 1 : 0}`);
    return `${this.t}:${(h >>> 0).toString(16)}`;
  }

  /** Perch visibility of a person (0..1), from the house's visibility grid with the curtains as they are now. */
  visibility(p: Person): number {
    return p.present ? this.world.visAt(p.level, this.pf.cellOf(p.level, p.x, p.z)) : 0;
  }
}
