# Rifle recordings

Drop real recordings here and the reticle lab plays them in place of its synthesised sounds (`../synth.ts`). No code change is needed: `../audio.ts` picks up every audio file in this folder by name when the page loads.

## Names

`<rifle>-<sound>.<ext>`, for example `vss-shot.wav` or `bolt-bolt-back.flac`.

- `<rifle>` is `bolt` (the bolt rifle, M24 / Remington 700 class), `svd` or `vss`.
- `<ext>` can be `wav`, `flac`, `ogg`, `mp3`, `m4a`, `opus` or `webm`.
- A second or third take of the same sound adds `-2`, `-3`: `svd-charge-release-2.wav`. Takes are played in turn, so a few of each keeps repeats from sounding identical.

## The sounds

Each file is one sound, trimmed so it starts at its first transient (within 5 ms) and ends when it has died away. Level does not matter: every file is scaled to full scale when it loads, and the lab sets how loud each one plays. Mono or stereo, any sample rate.

| Sound | What it is | bolt | svd | vss |
| --- | --- | :-: | :-: | :-: |
| `shot` | The report, heard from the shooter's own position (a microphone at the shooter's head, outdoors). Keep the first 2 s, with the echo. On the SVD and VSS the action cycling is part of it | ✓ | ✓ | ✓ |
| `bolt-up` | Bolt handle lifted 90°: the cocking cam's scrape and the cocking piece dropping into its notch | ✓ | | |
| `bolt-back` | Bolt pulled fully back: the run along the raceways, the case ejected, the bolt stop | ✓ | | |
| `bolt-forward` | Bolt pushed home: stripping the top round off the magazine, chambering it | ✓ | | |
| `bolt-down` | Bolt handle turned down and seated | ✓ | | |
| `case-land` | A fired case landing on dry ground about a metre away | ✓ | ✓ | ✓ |
| `mag-release` | The magazine catch pressed | ✓ | ✓ | ✓ |
| `mag-out` | The magazine coming out of the well (rocked forward off its lug on the SVD and VSS) | ✓ | ✓ | ✓ |
| `mag-in` | A full magazine going in until the catch clicks (front lug first and rocked back on the SVD and VSS) | ✓ | ✓ | ✓ |
| `carrier-close` | The bolt carrier slamming home on an empty chamber when the empty magazine comes out | | ✓ | |
| `charge-back` | The charging handle pulled fully back against the spring | | ✓ | ✓ |
| `charge-release` | The charging handle let go: the carrier slams home and chambers a round | | ✓ | ✓ |

That is 24 files for every sound on every rifle. Any subset works; the rest stay synthesised.

A recording of a whole sequence (a full bolt cycle, a whole magazine change) is useful too: put it in this folder with any name and it can be cut into the pieces above.

## Licence

Only recordings you made yourself or ones licensed for reuse (CC0, or CC-BY with credit). List every file that needs credit below: file, author, source link, licence.

| File | Author | Source | Licence |
| --- | --- | --- | --- |
