"""Schrift fuer Claudes Modelle (laeuft IN Blender, wird von cadmodel.py als Hilfsfunktion bereitgestellt).

Warum eigene Funktionen: Von Hand gesetzte Schrift ging oft schief (feste Abstaende -> "SKE I SON", flacher Text auf
Rundungen schwebt an den Raendern, zu duenne Striche, Gravur 0,1 mm statt 1 mm). Diese Funktionen
- setzen Buchstaben nach ihrer echten Breite (Laufweite einheitlich),
- machen die Striche so dick, dass sie mit der gewaehlten Duese druckbar sind (Kurven-Offset, "fett"),
- bauen erhabene Schrift 0,8 mm in die Wand hinein bzw. Gravur mit echter Tiefe,
- folgen auf Zylindern der Rundung (jeder Buchstabe einzeln),
- vereinigen bzw. schneiden mit dem Koerper (Boolean EXACT) und
- halten fest, was gebaut wurde (TEXT_LOG): Hoehe, Strichstaerke, Tiefe. Das geht als Tatsache an Claude und den Besucher.
Einheit mm. Hoehe = Hoehe der Grossbuchstaben.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

TEXT_LOG = []
CFG = {"line_width": 0.45, "min_wall": 0.9}   # wird von cadmodel.py aus den Druckeinstellungen gesetzt
SINK = 0.8          # so tief steckt erhabene Schrift in der Flaeche
CUT_OVER = 0.6      # so weit ragt ein Gravur-Schneider ueber die Flaeche hinaus (sauberer Schnitt)
_METRICS = {}


def _font_metrics():
    """Verhaeltnis Kurven-Groesse -> Grossbuchstabenhoehe und Strichstaerke der Standardschrift (einmal gemessen)."""
    if not _METRICS:
        w, h = _measure("H", 10.0, 0.0)[1:3]
        _METRICS["cap"] = h / 10.0
        _METRICS["stroke"] = _measure("I", 10.0, 0.0)[1] / 10.0
    return _METRICS


def _measure(ch, size, offset):
    cu = bpy.data.curves.new("m", "FONT")
    cu.body, cu.size, cu.offset = ch, size, offset
    ob = bpy.data.objects.new("m", cu)
    bpy.context.scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    if not me.vertices:
        bpy.data.meshes.remove(me)
        return None, 0.0, 0.0, 0.0
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    return me, max(xs) - min(xs), max(ys) - min(ys), min(xs)


def _glyphs(text, height, z0, z1):
    """Ein Mesh je Zeichen in lokalen Koordinaten: x nach rechts, y nach oben (Grundlinie 0), z von z0 bis z1.
    Gibt (Liste[(mesh, x_mitte)], Gesamtlaenge, Strichstaerke, Offset) zurueck; Leerzeichen erzeugen nur Abstand."""
    m = _font_metrics()
    size = height / m["cap"]
    stroke = m["stroke"] * size
    min_stroke = max(CFG["min_wall"], 2 * CFG["line_width"])
    offset = max(0.0, (min_stroke - stroke) / 2)
    track, space = 0.12 * height, 0.38 * height
    out, x = [], 0.0
    for ch in str(text)[:80]:
        if ch.isspace():
            x += space
            continue
        cu = bpy.data.curves.new("g", "FONT")
        cu.body, cu.size, cu.offset = ch, size, offset
        cu.extrude = (z1 - z0) / 2
        ob = bpy.data.objects.new("g", cu)
        bpy.context.scene.collection.objects.link(ob)
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.curves.remove(cu)
        if not me.vertices:
            bpy.data.meshes.remove(me)
            x += space
            continue
        xs = [v.co.x for v in me.vertices]
        w, minx = max(xs) - min(xs), min(xs)
        # an die Laufposition schieben (linker Rand bei x) und in der Tiefe auf z0..z1 legen
        me.transform(Matrix.Translation((x - minx, 0, (z0 + z1) / 2)))
        out.append((me, x + w / 2))
        x += w + track
    length = max(0.0, x - track)
    for me, _ in out:
        me.transform(Matrix.Translation((-length / 2, -height / 2, 0)))   # mittig um (0, 0)
    return [(me, xc - length / 2) for me, xc in out], length, stroke + 2 * offset, offset


def _depths(relief, engrave):
    if engrave:
        d = max(0.6, float(engrave))
        return "graviert", d, -d, CUT_OVER
    r = float(relief or 1.2)
    return "erhaben", r, -SINK, r


def _apply(body, glyph_meshes, mode, name):
    bm = bmesh.new()
    for me in glyph_meshes:
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if body is not None:
        mod = body.modifiers.new(name, "BOOLEAN")
        mod.operation = "DIFFERENCE" if mode == "graviert" else "UNION"
        mod.solver = "EXACT"
        mod.object = ob
        ob.hide_render = True
        ob.display_type = "WIRE"
    return ob


def _axis(v):
    if isinstance(v, str):
        sign = -1.0 if v.strip().startswith("-") else 1.0
        return Vector({"X": (1, 0, 0), "Y": (0, 1, 0), "Z": (0, 0, 1)}[v.strip().lstrip("+-").upper()]) * sign
    return Vector(v).normalized()


def text_on_plane(body, text, center, normal="-Y", height=8.0, relief=1.2, engrave=None, up=None, name="schrift"):
    """Schrift auf einer EBENEN Flaeche. center = Punkt auf der Flaeche (Mitte der Schrift), normal = nach aussen
    zeigende Flaechennormale ("-Y" = Vorderseite, "+Z" = Oberseite ...). Erhaben (relief mm) oder graviert (engrave mm).
    body = Koerper, mit dem vereinigt bzw. aus dem geschnitten wird (None = nur Schrift als eigenes Teil)."""
    mode, depth, z0, z1 = _depths(relief, engrave)
    meshes, length, stroke, offset = _glyphs(text, height, z0, z1)
    n = _axis(normal)
    u = _axis(up) if up else (Vector((0, 1, 0)) if abs(n.z) > 0.9 else Vector((0, 0, 1)))
    if abs(n.z) > 0.9 and up is None:
        u = Vector((0, 1, 0)) if n.z > 0 else Vector((0, -1, 0))
    r = u.cross(n).normalized()          # Leserichtung von aussen gesehen
    u = n.cross(r).normalized()
    m = Matrix((r, u, n)).transposed().to_4x4()
    m.translation = Vector(center)
    for me, _ in meshes:
        me.transform(m)
    ob = _apply(body, [me for me, _ in meshes], mode, name)
    TEXT_LOG.append({"text": str(text)[:80], "flaeche": "eben", "modus": mode, "tiefe_mm": round(depth, 2),
                     "hoehe_mm": round(height, 2), "strich_mm": round(stroke, 2), "laenge_mm": round(length, 1)})
    return ob


def text_on_cylinder(body, text, radius, z, height=8.0, relief=1.2, engrave=None, angle=0.0, center=(0.0, 0.0),
                     name="schrift"):
    """Schrift auf der Aussenseite eines senkrechten Zylinders (Achse parallel zu Z durch center, Aussenradius radius).
    Jeder Buchstabe folgt der Rundung. angle = Richtung der Schriftmitte in Grad (0 = vorne/-Y, 90 = rechts/+X).
    z = Hoehe der Schriftmitte. Erhaben (relief mm) oder graviert (engrave mm)."""
    mode, depth, z0, z1 = _depths(relief, engrave)
    meshes, length, stroke, offset = _glyphs(text, height, z0, z1)
    a0 = math.radians(angle)
    cx, cy = center
    placed = []
    for me, xc in meshes:
        phi = a0 + xc / radius
        n = Vector((math.sin(phi), -math.cos(phi), 0))
        t = Vector((math.cos(phi), math.sin(phi), 0))
        # Buchstabe lokal um seine eigene Mitte drehen: erst an x = 0 schieben, dann auf die Rundung setzen
        me.transform(Matrix.Translation((-xc, 0, 0)))
        m = Matrix((t, Vector((0, 0, 1)), n)).transposed().to_4x4()
        m.translation = Vector((cx, cy, z)) + n * radius
        me.transform(m)
        placed.append(me)
    ob = _apply(body, placed, mode, name)
    arc = length / (2 * math.pi * radius) * 360
    TEXT_LOG.append({"text": str(text)[:80], "flaeche": f"Zylinder R {radius:g}", "modus": mode, "tiefe_mm": round(depth, 2),
                     "hoehe_mm": round(height, 2), "strich_mm": round(stroke, 2), "laenge_mm": round(length, 1),
                     "bogen_grad": round(arc, 1)})
    if arc > 300:
        TEXT_LOG[-1]["warnung"] = "Schrift laeuft fast ganz um den Zylinder"
    return ob


def summary():
    """Kurzer Text fuer Claude/Besucher: was an Schrift wirklich gebaut wurde."""
    out = []
    for t in TEXT_LOG:
        out.append(f"Schrift '{t['text']}' {t['modus']} {t['tiefe_mm']} mm, Hoehe {t['hoehe_mm']} mm, Strich {t['strich_mm']} mm, "
                   f"Laenge {t['laenge_mm']} mm auf {t['flaeche']}" + (f" ({t['bogen_grad']} Grad Bogen)" if "bogen_grad" in t else ""))
    return out
