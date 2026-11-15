# 3D-Druck-Server

Server für die Seite `site/3d/`: Beschreibung und/oder Fotos rein, druckfertige **STL** oder **3MF** raus.

```
site/3d/ (GitHub Pages) ──p3d_create_job──►  Supabase  ◄──holt ab / meldet / lädt hoch──  worker.py (Server-PC)
                        ◄──p3d_get_job + Download (signierte URL)──┘        │
                                                                             │ 1. Claude  – schreibt ein Blender-Skript (GENERATOR=claude, Standard)
                                                                             │              oder einen Prompt für Meshy (GENERATOR=meshy, kostet Credits)
                                                                             │ 2. Blender – baut das Skript (geprüft, abgeschottet), rendert 2 Ansichten,
                                                                             │              Claude kontrolliert und bessert nach (höchstens 3 Aufrufe)
                                                                             │ 3. Blender – druckfertig: Voxel-Remesh (wasserdicht), Größe in mm, auf z=0 -> STL + 3MF
```

Der Server-PC ist von außen nicht erreichbar und braucht keinen Tunnel und keine Domain: Er baut nur Verbindungen nach außen auf, wie das Admin-Panel und `sync-github.js`. Supabase ist der Briefkasten dazwischen (Tabellen und Funktionen in `supabase/druck3d.sql`, ergänzt durch `druck3d_server.sql`; Dateien im privaten Bucket `p3d`).

| Datei | Inhalt |
|---|---|
| `worker.py` | **Betrieb auf dem Server-PC:** holt Aufträge aus Supabase (`p3d_claim`), meldet den Fortschritt (`p3d_update`), lädt STL/3MF hoch und gibt signierte Download-Links zurück. Lebenszeichen alle 60 s (`p3d_heartbeat`), danach zeigt die Seite „offline“. Räumt nach `JOB_TTL_HOURS` auf |
| `pipeline.py` | Ein Auftrag von Anfang bis Ende (genutzt von `worker.py`, `app.py` und `test_modell.py`); `GENERATOR` wählt Claude-Modellierung oder Meshy |
| `cad_generator.py` | Claude modelliert in Blender: Entwurf, Bau, Kontrolle an Vorschaubildern, Nachbessern |
| `blender/cadmodel.py`, `blender/cad_sandbox.py` | Baut Claudes Skript in Blender und rendert die Ansichten; die Sandbox prüft das Skript vorher (nur Geometrie, kein `bpy.ops`, keine Dateien, keine Imports außer bpy/bmesh/math) |
| `test_modell.py` | Ein Modell direkt auf dem PC erzeugen, ohne Webseite und Supabase |
| `app.py` | Direktbetrieb über HTTP zum lokalen Testen: `/api/health`, `POST /api/jobs`, `GET /api/jobs/{id}`, `GET /api/jobs/{id}/file?format=stl\|3mf`; liefert `site/` mit aus und stellt die Seite per `/3d/config.js` auf sich selbst um |
| `claude_step.py` | Claude-Aufrufe: lokal angemeldetes Claude Code wie der KI-Bot (`CLAUDE_BACKEND=cli`, Standard, nur Abo) oder API-Key (`api`, kostet Geld). Claude Code läuft ohne Werkzeuge, nur mit Lesen der Bilder im eigenen Ordner (`--restricted`) |
| `start-3d-server.bat` | Start des Workers auf dem Windows-Server-PC (Log in `data\logs\worker.log`; `S3D_PORT`, Standard 8095, nur als Sperre gegen doppelten Start) |
| `meshy.py` | Meshy-API (gleiche Endpunkte wie die Blender-Skills image-to-3d / multi-image-to-3d) |
| `blender/printprep.py` | Blender-Skript: macht das Modell druckfertig |
| `blender_runner.py` | Startet Blender mit niedriger Priorität, begrenzten Kernen und RAM-Grenze (Windows-Job-Objekt): `cli` (Server) oder für printprep auch `mcp` (laufendes Blender mit blender-mcp-Addon, Port 9876) |
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

- **Ohne zusätzliches Geld (Standard):** `GENERATOR=claude` und `CLAUDE_BACKEND=cli`. Claude (Sonnet) modelliert über das angemeldete Claude Code, höchstens `CAD_MAX_CALLS` (3) Aufrufe pro Auftrag. Das zählt gegen die Nutzungsgrenzen des Pro-Abos, gemeinsam mit dem KI-Bot. Gut für technische Dinge, Tiere und Figuren werden stilisiert.
- **Meshy (optional):** `GENERATOR=meshy` mit `MESHY_API_KEY` (Meshy Pro-Abo, etwa 20 Credits pro Modell ohne Textur). Besser bei organischen Formen und Fotos.
- **Schutz:** Tageslimit pro Besucher (`JOBS_PER_IP_PER_DAY`, die IP wird nur als Hash gespeichert) und für alle zusammen (`JOBS_TOTAL_PER_DAY`), optionaler `ACCESS_CODE`. Die Werte stehen in der `.env` des Server-PCs; der Worker meldet sie mit jedem Lebenszeichen an Supabase, geprüft wird in `p3d_create_job`. Ist der Worker aus, nimmt die Seite keine Aufträge an. Die Seite darf nur `p3d_status`, `p3d_create_job` und `p3d_get_job` aufrufen; alles andere nur der Worker mit dem service_role-Key. Aufträge und Dateien werden nach 24 h gelöscht.
- **Rücksicht auf Minecraft:** Blender läuft mit niedriger Priorität (`BLENDER_LOW_PRIORITY`), begrenzten Kernen (`BLENDER_THREADS`) und höchstens `BLENDER_MAX_RAM_MB` Speicher, immer nur ein Auftrag gleichzeitig. Ein zweiter Worker startet nicht, auch nicht auf einem anderen Server-PC (`SERVER_NAME`, z. B. HW_01/HW_02; Umzug in `SERVER-SETUP.md`, Prompt 10).
