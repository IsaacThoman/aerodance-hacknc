// Real model regression for small dancers in a tall video frame. An optional
// local image argument reproduces a reported frame without committing footage.
import assert from 'node:assert/strict';
import express from 'express';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { MODELS } from '../../../packages/pose/browser/models.js';

const app = express();
app.get('/probe', (_req, res) => res.type('html').send('<html></html>'));
app.get('/frame', (_req, res) => res.sendFile(path.resolve(process.argv[2] || 'client/tests/fixtures/mediapipe-pose.jpg')));
app.use('/source', express.static(path.resolve('.')));
app.use(express.static('tools/choreography/dist'));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const workerFile = (await readdir('tools/choreography/dist/assets')).find(name => name.startsWith('pose.worker-'));
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/probe`);
  const reports = await page.evaluate(async ({ models, workerFile, useReportedFrame }) => {
    let image = await createImageBitmap(await (await fetch('/frame')).blob());
    if (!useReportedFrame) {
      const canvas = new OffscreenCanvas(480, 854), g = canvas.getContext('2d');
      g.fillStyle = '#eee'; g.fillRect(0, 0, 480, 854);
      g.drawImage(image, 200, 0, 600, 667, 135, 360, 110, 155);
      g.drawImage(image, 200, 0, 600, 667, 225, 345, 110, 170);
      image.close(); image = await createImageBitmap(canvas);
    }
    const { VideoImporter } = await import('/source/tools/choreography/web/videoImport.js');
    const reports = [];
    for (const model of models) {
      const worker = new Worker(`/assets/${workerFile}`, { type: 'module' });
      const send = data => new Promise((resolve, reject) => {
        worker.onmessage = ({ data: result }) => result.type === 'error' ? reject(Error(result.message)) : resolve(result);
        worker.onerror = event => reject(Error(event.message));
        worker.postMessage(data, data.bitmap ? [data.bitmap] : []);
      });
      await send({ type: 'initialize', sessionId: model.id, runningMode: 'VIDEO', playerCount: 2,
        modelUrl: `${location.origin}/pose-assets/mediapipe-1.1.0/${model.file}`, modelHash: model.sha256,
        wasmUrl: `${location.origin}/pose-assets/mediapipe-1.1.0/wasm` });
      const fullFrameCounts = [];
      for (let i = 0; i < 8; i++) {
        const result = await send({ type: 'frame', seq: i + 1, bitmap: await createImageBitmap(image), timestampMs: i * 33 });
        fullFrameCounts.push(result.landmarks.length);
      }
      worker.terminate();
      const records = [];
      const job = new VideoImporter({ video: { videoWidth: image.width, videoHeight: image.height, currentTime: 0, duration: .2, pause() {} },
        modelId: model.id, projectId: 'probe', createWorker: () => new Worker(`/assets/${workerFile}`, { type: 'module' }),
        assetUrl: () => `${location.origin}/pose-assets/mediapipe-1.1.0/`,
        bitmap: (_video, ...args) => createImageBitmap(image, ...args),
        seek: async (_video, time) => ({ mediaTimeMs: time * 1000, timingMethod: 'decoded-frame' }),
        request: async (url, options) => {
          if (url.endsWith('/batches')) records.push(...options.body.records.map(e => e.record));
          return { takeId: 'probe' };
        },
      });
      const probes = [], infer = job.infer.bind(job);
      let checkingCalibration = true;
      job.infer = async (time, crop, regionId) => {
        const result = await infer(time, crop, regionId);
        if (checkingCalibration) probes.push({ crop, regionId, body: result.landmarks.map(p =>
          [11, 12, 23, 24, 27, 28].map(i => ({ i, x: p[i].x, y: p[i].y,
            confidence: Math.min(p[i].visibility, p[i].presence) }))) });
        return result;
      };
      const calibration = await job.calibrate();
      checkingCalibration = false;
      await job.process('frame.webm');
      reports.push({ model: model.id, fullFrameCounts, calibrationPlayers: calibration.poses.map(p => p.playerId),
        hipX: calibration.poses.map(p => (p.landmarks[23].x + p.landmarks[24].x) / 2),
        minBodyConfidence: calibration.poses.map(p => Math.min(...[11, 12, 23, 24, 27, 28].map(i => Math.min(p.landmarks[i].visibility, p.landmarks[i].presence)))),
        processedPlayers: records.at(-1).poses.map(p => p.playerId),
        ...(calibration.poses.length < 2 ? { probes } : {}) });
      job.abort();
    }
    image.close();
    return reports;
  }, { models: MODELS, workerFile, useReportedFrame: Boolean(process.argv[2]) });
  console.log(JSON.stringify(reports, null, 2));
  for (const report of reports) {
    assert.deepEqual(report.calibrationPlayers, [0, 1], `${report.model}: both dancers must calibrate`);
    assert.deepEqual(report.processedPlayers, [0, 1], `${report.model}: both dancers must survive video processing`);
    assert.ok(report.hipX[0] < .5 && report.hipX[1] > .5, 'restored coordinates retain the original regions');
  }
  console.log('Portrait duet regression passed for Lite, Full and Heavy: both calibration and video processing.');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
