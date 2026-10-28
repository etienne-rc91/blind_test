const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('./game');

const teamOf = (g, id) => g.publicState({ role: 'host' }).teams.find((t) => t.id === id);

test('join creates a team and merges names case-insensitively', () => {
  const g = createGame();
  const a = g.join('s1', 'Les Loups');
  const b = g.join('s2', 'les  loups');
  assert.equal(a.ok, true);
  assert.equal(a.teamId, b.teamId);
  assert.equal(teamOf(g, a.teamId).online, 2);
});

test('join rejects an empty name', () => {
  const g = createGame();
  assert.equal(g.join('s1', '  ').ok, false);
});

test('first buzz wins and later buzzes are ranked', () => {
  const g = createGame();
  g.join('s1', 'A'); g.join('s2', 'B');
  g.host('open');
  assert.deepEqual(g.buzz('s1', 100), { ok: true, rank: 1 });
  assert.deepEqual(g.buzz('s2', 150), { ok: true, rank: 2 });
  const s = g.publicState({ role: 'host' });
  assert.equal(s.phase, 'buzzed');
  assert.equal(s.buzzes[0].name, 'A');
  assert.equal(s.buzzes[1].deltaMs, 50);
});

test('buzz is refused when closed, excluded or already buzzed', () => {
  const g = createGame();
  g.join('s1', 'A'); g.join('s2', 'B');
  assert.equal(g.buzz('s3', 1).reason, 'not-joined');
  assert.equal(g.buzz('s1', 1).reason, 'closed');
  g.host('open');
  g.buzz('s1', 2);
  assert.equal(g.buzz('s1', 3).reason, 'already');
  g.host('wrong');
  assert.equal(g.buzz('s1', 4).reason, 'excluded');
});

test('correct gives one point once', () => {
  const g = createGame();
  g.join('s1', 'A');
  g.host('open'); g.buzz('s1', 1);
  assert.equal(g.host('correct').changed, true);
  assert.equal(g.host('correct').changed, false);
  assert.equal(teamOf(g, 'a').score, 1);
});

test('wrong excludes the first team and reopens', () => {
  const g = createGame();
  g.join('s1', 'A');
  g.host('open'); g.buzz('s1', 1);
  g.host('wrong');
  const s = g.publicState({ role: 'host' });
  assert.equal(s.phase, 'open');
  assert.deepEqual(s.excluded, ['a']);
});

test('undo restores score and round state', () => {
  const g = createGame();
  g.join('s1', 'A');
  g.host('open'); g.buzz('s1', 1);
  g.host('correct');
  assert.equal(g.undo(), true);
  assert.equal(teamOf(g, 'a').score, 0);
  assert.equal(g.publicState({ role: 'host' }).phase, 'buzzed');
});

test('kick returns the team sockets and undo brings the team back', () => {
  const g = createGame();
  g.join('s1', 'A');
  assert.deepEqual(g.host('kick', { teamId: 'a' }).kickedSockets, ['s1']);
  assert.equal(teamOf(g, 'a'), undefined);
  g.undo();
  assert.equal(teamOf(g, 'a').online, 0);
});

test('teams are sorted by score then name (fr)', () => {
  const g = createGame();
  g.join('s1', 'Zèbre'); g.join('s2', 'Élan'); g.join('s3', 'Bison');
  g.host('score', { teamId: 'zèbre', delta: 2 });
  assert.deepEqual(g.publicState({ role: 'host' }).teams.map((t) => t.name), ['Zèbre', 'Bison', 'Élan']);
});

test('toSaved/load round-trip keeps teams, scores and round number', () => {
  const g = createGame();
  g.join('s1', 'A');
  g.host('open'); g.buzz('s1', 1); g.host('correct');
  const g2 = createGame();
  assert.equal(g2.load(JSON.parse(JSON.stringify(g.toSaved()))).teams, 1);
  const s = g2.publicState({ role: 'host' });
  assert.equal(s.round, 1);
  assert.equal(s.teams[0].score, 1);
  assert.equal(s.phase, 'closed');
});

test('load ignores malformed teams', () => {
  const g = createGame();
  assert.equal(g.load({ teams: [{ id: 1 }] }).teams, 0);
  assert.equal(g.load(null).teams, 0);
});

test('stage defaults to setup and is undoable', () => {
  const g = createGame();
  assert.equal(g.publicState({ role: 'host' }).stage, 'setup');
  assert.equal(g.host('stage', { stage: 'final' }).changed, true);
  assert.equal(g.publicState({ role: 'screen' }).stage, 'final');
  g.undo();
  assert.equal(g.publicState({ role: 'host' }).stage, 'setup');
});

test('invalid stage is ignored', () => {
  const g = createGame();
  assert.equal(g.host('stage', { stage: 'nope' }).changed, false);
});

test('invalid join ip is ignored', () => {
  const g = createGame();
  g.host('join-ip', { ip: 'evil.com' });
  assert.equal(g.publicState({ role: 'screen' }).joinIp, null);
  g.host('join-ip', { ip: '192.168.1.20' });
  assert.equal(g.publicState({ role: 'screen' }).joinIp, '192.168.1.20');
});

test('join ip is not an undoable action', () => {
  const g = createGame();
  g.host('join-ip', { ip: '192.168.1.20' });
  assert.equal(g.publicState({ role: 'host' }).canUndo, false);
  g.host('stage', { stage: 'play' });
  g.host('join-ip', { ip: '10.0.0.2' });
  g.undo();
  const s = g.publicState({ role: 'host' });
  assert.equal(s.stage, 'setup');
  assert.equal(s.joinIp, '10.0.0.2');
});

test('stage and joinIp survive toSaved/load', () => {
  const g = createGame();
  g.host('stage', { stage: 'play' });
  g.host('join-ip', { ip: '192.168.1.20' });
  const g2 = createGame();
  g2.load(JSON.parse(JSON.stringify(g.toSaved())));
  const s = g2.publicState({ role: 'screen' });
  assert.equal(s.stage, 'play');
  assert.equal(s.joinIp, '192.168.1.20');
});

test('teams carry their dense place', () => {
  const g = createGame();
  g.join('s1', 'A'); g.join('s2', 'B'); g.join('s3', 'C');
  g.host('score', { teamId: 'a', delta: 2 });
  g.host('score', { teamId: 'b', delta: 2 });
  assert.deepEqual(g.publicState({ role: 'screen' }).teams.map((t) => t.place), [1, 1, 2]);
});

const SECTIONS = [
  { name: 'Cinéma', type: 'buzzer', questions: [] },
  { name: 'Années 80', type: 'buzzer', questions: [] },
];
const scoredGame = () => {
  const g = createGame();
  g.join('s1', 'A');
  g.host('import', { sections: SECTIONS });
  return g;
};
const point = (g, sid = 's1') => { g.host('open'); g.buzz(sid, 1); g.host('correct'); };

test('a fresh game has one buzzer section named Manche 1', () => {
  const s = createGame().publicState({ role: 'host' });
  assert.deepEqual(s.sections, [{ name: 'Manche 1', type: 'buzzer', questionCount: 0 }]);
  assert.equal(s.currentSection, 0);
});

test('points go to the current section', () => {
  const g = scoredGame();
  point(g);
  g.host('section', { index: 1 });
  g.host('score', { teamId: 'a', delta: 1 });
  const t = teamOf(g, 'a');
  assert.deepEqual(t.scores, [1, 1]);
  assert.equal(t.score, 2);
});

test('import is refused once points exist, accepted after reset', () => {
  const g = scoredGame();
  point(g);
  const res = g.host('import', { sections: [SECTIONS[1]] });
  assert.equal(res.changed, false);
  assert.match(res.error, /Remettez d’abord les scores à zéro/);
  g.host('reset-scores');
  assert.equal(g.host('import', { sections: [SECTIONS[1]] }).changed, true);
  assert.deepEqual(teamOf(g, 'a').scores, [0]);
});

test('import is undoable', () => {
  const g = scoredGame();
  g.undo();
  assert.equal(g.publicState({ role: 'host' }).sections[0].name, 'Manche 1');
});

test('section index is bounds-checked', () => {
  const g = scoredGame();
  assert.equal(g.host('section', { index: 2 }).changed, false);
  assert.equal(g.host('section', { index: -1 }).changed, false);
  assert.equal(g.host('section', { index: '1' }).changed, false);
});

test('changing section closes buzzers', () => {
  const g = scoredGame();
  g.join('s2', 'B');
  g.host('open'); g.buzz('s1', 1); g.host('wrong');
  g.host('section', { index: 1 });
  const s = g.publicState({ role: 'host' });
  assert.equal(s.phase, 'closed');
  assert.deepEqual(s.buzzes, []);
  assert.deepEqual(s.excluded, []);
});

test('reset-scores clears every section and goes back to the first', () => {
  const g = scoredGame();
  point(g);
  g.host('section', { index: 1 });
  point(g);
  g.host('reset-scores');
  assert.deepEqual(teamOf(g, 'a').scores, [0, 0]);
  assert.equal(g.publicState({ role: 'host' }).currentSection, 0);
});

test('undo restores the point in the right section', () => {
  const g = scoredGame();
  point(g);
  g.host('section', { index: 1 });
  point(g);
  g.undo();
  assert.deepEqual(teamOf(g, 'a').scores, [1, 0]);
});

test('a team joining late has zero in every section', () => {
  const g = scoredGame();
  g.host('section', { index: 1 });
  g.join('s9', 'Tard');
  assert.deepEqual(teamOf(g, 'tard').scores, [0, 0]);
});

test('loads a v1 scores.json into Manche 1', () => {
  const g = createGame();
  g.load({ round: 3, teams: [{ id: 'a', name: 'A', score: 4 }] });
  const s = g.publicState({ role: 'host' });
  assert.deepEqual(s.teams[0].scores, [4]);
  assert.equal(s.round, 3);
});

test('v2 round-trip keeps sections and current section', () => {
  const g = scoredGame();
  g.host('section', { index: 1 });
  point(g);
  const saved = JSON.parse(JSON.stringify(g.toSaved()));
  assert.equal(saved.version, 2);
  const g2 = createGame();
  g2.load(saved);
  const s = g2.publicState({ role: 'host' });
  assert.equal(s.currentSection, 1);
  assert.deepEqual(s.sections.map((x) => x.name), ['Cinéma', 'Années 80']);
  assert.deepEqual(s.teams[0].scores, [0, 1]);
});

test('load ignores invalid sections and pads short score lists', () => {
  const g = createGame();
  g.load({ version: 2, sections: [{ name: 'X', type: 'buzzer', questions: [] }, { bad: true }], currentSection: 5, teams: [{ id: 'a', name: 'A', scores: [2] }] });
  const s = g.publicState({ role: 'host' });
  assert.deepEqual(s.sections.map((x) => x.name), ['Manche 1']);
  assert.equal(s.currentSection, 0);
  assert.deepEqual(s.teams[0].scores, [2]);
});
