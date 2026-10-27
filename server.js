// Blind test buzzer — serveur LAN.
// Arbitrage à l'arrivée sur le serveur (horloge monotone) : équitable sur un Wi-Fi local homogène.
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');
const MAX_NAME = 24;
const SCORES_FILE = process.env.SCORES_FILE || path.join(__dirname, 'scores.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 4000,   // détection rapide des téléphones déconnectés
  pingTimeout: 3000,
  connectionStateRecovery: {},
});

function lanAddresses() {
  const out = [];
  for (const [ifname, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ ifname, ip: a.address });
    }
  }
  return out;
}

// ---------- Routes ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/host', (req, res) => {
  if (req.query.key !== HOST_KEY) return res.status(403).send('Clé hôte invalide. Elle est affichée dans la console du serveur.');
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});
app.get('/qr.svg', async (req, res) => {
  const ip = String(req.query.ip || (lanAddresses()[0] || {}).ip || 'localhost');
  if (!/^[\d.]+$|^localhost$/.test(ip)) return res.status(400).end();
  const svg = await QRCode.toString(`http://${ip}:${PORT}/`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---------- État ----------
/** @type {Map<string, {id:string,name:string,score:number,sockets:Set<string>}>} */
const teams = new Map();
const round = {
  phase: 'closed',          // closed | open | buzzed
  buzzes: [],               // [{teamId, at}] — at = performance.now() à la réception
  excluded: new Set(),      // équipes ayant donné une mauvaise réponse sur ce morceau
  number: 0,
};

const teamIdOf = (name) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const cleanName = (name) => String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_NAME);

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
    teams: [...teams.values()]
      .map((t) => ({ id: t.id, name: t.name, score: t.score, online: t.sockets.size }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr')),
  };
}
const broadcast = () => { io.emit('state', publicState()); scheduleSave(); };

// ---------- Sauvegarde des scores ----------
// Les équipes et leurs scores survivent à un redémarrage. L'état du morceau en cours, lui, repart fermé.
let lastSaved = '', saveTimer = null;
function saveScores() {
  const data = JSON.stringify({
    round: round.number,
    teams: [...teams.values()].map(({ id, name, score }) => ({ id, name, score })),
  }, null, 2);
  if (data === lastSaved) return;
  try {
    fs.writeFileSync(SCORES_FILE + '.tmp', data);
    fs.renameSync(SCORES_FILE + '.tmp', SCORES_FILE);   // écriture atomique : jamais de fichier à moitié écrit
    lastSaved = data;
  } catch (e) {
    console.error('  Sauvegarde des scores impossible :', e.message);
  }
}
function scheduleSave() {
  if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveScores(); }, 300);
}
function loadScores() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return;
    console.warn(`  Fichier de scores illisible, mis de côté dans ${SCORES_FILE}.bad`);
    try { fs.renameSync(SCORES_FILE, SCORES_FILE + '.bad'); } catch {}
    return;
  }
  for (const t of Array.isArray(data.teams) ? data.teams : []) {
    if (typeof t.id === 'string' && typeof t.name === 'string' && Number.isInteger(t.score)) {
      teams.set(t.id, { id: t.id, name: t.name, score: t.score, sockets: new Set() });
    }
  }
  if (Number.isInteger(data.round)) round.number = data.round;
  console.log(`  ${teams.size} équipe(s) et leurs scores rechargés depuis ${path.basename(SCORES_FILE)}`);
}

function openRound({ newSong }) {
  if (newSong) { round.excluded.clear(); round.number += 1; }
  round.buzzes = [];
  round.phase = 'open';
}

// ---------- Sockets ----------
io.on('connection', (socket) => {
  const { role, key } = socket.handshake.auth || {};
  const isHost = role === 'host' && key === HOST_KEY;
  let myTeam = null;

  if (isHost) {
    socket.join('hosts');
    socket.emit('info', { ips: lanAddresses(), port: PORT });
  }
  socket.emit('state', publicState());

  // --- Joueurs ---
  socket.on('join', (rawName, ack = () => {}) => {
    const name = cleanName(rawName);
    if (!name) return ack({ ok: false, error: 'Donnez un nom d’équipe.' });
    const id = teamIdOf(name);
    if (myTeam && myTeam !== id) teams.get(myTeam)?.sockets.delete(socket.id);
    if (!teams.has(id)) teams.set(id, { id, name, score: 0, sockets: new Set() });
    teams.get(id).sockets.add(socket.id);
    myTeam = id;
    ack({ ok: true, teamId: id, name: teams.get(id).name });
    broadcast();
  });

  socket.on('buzz', (ack = () => {}) => {
    const at = performance.now();                 // horodatage le plus tôt possible
    if (!myTeam || !teams.has(myTeam)) return ack({ ok: false, reason: 'not-joined' });
    if (round.phase === 'closed') return ack({ ok: false, reason: 'closed' });
    if (round.excluded.has(myTeam)) return ack({ ok: false, reason: 'excluded' });
    if (round.buzzes.some((b) => b.teamId === myTeam)) return ack({ ok: false, reason: 'already' });
    round.buzzes.push({ teamId: myTeam, at });
    const rank = round.buzzes.length;
    if (rank === 1) round.phase = 'buzzed';
    ack({ ok: true, rank });
    broadcast();
  });

  // --- Hôte ---
  const hostOnly = (fn) => (...args) => { if (isHost) { fn(...args); broadcast(); } };

  socket.on('host:open', hostOnly(() => openRound({ newSong: true })));     // nouveau morceau
  socket.on('host:close', hostOnly(() => { round.phase = 'closed'; }));
  socket.on('host:correct', hostOnly(() => {
    const first = round.buzzes[0];
    if (first && teams.has(first.teamId)) teams.get(first.teamId).score += 1;
    round.phase = 'closed';
  }));
  socket.on('host:wrong', hostOnly(() => {                                 // exclut et relance pour les autres
    const first = round.buzzes[0];
    if (first) round.excluded.add(first.teamId);
    openRound({ newSong: false });
  }));
  socket.on('host:unexclude', hostOnly(({ teamId } = {}) => {              // rend le buzzer à une équipe exclue
    round.excluded.delete(teamId);
  }));
  socket.on('host:score', hostOnly(({ teamId, delta } = {}) => {
    const t = teams.get(teamId);
    if (t && Number.isInteger(delta) && Math.abs(delta) <= 10) t.score += delta;
  }));
  socket.on('host:kick', hostOnly(({ teamId } = {}) => {
    const t = teams.get(teamId);
    if (!t) return;
    for (const sid of t.sockets) io.sockets.sockets.get(sid)?.emit('kicked');
    teams.delete(teamId);
    round.buzzes = round.buzzes.filter((b) => b.teamId !== teamId);
    round.excluded.delete(teamId);
    if (!round.buzzes.length && round.phase === 'buzzed') round.phase = 'open';
  }));
  socket.on('host:reset-scores', hostOnly(() => { for (const t of teams.values()) t.score = 0; }));

  socket.on('disconnect', () => {
    if (myTeam) teams.get(myTeam)?.sockets.delete(socket.id);
    broadcast();
  });
});

// Ctrl+C : on écrit les derniers changements avant de quitter.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { saveScores(); process.exit(0); });

loadScores();
server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('\n  Blind test buzzer prêt\n');
  if (!ips.length) console.log('  Aucune interface réseau trouvée : connectez le PC au Wi-Fi de la soirée.');
  for (const { ifname, ip } of ips) {
    console.log(`  [${ifname}]`);
    console.log(`    Joueurs : http://${ip}:${PORT}/`);
    console.log(`    Hôte    : http://${ip}:${PORT}/host?key=${HOST_KEY}`);
  }
  console.log(`\n  Sur ce PC : http://localhost:${PORT}/host?key=${HOST_KEY}\n`);
});
