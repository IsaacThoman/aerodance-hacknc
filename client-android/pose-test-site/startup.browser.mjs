import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright';

const app = express();
app.use(express.static('client-android/pose-test-site/dist'));
const server = app.listen(8081, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const device = express();
device.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', 'http://127.0.0.1:8081');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
device.use(express.json());
let ready = false, seq = 0, mode = 1, closed;
device.get('/v1/status', (_req, res) => res.json({ protocolVersion: 2, sessionId: 'fixture', pipelineState: 'running', capabilities: { supportedPlayerCounts: [1, 2], poseModel: 'pose_landmarker_lite', maxPoses: 2 } }));
device.post('/v1/config', (req, res) => { mode = req.body.playerCount; res.json({ playerCount: mode, sessionId: 'fixture', effectiveFromSeq: seq + 1 }); });
device.get('/v1/stream', (req, res) => {
  ready = false;
  res.type('application/x-ndjson'); res.flushHeaders();
  let release;
  closed = new Promise(resolve => { release = resolve; });
  const timer = setInterval(() => {
    const now = Math.round(performance.now());
    res.write(JSON.stringify(ready
      ? { protocolVersion: 2, type: 'pose', sessionId: 'fixture', seq: ++seq, playerCount: mode, frameReceivedTimeMs: now, resultTimeMs: now + 20, input: { width: 640, height: 480, mirrored: false }, poses: [] }
      : { protocolVersion: 2, type: 'heartbeat', sessionId: 'fixture', producerTimeMs: now, lastPoseSeq: seq || null, pipelineState: 'starting' }) + '\n');
  }, 100);
  req.on('close', () => { clearInterval(timer); release(); });
});
const deviceServer = device.listen(1337, '127.0.0.1');
await new Promise(resolve => deviceServer.once('listening', resolve));
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8081');
  await page.locator('#ip').fill('127.0.0.1');
  await page.locator('#connect').click();
  await page.waitForFunction(() => document.querySelector('#connection').textContent === 'Camera starting…');
  assert.match(await page.locator('#message').innerText(), /90 seconds/);
  ready = true;
  await page.waitForFunction(() => document.querySelector('#connection').textContent === 'Streaming');
  assert.equal(await page.locator('#presence').innerText(), 'No person');
  await page.locator('#disconnect').click(); await closed;
  assert.match(await page.locator('#message').innerText(), /stops capture/);
  await page.locator('#connect').click();
  await page.waitForFunction(() => document.querySelector('#connection').textContent === 'Camera starting…');
  await page.locator('#disconnect').click(); await closed;
  assert.equal(await page.locator('#connection').innerText(), 'Disconnected');
  assert.deepEqual(errors, []);
  console.log('Viewer startup flow passed: startup heartbeats, first empty pose readiness, reconnect and cancellation.');
} finally {
  await browser.close();
  deviceServer.closeAllConnections(); server.closeAllConnections();
  await Promise.all([new Promise(resolve => deviceServer.close(resolve)), new Promise(resolve => server.close(resolve))]);
}
