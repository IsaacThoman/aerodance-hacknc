// Promoted from the Android pose test page; preserve its bounded decoder and wire validation.
export const MAX_BYTES = 16 * 1024;
const states = ['starting', 'running', 'error', 'stopping'];
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const score = n => n === null || (Number.isFinite(n) && n >= 0 && n <= 1);
export function validate(record) {
  if (!record || record.protocolVersion !== 2 || typeof record.sessionId !== 'string' || !record.sessionId.trim()) throw Error('Invalid protocol/session');
  if (record.type === 'heartbeat') {
    if (!integer(record.producerTimeMs) || !(record.lastPoseSeq === null || integer(record.lastPoseSeq, 1)) || !states.includes(record.pipelineState)) throw Error('Invalid heartbeat');
  } else if (record.type === 'pose') {
    if (!integer(record.seq, 1) || !integer(record.frameReceivedTimeMs) || !integer(record.resultTimeMs) || record.resultTimeMs < record.frameReceivedTimeMs ||
        !integer(record.input?.width, 1) || !integer(record.input?.height, 1) || typeof record.input?.mirrored !== 'boolean' || !Array.isArray(record.poses) || ![1,2].includes(record.playerCount) || record.poses.length > record.playerCount) throw Error('Invalid pose');
    let lastId = -1;
    for (const pose of record.poses) {
      if (!integer(pose.playerId) || pose.playerId >= record.playerCount || pose.playerId <= lastId) throw Error('Invalid player ID/order');
      lastId = pose.playerId;
      if (!Array.isArray(pose.landmarks) || pose.landmarks.length !== 33) throw Error('Expected 33 landmarks');
      for (const p of pose.landmarks) if (!p || ![p.x, p.y, p.z].every(Number.isFinite) || !score(p.visibility) || !score(p.presence)) throw Error('Invalid landmark');
    }
  } else throw Error('Unknown record type');
  return record;
}

/** Byte-based limit, including incomplete UTF-8; network chunks can split anywhere. */
export class NdjsonDecoder {
  constructor(onRecord) { this.onRecord = onRecord; this.buffer = new Uint8Array(MAX_BYTES); this.length = 0; this.decoder = new TextDecoder('utf-8', {fatal: true}); }
  push(chunk) {
    let start = 0;
    for (let end = 0; end <= chunk.length; end++) {
      if (end < chunk.length && chunk[end] !== 10) continue;
      const part = chunk.subarray(start, end);
      if (this.length + part.length > MAX_BYTES) throw Error('Record exceeds 16 KiB');
      this.buffer.set(part, this.length); this.length += part.length;
      if (end < chunk.length) {
        const value = validate(JSON.parse(this.decoder.decode(this.buffer.subarray(0, this.length))));
        this.length = 0; this.onRecord(value);
      }
      start = end + 1;
    }
  }
  finish() { if (this.length) throw Error('Incomplete final record'); }
}

/** New connection creates a fresh state. A heartbeat keeps transport alive, never the pose. */
export class PoseState {
  constructor(staleMs = 500) { this.staleMs = staleMs; this.session = null; this.seq = 0; this.pose = null; this.received = null; this.lastRecord = null; }
  accept(record, now) {
    this.lastRecord = now;
    if (record.sessionId !== this.session) {
      this.session = record.sessionId; this.seq = 0; this.pose = null; this.received = null;
    }
    if (record.type !== 'pose' || record.seq <= this.seq) return false;
    this.seq = record.seq; this.received = now; this.pose = record;
    return true;
  }
  current(now) { return this.received !== null && now - this.received < this.staleMs ? this.pose : null; }
}

export function deviceEndpoint(ip) {
  const pieces = ip.trim().split('.');
  if (pieces.length !== 4 || pieces.some(p => !/^(0|[1-9]\d{0,2})$/.test(p) || +p > 255)) throw Error('Enter an IPv4 address, such as 192.168.43.1');
  return `http://${pieces.join('.')}:1337`;
}
