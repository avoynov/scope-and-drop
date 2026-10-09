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
| Pupil aberration | 2.5 mm at the field stop, rising as r² | Bundles from the edge of the field cross the axis a little nearer the eyepiece. An eye that slips sideways sees a crescent come in from that side rather than an even dimming. |

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
2. **Ocular housing.** The eyepiece bell is part of the 3D rifle (section 6), a few centimetres from an eye focused far away, so it is heavily blurred. It slides against head movement while the field stop (imaged at infinity) stays put.
3. **Eyebox: scope shadow, crescents, tunnelling.** Every field direction leaves the eyepiece as a bundle as wide as the exit pupil, and the bundles cross at the exit pupil. Light that appears to come from direction `t` travels the opposite way, so with the eye `Δz` behind the exit pupil the bundle for `t` is centred at `−Δz·t`. Edge bundles cross a little early (the pupil aberration above). The light reaching the eye is the overlap of that disc with the eye pupil (3 mm in daylight), computed exactly as a circle–circle intersection (`eyeboxTransmission`, mirrored in GLSL). This gives:
   - too far back, the exit pupil works like a window in front of the eye, so a crescent comes in from the side the head has moved to;
   - too close, the crescent comes in from the other side;
   - at the right eye relief, a sideways slip darkens the eye's own side first, then dims the whole field;
   - at high power the exit pupil shrinks, so the eyebox gets tight. Even with the eye centred, the rim is about 20 % darker at 16×, as on real glass.
4. **Pan shadow.** Prone, the rifle swings about its front support (bipod or bag), about 600 mm ahead of the eye, so the eyepiece moves the opposite way to the muzzle. The head rides along on the cheek weld but trails it by a 30 ms lag. In a quick swing that leaves the eye off the exit pupil toward the way the muzzle is going, so a crescent creeps in from the leading edge and clears once the swing stops. Panning right at 4°/s at 12× puts the eye 1.3 mm off: the right edge drops to about half and the centre to three quarters. The **Pan shadow** slider scales the lag from 0 (head glued to the stock) through 1 (the default) to 2 (a loose cheek weld, which blacks out a quick swing).

   | Panning right at 4°/s, 12×, Pan shadow 1 | Pan shadow 2 |
   | --- | --- |
   | ![Pan shadow 1](images/pan-1.jpg) | ![Pan shadow 2](images/pan-2.jpg) |

5. **Parallax.** An eye offset `e` in the exit pupil corresponds to a ray `e·mag` off-axis at the objective. When the target is not focused on the reticle plane, the reticle shifts by `aperture · (1/D − 1/P)` radians (`parallaxShiftRad`), where `D` is the range to whatever the crosshair rests on (ray-marched each frame) and `P` is the parallax knob. Set `P = D` and the reticle stays glued to the target however the head moves.
6. **Focus.** The parallax knob is also the focus. The blur circle is `objective · |1/D − 1/P|` and is applied to the image but not the reticle.
7. **Distortion, lateral colour and rim softness** as in the table above. They are applied to the image and the FFP reticle alike, because both pass through the erector and eyepiece.
8. **Mirage.** Two octaves of flowing noise displace the image (not the reticle) by about 25 µrad. It is invisible at 4× and boils at 20×, and it is faded out for short ranges.
9. **Veiling glare.** A small lift of the blacks, as with real glass.
10. **Hold.** Breathing sway (about 0.3 mrad figure-eight), a heartbeat twitch, and a slow sub-millimetre head wander on a solid cheek weld. Everything moves together, because the reticle is fixed to the tube.

## 5. Recoil (`src/scope/recoil.ts`)

Space, or **Recoil** in the panel, plays what the eye sees when the rifle fires. Nothing is fired: there is no bullet, only the gun's motion.

| Before | 16 ms | 80 ms |
| --- | --- | --- |
| ![Before](images/recoil-0.jpg) | ![16 ms](images/recoil-1.jpg) | ![80 ms](images/recoil-2.jpg) |
| **200 ms** | **350 ms** | **3 s** |
| ![200 ms](images/recoil-3.jpg) | ![350 ms](images/recoil-4.jpg) | ![3 s](images/recoil-5.jpg) |

SVD at 8×. The scope slams toward the eye and the picture tunnels. The eye drops below the exit pupil, so the picture goes dark apart from a crescent of light at the bottom, which widens as the head settles. By 0.35 s the picture is back, full of sky, and the rifle settles 1.2° high with the target at the bottom edge. At 8× the artifacts last about 0.3 s. At higher power the eyebox is tighter and they last longer.

**How hard each rifle kicks.** Free recoil, with SAAMI's rule that the powder gas leaves at 1.75 × the bullet's speed:

| Rifle | Round | Impulse | Mass | Free recoil |
| --- | --- | --- | --- | --- |
| SVD (PSO reticle) | 7N1: 9.8 g at 823 m/s, 3.1 g of powder | 12.5 N·s | 4.3 kg | 2.9 m/s, 18 J |
| Bolt rifle (mil tree) | M118LR: 11.3 g at 790 m/s, 2.9 g of powder | 12.9 N·s | 6.8 kg | 1.9 m/s, 12 J |

The lighter SVD kicks harder, so its motions are about 1.5 × the bolt rifle's.

**Three motions overlap**, and each one drives an artifact from section 4:

1. **The scope comes back at the eye.** The rifle slams into the shoulder, so 16 ms after the shot the eyepiece is 24 mm closer than its eye relief (17 mm for the bolt rifle). The shoulder pushes it forward again only slowly, with a 0.45 s time constant (0.38 s for the bolt rifle): it is still 16 mm too close at 0.2 s and 10 mm at 0.4 s. Too close, the bundles from the edge of the field miss the eye pupil, and the picture shrinks to a tunnel inside a thick black ring.
2. **The muzzle rises.** It peaks at 3.1° about 90 ms after the shot (2.0° at 105 ms for the bolt rifle), a little to the right, with a short 26 Hz ring-down of the tube on top. Then it falls back to a rise that stays: 1.2° up and 0.2° right for the SVD, 0.8° up for the bolt rifle.
3. **The head is jolted off the cheek weld.** It settles back with a 0.28 s lag, so the scope tilts up to 2.6° against the eye at about 80 ms. The whole sight picture, reticle and field stop included, moves with that tilt, and the ocular housing jumps in the naked-eye view. The eyepiece also swings up about the shoulder, 120 mm behind the eye. That keeps the eye 4–5 mm below the exit pupil from about 40 to 130 ms, and more than 2 mm low for 0.2 s. At 8× (a 6.25 mm exit pupil) the picture goes dark apart from a crescent of light at the bottom, which widens as the head settles.

**Motion blur.** Each frame stands for a 1/60 s exposure. While the rifle moves, the view through the eyepiece is averaged over 16 jittered moments of that exposure: the scene sweeps through the field at the rifle's rate times the magnification (up to 110°/s × 8 in the first frames), the field stop and reticle sweep with the tilt, and the eye slides over the exit pupil. At rest the shader takes the single-sample path.

**The rifle stays where it ends up.** When the motion has died away (3 s, the last of it being the slow return of eye relief), its lasting rise is folded into the aim. Nothing returns on its own: the shooter drags the rifle back down onto the target, as after a real shot. At 8× the target sits near the bottom of the field. From about 10× (15× with the bolt rifle) it is out of the field. A second shot before the first settles starts from wherever the rifle is. Each shot varies, as a real shooter's hold does. Rise varies ±20 % and kick ±15 %. Drift is mostly right but spreads widely, and about one shot in fifty drifts a little left. The tube rings at a random phase and strength. One hidden "hold" draw ties the shoulder and cheek together: a loose hold lets the scope come back up to 25 % further, peak later, take longer to push out again, and leave the head jolted longer. The stock also slaps the cheek up to 1.5 mm sideways, so the returning crescent is not always centred. Every shot still blacks out long enough to see.

Tests check, for both rifles, that the kick peaks at more than 1.8 × the lasting rise, that the scope comes at least 80 % of its travel toward the eye, and that the eye is low at 50 ms. They also check that the scope stays more than 10 mm too close for at least 0.2 s and the eye more than 2 mm low for at least 0.15 s, so the artifacts last long enough to see, and that everything but the lasting rise is gone at the end.

## 6. Scope-in and scope-out (`src/scope/ads.ts`, `demo/reticle/near.ts`)

![Scope-in at 8×](images/scope-in-filmstrip.jpg)

**F**, a right-click or **Scope in / out** in the panel moves the head between the cheek weld and looking over the scope. The shooter is prone with the rifle on its bipod, so the rifle does not move: the head does, and every artifact below falls out of the optics model in section 4 driven by where the eye is.

**The motion.** Head up, the eye is about 62 mm above the scope axis and 36 mm behind the exit pupil, high enough to see the target over the turrets. The path follows the motor-control literature on aimed movements:

- Every stroke is minimum-jerk (Flash & Hogan, 1985), a quintic with a bell-shaped speed profile that peaks near 0.29 m/s.
- Going in, a fast primary stroke (about 0.45 s) lands 0.5–1.7 mm high, up to 1.2 mm to the side and 6–12 mm too far back. A slower corrective stroke (about 0.26 s) overlaps it and takes the eye home (Meyer et al., 1988). Each attempt lands differently.
- The head drops first and slides forward along the comb after, so the eye reaches the eyebox from above and behind. The cheek meets the comb just before the end, and the tissue gives about half a millimetre.
- Going out, the cheek peels off first, so the eye backs off the eyepiece before it rises. This takes about 0.4 s.
- The gaze stays on the target, because the vestibulo-ocular reflex cancels head rotation. Torsional VOR gain is only about 0.6, so the view rolls about a degree as the head cants onto the stock and settles level.
- Pressing F mid-move reverses from wherever the head is, at the speed it is moving.

**What the eye sees, in order, going in:**

1. **The rifle, out of focus.** The scope and rifle are modelled to scale: a 47 mm ocular bell with 41 mm of glass recessed 2.5 mm, a ribbed power ring with its throw lever, a 30 mm tube, turrets with a white zero mark, a 50 mm objective bell, rings, rail, action, bolt and barrel. They are rendered from the eye and defocused as a 3 mm pupil focused on the target sees them: a point d metres away spreads over pupil/d radians. That is 30–40 px at the eyepiece and a few px at the muzzle. The blur is a depth-aware scatter-as-gather (each point spreads over its own disc, with energy conserved), plus a smear along the eyepiece's sweep across the view during the 1/60 s exposure.
2. **Dark glass.** Until the eye is close to the axis, the eyepiece shows only a faint green-magenta coating sheen of the sky.
3. **A crescent at the bottom.** The light comes through the exit pupil. Coming in from above and behind, the first light appears in the lower part of the eyepiece, then grows as the eye drops. The image pops in over the last few millimetres, which is what real glass does.
4. **The tunnel opens.** The primary stroke stops slightly back, so the field is a disc inside a black ring that fills as the corrective stroke closes the eye relief.
5. **Adaptation.** The eye adapts to the dimmer image in the glass over about 0.45 s, and to the open range over about 0.2 s (light adaptation is the faster of the two). Head up, the range is sharp and normally exposed. On the weld, the surroundings take the over-exposed, blurred look of the reference footage.

Drag sensitivity follows adaptation: locked to the glass on the weld, locked to the naked-eye view with the head up.

URL parameters for stills: `out` starts with the head up; `adsin=<s>` and `adsout=<s>` take the still that long after the head starts down or up.

## 7. The range (`demo/reticle/scene.ts`)

A high-desert flat seen from a low rise: procedural terrain with hills beyond 1.5 km, and a ground shader built from band-limited fbm with an integer pcg2d hash (float hashes streak at world coordinates in the hundreds of metres). It has 40k sagebrush clumps, a 4 m boulder, a white mannequin torso on an orange stake at 412 m, a wire fence with T-posts at about 360 m, exponential haze, and a sun over the shooter's shoulder with shadows around the target.

## 8. Controls

| Input | Action |
| --- | --- |
| Drag / one finger | Aim (1 px of drag = 1 apparent px, so the view feels locked to the glass) |
| Wheel / pinch | Power 4–20× |
| W A S D | Move the eye across the exit pupil |
| Q / E | Eye relief closer / further |
| F / right-click | Scope in / scope out |
| Space | Recoil (no bullet) |
| R | Switch reticle |
| L | Illumination |
| H | Hide the panel |

The panel also has the parallax knob (50 m to ∞), eye sliders, the Pan shadow slider, toggles for sway, mirage and head wander, a Recoil button, and live readouts: true field, exit pupil, aim range, parallax error and the target's subtension in the current reticle's unit.

URL parameters: `reticle=pso|tree`, `mag`, `par`, `ex`, `ey`, `ez` (mm), `pupil`, `illum`, `nosway`, `nomirage`, `nodrift`, `noshadow`, `pan` (Pan shadow, 0–2), `hud=0`, and `shot=1&t=` for deterministic stills. Add `recoil=0.08` for a still 80 ms after the trigger, or `panrate=4,0` for one taken mid-swing (right and up, in °/s). To render the stills: `OUT=renders npx tsx scripts/reticle.ts "name=reticle=tree&mag=16&hud=0"`.

## 9. Next steps (not built)

- Turrets: elevation and windage clicks that move the reticle image, plus a zero-stop. This also gives real holdover use for the PSO chevrons.
- Shooting: fire along the bore with `trajectory()` as the recoil starts, add wind drift, and show splash or impact feedback, so the chevrons and the tree's holds can be tested. The bullet takes about 0.6 s to reach 412 m and the picture is back after about 0.2 s, so at low power a shooter who follows through can spot their own hit.
- Depth-aware focus, so the foreground and far hills blur separately when parallax is set to the target.
- Low light: a 7 mm eye pupil, a dimmer image, and illumination brightness steps.
- Bringing the scope composite into the mansion demo's `scope` view in place of its CSS reticle.
