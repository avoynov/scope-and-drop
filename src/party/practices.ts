/**
 * The evening's rituals as scripts of beats (milestone 2 technical plan: Practices). A beat fires
 * at a point in the programme and, for a while, pulls on what people choose: during the opening
 * dance nobody else takes the floor, at the band's break the bar fills, at last call everyone
 * wants a final drink. A practice suggests, it never forces: the pull multiplies a choice's score.
 *
 * Some beats carry a norm. Talking through the host's speech, or sitting down at table before the
 * host does, is a breach: whoever sees it close by frowns, and remembers it as rude.
 */
import type { Rng } from '../mansion/core/rng';
import { PARTY_LENGTH, phaseProgress, type Phase, type PhaseId } from './clock';
import type { Memory } from './memory';
import type { Places } from './places';
import type { SoundKind } from './senses';
import type { ActionId, Gesture, PartyEvent, Person } from './types';

export type BeatId = 'tap' | 'hush' | 'procession' | 'host-sits' | 'table-turn' | 'open-dance' | 'surge' | 'band-break' | 'band-back' | 'last-call' | 'thanks';
export type Norm = 'quiet' | 'host-first';

/** Beats at a point in a phase (progress 0 to 1). */
const SCRIPT: ReadonlyArray<{ id: BeatId; phase: PhaseId; at: number }> = [
  { id: 'tap', phase: 'toast', at: 0.06 },
  { id: 'hush', phase: 'toast', at: 0.08 },
  { id: 'procession', phase: 'dinner', at: 0 },
  { id: 'table-turn', phase: 'dinner', at: 0.4 },
  { id: 'open-dance', phase: 'dancing', at: 0 },
  { id: 'band-break', phase: 'dancing', at: 0.62 },
  { id: 'band-back', phase: 'dancing', at: 0.74 },
  { id: 'thanks', phase: 'farewell', at: 0 },
];
/** The speech runs from the hush until glasses go up (toast progress). */
const SPEECH_END = 0.45;
/** The host couple dance alone this long (in-game s), then the floor fills with a surge. */
const OPEN = 60;
const SURGE = 150;
/** Last orders: this long before the end, and the rush for the bar lasts LAST_CALL_FOR (in-game s). */
const LAST_CALL = 20 * 60;
const LAST_CALL_FOR = 5 * 60;
/** Nobody waits longer than this for the host to sit (in-game s from the start of dinner). */
const SIT_WAIT = 150;
/** Who sees a breach and frowns: within this range (m), up to FROWNERS of them. */
const NORM_RADIUS = 6;
const FROWNERS = 4;

export interface PracticesHost {
  readonly t: number;
  readonly people: Person[];
  readonly programme: Phase[];
  readonly phase: Phase;
  readonly host: Person;
  readonly memory: Memory;
  readonly places: Places;
  log(kind: PartyEvent['kind'], actors: number[], room?: number, note?: string): void;
  gesture(p: Person, g: Gesture, secs: number): void;
  glance(p: Person, x: number, z: number, secs: number): void;
  notable(p: Person, verb: 'rude', obj: number, secs: number): void;
  sound(kind: SoundKind, at: { level: number; x: number; z: number; room: number }, source: number): void;
}

export class Practices {
  /** When each beat fired tonight (in-game s). */
  readonly fired = new Map<BeatId, number>();
  readonly stats = { breaches: 0, frowns: 0 };
  /** Whispers through the speech: who leans to a neighbour, and when. */
  private whispers: Array<{ who: number; at: number }> = [];
  /** Breaches already counted, by norm and person. */
  private readonly breached = new Set<string>();

  constructor(
    private readonly host: PracticesHost,
    private readonly rng: Rng,
  ) {}

  /** One step: fire beats whose time has come, and watch the norms. */
  step(stepNo: number): void {
    const h = this.host;
    const ph = h.phase;
    const pr = phaseProgress(ph, h.t);
    for (const b of SCRIPT) if (b.phase === ph.id && pr >= b.at && !this.fired.has(b.id)) this.fire(b.id);
    if (h.t >= PARTY_LENGTH - LAST_CALL && !this.fired.has('last-call')) this.fire('last-call');
    if (this.fired.has('open-dance') && !this.fired.has('surge') && h.t >= this.fired.get('open-dance')! + OPEN) this.fire('surge');
    if (this.speaking) {
      for (const w of this.whispers) if (w.at <= h.t && w.at > h.t - 0.5) this.whisper(h.people[w.who]!);
      if (stepNo % 4 === 0) this.watchSpeech();
    }
  }

  private fire(id: BeatId): void {
    const h = this.host;
    const host = h.host;
    this.fired.set(id, h.t);
    if (id === 'tap') {
      // A spoon on a glass: the room turns.
      h.sound('clink', host, host.id);
      h.gesture(host, 'beckon', 2);
    } else if (id === 'hush') this.planWhispers();
    else if (id === 'table-turn') this.turnTable();
    else if (id === 'last-call') {
      const bar = h.places.bars[0];
      if (bar) h.sound('call', bar, -1);
    }
    h.log('beat', id === 'last-call' ? [] : [host.id], id === 'last-call' ? h.places.bars[0]?.room : host.room, id);
  }

  /** Whether a beat fired within the last `secs`. */
  within(id: BeatId, secs: number): boolean {
    const at = this.fired.get(id);
    return at !== undefined && this.host.t - at < secs;
  }

  /** The host's speech: from the hush until glasses go up. */
  get speaking(): boolean {
    const ph = this.host.phase;
    return ph.id === 'toast' && this.fired.has('hush') && phaseProgress(ph, this.host.t) < SPEECH_END;
  }

  /** The band is on its break. */
  get bandBreak(): boolean {
    return this.fired.has('band-break') && !this.fired.has('band-back');
  }

  /** The host couple have the floor to themselves. */
  get opening(): boolean {
    return this.within('open-dance', OPEN);
  }

  /** How a beat pulls on a choice: 1 leaves it as it is. */
  mult(p: Person, a: ActionId): number {
    let k = 1;
    if (a === 'dance') {
      const host = this.host.host;
      if (this.opening) k *= p === host || p.id === host.partner ? 4 : 0.05;
      else if (this.within('surge', SURGE)) k *= 1.6;
      if (this.bandBreak) k *= 0.4;
    } else if (a === 'drink') {
      if (this.bandBreak) k *= 2;
      if (this.within('last-call', LAST_CALL_FOR)) k *= 2.5;
    }
    return k;
  }

  /** At table: whether a guest may sit yet. They stand behind the chair until the host is seated. */
  maySit(p: Person): boolean {
    const h = this.host;
    if (p === h.host || h.phase.id !== 'dinner' || this.fired.has('host-sits') || h.host.seat === null) return true;
    return h.t - h.phase.start > SIT_WAIT;
  }

  /** The host has sat down: everyone may. */
  hostSat(): void {
    if (!this.fired.has('host-sits')) this.fire('host-sits');
  }

  /**
   * Someone broke a norm: up to four who see it close by frown, glance over and remember it as
   * rude; for a while anyone else who looks their way picks it up too. Once per person and norm.
   */
  breach(p: Person, norm: Norm): void {
    const key = `${norm}:${p.id}`;
    if (this.breached.has(key)) return;
    this.breached.add(key);
    const h = this.host;
    const frowners: number[] = [];
    for (const o of h.people) {
      if (frowners.length >= FROWNERS) break;
      if (o === p || !o.present || o.staff || o.room !== p.room || o.level !== p.level || o.traits.propriety < 0.6) continue;
      if (Math.hypot(o.x - p.x, o.z - p.z) > NORM_RADIUS) continue;
      h.gesture(o, 'frown', 1.5);
      h.glance(o, p.x, p.z, 1.5);
      h.memory.observe(o.id, 'rude', p.id, -1, p.room);
      frowners.push(o.id);
    }
    h.notable(p, 'rude', -1, 10);
    this.stats.breaches++;
    this.stats.frowns += frowners.length;
    h.log('breach', [p.id, ...frowners], p.room, norm);
  }

  /** Through the speech, the less proper (and the tipsy) whisper to a neighbour now and then. */
  private planWhispers(): void {
    const h = this.host;
    const ph = h.phase;
    const end = ph.start + (ph.end - ph.start) * SPEECH_END;
    this.whispers = [];
    for (const p of h.people) {
      if (p.staff || p === h.host || !p.present) continue;
      const chance = Math.max(0, 0.75 - p.traits.propriety + 0.4 * p.tipsy) * 0.8;
      if (this.rng.chance(chance)) this.whispers.push({ who: p.id, at: Math.round(this.rng.range(h.t + 10, Math.max(h.t + 11, end - 5)) * 2) / 2 });
    }
  }

  private whisper(p: Person): void {
    if (!p.present || p.action?.id !== 'toast' || p.action.startedAt === null) return;
    const h = this.host;
    const near = h.people.find((q) => q !== p && q.present && !q.staff && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 1.5);
    if (!near) return;
    h.gesture(p, 'lean', 3);
    h.glance(p, near.x, near.z, 3);
    this.breach(p, 'quiet');
  }

  /** Still chatting in the room while the host speaks. */
  private watchSpeech(): void {
    const h = this.host;
    const host = h.host;
    for (const p of h.people) {
      if (p.staff || p === host || !p.present || p.room !== host.room || p.level !== host.level || p.pose !== 'talk') continue;
      if (Math.hypot(p.x - host.x, p.z - host.z) < 14) this.breach(p, 'quiet');
    }
  }

  /** The table turns: everyone at dinner turns from one neighbour to the other. */
  private turnTable(): void {
    const h = this.host;
    const diners = h.people.filter((p) => p.present && p.action?.id === 'dinner' && p.action.startedAt !== null && p.pose === 'sit');
    for (const p of diners) {
      const by = diners.filter((q) => q !== p).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const other = by[1] ?? by[0];
      if (other) h.glance(p, other.x, other.z, 6);
    }
  }
}
