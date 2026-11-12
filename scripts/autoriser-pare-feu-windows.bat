@echo off
setlocal
chcp 65001 >nul
title TRANSFERT - Autoriser le pare-feu

rem Demande les droits administrateur si necessaire.
net session >nul 2>nul
if errorlevel 1 (
  echo Demande des droits administrateur...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Autorisation des connexions entrantes de TRANSFERT (ports 8787 a 8807) sur les reseaux prives...
netsh advfirewall firewall delete rule name="TRANSFERT" >nul 2>nul
netsh advfirewall firewall add rule name="TRANSFERT" dir=in action=allow protocol=TCP localport=8787-8807 profile=private,domain
if errorlevel 1 (
  echo Echec de l'ajout de la regle.
) else (
  echo Regle ajoutee. Cela n'affecte pas les autres applications.
  echo Le Wi-Fi du PC doit etre de type "Reseau prive" : Parametres ^> Reseau et Internet ^> Wi-Fi ^> Proprietes.
)
pause
