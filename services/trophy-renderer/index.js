// Internal service: render the existing capture page in Chromium, including on CPU-only hosts.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { rendererApp } from './app.js';

const PORT = Number(process.env.RENDERER_PORT) || 4001;
const CAPTURE_PORT = 4002;
const dist = path.resolve(fileURLToPath(import.meta.url), '../../..', 'dist/trophies');
const capture = express();
capture.use(express.static(dist));
const captureServer = capture.listen(CAPTURE_PORT, '127.0.0.1');
await new Promise((resolve) => captureServer.once('listening', resolve));

let browser;
async function launch() {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}
await launch();

async function render(battle) {
  const started = Date.now();
  if (!browser.isConnected()) await launch();
  const context = await browser.newContext({ viewport: { width: 1080, height: 1080 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Closing the context interrupts a hung evaluate() as well as slow navigation/WebGL.
  const deadline = setTimeout(() => void context.close(), 5 * 60_000);
  try {
    await page.goto(`http://127.0.0.1:${CAPTURE_PORT}/?spec=${encodeURIComponent(JSON.stringify(battle))}`);
    await page.waitForFunction(() => window.__trophy, null, { timeout: 60_000 });
    const frame = await page.evaluate(() => window.__trophy.render({ drawIntermediateFrames: false }));
    if (errors.length) throw new Error(errors.join('; '));
    if (frame.fontWarning) throw new Error(frame.fontWarning);
    console.log(`[trophy-renderer] ${battle.id} rendered in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return Buffer.from(frame.hud.split(',')[1], 'base64');
  } finally {
    clearTimeout(deadline);
    await context.close();
  }
}

const app = rendererApp({ render, secret: process.env.INTERNAL_SECRET });
const server = app.listen(PORT, () => console.log(`[trophy-renderer] listening on ${PORT}`));
async function stop() {
  server.close();
  captureServer.close();
  await browser.close();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
