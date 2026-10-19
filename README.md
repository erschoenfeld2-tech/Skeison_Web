# Skeison Web

Hauptwebseite (GitHub Pages, Ordner `site/`) mit dem Cobblemon Server als Unterseite.

| Pfad | Inhalt |
| --- | --- |
| `site/index.html`, `main.css`, `main.js` | Hauptseite: Ankündigung, 3D-Skin, Discord, GitHub-Projekte |
| `site/cobblemon/` | Cobblemon-Server-Seite (Status, Zeitplan, Ranglisten, Whitelist) inkl. `data/`, `download/`, `announcements.json` |
| `site/skin/skeison.png` | Minecraft-Skin für die 3D-Ansicht |
| `site/assets/` | skinview3d (MIT-Lizenz) |

## Anpassen
- **Discord:** In `site/index.html` den Link `https://discord.gg/PLATZHALTER` durch die echte Einladung ersetzen.
- **Skin:** `site/skin/skeison.png` durch die echte 64×64-Skin-Datei ersetzen (aktuell ein nachgebauter Platzhalter). Den Skin gibt es auf minecraft.net unter „Profil“.
- **Ankündigung:** Text in `site/index.html`, Startzeit als `START` in `site/main.js`.
- **GitHub-Projekte:** werden live über die GitHub-API geladen (zuletzt aktualisierte, öffentliche Repos von `erschoenfeld2-tech`).
