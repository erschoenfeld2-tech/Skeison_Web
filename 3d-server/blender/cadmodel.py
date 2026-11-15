"""Baut ein Modell aus einem Modellier-Skript (von Claude geschrieben), analysiert es und rendert Ansichten.

Laeuft IN Blender (4.2 LTS oder neuer):
  blender -b --factory-startup -P cadmodel.py -- --script s.py --out-glb m.glb --preview p.png --settings '{...}'
Das Skript wird vorher von cad_sandbox.check() geprueft und eingeschraenkt ausgefuehrt.
Danach: alle sichtbaren Meshes/Texte (mit Modifikatoren, z. B. Boolean) exakt zu einem Koerper vereinen
(Boolean UNION, Solver EXACT: scharfe Kanten und Masse bleiben erhalten), wie im Slicer analysieren
(Wandstaerke, Ueberhang, Druckbett; analyse.py), als GLB speichern (weiter mit printprep.py) und vier Ansichten
fuer Claudes Kontrolle rendern: vorne, rechts, oben (orthografisch, massstabsgetreu) und schraeg; Ueberhaenge rot.
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

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import analyse  # noqa: E402
import cad_sandbox  # noqa: E402
import print_settings  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--script", required=True)
    p.add_argument("--out-glb", required=True)
    p.add_argument("--preview", default="")
    p.add_argument("--max-objects", type=int, default=400)
    p.add_argument("--settings", default="{}")
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


# ---------- Vereinen ----------

def model_objects():
    return [o for o in bpy.data.objects if o.type in {"MESH", "CURVE", "FONT", "SURFACE", "META"} and not o.hide_render]


def to_mesh_objects(objs):
    """Jedes Teil (mit Modifikatoren, Text -> Mesh) als einfaches Mesh-Objekt in Weltkoordinaten."""
    dg = bpy.context.evaluated_depsgraph_get()
    meshes = []
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        me.transform(o.matrix_world)
        if len(me.polygons):
            meshes.append(me)
        else:
            bpy.data.meshes.remove(me)
    clear_scene()
    return [link(bpy.data.objects.new("teil", me)) for me in meshes]


def closed(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    ok = len(bm.faces) > 3 and all(e.is_manifold for e in bm.edges)
    bm.free()
    return ok


def union(parts, max_parts=120):
    """Exakte Vereinigung aller Teile. Rueckfall: einfach zusammenlegen (printprep verschmilzt dann per Voxel)."""
    if len(parts) == 1:
        return parts[0].data.copy(), closed(parts[0].data)
    if len(parts) <= max_parts:
        try:
            coll = bpy.data.collections.new("teile")
            bpy.context.scene.collection.children.link(coll)
            for o in parts[1:]:
                coll.objects.link(o)
            mod = parts[0].modifiers.new("vereinen", "BOOLEAN")
            mod.operation = "UNION"
            mod.operand_type = "COLLECTION"
            mod.collection = coll
            mod.solver = "EXACT"
            dg = bpy.context.evaluated_depsgraph_get()
            me = bpy.data.meshes.new_from_object(parts[0].evaluated_get(dg))
            parts[0].modifiers.remove(mod)
            if len(me.polygons) and closed(me):
                return me, True
            bpy.data.meshes.remove(me)
        except Exception as e:  # noqa: BLE001
            print("Vereinigung fehlgeschlagen:", e)
    bm = bmesh.new()
    for o in parts:
        bm.from_mesh(o.data)
    me = bpy.data.meshes.new("modell")
    bm.to_mesh(me)
    bm.free()
    return me, False


# ---------- Ansichten ----------

def render_previews(obj, path, overhang_deg=45):
    """Vier Ansichten: vorne, rechts, oben (orthografisch, massstabsgetreu) und schraeg. Ueberhaenge rot."""
    scene = bpy.context.scene
    me = obj.data
    lo = Vector([min(v.co[i] for v in me.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in me.vertices) for i in range(3)])
    center, size = (lo + hi) / 2, hi - lo
    radius = max(size.length / 2, 1.0)
    gold = bpy.data.materials.new("gold")
    gold.diffuse_color = (0.95, 0.72, 0.1, 1)
    red = bpy.data.materials.new("ueberhang")
    red.diffuse_color = (0.85, 0.12, 0.1, 1)
    me.materials.append(gold)
    me.materials.append(red)
    limit = math.sin(math.radians(overhang_deg))
    for p in me.polygons:
        p.material_index = 1 if (-p.normal.z > limit and p.center.z > lo.z + 0.05) else 0
    cam_data = bpy.data.cameras.new("cam")
    cam = link(bpy.data.objects.new("cam", cam_data))
    scene.camera = cam
    world = bpy.data.worlds.new("w")
    world.color = (0.08, 0.08, 0.08)
    scene.world = world
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.image_settings.file_format = "PNG"
    try:
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_cavity = True
        scene.display.shading.show_object_outline = True
    except (TypeError, AttributeError):
        pass
    views = [  # Name, Richtung von der Mitte zur Kamera, orthografische Breite (0 = perspektivisch), feste Drehung
        ("vorne", Vector((0, -1, 0)), max(size.x, size.z), (math.pi / 2, 0, 0)),          # X rechts, Z oben
        ("rechts", Vector((1, 0, 0)), max(size.y, size.z), (math.pi / 2, 0, math.pi / 2)),  # Y rechts, Z oben
        ("oben", Vector((0, 0, 1)), max(size.x, size.y), (0, 0, 0)),                       # X rechts, Y oben
        ("schraeg", Vector((-0.55, -0.75, 0.45)).normalized(), 0, None),
    ]
    files = []
    for name, d, ortho, rot in views:
        if ortho:
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = ortho * 1.12 + 2
            dist = radius * 4
        else:
            cam_data.type = "PERSP"
            cam_data.lens = 50
            dist = radius / math.tan(cam_data.angle / 2) * 1.15
        cam_data.clip_end = dist + radius * 4
        cam.location = center + d * dist
        cam.rotation_euler = rot if rot else (-d).to_track_quat("-Z", "Y").to_euler()
        out = path.replace(".png", f"_{name}.png")
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


def result(data):
    print("SKEISON_RESULT " + json.dumps(data), flush=True)


def main():
    a = parse_args()
    clear_scene()
    with open(a.script, encoding="utf-8") as f:
        code = f.read()
    try:
        cad_sandbox.run(code, dict(HELPERS))
    except cad_sandbox.ScriptError as e:
        return result({"ok": False, "error": f"Skript abgelehnt: {e}"})
    except Exception as e:  # noqa: BLE001 - Fehler im Skript gehen als Text an Claude zurueck
        tb = traceback.extract_tb(e.__traceback__)
        where = next((f"Zeile {fr.lineno}" for fr in reversed(tb) if fr.filename == "modell.py"), "")
        return result({"ok": False, "error": f"{type(e).__name__} {where}: {e}"[:600]})

    objs = model_objects()
    if not objs:
        return result({"ok": False, "error": "Das Skript hat kein sichtbares Objekt erzeugt."})
    if len(objs) > a.max_objects:
        return result({"ok": False, "error": f"Zu viele Teile ({len(objs)})."})
    parts = to_mesh_objects(objs)
    if not parts:
        return result({"ok": False, "error": "Das Modell hat keine Flaechen."})
    me, exact = union(parts)
    clear_scene()
    obj = link(bpy.data.objects.new("modell", me))

    lo = [min(v.co[i] for v in me.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in me.vertices) for i in range(3)]
    stats = {"ok": True, "parts": len(parts), "faces": len(me.polygons), "exact": exact,
             "size_mm": [round(hi[i] - lo[i], 2) for i in range(3)], "min_z": round(lo[2], 2)}

    # Analyse wie im Slicer (modellierte Groesse und Lage)
    s = print_settings.normalize(json.loads(a.settings or "{}"))
    cfg = print_settings.blender_args(s, max(stats["size_mm"]))
    bm = bmesh.new()
    bm.from_mesh(me)
    try:
        an = analyse.analyse(bm, cfg)
        stats["analysis"] = an
        stats["analysis_text"] = analyse.describe(an, cfg) + ("" if exact else
            " Die Teile liessen sich nicht exakt vereinen (Luecken oder offene Teile); sie werden spaeter per Voxel "
            "verschmolzen, Kanten werden weniger scharf. Teile besser ueberlappen lassen und geschlossen bauen.")
    except Exception as e:  # noqa: BLE001
        stats["analysis_text"] = f"Analyse nicht moeglich: {e}"
    bm.free()

    bpy.ops.export_scene.gltf(filepath=a.out_glb, export_format="GLB", use_selection=False,
                              export_materials="NONE", export_apply=True)
    if a.preview:
        try:
            stats["previews"] = render_previews(obj, a.preview, cfg["overhang"])
        except Exception as e:  # noqa: BLE001 - ohne Vorschau geht es weiter
            stats["preview_error"] = str(e)[:200]
    result(stats)


if __name__ == "__main__":
    main()
