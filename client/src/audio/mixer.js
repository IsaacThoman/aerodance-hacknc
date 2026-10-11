import { loadSound } from '../menu/soundSettings.js';

/*
 * One AudioContext for the page, wired like a little mixing desk:
 *
 *   menu music ─ menuMusic ─┐
 *   (in-game songs) ────────┴─ music ─┐
 *   button sounds ─────────── sfx ────┴─ master ─ limiter ─ speakers
 *
 * applySound(sound) maps Settings → Sound onto it:
 *   Master     master: everything
 *   Music      music: all music, menu and in-game
 *   Effects    sfx: button sounds
 *   Menu music menuMusic: on/off for the menu's background track only
 *   Mute all   master off
 *
 * Browsers keep audio suspended until the first click, tap or key press; the context
 * resumes on that gesture.
 */

// Kept on the page rather than in the module, so a hot-reloaded copy of this file still shares it.
const KEY = Symbol.for('aerodance.mixer');

// Sliders are linear 0..1; squaring makes equal slider moves sound like equal steps.
const level = (v) => Math.max(0, Math.min(1, Number(v) || 0)) ** 2;

export function getMixer() {
  if (globalThis[KEY]) return globalThis[KEY];
  const ctx = new AudioContext();
  const gain = () => ctx.createGain();
  const master = gain();
  const music = gain();
  const menuMusic = gain();
  const sfx = gain();
  // Catches the odd peak when a button pop lands on a loud bar of music.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;

  menuMusic.connect(music);
  music.connect(master);
  sfx.connect(master);
  master.connect(limiter).connect(ctx.destination);
  const mixer = { ctx, master, music, menuMusic, sfx };
  globalThis[KEY] = mixer;

  const unlock = () => { if (ctx.state === 'suspended') ctx.resume(); };
  for (const type of ['pointerdown', 'pointerup', 'keydown', 'touchend']) window.addEventListener(type, unlock, true);

  applySound(loadSound());
  return mixer;
}

const set = (param, value, ctx) => {
  // A short timed ramp (no zipper noise while a slider is dragged). Not setTargetAtTime:
  // Chrome only advances that glide while sound flows through the node, so an idle effects
  // channel would play its next button sound at the old volume.
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + 0.03);
};

export function applySound(sound) {
  const { ctx, master, music, menuMusic, sfx } = getMixer();
  set(master.gain, sound.muted ? 0 : level(sound.master), ctx);
  set(music.gain, level(sound.music), ctx);
  set(menuMusic.gain, sound.menuMusic === false ? 0 : 1, ctx);
  set(sfx.gain, level(sound.sfx), ctx);
}
