# PHASE 5 — Gestion avancée des fichiers, dossiers, USB OTG et multimédia

## Fonctions intégrées dans cette livraison

- Sélection de dossiers entiers sur les navigateurs qui exposent `webkitdirectory` ; l'envoi conserve le chemin relatif, les sous-dossiers et les noms de fichiers. Chaque fichier conserve la reprise par blocs, l'annulation et son état individuel. La file affiche également une progression globale.
- Gestion des fichiers côté PC : création de dossiers, renommage, suppression confirmée, copie vers un dossier de destination, recherche récursive bornée et tri par nom, taille ou date. Les opérations restent confinées aux dossiers explicitement partagés et refusent les liens symboliques.
- Prévisualisation via le navigateur pour les images, PDF, audio et vidéos dont le codec est pris en charge. Les fichiers sont servis en flux par `sendFile`, sans lecture complète du média dans la mémoire JavaScript.
- Métadonnées de fichier (nom, extension, taille, dates) exposées par l'API ; espace disque libre et total restent disponibles via l'aperçu serveur.
- Les conflits de noms sont refusés par défaut pour les opérations de copie/déplacement ; l'utilisateur doit choisir une autre destination ou renommer. Les transferts de fichiers existants conservent les politiques demander/remplacer/garder les deux.

## USB OTG Android — compatibilité et limites réelles

Android prend en charge les clés USB OTG lorsque le téléphone, le câble/adaptateur et le système de fichiers sont compatibles. Une application Web/PWA dans Chrome ou WebView ne dispose pas d'un accès universel au système de fichiers USB. L'accès fiable doit passer par le Storage Access Framework (SAF) natif Android :

1. `ACTION_OPEN_DOCUMENT` pour choisir des fichiers sur le volume USB ;
2. `ACTION_OPEN_DOCUMENT_TREE` pour autoriser un dossier/volume et conserver la permission URI persistante ;
3. `ContentResolver` pour lire/écrire en flux, sans charger un gros fichier en mémoire ;
4. vérification de `takePersistableUriPermission`, gestion des volumes retirés et erreurs d'accès ;
5. copie vers le stockage USB via `DocumentFile.createFile`/`createDirectory`, avec gestion explicite des doublons.

Cette livraison ne déclare pas l'OTG natif comme activé : le projet Android actuel est un lanceur Capacitor et ne contient pas encore de plugin SAF enregistré. Le parcours de repli est le sélecteur de fichiers Android standard pour les fichiers qu'il expose, ou transfert via Wi-Fi. Pour activer le vrai OTG, il faut intégrer et tester un plugin Capacitor SAF natif dans le projet Android généré, sur plusieurs appareils et systèmes de fichiers.

## Compatibilité multimédia

La prévisualisation dépend du navigateur et des codecs installés. Les formats inconnus sont proposés en téléchargement ; aucun transcodage n'est réalisé. Les vidéos et audios sont servis comme fichiers statiques en flux HTTP, mais le support des requêtes Range dépend du serveur/runtime.

## Tests matériels requis avant publication

- Android 10 à 15, téléphone avec OTG et téléphone sans OTG ; clé USB FAT32, exFAT et NTFS selon support constructeur.
- Débrancher/rebrancher le support pendant lecture et copie ; refuser/retirer une permission ; vérifier la reprise ou le message d'erreur.
- Dossiers imbriqués, deux fichiers de même nom dans deux sous-dossiers, gros fichiers, réseau interrompu, annulation et reprise.
- Images JPEG/PNG/WebP, PDF, MP4 H.264, WebM, MP3, WAV ; vérifier les codecs non pris en charge.
- Vérifier l'espace libre avant copie et les conflits de noms avant écriture.
