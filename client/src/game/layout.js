// Song Select layout in 1600x900 design units, shared with the browser flow test.

// Both phases: back button + heading, top left (under the server HUD).
export const BACK = { x: 166, y: 150, r: 30 };

// List phase: songs down the left.
export const ROWS = { x: 128, y: 258, w: 560, h: 88, gap: 16, perPage: 4 };
export const rowRect = (i) => ({ x: ROWS.x, y: ROWS.y + i * (ROWS.h + ROWS.gap), w: ROWS.w, h: ROWS.h });
export const PAGE_UP = { x: 730, y: ROWS.y + ROWS.h / 2, r: 28 };
export const PAGE_DOWN = { x: 730, y: ROWS.y + 3 * (ROWS.h + ROWS.gap) + ROWS.h / 2, r: 28 };
export const RETRY = { x: 128, y: 340, w: 300, h: 80 };

// Preview phase: title top left, transport along the bottom.
export const BAR = { x: 128, y: 776, w: 1344, h: 96 };
export const PLAY = { x: BAR.x + 16, y: BAR.y + 12, w: 220, h: 72 };
export const SCRUB = { x: BAR.x + 270, y: BAR.y + 36, w: 880, h: 24 };

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
export const GAME_PAUSE_PANEL = { x: 560, y: 250, w: 480, h: 420 };
export const GAME_RESUME = { x: 610, y: 340, w: 380, h: 84 };
export const GAME_RESTART = { x: 610, y: 444, w: 380, h: 84 };
export const GAME_QUIT = { x: 610, y: 548, w: 380, h: 84 };
export const GAME_PROGRESS = { x: 560, y: 852, w: 480, h: 14 };
export const RESULTS_RETRY = { x: 470, y: 806, w: 320, h: 80 };
export const RESULTS_SONGS = { x: 810, y: 806, w: 320, h: 80 };
export const RESULTS_CONTINUE = { x: 640, y: 806, w: 320, h: 80 };
// Song Select preview: Dance! starts the song for real, above the transport on the right.
export const DANCE = { x: 1172, y: 646, w: 300, h: 96 };
