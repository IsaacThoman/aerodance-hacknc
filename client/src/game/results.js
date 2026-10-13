/*
 * Round outcomes for the results screens (promoted from temp/win-screens): one entry per
 * dancer, seat 0 the blue dancer and seat 1 the purple one, each with its score.
 */

export const PLAYERS = [
  { name: 'Player 1', color: '#078fff', light: '#7fd0ff', dark: '#0558b0' },
  { name: 'Player 2', color: '#b86bff', light: '#dcb8ff', dark: '#6a2bc0' },
];

/** Index of the single highest score; null for a tie or a solo round. */
export function winnerOf(results) {
  if (results.length < 2) return null;
  const top = Math.max(...results.map((r) => r.score));
  const leaders = results.filter((r) => r.score === top);
  return leaders.length === 1 ? results.indexOf(leaders[0]) : null;
}

// Reveal timeline (seconds after the screen appears).
export const COUNT = [0.5, 1.9];
// The winner is announced the moment the scores finish counting up.
export const REVEAL = COUNT[1];
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const easeOut = (t) => 1 - (1 - t) ** 3;
// Starts and ends at rest, so a move glides instead of jolting off the mark.
export const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
export const backOut = (t, s = 1.8) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
// Seconds the dancers take to walk to their result spots.
export const STEP = 1.6;

export function timeline(show, now) {
  const t = now - show.start;
  return {
    t,
    count: easeOut(clamp01((t - COUNT[0]) / (COUNT[1] - COUNT[0]))),
    reveal: clamp01((t - REVEAL) / 0.6),
    step: easeInOut(clamp01((t - REVEAL) / STEP)),
  };
}
