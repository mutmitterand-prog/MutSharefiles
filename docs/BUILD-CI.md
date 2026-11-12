# Compiler l'APK Android avec GitHub Actions

## Déclencher la compilation

1. Envoyez **tout le contenu** du dossier du projet sur GitHub, y compris le dossier caché `.github/workflows/`.
2. Dans le dépôt GitHub, ouvrez l'onglet **Actions**.
3. Choisissez **Compiler APK Android TRANSFERT** dans la colonne de gauche.
4. Appuyez sur **Run workflow**, sélectionnez `main`, puis confirmez.
5. Ouvrez l'exécution. Si elle réussit (pastille verte), descendez jusqu'à **Artifacts**.
6. Téléchargez `TRANSFERT-Android-1.0.12-APK`, décompressez le ZIP et récupérez `app-debug.apk`.

Une compilation se déclenche aussi automatiquement après un push qui modifie `mobile/` ou le workflow sur `main` ou `master`.

## Installer sur Android

Copiez `app-debug.apk` sur le téléphone et ouvrez-le. Autorisez l'installation depuis cette source si Android le demande. Cette APK est une version de test/debug, pas une version Play Store signée.

## En cas d'échec

Ouvrez l'exécution rouge dans Actions, développez l'étape en erreur et copiez le journal complet de cette étape. Ne modifiez pas au hasard les paramètres du dépôt : le journal indiquera la cause précise.

## Limites de validation

La compilation GitHub vérifie que le projet Android peut être généré et compilé. Elle ne remplace pas un essai réel avec une clé FAT32 et un disque NTFS sur le téléphone. La lecture NTFS dépend notamment de la prise en charge du volume par Android et le fabricant du téléphone.
