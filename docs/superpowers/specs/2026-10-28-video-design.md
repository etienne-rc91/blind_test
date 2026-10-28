# Vidéos dans les manches buzzer et QCM : YouTube et fichiers vidéo — conception

Date : 2026-10-28
Statut : construit le 2026-10-28

## 1. Intention

L’animateur veut, dans une manche buzzer, des morceaux qui sont des **vidéos** (clips, génériques, scènes de film), affichées en grand devant la salle, avec **exactement le même déroulé que la musique** : Espace lance l’extrait, un buzz met en pause, M reprend, B conclut.

Deux sources :
- une vidéo **YouTube** (lien collé dans Création) ;
- un **fichier vidéo** de son ordinateur (en pratique des extraits qu’il a lui-même téléchargés depuis YouTube, en mp4).

Vocabulaire : voir `CLAUDE.md`. Ce document étend la conception Musique (`2026-10-28-musique-design.md`, construite) : morceaux d’une manche buzzer, passage Début/Fin, déroulé Espace / buzz / M / B / F / R / Z, révélation, lecteur commun `public/players.js`. Tout ce qui n’est pas dit ici suit cette conception.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Deux nouvelles sources de morceau : **YouTube** et **fichier vidéo**, mélangeables avec les fichiers audio et les titres Spotify dans une même manche.
- La vidéo s’affiche **sur le Grand écran**, image et son. La Régie pilote et montre la réponse et l’avancement, comme pour la musique.
- Préparation dans Création avec les outils existants (barre de temps à deux poignées, Écouter le passage, réponse), plus un aperçu de la vidéo.
- **Extrait vidéo dans une question QCM** (*décidé avec l’animateur, 2026-10-28*) : un extrait de question QCM peut aussi être une vidéo YouTube ou un fichier vidéo, affiché sur le Grand écran (voir §5.6).

**Non-objectifs (pas maintenant)**
- Afficher la vidéo dans la Régie.
- Bloquer les publicités YouTube, télécharger des vidéos depuis l’app, playlists YouTube.
- Image masquée (son seul) pendant l’extrait.

**Anti-objectifs**
- **Une réponse qui fuite** : le Buzzer ne reçoit jamais rien du morceau ; le Grand écran ne montre que la vidéo (et ni le titre YouTube, ni les suggestions de YouTube pendant une pause, ni le nom du fichier).
- **Une panne qui bloque la soirée** : YouTube indisponible, vidéo interdite d’intégration, fichier illisible ou Grand écran fermé → la Régie affiche l’erreur, buzzers, points et Z continuent ; l’animateur conclut avec B ou F.
- **Rendre internet obligatoire** pour une partie sans morceau YouTube (les fichiers vidéo marchent hors ligne).
- Casser les parties existantes : tout CSV et toute partie actuels se jouent comme avant.
- Toucher à l’équité (rien avant `performance.now()` dans le handler `buzz`).

## 3. Contraintes

Celles de `CLAUDE.md` : pas de nouvelle dépendance npm, pas de build, vanilla HTML/JS, serveur seule source de vérité, toute action animateur annulable, interface en français.

**Exception internet** : étendue aux morceaux **YouTube** (lecteur YouTube, infos et miniature d’une vidéo), au même titre que Spotify et seulement pour eux. Diff de `CLAUDE.md` en §8.

## 4. Décidé avec l’animateur

### 4.1 Déroulé

Identique à la musique (conception Musique §4.3) pour un morceau vidéo : **Espace** lance l’extrait depuis Début (sans effet tant que le morceau en cours n’est pas conclu), **buzz** = pause automatique, **M** = reprise là où la vidéo s’était arrêtée, **B** = fanfare (jouée par la Régie) et révélation, **F** = arrêt et révélation, **R** = rejouer l’extrait, **fin du passage** = la vidéo s’arrête, buzzers ouverts, **Z** ne relance jamais la lecture.

### 4.2 Où passe la vidéo

- **La vidéo s’affiche sur le Grand écran**, image et son (la salle la voit). Le Grand écran tourne sur le PC de la Régie (fenêtre glissée sur le projecteur) : le son sort des mêmes enceintes.
- **La Régie ne montre pas la vidéo** : bloc central identique à la musique (réponse en gros, « Morceau i / n » avec la source, barre d’avancement et état, liste des morceaux), sources affichées 🎬 (fichier vidéo) et ▶ YouTube.

### 4.3 Sources

- **YouTube** : un lien YouTube collé dans Création.
- **Fichier vidéo** : extraits courts téléchargés par l’animateur, formats `mp4 webm m4v mov`, **500 Mo maximum** par fichier.

## 5. Choix de conception (décidés par Claude)

### 5.1 Modèle et format

- Deux sources s’ajoutent à `file` et `spotify` : **`video`** (fichier du dossier `videos/`) et **`youtube`** (identifiant de 11 caractères `[A-Za-z0-9_-]{11}`). Un morceau garde la forme `{ source, ref, start, end, answer }`.
- Un morceau est **« vidéo »** si sa source est `video` ou `youtube` ; il se lit sur le Grand écran. Les sources `file` et `spotify` restent lues par la Régie.
- CSV : la colonne `musique` accepte en plus
  - `youtube:<id>`, ou un lien `https://www.youtube.com/watch?v=<id>`, `https://youtu.be/<id>`, `https://www.youtube.com/shorts/<id>` (paramètres ignorés, y compris `t=`) → `youtube` ; écrit `youtube:<id>` ;
  - un nom de fichier dont l’extension est vidéo (`mp4 webm m4v mov`) → `video` (dossier `videos/`) ; une extension audio reste `file` (`musiques/`).
- Validation stricte : fichier présent dans `videos/` ; YouTube : format de l’identifiant seulement (pas d’appel réseau). Manques en brouillon comme pour les autres morceaux.
- Dossier `videos/` à côté du serveur (variable `VIDEOS_DIR` pour les tests), ignoré par git, servi sous `/videos/…` (comme `/musiques`).
- Upload depuis Création : `POST /api/videos?filename=…`, mêmes règles de nom que les musiques, **écrit en flux sur le disque** (pas tout le fichier en mémoire : 500 Mo), 413 `Fichier trop gros (500 Mo maximum pour une vidéo).`

### 5.2 Le Grand écran lit la vidéo

- Le serveur reste la source de vérité : l’état `song` (index, `audio`, `seq`, `audible`, `concluded`, `outcome`) ne change pas. Pour un morceau vidéo, **c’est le Grand écran qui l’applique** (lecture si `audible`, pause sinon, Début à chaque nouvelle clé `section:index:seq`) ; la Régie n’ouvre aucun lecteur pour lui.
- `publicState({ role: 'screen' })` gagne, **seulement pour un morceau vidéo en cours**, `song.media = { source, ref, start, end }` (nécessaire pour lire). La réponse reste réservée à la révélation. Le Buzzer ne reçoit toujours rien. (Un nom de fichier vidéo peut contenir la réponse : il n’est jamais affiché, seulement utilisé pour charger la vidéo.)
- **Fin du passage** : le Grand écran envoie `screen:ended { seq }`. Le serveur ne l’accepte que du **Grand écran qui lit** (voir ci-dessous). Ce n’est pas une action annulable. Le Grand écran relaie aussi à la Régie, via le serveur, la position (pour la barre d’avancement) et les erreurs de lecture.
- **Affichage pendant un morceau vidéo** (étape Jeu) : la vidéo occupe la zone principale à la place du classement ; pendant une pause au buzz, le **bandeau de l’équipe couvre entièrement la vidéo** ; à la révélation, le panneau de révélation couvre la vidéo, avec la **miniature YouTube** (`https://i.ytimg.com/vi/<id>/hqdefault.jpg`) pour un morceau YouTube et sans image pour un fichier vidéo ; entre deux morceaux, le classement revient.
- **La vidéo n’est visible que pendant qu’elle joue** (*décidé par Claude*) : dès qu’elle n’est pas en lecture (chargement, pause au buzz, pause sans buzz après un Z, passage terminé, conclue), elle est entièrement couverte — par le bandeau de l’équipe pendant un buzz, par le panneau de révélation après B/F, sinon par un cache neutre portant « 🎬 Morceau n / total ». YouTube affiche son titre et ses suggestions dès qu’une vidéo est en pause ou en attente : on ne les montre jamais. Le panneau de révélation d’un morceau vidéo couvre donc toute la zone vidéo.
- **R après B ou F** (*décidé par Claude*) : la vidéo rejoue visible, la révélation se réduit à une bande en bas de l’écran (réponse et miniature) ; à la fin du passage, la révélation reprend toute la zone. Pour cela, l’état du Grand écran garde `media` et la révélation après conclusion.
- **Un seul Grand écran lit la vidéo** (*décidé par Claude*) : celui qui est ouvert **sur le PC du serveur** (connexion depuis `127.0.0.1`/`::1`) ; s’il y en a plusieurs, le dernier ouvert ; un Grand écran ouvert depuis un autre appareil ne lit jamais (un téléphone curieux ne peut pas prendre la main) et ne reçoit pas `media` : il affiche le cache neutre. S’il n’y a aucun Grand écran sur le PC, rien ne lit et la Régie prévient.
- **Hors de l’étape Jeu**, le Grand écran qui lit ne lit rien (vidéo et son arrêtés) ; la Régie prévient « Grand écran à l’étape X : passez à Jeu pour lancer la vidéo ». Le serveur ignore un `screen:ended` reçu hors Jeu.
- **Activer le son du Grand écran** : les navigateurs refusent de lancer une vidéo avec son dans une page qui n’a reçu aucun clic. Quand la partie contient un morceau vidéo, le Grand écran affiche une fois « Cliquez pour activer la vidéo » (un clic dans la fenêtre du projecteur suffit, avant la soirée).
- **Grand écran absent ou pas à l’étape Jeu** : la Régie affiche un avertissement au-dessus du bloc du morceau vidéo (« Aucun Grand écran ouvert », « Grand écran à l’étape X : passez à Jeu pour voir la vidéo », « Le Grand écran attend un clic pour activer la vidéo »). Le serveur connaît les Grands écrans connectés et l’étape ; le Grand écran signale « son activé ». Le jeu continue.

### 5.3 Lecteurs

- `public/players.js` gagne deux lecteurs avec la même interface (`load/seek/play/pause/position/duration/onError`) :
  - **`video`** : un élément `<video>` (`/videos/<ref>`), sans contrôles ;
  - **`youtube`** : l’**API IFrame de YouTube** (`https://www.youtube.com/iframe_api`, injectée seulement au premier morceau YouTube), paramètres sans contrôles ni suggestions de fin (`controls=0`, `disablekb=1`, `rel=0`, `iv_load_policy=3`, `fs=0`, `playsinline=1`) ; `seekTo`/`playVideo`/`pauseVideo`/`getCurrentTime`/`getDuration`.
- Ces lecteurs prennent un **conteneur** où s’afficher (le Grand écran, l’aperçu de Création) ; les lecteurs audio existants n’en ont pas besoin.
- Erreurs YouTube traduites : 101/150 → `Le propriétaire de cette vidéo interdit sa lecture ailleurs que sur YouTube.` ; 100 → `Vidéo introuvable ou privée.` ; 2 → `Lien YouTube invalide.` ; 5 → `Lecture impossible dans ce navigateur.` ; plus les délais (5 s) comme pour Spotify.
- **Publicités** : une publicité au lancement décale le début ; la position (`getCurrentTime`) ne compte que la vidéo, la fin du passage reste juste. Rien de plus à faire.

### 5.4 Création

- Boutons **+ Vidéo** (fichier, upload dans `videos/`) et **+ YouTube** (champ pour coller un lien, bouton Ajouter), à côté de + Fichier et + Spotify.
- **+ YouTube** : le serveur récupère le titre et la miniature (`GET /api/youtube/info?id=`, via l’oEmbed public de YouTube, sans clé) ; réponse pré-remplie avec le titre de la vidéo, modifiable ; durée lue par le lecteur d’aperçu. Une vidéo interdite d’intégration est signalée dès l’ajout (erreur du lecteur d’aperçu) et le morceau n’est pas créé.
- **+ Vidéo** : réponse pré-remplie avec le nom du fichier sans extension (comme les musiques) ; fin par défaut `min(30, durée)`.
- L’éditeur d’un morceau vidéo affiche **l’aperçu de la vidéo** (petit, au-dessus de la barre de temps) ; mêmes poignées, Écouter le passage, réponse.

### 5.5 Le reste

- Live edit, sauvegarde, redémarrage, Z : règles de la conception Musique, inchangées (la source compte comme une source de plus).
- Fanfare : jouée par la Régie, comme aujourd’hui.
- Sélection : « Jouer » ajoute l’avertissement `Cette partie contient des vidéos YouTube : une connexion internet est nécessaire.` quand elle en contient.

### 5.6 Extrait vidéo dans une question QCM

S’appuie sur la conception « Extrait musical dans une question QCM » (`2026-10-28-qcm-extrait-design.md`) : déroulé page de la question → extrait → question (automatique à Fin) → propositions → compte à rebours → révélation ; Entrée ignorée pendant l’extrait ; bouton « Afficher la question » ; R rejoue l’extrait ; Z ne relance jamais la lecture. Tout ce qui n’est pas dit ici suit cette conception.

- **Sources** : un extrait QCM accepte `video` et `youtube` en plus de `file` et `spotify` (`isExtract`), même CSV (colonnes `musique;debut;fin` sur une ligne `qcm`), mêmes boutons + Vidéo / + YouTube dans l’éditeur de question de Création, avec l’aperçu. La réponse d’une question reste la lettre A–D : le titre YouTube ne pré-remplit rien.
- **Pendant l’extrait** (étape `listening`) : le Grand écran qui lit affiche la vidéo en grand à la place de la page de la question ; mêmes règles de cache que §5.2 (visible seulement pendant qu’elle joue, sinon cache neutre « 🎬 Question n / total »). À Fin, la vidéo disparaît et la question s’affiche. « Afficher la question » coupe la vidéo.
- **R une fois la question affichée** (*décidé avec l’animateur : option 1*) : la vidéo reprend tout l’écran pendant qu’elle rejoue, puis la question, les propositions (ou la révélation) reviennent à la fin du passage. Contrairement à l’extrait audio, le Grand écran change donc pendant un R.
- **R pendant le compte à rebours** (*décidé par Claude*) : le compte à rebours continue ; une bande en bas de la vidéo garde visibles le temps restant et les propositions A–D (les équipes répondent sur leur Buzzer, qui n’affiche que les lettres). Le verrouillage à zéro ne coupe pas la vidéo (règle de la conception QCM avec extrait).
- **Le serveur** : `media` est envoyé au Grand écran pour l’extrait vidéo de la question en cours, de l’étape `listening` jusqu’à « Question suivante » ; `screen:ended` du Grand écran qui lit fait passer de `listening` à `question` comme la fin de passage de la Régie pour un extrait audio. La Régie n’ouvre aucun lecteur pour un extrait vidéo et affiche les mêmes avertissements (§5.2).
- **Fuite de réponse** : rien ne change — le Buzzer ne reçoit rien, le Grand écran n’affiche ni le titre YouTube ni le nom du fichier.

## 6. Ordre de construction

1. **Modèle et format** : sources `video`/`youtube` dans `lib/songs.js`, CSV, `videos/` (statique, upload en flux), `media` dans l’état du Grand écran, `screen:ended` et le Grand écran qui lit. Tests.
2. **Grand écran avec fichiers vidéo** : lecteur `video`, affichage (vidéo, bandeau en pause, révélation), activation du son, avertissements dans la Régie.
3. **Création avec fichiers vidéo** : + Vidéo, aperçu.
4. **YouTube** : lecteur IFrame, `/api/youtube/info`, + YouTube, miniature, erreurs.
5. **Extrait vidéo en QCM** (§5.6) : sources vidéo dans `isExtract`, Grand écran pendant `listening` et pendant un R, éditeur de question dans Création.
6. **Docs** : README, `CLAUDE.md`.

Après l’étape 3, les vidéos locales sont jouables sans internet.

## 7. Coordination avec le QCM avec extrait

Une conception « Extrait musical dans une question QCM » (`2026-10-28-qcm-extrait-design.md`, construite le 2026-10-28) est écrite en parallèle. Elle touche les mêmes fichiers (`lib/songs.js`, `lib/game-file.js`, `public/players.js`, `public/host.html`, `public/creation.html`) et garde la vidéo hors de son périmètre. Les deux constructions ne doivent pas tourner en même temps. **Décidé avec l’animateur : le QCM avec extrait est construit d’abord** (déjà en cours). Le plan des vidéos s’écrit ensuite, à partir du `main` où le QCM avec extrait a été fusionné ; il tient compte de ce que cette construction aura changé (notamment l’état `song` utilisé aussi en manche QCM, que la vidéo réutilise dans les deux manches, §5.6).

Ce que la construction du QCM avec extrait a changé (branche `feat/qcm-extrait`, relue le 2026-10-28) et dont le plan vidéo tient compte :
- `lib/songs.js` sépare `isExtract` (source + Début/Fin) et `isSong` (extrait + réponse). Les sources `video` et `youtube` sont acceptées par `isExtract`, donc pour un morceau de manche buzzer comme pour un extrait de question QCM (*décidé avec l’animateur*, §5.6).
- Les paramètres du serveur se lisent aussi dans `.env` (Node ≥ 22.9) : `VIDEOS_DIR` doit être ajouté à `.env.example`.
- Le vocabulaire de `CLAUDE.md` a de nouvelles lignes (Déroulé d’une question, Extrait, Passage) ; la modification proposée au §9 s’applique sur cette version.

## 8. Laissé au constructeur

- Mise en page exacte de la vidéo sur le Grand écran (proportions, bandes noires) et de l’aperçu dans Création.
- Mécanisme exact du « Grand écran qui lit » et de l’indicateur « son activé ».
- Forme des routes et des événements.

## 9. Modification de `CLAUDE.md` proposée

```diff
-   **Seule exception : les morceaux Spotify** (connexion, recherche, lecteur Spotify, pochettes). Ils exigent internet, et uniquement eux : une partie sans morceau Spotify ne charge rien de distant, et une panne de Spotify ne bloque jamais le jeu.
+   **Seules exceptions : les morceaux Spotify et YouTube** (connexion et recherche Spotify, lecteurs Spotify et YouTube, pochettes et miniatures). Ils exigent internet, et uniquement eux : une partie sans morceau Spotify ni YouTube ne charge rien de distant, et une panne de ces services ne bloque jamais le jeu.
```

Plus, dans l’architecture : `videos/` (ignoré par git).
