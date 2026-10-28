// Connexion Spotify côté serveur : OAuth « Authorization Code » avec PKCE (pas de secret client),
// jetons gardés dans un fichier local, rafraîchis ici, recherche et infos de titres (avec cache).
// Sans dépendance : crypto et fetch de Node 18+. fetch et l’horloge sont injectés pour les tests.
// Les jetons ne sont jamais écrits dans la console ni dans un message d’erreur.
const crypto = require('crypto');
const fs = require('fs');

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
const STATE_TTL = 10 * 60 * 1000;
const REFRESH_MARGIN = 60 * 1000;
const TIMEOUT = 10 * 1000;
const CLIENT_ID = /^[0-9a-f]{32}$/i;

const UNREACHABLE = 'Spotify injoignable : vérifiez la connexion internet.';
const NOT_CONNECTED = 'Spotify n’est pas connecté.';
const STALE_STATE = 'Connexion expirée ou inconnue : relancez « Se connecter à Spotify ».';

// Erreur portant le code HTTP à renvoyer à la page.
function spotifyError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function mapTrack(t) {
  const images = (t.album && Array.isArray(t.album.images)) ? t.album.images : [];
  // La plus grande image (Spotify la donne d’habitude en premier, mais on ne s’y fie pas).
  const big = images.reduce((best, im) => (!best || (im.width || 0) > (best.width || 0) ? im : best), null);
  return {
    id: t.id,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name).join(', '),
    durationSec: Math.round((t.duration_ms || 0) / 1000),
    cover: big && big.url ? big.url : null,
  };
}

function createSpotify({ file, redirectUri, clientId: envClientId, fetch = globalThis.fetch, now = Date.now }) {
  let stored = { clientId: null, refreshToken: null, accessToken: null, expiresAt: 0 };
  const states = new Map();   // state → { verifier, back, expiresAt }
  const cache = new Map();    // id → titre
  let refreshing = null;      // rafraîchissement en cours, partagé par les demandes simultanées

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data === 'object') stored = { ...stored, ...data };
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`  Fichier Spotify illisible (${file}) : il faudra se reconnecter.`);
  }

  const clientId = () => envClientId || stored.clientId || null;

  // Écriture atomique, lisible par le seul utilisateur (le fichier contient le jeton de rafraîchissement).
  function save() {
    try {
      fs.writeFileSync(file + '.tmp', JSON.stringify(stored, null, 2), { mode: 0o600 });
      try { fs.chmodSync(file + '.tmp', 0o600); } catch {}   // un .tmp resté d’un arrêt brutal garde son ancien mode
      fs.renameSync(file + '.tmp', file);
    } catch (e) {
      console.error('  Sauvegarde de la connexion Spotify impossible :', e.code || 'erreur inconnue');
    }
  }

  function forgetTokens() {
    stored = { ...stored, refreshToken: null, accessToken: null, expiresAt: 0 };
    refreshing = null;
    save();
  }

  // Toute panne réseau (ou délai dépassé) devient le même message clair.
  async function call(url, init = {}) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
    } catch {
      throw spotifyError(503, UNREACHABLE);
    }
  }

  async function postToken(params) {
    const res = await call(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    let body = null;
    try { body = await res.json(); } catch {}
    return { res, body };
  }

  function storeTokens(body) {
    stored = {
      ...stored,
      clientId: stored.clientId || clientId(),
      accessToken: body.access_token,
      refreshToken: body.refresh_token || stored.refreshToken,   // un rafraîchissement peut l’omettre
      expiresAt: now() + Number(body.expires_in || 3600) * 1000,
    };
    save();
  }

  function status() {
    return { configured: !!clientId(), connected: !!clientId() && !!stored.refreshToken };
  }

  function setClientId(id) {
    if (typeof id !== 'string' || !CLIENT_ID.test(id.trim())) return false;
    const clean = id.trim().toLowerCase();
    // Les jetons appartiennent à une app Spotify : changer d’app oblige à se reconnecter.
    if (stored.clientId && stored.clientId !== clean) stored = { ...stored, refreshToken: null, accessToken: null, expiresAt: 0 };
    stored.clientId = clean;
    save();
    return true;
  }

  function authUrl({ back = 'host' } = {}) {
    const id = clientId();
    if (!id) return null;
    for (const [k, v] of states) if (v.expiresAt <= now()) states.delete(k);
    const verifier = b64url(crypto.randomBytes(64));   // 86 caractères du jeu non réservé
    const state = b64url(crypto.randomBytes(16));
    states.set(state, { verifier, back, expiresAt: now() + STATE_TTL });
    const params = new URLSearchParams({
      client_id: id,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      code_challenge_method: 'S256',
      code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    });
    return `${AUTHORIZE_URL}?${params}`;
  }

  async function handleCallback({ code, state, error } = {}) {
    const pending = typeof state === 'string' ? states.get(state) : undefined;
    if (pending) states.delete(state);   // usage unique
    if (!pending || pending.expiresAt <= now()) return { ok: false, error: STALE_STATE };
    const { back } = pending;
    if (error || typeof code !== 'string' || !code) return { ok: false, error: 'Connexion refusée ou annulée sur Spotify.', back };
    let r;
    try {
      r = await postToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId(), code_verifier: pending.verifier });
    } catch (e) {
      return { ok: false, error: e.message, back };
    }
    if (!r.res.ok || !r.body || !r.body.access_token || !r.body.refresh_token) {
      return { ok: false, error: `Spotify a refusé la connexion (code ${r.res.status}).`, back };
    }
    storeTokens(r.body);
    return { ok: true, back };
  }

  async function refresh() {
    const r = await postToken({ grant_type: 'refresh_token', refresh_token: stored.refreshToken, client_id: clientId() });
    if (r.res.status === 400 || r.res.status === 401) {   // jeton révoqué ou app changée : il faut se reconnecter
      forgetTokens();
      return null;
    }
    if (!r.res.ok || !r.body || !r.body.access_token) throw spotifyError(502, `Spotify a refusé le rafraîchissement (code ${r.res.status}).`);
    storeTokens(r.body);
    return stored.accessToken;
  }

  async function accessToken() {
    if (!status().connected) return null;
    if (stored.accessToken && stored.expiresAt - now() > REFRESH_MARGIN) return stored.accessToken;
    if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function apiGet(path) {
    const token = await accessToken();
    if (!token) throw spotifyError(401, NOT_CONNECTED);
    const res = await call(API + path, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw spotifyError(502, `Spotify a refusé la demande (code ${res.status}).`);
    try { return await res.json(); } catch { throw spotifyError(502, 'Réponse de Spotify illisible.'); }
  }

  async function search(q) {
    const text = String(q || '').trim();
    if (!text) return [];
    const params = new URLSearchParams({ type: 'track', limit: '10', q: text });
    const data = await apiGet(`/search?${params}`);
    const items = (data && data.tracks && Array.isArray(data.tracks.items)) ? data.tracks.items : [];
    return items.filter((t) => t && t.id).map((t) => {
      const m = mapTrack(t);
      cache.set(m.id, m);
      return m;
    });
  }

  async function track(id) {
    if (cache.has(id)) return cache.get(id);
    const data = await apiGet(`/tracks/${encodeURIComponent(id)}`);
    if (!data || !data.id) return null;
    const m = mapTrack(data);
    cache.set(id, m);
    return m;
  }

  const cachedTrack = (id) => cache.get(id);

  function disconnect() {
    forgetTokens();
  }

  return { status, setClientId, authUrl, handleCallback, accessToken, search, track, cachedTrack, disconnect };
}

module.exports = { createSpotify, UNREACHABLE, NOT_CONNECTED };
