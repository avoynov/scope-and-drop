/**
 * Moving the spy into another person's record (milestone 3 technical plan: What the swap moves).
 * The record keeps who the person is to everyone else: the name, the role, the clothes, the
 * partner and friends, the seat, the coat, and every memory of them. Its body and mind become
 * the spy's own. Before the party it has studied its victim, so it keeps the habits it could
 * copy: the smoking and the favourite drink.
 *
 * The voice and the temper live in `Ident` and `Bonds`; the party recasts those after `dress()`.
 */
import type { Person } from "../types";
import type { SpyOwn } from "./cast";

/**
 * Coming as itself, before anyone knows anyone (so before `Ident`): the record is its own, so
 * nobody here knows it, as nobody knows the stranger. Its friendships are cut both ways, it has
 * never been to the house, it has no manner from the deck of archetypes, and it keeps the
 * steadier head.
 */
export function asItself(p: Person, own: SpyOwn, people: readonly Person[]): void {
  for (const f of p.friends) people[f]!.friends = people[f]!.friends.filter((x) => x !== p.id);
  p.friends = [];
  p.regular = false;
  p.archetype = null;
  p.traits = { ...own.traits };
  p.leaveAt = own.leaveAt;
  p.early = null;
}

/** Put the spy's own body and mind into a record. `studied`: it watched the victim first, and copies what can be copied. */
export function dress(p: Person, own: SpyOwn, studied: boolean): void {
  p.look.height = own.height;
  p.look.build = own.build;
  p.speed = own.speed;
  // Its own habits, never a cane; a studied spy lights up where the victim would.
  const quirks = [...own.quirks];
  if (studied && p.quirks.includes("smoker") && !quirks.includes("smoker")) quirks.push("smoker");
  p.quirks = quirks;
  p.traits = { ...own.traits };
  p.fluency = { ...own.fluency };
  p.fav = studied ? p.fav : own.fav;
  p.never = own.never !== p.fav ? own.never : null;
  // It leaves by its own rule (spy/index.ts), never for a reason of the victim's.
  p.leaveAt = own.leaveAt;
  p.early = null;
}
