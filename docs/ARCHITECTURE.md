# Architecture de TRANSFERT

## Vue d'ensemble

```
Téléphone Android (navigateur / PWA)          PC Windows
┌──────────────────────────┐   HTTP, même Wi-Fi  ┌──────────────────────────────┐
│ Interface React (mobile) │ ◄─────────────────► │ Serveur Node.js + Express    │
│ src/pages/phone          │   /api/device/*     │ desktop-server/src           │
└──────────────────────────┘                     │  routes, services, security  │
                                                 │  stockage local (JSON)       │
Navigateur du PC                                 └──────────────────────────────┘
┌──────────────────────────┐   /api/local/*              ▲
│ Tableau de bord React    │ ◄───────────────────────────┘
│ src/pages/pc            │   (accès limité au PC)
└──────────────────────────┘
```

Le serveur Express sert aussi l'interface compilée (`dist/`) : un seul processus, un seul port.

## Dossiers

- `src/` : interface React + TypeScript + Tailwind (PC et téléphone). Un seul code source, deux parcours selon l'appareil (`src/App.tsx`).
- `src/pages/pc`, `src/pages/phone` : écrans propres à chaque appareil.
- `src/components`, `src/hooks`, `src/services`, `src/types` : composants, hooks, appels réseau et types partagés.
- `desktop-server/src/routes` : routes HTTP (`publicRoutes`, `localRoutes`, `deviceRoutes`, `transferRoutes`, `downloadRoutes`).
- `desktop-server/src/services` : logique métier (jumelage, transferts, historique, dossiers partagés, disque).
- `desktop-server/src/security` : jetons, validation des chemins, hachage SHA-256, erreurs.
- `desktop-server/test` : tests d'intégration du serveur.
- `scripts/` : scripts Windows. `docs/` : documentation. `android/` : préparation de l'intégration native.

Écart avec la structure proposée : l'interface est à la racine du projet et non dans `frontend/`. Ce choix évite de déplacer l'ensemble de la configuration Vite et ne change aucun comportement. Il pourra être modifié en V1.1.

## Jumelage

1. Le PC génère un jeton de jumelage aléatoire valable 5 minutes, et l'encode dans le QR code avec l'adresse IP locale et le port.
2. Le téléphone ouvre le lien, affiche le nom du PC, et envoie une demande avec le nom de l'appareil.
3. Le PC affiche la demande ; la demande expire après 2 minutes et le nombre de demandes en attente est limité.
4. Après acceptation, le serveur remet un jeton d'appareil une seule fois. Seul son empreinte est conservée sur le PC.
5. Le jeton d'appareil est requis sur toutes les routes `/api/device/*`. Révoquer un appareil invalide son jeton immédiatement.

## Transferts

- Les fichiers sont envoyés par blocs (16 Mo maximum par bloc), écrits directement sur le disque : jamais chargés entièrement en mémoire.
- Chaque transfert a un identifiant ; le serveur connaît les blocs déjà reçus, ce qui permet la reprise après coupure.
- Le SHA-256 du fichier complet est vérifié à la fin ; en cas d'écart, le fichier n'est pas validé.
- Les doublons sont gérés explicitement : renommer, remplacer (après confirmation), ou ignorer.
- Les téléchargements vers le téléphone passent par un ticket temporaire (10 minutes) et sont vérifiés côté téléphone.
- La progression est remontée par interrogation régulière (polling), pas par WebSocket en V1.

## Sécurité

- Seuls les dossiers partagés configurés sont accessibles. Les chemins sont normalisés et refusés s'ils sortent du dossier autorisé (protection contre `..`).
- Les routes locales (`/api/local/*`) ne sont accessibles que depuis le PC lui-même.
- Aucun service externe : pas de Supabase, Firebase ni de serveur distant pour les transferts.

## Stockage

Les appareils jumelés, l'historique et les réglages sont stockés en fichiers JSON dans `desktop-server/data` (ou `TRANSFERT_DATA_DIR`). Aucune base de données cloud n'est utilisée.

## Préparation des versions futures

- V1.1 (natif Android) : voir `docs/ANDROID.md`.
- V2 (lecture multimédia à distance) : la route de téléchargement par ticket peut être réutilisée pour le flux vidéo ; aucune lecture distante n'existe en V1.
- V3 (disques OTG) et V4 (accès via Internet) : non commencées ; le serveur n'expose que les dossiers partagés explicitement configurés, ce qui doit rester la règle.
