# Installation de TRANSFERT

## Prérequis

- Windows 10 ou Windows 11 (64 bits).
- Node.js version 20.10 ou plus récente, version LTS recommandée (https://nodejs.org). Vérifiez avec `node -v` dans l'invite de commandes.
- Un téléphone Android et l'ordinateur connectés au même réseau Wi-Fi.
- Un navigateur récent sur Android (Chrome, Edge ou Samsung Internet).

## Étapes

1. Récupérez le fichier ZIP du projet et extrayez-le complètement (clic droit, « Extraire tout »). Ne lancez pas les scripts depuis le ZIP.
2. Ouvrez le dossier extrait, puis double-cliquez sur `scripts\install-windows.bat`.
   Ce script installe les dépendances du serveur (`desktop-server`), celles de l'interface (racine du projet) et construit l'interface dans `dist`.
3. Pour démarrer : double-cliquez sur `scripts\start-windows.bat`. Gardez la fenêtre ouverte pendant l'utilisation.
4. Ouvrez l’adresse locale affichée dans la fenêtre du serveur (le port est attribué automatiquement).
5. Pour arrêter : double-cliquez sur `scripts\stop-windows.bat`.

## Commandes équivalentes (invite de commandes, dans le dossier du projet)

```
npm install
npm --prefix desktop-server install
npm run build
cd desktop-server
node src/server.js
```

TRANSFERT essaie d’abord le port 8787 pour conserver les anciennes associations, puis demande automatiquement un port TCP libre si celui-ci est occupé. Le port réellement attribué est mémorisé dans `data\server.port`, puis affiché sur l'accueil et utilisé dans le QR code. Aucun processus externe n'est arrêté ou modifié. Une surcharge `TRANSFERT_PORT` reste possible pour un administrateur, mais elle est facultative.

## Mise à jour

Après un changement du code, relancez `scripts\install-windows.bat` puis `scripts\start-windows.bat`.

## Dépannage rapide

- « Node.js n'est pas installé » : installez Node.js LTS puis rouvrez la fenêtre.
- « L'interface n'est pas construite » : lancez `scripts\install-windows.bat`.
- Le serveur ne démarre pas : vérifiez les journaux et retirez toute surcharge `TRANSFERT_PORT` définie manuellement.
- Le téléphone n'arrive pas à se connecter : voir `docs/WINDOWS.md` (pare-feu et réseau).
