/**
 * Data shapes for the party simulation (spec: Guests and the Spy).
 * Everything here is plain data so a run can be stepped headless, hashed and replayed.
 */

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

export type Pose = 'stand' | 'walk' | 'sit' | 'talk' | 'drink' | 'dance' | 'toast' | 'look' | 'play' | 'serve' | 'smoke' | 'greet' | 'announce' | 'wait' | 'climb';

export type Held = 'champagne' | 'wine' | 'beer' | 'whisky' | 'water' | 'tray' | 'cue' | 'cards' | 'cigarette';

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
  | 'staff';

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
  /** In-game time a wait (a queue at a door) is given up. */
  until?: number;
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
  /** Index into Places.seats.dining; null eats at the buffet. */
  seat: number | null;
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
}

export type EventKind = 'phase' | 'arrive' | 'leave' | 'announce' | 'bathroom-busy' | 'retry' | 'seated' | 'toast' | 'champagne';

export interface PartyEvent {
  t: number;
  kind: EventKind;
  actors: number[];
  room?: number;
  note?: string;
}
