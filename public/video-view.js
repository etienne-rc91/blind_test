// Règles d’affichage des passages vidéo (script classique : window.VideoView, et require() sous Node pour les tests).
// Fonctions pures, sans accès au DOM : le Grand écran et la Régie appliquent le résultat.
(function () {
  'use strict';

  const USUAL = { main: null, strip: null, cover: null };
  const STAGE_LABELS = { setup: 'Installation', summary: 'Bilan', final: 'Fin' };

  // Que montre le Grand écran ? main : null = affichage habituel (pas de passage vidéo, ou pas l’étape Jeu).
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
    if (song.reveal) return { main: 'reveal', strip: null, cover: null };
    return { main: 'cover', strip: null, cover: `🎬 Morceau ${song.number} / ${song.total}` };
  }

  // Avertissement de la Régie pour un passage vidéo (null = rien à signaler).
  // reader : identifiant du Grand écran qui lit (null si aucun) ; unlocked : ce Grand écran a reçu un clic.
  function hostWarning({ isVideo, stage, reader, unlocked }) {
    if (!isVideo) return null;
    if (!reader) return 'Aucun Grand écran ouvert';
    if (stage !== 'play') return `Grand écran à l’étape ${STAGE_LABELS[stage] || stage} : passez à Jeu pour voir la vidéo`;
    if (!unlocked) return 'Le Grand écran attend un clic pour activer la vidéo';
    return null;
  }

  const api = { screenView, hostWarning };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.VideoView = api;
}());
