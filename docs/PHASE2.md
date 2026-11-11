# Phase 2 : gros fichiers et gestion avancée

## Ce qui existait déjà (conservé)
Envoi par blocs avec reprise dans une même session, pause/reprise/annulation à l'envoi, SHA-256, pourcentage et vitesse, file de plusieurs fichiers, téléchargement en flux sans tout charger en mémoire (navigateurs avec sélecteur de fichier).

## Ajouts
| Fonction | Détail | Fichiers |
| --- | --- | --- |
| Taille de bloc configurable et adaptative | Serveur : `TRANSFERT_MAX_CHUNK_MB` (1 à 64, 16 par défaut), annoncé par `/api/info`. Client : automatique (double sous 1 s, divise par 2 au-delà de 5 s, plancher 256 Ko) ou valeur fixe dans Paramètres | `config.js`, `publicRoutes.js`, `transferSettings.ts`, `uploader.ts`, `PhoneSettingsPage.tsx` |
| Reprise automatique après redémarrage de l'app ou du téléphone | Une demande d'envoi identique (même appareil, fichier, destination) reprend la session existante à l'octet déjà reçu (24 h) | `uploadService.js` |
| Réessayer après un échec | Bouton « Reprendre » sur un transfert en échec | `useUploadQueue.ts`, `UploadQueue.tsx` |
| 2 envois simultanés | Les autres fichiers attendent leur tour | `useUploadQueue.ts` |
| Vitesse lissée et temps restant | Moyenne mobile, « Environ 1 min 40 s » | `uploader.ts`, `api.ts`, `UploadQueue.tsx` |
| Téléchargement reprenable | Requêtes `Range` après une coupure (6 essais), pause, annulation, nouveau lien si l'ancien expire, SHA-256 avant enregistrement définitif | `download.ts`, `PhoneTransferPage.tsx` |
| Gros fichiers sans sélecteur (Chrome Android) | ≤ 256 Mo : assemblage en mémoire vérifié. Au-delà : téléchargement confié au navigateur (écriture directe, sans vérification SHA-256 dans la page) | `download.ts` |
| Cache SHA-256 des fichiers du PC | Évite de relire un fichier de plusieurs Go à chaque téléchargement | `hashCache.js`, `deviceRoutes.js` |
| Historique des téléchargements repris | Enregistré à la dernière plage | `downloadRoutes.js` |

## Limites connues
- Le choix du dossier de destination sur Android et l'écriture directe de très gros fichiers avec vérification exigent l'application native (phase 3).
- Le premier téléchargement d'un fichier de plusieurs Go du PC attend le calcul de son SHA-256 (ensuite mis en cache).
- Le temps de calcul de l'empreinte avant envoi (côté téléphone) n'est pas encore accéléré.
