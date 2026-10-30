# Skeison Web

Hauptwebseite (GitHub Pages, Ordner `site/`): Übersicht aller Projekte und Seiten. Unterseiten: Wunschliste, Gaming-Profil und – als Teil des Gaming-Profils – der Cobblemon Server.

| Pfad | Inhalt |
| --- | --- |
| `site/index.html`, `main.css`, `main.js` | Hauptseite: Wunschliste (neu), Hausmesse mit Countdown, Projekte (mit Kurslot-Chart), Gaming-Teaser. `main.css` enthält auch die gemeinsame Basis der Unterseiten |
| `site/gaming/` | Gaming-Profil: Cobblemon-Ankündigung, 3D-Skin, Steam, Discord, Server-Karte |
| `site/cobblemon/` | Cobblemon-Server-Seite (Status, Zeitplan, Ranglisten, Whitelist) inkl. `data/`, `download/`, `announcements.json` |
| `site/wunschliste/` | Wunschliste für Freunde & Familie: Konten, Freunde per `Name#CODE`, private Rollen/Tags, Gruppen, Listen mit 5 Designs, Reservieren |
| `site/skin/skeison.png` | Minecraft-Skin für die 3D-Ansicht |
| `site/assets/fx.css`, `fx.js` | Gemeinsame Effekte aller Seiten: Navigation, Pixel-Partikel im Hintergrund, Scroll-Animationen, rollender Countdown, Toast |
| `site/assets/skinview3d.*` | skinview3d (MIT-Lizenz) |
| `server/kubejs/server_scripts/` | KubeJS-Skripte für den Minecraft-Server (z. B. `nicknames.js`: `/nick` für Admins) |
| `supabase/` | Datenbank-Schema (`whitelist.sql`, `wunschliste.sql`) und Edge Functions |

## Anpassen
- **Discord:** Der Einladungslink steht in `site/gaming/index.html` (`discordLink`) und in der Fußzeile von `site/index.html`, der Code für die Mitgliederzahlen in `site/gaming/gaming.js` (`DISCORD_INVITE`) und der Support-Link in `site/wunschliste/` (`DISCORD` in `app.js`, Texte in `index.html`).
- **Skin:** `site/skin/skeison.png` austauschen (64×64-PNG, z. B. von NameMC oder minecraft.net).
- **Cobblemon-Ankündigung:** Text in `site/gaming/index.html`, Startzeit als `START` in `site/gaming/gaming.js` und `COBBLEMON_START` in `site/main.js`.
- **Hausmesse:** Termin in `site/main.js` bei `HAUSMESSE` (deutsche Zeit). Nur ein Datum (`'2026-11-24'`) gilt für den ganzen Tag, mit Uhrzeit (`start`/`end`) zählt der Countdown bis Messebeginn. Während der Messe erscheint „Die Hausmesse läuft“. Der Stand-Link steht in `site/index.html`.
- **Projekte:** Eigene Texte, Untertitel und Stichworte stehen in `site/main.js` bei `PROJECTS`. Weitere öffentliche Repos erscheinen automatisch. `chart` zeigt bei einem Projekt die Kurslot-Vorschau für das angegebene Symbol.
- **Direktlink zur Bewerbung:** `cobblemon/#bewerben` öffnet das Bewerbungsformular sofort.
- **Cobblemon-Wochen:** Woche 1 ist die Woche des Serverstarts (Mo–So); Wochensieger aus Wochen davor werden ausgeblendet. Das Datum einer Woche erscheint per Klick auf „Woche N“.
- **Alle Statistiken:** `tools/sync-github.js` exportiert zusätzlich sämtliche Minecraft-Statistiken der Welt (`world/stats/*.json`, Namen aus `usercache.json`) als `stats.json` in den Branch `data`. Die Welt wird unter `MC_ROOT` automatisch gesucht (Ordner mit `level.dat` und `stats/`, der zuletzt geänderte gewinnt); ein fester Pfad geht per Umgebungsvariable `MC_STATS_DIR`. Nach einer Änderung am Skript muss es auf dem Server-PC neu gestartet werden.
- **Animationen:** Elemente mit `data-reveal` blenden beim Scrollen ein, Kinder von `data-stagger` nacheinander. Bei „Bewegung reduzieren“ im Betriebssystem sind alle Animationen aus.
- **GitHub-Daten:** Sprache, letzte Änderung und Live-Link kommen live über die GitHub-API (öffentliche Repos von `erschoenfeld2-tech`). „Live ansehen“ erscheint, wenn beim Repo eine Website (Feld „Website“ in den Repo-Einstellungen) eingetragen oder GitHub Pages aktiv ist.
- **Steam:** `tools/fetch-steam.js` erzeugt beim Deploy (und alle 6 Stunden) `site/steam.json`. Der letzte erfolgreiche Stand wird im Workflow zwischengespeichert und weiter angezeigt, wenn Steam einen Abruf ablehnt.
  Steam blockt die öffentliche Profil-Ansicht für GitHub-Server meist (Fehler 429). Zuverlässig wird es mit einem kostenlosen API-Schlüssel:
  1. Auf https://steamcommunity.com/dev/apikey einen Schlüssel anlegen (Domain z. B. `erschoenfeld2-tech.github.io`).
  2. Im Repo unter *Settings → Secrets and variables → Actions* ein Secret `STEAM_API_KEY` mit dem Schlüssel anlegen.
  3. Unter *Actions → Deploy GitHub Pages → Run workflow* einmal starten.
  In den Steam-Datenschutzeinstellungen müssen Profil und Spieldetails auf „Öffentlich“ stehen.

## Wunschliste (`site/wunschliste/`)
Läuft komplett über das Supabase-Projekt `skeison-whitelist`; die Seite selbst bleibt statisch auf GitHub Pages.
- **Konten:** Supabase Auth. Passwörter liegen nur als Hash bei Supabase, nie im Repo. Registriert wird über die Edge Function `wl-signup` (legt das Konto direkt bestätigt an, es wird keine Mail verschickt).
- **Nur mit Einladung registrieren:** Im Supabase-Dashboard unter *Edge Functions → Secrets* ein Secret `WL_INVITE_CODE` anlegen. Dann fragt die Registrierung nach diesem Code.
- **Rechte:** stehen in `supabase/wunschliste.sql` (Row Level Security). Man sieht nur sich selbst und bestätigte Freunde; Listen sind privat, für alle Freunde oder für ausgewählte Gruppen/Personen freigegeben; Rollen, Tags und Gruppen sieht nur, wer sie angelegt hat. Reservierungen laufen nur über Datenbank-Funktionen, der Besitzer einer Liste sieht sie nie (Überraschungsschutz).
- **Produktvorschau:** Die Edge Function `wl-link-preview` liest Titel, Bild und Preis aus Produktseiten (Open Graph, JSON-LD). Manche Shops (z. B. Amazon) blocken das zeitweise, dann trägt man die Angaben selbst ein.
- **Designs:** Polarlicht, Geschenkpapier, Pixel-Inventar (Schriften Press Start 2P und VT323 unter OFL in `site/assets/fonts/`), Concept Store, Magazin. Sie stehen in `site/wunschliste/style.css` unter `[data-theme="…"]`; ein neues Design braucht dort einen Block und einen Eintrag in `THEMES` in `app.js` sowie in den `check`-Bedingungen in `wunschliste.sql`.
- **Passwort vergessen:** Nutzer melden sich im Discord bei der Rolle @Admin oder bei Skeison. Ein Admin setzt das Passwort auf der Seite unter *Admin* zurück: entweder mit einem zufälligen Einmal-Passwort oder mit einem Standardpasswort. Beim nächsten Anmelden muss der Nutzer ein eigenes Passwort festlegen (Edge Function `wl-account`).
- **Admin werden:** Erst ganz normal registrieren, dann im Supabase-Dashboard im SQL Editor ausführen (E-Mail anpassen):
  `insert into public.wl_admins select id from auth.users where email = 'deine@mail.de';`
  Danach erscheint nach dem nächsten Laden der Seite der Menüpunkt *Admin*. Admins sehen alle Konten mit Kennzahlen, setzen Passwörter zurück und können Konten löschen (Admin-Konten nicht).

## Minecraft-Server: Spitznamen (`/nick`)
`server/kubejs/server_scripts/nicknames.js` nach `<Serverordner>/kubejs/server_scripts/` kopieren und den Server neu starten (KubeJS ist im Modpack enthalten, die Spieler müssen nichts aktualisieren).

| Befehl | Wirkung |
| --- | --- |
| `/nick <Spieler> <Name>` | Anzeigename im Chat, in der Tab-Liste und in Servernachrichten; Farbcodes mit `&` (z. B. `&aGrün`), max. 32 Zeichen |
| `/nick <Spieler> reset` | echter Name wieder |
| `/nicks` | alle Spitznamen mit echtem Namen |

Nur für Operatoren (`/op <Name>`). Das Namensschild über dem Kopf zeigt weiter den echten Namen. Fehler stehen in `logs/kubejs/server.log`.
