// État du jeu et règles. Aucune dépendance réseau : server.js branche les sockets dessus.
const MAX_NAME = 24;
const MAX_UNDO = 50;

const teamIdOf = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const cleanName = (name) => String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME);

function createGame() {
  /** @type {Map<string, {id:string,name:string,score:number,sockets:Set<string>}>} */
  const teams = new Map();
  const round = {
    phase: 'closed',          // closed | open | buzzed
    buzzes: [],               // [{teamId, at}] — at = performance.now() à la réception
    excluded: new Set(),      // équipes ayant donné une mauvaise réponse sur ce morceau
    number: 0,
  };
  /** @type {Map<string, string>} socketId → teamId */
  const socketTeam = new Map();

  // ---------- Annuler ----------
  // Pile des états avant chaque action de l'animateur.
  const history = [];
  const snapshot = () => ({
    teams: [...teams.values()].map(({ id, name, score }) => ({ id, name, score })),
    round: { phase: round.phase, buzzes: round.buzzes.map((b) => ({ ...b })), excluded: [...round.excluded], number: round.number },
  });
  function restore(s) {
    // Les équipes arrivées depuis sont conservées. Une équipe retirée revient, sans téléphone connecté.
    for (const t of s.teams) {
      const cur = teams.get(t.id);
      if (cur) cur.score = t.score;
      else teams.set(t.id, { ...t, sockets: new Set() });
    }
    round.phase = s.round.phase;
    round.buzzes = s.round.buzzes.map((b) => ({ ...b }));
    round.excluded = new Set(s.round.excluded);
    round.number = s.round.number;
  }

  function openRound({ newSong }) {
    if (newSong) { round.excluded.clear(); round.number += 1; }
    round.buzzes = [];
    round.phase = 'open';
  }

  // ---------- Joueurs ----------
  function join(socketId, rawName) {
    const name = cleanName(rawName);
    if (!name) return { ok: false, error: 'Donnez un nom d’équipe.' };
    const id = teamIdOf(name);
    const prev = socketTeam.get(socketId);
    if (prev && prev !== id) teams.get(prev)?.sockets.delete(socketId);
    if (!teams.has(id)) teams.set(id, { id, name, score: 0, sockets: new Set() });
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
    if (round.phase === 'closed') return { ok: false, reason: 'closed' };
    if (round.excluded.has(myTeam)) return { ok: false, reason: 'excluded' };
    if (round.buzzes.some((b) => b.teamId === myTeam)) return { ok: false, reason: 'already' };
    round.buzzes.push({ teamId: myTeam, at });
    const rank = round.buzzes.length;
    if (rank === 1) round.phase = 'buzzed';
    return { ok: true, rank };
  }

  // ---------- Animateur ----------
  const actions = {
    open: () => openRound({ newSong: true }),                             // nouveau morceau
    close: () => { round.phase = 'closed'; },
    correct: () => {
      if (round.phase !== 'buzzed') return;                               // évite un double point (touche B pressée deux fois)
      const first = round.buzzes[0];
      if (first && teams.has(first.teamId)) teams.get(first.teamId).score += 1;
      round.phase = 'closed';
    },
    wrong: () => {                                                        // exclut et relance pour les autres
      if (round.phase !== 'buzzed') return;
      const first = round.buzzes[0];
      if (first) round.excluded.add(first.teamId);
      openRound({ newSong: false });
    },
    unexclude: ({ teamId } = {}) => { round.excluded.delete(teamId); },  // rend le buzzer à une équipe exclue
    score: ({ teamId, delta } = {}) => {
      const t = teams.get(teamId);
      if (t && Number.isInteger(delta) && Math.abs(delta) <= 10) t.score += delta;
    },
    kick: ({ teamId } = {}) => {
      const t = teams.get(teamId);
      if (!t) return;
      const kickedSockets = [...t.sockets];
      for (const sid of kickedSockets) socketTeam.delete(sid);
      teams.delete(teamId);
      round.buzzes = round.buzzes.filter((b) => b.teamId !== teamId);
      round.excluded.delete(teamId);
      if (!round.buzzes.length && round.phase === 'buzzed') round.phase = 'open';
      return { kickedSockets };
    },
    'reset-scores': () => { for (const t of teams.values()) t.score = 0; },
  };

  // Chaque action qui change quelque chose est mémorisée pour pouvoir être annulée.
  function host(action, payload) {
    const fn = actions[action];
    if (!fn) return { changed: false };
    const before = snapshot();
    const extra = fn(payload || {}) || {};
    const changed = JSON.stringify(before) !== JSON.stringify(snapshot());
    if (changed) {
      history.push(before);
      if (history.length > MAX_UNDO) history.shift();
    }
    return { changed, ...extra };
  }

  function undo() {
    if (!history.length) return false;
    restore(history.pop());
    return true;
  }

  // ---------- État diffusé ----------
  function publicState() {
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
      canUndo: history.length > 0,
      teams: [...teams.values()]
        .map((t) => ({ id: t.id, name: t.name, score: t.score, online: t.sockets.size }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr')),
    };
  }

  // ---------- Sauvegarde ----------
  // Les équipes et leurs scores survivent à un redémarrage. L'état du morceau en cours, lui, repart fermé.
  function toSaved() {
    return {
      round: round.number,
      teams: [...teams.values()].map(({ id, name, score }) => ({ id, name, score })),
    };
  }

  function load(data) {
    const list = data && Array.isArray(data.teams) ? data.teams : [];
    for (const t of list) {
      if (t && typeof t.id === 'string' && typeof t.name === 'string' && Number.isInteger(t.score)) {
        teams.set(t.id, { id: t.id, name: t.name, score: t.score, sockets: new Set() });
      }
    }
    if (data && Number.isInteger(data.round)) round.number = data.round;
    return { teams: teams.size };
  }

  return { join, leave, buzz, host, undo, publicState, toSaved, load };
}

module.exports = { createGame, MAX_NAME };
