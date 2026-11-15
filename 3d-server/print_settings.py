"""Druckeinstellungen wie im Slicer: was der Besucher waehlt, wird hier geprueft und in Werte fuer
Modellierung (Claude), Druckvorbereitung (Blender) und Empfehlungen umgerechnet.

Geometrie-wirksam: Duese (Mindestwand, kleinste Details), Schichthoehe, Material (Schrumpf, Ueberhang),
Druckbett (passt es?), Massachse (welche Kante die Groesse meint), Passungsspiel (fuer Loecher/Steckteile),
Ausrichtung, Stuetzen vermeiden, Detailgrad (Aufloesung).
Nur Empfehlung (gehoert in den Slicer): Waende, Fuellung, Stuetzen, Brim, Temperaturen.
"""
from __future__ import annotations

import math

# Richtwerte je Material: Schrumpf in %, max. Ueberhang ohne Stuetzen, Duese/Bett in Grad C, Brim noetig?
MATERIALS = {
    "PLA":  {"shrink": 0.2, "overhang": 50, "t_nozzle": 210, "t_bed": 60, "brim": False, "label": "PLA"},
    "PETG": {"shrink": 0.3, "overhang": 45, "t_nozzle": 240, "t_bed": 80, "brim": False, "label": "PETG"},
    "ABS":  {"shrink": 0.7, "overhang": 45, "t_nozzle": 250, "t_bed": 100, "brim": True, "label": "ABS"},
    "ASA":  {"shrink": 0.6, "overhang": 45, "t_nozzle": 255, "t_bed": 100, "brim": True, "label": "ASA"},
    "TPU":  {"shrink": 0.2, "overhang": 40, "t_nozzle": 225, "t_bed": 50, "brim": False, "label": "TPU (flexibel)"},
}
DETAIL = {  # Voxelgroesse als Anteil der Duese, Mindestanteil der Objektgroesse, max. Dreiecke
    "standard": (1 / 4, 1 / 400, 150_000),
    "fein": (1 / 6, 1 / 600, 300_000),
    "sehr_fein": (1 / 8, 1 / 800, 500_000),
}
DEFAULTS = {
    "nozzle": 0.4, "layer": 0.2, "material": "PLA", "bed": [256, 256, 256], "size_axis": "max",
    "clearance": 0.2, "overhang": 45, "orient": True, "no_support": True, "shrink": False, "detail": "standard",
}


def _num(v, lo, hi, default):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return default if math.isnan(f) else max(lo, min(hi, f))


def normalize(raw: dict | None) -> dict:
    """Unbekanntes verwerfen, Werte begrenzen. Ergebnis ist immer vollstaendig."""
    raw = raw if isinstance(raw, dict) else {}
    s = dict(DEFAULTS)
    s["nozzle"] = _num(raw.get("nozzle"), 0.1, 1.2, 0.4)
    s["layer"] = min(_num(raw.get("layer"), 0.04, 0.6, 0.2), s["nozzle"] * 0.8)
    s["material"] = raw.get("material") if raw.get("material") in MATERIALS else "PLA"
    bed = raw.get("bed") if isinstance(raw.get("bed"), (list, tuple)) and len(raw.get("bed")) == 3 else DEFAULTS["bed"]
    s["bed"] = [_num(b, 50, 1000, 256) for b in bed]
    s["size_axis"] = raw.get("size_axis") if raw.get("size_axis") in ("max", "x", "y", "z") else "max"
    s["clearance"] = _num(raw.get("clearance"), 0.0, 1.0, 0.2)
    s["overhang"] = _num(raw.get("overhang"), 20, 75, MATERIALS[s["material"]]["overhang"])
    for k in ("orient", "no_support", "shrink"):
        s[k] = bool(raw.get(k, DEFAULTS[k]))
    s["detail"] = raw.get("detail") if raw.get("detail") in DETAIL else "standard"
    return s


def derived(s: dict, size_mm: float) -> dict:
    """Abgeleitete Werte fuer Blender und Claude."""
    line = round(s["nozzle"] * 1.125, 2)              # uebliche Linienbreite
    frac_noz, frac_size, max_tris = DETAIL[s["detail"]]
    voxel = max(s["nozzle"] * frac_noz, size_mm * frac_size, 0.04)
    mat = MATERIALS[s["material"]]
    return {
        "line_width": line,
        "min_wall": round(2 * line, 2),                 # zwei Linien: sicher druckbar
        "critical_wall": round(s["nozzle"], 2),         # darunter druckt der Slicer gar nichts
        "min_feature": round(max(2 * s["nozzle"], 3 * s["layer"]), 2),
        "voxel": round(voxel, 3),
        "max_tris": max_tris,
        "shrink_factor": 1 + (mat["shrink"] / 100 if s["shrink"] else 0),
    }


def blender_args(s: dict, size_mm: float) -> dict:
    """Was printprep.py braucht (als JSON uebergeben)."""
    d = derived(s, size_mm)
    return {"nozzle": s["nozzle"], "layer": s["layer"], "bed": s["bed"], "size_axis": s["size_axis"],
            "overhang": s["overhang"], "orient": s["orient"], "material": s["material"],
            "min_wall": d["min_wall"], "critical_wall": d["critical_wall"], "voxel": d["voxel"],
            "max_tris": d["max_tris"], "shrink_factor": d["shrink_factor"]}


def for_claude(s: dict, size_mm: float) -> str:
    """Druckvorgaben als Text fuer Claudes Modellierung."""
    d = derived(s, size_mm)
    mat = MATERIALS[s["material"]]
    lines = [
        f"Drucker: Duese {s['nozzle']} mm (Linienbreite {d['line_width']} mm), Schichthoehe {s['layer']} mm, "
        f"Material {mat['label']}, Druckbett {s['bed'][0]:.0f} x {s['bed'][1]:.0f} x {s['bed'][2]:.0f} mm.",
        f"Mindestwandstaerke {d['min_wall']} mm (besser 3-4 Linien = {round(3 * d['line_width'], 1)}-{round(4 * d['line_width'], 1)} mm "
        f"fuer stabile Teile), kleinste Details/Stege {d['min_feature']} mm, Text mindestens {max(6, round(10 * s['nozzle']))} mm hoch.",
        f"Hoehen von Stufen, Kanten und Textdicke moeglichst als Vielfache der Schichthoehe ({s['layer']} mm).",
        f"Passungsspiel {s['clearance']} mm: Loecher, Aussparungen und Steckverbindungen fuer andere Teile um dieses Spiel "
        "groesser (Durchmesser +2x Spiel) bzw. Zapfen kleiner bauen.",
    ]
    if s["no_support"]:
        lines.append(f"Ohne Stuetzen druckbar konstruieren: Ueberhaenge hoechstens {s['overhang']:.0f} Grad gegen die Senkrechte, "
                     "waagerechte Bruecken kurz (unter 10 mm), Unterseiten von Ausladungen mit 45-Grad-Fasen statt flach.")
    else:
        lines.append(f"Ueberhaenge ueber {s['overhang']:.0f} Grad sind erlaubt (Stuetzen werden gedruckt).")
    return "\n".join(lines)


def recommendations(s: dict, a: dict) -> list[list[str]]:
    """Slicer-Empfehlungen aus Einstellungen und Analyse (a = Ergebnis von printprep)."""
    mat = MATERIALS[s["material"]]
    d = derived(s, max(a.get("size_mm") or [80]))
    rec = [["Schichthöhe", f"{s['layer']:.2f} mm".replace(".", ",")]]
    median = a.get("wall_median")
    walls = 2 if median and median < 3 * d["line_width"] else 3  # duenne Teile bestehen ohnehin nur aus Waenden
    rec.append(["Wände", f"{walls} ({walls * d['line_width']:.1f} mm)".replace(".", ",")])
    size = max(a.get("size_mm") or [80])
    rec.append(["Füllung", "20 % Gyroid" if size < 40 else "15 % Gyroid"])
    ov = a.get("overhang_pct", 0)
    if ov < 0.5:
        rec.append(["Stützen", "keine"])
    elif ov < 5:
        rec.append(["Stützen", "nur auf der Druckplatte"])
    else:
        rec.append(["Stützen", "ja, Baumstützen (organisch)"])
    sx, sy, sz = (a.get("size_mm") or [1, 1, 1])
    base = a.get("bed_area_mm2", 0)
    tall = sz / max(1.0, math.sqrt(max(base, 1.0))) > 3
    if mat["brim"] or base < 150 or tall:
        rec.append(["Brim", "ja, 5 mm" + (" (kleine Standfläche)" if base < 150 else " (hoch und schmal)" if tall else "")])
    else:
        rec.append(["Brim", "nicht nötig"])
    rec.append(["Temperatur", f"Düse {mat['t_nozzle']} °C · Bett {mat['t_bed']} °C ({mat['label']}, Richtwert)"])
    if s["shrink"]:
        rec.append(["Schrumpf", f"im Modell ausgeglichen (+{mat['shrink']:.1f} %), im Slicer keinen Schrumpf eintragen".replace(".", ",")])
    return rec
