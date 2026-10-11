// Browser flow for the in-engine game UI: Connect Client, player count, Song Select, the
// song preview on its dance stage and Android pairing. Everything is drawn on the canvas,
// so it clicks design coordinates (the layout modules below) and reads the state each
// overlay reports on the canvas's data attributes. Run after `npm run build`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright';
import { bundleFixture } from './fixtures/songBundle.js';
import { BACK as MENU_BACK, ONE_PLAYER, SETTINGS, START, TWO_PLAYERS } from '../src/menu/layout.js';
import { KEYS, MODES, PILL, PRIMARY, MODEL_RECTS } from '../src/connect/layout.js';
import {
  BACK, DANCE, GAME_PAUSE, GAME_QUIT, GAME_RESUME, RESULTS_RETRY, rowRect,
} from '../src/game/layout.js';
import { resolveStage } from '../../packages/stages/catalog.js';

const app = express();
app.use(express.static('dist'));
const server = app.listen(4173, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const graphics = process.env.UI_GPU === '1'
  ? ['--enable-gpu', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', ...graphics],
});
// Middle of a layout rect, circle, or widget with a rect.
const center = (shape) => {
  const r = shape.rect ?? shape;
  return r.w === undefined ? { x: r.x, y: r.y } : { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};
const key = (k) => KEYS.find((entry) => entry.key === k);
let deviceServer;
let testPage;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  testPage = page;
  page.setDefaultTimeout(90000);
  await page.addInitScript(() => {
    window.webcamRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.webcamRequests++;
      throw new DOMException('Fixture permission denied', 'NotAllowedError');
    };
  });
  // Flow assertions exercise the real React/canvas event handlers. Skip GPU
  // rasterization in software-only containers; full visual runs opt in.
  if (process.env.UI_RENDER !== '1') await page.addInitScript(() => {
    for (const Type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Type) continue;
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        if (Type.prototype[name]) Type.prototype[name] = () => {};
      }
    }
  });
  let deviceRequests = 0;
  page.on('request', (request) => { if (new URL(request.url()).port === '1337') deviceRequests++; });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Keep empty-catalog coverage independent of installed authored songs.
  await page.route('**/songs/manifest.json', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ version: 1, songs: [] }),
  }));
  await page.goto('http://127.0.0.1:4173');
  await page.locator('canvas').waitFor();
  let frame = await page.locator('.canvas-frame').boundingBox();
  assert.equal(frame.height, 720);
  assert.equal(frame.y, 40);
  const click = async (shape) => {
    const p = center(shape);
    await page.mouse.click(frame.x + (p.x / 1600) * frame.width, frame.y + (p.y / 900) * frame.height);
  };
  const data = () => page.locator('canvas').evaluate((c) => ({ ...c.dataset }));
  // Waits until the canvas's reported state matches (values or regexps).
  const until = async (expected, timeout) => {
    const entries = Object.entries(expected).map(([k, v]) => [k, v instanceof RegExp ? { re: v.source } : { is: v }]);
    await page.waitForFunction((list) => {
      const d = document.querySelector('canvas')?.dataset;
      return d && list.every(([k, m]) => (m.re ? new RegExp(m.re).test(d[k] ?? '') : d[k] === m.is));
    }, entries, timeout ? { timeout } : undefined);
  };
  const menuOn = (screen) => until({ menuScreen: screen, menuReady: 'true' });
  const shot = async (name) => { if (process.env.UI_ARTIFACTS) await page.screenshot({ path: `${process.env.UI_ARTIFACTS}/${name}.png` }); };

  await page.waitForFunction(() => document.querySelector('canvas')?.style.opacity === '1', null, { timeout: 90000 });
  await menuOn('main');

  // Connect Client lives on Settings: remembered address, keyboard validation, the keypad, Escape.
  await click(SETTINGS);
  await menuOn('settings');
  await click(PILL);
  await until({ connectReady: 'true', connectAddress: '192.168.43.1', connectMessage: 'Ready to connect on port 1337.' });
  await page.keyboard.type('999');
  await page.keyboard.press('Enter');
  await until({ connectMessage: /Enter an IPv4 address/ });
  for (let i = 0; i < 16; i++) await page.keyboard.press('Backspace');
  for (const k of '127.0.0.1') await click(key(k));
  await until({ connectAddress: '127.0.0.1' });
  await click(key('Backspace'));
  await until({ connectAddress: '127.0.0.' });
  await page.keyboard.press('Escape');
  await until({ connectOpen: 'false' });
  assert.equal((await data()).menuScreen, 'settings', 'Escape closes only the card');
  await shot('settings');

  // Webcam selection/model controls do not request permission; Start handles denial.
  await click(PILL);
  await until({ connectReady: 'true' });
  await click(MODES[1]);
  await until({ connectMode: 'webcam', connectStatus: 'disconnected' });
  await click(MODEL_RECTS[1]);
  await until({ connectModel: 'full' });
  assert.equal(await page.evaluate(() => webcamRequests), 0);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  assert.equal((await data()).menuScreen, 'settings');
  await page.mouse.move(frame.x + 10, frame.y + 10);
  await click(PRIMARY);
  await until({ connectStatus: 'error', connectMessage: /permission was denied/ });
  assert.equal(await page.evaluate(() => webcamRequests), 1);
  await page.keyboard.press('Escape');
  await until({ connectOpen: 'false' });
  await click(MENU_BACK);
  await menuOn('main');
  await shot('main-menu');

  // Start -> One Player -> Song Select (empty catalog) -> Back keeps the player screen.
  await click(START);
  await menuOn('players');
  await shot('player-select');
  await click(ONE_PLAYER);
  await until({ songScreen: 'list', songReady: 'true', catalog: 'empty', songCount: '0', playerSlots: 'Connect Client' });
  await click(BACK);
  await menuOn('players');
  await click(TWO_PLAYERS);
  await until({ songScreen: 'list', songReady: 'true', catalog: 'empty', playerSlots: 'Connect Client|Connect Client' });
  assert.equal(deviceRequests, 0, 'Webcam must not contact Android');
  await shot('song-select');

  // Keyboard: Escape leaves Song Select, arrows and Enter pick Two Players again.
  await page.mouse.move(frame.x + 10, frame.y + 10);
  await page.keyboard.press('Escape');
  await menuOn('players');
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter']) await page.keyboard.press(k);
  await until({ songScreen: 'list', songReady: 'true', playerSlots: 'Connect Client|Connect Client' });

  // The letterboxed frame on a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator('.canvas-frame').boundingBox();
  assert.equal(mobile.width, 390);
  assert.ok(Math.abs(mobile.height - (390 * 9) / 16) < 1);
  await shot('song-select-mobile');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  frame = await page.locator('.canvas-frame').boundingBox();

  // Installed exports through the built catalog and the real HTTP assets, in both modes,
  // each opening on its own stage.
  await page.unroute('**/songs/manifest.json');
  const installed = JSON.parse(await readFile('dist/songs/manifest.json', 'utf8'));
  const openSong = async (count, index) => {
    await click(BACK);
    await menuOn('players');
    await click(count === 1 ? ONE_PLAYER : TWO_PLAYERS);
    await until({ songScreen: 'list', songReady: 'true', catalog: 'ready' });
    await click(rowRect(index));
  };
  for (const [i, song] of installed.songs.slice(0, 4).entries()) {
    for (const count of [1, 2]) {
      if (!song.supportedPlayerCounts.includes(count)) continue;
      await openSong(count, i);
      // The preview plays by itself.
      await until({ songScreen: 'preview', songReady: 'true', previewState: 'playing', stage: resolveStage(song.stage), stageReady: 'true' });
      await page.waitForFunction(() => Number(document.querySelector('canvas').dataset.previewTimeMs) > 150);
      await shot(`preview-${count}p`);
      await click(BACK);
      await until({ songScreen: 'list', songReady: 'true', stage: '' });
    }
  }

  // Private fixtures cover the exact playable range and song stages, apart from authored music.
  const serveFixture = async (stage) => {
    const fixture = bundleFixture();
    if (stage) fixture.song.stage = stage;
    const files = new Map([['song.json', Buffer.from(JSON.stringify(fixture.song))], ['choreography.json', Buffer.from(JSON.stringify(fixture.choreography))], ['audio.wav', Buffer.from(fixture.audio)]]);
    files.set('checksums.json', Buffer.from(JSON.stringify({ schema: 'aerodance.checksums', schemaVersion: 1, files: [...files].map(([path, body]) => ({ path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') })) })));
    const entry = { ...fixture.entry, sha256: createHash('sha256').update(files.get('song.json')).digest('hex'), ...(stage ? { stage } : {}) };
    await page.unroute('**/songs/**');
    await page.route('**/songs/**', async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      const body = name === 'manifest.json' ? Buffer.from(JSON.stringify({ version: 1, songs: [entry] })) : files.get(name);
      await route.fulfill({ status: body ? 200 : 404, contentType: name === 'audio.wav' ? 'audio/wav' : 'application/json', body: body ?? 'missing' });
    });
  };
  await serveFixture();
  for (const count of [1, 2]) {
    await openSong(count, 0);
    await until({ songScreen: 'preview', songReady: 'true', previewState: 'playing', stage: 'openreef', stageReady: 'true' });
    // It plays the playable range (100–900 ms) and loops back to its start.
    await page.waitForFunction(() => Number(document.querySelector('canvas').dataset.previewTimeMs) > 700);
    await page.waitForFunction(() => Number(document.querySelector('canvas').dataset.previewTimeMs) < 500);
    await until({ previewState: 'playing' });
    await click(BACK);
    await until({ songScreen: 'list', songReady: 'true', stage: '' });
  }

  // A song dances on its own stage (picked in Dance Studio); players can't change it.
  await serveFixture('club');
  await openSong(1, 0);
  await until({ songScreen: 'preview', songReady: 'true', stage: 'club', stageReady: 'true' });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  assert.equal((await data()).stage, 'club');
  await click(BACK);
  await until({ songScreen: 'list', songReady: 'true', stage: '' });
  await click(rowRect(0));
  await until({ songScreen: 'preview', songReady: 'true', stage: 'club', stageReady: 'true' });
  await click(BACK);
  await until({ songScreen: 'list', stage: '' });
  // A stage this build doesn't know falls back to Open Reef.
  await serveFixture('moon-base');
  await openSong(1, 0);
  await until({ songScreen: 'preview', songReady: 'true', stage: 'openreef', stageReady: 'true' });
  await click(BACK);
  await until({ songScreen: 'list', stage: '' });

  // A fake Android device: camera startup, first-pose readiness, disconnect and cancel.
  const device = express();
  device.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', 'http://127.0.0.1:4173');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  device.use(express.json());
  let mode = 2;
  let seq = 0;
  let ready = false;
  let closed;
  device.get('/v1/status', (_req, res) => res.json({ protocolVersion: 2, sessionId: 'startup-fixture', pipelineState: 'running', capabilities: { supportedPlayerCounts: [1, 2], poseModel: 'fixture' } }));
  device.post('/v1/config', (req, res) => { mode = req.body.playerCount; res.json({ playerCount: mode, sessionId: 'startup-fixture', effectiveFromSeq: seq + 1 }); });
  device.get('/v1/stream', (req, res) => {
    ready = false;
    res.type('application/x-ndjson');
    res.flushHeaders();
    let release;
    closed = new Promise((resolve) => { release = resolve; });
    const timer = setInterval(() => {
      const now = Math.round(performance.now());
      const record = ready ? {
        protocolVersion: 2, type: 'pose', sessionId: 'startup-fixture', seq: ++seq, playerCount: mode,
        frameReceivedTimeMs: now, resultTimeMs: now + 20, input: { width: 640, height: 480, mirrored: false },
        poses: Array.from({ length: mode }, (_, playerId) => ({ playerId, landmarks: Array.from({ length: 33 }, () => ({ x: 0.25 + playerId * 0.5, y: 0.5, z: 0, visibility: 1, presence: 1 })) })),
      } : { protocolVersion: 2, type: 'heartbeat', sessionId: 'startup-fixture', producerTimeMs: now, lastPoseSeq: seq || null, pipelineState: 'starting' };
      res.write(`${JSON.stringify(record)}\n`);
    }, 100);
    req.on('close', () => { clearInterval(timer); release(); });
  });
  deviceServer = device.listen(1337, '127.0.0.1');
  await new Promise((resolve) => deviceServer.once('listening', resolve));
  await openSong(2, 0);
  await until({ songScreen: 'preview', songReady: 'true' });
  await click(BACK);
  await until({ songScreen: 'list', songReady: 'true' });
  // Connect Client from Settings, with two players picked.
  const openConnect = async () => {
    await click(BACK);
    await menuOn('players');
    await click(MENU_BACK);
    await menuOn('main');
    await click(SETTINGS);
    await menuOn('settings');
    await click(PILL);
    await until({ connectReady: 'true' });
  };
  await openConnect();
  await click(MODES[0]);
  await until({ connectMode: 'android', connectStatus: 'disconnected' });
  for (let i = 0; i < 16; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('127.0.0.1');
  await page.keyboard.press('Enter');
  await until({ connectStatus: 'initializing', connectMessage: /90 seconds/ }, 10000);
  ready = true;
  await until({ connectStatus: 'connected' }, 10000);
  // Both players are tracked once Song Select is back up.
  await page.keyboard.press('Escape');
  await until({ connectOpen: 'false' });
  await click(MENU_BACK);
  await menuOn('main');
  await click(START);
  await menuOn('players');
  await click(TWO_PLAYERS);
  await until({ songScreen: 'list', songReady: 'true', playerSlots: 'Detected|Detected' }, 10000);
  await shot('android-connected');
  await openConnect();
  await click(PRIMARY); // Disconnect
  await closed;
  await until({ connectStatus: 'disconnected' }, 5000);
  await click(PRIMARY); // Connect
  await until({ connectStatus: 'initializing' }, 10000);
  await click(PRIMARY); // Cancel connection
  await closed;
  await until({ connectStatus: 'disconnected' }, 5000);

  // A whole song with the autoplay ghost (?input=ghost): ready check, countdown, pause and
  // resume, scoring, results, Play again and back to Song Select.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('http://127.0.0.1:4173/?input=ghost');
  await page.locator('canvas').waitFor();
  await page.waitForFunction(() => document.querySelector('canvas')?.style.opacity === '1', null, { timeout: 90000 });
  frame = await page.locator('.canvas-frame').boundingBox();
  await menuOn('main');
  await click(START);
  await menuOn('players');
  await click(TWO_PLAYERS);
  await until({ songScreen: 'list', songReady: 'true', catalog: 'ready', playerSlots: 'Detected|Detected' }, 30000);
  await click(rowRect(0));
  await until({ songScreen: 'preview', songReady: 'true' }, 30000);
  await click(DANCE);
  // Both ghosts are tracked, so the countdown starts by itself.
  await until({ gamePhase: 'countdown' }, 30000);
  await until({ gamePhase: 'playing' }, 10000);
  await page.waitForTimeout(2000);
  await click(GAME_PAUSE);
  await until({ gamePhase: 'paused' }, 5000);
  const pausedAt = Number((await data()).gameTimeMs);
  await page.waitForTimeout(1000);
  assert.equal(Number((await data()).gameTimeMs), pausedAt, 'the song holds while paused');
  await click(GAME_RESUME);
  await until({ gamePhase: 'countdown' }, 5000);
  await until({ gamePhase: 'playing' }, 10000);
  await shot('game-playing');
  await until({ gamePhase: 'results' }, 90000);
  await shot('game-results');
  const scores = (await data()).gameScores.split('|').map(Number);
  assert.equal(scores.length, 2);
  for (const score of scores) assert.ok(score > 850000, `the ghost copies the routine: ${score}`);
  await click(RESULTS_RETRY);
  await until({ gamePhase: 'countdown' }, 30000);
  await click(GAME_PAUSE);
  await until({ gamePhase: 'paused' }, 5000);
  await click(GAME_QUIT);
  await until({ songScreen: 'list', songReady: 'true' }, 10000);
  assert.equal((await data()).gamePhase, undefined);
  assert.deepEqual(errors, []);
  console.log('Browser flow passed: Connect Client card (keypad, keyboard, validation, webcam models and permission denial), both player modes, Back and Escape, keyboard navigation, letterboxing, catalog, bundle loading, finite audio through the mixer, each song on its own stage, Android startup, first-pose readiness, disconnect, startup cancellation, a scored two-player song with the autoplay ghost (countdown, pause, resume, results, Play again, quit) and no runtime errors.');
} catch (error) {
  console.error(error);
  if (testPage) console.error(await testPage.locator('canvas').evaluate((c) => JSON.stringify(c.dataset)).catch(() => ''));
  throw error;
} finally {
  await browser.close();
  if (deviceServer) { deviceServer.closeAllConnections(); await new Promise((resolve) => deviceServer.close(resolve)); }
  await new Promise((resolve) => server.close(resolve));
}
