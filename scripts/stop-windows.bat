@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\.."

set "PORT=8787"
if defined TRANSFERT_PORT set "PORT=%TRANSFERT_PORT%"

echo Arret de TRANSFERT sur le port %PORT%...
curl -s -X POST http://127.0.0.1:%PORT%/api/local/shutdown >nul 2>nul
if errorlevel 1 (
  echo Le serveur ne repond pas. Il est peut-etre deja arrete.
) else (
  echo Demande d'arret envoyee.
)
pause
