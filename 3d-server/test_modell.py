"""Ein Modell direkt auf diesem PC erzeugen, ohne Webseite und ohne Supabase (zum Testen auf dem Server-PC).

  .venv\\Scripts\\python test_modell.py "Runder Stifthalter mit dem Schriftzug SKEISON"
  .venv\\Scripts\\python test_modell.py "Handyständer" --size 120 --foto bild.jpg

Nutzt die Einstellungen aus .env (GENERATOR, CLAUDE_*, BLENDER_*). Ergebnis unter data\\test\\<zeit>\\out.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import time

from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))

import pipeline  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("beschreibung")
    p.add_argument("--size", type=float, default=0, help="laengste Kante in mm (0 = Claude entscheidet)")
    p.add_argument("--foto", action="append", default=[])
    p.add_argument("--ohne-standflaeche", action="store_true")
    p.add_argument("--einstellungen", default="{}",
                   help='Druckeinstellungen als JSON, z. B. {"nozzle": 0.4, "layer": 0.2, "material": "PETG"}')
    a = p.parse_args()

    jdir = os.path.join(HERE, "data", "test", time.strftime("%Y%m%d-%H%M%S"))
    os.makedirs(jdir)
    fotos = []
    for i, f in enumerate(a.foto[:4]):
        dst = os.path.join(jdir, f"bild{i}{os.path.splitext(f)[1].lower() or '.jpg'}")
        shutil.copy(f, dst)
        fotos.append(dst)
    job = pipeline.Job(id="test", dir=jdir, description=a.beschreibung, images=fotos, size_mm=a.size or 80,
                       size_user=bool(a.size), flat_base=not a.ohne_standflaeche,
                       settings=json.loads(a.einstellungen))
    print(f"Erzeugung: {'demo' if pipeline.DEMO else pipeline.generator()} - Ordner: {jdir}", flush=True)
    t = time.time()
    pipeline.run(job)
    print(json.dumps({**job.public(), "sekunden": round(time.time() - t)}, ensure_ascii=False, indent=2))
    if job.state == "done":
        print("Dateien:", os.path.join(jdir, "out"))
        print("Vorschaubilder (ansicht_*.png) und Claudes Skripte (modell_*.py) liegen im Ordner.")


if __name__ == "__main__":
    main()
