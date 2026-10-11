import assert from 'node:assert/strict';
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
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true });
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
  // Android networking is covered by the transport tests. This browser smoke
  // check uses the explicit dummy path and exercises switching back to Android.
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
  assert.deepEqual(errors, []);
  console.log('Browser flow passed: pairing controls, webcam dummy, IP validation, both player modes, Back, catalog, source switching, letterboxing, and no runtime errors.');
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
