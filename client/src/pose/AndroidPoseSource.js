import { deviceEndpoint, NdjsonDecoder, PoseState } from './protocol.js';
import { ClockSync } from './clockSync.js';

// Camera exposure and readout before Android's frame callback. Not measured on the board yet
// (docs/scoring.md): one 30 fps frame is the working estimate. Never tune it from scores.
export const CAPTURE_DELAY_MS = 33;
// Without clock sync, the network's share of the delay: a typical one-way Wi-Fi trip.
const FALLBACK_NETWORK_MS = 15;
const NO_TIMING = { method: 'none', uncertaintyMs: null };

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new Error('Connection cancelled')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
});

/**
 * Transport stays independent of React and the game/backend connection.
 *
 * Record listeners get { record, receivedBrowserTimeMs, captureBrowserTimeMs, timing }:
 * captureBrowserTimeMs is when the camera saw the pose, on the performance.now() clock. With
 * Android's /v1/time (capabilities.timeSync) it comes from the synchronized clocks; otherwise
 * it is estimated from arrival less Android's processing time (timing.method says which).
 */
export class AndroidPoseSource {
  constructor({ fetch: request = globalThis.fetch.bind(globalThis), now = () => performance.now() } = {}) {
    this.request = request;
    this.now = now;
    this.listeners = new Set();
    this.recordListeners = new Set();
    this.playerCount = 1;
    this.generation = 0;
    this.state = new PoseState();
    this.view = { status: 'disconnected', message: '', snapshot: null, configuring: false, timing: NO_TIMING };
    this.clock = null;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }
  /** Capture every accepted record once, independently of render/watchdog updates. */
  subscribeRecords(listener) {
    this.recordListeners.add(listener);
    return () => this.recordListeners.delete(listener);
  }
  publish(patch) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener(this.view);
  }
  disconnect() {
    this.generation++;
    this.controller?.abort();
    clearInterval(this.watchdog);
    this.stopClock();
    this.state = new PoseState();
    this.boundary = null;
    this.publish({ status: 'disconnected', snapshot: null, configuring: false, message: '', timing: NO_TIMING });
  }
  stopClock() {
    this.clock?.stop();
    this.clock = null;
  }
  /** Synchronizes with Android's clock in the background; the stream never waits for it. */
  startClock(info, signal) {
    this.stopClock();
    if (!info.capabilities?.timeSync) {
      this.publish({ timing: { method: 'receipt-estimate', uncertaintyMs: null } });
      return;
    }
    this.publish({ timing: { method: 'receipt-estimate', uncertaintyMs: null } });
    const clock = new ClockSync({
      request: this.request, now: this.now, base: this.base, sessionId: info.sessionId,
      onUpdate: (e) => {
        if (this.clock === clock && e) this.publish({ timing: { method: 'clock-sync', uncertaintyMs: e.uncertaintyMs } });
      },
    });
    this.clock = clock;
    clock.start(signal).catch(() => {});
  }
  /** When the camera saw a pose record, on the browser clock. */
  captureTime(record, receivedBrowserTimeMs) {
    const synced = this.clock?.toBrowser(record.frameReceivedTimeMs);
    if (synced !== null && synced !== undefined) return synced - CAPTURE_DELAY_MS;
    return receivedBrowserTimeMs - (record.resultTimeMs - record.frameReceivedTimeMs) - FALLBACK_NETWORK_MS - CAPTURE_DELAY_MS;
  }
  connect(ip) {
    const base = deviceEndpoint(ip);
    this.disconnect();
    this.base = base;
    this.ip = ip.trim();
    this.retry = 0;
    this.connectedOnce = false;
    this.controller = new AbortController();
    const token = this.generation;
    const signal = this.controller.signal;
    this.watchdog = setInterval(() => {
      const snapshot = this.matchingSnapshot();
      if (snapshot !== this.view.snapshot) this.publish({ snapshot });
      if (this.state.lastRecord !== null && this.now() - this.state.lastRecord > 12000) this.attempt?.abort();
    }, 100);
    void this.run(token, signal);
  }
  matchingSnapshot() {
    const record = this.state.current(this.now());
    const boundary = this.boundary;
    return boundary && record?.sessionId === boundary.sessionId && record.playerCount === this.playerCount &&
      record.seq >= boundary.effectiveFromSeq ? record : null;
  }
  async json(path, signal, options = {}) {
    const response = await this.request(`${this.base}${path}`, {
      credentials: 'omit', cache: 'no-store', ...options, signal,
    });
    if (!response.ok) throw Error(`${path === '/v1/config' ? 'Player configuration' : 'Device status'} HTTP ${response.status}`);
    return response.json();
  }
  async configure(signal) {
    const count = this.playerCount;
    const boundary = await this.json('/v1/config', signal, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerCount: count }),
    });
    if (boundary.playerCount !== count || !Number.isSafeInteger(boundary.effectiveFromSeq) || boundary.effectiveFromSeq < 1 ||
        typeof boundary.sessionId !== 'string' || !boundary.sessionId.trim()) throw Error('Invalid player configuration response');
    if (signal.aborted) return;
    this.boundary = boundary;
    this.publish({ snapshot: this.matchingSnapshot() });
  }
  async setPlayerCount(count) {
    if (![1, 2].includes(count)) throw Error('Choose one or two players');
    if (this.view.configuring) throw Error('Player configuration is still in progress');
    this.playerCount = count;
    this.boundary = null;
    this.publish({ snapshot: null });
    if (!['connected', 'initializing'].includes(this.view.status)) return;
    const token = this.generation;
    const attempt = this.attempt;
    const signal = attempt.signal;
    this.publish({ configuring: true, message: 'Applying player mode…' });
    const timeout = setTimeout(() => attempt.abort(), 12000);
    try {
      await this.configure(signal);
      if (token === this.generation && !signal.aborted) this.publish({ message: this.view.status === 'initializing'
        ? 'Starting camera and pose tracking. This can take up to 90 seconds.' : 'Waiting for fresh player tracking.' });
    } catch (error) {
      if (token === this.generation) attempt.abort();
      throw error;
    } finally {
      clearTimeout(timeout);
      if (token === this.generation) this.publish({ configuring: false });
    }
  }
  checkStatus(info) {
    if (info.protocolVersion !== 2 || typeof info.sessionId !== 'string' || !info.sessionId.trim() || ![1, 2].every(n => info.capabilities?.supportedPlayerCounts?.includes(n))) {
      throw Error('This game needs an Android protocol v2 controller with one- and two-player support');
    }
  }
  async run(token, signal) {
    while (!signal.aborted && token === this.generation) {
      const attempt = new AbortController();
      this.attempt = attempt;
      const abort = () => attempt.abort();
      signal.addEventListener('abort', abort, { once: true });
      this.state = new PoseState();
      this.boundary = null;
      this.publish({ status: this.connectedOnce ? 'reconnecting' : 'connecting', snapshot: null, message: 'Checking Android camera…' });
      let startupTimedOut = false;
      const startupExpired = () => { startupTimedOut = true; abort(); };
      let startupTimeout = setTimeout(startupExpired, 90000);
      let initializing = true;
      let reader;
      let failure;
      try {
        let info = await this.json('/v1/status', attempt.signal);
        this.checkStatus(info);
        await this.configure(attempt.signal);
        const session = info.sessionId;
        if (this.boundary?.sessionId !== session) throw Error('Android restarted during configuration');
        while (info.pipelineState === 'starting') {
          this.publish({ message: 'Starting camera and GPU. This can take up to 90 seconds.' });
          await wait(500, attempt.signal);
          info = await this.json('/v1/status', attempt.signal);
          this.checkStatus(info);
          if (info.sessionId !== session) throw Error('Android restarted during startup');
        }
        if (info.pipelineState !== 'running') throw Error(`Android camera is ${info.pipelineState}`);
        while (!attempt.signal.aborted && this.boundary?.playerCount !== this.playerCount) await this.configure(attempt.signal);
        if (attempt.signal.aborted || token !== this.generation) return;
        const response = await this.request(`${this.base}/v1/stream`, { signal: attempt.signal, credentials: 'omit', cache: 'no-store' });
        if (!response.ok || !response.body) throw Error(response.status === 409 ? 'The camera stream is already in use. Close the other connection.' : `Pose stream HTTP ${response.status}`);
        clearTimeout(startupTimeout);
        startupTimeout = setTimeout(startupExpired, 90000);
        if (signal.aborted || token !== this.generation) return;
        this.connectedOnce = true;
        this.startClock(info, attempt.signal);
        this.publish({ status: 'initializing', snapshot: null,
          message: 'Starting camera and pose tracking. This can take up to 90 seconds.', model: info.capabilities.poseModel });
        try { localStorage.setItem('aerodance-client-ip', this.ip); } catch { /* Storage may be disabled. */ }
        this.state.lastRecord = this.now();
        const decoder = new NdjsonDecoder(record => {
          if (record.sessionId !== session) throw Error('Android camera restarted');
          if (record.type === 'heartbeat' && !['starting', 'running'].includes(record.pipelineState)) throw Error(`Android camera is ${record.pipelineState}`);
          const receivedBrowserTimeMs = this.now();
          const accepted = this.state.accept(record, receivedBrowserTimeMs);
          if (initializing && accepted && this.matchingSnapshot()) {
            initializing = false;
            clearTimeout(startupTimeout);
            this.publish({ status: 'connected', message: 'Camera ready. Step into view.' });
          }
          if (accepted) this.retry = 0;
          if (accepted || record.type === 'heartbeat') {
            const captureBrowserTimeMs = record.type === 'pose' ? this.captureTime(record, receivedBrowserTimeMs) : undefined;
            for (const listener of this.recordListeners) listener({ record, receivedBrowserTimeMs, captureBrowserTimeMs, timing: this.view.timing });
          }
          this.publish({ snapshot: this.matchingSnapshot() });
        });
        reader = response.body.getReader();
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (token !== this.generation) return;
          if (done) { decoder.finish(); throw Error('Camera stream ended'); }
          decoder.push(value);
        }
      } catch (error) { failure = startupTimedOut ? Error('Camera initialization timed out after 90 seconds') : error; }
      finally {
        clearTimeout(startupTimeout);
        signal.removeEventListener('abort', abort);
        attempt.abort();
        if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
      this.stopClock();
      if (signal.aborted || token !== this.generation) return;
      this.state = new PoseState();
      const message = `${(failure?.message || 'Connection interrupted').replace(/\.$/, '')}. Check Android Start, Wi-Fi, the allowed origin, and browser local-network permission.`;
      if (!this.connectedOnce || this.retry >= 5) {
        clearInterval(this.watchdog);
        this.publish({ status: 'error', snapshot: null, message: `${message} Connect again to retry.` });
        return;
      }
      const delay = Math.min(1000 * 2 ** this.retry++, 8000);
      this.publish({ status: 'reconnecting', snapshot: null, message: `${message} Retrying in ${delay / 1000}s.` });
      try { await wait(delay, signal); } catch { return; }
    }
  }
}
