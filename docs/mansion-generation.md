# Mansion generation: plan and architecture

The level for *Scope & Drop*: a country house at blue hour, full of party guests, watched by a sniper lying in a treeline 130–210 m away. Every match gets a new house from a seed. Each house must be:

- **Random but valid.** It is a plausible building (rooms connect, stairs fit, windows sit on a rhythm) and a fair level (the sniper can watch enough of the party, but not all of it; mission objects exist, are reachable, and some can be observed).
- **Readable from the perch.** A sniper game needs a house you can see into. The garden front is mostly glass, party rooms open into each other, the centre of the house is one tall hall under a glass dome, and the sniper chooses the bearing to shoot from.
- **Deterministic.** The same seed gives a byte-identical blueprint, so a server can send a seed instead of a map.
- **About 70% realistic, 30% appealing.** Real proportions, materials and light, pushed toward a cinematic warm/cool palette.

![scope view](images/scope-palladian.jpg)

## 1. Approach

"Diffusion" here means *an algorithm that generates random but valid maps*, not a neural model. The usual candidates and why this module combines them:

| Technique | Good at | Missing for this game |
|---|---|---|
| Wave Function Collapse | local tile adjacency | global guarantees: connectivity, symmetry, room programme, sightlines |
| BSP / treemap floor plans | filling a footprint | classical symmetry, enfilades, façade rhythm |
| Shape/split grammars (Palladian grammar, CGA) | façades and massing that look designed | gameplay rules |
| Generate → validate → repair | hard guarantees | needs a good generator to converge fast |

So the module is a **constrained generative grammar** (after Stiny & Mitchell's Palladian grammar: grid → axis → parti → walls) with **repair passes** and a **validator**. An invalid result is regenerated from `seed#attempt`. Measured: 360/360 houses across all 36 style × plan × size combinations and both hall shapes validate (mean 1.1 attempts), 95/100 random seeds validate on the first attempt, and generation takes about 170 ms per attempt in Node.

## 2. Pipeline

```
seed ─► style ─► massing grammar ─► room partitions ─► walls ─► dome hall + stairs
     ─► windows ─► roof-terrace doors ─► door graph + column screens ─► site + perch arc
     ─► sightlines (pass 1) ─► furnishing + mission POIs
     ─► nav grids + sightlines (pass 2) ─► validate

movePerch(blueprint, bearing) ─► same house, sightlines recomputed for the chosen bearing
```

All stages are pure functions of forked RNG streams (`rng.fork('rooms')`, and so on), so adding draws in one stage never reshuffles another.

| Stage | File | What it does |
|---|---|---|
| Style | `core/styles.ts` | Palladian limestone, Georgian red brick, Beaux-Arts mansard, Orangery Bath stone (giant arched windows through both storeys, a flat lead roof with a glass lantern over every top-storey room, all-glass one-storey wings; `giantWindows`, `glassRoofs`): materials, proportions, ornament flags, interior palettes |
| Massing | `layout/massing.ts` | Odd bay count on a grid mirrored about the garden axis; double pile with optional spine corridor; plan type (block, U-garden, U-entrance, H); garden/entrance pavilions; giant or single-storey porticos; two-bay wings; conservatory; 2–3 storeys over a raised plinth |
| Rooms | `layout/rooms.ts` | Symmetric bay compositions per pile, so walls land on bay lines. Ballroom on the axis (optionally double height); paired party rooms (drawing, dining, library, music, card, billiard, gallery…); entrance hall on the axis; grand stair hall beside it; a full-depth **service column** that stacks a service stair on every floor; upper floors reuse the same partition lines No reception room is narrower than 5 m; when the ground floor has fewer than seven party rooms, the first-floor rooms beside the gallery become party rooms. A programme pass then names the rooms: required ones first (great room, dining room, kitchen, library, bar, drawing room, study, two bathrooms), optional ones by chance (dance room, grand salon, cinema, gym, spa, theatre), then the remaining reception rooms once each; the validator rejects a house missing any required room |
| Walls | `layout/walls.ts` | Not authored: swept from room edges. Each run with a constant (room on −side, room on +side) pair becomes a wall; a null side makes it a façade |
| Dome hall | `layout/atrium.ts` | The ball room rises through every storey to a glass dome. One outline, the *void edge* (a U open to the garden windows, back corners rounded), drives everything: offset inward it gives the two arms of the split stair, which sweep from the back of the dance floor round both sides up to the first gallery; offset outward it gives the ring gallery on each upper floor (left, back and right; the garden side stays glass). `hall: 'rotunda'` turns the back of the hall into a true apse with a curved wall; `'gallery'` (default) keeps the rectangular room. Galleries are 3–4.2 m wide, stair arms 2.6–3.6 m; the hall is seven bays wide (five when compact). Above the eaves the hall rises as a lantern: a glazed attic clear of the roofs round it (`dome.deckY`), a glass roof over the whole hall, a glazed drum (`dome.springY`) and a parabolic dome, the largest circle inscribed in the hall. Columns stand only under a gallery. The massing sizes the hall so the stair fits (it grows a deeper garden pavilion first, then a deeper front pile). Curved shapes are handed to the rest of the generator as thin rectangular strips, so walls, nav and sightlines stay rectangular |
| Stairs | `layout/stairs.ts` | U-return service stairs stacked in the service column (tread/riser search, approach zone, stairwell hole in the floor above). The grand stair is the dome hall's |
| Windows | `layout/openings.ts` | One window per bay per storey on the main fronts; wing bays; centred on end walls; **wide French windows to the terrace (about 70% of each bay is glass)**; frosted bathrooms; style dressing (pediments, keystones, balconettes); curtain states |
| Roof terraces | `layout/openings.ts` | A lower wing whose roof is *already* flat becomes a walkable terrace: a glazed door from the storey beside it, balustrade, lamps, tables. No roof is flattened for this, and a terrace nobody can reach is left as a roof |
| Doors | `layout/openings.ts` | A graph problem: mandatory doors (grand axis, enfilade near the windows, wing chains, every room onto its corridor, the hall galleries into the rooms beside and behind them), then connectivity growth from the entrance/gallery, then a **pass-through repair** so no private room is the only way in (promotes the blocker to a landing or morning room). **Column screens:** a wall between two party rooms that sit one behind the other is opened bay by bay, leaving piers, so the view from the garden front carries through. Only party-to-party walls parallel to the garden front are opened; halls, corridors, service and private rooms keep solid walls |
| Site | `site/site.ts`, `site/perch.ts`, `site/terrain.ts` | Raised balustraded terrace with steps, gravel walks, parterre beds with box hedges, fountain, topiary, lamp posts; a **perch arc** of ±38° off the garden axis and an elevation of 0–60° at the same range (`perchEyeAt`), with Poisson-disc tree belts kept out of the cone from *every* bearing on it and a wooded ridge following it; terrain height field; sky parameters (sun 3–6.5° below the horizon behind the house, young crescent moon, cirrus) |
| Furnishing | `interior/*` | Per-room recipes on a constraint-checked placer: inside the clear interior, off door clearances and stairs, not in front of windows it would block, and a flood fill after every placement so every door and mission stand-point stays reachable |
| Mission POIs | `interior/furnish.ts` | Bar, statues, paintings, bookshelves, piano, fireplaces, ledger, clock, safe, globe, window spots, each with an NPC stand point and facing. A **visibility-aware repair** tops up required types in rooms and spots the sniper can see (an island bar if no wall spot is watchable) |
| Sightlines | `analysis/sightlines.ts` | 2.5D tracer from the perch eye: wall planes with openings (glass 0.92, sheer curtain 0.45, drawn 0), floor slabs (open over the hall's void), roofs (open over the dome hall, which is edged by its glazed attic, 0.6, and closed by glass, 0.85; glass, 0.75, over each skylight of an orangery (a roof lantern's well, or a whole wing room)), columns, the hall's stair arms and gallery columns, roof-terrace parapets, tall furniture, statues, tree crowns (0.15), terrain brow. Occluders are binned by bearing, so a ray tests about 30 items |
| Nav | `analysis/nav.ts` | Per-storey 0.25 m grids: walkable cells, room index per cell (terrace = −2), perch visibility per cell; pockets sealed by furniture are pruned |
| Validation | `analysis/validate.ts` | See §3 |

## 3. Validity rules

A blueprint is `validation.ok` only if:

1. Rooms on a storey never overlap; party rooms are at least 3.0 m clear and corridors at least 1.6 m.
2. Every room is reachable on its storey; storeys are linked by stairs; the grand stair and service stairs fit.
3. Each storey's walkable area is one connected component containing every room and every POI stand point.
4. The party floor is at least 180 m².
5. **Indoor** party visibility (ground-floor party rooms; the terrace is reported separately, because it is always in plain view and used to mask opaque houses) falls within `partyVisibility`, default **30–80%**. At least two garden-front party rooms are watchable (20% or more).
6. The spy keeps cover: at least **15%** of the ground floor guests use (party rooms, halls, corridors) is out of the sniper's sight (`sightlines.hiddenShare`).
7. Required mission objects exist, and enough of them are visible from the perch (`requiredPois`, default: 3 statues with 1 visible, 1 bar visible, 6 paintings with 2 visible, a piano, a fireplace and a ledger).

Warnings (never fatal): a bearing on the perch arc that sees very little, a party room with a façade but no window, pass-through violations that survived repair.

Measured over the 48 style × plan × size combinations (5 seeds each, both hall shapes): all valid, mean 1.1 attempts. The sniper sees **44%** of the indoor party floor on average (it was 29% before the wide glazing and column screens) and 54% of the ground floor stays out of sight.

## 4. Blueprint (the contract)

`generateMansion({ seed })` returns a `MansionBlueprint` (`core/types.ts`). It is plain data, JSON-serialisable except the nav grids, which are typed arrays.

| Field | Use |
|---|---|
| `masses`, `levels`, `rooms`, `walls` (with `openings`), `stairs`, `porticos` | Architecture |
| `atrium` | The dome hall: void outline, gallery floor and balustrade runs per storey, columns, curved walls (rotunda), the dome. Its stair is `stairs[…].arms` (curved centrelines), not `flights` |
| `roofTerraces` | Walkable flat wing roofs, each with the door that leads onto it |
| `props` | Furniture with kind, room, transform, size, nav blocking and sightline occlusion |
| `pois` | Mission objects: type, prop, room, stand point and facing, perch visibility |
| `lights` | Every static light: scope (room id or `exterior`), candela, colour, range, optional spot aim |
| `site` | Terrace, gardens, trees, terrain spec, `perch` (eye, target, FOV range, the arc of bearings the sniper may choose and what each sees), sky |
| `nav` | Per-storey grids (`walk`, `room`, `vis`) and `links` (doors, French windows, stairs) |
| `sightlines` | Per-room visibility, terrace, indoor party visibility, share of the ground floor out of sight |
| `validation`, `stats` | Report and metrics |

### For the game

- **Spy/NPC AI.** Route on `nav.levels[*].walk` plus `nav.links`. `vis` per cell tells an AI spy where it is watched; low-`vis` rooms are the blind spots that make "time out of sight" a tell.
- **Missions.** `pois` are the interaction points. Their `visibility` lets mission design require some observable and some hidden actions.
- **Sniper.** `site.perch` gives the camera pose and zoom range; `SightlineTracer` answers "can I see this point?" at runtime.
- **Briefing.** Before the mission, show the plan and let the sniper pick a bearing: `movePerch(blueprint, azimuthDeg, elevationDeg?)` returns the same house with visibility grids, per-room figures and mission-object visibility recomputed for that eye (about 30 ms). `site.perch.options` holds a coarse sample of what each bearing sees, for the picker. `site.perch.elevationOptions` does the same for elevation. Head-on sees deepest into the house; an oblique bearing sees less but different rooms; a high elevation loses the windows and gains the hall's glass roof (top gallery, stair, the far half of the hall floor).
- **Multiplayer.** Send the seed and options. Generation is deterministic, or the server can send the blueprint JSON.

## 5. Rendering (`src/mansion/build`)

`buildMansion(blueprint, { renderer })` returns a `THREE.Group` plus handles.

- **Scoped static lighting** (`lighting.ts`). Blue hour is lit windows, and hundreds of forward point lights would be slow and leak through walls. Each light belongs to a scope: a room, or an 8 m exterior cell. Light data (up to 8 per scope; position, colour, spot aim) lives in a float texture. Static vertices carry `aScope`. A fragment shades only its scope's lights plus an integrating-sphere bounce estimate, and indoor fragments mute the sky IBL. Result: about 400 lights, no leaks, any `MeshStandardMaterial`.
- **Materials** (`materials.ts`, `textures.ts`). Tileable PBR textures are synthesised on the CPU from seeded noise: ashlar, rustication, Flemish-bond brick, slate, zinc, chevron parquet, marble, checkerboard, flagstone, damask, silk, stripe, panelling, book spines, a 16-painting atlas, rugs, lawn with mowing stripes, foliage. Albedos are near-neutral and coloured by vertex tints, so one material serves every room.
- **Meshers.** `arch.ts` covers room shells (each room its own faces and scope), mitred façades, plinth, string courses, cornices, balustraded parapets, quoins, pilasters, window surrounds, triangular and segmental pediments, keystones, balconettes, joinery, glass, double-sided pleated drapes, reveals and door leaves. `roofs.ts` covers hipped, mansard, flat and glass roofs, pavilion pediments, dormers (some lit), chimneys, and porticos in three orders. `atrium.ts` builds the dome hall: gallery floors with stone balustrades, the curved stair (treads, sloping soffit, stringers, handrails), gallery columns, the rotunda's curved wall with its doorways, and outside the hall's lantern (glazed attic, glass roof, drum, parabolic dome); the house roof is cut open over the hall (`GeometryBuilder.splitRect`). The same helper opens an orangery's flat roof under each roof lantern. Also `stairs.ts`, `props.ts` (about 40 prop kinds), and `site.ts` (terrain, gardens, LOD'd instanced trees).
- **Sky** (`sky.ts`). Gradient from lavender haze to deep blue; warm sunset glow on one side, the rosy Belt of Venus opposite; cirrus lit from below; stars; a crescent moon shaded by the actual sun vector. It is baked to PMREM for façade, glass and water reflections.
- **Look.** ACES tone mapping, bloom on bulbs, and `grade.ts` split-tone (cool shadows, warm highlights, +12% saturation, soft vignette).
- **Budget** (grand house, high quality). About 240–300k static triangles, about 1.3M rendered per frame including the shadow pass and trees, about 180 draw calls, and about 2.5 s build time (mostly texture synthesis; a Web Worker or a cache would cut this).

### Art direction (the 30%)

- The blue-hour rule of thumb: lit windows about as bright as the horizon sky (`lightScale` 0.08 against `skyIntensity` 0.85).
- Warm tungsten indoors (about 2400–2700 K) against a cool sky. The sun sits behind the house, so the garden front is backlit and the roofline silhouettes against the glow.
- Window light spills onto the terrace through spot lights aimed down and out, so they light the paving, not the wall. Column floodlights, door lanterns and path lamps add warm pools outside.
- Jewel-tone interiors: Pompeian red dining rooms, sage drawing rooms, panelled libraries. Drapes framing every window read from 200 m.
- Telephoto compression: at 2–10° FOV from 150–200 m the scope view is nearly orthographic, which gives the "possibly isometric" look naturally. The demo also has a true isometric camera.

## 6. Options

```ts
generateMansion({
  seed: 'match-42',
  size: 'grand',                     // compact | grand | palatial
  style: 'palladian',                // palladian | georgian | beauxarts | orangery (default: random)
  massing: 'u-garden',               // block | u-garden | u-entrance | h (default: by style)
  hall: 'gallery',                   // gallery | rotunda: shape of the dome hall
  perchDistance: 180, perchAzimuthDeg: -12,  // the bearing can also be changed afterwards with movePerch()
  perchElevationDeg: 0,              // 0–60° above the horizon; also movePerch(bp, az, el)
  minVisible: 0.45,                  // houses showing less of the indoor party floor are regenerated
  partyVisibility: [0.3, 0.8],       // indoor party floor in view
  requiredPois: { statue: { min: 4, visible: 2 } },
  maxAttempts: 16, navCell: 0.25,
});
```

## 7. Next steps

- NPC rendering: sample `lighting.ambient[room.index]` plus that room's lights for actors, or add a per-room light-probe grid.
- Move texture synthesis and geometry to a worker; cache textures in IndexedDB.
- Interactive state: curtains drawn or opened at runtime, lights switched off (spy sabotage), doors closing. The data is already per opening and per light.
- More parti: bow-fronted salons, quadrant links to pavilions, courtyard plans, a modernist villa style.
- A flat main roof (none of the four styles has one yet) with a stair up to it, so the main roof can be a terrace like the flat wing roofs.
- LOD for façade ornament and props at max scope zoom-out.
