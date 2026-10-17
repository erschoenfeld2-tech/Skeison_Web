@echo off
rem Startet das lokale Whitelist-Admin-Panel und oeffnet es im Browser.
start "" "http://127.0.0.1:8090"
"C:\MinecraftHosting\panel\mcsmanager\daemon\node_app.exe" "%~dp0admin-panel.js"
pause
