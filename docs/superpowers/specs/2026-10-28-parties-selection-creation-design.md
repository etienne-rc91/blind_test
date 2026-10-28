# Parties : Sélection et Création — conception

Date : 2026-10-28
Statut : en attente de validation

## 1. Intention

Aujourd'hui l'animateur prépare chaque soirée dans Excel puis importe le CSV dans la Régie. C'est pénible et source d'erreurs : il faut connaître l'ordre des colonnes, retaper le nom de la manche à chaque ligne de QCM, écrire la bonne réponse en lettre, recopier exactement le nom des images, et on ne voit le résultat qu'après l'import.

L'animateur veut :

1. une page **Sélection de la partie** qui liste les parties préparées sur l'ordinateur et permet de les jouer, modifier, renommer, supprimer, en créer une nouvelle ;
2. une page **Création** pour construire ou modifier une partie avec des formulaires, sans jamais voir de CSV.

Tout se passe **sur le même ordinateur** que celui qui fait tourner le jeu (préparation à la maison, jeu en salle).

Vocabulaire : voir `CLAUDE.md` (Partie, Manche, Question…). Une **partie** est un fichier CSV du dossier `parties/`.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Préparer une partie complète sans Excel : manches, types, questions QCM, images, bonne réponse par clic, aperçu Grand écran.
- Retrouver ses parties dans une liste et lancer celle de la soirée en un clic.
- Préparer une partie en plusieurs fois (enregistrement d'une partie incomplète).
- Corriger la partie en cours de jeu, effet immédiat, scores gardés.

**Non-objectifs (pas maintenant)**
- Plus ou moins de 4 propositions par question.
- Gestion du dossier `images/` (suppression des images inutilisées, galerie).
- Partage de parties entre ordinateurs, export, synchronisation.
- Accès à ces pages depuis un autre appareil que le PC de la Régie (pas interdit, pas visé).

**Anti-objectifs**
- Perdre une partie : écrasement involontaire, suppression sans confirmation, fichier à moitié écrit.
- Perdre ou mélanger des scores en modifiant la partie en cours.
- Casser le format CSV : un fichier fait dans Excel reste lisible, un fichier fait dans Création reste ouvrable dans Excel.
- Dépendre d'internet.

## 3. Contraintes

Celles de `CLAUDE.md` : pas d'internet, pas de nouvelle dépendance npm, pas de build, serveur seule source de vérité, vanilla HTML/JS, interface en français.

## 4. Décidé avec l'animateur

### 4.1 Stockage

- Une partie = un fichier `parties/<nom>.csv`, au format CSV existant (`manche;type;question;image;A;B;C;D;reponse`). Le nom de la partie est le nom du fichier sans `.csv`.
- Les CSV déjà préparés dans Excel, déposés dans `parties/`, apparaissent dans la liste.

### 4.2 Page Sélection de la partie (présentation « liste », maquette A)

- Une ligne par partie : nom, nombre de manches avec leurs noms et types (et nombre de questions pour un QCM), date de dernière modification. La partie en cours de jeu porte un badge « en cours ».
- Actions par partie : **Jouer**, **Modifier**, **Renommer**, **Supprimer**. Bouton global **+ Nouvelle partie** et retour vers la Régie.
- **Jouer** = nouvelle soirée : scores, **équipes** et avancement repartent de zéro, le Grand écran revient à l'étape Installation. Les équipes sont effacées : les téléphones déjà connectés reviennent à l'écran « nom d'équipe » (comme après un retrait d'équipe) et rejoignent à nouveau. Confirmation dès qu'au moins une équipe existe.
- La partie en cours n'a pas de bouton Jouer ; elle peut être modifiée.
- **Supprimer** demande confirmation.

### 4.3 Page Création (deux colonnes, maquette A)

- Barre du haut : nom de la partie, **Enregistrer**, **Enregistrer sous…** (nouvelle partie avec un autre nom ; l'originale reste intacte).
- Colonne gauche : liste des manches (nom + type, nombre de questions pour un QCM), réordonnables par glisser, bouton **+ Manche**.
- Colonne droite : la manche sélectionnée (nom, type). Pour un QCM : la liste de ses questions (réordonnables, **+ Question**), puis le formulaire de la question choisie :
  - texte (facultatif si image) ;
  - image choisie depuis l'ordinateur (copiée par l'application dans `images/`), avec « Changer » et « Retirer » ;
  - 4 propositions A–D ;
  - bonne réponse désignée **en cliquant sur la proposition** ;
  - **aperçu** de la question telle qu'elle apparaîtra sur le Grand écran.
- Le nom de la manche est saisi une seule fois.

### 4.4 Modifier la partie en cours de jeu

En enregistrant la partie en cours, la nouvelle version s'applique **tout de suite** au jeu, scores gardés, selon cette règle (validée par l'animateur) :

- **Appliqué** : corrections de texte, propositions, image, nom de manche ; changement de bonne réponse d'une question **pas encore révélée** ; ajout de manches ou de questions **après** celles qui existent.
- **Refusé avec message clair** (proposant « Enregistrer sous » pour la soirée suivante) : supprimer ou réordonner des manches, changer le type d'une manche, supprimer ou réordonner des questions dans une manche QCM déjà commencée.
- Changer la bonne réponse d'une question **déjà révélée** : enregistré, mais les points déjà donnés ne sont pas recalculés ; un message rappelle de corriger avec +/−.

### 4.5 Régie

- Affiche le nom de la partie en cours.
- Un lien **Parties** ouvre la Sélection ; il remplace le bouton « Importer (CSV) ».

## 5. Choix de conception (décidés par Claude)

- **Accès** : Sélection (`/parties?key=…`) et Création (`/creation?key=…`) exigent la clé hôte, comme la Régie.
- **API** : HTTP JSON sous `/api/…` protégé par la clé hôte (en-tête), plutôt que des événements socket : lecture/écriture de fichiers, upload d'images. Le jeu reste piloté par socket ; « Jouer » et l'application à chaud passent par le module de jeu et déclenchent un `broadcast()`.
- **Format côté pages** : la page Création manipule la partie en JSON (`{ name, sections: [...] }`, même forme que `buildSections`). Le serveur convertit JSON ↔ CSV et valide avec `buildSections` à chaque enregistrement.
- **Écriture CSV** : séparateur `;`, en-tête standard, encodage UTF-8 **avec BOM** (Excel l'ouvre correctement), champs entre guillemets quand nécessaire. Écriture atomique (`.tmp` + `rename`). Aller-retour testé : CSV écrit → relu → mêmes manches.
- **Noms de partie** : 1 à 60 caractères, sans `/ \ : * ? " < > |` ni caractère de contrôle, ne commençant pas par `.` ; unicité insensible à la casse. Renommer ou « Enregistrer sous » vers un nom existant est refusé (pas d'écrasement silencieux).
- **Parties incomplètes (décidé avec l'animateur)** : on peut enregistrer une partie inachevée, pour la préparer en plusieurs fois. Est « incomplète » une partie sans manche, une manche QCM sans question, ou une question sans texte ni image, avec une proposition vide, sans bonne réponse, ou dont l'image est introuvable. Dans la Sélection, elle porte un badge « incomplète » avec ce qui manque (ex. « Culture G, question 3 : proposition C vide ») et son bouton **Jouer est désactivé**. Dans Création, les manches et questions à compléter sont signalées. Le fichier reste un CSV au format habituel (cellules vides là où il manque quelque chose).
- **Ce qui reste refusé à l'enregistrement** (erreurs de structure, pas des manques) : nom de manche vide, même nom de manche pour deux manches, type inconnu. Ils ne peuvent de toute façon pas être produits par Création ; ils concernent les CSV écrits à la main.
- **Partie en cours rendue incomplète** : l'enregistrement est accepté pour le fichier mais n'est pas appliqué au jeu (message), le jeu continue avec la dernière version complète.
- **Modifications non enregistrées** : avertissement si on quitte Création sans enregistrer.
- **Images** : upload HTTP (pas socket, pour les fichiers de plus de 1 Mo), formats `png jpg jpeg gif webp svg`, 10 Mo maximum. Nom de fichier nettoyé ; si un fichier du même nom existe avec un contenu différent, suffixe `-2`, `-3`… ; même contenu → réutilisé.
- **Annuler (Z)** : « Jouer » n'est pas annulable (il est confirmé avant) et vide l'historique d'annulation. L'application à chaud d'une modification (§4.4) n'est pas annulable non plus ; l'historique est gardé, et la nouvelle version des manches remplace l'ancienne dans chaque instantané, pour qu'un Z ultérieur (un +1 par exemple) ne ramène jamais d'anciennes questions. Mémoire et fichier restent ainsi d'accord.
- **Enregistrement refusé (§4.4)** : rien n'est écrit ni appliqué ; la version modifiée reste dans la page Création, d'où l'animateur peut faire « Enregistrer sous ».
- **Manche QCM « déjà commencée »** : au moins une question a été affichée sur le Grand écran (avancement > 0, question révélée, ou question en cours d'affichage). Avant d'afficher la première question, on peut encore réordonner ou supprimer ses questions.
- **Partie en cours** : son nom est sauvegardé dans `scores.json`. Si son fichier est supprimé ou renommé ailleurs, le jeu continue avec les manches en mémoire.
- **Supprimer la partie en cours** : refusé (message).
- **Renommer la partie en cours** : autorisé ; le nom en cours suit.
- **Importer un CSV** venant d'ailleurs : bouton « Importer un fichier CSV » dans la Sélection, qui valide puis copie le fichier dans `parties/`. Le bouton « Importer (CSV) » de la Régie disparaît.
- **Sans partie choisie** : comportement actuel (« Manche 1 », buzzer).
- **Dossier** : `parties/` à côté du serveur (variable `PARTIES_DIR` pour les tests), ignoré par git (comme `images/`), créé au démarrage s'il manque.
- **Glisser pour réordonner** : HTML5 drag & drop, plus boutons ↑ ↓ en secours (clavier, et confort).
- **Tests** : `node --test` pour la conversion JSON ↔ CSV, la validation des noms, la règle d'application à chaud (§4.4) et les routes API (serveur lancé sur un port de test avec `fetch`).

## 6. Ordre de construction

1. **Stockage et API** : lecture/écriture/renommage/suppression des parties, conversion JSON ↔ CSV, « Jouer » (nouvelle soirée), nom de la partie en cours.
2. **Page Sélection** + lien depuis la Régie (retrait du bouton d'import de la Régie, import CSV déplacé dans la Sélection).
3. **Application à chaud** de la partie en cours (§4.4).
4. **Page Création** : édition, réordonnancement, images, aperçu, Enregistrer / Enregistrer sous.

Chaque étape est utilisable seule : après l'étape 2, l'animateur joue ses CSV Excel en un clic.

## 7. Laissé au constructeur

- Style exact des pages, dans le style existant (variables CSS, police condensée, thème sombre/clair), tenant dans la fenêtre comme la Régie.
- Forme exacte des routes et des réponses JSON.
- Rendu de l'aperçu (réduction fidèle du Grand écran, pas forcément pixel près).
