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

// ---------- Manches avec morceaux ----------
const S = (i, extra = {}) => ({ source: 'file', ref: `morceau-${i}.mp3`, start: 5, end: 35, answer: `Titre ${i}`, ...extra });
const SONG_OLD = [
  { name: 'Libre', type: 'buzzer', questions: [], songs: [] },
  { name: 'Musique', type: 'buzzer', questions: [], songs: [S(0), S(1), S(2)] },
];
const songCheck = (newSections, { progress, currentSection = 1, roundOpenedInSection = true, currentSectionScored = false } = {}) =>
  checkLiveEdit({ oldSections: SONG_OLD, newSections, progress: progress || [{ index: 0, revealed: false }, { index: 2, revealed: false }], currentSection, qcmStep: 'idle', roundOpenedInSection, currentSectionScored });
const NOTHING_PLAYED = () => [{ index: 0, revealed: false }, { index: 0, revealed: false }];

test('refuses switching a played free section to songs', () => {
  const s = clone(SONG_OLD);
  s[0].songs = [S(9)];
  refused(songCheck(s, { currentSection: 0 }), /le mode de la manche « Libre » a changé/);
});

test('allows switching the current section mode right after Jouer', () => {
  const s = clone(SONG_OLD);
  s[0].songs = [S(9)];
  assert.equal(songCheck(s, { currentSection: 0, progress: NOTHING_PLAYED(), roundOpenedInSection: false }).ok, true);
  const t = clone(SONG_OLD);
  t[1].songs = [];
  assert.equal(songCheck(t, { currentSection: 1, progress: NOTHING_PLAYED(), roundOpenedInSection: false }).ok, true);
});

test('refuses switching the current section mode once a song was launched', () => {
  const t = clone(SONG_OLD);
  t[1].songs = [];
  refused(songCheck(t, { currentSection: 1, progress: [{ index: 0, revealed: false }, { index: 1, revealed: false }], roundOpenedInSection: false }), /le mode de la manche « Musique » a changé/);
  refused(songCheck(t, { currentSection: 1, progress: NOTHING_PLAYED(), roundOpenedInSection: true }), /le mode de la manche « Musique » a changé/);
});

test('refuses switching the current section mode once a point was given in it', () => {
  const s = clone(SONG_OLD);
  s[0].songs = [S(9)];
  refused(songCheck(s, { currentSection: 0, progress: NOTHING_PLAYED(), roundOpenedInSection: false, currentSectionScored: true }), /le mode de la manche « Libre » a changé/);
});

test('still refuses switching the mode of an earlier section, even untouched', () => {
  const s = clone(SONG_OLD);
  s[0].songs = [S(9)];
  refused(songCheck(s, { currentSection: 1, progress: NOTHING_PLAYED(), roundOpenedInSection: false }), /le mode de la manche « Libre » a changé/);
});

test('without live round info, the current section counts as started', () => {
  const s = clone(SONG_OLD);
  s[0].songs = [S(9)];
  refused(checkLiveEdit({ oldSections: SONG_OLD, newSections: s, progress: NOTHING_PLAYED(), currentSection: 0, qcmStep: 'idle' }), /le mode de la manche « Libre » a changé/);
});

test('refuses switching a played section with songs to free', () => {
  const s = clone(SONG_OLD);
  s[1].songs = [];
  refused(songCheck(s), /le mode de la manche « Musique » a changé/);
});

test('allows switching the mode of a section not reached yet', () => {
  const s = clone(SONG_OLD);
  s[1].songs = [];
  assert.equal(songCheck(s, { currentSection: 0, progress: [{ index: 0, revealed: false }, { index: 0, revealed: false }] }).ok, true);
});

test('refuses reordering songs of a started section', () => {
  const s = clone(SONG_OLD);
  s[1].songs = [s[1].songs[1], s[1].songs[0], s[1].songs[2]];
  refused(songCheck(s), /la source du morceau 1/);
  const o = clone(SONG_OLD);
  o[1].songs = [S(1, { orig: 1 }), S(0, { orig: 0 }), S(2, { orig: 2 })];
  refused(songCheck(o), /l’ordre des morceaux de la manche « Musique » a changé/);
});

test('refuses deleting a song of a started section', () => {
  const s = clone(SONG_OLD);
  s[1].songs.pop();
  refused(songCheck(s), /un morceau de la manche « Musique » a été supprimé/);
  const o = clone(SONG_OLD);
  o[1].songs = [S(0, { orig: 0 }), S(1, { orig: 1 }), S(7)];
  refused(songCheck(o), /un morceau de la manche « Musique » a été supprimé ou remplacé/);
});

test('accepts fixing the answer of a played song', () => {
  const s = clone(SONG_OLD);
  s[1].songs[0].answer = 'Titre corrigé';
  s[1].songs[1].start = 10;
  s[1].songs[1].end = 40;
  assert.deepEqual(songCheck(s), { ok: true, warnings: [] });
});

test('refuses changing the source of a played song', () => {
  const s = clone(SONG_OLD);
  s[1].songs[1].ref = 'autre.mp3';
  refused(songCheck(s), /la source du morceau 2 de la manche « Musique » a changé/);
  const t = clone(SONG_OLD);
  t[1].songs[0].source = 'spotify';
  refused(songCheck(t), /la source du morceau 1 de la manche « Musique » a changé/);
});

test('allows changing the source of a song not played yet', () => {
  const s = clone(SONG_OLD);
  s[1].songs[2].ref = 'autre.mp3';
  assert.equal(songCheck(s).ok, true);
});

test('accepts appending songs', () => {
  const s = clone(SONG_OLD);
  s[1].songs.push(S(3), S(4));
  assert.deepEqual(songCheck(s), { ok: true, warnings: [] });
});

test('allows reordering songs before the first one is played', () => {
  const s = clone(SONG_OLD);
  s[1].songs = [s[1].songs[2], s[1].songs[0]];
  assert.equal(songCheck(s, { progress: [{ index: 0, revealed: false }, { index: 0, revealed: false }] }).ok, true);
});

// --- Extraits des questions QCM ---
const EX = (ref = 'a.mp3', start = 0, end = 10) => ({ source: 'file', ref, start, end });
const withExtracts = () => {
  const s = clone(OLD);
  s[1].questions[0].extract = EX();
  s[1].questions[1].extract = EX('b.mp3');
  return s;
};
const extractCheck = (newSections, { index, qcmStep = 'idle' }) =>
  checkLiveEdit({ oldSections: withExtracts(), newSections, progress: [{ index: 0, revealed: false }, { index, revealed: false }], currentSection: 1, qcmStep });
const CHANGED = /l’extrait de la question 1 de la manche « .+ » a changé/;

test('accepts changing the extract of a question not yet asked', () => {
  const changed = withExtracts(); changed[1].questions[1].extract = EX('autre.mp3');
  const removed = withExtracts(); delete removed[1].questions[1].extract;
  const added = withExtracts(); added[1].questions[2].extract = EX('c.mp3');
  for (const s of [changed, removed, added]) assert.deepEqual(extractCheck(s, { index: 1 }), { ok: true, warnings: [] });
});

test('refuses changing the extract source of an asked question', () => {
  const s = withExtracts(); s[1].questions[0].extract.ref = 'autre.mp3';
  refused(extractCheck(s, { index: 1 }), CHANGED);
});

test('refuses adding or removing an extract on the current question once shown', () => {
  const s = withExtracts(); delete s[1].questions[0].extract;
  refused(extractCheck(s, { index: 0, qcmStep: 'listening' }), CHANGED);
  assert.equal(extractCheck(s, { index: 0, qcmStep: 'idle' }).ok, true);
});

test('accepts correcting start and end of an asked question', () => {
  const s = withExtracts(); s[1].questions[0].extract.start = 3; s[1].questions[0].extract.end = 12;
  assert.equal(extractCheck(s, { index: 1 }).ok, true);
});
