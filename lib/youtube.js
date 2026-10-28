// Infos d’une vidéo YouTube (titre et miniature) par l’oEmbed public de YouTube : sans clé ni compte.
// Sans dépendance externe : fetch de Node 18+, injecté pour les tests. Les résultats sont gardés en mémoire.
const { youtubeThumbnail } = require('./songs');

const OEMBED_URL = 'https://www.youtube.com/oembed';
const UNREACHABLE = 'YouTube injoignable : vérifiez la connexion internet.';
const NOT_FOUND = 'Vidéo introuvable ou privée.';
const EMBED_REFUSED = 'Le propriétaire de cette vidéo interdit sa lecture ailleurs que sur YouTube.';

// Erreur portant le code HTTP à renvoyer à la page.
function youtubeError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function createYoutube({ fetch = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const cache = new Map();   // id → { id, title, thumbnail }

  async function info(id) {
    if (cache.has(id)) return cache.get(id);
    const params = new URLSearchParams({ format: 'json', url: `https://www.youtube.com/watch?v=${id}` });
    let res;
    try {
      res = await fetch(`${OEMBED_URL}?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw youtubeError(503, UNREACHABLE);   // panne réseau ou délai dépassé
    }
    if (res.status === 404) throw youtubeError(404, NOT_FOUND);
    if (res.status === 401 || res.status === 403) throw youtubeError(403, EMBED_REFUSED);
    if (!res.ok) throw youtubeError(502, `YouTube a refusé la demande (code ${res.status}).`);
    let body;
    try { body = await res.json(); } catch { throw youtubeError(502, 'Réponse de YouTube illisible.'); }
    const title = body && typeof body.title === 'string' ? body.title : '';
    const v = { id, title, thumbnail: youtubeThumbnail(id) };
    cache.set(id, v);
    return v;
  }

  return { info };
}

module.exports = { createYoutube, UNREACHABLE };
