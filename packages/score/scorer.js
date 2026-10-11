import { sampleSong } from '../pose/song.js';
import { LIMBS, TOTAL_WEIGHT, angleBetween, lerpDirections, limbDirections, liveUsable } from './features.js';

/*
 * The dance scorer: each player against their own choreography track, on song time.
 * docs/scoring.md explains the method and every constant below; change SCORER_VERSION
 * whenever a change would move scores, so saved bests stay comparable.
 *
 * const scorer = createScorer(bundle, playerCount);
 * scorer.addSample(playerId, songTimeMs, landmarks, aspect);  // live poses, any order
 * scorer.advance(songTimeMs);  // every live sample up to here has arrived
 * scorer.finish();             // the song is over: score what's left
 * scorer.result(playerId);     // { score, accuracy, grade, judgements, combo, ... }
 * const off = scorer.onJudgement(({ playerId, judgement, songTimeMs, combo }) => ...);
 */

export const SCORER_VERSION = 1;
export const MAX_SCORE = 1_000_000;

export const INTERVAL_MS = 100;        // one score per 100 ms of song time
export const WINDOW_INTERVALS = 10;    // one judgement per second
const REF_STEP_MS = 50;                // reference grid, and the timing search step
const SHIFTS_MS = [0, -50, 50, -100, 100, -150, 150];
const MOTION_MS = 300;                 // movement is the change in direction over this span
const MAX_LIVE_GAP_MS = 350;           // interpolate live samples at most this far apart
const MAX_LIVE_REACH_MS = 120;         // otherwise use the nearest sample this close
const SIGMA = 0.8;                     // radians: 15° → 0.90, 30° → 0.66, 60° → 0.18
const MOVING = 0.2;                    // a reference limb moving less than this is holding still
const MOTION_SHARE = 0.4;
const MIN_REFERENCE = 0.5;             // share of limb weight the reference must show to score
const MIN_LIVE = 0.3;                  // below this share of tracked limbs the interval is lost
const LATE_MS = MAX_LIVE_REACH_MS + 150 + 30; // how far past an interval its inputs can reach
// Interval score → share of its points: nothing below FLOOR, everything above CEIL.
const FLOOR = 0.3;
const CEIL = 0.85;
export const JUDGEMENTS = [
  ['perfect', 0.8],
  ['good', 0.65],
  ['ok', 0.45],
  ['miss', -Infinity],
];
const LOST_SHARE = 0.6;
export const GRADES = [['S', 0.9], ['A', 0.8], ['B', 0.65], ['C', 0.5], ['D', -Infinity]];

const shiftFactor = (shift) => {
  const off = Math.abs(shift);
  return off <= 50 ? 1 : 1 - 0.15 * (off - 50) / 100;
};
export const pointsShare = (s) => Math.min(1, Math.max(0, (s - FLOOR) / (CEIL - FLOOR)));
export const judge = (s) => JUDGEMENTS.find(([, min]) => s >= min)[0];
export const gradeFor = (accuracy) => GRADES.find(([, min]) => accuracy >= min)[0];

/** Reference limb directions for one track on a fixed grid, from the bundle's choreography. */
function referenceGrid(bundle, playerCount, playerId) {
  const { song, choreography } = bundle;
  const { inputWidth, inputHeight } = choreography.tracks[playerId].calibration;
  const aspect = inputWidth / inputHeight;
  const from = song.playableStartMs - MOTION_MS - 200;
  const count = Math.ceil((song.playableEndMs + 200 - from) / REF_STEP_MS) + 1;
  const dirs = new Array(count);
  for (let i = 0; i < count; i++) {
    const t = from + i * REF_STEP_MS;
    const { poses, quality } = sampleSong(bundle, t, playerCount);
    const pose = poses.find((p) => p.playerId === playerId);
    const q = quality.find((p) => p.playerId === playerId);
    dirs[i] = pose && q ? limbDirections(pose.landmarks, aspect, q.scoreEligible) : null;
  }
  // Grid points sit exactly on multiples of REF_STEP_MS from `from`, so lookups are exact.
  return (t) => {
    const i = Math.round((t - from) / REF_STEP_MS);
    return i >= 0 && i < count ? dirs[i] : null;
  };
}

const refWeight = (dirs) => (dirs ? LIMBS.reduce((n, l, i) => n + (dirs[i] ? l.weight : 0), 0) : 0);

/**
 * One interval: how well live directions match the reference at a shifted time.
 * Returns { score, live } where live is the share of reference limbs being tracked.
 */
export function compare(live, liveBefore, ref, refBefore) {
  let weight = 0, pose = 0, tracked = 0, moving = 0, motion = 0;
  LIMBS.forEach((limb, i) => {
    const r = ref[i];
    if (!r) return;
    weight += limb.weight;
    const l = live?.[i];
    if (l) {
      tracked += limb.weight;
      const theta = angleBetween(l, r);
      pose += limb.weight * Math.exp(-((theta / SIGMA) ** 2));
    }
    const rb = refBefore?.[i];
    if (!rb) return;
    const drx = r[0] - rb[0], dry = r[1] - rb[1];
    const dr = Math.hypot(drx, dry);
    if (dr < MOVING) return;
    moving += limb.weight;
    const lb = liveBefore?.[i];
    if (!l || !lb) return;
    const miss = Math.hypot(l[0] - lb[0] - drx, l[1] - lb[1] - dry);
    motion += limb.weight * Math.max(0, 1 - miss / dr);
  });
  if (!weight) return { score: 0, live: 0 };
  const poseScore = pose / weight;
  const score = moving >= 1 ? (1 - MOTION_SHARE) * poseScore + MOTION_SHARE * (motion / moving) : poseScore;
  return { score, live: tracked / weight };
}

function createTrack(bundle, playerCount, playerId) {
  const { song } = bundle;
  const ref = referenceGrid(bundle, playerCount, playerId);
  const total = Math.floor((song.playableEndMs - song.playableStartMs) / INTERVAL_MS);
  const times = Array.from({ length: total }, (_, k) => song.playableStartMs + (k + 0.5) * INTERVAL_MS);
  // The scorable set is fixed by the reference alone: missing live input never shrinks it.
  const scorable = times.map((t) => refWeight(ref(t)) >= MIN_REFERENCE * TOTAL_WEIGHT);
  const possible = scorable.filter(Boolean).length;
  return {
    playerId, ref, times, scorable, possible,
    value: possible ? MAX_SCORE / possible : 0,
    samples: [],     // { t, dirs } sorted by song time
    next: 0,         // next interval to score
    earned: 0,       // sum of points shares
    scored: 0, trackedIntervals: 0, offsetSum: 0, offsetCount: 0,
    window: [],      // { score, lost } for the window being filled
    judgements: { perfect: 0, good: 0, ok: 0, miss: 0, lost: 0 },
    combo: 0, maxCombo: 0,
  };
}

function liveAt(track, t) {
  const s = track.samples;
  if (!s.length) return null;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid].t <= t) lo = mid + 1; else hi = mid; }
  const before = s[lo - 1], after = s[lo];
  if (before && after && after.t - before.t <= MAX_LIVE_GAP_MS) {
    return lerpDirections(before.dirs, after.dirs, (t - before.t) / (after.t - before.t));
  }
  const near = [before, after].filter((x) => x && Math.abs(x.t - t) <= MAX_LIVE_REACH_MS)
    .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
  return near ? near.dirs : null;
}

export function createScorer(bundle, playerCount) {
  if (![1, 2].includes(playerCount)) throw Error('Invalid player count');
  const tracks = Array.from({ length: playerCount }, (_, id) => createTrack(bundle, playerCount, id));
  const listeners = new Set();
  const emit = (event) => { for (const fn of listeners) fn(event); };

  function closeWindow(track, songTimeMs) {
    const w = track.window;
    track.window = [];
    if (!w.length) return;
    const mean = w.reduce((n, x) => n + x.score, 0) / w.length;
    const lost = w.filter((x) => x.lost).length / w.length >= LOST_SHARE;
    const judgement = lost ? 'lost' : judge(mean);
    track.judgements[judgement]++;
    track.combo = judgement === 'miss' || judgement === 'lost' ? 0 : track.combo + 1;
    track.maxCombo = Math.max(track.maxCombo, track.combo);
    emit({ playerId: track.playerId, judgement, score: mean, songTimeMs, combo: track.combo });
  }

  function scoreInterval(track, k) {
    const t = track.times[k];
    if (track.scorable[k]) {
      const live = liveAt(track, t);
      const liveBefore = liveAt(track, t - MOTION_MS);
      let best = { score: 0, live: 0 }, bestShift = 0;
      for (const shift of SHIFTS_MS) {
        const ref = track.ref(t + shift);
        if (!ref) continue;
        const c = compare(live, liveBefore, ref, track.ref(t + shift - MOTION_MS));
        const score = c.score * shiftFactor(shift);
        if (shift === 0 || score > best.score) { best = { score, live: c.live }; bestShift = shift; }
      }
      const lost = best.live < MIN_LIVE;
      const score = lost ? 0 : best.score;
      track.earned += pointsShare(score);
      track.scored++;
      if (!lost) track.trackedIntervals++;
      if (score >= JUDGEMENTS[1][1]) { track.offsetSum += bestShift; track.offsetCount++; }
      track.window.push({ score, lost });
    }
    if ((k + 1) % WINDOW_INTERVALS === 0 || k === track.times.length - 1) closeWindow(track, t + INTERVAL_MS / 2);
  }

  const scorer = {
    version: SCORER_VERSION,
    playerCount,
    /** A live pose at its song time (from capture time, not arrival). Duplicates replace. */
    addSample(playerId, songTimeMs, landmarks, aspect) {
      const track = tracks[playerId];
      if (!track || !Number.isFinite(songTimeMs)) return;
      const dirs = limbDirections(landmarks, aspect, liveUsable(landmarks));
      const s = track.samples;
      let i = s.length;
      while (i > 0 && s[i - 1].t > songTimeMs) i--;
      if (i > 0 && s[i - 1].t === songTimeMs) s[i - 1] = { t: songTimeMs, dirs };
      else s.splice(i, 0, { t: songTimeMs, dirs });
    },
    /** Live samples after this song time are dropped (a pause or a seek back). */
    discardAfter(songTimeMs) {
      for (const track of tracks) {
        while (track.samples.length && track.samples.at(-1).t > songTimeMs) track.samples.pop();
      }
    },
    /** Score every interval whose inputs are complete by this song time. */
    advance(songTimeMs) {
      for (const track of tracks) {
        while (track.next < track.times.length && track.times[track.next] + LATE_MS <= songTimeMs) {
          scoreInterval(track, track.next++);
        }
        // Old samples are no longer needed once intervals well past them are scored.
        const keepFrom = (track.times[track.next] ?? Infinity) - MOTION_MS - 400;
        let drop = 0;
        while (drop < track.samples.length - 2 && track.samples[drop + 1].t < keepFrom) drop++;
        if (drop) track.samples.splice(0, drop);
      }
    },
    finish() {
      for (const track of tracks) while (track.next < track.times.length) scoreInterval(track, track.next++);
    },
    get done() { return tracks.every((t) => t.next >= t.times.length); },
    result(playerId) {
      const t = tracks[playerId];
      const score = Math.round(t.earned * t.value);
      const accuracy = t.possible ? t.earned / t.possible : 0;
      return {
        playerId,
        scorerVersion: SCORER_VERSION,
        score,
        maxScore: MAX_SCORE,
        accuracy,
        // Accuracy so far, for a live readout: the share of points earned of those played.
        runningAccuracy: t.scored ? t.earned / t.scored : 0,
        grade: gradeFor(accuracy),
        judgements: { ...t.judgements },
        combo: t.combo,
        maxCombo: t.maxCombo,
        coverage: t.scored ? t.trackedIntervals / t.scored : 0,
        meanOffsetMs: t.offsetCount ? t.offsetSum / t.offsetCount : 0,
        scoredIntervals: t.scored,
        possibleIntervals: t.possible,
      };
    },
    results() { return tracks.map((t) => scorer.result(t.playerId)); },
    onJudgement(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return scorer;
}
