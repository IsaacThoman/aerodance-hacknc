/*
 * Maps the Android pose clock onto the browser's performance.now() clock, so each pose can
 * be placed at the song position the player was hearing when the camera saw them
 * (docs/android-game-integration-plan.md, "Required Android timing extension").
 *
 * Android's GET /v1/time answers with the time it received the request (a1) and the time it
 * sent the reply (a2), on the clock its pose records use. With the browser's send (b0) and
 * receive (b3) times:
 *   offset    = ((a1 - b0) + (a2 - b3)) / 2      Android time minus browser time
 *   roundTrip = (b3 - b0) - (a2 - a1)
 * Half the round trip bounds the error (the two directions may not take equally long), so
 * the low-round-trip exchanges are the ones trusted.
 */

const EXCHANGES = 8;
const REFRESH_EXCHANGES = 3;
const REFRESH_MS = 20_000;
const HISTORY = 24;
const TIMEOUT_MS = 1500;

/** One exchange's offset and round trip, or null when it can't be right. */
export function measureExchange({ b0, b3, a1, a2 }) {
  if (![b0, b3, a1, a2].every(Number.isFinite) || b3 < b0 || a2 < a1) return null;
  const roundTrip = b3 - b0 - (a2 - a1);
  if (roundTrip < 0) return null;
  return { offsetMs: ((a1 - b0) + (a2 - b3)) / 2, roundTripMs: roundTrip, at: b3 };
}

/**
 * Best estimate from recent exchanges: the median offset of the fastest third (a slow
 * exchange is a delayed one), with half the fastest round trip as its uncertainty.
 */
export function estimateOffset(samples) {
  const good = samples.filter(Boolean);
  if (!good.length) return null;
  const fastest = [...good].sort((a, b) => a.roundTripMs - b.roundTripMs);
  const pick = fastest.slice(0, Math.max(1, Math.ceil(fastest.length / 3))).map((s) => s.offsetMs).sort((a, b) => a - b);
  const mid = pick.length >> 1;
  const offsetMs = pick.length % 2 ? pick[mid] : (pick[mid - 1] + pick[mid]) / 2;
  return { offsetMs, uncertaintyMs: fastest[0].roundTripMs / 2, samples: good.length };
}

export class ClockSync {
  /**
   * request: fetch; now: performance.now; base: http://ip:1337; sessionId: the stream's
   * session; onUpdate(estimate): after each round of exchanges.
   */
  constructor({ request, now, base, sessionId, onUpdate }) {
    Object.assign(this, { request, now, base, sessionId, onUpdate });
    this.history = [];
    this.estimate = null;
    this.timer = null;
    this.stopped = false;
  }
  async exchange(signal) {
    const ctl = new AbortController();
    const abort = () => ctl.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, TIMEOUT_MS);
    try {
      const b0 = this.now();
      const response = await this.request(`${this.base}/v1/time`, { credentials: 'omit', cache: 'no-store', signal: ctl.signal });
      const body = response.ok ? await response.json() : null;
      const b3 = this.now();
      if (!body || body.sessionId !== this.sessionId) return null;
      return measureExchange({ b0, b3, a1: body.receivedTimeMs, a2: body.sentTimeMs });
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  async run(count, signal) {
    for (let i = 0; i < count && !this.stopped && !signal?.aborted; i++) {
      const sample = await this.exchange(signal);
      if (sample) this.history.push(sample);
    }
    this.history = this.history.slice(-HISTORY);
    this.estimate = estimateOffset(this.history) ?? this.estimate;
    if (!this.stopped) this.onUpdate?.(this.estimate);
    return this.estimate;
  }
  /** First estimate, then a few more exchanges every 20 s to follow drift. */
  async start(signal) {
    const estimate = await this.run(EXCHANGES, signal);
    const tick = async () => {
      if (this.stopped || signal?.aborted) return;
      await this.run(REFRESH_EXCHANGES, signal);
      if (!this.stopped) this.timer = setTimeout(tick, REFRESH_MS);
    };
    if (!this.stopped) this.timer = setTimeout(tick, REFRESH_MS);
    return estimate;
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
  /** An Android pose-clock time on the browser clock, or null before the first estimate. */
  toBrowser(androidMs) {
    return this.estimate ? androidMs - this.estimate.offsetMs : null;
  }
}
