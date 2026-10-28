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
const { decodeCsvBytes, parseCsv } = require('./lib/csv');
const { buildSections, isSafeImageName } = require('./lib/game-file');

const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');
const SCORES_FILE = process.env.SCORES_FILE || path.join(__dirname, 'scores.json');
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'images');

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
app.get('/screen', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/qr.svg', async (req, res) => {
  const ip = String(req.query.ip || (lanAddresses()[0] || {}).ip || 'localhost');
  if (!/^[\d.]+$|^localhost$/.test(ip)) return res.status(400).end();
  const svg = await QRCode.toString(`http://${ip}:${PORT}/`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});
app.use('/images', express.static(IMAGES_DIR, { dotfiles: 'deny', index: false }));
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

// ---------- Sockets ----------
// Un client peut envoyer n'importe quoi à la place de la fonction de réponse : on ne l'appelle que si c'en est une.
const reply = (ack) => (typeof ack === 'function' ? ack : () => {});
const HOST_ACTIONS = ['open', 'close', 'correct', 'wrong', 'unexclude', 'score', 'kick', 'reset-scores', 'stage', 'join-ip', 'section', 'qcm', 'countdown'];
const imageExists = (name) => isSafeImageName(name) && fs.existsSync(path.join(IMAGES_DIR, name));

io.on('connection', (socket) => {
  const { role, key } = socket.handshake.auth || {};
  const isHost = role === 'host' && key === HOST_KEY;
  // Rôle effectif : sans la bonne clé, on est joueur. Le Grand écran n'a pas de clé : il ne reçoit aucun secret.
  socket.data.role = isHost ? 'host' : role === 'screen' ? 'screen' : 'player';
  socket.data.teamId = null;

  socket.emit('state', game.publicState({ role: socket.data.role }));   // avant 'info' : la Régie connaît déjà joinIp
  if (socket.data.role !== 'player') {
    socket.join(socket.data.role === 'host' ? 'hosts' : 'screens');
    socket.emit('info', { ips: lanAddresses(), port: PORT });
  }

  // --- Joueurs ---
  socket.on('join', (rawName, ack) => {
    const res = game.join(socket.id, rawName);
    if (res.ok) socket.data.teamId = res.teamId;
    reply(ack)(res);
    if (res.ok) broadcast();
  });

  socket.on('buzz', (ack) => {
    const at = performance.now();                 // horodatage le plus tôt possible
    const res = game.buzz(socket.id, at);
    reply(ack)(res);
    if (res.ok) broadcast();
  });

  socket.on('answer', (letter, ack) => {
    const res = game.answer(socket.id, letter);
    reply(ack)(res);
    if (res.ok) broadcast();
  });

  // --- Hôte ---
  for (const action of HOST_ACTIONS) {
    socket.on(`host:${action}`, (payload) => {
      if (!isHost) return;
      const res = game.host(action, payload);
      for (const sid of res.kickedSockets || []) {
        const sock = io.sockets.sockets.get(sid);
        if (sock) { sock.data.teamId = null; sock.emit('kicked'); }
      }
      broadcast();
    });
  }
  // Import du fichier de partie : la Régie envoie les octets bruts, le serveur décode, vérifie et répond.
  socket.on('host:import', (bytes, ack = () => {}) => {
    if (!isHost || typeof ack !== 'function') return;
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return ack({ ok: false, error: 'Fichier illisible.' });
    const built = buildSections(parseCsv(decodeCsvBytes(bytes)), { imageExists });
    if (!built.ok) return ack(built);
    const res = game.host('import', { sections: built.sections });
    if (res.error) return ack({ ok: false, error: res.error });
    ack({ ok: true, count: built.sections.length });
    broadcast();
  });
  socket.on('host:undo', () => {
    if (!isHost || !game.undo()) return;
    broadcast();
  });

  socket.on('disconnect', () => {
    game.leave(socket.id);
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
