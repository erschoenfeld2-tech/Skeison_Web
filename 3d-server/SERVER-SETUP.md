# 3D-Druck – Server einrichten mit einer KI

Diese Anleitung besteht aus **fertigen Prompts**. Du kopierst sie nacheinander in Claude Code auf deinem Server, und die KI richtet alles ein. Jeder Prompt endet mit einer Prüfung, damit du siehst, ob der Schritt geklappt hat.

**Annahmen:** Linux-Server mit Ubuntu 22.04 oder 24.04, Zugang mit `sudo`, mindestens 4 GB RAM (besser 8 GB), etwa 10 GB freier Speicher. Eine (Sub-)Domain wie `3d.deine-domain.de` zeigt per DNS-A-Eintrag auf den Server. Eine Grafikkarte brauchst du nicht.

---

## Vorab: Was „lokale Claude-Instanz“ hier bedeutet

Claude läuft nicht komplett offline auf einem eigenen Server, sondern wird immer über Anthropic aufgerufen. Darum gibt es zwei getrennte Rollen:

| Rolle | Wofür | Verbrauch |
|---|---|---|
| **Claude Code auf dem Server** | Führt die Prompts unten aus und hilft später bei Wartung und Fehlersuche | Nur wenn du selbst damit arbeitest (dein Claude-Abo) |
| **Claude in der Web-App** | Macht aus deutschen Beschreibungen einen guten englischen 3D-Prompt | Ein kleiner Aufruf pro Text-Auftrag, über einen API-Key mit eigenem Budget |

**So spart die App Kontingent:**
- Bei reinen Foto-Aufträgen wird Claude gar nicht aufgerufen.
- Pro Text-Auftrag gibt es genau einen Aufruf, mit Bild höchstens 512 px, kurzer JSON-Antwort und `effort: low`.
- Ohne API-Key läuft die App trotzdem, nur ohne Prompt-Verbesserung.
- **Geschätzte Kosten pro Text-Auftrag:** mit `claude-opus-5-5` etwa 1–2 Cent, mit `claude-haiku-5-5` etwa 0,05 Cent. Umstellen kannst du das in `.env` über `CLAUDE_MODEL`.

> Für die Besucher deiner Webseite immer einen **API-Key** verwenden, nicht deinen persönlichen Claude-Login. In der Claude Console ein monatliches **Ausgabenlimit** setzen.

### Claude Code auf dem Server installieren (einmalig, von Hand)

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Danach im Projektordner `claude` starten und anmelden. Ab dann die Prompts unten einzeln einfügen.

### Woher der Server den Code bekommt

Der Code liegt im Repo `Skeison_Web`: der Server in `3d-server/`, die Oberfläche in `site/3d/`. Der Server klont das Repo in Prompt 3 nach `/opt/skeison-3d`. Updates holst du später mit `git pull`. Schlüssel stehen nur in `3d-server/.env` auf dem Server und landen nie im Repo.

---

## Prompt 1 – Grundsystem absichern

```text
Richte diesen Ubuntu-Server als Basis für eine kleine Web-App ein. Arbeite Schritt für Schritt, zeig mir
jeden Befehl bevor du ihn ausführst, und frag nach, bevor du etwas löschst oder SSH-Einstellungen änderst.

1. System aktualisieren (apt update/upgrade) und unattended-upgrades für Sicherheitsupdates aktivieren.
2. Pakete installieren: python3, python3-venv, python3-pip, nginx, certbot, python3-certbot-nginx, ufw,
   fail2ban, curl, unzip, xz-utils, jq.
3. Einen Systembenutzer "skeison3d" ohne Login-Shell anlegen (für den Dienst), Home /opt/skeison-3d.
4. Firewall ufw: nur OpenSSH, 80 und 443 erlauben, dann aktivieren. Prüfe vorher, dass SSH erlaubt ist,
   damit ich mich nicht aussperre.
5. fail2ban mit Standard-Jail für sshd aktivieren.

Prüfung am Ende: zeig mir `ufw status`, `systemctl is-active fail2ban nginx` und `python3 --version`.
```

## Prompt 2 – Blender ohne Oberfläche installieren

```text
Installiere Blender für den Headless-Betrieb (ohne Bildschirm) auf diesem Server.

1. Lade die aktuelle Blender-LTS-Version (4.5 LTS oder neuer, Linux x64, .tar.xz) direkt von
   https://download.blender.org/release/ herunter. Prüfe die SHA256-Prüfsumme gegen die .sha256-Datei
   im selben Ordner.
2. Entpacke nach /opt/blender (der Ordner soll direkt die Datei /opt/blender/blender enthalten)
   und lege einen Symlink /usr/local/bin/blender an.
3. Installiere die Bibliotheken, die Blender auch im Hintergrundmodus braucht, z. B. libxi6 libxxf86vm1
   libxfixes3 libxrender1 libgl1 libxkbcommon0 libsm6 libice6 libegl1. Falls beim Test eine .so-Datei fehlt,
   installiere das passende Paket nach.
4. Test 1: `blender -b --factory-startup --version`
5. Test 2: Lass Blender im Hintergrund eine UV-Kugel als GLB exportieren:
   blender -b --factory-startup --python-expr "import bpy; bpy.ops.mesh.primitive_uv_sphere_add(); bpy.ops.export_scene.gltf(filepath='/tmp/test.glb')"
   und prüfe, dass /tmp/test.glb existiert und größer als 0 Byte ist.

Prüfung am Ende: Blender-Version und Größe von /tmp/test.glb.
```

## Prompt 3 – App installieren und konfigurieren

```text
Installiere die Web-App "3D-Druck" aus dem Repo https://github.com/erschoenfeld2-tech/Skeison_Web.

1. Klone das Repo (Branch main) nach /opt/skeison-3d, sodass es /opt/skeison-3d/3d-server und /opt/skeison-3d/site gibt.
   Lies danach /opt/skeison-3d/3d-server/README.md und 3d-server/app.py, damit du den Aufbau verstehst.
2. Lege in /opt/skeison-3d/3d-server eine venv an (.venv) und installiere requirements.txt.
3. Erstelle /opt/skeison-3d/3d-server/.env aus .env.example mit diesen Werten:
   DEMO_MODE=1 (vorerst!), DATA_DIR=/opt/skeison-3d/data, BLENDER_MODE=cli,
   BLENDER_BIN=/opt/blender/blender, ALLOWED_ORIGINS=https://erschoenfeld2-tech.github.io,https://<MEINE-DOMAIN>
   Die API-Keys (MESHY_API_KEY, ANTHROPIC_API_KEY) trage ich selbst ein: öffne die Datei NICHT mit
   den Keys in deiner Ausgabe, sondern sag mir nur den Befehl, mit dem ich sie bearbeiten kann
   (sudo nano /opt/skeison-3d/3d-server/.env).
4. Rechte: Alles gehört skeison3d:skeison3d, .env hat chmod 600, /opt/skeison-3d/data existiert und
   ist für skeison3d beschreibbar.

Prüfung am Ende: `sudo -u skeison3d /opt/skeison-3d/3d-server/.venv/bin/python -c "import fastapi, anthropic, PIL; print('ok')"`
und `ls -la /opt/skeison-3d/3d-server/.env` (nur Rechte zeigen, nicht den Inhalt).
```

## Prompt 4 – Testen, ohne Guthaben zu verbrauchen

```text
Teste den 3D-Druck-Server, ohne Meshy- oder Claude-Guthaben zu verbrauchen.

Teil A – Demo-Modus (DEMO_MODE=1 steht in der .env):
1. Starte die App als Benutzer skeison3d testweise im Vordergrund:
   cd /opt/skeison-3d/3d-server && .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
2. In einem zweiten Terminal: curl http://127.0.0.1:8000/api/health
3. Lege per curl einen Auftrag an: POST /api/jobs als multipart mit description="Testvase" und size_mm=60.
   Frage den Status unter /api/jobs/<id> ab, bis state "done" ist, und lade /api/jobs/<id>/file?format=3mf
   und ?format=stl herunter. Prüfe, dass die 3MF eine gültige ZIP-Datei ist und dass die Größe der
   Binär-STL genau 84 + 50 × Dreiecksanzahl Byte beträgt.
4. Beende den Testserver.

Teil B – echtes Blender-Skript mit einer Test-GLB (kostet nichts):
1. Erzeuge mit Blender eine Test-GLB: einen "Suzanne"-Affenkopf (bpy.ops.mesh.primitive_monkey_add),
   exportiert nach /tmp/monkey.glb. Der Affe hat offene Stellen, gut zum Testen.
2. Führe als skeison3d aus:
   /opt/blender/blender -b --factory-startup -noaudio -P /opt/skeison-3d/3d-server/blender/printprep.py -- \
     --in /tmp/monkey.glb --out-dir /tmp/monkey-out --name affe --size 60 --flat-base 1
3. Die letzte Zeile muss mit SKEISON_RESULT beginnen. Prüfe darin: "watertight": true und size_mm ungefähr 60
   an der längsten Kante. Wenn watertight false ist oder ein Fehler kommt, analysiere die Ausgabe,
   behebe das Problem in printprep.py und erkläre mir die Änderung.

Prüfung am Ende: die SKEISON_RESULT-Zeile und die Dateigrößen von model.stl und model.3mf.
```

## Prompt 5 – Als Dienst einrichten (startet automatisch)

```text
Richte den 3D-Druck-Server als systemd-Dienst ein.

1. Erstelle /etc/systemd/system/skeison-3d.service:
   - User/Group skeison3d, WorkingDirectory /opt/skeison-3d/3d-server
   - ExecStart: /opt/skeison-3d/3d-server/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
     --proxy-headers --forwarded-allow-ips 127.0.0.1
   - WICHTIG: genau EIN uvicorn-Worker (keine --workers-Option), weil die Auftragsliste im
     Arbeitsspeicher liegt.
   - Restart=always, RestartSec=3
   - Härtung: NoNewPrivileges=true, PrivateTmp=true, ProtectSystem=strict,
     ReadWritePaths=/opt/skeison-3d/data, ProtectHome=true, MemoryMax=6G (an meinen RAM anpassen)
2. daemon-reload, enable, start.
3. Prüfe, ob Blender unter ProtectSystem=strict funktioniert (Blender schreibt evtl. in ~/.config oder /tmp).
   Falls nicht: Environment=HOME=/opt/skeison-3d/data/home setzen und den Ordner anlegen.

Prüfung am Ende: `systemctl status skeison-3d`, `curl -s http://127.0.0.1:8000/api/health | jq` und
die letzten 20 Zeilen von `journalctl -u skeison-3d`.
```

## Prompt 6 – nginx, HTTPS und Schutz vor Missbrauch

```text
Mach den 3D-Druck-Server über https://<MEINE-DOMAIN> erreichbar.

1. nginx-Site /etc/nginx/sites-available/skeison-3d für server_name <MEINE-DOMAIN>:
   - proxy_pass http://127.0.0.1:8000 für alles
   - client_max_body_size 45M (4 Fotos à 10 MB)
   - proxy_read_timeout 120s
   - WICHTIG gegen IP-Fälschung: proxy_set_header X-Forwarded-For $remote_addr;
     (überschreiben, NICHT $proxy_add_x_forwarded_for), dazu Host und X-Forwarded-Proto setzen
   - Rate-Limit nur für POST /api/jobs: limit_req_zone $binary_remote_addr zone=s3djobs:10m rate=6r/m;
     mit burst=3 nodelay in einer location = /api/jobs
   - Sicherheits-Header: X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin
2. Site aktivieren, `nginx -t`, reload.
3. HTTPS mit certbot --nginx für <MEINE-DOMAIN>, inkl. automatischer Weiterleitung von http auf https.
   Prüfe, dass der automatische Verlängerungs-Timer aktiv ist.

Prüfung am Ende: `curl -s https://<MEINE-DOMAIN>/api/health | jq` und ob https://<MEINE-DOMAIN>/3d/
die Oberfläche (HTML mit "Von der Idee") ausliefert.
```

## Prompt 7 – Echtbetrieb einschalten (verbraucht Guthaben)

> Vorher selbst die Keys eintragen: `sudo nano /opt/skeison-3d/3d-server/.env`, dann `MESHY_API_KEY` und `ANTHROPIC_API_KEY` setzen und `DEMO_MODE=0` stellen. Optional `ACCESS_CODE` setzen, solange nur du testest.

```text
Ich habe in /opt/skeison-3d/3d-server/.env die API-Keys eingetragen und DEMO_MODE=0 gesetzt.
Gib die Keys niemals aus.

1. Starte den Dienst neu und prüfe /api/health: "demo" false, "claude" true, "meshy" true.
2. Starte GENAU EINEN echten Text-Auftrag per curl (description "kleine Eule als Stifthalter",
   size_mm 70). Falls ACCESS_CODE gesetzt ist, lies ihn aus der .env und schick ihn als Header
   X-Access-Code mit, ohne ihn anzuzeigen. Frage den Status alle 10 s ab und zeig mir die Stufen.
3. Nach "done": Zeig mir das result-JSON (Größe, Dreiecke, watertight) und die Logzeile mit dem
   Claude-Tokenverbrauch (journalctl -u skeison-3d | grep "Claude").
4. Bei Fehlern: lies das Journal, finde die Ursache, schlag eine Lösung vor und warte auf mein OK,
   bevor du Code änderst.
```

## Prompt 8 – GitHub-Pages-Seite mit dem Server verbinden (auf deinem PC im Repo Skeison_Web)

Die Seite `site/3d/` ist schon Teil des Repos. Sie muss nur wissen, unter welcher Adresse der Server läuft. Diesen Prompt in Claude Code **auf deinem PC** im Ordner `Skeison_Web` ausführen:

```text
Verbinde die Seite site/3d/ mit meinem 3D-Server unter https://<MEINE-DOMAIN>.
1. Setze in site/3d/config.js: window.SKEISON_3D_API = "https://<MEINE-DOMAIN>";
2. Prüfe per curl, dass https://<MEINE-DOMAIN>/api/health antwortet und den CORS-Header für
   https://erschoenfeld2-tech.github.io zurückgibt (Origin-Header mitschicken).
3. Neuer Branch, Commit, Pull Request. Nach dem Merge: https://erschoenfeld2-tech.github.io/Skeison_Web/3d/
   öffnen und prüfen, dass der Hinweis "Server nicht erreichbar" verschwunden ist.
Optional: Auf der Startseite (site/index.html, main.js PROJECTS) einen Link auf 3d/ ergänzen, im Stil der
bestehenden Karten. Zeig mir den Diff, bevor du committest.
```

## Prompt 9 – Wartung und Überwachung

```text
Richte für den 3D-Druck-Server eine einfache Wartung ein:
1. journald: Logs auf maximal 500 MB begrenzen (SystemMaxUse).
2. Ein täglicher systemd-Timer, der prüft, ob /opt/skeison-3d/data größer als 5 GB ist, und dann
   Auftragsordner löscht, die älter als 2 Tage sind (die App räumt nach 24 h selbst auf, das ist nur
   die Absicherung, z. B. nach einem Neustart).
3. Ein Health-Check alle 5 Minuten (systemd-Timer + curl auf /api/health). Bei zwei Fehlschlägen
   hintereinander Dienst neu starten und ins Journal schreiben.
4. Schreib mir eine kurze Datei /opt/skeison-3d/WARTUNG.md: wie ich Logs ansehe, den Dienst neu starte,
   Blender aktualisiere, die App aktualisiere (neue Dateien, pip install, restart) und das Tageslimit
   (JOBS_PER_IP_PER_DAY) ändere.
```

## Optional – Prompt 10: 3D-Erzeugung komplett auf dem eigenen Server

Meshy ist ein externer Dienst. Wenn du später **alles** selbst hosten willst, brauchst du eine NVIDIA-Grafikkarte mit mindestens etwa 12–16 GB VRAM.

```text
Prüfe, ob dieser Server eine NVIDIA-GPU hat (nvidia-smi) und wie viel VRAM verfügbar ist.
Wenn ja: Bewerte quelloffene Bild-zu-3D-Modelle (z. B. Hunyuan3D-2, TripoSR, TRELLIS) nach Lizenz
(kommerzielle Nutzung erlaubt?), VRAM-Bedarf, Qualität und Geschwindigkeit. Schlag mir eines vor und
beschreibe, wie man in /opt/skeison-3d/3d-server/meshy.py eine zweite Funktion generate_local() ergänzt,
die dieselbe Schnittstelle hat (gibt eine GLB-Datei zurück), umschaltbar über GENERATOR=meshy|local in
der .env. Noch nichts installieren, erst meine Entscheidung abwarten.
```
