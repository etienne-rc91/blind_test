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
const second = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
function cleanSong(x) {
  const source = ['file', 'spotify', 'video', 'youtube'].includes(x?.source) ? x.source : null;
  const ref = source && typeof x.ref === 'string' && x.ref ? x.ref : null;
  return { source: ref ? source : null, ref, start: second(x?.start), end: second(x?.end), answer: str(x?.answer).trim() };
}
// Extrait d’une question QCM : comme un morceau, sans réponse. Aucun champ renseigné = pas d’extrait.
function cleanExtract(x) {
  const { answer, ...extract } = cleanSong(x);
  return extract.ref || extract.start !== null || extract.end !== null ? extract : null;
}
function cleanSections(sections) {
  if (!Array.isArray(sections)) return null;
  return sections.map((s) => ({
    name: str(s?.name).trim(),
    type: str(s?.type),
    ...(s?.type === 'buzzer' ? { songs: Array.isArray(s.songs) ? s.songs.map(cleanSong).filter((x) => x.ref || x.start !== null || x.end !== null || x.answer) : [] } : {}),
    questions: Array.isArray(s?.questions) ? s.questions.map((q) => {
      const extract = cleanExtract(q?.extract);
      return {
        text: str(q?.text),
        image: str(q?.image) || null,
        choices: Object.fromEntries(LETTERS.map((l) => [l, str(q?.choices?.[l])])),
        answer: LETTERS.includes(q?.answer) ? q.answer : null,
        ...(extract ? { extract } : {}),
      };
    }) : [],
  }));
}

function createPartiesStore({ dir, imageExists, musicExists, videoExists }) {
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
    return buildSections(parseCsv(decodeCsvBytes(bytes)), { imageExists, musicExists, videoExists, draft: true });
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
        sections: res.sections.map((s) => ({
          name: s.name, type: s.type, questionCount: s.questions.length,
          songCount: s.songs ? s.songs.length : 0,
          spotifyCount: (s.songs ? s.songs.filter((x) => x.source === 'spotify').length : 0)
            + s.questions.filter((q) => q.extract?.source === 'spotify').length,
        })),
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

  // Prépare une partie reçue de la page Création : champs nettoyés, puis écrite et relue en mémoire.
  // Ce qui est renvoyé est exactement ce qui sera relu du fichier ; toute différence de structure est refusée.
  function prepare(sections) {
    const clean = cleanSections(sections);
    if (!clean) return { ok: false, status: 422, error: 'Partie invalide.' };
    const seen = new Set();
    for (const s of clean) {
      if (!s.name) return { ok: false, status: 422, error: 'Une manche n’a pas de nom.' };
      const k = s.name.toLowerCase();
      if (seen.has(k)) return { ok: false, status: 422, error: `Deux manches portent le nom « ${s.name} » : donnez-leur des noms différents.` };
      seen.add(k);
    }
    const csv = writeCsv(clean);
    const back = buildSections(parseCsv(csv.slice(1)), { imageExists, musicExists, videoExists, draft: true });
    if (!back.ok) return { ok: false, status: 422, error: back.error };
    const shape = (list) => JSON.stringify(list.map((s) => [s.type, s.type === 'qcm' ? s.questions.length : 0, s.songs ? s.songs.length : 0]));
    if (shape(back.sections) !== shape(clean.map((s) => (s.type === 'buzzer' ? { ...s, questions: [] } : s)))) {
      return { ok: false, status: 422, error: 'Partie invalide : sa structure ne peut pas être enregistrée telle quelle.' };
    }
    return { ok: true, sections: back.sections, problems: back.problems, csv };
  }

  // overwrite : « Enregistrer » une partie existante ; sinon nouvelle partie (« Enregistrer sous », import).
  function save(rawName, sections, { overwrite }) {
    const name = cleanPartieName(rawName);
    if (!name) return { ok: false, status: 400, error: 'Nom de partie invalide (60 caractères maximum, sans / \\ : * ? " < > |).' };
    const prep = prepare(sections);
    if (!prep.ok) return prep;
    const existing = find(name);
    if (existing && !overwrite) return { ok: false, status: 409, error: 'Une partie porte déjà ce nom.' };
    if (!existing && overwrite) return { ok: false, status: 404, error: 'Cette partie a été renommée ou supprimée entre-temps : utilisez « Enregistrer sous ».' };
    writeAtomic(existing ? existing.file : `${name}.csv`, prep.csv);
    return { ok: true, name: existing ? existing.name : name, problems: prep.problems };
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
    const res = buildSections(parseCsv(decodeCsvBytes(bytes)), { imageExists, musicExists, videoExists, draft: true });
    if (!res.ok) return { ok: false, status: 422, error: res.error };
    return save(rawName, res.sections, { overwrite: false });
  }

  const prepareOut = (sections) => { const r = prepare(sections); if (r.ok) delete r.csv; return r; };
  return { list, read, prepare: prepareOut, save, rename, remove, importCsv };
}

module.exports = { createPartiesStore, cleanPartieName };
