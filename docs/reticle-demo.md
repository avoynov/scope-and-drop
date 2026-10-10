# Reticle lab: research and plan

`/demo/reticle/` is a stand-alone page that renders what an eye sees through a first-focal-plane (FFP) riflescope, with three rifles and their reticles: an SVD with a PSO-1 pattern and its rangefinder, a bolt rifle with a mil tree, and the game's rifle, a suppressed VSS with a PSO-1-1 pattern (section 3 says why). The look follows the two reference frames (a camera behind a tactical scope in high desert): a dark, defocused ocular ring, a blown-out world outside it, a slightly vignetted image inside, and a crisp etched reticle.

![Mil tree at 16×](images/reticle-tree.jpg)

| PSO at 9× | Eyebox shadow (20×, eye 1.6 mm right, 14 mm too far back) |
| --- | --- |
| ![PSO](images/reticle-pso.jpg) | ![Eyebox](images/reticle-eyebox.jpg) |

## How to aim

The short version, for players new to scopes. The numbers behind it are in section 3.

1. **Leave the drum on 1.** The rifle is then zeroed at 100 m, and that is the only setting the chevrons are made for.
2. **Find the range.** Use the curve at lower left: put the man's feet on the straight line, then move until his head touches the dashed curve. The number there is the range in hundreds of metres. The mannequins are 1.7 m tall, like the man the curve is drawn for.
3. **Pick your hold.** Each chevron below the centre is for one range. Put the matching chevron on the chest, not the top one.
   - **At a marked range**, use its chevron. The top chevron is for 100 m.
   - **Between two marks**, hold between their chevrons in proportion. For 500 m on the SVD, hold halfway between the 4 and the 6. Holding the nearest chevron instead can miss by over half a metre.
   - **VSS (the game's rifle):** there's a chevron every 50 m. The small ones are 150, 250 and 350. At the game's 183 m, hold a third of the way from the 2 up to the small 150 chevron.
   - **Or dial it instead:** turn the drum to the range and aim with the top chevron. That's exact, but the other chevrons are then wrong until you turn it back to 1.
4. **Range carefully.** With the slow VSS bullet, 16 m of range error is about 18 cm at 183 m, enough to miss the chest. If unsure, range again.
5. **Wind.** A crosswind pushes the bullet downwind, so aim into it, using the marks on the horizontal line (one per thousandth). The panel shows the wind where you lie, and gusts change it from shot to shot.
   - At 2.5 m/s, the default: about 0.3 thousandth on the VSS at 183 m (6 cm), 0.7 on the SVD at 412 m (30 cm), 1.6 on the SVD at 800 m (1.4 m).
   - Wind from straight ahead or behind barely matters. Half-angle wind (from 1–2 or 10–11 o'clock) needs about half the hold.
6. **Watch the hit and correct.** Stay on the scope after the shot. The VSS's light kick keeps the target in view, and its bullet takes 0.7 s to get there. If it lands low, hold that much higher next time. If it lands left, hold right.

**Mil tree (bolt rifle):** the tree isn't made for any round, so work the hold out from the ammo card. Turn the dial to 0 and the hold in mil is 1000 × drop ÷ range, with the drop worked out from the bullet's speed (section 3).

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

The defaults describe a scope that is good and properly adjusted: the parallax knob is set to the target range and the eye sits on the exit pupil at full eye relief. Each rifle is zeroed at 100 m: its elevation drum sits on 1, where the cut reticles are true, and every hold past that comes from the reticle (the drum on top of the scope, and "Zero" in the panel). The drum turns in 50 m clicks from 1 up to its last mark (section 3). You change power. Everything else is there to experiment with.

## 2. Reticles (`src/scope/reticles.ts`)

All three reticles are lists of resolution-free primitives (lines, polylines, dots, numerals) in their own angular unit. Stroke widths are angular too. Because the reticle sits in the first focal plane, `pxPerUnit = (canvas/2) · mag · tan(unit) / tan(half apparent field)`: the whole pattern, strokes included, grows with power and stays true against the target at every power. At 4× the tree's fine lines go sub-pixel and faint, which is how FFP glass behaves.

### SVD · PSO-1 (unit: Soviet "thousandth", 2π/6000 ≈ 1.047 mrad)

- **Main chevron** at the aiming point, 1.0 × 1.0 thousandth.
- **Three holdover chevrons** below it, cut for the 7N1 round at 400, 600 and 800 m with the 100 m zero (drum on 1) and marked 4, 6 and 8 (see section 3).
- **A vertical stadia** from below the last chevron down to the field stop.
- **Lateral scale** every thousandth to ±10, with longer marks at 5 and 10 and "10" labels. It is used for windage, lead and ranging.
- **Stadiametric rangefinder** at lower left: a solid base line and a dashed curve whose height above the line is `1.7 m / range`, marked 2 to 10 (×100 m). Put the feet on the line and slide until the head touches the curve, then read the range. The test `tests/scope.test.ts` checks that the curve brackets a 1.7 m man at exactly its marked ranges. The mannequin on the range is 1.7 m tall overall, so ranging works on it at 412 m.
- **Illumination** (`L` or the Illum button) lights the whole pattern red, as on the PSO-1.

### VSS · PSO-1-1 (unit: thousandth), the game's rifle

- **Main chevron** at the aiming point, as on the PSO.
- **Six holdover chevrons** cut for the subsonic SP-5 with the 100 m zero (drum on 1): numbered ones at 200, 300 and 400 m (6.2, 12.9 and 20.0 thousandths down) and smaller plain ones at 150, 250 and 350 m. 100 m is the zero, so the aiming chevron is its mark. The real 9×39 scopes (PSO-1-1, PSO-1M2-1) have a single chevron, a range drum cut for the round and a rangefinder out to 400 m. With the drum left on 1 the drum's job past 100 m moves onto the glass, as it does on the SVD's PSO. The 50 m steps are there because at the game's range the hold changes by a thousandth every 16 m.
- **Lateral scale** as on the PSO, and the vertical stadia below the last chevron.
- **Stadiametric rangefinder** re-cut for 100–400 m, as on the 9×39 scopes: base line, dashed 1.7 m curve, a tick every 50 m and numbers 1 to 4 (×100 m). A test checks that the drawn ticks bracket a 1.7 m man at their ranges.
- **Illumination** lights the whole pattern.

![VSS at 8×, held for the 183 m mannequin](images/vss-8x.jpg)

VSS at 8×, drum on 1, held for the mannequin at 183 m: the point 5.1 thousandths down, a third of the way from the 200 m chevron up to the 150 m one, is on the chest.

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
| VSS · PSO-1-1 | SP-5, 9×39 | 250 gr (16.2 g), 36 mm spire-point boat-tail | 280 m/s | 0.21 (estimated) |

The SP-5's speed is the chronograph's: 905 ft/s (276 m/s) from a VSS, against 270–290 m/s in published tables. No BC is published for it. At Mach 0.8 a boat-tail bullet drags about 1.28 times as much as the G7 shape, which gives G7 ≈ 0.21 (G1 ≈ 0.40 at this speed). The guess hardly matters at the game's range, because the drop there comes from the flight time: G1 0.28 instead would move the 183 m hold by 0.3 thousandth.

### Zero and the elevation drum

Every rifle is zeroed at 100 m, as the SVD's manual has it: zeroing is done at 100 m with the drum on 1. The drum's numbers are ranges in hundreds of metres, and on a mark the rifle is zeroed at that range: the bore is tilted up under the scope just enough for the bullet to climb back to the line of sight there. The scope sits above the bore (`sightM`), so the bullet starts below the line of sight and that offset counts too:

`tilt(Z) = (drop(Z) + h) / Z`, and the hold below the line of sight at range R is `(drop(R) + h) / R − tilt(Z)`.

The manual pins the sight height. Its zeroing check is fired at 100 m with the drum on 3 and expects the hits 14 cm above the aim. With the 7N1 model that comes out at 14 cm only for a scope 70 mm over the bore (tested), so the SVD's is 70 mm. The VSS's PSO-1-1 sits on the same side rail (70 mm, assumed) and the bolt rifle's scope is 58 mm up, as modelled.

| Rifle | Drum | Clicks | 100 m zero tilt |
| --- | --- | --- | --- |
| SVD · PSO-1 | 1 to 10 (100–1000 m) | 50 m | 1.45 thousandths |
| Bolt rifle | Ballistic dial cut for the M118LR (as Leupold's CDS dials are), 0, then 1 to 10 | 50 m | 1.41 mil |
| VSS · PSO-1-1 | 1 to 4 (100–400 m) | 50 m | 6.8 thousandths |

As on the real PSO-1, the drum starts at 1 ([Wikipedia](https://en.wikipedia.org/wiki/PSO-1): 100–1000 m in 50 or 100 m steps). On the SVD and VSS a 0 (bore parallel to the line of sight) would only throw the cut chevrons off, so they have none. The bolt rifle's dial keeps one: its tree is not cut for a round, and on 0 the mil-tree hold is simply drop ÷ range (step 4 below drops out). The drum is part of the 3D scope: a knurled drum with its numbers engraved round its side (15° a detent, so the SVD's 10 and 1 sit far apart), read against a white index line on the saddle behind it. The rifle stays blurred, as the eye is on the range. With the head up (F) the shooter looks down at the drum when the pointer is on it or `[` or `]` clicks it: the eye focuses on it, 0.29 m away, over a few tenths of a second, so the numbers come sharp and the range behind goes soft. It stays there while the pointer does and for 1.5 s after the last click or after the pointer leaves, then the eye goes back to the range. Drag the drum sideways, scroll over it or tap either side of it; each detent clicks. On the weld it can't be seen, but `[` and `]` still click it by feel, as shooters count clicks. Each rifle keeps its own drum setting. A cut reticle is glass, so its chevrons are true only with the drum on 1: on 3 the SVD's chevrons shoot high, and the shooter on a higher drum setting aims with the top chevron at that range instead. That is how the real PSO-1's own chevrons work, true only with the drum on 10.

Sources: [snakeproject: bringing the SVD to normal battle](https://snakeproject.ru/rubric/article.php?art=nsd05012024) (100 m, drum on 3, control point 14 cm above the aim), [PSO instruction manual](https://sheldy.ru/userfiles/files/PCO(1).pdf) (zeroing at 100 m with the drum on 1, 5 cm per click at 100 m), [Wikipedia: PSO-1](https://en.wikipedia.org/wiki/PSO-1).

**SVD: the reticle does the work.** The PSO's three holdover chevrons are cut for the 7N1 at 400, 600 and 800 m with the drum on 1, sitting 2.39, 5.10 and 8.96 thousandths under the aiming chevron, and they are marked 4, 6 and 8. Range the target with the curve, then put the matching chevron on it. On a real PSO-1 the same three chevrons serve 1100–1300 m with the drum on 10. With the drum left on 1, they are re-cut for the ranges an SVD actually shoots.

**VSS: the reticle does the work, and the range is everything.** The SP-5 leaves at 280 m/s and is still doing 260 m/s at 183 m, so it drops 2.2 m on the way and takes 0.68 s. Range the target with the curve and hold the matching point between the chevrons: 5.1 thousandths at 183 m with the drum on 1, a third of the way from the 200 m chevron up to the 150 m one. A 10 m range error puts the bullet 13 cm high or low, so the 50 m chevrons and the rangefinder carry the shot. Wind matters less than the flight time suggests: the heavy bullet barely slows, so a full 3 m/s crosswind moves it only 7.5 cm (0.4 thousandth) at 183 m.

**Mil tree: the shooter does the work.** The tree is generic, so when it is selected an ammo card in the top right shows the round and its speed every 200 m, as printed on a box of match ammunition. The intended hand method:

1. Range the target with the mil relation: `range = size (m) × 1000 / mils`.
2. Flight time ≈ range ÷ the mean of the muzzle speed and the speed at that range.
3. Drop ≈ ½·g·t². Hold from the bore line (mil) = 1000 × (drop + sight height) ÷ range.
4. Take off the same for the zero, 100 m: about 1.4 mil with the dial on 1. The card's header gives the zero and the sight height. With the dial on 0 there is no zero to take off, and the sight height alone stays (0.14 mil at 412 m).

Drag also slows the fall a little, so step 3 reads 5–10 % high. With the zero taken off, that error is a bigger share of what is left: the method reads 12–20 % high, from 0.1 mil at 200 m to 1.1 mil at 800 m. That is close enough for a torso at 400 m. Past 600 m the shooter has to learn the rifle. `handHoldRad` encodes step 3, and a test pins the gap. Skipping the sight height in steps 3 and 4 adds another 0.4 mil high at 400 m.

| Range | Speed | True hold, drum on 1 | Hand estimate |
| --- | --- | --- | --- |
| 200 m | 671 m/s | 0.63 mil | 0.76 mil |
| 400 m | 563 m/s | 2.69 mil | 3.06 mil |
| 600 m | 464 m/s | 5.47 mil | 6.21 mil |
| 800 m | 374 m/s | 9.18 mil | 10.29 mil |

### Which rifle the game needs

The mansion module defines no weapon. What it fixes is the shot: prone in a treeline at blue hour, 130–210 m from the house, into a lit party through glass (French windows that are about 70 % glass, sheer curtains, a glass dome over the hall), at one guest among many. The lab's first two rifles were picked for a 412 m desert range instead:

| At the game's range (183 m), 100 m zero | SVD + 7N1 | Bolt rifle + M118LR | VSS + SP-5 |
| --- | --- | --- | --- |
| Hold | 0.4 thousandth, just under the main chevron | 0.5 mil | 5.1 thousandths, between the 150 and 200 m chevrons |
| Flight time | 0.24 s | 0.25 s | 0.68 s |
| Sound along the path | A supersonic crack heard by everyone near the line of fire | The same | None: the bullet is slower than sound |
| Report at 1 m | Over 160 dB | Over 160 dB | About 121 dB, measured on a VSS with SP-5 |
| Free recoil | 18 J | 12 J | 3.2 J |
| Effective range | 800 m | 800 m and more | 400 m by day, 300 m at night |

The VSS "Vintorez" is what the job is built for: an integrally suppressed, subsonic sniper rifle designed for covert shots at 200–300 m, with the PSO-1-1 scope cut for its 9×39 round. It keeps the lab's Soviet PSO lineage (same unit, same chevrons and rangefinder), and it makes the shot a skill rather than a formality: at 183 m the bullet drops 2.2 m, so ranging the target and choosing the hold decide the hit, where the 7N1's 0.4 thousandth would barely need a hold at all. Its light recoil keeps the target in the glass, so the shooter sees what the shot did, which a deduction game needs.

So the VSS with SP-5 is the game's rifle. The SVD and the bolt rifle stay as they were, on the 412 m mannequin, as the loud long-range comparisons. A second mannequin stands at 183 m for the VSS. Glass is the next piece (section 10).

Sources: [SADJ: the elusive Vintorez](https://sadefensejournal.com/the-elusive-vintorez-9x39-sniper-rifle/2/) (chronograph; sound levels: SP-5 120.8 dB, an unsuppressed 9×39 159.8 dB), [Wikipedia: AS Val and VSS](https://en.wikipedia.org/wiki/AS_Val_and_VSS_Vintorez), [Wikipedia: PSO-1](https://en.wikipedia.org/wiki/PSO-1) (the PSO-1M2-1's single chevron and 400 m rangefinder), [Modern Firearms: VSS](https://modernfirearms.net/en/sniper-rifles/standart-caliber-rifles/russia-standart-caliber-rifles/vss-eng/) (3.41 kg loaded with the scope), [militaryroom: VSS](http://militaryroom.rusff.me/viewtopic.php?id=1848) (SP-5 bullet 36 mm, 16.2 g; 4 shots inside 75 mm at 100 m), [armoury-online: VSS](https://www.armoury-online.ru/articles/sr/ru/vss/) (400 m by day, 300 m at night).

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

This is the gun's motion when it fires (Space, or **Fire** in the panel). The bullet itself is section 6.

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
| VSS (PSO-1-1) | SP-5: 16.2 g at 280 m/s, its 0.6 g of powder gas mostly held back by the integral suppressor | 4.7 N·s | 3.41 kg | 1.4 m/s, 3.2 J |

The lighter SVD kicks harder, so its motions are about 1.5 × the bolt rifle's. The VSS kicks a fifth as hard as the SVD, like a light carbine. Its motions are scaled from the other two by recoil speed: the scope comes about 10 mm back, the muzzle hops 1° and settles 0.4° high, and the stock barely slaps the cheek. At 8× the picture dims and shrinks for about 0.15 s instead of blacking out, and a target held on its 183 m mark stays in the field, so the shooter watches the hit.

**Three motions overlap**, and each one drives an artifact from section 4:

1. **The scope comes back at the eye.** The rifle slams into the shoulder, so 16 ms after the shot the eyepiece is 24 mm closer than its eye relief (17 mm for the bolt rifle). The shoulder pushes it forward again only slowly, with a 0.45 s time constant (0.38 s for the bolt rifle): it is still 16 mm too close at 0.2 s and 10 mm at 0.4 s. Too close, the bundles from the edge of the field miss the eye pupil, and the picture shrinks to a tunnel inside a thick black ring.
2. **The muzzle rises.** It peaks at 3.1° about 90 ms after the shot (2.0° at 105 ms for the bolt rifle), a little to the right, with a short 26 Hz ring-down of the tube on top. Then it falls back to a rise that stays: 1.2° up and 0.2° right for the SVD, 0.8° up for the bolt rifle.
3. **The head is jolted off the cheek weld.** It settles back with a 0.28 s lag, so the scope tilts up to 2.6° against the eye at about 80 ms. The whole sight picture, reticle and field stop included, moves with that tilt, and the ocular housing jumps in the naked-eye view. The eyepiece also swings up about the shoulder, 120 mm behind the eye. That keeps the eye 4–5 mm below the exit pupil from about 40 to 130 ms, and more than 2 mm low for 0.2 s. At 8× (a 6.25 mm exit pupil) the picture goes dark apart from a crescent of light at the bottom, which widens as the head settles.

**Motion blur.** Each frame stands for a 1/60 s exposure. While the rifle moves, the view through the eyepiece is averaged over 16 jittered moments of that exposure: the scene sweeps through the field at the rifle's rate times the magnification (up to 110°/s × 8 in the first frames), the field stop and reticle sweep with the tilt, and the eye slides over the exit pupil. At rest the shader takes the single-sample path.

**The rifle stays where it ends up.** When the motion has died away (3 s, the last of it being the slow return of eye relief), its lasting rise is folded into the aim. Nothing returns on its own: the shooter drags the rifle back down onto the target, as after a real shot. At 8× the target sits near the bottom of the field. From about 10× (15× with the bolt rifle) it is out of the field. A second shot before the first settles starts from wherever the rifle is. Each shot varies, as a real shooter's hold does. Rise varies ±20 % and kick ±15 %. Drift is mostly right but spreads widely, and about one shot in fifty drifts a little left. The tube rings at a random phase and strength. One hidden "hold" draw ties the shoulder and cheek together: a loose hold lets the scope come back up to 25 % further, peak later, take longer to push out again, and leave the head jolted longer. The stock also slaps the cheek up to 1.5 mm sideways, so the returning crescent is not always centred. Every shot still blacks out long enough to see.

Tests check, for every rifle, that the kick peaks at more than 1.8 × the lasting rise, that the scope comes at least 80 % of its travel toward the eye, that the eye is low at 50 ms, and that everything but the lasting rise is gone at the end. For the SVD and the bolt rifle they also check that the scope stays more than 10 mm too close for at least 0.2 s and the eye more than 2 mm low for at least 0.15 s, so the blackout lasts long enough to see. For the VSS they check a weaker version: the scope comes at least 8 mm back and the picture dims for at least 0.1 s, but for less than half as long as the SVD's.

## 6. Shooting (`src/scope/shot.ts`, `demo/reticle/shooting.ts`)

Space fires a real bullet. It flies through moving air from the bore, hits whatever is in its way, and the shooter sees and hears what happens downrange at the moment it would really reach them.

| Impact in dirt at 384 m, 20×, wind 2.5 m/s from 9:30 (0.03, 0.18, 0.6, 1.9 and 3.9 s after it lands) |
| --- |
| ![Dust](images/impact-dust.jpg) |

### The bullet

`fly()` is a 3D point-mass solver. It uses the same G7 drag, ICAO air and RK4 at 0.5 ms as `trajectory()`, but drag acts on the speed through the air rather than over the ground, and it adds:

| Effect | Model | At 412 m (7N1) | At 183 m (SP-5) |
| --- | --- | --- | --- |
| Wind | Drag on the air-relative velocity, with the wind sampled along the path every 1 ms | 0.27 thousandth per m/s of full-value crosswind (34 cm in 3 m/s), within 0.1 % of the lag rule `W·(t − R/V₀)` | 7.5 cm in 3 m/s (0.4 thousandth): the heavy bullet barely slows, so there is little lag |
| Gusts | Speed ±30 % and direction ±12° over 5–15 s. Gusts are carried across the range, so the wind at the target is not the wind at the shooter | Varies shot to shot | Varies shot to shot |
| Head and tail wind | Same drag model | A few cm lower or higher | A few cm lower or higher |
| Spin drift | Litz: `1.25·(SG + 1.2)·t^1.83` inches to the right (right-hand twist). Miller stability from the bullet's length and the twist: SVD 1:240 mm gives SG 2.2, the bolt rifle's 1:11.25" gives 1.9, the VSS's 1:210 mm (assumed: it is not published) gives 3.3. Litz fitted supersonic bullets, so for the SP-5 it is an estimate | 4.5 cm right | 7 cm right |
| Aerodynamic jump | Litz: `(0.01·SG − 0.0024·L + 0.032)` MOA per mph of crosswind. With a right-hand twist a wind from the left throws the bullet up | 0.09 mrad in 3 m/s | 0.11 mrad in 3 m/s |
| Coriolis | `−2Ω×v` for a range at 38.5° N firing north-west (which puts the sun over the left shoulder, as in the scene) | 1 cm right, 1 cm low | 0.6 cm right, 0.5 cm low |

With no wind and no Earth rotation, a level shot reproduces `trajectory()` to the millimetre (tested), so the ammo card stays true, and a bullet fired from the bore, 70 mm under the scope and tilted by the drum on 1, with the PSO's 4, 6 or 8 chevron, or any of the VSS's chevrons, on a target at that range lands within 1 cm of it (tested). The SP-5 stays below Mach 0.85 all the way to 400 m (tested). In the lab every shot leaves from the bore under the scope, tilted by the drum, so holds work exactly as in section 3. Wind holds come off the PSO's lateral scale or the tree's rows.

### The rifle and the shot

| | SVD (PSO) | Bolt rifle (tree) | VSS (PSO-1-1) |
| --- | --- | --- | --- |
| Precision | σ = 0.4 MOA per axis: 7N1 spec ≤ 1.24 MOA extreme vertical spread for 5 shots, every shot of a group inside 80 mm at 300 m | σ = 0.25 MOA (≈ 0.75 MOA 5-shot groups) | σ = 0.45 MOA: spec 4 shots inside 75 mm at 100 m, observed 1–2 MOA |
| Muzzle velocity spread | SD 8 m/s (military ammunition) | SD 4 m/s (match) | SD 4 m/s. At subsonic speed every m/s is 1.5 cm of height at 183 m |
| Spread at its mannequin | 412 m: ≈ 5 cm per axis, plus ≈ 3 cm vertical from velocity | 412 m: ≈ 3 cm per axis, plus ≈ 1.5 cm vertical | 183 m: ≈ 2.4 cm per axis, plus ≈ 6 cm vertical |
| Lock and barrel time | 6 ms (hammer) + 1.3 ms | 3 ms (striker) + 1.3 ms | 5 ms (striker) + 1.9 ms (a 200 mm ported barrel and the suppressor ahead of it) |
| Action | Semi-automatic, 10-round magazine | Bolt, 5-round magazine. After each shot Space works the bolt (1.1 s) | Semi-automatic, 10-round magazine (the automatic mode is left out) |
| Magazine change | 3.2 s | 4.5 s | 3 s |

- **The bullet goes where the rifle points when it leaves**, not where it pointed when Space was pressed: breathing sway, the heartbeat and any recoil still running are all sampled at trigger + lock time + barrel time. Break the shot at the bottom of the breath and it goes where the reticle was.
- **Follow-up shots** fired before the rifle settles start wherever the recoil has put it. Rapid fire from the SVD walks up and right.
- **Working the bolt or changing magazines** moves the rifle off the aim (about 1 mrad for the bolt, several for a magazine) and slides the cheek on the stock, so the picture shadows and the aim has to be found again. As with recoil, nothing returns on its own.
- Each shot's dispersion is seeded by its number, so stills are repeatable.

### What it hits

`firstHit()` walks the path in 1 ms (under 1 m) steps. The mannequins, their stakes and tripods, the boulder and the fence posts are raycast only when a step passes near them. The ground is tested against the terrain height and the crossing is bisected to millimetres. Bullets go straight through sagebrush, as .30 calibre bullets do through light brush. Flying stops half a metre into the ground, so a shot costs about 2.5 ms of CPU, once, at the trigger.

### What the shooter sees

| Hit on the mannequin at 412 m, 20× (0.04, 0.13 and 0.23 s after) | Muzzle-blast dust, 6× (0.05, 0.2, 0.6, 1.5 s) |
| --- | --- |
| ![Hit](images/impact-hit.jpg) | ![Blast](images/blast-dust.jpg) |

- **Trace** (supersonic bullets only). Through the scope, the bullet's wake shows as a ripple bending the image (`trace()` in composite.ts). It is a turbulent, lens-like push across the path, about 6 cm wide at the bullet and widening to 25 cm 60 ms behind it. It runs downrange from about 40 m out and drops into the target ("rolls in", as spotters say), fading as the bullet slows and collapsing into the impact. It is projected from the bullet's real position into the current view, so with recoil the trace is where the bullet is, not where the reticle was. Dry desert air keeps it faint: it is easiest to see at low power and in motion. The VSS's bullet is slower than sound and leaves no trace.
- **The bullet.** Every bullet is also drawn at its true size, spread over the scope's blur circle wherever it is out of focus (`objective × |1 − D/P|` across at its distance D, with the parallax knob at P). Supersonic bullets are past the target before the recoil lets the picture back. The VSS's 9 mm bullet takes 0.68 s to reach 183 m and the rifle hardly moves, so in the last 50 m it is a speck of a pixel or two at 12× on a 1080p screen. On this sunlit sand it is about as bright as the ground, so it shows best against a bush. Below a pixel it fades out rather than vanishing.
- **Impacts.** At 412 m the bullet comes in well under a degree from the horizontal, so it ploughs the dirt rather than digging. Dirt clods are thrown forward and up and fall back under gravity. The dust is a forward-leaning plume of billows that brakes hard in the air (0.1–0.4 s), swells as √t, lifts slightly and then drifts off at the wind's speed. Dust lingers 2–5 s. Rock throws pale dust. A mannequin hit throws white plastic flecks and a small puff, leaves a true-size hole (7.62 mm, or 9 mm from the VSS; under a pixel even at 20×, as in life), and rocks the mannequin on its stake about 1° at 2.2 Hz. The bullet keeps about a fifth of its 5.4 N·s. Posts give a puff and a ring. Everything is a closed-form function of time since the impact, so the cost is one draw of up to 320 sprites, whatever the frame rate.
- **Muzzle-blast dust.** Prone on dry ground, the SVD's slotted flash hider lifts dust in front of the muzzle. It is far out of focus, so it shows as a sunlit veil boiling up from the bottom of the view in the first 0.2 s, hazing the field for about a second and drifting off downwind. The bolt rifle raises 60 % as much. Together with recoil, this is why a shooter often cannot see their own impact. The VSS's gas leaves through its suppressor and lifts almost none (5 %).
- **Running mirage.** The mirage in the glass now moves with the crosswind at roughly its angular rate, weighted toward the near two thirds of the path, and boils in place when the air is still. That is the shooter's main wind cue downrange. The panel's **Wind here** reads the wind at the firing point like a hand-held meter. It is not the wind at the target.

### What the shooter hears

Synthesised in WebAudio (`audio.ts`): the report (blast, crack and thump, sharper for the SVD), the bolt or magazine clicks, and the bullet's arrival. That is a slap for the mannequin, a thud for dirt, a ring for a steel post. It is heard after the time of flight plus the sound's return at 343 m/s: about 1.8 s at 412 m. Bang, then a slap 1.8 s later, is a hit. A faint echo comes back from the hills about 9 s after the shot. The VSS is suppressed and subsonic: about 121 dB at a metre, 39 dB below an unsuppressed 9×39, and no crack. The shooter hears a dull thump and the bolt carrier hitting the back of its travel and slamming home, then, 1.2 s later at 183 m, the slap of a hit, which is the loudest part. It is too quiet to echo. **Sound** in the panel mutes it.

### Readouts

**Rounds** (in the magazine and chamber, and what Space will do next), **Wind here**, and **Last shot**: hit and where, or the miss distance against the chest in the plane of whichever mannequin the bullet passed closest to. Last shot appears only once the bullet has arrived. It is a lab readout and gives no speeds, so the SVD and VSS players still need no numbers.

## 7. Scope-in and scope-out (`src/scope/ads.ts`, `demo/reticle/near.ts`)

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

1. **The rifle, out of focus.** The scope and rifle are modelled to scale: a 47 mm ocular bell with 41 mm of glass recessed 2.5 mm, a ribbed power ring with its throw lever, a 30 mm tube, an elevation drum engraved with its range marks and a white index line on the saddle, a windage turret, a 50 mm objective bell, rings, rail, action, bolt and barrel. They are rendered from the eye and defocused as a 3 mm pupil focused on the target sees them: a point d metres away spreads over pupil/d radians. That is 30–40 px at the eyepiece and a few px at the muzzle. When the eye looks at the elevation drum it focuses there instead, at f = 0.29 m, and the disc becomes pupil·|1/d − 1/f|: the drum sharp, the eyepiece and muzzle soft, the range blurred by pupil/f. The blur is a depth-aware scatter-as-gather (each point spreads over its own disc, with energy conserved), plus a smear along the eyepiece's sweep across the view during the 1/60 s exposure.
2. **Dark glass.** Until the eye is close to the axis, the eyepiece shows only a faint green-magenta coating sheen of the sky.
3. **A crescent at the bottom.** The light comes through the exit pupil. Coming in from above and behind, the first light appears in the lower part of the eyepiece, then grows as the eye drops. The image pops in over the last few millimetres, which is what real glass does.
4. **The tunnel opens.** The primary stroke stops slightly back, so the field is a disc inside a black ring that fills as the corrective stroke closes the eye relief.
5. **Adaptation.** The eye adapts to the dimmer image in the glass over about 0.45 s, and to the open range over about 0.2 s (light adaptation is the faster of the two). Head up, the range is sharp and normally exposed. On the weld, the surroundings take the over-exposed, blurred look of the reference footage.

Drag sensitivity follows adaptation: locked to the glass on the weld, locked to the naked-eye view with the head up.

URL parameters for stills: `out` starts with the head up; `adsin=<s>` and `adsout=<s>` take the still that long after the head starts down or up.

## 8. The range (`demo/reticle/scene.ts`)

A high-desert flat seen from a low rise: procedural terrain with hills beyond 1.5 km, and a ground shader built from band-limited fbm with an integer pcg2d hash (float hashes streak at world coordinates in the hundreds of metres). It has 40k sagebrush clumps, a 4 m boulder, white mannequin torsos on orange stakes at 412 m and at 183 m (the game's range, 3.4° left of the first), a wire fence with T-posts at about 360 m, exponential haze, and a sun over the shooter's shoulder. The sun's shadow box covers one mannequin and its surroundings, whichever the scope points nearest, and moves when the aim crosses over (one redraw of the shadow map).

## 9. Controls

| Input | Action |
| --- | --- |
| Drag / one finger | Aim (1 px of drag = 1 apparent px, so the view feels locked to the glass) |
| Wheel / pinch | Power 4–20× |
| W A S D | Move the eye across the exit pupil |
| Q / E | Eye relief closer / further |
| F / right-click | Scope in / scope out |
| Space | Fire. With the chamber empty: work the bolt (bolt rifle) or change the magazine |
| R | Switch rifle and reticle: SVD, bolt rifle, VSS |
| L | Illumination |
| H | Hide the panel |

The panel also has the parallax knob (50 m to ∞), eye sliders, the Pan shadow slider, wind speed and direction, toggles for sway, mirage, head wander and sound, a Fire button, and live readouts: true field, exit pupil, aim range, parallax error and the target's subtension in the current reticle's unit.

URL parameters: `reticle=pso|tree|vss` (`vss` starts on the 183 m mannequin with the parallax at 183 m), `mag`, `par`, `ex`, `ey`, `ez` (mm), `pupil`, `illum`, `nosway`, `nomirage`, `nodrift`, `noshadow`, `pan` (Pan shadow, 0–2), `hud=0`, and `shot=1&t=` for deterministic stills. Add `recoil=0.08` for a still 80 ms after the trigger, or `panrate=4,0` for one taken mid-swing (right and up, in °/s). Shooting: `wind=<m/s>,<clock>` (default `2.5,9.5`), `nogust`, `mute`, `zero=<m>` (every drum on that mark, e.g. `zero=300`), `focus=<m>` (the eye focused that close, e.g. `out&focus=0.29` to read the drum), `hold=<up>[,<right>]` (start aimed that many reticle units high and right, so a chevron sits on the chest), `fire=<s>` for a still that long after a bullet left the muzzle, and `norecoil` to keep the rifle still for it. To render the stills: `OUT=renders npx tsx scripts/reticle.ts "name=reticle=tree&mag=16&hud=0"`.

## 10. Next steps (not built)

- Glass, for the game: the VSS's shots go through windows. Deflection and fragments by bullet, pane and angle, and the hole and cracks a pane keeps.
- Windage drum, and drum slop: the elevation drum is built (section 3); the windage drum is still fixed at 0.
- Atmosphere: temperature, pressure and altitude (air density), so the PSO's chevrons stop being exact off standard conditions, as on a real PSO-1.
- Moving targets and lead (the lateral scale is already there for it).
- Depth-aware focus, so the foreground and far hills blur separately when parallax is set to the target.
- Low light: a 7 mm eye pupil, a dimmer image, and illumination brightness steps.
- Bringing the scope composite into the mansion demo's `scope` view in place of its CSS reticle.
