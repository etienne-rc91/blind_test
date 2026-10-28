# Blind test buzzer (réseau local)

Les téléphones servent de buzzers et le PC arbitre. Aucune dépendance à internet pendant la soirée.

## Installation (à faire chez soi, avec internet)
    npm install
## Lancement
    npm start                 # port 3000, clé hôte aléatoire
    HOST_KEY=secret npm start # clé fixe (PowerShell : $env:HOST_KEY="secret"; npm start)

La console affiche l'URL joueur, l'URL de la Régie (`/host?key=…`) et celle du Grand écran (`/screen`). Ouvrez la Régie et le Grand écran sur le PC ; les joueurs scannent le QR code affiché sur le Grand écran (étape Installation). La Régie rappelle l'adresse à taper dans le bloc « Rejoindre ».

## Préparer la soirée (manches)
Une soirée se découpe en manches (« Cinéma », « Années 80 »…). Les points sont comptés par manche et le Bilan les affiche côte à côte.

1. Préparez un fichier CSV (Excel : « Enregistrer sous » → CSV, en UTF-8 ou non, séparateur `;` ou `,`). Partez de `exemple-soiree.csv`.
2. Première ligne obligatoire : `manche;type;question;image;A;B;C;D;reponse`.
3. Une manche **buzzer** tient sur une ligne : son nom et `buzzer`, le reste vide. L'ordre des lignes est l'ordre de la soirée.
   Une manche **QCM** a une ligne par question, avec le même nom de manche sur chaque ligne : `question` (texte) et/ou `image`, les propositions `A` à `D`, et la bonne réponse dans `reponse` (A, B, C ou D). Exemple :
   `Culture G;qcm;Qui est cet acteur ?;acteur1.jpg;Brad Pitt;Tom Cruise;Johnny Depp;Keanu Reeves;C`
4. Dans la Régie, bloc « Manches » : « Importer (CSV) ». En cas d'erreur, le message indique la ligne à corriger ; corrigez et réimportez.
5. Pendant la soirée, « Suivante ▶ » passe à la manche suivante (les buzzers se ferment). Les points donnés vont dans la manche en cours.

Sans fichier, la soirée se joue avec une seule manche, « Manche 1 », comme avant.
Réimporter un fichier est refusé dès qu'un point a été donné : utilisez d'abord « Remettre les scores à zéro » (qui revient aussi à la première manche).
Les images des questions QCM se placent dans le dossier `images/`, à côté du serveur ; la colonne `image` contient seulement le nom du fichier (pas d'adresse web : il n'y a pas internet en salle). L'import vérifie que chaque image existe.

## Manches QCM
Toutes les équipes répondent en même temps, A, B, C ou D, sur leur Buzzer (seules les lettres y apparaissent ; les propositions sont sur le Grand écran). 1 point par bonne réponse.

Dans la Régie, un seul bouton suit le déroulé, raccourci **Entrée** :
1. Afficher la question (image et/ou texte sur le Grand écran).
2. Afficher les propositions.
3. Lancer le compte à rebours : les équipes choisissent, et peuvent changer d'avis jusqu'à la fin. Le Grand écran montre combien d'équipes ont répondu, pas quoi. La Régie voit chaque réponse.
4. À zéro, les réponses sont bloquées. Révéler la réponse : les points sont donnés, le Grand écran montre la bonne proposition et le nombre d'équipes par lettre.
5. Question suivante : le Grand écran revient au classement.

La durée du compte à rebours se règle dans le bloc « Manches » (20 s par défaut, de 5 à 120 s).
Z annule la dernière action : annuler « Lancer le compte à rebours » l'arrête et efface les réponses reçues ; annuler « Révéler » retire les points. Un double appui sur Entrée ne saute pas d'étape.
Pendant une manche QCM, Espace, B, M et F sont sans effet.

## Grand écran
Le Grand écran est la page projetée derrière l'animateur, face aux équipes. Il n'a aucun bouton : c'est la Régie qui choisit ce qu'il affiche.

1. Sur le PC, ouvrez `http://localhost:3000/screen` dans une seconde fenêtre (lien « /screen » dans la Régie), glissez-la sur le projecteur et passez-la en plein écran (F11, ou ⌃⌘F sur Mac).
2. Dans la Régie, bloc « Grand écran », choisissez l'étape :
   - **Installation** : QR code en grand et équipes qui rejoignent la partie.
   - **Jeu** : classement en direct et équipe qui vient de buzzer.
   - **Bilan** : tableau des scores.
   - **Fin** : podium. Les ex aequo partagent la même marche (12, 12 et 10 points donnent les places 1, 1 et 2) et toutes les équipes des trois premières places montent sur le podium.
3. Changer d'étape s'annule avec Z. L'étape est sauvegardée : un Grand écran rechargé ou un serveur redémarré revient au bon endroit.

Le Grand écran affiche la même adresse que celle choisie dans la Régie (menu des interfaces réseau).

## Déroulé
- Espace : nouveau morceau, ouvre les buzzers et efface les exclusions.
- B : bonne réponse, +1 point au premier, buzzers fermés.
- M : mauvaise réponse, le premier est exclu pour ce morceau et les buzzers rouvrent pour les autres.
- F : fermer les buzzers.
- ↺ (liste des équipes) : réouvre le buzzer d'une équipe exclue sur le morceau en cours.
- Z : annule la dernière action de l'animateur (point, exclusion, remise à zéro, équipe retirée…). Plusieurs appuis remontent plus loin.
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
- Les équipes et les scores sont sauvegardés dans `scores.json` et rechargés au redémarrage. Le morceau en cours, lui, repart fermé, et l'historique d'annulation est vidé.
- Les manches importées, la manche en cours et l'étape du Grand écran sont aussi sauvegardées dans `scores.json`.
- Nouvelle partie : arrêtez le serveur et supprimez `scores.json` (ou utilisez « Remettre les scores à zéro »).
