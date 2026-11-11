# Récupérer l'APK et le .exe avec GitHub Actions

## Une seule fois : envoyer le projet sur GitHub
1. Créez un dépôt sur github.com (privé ou public).
2. Envoyez-y tout le contenu du dossier `project` (dossier `.github` compris : il est masqué dans l'Explorateur).
   Avec Git : `git remote add origin <adresse-du-depot>` puis `git push -u origin main`.

## Obtenir les fichiers
1. Ouvrez le dépôt, onglet **Actions**, workflow **Compiler APK et installateur Windows**.
2. Cliquez sur **Run workflow** (ou faites un `git push` sur `main`).
3. Attendez environ 10 à 15 minutes (pastille verte).
4. Ouvrez l'exécution : en bas, section **Artifacts**, téléchargez :
   - `TRANSFERT-Windows-installateur` : ZIP contenant `TRANSFERT-Setup-x.y.z.exe`
   - `TRANSFERT-Android-apk` : ZIP contenant `TRANSFERT-x.y.z.apk`

### Publier une version (fichiers directement téléchargeables)
`git tag v1.0.1` puis `git push origin v1.0.1` : la page **Releases** du dépôt reçoit l'APK et le .exe.

## Installer
- **Windows** : lancez le `.exe`. Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » (installateur non signé) : cliquez sur **Informations complémentaires** puis **Exécuter quand même**.
- **Android** : copiez l'APK sur le téléphone et ouvrez-le. Autorisez l'installation depuis cette source si Android le demande (APK de test signé avec la clé de débogage).

## Utilisation
1. Sur le PC, ouvrez TRANSFERT (raccourci du bureau). Le QR code s'affiche.
2. Sur le téléphone, ouvrez TRANSFERT, appuyez sur **Scanner le QR code du PC**, autorisez la caméra, puis acceptez le jumelage sur le PC.
3. Les PC déjà jumelés restent dans la liste « Mes ordinateurs ».

## Ce que contiennent les applications
- **Windows** : Electron (embarque Node.js, aucune installation requise), serveur TRANSFERT, interface, icône dans la zone de notification (ouvrir, démarrer/arrêter le serveur, quitter), raccourcis bureau et menu Démarrer, désinstallation qui conserve les données utilisateur (`%APPDATA%\TRANSFERT\data`).
- **Android** : application Capacitor : écran de lancement (scan du QR code, liste de PC, saisie manuelle), puis ouverture de l'interface servie par le PC. Les fichiers reçus sont enregistrés dans le dossier Téléchargements d'Android avec notification.

## Limites actuelles (non vérifiées sur matériel)
- Rien n'a encore été compilé ni installé : ce pipeline n'a pas pu être exécuté dans l'environnement de développement. Un premier échec de compilation est possible ; envoyez-moi le journal de l'étape en erreur.
- Android : pas de choix du dossier de destination, pas de vérification SHA-256 à la réception (gestionnaire de téléchargement d'Android), pas de notifications de progression pour l'envoi, pas de sélection de dossiers.
- Windows : pas de mise à jour automatique, installateur non signé.
- APK de débogage : adapté aux tests ; une version « release » signée (Play Store) demande une clé de signature.
