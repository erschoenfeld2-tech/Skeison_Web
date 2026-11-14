# 3D-Druck – Server einrichten (Windows 11, neben den laufenden Diensten)

Diese Anleitung besteht aus **fertigen Prompts für Claude Code auf dem Server-PC**. Du fügst sie nacheinander ein, Claude führt die Einrichtung aus und prüft am Ende jedes Schritts, ob er geklappt hat. Zwischen den Prompts entscheidest du, ob es weitergeht.

**Ausgangslage (Stand dieses Repos):**
- Windows-11-PC, der als Server dient, mit `C:\MinecraftHosting`: MCSManager, Cobblemon-Server und die Werkzeuge aus `tools\`.
- Dort laufen schon `sync-github.js` (Daten für die Webseite), `ki-bot.js` (nutzt das lokal angemeldete Claude Code mit Haiku) und bei Bedarf `admin-panel.js` auf `127.0.0.1:8090`.
- Diese Dienste sind **Produktion** und dürfen nicht gestört werden.

**Was hinzukommt:**
- Der 3D-Server (`3d-server/`) läuft unter `C:\MinecraftHosting\3d-druck` und lauscht nur auf `127.0.0.1:8095`.
- Erreichbar wird er über einen **Tunnel** (Cloudflare oder Tailscale). So braucht es keine Portfreigabe im Router und keine Ausnahme in der Windows-Firewall, und die IP-Adresse des PCs bleibt verborgen.
- Blender läuft ohne Oberfläche mit **niedriger Priorität und begrenzten Kernen**, damit Minecraft flüssig bleibt.

---

## Claude-Kontingent: welcher Weg?

Der 3D-Server ruft Claude **nur bei Text-Aufträgen** auf, genau einmal pro Auftrag. Bei reinen Foto-Aufträgen wird Claude gar nicht aufgerufen.

| `CLAUDE_BACKEND` | Wie | Verbrauch |
|---|---|---|
| `cli` | Das lokal angemeldete Claude Code, wie der KI-Bot (`claude.exe -p`, Modell Haiku, keine Werkzeuge außer Lesen des Fotos) | Zählt gegen das Claude-Abo des Server-PCs, gemeinsam mit dem KI-Bot. Pro Auftrag ein kurzer Haiku-Aufruf |
| `api` | API-Key mit eigenem Budget | Etwa 0,05 Cent pro Auftrag mit Haiku, 1–2 Cent mit Opus. Ausgabenlimit in der Claude Console setzen |
| `auto` (Standard) | `api`, wenn ein Key eingetragen ist, sonst `cli` | – |

Empfehlung: Starte mit `cli`, weil es schon eingerichtet ist. Die Tageslimits (`JOBS_PER_IP_PER_DAY`, `JOBS_TOTAL_PER_DAY`) begrenzen den Verbrauch. Wenn die Seite viele Besucher bekommt, ist ein API-Key mit festem Budget der saubere Weg, denn dann teilt sich der 3D-Server das Kontingent nicht mehr mit dem KI-Bot und deiner eigenen Nutzung.

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
   zu fragen. Der neue Dienst lauscht nur auf 127.0.0.1.
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
   einen freien Port zwischen 8091 und 8099 vor.
4. Wie werden ki-bot.js und sync-github.js gestartet? Prüfe MCSManager (Instanzen in
   C:\MinecraftHosting\panel), die Aufgabenplanung (Get-ScheduledTask, nur Aufgaben, die nicht von Microsoft
   stammen) und die Autostart-Ordner. Unter welchem Windows-Benutzer laufen sie?
5. Vorhanden? git, python (Version), winget, Blender, cloudflared, tailscale.
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
   Lies danach repo\3d-server\README.md und repo\3d-server\app.py.
2. In repo\3d-server eine venv anlegen (py -3.12 -m venv .venv) und requirements.txt installieren.
3. repo\3d-server\.env aus .env.example erstellen mit:
   DEMO_MODE=1 (vorerst!), JOB_WORKERS=1, CLAUDE_BACKEND=cli,
   BLENDER_BIN='<voller Pfad zu blender.exe aus Prompt 2>' (in einfachen Anführungszeichen),
   BLENDER_THREADS=<Empfehlung aus Prompt 1>, BLENDER_LOW_PRIORITY=1,
   ALLOWED_ORIGINS=https://erschoenfeld2-tech.github.io
   Wenn claude.exe in Prompt 1 nicht automatisch gefunden wurde: CLAUDE_EXE='<Pfad>'.
   Keine Schlüssel eintragen (Regel 4).
4. .env nur für den Windows-Benutzer lesbar machen, unter dem der Dienst laufen soll:
   icacls .env /inheritance:r /grant:r "<Benutzer>:(R,W)"
5. Wenn der Port aus Prompt 1 nicht 8095 ist: Umgebungsvariable S3D_PORT für diesen Benutzer setzen
   ([Environment]::SetEnvironmentVariable('S3D_PORT','<Port>','User')).

Prüfung am Ende: .venv\Scripts\python -c "import fastapi, anthropic, PIL; print('ok')" und
icacls .env (nur die Rechte, nicht den Inhalt).
```

## Prompt 4 – Testen, ohne Guthaben zu verbrauchen

```text
Teste den 3D-Server, ohne Meshy-Guthaben zu verbrauchen. Beobachte dabei, dass Minecraft weiterläuft.

Teil A – Demo-Modus (DEMO_MODE=1):
1. Starte im Ordner repo\3d-server testweise im Vordergrund:
   .venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port <Port>
2. In einer zweiten PowerShell: Invoke-RestMethod http://127.0.0.1:<Port>/api/health
3. Auftrag anlegen: curl.exe -s -F "description=Testvase" -F "size_mm=60" http://127.0.0.1:<Port>/api/jobs
   Status unter /api/jobs/<id> abfragen bis state "done", dann /api/jobs/<id>/file?format=3mf und
   ?format=stl herunterladen. Prüfen: 3MF ist ein gültiges ZIP, STL-Größe = 84 + 50 × Dreiecke.
4. Im Browser http://127.0.0.1:<Port>/3d/ öffnen: Seite erscheint im Skeison-Design.
5. Testserver beenden (nur diesen Prozess!).

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

## Prompt 5 – Claude lokal prüfen (ein kurzer Haiku-Aufruf)

```text
Prüfe, ob der 3D-Server das lokal angemeldete Claude Code nutzen kann (CLAUDE_BACKEND=cli).
Führe GENAU EINEN Testaufruf aus, unter dem Windows-Benutzer, unter dem auch der Dienst laufen wird:
cd repo\3d-server
.venv\Scripts\python -c "import logging,claude_step as c; logging.basicConfig(level=logging.INFO); print(c.backend()); print(c.refine('Eine kleine Eule als Stifthalter, etwa 10 cm hoch', [], '.'))"
Erwartet: "cli" und ein JSON mit meshy_prompt (Englisch), size_mm 100, name und hint.
Wenn "Not logged in" kommt: Mir sagen, dass ich die Anmeldung wie beim KI-Bot einmal selbst erledige
(C:\MinecraftHosting\tools\ki-login.bat, dort /login und dann /exit). Danach den Test einmal wiederholen.
Wenn eine Option von claude.exe nicht erkannt wird (andere Version): Fehlermeldung zeigen, in claude_step.py
(_refine_cli) eine Lösung vorschlagen und auf mein OK warten.
```

## Prompt 6 – Automatisch starten

```text
Richte den automatischen Start des 3D-Servers ein, auf DEMSELBEN Weg wie beim KI-Bot (Ergebnis aus Prompt 1)
und unter demselben Windows-Benutzer, damit die Claude-Anmeldung gilt. Das Startskript ist
repo\3d-server\start-3d-server.bat (lauscht nur auf 127.0.0.1, schreibt nach data\logs\server.log).

- Wenn der KI-Bot über MCSManager läuft: Erkläre mir Schritt für Schritt, wie ich im MCSManager-Webpanel
  eine neue Instanz "3D-Druck" (allgemeine Anwendung, Startbefehl = die .bat, Arbeitsordner = repo\3d-server,
  Autostart an, Neustart bei Absturz an) anlege. Ändere die Konfiguration von MCSManager nicht selbst.
- Wenn er über die Aufgabenplanung läuft: Lege eine Aufgabe "Skeison 3D-Druck" an (Auslöser: bei Anmeldung
  dieses Benutzers und beim Start, Aktion: die .bat, "Bei Fehler neu starten" alle 1 Minute, beliebig oft,
  keine Laufzeitbegrenzung, Batterie- und Leerlaufbedingungen aus). Wenn "Unabhängig von der Anmeldung
  ausführen" nötig ist, gebe ich das Passwort selbst in der Aufgabenplanung ein, nicht du.
- Sonst: Schlag den passenden Weg vor und warte auf mein OK.

Prüfung am Ende: Dienst gestartet, Invoke-RestMethod http://127.0.0.1:<Port>/api/health antwortet,
und Get-Process zeigt, dass Minecraft, MCSManager und KI-Bot weiterhin laufen.
```

## Prompt 7 – Öffentlich per HTTPS erreichbar machen (Tunnel)

Die Webseite auf GitHub Pages braucht eine **HTTPS-Adresse** für den Server. Ein Tunnel baut die Verbindung von innen nach außen auf. Wähle **A**, wenn du eine eigene Domain bei Cloudflare hast, sonst **B**.

```text
Mach den 3D-Server (127.0.0.1:<Port>) über einen Tunnel per HTTPS erreichbar. Keine Portfreigabe, keine
Firewall-Änderung. Ich habe mich für Variante <A oder B> entschieden.

Variante A – Cloudflare Tunnel (eigene Domain bei Cloudflare, z. B. 3d.<domain>):
1. cloudflared installieren (winget install --id Cloudflare.cloudflared -e, nach meinem OK).
2. Anmelden: cloudflared tunnel login (öffnet den Browser, die Anmeldung mache ich).
3. Tunnel "skeison-3d" anlegen, DNS-Eintrag 3d.<domain> setzen, config.yml mit ingress
   3d.<domain> -> http://127.0.0.1:<Port> und danach http_status:404.
4. Als Windows-Dienst installieren (cloudflared service install), damit er mit Windows startet.
5. In repo\3d-server\.env CLIENT_IP_HEADER=cf-connecting-ip setzen und den 3D-Dienst neu starten
   (nur diesen, auf dem Weg aus Prompt 6).

Variante B – Tailscale Funnel (keine eigene Domain nötig, Adresse https://<pc>.<tailnet>.ts.net):
1. Tailscale installieren (winget install --id Tailscale.Tailscale -e, nach meinem OK), anmelden mache ich.
2. Funnel muss ich in der Tailscale-Admin-Konsole erlauben; sag mir, wo.
3. tailscale funnel --bg <Port>, Adresse ausgeben.
4. Mit einem Testaufruf prüfen, in welchem Header die echte Besucher-IP ankommt (z. B. kurz in
   data\logs\server.log), und CLIENT_IP_HEADER in .env entsprechend setzen. 3D-Dienst neu starten.

Für beide: ALLOWED_ORIGINS in .env bleibt https://erschoenfeld2-tech.github.io (plus die Tunnel-Adresse, falls
ich die Seite auch direkt darüber öffnen will).

Prüfung am Ende (von außen, z. B. über curl.exe vom PC aus an die öffentliche Adresse):
curl.exe -s https://<adresse>/api/health
curl.exe -s -I -H "Origin: https://erschoenfeld2-tech.github.io" https://<adresse>/api/health
(der zweite Aufruf muss access-control-allow-origin zeigen)
```

## Prompt 8 – Echtbetrieb einschalten (verbraucht Meshy-Guthaben)

> Vorher selbst eintragen: `notepad C:\MinecraftHosting\3d-druck\repo\3d-server\.env`, dort `MESHY_API_KEY` setzen und `DEMO_MODE=0`. Optional `ACCESS_CODE`, solange nur du testest. Einen `ANTHROPIC_API_KEY` nur eintragen, wenn du statt des Abos die API nutzen willst.

```text
Ich habe in repo\3d-server\.env den Meshy-Key eingetragen und DEMO_MODE=0 gesetzt. Gib keine Schlüssel aus.
1. Starte nur den 3D-Dienst neu und prüfe /api/health: "demo" false, "meshy" true, "claude" "cli" (oder "api").
2. Starte GENAU EINEN echten Auftrag:
   curl.exe -s -F "description=kleine Eule als Stifthalter" -F "size_mm=70" http://127.0.0.1:<Port>/api/jobs
   (mit -H "X-Access-Code: ..." aus der .env, falls ACCESS_CODE gesetzt ist, ohne den Code anzuzeigen)
   Status alle 10 Sekunden abfragen und die Stufen zeigen. Währenddessen CPU-Last von java und blender beobachten.
3. Nach "done": result-JSON zeigen (Größe, Dreiecke, watertight) und die Claude-Zeile aus data\logs\server.log.
4. Bei Fehlern: Log lesen, Ursache erklären, Lösung vorschlagen, auf mein OK warten.
```

## Prompt 9 – Seite mit dem Server verbinden (im Repo, z. B. auf deinem PC)

```text
Verbinde die Seite site/3d/ mit dem 3D-Server unter https://<adresse aus Prompt 7>:
1. Setze in site/3d/config.js: window.SKEISON_3D_API = "https://<adresse>";
2. Neuer Branch, Commit, Pull Request. Nach dem Merge https://erschoenfeld2-tech.github.io/Skeison_Web/3d/
   öffnen: Der Hinweis "Server nicht erreichbar" muss verschwunden sein.
Optional: Auf der Startseite (site/index.html bzw. main.js) einen Link auf 3d/ ergänzen, im Stil der bestehenden
Karten. Zeig mir den Diff, bevor du committest.
```

## Prompt 10 – Wartung

```text
Richte für den 3D-Server eine einfache Wartung ein (nur innerhalb von C:\MinecraftHosting\3d-druck und
mit eigener geplanter Aufgabe, bestehende Aufgaben nicht anfassen):
1. Health-Check alle 5 Minuten (PowerShell-Skript + geplante Aufgabe "Skeison 3D-Druck Check"):
   Antwortet http://127.0.0.1:<Port>/api/health zweimal hintereinander nicht, den 3D-Dienst auf dem Weg aus
   Prompt 6 neu starten und eine Zeile in data\logs\health.log schreiben.
2. Logs: Ist data\logs\server.log größer als 20 MB, auf die letzten 5000 Zeilen kürzen.
3. Lege C:\MinecraftHosting\3d-druck\WARTUNG.md an: Logs ansehen, Dienst neu starten, Update
   (cd repo; git pull; .venv\Scripts\pip install -r 3d-server\requirements.txt; Dienst neu starten),
   Blender aktualisieren (BLENDER_BIN anpassen), Tageslimits ändern (JOBS_PER_IP_PER_DAY, JOBS_TOTAL_PER_DAY),
   zwischen CLAUDE_BACKEND=cli und api wechseln.
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
