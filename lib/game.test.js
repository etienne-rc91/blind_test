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
