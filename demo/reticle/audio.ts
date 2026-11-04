/**
 * Sound: the report at the rifle, the bullet's arrival downrange, and the action worked by hand.
 *
 * Sound is what tells a shooter a hit happened before they can see it: the bullet reaches the mannequin at
 * 412 m in about 0.6 s, and the slap of the hit takes another 1.2 s to come back (343 m/s). So "bang …
 * whop" with a 1.8 s gap is a hit; a dull thud or nothing is a miss. The hills about 1.6 km out return a
 * faint rumble some 9 s later. The suppressed VSS is the other way round: its report is a dull thump and
 * the clack of the action, and the slap of a hit at 183 m (1.2 s later) is the loudest thing the shooter hears.
 *
 * The rifle's own sounds (the shot and every part of the bolt cycle and magazine change, see SoundEvent) play
 * a recording when there is one in demo/reticle/sounds/ named `<rifle>-<sound>.<ext>` (`vss-shot.wav`,
 * `bolt-cycle.wav`, `svd-charge-release-2.wav` for a second take; see sounds/README.md), or else one named
 * `any-<sound>` that serves every rifle. Otherwise they are synthesised (synth.ts). Recordings play as they are;
 * where one holds a few moments (a whole bolt cycle), the game is timed to it (src/scope/recorded.ts). The
 * bullet's impacts are synthesised here.
 */
import type { Cue, SoundEvent } from "../../src/scope/handling";
import type { Report } from "../../src/scope/can";
import type { RifleId } from "../../src/scope/shot";
import { BOLT_TAKES } from "../../src/scope/recorded";
import { render, type Synth } from "./synth";

export type ImpactSound = "plastic" | "dirt" | "rock" | "steel" | "wood" | "glass" | "tempered";

export interface Sound {
  enabled: boolean;
  /** Call from a user gesture: browsers only start audio after one. */
  unlock(): void;
  /**
   * The report, `delay` s from now. The SVD's lighter rifle and slotted flash hider make it sharper than the
   * bolt rifle; the VSS is suppressed and subsonic. `report` is what is on the muzzle (a can makes a supersonic
   * round a boom and a crack, a subsonic one a pop); `pop` is a can's first shot on fresh air, a little louder.
   */
  shot(delay: number, rifle: RifleId, report?: Report, pop?: boolean): void;
  /** A bullet arriving `delay` s from now, `dist` m away. */
  impact(delay: number, dist: number, kind: ImpactSound): void;
  /** One of the rifle's mechanical sounds, `delay` s from now. */
  cue(ev: SoundEvent, rifle: RifleId, delay: number): void;
  /** Working the action: each cue at its time from now. Returns a function that silences what is still to come. */
  cues(list: readonly Cue[], rifle: RifleId): () => void;
  /** One detent of the elevation drum: a small, dry click, right at the ear. */
  drumClick(): void;
  /**
   * The radio's bus: the spotter's earpiece (demo/shared/radio-voice.ts) plays into it, under the same limiter as the
   * rifle. Null until the audio is unlocked.
   */
  radioBus(): { ctx: AudioContext; out: AudioNode } | null;
}

/** Recordings dropped into sounds/, by file name without the extension. */
const FILES = import.meta.glob("./sounds/*.{wav,flac,ogg,mp3,m4a,opus,webm}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
/**
 * `<rifle>-<sound>` (or `any-<sound>`) → its takes, in order: a trailing `-2`, `-3`… marks the second, third…
 * take, which matters where the game is timed to one (recorded.ts).
 */
const TAKES = new Map<string, string[]>();
for (const [path, url] of Object.entries(FILES)) {
  const file = path.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  const n = /-(\d+)$/.exec(file);
  const name = n ? file.slice(0, -n[0].length) : file;
  const list = TAKES.get(name) ?? [];
  list[n ? Number(n[1]) - 1 : 0] = url;
  TAKES.set(name, list);
}

/**
 * Where a recording's moment falls in its file (s): it starts that long before its cue. The magazine catch
 * clicks at 0.025 s into `any-mag-out`, and the catch snaps over 0.36 s into `any-mag-in`, which is when the
 * magazine is home: 0.15 s after the plan's `mag-in` cue.
 */
const ANCHOR: Record<string, number> = { "any-mag-out": 0.025, "any-mag-in": 0.21 };
/** A recording that holds another sound too: `any-mag-out` starts with the catch pressed, so it takes that cue's place. */
const COVERS: Partial<Record<Synth, Synth>> = { "mag-out": "mag-release" };

/** Where each sound comes from, left (−1) to right (1): the bolt and charging handle are on the right. */
const PAN: Partial<Record<Sfx, number>> = {
  cycle: 0.3,
  "bolt-up": 0.3,
  "bolt-back": 0.35,
  "bolt-forward": 0.3,
  "bolt-down": 0.3,
  "case-land": 0.7,
  "charge-back": 0.3,
  "charge-release": 0.25,
  "dry-fire": 0.1,
  trigger: 0.1,
  safety: 0.25,
  "safety-stop": 0.3,
};
/**
 * How loud each sound peaks against an open-muzzle report, at the shooter's ear. Every take, recorded or
 * synthesised, is brought to full scale first. The report is some 160 dB and the action 80 to 100 dB, far too
 * wide a gap to play back, so it is narrowed: the action stays well under the shot but can still be heard.
 * The suppressed VSS's report is only about as loud as its own action.
 */
const LEVEL: Record<Sfx, number> = {
  shot: 1,
  cycle: 0.3,
  "shot-can": 0.62,
  "shot-sub": 0.4,
  "bolt-up": 0.22,
  "bolt-back": 0.3,
  "bolt-forward": 0.3,
  "bolt-down": 0.25,
  "case-land": 0.12,
  "mag-release": 0.12,
  "mag-out": 0.2,
  "mag-in": 0.3,
  "charge-back": 0.25,
  "charge-release": 0.4,
  "dry-fire": 0.22,
  trigger: 0.06,
  safety: 0.14,
  "safety-stop": 0.18,
};
const VSS_SHOT = 0.55;
/** First-round pop: the oxygen in a can that has stood a while burns with the first shot's gas, some 3 dB louder. */
const POP_GAIN = 1.4;
const VARIANTS = 4;
/** Every sound: the synthesiser's, and a whole bolt cycle that only a recording has. */
type Sfx = Synth | "cycle";
/** A sound set going, and when it starts. */
type Started = { src: AudioBufferSourceNode; at: number };

export function createSound(): Sound {
  let ctx: AudioContext | null = null;
  let out: AudioNode;
  let noise: AudioBuffer;
  /** Takes by name, in take order; a slot is empty until its file has loaded. */
  const recorded = new Map<string, (AudioBuffer | undefined)[]>();
  const synthesised = new Map<string, AudioBuffer>();
  let takes = 0;
  let radio: GainNode | null = null;

  function load(c: AudioContext): void {
    for (const [name, urls] of TAKES) {
      const slots: (AudioBuffer | undefined)[] = [];
      recorded.set(name, slots);
      urls.forEach((url, i) => {
        void fetch(url)
          .then((r) => r.arrayBuffer())
          .then((a) => c.decodeAudioData(a))
          .then((buf) => (slots[i] = normalise(buf)))
          .catch(() => {});
      });
    }
  }

  /** Scales a recording to peak at full scale, so LEVEL sets its loudness as it does a synthesised one's. */
  function normalise(buf: AudioBuffer): AudioBuffer {
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const x of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(x));
    if (peak > 0)
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i]! /= peak;
      }
    return buf;
  }

  /** The loaded takes of a sound for `rifle`, and the name they go by: its own, or the one every rifle shares. */
  function recording(ev: Sfx, rifle: RifleId): { name: string; bufs: (AudioBuffer | undefined)[] } | null {
    for (const name of [`${rifle}-${ev}`, `any-${ev}`]) {
      const bufs = recorded.get(name);
      if (bufs?.some(Boolean)) return { name, bufs };
    }
    return null;
  }

  /**
   * A take of a rifle sound: recording number `which` if asked for and loaded, else the next loaded one in turn,
   * else a synthesised variant. With its anchor: how far into it its moment falls.
   */
  function take(ev: Synth, rifle: RifleId, which?: number): { buf: AudioBuffer; at: number } {
    const c = ctx!;
    const n = takes++;
    const rec = recording(ev, rifle);
    if (rec) {
      const loaded = rec.bufs.filter((b): b is AudioBuffer => !!b);
      return { buf: (which !== undefined && rec.bufs[which]) || loaded[n % loaded.length]!, at: ANCHOR[rec.name] ?? 0 };
    }
    const key = `${rifle}|${ev}|${n % VARIANTS}`;
    let buf = synthesised.get(key);
    if (!buf) {
      const d = render(ev, rifle, n % VARIANTS, c.sampleRate);
      buf = c.createBuffer(1, d.length, c.sampleRate);
      buf.copyToChannel(d as Float32Array<ArrayBuffer>, 0);
      synthesised.set(key, buf);
    }
    return { buf, at: 0 };
  }

  /**
   * Plays a rifle sound so its moment falls at absolute context time `t` (`which`: the take the plan was timed
   * to); returns its sources so they can be stopped. A bolt cycle with no recording loaded plays the four
   * synthesised pieces at the recorded take's moments.
   */
  function play(ev: Sfx, rifle: RifleId, t: number, gain = 1, which?: number): Started[] {
    if (ev === "cycle") {
      const rec = recording("cycle", rifle)?.bufs[which ?? 0];
      if (rec) return [source(ev, rifle, rec, t, gain)];
      const T = BOLT_TAKES[rifle]?.[which ?? 0];
      if (!T) return [];
      return [
        ...play("bolt-up", rifle, t + T.up, gain),
        ...play("bolt-back", rifle, t + T.back - 0.12, gain),
        ...play("bolt-forward", rifle, t + T.home - 0.18, gain),
        ...play("bolt-down", rifle, t + T.down, gain),
      ];
    }
    const { buf, at } = take(ev, rifle, which);
    return [source(ev, rifle, buf, t - at, gain)];
  }

  function source(ev: Sfx, rifle: RifleId, buf: AudioBuffer, t: number, gain: number): Started {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = buf;
    const v = c.createGain();
    v.gain.value = (ev === "shot" && rifle === "vss" ? VSS_SHOT : LEVEL[ev]) * gain;
    let node: AudioNode = src.connect(v);
    const pan = PAN[ev];
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(out);
    // Already under way (its anchor is before now): start it partway in, where it would have got to.
    const now = c.currentTime;
    src.start(Math.max(t, now), Math.max(0, now - t));
    return { src, at: Math.max(t, now) };
  }

  const s: Sound = {
    enabled: true,
    unlock() {
      if (!ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        // A gentle limiter keeps the report loud without clipping.
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.ratio.value = 8;
        comp.attack.value = 0.001;
        comp.release.value = 0.2;
        const master = ctx.createGain();
        master.gain.value = 0.55;
        comp.connect(master).connect(ctx.destination);
        out = comp;
        noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        load(ctx);
      }
      if (ctx.state === "suspended") void ctx.resume();
    },
    shot(delay, rifle, report = rifle === "vss" ? "integral" : "open", pop = false) {
      if (!s.enabled || !ctx) return;
      const t = ctx.currentTime + delay;
      play(report === "can" ? "shot-can" : report === "can-sub" ? "shot-sub" : "shot", rifle, t, pop ? POP_GAIN : 1);
      // The hills answer much later. A can on a supersonic round leaves the bullet's crack, which still comes
      // back off them, fainter; a subsonic round through a can, like the VSS, is too quiet to come back.
      if (report === "open") burst(t + 9.2, 0.035, 0.25, 1.6, "lowpass", 320, 160, 1.2);
      else if (report === "can") burst(t + 9.2, 0.02, 0.25, 1.4, "lowpass", 420, 200, 1.2);
    },
    impact(delay, dist, kind) {
      if (!s.enabled || !ctx) return;
      const t = ctx.currentTime + delay;
      // 1/r falls fast: the mannequin's slap at 412 m is faint but distinct; the air takes the treble.
      const g = Math.min(1, 60 / Math.max(60, dist));
      const top = 5200 * Math.exp(-dist / 1500);
      if (kind === "plastic") {
        burst(t, 2.2 * g, 0.001, 0.07, "bandpass", Math.min(top, 1100), 700, 0.05);
        tone(t, 210, 160, 1.1 * g, 0.002, 0.09);
      } else if (kind === "steel") {
        tone(t, 1850, 1840, 1.2 * g, 0.001, 0.45);
        burst(t, 1.1 * g, 0.0005, 0.03, "bandpass", Math.min(top, 3000), 3000, 0.02);
      } else if (kind === "rock") {
        burst(t, 1.6 * g, 0.0005, 0.05, "bandpass", Math.min(top, 1800), 900, 0.04);
      } else if (kind === "wood") {
        burst(t, 1.5 * g, 0.001, 0.06, "bandpass", Math.min(top, 700), 500, 0.05);
      } else if (kind === "glass" || kind === "tempered") {
        // A pane breaking: a hard, bright snap, then shards ringing as they hit the sill and the ground. Tempered
        // glass lets go all at once and pours out of its frame in a rush of little dice.
        const all = kind === "tempered";
        burst(t, (all ? 2.2 : 1.7) * g, 0.0003, 0.03, "highpass", Math.min(top, 2600), 1600, 0.02);
        for (let i = 0; i < (all ? 24 : 9); i++) {
          const f = 2600 + 4200 * Math.random();
          // The air takes the treble: rings above `top` fade with distance.
          const air = f > top ? (top / f) ** 2 : 1;
          tone(t + 0.04 + (all ? 0.9 : 0.45) * Math.random() ** 1.5, f, f * 0.985, (0.12 + 0.2 * Math.random()) * g * air, 0.0005, 0.03 + 0.05 * Math.random());
        }
        if (all) burst(t + 0.1, 0.6 * g, 0.06, 0.55, "highpass", Math.min(top, 3600), 2400, 0.5);
      } else {
        burst(t, 0.9 * g, 0.004, 0.12, "lowpass", Math.min(top, 450), 200, 0.1);
      }
    },
    cue(ev, rifle, delay) {
      if (!s.enabled || !ctx) return;
      play(ev, rifle, ctx.currentTime + delay);
    },
    cues(list, rifle) {
      if (!s.enabled || !ctx) return () => {};
      const t0 = ctx.currentTime;
      // A recording that holds another cue's sound too plays from that cue, in its place.
      const merged: Cue[] = [];
      for (const c of list) {
        const by = (Object.keys(COVERS) as Synth[]).find((k) => COVERS[k] === c.ev && list.some((o) => o.ev === k) && recording(k, rifle));
        if (by) continue;
        const covered = c.ev !== "cycle" ? COVERS[c.ev] : undefined;
        const first = covered && recording(c.ev, rifle) ? list.find((o) => o.ev === covered) : undefined;
        merged.push(first ? { ...c, t: first.t } : c);
      }
      const started = merged.flatMap((c) => play(c.ev, rifle, t0 + c.t, c.gain ?? 1, c.take));
      return () => {
        // Hushed: whatever has not started yet never does. What is already sounding plays out.
        const now = ctx!.currentTime;
        for (const { src, at } of started) if (at > now) src.stop();
      };
    },
    radioBus() {
      if (!ctx) return null;
      if (!radio) {
        radio = ctx.createGain();
        radio.connect(out);
      }
      radio.gain.value = s.enabled ? 1 : 0;
      return { ctx, out: radio };
    },
    drumClick() {
      if (!s.enabled || !ctx) return;
      // A spring-loaded ball dropping into the next notch: quieter and higher than the action's clicks.
      burst(ctx.currentTime, 0.12, 0.0003, 0.012, "bandpass", 5200, 4200, 0.01);
    },
  };
  /** Filtered noise with an attack, an exponential decay, and a cutoff swept from f0 to f1 over `sweep` s. */
  function burst(t: number, gain: number, attack: number, decay: number, type: BiquadFilterType, f0: number, f1: number, sweep: number) {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = type === "bandpass" ? 1.4 : 0.7;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + sweep);
    const v = c.createGain();
    v.gain.setValueAtTime(0, t);
    v.gain.linearRampToValueAtTime(gain, t + attack);
    v.gain.setTargetAtTime(0, t + attack, decay / 3);
    src.connect(f).connect(v).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay * 3 + 0.05);
  }
  function tone(t: number, f0: number, f1: number, gain: number, attack: number, decay: number) {
    const c = ctx!;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + decay);
    const v = c.createGain();
    v.gain.setValueAtTime(0, t);
    v.gain.linearRampToValueAtTime(gain, t + attack);
    v.gain.setTargetAtTime(0, t + attack, decay / 3);
    o.connect(v).connect(out);
    o.start(t);
    o.stop(t + attack + decay * 3 + 0.05);
  }
  return s;
}
