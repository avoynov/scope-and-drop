/**
 * One evening at the mansion, stepped on a fixed in-game tick.
 *
 *   const party = new Party(generateMansion({ seed: 'gala-night' }), { seed: 'gala-night' });
 *   party.advance(60);            // one in-game minute
 *   party.people[3].action?.id;   // what someone is doing
 *
 * Pure data and deterministic: the same blueprint and seed give the same night.
 */
import type { MansionBlueprint, RoomType } from "../mansion/core/types";
import { Rng } from "../mansion/core/rng";
import { resolveOffers, type Offer } from "./ads";
import { Bags, type BagsHost } from "./bags";
import { Body, type BodyHost } from "./body";
import { BOND_EVERY, Bonds, SLIP_EVERY, WATCHFUL, type BondsHost } from "./bonds";
import { makeProgramme, PARTY_LENGTH, phaseIndexAt, phaseProgress, TIME_SCALE, type Phase, type PhaseId } from "./clock";
import { generateCast, type CastOptions } from "./cast";
import { castDramas, DRAMA_EVERY, Dramas, type CardId, type DramasHost, type MishapId } from "./dramas";
import { Groups, type GroupsHost } from "./groups";
import { HOUSE, Ident, PASSED, SLIP_SKILLS, TEST, TIE_WEIGHT, type IdentEvent, type TestOutcome, type Tie } from "./ident";
import { Memory, KNOWN, PASS_ON, SUSPICIOUS, VERBS, type MemoryHost, type Verb } from "./memory";
import { beside, choose, decay, destination, LAST_TOAST, PHASE_WEIGHTS, spotKey, toAction, type Candidate, type MindWorld } from "./mind";
import { Mood, type MoodOverride } from "./mood";
import { Pathfinder } from "./path";
import { facing, resolvePlaces, RoomCells, yawTo, type Places } from "./places";
import { Practices, type PracticesHost } from "./practices";
import { Prompts, type PromptsHost } from "./prompts";
import { Reactions, type ReactionsHost } from "./reactions";
import { CASES, Register, type CaseKind, type CaseTalk, type RegisterHost } from "./register";
import { DETAIL_RANGE, Senses, type Sound, type SoundKind, type SensesHost } from "./senses";
import { Sight } from "./sight";
import { AGREE_TOUR, castSpy, Finds, goalRooms, Spy, studied, type CueHow, type SpyHost, type SpyOptions } from "./spy";
import { asItself, dress } from "./spy/swap";
import { Tasks, type Step, type Task, type TaskHost, type TaskKind } from "./tasks";
import {
  DRINKS,
  SKILLS,
  type ActionId,
  type ActionState,
  type DrinkId,
  type Gesture,
  type Group,
  type Held,
  type PartyEvent,
  type Person,
  type Pose,
  type Seat,
  type Skill,
  type Spot,
  type Waypoint,
} from "./types";
import { DRINK_IDS, World } from "./world";

/**
 * Something planted at a time: the lab's buttons, and the tests. A fact (the default) goes
 * straight into someone's head. A thing gone is noticed from a room (the subject is whose it
 * was, -1 the house's) and opens a case. A sighting puts the subject in a room, seen by the
 * witness with their own eyes; it moves nobody. A spark draws the subject and the witness to
 * each other (they flirt when next together); a grudge is one the witness holds against the subject.
 * A mishap befalls the subject there and then; a drama is a card played now (dramas.ts). A test
 * sends the subject's closest tie who is here over to test them now (milestone 3); a swap has the
 * spy go after the subject's place at its first good chance, murder held on (spy/swap.ts).
 */
export interface Provocation {
  /** It lands on the first step after this time, as one planted live at this time does. */
  t: number;
  kind?: "fact" | "gone" | "seen" | "spark" | "grudge" | "mishap" | "drama" | "test" | "swap";
  /** The mishap that befalls the subject, or the card played (with the subject, if one fits, else whoever the card picks; -1 lets it pick). */
  what?: MishapId | CardId;
  /** Defaults to a rumour (juicy, a little odd). */
  verb?: Verb;
  subject: number;
  /** Where a thing went missing, or where the subject was seen (defaults to where the witness, or the subject, is). */
  room?: number;
  /** Who hears it first (who notices a thing gone, who saw the subject); defaults to the first guest in a conversation who isn't the subject (for a thing gone, its owner, else the host). */
  witness?: number;
  /** Suspicion weight, overriding the verb's. */
  odd?: number;
}

export interface PartyOptions extends CastOptions {
  /** Seed for the cast and every choice; defaults to the blueprint's seed. */
  seed?: string;
  /** Lab nudges to the mood: set someone's tension, or scale their energy, at a time. */
  mood?: MoodOverride[];
  /** Facts planted at a time. */
  provoke?: Provocation[];
  /** Time each stage of the step into `party.profile` (ms). */
  profile?: boolean;
  /** A spy among the guests (milestone 3): off by default; `true` draws everything, options pin parts of it. */
  spy?: boolean | SpyOptions;
}

/** What the party has noticed so far, for the lab and the tests. */
export interface PartyStats {
  facts: number;
  told: number;
  overheard: number;
  doubleTakes: number;
  tests: number;
  wrongTurns: number;
  asks: number;
  hushes: number;
  heard: number;
  sightings: number;
  /** Connecting the dots: cases opened, settled on someone, things that didn't fit, descriptions put a name to, claims heard, groups asked. */
  cases: number;
  blames: number;
  conflicts: number;
  recognised: number;
  claims: number;
  askedAround: number;
  /** Everyday life: tasks run (tours, errands and the drinks among them a guest fetched for a friend in their circle, partner searches and how many found them, candid shots, the group photo, departures). */
  tours: number;
  errands: number;
  fetched: number;
  searches: number;
  found: number;
  candids: number;
  photos: number;
  leaves: number;
  /** Circles: let in, turned away, lingering on at a closed one, split in two; greetings; norms broken. */
  joins: number;
  rebuffs: number;
  ghosts: number;
  splits: number;
  greetings: number;
  breaches: number;
  /** Ties: couples and friendships made, flirtations, affairs and partners who found out, rows and what they cost, friends followed onto the floor, couples slipping away. */
  couples: number;
  friendships: number;
  flirtations: number;
  rebuffed: number;
  affairs: number;
  foundOut: number;
  confrontations: number;
  /** A sharp word that blows over, and rows proper (a slap, a shove or a scuffle among them). */
  spats: number;
  rows: number;
  fellOut: number;
  madeUp: number;
  pulled: number;
  staffFriends: number;
  slipAways: number;
  /** Trouble: mishaps, the oddballs' habits seen in action (outings, startles, turning from a camera) and the small dramas played. */
  mishaps: number;
  habits: number;
  dramas: number;
  /** Out of step with the programme: people still not with the toast or dinner three minutes on, beckoned in, pointed the way, brought a flute (reactions.ts). */
  late: number;
  beckons: number;
  points: number;
  flutes: number;
  /**
   * Seen through (milestone 3): fumbles that added doubt, greetings cooler than a tie, notes compared, people sure someone isn't who they
   * seem and challenges out loud; fumbles frowned at, helped with and requests turned down; the host prompted, tours asked for, the garden's finds.
   */
  slips: number;
  cool: number;
  compared: number;
  sure: number;
  challenges: number;
  frowns: number;
  helps: number;
  shrugs: number;
  prompts: number;
  tourAsks: number;
  finds: number;
}

/** In-game seconds per sim step (a sixth of a real second). */
export const STEP = 0.5;
/** Metres per real second on a stair. */
const CLIMB_SPEED = 0.55;
/** How long something other than a glass stays in hand (in-game s); a glass lasts as long as its drink (body.ts). */
const HOLD_LIFE: Partial<Record<Held, number>> = { cigarette: 400 };
/** When, within the toast phase, glasses go up. */
const RAISE = [0.45, 0.62] as const;
/** Actions that need both hands: a glass is set down first. */
const HANDS_FREE: ReadonlySet<ActionId> = new Set(["dance", "games", "toilet", "dinner", "leave"]);
/** What people can be doing when a waiter offers a glass. */
const OFFER_TO: ReadonlySet<ActionId> = new Set(["arrive", "mingle", "sit", "dinner", "art", "wander", "terrace", "toast", "use", "snack"]);
/** How far ahead (m) a walker looks for a door to open. */
const DOOR_LOOK = [0, 0.2, 0.4, 0.6] as const;
/** A door this open lets people through. */
const DOOR_PASS = 0.9;
/** A corner of a route this close counts as reached when the next leg is open from here (m). */
const CORNER = 0.3;
/** Giving way: how far ahead (m) and how wide a lane walkers watch, and the most they shift aside in a step (m). */
const SIDESTEP_AHEAD = 1.5;
const SIDESTEP_LANE = 0.5;
const SIDESTEP_MAX = 0.15;
/** Rooms staff never step into on their rounds. */
const PRIVATE: ReadonlySet<RoomType> = new Set(["bathroom", "bedroom", "dressing-room", "study"]);
/** Rooms a guest has no business in: coming out of one is noticed. */
const SNOOP: ReadonlySet<RoomType> = new Set(["bedroom", "dressing-room", "study"]);
/** Rooms the staff know only roughly (they serve the party rooms, the hall and the kitchen). */
const STAFF_ROUGH: ReadonlySet<RoomType> = new Set(["bedroom", "dressing-room", "study"]);
/** Actions on the way to which a junction can go wrong (programme trips follow the crowd). */
const LOSES_WAY: ReadonlySet<ActionId> = new Set(["toilet", "mingle", "drink", "sit", "art", "terrace", "dance", "games", "use", "snack", "greet"]);
/** What a nosy guest drops to go and see what that noise was. */
const DROP_TO_LOOK: ReadonlySet<ActionId> = new Set(["mingle", "sit", "art", "wander", "terrace", "use"]);
/** Doing something where talk happens without a conversation of its own: at table, in the toast ring, on a sofa, outside, round the kitchen counter. */
const SIDE_TALK: ReadonlySet<ActionId> = new Set(["dinner", "toast", "sit", "terrace", "use", "snack"]);
/** Beside someone, for side talk (m). */
const SIDE_NEAR = 1.6;
/** What someone can be doing and still wave to a friend just seen; and what they drop to go over and say hello. */
const WAVE_FROM: ReadonlySet<ActionId> = new Set(["arrive", "mingle", "drink", "sit", "art", "terrace", "dance", "games", "wander", "use", "snack"]);
const GREET_FROM: ReadonlySet<ActionId> = new Set(["wander", "art", "terrace", "use", "snack"]);
/** Partners look for each other when not seen for this long (in-game s); the plus-one sooner. Nobody goes looking more than SEARCHES times. */
const SEARCH_AFTER = 17 * 60;
const SEARCH_AFTER_PLUS_ONE = 9 * 60;
const SEARCHES = 2;
/** The host shows guests round at most this many times, this far apart (in-game s), offering at this share of the chances. */
const TOURS = 4;
const TOUR_GAP = 20 * 60;
const TOUR_CHANCE = 0.4;
/** Guests still here head home from this long before the end (in-game s), one by one until HURRY_OUT, when the rest, and the leaving still under way, hurry. */
const LAST_OUT = 8 * 60;
export const HURRY_OUT = 5 * 60;
/** The photographer's candid rounds (in-game s apart). */
const CANDID: readonly [number, number] = [180, 300];
/** A musician's set lasts until the programme says otherwise (in-game s); the band looks again whenever it changes. */
const BAND_SET = 1800;
/** Chance a speaker passes something on at the start of a turn (times 0.4 + their talkativeness). */
const GOSSIP = 0.25;
/** Chance, every two in-game seconds, that someone at table or on a sofa says something to a neighbour (times 0.3 + talk). */
const SIDE_GOSSIP = 0.02;
/** How well someone knows the bathroom they've just been pointed to: a little better than the rooms on the way. */
const POINTED = 0.4;
/** A pause to look round after a wrong turn (in-game s). */
const LOOK_ROUND = 2;
/** Tasks seen through whatever the programme says: leaving, the photo, slipping away, a mishap, a drama, a habit. */
const COMMITTED: ReadonlySet<TaskKind> = new Set(["leave", "photo", "elope", "mishap", "drama", "habit", "spy"]);
/** Asking someone in the circle to bring a drink: the chance each check (every 5 in-game s) for the thirsty and empty-handed, about as often as a waiter is beckoned to a sofa; the phases it happens in; and the odd refusal. */
const ASK_DRINK = 0.03;
const ASK_PHASES: ReadonlySet<PhaseId> = new Set(["arrival", "mingle", "dancing", "games"]);
const ASK_REFUSED = 0.05;
const NO_CANDIDATES: readonly Candidate[] = [];
/** A first-time guest in the host's circle asks to be shown round: from 19:30, the curious, at this chance a speaker's turn. */
const TOUR_ASK_FROM = 30 * 60;
const TOUR_CURIOUS = 0.6;
const TOUR_ASK = 0.01;
/** Fumbles on the floor and at the piano, checked every half minute: these × (1 − skill)², dancing × (1 + tipsiness) too. */
const DANCE_FUMBLE = 0.25;
const PIANO_FUMBLE = 0.3;
/** The skills a fumble is of (ident.ts SLIP_SKILLS). */
const DANCE = SKILLS.indexOf("dance");
const PIANO = SKILLS.indexOf("piano");
/** Sure at last (milestone 3): too nervous or too tipsy for anything but keeping away. */
const TIMID_NERVES = 0.6;
const TIMID_TIPSY = 0.5;
/** Out loud: only in company (someone else within this of the one challenged, m); free onlookers this close turn to watch for a while. */
const OUT_LOUD_NEAR = 6;
const WATCH: readonly [number, number] = [20, 40];
/** Someone missing (milestone 3): the case's window opens this long before they were last seen (in-game s). */
const MISSING_BEFORE = 2 * 60;
/**
 * Doubt from seeing someone challenged (× tie weight), from notes compared (the listener's × tie
 * weight × (0.5 + trust in the teller); the teller's own), and from being told by someone sure.
 * Comparing notes with someone who had doubts of their own (past the test's 0.45), each of the two
 * takes CORROBORATED more: someone else noticed too. A scene and a word from someone sure are
 * striking: that doubt fades three times slower (ident.ts STRIKING).
 */
const CHALLENGED = 0.1;
const COMPARED = 0.15;
const COMPARED_SELF = 0.05;
const CORROBORATED = 0.25;
const TOLD_SURE = 0.3;
/** What can be dropped to act on being sure. */
const SURE_DROPS: ReadonlySet<ActionId> = new Set(["mingle", "sit", "art", "wander", "terrace", "use", "snack", "dance", "games", "greet", "drink"]);
/**
 * Something lying outside, in this much light or more, can be spotted in a look's detail cone: a
 * look's chance is FIND_CHANCE × its attention × the light × how near it lies (in full underfoot,
 * none at the cone's edge). By a garden door the light through it is DOORWAY_LIGHT, or the garden
 * lamps' when brighter. A finder who knew whose it is doubts the one who came as them by
 * GARMENT_DOUBT × tie weight, a striking find.
 */
export const FIND_LIGHT = 0.25;
const FIND_CHANCE = 0.02;
const DOORWAY_LIGHT = 0.5;
export const GARMENT_DOUBT = 0.25;

/** Which drinks the waiters carry: champagne before the toast, wine at dinner, a mix after. */
const bandOf = (id: PhaseId): Body["band"] => (id === "dinner" ? "dinner" : id === "dancing" || id === "games" || id === "farewell" ? "after" : "before");

export class Party implements MindWorld, BodyHost, MemoryHost, SensesHost, RegisterHost, GroupsHost, TaskHost, PracticesHost, BondsHost, DramasHost, ReactionsHost, SpyHost, PromptsHost, BagsHost {
  readonly bp: MansionBlueprint;
  readonly pf: Pathfinder;
  readonly cells: RoomCells;
  /** Doors, curtains, lights and every thing people carry, lock or lose. */
  readonly world: World;
  /** Bathrooms, drinks, tipsiness and bumps. */
  readonly body: Body;
  /** Who can see whom, through which doors and windows. */
  readonly sight: Sight;
  /** Last seen, facts, gossip, suspicion and everyone's mental map of the house. */
  readonly memory: Memory;
  /** Energy and tension, per person. */
  readonly mood: Mood;
  /** How people know each other by sight. */
  readonly ident: Ident;
  /** Each person's cases, sightings and claims: connecting the dots. */
  readonly register: Register;
  /** Looking and listening. */
  readonly senses: Senses;
  /** Conversation circles, joining, splitting and greetings. */
  readonly circles: Groups;
  /** Tours, errands, searches, the photographs and saying goodbye. */
  readonly tasks: Tasks;
  /** The rituals: the toast's hush, the host sitting first, the opening dance, the band's break, last call. */
  readonly practices: Practices;
  /** Flirting, couples, friendships, grudges, rows, affairs and finding out. */
  readonly bonds: Bonds;
  /** Mishaps, the oddballs' habits and the evening's small dramas. */
  readonly dramas: Dramas;
  /** People reacting to someone out of step with the programme, or fumbling what they do well, spy or not. */
  readonly reactions: Reactions;
  /** The household keeping the host to the programme: the real host's rare late announcement, and every one of a fake host's. */
  readonly prompts: Prompts;
  /** The spy (milestone 3), or null on an evening without one. */
  readonly spy: Spy | null;
  /** What the crowd finds of the spy's work (spy/finds.ts): with a spy only. */
  readonly finding: Finds | null;
  /** Bags set down on a chair or a table and taken back (bags.ts), every evening. */
  readonly bags: Bags;
  /** When the farewell's first goodbye was said (-1 not yet): the spy never goes before it. */
  byeAt = -1;
  /** How many guests had gone home or set off by then (the household aside), counting the first goodbye. */
  private byeGoing = 0;
  /** What the house offers (advertisements resolved for this house). */
  readonly offers: readonly Offer[];
  /** Camera flashes, newest last (the renderer pulses a light for each). */
  readonly flashes: Array<{ t: number; level: number; x: number; z: number; room: number }> = [];
  /** Per-stage time (ms) when the party was made with `profile`. */
  readonly profile: Record<string, number> | null;
  readonly places: Places;
  readonly programme: Phase[];
  readonly people: Person[];
  readonly events: PartyEvent[] = [];
  readonly rng: Rng;
  t = 0;
  private phaseIdx = 0;
  private reserved = new Map<string, number>();
  private seats = new Map<string, number>();
  private announceUntil = -1;
  /** Draws for things (coats, bags), kept apart so they don't shift the minds' choices. */
  private readonly things: Rng;
  /** The door each person is standing in (-1 none), to close it behind them. */
  private readonly doorIn: Int32Array;
  /** When a waiter last set off toward each person, so two don't converge on the same one. */
  private readonly offeredAt: Float64Array;
  private stops = new Map<number, number>();
  private floorY: number[] = [];
  private levelY = new Map<number, number>();
  private terraceY: number;
  private stepNo = 0;
  /** Draws for wrong turns, and for who speaks up and what gets passed on, kept apart from the minds'. */
  private readonly mapRng: Rng;
  private readonly chat: Rng;
  private readonly provoke: Provocation[];
  private provoked = 0;
  /** Mood overrides; the mood reads this list, so one added later still applies. */
  private readonly nudges: MoodOverride[];
  /** Which bathroom someone was pointed to (-1 nobody knew), by asker. */
  private readonly answers = new Map<number, number>();
  /** People within 3 m of each other in the same room, and how many each has round them (for the mood). */
  private pairs = new Int16Array(0);
  private pairDist = new Float32Array(0);
  private nPairs = 0;
  private readonly crowd: Uint8Array;
  /** When each person last took a wrong turn: once lost, they mind the way for the rest of the trip. */
  private readonly lostAt: Float64Array;
  private counts = { wrongTurns: 0, asks: 0, hushes: 0, heard: 0, challenges: 0, tourAsks: 0, finds: 0, fetched: 0 };
  /** Draws for tours asked of the host, fumbles on the floor and at the piano, a confrontation's onlookers and the garden's finds, kept apart from the minds'. */
  private readonly tourAsks: Rng;
  private readonly fumbles: Rng;
  private readonly through: Rng;
  private readonly finds: Rng;
  /** Who has asked the host for a tour tonight, and who has found the garment. */
  private readonly askedTour: Uint8Array;
  private readonly foundIt: Uint8Array;
  /** How well the garden's lamps light the garment (0 when there is none). */
  readonly garmentLight: number = 0;
  /** Sure someone isn't who they seem, and meaning to do something about it when next free: whom (-1 none), until it's done; and whether they have backed away to tell someone yet. */
  private readonly sureOf: Int16Array;
  private readonly backedAway: Uint8Array;
  /** Saw the spy at a kill (milestone 3, PR 5): the fact of it (-1 none), until they have told someone; and each witness's victims, so each is told of once. */
  private readonly alarmOf: Int32Array;
  private readonly alarms = new Set<number>();
  /** Gone without a goodbye (milestone 3, PR 5): out of play where they lie; and whom each person keeps in view, the one they blame for their partner or friend going missing (-1 none). */
  private readonly leftPlay: Uint8Array;
  private readonly watching: Int16Array;
  /** Whom someone walking over to compare notes, or to tell, is talking about; and whom someone told goes to look for the real one of. */
  private readonly about = new Map<number, number>();
  private readonly lookFor = new Map<number, number>();
  /** Draws for staff routines, errands, tours, searches and departures, kept apart from the minds'. */
  private readonly life: Rng;
  /** Draws for guests asking each other to bring a drink (milestone 3, PR 4), kept apart from the rest of life's. */
  private readonly asks: Rng;
  /** Guests who go home tonight (all but staff and the host). */
  private readonly leavers: Person[];
  /** Where the band plays: three spots at the edge of the dance room, facing the floor. */
  private readonly bandstand: Spot[];
  /** Coats handed in at the door that the attendant has still to hang. */
  private pendingCoats = 0;
  /** Once-a-night moments, by name, and when each staff routine is next due. */
  private readonly done = new Set<string>();
  private readonly due = new Map<string, number>();
  private lastTour = -1e9;
  /** The good whisky's item id (-1 when the house has nowhere to keep it). */
  private bottle = -1;

  constructor(bp: MansionBlueprint, opts: PartyOptions = {}) {
    this.bp = bp;
    const root = new Rng(`party/${opts.seed ?? bp.seed}`);
    this.rng = root.fork("minds");
    this.pf = new Pathfinder(bp);
    this.cells = new RoomCells(this.pf);
    this.world = new World(bp, this.pf, root.fork("world"));
    this.pf.setGate(this.world);
    this.places = resolvePlaces(bp, this.pf, this.cells, this.world);
    this.programme = makeProgramme(root.fork("programme"));
    this.people = generateCast(root.fork("cast"), this.places, opts);
    // The oddballs, the deck and the stranger are settled before anyone knows anyone.
    const dramaRng = root.fork("dramas");
    const dramaCast = castDramas(dramaRng, this.people, this.programme, this.places);
    // Then the spy, from its own fork, so every draw before it comes out as it always has. It
    // changes no record until the minds that remember people exist, except that coming as itself
    // it is nobody's friend.
    const spyRng = root.fork("spy");
    const spyOpts = opts.spy === true ? {} : opts.spy || null;
    const spyCast = spyOpts ? castSpy(spyRng.fork("cast"), this.people, dramaCast, bp, this.places, spyOpts) : null;
    if (spyCast?.setup === "self") asItself(this.people[spyCast.record]!, spyCast.own, this.people);
    this.body = new Body(this, root.fork("body"));
    this.sight = new Sight(bp, this.pf, this.world);
    this.memory = new Memory(this, bp.rooms.length, root.fork("gossip"));
    this.nudges = [...(opts.mood ?? [])];
    this.mood = new Mood(this.people, this.nudges);
    this.ident = new Ident(this.people, root.fork("ident"));
    // Playing someone killed before the party: the record takes the spy's body, mind and voice, and everyone remembers the victim.
    const impostor = spyCast && spyCast.victim >= 0 ? this.people[spyCast.record]! : null;
    if (impostor) {
      dress(impostor, spyCast!.own, true);
      this.ident.recast(impostor, spyCast!.own.voice);
      this.ident.impostor(impostor.id, (i) => this.spy!.answers.answer(i));
    }
    this.ident.onTest = (i, j, out) => this.tested(i, j, out);
    this.register = new Register(this, bp.rooms.length, (r) => SNOOP.has(bp.rooms[r]!.type), root.fork("register"));
    this.memory.onTold = (i, f, from) => {
      this.register.told(i, f, from);
      this.bonds.told(i, f, from);
    };
    this.senses = new Senses(this, root.fork("senses"));
    this.offers = resolveOffers(bp, this.pf, this.cells, this.places);
    this.circles = new Groups(this, root.fork("circles"));
    this.tasks = new Tasks(this, root.fork("tasks"));
    this.practices = new Practices(this, root.fork("practices"));
    this.bonds = new Bonds(this, root.fork("bonds"));
    if (impostor) this.bonds.setTemper(impostor.id, spyCast!.own.temper);
    this.dramas = new Dramas(this, dramaCast, dramaRng, root.fork("mishaps"));
    this.life = root.fork("life");
    this.asks = root.fork("asks");
    this.leavers = this.people.filter((p) => !p.staff && p.role !== "host");
    this.bandstand = this.findBandstand();
    this.mapRng = root.fork("map");
    this.chat = root.fork("groups");
    this.provoke = [...(opts.provoke ?? [])].sort((a, b) => a.t - b.t);
    this.profile = opts.profile ? {} : null;
    this.crowd = new Uint8Array(this.people.length);
    this.lostAt = new Float64Array(this.people.length).fill(-1e9);
    this.askedTour = new Uint8Array(this.people.length);
    this.foundIt = new Uint8Array(this.people.length);
    this.sureOf = new Int16Array(this.people.length).fill(-1);
    this.backedAway = new Uint8Array(this.people.length);
    this.alarmOf = new Int32Array(this.people.length).fill(-1);
    this.leftPlay = new Uint8Array(this.people.length);
    this.watching = new Int16Array(this.people.length).fill(-1);
    this.tourAsks = root.fork("tour-asks");
    this.fumbles = root.fork("fumbles");
    this.through = root.fork("through");
    this.finds = root.fork("finds");
    this.things = root.fork("things");
    this.doorIn = new Int32Array(this.people.length).fill(-1);
    this.offeredAt = new Float64Array(this.people.length).fill(-1e9);
    this.shelveThings();
    for (const r of bp.rooms) this.floorY[r.index] = r.floorY;
    for (const l of bp.levels) this.levelY.set(l.index, l.floorY);
    this.terraceY = bp.site.terrace.y;
    this.knowTheHouse();
    let spy: Spy | null = null;
    if (spyCast) {
      const rooms = goalRooms(spyCast.goal, bp, this.places);
      this.spyMap(spyCast.record, rooms, spyRng.fork("map"));
      const g = spyCast.garment;
      const garment = g ? { item: this.world.items.add("garment", "lost", spyCast.victim, -1, g.at, 0), view: this.gardenView(g.at) } : null;
      spy = new Spy(
        this,
        spyCast,
        studied(spyCast, this.people, (i, j) => this.ident.tieOf(i, j)),
        rooms,
        garment,
        spyRng,
        spyOpts!.on,
      );
    }
    this.spy = spy;
    this.bags = new Bags(this, root.fork("bags"));
    this.finding = spy ? new Finds(this, spy, root.fork("missed")) : null;
    this.bags.listener = this.finding;
    if (spy?.garment) this.garmentLight = Math.max(DOORWAY_LIGHT, this.gardenLight(this.world.items.x[spy.garment.item]!, this.world.items.z[spy.garment.item]!));
    this.reactions = new Reactions(this, root.fork("react"));
    // The real host's rare late announcement is drawn whatever plays the host, so it comes the same with the spy off.
    this.prompts = new Prompts(this, root.fork("host"));
    this.prompts.fake = spy?.setup === "host";
    // Staff and the host are in place before the first guest arrives.
    for (const p of this.people) {
      if (!p.staff && p.role !== "host") continue;
      const at = this.staffPost(p) ?? this.places.entrance;
      this.place(p, at);
      p.present = true;
    }
    // Playing the host or a waiter, the spy is here from the start; so is a host it means to rob of a phone.
    if (spy?.record.present) spy.arrived();
    if (spy) for (const p of this.people) if (p.present) spy.things.arrived(p);
  }

  get host(): Person {
    return this.people.find((p) => p.role === "host")!;
  }

  /** Conversations (the circles' own map). */
  get groups(): Map<number, Group> {
    return this.circles.map;
  }

  get phase(): Phase {
    return this.programme[this.phaseIdx]!;
  }

  get over(): boolean {
    return this.t >= PARTY_LENGTH;
  }

  /** The phase running now (the real programme). */
  get phaseIndex(): number {
    return this.phaseIdx;
  }

  /** The record the spy lives in, or -1. */
  get spyId(): number {
    return this.spy?.id ?? -1;
  }

  phaseOf(p: Person): { id: PhaseId; progress: number } {
    const ph = this.programme[p.phaseSeen]!;
    return { id: ph.id, progress: phaseProgress(ph, this.t) };
  }

  taken(key: string): boolean {
    return this.reserved.has(key);
  }

  seatTaken(seat: Seat): boolean {
    return this.seats.has(seat.id);
  }

  worthTrying(p: Person, i: number): boolean {
    return this.body.worthTrying(p, i);
  }

  glassFill(p: Person): number {
    const items = this.world.items;
    return p.item >= 0 && items.kindOf(p.item) === "glass" ? items.fill[p.item]! : 0;
  }

  /** Advance by `seconds` of in-game time in fixed steps. */
  advance(seconds: number): void {
    const end = this.t + seconds;
    while (this.t + STEP <= end + 1e-9 && !this.over) this.step();
  }

  step(): void {
    const dt = STEP;
    const prof = this.profile;
    let t0 = prof ? performance.now() : 0;
    const lap = (stage: string) => {
      if (!prof) return;
      const now = performance.now();
      prof[stage] = (prof[stage] ?? 0) + now - t0;
      t0 = now;
    };
    this.t += dt;
    this.stepNo++;
    // A change the host is late for is held while the household prompts them (prompts.ts).
    this.prompts.step();
    const idx = phaseIndexAt(this.programme, this.t);
    if (idx !== this.phaseIdx) {
      this.phaseIdx = idx;
      this.body.band = bandOf(this.phase.id);
      // Champagne is called: every waiter fetches a full tray of flutes.
      if (this.phase.id === "champagne") {
        for (const w of this.people) {
          if (w.role !== "waiter" || !w.present) continue;
          this.end(w, false);
          this.stops.set(w.id, 99);
          w.thinkAt = this.t;
        }
      }
      // The band and the butler change what they do with the programme.
      for (const q of this.people) {
        if ((q.role !== "musician" && q.role !== "butler") || !q.present || q.action?.id === "task") continue;
        this.end(q, false);
        q.thinkAt = this.t;
      }
      this.log("phase", [], undefined, this.phase.label);
      this.announceUntil = this.t + 15;
      this.log("announce", [this.host.id], this.host.room, this.phase.label);
      // Playing the host, the spy acts on what it has just announced in a few seconds.
      if (this.spy && this.spy.id === this.host.id) this.spy.told();
      // The band strikes up: everyone can find the dance floor by ear. The host says where the games are, and how to get there.
      const pl = this.places;
      const to = this.phase.id === "dancing" ? pl.danceSpots.slice(0, 1) : this.phase.id === "games" ? pl.games.map((g) => g.spots[0]!) : [];
      for (const s of to) {
        for (const p of this.people) {
          if (!p.present || p.staff) continue;
          this.memory.pointed(p.id, this.roomsOnTheWay(p, s, p));
          this.memory.startKnowing(p.id, s.room, 0.5);
        }
      }
    }
    const ph = this.phase;
    // Glasses go up once, on the step that crosses the raise.
    if (ph.id === "toast" && phaseProgress(ph, this.t - dt) < RAISE[0] && phaseProgress(ph, this.t) >= RAISE[0]) {
      this.log("toast", [this.host.id], this.host.room);
      // Anyone in the ring with nothing to raise stands out.
      for (const p of this.people) if (!p.staff && p.present && p.action?.id === "toast" && p.held !== "champagne") this.notable(p, "no-champagne", -1, 20);
    }
    this.provokeDue();
    this.practices.step(this.stepNo);

    this.body.beginStep();
    for (const p of this.people) {
      if (p.gone) continue;
      if (!p.present) {
        if (this.t >= p.arriveAt) this.arrive(p);
        continue;
      }
      // Down (milestone 3): no needs, no programme, no going home, no plans; walked, carried or dragged by whoever's task holds them.
      if (p.down) {
        if (p.action) this.act(p, dt);
        this.updatePose(p);
        continue;
      }
      this.updateNeeds(p, dt);
      this.updatePhase(p);
      // Guests look at the time every other second; the spy, once the farewell's first goodbye is said, every step, so it sets off among the first half even when many go at once.
      if (p.id === this.spyId ? this.byeAt >= 0 : !p.staff && p.role !== "host" && (p.id + this.stepNo) % 4 === 0) this.departure(p);
      if (!p.present) continue;
      // Someone known, seen for the first time tonight: a wave, and for those free to, going over to say hello.
      if (!p.staff && (p.id + this.stepNo) % 4 === 1) this.maybeGreet(p);
      // A cigarette burns down; a glass is set down when its drink runs out (body.ts).
      if (p.held && p.item < 0 && this.t >= p.heldUntil) p.held = null;
      if (!p.action) {
        if (this.t >= p.thinkAt) this.think(p);
      }
      if (p.action) this.act(p, dt);
      this.updatePose(p);
    }
    lap("people");
    this.separate(dt);
    lap("separate");
    this.body.endStep(dt);
    this.world.step(dt);
    lap("body");
    this.updateGroups();
    if (this.stepNo % 4 === 0) this.sideTalk();
    if (this.stepNo % 60 === 0) this.circles.sample();
    if (this.stepNo % 10 === 0) this.everyday();
    if (this.stepNo % 60 === 0) this.floorFumbles();
    // Out of step with the programme: doing something else through the toast or dinner.
    if ((ph.id === "toast" || ph.id === "dinner") && this.stepNo % 20 === 0) this.outOfStep();
    lap("talk");
    // The spy's cues, then people reacting to anyone out of step, just before everyone looks.
    this.spy?.step();
    this.finding?.step();
    if (this.stepNo % 20 === 0) this.reactions.step();
    lap("spy");
    this.senses.step(this.stepNo);
    lap("senses");
    this.mood.applyOverrides(this.t);
    if (this.stepNo % 2 === 0) {
      this.findPairs();
      this.mood.step(2 * dt, (p) => this.moodInput(p), this.pairs, this.pairDist, this.nPairs);
    }
    lap("mood");
    if (this.stepNo % BOND_EVERY === 0) this.bonds.step(this.pairs, this.pairDist, this.nPairs, BOND_EVERY * dt);
    if (this.stepNo % Math.round(SLIP_EVERY / dt) === 0) this.bonds.slipCheck();
    lap("bonds");
    if (this.stepNo % DRAMA_EVERY === 0) {
      this.dramas.step();
      this.dramas.settle();
    }
    this.dramas.afterStep();
    lap("dramas");
    if (this.stepNo % 120 === 0) this.memory.upkeep(120 * dt);
    lap("memory");
  }

  // ----------------------------------------------------------------- people

  private place(p: Person, s: Spot | Waypoint): void {
    p.level = s.level;
    p.x = s.x;
    p.z = s.z;
    if ("yaw" in s) p.yaw = s.yaw;
    p.room = this.pf.roomAt(s.level, s.x, s.z);
    p.y = this.floorAt(p.level, p.room);
  }

  private floorAt(level: number, room: number): number {
    if (room >= 0) return this.floorY[room] ?? this.levelY.get(level) ?? 0;
    if (room === -2) return this.terraceY;
    return this.levelY.get(level) ?? 0;
  }

  private arrive(p: Person): void {
    const e = this.places.entrance;
    const off = this.pf.snap(e.level, e.x + this.rng.range(-0.6, 0.6), e.z + this.rng.range(-0.6, 0.6), 1) ?? e;
    this.place(p, { ...e, x: off.x, z: off.z });
    p.present = true;
    const spy = this.spy;
    if (spy && p.id === spy.id) spy.arrived();
    p.phaseSeen = spy && p.id === spy.id ? spy.phase : phaseIndexAt(this.programme, this.t - p.phaseLag);
    this.memory.walkInto(p.id, p.room);
    this.log("arrive", [p.id], p.room);
    this.arriveWithThings(p);
    // Greet the host if they are by the door, else step into the hall.
    const host = this.host;
    let target: Spot | null = null;
    if (host.present && host.level === e.level && Math.hypot(host.x - e.x, host.z - e.z) < 8) {
      const a = this.rng.range(-0.8, 0.8) + host.yaw;
      const w = this.pf.snap(host.level, host.x + Math.sin(a) * 1.0, host.z + Math.cos(a) * 1.0, 0.8);
      if (w) target = { level: w.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, host.x, host.z), room: this.pf.roomAt(w.level, w.x, w.z) };
    }
    target ??= this.places.entranceRoom ? this.cells.random(this.places.entranceRoom.index, this.rng) : null;
    if (target) this.start(p, { id: "arrive", target, duration: this.rng.range(20, 40), pose: "greet", gain: { social: 0.1 } });
    this.dramas.arrived(p);
  }

  private updateNeeds(p: Person, dt: number): void {
    const k = dt / 60;
    decay(p, k);
    // A stray doesn't miss their partner.
    if (p.partner !== null && !this.bonds.stray[p.id]) {
      const q = this.people[p.partner]!;
      const near = q.present && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 8;
      p.needs.companion = Math.max(0, Math.min(1, p.needs.companion + (near ? 0.03 : -0.01) * k));
    } else p.needs.companion = 1;
    // Sipping a drink in hand keeps thirst at bay.
    if (p.item >= 0 && p.held && DRINKS.has(p.held)) p.needs.thirst = Math.min(1, p.needs.thirst + 0.008 * k);
  }

  /** People act on the phase they believe is running, a little after it starts; the spy on the one its cues gave it. */
  private updatePhase(p: Person): void {
    const lag = p.staff || p.role === "host" ? 0 : p.phaseLag;
    const idx = p.id === this.spyId ? this.spy!.phase : phaseIndexAt(this.programme, this.t - lag);
    const a = p.action;
    if (idx !== p.phaseSeen) {
      p.phaseSeen = idx;
      if (!a) return;
      const id = this.programme[idx]!.id;
      // Someone in a bathroom or waiting at its door sees it through, and so does anyone on their way home, in the group photo or caught up in a mishap or a drama; most else gives way to the programme.
      const committed = (a.id === "toilet" && a.note !== "door") || a.id === "row" || (a.id === "task" && this.committedTask(p));
      const keep = p.staff ? true : p.role === "host" ? committed : committed || ((PHASE_WEIGHTS[id][a.id] ?? 0) >= 0.3 && a.id !== "toast" && a.id !== "dinner");
      if (!keep && a.id !== "leave" && a.id !== "arrive") this.end(p, false);
      return;
    }
    // The last toast ends partway through the farewell.
    if (a?.id === "toast" && this.programme[p.phaseSeen]!.id === "farewell" && this.phaseOf(p).progress >= LAST_TOAST) this.end(p, false);
  }

  private think(p: Person): void {
    // Safety net: never plan from somewhere nobody can stand.
    if (!this.pf.walkable(p.level, p.x, p.z)) {
      const w = this.pf.snap(p.level, p.x, p.z, 6);
      if (w) this.place(p, w);
    }
    // Saw someone attacked: off to tell someone. Sure someone isn't who they seem: have it out, or go and tell someone.
    if (this.alarmOf[p.id]! >= 0 && this.actOnAlarm(p)) return;
    if (this.sureOf[p.id]! >= 0 && this.actOnSure(p)) return;
    if (p.staff) return this.staffThink(p);
    if (p.role === "host") {
      const c = this.hostPlan(p);
      if (c) return void this.start(p, c);
      // The spy playing the host offers nobody a tour (it turns most requests down).
      if (p.id !== this.spyId && this.maybeTour(p)) return;
    }
    // Back for a bag left on a chair to dance, play or change (bags.ts).
    if (this.bags.fetch(p)) return;
    // The spy's plan takes its next step when one can start; otherwise it lives the evening like anyone.
    if (p.id === this.spyId && this.spy!.think(p)) return;
    // Someone who didn't seem quite themselves: go and say hello, and settle it.
    const j = this.ident.wantTest[p.id]!;
    if (j >= 0) {
      const q = this.people[j]!;
      if (q.gone || q.down) this.ident.wantTest[p.id] = -1;
      else if (q.present && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 15 && this.memory.lastT[p.id * this.people.length + j]! > this.t - 60) {
        const s = beside(q, p, this.pf);
        if (s) return void this.start(p, { id: "ask", target: s, duration: 5, pose: "talk", gain: { social: 0.1 }, ref: j, note: "test" });
      }
    }
    // Doubts that outlived a test: a word with someone else who knows them well.
    const k = this.ident.wantCompare[p.id]!;
    if (k >= 0 && this.walkToCompare(p, k)) return;
    // Worked out who took something of the house's: go and tell the host, when they're about.
    if (this.register.tellFor(p.id) >= 0) {
      const h = this.host;
      if (h.present && !h.gone && h.level === p.level && Math.hypot(h.x - p.x, h.z - p.z) < 25 && this.memory.lastT[p.id * this.people.length + h.id]! > this.t - 120) {
        const s = beside(h, p, this.pf);
        if (s) return void this.start(p, { id: "ask", target: s, duration: 6, pose: "talk", gain: { social: 0.1 }, ref: h.id, note: "tell" });
      }
    }
    if (p.role !== "host" && (this.maybeSearch(p) || this.maybeFetch(p))) return;
    const c = choose(p, this);
    if (!c) {
      p.thinkAt = this.t + 5;
      return;
    }
    this.start(p, c);
  }

  /** The host keeps the programme: greets at the door, leads toasts, heads the table, sees guests off. The spy playing the host keeps the one its cues gave it. */
  private hostPlan(p: Person): Candidate | null {
    const ph = p.id === this.spyId ? this.programme[p.phaseSeen]! : this.phase;
    const pr = phaseProgress(ph, this.t);
    const door = this.doorPost();
    if (ph.id === "arrival" || (ph.id === "farewell" && pr >= LAST_TOAST)) return door ? { id: "staff", target: door, duration: 90, pose: "greet", gain: { social: 0.2 }, note: "door" } : null;
    if (ph.id === "champagne" || ph.id === "toast" || ph.id === "farewell")
      return { id: "toast", target: this.places.toastSpot, duration: 99999, pose: "stand", gain: { social: 0.2 }, programme: true };
    if (ph.id === "dinner") {
      const seat = p.seat !== null ? this.places.diningSeats[p.seat] : undefined;
      if (seat) return { id: "dinner", target: seat.approach, seat, duration: 99999, pose: "sit", gain: { hunger: 1 }, programme: true };
    }
    // The host couple open the dancing, alone on the floor for the first minute.
    const floor = this.places.danceSpots[0];
    if (ph.id === "dancing" && pr < 0.05 && floor && !this.done.has("host-danced")) {
      this.done.add("host-danced");
      return { id: "dance", target: floor, duration: this.rng.range(180, 300), pose: "dance", gain: { dance: 0.8, social: 0.2 }, key: spotKey(floor) };
    }
    return null;
  }

  private doorPost(): Spot | null {
    const e = this.places.entrance;
    const w = this.pf.snap(e.level, e.x + Math.sin(e.yaw) * 1.6, e.z + Math.cos(e.yaw) * 1.6, 1.2);
    return w ? { level: w.level, x: w.x, z: w.z, yaw: e.yaw + Math.PI, room: this.pf.roomAt(w.level, w.x, w.z) } : null;
  }

  /** Where a member of staff starts the evening. */
  private staffPost(p: Person): Spot | null {
    const pl = this.places;
    switch (p.role) {
      case "host":
        return this.doorPost();
      case "bartender":
        return pl.bars[pl.bars.length - 1] ?? null;
      case "cook":
      case "kitchenHand":
        return pl.kitchen[0] ?? null;
      case "waiter":
        return (pl.kitchen.length ? this.rng.pick(pl.kitchen) : pl.bars[0]) ?? null;
      case "butler":
        return this.besideDoor(1.4);
      case "cloakroom":
        return this.besideDoor(-1.4) ?? pl.chains.coats.spots[0] ?? null;
      case "musician":
        return this.bandSpot(p);
      default:
        return this.cells.random(pl.toastRoom.index, this.rng);
    }
  }

  /** A spot beside the host's place at the door, `side` metres to their left (negative: right). */
  private besideDoor(side: number): Spot | null {
    const d = this.doorPost();
    if (!d) return null;
    const f = facing(d.yaw + Math.PI / 2);
    const w = this.pf.snap(d.level, d.x + f.x * side, d.z + f.z * side, 0.8);
    return w ? { level: w.level, x: w.x, z: w.z, yaw: d.yaw, room: this.pf.roomAt(w.level, w.x, w.z) } : null;
  }

  /** Start a member of staff on something at a spot; false (and a think later) when there is no spot. */
  private staffAt(p: Person, s: Spot | null | undefined, duration: number, pose: Pose, note: string): boolean {
    if (!s) {
      p.thinkAt = this.t + 10;
      return false;
    }
    this.start(p, { id: "staff", target: s, duration, pose, gain: {}, note });
    return true;
  }

  /** Each member of staff keeps to their part of the evening (A Real Party: The staff's choreography). */
  private staffThink(p: Person): void {
    const pl = this.places;
    const rng = this.rng;
    switch (p.role) {
      case "butler":
        return this.butlerThink(p);
      case "cloakroom":
        return this.cloakroomThink(p);
      case "musician":
        return this.musicianThink(p);
      case "photographer":
        return this.photographerThink(p);
      case "kitchenHand":
        return this.kitchenHandThink(p);
      case "waiter":
        return this.waiterThink(p);
      case "bartender": {
        const s = pl.bars[pl.bars.length - 1];
        if (s) return void this.start(p, { id: "staff", target: s, duration: rng.range(300, 900), pose: "serve", gain: {}, key: spotKey(s), note: "bar" });
        break;
      }
      case "cook": {
        const room = pl.kitchen[0]?.room;
        const s = room !== undefined && room >= 0 ? this.cells.random(room, rng) : null;
        if (s) return void this.start(p, { id: "staff", target: s, duration: rng.range(60, 200), pose: "stand", gain: {}, note: "cook" });
        break;
      }
      default:
        break;
    }
    p.thinkAt = this.t + 10;
  }

  /** Waiters (and the butler with the brandy after dinner): load a tray, then a round of stops offering it. The spy playing a waiter takes its plan's next step between rounds, the tray set down first. */
  private waiterThink(p: Person): void {
    const pl = this.places;
    const rng = this.rng;
    const stops = this.stops.get(p.id) ?? 0;
    if (this.body.trayCount(p) === 0 || stops >= 4) {
      if (p.id === this.spyId && this.spy!.think(p)) {
        this.body.setDown(p);
        this.stops.set(p.id, 0);
        return;
      }
      // Reload at the bar or the kitchen; the nearest when a toast is waiting on it.
      const near = this.phase.id === "champagne" || this.phase.id === "toast";
      const away = (s: Spot) => Math.hypot(s.x - p.x, s.z - p.z) + 15 * Math.abs(s.level - p.level);
      const src = near
        ? ([...pl.bars, ...pl.kitchen].sort((a, b) => away(a) - away(b))[0] ?? null)
        : pl.bars.length && (!pl.kitchen.length || rng.chance(0.5))
          ? rng.pick(pl.bars)
          : pl.kitchen.length
            ? rng.pick(pl.kitchen)
            : null;
      if (src) {
        this.stops.set(p.id, 0);
        return void this.start(p, { id: "staff", target: src, duration: rng.range(25, 45), pose: "serve", gain: {}, note: "load" });
      }
    }
    // Champagne and the toast: hop from one empty-handed guest to the next. Dinner: the dining room.
    // Otherwise round the room they're in while it has guests in it, now and then another room.
    const ph = this.phase.id;
    const toast = ph === "champagne" || ph === "toast";
    const rooms = pl.mingleRooms.length ? pl.mingleRooms : [pl.toastRoom.index];
    const stay = rooms.includes(p.room) && rng.chance(0.65) && this.leavers.some((q) => q.present && q.room === p.room);
    const s = (toast && this.emptyHanded(p)) || this.cells.random(ph === "dinner" && pl.dining ? pl.dining.index : toast ? pl.toastRoom.index : stay ? p.room : rng.pick(rooms), rng, 0.5);
    if (s) {
      this.stops.set(p.id, stops + 1);
      return void this.start(p, { id: "staff", target: s, duration: toast ? rng.range(12, 25) : rng.range(35, 70), pose: "serve", gain: {}, note: "serve" });
    }
    p.thinkAt = this.t + 10;
  }

  /**
   * The butler: at the door with the host as guests arrive, the good whisky fetched to the bar
   * before dinner, a look over the table and a word in the host's ear, the sideboard through
   * dinner, the brandy round after, and the door again as people leave.
   */
  private butlerThink(p: Person): void {
    const ph = this.phase;
    const pr = phaseProgress(ph, this.t);
    const pl = this.places;
    const next = this.programme[this.phaseIdx + 1]?.id;
    if (ph.id === "mingle" && next === "dinner") {
      if (pr > 0.25 && !this.done.has("whisky")) {
        this.done.add("whisky");
        if (this.whiskyRun(p)) return;
      }
      const host = this.host;
      if (pr > 0.75 && !this.done.has("table") && pl.dining && host.present) {
        this.done.add("table");
        const s = this.cells.random(pl.dining.index, this.life, 0.8);
        if (s) {
          this.tasks.chore(p, [
            { do: "goto", to: s, label: "to-table" },
            { do: "wait", s: 20, pose: "look", label: "check-table" },
            { do: "meet", who: host.id, label: "to-host" },
            { do: "say", who: host.id, s: 3, pose: "talk", label: "dinner-ready" },
          ]);
          return;
        }
      }
    }
    if (ph.id === "arrival" || (ph.id === "farewell" && pr >= LAST_TOAST)) return void this.staffAt(p, this.besideDoor(1.4), 90, "stand", "door");
    if (ph.id === "dinner") return void this.staffAt(p, this.sideboard(), 120, "stand", "sideboard");
    if (ph.id === "dancing" || ph.id === "games") return this.waiterThink(p);
    this.staffAt(p, this.cells.random(pl.toastRoom.index, this.life, 0.8), 90, "stand", "watch");
  }

  /** The good whisky from the cabinet to the bar, at the host's word. */
  private whiskyRun(p: Person): boolean {
    const spirits = this.places.chains.spirits;
    const from = spirits.spots[0];
    const bartender = this.people.find((q) => q.role === "bartender" && q.present);
    if (this.bottle < 0 || !from || !bartender || spirits.link === "bar" || this.world.items.stateOf(this.bottle) !== "shelved") return false;
    return !!this.tasks.errand("whisky", p, this.host, this.bottle, from, bartender);
  }

  /** In front of the dining room's sideboard, facing the table; anywhere in the room without one. */
  private sideboard(): Spot | null {
    const dining = this.places.dining;
    if (!dining) return null;
    const prop = this.bp.props.find((q) => q.kind === "sideboard" && q.roomId === dining.id);
    if (prop) {
      const f = facing(prop.yaw);
      const w = this.pf.snap(prop.level, prop.x + f.x * (prop.d / 2 + 0.6), prop.z + f.z * (prop.d / 2 + 0.6), 1);
      if (w && this.pf.roomAt(w.level, w.x, w.z) === dining.index) return { level: w.level, x: w.x, z: w.z, yaw: prop.yaw, room: dining.index };
    }
    return this.cells.random(dining.index, this.life, 0.5);
  }

  /** The cloakroom attendant: coats from the door to the rail as guests arrive, then the cloakroom until people leave. */
  private cloakroomThink(p: Person): void {
    const coat = this.places.chains.coats.spots[0] ?? null;
    if (this.pendingCoats > 0 && coat) {
      this.pendingCoats--;
      p.held = "coat";
      p.heldUntil = this.t + 600;
      return void this.staffAt(p, coat, 5, "serve", "hang");
    }
    const arriving = this.leavers.some((q) => !q.present && !q.gone);
    if (this.phase.id === "arrival" || arriving) return void this.staffAt(p, this.besideDoor(-1.4), 30, "stand", "door");
    // Someone going home: the coats come down to the door, nobody climbs to the cloakroom for theirs.
    if (this.coatsWanted()) return void this.staffAt(p, this.besideDoor(-1.4), 30, "stand", "coats");
    this.staffAt(p, coat ?? this.besideDoor(-1.4), 120, "stand", "cloakroom");
  }

  /** Guests are on their way home, or soon will be. */
  private coatsWanted(): boolean {
    if (this.phase.id === "farewell" && phaseProgress(this.phase, this.t) >= LAST_TOAST) return true;
    return this.tasks.running("leave").length > 0;
  }

  /** The band: soft through the arrival and the mingling, quiet for the toast, a break to eat at dinner, the dancing, a break midway, and on until the last toast. */
  private musicianThink(p: Person): void {
    const want = this.bandWants();
    const kitchen = this.places.kitchen[0];
    if (want === "break" && kitchen && kitchen.room >= 0) return void this.staffAt(p, this.cells.random(kitchen.room, this.life, 0.5), BAND_SET, "stand", "break");
    this.staffAt(p, this.bandSpot(p), BAND_SET, want === "band" ? "play" : "stand", want === "band" ? "band" : "band-rest");
  }

  /** What the band should be doing now: playing, resting at the stand, or on a break in the kitchen. */
  private bandWants(): "band" | "band-rest" | "break" {
    const ph = this.phase;
    const pr = phaseProgress(ph, this.t);
    if ((ph.id === "dinner" && pr < 0.92) || this.practices.bandBreak) return "break";
    return ph.id === "champagne" || ph.id === "toast" || ph.id === "dinner" || (ph.id === "farewell" && pr < LAST_TOAST) ? "band-rest" : "band";
  }

  private bandSpot(p: Person): Spot | null {
    if (!this.bandstand.length) return null;
    const k = this.people.filter((q) => q.role === "musician").indexOf(p);
    return this.bandstand[Math.max(0, k) % this.bandstand.length]!;
  }

  /**
   * Three spots at the edge of the dance room (the toast room without one), as far from the
   * middle of the dance floor as the room allows, facing it.
   */
  private findBandstand(): Spot[] {
    const pl = this.places;
    const room = pl.danceRoom?.index ?? pl.toastRoom.index;
    const floor = pl.danceSpots.length ? pl.danceSpots : [pl.toastSpot];
    const cx = floor.reduce((a, s) => a + s.x, 0) / floor.length;
    const cz = floor.reduce((a, s) => a + s.z, 0) / floor.length;
    const rng = this.life.fork("bandstand");
    let best: Spot | null = null;
    let bd = -1;
    for (let i = 0; i < 40; i++) {
      const s = this.cells.random(room, rng, 0.9);
      if (!s) continue;
      const d = Math.hypot(s.x - cx, s.z - cz);
      if (d > bd) {
        bd = d;
        best = s;
      }
    }
    if (!best) return [];
    const yaw = yawTo(best.x, best.z, cx, cz);
    const side = facing(yaw + Math.PI / 2);
    const out: Spot[] = [];
    for (const k of [0, 0.9, -0.9]) {
      const w = this.pf.snap(best.level, best.x + side.x * k, best.z + side.z * k, 0.4);
      if (w && this.pf.roomAt(w.level, w.x, w.z) === room) out.push({ level: w.level, x: w.x, z: w.z, yaw, room });
    }
    return out;
  }

  /** The photographer: a candid shot in the busiest room every few minutes, watching from the edge in between. */
  private photographerThink(p: Person): void {
    if (this.t >= (this.due.get("candid") ?? 0) && this.phase.id !== "toast") {
      this.due.set("candid", this.t + this.life.range(CANDID[0], CANDID[1]));
      const s = this.candidSpot();
      if (s) return void this.tasks.candid(p, s);
    }
    this.staffAt(p, this.cells.random(this.places.toastRoom.index, this.life, 0.8), 60, "stand", "watch");
  }

  /** Somewhere in the room with the most guests in it. */
  private candidSpot(): Spot | null {
    const count = new Map<number, number>();
    for (const q of this.leavers) if (q.present && q.room >= 0 && !PRIVATE.has(this.bp.rooms[q.room]!.type)) count.set(q.room, (count.get(q.room) ?? 0) + 1);
    let best = -1;
    let bn = 0;
    for (const [r, n] of count) {
      if (n > bn) {
        bn = n;
        best = r;
      }
    }
    return best >= 0 ? this.cells.random(best, this.life, 0.4) : null;
  }

  /** The kitchen hand: washing up, a rack of clean glasses to the bar now and then, and a cigarette out the back. */
  private kitchenHandThink(p: Person): void {
    const pl = this.places;
    const t = this.t;
    const bartender = this.people.find((q) => q.role === "bartender" && q.present);
    if (bartender && pl.kitchen.length && this.phase.id !== "dinner" && t >= (this.due.get("glasses") ?? 30 * 60)) {
      this.due.set("glasses", t + this.life.range(45, 65) * 60);
      if (this.tasks.errand("glasses", p, bartender, -1, this.life.pick(pl.kitchen), bartender)) return;
    }
    if (pl.terrace.length && t >= (this.due.get("smoke") ?? 30 * 60)) {
      this.due.set("smoke", t + this.life.range(35, 50) * 60);
      const k = pl.kitchen[0] ?? p;
      const s = [...pl.terrace].sort((a, b) => Math.hypot(a.x - k.x, a.z - k.z) - Math.hypot(b.x - k.x, b.z - k.z))[0]!;
      p.held = "cigarette";
      p.heldUntil = t + 400;
      return void this.staffAt(p, s, this.life.range(240, 360), "smoke", "smoke");
    }
    const room = pl.kitchen[0]?.room;
    this.staffAt(p, room !== undefined && room >= 0 ? this.cells.random(room, this.life) : null, this.life.range(60, 200), "serve", "wash");
  }

  start(p: Person, c: Candidate): void {
    const a = toAction(c);
    p.detour = null;
    if (c.id === "ask") a.until = this.t + 90;
    if (c.id === "greet") a.until = this.t + 60;
    if (c.id === "row") a.until = this.t + 40;
    if (c.id === "dance") this.bonds.danced(p);
    if (c.id === "champagne") {
      // Take a glass from the nearest waiter with a tray, or from the bar.
      const w = this.nearestWaiter(p);
      const bar = this.places.bars[0];
      if (w) {
        a.ref = w.id;
        a.target = { level: w.level, x: w.x, z: w.z, yaw: 0, room: w.room };
      } else if (bar) a.target = bar;
      else return void (p.thinkAt = this.t + 10);
    }
    if (c.id === "mingle" && a.target) {
      // A conversation of their own (its middle a step in front of them), or the edge of a circle to wait at.
      if (c.ref === -1) {
        a.ref = this.circles.open(p, a.target).id;
        a.note = "in";
      } else a.note = "edge";
    }
    if (c.key) this.reserved.set(c.key, p.id);
    if (c.seat) this.seats.set(c.seat.id, p.id);
    if (HANDS_FREE.has(c.id) && p.held && p.held !== "tray") {
      if (p.item >= 0) this.body.setDown(p);
      else p.held = null;
    }
    if (!a.target) {
      p.action = a;
      a.startedAt = this.t;
      return;
    }
    const route = this.routeTo(p, a.target);
    p.action = a;
    if (!route) {
      // Can't get there: forget it for a while and choose again.
      p.avoid.set(spotKey(a.target), this.t + 600);
      this.end(p, false);
      p.thinkAt = this.t + 3;
      return;
    }
    p.path = route;
    p.pathIndex = 1;
  }

  /** A route from where someone stands; a step or two away (staff staying put, a circle closing up) needs no search. */
  private routeTo(p: Person, s: Spot): Waypoint[] | null {
    if (s.level === p.level && Math.hypot(s.x - p.x, s.z - p.z) < 0.6) {
      const n = this.pf.levels.get(p.level);
      if (n && this.pf.clear(n, p.x, p.z, s.x, s.z))
        return [
          { level: p.level, x: p.x, z: p.z },
          { level: s.level, x: s.x, z: s.z },
        ];
    }
    return this.pf.route({ level: p.level, x: p.x, z: p.z }, s, p);
  }

  /** A spot beside one of the nearest guests with nothing in hand, for a waiter's next stop. */
  private emptyHanded(w: Person): Spot | null {
    const away = (q: Person) => Math.hypot(q.x - w.x, q.z - w.z) + 15 * Math.abs(q.level - w.level);
    // A guest the waiter has become friends with is served first.
    const first = (q: Person) => away(q) - (w.friends.includes(q.id) ? 8 : 0);
    const want = this.people.filter((q) => q.present && !q.staff && !q.held && (!q.action || OFFER_TO.has(q.action.id)) && this.offeredAt[q.id]! < this.t - 30).sort((a, b) => first(a) - first(b));
    if (!want.length) return null;
    const q = this.rng.pick(want.slice(0, 3));
    this.offeredAt[q.id] = this.t;
    const a = this.rng.range(-Math.PI, Math.PI);
    const s = this.pf.snap(q.level, q.x + Math.sin(a) * 0.8, q.z + Math.cos(a) * 0.8, 0.8);
    const room = s ? this.pf.roomAt(s.level, s.x, s.z) : -1;
    // Never into a bathroom or a bedroom, even when the guest stands by its door.
    if (!s || room === -1 || (room >= 0 && PRIVATE.has(this.bp.rooms[room]!.type))) return null;
    return { level: s.level, x: s.x, z: s.z, yaw: yawTo(s.x, s.z, q.x, q.z), room };
  }

  private nearestWaiter(p: Person): Person | null {
    let best: Person | null = null;
    let bd = Infinity;
    for (const q of this.people) {
      if (q.role !== "waiter" || !q.present || this.body.trayCount(q) === 0) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z) + 10 * Math.abs(q.level - p.level);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  private act(p: Person, dt: number): void {
    const a = p.action!;
    if (a.id === "ask") return this.askStep(p, a, dt);
    if (a.id === "greet") return this.greetStep(p, a, dt);
    if (a.id === "row") return this.rowStep(p, a, dt);
    if (a.id === "task") {
      if (this.tasks.step(p, a) && p.action === a && a.startedAt === null) this.walk(p, dt);
      return;
    }
    if (a.id === "toilet" && a.note === "queue") {
      // Waiting by a bathroom door: body.ts moves the line along, knocks and gives up.
      this.body.queueStep(p);
      if (p.action === a && a.startedAt === null) this.walk(p, dt);
      return;
    }
    if (a.id === "drink" && a.note === "bar-wait") {
      // Waiting a turn at the bar; the bartender pours and starts the drink (body.ts).
      if (this.t >= a.until!) this.end(p, false);
      return;
    }
    if (a.startedAt === null) {
      if (a.id === "champagne" && a.ref !== undefined) this.followWaiter(p, a);
      if (!p.action) return;
      this.walk(p, dt);
      return;
    }
    // A waiter at a stop keeps offering to whoever comes near, and moves on when the tray is empty.
    if (a.id === "staff" && a.note === "serve") {
      if ((this.t - a.startedAt) % 4 < dt) this.offer(p);
      if (!this.body.trayCount(p)) return this.end(p, true);
    }
    // At the edge of a circle, waiting to be let in.
    if (a.id === "mingle" && a.note !== "in") {
      if (this.t >= (a.until ?? 0)) {
        const g = this.groups.get(a.ref ?? -1);
        // Those standing in it when they're let in (making room sets them shuffling).
        const there = g ? this.circles.settled(g) : [];
        if (this.circles.decide(p, a) && g) this.joinGroup(p, g, there);
      }
      return;
    }
    // At the target: refill needs over the action's duration.
    const k = Math.min(1, dt / Math.max(1, a.duration));
    for (const id in a.gain) {
      const n = id as keyof typeof a.gain;
      p.needs[n] = Math.min(1, p.needs[n] + (a.gain[n] ?? 0) * k);
    }
    // A circle member's stay runs from when they joined, however often they shuffle round.
    if (a.id === "mingle" ? this.t >= (a.until ?? a.startedAt + a.duration) : this.t - a.startedAt >= a.duration) this.end(p, true);
  }

  private followWaiter(p: Person, a: ActionState): void {
    const w = this.people[a.ref!]!;
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    if (!this.body.trayCount(w)) {
      // Their tray ran dry: look for another, or the bar.
      this.end(p, false);
      p.thinkAt = this.t + 1;
      return;
    }
    if (w.level === p.level && d < 1.4) {
      const drink = this.body.takeFrom(p, w);
      this.log("champagne", [p.id, w.id], p.room, drink ?? undefined);
      this.end(p, true);
      return;
    }
    // Re-aim every few metres the waiter moves (never halfway up a stair).
    const tgt = a.target!;
    if (p.path[p.pathIndex]?.climb) return;
    if (Math.hypot(w.x - tgt.x, w.z - tgt.z) > 1.5 || p.pathIndex >= p.path.length) {
      const near = this.pf.snap(w.level, w.x - Math.sin(w.yaw) * 0.8, w.z - Math.cos(w.yaw) * 0.8, 1) ?? w;
      const route = this.pf.route({ level: p.level, x: p.x, z: p.z }, near, p);
      if (!route) return this.end(p, false);
      a.target = { level: near.level, x: near.x, z: near.z, yaw: 0, room: w.room };
      p.path = route;
      p.pathIndex = 1;
    }
  }

  private walk(p: Person, dt: number): void {
    // Looking round after a wrong turn, then back on the way.
    if (p.detour && p.detour.until >= 0) {
      if (this.t >= p.detour.until) this.backOnTheWay(p);
      return;
    }
    const before = p.room;
    // Over 0.6 tipsiness people walk a little slower (and sway, in the renderer).
    let budget = ((p.speed * dt) / TIME_SCALE) * (p.tipsy > 0.6 ? 0.9 : 1);
    if (this.doorAhead(p)) return;
    while (budget > 1e-6 && p.pathIndex < p.path.length) {
      const wp = p.path[p.pathIndex]!;
      if (wp.climb) {
        const y1 = this.floorAt(wp.level, this.pf.roomAt(wp.level, wp.x, wp.z));
        const dx = wp.x - p.x;
        const dz = wp.z - p.z;
        const dy = y1 - p.y;
        const len = Math.hypot(dx, dz, dy);
        const stepLen = (CLIMB_SPEED * dt) / TIME_SCALE;
        p.pose = "climb";
        if (len <= stepLen) {
          p.x = wp.x;
          p.z = wp.z;
          p.y = y1;
          p.level = wp.level;
          p.room = this.pf.roomAt(wp.level, wp.x, wp.z);
          p.pathIndex++;
          if (p.room !== before) this.enterRoom(p, before);
        } else {
          p.x += (dx / len) * stepLen;
          p.z += (dz / len) * stepLen;
          p.y += (dy / len) * stepLen;
          if (Math.hypot(dx, dz) > 0.05) p.yaw = Math.atan2(dx, dz);
        }
        return;
      }
      const dx = wp.x - p.x;
      const dz = wp.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.02) p.yaw = Math.atan2(dx, dz);
      if (d <= budget) {
        p.x = wp.x;
        p.z = wp.z;
        budget -= d;
        p.pathIndex++;
      } else if (d < CORNER && this.cornerOpen(p)) {
        // Close enough to a corner with the next leg open: round it (two people never fight over the same corner).
        p.pathIndex++;
      } else {
        let nx = p.x + (dx / d) * budget;
        let nz = p.z + (dz / d) * budget;
        if (!this.pf.walkable(p.level, nx, nz)) {
          // Nudged off the line (by someone in the way): find a fresh route from here.
          this.reroute(p);
          return;
        }
        // Step round whoever is just ahead, if there's floor to the side; the last stretch to the target goes straight in.
        const last = p.pathIndex === p.path.length - 1 && d < SIDESTEP_AHEAD;
        const side = last ? null : this.sidestep(p, dx / d, dz / d);
        if (side && this.pf.walkable(p.level, nx + side.x, nz + side.z) && this.world.doorAtPoint(p.level, nx + side.x, nz + side.z) === this.world.doorAtPoint(p.level, nx, nz)) {
          nx += side.x;
          nz += side.z;
        }
        p.x = nx;
        p.z = nz;
        budget = 0;
      }
    }
    const room = this.pf.roomAt(p.level, p.x, p.z);
    if (room !== -1) {
      p.room = room;
      p.y = this.floorAt(p.level, room);
    }
    this.passDoor(p);
    if (p.room !== before) this.enterRoom(p, before);
    if (p.action && p.pathIndex >= p.path.length) {
      if (p.detour) this.lookRound(p);
      else this.arrived(p);
    }
  }

  /** Whether the leg after the next corner runs clear from where someone stands now. */
  private cornerOpen(p: Person): boolean {
    const next = p.path[p.pathIndex + 1];
    const n = this.pf.levels.get(p.level);
    return !!next && !!n && !next.climb && next.level === p.level && this.pf.clear(n, p.x, p.z, next.x, next.z);
  }

  /**
   * Walkers give way: the nearest person in a lane ahead (within 1.5 m, half a metre either side)
   * sends them sideways, more the closer they are. Returns the sideways shift for this step.
   */
  private sidestep(p: Person, ux: number, uz: number): { x: number; z: number } | null {
    let best: Person | null = null;
    let bestAhead = SIDESTEP_AHEAD;
    let lat = 0;
    for (const q of this.people) {
      if (q === p || !q.present || q.level !== p.level || q.pose === "sit") continue;
      const rx = q.x - p.x;
      const rz = q.z - p.z;
      const ahead = rx * ux + rz * uz;
      if (ahead <= 0 || ahead >= bestAhead) continue;
      const l = rz * ux - rx * uz;
      if (Math.abs(l) > SIDESTEP_LANE) continue;
      best = q;
      bestAhead = ahead;
      lat = l;
    }
    if (!best) return null;
    // Away from the side they're on; dead ahead, pass on the right.
    const away = Math.abs(lat) < 0.05 ? -1 : -Math.sign(lat);
    const k = (1 - bestAhead / SIDESTEP_AHEAD) * SIDESTEP_MAX * away;
    // `lat` is measured along (-uz, ux); shift along the same axis, away from them.
    return { x: -uz * k, z: ux * k };
  }

  /**
   * A door on the way: open it and wait while it swings, or find another way when it's locked.
   * True when the person doesn't move this step. A door they're already standing in is never in the way.
   */
  private doorAhead(p: Person): boolean {
    const wp = p.path[p.pathIndex];
    if (!wp || wp.climb) return false;
    const w = this.world;
    const dx = wp.x - p.x;
    const dz = wp.z - p.z;
    const d = Math.hypot(dx, dz);
    const here = w.doorAtPoint(p.level, p.x, p.z);
    for (const ahead of DOOR_LOOK) {
      const k = Math.min(ahead, d);
      const id = d > 1e-6 ? w.doorAtPoint(p.level, p.x + (dx / d) * k, p.z + (dz / d) * k) : here;
      if (id >= 0 && id !== here) {
        const door = w.doors[id]!;
        if (!w.canPass(door, p)) {
          this.reroute(p);
          return true;
        }
        if (door.open < DOOR_PASS) {
          w.swing(door, 1);
          return true;
        }
      }
      if (k >= d) break;
    }
    return false;
  }

  /** Stepping out of a doorway: bedrooms, the study and guest bedrooms swing shut behind. */
  private passDoor(p: Person): void {
    const id = this.world.doorAtPoint(p.level, p.x, p.z);
    const prev = this.doorIn[p.id]!;
    if (id === prev) return;
    this.doorIn[p.id] = id;
    if (prev < 0) return;
    const d = this.world.doors[prev]!;
    if (d.closes && !this.doorIn.includes(prev)) this.world.swing(d, 0);
  }

  private reroute(p: Person): void {
    const goal = p.path[p.path.length - 1];
    const here = this.pf.walkable(p.level, p.x, p.z) ? { level: p.level, x: p.x, z: p.z } : (this.pf.snap(p.level, p.x, p.z, 1) ?? this.pf.snap(p.level, p.x, p.z, 6));
    const route = goal && here ? this.pf.route(here, goal, p) : null;
    if (!route) return this.end(p, false);
    if (here) {
      p.x = here.x;
      p.z = here.z;
    }
    p.path = route;
    p.pathIndex = 1;
  }

  private arrived(p: Person): void {
    const a = p.action!;
    if (a.id === "toilet") {
      // At the door, inside, or at a place in the line (body.ts).
      if (a.target) p.yaw = a.target.yaw;
      if (a.note === "door") return this.body.atDoor(p);
      if (a.note === "inside") return this.body.inside(p);
      if (a.note === "queue") return void (a.startedAt = this.t);
    }
    if (a.id === "drink" && a.note === "bar-go") {
      if (a.target) p.yaw = a.target.yaw;
      a.note = "bar-wait";
      a.until = this.t + 180;
      this.body.atBar(p, a.ref!);
      return;
    }
    if (a.id === "leave") return this.depart(p);
    if (a.id === "greet") return;
    if (a.id === "task") {
      a.startedAt = this.t;
      if (a.target) p.yaw = a.target.yaw;
      return this.tasks.arrived(p);
    }
    if (a.id === "champagne" && a.ref === undefined) {
      // Took a glass at the bar.
      this.body.pour(p, "champagne");
      this.log("champagne", [p.id], p.room, "bar");
      this.end(p, true);
      return;
    }
    if (a.id === "champagne") return;
    if (a.seat) {
      a.startedAt = this.t;
      // At table, stand behind the chair until the host sits (the less proper sit anyway).
      if (a.id === "dinner" && a.note !== "supper" && !this.practices.maySit(p)) {
        if (this.life.chance(Math.max(0, 0.7 - p.traits.propriety) * 0.8 + 0.2 * p.tipsy)) this.practices.breach(p, "host-first");
        else {
          a.note = "stand-wait";
          p.yaw = a.seat.yaw;
          return;
        }
      }
      return this.sitDown(p, a);
    }
    if (a.id === "mingle" && a.ref !== undefined) {
      const g = this.groups.get(a.ref);
      if (g) p.yaw = yawTo(p.x, p.z, g.x, g.z);
      if (a.note !== "in") a.until = this.t + this.circles.waitFor();
      else if (a.until === undefined && g) {
        a.until = this.t + this.circles.stay(p, g);
        a.duration = a.until - this.t;
      }
    } else if (a.target) p.yaw = a.target.yaw;
    // A stop on a waiter's round: empties onto the tray (glasses are offered while they stand there).
    if (a.id === "staff" && a.note === "serve") {
      const n = this.body.clearGlasses(p, 3);
      this.finding?.served(p, n);
    }
    a.startedAt = this.t;
    this.bags.begun(p, a);
  }

  /** Walk to a spot as part of the current action (it starts when they get there); false when there is no way. */
  goTo(p: Person, s: Spot): boolean {
    const a = p.action;
    if (!a) return false;
    p.detour = null;
    a.target = s;
    a.startedAt = null;
    const route = this.routeTo(p, s);
    if (!route) return false;
    p.path = route;
    p.pathIndex = 1;
    return true;
  }

  /** A waiter offers glasses round: guests close by with empty hands take one, more often when thirsty. */
  private offer(w: Person): void {
    const drink = this.body.trayDrink(w);
    if (!drink) return;
    // Nobody turns down a glass for the toast, and the waiters reach further through the crowd for it.
    const toast = drink === "champagne" && (this.phase.id === "champagne" || this.phase.id === "toast");
    for (const q of this.people) {
      if (!q.present || q.staff || q.held || q.level !== w.level || Math.hypot(q.x - w.x, q.z - w.z) > (toast ? 3 : 2.5)) continue;
      if (q.action && !OFFER_TO.has(q.action.id)) continue;
      if (!this.body.wants(q, drink) || !this.rng.chance(toast ? 0.95 : 0.3 + 0.6 * (1 - q.needs.thirst))) continue;
      // A glass of champagne off the tray counts as champagne taken, like one fetched from a waiter or the bar.
      if (this.body.takeFrom(q, w) === "champagne") this.log("champagne", [q.id, w.id], q.room, "offered");
      if (!this.body.trayCount(w)) break;
    }
  }

  /** What the waiters load: champagne before the toast, red or white at dinner, a mix after. */
  private trayDrink(): DrinkId {
    const band = this.body.band;
    if (band === "before") return "champagne";
    if (band === "dinner") return this.rng.chance(0.5) ? "red" : "white";
    return this.rng.weighted([
      ["champagne", 1],
      ["red", 1.2],
      ["white", 1],
      ["beer", 0.6],
      ["water", 0.8],
    ] as const);
  }

  private give(p: Person, h: Held): void {
    if (DRINKS.has(h)) return this.body.pour(p, h as DrinkId);
    if (p.item >= 0) this.body.setDown(p);
    p.held = h;
    p.heldUntil = this.t + (HOLD_LIFE[h] ?? 99999);
  }

  /** The things in the house before anyone arrives: the first-aid kit and the good whisky. */
  private shelveThings(): void {
    const items = this.world.items;
    const pl = this.places;
    const kit = pl.kitchen[0] ?? pl.bathrooms[0]?.inside;
    if (kit) {
      items.add("kit", "shelved", -1, -1, kit, 0);
      this.dramas.setKit(kit);
    }
    const spirits = pl.chains.spirits.spots[0];
    if (spirits) {
      const id = items.add("bottle", "shelved", this.host.id, -1, spirits, 0);
      items.drink[id] = DRINK_IDS.indexOf("whisky");
      this.bottle = id;
    }
  }

  /** At the door: the coat is hung (or laid on a guest bed), some keep a bag, spectacles are worn. */
  private arriveWithThings(p: Person): void {
    const items = this.world.items;
    const spots = this.places.chains.coats.spots;
    const hook = spots.length ? spots[p.id % spots.length]! : this.places.entrance;
    p.coat = items.add("coat", "hung", p.id, -1, hook, this.t);
    if (this.people.some((q) => q.role === "cloakroom" && q.present)) this.pendingCoats++;
    // The spy's mark for a bag has one whatever the draw says (the draw is made all the same).
    if (this.things.chance(p.look.sex === "f" ? 0.6 : 0.08) || p.id === (this.spy?.bagFor ?? -1)) items.add("bag", "carried", p.id, p.id, p, this.t);
    if (p.quirks.includes("glasses")) items.add("spectacles", "worn", p.id, p.id, p, this.t);
    // What the spy is after may come in with them: papers in the bag, a phone in the coat or a pocket.
    this.spy?.things.arrived(p);
  }

  /** Out of the door: the coat goes back on, and whatever they carry goes with them. */
  private leaveWithThings(p: Person): void {
    const items = this.world.items;
    if (p.item >= 0) this.body.setDown(p);
    if (p.coat >= 0) {
      items.holder[p.coat] = p.id;
      items.set(p.coat, "worn", this.t);
    }
  }

  /** Finish or abandon the current action and free what it held. */
  end(p: Person, done: boolean): void {
    const a = p.action;
    if (!a) return;
    if (done && a.gives !== undefined && a.id !== "champagne") {
      if (a.gives) this.give(p, a.gives);
      else if (p.item < 0) p.held = null;
    }
    if (a.id === "staff" && a.note === "hang") p.held = null;
    // A frame or a hand over: whoever else is at the table, won or lost.
    if (done && a.id === "games" && (a.note === "billiards" || a.note === "cards") && a.startedAt !== null) {
      const q = this.people.find((o) => o !== p && o.present && o.action?.id === "games" && o.action.ref === a.ref && o.action.startedAt !== null);
      if (q) this.bonds.gameOver(p, q, a.note);
    }
    if (done && a.id === "staff" && a.note === "load") {
      // The butler's round after dinner is the brandy.
      const drink = p.role === "butler" ? "whisky" : this.trayDrink();
      this.body.loadTray(p, drink, drink === "champagne" && (this.phase.id === "champagne" || this.phase.id === "toast"));
      this.body.clearGlasses(p, 3);
    }
    this.release(p);
    if (a.seat && a.startedAt !== null) this.place(p, a.seat.approach);
    // Never stop on a stair: finish the flight first.
    const wp = p.path[p.pathIndex];
    if (wp?.climb) this.place(p, wp);
    p.action = null;
    p.detour = null;
    p.path = [];
    p.pathIndex = 0;
    p.pose = "stand";
    p.thinkAt = this.t + (p.staff ? 2 : this.rng.range(2, 12));
    this.dramas.ended(p, a);
    if (p.id === this.spyId) this.spy!.ended(a);
  }

  private release(p: Person): void {
    const a = p.action;
    if (!a) return;
    if (a.key && this.reserved.get(a.key) === p.id) this.reserved.delete(a.key);
    if (a.seat && this.seats.get(a.seat.id) === p.id) this.seats.delete(a.seat.id);
    if (a.id === "toilet") this.body.release(p);
    if (a.id === "drink") this.body.leaveBar(p);
    if (a.id === "mingle" && a.ref !== undefined && a.note === "in") {
      const g = this.groups.get(a.ref);
      if (g) this.circles.left(p, g, a.until !== undefined ? a.until - a.duration : -1);
    }
    if (a.id === "task" && a.ref !== undefined) this.tasks.drop(p, a.ref);
  }

  private updatePose(p: Person): void {
    if (p.gesture && this.t >= p.gestureUntil) p.gesture = null;
    // Milestone 3: someone down lies, sags or sits as the spy's work has them, and the spy props, grapples or drags.
    if (this.spy && (p.down || p.id === this.spy.id || p.id === this.spy.holding)) {
      const o = this.spy.pose(p);
      if (o) {
        p.pose = o;
        return;
      }
      // Out cold, dying or dead where they lie.
      if (p.down && p.down !== "ill") {
        p.pose = "lie";
        return;
      }
    }
    if (p.detour && p.detour.until >= 0) {
      p.pose = "look";
      return;
    }
    const a = p.action;
    if (a?.id === "toilet" && a.note === "queue" && a.startedAt !== null) {
      p.pose = this.body.knocking(p) ? "knock" : "wait";
      return;
    }
    if (a?.id === "drink" && a.note === "bar-wait") {
      p.pose = "wait";
      return;
    }
    if (!a || a.startedAt === null) {
      p.pose = !a ? "stand" : p.path[p.pathIndex]?.climb === true ? "climb" : "walk";
      return;
    }
    let pose = a.pose;
    if (a.id === "dance") pose = this.dancePose(p, a);
    if (a.id === "toilet") pose = "wait";
    else if (a.id === "task") pose = this.tasks.poseOf(p);
    else if ((a.id === "mingle" && a.note !== "in") || (a.id === "dinner" && a.note === "stand-wait")) pose = "stand";
    const ph = this.phase;
    if (a.id === "toast") {
      const pr = phaseProgress(ph, this.t);
      const raising = (ph.id === "toast" && pr >= RAISE[0] && pr <= RAISE[1]) || (ph.id === "farewell" && pr >= LAST_TOAST * 0.55 && pr <= LAST_TOAST * 0.85);
      // The one being toasted doesn't drink to themselves.
      pose = raising && !(ph.id === "toast" && p.archetype === "honoree") ? "toast" : "stand";
    }
    if (p.role === "host" && (this.t < this.announceUntil || this.practices.speaking)) pose = "announce";
    // On their feet for a speech; still when the band's amp blows the fuse.
    p.pose = this.dramas.pose(p) ?? pose;
  }

  /** People don't stand inside each other: push apart anyone closer than 0.42 m (never through a locked door). Bumps are noted. */
  private separate(dt: number): void {
    const ps = this.people;
    const R = 0.42;
    const R2 = R * R + 1e-6;
    const world = this.world;
    const canStand = (p: Person, x: number, z: number): boolean => {
      if (!this.pf.walkable(p.level, x, z)) return false;
      const d = world.doorAtPoint(p.level, x, z);
      return d < 0 || world.canPass(world.doors[d]!, p);
    };
    // The spy and whoever it holds move as one; someone lying on the floor is stepped round.
    const spy = this.spy?.id ?? -1;
    const held = this.spy?.holding ?? -1;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]!;
      if (!a.present || a.pose === "sit" || a.pose === "climb" || a.pose === "lie") continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]!;
        if (!b.present || b.level !== a.level || b.pose === "sit" || b.pose === "climb" || b.pose === "lie") continue;
        if (held >= 0 && (a.id === held || b.id === held) && (a.id === spy || b.id === spy)) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        // A cheap square first (a hair over R²), the exact distance only for the near.
        if (dx * dx + dz * dz >= R2) continue;
        const d = Math.hypot(dx, dz);
        if (d >= R) continue;
        if (!this.shuffling(a, b)) this.body.checkBump(a, b, dx, dz, d, dt);
        const ux = d > 1e-4 ? dx / d : 1;
        const uz = d > 1e-4 ? dz / d : 0;
        const push = (R - d) / 2;
        if (canStand(a, a.x - ux * push, a.z - uz * push)) {
          a.x -= ux * push;
          a.z -= uz * push;
        }
        if (canStand(b, b.x + ux * push, b.z + uz * push)) {
          b.x += ux * push;
          b.z += uz * push;
        }
      }
    }
  }

  /**
   * Conversations take turns. A new speaker may pass something on (memory.ts decides what), now
   * and then someone laughs, and a group that has just gone quiet stays so for a while.
   */
  private updateGroups(): void {
    for (const g of this.groups.values()) {
      if (this.t < g.quietUntil) {
        g.speaker = -1;
        continue;
      }
      if (this.t < g.speakerUntil) continue;
      const here = g.members.filter((m) => this.people[m]!.action?.startedAt != null);
      if (!here.length) continue;
      g.speaker = this.rng.weighted(here.map((m) => [m, 0.05 + this.people[m]!.traits.talk ** 2] as const));
      const sp = this.people[g.speaker]!;
      // Tense talk comes quicker.
      g.speakerUntil = this.t + this.rng.range(3, 9) * (1 - 0.4 * this.mood.tension[sp.id]!);
      // Too many for one conversation: it splits at the turn.
      if (here.length >= 5) this.circles.maybeSplit(g);
      if (here.length > 1 && this.chat.chance(GOSSIP * (0.4 + sp.traits.talk))) {
        const nearby = this.people.filter((q) => q.present && !here.includes(q.id) && q.level === g.level && Math.hypot(q.x - g.x, q.z - g.z) < 3).map((q) => q.id);
        this.passOn(sp, here, nearby, g.room, g.speakerUntil - this.t);
      }
      // Someone with an open case may ask round about it, or say who it points at.
      if (here.length > 1) {
        const r = this.register.talk(here, sp.id);
        if (r) this.caseTalk(sp, g.room, r, g.speakerUntil - this.t);
        // Doubts that outlived a test: a word in the ear of another who knows them well.
        this.compareInCircle(sp, here);
        // A first-timer in the host's circle asks to be shown round.
        this.tourAsk(g, here);
        // The spy may not know the name of someone the one it plays knew.
        this.spy?.answers.turn(here, sp.id);
      }
      if (this.chat.chance(sp.quirks.includes("big-laugh") ? 0.2 : 0.05)) this.senses.sound("laugh", sp, sp.id);
    }
  }

  /** Talk at table, in the toast ring, on a sofa or outside: now and then someone says something to whoever is beside them. */
  private sideTalk(): void {
    const by = (p: Person) => !p.staff && p.present && p.action !== null && p.action.startedAt !== null && SIDE_TALK.has(p.action.id);
    for (const p of this.people) {
      if (!by(p) || !this.chat.chance(SIDE_GOSSIP * (0.3 + p.traits.talk))) continue;
      const near = this.people.filter((q) => q !== p && by(q) && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < SIDE_NEAR).map((q) => q.id);
      if (near.length) this.passOn(p, [p.id, ...near], [], p.room, 3);
    }
  }

  /** A speaker passes on one thing they know, if anything is worth it. */
  private passOn(sp: Person, members: number[], nearby: number[], room: number, secs: number): void {
    const m = this.memory;
    const r = m.onTurn(members, sp.id, nearby);
    if (!r) return;
    this.gesture(sp, "lean", Math.max(2, secs));
    this.log("gossip", [sp.id, ...r.listeners], room, m.verbOf(r.fact));
    const subj = m.subject[r.fact]!;
    const odd = m.odd[r.fact]! > 0 && m.juicy[r.fact]! >= 0.6;
    const placed = !VERBS[m.verbOf(r.fact)].elsewhere;
    for (const l of [...r.listeners, ...r.overheard]) {
      // Where it happened tells them where the subject was.
      if (placed && subj >= 0 && m.room[r.fact]! >= 0) m.toldWhere(l, subj, m.room[r.fact]!, m.t[r.fact]!);
      // Something juicy and odd unsettles a little.
      if (odd) this.mood.witness(l, 0.02);
    }
  }

  /** Someone talks with these people: strangers meet, and may put a name to someone they'd only seen. */
  private meetAll(p: Person, others: readonly number[]): void {
    for (const m of others) {
      const fresh = !this.ident.tieOf(p.id, m);
      this.ident.meet(p.id, m);
      if (fresh) {
        this.register.met(p.id, m);
        this.register.met(m, p.id);
      }
    }
  }

  /** A turn of case talk: the asker leans in with a question, or the speaker leans in with a name. */
  private caseTalk(sp: Person, room: number, r: CaseTalk, secs: number): void {
    this.gesture(sp, r.what === "ask" ? "ask" : "lean", Math.max(2, secs));
    this.log(r.what === "ask" ? "ask-around" : "lead", [sp.id, ...r.others], room, r.kind);
  }

  /** Someone joins a conversation: strangers meet (and may put a name to someone they'd only seen), the newcomer may say where they've been, and talk stops if they're wary of the newcomer. */
  private joinGroup(p: Person, g: Group, there: readonly number[]): void {
    const others = there.filter((m) => m !== p.id && g.members.includes(m));
    this.meetAll(p, others);
    this.register.joinsGroup(p, others);
    // Those who know something about the newcomer's partner go quiet a moment.
    const hush = this.bonds.joined(p, others);
    if (hush > 0) {
      g.quietUntil = Math.max(g.quietUntil, this.t + hush);
      g.speaker = -1;
    }
    const wary = others.filter((m) => this.memory.suspects(m, p.id) >= SUSPICIOUS);
    // A circle going quiet as it joins, whatever the reason: the spy lies low a while.
    if (p.id === this.spyId && (hush > 0 || wary.length)) this.spy!.answers.hushed();
    if (!wary.length) return;
    g.quietUntil = this.t + this.chat.range(10, 25);
    g.speaker = -1;
    for (const m of wary) this.glance(this.people[m]!, p.x, p.z, 3);
    this.counts.hushes++;
    this.log("hush", [p.id, ...wary], g.room);
  }

  /** Through the toast or dinner, a guest who knows what's on and is doing something else stands out. */
  private outOfStep(): void {
    for (const p of this.people) {
      if (p.staff || p.role === "host" || !p.present || p.phaseSeen !== this.phaseIdx) continue;
      const a = p.action;
      // The spy away on a step of its plan is out of step too, unless the act itself is what shows.
      const spy = p.id === this.spyId;
      if (spy && p.notable && this.t < p.notableUntil) continue;
      if (a && (!["toast", "dinner", "champagne", "toilet", "leave", "task"].includes(a.id) || (spy && this.tasks.of(p)?.kind === "spy"))) this.notable(p, "out-of-step", -1, 12);
    }
  }

  // ------------------------------------------------------------- everyday life

  /** Into the chair. The host sitting down lets everyone standing behind theirs sit too. */
  private sitDown(p: Person, a: ActionState): void {
    const seat = a.seat!;
    p.x = seat.x;
    p.z = seat.z;
    p.y = seat.y;
    p.yaw = seat.yaw;
    if (a.note === "stand-wait") a.note = undefined;
    this.finding?.sat(p, seat);
    if (a.id !== "dinner") return;
    this.log("seated", [p.id], p.room);
    // Back at table from its alibi, the spy turns to those beside it and says where it was (spy/tactics.ts tells()).
    if (p.id === this.spyId && this.spy!.tactics.owed()) {
      const by = this.atTableBy(p);
      this.meetAll(p, by);
      this.register.joinsGroup(p, by);
    }
    if (p.role === "host") {
      this.practices.hostSat();
      this.seatWaiting();
    }
  }

  /** Those at table beside someone, as close as side talk. */
  private atTableBy(p: Person): number[] {
    return this.people
      .filter((q) => q !== p && q.present && q.action?.id === "dinner" && q.action.startedAt !== null && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < SIDE_NEAR)
      .map((q) => q.id);
  }

  /** Everyone standing behind a chair sits, once they may. */
  private seatWaiting(): void {
    for (const q of this.people) {
      const a = q.action;
      if (a?.id === "dinner" && a.note === "stand-wait" && this.practices.maySit(q)) this.sitDown(q, a);
    }
  }

  /**
   * The evening's moments that aren't anyone's choice in the moment: the group photo after the
   * toast, the household going for the good whisky after dinner, things turning up, a drink
   * fetched for someone sitting down, a coat fetched for someone cold outside, and the last
   * guests hurried out.
   */
  private everyday(): void {
    const ph = this.phase;
    const pr = phaseProgress(ph, this.t);
    if (ph.id === "mingle" && this.programme[this.phaseIdx - 1]?.id === "toast" && pr >= 0.08 && !this.done.has("photo")) {
      this.done.add("photo");
      this.groupPhoto();
    }
    if (ph.id === "games" && pr >= 0.3 && !this.done.has("cabinet")) {
      this.done.add("cabinet");
      this.toTheCabinet();
    }
    if (ph.id === "dinner") {
      this.seatWaiting();
      if (this.spy && this.spy.id === this.host.id) this.leaveTable(this.host, pr);
      else if (this.spy) this.upForPlan(this.spy, pr);
    }
    this.thingsTurnUp();
    // The band stops and starts with the programme.
    const band = this.bandWants();
    for (const m of this.people) {
      const a = m.action;
      if (m.role !== "musician" || !a || a.id !== "staff") continue;
      if (a.note !== band && !(band === "break" && a.note === "band-rest" && !this.places.kitchen.length)) {
        this.end(m, false);
        m.thinkAt = this.t;
      }
    }
    for (const p of this.leavers) {
      const a = p.action;
      if (!p.present || !a || a.startedAt === null || (p.avoid.get("errand") ?? -1) > this.t) continue;
      if (a.id === "sit" && !p.held && p.needs.thirst < 0.4 && this.life.chance(0.03)) this.drinkBrought(p);
      else if (a.id === "terrace" && this.phaseIdx > this.dinnerIdx && this.life.chance(p.archetype === "elderly" || p.archetype === "mother" ? 0.006 : 0.001)) this.coatBrought(p);
      else if (a.id === "mingle" && a.note === "in" && !p.held && p.needs.thirst < 0.4 && ASK_PHASES.has(ph.id) && this.asks.chance(ASK_DRINK)) this.drinkAsked(p);
    }
    if (this.t >= PARTY_LENGTH - HURRY_OUT) this.tasks.hurryOut();
    if (this.t >= PARTY_LENGTH - 60) {
      // The very last minute: anyone still here walks straight out.
      for (const p of this.leavers) {
        if (!p.present || p.gone || p.action?.id === "leave" || this.tasks.of(p)?.kind === "leave") continue;
        this.end(p, false);
        this.start(p, { id: "leave", target: this.places.entrance, duration: 0, pose: "walk", gain: {}, programme: true });
      }
    }
  }

  /** The group photo: everyone not otherwise engaged, lined up before the grand stair. */
  private groupPhoto(): void {
    const ph = this.people.find((q) => q.role === "photographer" && q.present);
    const link = this.places.chains.photo;
    const foot = link.spots[0];
    if (!ph || !foot) return;
    const r = link.room !== null ? this.bp.rooms[link.room] : undefined;
    const cx = r ? (r.inner.x0 + r.inner.x1) / 2 : this.places.toastSpot.x;
    const cz = r ? (r.inner.z0 + r.inner.z1) / 2 : this.places.toastSpot.z;
    const yaw = Math.hypot(cx - foot.x, cz - foot.z) > 0.5 ? yawTo(foot.x, foot.z, cx, cz) : foot.yaw;
    let all = this.people.filter((q) => q.present && !q.staff && !this.dramas.busy(q) && (!q.action || !["toilet", "task", "leave", "ask", "row"].includes(q.action.id)));
    // The spy keeping out of the picture slips away when it cleanly can (spy/habits.ts).
    const spy = this.spy;
    if (spy && all.some((q) => q.id === spy.id)) {
      const cam = { level: foot.level, x: foot.x + Math.sin(yaw) * 6, z: foot.z + Math.cos(yaw) * 6 };
      if (!spy.habits.forPhoto(ph, cam, foot)) all = all.filter((q) => q.id !== spy.id);
    }
    // The camera-shy slip away, or stand at the back.
    const { who, back } = this.dramas.forPhoto(all);
    this.tasks.groupPhoto(ph, foot, yaw, who, { back });
  }

  /** After dinner the host's partner (or the host) goes to the cabinet for the good whisky. */
  private toTheCabinet(): void {
    const from = this.places.chains.spirits.spots[0];
    const host = this.host;
    const partner = host.partner !== null ? this.people[host.partner]! : null;
    const who = partner?.present && !partner.gone ? partner : host;
    const a = who.action;
    if (this.bottle < 0 || !from || this.places.chains.spirits.link === "bar" || a?.id === "toilet" || a?.id === "task") return;
    this.tasks.check(who, from, this.bottle, this.askWhere(who));
  }

  /** At the cabinet: the bottle's there, or it's gone and they know why (the butler said), or it's gone and nobody said: a case. */
  private lookInCabinet(p: Person, bottle: number): void {
    if (this.world.items.stateOf(bottle) === "shelved") return;
    this.gesture(p, "shrug", 2);
    if (this.register.knowsWhy(p.id, bottle)) return;
    const host = this.host;
    const room = p.room;
    const f = this.memory.observe(p.id, "gone", host.id, bottle, room);
    const c = this.register.open(p.id, "gone", host.id, bottle, room, this.t - CASES.gone.lookBack, this.t, f);
    const near = this.people.filter((q) => q !== p && q.present && q.level === p.level && q.room === p.room && Math.hypot(q.x - p.x, q.z - p.z) < 6);
    this.register.raise(
      p.id,
      c,
      near.map((q) => q.id),
    );
    for (const q of near) this.memory.learn(q.id, f, PASS_ON, p.id, 1);
    this.log("case", [p.id, host.id], room, "gone");
  }

  /** Someone missing a thing sees it (in the room with them, set down or shelved): the case closes for everyone. */
  private thingsTurnUp(): void {
    const items = this.world.items;
    for (const p of this.people) {
      if (!p.present) continue;
      for (const obj of this.register.soughtThings(p.id)) {
        const st = items.stateOf(obj);
        if ((st !== "down" && st !== "shelved") || items.room[obj] !== p.room || items.level[obj] !== p.level || Math.hypot(items.x[obj]! - p.x, items.z[obj]! - p.z) > 10) continue;
        this.register.found(obj, p.room);
        this.log("case", [p.id], p.room, "found");
      }
    }
  }

  /** Thirsty on a sofa: a waiter nearby is beckoned over and brings a drink from the bar. */
  private drinkBrought(p: Person): void {
    const pl = this.places;
    const away = (q: { x: number; z: number; level: number }) => Math.hypot(q.x - p.x, q.z - p.z) + 15 * Math.abs(q.level - p.level);
    // A waiter fetches a drink now and then, between rounds.
    const w = this.people.filter((q) => q.role === "waiter" && q.present && q.action?.id !== "task" && (q.avoid.get("errand") ?? -1) <= this.t && away(q) < 12).sort((a, b) => away(a) - away(b))[0];
    const bar = [...pl.bars].sort((a, b) => away(a) - away(b))[0];
    if (!w || !bar) return;
    p.avoid.set("errand", this.t + 40 * 60);
    w.avoid.set("errand", this.t + 30 * 60);
    this.gesture(p, "beckon", 2);
    this.tasks.errand("drink", w, p, -1, bar, p);
  }

  /**
   * Thirsty in a circle with nothing in hand: someone in it they know (at least by acquaintance),
   * free and not talking, the closest tie first, is asked to bring a drink, and nearly always does
   * (milestone 2's errand). The innocent twin of the errand the spy drops (spy/habits.ts).
   */
  private drinkAsked(p: Person): void {
    const g = this.circleOf(p);
    if (!g) return;
    const away = (q: { x: number; z: number; level: number }) => Math.hypot(q.x - p.x, q.z - p.z) + 15 * Math.abs(q.level - p.level);
    let best: Person | null = null;
    let tie = 1;
    for (const id of g.members) {
      const q = this.people[id]!;
      if (q === p || q.staff || q.role === "host" || !q.present || q.held === "tray" || g.speaker === q.id || (q.avoid.get("errand") ?? -1) > this.t) continue;
      if (q.action?.id !== "mingle" || q.action.startedAt === null) continue;
      const k = this.tieFor(p.id, q.id);
      if (k > tie || (k === tie && best && away(q) < away(best))) {
        best = q;
        tie = k;
      }
    }
    if (!best || tie < 2) return;
    const q = best;
    const from = (s: Spot) => Math.hypot(s.x - q.x, s.z - q.z) + 15 * Math.abs(s.level - q.level);
    const bar = [...this.places.bars].sort((a, b) => from(a) - from(b))[0];
    if (!bar) return;
    p.avoid.set("errand", this.t + 40 * 60);
    q.avoid.set("errand", this.t + 30 * 60);
    this.gesture(p, "ask", 2);
    if (this.asks.chance(ASK_REFUSED)) {
      this.gesture(q, "shrug", 2);
      return;
    }
    if (this.tasks.errand("drink", q, p, -1, bar, p)) this.counts.fetched++;
  }

  /** Cold outside after dinner: the cloakroom attendant brings the coat out. */
  private coatBrought(p: Person): void {
    const at = this.people.find((q) => q.role === "cloakroom" && q.present && q.action?.id !== "task");
    const coat = this.places.chains.coats.spots[0];
    if (!at || !coat || p.coat < 0 || this.world.items.stateOf(p.coat) !== "hung") return;
    p.avoid.set("errand", this.t + 30 * 60);
    this.tasks.errand("coat", at, p, p.coat, coat, p);
  }

  /** The employee fetches the boss a drink when the boss's hands are empty. */
  private maybeFetch(p: Person): boolean {
    if (p.archetype !== "employee" || p.linked < 0 || (p.avoid.get("errand") ?? -1) > this.t) return false;
    const boss = this.people[p.linked]!;
    const ph = this.phase.id;
    if (!boss.present || boss.gone || (boss.held && DRINKS.has(boss.held)) || ph === "toast" || ph === "dinner" || ph === "champagne" || ph === "farewell") return false;
    if (boss.level !== p.level || Math.hypot(boss.x - p.x, boss.z - p.z) > 10) return false;
    p.avoid.set("errand", this.t + 15 * 60);
    const away = (s: Spot) => Math.hypot(s.x - p.x, s.z - p.z) + 15 * Math.abs(s.level - p.level);
    const bar = [...this.places.bars].sort((a, b) => away(a) - away(b))[0];
    return !!(bar && this.life.chance(0.6) && this.tasks.errand("drink", p, boss, -1, bar, boss));
  }

  /**
   * Not seen their partner for a while: go and look, the plus-one sooner, and anyone with doubts
   * sooner still. Sure enough of it, they go to have it out.
   */
  private maybeSearch(p: Person): boolean {
    if (p.partner === null || this.bonds.apart[p.id]) return false;
    const q = this.people[p.partner]!;
    const ph = this.phase.id;
    // Gone without a word (milestone 3) is looked for like anyone not seen for a while.
    if ((!this.vanished(q) && (!q.present || q.gone)) || q.role === "host" || ph === "toast" || ph === "dinner" || ph === "champagne") return false;
    const since = this.t - this.memory.lastT[p.id * this.people.length + q.id]!;
    if (this.bonds.wantsConfront(p)) {
      // In sight and close: straight over. Otherwise a search, meaning it.
      if (since < 10 && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 10 && this.free(q)) {
        this.bonds.confront(p, q);
        return p.action?.id === "row";
      }
      if (this.tasks.of(q)?.kind === "search" || (p.avoid.get("confront") ?? -1) > this.t) return false;
      p.avoid.set("confront", this.t + 3 * 60);
      return this.confrontSearch(p, q);
    }
    if ((p.avoid.get("search") ?? -1) > this.t) return false;
    const watchful = this.bonds.doubt(p.id) >= WATCHFUL;
    // Not both at once, and not all night.
    if (this.tasks.of(q)?.kind === "search" || this.tasks.list.filter((t) => t.kind === "search" && t.owner === p.id).length >= SEARCHES + (watchful ? 2 : 0)) return false;
    if (since < (watchful ? 5 * 60 : p.archetype === "plus-one" ? SEARCH_AFTER_PLUS_ONE : SEARCH_AFTER)) return false;
    p.avoid.set("search", this.t + (watchful ? 5 : 25) * 60);
    return (watchful || this.life.chance(0.3 + 0.5 * (1 - p.needs.companion))) && !!this.tasks.search(p, q);
  }

  /** The host shows a few guests who don't know the house round it: the plus-one and first-timers first. */
  private maybeTour(p: Person): boolean {
    const ph = this.phase.id;
    if ((ph !== "mingle" && ph !== "dancing" && ph !== "games") || this.practices.opening) return false;
    if (this.tasks.count("tour") >= TOURS || this.t - this.lastTour < TOUR_GAP || !this.life.chance(TOUR_CHANCE)) return false;
    const free = (q: Person) => !q.action || ["mingle", "art", "use", "wander", "sit", "snack", "terrace"].includes(q.action.id);
    const near = this.leavers.filter((q) => q.present && !q.regular && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 10 && free(q));
    if (!near.length) return false;
    const first = (q: Person) => (q.archetype === "plus-one" ? 0 : 1);
    near.sort((a, b) => first(a) - first(b) || Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    this.lastTour = this.t;
    return !!this.tasks.tour(p, near.slice(0, this.life.int(1, 3)));
  }

  /** A wave to someone known, seen for the first time tonight; those free to go over and say hello. */
  private maybeGreet(p: Person): void {
    const a = p.action;
    if (a && !WAVE_FROM.has(a.id)) return;
    const free = p.role !== "host" && (!a || GREET_FROM.has(a.id) || (a.id === "mingle" && a.note !== "in"));
    const j = this.circles.greetWho(p, free);
    if (j < 0) return;
    const s = beside(this.people[j]!, p, this.pf, 1.2);
    if (!s) return;
    this.end(p, false);
    this.start(p, { id: "greet", target: s, duration: 4, pose: "stand", gain: { social: 0.15 }, ref: j });
  }

  /** Whether a guest wants to go home now: an early reason after dessert, or enough others gone once the last toast is drunk. Off they go, with their partner. */
  private departure(p: Person): void {
    const a = p.action;
    if (!p.present || a?.id === "leave" || this.tasks.of(p)?.kind === "leave") return;
    if (p.id === this.spyId) return this.spyDeparture(p, this.spy!);
    // Near the end everyone goes, each at their own moment over a few minutes; the last few hurry.
    const late = this.t >= PARTY_LENGTH - LAST_OUT + p.leaveAt * (LAST_OUT - HURRY_OUT);
    if (!late && (this.memory.household[p.id] || (a?.id === "toilet" && a.note !== "door") || a?.id === "task" || a?.id === "row" || !this.wantsToGo(p))) return;
    this.goHome(p, this.t >= PARTY_LENGTH - HURRY_OUT);
  }

  private wantsToGo(p: Person): boolean {
    const ph = this.phase;
    if (p.early && this.phaseIdx > this.dinnerIdx) {
      const dance = this.programme[this.dinnerIdx + 1]!;
      if (this.t >= dance.start + (dance.end - dance.start) * (0.05 + 0.5 * p.leaveAt)) return true;
    }
    if (ph.id !== "farewell" || phaseProgress(ph, this.t) < LAST_TOAST) return false;
    return this.shareGone() >= p.leaveAt;
  }

  /**
   * The spy goes home by its own rule (spy/index.ts), never before the farewell's first goodbye,
   * and in the last hurry whatever it meant to do. When its moment comes it drops whatever it is
   * busy with (dabbing a spill, an errand) rather than miss the first leavers, but it waits out
   * the bathroom and a row; a partner in the bathroom it doesn't wait for. Playing the host, it walks out with a leaving guest and doesn't come
   * back; as a waiter it carries a coat out with leaving guests the same way; in the last hurry it walks out alone.
   */
  private spyDeparture(p: Person, spy: Spy): void {
    const a = p.action;
    const hurry = this.t >= PARTY_LENGTH - HURRY_OUT;
    if (!spy.mayGo()) return;
    if (!hurry && ((a?.id === "toilet" && a.note !== "door") || a?.id === "row" || !spy.wantsToGo())) return;
    if ((p.role === "host" || p.staff) && !hurry) {
      // A host never goes home: it walks out with a guest already past their goodbye, and waits for one. A waiter sees them out to the cars with a coat over its arm.
      const t = this.tasks.running("leave").find((x) => x.owner !== p.id && x.i > x.steps.findIndex((st) => st.label === "goodbye"));
      if (!t) return;
      this.log("spy", [p.id], p.room, "leave");
      if (p.staff) {
        this.body.setDown(p);
        p.held = "coat";
        p.heldUntil = PARTY_LENGTH + 1;
      }
      this.tasks.join(t, p);
      return;
    }
    this.log("spy", [p.id], p.room, "leave");
    if (p.staff || p.role === "host") {
      this.end(p, false);
      const t = this.tasks.leave(p, null, null, true);
      if (t.outcome === "gave-up") this.start(p, { id: "leave", target: this.places.entrance, duration: 0, pose: "walk", gain: {}, programme: true });
      return;
    }
    this.goHome(p, hurry);
  }

  /** Guests (the household aside) gone home or on their way out, of how many. */
  private going(): { going: number; n: number } {
    let n = 0;
    let going = 0;
    for (const q of this.leavers) {
      if (this.memory.household[q.id]) continue;
      n++;
      if (q.gone || q.action?.id === "leave" || this.tasks.of(q)?.kind === "leave") going++;
    }
    return { going, n };
  }

  /**
   * Share of the farewell's leavers on their way out: of the guests still here after the first
   * goodbye, those who have set off home since (0 before it). The spy goes by it, among the first half.
   */
  farewellGoing(): number {
    if (this.byeAt < 0) return 0;
    const { going, n } = this.going();
    return n > this.byeGoing ? (going - this.byeGoing) / (n - this.byeGoing) : 1;
  }

  /** Share of the guests (the household aside) already gone home. */
  shareGone(): number {
    let n = 0;
    let gone = 0;
    for (const q of this.leavers) {
      if (this.memory.household[q.id]) continue;
      n++;
      if (q.gone) gone++;
    }
    return n ? gone / n : 1;
  }

  goHome(p: Person, hurry: boolean): void {
    const spy = this.spy;
    // The spy leaves by its own rule alone: no scene, card or partner takes it home before the farewell's first goodbye.
    if (spy && p.id === spy.id && !spy.mayGo()) return;
    const q = p.partner !== null ? this.people[p.partner]! : null;
    let partner: Person | null = null;
    const staysOn = !!spy && q?.id === spy.id && !spy.mayGo();
    if (q && q.role !== "host" && !staysOn && !this.bonds.apart[p.id] && q.present && !q.gone && q.action?.id !== "leave" && this.tasks.of(q)?.kind !== "leave") {
      // Wait for them to come out of the bathroom first; not the spy, whose moment among the first leavers comes first (they follow on their own).
      if (!hurry && q.action?.id === "toilet" && q.action.note !== "door") {
        if (p.id !== spy?.id) return;
      } else partner = q;
    }
    const attendant = this.people.find((x) => x.role === "cloakroom" && x.present) ?? null;
    const party = partner ? [p, partner] : [p];
    const first = this.bags.goingHome(party);
    this.finding?.goingHome(party);
    const t = this.tasks.leave(p, partner, attendant, hurry, first);
    if (this.byeAt < 0 && this.phase.id === "farewell") {
      this.byeAt = this.t;
      this.byeGoing = this.going().going;
      this.spy?.firstGoodbye();
    }
    // The attendant leaves the cloakroom for the door with the coats.
    if (attendant?.action?.id === "staff" && attendant.action.note === "cloakroom") {
      this.end(attendant, false);
      attendant.thinkAt = this.t;
    }
    if (t.outcome !== "gave-up") return;
    // No way through for the task: straight for the door.
    for (const x of [p, ...(partner ? [partner] : [])]) if (!x.gone) this.start(x, { id: "leave", target: this.places.entrance, duration: 0, pose: "walk", gain: {}, programme: true });
  }

  /** Out of the front door for good, coat on. */
  depart(p: Person): void {
    this.release(p);
    this.bags.departed(p);
    if (p.id === this.spyId) this.spy!.covers.left();
    this.leaveWithThings(p);
    p.action = null;
    p.path = [];
    p.pathIndex = 0;
    p.present = false;
    p.gone = true;
    this.log("leave", [p.id], p.room);
  }

  /** The perch's view of a spot now, with the curtains as they are (0 to 1); off the walk grid, out in the garden, half. */
  viewAt(at: { level: number; x: number; z: number }): number {
    const k = this.pf.cellOf(at.level, at.x, at.z);
    return k >= 0 ? this.world.visAt(at.level, k) : 0.5;
  }

  /** A body out of play (milestone 3, PR 5): present no more and gone, where it lies; its glass set down where it fell, its bag and coat left where they were. */
  leavePlay(p: Person): void {
    this.release(p);
    p.action = null;
    p.detour = null;
    p.path = [];
    p.pathIndex = 0;
    p.present = false;
    p.gone = true;
    this.leftPlay[p.id] = 1;
  }

  /** Gone without a goodbye: whoever looks for them never finds them. */
  vanished(q: Person): boolean {
    return this.leftPlay[q.id] === 1;
  }

  /**
   * The spy out of the room it bolted, as the one it killed there (spy/swap.ts): their record
   * takes its body (its height and build, its walk, its voice, its own habits and skills, what it
   * has drunk, the bandage on its hand), its mind (its temper, whom it knows and what it holds, its
   * map of the house, what it knows of the bathrooms) and its place in the room. The record keeps
   * who they are to everyone else: the name, the clothes (a stain and all), the partner and
   * friends, the seat, the coat, their bag, and every memory of them. What they were set on goes
   * with them: their doubts and tests, their grudges, their cases, whatever they were sure of or
   * meant to tell. Its old self leaves play with no goodbye, its coat on its hook and a bag it
   * carried left with its clothes.
   */
  swapSpy(v: Person): void {
    const spy = this.spy!;
    const a = spy.record;
    const own = spy.own;
    const items = this.world.items;
    // Up again where it stands, in their clothes.
    v.present = true;
    v.gone = false;
    v.down = null;
    this.leftPlay[v.id] = 0;
    v.level = a.level;
    v.x = a.x;
    v.z = a.z;
    v.y = a.y;
    v.yaw = a.yaw;
    v.room = a.room;
    v.pose = "stand";
    v.action = null;
    v.path = [];
    v.pathIndex = 0;
    v.detour = null;
    v.thinkAt = this.t;
    v.gesture = null;
    v.gestureUntil = 0;
    v.lookUntil = 0;
    v.notable = null;
    v.notableObj = -1;
    v.notableRoom = -1;
    v.notableUntil = 0;
    if (v.held !== "bag") v.held = null;
    // Its own body.
    v.tipsy = a.tipsy;
    v.drinks = a.drinks;
    v.drinkLog = a.drinkLog.map((d) => ({ ...d }));
    v.needs = { ...a.needs };
    v.bandage = a.bandage;
    v.phaseSeen = a.phaseSeen;
    dress(v, own, false);
    this.mood.energy[v.id] = this.mood.energy[a.id]!;
    this.mood.tension[v.id] = this.mood.tension[a.id]!;
    this.doorIn[v.id] = this.doorIn[a.id]!;
    this.doorIn[a.id] = -1;
    // Its own mind: what it knows moves with it, and what they were set on goes.
    this.memory.moveSelf(a.id, v.id);
    this.body.moveSelf(a.id, v.id);
    this.register.forget(v.id);
    this.register.forget(a.id);
    this.register.refreshLook(v);
    this.ident.impostor(v.id, (i) => spy.answers.answer(i));
    this.ident.newMind(v.id);
    this.ident.recast(v, own.voice);
    this.bonds.setTemper(v.id, own.temper);
    this.bonds.newMind(v.id);
    for (const x of [v, a]) {
      this.alarmOf[x.id] = -1;
      this.sureOf[x.id] = -1;
      this.backedAway[x.id] = 0;
      this.watching[x.id] = -1;
      this.about.delete(x.id);
      this.lookFor.delete(x.id);
    }
    // Whom it kept away from was about its old face (the answers raise it anew); the rest of its avoid list is its own.
    v.avoid = new Map([...a.avoid].filter(([k]) => !k.startsWith("person:")));
    // Its old self: a bag it carried stays with its clothes; then out of play, gone with no goodbye.
    for (let i = 0; i < items.n; i++) {
      if (items.holder[i] !== a.id || items.kindOf(i) !== "bag") continue;
      items.holder[i] = -1;
      items.set(i, "down", this.t);
      items.place(i, a);
    }
    a.held = null;
    this.leavePlay(a);
    if (v.role === "host") this.prompts.fake = true;
    spy.became(v.id);
  }

  /** A task step the party acts on. */
  stepDone(t: Task, p: Person, st: Step): void {
    if (t.kind === "spy") this.spy?.stepDone(t, st);
    if (t.kind === "check" && st.label === "look-in") this.lookInCabinet(p, t.item);
    else if (st.do === "pick" && st.item === this.spy?.garment?.item) this.spy.garmentFound();
    else if (st.label === "dinner-ready") this.log("beat", [p.id, this.host.id], p.room, "dinner-cue");
    this.bags.stepDone(t, p, st);
    this.finding?.stepDone(t, p, st);
    this.dramas.stepDone(t, p, st);
  }

  /** A camera flash, kept for the renderer. */
  flash(p: Person): void {
    this.flashes.push({ t: this.t, level: p.level, x: p.x, z: p.z, room: p.room });
    if (this.flashes.length > 32) this.flashes.shift();
    this.dramas.flashed(p);
  }

  /** A walkable spot beside someone, on the side toward a point, facing them. */
  beside(q: Person, from: { x: number; z: number }, gap?: number, free?: Person): Spot | null {
    return beside(q, from, this.pf, gap, free ? { people: this.people, self: free.id } : undefined);
  }

  pour(p: Person, d: DrinkId): void {
    this.body.pour(p, d);
  }

  carry(p: Person, d: DrinkId): void {
    this.body.carry(p, d);
  }

  handGlass(p: Person, q: Person): void {
    this.body.handOver(p, q);
  }

  /** A room's noise (dB), the terrace for -2. */
  noiseIn(room: number): number {
    return this.senses.noise[room < 0 ? this.sight.R - 1 : room]!;
  }

  /** How far the evening has mixed people: none before dinner, rising through it, fully from the dancing. */
  get mixing(): number {
    if (this.phase.id === "dinner") return phaseProgress(this.phase, this.t);
    return this.phaseIdx > this.dinnerIdx ? 1 : 0;
  }

  seenLast(i: number): readonly number[] {
    return this.senses.seenLast[i]!;
  }

  beat(p: Person, a: ActionId): number {
    return this.practices.mult(p, a);
  }

  private get dinnerIdx(): number {
    return this.programme.findIndex((ph) => ph.id === "dinner");
  }

  // ------------------------------------------------------------- knowing the house

  /**
   * What everyone knows of the house as the evening starts: the host and their partner live here,
   * staff know the rooms they work, regulars the party rooms and the nearest bathrooms, and every
   * guest the entrance hall and the rooms it opens onto.
   */
  private knowTheHouse(): void {
    const m = this.memory;
    const pl = this.places;
    const bp = this.bp;
    const host = this.host;
    m.household[host.id] = 1;
    if (host.partner !== null) m.household[host.partner] = 1;
    const party = new Set<number>([...pl.partyRooms.map((r) => r.index), pl.toastRoom.index]);
    for (const r of [pl.dining, pl.danceRoom]) if (r) party.add(r.index);
    const toast = pl.toastSpot;
    const near = [...pl.bathrooms].sort((a, b) => far(a.door) - far(b.door)).slice(0, 2);
    function far(s: Spot): number {
      return Math.hypot(s.x - toast.x, s.z - toast.z) + 10 * Math.abs(s.level - toast.level);
    }
    const hall = pl.entranceRoom?.index ?? pl.entrance.room;
    const offHall = (this.world.graph[hall] ?? []).filter((e) => e.kind !== "stair").map((e) => e.to);
    // Regulars know the party rooms, the nearest bathrooms and the way to each from the toast.
    const known = new Set<number>([...party, ...near.map((b) => b.room.index)]);
    for (const r of [...party]) {
      const to = this.cells.random(r, this.mapRng);
      if (to) for (const w of this.roomsOnTheWay(toast, to, null)) known.add(w);
    }
    for (const b of near) for (const w of this.roomsOnTheWay(toast, b.door, null)) known.add(w);
    for (const p of this.people) {
      if (m.household[p.id]) continue;
      if (p.staff) {
        for (const r of bp.rooms) m.startKnowing(p.id, r.index, STAFF_ROUGH.has(r.type) ? 0.3 : 0.9, 8);
        m.startKnowing(p.id, -2, 0.9, 8);
        continue;
      }
      // Known from before, so it never fades far.
      if (p.regular) for (const r of known) m.startKnowing(p.id, r, 0.8, 8);
      m.startKnowing(p.id, hall, 0.6, 1);
      for (const r of offHall) m.startKnowing(p.id, r, 0.6);
    }
  }

  /** Walked into a room: learnt, maybe noticed coming out of a bedroom, maybe the wrong turn at a junction. */
  private enterRoom(p: Person, from: number): void {
    this.memory.walkInto(p.id, p.room);
    this.register.moved(p, p.room);
    const type = (r: number) => (r >= 0 ? this.bp.rooms[r]!.type : null);
    const fromType = type(from);
    const toType = type(p.room);
    // Through a bedroom to its bathroom, for the coats, or on the host's tour, nobody thinks twice; the spy about its own business is seen coming out like anyone.
    const task = p.action?.id === "task" ? this.tasks.of(p) : undefined;
    const why = p.action?.id === "toilet" || p.action?.id === "leave" || (p.action?.id === "task" && task?.kind !== "spy");
    // Walking someone off or dragging them, the kill shows its own.
    if (!p.staff && !this.memory.household[p.id] && !why && fromType && SNOOP.has(fromType) && !(toType && SNOOP.has(toType)) && !this.spy?.kill.showing(p))
      this.notable(p, "left-bedroom", -1, 8, from);
    this.maybeWrongTurn(p, from);
    this.dramas.entered(p);
    this.spy?.entered(p);
  }

  /**
   * At a junction on the way somewhere, a guest may take the wrong doorway: a few steps into the
   * wrong room (or up to a door that turns out locked), a look round, then back on the way. The
   * chance is (0.5 − k) × (1 + tipsiness), where k is how well they know where they're going or
   * the room the right doorway leads into, whichever is better: someone sure of the bathroom
   * finds it from anywhere, and a hall crossed all evening fools nobody.
   */
  private maybeWrongTurn(p: Person, from: number): void {
    const a = p.action;
    if (!a || p.detour || p.staff || this.memory.knowsHouse(p.id) || a.startedAt !== null || !LOSES_WAY.has(a.id)) return;
    if ((a.id === "toilet" && a.note !== "door") || this.t - this.lostAt[p.id]! < 120) return;
    const goal = p.path[p.path.length - 1];
    if (!goal || p.room === -1) return;
    const goalRoom = this.pf.roomAt(goal.level, goal.x, goal.z);
    if (goalRoom === p.room || goalRoom === -1) return;
    // The way they should go next.
    let next = -1;
    for (let i = p.pathIndex; i < p.path.length && next < 0; i++) {
      const w = p.path[i]!;
      if (w.climb) break;
      const r = this.pf.roomAt(w.level, w.x, w.z);
      if (r !== p.room && r !== -1) next = r;
    }
    const dest = this.memory.familiarity(p.id, destination(a, this.places));
    const k = next !== -1 ? Math.max(dest, this.memory.familiarity(p.id, next)) : dest;
    const chance = Memory.wrongTurnChance(k, p.tipsy);
    if (chance <= 0 || !this.mapRng.chance(chance)) return;
    const R = this.bp.rooms.length;
    const edges = (this.world.graph[p.room < 0 ? R : p.room] ?? []).filter((e) => e.kind !== "stair" && e.level === p.level && e.to !== next && e.to !== from && e.to !== goalRoom);
    if (!edges.length) return;
    const e = this.mapRng.pick(edges);
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < 0.3) return;
    const ux = (e.x - p.x) / d;
    const uz = (e.z - p.z) / d;
    const door = e.door >= 0 ? this.world.doors[e.door]! : null;
    const locked = !!door && !this.world.canPass(door, p);
    // Through the doorway and a step in, or up to the locked door.
    const s = locked ? this.pf.snap(p.level, e.x - ux * 0.6, e.z - uz * 0.6, 0.5) : this.pf.snap(p.level, e.x + ux * 1.2, e.z + uz * 1.2, 0.6);
    if (!s || (!locked && this.pf.roomAt(s.level, s.x, s.z) !== e.to)) return;
    const route = this.pf.route({ level: p.level, x: p.x, z: p.z }, s, p);
    if (!route) return;
    p.detour = { goal, until: -1, door: locked ? door!.id : -1 };
    this.lostAt[p.id] = this.t;
    p.path = route;
    p.pathIndex = 1;
    this.notable(p, "wrong-turn", -1, 20);
    this.slipped(p, HOUSE, 20);
    this.counts.wrongTurns++;
    this.log("wrong-turn", [p.id], p.room, locked ? "door" : undefined);
  }

  /** At the end of a wrong turn: try the locked door, or look round the wrong room. */
  private lookRound(p: Person): void {
    const dt = p.detour!;
    dt.until = this.t + LOOK_ROUND;
    if (dt.door >= 0) {
      const d = this.world.doors[dt.door]!;
      p.yaw = yawTo(p.x, p.z, d.x, d.z);
      this.notable(p, "locked-door", -1, 8);
    }
  }

  private backOnTheWay(p: Person): void {
    const goal = p.detour!.goal;
    p.detour = null;
    const route = this.pf.route({ level: p.level, x: p.x, z: p.z }, goal, p);
    if (!route) return this.end(p, false);
    p.path = route;
    p.pathIndex = 1;
  }

  // ------------------------------------------------------------------ asking

  /** Asking the way, or the friendly test: walk up to them (they may be moving), a word, then act on the answer. */
  private askStep(p: Person, a: ActionState, dt: number): void {
    const q = this.people[a.ref!]!;
    if (a.startedAt !== null) {
      p.yaw = yawTo(p.x, p.z, q.x, q.z);
      if (this.t - a.startedAt < a.duration) return;
      const bath = this.answers.get(p.id) ?? -1;
      this.answers.delete(p.id);
      this.end(p, true);
      // Told someone they're sure of: off to look for the real one.
      const real = this.lookFor.get(p.id);
      if (real !== undefined) {
        this.lookFor.delete(p.id);
        const r = this.people[real]!;
        if (r.present && !r.gone) this.tasks.search(p, r, "real");
        return;
      }
      const b = this.places.bathrooms[bath];
      if (b && this.worthTrying(p, bath)) this.start(p, { id: "toilet", target: b.door, duration: this.rng.range(120, 240), pose: "wait", gain: { bladder: 1 }, ref: bath, note: "door" });
      return;
    }
    if (!q.present || this.t >= a.until!) {
      p.avoid.set(`ask:${q.id}`, this.t + 600);
      return this.end(p, false);
    }
    if (q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 1.6) return this.answer(p, q, a);
    this.chase(p, a, q, dt);
  }

  /** Walking up to someone who may be moving: re-aim when they've moved on (never halfway up a stair). */
  private chase(p: Person, a: ActionState, q: Person, dt: number): void {
    const tgt = a.target!;
    if (!p.path[p.pathIndex]?.climb && (Math.hypot(q.x - tgt.x, q.z - tgt.z) > 1.5 || q.level !== tgt.level || p.pathIndex >= p.path.length)) {
      const s = beside(q, p, this.pf);
      const route = s ? this.pf.route({ level: p.level, x: p.x, z: p.z }, s, p) : null;
      if (!s || !route) return this.end(p, false);
      a.target = s;
      p.path = route;
      p.pathIndex = 1;
    }
    this.walk(p, dt);
  }

  /** Going over to say hello: up close, a handshake or a kiss on the cheek, then on with the evening. */
  private greetStep(p: Person, a: ActionState, dt: number): void {
    const q = this.people[a.ref!]!;
    if (a.startedAt !== null) {
      p.yaw = yawTo(p.x, p.z, q.x, q.z);
      if (this.t - a.startedAt >= a.duration) this.end(p, true);
      return;
    }
    if (!q.present || q.gone || this.t >= a.until!) return this.end(p, false);
    if (q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 1.6) {
      a.startedAt = this.t;
      a.pose = this.circles.greetPose(p, q);
      p.path = [];
      p.pathIndex = 0;
      p.yaw = yawTo(p.x, p.z, q.x, q.z);
      this.glance(q, p.x, p.z, a.duration);
      this.circles.greeted(p, q, a.pose);
      return;
    }
    this.chase(p, a, q, dt);
  }

  private answer(p: Person, q: Person, a: ActionState): void {
    a.startedAt = this.t;
    p.yaw = yawTo(p.x, p.z, q.x, q.z);
    this.glance(q, p.x, p.z, a.duration);
    // Standing by someone who fumbled, to help: nothing to say.
    if (a.note === "help") return;
    const quiet = a.note === "tell" || a.note === "compare" || a.note === "tell-sure" || a.note === "tell-attack";
    this.gesture(p, quiet ? "lean" : a.note === "confront" ? "point" : "ask", 2);
    // The test logs itself, with what it came to (tested()).
    if (a.note === "test") return void this.ident.test(p.id, q.id, this.t);
    // A stray's word with the one they have an eye on: just talk.
    if (a.note === "eye") return;
    if (a.note === "tell") {
      this.register.tellHost(p.id, q.id);
      this.log("tell", [p.id, q.id], p.room);
      return;
    }
    if (a.note === "compare" || a.note === "tell-sure") {
      const j = this.about.get(p.id);
      this.about.delete(p.id);
      if (j === undefined) return;
      if (a.note === "compare") this.compareNotes(p, q, j);
      else this.toldSure(p, q, j);
      return;
    }
    if (a.note === "confront") return this.confront(p, q);
    if (a.note === "tell-attack") return this.toldAttack(p, q);
    this.counts.asks++;
    // The bathroom they know nearest the one asking.
    let best = -1;
    let bd = Infinity;
    this.places.bathrooms.forEach((b, i) => {
      if (this.memory.familiarity(q.id, b.room.index) < KNOWN) return;
      const d = Math.hypot(b.door.x - p.x, b.door.z - p.z) + 10 * Math.abs(b.door.level - p.level);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    this.answers.set(p.id, best);
    if (best < 0) {
      this.gesture(q, "shrug", 2);
      p.avoid.set(`ask:${q.id}`, this.t + 900);
      this.log("ask", [p.id, q.id], p.room, "shrug");
      return;
    }
    const b = this.places.bathrooms[best]!;
    this.gesture(q, "point", 3);
    q.lookX = b.door.x;
    q.lookZ = b.door.z;
    this.memory.pointed(p.id, this.roomsOnTheWay(p, b.door, p));
    this.memory.startKnowing(p.id, b.room.index, POINTED);
    this.log("ask", [p.id, q.id], p.room, "pointed");
  }

  /** Rooms a route from one place to a spot passes through, sampled every metre. */
  private roomsOnTheWay(from: Waypoint, s: Spot, who: Person | null): number[] {
    const route = this.pf.route({ level: from.level, x: from.x, z: from.z }, s, who);
    const out = new Set<number>();
    if (!route) return [s.room];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!;
      const b = route[i]!;
      if (b.climb) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
      for (let k = 0; k <= n; k++) {
        const r = this.pf.roomAt(b.level, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n);
        if (r !== -1) out.add(r);
      }
    }
    out.add(s.room);
    return [...out];
  }

  /** The nearest free seat off the dining table within reach (m), on their storey, or null. */
  seatNear(p: Person, within: number): Seat | null {
    let best: Seat | null = null;
    let bd = within;
    for (const s of this.places.seats) {
      const a = s.approach;
      if (s.kind === "dining" || a.level !== p.level || this.seats.has(s.id)) continue;
      const d = Math.hypot(a.x - p.x, a.z - p.z);
      if (d < bd && (p.room < 0 || a.room < 0 || this.world.reachable(p.room, a.room, p))) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** The bathroom someone would make for: the nearest they know and would try, else the nearest of all (-1 none). */
  bathFor(p: Person): number {
    let best = -1;
    let bd = Infinity;
    this.places.bathrooms.forEach((b, i) => {
      const known = this.memory.familiarity(p.id, b.room.index) >= KNOWN && this.body.worthTrying(p, i);
      const d = Math.hypot(b.door.x - p.x, b.door.z - p.z) + 10 * Math.abs(b.door.level - p.level) + (known ? 0 : 1000);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  setDown(p: Person, here = false): void {
    this.body.setDown(p, here);
  }

  /** Off to change after a spill: the bag left on a chair more often than not. */
  spilledOn(v: Person): void {
    this.bags.spilled(v);
  }

  /** Someone near and known to ask the way: a friend, a partner, staff, the host, or anyone met. Staff and the host first. */
  answerer(p: Person): Person | null {
    let best: Person | null = null;
    let bd = 20;
    const n = this.people.length;
    for (const q of this.people) {
      if (q === p || !q.present || q.down || q.level !== p.level || (p.avoid.get(`ask:${q.id}`) ?? -1) > this.t) continue;
      if (q.action?.id === "toilet" || q.action?.id === "leave" || q.action?.id === "ask") continue;
      if (!(q.staff || q.role === "host" || q.id === p.partner || p.friends.includes(q.id) || this.ident.tieOf(p.id, q.id) >= 1)) continue;
      if (this.memory.lastT[p.id * n + q.id]! < this.t - 60) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z) * (q.staff || q.role === "host" ? 0.7 : 1);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ ties

  /**
   * Having words (bonds.ts starts it): the one with something to say walks up; at arm's length
   * it begins, voices raised for a row, an act at its height (a slap, a shove, a drink thrown),
   * then it's over and the bonds count the cost. The one it's put to stands and faces them.
   */
  private rowStep(p: Person, a: ActionState, dt: number): void {
    const q = this.people[a.ref!]!;
    if (a.note === "answer") {
      const qa = q.action;
      if (!q.present || qa?.id !== "row" || qa.ref !== p.id) return this.end(p, true);
      if (Math.hypot(q.x - p.x, q.z - p.z) > 0.3) p.yaw = yawTo(p.x, p.z, q.x, q.z);
      return;
    }
    if (a.note === "part") {
      // Breaking up a scuffle: over to them, a hand on an arm, and it's done.
      if (!q.present || q.action?.id !== "row" || this.t >= a.until!) return this.end(p, false);
      if (a.startedAt === null) {
        if (q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 1.4) {
          a.startedAt = this.t;
          p.path = [];
          p.pathIndex = 0;
          this.gesture(p, "pull", 2);
          if (q.action.startedAt !== null) q.action.duration = Math.min(q.action.duration, this.t - q.action.startedAt + 1.5);
        } else this.chase(p, a, q, dt);
        return;
      }
      p.yaw = yawTo(p.x, p.z, q.x, q.z);
      if (this.t - a.startedAt >= a.duration) this.end(p, true);
      return;
    }
    if (a.startedAt === null) {
      if (!q.present || q.gone || this.t >= a.until!) {
        if (q.action?.id === "row" && q.action.ref === p.id) this.end(q, false);
        return this.end(p, false);
      }
      if (q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 1.4) {
        a.startedAt = this.t;
        p.path = [];
        p.pathIndex = 0;
        p.yaw = yawTo(p.x, p.z, q.x, q.z);
        this.rowBegins(p, q, a);
        return;
      }
      return this.chase(p, a, q, dt);
    }
    if (Math.hypot(q.x - p.x, q.z - p.z) > 0.3) p.yaw = yawTo(p.x, p.z, q.x, q.z);
    const [kind, act] = (a.note ?? "spat").split(":") as [string, string | undefined];
    const el = this.t - a.startedAt;
    const loud = kind === "row" || kind === "act" || kind === "jealous" || kind === "scuffle" || kind === "quarrel";
    if (loud && el % 8 < dt) this.senses.sound("raised-voice", p, p.id);
    if (kind === "scuffle" && el % 3 < dt) this.gesture(this.chat.chance(0.5) ? p : q, "shove", 1);
    // The act, at the height of it.
    if (act && el >= a.duration * 0.4 && el - dt < a.duration * 0.4) this.rowAct(p, q, act);
    if (el < a.duration) return;
    const note = a.note ?? "spat";
    this.end(p, true);
    if (q.action?.id === "row" && q.action.ref === p.id) this.end(q, true);
    // A couple's quarrel is the dramas' (who storms off, and making up after); the rest the bonds count.
    if (kind === "quarrel") this.dramas.quarrelOver(p, q);
    else if (kind !== "hug") {
      this.bonds.rowOver(p, q, note);
      if (loud) this.dramas.upset(p, q);
    }
    // A pull by the arm: off somewhere quieter for a hissed word.
    if (kind === "pull" && this.free(p) && this.free(q)) {
      const near = (this.world.graph[p.room] ?? []).filter((e) => e.to !== -1 && e.kind !== "stair").map((e) => e.to);
      const to = near.length ? this.cells.random(this.chat.pick(near), this.chat, 0.8) : null;
      if (to) this.tasks.lead(p, q, to, this.chat.range(15, 30));
    }
  }

  /** A row has begun: who hears it, who frowns, and for a scuffle, who steps in. */
  private rowBegins(p: Person, q: Person, a: ActionState): void {
    const kind = (a.note ?? "").split(":")[0];
    if (kind === "hug") return;
    this.gesture(p, kind === "pull" ? "pull" : "point", 2);
    this.glance(q, p.x, p.z, a.duration);
    if (kind === "row" || kind === "act" || kind === "jealous" || kind === "scuffle" || kind === "quarrel") this.senses.sound("raised-voice", p, p.id);
    if (kind !== "scuffle") return;
    // The nearest friend of either, or the nearest of the staff, steps in.
    const by = (o: Person) => Math.hypot(o.x - p.x, o.z - p.z) + (o.friends.includes(p.id) || o.friends.includes(q.id) ? 0 : o.staff ? 4 : 99);
    const breaker = this.people
      .filter((o) => o !== p && o !== q && o.present && o.level === p.level && Math.hypot(o.x - p.x, o.z - p.z) < 12 && (!o.action || !["toilet", "task", "row", "leave"].includes(o.action.id)))
      .sort((x, y) => by(x) - by(y))[0];
    const s = breaker ? beside(p, breaker, this.pf) : null;
    if (!breaker || !s || by(breaker) >= 99) return;
    this.end(breaker, false);
    this.start(breaker, { id: "row", target: s, duration: 3, pose: "stand", gain: {}, ref: p.id, note: "part" });
  }

  /** A slap, a shove or a drink in the face. */
  private rowAct(p: Person, q: Person, act: string): void {
    if (act === "slap") {
      this.gesture(p, "slap", 1.5);
      this.senses.sound("slap", p, p.id);
      this.notable(q, "slapped", p.id, 30);
    } else if (act === "shove") {
      this.gesture(p, "shove", 1.5);
      // Back a step.
      const d = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const s = this.pf.snap(q.level, q.x + ((q.x - p.x) / d) * 0.4, q.z + ((q.z - p.z) / d) * 0.4, 0.2);
      if (s && this.pf.roomAt(s.level, s.x, s.z) === q.room) {
        q.x = s.x;
        q.z = s.z;
      }
      this.senses.sound("raised-voice", p, p.id);
    } else if (act === "throw") {
      this.gesture(p, "throw", 1.5);
      if (p.item >= 0 && this.world.items.kindOf(p.item) === "glass") {
        this.world.items.fill[p.item] = 0;
        this.body.setDown(p);
      }
      this.notable(q, "spill", p.id, 30);
    }
  }

  /** Dancing close: face to face with a partner, or club style, in front with their back to them, and the one behind. */
  private dancePose(p: Person, a: ActionState): Pose {
    const close = (q: Person | undefined) => !!q && q.present && q.action?.id === "dance" && q.action.startedAt !== null && Math.hypot(q.x - p.x, q.z - p.z) < 1;
    if (a.note === "front" || a.note === "face") {
      const q = this.people[a.ref ?? -1];
      if (!close(q)) return "dance";
      if (a.note === "face") p.yaw = yawTo(p.x, p.z, q!.x, q!.z);
      return a.note === "front" ? "front" : "slow";
    }
    for (const q of this.people) {
      const b = q.action;
      if (q === p || b?.id !== "dance" || b.ref !== p.id || (b.note !== "front" && b.note !== "face") || !close(q)) continue;
      p.yaw = yawTo(p.x, p.z, q.x, q.z);
      return b.note === "front" ? "behind" : "slow";
    }
    return "dance";
  }

  /** Whether someone could be drawn into something now: present, a guest, outside the rituals, and not busy with a task, the bathroom, leaving or words. */
  free(p: Person): boolean {
    if (!p.present || p.gone || p.down || p.staff || p.role === "host" || this.dramas.busy(p)) return false;
    const ph = this.phase.id;
    if (ph === "toast" || ph === "dinner" || ph === "champagne" || this.practices.speaking) return false;
    const a = p.action;
    return !a || !["toilet", "task", "leave", "dinner", "toast", "champagne", "row", "ask", "arrive"].includes(a.id);
  }

  /** Asked to dance: both onto the floor, face to face. The spy turns down anyone it keeps away from, and the floor when it can't dance as the one it plays did. */
  danceWith(a: Person, b: Person): boolean {
    const spy = this.spy;
    if (spy && (a.id === spy.id || b.id === spy.id)) {
      const other = a.id === spy.id ? b : a;
      const dodge = spy.dodges("dance");
      if (dodge || spy.answers.avoids(other.id)) {
        if (b.id === spy.id && dodge) this.begOff(a, b, DANCE);
        else if (b.id === spy.id) {
          this.gesture(b, "shrug", 2);
          this.log("spy", [b.id, a.id], b.room, "decline:dance");
        }
        return false;
      }
    }
    const free = this.places.danceSpots.filter((s) => !this.taken(spotKey(s)) && this.memory.familiarity(a.id, s.room) >= KNOWN);
    if (!free.length) return false;
    const s = free.sort((x, y) => Math.hypot(x.x - a.x, x.z - a.z) - Math.hypot(y.x - a.x, y.z - a.z))[0]!;
    const w = this.pf.snap(s.level, s.x + Math.sin(s.yaw) * 0.6, s.z + Math.cos(s.yaw) * 0.6, 0.15);
    if (!w || this.pf.roomAt(w.level, w.x, w.z) !== s.room) return false;
    const len = this.rng.range(240, 600);
    this.end(a, false);
    this.end(b, false);
    this.start(a, { id: "dance", target: s, duration: len, pose: "dance", gain: { dance: 0.8, social: 0.3 }, key: spotKey(s), ref: b.id });
    this.start(b, {
      id: "dance",
      target: { level: w.level, x: w.x, z: w.z, yaw: yawTo(w.x, w.z, s.x, s.z), room: s.room },
      duration: len,
      pose: "dance",
      gain: { dance: 0.8, social: 0.3 },
      ref: a.id,
      note: "face",
    });
    return true;
  }

  /** A stray goes over to the one they have an eye on: into their circle, or up for a word where they stand. */
  seekOut(p: Person, q: Person): boolean {
    const b = q.action;
    if (!b || b.startedAt === null || q.level !== p.level) return false;
    if (b.id === "mingle" && b.note === "in") {
      const g = this.circles.map.get(b.ref ?? -1);
      const slot = g && g.members.length < 6 ? this.circles.edge(g) : null;
      if (!slot) return false;
      this.end(p, false);
      this.start(p, { id: "mingle", target: slot, duration: 99999, pose: "talk", gain: { social: 0.6 }, ref: g!.id, note: "edge" });
      return true;
    }
    if (!["sit", "art", "use", "snack", "wander", "terrace", "drink"].includes(b.id)) return false;
    const s = beside(q, p, this.pf);
    if (!s) return false;
    this.end(p, false);
    this.start(p, { id: "ask", target: s, duration: this.life.range(90, 180), pose: "talk", gain: { social: 0.3 }, ref: q.id, note: "eye" });
    return true;
  }

  /** After a scene: out to the terrace, or home. */
  stormOff(p: Person, home: boolean): void {
    this.end(p, false);
    if (home && p.id !== this.spyId && this.leavers.includes(p)) return this.goHome(p, false);
    const s = this.places.terrace.length
      ? this.chat.pick(this.places.terrace)
      : this.cells.random(this.chat.pick(this.places.mingleRooms.length ? this.places.mingleRooms : [this.places.toastRoom.index]), this.chat);
    if (s) this.start(p, { id: "terrace", target: s, duration: this.chat.range(300, 600), pose: "stand", gain: { air: 0.6 } });
  }

  /** Off to a guest bedroom either of them knows, nobody in it, the door free: bolted and the curtains drawn behind them. */
  slipAway(lead: Person, follow: Person): boolean {
    const w = this.world;
    const knows = (r: number) => Math.max(this.memory.familiarity(lead.id, r), this.memory.familiarity(follow.id, r)) >= KNOWN;
    let best: { room: number; door: number; d: number } | null = null;
    for (const room of w.guestBedrooms) {
      const door = w.doors.find((d) => d.lock === "inside" && d.inner === room);
      if (!door || door.locked || !knows(room) || this.people.some((q) => q.present && q.room === room)) continue;
      const r = this.bp.rooms[room]!;
      const d = Math.hypot((r.inner.x0 + r.inner.x1) / 2 - lead.x, (r.inner.z0 + r.inner.z1) / 2 - lead.z) + 12 * Math.abs(r.level - lead.level);
      if (!best || d < best.d) best = { room, door: door.id, d };
    }
    if (!best) return false;
    const inside = this.cells.random(best.room, this.chat, 0.9);
    const door = w.doors[best.door]!;
    const outRoom = w.otherSide(door, best.room);
    const out = outRoom >= 0 ? this.cells.random(outRoom, this.chat, 0.8) : null;
    if (!inside || !out) return false;
    this.tasks.elope(lead, follow, best.room, best.door, inside, out, this.chat.range(20 * 60, 40 * 60));
    if (this.tasks.of(lead)?.kind !== "elope") return false;
    // Seen going off together, hand in hand.
    this.gesture(lead, "pull", 3);
    this.notable(lead, "slipped-away", follow.id, 60, best.room);
    this.notable(follow, "slipped-away", lead.id, 60, best.room);
    this.log("slip-away", [lead.id, follow.id], best.room, "in");
    return true;
  }

  /** A partner search meaning to have it out. */
  confrontSearch(h: Person, f: Person): boolean {
    return !!this.tasks.search(h, f, "confront");
  }

  /** A search with intent found them (tasks.ts): to have it out, or (a drink never brought) a word about it. */
  found(t: Task, p: Person): void {
    const q = this.people[t.other]!;
    if (t.intent === "confront") this.bonds.confront(p, q);
    else if (t.intent === "errand") {
      this.gesture(p, "ask", 2);
      this.glance(p, q.x, q.z, 3);
      this.glance(q, p.x, p.z, 2);
      this.gesture(q, "shrug", 2);
      this.log("react", [p.id, q.id], p.room, "drink-never-came");
    }
  }

  /** A task ended: a couple coming out of the bedroom. */
  finished(t: Task): void {
    if (t.kind === "spy") this.spy?.finished(t);
    if (t.kind === "search" && t.looked) this.notFound(t);
    this.dramas.finished(t);
    if (t.kind !== "elope" || t.outcome !== "done") return;
    const b = t.steps.find((s) => s.do === "bolt");
    const q = this.people[t.other]!;
    if (b?.do === "bolt") this.bonds.cameOut(this.people[t.owner]!, q, b.room);
  }

  shuns(p: Person, j: number): boolean {
    return this.bonds.shuns(p, j);
  }

  joinPull(i: number, j: number): number {
    return this.bonds.joinPull(i, j);
  }

  danceNear(p: Person) {
    return this.bonds.danceNear(p);
  }

  saw(a: Person, b: Person, d: number): void {
    this.bonds.saw(a, b, d);
    this.dramas.saw(a, b);
    this.spy?.saw(a, b, d);
  }

  /** The spy joining a circle: where its alibi puts it, or nothing of where it has just done something (spy/tactics.ts). */
  tells(p: Person, room: number, from: number): { room: number; from: number; to: number } | null | undefined {
    return p.id === this.spyId ? this.spy!.tactics.tells(p, room, from) : undefined;
  }

  /** i settled a case: whoever they blame for their partner or friend going missing, they keep in view from now on. */
  settled(i: number, kind: CaseKind, subject: number, lead: number): void {
    if (kind !== "person-gone" || subject < 0) return;
    const x = this.people[subject]!;
    if (x.partner !== i && !x.friends.includes(i)) return;
    this.watching[i] = lead;
    const p = this.people[i]!;
    this.log("react", [i, lead, subject], p.room, "keep-in-view");
  }

  /** Whether someone would rather not go into a room (the spy playing someone: where it last saw anyone it keeps away from). */
  keepsOut(p: Person, room: number): boolean {
    return p.id === this.spyId && this.spy!.keepsOut(room);
  }

  /** The room where someone last saw whoever they keep in view (the spy: the lone doubter it means to silence, else the one whose place it means to take), or -1. */
  keepInView(p: Person): number {
    const spy = this.spy;
    const j = spy && p.id === spy.id ? (spy.silence.watching >= 0 ? spy.silence.watching : spy.swap.watching) : this.watching[p.id]!;
    if (j < 0) return -1;
    const q = this.people[j]!;
    return q.present && !q.gone ? this.memory.lastRoom[p.id * this.people.length + j]! : -1;
  }

  reads(a: Person, b: Person): boolean {
    return !this.spy || b.id !== this.spy.id || this.spy.reads(a, b);
  }

  bumped(fast: Person, hit: Person, slop: boolean): void {
    this.bonds.bumped(fast, hit, slop);
  }

  gossipWeight(f: number, speaker: number, listeners: readonly number[]): number {
    return this.bonds.gossipWeight(f, speaker, listeners);
  }

  // ------------------------------------------------------- the spy, the programme

  /** The tie i greets j by: the ident's, or for the spy its own idea of it; someone sulking after a falling-out greets nobody warmly. */
  tieFor(i: number, j: number): Tie {
    const tie = this.spy ? this.spy.tieFor(i, j) : this.ident.tieOf(i, j);
    return this.bonds.sulk[i] && tie > 1 ? 1 : tie;
  }

  /** The announcement being made now: the phase it calls and where the host stands, or null. */
  announcing(): { phase: number; at: { level: number; x: number; z: number; room: number } } | null {
    const h = this.host;
    if (this.t > this.announceUntil || !h.present) return null;
    return { phase: this.phaseIdx, at: { level: h.level, x: h.x, z: h.z, room: h.room } };
  }

  /** Whether p would hear an announcement made at a point now (the sound model; it queues nothing). */
  wouldHear(at: { level: number; x: number; z: number; room: number }, p: Person): boolean {
    return this.senses.wouldHear("announce", at, p);
  }

  /** The spy acted on a new phase. Beckoned in, it drops what it's doing as anyone called in would. */
  cued(k: number, how: CueHow): void {
    const p = this.spy!.record;
    this.log("spy", [p.id], p.room, `cue:${this.programme[k]!.id}:${how}`);
    if (how === "told") this.comeIn(p);
  }

  canSee(a: Person, b: Person): boolean {
    return this.senses.canSee(a, b);
  }

  /** Whether someone's task is one seen through whatever the programme says. */
  committedTask(p: Person): boolean {
    const t = this.tasks.of(p);
    return !!t && COMMITTED.has(t.kind);
  }

  wantsChampagne(p: Person): boolean {
    return this.body.wants(p, "champagne");
  }

  /** The nearest waiter on this storey with flutes on the tray, standing at a stop or between rounds, within 20 m. */
  flutesFor(p: Person): Person | null {
    let best: Person | null = null;
    let bd = 20;
    for (const w of this.people) {
      if (w.role !== "waiter" || !w.present || w.level !== p.level || this.body.trayDrink(w) !== "champagne") continue;
      const a = w.action;
      if (a && !(a.id === "staff" && a.note === "serve" && a.startedAt !== null)) continue;
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** A waiter takes the tray over to someone: a stop beside them, offering as any stop does (false when there's no spot or no way). */
  bringGlass(w: Person, q: Person, secs: number): boolean {
    const s = this.beside(q, w, 0.8);
    if (!s || s.room === -1 || (s.room >= 0 && PRIVATE.has(this.bp.rooms[s.room]!.type))) return false;
    this.end(w, false);
    this.offeredAt[q.id] = this.t;
    this.stops.set(w.id, (this.stops.get(w.id) ?? 0) + 1);
    this.start(w, { id: "staff", target: s, duration: secs, pose: "serve", gain: {}, note: "serve" });
    return w.action?.note === "serve";
  }

  /** Beckoned in or pointed the way: anyone drops what they're doing and thinks again; the spy takes it as a cue. */
  callIn(p: Person): void {
    const spy = this.spy;
    if (spy && p.id === spy.id && spy.byCues) return spy.told();
    this.comeIn(p);
  }

  /** Drop whatever can be dropped and think again now. */
  private comeIn(p: Person): void {
    const a = p.action;
    if (a && (a.id === "toilet" || a.id === "leave" || a.id === "row" || a.id === "arrive" || (a.id === "task" && this.committedTask(p)))) return;
    this.end(p, false);
    p.thinkAt = this.t;
  }

  /**
   * The spy's map: it has never been here, so it knows the house as a first-timer does (the
   * entrance hall and the rooms off it), and before it came it learnt the way from the door to
   * each room its goal needs. Playing the host, the household still counts it, but the map is its own.
   */
  private spyMap(id: number, rooms: readonly number[], rng: Rng): void {
    const m = this.memory;
    const pl = this.places;
    m.ownMap[id] = 1;
    m.forgetHouse(id);
    const hall = pl.entranceRoom?.index ?? pl.entrance.room;
    m.startKnowing(id, hall, 0.6, 1);
    for (const e of this.world.graph[hall] ?? []) if (e.kind !== "stair") m.startKnowing(id, e.to, 0.6);
    for (const r of rooms) {
      const to = this.cells.random(r, rng);
      if (to) for (const w of this.roomsOnTheWay(pl.entrance, to, null)) m.startKnowing(id, w, 0.8, 2);
      m.startKnowing(id, r, 0.8, 2);
    }
  }

  /** The perch's view of a spot in the garden: the house's grid where it reaches, else half-hidden in the open. */
  private gardenView(at: { level: number; x: number; z: number }): number {
    return this.pf.cellOf(at.level, at.x, at.z) >= 0 ? this.pf.visAt(at.level, at.x, at.z) : 0.5;
  }

  // ------------------------------------------------------------- seen through (milestone 3)

  /** A test put and answered, however it came about: a pass or a fumble ends in a laugh, a failure in a pause and a look to someone else. */
  private tested(i: number, j: number, out: TestOutcome): void {
    const a = this.people[i]!;
    const b = this.people[j]!;
    this.log("test", [i, j], a.room, out);
    if (out === "failed") {
      this.gesture(a, "frown", 3);
      const other = this.people.find((q) => q !== a && q !== b && q.present && !q.gone && q.level === a.level && Math.hypot(q.x - a.x, q.z - a.z) < 4);
      if (other) this.glance(a, other.x, other.z, 1.5);
      const g = this.circleOf(a);
      if (g) {
        g.quietUntil = Math.max(g.quietUntil, this.t + 3);
        g.speaker = -1;
      }
    } else if (out !== "bluffed") this.senses.sound("laugh", b, b.id);
    if (j === this.spyId) {
      this.spy!.answers.tested(i, out === "failed");
      // A test it failed: it feels watched, and lies low a while.
      if (out === "failed") this.spy!.covers.watched("test");
    }
  }

  /** A wary look at someone close by (senses.ts): the spy, seeing it come its way, feels watched. */
  waryLook(a: Person, b: Person): void {
    if (b.id === this.spyId && this.canSee(b, a)) this.spy!.covers.watched("glance");
  }

  /** What a look at someone they know brought about past the double take: the spy may catch the double take; sure, they mean to do something about it. */
  seenThrough(a: Person, b: Person, e: IdentEvent): void {
    if (e === "double-take" && b.id === this.spyId) this.spy!.answers.signal(a.id, "double-take");
    else if (e === "sure") this.becameSure(a, b);
  }

  /** a caught b fumbling a skill in a look's detail: doubt when they expected better and can't explain it, and a reaction either way. */
  sawSlip(a: Person, b: Person, skill: number): void {
    const explained = this.slipExplained(a, b, skill);
    this.ident.slipDoubt(a.id, b.id, skill, this.t, explained);
    this.reactions.slip(a, b, skill, explained);
  }

  /** A fumble they can explain: drink they know of, a bandaged hand (keys, a tray, the piano, billiards), a turned ankle (dancing, the way round). */
  private slipExplained(a: Person, b: Person, skill: number): boolean {
    if (this.memory.knowsAbout(a.id, "tipsy", b.id)) return true;
    const s = SLIP_SKILLS[skill];
    if (b.bandage && (s === "keys" || s === "tray" || s === "piano" || s === "billiards")) return true;
    return this.ident.hurt[b.id] === 1 && (s === "dance" || s === "house");
  }

  /** Someone fumbled a skill (an index into SLIP_SKILLS), showing for this long: whoever catches it may make something of it. */
  slipped(p: Person, skill: number, secs: number): void {
    this.ident.slip(p.id, skill, this.t, secs);
  }

  /** p waved to q: q, seeing it, waves back if they know p well enough; someone who expected a wave back and got none minds a little. */
  waved(p: Person, q: Person): void {
    if (!this.canSee(q, p)) return;
    if (this.tieFor(q.id, p.id) >= 2) {
      this.gesture(q, "wave", 2);
      this.glance(q, p.x, p.z, 2);
    } else if (this.ident.tieOf(p.id, q.id) >= 2) {
      this.ident.cool(p.id, q.id, this.t);
      this.gesture(p, "frown", 1.5);
      this.log("react", [p.id, q.id], p.room, "cool");
    }
    if (q.id === this.spyId) this.spy!.answers.greeted(p.id, "wave");
  }

  /**
   * The kiss or the handshake given: whoever expected a kiss and got a handshake because the other
   * gave one (a sulk, or a stranger in a friend's face) minds a little. The spy learns who greets
   * it like an old friend.
   */
  greetedAs(p: Person, q: Person, pose: Pose): void {
    if (pose === "shake") {
      for (const [x, y] of [
        [p, q],
        [q, p],
      ] as const) {
        if (this.circles.expects(x, y) !== "kiss" || this.tieFor(y.id, x.id) >= 3) continue;
        this.ident.cool(x.id, y.id, this.t);
        this.gesture(x, "frown", 1.5);
        this.log("react", [x.id, y.id], x.room, "cool");
      }
    }
    if (q.id === this.spyId) this.spy!.answers.greeted(p.id, pose === "kiss" ? "kiss" : "came");
    else if (p.id === this.spyId && pose === "kiss") this.spy!.answers.greeted(q.id, "kiss");
  }

  /** a steps over beside b for a few seconds, to help with a fumble. */
  helpOut(a: Person, b: Person, secs: number): boolean {
    const s = this.beside(b, a, 0.8, a);
    if (!s) return false;
    this.end(a, false);
    this.start(a, { id: "ask", target: s, duration: secs, pose: "stand", gain: { social: 0.05 }, ref: b.id, note: "help" });
    return a.action?.note === "help";
  }

  /** Asked again for what they were known for: the spy begs off again if it still can't do it as they did. */
  askAgain(a: Person, b: Person, skill: number): void {
    this.gesture(a, "ask", 2);
    this.glance(a, b.x, b.z, 2);
    this.log("react", [a.id, b.id], a.room, "ask-again");
    const s = SLIP_SKILLS[skill]!;
    if (b.id === this.spyId && s !== "house" && this.spy!.dodges(s)) this.begOff(a, b, skill);
  }

  /** The spy turns down what the one it plays was known for: a wave of the hand at the piano, a shrug at the floor. Whoever asked, and anyone who knew them and sees it, takes half a slip's doubt. */
  begOff(asker: Person, b: Person, skill: number): void {
    const t = this.t;
    this.gesture(b, skill === PIANO ? "wave" : "shrug", 2);
    this.glance(b, asker.x, asker.z, 2);
    this.log("spy", [b.id, asker.id], b.room, `beg-off:${SLIP_SKILLS[skill]}`);
    const by = this.people.filter((q) => q !== asker && q !== b && q.present && !q.gone && this.ident.tieOf(q.id, b.id) > 0 && this.canSee(q, b));
    for (const q of [asker, ...by]) this.ident.slipDoubt(q.id, b.id, skill, t, this.slipExplained(q, b, skill), 0.5);
    this.reactions.beggedOff(asker, b, skill, by);
  }

  /** A dancer waved someone by the floor over: the spy, seeing it, begs off if it can't dance as the one it plays did. */
  wavedOver(a: Person, b: Person): void {
    if (b.id === this.spyId && this.spy!.dodges("dance") && this.canSee(b, a)) this.begOff(a, b, DANCE);
  }

  /** Whether this person stays off a skill they'd be expected to do well: only the spy, playing someone known for it. */
  dodges(p: Person, skill: Skill): boolean {
    return p.id === this.spyId && this.spy!.dodges(skill);
  }

  /** The phase weights someone chooses by: the table's, but for the spy out of step (spy/habits.ts). */
  phaseWeights(p: Person, id: PhaseId): Partial<Record<ActionId, number>> {
    return p.id === this.spyId ? this.spy!.habits.weights(id) : PHASE_WEIGHTS[id];
  }

  /** Wanders to odd places: only the spy's, with that habit on. */
  oddPlaces(p: Person): readonly Candidate[] {
    return p.id === this.spyId ? this.spy!.habits.oddPlaces(p) : NO_CANDIDATES;
  }

  /** Steps to ask the butler where something is kept first, for the spy playing the host (it doesn't know the house); none for anyone else, or with no butler about. */
  askWhere(p: Person): Step[] {
    if (p.id !== this.spyId || p.role !== "host") return [];
    const b = this.people.find((q) => q.role === "butler" && q.present && !q.gone);
    if (!b) return [];
    this.spy!.posing.asks();
    return [
      { do: "meet", who: b.id, label: "to-butler" },
      { do: "say", who: b.id, s: 3, pose: "talk", label: "ask-where" },
    ];
  }

  /** A laugh where someone stands. */
  laugh(p: Person): void {
    this.senses.sound("laugh", p, p.id);
  }

  /** Out of the circle they're in, to think again. */
  leaveCircle(p: Person): void {
    this.end(p, false);
    p.thinkAt = this.t;
  }

  /** Off to another room for a while. */
  walkAway(p: Person, rng: Rng): void {
    this.end(p, false);
    const rooms = this.places.mingleRooms.filter((r) => r !== p.room);
    const s = this.cells.random(rooms.length ? rng.pick(rooms) : this.places.toastRoom.index, rng, 0.9);
    if (s) this.start(p, { id: "wander", target: s, duration: rng.range(30, 90), pose: "look", gain: { curiosity: 0.1 } });
    else p.thinkAt = this.t;
  }

  /** The circle someone stands in, or undefined. */
  circleOf(p: Person): Group | undefined {
    const a = p.action;
    return a?.id === "mingle" && a.note === "in" ? this.groups.get(a.ref ?? -1) : undefined;
  }

  /** Someone of the household free to prompt the host: the butler unless out on an errand, else the nearest waiter. */
  prompter(): Person | null {
    const host = this.host;
    const free = (q: Person) => q.present && !q.gone && q !== host && this.tasks.of(q)?.kind !== "errand" && q.action?.id !== "toilet";
    const butler = this.people.find((q) => q.role === "butler" && free(q));
    if (butler) return butler;
    let best: Person | null = null;
    let bd = Infinity;
    for (const q of this.people) {
      if (q.role !== "waiter" || !free(q)) continue;
      const d = Math.hypot(q.x - host.x, q.z - host.z) + 15 * Math.abs(q.level - host.level);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  /** Over to the host with a word in their ear (tasks.ts shows it). */
  prompt(by: Person, host: Person): boolean {
    const t = this.tasks.chore(by, [
      { do: "meet", who: host.id, label: "to-host" },
      { do: "say", who: host.id, s: 3, pose: "talk", label: "prompt" },
    ]);
    return t.outcome === null || t.outcome === "done";
  }

  /**
   * a saw the spy at a kill (the struggle, the drag, holding on), or came to after it let them go
   * (spy/kill.ts): sure of it at once, as sure as anyone can be of anyone. A start, a look, out of
   * whatever they were doing and away from it, and off to tell someone as soon as there's someone
   * to tell: never silent, never to its face.
   */
  attacked(a: Person, spy: Person, victim: number): void {
    const key = a.id * this.people.length + victim;
    if (this.alarms.has(key)) return;
    this.alarms.add(key);
    // A witness has it from the sight of it already; the victim, coming to, from the struggle.
    this.alarmOf[a.id] = this.memory.observe(a.id, "attacked", spy.id, victim, a.id === victim ? a.room : spy.room);
    this.memory.addSuspicion(a.id, spy.id, 1);
    a.avoid.set(`person:${spy.id}`, PARTY_LENGTH + 1);
    this.gesture(a, "startle", 1.5);
    if (spy.present && spy.level === a.level) this.glance(a, spy.x, spy.z, 2);
    this.log("challenge", [a.id, spy.id, victim], a.room, a.id === victim ? "came-to" : "attack-seen");
    if (a.action?.id !== "leave" && this.tasks.of(a)?.kind !== "leave") {
      this.end(a, false);
      a.thinkAt = this.t;
    }
  }

  /** Off to tell what they saw: the host, else the nearest of the staff, else a partner or a friend. False while there's nobody to go to. */
  private actOnAlarm(p: Person): boolean {
    const spy = this.spy;
    if (!spy) return false;
    const to = this.confidant(p, spy.record);
    const s = to ? beside(to, p, this.pf) : null;
    if (!to || !s) return false;
    this.start(p, { id: "ask", target: s, duration: 6, pose: "talk", gain: {}, ref: to.id, note: "tell-attack" });
    return p.action?.note === "tell-attack";
  }

  /** Told by someone who saw it: the listener holds it by their trust in the teller. */
  private toldAttack(p: Person, to: Person): void {
    const f = this.alarmOf[p.id]!;
    this.alarmOf[p.id] = -1;
    if (f < 0) return;
    this.memory.learn(to.id, f, PASS_ON * Math.min(1, 0.5 + this.memory.trustIn(to.id, p.id)), p.id, 1);
    this.log("challenge", [p.id, to.id, this.spyId], p.room, "told-attack");
  }

  /** Sure at last that b isn't who they seem: the timid and the tipsy say nothing and keep away; anyone else does something about it as soon as they're free. */
  private becameSure(a: Person, b: Person): void {
    this.log("challenge", [a.id, b.id], a.room, "sure");
    if (a.traits.nerves >= TIMID_NERVES || a.tipsy >= TIMID_TIPSY) {
      a.avoid.set(`person:${b.id}`, PARTY_LENGTH + 1);
      this.log("challenge", [a.id, b.id], a.room, "silent");
      return;
    }
    this.sureOf[a.id] = b.id;
    const x = a.action;
    if (!a.staff && x && SURE_DROPS.has(x.id) && !(x.id === "drink" && x.note === "bar-wait")) {
      this.end(a, false);
      a.thinkAt = this.t;
    }
  }

  /**
   * Acting on being sure. A partner, family or a close friend in company has it out with them,
   * out loud. Anyone else, or alone with them, backs away and goes to tell someone: the host,
   * else the nearest of the staff, else a close friend. False while there's nobody to go to. Kept
   * in mind until it's done: called away on the way (the programme, a call in), they set off again
   * when next free.
   */
  private actOnSure(p: Person): boolean {
    const j = this.sureOf[p.id]!;
    const q = this.people[j]!;
    if (!q.present || q.gone || q.down) {
      this.sureOf[p.id] = -1;
      return false;
    }
    const n = this.people.length;
    const inView = q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 15 && this.memory.lastT[p.id * n + j]! > this.t - 60;
    const company = inView && this.people.some((o) => o !== p && o !== q && o.present && !o.gone && !o.staff && o.level === q.level && Math.hypot(o.x - q.x, o.z - q.z) < OUT_LOUD_NEAR);
    if (this.ident.tieOf(p.id, j) >= 4 && company) {
      const s = beside(q, p, this.pf);
      if (s) {
        this.start(p, { id: "ask", target: s, duration: 4, pose: "talk", gain: {}, ref: j, note: "confront" });
        return p.action?.note === "confront";
      }
    }
    const to = this.confidant(p, q);
    const s = to ? beside(to, p, this.pf) : null;
    if (!to || !s) return false;
    if (!this.backedAway[p.id]) {
      this.backedAway[p.id] = 1;
      this.log("challenge", [p.id, j], p.room, "backed-away");
      if (inView) this.glance(p, q.x, q.z, 1.5);
    }
    this.about.set(p.id, j);
    this.start(p, { id: "ask", target: s, duration: 6, pose: "talk", gain: {}, ref: to.id, note: "tell-sure" });
    return p.action?.note === "tell-sure";
  }

  /** Whom someone sure goes to: the host, else the nearest of the staff, else their partner or a friend, if seen lately on their floor (never the one they're sure of). */
  private confidant(p: Person, about: Person): Person | null {
    const n = this.people.length;
    const ok = (q: Person) =>
      q !== p && q !== about && q.present && !q.gone && !q.down && q.level === p.level && Math.hypot(q.x - p.x, q.z - p.z) < 25 && this.memory.lastT[p.id * n + q.id]! > this.t - 120;
    if (ok(this.host)) return this.host;
    const nearest = (qs: Person[]) => qs.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0] ?? null;
    return nearest(this.people.filter((q) => q.staff && ok(q))) ?? nearest(this.people.filter((q) => (q.id === p.partner || p.friends.includes(q.id)) && ok(q)));
  }

  /** "Who are you? Where is she?", out loud and to their face. Heads turn, those free close by turn to watch, and everyone who sees it remembers. */
  private confront(p: Person, q: Person): void {
    this.sureOf[p.id] = -1;
    this.counts.challenges++;
    this.gesture(p, "point", 3);
    this.senses.sound("raised-voice", p, p.id);
    this.log("challenge", [p.id, q.id], p.room, "out-loud");
    for (const o of this.people) {
      if (o === p || o === q || !o.present || o.gone || o.level !== p.level) continue;
      if (Math.hypot(o.x - p.x, o.z - p.z) < OUT_LOUD_NEAR) {
        const free = this.free(o);
        this.glance(o, q.x, q.z, free ? this.through.range(WATCH[0], WATCH[1]) : 2);
        if (free) this.gesture(o, "watch", 4);
      }
      if (!this.canSee(o, p)) continue;
      this.memory.observe(o.id, "confronted", q.id, p.id, p.room);
      const tie = this.ident.tieOf(o.id, q.id);
      if (tie) this.ident.addDoubt(o.id, q.id, CHALLENGED * TIE_WEIGHT[tie]!, this.t, Infinity, true);
    }
    if (q.id === this.spyId) this.spy!.answers.confronted(p.id);
    else this.gesture(q, "shrug", 2);
  }

  /** Told by someone sure: the fact, and doubt by the listener's tie and trust in the teller. Then the teller goes looking for the real one. */
  private toldSure(p: Person, to: Person, j: number): void {
    const q = this.people[j]!;
    this.sureOf[p.id] = -1;
    this.log("challenge", [p.id, to.id, j], p.room, "told");
    this.memory.learn(to.id, this.memory.fact("not-themselves", j, -1, q.room), PASS_ON, p.id, 1);
    const tie = this.ident.tieOf(to.id, j);
    if (tie) this.ident.addDoubt(to.id, j, TOLD_SURE * TIE_WEIGHT[tie]! * (0.5 + this.memory.trustIn(to.id, p.id)), this.t, Infinity, true);
    this.lookFor.set(p.id, j);
  }

  /** A speaker's turn: one wanting to compare notes about someone not in the circle whispers to another in it who knows them well. */
  private compareInCircle(sp: Person, here: readonly number[]): void {
    const j = this.ident.wantCompare[sp.id]!;
    if (j < 0 || here.includes(j)) return;
    const m = here.find((x) => x !== sp.id && this.ident.tieOf(x, j) >= 3 && !this.ident.hasCompared(sp.id, x));
    if (m !== undefined) this.compareNotes(sp, this.people[m]!, j);
  }

  /** Thinking what to do with doubts about j: walk over to someone in view who knows them well, not yet asked; with nobody, look again later. */
  private walkToCompare(p: Person, j: number): boolean {
    const n = this.people.length;
    let best: Person | null = null;
    let bd = 15;
    for (const m of this.people) {
      if (m === p || m.id === j || !m.present || m.gone || m.level !== p.level || this.ident.tieOf(m.id, j) < 3 || this.ident.hasCompared(p.id, m.id)) continue;
      if (m.action?.id === "toilet" || m.action?.id === "leave" || this.memory.lastT[p.id * n + m.id]! < this.t - 60) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    const s = best ? beside(best, p, this.pf) : null;
    if (!best || !s) {
      this.ident.noneToCompare(p.id, j, this.t);
      return false;
    }
    this.about.set(p.id, j);
    this.start(p, { id: "ask", target: s, duration: 6, pose: "talk", gain: { social: 0.1 }, ref: best.id, note: "compare" });
    return p.action?.note === "compare";
  }

  /**
   * Notes compared about j: a whisper, the fact passed on, the listener's doubt rising with their
   * trust in the teller (and wanting to test j themselves), both glancing j's way. When the
   * listener had doubts of their own, both are surer for it: someone else noticed too.
   */
  private compareNotes(sp: Person, m: Person, j: number): void {
    const q = this.people[j]!;
    const t = this.t;
    this.gesture(sp, "lean", 3);
    this.log("challenge", [sp.id, m.id, j], sp.room, "compare");
    this.memory.learn(m.id, this.memory.fact("not-themselves", j, -1, q.room), PASS_ON, sp.id, 1);
    const tie = this.ident.tieOf(m.id, j);
    const both = this.ident.doubtOf(m.id, j, t) >= TEST && this.ident.doubtOf(sp.id, j, t) >= TEST;
    if (tie) this.ident.addDoubt(m.id, j, COMPARED * TIE_WEIGHT[tie]! * (0.5 + this.memory.trustIn(m.id, sp.id)) + (both ? CORROBORATED : 0), t);
    this.ident.addDoubt(sp.id, j, both ? CORROBORATED : COMPARED_SELF, t);
    this.ident.comparedWith(sp.id, m.id, j, t);
    if (tie && this.ident.stage[m.id * this.people.length + j]! < PASSED && this.ident.wantTest[m.id]! < 0) this.ident.wantTest[m.id] = j;
    if (!q.present || q.gone || q.room !== sp.room) return;
    for (const x of [sp, m]) {
      this.glance(x, q.x, q.z, 1.5);
      if (j === this.spyId) this.spy!.answers.signal(x.id, "whisper");
    }
  }

  /**
   * A first-time guest in the host's circle asks to be shown round (from 19:30, the curious, once
   * each). The real host nearly always agrees; the spy playing the host mostly says later, and
   * otherwise leads it by its own map. A refusal is noticed whoever makes it.
   */
  private tourAsk(g: Group, here: readonly number[]): void {
    const host = this.host;
    const ph = this.phase.id;
    if (this.t < TOUR_ASK_FROM || !here.includes(host.id) || (ph !== "mingle" && ph !== "dancing" && ph !== "games") || this.practices.opening) return;
    const asker = here
      .map((m) => this.people[m]!)
      .find((q) => q !== host && !q.staff && !q.regular && q.id !== this.spyId && !this.memory.household[q.id] && !this.askedTour[q.id] && q.traits.curiosity > TOUR_CURIOUS);
    if (!asker || !this.tourAsks.chance(TOUR_ASK)) return;
    this.askedTour[asker.id] = 1;
    this.counts.tourAsks++;
    this.gesture(asker, "ask", 2);
    this.glance(asker, host.x, host.z, 2);
    this.log("ask", [asker.id, host.id], g.room, "tour");
    const fake = host.id === this.spyId;
    const no = fake ? this.spy!.posing.refusesTour() : !this.tourAsks.chance(AGREE_TOUR) || this.tasks.count("tour") >= TOURS;
    if (!no && this.tasks.tour(host, [asker])) {
      this.lastTour = this.t;
      return;
    }
    // "Later": a smile and a shrug, and anyone who sees it notices.
    this.gesture(host, "shrug", 2);
    this.notable(host, "refused-tour", asker.id, 10);
    this.memory.observe(asker.id, "refused-tour", host.id, asker.id, host.room);
    this.log("react", [host.id, asker.id], g.room, "later");
  }

  /** Every half minute: a missed step on the floor, a wrong note at the piano, the more often the lower the skill (and on the floor, the more drink). */
  private floorFumbles(): void {
    for (const p of this.people) {
      const a = p.action;
      if (!p.present || p.gone || !a || a.startedAt === null) continue;
      if (a.id === "dance") {
        if (this.fumbles.chance(DANCE_FUMBLE * (1 - p.fluency.dance) ** 2 * (1 + p.tipsy))) this.slipped(p, DANCE, 3);
      } else if (p.pose === "play" && a.note === "piano" && this.fumbles.chance(PIANO_FUMBLE * (1 - p.fluency.piano) ** 2)) this.slipped(p, PIANO, 3);
    }
  }

  /** The spy gets up mid-course, once a dinner, for a step that wants the house empty while everyone is at the table. */
  private upForPlan(spy: Spy, progress: number): void {
    const p = spy.record;
    const a = p.action;
    if (a?.id !== "dinner" || a.startedAt === null || !spy.plans.upFromDinner(p, progress)) return;
    this.end(p, false);
    p.thinkAt = this.t;
  }

  /** The spy playing the host leaves the table before dessert: a call in the hall until dinner is over, or the bathroom. */
  private leaveTable(p: Person, progress: number): void {
    const a = p.action;
    if (a?.id !== "dinner" || a.startedAt === null) return;
    const how = this.spy!.posing.leaveDinner(progress);
    if (!how) return;
    this.log("spy", [p.id], p.room, `leave-table:${how}`);
    this.end(p, false);
    const b = how === "bathroom" ? this.bathFor(p) : -1;
    const bath = this.places.bathrooms[b];
    if (bath) return void this.start(p, { id: "toilet", target: bath.door, duration: this.rng.range(120, 240), pose: "wait", gain: { bladder: 1 }, ref: b, note: "door" });
    const hall = this.cells.random(this.places.entranceRoom?.index ?? this.places.entrance.room, this.rng, 0.8);
    const left = Math.max(30, this.phase.end - this.t + 10);
    if (hall)
      this.tasks.chore(p, [
        { do: "goto", to: hall, label: "away" },
        { do: "wait", s: left, pose: "phone", label: "call" },
      ]);
  }

  /** The lab's test button: their closest tie who is here walks over and tests them now. */
  private forceTest(q: Person): void {
    let best: Person | null = null;
    let bt = 0;
    let bd = Infinity;
    for (const p of this.people) {
      if (p === q || !p.present || p.gone) continue;
      const tie = this.ident.tieOf(p.id, q.id);
      const d = Math.hypot(p.x - q.x, p.z - q.z) + 15 * Math.abs(p.level - q.level);
      if (tie > bt || (tie === bt && tie > 0 && d < bd)) {
        best = p;
        bt = tie;
        bd = d;
      }
    }
    const s = best ? beside(q, best, this.pf) : null;
    if (!best || !s) return;
    this.end(best, false);
    this.start(best, { id: "ask", target: s, duration: 5, pose: "talk", gain: { social: 0.1 }, ref: q.id, note: "test" });
  }

  /** How well the garden's lamps light a spot, 0 to 1: the nearest lamppost, lantern or uplight's reach. */
  private gardenLight(x: number, z: number): number {
    let v = 0;
    for (const l of this.bp.lights) {
      if (l.scope !== "exterior" || (l.kind !== "lamppost" && l.kind !== "lantern" && l.kind !== "uplight")) continue;
      v = Math.max(v, 1 - Math.hypot(l.x - x, l.z - z) / l.range);
    }
    return v;
  }

  /** A look outside may take in the garment on the ground: in the look's detail, lit well enough, the more likely the nearer it lies and the keener the look. */
  looked(a: Person): void {
    this.finding?.looked(a);
    const g = this.spy?.garment;
    if (!g || (a.room !== -1 && a.room !== -2) || this.foundIt[a.id] || this.garmentLight < FIND_LIGHT) return;
    const items = this.world.items;
    const at = { level: items.level[g.item]!, x: items.x[g.item]!, z: items.z[g.item]! };
    if (items.stateOf(g.item) !== "lost" || !this.senses.inDetail(a, at)) return;
    const near = 1 - Math.hypot(at.x - a.x, at.z - a.z) / DETAIL_RANGE;
    if (!this.finds.chance(FIND_CHANCE * near * this.senses.attention(a) * this.garmentLight)) return;
    this.foundIt[a.id] = 1;
    this.counts.finds++;
    // Whose it is, if they knew them: and the one who came as them tonight wore nothing like it.
    const owner = items.owner[g.item]!;
    const tie = owner >= 0 ? this.ident.tieOf(a.id, owner) : 0;
    this.memory.observe(a.id, "garment", tie >= 2 ? owner : -1, g.item, a.room);
    if (tie >= 2) this.ident.addDoubt(a.id, this.spyId, GARMENT_DOUBT * TIE_WEIGHT[tie]!, this.t, Infinity, true);
    this.glance(a, at.x, at.z, 2);
    this.log("react", tie >= 2 ? [a.id, owner] : [a.id], a.room, "garment");
    // Picked up and handed in at the cloakroom (else to the butler), when they're free to.
    const to = this.people.find((q) => q.role === "cloakroom" && q.present && !q.gone) ?? this.people.find((q) => q.role === "butler" && q.present && !q.gone);
    const spot = this.pf.snap(at.level, at.x, at.z, 1.2);
    if (!to || !spot || !this.free(a)) return;
    const room = this.pf.roomAt(spot.level, spot.x, spot.z);
    this.tasks.chore(
      a,
      [
        { do: "goto", to: { level: spot.level, x: spot.x, z: spot.z, yaw: a.yaw, room }, label: "to-garment" },
        { do: "pick", item: g.item, label: "pick" },
        { do: "meet", who: to.id, label: "hand-in" },
        { do: "give", item: g.item, who: to.id, label: "give" },
      ],
      g.item,
    );
  }

  // ------------------------------------------------------------- mood and senses

  /** Pairs within 3 m in the same room, sitters too, and how many each has round them. */
  private findPairs(): void {
    const ps = this.people;
    const cap = (ps.length * (ps.length - 1)) / 2;
    if (this.pairs.length < 2 * cap) {
      this.pairs = new Int16Array(2 * cap);
      this.pairDist = new Float32Array(cap);
    }
    this.crowd.fill(0);
    let k = 0;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]!;
      if (!a.present || a.down) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j]!;
        if (!b.present || b.down || b.level !== a.level || b.room !== a.room) continue;
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        if (d >= 3) continue;
        this.pairs[2 * k] = i;
        this.pairs[2 * k + 1] = j;
        this.pairDist[k++] = d;
        this.crowd[i]!++;
        this.crowd[j]!++;
      }
    }
    this.nPairs = k;
  }

  private moodInput(p: Person) {
    const a = p.action;
    const crowd = this.crowd[p.id]!;
    return {
      dancing: p.pose === "dance",
      music: this.senses.musicIn(p.room),
      talking: a?.id === "mingle" && a.startedAt !== null && a.note === "in",
      alone: p.pose === "sit" && crowd === 0,
      crowd,
    };
  }

  /**
   * Plant a fact from the next step on (the lab's button). The lab passes the same in `provoke`
   * when it replays, which lands it on the same step.
   */
  plant(v: Provocation): void {
    let i = this.provoked;
    while (i < this.provoke.length && this.provoke[i]!.t <= v.t) i++;
    this.provoke.splice(i, 0, { ...v, t: Math.max(v.t, this.t) });
  }

  /** A mood override from the next step on (the lab's mood row); replays pass it in `mood`. */
  nudge(o: MoodOverride): void {
    this.nudges.push({ ...o, t: Math.max(o.t, this.t) });
  }

  private provokeDue(): void {
    while (this.provoked < this.provoke.length && this.provoke[this.provoked]!.t < this.t) {
      const v = this.provoke[this.provoked++]!;
      if (v.kind === "gone") {
        this.goneFrom(v);
        continue;
      }
      const sub = this.people[v.subject];
      if (v.kind === "test") {
        if (sub?.present && !sub.gone) this.forceTest(sub);
        continue;
      }
      if (v.kind === "swap") {
        if (sub?.present && !sub.gone && !sub.down) this.spy?.takePlace(sub);
        continue;
      }
      if (v.kind === "mishap") {
        if (sub?.present && !sub.gone && v.what) this.dramas.mishap(v.what as MishapId, sub, undefined, true);
        continue;
      }
      if (v.kind === "drama") {
        if (v.what) this.dramas.play(v.what as CardId, sub?.present && !sub.gone ? sub : undefined);
        continue;
      }
      // By default, a guest in a conversation (else any guest) hears it first; never the subject's own partner.
      const guest = (q: Person) => q.present && !q.staff && q.role !== "host" && q.id !== v.subject && q.partner !== v.subject;
      const w = v.witness ?? (this.people.find((q) => guest(q) && q.action?.id === "mingle" && q.action.note === "in" && q.action.startedAt !== null) ?? this.people.find(guest))?.id;
      if (w === undefined) continue;
      if (v.kind === "seen") this.seenIn(w, v.subject, v.room ?? this.people[v.subject]!.room);
      else if (v.kind === "spark") this.bonds.spark(w, v.subject);
      else if (v.kind === "grudge") this.bonds.addGrudge(w, v.subject, 0.7);
      else this.memory.plant(w, v.verb ?? "rumour", v.subject, v.odd);
    }
  }

  /** Something of someone's (the house's, by default) is noticed gone from a room: a case with nobody to blame yet. */
  private goneFrom(v: Provocation): void {
    const host = this.host;
    const owner = v.subject >= 0 ? this.people[v.subject]! : host;
    const w = this.people[v.witness ?? (owner.present && !owner.gone ? owner.id : host.id)]!;
    this.openGone(w, owner, -1, v.room ?? w.room);
  }

  /** Something of p's gone from a room, noticed by p: a case with nobody to blame yet (a bag lost and looked for in vain). */
  missing(p: Person, obj: number, room: number): void {
    this.openGone(p, p, obj, room);
  }

  /** A thing turned up: every case about it closes. */
  turnedUp(obj: number, room: number): void {
    this.register.found(obj, room);
  }

  private openGone(w: Person, owner: Person, obj: number, room: number): void {
    this.openCase("gone", w, owner, obj, room, this.t - CASES.gone.lookBack);
  }

  /**
   * A search that looked everywhere it would and gave up (milestone 3, PR 5): looking for someone
   * gone without a word, they say so out loud. Missing, last seen where they last saw them, and
   * whoever was there then is who people think of. A search for the real one behind a face files
   * nothing: its sightings are of the face, and what they would say they are sure of already.
   */
  private notFound(t: Task): void {
    const p = this.people[t.owner]!;
    const q = this.people[t.other];
    if (!q || !p.present || p.gone || p.down || !this.vanished(q)) return;
    const k = p.id * this.people.length + q.id;
    const room = this.memory.lastRoom[k]!;
    const at = this.memory.lastT[k]!;
    if (room === -1 || at < -1e8) return;
    this.openCase("person-gone", p, q, -1, room, at - MISSING_BEFORE, Math.min(this.t, at + CASES["person-gone"].lookBack));
  }

  /** w finds something of owner's gone (or a bug planted, or owner themselves missing) in a room, over a window: a case with nobody to blame yet, said out loud. */
  openCase(kind: "gone" | "planted" | "person-gone", w: Person, owner: Person, obj: number, room: number, from: number, to = this.t): void {
    if (room === -1) return;
    const f = this.memory.observe(w.id, CASES[kind].verb, owner.id, obj, room);
    const c = this.register.open(w.id, kind, owner.id, obj, room, from, to, f);
    // Said out loud: whoever is close by hears of it at once.
    const near = this.people.filter((q) => q !== w && q.present && q.level === w.level && q.room === w.room && Math.hypot(q.x - w.x, q.z - w.z) < 6);
    this.register.raise(
      w.id,
      c,
      near.map((q) => q.id),
    );
    for (const q of near) this.memory.learn(q.id, f, PASS_ON, w.id, 1);
    this.log("case", [w.id, owner.id], room, kind);
  }

  /** The witness saw someone poking round a room, with their own eyes: something to pass on, and a sighting in the register. */
  private seenIn(w: number, x: number, room: number): void {
    if (w === x || room === -1) return;
    const f = this.memory.fact("snooping", x, -1, room);
    this.memory.learn(w, f, 1, -1, 0);
    this.register.see(w, this.people[x]!, "snooping", room, -1, f);
  }

  notable(p: Person, verb: Verb, obj: number, secs: number, room = -1): void {
    p.notable = verb;
    p.notableObj = obj;
    p.notableRoom = room;
    p.notableUntil = this.t + secs;
    this.spy?.noted(p, verb, secs);
  }

  gesture(p: Person, g: Gesture, secs: number): void {
    p.gesture = g;
    p.gestureUntil = this.t + secs;
  }

  /** Turn someone's head toward a point for a while. */
  glance(p: Person, x: number, z: number, secs: number): void {
    p.lookX = x;
    p.lookZ = z;
    p.lookUntil = this.t + secs;
  }

  /** A nosy guest drops what they're doing to see what that noise was. */
  goLook(p: Person, s: Sound): void {
    if (p.staff || p.role === "host" || (p.action && !DROP_TO_LOOK.has(p.action.id)) || (p.avoid.get("look") ?? -1) > this.t) return;
    const at = this.pf.snap(s.level, s.x, s.z, 2.5);
    if (!at) return;
    p.avoid.set("look", this.t + 300);
    this.end(p, false);
    this.start(p, {
      id: "wander",
      target: { level: at.level, x: at.x, z: at.z, yaw: p.yaw, room: this.pf.roomAt(at.level, at.x, at.z) },
      duration: this.rng.range(20, 40),
      pose: "look",
      gain: { curiosity: 0.2 },
    });
    this.counts.heard++;
    this.log("heard", [p.id], s.room, s.kind);
  }

  /** Whether two people are in the same conversation, dancing together, or side by side at table. */
  /** Stepping round each other in the same circle, or lining up for the same photograph: nobody walks into anyone. */
  private shuffling(a: Person, b: Person): boolean {
    const x = a.action;
    const y = b.action;
    if (!x || !y || x.id !== y.id || x.ref !== y.ref) return false;
    return x.id === "mingle" || (x.id === "task" && this.tasks.of(a)?.kind === "photo");
  }

  together(a: Person, b: Person): boolean {
    const x = a.action;
    const y = b.action;
    if (!x || !y || x.startedAt === null || y.startedAt === null) return false;
    if (x.id === "mingle" && y.id === "mingle") return x.ref === y.ref && x.note === "in" && y.note === "in";
    const close = a.level === b.level && Math.hypot(a.x - b.x, a.z - b.z) < 1.5;
    return close && ((x.id === "dance" && y.id === "dance") || (x.id === "dinner" && y.id === "dinner") || x.id === "ask" || y.id === "ask");
  }

  sound(kind: SoundKind, at: { level: number; x: number; z: number; room: number }, source: number, ref = -1): void {
    this.senses.sound(kind, at, source, ref);
  }

  get phaseId(): PhaseId {
    return this.phase.id;
  }

  tensionOf(i: number): number {
    return this.mood.tension[i]!;
  }

  familiarity(p: Person, room: number): number {
    return this.memory.familiarity(p.id, room);
  }

  suspects(i: number, j: number): number {
    return this.memory.suspects(i, j);
  }

  energy(p: Person): number {
    return this.mood.energy[p.id]!;
  }

  tension(p: Person): number {
    return this.mood.tension[p.id]!;
  }

  /** What the party has noticed so far. */
  get stats(): PartyStats {
    const m = this.memory.stats;
    return {
      facts: this.memory.count,
      told: m.told,
      overheard: m.overheard,
      doubleTakes: this.ident.stats.doubleTakes,
      tests: this.ident.stats.tests,
      wrongTurns: this.counts.wrongTurns,
      asks: this.counts.asks,
      hushes: this.counts.hushes,
      heard: this.counts.heard,
      sightings: this.senses.stats.sightings,
      cases: this.register.stats.cases,
      blames: this.register.stats.settled,
      conflicts: this.register.stats.conflicts,
      recognised: this.register.stats.recognised,
      claims: this.register.stats.claims,
      askedAround: this.register.stats.asked,
      tours: this.tasks.stats.tours,
      errands: this.tasks.stats.errands,
      fetched: this.counts.fetched,
      searches: this.tasks.stats.searches,
      found: this.tasks.stats.found,
      candids: this.tasks.stats.candids,
      photos: this.tasks.stats.photos,
      leaves: this.tasks.stats.leaves,
      joins: this.circles.stats.joins,
      rebuffs: this.circles.stats.rebuffs,
      ghosts: this.circles.stats.ghosts,
      splits: this.circles.stats.splits,
      greetings: this.circles.stats.greetings,
      breaches: this.practices.stats.breaches,
      couples: this.bonds.stats.couples,
      friendships: this.bonds.stats.friendships,
      flirtations: this.bonds.stats.flirting,
      rebuffed: this.bonds.stats.rebuffs,
      affairs: this.bonds.stats.affairs,
      foundOut: this.bonds.stats.foundOut,
      confrontations: this.bonds.stats.confrontations,
      spats: this.bonds.stats.spats,
      rows: this.bonds.stats.rows + this.bonds.stats.acts + this.bonds.stats.scuffles,
      fellOut: this.bonds.stats.fellOut,
      madeUp: this.bonds.stats.madeUp,
      pulled: this.bonds.stats.pulled,
      staffFriends: this.bonds.stats.staffFriends,
      slipAways: this.bonds.stats.slipAways,
      mishaps: this.dramas.stats.mishaps,
      habits: this.dramas.stats.outings,
      dramas: this.dramas.stats.dramas,
      late: this.reactions.stats.late,
      beckons: this.reactions.stats.beckons,
      points: this.reactions.stats.points,
      flutes: this.reactions.stats.glasses,
      slips: this.ident.stats.slips,
      cool: this.ident.stats.cool,
      compared: this.ident.stats.compared,
      sure: this.ident.stats.sure,
      challenges: this.counts.challenges,
      frowns: this.reactions.stats.frowns,
      helps: this.reactions.stats.helps,
      shrugs: this.reactions.stats.shrugs,
      prompts: this.prompts.log.length,
      tourAsks: this.counts.tourAsks,
      finds: this.counts.finds,
    };
  }

  log(kind: PartyEvent["kind"], actors: number[], room?: number, note?: string): void {
    this.events.push({ t: this.t, kind, actors, room, note });
  }

  /** A short digest of everyone's state, the doors and the things in hand, for determinism checks. */
  digest(): string {
    let h = 0;
    const mix = (s: string) => {
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    };
    const { energy, tension } = this.mood;
    for (const p of this.people) {
      mix(`${p.id}:${p.present ? 1 : 0}${p.gone ? 1 : 0}:${Math.round(p.x * 100)},${Math.round(p.z * 100)},${p.level}:${p.action?.id ?? "-"}:${Math.round(p.tipsy * 100)}:${p.item}`);
      mix(`${Math.round(energy[p.id]! * 20)},${Math.round(tension[p.id]! * 20)}`);
    }
    for (const d of this.world.doors) mix(`${d.id}:${Math.round(d.open * 10)}${d.locked ? 1 : 0}`);
    mix(`f${this.memory.count}`);
    const b = this.bonds.stats;
    mix(`b${b.couples},${b.friendships},${b.flirting},${b.spats + b.rows + b.acts},${b.fellOut}`);
    const d = this.dramas.stats;
    mix(`d${d.rolls},${d.mishaps},${d.outings},${d.dramas}`);
    for (const p of this.people) if (p.stain || p.bandage) mix(`s${p.id}${p.stain ?? ""}${p.bandage ? 1 : 0}`);
    const r = this.reactions.stats;
    mix(`r${r.late},${r.beckons},${r.points},${r.glasses},${r.frowns},${r.helps},${r.puzzled},${r.shrugs}`);
    const i = this.ident.stats;
    mix(`i${i.tests},${i.fumbled},${i.compared},${i.sure},${i.slips},${i.cool},${i.names}:${this.prompts.log.length}`);
    if (this.spy) mix(this.spy.digest());
    if (this.finding) mix(this.finding.digest());
    mix(this.bags.digest());
    return `${this.t}:${(h >>> 0).toString(16)}`;
  }

  /** Perch visibility of a person (0..1), from the house's visibility grid with the curtains as they are now. */
  visibility(p: Person): number {
    return p.present ? this.world.visAt(p.level, this.pf.cellOf(p.level, p.x, p.z)) : 0;
  }
}
