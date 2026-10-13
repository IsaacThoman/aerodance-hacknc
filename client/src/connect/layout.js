// Connect Client layout in 1600x900 design units, shared with the browser flow test.

// Status pill, top right of Settings (the bottom-right corner belongs to the fullscreen bubble).
export const PILL = { x: 1168, y: 36, w: 396, h: 68 };

// The card under it: the camera and tracking model across the top, then the setup preview,
// messages and the camera button.
export const CARD = { x: 800, y: 112, w: 764, h: 636 };
export const CLOSE = { x: CARD.x + CARD.w - 46, y: CARD.y + 46, r: 26 };
export const COLUMN = { x: CARD.x + 32, w: 404 };
export const PRIMARY = { x: COLUMN.x, y: CARD.y + CARD.h - 100, w: COLUMN.w, h: 70 };
// Connection messages run the full width between the preview and the button.
export const STATUS = { x: COLUMN.x, y: CARD.y + 440, w: CARD.w - 64 };
export const CAMERA_PREV = { x: COLUMN.x, y: CARD.y + 114, w: 80, h: 58 };
export const CAMERA_NEXT = { x: CARD.x + CARD.w - 112, y: CAMERA_PREV.y, w: 80, h: 58 };
export const MODEL_RECTS = [0, 1, 2].map(i => ({ x: COLUMN.x + i * 235, y: CAMERA_PREV.y + 88, w: 222, h: 58 }));
export const WEBCAM_PREVIEW = { x: COLUMN.x, y: CAMERA_PREV.y + 160, w: 280, h: 150 };
