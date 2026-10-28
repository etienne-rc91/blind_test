# Extrait musical dans une question QCM — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une question QCM peut avoir un extrait (fichier de `musiques/` ou titre Spotify, Début/Fin) que la Régie joue avant d’afficher la question ; R le rejoue ; « Afficher la question » le coupe ; préparation dans Création.

**Architecture :** deux nouvelles étapes QCM dans `lib/game.js` (`intro` = page de la question sans texte, `listening` = extrait en cours) entre `idle` et `question`. La lecture réutilise l’état `song` existant (`index`, `audio`, `seq`, `songEnded`, règle « un Z ne rend jamais la musique audible ») : `song.index` vaut l’index de la question. La Régie reçoit dans `state.song` la liste des extraits de la manche indexée par question, si bien que son lecteur actuel (`syncSound`, `tick`, `host:ended`) marche tel quel. Le CSV remplit `musique;debut;fin` sur les lignes `qcm`.

**Tech stack :** Node ≥ 18, Express 4.21.2, socket.io 4.8.1, `node:test` + `node:assert/strict`, `public/players.js` (lecteur commun existant).

**Spec :** `docs/superpowers/specs/2026-10-28-qcm-extrait-design.md` (à lire en entier). S’appuie sur `2026-10-28-musique-design.md` et `2026-10-28-grand-ecran-manches-qcm-design.md`, déjà construits. Vocabulaire : `CLAUDE.md`.

## Global Constraints

- Aucune nouvelle dépendance npm. Pas de build. JS vanilla. Un fichier HTML par écran (seule exception existante : `public/players.js`).
- Internet uniquement pour les extraits Spotify ; une partie sans Spotify ne charge rien de distant.
- Le serveur est l’unique source de vérité : la Régie applique `state.song.audible` et ne remonte que `host:ended`.
- `performance.now()` reste la première instruction du handler `buzz` ; rien n’est ajouté avant.
- Toute action animateur passe par `game.host()` (annulable). `songEnded` n’est pas une action annulable.
- Un Z ne rend jamais la musique audible si elle ne l’était pas juste avant le Z.
- Ni le Buzzer ni le Grand écran ne reçoivent la source d’un extrait (nom de fichier, identifiant Spotify). Le Grand écran ne reçoit ni texte ni image de la question aux étapes `intro` et `listening`.
- Une question sans extrait et tout CSV existant se jouent exactement comme avant.
- Noms : l’extrait d’une question est `question.extract = { source, ref, start, end }` (clé absente = pas d’extrait). Étapes : `intro`, `listening`. Actions QCM : `play-extract`, `skip-extract`. `phase` reste réservé aux buzzers.
- Libellés UI exacts : « Lancer l’extrait », « Extrait en cours… », « Afficher la question », « Rejouer l’extrait », « ♪ Écoutez… », « Extrait (facultatif) », « Retirer l’extrait ».
- Interface, README, commentaires en français (apostrophe `’`, espace avant `:` `?` `!`). Identifiants en anglais. Commits en anglais, Conventional Commits, un changement logique par commit, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `exemple-soiree.csv` et `docs/backlog.md` ont des modifications locales de l’animateur : ne pas les commiter sauf à la Tâche 7, et dans ce cas uniquement `docs/backlog.md` après accord.

## Review Focus

1. **Double Entrée pendant l’extrait** : le second appui ne coupe pas la musique et n’avance pas → test `enter is ignored while the extract plays` (Tâche 2).
2. **Fin de passage en retard** : un `host:ended` d’un passage précédent (après R, ou après Z de « Lancer l’extrait ») n’affiche pas la question → test `stale ended does not advance the question` (Tâche 2).
3. **Fuite de la réponse** : une source d’extrait (`ref`) ou le texte de la question avant l’étape 3 envoyé au Grand écran ou au Buzzer → test `screen and player never see the extract source nor the question before it` (Tâche 2).
4. **Z après « Afficher la question »** : retour à `listening` musique muette, R la relance, le bouton reste disponible → test `undo of skip-extract stays silent and replay works` (Tâche 2).
5. **Modification à chaud d’une question déjà posée** : changement de source refusé, Début/Fin acceptés ; question en cours encore à `idle` modifiable → tests de la Tâche 3.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/songs.js` (+ test) | `isExtract` (morceau sans réponse) ; `isSong` s’appuie dessus. |
| `lib/game-file.js` (+ test) | Extrait sur une ligne `qcm` : lecture stricte / brouillon, écriture. |
| `lib/parties.js` (+ test) | `cleanSections` garde `extract` ; `list` compte les extraits Spotify. |
| `lib/game.js` (+ test) | Étapes `intro` / `listening`, actions, R en QCM, `songEnded`, état par rôle. |
| `lib/live-edit.js` (+ test) | Règles d’édition à chaud de l’extrait. |
| `server.js` (+ `server.test.js`) | Avertissement Spotify au lancement, pochette ignorée en QCM. |
| `public/host.html` | Régie : boutons et libellés des nouvelles étapes, R, bloc extrait. |
| `public/screen.html`, `public/player.html` | Grand écran (page sans texte, « ♪ Écoutez… »), Buzzer (textes d’attente). |
| `public/creation.html` | Bloc « Extrait (facultatif) » dans l’éditeur de question, liste ♪, aperçu. |
| `README.md`, `CLAUDE.md`, spec | Docs. |

---

### Tâche 1 : format de l’extrait (helpers, CSV, parties)

**Files :** Modify `lib/songs.js`, `lib/game-file.js`, `lib/parties.js` ; Test `lib/songs.test.js`, `lib/game-file.test.js`, `lib/parties.test.js`

**Interfaces :**
- Produces : `isExtract(x) -> boolean` exporté par `lib/songs.js` (source `file`/`spotify` valide, `start`/`end` entiers ≥ 0, `start < end`, pas de champ `answer` exigé). `isSong(x)` = `isExtract(x)` + `answer` non vide.
- Produces : une question issue de `buildSections` porte `extract: { source, ref, start, end }` seulement si la ligne a une musique (en brouillon : champs `null` possibles, comme les morceaux). Sans musique, la clé `extract` est absente (les `deepEqual` existants ne changent pas).
- Produces : `cleanSections` garde `q.extract` nettoyé (`{ source, ref, start, end }`, mêmes règles que `cleanSong` sans `answer`) s’il a au moins un champ renseigné, sinon pas de clé.

- [ ] **Step 1 : tests qui échouent**

`lib/songs.test.js` :
```js
test('isExtract accepts a song without answer', () => {
  assert.equal(isExtract({ source: 'file', ref: 'a.mp3', start: 0, end: 10 }), true);
  assert.equal(isExtract({ source: 'file', ref: 'a.mp3', start: 10, end: 10 }), false);
  assert.equal(isExtract({ source: 'spotify', ref: 'bad', start: 0, end: 10 }), false);
  assert.equal(isSong({ source: 'file', ref: 'a.mp3', start: 0, end: 10 }), false);   // réponse toujours exigée pour un morceau
});
```
`lib/game-file.test.js` (fixture : `const qcm12 = (name, music, start, end) => [name, 'qcm', 'De quel film ?', '', 'a', 'b', 'c', 'd', 'C', music, start, end];`) :
- `qcm row with an extract` : `build12([qcm12('Ciné', 'a.mp3', '0:12', '0:40')])` → `questions[0].extract` deepEqual `{ source: 'file', ref: 'a.mp3', start: 12, end: 40 }`, `answer === 'C'`.
- `qcm row accepts a spotify extract` : `spotify:track:${SPOT}` → `{ source: 'spotify', ref: SPOT, … }`.
- `qcm row without music has no extract key` : `assert.equal('extract' in questions[0], false)`.
- `qcm extract errors in strict mode` : fin avant début → error `/fin est avant le début/` ; début manquant → `/début est manquant/` ; fichier absent `b.mp3` → `/introuvable dans le dossier musiques/` ; source invalide `x.txt` → `/invalide/`.
- `qcm extract problems in draft` : `build12([qcm12('Ciné', 'a.mp3', '0:40', '0:12')], { draft: true })` → ok, `problems` contient `'Ciné, question 1 : fin avant le début'`.
- `draft qcm row with only music is not an empty question` : ligne `qcm` dont seuls `musique;debut;fin` sont remplis → une question gardée (pas `empty`), problèmes « ni texte ni image », « proposition A vide »…
- `writeCsv writes qcm extracts and reads them back` : `buildSections(parseCsv(writeCsv(sections).slice(1)), …)` rend la même question, extrait compris ; une question sans extrait écrit trois cellules vides.

`lib/parties.test.js` :
- `prepare keeps a qcm extract` : enregistrer une manche QCM dont une question a `extract: { source: 'file', ref: 'a.mp3', start: 1, end: 9 }` → `prep.sections[0].questions[0].extract` identique.
- `list counts spotify extracts` : une partie QCM avec un extrait Spotify → `spotifyCount === 1` dans la liste.

- [ ] **Step 2 : lancer, vérifier l’échec** — `node --test lib/songs.test.js lib/game-file.test.js lib/parties.test.js` → FAIL (`isExtract is not a function`, `extract` absent).

- [ ] **Step 3 : implémenter**
  - `lib/songs.js` : `isExtract`, et `isSong(x) = isExtract(x) && typeof x.answer === 'string' && x.answer.trim() !== ''`.
  - `lib/game-file.js` : sur une ligne `qcm`, si `music || rawStart || rawEnd` : même analyse que pour un morceau (source invalide = erreur bloquante même en brouillon ; manques → `missing` avec les mêmes messages que les morceaux, sans « réponse vide »), puis `extract` sur la question. Le test « ligne qcm entièrement vide » inclut `music, rawStart, rawEnd`. `writeCsv` écrit `formatSource(q.extract)`, `formatTime(start)`, `formatTime(end)` dans les 3 dernières colonnes.
  - `lib/parties.js` : `cleanExtract` (à partir de `cleanSong` sans `answer`) dans `cleanSections` ; `spotifyCount` de `list` compte aussi `questions[].extract.source === 'spotify'`.

- [ ] **Step 4 : vérifier** — `npm test` → PASS (tous les fichiers).

- [ ] **Step 5 : commit** — `git add lib/songs.js lib/songs.test.js lib/game-file.js lib/game-file.test.js lib/parties.js lib/parties.test.js && git commit -m "feat: read and write an extract on qcm questions"`

---

### Tâche 2 : déroulé d’une question avec extrait (`lib/game.js`)

**Files :** Modify `lib/game.js` ; Test `lib/game.test.js`

**Interfaces :**
- Consumes : `isExtract` (Tâche 1) ; forme `question.extract`.
- Produces (étapes, dans `qcm.step`) : `idle | intro | listening | question | choices | countdown | locked | revealed`.
- Produces (actions `host('qcm', { action })`) :
  - `show-question` : depuis `idle` → `intro` si la question a un extrait, sinon `question` (inchangé).
  - `play-extract` : depuis `intro` → `listening` ; `song = { index: <index de la question>, concluded: false, outcome: null, audio: 'playing' }`, `song.seq += 1`.
  - `skip-extract` : depuis `listening` seulement → `question`, `song.audio = 'stopped'`.
  - `next` : en plus de l’existant, `resetSong()`.
- Produces : `host('replay')` en QCM : si la question en cours a un extrait, `song.index === progress.index` et l’étape est dans `listening | question | choices | countdown | locked | revealed` → `song.audio = 'playing'`, `song.seq += 1`. Sans effet sinon. En manche buzzer : inchangé.
- Produces : `songEnded(seq)` en QCM : mêmes conditions qu’aujourd’hui (`audio === 'playing'`, `seq === song.seq`) ; si en plus `qcm.step === 'listening'` → `qcm.step = 'question'`. Sinon seulement `audio = 'ended'`.
- Produces : `host('stage', { stage })` en QCM, vers une étape autre que `play` : `song.audio = 'stopped'`.
- Produces (`publicState`) :
  - `qcm` (tous rôles) : `step` peut valoir `intro` / `listening`. Rôle `screen` : `question` absent aux étapes `idle | intro | listening` ; `listening: true` à l’étape `listening`. Rôle `host` : `question` présent dès `intro` (texte, image, et `choices` à partir de `choices` comme aujourd’hui) ; `hasExtract: boolean` pour la question en cours. Rôle `player` : rien de nouveau.
  - `song` en manche QCM : rôle `host` → `null` si aucune question de la manche n’a d’extrait, sinon `{ kind: 'qcm', index: song.index, total: questions.length, played: progress.index, concluded: false, outcome: null, audio, seq, audible, songs: questions.map((q) => (q.extract ? { ...q.extract } : null)) }` ; rôles `screen` et `player` → `null`.
  - `sections[].spotifyCount` compte aussi les extraits Spotify des questions.
- Ne change pas : `inSong()`, `savedProgress()`, `concludeSong()` restent limités aux manches buzzer (ne pas généraliser `currentSongs()` aux QCM).

- [ ] **Step 1 : tests qui échouent** (fixture : `const X = (i) => ({ source: 'file', ref: \`extrait-${i}.mp3\`, start: 3, end: 20 });` et une variante de `qcmGame()` dont la manche QCM est `[ { ...Q('Q1', 'B'), extract: X(0) }, Q('Q2', 'C'), { ...Q('Q3', 'A'), extract: X(2) } ]`)
  - `question with extract goes through intro and listening` : `show-question` → step `intro` ; `play-extract` → `listening`, `hsong(g).audible === true`, `hsong(g).index === 0` ; `g.songEnded(hsong(g).seq)` → step `question`, audio `ended`.
  - `question without extract is unchanged` : Q2 → `show-question` mène directement à `question`.
  - `enter is ignored while the extract plays` : en `listening`, `qa(g, 'show-choices')`, `qa(g, 'play-extract')`, `qa(g, 'show-question')` → step toujours `listening`, `seq` inchangé, `audible` toujours vrai.
  - `skip-extract stops the music and shows the question` : en `listening` → step `question`, `audible === false`. `skip-extract` depuis `question` → sans effet (`changed === false`).
  - `stale ended does not advance the question` : `play-extract` (seq n), `replay` (seq n+1), `songEnded(n)` → `false`, step `listening` ; et : `play-extract`, Z (retour `intro`), `songEnded(oldSeq)` → `false`, step `intro`.
  - `replay works at every step after launch and never changes the step` : pour chaque étape `question`, `choices`, `countdown`, `locked`, `revealed` : `replay` → `audible === true`, seq +1, step inchangé, réponses et points inchangés. `replay` en `idle` et `intro` → sans effet.
  - `a replayed extract keeps playing through countdown and reveal` : R en `choices`, puis `start`, expiration, `reveal` → `audible` toujours vrai ; `songEnded(seq)` en `revealed` → step reste `revealed`.
  - `next question stops the extract` : R en `revealed`, `next` → `audible === false`, `hsong(g).index === null`.
  - `stage change away from play stops the extract` : `listening`, `host('stage', { stage: 'summary' })` → `audible === false`.
  - `undo never makes the extract audible` : `play-extract` puis Z → step `intro`, `audible === false` ; `play-extract`, `songEnded`, `show-choices`, Z → step `question`, audio `ended`, `audible === false`.
  - `undo of skip-extract stays silent and replay works` : `play-extract`, `skip-extract`, Z → step `listening`, `audible === false` ; `replay` → `audible === true`.
  - `screen and player never see the extract source nor the question before it` : à chaque étape de `intro` à `revealed`, `JSON.stringify(g.publicState({ role }))` pour `screen` et `player` ne contient pas `extrait-0.mp3` ; à `intro` et `listening`, `qstate(g, 'screen').question === undefined` et le texte `Q1` absent ; `qstate(g, 'screen').listening === true` en `listening` seulement.
  - `host sees extracts indexed by question` : `hsong(g).kind === 'qcm'`, `songs.length === 3`, `songs[1] === null`, `songs[2].ref === 'extrait-2.mp3'` ; `qstate(g).hasExtract` vrai sur Q1, faux sur Q2.
  - `restart during an extract goes back to idle` : `play-extract`, `g2.load(g.toSaved())` → step `idle`, `hsong(g2).index === null`.
  - `sections count spotify extracts` : une question avec extrait Spotify → `sections[1].spotifyCount === 1`.
  - `import refuses an invalid extract` : `extract: { ...X(0), end: 0 }` → `{ error }`.

- [ ] **Step 2 : lancer, vérifier l’échec** — `node --test lib/game.test.js` → FAIL sur les nouveaux tests.

- [ ] **Step 3 : implémenter** dans `lib/game.js` selon les Interfaces. `isQuestion` accepte `q.extract === undefined || isExtract(q.extract)`. `songState(role)` délègue à une `qcmSongState(role)` quand `isQcm()`. L’enregistrement `ended` (`{ section, index, seq }`) sert tel quel : `song.index` est l’index de la question.

- [ ] **Step 4 : vérifier** — `npm test` → PASS.

- [ ] **Step 5 : commit** — `git commit -m "feat: play an extract before showing a qcm question"`

---

### Tâche 3 : modification à chaud de l’extrait (`lib/live-edit.js`)

**Files :** Modify `lib/live-edit.js` ; Test `lib/live-edit.test.js`

**Interfaces :**
- Consumes : `checkLiveEdit({ oldSections, newSections, progress, currentSection, qcmStep, … })` existant.
- Produces : dans une manche QCM, une question `k` est **posée** si `k < p.index`, ou si `k === p.index` et (`p.revealed` ou (`i === currentSection` et `qcmStep !== 'idle'`)). Pour une question posée : ajout, retrait ou changement de `source`/`ref` de l’extrait → refus `l’extrait de la question ${k + 1} de la manche « ${name} » a changé` ; `start`/`end` modifiables.

- [ ] **Step 1 : tests qui échouent**
  - `accepts changing the extract of a question not yet asked` : manche QCM en cours, `progress.index = 1`, `qcmStep: 'idle'` → modifier/ajouter/retirer l’extrait de la question 2 (index 1) → ok.
  - `refuses changing the extract source of an asked question` : `progress.index = 1` → changer `ref` de la question 1 → refusé, `/l’extrait de la question 1 de la manche « .+ » a changé/` (nom de la manche QCM de la fixture `OLD`).
  - `refuses adding or removing an extract on the current question once shown` : `progress.index = 0`, `qcmStep: 'listening'` → retirer l’extrait de la question 1 → refusé ; avec `qcmStep: 'idle'` → accepté.
  - `accepts correcting start and end of an asked question` : `progress.index = 1`, changer `start`/`end` de la question 1 → ok.

- [ ] **Step 2 : lancer, vérifier l’échec** — `node --test lib/live-edit.test.js` → FAIL.
- [ ] **Step 3 : implémenter** dans la boucle QCM de `checkLiveEdit`, après les contrôles d’ordre existants.
- [ ] **Step 4 : vérifier** — `npm test` → PASS.
- [ ] **Step 5 : commit** — `git commit -m "feat: guard live edits of qcm extracts"`

---

### Tâche 4 : Régie (`public/host.html`, `server.js`)

**Files :** Modify `public/host.html`, `server.js` ; Test `server.test.js`

**Interfaces :**
- Consumes : étapes et actions de la Tâche 2 ; `state.song` QCM (`kind: 'qcm'`, `songs` indexés par question) ; `state.qcm.hasExtract`.
- Produces : rien pour les autres tâches.

- [ ] **Step 1 : test serveur qui échoue** (`server.test.js`, en suivant les tests existants de « Jouer ») : `play warns when a qcm extract uses spotify and spotify is not connected` → la réponse de « Jouer » d’une partie QCM avec un extrait Spotify contient l’avertissement `Cette partie contient des morceaux Spotify, mais Spotify n’est pas connecté.`
- [ ] **Step 2 : lancer** — `node --test server.test.js` → FAIL.
- [ ] **Step 3 : `server.js`** — `hasSpotify` compte aussi `questions[].extract` ; `prefetchCover()` ne fait rien si `state.song?.kind === 'qcm'` (pas de révélation de pochette en QCM).
- [ ] **Step 4 : `public/host.html`**
  - `QCM_NEXT` : `idle` libellé « Afficher la page de la question » quand `q.hasExtract`, sinon inchangé ; `intro: { action: 'play-extract', label: 'Lancer l’extrait' }` ; `listening: { action: null, label: 'Extrait en cours…' }` (Entrée sans effet). `STEP_LABEL` : `intro: 'Page de la question (sans texte)'`, `listening: 'Extrait en cours'`.
  - Dans `#qcmPanel`, un bloc `#qExtract` visible quand `q.hasExtract` et l’étape n’est pas `idle` : source (📁 / ♪ Spotify), état (réutiliser `songStatusLabel`), temps du passage, erreur de lecture, témoin Spotify (comme `renderSpotify`, quand `sectionHasSpotify()`), boutons **Rejouer l’extrait** `R` (`host:replay`, désactivé avant `play-extract`) et **Afficher la question** (`host:qcm` `skip-extract`, visible seulement à l’étape `listening`), et « Le son sort ici » quand `!soundMine`.
  - `renderSongProgress()` écrit dans `#qExtract` quand `state.qcm` (aujourd’hui il sort si `#songPanel` est caché).
  - Clavier, branche QCM : `r` (sans Cmd/Ctrl/Alt) → `host:replay` si `state.song`.
  - Le lecteur (`syncSound`, `tick`, `muteNow`, `host:ended`) n’est pas modifié : vérifier qu’il joue l’extrait via `curSong()`.
- [ ] **Step 5 : vérifier** — `npm test` → PASS. Puis vérification manuelle : `HOST_KEY=k npm start`, partie QCM avec un extrait fichier ; Régie `/host?key=k` : Entrée (page), Entrée (extrait joue, Entrée de nouveau sans effet), fin → « Question affichée », R rejoue pendant le compte à rebours, Z après « Lancer l’extrait » coupe le son, « Afficher la question » coupe et avance.
- [ ] **Step 6 : commit** — `git commit -m "feat: play qcm extracts from the host page"`

---

### Tâche 5 : Grand écran et Buzzer

**Files :** Modify `public/screen.html`, `public/player.html`

- [ ] **Step 1 : `public/screen.html`** — `renderPlay` : `inQuestion` vrai dès `intro`. `renderQuestion` sans `q.question` (étapes `intro`/`listening`) : titre « Question N/M », nom de la manche, ni texte, ni image, ni propositions ; à `listening` (`q.listening`), un indicateur « ♪ Écoutez… » dans le style du bandeau de morceau, animé seulement hors `prefers-reduced-motion`.
- [ ] **Step 2 : `public/player.html`** — `renderQcm` : `intro` → « Regardez le grand écran… » ; `listening` → « ♪ Écoutez l’extrait… ». Boutons A–D désactivés comme aux autres étapes hors compte à rebours.
- [ ] **Step 3 : vérifier** — `npm test` → PASS ; manuel : Grand écran `/screen` et un Buzzer `/` suivent une question avec extrait de `intro` à `revealed`, sans afficher le texte avant la fin de l’extrait.
- [ ] **Step 4 : commit** — `git commit -m "feat: show qcm extract steps on screen and buzzer"`

---

### Tâche 6 : Création (`public/creation.html`)

**Files :** Modify `public/creation.html`

**Interfaces :**
- Consumes : forme `question.extract` (Tâche 1) ; routes existantes `/api/musiques`, `/api/spotify/*`.

- [ ] **Step 1 : un seul éditeur de passage pour deux usages** — introduire `editedClip()` qui renvoie `sections[selSection].songs[selSong]` (manche buzzer) ou `sections[selSection].questions[selQuestion].extract` (manche QCM), et `setClip(clip)` symétrique ; remplacer les accès directs dans les handlers du lecteur, de la barre de temps, d’upload et de Spotify. Les blocs `+ Fichier`/`+ Spotify`/`#spotifyPanel` et `#songEditor` sont déplacés dans le DOM (`append`) vers un emplacement « Extrait (facultatif) » de `#questionEditor` quand la manche est QCM, et remis à leur place sinon (pas de duplication du markup).
- [ ] **Step 2 : comportement en QCM** — titre « Extrait (facultatif) » ; une seule source par question (ajouter remplace l’extrait existant, sans `confirm` si vide) ; champ « Réponse affichée en Régie » caché ; « Supprimer le morceau » devient « Retirer l’extrait » (supprime la clé `extract`) ; `defaultEnd` et durée comme pour un morceau ; `questionTodo(q)` ajoute les manques de l’extrait (mêmes libellés que `songTodo` sans la réponse).
- [ ] **Step 3 : liste et aperçu** — `♪` devant une question qui a un extrait dans `#questions` ; l’aperçu Grand écran d’une question avec extrait montre « ♪ Écoutez… » au-dessus de la question.
- [ ] **Step 4 : vérifier** — `npm test` → PASS ; manuel : `/creation?key=k`, créer une manche QCM, ajouter un extrait fichier et un extrait Spotify à deux questions, régler Début/Fin, Écouter le passage, enregistrer, rouvrir : extraits conservés ; le CSV dans `parties/` a `musique;debut;fin` remplis sur ces lignes ; une manche buzzer avec morceaux s’édite comme avant.
- [ ] **Step 5 : commit** — `git commit -m "feat: edit qcm extracts on the creation page"`

---

### Tâche 7 : documentation

**Files :** Modify `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-28-qcm-extrait-design.md`, `docs/backlog.md`

- [ ] **Step 1 : README** — section « Manches QCM » : question avec extrait (Entrée ×2, question automatique à la fin, R, « Afficher la question », que faire si la lecture échoue) ; section préparation : colonnes `musique;debut;fin` sur une ligne `qcm`.
- [ ] **Step 2 : `CLAUDE.md`** — vocabulaire : ligne **Extrait** (« Passage musical d’une question QCM, joué avant la question », code `question.extract`) ; mention des étapes `intro`/`listening`. Proposer le diff à l’animateur avant de commiter (§6 de `CLAUDE.md` : décisions validées).
- [ ] **Step 3 : spec** — `Statut : construit le <date>`.
- [ ] **Step 4 : backlog** — dans `docs/backlog.md`, l’item « Extrait musical ou vidéo dans une question QCM » ne garde que la vidéo YouTube ; ajouter la conception à « Livré ». Le fichier contient déjà des modifications locales de l’animateur (mise à jour du backlog et item « Réponse libre ») : demander avant de le commiter.
- [ ] **Step 5 : commit** — `git commit -m "docs: describe qcm extracts"` (sans `docs/backlog.md` tant que l’animateur n’a pas dit oui).
