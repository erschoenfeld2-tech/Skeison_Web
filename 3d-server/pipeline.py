"""Ein Auftrag von Anfang bis Ende -> STL / 3MF.

GENERATOR=claude: Claude modelliert in Blender (cad_generator.py), nur ueber das Claude-Abo, ohne Meshy.
GENERATOR=meshy:  Claude formuliert einen Prompt, Meshy erzeugt das Modell (kostet Meshy-Credits).
GENERATOR=auto (Standard): meshy, wenn MESHY_API_KEY gesetzt ist, sonst claude.
Danach immer blender/printprep.py: wasserdicht, Groesse, Standflaeche, Ausrichtung, Analyse wie im Slicer.
Druckeinstellungen des Besuchers (Duese, Schicht, Material ...) stehen in job.settings (print_settings.py).

Weiterbearbeiten: Jeder fertige Auftrag legt final.json + final.glb in seinem Ordner ab (Skript, Bauplan, Sollmasse).
Ein Folgeauftrag nennt ihn als parent und waehlt edit:
  "claude"  = Claude aendert das bisherige Skript nach job.description (kostet Claude-Aufrufe),
  "rebuild" = nur neu berechnen mit neuer Groesse/neuen Druckeinstellungen (ohne Claude, nur Blender).

Wird von app.py (Direktbetrieb ueber HTTP) und worker.py (Auftraege aus Supabase) genutzt.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import threading
import time
from dataclasses import dataclass, field

import blender_runner
import cad_generator
import claude_step
import meshy
import mesh_io
import print_settings

log = logging.getLogger("skeison3d")

DEMO = os.getenv("DEMO_MODE", "0") == "1"
BLENDER_LOCK = threading.Semaphore(int(os.getenv("BLENDER_PARALLEL", "1")))
GENERATOR = os.getenv("GENERATOR", "auto").strip().lower()


def generator() -> str:
    if GENERATOR in ("claude", "meshy"):
        return GENERATOR
    return "meshy" if os.getenv("MESHY_API_KEY") else "claude"


@dataclass
class Job:
    id: str
    dir: str
    description: str
    images: list[str]
    size_mm: float
    size_user: bool
    flat_base: bool
    created: float = field(default_factory=time.time)
    state: str = "queued"  # queued | running | done | error
    stage: str = "queued"  # queued | analyse | generate | blender | done
    progress: int = 0
    message: str = "In der Warteschlange"
    name: str = "modell"
    hint: str = ""
    result: dict | None = None
    settings: dict = field(default_factory=dict)
    parent: str = ""   # Folgeauftrag: Ordnername (Auftrags-ID) des vorherigen Modells
    edit: str = ""     # "claude" | "rebuild" (siehe oben)
    cad: dict | None = None  # Stand zum Weiterbearbeiten (wird als final.json gespeichert)
    usage: dict | None = None  # Claude-Verbrauch dieses Auftrags (nur Log und test_modell.py, nicht fuer die Seite)

    def __post_init__(self) -> None:
        self.settings = print_settings.normalize(self.settings)

    def public(self) -> dict:
        return {
            "id": self.id, "state": self.state, "stage": self.stage, "progress": self.progress,
            "message": self.message, "name": self.name, "hint": self.hint, "result": self.result,
        }


def slug(s: str) -> str:
    s = s.lower().translate(str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40].strip("-") or "modell"


ID_RE = re.compile(r"[A-Za-z0-9_-]{8,64}")


def load_base(job: Job) -> dict:
    """Gespeicherten Stand des vorherigen Auftrags laden (nur aus dem eigenen Datenordner)."""
    if not ID_RE.fullmatch(job.parent or ""):
        raise RuntimeError("Ungültiger Verweis auf das vorherige Modell.")
    pdir = os.path.join(os.path.dirname(job.dir), job.parent)
    path = os.path.join(pdir, "final.json")
    if not os.path.isfile(path):
        raise RuntimeError("Das vorherige Modell ist nicht mehr verfügbar (älter als 24 Stunden oder auf einem anderen "
                           "Server erstellt). Bitte neu erstellen.")
    with open(path, encoding="utf-8") as f:
        base = json.load(f)
    base["glb_path"] = os.path.join(pdir, base.get("glb_file") or "final.glb")
    return base


def save_final(job: Job, glb: str, extra: dict) -> None:
    """Stand fuer spaetere Aenderungen ablegen: final.glb (unaufbereitetes Modell) + final.json."""
    dst = os.path.join(job.dir, "final.glb")
    if os.path.abspath(glb) != os.path.abspath(dst):
        shutil.copyfile(glb, dst)
    data = {"name": job.name, "size_mm": job.size_mm, "glb_file": "final.glb", **extra}
    with open(os.path.join(job.dir, "final.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def run(job: Job) -> None:
    """Fuehrt den Auftrag aus. Ergebnis liegt danach in job.dir/out/model.stl und model.3mf."""
    job.state = "running"
    try:
        prompt = job.description.strip()
        glb = os.path.join(job.dir, "meshy.glb")
        out = os.path.join(job.dir, "out")
        base = load_base(job) if job.parent and not DEMO else None   # Demo: immer die Beispiel-Vase

        if base and job.edit == "rebuild":
            # Nur neu berechnen: gleiches Modell, neue Groesse/Druckeinstellungen, ohne Claude
            job.stage, job.message, job.progress = "blender", "Blender rechnet neu", 100
            job.name = slug(base.get("name") or job.name)
            settings = dict(job.settings)
            if not job.size_user:
                settings["size_axis"] = "max"
                job.size_mm = float(base.get("size_mm") or job.size_mm)
            job.size_mm = max(10.0, min(300.0, float(job.size_mm)))
            with BLENDER_LOCK:
                job.result = blender_runner.prepare(base["glb_path"], out, job.name, job.size_mm, bool(base.get("flat")), settings)
            job.result["open_issues"] = []
            job.hint = "Neu berechnet mit deinen aktuellen Druckeinstellungen, ohne KI."
            save_final(job, base["glb_path"], {k: v for k, v in base.items() if k not in ("name", "size_mm", "glb_file", "glb_path")})
            job.stage, job.state, job.progress, job.message = "done", "done", 100, "Fertig"
            return

        if base and job.edit == "claude" and not base.get("script"):
            raise RuntimeError("Dieses Modell kann nur neu berechnet werden, nicht per Beschreibung geändert.")
        if base and job.edit != "claude":
            raise RuntimeError("Unbekannte Art der Änderung.")

        if not DEMO and (generator() == "claude" or base):
            # Claude modelliert selbst in Blender (nur Abo, kein Meshy)
            job.stage, job.message = "analyse", "Claude ändert das Modell" if base else "Claude entwirft das Modell"

            def progress(p: int) -> None:
                job.stage, job.message, job.progress = "generate", "Claude baut und prüft das Modell", p

            glb, stats = cad_generator.generate(job, progress, base)
            job.name = slug(job.name)
            settings = dict(job.settings)
            if not job.size_user:  # Claudes Masse unveraendert uebernehmen
                settings["size_axis"] = "max"
                job.size_mm = max(stats.get("size_mm") or [job.size_mm])
            job.size_mm = max(10.0, min(300.0, float(job.size_mm)))  # Grenzen wie in der Datenbank (p3d_jobs.size_mm)
            job.stage, job.message, job.progress = "blender", "Blender macht es druckfertig", 100
            with BLENDER_LOCK:
                # Standflaeche baut Claude selbst; nicht nochmal abschneiden (sonst stimmen die Masse nicht)
                job.result = blender_runner.prepare(glb, out, job.name, job.size_mm, False, settings)
            # offene Pflichtpruefungen aus Claudes Bau (z. B. lose Teile, Massabweichung) fuer die Seite mitgeben
            job.result["open_issues"] = stats.get("open_issues") or []
            if job.cad:
                save_final(job, glb, {**{k: v for k, v in job.cad.items() if k != "glb"}, "flat": False, "generator": "claude"})
            job.stage, job.state, job.progress, job.message = "done", "done", 100, "Fertig"
            return

        # 1) Claude (nur mit Beschreibung)
        if prompt and not DEMO:
            job.stage, job.message = "analyse", "Beschreibung wird verstanden"
            r = claude_step.refine(prompt, job.images, job.dir)
            if r and r.get("refused"):
                raise RuntimeError("Diese Beschreibung kann leider nicht verarbeitet werden.")
            if r:
                prompt = r["meshy_prompt"] or prompt
                job.name = slug(r.get("name") or job.name)
                job.hint = r.get("hint") or ""
                if not job.size_user and r.get("size_mm"):
                    job.size_mm = max(10.0, min(300.0, float(r["size_mm"])))
        elif prompt:
            job.name = slug(prompt[:30])

        if DEMO:
            job.stage, job.message = "analyse", "Demo: Beschreibung wird verstanden"
            time.sleep(1.2)
            job.stage, job.message = "generate", "Demo: 3D-Modell entsteht"
            for p in range(0, 101, 20):
                job.progress = p
                time.sleep(0.5)
            job.stage, job.message = "blender", "Demo: Blender macht es druckfertig"
            os.makedirs(out, exist_ok=True)
            verts, tris = mesh_io.demo_vase(job.size_mm)
            mesh_io.write_stl(os.path.join(out, "model.stl"), verts, tris, job.name)
            mesh_io.write_3mf(os.path.join(out, "model.3mf"), verts, tris, job.name)
            time.sleep(0.8)
            r = 0.32 * job.size_mm * 2
            job.result = {"triangles": len(tris), "size_mm": [round(r, 1), round(r, 1), job.size_mm],
                          "watertight": True, "non_manifold_edges": 0, "demo": True, "exact": False,
                          "layers": int(job.size_mm / job.settings["layer"]), "overhang_pct": 0.0, "fits_bed": True,
                          "wall_p05": 1.6, "wall_median": 2.0, "bed_area_mm2": round(3.14 * (0.2 * job.size_mm) ** 2, 1),
                          "orientation": "wie modelliert"}
            job.result["recommend"] = print_settings.recommendations(job.settings, job.result)
        else:
            # 2) Meshy
            job.stage, job.message, job.progress = "generate", "3D-Modell entsteht", 0
            url = meshy.generate(prompt, job.images, lambda p: setattr(job, "progress", p))
            meshy.download(url, glb)
            # 3) Blender
            job.stage, job.message = "blender", "Blender macht es druckfertig"
            with BLENDER_LOCK:
                job.result = blender_runner.prepare(glb, out, job.name, job.size_mm, job.flat_base, job.settings)
            save_final(job, glb, {"description": job.description, "flat": job.flat_base, "generator": "meshy"})

        job.stage, job.state, job.progress, job.message = "done", "done", 100, "Fertig"
    except (meshy.MeshyError, blender_runner.BlenderError, cad_generator.CadError, RuntimeError) as e:
        log.warning("Job %s fehlgeschlagen: %s", job.id, e)
        job.state, job.message = "error", str(e).split("\n")[0]
    except Exception:  # noqa: BLE001
        log.exception("Job %s: unerwarteter Fehler", job.id)
        job.state, job.message = "error", "Unerwarteter Fehler auf dem Server."
