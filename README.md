# Skeison Web

Hauptwebseite (GitHub Pages, Ordner `site/`) mit dem Cobblemon Server als Unterseite.

| Pfad | Inhalt |
| --- | --- |
| `site/index.html`, `main.css`, `main.js` | Hauptseite: Ankündigung, 3D-Skin, Discord, GitHub-Projekte |
| `site/cobblemon/` | Cobblemon-Server-Seite (Status, Zeitplan, Ranglisten, Whitelist) inkl. `data/`, `download/`, `announcements.json` |
| `site/wunschliste/` | Wunschliste für Freunde & Familie: Konten, Freunde per `Name#CODE`, private Rollen/Tags, Gruppen, Listen mit 5 Designs, Reservieren |
| `site/skin/skeison.png` | Minecraft-Skin für die 3D-Ansicht |
| `site/assets/fx.css`, `fx.js` | Gemeinsame Effekte beider Seiten: Navigation, Pixel-Partikel im Hintergrund, Scroll-Animationen, rollender Countdown, Toast |
| `site/assets/skinview3d.*` | skinview3d (MIT-Lizenz) |
| `supabase/` | Datenbank-Schema (`whitelist.sql`, `wunschliste.sql`) und Edge Functions |

## Anpassen
- **Discord:** Der Einladungslink steht in `site/index.html` (`discordLink`).
- **Skin:** `site/skin/skeison.png` austauschen (64×64-PNG, z. B. von NameMC oder minecraft.net).
- **Ankündigung:** Text in `site/index.html`, Startzeit als `START` in `site/main.js`.
- **Direktlink zur Bewerbung:** `cobblemon/#bewerben` öffnet das Bewerbungsformular sofort.
- **Animationen:** Elemente mit `data-reveal` blenden beim Scrollen ein, Kinder von `data-stagger` nacheinander. Bei „Bewegung reduzieren“ im Betriebssystem sind alle Animationen aus.
- **GitHub-Projekte:** werden live über die GitHub-API geladen (zuletzt aktualisierte, öffentliche Repos von `erschoenfeld2-tech`). „Live ansehen“ erscheint, wenn beim Repo eine Website (Feld „Website“ in den Repo-Einstellungen) eingetragen oder GitHub Pages aktiv ist.
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
- **Designs:** Polarlicht, Geschenkpapier, Pixel-Arcade, Schneekugel, Magazin. Sie stehen in `site/wunschliste/style.css` unter `[data-theme="…"]`; ein neues Design braucht dort einen Block und einen Eintrag in `THEMES` in `app.js` sowie in den `check`-Bedingungen in `wunschliste.sql`.
- **Passwort vergessen:** Ohne eigenen Mailversand (SMTP in Supabase) gibt es keinen Link per Mail. Ein Admin kann im Supabase-Dashboard unter *Authentication → Users* ein neues Passwort setzen.
