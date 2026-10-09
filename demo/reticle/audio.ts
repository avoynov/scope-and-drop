/**
 * Sound, synthesised (no samples): the report at the rifle, the bullet's arrival downrange, the action.
 *
 * Sound is what tells a shooter a hit happened before they can see it: the bullet reaches the mannequin at
 * 412 m in about 0.6 s, and the slap of the hit takes another 1.2 s to come back (343 m/s). So "bang …
 * whop" with a 1.8 s gap is a hit; a dull thud or nothing is a miss. The hills about 1.6 km out return a
 * faint rumble some 9 s later.
 */
export type ImpactSound = 'plastic' | 'dirt' | 'rock' | 'steel' | 'wood';

export interface Sound {
  enabled: boolean;
  /** Call from a user gesture: browsers only start audio after one. */
  unlock(): void;
  /** The report, `delay` s from now. The SVD's lighter rifle and slotted flash hider make it the sharper of the two. */
  shot(delay: number, svd: boolean): void;
  /** A bullet arriving `delay` s from now, `dist` m away. */
  impact(delay: number, dist: number, kind: ImpactSound): void;
  /** Working the bolt, or a magazine change, starting now and lasting `dur` s. */
  action(kind: 'bolt' | 'reload', dur: number): void;
}

export function createSound(): Sound {
  let ctx: AudioContext | null = null;
  let out: AudioNode;
  let noise: AudioBuffer;
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
      }
      if (ctx.state === 'suspended') void ctx.resume();
    },
    shot(delay, svd) {
      if (!s.enabled || !ctx) return;
      const t = ctx.currentTime + delay;
      // The blast: broadband, collapsing to low frequencies within a few tens of ms.
      burst(t, 0.9, 0.0005, 0.16, 'lowpass', 12000, 600, 0.09);
      // Crack of the supersonic bullet and the action, at the ear at the same moment.
      burst(t, svd ? 0.55 : 0.4, 0.0002, 0.025, 'highpass', 2500, 2500, 0.02);
      // Body: the low thump felt as much as heard.
      tone(t, 70, 38, svd ? 0.9 : 0.75, 0.002, 0.22);
      // Desert: little reverb, a short roll off the ground.
      burst(t + 0.03, 0.12, 0.05, 0.9, 'lowpass', 900, 250, 0.6);
      // The hills answer much later.
      burst(t + 9.2, 0.035, 0.25, 1.6, 'lowpass', 320, 160, 1.2);
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
    action(kind, dur) {
      if (!s.enabled || !ctx) return;
      const t = ctx.currentTime;
      // Metal on metal: short clicks at the moments the parts stop.
      const at = kind === 'bolt' ? [0.12, 0.3, 0.62, 0.86] : [0.25, 0.4, 0.62, 0.78, 0.9, 0.95];
      for (const f of at) burst(t + f * dur, 0.35, 0.0005, 0.03, 'bandpass', 3200, 2400, 0.02);
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
