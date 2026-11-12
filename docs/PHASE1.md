# Phase 1 : audit, sécurité et stabilisation

## Corrections

| N° | Problème | Gravité | Correction | Fichier |
| --- | --- | --- | --- | --- |
| 1 | Expressions régulières avec antislashs doublés : les lettres `u`, `f`, `0`, `1`, les majuscules et les chiffres des noms de fichiers étaient remplacés par `_` ; caractères de contrôle et NUL non filtrés | Critique | Expressions corrigées + 8 tests | `security/paths.js` |
| 2 | Code de jumelage réutilisable pendant 5 min, sans limite de tentatives | Élevée | Usage unique, blocage de l'IP après 8 échecs (10 min) | `services/pairingService.js`, `security/rateLimiter.js` |
| 3 | Routes `/api/local/*` accessibles depuis un site web malveillant (DNS rebinding, requêtes d'un autre site) : arrêt du serveur, jumelage | Élevée | Contrôle des en-têtes `Host` et `Origin` | `middleware/auth.js` |
| 4 | Appareils jumelés sans expiration | Moyenne | Expiration après 30 jours d'inactivité (`TRANSFERT_DEVICE_TTL_DAYS`) | `services/deviceService.js` |
| 5 | Deux transferts du même nom finalisés en même temps pouvaient s'écraser ; double finalisation possible | Élevée | Verrou par dossier cible et par transfert | `services/uploadService.js` |
| 6 | Fichiers `.part` abandonnés jamais supprimés | Moyenne | Nettoyage au démarrage puis toutes les heures (24 h) | `services/uploadService.js`, `server.js` |
| 7 | Dossier de données partageable (exposait `devices.json`) | Élevée | Refus du partage du dossier de données, de ses parents et enfants | `services/settingsService.js` |
| 8 | JSON corrompu après coupure de courant : erreur 500 permanente | Moyenne | Fichier mis de côté, valeur par défaut, erreur journalisée | `services/jsonStore.js` |
| 9 | Renommage atomique pouvant échouer sous Windows (antivirus) | Faible | Nouvelles tentatives | `services/jsonStore.js` |
| 10 | Coupure Wi-Fi pendant un bloc = erreur 500 | Moyenne | Interruption journalisée sans erreur ; reprise à la position confirmée | `app.js` |
| 11 | Pas d'espace disque vérifié, pas de journal | Moyenne | Contrôle d'espace (HTTP 507), journal `data/logs/server.log` avec rotation, jetons masqués | `logger.js` |

## Limites restantes (documentées, non corrigées en phase 1)

- Le trafic circule en HTTP clair sur le Wi-Fi local (traité en phase 6 avec TLS).
- Une personne ayant déjà accès en écriture au dossier partagé pourrait tenter un remplacement par lien symbolique entre la vérification et l'écriture (fenêtre très courte, exige un accès local).
- Le SHA-256 d'un fichier du PC est calculé en entier avant le téléchargement : lent pour les très gros fichiers (traité en phase 2).
- Les liens de téléchargement ne sont pas liés à l'appareil (10 minutes, 192 bits aléatoires).
- Pas de CSP sur l'interface web (non testable sans build complet).
- Le QR code affiché sur le PC se renouvelle après chaque utilisation : un second téléphone doit attendre le nouveau QR (quelques secondes).

## Exécution des tests

```
cd desktop-server
npm ci
npm test
```
