# Tests TRANSFERT

Ce document distingue les tests réellement exécutés dans l'environnement de développement, et les tests qui doivent être faits sur un vrai PC Windows et un vrai téléphone Android. Aucun résultat n'est présumé.

## Tests exécutés

| Vérification | Résultat |
| --- | --- |
| `npm run typecheck` (interface) | Réussi |
| `npm run lint` (interface) | Réussi |
| `npm run build` (interface, génère `dist/`) | Réussi |
| `npm --prefix desktop-server test` (tests d'intégration serveur) | Voir `docs/PHASE1.md` pour les résultats réels de la phase 1 |
| Démarrage réel de `node src/server.js` (Linux, environnement de développement) | Démarre, sert l'interface (HTTP 200), répond à `/api/info`, liste les adresses réseau |

Les 8 tests d'intégration couvrent : jumelage par QR code et remise unique du jeton, refus d'un jeton invalide, envoi par blocs avec vérification SHA-256 et gestion des doublons (renommer), rejet d'une empreinte incorrecte, reprise à partir du bon décalage, refus des chemins contenant `..`, téléchargement vers le téléphone avec contrôle de l'empreinte, et déconnexion d'un appareil.

## Tests obligatoires du cahier des charges

| N° | Test | Statut | Détail |
| --- | --- | --- | --- |
| 1 | Le serveur Windows démarre correctement | Partiel | Démarrage vérifié sous Linux ; le `.bat` et Node.js sous Windows restent à tester |
| 2 | Le téléphone accède à l'adresse IP du PC | Non exécuté | Nécessite un téléphone sur le même Wi-Fi |
| 3 | Le QR Code permet d'ouvrir la connexion locale | Non exécuté | Nécessite un téléphone qui scanne le QR code |
| 4 | Le PC accepte le jumelage | Partiel | Le flux de jumelage est couvert par un test d'intégration serveur ; la confirmation à l'écran n'est pas testée |
| 5 | Envoi d'un petit fichier du téléphone au PC | Non exécuté | Nécessite un téléphone réel |
| 6 | Envoi d'un fichier du PC au téléphone | Non exécuté | Nécessite un téléphone réel |
| 7 | Transfert de plusieurs fichiers | Non exécuté | Nécessite un téléphone réel |
| 8 | Gestion correcte des doublons | Partiel | Renommage couvert par test d'intégration ; l'écran de confirmation n'est pas testé |
| 9 | Intégrité SHA-256 des fichiers reçus | Partiel | Vérification et rejet d'empreinte couverts par tests d'intégration ; sur de vrais fichiers, non exécuté |
| 10 | Déconnexion réseau correctement signalée | Non exécuté | Nécessite de couper le Wi-Fi du téléphone |
| 11 | Erreurs affichées clairement | Non exécuté | Vérification visuelle sur appareil requise |

## Limites connues (non implémentées en V1)

- Transfert de dossiers entiers : non implémenté (voir `docs/ANDROID.md`).
- Choix du dossier de destination sur Android : non implémenté.
- Reconnexion automatique après coupure : non vérifiée.
- Mise à jour en temps réel par WebSocket : non utilisée ; la progression est rafraîchie par interrogation régulière.

## Tests à faire sur de vrais appareils avant mise en production

1. Installer avec `scripts\install-windows.bat`, démarrer avec `scripts\start-windows.bat`, et vérifier l'adresse affichée.
2. Scanner le QR code avec un téléphone Android sur le même Wi-Fi, puis accepter le jumelage sur le PC.
3. Envoyer un petit fichier et un fichier de plusieurs centaines de Mo dans chaque sens ; comparer les empreintes SHA-256.
4. Envoyer plusieurs fichiers d'un coup, puis tester un doublon.
5. Couper le Wi-Fi du téléphone pendant un envoi, puis vérifier le message d'erreur et la reprise.
6. Arrêter le serveur avec `scripts\stop-windows.bat` et vérifier que le téléphone affiche une erreur de connexion.

## Pilotes USB (FAT32 / exFAT / NTFS)

`python3 mobile/native/test/run_tests.py` génère des images (FAT32 avec noms longs et fichiers fragmentés, exFAT avec dossier de 200 fichiers, NTFS avec fichiers résidents, fragmentés, creux, liste d'attributs, index multi-blocs ; MBR, GPT, disque brut, secteurs 512 o et 4 Ko), les lit avec les pilotes Java directement puis via un protocole USB Bulk-Only émulé, et compare taille et SHA-256 de chaque fichier. Reste à faire sur de vrais appareils : disque physique branché en OTG, UAS, alimentation, gros fichiers.
