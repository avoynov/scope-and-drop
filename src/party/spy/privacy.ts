/**
 * The privacy check (milestone 3 technical plan: The privacy check): before a risky step, could
 * anyone who counts see its spot now, or before the step is done? It asks the senses' own
 * geometry (`visibleAt()`), so the spy hides by exactly the rules guests see by, and dark helps it
 * as it helps them. It never reads the perch's grid: the spy doesn't know a sniper is there.
 *
 * Two modes. Alone (the lock, the safe, the bug, the ledger): anyone present, whichever way they
 * face. Unwatched (the statuette, a bag or a coat, a pocket): only those facing the spot, and not
 * held by something else (the toast, the speech, the piano, the floor); for someone's things, only
 * those who would know they aren't the spy's, and their owner held or not, since nobody misses a
 * stranger at their own bag from the dance floor.
 *
 * Now and soon: nobody counted sees the spot now, and within the step's length plus SOON nobody
 * it sees or hears (within EARSHOT) has a route or errand that brings them where they would see it,
 * nobody free to step in waits next door by an open doorway (for the alone mode: it peeks through
 * each), and nobody held now who could see it is let go. Whoever it neither sees nor hears it can't
 * foresee, and they may walk in on it. A route is followed as far as they walk in that time, a
 * point every ROUTE_STEP metres, and each point in a room that sees into the spot's is put to the
 * same sight rules as a guest standing there, facing the way they walk (whichever way, for the
 * alone mode). Only those within NEAR_GRAPH metres of the spot by the room graph are checked at all.
 *
 * While it works the spy knows only its own senses (`noticed()`): whoever comes into its view,
 * within a few steps of it, or through a shut door into the room.
 */
import type { MansionBlueprint } from "../../mansion/core/types";
import { phaseIndexAt, TIME_SCALE, type Phase } from "../clock";
import type { Pathfinder } from "../path";
import type { Places } from "../places";
import { FOV, type Senses } from "../senses";
import type { Sight } from "../sight";
import type { Tasks } from "../tasks";
import type { Person } from "../types";
import type { World } from "../world";

export type PrivacyMode = "alone" | "unwatched";

/** The soon window beyond the step's own length (in-game s). */
export const SOON = 20;
/** Someone next door within this of an open doorway into the room counts (m). */
export const DOORWAY = 6;
/** Only those within this of the spot by the room graph are checked (m). */
export const NEAR_GRAPH = 25;
/** While it works: anyone this close is heard or felt, whichever way it faces (m). */
export const CLOSE_BY = 3;
/** Footsteps and voices reach the spy this far, in its own room or one that sees into it (m). */
export const EARSHOT = 8;
/** A doorway passes sight at this much open (sight.ts). */
const OPEN = 0.5;
/** A route is looked along at a point this often (m); one shorter than SETTLING is someone settling into place, who will face where they mean to. */
const ROUTE_STEP = 1.5;
const SETTLING = 2;

export interface PrivacyHost {
  readonly t: number;
  readonly bp: MansionBlueprint;
  readonly people: Person[];
  readonly senses: Senses;
  readonly sight: Sight;
  readonly world: World;
  readonly pf: Pathfinder;
  readonly places: Places;
  readonly tasks: Tasks;
  readonly practices: { readonly speaking: boolean };
  readonly programme: readonly Phase[];
}

/** A point where the spy would work, with the floor's height. */
export interface Spot3 {
  level: number;
  x: number;
  z: number;
  y: number;
  room: number;
}

export interface PrivacyAsk {
  mode: PrivacyMode;
  at: Spot3;
  /** How long the step takes (in-game s). */
  secs: number;
  /** Who stands at the spot (the spy): never one of the crowd in the way. */
  self: Person;
  /** Who counts at all: everyone (null), or those who would know the thing isn't the spy's. */
  who: ((q: Person) => boolean) | null;
  /** Whose things they are (a bag, a coat): they count even while something else holds them. */
  owner?: number;
  /** Left out besides the spy: a kill's target. */
  skip?: number;
  /** Only those within this of the spot can make the act out (m): a hand at a pocket or a mantel. */
  within?: number;
}

/** Too far from the spot to make out a small act. */
function beyond(ask: PrivacyAsk, level: number, x: number, z: number): boolean {
  return ask.within !== undefined && (level !== ask.at.level || Math.hypot(x - ask.at.x, z - ask.at.z) > ask.within);
}

export type InTheWay = "sees" | "coming" | "doorway" | "due" | "let-go";

export interface PrivacyResult {
  ok: boolean;
  /** Who is in the way and why, for the lab's card (the first few found). */
  by: Array<{ who: number; why: InTheWay }>;
}

/** Held by something else and so not looking at the act: never the owner of the things it goes through. */
export function absorbed(h: PrivacyHost, ask: Pick<PrivacyAsk, "mode" | "owner">, q: Person): boolean {
  return ask.mode === "unwatched" && q.id !== ask.owner && held(h, q);
}

/** Whether something else holds someone's eyes: the toast, the speech in its room, the piano, the floor. */
export function held(h: PrivacyHost, q: Person): boolean {
  const a = q.action;
  if (!a || a.startedAt === null) return false;
  if (a.id === "toast" || a.id === "dance") return true;
  if (a.id === "use" && a.note === "piano") return true;
  return h.practices.speaking && q.room === h.places.toastRoom.index;
}

/** Rooms within NEAR_GRAPH of a spot by the room graph (portal to portal), the terrace as -2. */
export function nearRooms(h: PrivacyHost, at: Spot3): Set<number> {
  const g = h.world.graph;
  const R = g.length - 1;
  const ri = (r: number) => (r < 0 ? R : r);
  const dist = new Float64Array(g.length).fill(Infinity);
  const from = Array.from({ length: g.length }, () => ({ x: 0, z: 0 }));
  const start = ri(at.room);
  if (start < 0 || start >= g.length) return new Set([at.room]);
  dist[start] = 0;
  from[start] = { x: at.x, z: at.z };
  const done = new Uint8Array(g.length);
  for (;;) {
    let k = -1;
    for (let i = 0; i < g.length; i++) if (!done[i] && dist[i]! <= NEAR_GRAPH && (k < 0 || dist[i]! < dist[k]!)) k = i;
    if (k < 0) break;
    done[k] = 1;
    const p = from[k]!;
    for (const e of g[k] ?? []) {
      const j = ri(e.to);
      if (j >= g.length) continue;
      const d = dist[k]! + Math.hypot(e.x - p.x, e.z - p.z) + (e.kind === "stair" ? 6 : 0);
      if (d < dist[j]!) {
        dist[j] = d;
        from[j] = { x: e.x, z: e.z };
      }
    }
  }
  const out = new Set<number>();
  for (let i = 0; i < g.length; i++) if (dist[i]! <= NEAR_GRAPH) out.add(i === R ? -2 : i);
  return out;
}

/** Someone fallen, dying or dead sees nothing; someone feeling unwell still does. */
const blind = (q: Person): boolean => q.down !== null && q.down !== "ill";

/**
 * Could anyone who counts see the spot now, or before the step is done? `near` is nearRooms() of
 * the spot, which a caller asking often about one spot keeps.
 */
export function check(h: PrivacyHost, ask: PrivacyAsk, near = nearRooms(h, ask.at)): PrivacyResult {
  const by: PrivacyResult["by"] = [];
  const { at, self } = ask;
  const fov = ask.mode === "alone" ? Math.PI : FOV;
  // Rooms whose people could see the spot: its own and those that see into it.
  const watch = new Set<number>([at.room]);
  for (const r of near) if (r !== at.room && h.sight.seeRooms(r, at.room)) watch.add(r);
  const window = ask.secs + SOON;
  const g = h.world.graph;
  const edges = g[at.room < 0 ? g.length - 1 : at.room] ?? [];
  for (const q of h.people) {
    if (q === self || q.id === ask.skip || !q.present || q.gone || !near.has(q.room) || blind(q)) continue;
    if (ask.who && !ask.who(q)) continue;
    const busy = absorbed(h, ask, q);
    // Now.
    if (!busy && !beyond(ask, q.level, q.x, q.z) && h.senses.visibleAt(q, at, fov, self)) {
      by.push({ who: q.id, why: "sees" });
      if (by.length >= 4) break;
      continue;
    }
    const why = soon(h, q, ask, fov, watch, edges, window, busy);
    if (why) {
      by.push({ who: q.id, why });
      if (by.length >= 4) break;
    }
  }
  return { ok: by.length === 0, by };
}

/**
 * Whether the spy, where it stands, sees or hears someone now: only then can it tell where they
 * are going. Whoever it neither sees nor hears (behind a shut door, round a corner, upstairs) it
 * can't foresee, and may walk in on it.
 */
function perceives(h: PrivacyHost, self: Person, q: Person): boolean {
  if (q.level === self.level && Math.hypot(q.x - self.x, q.z - self.z) <= EARSHOT && (q.room === self.room || h.sight.seeRooms(self.room, q.room))) return true;
  return h.senses.visibleAt(self, { level: q.level, x: q.x, z: q.z, y: q.y, room: q.room }, Math.PI, q) !== null;
}

/** Someone standing at a point, for the sight rules: facing `yaw`, nowhere else to look. */
function ghost(h: PrivacyHost, level: number, x: number, z: number, room: number, yaw: number): Person {
  const y = room >= 0 ? (h.bp.rooms[room]?.floorY ?? 0) : 0;
  return { level, x, z, y, room, yaw, lookUntil: -1e9, lookX: x, lookZ: z } as unknown as Person;
}

/** How far someone still has to walk (m). */
function routeLeft(q: Person): number {
  let d = 0;
  let px = q.x;
  let pz = q.z;
  for (let k = q.pathIndex; k < q.path.length && d < SETTLING; k++) {
    const w = q.path[k]!;
    d += Math.hypot(w.x - px, w.z - pz);
    px = w.x;
    pz = w.z;
  }
  return d;
}

/** What would bring someone into view of the spot within the window, or null. */
function soon(h: PrivacyHost, q: Person, ask: PrivacyAsk, fov: number, watch: ReadonlySet<number>, edges: World["graph"][number], window: number, busy: boolean): InTheWay | null {
  const { at, self } = ask;
  const a = q.action;
  // Held now, and let go before the step is done where they could see it: a dance or a tune ending, the toast or the speech over with its phase.
  if (busy) {
    if (!a || a.startedAt === null || !watch.has(q.room)) return null;
    const ends = a.duration < 9e4 ? a.startedAt + a.duration : h.programme[phaseIndexAt(h.programme, h.t)]!.end;
    return ends - h.t < window && !beyond(ask, q.level, q.x, q.z) && h.senses.visibleAt(q, at, Math.PI, self) ? "let-go" : null;
  }
  // Their route, as far as they walk in the window: would they see the spot from any point of it, looking the way they go? Only if it sees or hears them.
  const reach = (window * q.speed) / TIME_SCALE;
  let known: boolean | null = null;
  const knows = () => (known ??= perceives(h, self, q));
  if (q.path.length && q.pathIndex < q.path.length && routeLeft(q) >= SETTLING && knows()) {
    let px = q.x;
    let pz = q.z;
    let walked = 0;
    for (let k = q.pathIndex; k < q.path.length && walked < reach; k++) {
      const w = q.path[k]!;
      const seg = Math.hypot(w.x - px, w.z - pz);
      // A waypoint where they already stand (or the foot of a stair): no way to face yet.
      if (seg <= 1e-6) continue;
      const yaw = Math.atan2(w.x - px, w.z - pz);
      for (let s = Math.min(ROUTE_STEP, seg); s <= seg + 1e-6 && walked + s <= reach; s += ROUTE_STEP) {
        const f = Math.min(1, s / seg);
        const x = px + (w.x - px) * f;
        const z = pz + (w.z - pz) * f;
        const room = h.pf.roomAt(w.level, x, z);
        if (watch.has(room) && !beyond(ask, w.level, x, z) && h.senses.visibleAt(ghost(h, w.level, x, z, room, yaw), at, fov, self)) return "coming";
      }
      walked += seg;
      px = w.x;
      pz = w.z;
    }
  }
  // Next door, by an open doorway into the room, and free to step in: not staff at a post (the bar, the cloakroom, the band).
  // Only for the alone mode: whoever steps in on an act done as if it were the spy's own still has to look its way.
  const post = q.staff && a?.id === "staff" && a.startedAt !== null && a.note !== "serve";
  if (ask.mode === "alone" && q.room !== at.room && !post) {
    for (const e of edges) {
      if (e.to !== q.room || e.level !== q.level) continue;
      if (e.door >= 0 && h.world.doors[e.door]!.open < OPEN) continue;
      if (Math.hypot(e.x - q.x, e.z - q.z) <= DOORWAY) return "doorway";
    }
  }
  // A step of their own task due where they would see it: a tour's next room, an errand's, a search's; again only for someone it sees or hears.
  const t = a?.id === "task" ? h.tasks.of(q) : undefined;
  if (t && t.owner === q.id && knows()) {
    for (let k = t.i; k < Math.min(t.steps.length, t.i + 3); k++) {
      const st = t.steps[k]!;
      if (
        st.do === "goto" &&
        watch.has(st.to.room) &&
        !beyond(ask, st.to.level, st.to.x, st.to.z) &&
        h.senses.visibleAt(ghost(h, st.to.level, st.to.x, st.to.z, st.to.room, st.to.yaw), at, Math.PI, self)
      )
        return "due";
    }
  }
  return null;
}

/**
 * While it works: whoever who counts the spy notices now, by its own senses (-1 nobody): in its
 * view (its usual field of view, facing the work), within CLOSE_BY whichever way it faces, or
 * opening a shut door into the room (the handle, the hinge). Done unwatched, as if it were its
 * own among people, only someone who could see the work counts: one looking the other way at its
 * elbow is just the party. `shut` holds how far each door was open on the step before.
 */
export function noticed(h: PrivacyHost, ask: PrivacyAsk, shut: Float32Array): number {
  const { self, at } = ask;
  for (const q of h.people) {
    if (q === self || q.id === ask.skip || !q.present || q.gone || blind(q)) continue;
    if (ask.who && !ask.who(q)) continue;
    if (absorbed(h, ask, q)) continue;
    if (beyond(ask, q.level, q.x, q.z) && ask.mode === "unwatched") continue;
    if (ask.mode === "unwatched" && !h.senses.visibleAt(q, at, FOV, self)) continue;
    if (q.level === self.level && Math.hypot(q.x - self.x, q.z - self.z) <= CLOSE_BY) return q.id;
    if (!beyond(ask, q.level, q.x, q.z) && h.senses.visibleAt(self, { level: q.level, x: q.x, z: q.z, y: q.y, room: q.room }, FOV, q)) return q.id;
  }
  // A door into the room opening from shut: whoever is at it.
  for (const d of h.world.doors) {
    if (!d.rooms.includes(at.room) || shut[d.id]! >= OPEN || d.open <= shut[d.id]!) continue;
    let who = -1;
    let best = 2.5;
    for (const q of h.people) {
      if (q === self || !q.present || q.gone || q.level !== d.level) continue;
      const dd = Math.hypot(q.x - d.x, q.z - d.z);
      if (dd < best) {
        best = dd;
        who = q.id;
      }
    }
    if (who >= 0) return who;
  }
  return -1;
}

/** How far each door is open now, for noticed() on the next step. */
export function doorsNow(h: PrivacyHost, out: Float32Array): Float32Array {
  for (const d of h.world.doors) out[d.id] = d.open;
  return out;
}
