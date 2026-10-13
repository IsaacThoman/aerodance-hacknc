import { WebcamPoseSource } from '../../../packages/pose/browser/WebcamPoseSource.js';

// The live pose input the game and Dance Studio share: the browser webcam, tracked in a worker.
export class PoseSourceController {
  constructor({ webcam = new WebcamPoseSource() } = {}) {
    this.source = webcam; this.playerCount = 1;
    this.listeners = new Set(); this.recordListeners = new Set();
    this.source.subscribe(view => {
      this.view = { ...view, sourceKind: 'webcam', snapshot: view.snapshot ? {
        ...view.snapshot, sourceKind: 'webcam', frameId: view.snapshot.seq,
        timing: { clockKind: 'browser', frameTimeMs: view.snapshot.frameBrowserTimeMs, resultTimeMs: view.snapshot.resultBrowserTimeMs },
      } : null };
      for (const listener of this.listeners) listener(this.view);
    });
    this.source.subscribeRecords(event => { for (const listener of this.recordListeners) listener(event); });
    void this.refreshCameras().catch(() => {});
  }
  get video() { return this.source.video; }
  subscribe(listener) { this.listeners.add(listener); listener(this.view); return () => this.listeners.delete(listener); }
  subscribeRecords(listener) { this.recordListeners.add(listener); return () => this.recordListeners.delete(listener); }
  connect(options) { return this.source.connect(options); }
  disconnect() { this.source.disconnect(); }
  setPlayerCount(count) { this.playerCount = count; return this.source.setPlayerCount(count); }
  configure(options) { return this.source.configure(options); }
  refreshCameras() { return this.source.refreshCameras(); }
}
