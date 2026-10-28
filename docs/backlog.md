# Backlog

Fonctionnalités prévues mais pas encore conçues. Chacune passe par une discussion et un document de conception avant d'être construite. Vocabulaire : voir `CLAUDE.md`.

## En cours de conception

- **Grand écran, étapes, manches et QCM** : voir `docs/superpowers/specs/2026-10-28-grand-ecran-manches-qcm-design.md`.
- **Musique pilotée par l’app (fichiers locaux et Spotify)** : voir `docs/superpowers/specs/2026-10-28-musique-design.md`.

## À venir

### Vidéo YouTube dans une manche buzzer

Un morceau d’une manche buzzer peut être une vidéo YouTube, en plus des fichiers et de Spotify (même déroulé : passage début/fin, pause au buzz, reprise sur M, Rejouer l’extrait).

- Exige internet : même exception que Spotify, limitée aux morceaux YouTube.
- À préciser : où s’affiche la vidéo (Grand écran ? image masquée pendant le passage, son seul ?), publicités en début de vidéo, titre et suggestions de YouTube qui peuvent donner la réponse, ce que voit la Régie.

### Extrait musical ou vidéo dans une question QCM

Une question QCM peut avoir un média : extrait audio (fichier, Spotify) ou vidéo YouTube, joué sur le Grand écran.

- À préciser : à quelle étape le média se joue (avec la question, avec les propositions, pendant le compte à rebours ?), s’il boucle, s’il s’arrête à la fin du compte à rebours, réécoute.
- S’appuie sur les sources de musique de la conception « Musique » et sur la vidéo YouTube ci-dessus.

### Page « Création »

Créer une partie complète depuis l'interface, sans ouvrir Excel : manches, type de chaque manche, questions QCM (texte, image, propositions A–D, bonne réponse). La page produit le fichier CSV de la partie, au même format que celui défini dans la conception ci-dessus.

- Utilisée **avant** la soirée, pas pendant le jeu.
- Accessible depuis la Régie (protégée par la clé hôte).
- À préciser : ajout des images depuis la page (copie dans `images/`), aperçu d'une question telle qu'elle apparaîtra sur le Grand écran, réordonner manches et questions.

### Page « Sélection de la partie »

Voir toutes les parties disponibles sur l'ordinateur, rangées dans un dossier, et choisir quoi en faire.

- Liste des parties (fichiers CSV) du dossier, avec leur nom et leurs manches.
- Actions sur une partie : la **modifier** (ouvre la page Création), la **sauvegarder** (copie, sous un autre nom…), et autres actions à définir.
- C'est depuis cette page qu'on **choisit la partie qu'on va jouer**. Elle remplace à terme le bouton « Importer (CSV) » de la Régie.
- À préciser : emplacement du dossier (par défaut `parties/` à côté du serveur ?), ce qui se passe si on change de partie alors que des points ont été donnés, suppression d'une partie.
