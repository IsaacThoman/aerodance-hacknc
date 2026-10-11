#!/usr/bin/env node
// Renders every shot in client/src/shots.js to with-logo/<id>.png and no-logo/<id>.png.
// With --gifs, renders every clip instead, to with-logo/<id>.gif (or no-logo/ for shots
// without the wordmark).
//
//   node temp/thumbnails/scripts/render.mjs [--only id,id] [--spec shots.json --out dir] [--jobs 2]
//   node temp/thumbnails/scripts/render.mjs --gifs [--only id,id]
//
// Builds the capture page with Vite, opens it in headless Chrome (GPU WebGL), steps each
// shot's stage to its time and reads back the 540x480 buffer. Each buffer pixel is written
// as an exact 4x3 block (2160x1440, 3:2) into a lossless PNG: no filtering or resampling.
// GIFs go through ffmpeg: one 256-color palette for the clip, ordered dithering at the
// buffer's resolution, then the same exact 4x3 blocks.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';
import { BUFFER, CLIPS, SHOTS, UPSCALE } from '../client/src/shots.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function option(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const gifs = process.argv.includes('--gifs');
let shots = gifs ? CLIPS : SHOTS;
if (option('spec')) shots = JSON.parse(await readFile(option('spec'), 'utf8'));
if (option('only')) {
  const only = new Set(option('only').split(','));
  shots = shots.filter((s) => only.has(s.id));
}
const outDir = path.resolve(option('out') ?? ROOT);
const jobs = Number(option('jobs') ?? 2);
if (!shots.length) throw new Error(`No ${gifs ? 'clips' : 'shots'} to render`);

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

function toRgb(base64) {
  const rgba = Buffer.from(base64, 'base64');
  const rgb = Buffer.alloc((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return rgb;
}

// --- GIF ----------------------------------------------------------------------------

// Plays a clip frame by frame into ffmpeg. The palette is shared by the whole clip and
// dithered at the buffer's resolution; each pixel then becomes a 4x3 block and is mapped
// back onto the same palette (exact matches, no dithering), so the blocks stay whole.
async function renderClip(page, clip) {
  const shot = SHOTS.find((s) => s.id === clip.shot);
  if (!shot) throw new Error(`Unknown shot "${clip.shot}"`);
  const every = 60 / clip.fps;
  if (!Number.isInteger(every)) throw new Error(`fps ${clip.fps} does not divide 60`);
  await page.goto(`${base}?shot=${encodeURIComponent(shot.id)}&loop=${clip.from},${clip.to}`);
  await page.waitForFunction(() => window.__thumb, null, { timeout: 60000 });
  // 60 fps frame indices on the clip's frame grid, which includes the still's frame.
  const shotFrame = await page.evaluate(() => window.__thumb.shotFrame);
  const first = shotFrame - Math.round((shot.pose - clip.from) * clip.fps) * every;
  const count = Math.round((clip.to - clip.from) * clip.fps);

  const file = path.join(outDir, shot.logo ? 'with-logo' : 'no-logo', `${clip.id}.gif`);
  await mkdir(path.dirname(file), { recursive: true });
  const [sx, sy] = UPSCALE;
  const filter = [
    '[0:v]split[a][b]',
    '[a]palettegen=stats_mode=full[p]',
    '[p]split[p1][p2]',
    '[b][p1]paletteuse=dither=bayer:bayer_scale=5[q]',
    `[q]scale=iw*${sx}:ih*${sy}:flags=neighbor[s]`,
    '[s][p2]paletteuse=dither=none',
  ].join(';');
  const ffmpeg = spawn('ffmpeg', [
    '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${BUFFER.width}x${BUFFER.height}`,
    '-framerate', String(clip.fps), '-i', '-', '-filter_complex', filter, '-loop', '0', '-y', file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = once(ffmpeg, 'close');
  ffmpeg.on('error', (e) => { throw new Error(`Could not run ffmpeg: ${e.message}`); });

  for (let k = 0; k < count; k++) {
    const frame = await page.evaluate(
      ([i, logo]) => window.__thumb.frame(i, { plain: !logo, logo }),
      [first + k * every, !!shot.logo],
    );
    if (!ffmpeg.stdin.write(toRgb(frame.logo ?? frame.plain))) await once(ffmpeg.stdin, 'drain');
  }
  ffmpeg.stdin.end();
  const [code] = await exited;
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
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
      if (gifs) {
        await renderClip(page, shot);
      } else {
        const query = option('spec') ? `spec=${encodeURIComponent(JSON.stringify(shot))}` : `shot=${encodeURIComponent(shot.id)}`;
        await page.goto(`${base}?${query}`);
        await page.waitForFunction(() => window.__thumb, null, { timeout: 60000 });
        const frame = await page.evaluate(() => window.__thumb.render());
        await writeImage(path.join(outDir, 'no-logo', `${shot.id}.png`), frame.plain, frame.width, frame.height);
        if (frame.logo) await writeImage(path.join(outDir, 'with-logo', `${shot.id}.png`), frame.logo, frame.width, frame.height);
      }
      if (!logged) {
        logged = true;
        console.log(`WebGL: ${await page.evaluate(() => window.__thumb.renderer)}`);
      }
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
