// Lecteurs de morceaux partagés par la Régie et la page Création (script classique, pas de module ni de build).
// Players.create(source, opts) renvoie un lecteur qui expose la même interface quelle que soit la source :
//   load(song), seek(sec), play(), pause(), position(), duration(), playing() (promesses) et onError(fn(message)).
//   playing() n’est vrai que lorsque la lecture avance réellement.
// Fichier audio : opts inutiles. Vidéo : opts = { container } ; l’élément <video> y est ajouté (sans contrôles, à 100 %).
// YouTube : opts = { container } ; le lecteur YouTube (iframe, sans contrôles) y est ajouté dans son propre cadre ;
// check(ref) vérifie à l’avance qu’une vidéo peut être lue ici (message d’erreur ou null).
// Vidéo et YouTube ajoutent chacun leur propre élément au conteneur : la page n’affiche que celui du passage en cours.
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

  const PROGRESS_CHECK = 150;   // ms entre deux lectures de currentTime pour constater que l’image avance

  // Morceau fichier ou vidéo : un élément média servi par le serveur local sous baseUrl + <ref>. Pause instantanée, sans internet.
  function createElementPlayer(audio, baseUrl) {
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
          audio.src = baseUrl + encodeURIComponent(song.ref);
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
          if (e && e.name === 'NotAllowedError') {
            const err = new Error('cliquez dans la page ou appuyez sur une touche pour activer le son');
            err.notAllowed = true;                                   // la page peut proposer un clic d’activation
            throw err;
          }
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
      // Vrai seulement si l’élément lit et que currentTime avance entre deux mesures (pas en pause, en attente de données ou à la fin).
      playing() {
        const running = () => !audio.paused && !audio.ended && audio.readyState >= 3;
        if (!running()) return Promise.resolve(false);
        const before = audio.currentTime;
        return delay(PROGRESS_CHECK).then(() => running() && audio.currentTime > before);
      },
      onError(fn) {
        errorFn = typeof fn === 'function' ? fn : () => {};
      },
    };
  }

  function createFilePlayer() {
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    return createElementPlayer(audio, '/musiques/');
  }

  // Passage vidéo : un <video> sans contrôles qui remplit `container`, servi sous /videos/<ref>.
  function createVideoPlayer(opts = {}) {
    if (!opts.container) throw new Error('Le lecteur vidéo a besoin d’un conteneur.');
    const video = document.createElement('video');
    video.preload = 'auto';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.controls = false;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    opts.container.append(video);
    return createElementPlayer(video, '/videos/');
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
      // Vrai si le SDK annonce notre titre en lecture ; jamais d’erreur, faux tant que rien n’est lancé.
      async playing() {
        if (!started || !sdk) return false;
        try {
          const st = await ourState();
          return !!st && !st.paused;
        } catch {
          return false;
        }
      },
      onError(fn) {
        errorFn = typeof fn === 'function' ? fn : () => {};
      },
    };
    return spotifyPlayer;
  }

  // ---------- YouTube : l’API IFrame de YouTube ----------
  // Rien n’est chargé depuis YouTube tant qu’aucun lecteur YouTube n’est demandé : une partie sans YouTube reste hors ligne.
  // YouTube affiche son titre et ses suggestions dès que la vidéo est en pause ou en attente : la page la couvre alors.
  const YT_API_URL = 'https://www.youtube.com/iframe_api';
  const YT_UNREACHABLE = 'YouTube injoignable : vérifiez la connexion internet.';
  const YT_ERRORS = {
    2: 'Lien YouTube invalide.',
    5: 'Lecture impossible dans ce navigateur.',
    100: 'Vidéo introuvable ou privée.',
    101: 'Le propriétaire de cette vidéo interdit sa lecture ailleurs que sur YouTube.',
    150: 'Le propriétaire de cette vidéo interdit sa lecture ailleurs que sur YouTube.',
  };
  const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  const AUTOPLAY_WAIT = 1500;   // ms : sans geste dans la page, une vidéo qui ne démarre pas est bloquée par le navigateur

  let ytApiPromise = null;
  function loadYoutubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytApiPromise) return ytApiPromise;
    let script = null;
    ytApiPromise = withTimeout(new Promise((resolve, reject) => {
      // L’API appelle cette fonction une fois chargée : elle doit exister avant l’injection du script.
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      script = document.createElement('script');
      script.src = YT_API_URL;
      script.async = true;
      script.onerror = () => reject(new Error(YT_UNREACHABLE));
      document.head.append(script);
    }), READY_TIMEOUT, YT_UNREACHABLE)
      .catch((e) => {
        if (window.YT && window.YT.Player) return window.YT;   // arrivée juste à la limite
        if (script) script.remove();
        ytApiPromise = null;                                    // panne réseau : le prochain essai réinjecte le script
        throw e;
      });
    return ytApiPromise;
  }

  function createYoutubePlayer(opts = {}) {
    if (!opts.container) throw new Error('Le lecteur YouTube a besoin d’un conteneur.');
    const frame = document.createElement('div');   // cadre propre à ce lecteur : l’iframe de YouTube y est créée
    frame.style.width = '100%';
    frame.style.height = '100%';
    frame.style.pointerEvents = 'none';            // aucun clic ne parvient à l’interface de YouTube
    opts.container.append(frame);
    let errorFn = () => {};
    let yt = null;              // YT.Player prêt
    let readyPromise = null;
    let attempt = 0;            // un lecteur abandonné (délai dépassé) ne doit plus rien changer
    let ref = null;             // vidéo chargée (identifiant YouTube)
    let failed = null;          // message d’erreur de la vidéo `ref` : le prochain load() la recharge
    let started = false;        // la vidéo `ref` a joué depuis son chargement (sinon seekTo la lancerait)
    let at = 0;                 // position voulue tant que la vidéo n’a pas joué
    let cued = false;           // la vidéo `ref` est chargée en CUED à la position `at` (pas encore lancée)
    let cueGen = 0;
    let seekTarget = null;      // position demandée par seekTo, tant que getCurrentTime() donne encore l’ancienne
    let seekGen = 0;
    let watchers = [];          // attentes d’un état ou d’une erreur

    function notify(stateCode, error) {
      const list = watchers; watchers = [];
      for (const w of list) if (!w(stateCode, error)) watchers.push(w);
    }
    // Attend l’état `wanted` (ou une erreur) au plus `ms` : true si atteint, false sinon ; rejette sur erreur.
    // fresh : seul un changement d’état à venir compte (l’état actuel est celui de la vidéo précédente).
    function waitState(wanted, ms, fresh = false) {
      if (!fresh && yt && yt.getPlayerState() === wanted) return Promise.resolve(true);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { watchers = watchers.filter((w) => w !== watch); resolve(false); }, ms);
        const watch = (code, error) => {
          if (error) { clearTimeout(timer); reject(new Error(error)); return true; }
          if (code === wanted) { clearTimeout(timer); resolve(true); return true; }
          return false;
        };
        watchers.push(watch);
      });
    }

    function whenReady() {
      if (yt) return Promise.resolve(yt);
      if (readyPromise) return readyPromise;
      const gen = ++attempt;
      readyPromise = loadYoutubeApi().then((YT) => withTimeout(new Promise((resolve) => {
        const holder = document.createElement('div');   // remplacé par l’iframe
        frame.replaceChildren(holder);
        const p = new YT.Player(holder, {
          width: '100%',
          height: '100%',
          playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, fs: 0, playsinline: 1 },
          events: {
            onReady: () => { if (gen === attempt) { yt = p; resolve(p); } },
            onStateChange: (e) => {
              if (gen !== attempt) return;
              if (e.data === YT_STATE.PLAYING) { started = true; cued = false; }
              if (e.data === YT_STATE.ENDED) { at = p.getCurrentTime() || at; started = false; }   // seekTo relancerait la vidéo
              notify(e.data, null);
            },
            onError: (e) => {
              if (gen !== attempt) return;
              const msg = YT_ERRORS[e.data] || `Erreur YouTube (code ${e.data}).`;
              failed = msg; started = false; cued = false;
              notify(null, msg);
              errorFn(msg);
            },
          },
        });
      }), READY_TIMEOUT, YT_UNREACHABLE)).catch((e) => {
        if (gen === attempt) { attempt += 1; frame.replaceChildren(); readyPromise = null; }   // le prochain essai recommence
        throw e;
      });
      return readyPromise;
    }

    // Charge `id` sans le lancer, prêt à partir de `sec`.
    // Résout une fois la vidéo prête (état CUED) : un playVideo() ou seekTo() pendant le chargement
    // fait répondre à YouTube l’erreur 2, même pour une vidéo valide.
    async function cue(id, sec) {
      ref = id; failed = null; started = false; at = sec; cued = false; seekTarget = null; seekGen += 1;
      const gen = ++cueGen;
      const wait = waitState(YT_STATE.CUED, READY_TIMEOUT, true);
      yt.cueVideoById({ videoId: id, startSeconds: sec });
      let ok;
      try { ok = await wait; } catch (e) { if (gen === cueGen) throw e; return; }
      if (gen !== cueGen) return;                       // un chargement plus récent a pris la main
      // Même vidéo rechargée : YouTube peut rester en CUED sans le signaler de nouveau.
      if (!ok && yt.getPlayerState() !== YT_STATE.CUED) throw new Error(YT_UNREACHABLE);
      cued = true;
    }

    // Après seekTo, getCurrentTime() garde l’ancienne position quelques centaines de ms : relue trop tôt,
    // une position proche de Fin terminerait aussitôt le passage rejoué (R). seek attend donc que le temps ait suivi.
    const SEEK_TOLERANCE = 0.5;   // s
    const landed = (sec) => Math.abs((yt.getCurrentTime() || 0) - sec) < SEEK_TOLERANCE;
    async function seekPlayed(sec) {
      const gen = ++seekGen;
      seekTarget = sec;
      yt.seekTo(sec, true);
      const until = Date.now() + READY_TIMEOUT;
      while (gen === seekGen && !landed(sec) && Date.now() < until) await delay(50);
      if (gen === seekGen) seekTarget = null;   // arrivé (ou délai dépassé : on revient au temps lu)
    }

    const player = {
      async load(song) {
        await whenReady();
        if (song.ref !== ref || failed) await cue(song.ref, Number.isFinite(song.start) ? song.start : 0);
      },
      async seek(sec) {
        if (yt && started) seekTarget = sec;   // dès l’appel : un relevé de position concurrent ne voit jamais l’ancienne
        await whenReady();
        if (!ref) return;
        // Pas encore lancée (ou finie) : seekTo lancerait la lecture ; on recharge à la position voulue.
        if (!started) { if (!cued || sec !== at) await cue(ref, sec); }   // déjà prête à cette position : rien à refaire
        else await seekPlayed(sec);
      },
      async play() {
        await whenReady();
        if (!ref) return;
        if (failed) throw new Error(failed);
        if (!started && !cued) await cue(ref, at);       // chargement précédent inachevé : jamais de playVideo() avant CUED
        if (yt.isMuted()) yt.unMute();   // coupé par YouTube après un démarrage bloqué : le son est toujours voulu
        yt.playVideo();
        // L’iframe ne dit pas si le navigateur bloque la lecture faute de geste : on le déduit quand la page n’en a reçu aucun.
        const ua = navigator.userActivation;
        if (!ua || ua.hasBeenActive !== false) return;
        const ok = await waitState(YT_STATE.PLAYING, AUTOPLAY_WAIT);
        if (ok && !yt.isMuted()) return;
        yt.pauseVideo();
        const err = new Error('cliquez dans la page ou appuyez sur une touche pour activer le son');
        err.notAllowed = true;
        throw err;
      },
      pause() {
        if (yt && ref) yt.pauseVideo();
        return Promise.resolve();
      },
      position() {
        if (!yt || !started) return Promise.resolve(at);
        const t = yt.getCurrentTime() || 0;
        if (seekTarget === null) return Promise.resolve(t);
        if (!landed(seekTarget)) return Promise.resolve(seekTarget);   // ancienne position : jamais remontée à la page
        seekTarget = null;
        return Promise.resolve(t);
      },
      duration() {
        const d = yt && ref ? yt.getDuration() : 0;
        return Promise.resolve(d > 0 ? d : null);
      },
      playing() {
        return Promise.resolve(!!yt && !!ref && yt.getPlayerState() === YT_STATE.PLAYING);
      },
      onError(fn) {
        errorFn = typeof fn === 'function' ? fn : () => {};
      },
      // Vérifie qu’une vidéo se lit ici : chargée muette, lancée jusqu’à la lecture ou une erreur, puis mise en pause.
      async check(id) {
        try {
          await whenReady();
          await cue(id, 0);
          yt.mute();
          yt.playVideo();
          const ok = await waitState(YT_STATE.PLAYING, READY_TIMEOUT);
          return ok ? null : YT_UNREACHABLE;
        } catch (e) {
          return e.message || YT_UNREACHABLE;
        } finally {
          if (yt) { yt.pauseVideo(); yt.unMute(); }
        }
      },
    };
    return player;
  }

  function create(source, opts) {
    if (source === 'file') return createFilePlayer(opts);
    if (source === 'video') return createVideoPlayer(opts);
    if (source === 'youtube') return createYoutubePlayer(opts);
    if (source === 'spotify') return createSpotifyPlayer(opts);
    throw new Error('Source inconnue : ' + source);
  }

  window.Players = { create };
}());
