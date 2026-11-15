# 3D-Druck – Server einrichten (Windows 11, neben den laufenden Diensten)

Diese Anleitung besteht aus **fertigen Prompts für Claude Code auf dem Server-PC**. Du fügst sie nacheinander ein, Claude führt die Einrichtung aus und prüft am Ende jedes Schritts, ob er geklappt hat. Zwischen den Prompts entscheidest du, ob es weitergeht.

**Ausgangslage (Stand dieses Repos):**
- Eingerichtet wird zuerst auf dem Server-PC **HW_01**. Später zieht alles auf den baugleichen **HW_02** um (Prompt 10).
- Windows-11-PC, der als Server dient, mit `C:\MinecraftHosting`: MCSManager, Cobblemon-Server und die Werkzeuge aus `tools\`.
- Dort laufen schon `sync-github.js` (Daten für die Webseite), `ki-bot.js` (nutzt das lokal angemeldete Claude Code mit Haiku) und bei Bedarf `admin-panel.js` auf `127.0.0.1:8090`.
- Diese Dienste sind **Produktion** und dürfen nicht gestört werden.

**Was hinzukommt:**
- Der 3D-Worker (`3d-server/worker.py`) läuft unter `C:\MinecraftHosting\3d-druck`.
- **Kein offener Port, kein Tunnel, keine eigene Domain.** Wie das Admin-Panel und `sync-github.js` baut der Worker nur Verbindungen nach außen auf: Die Seite auf GitHub Pages legt Aufträge in Supabase ab (Projekt `skeison-whitelist`, Tabellen aus `supabase/druck3d.sql`). Der Worker holt sie dort ab, rechnet und legt STL/3MF in den privaten Bucket `p3d` zurück.
- Den Supabase-Zugang nimmt der Worker automatisch aus `C:\MinecraftHosting\tools\admin.config.json`, die das Admin-Panel schon nutzt.
- **Kein zusätzliches Geld:** Claude modelliert das Objekt selbst in Blender (`GENERATOR=claude`) und läuft über die Anmeldung von Claude Code wie der KI-Bot, also über das vorhandene Pro-Abo. Meshy und ein API-Key sind nicht nötig.
- Blender läuft ohne Oberfläche mit **niedriger Priorität, begrenzten Kernen und einer RAM-Grenze**, damit Minecraft flüssig bleibt.

```
Webseite (GitHub Pages) ──p3d_create_job──►  Supabase  ◄──p3d_claim / p3d_update / Storage──  worker.py (Server-PC)
          ◄───── p3d_get_job + Download über signierte URL ─────┘
```

---

## Claude-Abo statt zusätzlicher Kosten

Pro Auftrag ruft der Worker Claude **höchstens dreimal** auf (`CAD_MAX_CALLS`): Entwurf als Blender-Skript, dann bis zu zwei Kontrollen anhand von zwei Vorschaubildern. Modell: das aktuelle Sonnet (`CLAUDE_CAD_MODEL=sonnet`), im Pro-Abo enthalten.

- `CLAUDE_BACKEND=cli` (Standard): lokal angemeldetes Claude Code wie der KI-Bot. Zählt gegen die Nutzungsgrenzen des Pro-Abos, gemeinsam mit dem KI-Bot und deiner eigenen Nutzung. Kostet kein zusätzliches Geld. Ist das Kontingent erschöpft, bekommt der Besucher „Die KI ist gerade ausgelastet“.
- `ANTHROPIC_API_KEY` **leer lassen**. Nur mit `CLAUDE_BACKEND=api` würde ein Key genutzt, und das kostet Geld.
- Tageslimits: 3 Modelle pro Besucher, 10 insgesamt (`JOBS_PER_IP_PER_DAY`, `JOBS_TOTAL_PER_DAY`). So bleibt genug für den KI-Bot.
- Was gut klappt: Halter, Boxen, Schilder mit Text, Vasen, einfache Ersatzteile. Tiere und Figuren werden stilisiert.
- Sicherheit: Claudes Skript entsteht aus Besuchertext. Es wird vor dem Start geprüft (`blender/cad_sandbox.py`: nur Geometrie, keine Dateien, kein `bpy.ops`, kein Import außer bpy/bmesh/math) und läuft in einem eigenen Blender mit Zeit- und RAM-Grenze. Claude Code selbst hat dabei keine Werkzeuge außer Lesen der Bilder im eigenen Auftragsordner (`--restricted`).

---

## Prompt 0 – Regeln für diese Sitzung (immer zuerst einfügen)

```text
Du richtest auf diesem Windows-11-PC einen zusätzlichen Dienst ein: den 3D-Druck-Server aus dem Repo
https://github.com/erschoenfeld2-tech/Skeison_Web (Ordner 3d-server/, Anleitung 3d-server/SERVER-SETUP.md).
Auf diesem PC laufen bereits Produktivdienste: MCSManager, der Cobblemon-Minecraft-Server und die Werkzeuge
unter C:\MinecraftHosting\tools (sync-github.js, ki-bot.js, admin-panel.js). Für die ganze Sitzung gilt:

1. Beende, starte oder ändere KEINE bestehenden Prozesse, Dienste, geplanten Aufgaben, MCSManager-Instanzen
   oder Dateien unter C:\MinecraftHosting außerhalb von C:\MinecraftHosting\3d-druck. Kein Neustart des PCs.
2. Keine Änderungen an Windows-Firewall, Router, Energieeinstellungen oder Benutzerkonten, ohne mich vorher
   zu fragen. Der neue Dienst öffnet keinen Port nach außen und braucht keinen Tunnel.
3. Vor jeder Installation (winget, pip, Downloads) sagst du, was du installierst und woher, und wartest auf mein OK.
4. Gib niemals API-Keys, Tokens oder den Inhalt von .env-Dateien aus. Schlüssel trage ich selbst ein.
5. Nutze PowerShell. Zeig mir vor jedem Schritt mit Wirkung den Befehl. Wenn etwas schiefgeht: anhalten,
   Ursache erklären, Vorschlag machen, auf mein OK warten.
Bestätige die Regeln kurz und warte dann auf den nächsten Prompt.
```

## Prompt 1 – Bestandsaufnahme (nur lesen, ändert nichts)

```text
Mach eine Bestandsaufnahme dieses PCs, ohne etwas zu ändern:
1. Windows-Version, CPU (Kerne/Threads), RAM gesamt und frei, freier Speicher auf C:.
2. Laufende Prozesse rund um den Server: java/javaw (Minecraft), node_app.exe (MCSManager, Werkzeuge),
   claude.exe, python. Zeig CPU- und RAM-Verbrauch.
3. Belegte Ports (Get-NetTCPConnection -State Listen) mit Prozessnamen. Ist 8095 frei? Wenn nicht, schlag
   einen freien Port zwischen 8091 und 8099 vor. (Der Worker belegt ihn nur auf 127.0.0.1 als Sperre gegen
   doppelten Start; er nimmt darüber nichts an.)
4. Wie werden ki-bot.js und sync-github.js gestartet? Prüfe MCSManager (Instanzen in
   C:\MinecraftHosting\panel), die Aufgabenplanung (Get-ScheduledTask, nur Aufgaben, die nicht von Microsoft
   stammen) und die Autostart-Ordner. Unter welchem Windows-Benutzer laufen sie?
5. Vorhanden? git, python (Version), winget, Blender. Gibt es C:\MinecraftHosting\tools\admin.config.json
   (nur ob die Datei existiert und die Felder supabaseUrl und serviceKey hat, Inhalt NICHT anzeigen)?
6. claude.exe: Finde sie wie tools\ki-bot.js (findClaude: %APPDATA%\Claude\claude-code oder
   %LOCALAPPDATA%\Claude-Data) und nenne den Pfad. Schau in C:\MinecraftHosting\tools\data\ki-bot.log nach
   den letzten Antworten, um zu sehen, ob die Anmeldung funktioniert (nur Zeitstempel und ob Fehler, keine Inhalte).
7. Energieoptionen: Geht der PC in den Ruhezustand oder Standby (powercfg /query für Standby- und Ruhezustand-Zeit)?

Fasse am Ende zusammen: empfohlener Port, empfohlene Zahl Blender-Threads (etwa ein Drittel der Threads,
höchstens 4, damit Minecraft genug übrig hat), und auf welchem Weg der 3D-Server automatisch starten sollte
(derselbe wie beim KI-Bot). Ändere nichts.
```

## Prompt 2 – Software installieren

```text
Installiere, was für den 3D-Druck-Server fehlt (frag vor jeder Installation, Regel 3):
1. Git, falls nicht vorhanden: winget install --id Git.Git -e
2. Python 3.12 (oder neuer), falls nicht vorhanden: winget install --id Python.Python.3.12 -e
   Danach in einer neuen PowerShell prüfen: py -3.12 --version
3. Blender LTS (4.2 oder neuer): mit `winget search Blender` die passende LTS-ID suchen, mir zeigen und nach
   meinem OK installieren. Alternativ die .zip von https://download.blender.org/release/ nach
   C:\MinecraftHosting\3d-druck\blender entpacken (dann bleibt alles in einem Ordner).
4. Test ohne Oberfläche (Pfad zu blender.exe anpassen):
   & "<blender.exe>" -b --factory-startup --version
   & "<blender.exe>" -b --factory-startup --python-expr "import bpy; bpy.ops.mesh.primitive_monkey_add(); bpy.ops.export_scene.gltf(filepath=r'C:\MinecraftHosting\3d-druck\test\monkey.glb')"
   (den Ordner test vorher anlegen)

Prüfung am Ende: Versionen von git, Python und Blender, voller Pfad zu blender.exe, Größe von monkey.glb.
```

## Prompt 3 – 3D-Server installieren

```text
Installiere den 3D-Druck-Server nach C:\MinecraftHosting\3d-druck:
1. git clone --depth 1 https://github.com/erschoenfeld2-tech/Skeison_Web.git C:\MinecraftHosting\3d-druck\repo
   Lies danach repo\3d-server\README.md, repo\3d-server\worker.py und repo\supabase\druck3d.sql.
2. In repo\3d-server eine venv anlegen (py -3.12 -m venv .venv) und requirements.txt installieren.
3. repo\3d-server\.env aus .env.example erstellen mit:
   SERVER_NAME=HW_01, DEMO_MODE=1 (vorerst!), JOB_WORKERS=1, GENERATOR=claude, CLAUDE_BACKEND=cli,
   ANTHROPIC_API_KEY und MESHY_API_KEY leer,
   BLENDER_BIN='<voller Pfad zu blender.exe aus Prompt 2>' (in einfachen Anführungszeichen),
   BLENDER_THREADS=<Empfehlung aus Prompt 1>, BLENDER_LOW_PRIORITY=1.
   Wenn claude.exe in Prompt 1 nicht automatisch gefunden wurde: CLAUDE_EXE='<Pfad>'.
   Supabase: SUPABASE_URL und SUPABASE_SERVICE_KEY leer lassen, wenn admin.config.json existiert (der Worker
   liest sie dort). Sonst trage ich den Key selbst ein. Keine Schlüssel eintragen oder anzeigen (Regel 4).
4. .env nur für den Windows-Benutzer lesbar machen, unter dem der Dienst laufen soll:
   icacls .env /inheritance:r /grant:r "<Benutzer>:(R,W)"
5. Wenn der Port aus Prompt 1 nicht 8095 ist: Umgebungsvariable S3D_PORT für diesen Benutzer setzen
   ([Environment]::SetEnvironmentVariable('S3D_PORT','<Port>','User')).

Prüfung am Ende: .venv\Scripts\python -c "import fastapi, requests, anthropic, PIL; print('ok')" und
icacls .env (nur die Rechte, nicht den Inhalt).
```

## Prompt 4 – Testen, ohne Guthaben zu verbrauchen

```text
Teste den 3D-Server, ohne Claude oder Meshy zu nutzen. Beobachte dabei, dass Minecraft weiterläuft.

Teil A – Demo-Modus (DEMO_MODE=1), nur lokal über HTTP (app.py, ohne Supabase):
1. Starte im Ordner repo\3d-server testweise im Vordergrund:
   .venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port <Port>
2. In einer zweiten PowerShell: Invoke-RestMethod http://127.0.0.1:<Port>/api/health
3. Auftrag anlegen: curl.exe -s -F "description=Testvase" -F "size_mm=60" http://127.0.0.1:<Port>/api/jobs
   Status unter /api/jobs/<id> abfragen bis state "done", dann /api/jobs/<id>/file?format=3mf und
   ?format=stl herunterladen. Prüfen: 3MF ist ein gültiges ZIP, STL-Größe = 84 + 50 × Dreiecke.
4. Im Browser http://127.0.0.1:<Port>/3d/ öffnen: Seite erscheint im Skeison-Design.
5. Testserver beenden (nur diesen Prozess!). Er wird danach nicht mehr gebraucht; im Betrieb läuft worker.py.

Teil B – Blender mit der Test-GLB aus Prompt 2 (kostet nichts):
1. Während es läuft, CPU-Last von java und blender beobachten (Get-Process).
   & "<blender.exe>" -b --factory-startup -noaudio -t <Threads> -P repo\3d-server\blender\printprep.py -- `
     --in C:\MinecraftHosting\3d-druck\test\monkey.glb --out-dir C:\MinecraftHosting\3d-druck\test\out `
     --name affe --size 60 --flat-base 1
   (Hier läuft Blender mit normaler Priorität; der Dienst startet es später mit niedriger.)
2. Die letzte Zeile muss mit SKEISON_RESULT beginnen, mit "watertight": true und der längsten Kante
   etwa 60 mm. Bei einem Fehler: Ausgabe analysieren, Lösung vorschlagen, auf mein OK warten.

Prüfung am Ende: SKEISON_RESULT-Zeile, Dauer, höchste CPU-Last von Blender, und ob Minecraft dabei weiterlief.
```

## Prompt 5 – Claude modelliert ein Testobjekt (nutzt das Pro-Abo, kein Geld)

```text
Prüfe, ob Claude auf diesem PC Modelle in Blender bauen kann (GENERATOR=claude, CLAUDE_BACKEND=cli).
Unter dem Windows-Benutzer, unter dem auch der Dienst laufen wird, GENAU EINEN Test ausführen:
cd repo\3d-server
$env:DEMO_MODE = '0'; .venv\Scripts\python test_modell.py "Runder Stifthalter, 90 mm hoch, mit dem Schriftzug SKEISON" `
  --einstellungen '{"nozzle": 0.4, "layer": 0.2, "material": "PLA"}'
Erwartet: state "done", watertight true, exact true, Maße um 90 mm, Prüfwerte (wall_p05, overhang_pct) und recommend. Zeig mir die Dauer, die Zeilen von skeison3d.cad
(wie viele Claude-Aufrufe, ob ein Skript abgelehnt wurde) und schau dir die Vorschaubilder ansicht_*.png im
ausgegebenen Ordner an: Ist es ein Stifthalter mit Schriftzug?
Wenn "Not logged in" kommt: Mir sagen, dass ich die Anmeldung wie beim KI-Bot einmal selbst erledige
(C:\MinecraftHosting\tools\ki-login.bat, dort /login und dann /exit). Danach den Test einmal wiederholen.
Wenn claude.exe eine Option nicht kennt (andere Version): Fehlermeldung zeigen, in claude_step.py (_ask_cli)
eine Lösung vorschlagen und auf mein OK warten. Keine Sicherheitsprüfungen in cad_sandbox.py lockern.
```

## Prompt 6 – Verbindung zu Supabase prüfen (Demo, kostet nichts)

```text
Der 3D-Worker bekommt keine Anfragen von außen, er holt die Aufträge selbst aus Supabase (siehe
repo\3d-server\worker.py und repo\supabase\druck3d.sql; die Tabellen sind schon angelegt).
Kein Tunnel, keine Portfreigabe, keine Firewall-Regel.
1. Prüfe in repo\3d-server\.env (ohne Werte von Schlüsseln anzuzeigen): DEMO_MODE=1.
2. Starte im Ordner repo\3d-server testweise im Vordergrund: .venv\Scripts\python worker.py
   Erwartet: "3D-Worker w1 gestartet: Demo=True, Claude=cli ...". Fehlt der Supabase-Zugang, sag es mir.
3. In einer zweiten PowerShell den Status so abfragen, wie es die Webseite tut (öffentlicher Schlüssel aus
   repo\site\3d\config.js, der ist nicht geheim):
   $k = '<key aus config.js>'; $h = @{ apikey = $k; Authorization = "Bearer $k" }
   Invoke-RestMethod -Method Post -Headers $h -ContentType 'application/json' -Body '{}' `
     https://pumdupjmmvimlxqvuymg.supabase.co/rest/v1/rpc/p3d_status
   Erwartet: online True, demo True.
4. Einen Demo-Auftrag wie die Webseite anlegen (rpc/p3d_create_job mit Body
   {"p_description":"Testvase","p_size_mm":60,"p_size_user":true,"p_flat_base":true}), dann mit
   rpc/p3d_get_job {"p_id":"<id>"} alle 3 Sekunden abfragen bis state "done". Die URL unter files.3mf
   herunterladen und prüfen, dass es ein gültiges ZIP ist.
5. Den Worker beenden (Strg+C, nur diesen Prozess).
Prüfung am Ende: Ausgabe des Workers, Status vorher/nachher, Größe der heruntergeladenen 3MF.
```

## Prompt 7 – Automatisch starten

```text
Richte den automatischen Start des 3D-Workers ein, auf DEMSELBEN Weg wie beim KI-Bot (Ergebnis aus Prompt 1)
und unter demselben Windows-Benutzer, damit die Claude-Anmeldung gilt. Das Startskript ist
repo\3d-server\start-3d-server.bat (startet worker.py, schreibt nach data\logs\worker.log, öffnet keinen Port).

- Wenn der KI-Bot über MCSManager läuft: Erkläre mir Schritt für Schritt, wie ich im MCSManager-Webpanel
  eine neue Instanz "3D-Druck" (allgemeine Anwendung, Startbefehl = die .bat, Arbeitsordner = repo\3d-server,
  Autostart an, Neustart bei Absturz an) anlege. Ändere die Konfiguration von MCSManager nicht selbst.
- Wenn er über die Aufgabenplanung läuft: Lege eine Aufgabe "Skeison 3D-Druck" an (Auslöser: bei Anmeldung
  dieses Benutzers und beim Start, Aktion: die .bat, "Bei Fehler neu starten" alle 1 Minute, beliebig oft,
  keine Laufzeitbegrenzung, Batterie- und Leerlaufbedingungen aus). Wenn "Unabhängig von der Anmeldung
  ausführen" nötig ist, gebe ich das Passwort selbst in der Aufgabenplanung ein, nicht du.
- Sonst: Schlag den passenden Weg vor und warte auf mein OK.

Prüfung am Ende: worker.log zeigt "gestartet", p3d_status (wie in Prompt 6) meldet online True,
und Get-Process zeigt, dass Minecraft, MCSManager, sync-github und KI-Bot weiterhin laufen.
```

## Prompt 8 – Echtbetrieb einschalten (nutzt das Pro-Abo, kein Geld)

```text
Schalte den 3D-Worker in den Echtbetrieb. Gib keine Schlüssel aus.
1. In repo\3d-server\.env: DEMO_MODE=0, GENERATOR=claude, CLAUDE_BACKEND=cli, SERVER_NAME=HW_01.
   Prüfe ohne Werte anzuzeigen, dass ANTHROPIC_API_KEY leer ist (sonst mich fragen).
2. Starte nur den 3D-Worker neu (Weg aus Prompt 7). worker.log muss "Demo=False, Erzeugung=claude" zeigen,
   p3d_status meldet server "HW_01" und generator "claude".
3. Ich lege GENAU EINEN Auftrag über https://erschoenfeld2-tech.github.io/Skeison_Web/3d/ an.
   Verfolge worker.log und beobachte währenddessen die CPU-Last von java und blender.
4. Nach "fertig": Zeig die Zeilen zum Auftrag aus worker.log (Claude-Aufrufe, Dauer) und die Ergebnisse
   (Größe, Dreiecke, watertight) aus p3d_get_job.
5. Bei Fehlern: Log lesen, Ursache erklären, Lösung vorschlagen, auf mein OK warten.
```

## Prompt 9 – Wartung

```text
Richte für den 3D-Worker eine einfache Wartung ein (nur innerhalb von C:\MinecraftHosting\3d-druck und
mit eigener geplanter Aufgabe, bestehende Aufgaben nicht anfassen):
1. Check alle 5 Minuten (PowerShell-Skript + geplante Aufgabe "Skeison 3D-Druck Check"): Läuft kein
   python-Prozess mit worker.py in der Befehlszeile, den Worker auf dem Weg aus Prompt 7 starten und eine Zeile
   in data\logs\health.log schreiben. (Hat der Weg aus Prompt 7 schon "Neustart bei Absturz", reicht das Log.)
2. Logs: Ist data\logs\worker.log größer als 20 MB, auf die letzten 5000 Zeilen kürzen.
3. Lege C:\MinecraftHosting\3d-druck\WARTUNG.md an: Logs ansehen, Worker neu starten, Update
   (cd repo; git pull; .venv\Scripts\pip install -r 3d-server\requirements.txt; Worker neu starten),
   Blender aktualisieren (BLENDER_BIN anpassen), Tageslimits ändern (JOBS_PER_IP_PER_DAY, JOBS_TOTAL_PER_DAY,
   greifen nach dem Neustart, weil der Worker sie an Supabase meldet), Zugangscode (ACCESS_CODE),
   ein Testmodell (test_modell.py), Umzug auf HW_02 (Prompt 10 aus SERVER-SETUP.md).
```

## Prompt U – Update (wenn HW_01 schon mit einer älteren Fassung läuft)

```text
Aktualisiere den 3D-Worker auf die neue Fassung (Claude modelliert selbst in Blender, kein Meshy nötig):
1. cd C:\MinecraftHosting\3d-druck\repo; git pull; .venv\Scripts\pip install -r 3d-server\requirements.txt
2. Ergänze in 3d-server\.env (Werte von Schlüsseln nicht anzeigen): SERVER_NAME=HW_01, GENERATOR=claude,
   CLAUDE_BACKEND=cli, CLAUDE_CAD_MODEL=sonnet, CAD_MAX_CALLS=3, JOBS_PER_IP_PER_DAY=3, JOBS_TOTAL_PER_DAY=10,
   BLENDER_MAX_RAM_MB=3072. Vergleiche mit .env.example, ob sonst etwas fehlt.
3. Test wie in Prompt 5, dann nur den 3D-Worker neu starten (Weg aus Prompt 7) und worker.log prüfen
   ("w2 auf HW_01 gestartet ... Erzeugung=claude").
```

## Prompt 10 – Umzug von HW_01 auf HW_02

Auf HW_02 zuerst die Prompts 0 bis 7 ausführen (mit `SERVER_NAME=HW_02` in Prompt 3). Den Worker dort aber erst starten, wenn er auf HW_01 beendet ist: Ein zweiter Server-PC verweigert den Start, solange HW_01 noch Lebenszeichen sendet.

```text
Auf HW_01 (alter Server-PC):
1. Den 3D-Worker beenden und seinen Autostart deaktivieren (MCSManager-Instanz "3D-Druck" bzw. Aufgabe
   "Skeison 3D-Druck" und "Skeison 3D-Druck Check"); bei MCSManager erklärst du mir die Schritte.
   Nichts anderes anfassen.
2. Warte, bis p3d_status online False meldet (höchstens 3 Minuten).

Auf HW_02 (neuer Server-PC, Prompts 0 bis 6 sind erledigt, SERVER_NAME=HW_02):
3. Prüfe, dass tools\admin.config.json da ist und claude.exe angemeldet ist (Test aus Prompt 5).
4. Autostart wie in Prompt 7 einrichten und starten. worker.log muss "auf HW_02 gestartet" zeigen,
   p3d_status server "HW_02". Falls der Start mit "Auf HW_01 laeuft noch ein 3D-Worker" abbricht:
   zurück zu Schritt 1 (nur im Notfall einmalig WORKER_TAKEOVER=1).
5. Ein Testauftrag über die Webseite. Alte Aufträge und Dateien räumt Supabase nach 24 h selbst auf.
6. Auf HW_01 darf der Ordner C:\MinecraftHosting\3d-druck danach bleiben (nicht löschen, ohne mich zu fragen).
```

## Optional – 3D-Erzeugung komplett auf dem eigenen PC

Meshy ist ein externer Dienst. Komplett lokal ginge es nur mit einer NVIDIA-Grafikkarte mit etwa 12–16 GB VRAM. Die wäre dann aber auch für Minecraft weniger frei.

```text
Prüfe, ob dieser PC eine NVIDIA-GPU hat (nvidia-smi) und wie viel VRAM frei ist, während Minecraft läuft.
Wenn ja: Bewerte quelloffene Bild-zu-3D-Modelle (z. B. Hunyuan3D-2, TripoSR, TRELLIS) nach Lizenz
(kommerzielle Nutzung?), VRAM-Bedarf, Qualität und Laufzeit unter Windows. Schlag eines vor und beschreibe, wie
man in repo\3d-server\meshy.py eine Funktion generate_local() mit derselben Schnittstelle ergänzt (gibt eine
GLB-Datei zurück), umschaltbar über GENERATOR=meshy|local. Noch nichts installieren.
```
