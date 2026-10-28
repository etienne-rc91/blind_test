# Blind test buzzer (réseau local)

Les téléphones servent de buzzers et le PC arbitre. Aucune dépendance à internet pendant la soirée, sauf pour les morceaux Spotify et YouTube (voir « Spotify » et « Vidéos »).

## Installation (à faire chez soi, avec internet)
    npm install
## Lancement
    npm start                 # port 3000, clé hôte aléatoire
    HOST_KEY=secret npm start # clé fixe (PowerShell : $env:HOST_KEY="secret"; npm start)

Node 22.9 ou plus est nécessaire.

**Paramètres dans un fichier** : copiez `.env.example` en `.env` (même dossier) et remplissez les valeurs voulues (clé hôte, port, Client ID Spotify, dossiers des parties, musiques, vidéos et images…). `npm start` lit ce fichier au démarrage, sans rien taper de plus. Un paramètre donné dans la commande l’emporte sur le fichier. Le fichier `.env` n’est jamais commité.

La console affiche l'URL joueur, l'URL de la Régie (`/host?key=…`) et celle du Grand écran (`/screen`) ; sur ce PC, elle les donne en `127.0.0.1` (l'adresse qu'accepte Spotify). Ouvrez la Régie et le Grand écran sur le PC ; les joueurs scannent le QR code affiché sur le Grand écran (étape Installation). La Régie rappelle l'adresse à taper dans le bloc « Rejoindre ».

## Préparer la soirée (parties)
Une **partie** est une soirée préparée : ses manches (« Cinéma », « Années 80 »…) et, pour les manches QCM, leurs questions. Chaque partie est un fichier CSV du dossier `parties/`, à côté du serveur. Les points sont comptés par manche et le Bilan les affiche côte à côte.

**Page Parties** (lien « Parties » dans le bloc « Manches » de la Régie) :
- la liste des parties, avec leurs manches et la date de modification ; la partie en cours est marquée « en cours » ;
- **Jouer** : commence une nouvelle soirée avec cette partie. Les équipes, les scores et l'avancement repartent de zéro, le Grand écran revient à l'Installation et les téléphones déjà connectés doivent rejoindre à nouveau ;
- **Modifier** (ouvre la page Création), **Renommer**, **Supprimer** (la partie en cours ne peut pas être supprimée) ;
- **+ Nouvelle partie** et **Importer un fichier CSV** (une partie préparée dans Excel).

**Page Création** (« + Nouvelle partie » ou « Modifier ») :
- à gauche les manches, à droite la manche choisie ; on réordonne manches et questions en les glissant (ou avec ↑ ↓) ;
- pour une question QCM : le texte, l'image (« Choisir une image » la copie dans `images/` ; 10 Mo maximum, png, jpg, gif, webp ou svg), les 4 propositions, et la bonne réponse en cliquant sur sa lettre ; l'aperçu montre la question telle qu'elle apparaîtra sur le Grand écran ;
- **Enregistrer** remplace la partie ; **Enregistrer sous…** crée une copie sous un autre nom et laisse l'originale intacte ;
- modifier la **partie en cours** pendant la soirée s'applique tout de suite, scores gardés : corrections de texte, de propositions, d'image, ajout de manches ou de questions à la fin. Supprimer ou réordonner des manches, changer leur type, ou toucher à l'ordre des questions d'une manche QCM déjà commencée est refusé (utilisez « Enregistrer sous » pour une prochaine soirée). Changer la bonne réponse d'une question déjà révélée ne recalcule pas les points : corrigez avec +/−.

Une partie **incomplète** (question sans proposition, sans bonne réponse, image introuvable, manche QCM sans question…) peut être enregistrée pour être terminée plus tard : elle est marquée « incomplète », avec ce qui manque, et ne peut pas être jouée.

Pendant la soirée, « Suivante ▶ » passe à la manche suivante (les buzzers se ferment). Les points donnés vont dans la manche en cours. Sans partie choisie, la soirée se joue avec une seule manche, « Manche 1 ».

**Format CSV (pour Excel)** : on peut aussi préparer une partie dans Excel (« Enregistrer sous » → CSV, UTF-8 ou non, séparateur `;` ou `,`) puis l'importer, ou déposer le fichier directement dans `parties/`. Partez de `exemple-soiree.csv`.
- Première ligne obligatoire : `manche;type;question;image;A;B;C;D;reponse;musique;debut;fin`. Les anciens fichiers à 9 colonnes fonctionnent toujours.
- Une manche **buzzer** libre tient sur une ligne : son nom et `buzzer`, le reste vide. Avec des morceaux, elle a une ligne par morceau (voir « Morceaux »). L'ordre des lignes est l'ordre de la soirée.
- Une manche **QCM** a une ligne par question, avec le même nom de manche sur chaque ligne : `question` (texte) et/ou `image`, les propositions `A` à `D`, et la bonne réponse dans `reponse` (A, B, C ou D). Exemple :
  `Culture G;qcm;Qui est cet acteur ?;acteur1.jpg;Brad Pitt;Tom Cruise;Johnny Depp;Keanu Reeves;C`
- Une question QCM peut avoir un **extrait** : remplissez `musique`, `debut` et `fin` sur sa ligne (comme pour un morceau, voir « Morceaux »). `reponse` reste la lettre A à D.
- Les images se placent dans le dossier `images/` ; la colonne `image` contient seulement le nom du fichier (pas d'adresse web : il n'y a pas internet en salle).

## Morceaux (musique jouée par l’app)
Une manche buzzer qui contient des **morceaux** est jouée par la Régie : l’app lance la musique, la coupe au buzz et révèle la réponse. Une manche buzzer sans morceau reste « libre » : vous lancez la musique vous-même, comme avant.

**Préparer dans Création** (manche buzzer) :
- **+ Fichier** : choisir un fichier audio, copié dans le dossier `musiques/` (mp3, m4a, aac, ogg, oga, wav ou flac ; 50 Mo maximum) ;
- **+ Spotify** : rechercher un titre (voir « Spotify ») ;
- la **barre de temps** a deux poignées, Début et Fin, qui bornent le **passage** joué : à la souris, ou avec les flèches (±1 s, Maj ±5 s) ;
- **▶ Écouter le passage** le joue tel que la salle l’entendra ;
- la **réponse** est pré-remplie (titre et artiste) et modifiable. Elle n’apparaît sur le Grand écran qu’à la révélation.

**À la main dans le CSV** : une ligne par morceau, avec le même nom de manche, le type `buzzer` et les colonnes `musique;debut;fin` ; la réponse va dans `reponse`.
- `musique` : le nom du fichier audio dans `musiques/`, le nom d’un fichier vidéo dans `videos/` (mp4, webm, m4v ou mov), `spotify:track:<id>` (un lien `https://open.spotify.com/track/…` fonctionne aussi), ou une vidéo YouTube (lien `watch`, `youtu.be`, `shorts`, ou `youtube:<id>`, forme sous laquelle l’app l’écrit) ;
- `debut` et `fin` : au format `m:ss`. Exemple :
  `Années 80;buzzer;;;;;;;Africa - Toto;africa.mp3;0:45;1:05`

## Spotify
Les morceaux Spotify demandent internet (et seulement eux) et un compte **Premium**. Le Client Secret n’est pas utilisé.
1. Sur developer.spotify.com, créez une app. Redirect URI : `http://127.0.0.1:3000/spotify/callback` (si vous changez `PORT`, adaptez le numéro). Cochez Web API et Web Playback SDK.
2. En mode développement, ajoutez votre e-mail Spotify dans User Management de l’app.
3. Mettez le Client ID dans `.env` (`SPOTIFY_CLIENT_ID=…`, voir « Lancement »), ou lancez `SPOTIFY_CLIENT_ID=… npm start` (PowerShell : `$env:SPOTIFY_CLIENT_ID="…"; npm start`), ou saisissez-le dans la page Création.
4. Ouvrez la Régie et Création sur `http://127.0.0.1:3000/…` (et non `localhost` ni l’IP du réseau) pour garder la connexion. Chrome est recommandé.
5. Cliquez sur « Se connecter à Spotify » dans Création, puis cherchez vos titres avec **+ Spotify**.

Les jetons sont gardés dans `spotify.json` (jamais commité). Une partie sans morceau Spotify ne charge rien depuis internet.

## Vidéos (fichier ou YouTube)
Un morceau ou un extrait QCM peut être une **vidéo**, jouée par le Grand écran (la musique de la vidéo sort du PC). Mêmes colonnes `musique;debut;fin` dans le CSV, sur une ligne de morceau comme sur une ligne `qcm` (extrait).

**Préparer dans Création** :
- **+ Vidéo** : choisir un fichier vidéo, copié dans le dossier `videos/` (mp4, webm, m4v ou mov ; 500 Mo maximum) ;
- **+ YouTube** : coller le lien d’une vidéo, puis « Ajouter ». Pour un morceau buzzer, la réponse est pré-remplie avec le titre de la vidéo. Une vidéo privée, introuvable ou dont le propriétaire interdit la lecture ailleurs que sur YouTube est refusée ;
- Début, Fin et « Écouter le passage » fonctionnent comme pour l’audio.

**Avant la soirée** :
1. Ouvrez le Grand écran sur le PC du serveur, à l’adresse `http://127.0.0.1:3000/screen` (et non l’IP du réseau), et mettez-le en plein écran sur le projecteur. Seul le dernier Grand écran ouvert ainsi joue les vidéos.
2. **Cliquez une fois dans le Grand écran** : « Cliquez pour activer la vidéo ». Sans ce clic, le navigateur bloque le son et la vidéo ne démarre pas.
3. Dans la Régie, mettez le Grand écran à l’étape **Jeu** : une vidéo ne se joue qu’à cette étape. La Régie prévient s’il n’y a pas de Grand écran, s’il n’est pas ouvert à l’adresse `127.0.0.1`, s’il n’est pas à l’étape Jeu ou s’il attend le clic.

**Pendant la soirée** : la Régie ne montre jamais la vidéo, seulement la réponse, la progression et les erreurs. Sur le Grand écran, la vidéo n’est visible que pendant la lecture ; la réponse n’apparaît qu’à la révélation. Pour YouTube, la barre de titre est rognée, et une vidéo en 4:3 est légèrement rognée en haut et en bas (un fichier téléchargé évite cela). Des publicités YouTube peuvent apparaître au lancement.

**Internet** : seuls les morceaux YouTube (et Spotify) en ont besoin. Les fichiers vidéo marchent hors ligne. « Jouer » prévient quand une partie contient des vidéos YouTube.

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
Pendant une manche QCM, Espace, B, M et F sont sans effet. R rejoue l’extrait d’une question qui en a un.

### Question avec extrait
**Préparation (Création)** : dans l’éditeur d’une question QCM, le bloc « Extrait (facultatif) » propose **+ Fichier**, **+ Vidéo**, **+ YouTube** et **+ Spotify** (en ajouter un remplace l’extrait existant), la barre de temps Début/Fin et « Écouter le passage », comme pour les morceaux (voir « Morceaux »), et « Retirer l’extrait ». Une question avec extrait porte un ♪ dans la liste des questions (🎬 pour un extrait vidéo).

Une question qui a un extrait (♪ ou 🎬 dans la liste de Création) s’ouvre autrement : la salle écoute d’abord, puis découvre la question.
1. Entrée affiche la page de la question, sans texte.
2. Entrée (« Lancer l’extrait ») joue l’extrait. Le Grand écran affiche « ♪ Écoutez… », les Buzzers « ♪ Écoutez l’extrait… ». Pendant l’extrait, Entrée est ignorée.
3. À la fin de l’extrait, la question apparaît seule. La suite est inchangée : propositions, compte à rebours, révélation.

- **R** (« Rejouer l’extrait ») rejoue l’extrait depuis Début, à n’importe quelle étape après le lancement, même pendant le compte à rebours ou après la révélation. Cela ne change rien d’autre, et le compte à rebours ne coupe pas l’extrait. « Question suivante », un changement de manche ou d’étape du Grand écran l’arrêtent.
- **« Afficher la question »** (bouton, pendant l’extrait) coupe l’extrait et affiche la question. Utile si l’extrait est trop long, ou si la lecture est impossible (fichier introuvable, Spotify déconnecté) : la question n’est jamais bloquée.
- **Z** annule « Afficher la question » (retour à l’écoute, musique coupée ; R la relance). Z ne relance jamais la musique.
- Après un redémarrage du serveur, une question non révélée repart au début : le Grand écran montre le classement (« Question N/M dans un instant »), et Entrée reprend depuis la page de la question.

## Grand écran
Le Grand écran est la page projetée derrière l'animateur, face aux équipes. Il n'a aucun bouton : c'est la Régie qui choisit ce qu'il affiche.

1. Sur le PC, ouvrez `http://127.0.0.1:3000/screen` dans une seconde fenêtre (lien « /screen » dans la Régie), glissez-la sur le projecteur et passez-la en plein écran (F11, ou ⌃⌘F sur Mac).
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

**Avec des morceaux** (la Régie joue la musique) :
- Espace lance le passage. Sans effet tant que le morceau en cours n’est pas conclu par B ou F (un double appui ne grille pas de morceau) ; il reprend une musique en pause sans buzz.
- Le buzz met la musique en pause automatiquement. M la reprend là où elle s’était arrêtée (muette si le passage était fini).
- B : fanfare et révélation sur le Grand écran. F : arrêt et révélation.
- R : rejouer l’extrait depuis le début (pas pendant un buzz non jugé).
- À la fin du passage, la musique s’arrête et les buzzers restent ouverts.
- Z ne relance jamais la musique.
- Grand écran : `♪ Morceau n / total` (`🎬` pour une vidéo) pendant la lecture, puis la révélation (réponse, et pochette pour Spotify) jusqu’au morceau suivant.
- Une seule Régie joue le son : la première ouverte. Le bouton « Le son sort ici » la change.

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
- Les équipes et les scores sont sauvegardés dans `scores.json` et rechargés au redémarrage. Le morceau en cours, lui, repart fermé, et l'historique d'annulation est vidé. Dans une manche avec morceaux, un morceau interrompu (ni B ni F) n’est pas compté : Espace le rejoue depuis Début.
- Les manches importées, la manche en cours et l'étape du Grand écran sont aussi sauvegardées dans `scores.json`.
- Nouvelle partie : arrêtez le serveur et supprimez `scores.json` (ou utilisez « Remettre les scores à zéro »).
- Après un changement de manche ou un redémarrage, R ne rejoue pas l’extrait d’une question déjà révélée.
- Vidéos : seul le Grand écran ouvert sur le PC du serveur (`127.0.0.1`) les joue ; il faut un clic dedans avant la soirée, et l’étape Jeu. YouTube demande internet et peut afficher des publicités.
- Spotify : si le même compte est utilisé ailleurs en même temps (téléphone), il prend la main sur la lecture.
- Création et la Régie sont deux appareils Spotify du même compte : écouter un titre dans Création pendant la soirée coupe la lecture de la Régie.
- Spotify n’est pas garanti sur Safari (Chrome recommandé).
- Si Spotify perd le morceau, la Régie affiche une erreur : concluez avec B ou F.
- Pendant une panne Spotify, le morceau fichier suivant peut démarrer avec quelques secondes de retard.
- Avec deux Régies ouvertes, la première ouverte garde le son, même si l’autre agit. Il ne change qu’avec « Le son sort ici », ou si cette Régie se ferme (le son passe alors à la plus ancienne Régie restante).
