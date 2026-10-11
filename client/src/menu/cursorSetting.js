const KEY = 'aerodance.wiiCursor';

// Whether the display swaps the mouse pointer for the Wii hand (remote/RemoteDock.jsx).
export function loadWiiCursor() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? true;
  } catch {
    return true;
  }
}

export function saveWiiCursor(on) {
  try { localStorage.setItem(KEY, JSON.stringify(!!on)); } catch { /* storage unavailable */ }
}
