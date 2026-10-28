// Aides pures pour les morceaux d’une manche buzzer : temps, source (fichier audio, fichier vidéo, Spotify ou YouTube), validation.
// Sans effet de bord : utilisées par le format CSV, l’état de jeu et le serveur.

const MUSIC_TYPES = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'flac'];
const VIDEO_TYPES = ['mp4', 'webm', 'm4v', 'mov'];

// Un identifiant de morceau Spotify : exactement 22 caractères base62.
const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
// Lien copié depuis Spotify : paramètre de requête (?si=…) et segment de langue (/intl-fr/) ignorés.
const SPOTIFY_URL = /^https:\/\/open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?track\/([0-9A-Za-z]{22})(?:[?#].*)?$/;

// Un identifiant de vidéo YouTube : exactement 11 caractères (lettres, chiffres, « _ » et « - »).
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
// Liens acceptés (http ou https) : watch?v=…, youtu.be/…, shorts/… ; le reste de la requête (t=, si=…) est ignoré.
const YOUTUBE_SHORT = /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{11})(?:[?#].*)?$/;
const YOUTUBE_SHORTS = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{11})(?:[?#].*)?$/;
const YOUTUBE_WATCH = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})(?:[&#].*)?$/;

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
function hasSafeName(name, types) {
  if (typeof name !== 'string' || name === '' || /[\\/]/.test(name) || name.startsWith('.')) return false;
  const dot = name.lastIndexOf('.');
  return dot > 0 && types.includes(name.slice(dot + 1).toLowerCase());
}
const isSafeMusicName = (name) => hasSafeName(name, MUSIC_TYPES);
const isSafeVideoName = (name) => hasSafeName(name, VIDEO_TYPES);
// Les sources qui passent par le Grand écran en vidéo.
const isVideoSource = (source) => source === 'video' || source === 'youtube';

function parseSource(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  const uri = /^spotify:track:(.+)$/.exec(t);
  if (uri) return SPOTIFY_ID.test(uri[1]) ? { source: 'spotify', ref: uri[1] } : null;
  const url = SPOTIFY_URL.exec(t);
  if (url) return { source: 'spotify', ref: url[1] };
  const yt = /^youtube:(.+)$/.exec(t);
  if (yt) return YOUTUBE_ID.test(yt[1]) ? { source: 'youtube', ref: yt[1] } : null;
  const link = YOUTUBE_WATCH.exec(t) || YOUTUBE_SHORT.exec(t) || YOUTUBE_SHORTS.exec(t);
  if (link) return { source: 'youtube', ref: link[1] };
  if (isSafeVideoName(t)) return { source: 'video', ref: t };
  return isSafeMusicName(t) ? { source: 'file', ref: t } : null;
}

function formatSource({ source, ref }) {
  if (source === 'spotify') return `spotify:track:${ref}`;
  return source === 'youtube' ? `youtube:${ref}` : ref;
}

const isSecond = (n) => Number.isInteger(n) && n >= 0;

// Un extrait : source valide et fenêtre d’écoute cohérente, sans réponse (celle d’une question QCM est la lettre).
function isExtract(x) {
  if (!x || typeof x !== 'object') return false;
  const okRef = x.source === 'spotify' ? typeof x.ref === 'string' && SPOTIFY_ID.test(x.ref)
    : x.source === 'youtube' ? typeof x.ref === 'string' && YOUTUBE_ID.test(x.ref)
    : x.source === 'video' ? isSafeVideoName(x.ref)
    : x.source === 'file' ? isSafeMusicName(x.ref) : false;
  return okRef && isSecond(x.start) && isSecond(x.end) && x.start < x.end;
}

// Un morceau de manche buzzer : un extrait plus la réponse attendue.
function isSong(x) {
  return isExtract(x) && typeof x.answer === 'string' && x.answer.trim() !== '';
}

module.exports = { MUSIC_TYPES, VIDEO_TYPES, YOUTUBE_ID, parseTime, formatTime, isSafeMusicName, isSafeVideoName, isVideoSource, parseSource, formatSource, isExtract, isSong };
