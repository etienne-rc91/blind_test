# Musique pilotée par l’app : fichiers locaux et Spotify — conception

Date : 2026-10-28
Statut : construit le 2026-10-28

## 1. Intention

Aujourd’hui, pendant une manche buzzer, l’animateur joue la musique dans un lecteur à part et la met en pause lui-même quand une équipe buzze. Il doit jongler entre deux applications, retrouver le bon passage à chaque morceau, et la réponse n’est écrite nulle part dans la Régie.

L’animateur veut que l’app **joue elle-même la musique** d’une manche buzzer :

- préparer à l’avance, pour chaque morceau, le **passage** à faire écouter (début et fin) ;
- lancer le passage avec Espace ;
- **pause automatique** dès qu’une équipe buzze ;
- voir la **réponse dans la Régie** (et seulement là) ;
- sur une bonne réponse, un **petit son de victoire** ; sur une mauvaise, la musique **reprend où elle s’était arrêtée** ;
- le **Grand écran** montre qu’un morceau est en cours, puis **dévoile la réponse**.

La musique vient soit de **fichiers sur l’ordinateur**, soit de **Spotify** (l’animateur a un compte Premium, usage personnel, internet disponible en salle quand il utilise Spotify).

Le fonctionnement actuel (lecteur à part, l’app ne touche pas à la musique) **reste disponible**.

Vocabulaire : voir `CLAUDE.md`. Ce document s’appuie sur la conception des parties (`2026-10-28-parties-selection-creation-design.md`), déjà construite (`parties.html`, `creation.html`, `lib/parties.js`, `lib/live-edit.js`).

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Trois façons de jouer une manche buzzer : **libre** (comme aujourd’hui), avec des morceaux **fichiers**, avec des morceaux **Spotify** — ces deux dernières mélangeables dans une même manche.
- Préparer les morceaux dans la page Création : ajouter, écouter, choisir le passage à la souris, saisir la réponse.
- Jouer une manche avec morceaux au clavier, avec les mêmes touches qu’aujourd’hui.

**Non-objectifs (pas maintenant)**
- Jouer les morceaux dans le désordre (clic sur un morceau de la liste de la Régie). Espace joue toujours le suivant.
- Pochette pour les fichiers locaux (lecture des tags ID3…).
- Fondu, réglage de volume par morceau, autres services de musique (Deezer, Apple Music, YouTube).
- Playlists Spotify importées d’un coup.
- Musique dans les manches QCM.

**Anti-objectifs**
- **Une réponse qui fuite** vers les Buzzers ou le Grand écran avant d’être dévoilée.
- **Une panne de musique qui bloque la soirée** : si Spotify ou un fichier ne répond pas, les buzzers, les points et l’annulation doivent continuer de marcher ; l’animateur peut toujours finir en jouant la musique à côté.
- **Rendre internet obligatoire** pour une partie sans morceau Spotify.
- Casser les parties existantes : un CSV actuel reste lisible et se joue comme avant.
- Toucher à l’équité de l’arbitrage (rien avant le timestamp du `buzz`).

## 3. Contraintes

Celles de `CLAUDE.md` : pas de nouvelle dépendance npm sans en parler, pas de build, vanilla HTML/JS, serveur seule source de vérité, interface en français, Android/iPhone pour les Buzzers.

**Exception à la contrainte 1 (internet)**, à inscrire dans `CLAUDE.md` (diff en §8) : internet est autorisé **uniquement** pour les morceaux Spotify (connexion, recherche, lecture, pochette). Tout le reste de l’app, y compris les morceaux fichiers, fonctionne sans internet.

## 4. Décidé avec l’animateur

### 4.1 Modèle

- Une **manche buzzer** a **zéro ou plusieurs morceaux**.
  - Zéro morceau : mode **libre**, exactement comme aujourd’hui (c’est le cas de tous les CSV existants).
  - Au moins un morceau : l’app joue la musique.
- La **source se choisit morceau par morceau** : un fichier de l’ordinateur, ou un titre Spotify. Une même manche peut mélanger les deux.
- Un morceau a : une source, un **début** et une **fin** de passage, une **réponse** (texte affiché en Régie et dévoilé sur le Grand écran).
- Prévoir la source comme un type ouvert (`file`, `spotify`, puis `youtube` plus tard, voir `docs/backlog.md`) : le déroulé et la Régie ne dépendent que d’un lecteur commun (lancer à une position, pause, reprise, fin de passage), une couche par source.

### 4.2 Préparation (page Création, maquette « barre de temps », option A)

- Dans une manche buzzer : liste des morceaux (réordonnables comme les questions QCM), avec deux boutons **+ Fichier** et **+ Spotify**.
  - **+ Fichier** : choisir un fichier audio sur l’ordinateur ; l’app le copie dans `musiques/`.
  - **+ Spotify** : rechercher un titre sur Spotify et le choisir.
- Formulaire du morceau choisi :
  - lecteur (lecture / pause, temps courant / durée) ;
  - **barre de temps du morceau entier avec deux poignées Début / Fin**, déplaçables à la souris, et la position de lecture visible ;
  - **▶ Écouter le passage** (joue de Début à Fin) ;
  - **réponse** pré-remplie (« Artiste — Titre » pour Spotify, nom du fichier sans extension sinon), modifiable.

### 4.3 Déroulé à la Régie (maquette « Régie : jouer un morceau », validée)

| Action | Effet sur la musique | Effet sur le jeu (inchangé) |
|---|---|---|
| **Espace** | lance le passage du **morceau suivant de la liste**, depuis Début. **Sans effet tant que le morceau en cours n’est pas conclu par B ou F** (un double appui ne grille pas de morceau ; pour sauter un morceau : F puis Espace). Exception : musique en pause sans buzz (après un Z qui annule un F, par exemple) → Espace la fait reprendre | nouveau morceau, buzzers ouverts |
| **R** (bouton **Rejouer l’extrait**) | relance le passage **depuis Début** | aucun : buzzers, exclusions et points inchangés |
| **Buzz** (premier) | **pause automatique** | phase `buzzed` |
| **B** | musique reste coupée, **son de victoire**, réponse dévoilée sur le Grand écran | +1, buzzers fermés |
| **M** | **reprise là où elle s’était arrêtée** | équipe exclue, buzzers rouverts |
| **F** | musique arrêtée, réponse dévoilée sur le Grand écran | buzzers fermés |
| Fin du passage (Fin atteinte) | musique s’arrête, **rien n’est dévoilé** | buzzers **restent ouverts** ; l’animateur conclut avec B ou F |

Bloc central de la Régie pendant une manche avec morceaux :
- la **réponse** en gros, le numéro (« Morceau 3 / 12 ») et la source (📁 / ♪ Spotify) ;
- l’**avancement dans le passage** et l’état : lecture / en pause (buzz) / terminé ;
- l’équipe qui a buzzé et les suivantes (comme aujourd’hui) ;
- à droite, la **liste des morceaux** de la manche : joués ✓, en cours ▶, à venir ;
- un **témoin de connexion Spotify** si la manche contient des morceaux Spotify.

Les autres blocs de la Régie (Grand écran, Manches, Équipes, Rejoindre) ne changent pas.

**Rejouer l’extrait (décidé avec l’animateur ; détails décidés par Claude)** : bouton dans le bloc central, raccourci **R**. Disponible dès qu’un morceau est en cours : pendant la lecture, après la fin du passage, et après B ou F (pour faire réentendre la réponse à la salle ; la révélation reste affichée). Sans effet pendant qu’une équipe a buzzé et n’a pas encore été jugée (la pause est voulue). Annulable avec Z comme toute action animateur (Z remet la musique dans l’état d’avant, sans la relancer).

### 4.4 Grand écran (étape Jeu)

- Pendant un morceau : un indicateur **« ♪ Morceau n »**, en plus du classement et de l’équipe qui a buzzé.
- **Révélation** sur B (après le son de victoire) ou sur F : titre et artiste (le texte de la réponse), et la **pochette** pour un morceau Spotify. Elle reste affichée jusqu’au prochain Espace.
- Manches libres : rien ne change.

## 5. Choix de conception (décidés par Claude)

### 5.1 Qui joue le son

- **La Régie joue le son** (c’est le PC branché aux enceintes). Le serveur décide de l’état de lecture ; la Régie l’applique. Aucune règle de jeu côté navigateur : la Régie ne décide pas de mettre en pause, elle obéit à l’état reçu.
- État de lecture dans le jeu (nouveau, dans `lib/game.js`) : `audio` = `stopped | playing | paused | ended`, plus `concluded` / `outcome` (le morceau est conclu par B ou F) et l’index du morceau courant. Ce champ est modifiable par l’animateur : l’ajouter à `snapshot()` / `restore()`.
  - Espace → `playing` ; premier buzz → `paused` ; M → `playing` ; R → `playing` depuis Début ; B / F → `stopped` (avec révélation) ; la Régie signale la fin du passage par un événement `host:ended` → `ended`. R doit transmettre « depuis Début » à la Régie (par exemple un compteur de relance dans l’état), puisque `playing` → `playing` ne change pas l’état.
  - La position de reprise est celle où la Régie s’est mise en pause : elle n’est pas renvoyée au serveur (le serveur n’a pas besoin de la connaître).
- La pause au buzz part du `broadcast()` déjà déclenché par le buzz : rien n’est ajouté avant le timestamp du handler `buzz`.
- **Plusieurs Régies ouvertes** (deux onglets) : une seule doit jouer. La dernière Régie qui a envoyé une action, ou un bouton « Le son sort ici » : au constructeur de choisir le plus simple, mais jamais deux sons en même temps.
- Déverrouillage audio : la Régie a déjà « Le son s’active au premier clic ou à la première touche » ; Espace est un geste utilisateur, ça suffit pour `<audio>`.

### 5.2 Morceaux fichiers

- Lecture par un élément `<audio>` dans la Régie, servi par le serveur sous `/musiques/…` (statique, comme `/images`). Pause instantanée, sans internet.
- Dossier `musiques/` à côté du serveur (variable `MUSIQUES_DIR` pour les tests), ignoré par git, créé au démarrage.
- Upload depuis Création en HTTP, même règles que les images (nom nettoyé, suffixe `-2`… si même nom et contenu différent, réutilisé si même contenu). Formats : `mp3 m4a aac ogg oga wav flac`. Taille maximum : 50 Mo.
- Les fichiers peuvent aussi être déposés à la main dans `musiques/` et cités par leur nom dans le CSV.

### 5.3 Morceaux Spotify

- **Lecture via le Spotify Web Playback SDK dans la Régie** (et dans Création pour l’écoute) : la page devient elle-même un appareil Spotify. Avantages : pas besoin de l’app Spotify ouverte, pause commandée localement (pas d’aller-retour par internet), positionnement précis. Le SDK est chargé depuis Spotify : acceptable, c’est dans l’exception internet, et **seulement** dans les pages qui en ont besoin et seulement si la partie contient un morceau Spotify (une partie sans Spotify ne charge rien de distant).
  - À vérifier par le constructeur dès le début : le SDK exige un contexte sécurisé ; `http://localhost` / `http://127.0.0.1` en est un, la Régie et Création sont ouvertes sur le PC. Il exige aussi un navigateur avec DRM (Chrome, Edge, Firefox ; Safari à vérifier).
  - **Repli** si le SDK pose problème : piloter l’app Spotify du PC via la Web API (`/me/player/play` avec `position_ms`, `/me/player/pause`). Même contrat côté jeu ; seule la couche lecteur de la Régie change.
- **Connexion** : l’animateur crée une app sur le tableau de bord développeur Spotify et fournit son **Client ID** (variable `SPOTIFY_CLIENT_ID`, ou saisie une fois dans l’app et stockée). Autorisation OAuth avec **PKCE** (pas de secret client), redirection vers `http://127.0.0.1:<PORT>/spotify/callback` (Spotify refuse `localhost` mais accepte l’IP de bouclage en HTTP — à revérifier). Jetons (accès + rafraîchissement) gardés **côté serveur** dans `spotify.json` (ignoré par git), rafraîchis par le serveur. La page reçoit un jeton d’accès frais via une route protégée par la clé hôte.
- Bouton **Se connecter à Spotify** dans la Régie (et dans Création), témoin connecté / déconnecté. Recherche de titres faite **par le serveur** (route `/api/spotify/search`, clé hôte).
- **Pochette** : pas stockée dans le CSV ; récupérée au moment de jouer (le serveur demande les infos du titre à Spotify et les garde en mémoire). Si elle n’arrive pas, la révélation se fait sans pochette.
- **Vérification avant la soirée** : quand on lance (« Jouer ») une partie qui contient au moins un morceau Spotify, la Sélection et la Régie affichent l’état de la connexion Spotify et préviennent si elle n’est pas active. Pas de blocage : l’animateur peut jouer quand même.
- Pas de dépendance npm : OAuth PKCE et appels Web API faits avec `crypto` et `fetch` de Node 18+.

### 5.4 Format CSV

- Trois colonnes ajoutées **à la fin** de l’en-tête : `manche;type;question;image;A;B;C;D;reponse;musique;debut;fin`.
  - L’ancien en-tête à 9 colonnes reste accepté (aucune musique).
  - Une manche buzzer **libre** : une seule ligne, comme aujourd’hui.
  - Une manche buzzer **avec morceaux** : une ligne par morceau, même nom de manche sur chaque ligne (comme le QCM). `musique` = nom de fichier du dossier `musiques/` **ou** identifiant Spotify `spotify:track:<id>` ; `debut` et `fin` en `m:ss` (secondes entières, `1:05`) ; `reponse` = texte de la réponse. Les autres colonnes vides.
  - Règle « une manche buzzer tient sur une seule ligne » remplacée : plusieurs lignes autorisées si chacune a une `musique`. Une ligne buzzer sans musique dans une manche qui a des morceaux est une erreur (ou une ligne de brouillon vide, comme pour le QCM).
- Écriture : `writeCsv` écrit toujours l’en-tête à 12 colonnes.
- Validation stricte (pour jouer) : source présente, fichier existant dans `musiques/` (Spotify : format d’identifiant seulement, pas d’appel réseau), `debut < fin`, réponse non vide. En brouillon, ces manques deviennent des « problèmes » listés, comme pour les questions QCM (« Années 80, morceau 4 : fin avant le début »).
- Fin au-delà de la durée réelle du morceau : non vérifiable à l’import ; la lecture s’arrête à la fin du morceau, traitée comme une fin de passage.

### 5.5 Avancement, sauvegarde, annulation

- Avancement par manche buzzer avec morceaux : index du prochain morceau, rangé comme l’avancement QCM (par position de manche), sauvegardé dans `scores.json`. `round.number` reste le compteur affiché pour les manches libres.
- Espace après le dernier morceau de la manche : rien ne se lance, la Régie affiche « Manche terminée — Suivante ▶ ».
- **Z** restaure l’état, `audio` compris, et la Régie applique l’état restauré :
  - Z après B ou F : retire la révélation et les points (comme aujourd’hui) ; la musique **ne repart pas** (`paused`, reprise possible avec M).
  - Z après M : la musique se remet en pause, l’équipe n’est plus exclue.
  - Z après Espace : la musique s’arrête, l’avancement revient au morceau précédent.
  - Z après B ou F sur un passage déjà terminé : retour à `ended`, pas `paused`.
  - Règle générale : un Z ne relance jamais la musique tout seul.
- Buzz après la fin du passage puis M : les buzzers rouvrent, la musique reste silencieuse (elle ne joue jamais au-delà de Fin ; R permet de réécouter).
- Au redémarrage du serveur, le morceau en cours repart fermé et `stopped` (comme aujourd’hui).

### 5.6 Ce que chaque écran reçoit

- `publicState({ role: 'host' })` : liste complète des morceaux de la manche (réponse comprise), `audio`, morceau courant.
- `publicState({ role: 'screen' })` : numéro du morceau et `playing` (lecture en cours) ; la réponse et la pochette **seulement une fois dévoilées**.
- `publicState({ role: 'player' })` : rien de nouveau. Jamais de réponse, de nom de fichier ni d’identifiant Spotify (un nom de fichier ou un titre Spotify donnerait la réponse).
- Les routes `/musiques/…` sont servies sans clé (comme `/images`) ; c’est acceptable car le nom des fichiers n’est envoyé qu’à la Régie. Le constructeur peut les protéger par la clé hôte si c’est simple.

### 5.7 Modifier la partie en cours

Même règle que pour les questions QCM (`lib/live-edit.js`) appliquée aux morceaux : dans une manche avec morceaux déjà commencée (au moins un morceau lancé), pas de suppression ni de réordonnancement des morceaux ; corrections (réponse, début, fin, source d’un morceau pas encore joué) et ajouts en fin de liste acceptés. Passer une manche libre en manche avec morceaux (ou l’inverse) = changement de type : refusé pendant la partie si la manche est commencée.

### 5.8 Son de victoire

Synthétisé en WebAudio dans la Régie, comme le bip actuel (aucun fichier, aucune dépendance) : une courte fanfare de 3–4 notes. Joué sur B dans une manche avec morceaux. Dans une manche libre, B reste silencieux comme aujourd’hui.

### 5.9 Pannes en soirée

- Fichier introuvable ou illisible, Spotify déconnecté, titre indisponible : la Régie affiche l’erreur sur le morceau (« Lecture impossible : … ») ; le jeu continue (buzzers, B, M, F, Z marchent), l’animateur joue la musique à côté.
- Jeton Spotify expiré : rafraîchi par le serveur sans action de l’animateur.
- Le compte Spotify joué ailleurs en même temps (téléphone) prend la main : noté dans les Limites connues du README.

## 6. Ordre de construction

1. **Format et modèle** : colonnes `musique;debut;fin`, `buildSections` / `writeCsv`, avancement des morceaux, `audio` dans le jeu (avec `snapshot` / `restore`), contenu de `publicState` par rôle, règles d’édition à chaud. Tests `node --test`.
2. **Régie avec fichiers** : `musiques/` servi, lecteur `<audio>`, bloc central (maquette), pause au buzz, reprise sur M, son de victoire, fin de passage, Z.
3. **Grand écran** : indicateur de morceau, révélation sur B / F.
4. **Création avec fichiers** : + Fichier (upload), barre de temps à deux poignées, Écouter le passage, réponse.
5. **Spotify** : connexion PKCE, jetons, recherche, lecteur SDK dans la Régie et Création, pochette, témoin et vérification au lancement.
6. **Docs** : README (préparer des morceaux, connexion Spotify, déroulé, limites), `CLAUDE.md` (exception internet, architecture).

Après l’étape 4, une soirée complète en fichiers locaux est jouable, sans internet. Spotify vient ensuite.

## 7. Laissé au constructeur

- Style exact des pages, dans le style existant (variables CSS, thème sombre/clair, Régie tenant dans une fenêtre).
- Forme exacte des événements socket, des routes et des réponses JSON.
- Rendu de la barre de temps (glisser des poignées à la souris ; clavier en secours souhaitable).
- Présentation de la révélation et de l’indicateur sur le Grand écran.
- Mécanisme « une seule Régie joue le son » (§5.1).

## 8. Modification de `CLAUDE.md` proposée

```diff
-1. **Aucune dépendance à internet pendant la soirée.** Pas de CDN, pas de police distante, pas d'appel à un service externe. Tout est servi par le serveur local. `npm install` se fait à la maison.
+1. **Aucune dépendance à internet pendant la soirée.** Pas de CDN, pas de police distante, pas d'appel à un service externe. Tout est servi par le serveur local. `npm install` se fait à la maison.
+   **Seule exception : les morceaux Spotify** (connexion, recherche, lecteur Spotify, pochettes). Ils exigent internet, et uniquement eux : une partie sans morceau Spotify ne charge rien de distant, et une panne de Spotify ne bloque jamais le jeu.
```

Plus, dans l’architecture : `musiques/` (ignoré par git), `spotify.json` (jetons, ignoré par git), et le vocabulaire **Passage** (extrait d’un morceau, de Début à Fin) et **Révélation** (réponse dévoilée sur le Grand écran).
