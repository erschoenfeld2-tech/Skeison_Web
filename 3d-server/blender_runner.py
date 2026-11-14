"""Startet blender/printprep.py.

BLENDER_MODE=cli (Standard, fuer Server): eigener Blender-Prozess ohne Oberflaeche pro Auftrag.
BLENDER_MODE=mcp: schickt den Auftrag an ein laufendes Blender mit blender-mcp-Addon
                  (Port 9876, wie die installierten Blender-Skills). Praktisch zum Testen am PC.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "blender", "printprep.py")
BLENDER_BIN = os.getenv("BLENDER_BIN", "blender")
MODE = os.getenv("BLENDER_MODE", "cli")
MCP_PORT = int(os.getenv("BLENDER_MCP_PORT", "9876"))
TIMEOUT = int(os.getenv("BLENDER_TIMEOUT", "900"))


class BlenderError(RuntimeError):
    pass


def _args(glb: str, out_dir: str, name: str, size_mm: float, flat_base: bool) -> list[str]:
    return ["--in", glb, "--out-dir", out_dir, "--name", name,
            "--size", str(size_mm), "--flat-base", "1" if flat_base else "0"]


def _parse(output: str) -> dict:
    for line in output.splitlines()[::-1]:
        if line.startswith("SKEISON_RESULT "):
            return json.loads(line[len("SKEISON_RESULT "):])
    raise BlenderError("Blender hat kein Ergebnis geliefert:\n" + output[-1500:])


def _run_cli(args: list[str]) -> dict:
    cmd = [BLENDER_BIN, "-b", "--factory-startup", "-noaudio", "-P", SCRIPT, "--", *args]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT)
    except FileNotFoundError as e:
        raise BlenderError(f"Blender nicht gefunden ({BLENDER_BIN}). BLENDER_BIN in .env setzen.") from e
    except subprocess.TimeoutExpired as e:
        raise BlenderError("Blender hat zu lange gebraucht.") from e
    if p.returncode != 0:
        raise BlenderError(f"Blender-Fehler ({p.returncode}):\n{(p.stderr or p.stdout)[-1500:]}")
    return _parse(p.stdout)


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
    return _run_mcp(args) if MODE == "mcp" else _run_cli(args)
