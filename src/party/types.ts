/**
 * Data shapes for the party simulation (spec: Guests and the Spy).
 * Everything here is plain data so a run can be stepped headless, hashed and replayed.
 */
import type { Verb } from "./memory";

export type Sex = "f" | "m";

/** Roles own tasks they do fluently; staff roles are not guests. */
export type RoleId =
  | "host"
  | "butler"
  | "waiter"
  | "bartender"
  | "cook"
  | "kitchenHand"
  | "cloakroom"
  | "musician"
  | "photographer"
  | "politician"
  | "pianist"
  | "doctor"
  | "dancer"
  | "billiards"
  | "guest";

export const STAFF_ROLES: ReadonlySet<RoleId> = new Set(["butler", "waiter", "bartender", "cook", "kitchenHand", "cloakroom", "musician", "photographer"]);

/**
 * Guests cast from A Real Party's deck: each a preset of traits, habits, ties and a look hook.
 * Most guests are ordinary (null).
 */
export type Archetype = "honoree" | "old-friend" | "mother" | "child" | "boss" | "employee" | "plus-one" | "young" | "elderly" | "life" | "gossip" | "bore" | "flirt" | "ex";

/** What people do more or less fluently (0 to 1): the owner of a task about 0.95, others 0.2 to 0.5. */
export type Skill = "tour" | "keys" | "errand" | "pour" | "tray" | "piano" | "dance" | "billiards" | "photo";
export const SKILLS: readonly Skill[] = ["tour", "keys", "errand", "pour", "tray", "piano", "dance", "billiards", "photo"];

/** Silhouette: what tells people apart at 4× along with the colour. */
export type Outfit = "tails" | "suit" | "dinner-jacket" | "long-dress" | "short-dress" | "waiter" | "chef";

/** Visible habits: the baseline impersonation gets wrong. */
export type Quirk = "glasses" | "limp" | "cane" | "ear-scratch" | "globe-pointer" | "dances-after-drink" | "hands-in-pockets" | "tie-adjust" | "big-laugh" | "smoker" | "watch-check";

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

export type NeedId = "thirst" | "hunger" | "bladder" | "social" | "dance" | "rest" | "air" | "curiosity" | "companion";
export const NEED_IDS: readonly NeedId[] = ["thirst", "hunger", "bladder", "social", "dance", "rest", "air", "curiosity", "companion"];
/** 0 = urgent, 1 = met. */
export type Needs = Record<NeedId, number>;

export type Pose =
  | "stand"
  | "walk"
  | "sit"
  | "talk"
  | "drink"
  | "dance"
  | "toast"
  | "look"
  | "play"
  | "serve"
  | "smoke"
  | "greet"
  | "announce"
  | "wait"
  | "climb"
  | "knock"
  /** Shaking hands, or a kiss on the cheek. */
  | "shake"
  | "kiss"
  /** Holding a camera to the eye. */
  | "camera"
  /** Carrying something in both hands (a bottle, a coat). */
  | "carry"
  /** Standing in a row for the group photo, facing the camera. */
  | "line"
  /** Having words: leaning in, both hands going. */
  | "argue"
  /** Arms round each other: making up, or a couple alone. */
  | "hug"
  /** Dancing close with a partner, face to face. */
  | "slow"
  /** Club style: in front of a partner, back to them, and the one behind. */
  | "front"
  | "behind"
  /** Fanning someone who feels faint. */
  | "fan"
  /** Down on one knee, searching the floor or sweeping up glass. */
  | "crouch"
  /** Dabbing at a stain. */
  | "dab"
  /** Singing round the piano, swaying. */
  | "sing"
  /** A phone to the ear: called away. */
  | "phone"
  /** Trying a locked door's handle. */
  | "rattle"
  /** An arm round someone, walking them along like a friend who has had one too many (milestone 3: the injection's walk-off). */
  | "prop"
  /** Being walked along, slumped against whoever holds them up; carried by two, feet trailing. */
  | "sag"
  /** Grappling: hands at a throat from behind, and the one held fighting it. */
  | "struggle"
  /** Bent low, walking backwards, pulling someone along the floor by the arms. */
  | "drag"
  /** Flat out on the floor, a sofa or a bed. */
  | "lie";

/**
 * A gesture over the pose, for a few seconds: asking the way, pointing it, a shrug, leaning in, a wave, a frown, beckoning someone over;
 * at the height of a row a slap, a shove, a drink thrown, a pull by the arm; a startled jerk, arms out in the dark, a look at the watch.
 */
export type Gesture = "ask" | "point" | "shrug" | "lean" | "wave" | "frown" | "beckon" | "slap" | "shove" | "throw" | "pull" | "startle" | "grope" | "watch";

/** The six drinks of the evening. */
export type DrinkId = "champagne" | "red" | "white" | "beer" | "whisky" | "water";
export const ALCOHOL: ReadonlySet<DrinkId> = new Set(["champagne", "red", "white", "beer", "whisky"]);

/** What shows in someone's hands: a drink, a tray, a cue, cards or a cigarette. */
export type Held = DrinkId | "tray" | "cue" | "cards" | "cigarette" | "bottle" | "coat" | "bag" | "camera" | "kit";
export const DRINKS: ReadonlySet<Held> = new Set<Held>(["champagne", "red", "white", "beer", "whisky", "water"]);

/** Keys a person carries: none, the staff ring (service rooms) or the host's ring (everything). */
export type Ring = "none" | "staff" | "host";

export type ActionId =
  | "arrive"
  | "mingle"
  | "drink"
  | "champagne"
  | "toilet"
  | "sit"
  | "art"
  | "terrace"
  | "dance"
  | "dinner"
  | "toast"
  | "games"
  | "wander"
  | "leave"
  | "staff"
  /** Asking someone the way (note 'bathroom'), or a friendly test of someone who seems not themselves (note 'test'). */
  | "ask"
  /** Using something in the house an ad offers: the fire, the bookshelves, the globe, the fountain, the kitchen counter (note: the ad). */
  | "use"
  /** Canapés, the buffet outside dinner, the late sweets. */
  | "snack"
  /** Going to say hello to someone just seen (ref: whom). */
  | "greet"
  /** Having words with someone, or a hug to make up (bonds.ts; ref: the other, note: the kind, 'answer' for the one it's put to). */
  | "row"
  /** A step of a task (tasks.ts): a tour, an errand, a search, the group photo, saying goodbye (ref: the task, note: the step). */
  | "task";

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
  kind: "dining" | "sofa" | "armchair" | "chair";
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
  /** A preset from the deck of archetypes, or null for an ordinary guest. */
  archetype: Archetype | null;
  /** Someone they used to be with (the exes), or -1. */
  ex: number;
  /** Who they came with for work (the boss and employee), or -1. */
  linked: number;
  /** How fluently they do each kind of task. */
  fluency: Record<Skill, number>;
  /** Leave once this share of the guests has gone (from the thank-you toast); skewed low. */
  leaveAt: number;
  /** A reason to go early, after dessert (unwell, a babysitter), or null. */
  early: string | null;
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
  /** Where it happened, when not where they are (the bedroom they've just come out of), or -1. */
  notableRoom: number;
  notableUntil: number;
  /** A wrong turn in progress: the goal they meant to reach, when the look round ends (-1 still walking in), and the locked door they'll try (-1 none). */
  detour: { goal: Waypoint; until: number; door: number } | null;
  /** A drink spilled down them tonight (the renderer tints the shirt), or null. */
  stain: DrinkId | null;
  /** A cut hand dressed: a bandage for the rest of the night. */
  bandage: boolean;
  /**
   * Milestone 3: injected and being walked off ('dying'), out cold where the spy let go of them ('collapsed'), or killed ('dead');
   * poisoned and feeling unwell ('ill') is poison's, never built. Null for everyone else, and always without a spy.
   */
  down: Down | null;
}

/** How someone is down (milestone 3): only the spy's work puts anyone there. */
export type Down = "ill" | "collapsed" | "dying" | "dead";

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
  | "phase"
  | "arrive"
  | "leave"
  | "announce"
  /** Someone reached a bathroom door to find it taken, not having known. */
  | "bathroom-taken"
  /** A queuer knocked on a taken bathroom. */
  | "knock"
  | "seated"
  | "toast"
  | "champagne"
  /** A bar poured a drink (note: the drink). */
  | "pour"
  /** Two people walked into each other (note 'slop' when a drink slopped). */
  | "bump"
  /** A room's lights went on or off (note 'on' or 'off'). */
  | "light"
  /** Someone looked twice at someone they know who didn't seem quite themselves. */
  | "double-take"
  /** A friendly test (a nickname, a shared joke) put to someone who seemed not themselves (note: 'passed', 'fumbled' by someone very drunk, 'bluffed' or 'failed' by an impostor). */
  | "test"
  /** A speaker passed something on (note: the verb; actors: speaker, then listeners). */
  | "gossip"
  /** Someone took a wrong turn on the way somewhere (note 'door' when they tried a locked door). */
  | "wrong-turn"
  /** A conversation went quiet as someone its members are wary of joined. */
  | "hush"
  /** Someone asked the way (note: 'pointed' or 'shrug'; actors: asker, answerer). */
  | "ask"
  /** A nosy guest heard something loud and went to look (note: the sound). */
  | "heard"
  /** Someone noticed something with a blank in it, like a thing gone (note: the case; actors: who noticed, whose it is). */
  | "case"
  /** Someone asked a group about an open case (note: the case; actors: the asker, then whoever answered). */
  | "ask-around"
  /** Someone passed on what points at their leading candidate (note: the case; actors: the speaker, the one pointed at). */
  | "lead"
  /** Someone connected the dots and settled a case (note: the case; actors: who settled it, whom they blame). */
  | "blame"
  /** Something didn't fit (note: 'two-places', 'claim' or 'not-themselves'; actors: who noticed, whom it's about). */
  | "conflict"
  /** A description put a name to someone, and it bears on a case (actors: who, whom). */
  | "recognised"
  /** A guest told the host what they'd worked out (actors: the guest, the host). */
  | "tell"
  /** Two people who know each other met for the first time tonight (note 'wave', 'shake' or 'kiss'). */
  | "greet"
  /** Someone waited at the edge of a circle and was let in (note 'open') or not (note 'closed'); actors: the joiner, then the members. */
  | "join"
  /** A circle grew past what one conversation holds and split in two (actors: those who moved off). */
  | "split"
  /** A task began or ended (note: the kind and how it went, e.g. 'tour', 'tour:done'; actors: its owner, then its party). */
  | "task"
  /** Someone broke a practice's norm (note: the norm), and those who saw it frowned (actors: who, then who frowned). */
  | "breach"
  /** A camera flash: a candid shot or the group photo (actors: the photographer, then who was in it). */
  | "photo"
  /** A guest said goodbye to the host (actors: the guest, the host). */
  | "goodbye"
  /** A beat of a practice (note: the beat, e.g. 'tap', 'hush', 'open-dance', 'band-break', 'last-call'). */
  | "beat"
  /** A bond reached a stage (note: 'noticing', 'flirting', 'couple', 'friend', 'staff-friend', 'affair', 'fell-out', 'made-up'; actors: the pair, for an affair then the partner). */
  | "bond"
  /** One side wasn't that way inclined and stepped back (actors: the cool one, the keen one). */
  | "rebuff"
  /** Words between two (note: 'spat', 'row', 'hiss', or 'act:slap' and the like; actors: who started it, at whom). */
  | "row"
  /** A partner had it out over an affair (note: 'pull', 'jealous', 'scuffle', or the act; actors: the partner, the one caught, the one they were with). */
  | "confront"
  /** Someone's doubt about their partner passed a line (note: 'watchful', or 'seen' or 'told' for confronting; actors: who, their partner). */
  | "doubt"
  /** A friend on the floor drew someone into dancing (actors: the dancer, who followed). */
  | "pull"
  /** A couple slipped away to a bedroom and locked the door (note 'in', 'out'; actors: the pair). */
  | "slip-away"
  /** A frame or a hand was won (note: the game; actors: winner, loser). */
  | "won"
  /** An accident (dramas.ts; note: the mishap, then ':' and how it went on, e.g. 'spill', 'spill:changed'; actors: who it happened to first). */
  | "mishap"
  /** A small drama from the evening's deck (note: the card, then ':' and its beat; actors: its cast). */
  | "drama"
  /** An oddball's habit, seen once more (note: the habit, then ':' and what they did; actors: the oddball, then whom it involved). */
  | "habit"
  /** The spy's own doings, for the lab and hidden there until the reveal (note: e.g. 'cue:dinner', 'leave'; actors: the spy's record). */
  | "spy"
  /**
   * Someone reacting to someone else: out of step ('beckon', 'glass', 'point'), a fumble of what they do well ('frown', 'help', 'puzzled'), a
   * request turned down ('shrug', or the host's 'later' to a tour) and asked again ('ask-again'), a greeting cooler than their tie ('cool'), a
   * name they didn't know ('name'), the host prompted by the household ('prompt'), and something of a guest's found outside ('garment');
   * actors: who reacted, then whom (for 'garment', the finder, then whose it is when they know).
   */
  | "react"
  /**
   * Seeing through someone (milestone 3): sure at last ('sure'), and what the doubter did about it: confronting them out loud ('out-loud'),
   * backing away ('backed-away') to tell someone ('told'), or saying nothing and keeping away ('silent'); and notes compared ('compare').
   * Actors: the doubter, then whom about; for 'compare' and 'told', the doubter, the listener, then whom about.
   */
  | "challenge"
  /**
   * Someone down (milestone 3): injected and walked off ('dying'), killed ('dead'), hidden ('hidden') or left where they fell ('left'), out
   * cold ('collapsed') and up again ('came-to'); poisoned and unwell ('ill') and carried to a sofa or a bed ('carried', 'laid') are poison's,
   * never built. Actors: who is down, then whoever did it or helped.
   */
  | "down";

export interface PartyEvent {
  t: number;
  kind: EventKind;
  actors: number[];
  room?: number;
  note?: string;
}
