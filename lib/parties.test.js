const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPartiesStore, cleanPartieName } = require('./parties');
const { writeCsv } = require('./game-file');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'parties-'));
const store = (dir = tmp()) => ({ dir, s: createPartiesStore({ dir, imageExists: () => true }) });
const Q = (text, answer = 'B') => ({ text, image: null, choices: { A: 'a', B: 'b', C: 'c', D: 'd' }, answer });
const SECTIONS = [
  { name: 'Cinéma', type: 'buzzer', questions: [], songs: [] },
  { name: 'Culture G', type: 'qcm', questions: [Q('Capitale ?')] },
];

test('cleanPartieName rejects bad names', () => {
  for (const bad of ['', '   ', 'a/b', 'a\\b', '.x', 'x'.repeat(61), 'a:b', 'a?', 'a\u0007', 42, null]) {
    assert.equal(cleanPartieName(bad), null, String(bad));
  }
  assert.equal(cleanPartieName('  Soirée  '), 'Soirée');
  assert.equal(cleanPartieName('Soirée'), 'Soirée');   // NFD → NFC
});

test('save then list and read a partie', () => {
  const { s } = store();
  assert.deepEqual(s.save('Soirée Ciné', SECTIONS, { overwrite: false }), { ok: true, name: 'Soirée Ciné', problems: [] });
  const [item] = s.list();
  assert.equal(item.name, 'Soirée Ciné');
  assert.deepEqual(item.sections, [{ name: 'Cinéma', type: 'buzzer', questionCount: 0, songCount: 0, spotifyCount: 0 }, { name: 'Culture G', type: 'qcm', questionCount: 1, songCount: 0, spotifyCount: 0 }]);
  assert.ok(item.mtime > 0);
  assert.deepEqual(s.read('Soirée Ciné'), { ok: true, name: 'Soirée Ciné', sections: SECTIONS, problems: [] });
});

test('names are NFC-normalized and unique ignoring case', () => {
  const { dir, s } = store();
  fs.writeFileSync(path.join(dir, 'Soirée.csv'), writeCsv(SECTIONS));   // nom de fichier décomposé (macOS)
  const r = s.read('Soirée');
  assert.equal(r.ok, true);
  assert.equal(r.name, 'Soirée');
  assert.equal(s.list()[0].name, 'Soirée');
  assert.equal(s.save('SOIRÉE', SECTIONS, { overwrite: false }).status, 409);
});

test('save without overwrite refuses an existing name, with overwrite replaces it', () => {
  const { s } = store();
  s.save('A', SECTIONS, { overwrite: false });
  const res = s.save('a', SECTIONS, { overwrite: false });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.match(res.error, /déjà ce nom/);
  assert.equal(s.save('A', [SECTIONS[0]], { overwrite: true }).ok, true);
  assert.equal(s.read('A').sections.length, 1);
  assert.equal(s.list().length, 1);
});

test('save refuses an invalid name or an invalid section list', () => {
  const { s } = store();
  assert.equal(s.save('a/b', SECTIONS, { overwrite: false }).status, 400);
  assert.equal(s.save('A', [{ name: '', type: 'buzzer', questions: [] }], { overwrite: false }).status, 422);
  assert.equal(s.save('A', 'nope', { overwrite: false }).status, 422);
  assert.equal(s.list().length, 0);
});

test('rename moves the file and refuses an existing target', () => {
  const { s } = store();
  s.save('A', SECTIONS, { overwrite: false });
  s.save('B', SECTIONS, { overwrite: false });
  assert.equal(s.rename('A', 'b').status, 409);
  assert.deepEqual(s.rename('A', 'C'), { ok: true, name: 'C' });
  assert.deepEqual(s.list().map((p) => p.name), ['B', 'C']);
  assert.equal(s.rename('Z', 'Y').status, 404);
});

test('rename can change only the case of a name', () => {
  const { s } = store();
  s.save('soirée', SECTIONS, { overwrite: false });
  assert.deepEqual(s.rename('soirée', 'Soirée'), { ok: true, name: 'Soirée' });
  assert.deepEqual(s.list().map((p) => p.name), ['Soirée']);
});

test('remove deletes the file and read of a missing partie is 404', () => {
  const { s } = store();
  s.save('A', SECTIONS, { overwrite: false });
  assert.deepEqual(s.remove('a'), { ok: true });
  assert.equal(s.read('A').status, 404);
  assert.equal(s.remove('A').status, 404);
});

test('importCsv stores a valid excel export and refuses a structurally broken one', () => {
  const { s } = store();
  const cp = Buffer.from([...'manche;type;question;image;A;B;C;D;reponse\r\nCinéma;buzzer\r\n'].map((c) => (c === 'é' ? 0xe9 : c.charCodeAt(0))));
  assert.deepEqual(s.importCsv('Excel', cp), { ok: true, name: 'Excel', problems: [] });
  assert.equal(s.read('Excel').sections[0].name, 'Cinéma');
  const bad = s.importCsv('Cassé', Buffer.from('nom;type\nA;buzzer\n'));
  assert.equal(bad.status, 422);
  assert.match(bad.error, /^Ligne 1/);
  assert.equal(s.importCsv('Excel', cp).status, 409);
});

test('list shows problems for an incomplete partie and error for a broken file', () => {
  const { dir, s } = store();
  s.save('Brouillon', [{ name: 'Culture G', type: 'qcm', questions: [] }], { overwrite: false });
  fs.writeFileSync(path.join(dir, 'Cassé.csv'), 'nom;type\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'pas une partie');
  const list = s.list();
  assert.deepEqual(list.map((p) => p.name), ['Brouillon', 'Cassé']);
  assert.deepEqual(list[0].problems, ['Culture G : aucune question']);
  assert.match(list[1].error, /^Ligne 1/);
});

test('the folder is created if missing', () => {
  const dir = path.join(tmp(), 'sous', 'parties');
  const s = createPartiesStore({ dir, imageExists: () => true });
  assert.deepEqual(s.list(), []);
  assert.ok(fs.existsSync(dir));
});

// ---------- Corrections de la relecture finale ----------
test('save refuses two manches with the same name', () => {
  const { s } = store();
  const dup = [{ name: 'A', type: 'qcm', questions: [Q('1')] }, { name: 'a', type: 'qcm', questions: [Q('2')] }];
  const res = s.save('P', dup, { overwrite: false });
  assert.equal(res.status, 422);
  assert.match(res.error, /deux manches portent le nom « a »/i);
  assert.equal(s.save('P', [{ name: ' ', type: 'buzzer', questions: [] }], { overwrite: false }).status, 422);
});

test('overwrite of a partie that no longer exists is refused', () => {
  const { s } = store();
  const res = s.save('Disparue', SECTIONS, { overwrite: true });
  assert.equal(res.status, 404);
  assert.match(res.error, /renommée ou supprimée entre-temps/);
  assert.equal(s.list().length, 0);
});

test('prepare returns the sections exactly as they will be read back', () => {
  const { s } = store();
  const res = s.prepare([{ name: ' Ciné ', type: 'buzzer', questions: [], orig: 0, extra: 'x' }]);
  assert.deepEqual(res, { ok: true, sections: [{ name: 'Ciné', type: 'buzzer', questions: [], songs: [] }], problems: [] });
});

const SONGS_SECTIONS = [{ name: 'Années 80', type: 'buzzer', questions: [], songs: [
  { source: 'file', ref: 'a.mp3', start: 30, end: 60, answer: 'Thriller' },
  { source: 'spotify', ref: '4uLU6hMCjMI75M1A2tKUQC', start: 0, end: 20, answer: 'Africa' },
] }];

test('save and read keep songs', () => {
  const { s } = store();
  assert.equal(s.save('Musique', SONGS_SECTIONS, { overwrite: false }).ok, true);
  assert.deepEqual(s.read('Musique').sections, SONGS_SECTIONS);
});

test('list reports songCount and spotifyCount', () => {
  const { s } = store();
  s.save('Musique', SONGS_SECTIONS, { overwrite: false });
  assert.deepEqual(s.list()[0].sections, [{ name: 'Années 80', type: 'buzzer', questionCount: 0, songCount: 2, spotifyCount: 1 }]);
});

test('entirely empty songs are dropped when saving', () => {
  const { s } = store();
  const empty = { source: null, ref: null, start: null, end: null, answer: ' ' };
  const sections = [{ ...SONGS_SECTIONS[0], songs: [SONGS_SECTIONS[0].songs[0], empty] }];
  assert.equal(s.save('Vide', sections, { overwrite: false }).ok, true);
  assert.deepEqual(s.read('Vide').sections[0].songs, [SONGS_SECTIONS[0].songs[0]]);
});
