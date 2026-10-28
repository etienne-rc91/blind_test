// Dossier des parties : une partie = un fichier <nom>.csv au format habituel (lisible par Excel).
const fs = require('fs');
const path = require('path');
const { decodeCsvBytes, parseCsv } = require('./csv');
const { buildSections, writeCsv } = require('./game-file');

const MAX_NAME = 60;
const LETTERS = ['A', 'B', 'C', 'D'];

// Nom affiché = nom de fichier. NFC : macOS stocke parfois les accents décomposés (« e » + accent).
function cleanPartieName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').trim();
  if (!name || name.length > MAX_NAME || name.startsWith('.')) return null;
  if (/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}
const keyOf = (name) => name.normalize('NFC').toLowerCase();

// Ne garde que les champs attendus, en chaînes : rien d'autre ne part dans le fichier.
const str = (v) => (typeof v === 'string' ? v : '');
function cleanSections(sections) {
  if (!Array.isArray(sections)) return null;
  return sections.map((s) => ({
    name: str(s?.name).trim(),
    type: str(s?.type),
    questions: Array.isArray(s?.questions) ? s.questions.map((q) => ({
      text: str(q?.text),
      image: str(q?.image) || null,
      choices: Object.fromEntries(LETTERS.map((l) => [l, str(q?.choices?.[l])])),
      answer: LETTERS.includes(q?.answer) ? q.answer : null,
    })) : [],
  }));
}

function createPartiesStore({ dir, imageExists }) {
  const ensureDir = () => fs.mkdirSync(dir, { recursive: true });
  ensureDir();

  // Fichiers .csv du dossier, indexés par nom normalisé (insensible à la casse).
  function files() {
    ensureDir();
    return fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.csv') && !f.startsWith('.'))
      .map((f) => ({ file: f, name: f.slice(0, -4).normalize('NFC') }));
  }
  const find = (name) => files().find((f) => keyOf(f.name) === keyOf(name));

  function parse(file) {
    const bytes = fs.readFileSync(path.join(dir, file));
    return buildSections(parseCsv(decodeCsvBytes(bytes)), { imageExists, draft: true });
  }

  function writeAtomic(file, text) {
    const target = path.join(dir, file);
    fs.writeFileSync(target + '.tmp', text);
    fs.renameSync(target + '.tmp', target);
  }

  function list() {
    return files().map(({ file, name }) => {
      const mtime = fs.statSync(path.join(dir, file)).mtimeMs;
      let res;
      try { res = parse(file); } catch (e) { res = { ok: false, error: e.message }; }
      if (!res.ok) return { name, mtime, sections: [], problems: [], error: res.error };
      return {
        name, mtime,
        sections: res.sections.map((s) => ({ name: s.name, type: s.type, questionCount: s.questions.length })),
        problems: res.problems,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  function read(rawName) {
    const name = cleanPartieName(rawName);
    const f = name && find(name);
    if (!f) return { ok: false, status: 404, error: 'Partie introuvable.' };
    const res = parse(f.file);
    if (!res.ok) return { ok: false, status: 422, error: res.error };
    return { ok: true, name: f.name, sections: res.sections, problems: res.problems };
  }

  // Écrit puis relit le CSV produit : ce qui est enregistré est exactement ce qu'on relira.
  function save(rawName, sections, { overwrite }) {
    const name = cleanPartieName(rawName);
    if (!name) return { ok: false, status: 400, error: 'Nom de partie invalide (60 caractères maximum, sans / \\ : * ? " < > |).' };
    const clean = cleanSections(sections);
    if (!clean) return { ok: false, status: 422, error: 'Partie invalide.' };
    const csv = writeCsv(clean);
    const check = buildSections(parseCsv(csv.slice(1)), { imageExists, draft: true });
    if (!check.ok) return { ok: false, status: 422, error: check.error };
    const existing = find(name);
    if (existing && !overwrite) return { ok: false, status: 409, error: 'Une partie porte déjà ce nom.' };
    writeAtomic(existing ? existing.file : `${name}.csv`, csv);
    return { ok: true, name: existing ? existing.name : name, problems: check.problems };
  }

  function rename(rawFrom, rawTo) {
    const from = cleanPartieName(rawFrom);
    const to = cleanPartieName(rawTo);
    const src = from && find(from);
    if (!src) return { ok: false, status: 404, error: 'Partie introuvable.' };
    if (!to) return { ok: false, status: 400, error: 'Nouveau nom invalide.' };
    const clash = find(to);
    if (clash && clash.file !== src.file) return { ok: false, status: 409, error: 'Une partie porte déjà ce nom.' };
    fs.renameSync(path.join(dir, src.file), path.join(dir, `${to}.csv`));
    return { ok: true, name: to };
  }

  function remove(rawName) {
    const name = cleanPartieName(rawName);
    const f = name && find(name);
    if (!f) return { ok: false, status: 404, error: 'Partie introuvable.' };
    fs.unlinkSync(path.join(dir, f.file));
    return { ok: true };
  }

  // Import d'un CSV fait ailleurs (Excel) : vérifié, puis réécrit au format standard.
  function importCsv(rawName, bytes) {
    const res = buildSections(parseCsv(decodeCsvBytes(bytes)), { imageExists, draft: true });
    if (!res.ok) return { ok: false, status: 422, error: res.error };
    return save(rawName, res.sections, { overwrite: false });
  }

  return { list, read, save, rename, remove, importCsv };
}

module.exports = { createPartiesStore, cleanPartieName };
