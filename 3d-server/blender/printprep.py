"""Macht aus einem GLB ein druckfertiges Modell und schreibt STL + 3MF.

Laeuft IN Blender (4.2 LTS oder neuer), entweder
  headless:  blender -b --factory-startup -P printprep.py -- --in a.glb --out-dir DIR --size 80 --settings '{...}'
oder ueber die blender-mcp-Verbindung (Port 9876), dann per runpy gestartet.

Schritte: importieren -> zu einem Objekt vereinen -> auf Zielgroesse skalieren (Massachse aus den Einstellungen) ->
geschlossen? dann exakt lassen, sonst Voxel-Remesh (Aufloesung aus Duese/Detailgrad) -> ggf. reduzieren ->
flache Standflaeche -> beste Ausrichtung -> Schrumpfausgleich -> auf die Druckplatte -> Analyse wie im Slicer ->
STL/3MF schreiben (3MF mit Slicer-Empfehlungen in den Metadaten).
Einheit: 1 Blender-Einheit = 1 mm.
"""
import argparse
import json
import os
import sys

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import analyse  # noqa: E402
import mesh_io  # noqa: E402
import print_settings  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--name", default="modell")
    p.add_argument("--size", type=float, default=80.0, help="Zielmass in mm (Achse laut settings.size_axis)")
    p.add_argument("--flat-base", type=int, default=1)
    p.add_argument("--max-tris", type=int, default=0, help="0 = aus dem Detailgrad")
    p.add_argument("--settings", default="{}", help="Druckeinstellungen als JSON (print_settings.normalize)")
    p.add_argument("--remesh", choices=["auto", "voxel"], default="auto",
                   help="auto: geschlossene Modelle exakt lassen, sonst Voxel-Remesh")
    return p.parse_args(argv)


def merged_bmesh(objs):
    """Alle importierten Meshes (mit Weltmatrix) in ein BMesh."""
    bm = bmesh.new()
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        tmp = bmesh.new()
        tmp.from_mesh(me)
        new_verts = [bm.verts.new(v.co) for v in tmp.verts]
        bm.verts.ensure_lookup_table()
        for f in tmp.faces:
            try:
                bm.faces.new([new_verts[v.index] for v in f.verts])
            except ValueError:
                pass  # doppelte Flaeche
        tmp.free()
        bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    return bm


def bbox(bm):
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def apply_modifier(obj, kind, **props):
    mod = obj.modifiers.new("tmp", kind)
    for k, v in props.items():
        setattr(mod, k, v)
    dg = bpy.context.evaluated_depsgraph_get()
    new_me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    obj.modifiers.remove(mod)
    old = obj.data
    obj.data = new_me
    bpy.data.meshes.remove(old)


def is_closed(bm):
    return all(e.is_manifold for e in bm.edges) and len(bm.faces) > 3


def main():
    a = parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    s = print_settings.normalize(json.loads(a.settings or "{}"))
    cfg = print_settings.blender_args(s, a.size)
    if a.max_tris:
        cfg["max_tris"] = a.max_tris

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=a.src)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    if not meshes:
        raise SystemExit("Keine Meshes im GLB gefunden")

    # 1) vereinen + skalieren (Massachse) + zentrieren
    bm = merged_bmesh(meshes)
    lo, hi = bbox(bm)
    dims = hi - lo
    axis = {"x": dims.x, "y": dims.y, "z": dims.z}.get(cfg["size_axis"], max(dims.x, dims.y, dims.z))
    scale = a.size / max(axis, 1e-9)
    center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for v in bm.verts:
        v.co = (v.co - center) * scale

    # 2) geschlossen (z. B. Claudes exakte Geometrie)? Dann Kanten und Masse exakt lassen. Sonst Voxel-Remesh.
    exact = a.remesh == "auto" and is_closed(bm)
    me = bpy.data.meshes.new("skeison_print")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("skeison_print", me)
    bpy.context.scene.collection.objects.link(obj)
    if not exact:
        apply_modifier(obj, "REMESH", mode="VOXEL", voxel_size=cfg["voxel"], adaptivity=0.0, use_smooth_shade=False)

    # 3) zu viele Dreiecke? reduzieren
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris > cfg["max_tris"]:
        apply_modifier(obj, "DECIMATE", decimate_type="COLLAPSE", ratio=cfg["max_tris"] / tris)

    bm = bmesh.new()
    bm.from_mesh(obj.data)

    # 4) flache Standflaeche: unterste Schicht(en) abschneiden und Loch schliessen
    if a.flat_base:
        lo, hi = bbox(bm)
        cut = lo.z + max((hi.z - lo.z) * 0.015, cfg["voxel"] * 2, s["layer"])
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, cut), plane_no=(0, 0, 1), clear_inner=True)
        boundary = [e for e in bm.edges if e.is_boundary]
        if boundary:
            bmesh.ops.holes_fill(bm, edges=boundary, sides=0)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    # 5) beste Ausrichtung (weniger Ueberhang, mehr Auflage)
    orient_name, orient_info = "wie modelliert", {}
    if cfg["orient"]:
        orient_name, m, orient_info = analyse.best_orientation(bm, cfg["overhang"])
        if orient_name != "wie modelliert":
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=m)

    # 6) Schrumpfausgleich (Material), dann Dreiecke und auf z = 0 / Mitte stellen
    if cfg["shrink_factor"] != 1:
        bmesh.ops.scale(bm, verts=bm.verts, vec=(cfg["shrink_factor"],) * 3)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    lo, hi = bbox(bm)
    shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for v in bm.verts:
        v.co -= shift

    # 7) Analyse wie im Slicer
    result = analyse.analyse(bm, cfg)
    bm.verts.index_update()
    verts = [tuple(v.co) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()

    result.update({
        "triangles": len(faces),
        "exact": exact,
        "orientation": orient_name,
        "shrink_pct": round((cfg["shrink_factor"] - 1) * 100, 2),
        "recommend": print_settings.recommendations(s, result),
        "settings": {k: s[k] for k in ("nozzle", "layer", "material", "detail")},
    })
    if orient_info:
        result["orientation_gain"] = orient_info

    desc = "Skeison 3D · " + " · ".join(f"{k}: {v}" for k, v in result["recommend"])
    mesh_io.write_stl(os.path.join(a.out_dir, "model.stl"), verts, faces, a.name)
    mesh_io.write_3mf(os.path.join(a.out_dir, "model.3mf"), verts, faces, a.name,
                      meta={"Description": desc, "Designer": "Skeison 3D"})

    # aufraeumen (wichtig im MCP-Modus, wo die Szene offen bleibt)
    for o in imported + [obj]:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)

    print("SKEISON_RESULT " + json.dumps(result), flush=True)
    return result


if __name__ == "__main__":
    main()
