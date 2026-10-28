# Extrait musical dans une question QCM — conception

Date : 2026-10-28
Statut : à valider

## 1. Intention

Dans une manche QCM, l’animateur veut poser des questions **sur un extrait musical** : « De quel film vient cette musique ? », « Terminez les paroles ». La salle écoute d’abord l’extrait, puis découvre la question, puis les propositions A–D, et les équipes répondent sur leur Buzzer pendant le compte à rebours, comme aujourd’hui.

Le QCM n’est **pas** une épreuve de rapidité : personne ne répond pendant l’extrait, toutes les équipes répondent pendant le compte à rebours, et la révélation montre qui a juste et qui a faux. Rien de cela ne change.

Vocabulaire : voir `CLAUDE.md`. Ce document s’appuie sur deux conceptions déjà construites :
- `2026-10-28-grand-ecran-manches-qcm-design.md` (déroulé d’une question QCM, §4.4) ;
- `2026-10-28-musique-design.md` (passages, fichiers de `musiques/`, Spotify, lecteur commun `public/players.js`, R, la Régie qui joue le son).

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Une question QCM peut avoir un **extrait** (facultatif) : un fichier de `musiques/` ou un titre Spotify, avec un **Début** et une **Fin**, exactement comme un morceau de manche buzzer.
- Jouer l’extrait depuis la Régie, au clavier, dans le déroulé QCM existant ; **R** le rejoue.
- Préparer l’extrait dans la page Création, avec les mêmes outils que pour un morceau (+ Fichier, + Spotify, barre de temps à deux poignées, Écouter le passage).
- Mélanger dans une même manche QCM des questions avec et sans extrait.

**Non-objectifs (pas maintenant)**
- Réponse libre tapée sur le Buzzer (inscrite dans `docs/backlog.md`). La réponse reste une lettre A–D.
- Vidéo YouTube dans une question (reste dans `docs/backlog.md`).
- Extrait qui boucle, fondu, volume par question.
- Son de victoire à la révélation QCM.

**Anti-objectifs**
- **Une réponse qui fuite** : ni le Buzzer ni le Grand écran ne reçoivent le nom du fichier ni l’identifiant Spotify de l’extrait (un nom de fichier comme `titanic.mp3` donnerait la réponse). Le Buzzer ne reçoit toujours rien de la question.
- **Un appui en trop qui gâche une question** : un double appui sur Entrée ne coupe pas l’extrait.
- **Une panne de musique qui bloque la soirée** : si l’extrait ne se lit pas, l’animateur peut quand même afficher la question (bouton « Afficher la question ») et continuer.
- Casser les parties existantes : une question sans extrait, et tout CSV actuel, se jouent exactement comme avant.
- Rendre internet obligatoire pour une partie sans extrait Spotify (l’exception internet de `CLAUDE.md` couvre les extraits Spotify comme les morceaux Spotify, et seulement eux).

## 3. Contraintes

Celles de `CLAUDE.md` : pas de nouvelle dépendance npm, pas de build, vanilla HTML/JS, serveur seule source de vérité (la Régie applique l’état de lecture reçu, elle ne remonte que la fin du passage), `performance.now()` toujours premier dans le handler `buzz`, toute action animateur annulable avec Z, interface en français.

## 4. Décidé avec l’animateur

### 4.1 Déroulé d’une question avec extrait

| Étape | Régie | Grand écran | Buzzer |
|---|---|---|---|
| 1. Page de la question | Entrée | Nom de la manche, « Question 3/10 », **sans** texte ni image | Attente |
| 2. Extrait | Entrée : l’extrait se lance depuis Début (le son sort du PC de la Régie) | Même page | Attente |
| 3. Question | **automatique** quand l’extrait arrive à Fin | + texte et/ou image de la question | Attente |
| 4. Propositions | Entrée | + propositions A–D | Boutons visibles, inactifs |
| 5. Compte à rebours, verrouillage, révélation, question suivante | inchangés | inchangés | inchangés |

- **Début et Fin fixés dans la partie**, comme les morceaux buzzer. L’extrait s’arrête seul à Fin.
- **R rejoue l’extrait depuis Début**, comme en manche buzzer, à n’importe quel moment une fois l’extrait lancé : pendant l’extrait, sur la question, les propositions, le compte à rebours, et après la révélation. R ne change rien d’autre (étape, compte à rebours, réponses, points).
- **Un extrait rejoué va jusqu’à Fin** : afficher les propositions, lancer le compte à rebours, le verrouillage à zéro et la révélation ne coupent pas la musique (les équipes peuvent réécouter en répondant). Seuls « Question suivante », un changement de manche ou d’étape du Grand écran l’arrêtent (*ces arrêts : décidé par Claude*), ainsi que le bouton « Afficher la question » pendant l’étape 2. Une fin de passage reçue après l’étape 2 ne fait avancer aucune étape.
- **Question sans extrait** : déroulé actuel inchangé (Entrée affiche directement la question avec son texte et son image).

### 4.2 Contenu de la question

- Une question avec extrait garde ses règles actuelles : texte et/ou image (au moins un des deux), propositions A–D, bonne réponse A–D. Le texte est en pratique toujours rempli (« Terminez les paroles »).

## 5. Décidé par Claude (à vérifier par l’animateur en lisant)

- **Entrée est ignorée pendant l’extrait** (étape 2, avant Fin) : un double appui ne coupe pas la musique et n’affiche pas la question en avance.
- **Bouton « Afficher la question »** (*décidé avec l’animateur : toujours visible*) : cliquable dans la Régie pendant toute l’étape 2, pas sur Entrée. Il **coupe l’extrait** et passe à l’étape 3. Deux usages : couper volontairement un extrait trop long, et sortir d’une **lecture impossible** (fichier introuvable, Spotify déconnecté, titre indisponible : la Régie affiche l’erreur comme pour un morceau buzzer, l’extrait n’arrivant jamais à Fin). Annulé avec Z, il ramène à l’étape 2 musique coupée (sans la relancer) ; R relance alors l’extrait, et le bouton reste disponible.
- **Grand écran pendant l’extrait** : la page de la question montre un indicateur d’écoute (« ♪ Écoutez… »), dans le style de l’indicateur de morceau en manche buzzer. Pendant un R après l’étape 2, le Grand écran ne change pas : pas d’indicateur d’écoute, la question et les propositions déjà affichées restent affichées.
- **Régie** : pendant une question avec extrait, le bloc central montre l’état de l’extrait (en cours / terminé / lecture impossible), la source (📁 / ♪ Spotify) et le bouton **Rejouer l’extrait (R)**. La Régie voit, comme aujourd’hui, la question, les propositions et la bonne réponse.
- **Z** reste générique (annule la dernière action de la Régie) et **ne relance jamais la musique** (même règle que la conception Musique) :
  - Z après « Lancer l’extrait » : retour à l’étape 1, musique coupée.
  - Le passage automatique à l’étape 3 n’est pas une action de la Régie : il n’a pas son propre Z. Z après « Afficher les propositions » revient à l’étape 3, sans relancer la musique.
  - Z d’un R : la musique revient à son état d’avant, sans être relancée.
- **Redémarrage du serveur** : règle QCM existante — une question non révélée repart à l’étape 1 (sans extrait en cours) ; une question révélée reste révélée.
- **Plusieurs Régies ouvertes** : même règle que la conception Musique (une seule fait sortir le son).
- **Pas de nouvelle touche** : Entrée fait avancer, R rejoue, Z annule.

## 6. Préparation de la partie

### 6.1 Fichier CSV

- Les colonnes `musique;debut;fin` (ajoutées par la conception Musique) sont simplement **remplies sur une ligne `qcm`** pour donner un extrait à la question. `reponse` reste la lettre A–D.
  ```
  manche;type;question;image;A;B;C;D;reponse;musique;debut;fin
  Ciné-musique;qcm;De quel film vient cette musique ?;;Titanic;Avatar;Jurassic Park;Gladiator;C;jurassic.mp3;0:12;0:40
  ```
- Les trois colonnes vides : question sans extrait. Les anciens fichiers (9 colonnes, ou 12 colonnes sans musique sur les lignes `qcm`) restent valides.
- Validation stricte (pour jouer), comme pour un morceau : source valide, fichier présent dans `musiques/` (Spotify : format d’identifiant seulement, pas d’appel réseau), Début < Fin. Pas de « réponse » texte demandée pour l’extrait (la réponse est la lettre). Une ligne avec seulement une partie des trois colonnes est une erreur. En brouillon, ces manques deviennent des problèmes listés (« Ciné-musique, question 2 : fin avant le début »).

### 6.2 Page Création

- Dans l’éditeur d’une question QCM, un bloc **Extrait (facultatif)** avec **+ Fichier** et **+ Spotify**, la barre de temps à deux poignées, **Écouter le passage**, et un bouton pour retirer l’extrait. Mêmes composants et mêmes règles d’upload que les morceaux buzzer.
- La liste des questions signale celles qui ont un extrait (♪).
- L’aperçu Grand écran d’une question montre l’indicateur d’écoute quand elle a un extrait.

### 6.3 Modification à chaud

- Règles QCM existantes de `lib/live-edit.js`, étendues à l’extrait (*décidé par Claude*, aligné sur les morceaux buzzer) :
  - question **pas encore posée** : l’extrait peut être ajouté, changé ou retiré. La question en cours encore à l’étape « idle » (Entrée pas encore pressée) compte comme pas encore posée.
  - question **déjà posée ou en cours** : on ne peut ni ajouter, ni retirer l’extrait, ni changer sa source ; Début et Fin restent corrigeables.
  - Refus avec la forme habituelle : « Modification impossible pendant la partie : l’extrait de la question 3 de la manche « Ciné-musique » a changé. Utilisez « Enregistrer sous »… ».

## 7. Laissé au constructeur

- Nom et forme du nouvel état (par exemple une étape QCM supplémentaire entre `idle` et `question`), en réutilisant autant que possible l’état `song` existant (`audio`, `seq`, `host:ended`, règle « un Z ne rend jamais la musique audible ») plutôt qu’un second mécanisme de lecture.
- Forme du champ extrait dans une question (`question.song` ou équivalent) et de `publicState()` par rôle, tant que l’anti-objectif « fuite » est tenu : la Régie reçoit la source ; le Grand écran ne reçoit que « extrait en cours / non » ; le Buzzer rien.
- Comment la Régie signale « lecture impossible » au serveur, si nécessaire, et comment « Afficher la question » est autorisé seulement pendant l’étape 2.
- Style exact (Régie tenant dans une fenêtre, thème clair/sombre, `prefers-reduced-motion`).
- Tests `node --test` : déroulé avec extrait (Entrée ignorée pendant l’extrait, passage automatique à Fin, `host:ended` en retard ignoré, R à chaque étape, extrait rejoué non coupé par compte à rebours ni révélation, Z ne relançant jamais la musique), CSV (ligne `qcm` avec et sans extrait, colonnes partielles), état par rôle (aucune source vers Grand écran et Buzzer), modification à chaud.
- README : section « Manches QCM » (extrait, R, que faire si la lecture échoue) ; `docs/backlog.md` : retirer la partie « extrait audio » de l’item « Extrait musical ou vidéo dans une question QCM » (la vidéo YouTube y reste).
