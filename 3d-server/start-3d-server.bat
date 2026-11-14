@echo off
rem Startet den 3D-Druck-Worker (siehe README.md). Er holt Auftraege aus Supabase und braucht keinen offenen Port.
rem Zugang: .env (SUPABASE_URL, SUPABASE_SERVICE_KEY) oder automatisch tools\admin.config.json wie beim Admin-Panel.
rem S3D_PORT (Standard 8095) dient nur als Sperre gegen doppelten Start; 8090 ist das Admin-Panel.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (echo .venv fehlt - siehe SERVER-SETUP.md, Prompt 3 & pause & exit /b 1)
if not exist "data\logs" mkdir "data\logs"
".venv\Scripts\python.exe" worker.py >> "data\logs\worker.log" 2>&1
