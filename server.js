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
const { MUSIC_TYPES, VIDEO_TYPES, isSafeMusicName, isSafeVideoName, parseSource } = require('./lib/songs');
const { saveStream } = require('./lib/upload');
const { createPartiesStore, cleanPartieName } = require('./lib/parties');
const { checkLiveEdit } = require('./lib/live-edit');
const { createSpotify, UNREACHABLE } = require('./lib/spotify');
const { createYoutube, UNREACHABLE: YOUTUBE_UNREACHABLE } = require('./lib/youtube');
const { isLoopback, createScreenRegistry } = require('./lib/screens');

const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString('hex');
const SCORES_FILE = process.env.SCORES_FILE || path.join(__dirname, 'scores.json');
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'images');
const PARTIES_DIR = process.env.PARTIES_DIR || path.join(__dirname, 'parties');
const MUSIQUES_DIR = process.env.MUSIQUES_DIR || path.join(__dirname, 'musiques');
const VIDEOS_DIR = process.env.VIDEOS_DIR || path.join(__dirname, 'videos');
const SPOTIFY_FILE = process.env.SPOTIFY_FILE || path.join(__dirname, 'spotify.json');
const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_MUSIC = 50 * 1024 * 1024;
const MAX_VIDEO = 500 * 1024 * 1024;

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
// ---------- Spotify (connexion OAuth PKCE) ----------
// Spotify n’accepte en HTTP que l’IP de bouclage, pas « localhost » : la connexion se fait depuis ce PC.
const spotify = createSpotify({
  file: SPOTIFY_FILE,
  redirectUri: `http://127.0.0.1:${PORT}/spotify/callback`,
  clientId: process.env.SPOTIFY_CLIENT_ID || undefined,
});
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function spotifyErrorPage(res, message, link) {
  res.status(400).type('html').send(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Spotify</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem">
<h1>Connexion à Spotify impossible</h1><p>${escapeHtml(message)}</p><p>${link}</p></body></html>`);
}
const backLink = (back) => `<a href="/${back}?key=${encodeURIComponent(HOST_KEY)}">Revenir</a>`;
app.get('/spotify/login', (req, res) => {
  if (req.query.key !== HOST_KEY) return res.status(403).send('Clé hôte invalide. Elle est affichée dans la console du serveur.');
  const back = req.query.back === 'creation' ? 'creation' : 'host';
  const url = spotify.authUrl({ back });
  if (!url) return spotifyErrorPage(res, 'Aucun Client ID Spotify n’est configuré.', backLink(back));
  res.redirect(url);
});
app.get('/spotify/callback', async (req, res) => {
  const str = (v) => (typeof v === 'string' ? v : undefined);
  try {
    const r = await spotify.handleCallback({ code: str(req.query.code), state: str(req.query.state), error: str(req.query.error) });
    if (r.ok) return res.redirect(`/${r.back}?key=${encodeURIComponent(HOST_KEY)}`);
    // Sans state valide, on ne sait pas qui appelle : le lien de retour ne porte pas la clé hôte.
    spotifyErrorPage(res, r.error, r.back ? backLink(r.back) : 'Rouvrez la Régie avec sa clé (affichée dans la console du serveur).');
  } catch (e) {
    console.error('  Erreur pendant la connexion Spotify :', e.message);
    spotifyErrorPage(res, 'Erreur inattendue.', 'Rouvrez la Régie avec sa clé (affichée dans la console du serveur).');
  }
});
app.get('/screen', (req, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/qr.svg', async (req, res) => {
  const ip = String(req.query.ip || (lanAddresses()[0] || {}).ip || 'localhost');
  if (!/^[\d.]+$|^localhost$/.test(ip)) return res.status(400).end();
  const svg = await QRCode.toString(`http://${ip}:${PORT}/`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
});
app.use('/images', express.static(IMAGES_DIR, { dotfiles: 'deny', index: false }));
app.use('/musiques', express.static(MUSIQUES_DIR, { dotfiles: 'deny', index: false }));
app.use('/videos', express.static(VIDEOS_DIR, { dotfiles: 'deny', index: false }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---------- Jeu ----------
const game = createGame({
  onTimer: () => broadcast(),   // fin du compte à rebours QCM
  coverOf: (s) => spotify.cachedTrack(s.ref)?.cover ?? null,
});
// Pochette du morceau Spotify qui vient d’être lancé : demandée en tâche de fond, pour la révélation.
// Une panne ne gêne pas le jeu : la révélation se fait alors sans pochette.
function prefetchCover() {
  const st = game.publicState({ role: 'host' }).song;
  if (st?.kind === 'qcm') return;   // pas de pochette à révéler en QCM
  const cur = st && st.index !== null && !st.concluded ? st.songs[st.index] : null;
  if (!cur || cur.source !== 'spotify' || spotify.cachedTrack(cur.ref) || !spotify.status().connected) return;
  spotify.track(cur.ref)
    .then((t) => { if (t) broadcast(); })
    .catch((e) => console.warn('  Pochette Spotify indisponible :', e.message));
}
// Grands écrans : un seul lit les vidéos (le dernier ouvert depuis ce PC). Son dernier statut est relayé aux Régies.
const screens = createScreenRegistry();
const NO_VIDEO = { unlocked: false, key: null, pos: null, error: null };
let videoStatus = NO_VIDEO;
// screens : tous les Grands écrans connectés, pour signaler à la Régie celui qui n’est pas ouvert à l’adresse 127.0.0.1.
const videoEvent = () => ({ reader: screens.reader() !== null, screens: screens.count(), ...videoStatus });
const emitVideo = () => io.to('hosts').emit('video', videoEvent());
// Le lecteur change (ou disparaît) : l’ancien statut ne le concerne plus.
function readerChanged() {
  videoStatus = NO_VIDEO;
  broadcast();
  emitVideo();
}
const MAX_ERROR = 300;
const cleanVideoStatus = (p) => {
  if (!p || typeof p !== 'object') return null;
  const { unlocked, key, pos, error } = p;
  if (typeof unlocked !== 'boolean') return null;
  if (key !== null && typeof key !== 'string') return null;
  if (pos !== null && !(typeof pos === 'number' && Number.isFinite(pos))) return null;
  if (error !== null && typeof error !== 'string') return null;
  return { unlocked, key: key === null ? null : key.slice(0, MAX_ERROR), pos, error: error === null ? null : error.slice(0, MAX_ERROR) };
};

// Chaque rôle reçoit son propre état : le Grand écran et les Buzzers ne voient jamais les secrets de la Régie.
function broadcast() {
  io.to('hosts').emit('state', game.publicState({ role: 'host' }));
  const reader = screens.reader();
  for (const sock of io.sockets.sockets.values()) {
    if (sock.data.role === 'screen') sock.emit('state', game.publicState({ role: 'screen', reader: sock.id === reader }));
    else if (sock.data.role === 'player') sock.emit('state', game.publicState({ role: 'player', teamId: sock.data.teamId }));
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
fs.mkdirSync(VIDEOS_DIR, { recursive: true });
const parties = createPartiesStore({ dir: PARTIES_DIR, musicExists: (name) => isSafeMusicName(name) && fs.existsSync(path.join(MUSIQUES_DIR, name)), videoExists: (name) => isSafeVideoName(name) && fs.existsSync(path.join(VIDEOS_DIR, name)), imageExists: (name) => isSafeImageName(name) && fs.existsSync(path.join(IMAGES_DIR, name)) });
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
    const check = checkLiveEdit({ oldSections: live.sections, newSections: withOrig, progress: live.progress, currentSection: live.currentSection, qcmStep: live.qcmStep, roundOpenedInSection: live.roundOpenedInSection, currentSectionScored: live.currentSectionScored });
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
  // Vérification avant la soirée : on prévient sans bloquer.
  // Morceaux des manches buzzer et extraits des questions QCM.
  const uses = (source) => r.sections.some((s) => (s.songs || []).some((x) => x.source === source)
    || (s.questions || []).some((q) => q.extract?.source === source));
  const warnings = [];
  if (uses('spotify') && !spotify.status().connected) warnings.push('Cette partie contient des morceaux Spotify, mais Spotify n’est pas connecté.');
  if (uses('youtube')) warnings.push('Cette partie contient des vidéos YouTube : une connexion internet est nécessaire.');
  res.json({ ok: true, warnings });
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
// Vidéo : écrite en flux sur le disque (jusqu’à 500 Mo), jamais entièrement en mémoire.
const VIDEO_MESSAGES = {
  'bad-type': [400, 'Format vidéo non accepté (mp4, webm, m4v ou mov).'],
  empty: [400, 'Vidéo vide.'],
  'too-big': [413, 'Fichier trop gros (500 Mo maximum pour une vidéo).'],
  aborted: [400, 'Requête invalide.'],
};
api.post('/videos', async (req, res) => {
  if (Number(req.headers['content-length']) > MAX_VIDEO) {
    req.resume();
    return res.status(413).json({ error: VIDEO_MESSAGES['too-big'][1] });
  }
  const r = await saveStream(req, { dir: VIDEOS_DIR, filename: req.query.filename, types: VIDEO_TYPES, max: MAX_VIDEO });
  if (r.ok) return res.json(r);
  req.resume();
  const [status, error] = VIDEO_MESSAGES[r.reason];
  return res.status(status).json({ error });
});

// Spotify : la recherche passe par le serveur ; la page ne reçoit que des jetons d’accès courts.
const SPOTIFY_TRACK_ID = /^[0-9A-Za-z]{22}$/;
function spotifyFail(res, e) {
  if (!e.status) console.warn('  Erreur Spotify :', e.message);
  res.status(e.status || 503).json({ error: e.status ? e.message : UNREACHABLE });
}
api.get('/spotify/status', (req, res) => res.json(spotify.status()));
api.post('/spotify/client-id', (req, res) => {
  if (!spotify.setClientId(req.body?.clientId)) return res.status(400).json({ error: 'Client ID invalide (32 caractères hexadécimaux).' });
  res.json({ ok: true, ...spotify.status() });
});
api.get('/spotify/token', async (req, res) => {
  try {
    const accessToken = await spotify.accessToken();
    if (!accessToken) return res.status(401).json({ error: 'Spotify n’est pas connecté.' });
    res.set('Cache-Control', 'no-store').json({ accessToken });
  } catch (e) { spotifyFail(res, e); }
});
api.get('/spotify/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
  try { res.json({ tracks: await spotify.search(q) }); } catch (e) { spotifyFail(res, e); }
});
api.get('/spotify/tracks/:id', async (req, res) => {
  if (!SPOTIFY_TRACK_ID.test(req.params.id)) return res.status(400).json({ error: 'Identifiant Spotify invalide.' });
  try {
    const t = await spotify.track(req.params.id);
    return t ? res.json(t) : res.status(404).json({ error: 'Titre introuvable sur Spotify.' });
  } catch (e) { spotifyFail(res, e); }
});
api.post('/spotify/disconnect', (req, res) => {
  spotify.disconnect();
  res.json({ ok: true });
});

// YouTube : titre et miniature d’une vidéo (oEmbed public, sans clé). Une panne ne touche que la page Création.
const youtube = createYoutube();
api.get('/youtube/info', async (req, res) => {
  const parsed = parseSource(typeof req.query.link === 'string' ? req.query.link : '');
  if (!parsed || parsed.source !== 'youtube') return res.status(400).json({ error: 'Lien YouTube invalide.' });
  try {
    res.json(await youtube.info(parsed.ref));
  } catch (e) {
    if (!e.status) console.warn('  Erreur YouTube :', e.message);
    res.status(e.status || 503).json({ error: e.status ? e.message : YOUTUBE_UNREACHABLE });
  }
});

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

// Une seule Régie joue le son : la première connectée la garde. Elle ne change qu’avec « Le son sort ici »
// ou quand elle se déconnecte (la plus ancienne Régie restante prend le relais). Question de réseau, pas de jeu.
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

  const before = screens.reader();
  if (socket.data.role === 'screen') screens.add(socket.id, { loopback: isLoopback(socket.handshake.address) });
  socket.emit('state', game.publicState({ role: socket.data.role, reader: socket.data.role === 'screen' && socket.id === screens.reader() }));   // avant 'info' : la Régie connaît déjà joinIp
  if (socket.data.role !== 'player') {
    socket.join(socket.data.role === 'host' ? 'hosts' : 'screens');
    socket.emit('info', { ips: lanAddresses(), port: PORT });
    if (isHost) {
      if (!soundOwner || !io.sockets.sockets.has(soundOwner)) soundOwner = socket.id;
      emitSound();
      socket.emit('video', videoEvent());
    }
    if (screens.reader() !== before) readerChanged();
    else if (socket.data.role === 'screen') emitVideo();   // un Grand écran de plus, qui ne lit pas
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
      const res = game.host(action, payload);
      if (action === 'open') prefetchCover();
      for (const sid of res.kickedSockets || []) {
        const sock = io.sockets.sockets.get(sid);
        if (sock) { sock.data.teamId = null; sock.emit('kicked'); }
      }
      broadcast();
    });
  }
  on('host:undo', () => {
    if (!isHost) return;
    if (game.undo()) broadcast();
  });

  // Fin du passage joué : un fait remonté par la Régie, pas une action annulable.
  on('host:ended', (payload) => {
    if (!isHost) return;
    const seq = payload && payload.seq;
    if (Number.isInteger(seq) && game.songEnded(seq, 'host')) broadcast();
  });

  // Le Grand écran qui lit signale la fin de la vidéo et son état ; les autres Grands écrans sont ignorés.
  on('screen:ended', (payload) => {
    if (socket.id !== screens.reader()) return;
    const seq = payload && payload.seq;
    if (Number.isInteger(seq) && game.songEnded(seq, 'screen')) broadcast();
  });
  on('screen:video', (payload) => {
    if (socket.id !== screens.reader()) return;
    const status = cleanVideoStatus(payload);
    if (!status) return;
    videoStatus = status;
    emitVideo();
  });

  on('host:sound-here', () => {
    if (isHost) claimSound(socket.id);
  });

  on('disconnect', () => {
    game.leave(socket.id);
    const reading = screens.reader();
    screens.remove(socket.id);
    if (screens.reader() !== reading) readerChanged();
    else if (socket.data.role === 'screen') emitVideo();
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
  // 127.0.0.1 plutôt que localhost : c’est l’adresse de retour acceptée par Spotify.
  console.log(`    Régie       : http://127.0.0.1:${PORT}/host?key=${HOST_KEY}`);
  console.log(`    Grand écran : http://127.0.0.1:${PORT}/screen   (fenêtre à glisser sur le projecteur)\n`);
  const sp = spotify.status();
  console.log(`  Spotify : ${sp.connected ? 'connecté' : sp.configured ? 'non connecté' : 'non configuré'}\n`);
});
