// Aides pures pour les morceaux d’une manche buzzer : temps, source (fichier ou Spotify), validation.
// Sans effet de bord : utilisées par le format CSV, l’état de jeu et le serveur.

const MUSIC_TYPES = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'flac'];

// Un identifiant de morceau Spotify : exactement 22 caractères base62.
const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
// Lien copié depuis Spotify : paramètre de requête (?si=…) et segment de langue (/intl-fr/) ignorés.
const SPOTIFY_URL = /^https:\/\/open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?track\/([0-9A-Za-z]{22})(?:[?#].*)?$/;

// « m:ss » (secondes 00–59) ou secondes entières ; tout le reste est refusé.
function parseTime(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(\d+):([0-5]\d)$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function formatTime(sec) {
  if (!Number.isInteger(sec) || sec < 0) return '';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// Même règle que isSafeImageName (simple nom de fichier, ni chemin, ni fichier caché) + extension audio connue.
// Réécrite ici pour que ce module reste sans dépendance.
function isSafeMusicName(name) {
  if (typeof name !== 'string' || name === '' || /[\\/]/.test(name) || name.startsWith('.')) return false;
  const dot = name.lastIndexOf('.');
  return dot > 0 && MUSIC_TYPES.includes(name.slice(dot + 1).toLowerCase());
}

function parseSource(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  const uri = /^spotify:track:(.+)$/.exec(t);
  if (uri) return SPOTIFY_ID.test(uri[1]) ? { source: 'spotify', ref: uri[1] } : null;
  const url = SPOTIFY_URL.exec(t);
  if (url) return { source: 'spotify', ref: url[1] };
  return isSafeMusicName(t) ? { source: 'file', ref: t } : null;
}

function formatSource({ source, ref }) {
  return source === 'spotify' ? `spotify:track:${ref}` : ref;
}

const isSecond = (n) => Number.isInteger(n) && n >= 0;

function isSong(x) {
  if (!x || typeof x !== 'object') return false;
  const okRef = x.source === 'spotify' ? typeof x.ref === 'string' && SPOTIFY_ID.test(x.ref)
    : x.source === 'file' ? isSafeMusicName(x.ref) : false;
  return okRef && isSecond(x.start) && isSecond(x.end) && x.start < x.end
    && typeof x.answer === 'string' && x.answer.trim() !== '';
}

module.exports = { MUSIC_TYPES, parseTime, formatTime, isSafeMusicName, parseSource, formatSource, isSong };
