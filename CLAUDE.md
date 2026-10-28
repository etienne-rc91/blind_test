# CLAUDE.md — Blind test buzzer

> Ce fichier s'applique à ce dépôt. Le `CLAUDE.md` situé dans `~/Downloads` décrit un autre projet (Forge : NestJS, monorepo, multi-tenant) et **ne s'applique pas ici**. En cas de conflit, ce fichier prime.

## 1. Ce que c'est

Un buzzer de blind test qui tourne **en réseau local, sans internet**, pendant une soirée animée.

- Le **PC de l'animateur** fait tourner le serveur Node et affiche l'écran animateur (`/host?key=…`). C'est lui qui arbitre.
- Les **téléphones des joueurs** servent de buzzers (`/`). Ils rejoignent la partie en scannant un QR code.
- Plusieurs téléphones peuvent rejoindre la même équipe (même nom). Seul le premier buzz de l'équipe compte.

Le public cible est un animateur seul, face à des équipes, dans une salle avec un Wi-Fi local (souvent un routeur de voyage).

## Vocabulaire

Toujours utiliser ces noms, dans la conversation comme dans le README et l'interface. Le code garde les noms anglais.

### Écrans

| Nom | Qui le regarde | Appareil | Code | Adresse |
|---|---|---|---|---|
| **Régie** | l'animateur, caché du public | PC de l'animateur | `host` (`public/host.html`) | `/host?key=…` |
| **Buzzer** | une équipe | téléphone | `player` (`public/player.html`) | `/` |
| **Grand écran** | toute la salle | projecteur | `screen` (`public/screen.html`) | `/screen` |

Le Grand écran est en lecture seule et son contenu dépend de l'étape choisie dans la Régie (voir ci-dessous). Les vidéos sont jouées par **le Grand écran qui lit** : le dernier `/screen` ouvert sur le PC du serveur (`127.0.0.1`), et lui seul.

### Déroulé d'une partie

| Nom | Sens | Code |
|---|---|---|
| **Partie** | Une soirée complète, préparée à l'avance dans un fichier CSV (manches, questions). | `game` |
| **Étape** | Ce qu'affiche le Grand écran : **Installation**, **Jeu**, **Bilan**, **Fin**. Choisie dans la Régie. | `stage` (`setup`, `play`, `summary`, `final`) |
| **Manche** | Un thème de la partie (« Cinéma », « Années 80 »), d'un type donné. Les scores sont comptés par manche. | `section` |
| **Manche buzzer** | La première équipe qui buzze répond ; l'animateur valide (B) ou refuse (M). | type `buzzer` |
| **Manche QCM** | Toutes les équipes répondent A/B/C/D sur leur Buzzer avant la fin d'un compte à rebours. | type `qcm` |
| **Morceau** | Une question d'une manche buzzer, lancée avec Espace. Dans une manche avec morceaux, le code dit `song` (`section.songs`) ; `round` reste le compteur de la manche libre. | `round` (existant), `song` |
| **Question** | Une question d'une manche QCM, décrite dans le fichier CSV. | `question` |
| **Déroulé d’une question** | Étapes d’une question QCM, choisies dans la Régie avec Entrée : page de la question, extrait, question, propositions, compte à rebours, révélation. | `qcm.step` (`idle`, `intro`, `listening`, `question`, `choices`, `countdown`, `locked`, `revealed`) |
| **Extrait** | Passage musical d’une question QCM, joué avant la question. | `question.extract` |
| **Passage** | Portion d’un morceau ou d’un extrait, de Début à Fin. | `song` (`start`, `end`) |
| **Révélation** | Réponse d’un morceau dévoilée sur le Grand écran (après B ou F). | — |
| **Podium** | Classement dense sur le total : ex aequo à la même place, sans trou (1, 1, 2). Toutes les équipes des places 1 à 3 y montent. | — |

`phase` est réservé à l'état des buzzers (`closed | open | buzzed`). Ne pas l'utiliser pour les étapes ni pour les manches.

Conception détaillée : `docs/superpowers/specs/2026-10-28-grand-ecran-manches-qcm-design.md`. Idées pour plus tard : `docs/backlog.md`.

## 2. Contraintes non négociables

1. **Aucune dépendance à internet pendant la soirée.** Pas de CDN, pas de police distante, pas d'appel à un service externe. Tout est servi par le serveur local. `npm install` se fait à la maison.
   **Seules exceptions : les morceaux Spotify et YouTube** (connexion et recherche Spotify, lecteurs Spotify et YouTube, pochettes et miniatures). Ils exigent internet, et uniquement eux : une partie sans morceau Spotify ni YouTube ne charge rien de distant, et une panne de ces services ne bloque jamais le jeu.
2. **Pas de nouvelle dépendance npm sans en parler.** Les dépendances actuelles : `express`, `socket.io`, `qrcode`. Versions figées (pas de `^`).
3. **Pas d'étape de build.** HTML + CSS + JS vanilla dans `public/`. Pas de framework front, pas de bundler, pas de TypeScript.
4. **Le serveur est l'unique source de vérité.** Les pages ne font qu'afficher l'état reçu (`state`) et envoyer des intentions. Aucune règle de jeu côté navigateur.
5. **Équité de l'arbitrage.** L'ordre des buzz est décidé à l'arrivée sur le serveur (`performance.now()` pris en premier dans le handler `buzz`). Ne rien ajouter avant ce timestamp.
6. **Doit marcher sur Android et iPhone**, en HTTP sur une IP locale (donc pas d'API qui exige HTTPS : Wake Lock, etc.).

## 3. Architecture

```
buzzer/
├── server.js            Serveur : routes Express, API /api (parties, images, musiques, vidéos, youtube, spotify), sockets, sauvegarde, Régie qui joue le son
├── lib/
│   ├── game.js          État du jeu et règles (manches, QCM, annulation, nouvelle soirée), sans réseau
│   ├── songs.js         Morceaux d’une manche buzzer : fichiers audio et vidéo, Spotify, YouTube, Début/Fin, validation
│   ├── spotify.js       Connexion Spotify (PKCE), recherche, jetons (spotify.json)
│   ├── youtube.js       Liens YouTube : identifiant, titre et miniature (oEmbed)
│   ├── upload.js        Réception des fichiers vidéo, écrits en flux sur le disque (jamais en mémoire)
│   ├── screens.js       Grand écran qui lit : le dernier /screen ouvert sur le PC du serveur
│   ├── ranking.js       Classement dense et podium
│   ├── csv.js           Décodage (UTF-8 / Windows-1252) et parsing CSV
│   ├── game-file.js     CSV ↔ manches (validation stricte ou brouillon), écriture CSV
│   ├── parties.js       Dossier parties/ : lister, lire, enregistrer, renommer, supprimer, importer
│   └── live-edit.js     Ce qui peut s'appliquer à chaud à la partie en cours
├── public/
│   ├── host.html        Régie (PC) : contrôles clavier, manches, équipes
│   ├── player.html      Buzzer (téléphone)
│   ├── screen.html      Grand écran (projecteur)
│   ├── players.js       Lecteurs communs (fichier audio, Spotify, fichier vidéo, YouTube), partagés par la Régie, Création et le Grand écran
│   ├── video-view.js    Règles d’affichage des passages vidéo (fonctions pures), partagées par le Grand écran et la Régie ; aussi `require`-able par Node
│   ├── parties.html     Sélection de la partie (clé hôte)
│   └── creation.html    Création / modification d'une partie (clé hôte)
├── parties/             Une partie = un fichier CSV (ignoré par git)
├── images/              Images des questions QCM (ignoré par git)
├── musiques/            Fichiers audio des morceaux (ignoré par git)
├── videos/              Fichiers vidéo des morceaux et extraits (ignoré par git)
├── spotify.json         Jetons Spotify (généré, ignoré par git)
├── scores.json          Sauvegarde des équipes et scores (généré, ignoré par git)
├── package.json
└── README.md            Mode d'emploi pour l'animateur + check-list salle
```

**Flux de données**
- L'état vit en mémoire dans `server.js` : `teams` (Map) et `round` (`phase` : `closed | open | buzzed`, `buzzes`, `excluded`, `number`).
- Après chaque changement, `broadcast()` envoie à chaque socket son propre `publicState()` (événement `state`) et planifie la sauvegarde : l’état `host` à la room `hosts`, puis, socket par socket, l’état `screen` de chaque Grand écran (`reader` vrai pour celui qui lit, seul à recevoir `media`) et l’état `player` de chaque Buzzer (selon son équipe).
- `publicState()` est le contrat entre serveur et pages. Les équipes y sont déjà **triées par score décroissant**, puis par nom.

**Rôles des sockets** (via `socket.handshake.auth`)
- `player` : peut `join` et `buzz`.
- `host` + `key === HOST_KEY` : peut envoyer les événements `host:*`. Rejoint la room `hosts` et reçoit `info` (IPs et port), ainsi que `video` : le statut relayé du Grand écran qui lit (`reader`, `screens` = nombre de Grands écrans connectés, `unlocked`, `key`, `pos`, `error`).
- `screen` : aucune clé, aucun secret. Rejoint la room `screens` et reçoit `info`. Le **Grand écran qui lit** (`lib/screens.js` : le dernier ouvert depuis `127.0.0.1`) est le seul à recevoir `media` et le seul écouté pour `screen:ended { seq }` (fin d’un passage vidéo, prise en compte seulement à l’étape Jeu) et `screen:video` (son statut, relayé aux Régies) ; ces événements venant d’un autre Grand écran sont ignorés.
- La route `/host` exige `?key=HOST_KEY`. La clé est aléatoire au démarrage sauf si `HOST_KEY` est défini.

**Annulation (touche Z)**
- Toute action animateur qui modifie l'état **doit** passer par `hostOnly(fn)`. Ce wrapper vérifie le rôle, prend un `snapshot()` avant, l'empile dans `history` si l'état a changé, puis diffuse.
- `restore()` ne supprime jamais une équipe arrivée depuis. Une équipe retirée revient sans téléphone connecté.
- Si on ajoute un champ d'état modifiable par l'animateur, l'ajouter aussi à `snapshot()` et `restore()`.

**Sauvegarde**
- Équipes, scores et numéro de morceau sont écrits dans `scores.json` (écriture atomique via `.tmp` + `rename`, regroupée sur 300 ms).
- Le morceau en cours et l'historique d'annulation ne sont pas sauvegardés.

## 4. Commandes

```bash
npm install                 # à faire avec internet, avant la soirée
npm start                   # port 3000, clé hôte aléatoire ; lit .env s’il existe
HOST_KEY=secret npm start   # clé fixe
PORT=4000 npm start
SCORES_FILE=/chemin/scores.json npm start
```

Tous les paramètres (`HOST_KEY`, `PORT`, `SPOTIFY_CLIENT_ID`, `PARTIES_DIR`, `MUSIQUES_DIR`, `IMAGES_DIR`, `VIDEOS_DIR`, `SCORES_FILE`, `SPOTIFY_FILE`) peuvent être mis dans `.env` (modèle : `.env.example`, lu par `node --env-file-if-exists`, Node ≥ 22.9). Un nouveau paramètre lu dans `process.env` doit être ajouté à `.env.example`.

Les tests automatisés se lancent avec `npm test` (`node --test`, y compris `server.test.js`). Vérification manuelle en plus : lancer le serveur, ouvrir la Régie (`/host?key=…`) et deux Buzzers (`/`), jouer un morceau complet (Espace, buzz, B / M, Z). Pour les vidéos, dans Chrome, avec le Grand écran ouvert à `http://127.0.0.1:<port>/screen` et cliqué une fois, étape Jeu :
- fichier vidéo : Espace (la vidéo joue), buzz (le bandeau la couvre), M (reprise), Fin (cache « 🎬 Morceau n / total »), B (révélation au-dessus du classement), R (la vidéo rejoue avec la bande de réponse), Z ;
- YouTube : lecture, pause au buzz, R après la fin du passage ; le titre YouTube et ses suggestions ne doivent jamais être visibles ;
- QCM : question avec extrait vidéo (cache puis vidéo, question à Fin), R pendant le compte à rebours (bande avec le temps et les propositions).

## 5. Conventions

- **Langue** : interface, README et commentaires de code en **français** (le public et l'animateur sont francophones). Identifiants en anglais. Messages de commit en **anglais**, format Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`…).
- **Typographie française** dans l'UI : apostrophe typographique `’`, espace avant `:` `?` `!`.
- **Style JS** : CommonJS côté serveur, pas de point-virgule omis, fonctions courtes, commentaires qui expliquent le *pourquoi*.
- **Pages** : un seul fichier HTML par écran, CSS et JS inline. Seules exceptions assumées : `public/players.js`, les lecteurs communs à la Régie, à Création et au Grand écran (évite de dupliquer les couches Spotify et YouTube), et `public/video-view.js`, les règles d’affichage vidéo communes au Grand écran et à la Régie (testées sous Node). Couleurs en variables CSS sur `:root`, avec variante `prefers-color-scheme: dark`. Respecter `prefers-reduced-motion`.
- **Validation des entrées** côté serveur : tout ce qui vient d'un socket est nettoyé (`cleanName`, vérification d'entier, bornes).
- **Nouvelle page** : ajouter sa route dans `server.js` (avant `express.static`), la documenter dans le README.
- Mettre à jour le README (section « Déroulé » ou « Limites connues ») quand un comportement visible par l'animateur change.

## 6. Façon de travailler

1. Discuter et valider la fonctionnalité avant de coder.
2. Un changement logique par commit.
3. Dans le doute (règle de jeu, équité, comportement en salle), demander.
4. Penser « soirée réelle » : Wi-Fi capricieux, téléphones qui se mettent en veille, animateur qui appuie deux fois sur une touche. Chaque action doit être idempotente ou annulable.
