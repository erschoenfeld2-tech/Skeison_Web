"""Startet Blender-Skripte: blender/printprep.py (druckfertig machen) und blender/cadmodel.py (Modell aus Claudes Skript).

BLENDER_MODE=cli (Standard, fuer Server): eigener Blender-Prozess ohne Oberflaeche pro Auftrag.
BLENDER_MODE=mcp: schickt printprep an ein laufendes Blender mit blender-mcp-Addon
                  (Port 9876, wie die installierten Blender-Skills). Praktisch zum Testen am PC.
                  cadmodel laeuft immer als eigener Prozess (Skript von Claude nie im offenen Blender).
"""
from __future__ import annotations

import json
import os
import socket
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "blender", "printprep.py")
CAD_SCRIPT = os.path.join(HERE, "blender", "cadmodel.py")
BLENDER_BIN = os.getenv("BLENDER_BIN", "blender")
MODE = os.getenv("BLENDER_MODE", "cli")
MCP_PORT = int(os.getenv("BLENDER_MCP_PORT", "9876"))
TIMEOUT = int(os.getenv("BLENDER_TIMEOUT", "900"))
CAD_TIMEOUT = int(os.getenv("BLENDER_CAD_TIMEOUT", "180"))
# Ruecksicht auf andere Dienste auf demselben PC (z. B. Minecraft-Server): begrenzte Threads, niedrige Prioritaet, RAM-Grenze
THREADS = int(os.getenv("BLENDER_THREADS", "0"))  # 0 = Blender entscheidet
LOW_PRIORITY = os.getenv("BLENDER_LOW_PRIORITY", "1") == "1"
MAX_RAM_MB = int(os.getenv("BLENDER_MAX_RAM_MB", "3072"))  # nur Windows; 0 = ohne Grenze
MAX_TRIS = int(os.getenv("PRINT_MAX_TRIANGLES", "150000"))  # mehr braucht ein FDM-Drucker nicht, STL bleibt klein


class BlenderError(RuntimeError):
    pass


def _args(glb: str, out_dir: str, name: str, size_mm: float, flat_base: bool) -> list[str]:
    return ["--in", glb, "--out-dir", out_dir, "--name", name, "--size", str(size_mm),
            "--flat-base", "1" if flat_base else "0", "--max-tris", str(MAX_TRIS)]


def _parse(output: str) -> dict:
    for line in output.splitlines()[::-1]:
        if line.startswith("SKEISON_RESULT "):
            return json.loads(line[len("SKEISON_RESULT "):])
    raise BlenderError("Blender hat kein Ergebnis geliefert:\n" + output[-1500:])


def _limit_memory(proc: subprocess.Popen) -> object | None:
    """Windows: Prozess in ein Job-Objekt mit Speichergrenze legen (Blender wird beendet, statt Minecraft den RAM zu nehmen)."""
    if os.name != "nt" or MAX_RAM_MB <= 0:
        return None
    import ctypes
    from ctypes import wintypes

    class IO(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in
                    ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                     "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class BASIC(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class EXT(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO), ("ProcessMemoryLimit", ctypes.c_size_t),
                    ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                    ("PeakJobMemoryUsed", ctypes.c_size_t)]

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateJobObjectW.restype = wintypes.HANDLE
    job = k32.CreateJobObjectW(None, None)
    if not job:
        return None
    info = EXT()
    info.BasicLimitInformation.LimitFlags = 0x100 | 0x2000  # PROCESS_MEMORY | KILL_ON_JOB_CLOSE
    info.ProcessMemoryLimit = MAX_RAM_MB * 1024 * 1024
    ok = k32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info))
    if ok:
        ok = k32.AssignProcessToJobObject(wintypes.HANDLE(job), wintypes.HANDLE(int(proc._handle)))  # noqa: SLF001
    return job if ok else None


def _run_cli(script: str, args: list[str], timeout: int) -> dict:
    cmd = [BLENDER_BIN, "-b", "--factory-startup", "-noaudio"]
    if THREADS > 0:
        cmd += ["-t", str(THREADS)]
    cmd += ["-P", script, "--", *args]
    kw: dict = {}
    if os.name == "nt":
        kw["creationflags"] = subprocess.CREATE_NO_WINDOW | (subprocess.BELOW_NORMAL_PRIORITY_CLASS if LOW_PRIORITY else 0)
    elif LOW_PRIORITY:
        kw["preexec_fn"] = lambda: os.nice(10)
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                encoding="utf-8", errors="replace", **kw)
    except FileNotFoundError as e:
        raise BlenderError(f"Blender nicht gefunden ({BLENDER_BIN}). BLENDER_BIN in .env setzen.") from e
    job = _limit_memory(proc)
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as e:
        proc.kill()
        proc.communicate()
        raise BlenderError("Blender hat zu lange gebraucht.") from e
    finally:
        if job:
            import ctypes
            ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(job))
    if proc.returncode != 0:
        raise BlenderError(f"Blender-Fehler ({proc.returncode}):\n{(err or out)[-1500:]}")
    return _parse(out)


def _run_mcp(args: list[str]) -> dict:
    code = (
        "import sys, runpy, io, contextlib\n"
        f"sys.argv = ['printprep', '--', *{args!r}]\n"
        "buf = io.StringIO()\n"
        "with contextlib.redirect_stdout(buf):\n"
        f"    runpy.run_path({SCRIPT!r}, run_name='__main__')\n"
        "print(buf.getvalue())\n"
    )
    with socket.create_connection(("127.0.0.1", MCP_PORT), timeout=TIMEOUT) as s:
        s.sendall(json.dumps({"type": "execute_code", "params": {"code": code}}).encode())
        data = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
            try:
                resp = json.loads(data)
                break
            except json.JSONDecodeError:
                continue
    if resp.get("status") == "error":
        raise BlenderError(f"Blender (MCP): {resp.get('message')}")
    out = (resp.get("result") or {}).get("result", "")
    return _parse(out)


def prepare(glb: str, out_dir: str, name: str, size_mm: float, flat_base: bool) -> dict:
    args = _args(glb, out_dir, name, size_mm, flat_base)
    return _run_mcp(args) if MODE == "mcp" else _run_cli(SCRIPT, args, TIMEOUT)


def build(script_file: str, out_glb: str, preview_png: str = "") -> dict:
    """Fuehrt Claudes Modellier-Skript in einem eigenen Blender aus. Ergebnis: {"ok": ..., "error"| Statistik}."""
    args = ["--script", script_file, "--out-glb", out_glb]
    if preview_png:
        args += ["--preview", preview_png]
    return _run_cli(CAD_SCRIPT, args, CAD_TIMEOUT)
