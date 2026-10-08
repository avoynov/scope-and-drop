# scope-and-drop

A sniper spy-deduction game. You lie in the shadows of a treeline at twilight, watch a party inside a country house through your scope, work out which guest is the spy, and take the shot.

This repository holds the game's **mansion generation module**: a seeded, deterministic generator that builds a different, always-valid country house for every match, and a three.js renderer that shows it the way the sniper sees it, at blue hour from 130–210 m away. The look aims for about 70% realism and 30% appeal.

**Live viewer:** https://claude.ai/artifact/6H4rPLDQAAUj5CUFkrxm6c. The link is private; the owner shares it from the page's Share menu.

| Sniper scope | Inside, at full zoom |
|---|---|
| ![scope](docs/images/scope-palladian.jpg) | ![interior](docs/images/zoom-interior.jpg) |
| **Beaux-Arts, from the perch** | **Georgian, from the perch** |
| ![beaux-arts](docs/images/wide-beauxarts.jpg) | ![georgian](docs/images/wide-georgian.jpg) |
| **The estate** | **Sightlines from the perch** (green = watchable, red = blind spot) |
| ![estate](docs/images/orbit-estate.jpg) | ![plan](docs/images/plan-sightlines.jpg) |

---

## Contents

- [Quick start](#quick-start)
- [Using the module](#using-the-module)
- [How generation works](#how-generation-works)
- [What makes a house valid](#what-makes-a-house-valid)
- [The blueprint (data contract)](#the-blueprint-data-contract)
- [Rendering](#rendering)
- [Art direction](#art-direction)
- [Options](#options)
- [Repository layout](#repository-layout)
- [Tooling and tests](#tooling-and-tests)
- [Numbers](#numbers)
- [Design decisions](#design-decisions)
- [Known limitations and next steps](#known-limitations-and-next-steps)
- [References](#references)

---

## Quick start

Requires Node 22+.

```bash
npm install
npm run dev              # demo viewer at http://127.0.0.1:5173
npm test                 # 58 tests: determinism, validity, nav, sightlines, geometry
npm run typecheck
npm run gen -- --seed match-42 --plan            # print a blueprint summary and room list
npm run render -- --seed match-42 --views scope,wide   # headless screenshots into ./renders
npm run build:artifact   # bundle the published viewer into dist-artifact/app.js
```

### Demo viewer

The demo has five views:

| View | What it shows |
|---|---|
| `scope` | Through the sniper's scope. Drag to aim, scroll to zoom from 1.2° to 24° FOV. |
| `wide` | The perch view at 26° FOV. |
| `orbit` | Free orbit around the estate. |
| `iso` | Orthographic view along the perch bearing, looking 35° down. |
| `plan` | Top-down, cut away above the ground floor. |

It has two overlays: a sightline heat map and mission POI markers. It also takes URL parameters:

| Parameter | Effect |
|---|---|
| `seed`, `style`, `massing`, `size` | Select the house. |
| `view`, `fov` | Choose the view and scope zoom. |
| `sight=1`, `pois=1` | Turn the overlays on. |
| `quality=low\|medium\|high` | Render quality. |
| `light`, `sky`, `exposure` | Lighting balance. |
| `nograde`, `split`, `sat` | Colour grade off, split-tone strength, saturation. |
| `shot=1&w=&h=&frames=` | Headless capture mode used by `scripts/render.ts`. |

---

## Using the module

```ts
import { generateMansion } from './src/mansion';
import { buildMansion } from './src/mansion/build';
import { createGradePass } from './src/mansion/build/grade';

// 1. Generate: pure data, deterministic, no WebGL. Safe to run on a game server.
const bp = generateMansion({ seed: 'match-42' });
bp.validation.ok;          // sound building AND fair level
bp.rooms;                  // typed rooms with role, finish, lighting level
bp.pois;                   // mission objects + NPC stand points + perch visibility
bp.nav.levels[0].walk;     // walkable grid (0.25 m), per storey
bp.nav.levels[0].vis;      // per-cell visibility from the sniper (0..255)
bp.site.perch;             // sniper eye, aim target, zoom range

// 2. Build: a three.js scene graph, lit for blue hour.
const mansion = buildMansion(bp, { renderer, quality: 'high' });
scene.add(mansion.root);
scene.fog = mansion.fog;
camera.position.copy(mansion.perch.position);
camera.lookAt(mansion.perch.target);

// 3. Post (recommended): bloom → grade → output, with ACES tone mapping at exposure ~1.4.
composer.addPass(createGradePass());

// Later:
mansion.dispose();
```

Runtime visibility queries ("can the sniper see this point?"):

```ts
import { SightlineTracer, collectOccluders } from './src/mansion';
const tracer = new SightlineTracer(bp.site.perch.eye, collectOccluders({ ...bp, site: bp.site, withProps: true }));
tracer.person(x, z, floorY); // 0..1 visibility of a standing person
```

---

## How generation works

"Diffusion" was taken to mean **an algorithm that generates random but valid maps**, not a neural model. The module is a constrained generative grammar plus repair passes plus a validator. Any house that fails validation is regenerated from a derived seed (`seed#attempt`), so output stays deterministic.

```
seed ─► style ─► massing grammar ─► room partitions ─► walls ─► stairs
     ─► windows ─► door graph ─► site + perch ─► sightlines (pass 1)
     ─► furnishing + mission POIs ─► nav grids + sightlines (pass 2) ─► validate ─► (retry)
```

Every stage draws from its own forked RNG stream (`rng.fork('rooms')`), so changing one stage never reshuffles another. `Math.random` is never used.

| # | Stage | File | What happens |
|---|---|---|---|
| 1 | Style | `core/styles.ts` | **Palladian limestone** (balustraded parapet, Ionic portico, pedimented windows), **Georgian red brick** (Flemish bond, stone quoins, dormers), or **Beaux-Arts** (rusticated base, zinc mansard with dormers, iron balconettes, Corinthian order). Each sets proportions, ornament and interior palettes. |
| 2 | Massing | `layout/massing.ts` | Odd number of bays (3.6–4.5 m) on a grid mirrored about the garden axis, after Stiny & Mitchell's Palladian grammar. Double pile with an optional spine corridor. Plan type `block`, `u-garden`, `u-entrance` or `h`. Optional garden/entrance pavilions, giant or single-storey porticos, two-bay wings, and a glass conservatory. 2–3 storeys on a raised plinth (piano nobile). |
| 3 | Rooms | `layout/rooms.ts` | Symmetric compositions of bays per pile, so walls land on bay lines. Ballroom on the axis, sometimes double height. Mirrored pairs of party rooms (drawing, dining, library, music, card, billiard, morning, gallery). Entrance hall on the axis with the grand stair hall beside it. A full-depth **service column** stacks the service stair on every floor. Upper floors reuse the ground-floor partition lines so walls stack. |
| 4 | Walls | `layout/walls.ts` | Derived, not authored. Room edges on each line are swept; each run with a constant (room on −side, room on +side) pair becomes a wall. A null side means façade. |
| 5 | Stairs | `layout/stairs.ts` | U-return stairs fitted inside stair rooms (riser/tread search, approach zone, stairwell hole cut in the floor above). |
| 6 | Windows | `layout/openings.ts` | One window per bay per storey on the main fronts and wing bays, centred on end walls. French windows to the terrace, frosted glass for bathrooms. Style dressing (pediments, keystones, surrounds, balconettes) and curtain state (open, sheer or drawn). |
| 7 | Doors | `layout/openings.ts` | Solved as a graph problem. First the mandatory doors: grand axis, enfilade near the windows, hall↔stair arch, wing chains, every room onto its corridor or landing. Then connectivity growth from the entrance or landing. Then a **pass-through repair** so a private room is never the only way in; the blocker is promoted to a landing or morning room. |
| 8 | Site and perch | `site/site.ts`, `site/terrain.ts` | Raised balustraded terrace with steps, gravel walks, box-hedged parterres, fountain, topiary and lamp posts. Poisson-disc tree belts keep the cone from perch to façade clear. Terrain height field with a wooded rise for the sniper, whose eye is lifted onto a mound if the brow would cut the sightline. Sky: sun 3–6.5° below the horizon behind the house, young crescent moon, cirrus. |
| 9 | Sightlines, pass 1 | `analysis/sightlines.ts` | Architecture-only visibility per room, used to steer where mission props go. |
| 10 | Furnishing | `interior/*` | Per-room recipes run through a constraint-checked placer. Props stay inside the clear interior, off door clearances and stairs, and out of the way of windows they would block. A flood fill after each placement keeps every door and stand point reachable. About 40 prop kinds; every room also gets its lights. |
| 11 | Mission POIs | `interior/furnish.ts` | Bar, statues, paintings, bookshelves, piano, fireplaces, guest ledger, clocks, safe, globe and window spots, each with an NPC stand point and facing. A **visibility-aware repair** tops up required types in places the sniper can see; if no wall spot is watchable, it places an island bar facing the windows. |
| 12 | Nav and sightlines, pass 2 | `analysis/nav.ts` | Per-storey 0.25 m grids with walkable cells, room index (terrace = −2) and perch visibility. Pockets sealed by furniture are pruned. |
| 13 | Validate | `analysis/validate.ts` | See below. If the house fails, retry with `seed#attempt` (up to 16 attempts) and keep the best. |

---

## What makes a house valid

A blueprint passes (`validation.ok === true`) only if all of these hold:

1. Rooms on a storey never overlap. Party rooms are at least 3.0 m clear and corridors at least 1.6 m.
2. Every room is reachable on its storey, storeys are linked by stairs, and the grand and service stairs fit.
3. Each storey's walkable floor is one connected component containing every room and every POI stand point.
4. The party floor is at least 180 m².
5. **Fair to watch:** party visibility (ground-floor party rooms plus terrace) sits within `partyVisibility` (default **28–85%**), and at least two garden-front party rooms are watchable (≥20%). The spy needs places to hide; the sniper needs something to watch.
6. **Missions exist:** required POIs exist, and enough are visible from the perch. Defaults: 3 statues (1 visible), 1 bar (visible), 6 paintings (2 visible), plus a piano, a fireplace and a guest ledger.

Warnings (never fatal) cover a house with no blind spots, a party room with a façade but no window, and pass-through violations that survived repair.

---

## The blueprint (data contract)

Defined in `src/mansion/core/types.ts`. Everything is plain, JSON-serialisable data except the nav grids, which are typed arrays. Units are metres, y is up, and the garden front faces **+z**, toward the sniper.

| Field | Contents |
|---|---|
| `schema`, `seed`, `attempt`, `options` | Identity and resolved options |
| `style`, `massing`, `bay`, `bays`, `levels`, `groundFloorY` | Architectural parameters |
| `masses` | Main block, pavilions, wings, conservatory with roof specs |
| `rooms` | id, dense `index`, type, role (`party`/`circulation`/`private`/`service`), label, level, rects (`rect`, clear `inner`), floor/ceiling, holes, `lit` (0..1), `finish` (wall/floor/drapery colours), `stage`, `passThrough` |
| `walls` | Centreline, thickness, height, exterior side, room on each side, `openings` (windows/doors with sill/head, glazing, panes, dressing, curtain state) |
| `stairs`, `porticos` | Flights and landings; column positions, order, pediment |
| `props` | Furniture and fittings: kind, room, transform, size, nav blocking, sightline occlusion, optional `poi` |
| `pois` | Mission objects: type, prop, room, `stand` point + facing, `visibility` from the perch |
| `lights` | Every static light: scope (room id or `exterior`), candela, colour, range, optional spot `dir`/`cone` |
| `site` | Terrace, lawn, paths, parterres, fountain, topiary, trees, terrain spec, `perch`, `sky` |
| `nav` | `levels[]` (grids `walk`, `room`, `vis`; origin, cell, cols, rows) and `links` (doors, French windows, stairs) |
| `sightlines` | Per-room visibility, terrace visibility, overall party visibility |
| `validation`, `stats` | Issues, metrics, counts, footprint, generation time |

### For gameplay

- **Spy and NPC AI:** route on `nav.levels[*].walk` plus `nav.links`. `vis` tells an AI where it is watched, so low-visibility rooms are the blind spots that make "time out of sight" a tell.
- **Missions:** `pois` are the interaction points. Their `visibility` lets mission design mix observable and hidden actions.
- **Sniper:** `site.perch` gives camera pose and zoom range, and `SightlineTracer` answers visibility at runtime.
- **NPC lighting:** `mansion.lighting.ambient[room.index]` gives the room's bounce colour; add the room's lights from `bp.lights`.
- **Multiplayer:** send seed + options (generation is deterministic), or send the blueprint JSON from the server.

---

## Rendering

All renderer code is in `src/mansion/build/`. `buildMansion(bp, opts)` returns `{ root, sky, envMap, keyLight, fog, lighting, materials, perch, stats, dispose }`.

- **Scoped static lighting** (`lighting.ts`): blue hour is about hundreds of lit windows. Forward point lights would be slow and leak through walls, so every light instead belongs to a scope: a room, or an 8 m exterior grid cell. Light data (up to 8 per scope: position, colour, range, spot aim) lives in a float texture. Static vertices carry an `aScope` attribute (−1 means exterior, resolved per fragment from world position). A fragment shades only its own scope's lights, plus an integrating-sphere bounce estimate. Indoor fragments mute the sky IBL. This works on any `MeshStandardMaterial` via `onBeforeCompile`.
- **Procedural textures** (`textures.ts`, `noise.ts`): tileable PBR maps (albedo, normal from height, roughness) synthesised on the CPU from seeded value and Worley noise. The set covers ashlar, rustication, Flemish-bond brick with burnt headers, slate, zinc, lead, point-de-Hongrie chevron parquet, planks, marble, checkerboard marble, flagstone, damask, silk, regency stripe, raised panelling, plaster, wood grain, velvet, book spines, a 16-painting atlas, oriental rugs, striped lawn, gravel, foliage, bark and flower beds. No image assets ship with the module.
- **Materials** (`materials.ts`): about 50 recipes. Albedos are near-neutral and colour comes from vertex tints, so one material serves every room. Static geometry is merged per material, giving a few dozen draw calls for the whole estate.
- **Architecture** (`arch.ts`): walls are rendered as faces, not boxes:
  - Each room gets its own inner faces (its finish, its light scope) with skirting, cornice, dado rail, door casings and door leaves.
  - Façades get outer faces mitred at convex and concave corners, with plinth and water table, string courses, stepped cornices, balustraded parapets, quoins, pavilion pilasters, window surrounds, triangular and segmental pediments, keystones and iron balconettes.
  - Windows get sash and French-window joinery with glazing bars, Fresnel glass, double-sided pleated drapes, pelmets and sheers.
- **Roofs and porticos** (`roofs.ts`): hipped (slope-aligned slate UVs), mansard with dormers (some warmly lit), flat with balustrade, and glass conservatory roofs. Also pavilion pediment gables, chimney stacks with pots, and porticos in Doric, Ionic and Corinthian orders with entablature and pediment.
- **Also:** `stairs.ts` (stone or timber U-stairs with balusters); `props.ts` (furniture, chandeliers with glowing candles, bar with bottles, grand piano with raised lid, statues, paintings from the atlas, lamps, lanterns); `site.ts` (terrain, terrace, steps, gardens, fountain, instanced LOD trees and a far tree line).
- **Sky** (`sky.ts`): lavender haze to deep-blue zenith, a warm sunset glow on one side and the rosy Belt of Venus opposite. Cirrus is lit from below, there are stars, and the crescent moon is shaded by the real sun vector. It is baked into a PMREM environment map for façade, glass and water reflections.
- **Post** (`grade.ts`): ACES tone mapping, bloom on bulbs, then a split-tone grade (cool shadows, warm highlights, +12% saturation, soft vignette).

**Quality presets** (`buildMansion(bp, { quality })`):

| Preset | Texture resolution | Anisotropy | Shadow map | Terrain step |
|---|---|---|---|---|
| `low` | ½ | 2 | 1024 | 4 m |
| `medium` | full | 4 | 2048 | 3 m |
| `high` | full | 8 | 4096 | 2 m |

---

## Art direction

The target is about 70% realistic and 30% appealing: real proportions, materials and light, pushed toward a cinematic palette.

- **Blue-hour rule:** lit windows read about as bright as the horizon sky, as in twilight architectural photography (defaults `lightScale` 0.08, `skyIntensity` 0.85, exposure 1.4).
- **Warm against cool:** tungsten interiors (about 2400–2700 K) against a cool sky. The sun sits behind the house, so the garden front is softly backlit and the roofline silhouettes against the glow.
- **Light outside:** window light spills onto the terrace through spot lights aimed down and out, so the paving lights up rather than the wall. Columns are floodlit, door lanterns cast downward cones, and lamp posts line the parterre.
- **Jewel-tone interiors:** Pompeian-red dining rooms, sage and duck-egg drawing rooms, panelled libraries, tone-on-tone damask. Drapes frame every window so colour reads from 200 m.
- **Telephoto compression:** at 1–10° FOV from 130–210 m, the scope view is nearly orthographic, which gives the "possibly isometric" look naturally. A true isometric camera is also provided.

---

## Options

```ts
generateMansion({
  seed: 'match-42',                 // string or number
  size: 'grand',                    // 'compact' (7–9 bays) | 'grand' (9–13) | 'palatial' (13–15)
  style: 'palladian',               // 'palladian' | 'georgian' | 'beauxarts' (default: random)
  massing: 'u-garden',              // 'block' | 'u-garden' | 'u-entrance' | 'h' (default: weighted by style)
  perchDistance: 180,               // metres from the garden façade (default 135–205)
  perchAzimuthDeg: -12,             // degrees off the garden axis (default ±24)
  partyVisibility: [0.28, 0.85],    // acceptable share of the party in view
  requiredPois: { statue: { min: 4, visible: 2 } }, // merged over defaults
  maxAttempts: 16,
  navCell: 0.25,                    // nav/visibility grid resolution (m)
});

buildMansion(bp, {
  renderer,                          // THREE.WebGLRenderer (needed for the PMREM bake)
  quality: 'medium',                 // 'low' | 'medium' | 'high'
  lightScale: 0.08,                  // interior/exterior light strength vs sky
  skyIntensity: 0.85,
  shadows: true,
});
```

---

## Repository layout

```
src/mansion/
  index.ts              public API
  generate.ts           pipeline orchestrator, retry loop, room finalisation
  core/                 rng (forkable sfc32), geom, styles, types (the blueprint schema)
  layout/               massing, rooms, walls, stairs, openings (windows + door graph), porticos
  site/                 site plan (terrace, gardens, trees, perch, sky), terrain height field
  interior/             placer (constraints + flood fill), recipes (per room type), furnish (POIs)
  analysis/             sightlines tracer, occluders, nav grids, validation
  build/                three.js renderer: textures, lighting, materials, geometry,
                        arch, roofs, stairs, props, site, sky, grade, index (buildMansion)
demo/                   dev viewer (Vite)
artifact/               published viewer page (field-dossier UI, mil-dot scope)
scripts/                gen, batch, stress, debug, render, texsheet, png
tests/                  generator.test.ts, builder.test.ts
docs/                   mansion-generation.md (design doc), images/
```

---

## Tooling and tests

| Command | Purpose |
|---|---|
| `npm test` | 58 Vitest tests. Covers byte-identical determinism, validity of 3 seeds for each of the 36 style × plan × size combinations, 100 random seeds, structure (walls/openings/rooms), single connected nav per storey, stairs linking storeys, POIs on walkable floor, sightline sanity (terrace visible, back of house hidden), performance budget, renderer geometry (no NaNs, triangle budget, every bucket has a material, correct light scopes), terrain coverage, and texture range and tiling. |
| `npm run gen -- --seed X [--style] [--massing] [--size] [--plan] [--json out.json]` | Summary, validation issues, room list, JSON export |
| `npm run stress -- 5` | Every style × plan × size, N seeds each |
| `npx tsx scripts/batch.ts 100` | Failure codes per attempt, attempts needed, timing |
| `npx tsx scripts/debug.ts <seed> <attempt>` | Issues, POI and prop counts, nav components per storey |
| `npm run render -- --seed a,b --views scope,wide,orbit,iso,plan [--params "sight=1"] [--format jpeg] [--name file]` | Headless Chromium (SwiftShader) screenshots |
| `npx tsx scripts/texsheet.ts out.png` | Contact sheet of all procedural textures |

---

## Numbers

Measured in this environment: Node 22; headless Chromium with SwiftShader software WebGL, so a real GPU will be faster.

| Metric | Value |
|---|---|
| Validity, all 36 combinations × 5 seeds | 180 / 180 (mean 1.06 attempts) |
| Validity, 100 random seeds | 99 first try, 100 / 100 overall |
| Generation time | ~65–70 ms per house |
| Typical grand house | ~30–50 rooms, ~370 props, ~100–400 lights, ~60 POIs, ~600 trees |
| Static mesh triangles | ~240–300k |
| Rendered per frame (incl. shadows, trees) | ~1.3M triangles, ~180 draw calls |
| Build time | ~2.5–4 s, mostly texture synthesis |
| Published viewer bundle | 935 kB (228 kB gzip) |

---

## Design decisions

- **Why not neural diffusion?** Public floor-plan diffusion models (HouseDiffusion and successors) are trained on apartments, not mansions. Text- or image-to-3D models (TRELLIS, Hunyuan3D) give a sealed shell with no usable interiors or gameplay semantics. The game needs guarantees, so a grammar plus validation is used.
- **Why not Wave Function Collapse?** It guarantees local tile adjacency but not global properties: connectivity, symmetry, room programme and sightline fairness.
- **Why scoped lights instead of three.js point lights?** Hundreds of lights, no light leaking through walls, a handful of shader programs and merged draw calls.
- **Why faces instead of wall boxes?** Each room can carry its own finish and light scope, and corners join cleanly without z-fighting.
- **Fixed perch:** the sniper sits on one wooded rise facing the garden (stage) front, which gets the most glazing. Perch distance and bearing are randomised per seed within fair limits.
- **Engine:** Three.js + TypeScript. The blueprint is engine-agnostic, so another engine could consume it.

---

## Known limitations and next steps

- No NPCs or crowd yet. The next step is a party simulation and spy AI on top of `nav`, `pois` and `vis`.
- Texture synthesis and geometry run on the main thread. Moving them to a Web Worker and caching textures in IndexedDB would cut build time.
- Interactive state (curtains drawn, lights switched off, doors closed) is per opening and per light in the data but not yet toggleable at runtime.
- More parti: bow-fronted salons, quadrant links to pavilions, courtyard plans, a modernist villa style.
- LOD for façade ornament and props at wide zoom.
- Exterior light clusters cap at 8 lights per 8 m cell; very dense lantern layouts are merged.

---

## References

- Stiny & Mitchell (1978), [*The Palladian Grammar*](https://www.andrew.cmu.edu/user/ramesh/teaching/course/48-747/subFrames/readings/Stiny&MItchell-1978-EPB5_5-18.ThePalladianGrammar.pdf)
- Lopes et al. (2010), [*A Constrained Growth Method for Procedural Floor Plan Generation*](https://publications.graphics.tudelft.nl/papers/584)
- [GFLAN: Generative Functional Layouts](https://arxiv.org/pdf/2512.16275) (pass-through rule)
- [BuildingBlock: hybrid diffusion + procedural buildings](https://arxiv.org/html/2505.04051v1) (considered)
- [Twilight architectural photography](https://improvephotography.com/51683/shoot-edit-twilight-photos-real-estate/) (sky ≈ window brightness)

Full design document: [docs/mansion-generation.md](docs/mansion-generation.md).
