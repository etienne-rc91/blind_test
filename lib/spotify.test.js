const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSpotify, UNREACHABLE } = require('./spotify');

const CLIENT = '0123456789abcdef0123456789abcdef';
const REDIRECT = 'http://127.0.0.1:3000/spotify/callback';
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'buzzer-spotify-')), 'spotify.json');

// Faux fetch : chaque appel est noté, la réponse vient de handler(url, init).
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = await handler(String(url), init);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}
const tokenBody = (extra = {}) => ({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3600, token_type: 'Bearer', ...extra });
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Connecte un client : authUrl puis callback avec le state obtenu.
async function connect(spotify) {
  const state = new URL(spotify.authUrl()).searchParams.get('state');
  return spotify.handleCallback({ code: 'the-code', state });
}

test('auth url carries an S256 challenge of the verifier', async () => {
  const fetch = fakeFetch(() => ({ status: 200, body: tokenBody() }));
  const spotify = createSpotify({ file: tmpFile(), redirectUri: REDIRECT, clientId: CLIENT, fetch });
  const url = new URL(spotify.authUrl({ back: 'creation' }));
  assert.equal(url.origin + url.pathname, 'https://accounts.spotify.com/authorize');
  const p = url.searchParams;
  assert.equal(p.get('client_id'), CLIENT);
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('redirect_uri'), REDIRECT);
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.equal(p.get('scope'), 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state');
  assert.ok(p.get('state').length >= 16);
  const res = await spotify.handleCallback({ code: 'the-code', state: p.get('state') });
  assert.deepEqual(res, { ok: true, back: 'creation' });
  const form = new URLSearchParams(fetch.calls[0].init.body);
  const verifier = form.get('code_verifier');
  assert.match(verifier, /^[A-Za-z0-9\-._~]{43,128}$/);
  assert.equal(p.get('code_challenge'), b64url(crypto.createHash('sha256').update(verifier).digest()));
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), 'the-code');
  assert.equal(form.get('redirect_uri'), REDIRECT);
  assert.equal(form.get('client_id'), CLIENT);
});

test('auth url needs a client id', () => {
  const spotify = createSpotify({ file: tmpFile(), redirectUri: REDIRECT, fetch: fakeFetch(() => ({ status: 500 })) });
  assert.deepEqual(spotify.status(), { configured: false, connected: false });
  assert.equal(spotify.authUrl(), null);
  assert.equal(spotify.setClientId('pas-un-id'), false);
  assert.equal(spotify.setClientId(CLIENT.toUpperCase()), true);
  assert.deepEqual(spotify.status(), { configured: true, connected: false });
});

test('callback with an unknown state is refused', async () => {
  const fetch = fakeFetch(() => ({ status: 200, body: tokenBody() }));
  let t = 0;
  const spotify = createSpotify({ file: tmpFile(), redirectUri: REDIRECT, clientId: CLIENT, fetch, now: () => t });
  let res = await spotify.handleCallback({ code: 'c', state: 'inconnu' });
  assert.equal(res.ok, false);
  assert.match(res.error, /relancez/);
  // Un state ne sert qu’une fois.
  const state = new URL(spotify.authUrl()).searchParams.get('state');
  assert.equal((await spotify.handleCallback({ code: 'c', state })).ok, true);
  assert.equal((await spotify.handleCallback({ code: 'c', state })).ok, false);
  // Un state expire au bout de 10 minutes.
  const late = new URL(spotify.authUrl()).searchParams.get('state');
  t += 10 * 60 * 1000 + 1;
  assert.equal((await spotify.handleCallback({ code: 'c', state: late })).ok, false);
  assert.equal(fetch.calls.length, 1);
});

test('callback stores tokens and status becomes connected', async () => {
  const file = tmpFile();
  const fetch = fakeFetch(() => ({ status: 200, body: tokenBody() }));
  const spotify = createSpotify({ file, redirectUri: REDIRECT, fetch, now: () => 1000 });
  assert.equal(spotify.setClientId(CLIENT), true);
  assert.deepEqual(spotify.status(), { configured: true, connected: false });
  assert.equal((await connect(spotify)).ok, true);
  assert.deepEqual(spotify.status(), { configured: true, connected: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { clientId: CLIENT, refreshToken: 'ref-1', accessToken: 'acc-1', expiresAt: 1000 + 3600 * 1000 });
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  // Après un redémarrage, la connexion est toujours là.
  const again = createSpotify({ file, redirectUri: REDIRECT, fetch, now: () => 2000 });
  assert.deepEqual(again.status(), { configured: true, connected: true });
  assert.equal(await again.accessToken(), 'acc-1');
  again.disconnect();
  assert.deepEqual(again.status(), { configured: true, connected: false });
  assert.equal(await again.accessToken(), null);
});

test('callback reports a refusal by the user or by Spotify', async () => {
  const fetch = fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));
  const spotify = createSpotify({ file: tmpFile(), redirectUri: REDIRECT, clientId: CLIENT, fetch });
  let state = new URL(spotify.authUrl()).searchParams.get('state');
  let res = await spotify.handleCallback({ error: 'access_denied', state });
  assert.equal(res.ok, false);
  assert.equal(res.back, 'host');
  assert.equal(fetch.calls.length, 0);
  res = await connect(spotify);
  assert.equal(res.ok, false);
  assert.deepEqual(spotify.status(), { configured: true, connected: false });
});

test('access token is refreshed when about to expire', async () => {
  let t = 0;
  let n = 0;
  const fetch = fakeFetch(async (url, init) => {
    const form = new URLSearchParams(init.body);
    if (form.get('grant_type') === 'authorization_code') return { status: 200, body: tokenBody() };
    n += 1;
    await new Promise((r) => setImmediate(r));
    // Spotify peut omettre refresh_token : on garde l’ancien.
    return { status: 200, body: { access_token: `acc-${n + 1}`, expires_in: 3600 } };
  });
  const spotify = createSpotify({ file: tmpFile(), redirectUri: REDIRECT, clientId: CLIENT, fetch, now: () => t });
  await connect(spotify);
  t = 3600 * 1000 - 61 * 1000;
  assert.equal(await spotify.accessToken(), 'acc-1');
  t = 3600 * 1000 - 59 * 1000;
  const [a, b] = await Promise.all([spotify.accessToken(), spotify.accessToken()]);
  assert.deepEqual([a, b], ['acc-2', 'acc-2']);
  assert.equal(n, 1);
  const form = new URLSearchParams(fetch.calls[1].init.body);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), 'ref-1');
  assert.equal(form.get('client_id'), CLIENT);
  t += 3600 * 1000;
  assert.equal(await spotify.accessToken(), 'acc-3');
  assert.equal(new URLSearchParams(fetch.calls[2].init.body).get('refresh_token'), 'ref-1');
});

test('a revoked refresh token disconnects', async () => {
  let t = 0;
  const fetch = fakeFetch((url, init) => (new URLSearchParams(init.body).get('grant_type') === 'refresh_token'
    ? { status: 400, body: { error: 'invalid_grant' } } : { status: 200, body: tokenBody() }));
  const spotify = createSpotify({ file: tmpFile(), redirectUri: REDIRECT, clientId: CLIENT, fetch, now: () => t });
  await connect(spotify);
  t = 3600 * 1000;
  assert.equal(await spotify.accessToken(), null);
  assert.deepEqual(spotify.status(), { configured: true, connected: false });
});

const TRACK = {
  id: '4uLU6hMCjMI75M1A2tKUQC', name: 'Africa', duration_ms: 295500,
  artists: [{ name: 'Toto' }, { name: 'Autre' }],
  album: { images: [{ url: 'https://i.scdn.co/big', width: 640, height: 640 }, { url: 'https://i.scdn.co/small', width: 64, height: 64 }] },
};
const MAPPED = { id: TRACK.id, name: 'Africa', artists: 'Toto, Autre', durationSec: 296, cover: 'https://i.scdn.co/big' };

test('search maps tracks', async () => {
  const fetch = fakeFetch((url) => {
    if (url.startsWith('https://accounts.spotify.com/')) return { status: 200, body: tokenBody() };
    return { status: 200, body: { tracks: { items: [TRACK, { ...TRACK, id: 'x'.repeat(22), album: { images: [] } }] } } };
  });
  const spotify = createSpotify({ file: tmpFile(), redirectUri: REDIRECT, clientId: CLIENT, fetch });
  await connect(spotify);
  const res = await spotify.search('africa toto');
  assert.deepEqual(res, [MAPPED, { ...MAPPED, id: 'x'.repeat(22), cover: null }]);
  const call = fetch.calls[1];
  const url = new URL(call.url);
  assert.equal(url.origin + url.pathname, 'https://api.spotify.com/v1/search');
  assert.equal(url.searchParams.get('type'), 'track');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(url.searchParams.get('q'), 'africa toto');
  assert.equal(call.init.headers.Authorization, 'Bearer acc-1');
  assert.deepEqual(await spotify.search('   '), []);
  assert.equal(fetch.calls.length, 2);
});

test('track info is cached', async () => {
  const fetch = fakeFetch((url) => {
    if (url.startsWith('https://accounts.spotify.com/')) return { status: 200, body: tokenBody() };
    if (url.endsWith(TRACK.id)) return { status: 200, body: TRACK };
    return { status: 404, body: { error: { status: 404 } } };
  });
  const spotify = createSpotify({ file: tmpFile(), redirectUri: REDIRECT, clientId: CLIENT, fetch });
  await connect(spotify);
  assert.equal(spotify.cachedTrack(TRACK.id), undefined);
  assert.deepEqual(await spotify.track(TRACK.id), MAPPED);
  assert.equal(fetch.calls[1].url, `https://api.spotify.com/v1/tracks/${TRACK.id}`);
  assert.deepEqual(spotify.cachedTrack(TRACK.id), MAPPED);
  assert.deepEqual(await spotify.track(TRACK.id), MAPPED);
  assert.equal(fetch.calls.length, 2);
  assert.equal(await spotify.track('y'.repeat(22)), null);
});

test('network failure gives a clear error', async () => {
  let down = false;
  let t = 0;
  const fetch = fakeFetch(() => {
    if (down) throw new TypeError('fetch failed');
    return { status: 200, body: tokenBody() };
  });
  const spotify = createSpotify({ file: tmpFile(), redirectUri: REDIRECT, clientId: CLIENT, fetch, now: () => t });
  await connect(spotify);
  down = true;
  assert.equal(UNREACHABLE, 'Spotify injoignable : vérifiez la connexion internet.');
  await assert.rejects(spotify.search('africa'), { message: UNREACHABLE });
  await assert.rejects(spotify.track(TRACK.id), { message: UNREACHABLE });
  // Un rafraîchissement impossible faute de réseau ne déconnecte pas.
  t = 3600 * 1000;
  await assert.rejects(spotify.accessToken(), { message: UNREACHABLE });
  assert.equal(spotify.status().connected, true);
  const state = new URL(spotify.authUrl()).searchParams.get('state');
  assert.deepEqual(await spotify.handleCallback({ code: 'c', state }), { ok: false, error: UNREACHABLE, back: 'host' });
});

test('search when not connected is refused', async () => {
  const spotify = createSpotify({ file: tmpFile(), redirectUri: REDIRECT, clientId: CLIENT, fetch: fakeFetch(() => ({ status: 500 })) });
  await assert.rejects(spotify.search('africa'), { status: 401, message: 'Spotify n’est pas connecté.' });
});
