import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { bundleFixture } from './fixtures/songBundle.js';
import express from 'express';
import { chromium } from 'playwright';

const app = express();
app.use(express.static('dist'));
const server = app.listen(4173, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const graphics = process.env.UI_GPU === '1'
  ? ['--enable-gpu', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args: ['--no-sandbox', ...graphics] });
let deviceServer, testPage;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  testPage = page;
  page.setDefaultTimeout(90000);
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
  page.on('request', request => { if (new URL(request.url()).port === '1337') deviceRequests++; });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Keep empty-catalog coverage independent of installed authored songs.
  await page.route('**/songs/manifest.json', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ version: 1, songs: [] }),
  }));
  await page.goto('http://127.0.0.1:4173');
  await page.locator('canvas').waitFor();
  const frame = await page.locator('.canvas-frame').boundingBox();
  assert.equal(frame.height, 720);
  assert.equal(frame.y, 40);
  const clickDesign = async (x, y) => { await page.mouse.click(frame.x + x / 1600 * frame.width, frame.y + y / 900 * frame.height); };
  await page.waitForFunction(() => document.querySelector('canvas')?.style.opacity === '1', null, { timeout: 90000 });
  await page.locator('canvas[data-menu-screen="main"][data-menu-ready="true"]').waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Connect Client', exact: true }).click();
  assert.equal(await page.getByLabel('Android IP address').inputValue(), '192.168.43.1');
  assert.match(await page.locator('.connection-form').innerText(), /http:\/\/127.0.0.1:4173/);
  await page.getByLabel('Android IP address').fill('bad-address');
  await page.getByRole('button', { name: 'Ok', exact: true }).click();
  await page.getByText('Enter an IPv4 address', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Client', exact: true }).click();
  await page.getByLabel('Client type').selectOption('webcam');
  await page.getByLabel('Client type').press('ArrowDown');
  await page.getByLabel('Client type').press('Enter');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('canvas').getAttribute('data-menu-screen'), 'main');
  await page.getByText('Webcam capture and tracking are not implemented yet.', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Android IP address').count(), 0);
  await page.getByRole('button', { name: 'Ok', exact: true }).click();
  await page.getByRole('button', { name: 'Webcam · Dummy' }).waitFor();
  if (process.env.UI_ARTIFACTS) await page.screenshot({ path: `${process.env.UI_ARTIFACTS}/main-menu.png` });
  await clickDesign(350, 542); // Start
  await page.locator('canvas[data-menu-screen="players"][data-menu-ready="true"]').waitFor({ timeout: 90000 });
  if (process.env.UI_ARTIFACTS) await page.screenshot({ path: `${process.env.UI_ARTIFACTS}/player-select.png` });
  await clickDesign(350, 598); // One Player
  await page.getByRole('heading', { name: 'Song Select' }).waitFor();
  assert.equal(await page.locator('.player-slot').count(), 1);
  assert.equal(await page.getByText('Preview ready', { exact: true }).count(), 1);
  await page.getByText('The first routine is on its way').waitFor();
  assert.equal(await page.getByRole('link', { name: /captured dance preview/ }).getAttribute('href'), '/dance/');
  await page.getByRole('button', { name: 'Back', exact: false }).click();
  await page.locator('canvas[data-menu-screen="players"][data-menu-ready="true"]').waitFor({ timeout: 90000 });
  await clickDesign(350, 714); // Two Players; Back preserves player-selection screen.
  await page.getByRole('heading', { name: 'Song Select' }).waitFor();
  assert.equal(await page.locator('.player-slot').count(), 2);
  assert.equal(await page.getByText('Preview ready', { exact: true }).count(), 2);

  assert.equal(deviceRequests, 0, 'Webcam dummy must not contact Android');
  // Keep the dummy path independent of Android; exercise live startup below.
  await page.getByRole('button', { name: 'Webcam · Dummy', exact: true }).click();
  await page.getByLabel('Client type').selectOption('android');
  await page.getByLabel('Android IP address').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connect Client', exact: true }).count(), 1);
  await page.getByLabel('Client type').selectOption('webcam');
  await page.getByRole('button', { name: 'Ok', exact: true }).click();
  assert.equal(await page.getByText('Preview ready', { exact: true }).count(), 2);
  assert.equal(deviceRequests, 0);
  if (process.env.UI_ARTIFACTS) await page.screenshot({ path: `${process.env.UI_ARTIFACTS}/song-select.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator('.canvas-frame').boundingBox();
  assert.equal(mobile.width, 390);
  assert.ok(Math.abs(mobile.height - 390 * 9 / 16) < 1);
  const panel = await page.locator('.song-select').boundingBox();
  assert.ok(panel.x >= mobile.x && panel.y >= mobile.y && panel.y + panel.height <= mobile.y + mobile.height);
  if (process.env.UI_ARTIFACTS) await page.screenshot({ path: `${process.env.UI_ARTIFACTS}/song-select-mobile.png` });
  await page.getByRole('button', { name: 'Webcam · Dummy', exact: true }).click();
  const connectionPanel = await page.locator('.connection-form').boundingBox();
  assert.ok(connectionPanel.y >= mobile.y && connectionPanel.y + connectionPanel.height <= mobile.y + mobile.height);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.setViewportSize({ width:1280, height:800 });
  // Load installed exports through the built catalog and actual HTTP assets.
  await page.unroute('**/songs/manifest.json');
  const installed = JSON.parse(await readFile('dist/songs/manifest.json', 'utf8'));
  for (const song of installed.songs) {
    for (const [count, y] of [[1,598],[2,714]]) {
      if (!song.supportedPlayerCounts.includes(count)) continue;
      await page.getByRole('button', { name:'Back', exact:false }).click();
      await page.locator('canvas[data-menu-screen="players"][data-menu-ready="true"]').waitFor();
      await clickDesign(350, y);
      await page.locator('.song-list button').filter({ hasText: song.title }).click();
      await page.getByRole('heading', { name: song.title, exact: true }).waitFor();
      await page.getByText(`${count} player preview`, { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 2);
      await page.locator('audio').evaluate(a => a.play());
      await page.waitForFunction(() => {
        const a = document.querySelector('audio'); return !a.paused && a.currentTime > .1;
      });
      assert.equal(await page.getByRole('alert').count(), 0);
      await page.getByRole('button', { name:'Songs', exact:false }).click();
      assert.equal(await page.locator('audio').count(), 0);
    }
  }
  // Private fixtures cover exact playable boundaries independently of authored music.
  const fixture = bundleFixture();
  const files = new Map([['song.json',Buffer.from(JSON.stringify(fixture.song))],['choreography.json',Buffer.from(JSON.stringify(fixture.choreography))],['audio.wav',Buffer.from(fixture.audio)]]);
  files.set('checksums.json',Buffer.from(JSON.stringify({schema:'aerodance.checksums',schemaVersion:1,files:[...files].map(([path,body])=>({path,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')}))})));
  await page.route('**/songs/**',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1);
    const body=name==='manifest.json'?Buffer.from(JSON.stringify({version:1,songs:[fixture.entry]})):files.get(name);
    await route.fulfill({status:body?200:404,contentType:name==='audio.wav'?'audio/wav':'application/json',body:body??'missing'});
  });
  for (const [count,y] of [[1,598],[2,714]]) {
    await page.getByRole('button', {name:'Back',exact:false}).click();
    await page.locator('canvas[data-menu-screen="players"][data-menu-ready="true"]').waitFor();
    await clickDesign(350,y);
    await page.getByRole('button', {name:/Fixture routine/}).click();
    await page.getByRole('heading', {name:'Fixture routine'}).waitFor();
    await page.getByText(`${count} player preview`,{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=2);
    assert.ok(Math.abs(await page.locator('audio').evaluate(a=>a.currentTime)-.1)<.001);
    assert.ok(Math.abs(await page.locator('audio').evaluate(a=>a.volume)-.64)<.001);
    await page.locator('audio').evaluate(a=>a.play());
    await page.waitForFunction(()=>{const a=document.querySelector('audio');return a.paused&&a.currentTime>=.899;});
    assert.ok(await page.locator('audio').evaluate(a=>a.currentTime<=.901));
    await page.getByRole('button', {name:'Songs',exact:false}).click();
    assert.equal(await page.locator('audio').count(),0);
  }
  const device = express();
  device.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', 'http://127.0.0.1:4173');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  device.use(express.json());
  let mode = 2, seq = 0, ready = false, closed;
  device.get('/v1/status', (_req, res) => res.json({ protocolVersion: 2, sessionId: 'startup-fixture', pipelineState: 'running', capabilities: { supportedPlayerCounts: [1, 2], poseModel: 'fixture' } }));
  device.post('/v1/config', (req, res) => { mode = req.body.playerCount; res.json({ playerCount: mode, sessionId: 'startup-fixture', effectiveFromSeq: seq + 1 }); });
  device.get('/v1/stream', (req, res) => {
    ready = false;
    res.type('application/x-ndjson'); res.flushHeaders();
    let release;
    closed = new Promise(resolve => { release = resolve; });
    const timer = setInterval(() => {
      const now = Math.round(performance.now());
      const record = ready ? { protocolVersion: 2, type: 'pose', sessionId: 'startup-fixture', seq: ++seq, playerCount: mode,
        frameReceivedTimeMs: now, resultTimeMs: now + 20, input: { width: 640, height: 480, mirrored: false },
        poses: Array.from({ length: mode }, (_, playerId) => ({ playerId, landmarks: Array.from({ length: 33 }, () => ({ x: .25 + playerId * .5, y: .5, z: 0, visibility: 1, presence: 1 })) })) }
        : { protocolVersion: 2, type: 'heartbeat', sessionId: 'startup-fixture', producerTimeMs: now, lastPoseSeq: seq || null, pipelineState: 'starting' };
      res.write(JSON.stringify(record) + '\n');
    }, 100);
    req.on('close', () => { clearInterval(timer); release(); });
  });
  deviceServer = device.listen(1337, '127.0.0.1');
  await new Promise(resolve => deviceServer.once('listening', resolve));
  page.setDefaultTimeout(5000);
  await page.getByRole('button', { name: 'Webcam · Dummy', exact: true }).click();
  await page.getByLabel('Client type').selectOption('android');
  await page.getByLabel('Android IP address').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Ok', exact: true }).click();
  await page.getByRole('button', { name: 'Camera starting…', exact: true }).waitFor();
  assert.match(await page.locator('.connection-message').innerText(), /90 seconds/);
  assert.equal(await page.locator('.player-slot strong').filter({ hasText: 'Camera starting…' }).count(), 2);
  ready = true;
  await page.getByRole('button', { name: 'Client Connected', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.player-slot strong')].every(el => el.textContent === 'Detected'));
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click(); await closed;
  await page.waitForFunction(() => document.querySelector('.connect-toggle')?.textContent.includes('Connect Client'), null, { timeout: 5000 });
  if (!await page.locator('.connection-form').isVisible()) await page.getByRole('button', { name: 'Connect Client', exact: true }).click();
  await page.getByRole('button', { name: 'Ok', exact: true }).click({ timeout: 5000 });
  await page.getByRole('button', { name: 'Camera starting…', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click(); await closed;
  assert.equal(await page.getByRole('button', { name: 'Connect Client', exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log('Browser flow passed: pairing controls, webcam dummy, IP validation, both player modes, Back, catalog, source switching, letterboxing, bundle loading, both preview modes, finite audio, Android startup, first-pose readiness, disconnect, startup cancellation, cleanup, and no runtime errors.');
} catch (error) {
  console.error(error);
  if (testPage) console.error(await testPage.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
  if (deviceServer) { deviceServer.closeAllConnections(); await new Promise(resolve => deviceServer.close(resolve)); }
  await new Promise(resolve => server.close(resolve));
}
