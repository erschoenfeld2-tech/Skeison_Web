@echo off
rem Startet die Daten-Synchronisation nach GitHub (siehe sync-github.js).
"C:\MinecraftHosting\panel\mcsmanager\daemon\node_app.exe" "%~dp0sync-github.js"
