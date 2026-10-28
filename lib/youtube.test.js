const test = require('node:test');
const assert = require('node:assert/strict');
const { createYoutube, UNREACHABLE } = require('./youtube');

const ID = 'dQw4w9WgXcQ';

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

async function rejectsWith(promise, status, message) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.status, status);
    assert.equal(e.message, message);
    return true;
  });
}

test('info gives the title and the thumbnail', async () => {
  const fetch = fakeFetch(() => ({ status: 200, body: { title: 'Never Gonna Give You Up', author_name: 'Rick Astley' } }));
  const yt = createYoutube({ fetch });
  assert.deepEqual(await yt.info(ID), { id: ID, title: 'Never Gonna Give You Up', thumbnail: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg` });
  assert.equal(fetch.calls.length, 1);
  const url = new URL(fetch.calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://www.youtube.com/oembed');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('url'), `https://www.youtube.com/watch?v=${ID}`);
});

test('second call is served from memory', async () => {
  const fetch = fakeFetch(() => ({ status: 200, body: { title: 'Titre' } }));
  const yt = createYoutube({ fetch });
  await yt.info(ID);
  assert.deepEqual(await yt.info(ID), { id: ID, title: 'Titre', thumbnail: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg` });
  assert.equal(fetch.calls.length, 1);
});

test('missing or private video is a 404', async () => {
  const yt = createYoutube({ fetch: fakeFetch(() => ({ status: 404, body: null })) });
  await rejectsWith(yt.info(ID), 404, 'Vidéo introuvable ou privée.');
});

test('embedding refused by the owner is a 403', async () => {
  for (const status of [401, 403]) {
    const yt = createYoutube({ fetch: fakeFetch(() => ({ status, body: null })) });
    await rejectsWith(yt.info(ID), 403, 'Le propriétaire de cette vidéo interdit sa lecture ailleurs que sur YouTube.');
  }
});

test('network failure is a 503 and is not remembered', async () => {
  let down = true;
  const fetch = fakeFetch(() => { if (down) throw new TypeError('fetch failed'); return { status: 200, body: { title: 'Revenu' } }; });
  const yt = createYoutube({ fetch });
  await rejectsWith(yt.info(ID), 503, UNREACHABLE);
  assert.equal(UNREACHABLE, 'YouTube injoignable : vérifiez la connexion internet.');
  down = false;
  assert.equal((await yt.info(ID)).title, 'Revenu');
});

test('a late answer is a 503', async () => {
  // fetch qui ne répond jamais, sauf à l’abandon demandé par le délai.
  const fetch = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const yt = createYoutube({ fetch, timeoutMs: 20 });
  await rejectsWith(yt.info(ID), 503, UNREACHABLE);
});
