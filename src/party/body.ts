/**
 * What happens to people's bodies over the evening: bathroom visits with real doors and a
 * queue, drinks poured, sipped and set down, tipsiness, and people walking into each other
 * (milestone 2 plan: Bathrooms, drinks and tipsiness).
 */
import type { Rng } from "../mansion/core/rng";
import { TIME_SCALE } from "./clock";
import type { Pathfinder } from "./path";
import type { Places } from "./places";
import type { SoundKind } from "./senses";
import { ALCOHOL, DRINKS, type DrinkId, type PartyEvent, type Person, type Spot } from "./types";
import { AJAR, DRINK_IDS, type World } from "./world";

/** What the body systems need from the party. */
export interface BodyHost {
  readonly t: number;
  readonly people: Person[];
  readonly places: Places;
  readonly world: World;
  readonly pf: Pathfinder;
  /** The record the spy lives in, or -1: it sips slowly, leaves glasses half drunk and turns to water early. */
  readonly spyId: number;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
  /** Walk to a spot as part of the current action (it stays unstarted until they arrive); false when there is no way. */
  goTo(p: Person, s: Spot): boolean;
  end(p: Person, done: boolean): void;
  /** Make a sound at a point (a knock, a bolt drawn). */
  sound(kind: SoundKind, at: { level: number; x: number; z: number; room: number }, source: number, ref?: number): void;
  /** Someone walked into someone (the bonds weigh a sorry against a grudge). */
  bumped?(fast: Person, hit: Person, slop: boolean): void;
}

/** How long a drink lasts in hand (in-game s): sipped from full to empty. */
export const DRINK_LIFE: Record<DrinkId, number> = { champagne: 1500, red: 900, white: 900, beer: 900, whisky: 700, water: 600 };
/** The spy sips at this share of the usual rate, sets a glass down once it has held it this long (in-game s), and asks for water past this tipsiness. */
const SPY_SIP = 0.4;
const SPY_HOLD = 600;
const SPY_WATER = 0.15;
/** A bathroom seen taken is skipped for this long, unless the need is urgent. */
const SEEN_FOR = 180;
/** Bladder level below which someone queues rather than tries elsewhere. */
const QUEUE_BELOW = 0.35;
/** Bladder level below which a bathroom known to be taken is tried anyway. */
const URGENT = 0.2;
/** Tipsiness lost per in-game second (0.05 an hour). */
const SOBER_RATE = 0.05 / 3600;
/** Overlap and closing speed (real m/s) that make a bump. */
const BUMP_OVERLAP = 0.08;
const BUMP_SPEED = 0.6;
const PERSON_R = 0.42;

export interface BathState {
  /** Who is inside or on their way in (-1 nobody). */
  occupant: number;
  /** Waiting outside, first in line first; at most two. */
  queue: number[];
  /** When the person at the front of the queue got there, and whether they have knocked. */
  frontSince: number;
  knocked: boolean;
  /** The spy has it for a body (milestone 3, spy/kill.ts): taken to anyone who comes, until it lets it go (-1 not). */
  hold: number;
}

interface Counter {
  /** Bar spots belonging to this counter (indices into places.bars). */
  spots: number[];
  queue: number[];
  pouring: number;
  until: number;
}

export class Body {
  readonly baths: BathState[];
  readonly stats = { taken: 0, knocks: 0, queued: 0, gaveUp: 0, bumps: 0, slops: 0, pours: 0 };
  private readonly n: number;
  private readonly B: number;
  /** When each person last saw each bathroom door, and whether it was taken. */
  private readonly seenT: Float32Array;
  private readonly seenBusy: Uint8Array;
  /** Alcohol still to come from the glass in hand, and the glass's full dose. */
  private readonly absorb: Float32Array;
  private readonly dose: Float32Array;
  /** Where each person stood at the start of the step (for walking speed in bumps). */
  private readonly prevX: Float32Array;
  private readonly prevZ: Float32Array;
  private readonly knockUntil: Float32Array;
  private readonly lastBump = new Map<number, number>();
  private readonly counters: Counter[] = [];
  /** Which part of the evening the drinks follow: champagne before the toast, wine at dinner, a mix after. Set by the party. */
  band: "before" | "dinner" | "after" = "before";

  constructor(
    private readonly host: BodyHost,
    private readonly rng: Rng,
  ) {
    const n = host.people.length;
    const B = host.places.bathrooms.length;
    this.n = n;
    this.B = B;
    this.baths = host.places.bathrooms.map(() => ({ occupant: -1, queue: [], frontSince: 0, knocked: false, hold: -1 }));
    this.seenT = new Float32Array(n * B).fill(-1e9);
    this.seenBusy = new Uint8Array(n * B);
    this.absorb = new Float32Array(n);
    this.dose = new Float32Array(n);
    this.prevX = new Float32Array(n);
    this.prevZ = new Float32Array(n);
    this.knockUntil = new Float32Array(n);
    const counters = new Map<number, Counter>();
    host.places.barCounter.forEach((c, i) => {
      let k = counters.get(c);
      if (!k) counters.set(c, (k = { spots: [], queue: [], pouring: -1, until: 0 }));
      k.spots.push(i);
    });
    this.counters = [...counters.values()];
  }

  // ------------------------------------------------------------- per step

  /** Before anyone moves: remember where they stand. */
  beginStep(): void {
    for (const p of this.host.people) {
      this.prevX[p.id] = p.x;
      this.prevZ[p.id] = p.z;
    }
  }

  /** After everyone has acted: sipping, sobering, bathroom doors and queues, the bars. What people see of the doors comes from the senses. */
  endStep(dt: number): void {
    const { people } = this.host;
    for (const p of people) {
      if (!p.present) continue;
      this.sip(p, dt);
      if (p.tipsy > 0) p.tipsy = Math.max(0, p.tipsy - SOBER_RATE * dt);
    }
    this.baths.forEach((_, i) => this.updateBath(i));
    for (const c of this.counters) this.updateCounter(c);
  }

  // ------------------------------------------------------------- bathrooms

  /** What a person believes about a bathroom: taken (seen in the last 3 minutes), free, or not seen. */
  known(p: Person, i: number): "busy" | "free" | null {
    const k = p.id * this.B + i;
    if (this.host.t - this.seenT[k]! > SEEN_FOR) return null;
    return this.seenBusy[k] ? "busy" : "free";
  }

  /** Whether a bathroom looks taken from outside: its door shut, or someone waiting. */
  looksTaken(i: number): boolean {
    const b = this.baths[i]!;
    const d = this.doorOf(i);
    if (b.queue.length) return true;
    if (!d) return b.occupant >= 0;
    return d.locked || d.open < 0.15;
  }

  /** Whether someone is in a bathroom or on their way in. */
  occupied(i: number): boolean {
    return this.baths[i]!.occupant >= 0;
  }

  /** May this person try this bathroom? A door seen shut lately is skipped unless they're desperate. */
  worthTrying(p: Person, i: number): boolean {
    return this.known(p, i) !== "busy" || p.needs.bladder < URGENT;
  }

  /** Reached the bathroom door: go in, queue, or try elsewhere. */
  atDoor(p: Person): void {
    const a = p.action!;
    const i = a.ref!;
    const b = this.baths[i]!;
    if (b.occupant < 0 && !b.queue.length) return this.claim(p, i);
    if (this.known(p, i) !== "busy") {
      this.stats.taken++;
      this.host.log("bathroom-taken", [p.id, b.occupant], p.room);
    }
    this.remember(p, i, true);
    const elsewhere = this.host.places.bathrooms.some((_, j) => j !== i && this.known(p, j) !== "busy");
    if (b.queue.length < 2 && (p.needs.bladder < QUEUE_BELOW || !elsewhere)) return this.joinQueue(p, i);
    this.host.end(p, false);
    p.thinkAt = this.host.t + 1;
  }

  /** Reached the spot inside. The door is shut and bolted once they are in the room (see updateBath). */
  inside(p: Person): void {
    p.action!.startedAt = this.host.t;
  }

  /** Each step for someone in a bathroom queue: knock when it's been a while, give up after a few minutes. */
  queueStep(p: Person): void {
    const a = p.action!;
    const i = a.ref!;
    const b = this.baths[i]!;
    const t = this.host.t;
    if (t >= a.until!) {
      this.stats.gaveUp++;
      this.leaveQueue(p, i);
      this.remember(p, i, true);
      this.host.end(p, false);
      p.thinkAt = t + 1;
      return;
    }
    if (b.queue[0] === p.id && a.startedAt !== null && !b.knocked && t - b.frontSince >= 60 && b.occupant >= 0) {
      // A polite knock; whoever is inside hurries.
      b.knocked = true;
      this.knockUntil[p.id] = t + 2;
      this.stats.knocks++;
      this.host.log("knock", [p.id, b.occupant], p.room);
      this.host.sound("knock", p, p.id, i);
      const o = this.host.people[b.occupant]!;
      const oa = o.action;
      if (oa?.id === "toilet" && oa.startedAt !== null) oa.duration = Math.min(oa.duration, t - oa.startedAt + this.rng.range(20, 40));
    }
  }

  knocking(p: Person): boolean {
    return this.host.t < this.knockUntil[p.id]!;
  }

  /** Their toilet action ended or was dropped: leave the queue, or unbolt and head out. */
  release(p: Person): void {
    const a = p.action;
    if (a?.id !== "toilet" || a.ref === undefined) return;
    const i = a.ref;
    const b = this.baths[i]!;
    this.leaveQueue(p, i);
    if (b.occupant !== p.id) return;
    const d = this.doorOf(i);
    if (d) this.host.world.setLocked(d, false, p.id);
    // Not in the room yet: the bathroom is free again at once. Otherwise it frees as they step out.
    if (p.room !== this.host.places.bathrooms[i]!.room.index) this.free(i);
  }

  /** The spy takes a free bathroom for a body (spy/kill.ts): whoever comes finds it taken until it lets it go. False when someone has it. */
  holdBath(i: number, p: Person): boolean {
    const b = this.baths[i]!;
    if (b.occupant >= 0 || b.queue.length) return false;
    b.occupant = p.id;
    b.hold = p.id;
    b.knocked = false;
    return true;
  }

  /** Let go of a bathroom held for a body: free again, its door ajar. */
  unholdBath(i: number): void {
    const b = this.baths[i]!;
    if (b.hold < 0) return;
    b.hold = -1;
    this.free(i);
  }

  private claim(p: Person, i: number): void {
    const b = this.baths[i]!;
    b.occupant = p.id;
    b.knocked = false;
    const a = p.action!;
    a.note = "inside";
    a.startedAt = null;
    if (!this.host.goTo(p, this.host.places.bathrooms[i]!.inside)) {
      b.occupant = -1;
      p.avoid.set(`bath:${i}`, this.host.t + 600);
      this.host.end(p, false);
    }
  }

  private joinQueue(p: Person, i: number): void {
    const b = this.baths[i]!;
    const a = p.action!;
    b.queue.push(p.id);
    if (b.queue.length === 1) b.frontSince = this.host.t;
    this.stats.queued++;
    a.note = "queue";
    a.until = this.host.t + this.rng.range(120, 240);
    this.toQueueSpot(p, i, b.queue.length - 1);
  }

  private toQueueSpot(p: Person, i: number, slot: number): void {
    const bath = this.host.places.bathrooms[i]!;
    const s = bath.queue[slot] ?? bath.door;
    p.action!.startedAt = null;
    p.action!.target = s;
    if (!this.host.goTo(p, s)) p.action!.startedAt = this.host.t;
  }

  private leaveQueue(p: Person, i: number): void {
    const b = this.baths[i]!;
    const at = b.queue.indexOf(p.id);
    if (at < 0) return;
    b.queue.splice(at, 1);
    if (at === 0) {
      b.frontSince = this.host.t;
      b.knocked = false;
    }
    // Everyone behind shuffles up.
    for (let k = at; k < b.queue.length; k++) this.toQueueSpot(this.host.people[b.queue[k]!]!, i, k);
  }

  private free(i: number): void {
    const b = this.baths[i]!;
    b.occupant = -1;
    const d = this.doorOf(i);
    if (d) {
      this.host.world.setLocked(d, false, -1);
      this.host.world.swing(d, AJAR);
    }
    const room = this.host.places.bathrooms[i]!.room.index;
    if (this.host.world.lightOn[room] && !this.host.world.litAtStart(room)) {
      this.host.world.setLight(room, false);
      this.host.log("light", [], room, "off");
    }
  }

  private updateBath(i: number): void {
    const b = this.baths[i]!;
    const bath = this.host.places.bathrooms[i]!;
    const room = bath.room.index;
    // Held for a body: nobody claims it, it never frees itself, and the light goes on once the spy is in.
    if (b.hold >= 0) {
      const o = this.host.people[b.hold]!;
      if (o.room === room && !this.host.world.lightOn[room]) {
        this.host.world.setLight(room, true);
        this.host.log("light", [o.id], room, "on");
      }
      return;
    }
    if (b.occupant >= 0) {
      const o = this.host.people[b.occupant]!;
      const a = o.action;
      const using = a?.id === "toilet" && a.ref === i && a.note === "inside";
      const d = this.doorOf(i);
      if (using && o.room === room && d && !d.locked && this.host.world.doorAtPoint(o.level, o.x, o.z) !== d.id) {
        // In: shut the door and bolt it (once nobody else is in there), and switch the light on if it's dark.
        this.host.world.swing(d, 0);
        if (!this.host.people.some((q) => q !== o && q.present && q.room === room)) {
          this.host.world.setLocked(d, true, o.id);
          this.host.sound("bolt", { level: d.level, x: d.x, z: d.z, room }, o.id, i);
        }
        if (!this.host.world.lightOn[room]) {
          this.host.world.setLight(room, true);
          this.host.log("light", [o.id], room, "on");
        }
      }
      if (!using && (o.room !== room || !o.present)) this.free(i);
    }
    if (b.occupant < 0 && b.queue.length) {
      const next = this.host.people[b.queue[0]!]!;
      this.leaveQueue(next, i);
      this.claim(next, i);
    }
  }

  /** Someone saw a bathroom door (senses.ts): shut or ajar. */
  sawDoor(p: Person, i: number): void {
    if (p.staff) return;
    const s = this.host.places.bathrooms[i]!.door;
    const busy = this.looksTaken(i) && this.baths[i]!.occupant !== p.id && !this.baths[i]!.queue.includes(p.id);
    const wasBusy = this.known(p, i) === "busy";
    this.remember(p, i, busy);
    // On the way there and it has just been taken: try elsewhere unless it's urgent.
    const a = p.action;
    if (busy && !wasBusy && a?.id === "toilet" && a.ref === i && a.note === "door" && a.startedAt === null && Math.hypot(s.x - p.x, s.z - p.z) > 1.5 && p.needs.bladder >= QUEUE_BELOW) {
      this.host.end(p, false);
      p.thinkAt = this.host.t + 1;
    }
  }

  /** Someone heard a knock on a bathroom door, or its bolt drawn: it's taken. */
  heardBath(p: Person, i: number): void {
    if (p.staff || this.baths[i]!.occupant === p.id || this.baths[i]!.queue.includes(p.id)) return;
    this.remember(p, i, true);
  }

  private remember(p: Person, i: number, busy: boolean): void {
    const k = p.id * this.B + i;
    this.seenT[k] = this.host.t;
    this.seenBusy[k] = busy ? 1 : 0;
  }

  private doorOf(i: number) {
    const id = this.host.places.bathrooms[i]!.doorId;
    return id >= 0 ? this.host.world.doors[id]! : null;
  }

  // ------------------------------------------------------------------ drinks

  /** A full glass in someone's hand. Anything already in it is set down first. */
  pour(p: Person, drink: DrinkId): void {
    this.carry(p, drink);
    this.drank(p, drink);
  }

  /** A full glass in hand to take to someone else (an errand): not theirs to drink. */
  carry(p: Person, drink: DrinkId): void {
    const { world, t } = this.host;
    if (p.item >= 0) this.setDown(p);
    const id = world.items.add("glass", "full", p.id, p.id, p, t);
    world.items.drink[id] = DRINK_IDS.indexOf(drink);
    world.items.fill[id] = 1;
    p.item = id;
    p.held = drink;
    p.heldUntil = t + DRINK_LIFE[drink];
  }

  /** The glass someone carried, handed over: now it's the other's drink. */
  handOver(p: Person, q: Person): void {
    const { world, t } = this.host;
    const id = p.item;
    const drink = p.held;
    if (id < 0 || !drink || !DRINKS.has(drink)) return;
    if (q.item >= 0) this.setDown(q);
    world.items.holder[id] = q.id;
    world.items.place(id, q);
    p.item = -1;
    p.held = null;
    q.item = id;
    q.held = drink;
    q.heldUntil = t + DRINK_LIFE[drink as DrinkId];
    this.drank(q, drink as DrinkId);
  }

  /** A drink is someone's: it counts, and its alcohol is taken in as the glass is sipped. */
  private drank(p: Person, drink: DrinkId): void {
    const { t } = this.host;
    p.drinkLog.push({ drink, t });
    if (p.drinkLog.length > 24) p.drinkLog.shift();
    if (ALCOHOL.has(drink)) {
      p.drinks++;
      // Less for a heavier build; taken in as the glass is sipped.
      const dose = this.rng.range(0.12, 0.2) * (1.15 - 0.3 * p.look.build);
      this.dose[p.id] = dose;
      this.absorb[p.id] = dose;
    } else {
      this.dose[p.id] = 0;
      this.absorb[p.id] = 0;
    }
  }

  /** Put down whatever glass or tray is in hand, on the nearest surface, drink and all; `here`, where they stand (a stair, a windowsill). */
  setDown(p: Person, here = false): void {
    const { world, places, t } = this.host;
    const id = p.item;
    if (id < 0) return;
    const items = world.items;
    let spot: { level: number; x: number; z: number; room: number } = p;
    let best = here ? 0 : 5;
    for (const s of places.surfaces) {
      if (s.level !== p.level) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < best) {
        best = d;
        spot = s;
      }
    }
    items.holder[id] = -1;
    items.place(id, spot);
    items.set(id, items.kindOf(id) === "glass" && items.fill[id]! <= 0 ? "empty" : "down", t);
    p.item = -1;
    if (p.held && (DRINKS.has(p.held) || p.held === "tray")) p.held = null;
    this.absorb[p.id] = 0;
  }

  /** What someone asks for: usually their favourite, never the drink they don't touch, water when they've had plenty. */
  choose(p: Person, phase: "before" | "dinner" | "after"): DrinkId {
    if (p.id === this.host.spyId && p.tipsy > SPY_WATER) return "water";
    const fav = p.fav !== p.never ? p.fav : "water";
    if (this.rng.chance(0.55) && !(p.tipsy > 0.6 && ALCOHOL.has(fav))) return fav;
    const w: Array<readonly [DrinkId, number]> = [
      ["champagne", phase === "before" ? 2 : 1],
      ["red", phase === "dinner" ? 3 : 2],
      ["white", phase === "dinner" ? 3 : 2],
      ["beer", 1.6],
      ["whisky", phase === "after" ? 1.4 : 0.8],
      ["water", p.tipsy > 0.6 ? 5 : 1],
    ];
    return this.rng.weighted(w.filter(([d]) => d !== p.never));
  }

  /** A waiter's tray: 6 to 8 glasses of one drink, or a full tray of 10 to 12 flutes for the toast. */
  loadTray(w: Person, drink: DrinkId, toast = false): void {
    const { world, t } = this.host;
    let id = w.item;
    if (id < 0 || world.items.kindOf(id) !== "tray") {
      if (id >= 0) this.setDown(w);
      id = world.items.add("tray", "carried", w.id, w.id, w, t);
      w.item = id;
    }
    world.items.drink[id] = DRINK_IDS.indexOf(drink);
    world.items.count[id] = toast ? this.rng.int(10, 12) : this.rng.int(6, 8);
    w.held = "tray";
  }

  /** Glasses left on a waiter's tray (0 when they carry none). */
  trayCount(w: Person): number {
    const items = this.host.world.items;
    return w.item >= 0 && items.kindOf(w.item) === "tray" ? items.count[w.item]! : 0;
  }

  trayDrink(w: Person): DrinkId | null {
    return this.trayCount(w) > 0 ? this.host.world.items.drinkOf(w.item) : null;
  }

  /** Take a glass off a waiter's tray. */
  takeFrom(p: Person, w: Person): DrinkId | null {
    const drink = this.trayDrink(w);
    if (!drink) return null;
    this.host.world.items.count[w.item]!--;
    this.pour(p, drink);
    return drink;
  }

  /** Whether someone would take this drink if offered. */
  wants(p: Person, drink: DrinkId): boolean {
    if (p.id === this.host.spyId && p.tipsy > SPY_WATER && ALCOHOL.has(drink) && drink !== "champagne") return false;
    return drink !== p.never && !(drink !== "water" && p.tipsy > 0.85);
  }

  /** Staff clear empty and abandoned glasses near them. */
  clearGlasses(near: Person, r: number): number {
    const items = this.host.world.items;
    let n = 0;
    for (let i = 0; i < items.n; i++) {
      const st = items.stateOf(i);
      if ((st !== "empty" && st !== "down") || items.kindOf(i) !== "glass" || items.level[i] !== near.level) continue;
      if (Math.hypot(items.x[i]! - near.x, items.z[i]! - near.z) > r) continue;
      items.set(i, "cleared", this.host.t);
      n++;
    }
    return n;
  }

  private sip(p: Person, dt: number): void {
    const items = this.host.world.items;
    const id = p.item;
    if (id < 0 || items.kindOf(id) !== "glass" || items.fill[id]! <= 0) return;
    const drink = items.drinkOf(id);
    const spy = p.id === this.host.spyId;
    const k = (dt / DRINK_LIFE[drink]) * (spy ? SPY_SIP : 1);
    items.fill[id] = Math.max(0, items.fill[id]! - k);
    const take = Math.min(this.absorb[p.id]!, this.dose[p.id]! * k);
    if (take > 0) {
      this.absorb[p.id]! -= take;
      p.tipsy = Math.min(1, p.tipsy + take);
    }
    if (items.fill[id]! <= 0) {
      items.set(id, "empty", this.host.t);
      this.setDown(p);
    } else if (spy && this.host.t - items.since[id]! >= SPY_HOLD) this.setDown(p);
  }

  // -------------------------------------------------------------------- bar

  /** Someone reached a place at the bar: they wait their turn for the bartender. */
  atBar(p: Person, spot: number): void {
    const c = this.counters.find((k) => k.spots.includes(spot));
    if (!c) return;
    if (!c.queue.includes(p.id) && c.pouring !== p.id) c.queue.push(p.id);
  }

  leaveBar(p: Person): void {
    for (const c of this.counters) {
      const at = c.queue.indexOf(p.id);
      if (at >= 0) c.queue.splice(at, 1);
      if (c.pouring === p.id) c.pouring = -1;
    }
  }

  private updateCounter(c: Counter): void {
    const { people, t, places } = this.host;
    if (c.pouring >= 0) {
      if (t < c.until) return;
      const p = people[c.pouring]!;
      c.pouring = -1;
      const a = p.action;
      if (a?.id === "drink" && a.note === "bar-wait") {
        const drink = this.choose(p, this.band);
        this.pour(p, drink);
        this.stats.pours++;
        this.host.log("pour", [p.id], p.room, drink);
        a.note = "bar";
        a.startedAt = t;
      }
    }
    while (c.queue.length && c.pouring < 0) {
      const id = c.queue.shift()!;
      const a = people[id]!.action;
      if (a?.id !== "drink" || a.note !== "bar-wait") continue;
      const first = places.bars[c.spots[0]!]!;
      const tender = people.some((q) => q.role === "bartender" && q.present && q.level === first.level && Math.hypot(q.x - first.x, q.z - first.z) < 3.5);
      c.pouring = id;
      c.until = t + this.rng.range(8, 15) * (tender ? 1 : 1.5);
    }
  }

  // ------------------------------------------------------------------ bumps

  /**
   * Two people overlapping by more than a few centimetres while closing fast walked into each other.
   * A tipsy sway widens the person a little, so bumps come easier. Logged at most every 10 s per pair.
   */
  checkBump(a: Person, b: Person, dx: number, dz: number, d: number, dt: number): void {
    const sway = (p: Person) => Math.max(0, Math.min(1, (p.tipsy - 0.6) / 0.4));
    const reach = PERSON_R + 0.06 * (sway(a) + sway(b));
    if (d >= reach - BUMP_OVERLAP || d < 1e-4) return;
    const real = dt / TIME_SCALE;
    const vax = (a.x - this.prevX[a.id]!) / real;
    const vaz = (a.z - this.prevZ[a.id]!) / real;
    const vbx = (b.x - this.prevX[b.id]!) / real;
    const vbz = (b.z - this.prevZ[b.id]!) / real;
    const closing = -((vbx - vax) * dx + (vbz - vaz) * dz) / d;
    if (closing < BUMP_SPEED) return;
    const key = a.id * this.n + b.id;
    const t = this.host.t;
    if ((this.lastBump.get(key) ?? -1e9) > t - 10) return;
    this.lastBump.set(key, t);
    // The one moving faster walked into the other.
    const fast = Math.hypot(vax, vaz) >= Math.hypot(vbx, vbz) ? a : b;
    const hit = fast === a ? b : a;
    const items = this.host.world.items;
    let slop = false;
    if (hit.item >= 0 && items.kindOf(hit.item) === "glass" && items.fill[hit.item]! > 0.2 && this.rng.chance(0.25 * (1 + hit.tipsy))) {
      items.fill[hit.item]! -= 0.15;
      slop = true;
      this.stats.slops++;
      // Whoever sees it remembers the spill.
      hit.notable = "spill";
      hit.notableObj = fast.id;
      hit.notableRoom = -1;
      hit.notableUntil = this.host.t + 6;
    }
    this.stats.bumps++;
    this.host.log("bump", [fast.id, hit.id], hit.room, slop ? "slop" : undefined);
    this.host.bumped?.(fast, hit, slop);
  }
}
