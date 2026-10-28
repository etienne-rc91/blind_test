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
const { createGame } = require('./lib/game');
const { isSafeImageName } = require('./lib/game-file');
const { MUSIC_TYPES, isSafeMusicName } = require('./lib/songs');
const { createPartiesStore, cleanPartieName } = require('./lib/parties');
const { checkLiveEdit } = require('./lib/live-edit');

const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');
const SCORES_FILE = process.env.SCORES_FILE || path.join(__dirname, 'scores.json');
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'images');
const PARTIES_DIR = process.env.PARTIES_DIR || path.join(__dirname, 'parties');
const MUSIQUES_DIR = process.env.MUSIQUES_DIR || path.join(__dirname, 'musiques');
const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_MUSIC = 50 * 1024 * 1024;

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
// Pages de préparation : réservées à l'animateur, comme la Régie.
for (const page of ['parties', 'creation']) {
  app.get(`/${page}`, (req, res) => {
    if (req.query.key !== HOST_KEY) return res.status(403).send('Clé hôte invalide. Elle est affichée dans la console du serveur.');
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
}
app.get('/screen', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/qr.svg', async (req, res) => {
  const ip = String(req.query.ip || (lanAddresses()[0] || {}).ip || 'localhost');
  if (!/^[\d.]+$|^localhost$/.test(ip)) return res.status(400).end();
  const svg = await QRCode.toString(`http://${ip}:${PORT}/`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});
app.use('/images', express.static(IMAGES_DIR, { dotfiles: 'deny', index: false }));
app.use('/musiques', express.static(MUSIQUES_DIR, { dotfiles: 'deny', index: false }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---------- Jeu ----------
const game = createGame({ onTimer: () => broadcast() });   // fin du compte à rebours QCM
// Chaque rôle reçoit son propre état : le Grand écran et les Buzzers ne voient jamais les secrets de la Régie.
function broadcast() {
  io.to('hosts').emit('state', game.publicState({ role: 'host' }));
  io.to('screens').emit('state', game.publicState({ role: 'screen' }));
  for (const sock of io.sockets.sockets.values()) {
    if (sock.data.role === 'player') sock.emit('state', game.publicState({ role: 'player', teamId: sock.data.teamId }));
  }
  scheduleSave();
}

// ---------- Sauvegarde des scores ----------
// Écriture atomique de game.toSaved(), regroupée sur 300 ms.
let lastSaved = '', saveTimer = null;
function saveScores() {
  const data = JSON.stringify(game.toSaved(), null, 2);
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
  const { teams } = game.load(data);
  console.log(`  ${teams} équipe(s) et leurs scores rechargés depuis ${path.basename(SCORES_FILE)}`);
}

// ---------- Parties (API HTTP, réservée à l'animateur) ----------
fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(MUSIQUES_DIR, { recursive: true });
const parties = createPartiesStore({ dir: PARTIES_DIR, musicExists: (name) => isSafeMusicName(name) && fs.existsSync(path.join(MUSIQUES_DIR, name)), imageExists: (name) => isSafeImageName(name) && fs.existsSync(path.join(IMAGES_DIR, name)) });
const sameName = (a, b) => a != null && b != null && a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
const fail = (res, r) => res.status(r.status || 400).json({ error: r.error });

const api = express.Router();
api.use((req, res, next) => (req.get('x-host-key') === HOST_KEY ? next() : res.status(403).json({ error: 'Clé hôte invalide.' })));
api.use(express.json({ limit: '2mb' }));

api.get('/parties', (req, res) => {
  const { partieName } = game.getLive();
  res.json({ current: partieName, teamCount: game.publicState({ role: 'host' }).teams.length, parties: parties.list() });
});

api.get('/parties/:name', (req, res) => {
  const r = parties.read(req.params.name);
  return r.ok ? res.json(r) : fail(res, r);
});

// Enregistrer (overwrite) ou Enregistrer sous / nouvelle partie (sans overwrite).
// La partie en cours est vérifiée avant toute écriture : un refus ne touche ni au fichier ni au jeu.
api.put('/parties/:name', (req, res) => {
  const { sections, overwrite } = req.body || {};
  const live = game.getLive();
  const isCurrent = overwrite === true && sameName(cleanPartieName(req.params.name), live.partieName);
  let warnings = [];
  if (isCurrent) {
    // Vérifie la version exacte qui sera écrite et relue, avec la position d'origine (orig) envoyée par Création.
    const prep = parties.prepare(sections);
    if (!prep.ok) return fail(res, prep);
    const withOrig = prep.sections.map((sec, i) => ({
      ...sec,
      orig: sections[i]?.orig,
      questions: sec.questions.map((q, k) => ({ ...q, orig: sections[i]?.questions?.[k]?.orig })),
      ...(sec.songs ? { songs: sec.songs.map((x, k) => ({ ...x, orig: sections[i]?.songs?.[k]?.orig })) } : {}),
    }));
    const check = checkLiveEdit({ oldSections: live.sections, newSections: withOrig, progress: live.progress, currentSection: live.currentSection, qcmStep: live.qcmStep });
    if (!check.ok) return res.status(409).json({ error: check.error });
    warnings = check.warnings;
  }
  const r = parties.save(req.params.name, sections, { overwrite: overwrite === true });
  if (!r.ok) return fail(res, r);
  let applied = false;
  if (isCurrent) {
    if (r.problems.length) warnings.push('La partie est incomplète : le jeu continue avec la version précédente.');
    else if (game.replaceSections(parties.read(r.name).sections)) {
      applied = true;
      broadcast();
    }
  }
  res.json({ ok: true, name: r.name, problems: r.problems, applied, warnings });
});

api.post('/parties/:name/rename', (req, res) => {
  const r = parties.rename(req.params.name, req.body?.to);
  if (!r.ok) return fail(res, r);
  if (sameName(cleanPartieName(req.params.name), game.getLive().partieName)) { game.setPartieName(r.name); broadcast(); }
  res.json(r);
});

api.delete('/parties/:name', (req, res) => {
  if (sameName(cleanPartieName(req.params.name), game.getLive().partieName)) {
    return res.status(409).json({ error: 'C’est la partie en cours : choisissez-en une autre avant de la supprimer.' });
  }
  const r = parties.remove(req.params.name);
  return r.ok ? res.json(r) : fail(res, r);
});

// Jouer = nouvelle soirée : équipes, scores et avancement repartent de zéro.
api.post('/parties/:name/play', (req, res) => {
  const r = parties.read(req.params.name);
  if (!r.ok) return fail(res, r);
  if (r.problems.length) return res.status(422).json({ error: `Partie incomplète : ${r.problems.join(' ; ')}.` });
  // Des équipes ont rejoint : la page doit confirmer (le décompte vient du serveur, pas d'une page ouverte depuis longtemps).
  const teamCount = game.publicState({ role: 'host' }).teams.length;
  if (teamCount > 0 && req.body?.confirm !== true) {
    return res.status(409).json({ error: `${teamCount} équipe(s) en jeu : confirmez pour les effacer.`, needConfirm: true, teamCount });
  }
  const { kickedSockets } = game.newEvening({ name: r.name, sections: r.sections });
  for (const sid of kickedSockets) {
    const sock = io.sockets.sockets.get(sid);
    if (sock) { sock.data.teamId = null; sock.emit('kicked'); }
  }
  broadcast();
  res.json({ ok: true });
});

const rawBody = (limit) => express.raw({ type: () => true, limit });
api.post('/parties-import', rawBody('1mb'), (req, res) => {
  const r = parties.importCsv(req.query.name, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
  return r.ok ? res.json(r) : fail(res, r);
});

// Fichier choisi dans Création : copié dans son dossier sous un nom sûr ; même nom et même contenu → réutilisé.
function saveUpload(req, res, { dir, types, badType, empty }) {
  const base = path.basename(String(req.query.filename || '')).replace(/[^\w.-]/g, '_').replace(/^\.+/, '');
  const m = base.match(/^(.+)\.([A-Za-z0-9]+)$/);
  if (!m || !types.includes(m[2].toLowerCase())) return res.status(400).json({ error: badType });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: empty });
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${m[1]}-${n}.${m[2]}`;
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { fs.writeFileSync(file, req.body); return res.json({ ok: true, name }); }
    if (fs.readFileSync(file).equals(req.body)) return res.json({ ok: true, name });
  }
}
api.post('/images', rawBody(MAX_IMAGE), (req, res) => saveUpload(req, res, {
  dir: IMAGES_DIR, types: IMAGE_TYPES, badType: 'Format d’image non accepté (png, jpg, gif, webp ou svg).', empty: 'Image vide.',
}));
api.post('/musiques', rawBody(MAX_MUSIC), (req, res) => saveUpload(req, res, {
  dir: MUSIQUES_DIR, types: MUSIC_TYPES, badType: 'Format audio non accepté (mp3, m4a, aac, ogg, wav ou flac).', empty: 'Morceau vide.',
}));

api.use((err, req, res, next) => {   // corps trop gros ou JSON illisible
  if (err.type === 'entity.too.large') {
    const music = req.path === '/musiques';
    return res.status(413).json({ error: music ? 'Fichier trop gros (50 Mo maximum pour un morceau).' : 'Fichier trop gros (10 Mo maximum pour une image).' });
  }
  res.status(400).json({ error: 'Requête invalide.' });
});
app.use('/api', api);

// ---------- Sockets ----------
// Un client peut envoyer n'importe quoi à la place de la fonction de réponse : on ne l'appelle que si c'en est une.
const reply = (ack) => (typeof ack === 'function' ? ack : () => {});
const HOST_ACTIONS = ['open', 'close', 'correct', 'wrong', 'unexclude', 'score', 'kick', 'reset-scores', 'stage', 'join-ip', 'section', 'qcm', 'countdown', 'replay'];

// Une seule Régie joue le son : la dernière à agir (ou la première connectée). Question de réseau, pas de jeu.
let soundOwner = null;
function hostSockets() {
  return [...(io.sockets.adapter.rooms.get('hosts') || [])].map((id) => io.sockets.sockets.get(id)).filter(Boolean);
}
function emitSound() {
  for (const sock of hostSockets()) sock.emit('sound', { mine: sock.id === soundOwner });
}
function claimSound(id) {
  if (soundOwner === id) return;
  soundOwner = id;
  emitSound();
}

const safe = (fn) => (...args) => {
  try { fn(...args); } catch (e) { console.error('  Erreur pendant une action :', e); }
};

io.on('connection', (socket) => {
  const on = (event, fn) => socket.on(event, safe(fn));
  const { role, key } = socket.handshake.auth || {};
  const isHost = role === 'host' && key === HOST_KEY;
  // Rôle effectif : sans la bonne clé, on est joueur. Le Grand écran n'a pas de clé : il ne reçoit aucun secret.
  socket.data.role = isHost ? 'host' : role === 'screen' ? 'screen' : 'player';
  socket.data.teamId = null;

  socket.emit('state', game.publicState({ role: socket.data.role }));   // avant 'info' : la Régie connaît déjà joinIp
  if (socket.data.role !== 'player') {
    socket.join(socket.data.role === 'host' ? 'hosts' : 'screens');
    socket.emit('info', { ips: lanAddresses(), port: PORT });
    if (isHost) {
      if (!soundOwner || !io.sockets.sockets.has(soundOwner)) soundOwner = socket.id;
      emitSound();
    }
  }

  // --- Joueurs ---
  on('join', (rawName, ack) => {
    const res = game.join(socket.id, rawName);
    if (res.ok) socket.data.teamId = res.teamId;
    reply(ack)(res);
    if (res.ok) broadcast();
  });

  on('buzz', (ack) => {
    const at = performance.now();                 // horodatage le plus tôt possible
    const res = game.buzz(socket.id, at);
    reply(ack)(res);
    if (res.ok) broadcast();
  });

  on('answer', (letter, ack) => {
    const res = game.answer(socket.id, letter);
    reply(ack)(res);
    if (res.ok) broadcast();
  });

  // --- Hôte ---
  for (const action of HOST_ACTIONS) {
    on(`host:${action}`, (payload) => {
      if (!isHost) return;
      claimSound(socket.id);
      const res = game.host(action, payload);
      for (const sid of res.kickedSockets || []) {
        const sock = io.sockets.sockets.get(sid);
        if (sock) { sock.data.teamId = null; sock.emit('kicked'); }
      }
      broadcast();
    });
  }
  on('host:undo', () => {
    if (!isHost) return;
    claimSound(socket.id);
    if (game.undo()) broadcast();
  });

  // Fin du passage joué : un fait remonté par la Régie, pas une action annulable.
  on('host:ended', (payload) => {
    if (!isHost) return;
    const seq = payload && payload.seq;
    if (Number.isInteger(seq) && game.songEnded(seq)) broadcast();
  });

  on('host:sound-here', () => {
    if (isHost) claimSound(socket.id);
  });

  on('disconnect', () => {
    game.leave(socket.id);
    if (isHost && soundOwner === socket.id) {
      const next = hostSockets().find((s) => s.id !== socket.id);   // le plus ancien hôte restant
      soundOwner = next ? next.id : null;
      emitSound();
    }
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
  console.log('\n  Sur ce PC :');
  console.log(`    Régie       : http://localhost:${PORT}/host?key=${HOST_KEY}`);
  console.log(`    Grand écran : http://localhost:${PORT}/screen   (fenêtre à glisser sur le projecteur)\n`);
});
