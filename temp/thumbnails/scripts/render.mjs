#!/usr/bin/env node
// Renders every shot in client/src/shots.js to with-logo/<id>.png and no-logo/<id>.png.
//
//   node temp/thumbnails/scripts/render.mjs [--only id,id] [--spec shots.json --out dir] [--jobs 2]
//
// Builds the capture page with Vite, opens it in headless Chrome (GPU WebGL), steps each
// shot's stage to its time and reads back the 540x480 buffer. Each buffer pixel is written
// as an exact 4x3 block (2160x1440, 3:2) into a lossless PNG: no filtering or resampling.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';
import { SHOTS, UPSCALE } from '../client/src/shots.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function option(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

let shots = SHOTS;
if (option('spec')) shots = JSON.parse(await readFile(option('spec'), 'utf8'));
if (option('only')) {
  const only = new Set(option('only').split(','));
  shots = shots.filter((s) => only.has(s.id));
}
const outDir = path.resolve(option('out') ?? ROOT);
const jobs = Number(option('jobs') ?? 2);
if (!shots.length) throw new Error('No shots to render');

// --- PNG ----------------------------------------------------------------------------

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// 8-bit RGB PNG, choosing each row's filter by the usual minimum-sum heuristic.
function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  const candidates = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  const zero = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const up = y ? rgb.subarray((y - 1) * stride, y * stride) : zero;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = candidates[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? row[i - 3] : 0;
        const b = up[i];
        const c = i >= 3 ? up[i - 3] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (row[i] - pred) & 0xff;
        out[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    candidates[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB, deflate, adaptive filtering, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', deflateSync(raw, { level: 9, memLevel: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Every source pixel becomes an exact sx-by-sy block.
function upscale(rgba, width, height, [sx, sy]) {
  const w = width * sx;
  const out = Buffer.alloc(w * height * sy * 3);
  const line = Buffer.alloc(w * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      for (let k = 0; k < sx; k++) {
        const d = (x * sx + k) * 3;
        line[d] = rgba[s];
        line[d + 1] = rgba[s + 1];
        line[d + 2] = rgba[s + 2];
      }
    }
    for (let k = 0; k < sy; k++) line.copy(out, (y * sy + k) * w * 3);
  }
  return { width: w, height: height * sy, rgb: out };
}

async function writeImage(file, base64, width, height) {
  const big = upscale(Buffer.from(base64, 'base64'), width, height, UPSCALE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, encodePng(big.width, big.height, big.rgb));
}

// --- Capture ------------------------------------------------------------------------

const buildDir = await mkdtemp(path.join(tmpdir(), 'aerodance-thumbnails-'));
const config = path.join(ROOT, 'vite.config.js');
await build({ configFile: config, logLevel: 'warn', build: { outDir: buildDir, emptyOutDir: true } });
const server = await preview({ configFile: config, logLevel: 'warn', build: { outDir: buildDir }, preview: { port: 0, host: '127.0.0.1' } });
const base = server.resolvedUrls.local[0];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu'] });
const context = await browser.newContext({ viewport: { width: 1080, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });

let failed = 0;
let logged = false;
const queue = [...shots];
async function worker() {
  for (let shot = queue.shift(); shot; shot = queue.shift()) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const started = performance.now();
    try {
      const query = option('spec') ? `spec=${encodeURIComponent(JSON.stringify(shot))}` : `shot=${encodeURIComponent(shot.id)}`;
      await page.goto(`${base}?${query}`);
      await page.waitForFunction(() => window.__thumb, null, { timeout: 60000 });
      if (!logged) {
        logged = true;
        console.log(`WebGL: ${await page.evaluate(() => window.__thumb.renderer)}`);
      }
      const frame = await page.evaluate(() => window.__thumb.render());
      await writeImage(path.join(outDir, 'no-logo', `${shot.id}.png`), frame.plain, frame.width, frame.height);
      if (frame.logo) await writeImage(path.join(outDir, 'with-logo', `${shot.id}.png`), frame.logo, frame.width, frame.height);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      console.log(`✓ ${shot.id} (${seconds}s)${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${shot.id}: ${e.message}${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
    } finally {
      await page.close();
    }
  }
}
try {
  await Promise.all(Array.from({ length: Math.min(jobs, shots.length) }, worker));
} finally {
  await browser.close();
  await server.close();
  await rm(buildDir, { recursive: true, force: true });
}
if (failed) {
  console.error(`${failed} shot(s) failed`);
  process.exit(1);
}
