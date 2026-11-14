"""Macht aus einem GLB ein druckfertiges Modell und schreibt STL + 3MF.

Laeuft IN Blender (4.2 LTS oder neuer), entweder
  headless:  blender -b --factory-startup -P printprep.py -- --in a.glb --out-dir DIR --size 80
oder ueber die blender-mcp-Verbindung (Port 9876), dann per runpy gestartet.

Schritte: importieren -> zu einem Objekt vereinen -> auf Zielgroesse skalieren ->
Voxel-Remesh (wasserdicht, keine Loecher) -> ggf. reduzieren -> flache Standflaeche ->
Normalen korrigieren -> auf die Druckplatte stellen -> STL/3MF schreiben.
Einheit: 1 Blender-Einheit = 1 mm.
"""
import argparse
import json
import os
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import mesh_io  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--name", default="modell")
    p.add_argument("--size", type=float, default=80.0, help="laengste Kante in mm")
    p.add_argument("--flat-base", type=int, default=1)
    p.add_argument("--max-tris", type=int, default=250000)
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
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
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


def main():
    a = parse_args()
    os.makedirs(a.out_dir, exist_ok=True)

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=a.src)
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    if not meshes:
        raise SystemExit("Keine Meshes im GLB gefunden")

    # 1) vereinen + skalieren + zentrieren
    bm = merged_bmesh(meshes)
    lo, hi = bbox(bm)
    dims = hi - lo
    scale = a.size / max(dims.x, dims.y, dims.z, 1e-9)
    center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for v in bm.verts:
        v.co = (v.co - center) * scale

    me = bpy.data.meshes.new("skeison_print")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("skeison_print", me)
    bpy.context.scene.collection.objects.link(obj)

    # 2) Voxel-Remesh: schliesst Loecher, entfernt innere Flaechen -> wasserdicht
    voxel = max(a.size / 320.0, 0.12)
    apply_modifier(obj, "REMESH", mode="VOXEL", voxel_size=voxel, adaptivity=0.0, use_smooth_shade=False)

    # 3) zu viele Dreiecke? reduzieren
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris > a.max_tris:
        apply_modifier(obj, "DECIMATE", decimate_type="COLLAPSE", ratio=a.max_tris / tris)

    bm = bmesh.new()
    bm.from_mesh(obj.data)

    # 4) flache Standflaeche: unterste ~1.5 % abschneiden und Loch schliessen
    if a.flat_base:
        lo, hi = bbox(bm)
        cut = lo.z + max((hi.z - lo.z) * 0.015, voxel * 2)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, cut), plane_no=(0, 0, 1), clear_inner=True)
        boundary = [e for e in bm.edges if e.is_boundary]
        if boundary:
            bmesh.ops.holes_fill(bm, edges=boundary, sides=0)

    # 5) Normalen, Dreiecke, auf z = 0 stellen
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    lo, hi = bbox(bm)
    shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for v in bm.verts:
        v.co -= shift
    lo, hi = bbox(bm)

    non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
    bm.verts.index_update()
    verts = [tuple(v.co) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()

    stl = os.path.join(a.out_dir, "model.stl")
    tmf = os.path.join(a.out_dir, "model.3mf")
    mesh_io.write_stl(stl, verts, faces, a.name)
    mesh_io.write_3mf(tmf, verts, faces, a.name)

    # aufraeumen (wichtig im MCP-Modus, wo die Szene offen bleibt)
    for o in imported + [obj]:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)

    result = {
        "triangles": len(faces),
        "size_mm": [round(hi.x - lo.x, 1), round(hi.y - lo.y, 1), round(hi.z - lo.z, 1)],
        "watertight": non_manifold == 0,
        "non_manifold_edges": non_manifold,
    }
    print("SKEISON_RESULT " + json.dumps(result), flush=True)
    return result


if __name__ == "__main__":
    main()
