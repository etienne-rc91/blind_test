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
    { name: 'Cinéma', type: 'buzzer', questions: [] },
    { name: 'Années 80', type: 'buzzer', questions: [] },
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

// ---------- Écriture CSV et brouillons ----------
const { writeCsv } = require('./game-file');
const { parseCsv, decodeCsvBytes } = require('./csv');
const Qf = (text, image, answer, choices = { A: 'a', B: 'b', C: 'c', D: 'd' }) => ({ text, image, choices, answer });
const FULL = [
  { name: 'Ciné; « 80 »', type: 'buzzer', questions: [] },
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
  assert.equal(csv.slice(1).split('\r\n')[0], 'manche;type;question;image;A;B;C;D;reponse');
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
