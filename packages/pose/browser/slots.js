import { validatePoses } from '../choreography.js';

// Regions, not identities: unreliable/competing detections never fill another slot.
export function assignPlayerSlots(detections, playerCount, deadBand = 0.025) {
  const candidates = [[], []];
  for (const points of detections) {
    const landmarks = points.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? null, presence: p.presence ?? null }));
    try { validatePoses([{ playerId: 0, landmarks }]); } catch { continue; }
    const torso = [11, 12, 23, 24].map(i => landmarks[i]);
    if (torso.some(p => p.visibility === null || p.presence === null || Math.min(p.visibility, p.presence) < 0.5)) continue;
    const x = (landmarks[23].x + landmarks[24].x) / 2;
    if (playerCount === 2 && Math.abs(x - 0.5) <= deadBand) continue;
    candidates[playerCount === 1 ? 0 : x < 0.5 ? 0 : 1].push(landmarks);
  }
  return candidates.flatMap((poses, playerId) => poses.length === 1 ? [{ playerId, landmarks: poses[0] }] : []);
}

export class PlayerSlotMapper {
  constructor() { this.streaks = [0, 0]; }
  map(detections, playerCount) {
    const poses = assignPlayerSlots(detections, playerCount);
    for (let id = 0; id < 2; id++) this.streaks[id] = poses.some(p => p.playerId === id) ? Math.min(2, this.streaks[id] + 1) : 0;
    // Require consecutive evidence when acquiring a two-player region. Loss is immediate.
    return poses.filter(p => playerCount === 1 || this.streaks[p.playerId] >= 2);
  }
}
