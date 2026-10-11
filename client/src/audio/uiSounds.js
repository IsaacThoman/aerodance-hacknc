import { getMixer } from './mixer.js';

/*
 * Wii-menu-style button sounds, synthesised so no recordings ship with the game: a soft
 * glassy tick when the cursor moves onto a button, a bright bubbly pop when one is pressed,
 * a falling pop for back, rising/falling notes for toggles, and a tiny tick for sliders.
 * They play on the mixer's Effects channel.
 *
 * playUISound('hover' | 'select' | 'back' | 'toggleOn' | 'toggleOff' | 'tick')
 */

/** A short sine "bubble": pitch glides from f0 to f1 while it decays. */
function blip(ctx, out, at, { f0, f1 = f0, dur, gain, type = 'sine' }) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, at);
  osc.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.6);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
  osc.onended = () => env.disconnect();
}

/** A glassy bell: a fundamental with a quieter, faster-fading overtone. */
function bell(ctx, out, at, freq, dur, gain) {
  blip(ctx, out, at, { f0: freq, dur, gain });
  blip(ctx, out, at, { f0: freq * 2.76, dur: dur * 0.4, gain: gain * 0.25 });
}

const SOUNDS = {
  hover: (ctx, out, t) => {
    blip(ctx, out, t, { f0: 2600, f1: 2100, dur: 0.05, gain: 0.3 });
  },
  select: (ctx, out, t) => {
    blip(ctx, out, t, { f0: 520, f1: 1250, dur: 0.08, gain: 0.75 });
    bell(ctx, out, t + 0.03, 1568, 0.25, 0.4); // G6
  },
  back: (ctx, out, t) => {
    blip(ctx, out, t, { f0: 1150, f1: 480, dur: 0.09, gain: 0.7 });
    bell(ctx, out, t + 0.03, 1047, 0.22, 0.35); // C6
  },
  toggleOn: (ctx, out, t) => {
    bell(ctx, out, t, 1319, 0.14, 0.45); // E6
    bell(ctx, out, t + 0.07, 1760, 0.2, 0.45); // A6
  },
  toggleOff: (ctx, out, t) => {
    bell(ctx, out, t, 1760, 0.14, 0.4);
    bell(ctx, out, t + 0.07, 1319, 0.2, 0.4);
  },
  tick: (ctx, out, t) => {
    blip(ctx, out, t, { f0: 3200, f1: 2800, dur: 0.035, gain: 0.22 });
  },
};

export function playUISound(name) {
  const play = SOUNDS[name];
  if (!play) return;
  const { ctx, sfx } = getMixer();
  if (ctx.state === 'running') { play(ctx, sfx, ctx.currentTime + 0.005); return; }
  // The very first press also unlocks audio: play once it has resumed. Hovers and slider
  // ticks before that are dropped, or they would all burst out together.
  if (name === 'hover' || name === 'tick' || ctx.state === 'closed') return;
  ctx.resume().then(() => play(ctx, sfx, ctx.currentTime + 0.005), () => {});
}
