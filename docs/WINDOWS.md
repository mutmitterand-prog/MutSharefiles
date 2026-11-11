# Utiliser TRANSFERT sur Windows et Android

## Pare-feu Windows

Au premier démarrage, Windows peut afficher une alerte « Accès réseau » pour Node.js.

- Cochez **Réseaux privés** (Wi-Fi domestique ou professionnel).
- Ne cochez **pas** « Réseaux publics » : un réseau public ne doit pas accéder au serveur.
- Si vous avez refusé, ouvrez « Sécurité Windows » > « Pare-feu et protection du réseau » > « Autoriser une application », puis autorisez `Node.js JavaScript Runtime` sur les réseaux privés.

Le serveur écoute le port 8787 (ou `TRANSFERT_PORT`) sur toutes les interfaces réseau du PC, pour être joignable depuis le téléphone sur le Wi-Fi. Il n'est pas accessible depuis Internet, sauf si vous configurez vous-même une redirection de port sur votre box, ce que TRANSFERT ne fait pas.

## Trouver l'adresse du PC

TRANSFERT affiche l'adresse locale du PC (par exemple `http://192.168.1.20:8787`) sur l'accueil du tableau de bord. Elle est aussi écrite dans la fenêtre du serveur au démarrage.

## Points à vérifier si la connexion échoue

- Le PC et le téléphone sont sur le **même** Wi-Fi (pas le réseau invité, pas la 5G du téléphone).
- Le réseau Wi-Fi est défini comme **privé** dans Windows (Paramètres > Réseau et Internet > Wi-Fi > Propriétés).
- Certaines box isolent les appareils Wi-Fi (« isolation client » ou « AP isolation »). Désactivez-la dans les réglages de la box si le téléphone ne voit pas le PC.
- Un antivirus peut bloquer le port : autorisez Node.js ou ajoutez une exception pour le port.

## Arrêt et stratégie de sécurité

- Pour arrêter le serveur, utilisez `scripts\stop-windows.bat`. Un jumelage révoqué ou un appareil supprimé ne peut plus accéder au PC.
- Seuls les dossiers partagés explicitement configurés dans les paramètres sont accessibles. Le disque entier n'est jamais exposé.
- Le QR code contient un jeton temporaire (valable 5 minutes) et jamais un mot de passe permanent.
