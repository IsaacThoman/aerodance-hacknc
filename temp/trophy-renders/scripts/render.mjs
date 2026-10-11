#!/usr/bin/env node
// Renders trophy NFTs in-engine to renders/<id>.png (with the 2D layer) and renders/plain/<id>.png.
//
//   node temp/trophy-renders/scripts/render.mjs [--only id,id] [--spec battles.json] [--out dir]
//
// Builds the capture page with Vite, opens it in headless Chrome (or Edge; CHROME_PATH picks
// another) with GPU WebGL, steps each battle's stage to its framing time and saves the frame.
// The browser is driven over the DevTools protocol with Node's own WebSocket, so the only
// dependencies are the repository's.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { BATTLES } from '../client/src/shots.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function option(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

let battles = option('spec') ? JSON.parse(await readFile(option('spec'), 'utf8')) : BATTLES;
if (option('only')) {
  const only = new Set(option('only').split(','));
  battles = battles.filter((b) => only.has(b.id));
}
if (!battles.length) throw new Error('No battles to render');
const outDir = path.resolve(option('out') ?? path.join(ROOT, 'renders'));

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
    '--enable-gpu', '--hide-scrollbars', '--window-size=1200,1200', '--no-first-run', 'about:blank',
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

const buildDir = await mkdtemp(path.join(tmpdir(), 'aerodance-trophies-'));
const profile = await mkdtemp(path.join(tmpdir(), 'aerodance-trophies-browser-'));
const config = path.join(ROOT, 'vite.config.js');
await build({ configFile: config, logLevel: 'warn', build: { outDir: buildDir, emptyOutDir: true } });
const server = await preview({ configFile: config, logLevel: 'warn', build: { outDir: buildDir }, preview: { port: 0, host: '127.0.0.1' } });
const base = server.resolvedUrls.local[0];

const browser = launch(profile);
let failed = 0;
try {
  const cdp = await connect(await browser.endpoint);
  await mkdir(path.join(outDir, 'plain'), { recursive: true });
  let logged = false;
  for (const battle of battles) {
    const started = performance.now();
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
      await cdp.send('Page.enable', {}, sessionId);
      const loaded = new Promise((resolve) => {
        const onLoad = (msg) => {
          if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') {
            cdp.off(onLoad);
            resolve();
          }
        };
        cdp.on(onLoad);
      });
      const query = option('spec') ? `spec=${encodeURIComponent(JSON.stringify(battle))}` : `battle=${encodeURIComponent(battle.id)}`;
      await cdp.send('Page.navigate', { url: `${base}?${query}` }, sessionId);
      await loaded;
      await evaluate(`new Promise((resolve, reject) => {
        const start = performance.now();
        (function wait() {
          if (window.__trophy) resolve();
          else if (performance.now() - start > 60000) reject(new Error('The capture page never got ready'));
          else setTimeout(wait, 50);
        })();
      })`);
      const info = await evaluate('({ traits: window.__trophy.traits, renderer: window.__trophy.renderer })');
      if (!logged) {
        logged = true;
        console.log(`WebGL: ${info.renderer}`);
      }
      const frame = await evaluate('window.__trophy.render()');
      await writeFile(path.join(outDir, `${battle.id}.png`), dataUrlBytes(frame.hud));
      await writeFile(path.join(outDir, 'plain', `${battle.id}.png`), dataUrlBytes(frame.plain));
      const t = info.traits;
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      const notes = [frame.fontWarning, ...errors].filter(Boolean);
      console.log(`✓ ${battle.id}: ${t.stage}, ${t.glass} ${t.finish} ${t.cup}${t.aura ? ', golden halo' : ''} (${seconds}s)${notes.length ? `\n  ${notes.join('\n  ')}` : ''}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${battle.id}: ${e.message}${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
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
  console.error(`${failed} trophy render(s) failed`);
  process.exit(1);
}
