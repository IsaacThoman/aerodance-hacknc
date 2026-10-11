import { sampleSong } from '../../../packages/pose/song.js';

/*
 * A pose source that plays back poses instead of tracking anyone, with the same surface as
 * AndroidPoseSource (subscribe, subscribeRecords, setPlayerCount, connect, disconnect), so
 * the game, its tests and demos run without the board.
 *
 *   ghost       dances the song's own choreography (each player copies their track), with
 *               a little tracking noise and an optional lag: an autoplay that should score
 *               near the top, or lower with ?ghostLagMs=400.
 *   recording   replays a pose recording (createPoseRecorder) made during a real song, at
 *               the song times the poses were captured.
 *
 * Without a song attached (the menus) both stand still in their camera halves. The game
 * attaches the song while it plays: attachSong({ bundle, songTimeAt(perfMs), perfAtSong(ms),
 * playing() }) and attachSong(null) after.
 */

const RATE_HZ = 10;
const STALE_MS = 500;
const ASPECT_INPUT = { width: 640, height: 480, mirrored: false };

/** A relaxed standing pose centred at image x = cx (unmirrored: the person's left is image right). */
export function standingPose(cx) {
  const at = (dx, y) => ({ x: cx + dx, y, z: 0, visibility: 0.99, presence: 0.99 });
  const lm = [];
  lm[0] = at(0, 0.2);
  [[1, 0.012], [2, 0.02], [3, 0.028]].forEach(([i, dx]) => { lm[i] = at(dx, 0.19); lm[i + 3] = at(-dx, 0.19); });
  lm[7] = at(0.035, 0.2); lm[8] = at(-0.035, 0.2);
  lm[9] = at(0.012, 0.225); lm[10] = at(-0.012, 0.225);
  for (const [i, dx, y] of [[11, 0.07, 0.32], [13, 0.085, 0.44], [15, 0.09, 0.55], [17, 0.095, 0.58], [19, 0.09, 0.59], [21, 0.08, 0.57],
    [23, 0.045, 0.56], [25, 0.05, 0.72], [27, 0.05, 0.88], [29, 0.048, 0.9], [31, 0.06, 0.91]]) {
    lm[i] = at(dx, y);
    lm[i + 1] = at(-dx, y);
  }
  return lm;
}

function gaussian(rnd) {
  return Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
}

/** Parse an NDJSON pose recording: a header line, then { songTimeMs, record } lines. */
export function parseRecording(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  const header = JSON.parse(lines[0]);
  if (header.schema !== 'aerodance.pose-recording' || header.schemaVersion !== 1) throw Error('Unsupported pose recording');
  const entries = lines.slice(1).map((l) => JSON.parse(l)).filter((e) => Number.isFinite(e.songTimeMs) && e.record?.type === 'pose');
  entries.sort((a, b) => a.songTimeMs - b.songTimeMs);
  return { header, entries };
}

export class ReplayPoseSource {
  constructor({ now = () => performance.now(), mode = 'ghost', recording = null, lagMs = 0, noise = 0.006, seed = 7 } = {}) {
    Object.assign(this, { now, mode, recording, lagMs, noise });
    this.listeners = new Set();
    this.recordListeners = new Set();
    this.playerCount = 1;
    this.song = null;
    this.seq = 0;
    this.cursor = 0;
    this.last = null;
    this.lastAt = null;
    this.timer = null;
    let s = seed;
    this.rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    this.view = { status: 'disconnected', message: '', snapshot: null, configuring: false, timing: { method: 'none', uncertaintyMs: null }, model: 'replay' };
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }
  subscribeRecords(listener) {
    this.recordListeners.add(listener);
    return () => this.recordListeners.delete(listener);
  }
  publish(patch) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener(this.view);
  }
  connect() {
    this.disconnect();
    this.publish({ status: 'connected', message: this.mode === 'ghost' ? 'Autoplay ghost: the dancers copy the routine.' : 'Replaying a pose recording.', timing: { method: 'replay', uncertaintyMs: 0 } });
    this.timer = setInterval(() => this.tick(), 1000 / RATE_HZ / 2);
  }
  disconnect() {
    clearInterval(this.timer);
    this.timer = null;
    this.last = null;
    this.publish({ status: 'disconnected', snapshot: null, message: '' });
  }
  async setPlayerCount(count) {
    if (![1, 2].includes(count)) throw Error('Choose one or two players');
    this.playerCount = count;
    this.last = null;
    this.publish({ snapshot: null });
  }
  attachSong(song) {
    this.song = song;
    this.cursor = 0;
    this.nextGhostSongMs = null;
  }
  emit(poses, captureBrowserTimeMs, input = ASPECT_INPUT) {
    const frame = Math.round(captureBrowserTimeMs);
    const record = {
      protocolVersion: 2, type: 'pose', sessionId: 'replay', seq: ++this.seq, playerCount: this.playerCount,
      frameReceivedTimeMs: frame, resultTimeMs: frame, input, poses,
    };
    const receivedBrowserTimeMs = this.now();
    this.last = record;
    this.lastAt = receivedBrowserTimeMs;
    for (const listener of this.recordListeners) listener({ record, receivedBrowserTimeMs, captureBrowserTimeMs, timing: this.view.timing });
  }
  jitter(landmarks) {
    if (!this.noise) return landmarks;
    return landmarks.map((j) => ({ ...j, x: j.x + gaussian(this.rnd) * this.noise, y: j.y + gaussian(this.rnd) * this.noise }));
  }
  standing() {
    const xs = this.playerCount === 1 ? [0.5] : [0.3, 0.7];
    return xs.map((cx, playerId) => ({ playerId, landmarks: this.jitter(standingPose(cx)) }));
  }
  tick() {
    const now = this.now();
    const song = this.song;
    if (!song) {
      if (this.lastAt === null || now - this.lastAt >= 1000 / RATE_HZ) this.emit(this.standing(), now);
    } else if (this.mode === 'ghost') {
      this.tickGhost(song, now);
    } else {
      this.tickRecording(song, now);
    }
    const snapshot = this.last && now - this.lastAt < STALE_MS ? this.last : null;
    if (snapshot !== this.view.snapshot) this.publish({ snapshot });
  }
  tickGhost(song, now) {
    const songNow = song.songTimeAt(now);
    if (this.lastAt !== null && now - this.lastAt < 1000 / RATE_HZ) return;
    const { bundle } = song;
    const { playableStartMs, playableEndMs } = bundle.song;
    // The ghost dances what the coach did lagMs ago, held at the ends of the song.
    const t = Math.min(Math.max(songNow - this.lagMs, playableStartMs), playableEndMs - 1);
    const sample = sampleSong(bundle, t, this.playerCount);
    const poses = sample.poses.length ? sample.poses.map((p) => ({ playerId: p.playerId, landmarks: this.jitter(p.landmarks) })) : this.standing();
    const { inputWidth: width, inputHeight: height } = bundle.choreography.tracks[0].calibration;
    this.emit(poses, now, { width, height, mirrored: false });
  }
  tickRecording(song, now) {
    if (!song.playing()) return;
    const songNow = song.songTimeAt(now);
    const entries = this.recording?.entries ?? [];
    while (this.cursor < entries.length && entries[this.cursor].songTimeMs <= songNow) {
      const { songTimeMs, record } = entries[this.cursor++];
      const poses = record.poses.filter((p) => p.playerId < this.playerCount);
      this.emit(poses, song.perfAtSong(songTimeMs), record.input);
    }
  }
}

/**
 * Records every pose a source delivers during a song, at the song time it was captured, for
 * replay (ReplayPoseSource 'recording') and scoring research. Call stop() for NDJSON text.
 */
export function createPoseRecorder(source, { songId, songTimeAt, playerCount }) {
  const lines = [JSON.stringify({ schema: 'aerodance.pose-recording', schemaVersion: 1, songId, playerCount, recordedAt: new Date().toISOString() })];
  const off = source.subscribeRecords(({ record, captureBrowserTimeMs, timing }) => {
    if (record.type !== 'pose' || !Number.isFinite(captureBrowserTimeMs)) return;
    lines.push(JSON.stringify({ songTimeMs: Math.round(songTimeAt(captureBrowserTimeMs) * 10) / 10, timing: timing?.method, record }));
  });
  return {
    stop() {
      off();
      return `${lines.join('\n')}\n`;
    },
  };
}
