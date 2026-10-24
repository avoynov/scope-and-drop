/**
 * The party lab's spy (milestone 3): its options, the goal odds, the reveal and its card, and the
 * ten people the crowd suspects most.
 *
 *   /party/?seed=gala-night&setup=victim&goal=safe&odds=kill:50,bug:0&steal=80&reveal=1
 *
 * spy=0 turns it off. setup (self, victim, host, waiter) and goal (kill, statuette, safe, bag,
 * bug, ledger) pin those draws; odds weighs the goals (a goal left out keeps its share, 0 switches
 * it off) and steal says how often a kill steals first (0 to 100). A value the lab doesn't know is
 * dropped, so that draw is made as usual.
 *
 * Until it is revealed (the button, or reveal=1) the lab shows its record as the crowd believes
 * it: its own events stay out of the log and its card stays shut. With someone picked, the
 * button first asks "is it them?", so a tester can score a guess. The goal odds show from the
 * start, since they are chances, not the draw; a change builds the evening afresh from 19:00 with
 * the same house, guests and provocations, and only the spy cast anew. Tests show in the log
 * without their outcome until the reveal, since only an impostor bluffs or fails one; the ranks
 * show from the start, and mark the spy's record once it is revealed.
 */
import {
  clockLabel,
  GOAL_SHARES,
  goalOdds,
  GOALS,
  phaseIndexAt,
  ranks,
  SETUPS,
  STEAL,
  type CueHow,
  type DangerWhy,
  type GoalKind,
  type Party,
  type PartyEvent,
  type SpyOptions,
  type SpySetup,
} from "../../src/party";

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
};
/** What a test came to, in the log once the spy is revealed. */
const TEST_LABEL: Record<string, string> = { passed: "it's them", fumbled: "too drunk to get it, and laughs it off", bluffed: "they laugh along", failed: "a blank look" };
const SURE_LABEL: Record<string, string> = { "out-loud": "had it out", "backed-away": "backed away to tell someone", silent: "kept silent" };
/** The ranks list shows this many. */
const RANKS = 10;

const pct = (v: number): string => `${Math.round(v * 100)}%`;
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
  private readonly chances = new Map<GoalKind, HTMLElement>();
  private readonly weights = new Map<GoalKind, HTMLInputElement>();
  private readonly switches = new Map<GoalKind, HTMLInputElement>();
  private stealInput: HTMLInputElement | null = null;
  /** The ten most suspected: their rows are kept, so a click on one isn't lost to a refresh. */
  private readonly rankHead: HTMLElement;
  private readonly rankRows: HTMLButtonElement[] = [];

  constructor(
    private readonly params: URLSearchParams,
    private readonly host: SpyLabHost,
    box: HTMLElement,
    card: HTMLElement,
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
    this.rankHead = document.createElement("div");
    this.rankHead.className = "label";
    for (let k = 0; k < RANKS; k++) {
      const b = document.createElement("button");
      b.className = "rank";
      b.title = "Pick them";
      b.onclick = () => b.dataset.id && this.host.select(Number(b.dataset.id));
      this.rankRows.push(b);
    }
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
    box.appendChild(row);
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

  /** Until the reveal, the spy's own events stay out of the log. */
  hides(e: PartyEvent): boolean {
    return e.kind === "spy" && !this.revealed;
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
      return `${a} reacts to ${b}: ${e.note}`;
    }
    if (e.kind !== "spy" || !party) return null;
    const who = n(e.actors[0]);
    const [what, a, b] = (e.note ?? "").split(":");
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
    }
    this.picked = selected;
    this.lastRefresh = redraw;
    this.renderRanks(party);
    const spy = party.spy;
    if (!spy) {
      this.card.classList.remove("on");
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
  }

  /** The ten the crowd suspects most, as it believes them to be; the spy's record marked once revealed. */
  private renderRanks(party: Party): void {
    const top = ranks(party.people, party.memory, party.ident, party.t, RANKS).filter((r) => r.score >= 0.005);
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
    lines.push(`goal: ${what}${first}${goal.doneAt !== null ? ` · done ${clockLabel(goal.doneAt)}` : " · waits for its plan (PR 3)"}`);
    if (goal.rooms.length) lines.push(`knows the way to ${goal.rooms.map(roomLabel).join(", ")}`);
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
    lines.push(`tells ${m.tells.length} (${seen} seen by someone) · innocent twins ${m.twins.length}`);
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
}
