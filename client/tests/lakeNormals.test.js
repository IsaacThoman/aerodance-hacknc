import test from 'node:test';
import assert from 'node:assert/strict';
import { createLakeNormalPixels } from '../src/aero/lakeNormals.js';
import { lakeWaves, referenceLakeNormalPixels } from './helpers/lakeNormalsReference.js';

test('the production 512x512 lake normal map matches every original texture byte', () => {
  const waves = lakeWaves();
  const imageData = new Uint8ClampedArray(512 * 512 * 4);
  assert.equal(createLakeNormalPixels(512, waves, imageData), imageData);
  assert.deepEqual(imageData, referenceLakeNormalPixels(512, waves));
});

test('ripple directions, phase offsets and flat water match the direct wave formula', () => {
  for (const waves of [[], [[0, 3, 1.2, 0.8]], [[-4, 0, -0.4, 1.1]], [[2, -3, 4.2, 0.7], [-5, -1, 0, 0.3]]]) {
    assert.deepEqual(createLakeNormalPixels(32, waves), referenceLakeNormalPixels(32, waves));
  }
});
