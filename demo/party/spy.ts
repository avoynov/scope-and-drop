/**
 * The party lab's spy (milestone 3): its options, the goal odds, the reveal and its card, the
 * ten people the crowd suspects most, and (once revealed) its plan and covers, the privacy and
 * spy overlays, its evening on a strip under the programme, its tells, and a jump to the next one
 * anyone could see.
 *
 *   /party/?seed=gala-night&setup=victim&goal=safe&odds=kill:50,bug:0&steal=80&target=12&on=alibi&reveal=1
 *
 * spy=0 turns it off. setup (self, victim, host, waiter) and goal (kill, statuette, safe, bag,
 * bug, ledger) pin those draws; odds weighs the goals (a goal left out keeps its share, 0 switches
 * it off), steal says how often a kill steals first (0 to 100), target is a person's id (as sel=
 * takes) for whom to kill, whose bag, or whom to play, and on holds covers on all evening, past
 * the caps (out-of-step, returns, odd-places, startles, tours, out-of-picture, drops, alibi,
 * others-things, commotion; poison and murder wait for PR 5). A value the lab doesn't know is
 * dropped, so that draw is made as usual.
 *
 * Until it is revealed (the button, or reveal=1) the lab shows its record as the crowd believes
 * it: its own events stay out of the log and its card stays shut. With someone picked, the
 * button first asks "is it them?", so a tester can score a guess. The goal odds show from the
 * start, since they are chances, not the draw; a change builds the evening afresh from 19:00 with
 * the same house, guests and provocations, and only the spy cast anew. Tests show in the log
 * without their outcome until the reveal, since only an impostor bluffs or fails one; the ranks
 * show from the start, and mark the spy's record once it is revealed. Its tasks show as its
 * cover (looking at the paintings, wandering about) until then, as the crowd sees them.
 *
 * Once revealed, the strip under the programme bar shows its evening (PR 4): a lane for each
 * cover that came on, a tick for each step of its plan, a dot for each tell (filled when the perch
 * could see it, hollow when only a guest did) and its place among the most suspected as a line.
 * Hovering names what is under the pointer; a click jumps there, or to 10 s before a tell. A
 * look-ahead worker (ahead.ts) runs the same evening on to 22:00, so the strip shows it whole;
 * until it gets there, or if it ever parts from the evening played, the strip shows what has
 * played, and says so.
 */
import {
  checkPrivacy,
  clockLabel,
  COVERS,
  factNames,
  HABIT_COVERS,
  GOAL_SHARES,
  goalOdds,
  GOALS,
  nearRooms,
  PARTY_LENGTH,
  phaseIndexAt,
  rankOf,
  ranks,
  SETUPS,
  STEAL,
  TIME_SCALE,
  type ActId,
  type Alibi,
  type AlibiKind,
  type Cover,
  type CueHow,
  type DangerWhy,
  type GoalKind,
  type HidePlace,
  type InTheWay,
  type Party,
  type PartyEvent,
  type PlanActionId,
  type PlanRecord,
  type Spell,
  type SpyOptions,
  type SpySetup,
  type Tell,
  type TellId,
} from "../../src/party";
import type { AheadAsk, AheadRecord } from "./ahead";

const GOAL_LABEL: Record<GoalKind, string> = {
  kill: "kill",
  statuette: "the statuette",
  safe: "the safe",
  bag: "a bag",
  bug: "a bug",
  ledger: "the ledger",
};
const SETUP_LABEL: Record<SpySetup, string> = { self: "as itself", victim: "as a guest", host: "as the host", waiter: "as a waiter" };
const HOW_LABEL: Record<CueHow, string> = { start: "came in on it", heard: "heard the host", seen: "saw the room move", told: "was beckoned in", late: "noticed at last" };
const FROM_LABEL = { bag: "bag", coat: "coat in the cloakroom", pocket: "pocket" } as const;
const WHY_LABEL: Record<DangerWhy, string> = {
  study: "its study",
  with: "seen with its victim",
  wave: "a wave",
  came: "came over",
  kiss: "a kiss",
  "double-take": "a double take",
  test: "a test",
  whisper: "a whisper",
  challenge: "a challenge",
  name: "a name it didn't know",
  witness: "saw it kill",
  failed: "a test it failed",
};
/** What a test came to, in the log once the spy is revealed. */
const TEST_LABEL: Record<string, string> = { passed: "it's them", fumbled: "too drunk to get it, and laughs it off", bluffed: "they laugh along", failed: "a blank look" };
const SURE_LABEL: Record<string, string> = { "out-loud": "had it out", "backed-away": "backed away to tell someone", silent: "kept silent" };
/** The plan's actions, as the card lists them. */
const PLAN_LABEL: Record<PlanActionId, string> = {
  learn: "learn the way",
  "tour-alone": "look round alone",
  go: "go there",
  "pick-lock": "pick the lock",
  "slip-in": "slip in behind a tour",
  "host-place": "take the host's place",
  "open-safe": "open the safe",
  "find-bag": "find the bag's owner",
  "wait-owner": "wait for the bag to go down",
  spill: "spill something on its owner",
  bag: "go through the bag",
  coat: "go through the coat",
  pocket: "pick the pocket",
  papers: "take the papers",
  palm: "palm the statuette",
  "look-away": "wait for the room to look away",
  commotion: "make a commotion",
  stash: "into its coat",
  plant: "plant the bug",
  "brush-host": "brush past the host",
  ledger: "photograph the ledger",
  follow: "follow the target",
  "wait-alone": "wait for them alone",
  embrace: "an embrace",
  inject: "the jab",
  "walk-off": "walk them off like a drunk friend",
  strangle: "strangle them from behind",
};
/** Where a body went, for the log. */
const HIDE_LABEL: Record<HidePlace, string> = {
  bath: "into a bath, the curtain drawn",
  bathroom: "into a bathroom",
  store: "shut in a store room",
  bed: "under a bed",
  wardrobe: "into a wardrobe",
  outside: "behind a hedge in the garden",
  fell: "where it fell",
};
/** How a step of the plan ended, for the card's history and the log. */
const HOW_STEP: Record<string, string> = {
  done: "done",
  "not-yet": "no moment yet",
  moved: "the moment went",
  broken: "broken off",
  "given-up": "given up at the goodbyes",
  gone: "target gone",
  "gave-up": "taken off it",
  lost: "they moved off",
  dead: "dead",
  survived: "let go alive",
};
/** Why a step failed (the planner keeps off it for 15 minutes). */
const FAIL_LABEL: Record<string, string> = {
  "no-moment": "no moment in ten minutes",
  seen: "broken off three times",
  "no-way": "no way there",
  kept: "the bag never went down",
  "no-switch": "no light switch to lean on",
  "no-drink": "nothing in a glass to spill",
  survived: "it let them go alive",
};
const howLabel = (how: string): string => (how.startsWith("failed:") ? `failed: ${FAIL_LABEL[how.slice(7)] ?? how.slice(7)}` : (HOW_STEP[how] ?? how));
/** Why someone is in the way of a step's moment. */
const WAY_LABEL: Record<InTheWay, string> = { sees: "can see it", coming: "on the way in", doorway: "next door by the doorway", due: "due there", "let-go": "about to be free" };
/** The step under way: on its way, waiting for the moment, or at it. */
const STAGE_LABEL = { going: "on its way", waiting: "waiting for the moment", acting: "at it" } as const;
/** What is true as it last planned, by the planner's facts. */
const FACT_LABEL: Record<string, string> = {
  way: "knows the way",
  there: "there",
  door: "the way in open",
  safe: "the safe open",
  found: "knows where its target is",
  free: "the bag down",
  unwatched: "unwatched",
  holding: "has it",
  stashed: "put away",
  planted: "the bug in",
  copied: "the ledger copied",
  close: "at its target's side",
  alone: "its target alone",
};
/** An act under way, for the people list and the log. */
const ACT_LABEL: Record<ActId, string> = {
  lock: "picking the lock",
  safe: "opening the safe",
  papers: "taking the papers",
  bag: "going through the bag",
  coat: "going through the coat",
  pocket: "picking the pocket",
  palm: "palming the statuette",
  plant: "planting the bug",
  brush: "brushing past the host",
  ledger: "photographing the ledger",
};
/** What an act leaves done, for the log. */
const DID_LABEL: Record<ActId, string> = {
  lock: "the lock is picked",
  safe: "the safe is open",
  papers: "has the papers",
  bag: "has the papers from the bag",
  coat: "has the phone from the coat",
  pocket: "has the phone from the pocket",
  palm: "has the statuette",
  plant: "the bug is in",
  brush: "the bug is on the host",
  ledger: "has the ledger on film",
};
/** The tells, for the next-tell note. */
const TELL_LABEL: Record<TellId, string> = {
  "out-of-step": "out of step with the room",
  garment: "the garment by a garden door",
  lock: "on one knee at a locked door",
  safe: "crouched at the safe",
  bag: "going through someone's things",
  pocket: "a hand in a pocket",
  palm: "palming the statuette",
  plant: "planting the bug",
  ledger: "photographing the ledger",
  returns: "back where it did something",
  "odd-place": "coming out of a bedroom",
  followed: "a step behind its target",
  startled: "startled, then the paintings",
  touring: "alone upstairs, trying handles",
  "camera-shy": "out as the photographer comes in",
  abandoned: "what it fetched, left on the way",
  "cut-off": "a cut hand, off alone",
  "spill-off": "a spill, off to change",
  "lost-off": "off for a lost thing",
  call: "on the phone in an empty room",
  "bare-hand": "the bandage gone",
  "clean-shirt": "clean again after a spill",
  "their-bag": "someone else's bag in its hands",
  dark: "the lights out",
  embrace: "an embrace",
  jab: "the jab in the embrace",
  propped: "walking someone who can barely stand",
  struggle: "a struggle",
  drag: "dragging a body",
  dose: "a dose into a glass",
  "bar-dose": "a dose into the bar's red",
  "refused-tray": "a tray waved off",
  changing: "changing behind a shut door",
  fallen: "someone falls",
  body: "a body in view",
};
/** The covers (scheduler.ts), as the card, the log and the strip name them. */
const COVER_LABEL: Record<Cover, string> = {
  "out-of-step": "out of step",
  returns: "going back",
  "odd-places": "odd places",
  startles: "startles",
  tours: "tours alone",
  "out-of-picture": "out of the picture",
  drops: "drops everything",
  alibi: "a false alibi",
  "others-things": "other people's things",
  commotion: "the lights",
  poison: "poison (PR 5)",
  murder: "murder (PR 5)",
};
/** The false alibi's openers, and where it has got to. */
const ALIBI_LABEL: Record<AlibiKind, string> = { cut: "a cut hand", spill: "a spill down itself", lost: "a lost thing", call: "a phone call" };
const ALIBI_STAGE: Record<Alibi["stage"], string> = { away: "away at it", wash: "off to wash", washing: "washing it", dress: "having it dressed", back: "back" };
/** The openers it has used, as "cut 1, call 2". */
const ALIBI_KINDS_USED = (k: Record<AlibiKind, number>): string =>
  (Object.keys(ALIBI_LABEL) as AlibiKind[])
    .filter((x) => k[x])
    .map((x) => `${x} ${k[x]}`)
    .join(", ");
/** Why it stayed in the photo when the camera came. */
const PHOTO_STAY: Record<string, string> = {
  busy: "it was in the middle of something",
  talking: "it was the one talking",
  camera: "the camera was already on it",
  "no-door": "no way out that cleared the shot",
  "no-reason": "no reason to walk out",
  named: "the host is the photo's middle",
};
/** Its tasks besides the plan's steps, for the log. */
const TASK_WHAT: Record<string, string> = {
  return: "go back",
  tour: "look round alone",
  startle: "a painting after a start",
  "put-back": "put the bag back",
  "kill:strangled": "strangle its target",
  "kill:injection": "the needle",
};
/** The steps of the spy's tasks, by their whole label (they share their first word with other tasks'). */
const SPY_STEP: Record<string, string> = {
  trail: "following its target",
  "to:find": "looking for its target",
  "look-for": "looking round for them",
  "to:watch": "keeping an eye on the bag",
  "watch-bag": "watching for the bag to go down",
  "to:learn": "learning the way",
  learn: "taking in the way",
  "to:stash": "to its coat",
  stash: "putting it in its coat",
  cover: "looking at something else",
  // The kill (PR 5).
  "kill:close": "closing in on them",
  "kill:struggle": "strangling them from behind",
  "kill:drag": "dragging them off, out cold",
  "kill:embrace": "an embrace",
  "kill:walk-off": "walking them off like a drunk friend",
  "kill:in": "laying them down",
  "kill:bolt": "bolting the door",
  "kill:finish": "holding on until they're dead",
  "kill:dying": "waiting for them to die",
  "kill:hide": "hiding the body",
  "kill:unbolt": "drawing the bolt back",
  "kill:out": "stepping out",
  // Its covers (PR 4).
  "to:switch": "to the light switch",
  switch: "leaning on the light switch",
  carry: "picking the bag up",
  "to:carry": "carrying the bag somewhere quiet",
  "to:put-back": "taking the bag back",
  "put-back": "putting the bag back",
  "to:bar": "to the bar for a glass of red",
  red: "getting a glass of red",
  "to:spill": "to its target, glass in hand",
  spill: "spilling it down them",
  "alibi:cut": "a glass breaks in its hand",
  "alibi:spill": "a drink down its front",
  "alibi:lost": "patting its pockets",
  "alibi:call": "its phone rings",
  "alibi:wave": "waving the help off",
  "alibi:pat": "patting its pockets",
  "call-take": "taking the call",
  "call-in": "the phone to its ear",
  call: "on the phone, facing the wall",
  "to:return": "going back",
  return: "back where it did something",
  "return-look": "looking round",
  "to-door": "to a private door",
  "to-room": "into a room it hardly knows",
  look: "looking in",
  "look-in": "looking round",
  "peek-in": "slipping in",
  peek: "looking round inside",
  "peek-out": "slipping out",
  "to-art": "to the nearest painting",
  "cover-look": "taken with the painting",
};
const ACT_WHERE: Record<ActId, string> = {
  lock: "the door",
  safe: "the safe",
  papers: "the safe",
  bag: "the bag",
  coat: "the coat",
  pocket: "the target",
  palm: "the statuette",
  plant: "where the bug goes",
  brush: "the host",
  ledger: "the ledger",
};
/** The crowd's finds in the log and on the card: the statuette missed, a thing gone, the safe found open, a bug. */
const FIND_LABEL: Record<string, string> = {
  "statuette-gone": "sees the statuette is gone from its stand",
  "gone:papers": "finds the papers gone",
  "gone:phone": "finds the phone gone",
  "safe-open": "finds the safe open, and shuts it",
  bug: "finds a bug",
};
/** The ranks list shows this many, and nobody under this score: suspected by nobody yet. */
const RANKS = 10;
const SUSPECTED = 0.005;

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const ordinal = (k: number): string => `${k}${k % 100 >= 11 && k % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][k % 10] ?? "th")}`;
/** Its place among the most suspected, or that nobody suspects it yet. */
const rankText = (r: { rank: number; score: number }): string => (r.score < SUSPECTED ? "suspected by nobody" : `${ordinal(r.rank)} most suspected (${pct(r.score)})`);
const mins = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** The spy option the URL asks for: false with spy=0, else whatever it pins. */
export function spyOption(params: URLSearchParams): false | SpyOptions {
  if (params.get("spy") === "0") return false;
  const o: SpyOptions = {};
  const setup = params.get("setup") as SpySetup | null;
  if (setup && SETUPS.includes(setup)) o.setup = setup;
  const goal = params.get("goal") as GoalKind | null;
  if (goal && GOALS.includes(goal)) o.goal = goal;
  const odds = parseOdds(params.get("odds"));
  if (Object.keys(odds).length) o.odds = odds;
  const steal = Number(params.get("steal"));
  if (params.has("steal") && Number.isFinite(steal)) o.steal = Math.max(0, Math.min(100, steal)) / 100;
  const target = Number(params.get("target"));
  if (params.has("target") && Number.isInteger(target) && target >= 0) o.target = target;
  const on = (params.get("on") ?? "").split(",").filter((c): c is Cover => (COVERS as readonly string[]).includes(c));
  if (on.length) o.on = [...new Set(on)];
  return o;
}

/** `kill:50,bug:0` as weights; an unknown goal or a number that isn't one is dropped. */
function parseOdds(s: string | null): Partial<Record<GoalKind, number>> {
  const out: Partial<Record<GoalKind, number>> = {};
  for (const part of (s ?? "").split(",")) {
    const [g, v] = part.split(":");
    const w = Number(v);
    if (GOALS.includes(g as GoalKind) && v !== undefined && v !== "" && Number.isFinite(w) && w >= 0) out[g as GoalKind] = w;
  }
  return out;
}

export interface SpyLabHost {
  /** Build the evening afresh in the same house (the lab's newParty) and refresh the panel. */
  rebuild(): void;
  /** Pick a person, as clicking their row does. */
  select(id: number): void;
  /** Run something slow with the "simulating" note up, then refresh the panel. */
  busy(fn: () => void): void;
  /** Stop the clock. */
  pause(): void;
  /** Jump to an in-game time, as a click on the programme does. */
  seek(t: number): void;
  /** The evening as newParty() builds it now, for the look-ahead. */
  evening(): Omit<AheadAsk, "key">;
}

/** A cell of the privacy overlay: an act could start there now alone, or only unwatched, or someone would see it. */
export interface PrivacyCell {
  level: number;
  x: number;
  z: number;
  mode: "alone" | "unwatched" | "seen";
}

/** The spy overlay: its route, its goal's things and a line to its target. */
export interface SpyMarks {
  route: Array<{ level: number; x: number; z: number }>;
  marks: Array<{ level: number; x: number; z: number; label: string }>;
  target: number;
}

/** The privacy overlay is worked out at most this often (ms of wall time), and for an act this long (in-game s). */
const PRIVACY_EVERY = 1000;
const PRIVACY_SECS = 30;

/**
 * The privacy overlay: each metre of the spy's room and the rooms next to it, and whether an act
 * of `secs` could begin there now by the plan's own check (privacy.ts): alone (nobody who could
 * see it, whichever way they face), only unwatched (nobody facing it and free to look), or seen.
 */
export function privacyCells(party: Party, secs = PRIVACY_SECS): PrivacyCell[] {
  const self = party.spy?.record;
  if (!self?.present || self.gone || self.room < 0) return [];
  const { bp, pf } = party;
  const rooms = new Set<number>([self.room]);
  for (const e of party.world.graph[self.room] ?? []) if (e.to >= 0) rooms.add(e.to);
  const out: PrivacyCell[] = [];
  for (const r of rooms) {
    const room = bp.rooms[r];
    if (!room) continue;
    const { x0, x1, z0, z1 } = room.inner;
    for (let x = x0 + 0.5; x < x1; x += 1)
      for (let z = z0 + 0.5; z < z1; z += 1) {
        if (!pf.walkable(room.level, x, z) || pf.roomAt(room.level, x, z) !== r) continue;
        const at = { level: room.level, x, z, y: room.floorY, room: r };
        const near = nearRooms(party, at);
        const mode = checkPrivacy(party, { mode: "alone", at, secs, self, who: null }, near).ok
          ? "alone"
          : checkPrivacy(party, { mode: "unwatched", at, secs, self, who: null }, near).ok
            ? "unwatched"
            : "seen";
        out.push({ level: room.level, x, z, mode });
      }
  }
  return out;
}

/** The spy overlay: the way it walks now, its goal's things where they are (a thing carried is with whoever has it), and its target. */
export function spyMarks(party: Party): SpyMarks | null {
  const spy = party.spy;
  if (!spy) return null;
  const p = spy.record;
  const here = p.present && !p.gone;
  const route = here ? [{ level: p.level, x: p.x, z: p.z }, ...p.path.slice(p.pathIndex).map((w) => ({ level: w.level, x: w.x, z: w.z }))] : [];
  const marks: SpyMarks["marks"] = [];
  const items = party.world.items;
  const th = spy.things;
  const item = (i: number, label: string) => {
    if (i < 0) return;
    const q = items.holder[i]! >= 0 ? party.people[items.holder[i]!] : null;
    if (q && (!q.present || q.gone)) return;
    marks.push(q ? { level: q.level, x: q.x, z: q.z, label } : { level: items.level[i]!, x: items.x[i]!, z: items.z[i]!, label });
  };
  item(th.statuette, "the statuette");
  if (th.safe) marks.push({ level: th.safe.level, x: th.safe.x, z: th.safe.z, label: th.safeOpen ? "the safe (open)" : "the safe" });
  if (th.ledger) marks.push({ level: th.ledger.level, x: th.ledger.x, z: th.ledger.z, label: th.copiedAt >= 0 ? "the ledger (copied)" : "the ledger" });
  if (th.bug?.prop && th.device < 0) marks.push({ level: th.bug.prop.level, x: th.bug.prop.x, z: th.bug.prop.z, label: `the bug goes here (${th.bug.place})` });
  item(th.device, "the bug");
  const g = spy.goal;
  const target = g.target >= 0 ? party.people[g.target]! : null;
  if (target) {
    const from = g.kind === "bag" ? "bag" : g.first?.from;
    if (from === "bag") item(th.bagOf(target), `${target.name}'s bag`);
    if (from === "coat") item(target.coat, `${target.name}'s coat`);
  }
  return { route, marks, target: target?.present && !target.gone ? target.id : -1 };
}

/** The strip, in CSS px: a lane per cover that came on, the plan's ticks, the tells' dots and the rank band, whose floor takes every rank past RANK_FLOOR. */
const LANE = 3;
const LANE_GAP = 1;
const STEP_ROW = 7;
const TELL_ROW = 9;
const RANK_BAND = 16;
const RANK_FLOOR = 10;
/** A click on a tell, and the next tell, jump to this long before it (in-game s). */
const LEAD = 10;
/** Ranks this far apart (in-game s) are a gap in the line: it was away, or the evening was skipped through. */
const RANK_GAP = 2 * 60 + 1;
/** The page's colours (index.html): habits in its grey, tactics in its accent, PR 5's covers and the hard tells in the spy's red. */
const INK = "#e9e4d8";
const ACCENT = "#e0b56a";
const RED = "#e2786a";
const MUTED = "#9a9486";
const laneColor = (c: Cover): string => (c === "poison" || c === "murder" ? RED : HABIT_COVERS.has(c) ? MUTED : ACCENT);
const TELL_COLOR: Record<Tell["kind"], string> = { hard: RED, cover: INK, trace: ACCENT };
const TELL_KIND: Record<Tell["kind"], string> = { hard: "hard", cover: "soft", trace: "a trace" };
const STRIP_TITLE =
  "The spy's evening: a lane for each cover that came on, a tick for each step of its plan (bright: done, red: failed), a dot for each tell (filled: the perch could see it; hollow: only a guest saw it; red: a hard tell) and its place among the most suspected. Click to jump there, or to 10 s before a tell";

/** What the strip draws: the spy's evening up to `t`, from the look-ahead or as it has played. */
interface StripRecord {
  t: number;
  spells: readonly Spell[];
  steps: readonly PlanRecord[];
  tells: readonly Tell[];
  ranks: ReadonlyArray<{ t: number; rank: number; score: number }>;
  ahead: boolean;
}

export class SpyLab {
  /** Whether the spy has been shown, and the guess that showed it (who, and when). */
  revealed: boolean;
  guess: { who: number; t: number } | null = null;
  private option0: false | SpyOptions;
  private readonly odds: Partial<Record<GoalKind, number>>;
  private steal: number | undefined;
  private readonly box: HTMLElement;
  private readonly card: HTMLElement;
  /** The card's name line (kept, so a click on it isn't lost to a refresh) and the lines under it. */
  private readonly head: HTMLButtonElement;
  private readonly lines: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly verdict: HTMLElement;
  /** Once revealed: on to the next tell a guest saw or the perch could see. */
  private readonly nextButton: HTMLButtonElement;
  private readonly nextNote: HTMLElement;
  private nextRow: HTMLElement | null = null;
  /** The privacy overlay as last worked out: when (in-game and wall time), and its cells. */
  private cells: PrivacyCell[] = [];
  private cellsT = -1;
  private cellsAt = -1e9;
  private readonly chances = new Map<GoalKind, HTMLElement>();
  private readonly weights = new Map<GoalKind, HTMLInputElement>();
  private readonly switches = new Map<GoalKind, HTMLInputElement>();
  private stealInput: HTMLInputElement | null = null;
  /** The ten most suspected: their rows are kept, so a click on one isn't lost to a refresh. */
  private readonly rankHead: HTMLElement;
  private readonly rankRows: HTMLButtonElement[] = [];
  /** The strip under the programme bar: its canvas, its note, and where its rows were last drawn. */
  private readonly strip: HTMLElement;
  private readonly stripCanvas: HTMLCanvasElement;
  private readonly stripNote: HTMLElement;
  private layout: { W: number; lanes: Cover[]; ys: number; yt: number; yr: number; rec: StripRecord } | null = null;
  /** The look-ahead: its worker, the evening it runs (as a key), what it last posted, its digests by time, and when the evening played first parted from it (-1 never). */
  private worker: Worker | null = null;
  private aheadKey = "";
  private ahead: AheadRecord | null = null;
  private readonly aheadDigests = new Map<number, string>();
  private parted = -1;
  /** The spy's rank as the evening has played, once an in-game minute while the lab steps it. */
  private liveRanks: Array<{ t: number; rank: number; score: number }> = [];
  /** The tell the last "next tell" went to (-1 none). */
  private jumpedTo = -1;

  constructor(
    private readonly params: URLSearchParams,
    private readonly host: SpyLabHost,
    box: HTMLElement,
    card: HTMLElement,
    strip: HTMLElement,
  ) {
    this.option0 = spyOption(params);
    this.revealed = params.get("reveal") === "1";
    this.odds = this.option0 ? { ...(this.option0.odds ?? {}) } : {};
    this.steal = this.option0 ? this.option0.steal : undefined;
    this.box = box;
    this.card = card;
    this.head = document.createElement("button");
    this.head.className = "spyname";
    this.head.title = "Pick its record";
    this.head.onclick = () => this.party?.spy && this.host.select(this.party.spy.id);
    this.lines = document.createElement("div");
    card.replaceChildren(this.head, this.lines);
    this.button = document.createElement("button");
    this.verdict = document.createElement("span");
    this.verdict.className = "label";
    this.nextButton = document.createElement("button");
    this.nextButton.textContent = "next tell ›";
    this.nextButton.title = "Play on to the next tell a guest sees or the perch could see (its view 0.5 or more), and pause there";
    this.nextButton.onclick = () => this.nextTell();
    this.nextNote = document.createElement("span");
    this.nextNote.className = "label";
    this.rankHead = document.createElement("div");
    this.rankHead.className = "label";
    for (let k = 0; k < RANKS; k++) {
      const b = document.createElement("button");
      b.className = "rank";
      b.title = "Pick them";
      b.onclick = () => b.dataset.id && this.host.select(Number(b.dataset.id));
      this.rankRows.push(b);
    }
    this.strip = strip;
    this.stripCanvas = document.createElement("canvas");
    this.stripCanvas.title = STRIP_TITLE;
    this.stripCanvas.onmousemove = (e) => (this.stripCanvas.title = this.hit(e)?.text ?? STRIP_TITLE);
    this.stripCanvas.onclick = (e) => {
      const h = this.hit(e);
      if (h) this.host.seek(h.jump);
    };
    this.stripNote = document.createElement("div");
    this.stripNote.className = "label";
    strip.replaceChildren(this.stripCanvas, this.stripNote);
    strip.hidden = true;
    this.build();
  }

  /** The option for a new evening: the URL's pins, with the odds and steal as the panel has them. */
  option(): false | SpyOptions {
    if (!this.option0) return false;
    const o: SpyOptions = { ...this.option0, odds: { ...this.odds } };
    if (this.steal !== undefined) o.steal = this.steal;
    else delete o.steal;
    return o;
  }

  /** The reveal row, the goal odds and the ranks, in the left panel. */
  private build(): void {
    const box = this.box;
    box.replaceChildren();
    const ranked = document.createElement("div");
    ranked.className = "ranks";
    ranked.title = "The ten the crowd suspects most: each one's score is the mean, over the guests here, of the larger of their suspicion and their doubt about them";
    ranked.append(this.rankHead, ...this.rankRows);
    if (!this.option0) {
      const none = document.createElement("div");
      none.textContent = "no spy tonight (spy=0)";
      box.append(none, ranked);
      return;
    }
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "spy";
    this.button.onclick = () => this.reveal();
    row.append(label, this.button, this.verdict);
    const next = document.createElement("div");
    next.className = "row";
    next.hidden = !this.revealed;
    next.append(this.nextButton, this.nextNote);
    this.nextRow = next;
    box.append(row, next);
    const pins = [this.option0.setup ? `comes ${SETUP_LABEL[this.option0.setup]}` : "", this.option0.goal ? `goal pinned: ${GOAL_LABEL[this.option0.goal]}` : ""].filter(Boolean);
    if (pins.length) {
      const p = document.createElement("div");
      p.className = "label";
      p.textContent = pins.join(" · ");
      box.appendChild(p);
    }
    // A line per goal: the switch, its weight and its chance for this house.
    const grid = document.createElement("div");
    grid.className = "odds";
    grid.title = "The spy's goal is drawn from these chances. A change builds the evening afresh from 19:00";
    for (const g of GOALS) {
      const on = document.createElement("input");
      on.type = "checkbox";
      on.checked = (this.odds[g] ?? GOAL_SHARES[g]) > 0;
      on.title = `Switch ${GOAL_LABEL[g]} on or off`;
      const name = document.createElement("span");
      name.textContent = GOAL_LABEL[g];
      const w = document.createElement("input");
      w.type = "number";
      w.min = "0";
      w.step = "5";
      w.value = String(this.odds[g] ?? GOAL_SHARES[g]);
      w.title = "Weight (the plan's share by default)";
      const chance = document.createElement("span");
      chance.className = "label";
      on.onchange = () => {
        if (on.checked && Number(w.value) <= 0) w.value = String(GOAL_SHARES[g]);
        this.setOdds(g, on.checked ? Number(w.value) : 0);
      };
      w.onchange = () => {
        const v = Math.max(0, Number(w.value) || 0);
        on.checked = v > 0;
        this.setOdds(g, v);
      };
      this.switches.set(g, on);
      this.weights.set(g, w);
      this.chances.set(g, chance);
      grid.append(on, name, w, chance);
      if (g === "kill") {
        const s = document.createElement("input");
        s.type = "number";
        s.min = "0";
        s.max = "100";
        s.step = "10";
        s.value = String(Math.round((this.steal ?? STEAL) * 100));
        s.title = "How often a kill steals something from the target first (%)";
        s.onchange = () => {
          this.steal = Math.max(0, Math.min(100, Number(s.value) || 0)) / 100;
          this.changed();
        };
        this.stealInput = s;
        const a = document.createElement("span");
        a.className = "label";
        a.textContent = "↳ steals first";
        const b = document.createElement("span");
        b.className = "label";
        b.textContent = "% of kills";
        grid.append(document.createElement("span"), a, s, b);
      }
    }
    box.append(grid, ranked);
  }

  private setOdds(g: GoalKind, v: number): void {
    if (v === GOAL_SHARES[g]) delete this.odds[g];
    else this.odds[g] = v;
    this.changed();
  }

  /** A new chance or steal: into the URL, and the evening afresh. */
  private changed(): void {
    const url = new URL(location.href);
    const odds = GOALS.filter((g) => this.odds[g] !== undefined).map((g) => `${g}:${this.odds[g]}`);
    if (odds.length) url.searchParams.set("odds", odds.join(","));
    else url.searchParams.delete("odds");
    if (this.steal !== undefined && this.steal !== STEAL) url.searchParams.set("steal", String(Math.round(this.steal * 100)));
    else url.searchParams.delete("steal");
    history.replaceState(null, "", url);
    this.host.rebuild();
  }

  /** The button: a guess on whoever is picked, or a plain reveal. */
  private reveal(): void {
    if (this.revealed) return;
    const party = this.party;
    if (!party?.spy) return;
    if (this.picked >= 0) this.guess = { who: this.picked, t: party.t };
    this.revealed = true;
    this.lastRefresh?.();
  }

  private party: Party | null = null;
  private house: Party["bp"] | null = null;
  private odds0: Record<GoalKind, number> | null = null;
  private picked = -1;
  private lastRefresh: (() => void) | null = null;

  /**
   * Until the reveal, the spy's own events stay out of the log. After it, the start and end of each
   * step, the plan itself, its covers coming on and off and its feeling watched show only under the
   * spy's own filter (`all`), and the end of a look at something else nowhere.
   */
  hides(e: PartyEvent, all = false): boolean {
    // A death and a body stay out of the log until the reveal too: they'd give the spy away.
    if (e.kind === "down") return !this.revealed && (e.note === "dying" || e.note === "dead" || e.note === "hidden" || e.note === "left");
    if (e.kind !== "spy") return false;
    if (!this.revealed) return true;
    const note = e.note ?? "";
    if (note.startsWith("task:cover:")) return true;
    return !all && (note.startsWith("task:") || note.startsWith("plan:") || note === "no-plan" || note.startsWith("cover:") || note.startsWith("watched:"));
  }

  /** A step of the spy's task, as the people list and the tasks overlay show it once revealed. */
  stepLabel(label: string): string {
    const s = SPY_STEP[label];
    if (s) return s;
    const [k, a] = label.split(":");
    const act = a as ActId;
    if (k === "to") return `to ${ACT_WHERE[act] ?? a}`;
    if (k === "await")
      return act === "pocket" ? "at its target's side, waiting for the moment" : act === "brush" ? "by the host, waiting for the moment" : `at ${ACT_WHERE[act] ?? a}, waiting for the moment`;
    if (k === "risky") return ACT_LABEL[act] ?? a ?? label;
    if (k === "try") return "trying the handle";
    return label.replace(/-/g, " ");
  }

  /** The privacy overlay's cells, once revealed: worked out afresh at most once a second, and only when the evening has moved on. */
  privacy(): PrivacyCell[] {
    const party = this.party;
    if (!party?.spy || !this.revealed) return [];
    const now = performance.now();
    if (party.t !== this.cellsT && now - this.cellsAt >= PRIVACY_EVERY) {
      this.cells = privacyCells(party);
      this.cellsT = party.t;
      this.cellsAt = now;
    }
    return this.cells;
  }

  /** The spy overlay's route, things and target, once revealed. */
  marks(): SpyMarks | null {
    return this.revealed && this.party ? spyMarks(this.party) : null;
  }

  /**
   * On to 10 s before the next tell a guest saw or the perch could see well (its view 0.5 or more),
   * paused: from the look-ahead once it has got that far, else by playing on to the step where the
   * tell shows.
   */
  private nextTell(): void {
    const party = this.party;
    if (!party?.spy || !this.revealed) return;
    const from = party.t;
    const shows = (x: Tell) => x.kind !== "trace" && (x.view >= 0.5 || x.seenBy.length > 0);
    const a = this.ahead;
    if (a && !a.error && this.parted < 0) {
      const x = a.tells.find((y) => y.t > from && y.t > this.jumpedTo && shows(y));
      if (x || a.done) {
        this.host.pause();
        this.nextNote.textContent = x ? this.tellNote(party, x) : `no tell anyone could see after ${clockLabel(from)}`;
        if (x) {
          this.jumpedTo = x.t;
          if (x.t - LEAD > from) this.host.seek(x.t - LEAD);
        }
        return;
      }
    }
    const m = party.spy.measure;
    this.host.busy(() => {
      const live = () => m.tells.find((y) => y.t > from && shows(y));
      let x = live();
      while (!x && !party.over) {
        party.step();
        this.stepped(party);
        x = live();
      }
      this.host.pause();
      if (x) this.jumpedTo = x.t;
      this.nextNote.textContent = x ? this.tellNote(party, x) : `no tell anyone could see after ${clockLabel(from)}`;
    });
  }

  /** A tell in a line: when, what, who saw it, and the perch's view of it and the zoom that reads it. */
  private tellNote(party: Party, x: Tell): string {
    const name = (i: number) => party.people[i]?.name ?? "?";
    return `${clockLabel(x.t)}: ${TELL_LABEL[x.what]}${x.seenBy.length ? `, seen by ${x.seenBy.map(name).join(", ")}` : ""}, the perch's view ${pct(x.view)} (reads at ${x.zoom}×)`;
  }

  /** After each step the lab plays: the spy's rank once an in-game minute, and the evening checked against the look-ahead wherever it posted a digest. */
  stepped(party: Party): void {
    const spy = party.spy;
    if (!spy || !this.revealed || party !== this.party) return;
    const t = party.t;
    if (t % 60 === 0 && spy.record.present && !spy.record.gone) this.liveRanks.push({ t, ...rankOf(party.people, party.memory, party.ident, t, spy.id) });
    const d = this.aheadDigests.get(t);
    if (d !== undefined && this.parted < 0 && party.digest() !== d) this.parted = t;
  }

  /** Whether a headless render may be taken: the look-ahead has run the whole evening, or there is none to wait for. */
  get settled(): boolean {
    return !this.revealed || !this.party?.spy || !this.worker || !!this.ahead?.done;
  }

  /** The look-ahead for the evening as the lab has it now: a worker started afresh whenever that changes (a provocation, a nudge, new odds, a new house). */
  private lookAhead(): void {
    if (!this.revealed || !this.party?.spy || typeof Worker === "undefined") return;
    const ask = this.host.evening();
    const key = JSON.stringify(ask);
    if (key === this.aheadKey) return;
    this.worker?.terminate();
    this.worker = null;
    this.aheadKey = key;
    this.ahead = null;
    this.aheadDigests.clear();
    this.parted = -1;
    try {
      const w = new Worker(new URL("./ahead.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<AheadRecord>) => {
        if (e.data.key !== this.aheadKey) return;
        this.ahead = e.data;
        for (const d of e.data.digests) this.aheadDigests.set(d.t, d.digest);
      };
      w.onerror = (e) => {
        e.preventDefault();
        const t = this.ahead?.t ?? 0;
        this.ahead = { key, t, done: true, error: e.message || "it failed to start", spells: [], steps: [], tells: [], twins: [], ranks: [], digests: [] };
      };
      w.postMessage({ ...ask, key } satisfies AheadAsk);
      this.worker = w;
    } catch {
      this.worker = null;
    }
  }

  /** What the strip shows: the look-ahead's record while it is ahead of the evening played and agrees with it, else the evening's own. */
  private record(party: Party): StripRecord | null {
    const spy = party.spy;
    if (!spy) return null;
    const a = this.ahead;
    if (a && !a.error && this.parted < 0 && (a.done || a.t >= party.t)) return { t: a.done ? PARTY_LENGTH : a.t, spells: a.spells, steps: a.steps, tells: a.tells, ranks: a.ranks, ahead: true };
    return { t: party.t, spells: spy.covers.spells, steps: spy.plans.history, tells: spy.measure.tells, ranks: this.liveRanks, ahead: false };
  }

  /** The strip, once revealed: the covers' lanes, the plan's ticks, the tells' dots, its rank as a line, what isn't known yet dimmed, and now. */
  private drawStrip(party: Party): void {
    const rec = this.revealed ? this.record(party) : null;
    this.strip.hidden = !rec;
    if (!rec) return void (this.layout = null);
    const a = this.ahead;
    this.stripNote.textContent =
      !this.worker && !a
        ? "what has played (no look-ahead here)"
        : a?.error
          ? `the look-ahead stopped (${a.error}): what has played`
          : this.parted >= 0
            ? `the look-ahead parted from this evening at ${clockLabel(this.parted)}: what has played`
            : !a
              ? "the look-ahead is running"
              : rec.ahead
                ? a.done
                  ? "the whole evening, from the look-ahead"
                  : `the look-ahead has run to ${clockLabel(a.t)}`
                : "what has played; the look-ahead is behind";
    const c = this.stripCanvas;
    const lanes = COVERS.filter((x) => rec.spells.some((s) => s.cover === x));
    const ys = 1 + lanes.length * (LANE + LANE_GAP) + 1;
    const yt = ys + STEP_ROW + TELL_ROW / 2;
    const yr = ys + STEP_ROW + TELL_ROW;
    const H = yr + RANK_BAND;
    const W = c.clientWidth || this.strip.clientWidth || 300;
    const dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.height = `${H}px`;
    }
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const X = (t: number) => (t / PARTY_LENGTH) * W;
    const end = (s: Spell) => (s.to < 0 ? rec.t : s.to);
    lanes.forEach((cover, k) => {
      const y = 1 + k * (LANE + LANE_GAP);
      g.fillStyle = "rgba(233, 228, 216, 0.06)";
      g.fillRect(0, y, W, LANE);
      g.fillStyle = laneColor(cover);
      for (const s of rec.spells) if (s.cover === cover) g.fillRect(X(s.from), y, Math.max(1, X(end(s)) - X(s.from)), LANE);
    });
    for (const r of rec.steps) {
      const done = r.how === "done";
      const failed = r.how.startsWith("failed:");
      const h = done || failed ? STEP_ROW - 1 : 3;
      g.fillStyle = done ? INK : failed ? RED : MUTED;
      g.fillRect(Math.round(X(r.t)) - 0.5, ys + STEP_ROW - 1 - h, 1, h);
    }
    for (const x of rec.tells) {
      const col = TELL_COLOR[x.kind];
      const seen = x.view >= 0.5;
      g.beginPath();
      g.arc(X(x.t), yt, seen || x.seenBy.length ? 2.5 : 1.2, 0, 2 * Math.PI);
      if (seen) {
        g.fillStyle = col;
        g.fill();
      } else if (x.seenBy.length) {
        g.strokeStyle = col;
        g.lineWidth = 1;
        g.stroke();
      } else {
        g.globalAlpha = 0.45;
        g.fillStyle = col;
        g.fill();
        g.globalAlpha = 1;
      }
    }
    // Its rank: the band's top is the most suspected, its floor tenth or lower.
    g.fillStyle = "rgba(233, 228, 216, 0.08)";
    g.fillRect(0, yr + 1, W, 1);
    g.strokeStyle = RED;
    g.lineWidth = 1.25;
    g.beginPath();
    let prev = -Infinity;
    for (const r of rec.ranks) {
      const x = X(r.t);
      const k = r.score < SUSPECTED ? RANK_FLOOR : Math.min(r.rank, RANK_FLOOR);
      const y = yr + 1.5 + ((k - 1) / (RANK_FLOOR - 1)) * (RANK_BAND - 4);
      if (r.t - prev > RANK_GAP) g.moveTo(x, y);
      else g.lineTo(x, y);
      prev = r.t;
    }
    g.stroke();
    const known = X(rec.t);
    if (known < W) {
      g.fillStyle = "rgba(7, 8, 12, 0.6)";
      g.fillRect(known, 0, W - known, H);
    }
    g.fillStyle = INK;
    g.fillRect(Math.round(X(party.t)) - 1, 0, 2, H);
    this.layout = { W, lanes, ys, yt, yr, rec };
  }

  /** What is under the pointer on the strip, and where a click there jumps: 10 s before a tell, else that moment. */
  private hit(e: MouseEvent): { text: string; jump: number } | null {
    const L = this.layout;
    const party = this.party;
    if (!L || !party) return null;
    const r = this.stripCanvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const t = Math.max(0, Math.min(PARTY_LENGTH, (x / L.W) * PARTY_LENGTH));
    const px = (tt: number) => Math.abs((tt / PARTY_LENGTH) * L.W - x);
    const nearest = <T extends { t: number }>(xs: readonly T[], within: number): T | null => {
      let best: T | null = null;
      for (const v of xs) if (px(v.t) <= within && (!best || px(v.t) < px(best.t))) best = v;
      return best;
    };
    const rec = L.rec;
    if (y < L.ys - 1) {
      const cover = L.lanes[Math.floor((y - 1) / (LANE + LANE_GAP))];
      if (!cover) return { text: STRIP_TITLE, jump: t };
      const spells = rec.spells.filter((s) => s.cover === cover);
      return { text: `${COVER_LABEL[cover]}: ${spells.map((s) => `${clockLabel(s.from)}–${s.to < 0 ? "" : clockLabel(s.to)}`).join(", ")}`, jump: t };
    }
    if (y < L.ys + STEP_ROW) {
      const s = nearest(rec.steps, 4);
      return { text: s ? `${clockLabel(s.t)} ${PLAN_LABEL[s.what]}: ${howLabel(s.how)}` : `${clockLabel(t)}: no step ends here`, jump: t };
    }
    if (y < L.yr) {
      const v = nearest(rec.tells, 5);
      return v ? { text: `${this.tellNote(party, v)} · ${TELL_KIND[v.kind]}`, jump: Math.max(0, v.t - LEAD) } : { text: `${clockLabel(t)}: no tell here`, jump: t };
    }
    const k = nearest(rec.ranks, 4);
    return { text: k ? `${clockLabel(k.t)}: ${rankText(k)}` : `${clockLabel(t)}: not at the party, or not reached`, jump: t };
  }

  /** The tells filter: the latest so far, newest first, with who saw each, the perch's view and zoom, and the innocent twins that hour so far. */
  tellLines(party: Party, n: number): string[] {
    const spy = party.spy;
    if (!spy) return ["no spy tonight"];
    if (!this.revealed) return ["the spy's tells show once it is revealed"];
    const m = spy.measure;
    const out: string[] = [];
    for (let i = m.tells.length - 1; i >= 0 && out.length < n; i--) {
      const x = m.tells[i]!;
      const twins = m.inHour(Math.floor(x.t / 3600)).twins;
      out.push(`${clockLabel(x.t)}  ${this.tellNote(party, x).slice(clockLabel(x.t).length + 2)} · ${TELL_KIND[x.kind]} · ${twins} twin${twins === 1 ? "" : "s"} that hour`);
    }
    return out.length ? out : ["no tells yet"];
  }

  /**
   * The stats line once revealed: tells per real minute by kind and the innocent twins since it
   * came, the first tell anyone could see, its rank at dinner and at the end (the look-ahead's, or
   * as played), and its share of the step (with profile in the URL).
   */
  statsLine(party: Party): string {
    const spy = party.spy;
    if (!spy || !this.revealed) return "";
    const p = spy.record;
    if (p.arriveAt > party.t) return `the spy comes in at ${clockLabel(p.arriveAt)}`;
    const m = spy.measure;
    // Gone home, its minutes end as it made for the door.
    let until = party.t;
    for (let i = party.events.length - 1; p.gone && i >= 0; i--) {
      const e = party.events[i]!;
      if (e.kind === "spy" && e.note === "leave") {
        until = e.t;
        break;
      }
    }
    const real = Math.max(1, (until - p.arriveAt) / (60 * TIME_SCALE));
    const per = (k: number) => (k / real).toFixed(2);
    const by = (kind: Tell["kind"]) => m.tells.filter((x) => x.kind === kind).length;
    const first = m.tells.find((x) => x.kind !== "trace" && (x.view >= 0.5 || x.seenBy.length > 0));
    const rec = this.record(party);
    const dinner = party.programme.find((ph) => ph.id === "dinner");
    const atDinner = dinner ? rec?.ranks.filter((r) => r.t <= dinner.start).pop() : undefined;
    const last = rec?.ranks[rec.ranks.length - 1];
    const prof = party.profile;
    const total = prof ? Object.values(prof).reduce((a, b) => a + b, 0) : 0;
    return [
      `the spy: tells a real minute ${per(by("hard"))} hard, ${per(by("cover"))} soft, ${per(by("trace"))} traces · twins ${per(m.twins.length)}`,
      first ? `first tell anyone could see ${clockLabel(first.t)} (${Math.round((first.t - p.arriveAt) / 60)} min in)` : "no tell anyone could see yet",
      `at dinner ${atDinner ? rankText(atDinner) : "–"}, ${rec?.ahead && this.ahead?.done ? "at the end" : "now"} ${last ? rankText(last) : "–"}`,
      prof && total > 0 ? `${pct((prof.spy ?? 0) / total)} of the step` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  /** " in the study", for an event that names a room. */
  private at(e: PartyEvent): string {
    const r = e.room;
    if (r === undefined || r === -1 || !this.party) return "";
    return r === -2 ? " on the terrace" : ` in the ${this.party.bp.rooms[r]?.label.toLowerCase() ?? "room"}`;
  }

  /**
   * Whether the lab may show people's maps (the room count, the map overlay). The spy's own map
   * (the hall and the way to its goal) would give it away, and hiding it alone would too, so
   * until the reveal nobody's shows.
   */
  get mapsShown(): boolean {
    return this.revealed || !this.party?.spy;
  }

  /** The log's lines for the spy's doings, for tests and seeing through someone, and for people reacting to someone. */
  eventText(e: PartyEvent, n: (i: number | undefined) => string): string | null {
    const party = this.party;
    if (e.kind === "test") {
      // The outcome waits for the reveal: only an impostor bluffs or fails one.
      const out = this.revealed || !party?.spy ? TEST_LABEL[e.note ?? ""] : undefined;
      return `${n(e.actors[0])} tries a shared joke on ${n(e.actors[1])}${out ? `: ${out}` : ""}`;
    }
    if (e.kind === "challenge") {
      const [a, b, c] = [n(e.actors[0]), n(e.actors[1]), n(e.actors[2])];
      if (e.note === "sure") return `${a} is sure ${b} isn't who they seem`;
      if (e.note === "out-loud") return `${a} has it out with ${b}, out loud: who are you?`;
      if (e.note === "backed-away") return `${a} backs away from ${b}, to tell someone`;
      if (e.note === "silent") return `${a} says nothing, and keeps away from ${b}`;
      if (e.note === "told") return `${a} tells ${b} that ${c} isn't who they seem`;
      if (e.note === "compare") return `${a} has a quiet word with ${b} about ${c}`;
      if (e.note === "attack-seen") return `${a} sees ${b} attack ${c}, and backs away`;
      if (e.note === "came-to") return `${a} comes to, and backs away from ${b}`;
      if (e.note === "told-attack") return `${a} tells ${b} what ${c} did`;
      return `${a} and ${b}: ${e.note}`;
    }
    if (e.kind === "react") {
      const [a, b] = [n(e.actors[0]), n(e.actors[1])];
      if (e.note === "beckon") return `${a} beckons ${b} in`;
      if (e.note === "point") return `${a} points ${b} the way in`;
      if (e.note === "glass") return `${a} brings ${b} a flute`;
      if (e.note === "frown") return `${a} frowns at ${b}'s fumble`;
      if (e.note === "help") return `${a} steps over to help ${b}`;
      if (e.note === "puzzled") return `${a} looks at ${b} again, puzzled`;
      if (e.note === "shrug") return `${a} shrugs as ${b} turns it down`;
      if (e.note === "ask-again") return `${a} asks ${b} again`;
      if (e.note === "cool") return `${a} expected a warmer hello from ${b}`;
      if (e.note === "name") return `${b} doesn't know ${a}'s name`;
      if (e.note === "later") return `${a} puts ${b}'s tour off till later`;
      if (e.note === "prompt") return `${a} has a word in ${b}'s ear about the programme`;
      if (e.note === "garment") return e.actors.length > 1 ? `${a} finds something of ${b}'s by a garden door` : `${a} finds something lying by a garden door`;
      const found = FIND_LABEL[e.note ?? ""];
      if (found) return `${a} ${found}${this.at(e)}`;
      return `${a} reacts to ${b}: ${e.note}`;
    }
    if (e.kind === "down") {
      const [a, b] = [n(e.actors[0]), n(e.actors[1])];
      if (e.note === "dying") return `${a} is past saving in the spy's hands (${b})${this.at(e)}`;
      if (e.note === "dead") return `${a} dies${this.at(e)}`;
      if (e.note === "hidden") return `${a}'s body is hidden${this.at(e)}`;
      if (e.note === "left") return `${a}'s body lies in the open${this.at(e)}`;
      if (e.note === "collapsed") return `${a} lies out cold${this.at(e)}`;
      if (e.note === "came-to") return `${a} comes to${this.at(e)}`;
      return `${a}: ${e.note}`;
    }
    if (e.kind !== "spy" || !party) return null;
    const who = n(e.actors[0]);
    const [what, a, b, c] = (e.note ?? "").split(":");
    if (what === "arrive") return `the spy arrives ${SETUP_LABEL[a as SpySetup] ?? ""}: ${who}`;
    if (what === "cue") return `the spy (${who}) moves on to ${party.programme.find((ph) => ph.id === a)?.label.toLowerCase() ?? a}: ${HOW_LABEL[b as CueHow] ?? b}`;
    if (what === "give-up") return `the spy (${who}) gives its goal up for tonight`;
    if (what === "done") return `the spy (${who}) has done it: ${GOAL_LABEL[a as GoalKind] ?? a}`;
    if (what === "leave") return `the spy (${who}) makes for the door`;
    if (what === "tested") return `the spy (${who}) is tested by ${n(e.actors[1])}, and changes the subject`;
    if (what === "laughed-off") return `the spy (${who}) laughs off ${n(e.actors[1])}'s challenge and walks away`;
    if (what === "lie-low") return `the spy (${who}) lies low a while: talk stopped as it joined`;
    if (what === "beg-off") return `the spy (${who}) begs off ${a === "piano" ? "the piano" : a === "dance" ? "a dance" : a}, asked by ${n(e.actors[1])}`;
    if (what === "decline") return `the spy (${who}) turns down a dance with ${n(e.actors[1])}`;
    if (what === "leave-table") return `the spy (${who}) leaves the table: ${a === "bathroom" ? "the bathroom" : "a call in the hall"}`;
    // Its plan: what it plans, each step's start and end, each act, a break-off, a failure.
    const act = a as ActId;
    if (what === "plan")
      return `the spy (${who}) plans: ${(a ?? "")
        .split(",")
        .map((x) => PLAN_LABEL[x as PlanActionId] ?? x)
        .join(" → ")}`;
    if (what === "no-plan") return `the spy (${who}) sees no way to its goal yet`;
    if (what === "task") {
      if (a === "cover") return `the spy (${who}) looks at something else`;
      // A kill's task names its way: kill:strangled, kill:injection.
      if (a === "kill") return c ? `the spy (${who}): ${TASK_WHAT[`kill:${b}`] ?? b}, ${howLabel(c)}` : `the spy (${who}) sets about it: ${TASK_WHAT[`kill:${b}`] ?? b}`;
      const step = PLAN_LABEL[a as PlanActionId] ?? TASK_WHAT[a ?? ""] ?? a;
      return b ? `the spy (${who}): ${step}, ${howLabel(b)}` : `the spy (${who}) sets about it: ${step}`;
    }
    if (what === "risky") return `the spy (${who}) is ${ACT_LABEL[act] ?? a}${this.at(e)}`;
    if (what === "did") return `the spy (${who}): ${DID_LABEL[act] ?? a}`;
    if (what === "broke") return `the spy (${who}) stops ${ACT_LABEL[act] ?? a}: it noticed ${n(e.actors[1])}`;
    if (what === "fail") return `the spy (${who}) gives up on ${PLAN_LABEL[a as PlanActionId] ?? a} for a while: ${FAIL_LABEL[b ?? ""] ?? b}`;
    if (what === "tried") return `the spy (${who}) makes its first try at ${GOAL_LABEL[a as GoalKind] ?? a}`;
    if (what === "stashed") return `the spy (${who}) slips it into its coat`;
    // The kill (PR 5): closing in, the point of no return, the body.
    if (what === "kill") {
      const q = n(Number(b));
      if (a === "strangled") return `the spy (${who}) closes in on ${q} from behind`;
      if (a === "injection") return `the spy (${who}) comes up beside ${q}`;
      if (a === "grip") return `the spy (${who}) seizes ${q} from behind${this.at(e)}`;
      if (a === "jab") return `the spy (${who}) embraces ${q}, the needle goes in, and it walks them off like a drunk friend`;
      if (a === "drag") return `the spy (${who}) drags the body off: ${HIDE_LABEL[b as HidePlace] ?? b}`;
      if (a === "hidden") return `the spy (${who}) hides the body: ${HIDE_LABEL[b as HidePlace] ?? b}`;
      if (a === "left") return b === "fell" ? `the spy (${who}) leaves the body where it fell` : `the spy (${who}) lets go${b === "dropped" ? " on the drag" : ""}, seen, and walks off`;
      if (a === "end")
        return b === "dead"
          ? `the spy (${who}) is back at the party`
          : b === "survived"
            ? `the spy (${who}) is off: they're out cold, not dead`
            : `the spy (${who}) lets the moment go: ${b === "broken" ? "a hand on their shoulder, a word, and on" : "they moved off"}`;
    }
    if (what === "kill-seen") return `the spy (${who}) sees ${n(e.actors[1])} has seen it`;
    if (what === "drop-first") return `the spy (${who}) drops the theft: the kill comes first now`;
    if (what === "target-gone") return `the spy (${who}) has lost its target: they've gone home`;
    if (what === "up-from-dinner") return `the spy (${who}) gets up from the table`;
    // Its covers (PR 4): coming on and off, feeling watched, the habits and the tactics.
    if (what === "cover") return `the spy (${who}): ${COVER_LABEL[a as Cover] ?? a} ${b === "on" ? "comes on" : "goes off"}`;
    if (what === "watched") return `the spy (${who}) feels watched (${a === "test" ? "a test it failed" : "a wary look its way"}): ordinary life a while`;
    if (what === "return") return `the spy (${who}) goes back where it did something`;
    if (what === "tour") return `the spy (${who}) takes a look round on its own`;
    if (what === "startle") return `the spy (${who}) starts as ${n(Number(a))} comes in${this.at(e)}, then takes an interest in a painting`;
    if (what === "slip") return `the spy (${who}) walks out as the camera comes${a === "toilet" ? ", to the bathroom" : a === "drink" ? ", to the bar" : ""}`;
    if (what === "photo-stays") return `the spy (${who}) stays in the photo: ${PHOTO_STAY[a ?? ""] ?? a}`;
    if (what === "drop") return `the spy (${who}) drops the errand it was on${a === "glass" ? ", the glass left where it stood" : ""}`;
    if (what === "alibi") return `the spy (${who}) stages ${ALIBI_LABEL[a as AlibiKind] ?? a}${this.at(e)}: a reason to be away`;
    if (what === "claim") return `the spy (${who}) says it was in the ${party.bp.rooms[Number(a)]?.label.toLowerCase() ?? "?"}`;
    if (what === "spill") return `the spy (${who}) spills a drink down ${n(Number(a))}`;
    if (what === "carry") return `the spy (${who}) carries ${n(party.world.items.owner[Number(a)])}'s bag off`;
    if (what === "put-back") return `the spy (${who}) puts the bag back where it lay`;
    if (what === "put-down") return `the spy (${who}) sets the bag down`;
    if (what === "lights") return `the spy (${who}) leans on the switch, and the lights go out${this.at(e)}`;
    if (what === "bandage-off") return `the spy (${who}) takes its bandage off`;
    return `the spy (${who}): ${e.note}`;
  }

  /** Every refresh of the panel: the odds' chances, the button, and the card once revealed. */
  refresh(party: Party, selected: number, redraw: () => void): void {
    if (this.house !== party.bp) {
      // A new house hides the spy again, unless the URL asked for it shown; replaying this one (a seek back, new odds) keeps the reveal.
      this.house = party.bp;
      if (this.params.get("reveal") !== "1") {
        this.revealed = false;
        this.guess = null;
        this.button.disabled = false;
      }
    }
    if (this.party !== party) {
      this.party = party;
      this.odds0 = goalOdds(party.bp, party.places, this.odds);
      this.cells = [];
      this.cellsT = -1;
      this.cellsAt = -1e9;
      this.nextNote.textContent = "";
      this.liveRanks = [];
      this.jumpedTo = -1;
    }
    this.picked = selected;
    this.lastRefresh = redraw;
    if (this.nextRow) this.nextRow.hidden = !this.revealed;
    this.renderRanks(party);
    const spy = party.spy;
    if (!spy) {
      this.card.classList.remove("on");
      this.strip.hidden = true;
      return;
    }
    const odds = this.odds0!;
    for (const g of GOALS) {
      const c = this.chances.get(g);
      if (!c) continue;
      const unheld = odds[g] <= 0 && this.switches.get(g)!.checked;
      c.textContent = odds[g] > 0 ? pct(odds[g]) : unheld ? "not here" : "off";
      c.title = unheld ? "This house has nothing for it: no safe in a study, no ledger, or no statuette on a stand" : "";
    }
    if (this.stealInput) this.stealInput.disabled = odds.kill <= 0;
    const name = (i: number) => party.people[i]?.name ?? "?";
    if (!this.revealed) {
      this.button.textContent = selected >= 0 ? `is it ${name(selected)}?` : "reveal the spy";
      this.button.title = selected >= 0 ? "Guess that the picked person is the spy, then see" : "Show who the spy is";
      this.verdict.textContent = "";
    } else {
      this.button.textContent = "revealed";
      this.button.disabled = true;
      const g = this.guess;
      this.verdict.textContent = g ? `${g.who === spy.id || spy.selves.includes(g.who) ? "right" : "wrong"}: guessed ${name(g.who)} at ${clockLabel(g.t)}` : "";
    }
    this.renderCard(party, selected);
    this.lookAhead();
    this.drawStrip(party);
  }

  /** The ten the crowd suspects most, as it believes them to be; the spy's record marked once revealed. */
  private renderRanks(party: Party): void {
    const top = ranks(party.people, party.memory, party.ident, party.t, RANKS).filter((r) => r.score >= SUSPECTED);
    const spy = this.revealed ? (party.spy?.id ?? -1) : -1;
    this.rankHead.textContent = top.length ? "most suspected" : "most suspected: nobody yet";
    this.rankRows.forEach((b, k) => {
      const r = top[k];
      b.hidden = !r;
      if (!r) return void delete b.dataset.id;
      b.dataset.id = String(r.id);
      b.textContent = `${k + 1}. ${party.people[r.id]!.name} ${pct(r.score)}`;
      b.classList.toggle("spy", r.id === spy);
    });
  }

  /** The spy's card under the picked person's panel, in its plain lines, once revealed. */
  private renderCard(party: Party, selected: number): void {
    const spy = party.spy!;
    const box = this.card;
    box.classList.toggle("on", this.revealed);
    if (!this.revealed) return this.lines.replaceChildren();
    const name = (i: number) => party.people[i]?.name ?? "?";
    const p = spy.record;
    const roomLabel = (r: number) => (r === -2 ? "the terrace" : r >= 0 ? (party.bp.rooms[r]?.label.toLowerCase() ?? "?") : "outside");
    const lines: Array<string | HTMLElement> = [];
    // How it came and as whom.
    this.head.textContent = `the spy: ${p.name}`;
    const body = spy.bodies[0];
    if (spy.setup === "self") lines.push(`came as itself; nobody here knows it`);
    else
      lines.push(
        `came ${SETUP_LABEL[spy.setup]}: ${name(spy.victim)}, killed before the party${body ? `, ${body.place} (${body.t < 0 ? `${Math.round(-body.t / 60)} min before 19:00` : clockLabel(body.t)})` : ""}`,
      );
    if (spy.selves.length > 1) lines.push(`has worn ${spy.selves.map(name).join(" → ")}`);
    // Its goal and target, and any theft first.
    const goal = spy.goal;
    const target = goal.target >= 0 ? name(goal.target) : "";
    const what =
      goal.kind === "kill"
        ? `kill ${target}`
        : goal.kind === "bag"
          ? `go through ${target}'s bag`
          : goal.kind === "statuette"
            ? "take a statuette"
            : goal.kind === "safe"
              ? "open the safe"
              : goal.kind === "bug"
                ? "plant a bug"
                : "copy the ledger";
    const first = goal.first ? `, after taking ${goal.first.thing === "phone" ? "the phone" : "the papers"} from their ${FROM_LABEL[goal.first.from]}` : "";
    const dropped = spy.things.droppedFirst >= 0 ? ` (dropped ${clockLabel(spy.things.droppedFirst)})` : "";
    const tried = goal.triedAt !== null ? ` · first try ${clockLabel(goal.triedAt)}` : "";
    const left = goal.kind === "kill" && spy.kill.stats.survived > 0 ? ` · let them go alive${spy.kill.stats.survived > 1 ? ` ${spy.kill.stats.survived} times` : ""}` : "";
    const done = goal.doneAt !== null ? ` · done ${clockLabel(goal.doneAt)}` : spy.plans.parked ? " · its target went home" : left;
    lines.push(`goal: ${what}${first}${dropped}${tried}${done}`);
    if (goal.rooms.length) lines.push(`knows the way to ${goal.rooms.map(roomLabel).join(", ")}`);
    this.planLines(party, lines, name);
    this.coverLines(party, lines, roomLabel);
    this.findsLines(party, lines, name);
    // Its cue: the phase it acts on, how it caught it, and how far behind the room it is.
    const t = party.t;
    const cur = phaseIndexAt(party.programme, t);
    const c = spy.cues;
    if (spy.byCues) {
      const on = party.programme[c.phase]!;
      const behind = cur > c.phase ? ` · behind: the room has been on ${party.programme[cur]!.label.toLowerCase()} for ${mins(t - party.programme[cur]!.start)}` : "";
      const pend = c.pending ? ` · caught ${party.programme[c.pending.phase]!.label.toLowerCase()}, moves in ${mins(Math.max(0, c.pending.at - t))}` : "";
      lines.push(`acts on ${on.label.toLowerCase()} (${HOW_LABEL[c.how]}${c.since > 0 ? ` at ${clockLabel(c.since)}` : ""})${pend}${behind}`);
    } else lines.push(`keeps to the staff's routine`);
    if (spy.setup === "host") {
      const late = party.prompts.log.filter((r) => !r.ahead);
      lines.push(
        `prompted by the household at ${party.prompts.log.length} change${party.prompts.log.length === 1 ? "" : "s"}${late.length ? `, ${mins(late.reduce((s, r) => s + r.delay, 0))} late in all` : ""}`,
      );
    }
    // What it knows of people, its drink and its exit.
    const studied: number[] = [];
    for (let j = 0; j < spy.knows.length; j++) if (spy.knows[j] === 2) studied.push(j);
    lines.push(spy.setup === "self" ? "studied nobody" : `studied ${studied.length ? studied.map((j) => `${name(j)} ${pct(spy.close[j]!)}`).join(", ") : "none of their people"}`);
    // Seen through: the tests put to it, who is sure it isn't who it seems and what they did, and whom it thinks dangerous.
    const ev = party.events;
    const tests = ev.filter((e) => e.kind === "test" && e.actors[1] === spy.id);
    const sure = ev.filter((e) => e.kind === "challenge" && e.actors[1] === spy.id && e.note === "sure");
    if (spy.victim >= 0) {
      const by = (note: string) => tests.filter((e) => e.note === note).length;
      const did = (i: number) => SURE_LABEL[ev.find((e) => e.kind === "challenge" && e.actors[0] === i && e.actors[1] === spy.id && SURE_LABEL[e.note ?? ""])?.note ?? ""];
      const begged = ev.filter((e) => e.kind === "spy" && e.note?.startsWith("beg-off")).length;
      lines.push(`tested ${tests.length} time${tests.length === 1 ? "" : "s"}: bluffed ${by("bluffed")}, failed ${by("failed")}${begged ? ` · begged off ${begged}` : ""}`);
      lines.push(
        sure.length ? `sure it isn't ${name(spy.victim)}: ${sure.map((e) => `${name(e.actors[0])}${did(e.actors[0]!) ? ` (${did(e.actors[0]!)})` : ""}`).join(", ")}` : "nobody sure of it yet",
      );
    }
    const top = spy.answers.top(5);
    lines.push(top.length ? `most dangerous to it: ${top.map((x) => `${name(x.id)} ${pct(x.danger)} (${x.why.map((w) => WHY_LABEL[w]).join(", ")})`).join(" · ")}` : "thinks nobody dangerous yet");
    // Silencing someone sure of it: whom it follows now, or whom it silenced.
    const sil = spy.silence;
    const silenced = ev.find((e) => e.kind === "spy" && /^silence:(dead|survived):/.test(e.note ?? ""));
    if (sil.trailing >= 0) lines.push(`following ${name(sil.trailing)}, sure of it, to silence them`);
    else if (silenced) {
      const [, out, who] = silenced.note!.split(":");
      lines.push(`${out === "dead" ? "silenced" : "tried to silence"} ${name(Number(who))} at ${clockLabel(silenced.t)}${out === "dead" ? "" : ", who lived"}`);
    }
    if (spy.victim >= 0) {
      const unseen = party.people.filter((q) => q.id !== spy.id && q.present && !q.gone && party.ident.tieOf(q.id, spy.id) >= 3 && spy.answers.danger[q.id] === 0);
      lines.push(unseen.length ? `close to ${name(spy.victim)}, not spotted yet: ${unseen.map((q) => q.name).join(", ")}` : `has spotted every close tie of ${name(spy.victim)}'s here`);
    }
    lines.push(`tipsy ${pct(p.tipsy)} · ${p.drinkLog.length} drink${p.drinkLog.length === 1 ? "" : "s"}`);
    const exit = spy.exit;
    const when = `goes once ${pct(exit.at)} of the farewell's leavers are on their way`;
    const go = party.byeAt < 0 ? "stays at least until the farewell's first goodbye" : exit.why === "gave-up" ? `gave up at the first goodbye (${clockLabel(party.byeAt)}); ${when}` : when;
    lines.push(p.gone ? "gone home" : go);
    if (spy.garment) {
      const g = spy.garment;
      const row = document.createElement("span");
      const sw = document.createElement("i");
      sw.className = "swatch";
      sw.style.background = g.color;
      const left = party.world.items.stateOf(g.item) === "lost";
      row.append(`dropped ${name(spy.victim)}'s `, sw, ` ${g.what} by a garden door${left ? "" : " (picked up)"}`);
      lines.push(row);
    }
    const m = spy.measure;
    const seen = m.tells.filter((x) => x.kind !== "trace" && x.seenBy.length).length;
    const hard = m.tells.filter((x) => x.kind === "hard");
    lines.push(
      `tells ${m.tells.length} (${seen} seen by someone) · hard ${hard.length} (${hard.filter((x) => x.seenBy.length).length} seen, ${hard.filter((x) => x.view >= 0.5).length} the perch could see) · innocent twins ${m.twins.length}`,
    );
    this.lines.replaceChildren(
      ...lines.map((l) => {
        const d = document.createElement("div");
        if (typeof l === "string") d.textContent = l;
        else d.appendChild(l);
        return d;
      }),
    );
    box.classList.toggle("picked", selected === spy.id);
  }

  /**
   * Its plan: the steps as last made (the one under way in bold, and how far it has got), who is
   * in the way of the moment it waits for, what was true as it planned, what it keeps off a
   * while, and how its last few steps went.
   */
  private planLines(party: Party, lines: Array<string | HTMLElement>, name: (i: number) => string): void {
    const spy = party.spy!;
    const pl = spy.plans;
    const t = party.t;
    if (!spy.byCues) return void lines.push("plans nothing yet: keeps the staff's routine (PR 5)");
    const cur = pl.current;
    if (pl.steps.length && spy.goal.doneAt === null && !pl.parked) {
      const row = document.createElement("span");
      row.append("plan: ");
      let marked = false;
      pl.steps.forEach((a, k) => {
        if (k) row.append(" → ");
        if (cur && !marked && a === cur.action) {
          marked = true;
          const b = document.createElement("b");
          b.textContent = `${PLAN_LABEL[a]} (${STAGE_LABEL[cur.stage]})`;
          row.append(b);
        } else row.append(PLAN_LABEL[a]);
      });
      lines.push(row);
    } else if (spy.goal.doneAt === null && !pl.parked) lines.push(t < 20 * 60 ? "no plan yet: nothing before 19:20, while the host watches the door" : "no plan made yet");
    if (cur?.stage === "waiting" && cur.act && pl.check && !pl.check.ok) {
      const mode = spy.things.spec(cur.act).mode;
      lines.push(`waits to be ${mode ?? "unseen"}; in the way: ${pl.check.by.map((x) => `${name(x.who)} (${WAY_LABEL[x.why]})`).join(", ")}`);
    }
    if (pl.facts)
      lines.push(
        `as it last planned: ${factNames(pl.facts)
          .map((f) => FACT_LABEL[f] ?? f)
          .join(", ")}`,
      );
    const off = [...pl.blocked].filter(([, until]) => until > t);
    if (off.length) lines.push(`keeps off: ${off.map(([a, until]) => `${PLAN_LABEL[a]} till ${clockLabel(until)}`).join(", ")}`);
    const last = pl.history.slice(-4).reverse();
    if (last.length) lines.push(`last steps: ${last.map((r) => `${clockLabel(r.t)} ${PLAN_LABEL[r.what]}: ${howLabel(r.how)}`).join(" · ")}`);
    const s = pl.stats;
    if (s.started) lines.push(`steps ${s.started} started, ${s.done} done, ${s.broken} broken off, ${s.failed} failed · waited for the moment ${s.tries}×`);
  }

  /**
   * Its covers: those on now (their minutes so far and when each goes off), its lying low, those on
   * earlier, what its habits and tactics have done, the alibi in play, and how often it felt watched.
   */
  private coverLines(party: Party, lines: Array<string | HTMLElement>, roomLabel: (r: number) => string): void {
    const spy = party.spy!;
    const c = spy.covers;
    const t = party.t;
    const min = (x: Cover) => `${Math.round(c.totalOf(x) / 60)} min`;
    const on = c.list;
    lines.push(
      on.length
        ? `covers on: ${on
            .map((x) => {
              const st = c.state[COVERS.indexOf(x)]!;
              return `${COVER_LABEL[x]} ${min(x)}${st.forced ? " (held on)" : st.next < Infinity ? `, off ${clockLabel(st.next)}` : ""}`;
            })
            .join(" · ")}`
        : "no covers on",
    );
    if (spy.answers.lowUntil > t) lines.push(`lies low till ${clockLabel(spy.answers.lowUntil)}: no habit shows, and no risky step`);
    const earlier = COVERS.filter((x) => !on.includes(x) && c.totalOf(x) > 0);
    if (earlier.length) lines.push(`on earlier: ${earlier.map((x) => `${COVER_LABEL[x]} ${min(x)}`).join(", ")}`);
    const h = spy.habits.stats;
    const did = [
      h.returns ? `went back ${h.returns}×` : "",
      h.tours ? `${h.tours} tour${h.tours === 1 ? "" : "s"} alone (${h.rattles} handles tried, ${h.peeks} looks in)` : "",
      h.startles ? `started ${h.startles}×` : "",
      h.followed ? `close behind its target ${h.followed}×` : "",
      h.slipped || h.stayed ? `walked out of a photo ${h.slipped}×, stayed in ${h.stayed}×` : "",
      h.drops ? `dropped ${h.drops} errand${h.drops === 1 ? "" : "s"} (${h.asked} came looking)` : "",
    ].filter(Boolean);
    if (did.length) lines.push(`habits: ${did.join(" · ")}`);
    const k = spy.tactics.stats;
    const used = [
      k.alibis ? `${k.alibis} alibi${k.alibis === 1 ? "" : "s"} (${ALIBI_KINDS_USED(k)}; ${k.washes} wash${k.washes === 1 ? "" : "es"}, ${k.claims} said where it was)` : "",
      k.spills ? `spilled on its target ${k.spills}×` : "",
      k.carried ? `carried a bag off ${k.carried}×` : "",
      k.lights ? `put the lights out ${k.lights}×` : "",
    ].filter(Boolean);
    if (used.length) lines.push(`tactics: ${used.join(" · ")}`);
    const a = spy.tactics.alibi;
    if (a)
      lines.push(
        `alibi: ${ALIBI_LABEL[a.kind]}${a.opened ? ` from ${clockLabel(a.from)}` : " (not shown yet)"}, ${ALIBI_STAGE[a.stage]}${a.room >= 0 ? `; says it was in the ${roomLabel(a.room)}` : ""}${a.to >= 0 ? ` till ${clockLabel(a.to)}` : ""}`,
      );
    const w = c.stats;
    if (w.glances || w.tests) lines.push(`felt watched ${w.glances + w.tests}× (${w.glances} wary looks, ${w.tests} tests)`);
  }

  /** What the crowd has found of its work, and the finds still to come: the host's look in on the safe, the statuette's watchers, bags set down. */
  private findsLines(party: Party, lines: Array<string | HTMLElement>, name: (i: number) => string): void {
    const f = party.finding;
    const spy = party.spy!;
    if (!f) return;
    const found = party.events.filter((e) => e.kind === "react" && FIND_LABEL[e.note ?? ""]);
    lines.push(found.length ? `found: ${found.map((e) => `${clockLabel(e.t)} ${name(e.actors[0]!)} ${FIND_LABEL[e.note!]}`).join(" · ")}` : "nobody has found anything yet");
    if (spy.things.statuette >= 0) {
      let knew = 0;
      let tonight = 0;
      for (let i = 0; i < f.knewAt.length; i++) {
        if (f.knewAt[i]! < 0) continue;
        knew++;
        if (f.knewAt[i]! > 0) tonight++;
      }
      lines.push(`the statuette's stand: ${knew} would miss it (${tonight} saw it there tonight)${f.stats.lookers ? ` · ${f.stats.lookers} came over to look` : ""}`);
    }
    if (f.studyAt >= 0) lines.push(`the host looks in on the safe at ${clockLabel(f.studyAt)}`);
    else if (f.stats.study) lines.push("the host has looked in on the safe");
    const bags = party.bags.stats;
    if (bags.down) lines.push(`bags set down ${bags.down}×, taken back ${bags.back}×${f.stats.checks ? ` · ${name(spy.goal.target)} looked in their things ${f.stats.checks}×` : ""}`);
    else if (f.stats.checks) lines.push(`${name(spy.goal.target)} looked in their things ${f.stats.checks}×`);
  }
}
