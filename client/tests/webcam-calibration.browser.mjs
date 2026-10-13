// Run after npm run build. Real MediaPipe and a synthetic camera, with a private song fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { chromium } from 'playwright';
import { bundleFixture } from './fixtures/songBundle.js';
import { PILL, PRIMARY } from '../src/connect/layout.js';
import { BACK as MENU_BACK, SETTINGS, START, TWO_PLAYERS } from '../src/menu/layout.js';
import { DANCE, GAME_READY_START, RESULTS_RETRY, rowRect } from '../src/game/layout.js';

const fixture = bundleFixture();
const files = new Map([
  ['song.json', Buffer.from(JSON.stringify(fixture.song))],
  ['choreography.json', Buffer.from(JSON.stringify(fixture.choreography))],
  ['audio.wav', Buffer.from(fixture.audio)],
]);
files.set('checksums.json', Buffer.from(JSON.stringify({ schema: 'aerodance.checksums', schemaVersion: 1,
  files: [...files].map(([path, body]) => ({ path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') })),
})));
const app = express();
app.get('/pose-fixture.jpg', (_req, res) => res.sendFile(path.resolve('client/tests/fixtures/mediapipe-pose.jpg')));
app.get('/songs/manifest.json', (_req, res) => res.json({ version: 1, songs: [fixture.entry] }));
app.get('/songs/fixture/:file', (req, res) => {
  const body = files.get(req.params.file);
  if (!body) return res.sendStatus(404);
  res.type(req.params.file.endsWith('.wav') ? 'audio/wav' : 'application/json').send(body);
});
app.use(express.static('dist'));
const server = app.listen(4182, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(({ render }) => {
    if (!render) for (const Type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Type) continue;
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        if (Type.prototype[name]) Type.prototype[name] = () => {};
      }
    }
    window.cameraVisible = false;
    Object.defineProperty(navigator, 'mediaDevices', { value: {
      enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'fixture-camera', label: 'Fixture camera' }],
      getUserMedia: async () => {
        const image = new Image(); image.src = '/pose-fixture.jpg'; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
        const g = canvas.getContext('2d'); let count = 0;
        const draw = () => {
          g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 480);
          if (!window.cameraVisible) return;
          const offset = Math.sin(count++ / 20) * 2;
          g.drawImage(image, 200, 0, 600, 667, offset, 40, 320, 356);
          g.drawImage(image, 200, 0, 600, 667, 320 + offset, 40, 320, 356);
        };
        draw(); const stream = canvas.captureStream(20), timer = setInterval(draw, 50);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { clearInterval(timer); stop(); };
        }
        return stream;
      },
    } });
  }, { render: process.env.UI_RENDER === '1' });
  await page.goto('http://127.0.0.1:4182');
  const click = async shape => {
    const r = shape.rect ?? shape, frame = await page.locator('.canvas-frame').boundingBox();
    await page.mouse.click(frame.x + (r.x + (r.w || 0) / 2) / 1600 * frame.width,
      frame.y + (r.y + (r.h || 0) / 2) / 900 * frame.height);
  };
  const until = (key, value) => page.waitForFunction(([key, value]) => document.querySelector('canvas')?.dataset[key] === value, [key, value]);
  await until('menuReady', 'true'); await click(SETTINGS); await until('menuScreen', 'settings'); await until('menuReady', 'true');
  await click(PILL); await until('connectReady', 'true');
  await click(PRIMARY); await until('connectStatus', 'connected');
  await page.keyboard.press('Escape'); await until('connectOpen', 'false');
  await click(MENU_BACK); await until('menuScreen', 'main'); await until('menuReady', 'true');
  await click(START); await until('menuScreen', 'players'); await until('menuReady', 'true');
  await click(TWO_PLAYERS); await until('songReady', 'true'); await click(rowRect(0));
  await until('previewState', 'playing'); await until('stageReady', 'true');

  await click(DANCE); await until('gamePhase', 'calibrating'); await until('gameCalibrationPreview', 'true');
  await until('gameCalibrationPlayers', 'missing|missing');
  await click(GAME_READY_START); await page.waitForTimeout(400);
  assert.equal(await page.locator('canvas').getAttribute('data-game-phase'), 'calibrating', 'the old Start now position cannot bypass calibration');
  await page.keyboard.press('Escape'); await until('songReady', 'true'); await until('songScreen', 'list');
  await click(rowRect(0)); await until('previewState', 'playing'); await until('stageReady', 'true');

  await click(DANCE); await until('gamePhase', 'calibrating');
  if (process.env.UI_ARTIFACTS) await page.screenshot({ path: `${process.env.UI_ARTIFACTS}/webcam-calibration.png` });
  await page.evaluate(() => { cameraVisible = true; });
  await page.waitForFunction(() => Number(document.querySelector('canvas').dataset.gameCalibrationProgress) > 0.15);
  await page.evaluate(() => { cameraVisible = false; });
  await until('gameCalibrationPlayers', 'missing|missing'); await until('gameCalibrationProgress', '0.000');
  const freshHoldStart = await page.evaluate(() => { cameraVisible = true; return performance.now(); });
  await until('gamePhase', 'countdown');
  assert.ok(await page.evaluate(() => performance.now()) - freshHoldStart >= 2500, 'fresh full-body evidence must span 2.5 seconds');
  await until('gamePhase', 'playing'); await until('gamePhase', 'results');
  await page.evaluate(() => { cameraVisible = false; });
  await click(RESULTS_RETRY); await until('gamePhase', 'calibrating'); await until('gameCalibrationProgress', '0.000');
  await page.keyboard.press('Escape'); await until('songReady', 'true');
  assert.deepEqual(errors, []);
  console.log('Webcam calibration passed: real two-player tracking, required hold, preview, Back, tracking-loss reset, countdown, gameplay, fresh calibration on retry.');
} catch (error) {
  console.error('Game state:', await page.locator('canvas').evaluate(c => JSON.stringify(c.dataset)).catch(() => ''));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
