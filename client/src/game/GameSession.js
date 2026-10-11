import { createScorer } from '../../../packages/score/scorer.js';
import { createSongPlayer } from '../audio/songPlayer.js';
import { createPoseRecorder } from '../pose/ReplayPoseSource.js';
import { createLivePlayer } from './livePose.js';
import { WebcamCalibration } from './webcamCalibration.js';

/*
 * One play of one song: loading, the ready check, the countdown, the dance, pausing and
 * the results, independent of React and drawing (GameScreen draws it).
 *
 *   loading → calibrating (webcam) → ready → countdown → playing ⇄ paused → finishing → results
 *
 * Everything runs on the song's audible clock (audio/songPlayer.js): the countdown is the
 * scheduled start, the reference dancers sample it, and every live pose is placed at the
 * song position audible when the camera captured it, so neither rendering nor network
 * delay decides which reference pose a player is compared against.
 *
 * const session = new GameSession({ bundle, playerCount, source });
 * await session.load(); session.update(performance.now()) every frame;
 * session.start(); session.pause(); session.resume(); session.dispose();
 */

export const COUNTDOWN_MS = 3000;
// Live poses can arrive this late (Android's processing, Wi-Fi) and still count.
export const LATE_ALLOWANCE_MS = 750;
// The ready check: every player tracked and calibrated for this long starts the countdown.
export const READY_HOLD_MS = 1000;
const PRESENT_MS = 400;
// A live pose this far before the song still feeds the first second's movement.
const LEAD_MS = 1000;

export class GameSession {
  constructor({ bundle, playerCount, source, createPlayer = createSongPlayer, now = () => performance.now(), record = false, autoStart = true }) {
    Object.assign(this, { bundle, playerCount, source, createPlayer, now, recordPoses: record, autoStart });
    this.phase = 'loading';
    this.error = '';
    this.player = null;
    this.scorer = createScorer(bundle, playerCount);
    this.webcamCalibration = source?.view?.sourceKind === 'webcam' ? new WebcamCalibration(playerCount) : null;
    this.live = Array.from({ length: playerCount }, () => createLivePlayer({ autoCalibrate: !this.webcamCalibration }));
    this.present = Array(playerCount).fill(-Infinity);
    this.readySince = null;
    this.acceptFromMs = bundle.song.playableStartMs - LEAD_MS;
    this.finishAt = null;
    this.results = null;
    this.recording = null;
    this.listeners = new Set();
    this.judgementListeners = new Set();
    this.scorer.onJudgement((e) => { for (const fn of this.judgementListeners) fn(e); });
    this.offRecords = source?.subscribeRecords?.((e) => this.onRecord(e)) ?? (() => {});
    this.clock = {
      bundle,
      songTimeAt: (perf) => this.player?.songTimeAt(perf) ?? bundle.song.playableStartMs,
      perfAtSong: (ms) => this.now() - ((this.player?.rawTimeMs() ?? ms) - ms),
      playing: () => this.player?.state === 'playing',
    };
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onJudgement(fn) { this.judgementListeners.add(fn); return () => this.judgementListeners.delete(fn); }
  set(phase, patch = {}) {
    Object.assign(this, patch, { phase });
    for (const fn of this.listeners) fn(this);
  }

  async load() {
    const { song } = this.bundle;
    try {
      const player = await this.createPlayer(this.bundle.audio, { startMs: song.playableStartMs, endMs: song.playableEndMs });
      if (this.phase === 'disposed') { player.dispose(); return; }
      this.player = player;
      this.set(this.webcamCalibration ? 'calibrating' : 'ready');
    } catch {
      if (this.phase !== 'disposed') this.set('error', { error: 'This browser could not decode the song audio.' });
    }
  }

  /** Per player: 'missing' (not in view), 'calibrating' (in view, settling) or 'ready'. */
  readiness(now = this.now()) {
    return this.live.map((p, id) => (now - this.present[id] > PRESENT_MS ? 'missing' : p.calibration ? 'ready' : 'calibrating'));
  }

  calibrationStatus(now = this.now()) { return this.webcamCalibration?.status(now) ?? null; }

  onRecord({ record, captureBrowserTimeMs }) {
    if (record?.type !== 'pose' || record.playerCount !== this.playerCount) return;
    const now = this.now();
    for (let id = 0; id < this.playerCount; id++) {
      const pose = record.poses.find((p) => p.playerId === id);
      if (!pose) continue;
      this.present[id] = now;
      this.live[id].push(pose.landmarks, record.input, now);
    }
    if (this.webcamCalibration && ['calibrating', 'ready'].includes(this.phase)) {
      if (this.webcamCalibration.accept(record, captureBrowserTimeMs, now)) {
        this.webcamCalibration.tracks.forEach((profile, id) => {
          if (this.live[id].calibration !== profile) this.live[id].setCalibration(profile);
        });
        if (this.phase !== 'ready') this.set('ready');
      } else if (this.phase === 'ready' && !this.calibrationStatus(now).complete) {
        this.live.forEach(p => p.setCalibration(null));
        this.set('calibrating');
      }
    }
    if (!['countdown', 'playing', 'finishing'].includes(this.phase) || !Number.isFinite(captureBrowserTimeMs)) return;
    if (this.player.state !== 'playing') return;
    const songMs = this.player.songTimeAt(captureBrowserTimeMs);
    if (songMs <= this.acceptFromMs || songMs > this.bundle.song.playableEndMs + LATE_ALLOWANCE_MS) return;
    const aspect = record.input.width / record.input.height;
    for (const pose of record.poses) {
      if (pose.playerId < this.playerCount) this.scorer.addSample(pose.playerId, songMs, pose.landmarks, aspect);
    }
  }

  /** The smoothed live pose to draw for a player (null hides their character). */
  livePose(id, now = this.now()) {
    return this.live[id]?.frame(now, now - this.present[id] <= PRESENT_MS) ?? null;
  }

  /** Starts the countdown; the song and the dancers begin together when it reaches zero. */
  start() {
    if (this.phase !== 'ready') return;
    if (this.webcamCalibration && !this.calibrationStatus().complete) return;
    this.source?.attachSong?.(this.clock);
    if (this.recordPoses && this.source) {
      this.recording = createPoseRecorder(this.source, { songId: this.bundle.song.songId, songTimeAt: (perf) => this.player.songTimeAt(perf), playerCount: this.playerCount });
    }
    this.player.play({ delayMs: COUNTDOWN_MS });
    this.set('countdown');
  }

  /** Milliseconds until the song (re)starts, during the countdown. */
  countdownMs() {
    if (this.phase !== 'countdown') return 0;
    return Math.max(0, this.resumeFromMs() - this.player.rawTimeMs());
  }
  resumeFromMs() { return this.pausedAtMs ?? this.bundle.song.playableStartMs; }

  pause() {
    if (!['countdown', 'playing'].includes(this.phase)) return;
    const at = this.phase === 'countdown' ? this.resumeFromMs() : this.player.timeMs();
    this.player.pause();
    this.player.seek(at);
    // Poses from after this point would be compared against a song that stopped.
    this.scorer.discardAfter(at);
    this.acceptFromMs = Math.max(this.acceptFromMs, at);
    this.set('paused', { pausedAtMs: at });
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.player.play({ delayMs: COUNTDOWN_MS });
    this.set('countdown');
  }

  update(now = this.now()) {
    const { phase, player } = this;
    if (this.webcamCalibration && ['calibrating', 'ready'].includes(phase)) {
      const { complete } = this.calibrationStatus(now);
      if (phase === 'ready' && !complete) {
        this.live.forEach(p => p.setCalibration(null));
        this.set('calibrating');
      } else if (phase === 'ready' && this.autoStart) this.start();
    } else if (phase === 'ready') {
      const ready = this.readiness(now).every((r) => r === 'ready');
      this.readySince = ready ? this.readySince ?? now : null;
      if (this.autoStart && ready && now - this.readySince >= READY_HOLD_MS) this.start();
    } else if (phase === 'countdown') {
      if (player.rawTimeMs() >= this.resumeFromMs()) this.set('playing');
    } else if (phase === 'playing') {
      this.scorer.advance(player.timeMs() - LATE_ALLOWANCE_MS);
      if (player.ended) this.set('finishing', { finishAt: now + LATE_ALLOWANCE_MS });
    } else if (phase === 'finishing' && now >= this.finishAt) {
      this.scorer.finish();
      this.source?.attachSong?.(null);
      const recording = this.recording?.stop() ?? null;
      this.recording = null;
      this.set('results', { results: this.scorer.results(), recordingText: recording });
    }
  }

  /** The reference dancers' routine for StageView. */
  routine() {
    return {
      bundle: this.bundle,
      playerCount: this.playerCount,
      timeMs: () => this.player?.timeMs() ?? this.bundle.song.playableStartMs,
      playing: () => this.player?.state === 'playing',
    };
  }

  dispose() {
    this.offRecords();
    this.source?.attachSong?.(null);
    this.recording?.stop();
    this.player?.dispose();
    this.listeners.clear();
    this.judgementListeners.clear();
    this.phase = 'disposed';
  }
}
