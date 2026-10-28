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
const DIRS = { parties: path.join(tmp, 'parties'), images: path.join(tmp, 'images') };
fs.mkdirSync(DIRS.images);
let base, child;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

test.before(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST_KEY: KEY, SCORES_FILE: path.join(tmp, 'scores.json'), IMAGES_DIR: DIRS.images, PARTIES_DIR: DIRS.parties },
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
  { name: 'Cinéma', type: 'buzzer', questions: [] },
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
  assert.deepEqual(r, { status: 200, body: { ok: true } });
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

test('import stores an uploaded csv', async () => {
  const csv = Buffer.from('manche;type;question;image;A;B;C;D;reponse\nDisney;buzzer\n');
  let r = await json(await api('POST', '/api/parties-import?name=Importée', csv, { raw: true }));
  assert.deepEqual(r.body, { ok: true, name: 'Importée', problems: [] });
  r = await json(await api('POST', '/api/parties-import?name=Cassée', Buffer.from('nom\n'), { raw: true }));
  assert.equal(r.status, 422);
});
