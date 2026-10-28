// Modifier la partie en cours de jeu : ce qui peut s'appliquer tout de suite sans mélanger scores ni avancement.
// Les points sont rangés par position de manche et l'avancement QCM par position de question :
// une manche ou une question déjà jouée doit rester à sa place.
const sameQuestion = (a, b) => a.text === b.text && a.image === b.image && JSON.stringify(a.choices) === JSON.stringify(b.choices);

// Vrai si l’extrait a été ajouté, retiré, ou a changé de source ou de référence (début et fin sont libres).
const extractProblem = (a, b) => Boolean(a) !== Boolean(b) || (a && (a.source !== b.source || a.ref !== b.ref));

// null si rien à redire (ou pas d'orig fourni), 'moved' si un élément existant a changé de place,
// 'missing' si un élément existant a disparu (remplacé par un nouveau).
function identityProblem(items, oldCount) {
  if (!items.some((x) => Number.isInteger(x?.orig))) return null;
  const present = new Set();
  for (let i = 0; i < items.length; i += 1) {
    const o = items[i]?.orig;
    if (!Number.isInteger(o) || o < 0 || o >= oldCount) continue;
    if (o !== i) return 'moved';
    present.add(o);
  }
  return present.size === oldCount ? null : 'missing';
}

// Manche buzzer : passage libre <-> morceaux interdit pour une manche passée, et pour la manche en cours une fois
// commencée (locked) ; une fois commencée, les morceaux déjà lancés ne bougent pas (réponse et passage modifiables,
// ajouts en fin acceptés).
function songsProblem(before, after, p, locked) {
  const oldSongs = before.songs || [];
  const newSongs = after.songs || [];
  if (locked && (oldSongs.length > 0) !== (newSongs.length > 0)) return `le mode de la manche « ${before.name} » a changé`;
  const played = p ? p.index : 0;
  if (played <= 0 || oldSongs.length === 0) return null;
  if (newSongs.length < oldSongs.length) return `un morceau de la manche « ${before.name} » a été supprimé`;
  const identity = identityProblem(newSongs, oldSongs.length);
  if (identity === 'moved') return `l’ordre des morceaux de la manche « ${before.name} » a changé`;
  if (identity === 'missing') return `un morceau de la manche « ${before.name} » a été supprimé ou remplacé`;
  for (let k = 0; k < Math.min(played, oldSongs.length); k += 1) {
    if (oldSongs[k].source !== newSongs[k].source || oldSongs[k].ref !== newSongs[k].ref) return `la source du morceau ${k + 1} de la manche « ${before.name} » a changé`;
  }
  return null;
}

// roundOpenedInSection / currentSectionScored (de game.getLive()) : absents, la manche en cours compte comme commencée.
function checkLiveEdit({ oldSections, newSections, progress, currentSection, qcmStep, roundOpenedInSection = true, currentSectionScored = true }) {
  const refuse = (reason) => ({
    ok: false,
    error: `Modification impossible pendant la partie : ${reason}. Utilisez « Enregistrer sous » pour la garder pour une autre soirée.`,
  });
  if (newSections.length < oldSections.length) return refuse('une manche a été supprimée');
  // Avec la position d'origine (orig) envoyée par la page Création, l'identité est sûre :
  // chaque manche existante doit rester à sa place, une nouvelle ne peut venir qu'après.
  const identity = identityProblem(newSections, oldSections.length);
  if (identity === 'moved') return refuse('l’ordre des manches a changé');
  if (identity === 'missing') return refuse('une manche a été supprimée ou remplacée');
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
    if (before.type === 'buzzer') {
      // Manche en cours pas encore commencée (juste après Jouer) : aucun morceau lancé, buzzers jamais ouverts, aucun point.
      const currentStarted = (progress[i] ? progress[i].index : 0) > 0 || roundOpenedInSection || currentSectionScored;
      const locked = i < currentSection || (i === currentSection && currentStarted);
      const problem = songsProblem(before, after, progress[i], locked);
      if (problem) return refuse(problem);
      continue;
    }
    if (before.type !== 'qcm') continue;

    const p = progress[i] || { index: 0, revealed: false };
    const started = p.index > 0 || p.revealed || (i === currentSection && qcmStep !== 'idle');
    if (!started) continue;
    if (after.questions.length < before.questions.length) return refuse(`une question de la manche « ${before.name} » a été supprimée`);
    const qIdentity = identityProblem(after.questions, before.questions.length);
    if (qIdentity === 'moved') return refuse(`l’ordre des questions de la manche « ${before.name} » a changé`);
    if (qIdentity === 'missing') return refuse(`une question de la manche « ${before.name} » a été supprimée ou remplacée`);
    for (let k = 0; k < before.questions.length; k += 1) {
      const moved = after.questions.findIndex((q, idx) => idx !== k && sameQuestion(q, before.questions[k]) && !sameQuestion(after.questions[idx], before.questions[idx] || {}));
      if (moved !== -1) return refuse(`l’ordre des questions de la manche « ${before.name} » a changé`);
    }
    // Question déjà posée (passée, révélée, ou courante une fois montrée) : l’extrait ne peut plus être
    // ajouté, retiré ni changer de source ; son début et sa fin restent corrigeables.
    for (let k = 0; k < Math.min(p.index + 1, before.questions.length); k += 1) {
      const asked = k < p.index || p.revealed || (i === currentSection && qcmStep !== 'idle');
      if (asked && extractProblem(before.questions[k].extract, after.questions[k].extract)) {
        return refuse(`l’extrait de la question ${k + 1} de la manche « ${before.name} » a changé`);
      }
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
