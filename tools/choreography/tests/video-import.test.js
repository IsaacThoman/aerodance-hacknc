import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VideoImporter, sampleTimes, seekVideoFrame, videoCalibrationPreview, videoRegionCrop, restoreVideoLandmarks } from '../web/videoImport.js';
import { createStudio } from '../server/index.js';
import { readZip } from '../server/zip.js';
import { MEDIAPIPE_VERSION, poseModel } from '../../../packages/pose/browser/models.js';
import { newProject, addTake, takeFromRecords, takeCalibration, overwriteTracks, appendOperation,
  offsetTrack, historyStep, compileProject, validateTake, validateTrackData, trackDataIds } from '../core.js';

const pose = (playerId, hipY = .6) => ({ playerId, landmarks: Array.from({ length: 33 }, (_, i) => ({
  x: playerId ? .25 : .75, y: i < 11 ? .15 : i < 23 ? .4 : i < 27 ? hipY : .9,
  z: 0, visibility: .95, presence: .95,
})) });
function fixture() {
  const model = poseModel('full');
  const metadata = { sourceKind: 'video', takeId: 'video-take', name: 'dance.webm',
    createdAt: new Date().toISOString(), calibrationFrame: { mediaTimeMs: 400, poses: [pose(0), pose(1)] },
    status: { modelId: model.id, modelHash: model.sha256, packageVersion: MEDIAPIPE_VERSION, delegate: 'CPU', durationMs: 1000, filename: 'dance.webm' } };
  const records = Array.from({ length: 11 }, (_, i) => ({ ordinal: i, record: {
    schema: 'aerodance.video-record', schemaVersion: 1, type: 'pose', sessionId: 'file', seq: i + 1,
    playerCount: 2, input: { width: 640, height: 480, mirrored: false }, modelId: model.id,
    mediaTimeMs: i * 100, timingMethod: 'decoded-frame', poses: i === 3 ? [] : [pose(0, .8), pose(1, .8)],
  } }));
  return { metadata, records, take: takeFromRecords(records, metadata) };
}

test('calibration preview keeps the left dancer visible when calibration confidence is insufficient', () => {
  const left = pose(0), right = pose(1);
  left.landmarks[27].visibility = .1;
  let preview = videoCalibrationPreview([left.landmarks, right.landmarks]);
  assert.deepEqual(preview.poses.map(p => p.playerId), [1]);
  assert.deepEqual(preview.detectedPoses.map(p => [p.playerId, p.ready]), [[0, false], [1, true]]);
  assert.match(preview.detectedPoses[0].reason, /shoulders, hips and feet/);
  left.landmarks[11].visibility = .1;
  preview = videoCalibrationPreview([left.landmarks, right.landmarks]);
  assert.equal(preview.detectedPoses[0].playerId, 0, 'low torso confidence must not hide P1');
  assert.equal(preview.detectedPoses[0].ready, false);
  left.landmarks[27].visibility = .95; left.landmarks[11].visibility = .95;
  preview = videoCalibrationPreview([left.landmarks, right.landmarks]);
  assert.deepEqual(preview.detectedPoses.map(p => p.ready), [true, true]);
  assert.deepEqual(preview.poses.map(p => p.playerId), [0, 1]);
});

test('region recovery focuses on small dancers and restores full-frame XYZ coordinates', () => {
  const dancer = pose(1).landmarks.map(p => ({ ...p, y: .45 + p.y * .2 }));
  const crop = videoRegionCrop([dancer], 1, 481, 854);
  assert.equal(crop.x, 0); assert.equal(crop.width, 240);
  assert.ok(crop.y > 0 && crop.height < 400, 'portrait height must be cropped to enlarge the dancer');
  const restored = restoreVideoLandmarks([{ x: .8, y: .6, z: -.2, visibility: .9, presence: .9 }], crop, 481, 854)[0];
  assert.equal(restored.x, .8 * crop.width / 481);
  assert.equal(restored.y, (crop.y + .6 * crop.height) / 854);
  assert.equal(restored.z, -.2 * crop.width / 481);
  assert.equal(restored.visibility, .9);
  const second = videoRegionCrop([dancer], 0, 481, 854);
  assert.equal(second.x, 240); assert.equal(second.width, 241);
});

test('missing P1 is recovered without changing P2, file timing or primary video tracking', async () => {
  const diagnostics = { active: 0, maxActive: 0, terminated: 0, modes: [] }, calls = [];
  class MissingLeftWorker extends PoseWorker {
    constructor() {
      super(diagnostics);
      this.addEventListener('message', ({ data }) => {
        if (data.type !== 'result') return;
        if (this.frame.regionId === undefined) data.landmarks = [pose(1).landmarks];
        else {
          const crop = this.frame.bitmap.crop;
          data.landmarks = [pose(0).landmarks.map(p => ({ ...p, x: (p.x * 640 - crop.x) / crop.width,
            y: (p.y * 480 - crop.y) / crop.height, z: p.z * 640 / crop.width }))];
        }
      });
    }
    postMessage(data) { this.frame = data; super.postMessage(data); }
  }
  const job = new VideoImporter({ video: { videoWidth: 640, videoHeight: 480, currentTime: 0, duration: .1, pause() {} },
    modelId: 'lite', projectId: 'project', createWorker: () => new MissingLeftWorker(), assetUrl: () => 'http://localhost/',
    bitmap: async (_video, x, y, width, height) => ({ crop: { x, y, width, height }, close() {} }),
    seek: async (_video, time) => ({ mediaTimeMs: time * 1000, timingMethod: 'decoded-frame' }),
    request: async (url, options) => { calls.push({ url, body: structuredClone(options.body) }); return { takeId: 'capture' }; },
  });
  const calibration = await job.calibrate();
  assert.deepEqual(calibration.poses.map(p => p.playerId), [0, 1]);
  assert.deepEqual(calibration.poses[1], pose(1));
  await job.process('duet.webm');
  const records = calls.find(c => c.url.endsWith('/batches')).body.records;
  assert.deepEqual(records.at(-1).record.poses.map(p => p.playerId), [0, 1]);
  assert.deepEqual(records.at(-1).record.poses[1], pose(1));
  assert.deepEqual(records.map(e => e.record.mediaTimeMs), [...sampleTimes(100)].map(t => t * 1000));
  assert.deepEqual(diagnostics.modes, ['IMAGE', 'IMAGE', 'VIDEO', 'IMAGE']);
  assert.equal(diagnostics.terminated, 4);
  assert.equal(diagnostics.maxActive, 1);
});

test('video takes use file timestamps, preserve absences and validate calibration and model provenance', () => {
  const { take, records, metadata } = fixture();
  assert.equal(take.source, 'video'); assert.equal(take.offsetMs, 0); assert.equal(take.timeScale, 1);
  assert.deepEqual(take.samples.map(s => s.takeTimeMs), records.map(e => e.record.mediaTimeMs));
  assert.deepEqual(take.samples[3].poses, []);
  assert.equal(take.provenance.modelHash, poseModel('full').sha256);
  assert.equal(take.provenance.calibrationFrameTimeMs, 400);
  assert.equal(takeCalibration(take, 0).torsoLength, .6 - .4);
  const missing = structuredClone(take); missing.calibrationFrame.poses.pop();
  assert.throws(() => validateTake(missing), /every captured dancer/);
  const weak = structuredClone(take); weak.calibrationFrame.poses[0].landmarks[27].visibility = .1;
  assert.throws(() => validateTake(weak), /shoulders, hips and feet/);
  const late = structuredClone(take); late.calibrationFrame.mediaTimeMs = 1001;
  assert.throws(() => validateTake(late), /calibration frame time/);
  const changed = structuredClone(records); changed[1].record.modelId = 'lite';
  assert.throws(() => takeFromRecords(changed, metadata), /changed/);
  const reversed = structuredClone(records); reversed[1].record.mediaTimeMs = 0;
  assert.throws(() => takeFromRecords(reversed, metadata), /sequence or timing/);
  const noCalibration = structuredClone(take); delete noCalibration.calibrationFrame;
  assert.throws(() => validateTake(noCalibration), /require a calibration frame/);
});

test('explicit calibration survives independent snapshots, edits, offsets, undo and removing the library take', () => {
  const { take } = fixture(), assets = new Map([[take.takeId, take]]);
  let p = addTake(newProject('video-project'), take);
  assert.ok(p.tracks.every(t => t.dataId === null), 'import only adds a library take');
  p = overwriteTracks(p, take, [0, 1], assets);
  const expected = takeCalibration(take, 0);
  p = appendOperation(p, { type: 'mirror', playerId: 0, startMs: 0, endMs: 1000 }, assets);
  p = offsetTrack(p, 0, -100);
  assert.deepEqual(compileProject(p, assets).tracks[0].calibration, expected);
  const bad = structuredClone(assets.get(p.tracks[0].dataId)); bad.calibration.torsoLength = NaN;
  assert.throws(() => validateTrackData(bad), /Invalid track calibration/);
  p = historyStep(p, -1); p = historyStep(p, 1);
  p.takes = []; assets.delete(take.takeId);
  assert.deepEqual(compileProject(p, assets).tracks[0].calibration, expected);
});

class PoseWorker extends EventTarget {
  constructor(diagnostics) { super(); this.diagnostics = diagnostics; }
  postMessage(data) {
    if (data.type === 'initialize') {
      this.diagnostics.modes.push(data.runningMode);
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready', sessionId: data.sessionId, delegate: 'CPU' } })));
    } else {
      this.diagnostics.active++; this.diagnostics.maxActive = Math.max(this.diagnostics.maxActive, this.diagnostics.active);
      const seq = data.seq;
      setTimeout(() => {
        this.diagnostics.active--;
        this.dispatchEvent(new MessageEvent('message', { data: { type: 'result', sessionId: this.sessionId,
          seq, landmarks: [pose(0).landmarks, pose(1).landmarks] } }));
      }, seq % 2 ? 8 : 1);
    }
    this.sessionId = data.sessionId || this.sessionId;
  }
  terminate() { this.diagnostics.terminated++; }
}
test('video processing awaits inference, skips duplicate decoded frames and retries bounded uploads', async () => {
  const calls = [], diagnostics = { active: 0, maxActive: 0, terminated: 0, modes: [] };
  let failed = false;
  const video = { duration: .5, videoWidth: 640, videoHeight: 480, currentTime: .2, pause() {} };
  const job = new VideoImporter({ video, modelId: 'lite', projectId: 'project',
    assetUrl: () => 'http://localhost/pose-assets/', bitmap: async () => ({ close() {} }),
    createWorker: () => new PoseWorker(diagnostics),
    seek: async (_v, time) => ({ mediaTimeMs: Math.floor((time + 1e-8) * 10) * 100, timingMethod: 'decoded-frame' }),
    request: async (url, options) => {
      calls.push({ url, body: structuredClone(options.body) });
      if (url.endsWith('/batches') && !failed) { failed = true; throw Error('temporary upload failure'); }
      return { takeId: 'capture' };
    },
  });
  const calibration = await job.calibrate();
  await job.process('fixture.webm');
  assert.equal(diagnostics.maxActive, 1); assert.deepEqual(diagnostics.modes, ['IMAGE', 'VIDEO']);
  const batches = calls.filter(c => c.url.endsWith('/batches'));
  assert.equal(batches.length, 2); assert.deepEqual(batches[0].body, batches[1].body);
  assert.deepEqual(batches[1].body.records.map(e => e.record.mediaTimeMs), [0, 100, 200, 300, 400]);
  assert.deepEqual(batches[1].body.records[0].record.poses, [], 'two-player acquisition needs consecutive evidence');
  await assert.rejects(job.finalize({ ...calibration, poses: [calibration.poses[0]] }), /P2/);
  await job.finalize(calibration);
  assert.deepEqual(calls.at(-1).body.calibrationFrame, calibration);
  assert.equal(diagnostics.terminated, 2);
});

test('cancelling inference releases the worker and does not finalize a partial take', async () => {
  const diagnostics = { active: 0, maxActive: 0, terminated: 0, modes: [] }, calls = [];
  const job = new VideoImporter({ video: { duration: .5, videoWidth: 640, videoHeight: 480, pause() {} },
    modelId: 'lite', projectId: 'project', assetUrl: () => 'http://localhost/', bitmap: async () => ({ close() {} }),
    seek: async (_video, time) => ({ mediaTimeMs: time * 1000, timingMethod: 'seek-time' }),
    createWorker: () => new PoseWorker(diagnostics),
    request: async url => { calls.push(url); return { takeId: 'cancelled' }; },
  });
  const processing = job.process('fixture.webm');
  setTimeout(() => job.abort(), 3);
  await assert.rejects(processing, { name: 'AbortError' });
  assert.equal(job.processed, undefined);
  assert.equal(calls.some(url => url.endsWith('/finalize')), false);
  assert.ok(diagnostics.terminated > 0);
});

test('samples are taken mid-window so rounded container timestamps are not skipped', () => {
  const times = [...sampleTimes(200)];
  assert.equal(times.length, 6);
  assert.ok(Math.abs(times[2] - 2.5 / 30) < 1e-12);
  // A 30 fps WebM stores frame 2 at 67 ms; sampling at 66.7 ms would select frame 1.
  assert.ok(times[2] > .067);
});

test('decoded frames are processed in order, prefetched during inference and released', async () => {
  const diagnostics = { active: 0, maxActive: 0, terminated: 0, modes: [] }, calls = [], bitmaps = [];
  const state = { pulled: 0, returned: false, options: null };
  const video = { duration: .3, videoWidth: 640, videoHeight: 480, pause() {} };
  const file = { name: 'decoded.webm' };
  // 33 ms appears twice: a source frame shown across two sample windows.
  // 310 ms is a final frame stamped past the reported duration.
  const order = [0, 33, 33, 67, 100, 133, 167, 200, 233, 267, 310];
  const job = new VideoImporter({ video, file, modelId: 'lite', projectId: 'project', assetUrl: () => 'http://localhost/',
    createWorker: () => new PoseWorker(diagnostics),
    bitmap: async source => { bitmaps.push({ source, pulled: state.pulled }); return { close() {} }; },
    seek: async () => { throw Error('decoded frames must not seek'); },
    decodeFrames: async (source, options) => {
      assert.equal(source, file); state.options = options;
      return (async function* () {
        try {
          for (const ms of order) {
            state.pulled++; yield { source: { ms }, mediaTimeMs: ms, timingMethod: 'decoded-frame', method: 'WebCodecs' };
          }
        } finally { state.returned = true; }
      })();
    },
    request: async (url, options) => { calls.push({ url, body: structuredClone(options.body) }); return { takeId: 'decoded' }; },
  });
  await job.process('decoded.webm');
  assert.deepEqual(state.options, { width: 640, height: 480, durationMs: 300, rate: 30 });
  const records = calls.filter(c => c.url.endsWith('/batches')).flatMap(c => c.body.records.map(e => e.record));
  assert.deepEqual(records.map(r => r.mediaTimeMs), [0, 33, 67, 100, 133, 167, 200, 233, 267]);
  assert.ok(records.every(r => r.timingMethod === 'decoded-frame'));
  // The following frame is already decoding when each frame's pixels are read.
  assert.deepEqual(bitmaps.slice(0, -1).map(b => b.pulled), records.slice(0, -1).map(r => order.indexOf(r.mediaTimeMs) + 2));
  assert.equal(diagnostics.maxActive, 1);
  assert.equal(state.returned, true);
});

test('cancelling decoded processing releases the decoder and does not finalize', async () => {
  const diagnostics = { active: 0, maxActive: 0, terminated: 0, modes: [] }, calls = [];
  let returned = false;
  const job = new VideoImporter({ video: { duration: 10, videoWidth: 640, videoHeight: 480, pause() {} }, file: {},
    modelId: 'lite', projectId: 'project', assetUrl: () => 'http://localhost/', bitmap: async () => ({ close() {} }),
    createWorker: () => new PoseWorker(diagnostics),
    decodeFrames: async () => (async function* () {
      try { for (let i = 0; ; i++) yield { source: {}, mediaTimeMs: i * 33, timingMethod: 'decoded-frame', method: 'WebCodecs' }; }
      finally { returned = true; }
    })(),
    request: async url => { calls.push(url); return { takeId: 'cancelled' }; },
  });
  const processing = job.process('fixture.webm');
  setTimeout(() => job.abort(), 20);
  await assert.rejects(processing, { name: 'AbortError' });
  assert.equal(returned, true);
  assert.equal(calls.some(url => url.endsWith('/finalize')), false);
});

test('undecodable files fall back to seeking the video element', async () => {
  const diagnostics = { active: 0, maxActive: 0, terminated: 0, modes: [] }, seeks = [], calls = [];
  const job = new VideoImporter({ video: { duration: .2, videoWidth: 640, videoHeight: 480, pause() {} }, file: {},
    modelId: 'lite', projectId: 'project', assetUrl: () => 'http://localhost/', bitmap: async () => ({ close() {} }),
    createWorker: () => new PoseWorker(diagnostics), decodeFrames: async () => null,
    seek: async (_v, time) => { seeks.push(time); return { mediaTimeMs: time * 1000, timingMethod: 'seek-time' }; },
    request: async (url, options) => { calls.push({ url, body: options.body }); return { takeId: 'fallback' }; },
  });
  await job.process('fixture.webm');
  assert.deepEqual(seeks, [...sampleTimes(200)]);
  const records = calls.filter(c => c.url.endsWith('/batches')).flatMap(c => c.body.records.map(e => e.record));
  assert.equal(records.length, 6);
  assert.ok(records.every(r => r.timingMethod === 'seek-time'));
});

test('video seeking waits for decoded pixels and supports browsers without frame callbacks', async () => {
  class Video extends EventTarget {
    readyState = 2;
    pause() {}
    set currentTime(value) { this.time = value; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
    get currentTime() { return this.time; }
  }
  const controller = new AbortController(), video = new Video();
  assert.deepEqual(await seekVideoFrame(video, .5, controller.signal), { mediaTimeMs: 500, timingMethod: 'seek-time' });
  controller.abort();
  await assert.rejects(seekVideoFrame(video, 1, controller.signal), { name: 'AbortError' });
  class DecodedVideo extends Video {
    requestVideoFrameCallback(callback) { this.callback = callback; return 7; }
    cancelVideoFrameCallback(id) { assert.equal(id, 7); }
    set currentTime(value) {
      this.time = value;
      queueMicrotask(() => {
        this.dispatchEvent(new Event('seeked'));
        this.callback(0, { mediaTime: .4 });
      });
    }
    get currentTime() { return this.time; }
  }
  assert.deepEqual(await seekVideoFrame(new DecodedVideo(), .45, new AbortController().signal),
    { mediaTimeMs: 400, timingMethod: 'decoded-frame' });
});

test('video batches finalize with calibration and survive export and backup after source-take deletion', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-video-'));
  const { app } = createStudio({ dataDir: root }), server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (url, body, method = 'POST') => fetch(base + url, { method,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let p = await (await api('/api/projects', {})).json();
  const { metadata, records } = fixture();
  const capture = await (await api(`/api/projects/${p.projectId}/takes`, metadata)).json();
  const url = `/api/projects/${p.projectId}/takes/${capture.takeId}`;
  const mixed = structuredClone(records); mixed[0].record.schema = 'aerodance.webcam-record';
  assert.equal((await api(`${url}/batches`, { batchId: 0, records: mixed })).status, 400);
  assert.equal((await api(`${url}/batches`, { batchId: 0, records })).status, 200);
  assert.equal((await api(`${url}/batches`, { batchId: 0, records })).status, 200);
  const finish = { batchCount: 1, recordCount: records.length, calibrationFrame: metadata.calibrationFrame };
  assert.equal((await api(`${url}/finalize`, { ...finish, calibrationFrame: { mediaTimeMs: 0, poses: [] } })).status, 400);
  const result = await api(`${url}/finalize`, finish);
  assert.equal(result.status, 200, await result.clone().text());
  const take = await result.json();
  assert.deepEqual((await (await api(`${url}/finalize`, finish)).json()), take);
  p = addTake(p, take);
  const assets = new Map([[take.takeId, take]]);
  p = overwriteTracks(p, take, [0, 1], assets);
  // Explicitly review the deliberate gap for this publication fixture.
  p = appendOperation(p, { type: 'approve', playerId: null, startMs: 200, endMs: 401, reason: 'Reviewed fixture gap' }, assets);
  for (const dataId of trackDataIds(p)) assert.equal((await api(`/api/projects/${p.projectId}/tracks`, assets.get(dataId))).status, 201);
  p.metadata.artist = 'Fixture'; p.metadata.rights.audio.license = 'CC0'; p.metadata.rights.choreography.license = 'CC0';
  p = await (await api(`/api/projects/${p.projectId}`, p, 'PUT')).json();
  p = await (await fetch(`${base}/api/projects/${p.projectId}/audio?durationMs=1000&revision=${p.revision}`, {
    method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.from('fixture audio'),
  })).json();
  p.alignmentReviewed = true;
  p = await (await api(`/api/projects/${p.projectId}`, p, 'PUT')).json();
  const exported = await fetch(`${base}/api/projects/${p.projectId}/export`);
  assert.equal(exported.status, 200, await exported.clone().text());
  const choreography = JSON.parse(readZip(Buffer.from(await exported.arrayBuffer())).get(`${p.songId}/choreography.json`));
  assert.deepEqual(choreography.tracks[0].calibration, takeCalibration(take, 0));
  const backup = await fetch(`${base}/api/projects/${p.projectId}/backup`);
  const restored = await fetch(`${base}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: await backup.arrayBuffer() });
  assert.equal(restored.status, 201);
  const rp = await restored.json();
  const saved = await (await fetch(`${base}/api/projects/${rp.projectId}/takes/${take.takeId}`)).json();
  assert.deepEqual(saved.calibrationFrame, take.calibrationFrame);
  p = await (await api(`/api/projects/${p.projectId}/takes/${take.takeId}`, { revision: p.revision }, 'DELETE')).json();
  const afterDelete = await fetch(`${base}/api/projects/${p.projectId}/backup`);
  const restoredDeleted = await fetch(`${base}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: await afterDelete.arrayBuffer() });
  assert.equal(restoredDeleted.status, 201);
  const dp = await restoredDeleted.json();
  assert.equal(dp.takes.length, 0);
  const snapshot = await (await fetch(`${base}/api/projects/${dp.projectId}/tracks/${dp.tracks[0].dataId}`)).json();
  assert.deepEqual(snapshot.calibration, takeCalibration(take, 0));
});

test('video import can sample at 15 fps', async () => {
  assert.deepEqual([...sampleTimes(200, 0, 15)], [.5 / 15, 1.5 / 15, 2.5 / 15]);
  const diagnostics = { active: 0, maxActive: 0, terminated: 0, modes: [] }, seeks = [], calls = [];
  const job = new VideoImporter({ video: { duration: .2, videoWidth: 640, videoHeight: 480, pause() {} }, file: {},
    modelId: 'lite', projectId: 'project', assetUrl: () => 'http://localhost/', bitmap: async () => ({ close() {} }),
    createWorker: () => new PoseWorker(diagnostics), decodeFrames: async () => null, sampleRate: 15,
    seek: async (_v, time) => { seeks.push(time); return { mediaTimeMs: time * 1000, timingMethod: 'seek-time' }; },
    request: async (url, options) => { calls.push({ url, body: options.body }); return { takeId: 'half-rate' }; },
  });
  await job.process('fixture.webm');
  assert.deepEqual(seeks, [...sampleTimes(200, 0, 15)]);
  assert.equal(calls.find(c => c.url.endsWith('/takes')).body.status.targetRateHz, 15);
  const records = calls.filter(c => c.url.endsWith('/batches')).flatMap(c => c.body.records);
  assert.equal(records.length, 3);
});
