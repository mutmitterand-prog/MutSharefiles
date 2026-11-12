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
4. Ouvrez http://localhost:8787 dans le navigateur du PC.
5. Pour arrêter : double-cliquez sur `scripts\stop-windows.bat`.

## Commandes équivalentes (invite de commandes, dans le dossier du projet)

```
npm install
npm --prefix desktop-server install
npm run build
cd desktop-server
node src/server.js
```

TRANSFERT préfère le port `8787`. Si une autre application l'utilise déjà (par exemple une télécommande), TRANSFERT choisit automatiquement le premier port libre suivant (8788, 8789…) sans toucher à l'autre application, et mémorise ce port dans `data\server.port`. Le port réellement utilisé est affiché sur l'accueil, dans la fenêtre du serveur et dans le QR code. Pour imposer un port, définissez la variable `TRANSFERT_PORT` : dans ce cas aucun autre port n'est essayé. Le fichier `.env.example` sert de modèle : le serveur ne lit pas de fichier `.env` automatiquement.

## Mise à jour

Après un changement du code, relancez `scripts\install-windows.bat` puis `scripts\start-windows.bat`.

## Dépannage rapide

- « Node.js n'est pas installé » : installez Node.js LTS puis rouvrez la fenêtre.
- « L'interface n'est pas construite » : lancez `scripts\install-windows.bat`.
- Le port 8787 est pris par une autre application : rien à faire, TRANSFERT prend un autre port libre. Le message « Le port … est déjà utilisé » n'apparaît que si `TRANSFERT_PORT` impose un port occupé : supprimez alors cette variable.
- Le téléphone n'arrive pas à se connecter : voir `docs/WINDOWS.md` (pare-feu et réseau).
