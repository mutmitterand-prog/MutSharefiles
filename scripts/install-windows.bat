@echo off
setlocal
chcp 65001 >nul
title TRANSFERT - Installation
cd /d "%~dp0\.."

echo.
echo === Installation de TRANSFERT ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Installez la version LTS depuis https://nodejs.org puis relancez ce script.
  pause
  exit /b 1
)

echo Installation des dependances du serveur...
call npm --prefix desktop-server install
if errorlevel 1 goto :fail

echo Installation des dependances de l'interface...
call npm install
if errorlevel 1 goto :fail

echo Construction de l'interface...
call npm run build
if errorlevel 1 goto :fail

echo.
echo Installation terminee. Lancez scripts\start-windows.bat pour demarrer TRANSFERT.
pause
exit /b 0

:fail
echo.
echo L'installation a echoue. Consultez les messages ci-dessus.
pause
exit /b 1
