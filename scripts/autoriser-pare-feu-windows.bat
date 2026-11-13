@echo off
setlocal EnableExtensions
chcp 65001 >nul
title TRANSFERT - Pare-feu Windows

rem Droits administrateur requis : relance automatique avec la fenetre d'autorisation Windows.
net session >nul 2>&1
if errorlevel 1 (
  echo Demande des droits administrateur...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0\.."
echo Autorisation de TRANSFERT dans le pare-feu Windows (reseaux prives et domaine uniquement)...
netsh advfirewall firewall delete rule name="TRANSFERT - Reseau prive" >nul 2>nul
netsh advfirewall firewall delete rule name="TRANSFERT - Port dynamique" >nul 2>nul
netsh advfirewall firewall delete rule name="TRANSFERT - Ports 8787-8799" >nul 2>nul

rem 1) Programmes : Node.js (start-windows.bat) et l'application installee (TRANSFERT.exe).
for /f "delims=" %%N in ('where node 2^>nul') do call :allow "%%~N"
if exist "%LOCALAPPDATA%\Programs\TRANSFERT\TRANSFERT.exe" call :allow "%LOCALAPPDATA%\Programs\TRANSFERT\TRANSFERT.exe"
if exist "%ProgramFiles%\TRANSFERT\TRANSFERT.exe" call :allow "%ProgramFiles%\TRANSFERT\TRANSFERT.exe"

rem 2) Plage de ports utilisee par TRANSFERT (8787 a 8799) : couvre tous les cas.
netsh advfirewall firewall add rule name="TRANSFERT - Ports 8787-8799" dir=in action=allow protocol=TCP localport=8787-8799 profile=private,domain enable=yes >nul
if errorlevel 1 (echo Echec de l'ajout de la regle de ports.) else (echo Regle ajoutee : ports TCP 8787-8799.)

echo.
echo Profil du reseau Wi-Fi (il doit etre "Private") :
powershell -NoProfile -Command "Get-NetConnectionProfile | Format-Table Name,NetworkCategory -AutoSize"
echo Si le profil est "Public" : Parametres Windows ^> Reseau et Internet ^> Wi-Fi ^> Proprietes ^> Type de profil reseau ^> Prive.
echo.
pause
exit /b 0

:allow
netsh advfirewall firewall add rule name="TRANSFERT - Reseau prive" dir=in action=allow program=%1 protocol=TCP profile=private,domain enable=yes >nul
if errorlevel 1 (echo Echec pour %1) else (echo Regle ajoutee pour %1)
exit /b 0
