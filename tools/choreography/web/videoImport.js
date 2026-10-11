import { ASSET_PATH, MEDIAPIPE_VERSION, poseModel } from '../../../packages/pose/browser/models.js';
import { assignPlayerSlots, PlayerSlotMapper } from '../../../packages/pose/browser/slots.js';
import { reliableBodyPose } from '../../../packages/character/calibration.js';
import { validateVideoRecord } from '../../../packages/pose/videoRecord.js';
import { validatePoses } from '../../../packages/pose/choreography.js';

const cancelled = () => new DOMException('Video import cancelled', 'AbortError');
export const DEFAULT_SAMPLE_RATE = 30;

// Sample the middle of each 1/rate s window. Container timestamps are rounded
// (67 ms for 66.7 ms), so sampling exactly k/rate often selects the prior frame.
export function* sampleTimes(durationMs, start = 0, rate = DEFAULT_SAMPLE_RATE) {
  for (let k = 0; k < Math.ceil(durationMs * rate / 1000); k++) yield start + (k + .5) / rate;
}

export function videoRegionCrop(detections, playerId, width, height) {
  // Small dancers in portrait footage need a vertical crop as well as a side
  // crop. Use reliable detections to locate the common dancing area.
  const ys = detections.flatMap(points => {
    const visible = points.filter(p => Number.isFinite(p.y) && p.y >= 0 && p.y <= 1 &&
      Math.min(p.visibility ?? 0, p.presence ?? 0) >= .5).map(p => p.y * height);
    if ([11, 12, 23, 24].some(i => !points[i] || Math.min(points[i].visibility ?? 0, points[i].presence ?? 0) < .5)) return visible;
    const shoulderY = (points[11].y + points[12].y) * height / 2, hipY = (points[23].y + points[24].y) * height / 2;
    const dx = (points[23].x + points[24].x - points[11].x - points[12].x) * width / 2;
    const torso = Math.hypot(dx, hipY - shoulderY);
    // Inferred feet can be low confidence in the original small detection;
    // don't let that crop them out of the recovery input.
    return [...visible, Math.max(0, shoulderY - torso), Math.min(height, hipY + torso * 2.5)];
  });
  const padding = ys.length ? Math.max(height * .05, (Math.max(...ys) - Math.min(...ys)) * .3) : 0;
  const cropHeight = Math.min(height, Math.max(width * .75, height * .4));
  const top = ys.length ? Math.max(0, Math.floor(Math.min(...ys) - padding)) : Math.floor((height - cropHeight) / 2);
  const bottom = ys.length ? Math.min(height, Math.ceil(Math.max(...ys) + padding)) : top + cropHeight;
  const left = playerId === 1 ? 0 : Math.floor(width / 2);
  return { x: left, y: top, width: playerId === 1 ? Math.floor(width / 2) : width - left,
    height: Math.max(1, Math.ceil(bottom - top)) };
}

export function restoreVideoLandmarks(points, crop, width, height) {
  return points.map(p => ({ ...p, x: (crop.x + p.x * crop.width) / width,
    y: (crop.y + p.y * crop.height) / height, z: p.z * crop.width / width }));
}

// Display every valid detection, even when confidence or framing prevents using
// it for calibration. Otherwise a detected dancer looks completely missing.
export function videoCalibrationPreview(detections) {
  const accepted = assignPlayerSlots(detections, 2).filter(reliableBodyPose);
  const detectedPoses = detections.flatMap(points => {
    const landmarks = points.map(p => ({ x: p.x, y: p.y, z: p.z,
      visibility: p.visibility ?? null, presence: p.presence ?? null }));
    try { validatePoses([{ playerId: 0, landmarks }]); } catch { return []; }
    const x = (landmarks[23].x + landmarks[24].x) / 2;
    const playerId = x < .5 ? 1 : 0;
    const ready = accepted.some(p => p.playerId === playerId &&
      p.landmarks[23].x === landmarks[23].x && p.landmarks[23].y === landmarks[23].y);
    const reason = ready ? 'ready' : Math.abs(x - .5) <= .025
      ? 'move away from the center divider' : 'needs clearer shoulders, hips and feet';
    return [{ playerId, landmarks, ready, reason }];
  });
  return { poses: accepted, detectedPoses };
}

// Seek before copying pixels. Frame callbacks supply presentation timestamps;
// older browsers (and seeks that do not present a new frame) use seek time.
export function seekVideoFrame(video, time, signal) {
  return new Promise((resolve, reject) => {
    let callback, frameTimer, timeout, frame;
    const cleanup = () => {
      clearTimeout(timeout); clearTimeout(frameTimer);
      if (callback !== undefined) video.cancelVideoFrameCallback?.(callback);
      video.removeEventListener('seeked', seeked); video.removeEventListener('error', failed);
      signal.removeEventListener('abort', abort);
    };
    const finish = () => { cleanup(); resolve(frame || { mediaTimeMs: video.currentTime * 1000, timingMethod: 'seek-time' }); };
    const abort = () => { cleanup(); reject(cancelled()); };
    const failed = () => { cleanup(); reject(Error('Could not decode this video frame. Try another video format.')); };
    const seeked = () => {
      if (video.readyState < 2) { failed(); return; }
      if (frame || !video.requestVideoFrameCallback) finish();
      else frameTimer = setTimeout(finish, 100);
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    video.addEventListener('error', failed, { once: true });
    video.addEventListener('seeked', seeked, { once: true });
    if (video.requestVideoFrameCallback) callback = video.requestVideoFrameCallback((_now, metadata) => {
      frame = { mediaTimeMs: metadata.mediaTime * 1000, timingMethod: 'decoded-frame' };
      if (!video.seeking && video.readyState >= 2) finish();
    });
    timeout = setTimeout(() => { cleanup(); reject(Error('Video decoding timed out. Try another video format.')); }, 15000);
    video.pause();
    try { video.currentTime = time; } catch { failed(); }
  });
}

// Fallback when WebCodecs cannot decode the file: one seek per sample.
export async function* seekFrames(video, seek, durationMs, signal, rate) {
  for (const time of sampleTimes(durationMs, 0, rate)) yield { source: video, method: 'seeking', ...await seek(video, time, signal) };
}

// Decodes the file sequentially, avoiding a decoder reset for every sample.
// Returns null when this browser or file needs the seeking fallback.
export async function webCodecsFrames(file, { width, height, durationMs, rate }) {
  if (!file || typeof VideoDecoder === 'undefined') return null;
  let input;
  try {
    const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    // CanvasSink applies rotation metadata; the size must match what <video>
    // reports, which calibration and region crops use.
    if (!track || !await track.canDecode() || track.displayWidth !== width || track.displayHeight !== height) {
      input.dispose(); return null;
    }
    // Timestamps stay in file time, matching the <video> frame callbacks that
    // calibration uses, but files may start after zero.
    const start = Math.max(0, await track.getFirstTimestamp());
    // One canvas in inference, one prefetched, one spare.
    const sink = new CanvasSink(track, { poolSize: 3 });
    return (async function* () {
      try {
        for await (const frame of sink.canvasesAtTimestamps(sampleTimes(durationMs, start, rate))) {
          if (frame && frame.timestamp >= 0) yield { source: frame.canvas, mediaTimeMs: frame.timestamp * 1000,
            timingMethod: 'decoded-frame', method: 'WebCodecs' };
        }
      } finally { input.dispose(); }
    })();
  } catch { input?.dispose(); return null; }
}

export class VideoImporter {
  constructor({ video, file, modelId, request, projectId, onProgress = () => {}, sampleRate = DEFAULT_SAMPLE_RATE,
    createWorker = () => new Worker(new URL('../../../packages/pose/browser/pose.worker.js', import.meta.url), { type: 'module' }),
    bitmap = (...args) => createImageBitmap(...args), seek = seekVideoFrame, decodeFrames = webCodecsFrames,
    assetUrl = () => new URL(`${import.meta.env?.BASE_URL || '/'}${ASSET_PATH}/`, location.origin).href,
  }) {
    Object.assign(this, { video, file, modelId, request, projectId, onProgress, sampleRate, createWorker, bitmap, seek, decodeFrames, assetUrl });
    this.model = poseModel(modelId);
    this.controller = new AbortController();
    this.sessionId = crypto.randomUUID();
    this.seq = 0;
  }
  abort() {
    this.controller.abort(); this.closeWorker(); this.video.pause();
  }
  closeWorker() {
    this.worker?.terminate(); this.worker = null;
    this.regionWorker?.terminate(); this.regionWorker = null;
  }
  waitForMessage(send, type, worker = this.worker) {
    const signal = this.controller.signal;
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer); worker.removeEventListener('message', message); worker.removeEventListener('error', error);
        signal.removeEventListener('abort', abort);
      };
      const fail = e => { cleanup(); reject(e); };
      const abort = () => fail(cancelled());
      const error = e => fail(Error(e.message || 'Video pose worker failed'));
      const message = ({ data }) => {
        if (data.sessionId !== this.sessionId) return;
        if (data.type === 'error') fail(Error(data.message));
        else if (data.type === type && (type !== 'result' || data.seq === send.seq)) { cleanup(); resolve(data); }
      };
      if (signal.aborted) { abort(); return; }
      worker.addEventListener('message', message); worker.addEventListener('error', error);
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => fail(Error('Pose processing timed out. Try Lite or another browser.')), 60000);
      try { worker.postMessage(send, send.bitmap ? [send.bitmap] : []); } catch (e) { send.bitmap?.close(); fail(e); }
    });
  }
  async initialize(runningMode) {
    this.closeWorker(); this.worker = this.createWorker();
    const base = this.assetUrl();
    this.workerConfig = { type: 'initialize', sessionId: this.sessionId, playerCount: 2, runningMode,
      modelUrl: new URL(this.model.file, base).href, modelHash: this.model.sha256,
      wasmUrl: new URL('wasm', base).href };
    const ready = await this.waitForMessage(this.workerConfig, 'ready');
    return { modelId: this.model.id, modelHash: this.model.sha256, packageVersion: MEDIAPIPE_VERSION,
      delegate: ready.delegate, thresholds: { detection: .5, presence: .5, tracking: .5 },
      inferenceMethod: 'full-frame-with-region-recovery' };
  }
  async ensureRegionWorker() {
    if (!this.regionWorker) {
      // Separate IMAGE inference preserves the full-frame VIDEO tracking state
      // and avoids sharing MediaPipe's Wasm loader globals between task instances.
      this.regionWorker = this.createWorker();
      await this.waitForMessage({ ...this.workerConfig, runningMode: 'IMAGE', playerCount: 1 }, 'ready', this.regionWorker);
    }
    return this.regionWorker;
  }
  async infer(mediaTimeMs, crop, regionId, source = this.video) {
    const worker = crop ? await this.ensureRegionWorker() : this.worker;
    const bitmap = crop ? await this.bitmap(source, crop.x, crop.y, crop.width, crop.height) : await this.bitmap(source);
    if (this.controller.signal.aborted) { bitmap.close(); throw cancelled(); }
    return this.waitForMessage({ type: 'frame', bitmap, seq: ++this.seq,
      timestampMs: mediaTimeMs, ...(crop ? { regionId } : {}) }, 'result', worker);
  }
  async detectDancers(mediaTimeMs, calibration = false, source = this.video) {
    const result = await this.infer(mediaTimeMs, null, null, source);
    let detections = result.landmarks;
    const accepted = assignPlayerSlots(detections, 2).filter(p => !calibration || reliableBodyPose(p));
    const width = this.video.videoWidth, height = this.video.videoHeight;
    for (const id of [0, 1]) {
      if (accepted.some(p => p.playerId === id)) continue;
      const crop = videoRegionCrop(detections, id, width, height);
      const regional = await this.infer(mediaTimeMs, crop, id, source);
      const restored = regional.landmarks.map(p => restoreVideoLandmarks(p, crop, width, height));
      const candidate = assignPlayerSlots(restored, 2).find(p => p.playerId === id);
      if (!candidate || calibration && !reliableBodyPose(candidate)) continue;
      // Replace candidates only in the searched region, retaining the other
      // dancer and its original coordinates and confidence.
      detections = detections.filter(p => ((p[23].x + p[24].x) / 2 < .5 ? 1 : 0) !== id);
      detections.push(candidate.landmarks);
    }
    return detections;
  }
  async calibrate(time = this.video.currentTime) {
    try {
      await this.initialize('IMAGE');
      const frame = await this.seek(this.video, time, this.controller.signal);
      const preview = videoCalibrationPreview(await this.detectDancers(frame.mediaTimeMs, true));
      if (!preview.detectedPoses.length) throw Error('No dancers detected in this frame. Try another frame or Full / Heavy.');
      return { mediaTimeMs: frame.mediaTimeMs, ...preview };
    } finally { this.closeWorker(); }
  }
  async upload(path, body) {
    const options = { method: 'POST', body, signal: this.controller.signal };
    try { return await this.request(path, options); }
    catch (error) {
      if (this.controller.signal.aborted) throw cancelled();
      return this.request(path, options);
    }
  }
  async process(filename) {
    const durationMs = this.video.duration * 1000;
    if (!(durationMs > 0 && durationMs <= 3600000) || !this.video.videoWidth || !this.video.videoHeight)
      throw Error('Choose a decodable video between zero and one hour long');
    const input = { width: this.video.videoWidth, height: this.video.videoHeight, mirrored: false };
    this.onProgress({ fraction: 0, message: `Loading ${this.model.label} model…` });
    try {
      const status = { ...await this.initialize('VIDEO'), filename, durationMs, targetRateHz: this.sampleRate };
      const capture = await this.upload(`/api/projects/${this.projectId}/takes`, { sourceKind: 'video', name: filename, status });
      this.path = `/api/projects/${this.projectId}/takes/${capture.takeId}`;
      this.players = new Set(); this.batchCount = 0; this.recordCount = 0;
      const slots = new PlayerSlotMapper();
      let lastTime = -Infinity, pending = [];
      const flush = async () => {
        if (!pending.length) return;
        await this.upload(`${this.path}/batches`, { batchId: this.batchCount, records: pending });
        this.batchCount++; pending = [];
      };
      const frames = await this.decodeFrames(this.file, { width: input.width, height: input.height, durationMs,
        rate: this.sampleRate }) ?? seekFrames(this.video, this.seek, durationMs, this.controller.signal, this.sampleRate);
      let next = frames.next(), firstTime;
      try {
        for (let result; !(result = await next).done;) {
          if (this.controller.signal.aborted) throw cancelled();
          const { source, method, mediaTimeMs, timingMethod } = result.value;
          // Decoded canvases come from a pool, so the next frame can decode
          // during inference. The seeking fallback must not move the video yet.
          const prefetch = source !== this.video;
          next = prefetch ? frames.next() : null;
          next?.catch(() => {});
          // The last sample window can reach past the container duration, and
          // the final frame's timestamp may exceed it; the take rejects those.
          if (mediaTimeMs > lastTime && mediaTimeMs <= durationMs) {
            if (!prefetch && (this.video.videoWidth !== input.width || this.video.videoHeight !== input.height))
              throw Error('Video dimensions changed during processing');
            const poses = slots.map(await this.detectDancers(mediaTimeMs, false, source), 2);
            for (const p of poses) this.players.add(p.playerId);
            const record = validateVideoRecord({ schema: 'aerodance.video-record', schemaVersion: 1, type: 'pose',
              sessionId: this.sessionId, seq: this.recordCount + 1, playerCount: 2, modelId: this.modelId, input,
              mediaTimeMs, timingMethod, poses });
            pending.push({ ordinal: this.recordCount++, record }); lastTime = mediaTimeMs;
            firstTime ??= mediaTimeMs;
            this.onProgress({ fraction: Math.min(1, (mediaTimeMs - firstTime) / durationMs),
              message: `Processing video · ${this.recordCount} samples · ${method} · ${status.delegate}` });
            if (pending.length >= 100) await flush();
          }
          next ??= frames.next();
        }
      } finally { await frames.return(); }
      await flush();
      if (this.recordCount < 2) throw Error('Video needs at least two distinct frames');
      if (!this.players.size) throw Error('No dancers detected in this video');
      this.processed = true;
    } finally { this.closeWorker(); }
  }
  async finalize(calibrationFrame) {
    if (!this.processed) throw Error('Process the video first');
    const missing = [...this.players].filter(id => !calibrationFrame?.poses.some(p => p.playerId === id));
    if (missing.length) throw Error(`Choose a calibration frame with ${missing.map(id => `P${id + 1}`).join(' and ')} clearly visible. Processed poses are ready to save.`);
    return this.upload(`${this.path}/finalize`, { batchCount: this.batchCount, recordCount: this.recordCount, calibrationFrame });
  }
}
