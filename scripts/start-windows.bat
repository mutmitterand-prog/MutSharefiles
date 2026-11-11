@echo off
setlocal
chcp 65001 >nul
title TRANSFERT - Serveur
cd /d "%~dp0\.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Lancez d'abord scripts\install-windows.bat.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo L'interface n'est pas construite. Lancez d'abord scripts\install-windows.bat.
  pause
  exit /b 1
)

echo Demarrage de TRANSFERT. Ne fermez pas cette fenetre pendant les transferts.
echo Pour arreter le serveur, lancez scripts\stop-windows.bat.
echo.
cd desktop-server
node src/server.js
pause
