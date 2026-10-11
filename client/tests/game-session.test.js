import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sampleSong } from '../../packages/pose/song.js';
import { COUNTDOWN_MS, GameSession, LATE_ALLOWANCE_MS, READY_HOLD_MS } from '../src/game/GameSession.js';
import { ReplayPoseSource, createPoseRecorder, parseRecording, standingPose } from '../src/pose/ReplayPoseSource.js';
import { bestScore, recordResults } from '../src/game/bestScores.js';

const dir = new URL('../public/songs/song-70c63c8e/', import.meta.url);
const bundle = {
  song: JSON.parse(readFileSync(new URL('song.json', dir))),
  choreography: JSON.parse(readFileSync(new URL('choreography.json', dir))),
};
const { song } = bundle;

/** A song player on a fake clock, with songPlayer.js's surface. */
function fakePlayer(clock) {
  let startPerf = 0;
  let positionMs = song.playableStartMs;
  let playFrom = positionMs;
  const clamp = (ms) => Math.min(song.playableEndMs, Math.max(song.playableStartMs, ms));
  const player = {
    state: 'paused',
    ended: false,
    rawTimeMs: () => (player.state === 'playing' ? clock.now - startPerf : positionMs),
    timeMs: () => clamp(player.state === 'playing' ? Math.max(player.rawTimeMs(), playFrom) : positionMs),
    songTimeAt: (perf) => (player.state === 'playing' ? perf - startPerf : positionMs),
    play({ delayMs = 0 } = {}) { playFrom = positionMs; startPerf = clock.now + delayMs - positionMs; player.state = 'playing'; player.ended = false; },
    pause() { positionMs = player.timeMs(); player.state = 'paused'; },
    seek(ms) { positionMs = clamp(ms); },
    // The song plays out: the audio source ends.
    tick() { if (player.state === 'playing' && player.rawTimeMs() >= song.playableEndMs) { positionMs = song.playableEndMs; player.state = 'paused'; player.ended = true; } },
    dispose() { player.disposed = true; },
  };
  return player;
}

/** A pose source the test drives by hand. */
function fakeSource() {
  const listeners = new Set();
  return {
    attached: null,
    subscribeRecords(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    attachSong(clock) { this.attached = clock; },
    send(poses, captureBrowserTimeMs, playerCount = 1) {
      const record = { protocolVersion: 2, type: 'pose', sessionId: 's', seq: 1, playerCount, frameReceivedTimeMs: 0, resultTimeMs: 0, input: { width: 640, height: 480, mirrored: false }, poses };
      for (const fn of listeners) fn({ record, captureBrowserTimeMs });
    },
  };
}

async function setup(playerCount = 1, options = {}) {
  const clock = { now: 1000 };
  let player;
  const source = fakeSource();
  const session = new GameSession({
    bundle, playerCount, source, now: () => clock.now, createPlayer: async () => (player = fakePlayer(clock)), ...options,
  });
  await session.load();
  const step = (ms, each) => {
    for (let t = 0; t < ms; t += 50) {
      clock.now += 50;
      each?.(clock.now);
      player.tick();
      session.update(clock.now);
    }
  };
  return { clock, session, source, step, player: () => player };
}

const standing = (playerCount) => (playerCount === 1 ? [0.5] : [0.3, 0.7]).map((cx, playerId) => ({ playerId, landmarks: standingPose(cx) }));
const reference = (t, playerCount) => sampleSong(bundle, Math.min(Math.max(t, 0), song.playableEndMs - 1), playerCount).poses;

test('the ready check waits for every player, then counts down into the song', async () => {
  const { session, source, step } = await setup(2);
  assert.equal(session.phase, 'ready');
  assert.deepEqual(session.readiness(), ['missing', 'missing']);
  // Only player 1 in view: nothing starts.
  step(2000, (now) => source.send([standing(2)[0]], now, 2));
  assert.equal(session.phase, 'ready');
  assert.deepEqual(session.readiness(), ['ready', 'missing']);
  // Both in view: calibrate, hold for a second, then the countdown.
  step(1200 + READY_HOLD_MS + 200, (now) => source.send(standing(2), now, 2));
  assert.equal(session.phase, 'countdown');
  assert.ok(source.attached, 'the pose source follows the song clock');
  assert.ok(session.livePose(0) && session.livePose(1));
  step(COUNTDOWN_MS - 400);
  assert.equal(session.phase, 'countdown');
  assert.ok(session.countdownMs() > 0);
  step(600);
  assert.equal(session.phase, 'playing');
});

test('a player who copies the routine scores high, judged at capture time despite late arrival', async () => {
  const { session, source, step, player } = await setup(1, { autoStart: false });
  session.start();
  const pending = [];
  step(COUNTDOWN_MS + song.playableEndMs + LATE_ALLOWANCE_MS + 500, (now) => {
    // The camera sees the player now; the pose arrives 300 ms later.
    if (player().state === 'playing' && now % 100 === 0) pending.push({ at: now + 300, capture: now, poses: reference(player().songTimeAt(now), 1) });
    while (pending.length && pending[0].at <= now) { const p = pending.shift(); source.send(p.poses, p.capture); }
  });
  assert.equal(session.phase, 'results');
  assert.equal(session.results.length, 1);
  assert.ok(session.results[0].score > 950_000, `score ${session.results[0].score}`);
  assert.equal(source.attached, null, 'the source is released from the song');
});

test('pausing stops scoring, drops later poses and resumes with a countdown at the same spot', async () => {
  const { session, source, step, player } = await setup(1, { autoStart: false });
  session.start();
  step(COUNTDOWN_MS + 5000);
  assert.equal(session.phase, 'playing');
  const at = player().timeMs();
  session.pause();
  assert.equal(session.phase, 'paused');
  assert.equal(session.pausedAtMs, at);
  step(2000);
  assert.equal(player().timeMs(), at, 'the song holds while paused');
  session.resume();
  assert.equal(session.phase, 'countdown');
  // Poses captured during the resume countdown map to before the pause: never scored.
  const before = session.scorer.result(0).score;
  step(COUNTDOWN_MS - 200, (now) => source.send(reference(player().songTimeAt(now), 1), now));
  assert.equal(player().timeMs(), at, 'the dancers hold their place during the countdown');
  session.scorer.finish();
  assert.equal(session.scorer.result(0).score, before);
});

test('the song finishes after the late-arrival allowance, with results', async () => {
  const { session, step } = await setup(1, { autoStart: false });
  session.start();
  step(COUNTDOWN_MS + song.playableEndMs + 100);
  assert.equal(session.phase, 'finishing');
  step(LATE_ALLOWANCE_MS);
  assert.equal(session.phase, 'results');
  assert.equal(session.results[0].score, 0, 'nobody danced');
  assert.equal(session.results[0].coverage, 0);
});

test('the entrance follows the first beat and holds through pause and resume', async () => {
  const { session, step } = await setup(1, { autoStart: false });
  const routine = session.routine();
  assert.equal(routine.entranceTimeMs(), -Infinity, 'hidden during the ready check');
  session.start();
  assert.equal(routine.entranceTimeMs(), -COUNTDOWN_MS);
  step(COUNTDOWN_MS - 500);
  assert.equal(routine.entranceTimeMs(), -500);
  session.pause();
  step(1000);
  assert.equal(routine.entranceTimeMs(), -500, 'pausing mid-entrance freezes the effect');
  session.resume();
  assert.equal(routine.entranceTimeMs(), -COUNTDOWN_MS, 'an interrupted entrance starts again');
  step(COUNTDOWN_MS);
  assert.equal(routine.entranceTimeMs(), 0);
  step(300);
  session.pause();
  step(1000);
  assert.equal(routine.entranceTimeMs(), 300);
  session.resume();
  step(COUNTDOWN_MS - 100);
  assert.equal(routine.entranceTimeMs(), 300, 'resume keeps an appeared dancer in place');
  step(200);
  assert.equal(routine.entranceTimeMs(), 400);
  session.dispose();
  const retry = await setup(2, { autoStart: false });
  assert.equal(retry.session.routine().entranceTimeMs(), -Infinity);
  retry.session.start();
  assert.equal(retry.session.routine().entranceTimeMs(), -COUNTDOWN_MS, 'a new run gets a fresh entrance');
  retry.session.dispose();
});

test('the ghost replay dances the routine and stands in its halves without a song', async () => {
  let now = 0;
  const ghost = new ReplayPoseSource({ now: () => now });
  const records = [];
  ghost.subscribeRecords((e) => records.push(e));
  await ghost.setPlayerCount(2);
  ghost.tick();
  assert.deepEqual(records[0].record.poses.map((p) => p.playerId), [0, 1]);
  assert.ok(records[0].record.poses[0].landmarks[23].x < 0.5 && records[0].record.poses[1].landmarks[23].x > 0.5);
  ghost.attachSong({ bundle, songTimeAt: (perf) => perf, perfAtSong: (ms) => ms, playing: () => true });
  now = 5000;
  ghost.tick();
  const pose = records.at(-1).record.poses[0].landmarks[23];
  const ref = reference(5000, 2)[0].landmarks[23];
  assert.ok(Math.abs(pose.x - ref.x) < 0.05 && Math.abs(pose.y - ref.y) < 0.05);
  assert.equal(records.at(-1).captureBrowserTimeMs, 5000);
});

test('a pose recording replays at the song times it was captured', async () => {
  const source = fakeSource();
  const recorder = createPoseRecorder(source, { songId: song.songId, songTimeAt: (perf) => perf - 100, playerCount: 1 });
  source.send(standing(1), 1100);
  source.send(standing(1), 1200);
  const { header, entries } = parseRecording(recorder.stop());
  assert.equal(header.songId, song.songId);
  assert.deepEqual(entries.map((e) => e.songTimeMs), [1000, 1100]);

  let now = 0;
  const replay = new ReplayPoseSource({ now: () => now, mode: 'recording', recording: { header, entries } });
  const out = [];
  replay.subscribeRecords((e) => out.push(e.captureBrowserTimeMs));
  replay.attachSong({ bundle, songTimeAt: (perf) => perf - 500, perfAtSong: (ms) => ms + 500, playing: () => true });
  now = 1550;
  replay.tick();
  assert.deepEqual(out, [1500]);
  now = 1700;
  replay.tick();
  assert.deepEqual(out, [1500, 1600]);
});

test('best scores keep the top score per song, mode and scorer version', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const r = (score) => ({ score, grade: 'A', accuracy: score / 1e6, scorerVersion: 1 });
  assert.equal(recordResults('song', 2, [r(500), r(700)], storage).isNewBest, true);
  assert.equal(bestScore('song', 2, 1, storage).score, 700);
  assert.equal(recordResults('song', 2, [r(600)], storage).isNewBest, false);
  assert.equal(recordResults('song', 1, [r(100)], storage).isNewBest, true);
  assert.equal(bestScore('song', 2, 2, storage), null);
});
