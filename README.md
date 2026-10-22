# Skeison Web

Hauptwebseite (GitHub Pages, Ordner `site/`) mit dem Cobblemon Server als Unterseite.

| Pfad | Inhalt |
| --- | --- |
| `site/index.html`, `main.css`, `main.js` | Hauptseite: Ankündigung, 3D-Skin, Discord, GitHub-Projekte |
| `site/cobblemon/` | Cobblemon-Server-Seite (Status, Zeitplan, Ranglisten, Whitelist) inkl. `data/`, `download/`, `announcements.json` |
| `site/skin/skeison.png` | Minecraft-Skin für die 3D-Ansicht |
| `site/assets/fx.css`, `fx.js` | Gemeinsame Effekte beider Seiten: Navigation, Pixel-Partikel im Hintergrund, Scroll-Animationen, rollender Countdown, Toast |
| `site/assets/skinview3d.*` | skinview3d (MIT-Lizenz) |

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
