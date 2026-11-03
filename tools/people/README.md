# People pipeline (milestone 5 spike)

Builds the party's 3D guests with [MPFB 2](https://github.com/makehumancommunity/mpfb2) (MakeHuman for Blender) and exports one GLB per model. Each GLB has a 53-bone skeleton (MPFB's `game_engine` rig, with Unreal-style bone names) and three skinned meshes for the detail levels. `src/party/render/people.ts` draws them, and `demo/people/` shows them in a row of poses.

| Level | Triangles (man / woman) | Shown when the person is |
| --- | --- | --- |
| `guest_lod0` | 22.0k / 18.1k | over 300 px tall on screen |
| `guest_lod1` | 5.6k / 5.7k | 120 to 300 px |
| `guest_lod2` | 1.5k / 1.8k | under 120 px |

## Setup

Blender runs as a Python module (`bpy` from PyPI, Python 3.13):

```sh
python3.13 -m venv bpyenv && bpyenv/bin/pip install --only-binary=:all: bpy==5.2.3
git clone --depth 1 https://github.com/makehumancommunity/mpfb2
```

MPFB has to load as an extension. Link it into Blender's user extensions, then link the asset folder as MPFB's user data:

```sh
EXT=~/.config/blender/5.2/extensions
mkdir -p $EXT/user_default $EXT/.user/user_default/mpfb
ln -s $PWD/mpfb2/src/mpfb $EXT/user_default/mpfb
ln -s $PWD/mhdata $EXT/.user/user_default/mpfb/data
```

The assets are the MakeHuman community packs. `fetch.sh` downloads the ones in `assets.txt` from the `slyedoc/bevy_make_human` GitHub mirror, because the MakeHuman site was blocked here.

## Build

```sh
OUT=out bpyenv/bin/python tools/people/build_guest.py                 # man, dinner jacket
OUT=out NAME=guest-m IMG=WEBP bpyenv/bin/python tools/people/export_lods.py
SEX=f NAME=guest-f CLOTHES=toigo_halter_dress_midi SHOES=elvs_flatshoe_plain1 HAIR=bob02 SKIN=young_caucasian_female \
  OUT=out bpyenv/bin/python tools/people/build_guest.py
OUT=out NAME=guest-f IMG=WEBP bpyenv/bin/python tools/people/export_lods.py
cp out/guest-m.glb demo/party/people/m-dinner.glb; cp out/guest-f.glb demo/party/people/f-dress.glb
```

Textures are cut to 1024 px (`TEX`). The largest a guest gets is about 600 px tall, so this is about one texel per pixel. WebP brings each model from about 13 MB to under 2 MB.

## Licences and credits

All assets keep their own licence, which is in each `.mhclo` header.

- MakeHuman base mesh, targets, rig, skins, eyes, eyebrows, eyelashes and hair `short02` and `bob02`: CC0 (MakeHuman system assets).
- `toigo_suit_with_dinner_jacket` and `toigo_halter_dress_midi` (author MRT, "Suits 01" and "Dress 01" packs): CC0.
- `mindfront_shoes_oxford_male`: CC BY 4.0, Mindfront (Sweden). **Credit required.**
- `elvs_flatshoe_plain1`: CC BY, Elvaerwyn. **Credit required.**
- MPFB 2 code: GPLv3. It is only the build tool; nothing from it ships in the game.
