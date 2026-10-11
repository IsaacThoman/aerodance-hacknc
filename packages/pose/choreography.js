// Android-shaped pose payloads; file clocks are explicitly separate from wire clocks.
export const JOINT_NAMES = ['Nose','Left eye inner','Left eye','Left eye outer','Right eye inner','Right eye','Right eye outer','Left ear','Right ear','Mouth left','Mouth right','Left shoulder','Right shoulder','Left elbow','Right elbow','Left wrist','Right wrist','Left pinky','Right pinky','Left index','Right index','Left thumb','Right thumb','Left hip','Right hip','Left knee','Right knee','Left ankle','Right ankle','Left heel','Right heel','Left foot index','Right foot index'];
export const CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32],[15,17],[15,19],[16,18],[16,20],[0,7],[0,8]];
export const PAIRS = [[1,4],[2,5],[3,6],[7,8],[9,10],[11,12],[13,14],[15,16],[17,18],[19,20],[21,22],[23,24],[25,26],[27,28],[29,30],[31,32]];
export const copy = value => structuredClone(value);
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const fail = message => { throw Error(message); };
export function validatePoses(poses) {
  if (!Array.isArray(poses) || poses.length > 2) fail('Expected at most two poses');
  let last = -1;
  for (const pose of poses) {
    if (![0,1].includes(pose.playerId) || pose.playerId <= last) fail('Pose IDs must be unique and ascending');
    last = pose.playerId;
    if (pose.landmarks?.length !== 33) fail('A pose needs all 33 landmarks');
    for (const joint of pose.landmarks) {
      if (!['x','y','z'].every(k => finite(joint[k]))) fail('Landmark coordinates must be finite');
      for (const k of ['visibility','presence']) if (!(joint[k] === null || finite(joint[k]) && joint[k] >= 0 && joint[k] <= 1)) fail('Confidence must be null or between 0 and 1');
    }
  }
  return poses;
}
export const confidence = p => p.visibility === null || p.presence === null ? null : Math.min(p.visibility, p.presence);
export function qualityFor(poses, origin = 'measured') {
  return poses.map(p => ({ playerId: p.playerId, landmarkOrigins: p.landmarks.map(j => confidence(j) === null ? 'missing-confidence' : origin), scoreEligible: p.landmarks.map(j => origin === 'measured' && confidence(j) >= .5 && confidence(j) !== null), reviewed: false }));
}
export function sampleSnapshot(samples, timeMs, timeKey = 'songTimeMs', maxGap = 200) {
  if (!samples.length || timeMs < samples[0][timeKey]-1e-5 || timeMs > samples.at(-1)[timeKey]+1e-5) return { poses: [], quality: [] };
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (samples[mid][timeKey] <= timeMs) lo = mid; else hi = mid - 1; }
  const a = samples[lo], b = samples[lo + 1];
  if (Math.abs(a[timeKey]-timeMs)<1e-5) return copy({ poses: a.poses, quality: a.quality || qualityFor(a.poses) });
  if (b&&Math.abs(b[timeKey]-timeMs)<1e-5) return copy({ poses: b.poses, quality: b.quality || qualityFor(b.poses) });
  if (!b || b[timeKey] - a[timeKey] > maxGap) return { poses: [], quality: [] };
  const alpha = (timeMs - a[timeKey]) / (b[timeKey] - a[timeKey]);
  const poses = [], quality = [];
  for (const pose of a.poses) {
    const next = b.poses.find(p => p.playerId === pose.playerId);
    if (!next) continue; // Absence is never interpolated across.
    const qa = (a.quality || qualityFor(a.poses)).find(q => q.playerId === pose.playerId);
    const qb = (b.quality || qualityFor(b.poses)).find(q => q.playerId === pose.playerId);
    poses.push({ playerId: pose.playerId, landmarks: pose.landmarks.map((p,i) => Object.fromEntries(['x','y','z','visibility','presence'].map(k => [k, p[k] === null || next.landmarks[i][k] === null ? null : p[k] + (next.landmarks[i][k]-p[k])*alpha]))) });
    quality.push({ playerId: pose.playerId, landmarkOrigins: qa.landmarkOrigins.map((origin,i) => ['edited','gap-repaired','missing-confidence'].includes(origin) ? origin : ['edited','gap-repaired','missing-confidence'].includes(qb.landmarkOrigins[i]) ? qb.landmarkOrigins[i] : 'resampled'), scoreEligible: qa.scoreEligible.map((v,i) => v && qb.scoreEligible[i]), reviewed: qa.reviewed && qb.reviewed });
  }
  return { poses, quality };
}
export function mirrorPose(pose) {
  const result = copy(pose);
  result.landmarks.forEach(p => { p.x = 1-p.x; });
  for (const [a,b] of PAIRS) [result.landmarks[a],result.landmarks[b]] = [result.landmarks[b],result.landmarks[a]];
  return result;
}
export function validateChoreography(data) {
  if (data.schema !== 'aerodance.choreography' || data.schemaVersion !== 1) fail('Unsupported choreography schema');
  if (!finite(data.durationMs) || data.durationMs <= 0 || !finite(data.playableStartMs) || !finite(data.playableEndMs) || data.playableStartMs < 0 || data.playableStartMs >= data.playableEndMs || data.playableEndMs > data.durationMs) fail('Invalid song bounds');
  if (data.coordinates?.kind !== 'mediapipe-image' || data.coordinates.mirrored !== false || data.coordinates.landmarkCount !== 33) fail('Unsupported coordinate convention');
  if (!Array.isArray(data.tracks) || data.tracks.length !== 2 || data.tracks[0].playerId !== 0 || data.tracks[1].playerId !== 1) fail('Both tracks are required');
  for (const track of data.tracks) {
    const c = track.calibration;
    if (!c || !['inputWidth','inputHeight','torsoLength'].every(k => finite(c[k]) && c[k] > 0) || !finite(c.floorY) || !c.baseHip || !['x','y','z'].every(k => finite(c.baseHip[k]))) fail('Invalid track calibration');
  }
  if (!Array.isArray(data.samples) || data.samples.length < 2) fail('Choreography needs at least two samples');
  let last = -Infinity;
  for (const sample of data.samples) {
    if (!finite(sample.songTimeMs) || sample.songTimeMs <= last || sample.songTimeMs < data.playableStartMs || sample.songTimeMs > data.playableEndMs) fail('Invalid sample times');
    last = sample.songTimeMs;
    validatePoses(sample.poses);
    if (sample.quality?.length !== sample.poses.length) fail('Missing pose quality');
    sample.poses.forEach((p,i) => {
      const q = sample.quality[i];
      if (q.playerId !== p.playerId || q.landmarkOrigins?.length !== 33 || q.scoreEligible?.length !== 33 || typeof q.reviewed !== 'boolean' || q.scoreEligible.some(v => typeof v !== 'boolean') || q.landmarkOrigins.some(v => !['measured','resampled','edited','gap-repaired','missing-confidence'].includes(v))) fail('Invalid quality masks');
    });
  }
  if (data.samples[0].songTimeMs !== data.playableStartMs || data.samples.at(-1).songTimeMs !== data.playableEndMs) fail('Missing endpoint anchors');
  return data;
}
