/**
 * The spotter's voice in the earpiece, keyed like a radio. For the scope lab and the party lab alike; the queue and
 * its rules are src/scope/radio.ts, this only makes the sound.
 *
 * A handheld radio passes about 300–3,400 Hz (the telephone band) and ends each call with a burst of squelch noise as
 * the key comes up. Two voices:
 *  - Recorded words: one file per word in demo/shared/radio-words/ (`wind.wav`, `point.wav`, `five.wav`; see the
 *    README there). When every word of a call has a recording, the call is played word by word through the band-pass
 *    with a little overdrive, as a radio would pass it.
 *  - Otherwise browser speech synthesis. Browsers give no way to route it through Web Audio, so a filter can't reach
 *    that voice: it plays as the browser speaks it.
 * Either way the radio around it (the key-down click, a faint hiss in the band while the key is down, the squelch
 * tail) is band-passed noise on the given bus.
 */

/** Where the radio plays: an audio context and the node to play into (e.g. Sound.radioBus() in the scope lab). */
export type RadioBus = () => { ctx: AudioContext; out: AudioNode } | null;

export interface RadioVoice {
  /** Says `text` now, the key held for about `durS` s (the radio's own estimate) and the squelch tail after. */
  say(text: string, durS: number): void;
  /** Cuts the voice off (the lab closing, the shooter's "quiet"). */
  quiet(): void;
}

/** Recorded words, by file name without the extension (lower case). */
const WORD_FILES = import.meta.glob("./radio-words/*.{wav,flac,ogg,mp3,m4a,opus,webm}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const WORD_URLS = new Map(
  Object.entries(WORD_FILES).map(([path, url]) => [
    path
      .replace(/^.*\//, "")
      .replace(/\.[^.]+$/, "")
      .toLowerCase(),
    url,
  ]),
);
/** A call's words as the files are named: lower case, punctuation gone; a comma is a short pause (""). */
export const callWords = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/,/g, " , ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === "," ? "" : w.replace(/[^a-z0-9']/g, "")))
    .filter((w, i, a) => w !== "" || (i > 0 && a[i - 1] !== ""));

/** The radio's pass band (Hz). */
export const BAND = [300, 3400] as const;
/** Speech rate against the browser's default (about 3 words a second), for about 2.5. */
const RATE = 0.85;

export function createRadioVoice(bus: RadioBus): RadioVoice {
  let noise: AudioBuffer | null = null;
  const words = new Map<string, AudioBuffer>();
  let loading = false;
  /** Fetches and decodes the recorded words once there is an audio context. */
  function load(ctx: AudioContext): void {
    if (loading) return;
    loading = true;
    for (const [w, url] of WORD_URLS)
      void fetch(url)
        .then((r) => r.arrayBuffer())
        .then((a) => ctx.decodeAudioData(a))
        .then((buf) => words.set(w, buf))
        .catch(() => {});
  }

  /** Plays recorded words from `t` through the radio's band and a soft clip; returns when the voice ends. */
  function playWords(ctx: AudioContext, out: AudioNode, list: string[], t: number): number {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = BAND[0];
    hp.Q.value = 0.9;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = BAND[1];
    lp.Q.value = 0.9;
    const clip = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(2.2 * ((i / (curve.length - 1)) * 2 - 1)) / Math.tanh(2.2);
    clip.curve = curve;
    const v = ctx.createGain();
    v.gain.value = 0.5;
    hp.connect(lp).connect(clip).connect(v).connect(out);
    let at = t;
    for (const w of list) {
      if (w === "") {
        at += 0.18;
        continue;
      }
      const buf = words.get(w)!;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(hp);
      src.start(at);
      at += buf.duration + 0.04;
    }
    return at;
  }
  const speech = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

  function noiseOf(ctx: AudioContext): AudioBuffer {
    if (noise && noise.sampleRate === ctx.sampleRate) return noise;
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noise;
  }

  /** Band-limited noise from `t` for `dur` s at `gain`, with a short fade at each end. */
  function hiss(ctx: AudioContext, out: AudioNode, t: number, dur: number, gain: number, fade = 0.01): void {
    const src = ctx.createBufferSource();
    src.buffer = noiseOf(ctx);
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = BAND[0];
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = BAND[1];
    const v = ctx.createGain();
    v.gain.setValueAtTime(0, t);
    v.gain.linearRampToValueAtTime(gain, t + fade);
    v.gain.setValueAtTime(gain, t + Math.max(fade, dur - fade));
    v.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(hp).connect(lp).connect(v).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  return {
    say(text, durS) {
      const b = bus();
      const tail = () => {
        const bb = bus();
        if (bb) hiss(bb.ctx, bb.out, bb.ctx.currentTime, 0.22, 0.09, 0.004);
      };
      const list = callWords(text);
      if (b) {
        load(b.ctx);
        const t = b.ctx.currentTime;
        // The key going down: a click.
        hiss(b.ctx, b.out, t, 0.02, 0.06, 0.002);
        if (list.every((w) => w === "" || words.has(w))) {
          const end = playWords(b.ctx, b.out, list, t + 0.08);
          // The carrier's faint hiss under the voice, then the squelch tail as the key comes up.
          hiss(b.ctx, b.out, t + 0.02, end - t, 0.012);
          hiss(b.ctx, b.out, end, 0.22, 0.09, 0.004);
          return;
        }
        hiss(b.ctx, b.out, t + 0.02, Math.max(0.3, durS), 0.012);
      }
      if (!speech) {
        setTimeout(tail, durS * 1000);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = RATE;
      u.pitch = 0.9;
      u.lang = "en-GB";
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        tail();
      };
      u.onend = end;
      u.onerror = end;
      // If the browser never says it ended, the key still comes up.
      setTimeout(end, (durS + 2) * 1000);
      speech.speak(u);
    },
    quiet() {
      speech?.cancel();
    },
  };
}
