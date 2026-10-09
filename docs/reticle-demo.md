# Reticle lab: research and plan

`/demo/reticle/` is a stand-alone page that renders what an eye sees through a first-focal-plane (FFP) riflescope, with two selectable reticles: an SVD / PSO-1 pattern with its rangefinder, and a mil tree. The look follows the two reference frames (a camera behind a tactical scope in high desert): a dark, defocused ocular ring, a blown-out world outside it, a slightly vignetted image inside, and a crisp etched reticle.

![Mil tree at 16×](images/reticle-tree.jpg)

| PSO at 9× | Eyebox shadow (20×, eye 1.6 mm right, 14 mm too far back) |
| --- | --- |
| ![PSO](images/reticle-pso.jpg) | ![Eyebox](images/reticle-eyebox.jpg) |

## 1. The scope being simulated

A good, well set-up 4–20×50 FFP scope (`src/scope/optics.ts`, `SCOPE`):

| Quantity | Value | Why |
| --- | --- | --- |
| Magnification | 4–20× | Covers PSO-1 power (4×) and long-range tree use. |
| Objective | 50 mm | Typical tactical glass. Exit pupil = 50 / mag: 12.5 mm at 4×, 2.5 mm at 20×. |
| Apparent field | 24° | Constant across the zoom range. True field = 2·atan(tan 12° / mag), which gives 6.06° at 4×, the PSO-1's own 6° field. |
| Eye relief | 90 mm | The eye's default position. |
| Distortion | 2.5 % pincushion at the rim | Good scopes keep some pincushion to stop the "rolling ball" (globe) effect when panning. |
| Lateral colour | ±0.6 % at the rim | A faint red/blue split at the field edge. |
| Rim softness | ≈1.5 px at the field stop, rising as r⁶ | Field curvature and coma in a good eyepiece: sharp over most of the field, soft only at the very edge. |

The defaults describe a scope that is good and properly adjusted: the parallax knob is set to the target range and the eye sits on the exit pupil at full eye relief. Zeroing is the exception: the scope is zeroed at 0 m with both turrets at 0, so nothing is dialled and every hold comes from the reticle (shown as "Zero" in the panel). You change power. Everything else is there to experiment with.

## 2. Reticles (`src/scope/reticles.ts`)

Both reticles are lists of resolution-free primitives (lines, polylines, dots, numerals) in their own angular unit. Stroke widths are angular too. Because the reticle sits in the first focal plane, `pxPerUnit = (canvas/2) · mag · tan(unit) / tan(half apparent field)`: the whole pattern, strokes included, grows with power and stays true against the target at every power. At 4× the tree's fine lines go sub-pixel and faint, which is how FFP glass behaves.

### SVD · PSO-1 (unit: Soviet "thousandth", 2π/6000 ≈ 1.047 mrad)

- **Main chevron** at the aiming point, 1.0 × 1.0 thousandth.
- **Three holdover chevrons** below it, cut for the 7N1 round at 400, 600 and 800 m with the 0 m zero and marked 4, 6 and 8 (see section 3).
- **A vertical stadia** from below the last chevron down to the field stop.
- **Lateral scale** every thousandth to ±10, with longer marks at 5 and 10 and "10" labels. It is used for windage, lead and ranging.
- **Stadiametric rangefinder** at lower left: a solid base line and a dashed curve whose height above the line is `1.7 m / range`, marked 2 to 10 (×100 m). Put the feet on the line and slide until the head touches the curve, then read the range. The test `tests/scope.test.ts` checks that the curve brackets a 1.7 m man at exactly its marked ranges. The mannequin on the range is 1.7 m tall overall, so ranging works on it at 412 m.
- **Illumination** (`L` or the Illum button) lights the whole pattern red, as on the PSO-1.

### Mil tree (unit: mrad), after the reference footage

- Heavy 0.32 mil posts from 8 mil (12 mil below) out to the field stop.
- A fine 0.05 mil crosshair with a floating 0.14 mil centre dot. It is hashed every 0.5 mil, with longer marks on whole mils and small numerals at 2, 4 and 6.
- **Tree** rows at 2, 4, 6, 8 and 10 mil of drop. They have crosses on whole mils and dots on halves, and their width grows with drop (±2 to ±6 mil) because wind holds grow with range. Each row is numbered.
- **Illumination** lights the centre dot and the fine crosshair.

## 3. Rounds and holds (`src/scope/ballistics.ts`)

Each reticle is paired with the round its rifle fires. Bullet flight comes from a point-mass solver: standard G7 drag, ICAO sea-level air (1.225 kg/m³, speed of sound 340 m/s), RK4 at 0.5 ms, and no wind or spin drift. I checked it against Federal's published table for the 175 gr SMK at 2600 ft/s (G7 0.25). Velocities land within 1.5 % out to 500 yd. With a 100 yd zero, the drops at 200 and 300 yd are −4.4 in and −15.7 in, exactly as printed.

| Reticle | Round | Bullet | Muzzle speed | G7 BC |
| --- | --- | --- | --- | --- |
| SVD · PSO | 7N1, 7.62×54R | 151 gr (9.8 g) | 823 m/s | 0.206 |
| Mil tree | M118LR, 7.62×51 | 175 gr SMK | 790 m/s | 0.243 (Litz) |

The scope is zeroed at 0 m, so the line of sight and the bore are one line. The hold for a target is then its whole drop angle: `hold = drop / range`.

**SVD: the reticle does the work.** The PSO's three holdover chevrons are cut for the 7N1 at 400, 600 and 800 m, sitting 3.63, 6.39 and 10.28 thousandths under the aiming chevron, and they are marked 4, 6 and 8. Range the target with the curve, then put the matching chevron on it. On a real PSO-1 the same three chevrons serve 1100–1300 m with the drum on 10. With the drum left at 0, they are re-cut for the ranges an SVD actually shoots.

**Mil tree: the shooter does the work.** The tree is generic, so when it is selected an ammo card in the top right shows the round and its speed every 200 m, as printed on a box of match ammunition. The intended hand method:

1. Range the target with the mil relation: `range = size (m) × 1000 / mils`.
2. Flight time ≈ range ÷ the mean of the muzzle speed and the speed at that range.
3. Drop ≈ ½·g·t². Hold (mil) = 1000 × drop ÷ range.

Drag also slows the fall a little, so this reads 5–10 % high, from 0.1 mil at 200 m to 1.1 mil at 800 m. That is close enough for a torso at 400 m. Past 600 m the shooter has to learn the rifle. `handHoldRad` encodes the method, and a test pins the gap.

| Range | Speed | True hold | Hand estimate |
| --- | --- | --- | --- |
| 200 m | 671 m/s | 1.75 mil | 1.84 mil |
| 400 m | 563 m/s | 3.96 mil | 4.28 mil |
| 600 m | 464 m/s | 6.78 mil | 7.48 mil |
| 800 m | 374 m/s | 10.51 mil | 11.58 mil |

## 4. Optical effects (`demo/reticle/composite.ts`)

Each screen pixel is converted to an apparent direction `t = tan(angle)` (the field stop is at `t = tan 12°`). Then:

1. **Naked-eye world.** A second camera renders the scene at 1× with the same angular mapping. It is defocused and over-exposed like the reference camera.
2. **Ocular housing.** This is a black ring a few centimetres from the eye, so it is heavily blurred. Its apparent centre is `−eye/(eyeRelief+Δz)`, so it slides against head movement while the field stop (imaged at infinity) stays put.
3. **Eyebox: scope shadow, crescents, tunnelling.** Every field direction leaves the eyepiece as a bundle as wide as the exit pupil. With the eye `Δz` behind the exit pupil, the bundle for direction `t` is offset by `Δz·t`. The light reaching the eye is the overlap of that disc with the eye pupil (3 mm in daylight), computed exactly as a circle–circle intersection (`eyeboxTransmission`, mirrored in GLSL). This gives:
   - a lateral offset at the right eye relief dims the whole field evenly;
   - too far back, the visible disc follows the head, and a crescent appears on the far side;
   - too close, the crescent flips sides;
   - at high power the exit pupil shrinks, so the eyebox gets tight, as on real glass.
4. **Parallax.** An eye offset `e` in the exit pupil corresponds to a ray `e·mag` off-axis at the objective. When the target is not focused on the reticle plane, the reticle shifts by `aperture · (1/D − 1/P)` radians (`parallaxShiftRad`), where `D` is the range to whatever the crosshair rests on (ray-marched each frame) and `P` is the parallax knob. Set `P = D` and the reticle stays glued to the target however the head moves.
5. **Focus.** The parallax knob is also the focus. The blur circle is `objective · |1/D − 1/P|` and is applied to the image but not the reticle.
6. **Distortion, lateral colour and rim softness** as in the table above. They are applied to the image and the FFP reticle alike, because both pass through the erector and eyepiece.
7. **Mirage.** Two octaves of flowing noise displace the image (not the reticle) by about 25 µrad. It is invisible at 4× and boils at 20×, and it is faded out for short ranges.
8. **Veiling glare.** A small lift of the blacks, as with real glass.
9. **Hold.** Breathing sway (about 0.3 mrad figure-eight), a heartbeat twitch, and a slow sub-millimetre head wander on a solid cheek weld. Everything moves together, because the reticle is fixed to the tube.

## 5. The range (`demo/reticle/scene.ts`)

A high-desert flat seen from a low rise: procedural terrain with hills beyond 1.5 km, and a ground shader built from band-limited fbm with an integer pcg2d hash (float hashes streak at world coordinates in the hundreds of metres). It has 40k sagebrush clumps, a 4 m boulder, a white mannequin torso on an orange stake at 412 m, a wire fence with T-posts at about 360 m, exponential haze, and a sun over the shooter's shoulder with shadows around the target.

## 6. Controls

| Input | Action |
| --- | --- |
| Drag / one finger | Aim (1 px of drag = 1 apparent px, so the view feels locked to the glass) |
| Wheel / pinch | Power 4–20× |
| W A S D | Move the eye across the exit pupil |
| Q / E | Eye relief closer / further |
| R | Switch reticle |
| L | Illumination |
| H | Hide the panel |

The panel also has the parallax knob (50 m to ∞), eye sliders, toggles for sway, mirage and head wander, and live readouts: true field, exit pupil, aim range, parallax error and the target's subtension in the current reticle's unit.

URL parameters: `reticle=pso|tree`, `mag`, `par`, `ex`, `ey`, `ez` (mm), `pupil`, `illum`, `nosway`, `nomirage`, `nodrift`, `noshadow`, `hud=0`, and `shot=1&t=` for deterministic stills. To render the stills: `OUT=renders npx tsx scripts/reticle.ts "name=reticle=tree&mag=16&hud=0"`.

## 7. Next steps (not built)

- Turrets: elevation and windage clicks that move the reticle image, plus a zero-stop. This also gives real holdover use for the PSO chevrons.
- Shooting: fire along the bore with `trajectory()`, add wind drift, and show splash or impact feedback, so the chevrons and the tree's holds can be tested.
- Depth-aware focus, so the foreground and far hills blur separately when parallax is set to the target.
- Low light: a 7 mm eye pupil, a dimmer image, and illumination brightness steps.
- Bringing the scope composite into the mansion demo's `scope` view in place of its CSS reticle.
