# Skeison Web

Hauptwebseite (GitHub Pages, Ordner `site/`) mit dem Cobblemon Server als Unterseite.

| Pfad | Inhalt |
| --- | --- |
| `site/index.html`, `main.css`, `main.js` | Hauptseite: Ankündigung, 3D-Skin, Discord, GitHub-Projekte |
| `site/cobblemon/` | Cobblemon-Server-Seite (Status, Zeitplan, Ranglisten, Whitelist) inkl. `data/`, `download/`, `announcements.json` |
| `site/skin/skeison.png` | Minecraft-Skin für die 3D-Ansicht |
| `site/assets/` | skinview3d (MIT-Lizenz) |

## Anpassen
- **Discord:** Der Einladungslink steht in `site/index.html` (`discordLink`).
- **Skin:** `site/skin/skeison.png` austauschen (64×64-PNG, z. B. von NameMC oder minecraft.net).
- **Ankündigung:** Text in `site/index.html`, Startzeit als `START` in `site/main.js`.
- **GitHub-Projekte:** werden live über die GitHub-API geladen (zuletzt aktualisierte, öffentliche Repos von `erschoenfeld2-tech`). „Live ansehen“ erscheint, wenn beim Repo eine Website (Feld „Website“ in den Repo-Einstellungen) eingetragen oder GitHub Pages aktiv ist.
