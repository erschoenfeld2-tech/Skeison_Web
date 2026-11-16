"""Druckanalyse wie im Slicer, laeuft IN Blender (genutzt von printprep.py und cadmodel.py).

- Wandstaerken: Strahl von jeder (Stichproben-)Flaeche nach innen bis zur Gegenseite (BVH)
- Spalte: Strahl nach aussen; sehr kleine Abstaende verschmelzen beim Druck
- Ueberhaenge: nach unten zeigende Flaechen steiler als der erlaubte Winkel (ohne Auflageflaeche)
- Auflageflaeche auf der Druckplatte, Groesse, Schichtanzahl
- beste Ausrichtung (6 Lagen: jede Seite einmal unten) nach Ueberhang, Auflage und Hoehe
Einheit: 1 = 1 mm, Z oben, Normale zeigen nach aussen (vorher recalc_face_normals).
"""
import math

import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ORIENTATIONS = {  # Name -> Drehung (welche Seite nach unten kommt)
    "wie modelliert": Matrix.Identity(3),
    "auf den Kopf": Matrix.Rotation(math.pi, 3, "X"),
    "nach vorne gekippt": Matrix.Rotation(math.pi / 2, 3, "X"),
    "nach hinten gekippt": Matrix.Rotation(-math.pi / 2, 3, "X"),
    "nach rechts gekippt": Matrix.Rotation(math.pi / 2, 3, "Y"),
    "nach links gekippt": Matrix.Rotation(-math.pi / 2, 3, "Y"),
}


def _bounds(bm):
    lo = Vector((min(v.co.x for v in bm.verts), min(v.co.y for v in bm.verts), min(v.co.z for v in bm.verts)))
    hi = Vector((max(v.co.x for v in bm.verts), max(v.co.y for v in bm.verts), max(v.co.z for v in bm.verts)))
    return lo, hi


def _face_data(bm):
    return [(f.normal.copy(), f.calc_area(), f.calc_center_median()) for f in bm.faces]


def surface_stats(faces, lo_z, overhang_deg, bed_eps=0.05):
    """Ueberhang- und Auflageflaeche fuer gegebene (Normale, Flaeche, Mittelpunkt)."""
    limit = math.sin(math.radians(overhang_deg))
    total = over = bed = 0.0
    over_z = 0.0
    for n, area, c in faces:
        total += area
        if n.z < -0.985 and c.z < lo_z + bed_eps:
            bed += area
        elif -n.z > limit:
            over += area
            over_z += c.z * area
    return {"total": total, "overhang": over, "bed": bed, "overhang_z": over_z / over if over else None}


def best_orientation(bm, overhang_deg):
    """Probiert 6 Lagen. Bewertung: Ueberhang zaehlt voll, Auflage gut, Hoehe leicht schlecht.
    Gibt (Name, Matrix, Infos) zurueck; die aktuelle Lage gewinnt bei Gleichstand."""
    base = _face_data(bm)
    verts = [v.co.copy() for v in bm.verts]
    results = []
    for name, m in ORIENTATIONS.items():
        faces = [(m @ n, a, m @ c) for n, a, c in base]
        pts = [m @ v for v in verts]
        lo_z = min(p.z for p in pts)
        height = max(p.z for p in pts) - lo_z
        width = max(max(p.x for p in pts) - min(p.x for p in pts), max(p.y for p in pts) - min(p.y for p in pts))
        st = surface_stats(faces, lo_z, overhang_deg)
        # Ueberhang voll, Auflage halb gut, Hoehe (relativ) leicht schlecht: flach und ohne Stuetzen gewinnt
        score = st["overhang"] - 0.5 * st["bed"] + 0.05 * st["total"] * height / max(height, width, 1.0)
        results.append((score, name, m, st, height))
    current = results[0]
    best = min(results, key=lambda r: r[0])
    if best is not current and current[0] - best[0] > 0.03 * current[3]["total"]:
        return best[1], best[2], {"overhang_before": current[3]["overhang"], "overhang_after": best[3]["overhang"]}
    return current[1], current[2], {}


def thickness(bm, min_wall, critical, samples=4000):
    """Wandstaerke (nach innen) und Spaltbreite (nach aussen) an Stichproben."""
    bm.faces.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(bm)
    faces = [f for f in bm.faces if f.normal.length > 0.5]
    step = max(1, len(faces) // samples)
    walls, gaps = [], []
    thin_area = crit_area = area_sum = 0.0
    thinnest = None
    for f in faces[::step]:
        n, c, a = f.normal, f.calc_center_median(), f.calc_area()
        area_sum += a
        # Nur echte Gegenseiten zaehlen (Normale zeigt entgegen); Treffer in Innenecken sind keine Wand/kein Spalt
        hit, hn, _, d = bvh.ray_cast(c - n * 1e-4, -n, 500.0)
        if hit is not None and n.dot(hn) < -0.5:
            walls.append(d)
            if d < min_wall:
                thin_area += a
                if thinnest is None or d < thinnest[0]:
                    thinnest = (d, c.copy())
            if d < critical:
                crit_area += a
        hit, hn, _, g = bvh.ray_cast(c + n * 1e-4, n, 5.0)
        if hit is not None and g > 1e-3 and n.dot(hn) < -0.5:
            gaps.append(g)
    walls.sort()
    gaps.sort()

    def pct(lst, p):
        return round(lst[min(len(lst) - 1, int(len(lst) * p))], 2) if lst else None

    return {
        "wall_p05": pct(walls, 0.05), "wall_median": pct(walls, 0.5),
        "thin_pct": round(100 * thin_area / area_sum, 1) if area_sum else 0.0,
        "critical_pct": round(100 * crit_area / area_sum, 1) if area_sum else 0.0,
        "thinnest_at": [round(x, 1) for x in thinnest[1]] if thinnest else None,
        "gap_min": pct(gaps, 0.02),
    }


def bodies(bm, show=5):
    """Getrennte Koerper (zusammenhaengende Teile ueber Kanten). Ein druckbares Objekt hat genau einen.
    Liefert (Anzahl, Liste der kleineren Koerper mit Umgrenzung), groesster Koerper zuerst."""
    seen, comps = set(), []
    for v in bm.verts:
        if v in seen:
            continue
        seen.add(v)
        stack, comp = [v], []
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                w = e.other_vert(x)
                if w not in seen:
                    seen.add(w)
                    stack.append(w)
        lo = [min(p.co[i] for p in comp) for i in range(3)]
        hi = [max(p.co[i] for p in comp) for i in range(3)]
        comps.append((len(comp), lo, hi))
    comps.sort(key=lambda c: -c[0])
    loose = [{"von": [round(x, 1) for x in lo], "bis": [round(x, 1) for x in hi]} for _, lo, hi in comps[1:1 + show]]
    return len(comps), loose


def analyse(bm, cfg):
    """Komplette Analyse eines druckfertigen BMesh (auf z = 0). cfg: Werte aus print_settings.blender_args."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    lo, hi = _bounds(bm)
    dims = hi - lo
    st = surface_stats(_face_data(bm), lo.z, cfg.get("overhang", 45))
    th = thickness(bm, cfg.get("min_wall", 0.9), cfg.get("critical_wall", 0.4))
    bed = cfg.get("bed") or [256, 256, 256]
    fits = (dims.x <= bed[0] and dims.y <= bed[1] or dims.y <= bed[0] and dims.x <= bed[1]) and dims.z <= bed[2]
    layer = cfg.get("layer", 0.2)
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
    n_bodies, loose = bodies(bm)
    return {
        "bodies": n_bodies,
        "loose_parts": loose,
        "size_mm": [round(dims.x, 2), round(dims.y, 2), round(dims.z, 2)],
        "layers": int(math.ceil(dims.z / layer - 1e-6)) if layer else None,
        "overhang_pct": round(100 * st["overhang"] / st["total"], 1) if st["total"] else 0.0,
        "overhang_z": round(st["overhang_z"], 1) if st["overhang_z"] is not None else None,
        "bed_area_mm2": round(st["bed"], 1),
        "fits_bed": fits,
        "watertight": non_manifold == 0,
        "non_manifold_edges": non_manifold,
        **th,
    }


def describe_loose(a):
    """Text zu losen Teilen (fuer Claude und als Warnung)."""
    where = "; ".join(f"x {p['von'][0]}..{p['bis'][0]}, y {p['von'][1]}..{p['bis'][1]}, z {p['von'][2]}..{p['bis'][2]}"
                      for p in a.get("loose_parts") or [])
    return (f"{a['bodies']} GETRENNTE KOERPER statt einem: {a['bodies'] - 1} Teil(e) haengen nicht am Hauptkoerper "
            f"(schweben frei oder beruehren ihn nur ohne Ueberlappung)" + (f", z. B. bei {where}" if where else "") + ".")


def describe(a, cfg):
    """Kurzer deutscher Text fuer Claudes Kontrolle."""
    parts = [f"Masse {a['size_mm'][0]} x {a['size_mm'][1]} x {a['size_mm'][2]} mm, {a['layers']} Schichten."]
    if a.get("bodies", 1) > 1:
        parts.append(describe_loose(a))
    if a.get("wall_p05") is not None:
        parts.append(f"Wandstaerke: duennste 5 % {a['wall_p05']} mm, Median {a['wall_median']} mm "
                     f"(Minimum {cfg.get('min_wall')} mm); {a['thin_pct']} % der Flaeche zu duenn, "
                     f"{a['critical_pct']} % unter {cfg.get('critical_wall')} mm (wird nicht gedruckt)"
                     + (f", duennste Stelle bei {a['thinnest_at']}." if a.get("thinnest_at") else "."))
    if a.get("gap_min") is not None and a["gap_min"] < cfg.get("critical_wall", 0.4):
        parts.append(f"Spalte nur {a['gap_min']} mm breit: verschmelzen beim Druck.")
    parts.append(f"Ueberhang ueber {cfg.get('overhang', 45):.0f} Grad: {a['overhang_pct']} % der Oberflaeche"
                 + (f" (Schwerpunkt bei z = {a['overhang_z']} mm)" if a.get("overhang_z") is not None and a["overhang_pct"] > 0.5 else "")
                 + f", Auflageflaeche {a['bed_area_mm2']} mm2.")
    if not a["fits_bed"]:
        parts.append(f"Passt NICHT auf das Druckbett {cfg.get('bed')}.")
    if not a["watertight"]:
        parts.append(f"Nicht geschlossen: {a['non_manifold_edges']} offene/ueberzaehlige Kanten.")
    return " ".join(parts)
