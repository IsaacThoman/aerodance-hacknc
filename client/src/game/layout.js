// Song Select layout in 1600x900 design units, shared with the browser flow test.

// Both phases: back button + heading, top left (under the server HUD).
export const BACK = { x: 166, y: 150, r: 30 };

// List phase: songs down the left, the players' readiness in a panel on the right.
export const ROWS = { x: 128, y: 258, w: 560, h: 88, gap: 16, perPage: 4 };
export const rowRect = (i) => ({ x: ROWS.x, y: ROWS.y + i * (ROWS.h + ROWS.gap), w: ROWS.w, h: ROWS.h });
export const PAGE_UP = { x: 730, y: ROWS.y + ROWS.h / 2, r: 28 };
export const PAGE_DOWN = { x: 730, y: ROWS.y + 3 * (ROWS.h + ROWS.gap) + ROWS.h / 2, r: 28 };
export const RETRY = { x: 128, y: 340, w: 300, h: 80 };
export const READY = { x: 820, y: 128, w: 744 };
export const slotRect = (i) => ({ x: READY.x + 32 + i * 348, y: READY.y + 70, w: 332, h: 88 });
export const LINK_Y = 778;

// Preview phase: title top left, stage card top right, transport along the bottom.
export const STAGE_CARD = { x: 1104, y: 126, w: 460, h: 136 };
export const STAGE_PREV = { x: STAGE_CARD.x + 44, y: STAGE_CARD.y + 58, r: 28 };
export const STAGE_NEXT = { x: STAGE_CARD.x + STAGE_CARD.w - 44, y: STAGE_CARD.y + 58, r: 28 };
export const BAR = { x: 128, y: 776, w: 1344, h: 96 };
export const PLAY = { x: BAR.x + 16, y: BAR.y + 12, w: 220, h: 72 };
export const SCRUB = { x: BAR.x + 270, y: BAR.y + 36, w: 880, h: 24 };
