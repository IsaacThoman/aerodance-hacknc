import { createPoseApplier, calibratePoses } from '../../../../packages/character/retarget.js';
import { migrateLegacyMotion, validateMotionTake } from '../../../../packages/pose/legacy.js';
import { sampleSnapshot } from '../../../../packages/pose/choreography.js';

// Compatibility import while older local captures are migrated. Playback is object-only.
export function validateMotion(data) {
  return validateMotionTake(data?.version === 1 ? migrateLegacyMotion(data) : data);
}

// Looping and seam blending belong only to the silent menu/demo preview.
// Runtime songs use the finite shared sampler directly.
export function samplePose(data, person, seconds) {
  const time = ((seconds * 1000 % data.durationMs) + data.durationMs) % data.durationMs;
  const last = data.samples.at(-1).takeTimeMs;
  const snapshot = sampleSnapshot(data.samples, Math.min(time, last), 'takeTimeMs', 200);
  const pose = snapshot.poses.find(p => p.playerId === person);
  if (!pose) return null;
  const seam = Math.min(350, data.durationMs / 4);
  const blend = Math.max(0, Math.min(1, (time - (data.durationMs - seam)) / seam));
  const smooth = blend * blend * (3 - 2 * blend);
  const first = data.samples[0].poses.find(p => p.playerId === person);
  if (first) pose.landmarks.forEach((joint, i) => {
    for (const axis of ['x','y','z']) joint[axis] += (first.landmarks[i][axis] - joint[axis]) * smooth;
  });
  return pose;
}

export function createRetargeter(model, data, person) {
  const apply = createPoseApplier(model, calibratePoses(
    data.samples.flatMap(s => s.poses.filter(p => p.playerId === person)), data.input,
  ));
  return seconds => apply(samplePose(data, person, seconds));
}
