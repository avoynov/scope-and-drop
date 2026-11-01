/**
 * The armoury page: buy kit for good, choose a loadout for the next contract (the rifle, an item a slot, up to two
 * spotters), see what it leaves of the pay, and settle a stand-in contract to see the receipt until missions pay for
 * real. Everything is the armoury's own logic (src/armoury); this page only shows it and stores the career.
 * Functional, not finished: how it looks comes later.
 */
import { SPOTTER_TIERS, earlyBoost, settleContract, type Receipt, type Settled } from "../../src/armoury/career";
import { BROKER_PRICE, FINISHES, FIXER_PRICE, ISSUED, ITEMS, ITEM_IDS, MAX_SPOTTERS, RETAINER, SLOTS, SLOT_NAMES, SPOTTERS, fits, type FinishId, type ItemId, type Slot } from "../../src/armoury/catalogue";
import { TERMS, gradeFor, makeDossier } from "../../src/armoury/dossier";
import { MEDALS, MEDAL_IDS, medalMaterial, serviceMark, wearLook } from "../../src/armoury/record";
import type { MissionReport, ShotReport } from "../../src/armoury/report";
import { carried, checkLoadout, decodeKit, encodeKit, payFactor } from "../../src/armoury/loadout";
import { effectiveMargin, marginHint } from "../../src/armoury/margin";
import { PERCH_ARC_DEG } from "../../src/mansion/site/perch";
import { ROUNDS } from "../../src/scope/ballistics";
import type { RifleId } from "../../src/scope/shot";
import { chosenLoadout, loadCareer, loadChosen, persistent, resetAll, saveCareer, saveChosen } from "./store";

const RIFLE_IDS: RifleId[] = ["vss", "svd", "bolt"];
const RIFLE_NAMES: Record<RifleId, string> = { vss: "VSS", svd: "SVD", bolt: "Sako (bolt)" };
/** The scope lab's name for each rifle's reticle slot. */
const LAB_RETICLE: Record<RifleId, string> = { vss: "vss", svd: "pso", bolt: "tree" };
const OPTIC_NAMES = { pso1: "PSO-1", pso11: "PSO-1-1", acss: "ACSS-style", pr2: "PR2-MIL", ebr: "EBR-7D", tremor: "TReMoR3-style" } as const;
/** The stand-in results, until the mission reports one (the pay formula's R). */
const RESULTS = {
  killed: { factor: 1, label: "The spy, killed" },
  downed: { factor: 0.6, label: "The spy, down" },
  wounded: { factor: 0.2, label: "The spy, wounded and gone" },
  failed: { factor: 0, label: "Failed" },
} as const;
type ResultId = keyof typeof RESULTS;

const career = loadCareer();
let chosen = loadChosen(career.owned);
/**
 * The stand-in mission's report, until the mission reports one. `done`: when the job was done, in in-game minutes after
 * 19:00 (180 = the evening's end, no boost); `margin`: the share of the safety margin the shot used (0: a body hit).
 */
const contract = { result: "killed" as ResultId, done: 180, margin: 0, tried: false, confirmed: true, heard: 0 };
/** The dossier on offer: the next contract's, drawn from the career's count so it stays put until one is settled. */
const dossier = () => makeDossier({ seed: `contract-${career.contracts}`, streak: career.streak, brokered: career.brokered });
let settled: Settled | null = null;
/** What the stand-in mission used of the kit carried: unused kit is listed on the receipt. */
let touched = new Set<ItemId>();
let receipt: Receipt | null = null;
let filter: "fits" | "all" | "owned" = "fits";

const $ = (id: string) => document.getElementById(id)!;
const euro = (n: number) => `${n < 0 ? "−" : ""}€${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
/** A tiny element builder: tag, attributes and properties, children. */
type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], "style">> & { style?: string; class?: string };
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...kids: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = String(v);
    else if (k === "style") el.setAttribute("style", String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const k of kids) if (k !== null && k !== false) el.append(k);
  return el;
}

/** The balance counts to its new value instead of jumping (skipped for reduced motion). */
let shownBalance = career.balance;
let balanceAnim = 0;
function showBalance(): void {
  const el = $("balance");
  const to = career.balance;
  const from = shownBalance;
  cancelAnimationFrame(balanceAnim);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || from === to) {
    shownBalance = to;
    el.textContent = euro(to);
    return;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    const u = Math.min(1, (now - t0) / 600);
    const e = 1 - (1 - u) ** 3;
    shownBalance = from + (to - from) * e;
    el.textContent = euro(shownBalance);
    if (u < 1) balanceAnim = requestAnimationFrame(step);
  };
  balanceAnim = requestAnimationFrame(step);
}

const loadout = () => chosenLoadout(chosen);
function commit(): void {
  saveChosen(chosen);
  saveCareer(career);
  render();
}
/** Puts `id` in its slot on the chosen rifle, or empties `slot`; a can's sleeve goes with the can. */
function setSlot(slot: Slot, id: ItemId | null): void {
  const l = decodeKit(chosen.rifle, chosen.kits[chosen.rifle]);
  if (id) l.items[slot] = id;
  else delete l.items[slot];
  if (l.items.muzzleExtra && !carried(l).includes(ITEMS[l.items.muzzleExtra].needs!)) delete l.items.muzzleExtra;
  chosen.kits[chosen.rifle] = encodeKit(l);
  commit();
}

function renderLoadout(): void {
  const rf = chosen.rifle;
  $("rifles").replaceChildren(
    ...RIFLE_IDS.map((id) => {
      // The safety margin, in words only while it lasts (never a number, never on anything read before the shot).
      const hint = marginHint(career.margin, id);
      return h(
        "button",
        {
          class: id === rf ? "on" : "",
          onclick: () => {
            chosen.rifle = id;
            touched = new Set();
            commit();
          },
        },
        RIFLE_NAMES[id],
        hint ? h("span", { class: "muted", textContent: ` · ${hint}` }) : null,
      );
    }),
  );
  const iss = ISSUED[rf];
  $("issued").textContent = `Issued, free: ${OPTIC_NAMES[iss.optic]}, ${ROUNDS[iss.round].name}, ${iss.magazine} rounds, ${iss.muzzle.toLowerCase()}, ${iss.stock.toLowerCase()}, a rolled pack to rest it on.`;
  // What each slot holds when nothing is chosen for it: the rifle as issued.
  const issuedIn: Partial<Record<Slot, string>> = {
    front: "rolled pack",
    stock: iss.stock,
    magazine: `${iss.magazine} rounds`,
    muzzle: iss.muzzle,
    optic: OPTIC_NAMES[iss.optic],
    ammo: ROUNDS[iss.round].name,
  };
  const l = loadout();
  $("slots").replaceChildren(
    ...SLOTS.filter((slot) => ITEM_IDS.some((id) => ITEMS[id].slot === slot && fits(id, rf))).map((slot) => {
      const sel = h("select", { onchange: () => setSlot(slot, (sel.value || null) as ItemId | null) });
      sel.append(h("option", { value: "", textContent: `Issued (${issuedIn[slot] ?? "none"})` }));
      for (const id of ITEM_IDS.filter((x) => ITEMS[x].slot === slot && fits(x, rf))) {
        const it = ITEMS[id];
        const owned = career.owned.has(id);
        const needs = it.needs && !carried(l).includes(it.needs);
        sel.append(h("option", { value: id, textContent: `${it.name}${owned ? "" : ` (not owned, ${euro(it.price)})`}${needs ? ` (needs the ${ITEMS[it.needs!].name.toLowerCase()})` : ""}`, disabled: !owned || !!needs }));
      }
      sel.value = l.items[slot] ?? "";
      return h("label", { class: "slot" }, h("span", { class: "muted", textContent: SLOT_NAMES[slot] }), sel);
    }),
  );

  // Spotters: a tier, and beside the shooter or on another bearing of the treeline arc.
  const box = $("spotters");
  box.replaceChildren(
    ...chosen.spotters.map((s, i) => {
      const tier = h("select", {
        onchange: () => {
          s.tier = tier.value as typeof s.tier;
          commit();
        },
      });
      for (const t of SPOTTER_TIERS) tier.append(h("option", { value: t, textContent: `${t} · ${pct(SPOTTERS[t].share)} of the pay` }));
      tier.value = s.tier;
      const place = h("select", {
        onchange: () => {
          chosen.spotters[i] = place.value === "bearing" ? { tier: s.tier, place: "bearing", azDeg: 20 } : { tier: s.tier, place: "beside" };
          commit();
        },
      });
      place.append(h("option", { value: "beside", textContent: "beside you" }), h("option", { value: "bearing", textContent: "on another bearing" }));
      place.value = s.place;
      const num = (key: "azDeg", lo: number, hi: number, label: string) => {
        const inp = h("input", {
          type: "number",
          min: String(lo),
          max: String(hi),
          step: "1",
          value: String(s[key] ?? 0),
          style: "width: 4.5em",
          title: label,
          onchange: () => {
            const v = Number(inp.value);
            s[key] = Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : 0;
            commit();
          },
        });
        return h("span", {}, `${label} `, inp);
      };
      return h(
        "div",
        { class: "row" },
        tier,
        place,
        s.place === "bearing" ? num("azDeg", -PERCH_ARC_DEG, PERCH_ARC_DEG, "bearing °") : null,
        h("button", {
          textContent: "Release",
          onclick: () => {
            chosen.spotters.splice(i, 1);
            commit();
          },
        }),
      );
    }),
    h("button", {
      textContent: "Hire a spotter",
      disabled: chosen.spotters.length >= MAX_SPOTTERS,
      title: `At most ${MAX_SPOTTERS} on one radio net. Each takes a share of the pay, or ${euro(RETAINER)} if the contract fails.`,
      onclick: () => {
        chosen.spotters.push({ tier: "rookie", place: "beside" });
        commit();
      },
    }),
  );

  // What the loadout leaves of the dossier's fee, item by item (worn and called-for kit decays less), and the streak at stake.
  const d = dossier();
  const called = new Set(d.calledFor);
  const f = payFactor(l, called, career.uses);
  const preview = settleContract({ fee: d.baseFee, grade: d.grade, terms: d.terms, calledFor: d.calledFor }, RESULTS.killed, l, undefined, 0, career.uses);
  const stake =
    career.streak === 0
      ? "No streak at stake yet."
      : `A streak of ${career.streak} (${gradeFor(career.streak)}) at stake: ${career.fixer ? "the fixer covers one failure." : "one failure drops you to routine work."}`;
  $("pay").replaceChildren(
    h("div", {}, `This contract (${euro(d.fee)}), clean, pays `, h("b", { textContent: euro(preview.total) }), ` (×${f.toFixed(2)}); bare, ${euro(preview.gross)}`),
    h("div", { class: "muted", textContent: stake }),
    h("div", { class: "meter" }, h("i", { style: `width: ${(f * 100).toFixed(1)}%` })),
    h("div", { class: "lines muted" }, ...[...preview.kit, ...preview.spotters].map((x) => h("div", {}, h("span", { textContent: x.label }), h("span", { textContent: euro(x.amount) })))),
  );
  const problems = checkLoadout(l, career.owned);
  $("problems").textContent = problems.map((p) => p.why).join(" · ");
  const lab = $("lab") as HTMLAnchorElement;
  lab.href = `../reticle/?reticle=${LAB_RETICLE[rf]}&kit=${encodeURIComponent(encodeKit(l))}`;
}

function renderCatalogue(): void {
  const rf = chosen.rifle;
  $("filter").replaceChildren(
    ...(
      [
        ["fits", `Fits the ${RIFLE_NAMES[rf]}`],
        ["owned", "Owned"],
        ["all", "Everything"],
      ] as const
    ).map(([k, label]) =>
      h("button", {
        textContent: label,
        class: filter === k ? "on" : "",
        onclick: () => {
          filter = k;
          renderCatalogue();
        },
      }),
    ),
  );
  const shown = ITEM_IDS.filter((id) => (filter === "fits" ? fits(id, rf) : filter === "owned" ? career.owned.has(id) : true));
  $("catalogue").replaceChildren(
    ...(shown.length ? [] : [h("div", { class: "muted", textContent: "Nothing here yet." })]),
    ...SLOTS.flatMap((slot) => {
      const ids = shown.filter((id) => ITEMS[id].slot === slot);
      if (!ids.length) return [];
      return [
        h("h2", { textContent: SLOT_NAMES[slot], style: "margin-top: 12px" }),
        ...ids.map((id) => {
          const it = ITEMS[id];
          const d = it.decay[rf];
          const owned = career.owned.has(id);
          const can = career.canBuy(id);
          return h(
            "div",
            { class: "item" },
            h("div", { class: "row", style: "justify-content: space-between; margin: 0" }, h("b", { textContent: it.name }), h("span", { textContent: euro(it.price) })),
            h("div", { class: "muted", textContent: it.model }),
            h("div", {}, d === null ? h("span", { class: "muted", textContent: `Doesn't fit the ${RIFLE_NAMES[rf]}.` }) : `Takes ${pct(d)} of the pay on the ${RIFLE_NAMES[rf]}, every contract it is carried.`),
            h("div", { class: "good", textContent: `+ ${it.does}` }),
            h("div", { class: "bad", textContent: `− ${it.costs}` }),
            it.needs ? h("div", { class: "muted", textContent: `Needs the ${ITEMS[it.needs].name.toLowerCase()}.` }) : null,
            h(
              "div",
              { class: "row", style: "margin: 6px 0 0" },
              owned
                ? h("span", { class: "good", textContent: "Owned" })
                : h("button", {
                    textContent: `Buy · ${euro(it.price)}`,
                    disabled: !can.ok,
                    title: can.why ?? "",
                    onclick: () => {
                      career.buy(id);
                      commit();
                      showBalance();
                    },
                  }),
              owned && fits(id, rf) && loadout().items[it.slot] !== id ? h("button", { textContent: "Carry", onclick: () => setSlot(it.slot, id), disabled: !!it.needs && !carried(loadout()).includes(it.needs) }) : null,
              !owned && !can.ok ? h("span", { class: "muted", textContent: can.why ?? "" }) : null,
            ),
          );
        }),
      ];
    }),
  );
}

function renderDossier(): void {
  const d = dossier();
  const fc = d.forecast;
  const sunset = 19 * 60 + fc.sunsetMin;
  const broker = career.canBroker();
  const fix = career.canFix();
  $("dossier").replaceChildren(
    h("div", {}, h("b", { textContent: `${d.grade[0]!.toUpperCase()}${d.grade.slice(1)} grade` }), ` · a ${d.house} house, ${d.distanceM} m from the treeline · `, h("b", { textContent: euro(d.fee) })),
    h(
      "div",
      { class: "muted" },
      `Wind ${fc.windMs} m/s gusting ${fc.gustMs}; rain ${fc.rain}; fog ${fc.fog}; sunset ${Math.floor(sunset / 60)}:${String(sunset % 60).padStart(2, "0")}, ${fc.darkBy21} by 21:00. ` +
        `The treeline sees ${Math.round(d.treelineSees * 100)}% of the party floor${d.glassRoof ? "; a glass roof" : ""}.`,
    ),
    ...(d.terms.length ? d.terms.map((t) => h("div", {}, h("b", { textContent: `${TERMS[t].name} +${pct(TERMS[t].premium)}: ` }), `${TERMS[t].wants}. Helps: ${TERMS[t].helps}.`)) : [h("div", { class: "muted", textContent: "No client terms." })]),
    ...(d.calledFor.length ? [h("div", { class: "good", textContent: `Called for (half decay): ${d.calledFor.map((id) => ITEMS[id].name).join(", ")}` })] : []),
    h(
      "div",
      { class: "row", style: "margin-top: 6px" },
      h("button", {
        textContent: career.brokered ? "Bought from the broker" : `Broker: one grade up · ${euro(BROKER_PRICE)}`,
        disabled: !broker.ok,
        title: broker.why ?? "Paid now, lost if the contract fails.",
        onclick: () => {
          career.buyBroker();
          commit();
          showBalance();
        },
      }),
      h("button", {
        textContent: career.fixer ? "The fixer is held" : `Fixer: covers one failure · ${euro(FIXER_PRICE)}`,
        disabled: !fix.ok,
        title: fix.why ?? "The streak survives one failed contract.",
        onclick: () => {
          career.buyFixer();
          commit();
          showBalance();
        },
      }),
    ),
  );
}

function renderRecord(): void {
  const sm = serviceMark(career.contracts);
  const owned = [...career.owned];
  $("record").replaceChildren(
    h("div", {}, `${career.contracts} contracts${sm.mark ? ` · service mark ${sm.mark}` : ""}${sm.title ? ` · ${sm.title}` : ""} · streak ${career.streak}`),
    ...MEDAL_IDS.map((id) => {
      const n = career.medals[id];
      const m = medalMaterial(id, n);
      return h("div", { class: m ? "" : "muted" }, h("b", { textContent: MEDALS[id].name }), ` · ${m ?? "not yet"} (${n}) · ${MEDALS[id].earnedBy}`);
    }),
    ...(owned.length ? [h("h2", { textContent: "Wear and finishes", style: "margin-top: 10px" })] : []),
    ...owned.map((id) => {
      const finish = h("select", {
        onchange: () => {
          if (!finish.value) return;
          try {
            career.buyFinish(id, finish.value as FinishId);
            commit();
            showBalance();
          } catch (e) {
            finish.title = (e as Error).message;
          }
        },
      });
      finish.append(h("option", { value: "", textContent: career.finishes[id] ? FINISHES[career.finishes[id]!].name : "Finish…" }));
      for (const [k, v] of Object.entries(FINISHES)) finish.append(h("option", { value: k, textContent: `${v.name} · ${euro(v.price)}` }));
      const uses = career.uses[id] ?? 0;
      return h("div", { class: "row", style: "margin: 2px 0" }, h("span", { textContent: `${ITEMS[id].name}: ${uses} uses${wearLook(id, uses) ? `, ${wearLook(id, uses)!.toLowerCase()}` : ""}` }), finish);
    }),
  );
}

function renderContract(): void {
  const l = loadout();
  const margin = h("select", {
    onchange: () => {
      contract.margin = Number(margin.value);
    },
  });
  for (const [v, label] of [
    [0, "a body hit"],
    [0.25, "a near miss, a quarter of the margin"],
    [0.5, "a near miss, half the margin"],
    [1, "a near miss, all the margin"],
  ] as const)
    margin.append(h("option", { value: String(v), textContent: label }));
  margin.value = String(contract.margin);
  const check = (key: "tried" | "confirmed", label: string) => {
    const box = h("input", {
      type: "checkbox",
      checked: contract[key],
      onchange: () => {
        contract[key] = box.checked;
      },
    });
    return h("label", { class: "row", style: "margin: 2px 0" }, box, label);
  };
  const heard = h("input", {
    type: "number",
    min: "0",
    max: "40",
    step: "1",
    value: String(contract.heard),
    style: "width: 4em",
    onchange: () => {
      const v = Number(heard.value);
      contract.heard = Number.isFinite(v) ? Math.max(0, Math.min(40, Math.round(v))) : 0;
    },
  });
  const result = h("select", {
    onchange: () => {
      contract.result = result.value as ResultId;
    },
  });
  for (const [k, r] of Object.entries(RESULTS)) result.append(h("option", { value: k, textContent: `${r.label} (×${r.factor})` }));
  result.value = contract.result;
  const done = h("select", {
    onchange: () => {
      contract.done = Number(done.value);
    },
  });
  for (let m = 15; m <= 180; m += 15) {
    const clock = `${19 + Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
    done.append(h("option", { value: String(m), textContent: m === 180 ? `${clock} (the evening's end)` : `${clock} (+${Math.round(earlyBoost(m * 60) * 100)}%)` }));
  }
  done.value = String(contract.done);
  const items = carried(l);
  const problems = checkLoadout(l, career.owned);
  $("contract").replaceChildren(
    h("div", { class: "row" }, "Result ", result),
    h("div", { class: "row" }, "The shot ", margin),
    h("div", { class: "row" }, "Done at ", done),
    h("div", { class: "row" }, "Guests who heard ", heard),
    check("tried", "The spy had tried its goal"),
    check("confirmed", "The body was seen to fall and stay down"),
    ...(items.length ? [h("div", { class: "muted", textContent: "What you used of the kit:" })] : []),
    ...items.map((id) => {
      const box = h("input", {
        type: "checkbox",
        checked: touched.has(id),
        onchange: () => {
          if (box.checked) touched.add(id);
          else touched.delete(id);
        },
      });
      return h("label", { class: "row", style: "margin: 2px 0" }, box, ITEMS[id].name);
    }),
    h("div", { class: "row", style: "margin-top: 8px" }, h("button", { textContent: "Settle the contract", disabled: problems.length > 0, title: problems.map((p) => p.why).join("; "), onclick: settle })),
  );
  renderReceipt();
  $("history").replaceChildren(
    ...(career.history.length ? [] : [h("div", { class: "muted", textContent: "None yet." })]),
    ...career.history.slice(0, 12).map((r) => h("div", { class: "row", style: "justify-content: space-between; margin: 0" }, h("span", { textContent: `${r.result}` }), h("span", { class: r.total < 0 ? "bad" : "", textContent: euro(r.total) }))),
  );
}

/** The stand-in mission as a report: one shot at the spy, ending it as chosen. */
function standInReport(): MissionReport {
  const l = loadout();
  const d = dossier();
  const r = RESULTS[contract.result];
  const failed = contract.result === "failed";
  const kind = failed ? "miss" : contract.margin > 0 ? "margin" : "hit";
  // A margin hit's miss, from the margin the career has now, at the dossier's distance: what the receipt turns into centimetres.
  const missMrad = kind === "margin" ? contract.margin * effectiveMargin(career.margin, l.rifle) : 0;
  const shot: ShotReport = {
    t: contract.done * 60,
    at: "spy",
    kind,
    ...(failed ? {} : { outcome: contract.result as Exclude<ResultId, "failed"> }),
    marginUsed: kind === "margin" ? contract.margin : 0,
    fromChestMrad: kind === "hit" ? 0.3 : 1.6 + missMrad,
    missMrad: kind === "miss" ? 2 : missMrad,
    rangeM: d.distanceM + 15,
    sinceScopeInS: 20,
    elevationDeg: 0,
    throughGlass: false,
    windMs: d.forecast.windMs,
    heardBy: contract.heard,
  };
  return {
    contract: { fee: d.baseFee, terms: d.terms, grade: d.grade, house: d.house, label: `Stand-in, ${RIFLE_NAMES[l.rifle]}`, calledFor: d.calledFor },
    loadout: l,
    shots: [shot],
    result: { outcome: failed ? "failed" : (contract.result as Exclude<ResultId, "failed">), factor: r.factor },
    usedItems: [...touched],
    spyTriedGoal: contract.tried,
    confirmedDown: contract.confirmed,
    endedAt: new Date().toISOString(),
    doneAt: contract.done * 60,
  };
}

function settle(): void {
  settled = career.settleReport(standInReport());
  receipt = settled.receipt;
  touched = new Set();
  commit();
  showBalance();
}

function renderReceipt(): void {
  const box = $("receipt");
  if (!receipt) {
    box.replaceChildren();
    return;
  }
  const r = receipt;
  const line = (label: string, amount: number, cls = "", i = 0) => h("div", { class: cls, style: `animation-delay: ${i * 60}ms` }, h("span", { textContent: label }), h("span", { textContent: euro(amount) }));
  let i = 0;
  box.replaceChildren(
    h("h2", { textContent: "Receipt", style: "margin-top: 14px" }),
    ...(r.feeLines ?? []).map((x) => line(x.label, x.amount, "muted", i++)),
    line(`${r.contract}: ${r.result}`, r.gross, "", i++),
    ...(r.early ? [line(r.early.label, r.early.amount, "", i++)] : []),
    ...(r.margin ? [line(r.margin.label, r.margin.amount, "", i++)] : []),
    ...r.kit.map((x) => line(x.label, x.amount, "muted", i++)),
    ...r.spotters.map((x) => line(x.label, x.amount, "muted", i++)),
    line("Paid in", r.total, "total", i++),
    ...(r.bare !== undefined ? [line("Bare, the same shot would have paid", r.bare, "muted", i++)] : []),
    ...(settled && settled.receipt === r
      ? [
          h("div", {
            style: `animation-delay: ${i * 60}ms; display: block`,
            textContent:
              { clean: "Clean: the streak grows", margin: "A margin hit: the streak holds", broken: "The streak is broken", saved: "The fixer covered it: the streak holds" }[settled.run] +
              ` (${settled.streak}, ${settled.grade}).` +
              settled.medals.map((m) => ` ${MEDALS[m.id].name}, in ${m.material}.`).join("") +
              (settled.serviceMark ? ` Service mark: ${settled.serviceMark.mark} contracts${settled.serviceMark.title ? `, ${settled.serviceMark.title}` : ""}.` : ""),
          }),
        ]
      : []),
    ...(r.unused.length ? [h("div", { class: "muted", style: `animation-delay: ${i * 60}ms; display: block; margin-top: 6px`, textContent: "Carried and never used:" }), ...r.unused.map((x) => line(x.label, x.amount, "bad", ++i))] : []),
  );
}

function render(): void {
  renderLoadout();
  renderCatalogue();
  renderDossier();
  renderContract();
  renderRecord();
  $("storage").textContent = persistent ? "" : "Not saved between visits: this browser blocks storage.";
}

$("reset").onclick = () => {
  if (!confirm("Forget the career and start again?")) return;
  resetAll();
  location.reload();
};

render();
$("balance").textContent = euro(career.balance);
