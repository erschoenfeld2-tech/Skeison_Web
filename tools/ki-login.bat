@echo off
rem Einmalige Anmeldung von Claude Code fuer den KI-Bot: es oeffnet sich Claude, dort /login eingeben und im Browser anmelden, danach /exit.
for /f "delims=" %%i in ('"C:\MinecraftHosting\panel\mcsmanager\daemon\node_app.exe" -e "console.log(require('C:/MinecraftHosting/tools/ki-bot.js').findClaude()||'')"') do set CLAUDE=%%i
if "%CLAUDE%"=="" (echo claude.exe nicht gefunden & pause & exit /b 1)
echo Starte: %CLAUDE%
"%CLAUDE%"
pause
