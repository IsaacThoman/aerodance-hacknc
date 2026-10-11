/*
 * Round outcomes for the win screens. Scores are TEMPORARY placeholders until the scoring
 * system exists; it should hand over the same shape: [{ name, score }], one per dancer
 * (seat 0 is the blue dancer, seat 1 the purple one).
 */

export const PLAYERS = [
  { name: 'Player 1', color: '#078fff', light: '#7fd0ff', dark: '#0558b0' },
  { name: 'Player 2', color: '#b86bff', light: '#dcb8ff', dark: '#6a2bc0' },
];

// The screens the mock can show, in the order the M key cycles through them.
export const MODES = [
  { id: 'p1', label: 'Player 1 wins' },
  { id: 'p2', label: 'Player 2 wins' },
  { id: 'tie', label: 'Tie' },
  { id: 'solo', label: 'Solo' },
];

const rand = (lo, hi) => Math.round(lo + Math.random() * (hi - lo));

/** TEMP: placeholder scores shaped to give the requested outcome. */
export function tempResults(mode) {
  if (mode === 'solo') return [{ ...PLAYERS[0], score: rand(700, 2000) }];
  const a = rand(900, 1900);
  if (mode === 'tie') return [{ ...PLAYERS[0], score: a }, { ...PLAYERS[1], score: a }];
  const b = a - rand(60, 600);
  return mode === 'p1'
    ? [{ ...PLAYERS[0], score: a }, { ...PLAYERS[1], score: b }]
    : [{ ...PLAYERS[0], score: b }, { ...PLAYERS[1], score: a }];
}

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
