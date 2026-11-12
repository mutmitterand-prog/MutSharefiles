@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\.."
set "PORTFILE=desktop-server\data\server.port"
if defined TRANSFERT_DATA_DIR set "PORTFILE=%TRANSFERT_DATA_DIR%\server.port"
if not exist "%PORTFILE%" (
  echo TRANSFERT n'est pas demarre ou son port n'est pas encore annonce.
  echo Lancez TRANSFERT puis relancez ce script.
  pause
  exit /b 1
)
set /p PORT=<"%PORTFILE%"
if not defined PORT (echo Port invalide. & pause & exit /b 1)
echo Autorisation du seul port TCP %PORT% utilise actuellement par TRANSFERT...
netsh advfirewall firewall delete rule name="TRANSFERT - Port dynamique" >nul 2>nul
netsh advfirewall firewall add rule name="TRANSFERT - Port dynamique" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain
if errorlevel 1 (echo Echec. Lancez ce script en tant qu'administrateur.) else (echo Regle ajoutee pour le port %PORT% uniquement.)
pause
