// Lecteurs de morceaux partagés par la Régie et la page Création (script classique, pas de module ni de build).
// Players.create(source) renvoie un lecteur qui expose la même interface quelle que soit la source :
//   load(song), seek(sec), play(), pause(), position(), duration() (promesses) et onError(fn(message)).
// Le lecteur ne décide de rien : la page appelle play / pause selon l’état reçu du serveur.
(function () {
  'use strict';

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
    function whenReady() {
      if (audio.readyState >= 1) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => {
          audio.removeEventListener('loadedmetadata', done);
          audio.removeEventListener('error', done);
          resolve();
        };
        audio.addEventListener('loadedmetadata', done);
        audio.addEventListener('error', done);
      });
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

  function create(source, opts) {
    if (source === 'file') return createFilePlayer(opts);
    if (source === 'spotify') throw new Error('Spotify non disponible');
    throw new Error('Source inconnue : ' + source);
  }

  window.Players = { create };
}());
