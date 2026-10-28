const test = require('node:test');
const assert = require('node:assert/strict');
const { rankTeams, podium } = require('./ranking');

const mk = (...scores) => scores.map((score, i) => ({ id: `t${i}`, name: `Équipe ${i}`, score }));

test('dense ranking shares places without gaps', () => {
  assert.deepEqual(rankTeams(mk(10, 12, 12)).map((t) => [t.score, t.place]), [[12, 1], [12, 1], [10, 2]]);
});

test('ties are sorted by name (fr)', () => {
  const r = rankTeams([{ id: 'z', name: 'Zèbre', score: 1 }, { id: 'e', name: 'Élan', score: 1 }]);
  assert.deepEqual(r.map((t) => t.name), ['Élan', 'Zèbre']);
});

test('podium keeps every team of places 1 to 3', () => {
  const p = podium(mk(9, 7, 5, 5, 5, 5, 5, 2));
  assert.deepEqual(p.map((s) => [s.place, s.teams.length]), [[1, 1], [2, 1], [3, 5]]);
  assert.ok(!p.some((s) => s.teams.some((t) => t.score === 2)));
});

test('podium with fewer than three distinct scores', () => {
  assert.deepEqual(podium(mk(4, 4)).map((s) => [s.place, s.teams.length]), [[1, 2]]);
});

test('zero teams gives an empty podium', () => {
  assert.deepEqual(podium([]), []);
});
