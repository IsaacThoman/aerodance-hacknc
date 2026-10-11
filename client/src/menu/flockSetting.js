const KEY = 'aerodance.showFlock';

// Whether the flock camera stands behind the menu dancers even without an Android client
// connected (menu/MenuDancers.jsx).
export function loadShowFlock() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? false;
  } catch {
    return false;
  }
}

export function saveShowFlock(on) {
  try { localStorage.setItem(KEY, JSON.stringify(!!on)); } catch { /* storage unavailable */ }
}
