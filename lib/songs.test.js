const test = require('node:test');
const assert = require('node:assert/strict');
const { MUSIC_TYPES, parseTime, formatTime, isSafeMusicName, parseSource, formatSource, isSong, isExtract, isVideoSource } = require('./songs');

const ID = '4uLU6hMCjMI75M1A2tKUQC';

test('parses m:ss and plain seconds', () => {
  assert.equal(parseTime('1:05'), 65);
  assert.equal(parseTime('0:30'), 30);
  assert.equal(parseTime('90'), 90);
  assert.equal(parseTime(' 1:05 '), 65);
  assert.equal(parseTime('12:00'), 720);
  for (const bad of ['', '1:75', '-3', '1:5', 'abc', '1.5', '1:05:00', null, undefined]) assert.equal(parseTime(bad), null, String(bad));
});

test('formats time', () => {
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(600), '10:00');
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(null), '');
});

test('parses a safe file name', () => {
  assert.equal(isSafeMusicName('Europe - Final Countdown.mp3'), true);
  assert.equal(isSafeMusicName('A.FLAC'), true);
  for (const bad of ['../a.mp3', 'a/b.mp3', 'a\\b.mp3', 'a.txt', '.x.mp3', '', 'mp3', null]) assert.equal(isSafeMusicName(bad), false, String(bad));
  assert.deepEqual(parseSource('Europe - Final Countdown.mp3'), { source: 'file', ref: 'Europe - Final Countdown.mp3' });
  assert.equal(parseSource('../a.mp3'), null);
  assert.equal(parseSource('a.txt'), null);
  assert.equal(parseSource('.x.mp3'), null);
  assert.ok(MUSIC_TYPES.includes('m4a'));
});

test('parses spotify uri and open.spotify.com url', () => {
  const expected = { source: 'spotify', ref: ID };
  assert.deepEqual(parseSource(`spotify:track:${ID}`), expected);
  assert.deepEqual(parseSource(`https://open.spotify.com/track/${ID}`), expected);
  assert.deepEqual(parseSource(`https://open.spotify.com/track/${ID}?si=abc123`), expected);
  assert.deepEqual(parseSource(`https://open.spotify.com/intl-fr/track/${ID}?si=abc`), expected);
  assert.equal(parseSource('spotify:track:short'), null);
  assert.equal(parseSource(`spotify:track:${ID}x`), null);
  assert.equal(parseSource(''), null);
});

test('formats source', () => {
  assert.equal(formatSource({ source: 'spotify', ref: ID }), `spotify:track:${ID}`);
  assert.equal(formatSource({ source: 'file', ref: 'a.mp3' }), 'a.mp3');
});

test('isSong rejects end before start and empty answer', () => {
  const ok = { source: 'file', ref: 'a.mp3', start: 10, end: 40, answer: 'Europe' };
  assert.equal(isSong(ok), true);
  assert.equal(isSong({ ...ok, source: 'spotify', ref: ID }), true);
  assert.equal(isSong({ ...ok, start: 0 }), true);
  assert.equal(isSong({ ...ok, end: 10 }), false);
  assert.equal(isSong({ ...ok, end: 5 }), false);
  assert.equal(isSong({ ...ok, answer: '' }), false);
  assert.equal(isSong({ ...ok, answer: '   ' }), false);
  assert.equal(isSong({ ...ok, start: -1 }), false);
  assert.equal(isSong({ ...ok, start: 1.5 }), false);
  assert.equal(isSong({ ...ok, start: null }), false);
  assert.equal(isSong({ ...ok, ref: '../a.mp3' }), false);
  assert.equal(isSong({ ...ok, source: 'spotify', ref: 'nope' }), false);
  assert.equal(isSong({ ...ok, source: 'other' }), false);
  assert.equal(isSong(null), false);
});

test('isExtract accepts a song without answer', () => {
  assert.equal(isExtract({ source: 'file', ref: 'a.mp3', start: 0, end: 10 }), true);
  assert.equal(isExtract({ source: 'file', ref: 'a.mp3', start: 10, end: 10 }), false);
  assert.equal(isExtract({ source: 'spotify', ref: 'bad', start: 0, end: 10 }), false);
  assert.equal(isSong({ source: 'file', ref: 'a.mp3', start: 0, end: 10 }), false);   // réponse toujours exigée pour un morceau
});

const YT = 'dQw4w9WgXcQ';
test('parses youtube links and ids', () => {
  for (const s of [`youtube:${YT}`, `https://www.youtube.com/watch?v=${YT}`, `https://youtube.com/watch?feature=share&v=${YT}&t=42`,
    `https://m.youtube.com/watch?v=${YT}`, `https://youtu.be/${YT}?si=abc`, `https://www.youtube.com/shorts/${YT}`]) {
    assert.deepEqual(parseSource(s), { source: 'youtube', ref: YT }, s);
  }
  for (const bad of ['youtube:abc', `https://www.youtube.com/watch?v=${YT}x`, 'https://vimeo.com/123', `https://youtu.be/${YT.slice(1)}`]) assert.equal(parseSource(bad), null, bad);
  assert.equal(formatSource({ source: 'youtube', ref: YT }), `youtube:${YT}`);
});
test('a video file name is a video source, an audio one stays a file', () => {
  assert.deepEqual(parseSource('Titanic scène.MP4'), { source: 'video', ref: 'Titanic scène.MP4' });
  assert.deepEqual(parseSource('a.mp3'), { source: 'file', ref: 'a.mp3' });
  for (const bad of ['../a.mp4', '.a.mov', 'a.avi']) assert.equal(parseSource(bad), null, bad);
  assert.equal(formatSource({ source: 'video', ref: 'a.mp4' }), 'a.mp4');
});
test('isExtract accepts video and youtube sources', () => {
  assert.equal(isExtract({ source: 'video', ref: 'a.mp4', start: 0, end: 5 }), true);
  assert.equal(isExtract({ source: 'youtube', ref: YT, start: 0, end: 5 }), true);
  assert.equal(isExtract({ source: 'video', ref: 'a.mp3', start: 0, end: 5 }), false);
  assert.equal(isExtract({ source: 'youtube', ref: 'court', start: 0, end: 5 }), false);
  assert.equal(isVideoSource('youtube') && isVideoSource('video') && !isVideoSource('file') && !isVideoSource('spotify'), true);
});
