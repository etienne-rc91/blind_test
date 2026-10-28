// Fichier de partie : lignes CSV → liste de manches, avec des erreurs qui citent la ligne du fichier.
const { parseTime, formatTime, parseSource, formatSource } = require('./songs');

const COLUMNS = ['manche', 'type', 'question', 'image', 'a', 'b', 'c', 'd', 'reponse'];
const SONG_COLUMNS = ['musique', 'debut', 'fin'];
const HEADER_TEXT = 'manche;type;question;image;A;B;C;D;reponse;musique;debut;fin';
const TYPES = ['buzzer', 'qcm'];
const LETTERS = ['A', 'B', 'C', 'D'];

// Un simple nom de fichier du dossier images/ : ni chemin, ni fichier caché.
const isSafeImageName = (name) => typeof name === 'string' && name !== '' && !/[\\/]/.test(name) && !name.startsWith('.');

// Analyse des colonnes musique;debut;fin, communes aux morceaux buzzer et aux extraits QCM.
// Une source invalide est une erreur bloquante ; le reste manquant est listé dans `missing` ([message, version courte]).
function readExtract(music, rawStart, rawEnd, musicExists, label = 'morceau') {
  const src = music ? parseSource(music) : null;
  if (music && !src) return { error: `${label} « ${music} » invalide : nom de fichier du dossier musiques/ ou lien Spotify.` };
  const start = rawStart ? parseTime(rawStart) : null;
  const end = rawEnd ? parseTime(rawEnd) : null;
  const missing = [];
  if (!music) missing.push(['la musique est vide.', 'musique vide']);
  else if (src.source === 'file' && !musicExists(src.ref)) missing.push([`fichier « ${src.ref} » introuvable dans le dossier musiques/.`, `fichier « ${src.ref} » introuvable`]);
  if (start === null) missing.push([rawStart ? `début « ${rawStart} » illisible (m:ss).` : 'le début est manquant.', rawStart ? 'début illisible' : 'début manquant']);
  if (end === null) missing.push([rawEnd ? `fin « ${rawEnd} » illisible (m:ss).` : 'la fin est manquante.', rawEnd ? 'fin illisible' : 'fin manquante']);
  if (start !== null && end !== null && end <= start) missing.push(['la fin est avant le début.', 'fin avant le début']);
  return { src, start, end, missing };
}

// draft = true : une partie en cours de préparation. Ce qui manque (texte, proposition, réponse, image) devient
// un « problème » listé au lieu d'une erreur ; les erreurs de structure restent bloquantes.
function buildSections(rows, { imageExists, musicExists = () => true, draft = false }) {
  if (!rows.length) return { ok: false, error: 'Le fichier est vide.' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  // 12 colonnes seulement si la 10e cellule est « musique » ; sinon 9 colonnes et tout ce qui suit est ignoré.
  while (header.length > COLUMNS.length && header[header.length - 1] === '') header.pop();
  const withSongs = header[COLUMNS.length] === SONG_COLUMNS[0];
  const expected = withSongs ? [...COLUMNS, ...SONG_COLUMNS] : COLUMNS;
  if (expected.some((c, i) => header[i] !== c) || (withSongs && header.length !== expected.length)) {
    return { ok: false, error: `Ligne 1 : l’en-tête doit être « ${HEADER_TEXT} ».` };
  }

  const sections = [];
  const problems = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i += 1) {
    const line = i + 1;
    const fail = (msg) => ({ ok: false, error: `Ligne ${line} : ${msg}` });
    const [name, rawType, text, image, a, b, c, d, answer, music, rawStart, rawEnd] = [...COLUMNS, ...SONG_COLUMNS].map((_, k) => ((withSongs || k < COLUMNS.length) ? rows[i][k] ?? '' : '').trim());
    const type = rawType.toLowerCase();
    // Ancien fichier à 9 colonnes : une manche buzzer y est toujours libre, même avec du texte dans « reponse ».
    const songAnswer = withSongs ? answer : '';
    if (!name) return fail('le nom de la manche est vide.');
    if (!TYPES.includes(type)) return fail(`type « ${rawType} » inconnu (buzzer ou qcm).`);

    const last = sections[sections.length - 1];
    let section;
    if (last && last.name === name) {
      if (last.type !== type) return fail(`la manche « ${name} » a déjà le type ${last.type}.`);
      if (type === 'buzzer' && !(music || rawStart || rawEnd || songAnswer)) {
        return fail(`la manche buzzer « ${name} » : chaque ligne suivante doit décrire un morceau (colonne musique).`);
      }
      section = last;
    } else {
      if (seen.has(name)) return fail(`la manche « ${name} » apparaît déjà plus haut.`);
      seen.add(name);
      section = type === 'buzzer' ? { name, type, questions: [], songs: [] } : { name, type, questions: [] };
      sections.push(section);
    }
    if (type === 'buzzer') {
      // Ligne vide = manche libre (première ligne seulement) ; sinon un morceau.
      if (!(music || rawStart || rawEnd || songAnswer)) continue;
      const ext = readExtract(music, rawStart, rawEnd, musicExists);
      if (ext.error) return fail(ext.error);
      const { src, start, end, missing } = ext;
      if (!songAnswer) missing.push(['la réponse est vide.', 'réponse vide']);
      if (missing.length && !draft) return fail(missing[0][0]);
      const n = section.songs.length + 1;
      for (const [, short] of missing) problems.push(`${name}, morceau ${n} : ${short}`);
      section.songs.push({ source: src ? src.source : null, ref: src ? src.ref : null, start, end, answer: songAnswer });
      continue;
    }

    // Ligne qcm entièrement vide : question vide (gardée), ou simple déclaration si c'est la seule ligne de la manche.
    if (draft && ![text, image, a, b, c, d, answer, music, rawStart, rawEnd].some(Boolean)) {
      section.questions.push({ text: '', image: null, choices: { A: '', B: '', C: '', D: '' }, answer: null, empty: true });
      continue;
    }
    if (image && !isSafeImageName(image)) return fail(`nom d’image « ${image} » invalide : indiquez seulement le nom du fichier.`);
    const choices = { A: a, B: b, C: c, D: d };
    const ans = answer.toUpperCase();
    // Extrait facultatif : mêmes règles qu’un morceau, sans réponse (la réponse d’une question est sa lettre).
    const hasExtract = Boolean(music || rawStart || rawEnd);
    const ext = hasExtract ? readExtract(music, rawStart, rawEnd, musicExists, 'musique') : null;
    if (ext?.error) return fail(ext.error);
    const missing = [];
    if (!text && !image) missing.push(['la question n’a ni texte ni image.', 'ni texte ni image']);
    for (const l of LETTERS) if (!choices[l]) missing.push([`la proposition ${l} est vide.`, `proposition ${l} vide`]);
    if (!LETTERS.includes(ans)) missing.push(['la réponse doit être A, B, C ou D.', 'bonne réponse non choisie']);
    if (image && !imageExists(image)) missing.push([`image « ${image} » introuvable dans le dossier images/.`, `image « ${image} » introuvable`]);
    if (ext) missing.push(...ext.missing);
    if (missing.length && !draft) return fail(missing[0][0]);
    const n = section.questions.length + 1;
    for (const [, short] of missing) problems.push(`${name}, question ${n} : ${short}`);
    const question = { text, image: image || null, choices, answer: LETTERS.includes(ans) ? ans : null };
    if (ext) question.extract = { source: ext.src ? ext.src.source : null, ref: ext.src ? ext.src.ref : null, start: ext.start, end: ext.end };
    section.questions.push(question);
  }

  if (!draft) {
    if (!sections.length) return { ok: false, error: 'Le fichier ne contient aucune manche.' };
    return { ok: true, sections };
  }
  for (const sec of sections) {
    if (sec.questions.length === 1 && sec.questions[0].empty) sec.questions = [];
    sec.questions.forEach((q, k) => {
      if (q.empty) problems.push(`${sec.name}, question ${k + 1} : question vide`);
      delete q.empty;
    });
    if (sec.type === 'qcm' && !sec.questions.length) problems.push(`${sec.name} : aucune question`);
  }
  if (!sections.length) problems.push('Aucune manche');
  return { ok: true, sections, problems };
}

// Écriture au format attendu par Excel français : « ; », BOM UTF-8, guillemets seulement si nécessaire.
const CSV_HEADER = ['manche', 'type', 'question', 'image', 'A', 'B', 'C', 'D', 'reponse', 'musique', 'debut', 'fin'];
const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function writeCsv(sections) {
  const lines = [CSV_HEADER];
  for (const sec of sections) {
    if (sec.type === 'buzzer' && sec.songs?.length) {
      for (const song of sec.songs) {
        lines.push([sec.name, 'buzzer', '', '', '', '', '', '', song.answer || '', song.source ? formatSource(song) : '', formatTime(song.start), formatTime(song.end)]);
      }
      continue;
    }
    if (sec.type === 'buzzer' || !sec.questions.length) {
      lines.push([sec.name, sec.type, '', '', '', '', '', '', '', '', '', '']);
      continue;
    }
    for (const q of sec.questions) {
      const x = q.extract;
      lines.push([sec.name, sec.type, q.text, q.image || '', ...LETTERS.map((l) => q.choices[l]), q.answer || '', x?.source ? formatSource(x) : '', formatTime(x?.start), formatTime(x?.end)]);
    }
  }
  return '\ufeff' + lines.map((l) => l.map(cell).join(';')).join('\r\n') + '\r\n';
}

module.exports = { buildSections, writeCsv, isSafeImageName };
