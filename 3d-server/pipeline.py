"""Ein Auftrag von Anfang bis Ende: (Claude) -> Meshy -> Blender -> STL / 3MF.

Wird von app.py (Direktbetrieb ueber HTTP) und worker.py (Auftraege aus Supabase) genutzt.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field

import blender_runner
import claude_step
import meshy
import mesh_io

log = logging.getLogger("skeison3d")

DEMO = os.getenv("DEMO_MODE", "0") == "1"
BLENDER_LOCK = threading.Semaphore(int(os.getenv("BLENDER_PARALLEL", "1")))


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

    def public(self) -> dict:
        return {
            "id": self.id, "state": self.state, "stage": self.stage, "progress": self.progress,
            "message": self.message, "name": self.name, "hint": self.hint, "result": self.result,
        }


def slug(s: str) -> str:
    s = s.lower().translate(str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40].strip("-") or "modell"


def run(job: Job) -> None:
    """Fuehrt den Auftrag aus. Ergebnis liegt danach in job.dir/out/model.stl und model.3mf."""
    job.state = "running"
    try:
        prompt = job.description.strip()

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

        glb = os.path.join(job.dir, "meshy.glb")
        out = os.path.join(job.dir, "out")

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
                          "watertight": True, "non_manifold_edges": 0, "demo": True}
        else:
            # 2) Meshy
            job.stage, job.message, job.progress = "generate", "3D-Modell entsteht", 0
            url = meshy.generate(prompt, job.images, lambda p: setattr(job, "progress", p))
            meshy.download(url, glb)
            # 3) Blender
            job.stage, job.message = "blender", "Blender macht es druckfertig"
            with BLENDER_LOCK:
                job.result = blender_runner.prepare(glb, out, job.name, job.size_mm, job.flat_base)

        job.stage, job.state, job.progress, job.message = "done", "done", 100, "Fertig"
    except (meshy.MeshyError, blender_runner.BlenderError, RuntimeError) as e:
        log.warning("Job %s fehlgeschlagen: %s", job.id, e)
        job.state, job.message = "error", str(e).split("\n")[0]
    except Exception:  # noqa: BLE001
        log.exception("Job %s: unerwarteter Fehler", job.id)
        job.state, job.message = "error", "Unerwarteter Fehler auf dem Server."
