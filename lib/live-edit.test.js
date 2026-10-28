const test = require('node:test');
const assert = require('node:assert/strict');
const { checkLiveEdit } = require('./live-edit');

const Q = (text, answer = 'B') => ({ text, image: null, choices: { A: 'a', B: 'b', C: 'c', D: 'd' }, answer });
const OLD = [
  { name: 'Cinéma', type: 'buzzer', questions: [] },
  { name: 'Culture G', type: 'qcm', questions: [Q('Q1'), Q('Q2'), Q('Q3')] },
];
const clone = (x) => JSON.parse(JSON.stringify(x));
const fresh = () => [{ index: 0, revealed: false }, { index: 0, revealed: false }];
const check = (newSections, { progress = fresh(), currentSection = 0, qcmStep = 'idle' } = {}) =>
  checkLiveEdit({ oldSections: OLD, newSections, progress, currentSection, qcmStep });
const refused = (res, re) => { assert.equal(res.ok, false); assert.match(res.error, /^Modification impossible pendant la partie : /); assert.match(res.error, re); assert.match(res.error, /Enregistrer sous/); };

test('accepts text, choice, image and section name corrections', () => {
  const s = clone(OLD);
  s[0].name = 'Cinéma 2';
  s[1].questions[0].text = 'Q1 corrigée';
  s[1].questions[1].choices.C = 'autre';
  s[1].questions[2].image = 'x.png';
  assert.deepEqual(check(s, { progress: [{ index: 0, revealed: false }, { index: 2, revealed: false }], currentSection: 1 }), { ok: true, warnings: [] });
});

test('accepts appended sections and appended questions', () => {
  const s = clone(OLD);
  s[1].questions.push(Q('Q4'));
  s.push({ name: 'Disney', type: 'buzzer', questions: [] });
  assert.deepEqual(check(s, { progress: [{ index: 0, revealed: false }, { index: 3, revealed: false }], currentSection: 1 }), { ok: true, warnings: [] });
});

test('refuses removing a section', () => {
  refused(check([clone(OLD)[0]]), /manche/);
});

test('refuses reordering sections', () => {
  const s = clone(OLD).reverse();
  refused(check(s), /manche/);
});

test('refuses changing a section type', () => {
  const s = clone(OLD);
  s[0].type = 'qcm';
  refused(check(s), /type/);
});

test('refuses removing a question in a started qcm section', () => {
  const s = clone(OLD);
  s[1].questions.splice(2, 1);
  refused(check(s, { progress: [{ index: 0, revealed: false }, { index: 1, revealed: false }] }), /question/);
});

test('refuses reordering questions in a started qcm section', () => {
  const s = clone(OLD);
  s[1].questions = [s[1].questions[1], s[1].questions[0], s[1].questions[2]];
  refused(check(s, { progress: fresh(), currentSection: 1, qcmStep: 'question' }), /question/);
});

test('allows reordering and removing questions before the first is shown', () => {
  const s = clone(OLD);
  s[1].questions = [s[1].questions[2], s[1].questions[0]];
  assert.equal(check(s, { progress: fresh(), currentSection: 1, qcmStep: 'idle' }).ok, true);
});

test('warns when a revealed answer changes', () => {
  const s = clone(OLD);
  s[1].questions[0].answer = 'C';   // déjà passée
  s[1].questions[1].answer = 'D';   // révélée, en cours
  s[1].questions[2].answer = 'A';   // pas encore jouée : pas d'alerte
  const res = check(s, { progress: [{ index: 0, revealed: false }, { index: 1, revealed: true }], currentSection: 1, qcmStep: 'revealed' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.warnings, [
    'Culture G, question 1 : la bonne réponse a changé après révélation, corrigez les points avec +/− si besoin.',
    'Culture G, question 2 : la bonne réponse a changé après révélation, corrigez les points avec +/− si besoin.',
  ]);
});

// ---------- Identité des manches et questions (orig = position dans la version chargée) ----------
test('refuses an inserted section followed by a renamed one', () => {
  const s = clone(OLD).map((x, i) => ({ ...x, orig: i }));
  s.splice(1, 0, { name: 'Nouvelle', type: 'qcm', questions: [] });
  s[2].name = 'Culture G renommée';
  refused(check(s), /ordre des manches/);
});

test('refuses a deleted last section replaced by a new one of the same type', () => {
  const s = clone(OLD).map((x, i) => ({ ...x, orig: i }));
  s[1] = { name: 'Autre', type: 'qcm', questions: [Q('X')] };
  refused(check(s), /supprimée/);
});

test('accepts sections and questions carrying their original position', () => {
  const s = clone(OLD).map((x, i) => ({ ...x, orig: i, questions: x.questions.map((q, k) => ({ ...q, orig: k })) }));
  s[1].questions.push(Q('Q4'));
  assert.deepEqual(check(s, { progress: [{ index: 0, revealed: false }, { index: 1, revealed: false }] }), { ok: true, warnings: [] });
});

test('refuses a replaced question in a started qcm section', () => {
  const s = clone(OLD).map((x, i) => ({ ...x, orig: i, questions: x.questions.map((q, k) => ({ ...q, orig: k })) }));
  s[1].questions.splice(0, 1, Q('Q1 bis'));
  refused(check(s, { progress: [{ index: 1, revealed: false }, { index: 1, revealed: false }] }), /question/);
});
