// Lecteurs de morceaux partagés par la Régie et la page Création (script classique, pas de module ni de build).
// Players.create(source, opts) renvoie un lecteur qui expose la même interface quelle que soit la source :
//   load(song), seek(sec), play(), pause(), position(), duration() (promesses) et onError(fn(message)).
// Spotify : opts = { getToken, name } ; une seule instance par page ; prepare() démarre l’appareil à l’avance,
// activate() est à appeler dans un geste de l’animateur.
// Le lecteur ne décide de rien : la page appelle play / pause selon l’état reçu du serveur.
(function () {
  'use strict';

  const READY_TIMEOUT = 5000;   // ms : au-delà, le chargement est abandonné avec un message
  const UNREACHABLE = 'Spotify injoignable : vérifiez la connexion internet.';

  // Rejette avec `message` si la promesse ne s’est pas conclue à temps.
  function withTimeout(promise, ms, message) {
    let timer;
    const late = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const MEDIA_ERRORS = {
    1: 'lecture interrompue',
    2: 'erreur réseau',
    3: 'fichier illisible',
    4: 'fichier introuvable ou format non pris en charge',
  };

  // Morceau fichier : un élément <audio> servi par le serveur local sous /musiques/<ref>. Pause instantanée, sans internet.
  function createFilePlayer() {
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    let errorFn = () => {};
    let ref = null;

    audio.addEventListener('error', () => {
      if (!audio.error) return;
      errorFn(MEDIA_ERRORS[audio.error.code] || 'erreur inconnue');
    });

    // Attend que la durée soit connue (ou une erreur) : avant, changer currentTime n’est pas fiable partout.
    // Délai borné : un fichier qui ne répond pas ne doit pas bloquer les mises à jour suivantes de la Régie.
    function whenReady() {
      if (audio.readyState >= 1) return Promise.resolve();
      return withTimeout(new Promise((resolve) => {
        const done = () => {
          audio.removeEventListener('loadedmetadata', done);
          audio.removeEventListener('error', done);
          resolve();
        };
        audio.addEventListener('loadedmetadata', done);
        audio.addEventListener('error', done);
      }), READY_TIMEOUT, 'le fichier ne se charge pas (délai dépassé)');
    }

    return {
      load(song) {
        // Même fichier (R, ou retour sur le même morceau) : on garde ce qui est déjà chargé, seul seek() repart de Début.
        if (song.ref !== ref || audio.error) {
          ref = song.ref;
          audio.src = '/musiques/' + encodeURIComponent(song.ref);
          audio.load();
        }
        return Promise.resolve();
      },
      seek(sec) {
        return whenReady().then(() => {
          if (audio.readyState >= 1) audio.currentTime = sec;
        });
      },
      play() {
        return audio.play().catch((e) => {
          if (e && e.name === 'AbortError') return;                 // un pause() a interrompu le play() : voulu
          if (e && e.name === 'NotAllowedError') throw new Error('cliquez dans la page ou appuyez sur une touche pour activer le son');
          throw new Error(audio.error ? (MEDIA_ERRORS[audio.error.code] || 'erreur inconnue') : (e && e.message) || 'erreur inconnue');
        });
      },
      pause() {
        audio.pause();
        return Promise.resolve();
      },
      position() {
        return Promise.resolve(audio.currentTime || 0);
      },
      duration() {
        return Promise.resolve(Number.isFinite(audio.duration) ? audio.duration : null);
      },
      onError(fn) {
        errorFn = typeof fn === 'function' ? fn : () => {};
      },
    };
  }

  // ---------- Spotify : la page devient un appareil Spotify (Web Playback SDK) ----------
  // Rien n’est chargé depuis internet tant qu’aucun lecteur Spotify n’est demandé : une partie sans Spotify reste hors ligne.
  // Seul le lancement d’un titre passe par la Web API ; pause, reprise, position et déplacement restent locaux (SDK).
  const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
  const API_PLAY = 'https://api.spotify.com/v1/me/player/play';
  const FETCH_TIMEOUT = 5000;
  const SDK_ERRORS = {
    initialization_error: 'Le lecteur Spotify ne démarre pas dans ce navigateur (Chrome, Edge ou Firefox récent requis).',
    authentication_error: 'Spotify a refusé la connexion : reconnectez Spotify puis rechargez la page.',
    account_error: 'Spotify Premium requis.',
    playback_error: 'Spotify n’a pas pu lire ce titre.',
  };

  let sdkPromise = null;
  function loadSdk() {
    if (window.Spotify && window.Spotify.Player) return Promise.resolve(window.Spotify);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      // Le SDK appelle cette fonction une fois chargé : elle doit exister avant l’injection du script.
      window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify);
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      script.onerror = () => { script.remove(); reject(new Error(UNREACHABLE)); };
      document.head.append(script);
    }).catch((e) => { sdkPromise = null; throw e; });   // panne réseau : le prochain essai réinjecte le script
    return sdkPromise;
  }

  async function fetchTimeout(url, init) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch {
      throw new Error(UNREACHABLE);
    } finally {
      clearTimeout(timer);
    }
  }

  async function playError(res) {
    let reason = '';
    try { const b = await res.json(); reason = (b && b.error && b.error.reason) || ''; } catch {}
    if (res.status === 401) return 'Spotify a refusé le jeton : reconnectez Spotify.';
    if (res.status === 403 && reason === 'PREMIUM_REQUIRED') return SDK_ERRORS.account_error;
    if (res.status === 404) return 'Appareil Spotify introuvable : rechargez la page.';
    if (res.status === 429) return 'Spotify limite les demandes : réessayez dans quelques secondes.';
    return `Spotify a refusé la lecture (code ${res.status}).`;
  }

  let spotifyPlayer = null;   // un seul appareil Spotify par page
  function createSpotifyPlayer(opts = {}) {
    if (spotifyPlayer) return spotifyPlayer;
    const getToken = typeof opts.getToken === 'function' ? opts.getToken : () => Promise.reject(new Error('Spotify n’est pas connecté.'));
    let errorFn = () => {};
    let sdk = null;             // Spotify.Player
    let deviceId = null;
    let starting = false;       // chargement du SDK ou connexion de l’appareil en cours
    let fatal = null;           // erreur qui empêche l’appareil de marcher jusqu’au rechargement de la page
    let waiters = [];           // demandes qui attendent l’appareil
    let ref = null;             // titre demandé (identifiant Spotify)
    let started = false;        // le titre `ref` a été lancé sur cet appareil
    let startedAt = 0;
    let at = 0;                 // position voulue (s) tant que le titre n’est pas lancé, puis dernière position lue
    let want = 'pause';         // dernière intention de la page : une pause demandée pendant un lancement l’emporte
    let last = null;            // dernière position brute du SDK, pour l’extrapoler s’il ne l’avance pas entre deux lectures

    const report = (msg) => errorFn(msg);
    function settle(err) {
      const list = waiters; waiters = [];
      for (const w of list) { if (err) w.reject(err); else w.resolve(deviceId); }
    }
    function fail(code, message) {
      const msg = SDK_ERRORS[code] || message || 'Erreur Spotify inconnue.';
      if (code !== 'playback_error') { fatal = msg; settle(new Error(msg)); }
      report(msg);
    }
    function isOurs(st) {
      const t = st && st.track_window && st.track_window.current_track;
      if (!t || !ref) return false;
      return t.id === ref || (t.linked_from && t.linked_from.id === ref) || t.uri === 'spotify:track:' + ref;
    }
    async function ourState() {
      if (!sdk) return null;
      const st = await sdkCall(() => sdk.getCurrentState());
      return isOurs(st) ? st : null;
    }
    // Toute commande du SDK a un délai : une panne Spotify ne doit jamais bloquer la file de la Régie.
    const sdkCall = (fn) => withTimeout(Promise.resolve().then(fn), READY_TIMEOUT, 'Spotify ne répond pas (délai dépassé).');
    // L’extrapolation ne compte que le temps écoulé depuis la dernière valeur brute vue en lecture :
    // en pause, aucune base n’est gardée, sinon la reprise ajouterait toute la durée de la pause.
    function readPos(st) {
      const now = Date.now();
      if (st.paused) last = null;
      else if (!last || last.raw !== st.position) last = { raw: st.position, at: now };
      const ms = st.paused ? st.position : st.position + (now - last.at);
      return Math.min(ms, st.duration || Infinity) / 1000;
    }

    function start() {
      if (sdk || starting || fatal) return;
      // Le SDK exige un contexte sécurisé : http://127.0.0.1 ou http://localhost, pas l’adresse du réseau local.
      if (!window.isSecureContext) {
        fatal = 'Spotify ne peut jouer que dans une page ouverte sur 127.0.0.1 ou localhost.';
        settle(new Error(fatal));
        return;
      }
      starting = true;
      // Jeton d’abord : Spotify non connecté → message clair, sans rien charger depuis internet ; on réessaiera au prochain besoin.
      getToken().then(() => loadSdk()).then((Spotify) => {
        sdk = new Spotify.Player({
          name: opts.name || 'Blind test',
          volume: 1,
          // Appelé par le SDK à chaque besoin : le serveur rafraîchit le jeton si nécessaire.
          getOAuthToken: (cb) => {
            getToken().then(cb, (e) => {
              const err = new Error((e && e.message) || UNREACHABLE);
              settle(err); report(err.message);   // sans jeton, l’appareil ne sera jamais prêt : inutile d’attendre le délai
            });
          },
        });
        sdk.addListener('ready', ({ device_id: id }) => { deviceId = id; settle(null); });
        sdk.addListener('not_ready', () => {
          if (started && want === 'play') report(UNREACHABLE);
          deviceId = null; started = false;
        });
        for (const code of Object.keys(SDK_ERRORS)) sdk.addListener(code, (e) => fail(code, e && e.message));
        sdk.addListener('player_state_changed', (st) => {
          // Pause demandée pendant le lancement du titre : imposée dès que le titre joue.
          if (st && !st.paused && want === 'pause' && isOurs(st)) sdkCall(() => sdk.pause()).catch(() => {});
        });
        addEventListener('pagehide', () => { if (sdk) sdk.disconnect(); });
        return sdk.connect().then((ok) => { if (!ok) fail('initialization_error'); });
      }).catch((e) => { settle(e); report(e.message); })
        .finally(() => { starting = false; });
    }

    function whenReady() {
      if (fatal) return Promise.reject(new Error(fatal));
      if (deviceId) return Promise.resolve(deviceId);
      const p = new Promise((resolve, reject) => waiters.push({ resolve, reject }));
      start();
      return withTimeout(p, READY_TIMEOUT, 'Spotify ne répond pas (délai dépassé).');
    }

    // Lance `ref` sur cet appareil à la position `at` (la seule commande qui passe par internet).
    async function startTrack() {
      const id = await whenReady();
      const token = await getToken();
      const body = JSON.stringify({ uris: ['spotify:track:' + ref], position_ms: Math.max(0, Math.round(at * 1000)) });
      const put = (dev) => fetchTimeout(API_PLAY + '?device_id=' + encodeURIComponent(dev), {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body,
      });
      let res = await put(id);
      // Juste après « ready », Spotify ne connaît pas toujours encore l’appareil : un seul nouvel essai.
      if (res.status === 404) { await delay(1000); res = await put(deviceId || id); }
      if (!res.ok) throw new Error(await playError(res));
      started = true; startedAt = Date.now(); last = null;
    }

    spotifyPlayer = {
      prepare() {
        return whenReady().then(() => {});
      },
      // À appeler dans un geste de l’animateur (clic, touche) : autorise le son de l’appareil.
      activate() {
        if (sdk && typeof sdk.activateElement === 'function') Promise.resolve(sdk.activateElement()).catch(() => {});
      },
      load(song) {
        if (song.ref !== ref) {
          if (started && sdk) sdkCall(() => sdk.pause()).catch(() => {});
          ref = song.ref; started = false; at = 0; last = null;
        }
        return whenReady().then(() => {});
      },
      async seek(sec) {
        at = sec; last = null;
        if (!started) return;                          // pas encore lancé : play() partira de là
        if (await ourState()) await sdkCall(() => sdk.seek(Math.round(sec * 1000)));
        else started = false;                          // le titre n’est plus sur cet appareil : relancé au prochain play()
      },
      async play() {
        want = 'play'; last = null;
        if (started && await ourState()) await sdkCall(() => sdk.resume());
        else await startTrack();
        if (want === 'pause') await sdkCall(() => sdk.pause());   // pause demandée pendant le lancement
      },
      pause() {
        want = 'pause'; last = null;
        if (!sdk || !started) return Promise.resolve();
        return sdkCall(() => sdk.pause()).catch(() => {});
      },
      async position() {
        if (!started) return at;
        const st = await ourState();
        if (st) { at = readPos(st); return at; }
        if (Date.now() - startedAt < 3000) return at;   // le premier état arrive juste après le lancement
        throw new Error('Spotify non prêt.');
      },
      async duration() {
        const st = started ? await ourState() : null;
        return st && st.duration ? st.duration / 1000 : null;
      },
      onError(fn) {
        errorFn = typeof fn === 'function' ? fn : () => {};
      },
    };
    return spotifyPlayer;
  }

  function create(source, opts) {
    if (source === 'file') return createFilePlayer(opts);
    if (source === 'spotify') return createSpotifyPlayer(opts);
    throw new Error('Source inconnue : ' + source);
  }

  window.Players = { create };
}());
