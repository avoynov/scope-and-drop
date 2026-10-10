/**
 * The rifle's action as the shooter has to keep track of it: what is in the chamber, whether the hammer or
 * striker is cocked, whether the SVD's bolt stop is holding the carrier back, and how many rounds are left in
 * the magazine. Three things change it, each its own control: the trigger, working the action (the bolt or the
 * charging handle) and changing the magazine. None does another's job.
 *
 * What the trigger does when there is nothing to fire follows the real rifles:
 *  - Bolt rifle (Remington 700 / M24 class): opening the bolt cocks the striker, and firing leaves it down with
 *    the fired case in the chamber, so until the bolt is worked the trigger is dead. Closed on an empty chamber,
 *    the cocked striker snaps forward with a click, and is then down.
 *  - SVD: after the last round the follower lifts the bolt stop and the carrier stays back, even with the
 *    magazine out, until the charging handle is pulled (SVD manual, §33). With the carrier back, the auto sear
 *    holds the hammer, so the trigger is dead. Racked over an empty magazine, the carrier is caught again.
 *  - VSS: striker fired, and with no bolt stop it shuts on an empty chamber after the last round, cocked: the
 *    next pull is a click.
 */
import { ACTIONS, type Chamber } from './handling';
import type { RifleId } from './shot';

export interface ActionState {
  chamber: Chamber;
  cocked: boolean;
  /** The SVD's carrier held back by its bolt stop. */
  held: boolean;
  /** Rounds in the magazine (not counting the chamber). */
  mag: number;
}

/** What a pull of the trigger does: fires, snaps the hammer or striker onto an empty chamber, or nothing. */
export type Pull = 'fire' | 'click' | 'dead';

const semi = (rifle: RifleId) => !!ACTIONS[rifle].carrier;
const holdsOpen = (rifle: RifleId) => !!ACTIONS[rifle].carrier?.holdOpen;

/** Loaded and ready: a full magazine, one of it chambered. */
export function loaded(rifle: RifleId): ActionState {
  return { chamber: 'live', cocked: true, held: false, mag: ACTIONS[rifle].mag.rounds - 1 };
}

/** The trigger pulled. Returns what happened; the state changes for a shot or a click. */
export function pull(s: ActionState, rifle: RifleId): Pull {
  if (s.held || !s.cocked) return 'dead';
  if (s.chamber !== 'live') {
    s.cocked = false;
    return 'click';
  }
  if (semi(rifle)) {
    // The gas drives the carrier back: out goes the case, in the next round, hammer or striker cocked again.
    if (s.mag > 0) s.mag--;
    else {
      s.chamber = 'empty';
      s.held = holdsOpen(rifle);
    }
  } else {
    s.chamber = 'spent';
    s.cocked = false;
  }
  return 'fire';
}

/** The action worked by hand: whatever was chambered thrown out, cocked, and the top round, if any, chambered. */
export function cycle(s: ActionState, rifle: RifleId): void {
  s.cocked = true;
  if (s.mag > 0) {
    s.mag--;
    s.chamber = 'live';
    s.held = false;
  } else {
    s.chamber = 'empty';
    s.held = holdsOpen(rifle);
  }
}

/** A full magazine in place of the old one. The chamber, and a held carrier, stay as they were. */
export function reload(s: ActionState, rifle: RifleId): void {
  s.mag = ACTIONS[rifle].mag.rounds;
}
