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
