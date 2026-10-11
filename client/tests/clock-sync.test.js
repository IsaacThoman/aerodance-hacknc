import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClockSync, estimateOffset, measureExchange } from '../src/pose/clockSync.js';
import { AndroidPoseSource, CAPTURE_DELAY_MS } from '../src/pose/AndroidPoseSource.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('an exchange measures offset and round trip, and rejects impossible ones', () => {
  // Android is 5000 ms ahead; 10 ms out, 2 ms on the device, 20 ms back.
  assert.deepEqual(measureExchange({ b0: 100, a1: 5110, a2: 5112, b3: 132 }), { offsetMs: 4995, roundTripMs: 30, at: 132 });
  assert.equal(measureExchange({ b0: 100, a1: 5110, a2: 5100, b3: 132 }), null);
  assert.equal(measureExchange({ b0: 100, a1: 5110, a2: 5112, b3: 90 }), null);
  assert.equal(measureExchange({ b0: 100, a1: 5000, a2: 5100, b3: 150 }), null);
});

test('the estimate trusts the fastest exchanges and reports half their round trip', () => {
  const samples = [
    { offsetMs: 1000, roundTripMs: 8 },
    { offsetMs: 1002, roundTripMs: 10 },
    { offsetMs: 1001, roundTripMs: 9 },
    { offsetMs: 1300, roundTripMs: 400 }, // a delayed exchange
    { offsetMs: 900, roundTripMs: 300 },
    { offsetMs: 1100, roundTripMs: 120 },
  ];
  const e = estimateOffset(samples);
  assert.equal(e.offsetMs, 1000.5);
  assert.equal(e.uncertaintyMs, 4);
  assert.equal(estimateOffset([]), null);
});

function androidClock({ offsetMs, sessionId = 'session', delays = [] }) {
  let browser = 0;
  let i = 0;
  const request = async (url) => {
    assert.ok(url.endsWith('/v1/time'));
    const [out, back] = delays[i++ % delays.length] ?? [5, 5];
    browser += out;
    const a1 = browser + offsetMs;
    browser += 1;
    const a2 = browser + offsetMs;
    browser += back;
    return Response.json({ protocolVersion: 2, sessionId, receivedTimeMs: a1, sentTimeMs: a2 });
  };
  return { request, now: () => browser };
}

test('ClockSync converges on the true offset despite asymmetric, delayed exchanges', async () => {
  const fake = androidClock({ offsetMs: 123456, delays: [[5, 5], [40, 4], [6, 6], [4, 90], [5, 6], [7, 5], [80, 80], [5, 5]] });
  const clock = new ClockSync({ ...fake, base: 'http://x:1337', sessionId: 'session' });
  const estimate = await clock.run(8);
  clock.stop();
  assert.ok(Math.abs(estimate.offsetMs - 123456) <= 1, `offset ${estimate.offsetMs}`);
  assert.equal(clock.toBrowser(123456 + 500), 500 - (estimate.offsetMs - 123456));
});

test('ClockSync ignores replies from a different Android session', async () => {
  const fake = androidClock({ offsetMs: 10, sessionId: 'other' });
  const clock = new ClockSync({ ...fake, base: 'http://x:1337', sessionId: 'session' });
  assert.equal(await clock.run(3), null);
  assert.equal(clock.toBrowser(100), null);
});

const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1, presence: 1 }));
const pose = (seq, frame) => ({ protocolVersion: 2, type: 'pose', sessionId: 'session', seq, playerCount: 1,
  frameReceivedTimeMs: frame, resultTimeMs: frame + 120, input: { width: 640, height: 480, mirrored: false }, poses: [{ playerId: 0, landmarks }] });

function device(t, { timeSync }) {
  let time = 1000;
  let output;
  const OFFSET = 50_000; // Android clock = browser clock + 50 s
  const source = new AndroidPoseSource({ now: () => time, fetch: async (url, options) => {
    if (url.endsWith('/v1/status')) return Response.json({ protocolVersion: 2, sessionId: 'session', pipelineState: 'running', capabilities: { supportedPlayerCounts: [1, 2], poseModel: 'lite', timeSync } });
    if (url.endsWith('/v1/config')) return Response.json({ playerCount: 1, sessionId: 'session', effectiveFromSeq: 1 });
    if (url.endsWith('/v1/time')) {
      time += 3;
      const a1 = time + OFFSET;
      time += 3;
      return Response.json({ protocolVersion: 2, sessionId: 'session', receivedTimeMs: a1, sentTimeMs: a1 });
    }
    return new Response(new ReadableStream({
      start(controller) { output = controller; options.signal.addEventListener('abort', () => controller.error(new Error('Aborted')), { once: true }); },
    }));
  } });
  t.after(() => source.disconnect());
  return { source, OFFSET, send: (r) => output.enqueue(new TextEncoder().encode(`${JSON.stringify(r)}\n`)), setTime: (v) => { time = v; } };
}

test('with timeSync, poses are placed at their capture time on the browser clock', async (t) => {
  const d = device(t, { timeSync: true });
  const records = [];
  d.source.subscribeRecords((e) => records.push(e));
  d.source.connect('192.168.43.1');
  for (let i = 0; i < 30 && d.source.view.timing.method !== 'clock-sync'; i++) await tick();
  assert.equal(d.source.view.timing.method, 'clock-sync');
  d.setTime(5000);
  d.send(pose(1, 4800 + d.OFFSET));
  await tick();
  assert.equal(records[0].timing.method, 'clock-sync');
  assert.equal(records[0].captureBrowserTimeMs, 4800 - CAPTURE_DELAY_MS);
});

test('without timeSync, capture time is estimated from arrival less processing time', async (t) => {
  const d = device(t, { timeSync: undefined });
  const records = [];
  d.source.subscribeRecords((e) => records.push(e));
  d.source.connect('192.168.43.1');
  await tick(); await tick();
  d.setTime(5000);
  d.send(pose(1, 77));
  await tick();
  assert.equal(records[0].timing.method, 'receipt-estimate');
  // 120 ms of Android processing, 15 ms of network, the camera's own delay.
  assert.equal(records[0].captureBrowserTimeMs, 5000 - 120 - 15 - CAPTURE_DELAY_MS);
});
