import { finite, validatePoses, qualityFor } from './choreography.js';

// Explicit import only: the tuple's min(visibility, presence) cannot be split back.
export function migrateLegacyMotion(data) {
  if (data?.version !== 1 || !finite(data.duration) || data.duration <= 0 ||
      !Array.isArray(data.times) || data.times.length < 2 ||
      data.times.length !== data.poses?.length ||
      ![data.source?.width, data.source?.height].every(v => Number.isInteger(v) && v > 0)) {
    throw Error('Invalid legacy dance capture');
  }
  const samples = data.times.map((time, i) => {
    if (!finite(time) || time < 0 || time >= data.duration ||
        (i && time <= data.times[i - 1]) || data.poses[i]?.length !== 2) throw Error('Invalid legacy samples');
    const legacyConfidence = [];
    const poses = data.poses[i].map((points, playerId) => {
      if (!Array.isArray(points) || points.length !== 33) throw Error('Invalid legacy landmarks');
      legacyConfidence.push(points.map(j => {
        if (!Array.isArray(j) || j.length !== 4 || !j.every(finite) || j[3] < 0 || j[3] > 1) throw Error('Invalid legacy landmark');
        return j[3];
      }));
      return { playerId, landmarks: points.map(([x,y,z]) => ({ x,y,z,visibility:null,presence:null })) };
    });
    validatePoses(poses);
    return { takeTimeMs: time * 1000, poses, quality: qualityFor(poses), legacyConfidence };
  });
  return {
    schema: 'aerodance.take', schemaVersion: 1, takeId: 'legacy-demo', name: 'Captured dance preview',
    source: 'legacy-demo', input: { width:data.source.width, height:data.source.height, mirrored:false },
    durationMs: data.duration * 1000, offsetMs:0, timeScale:1, samples,
    provenance: { source:data.source, model:data.model ?? null, settings:data.settings ?? null,
      report:data.report ?? null, legacySmoothed:true,
      limitations:'Combined legacy confidence cannot recover visibility/presence; smoothed capture cannot recover original gaps or repairs.' },
  };
}

export function validateMotionTake(data) {
  if (data?.schema !== 'aerodance.take' || data.schemaVersion !== 1 ||
      !finite(data.durationMs) || data.durationMs <= 0 ||
      ![data.input?.width, data.input?.height].every(v => Number.isInteger(v) && v > 0) ||
      data.input.mirrored !== false || !Array.isArray(data.samples) || data.samples.length < 2) throw Error('Invalid dance capture');
  let last = -Infinity;
  for (const sample of data.samples) {
    if (!finite(sample.takeTimeMs) || sample.takeTimeMs < 0 || sample.takeTimeMs >= data.durationMs || sample.takeTimeMs <= last) throw Error('Invalid dance times');
    last = sample.takeTimeMs;
    validatePoses(sample.poses);
  }
  return data;
}
