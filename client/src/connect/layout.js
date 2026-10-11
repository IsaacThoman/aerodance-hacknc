// Connect Client layout in 1600x900 design units, shared with the browser flow test.

// Status pill, top right of Settings (the bottom-right corner belongs to the remote and fullscreen bubbles).
export const PILL = { x: 1168, y: 36, w: 396, h: 68 };

// The card under it: client type across the top, then the address and messages on the
// left and the keypad on the right.
export const CARD = { x: 800, y: 112, w: 764, h: 736 };
export const CLOSE = { x: CARD.x + CARD.w - 46, y: CARD.y + 46, r: 26 };
export const MODES = [
  { id: 'android', label: 'Android Client', rect: { x: CARD.x + 32, y: CARD.y + 92, w: 350, h: 58 } },
  { id: 'webcam', label: 'Webcam (dummy)', rect: { x: CARD.x + 382, y: CARD.y + 92, w: 350, h: 58 } },
];
export const COLUMN = { x: CARD.x + 32, w: 404 };
export const FIELD = { x: COLUMN.x, y: CARD.y + 214, w: COLUMN.w, h: 72 };
export const PRIMARY = { x: COLUMN.x, y: CARD.y + CARD.h - 100, w: COLUMN.w, h: 70 };
// Connection messages run the full width between the keypad and the button.
export const STATUS = { x: COLUMN.x, y: CARD.y + 540, w: CARD.w - 64 };

const KEY = { w: 80, h: 64, gap: 12, x: CARD.x + CARD.w - 32 - (80 * 3 + 12 * 2), y: FIELD.y };
export const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'Backspace'].map((key, i) => ({
  key,
  rect: { x: KEY.x + (i % 3) * (KEY.w + KEY.gap), y: KEY.y + Math.floor(i / 3) * (KEY.h + KEY.gap), w: KEY.w, h: KEY.h },
}));
