// Écriture en flux d’un fichier envoyé par l’animateur : jamais entièrement en mémoire.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256Of(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

// Même assainissement que l’envoi des images et des morceaux (server.js).
// Retourne { ok: true, name } ou { ok: false, reason: 'bad-type' | 'empty' | 'too-big' | 'aborted' }.
// Même nom et même contenu → nom réutilisé ; même nom et autre contenu → « nom-2.ext », « nom-3.ext »…
async function saveStream(stream, { dir, filename, types, max }) {
  const base = path.basename(String(filename || '')).replace(/[^\w.-]/g, '_').replace(/^\.+/, '');
  const m = base.match(/^(.+)\.([A-Za-z0-9]+)$/);
  if (!m || !types.includes(m[2].toLowerCase())) return { ok: false, reason: 'bad-type' };

  const tmp = path.join(dir, `.upload-${crypto.randomBytes(8).toString('hex')}`);
  const out = fs.createWriteStream(tmp);
  const outDone = new Promise((resolve, reject) => { out.on('error', reject); out.on('close', resolve); });
  outDone.catch(() => {});
  const hash = crypto.createHash('sha256');
  let size = 0;
  let failure = null;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > max) { failure = 'too-big'; break; }
      hash.update(chunk);
      if (!out.write(chunk)) await Promise.race([new Promise((resolve) => out.once('drain', resolve)), outDone]);
    }
  } catch {
    failure = 'aborted';
  }
  if (!failure && !size) failure = 'empty';
  if (failure) {
    out.destroy();
    await outDone.catch(() => {});
    fs.rmSync(tmp, { force: true });
    return { ok: false, reason: failure };
  }
  try {
    out.end();
    await outDone;
    const digest = hash.digest('hex');
    for (let n = 1; ; n += 1) {
      const name = n === 1 ? base : `${m[1]}-${n}.${m[2]}`;
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) { fs.renameSync(tmp, file); return { ok: true, name }; }
      if (fs.statSync(file).size === size && await sha256Of(file) === digest) { fs.rmSync(tmp, { force: true }); return { ok: true, name }; }
    }
  } catch {
    fs.rmSync(tmp, { force: true });
    return { ok: false, reason: 'aborted' };
  }
}

module.exports = { saveStream };
