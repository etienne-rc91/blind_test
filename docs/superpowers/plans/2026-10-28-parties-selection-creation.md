# Parties : Sélection et Création — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** gérer les parties comme des fichiers CSV du dossier `parties/` : une page Sélection (jouer, modifier, renommer, supprimer, importer) et une page Création (édition par formulaires, images, aperçu, enregistrement, y compris à chaud sur la partie en cours).

**Architecture :** trois modules purs testables (`lib/game-file.js` étendu pour écrire le CSV et lire en mode « brouillon », `lib/parties.js` pour le dossier, `lib/live-edit.js` pour la règle d'application à chaud) ; `lib/game.js` gagne « nouvelle soirée », remplacement des manches et nom de la partie. `server.js` expose une API HTTP JSON protégée par la clé hôte ; deux nouvelles pages vanilla.

**Tech stack :** Node ≥ 18 (testé 24), Express 4.21.2 (`express.json`, `express.raw`), socket.io 4.8.1, `node:test`, `fetch` natif pour les tests d'API.

**Spec :** `docs/superpowers/specs/2026-10-28-parties-selection-creation-design.md` (à lire en entier). Vocabulaire et contraintes : `CLAUDE.md`.

## Global Constraints

- Pas d'internet, pas de nouvelle dépendance npm, pas de build ; pages HTML/CSS/JS inline, style existant (variables CSS, thème sombre/clair, police condensée), tenant dans la fenêtre sans défilement de page (comme la Régie).
- Interface et commentaires en français (`’`, espace avant `: ? !`), identifiants en anglais, commits en anglais Conventional Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Serveur seule source de vérité ; toute validation se refait côté serveur.
- Écritures de fichiers atomiques (`.tmp` + `rename`). Jamais d'écrasement silencieux d'une autre partie.
- CSV écrit : `;`, en-tête `manche;type;question;image;A;B;C;D;reponse`, UTF-8 avec BOM, guillemets RFC 4180 si nécessaire.
- Noms de partie : 1–60 caractères après trim, normalisés NFC, sans `/ \ : * ? " < > |` ni contrôle, ne commençant pas par `.` ; unicité insensible à la casse.
- Images : `png jpg jpeg gif webp svg`, 10 Mo max.
- Routes `/parties`, `/creation` et `/api/*` exigent la clé hôte (`?key=` pour les pages, en-tête `x-host-key` pour l'API) ; sinon 403.

## Review Focus

1. **Nom avec accent sous macOS** (« Soirée » saisi en NFC, fichier listé en NFD) : la partie est retrouvée, jouable, renommable, et « soirée » est refusé comme doublon. → test `names are NFC-normalized and unique ignoring case` (Tâche 2).
2. **CSV écrit par Création, rouvert et réenregistré par Excel en Windows-1252** : se relit sans perte. → test `written csv survives a windows-1252 re-save` (Tâche 1).
3. **Ajout d'une question à la fin d'une manche QCM terminée en cours de jeu** : « Afficher la question » redevient possible pour la nouvelle question. → test `added question after a finished qcm section can be shown` (Tâche 3).
4. **Image téléversée au nom piégé ou déjà pris** (`../x.png`, même nom contenu différent) : nom nettoyé, suffixe `-2`, rien hors de `images/`. → test `image upload sanitizes and dedupes names` (Tâche 4).
5. **« Jouer » pendant un compte à rebours** : minuteur arrêté, téléphones renvoyés à l'écran d'équipe, aucune erreur. → test `newEvening stops a running countdown and kicks sockets` (Tâche 3).

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/game-file.js` (modifié) | + `writeCsv(sections)`, + mode `draft` de `buildSections` (problèmes au lieu d'erreurs pour les manques). |
| `lib/parties.js` (+ `.test.js`, créé) | Dossier des parties : lister, lire, enregistrer, renommer, supprimer, importer ; validation des noms. |
| `lib/live-edit.js` (+ `.test.js`, créé) | Règle §4.4 : comparer ancienne/nouvelle version de la partie en cours. |
| `lib/game.js` (modifié) | `newEvening`, `replaceSections`, `partieName`. |
| `server.js` (modifié) | API `/api/…`, routes `/parties` `/creation`, retrait de `host:import`. |
| `server.test.js` (créé) | Tests d'API (serveur lancé en sous-processus sur un port de test, dossiers temporaires). |
| `public/parties.html`, `public/creation.html` (créés) | Pages Sélection et Création. |
| `public/host.html` (modifié) | Nom de la partie en cours + lien « Parties » ; retrait de l'import. |
| `README.md`, `CLAUDE.md`, `.gitignore` (modifiés) | Doc ; `parties/*`, `.superpowers/` ignorés ; `parties/.gitkeep`. |

---

### Tâche 1 : écrire le CSV et lire une partie incomplète

**Files :** Modify `lib/game-file.js`, `lib/game-file.test.js`

**Interfaces :**
- Produces :
  ```
  writeCsv(sections: Section[]) -> string          // BOM + en-tête + lignes, séparateur ';', fins de ligne \r\n
  buildSections(rows, { imageExists, draft = false })
    draft=false : comportement actuel inchangé
    draft=true  : -> { ok: true, sections, problems: string[] } | { ok: false, error }
  Question en brouillon = { text, image|null, choices: {A,B,C,D} (chaînes, éventuellement vides), answer: 'A'|'B'|'C'|'D'|null }
  ```
  En brouillon, deviennent des **problèmes** (format `« <manche>, question <n> : <manque> »` ou `« <manche> : aucune question »` ou `« Aucune manche »`) : question sans texte ni image, proposition vide, réponse vide ou invalide, image introuvable, manche QCM sans question, fichier sans manche. Restent des **erreurs** : en-tête, nom de manche vide, type inconnu, manche buzzer sur plusieurs lignes, nom de manche répété non contigu, même nom deux types, nom d'image dangereux.
  Une ligne `qcm` dont les cellules question/image/A–D/reponse sont toutes vides déclare la manche sans ajouter de question (c'est ce que `writeCsv` écrit pour une manche QCM vide).

- [ ] **Step 1 : tests** :
  - `writeCsv round-trips through parseCsv and buildSections` : sections avec accents, `;`, guillemets et retour à la ligne dans un texte → `buildSections(parseCsv(decodeCsvBytes(Buffer.from(writeCsv(s)))))` redonne `s`.
  - `writeCsv starts with a BOM and the standard header`.
  - `written csv survives a windows-1252 re-save` : `writeCsv` → retirer le BOM → encoder en Windows-1252 (caractères présents dans 1252) → relu identique.
  - `draft mode keeps incomplete questions and lists problems` : proposition C vide, réponse vide, image absente → `ok:true`, questions conservées (`answer:null`), 3 problèmes au bon format.
  - `draft mode accepts an empty qcm section and an empty file` → problèmes `Culture G : aucune question` et `Aucune manche`.
  - `draft mode still rejects structural errors` : type inconnu → `ok:false`.
  - `strict mode is unchanged` : les tests existants passent toujours.
- [ ] **Step 2 : lancer** `node --test lib/game-file.test.js` → échecs attendus.
- [ ] **Step 3 : implémenter** `writeCsv` et l'option `draft`.
- [ ] **Step 4 : lancer** `npm test` → tout passe.
- [ ] **Step 5 : commit** `feat: write game files as csv and read incomplete drafts`

### Tâche 2 : le dossier des parties

**Files :** Create `lib/parties.js`, `lib/parties.test.js`

**Interfaces :**
- Consumes : `writeCsv`, `buildSections(…, { draft: true })`, `parseCsv`, `decodeCsvBytes`.
- Produces :
  ```
  cleanPartieName(raw: unknown) -> string | null          // trim + NFC ; null si invalide
  createPartiesStore({ dir, imageExists }) -> Store
  Store.list() -> [{ name, mtime: number, sections: [{ name, type, questionCount }], problems: string[], error?: string }]   // triée par nom (fr) ; un CSV illisible apparaît avec error
  Store.read(name) -> { ok: true, name, sections, problems } | { ok: false, status: 404|422, error }
  Store.save(name, sections, { overwrite }) -> { ok: true, name, problems } | { ok: false, status: 400|409|422, error }
  Store.rename(from, to) -> { ok: true, name } | { ok: false, status, error }
  Store.remove(name) -> { ok: true } | { ok: false, status, error }
  Store.importCsv(name, bytes) -> { ok: true, name, problems } | { ok: false, status, error }
  ```
  `save` valide les sections reçues en repassant par `writeCsv` → `buildSections(draft)` (rejette toute forme invalide, status 422). `overwrite:false` et nom déjà pris (insensible à la casse/NFC) → 409 `Une partie porte déjà ce nom.` Résolution des noms : on cherche le fichier dont le nom normalisé NFC égale le nom demandé, sans tenir compte de la casse. `dir` créé s'il manque.

- [ ] **Step 1 : tests** (dossier temporaire `fs.mkdtempSync`) :
  - `save then list and read a partie`.
  - `names are NFC-normalized and unique ignoring case` : fichier créé sous nom NFD → `read('Soirée')` (NFC) trouve ; `save('soirée', …, {overwrite:false})` → 409.
  - `cleanPartieName rejects bad names` : `''`, `'a/b'`, `'.x'`, `'x'.repeat(61)`, `'a:b'` → null ; `'  Soirée  '` → `'Soirée'`.
  - `save without overwrite refuses an existing name` ; `with overwrite replaces it`.
  - `rename moves the file and refuses an existing target`.
  - `remove deletes the file` ; `read of a missing partie is 404`.
  - `importCsv stores a valid excel export and refuses a structurally broken one`.
  - `list shows problems for an incomplete partie and error for a broken file`.
- [ ] **Step 2 : lancer** → échec.
- [ ] **Step 3 : implémenter** (`fs` synchrone, écriture atomique).
- [ ] **Step 4 : lancer** `npm test` → passe.
- [ ] **Step 5 : commit** `feat: store parties as csv files in a folder`

### Tâche 3 : nouvelle soirée et application à chaud dans le jeu

**Files :** Create `lib/live-edit.js`, `lib/live-edit.test.js` ; Modify `lib/game.js`, `lib/game.test.js`

**Interfaces :**
- Produces :
  ```
  checkLiveEdit({ oldSections, newSections, progress, currentSection, qcmStep })
    -> { ok: true, warnings: string[] } | { ok: false, error: string }
  Game.newEvening({ name: string|null, sections }) -> { kickedSockets: string[] }
  Game.replaceSections(sections) -> void
  Game.getLive() -> { partieName, sections, progress, currentSection, qcmStep }   // pour checkLiveEdit
  Game.setPartieName(name: string|null) -> void    // renommage de la partie en cours
  publicState: + partieName (string|null)
  toSaved/load: + partieName
  ```
  `checkLiveEdit` (spec §4.4 et §5) : refuse si moins de manches qu'avant, si une manche existante a changé de type, ou si l'ordre des manches existantes a changé (comparaison par position : la manche i reste la manche i ; seul le nom peut changer — un renommage n'est pas un réordonnancement). Pour chaque manche QCM **commencée** (`progress[i].index > 0 || progress[i].revealed || (i === currentSection && qcmStep !== 'idle')`) : refuse si elle a moins de questions qu'avant ou si une question déjà présente a changé de place — détecté uniquement comme suppression/réordonnancement : on accepte les modifications de contenu à position égale. Warning `« <manche>, question <n> : la bonne réponse a changé après révélation, corrigez les points avec +/− si besoin. »` pour chaque question d'index `< progress[i].index` (ou `=== index` et `revealed`) dont `answer` a changé. Message de refus : `Modification impossible pendant la partie : <raison>. Utilisez « Enregistrer sous » pour la garder pour une autre soirée.`
  `newEvening` : vide équipes, sockets, scores, avancement, réponses, minuteur, historique d'annulation ; `round` à 0, buzzers fermés, `stage = 'setup'`, `currentSection = 0`, `partieName = name`, `sections` remplacées. Renvoie les sockets à notifier `kicked`.
  `replaceSections` : remplace `game.sections`, étend `progress` et les `scores` des équipes aux nouvelles manches, et remplace la référence `sections` dans **chaque instantané** de l'historique ; ne touche ni scores existants ni étape QCM ; si la manche en cours est QCM en `idle` avec `index === ancien total` et qu'il y a maintenant plus de questions, `show-question` redevient possible (aucun code spécial si `currentQuestion()` lit les nouvelles sections).

- [ ] **Step 1 : tests `live-edit.test.js`** : `accepts text and choice corrections` ; `accepts appended sections and appended questions` ; `refuses removing a section` ; `refuses reordering sections` ; `refuses changing a section type` ; `refuses removing a question in a started qcm section` ; `allows reordering questions before the first is shown` ; `warns when a revealed answer changes`.
- [ ] **Step 2 : tests `game.test.js`** :
  - `newEvening clears teams, scores, history and goes back to setup` (avec `partieName` dans l'état et `canUndo === false`).
  - `newEvening stops a running countdown and kicks sockets` (minuteurs factices du helper `qcmGame`).
  - `replaceSections keeps scores and progress`.
  - `undo after replaceSections never brings old questions back` : +1, `replaceSections` (texte modifié), `undo()` → score revenu, texte nouveau.
  - `added question after a finished qcm section can be shown`.
  - `partieName survives toSaved/load` ; `setPartieName updates state`.
- [ ] **Step 3 : lancer** → échecs.
- [ ] **Step 4 : implémenter.**
- [ ] **Step 5 : lancer** `npm test` → passe.
- [ ] **Step 6 : commit** `feat: start a new evening from a partie and apply live edits`

### Tâche 4 : API HTTP et routes des pages

**Files :** Modify `server.js`, `.gitignore`, `CLAUDE.md` (section Architecture : `lib/parties.js`, `lib/live-edit.js`, `parties/`, nouvelles pages) ; Create `server.test.js`, `parties/.gitkeep`

**Interfaces :**
- Consumes : `createPartiesStore`, `checkLiveEdit`, `game.newEvening`, `game.replaceSections`, `game.getLive`.
- Produces (toutes sous en-tête `x-host-key`, JSON ; erreurs `{ error }` avec le status du store) :
  | Méthode et route | Corps | Réponse |
  |---|---|---|
  | `GET /api/parties` | — | `{ current: partieName, teamCount, parties: Store.list() }` |
  | `GET /api/parties/:name` | — | `Store.read` |
  | `PUT /api/parties/:name` | `{ sections, overwrite }` | `{ ok, name, problems, applied: boolean, warnings }` |
  | `POST /api/parties/:name/rename` | `{ to }` | `{ ok, name }` |
  | `DELETE /api/parties/:name` | — | `{ ok }` (409 si partie en cours) |
  | `POST /api/parties/:name/play` | — | `{ ok }` (422 si incomplète) |
  | `POST /api/parties-import?name=` | octets bruts (`express.raw`, 1 Mo) | `Store.importCsv` |
  | `POST /api/images?filename=` | octets bruts (`express.raw`, 10 Mo) | `{ ok, name }` |
  `PUT` sur la partie en cours (même nom NFC/casse) : `checkLiveEdit` d'abord ; refus → 409, **rien n'est écrit** ; sinon écriture, puis si la partie relue n'a aucun problème → `replaceSections` + `broadcast()` (`applied:true`, `warnings`), sinon `applied:false` avec warning `La partie est incomplète : le jeu continue avec la version précédente.`
  `rename` de la partie en cours appelle `game.setPartieName(nouveauNom)` puis `broadcast()`.
  `play` : `Store.read` ; problèmes → 422 ; sinon `newEvening`, envoi `kicked` aux sockets renvoyés, `broadcast()`.
  Images : extension (insensible à la casse) dans la liste, nom nettoyé (`path.basename`, caractères hors `[\w.-]` → `_`, sans point initial) ; même nom + même contenu → réutilisé ; même nom + contenu différent → `-2`, `-3`… avant l'extension.
  Pages : `GET /parties` et `GET /creation` → 403 sans `?key=` valide.
  Supprimer l'événement socket `host:import` et son code.
  `.gitignore` : `parties/*`, `!parties/.gitkeep`, `.superpowers/`. `PARTIES_DIR` (défaut `parties/` à côté du serveur), créé au démarrage.
  Le serveur doit pouvoir être lancé par les tests : `PORT`, `HOST_KEY`, `SCORES_FILE`, `IMAGES_DIR`, `PARTIES_DIR` en variables d'environnement (déjà le cas pour les quatre premiers).

- [ ] **Step 1 : tests `server.test.js`** (sous-processus `node server.js`, port libre, dossiers temporaires, attente de la ligne « prêt » sur stdout, `after()` tue le processus) :
  - `api requires the host key` (403 sans en-tête, 403 sur `/creation` sans clé).
  - `save, list, read, rename and delete a partie`.
  - `save as refuses an existing name` (409).
  - `play starts a new evening and refuses an incomplete partie` (`GET /api/parties` → `current` mis à jour).
  - `delete of the current partie is refused`.
  - `live edit of the current partie is applied or refused` : correction appliquée (`applied:true`) ; suppression d'une manche → 409 et fichier inchangé.
  - `image upload sanitizes and dedupes names` : `../x.png` → `x.png` dans `IMAGES_DIR` ; même nom contenu différent → `x-2.png` ; `.exe` → 400.
  - `import stores an uploaded csv`.
- [ ] **Step 2 : lancer** `node --test server.test.js` → échecs.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** `npm test` → passe.
- [ ] **Step 5 : commit** `feat: add parties http api`

### Tâche 5 : page Sélection et Régie

**Files :** Create `public/parties.html` ; Modify `public/host.html`, `README.md`

**Interfaces :** Consumes l'API de la Tâche 4 ; `publicState.partieName`.

- [ ] **Step 1 : `parties.html`** (maquette A validée, présentation liste) : barre « Parties » + « ← Régie » + « Importer un fichier CSV » + « + Nouvelle partie » (ouvre `/creation?key=…`). Une ligne par partie : nom, badge « en cours » (vert) ou « incomplète » (avec la liste des problèmes, repliable), résumé des manches, date « modifiée le JJ/MM ». Boutons Jouer (absent pour la partie en cours, désactivé si incomplète), Modifier (`/creation?key=…&partie=<nom>`), Renommer (petit champ en ligne, Entrée valide, Échap annule), Supprimer (confirmation ; message si en cours). « Jouer » : confirmation `Commencer une nouvelle soirée avec « <nom> » ? Les équipes et les scores actuels seront effacés.` si `teamCount > 0` (réponse de `GET /api/parties`). Messages d'erreur de l'API affichés en ligne. La clé est lue dans l'URL et envoyée en `x-host-key`.
- [ ] **Step 2 : Régie** : sous « Manches », le nom de la partie en cours (ou « Aucune partie choisie ») et un lien « Parties » vers `/parties?key=…` à la place de « Importer (CSV) » ; supprimer le code d'import.
- [ ] **Step 3 : README** : section « Préparer la soirée » réécrite autour des pages Parties et Création (le format CSV reste documenté pour Excel) ; dossier `parties/`.
- [ ] **Step 4 : vérification visuelle** (Chrome headless, 1366 × 768 et 1920 × 1080) : liste avec une partie en cours, une incomplète, une normale ; Jouer → Régie montre le nom, Grand écran en Installation, Buzzers renvoyés à l'écran d'équipe ; renommer, supprimer, importer. `npm test` passe.
- [ ] **Step 5 : commit** `feat: add parties selection page and link it from the host`

### Tâche 6 : page Création — structure et enregistrement

**Files :** Create `public/creation.html`

**Interfaces :** Consumes `GET/PUT /api/parties/:name`.

- [ ] **Step 1 : mise en page** (maquette A validée) : barre du haut (nom de la partie modifiable pour une nouvelle partie, « ← Parties », « Enregistrer sous… », « Enregistrer »), colonne gauche manches (nom + type + nb questions, signal ⚠ si incomplète, glisser + ↑ ↓, « + Manche », supprimer une manche avec confirmation), colonne droite : nom et type de la manche ; pour un QCM, liste des questions (⚠, glisser + ↑ ↓, « + Question », supprimer) puis formulaire de la question : texte, 4 propositions, bonne réponse par clic sur la proposition (la proposition choisie en vert ✓).
- [ ] **Step 2 : enregistrement** : « Enregistrer » → `PUT` `overwrite:true` (désactivé pour une partie jamais enregistrée : il agit alors comme « Enregistrer sous ») ; « Enregistrer sous… » → demande un nom, `PUT` `overwrite:false`, puis l'URL passe sur le nouveau nom. Afficher `problems`, `warnings`, `applied` (« Appliqué au jeu en cours ») et les refus (409) en bandeau. Avertissement `beforeunload` si des modifications ne sont pas enregistrées.
- [ ] **Step 3 : vérification visuelle et fonctionnelle** (Chrome headless) : créer une partie à 2 manches dont un QCM de 2 questions, enregistrer, la relire depuis la Sélection ; partie incomplète enregistrée avec ⚠ ; modification de la partie en cours appliquée (Grand écran mis à jour) puis refusée (suppression de manche). `npm test` passe.
- [ ] **Step 4 : commit** `feat: add creation page to build and save parties`

### Tâche 7 : page Création — images et aperçu

**Files :** Modify `public/creation.html`, `README.md`

**Interfaces :** Consumes `POST /api/images`.

- [ ] **Step 1 : image** : « Choisir une image » (`<input type=file accept="image/*">`), envoi des octets à `/api/images?filename=…`, le nom renvoyé est mis dans la question ; vignette (`/images/<nom>`), « Changer », « Retirer » ; message d'erreur si refus (format, taille).
- [ ] **Step 2 : aperçu Grand écran** : panneau sombre reproduisant en réduit `screen.html` en étape « propositions affichées » (titre « Question n/N », image et/ou texte, 4 propositions colorées), mis à jour à chaque frappe.
- [ ] **Step 3 : README** : section Création (images copiées dans `images/`, aperçu, parties incomplètes).
- [ ] **Step 4 : vérification visuelle** (Chrome headless) : question avec image téléversée, aperçu fidèle ; image trop grosse refusée avec message. `npm test` passe.
- [ ] **Step 5 : commit** `feat: add image upload and screen preview to creation page`
