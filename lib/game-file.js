// Fichier de partie : lignes CSV → liste de manches, avec des erreurs qui citent la ligne du fichier.
const COLUMNS = ['manche', 'type', 'question', 'image', 'a', 'b', 'c', 'd', 'reponse'];
const HEADER_TEXT = 'manche;type;question;image;A;B;C;D;reponse';
const TYPES = ['buzzer', 'qcm'];
const LETTERS = ['A', 'B', 'C', 'D'];

// Un simple nom de fichier du dossier images/ : ni chemin, ni fichier caché.
const isSafeImageName = (name) => typeof name === 'string' && name !== '' && !/[\\/]/.test(name) && !name.startsWith('.');

function buildSections(rows, { imageExists }) {
  if (!rows.length) return { ok: false, error: 'Le fichier est vide.' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (COLUMNS.some((c, i) => header[i] !== c)) {
    return { ok: false, error: `Ligne 1 : l’en-tête doit être « ${HEADER_TEXT} ».` };
  }

  const sections = [];
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

    if (!text && !image) return fail('la question n’a ni texte ni image.');
    const choices = { A: a, B: b, C: c, D: d };
    const empty = LETTERS.find((l) => !choices[l]);
    if (empty) return fail(`la proposition ${empty} est vide.`);
    const ans = answer.toUpperCase();
    if (!LETTERS.includes(ans)) return fail('la réponse doit être A, B, C ou D.');
    if (image && !isSafeImageName(image)) return fail(`nom d’image « ${image} » invalide : indiquez seulement le nom du fichier.`);
    if (image && !imageExists(image)) return fail(`image « ${image} » introuvable dans le dossier images/.`);
    section.questions.push({ text, image: image || null, choices, answer: ans });
  }

  if (!sections.length) return { ok: false, error: 'Le fichier ne contient aucune manche.' };
  return { ok: true, sections };
}

module.exports = { buildSections, isSafeImageName };
