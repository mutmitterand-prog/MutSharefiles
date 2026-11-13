# Utiliser TRANSFERT sur Android

## Ouvrir l'application

1. Sur le PC, ouvrez le tableau de bord TRANSFERT : le QR code de connexion s'affiche sur la page Accueil.
2. Sur le téléphone, deux possibilités :
   - Touchez **Scanner le QR code** sur la page « Téléphone non connecté », puis prenez le QR code en photo.
   - Ou scannez le QR code avec l'appareil photo Android, puis touchez le lien qui s'affiche.
3. Le navigateur ouvre la page de connexion. Vérifiez le nom du PC, saisissez le nom de ce téléphone, puis touchez **Demander la connexion**.
4. Acceptez la demande sur le PC. Le téléphone passe automatiquement à l'accueil.

## Installer l'application sur l'écran d'accueil

Dans Chrome ou Edge : menu (trois points) > « Installer l'application » ou « Ajouter à l'écran d'accueil ». L'icône TRANSFERT s'ouvre ensuite en plein écran.

Important : sur le réseau local, le navigateur ne fournit pas le mode hors ligne ni les notifications. L'application installée ne fonctionne que lorsque le téléphone est joint au PC sur le même Wi-Fi.

## Envoyer un fichier vers le PC

Onglet **Transfert** > **Envoyer au PC** > choisissez un ou plusieurs fichiers. Les fichiers sont enregistrés dans le dossier partagé principal du PC (par défaut `Téléchargements\TRANSFERT`). La progression, la vitesse et la taille restante s'affichent pendant l'envoi.

## Recevoir un fichier du PC

Onglet **Transfert** > **Recevoir du PC**. Le PC doit avoir mis le fichier à disposition. Le téléchargement est vérifié (SHA-256) avant d'être terminé.

## Parcourir les fichiers du PC

Onglet **Fichiers** : ouvrez un dossier partagé, naviguez, et touchez **Télécharger** sur un fichier.

## Limites de la V1 sur Android

- **Choix du dossier de destination sur le téléphone** : non disponible. Les fichiers téléchargés suivent le dossier de téléchargement par défaut du navigateur.
- **Transfert de dossiers entiers** : non disponible en V1. Le navigateur Android ne permet pas de sélectionner un dossier de manière fiable. Sélectionnez les fichiers un par un ou compressez le dossier en ZIP.
- **Notifications et mode hors ligne** : non disponibles sur HTTP local.

## Évolution prévue : application native (version 1.1)

Voir `docs/ANDROID.md` pour l'intégration Capacitor, le sélecteur Android SAF et les permissions de stockage.

## USB OTG (APK Android, version 1.0.14)

L'écran de lancement propose deux boutons :

- **Détecter le support (NTFS, exFAT, FAT32)** : lecture directe par l'API USB Host d'Android, avec pilotes intégrés FAT16/FAT32, exFAT et NTFS (tables MBR et GPT, secteurs 512 o et 4 Ko). Cela fonctionne même quand Android ne monte pas le volume (cas fréquent de NTFS). Android demande l'accès au support ; un disque dur peut mettre quelques secondes à démarrer. Ce mode est en lecture seule : on navigue et on copie les fichiers vers `Téléchargements/TRANSFERT-USB`, en flux (gros fichiers possibles, barre de progression).
- **Choisir via Android (écriture possible)** : sélecteur Android (SAF). Permet aussi de copier un fichier du téléphone vers le support, mais uniquement si Android a lui-même monté le volume (FAT32 et exFAT en général ; NTFS selon le téléphone).

Limites : NTFS compressé ou chiffré (EFS) non lisible ; volumes BitLocker, ReFS et ext4 signalés mais non pris en charge ; l'écriture sur NTFS n'est pas disponible. Un disque dur sans alimentation propre (boîtier ou hub alimenté) ne démarre pas toujours sur le courant du téléphone.

## Réseau

L'application force ses connexions à passer par le Wi-Fi (Android peut sinon utiliser les données mobiles quand le Wi-Fi n'a pas d'accès Internet) et sonde le PC avec une requête native. Le QR code contient aussi les autres adresses du PC, essayées automatiquement. Les messages d'erreur distinguent : pare-feu/délai dépassé, port refusé (QR périmé), réseau différent.
