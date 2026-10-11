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
test('record subscription captures accepted snapshots once and keeps heartbeat timing separate', async t => {
  const h = harness(t), records = [];
  const unsubscribe = h.source.subscribeRecords(envelope => records.push(envelope));
  h.source.connect('192.168.43.1'); await tick();
  h.send(record(1)); await tick();h.send(record(1)); await tick();
  h.advance(500);h.send({ protocolVersion: 2, type: 'heartbeat', sessionId: 'session', producerTimeMs: 500, lastPoseSeq: 1, pipelineState: 'running' });await tick();
  assert.equal(records.length,2);assert.equal(records[0].record.seq,1);assert.equal(records[1].receivedBrowserTimeMs,500);assert.equal(h.source.view.snapshot,null);
  unsubscribe();h.send(record(2));await tick();assert.equal(records.length,2);
});

test('mode chosen during startup is configured before the stream opens', async t => {
  let finish;
  const h = harness(t, count => count === 1 ? new Promise(resolve => { finish = () => resolve(Response.json({ playerCount: 1, sessionId: 'session', effectiveFromSeq: 1 })); }) : Response.json({ playerCount: 2, sessionId: 'session', effectiveFromSeq: 10 }));
  h.source.connect('192.168.43.1'); await tick();
  await h.source.setPlayerCount(2); finish(); await tick();
  assert.equal(h.source.view.status, 'initializing');
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

const heartbeat = (state = 'starting') => ({ protocolVersion: 2, type: 'heartbeat', sessionId: 'session',
  producerTimeMs: 100, lastPoseSeq: null, pipelineState: state });

test('on-demand startup stays initializing through heartbeats until the first empty or detected result', async t => {
  const h = harness(t);
  h.source.connect('192.168.43.1'); await tick();
  assert.equal(h.source.view.status, 'initializing');
  assert.match(h.source.view.message, /Starting camera.*90 seconds/);
  h.advance(35000); h.send(heartbeat()); await tick();
  h.send(heartbeat('running')); await tick();
  assert.equal(h.source.view.status, 'initializing');
  assert.equal(h.source.view.snapshot, null);
  assert.equal(h.requests.filter(r => r.url.endsWith('/v1/status')).length, 1);
  h.send(record(1, 1, [])); await tick();
  assert.equal(h.source.view.status, 'connected');
  assert.deepEqual(h.source.view.snapshot.poses, []);
  assert.match(h.source.view.message, /Camera ready/);
});

test('mode changes during initialization configure the open stream and preserve startup messaging', async t => {
  const h = harness(t);
  h.source.connect('192.168.43.1'); await tick();
  await h.source.setPlayerCount(2);
  assert.equal(h.source.view.status, 'initializing');
  assert.match(h.source.view.message, /Starting camera/);
  h.send(record(1)); await tick();
  assert.equal(h.source.view.status, 'initializing');
  h.send(record(10, 2, [])); await tick();
  assert.equal(h.source.view.status, 'connected');
  assert.equal(h.requests.filter(r => r.url.endsWith('/v1/stream')).length, 1);
});

test('heartbeats do not extend the 90-second initialization deadline; reconnect also waits for a pose', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = harness(t);
  h.source.connect('192.168.43.1'); await tick();
  for (let i = 0; i < 17; i++) {
    h.send(heartbeat()); await tick();
    t.mock.timers.tick(5000); await tick();
    assert.equal(h.source.view.status, 'initializing');
  }
  h.send(heartbeat('running')); await tick();
  t.mock.timers.tick(5000); await tick();
  assert.equal(h.source.view.status, 'reconnecting');
  assert.match(h.source.view.message, /initialization timed out after 90 seconds/);
  t.mock.timers.tick(1000); await tick();
  assert.equal(h.source.view.status, 'initializing');
  h.send(heartbeat()); await tick();
  assert.equal(h.source.view.status, 'initializing');
  h.send(record(1)); await tick();
  assert.equal(h.source.view.status, 'connected');
  t.mock.timers.tick(90000); await tick();
  assert.equal(h.source.view.status, 'connected');
});

test('disconnect cancels an open initializing stream and its timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = harness(t);
  h.source.connect('192.168.43.1'); await tick();
  h.send(heartbeat()); await tick();
  const attempt = h.source.attempt;
  h.source.disconnect(); await tick();
  assert.equal(attempt.signal.aborted, true);
  t.mock.timers.tick(95000); await tick();
  assert.equal(h.source.view.status, 'disconnected');
  assert.equal(h.requests.filter(r => r.url.endsWith('/v1/stream')).length, 1);
});
