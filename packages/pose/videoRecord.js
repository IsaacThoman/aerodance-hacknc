import { validatePoses } from './choreography.js';
import { poseModel } from './browser/models.js';

// File timestamps are independent of browser receipt time and the audio clock.
export function validateVideoRecord(record) {
  if (record?.schema !== 'aerodance.video-record' || record.schemaVersion !== 1 || record.type !== 'pose' ||
      typeof record.sessionId !== 'string' || !record.sessionId.trim() ||
      !Number.isSafeInteger(record.seq) || record.seq < 1 || record.playerCount !== 2 ||
      !Number.isSafeInteger(record.input?.width) || record.input.width < 1 ||
      !Number.isSafeInteger(record.input?.height) || record.input.height < 1 || record.input.mirrored !== false ||
      !Number.isFinite(record.mediaTimeMs) || record.mediaTimeMs < 0 || record.mediaTimeMs > 3600000 ||
      !['decoded-frame', 'seek-time'].includes(record.timingMethod)) throw Error('Invalid video capture record');
  poseModel(record.modelId);
  validatePoses(record.poses);
  return record;
}
