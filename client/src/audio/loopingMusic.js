import { useEffect } from 'react';
import { getMixer } from './mixer.js';

/*
 * Background music that loops forever without dropping out, independent of the aero
 * flyover's own (longer) loop. The track is decoded once and replayed on one of the mixer's
 * music inputs: 'menuMusic' (the menu track, behind the Menu music switch) or 'music'
 * (in-game songs). Both follow the Music slider, Master and Mute all (mixer.js). To loop
 * seamlessly:
 *   - the silent MP3 padding at either end is trimmed off;
 *   - each play-through starts the next one as its fade-out begins, so the outro overlaps
 *     the next intro like a DJ crossfade instead of trailing off into near-silence.
 * The next play-through is always queued one lap ahead, so throttled timers in a background
 * tab can't leave a gap. It fades in once audio is unlocked by the first click or key press.
 */

const SILENCE = 1e-4; // about -80 dB
const WINDOW = 0.25; // seconds per loudness measurement
const TAIL_LEVEL = 0.1; // the outro starts where loudness falls below 10% of the track's
const MAX_OVERLAP = 6;
const FADE_IN = 1.5;

const rmsAt = (channels, from, n) => {
  let sum = 0;
  for (const d of channels) for (let i = from; i < from + n; i++) sum += d[i] * d[i];
  return Math.sqrt(sum / (n * channels.length));
};

/** Where the audible track starts and ends, and where its fade-out begins (seconds). */
export function loopPoints(buffer) {
  const sr = buffer.sampleRate;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const loud = (i) => channels.some((d) => Math.abs(d[i]) > SILENCE);
  let first = 0;
  let last = buffer.length - 1;
  while (first < last && !loud(first)) first++;
  while (last > first && !loud(last)) last--;
  const start = first / sr;
  const end = (last + 1) / sr;

  const n = Math.round(WINDOW * sr);
  const overall = rmsAt(channels, first, last - first);
  let tail = last - n;
  const limit = Math.max(first, last - MAX_OVERLAP * sr);
  while (tail > limit && rmsAt(channels, tail, n) < overall * TAIL_LEVEL) tail -= n;
  return { start, end, next: Math.min(end, (tail + n) / sr) };
}

export function createLoopingMusic(url, { channel = 'music' } = {}) {
  const mixer = getMixer();
  const { ctx } = mixer;
  const fade = ctx.createGain();
  fade.gain.value = 0;
  fade.connect(mixer[channel]);
  const sources = new Set();
  let disposed = false;
  let faded = false;
  let timer = 0;

  const fadeIn = () => {
    if (faded || !timer || ctx.state !== 'running') return;
    faded = true;
    fade.gain.setValueAtTime(0, ctx.currentTime);
    fade.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_IN);
  };

  const play = (buffer) => {
    const { start, end, next } = loopPoints(buffer);
    const lap = next - start;
    let at = ctx.currentTime + 0.05;
    const queue = () => {
      // Keep the play-through after the current one already scheduled.
      while (at < ctx.currentTime + lap + 1) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(fade);
        source.start(at, start, end - start);
        source.onended = () => { source.disconnect(); sources.delete(source); };
        sources.add(source);
        at += lap;
      }
    };
    queue();
    timer = setInterval(queue, 1000);
    fadeIn();
  };

  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.arrayBuffer();
    })
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => { if (!disposed) play(buffer); })
    .catch((err) => { if (!disposed) console.warn('background music could not load:', err.message); });

  ctx.addEventListener('statechange', fadeIn);

  return {
    dispose() {
      disposed = true;
      clearInterval(timer);
      ctx.removeEventListener('statechange', fadeIn);
      for (const source of sources) source.stop();
      fade.disconnect();
    },
  };
}

/** Plays `url` on a continuous loop while mounted, into the mixer's `channel`. */
export function useLoopingMusic(url, channel = 'music') {
  useEffect(() => {
    const m = createLoopingMusic(url, { channel });
    return () => m.dispose();
  }, [url, channel]);
}
