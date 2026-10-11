import { MEDIAPIPE_VERSION, ASSET_PATH, poseModel } from './models.js';
import { PlayerSlotMapper } from './slots.js';
import { validateWebcamRecord } from '../webcamRecord.js';

const ACTIVE = ['connecting', 'initializing', 'connected'];
const saved = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Private browsing. */ } };
function aborted(promise, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(Error('Camera start cancelled'));
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
    if (signal.aborted) cancel();
  });
}
function cameraMessage(error) {
  return ({ NotAllowedError: 'Camera permission was denied. Allow camera access for this site, then start again.',
    NotFoundError: 'No camera was found. Connect a camera, then start again.',
    NotReadableError: 'The camera is busy or unavailable. Close other camera applications, then start again.',
    OverconstrainedError: 'The selected camera is unavailable. Choose another camera.' })[error.name] || error.message || 'Could not start webcam tracking';
}

export class WebcamPoseSource {
  constructor({ mediaDevices = globalThis.navigator?.mediaDevices,
    createWorker = () => new Worker(new URL('./pose.worker.js', import.meta.url), { type: 'module' }),
    createVideo = () => document.createElement('video'),
    bitmap = (...args) => createImageBitmap(...args), now = () => performance.now(),
    assetUrl = () => new URL(`${import.meta.env?.BASE_URL || '/'}${ASSET_PATH}/`, location.origin).href,
  } = {}) {
    Object.assign(this, { mediaDevices, createWorker, createVideo, bitmap, now, assetUrl });
    this.listeners = new Set(); this.recordListeners = new Set(); this.generation = 0; this.playerCount = 1;
    let modelId = saved('aerodance-webcam-model', 'lite');
    try { poseModel(modelId); } catch { modelId = 'lite'; }
    this.view = { status: 'disconnected', sourceKind: 'webcam', snapshot: null, configuring: false,
      message: 'Choose a camera and model, then Start camera.', model: modelId,
      cameraId: saved('aerodance-webcam-camera', ''), cameras: [], stats: null };
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.view); return () => this.listeners.delete(listener); }
  subscribeRecords(listener) { this.recordListeners.add(listener); return () => this.recordListeners.delete(listener); }
  publish(patch) { this.view = { ...this.view, ...patch }; for (const listener of this.listeners) listener(this.view); }
  emit(event) { for (const listener of this.recordListeners) listener(event); }
  async refreshCameras() {
    if (!this.mediaDevices?.enumerateDevices) return;
    const cameras = (await this.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput')
      .map((device, i) => ({ deviceId: device.deviceId, label: device.label || `Camera ${i + 1}` }));
    this.publish({ cameras });
  }
  async configure({ modelId = this.view.model, cameraId = this.view.cameraId } = {}) {
    poseModel(modelId);
    if (modelId === this.view.model && cameraId === this.view.cameraId) return;
    const active = ACTIVE.includes(this.view.status);
    this.disconnect();
    this.publish({ model: modelId, cameraId });
    save('aerodance-webcam-model', modelId); save('aerodance-webcam-camera', cameraId);
    if (active) await this.connect();
  }
  async setPlayerCount(count) {
    if (![1, 2].includes(count)) throw Error('Choose one or two players');
    if (count === this.playerCount) return;
    const active = ACTIVE.includes(this.view.status);
    this.disconnect(); this.playerCount = count;
    if (active) await this.connect();
  }
  disconnect(message = 'Camera stopped. Start camera to resume.') {
    this.generation++;
    this.controller?.abort();
    clearTimeout(this.startupTimeout); clearInterval(this.watchdog);
    if (this.video) {
      if (this.frameCallback != null) this.video.cancelVideoFrameCallback?.(this.frameCallback);
      if (this.animationFrame != null) cancelAnimationFrame(this.animationFrame);
      this.video.pause(); this.video.srcObject = null; this.video.remove?.();
    }
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null; this.video = null;
    // Ask the worker to close; termination releases it even during a hung inference.
    if (this.worker) {
      const worker = this.worker;
      worker.postMessage({ type: 'close' });
      worker.terminate(); this.worker = null;
    }
    globalThis.document?.removeEventListener('visibilitychange', this.hidden);
    globalThis.window?.removeEventListener('pagehide', this.pagehide);
    this.pending = null; this.busy = false;
    this.emit({ event: { type: 'source-stopped', reason: message }, receivedBrowserTimeMs: this.now() });
    this.publish({ status: 'disconnected', snapshot: null, configuring: false, stats: null, message });
  }
  fail(error) {
    const message = cameraMessage(error);
    this.disconnect(message);
    this.publish({ status: 'error', message });
  }
  async connect() {
    this.disconnect();
    const generation = this.generation;
    const controller = this.controller = new AbortController();
    const current = () => generation === this.generation && !controller.signal.aborted;
    this.publish({ status: 'connecting', snapshot: null, message: 'Waiting for camera permission…' });
    try {
      if (!this.mediaDevices?.getUserMedia) throw Error('Camera access requires HTTPS or localhost and a browser with webcam support.');
      const stream = await this.mediaDevices.getUserMedia({ audio: false, video: {
        width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 },
        ...(this.view.cameraId ? { deviceId: { exact: this.view.cameraId } } : {}),
      } });
      if (!current()) { for (const track of stream.getTracks()) track.stop(); return; }
      this.stream = stream;
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { if (current()) this.fail(Error('Camera disconnected. Choose a camera and start again.')); });
      this.hidden = () => { if (document.hidden) this.disconnect('Tab was hidden. Start camera to resume.'); };
      this.pagehide = () => this.disconnect();
      globalThis.document?.addEventListener('visibilitychange', this.hidden);
      globalThis.window?.addEventListener('pagehide', this.pagehide);
      if (globalThis.document?.hidden) { this.disconnect('Tab was hidden. Start camera to resume.'); return; }
      await this.refreshCameras();
      if (!current()) return;
      const deviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      const actualCamera = this.view.cameras.some(camera => camera.deviceId === deviceId) ? deviceId : this.view.cameraId;
      this.publish({ cameraId: actualCamera }); save('aerodance-webcam-camera', actualCamera);
      const video = this.video = this.createVideo();
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      if (video.style) {
        Object.assign(video.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
        video.setAttribute('aria-hidden', 'true'); document.body.append(video);
      }
      this.startupTimeout = setTimeout(() => { if (current()) this.fail(Error('Camera/model startup timed out. Try again or choose Lite.')); }, 60000);
      await aborted(video.play(), controller.signal);
      if (!current()) return;
      if (!video.videoWidth || !video.videoHeight) throw Error('Camera produced no video frames. Start again.');
      this.input = { width: video.videoWidth, height: video.videoHeight, mirrored: false };
      const model = poseModel(this.view.model);
      this.sessionId = crypto.randomUUID(); this.seq = 0; this.lastMediaTime = -Infinity;
      this.slots = new PlayerSlotMapper(); this.resultTimes = [];
      this.startedAt = this.now(); this.completed = 0; this.dropped = 0; this.lastResult = this.startedAt;
      const worker = this.worker = this.createWorker();
      worker.onmessage = ({ data }) => { if (current() && data.sessionId === this.sessionId) this.handleWorker(data); };
      worker.onerror = event => { if (current()) this.fail(Error(event.message || 'Pose worker failed. Try another model or browser.')); };
      const base = this.assetUrl();
      this.publish({ status: 'initializing', message: `Loading ${model.label} model…`,
        modelConfig: { modelId: model.id, modelHash: model.sha256, packageVersion: MEDIAPIPE_VERSION,
          thresholds: { detection: 0.5, presence: 0.5, tracking: 0.5 }, timingMethod: 'browser-frame-observation' } });
      worker.postMessage({ type: 'initialize', sessionId: this.sessionId, playerCount: this.playerCount,
        modelUrl: new URL(model.file, base).href, modelHash: model.sha256, wasmUrl: new URL('wasm', base).href });
      this.watchdog = setInterval(() => {
        if (!current()) return;
        if (this.view.snapshot && this.now() - this.view.snapshot.frameBrowserTimeMs >= 500) this.publish({ snapshot: null });
        if (this.view.status === 'connected' && this.now() - this.lastResult > 10000) this.fail(Error('Camera tracking stopped responding. Start camera to retry.'));
      }, 100);
    } catch (error) { if (current()) this.fail(error); }
  }
  handleWorker(data) {
    if (data.type === 'error') { this.fail(Error(data.message)); return; }
    if (data.type === 'ready') {
      this.publish({ delegate: data.delegate, modelConfig: { ...this.view.modelConfig, delegate: data.delegate },
        message: data.fallback ? 'GPU unavailable; using CPU. Waiting for the first pose result…' : 'Waiting for the first pose result…' });
      this.schedule(); return;
    }
    if (data.type !== 'result' || !this.pending || data.seq !== this.pending.seq) return;
    const pending = this.pending;
    this.pending = null; this.busy = false;
    const receivedBrowserTimeMs = this.now();
    this.lastResult = receivedBrowserTimeMs;
    const frameAgeMs = receivedBrowserTimeMs - pending.frameBrowserTimeMs;
    // Never let a slow result revive expired player readiness or contaminate a take.
    if (frameAgeMs >= 500) { this.dropped++; this.publish({ snapshot: null, message: 'Tracking is too slow. Try Lite or another camera.' }); return; }
    try {
      const record = validateWebcamRecord({ schema: 'aerodance.webcam-record', schemaVersion: 1, type: 'pose',
        sessionId: this.sessionId, seq: pending.seq, playerCount: this.playerCount, input: this.input,
        modelId: this.view.model, ...pending, resultBrowserTimeMs: receivedBrowserTimeMs,
        timingMethod: 'browser-frame-observation', poses: this.slots.map(data.landmarks, this.playerCount) });
      clearTimeout(this.startupTimeout);
      this.completed++;
      this.emit({ record, receivedBrowserTimeMs });
      this.resultTimes.push(receivedBrowserTimeMs);
      this.resultTimes = this.resultTimes.filter(time => receivedBrowserTimeMs - time <= 2000);
      const poseHz = this.resultTimes.length > 1 ? (this.resultTimes.length - 1) * 1000 / Math.max(1, receivedBrowserTimeMs - this.resultTimes[0]) : 0;
      this.publish({ status: 'connected', snapshot: { ...record, sourceKind: 'webcam', frameId: record.seq },
        stats: { poseHz, inferenceMs: data.inferenceMs, frameAgeMs, droppedFrames: this.dropped },
        message: `${poseModel(this.view.model).label} · ${this.view.delegate} · ${this.resultTimes.length > 1 ? `${poseHz.toFixed(1)} poses/s` : 'Measuring tracking speed…'}${poseHz < 15 && this.completed > 30 ? this.view.model === 'lite' ? ' · Slow tracking; close other apps.' : ' · Slow tracking; try Lite.' : ' · Step into view.'}` });
    } catch (error) { this.fail(error); }
  }
  schedule() {
    const video = this.video;
    const generation = this.generation;
    if (!video) return;
    const callback = (_time, metadata) => {
      if (generation !== this.generation) return;
      this.schedule();
      const mediaTimeMs = (metadata?.mediaTime ?? video.currentTime) * 1000;
      if (!Number.isFinite(mediaTimeMs) || mediaTimeMs <= this.lastMediaTime) return;
      this.lastMediaTime = mediaTimeMs;
      if (this.busy) { this.dropped++; return; }
      if (video.videoWidth !== this.input.width || video.videoHeight !== this.input.height) {
        this.fail(Error('Camera dimensions changed. Start again to recalibrate.')); return;
      }
      this.busy = true;
      const pending = this.pending = { seq: ++this.seq, mediaTimeMs, frameBrowserTimeMs: this.now() };
      void this.bitmap(video).then(bitmap => {
        if (generation !== this.generation) { bitmap.close(); return; }
        this.worker.postMessage({ type: 'frame', bitmap, seq: pending.seq, timestampMs: mediaTimeMs }, [bitmap]);
      }).catch(error => { if (generation === this.generation) this.fail(error); });
    };
    if (video.requestVideoFrameCallback) this.frameCallback = video.requestVideoFrameCallback(callback);
    else this.animationFrame = requestAnimationFrame(callback);
  }
}
