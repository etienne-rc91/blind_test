// Fichier de partie : lignes CSV → liste de manches, avec des erreurs qui citent la ligne du fichier.
const COLUMNS = ['manche', 'type', 'question', 'image', 'a', 'b', 'c', 'd', 'reponse'];
const HEADER_TEXT = 'manche;type;question;image;A;B;C;D;reponse';
const TYPES = ['buzzer', 'qcm'];
const LETTERS = ['A', 'B', 'C', 'D'];

// Un simple nom de fichier du dossier images/ : ni chemin, ni fichier caché.
const isSafeImageName = (name) => typeof name === 'string' && name !== '' && !/[\\/]/.test(name) && !name.startsWith('.');

// draft = true : une partie en cours de préparation. Ce qui manque (texte, proposition, réponse, image) devient
// un « problème » listé au lieu d'une erreur ; les erreurs de structure restent bloquantes.
function buildSections(rows, { imageExists, draft = false }) {
  if (!rows.length) return { ok: false, error: 'Le fichier est vide.' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (COLUMNS.some((c, i) => header[i] !== c)) {
    return { ok: false, error: `Ligne 1 : l’en-tête doit être « ${HEADER_TEXT} ».` };
  }

  const sections = [];
  const problems = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i += 1) {
    const line = i + 1;
    const fail = (msg) => ({ ok: false, error: `Ligne ${line} : ${msg}` });
    const [name, rawType, text, image, a, b, c, d, answer] = COLUMNS.map((_, k) => (rows[i][k] ?? '').trim());
    const type = rawType.toLowerCase();
    if (!name) return fail('le nom de la manche est vide.');
    if (!TYPES.includes(type)) return fail(`type « ${rawType} » inconnu (buzzer ou qcm).`);

    const last = sections[sections.length - 1];
    let section;
    if (last && last.name === name) {
      if (last.type !== type) return fail(`la manche « ${name} » a déjà le type ${last.type}.`);
      if (type === 'buzzer') return fail(`la manche buzzer « ${name} » tient sur une seule ligne.`);
      section = last;
    } else {
      if (seen.has(name)) return fail(`la manche « ${name} » apparaît déjà plus haut.`);
      seen.add(name);
      section = { name, type, questions: [] };
      sections.push(section);
    }
    if (type === 'buzzer') continue;

    // Ligne qcm entièrement vide : déclare la manche (écrite ainsi pour une manche QCM sans question).
    if (draft && ![text, image, a, b, c, d, answer].some(Boolean)) continue;
    if (image && !isSafeImageName(image)) return fail(`nom d’image « ${image} » invalide : indiquez seulement le nom du fichier.`);
    const choices = { A: a, B: b, C: c, D: d };
    const ans = answer.toUpperCase();
    const missing = [];
    if (!text && !image) missing.push(['la question n’a ni texte ni image.', 'ni texte ni image']);
    for (const l of LETTERS) if (!choices[l]) missing.push([`la proposition ${l} est vide.`, `proposition ${l} vide`]);
    if (!LETTERS.includes(ans)) missing.push(['la réponse doit être A, B, C ou D.', 'bonne réponse non choisie']);
    if (image && !imageExists(image)) missing.push([`image « ${image} » introuvable dans le dossier images/.`, `image « ${image} » introuvable`]);
    if (missing.length && !draft) return fail(missing[0][0]);
    const n = section.questions.length + 1;
    for (const [, short] of missing) problems.push(`${name}, question ${n} : ${short}`);
    section.questions.push({ text, image: image || null, choices, answer: LETTERS.includes(ans) ? ans : null });
  }

  if (!draft) {
    if (!sections.length) return { ok: false, error: 'Le fichier ne contient aucune manche.' };
    return { ok: true, sections };
  }
  for (const sec of sections) if (sec.type === 'qcm' && !sec.questions.length) problems.push(`${sec.name} : aucune question`);
  if (!sections.length) problems.push('Aucune manche');
  return { ok: true, sections, problems };
}

// Écriture au format attendu par Excel français : « ; », BOM UTF-8, guillemets seulement si nécessaire.
const CSV_HEADER = ['manche', 'type', 'question', 'image', 'A', 'B', 'C', 'D', 'reponse'];
const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function writeCsv(sections) {
  const lines = [CSV_HEADER];
  for (const sec of sections) {
    if (sec.type === 'buzzer' || !sec.questions.length) {
      lines.push([sec.name, sec.type, '', '', '', '', '', '', '']);
      continue;
    }
    for (const q of sec.questions) {
      lines.push([sec.name, sec.type, q.text, q.image || '', ...LETTERS.map((l) => q.choices[l]), q.answer || '']);
    }
  }
  return '\ufeff' + lines.map((l) => l.map(cell).join(';')).join('\r\n') + '\r\n';
}

module.exports = { buildSections, writeCsv, isSafeImageName };
