# The armoury

Money from contracts buys kit, kit makes the shot easier, and each item carried costs a share of the pay. Missions are not progressive, so the trade is made fresh before every contract: what is this shot worth carrying? The design, the research behind each item and the open questions are in the planning document; this page is how the code does it.

## Modules

| File | What it is |
| --- | --- |
| `src/armoury/catalogue.ts` | The items as data: slot, price (street price × 4, in euros), decay on each rifle it fits (`null` where it doesn't), what it does and costs, and its `effects` for the rig. Also what each rifle comes with (`ISSUED`), the spotters' tiers, the opening balance (€6,000) and the retainer (€400). |
| `src/armoury/loadout.ts` | A loadout: the rifle, at most one item a slot, up to two spotters. `checkLoadout` says what is wrong with one (wrong rifle or slot, not owned, a sleeve without its can, too many spotters). `payFactor` is the pay meter. `encodeKit`/`decodeKit` turn the kit into `kit=atlas,bag,kilo` and back, forgivingly. |
| `src/armoury/career.ts` | The career: balance, kit owned for good, receipts. `settleContract` turns a contract, its result and the loadout into a receipt whose lines add up; `Career.fromJSON` checks whatever comes back from storage. |
| `src/armoury/rig.ts` | `rigFor(loadout)`: the loadout made into what the simulation reads: the rifle as loaded (round, precision, magazine, barrel, muzzle dust), its recoil, hold, rest and stock fit, the report, the aids, the optic and the hide. With nothing carried it is the issued rifle on its pack; `rigFor(l, { lab: true })` keeps the scope lab's own bipod hold. |
| `src/scope/hold.ts` | The hold by rest (breathing, wander, heartbeat, tremor, wind buffet ∝ ½ρv²) and `RestDynamics`, how the rifle swings on its rest. |
| `src/scope/can.ts` | A suppressor's heat, its cold first shot and first-round pop, and its shimmer. |
| `src/scope/cards.ts` | Load cards, come-ups and the grid's wind-dot values for the load in the rifle. |
| `demo/armoury/` | The armoury page (functional, not yet styled) and `store.ts`, which keeps the career and the chosen loadout in localStorage. |

## Pay

pay = fee × R × E × Π(1 − decayᵢ) × (1 − Σ sharesⱼ)

R is the contract's result (1 killed, 0.6 down, 0.2 wounded and gone, 0 failed; the mission will report it). E is the early-finish boost, a softened 1/x: with f the share of the evening left, `E = 1 + EARLY_MAX × f / (1 + EARLY_BEND × (1 − f))` (`earlyBoost` in career.ts; `EARLY_MAX` = 0.5 and `EARLY_BEND` = 1.5 in the catalogue, where a bend of 0 is a straight line). On the 19:00–22:00 party: done at 21:30 +4%, 21:00 +8%, 20:30 +14%, 20:00 +22%, 19:30 +33%, 19:00 +50%. Done at the end it pays as before, and it never takes anything off. The mission reports when the job was done as `doneAt` on the result (in-game seconds after the evening started); left out, there is no boost. Kit and spotters come off the boosted pay, and the receipt shows the boost on its own line. Items the dossier calls for decay at half rate. A failed contract pays nothing and still owes each spotter the retainer. The receipt shares the kit's cost between the items by ln(1 − decay), which is fair whatever the order and sums exactly, and lists what was carried and never used.

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
