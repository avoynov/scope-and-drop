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
import { Ident } from './ident';
import { Memory, KNOWN, SUSPICIOUS, type MemoryHost, type Verb } from './memory';
import { beside, choose, decayRates, destination, LAST_TOAST, PHASE_WEIGHTS, spotKey, toAction, type Candidate, type MindWorld } from './mind';
import { Mood, type MoodOverride } from './mood';
import { Pathfinder } from './path';
import { resolvePlaces, RoomCells, yawTo, type Places } from './places';
import { Senses, type Sound, type SoundKind, type SensesHost } from './senses';
import { Sight } from './sight';
import { DRINKS, NEED_IDS, type ActionId, type ActionState, type DrinkId, type Gesture, type Group, type Held, type PartyEvent, type Person, type Seat, type Spot, type Waypoint } from './types';
import { DRINK_IDS, World } from './world';

/** A fact put straight into someone's head at a time: the lab's "plant a rumour", and the tests. */
export interface Provocation {
  t: number;
  /** Defaults to a rumour (juicy, a little odd). */
  verb?: Verb;
  subject: number;
  /** Who hears it first; defaults to the first guest in a conversation who isn't the subject. */
  witness?: number;
  /** Suspicion weight, overriding the verb's. */
  odd?: number;
}

export interface PartyOptions extends CastOptions {
  /** Seed for the cast and every choice; defaults to the blueprint's seed. */
  seed?: string;
  /** Lab nudges to the mood: set someone's tension, or scale their energy, at a time. */
  mood?: MoodOverride[];
  /** Facts planted at a time. */
  provoke?: Provocation[];
  /** Time each stage of the step into `party.profile` (ms). */
  profile?: boolean;
}

/** What the party has noticed so far, for the lab and the tests. */
export interface PartyStats {
  facts: number;
  told: number;
  overheard: number;
  doubleTakes: number;
  tests: number;
  wrongTurns: number;
  asks: number;
  hushes: number;
  heard: number;
  sightings: number;
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
/** A corner of a route this close counts as reached when the next leg is open from here (m). */
const CORNER = 0.3;
/** Giving way: how far ahead (m) and how wide a lane walkers watch, and the most they shift aside in a step (m). */
const SIDESTEP_AHEAD = 1.5;
const SIDESTEP_LANE = 0.5;
const SIDESTEP_MAX = 0.15;
/** Rooms staff never step into on their rounds. */
const PRIVATE: ReadonlySet<RoomType> = new Set(['bathroom', 'bedroom', 'dressing-room', 'study']);
/** Rooms a guest has no business in: coming out of one is noticed. */
const SNOOP: ReadonlySet<RoomType> = new Set(['bedroom', 'dressing-room', 'study']);
/** Rooms the staff know only roughly (they serve the party rooms, the hall and the kitchen). */
const STAFF_ROUGH: ReadonlySet<RoomType> = new Set(['bedroom', 'dressing-room', 'study']);
/** Actions on the way to which a junction can go wrong (programme trips follow the crowd). */
const LOSES_WAY: ReadonlySet<ActionId> = new Set(['toilet', 'mingle', 'drink', 'sit', 'art', 'terrace', 'dance', 'games']);
/** What a nosy guest drops to go and see what that noise was. */
const DROP_TO_LOOK: ReadonlySet<ActionId> = new Set(['mingle', 'sit', 'art', 'wander', 'terrace']);
/** Doing something where talk happens without a conversation of its own: at table, in the toast ring, on a sofa, outside. */
const SIDE_TALK: ReadonlySet<ActionId> = new Set(['dinner', 'toast', 'sit', 'terrace']);
/** Chance a speaker passes something on at the start of a turn (times 0.4 + their talkativeness). */
const GOSSIP = 0.25;
/** Chance, every two in-game seconds, that someone at table or on a sofa says something to a neighbour (times 0.3 + talk). */
const SIDE_GOSSIP = 0.02;
/** How well someone knows the bathroom they've just been pointed to: a little better than the rooms on the way. */
const POINTED = 0.4;
/** A pause to look round after a wrong turn (in-game s). */
const LOOK_ROUND = 2;

/** Which drinks the waiters carry: champagne before the toast, wine at dinner, a mix after. */
const bandOf = (id: PhaseId): Body['band'] => (id === 'dinner' ? 'dinner' : id === 'dancing' || id === 'games' || id === 'farewell' ? 'after' : 'before');

export class Party implements MindWorld, BodyHost, MemoryHost, SensesHost {
  readonly bp: MansionBlueprint;
  readonly pf: Pathfinder;
  readonly cells: RoomCells;
  /** Doors, curtains, lights and every thing people carry, lock or lose. */
  readonly world: World;
  /** Bathrooms, drinks, tipsiness and bumps. */
  readonly body: Body;
  /** Who can see whom, through which doors and windows. */
  readonly sight: Sight;
  /** Last seen, facts, gossip, suspicion and everyone's mental map of the house. */
  readonly memory: Memory;
  /** Energy and tension, per person. */
  readonly mood: Mood;
  /** How people know each other by sight. */
  readonly ident: Ident;
  /** Looking and listening. */
  readonly senses: Senses;
  /** Per-stage time (ms) when the party was made with `profile`. */
  readonly profile: Record<string, number> | null;
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
  private stepNo = 0;
  /** Draws for wrong turns, and for who speaks up and what gets passed on, kept apart from the minds'. */
  private readonly mapRng: Rng;
  private readonly chat: Rng;
  private readonly provoke: Provocation[];
  private provoked = 0;
  /** Mood overrides; the mood reads this list, so one added later still applies. */
  private readonly nudges: MoodOverride[];
  /** Which bathroom someone was pointed to (-1 nobody knew), by asker. */
  private readonly answers = new Map<number, number>();
  /** People within 3 m of each other in the same room, and how many each has round them (for the mood). */
  private pairs = new Int16Array(0);
  private pairDist = new Float32Array(0);
  private nPairs = 0;
  private readonly crowd: Uint8Array;
  /** When each person last took a wrong turn: once lost, they mind the way for the rest of the trip. */
  private readonly lostAt: Float64Array;
  private counts = { wrongTurns: 0, asks: 0, hushes: 0, heard: 0 };

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
    this.sight = new Sight(bp, this.pf, this.world);
    this.memory = new Memory(this, bp.rooms.length, root.fork('gossip'));
    this.nudges = [...(opts.mood ?? [])];
    this.mood = new Mood(this.people, this.nudges);
    this.ident = new Ident(this.people, root.fork('ident'));
    this.senses = new Senses(this, root.fork('senses'));
    this.mapRng = root.fork('map');
    this.chat = root.fork('groups');
    this.provoke = [...(opts.provoke ?? [])].sort((a, b) => a.t - b.t);
    this.profile = opts.profile ? {} : null;
    this.crowd = new Uint8Array(this.people.length);
    this.lostAt = new Float64Array(this.people.length).fill(-1e9);
    this.things = root.fork('things');
    this.doorIn = new Int32Array(this.people.length).fill(-1);
    this.offeredAt = new Float64Array(this.people.length).fill(-1e9);
    this.shelveThings();
    for (const r of bp.rooms) this.floorY[r.index] = r.floorY;
    for (const l of bp.levels) this.levelY.set(l.index, l.floorY);
    this.terraceY = bp.site.terrace.y;
    this.knowTheHouse();
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
    const prof = this.profile;
    let t0 = prof ? performance.now() : 0;
    const lap = (stage: string) => {
      if (!prof) return;
      const now = performance.now();
      prof[stage] = (prof[stage] ?? 0) + now - t0;
      t0 = now;
    };
    this.t += dt;
    this.stepNo++;
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
      // The band strikes up: everyone can find the dance floor by ear. The host says where the games are, and how to get there.
      const pl = this.places;
      const to = this.phase.id === 'dancing' ? pl.danceSpots.slice(0, 1) : this.phase.id === 'games' ? pl.games.map((g) => g.spots[0]!) : [];
      for (const s of to) {
        for (const p of this.people) {
          if (!p.present || p.staff) continue;
          this.memory.pointed(p.id, this.roomsOnTheWay(p, s, p));
          this.memory.startKnowing(p.id, s.room, 0.5);
        }
      }
    }
    const ph = this.phase;
    // Glasses go up once, on the step that crosses the raise.
    if (ph.id === 'toast' && phaseProgress(ph, this.t - dt) < RAISE[0] && phaseProgress(ph, this.t) >= RAISE[0]) {
      this.log('toast', [this.host.id], this.host.room);
      // Anyone in the ring with nothing to raise stands out.
      for (const p of this.people) if (!p.staff && p.present && p.action?.id === 'toast' && p.held !== 'champagne') this.notable(p, 'no-champagne', -1, 20);
    }
    this.provokeDue();

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
    lap('people');
    this.separate(dt);
    lap('separate');
    this.body.endStep(dt);
    this.world.step(dt);
    lap('body');
    this.updateGroups();
    if (this.stepNo % 4 === 0) this.sideTalk();
    lap('talk');
    // Out of step with the programme: doing something else through the toast or dinner.
    if ((ph.id === 'toast' || ph.id === 'dinner') && this.stepNo % 20 === 0) this.outOfStep();
    this.senses.step(this.stepNo);
    lap('senses');
    this.mood.applyOverrides(this.t);
    if (this.stepNo % 2 === 0) {
      this.findPairs();
      this.mood.step(2 * dt, (p) => this.moodInput(p), this.pairs, this.pairDist, this.nPairs);
    }
    lap('mood');
    if (this.stepNo % 120 === 0) this.memory.upkeep(120 * dt);
    lap('memory');
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
    this.memory.walkInto(p.id, p.room);
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
    // Someone who didn't seem quite themselves: go and say hello, and settle it.
    const j = this.ident.wantTest[p.id]!;
    if (j >= 0) {
      const q = this.people[j]!;
      if (q.gone) this.ident.wantTest[p.id] = -1;
      else if (q.present && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 15 && this.memory.lastT[p.id * this.people.length + j]! > this.t - 60) {
        const s = beside(q, p, this.pf);
        if (s) return void this.start(p, { id: 'ask', target: s, duration: 5, pose: 'talk', gain: { social: 0.1 }, ref: j, note: 'test' });
      }
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
    p.detour = null;
    if (c.id === 'ask') a.until = this.t + 90;
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
      const g: Group = { id: this.nextGroup++, level: a.target.level, x: cx, z: cz, room: a.target.room, members: [], speaker: p.id, speakerUntil: 0, quietUntil: 0 };
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
    if (a.id === 'ask') return this.askStep(p, a, dt);
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
    // Looking round after a wrong turn, then back on the way.
    if (p.detour && p.detour.until >= 0) {
      if (this.t >= p.detour.until) this.backOnTheWay(p);
      return;
    }
    const before = p.room;
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
          if (p.room !== before) this.enterRoom(p, before);
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
      } else if (d < CORNER && this.cornerOpen(p)) {
        // Close enough to a corner with the next leg open: round it (two people never fight over the same corner).
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
    if (p.room !== before) this.enterRoom(p, before);
    if (p.action && p.pathIndex >= p.path.length) {
      if (p.detour) this.lookRound(p);
      else this.arrived(p);
    }
  }

  /** Whether the leg after the next corner runs clear from where someone stands now. */
  private cornerOpen(p: Person): boolean {
    const next = p.path[p.pathIndex + 1];
    const n = this.pf.levels.get(p.level);
    return !!next && !!n && !next.climb && next.level === p.level && this.pf.clear(n, p.x, p.z, next.x, next.z);
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
      if (g) {
        p.yaw = yawTo(p.x, p.z, g.x, g.z);
        this.joinGroup(p, g);
      }
    } else if (a.target) p.yaw = a.target.yaw;
    // A stop on a waiter's round: empties onto the tray (glasses are offered while they stand there).
    if (a.id === 'staff' && a.note === 'serve') this.body.clearGlasses(p, 3);
    a.startedAt = this.t;
  }

  /** Walk to a spot as part of the current action (it starts when they get there); false when there is no way. */
  goTo(p: Person, s: Spot): boolean {
    const a = p.action;
    if (!a) return false;
    p.detour = null;
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
    p.detour = null;
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
    if (p.gesture && this.t >= p.gestureUntil) p.gesture = null;
    if (p.detour && p.detour.until >= 0) {
      p.pose = 'look';
      return;
    }
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

  /**
   * Conversations take turns. A new speaker may pass something on (memory.ts decides what), now
   * and then someone laughs, and a group that has just gone quiet stays so for a while.
   */
  private updateGroups(): void {
    for (const g of this.groups.values()) {
      if (this.t < g.quietUntil) {
        g.speaker = -1;
        continue;
      }
      if (this.t < g.speakerUntil) continue;
      const here = g.members.filter((m) => this.people[m]!.action?.startedAt != null);
      if (!here.length) continue;
      g.speaker = this.rng.weighted(here.map((m) => [m, 0.05 + this.people[m]!.traits.talk ** 2] as const));
      const sp = this.people[g.speaker]!;
      // Tense talk comes quicker.
      g.speakerUntil = this.t + this.rng.range(3, 9) * (1 - 0.4 * this.mood.tension[sp.id]!);
      if (here.length > 1 && this.chat.chance(GOSSIP * (0.4 + sp.traits.talk))) {
        const nearby = this.people.filter((q) => q.present && !here.includes(q.id) && q.level === g.level && Math.hypot(q.x - g.x, q.z - g.z) < 3).map((q) => q.id);
        this.passOn(sp, here, nearby, g.room, g.speakerUntil - this.t);
      }
      if (this.chat.chance(sp.quirks.includes('big-laugh') ? 0.2 : 0.05)) this.senses.sound('laugh', sp, sp.id);
    }
  }

  /** Talk at table, in the toast ring, on a sofa or outside: now and then someone says something to whoever is beside them. */
  private sideTalk(): void {
    const by = (p: Person) => !p.staff && p.present && p.action !== null && p.action.startedAt !== null && SIDE_TALK.has(p.action.id);
    for (const p of this.people) {
      if (!by(p) || !this.chat.chance(SIDE_GOSSIP * (0.3 + p.traits.talk))) continue;
      const near = this.people.filter((q) => q !== p && by(q) && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 1.6).map((q) => q.id);
      if (near.length) this.passOn(p, [p.id, ...near], [], p.room, 3);
    }
  }

  /** A speaker passes on one thing they know, if anything is worth it. */
  private passOn(sp: Person, members: number[], nearby: number[], room: number, secs: number): void {
    const m = this.memory;
    const r = m.onTurn(members, sp.id, nearby);
    if (!r) return;
    this.gesture(sp, 'lean', Math.max(2, secs));
    this.log('gossip', [sp.id, ...r.listeners], room, m.verbOf(r.fact));
    const subj = m.subject[r.fact]!;
    const odd = m.odd[r.fact]! > 0 && m.juicy[r.fact]! >= 0.6;
    for (const l of [...r.listeners, ...r.overheard]) {
      // Where it happened tells them where the subject was.
      if (subj >= 0 && m.room[r.fact]! >= 0) m.toldWhere(l, subj, m.room[r.fact]!, m.t[r.fact]!);
      // Something juicy and odd unsettles a little.
      if (odd) this.mood.witness(l, 0.02);
    }
  }

  /** Someone joins a conversation: strangers meet, and talk stops if they're wary of the newcomer. */
  private joinGroup(p: Person, g: Group): void {
    const others = g.members.filter((m) => m !== p.id && this.people[m]!.action?.startedAt != null);
    for (const m of others) this.ident.meet(p.id, m);
    const wary = others.filter((m) => this.memory.suspects(m, p.id) >= SUSPICIOUS);
    if (!wary.length) return;
    g.quietUntil = this.t + this.chat.range(10, 25);
    g.speaker = -1;
    for (const m of wary) this.glance(this.people[m]!, p.x, p.z, 3);
    this.counts.hushes++;
    this.log('hush', [p.id, ...wary], g.room);
  }

  /** Through the toast or dinner, a guest who knows what's on and is doing something else stands out. */
  private outOfStep(): void {
    for (const p of this.people) {
      if (p.staff || p.role === 'host' || !p.present || p.phaseSeen !== this.phaseIdx) continue;
      const a = p.action;
      if (a && !['toast', 'dinner', 'champagne', 'toilet', 'leave'].includes(a.id)) this.notable(p, 'out-of-step', -1, 12);
    }
  }

  // ------------------------------------------------------------- knowing the house

  /**
   * What everyone knows of the house as the evening starts: the host and their partner live here,
   * staff know the rooms they work, regulars the party rooms and the nearest bathrooms, and every
   * guest the entrance hall and the rooms it opens onto.
   */
  private knowTheHouse(): void {
    const m = this.memory;
    const pl = this.places;
    const bp = this.bp;
    const host = this.host;
    m.household[host.id] = 1;
    if (host.partner !== null) m.household[host.partner] = 1;
    const party = new Set<number>([...pl.partyRooms.map((r) => r.index), pl.toastRoom.index]);
    for (const r of [pl.dining, pl.danceRoom]) if (r) party.add(r.index);
    const toast = pl.toastSpot;
    const near = [...pl.bathrooms].sort((a, b) => far(a.door) - far(b.door)).slice(0, 2);
    function far(s: Spot): number {
      return Math.hypot(s.x - toast.x, s.z - toast.z) + 10 * Math.abs(s.level - toast.level);
    }
    const hall = pl.entranceRoom?.index ?? pl.entrance.room;
    const offHall = (this.world.graph[hall] ?? []).filter((e) => e.kind !== 'stair').map((e) => e.to);
    // Regulars know the party rooms, the nearest bathrooms and the way to each from the toast.
    const known = new Set<number>([...party, ...near.map((b) => b.room.index)]);
    for (const r of [...party]) {
      const to = this.cells.random(r, this.mapRng);
      if (to) for (const w of this.roomsOnTheWay(toast, to, null)) known.add(w);
    }
    for (const b of near) for (const w of this.roomsOnTheWay(toast, b.door, null)) known.add(w);
    for (const p of this.people) {
      if (m.household[p.id]) continue;
      if (p.staff) {
        for (const r of bp.rooms) m.startKnowing(p.id, r.index, STAFF_ROUGH.has(r.type) ? 0.3 : 0.9, 8);
        m.startKnowing(p.id, -2, 0.9, 8);
        continue;
      }
      // Known from before, so it never fades far.
      if (p.regular) for (const r of known) m.startKnowing(p.id, r, 0.8, 8);
      m.startKnowing(p.id, hall, 0.6, 1);
      for (const r of offHall) m.startKnowing(p.id, r, 0.6);
    }
  }

  /** Walked into a room: learnt, maybe noticed coming out of a bedroom, maybe the wrong turn at a junction. */
  private enterRoom(p: Person, from: number): void {
    this.memory.walkInto(p.id, p.room);
    const type = (r: number) => (r >= 0 ? this.bp.rooms[r]!.type : null);
    const fromType = type(from);
    const toType = type(p.room);
    if (!p.staff && !this.memory.household[p.id] && fromType && SNOOP.has(fromType) && !(toType && SNOOP.has(toType))) this.notable(p, 'left-bedroom', -1, 8);
    this.maybeWrongTurn(p, from);
  }

  /**
   * At a junction on the way somewhere, a guest may take the wrong doorway: a few steps into the
   * wrong room (or up to a door that turns out locked), a look round, then back on the way. The
   * chance is (0.5 − k) × (1 + tipsiness), where k is how well they know where they're going or
   * the room the right doorway leads into, whichever is better: someone sure of the bathroom
   * finds it from anywhere, and a hall crossed all evening fools nobody.
   */
  private maybeWrongTurn(p: Person, from: number): void {
    const a = p.action;
    if (!a || p.detour || p.staff || this.memory.household[p.id] || a.startedAt !== null || !LOSES_WAY.has(a.id)) return;
    if ((a.id === 'toilet' && a.note !== 'door') || this.t - this.lostAt[p.id]! < 120) return;
    const goal = p.path[p.path.length - 1];
    if (!goal || p.room === -1) return;
    const goalRoom = this.pf.roomAt(goal.level, goal.x, goal.z);
    if (goalRoom === p.room || goalRoom === -1) return;
    // The way they should go next.
    let next = -1;
    for (let i = p.pathIndex; i < p.path.length && next < 0; i++) {
      const w = p.path[i]!;
      if (w.climb) break;
      const r = this.pf.roomAt(w.level, w.x, w.z);
      if (r !== p.room && r !== -1) next = r;
    }
    const dest = this.memory.familiarity(p.id, destination(a, this.places));
    const k = next !== -1 ? Math.max(dest, this.memory.familiarity(p.id, next)) : dest;
    const chance = Memory.wrongTurnChance(k, p.tipsy);
    if (chance <= 0 || !this.mapRng.chance(chance)) return;
    const R = this.bp.rooms.length;
    const edges = (this.world.graph[p.room < 0 ? R : p.room] ?? []).filter((e) => e.kind !== 'stair' && e.level === p.level && e.to !== next && e.to !== from && e.to !== goalRoom);
    if (!edges.length) return;
    const e = this.mapRng.pick(edges);
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < 0.3) return;
    const ux = (e.x - p.x) / d;
    const uz = (e.z - p.z) / d;
    const door = e.door >= 0 ? this.world.doors[e.door]! : null;
    const locked = !!door && !this.world.canPass(door, p);
    // Through the doorway and a step in, or up to the locked door.
    const s = locked ? this.pf.snap(p.level, e.x - ux * 0.6, e.z - uz * 0.6, 0.5) : this.pf.snap(p.level, e.x + ux * 1.2, e.z + uz * 1.2, 0.6);
    if (!s || (!locked && this.pf.roomAt(s.level, s.x, s.z) !== e.to)) return;
    const route = this.pf.route({ level: p.level, x: p.x, z: p.z }, s, p);
    if (!route) return;
    p.detour = { goal, until: -1, door: locked ? door!.id : -1 };
    this.lostAt[p.id] = this.t;
    p.path = route;
    p.pathIndex = 1;
    this.notable(p, 'wrong-turn', -1, 20);
    this.counts.wrongTurns++;
    this.log('wrong-turn', [p.id], p.room, locked ? 'door' : undefined);
  }

  /** At the end of a wrong turn: try the locked door, or look round the wrong room. */
  private lookRound(p: Person): void {
    const dt = p.detour!;
    dt.until = this.t + LOOK_ROUND;
    if (dt.door >= 0) {
      const d = this.world.doors[dt.door]!;
      p.yaw = yawTo(p.x, p.z, d.x, d.z);
      this.notable(p, 'locked-door', -1, 8);
    }
  }

  private backOnTheWay(p: Person): void {
    const goal = p.detour!.goal;
    p.detour = null;
    const route = this.pf.route({ level: p.level, x: p.x, z: p.z }, goal, p);
    if (!route) return this.end(p, false);
    p.path = route;
    p.pathIndex = 1;
  }

  // ------------------------------------------------------------------ asking

  /** Asking the way, or the friendly test: walk up to them (they may be moving), a word, then act on the answer. */
  private askStep(p: Person, a: ActionState, dt: number): void {
    const q = this.people[a.ref!]!;
    if (a.startedAt !== null) {
      p.yaw = yawTo(p.x, p.z, q.x, q.z);
      if (this.t - a.startedAt < a.duration) return;
      const bath = this.answers.get(p.id) ?? -1;
      this.answers.delete(p.id);
      this.end(p, true);
      const b = this.places.bathrooms[bath];
      if (b && this.worthTrying(p, bath)) this.start(p, { id: 'toilet', target: b.door, duration: this.rng.range(120, 240), pose: 'wait', gain: { bladder: 1 }, ref: bath, note: 'door' });
      return;
    }
    if (!q.present || this.t >= a.until!) {
      p.avoid.set(`ask:${q.id}`, this.t + 600);
      return this.end(p, false);
    }
    if (q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 1.6) return this.answer(p, q, a);
    // Re-aim when they've moved on (never halfway up a stair).
    const tgt = a.target!;
    if (!p.path[p.pathIndex]?.climb && (Math.hypot(q.x - tgt.x, q.z - tgt.z) > 1.5 || q.level !== tgt.level || p.pathIndex >= p.path.length)) {
      const s = beside(q, p, this.pf);
      const route = s ? this.pf.route({ level: p.level, x: p.x, z: p.z }, s, p) : null;
      if (!s || !route) return this.end(p, false);
      a.target = s;
      p.path = route;
      p.pathIndex = 1;
    }
    this.walk(p, dt);
  }

  private answer(p: Person, q: Person, a: ActionState): void {
    a.startedAt = this.t;
    p.yaw = yawTo(p.x, p.z, q.x, q.z);
    this.glance(q, p.x, p.z, a.duration);
    this.gesture(p, 'ask', 2);
    if (a.note === 'test') {
      this.ident.test(p.id, q.id, this.t);
      this.log('test', [p.id, q.id], p.room, 'passed');
      return;
    }
    this.counts.asks++;
    // The bathroom they know nearest the one asking.
    let best = -1;
    let bd = Infinity;
    this.places.bathrooms.forEach((b, i) => {
      if (this.memory.familiarity(q.id, b.room.index) < KNOWN) return;
      const d = Math.hypot(b.door.x - p.x, b.door.z - p.z) + 10 * Math.abs(b.door.level - p.level);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    this.answers.set(p.id, best);
    if (best < 0) {
      this.gesture(q, 'shrug', 2);
      p.avoid.set(`ask:${q.id}`, this.t + 900);
      this.log('ask', [p.id, q.id], p.room, 'shrug');
      return;
    }
    const b = this.places.bathrooms[best]!;
    this.gesture(q, 'point', 3);
    q.lookX = b.door.x;
    q.lookZ = b.door.z;
    this.memory.pointed(p.id, this.roomsOnTheWay(p, b.door, p));
    this.memory.startKnowing(p.id, b.room.index, POINTED);
    this.log('ask', [p.id, q.id], p.room, 'pointed');
  }

  /** Rooms a route from one place to a spot passes through, sampled every metre. */
  private roomsOnTheWay(from: Waypoint, s: Spot, who: Person | null): number[] {
    const route = this.pf.route({ level: from.level, x: from.x, z: from.z }, s, who);
    const out = new Set<number>();
    if (!route) return [s.room];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!;
      const b = route[i]!;
      if (b.climb) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
      for (let k = 0; k <= n; k++) {
        const r = this.pf.roomAt(b.level, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n);
        if (r !== -1) out.add(r);
      }
    }
    out.add(s.room);
    return [...out];
  }

  /** Someone near and known to ask the way: a friend, a partner, staff, the host, or anyone met. Staff and the host first. */
  answerer(p: Person): Person | null {
    let best: Person | null = null;
    let bd = 20;
    const n = this.people.length;
    for (const q of this.people) {
      if (q === p || !q.present || q.level !== p.level || (p.avoid.get(`ask:${q.id}`) ?? -1) > this.t) continue;
      if (q.action?.id === 'toilet' || q.action?.id === 'leave' || q.action?.id === 'ask') continue;
      if (!(q.staff || q.role === 'host' || q.id === p.partner || p.friends.includes(q.id) || this.ident.tieOf(p.id, q.id) >= 1)) continue;
      if (this.memory.lastT[p.id * n + q.id]! < this.t - 60) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z) * (q.staff || q.role === 'host' ? 0.7 : 1);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  // ------------------------------------------------------------- mood and senses

  /** Pairs within 3 m in the same room, sitters too, and how many each has round them. */
  private findPairs(): void {
    const ps = this.people;
    const cap = (ps.length * (ps.length - 1)) / 2;
    if (this.pairs.length < 2 * cap) {
      this.pairs = new Int16Array(2 * cap);
      this.pairDist = new Float32Array(cap);
    }
    this.crowd.fill(0);
    let k = 0;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]!;
      if (!a.present) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]!;
        if (!b.present || b.level !== a.level || b.room !== a.room) continue;
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        if (d >= 3) continue;
        this.pairs[2 * k] = i;
        this.pairs[2 * k + 1] = j;
        this.pairDist[k++] = d;
        this.crowd[i]!++;
        this.crowd[j]!++;
      }
    }
    this.nPairs = k;
  }

  private moodInput(p: Person) {
    const a = p.action;
    const crowd = this.crowd[p.id]!;
    return {
      dancing: p.pose === 'dance',
      music: this.senses.musicIn(p.room),
      talking: a?.id === 'mingle' && a.startedAt !== null,
      alone: p.pose === 'sit' && crowd === 0,
      crowd,
    };
  }

  /**
   * Plant a fact from the next step on (the lab's button). The lab passes the same in `provoke`
   * when it replays, which lands it on the same step.
   */
  plant(v: Provocation): void {
    let i = this.provoked;
    while (i < this.provoke.length && this.provoke[i]!.t <= v.t) i++;
    this.provoke.splice(i, 0, { ...v, t: Math.max(v.t, this.t) });
  }

  /** A mood override from the next step on (the lab's mood row); replays pass it in `mood`. */
  nudge(o: MoodOverride): void {
    this.nudges.push({ ...o, t: Math.max(o.t, this.t) });
  }

  private provokeDue(): void {
    while (this.provoked < this.provoke.length && this.provoke[this.provoked]!.t <= this.t) {
      const v = this.provoke[this.provoked++]!;
      // By default, a guest in a conversation (else any guest) hears it first.
      const guest = (q: Person) => q.present && !q.staff && q.role !== 'host' && q.id !== v.subject;
      const w = v.witness ?? (this.people.find((q) => guest(q) && q.action?.id === 'mingle' && q.action.startedAt !== null) ?? this.people.find(guest))?.id;
      if (w !== undefined) this.memory.plant(w, v.verb ?? 'rumour', v.subject, v.odd);
    }
  }

  private notable(p: Person, verb: Verb, obj: number, secs: number): void {
    p.notable = verb;
    p.notableObj = obj;
    p.notableUntil = this.t + secs;
  }

  private gesture(p: Person, g: Gesture, secs: number): void {
    p.gesture = g;
    p.gestureUntil = this.t + secs;
  }

  /** Turn someone's head toward a point for a while. */
  glance(p: Person, x: number, z: number, secs: number): void {
    p.lookX = x;
    p.lookZ = z;
    p.lookUntil = this.t + secs;
  }

  /** A nosy guest drops what they're doing to see what that noise was. */
  goLook(p: Person, s: Sound): void {
    if (p.staff || p.role === 'host' || (p.action && !DROP_TO_LOOK.has(p.action.id)) || (p.avoid.get('look') ?? -1) > this.t) return;
    const at = this.pf.snap(s.level, s.x, s.z, 2.5);
    if (!at) return;
    p.avoid.set('look', this.t + 300);
    this.end(p, false);
    this.start(p, { id: 'wander', target: { level: at.level, x: at.x, z: at.z, yaw: p.yaw, room: this.pf.roomAt(at.level, at.x, at.z) }, duration: this.rng.range(20, 40), pose: 'look', gain: { curiosity: 0.2 } });
    this.counts.heard++;
    this.log('heard', [p.id], s.room, s.kind);
  }

  /** Whether two people are in the same conversation, dancing together, or side by side at table. */
  together(a: Person, b: Person): boolean {
    const x = a.action;
    const y = b.action;
    if (!x || !y || x.startedAt === null || y.startedAt === null) return false;
    if (x.id === 'mingle' && y.id === 'mingle') return x.ref === y.ref;
    const close = a.level === b.level && Math.hypot(a.x - b.x, a.z - b.z) < 1.5;
    return close && ((x.id === 'dance' && y.id === 'dance') || (x.id === 'dinner' && y.id === 'dinner') || x.id === 'ask' || y.id === 'ask');
  }

  sound(kind: SoundKind, at: { level: number; x: number; z: number; room: number }, source: number, ref = -1): void {
    this.senses.sound(kind, at, source, ref);
  }

  get phaseId(): PhaseId {
    return this.phase.id;
  }

  tensionOf(i: number): number {
    return this.mood.tension[i]!;
  }

  familiarity(p: Person, room: number): number {
    return this.memory.familiarity(p.id, room);
  }

  suspects(i: number, j: number): number {
    return this.memory.suspects(i, j);
  }

  energy(p: Person): number {
    return this.mood.energy[p.id]!;
  }

  tension(p: Person): number {
    return this.mood.tension[p.id]!;
  }

  /** What the party has noticed so far. */
  get stats(): PartyStats {
    const m = this.memory.stats;
    return {
      facts: this.memory.count,
      told: m.told,
      overheard: m.overheard,
      doubleTakes: this.ident.stats.doubleTakes,
      tests: this.ident.stats.tests,
      wrongTurns: this.counts.wrongTurns,
      asks: this.counts.asks,
      hushes: this.counts.hushes,
      heard: this.counts.heard,
      sightings: this.senses.stats.sightings,
    };
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
    const { energy, tension } = this.mood;
    for (const p of this.people) {
      mix(`${p.id}:${p.present ? 1 : 0}${p.gone ? 1 : 0}:${Math.round(p.x * 100)},${Math.round(p.z * 100)},${p.level}:${p.action?.id ?? '-'}:${Math.round(p.tipsy * 100)}:${p.item}`);
      mix(`${Math.round(energy[p.id]! * 20)},${Math.round(tension[p.id]! * 20)}`);
    }
    for (const d of this.world.doors) mix(`${d.id}:${Math.round(d.open * 10)}${d.locked ? 1 : 0}`);
    mix(`f${this.memory.count}`);
    return `${this.t}:${(h >>> 0).toString(16)}`;
  }

  /** Perch visibility of a person (0..1), from the house's visibility grid with the curtains as they are now. */
  visibility(p: Person): number {
    return p.present ? this.world.visAt(p.level, this.pf.cellOf(p.level, p.x, p.z)) : 0;
  }
}
