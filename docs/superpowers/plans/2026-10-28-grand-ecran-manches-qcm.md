# Grand écran, manches et QCM — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** ajouter le Grand écran piloté par étapes depuis la Régie, les manches importées depuis un fichier CSV avec scores par manche, puis les manches QCM.

**Architecture :** la logique de jeu sort de `server.js` vers un module pur `lib/game.js` (testable sans réseau, minuteurs injectables). `server.js` ne garde que HTTP, sockets et sauvegarde. Le serveur diffuse un état filtré par rôle (`host`, `screen`, `player`), pour que le Grand écran et les Buzzers ne reçoivent jamais un secret (bonne réponse avant révélation, choix des autres équipes). Les pages restent en HTML/JS vanilla.

**Tech stack :** Node ≥ 18 (testé sur 24), Express 4.21.2, socket.io 4.8.1, qrcode 1.5.4, `node:test` + `node:assert/strict` pour les tests.

**Spec :** `docs/superpowers/specs/2026-10-28-grand-ecran-manches-qcm-design.md` (à lire en entier avant de commencer). Vocabulaire : `CLAUDE.md`.

## Global Constraints

- Aucune dépendance à internet pendant la soirée : pas de CDN, pas de police distante, images servies depuis `images/`.
- Aucune nouvelle dépendance npm (ni runtime ni dev). Tests avec `node --test`.
- Pas de build ; une page = un fichier HTML avec CSS et JS inline, variables CSS sur `:root` + variante `prefers-color-scheme: dark`, respect de `prefers-reduced-motion`.
- Le serveur est l'unique source de vérité ; toute action Régie qui modifie l'état passe par le mécanisme d'annulation (Z).
- `performance.now()` du buzz reste la première instruction du handler `buzz`.
- Interface, README, commentaires en français (apostrophe `’`, espace avant `:` `?` `!`). Identifiants en anglais. Commits en anglais, Conventional Commits, un changement logique par commit, se terminant par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Noms de code : étape `stage` ∈ `setup | play | summary | final` ; manche `section` ; type de manche `buzzer | qcm` ; morceau `round` (existant) ; question `question`. `phase` est réservé aux buzzers (`closed | open | buzzed`).
- Sans fichier importé, la soirée se joue exactement comme aujourd'hui (une manche buzzer « Manche 1 »).

## Review Focus

1. **Double appui** (Entrée ou B pressés deux fois avant la mise à jour) : la seconde action est ignorée, jamais deux étapes sautées ni deux points. → test `qcm actions are idempotent` (Tâche 8).
2. **Buzzer rechargé pendant un compte à rebours** : l'équipe retrouve sa réponse et peut encore la changer. → test `player state carries its own answer only` (Tâche 8).
3. **CSV d'Excel français** : Windows-1252, `;`, accents, champ entre guillemets contenant `;` et un retour à la ligne. → test `parses an Excel windows-1252 export` (Tâche 4).
4. **Z après expiration du compte à rebours, après un +1** : annuler le +1 ne relance pas un compte à rebours fantôme. → test `undo of an unrelated action keeps the countdown step` (Tâche 8).
5. **Redémarrage entre Révéler et Question suivante** : pas de double point. → test `revealed question survives a reload` (Tâche 8).

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/game.js` (créé) | État du jeu et toutes les actions (joueurs, Régie, annulation, sauvegarde/chargement, état public par rôle). Aucune dépendance réseau. |
| `lib/game.test.js` (créé) | Tests du jeu. |
| `lib/ranking.js` (+ `.test.js`) | Classement dense et podium. |
| `lib/csv.js` (+ `.test.js`) | Décodage des octets (UTF-8/Windows-1252) et parsing CSV. |
| `lib/game-file.js` (+ `.test.js`) | Validation des lignes CSV → liste de manches. |
| `server.js` (modifié) | Routes, sockets, rooms par rôle, sauvegarde disque, minuteur réel. |
| `public/screen.html` (créé) | Grand écran. |
| `public/host.html`, `public/player.html` (modifiés) | Régie, Buzzer. |
| `images/.gitkeep`, `exemple-soiree.csv` (créés) | Dossier d'images, fichier d'exemple. |
| `README.md`, `package.json`, `.gitignore` (modifiés) | Doc animateur, script `test`, ignorer `images/*`. |

---

# Livraison 1 — Grand écran et étapes

### Tâche 1 : extraire la logique de jeu dans `lib/game.js` (sans changement de comportement)

**Files :**
- Create : `lib/game.js`, `lib/game.test.js`
- Modify : `server.js` (tout le bloc État / Sauvegarde / Annuler / Sockets), `package.json` (script `"test": "node --test"`)

**Interfaces :**
- Produces :
  ```
  createGame({ now = () => performance.now(), timers = { set: setTimeout, clear: clearTimeout }, onTimer = () => {} } = {}) -> Game
  Game.join(socketId: string, rawName: string) -> { ok: true, teamId, name } | { ok: false, error }
  Game.leave(socketId: string) -> void
  Game.buzz(socketId: string, at: number) -> { ok: true, rank } | { ok: false, reason: 'not-joined'|'closed'|'excluded'|'already' }
  Game.host(action: string, payload?: object) -> { changed: boolean, kickedSockets?: string[] }
  Game.undo() -> boolean
  Game.publicState({ role: 'host'|'screen'|'player', teamId?: string }) -> object
  Game.toSaved() -> object          // ce qui va dans scores.json
  Game.load(data: unknown) -> { teams: number }   // tolère données invalides : ignore les équipes mal formées
  ```
  Actions `host` de cette tâche : `open`, `close`, `correct`, `wrong`, `unexclude {teamId}`, `score {teamId, delta}`, `kick {teamId}`, `reset-scores`. `host()` encapsule le mécanisme actuel de `hostOnly` (snapshot avant, empilé seulement si changé, max 50).
  `buzz` reçoit `at` en paramètre : `server.js` appelle `performance.now()` en première ligne du handler et le passe.
  `publicState` renvoie pour l'instant la même forme qu'aujourd'hui pour les trois rôles (`phase, round, buzzes, excluded, canUndo, teams[{id,name,score,online}]`).

- [ ] **Step 0 : commiter la documentation existante**

```bash
git add CLAUDE.md docs/
git commit -m "docs: add project CLAUDE.md, design spec, plan and backlog"
```

- [ ] **Step 1 : écrire les tests de caractérisation** dans `lib/game.test.js` :
  - `join creates a team and merges names case-insensitively` : `join('s1','Les Loups')` puis `join('s2','les  loups')` → même `teamId`, `online === 2`.
  - `join rejects an empty name` : `join('s1','  ')` → `{ ok:false }`.
  - `first buzz wins and later buzzes are ranked` : `host('open')`, buzz s1 à t=100, s2 à t=150 → `phase==='buzzed'`, `buzzes[1].deltaMs===50`.
  - `buzz is refused when closed, excluded or already buzzed` : les trois `reason`.
  - `correct gives one point once` : `host('correct')` deux fois → score 1, second appel `changed:false`.
  - `wrong excludes the first team and reopens` : `phase==='open'`, `excluded` contient l'équipe.
  - `undo restores score and round state` : correct puis `undo()` → score 0, `phase==='buzzed'`.
  - `kick returns the team sockets and undo brings the team back` : `kickedSockets` = `['s1']` ; après `undo()` l'équipe existe avec `online===0`.
  - `teams are sorted by score then name (fr)`.
  - `toSaved/load round-trip keeps teams, scores and round number`.
  - `load ignores malformed teams` : `load({ teams:[{id:1}] })` → 0 équipe, pas d'exception.

- [ ] **Step 2 : lancer** `npm test` → échec (`Cannot find module './game'`).

- [ ] **Step 3 : implémenter `lib/game.js`** en déplaçant le code existant de `server.js` (mêmes règles, mêmes commentaires). `server.js` garde : routes, `lanAddresses`, lecture/écriture atomique de `scores.json` (appelle `game.toSaved()` / `game.load()`), et les handlers socket qui délèguent au jeu puis appellent `broadcast()`.

- [ ] **Step 4 : lancer** `npm test` → tout passe. Vérification manuelle : `npm start`, ouvrir la Régie et deux Buzzers, jouer un morceau (Espace, buzz, M, buzz, B, Z), redémarrer : scores rechargés.

- [ ] **Step 5 : commit** `refactor: move game logic into lib/game.js with tests`

### Tâche 2 : étapes, rôle Grand écran et classement

**Files :**
- Create : `lib/ranking.js`, `lib/ranking.test.js`
- Modify : `lib/game.js`, `lib/game.test.js`, `server.js`

**Interfaces :**
- Consumes : `createGame` (Tâche 1).
- Produces :
  ```
  rankTeams(teams: {id,name,score}[]) -> {id,name,score,place}[]   // trié score desc puis nom (fr), place dense
  podium(teams) -> { place: 1|2|3, teams: {id,name,score}[] }[]   // seulement les places présentes
  ```
  Nouveaux champs d'état : `stage` (défaut `'setup'`), `joinIp` (string|null). Nouvelles actions `host` : `stage {stage}` (refuse toute valeur hors des quatre), `join-ip {ip}` (même regex que `/qr.svg`). Les deux sont dans le snapshot (annulables) et dans `toSaved()`.
  `publicState` ajoute `stage`, `joinIp`, et `teams[].place`.
  Côté serveur : sockets rangés en rooms `hosts`, `screens`, `players` (rôle `screen` sans clé). `broadcast()` émet `publicState({role})` à chaque room ; pour `players`, une émission par socket avec son `teamId` (prépare la Tâche 8). Le rôle `screen` reçoit aussi `info` (ips, port). Route `GET /screen` → `public/screen.html`, déclarée avant `express.static`.

- [ ] **Step 1 : tests `ranking.test.js`** :
  - `dense ranking shares places without gaps` : scores 12, 12, 10 → places `[1,1,2]`.
  - `podium keeps every team of places 1 to 3` : scores 9, 7, 5, 5, 5, 5, 5, 2 → `podium` = 3 marches, la 3e contient 5 équipes ; l'équipe à 2 n'apparaît pas.
  - `podium with fewer than three distinct scores` : 4, 4 → une seule marche (place 1, 2 équipes).
  - `zero teams gives an empty podium`.
- [ ] **Step 2 : tests `game.test.js`** :
  - `stage defaults to setup and is undoable` : `host('stage',{stage:'final'})`, `undo()` → `'setup'`.
  - `invalid stage is ignored` : `host('stage',{stage:'nope'})` → `changed:false`.
  - `stage and joinIp survive toSaved/load`.
- [ ] **Step 3 : lancer** `npm test` → échecs attendus.
- [ ] **Step 4 : implémenter** `lib/ranking.js`, les champs dans `lib/game.js`, les rooms et la route dans `server.js`.
- [ ] **Step 5 : lancer** `npm test` → tout passe.
- [ ] **Step 6 : commit** `feat: add game stages, screen role and dense ranking`

### Tâche 3 : page Grand écran et choix de l'étape dans la Régie

**Files :**
- Create : `public/screen.html`
- Modify : `public/host.html`, `README.md`

**Interfaces :**
- Consumes : `publicState({role:'screen'})` avec `stage`, `joinIp`, `teams[].place`, `phase`, `buzzes`, `round` ; événement `info` ; `podium` est recalculé côté page à partir de `teams[].place` (pas de règle de jeu nouvelle : `place` vient du serveur).
- Produces : événements Régie `host:stage {stage}` et `host:join-ip {ip}` (le sélecteur d'IP existant envoie `join-ip` à chaque changement et au premier `info`).

- [ ] **Step 1 : `screen.html`**, connexion `io({ auth:{ role:'screen' } })`, un bloc par étape, affiché selon `state.stage` :
  - `setup` : QR code (`/qr.svg?ip=<joinIp ou première IP>`) en grand, adresse `ip:port` en texte, liste des équipes (pastille en ligne/hors ligne) avec animation d'entrée.
  - `play` : liste classée (place, nom, score), l'équipe qui vient de buzzer en bandeau (même logique que la Régie : `phase==='buzzed'` → `buzzes[0].name`), état des buzzers (« Buzzers ouverts » / « Fermé »). Pas de QR code.
  - `summary` : tableau équipe / Total, trié (une colonne par manche viendra en Tâche 7).
  - `final` : podium 3 marches, plusieurs noms par marche possibles, marche 1 au centre.
  - Lisible à 10 m : tailles en `clamp(…, vw, …)`, contraste fort ; message plein écran « Connexion perdue » si déconnecté.
- [ ] **Step 2 : Régie** : bloc « Grand écran » dans la colonne de droite, 4 boutons radio Installation / Jeu / Bilan / Fin (l'étape active en surbrillance), et le lien `/screen` à ouvrir sur le projecteur.
- [ ] **Step 3 : README** : section « Grand écran » (ouvrir `http://localhost:3000/screen` dans une seconde fenêtre, la glisser sur le projecteur, plein écran F11 ; les 4 étapes).
- [ ] **Step 4 : vérification manuelle** : `npm start`, Régie + Grand écran + 2 Buzzers. Passer par les 4 étapes ; un Buzzer qui rejoint apparaît en Installation ; un buzz s'affiche en Jeu ; Z annule un changement d'étape ; recharger le Grand écran garde l'étape ; redémarrer le serveur garde l'étape. `npm test` passe.
- [ ] **Step 5 : commit** `feat: add projected screen page driven by host stages`

---

# Livraison 2 — Manches et import CSV

### Tâche 4 : décodage et parsing CSV

**Files :** Create `lib/csv.js`, `lib/csv.test.js`

**Interfaces :**
- Produces :
  ```
  decodeCsvBytes(bytes: Buffer|Uint8Array) -> string   // retire le BOM ; UTF-8 strict (TextDecoder fatal), sinon 'windows-1252'
  parseCsv(text: string) -> string[][]                  // séparateur détecté sur la 1re ligne : ';' si plus de ';' que de ',' hors guillemets
  ```
  Règles : guillemets doubles RFC 4180 (`""` = guillemet), retours à la ligne permis dans les guillemets, `\r\n` et `\n`, lignes entièrement vides ignorées, cellules non trimées (le trim est fait en Tâche 5).

- [ ] **Step 1 : tests** :
  - `strips the UTF-8 BOM`.
  - `parses an Excel windows-1252 export` : octets Windows-1252 de `manche;type\r\nCinéma;buzzer\r\n"Culture; G";qcm\r\n` → `[['manche','type'],['Cinéma','buzzer'],['Culture; G','qcm']]`.
  - `detects comma separator`.
  - `handles escaped quotes and newlines inside quotes` : `"Il a dit ""oui""\nensuite"` → une cellule.
  - `skips blank lines`.
- [ ] **Step 2 : lancer** `node --test lib/csv.test.js` → échec.
- [ ] **Step 3 : implémenter** (parser à état caractère par caractère).
- [ ] **Step 4 : lancer** → passe.
- [ ] **Step 5 : commit** `feat: add dependency-free CSV decoding and parsing`

### Tâche 5 : validation du fichier de partie

**Files :** Create `lib/game-file.js`, `lib/game-file.test.js`

**Interfaces :**
- Consumes : sortie de `parseCsv`.
- Produces :
  ```
  buildSections(rows: string[][], { imageExists: (name: string) => boolean }) ->
    { ok: true, sections: Section[] } | { ok: false, error: string }
  Section = { name: string, type: 'buzzer'|'qcm', questions: Question[] }   // questions vide pour buzzer
  Question = { text: string, image: string|null, choices: { A, B, C, D }, answer: 'A'|'B'|'C'|'D' }
  isSafeImageName(name: string) -> boolean   // pas de '/', '\', ni '..', non vide
  ```
  En-tête attendu (insensible à la casse, cellules trimées) : `manche;type;question;image;A;B;C;D;reponse`. Toutes les cellules trimées. Messages d'erreur en français citant le numéro de ligne du fichier (en-tête = ligne 1), par ex. `Ligne 4 : la réponse doit être A, B, C ou D.`
  Erreurs : en-tête incorrect ; nom de manche vide ; type inconnu ; manche buzzer sur plus d'une ligne ; même nom de manche non contigu (`Ligne 7 : la manche « Cinéma » apparaît déjà plus haut.`) ; même nom avec deux types ; question QCM sans texte ni image ; proposition vide ; réponse invalide ; image au nom dangereux ou absente (`Ligne 5 : image « acteur1.jpg » introuvable dans le dossier images/.`) ; aucune manche.
  **Livraison 2 seulement** : si au moins une manche est `qcm`, renvoyer `{ ok:false, error: 'Les manches QCM arrivent dans une prochaine version.' }` après validation complète (supprimé en Tâche 8).

- [ ] **Step 1 : tests** : un test par erreur ci-dessus (assert sur le numéro de ligne dans `error`), plus `builds buzzer sections in file order`, `rejects qcm sections for now` (fichier QCM valide → message « Les manches QCM arrivent… » ; ce test est remplacé en Tâche 8), et `accepts header in any case`.
- [ ] **Step 2 : lancer** → échec.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** → passe.
- [ ] **Step 5 : commit** `feat: validate game file rows into sections`

### Tâche 6 : manches dans le jeu (scores par manche, import, sauvegarde v2)

**Files :** Modify `lib/game.js`, `lib/game.test.js`, `server.js`

**Interfaces :**
- Consumes : `buildSections`, `decodeCsvBytes`, `parseCsv`.
- Produces :
  - État : `sections: Section[]` (défaut `[{ name:'Manche 1', type:'buzzer', questions:[] }]`), `currentSection: number`, `team.scores: number[]` (une case par manche, 0 par défaut). Score total = somme.
  - Actions `host` : `import { sections }` (le serveur a déjà parsé et validé ; refusé avec `error: 'Des points ont déjà été donnés. Remettez d’abord les scores à zéro.'` si un score non nul existe ; réinitialise `currentSection` à 0 et `scores` aux bonnes longueurs), `section { index }` (bornes vérifiées ; ferme les buzzers et vide `buzzes`/`excluded`). `host()` renvoie `{ changed, error? }`.
  - `correct` et `score` modifient `scores[currentSection]`. `reset-scores` remet tout à 0 et `currentSection` à 0.
  - `publicState` : `sections: [{ name, type, questionCount }]` (jamais les questions ni réponses ici), `currentSection`, `teams[].scores`, `teams[].score` = total, `place` sur le total.
  - `toSaved()` format v2 : `{ version: 2, stage, joinIp, round, sections, currentSection, teams: [{ id, name, scores }] }`. `load()` accepte l'ancien format (`teams[].score` → `scores: [score]` dans « Manche 1 »).
  - `server.js` : événement `host:import (bytes, ack)` → `decodeCsvBytes` → `parseCsv` → `buildSections(rows, { imageExists })` → `game.host('import', { sections })` → `ack({ ok, error })`. `imageExists(name)` = `isSafeImageName(name) && fs.existsSync(path.join(IMAGES_DIR, name))`, `IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'images')`. Route statique `/images` sur `IMAGES_DIR` (`dotfiles: 'deny'`, `index: false`).

- [ ] **Step 1 : tests** :
  - `points go to the current section` : section 0 → B ; `host('section',{index:1})` ; `score +1` → `scores` = `[1,1]`, `score` = 2.
  - `import is refused once points exist` puis accepté après `reset-scores`.
  - `import is undoable` : `undo()` restaure l'ancienne liste.
  - `changing section closes buzzers`.
  - `reset-scores clears every section and goes back to the first`.
  - `undo restores the point in the right section`.
  - `loads a v1 scores.json into Manche 1` : `load({ round: 3, teams:[{id:'a',name:'A',score:4}] })` → `scores` = `[4]`, `round` = 3.
  - `v2 round-trip keeps sections and current section`.
- [ ] **Step 2 : lancer** → échec.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** → passe.
- [ ] **Step 5 : commit** `feat: score per section and import sections from CSV`

### Tâche 7 : manches dans la Régie, le Grand écran et le README

**Files :** Modify `public/host.html`, `public/screen.html`, `public/player.html` (rien sauf si `score` change de sens : il reste le total), `README.md`, `.gitignore` ; Create `images/.gitkeep`, `exemple-soiree.csv`

**Interfaces :**
- Consumes : `publicState.sections`, `currentSection`, `teams[].scores`; événements `host:import`, `host:section`.

- [ ] **Step 1 : Régie** : bloc « Manches » : bouton « Importer les manches » (`<input type=file accept=".csv">`, lecture en `ArrayBuffer`, `socket.emit('host:import', buffer, ack)`), message d'erreur ou de succès (« 4 manches importées »), liste des manches avec type, manche en cours en surbrillance, boutons « ◀ Manche précédente » / « Manche suivante ▶ ».
- [ ] **Step 2 : Grand écran** : en `play`, nom de la manche en cours en titre (« Manche 2 : Années 80 ») ; en `summary`, une colonne par manche + Total, trié par total, manche en cours marquée.
- [ ] **Step 3 : fichiers** : `.gitignore` ajoute `images/*` et `!images/.gitkeep` ; `exemple-soiree.csv` = l'exemple de la spec §4.3 limité aux manches buzzer (la version QCM est ajoutée en Tâche 9).
- [ ] **Step 4 : README** : section « Préparer la soirée » (colonnes, `;` ou `,`, export Excel, dossier `images/`, réimport refusé si des points existent) et mise à jour du « Déroulé ».
- [ ] **Step 5 : vérification manuelle** : importer `exemple-soiree.csv`, jouer deux manches, vérifier le Bilan ; importer un fichier avec une erreur → message avec le numéro de ligne ; fichier exporté depuis Excel (Windows-1252) → accents corrects. `npm test` passe.
- [ ] **Step 6 : commit** `feat: show sections in host and screen, add game file docs`

---

# Livraison 3 — Manches QCM

### Tâche 8 : déroulé QCM dans le jeu

**Files :** Modify `lib/game.js`, `lib/game.test.js`, `lib/game-file.js`, `lib/game-file.test.js`, `server.js`

**Interfaces :**
- Consumes : `Section.questions`, minuteurs injectés de `createGame`.
- Produces :
  - État : `countdownSec` (défaut 20, bornes 5–120, annulable, sauvegardé) ; par manche `progress[i] = { index, revealed }` (sauvegardé) ; pour la manche en cours `qcm = { step, deadline, answers: Map<teamId, letter> }` (non sauvegardé, hors snapshot sauf `step`).
  - `step` ∈ `idle | question | choices | countdown | locked | revealed`. Transitions par actions explicites (une action invalide pour l'étape en cours → `changed:false`) :

    | Action `host('qcm', {action})` | depuis | vers |
    |---|---|---|
    | `show-question` | `idle` (et `index < questionCount`) | `question` |
    | `show-choices` | `question` | `choices` |
    | `start` | `choices` | `countdown` (arme le minuteur `countdownSec`) |
    | — minuteur expiré (pas une action, pas d'entrée d'annulation, appelle `onTimer`) | `countdown` | `locked` |
    | `reveal` | `locked` | `revealed` (+1 dans `scores[currentSection]` pour chaque équipe dont la réponse = `answer` ; `progress.revealed = true`) |
    | `next` | `revealed` | `idle`, `index + 1`, `revealed = false` |

  - `Game.answer(socketId, letter) -> { ok: true } | { ok: false, reason: 'not-joined'|'closed'|'invalid' }` : accepté seulement en `countdown`, lettre ∈ A–D ; remplace la réponse précédente de l'équipe.
  - Annulation (règles de la spec §5) : le snapshot contient `step` mais pas `answers` ni `deadline`. Dans `restore` : si le `step` restauré est `choices` alors que l'étape courante est `countdown` ou `locked` → arrêter le minuteur, vider `answers`. Si l'étape restaurée et l'étape courante sont toutes deux dans `{countdown, locked}` → garder l'étape courante et le minuteur. Annuler `reveal` retire les points (scores du snapshot) et revient à `locked` avec les réponses intactes.
  - Changer de manche : quitte la question en cours (si non révélée, `step = idle`, réponses vidées, minuteur arrêté) ; revenir sur une manche QCM reprend à `progress[i]`.
  - Pendant une manche `qcm`, `open/close/correct/wrong` et `buzz` sont refusés (`changed:false` / `reason:'closed'`).
  - Chargement : `progress.revealed === true` → `step = 'revealed'` ; sinon `step = 'idle'`.
  - `publicState` selon le rôle (champ `qcm`, `null` hors manche QCM) :
    - tous : `{ step, index, total, remainingMs (en countdown), answeredCount, teamCount }` + `question { text, image, choices }` dès `question` (`choices` seulement à partir de `choices`).
    - `host` : + `answer` (toujours) et `answers` (objet `teamId → lettre`, en direct).
    - `screen` : + `answer` et `counts {A,B,C,D}` seulement en `revealed`.
    - `player` : + `myAnswer` (sa propre lettre ou `null`), + `answer` seulement en `revealed`.
  - `server.js` : événement joueur `answer (letter, ack)` ; `host:qcm {action}` ; `host:countdown {seconds}` ; `onTimer` → `broadcast()`.
  - `game-file.js` : suppression du rejet des manches QCM.

- [ ] **Step 1 : tests** (minuteurs factices : `timers.set` enregistre le callback, le test l'appelle) :
  - `runs a full qcm question` : show-question → show-choices → start → 2 équipes répondent (une bonne) → minuteur expiré → `locked` → reveal → la bonne équipe a 1 point dans la manche QCM → next → `idle`, `index` 1.
  - `qcm actions are idempotent` : `show-question` deux fois → second `changed:false`, `step === 'question'`.
  - `answers are refused outside the countdown` et `a team can change its answer during the countdown`.
  - `screen and player never see the answer before reveal` : en `countdown`, `JSON.stringify(publicState({role:'screen'}))` et `({role:'player',teamId})` ne contiennent ni `answer` ni la réponse d'une autre équipe ; en `revealed`, `answer` présent.
  - `player state carries its own answer only` : `myAnswer` de l'équipe 1 = 'B', aucune trace de la lettre de l'équipe 2.
  - `undo of start stops the countdown and clears answers` : `timers.clear` appelé, `answeredCount === 0`, `step === 'choices'`.
  - `undo after expiry also goes back to choices`.
  - `undo of an unrelated action keeps the countdown step` : start, `score +1`, expiration, `undo()` → `step === 'locked'`, réponses intactes.
  - `undo of reveal removes the points and keeps answers`.
  - `revealed question survives a reload` : reveal, `toSaved()` → nouveau jeu `load()` → `step === 'revealed'`, `host('qcm',{action:'reveal'})` → `changed:false`, scores inchangés.
  - `switching sections resumes qcm progress`.
  - `buzzers are disabled during a qcm section`.
  - `countdownSec is clamped to 5..120`.
  - `game-file` : `rejects qcm sections for now` est remplacé par `builds buzzer and qcm sections in file order` (questions, image, propositions et réponse produites).
- [ ] **Step 2 : lancer** `npm test` → échecs.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : lancer** → passe.
- [ ] **Step 5 : commit** `feat: add qcm sections with countdown, answers and reveal`

### Tâche 9 : QCM dans le Buzzer, le Grand écran et la Régie

**Files :** Modify `public/player.html`, `public/screen.html`, `public/host.html`, `README.md`, `exemple-soiree.csv`

**Interfaces :**
- Consumes : `publicState.qcm` par rôle (Tâche 8) ; événements `answer`, `host:qcm`, `host:countdown`.
- Le compte à rebours affiché : à chaque `state`, `localDeadline = Date.now() + remainingMs`, rafraîchi par `requestAnimationFrame`, jamais en dessous de 0.

- [ ] **Step 1 : Buzzer** : en manche QCM, remplace le gros bouton par 4 gros boutons A, B, C, D (lettres seules), actifs seulement en `countdown`, réponse choisie en surbrillance (`myAnswer`) ; en `locked` « Réponse enregistrée : B » ; en `revealed` « Bonne réponse ! » ou « Raté, c’était C ». Hors manche QCM : inchangé.
- [ ] **Step 2 : Grand écran** en `play` + manche QCM, selon `step` (spec §4.4) : `idle` → classement ; `question` → « Question 3/10 », image (`/images/<nom>`) et/ou texte ; `choices` → + 4 propositions ; `countdown` → + temps restant en gros + « 5/8 équipes ont répondu » ; `locked` → « Temps écoulé » ; `revealed` → bonne proposition en valeur, autres estompées, nombre d'équipes par lettre.
- [ ] **Step 3 : Régie** en manche QCM : panneau à la place de la zone buzzer — question, propositions, bonne réponse (pour l'animateur), réponse de chaque équipe en direct, un seul bouton principal dont le libellé suit `step` (Afficher la question / Afficher les propositions / Lancer le compte à rebours / Révéler / Question suivante ; désactivé en `countdown`), raccourci Entrée qui envoie l'action correspondant à l'étape affichée ; « Manche terminée » quand `index === total`. Réglage « Compte à rebours : [20] s » dans le bloc Manches. Espace/B/M/F ne s'affichent qu'en manche buzzer.
- [ ] **Step 4 : `exemple-soiree.csv`** = l'exemple complet de la spec §4.3 (avec une question texte seule ; la question à image est commentée dans le README car l'image n'est pas fournie). **README** : section « Manches QCM » (déroulé, touche Entrée, réglage du compte à rebours, Z).
- [ ] **Step 5 : vérification manuelle** : Régie + Grand écran + 3 Buzzers (dont un iPhone si possible). Jouer une question QCM en entier ; double Entrée rapide ne saute pas d'étape ; recharger un Buzzer pendant le compte à rebours → la réponse réapparaît ; Z sur « Lancer » ; redémarrer le serveur après Révéler → pas de double point ; image affichée sans internet. `npm test` passe.
- [ ] **Step 6 : commit** `feat: play qcm sections on buzzer, screen and host`
