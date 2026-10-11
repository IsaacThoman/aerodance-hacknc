import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRIFT_PPM, StreamClock } from '../src/pose/streamClock.js';

// Android's clock reads 50 s ahead of the browser's; the fastest delivery takes 4 ms.
const OFFSET = -50_000;

test('the estimate is the fastest delivery, and delayed records never raise it', () => {
  const clock = new StreamClock();
  assert.equal(clock.toBrowser(60_000), null);
  clock.observe(60_000, 10_000 + 30);
  assert.equal(clock.offsetMs, OFFSET + 30);
  clock.observe(60_100, 10_100 + 4);
  assert.equal(clock.offsetMs, OFFSET + 4);
  // A 500 ms stall: three poses arrive together.
  for (const [android, browser] of [[60_200, 10_700], [60_300, 10_701], [60_400, 10_702]]) clock.observe(android, browser);
  assert.ok(clock.offsetMs - (OFFSET + 4) < 0.2);
  assert.equal(Math.round(clock.toBrowser(60_200)), 10_204);
  assert.equal(Math.round(clock.toBrowser(60_400)), 10_404);
});

test('the estimate follows the clocks drifting either way', () => {
  for (const ppm of [-DRIFT_PPM / 2, DRIFT_PPM / 2]) {
    const clock = new StreamClock();
    // Five minutes of poses every 100 ms; one in five is delivered in the fastest 4 ms.
    for (let t = 0; t <= 300_000; t += 100) {
      const drift = t * ppm / 1e6;
      clock.observe(t - OFFSET, t + drift + (t % 500 ? 25 : 4));
    }
    const drift = 300_000 * ppm / 1e6;
    assert.ok(Math.abs(clock.offsetMs - (OFFSET + drift + 4)) < 1, `${ppm} ppm: ${clock.offsetMs}`);
  }
});

test('records without finite times are ignored', () => {
  const clock = new StreamClock();
  clock.observe(undefined, 10);
  assert.equal(clock.offsetMs, null);
  clock.observe(100, 110);
  clock.observe(Number.NaN, 0);
  assert.equal(clock.offsetMs, 10);
});
