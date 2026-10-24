/**
 * Seeing and hearing (milestone 2 technical plan: Senses).
 *
 * Sight runs on a schedule: each step a quarter of the people look, so each looks every two
 * in-game seconds. The cheapest tests go first (the room table, range in the room's light,
 * field of view, attention), the crowd and the sight grid last. A sighting writes last-seen
 * notes, picks up whatever notable thing the other person is doing, and compares them with
 * how they're remembered.
 *
 * Sounds carry over the room graph, losing level with distance and through doors, and are
 * heard where they beat the room's own noise. Hearing gives where and what, never who.
 */
import type { Rng } from "../mansion/core/rng";
import type { Body } from "./body";
import type { PhaseId } from "./clock";
import { SURE_OF, type Ident, type IdentEvent } from "./ident";
import { WARY, type Memory, type Verb } from "./memory";
import type { Mood } from "./mood";
import type { Places } from "./places";
import type { Register } from "./register";
import type { Sight } from "./sight";
import { ALCOHOL, type ActionId, type DrinkId, type Group, type PartyEvent, type Person } from "./types";
import type { World } from "./world";

export type SoundKind =
  | "knock"
  | "bolt"
  | "clink"
  | "laugh"
  | "raised-voice"
  | "dropped-tray"
  | "breaking-glass"
  | "slap"
  | "door-slam"
  | "scream"
  | "shutter"
  | "call"
  | "rattle"
  | "smash"
  | "announce";

interface SoundSpec {
  /** Level at 1 m (dB). */
  db: number;
  /** Tension added to whoever hears it (scaled by nerves). */
  tension: number;
  /** What a listener makes of it. */
  fact?: Verb;
}

/**
 * Quiet 50 dB, medium 65, loud 80, very loud 95 (the plan's classes). A knock is struck on the
 * door itself, a little above the quiet class, so it carries across a quiet corridor but not
 * through a shut door.
 */
export const SOUNDS: Record<SoundKind, SoundSpec> = {
  knock: { db: 58, tension: 0, fact: "bathroom-taken" },
  bolt: { db: 50, tension: 0 },
  clink: { db: 50, tension: 0 },
  laugh: { db: 65, tension: 0 },
  "raised-voice": { db: 65, tension: 0.02, fact: "raised-voices" },
  "dropped-tray": { db: 65, tension: 0.01, fact: "crash" },
  "breaking-glass": { db: 80, tension: 0.03, fact: "crash" },
  slap: { db: 80, tension: 0.08, fact: "raised-voices" },
  "door-slam": { db: 80, tension: 0.02 },
  scream: { db: 95, tension: 0.3, fact: "scream" },
  /** A camera's shutter and flash; the flash itself is seen, not heard. */
  shutter: { db: 45, tension: 0 },
  /** Last orders called at the bar, or the host calling everyone for the photo. */
  call: { db: 72, tension: 0 },
  /** A locked door's handle tried. */
  rattle: { db: 55, tension: 0, fact: "locked-door" },
  /** A vase smashing on the floor. */
  smash: { db: 88, tension: 0.06, fact: "crash" },
  /** The host's announcement: a glass tapped, then a raised voice over the crowd. Only the spy listens for it (spy/cues.ts); everyone else just knows. */
  announce: { db: 90, tension: 0 },
};

export interface Sound {
  kind: SoundKind;
  level: number;
  x: number;
  z: number;
  room: number;
  /** Who made it (-1 none); listeners never learn it from the sound alone. */
  source: number;
  /** A bathroom index for a knock or a bolt. */
  ref: number;
}

/** Background in a room with nobody talking, a talker at 1 m, music on the floor, the piano (dB). */
const BACKGROUND = 45;
const TALKER = 55;
const MUSIC = 75;
const PIANO = 70;
/** The band playing under the talk before the dancing (dB): noise, not dance music. */
const BAND_SOFT = 62;
/** A sound is heard when it beats the room's noise by this much. */
const MASK = 6;
/** Loss per metre inside a room, through an open door, a closed one, an arch, and up or down a stair (dB). */
const LOSS_M = 0.5;
const LOSS_OPEN = 6;
const LOSS_SHUT = 20;
const LOSS_ARCH = 3;
const LOSS_STAIR = 15;
/** Below this a sound is gone. */
const SILENT = 30;
/** Field of view either side of facing (radians), and the central cone for detail. */
export const FOV = (100 * Math.PI) / 180;
export const DETAIL_FOV = (30 * Math.PI) / 180;
export const DETAIL_RANGE = 6;
/** The furthest anyone is made out, in full light (m). */
const MAX_RANGE = 12;
/** Sounds kept for the lab. */
const RECENT = 24;
/** How far a closed bathroom door can be read from (m). */
const SEE_DOOR = 12;

/** What the senses need from the party. */
export interface SensesHost {
  readonly t: number;
  readonly people: Person[];
  readonly world: World;
  readonly sight: Sight;
  readonly memory: Memory;
  readonly mood: Mood;
  readonly ident: Ident;
  readonly register: Register;
  readonly body: Body;
  readonly places: Places;
  /** Whether someone has changed into something borrowed after a spill (dramas.ts). */
  readonly dramas: { changed(p: Person): boolean };
  readonly groups: Map<number, Group>;
  readonly phaseId: PhaseId;
  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void;
  /** Turn someone's head toward a point for a while. */
  glance(p: Person, x: number, z: number, secs: number): void;
  /** A nosy guest goes to see what that was. */
  goLook(p: Person, s: Sound): void;
  /** Whether two people are in the same conversation or dancing together. */
  together(a: Person, b: Person): boolean;
  /** What a bond makes of a sighting (bonds.ts), after its own notes. */
  saw?(a: Person, b: Person, d: number): void;
  /** What a look at someone they know brought about past the double take (a test, wanting to compare notes, sure). */
  seenThrough?(a: Person, b: Person, e: IdentEvent): void;
  /** a caught b fumbling something, in the detail of a look (an index into SLIP_SKILLS). */
  sawSlip?(a: Person, b: Person, skill: number): void;
  /** A look ended: anything else worth a glance (the garden's lost things). */
  looked?(a: Person): void;
}

const ACTIONS: readonly ActionId[] = [
  "arrive",
  "mingle",
  "drink",
  "champagne",
  "toilet",
  "sit",
  "art",
  "terrace",
  "dance",
  "dinner",
  "toast",
  "games",
  "wander",
  "leave",
  "staff",
  "ask",
  "use",
  "snack",
  "greet",
  "task",
  "row",
];
export const actionIndex = (a: ActionId | undefined): number => (a ? ACTIONS.indexOf(a) + 1 : 0);
export const actionAt = (i: number): ActionId | null => (i > 0 ? (ACTIONS[i - 1] ?? null) : null);

const wrap = (a: number): number => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export class Senses {
  private queue: Sound[] = [];
  /** Each room's noise (dB), the terrace last; refreshed every 10 steps. */
  readonly noise: Float32Array;
  /** Rooms with music playing (the band, the piano), as of the last refresh. */
  private readonly music: Uint8Array;
  /** When each looker last compared each person they know, for the doubt's time step. */
  private readonly checkedT: Float32Array;
  readonly stats = { looks: 0, sightings: 0, walks: 0, heard: 0 };
  /** What each person saw on their last look (for the lab's sight overlay). */
  readonly seenLast: number[][];
  /** People standing in each room (index room + 2), rebuilt each step for the looks. */
  private byRoom: Person[][] | null = null;
  private lookStep = false;
  /** The last few sounds and who heard each (for the lab's sound overlay). */
  readonly recent: Array<Sound & { t: number; heard: number[] }> = [];

  constructor(
    private readonly host: SensesHost,
    private readonly rng: Rng,
  ) {
    const n = host.people.length;
    this.noise = new Float32Array(host.sight.R).fill(BACKGROUND);
    this.music = new Uint8Array(host.sight.R);
    this.checkedT = new Float32Array(n * n).fill(-1e9);
    this.seenLast = Array.from({ length: n }, () => []);
  }

  /** One step: refresh the noise now and then, a quarter of the people look, and every sound made this step carries. */
  step(stepNo: number): void {
    if (stepNo % 10 === 0) this.refreshNoise();
    // Who stands in each room, for the crowd test while people look (nobody moves meanwhile).
    const rooms = (this.byRoom ??= Array.from({ length: this.host.sight.R + 2 }, () => []));
    for (const r of rooms) r.length = 0;
    for (const q of this.host.people) if (q.present && q.pose !== "sit") rooms[q.room + 2]?.push(q);
    this.lookStep = true;
    for (const p of this.host.people) if (p.present && (p.id + stepNo) % 4 === 0) this.look(p);
    this.lookStep = false;
    const q = this.queue;
    this.queue = [];
    for (const s of q) this.carry(s);
  }

  /** Whether music is playing in a room (-2 the terrace). */
  musicIn(room: number): boolean {
    return room !== -1 && this.music[room < 0 ? this.host.sight.R - 1 : room] === 1;
  }

  /** Make a sound at a point. */
  sound(kind: SoundKind, at: { level: number; x: number; z: number; room: number }, source = -1, ref = -1): void {
    this.queue.push({ kind, level: at.level, x: at.x, z: at.z, room: at.room, source, ref });
  }

  // ------------------------------------------------------------------- sight

  /** How likely someone is to take in what's in front of them: nosy and tense people more, the tipsy, the busy and the lively less. */
  attention(p: Person): number {
    const a = p.action;
    const busy = p.pose === "dance" ? 0.25 : a?.id === "dinner" && a.startedAt !== null ? 0.2 : p.pose === "talk" ? 0.1 : 0;
    const m = this.host.mood;
    return Math.max(0.1, Math.min(1, 0.9 + 0.3 * (p.traits.nosy - 0.5) - 0.5 * p.tipsy - busy - 0.3 * m.energy[p.id]! + 0.3 * m.tension[p.id]!));
  }

  /** How far someone can be made out in a room (m): 12 m in full light, down to 4 m in the dark. */
  range(room: number): number {
    return 4 + 8 * (room >= 0 ? this.host.world.lit(room) : 0.6);
  }

  /**
   * Whether a can see b right now, leaving out attention (the lab and the tests). The same
   * tests in the same order as a look.
   */
  canSee(a: Person, b: Person): boolean {
    return this.visible(a, b) !== null;
  }

  /** Distance and bearing off a's facing when a can see b (attention aside), else null. */
  private visible(a: Person, b: Person): { d: number; off: number } | null {
    if (a === b || !a.present || !b.present) return null;
    const { sight } = this.host;
    const same = a.level === b.level;
    if (!same && !sight.atrium) return null;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    // Past the furthest anyone can be made out in full light, before anything dearer.
    if (dx * dx + dz * dz > MAX_RANGE * MAX_RANGE) return null;
    if (!sight.seeRooms(a.room, b.room)) return null;
    const d = same ? Math.hypot(dx, dz) : Math.hypot(dx, dz, b.y - a.y);
    if (d > this.range(b.room)) return null;
    const off = wrap(Math.atan2(dx, dz) - this.facing(a));
    if (d > 1.2 && Math.abs(off) > FOV) return null;
    if (!same) return sight.acrossVoid(a.level, a.x, a.z, b.level, b.x, b.z) ? { d, off } : null;
    if (d > 1.5 && this.crowded(a, b, dx, dz, d)) return null;
    this.stats.walks++;
    return sight.clear(a.level, a.x, a.z, b.x, b.z) ? { d, off } : null;
  }

  /** Where someone is looking: where their head is turned during a glance, else the way they face. */
  facing(p: Person): number {
    return this.host.t < p.lookUntil ? Math.atan2(p.lookX - p.x, p.lookZ - p.z) : p.yaw;
  }

  /** Whether a point lies in the detail of someone's view: within DETAIL_RANGE, and DETAIL_FOV of where they look (a thing on the ground, nothing in the way checked). */
  inDetail(a: Person, at: { level: number; x: number; z: number }): boolean {
    if (a.level !== at.level) return false;
    const dx = at.x - a.x;
    const dz = at.z - a.z;
    return dx * dx + dz * dz <= DETAIL_RANGE * DETAIL_RANGE && Math.abs(wrap(Math.atan2(dx, dz) - this.facing(a))) <= DETAIL_FOV;
  }

  /** Two or more people standing on the line between them hide one from the other. */
  private crowded(a: Person, b: Person, dx: number, dz: number, d: number): boolean {
    if (!this.lookStep || !this.byRoom) return this.blockers(this.host.people, a, b, dx, dz, d, 0, true) >= 2;
    const c = this.blockers(this.byRoom[a.room + 2] ?? [], a, b, dx, dz, d, 0, false);
    return c >= 2 || (b.room !== a.room && this.blockers(this.byRoom[b.room + 2] ?? [], a, b, dx, dz, d, c, false) >= 2);
  }

  /** Count people (from `c`, stopping at two) standing on the line from a to b. */
  private blockers(qs: readonly Person[], a: Person, b: Person, dx: number, dz: number, d: number, c: number, all: boolean): number {
    for (const q of qs) {
      if (q === a || q === b || q.level !== a.level) continue;
      if (all && ((q.room !== a.room && q.room !== b.room) || !q.present || q.pose === "sit")) continue;
      const rx = q.x - a.x;
      const rz = q.z - a.z;
      const along = (rx * dx + rz * dz) / d;
      if (along <= 0.3 || along >= d - 0.3) continue;
      if (Math.abs(rx * dz - rz * dx) / d < 0.3 && ++c >= 2) return c;
    }
    return c;
  }

  private look(a: Person): void {
    const h = this.host;
    const { memory, sight } = h;
    this.stats.looks++;
    const att = this.attention(a);
    const seen = this.seenLast[a.id]!;
    seen.length = 0;
    for (const b of h.people) {
      const v = this.visible(a, b);
      if (!v || this.rng.next() > att) continue;
      seen.push(b.id);
      this.sighting(a, b, v.d, v.off);
    }
    h.looked?.(a);
    // The bathroom doors in view: shut or ajar.
    this.doors(a);
    // Rooms seen into through doorways and glass.
    for (const r of sight.neighbours[a.room < 0 ? sight.R - 1 : a.room] ?? []) if (sight.seeRooms(a.room, r)) memory.seeInto(a.id, r);
  }

  private sighting(a: Person, b: Person, d: number, off: number): void {
    const h = this.host;
    const { memory, ident } = h;
    const n = h.people.length;
    this.stats.sightings++;
    memory.seen(a.id, b.id, b.room, actionIndex(b.action?.id));
    const detail = d <= DETAIL_RANGE && Math.abs(off) <= DETAIL_FOV;
    if (detail && b.held && ALCOHOL.has(b.held as DrinkId)) memory.sawDrinking[a.id * n + b.id] = h.t;
    if (detail && b.tipsy > 0.6) memory.observe(a.id, "tipsy", b.id);
    // Something worth remembering: a wrong turn, a rattled door, coming out of a bedroom. Somewhere
    // private, or doing something notable, they go in the register too.
    if (b.notable && h.t < b.notableUntil) {
      const f = memory.observe(a.id, b.notable, b.id, b.notableObj, b.room);
      h.register.see(a.id, b, b.notable, b.notableRoom >= 0 ? b.notableRoom : b.room, b.notableObj, f);
    } else if (h.register.watching(a.id, b.room)) h.register.see(a.id, b, "was-in", b.room);
    // Someone they know: do they look like themselves?
    if (ident.tie[a.id * n + b.id]) {
      const k = a.id * n + b.id;
      const dt = Math.min(4, h.t - this.checkedT[k]!);
      this.checkedT[k] = h.t;
      ident.refresh(b);
      const explained = h.t - memory.sawDrinking[k]! < 3600 || memory.knowsAbout(a.id, "tipsy", b.id);
      // A stain, a borrowed jacket, a bandage: no surprise to anyone who knows of the spill or the cut.
      const dressed = (!!b.stain || b.bandage || h.dramas.changed(b)) && (memory.knowsAbout(a.id, "spill", b.id) || memory.knowsAbout(a.id, "cut", b.id));
      const light = b.room >= 0 ? Math.max(0.3, h.world.lit(b.room)) : 0.6;
      const e = ident.check(a.id, b.id, h.t, Math.max(0, dt), d, h.together(a, b), light, a.tipsy, explained, dressed);
      if (e === "double-take") {
        h.glance(a, b.x, b.z, 1.5);
        memory.observe(a.id, "not-themselves", b.id, -1, b.room);
        h.log("double-take", [a.id, b.id], a.room);
      }
      // The test logs itself, by whichever way it came about (ident.onTest).
      if (e) h.seenThrough?.(a, b, e);
    }
    // A fumble shows only up close and in the middle of their view.
    if (detail && h.sawSlip) {
      const s = ident.catchSlip(a.id, b.id, h.t);
      if (s >= 0) h.sawSlip(a, b, s);
    }
    // Wary of them, or sure they aren't who they seem: a glance when they're close.
    if (d < 5 && (memory.suspects(a.id, b.id) >= WARY || ident.stage[a.id * n + b.id] === SURE_OF) && a.pose !== "walk" && h.t >= a.lookUntil) h.glance(a, b.x, b.z, 1.5);
    h.saw?.(a, b, d);
  }

  /** Bathroom doors in view tell whether each is taken (milestone 2 replaces PR 1's stand-in with this). */
  private doors(a: Person): void {
    const h = this.host;
    const baths = h.places.bathrooms;
    for (let i = 0; i < baths.length; i++) {
      const b = baths[i]!;
      const front = b.door;
      if (front.level !== a.level || (front.room !== a.room && !h.sight.seeRooms(a.room, front.room))) continue;
      const door = b.doorId >= 0 ? h.world.doors[b.doorId]! : null;
      const x = door ? door.x : front.x;
      const z = door ? door.z : front.z;
      const dx = x - a.x;
      const dz = z - a.z;
      const d = Math.hypot(dx, dz);
      if (d > SEE_DOOR || (d > 1.2 && Math.abs(wrap(Math.atan2(dx, dz) - this.facing(a))) > FOV)) continue;
      if (d > 1.2 && !h.sight.clear(a.level, a.x, a.z, x, z)) continue;
      h.body.sawDoor(a, i);
    }
  }

  // ----------------------------------------------------------------- hearing

  /** Each room's noise: a background, talkers raising their voices over each other (the Lombard effect), music. */
  private refreshNoise(): void {
    const h = this.host;
    const R = h.sight.R;
    const talkers = new Float32Array(R);
    const music = new Float32Array(R);
    for (const g of h.groups.values()) {
      const s = h.people[g.speaker];
      if (s?.present && s.pose === "talk") talkers[s.room < 0 ? R - 1 : s.room]!++;
    }
    // The piano, and the band: dance music through the dancing, soft under the talk otherwise.
    const band = h.phaseId === "dancing" ? MUSIC : BAND_SOFT;
    for (const p of h.people) {
      if (!p.present || p.pose !== "play") continue;
      const r = p.room < 0 ? R - 1 : p.room;
      const note = p.action?.note;
      if (note === "piano") music[r] = Math.max(music[r]!, PIANO);
      else if (note === "band") music[r] = Math.max(music[r]!, band);
    }
    for (let r = 0; r < R; r++) {
      this.music[r] = music[r]! >= PIANO ? 1 : 0;
      let n = BACKGROUND;
      for (let it = 0; it < 4; it++) {
        const voice = TALKER + 0.5 * Math.max(0, n - BACKGROUND);
        let e = 10 ** (BACKGROUND / 10);
        if (talkers[r]) e += talkers[r]! * 10 ** (voice / 10);
        if (music[r]) e += 10 ** (music[r]! / 10);
        n = 10 * Math.log10(e);
      }
      this.noise[r] = n;
    }
  }

  /** Level of a sound in every room it reaches (dB at the room's entry point), by the loudest way there. */
  levels(s: Sound): { level: Float32Array; ex: Float32Array; ez: Float32Array } {
    const h = this.host;
    const R = h.sight.R;
    const level = new Float32Array(R).fill(-Infinity);
    const ex = new Float32Array(R);
    const ez = new Float32Array(R);
    const done = new Uint8Array(R);
    const src = s.room < 0 ? R - 1 : s.room;
    level[src] = SOUNDS[s.kind].db;
    ex[src] = s.x;
    ez[src] = s.z;
    const graph = h.world.graph;
    for (;;) {
      let r = -1;
      let best = SILENT;
      for (let i = 0; i < R; i++) if (!done[i] && level[i]! > best) ((best = level[i]!), (r = i));
      if (r < 0) break;
      done[r] = 1;
      for (const e of graph[r] ?? []) {
        const to = e.to < 0 ? R - 1 : e.to;
        if (done[to]) continue;
        let loss = e.kind === "stair" ? LOSS_STAIR : LOSS_ARCH;
        if (e.door >= 0) loss = h.world.doors[e.door]!.open >= 0.5 ? LOSS_OPEN : LOSS_SHUT;
        const v = best - LOSS_M * Math.hypot(e.x - ex[r]!, e.z - ez[r]!) - loss;
        if (v > level[to]!) {
          level[to] = v;
          ex[to] = e.x;
          ez[to] = e.z;
        }
      }
    }
    return { level, ex, ez };
  }

  /** The level of a sound where a person stands, or -Infinity. */
  levelAt(s: Sound, p: Person, lv = this.levels(s)): number {
    const R = this.host.sight.R;
    const r = p.room < 0 ? R - 1 : p.room;
    const at = lv.level[r]!;
    if (at === -Infinity) return at;
    return at - LOSS_M * Math.max(0, Math.hypot(p.x - lv.ex[r]!, p.z - lv.ez[r]!) - 1);
  }

  /** Whether a person hears a sound over their room's noise. */
  hears(s: Sound, p: Person, lv = this.levels(s)): boolean {
    const R = this.host.sight.R;
    return this.levelAt(s, p, lv) >= this.noise[p.room < 0 ? R - 1 : p.room]! + MASK;
  }

  /** Whether a person would hear a sound made at a point now: a query of the sound model that queues nothing, so no head turns. */
  wouldHear(kind: SoundKind, at: { level: number; x: number; z: number; room: number }, p: Person): boolean {
    return p.present && this.hears({ kind, level: at.level, x: at.x, z: at.z, room: at.room, source: -1, ref: -1 }, p);
  }

  private carry(s: Sound): void {
    const h = this.host;
    const spec = SOUNDS[s.kind];
    const lv = this.levels(s);
    const heard: number[] = [];
    if (this.recent.push({ ...s, t: h.t, heard }) > RECENT) this.recent.shift();
    for (const p of h.people) {
      if (!p.present || p.id === s.source || !this.hears(s, p, lv)) continue;
      this.stats.heard++;
      heard.push(p.id);
      // Heads turn; laughter in one's own room is just the party.
      if (s.kind !== "laugh" || p.room !== s.room) if (p.pose !== "walk" && p.pose !== "climb") h.glance(p, s.x, s.z, 1);
      if (spec.tension) h.mood.witness(p.id, spec.tension);
      if ((s.kind === "knock" || s.kind === "bolt") && s.ref >= 0) h.body.heardBath(p, s.ref);
      else if (spec.fact) h.register.heard(p.id, h.memory.observe(p.id, spec.fact, -1, -1, s.room));
      if (spec.db >= 80 && p.room !== s.room && p.traits.nosy > 0.7) h.goLook(p, s);
    }
  }
}
