import { AndroidPoseSource } from './AndroidPoseSource.js';
import { WebcamPoseSource } from '../../../packages/pose/browser/WebcamPoseSource.js';

// Preserve Android's original records and boundary semantics; both UIs see one source.
export class PoseSourceController {
  constructor({ android = new AndroidPoseSource(), webcam = new WebcamPoseSource() } = {}) {
    this.sources = { android, webcam }; this.mode = 'android'; this.playerCount = 1;
    this.listeners = new Set(); this.recordListeners = new Set(); this.attach();
  }
  get source() { return this.sources[this.mode]; }
  get video() { return this.mode === 'webcam' ? this.source.video : null; }
  attach() {
    this.unsubscribe = this.source.subscribe(view => {
      this.view = { ...view, sourceKind: this.mode, snapshot: view.snapshot ? {
        ...view.snapshot, sourceKind: this.mode, frameId: view.snapshot.seq,
        timing: this.mode === 'webcam'
          ? { clockKind: 'browser', frameTimeMs: view.snapshot.frameBrowserTimeMs, resultTimeMs: view.snapshot.resultBrowserTimeMs }
          : { clockKind: 'android', frameTimeMs: view.snapshot.frameReceivedTimeMs, resultTimeMs: view.snapshot.resultTimeMs },
      } : null };
      for (const listener of this.listeners) listener(this.view);
    });
    this.unrecords = this.source.subscribeRecords(event => { for (const listener of this.recordListeners) listener(event); });
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.view); return () => this.listeners.delete(listener); }
  subscribeRecords(listener) { this.recordListeners.add(listener); return () => this.recordListeners.delete(listener); }
  setMode(mode) {
    if (!this.sources[mode]) throw Error('Choose Android or Webcam');
    if (mode === this.mode) return;
    this.disconnect(); this.unsubscribe(); this.unrecords(); this.mode = mode; this.attach();
    // The inactive source has no pending configuration or capture.
    void this.source.setPlayerCount(this.playerCount);
    if (mode === 'webcam') void this.refreshCameras().catch(() => {});
  }
  connect(options) { return this.source.connect(options); }
  disconnect() { this.source.disconnect(); }
  setPlayerCount(count) { this.playerCount = count; return this.source.setPlayerCount(count); }
  configure(options) { return this.sources.webcam.configure(options); }
  refreshCameras() { return this.sources.webcam.refreshCameras(); }
}
