# TRANSFERT

Transfert de fichiers entre un PC Windows et un téléphone Android, sur le réseau Wi-Fi local. Aucun fichier ne transite par Internet, et aucun service cloud n'est utilisé.

## Démarrage rapide

1. Installez Node.js 20.10 ou plus récent (https://nodejs.org).
2. Extrayez le ZIP, puis double-cliquez sur `scripts\install-windows.bat`.
3. Double-cliquez sur `scripts\start-windows.bat` et ouvrez l'adresse affichée dans la fenêtre du serveur (l’adresse affichée par le serveur (port attribué automatiquement)).
4. Scannez le QR code avec le téléphone (même Wi-Fi).
5. Pour arrêter : `scripts\stop-windows.bat`.

## Documentation

- `docs/INSTALLATION.md` : prérequis, installation, commandes exactes, dépannage.
- `docs/WINDOWS.md` : pare-feu Windows, adresse du PC, connexion du téléphone.
- `docs/ANDROID.md` : utilisation sur Android, limites V1, évolution vers l'application native.
- `docs/ARCHITECTURE.md` : structure du code, jumelage, transferts, sécurité.
- `docs/TESTS.md` : tests exécutés et tests restant à faire sur de vrais appareils.
- `android/README.md` : préparation de l'intégration native (Capacitor, SAF).

## Fonctionnalités V1

- Jumelage par QR code à usage temporaire (5 minutes), accepté sur le PC.
- Envoi dans les deux sens, par blocs, avec progression, vitesse et taille restante.
- Vérification SHA-256, gestion des doublons, annulation et reprise.
- Parcours des dossiers partagés depuis le téléphone, historique des transferts.
- Mode sombre par défaut et mode clair, interface en français.

## Limites de la V1

- Transfert de dossiers entiers : non implémenté.
- Choix du dossier de destination sur le téléphone : non implémenté.
- Application native Android (APK) : non produite ; la V1 est une application web installable.
- Les tests sur vrais appareils restent à faire (voir `docs/TESTS.md`).

## Commandes

- `npm run typecheck` : vérification des types de l'interface.
- `npm run build` : construction de l'interface dans `dist/`.
- `npm --prefix desktop-server test` : tests d'intégration du serveur.
