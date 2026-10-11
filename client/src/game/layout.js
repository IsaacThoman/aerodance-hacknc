// Song Select layout in 1600x900 design units, shared with the browser flow test.

// Both phases: back button + heading, top left (under the server HUD).
export const BACK = { x: 166, y: 150, r: 30 };

// List phase: songs down the left.
export const ROWS = { x: 128, y: 258, w: 560, h: 88, gap: 16, perPage: 4 };
export const rowRect = (i) => ({ x: ROWS.x, y: ROWS.y + i * (ROWS.h + ROWS.gap), w: ROWS.w, h: ROWS.h });
export const PAGE_UP = { x: 730, y: ROWS.y + ROWS.h / 2, r: 28 };
export const PAGE_DOWN = { x: 730, y: ROWS.y + 3 * (ROWS.h + ROWS.gap) + ROWS.h / 2, r: 28 };
export const RETRY = { x: 128, y: 340, w: 300, h: 80 };

// Preview phase: title top left; anything worth saying (a stage or audio that couldn't
// load) sits bottom left.
export const PREVIEW_NOTE = { x: 128, y: 830 };

// Gameplay: the live player panels, as fractions of the screen so the 3D characters
// (stage/LivePanels.jsx) and their 2D labels (GameScreen.jsx) line up. Player 1 top left,
// player 2 top right; each character stands in a box `height` tall whose top is at `top`
// and whose centre is `inset` in from its side.
export const LIVE_PANEL = { inset: 0.1, top: 0.17, height: 0.27 };
export const livePanelCenterX = (id) => (id === 0 ? LIVE_PANEL.inset : 1 - LIVE_PANEL.inset);

// Gameplay overlay (GameScreen.jsx).
export const GAME_PAUSE = { x: 800, y: 66, r: 30 };
export const GAME_READY_START = { x: 610, y: 690, w: 380, h: 96 };
export const GAME_READY_BACK = { x: 166, y: 150, r: 30 };
// Get Ready without a pose input: a warning card over the stage, and its button opens
// Connect Client (whose pill sits top right).
export const GAME_TRACKING_WARNING = { x: 400, y: 372, w: 800, h: 280 };
export const GAME_READY_CAMERA = { x: 604, y: 552, w: 360, h: 76 };
export const GAME_CALIBRATION_PREVIEW = { x: 360, y: 290, w: 880, h: 420 };
export const GAME_CALIBRATION_PROGRESS = { x: 360, y: 810, w: 880, h: 14 };
export const GAME_PAUSE_PANEL = { x: 560, y: 250, w: 480, h: 420 };
export const GAME_RESUME = { x: 610, y: 340, w: 380, h: 84 };
export const GAME_RESTART = { x: 610, y: 444, w: 380, h: 84 };
export const GAME_QUIT = { x: 610, y: 548, w: 380, h: 84 };
export const GAME_PROGRESS = { x: 560, y: 852, w: 480, h: 14 };
export const RESULTS_RETRY = { x: 470, y: 806, w: 320, h: 80 };
export const RESULTS_SONGS = { x: 810, y: 806, w: 320, h: 80 };
export const RESULTS_CONTINUE = { x: 640, y: 806, w: 320, h: 80 };
// Song Select preview: Dance! starts the song for real, bottom right.
export const DANCE = { x: 1172, y: 770, w: 300, h: 96 };

// Battle details sit beneath the song title, leaving the celebration and score rows clear.
export const RESULTS_RECEIPT = { x: 440, y: 206, w: 720, h: 44 };
export const RESULTS_TROPHY = { x: 440, y: 262, w: 720, h: 44 };
export const RESULTS_REMATCH = { x: 1240, y: 806, w: 260, h: 80 };

// Bot-created battles may have more than the display's usual two seats.
export function resultLayout(i, count) {
  if (count <= 2) return { x: count === 1 ? 800 : 500 + i * 600, y: 590, scale: 1, hypeY: 524 };
  const columns = Math.min(4, count);
  const y = 578 + Math.floor(i / columns) * 122;
  return { x: 240 + (i % columns) * 1120 / (columns - 1), y, scale: 0.52, hypeY: y - 32 };
}
