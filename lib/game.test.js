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

// ---------- QCM ----------
const Q = (text, answer) => ({ text, image: null, choices: { A: 'a', B: 'b', C: 'c', D: 'd' }, answer });
const QCM_SECTIONS = [
  { name: 'Cinéma', type: 'buzzer', questions: [] },
  { name: 'Culture G', type: 'qcm', questions: [Q('Q1', 'B'), Q('Q2', 'C')] },
];
function qcmGame() {
  const clock = { t: 1000, pending: null, cleared: 0, ticks: 0 };
  const timers = {
    set: (fn, ms) => { clock.pending = { fn, ms }; return clock.pending; },
    clear: (h) => { if (h && clock.pending === h) { clock.pending = null; clock.cleared += 1; } },
  };
  const g = createGame({ timers, now: () => clock.t, onTimer: () => { clock.ticks += 1; } });
  g.join('s1', 'A'); g.join('s2', 'B');
  g.host('import', { sections: QCM_SECTIONS });
  g.host('section', { index: 1 });
  clock.expire = () => { const p = clock.pending; clock.pending = null; p.fn(); };
  return { g, clock };
}
const qa = (g, action) => g.host('qcm', { action });
const qstate = (g, role = 'host', teamId) => g.publicState({ role, teamId }).qcm;
const toCountdown = (g) => { qa(g, 'show-question'); qa(g, 'show-choices'); qa(g, 'start'); };

test('runs a full qcm question', () => {
  const { g, clock } = qcmGame();
  assert.equal(qstate(g).step, 'idle');
  qa(g, 'show-question');
  assert.equal(qstate(g, 'screen').question.text, 'Q1');
  assert.equal(qstate(g, 'screen').question.choices, undefined);
  qa(g, 'show-choices');
  assert.equal(qstate(g, 'screen').question.choices.B, 'b');
  qa(g, 'start');
  assert.equal(clock.pending.ms, 20000);
  clock.t += 5000;
  assert.equal(qstate(g, 'screen').remainingMs, 15000);
  assert.deepEqual(g.answer('s1', 'B'), { ok: true });
  g.answer('s2', 'A');
  assert.equal(qstate(g, 'screen').answeredCount, 2);
  clock.expire();
  assert.equal(clock.ticks, 1);
  assert.equal(qstate(g).step, 'locked');
  qa(g, 'reveal');
  assert.deepEqual(teamOf(g, 'a').scores, [0, 1]);
  assert.deepEqual(teamOf(g, 'b').scores, [0, 0]);
  assert.deepEqual(qstate(g, 'screen').counts, { A: 1, B: 1, C: 0, D: 0 });
  qa(g, 'next');
  assert.equal(qstate(g).step, 'idle');
  assert.equal(qstate(g).index, 1);
});

test('qcm actions are idempotent', () => {
  const { g } = qcmGame();
  assert.equal(qa(g, 'show-question').changed, true);
  assert.equal(qa(g, 'show-question').changed, false);
  assert.equal(qstate(g).step, 'question');
  assert.equal(qa(g, 'reveal').changed, false);
});

test('reveal before the end of the countdown is refused', () => {
  const { g } = qcmGame();
  toCountdown(g);
  assert.equal(qa(g, 'reveal').changed, false);
  assert.equal(qstate(g).step, 'countdown');
});

test('answers are refused outside the countdown', () => {
  const { g, clock } = qcmGame();
  qa(g, 'show-question'); qa(g, 'show-choices');
  assert.equal(g.answer('s1', 'A').reason, 'closed');
  qa(g, 'start');
  assert.equal(g.answer('s1', 'E').reason, 'invalid');
  assert.equal(g.answer('s9', 'A').reason, 'not-joined');
  clock.expire();
  assert.equal(g.answer('s1', 'A').reason, 'closed');
});

test('a team can change its answer during the countdown', () => {
  const { g, clock } = qcmGame();
  toCountdown(g);
  g.answer('s1', 'A'); g.answer('s1', 'B');
  assert.equal(qstate(g).answers.a, 'B');
  assert.equal(qstate(g).answeredCount, 1);
  clock.expire(); qa(g, 'reveal');
  assert.equal(teamOf(g, 'a').score, 1);
});

test('screen and player never see the answer before reveal', () => {
  const { g, clock } = qcmGame();
  toCountdown(g);
  g.answer('s1', 'B'); g.answer('s2', 'C');
  for (const st of [() => g.publicState({ role: 'screen' }), () => g.publicState({ role: 'player', teamId: 'a' })]) {
    const s = st();
    assert.equal('answer' in s.qcm, false);
    assert.equal('answers' in s.qcm, false);
    assert.equal('counts' in s.qcm, false);
    delete s.qcm.question;                    // les clés A–D des propositions ne sont pas des réponses
    assert.doesNotMatch(JSON.stringify(s), /"C"/);
  }
  clock.expire();
  assert.equal('answer' in qstate(g, 'screen'), false);
  qa(g, 'reveal');
  assert.equal(qstate(g, 'screen').answer, 'B');
  assert.equal(qstate(g, 'player', 'b').answer, 'B');
});

test('player state carries its own answer only', () => {
  const { g } = qcmGame();
  toCountdown(g);
  g.answer('s1', 'B'); g.answer('s2', 'D');
  const s = g.publicState({ role: 'player', teamId: 'a' });
  assert.equal(s.qcm.myAnswer, 'B');
  delete s.qcm.question;
  assert.doesNotMatch(JSON.stringify(s), /"D"/);
  assert.equal(g.publicState({ role: 'player', teamId: null }).qcm.myAnswer, null);
});

test('host sees the answer and every team answer live', () => {
  const { g } = qcmGame();
  qa(g, 'show-question');
  assert.equal(qstate(g).answer, 'B');
  qa(g, 'show-choices'); qa(g, 'start');
  g.answer('s2', 'D');
  assert.deepEqual(qstate(g).answers, { b: 'D' });
});

test('undo of start stops the countdown and clears answers', () => {
  const { g, clock } = qcmGame();
  toCountdown(g);
  g.answer('s1', 'B');
  g.undo();
  assert.equal(clock.cleared, 1);
  assert.equal(clock.pending, null);
  assert.equal(qstate(g).step, 'choices');
  assert.equal(qstate(g).answeredCount, 0);
});

test('undo after expiry also goes back to choices', () => {
  const { g, clock } = qcmGame();
  toCountdown(g);
  g.answer('s1', 'B');
  clock.expire();
  g.undo();
  assert.equal(qstate(g).step, 'choices');
  assert.equal(qstate(g).answeredCount, 0);
});

test('undo of an unrelated action keeps the countdown step', () => {
  const { g, clock } = qcmGame();
  toCountdown(g);
  g.answer('s1', 'B');
  g.host('score', { teamId: 'b', delta: 1 });
  clock.expire();
  g.undo();
  assert.equal(qstate(g).step, 'locked');
  assert.equal(qstate(g).answeredCount, 1);
  assert.equal(teamOf(g, 'b').score, 0);
});

test('undo of an unrelated action during the countdown keeps it running', () => {
  const { g, clock } = qcmGame();
  toCountdown(g);
  g.host('stage', { stage: 'play' });
  g.undo();
  assert.equal(qstate(g).step, 'countdown');
  assert.notEqual(clock.pending, null);
});

test('undo of reveal removes the points and keeps answers', () => {
  const { g, clock } = qcmGame();
  toCountdown(g);
  g.answer('s1', 'B');
  clock.expire(); qa(g, 'reveal');
  g.undo();
  assert.equal(teamOf(g, 'a').score, 0);
  assert.equal(qstate(g).step, 'locked');
  assert.equal(qstate(g).answeredCount, 1);
  qa(g, 'reveal');
  assert.equal(teamOf(g, 'a').score, 1);
});

test('revealed question survives a reload', () => {
  const { g, clock } = qcmGame();
  toCountdown(g);
  g.answer('s1', 'B');
  clock.expire(); qa(g, 'reveal');
  const g2 = createGame();
  g2.load(JSON.parse(JSON.stringify(g.toSaved())));
  assert.equal(qstate(g2).step, 'revealed');
  assert.equal(qa(g2, 'reveal').changed, false);
  assert.equal(teamOf(g2, 'a').score, 1);
  qa(g2, 'next');
  assert.equal(qstate(g2).index, 1);
});

test('an unrevealed question restarts idle after a reload', () => {
  const { g } = qcmGame();
  toCountdown(g);
  const g2 = createGame();
  g2.load(JSON.parse(JSON.stringify(g.toSaved())));
  assert.equal(qstate(g2).step, 'idle');
  assert.equal(qstate(g2).index, 0);
});

test('switching sections resumes qcm progress', () => {
  const { g, clock } = qcmGame();
  toCountdown(g); clock.expire(); qa(g, 'reveal'); qa(g, 'next');
  qa(g, 'show-question');
  g.host('section', { index: 0 });
  assert.equal(g.publicState({ role: 'host' }).qcm, null);
  g.host('section', { index: 1 });
  assert.equal(qstate(g).index, 1);
  assert.equal(qstate(g).step, 'idle');
});

test('leaving a section during the countdown stops it', () => {
  const { g, clock } = qcmGame();
  toCountdown(g);
  g.host('section', { index: 0 });
  assert.equal(clock.pending, null);
});

test('show-question is refused after the last question', () => {
  const { g, clock } = qcmGame();
  for (let i = 0; i < 2; i += 1) { toCountdown(g); clock.expire(); qa(g, 'reveal'); qa(g, 'next'); }
  assert.equal(qstate(g).index, 2);
  assert.equal(qa(g, 'show-question').changed, false);
});

test('buzzers are disabled during a qcm section', () => {
  const { g } = qcmGame();
  assert.equal(g.host('open').changed, false);
  assert.equal(g.buzz('s1', 1).reason, 'closed');
});

test('countdownSec is clamped to 5..120', () => {
  const { g } = qcmGame();
  g.host('countdown', { seconds: 2 });
  assert.equal(g.publicState({ role: 'host' }).countdownSec, 5);
  g.host('countdown', { seconds: 500 });
  assert.equal(g.publicState({ role: 'host' }).countdownSec, 120);
  assert.equal(g.host('countdown', { seconds: 'x' }).changed, false);
  g.undo();
  assert.equal(g.publicState({ role: 'host' }).countdownSec, 5);
});

test('reset-scores also restarts qcm progress', () => {
  const { g, clock } = qcmGame();
  toCountdown(g); g.answer('s1', 'B'); clock.expire(); qa(g, 'reveal');
  g.host('reset-scores');
  g.host('section', { index: 1 });
  assert.equal(qstate(g).step, 'idle');
  assert.equal(qstate(g).index, 0);
});

// ---------- Corrections de la relecture finale ----------
test('answers of the previous question are not shown on the next one', () => {
  const { g, clock } = qcmGame();
  toCountdown(g); g.answer('s1', 'B'); clock.expire(); qa(g, 'reveal'); qa(g, 'next');
  qa(g, 'show-question'); qa(g, 'show-choices');
  assert.equal(qstate(g).answeredCount, 0);
  assert.deepEqual(qstate(g).answers, {});
  assert.equal(qstate(g, 'screen').answeredCount, 0);
});

test('undoing a section change made mid-countdown goes back to choices', () => {
  const { g } = qcmGame();
  toCountdown(g); g.answer('s1', 'B');
  g.host('section', { index: 0 });
  g.undo();
  assert.equal(qstate(g).step, 'choices');
  assert.equal(qstate(g).answeredCount, 0);
  assert.equal(qa(g, 'start').changed, true);
});

test('players never receive the question, its image or its propositions', () => {
  const { g } = qcmGame();
  qa(g, 'show-question'); qa(g, 'show-choices');
  assert.equal('question' in qstate(g, 'player', 'a'), false);
  assert.ok(qstate(g, 'screen').question);
});

// ---------- Parties : nouvelle soirée et modification à chaud ----------
test('newEvening clears teams, scores, history and goes back to setup', () => {
  const g = scoredGame();
  point(g);
  g.host('stage', { stage: 'play' });
  const res = g.newEvening({ name: 'Soirée Ciné', sections: QCM_SECTIONS });
  assert.deepEqual(res.kickedSockets, ['s1']);
  const s = g.publicState({ role: 'host' });
  assert.equal(s.teams.length, 0);
  assert.equal(s.stage, 'setup');
  assert.equal(s.round, 0);
  assert.equal(s.phase, 'closed');
  assert.equal(s.canUndo, false);
  assert.equal(s.partieName, 'Soirée Ciné');
  assert.equal(s.currentSection, 0);
  assert.deepEqual(s.sections.map((x) => x.name), ['Cinéma', 'Culture G']);
  assert.equal(g.buzz('s1', 1).reason, 'not-joined');
  assert.equal(g.join('s1', 'A').ok, true);
  assert.deepEqual(teamOf(g, 'a').scores, [0, 0]);
});

test('newEvening stops a running countdown and kicks sockets', () => {
  const { g, clock } = qcmGame();
  toCountdown(g);
  const res = g.newEvening({ name: 'X', sections: QCM_SECTIONS });
  assert.deepEqual(res.kickedSockets.sort(), ['s1', 's2']);
  assert.equal(clock.pending, null);
  g.host('section', { index: 1 });
  assert.equal(qstate(g).step, 'idle');
  assert.equal(qstate(g).index, 0);
});

test('replaceSections keeps scores and progress', () => {
  const { g, clock } = qcmGame();
  toCountdown(g); g.answer('s1', 'B'); clock.expire(); qa(g, 'reveal'); qa(g, 'next');
  const s = JSON.parse(JSON.stringify(QCM_SECTIONS));
  s[1].questions[1].text = 'Q2 corrigée';
  g.replaceSections(s);
  assert.deepEqual(teamOf(g, 'a').scores, [0, 1]);
  assert.equal(qstate(g).index, 1);
  qa(g, 'show-question');
  assert.equal(qstate(g, 'screen').question.text, 'Q2 corrigée');
});

test('replaceSections extends scores and progress for appended sections', () => {
  const g = scoredGame();
  point(g);
  g.replaceSections([...SECTIONS, { name: 'Disney', type: 'buzzer', questions: [] }]);
  assert.deepEqual(teamOf(g, 'a').scores, [1, 0, 0]);
  assert.equal(g.host('section', { index: 2 }).changed, true);
});

test('undo after replaceSections never brings old questions back', () => {
  const { g } = qcmGame();
  g.host('score', { teamId: 'a', delta: 1 });
  const s = JSON.parse(JSON.stringify(QCM_SECTIONS));
  s[1].questions[0].text = 'Q1 corrigée';
  g.replaceSections(s);
  g.undo();
  assert.equal(teamOf(g, 'a').score, 0);
  qa(g, 'show-question');
  assert.equal(qstate(g, 'screen').question.text, 'Q1 corrigée');
});

test('added question after a finished qcm section can be shown', () => {
  const { g, clock } = qcmGame();
  for (let i = 0; i < 2; i += 1) { toCountdown(g); clock.expire(); qa(g, 'reveal'); qa(g, 'next'); }
  assert.equal(qa(g, 'show-question').changed, false);
  const s = JSON.parse(JSON.stringify(QCM_SECTIONS));
  s[1].questions.push(Q('Q3', 'A'));
  g.replaceSections(s);
  assert.equal(qa(g, 'show-question').changed, true);
  assert.equal(qstate(g, 'screen').question.text, 'Q3');
});

test('getLive exposes what checkLiveEdit needs', () => {
  const { g } = qcmGame();
  qa(g, 'show-question');
  const live = g.getLive();
  assert.equal(live.currentSection, 1);
  assert.equal(live.qcmStep, 'question');
  assert.deepEqual(live.progress[1], { index: 0, revealed: false });
  assert.equal(live.sections[1].questions.length, 2);
});

test('partieName survives toSaved/load and setPartieName updates state', () => {
  const g = createGame();
  assert.equal(g.publicState({ role: 'screen' }).partieName, null);
  g.newEvening({ name: 'Soirée', sections: SECTIONS });
  g.setPartieName('Soirée 2');
  const g2 = createGame();
  g2.load(JSON.parse(JSON.stringify(g.toSaved())));
  assert.equal(g2.publicState({ role: 'host' }).partieName, 'Soirée 2');
});

// ---------- Corrections de la relecture finale ----------
test('replaceSections refuses fewer sections than the game has', () => {
  const g = scoredGame();
  point(g);
  assert.equal(g.replaceSections([SECTIONS[0]]), false);
  assert.equal(g.publicState({ role: 'host' }).sections.length, 2);
  assert.deepEqual(teamOf(g, 'a').scores, [1, 0]);
});

test('reveal never crashes when the current question disappeared', () => {
  const { g, clock } = qcmGame();
  toCountdown(g); clock.expire();
  g.host('reset-scores');                                   // la manche n'est plus « commencée »
  const s = JSON.parse(JSON.stringify(QCM_SECTIONS));
  s[1].questions = [];
  g.replaceSections(s);
  g.undo();                                                 // ramène l'étape « locked » sur une question absente
  assert.doesNotThrow(() => qa(g, 'reveal'));
  assert.doesNotThrow(() => g.publicState({ role: 'screen' }));
});
