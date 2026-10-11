import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, readdir, cp, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { ASSET_PATH, MEDIAPIPE_VERSION, MODELS } from '../packages/pose/browser/models.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.cache', ASSET_PATH);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let preparation;
export function preparePoseAssets() {
  return preparation ??= (async () => {
    const packageRoot = path.join(root, 'node_modules/@mediapipe/tasks-vision');
    const pkg = JSON.parse(await readFile(path.join(packageRoot, 'package.json')));
    if (pkg.version !== MEDIAPIPE_VERSION) throw Error('MediaPipe JS/WASM version mismatch');
    await mkdir(path.join(directory, 'wasm'), { recursive: true });
    for (const file of await readdir(path.join(packageRoot, 'wasm')))
      await copyFile(path.join(packageRoot, 'wasm', file), path.join(directory, 'wasm', file));
    await Promise.all(MODELS.map(async model => {
      const filename = path.join(directory, model.file);
      let bytes = await readFile(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (bytes && (bytes.length !== model.bytes || hash(bytes) !== model.sha256)) throw Error(`Cached ${model.label} model checksum mismatch; remove ${filename} and retry`);
      if (!bytes) {
        console.log(`Preparing MediaPipe ${model.label} model…`);
        const response = await fetch(model.url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw Error(`${model.label} model download HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== model.bytes || hash(bytes) !== model.sha256) throw Error(`${model.label} model checksum mismatch`);
        const temporary = `${filename}.${process.pid}.tmp`;
        await writeFile(temporary, bytes);
        await rename(temporary, filename);
      }
    }));
    await copyFile(path.join(root, 'packages/pose/browser/NOTICE.md'), path.join(directory, 'NOTICE.md'));
    await copyFile(path.join(root, 'packages/pose/browser/LICENSE.Apache-2.0.txt'), path.join(directory, 'LICENSE.Apache-2.0.txt'));
  })();
}
export function poseAssetsPlugin() {
  let base = '/';
  return {
    name: 'browser-pose-assets',
    configResolved(config) { base = config.base; },
    async configureServer(server) {
      await preparePoseAssets();
      server.middlewares.use(`${base}${ASSET_PATH}`, express.static(directory));
    },
    async buildStart() { await preparePoseAssets(); },
    async writeBundle(options) { await cp(directory, path.join(options.dir, ASSET_PATH), { recursive: true }); },
  };
}
