"""Test des Workers ohne Supabase, Blender und Claude: python test_worker.py   (im Ordner 3d-server, braucht nur requests und python-dotenv)

Prueft gegen eine lokale Attrappe von Supabase (127.0.0.1) mit den Check-Bedingungen aus supabase/druck3d.sql:
  1. p3d_update: Meldungen werden angepasst (message <= 300, name, progress, stage); Fortschritt wirft nie; Ergebnis wird wiederholt
  2. SERVER_NAME-Sperre ueber Name UND Rechner (host), Warnungen zu needs_code/Server im Betrieb
  3. .env gilt vor Umgebungsvariablen (ACCESS_CODE), WORKER_TAKEOVER aus der Shell bleibt
  4. cadmodel.py: BLENDER_PREVIEW_ENGINE und Rueckfall auf Cycles (mit Attrappen fuer bpy, ohne Blender)
Es wird nie eine echte .env gelesen und nie ein echter Schluessel benutzt (Dummy-Werte)."""
import importlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest.mock as um
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = {"calls": [], "fail_5xx": 0, "status": {}, "heartbeats": []}
NAME = re.compile(r"^[a-z0-9-]{1,40}$")
STAGES = {"queued", "analyse", "generate", "blender", "upload", "done"}
FAILED = []


def check(label, cond):
    print(("OK      " if cond else "FEHLER  ") + label)
    if not cond:
        FAILED.append(label)


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        fn = self.path.rsplit("/", 1)[-1]
        if fn == "p3d_status":
            return self._send(200, STATE["status"])
        if fn == "p3d_heartbeat":
            STATE["heartbeats"].append(body)
            return self._send(200, None)
        if fn != "p3d_update":
            return self._send(200, None)
        p = body["p"]
        STATE["calls"].append(p)
        if STATE["fail_5xx"] > 0:
            STATE["fail_5xx"] -= 1
            return self._send(503, {"message": "Service Unavailable"})
        bad = None   # kuerzt message NICHT (ungünstigster Fall: die Live-Funktion hat kein left(...,300))
        if "name" in p and not NAME.match(p["name"]):
            bad = "p3d_jobs_name_check"
        elif "message" in p and len(p["message"]) > 300:
            bad = "p3d_jobs_message_check"
        elif "progress" in p and not 0 <= int(p["progress"]) <= 100:
            bad = "p3d_jobs_progress_check"
        elif "stage" in p and p["stage"] not in STAGES:
            bad = "p3d_jobs_stage_check"
        if bad:   # PostgREST-Reihenfolge: code, details (ganze Zeile, lang), hint, message
            return self._send(400, {"code": "23514", "details": "Failing row contains (" + "x" * 600 + ")", "hint": None,
                                    "message": f'new row for relation "p3d_jobs" violates check constraint "{bad}"'})
        self._send(200, None)

    def _send(self, code, obj):
        data = json.dumps(obj).encode() if obj is not None else b""
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


srv = HTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
tmp = tempfile.mkdtemp(prefix="w3d-test-")
os.environ.update(SUPABASE_URL=f"http://127.0.0.1:{srv.server_port}", SUPABASE_SERVICE_KEY="dummy-test-key", DEMO_MODE="1",
                  DATA_DIR=os.path.join(tmp, "data"), SERVER_NAME="HW_TEST")
import dotenv  # noqa: E402
dotenv.load_dotenv = lambda *a, **k: False       # eine echte .env (mit echten Schluesseln) darf hier nie geladen werden
sys.path.insert(0, HERE)
w = importlib.import_module("worker")
JID = "00000000-0000-0000-0000-000000000001"
import time as _time  # noqa: E402
_time.sleep = lambda s: None                      # Wiederholungen ohne Wartezeit

print("== 1. p3d_update")
STATE["calls"].clear()
cases = [
    ("Rohname von Claude ('Handyhalter mit Kabelfuehrung')", {"stage": "generate", "progress": 25, "message": "x", "name": "Handyhalter mit Kabelfuehrung"}),
    ("Name mit Umlauten ('Vase Größe M')", {"stage": "generate", "progress": 25, "message": "x", "name": "Vase Größe M"}),
    ("Name laenger als 40 Zeichen", {"stage": "generate", "progress": 25, "message": "x", "name": "a" * 55}),
    ("Fortschritt 102 %", {"stage": "generate", "progress": 102, "message": "x", "name": "modell"}),
    ("message 500 Zeichen mit Zeilenumbruechen", {"state": "error", "message": "Zeile eins\n" + "y" * 490}),
    ("unbekannte stage", {"stage": "render", "progress": 10, "message": "x"}),
]
for label, p in cases:
    check(f"{label}: wird gemeldet", w.update_job(JID, p) is True)
w.update_job(JID, {"state": "error", "message": "Zeile eins\n" + "y" * 490})
m = STATE["calls"][-1]["message"]
check("message auf <= 300 Zeichen gekuerzt, einzeilig", len(m) <= 300 and "\n" not in m and m.endswith("…"))
w.update_job(JID, {"stage": "generate", "progress": 25, "message": "x", "name": "Vase Größe M"})
check("Name wird zu 'vase-groesse-m'", STATE["calls"][-1]["name"] == "vase-groesse-m")
w.update_job(JID, {"stage": "generate", "progress": 102, "message": "x"})
check("Fortschritt auf 100 begrenzt", STATE["calls"][-1]["progress"] == 100)
STATE["calls"].clear()
STATE["fail_5xx"] = 2
ok = w.update_job(JID, {"state": "done", "stage": "done", "progress": 100, "message": "Fertig", "name": "ok", "files": {"stl": "u"}}, essential=True)
check("done: nach 2 x 503 beim 3. Versuch gemeldet", ok is True and len(STATE["calls"]) == 3)
raw = w.clean_update
w.clean_update = lambda p: dict(p)               # Anpassung abschalten: nur die Rueckfall-Logik pruefen
STATE["calls"].clear()
ok = w.update_job(JID, {"state": "done", "stage": "done", "progress": 100, "message": "Fertig", "name": "Bad Name", "hint": "h", "files": {"stl": "u"}}, essential=True)
check("done: Name abgelehnt -> 2. Versuch nur mit Pflichtfeldern, Ergebnis kommt an",
      ok is True and len(STATE["calls"]) == 2 and "name" not in STATE["calls"][-1] and STATE["calls"][-1].get("files") == {"stl": "u"})
STATE["calls"].clear()
ok = w.update_job(JID, {"stage": "generate", "progress": 5, "message": "x", "name": "Bad Name"})
check("Fortschritt abgelehnt: kein Wurf, nur 1 Versuch", ok is False and len(STATE["calls"]) == 1)
w.clean_update = raw
try:
    w.rpc("p3d_update", {"p_id": JID, "p": {"name": "Bad Name"}})
except w.SupabaseError as e:
    check("Fehlertext nennt Code und Constraint", "23514" in str(e) and "p3d_jobs_name_check" in str(e) and e.status == 400)

print("== 2. Server-Sperre und Statusabgleich")
w.HOST_ID, w.SERVER_NAME = "aaaaaaaaaaaa", "HW_02"
check("offline: kein anderer Worker", w.other_worker({"online": False, "server": "HW_01"}) is None)
check("anderer SERVER_NAME", w.other_worker({"online": True, "server": "HW_01"}) == "HW_01")
check("gleicher Name, gleicher Rechner: ok (Neustart)", w.other_worker({"online": True, "server": "HW_02", "host": "aaaaaaaaaaaa"}) is None)
check("gleicher Name, anderer Rechner: erkannt", "anderer Rechner" in (w.other_worker({"online": True, "server": "HW_02", "host": "bbbbbbbbbbbb"}) or ""))
check("gleicher Name, kein host im Status (SQL fehlt): wie bisher nur Name", w.other_worker({"online": True, "server": "HW_02"}) is None)
info = w.heartbeat_info()
check("Lebenszeichen enthaelt host (12 Zeichen Hash, kein Rechnername)", info["host"] == "aaaaaaaaaaaa" and w.socket.gethostname() not in json.dumps(info))
check("HOST_ID wird aus dem Rechnernamen berechnet (12 Hexzeichen)", re.fullmatch(r"[0-9a-f]{12}", importlib.reload(w).HOST_ID) is not None)
w.SERVER_NAME = "HW_TEST"
records = []


class Grab(logging.Handler):
    def emit(self, r):
        records.append((r.levelname, r.getMessage()))


w.log.addHandler(Grab())
w.log.setLevel(logging.INFO)
w.ACCESS_CODE = "dummy-code"
STATE["status"] = {"online": True, "needs_code": False, "server": "HW_TEST", "host": w.HOST_ID}
w.check_status("test")
w.check_status("test")
warn = [m for lv, m in records if lv == "WARNING" and "Zugangscode" in m]
check("needs_code passt nicht: genau 1 Warnung (nicht bei jedem Aufruf)", len(warn) == 1 and "dummy-code" not in warn[0])
STATE["status"]["needs_code"] = True
w.check_status("test")
check("Abweichung behoben wird gemeldet", any(lv == "INFO" and "behoben" in m for lv, m in records))
STATE["status"] = {"online": True, "needs_code": True, "server": "HW_01"}
w.check_status("test")
check("anderer Server im Betrieb: Warnung", any("zweiter Worker" in m for lv, m in records if lv == "WARNING"))

print("== 3. .env gilt vor Umgebungsvariablen")
copy = os.path.join(tmp, "copy")
shutil.copytree(HERE, copy, ignore=shutil.ignore_patterns(".env", ".venv", "data", "__pycache__"))
code = "dummy-code-12345"
with open(os.path.join(copy, ".env"), "w", encoding="utf-8") as f:
    f.write(f"SUPABASE_URL=http://127.0.0.1:9\nSUPABASE_SERVICE_KEY=dummy-test-key\nACCESS_CODE={code}\nWORKER_TAKEOVER=0\nDEMO_MODE=1\n")
env = {k: v for k, v in os.environ.items() if k not in ("ACCESS_CODE", "WORKER_TAKEOVER")}
env.update(ACCESS_CODE="", WORKER_TAKEOVER="1")
r = subprocess.run([sys.executable, "-c", "import os, worker; print(len(worker.ACCESS_CODE), os.environ['WORKER_TAKEOVER'])"],
                   cwd=copy, env=env, capture_output=True, text=True, timeout=60)
check(f"leere Umgebungsvariable ACCESS_CODE ueberstimmt die .env NICHT mehr (Laenge {len(code)}), WORKER_TAKEOVER=1 aus der Shell bleibt",
      r.stdout.split() == [str(len(code)), "1"])
if r.returncode:
    print(r.stderr[-600:])

print("== 4. cadmodel.py: Vorschau-Engine")
for mod in ("bpy", "bmesh", "mathutils", "mathutils.bvhtree"):
    sys.modules[mod] = um.MagicMock()
sys.path.insert(0, os.path.join(HERE, "blender"))
os.environ["BLENDER_PREVIEW_ENGINE"], os.environ["BLENDER_PREVIEW_SAMPLES"] = "Cycles", "abc"
cm = importlib.import_module("cadmodel")
check("BLENDER_PREVIEW_ENGINE=Cycles (Gross/klein egal), ungueltige Samples -> 12", cm.PREVIEW_ENGINE == "Cycles" and cm.PREVIEW_SAMPLES == 12)
check("engines: cycles / workbench / auto / unbekannt / leer",
      cm.preview_engines("cycles") == ["CYCLES"] and cm.preview_engines(" Workbench ") == ["BLENDER_WORKBENCH"]
      and cm.preview_engines("auto") == cm.preview_engines("quatsch") == cm.preview_engines("") == ["BLENDER_WORKBENCH", "CYCLES"])
log_, state = [], {"i": 0}


def make_render(fail_on):
    def render():
        eng = engines[state["i"]]
        log_.append(eng)
        if eng in fail_on:
            raise RuntimeError("kein Bild")
    return render


engines = cm.preview_engines("auto")
setups = []
used = cm.render_with_fallback(engines, setups.append, make_render({"BLENDER_WORKBENCH"}), state)
used2 = cm.render_with_fallback(engines, setups.append, make_render({"BLENDER_WORKBENCH"}), state)
check("auto: Workbench scheitert -> Cycles, bei der naechsten Ansicht nicht erneut Workbench",
      used == used2 == "CYCLES" and setups == ["CYCLES"] and log_ == ["BLENDER_WORKBENCH", "CYCLES", "CYCLES"])
engines, state = cm.preview_engines("workbench"), {"i": 0}
try:
    cm.render_with_fallback(engines, setups.append, make_render({"BLENDER_WORKBENCH"}), state)
    check("workbench: Fehler wird nicht verschluckt", False)
except RuntimeError:
    check("workbench: Fehler wird nicht verschluckt (kein heimlicher Rueckfall)", True)

shutil.rmtree(tmp, ignore_errors=True)
print("\nERGEBNIS:", "alle Pruefungen bestanden" if not FAILED else f"{len(FAILED)} FEHLER: " + "; ".join(FAILED))
sys.exit(1 if FAILED else 0)
