@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\.."

rem Le port réel est écrit par le serveur après attribution par Windows.
set "PORTFILE=desktop-server\data\server.port"
if defined TRANSFERT_DATA_DIR set "PORTFILE=%TRANSFERT_DATA_DIR%\server.port"
if not exist "%PORTFILE%" (
  echo Aucun fichier de port TRANSFERT : le serveur est probablement déjà arrêté.
  pause
  exit /b 0
)
set /p PORT=<"%PORTFILE%"
if not defined PORT (
  echo Port TRANSFERT invalide. Aucune application ne sera arrêtée.
  pause
  exit /b 1
)
echo Vérification de TRANSFERT sur le port %PORT%...
curl -s http://127.0.0.1:%PORT%/api/info | findstr /c:"TRANSFERT" >nul 2>nul
if errorlevel 1 (
  echo Aucun serveur TRANSFERT ne répond sur ce port. Aucune action effectuée.
) else (
  curl -s -X POST http://127.0.0.1:%PORT%/api/local/shutdown >nul 2>nul
  echo Demande d'arrêt envoyée uniquement à TRANSFERT.
)
pause
