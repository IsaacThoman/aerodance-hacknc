/*
 * Maps the Android pose clock onto the browser's performance.now() clock from the pose stream
 * alone, with no extra requests.
 *
 * For each record, arrival (browser) less resultTimeMs (Android) is the clock offset plus that
 * record's network delay. Network delay is never negative, so the smallest value seen is the
 * offset plus the fastest delivery: a pose held back by Wi-Fi or arriving in a TCP burst only
 * raises its own value, never the estimate, and keeps its real frame spacing.
 *
 * The two clocks drift apart slowly. The estimate follows a falling offset at once, and may
 * rise by at most DRIFT_PPM of the elapsed time, enough for crystal drift and clock slewing
 * but too little for a stall to shift it noticeably (a 1 s stall moves it 0.2 ms).
 */

export const DRIFT_PPM = 200;

export class StreamClock {
  constructor() {
    this.offsetMs = null; // browser time minus Android time, plus the fastest delivery
    this.at = 0;
  }
  /** One record's Android result time and its browser arrival time. */
  observe(androidMs, browserMs) {
    const offset = browserMs - androidMs;
    if (!Number.isFinite(offset)) return;
    const ceiling = this.offsetMs === null ? Infinity : this.offsetMs + (browserMs - this.at) * DRIFT_PPM / 1e6;
    this.offsetMs = Math.min(offset, ceiling);
    this.at = browserMs;
  }
  /** An Android pose-clock time on the browser clock, or null before the first record. */
  toBrowser(androidMs) {
    return this.offsetMs === null ? null : androidMs + this.offsetMs;
  }
}
