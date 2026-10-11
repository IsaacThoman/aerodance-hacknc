/*
 * Best scores per song and player mode, kept in this browser. Keyed by scorer version too:
 * a new scorer can score differently, and an old best shouldn't block or flatter a new one.
 */

const KEY = 'aerodance-best-scores';

const keyFor = (songId, playerCount, scorerVersion) => `${songId}|${playerCount}p|v${scorerVersion}`;

function read(storage) {
  try {
    const scores = JSON.parse(storage.getItem(KEY)) ?? {};
    // F replaces the old failing label; point totals and scorer version are unchanged.
    for (const best of Object.values(scores)) {
      if (best?.grade === 'D') best.grade = 'F';
    }
    return scores;
  } catch { return {}; }
}

export function bestScore(songId, playerCount, scorerVersion, storage = globalThis.localStorage) {
  return read(storage)[keyFor(songId, playerCount, scorerVersion)] ?? null;
}

/**
 * Saves a finished song's results (one per player) if any beats the best; returns
 * { previous, best, isNewBest }.
 */
export function recordResults(songId, playerCount, results, storage = globalThis.localStorage) {
  const top = results.reduce((a, b) => (b.score > a.score ? b : a));
  const key = keyFor(songId, playerCount, top.scorerVersion);
  const all = read(storage);
  const previous = all[key] ?? null;
  const isNewBest = top.score > 0 && (!previous || top.score > previous.score);
  if (isNewBest) {
    all[key] = { score: top.score, grade: top.grade, accuracy: top.accuracy, at: new Date().toISOString() };
    try { storage.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
  }
  return { previous, best: isNewBest ? all[key] : previous, isNewBest };
}
