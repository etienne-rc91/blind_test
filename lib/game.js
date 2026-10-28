// État du jeu et règles. Aucune dépendance réseau : server.js branche les sockets dessus.
const { rankTeams } = require('./ranking');
const { isSong, isExtract } = require('./songs');

const MAX_NAME = 24;
const MAX_UNDO = 50;
const STAGES = ['setup', 'play', 'summary', 'final'];
const IP_RE = /^[\d.]+$|^localhost$/;
const DEFAULT_SECTIONS = () => [{ name: 'Manche 1', type: 'buzzer', questions: [], songs: [] }];
const sum = (list) => list.reduce((a, b) => a + b, 0);
const LETTERS = ['A', 'B', 'C', 'D'];
const isQuestion = (q) => q && typeof q.text === 'string' && q.choices && LETTERS.every((l) => typeof q.choices[l] === 'string') && LETTERS.includes(q.answer)
  && (q.extract === undefined || isExtract(q.extract));   // extrait facultatif
// Morceaux d’une manche buzzer (absents = manche libre, comme dans les anciens scores.json). Jamais modifiés sur place.
const songsOf = (sec) => (sec && sec.type === 'buzzer' && Array.isArray(sec.songs) ? sec.songs : []);
const isSection = (x) => x && typeof x.name === 'string' && x.name !== '' && ['buzzer', 'qcm'].includes(x.type)
  && Array.isArray(x.questions) && (x.type === 'buzzer' || x.questions.every(isQuestion))
  && (x.type !== 'buzzer' || x.songs === undefined || (Array.isArray(x.songs) && x.songs.every(isSong)));
const DEFAULT_COUNTDOWN = 20;
const RUNNING = ['countdown', 'locked'];   // étapes où des réponses ont pu être reçues
// Étapes d’une question avec extrait où l’extrait a déjà été lancé : R peut le rejouer.
const AFTER_LAUNCH = ['listening', 'question', 'choices', 'countdown', 'locked', 'revealed'];
// Étapes où le Grand écran ne montre ni texte ni image de la question.
const HIDDEN = ['idle', 'intro', 'listening'];

const teamIdOf = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const cleanName = (name) => String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME);

// Les minuteurs et l'horloge sont injectables pour les tests. onTimer est appelé quand le compte à rebours expire.
// coverOf(song) donne l’adresse de la pochette d’un morceau Spotify (fournie par le serveur), ou null.
function createGame({ timers = { set: setTimeout, clear: clearTimeout }, now = () => Date.now(), onTimer = () => {}, coverOf = () => null } = {}) {
  /** @type {Map<string, {id:string,name:string,scores:number[],sockets:Set<string>}>} */
  const teams = new Map();
  // Manches de la partie et manche en cours. Les points vont dans teams[].scores[game.currentSection].
  const game = { sections: DEFAULT_SECTIONS(), currentSection: 0, countdownSec: DEFAULT_COUNTDOWN, partieName: null };
  // Avancement de chaque manche QCM : question en cours et si elle a déjà été révélée (sauvegardé).
  const freshProgress = () => game.sections.map(() => ({ index: 0, revealed: false }));
  let progress = freshProgress();
  // Question QCM en cours (manche en cours seulement). Les réponses et le minuteur ne sont ni annulables ni sauvegardés.
  const qcm = { step: 'idle', deadline: 0, timer: null, answers: new Map() };   // step : idle | intro | listening | question | choices | countdown | locked | revealed
  const currentSection = () => game.sections[game.currentSection];
  const isQcm = () => currentSection().type === 'qcm';
  const currentQuestion = () => (isQcm() ? currentSection().questions[progress[game.currentSection].index] : undefined);
  function stopTimer() {
    if (qcm.timer) timers.clear(qcm.timer);
    qcm.timer = null;
  }
  // Remet la question de la manche en cours dans l'état où elle reprend (après changement de manche ou chargement).
  function resumeSection() {
    stopTimer();
    round.openedInSection = false;
    qcm.answers.clear();
    qcm.step = isQcm() && progress[game.currentSection].revealed ? 'revealed' : 'idle';
  }
  const fitScores = (scores = []) => game.sections.map((_, i) => (Number.isInteger(scores[i]) ? scores[i] : 0));
  const addPoints = (t, delta) => { t.scores[game.currentSection] += delta; };
  const round = {
    phase: 'closed',          // closed | open | buzzed
    buzzes: [],               // [{teamId, at}] — at = performance.now() à la réception
    excluded: new Set(),      // équipes ayant donné une mauvaise réponse sur ce morceau
    number: 0,
    openedInSection: false,   // buzzers déjà ouverts dans la manche en cours (pour la modification en cours de partie)
  };
  // Morceau en cours d’une manche avec morceaux, ou extrait de la question QCM en cours (index = celui de la question)
  // (manche en cours seulement ; ni sauvegardé, ni gardé au changement de manche).
  // La Régie joue le son et applique `audible` ; elle ne remonte que la fin du passage (songEnded).
  // seq augmente à chaque passage lancé depuis Début (Espace, R) et ne recule jamais, même avec Z :
  // la Régie sait ainsi qu’il faut repartir de Début, et une fin de passage arrivée en retard est ignorée.
  const song = { index: null, concluded: false, outcome: null, audio: 'stopped', seq: 0 };   // audio : stopped | playing | paused | ended
  // Dernier passage arrivé à Fin (hors annulation) : manche, morceau et seq, car seq seul ne dit pas de quel morceau il s’agit
  // après plusieurs Z. Ni annulable ni sauvegardé.
  let ended = null;         // { section, index, seq }
  function resetSong() {
    Object.assign(song, { index: null, concluded: false, outcome: null, audio: 'stopped' });
  }
  const currentSongs = () => songsOf(currentSection());
  const hasSongs = () => currentSongs().length > 0;
  const currentSong = () => (song.index === null ? undefined : currentSongs()[song.index]);
  const inSong = () => hasSongs() && song.index !== null && !song.concluded;
  const screen = { stage: 'setup', joinIp: null };   // ce qu'affiche le Grand écran
  /** @type {Map<string, string>} socketId → teamId */
  const socketTeam = new Map();
  // La pause au buzz découle de la phase : rien n’est ajouté au handler buzz. En QCM, personne ne buzze
  // (une phase « buzzed » restée d’avant un import ne doit pas couper l’extrait).
  const audible = () => song.audio === 'playing' && (isQcm() || round.phase !== 'buzzed');
  // B ou F : le morceau est conclu, la musique s’arrête et la réponse est dévoilée.
  function concludeSong(outcome) {
    if (inSong()) Object.assign(song, { concluded: true, outcome, audio: 'stopped' });
  }

  // ---------- Annuler ----------
  // Pile des états avant chaque action de l'animateur.
  const history = [];
  const snapshot = () => ({
    teams: [...teams.values()].map(({ id, name, scores }) => ({ id, name, scores: [...scores] })),
    sections: game.sections,  // jamais modifiées sur place : on peut garder la référence
    currentSection: game.currentSection,
    countdownSec: game.countdownSec,
    progress: progress.map((p) => ({ ...p })),
    qcmStep: qcm.step,
    round: { phase: round.phase, buzzes: round.buzzes.map((b) => ({ ...b })), excluded: [...round.excluded], number: round.number, openedInSection: round.openedInSection },
    song: { index: song.index, concluded: song.concluded, outcome: song.outcome, audio: song.audio },   // sans seq
    stage: screen.stage,      // joinIp n'est pas annulable : la Régie le règle seule à la connexion
  });
  function restore(s) {
    // Les équipes arrivées depuis sont conservées. Une équipe retirée revient, sans téléphone connecté.
    for (const t of s.teams) {
      const cur = teams.get(t.id);
      if (cur) cur.scores = [...t.scores];
      else teams.set(t.id, { ...t, scores: [...t.scores], sockets: new Set() });
    }
    game.sections = s.sections;
    game.currentSection = s.currentSection;
    game.countdownSec = s.countdownSec;
    progress = s.progress.map((p) => ({ ...p }));
    restoreQcmStep(s.qcmStep);
    // Une équipe arrivée après l'instantané garde ses points, ajustés au nombre de manches restauré.
    for (const t of teams.values()) t.scores = fitScores(t.scores);
    round.phase = s.round.phase;
    round.buzzes = s.round.buzzes.map((b) => ({ ...b }));
    round.excluded = new Set(s.round.excluded);
    round.number = s.round.number;
    round.openedInSection = s.round.openedInSection;
    Object.assign(song, s.song);
    screen.stage = s.stage;
  }

  // Annuler ne relance jamais un compte à rebours et ne vide les réponses que si on revient avant « Lancer ».
  function restoreQcmStep(target) {
    if (RUNNING.includes(qcm.step) && RUNNING.includes(target)) return;   // action sans rapport : on garde l'étape réelle
    if (RUNNING.includes(qcm.step) && !RUNNING.includes(target) && target !== 'revealed') { stopTimer(); qcm.answers.clear(); }
    if (target === 'countdown') {                                          // pas de minuteur à reprendre : on revient avant « Lancer »
      qcm.answers.clear();
      qcm.step = 'choices';
      return;
    }
    qcm.step = target;
  }

  function openRound({ newSong }) {
    if (newSong) { round.excluded.clear(); round.number += 1; }
    round.buzzes = [];
    round.phase = 'open';
    round.openedInSection = true;
  }

  // ---------- Joueurs ----------
  function join(socketId, rawName) {
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'Donnez un nom d’équipe.' };
    const id = teamIdOf(name);
    const prev = socketTeam.get(socketId);
    if (prev && prev !== id) teams.get(prev)?.sockets.delete(socketId);
    if (!teams.has(id)) teams.set(id, { id, name, scores: fitScores(), sockets: new Set() });
    teams.get(id).sockets.add(socketId);
    socketTeam.set(socketId, id);
    return { ok: true, teamId: id, name: teams.get(id).name };
  }

  function leave(socketId) {
    const id = socketTeam.get(socketId);
    if (id) teams.get(id)?.sockets.delete(socketId);
    socketTeam.delete(socketId);
  }

  // `at` est pris par l'appelant au tout début du handler : c'est lui qui fait l'arbitrage.
  function buzz(socketId, at) {
    const myTeam = socketTeam.get(socketId);
    if (!myTeam || !teams.has(myTeam)) return { ok: false, reason: 'not-joined' };
    if (round.phase === 'closed' || isQcm()) return { ok: false, reason: 'closed' };
    if (round.excluded.has(myTeam)) return { ok: false, reason: 'excluded' };
    if (round.buzzes.some((b) => b.teamId === myTeam)) return { ok: false, reason: 'already' };
    round.buzzes.push({ teamId: myTeam, at });
    const rank = round.buzzes.length;
    if (rank === 1) round.phase = 'buzzed';
    return { ok: true, rank };
  }

  // Réponse QCM : acceptée seulement pendant le compte à rebours ; la dernière réponse de l'équipe compte.
  function answer(socketId, letter) {
    const myTeam = socketTeam.get(socketId);
    if (!myTeam || !teams.has(myTeam)) return { ok: false, reason: 'not-joined' };
    if (!isQcm() || qcm.step !== 'countdown') return { ok: false, reason: 'closed' };
    if (!LETTERS.includes(letter)) return { ok: false, reason: 'invalid' };
    qcm.answers.set(myTeam, letter);
    return { ok: true };
  }

  function expire() {
    qcm.timer = null;
    if (qcm.step !== 'countdown') return;
    qcm.step = 'locked';
    onTimer();
  }

  // Déroulé d'une question : chaque action n'est valable que depuis une étape précise (un double appui est sans effet).
  const qcmActions = {
    // Une question avec extrait passe d’abord par sa page (intro) puis l’écoute (listening).
    'show-question': () => { if (qcm.step === 'idle' && currentQuestion()) qcm.step = currentQuestion().extract ? 'intro' : 'question'; },
    'play-extract': () => {
      if (qcm.step !== 'intro' || !currentQuestion()?.extract) return;
      Object.assign(song, { index: progress[game.currentSection].index, concluded: false, outcome: null, audio: 'playing' });
      song.seq += 1;
      qcm.step = 'listening';
    },
    // « Afficher la question » pendant l’écoute : coupe l’extrait (trop long, ou lecture impossible).
    'skip-extract': () => {
      if (qcm.step !== 'listening') return;
      song.audio = 'stopped';
      qcm.step = 'question';
    },
    'show-choices': () => { if (qcm.step === 'question') qcm.step = 'choices'; },
    start: () => {
      if (qcm.step !== 'choices') return;
      qcm.answers.clear();
      qcm.step = 'countdown';
      qcm.deadline = now() + game.countdownSec * 1000;
      qcm.timer = timers.set(expire, game.countdownSec * 1000);
    },
    reveal: () => {
      if (qcm.step !== 'locked' || !currentQuestion()) return;   // question disparue (correction + annulation) : rien à révéler
      const good = currentQuestion().answer;
      for (const [teamId, letter] of qcm.answers) if (letter === good && teams.has(teamId)) addPoints(teams.get(teamId), 1);
      progress[game.currentSection].revealed = true;
      qcm.step = 'revealed';
    },
    next: () => {
      if (qcm.step !== 'revealed') return;
      progress[game.currentSection] = { index: progress[game.currentSection].index + 1, revealed: false };
      qcm.step = 'idle';
      resetSong();                                                        // un extrait rejoué s’arrête
    },
  };
  const buzzerOnly = (fn) => (payload) => (isQcm() ? undefined : fn(payload));

  // Espace dans une manche avec morceaux : sans effet tant que le morceau en cours n’est pas conclu (un double appui
  // ne grille pas de morceau), sauf pour reprendre une musique mise en pause par un Z.
  function openSong() {
    const p = progress[game.currentSection];
    if (song.index === null || song.concluded) {
      if (p.index >= currentSongs().length) return;                       // manche terminée
      Object.assign(song, { index: p.index, concluded: false, outcome: null, audio: 'playing' });
      song.seq += 1;
      p.index += 1;
      openRound({ newSong: true });
    } else if (song.audio === 'paused' && round.phase !== 'buzzed') {
      song.audio = 'playing';
    }
  }

  // ---------- Animateur ----------
  const actions = {
    open: buzzerOnly(() => (hasSongs() ? openSong() : openRound({ newSong: true }))),   // nouveau morceau
    close: buzzerOnly(() => {
      round.phase = 'closed';
      concludeSong('closed');
    }),
    correct: buzzerOnly(() => {
      if (round.phase !== 'buzzed') return;                               // évite un double point (touche B pressée deux fois)
      const first = round.buzzes[0];
      if (first && teams.has(first.teamId)) addPoints(teams.get(first.teamId), 1);
      round.phase = 'closed';
      concludeSong('found');
    }),
    // Rejouer l’extrait depuis Début (aussi après B ou F, pour faire réentendre la réponse). Jamais pendant un buzz non jugé.
    // En QCM : à toute étape une fois l’extrait lancé, sans rien changer d’autre (étape, réponses, points).
    replay: () => {
      if (isQcm()) {
        if (!currentQuestion()?.extract || song.index !== progress[game.currentSection].index || !AFTER_LAUNCH.includes(qcm.step)) return;
      } else if (!hasSongs() || song.index === null || round.phase === 'buzzed') return;
      song.audio = 'playing';
      song.seq += 1;
    },
    wrong: buzzerOnly(() => {                                             // exclut et relance pour les autres
      if (round.phase !== 'buzzed') return;
      const first = round.buzzes[0];
      if (first) round.excluded.add(first.teamId);
      openRound({ newSong: false });
    }),
    unexclude: ({ teamId } = {}) => { round.excluded.delete(teamId); },  // rend le buzzer à une équipe exclue
    score: ({ teamId, delta } = {}) => {
      const t = teams.get(teamId);
      if (t && Number.isInteger(delta) && Math.abs(delta) <= 10) addPoints(t, delta);
    },
    kick: ({ teamId } = {}) => {
      const t = teams.get(teamId);
      if (!t) return;
      const kickedSockets = [...t.sockets];
      for (const sid of kickedSockets) socketTeam.delete(sid);
      teams.delete(teamId);
      round.buzzes = round.buzzes.filter((b) => b.teamId !== teamId);
      round.excluded.delete(teamId);
      qcm.answers.delete(teamId);
      if (!round.buzzes.length && round.phase === 'buzzed') round.phase = 'open';
      return { kickedSockets };
    },
    'reset-scores': () => {
      for (const t of teams.values()) t.scores = t.scores.map(() => 0);
      game.currentSection = 0;
      progress = freshProgress();
      resumeSection();
      resetSong();
    },
    // Les manches arrivent déjà validées par lib/game-file.js.
    import: ({ sections } = {}) => {
      if (!Array.isArray(sections) || !sections.length || !sections.every(isSection)) return { error: 'Liste de manches invalide.' };
      if ([...teams.values()].some((t) => t.scores.some((x) => x !== 0))) {
        return { error: 'Des points ont déjà été donnés. Remettez d’abord les scores à zéro.' };
      }
      game.sections = sections;
      game.currentSection = 0;
      progress = freshProgress();
      resumeSection();
      resetSong();
      for (const t of teams.values()) t.scores = fitScores();
    },
    section: ({ index } = {}) => {
      if (!Number.isInteger(index) || index < 0 || index >= game.sections.length || index === game.currentSection) return;
      game.currentSection = index;
      round.phase = 'closed';
      round.buzzes = [];
      round.excluded.clear();
      resumeSection();
      resetSong();
    },
    qcm: ({ action } = {}) => { if (isQcm() && Object.hasOwn(qcmActions, action)) qcmActions[action](); },
    countdown: ({ seconds } = {}) => {
      if (Number.isInteger(seconds)) game.countdownSec = Math.min(120, Math.max(5, seconds));
    },
    stage: ({ stage } = {}) => {
      if (!STAGES.includes(stage)) return;
      screen.stage = stage;
      // Quitter l’étape Jeu coupe l’extrait QCM (en manche buzzer, la musique est gérée par Espace, B, F).
      if (isQcm() && stage !== 'play' && song.audio === 'playing') song.audio = 'stopped';
    },
    'join-ip': ({ ip } = {}) => { if (typeof ip === 'string' && IP_RE.test(ip)) screen.joinIp = ip; },
  };

  // Chaque action qui change quelque chose est mémorisée pour pouvoir être annulée.
  function host(action, payload) {
    const fn = actions[action];
    if (!fn) return { changed: false };
    const before = snapshot();
    const seqBefore = song.seq;
    const extra = fn(payload || {}) || {};
    // R pendant la lecture ne change que seq (absent de l’instantané) : c’est pourtant un changement à diffuser.
    const changed = JSON.stringify(before) !== JSON.stringify(snapshot()) || song.seq !== seqBefore;
    if (changed) {
      history.push(before);
      if (history.length > MAX_UNDO) history.shift();
    }
    return { changed, ...extra };
  }

  // Un Z ne relance jamais la musique : si elle devient audible alors qu’elle ne l’était pas, elle reste muette
  // (terminée si le dernier passage est arrivé à Fin, sinon en pause, reprise avec Espace ou M).
  function undo() {
    if (!history.length) return false;
    const wasAudible = audible();
    restore(history.pop());
    if (!wasAudible && audible()) {
      const same = ended && ended.section === game.currentSection && ended.index === song.index && ended.seq === song.seq;
      song.audio = same ? 'ended' : 'paused';
    }
    return true;
  }

  // Fin du passage signalée par la Régie : pas une action animateur, donc pas annulable. La fin d’un passage précédent
  // (arrivée après R ou Espace) est ignorée. Les buzzers restent ouverts : l’animateur conclut avec B ou F.
  // En QCM, la fin de l’extrait pendant l’écoute affiche la question ; une fin après (extrait rejoué) n’avance rien.
  function songEnded(seq) {
    if (song.audio !== 'playing' || seq !== song.seq) return false;
    song.audio = 'ended';
    ended = { section: game.currentSection, index: song.index, seq };
    if (isQcm() && qcm.step === 'listening') qcm.step = 'question';
    return true;
  }

  // ---------- Parties ----------
  // Nouvelle soirée avec une partie : on repart de zéro (équipes comprises) et l'annulation repart vide.
  function newEvening({ name, sections }) {
    stopTimer();
    const kickedSockets = [...socketTeam.keys()];
    teams.clear();
    socketTeam.clear();
    round.phase = 'closed';
    round.buzzes = [];
    round.excluded.clear();
    round.number = 0;
    screen.stage = 'setup';
    game.sections = Array.isArray(sections) && sections.length ? sections : DEFAULT_SECTIONS();
    game.currentSection = 0;
    game.partieName = name ?? null;
    progress = freshProgress();
    resumeSection();
    resetSong();
    history.length = 0;
    return { kickedSockets };
  }

  // Correction de la partie en cours (déjà vérifiée par lib/live-edit.js) : scores et avancement gardés.
  // Les instantanés d'annulation reçoivent aussi la nouvelle version : un Z ne ramène jamais d'anciennes questions.
  function replaceSections(sections) {
    if (!Array.isArray(sections) || sections.length < game.sections.length) return false;   // jamais de manche perdue
    const extend = (list) => [...list, ...sections.slice(list.length).map(() => ({ index: 0, revealed: false }))];
    game.sections = sections;
    progress = extend(progress);
    for (const t of teams.values()) t.scores = fitScores(t.scores);
    for (const snap of history) {
      snap.sections = sections;
      snap.progress = extend(snap.progress);
    }
    return true;
  }

  const getLive = () => ({
    partieName: game.partieName,
    sections: game.sections,
    progress: progress.map((p) => ({ ...p })),
    currentSection: game.currentSection,
    qcmStep: qcm.step,
    roundOpenedInSection: round.openedInSection,
    currentSectionScored: [...teams.values()].some((t) => t.scores[game.currentSection] !== 0),
  });
  const setPartieName = (name) => { game.partieName = name ?? null; };

  // ---------- État diffusé ----------
  // Ce que chaque rôle voit de la question QCM. Les secrets (bonne réponse, choix des autres) restent côté Régie.
  function qcmState(role, teamId) {
    if (!isQcm()) return null;
    const sec = currentSection();
    const { index } = progress[game.currentSection];
    const q = currentQuestion();
    // Les réponses gardées après « Question suivante » (pour pouvoir l'annuler) ne concernent plus la question affichée.
    const live = RUNNING.includes(qcm.step) || qcm.step === 'revealed';
    const out = {
      step: qcm.step,
      index,
      total: sec.questions.length,
      answeredCount: live ? qcm.answers.size : 0,
      teamCount: teams.size,
    };
    if (qcm.step === 'countdown') out.remainingMs = Math.max(0, qcm.deadline - now());
    // Le Buzzer n'affiche que les lettres : il ne reçoit ni la question ni le nom de l'image (qui pourrait trahir la réponse).
    // Le Grand écran ne montre la question qu’après l’extrait ; la Régie la voit dès la page de la question.
    if (q && qcm.step !== 'idle' && role !== 'player' && (role !== 'screen' || !HIDDEN.includes(qcm.step))) {
      out.question = { text: q.text, image: q.image };
      if (!['intro', 'listening', 'question'].includes(qcm.step)) out.question.choices = { ...q.choices };
    }
    if (role === 'screen') out.listening = qcm.step === 'listening';
    if (role === 'host') out.hasExtract = Boolean(q && q.extract);
    const revealed = qcm.step === 'revealed';
    if (role === 'host') {
      if (q) out.answer = q.answer;
      out.answers = live ? Object.fromEntries(qcm.answers) : {};
    } else if (role === 'player') {
      out.myAnswer = RUNNING.includes(qcm.step) || revealed ? qcm.answers.get(teamId) ?? null : null;
    }
    if (role !== 'host' && revealed && q) {
      out.answer = q.answer;
      if (role === 'screen') {
        out.counts = { A: 0, B: 0, C: 0, D: 0 };
        for (const l of qcm.answers.values()) out.counts[l] += 1;
      }
    }
    return out;
  }

  // Ce que chaque rôle voit du morceau. Le Buzzer ne reçoit rien ; le Grand écran ne reçoit la réponse (et la pochette
  // d’un morceau Spotify) qu’une fois le morceau conclu, et jamais le nom du fichier ni l’identifiant Spotify.
  function songState(role) {
    if (isQcm()) return qcmSongState(role);
    if (!hasSongs() || role === 'player') return null;
    const songs = currentSongs();
    if (role === 'host') {
      return {
        index: song.index,
        total: songs.length,
        played: progress[game.currentSection].index,
        concluded: song.concluded,
        outcome: song.outcome,
        audio: song.audio,
        seq: song.seq,
        audible: audible(),
        songs: songs.map((x) => ({ ...x })),
      };
    }
    const cur = currentSong();
    return {
      number: song.index === null ? null : song.index + 1,
      total: songs.length,
      playing: song.index !== null && !song.concluded,
      reveal: song.concluded && cur ? { answer: cur.answer, cover: cur.source === 'spotify' ? coverOf(cur) ?? null : null } : null,
    };
  }

  // Extraits de la manche QCM, indexés par question (null = question sans extrait) : seule la Régie les reçoit,
  // le nom du fichier ou l’identifiant Spotify pouvant trahir la réponse.
  function qcmSongState(role) {
    const { questions } = currentSection();
    if (role !== 'host' || !questions.some((q) => q.extract)) return null;
    return {
      kind: 'qcm',
      index: song.index,
      total: questions.length,
      played: progress[game.currentSection].index,
      concluded: false,
      outcome: null,
      audio: song.audio,
      seq: song.seq,
      audible: audible(),
      songs: questions.map((q) => (q.extract ? { ...q.extract } : null)),
    };
  }

  function publicState({ role = 'player', teamId = null } = {}) {
    const t0 = round.buzzes.length ? round.buzzes[0].at : 0;
    return {
      phase: round.phase,
      round: round.number,
      buzzes: round.buzzes.map((b, i) => ({
        teamId: b.teamId,
        name: teams.get(b.teamId)?.name ?? '?',
        rank: i + 1,
        deltaMs: Math.round((b.at - t0) * 10) / 10,
      })),
      excluded: [...round.excluded],
      // Identifie le premier buzz (son horodatage serveur) : les pages s’en servent pour ne signaler qu’une fois chaque buzz
      buzzKey: round.buzzes.length ? String(round.buzzes[0].at) : null,
      canUndo: history.length > 0,
      stage: screen.stage,
      joinIp: screen.joinIp,
      sections: game.sections.map((x) => ({
        name: x.name,
        type: x.type,
        questionCount: x.questions.length,
        songCount: songsOf(x).length,
        spotifyCount: [...songsOf(x), ...(x.type === 'qcm' ? x.questions.map((q) => q.extract).filter(Boolean) : [])]
          .filter((m) => m.source === 'spotify').length,
      })),
      currentSection: game.currentSection,
      countdownSec: game.countdownSec,
      partieName: game.partieName,
      qcm: qcmState(role, teamId),
      song: songState(role),
      teams: rankTeams([...teams.values()]
        .map((t) => ({ id: t.id, name: t.name, score: sum(t.scores), scores: [...t.scores], online: t.sockets.size }))),
    };
  }

  // ---------- Sauvegarde ----------
  // Les équipes et leurs scores survivent à un redémarrage. L'état du morceau en cours, lui, repart fermé.
  // progress.index compte les morceaux lancés : un morceau interrompu (non conclu) est sauvegardé comme non joué,
  // pour qu’Espace le rejoue depuis Début après le redémarrage. La partie en cours n’est pas modifiée.
  function savedProgress() {
    const out = progress.map((p) => ({ ...p }));
    if (inSong()) out[game.currentSection].index = song.index;
    return out;
  }
  function toSaved() {
    return {
      version: 2,
      partieName: game.partieName,
      stage: screen.stage,
      joinIp: screen.joinIp,
      round: round.number,
      sections: game.sections,
      currentSection: game.currentSection,
      countdownSec: game.countdownSec,
      progress: savedProgress(),
      teams: [...teams.values()].map(({ id, name, scores }) => ({ id, name, scores })),
    };
  }

  function load(data) {
    // Manches : toutes valides ou aucune (on garde alors « Manche 1 »).
    if (data && Array.isArray(data.sections) && data.sections.length && data.sections.every(isSection)) {
      game.sections = data.sections;
      if (Number.isInteger(data.currentSection) && data.currentSection >= 0 && data.currentSection < data.sections.length) {
        game.currentSection = data.currentSection;
      }
      progress = freshProgress();
      if (Array.isArray(data.progress)) {
        data.progress.forEach((p, i) => {
          const sec = game.sections[i];
          // QCM : questions posées ; manche buzzer : morceaux lancés.
          const len = sec && (sec.type === 'qcm' ? sec.questions.length : songsOf(sec).length);
          if (sec && p && Number.isInteger(p.index) && p.index >= 0 && p.index <= len) {
            progress[i] = { index: p.index, revealed: sec.type === 'qcm' && p.revealed === true && p.index < len };
          }
        });
      }
    }
    if (data && typeof data.partieName === 'string') game.partieName = data.partieName;
    if (data && Number.isInteger(data.countdownSec)) game.countdownSec = Math.min(120, Math.max(5, data.countdownSec));
    resumeSection();
    resetSong();                                                // le morceau en cours repart fermé
    const list = data && Array.isArray(data.teams) ? data.teams : [];
    for (const t of list) {
      if (!t || typeof t.id !== 'string' || typeof t.name !== 'string') continue;
      // Format v1 : un seul score, rangé dans la première manche.
      const scores = Array.isArray(t.scores) ? t.scores : Number.isInteger(t.score) ? [t.score] : null;
      if (scores) teams.set(t.id, { id: t.id, name: t.name, scores: fitScores(scores), sockets: new Set() });
    }
    if (data && Number.isInteger(data.round)) round.number = data.round;
    if (data && STAGES.includes(data.stage)) screen.stage = data.stage;
    if (data && typeof data.joinIp === 'string' && IP_RE.test(data.joinIp)) screen.joinIp = data.joinIp;
    return { teams: teams.size };
  }

  return { join, leave, buzz, answer, host, undo, songEnded, publicState, toSaved, load, newEvening, replaceSections, getLive, setPartieName };
}

module.exports = { createGame, MAX_NAME };
