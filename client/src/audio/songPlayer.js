import { getMixer } from './mixer.js';

/**
 * Plays a song bundle's audio on the mixer's music bus (so Master, Music and Mute all apply),
 * kept inside the song's playable range: it pauses at the end, and playing from the end
 * starts over. Song time is the audible position: the audio clock mapped through the output
 * timestamp (or less the output latency where that's missing), so dancers sampled at
 * timeMs() line up with what is heard, and a pose captured at a performance.now() time maps
 * to the song position the player was hearing then (songTimeAt).
 *
 * const player = await createSongPlayer(blob, { startMs, endMs });
 * player.play(); player.play({ delayMs: 3000 }) (scheduled: the countdown); player.pause();
 * player.seek(ms); player.timeMs(); player.rawTimeMs() (unclamped: negative before a
 * scheduled start); player.songTimeAt(perfMs); player.state ('paused' | 'playing');
 * player.ended (true once it plays out to the end)
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
  let playFrom = startMs; // where the current play() starts: song time holds here until then
  const clamp = (ms) => Math.min(end, Math.max(startMs, ms));

  const stop = () => {
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* never started */ }
    source.disconnect();
    source = null;
  };
  const latency = () => ctx.outputLatency || ctx.baseLatency || 0;
  // The context time being heard at a performance.now() time.
  const audibleAt = (perfMs) => {
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    return ctx.currentTime - latency() + (perfMs - performance.now()) / 1000;
  };

  const player = {
    state: 'paused',
    durationMs: end - startMs,
    startMs,
    endMs: end,
    ended: false,
    timeMs() {
      const raw = player.rawTimeMs();
      return clamp(player.state === 'playing' ? Math.max(raw, playFrom) : raw);
    },
    rawTimeMs() {
      if (player.state !== 'playing') return positionMs;
      return (audibleAt(performance.now()) - startedAt) * 1000;
    },
    /** The song position audible at a performance.now() time (unclamped). */
    songTimeAt(perfMs) {
      if (player.state !== 'playing') return positionMs;
      return (audibleAt(perfMs) - startedAt) * 1000;
    },
    play({ delayMs = 0 } = {}) {
      if (player.state === 'playing') return;
      if (ctx.state === 'suspended') ctx.resume();
      if (positionMs >= end - 1) positionMs = startMs;
      player.ended = false;
      playFrom = positionMs;
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(out);
      const at = ctx.currentTime + 0.03 + delayMs / 1000;
      source.start(at, positionMs / 1000, (end - positionMs) / 1000);
      startedAt = at - positionMs / 1000;
      const mine = source;
      source.onended = () => {
        if (source !== mine) return;
        stop();
        positionMs = end;
        player.state = 'paused';
        player.ended = true;
        emit();
      };
      player.state = 'playing';
      emit();
    },
    pause() {
      if (player.state !== 'playing') return;
      // Paused during a scheduled start: stay at the start.
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
