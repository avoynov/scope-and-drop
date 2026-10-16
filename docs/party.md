# The party

`src/party/` plays one evening at a generated mansion: 20–30 guests, the staff and a host, through a fixed programme from 19:00 to 22:00. It is milestone 1 (party core) of the design spec, [Guests and the Spy](https://claude.ai/code/artifact/e2c50e9e-e5fd-40d7-ba1f-e5b112831f52), plus the first three parts of milestone 2 ([milestone 2 plan](https://claude.ai/code/artifact/51e90a8d-8fe8-46ef-bbf4-b123ab4e2ebe), [technical plan](https://claude.ai/code/artifact/4a53e787-fa10-481d-a66b-d0db163eca77)). Things: doors that lock, curtains, light switches, glasses and coats, bathrooms with a queue, six drinks and tipsiness. Minds that notice: sight and hearing, what each person knows and passes on, suspicion, the house as each person knows it (wrong turns, asking the way), the mood, knowing each other by sight, and the register in which guests connect the dots. Everyday life: what the house offers, conversation circles, the evening's rituals, errands, tours, searches, the photographer and the band, and a staggered goodbye. Friendships and rows come in the next part; the spy, mishaps and the endings after that.

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
party.stats;                     // { told, overheard, doubleTakes, tests, wrongTurns, asks, hushes, … }
party.familiarity(party.people[7], 4); // 0..1, how well they know room 4 now
party.suspects(7, 12);           // 0..1, how much person 7 suspects person 12
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
- In the last 20 minutes only an urgent bathroom trip starts (the bathroom may be two floors up at the far end), and from 8 minutes before the end whoever is still here heads home (see Tasks), so everyone has left by 22:00.

## Staff and the host

About fifteen staff work 20 to 30 guests: the butler, 4–6 waiters, the bartender, the cook and a kitchen hand, a cloakroom attendant, a three-piece band and a photographer. The host greets at the door through the arrival, announces each phase, leads the toasts, heads the table and sees the guests off. Waiters load a tray of 6–8 glasses of one drink at the bar or kitchen (champagne before the toast, red or white at dinner, a mix after) and make four stops in the party rooms (the dining room at dinner). At each stop they offer a glass every few seconds to guests within 2.5 m whose hands are empty (more often when they're thirsty, never a drink they don't touch) and take empties onto the tray; an empty tray ends the stop. When champagne is called every waiter fetches a full tray of 10–12 flutes from the nearest bar or kitchen, and through the champagne and the toast they hop from one empty-handed guest to the next. The bartender stays at the bar and the cook in the kitchen. The butler stands with the host at the door, looks over the table before dinner and has a word in the host's ear, stands at the sideboard through dinner, takes the brandy round after, fetches the good whisky for the bar once, and now and then a drink for someone seated who is thirsty. The kitchen hand washes up, brings clean glasses to the bar three times an evening (first at 30 minutes, then every 45–65) and slips out the back for a cigarette. The cloakroom attendant takes coats at the door through the arrival, fetches one for a guest who feels the cold, and stands by the front door with the coats from the farewell's last toast. The band plays softly through the arrival and the mingling, rests for the toast, eats in the kitchen at dinner, plays the dancing with a break in the kitchen midway, and stops at the last toast. The photographer takes candid shots and the group photo (see Tasks below).

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

- **Bathrooms.** A guest walks to the place outside the door. If the bathroom is free they go in; once they're in the room the door shuts and bolts (when nobody else is in there) and the light comes on if it was dark. Otherwise they say so if they didn't know, remember it, and either queue (up to two, along the wall beside the door, when it's urgent or there's nowhere else to try) or go back to choosing. The one at the front knocks after a minute and whoever is inside hurries; a queuer gives up after 2–4 minutes. Anyone who sees a shut bathroom door (within 12 m, in their field of view, nothing in the way) or hears a knock or the bolt remembers it for 3 minutes, and turns back if it is the bathroom they were heading for and they can wait.
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

## Minds that notice

Five modules, each owning its state in flat typed arrays, read by the minds through `MindWorld` and wired together by `Party`.

![party lab: a guest's field of view and the house as they know it](images/party-minds.jpg)

### Sight (`sight.ts`, `senses.ts`)

A sight grid per storey (the walk grid's 0.25 m cells; furniture doesn't block sight) marks open floor, wall, doorway, curtained window and screen (frosted glass). A table says which rooms can see into which (a shared opening, a glazed screen, the gallery round an atrium). Each person looks every 2 in-game seconds (a quarter of the party each step). For everyone else present, in this order: the same storey or across the atrium void; within 12 m; rooms that can see each other; the room's range (4 m in the dark to 12 m in full light); 100° either side of where they're facing (their head, during a glance); for someone across the void, a line over the gallery rail; two people standing on the line hide the far one; then a grid walk that stops at walls, shut doors (an open door lets sight through past half open), drawn curtains and frosted glass. Attention decides what is taken in: 0.9 to start, more for the nosy and the tense, less for the tipsy, the lively and anyone busy dancing, eating or talking.

What a sighting does: the looker notes where the other was and what they were doing; within 6 m and 30° of straight ahead they see what's in the other's hand and whether they're unsteady (a fact, `tipsy`); anything notable the other is doing becomes a fact (a wrong turn, a locked door tried, coming out of a bedroom, a spilled drink, no champagne at the raise, being out of step with the toast); and someone they know is compared with how they remember them (see Knowing each other). A bathroom door in view says whether it's taken. Rooms seen into through doorways and glass are learnt a little (once a minute each).

### Hearing (`senses.ts`)

Sounds carry through the room graph by the loudest way (a Dijkstra): 0.5 dB a metre, 6 dB through an open door, 20 through a shut one, 3 through an arch, 15 up or down a stair. A sound is heard when it beats the listener's room noise by 6 dB. Noise is worked out every 5 in-game seconds: 45 dB background, talkers at 55 dB raising their voices over each other (the Lombard effect), the band at 75 and the piano at 70. Heads turn toward what was heard (not for laughter in one's own room); a sound with a tension weight unsettles; a knock or the bolt tells listeners the bathroom is taken; a loud sound (80 dB and up) in another room sends a nosy guest to look.

| Sound | dB | | Sound | dB |
|---|---|---|---|---|
| knock | 58 | | dropped tray | 65 |
| bolt | 50 | | breaking glass | 80 |
| clink | 50 | | slap | 80 |
| laugh | 65 | | door slam | 80 |
| raised voice | 65 | | scream | 95 |

This part only makes knocks, the bolt and laughter; the rest are for the mishaps and rows to come.

### Facts and gossip (`memory.ts`)

A fact is a verb (24 of them: romance, odd acts, mishaps, the house, requests, whereabouts), a subject, an object and a room, each with a juiciness, an oddness and a half-life (90 minutes for romance, 45 for odd acts, an hour for mishaps, 20 minutes for the house). The same thing seen again within a minute of its last sighting is the same fact. Each person holds up to 48, each with a confidence that halves over the fact's half-life (half again as long about a friend or partner), who told them and in how many hops; a full memory drops the weakest (confidence × juiciness).

When a conversation's speaker changes, the new speaker passes something on with chance 0.25 × (0.4 + talkativeness): one of their three best facts (by juiciness × confidence × listeners who haven't heard it, doubled when it concerns a listener's friend or partner), never about anyone in the group, and a dull fact only with a chance equal to its juiciness. Listeners learn it at 0.8 of the speaker's confidence, and anyone standing within 3 m overhears it at 30%. Nothing below 0.2 is passed on. At a table, in the toast ring, on a sofa or out on the terrace, people also say something to whoever is within 1.6 m now and then (0.02 × (0.3 + talkativeness) every 2 s).

### Suspicion

Learning an odd fact about someone raises suspicion of them by oddness × confidence × (1 + one's tension), less for a friend (× 0.5) and far less for a partner (× 0.2). It halves over 40 minutes. At 0.35 a person is wary: they glance at the one they're wary of when close, and don't seek out a quiet word with them alone. At 0.55 they suspect: talk stops for 10–25 s when that person joins their conversation (a hush), and a group with that person in it is half as inviting. In this part nobody is anything but innocent, so suspicion stays low (under 0.2 by the end of an evening) unless the lab plants a rumour.

### The house as each person knows it

Each person knows each room from 0 to 1. Walking into a room adds half of what's left (less when tipsy); seeing into it a tenth. Knowledge halves toward a floor over 45 minutes (faster when tipsy); each visit raises the floor by 0.45, up to 0.6 and never above what was learnt, so a room visited once stays known and one visited twice is never got wrong. The host and their partner never forget. Starting knowledge: everyone knows the entrance hall and the rooms off it (0.6); about a third of the guests are regulars who know the party rooms and the two bathrooms nearest the toast spot and the way to them (0.8); staff know the whole house (0.9, bedrooms and the study 0.3).

What it changes:

- Options aimed at a room someone doesn't know (below 0.3) are left out, except the programme's own (champagne, the toast, dinner, leaving), wandering, and a bathroom when it's desperate.
- Wrong turns. Entering a room on the way somewhere, with k the better of how well they know where they're going and the next room on the way, the chance of a wrong turn is (0.5 − k)(1 + tipsiness), at most once in 2 minutes. They walk into the wrong room or up to a locked door (`locked-door`, a fact for whoever sees it), look round for 2 s, and set off again.
- Asking the way. Someone who needs a bathroom and knows none asks someone they know, or the staff or the host, on their storey and seen in the last minute (the household and staff count as nearer). The answerer points the way (the rooms along it become 0.3 better known and the bathroom 0.4) or shrugs. Someone who wants to put a friendly test to a friend (see below) uses the same action.
- Showing the way. When dancing or the games are announced, the host shows everyone the way: the rooms along it become better known and the room itself 0.5.

### Mood (`mood.ts`)

Energy and tension per person, updated every in-game second; a room's mood is worked out from whoever is in it, only when asked. Energy drifts (5-minute time constant) toward 0.25, plus 0.35 dancing, 0.15 with music in the room, 0.2 × tipsiness, 0.1 talking in a group and up to 0.2 for a crowd within 3 m, minus 0.2 sitting alone; pairs within 3 m in the same room pull each other's energy together. Tension comes from what people see and hear, halves over 20 minutes, and passes from tense people to calmer ones beside them (scaled by their nerves), never the other way. A room is tense from 0.35 average tension, uneasy from 0.15, else festive from 0.45 energy, else relaxed. Energy makes dancing more tempting (× 0.6 + 0.8 × energy); tension pulls people toward their friends and partner (× 1 + tension), sharpens attention and makes odd facts count for more. In this part little raises tension (hearing something juicy and odd, a little), so it stays near 0 unless the lab sets it.

### Knowing each other (`ident.ts`)

Ties come from the cast (partners 5, friends 3 or 4, the staff among themselves and with the host 3, the host and each guest 2, or 3 for a regular, regulars among themselves 2, and about half of one's friends' friends 2) and from meeting in a conversation tonight (1). Each person remembers how everyone they know looks: height, build, walk, voice, habits, the colour of their clothes. Each sighting compares, more closely face to face (within 1.5 m) than across a room, less in the dark or with drink taken. A difference they can't explain grows into doubt (weighted by how well they know the person); one they can explain (they saw them drinking, or know they're tipsy) counts a fifth as much and is got used to. At 0.2 doubt they look twice (`double-take`, a fact); at 0.45 they try a nickname or a shared joke when next face to face (`test`). The real person always passes, after which they're themselves for the evening. Milestone 3 lets an impostor fail.

### Connecting the dots (`register.ts`)

Beside their facts, each person keeps a register: up to 48 sightings (who was where, from when to when), 16 claims (what people say of themselves: "I was on the terrace") and 8 cases (something that wants explaining, with up to 6 candidates). Sightings and claims share one record: who (or, for someone they couldn't name, a description of sex, height, build, clothes and habits), what, the room, a window of time, how sure, who told them, the original witness and the hops. That one shape lets any kind of case use any kind of evidence.

A case is opened from a template:

| Case | Opened by | Matches on | Severity | Settles at |
|---|---|---|---|---|
| Thing gone | noticing or hearing something is gone (looks back 20 min) | place and time | 0.6 | 0.6 |
| Person gone | someone missing | place and time | 0.5 | 0.6 |
| Lights out, door locked | the house facts | place and time | 0.15, 0.1 | 0.6 |
| A crash | a loud sound | place and time | 0 | 0.6 |
| Cheating | a cheating hint | the pair | 0 | 0.52 |
| Not themselves | two firm sightings that can't both be true | doubt | 0.05 | 0.6 |

How a case weighs its candidates: each entry fits by room (same room 1, a room joined to it 0.4) times time (1 when the windows overlap, 0 at 10 minutes apart), times how sure it still is (halving over 45 minutes), times how far the source is believed (own eyes 1; someone told them 0.3 + 0.6 × the tie, times their belief in the teller; a forgotten source 0.3). One vote per original witness, so a story heard three times counts once. An unnamed description spreads half its weight over the known faces that resemble it. A claim that puts someone elsewhere takes off up to half; one that explains them being there (an errand) clears them. P = weight / (all weights + 0.5). A case settles when the leader reaches its line and the next is under half of it. The holder, the subject and, for the household's things, the household are never candidates.

Order doesn't matter: a sighting filed before the case opens is found by the case (hindsight), and one heard after it feeds it (forward). A description that later meets a name (being introduced in a conversation) is re-checked and can resolve to that person (`recognised`).

When a case settles, the holder blames the leader (a `blamed` fact, passed on as gossip), grows suspicious of them by severity × P × (1 − trust), only ever the rise, and keeps away. A guest who knows the host (tie 2 or more) goes and tells them about the host's own things, half the time, within 30 minutes (`tell`).

Things that don't fit:

- Two places at once. Two entries put one person in two rooms that can't both be true: the stretches they were surely there overlap by 2 minutes or more, or one whole window sits inside the other's sure stretch. The weaker entry gives way (its confidence halves) and the teller is believed less (up to 0.2 a time, back over an hour, never under 0.2). If both are firm and one is the holder's own eyes, they doubt it's really that person (`not themselves`, doubt + 0.15, suspicion + 0.05).
- A broken claim. Someone said they were on the terrace; the holder saw them in the study: suspicion by the severity of the case it answered (0.1 if none), and the claim counts for little after. A second broken claim is treated as two places at once.

Drink adds noise when something is filed: the window widens by 1 + 6 × tipsiness minutes, its centre drifts (σ 4 × tipsiness min), the room slips to a joined one at 0.3 × tipsiness, a description loses a feature (colour, then build, then height) with chance tipsiness, and who said it is forgotten at 0.5 × tipsiness.

Talk: a person with an open case of severity 0.3 or more asks around in their conversation (every 10 minutes at most, 0.5 × (0.4 + talkativeness) a turn); everyone there learns the case, and whoever holds something that fits says so to all (up to two entries each, including their own last sight of people). A holder whose leader is at 0.3 or more passes on that lead (0.3 × talkativeness). Whoever notices something gone tells everyone within 6 m in the room. Joining a conversation, a person may say where they've just been (a claim; 0.3 × (0.4 + talkativeness)).

Evidence travels, never a bare verdict: a listener weighs what they hear for themselves.

## Everyday life

### What the house offers (`ads.ts`)

Each kind of object, room or place advertises what it does: the needs it refills, for how long, the pose, the phases it suits and who takes to it (the elderly to a fire, the young to the fountain, a smoker to the terrace). The table resolves at the start into this house's offers, one per object with its standing spots, so a new activity is a row, not new code, and a room a house lacks offers nothing. Art, the fireplace, the library shelves, a globe, the atrium rail, the plants, the pool, the fountain, the kitchen (counters, the bustle, a word with the cook), the buffet, sofas and chairs, the terrace, billiards, cards, the piano and the cinema.

### Conversation circles (`groups.ts`)

A circle stands in an F-formation: members on a ring round an empty middle, facing in (radius 0.45 m for a pair, 0.45 + 0.12 m a member above that), a pair face to face. A newcomer walks to the widest gap at the edge (counting others already waiting there), waits 2–6 s, and the circle opens and shifts to make room, or stays closed and they walk off and keep away from it for 10 minutes. The shy may linger a while longer at a closed circle (the party ghost). How open a circle is depends on the members' ties to the newcomer, a friend or partner inside, its size, and any suspicion of them; someone they're wary of is let in only now and then, and the talk stops when they are (a hush). Above four in a quiet room, or three in a loud one, a circle splits at its next turn: those on the far side from the speaker form a new circle a clear step away, wherever round it there's room. A new conversation isn't started on top of one going. Each member stays 5–15 minutes (longer with a partner or friend, shorter with the bore). People who know each other greet when they first see each other tonight: a wave, the approach, a handshake or a kiss.

### Rituals (`practices.ts`)

The evening's beats fire at points in the programme and for a while pull on what people choose (a multiplier on a choice, never an order): a spoon on a glass and the hush before the speech; the procession to table; the host sits first; the table turns to talk the other way; the host couple's opening dance alone for a minute, then the surge onto the floor; the band's break, when the bar fills; last call 20 minutes before the end; the host's thanks. Two norms: whispering through the speech and sitting before the host. Up to four proper people nearby frown, glance over and remember it as rude, once per person and norm.

### Tasks (`tasks.ts`)

Jobs of a few steps (go to, meet, say, wait, unlock and lock, pick up, hand over) for one person or a small party following in single file. Everyone in a task is busy; a task gives way to the toast and dinner.

- **Tours.** The host shows one to three guests who don't know the house (the plus-one first) three to six rooms they don't know, unlocking a key-locked door on the way in and locking it on the way out; at most four an evening, 20 minutes apart.
- **Errands.** The good whisky to the bar, clean glasses, a coat, a drink for someone. The carrier sometimes tries the wrong room first. A fetched drink is carried as a glass and handed over, so the asker holds it and drinks it.
- **Searches.** Someone who hasn't seen their partner for 17 minutes (the plus-one after 9) goes to the room they last saw them in and looks round; at most twice an evening, and not while the other is already looking for them. Most find them.
- **The photographer.** Candid shots from the edge of the busiest room, every 3–5 minutes. After the toast, the group photo: everyone lined up by height before the grand stair, the tallest at the back, the host couple in the middle of the front row; three flashes, then a few crowd round the camera.
- **Leaving.** Each guest has a hidden threshold, skewed low: from the farewell's last toast they go once that share of the guests has gone, so a few goodbyes tip the rest. The elderly tire and go during the dancing, and now and then someone has a babysitter or feels unwell. A couple goes together: find the host to say goodbye, collect a coat from the attendant at the door, and out. From 8 minutes before the end whoever is left goes at their own moment, and from 5 minutes the rest hurry.

## Walking
## Ties (`bonds.ts`)

Ties form and break through the evening. Everything is n × n typed arrays drawn at the start from their own random stream (`bonds`), so adding them shifted nothing else. Growth runs every four steps over the pairs the mood already finds (within 3 m in the same room), and fading is worked out when a pair next meets. The spy, when milestone 3 casts one as a guest, gets all of it like anyone else.

- **Chemistry and affinity.** Every pair draws a chemistry each way, mostly shared (attraction tends to run both ways or neither): the flirt and the young are drawn more, the mother and the elderly less, and same-sex chemistry only between the 6% so inclined. Affinity is symmetric: like talks to like, dancers to dancers, a shared habit, a friend in common.
- **The cast's bonds.** Friends start at 1.3–1.5 (close friends 1.5–2), partners at 2, people who know each other at 0.3–0.9. About half the guests come as couples (the cast's couple chance was compounding to nine in ten; it is now 0.25 a still-single guest).
- **Flirting** grows from chemistry × closeness × what they're doing (dancing most, talk, the bar, a game, sitting side by side) × (1 + tipsiness) × the room's energy, and halves over an hour apart. At 0.15 they notice each other (a glance), at 0.35 they flirt: if either has little chemistry (under 0.2) the cool one steps back and that's the end of it tonight (a rebuff, a small grudge); otherwise they flirt (on the floor they dance close), and during the dancing one may ask the other onto the floor. At 1 they're a couple: everything else either had going stops, and those who see them together get the news.
- **Who may flirt.** Two single guests, never the host, the household, staff (see below) or exes. A stray (about one couple in ten has a partner who strays, the less loyal of the two) may flirt too, but only out of their partner's sight (not in the same room, not seen for 30 s) and with none of the partner's close friends within 4 m. A stray arrives with an eye on one single guest: they drift away from their partner, seek that one out (a circle with them in it scores 4 more; on the floor they dance near them), and go over for a word when they spot them with the partner away. Their flirting grows 2.2 times faster and is an affair from the flirting line; it never becomes a couple.
- **Staff** flirt only while serving a guest close by (a tray stop, across the bar), and at the flirting line they're friends for the night: that guest is served first. One evening in three or four.
- **Friendship** grows from affinity × closeness × what they're doing (talk most, sitting, a game, the bar, dancing) × drink and energy, half again with a friend of both in the same circle. At 0.3 they're acquaintances, at 1 friends (they go into each other's friend lists, and recognise each other as such), at 1.5 close. A friendship short of 1 fades over 90 minutes apart; a friendship never does.
- **Doubt.** A partner who sees their stray flirting erupts on the spot. Otherwise doubt comes by word: news of cheating from a friend adds 1.15 × how sure the teller was, from someone they know 0.5, from anyone else 0.3 (flirting half that), each teller once; a circle going quiet as they join is a hint (0.1). Only a friend tells a partner; nobody else says it in front of them. Flirting from before a couple got together isn't cheating, to them or to anyone told about it. Doubt halves over an hour. From 0.3 they keep an eye out (they look for their partner sooner and more often); from 0.7 they go and have it out.
- **Confronting.** Found with the one they're thought to be with: an eruption, scaled by how sure they are, their nerves and drink: a pull by the arm, a jealous scene, or a row with an act in it (a slap, a thrown drink, a shove; between two tipsy men a scuffle one time in five). Found alone: a hissed word or a row. Whoever is in the room hears what it's about, and afterwards someone goes: the partner off to the terrace or home, the other two apart. Never on less than 0.7.
- **Grudges** come from a slopped bump, a lost game (more for a heavy loss or a gloating winner), a rebuff, jealousy and gossip about oneself overheard (more from a friend), and halve over 30 minutes. Face to face within 2 m, heat = grudge × temper × (1 + tipsiness) × (1 + tension) × 4: from 0.15 a spat, from 0.35 a row, from 0.6 and tipsier than 0.5 a row with an act in it. A pair rows once in 20 minutes at most and keeps apart for 20–40 minutes after; a bad loser at cards cries foul. Witnesses tense up.
- **Falling out and making up.** A spat costs a friendship 0.15, a row 0.8, an act 1.2; a friendship that drops below 0.6 has ended: both drop each other, mutual friends cool a little toward the one they're less close to, and neither joins a circle the other is in. One that was 1.5 or more may be made up after 30 minutes (a hug).
- **Onto the floor.** A friend seen taking to the floor may pull someone after them (chance 0.25 × the bond, a partner 2.4 times as likely, once a pair in 10 minutes): the dance scores three times higher for two minutes, and they dance beside them. A dancer waves a close friend standing by over. Partners dance face to face (the slow dance), and a tipsy flirting pair club-style, one in front with their back to the other. Someone very proper leaves a floor where that's going on.
- **Slipping away.** Every 10 minutes, a couple (or a stray and their lover, out of the partner's sight) close together and both tipsier than 0.4 may slip off to a guest bedroom that one of them knows, with nobody in it and a lock on the inside: they bolt the door and draw the curtains, and come out 20–40 minutes later, a little dishevelled, which whoever sees them come out remembers. Once a night a couple, two couples an evening at most.


A* runs on the mansion's walk grid (0.25 m cells, 8 neighbours, no cutting corners), and the path is string-pulled to a few waypoints with an exact grid traversal, so a straight leg never crosses a blocked cell. A walker within 0.3 m of a waypoint cuts the corner to the next one when the way is clear, so two people heading for the same doorway don't stall on one point. Stairs join the storeys; a route crosses one storey at a time through the stair with the shortest detour. Doors gate it all (see Things in the house). People push apart to 0.42 m, never into a doorway that is locked against them, and anyone pushed off their line finds a new route from where they stand.

## People on screen

`render/crowd.ts` draws everyone as simple jointed figures, one `InstancedMesh` per body part (thighs, shins, skirt, torso, shirt front, head, hair, arms, a glass, a tray, a hat, glasses, a cane). The mansion's scoped room lights reach them through a per-person `aScope`. Poses come from the sim (walk, climb, sit, talk with the group's speaker gesturing, drink, toast, dance, the slow dance, the club-style pair, play, serve, smoke, greet, announce, look, knock, argue, hug), and habits show while standing about (scratching an ear, checking a watch, hands in pockets, a big laugh). Gestures go over the pose for a few seconds: a hand out to ask the way, an arm out pointing it, a shrug, leaning in to pass something on, a slap, a shove, a thrown drink, a pull by the hand; heads turn toward a glance or a sound. A glass shows the colour of its drink, someone past 0.6 tipsiness lists slowly from side to side, and a couple back from slipping away shows hair and shirt awry for ten minutes.

`render/fixtures.ts` draws what moves in the house: door leaves on their hinges (two for a double door) and the drapes and sheers of the windows people can draw, four instanced meshes in all. The mansion builder leaves those out of its baked mesh when asked (`buildMansion(bp, { dynamicDoors: true, dynamicCurtains: (room) => … })`), and with the options off the house is built exactly as before. `ScopedLighting.setScopeScale(room, s)` dims a room's lights for a switch. A plan marker in the outfit's colour shows each person on the storey the plan cuts. Detailed bodies and the full body-language catalogue are milestone 5.

![party lab, scope view](images/party-scope.jpg)

## Party lab

`npm run dev`, then open http://127.0.0.1:5173/party/ (on Pages: `/demo/party/`).

- The clock, the phase, and a timeline of the programme. Click the timeline to jump; going back replays the evening from 19:00.
- Speeds: pause, 1× (the evening in an hour), 5×, 20× and 60×; back to 19:00; next phase. Space pauses.
- Views: scope (from the perch; scroll to zoom, drag to aim), wide, plan (scroll to zoom, drag to pan, one storey at a time) and orbit.
- The people list shows what everyone is doing. Click a name, or a person in any view, to see their role, habits, partner, what's in their glass and how full, how many drinks and how merry they are, their room, how visible they are from the perch, their energy and tension, how many rooms they know, whom they doubt and suspect, the things they know (with who told them and how sure they are), and their needs. The scope follows them; the plan turns to their floor.
- Overlays on the plan, each a toggle: **sight** (the picked person's field of view, the sharper cone for detail, solid lines to who they took in on their last look and dashed to who is in view), **sound** (a ring where each sound was made and lines to who heard it), **gossip** (speaker to listeners, coloured by kind of fact), **suspicion** (how much the picked person suspects each other person, or with nobody picked how suspected each person is on average), **map** (rooms shaded by how well the picked person knows them, unknown ones dark), **mood** (rooms tinted and named festive, relaxed, uneasy or tense), **cases** (the picked person's case rooms outlined, with lines to each candidate and their chance; with nobody picked, how many know of a case in each room), **circles** (each conversation's ring, lines to its members, the speaker marked, and who is waiting or hovering at the edge), **tasks** (lines from each task's owner to its party, with the kind and the step) and **bonds** (couples, flirting with its strength, an affair marked, friends and close friends, those who fell out, grudges as arrows from whoever holds them, and how much anyone doubts their partner; with someone picked, only theirs).
- **Goes missing here** on the card makes something of the host's go missing from the picked person's room; **seen there** has the picked person seen poking round that room. Together they plant a theft for the guests to work out. The card's register block lists the picked person's cases and their candidates.
- **Spark** makes the picked person and the one picked before take to each other (both right at the flirting line); **grudge** gives the one picked before a grudge against the picked person; **cheating rumour** starts word going round that the picked person is cheating on their partner. The card's ties lines show their temper, doubt about their partner, a stray's eye or lover, whom they're drawn to, whom they get on with, whom they fell out with, and their grudges and how hot they run.
- **Plant a rumour** on the card: a guest in a conversation hears something juicy and a little odd about the picked person. The **mood** row sets tension (tense, calm) or scales energy (liven, dampen) for everyone, the picked person's room or just them. Both take effect from the next step and are kept, so going back in time replays them where they were made; a new house clears them.
- Doors swing and curtains draw as the sim has them. The log lists what's happening, filtered to the evening as a whole, everyday life (greetings, joins and rebuffs, splits, tasks, the photo, goodbyes, breaches and beats), gossip, connecting the dots (cases, asking around, leads, blame, telling the host, conflicts, recognising), noticing (double takes, tests, hushes, a noise gone to look at), romance & rows (noticing, flirting, affairs, couples, friendships, rebuffs, spats and rows, who is sure, confrontations, pulls onto the floor, slipping away, games won), finding the way, the house or the programme. The stats add bathroom and bump totals, what was told and overheard, double takes, tests, hushes, wrong turns and asks, and where the coats and the whisky went in this house, and the everyday life totals: hellos, joins, rebuffs, splits, breaches, tours, errands, searches and how many found their partner, the group photo, candids and goodbyes; and the ties: couples, friendships, flirtations and rebuffs, affairs, who found out, confrontations, spats, rows, fallings-out and makings-up, pulls onto the floor, staff friendships and slipping away. The detail card shows the picked person's task and step.

| URL parameter | Meaning |
|---|---|
| `seed` | House seed (the party uses the same seed unless `party` is given) |
| `party`, `guests` | Party seed; number of guests |
| `t` | Start time: minutes after 19:00, or a clock time such as `20:30` |
| `speed` | 0, 1, 5, 20 or 60 |
| `view`, `fov`, `level`, `zoom`, `px`, `pz` | View, scope field of view, plan storey, plan zoom and pan (metres) |
| `sel`, `follow` | Select a person by index; keep the scope on them |
| `ov` | Plan overlays, comma-separated: `sight`, `sound`, `gossip`, `suspicion`, `map`, `mood`, `cases`, `circles`, `tasks`, `bonds` |
| `gone`, `seen` | Plant a theft: `gone=80:5` (minute, room), `seen=75:11:5` (minute, person, room); first house only |
| `tension`, `energy` | Set everyone's tension (0–1), or scale their energy (0.5–1.5), at time `t` |
| `log` | Log filter: `everyday life`, `romance & rows`, `gossip`, `connecting the dots`, `noticing`, `finding the way`, `the house`, `programme` |
| `profile` | Time each stage of the step and show the totals under the stats |
| `shot=1&w=&h=&ui=1` | Headless capture (`ui=1` keeps the panels) |

Stills: `npx tsx scripts/render.ts --page party/ --views plan,scope --params "t=115&sel=20&follow=1"`.

## Numbers

Measured on three houses, `gala-night`, `match-42` and `orangery-1` (21–28 guests):

| Measure | Result | Test asks |
|---|---|---|
| A whole evening, headless (21,600 steps) | 4.1–5.4 s on the machine that measured 3.7–4.9 s before ties, about 40% of it seeing; the ties' own stage 0.17 s | under 15 s |
| Guests holding champagne as the glasses go up | 91–95% | ≥ 60% |
| Guests at the toast, 85% of the way through it | 96–100% | ≥ 70% |
| Guests at dinner, 60% of the way through it | 100%, and every guest with a chair seated | ≥ 90% |
| Guests dancing, halfway through the dancing | 57–82% | ≥ 30% |
| Samples off the walkable floor (a person every 30 s) | 0 of 10,100–11,600 | 0 |
| Guests gone by 22:00 | all | all |
| Bathrooms found taken at the door | 0–4 (milestone 1: 29–64) | under 25 |
| Two people in one bathroom; more than two in a line | never | never |
| Drinks a guest | 4.0–5.3 | |
| Tipsiness at 22:00, median and highest | 0.35–0.57, 0.64–0.75 | mean 0.05–0.7 |
| Bumps an evening, with a drink slopped | 226–333, 11–18 | under 400 |
| A* searches an evening, cache hits | 1,850–2,020, 12–13% | |
| Things passed on in conversation (listeners), overheard | 205–936, 18–229 | over 50 an evening |
| A rumour planted 8 minutes into the second mingling, after the group photo: time to reach half the guests, share at 45 minutes (five houses) | 11–30 min (mean 21), 52–100% | mean 10–35 min, ≥ 30% |
| Highest suspicion anyone holds at 22:00; of the rumour's subject | 0.02–0.10; 0.02–0.03 | nobody innocent ≥ 0.55 |
| Wrong turns, first hour and last hour | 1–8 and 0–5 | last hour a third of the first or less, over five houses |
| Asked the way, pointed to a bathroom | 19–44, 80–95% | over 5, mostly pointed |
| Double takes, tests | 9–16, 2–5 | 1–30, no doubt after a test |
| The register on an evening with nothing gone: entries filed, claims, cases, conflicts | 549–2,044, 53–81, 0, 0 | no case, 3 conflicts at most |
| A planted theft (one guest seen there at 75 min, something gone at 80): who knows of it, blamed on the one seen, on anyone else | 23–24 people; 0–13; 0 | ≥ 5 people, ≥ 6 blames on the one seen over three houses, more than twice anyone else |
| Highest suspicion of the one seen, by the end | 0.02–0.41 | |
| Energy halfway through the dancing, dancers and the rest; halfway through dinner | 0.70–0.84 and 0.53–0.67; 0.42–0.46 | within 0–1 |
| Tours, errands, partner searches (found) | 2–3, 7–10, 4–15 (4–7); searches 4–15 over six houses | 1–4, 4–12, 3–15 |
| Circles standing through the middle of the first two minglings (median) | 3–4 | 3–6 |
| Circle sizes of five or more; median stay | 0–0.2%; 8.0–8.8 min | under 10%; 5–15 min |
| Let in, turned away, split, hellos, breaches | 79–109, 17–46, 6–18, 126–146, 4–10 | joins over 20, some turned away |
| Guests leaving in the last 15 minutes | 91–100% | ≥ 80% |

Ties, over 16 evenings (`gala-night`, `manor-7`, `villa-3`, `house-11`, `orangery-1`, `match-42` and ten more); the test runs eight of them:

| Measure | Result | Test asks |
|---|---|---|
| Guests who come as couples | about half (0.3–0.7 a house) | 0.3–0.7 on average |
| Couples formed tonight; in or after the dancing | 0.9 an evening (0–4, in 9 evenings of 16); 13 of 14 | under 2 on average, at most 4; ≥ 70% |
| Friendships made; close friendships reached | 7.4 (3–12); 13.4 | 3–9 on average |
| Flirtations; rebuffs | 3.4 (1–11); 0.4 | |
| Strays; affairs | 0.9 an evening; in 4–5 evenings of 16 | some affairs |
| Partners sure; confrontations; on less than sure | 3–4; 2–3; never | never |
| Spats; rows (with a slap, shove or thrown drink) | 3.2 (0–8); 1.6 (0–4), 0.25 | rows 0.75–4 on average, at most 10 |
| Friendships ended by a row; made up | 0.1–0.2 (0–2); 0 | at most 2 |
| Dance starts a friend pulled them into | 41% | 25–60% |
| Evenings with a staff friendship | 6 of 16 | at most half |
| Couples slipping away | 0.3 (0–2) | at most 2 |

## Tuning notes

- Bathroom trips: about 1.5–2 a guest an evening, and about half are abandoned on the way when the guest sees the door shut from across a room. In houses whose only bathrooms are two floors up at the far end a trip can take 8 minutes, which is why bathroom trips stop 20 minutes before the end.
- Bumps are still many, mostly waiters on their rounds and people crossing a crowded ballroom; giving way roughly halved them. The rows that grow out of them (a later part) should start from the slopped ones.
- Conversation circles: social need now runs down twice as fast, so a guest who has been alone a while looks for company; through the middle of the first two minglings there are 3–4 circles at a time, almost all of two to four.
- Bumps grew with everyday life (busier circles, staff on errands, leaving parties at the door) to 240–320 an evening. Members shuffling within one circle or lining up for the photo don't count; new circles keep 1.6 m clear of others, and a circle that splits steps clear of all of them (two split circles landing on one spot gave 477 on one house).
- Departures: leaving all at once jammed the stair to the coats, so the attendant now brings the coats to the front door at the last toast, and guests leave one by one from 8 minutes before the end.
- Partner searches varied 3–18 an evening; searching sooner (17 minutes, 9 for the plus-one), at most twice each and never both at once, gives 4–15 over six houses.
- Wrong turns came mostly late in the evening at first (guests forgot rooms they had used once). The visit floor, regulars, being pointed to the bathroom itself, the announcements showing the way and the 2-minute grace turned that round; most now happen in the first hour, when guests first look for a bathroom, and the host and staff never take one.
- How fast a rumour spreads depends on who hears it first. A quiet guest can sit on it: planted in the first mingling with one whose talkativeness is 0.13, it went nowhere for half an hour, until dinner's side talk picked it up.
- Gossip was tuned to the plan's target (half the party within 30 minutes): first at 0.12 a speaker turn, which was too slow, then 0.25 with side talk at tables and in the toast ring.

- Ties: with the cast's nine couples in ten hardly anyone could flirt; at half, couples form about one an evening. Strays at first never got their affair going: out of the partner's sight they stood near the one they fancied but in another circle, where flirting barely grows, so a stray now drifts away from their partner, seeks that one's circle out and walks over for a word when they spot them. Partners were being told of "cheating" that was flirting from before they got together; that's now ignored. A friend's word counted 0.8 × how sure the teller was (about 0.6 passed on), which left partners stuck below the line to confront; it's 1.15 now. Rows at first cost a friendship too little to end any (0 in 32 evenings); a row now costs 0.8.

## Known gaps

- Rooms that are dark at the start have no lamps in the blueprint, so a bathroom switched on shows in the sim and the lab's panel but not yet on screen, and switching a lit room off leaves its baked bulbs and lampshades glowing and its window light on the lawn.
- The technical plan's coarse first pass over the room graph for long routes isn't built; the graph only answers "is it reachable at all".
- Doors swing in 1.5 in-game s rather than the plan's 0.6, which looked like a snap at 1×.
- Routes don't yet avoid rooms a person doesn't know: the plan's knowledge-weighted route search isn't built. What someone knows decides which options they consider, where they can go wrong and when they ask; the route itself is still the true shortest one.
- Going back in the lab replays the evening from 19:00, now 3–4 s for a whole evening. The plan's snapshots every 15 in-game minutes, due once a replay passes 2 s, aren't built.
- Nothing yet makes the loud sounds (a tray dropped, glass breaking, a slap, a scream), so nobody goes to see a noise; mishaps and rows bring them.
- The register: in `match-42` the planted theft is known to 23 people but never settled; the sighting stays with a witness who rarely talks about it, so no lead forms. Which house settles depends on who sees first (it was `gala-night` that stayed open before everyday life). That's how it should be when the evidence is thin.
- Departures from the register's design in the technical plan: the prior is 0.5, not 1 (with 1 a single witness never settled anything); a missing thing's severity is 0.6, not 0.3; claims travel in case talk and on joining a conversation, not as a gossip verb; cheating settles at 0.52; two places at once needs the sure stretches to overlap, since plain overlapping windows made 30 false conflicts an evening out of vague gossip; whoever notices something gone tells those nearby at once.
- Departures from the technical plan, all found while tuning:
  - The knock is 58 dB, not 50, so it carries a couple of metres down a corridor over party noise.
  - The host's partner never forgets the house either, and regulars know the way to the party rooms and their bathrooms.
  - Being pointed to a bathroom teaches the bathroom itself at 0.4 (the plan had only the route), so nobody asks again halfway there.
  - A wrong turn weighs the better of the destination and the next room on the way, at most once in 2 minutes a person, and the dancing and games announcements show the way. Without these, guests went wrong more late in the evening than early.
  - A visit keeps 0.45 of a room (the plan had 0.3, which left a room visited once still unknown).
  - Gossip: the plan's per-turn rule gave too little, so a speaker passes something on at 0.25 × (0.4 + talkativeness) a turn, a dull fact only by its juiciness, and people at a table, in the toast ring, on a sofa or on the terrace talk to their neighbours too.

- Departures from the technical plan for everyday life:
  - The plan's hard stop is a staggered one: from 8 minutes before the end whoever is still here goes at their own moment, in the order of their threshold, and from 5 minutes the rest hurry. A single stop sent everyone to the coats at once.
  - The cloakroom attendant brings the coats to the front door at the last toast rather than working a queue at the cloakroom.
  - A partner search goes to the room they were last seen in and looks round; asking around for them and the hurry after 3 minutes aren't built.
  - A circle's empty middle doesn't push passers-by out.

- Ties, changed from the first build while tuning:
  - A stray (one couple in ten, first one in fifteen) has an eye on one single guest from the start, seeks them out and drifts from their partner; left to chance, a stray's affair almost never came about.
  - A friend's word of cheating counts 1.15 × the teller's confidence (first 0.8); flirting from before a couple got together is never cheating.
  - Slipping away is checked every 10 minutes at 0.5 (first 15 minutes at 0.35), once a night a couple and two couples an evening at most.
  - A row costs a friendship 0.8 and an act 1.2 (first 0.5 and 1).
  - The flirting pair stand closer only on the dance floor (face to face, or club-style); in a circle they keep their place on the ring.
  - Making up needs a friendship of 1.5 or more and 30 minutes apart; none happened in 16 evenings, since the few that end are rarely that close.
  - A split circle forms a clear step away (the two rings plus 0.9 m) rather than at 1.5 m, which put two split circles on one spot.

## Files

| File | What it holds |
|---|---|
| `clock.ts` | Time scale, the programme and its jitter, clock labels |
| `types.ts` | People, looks, traits, needs, actions, groups, events |
| `places.ts` | Everything the minds need from the blueprint, as walkable spots and seats |
| `path.ts` | A* per storey gated by doors, string pulling, stairs between storeys, the route cache |
| `world.ts` | Doors and locks, keys, curtains and the view through them, light switches, the item table |
| `body.ts` | Bathrooms and their queues, the bar, drinks, trays and glasses, tipsiness, bumps |
| `cast.ts` | Names, roles, outfits, habits, couples and friends, regulars, arrival and leaving times, dinner seats, the staff and what each is fluent at |
| `sight.ts` | The sight grid, the room-to-room sight table, the atrium rail, line-of-sight walks |
| `senses.ts` | Looking (range, field of view, attention, crowding), bathroom doors in view, room noise, sounds through the room graph |
| `memory.ts` | Facts and each person's slots, gossip, last seen, suspicion, the mental map |
| `mood.ts` | Energy and tension per person, contact spread, room moods, the lab's overrides |
| `ident.ts` | Ties, how each person remembers the others' looks, doubt, double takes and tests |
| `register.ts` | Sightings, claims and cases; fit and weighing; conflicts; drink noise; asking around, leads, telling the host |
| `mind.ts` | Need decay, the options and their scores (filtered by what each person knows), the weighted choice |
| `ads.ts` | What the house offers: the table of objects, rooms and places, resolved into this house's offers |
| `groups.ts` | Conversation circles: rings, the edge, open or closed, splitting, stays, greetings |
| `bonds.ts`                        | Chemistry and affinity, flirting, couples, friendships, staff friends, strays and affairs, doubt and confronting, grudges and rows, falling out and making up, pulls onto the floor, slipping away                                                       |
| `practices.ts` | The evening's beats and how they pull on choices; the two norms and their breaches |
| `tasks.ts` | Tours, errands, searches, candid shots and the group photo, leaving with a goodbye and a coat |
| `sim.ts` | `Party`: the step loop, phases, walking and doors, giving way, wrong turns and asking the way, staff and their trays, the butler, kitchen hand, cloakroom, band and photographer, the host, groups and gossip, coats, departures, the lab's provocations |
| `render/crowd.ts` | The instanced three.js crowd |
| `render/fixtures.ts` | Door leaves and movable curtains |
| `tests/party.test.ts` | Programme, cast, determinism and a whole evening |
| `tests/party-things.test.ts` | Doors and locks, the room graph on 12 houses, curtains, lights, items, chains, bathrooms, drinks, tipsiness, coats, bumps |
| `tests/party-register.test.ts` | Fit, hindsight and forward order, one vote per witness, settling, exclusions, drink noise, conflicts, broken claims, errands, recognising, asking around, quiet evenings, planted thefts, live and replay |
| `tests/party-minds.test.ts` | Sight, hearing, memory, the mental map, mood, recognising people, hushes, five whole evenings with a planted rumour, the lab's provocations, golden digests |
| `tests/party-life.test.ts` | Rings and a split, three whole evenings: task counts, circles and stays, tours, a fetched drink, the beats and breaches, everyone home |
| `tests/party-ties.test.ts`        | The cast's couples and strays, who may flirt, a spark, doubt by word and old flirting, grudges and heat, eight whole evenings against the ties' numbers                                                                                                  |
| `tests/party-perf.test.ts` | A whole evening's cost, stage by stage |
| `tests/golden/party-digests.json` | Digests of three houses at 19:30, 20:15 and 21:30. Any change to what people do, see or remember changes them; when it's meant, check the lab and the numbers here, then `npx vitest run tests/party-minds.test.ts -u` |
