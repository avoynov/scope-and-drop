"""Open $OUT/$NAME.blend, make three levels of detail (each part decimated to a triangle budget,
then joined into one skinned mesh per level: guest_lod0/1/2 on the one skeleton), shrink textures
to $TEX px, and export $OUT/$NAME.glb. IMG=WEBP writes WebP textures (EXT_texture_webp)."""
import bpy, json, os, sys
OUT = os.environ.get("OUT", "out")
TEX = int(os.environ.get("TEX", "1024"))
NAME = os.environ.get("NAME", "guest-m")
bpy.ops.wm.open_mainfile(filepath=OUT + "/" + NAME + ".blend")
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
# shrink textures (one shared size; the guest is <= ~600 px tall on screen)
import re
for img in bpy.data.images:
    if img.size[0] > TEX: img.scale(TEX, TEX * img.size[1] // img.size[0])

def kind(o):
    n = o.name.lower()
    for k, v in (("eyebrow", "eyebrow"), ("eyelash", "eyelash"), ("low-poly", "low-poly"), ("shoe", "shoes"), ("hair", "short02"), ("short02", "short02"), ("bob", "short02"), ("toigo", "suit"), ("elvs", "suit")):
        if k in n: return v
    return "body"
# target triangles per part per LOD (None = drop the part)
BUDGET = {
    0: {"body": 9000, "suit": 9000, "short02": 2400, "shoes": 900, "low-poly": 172, "eyebrow": 192, "eyelash": 368},
    1: {"body": 2400, "suit": 2000, "short02": 600, "shoes": 200, "low-poly": 172, "eyebrow": 192, "eyelash": None},
    2: {"body": 700, "suit": 550, "short02": 160, "shoes": 60, "low-poly": None, "eyebrow": None, "eyelash": None},
}
def ntris(o):
    o.data.calc_loop_triangles(); return len(o.data.loop_triangles)
def strip_shape_keys(o):
    if o.data.shape_keys:
        bpy.context.view_layer.objects.active = o
        o.shape_key_add(name="__mix", from_mix=True)
        keys = o.data.shape_keys.key_blocks
        mix = keys["__mix"]
        for k in list(keys):
            if k.name != "__mix": o.shape_key_remove(k)
        o.shape_key_remove(o.data.shape_keys.key_blocks["__mix"])
stats = {}
lods = []
for lod in (0, 1, 2):
    parts = []
    for src in meshes:
        b = BUDGET[lod][kind(src)]
        if b is None: continue
        o = src.copy(); o.data = src.data.copy(); bpy.context.collection.objects.link(o)
        strip_shape_keys(o)
        t = ntris(o)
        if b < t:
            m = o.modifiers.new("dec", "DECIMATE"); m.ratio = b / t; m.use_collapse_triangulate = True
            # put decimate before the armature modifier
            while o.modifiers.find("dec") > 0:
                bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_move_up(modifier="dec")
            bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier="dec")
        parts.append(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active; j.name = f"guest_lod{lod}"
    stats[lod] = {"tris": ntris(j), "materials": len(j.data.materials)}
    lods.append(j)
for o in meshes: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action="DESELECT")
for o in lods + [rig]: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=f"{OUT}/{NAME}.glb", use_selection=True, export_format="GLB",
    export_skins=True, export_morph=False, export_animations=False, export_yup=True,
    export_image_format=os.environ.get("IMG", "AUTO"), export_jpeg_quality=90, export_texcoords=True, export_normals=True)
stats["bytes"] = os.path.getsize(f"{OUT}/{NAME}.glb")
print("LODS", json.dumps(stats))
print("BONES", [b.name for b in rig.data.bones])
