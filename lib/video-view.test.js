const test = require('node:test');
const assert = require('node:assert/strict');
const { screenView, hostWarning } = require('../public/video-view.js');

const video = { key: 'k', seq: 1, audible: true, media: null };
const song = (extra = {}) => ({ number: 2, total: 5, playing: false, reveal: null, video, ...extra });
const base = { stage: 'play', phase: 'open', qcm: undefined, playingNow: false };

test('buzzer round, playing: video without strip', () => {
  assert.deepEqual(screenView({ ...base, song: song(), playingNow: true }), { main: 'video', strip: null, cover: null });
});

test('buzzer round, playing after B: video with reveal strip', () => {
  const reveal = { answer: 'Foo', cover: null };
  assert.deepEqual(screenView({ ...base, song: song({ reveal }), playingNow: true }), { main: 'video', strip: 'reveal', cover: null });
});

test('buzzer round, buzzed and not playing: banner', () => {
  assert.deepEqual(screenView({ ...base, phase: 'buzzed', song: song() }), { main: 'banner', strip: null, cover: null });
});

test('buzzer round, revealed and stopped: reveal', () => {
  const reveal = { answer: 'Foo', cover: null };
  assert.deepEqual(screenView({ ...base, phase: 'closed', song: song({ reveal }) }), { main: 'reveal', strip: null, cover: null });
});

test('buzzer round, nothing playing: cover with the exact text', () => {
  assert.deepEqual(screenView({ ...base, song: song() }), { main: 'cover', strip: null, cover: '🎬 Morceau 2 / 5' });
});

test('outside the play stage: usual display', () => {
  for (const stage of ['setup', 'summary', 'final']) {
    assert.deepEqual(screenView({ ...base, stage, song: song(), playingNow: true }), { main: null, strip: null, cover: null });
  }
});

test('no video pass: usual display', () => {
  assert.deepEqual(screenView({ ...base, song: song({ video: null }) }), { main: null, strip: null, cover: null });
  assert.deepEqual(screenView({ ...base, song: null }), { main: null, strip: null, cover: null });
});

const qcm = (step) => ({ step, index: 2, total: 10 });
const qsong = { kind: 'qcm', video };

test('qcm, playing: video, countdown strip at countdown and locked', () => {
  for (const step of ['countdown', 'locked']) {
    assert.deepEqual(screenView({ ...base, song: qsong, qcm: qcm(step), playingNow: true }), { main: 'video', strip: 'countdown', cover: null });
  }
  assert.deepEqual(screenView({ ...base, song: qsong, qcm: qcm('listening'), playingNow: true }), { main: 'video', strip: null, cover: null });
});

test('qcm, listening and not playing: cover; other steps: usual display', () => {
  assert.deepEqual(screenView({ ...base, song: qsong, qcm: qcm('listening') }), { main: 'cover', strip: null, cover: '🎬 Question 3 / 10' });
  assert.deepEqual(screenView({ ...base, song: qsong, qcm: qcm('countdown') }), { main: null, strip: null, cover: null });
});

test('qcm outside the play stage or without video: usual display', () => {
  assert.deepEqual(screenView({ ...base, stage: 'summary', song: qsong, qcm: qcm('listening') }), { main: null, strip: null, cover: null });
  assert.deepEqual(screenView({ ...base, song: { kind: 'qcm', video: null }, qcm: qcm('listening') }), { main: null, strip: null, cover: null });
});

test('qcm extract replayed: video without strip at question and revealed', () => {
  for (const step of ['question', 'choices', 'revealed']) {
    assert.deepEqual(screenView({ ...base, song: qsong, qcm: qcm(step), playingNow: true }), { main: 'video', strip: null, cover: null });
  }
});

test('qcm extract not playing: cover only while listening, with the question number', () => {
  const first = (step) => ({ step, index: 0, total: 3 });
  assert.deepEqual(screenView({ ...base, song: qsong, qcm: first('listening') }), { main: 'cover', strip: null, cover: '🎬 Question 1 / 3' });
  for (const step of ['question', 'choices', 'locked', 'revealed']) {
    assert.deepEqual(screenView({ ...base, song: qsong, qcm: first(step) }), { main: null, strip: null, cover: null });
  }
});

test('hostWarning: null when the pass is not a video', () => {
  assert.equal(hostWarning({ isVideo: false, stage: 'setup', reader: null, unlocked: false }), null);
});

test('hostWarning: texts in priority order', () => {
  assert.equal(hostWarning({ isVideo: true, stage: 'setup', reader: null, unlocked: false }), 'Aucun Grand écran ouvert');
  assert.equal(hostWarning({ isVideo: true, stage: 'setup', reader: 'a', unlocked: false }), 'Grand écran à l’étape Installation : passez à Jeu pour voir la vidéo');
  assert.equal(hostWarning({ isVideo: true, stage: 'summary', reader: 'a', unlocked: false }), 'Grand écran à l’étape Bilan : passez à Jeu pour voir la vidéo');
  assert.equal(hostWarning({ isVideo: true, stage: 'final', reader: 'a', unlocked: true }), 'Grand écran à l’étape Fin : passez à Jeu pour voir la vidéo');
  assert.equal(hostWarning({ isVideo: true, stage: 'play', reader: 'a', unlocked: false }), 'Le Grand écran attend un clic pour activer la vidéo');
});

test('hostWarning: null when everything is fine', () => {
  assert.equal(hostWarning({ isVideo: true, stage: 'play', reader: 'a', unlocked: true }), null);
});
