// Tests de l'API HTTP : un vrai serveur en sous-processus, avec des dossiers temporaires.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const KEY = 'test-key';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buzzer-api-'));
const DIRS = { parties: path.join(tmp, 'parties'), images: path.join(tmp, 'images'), musiques: path.join(tmp, 'musiques'), videos: path.join(tmp, 'videos') };
fs.mkdirSync(DIRS.images);
let base, child;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

test.before(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST_KEY: KEY, SCORES_FILE: path.join(tmp, 'scores.json'), IMAGES_DIR: DIRS.images, MUSIQUES_DIR: DIRS.musiques, VIDEOS_DIR: DIRS.videos, PARTIES_DIR: DIRS.parties, SPOTIFY_FILE: path.join(tmp, 'spotify.json'), SPOTIFY_CLIENT_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('prêt')) resolve(); });
    child.on('exit', (code) => reject(new Error(`serveur arrêté (${code})`)));
  });
});
test.after(() => child.kill());

const api = (method, route, body, { key = KEY, raw = false } = {}) => fetch(base + route, {
  method,
  headers: { ...(key ? { 'x-host-key': key } : {}), ...(body && !raw ? { 'content-type': 'application/json' } : {}), ...(raw ? { 'content-type': 'application/octet-stream' } : {}) },
  body: body ? (raw ? body : JSON.stringify(body)) : undefined,
});
const json = async (res) => ({ status: res.status, body: await res.json() });
const enc = encodeURIComponent;

const Q = (text, answer = 'B') => ({ text, image: null, choices: { A: 'a', B: 'b', C: 'c', D: 'd' }, answer });
const SECTIONS = [
  { name: 'Cinéma', type: 'buzzer', questions: [], songs: [] },
  { name: 'Culture G', type: 'qcm', questions: [Q('Capitale ?')] },
];

test('api requires the host key', async () => {
  assert.equal((await api('GET', '/api/parties', null, { key: null })).status, 403);
  assert.equal((await api('GET', '/api/parties', null, { key: 'mauvaise' })).status, 403);
  assert.equal((await fetch(`${base}/creation`)).status, 403);
  assert.equal((await fetch(`${base}/parties?key=mauvaise`)).status, 403);
  assert.equal((await fetch(`${base}/parties?key=${KEY}`)).status, 200);
});

test('save, list, read, rename and delete a partie', async () => {
  let r = await json(await api('PUT', `/api/parties/${enc('Soirée A')}`, { sections: SECTIONS, overwrite: false }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, name: 'Soirée A', problems: [], applied: false, warnings: [] });
  r = await json(await api('GET', '/api/parties'));
  assert.ok(r.body.parties.some((p) => p.name === 'Soirée A'));
  assert.equal(r.body.current, null);
  assert.equal(r.body.teamCount, 0);
  r = await json(await api('GET', `/api/parties/${enc('Soirée A')}`));
  assert.deepEqual(r.body.sections, SECTIONS);
  r = await json(await api('POST', `/api/parties/${enc('Soirée A')}/rename`, { to: 'Soirée B' }));
  assert.deepEqual(r.body, { ok: true, name: 'Soirée B' });
  assert.equal((await api('DELETE', `/api/parties/${enc('Soirée B')}`)).status, 200);
  assert.equal((await api('GET', `/api/parties/${enc('Soirée B')}`)).status, 404);
});

test('save as refuses an existing name', async () => {
  await api('PUT', '/api/parties/Doublon', { sections: SECTIONS, overwrite: false });
  const r = await json(await api('PUT', '/api/parties/doublon', { sections: SECTIONS, overwrite: false }));
  assert.equal(r.status, 409);
  assert.match(r.body.error, /déjà ce nom/);
});

test('play starts a new evening and refuses an incomplete partie', async () => {
  await api('PUT', '/api/parties/Brouillon', { sections: [{ name: 'X', type: 'qcm', questions: [] }], overwrite: false });
  let r = await json(await api('POST', '/api/parties/Brouillon/play'));
  assert.equal(r.status, 422);
  await api('PUT', '/api/parties/Jouable', { sections: SECTIONS, overwrite: false });
  r = await json(await api('POST', '/api/parties/Jouable/play'));
  assert.deepEqual(r, { status: 200, body: { ok: true, warnings: [] } });
  r = await json(await api('GET', '/api/parties'));
  assert.equal(r.body.current, 'Jouable');
});

test('delete of the current partie is refused, rename follows it', async () => {
  await api('PUT', '/api/parties/Courante', { sections: SECTIONS, overwrite: false });
  await api('POST', '/api/parties/Courante/play');
  const r = await json(await api('DELETE', '/api/parties/Courante'));
  assert.equal(r.status, 409);
  await api('POST', '/api/parties/Courante/rename', { to: 'Courante 2' });
  assert.equal((await json(await api('GET', '/api/parties'))).body.current, 'Courante 2');
});

test('live edit of the current partie is applied or refused', async () => {
  await api('PUT', '/api/parties/Live', { sections: SECTIONS, overwrite: false });
  await api('POST', '/api/parties/Live/play');
  const fixed = JSON.parse(JSON.stringify(SECTIONS));
  fixed[1].questions[0].text = 'Capitale corrigée ?';
  let r = await json(await api('PUT', '/api/parties/Live', { sections: fixed, overwrite: true }));
  assert.equal(r.body.applied, true);
  r = await json(await api('PUT', '/api/parties/Live', { sections: [fixed[1]], overwrite: true }));
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Modification impossible pendant la partie/);
  r = await json(await api('GET', '/api/parties/Live'));
  assert.equal(r.body.sections.length, 2);
  assert.equal(r.body.sections[1].questions[0].text, 'Capitale corrigée ?');
  const incomplete = JSON.parse(JSON.stringify(fixed));
  incomplete[1].questions[0].choices.C = '';
  r = await json(await api('PUT', '/api/parties/Live', { sections: incomplete, overwrite: true }));
  assert.equal(r.body.applied, false);
  assert.match(r.body.warnings.join(' '), /incomplète/);
});

test('image upload sanitizes and dedupes names', async () => {
  let r = await json(await api('POST', `/api/images?filename=${enc('../x.png')}`, Buffer.from('un'), { raw: true }));
  assert.deepEqual(r.body, { ok: true, name: 'x.png' });
  assert.ok(fs.existsSync(path.join(DIRS.images, 'x.png')));
  r = await json(await api('POST', '/api/images?filename=x.png', Buffer.from('un'), { raw: true }));
  assert.equal(r.body.name, 'x.png');
  r = await json(await api('POST', '/api/images?filename=x.png', Buffer.from('deux'), { raw: true }));
  assert.equal(r.body.name, 'x-2.png');
  r = await json(await api('POST', `/api/images?filename=${enc('mon logo é.SVG')}`, Buffer.from('<svg/>'), { raw: true }));
  assert.equal(r.body.name, 'mon_logo__.SVG');
  r = await json(await api('POST', '/api/images?filename=virus.exe', Buffer.from('x'), { raw: true }));
  assert.equal(r.status, 400);
  assert.equal(fs.readdirSync(tmp).filter((f) => f.endsWith('.png')).length, 0);
});

test('video upload and static serving', async () => {
  let r = await json(await api('POST', '/api/videos?filename=a.mp4', Buffer.from('un'), { raw: true }));
  assert.deepEqual(r.body, { ok: true, name: 'a.mp4' });
  const got = await fetch(`${base}/videos/a.mp4`);
  assert.equal(got.status, 200);
  assert.equal(await got.text(), 'un');
  r = await json(await api('POST', '/api/videos?filename=a.txt', Buffer.from('x'), { raw: true }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Format vidéo non accepté (mp4, webm, m4v ou mov).');
  r = await json(await api('POST', '/api/videos?filename=b.mp4', Buffer.alloc(0), { raw: true }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Vidéo vide.');
  r = await api('POST', '/api/videos?filename=a.mp4', Buffer.from('un'), { raw: true, key: null });
  assert.equal(r.status, 403);
  assert.deepEqual(fs.readdirSync(DIRS.videos), ['a.mp4']);
});

test('import stores an uploaded csv', async () => {
  const csv = Buffer.from('manche;type;question;image;A;B;C;D;reponse\nDisney;buzzer\n');
  let r = await json(await api('POST', '/api/parties-import?name=Importée', csv, { raw: true }));
  assert.deepEqual(r.body, { ok: true, name: 'Importée', problems: [] });
  r = await json(await api('POST', '/api/parties-import?name=Cassée', Buffer.from('nom\n'), { raw: true }));
  assert.equal(r.status, 422);
});

// ---------- Corrections de la relecture finale ----------
test('renaming a qcm manche to its neighbour name is refused, server keeps running', async () => {
  const two = [{ name: 'A', type: 'qcm', questions: [Q('1')] }, { name: 'B', type: 'qcm', questions: [Q('2')] }];
  await api('PUT', '/api/parties/Fusion', { sections: two, overwrite: false });
  await api('POST', '/api/parties/Fusion/play', { confirm: true });
  const merged = JSON.parse(JSON.stringify(two));
  merged[1].name = 'A';
  const r = await json(await api('PUT', '/api/parties/Fusion', { sections: merged, overwrite: true }));
  assert.equal(r.status, 422);
  assert.match(r.body.error, /deux manches/i);
  assert.equal((await json(await api('GET', '/api/parties/Fusion'))).body.sections.length, 2);
  assert.equal((await api('GET', '/api/parties')).status, 200);
});

// Un client minimal (protocole socket.io texte via le WebSocket intégré à Node) : se connecte avec `auth`,
// garde les événements reçus et sait en émettre.
function connect(auth) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/socket.io/?EIO=4&transport=websocket`);
    const events = [];
    const client = {
      ws,
      events,
      emit: (name, ...args) => ws.send(`42${JSON.stringify([name, ...args])}`),
      last: (name) => events.findLast((e) => e[0] === name)?.[1],
      close: () => ws.close(),
    };
    ws.onmessage = (m) => {
      const d = String(m.data);
      if (d === '2') ws.send('3');
      else if (d.startsWith('0')) ws.send(`40${JSON.stringify(auth)}`);
      else if (d.startsWith('40')) resolve(client);
      else if (d.startsWith('42')) events.push(JSON.parse(d.slice(2)));
    };
    ws.onerror = reject;
  });
}

// Un téléphone minimal qui rejoint une équipe.
function joinTeam(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/socket.io/?EIO=4&transport=websocket`);
    ws.onmessage = (m) => {
      const d = String(m.data);
      if (d === '2') ws.send('3');
      else if (d.startsWith('0')) ws.send('40{"role":"player"}');
      else if (d.startsWith('40')) ws.send(`421${JSON.stringify(['join', name])}`);
      else if (d.startsWith('431')) resolve(ws);
    };
    ws.onerror = reject;
  });
}

const pause = (ms = 150) => new Promise((r) => setTimeout(r, ms));

test('play asks for confirmation when teams exist', async () => {
  await api('PUT', '/api/parties/Confirm', { sections: SECTIONS, overwrite: false });
  await api('POST', '/api/parties/Confirm/play', { confirm: true });
  const ws = await joinTeam('Loups');
  let r = await json(await api('POST', '/api/parties/Confirm/rename', { to: 'Confirm' }));
  await api('PUT', '/api/parties/Autre', { sections: SECTIONS, overwrite: false });
  r = await json(await api('POST', '/api/parties/Autre/play'));
  assert.equal(r.status, 409);
  assert.equal(r.body.needConfirm, true);
  assert.equal(r.body.teamCount, 1);
  assert.equal((await json(await api('GET', '/api/parties'))).body.current, 'Confirm');
  r = await json(await api('POST', '/api/parties/Autre/play', { confirm: true }));
  assert.equal(r.status, 200);
  ws.close();
});

test('music upload: same content reuses the name, other content gets a suffix', async () => {
  let r = await json(await api('POST', '/api/musiques?filename=a.mp3', Buffer.from('un'), { raw: true }));
  assert.deepEqual([r.status, r.body], [200, { ok: true, name: 'a.mp3' }]);
  r = await json(await api('POST', '/api/musiques?filename=a.mp3', Buffer.from('un'), { raw: true }));
  assert.deepEqual(r.body, { ok: true, name: 'a.mp3' });
  r = await json(await api('POST', '/api/musiques?filename=a.mp3', Buffer.from('deux'), { raw: true }));
  assert.deepEqual(r.body, { ok: true, name: 'a-2.mp3' });
  const res = await fetch(`${base}/musiques/a.mp3`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'un');
});

test('music upload: refused extension, empty body, missing host key', async () => {
  let r = await json(await api('POST', '/api/musiques?filename=a.txt', Buffer.from('x'), { raw: true }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Format audio non accepté (mp3, m4a, aac, ogg, wav ou flac).');
  r = await json(await api('POST', '/api/musiques?filename=b.mp3', Buffer.alloc(0), { raw: true }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Morceau vide.');
  r = await api('POST', '/api/musiques?filename=c.mp3', Buffer.from('x'), { raw: true, key: null });
  assert.equal(r.status, 403);
});

// ---------- Spotify (sans réseau : seules les routes qui ne contactent pas Spotify) ----------
const SPOTIFY_CLIENT = '0123456789abcdef0123456789abcdef';

test('spotify status without configuration', async () => {
  const r = await json(await api('GET', '/api/spotify/status'));
  assert.deepEqual(r, { status: 200, body: { configured: false, connected: false } });
  assert.equal((await api('GET', '/api/spotify/status', null, { key: null })).status, 403);
  const login = await fetch(`${base}/spotify/login?key=${KEY}`, { redirect: 'manual' });
  assert.equal(login.status, 400);
});

test('spotify client id is validated', async () => {
  let r = await json(await api('POST', '/api/spotify/client-id', { clientId: 'abc' }));
  assert.deepEqual(r, { status: 400, body: { error: 'Client ID invalide (32 caractères hexadécimaux).' } });
  r = await json(await api('POST', '/api/spotify/client-id', {}));
  assert.equal(r.status, 400);
  r = await json(await api('POST', '/api/spotify/client-id', { clientId: SPOTIFY_CLIENT }));
  assert.deepEqual(r, { status: 200, body: { ok: true, configured: true, connected: false } });
  assert.deepEqual((await json(await api('GET', '/api/spotify/status'))).body, { configured: true, connected: false });
});

test('spotify login redirects to the authorization page', async () => {
  assert.equal((await fetch(`${base}/spotify/login`, { redirect: 'manual' })).status, 403);
  assert.equal((await fetch(`${base}/spotify/login?key=mauvaise`, { redirect: 'manual' })).status, 403);
  const res = await fetch(`${base}/spotify/login?key=${KEY}&back=creation`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(to.searchParams.get('client_id'), SPOTIFY_CLIENT);
  assert.match(to.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/spotify\/callback$/);
});

test('spotify callback with an unknown state is refused without leaking the key', async () => {
  const res = await fetch(`${base}/spotify/callback?code=x&state=inconnu`, { redirect: 'manual' });
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /relancez/);
  assert.ok(!html.includes(KEY));
});

test('spotify routes refuse when not connected', async () => {
  let r = await json(await api('GET', '/api/spotify/token'));
  assert.deepEqual(r, { status: 401, body: { error: 'Spotify n’est pas connecté.' } });
  r = await json(await api('GET', '/api/spotify/search?q=africa'));
  assert.equal(r.status, 401);
  r = await json(await api('GET', '/api/spotify/tracks/pas-un-id'));
  assert.equal(r.status, 400);
  r = await json(await api('POST', '/api/spotify/disconnect'));
  assert.deepEqual(r, { status: 200, body: { ok: true } });
});

test('play warns when the partie has spotify songs and spotify is not connected', async () => {
  const withSpotify = [{ name: 'Années 80', type: 'buzzer', questions: [], songs: [{ source: 'spotify', ref: '4uLU6hMCjMI75M1A2tKUQC', start: 0, end: 20, answer: 'Africa' }] }];
  await api('PUT', '/api/parties/AvecSpotify', { sections: withSpotify, overwrite: false });
  const r = await json(await api('POST', '/api/parties/AvecSpotify/play', { confirm: true }));
  assert.deepEqual(r, { status: 200, body: { ok: true, warnings: ['Cette partie contient des morceaux Spotify, mais Spotify n’est pas connecté.'] } });
});

test('play warns when a qcm extract uses spotify and spotify is not connected', async () => {
  const extract = { source: 'spotify', ref: '4uLU6hMCjMI75M1A2tKUQC', start: 0, end: 20 };
  const withExtract = [{ name: 'Paroles', type: 'qcm', questions: [{ ...Q('Terminez les paroles'), extract }] }];
  const saved = await json(await api('PUT', '/api/parties/ExtraitSpotify', { sections: withExtract, overwrite: false }));
  assert.equal(saved.status, 200);
  const r = await json(await api('POST', '/api/parties/ExtraitSpotify/play', { confirm: true }));
  assert.deepEqual(r, { status: 200, body: { ok: true, warnings: ['Cette partie contient des morceaux Spotify, mais Spotify n’est pas connecté.'] } });
});

test('only the loopback screen reads', async () => {
  fs.mkdirSync(DIRS.videos, { recursive: true });
  fs.writeFileSync(path.join(DIRS.videos, 'clip.mp4'), 'x');
  const sections = [{ name: 'Clips', type: 'buzzer', questions: [], songs: [{ source: 'video', ref: 'clip.mp4', start: 0, end: 20, answer: 'Thriller' }] }];
  await api('PUT', '/api/parties/Clips', { sections, overwrite: false });
  assert.equal((await api('POST', '/api/parties/Clips/play', { confirm: true })).status, 200);

  const host = await connect({ role: 'host', key: KEY });
  const screen = await connect({ role: 'screen' });
  await pause();
  assert.equal(screen.last('state').reader, true);
  assert.deepEqual(host.last('video'), { reader: true, unlocked: false, key: null, pos: null, error: null });

  host.emit('host:open');
  await pause();
  const video = screen.last('state').song.video;
  assert.equal(video.media.ref, 'clip.mp4');
  assert.equal(video.seq, 1);

  // La Régie ne termine pas un passage vidéo ; hors étape Jeu, le Grand écran non plus.
  host.emit('host:ended', { seq: 1 });
  screen.emit('screen:ended', { seq: 1 });
  await pause();
  assert.equal(screen.last('state').song.video.audible, true);
  host.emit('host:stage', { stage: 'play' });
  await pause();
  host.emit('host:ended', { seq: 1 });
  await pause();
  assert.equal(screen.last('state').song.video.audible, true);

  screen.emit('screen:video', { unlocked: true, key: video.key, pos: 3.5, error: null });
  screen.emit('screen:video', { unlocked: 'oui', key: 5, pos: 'x', error: null });   // ignoré
  await pause();
  assert.deepEqual(host.last('video'), { reader: true, unlocked: true, key: video.key, pos: 3.5, error: null });

  screen.emit('screen:ended', { seq: 1 });
  await pause();
  assert.equal(screen.last('state').song.video.audible, false);

  // Une Régie qui arrive ensuite reçoit le dernier statut ; sans lecteur, il est remis à zéro.
  const host2 = await connect({ role: 'host', key: KEY });
  await pause();
  assert.equal(host2.last('video').unlocked, true);
  screen.close();
  await pause();
  assert.deepEqual(host.last('video'), { reader: false, unlocked: false, key: null, pos: null, error: null });
  host.close();
  host2.close();
});
