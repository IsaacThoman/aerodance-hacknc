// Pose features the scorer compares: 2D limb directions in aspect-corrected image space.
// A direction is independent of body size, distance from the camera and where the player
// stands, so neither a calibration step nor a torso scale is needed to compare two people.

// MediaPipe pose-33 indices. Torso uses the shoulder and hip midpoints.
export const LIMBS = [
  { id: 'left-upper-arm', a: 11, b: 13, weight: 1 },
  { id: 'left-forearm', a: 13, b: 15, weight: 1 },
  { id: 'right-upper-arm', a: 12, b: 14, weight: 1 },
  { id: 'right-forearm', a: 14, b: 16, weight: 1 },
  { id: 'left-thigh', a: 23, b: 25, weight: 0.7 },
  { id: 'left-shin', a: 25, b: 27, weight: 0.7 },
  { id: 'right-thigh', a: 24, b: 26, weight: 0.7 },
  { id: 'right-shin', a: 26, b: 28, weight: 0.7 },
  { id: 'torso', a: [11, 12], b: [23, 24], weight: 0.6 },
  { id: 'shoulders', a: 11, b: 12, weight: 0.4 },
];
export const TOTAL_WEIGHT = LIMBS.reduce((n, l) => n + l.weight, 0);

// A live joint below this confidence counts as untracked (the bundles' sampling threshold).
export const MIN_CONFIDENCE = 0.5;

const joints = (end) => (Array.isArray(end) ? end : [end]);
const point = (landmarks, end) => {
  const ids = joints(end);
  let x = 0, y = 0;
  for (const i of ids) { x += landmarks[i].x; y += landmarks[i].y; }
  return { x: x / ids.length, y: y / ids.length };
};

/** Live joints are usable when confident; unknown (null) confidence is trusted. */
export const liveUsable = (landmarks) => landmarks.map((j) => {
  const c = j.visibility === null || j.presence === null ? null : Math.min(j.visibility, j.presence);
  return c === null || c >= MIN_CONFIDENCE;
});

/**
 * Unit direction per limb, or null where either end is unusable or degenerate.
 * aspect: image width / height, so x and y share units.
 */
export function limbDirections(landmarks, aspect, usable) {
  return LIMBS.map((limb) => {
    if (![...joints(limb.a), ...joints(limb.b)].every((i) => usable[i])) return null;
    const a = point(landmarks, limb.a);
    const b = point(landmarks, limb.b);
    const dx = (b.x - a.x) * aspect;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    return len > 1e-4 ? [dx / len, dy / len] : null;
  });
}

/** Blend two direction sets (alpha from a to b); a limb missing on either side stays missing. */
export function lerpDirections(a, b, alpha) {
  return a.map((da, i) => {
    const db = b[i];
    if (!da || !db) return null;
    const x = da[0] + (db[0] - da[0]) * alpha;
    const y = da[1] + (db[1] - da[1]) * alpha;
    const len = Math.hypot(x, y);
    return len > 1e-6 ? [x / len, y / len] : null;
  });
}

export const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
