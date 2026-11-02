/**
 * Observers on other bearings (armoury task 7): hire one or two spotters on the treeline arc, give them orders on
 * the radio wheel (watch whoever is picked, report a room, quiet), and read the radio log; at real time the calls are
 * spoken (demo/shared/radio-voice.ts). The calls are evidence, never truth, and nothing in the evening hears them.
 *
 *   obs=rookie@-25,veteran@25   observers by tier and bearing (deg off the garden axis, within ±38)
 *   watch=12@40                 both watch person 12 from 19:40 (an order given then, as the wheel would)
 *
 * Orders are kept with their times, so a seek back replays the same evening with the same calls.
 */
import { MAX_SPOTTERS, SPOTTERS, type SpotterTier } from "../../src/armoury/catalogue";
import type { MansionBlueprint } from "../../src/mansion/core/types";
import { PERCH_ARC_DEG } from "../../src/mansion/site/perch";
import type { Party } from "../../src/party";
import { clockLabel } from "../../src/party/clock";
import { SEEN, type ObserverCall, type ObserverHire, type ObserverOptions, type ObserverOrder } from "../../src/party/observers";
import { createRadioVoice, type RadioVoice } from "../shared/radio-voice";

const TIERS = Object.keys(SPOTTERS) as SpotterTier[];
/** How many radio lines the panel keeps. */
const LOG_LINES = 6;

export class ObserveLab {
  private hires: ObserverHire[] = [];
  private orders: ObserverOrder[] = [];
  private to = -1;
  private room = -1;
  private quiet = false;
  private voice: RadioVoice | null = null;
  private ctx: AudioContext | null = null;
  private voiced = 0;
  private wheel!: HTMLElement;
  private rooms!: HTMLSelectElement;
  private target!: HTMLSelectElement;
  private quietBtn!: HTMLButtonElement;
  private watchBtn!: HTMLButtonElement;
  private voiceBox!: HTMLInputElement;
  private hireEls: [HTMLSelectElement, HTMLInputElement][] = [];
  private first = true;

  constructor(
    params: URLSearchParams,
    private readonly host: { party(): Party; bp(): MansionBlueprint; selected(): number; rebuild(): void; changed(): void; realTime(): boolean },
    private readonly root: HTMLElement,
    private readonly log: HTMLElement,
  ) {
    for (const s of (params.get("obs") ?? "").split(",").filter(Boolean)) {
      const [tier, az] = s.split("@");
      if (!TIERS.includes(tier as SpotterTier) || this.hires.length >= MAX_SPOTTERS) continue;
      this.hires.push({ tier: tier as SpotterTier, azDeg: clampAz(Number(az ?? 0)) });
    }
    const w = /^(\d+)@(\d+(?:\.\d+)?)$/.exec(params.get("watch") ?? "");
    if (w) this.orders.push({ t: Number(w[2]) * 60, to: -1, kind: "watch", who: Number(w[1]) });
    this.build();
  }

  /** The observers for a new evening (none hired: none), with the orders given so far. */
  option(): ObserverOptions | undefined {
    return this.hires.length ? { hires: this.hires.map((h) => ({ ...h })), orders: [...this.orders] } : undefined;
  }

  /** A new evening: the voice starts from its first call again. */
  reset(): void {
    this.voiced = 0;
    this.voice?.quiet();
  }

  /** The house changed: rooms to report on, and the old house's orders are gone. */
  newHouse(): void {
    // The URL's orders are for the house it names, the first one built.
    if (!this.first) this.orders = [];
    this.first = false;
    this.fillRooms();
  }

  private build(): void {
    const r = this.root;
    r.textContent = "";
    const rows: HTMLElement[] = [];
    for (let i = 0; i < MAX_SPOTTERS; i++) {
      const hire = row();
      rows.push(hire);
      const tier = document.createElement("select");
      tier.setAttribute("aria-label", `Observer ${i + 1}`);
      tier.add(new Option("—", ""));
      for (const t of TIERS) tier.add(new Option(t, t));
      tier.value = this.hires[i]?.tier ?? "";
      const az = document.createElement("input");
      az.type = "number";
      az.min = String(-PERCH_ARC_DEG);
      az.max = String(PERCH_ARC_DEG);
      az.step = "1";
      az.value = String(this.hires[i]?.azDeg ?? (i ? 25 : -25));
      az.title = `Bearing off the garden axis (°, ±${PERCH_ARC_DEG}: the treeline arc, at ground level)`;
      az.setAttribute("aria-label", `Observer ${i + 1} bearing`);
      const change = () => {
        const list: ObserverHire[] = [];
        for (const [t, a] of this.hireEls) if (t.value) list.push({ tier: t.value as SpotterTier, azDeg: clampAz(Number(a.value)) });
        this.hires = list;
        this.syncUrl();
        this.host.rebuild();
        this.refresh();
      };
      tier.onchange = change;
      az.onchange = change;
      this.hireEls.push([tier, az]);
      hire.append(label(i ? "observer two" : "observer one"), tier, label("at"), az, label("°"));
    }
    this.wheel = row();
    this.target = document.createElement("select");
    this.target.setAttribute("aria-label", "Who the order is for");
    this.target.onchange = () => (this.to = Number(this.target.value));
    this.watchBtn = button("watch", "Watch whoever is picked: they call when the person moves to another room, goes out of view or comes back", () => {
      const who = this.host.selected();
      if (who >= 0) this.give({ kind: "watch", who });
    });
    this.rooms = document.createElement("select");
    this.rooms.setAttribute("aria-label", "Room to report on");
    this.rooms.onchange = () => (this.room = Number(this.rooms.value));
    const report = button("report", "Report the room: who they can make out in it", () => this.give({ kind: "report", room: this.room }));
    this.quietBtn = button("quiet", "Quiet: clears what is waiting, and they keep sightings to themselves (the watched and the shot still go out)", () => {
      this.quiet = !this.quiet;
      this.give({ kind: "quiet", on: this.quiet });
    });
    const voice = document.createElement("label");
    voice.title = "Speak the calls at real time (the slowest speed)";
    this.voiceBox = document.createElement("input");
    this.voiceBox.type = "checkbox";
    this.voiceBox.checked = true;
    this.voiceBox.onchange = () => {
      if (this.voiceBox.checked) this.audio();
      else this.voice?.quiet();
    };
    voice.append(this.voiceBox, " voice");
    this.wheel.append(label("radio"), this.target, this.watchBtn, this.rooms, report, this.quietBtn, voice);
    r.append(...rows, this.wheel);
    this.refresh();
  }

  private fillRooms(): void {
    const bp = this.host.bp();
    this.rooms.textContent = "";
    this.rooms.add(new Option("the terrace", "-2"));
    for (const r of bp.rooms) this.rooms.add(new Option(r.label.toLowerCase(), String(r.index)));
    this.room = Number(this.rooms.value);
  }

  /** The wheel shows only with someone hired; the order goes to all of them or one. */
  private refresh(): void {
    this.wheel.hidden = !this.hires.length;
    this.target.textContent = "";
    if (this.hires.length > 1) this.target.add(new Option("both", "-1"));
    this.hires.forEach((h, i) => this.target.add(new Option(`${["One", "Two"][i]} (${h.tier})`, String(i))));
    if (this.to >= this.hires.length || (this.hires.length === 1 && this.to < 0)) this.to = this.hires.length > 1 ? -1 : 0;
    this.target.value = String(this.to);
    this.quietBtn.textContent = this.quiet ? "carry on" : "quiet";
  }

  private give(o: { kind: "watch"; who: number } | { kind: "report"; room: number } | { kind: "quiet"; on: boolean }): void {
    const party = this.host.party();
    if (!party.observers) return;
    this.audio();
    const order = { ...o, t: party.t, to: this.to } as ObserverOrder;
    this.orders.push(order);
    party.observers.order(order);
    this.refresh();
    this.host.changed();
  }

  /** The audio context starts on a click (browsers allow sound only after one). */
  private audio(): void {
    if (!this.voiceBox.checked) return;
    if (!this.ctx && typeof AudioContext !== "undefined") this.ctx = new AudioContext();
    void this.ctx?.resume();
    this.voice ??= createRadioVoice(() => (this.ctx ? { ctx: this.ctx, out: this.ctx.destination } : null));
  }

  /** After the evening steps: speak what just went on the air, at real time only (faster, the log keeps it). */
  stepped(party: Party): void {
    const o = party.observers;
    if (!o) return;
    const log = o.radio.log;
    for (; this.voiced < log.length; this.voiced++) {
      const a = log[this.voiced]!;
      if (this.voice && this.voiceBox.checked && this.host.realTime() && party.t - a.start < 2) this.voice.say(a.call.text, a.end - a.start);
    }
  }

  /** The radio log: what went out (and what was dropped as stale), newest first, and who is watched. */
  render(party: Party): void {
    const o = party.observers;
    this.log.hidden = !o;
    if (!o) return;
    const lines: { t: number; text: string }[] = [];
    for (const a of o.radio.log) if (a.start <= party.t) lines.push({ t: a.start, text: `${party.t < a.end ? "▶ " : ""}${(a.call as ObserverCall).text}` });
    for (const c of o.radio.dropped) lines.push({ t: (c as ObserverCall).at, text: `(dropped, waited too long) ${c.text}` });
    lines.sort((a, b) => b.t - a.t);
    const head = o.list
      .map((ob, i) => {
        const p = ob.watch >= 0 ? party.people[ob.watch] : undefined;
        const v = p ? o.sees(i, p) : 0;
        return `${o.label(i)}${p ? `: watching ${p.name}, ${v >= SEEN ? "in view" : "out of view"}` : ""}${ob.quiet ? " · quiet" : ""} · ${ob.stats.calls} calls`;
      })
      .join("\n");
    const waiting = o.radio.waiting().length;
    this.log.textContent = `${head}${waiting ? `\n${waiting} waiting to speak` : ""}\n${lines
      .slice(0, LOG_LINES)
      .map((l) => `${clockLabel(l.t)}  ${l.text}`)
      .join("\n")}`;
    this.watchBtn.disabled = this.host.selected() < 0;
  }

  private syncUrl(): void {
    const url = new URL(location.href);
    if (this.hires.length) url.searchParams.set("obs", this.hires.map((h) => `${h.tier}@${h.azDeg}`).join(","));
    else url.searchParams.delete("obs");
    history.replaceState(null, "", url);
  }
}

const clampAz = (a: number) => (Number.isFinite(a) ? Math.max(-PERCH_ARC_DEG, Math.min(PERCH_ARC_DEG, Math.round(a))) : 0);

function row(): HTMLElement {
  const r = document.createElement("div");
  r.className = "row";
  return r;
}

function label(text: string): HTMLElement {
  const l = document.createElement("span");
  l.className = "label";
  l.textContent = text;
  return l;
}

function button(text: string, title: string, onclick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  b.title = title;
  b.onclick = onclick;
  return b;
}
