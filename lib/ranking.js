// Classement dense : les ex aequo partagent la même place, sans trou (12, 12, 10 → 1, 1, 2).
function rankTeams(teams) {
  const sorted = [...teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'));
  let place = 0, last = null;
  return sorted.map((t) => {
    if (t.score !== last) { place += 1; last = t.score; }
    return { ...t, place };
  });
}

// Podium : toutes les équipes classées 1re, 2e ou 3e, quel que soit leur nombre.
function podium(teams) {
  const steps = [];
  for (const t of rankTeams(teams)) {
    if (t.place > 3) break;
    if (!steps[t.place - 1]) steps[t.place - 1] = { place: t.place, teams: [] };
    steps[t.place - 1].teams.push(t);
  }
  return steps;
}

module.exports = { rankTeams, podium };
