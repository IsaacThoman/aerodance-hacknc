import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mirrorPose } from '../../pose/choreography.js';
import { sampleSong } from '../../pose/song.js';
import { MAX_SCORE, SCORER_VERSION, createScorer, gradeFor, judge } from '../scorer.js';

// The shipped routine is the fixture: both tracks, real tracking noise and real gaps.
const dir = new URL('../../../client/public/songs/song-70c63c8e/', import.meta.url);
const bundle = {
  song: JSON.parse(readFileSync(new URL('song.json', dir))),
  choreography: JSON.parse(readFileSync(new URL('choreography.json', dir))),
};
const { song } = bundle;
const ASPECT = 640 / 480;

const reference = (id, t) => {
  const clamped = Math.min(Math.max(t, song.playableStartMs), song.playableEndMs - 1);
  return sampleSong(bundle, clamped, 2).poses.find((p) => p.playerId === id)?.landmarks ?? null;
};

function random(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Feed a scorer live poses at `rate` per second with timing jitter, as a camera would. */
function play(poseAt, { players = 2, rate = 9, jitter = 30, seed = 1, order = 'in-order', duplicate = false } = {}) {
  const scorer = createScorer(bundle, players);
  const rnd = random(seed);
  const samples = [];
  for (let t = song.playableStartMs; t < song.playableEndMs; t += 1000 / rate) {
    const at = t + (rnd() - 0.5) * jitter;
    for (let id = 0; id < players; id++) {
      const landmarks = poseAt(id, at);
      if (landmarks) samples.push([id, at, landmarks]);
    }
  }
  if (order === 'shuffled') {
    // Delivery jitter: neighbours swap places, never by more than the late allowance.
    for (let i = 0; i + 1 < samples.length; i += 2) if (rnd() < 0.5) [samples[i], samples[i + 1]] = [samples[i + 1], samples[i]];
  }
  for (const s of samples) {
    scorer.addSample(...s, ASPECT);
    if (duplicate) scorer.addSample(...s, ASPECT);
    scorer.advance(s[1] - 750);
  }
  scorer.finish();
  return scorer.results();
}

const perfect = play(reference);

test('copying the reference exactly scores close to the maximum', () => {
  for (const r of perfect) {
    assert.ok(r.score > 0.97 * MAX_SCORE, `score ${r.score}`);
    assert.equal(r.grade, 'S');
    assert.equal(r.judgements.miss + r.judgements.lost, 0);
    assert.equal(r.scorerVersion, SCORER_VERSION);
    assert.ok(r.coverage > 0.99);
  }
});

test('timing mistakes cost points, more the later the player is', () => {
  const late200 = play((id, t) => reference(id, t - 200));
  const late400 = play((id, t) => reference(id, t - 400));
  for (const id of [0, 1]) {
    assert.ok(late200[id].score < perfect[id].score, 'late 200 ms < on time');
    assert.ok(late400[id].score < late200[id].score, 'late 400 ms < late 200 ms');
  }
  // Within the timing tolerance a small offset is nearly free, but it is still measured.
  const late100 = play((id, t) => reference(id, t - 100));
  for (const id of [0, 1]) {
    assert.ok(late100[id].score > 0.95 * MAX_SCORE);
    assert.ok(late100[id].meanOffsetMs < -30, `mean offset ${late100[id].meanOffsetMs}`);
  }
});

test('holding one pose through a moving routine scores poorly', () => {
  const held = [reference(0, 5000), reference(1, 5000)];
  const results = play((id) => held[id]);
  for (const id of [0, 1]) {
    assert.ok(results[id].score < 0.6 * perfect[id].score, `held ${results[id].score}`);
    assert.ok(['C', 'D'].includes(results[id].grade));
  }
});

test('dancing the mirror image instead of the routine loses points', () => {
  const results = play((id, t) => {
    const landmarks = reference(id, t);
    return landmarks && mirrorPose({ landmarks }).landmarks;
  });
  for (const id of [0, 1]) assert.ok(results[id].score < 0.9 * perfect[id].score);
});

test('nobody in view earns nothing and every judgement is lost tracking', () => {
  const results = play(() => null);
  for (const r of results) {
    assert.equal(r.score, 0);
    assert.equal(r.coverage, 0);
    assert.equal(r.judgements.lost, r.judgements.perfect + r.judgements.good + r.judgements.ok + r.judgements.miss + r.judgements.lost);
  }
});

test('missing tracking never shrinks the possible score', () => {
  const half = play((id, t) => (Math.floor(t / 2000) % 2 ? reference(id, t) : null));
  for (const id of [0, 1]) {
    assert.equal(half[id].possibleIntervals, perfect[id].possibleIntervals);
    assert.ok(half[id].score < 0.6 * MAX_SCORE && half[id].score > 0.4 * MAX_SCORE, `half ${half[id].score}`);
    assert.ok(half[id].coverage < 0.6);
  }
});

test('scores do not depend on frame rate, duplicates or delivery order', () => {
  const runs = [
    play(reference, { rate: 30 }),
    play(reference, { rate: 5 }),
    play(reference, { duplicate: true }),
    play(reference, { order: 'shuffled' }),
  ];
  for (const run of runs) {
    for (const id of [0, 1]) assert.ok(Math.abs(run[id].score - perfect[id].score) < 0.02 * MAX_SCORE, `${run[id].score} vs ${perfect[id].score}`);
  }
  // Exactly the same input gives exactly the same result.
  assert.deepEqual(play(reference), perfect);
  assert.deepEqual(play(reference, { duplicate: true }), play(reference));
});

test('player 1 in one-player mode scores the same as in two-player mode', () => {
  const solo = play(reference, { players: 1 });
  assert.equal(solo.length, 1);
  assert.deepEqual(solo[0], perfect[0]);
});

test('judgements are emitted once per second of song with a running combo', () => {
  const scorer = createScorer(bundle, 1);
  const events = [];
  scorer.onJudgement((e) => events.push(e));
  for (let t = 0; t < song.playableEndMs; t += 100) {
    const landmarks = reference(0, t);
    if (landmarks) scorer.addSample(0, t, landmarks, ASPECT);
  }
  scorer.advance(10_000);
  const early = events.length;
  assert.ok(early >= 8 && early <= 10, `${early} judgements by 10 s`);
  scorer.finish();
  assert.equal(events.length, Math.ceil(Math.floor((song.playableEndMs - song.playableStartMs) / 100) / 10));
  assert.ok(events.every((e, i) => i === 0 || e.songTimeMs > events[i - 1].songTimeMs));
  assert.equal(events.at(-1).combo, scorer.result(0).maxCombo);
  assert.ok(scorer.done);
});

test('a pause drops live samples from after the paused position', () => {
  const scorer = createScorer(bundle, 1);
  scorer.addSample(0, 1000, reference(0, 1000), ASPECT);
  scorer.addSample(0, 1200, reference(0, 1200), ASPECT);
  scorer.discardAfter(1100);
  scorer.advance(1600);
  scorer.addSample(0, 1150, reference(0, 1150), ASPECT);
  assert.equal(scorer.result(0).possibleIntervals, perfect[0].possibleIntervals);
});

test('thresholds map scores to judgements and grades', () => {
  assert.equal(judge(0.95), 'perfect');
  assert.equal(judge(0.7), 'good');
  assert.equal(judge(0.5), 'ok');
  assert.equal(judge(0.1), 'miss');
  assert.equal(gradeFor(0.95), 'S');
  assert.equal(gradeFor(0.55), 'C');
  assert.equal(gradeFor(0.2), 'D');
});
