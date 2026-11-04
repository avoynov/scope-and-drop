/**
 * What the recordings in demo/reticle/sounds/ hold, read off them once, offline, so the game can follow them
 * instead of the other way round. Times are seconds from the start of each file as stored.
 */
import type { RifleId } from "./shot";

/**
 * One recording of a full bolt cycle (`<rifle>-cycle[-n].wav`, take n−1 here). `up`: the handle lifted, cocking
 * the striker. `back`: the bolt against its stop, the case thrown out. `home`: the bolt pushed fully forward,
 * the round in the chamber. `down`: the handle turned down, locked. `dur`: the file's length.
 */
export interface BoltTake {
  up: number;
  back: number;
  home: number;
  down: number;
  dur: number;
}

/** The bolt cycles recorded per rifle, in take order. A rifle with none is synthesised in four pieces. */
export const BOLT_TAKES: Partial<Record<RifleId, readonly BoltTake[]>> = {
  bolt: [
    // A fast cycle: from bolt-action-1.
    { up: 0.02, back: 0.285, home: 0.595, down: 0.785, dur: 0.892 },
    // A slower one, the case ringing off the action at 0.33: from bolt-action-2.
    { up: 0.02, back: 0.265, home: 0.645, down: 0.845, dur: 1.42 },
  ],
};
