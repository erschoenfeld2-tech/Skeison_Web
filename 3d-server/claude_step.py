"""Ein einziger, kleiner Claude-Aufruf pro Auftrag.

Sparsam by design:
- Claude wird NUR aufgerufen, wenn eine Beschreibung da ist (reines Foto -> kein Aufruf).
- Bilder gehen nur verkleinert (max. 512 px) mit, das spart Bild-Tokens.
- Antwort als festes JSON-Schema, kurze Ausgabe, effort "low".
- Ohne ANTHROPIC_API_KEY laeuft alles weiter, nur ohne Prompt-Optimierung.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os

import anthropic
from PIL import Image

log = logging.getLogger("skeison3d.claude")

MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-5-5")
EFFORT = os.getenv("CLAUDE_EFFORT", "low")

SYSTEM = """Du bereitest Auftraege fuer einen KI-3D-Generator (Meshy) vor, dessen Ergebnis als STL/3MF \
auf einem FDM-3D-Drucker gedruckt wird. Der Nutzer schreibt meist Deutsch.

Aufgaben:
1. meshy_prompt: Formuliere die Beschreibung als klaren englischen Prompt (max. 500 Zeichen) fuer EIN \
einzelnes, zusammenhaengendes, druckbares Objekt: kompakte Form, keine haarduennen Teile, keine \
schwebenden Einzelteile, keine Umgebung/Szene/Boden. Beschreibe Form und Proportionen, nicht Farben.
2. size_mm: Nur wenn der Nutzer eine Groesse nennt (z.B. "10 cm hoch"), die laengste Kante in mm, sonst null.
3. name: kurzer deutscher Dateiname-tauglicher Titel (max. 40 Zeichen).
4. hint: ein kurzer deutscher Hinweis an den Nutzer zur Druckbarkeit, oder leer.
Wenn Fotos beiliegen, beschreibt der Text Wuensche zum Objekt auf dem Foto."""

SCHEMA = {
    "type": "object",
    "properties": {
        "meshy_prompt": {"type": "string"},
        "size_mm": {"type": ["number", "null"]},
        "name": {"type": "string"},
        "hint": {"type": "string"},
    },
    "required": ["meshy_prompt", "size_mm", "name", "hint"],
    "additionalProperties": False,
}


def enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))


def _thumb_b64(path: str, max_px: int = 512) -> tuple[str, str]:
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((max_px, max_px))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=80)
    return "image/jpeg", base64.standard_b64encode(buf.getvalue()).decode()


def refine(description: str, image_paths: list[str]) -> dict | None:
    """Gibt das JSON-Ergebnis zurueck oder None (kein Key / Fehler -> Pipeline nutzt Rohtext)."""
    if not description.strip() or not enabled():
        return None

    content: list[dict] = []
    for p in image_paths[:1]:  # ein Vorschaubild reicht fuer den Kontext
        media, data = _thumb_b64(p)
        content.append({"type": "image", "source": {"type": "base64", "media_type": media, "data": data}})
    content.append({"type": "text", "text": f"Beschreibung des Nutzers:\n{description.strip()[:1500]}"})

    client = anthropic.Anthropic(timeout=60.0, max_retries=2)
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=4000,
            system=SYSTEM,
            output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.RateLimitError:
        log.warning("Claude: Rate-Limit, nutze Rohtext")
        return None
    except anthropic.APIStatusError as e:
        log.warning("Claude: API-Fehler %s: %s", e.status_code, e.message)
        return None
    except anthropic.APIConnectionError:
        log.warning("Claude: keine Verbindung, nutze Rohtext")
        return None

    if resp.stop_reason == "refusal":
        log.info("Claude hat abgelehnt: %s", resp.stop_details)
        return {"refused": True}

    text = next((b.text for b in resp.content if b.type == "text"), "")
    u = resp.usage
    log.info("Claude %s: in=%s out=%s", MODEL, u.input_tokens, u.output_tokens)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        log.warning("Claude: ungueltiges JSON")
        return None
