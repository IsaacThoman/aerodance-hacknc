// Browser flow for the in-engine game UI: Connect Client, player count, Song Select, the
// song preview on its dance stage and a scored song. Everything is drawn on the canvas,
// so it clicks design coordinates (the layout modules below) and reads the state each
// overlay reports on the canvas's data attributes. Run after `npm run build`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright';
import { bundleFixture, silentWav } from './fixtures/songBundle.js';
import { BACK as MENU_BACK, ONE_PLAYER, SETTINGS, START, TWO_PLAYERS } from '../src/menu/layout.js';
import { PILL, PRIMARY, MODEL_RECTS } from '../src/connect/layout.js';
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

  // Connect Client lives on Settings; Escape closes only the card.
  await click(SETTINGS);
  await menuOn('settings');
  await click(PILL);
  await until({ connectReady: 'true', connectStatus: 'disconnected' });
  await page.keyboard.press('Escape');
  await until({ connectOpen: 'false' });
  assert.equal((await data()).menuScreen, 'settings', 'Escape closes only the card');
  await shot('settings');

  // Camera and model controls do not request permission; Start handles denial.
  await click(PILL);
  await until({ connectReady: 'true' });
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
  const serveFixture = async (stage, fixture = bundleFixture()) => {
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

  // A whole song with the autoplay ghost (?input=ghost): ready check, countdown, pause and
  // resume, scoring, results, Play again and back to Song Select. The test routine's own
  // choreography plays over silence.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const routine = new URL('./fixtures/song-70c63c8e/', import.meta.url);
  const song = JSON.parse(await readFile(new URL('song.json', routine), 'utf8'));
  song.audio = { path: 'audio.wav', mimeType: 'audio/wav' };
  await serveFixture(null, {
    song,
    choreography: JSON.parse(await readFile(new URL('choreography.json', routine), 'utf8')),
    audio: silentWav(song.durationMs),
    entry: { id: song.songId, title: song.title, artist: song.artist, durationMs: song.durationMs, supportedPlayerCounts: song.supportedPlayerCounts, bundleRevision: song.bundleRevision, bundle: `${song.songId}/song.json` },
  });
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
  console.log('Browser flow passed: Connect Client card (webcam models and permission denial), both player modes, Back and Escape, keyboard navigation, letterboxing, catalog, bundle loading, finite audio through the mixer, each song on its own stage, a scored two-player song with the autoplay ghost (countdown, pause, resume, results, Play again, quit) and no runtime errors.');
} catch (error) {
  console.error(error);
  if (testPage) console.error(await testPage.locator('canvas').evaluate((c) => JSON.stringify(c.dataset)).catch(() => ''));
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
