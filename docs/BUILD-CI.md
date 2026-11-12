# Compiler les versions Android et Windows de TRANSFERT

## APK Android

1. Ouvrez GitHub > Actions.
2. Choisissez **Compiler APK Android TRANSFERT**.
3. Cliquez sur **Run workflow** sur la branche `main`.
4. Après réussite, téléchargez l'artefact `TRANSFERT-Android-1.0.12-APK`.
5. Décompressez-le pour récupérer `app-debug.apk`.

## Installateur Windows EXE

1. Ouvrez GitHub > Actions.
2. Choisissez **Compiler EXE Windows TRANSFERT**.
3. Cliquez sur **Run workflow** sur la branche `main`.
4. Après réussite, téléchargez l'artefact `TRANSFERT-Windows-1.0.12-EXE`.
5. Décompressez-le pour récupérer `TRANSFERT-Setup-1.0.12.exe`.

Les deux compilations sont indépendantes : l'APK est construit sur Ubuntu et l'EXE sur Windows. Il faut lancer chaque workflow séparément si vous souhaitez les deux fichiers.

## Limites de validation

La réussite d'une compilation confirme la génération du paquet, mais ne remplace pas les essais sur un téléphone avec une clé FAT32 ou un disque NTFS, ni les essais d'installation et d'utilisation sur Windows.
