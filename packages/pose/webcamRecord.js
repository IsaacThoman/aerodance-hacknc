// Server-safe webcam capture validation. These records are not Android wire records.
import { validatePoses } from './choreography.js';
import { poseModel } from './browser/models.js';
export function validateWebcamRecord(record) {
  if (record?.schema !== 'aerodance.webcam-record' || record.schemaVersion !== 1 || record.type !== 'pose' ||
      typeof record.sessionId !== 'string' || !record.sessionId.trim() ||
      !Number.isSafeInteger(record.seq) || record.seq < 1 || ![1, 2].includes(record.playerCount) ||
      !Number.isSafeInteger(record.input?.width) || record.input.width < 1 ||
      !Number.isSafeInteger(record.input?.height) || record.input.height < 1 || record.input.mirrored !== false ||
      ![record.frameBrowserTimeMs, record.resultBrowserTimeMs, record.mediaTimeMs].every(n => Number.isFinite(n) && n >= 0) ||
      record.resultBrowserTimeMs < record.frameBrowserTimeMs || record.timingMethod !== 'browser-frame-observation') {
    throw Error('Invalid webcam capture record');
  }
  poseModel(record.modelId);
  validatePoses(record.poses);
  if (record.poses.some(pose => pose.playerId >= record.playerCount)) throw Error('Invalid webcam player ID');
  return record;
}
