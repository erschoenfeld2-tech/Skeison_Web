# 3D-Druck-Server

Server für die Seite `site/3d/`: Beschreibung und/oder Fotos rein, druckfertige **STL** oder **3MF** raus.

```
site/3d/ (GitHub Pages)  ──►  3d-server/app.py (eigener Server)
                                 │ 1. Claude  – nur bei Text: deutsche Beschreibung -> guter 3D-Prompt
                                 │ 2. Meshy   – Text/Foto/mehrere Fotos -> 3D-Modell (ohne Textur)
                                 │ 3. Blender – headless: vereinen, Größe in mm, Voxel-Remesh (wasserdicht),
                                 │              flache Standfläche, Normalen, auf z=0 -> STL + 3MF
                                 ▼
                            Download + 3D-Vorschau im Browser
```

| Datei | Inhalt |
|---|---|
| `app.py` | API: `/api/health`, `POST /api/jobs`, `GET /api/jobs/{id}`, `GET /api/jobs/{id}/file?format=stl\|3mf`; liefert optional auch `site/` aus |
| `claude_step.py` | Der eine sparsame Claude-Aufruf (Modell und Aufwand per `.env`) |
| `meshy.py` | Meshy-API (gleiche Endpunkte wie die Blender-Skills image-to-3d / multi-image-to-3d) |
| `blender/printprep.py` | Blender-Skript: macht das Modell druckfertig |
| `blender_runner.py` | Startet Blender: `cli` (Server) oder `mcp` (laufendes Blender mit blender-mcp-Addon, Port 9876) |
| `mesh_io.py` | STL- und 3MF-Writer ohne Abhängigkeiten + Demo-Form |
| `SERVER-SETUP.md` | **Fertige Prompts**, mit denen eine KI den Server einrichtet |

Die Seite `site/3d/` findet den Server über `site/3d/config.js` (`SKEISON_3D_API`). Leer heißt: gleicher Server wie die Seite.

## Lokal testen

```bash
cd 3d-server
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Mac/Linux: .venv/bin/pip
cp .env.example .env                                # DEMO_MODE=1 setzen
.venv/Scripts/uvicorn app:app --port 8000
```

Danach http://localhost:8000/3d/ öffnen. Im Demo-Modus entsteht eine Beispiel-Vase, ohne Meshy, Claude oder Blender.

**Mit Blender am PC:** In Blender das blender-mcp-Addon verbinden und in `.env` `BLENDER_MODE=mcp` setzen. Dann bereitet dein offenes Blender die Modelle auf.

## Kosten und Schutz

- **Claude:** wird nur bei Text-Aufträgen aufgerufen, einmal pro Auftrag. Kosten mit `claude-opus-5-5` (effort low) etwa 1–2 Cent, mit `CLAUDE_MODEL=claude-haiku-5-5` etwa 0,05 Cent.
- **Meshy:** erzeugt ohne Textur. Das ist günstiger, und Farbe spielt beim Drucken keine Rolle.
- **Schutz:** Tageslimit pro IP (`JOBS_PER_IP_PER_DAY`), optionaler `ACCESS_CODE`, CORS auf deine Domains (`ALLOWED_ORIGINS`), Rate-Limit in nginx. Dateien werden nach 24 h gelöscht.
