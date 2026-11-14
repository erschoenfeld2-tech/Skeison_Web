"""3D-Druck - Server fuer site/3d/.

Beschreibung und/oder Fotos -> (Claude) -> Meshy -> Blender -> STL / 3MF.
Start lokal (im Ordner 3d-server):   uvicorn app:app --reload --port 8000   -> http://localhost:8000/3d/
"""
from __future__ import annotations

import logging
import os
import re
import secrets
import shutil
import threading
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

import blender_runner  # noqa: E402
import claude_step  # noqa: E402
import meshy  # noqa: E402
import mesh_io  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("skeison3d")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.getenv("DATA_DIR", os.path.join(HERE, "data")))
DEMO = os.getenv("DEMO_MODE", "0") == "1"
ACCESS_CODE = os.getenv("ACCESS_CODE", "").strip()
JOBS_PER_DAY = int(os.getenv("JOBS_PER_IP_PER_DAY", "10"))
JOB_TTL_H = float(os.getenv("JOB_TTL_HOURS", "24"))
MAX_IMG_MB = 10
ALLOWED_IMG = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

os.makedirs(DATA_DIR, exist_ok=True)


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


JOBS: dict[str, Job] = {}
POOL = ThreadPoolExecutor(max_workers=int(os.getenv("JOB_WORKERS", "2")))
BLENDER_LOCK = threading.Semaphore(int(os.getenv("BLENDER_PARALLEL", "1")))
RATE: dict[str, deque] = defaultdict(deque)

app = FastAPI(title="Skeison 3D", docs_url=None, redoc_url=None)
origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type", "X-Access-Code"])


def _slug(s: str) -> str:
    s = s.lower().translate(str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40] or "modell"


def _client_ip(req: Request) -> str:
    fwd = req.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (req.client.host if req.client else "?")


def _check_rate(ip: str) -> None:
    q = RATE[ip]
    now = time.time()
    while q and now - q[0] > 86400:
        q.popleft()
    if len(q) >= JOBS_PER_DAY:
        raise HTTPException(429, f"Tageslimit erreicht ({JOBS_PER_DAY} Modelle pro Tag).")
    q.append(now)


def _run(job: Job) -> None:
    job.state = "running"
    try:
        prompt = job.description.strip()
        flat_base = job.flat_base

        # 1) Claude (nur mit Beschreibung)
        if prompt and not DEMO:
            job.stage, job.message = "analyse", "Beschreibung wird verstanden"
            r = claude_step.refine(prompt, job.images)
            if r and r.get("refused"):
                raise RuntimeError("Diese Beschreibung kann leider nicht verarbeitet werden.")
            if r:
                prompt = r["meshy_prompt"] or prompt
                job.name = _slug(r.get("name") or job.name)
                job.hint = r.get("hint") or ""
                if not job.size_user and r.get("size_mm"):
                    job.size_mm = max(10.0, min(300.0, float(r["size_mm"])))
        elif prompt:
            job.name = _slug(prompt[:30])

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
                job.result = blender_runner.prepare(glb, out, job.name, job.size_mm, flat_base)

        job.stage, job.state, job.progress, job.message = "done", "done", 100, "Fertig"
    except (meshy.MeshyError, blender_runner.BlenderError, RuntimeError) as e:
        log.warning("Job %s fehlgeschlagen: %s", job.id, e)
        job.state, job.message = "error", str(e).split("\n")[0]
    except Exception:  # noqa: BLE001
        log.exception("Job %s: unerwarteter Fehler", job.id)
        job.state, job.message = "error", "Unerwarteter Fehler auf dem Server."


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "demo": DEMO,
        "claude": claude_step.enabled(),
        "meshy": bool(os.getenv("MESHY_API_KEY")),
        "blender_mode": blender_runner.MODE,
        "needs_code": bool(ACCESS_CODE),
        "limit_per_day": JOBS_PER_DAY,
    }


@app.post("/api/jobs")
async def create_job(
    request: Request,
    description: str = Form(""),
    size_mm: float = Form(80.0),
    size_user: int = Form(0),
    flat_base: int = Form(1),
    images: list[UploadFile] = File(default=[]),
):
    if ACCESS_CODE and not secrets.compare_digest(request.headers.get("x-access-code", ""), ACCESS_CODE):
        raise HTTPException(401, "Zugangscode fehlt oder ist falsch.")
    images = [i for i in images if i.filename]
    if not description.strip() and not images:
        raise HTTPException(400, "Bitte eine Beschreibung eingeben oder ein Foto hochladen.")
    if len(images) > 4:
        raise HTTPException(400, "Maximal 4 Fotos.")
    if len(description) > 2000:
        raise HTTPException(400, "Die Beschreibung ist zu lang (max. 2000 Zeichen).")
    _check_rate(_client_ip(request))

    jid = secrets.token_urlsafe(12)
    jdir = os.path.join(DATA_DIR, jid)
    os.makedirs(jdir)
    paths = []
    for n, up in enumerate(images):
        ext = ALLOWED_IMG.get(up.content_type or "")
        if not ext:
            shutil.rmtree(jdir, ignore_errors=True)
            raise HTTPException(400, "Nur JPG, PNG oder WebP.")
        data = await up.read(MAX_IMG_MB * 1024 * 1024 + 1)
        if len(data) > MAX_IMG_MB * 1024 * 1024:
            shutil.rmtree(jdir, ignore_errors=True)
            raise HTTPException(400, f"Ein Foto ist groesser als {MAX_IMG_MB} MB.")
        p = os.path.join(jdir, f"bild{n}{ext}")
        with open(p, "wb") as f:
            f.write(data)
        paths.append(p)

    job = Job(id=jid, dir=jdir, description=description, images=paths,
              size_mm=max(10.0, min(300.0, size_mm)), size_user=bool(size_user), flat_base=bool(flat_base))
    JOBS[jid] = job
    POOL.submit(_run, job)
    return {"id": jid}


def _job(jid: str) -> Job:
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404, "Auftrag nicht gefunden (abgelaufen?).")
    return job


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    return _job(jid).public()


@app.get("/api/jobs/{jid}/file")
def job_file(jid: str, format: str = "stl", inline: int = 0):
    job = _job(jid)
    if job.state != "done":
        raise HTTPException(409, "Noch nicht fertig.")
    fmt = "3mf" if format == "3mf" else "stl"
    path = os.path.join(job.dir, "out", f"model.{fmt}")
    if inline:
        return FileResponse(path, media_type="model/stl")
    mime = "model/3mf" if fmt == "3mf" else "model/stl"
    return FileResponse(path, media_type=mime, filename=f"{job.name}.{fmt}")


def _cleanup_loop() -> None:
    while True:
        time.sleep(600)
        limit = time.time() - JOB_TTL_H * 3600
        for jid, job in list(JOBS.items()):
            if job.created < limit and job.state in ("done", "error"):
                shutil.rmtree(job.dir, ignore_errors=True)
                JOBS.pop(jid, None)


threading.Thread(target=_cleanup_loop, daemon=True).start()

# Optional die ganze Webseite (site/) mit ausliefern: Das Tool liegt dann unter /3d/ und findet ../assets wie auf GitHub Pages.
SITE_DIR = os.path.abspath(os.getenv("SITE_DIR", os.path.join(os.path.dirname(HERE), "site")))
if os.path.isdir(SITE_DIR) and os.getenv("SERVE_FRONTEND", "1") == "1":
    app.mount("/", StaticFiles(directory=SITE_DIR, html=True), name="site")
