/**
 * The rifle's action as the shooter has to keep track of it: what is in the chamber, whether the hammer or
 * striker is cocked, whether the SVD's bolt stop is holding the carrier back, how many rounds are left in the
 * magazine, and where the safety is. Four things change it, each its own control: the trigger, working the action
 * (the bolt or the charging handle), changing the magazine and the safety.
 *
 * What the trigger does when there is nothing to fire follows the real rifles:
 *  - Bolt rifle (Sako TRG / M24 class): opening the bolt cocks the striker, and firing leaves it down with the
 *    fired case in the chamber, so until the bolt is worked the trigger is dead. Closed on an empty chamber,
 *    the cocked striker snaps forward with a click, and is then down.
 *  - SVD: after the last round the follower lifts the bolt stop and the carrier stays back, even with the
 *    magazine out, until the charging handle is pulled (SVD manual, §23, §33). With the carrier back, the auto
 *    sear holds the hammer, so the trigger is dead. Racked over an empty magazine, the carrier is caught again.
 *  - VSS: striker fired, and with no bolt stop it shuts on an empty chamber after the last round, cocked: the
 *    next pull is a click.
 *
 * Nothing is done for the shooter, and nothing they try is refused that the rifle itself would allow; they have
 * to remember each step as a soldier does. A round is chambered by the action, never by the magazine: none of
 * the three has a bolt release or a hold-open that lets go when a magazine goes in, so after the last round a
 * fresh magazine leaves the chamber empty until the action is worked (the SVD's carrier stays on its bolt stop
 * until the charging handle is pulled, SVD manual §33; the TRG's round is "chambered from a loaded magazine by
 * moving the bolt to its rearmost position and then to its closed position"). A magazine change with a round
 * chambered keeps it. Working the action with a live round chambered throws that round out and chambers the
 * next, as it really does.
 *
 * The safety:
 *  - SVD (manual §18): the lever on the right of the receiver, up for safe. It locks the sear and the trigger
 *    and limits the carrier's travel back: its shield covers the slot the charging handle runs in, so the
 *    handle stops a little way back and nothing is chambered or thrown out. The lever cannot go up while the
 *    carrier is held open, the handle being where the shield would go (inferred from the same paragraph).
 *  - VSS: an AK-type lever, the same as the SVD's (the cross-bolt behind the trigger is the fire selector; the
 *    automatic mode is left out). With no bolt stop, nothing stops the lever going up.
 *  - Bolt rifle (Sako TRG manual): the lever inside the trigger guard, pulled back for ON. ON locks the trigger,
 *    the striker cocked and the bolt closed, so the bolt cannot be opened. It goes ON only with the striker
 *    cocked; with the striker down (after a shot, or a click) it springs back OFF.
 * A magazine change is never blocked by the safety.
 */
import { ACTIONS, type Chamber } from "./handling";
import type { RifleId } from "./shot";

export interface ActionState {
  chamber: Chamber;
  cocked: boolean;
  /** The SVD's carrier held back by its bolt stop. */
  held: boolean;
  /** Rounds in the magazine (not counting the chamber). */
  mag: number;
  /** The safety on. */
  safe: boolean;
}

/** What a pull of the trigger does: fires, snaps the hammer or striker onto an empty chamber, nothing, or won't move (safe). */
export type Pull = "fire" | "click" | "dead" | "safe";

const semi = (rifle: RifleId) => !!ACTIONS[rifle].carrier;
const holdsOpen = (rifle: RifleId) => !!ACTIONS[rifle].carrier?.holdOpen;

/** Loaded and ready: a full magazine, one of it chambered, the safety off. */
export function loaded(rifle: RifleId): ActionState {
  return { chamber: "live", cocked: true, held: false, mag: ACTIONS[rifle].mag.rounds - 1, safe: false };
}

/** The trigger pulled. Returns what happened; the state changes for a shot or a click. */
export function pull(s: ActionState, rifle: RifleId): Pull {
  if (s.safe) return "safe";
  if (s.held || !s.cocked) return "dead";
  if (s.chamber !== "live") {
    s.cocked = false;
    return "click";
  }
  if (semi(rifle)) {
    // The gas drives the carrier back: out goes the case, in the next round, hammer or striker cocked again.
    if (s.mag > 0) s.mag--;
    else {
      s.chamber = "empty";
      s.held = holdsOpen(rifle);
    }
  } else {
    s.chamber = "spent";
    s.cocked = false;
  }
  return "fire";
}

/**
 * The action worked by hand: whatever was chambered thrown out, cocked, and the top round, if any, chambered.
 * With the safety on the handle stops short (the SVD's and VSS's) or will not lift (the bolt rifle's), and
 * nothing changes. Returns whether it went through.
 */
export function cycle(s: ActionState, rifle: RifleId): boolean {
  if (s.safe) return false;
  s.cocked = true;
  if (s.mag > 0) {
    s.mag--;
    s.chamber = "live";
    s.held = false;
  } else {
    s.chamber = "empty";
    s.held = holdsOpen(rifle);
  }
  return true;
}

/** A full magazine in place of the old one. The chamber, and a held carrier, stay as they were. */
export function reload(s: ActionState, rifle: RifleId): void {
  s.mag = ACTIONS[rifle].mag.rounds;
}

/** Whether the safety can be put on now (it can always come off). */
export function canSafe(s: ActionState, rifle: RifleId): boolean {
  if (semi(rifle)) return !s.held;
  return s.cocked;
}

/** The safety flicked on or off. Returns whether it moved. */
export function setSafe(s: ActionState, rifle: RifleId, on: boolean): boolean {
  if (on === s.safe || (on && !canSafe(s, rifle))) return false;
  s.safe = on;
  return true;
}
