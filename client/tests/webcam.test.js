import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebcamPoseSource } from '../../packages/pose/browser/WebcamPoseSource.js';
import { assignPlayerSlots, PlayerSlotMapper } from '../../packages/pose/browser/slots.js';
import { validateWebcamRecord } from '../../packages/pose/webcamRecord.js';

const points = x => Array.from({ length: 33 }, () => ({ x, y: 0.5, z: 0, visibility: 0.95, presence: 0.95 }));
test('two-player slots require consecutive evidence and clear immediately on ambiguity', () => {
  const slots = new PlayerSlotMapper();
  assert.deepEqual(slots.map([points(0.25)], 2), []);
  assert.deepEqual(slots.map([points(0.25)], 2).map(p => p.playerId), [0]);
  assert.deepEqual(slots.map([points(0.25), points(0.3)], 2), []);
  assert.deepEqual(slots.map([points(0.25)], 2), []);
  assert.deepEqual(slots.map([points(0.75)], 2), []);
  assert.deepEqual(slots.map([points(0.75)], 2).map(p => p.playerId), [1]);
});
test('webcam slots use camera regions, preserve missing dancers and reject ambiguity', () => {
  assert.deepEqual(assignPlayerSlots([points(0.75), points(0.25)], 2).map(p => [p.playerId, p.landmarks[0].x]), [[0, 0.25], [1, 0.75]]);
  assert.deepEqual(assignPlayerSlots([points(0.75)], 2).map(p => p.playerId), [1]);
  assert.deepEqual(assignPlayerSlots([points(0.5)], 2), []);
  assert.deepEqual(assignPlayerSlots([points(0.2), points(0.3)], 2), []);
  assert.deepEqual(assignPlayerSlots([points(0.75)], 1).map(p => p.playerId), [0]);
  const unreliable = points(0.2); unreliable[23].visibility = 0.1;
  assert.deepEqual(assignPlayerSlots([unreliable], 2), []);
  const invalid = points(0.2); invalid[1].x = NaN;
  assert.deepEqual(assignPlayerSlots([invalid], 2), []);
});

function fixture(t) {
  let time = 0, callback, stopped = 0, terminated = 0;
  const messages = [];
  const track = { stop() { stopped++; }, addEventListener() {}, getSettings: () => ({ deviceId: 'camera' }) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { videoWidth: 640, videoHeight: 480, play: async () => {}, pause() {}, remove() {},
    requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() { callback = null; } };
  const worker = { postMessage: data => messages.push(data), terminate() { terminated++; } };
  const source = new WebcamPoseSource({ now: () => time,
    mediaDevices: { getUserMedia: async () => stream, enumerateDevices: async () => [] },
    createVideo: () => video, createWorker: () => worker,
    bitmap: async () => ({ close() {} }), assetUrl: () => 'https://test.invalid/pose-assets/' });
  t.after(() => source.disconnect());
  return { source, worker, stream, track, messages,
    setTime(value) { time = value; }, get stopped() { return stopped; }, get terminated() { return terminated; },
    async frame(mediaTime, now = mediaTime * 1000) { time = now; callback(now, { mediaTime }); await Promise.resolve(); },
    deliver(data) { worker.onmessage({ data: { sessionId: source.sessionId, ...data } }); } };
}
test('webcam backpressure, empty detections, freshness and cleanup', async t => {
  const f = fixture(t); const records = [];
  f.source.subscribeRecords(e => { if (e.record) records.push(e.record); });
  await f.source.connect(); f.deliver({ type: 'ready', delegate: 'CPU' });
  await f.frame(1); await f.frame(1.03); await f.frame(1.03);
  assert.equal(f.messages.filter(m => m.type === 'frame').length, 1, 'one frame in flight, duplicate callbacks ignored');
  f.setTime(1050); f.deliver({ type: 'result', seq: 1, landmarks: [], inferenceMs: 30 });
  assert.equal(f.source.view.status, 'connected', 'empty result makes pipeline ready');
  assert.deepEqual(f.source.view.snapshot.poses, []);
  assert.equal(records.length, 1); validateWebcamRecord(records[0]);
  await f.frame(2); f.setTime(2600); f.deliver({ type: 'result', seq: 2, landmarks: [points(0.25)], inferenceMs: 600 });
  assert.equal(f.source.view.snapshot, null); assert.equal(records.length, 1, 'expired results cannot revive tracking');
  const oldHandler = f.worker.onmessage;
  f.source.disconnect();
  oldHandler({ data: { type: 'result', sessionId: f.source.sessionId, seq: 2, landmarks: [points(0.25)] } });
  assert.equal(f.source.view.status, 'disconnected');
  assert.equal(f.stopped, 1); assert.equal(f.terminated, 1);
});
test('a permission grant after cancellation releases its camera without starting a worker', async t => {
  const f = fixture(t); let grant;
  f.source.mediaDevices.getUserMedia = () => new Promise(resolve => { grant = resolve; });
  const starting = f.source.connect();
  f.source.disconnect(); grant(f.stream); await starting;
  assert.equal(f.stopped, 1); assert.equal(f.messages.length, 0);
  assert.equal(f.source.view.status, 'disconnected');
});
test('changing a running model resets the session and records the explicit selection', async t => {
  const f = fixture(t);
  await f.source.connect(); const firstSession = f.source.sessionId;
  await f.source.configure({ modelId: 'full' });
  assert.notEqual(f.source.sessionId, firstSession);
  assert.equal(f.source.view.model, 'full');
  assert.equal(f.source.view.snapshot, null);
  assert.equal(f.messages.filter(m => m.type === 'initialize').at(-1).modelUrl, 'https://test.invalid/pose-assets/pose_landmarker_full.task');
  assert.equal(f.stopped, 1);
});
