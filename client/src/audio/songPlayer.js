import { getMixer } from './mixer.js';

/**
 * Plays a song bundle's audio on the mixer's music bus (so Master, Music and Mute all apply),
 * kept inside the song's playable range: it pauses at the end, and playing from the end
 * starts over. Song time is the audio clock less the output latency, so dancers sampled
 * at timeMs() line up with what is heard.
 *
 * const player = await createSongPlayer(blob, { startMs, endMs });
 * player.play(); player.pause(); player.seek(ms); player.timeMs(); player.state ('paused' | 'playing')
 * const off = player.onChange(() => ...); player.dispose();
 */
export async function createSongPlayer(blob, { startMs, endMs }) {
  const { ctx, music } = getMixer();
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const end = Math.min(endMs, buffer.duration * 1000);
  const out = ctx.createGain();
  out.connect(music);
  const listeners = new Set();
  let source = null;
  let positionMs = startMs;
  let startedAt = 0; // ctx time at which song time 0 would have been scheduled
  const clamp = (ms) => Math.min(end, Math.max(startMs, ms));

  const stop = () => {
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* never started */ }
    source.disconnect();
    source = null;
  };
  const latency = () => ctx.outputLatency || ctx.baseLatency || 0;

  const player = {
    state: 'paused',
    durationMs: end - startMs,
    timeMs() {
      if (player.state !== 'playing') return positionMs;
      return clamp((ctx.currentTime - latency() - startedAt) * 1000);
    },
    play() {
      if (player.state === 'playing') return;
      if (ctx.state === 'suspended') ctx.resume();
      if (positionMs >= end - 1) positionMs = startMs;
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(out);
      const at = ctx.currentTime + 0.03;
      source.start(at, positionMs / 1000, (end - positionMs) / 1000);
      startedAt = at - positionMs / 1000;
      const mine = source;
      source.onended = () => {
        if (source !== mine) return;
        stop();
        positionMs = end;
        player.state = 'paused';
        emit();
      };
      player.state = 'playing';
      emit();
    },
    pause() {
      if (player.state !== 'playing') return;
      positionMs = player.timeMs();
      stop();
      player.state = 'paused';
      emit();
    },
    seek(ms) {
      const playing = player.state === 'playing';
      stop();
      player.state = 'paused';
      positionMs = clamp(ms);
      if (playing) player.play();
      else emit();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      stop();
      out.disconnect();
      listeners.clear();
    },
  };
  function emit() { for (const fn of listeners) fn(player); }
  return player;
}
