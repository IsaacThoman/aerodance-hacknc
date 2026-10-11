import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createStudio } from '../server/index.js';
import { newProject, addTake, overwriteTracks, trackDataIds, takeCalibration } from '../core.js';
import { readZip } from '../server/zip.js';

const root = await mkdtemp(path.join(tmpdir(), 'studio-video-browser-'));
const { app, store } = createStudio({ dataDir: root });
const source = { schema: 'aerodance.take', schemaVersion: 1, takeId: 'original-take', source: 'android', name: 'Original take',
  input: { width: 640, height: 480, mirrored: false }, offsetMs: 0, timeScale: 1,
  samples: Array.from({ length: 9 }, (_, i) => ({ takeTimeMs: i * 100, poses: [0, 1].map(playerId => ({ playerId,
    landmarks: Array.from({ length: 33 }, (_, j) => ({ x: playerId ? .75 : .25, y: j < 23 ? .4 : .8,
      z: 0, visibility: .95, presence: .95 })) })) })) };
const original = await store.writeTake('video-browser', source), assets = new Map([[original.takeId, original]]);
let p = overwriteTracks(addTake(newProject('video-browser'), original), original, [0, 1], assets);
for (const dataId of trackDataIds(p)) await store.writeTrack(p.projectId, assets.get(dataId));
p = await store.save(p, null);
const initialTracks = structuredClone(p.tracks);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-accelerated-video-decode'] });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // The worker's graphics context still runs actual model inference.
    for (const Type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Type) continue;
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'])
        if (Type.prototype[name]) Type.prototype[name] = () => {};
    }
    window.cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.cameraRequests++; throw Error('Video import must not request a camera'); };
    window.calibrationFixture = 'weak-left';
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.type !== 'result' || window.calibrationFixture !== 'weak-left') return;
          const left = this.regionId === 0 ? data.landmarks[0] : this.regionId === 1 ? null
            : data.landmarks.find(p => (p[23].x + p[24].x) / 2 < .5);
          if (left) left[27].visibility = .1;
        });
      }
      postMessage(data, ...args) {
        this.regionId = data.regionId;
        return super.postMessage(data, ...args);
      }
    };
  });
  await page.goto(base);
  await page.getByRole('heading', { name: 'Make every move yours.' }).waitFor();
  // Keep a real song audio asset while importing video poses.
  const sampleRate = 8000, audio = Buffer.alloc(44 + sampleRate * 2);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(sampleRate, 24); audio.writeUInt32LE(sampleRate * 2, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  await page.getByLabel('Import song audio', { exact: true }).setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: audio });
  await page.getByText(/Audio imported/).waitFor();
  const audioBefore = (await store.read(p.projectId, 'project.json')).audio;
  await page.getByLabel('Import video', { exact: true }).setInputFiles({ name: 'bad.webm', mimeType: 'video/webm', buffer: Buffer.from('not video') });
  await page.getByRole('alert').filter({ hasText: /could not decode/ }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog', { name: 'Import video' }).waitFor({ state: 'hidden' });
  assert.equal((await store.read(p.projectId, 'project.json')).takes.length, 1);
  await page.getByLabel('Import video', { exact: true }).setInputFiles(path.resolve('tools/choreography/tests/video-fixture.webm'));
  const panel = page.getByRole('dialog', { name: 'Import video' });
  await panel.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Process video', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Use current frame for calibration' }).waitFor();
  await page.waitForFunction(() => document.querySelector('dialog video')?.readyState >= 2);
  await page.locator('dialog video').evaluate(v => { v.currentTime = .3; });
  await page.waitForFunction(() => Math.abs(document.querySelector('dialog video').currentTime - .3) < .01 && !document.querySelector('dialog video').seeking);
  await page.getByRole('button', { name: 'Use current frame for calibration' }).click();
  await page.getByText('P1 detected · needs clearer shoulders, hips and feet', { exact: true }).waitFor();
  await page.getByText('P2 detected · ready', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Process video', exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.calibrationFixture = 'normal'; });
  await page.getByRole('button', { name: 'Use current frame for calibration' }).click();
  await page.getByText(/Calibration at .*P1 and P2 ready/).waitFor();
  // Changing a model invalidates its calibration.
  await page.getByLabel('Video pose model').selectOption('full');
  assert.equal(await page.getByRole('button', { name: 'Process video', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Use current frame for calibration' }).click();
  await page.getByText(/Calibration at .*P1 and P2 ready/).waitFor();
  await page.getByRole('button', { name: 'Process video', exact: true }).click();
  await panel.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'View take: video-fixture.webm', exact: true }).waitFor();
  await page.getByText('Saved', { exact: true }).waitFor();
  let saved = await store.read(p.projectId, 'project.json');
  assert.equal(saved.takes.length, 2); assert.deepEqual(saved.tracks, initialTracks); assert.deepEqual(saved.audio, audioBefore);
  const imported = await store.read(p.projectId, 'takes', `${saved.takes[1].takeId}.json`);
  assert.equal(imported.source, 'video'); assert.equal(imported.provenance.modelId, 'full');
  assert.ok(Math.abs(imported.calibrationFrame.mediaTimeMs - 300) < 1);
  assert.ok(imported.samples.length >= 2);
  assert.ok(imported.samples.some(s => s.poses.length === 2));
  assert.ok(imported.samples.every((s, i, all) => !i || s.takeTimeMs > all[i - 1].takeTimeMs));
  assert.equal(await page.evaluate(() => window.cameraRequests), 0);
  await page.reload();
  await page.getByRole('button', { name: 'View take: video-fixture.webm', exact: true }).click();
  await page.getByLabel('Take actions: video-fixture.webm', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Overwrite both tracks' }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
  saved = await store.read(p.projectId, 'project.json');
  for (const track of saved.tracks) {
    const data = await store.read(p.projectId, 'tracks', `${track.dataId}.json`);
    assert.deepEqual(data.calibration, takeCalibration(imported, track.playerId));
  }
  // Check publication uses the selected frame, without requiring metadata clicks.
  saved.metadata.artist = 'Fixture'; saved.metadata.rights.audio.license = 'CC0'; saved.metadata.rights.choreography.license = 'CC0';
  saved.playableEndMs = imported.samples.at(-1).takeTimeMs;
  saved.alignmentReviewed = true; saved = await store.save(saved, saved.revision);
  const exported = await fetch(`${base}/api/projects/${p.projectId}/export`);
  assert.equal(exported.status, 200, await exported.clone().text());
  const choreography = JSON.parse(readZip(Buffer.from(await exported.arrayBuffer())).get(`${saved.songId}/choreography.json`));
  assert.deepEqual(choreography.tracks[0].calibration, takeCalibration(imported, 0));
  assert.deepEqual(errors, []);
  console.log(`Video import browser passed: actual Lite/Full calibration and Full inference, ${imported.samples.length} samples (${imported.provenance.frameTimingMethod}), unchanged tracks/audio, explicit assignment, reopen and export.`);
} catch (error) {
  if (page) {
    console.error(error.message);
    if (await page.locator('dialog').count()) {
      console.error(await page.locator('dialog').innerText());
      console.error(await page.locator('dialog video').evaluate(async v => ({ error: v.error?.message,
        code: v.error?.code, bytes: await fetch(v.src).then(r => r.blob()).then(b => b.size).catch(() => null) })));
    }
    await page.screenshot({ path: '/tmp/aerodance-video-import-failure.png' });
  }
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true });
}
