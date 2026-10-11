import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AndroidPoseSource } from '../src/pose/AndroidPoseSource.js';

const info = { protocolVersion: 2, sessionId: 'session', pipelineState: 'running', capabilities: { supportedPlayerCounts: [1, 2], poseModel: 'synthetic' } };
const record = (seq, playerCount = 1, ids = [0]) => ({ protocolVersion: 2, type: 'pose', sessionId: 'session', seq, playerCount,
  frameReceivedTimeMs: 10, resultTimeMs: 20, input: { width: 640, height: 480, mirrored: false },
  poses: ids.map(playerId => ({ playerId, landmarks: Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1, presence: 1 })) })) });
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(t, configHandler) {
  let time = 0, output;
  const requests = [];
  const source = new AndroidPoseSource({ now: () => time, fetch: async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/v1/status')) return Response.json(info);
    if (url.endsWith('/v1/config')) {
      const count = JSON.parse(options.body).playerCount;
      return configHandler ? configHandler(count) : Response.json({ playerCount: count, sessionId: 'session', effectiveFromSeq: count === 1 ? 1 : 10 });
    }
    return new Response(new ReadableStream({
      start(controller) { output = controller; options.signal.addEventListener('abort', () => controller.error(new Error('Aborted')), { once: true }); },
    }));
  } });
  t.after(() => source.disconnect());
  return { source, requests, send: data => output.enqueue(new TextEncoder().encode(`${JSON.stringify(data)}\n`)), advance: value => { time = value; } };
}

test('switch waits for matching sequence/mode; right-only ID stays in player two', async t => {
  const h = harness(t);
  h.source.connect('192.168.43.1'); await tick();
  h.send(record(1)); await tick();
  assert.equal(h.source.view.snapshot.poses[0].playerId, 0);
  await h.source.setPlayerCount(2);
  assert.equal(h.source.view.snapshot, null);
  h.send(record(9)); await tick();
  assert.equal(h.source.view.snapshot, null);
  h.send(record(10, 2, [1])); await tick();
  assert.deepEqual(h.source.view.snapshot.poses.map(p => p.playerId), [1]);
  h.send(record(11, 2, [])); await tick();
  assert.deepEqual(h.source.view.snapshot.poses, []);
  assert.deepEqual(h.requests.filter(r => r.url.endsWith('/v1/config')).map(r => JSON.parse(r.options.body).playerCount), [1, 2]);
});

test('stale tracking clears even with a live heartbeat', async t => {
  const h = harness(t); h.source.connect('192.168.43.1'); await tick();
  h.send(record(1)); await tick(); h.advance(500);
  h.send({ protocolVersion: 2, type: 'heartbeat', sessionId: 'session', producerTimeMs: 500, lastPoseSeq: 1, pipelineState: 'running' }); await tick();
  assert.equal(h.source.view.status, 'connected');
  assert.equal(h.source.view.snapshot, null);
});

test('mode chosen during startup is configured before the stream opens', async t => {
  let finish;
  const h = harness(t, count => count === 1 ? new Promise(resolve => { finish = () => resolve(Response.json({ playerCount: 1, sessionId: 'session', effectiveFromSeq: 1 })); }) : Response.json({ playerCount: 2, sessionId: 'session', effectiveFromSeq: 10 }));
  h.source.connect('192.168.43.1'); await tick();
  await h.source.setPlayerCount(2); finish(); await tick();
  assert.equal(h.source.view.status, 'connected');
  assert.deepEqual(h.requests.filter(r => r.url.endsWith('/v1/config')).map(r => JSON.parse(r.options.body).playerCount), [1, 2]);
});

test('disconnect cancels pending startup without late state updates', async t => {
  let finish;
  const h = harness(t, () => new Promise(resolve => { finish = () => resolve(Response.json({ playerCount: 1, sessionId: 'session', effectiveFromSeq: 1 })); }));
  h.source.connect('192.168.43.1'); await tick();
  h.source.disconnect(); finish(); await tick();
  assert.equal(h.source.view.status, 'disconnected');
  assert.equal(h.source.view.snapshot, null);
  assert.equal(h.requests.some(r => r.url.endsWith('/v1/stream')), false);
});

test('initial network/permission failures require an explicit retry', async t => {
  let requests = 0;
  const source = new AndroidPoseSource({ fetch: async () => { requests++; throw Error('Failed to fetch'); } });
  t.after(() => source.disconnect()); source.connect('192.168.43.1'); await tick();
  assert.equal(source.view.status, 'error');
  assert.match(source.view.message, /allowed origin.*local-network permission/);
  assert.equal(requests, 1);
});

test('reconnect backoff is capped and stops after five failed reconnections', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let streams = 0;
  const source = new AndroidPoseSource({ now: () => 0, fetch: async url => {
    if (url.endsWith('/v1/status')) return Response.json(info);
    if (url.endsWith('/v1/config')) return Response.json({ playerCount: 1, sessionId: 'session', effectiveFromSeq: 1 });
    streams++;
    return new Response(new ReadableStream({ start(controller) { controller.close(); } }));
  } });
  t.after(() => source.disconnect());
  source.connect('192.168.43.1'); await tick();
  for (const delay of [1000, 2000, 4000, 8000, 8000]) {
    assert.equal(source.view.status, 'reconnecting');
    t.mock.timers.tick(delay - 1); await tick();
    const before = streams;
    t.mock.timers.tick(1); await tick();
    assert.equal(streams, before + 1);
  }
  assert.equal(streams, 6);
  assert.equal(source.view.status, 'error');
  t.mock.timers.tick(60000); await tick();
  assert.equal(streams, 6);
});
