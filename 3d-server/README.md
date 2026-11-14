# 3D-Druck-Server

Server für die Seite `site/3d/`: Beschreibung und/oder Fotos rein, druckfertige **STL** oder **3MF** raus.

```
site/3d/ (GitHub Pages) ──p3d_create_job──►  Supabase  ◄──holt ab / meldet / lädt hoch──  worker.py (Server-PC)
                        ◄──p3d_get_job + Download (signierte URL)──┘        │
                                                                             │ 1. Claude  – nur bei Text: deutsche Beschreibung -> guter 3D-Prompt
                                                                             │ 2. Meshy   – Text/Foto/mehrere Fotos -> 3D-Modell (ohne Textur)
                                                                             │ 3. Blender – headless: vereinen, Größe in mm, Voxel-Remesh (wasserdicht),
                                                                             │              flache Standfläche, Normalen, auf z=0 -> STL + 3MF
```

Der Server-PC ist von außen nicht erreichbar und braucht keinen Tunnel und keine Domain: Er baut nur Verbindungen nach außen auf, wie das Admin-Panel und `sync-github.js`. Supabase ist der Briefkasten dazwischen (Tabellen und Funktionen in `supabase/druck3d.sql`, Dateien im privaten Bucket `p3d`).

| Datei | Inhalt |
|---|---|
| `worker.py` | **Betrieb auf dem Server-PC:** holt Aufträge aus Supabase (`p3d_claim`), meldet den Fortschritt (`p3d_update`), lädt STL/3MF hoch und gibt signierte Download-Links zurück. Lebenszeichen alle 60 s (`p3d_heartbeat`), danach zeigt die Seite „offline“. Räumt nach `JOB_TTL_HOURS` auf |
| `pipeline.py` | Ein Auftrag von Anfang bis Ende: Claude → Meshy → Blender (genutzt von `worker.py` und `app.py`) |
| `app.py` | Direktbetrieb über HTTP zum lokalen Testen: `/api/health`, `POST /api/jobs`, `GET /api/jobs/{id}`, `GET /api/jobs/{id}/file?format=stl\|3mf`; liefert `site/` mit aus und stellt die Seite per `/3d/config.js` auf sich selbst um |
| `claude_step.py` | Der eine sparsame Claude-Aufruf: lokal angemeldetes Claude Code wie der KI-Bot (`CLAUDE_BACKEND=cli`) oder API-Key (`api`) |
| `start-3d-server.bat` | Start des Workers auf dem Windows-Server-PC (Log in `data\logs\worker.log`; `S3D_PORT`, Standard 8095, nur als Sperre gegen doppelten Start) |
| `meshy.py` | Meshy-API (gleiche Endpunkte wie die Blender-Skills image-to-3d / multi-image-to-3d) |
| `blender/printprep.py` | Blender-Skript: macht das Modell druckfertig |
| `blender_runner.py` | Startet Blender: `cli` (Server) oder `mcp` (laufendes Blender mit blender-mcp-Addon, Port 9876) |
| `mesh_io.py` | STL- und 3MF-Writer ohne Abhängigkeiten + Demo-Form |
| `SERVER-SETUP.md` | **Fertige Prompts** für Claude Code auf dem Windows-11-Server-PC (neben MCSManager, Minecraft und den `tools\`) |

Die Seite `site/3d/` liest die Verbindung aus `site/3d/config.js` (`window.SKEISON_3D`): `api: "supabase"` mit der Supabase-Adresse und dem öffentlichen Schlüssel wie bei der Wunschliste. Fotos verkleinert die Seite vor dem Senden (längste Seite 1536 px, JPEG).

## Lokal testen

```bash
cd 3d-server
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Mac/Linux: .venv/bin/pip
cp .env.example .env                                # DEMO_MODE=1 setzen
.venv/Scripts/uvicorn app:app --port 8000
```

Danach http://localhost:8000/3d/ öffnen. Im Demo-Modus entsteht eine Beispiel-Vase, ohne Meshy, Claude, Blender oder Supabase.

**Mit Blender am PC:** In Blender das blender-mcp-Addon verbinden und in `.env` `BLENDER_MODE=mcp` setzen. Dann bereitet dein offenes Blender die Modelle auf.

## Kosten und Schutz

- **Claude:** wird nur bei Text-Aufträgen aufgerufen, einmal pro Auftrag. Mit `CLAUDE_BACKEND=cli` nutzt der Server das lokal angemeldete Claude Code (Haiku, zählt gegen das Abo des Server-PCs, gemeinsam mit dem KI-Bot). Mit API-Key kostet es mit `claude-opus-5-5` (effort low) etwa 1–2 Cent, mit `CLAUDE_MODEL=claude-haiku-5-5` etwa 0,05 Cent.
- **Meshy:** erzeugt ohne Textur. Das ist günstiger, und Farbe spielt beim Drucken keine Rolle.
- **Schutz:** Tageslimit pro Besucher (`JOBS_PER_IP_PER_DAY`, die IP wird nur als Hash gespeichert) und für alle zusammen (`JOBS_TOTAL_PER_DAY`), optionaler `ACCESS_CODE`. Die Werte stehen in der `.env` des Server-PCs; der Worker meldet sie mit jedem Lebenszeichen an Supabase, geprüft wird in `p3d_create_job`. Ist der Worker aus, nimmt die Seite keine Aufträge an. Die Seite darf nur `p3d_status`, `p3d_create_job` und `p3d_get_job` aufrufen; alles andere nur der Worker mit dem service_role-Key. Aufträge und Dateien werden nach 24 h gelöscht.
- **Rücksicht auf Minecraft:** Blender läuft mit niedriger Priorität (`BLENDER_LOW_PRIORITY`) und begrenzten Kernen (`BLENDER_THREADS`), immer nur ein Auftrag gleichzeitig. Ein zweiter Worker startet nicht.
