#!/usr/bin/env node
// Renders the hype sticker NFTs in-engine to client/public/stickers/<id>.png (512×512, transparent).
//
//   node temp/sticker-renders/scripts/render.mjs [--only koi,rainbow] [--out dir]
//
// Builds the capture page with Vite, opens it in headless Chrome (or Edge; CHROME_PATH picks
// another) with GPU WebGL and saves each sticker's frame. The browser is driven over the
// DevTools protocol with Node's own WebSocket, like temp/trophy-renders.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IDS = ['bubble', 'koi', 'rainbow'];

function option(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const ids = option('only') ? option('only').split(',') : IDS;
for (const id of ids) if (!IDS.includes(id)) throw new Error(`Unknown sticker: ${id}`);
const outDir = path.resolve(option('out') ?? path.join(ROOT, '../../client/public/stickers'));

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) throw new Error('No Chrome or Edge found; set CHROME_PATH');

// --- DevTools protocol ----------------------------------------------------------------

async function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const call = msg.id && pending.get(msg.id);
    if (call) {
      pending.delete(msg.id);
      if (msg.error) call.reject(new Error(msg.error.message));
      else call.resolve(msg.result);
    } else {
      for (const fn of listeners) fn(msg);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`Could not connect to ${url}`)), { once: true });
  });
  return {
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params, sessionId }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    on: (fn) => listeners.add(fn),
    off: (fn) => listeners.delete(fn),
    close: () => ws.close(),
  };
}

function launch(profile) {
  const child = spawn(browserPath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--ignore-gpu-blocklist',
    '--enable-gpu', '--hide-scrollbars', '--window-size=1100,1100', '--no-first-run', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = new Promise((resolve, reject) => {
    let log = '';
    child.stderr.on('data', (chunk) => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    child.on('exit', (code) => reject(new Error(`The browser exited (${code}) before DevTools started:\n${log}`)));
    setTimeout(() => reject(new Error('The browser never printed its DevTools address')), 30000);
  });
  return { child, endpoint };
}

const dataUrlBytes = (url) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

// --- Capture --------------------------------------------------------------------------

const buildDir = await mkdtemp(path.join(tmpdir(), 'aerodance-stickers-'));
const profile = await mkdtemp(path.join(tmpdir(), 'aerodance-stickers-browser-'));
const config = path.join(ROOT, 'vite.config.js');
await build({ configFile: config, logLevel: 'warn', build: { outDir: buildDir, emptyOutDir: true } });
const server = await preview({ configFile: config, logLevel: 'warn', build: { outDir: buildDir }, preview: { port: 0, host: '127.0.0.1' } });
const base = server.resolvedUrls.local[0];

const browser = launch(profile);
let failed = 0;
try {
  const cdp = await connect(await browser.endpoint);
  await mkdir(outDir, { recursive: true });
  for (const id of ids) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const errors = [];
    const onEvent = (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    };
    cdp.on(onEvent);
    const evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    try {
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1100, deviceScaleFactor: 1, mobile: false }, sessionId);
      await cdp.send('Page.navigate', { url: `${base}?sticker=${id}` }, sessionId);
      await evaluate(`new Promise((resolve, reject) => {
        const start = performance.now();
        (function wait() {
          if (window.__sticker) resolve();
          else if (performance.now() - start > 60000) reject(new Error('The capture page never got ready'));
          else setTimeout(wait, 50);
        })();
      })`);
      const png = await evaluate('window.__sticker.render()');
      await writeFile(path.join(outDir, `${id}.png`), dataUrlBytes(png));
      console.log(`✓ ${id}${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${id}: ${e.message}${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
    } finally {
      cdp.off(onEvent);
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }
  cdp.close();
} finally {
  browser.child.kill();
  await server.close();
  await rm(buildDir, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
if (failed) {
  console.error(`${failed} sticker render(s) failed`);
  process.exit(1);
}
