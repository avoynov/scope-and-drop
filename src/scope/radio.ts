/**
 * The spotters' radio: one channel, one voice at a time. Pure (no DOM, no audio): the labs push calls in and step it
 * with their clock; what it says, and when, comes back as events for a voice (demo/shared/radio-voice.ts) and a log.
 *
 * Rules (the armoury handover, task 7):
 *  - One channel: a call never starts while another is on the air, and nothing cuts one short.
 *  - When the channel is free, the most urgent call that is ready goes next: a shot call, then "target moving", then
 *    a sighting, then a range, then the wind. Among equals the one that has waited longest.
 *  - Speech runs at about 2.5 words a second, and each call ends with the squelch tail as the key is let go.
 *  - A call that has waited more than 20 s is stale and dropped, unless it is a shot call: those always go out.
 *
 * Using it (the scope lab's spotter beside you and the party lab's observers both do this):
 *
 *     const radio = new Radio();
 *     radio.push({ kind: "wind", text: "Wind left, hold point five left", at: t + delay, from: "veteran" });
 *     for (const ev of radio.step(now)) if (ev.type === "start") voice.say(ev.call.text);
 *
 * `at` is when the speaker is ready to talk: the event's time plus the speaker's delay. Calls with `at` in the future
 * wait for it. A call is evidence, not truth: nothing here reaches the party's minds.
 */

/** What a call is about, most urgent first. */
export type CallKind = "shot" | "moving" | "sighting" | "range" | "wind";
/** Lower goes first. */
export const PRIORITY: Readonly<Record<CallKind, number>> = { shot: 0, moving: 1, sighting: 2, range: 3, wind: 4 };

export const RADIO = {
  /** Words a second (a calm, clear radio call). */
  wordsPerS: 2.5,
  /** A call that has waited longer than this (s) is dropped, unless it is a shot call. */
  staleS: 20,
  /** The squelch tail after the voice, while the key comes up (s). */
  tailS: 0.25,
} as const;

export interface RadioCall {
  kind: CallKind;
  /** What is said, as spoken. */
  text: string;
  /** When the speaker is ready to say it (s, on the caller's clock). */
  at: number;
  /** Who says it (a label for the log), e.g. "veteran" or an observer's name. */
  from?: string;
}

/** A call on the air: when it started and when the channel is free again. */
export interface OnAir {
  call: RadioCall;
  start: number;
  end: number;
}

export type RadioEvent = { type: "start"; call: RadioCall; start: number; end: number } | { type: "drop"; call: RadioCall; at: number };

/** How long a call takes to say (s), squelch tail included. */
export function callDuration(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words / RADIO.wordsPerS + RADIO.tailS;
}

export class Radio {
  private queue: RadioCall[] = [];
  private air: OnAir | null = null;
  /** Everything that went out, in order. */
  readonly log: OnAir[] = [];
  /** Everything dropped as stale. */
  readonly dropped: RadioCall[] = [];

  /** Queues a call. */
  push(call: RadioCall): void {
    this.queue.push(call);
  }

  /** The call on the air at `now`, if any. */
  onAir(now: number): OnAir | null {
    return this.air && now < this.air.end ? this.air : null;
  }

  /** Calls waiting (not yet on the air). */
  waiting(): readonly RadioCall[] {
    return this.queue;
  }

  /** Clears everything waiting (the shooter's "quiet"). What is on the air finishes. */
  quiet(): void {
    this.queue = [];
  }

  /**
   * Advances the channel to `now`: drops what went stale, and puts the next call on the air whenever the channel
   * frees. Steps that skip ahead are caught up call by call, so a long step gives the same order as short ones.
   */
  step(now: number): RadioEvent[] {
    const out: RadioEvent[] = [];
    for (;;) {
      // The channel frees at the end of the call on the air, or now if nothing is.
      const free = this.air ? this.air.end : Number.NEGATIVE_INFINITY;
      if (free > now) break;
      // The earliest moment something can start: when the channel is free and a call is ready.
      const readyAt = Math.min(...this.queue.map((c) => c.at));
      if (!Number.isFinite(readyAt)) break;
      const t = Math.max(free, readyAt);
      if (t > now) break;
      // Stale calls drop at the moment they would have gone out.
      this.queue = this.queue.filter((c) => {
        if (c.kind !== "shot" && c.at <= t && t - c.at > RADIO.staleS) {
          this.dropped.push(c);
          out.push({ type: "drop", call: c, at: t });
          return false;
        }
        return true;
      });
      const ready = this.queue.filter((c) => c.at <= t);
      if (!ready.length) continue;
      ready.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.at - b.at);
      const call = ready[0]!;
      this.queue.splice(this.queue.indexOf(call), 1);
      this.air = { call, start: t, end: t + callDuration(call.text) };
      this.log.push(this.air);
      out.push({ type: "start", call, start: this.air.start, end: this.air.end });
    }
    return out;
  }
}

/** Rounds to the nearest quarter, as a shooter holds. */
export const quarter = (v: number) => Math.round(v * 4) / 4;

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const FRAC: Record<number, string> = { 0.25: "point two five", 0.5: "point five", 0.75: "point seven five" };

/** A hold of whole numbers and quarters, as spoken: 0.5 "point five", 1.25 "one point two five", 2 "two". */
export function sayHold(v: number): string {
  const q = Math.abs(quarter(v));
  const whole = Math.floor(q);
  const frac = q - whole;
  const w = whole < 10 ? ONES[whole]! : String(whole);
  if (frac === 0) return w;
  return whole === 0 ? FRAC[frac]! : `${w} ${FRAC[frac]!}`;
}

/** A range as a spotter says it, digit by digit: 183 "one eight three". */
export const sayRange = (m: number) =>
  String(Math.round(m))
    .split("")
    .map((d) => ONES[Number(d)]!)
    .join(" ");
