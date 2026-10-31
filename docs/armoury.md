# The armoury

Money from contracts buys kit, kit makes the shot easier, and each item carried costs a share of the pay. Missions are not progressive, so the trade is made fresh before every contract: what is this shot worth carrying? The design, the research behind each item and the open questions are in the planning document; this page is how the code does it.

## Modules

| File | What it is |
| --- | --- |
| `src/armoury/catalogue.ts` | The items as data: slot, price (street price × 4, in euros), decay on each rifle it fits (`null` where it doesn't), what it does and costs, and its `effects` for the rig. Also what each rifle comes with (`ISSUED`), the spotters' tiers, the opening balance (€6,000) and the retainer (€400). |
| `src/armoury/loadout.ts` | A loadout: the rifle, at most one item a slot, up to two spotters. `checkLoadout` says what is wrong with one (wrong rifle or slot, not owned, a sleeve without its can, too many spotters). `payFactor` is the pay meter. `encodeKit`/`decodeKit` turn the kit into `kit=atlas,bag,kilo` and back, forgivingly. |
| `src/armoury/career.ts` | The career: balance, kit owned for good, receipts, and (version 2) counters that outlive the last 50 receipts: contracts, the streak, clean contracts in a row, medals, each item's uses and the safety margin. `settleContract` turns a contract, its result and the loadout into a receipt whose lines add up; `Career.fromJSON` checks whatever comes back from storage. |
| `src/armoury/report.ts` | What a contract reports: `ShotReport` per round and `MissionReport` for the job (tasks 10 and 11 read them; the joined mission, a test or the kit sweep fills them in). Also the grades and client terms. |
| `src/armoury/margin.ts` | The new player's safety margin (task 11): `judgeShot`, `afterContract`, the receipt's words and the armoury's hint. Pure; matches `scripts/margin-sim.ts` on the same seeds. |
| `src/armoury/dossier.ts` | The dossier before a contract (task 10): the forecast, the house, how much of the party floor the treeline sees, the grade from the streak and the client terms, each with its premium and the kit it calls for. `judgeTerms` reads a finished mission against them. |
| `src/armoury/record.ts` | The service record (medals and their thresholds and materials, service marks and titles) and wear. |
| `src/armoury/rig.ts` | `rigFor(loadout)`: the loadout made into what the simulation reads: the rifle as loaded (round, precision, magazine, barrel, muzzle dust), its recoil, hold, rest and stock fit, the report, the aids, the optic and the hide. With nothing carried it is the issued rifle on its pack; `rigFor(l, { lab: true })` keeps the scope lab's own bipod hold. |
| `src/scope/hold.ts` | The hold by rest (breathing, wander, heartbeat, tremor, wind buffet ∝ ½ρv²) and `RestDynamics`, how the rifle swings on its rest. |
| `src/scope/can.ts` | A suppressor's heat, its cold first shot and first-round pop, and its shimmer. |
| `src/scope/cards.ts` | Load cards, come-ups and the grid's wind-dot values for the load in the rifle. |
| `demo/armoury/` | The armoury page (functional, not yet styled) and `store.ts`, which keeps the career and the chosen loadout in localStorage. |

## Pay

pay = fee × G × (1 + Σ premiums) × R × E × M × Π(1 − decayᵢ) × (1 − Σ sharesⱼ)

Worked in that order: the fee with the grade's multiplier G and the client terms' premiums, then the result, then the early-finish boost, then the safety margin's factor M, then kit decay, then the spotters' shares. G is the broker's grade (routine ×1, priority ×1.2, critical ×1.35, named ×1.5) and the premiums are the client terms' (a term not met pays none); a Quiet job then loses 10% of the fee for each guest who heard, at most half. Kit decays at half rate when the dossier calls for it, and a tenth less at each of 10, 30 and 75 uses (wear). The receipt itemises the fee and says what the same result would have paid with nothing carried. M = 1 − k·u (k 0.35), u the largest share of the safety margin used among the contract's margin hits at the spy; 1 for a clean hit.

R is the contract's result (1 killed, 0.6 down, 0.2 wounded and gone, 0 failed; the mission will report it). E is the early-finish boost, a softened 1/x: with f the share of the evening left, `E = 1 + EARLY_MAX × f / (1 + EARLY_BEND × (1 − f))` (`earlyBoost` in career.ts; `EARLY_MAX` = 0.5 and `EARLY_BEND` = 1.5 in the catalogue, where a bend of 0 is a straight line). On the 19:00–22:00 party: done at 21:30 +4%, 21:00 +8%, 20:30 +14%, 20:00 +22%, 19:30 +33%, 19:00 +50%. Done at the end it pays as before, and it never takes anything off. The mission reports when the job was done as `doneAt` on the result (in-game seconds after the evening started); left out, there is no boost. Kit and spotters come off the boosted pay, and the receipt shows the boost on its own line. Items the dossier calls for decay at half rate. A failed contract pays nothing and still owes each spotter the retainer. The receipt shares the kit's cost between the items by ln(1 − decay), which is fair whatever the order and sums exactly, and lists what was carried and never used.

## The safety margin (task 11)

An invisible zone round the spy's torso, in mrad, that counts a near miss on the spy (only the spy) as a hit. Its size is a career part (starts at 1.1 mrad) plus the rifle's part (0.4 each): 1.5 mrad on a first contract, 27 cm at 183 m.

- `judgeShot({ missMrad, fromChestMrad, rangeM }, margin, rng)`: a body hit uses none of it; a miss within it is a margin hit using u = miss ÷ margin, whose outcome is drawn (killed 1 − 0.6u, downed 0.45u, wounded 0.15u) and whose pay factor is 1 − 0.35u; beyond it, a miss. Quality q = 1 − (angle from the chest centre) ÷ (the chest's half-width, 0.2 m, as an angle, + the margin), 0 for a miss.
- `afterContract(state, rifle, firstShotAtSpy, endedAt)`, only from the contract's first shot at the spy, in order: (a) a break gives back 5% of each part's start per full 14 days, at most 15% (every rifle's part too); (b) the 2nd miss in a row gives back 10% of the career part's start and each further one 5%, never above half its start by this route; (c) M ← M·(1 − 0.3q) − 0.02·M₀; (d) clamp to [0, M₀]; (e) under 0.05 mrad it is gone. With no shot at the spy the margin is left as it was. The clock is never read: the end date is passed in.
- It lasts about 12 contracts for a quick learner, 16 for a typical player, 31 for one who isn't improving (`npx tsx scripts/margin-sim.ts`; `tests/margin.test.ts` checks margin.ts against the simulation contract by contract).
- The player never sees it before the shot. The receipt says what happened after it ("Counted as a hit: 14 cm wide of him, half the margin used, pay ×0.82"), and each rifle on the armoury page says in words while it lasts: Forgiving (above two-thirds of 1.5 mrad), Steadying (above a fifth), Almost on your own (below), nothing once it is gone.
- The hit test that fills `ShotReport.kind`, `missMrad` and `fromChestMrad` (closest approach to the torso, the cover check, the redirect) and the training switch belong to the scope lab.

## Reasons to come back (task 10)

`Career.settleReport(report)` settles a whole `MissionReport`: the terms, the pay, then the streak, the medals, wear and the safety margin.

- **The streak.** Clean (the spy killed or downed, no margin used) adds one; a margin contract holds it; anything else breaks it to 0, unless the fixer is held (€5,000, one at a time), who saves the streak once. `cleanInRow` counts the same run for Unbroken but the fixer doesn't save it. The grade comes from the streak: routine 0–2, priority 3–5, critical 6–9, named 10 and up. The broker sells the next contract one grade up (€2,000 up front, lost on a failure).
- **Client terms.** Quiet job +30% (10% off per guest who heard, at most 50%; the report has per-shot counts, so the loudest shot's is used), Through the glass +20%, One round +40% (a miss or a non-fatal first shot fails the job), Storm +25% (only in a forecast gale), Blind house +20% (only for a glass-roofed house whose treeline sees under a quarter of the floor), Before the deed +30% and Confirmed +10% (premium lost if not met). Up to two a contract.
- **Medals**, counted in the career, never from the history: Clean Hands (a kill carrying only issued kit, no margin), Unbroken (the best run of clean contracts), First Look (the spy down before it tried its goal), Gale (a kill in wind over 8 m/s), One Breath (a hit within 3 s of scoping in, no margin), Every Rifle (a kill with each rifle in each house size). Glass Roof, Nobody Heard, Second Bearing and Called Shot have their counters and thresholds and light up when tasks 9, 8 and 7 report what they need. Each is re-struck at its thresholds in tin, bronze, silver, gold, enamelled gold and platinum. Service marks at 10, 25, 50, 100, 250, 500 and 1,000 contracts, with a title at 100 and 1,000.
- **Wear and finishes.** Each contract an item is carried and used counts a use. A finish (a refinish, matt black, FDE, camouflage) changes nothing in the simulation and keeps the item's uses.
- **The fee** is the house's (€5,000 / 6,000 / 7,500, small / grand / palatial) in proportion to the shot's distance against 170 m (`baseFee`), so a longer shot pays more and the pay follows when the ranges change. The broker's and fixer's prices and the finishes' are placeholders.
- **The kit sweep** (`npx tsx scripts/kit-sweep.ts`, about 3 minutes) fires a headless shooter (novice and expert) at the spy's chest from 135–235 m with the real ballistics, the rig's hold and the wound model, and checks the user's rules: with no streak at stake an expert earns most bare; a novice with a streak of two or more earns more with a rest, bag and rangefinder; and the whole catalogue takes 10–12 contracts at a typical pay (10.1 now). Re-run it whenever ranges, fees, prices or decays change. The Sako's rests, bag and rangefinders decay less than the others' (3%, 2.5%, 3%, 6%), since at these ranges the Sako needs them least.

## The career's storage

The armoury page keeps the career under `scope-and-drop.career.v1` whatever its version; `Career.fromJSON` switches on the stored `v`. Version 2 adds `contracts`, `streak`, `cleanInRow`, `medals`, `uses`, `margin` (`{ career, rifle, missesInRow, lastContractAt }`, mrad), `kills` (by rifle and house size), `brokered`, `fixer` and `finishes`; a version 2 save from before the last four reads them at their defaults. A version 1 save is upgraded (counters at 0, `contracts` the receipts kept, the margin at its starting sizes); any other version starts fresh. Medals and service marks count in these counters, never by scanning the history, which keeps only 50 receipts.

## The lab

`/reticle/?kit=atlas,bag,can,sleeve` puts a loadout on whichever rifle is up; what doesn't fit it stays behind. The lab then reads everything from the rig: section 12 of [reticle-demo.md](reticle-demo.md#12-the-kit-srcarmoury-srcscopeholdts) lists what each item does there. The armoury page links to the lab with the loadout chosen.

## The truth rule

Whatever a card, an etched mark, a device or a spotter's arithmetic gives the shooter must be right for the load in the magazine. The rifle is zeroed for its load at 100 m; a range drum's other marks stay cut for the issued round, and a reticle cut for another load gets a load card. `tests/aids-truth.test.ts` flies every card, mark and device for every load the rifles take and checks that each puts the bullet on the aim point to a centimetre (before the card's own rounding).

## Tests

`tests/armoury.test.ts` (catalogue, loadouts, pay, career, rig), `tests/hold.test.ts`, `tests/kit-lab.test.ts`, `tests/can.test.ts`, `tests/devices.test.ts` (KILO profiles, the plain rangefinder, the Kestrel's hold), `tests/new-rounds.test.ts` (expanding loads, the new loads through glass), `tests/aids-truth.test.ts` and `tests/armoury-store.test.ts`.

## Not built yet

- The mission's own result and the dossier's called-for kit, feeding `Career.settle`.
- Spotters in the field: their calls by radio, their delays and errors by tier, observers on other bearings.
- The armoury's look (the page is functional only), and medals and milestones from the planning document.
