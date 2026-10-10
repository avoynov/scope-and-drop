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
 * `bolt-bolt-back.flac`, `svd-charge-release-2.wav` for a second take; see sounds/README.md). Otherwise they
 * are synthesised (synth.ts). The bullet's impacts are synthesised here.
 */
import type { Cue, SoundEvent } from '../../src/scope/handling';
import type { RifleId } from '../../src/scope/shot';
import { render, type Synth } from './synth';

export type ImpactSound = 'plastic' | 'dirt' | 'rock' | 'steel' | 'wood';

export interface Sound {
  enabled: boolean;
  /** Call from a user gesture: browsers only start audio after one. */
  unlock(): void;
  /**
   * The report, `delay` s from now. The SVD's lighter rifle and slotted flash hider make it sharper than the
   * bolt rifle; the VSS is suppressed and subsonic.
   */
  shot(delay: number, rifle: RifleId): void;
  /** A bullet arriving `delay` s from now, `dist` m away. */
  impact(delay: number, dist: number, kind: ImpactSound): void;
  /** One of the rifle's mechanical sounds, `delay` s from now. */
  cue(ev: SoundEvent, rifle: RifleId, delay: number): void;
  /** Working the action: each cue at its time from now. Returns a function that silences what is still to come. */
  cues(list: readonly Cue[], rifle: RifleId): () => void;
  /** One detent of the elevation drum: a small, dry click, right at the ear. */
  drumClick(): void;
}

/** Recordings dropped into sounds/, by file name without the extension. */
const FILES = import.meta.glob('./sounds/*.{wav,flac,ogg,mp3,m4a,opus,webm}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
/** `<rifle>-<sound>` → its takes. A trailing `-2`, `-3`… marks another take of the same sound. */
const TAKES = new Map<string, string[]>();
for (const [path, url] of Object.entries(FILES)) {
  const name = path.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/-\d+$/, '');
  TAKES.set(name, [...(TAKES.get(name) ?? []), url]);
}

/** Where each sound comes from, left (−1) to right (1): the bolt and charging handle are on the right. */
const PAN: Partial<Record<Synth, number>> = {
  'bolt-up': 0.3, 'bolt-back': 0.35, 'bolt-forward': 0.3, 'bolt-down': 0.3, 'case-land': 0.7,
  'charge-back': 0.3, 'charge-release': 0.25, 'carrier-close': 0.15,
};
/**
 * How loud each sound peaks against an open-muzzle report, at the shooter's ear. Every take, recorded or
 * synthesised, is brought to full scale first. The report is some 160 dB and the action 80 to 100 dB, far too
 * wide a gap to play back, so it is narrowed: the action stays well under the shot but can still be heard.
 * The suppressed VSS's report is only about as loud as its own action.
 */
const LEVEL: Record<Synth, number> = {
  shot: 1, 'bolt-up': 0.22, 'bolt-back': 0.3, 'bolt-forward': 0.3, 'bolt-down': 0.25, 'case-land': 0.12,
  'mag-release': 0.12, 'mag-out': 0.2, 'mag-in': 0.3, 'carrier-close': 0.4, 'charge-back': 0.25, 'charge-release': 0.4,
};
const VSS_SHOT = 0.55;
const VARIANTS = 4;

export function createSound(): Sound {
  let ctx: AudioContext | null = null;
  let out: AudioNode;
  let noise: AudioBuffer;
  const recorded = new Map<string, AudioBuffer[]>();
  const synthesised = new Map<string, AudioBuffer>();
  let takes = 0;

  function load(c: AudioContext): void {
    for (const [name, urls] of TAKES) {
      for (const url of urls) {
        void fetch(url)
          .then((r) => r.arrayBuffer())
          .then((a) => c.decodeAudioData(a))
          .then((buf) => recorded.set(name, [...(recorded.get(name) ?? []), normalise(buf)]))
          .catch(() => {});
      }
    }
  }

  /** Scales a recording to peak at full scale, so LEVEL sets its loudness as it does a synthesised one's. */
  function normalise(buf: AudioBuffer): AudioBuffer {
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const x of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(x));
    if (peak > 0) for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i]! /= peak;
    }
    return buf;
  }

  /** A take of a rifle sound: a recording if there is one, otherwise a synthesised variant. */
  function take(ev: Synth, rifle: RifleId): AudioBuffer {
    const c = ctx!;
    const n = takes++;
    const rec = recorded.get(`${rifle}-${ev}`);
    if (rec?.length) return rec[n % rec.length]!;
    const key = `${rifle}|${ev}|${n % VARIANTS}`;
    let buf = synthesised.get(key);
    if (!buf) {
      const d = render(ev, rifle, n % VARIANTS, c.sampleRate);
      buf = c.createBuffer(1, d.length, c.sampleRate);
      buf.copyToChannel(d as Float32Array<ArrayBuffer>, 0);
      synthesised.set(key, buf);
    }
    return buf;
  }

  /** Plays a rifle sound at absolute context time `t`; returns its source so it can be stopped. */
  function play(ev: Synth, rifle: RifleId, t: number): AudioBufferSourceNode {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = take(ev, rifle);
    const v = c.createGain();
    v.gain.value = ev === 'shot' && rifle === 'vss' ? VSS_SHOT : LEVEL[ev];
    let node: AudioNode = src.connect(v);
    const pan = PAN[ev];
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(out);
    src.start(Math.max(t, c.currentTime));
    return src;
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
      if (ctx.state === 'suspended') void ctx.resume();
    },
    shot(delay, rifle) {
      if (!s.enabled || !ctx) return;
      const t = ctx.currentTime + delay;
      play('shot', rifle, t);
      // The hills answer much later; the suppressed VSS is too quiet to come back off them.
      if (rifle !== 'vss') burst(t + 9.2, 0.035, 0.25, 1.6, 'lowpass', 320, 160, 1.2);
    },
    impact(delay, dist, kind) {
      if (!s.enabled || !ctx) return;
      const t = ctx.currentTime + delay;
      // 1/r falls fast: the mannequin's slap at 412 m is faint but distinct; the air takes the treble.
      const g = Math.min(1, 60 / Math.max(60, dist));
      const top = 5200 * Math.exp(-dist / 1500);
      if (kind === 'plastic') {
        burst(t, 2.2 * g, 0.001, 0.07, 'bandpass', Math.min(top, 1100), 700, 0.05);
        tone(t, 210, 160, 1.1 * g, 0.002, 0.09);
      } else if (kind === 'steel') {
        tone(t, 1850, 1840, 1.2 * g, 0.001, 0.45);
        burst(t, 1.1 * g, 0.0005, 0.03, 'bandpass', Math.min(top, 3000), 3000, 0.02);
      } else if (kind === 'rock') {
        burst(t, 1.6 * g, 0.0005, 0.05, 'bandpass', Math.min(top, 1800), 900, 0.04);
      } else if (kind === 'wood') {
        burst(t, 1.5 * g, 0.001, 0.06, 'bandpass', Math.min(top, 700), 500, 0.05);
      } else {
        burst(t, 0.9 * g, 0.004, 0.12, 'lowpass', Math.min(top, 450), 200, 0.1);
      }
    },
    cue(ev, rifle, delay) {
      if (!s.enabled || !ctx) return;
      play(ev, rifle, ctx.currentTime + delay);
    },
    cues(list, rifle) {
      if (!s.enabled || !ctx) return () => {};
      const t0 = ctx.currentTime;
      const srcs = list.map((c) => play(c.ev, rifle, t0 + c.t));
      return () => {
        const now = ctx!.currentTime;
        list.forEach((c, i) => {
          if (t0 + c.t > now) srcs[i]!.stop();
        });
      };
    },
    drumClick() {
      if (!s.enabled || !ctx) return;
      // A spring-loaded ball dropping into the next notch: quieter and higher than the action's clicks.
      burst(ctx.currentTime, 0.12, 0.0003, 0.012, 'bandpass', 5200, 4200, 0.01);
    },
  };
  /** Filtered noise with an attack, an exponential decay, and a cutoff swept from f0 to f1 over `sweep` s. */
  function burst(t: number, gain: number, attack: number, decay: number, type: BiquadFilterType, f0: number, f1: number, sweep: number) {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = type === 'bandpass' ? 1.4 : 0.7;
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
