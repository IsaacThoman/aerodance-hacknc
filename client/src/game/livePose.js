/*
 * Live poses for the players' characters: a calibration taken from a short window of
 * reliable poses and then held, and display smoothing between the camera's samples.
 * Display only: the scorer gets the raw poses (docs/android-game-integration-plan.md,
 * "Live retargeting").
 */

const CORE = [11, 12, 23, 24];
const ANKLES = [27, 28];
const CALIBRATION_MS = 1200;   // reliable poses gathered before the calibration locks
const MIN_SAMPLES = 6;
const RESET_AFTER_MS = 3000;   // a player gone this long is calibrated afresh on return
const HOLD_MS = 600;           // an unreliable joint holds its last good place this long
const SMOOTH_MS = 70;          // display smoothing time constant
const MIN_CONFIDENCE = 0.5;

const confident = (j) => j.visibility === null || j.presence === null || Math.min(j.visibility, j.presence) >= MIN_CONFIDENCE;
const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
const mid = (p, a, b) => ({ x: (p[a].x + p[b].x) / 2, y: (p[a].y + p[b].y) / 2, z: (p[a].z + p[b].z) / 2 });

/** The applier's calibration (packages/character/retarget.js) from a set of live poses. */
export function calibrateLive(frames, input) {
  const aspect = input.width / input.height;
  const torso = frames.map((p) => { const h = mid(p, 23, 24), s = mid(p, 11, 12); return Math.hypot((h.x - s.x) * aspect, h.y - s.y); });
  const hips = frames.map((p) => mid(p, 23, 24));
  const torsoLength = Math.max(0.02, median(torso));
  const hipY = median(hips.map((h) => h.y));
  const withFeet = frames.filter((p) => ANKLES.every((i) => confident(p[i])));
  // Feet out of view (a common living-room framing): stand them where legs usually end.
  const floorY = withFeet.length >= frames.length / 2 ? median(withFeet.map((p) => Math.max(p[27].y, p[28].y))) : hipY + torsoLength * 1.9;
  return {
    inputWidth: input.width, inputHeight: input.height, torsoLength,
    baseHip: { x: median(hips.map((h) => h.x)), y: hipY, z: 0 }, floorY, profileVersion: 1,
  };
}

/**
 * One player's live character input. push() every pose (or null when the player isn't in
 * the record); each frame, frame(now) gives the smoothed pose to draw (null hides it).
 */
export function createLivePlayer() {
  let window = [];
  let calibration = null;
  let input = null;
  let lastSeen = -Infinity;
  let target = null;          // latest landmarks, with unreliable joints held
  let shown = null;           // what's drawn
  let lastFrame = null;
  const held = [];            // per joint: { x, y, z, at } last confident place

  return {
    get calibration() { return calibration; },
    push(landmarks, recordInput, now) {
      if (!landmarks) return;
      if (input && (recordInput.width !== input.width || recordInput.height !== input.height)) { calibration = null; window = []; }
      if (now - lastSeen > RESET_AFTER_MS) { calibration = null; window = []; shown = null; held.length = 0; }
      input = recordInput;
      lastSeen = now;
      if (!calibration && CORE.every((i) => confident(landmarks[i]))) {
        window.push({ at: now, landmarks });
        window = window.filter((f) => now - f.at <= CALIBRATION_MS * 2);
        if (window.length >= MIN_SAMPLES && now - window[0].at >= CALIBRATION_MS) {
          calibration = calibrateLive(window.map((f) => f.landmarks), input);
          window = [];
        }
      }
      target = landmarks.map((j, i) => {
        if (confident(j)) { held[i] = { x: j.x, y: j.y, z: j.z, at: now }; return j; }
        const h = held[i];
        return h && now - h.at <= HOLD_MS ? { ...j, x: h.x, y: h.y, z: h.z } : j;
      });
    },
    /** The pose to draw now, or null when the player is missing or not yet calibrated. */
    frame(now, visible) {
      const dt = lastFrame === null ? 0 : Math.min(now - lastFrame, 100);
      lastFrame = now;
      if (!visible || !target || !calibration) { shown = null; return null; }
      if (!shown) {
        shown = target.map((j) => ({ ...j }));
        return { landmarks: shown };
      }
      const k = 1 - Math.exp(-dt / SMOOTH_MS);
      for (let i = 0; i < shown.length; i++) {
        const s = shown[i], t = target[i];
        s.x += (t.x - s.x) * k;
        s.y += (t.y - s.y) * k;
        s.z += (t.z - s.z) * k;
        s.visibility = t.visibility;
        s.presence = t.presence;
      }
      return { landmarks: shown };
    },
  };
}
