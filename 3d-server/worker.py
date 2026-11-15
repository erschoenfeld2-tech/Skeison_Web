"""3D-Druck-Worker fuer den Server-PC: holt Auftraege aus Supabase, rechnet sie und legt STL/3MF zurueck.

Kein offener Port, kein Tunnel: Der Worker baut nur Verbindungen nach aussen auf (wie tools/admin-panel.js).
  Webseite --p3d_create_job--> Supabase <--p3d_claim / p3d_update / Storage-- worker.py (Server-PC)
Datenbank: supabase/druck3d.sql. Start: start-3d-server.bat (oder: python worker.py).

Zugang: SUPABASE_URL und SUPABASE_SERVICE_KEY in .env, oder automatisch aus tools\\admin.config.json
(supabaseUrl, serviceKey), die das Admin-Panel schon nutzt. Der Key wird nie ausgegeben.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import shutil
import socket
import sys
import threading
import time

from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
# Die .env gilt vor Umgebungsvariablen. Sonst schaltet eine vergessene (auch leere) Variable ACCESS_CODE im Benutzerprofil,
# in MCSManager oder einem Startskript still den Zugangscode ab: load_dotenv ueberschreibt Vorhandenes standardmaessig nicht.
# Ausnahme WORKER_TAKEOVER: Wer es einmalig in der Shell setzt (Umzug), behaelt seinen Wert.
_ENV_FILE = os.path.join(HERE, ".env")
_PRE = {k: os.environ.get(k) for k in ("ACCESS_CODE", "WORKER_TAKEOVER")}   # Stand vor dem Laden (nur zum Vergleichen, wird nie ausgegeben)
load_dotenv(_ENV_FILE, override=True)
if _PRE["WORKER_TAKEOVER"] is not None:
    os.environ["WORKER_TAKEOVER"] = _PRE["WORKER_TAKEOVER"]

import requests  # noqa: E402

import blender_runner  # noqa: E402
import claude_step  # noqa: E402
from pipeline import DEMO, Job, generator, run, slug  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("skeison3d.worker")

VERSION = "w2"
SERVER_NAME = (os.getenv("SERVER_NAME") or socket.gethostname()).strip()[:40]  # z. B. HW_01, HW_02
DATA_DIR = os.path.abspath(os.getenv("DATA_DIR", os.path.join(HERE, "data")))
BUCKET = "p3d"
POLL_S = float(os.getenv("POLL_SECONDS", "4"))          # so oft wird nach neuen Auftraegen gefragt
HEARTBEAT_S = 60                                         # Lebenszeichen; die Seite gilt nach 3 min ohne als offline
PUSH_S = 2                                               # Fortschritt hoechstens alle 2 s melden
JOB_TTL_H = float(os.getenv("JOB_TTL_HOURS", "24"))
PER_IP = int(os.getenv("JOBS_PER_IP_PER_DAY", "3"))
PER_DAY = int(os.getenv("JOBS_TOTAL_PER_DAY", "10"))  # schont das Claude-Abo (KI-Bot nutzt es mit)
ACCESS_CODE = os.getenv("ACCESS_CODE", "").strip()
HOST_ID = hashlib.sha256(socket.gethostname().encode("utf-8")).hexdigest()[:12]   # Kurzkennung dieses Rechners (Hash, kein Klartextname)
LOCK_PORT = int(os.getenv("S3D_PORT", "8095"))           # nur als Sperre gegen doppelten Start, nimmt nichts an
EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def _credentials() -> tuple[str, str]:
    url, key = os.getenv("SUPABASE_URL", "").strip(), os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    cfg_path = os.getenv("SUPABASE_ADMIN_CONFIG", r"C:\MinecraftHosting\tools\admin.config.json")
    if (not url or not key) and os.path.isfile(cfg_path):
        with open(cfg_path, encoding="utf-8-sig") as f:
            cfg = json.load(f)
        url, key = url or cfg.get("supabaseUrl", ""), key or cfg.get("serviceKey", "")
    if not url or not key:
        sys.exit("SUPABASE_URL/SUPABASE_SERVICE_KEY fehlen (.env oder tools\\admin.config.json).")
    return url.rstrip("/"), key


SB_URL, SB_KEY = _credentials()
S = requests.Session()
S.headers.update({"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"})


class SupabaseError(RuntimeError):
    def __init__(self, msg: str, status: int = 0):
        super().__init__(msg)
        self.status = status


def _detail(r: requests.Response) -> str:
    """PostgREST-Fehler als 'Code Meldung' (z. B. '23514 ... violates check constraint "p3d_jobs_name_check"').
    Nicht den Rohtext kuerzen: 'details' enthaelt die ganze Zeile und schiebt die Meldung sonst hinter die 200 Zeichen."""
    try:
        j = r.json()
        return f"{j.get('code', '')} {j.get('message', '')}".strip()[:300]
    except ValueError:
        return r.text[:200]


def rpc(fn: str, args: dict | None = None):
    r = S.post(f"{SB_URL}/rest/v1/rpc/{fn}", json=args or {}, timeout=30)
    if r.status_code >= 400:
        raise SupabaseError(f"{fn}: {r.status_code} {_detail(r)}", r.status_code)
    return r.json() if r.content else None


# ---------- Meldungen an p3d_update: zentral anpassen und absichern ----------
# Grenzen wie die Check-Bedingungen in supabase/druck3d.sql (message <= 300, hint <= 500, name ^[a-z0-9-]{1,40}$,
# progress 0-100, feste stage/state). Der Worker passt jede Meldung beim Senden an, statt sich auf alle Aufrufer zu verlassen.
STAGES = {"queued", "analyse", "generate", "blender", "upload", "done"}
STATES = {"queued", "running", "done", "error"}


def _one_line(s: object, limit: int) -> str:
    s = " ".join(str(s or "").split())
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "\u2026"


def clean_update(p: dict) -> dict:
    out = dict(p)
    if "message" in out:
        out["message"] = _one_line(out["message"], 300)
    if "hint" in out:
        out["hint"] = _one_line(out["hint"], 500)
    if "name" in out:
        out["name"] = slug(str(out["name"] or ""))
    if "progress" in out:
        try:
            out["progress"] = max(0, min(100, int(out["progress"])))
        except (TypeError, ValueError):
            del out["progress"]
    for key, allowed in (("stage", STAGES), ("state", STATES)):
        if key in out and out[key] not in allowed:
            del out[key]
    return out


MINIMAL = ("state", "stage", "progress", "message", "files")  # ohne Name, Hinweis und Ergebnis (nur Anzeige)


def update_job(jid: str, p: dict, *, essential: bool = False) -> bool:
    """Meldet Fortschritt oder Ergebnis. Gibt zurueck, ob es angekommen ist; wirft nie.
    Fortschritt ist nur Anzeige: Scheitert er, wird es geloggt und der Auftrag laeuft weiter.
    essential=True (Ergebnis done/error): bis zu 3 Versuche bei Netzwerk-/Serverfehlern; bei einem 4xx-Fehler
    (Daten abgelehnt) einmal nur mit den Pflichtfeldern, damit der Auftrag nicht an einem Zusatzfeld haengt."""
    payload = clean_update(p)
    attempts = 3 if essential else 1
    for n in range(attempts):
        try:
            rpc("p3d_update", {"p_id": jid, "p": payload})
            return True
        except SupabaseError as e:
            log.warning("Auftrag %s: p3d_update abgelehnt: %s", jid, e)
            if 400 <= e.status < 500:           # Daten abgelehnt: dasselbe nochmal senden hilft nicht
                slim = {k: v for k, v in payload.items() if k in MINIMAL}
                if not essential or slim == payload:
                    return False
                payload = slim                  # Ergebnis nur mit Pflichtfeldern erneut versuchen
                continue
        except requests.RequestException as e:
            log.warning("Auftrag %s: p3d_update nicht erreichbar: %s", jid, e)
        if n < attempts - 1:
            time.sleep(2 ** n)
    return False


def upload(path: str, dest: str, mime: str) -> str:
    """Legt die Datei in den Bucket und gibt eine signierte Download-URL zurueck (gueltig JOB_TTL_HOURS)."""
    with open(path, "rb") as f:
        r = S.post(f"{SB_URL}/storage/v1/object/{BUCKET}/{dest}", data=f,
                   headers={"Content-Type": mime, "x-upsert": "true"}, timeout=300)
    if r.status_code >= 400:
        raise SupabaseError(f"Upload {dest}: {r.status_code} {r.text[:200]}")
    r = S.post(f"{SB_URL}/storage/v1/object/sign/{BUCKET}/{dest}", json={"expiresIn": int(JOB_TTL_H * 3600)}, timeout=30)
    if r.status_code >= 400:
        raise SupabaseError(f"Signieren {dest}: {r.status_code} {r.text[:200]}")
    signed = r.json().get("signedURL") or r.json().get("signedUrl")
    return f"{SB_URL}/storage/v1{signed}" if signed.startswith("/") else signed


def remove_files(job_ids: list[str]) -> None:
    for jid in job_ids:
        try:
            r = S.post(f"{SB_URL}/storage/v1/object/list/{BUCKET}", json={"prefix": jid, "limit": 20}, timeout=30)
            names = [f"{jid}/{o['name']}" for o in (r.json() if r.ok else [])]
            if names:
                S.delete(f"{SB_URL}/storage/v1/object/{BUCKET}", json={"prefixes": names}, timeout=30)
        except requests.RequestException as e:
            log.warning("Dateien von %s nicht geloescht: %s", jid, e)
        shutil.rmtree(os.path.join(DATA_DIR, jid), ignore_errors=True)


def heartbeat_info() -> dict:
    return {"demo": DEMO, "claude": claude_step.backend(), "blender": blender_runner.MODE, "version": VERSION,
            "server": SERVER_NAME, "host": HOST_ID, "generator": "demo" if DEMO else generator()}


def other_worker(st: dict) -> str | None:
    """Wer sonst noch aktiv ist (aus p3d_status), sonst None. Anderer Server-PC = anderer SERVER_NAME ODER anderer Rechner
    (host): Ein stehengebliebenes 'SERVER_NAME=HW_01' auf dem neuen PC faellt so trotzdem auf.
    Ohne 'host' im Status (supabase/druck3d_host.sql fehlt oder aelterer Worker) zaehlt nur der Name."""
    if not st.get("online"):
        return None
    name = st.get("server") or ""
    if name and name != SERVER_NAME:
        return name
    if st.get("host") and st["host"] != HOST_ID:
        return f"{name or 'ein anderer Rechner'} (gleicher SERVER_NAME, aber ein anderer Rechner)"
    return None


_warned: set[str] = set()


def check_status(when: str) -> None:
    """Gleicht p3d_status mit dem eigenen Stand ab und warnt einmal je Problem (nie mit dem Wert des Codes):
    - needs_code passt nicht zum lokalen ACCESS_CODE (z. B. ueberschreibt ein anderer Worker das Lebenszeichen),
    - ein anderer Server-PC bzw. Rechner meldet sich."""
    try:
        st = rpc("p3d_status") or {}
    except (requests.RequestException, SupabaseError) as e:
        log.warning("Status nicht lesbar: %s", e)
        return
    problems: dict[str, str] = {}
    if bool(st.get("needs_code")) != bool(ACCESS_CODE):
        problems["code"] = (f"Zugangscode: lokal {'gesetzt' if ACCESS_CODE else 'NICHT gesetzt'}, Supabase meldet "
                            f"needs_code={st.get('needs_code')} ({when}). Ueberschreibt ein anderer Worker das Lebenszeichen?")
    who = other_worker(st)
    if who:
        problems["server"] = f"Supabase meldet {who}, dieser Worker ist {SERVER_NAME}: Laeuft ein zweiter Worker? ({when})"
    for key, msg in problems.items():
        if key not in _warned:
            _warned.add(key)
            log.warning(msg)
    for key in _warned - set(problems):
        _warned.discard(key)
        log.info("Abweichung '%s' ist behoben.", key)


def heartbeat_loop() -> None:
    info = heartbeat_info()
    last_cleanup = 0.0
    first = True
    while True:
        try:
            if not first:
                check_status("seit dem letzten Lebenszeichen")   # hat zwischendurch ein anderer Worker geschrieben?
            rpc("p3d_heartbeat", {"p_info": info, "p_per_ip": PER_IP, "p_per_day": PER_DAY, "p_code": ACCESS_CODE})
            if first:
                check_status("nach dem Start")
                first = False
            if time.time() - last_cleanup > 600:
                old = rpc("p3d_cleanup", {"p_hours": JOB_TTL_H}) or []
                if old:
                    remove_files(old)
                    log.info("%d alte Auftraege geloescht.", len(old))
                last_cleanup = time.time()
        except (requests.RequestException, SupabaseError) as e:
            log.warning("Lebenszeichen fehlgeschlagen: %s", e)
        time.sleep(HEARTBEAT_S)


def process(row: dict) -> None:
    jid = row["id"]
    jdir = os.path.join(DATA_DIR, jid)
    os.makedirs(jdir, exist_ok=True)
    paths = []
    for n, img in enumerate(row.get("images") or []):
        p = os.path.join(jdir, f"bild{n}{EXT.get(img.get('mime'), '.jpg')}")
        with open(p, "wb") as f:
            f.write(base64.b64decode(img["data"]))
        paths.append(p)
    job = Job(id=jid, dir=jdir, description=row.get("description") or "", images=paths,
              size_mm=float(row.get("size_mm") or 80), size_user=bool(row.get("size_user")),
              flat_base=bool(row.get("flat_base", True)), settings=row.get("settings") or {})
    log.info("Auftrag %s: %s, %d Foto(s), Duese %s, Schicht %s, %s", jid, "Text" if job.description else "ohne Text",
             len(paths), job.settings["nozzle"], job.settings["layer"], job.settings["material"])

    t = threading.Thread(target=run, args=(job,), daemon=True)
    t.start()
    last = None
    while t.is_alive():
        t.join(PUSH_S)
        snap = {"stage": job.stage, "progress": job.progress, "message": job.message, "name": job.name}
        if job.state == "running" and snap != last:
            update_job(jid, snap)       # nur Anzeige: Fehler werden geloggt, die Meldung nicht dauernd wiederholt
            last = snap

    if job.state != "done":
        update_job(jid, {"state": "error", "message": job.message}, essential=True)
        return
    update_job(jid, {"stage": "upload", "progress": 100, "message": "Dateien werden bereitgestellt"})  # nur Anzeige
    try:
        out = os.path.join(jdir, "out")
        files = {
            "stl": upload(os.path.join(out, "model.stl"), f"{jid}/{job.name}.stl", "model/stl"),
            "3mf": upload(os.path.join(out, "model.3mf"), f"{jid}/{job.name}.3mf", "model/3mf"),
        }
    except (requests.RequestException, SupabaseError, OSError) as e:
        log.warning("Auftrag %s: Upload fehlgeschlagen: %s", jid, e)
        update_job(jid, {"state": "error", "message": "Die Dateien konnten nicht bereitgestellt werden."}, essential=True)
        return
    ok = update_job(jid, {
        "state": "done", "stage": "done", "progress": 100, "message": "Fertig", "name": job.name,
        "hint": job.hint, "size_mm": job.size_mm, "result": job.result, "files": files}, essential=True)
    log.info("Auftrag %s fertig (%s)%s.", jid, job.name, "" if ok else ", Ergebnis aber NICHT gemeldet")


def main() -> None:
    # Nur ein Worker gleichzeitig (sonst rechnen zwei Blender parallel neben Minecraft)
    lock = socket.socket()
    try:
        lock.bind(("127.0.0.1", LOCK_PORT))
    except OSError:
        sys.exit(f"Der 3D-Worker laeuft schon (Port {LOCK_PORT} belegt).")
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.isfile(_ENV_FILE):
        log.warning("Keine .env neben worker.py gefunden (%s): es gelten nur Umgebungsvariablen und Standardwerte.", _ENV_FILE)
    if _PRE["ACCESS_CODE"] is not None and _PRE["ACCESS_CODE"].strip() != ACCESS_CODE:
        log.warning("Die Umgebungsvariable ACCESS_CODE ist gesetzt und weicht von der .env ab; es gilt die .env.")
    log.info("Zugangscode: %s", "gesetzt" if ACCESS_CODE else "NICHT gesetzt (jeder darf Auftraege anlegen)")
    # Umzug HW_01 -> HW_02: nie zwei Server-PCs gleichzeitig (beide wuerden Auftraege abholen)
    try:
        who = other_worker(rpc("p3d_status") or {})
        if who and os.getenv("WORKER_TAKEOVER") != "1":
            sys.exit(f"Auf {who} laeuft noch ein 3D-Worker (Lebenszeichen < 3 min). Erst dort beenden, "
                     "3 Minuten warten oder WORKER_TAKEOVER=1 setzen.")
    except (requests.RequestException, SupabaseError) as e:
        log.warning("Status nicht lesbar: %s", e)
    log.info("3D-Worker %s auf %s gestartet: Demo=%s, Erzeugung=%s, Claude=%s, Blender=%s, Limits %d/IP, %d gesamt pro Tag.",
             VERSION, SERVER_NAME, DEMO, generator(), claude_step.backend(), blender_runner.MODE, PER_IP, PER_DAY)
    try:
        n = rpc("p3d_reset_running")
        if n:
            log.info("%d abgebrochene Auftraege als Fehler markiert.", n)
    except (requests.RequestException, SupabaseError) as e:
        log.warning("Aufraeumen beim Start fehlgeschlagen: %s", e)
    threading.Thread(target=heartbeat_loop, daemon=True).start()

    while True:
        try:
            row = rpc("p3d_claim")
        except (requests.RequestException, SupabaseError) as e:
            log.warning("Supabase nicht erreichbar: %s", e)
            time.sleep(30)
            continue
        if not row:
            time.sleep(POLL_S)
            continue
        try:
            process(row)
        except Exception:  # noqa: BLE001
            log.exception("Auftrag %s: unerwarteter Fehler", row.get("id"))
            update_job(row["id"], {"state": "error", "message": "Unerwarteter Fehler auf dem Server."}, essential=True)


if __name__ == "__main__":
    main()
