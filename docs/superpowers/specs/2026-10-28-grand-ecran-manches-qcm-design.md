# Grand écran, manches et QCM — conception

Date : 2026-10-28
Statut : en attente de validation

## 1. Intention

Aujourd'hui, l'animateur fait tout depuis la **Régie** (son PC) et les joueurs n'ont que leur **Buzzer** (téléphone). Rien n'est montré à la salle. L'animateur veut :

1. un **Grand écran** projeté derrière lui, face aux équipes, dont il choisit le contenu depuis la Régie selon l'étape de la soirée ;
2. découper la soirée en **manches** thématiques préparées à l'avance (« Cinéma », « Années 80 »…), avec un **bilan des scores par manche** ;
3. un second type de manche, le **QCM** : toutes les équipes répondent en même temps (A/B/C/D) avant la fin d'un compte à rebours.

Le vocabulaire (Régie, Buzzer, Grand écran) est fixé dans `CLAUDE.md`. On ajoute :

| Terme | Sens |
|---|---|
| **Étape** | Ce qu'affiche le Grand écran : Installation, Jeu, Bilan, Fin. |
| **Manche** | Un thème de la soirée, d'un type donné (buzzer ou QCM). |
| **Morceau** | Une question d'une manche buzzer, lancée avec Espace (existant). |
| **Question** | Une question d'une manche QCM, décrite dans le fichier. |

Noms dans le code : voir §5. Le mot `phase` reste réservé à l'état des buzzers (`closed | open | buzzed`).

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Le Grand écran suit la soirée sans aucune manipulation sur l'ordinateur qui l'affiche, une fois ouvert.
- L'animateur prépare toute sa soirée dans un seul fichier CSV et l'importe dans la Régie.
- Les scores sont comptés par manche ; le Bilan les montre ; le Fin montre un podium.
- Une manche QCM se joue entièrement depuis la Régie et les Buzzers.

**Non-objectifs (pas maintenant)**
- Indices pendant une manche buzzer (évoqué pour plus tard).
- Bonus de rapidité au QCM.
- Durée de compte à rebours par question.
- Éditer les manches dans la Régie (on corrige le fichier et on réimporte).
- Afficher le texte des propositions sur le Buzzer.

**Anti-objectifs (ce serait un échec même si ça marche)**
- Quoi que ce soit qui dépende d'internet pendant la soirée (images comprises).
- Un Grand écran qui révèle une information avant que l'animateur le décide (bonne réponse, choix des équipes pendant le compte à rebours).
- Une action de la Régie qu'on ne peut pas annuler avec Z.
- Une erreur dans le fichier découverte devant les joueurs au lieu de l'être à l'import.
- Casser le déroulé actuel : sans fichier importé, la soirée se joue exactement comme aujourd'hui.

## 3. Contraintes

Celles de `CLAUDE.md` s'appliquent, en particulier : pas d'internet, pas de nouvelle dépendance npm, pas de build, le serveur est l'unique source de vérité, toute action Régie passe par `hostOnly` (annulable).

## 4. Ce qui a été décidé avec l'animateur

### 4.1 Grand écran et étapes

- Nouvelle page `public/screen.html`, route `/screen`. Lecture seule, aucun bouton, pensée pour un projecteur en plein écran (texte très lisible de loin).
- La Régie choisit l'étape parmi **Installation, Jeu, Bilan, Fin**, dans n'importe quel ordre.
- L'étape ne change **que** le Grand écran. Buzzers et touches de la Régie fonctionnent comme d'habitude quelle que soit l'étape.
- L'étape est tenue par le serveur et sauvegardée : un Grand écran rechargé ou un serveur redémarré revient sur la bonne étape.
- Changer d'étape s'annule avec Z.

Contenu par étape :

| Étape | Grand écran |
|---|---|
| **Installation** | QR code en grand + adresse à taper, et la liste des équipes qui se remplit au fur et à mesure qu'elles rejoignent. |
| **Jeu** (manche buzzer) | Nom de la manche en cours, classement général trié (plus haut score en haut), et l'équipe qui vient de buzzer mise en avant. Pas de QR code. |
| **Jeu** (manche QCM) | Voir §4.4. |
| **Bilan** | Tableau : une ligne par équipe, une colonne par manche, une colonne Total ; trié par total. |
| **Fin** | Podium à 3 marches (voir règle ci-dessous). |

**Règle du podium** (décidée par l'animateur) : classement dense sur le score total. Les ex aequo partagent la même place, et la place suivante est la suivante dans l'ordre, sans trou : 12, 12, 10 points donnent les places 1, 1, 2. Toutes les équipes classées 1re, 2e ou 3e montent sur le podium, quel que soit leur nombre (cinq équipes ex aequo 3e montent toutes les cinq). Une marche doit donc pouvoir afficher plusieurs noms.

### 4.2 Manches

- Une partie a une liste ordonnée de manches, chacune avec un nom et un type (`buzzer` ou `qcm`).
- Une seule manche est **en cours** à la fois. La Régie permet de passer à la suivante (et de revenir à une précédente).
- Chaque point gagné ou retiré (B, boutons +/−, révélation QCM) est compté **dans la manche en cours**.
- Score total d'une équipe = somme de ses manches. C'est lui qui trie le classement en Jeu et qui fait le podium.
- Sans fichier importé : une seule manche buzzer « Manche 1 ». Les scores d'un ancien `scores.json` (sans manches) sont rangés dans cette manche.
- Les manches et les scores par manche sont sauvegardés dans `scores.json`.
- Annuler avec Z retire le point de la bonne manche.

### 4.3 Fichier de la soirée (CSV)

Un seul fichier, une ligne par question, importé depuis la Régie (bouton « Importer les manches »).

```
manche;type;question;image;A;B;C;D;reponse
Cinéma;buzzer;;;;;;;
Culture G;qcm;Quelle est la capitale de l’Australie ?;;Sydney;Canberra;Melbourne;Perth;B
Culture G;qcm;Qui est cet acteur ?;acteur1.jpg;Brad Pitt;Tom Cruise;Johnny Depp;Keanu Reeves;C
Années 80;buzzer;;;;;;;
```

- Ligne d'en-tête obligatoire avec ces noms de colonnes.
- Manche **buzzer** : une ligne, nom + type, le reste vide.
- Manche **QCM** : une ligne par question, même nom de manche sur chaque ligne. L'ordre des lignes = ordre de la soirée.
- Pour une question QCM : `question` et `image` sont facultatives chacune mais au moins une des deux est remplie ; `A`, `B`, `C`, `D` obligatoires ; `reponse` vaut `A`, `B`, `C` ou `D`.
- `image` est un **nom de fichier** placé dans le dossier `images/` du serveur, préparé avant la soirée. Pas d'URL web.
- À l'import, le serveur vérifie tout (colonnes, types, réponses, existence de chaque image) et refuse le fichier en entier en cas d'erreur, avec un message qui cite la ligne fautive.
- Réimporter alors que des points ont déjà été donnés est refusé : il faut d'abord remettre les scores à zéro.

### 4.4 Manche QCM

Règles :
- 1 point par bonne réponse, pour toutes les équipes qui ont bon. Pas de bonus de rapidité.
- Une équipe peut changer de réponse tant que le compte à rebours tourne ; seule la dernière compte. À zéro, les réponses sont bloquées.
- Le Buzzer affiche 4 gros boutons **A, B, C, D** (lettres seules) et la réponse choisie.
- Durée du compte à rebours réglée une fois dans la Régie, pour toutes les questions. Valeur par défaut : 20 s.
- Une seule personne par équipe en pratique (organisation de la soirée). Le serveur garde le comportement actuel : plusieurs téléphones peuvent rejoindre la même équipe ; dans ce cas la dernière réponse reçue pour l'équipe compte.

Déroulé d'une question, piloté depuis la Régie (chaque étape annulable avec Z) :

| Étape de la question | Régie (bouton) | Grand écran | Buzzer |
|---|---|---|---|
| 1. Question | Afficher la question | Nom de la manche, « Question 3/10 », image et/ou texte | Attente |
| 2. Propositions | Afficher les propositions | + les 4 propositions A–D | Boutons A–D visibles, inactifs |
| 3. Compte à rebours | Lancer le compte à rebours | + temps restant en gros, « 5/8 équipes ont répondu » (sans dire quoi) | Boutons actifs |
| 4. Bloqué | (automatique à zéro) | « Temps écoulé » | Réponse figée |
| 5. Révélation | Révéler | Bonne proposition mise en valeur, les autres estompées, nombre d'équipes par lettre | Bonne ou mauvaise réponse |
| — | Question suivante | Classement général (entre deux questions) | Attente |

La Régie voit en permanence la bonne réponse (pour l'animateur seul) et la réponse de chaque équipe en direct.

## 5. Choix de conception (décidés par Claude, pas par l'animateur)

À relire ; chacun peut être changé.

- **Nommage code** : `stage` = étape (`setup | play | summary | final`), `section` = manche, `question` = question QCM, `qcm` reste le nom du type. Rien de `round` existant n'est renommé (il compte les morceaux).
- **Parsing CSV côté serveur**, sans dépendance : la Régie lit le fichier et envoie son contenu brut au serveur par socket. Petit parser maison qui gère `;` et `,` (détectés sur la ligne d'en-tête), les champs entre guillemets et les retours à la ligne dans les guillemets. Encodage : UTF-8 (avec ou sans BOM) sinon Windows-1252, pour accepter les deux exports d'Excel.
- **Images** servies en statique sur `/images/…` depuis `images/` à la racine du dépôt. Le nom de fichier ne peut pas contenir de `/` ni `..`. Le dossier `images/` est ignoré par git (sauf un `.gitkeep`).
- **Compte à rebours** : le serveur fait foi. Il arme un minuteur et bloque les réponses à l'échéance, même si une page est lente. Il diffuse le temps restant en millisecondes ; les pages décomptent localement à partir de cette valeur (les horloges des téléphones ne sont pas fiables).
- **Annuler (Z) reste générique** : Z annule toujours la dernière action de la Régie, et seulement celle-là. Le compte à rebours et les réponses des équipes ne font pas partie des instantanés d'annulation. Si l'action annulée est « Lancer le compte à rebours », le compte à rebours s'arrête, la question revient à « Propositions affichées » et les réponses reçues sont effacées (c'est vrai aussi si le compte à rebours était déjà arrivé à zéro). Si l'action annulée est autre chose (étape, +/−, retrait d'équipe), un compte à rebours en cours continue.
- **Persistance** : `scores.json` contient en plus l'étape, la liste des manches (avec les questions), la manche en cours, l'index de la question en cours, un indicateur « question révélée » et les scores par manche. Après un redémarrage : une question déjà révélée reste révélée (ses points ne peuvent pas être donnés deux fois) ; une question non révélée repart à l'étape 1, sans compte à rebours ni réponses.
- **Équipe arrivée en cours de partie** : 0 dans les manches précédentes, peut répondre dès la question suivante. **Équipe retirée** : disparaît du Bilan et du podium (annulable avec Z, comme aujourd'hui).
- **Remise à zéro des scores** : remet à zéro toutes les manches et revient à la première manche.
- **Touches clavier** : Espace/B/M/F restent actives seulement pendant une manche buzzer. Pendant un QCM, une touche unique (Entrée) fait avancer au bouton suivant du déroulé. Z marche partout.
- **Tests** : ajout de tests avec le runner intégré de Node (`node --test`, pas de dépendance) pour le parser CSV, la validation du fichier, le calcul des scores par manche et le déroulé QCM. Nouveau script `npm test`.
- **README** : nouvelles sections « Préparer la soirée (fichier CSV + images) », « Grand écran », « Manches QCM ». Un fichier d'exemple `exemple-soiree.csv` est fourni.

## 6. Ordre de construction

Trois livraisons, chacune utilisable en soirée avant la suivante :

1. **Grand écran + étapes** : page `/screen`, choix de l'étape dans la Régie, Installation / Jeu (buzzer) / Fin (podium sur le total). Bilan affiche une seule colonne tant qu'il n'y a pas de manches.
2. **Manches + import CSV** (manches buzzer seulement) : scores par manche, passage d'une manche à l'autre, Bilan complet. Le format complet (colonnes QCM comprises) est en place dès cette livraison ; l'import refuse les lignes `qcm` avec un message clair tant que la livraison 3 n'est pas faite.
3. **Manches QCM** : déroulé complet décrit en §4.4.

## 7. Laissé au constructeur

- Mise en page et style visuel exacts du Grand écran et des nouveaux blocs de la Régie, en restant dans le style existant (variables CSS, police condensée, mode sombre). Le Grand écran doit rester lisible à 10 m.
- Animations (entrée d'une équipe, changement de classement, révélation), en respectant `prefers-reduced-motion`.
- Forme exacte des événements socket et de `publicState()`, tant que le Grand écran et les Buzzers ne reçoivent jamais la bonne réponse avant la révélation ni les choix des autres équipes pendant le compte à rebours.
- Découpage en commits.
