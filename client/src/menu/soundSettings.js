const KEY = 'aerodance.sound';

// muted silences everything; menuMusic: false turns off just the background music.
export const DEFAULT_SOUND = { master: 0.8, music: 0.8, sfx: 0.8, menuMusic: true, muted: false };

export function loadSound() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    return saved ? { ...DEFAULT_SOUND, ...saved } : DEFAULT_SOUND;
  } catch {
    return DEFAULT_SOUND;
  }
}

export function saveSound(sound) {
  try { localStorage.setItem(KEY, JSON.stringify(sound)); } catch { /* storage unavailable */ }
}
