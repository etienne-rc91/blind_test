// Modifier la partie en cours de jeu : ce qui peut s'appliquer tout de suite sans mélanger scores ni avancement.
// Les points sont rangés par position de manche et l'avancement QCM par position de question :
// une manche ou une question déjà jouée doit rester à sa place.
const sameQuestion = (a, b) => a.text === b.text && a.image === b.image && JSON.stringify(a.choices) === JSON.stringify(b.choices);

function checkLiveEdit({ oldSections, newSections, progress, currentSection, qcmStep }) {
  const refuse = (reason) => ({
    ok: false,
    error: `Modification impossible pendant la partie : ${reason}. Utilisez « Enregistrer sous » pour la garder pour une autre soirée.`,
  });
  if (newSections.length < oldSections.length) return refuse('une manche a été supprimée');
  // Un nom de manche existante retrouvé à une autre place : les manches ont été réordonnées.
  for (let i = 0; i < oldSections.length; i += 1) {
    const j = newSections.findIndex((s) => s.name === oldSections[i].name);
    if (j !== -1 && j !== i) return refuse('l’ordre des manches a changé');
  }

  const warnings = [];
  for (let i = 0; i < oldSections.length; i += 1) {
    const before = oldSections[i];
    const after = newSections[i];
    if (before.type !== after.type) return refuse(`le type de la manche « ${before.name} » a changé`);
    if (before.type !== 'qcm') continue;

    const p = progress[i] || { index: 0, revealed: false };
    const started = p.index > 0 || p.revealed || (i === currentSection && qcmStep !== 'idle');
    if (!started) continue;
    if (after.questions.length < before.questions.length) return refuse(`une question de la manche « ${before.name} » a été supprimée`);
    for (let k = 0; k < before.questions.length; k += 1) {
      const moved = after.questions.findIndex((q, idx) => idx !== k && sameQuestion(q, before.questions[k]) && !sameQuestion(after.questions[idx], before.questions[idx] || {}));
      if (moved !== -1) return refuse(`l’ordre des questions de la manche « ${before.name} » a changé`);
    }
    // Questions déjà révélées : la bonne réponse peut être corrigée, mais les points donnés ne bougent pas.
    const revealedCount = p.index + (p.revealed ? 1 : 0);
    for (let k = 0; k < Math.min(revealedCount, before.questions.length); k += 1) {
      if (before.questions[k].answer !== after.questions[k].answer) {
        warnings.push(`${after.name}, question ${k + 1} : la bonne réponse a changé après révélation, corrigez les points avec +/− si besoin.`);
      }
    }
  }
  return { ok: true, warnings };
}

module.exports = { checkLiveEdit };
