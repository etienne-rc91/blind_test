// Règles d’affichage des passages vidéo (script classique : window.VideoView, et require() sous Node pour les tests).
// Fonctions pures, sans accès au DOM : le Grand écran et la Régie appliquent le résultat.
(function () {
  'use strict';

  const USUAL = { main: null, strip: null, cover: null };
  const STAGE_LABELS = { setup: 'Installation', summary: 'Bilan', final: 'Fin' };

  // Que montre le Grand écran ? main : null = affichage habituel (pas de passage vidéo, pas l’étape Jeu, ou morceau conclu à l’arrêt).
  // playingNow : la page lit réellement la vidéo (l’image avance).
  function screenView({ stage, phase, song, qcm, playingNow }) {
    if (stage !== 'play' || !song || !song.video) return { ...USUAL };

    if (qcm) {
      if (playingNow) {
        const counting = qcm.step === 'countdown' || qcm.step === 'locked';
        return { main: 'video', strip: counting ? 'countdown' : null, cover: null };
      }
      if (qcm.step === 'listening') return { main: 'cover', strip: null, cover: `🎬 Question ${qcm.index + 1} / ${qcm.total}` };
      return { ...USUAL };
    }

    if (playingNow) return { main: 'video', strip: song.reveal ? 'reveal' : null, cover: null };
    if (phase === 'buzzed') return { main: 'banner', strip: null, cover: null };
    if (song.reveal) return { ...USUAL };   // conclu : révélation au-dessus du classement, comme un morceau audio
    return { main: 'cover', strip: null, cover: `🎬 Morceau ${song.number} / ${song.total}` };
  }

  // Avertissement de la Régie pour un passage vidéo (null = rien à signaler).
  // reader : un Grand écran lit ; screens : nombre de Grands écrans connectés (qui lisent ou non) ;
  // port : celui du serveur ; unlocked : le Grand écran qui lit a reçu un clic.
  function hostWarning({ isVideo, stage, reader, screens, port, unlocked }) {
    if (!isVideo) return null;
    if (!reader && screens > 0) return `Grand écran ouvert, mais pas à l’adresse 127.0.0.1 : ouvrez http://127.0.0.1:${port}/screen sur ce PC`;
    if (!reader) return 'Aucun Grand écran ouvert';
    if (stage !== 'play') return `Grand écran à l’étape ${STAGE_LABELS[stage] || stage} : passez à Jeu pour voir la vidéo`;
    if (!unlocked) return 'Le Grand écran attend un clic pour activer la vidéo';
    return null;
  }

  const api = { screenView, hostWarning };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.VideoView = api;
}());
