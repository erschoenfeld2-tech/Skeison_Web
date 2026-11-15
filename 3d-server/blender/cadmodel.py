"""Baut ein Modell aus einem Modellier-Skript (von Claude geschrieben) und rendert eine Vorschau.

Laeuft IN Blender (4.2 LTS oder neuer):
  blender -b --factory-startup -P cadmodel.py -- --script s.py --out-glb m.glb --preview p.png
Das Skript wird vorher von cad_sandbox.check() geprueft und eingeschraenkt ausgefuehrt.
Danach: alle sichtbaren Meshes/Texte (mit Modifikatoren, z. B. Boolean) zu einem Mesh vereinen,
als GLB speichern (weiter mit printprep.py) und zwei Vorschaubilder fuer Claudes Kontrolle rendern.
Einheit: 1 Blender-Einheit = 1 mm.
"""
import argparse
import json
import math
import os
import sys
import traceback

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cad_sandbox  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--script", required=True)
    p.add_argument("--out-glb", required=True)
    p.add_argument("--preview", default="")
    p.add_argument("--max-objects", type=int, default=400)
    return p.parse_args(argv)


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


# ---------- Hilfsfunktionen fuer das Skript (kein bpy.context/bpy.ops noetig) ----------

def link(obj):
    """Objekt in die Szene haengen."""
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_object(name, bm):
    """BMesh -> neues Objekt in der Szene (bm wird freigegeben)."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def boolean(target, cutter, operation="DIFFERENCE"):
    """Boolean-Modifikator; der Schneidkoerper wird ausgeblendet und zaehlt nicht zum Modell."""
    mod = target.modifiers.new("bool", "BOOLEAN")
    mod.operation = operation
    mod.object = cutter
    mod.solver = "EXACT"
    cutter.hide_render = True
    cutter.display_type = "WIRE"
    return mod


def text_object(name, body, size=10.0, depth=2.0, align="CENTER"):
    """3D-Text (Standardschrift), size = Hoehe der Grossbuchstaben ungefaehr in mm, depth = Dicke."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = str(body)[:60]
    cu.size = size * 1.4
    cu.extrude = depth / 2
    cu.align_x = align
    obj = link(bpy.data.objects.new(name, cu))
    obj.location.z = depth / 2
    return obj


HELPERS = {"link": link, "mesh_object": mesh_object, "boolean": boolean, "text_object": text_object, "Vector": Vector}


# ---------- Ergebnis ----------

def model_objects():
    return [o for o in bpy.data.objects if o.type in {"MESH", "CURVE", "FONT", "SURFACE", "META"}
            and not o.hide_render]


def combined_mesh(objs):
    """Alle Teile mit Modifikatoren und Weltmatrix in ein Mesh (Ueberlappungen loest spaeter der Voxel-Remesh)."""
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    parts = 0
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        me.transform(o.matrix_world)
        if len(me.polygons):
            bm.from_mesh(me)
            parts += 1
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new("modell")
    bm.to_mesh(me)
    bm.free()
    return me, parts


def render_previews(obj, path):
    """Zwei Ansichten (schraeg vorne, schraeg hinten-oben) mit Workbench, sonst Cycles mit wenigen Samples."""
    scene = bpy.context.scene
    lo = Vector([min(v.co[i] for v in obj.data.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in obj.data.vertices) for i in range(3)])
    center, radius = (lo + hi) / 2, max((hi - lo).length / 2, 1.0)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("cam", cam_data)
    link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    link(sun)
    world = bpy.data.worlds.new("w")
    world.color = (0.08, 0.08, 0.08)
    scene.world = world
    mat = bpy.data.materials.new("gold")
    mat.diffuse_color = (0.95, 0.72, 0.1, 1)
    obj.data.materials.append(mat)
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    try:
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_cavity = True
        scene.display.shading.show_object_outline = True
    except (TypeError, AttributeError):
        pass
    dist = radius / math.tan(cam_data.angle / 2) * 1.15
    files = []
    for i, (az, el) in enumerate(((-35, 25), (145, 40))):
        a, e = math.radians(az), math.radians(el)
        cam.location = center + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        out = path.replace(".png", f"_{i + 1}.png")
        scene.render.filepath = out
        try:
            bpy.ops.render.render(write_still=True)
        except RuntimeError:
            scene.render.engine = "CYCLES"
            scene.cycles.device = "CPU"
            scene.cycles.samples = 12
            bpy.ops.render.render(write_still=True)
        files.append(out)
    return files


def main():
    a = parse_args()
    clear_scene()
    with open(a.script, encoding="utf-8") as f:
        code = f.read()
    try:
        cad_sandbox.run(code, dict(HELPERS))
    except cad_sandbox.ScriptError as e:
        print("SKEISON_RESULT " + json.dumps({"ok": False, "error": f"Skript abgelehnt: {e}"}), flush=True)
        return
    except Exception as e:  # noqa: BLE001 - Fehler im Skript gehen als Text an Claude zurueck
        tb = traceback.extract_tb(e.__traceback__)
        where = next((f"Zeile {fr.lineno}" for fr in reversed(tb) if fr.filename == "modell.py"), "")
        print("SKEISON_RESULT " + json.dumps({"ok": False, "error": f"{type(e).__name__} {where}: {e}"[:600]}), flush=True)
        return

    objs = model_objects()
    if not objs:
        print("SKEISON_RESULT " + json.dumps({"ok": False, "error": "Das Skript hat kein sichtbares Objekt erzeugt."}), flush=True)
        return
    if len(objs) > a.max_objects:
        print("SKEISON_RESULT " + json.dumps({"ok": False, "error": f"Zu viele Teile ({len(objs)})."}), flush=True)
        return
    me, parts = combined_mesh(objs)
    if not len(me.polygons):
        print("SKEISON_RESULT " + json.dumps({"ok": False, "error": "Das Modell hat keine Flaechen."}), flush=True)
        return
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    obj = link(bpy.data.objects.new("modell", me))

    lo = [min(v.co[i] for v in me.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in me.vertices) for i in range(3)]
    stats = {"ok": True, "parts": parts, "faces": len(me.polygons),
             "size_mm": [round(hi[i] - lo[i], 1) for i in range(3)], "min_z": round(lo[2], 2)}

    bpy.ops.export_scene.gltf(filepath=a.out_glb, export_format="GLB", use_selection=False,
                              export_materials="NONE", export_apply=True)
    if a.preview:
        try:
            stats["previews"] = render_previews(obj, a.preview)
        except Exception as e:  # noqa: BLE001 - ohne Vorschau geht es weiter
            stats["preview_error"] = str(e)[:200]
    print("SKEISON_RESULT " + json.dumps(stats), flush=True)


if __name__ == "__main__":
    main()
