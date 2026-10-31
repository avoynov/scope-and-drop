/**
 * The party lab's look-ahead (milestone 3, PR 4): a module worker that builds the lab's evening
 * afresh, from the same house, guests, spy option and every provocation and mood nudge planted so
 * far, and runs it on to 22:00, so the spy's timeline can show the whole evening before it has
 * played. Every in-game 5 minutes it posts the spy's record so far: its covers' spells, its plan's
 * steps, its tells, the innocent twins, its place among the most suspected each minute, and the
 * evening's digest, which the lab checks against its own when it gets there. The evening is
 * deterministic, so this is the one the lab will play. The lab starts another whenever the
 * evening changes (spy.ts).
 */
import { generateMansion, type MansionOptions } from "../../src/mansion";
import { Party, PARTY_LENGTH, rankOf, type PlanRecord, type Spell, type SpyOptions, type Tell } from "../../src/party";
import type { Verb } from "../../src/party/memory";
import type { MoodOverride } from "../../src/party/mood";
import type { Provocation } from "../../src/party/sim";

/** The evening to run, as the lab's newParty() builds it, and the key the lab knows it by. */
export interface AheadAsk {
  key: string;
  seed: string;
  size?: MansionOptions["size"];
  party: string;
  guests?: number;
  provoke: Provocation[];
  mood: MoodOverride[];
  spy: false | SpyOptions;
}

/** The spy's record up to `t` (`done` once the evening is over, or `error` if it stopped short). */
export interface AheadRecord {
  key: string;
  t: number;
  done: boolean;
  error?: string;
  spells: Spell[];
  steps: PlanRecord[];
  tells: Tell[];
  twins: Array<{ t: number; who: number; verb: Verb }>;
  /** Its place among the most suspected (1 the most) and its score, each RANK_EVERY while it is at the party. */
  ranks: Array<{ t: number; rank: number; score: number }>;
  /** The evening's digest at each sample. */
  digests: Array<{ t: number; digest: string }>;
}

/** A post this often, a rank this often (in-game s). Only types leave this file: the lab imports nothing that would run it on the page. */
const SAMPLE = 5 * 60;
const RANK_EVERY = 60;

self.onmessage = (e: MessageEvent<AheadAsk>) => {
  const a = e.data;
  const rec: AheadRecord = { key: a.key, t: 0, done: false, spells: [], steps: [], tells: [], twins: [], ranks: [], digests: [] };
  const post = (party: Party) => {
    const spy = party.spy;
    rec.t = party.t;
    if (rec.digests[rec.digests.length - 1]?.t !== party.t) rec.digests.push({ t: party.t, digest: party.digest() });
    if (spy) {
      rec.spells = spy.covers.spells;
      rec.steps = spy.plans.history;
      rec.tells = spy.measure.tells;
      rec.twins = spy.measure.twins;
    }
    self.postMessage(rec);
  };
  try {
    const party = new Party(generateMansion({ seed: a.seed, size: a.size }), { seed: a.party, guests: a.guests, provoke: a.provoke, mood: a.mood, spy: a.spy });
    while (!party.over) {
      party.advance(RANK_EVERY);
      const spy = party.spy;
      if (spy?.record.present && !spy.record.gone) rec.ranks.push({ t: party.t, ...rankOf(party.people, party.memory, party.ident, party.t, spy.id) });
      if (party.t % SAMPLE === 0 && party.t < PARTY_LENGTH) post(party);
    }
    rec.done = true;
    post(party);
  } catch (err) {
    rec.done = true;
    rec.error = err instanceof Error ? err.message : String(err);
    self.postMessage(rec);
  }
};
