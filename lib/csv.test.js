const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeCsvBytes, parseCsv } = require('./csv');

// Encodage Windows-1252 à la main (sous-ensemble utile : ASCII + é è ’).
const cp1252 = (str) => Buffer.from([...str].map((c) => ({ 'é': 0xe9, 'è': 0xe8, '’': 0x92 }[c] ?? c.charCodeAt(0))));

test('strips the UTF-8 BOM', () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('manche;type', 'utf8')]);
  assert.equal(decodeCsvBytes(bytes), 'manche;type');
});

test('decodes plain UTF-8 accents', () => {
  assert.equal(decodeCsvBytes(Buffer.from('Cinéma', 'utf8')), 'Cinéma');
});

test('parses an Excel windows-1252 export', () => {
  const text = decodeCsvBytes(cp1252('manche;type\r\nCinéma;buzzer\r\n"Culture; G";qcm\r\nL’été;qcm\r\n'));
  assert.deepEqual(parseCsv(text), [['manche', 'type'], ['Cinéma', 'buzzer'], ['Culture; G', 'qcm'], ['L’été', 'qcm']]);
});

test('detects comma separator', () => {
  assert.deepEqual(parseCsv('manche,type\nA,buzzer'), [['manche', 'type'], ['A', 'buzzer']]);
});

test('semicolon wins when the header has more semicolons', () => {
  assert.deepEqual(parseCsv('a;b;c\n1,5;2;3'), [['a', 'b', 'c'], ['1,5', '2', '3']]);
});

test('handles escaped quotes and newlines inside quotes', () => {
  assert.deepEqual(parseCsv('q;r\n"Il a dit ""oui""\nensuite";x'), [['q', 'r'], ['Il a dit "oui"\nensuite', 'x']]);
});

test('keeps empty cells', () => {
  assert.deepEqual(parseCsv('a;b;c\nx;;\n'), [['a', 'b', 'c'], ['x', '', '']]);
});

test('skips blank lines', () => {
  assert.deepEqual(parseCsv('a;b\n\n\r\nx;y\n\n'), [['a', 'b'], ['x', 'y']]);
});

test('empty text gives no rows', () => {
  assert.deepEqual(parseCsv(''), []);
});
