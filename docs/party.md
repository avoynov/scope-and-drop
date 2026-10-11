# The party

`src/party/` plays one evening at a generated mansion: 20–30 guests, the staff and a host, through a fixed programme from 19:00 to 22:00. It is milestone 1 (party core) of the design spec, [Guests and the Spy](https://claude.ai/code/artifact/e2c50e9e-e5fd-40d7-ba1f-e5b112831f52), plus the first part of milestone 2, Things: doors that lock, curtains, light switches, glasses and coats, bathrooms with a queue, six drinks and tipsiness ([milestone 2 plan](https://claude.ai/code/artifact/51e90a8d-8fe8-46ef-bbf4-b123ab4e2ebe), [technical plan](https://claude.ai/code/artifact/4a53e787-fa10-481d-a66b-d0db163eca77)). Minds that notice, everyday life, friendships and rows come in the next parts; the spy, gossip, mishaps and the endings after that.

![party lab, plan view](images/party-plan.jpg)

```ts
import { generateMansion } from './src/mansion';
import { Party } from './src/party';

const party = new Party(generateMansion({ seed: 'gala-night' }));
party.advance(95 * 60);          // to 20:35
party.people[7].action?.id;      // 'dinner'
party.visibility(party.people[7]); // 0..1, from the perch visibility grid and the curtains as they are now
party.people[7].drinkLog;        // [{ drink: 'champagne', t: 1312 }, { drink: 'red', t: 3020 }, …]
party.world.doors[3].locked;     // doors, curtains, lights and items
party.body.stats;                // bathroom, bar and bump counts
```

The same blueprint and seed always give the same evening. Everything is plain data, so a run can be stepped headless, hashed (`party.digest()`) and replayed.

## Time

The party is 3 in-game hours played in 1 real hour (`TIME_SCALE = 3`). Only the clock is compressed: people walk at real speed, so a sim step of `dt` in-game seconds moves them `dt / 3` seconds' worth of distance. The sim steps every 0.5 in-game seconds, six times a real second at 1×.

| Phase | Nominal start | Length (min) |
|---|---|---|
| Arrival | 19:00 | 15 |
| Mingling | 19:15 | 15 |
| Champagne | 19:30 | 6 |
| Toast | 19:36 | 6 |
| Mingling | 19:42 | 18 |
| Dinner | 20:00 | 40 |
| Dancing | 20:40 | 30 |
| Evening games | 21:10 | 25 |
| Mingling | 21:35 | 10 |
| Last toasts and departures | 21:45 | 15 |

Each boundary moves by up to 3 minutes per seed (less around the short champagne and toast). Each person also notices a new phase 20–150 s late, so the room never moves as one.

## How a guest decides

Guests run a needs-based utility AI, in the style of The Sims. Nine needs run down over the evening at rates set by each guest's traits: thirst, hunger, bladder, social, dance, rest, air, curiosity, and being near one's partner. When a guest is free, they list what they could do now (join or start a conversation, get a drink, the bathroom, sit, look at the art, go out on the terrace, dance, play a game, wander, toast, dine, leave) and score each one:

```
score = phase weight × need term × personal modifier × distance penalty × jitter
```

The best option of each kind competes, then the choice is a weighted draw among the top five (weight = score²). The phase weights carry the programme: during the toast the only other option is a trip to the bathroom, at a small weight, and dinner works the same way. An action ends after its duration and refills the needs it serves.

The house is read once into places (`places.ts`): the entrance, the party rooms, the toast spot in the ballroom or dome hall, dining chairs (head of the table first), buffet spots, a grid on the dance floor, the bars, bathrooms with a door spot and an inside spot, sofas and armchairs, the art, the game tables (billiards, cards, piano, cinema), the terrace and the kitchen.

Rules on top of the scores:

- Bathrooms have doors and a queue (see below). A guest skips one they saw shut in the last 3 minutes unless it can't wait.
- Spots, seats and conversation slots are reserved, so nobody stands inside anyone else.
- Couples dance together and sit together at dinner; the host and their partner head the table. Guests the dining room can't seat sit down to supper on the ballroom's sofas and chairs, couples side by side, and the rest eat standing at the buffet.
- Champagne for the toast comes from the nearest waiter with a tray, or from the bar. Someone who never drinks champagne raises whatever they have.
- A trip to the bathroom is seen through a change of phase once the person is inside or in the line; one still on the way gives way to the programme like anything else.
- In the last 20 minutes only an urgent bathroom trip starts (the bathroom may be two floors up at the far end), and departures are forced from just past the middle of the farewell, so everyone has left by 22:00.

## Staff and the host

The host greets at the door through the arrival, announces each phase, leads the toasts, heads the table and sees the guests off. Waiters (2–3) load a tray of 6–8 glasses of one drink at the bar or kitchen (champagne before the toast, red or white at dinner, a mix after) and make four stops in the party rooms (the dining room at dinner). At each stop they offer a glass every few seconds to guests within 2.5 m whose hands are empty (more often when they're thirsty, never a drink they don't touch) and take empties onto the tray; an empty tray ends the stop. When champagne is called every waiter fetches a full tray of 10–12 flutes from the nearest bar or kitchen, and through the champagne and the toast they hop from one empty-handed guest to the next. The bartender stays at the bar and the cook in the kitchen.

## Things in the house

`world.ts` holds the house's moving parts, worked out from the blueprint inside `src/party` (the blueprint and the mansion generator are unchanged).

- **Doors.** One per interior door or double door between two rooms. Each owns the walk-grid cells inside its wall, at least one cell deep, so every route through the doorway crosses them. A door is open, ajar or shut (eased over 1.5 in-game s, half a real second) and locks one of two ways: a bolt drawn from inside, or a key.

  | Door | Starts | Lock |
  |---|---|---|
  | Bathroom | ajar while free | bolt, shut and drawn while in use |
  | Guest bedroom (1–2, nearest the stairs; 2 when there is no cloakroom) | shut, closes behind you | bolt, key left inside |
  | Family bedroom, study | shut and locked | key: the host's ring |
  | Pantry | open | key: the staff ring |
  | Everything else | open | none |

  A bolt opens for whoever drew it and for anyone on its side. Keys are a ring per person (none, staff or host) and at most one lent key.
- **Routes through doors.** A* asks the doors as it expands: a locked door is a wall to anyone who can't open it, a shut one costs a little (about 1.5 s of walking) and a door into a private room costs a lot unless the trip starts or ends there, so nobody cuts through a bathroom or a bedroom. String pulling keeps to the doorways the search used. A route to a room the room graph says is shut off fails at once, without a search. Routes are cached (256, least recently used first) and each reuse checks that the doors it crosses still open for the walker.
- **On the way.** A walker looks 0.6 m ahead: a shut door is pushed open and they wait while it swings; a locked one sends them another way. Bedroom, study and guest-bedroom doors swing shut behind them. Walkers also give way: someone in a lane a metre or so ahead sends them sideways, more the closer they are, so fewer people walk into each other.
- **Curtains.** Every glazed, unfrosted exterior window with curtains, open, sheer or drawn as the blueprint has them. Those of bedrooms, dressing rooms, sitting rooms, the study and the cinema can be moved. `party.visibility(p)` reads them: drawing a room's curtains dims the baked perch view in proportion (drawn lets nothing through, sheer about half), and opening ones the bake had drawn traces that room afresh, once.
- **Lights.** A switch per room, just inside its main door, and an on or off state per room (off leaves 8% from the rooms next door). Bathrooms dark at the start light up while in use.
- **Items.** A table of things with an owner, a holder or a resting place, and a state: glasses (full, empty, set down, cleared), trays, the good whisky, the first-aid kit, coats (hung at arrival in the cloakroom or on a guest bed, worn home), bags, spectacles. What a person holds is an item; `held` is how it looks.

## Bathrooms, drinks and tipsiness

`body.ts` runs what happens to people's bodies.

- **Bathrooms.** A guest walks to the place outside the door. If the bathroom is free they go in; once they're in the room the door shuts and bolts (when nobody else is in there) and the light comes on if it was dark. Otherwise they say so if they didn't know, remember it, and either queue (up to two, along the wall beside the door, when it's urgent or there's nowhere else to try) or go back to choosing. The one at the front knocks after a minute and whoever is inside hurries; a queuer gives up after 2–4 minutes. As a stand-in for sight until the next part, anyone in a room the door shows in, within 12 m, reads whether it is shut, remembers it for 3 minutes, and turns back if it is the bathroom they were heading for and they can wait.
- **Drinks.** Six: champagne, red wine, white wine, beer, whisky and water. Each guest has a favourite and about 1 in 5 has one they never touch, most often red wine or beer. The bar pours in turn, 8–15 s a glass, slower with no bartender behind it; people wait their turn. A glass empties over its drink's life (champagne 25 in-game minutes, wine and beer 15, whisky 12, water 10) and is set down on the nearest table within 5 m when it is empty or the hands are needed (dancing, games, the bathroom, dinner, leaving). Everyone keeps a log of up to 24 drinks.
- **Tipsiness.** 0 to 1. Each alcoholic drink adds 0.12–0.2, less for a heavier build, taken in as the glass is sipped; it fades by 0.05 an in-game hour. It raises the bladder's pace (by up to 0.009 a minute) and the urge to dance (by up to 0.025), sets off the dances-after-drink habit, and above 0.6 makes people walk 10% slower and sway. Someone well over the edge is offered nothing but water.
- **Bumps.** Two people overlapping by more than 8 cm while closing faster than 0.6 m/s (a little wider for someone swaying) walked into each other: logged once per pair per 10 s, with a glass more than a fifth full slopping a little at 25% (more when tipsy). They are only counted for now; rows come in a later part.

## Behaviour that names a place

Some behaviour needs a kind of room the house may not have. `places.ts` resolves each one at construction down a chain of fallbacks and records which link it used (`party.places.chains`), so nothing depends on a room that isn't there:

| Chain | Links, first that exists |
|---|---|
| `coats` | cloakroom, the bed in a guest bedroom, the hall console, the entrance |
| `spirits` (the good whisky) | pantry cabinet, kitchen cabinet, the bar, the kitchen |
| `lockAway` | bathrooms and guest bedrooms |
| `proposal` | conservatory, the fountain, the terrace |
| `film` | cinema, or none tonight |
| `act` | theatre, the ballroom's music corner, the ballroom |
| `cards` | card room, a card table elsewhere, the dining table |
| `billiards` | billiard room, or none tonight |
| `lateDance` | disco, the ballroom floor |
| `water` | spa pool, the fountain, or none tonight |
| `note` | morning-room desk, library reading table, a desk or side table in a party room, the ballroom |
| `photo` | foot of the grand stair, the ballroom |
| `dinner` | dining chairs, ballroom supper seats, the buffet |

The census of 36 houses (in the milestone 2 plan) is what the chains were built against; a test resolves them on 12 houses of every size.

## Walking

A* runs on the mansion's walk grid (0.25 m cells, 8 neighbours, no cutting corners), and the path is string-pulled to a few waypoints with an exact grid traversal, so a straight leg never crosses a blocked cell. Stairs join the storeys; a route crosses one storey at a time through the stair with the shortest detour. Doors gate it all (see Things in the house). People push apart to 0.42 m, never into a doorway that is locked against them, and anyone pushed off their line finds a new route from where they stand.

## People on screen

`render/crowd.ts` draws everyone as simple jointed figures, one `InstancedMesh` per body part (thighs, shins, skirt, torso, shirt front, head, hair, arms, a glass, a tray, a hat, glasses, a cane). The mansion's scoped room lights reach them through a per-person `aScope`. Poses come from the sim (walk, climb, sit, talk with the group's speaker gesturing, drink, toast, dance, play, serve, smoke, greet, announce, look, knock), and habits show while standing about (scratching an ear, checking a watch, hands in pockets, a big laugh). A glass shows the colour of its drink, and someone past 0.6 tipsiness lists slowly from side to side.

`render/fixtures.ts` draws what moves in the house: door leaves on their hinges (two for a double door) and the drapes and sheers of the windows people can draw, four instanced meshes in all. The mansion builder leaves those out of its baked mesh when asked (`buildMansion(bp, { dynamicDoors: true, dynamicCurtains: (room) => … })`), and with the options off the house is built exactly as before. `ScopedLighting.setScopeScale(room, s)` dims a room's lights for a switch. A plan marker in the outfit's colour shows each person on the storey the plan cuts. Detailed bodies and the full body-language catalogue are milestone 5.

![party lab, scope view](images/party-scope.jpg)

## Party lab

`npm run dev`, then open http://127.0.0.1:5173/party/ (on Pages: `/demo/party/`).

- The clock, the phase, and a timeline of the programme. Click the timeline to jump; going back replays the evening from 19:00.
- Speeds: pause, 1× (the evening in an hour), 5×, 20× and 60×; back to 19:00; next phase. Space pauses.
- Views: scope (from the perch; scroll to zoom, drag to aim), wide, plan (scroll to zoom, drag to pan, one storey at a time) and orbit.
- The people list shows what everyone is doing. Click a name, or a person in any view, to see their role, habits, partner, what's in their glass and how full, how many drinks and how merry they are, their room, how visible they are from the perch, and their needs. The scope follows them; the plan turns to their floor.
- Doors swing and curtains draw as the sim has them. The log lists arrivals, departures, phases, the toast, bathrooms found taken, knocks and spilled drinks; the stats add bathroom and bump totals and where the coats and the whisky went in this house.

| URL parameter | Meaning |
|---|---|
| `seed` | House seed (the party uses the same seed unless `party` is given) |
| `party`, `guests` | Party seed; number of guests |
| `t` | Start time: minutes after 19:00, or a clock time such as `20:30` |
| `speed` | 0, 1, 5, 20 or 60 |
| `view`, `fov`, `level`, `zoom`, `px`, `pz` | View, scope field of view, plan storey, plan zoom and pan (metres) |
| `sel`, `follow` | Select a person by index; keep the scope on them |
| `shot=1&w=&h=&ui=1` | Headless capture (`ui=1` keeps the panels) |

Stills: `npx tsx scripts/render.ts --page party/ --views plan,scope --params "t=115&sel=20&follow=1"`.

## Numbers

Measured on three houses, `gala-night`, `match-42` and `orangery-1` (21–28 guests):

| Measure | Result | Test asks |
|---|---|---|
| A whole evening, headless (21,600 steps) | 2.0–2.6 s (milestone 1: 1.2–1.7 s) | under 20 s |
| Guests holding champagne as the glasses go up | 83–90% | ≥ 60% |
| Guests at the toast, 85% of the way through it | 91–100% | ≥ 70% |
| Guests at dinner, 60% of the way through it | 100%, and every guest with a chair seated | ≥ 90% |
| Guests dancing, halfway through the dancing | 48–57% | ≥ 30% |
| Samples off the walkable floor (a person every 30 s) | 0 of 6,400–7,600 | 0 |
| Guests gone by 22:00 | all | all |
| Bathrooms found taken at the door | 0 (0–4 over 9 houses; milestone 1: 29–64) | under 25 |
| Two people in one bathroom; more than two in a line | never | never |
| Drinks a guest | 3.8–5.2 | |
| Tipsiness at 22:00, median and highest | 0.20–0.37, 0.53–0.62 | mean 0.05–0.7 |
| Bumps an evening, with a drink slopped | 98–150, 7–19 | under 400 |
| A* searches an evening, cache hits | 1,700–2,200, 12–20% | |

## Tuning notes

- Bathroom trips: about 1.5–2 a guest an evening, and about half are abandoned on the way when the guest sees the door shut from across a room. In houses whose only bathrooms are two floors up at the far end a trip can take 8 minutes, which is why bathroom trips stop 20 minutes before the end.
- Bumps are still many, mostly waiters on their rounds and people crossing a crowded ballroom; giving way roughly halved them. The rows that grow out of them (a later part) should start from the slopped ones.
- Conversation groups stay small and few (0–3 at a time). Mingling will grow when gossip gives guests something to talk about (milestone 2).

## Known gaps

- Rooms that are dark at the start have no lamps in the blueprint, so a bathroom switched on shows in the sim and the lab's panel but not yet on screen, and switching a lit room off leaves its baked bulbs and lampshades glowing and its window light on the lawn.
- The technical plan's coarse first pass over the room graph for long routes isn't built; the graph only answers "is it reachable at all".
- Doors swing in 1.5 in-game s rather than the plan's 0.6, which looked like a snap at 1×.

## Files

| File | What it holds |
|---|---|
| `clock.ts` | Time scale, the programme and its jitter, clock labels |
| `types.ts` | People, looks, traits, needs, actions, groups, events |
| `places.ts` | Everything the minds need from the blueprint, as walkable spots and seats |
| `path.ts` | A* per storey gated by doors, string pulling, stairs between storeys, the route cache |
| `world.ts` | Doors and locks, keys, curtains and the view through them, light switches, the item table |
| `body.ts` | Bathrooms and their queues, the bar, drinks, trays and glasses, tipsiness, bumps |
| `cast.ts` | Names, roles, outfits, habits, couples and friends, arrival times, dinner seats |
| `mind.ts` | Need decay, the options and their scores, the weighted choice |
| `sim.ts` | `Party`: the step loop, phases, walking and doors, giving way, staff and their trays, the host, groups, coats |
| `render/crowd.ts` | The instanced three.js crowd |
| `render/fixtures.ts` | Door leaves and movable curtains |
| `tests/party.test.ts` | Programme, cast, determinism and a whole evening |
| `tests/party-things.test.ts` | Doors and locks, the room graph on 12 houses, curtains, lights, items, chains, bathrooms, drinks, tipsiness, coats, bumps |
