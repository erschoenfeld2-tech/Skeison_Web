"""Meshy-API: Text -> 3D, Bild -> 3D, mehrere Bilder -> 3D.

Fuer den 3D-Druck wird OHNE Textur erzeugt (spart Credits, Farbe ist beim Druck egal).
Endpunkte wie im installierten Skill image-to-3d / multi-image-to-3d.
"""
from __future__ import annotations

import base64
import mimetypes
import os
import time
from typing import Callable

import requests

API = "https://api.meshy.ai/openapi"
AI_MODEL = os.getenv("MESHY_AI_MODEL", "meshy-6")
POLYCOUNT = int(os.getenv("MESHY_POLYCOUNT", "100000"))


class MeshyError(RuntimeError):
    pass


def _headers() -> dict:
    key = os.getenv("MESHY_API_KEY")
    if not key:
        raise MeshyError("MESHY_API_KEY fehlt auf dem Server.")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _data_uri(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    with open(path, "rb") as f:
        return f"data:{mime};base64,{base64.b64encode(f.read()).decode()}"


def _post(url: str, payload: dict) -> str:
    r = requests.post(url, json=payload, headers=_headers(), timeout=60)
    if r.status_code == 402:
        raise MeshyError("Meshy-Guthaben ist aufgebraucht.")
    if r.status_code == 429:
        raise MeshyError("Meshy ist gerade ausgelastet. Bitte gleich nochmal versuchen.")
    if r.status_code >= 400:
        raise MeshyError(f"Meshy-Fehler {r.status_code}: {r.text[:300]}")
    return r.json()["result"]


def _poll(url: str, on_progress: Callable[[int], None], timeout_s: int = 1200) -> dict:
    start = time.time()
    while time.time() - start < timeout_s:
        r = requests.get(url, headers=_headers(), timeout=30)
        r.raise_for_status()
        task = r.json()
        status = task.get("status")
        on_progress(int(task.get("progress") or 0))
        if status == "SUCCEEDED":
            return task
        if status in ("FAILED", "CANCELED", "EXPIRED"):
            msg = (task.get("task_error") or {}).get("message") or status
            raise MeshyError(f"Meshy konnte das Modell nicht erzeugen: {msg}")
        time.sleep(5)
    raise MeshyError("Zeitueberschreitung bei Meshy.")


def generate(prompt: str, images: list[str], on_progress: Callable[[int], None]) -> str:
    """Startet den passenden Meshy-Auftrag und gibt die GLB-Download-URL zurueck."""
    common = {
        "ai_model": AI_MODEL,
        "topology": "triangle",
        "target_polycount": POLYCOUNT,
        "should_remesh": True,
    }
    if len(images) >= 2:
        base = f"{API}/v1/multi-image-to-3d"
        task_id = _post(base, {**common, "image_urls": [_data_uri(p) for p in images[:4]],
                               "should_texture": False, "symmetry_mode": "auto"})
    elif len(images) == 1:
        base = f"{API}/v1/image-to-3d"
        task_id = _post(base, {**common, "image_url": _data_uri(images[0]),
                               "should_texture": False, "symmetry_mode": "auto"})
    else:
        # Nur "preview": untexturiertes Mesh, genau das was der Drucker braucht.
        base = f"{API}/v2/text-to-3d"
        task_id = _post(base, {**common, "mode": "preview", "prompt": prompt[:600]})

    task = _poll(f"{base}/{task_id}", on_progress)
    url = (task.get("model_urls") or {}).get("glb")
    if not url:
        raise MeshyError("Meshy hat keine GLB-Datei geliefert.")
    return url


def download(url: str, dest: str) -> None:
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)
