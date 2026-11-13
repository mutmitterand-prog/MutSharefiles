# Utiliser TRANSFERT sur Windows et Android

## Pare-feu Windows

Au premier démarrage, Windows peut afficher une alerte « Accès réseau » pour Node.js.

- Cochez **Réseaux privés** (Wi-Fi domestique ou professionnel).
- Ne cochez **pas** « Réseaux publics » : un réseau public ne doit pas accéder au serveur.
- Si vous avez refusé, ouvrez « Sécurité Windows » > « Pare-feu et protection du réseau » > « Autoriser une application », puis autorisez `Node.js JavaScript Runtime` sur les réseaux privés.

Le serveur essaie d’abord le port 8787, puis les ports voisins 8788 à 8799 (stables d’un lancement à l’autre), puis demande un port TCP libre au système en dernier recours (ou utilise `TRANSFERT_PORT` uniquement si cette variable a été explicitement définie) sur toutes les interfaces réseau du PC, pour être joignable depuis le téléphone sur le Wi-Fi. Il n'est pas accessible depuis Internet, sauf si vous configurez vous-même une redirection de port sur votre box, ce que TRANSFERT ne fait pas.

## Autorisation automatique (application TRANSFERT.exe)

Au premier lancement, TRANSFERT propose d'ajouter une règle de pare-feu par programme (réseaux privés et domaine). Acceptez la fenêtre « Administrateur » de Windows. La règle couvre tous les ports : elle reste valable même si le port change. Pour la refaire plus tard : clic droit sur l'icône TRANSFERT > « Autoriser dans le pare-feu Windows ».

Si vous utilisez `start-windows.bat` (Node.js), lancez `scripts\autoriser-pare-feu-windows.bat` : il se relance en administrateur, autorise Node.js et les ports 8787-8799, puis affiche le profil du réseau Wi-Fi.

## Trouver l'adresse du PC

TRANSFERT affiche l’adresse locale complète du PC avec le port réellement attribué (par exemple `http://192.168.1.20:49152`) sur l’accueil du tableau de bord et dans la fenêtre du serveur.

## Points à vérifier si la connexion échoue

- Le PC et le téléphone sont sur le **même** Wi-Fi (pas le réseau invité, pas la 5G du téléphone).
- Le réseau Wi-Fi est défini comme **privé** dans Windows (Paramètres > Réseau et Internet > Wi-Fi > Propriétés).
- Certaines box isolent les appareils Wi-Fi (« isolation client » ou « AP isolation »). Désactivez-la dans les réglages de la box si le téléphone ne voit pas le PC.
- Un antivirus peut bloquer le port : autorisez Node.js sur le réseau privé. Si nécessaire, démarrez TRANSFERT puis lancez `scripts\autoriser-pare-feu-windows.bat` en tant qu’administrateur : le script ouvre uniquement le port actuellement attribué.

## Arrêt et stratégie de sécurité

- Pour arrêter le serveur, utilisez `scripts\stop-windows.bat`. Un jumelage révoqué ou un appareil supprimé ne peut plus accéder au PC.
- Seuls les dossiers partagés explicitement configurés dans les paramètres sont accessibles. Le disque entier n'est jamais exposé.
- Le QR code contient un jeton temporaire (valable 5 minutes) et jamais un mot de passe permanent.
