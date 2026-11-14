@echo off
rem Startet den 3D-Druck-Server (siehe README.md). Laeuft nur auf diesem PC (127.0.0.1), nach aussen geht es ueber den Tunnel.
rem Port per Umgebungsvariable S3D_PORT aenderbar (Standard 8095; 8090 ist das Admin-Panel).
cd /d "%~dp0"
if "%S3D_PORT%"=="" set S3D_PORT=8095
if not exist ".venv\Scripts\python.exe" (echo .venv fehlt - siehe SERVER-SETUP.md, Prompt 3 & pause & exit /b 1)
if not exist "data\logs" mkdir "data\logs"
".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port %S3D_PORT% --proxy-headers --forwarded-allow-ips 127.0.0.1 >> "data\logs\server.log" 2>&1
