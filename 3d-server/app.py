"""3D-Druck - Server fuer site/3d/.

Beschreibung und/oder Fotos -> (Claude) -> Meshy -> Blender -> STL / 3MF (Ablauf in pipeline.py).
Direktbetrieb ueber HTTP, vor allem zum lokalen Testen:
  uvicorn app:app --reload --port 8000   -> http://localhost:8000/3d/
Auf dem Server-PC laeuft stattdessen worker.py: Er holt die Auftraege aus Supabase, ganz ohne offenen Port.
"""
from __future__ import annotations

import logging
import os
import secrets
import shutil
import threading
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, Response  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

import blender_runner  # noqa: E402
import claude_step  # noqa: E402
from pipeline import DEMO, Job, generator, run  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("skeison3d")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.getenv("DATA_DIR", os.path.join(HERE, "data")))
ACCESS_CODE = os.getenv("ACCESS_CODE", "").strip()
JOBS_PER_DAY = int(os.getenv("JOBS_PER_IP_PER_DAY", "3"))
JOBS_TOTAL_PER_DAY = int(os.getenv("JOBS_TOTAL_PER_DAY", "10"))  # alle Besucher zusammen (Claude-Abo, Meshy-Guthaben)
JOB_TTL_H = float(os.getenv("JOB_TTL_HOURS", "24"))
MAX_IMG_MB = 10
ALLOWED_IMG = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

os.makedirs(DATA_DIR, exist_ok=True)


JOBS: dict[str, Job] = {}
POOL = ThreadPoolExecutor(max_workers=int(os.getenv("JOB_WORKERS", "2")))
RATE: dict[str, deque] = defaultdict(deque)

app = FastAPI(title="Skeison 3D", docs_url=None, redoc_url=None)
origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type", "X-Access-Code"])


# Echte Besucher-IP fuer das Tageslimit. Der Server lauscht nur auf 127.0.0.1, davor sitzt ein Tunnel:
# Cloudflare Tunnel -> CLIENT_IP_HEADER=cf-connecting-ip, Tailscale Funnel/Proxy -> x-forwarded-for.
CLIENT_IP_HEADER = os.getenv("CLIENT_IP_HEADER", "x-forwarded-for").strip().lower()


def _client_ip(req: Request) -> str:
    val = req.headers.get(CLIENT_IP_HEADER) if CLIENT_IP_HEADER else None
    return val.split(",")[0].strip() if val else (req.client.host if req.client else "?")


def _check_rate(ip: str) -> None:
    now = time.time()
    for q in (RATE[ip], RATE["*"]):
        while q and now - q[0] > 86400:
            q.popleft()
    if len(RATE["*"]) >= JOBS_TOTAL_PER_DAY:
        raise HTTPException(429, "Für heute sind alle Modelle vergeben. Bitte morgen nochmal versuchen.")
    if len(RATE[ip]) >= JOBS_PER_DAY:
        raise HTTPException(429, f"Tageslimit erreicht ({JOBS_PER_DAY} Modelle pro Tag).")
    RATE[ip].append(now)
    RATE["*"].append(now)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "demo": DEMO,
        "generator": "demo" if DEMO else generator(),
        "claude": claude_step.backend(),
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
    POOL.submit(run, job)
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
    @app.get("/3d/config.js")
    def local_config():
        # Ueberschreibt site/3d/config.js: Die Seite spricht dann direkt mit diesem Server statt mit Supabase
        return Response('window.SKEISON_3D = { api: "" };\n', media_type="text/javascript",
                        headers={"Cache-Control": "no-store"})

    app.mount("/", StaticFiles(directory=SITE_DIR, html=True), name="site")
