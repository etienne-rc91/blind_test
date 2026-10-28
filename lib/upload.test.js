// Tests de l’écriture en flux d’un fichier envoyé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { saveStream } = require('./upload');

const TYPES = ['mp4', 'webm'];
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'buzzer-upload-'));
const from = (...chunks) => Readable.from(chunks.map((c) => Buffer.from(c)));
const MAX = 1024;

test('stream upload keeps a safe name', async () => {
  const dir = tmpDir();
  const r = await saveStream(from('contenu'), { dir, filename: 'Mon clip!.mp4', types: TYPES, max: MAX });
  assert.deepEqual(r, { ok: true, name: 'Mon_clip_.mp4' });
  assert.equal(fs.readFileSync(path.join(dir, 'Mon_clip_.mp4'), 'utf8'), 'contenu');
  assert.deepEqual(fs.readdirSync(dir), ['Mon_clip_.mp4']);
});

test('same content reuses the name, other content gets a suffix', async () => {
  const dir = tmpDir();
  const save = (content) => saveStream(from(content), { dir, filename: 'a.mp4', types: TYPES, max: MAX });
  assert.equal((await save('un')).name, 'a.mp4');
  assert.equal((await save('un')).name, 'a.mp4');
  assert.equal((await save('deux')).name, 'a-2.mp4');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a-2.mp4', 'a.mp4']);
});

test('stream upload over the limit leaves no file', async () => {
  const dir = tmpDir();
  const r = await saveStream(from('01234', '56789'), { dir, filename: 'a.mp4', types: TYPES, max: 4 });
  assert.deepEqual(r, { ok: false, reason: 'too-big' });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('empty and bad type are refused', async () => {
  const dir = tmpDir();
  assert.deepEqual(await saveStream(from(), { dir, filename: 'a.mp4', types: TYPES, max: MAX }), { ok: false, reason: 'empty' });
  assert.deepEqual(await saveStream(from('x'), { dir, filename: 'a.avi', types: TYPES, max: MAX }), { ok: false, reason: 'bad-type' });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('an aborted stream leaves no file', async () => {
  const dir = tmpDir();
  const broken = new Readable({ read() { this.push(Buffer.from('début')); this.destroy(new Error('connexion coupée')); } });
  const r = await saveStream(broken, { dir, filename: 'a.mp4', types: TYPES, max: MAX });
  assert.deepEqual(r, { ok: false, reason: 'aborted' });
  assert.deepEqual(fs.readdirSync(dir), []);
});
