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

## USB OTG (APK Android)

Depuis cette version, l'écran de lancement propose « Clé USB / disque dur OTG ». Connectez le support avec un adaptateur OTG, choisissez-le dans le sélecteur Android, naviguez dans les dossiers, puis copiez un fichier USB vers `Téléchargements/TRANSFERT-USB`. Le bouton de copie inverse ouvre le sélecteur Android et copie le fichier choisi sur le support USB. Les copies sont faites en flux, adaptées aux gros fichiers et sans chargement intégral en mémoire. Les doublons sont renommés automatiquement.

La compatibilité FAT32 dépend du montage Android. NTFS dépend du téléphone : si Android ne monte pas le volume NTFS, il n'apparaîtra pas dans le sélecteur. L'application ne formate ni ne modifie le système de fichiers. Cette fonction OTG est disponible dans l'APK Android, pas dans la PWA du navigateur.
