@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\.."

rem Le serveur ecrit le port choisi dans desktop-server\data\server.port (8787 si libre, sinon un autre).
set "PORT=8787"
if defined TRANSFERT_PORT set "PORT=%TRANSFERT_PORT%"
set "PORTFILE=desktop-server\data\server.port"
if defined TRANSFERT_DATA_DIR set "PORTFILE=%TRANSFERT_DATA_DIR%\server.port"
if exist "%PORTFILE%" set /p PORT=<"%PORTFILE%"

echo Arret de TRANSFERT sur le port %PORT%...
rem On n'arrete que TRANSFERT : l'autre application qui utilise 8787 n'est pas touchee.
curl -s http://127.0.0.1:%PORT%/api/info | findstr /c:"TRANSFERT" >nul 2>nul
if errorlevel 1 (
  echo Aucun serveur TRANSFERT ne repond sur ce port. Il est peut-etre deja arrete.
) else (
  curl -s -X POST http://127.0.0.1:%PORT%/api/local/shutdown >nul 2>nul
  echo Demande d'arret envoyee.
)
pause
