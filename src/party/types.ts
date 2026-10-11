/**
 * Data shapes for the party simulation (spec: Guests and the Spy).
 * Everything here is plain data so a run can be stepped headless, hashed and replayed.
 */
import type { Verb } from './memory';

export type Sex = 'f' | 'm';

/** Roles own tasks they do fluently; staff roles are not guests. */
export type RoleId = 'host' | 'waiter' | 'bartender' | 'cook' | 'politician' | 'pianist' | 'doctor' | 'dancer' | 'billiards' | 'guest';

export const STAFF_ROLES: ReadonlySet<RoleId> = new Set(['waiter', 'bartender', 'cook']);

/** Silhouette: what tells people apart at 4× along with the colour. */
export type Outfit = 'tails' | 'suit' | 'dinner-jacket' | 'long-dress' | 'short-dress' | 'waiter' | 'chef';

/** Visible habits: the baseline impersonation gets wrong. */
export type Quirk =
  | 'glasses'
  | 'limp'
  | 'cane'
  | 'ear-scratch'
  | 'globe-pointer'
  | 'dances-after-drink'
  | 'hands-in-pockets'
  | 'tie-adjust'
  | 'big-laugh'
  | 'smoker'
  | 'watch-check';

export interface Look {
  sex: Sex;
  /** Standing height (m). */
  height: number;
  /** 0 = slight, 1 = heavy. */
  build: number;
  outfit: Outfit;
  /** Main garment colour (hex). */
  color: string;
  /** Shirt, sash or trim colour (hex). */
  accent: string;
  skin: string;
  hair: string;
  hat: boolean;
}

export interface Traits {
  talk: number;
  social: number;
  curiosity: number;
  nerves: number;
  clumsy: number;
  thirst: number;
  dance: number;
  nosy: number;
  propriety: number;
  loyalty: number;
}

export type NeedId = 'thirst' | 'hunger' | 'bladder' | 'social' | 'dance' | 'rest' | 'air' | 'curiosity' | 'companion';
export const NEED_IDS: readonly NeedId[] = ['thirst', 'hunger', 'bladder', 'social', 'dance', 'rest', 'air', 'curiosity', 'companion'];
/** 0 = urgent, 1 = met. */
export type Needs = Record<NeedId, number>;

export type Pose = 'stand' | 'walk' | 'sit' | 'talk' | 'drink' | 'dance' | 'toast' | 'look' | 'play' | 'serve' | 'smoke' | 'greet' | 'announce' | 'wait' | 'climb' | 'knock';

/** A gesture over the pose, for a few seconds: asking the way, pointing it, a shrug, leaning in to pass something on. */
export type Gesture = 'ask' | 'point' | 'shrug' | 'lean';

/** The six drinks of the evening. */
export type DrinkId = 'champagne' | 'red' | 'white' | 'beer' | 'whisky' | 'water';
export const ALCOHOL: ReadonlySet<DrinkId> = new Set(['champagne', 'red', 'white', 'beer', 'whisky']);

/** What shows in someone's hands: a drink, a tray, a cue, cards or a cigarette. */
export type Held = DrinkId | 'tray' | 'cue' | 'cards' | 'cigarette';
export const DRINKS: ReadonlySet<Held> = new Set<Held>(['champagne', 'red', 'white', 'beer', 'whisky', 'water']);

/** Keys a person carries: none, the staff ring (service rooms) or the host's ring (everything). */
export type Ring = 'none' | 'staff' | 'host';

export type ActionId =
  | 'arrive'
  | 'mingle'
  | 'drink'
  | 'champagne'
  | 'toilet'
  | 'sit'
  | 'art'
  | 'terrace'
  | 'dance'
  | 'dinner'
  | 'toast'
  | 'games'
  | 'wander'
  | 'leave'
  | 'staff'
  /** Asking someone the way (note 'bathroom'), or a friendly test of someone who seems not themselves (note 'test'). */
  | 'ask';

/** A place someone can stand: always on a walkable nav cell. */
export interface Spot {
  level: number;
  x: number;
  z: number;
  /** Facing (radians about +y, 0 = +z), used when the person settles there. */
  yaw: number;
  /** Room index, -2 terrace. */
  room: number;
}

/** A place to sit: the seat itself and the walkable spot to approach it from. */
export interface Seat {
  id: string;
  kind: 'dining' | 'sofa' | 'armchair' | 'chair';
  /** Where the person sits (may be inside furniture on the nav grid). */
  x: number;
  z: number;
  y: number;
  yaw: number;
  approach: Spot;
}

export interface Waypoint {
  level: number;
  x: number;
  z: number;
  /** Reached by climbing a stair from the previous waypoint. */
  climb?: boolean;
}

export interface ActionState {
  id: ActionId;
  /** Where the action happens; null for actions in place. */
  target: Spot | null;
  seat?: Seat;
  /** In-game seconds the action lasts once at its target. */
  duration: number;
  /** Set when the person reaches the target. */
  startedAt: number | null;
  pose: Pose;
  /** Needs refilled over the duration (total gain). */
  gain: Partial<Needs>;
  /** Free-form handle: group id, bathroom index, game kind. */
  ref?: number;
  note?: string;
  /** Held once the action completes. */
  gives?: Held | null;
  /** In-game time a wait (a queue at a door, a turn at the bar) is given up. */
  until?: number;
  /** Reservation key of the spot it holds (one person per spot). */
  key?: string;
}

export interface Person {
  id: number;
  name: string;
  role: RoleId;
  staff: boolean;
  look: Look;
  traits: Traits;
  quirks: Quirk[];
  partner: number | null;
  friends: number[];
  /** Has been to the house before: knows the party rooms and the nearest bathrooms. */
  regular: boolean;
  /** Index into Places.diningSeats; null when the dining room is full. */
  seat: number | null;
  /** Index into Places.supperSeats for those the dining room can't seat; null eats at the buffet. */
  supper: number | null;
  /** The drink they ask for most, and one they never touch (about 1 in 5 have one). */
  fav: DrinkId;
  never: DrinkId | null;
  /** In-game seconds after 19:00. */
  arriveAt: number;
  /** Person-specific delay before they adjust to a new phase (in-game s). */
  phaseLag: number;

  present: boolean;
  gone: boolean;
  level: number;
  x: number;
  z: number;
  /** Height of the floor under them (m). */
  y: number;
  yaw: number;
  room: number;
  pose: Pose;
  held: Held | null;
  /** In-game time the held item is put down or finished. */
  heldUntil: number;
  /** Alcoholic drinks so far. */
  drinks: number;
  /** Every drink tonight, oldest first (up to 24). */
  drinkLog: Array<{ drink: DrinkId; t: number }>;
  /** 0 sober to 1 very drunk; climbs as drinks are sipped, fades by 0.05 an in-game hour. */
  tipsy: number;
  /** Item id in hand (a glass or a tray), or -1. `held` is what it looks like. */
  item: number;
  /** Item id of the coat they came in, or -1. */
  coat: number;
  ring: Ring;
  /** Door id of a key lent for an errand, or -1. */
  lentKey: number;
  needs: Needs;
  action: ActionState | null;
  path: Waypoint[];
  pathIndex: number;
  /** Next in-game time the mind re-plans. */
  thinkAt: number;
  /** What they remember: place key -> in-game time it is worth trying again. */
  avoid: Map<string, number>;
  /** Phase index they are acting on (lags the real one by phaseLag). */
  phaseSeen: number;
  /** Walking speed (m per real second). */
  speed: number;
  /** A gesture over the pose, and the in-game time it ends. */
  gesture: Gesture | null;
  gestureUntil: number;
  /** Where the head is turned (a glance) until `lookUntil`; the body keeps its yaw. */
  lookX: number;
  lookZ: number;
  lookUntil: number;
  /** Something odd or notable about what they're doing, picked up by whoever sees them until `notableUntil`. */
  notable: Verb | null;
  /** The other person (or door id) the notable thing involves, or -1. */
  notableObj: number;
  notableUntil: number;
  /** A wrong turn in progress: the goal they meant to reach, when the look round ends (-1 still walking in), and the locked door they'll try (-1 none). */
  detour: { goal: Waypoint; until: number; door: number } | null;
}

export interface Group {
  id: number;
  level: number;
  x: number;
  z: number;
  room: number;
  members: number[];
  /** Who is talking right now (for gestures). */
  speaker: number;
  speakerUntil: number;
  /** Nobody speaks until then: someone they're wary of has just joined. */
  quietUntil: number;
}

export type EventKind =
  | 'phase'
  | 'arrive'
  | 'leave'
  | 'announce'
  /** Someone reached a bathroom door to find it taken, not having known. */
  | 'bathroom-taken'
  /** A queuer knocked on a taken bathroom. */
  | 'knock'
  | 'seated'
  | 'toast'
  | 'champagne'
  /** A bar poured a drink (note: the drink). */
  | 'pour'
  /** Two people walked into each other (note 'slop' when a drink slopped). */
  | 'bump'
  /** A room's lights went on or off (note 'on' or 'off'). */
  | 'light'
  /** Someone looked twice at someone they know who didn't seem quite themselves. */
  | 'double-take'
  /** A friendly test (a nickname, a shared joke) put to someone who seemed not themselves (note 'passed'). */
  | 'test'
  /** A speaker passed something on (note: the verb; actors: speaker, then listeners). */
  | 'gossip'
  /** Someone took a wrong turn on the way somewhere (note 'door' when they tried a locked door). */
  | 'wrong-turn'
  /** A conversation went quiet as someone its members are wary of joined. */
  | 'hush'
  /** Someone asked the way (note: 'pointed' or 'shrug'; actors: asker, answerer). */
  | 'ask'
  /** A nosy guest heard something loud and went to look (note: the sound). */
  | 'heard';

export interface PartyEvent {
  t: number;
  kind: EventKind;
  actors: number[];
  room?: number;
  note?: string;
}
