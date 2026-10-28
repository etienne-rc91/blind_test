const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSections, isSafeImageName } = require('./game-file');

const HEADER = ['manche', 'type', 'question', 'image', 'A', 'B', 'C', 'D', 'reponse'];
const buzzer = (name) => [name, 'buzzer', '', '', '', '', '', '', ''];
const qcm = (name, q = 'Capitale ?', image = '', answer = 'B') => [name, 'qcm', q, image, 'Sydney', 'Canberra', 'Melbourne', 'Perth', answer];
const images = new Set(['acteur1.jpg']);
const build = (...rows) => buildSections([HEADER, ...rows], { imageExists: (n) => images.has(n) });
const failsOn = (res, re) => { assert.equal(res.ok, false); assert.match(res.error, re); };

test('builds buzzer sections in file order', () => {
  const res = build(buzzer('Cinéma'), buzzer(' Années 80 '));
  assert.deepEqual(res, { ok: true, sections: [
    { name: 'Cinéma', type: 'buzzer', questions: [], songs: [] },
    { name: 'Années 80', type: 'buzzer', questions: [], songs: [] },
  ] });
});

test('accepts header in any case and short buzzer rows', () => {
  const res = buildSections([HEADER.map((h) => h.toUpperCase()), ['Cinéma', 'Buzzer']], { imageExists: () => false });
  assert.equal(res.ok, true);
});

test('builds buzzer and qcm sections in file order', () => {
  const res = build(buzzer('Cinéma'), qcm('Culture G'), qcm('Culture G', '', 'acteur1.jpg', 'c'), buzzer('Années 80'));
  assert.equal(res.ok, true);
  assert.deepEqual(res.sections.map((s) => [s.name, s.type, s.questions.length]), [['Cinéma', 'buzzer', 0], ['Culture G', 'qcm', 2], ['Années 80', 'buzzer', 0]]);
  assert.deepEqual(res.sections[1].questions[1], {
    text: '', image: 'acteur1.jpg', choices: { A: 'Sydney', B: 'Canberra', C: 'Melbourne', D: 'Perth' }, answer: 'C',
  });
  assert.equal(res.sections[1].questions[0].image, null);
});

test('rejects a wrong header', () => {
  failsOn(buildSections([['nom', 'type'], buzzer('A')], { imageExists: () => true }), /^Ligne 1 :/);
});

test('rejects an empty file', () => {
  failsOn(buildSections([], { imageExists: () => true }), /vide/);
  failsOn(build(), /aucune manche/i);
});

test('rejects an empty section name', () => {
  failsOn(build(buzzer('A'), buzzer('')), /^Ligne 3 :/);
});

test('rejects an unknown type', () => {
  failsOn(build(['A', 'quiz']), /^Ligne 2 : .*type/);
});

test('rejects a buzzer section on several lines', () => {
  failsOn(build(buzzer('A'), buzzer('A')), /^Ligne 3 :/);
});

test('rejects a section name that comes back later', () => {
  failsOn(build(buzzer('Cinéma'), buzzer('Années 80'), buzzer('Cinéma')), /^Ligne 4 : la manche « Cinéma » apparaît déjà plus haut\./);
});

test('rejects one section name with two types', () => {
  failsOn(build(qcm('A'), buzzer('A')), /^Ligne 3 :/);
});

test('rejects a qcm question with neither text nor image', () => {
  failsOn(build(qcm('A', '', '')), /^Ligne 2 :/);
});

test('rejects an empty choice', () => {
  const row = qcm('A'); row[6] = ' ';
  failsOn(build(row), /^Ligne 2 : .*C/);
});

test('rejects an invalid answer', () => {
  failsOn(build(qcm('A', 'Q', '', 'E')), /^Ligne 2 : la réponse doit être A, B, C ou D\./);
});

test('rejects a missing image', () => {
  failsOn(build(qcm('A', '', 'absente.jpg')), /^Ligne 2 : image « absente\.jpg » introuvable dans le dossier images\/\./);
});

test('rejects a dangerous image name', () => {
  failsOn(build(qcm('A', '', '../server.js')), /^Ligne 2 :/);
});

test('isSafeImageName refuses paths', () => {
  assert.equal(isSafeImageName('acteur1.jpg'), true);
  for (const bad of ['', '..', '../a.jpg', 'a/b.jpg', 'a\\b.jpg', '.hidden']) assert.equal(isSafeImageName(bad), false, bad);
});

test('a 9-column header with an unrelated 10th cell is accepted', () => {
  const res = buildSections([[...HEADER, 'Notes'], buzzer('Cinéma')], { imageExists: () => true });
  assert.equal(res.ok, true);
});

test('columns after the 9th are ignored under a 9-column header', () => {
  const res = buildSections([HEADER, [...buzzer('Cinéma'), 'a.mp3', '0', '5']], { imageExists: () => true });
  assert.deepEqual(res, { ok: true, sections: [{ name: 'Cinéma', type: 'buzzer', questions: [], songs: [] }] });
});

test('a 12-column header must be exactly musique;debut;fin', () => {
  failsOn(buildSections([[...HEADER, 'musique', 'x', 'fin'], buzzer('A')], { imageExists: () => true }), /^Ligne 1 :/);
});

// ---------- Écriture CSV et brouillons ----------
const { writeCsv } = require('./game-file');
const { parseCsv, decodeCsvBytes } = require('./csv');
const Qf = (text, image, answer, choices = { A: 'a', B: 'b', C: 'c', D: 'd' }) => ({ text, image, choices, answer });
const FULL = [
  { name: 'Ciné; « 80 »', type: 'buzzer', questions: [], songs: [] },
  { name: 'Culture G', type: 'qcm', questions: [
    Qf('Il a dit "oui"\nensuite ?', null, 'B', { A: 'Sydney; NSW', B: 'Canberra', C: 'Mel"bourne', D: 'Perth' }),
    Qf('', 'acteur1.jpg', 'D'),
  ] },
];
const readBack = (text, draft = false) => buildSections(parseCsv(decodeCsvBytes(Buffer.from(text, 'utf8'))), { imageExists: (n) => images.has(n), draft });

test('writeCsv round-trips through parseCsv and buildSections', () => {
  assert.deepEqual(readBack(writeCsv(FULL)), { ok: true, sections: FULL });
});

test('writeCsv starts with a BOM and the standard header', () => {
  const csv = writeCsv(FULL);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.slice(1).split('\r\n')[0], 'manche;type;question;image;A;B;C;D;reponse;musique;debut;fin');
});

test('written csv survives a windows-1252 re-save', () => {
  const secs = [{ name: 'Années 80', type: 'qcm', questions: [Qf('L’été « déjà » ?', null, 'A', { A: 'é', B: 'è', C: 'à', D: 'ç' })] }];
  const text = writeCsv(secs).slice(1);
  const cp = { '’': 0x92, '«': 0xab, '»': 0xbb, 'é': 0xe9, 'è': 0xe8, 'à': 0xe0, 'ç': 0xe7, ' ': 0xa0 };
  const bytes = Buffer.from([...text].map((c) => cp[c] ?? c.charCodeAt(0)));
  assert.deepEqual(buildSections(parseCsv(decodeCsvBytes(bytes)), { imageExists: () => true }), { ok: true, sections: secs });
});

test('draft mode keeps incomplete questions and lists problems', () => {
  const res = buildSections([HEADER,
    ['Culture G', 'qcm', 'Q1', '', 'a', 'b', '', 'd', 'B'],
    ['Culture G', 'qcm', 'Q2', '', 'a', 'b', 'c', 'd', ''],
    ['Culture G', 'qcm', '', 'absente.jpg', 'a', 'b', 'c', 'd', 'A'],
  ], { imageExists: () => false, draft: true });
  assert.equal(res.ok, true);
  assert.equal(res.sections[0].questions.length, 3);
  assert.equal(res.sections[0].questions[1].answer, null);
  assert.deepEqual(res.problems, [
    'Culture G, question 1 : proposition C vide',
    'Culture G, question 2 : bonne réponse non choisie',
    'Culture G, question 3 : image « absente.jpg » introuvable',
  ]);
});

test('draft mode accepts an empty qcm section and an empty file', () => {
  const empty = { name: 'Culture G', type: 'qcm', questions: [] };
  const res = readBack(writeCsv([empty]), true);
  assert.deepEqual(res.sections, [empty]);
  assert.deepEqual(res.problems, ['Culture G : aucune question']);
  const none = readBack(writeCsv([]), true);
  assert.deepEqual(none, { ok: true, sections: [], problems: ['Aucune manche'] });
});

test('draft mode still rejects structural errors', () => {
  const res = buildSections([HEADER, ['A', 'quiz']], { imageExists: () => true, draft: true });
  assert.equal(res.ok, false);
  assert.match(res.error, /^Ligne 2 :/);
});

test('strict mode refuses an empty qcm declaration row', () => {
  assert.equal(readBack(writeCsv([{ name: 'X', type: 'qcm', questions: [] }])).ok, false);
});

// ---------- Corrections de la relecture finale ----------
test('draft mode keeps empty questions placed among others', () => {
  const s = [{ name: 'Culture G', type: 'qcm', questions: [Qf('Q1', null, 'B'), Qf('', null, null, { A: '', B: '', C: '', D: '' })] }];
  const res = readBack(writeCsv(s), true);
  assert.equal(res.sections[0].questions.length, 2);
  assert.ok(res.problems.includes('Culture G, question 2 : question vide'));
});

// --- Morceaux (colonnes musique, debut, fin) ---
const HEADER12 = [...HEADER, 'musique', 'debut', 'fin'];
const song = (name, music, start, end, answer) => [name, 'buzzer', '', '', '', '', '', '', answer, music, start, end];
const musics = new Set(['a.mp3']);
const SPOT = '4uLU6hMCjMI75M1A2tKUQC';
const build12 = (rows, opts = {}) => buildSections([HEADER12, ...rows], { imageExists: () => true, musicExists: (n) => musics.has(n), ...opts });

test('accepts the 9-column header', () => {
  const res = build(buzzer('Cinéma'));
  assert.equal(res.ok, true);
  assert.deepEqual(res.sections[0].songs, []);
  assert.equal(build12([buzzer('Cinéma')]).ok, true);
});

test('builds a buzzer section with songs', () => {
  const res = build12([song('Années 80', 'a.mp3', '0:30', '1:00', ' Thriller '), song('Années 80', `spotify:track:${SPOT}`, '15', '45', 'Africa')]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.sections[0].songs, [
    { source: 'file', ref: 'a.mp3', start: 30, end: 60, answer: 'Thriller' },
    { source: 'spotify', ref: SPOT, start: 15, end: 45, answer: 'Africa' },
  ]);
});

test('spotify songs never call musicExists', () => {
  const res = build12([song('X', `spotify:track:${SPOT}`, '0', '5', 'a')], { musicExists: () => { throw new Error('called'); } });
  assert.equal(res.ok, true);
});

test('strict mode fails on a missing music file', () => {
  failsOn(build12([song('X', 'b.mp3', '0', '5', 'a')]), /^Ligne 2 : .*b\.mp3/);
});

test('strict mode fails on the first missing item of a song', () => {
  failsOn(build12([song('X', '', '0', '5', 'a')]), /^Ligne 2 : .*musique/);
  failsOn(build12([song('X', 'a.mp3', '', '5', 'a')]), /^Ligne 2 : .*début/);
  failsOn(build12([song('X', 'a.mp3', '0', '', 'a')]), /^Ligne 2 : .*fin/);
  failsOn(build12([song('X', 'a.mp3', '9', '5', 'a')]), /^Ligne 2 : .*fin.*avant/);
  failsOn(build12([song('X', 'a.mp3', '0', '5', '')]), /^Ligne 2 : .*réponse/);
});

test('an unreadable music cell is a structure error even in draft', () => {
  failsOn(build12([song('X', '../a.mp3', '0', '5', 'a')], { draft: true }), /^Ligne 2 : morceau « \.\.\/a\.mp3 » invalide : nom de fichier du dossier musiques\/ ou lien Spotify\.$/);
});

test('draft lists song problems', () => {
  const res = build12([song('Années 80', 'a.mp3', '1:00', '0:30', 'x'), song('Années 80', '', '', '', 'y'), song('Années 80', 'z.mp3', '0', '5', '')], { draft: true });
  assert.equal(res.ok, true);
  assert.deepEqual(res.problems, [
    'Années 80, morceau 1 : fin avant le début',
    'Années 80, morceau 2 : musique vide',
    'Années 80, morceau 2 : début manquant',
    'Années 80, morceau 2 : fin manquante',
    'Années 80, morceau 3 : fichier « z.mp3 » introuvable',
    'Années 80, morceau 3 : réponse vide',
  ]);
  assert.equal(res.sections[0].songs.length, 3);
});

test('blank buzzer row after a song row is an error', () => {
  failsOn(build12([song('X', 'a.mp3', '0', '5', 'a'), buzzer('X')], { draft: true }), /^Ligne 3 : la manche buzzer « X » : chaque ligne suivante doit décrire un morceau \(colonne musique\)\.$/);
});

test('writeCsv round-trips songs', () => {
  const sections = [
    { name: 'Libre', type: 'buzzer', questions: [], songs: [] },
    { name: 'Années 80', type: 'buzzer', questions: [], songs: [
      { source: 'file', ref: 'a.mp3', start: 30, end: 75, answer: 'Thriller; Michael' },
      { source: 'spotify', ref: SPOT, start: 0, end: 20, answer: 'Africa' },
    ] },
    { name: 'Culture', type: 'qcm', questions: [{ text: 'Q ?', image: null, choices: { A: 'a', B: 'b', C: 'c', D: 'd' }, answer: 'B' }] },
  ];
  const csv = writeCsv(sections);
  assert.ok(csv.split('\r\n')[0].endsWith('reponse;musique;debut;fin'));
  const back = buildSections(parseCsv(csv.slice(1)), { imageExists: () => true, musicExists: () => true });
  assert.deepEqual(back, { ok: true, sections });
});
