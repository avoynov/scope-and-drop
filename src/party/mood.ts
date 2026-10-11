/**
 * House mood as two numbers per person (milestone 2 technical plan: Mood). Energy is how lively
 * someone feels, tension how uneasy. Both belong to people, never to rooms: a room's mood is
 * worked out from whoever is in it, only when something asks.
 */
import type { Person } from './types';

/** Energy drifts toward its target with this time constant (in-game s). */
const ENERGY_TAU = 300;
/** Tension halves over this long (in-game s). */
const TENSION_HALF = 20 * 60;
/** Contact pulls (per in-game second at no distance): energy both ways, tension one way. */
const ENERGY_PULL = 0.02;
const TENSION_PULL = 0.005;

/** A lab-only nudge: set someone's tension, or scale their energy, once at a time; the rules take over after. */
export interface MoodOverride {
  t: number;
  /** Everyone, one person, or whoever is in a room at that moment. */
  target: 'all' | { person: number } | { room: number };
  tension?: number;
  /** Multiplies energy (0.5 to 1.5 in the lab). */
  energy?: number;
}

/** What one person is doing, as the mood reads it. */
export interface MoodInput {
  dancing: boolean;
  /** Music where they stand (the band, the piano). */
  music: boolean;
  /** Talking in a conversation. */
  talking: boolean;
  /** Sitting on their own somewhere quiet. */
  alone: boolean;
  /** People within 3 m. */
  crowd: number;
}

export type RoomMood = 'festive' | 'relaxed' | 'uneasy' | 'tense';

export class Mood {
  readonly energy: Float32Array;
  readonly tension: Float32Array;
  private readonly applied = new Set<number>();

  constructor(
    private readonly people: Person[],
    private readonly overrides: readonly MoodOverride[] = [],
  ) {
    const n = people.length;
    this.energy = new Float32Array(n).fill(0.25);
    this.tension = new Float32Array(n);
  }

  /**
   * One update (every second of in-game time): energy drifts to what each person is doing and
   * spreads between people close together; tension fades, and passes from tense people to
   * calmer ones beside them, never the other way.
   */
  step(dt: number, input: (p: Person) => MoodInput, pairs: Int16Array, dist: Float32Array, nPairs: number): void {
    const e = this.energy;
    const ten = this.tension;
    const drift = 1 - Math.exp(-dt / ENERGY_TAU);
    const fade = 0.5 ** (dt / TENSION_HALF);
    for (const p of this.people) {
      if (!p.present) continue;
      const m = input(p);
      let target = 0.25 + 0.2 * p.tipsy + 0.2 * Math.min(1, m.crowd / 8);
      if (m.dancing) target += 0.35;
      if (m.music) target += 0.15;
      if (m.talking) target += 0.1;
      if (m.alone) target -= 0.2;
      target = Math.max(0, Math.min(1, target));
      e[p.id] = e[p.id]! + (target - e[p.id]!) * drift;
      ten[p.id] = ten[p.id]! * fade;
    }
    for (let k = 0; k < nPairs; k++) {
      const a = pairs[2 * k]!;
      const b = pairs[2 * k + 1]!;
      const w = Math.max(0, 1 - dist[k]! / 3) * dt;
      const ea = e[a]!;
      const eb = e[b]!;
      e[a] = ea + (eb - ea) * ENERGY_PULL * w;
      e[b] = eb + (ea - eb) * ENERGY_PULL * w;
      const ta = ten[a]!;
      const tb = ten[b]!;
      if (ta > tb) ten[b] = tb + (ta - tb) * TENSION_PULL * w * this.people[b]!.traits.nerves;
      else if (tb > ta) ten[a] = ta + (tb - ta) * TENSION_PULL * w * this.people[a]!.traits.nerves;
    }
  }

  /** Someone saw or heard something unsettling: more for the nervous. */
  witness(i: number, amount: number): void {
    const p = this.people[i]!;
    this.tension[i] = Math.min(1, this.tension[i]! + amount * (0.5 + p.traits.nerves));
  }

  /** Lab overrides due by now, applied once each. */
  applyOverrides(t: number): void {
    this.overrides.forEach((o, i) => {
      if (this.applied.has(i) || o.t > t) return;
      this.applied.add(i);
      for (const p of this.people) {
        if (!p.present && o.target !== 'all') continue;
        const hit = o.target === 'all' || ('person' in o.target ? o.target.person === p.id : p.present && p.room === o.target.room);
        if (!hit) continue;
        if (o.tension !== undefined) this.tension[p.id] = Math.max(0, Math.min(1, o.tension));
        if (o.energy !== undefined) this.energy[p.id] = Math.max(0, Math.min(1, this.energy[p.id]! * o.energy));
      }
    });
  }

  /** A room's mood from the people in it, or null when it is empty. */
  room(room: number): { energy: number; tension: number; label: RoomMood } | null {
    let e = 0;
    let t = 0;
    let c = 0;
    for (const p of this.people) {
      if (!p.present || p.room !== room) continue;
      e += this.energy[p.id]!;
      t += this.tension[p.id]!;
      c++;
    }
    if (!c) return null;
    e /= c;
    t /= c;
    const label: RoomMood = t >= 0.35 ? 'tense' : t >= 0.15 ? 'uneasy' : e >= 0.45 ? 'festive' : 'relaxed';
    return { energy: e, tension: t, label };
  }
}
