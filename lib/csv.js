// Lecture des fichiers CSV de partie, sans dépendance.

// Excel enregistre en UTF-8 (« CSV UTF-8 ») ou en Windows-1252 (« CSV » tout court) : on accepte les deux.
function decodeCsvBytes(bytes) {
  const buf = Buffer.from(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);   // retire aussi le BOM
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

// Séparateur : celui qui apparaît le plus sur la première ligne, hors guillemets (Excel français utilise « ; »).
function detectSeparator(text) {
  let semi = 0, comma = 0, quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && c === ';') semi += 1;
    else if (!quoted && c === ',') comma += 1;
  }
  return semi >= comma ? ';' : ',';
}

// Guillemets à la RFC 4180 : "" vaut un guillemet, les retours à la ligne sont permis entre guillemets.
// Les lignes dont toutes les cellules sont vides sont ignorées (lignes blanches, fin de fichier Excel).
function parseCsv(text) {
  const sep = detectSeparator(text);
  const rows = [];
  let row = [], cell = '', quoted = false;
  const endRow = () => {
    row.push(cell); cell = '';
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\r') { if (text[i + 1] !== '\n') endRow(); }
    else if (c === '\n') endRow();
    else cell += c;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

module.exports = { decodeCsvBytes, parseCsv };
