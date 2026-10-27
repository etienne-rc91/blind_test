# Blind test buzzer (réseau local)

Les téléphones servent de buzzers et le PC arbitre. Aucune dépendance à internet pendant la soirée.

## Installation (à faire chez soi, avec internet)
    npm install
## Lancement
    npm start                 # port 3000, clé hôte aléatoire
    HOST_KEY=secret npm start # clé fixe (PowerShell : $env:HOST_KEY="secret"; npm start)

La console affiche l'URL joueur et l'URL animateur (`/host?key=…`). Ouvrez l'URL animateur sur le PC, et les joueurs scannent le QR code.

## Déroulé
- Espace : nouveau morceau, ouvre les buzzers et efface les exclusions.
- B : bonne réponse, +1 point au premier, buzzers fermés.
- M : mauvaise réponse, le premier est exclu pour ce morceau et les buzzers rouvrent pour les autres.
- F : fermer les buzzers.
- ↺ (liste des équipes) : réouvre le buzzer d'une équipe exclue sur le morceau en cours.
- Les buzz arrivés après le premier restent enregistrés avec leur écart en ms.
- Plusieurs téléphones peuvent rejoindre la même équipe avec le même nom. Seul le premier buzz de l'équipe compte.

## Check-list salle
1. Le PC et les téléphones sont sur le même Wi-Fi (idéalement votre routeur de voyage).
2. Pare-feu Windows : autorisez Node.js sur les réseaux privés, et passez le profil du Wi-Fi en « Privé ».
3. Wi-Fi sans internet : demandez aux joueurs de couper les données mobiles, sinon le téléphone bascule en 4G et ne voit plus le PC.
4. Isolation des clients (« AP isolation ») : à désactiver sur le routeur, sinon les téléphones ne voient pas le PC.
5. Android récent : le navigateur doit avoir l'autorisation « Appareils à proximité » (Paramètres → Applications → Chrome → Autorisations). Sans elle, la page ne charge pas (`ERR_TOO_MANY_RETRIES` ou délai dépassé), même sur le bon Wi-Fi.
6. Faites un test à 2 téléphones (un Android, un iPhone) avant l'arrivée des invités.

## Limites connues
- Arbitrage à l'arrivée sur le serveur : c'est juste si tout le monde est sur le même Wi-Fi. Pas de compensation de latence.
- La mise en veille de l'écran n'est pas bloquée sur les téléphones : l'API Wake Lock exige HTTPS, et la page est servie en HTTP sur l'IP locale.
  - Demandez d'allonger la mise en veille.
  - Une reconnexion automatique rejoint l'équipe en moins d'une seconde au réveil.
- Les équipes et les scores sont sauvegardés dans `scores.json` et rechargés au redémarrage. Le morceau en cours, lui, repart fermé.
- Nouvelle partie : arrêtez le serveur et supprimez `scores.json` (ou utilisez « Remettre les scores à zéro »).
