"""Build one MPFB 2 guest (body, skin, game-engine rig, eyes, brows, lashes, hair, clothes, shoes)
and save it as $OUT/$NAME.blend for export_lods.py. See tools/people/README.md.

  SEX=m NAME=guest-m CLOTHES=toigo_suit_with_dinner_jacket SHOES=mindfront_shoes_oxford_male HAIR=short02 SKIN=young_caucasian_male python build_guest.py
"""
import bpy, addon_utils, importlib, os, sys, json
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
def imp(name, key): return getattr(importlib.import_module("bl_ext.user_default.mpfb.services." + name), key)
HumanService = imp("humanservice", "HumanService")
AssetService = imp("assetservice", "AssetService")
ExportService = imp("exportservice", "ExportService")
ObjectService = imp("objectservice", "ObjectService")
OUT = os.environ.get("OUT", "out")

# clean scene
bpy.ops.wm.read_factory_settings(use_empty=True)
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)

SEX = os.environ.get("SEX", "m")
NAME = os.environ.get("NAME", "guest-m")
CLOTHES = os.environ.get("CLOTHES", "toigo_suit_with_dinner_jacket")
SHOES = os.environ.get("SHOES", "mindfront_shoes_oxford_male")
HAIR = os.environ.get("HAIR", "short02")
SKIN = os.environ.get("SKIN", "young_caucasian_male")
macro = {"gender": 1.0 if SEX == "m" else 0.0, "age": 0.5, "muscle": 0.5, "weight": 0.5, "proportions": 0.6, "height": 0.55,
         "cupsize": 0.5, "firmness": 0.5, "race": {"asian": 0.0, "caucasian": 1.0, "african": 0.0}}
basemesh = HumanService.create_human(macro_detail_dict=macro)
skin = AssetService.find_asset_absolute_path(SKIN + ".mhmat", asset_subdir="skins")
HumanService.set_character_skin(skin, basemesh, skin_type="GAMEENGINE")
HumanService.add_builtin_rig(basemesh, "game_engine")
for subdir, fname, atype in [("eyes", "low-poly.mhclo", "Eyes"), ("eyebrows", "eyebrow001.mhclo", "Eyebrows"),
                             ("eyelashes", "eyelashes01.mhclo", "Eyelashes"), ("hair", HAIR + ".mhclo", "Hair"),
                             ("clothes", CLOTHES + ".mhclo", "Clothes"),
                             ("clothes", SHOES + ".mhclo", "Clothes")]:
    p = AssetService.find_asset_absolute_path(fname, asset_subdir=subdir)
    print("ASSET", fname, p)
    if p: HumanService.add_mhclo_asset(p, basemesh, asset_type=atype, material_type="GAMEENGINE")

root = ExportService.create_character_copy(basemesh, name_suffix="_export")
eb = ObjectService.find_object_of_type_amongst_nearest_relatives(root, "Basemesh")
ExportService.bake_modifiers_remove_helpers(eb, bake_masks=True, bake_subdiv=True, remove_helpers=True, also_proxy=True)
# Keep only the baked export copy.
keep = {root} | set(ObjectService.get_list_of_children(root))
for o in list(bpy.data.objects):
    if o not in keep: bpy.data.objects.remove(o, do_unlink=True)

def tris(o):
    m = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    m.calc_loop_triangles(); n = len(m.loop_triangles); return n
stats = {o.name: tris(o) for o in bpy.data.objects if o.type == "MESH"}
print("TRIS", json.dumps(stats), "TOTAL", sum(stats.values()))
print("BONES", len(root.data.bones) if root.type == "ARMATURE" else root.type)
bpy.ops.wm.save_as_mainfile(filepath=OUT + "/" + NAME + ".blend")
