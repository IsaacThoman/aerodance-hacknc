// Reproduce the CPU comparisons against the audited main revision. Timings are
// informative, not CI thresholds; the equivalence assertions must always pass.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Group, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createLakeNormalPixels } from '../client/src/aero/lakeNormals.js';
import { lakeWaves, referenceLakeNormalPixels } from '../client/tests/helpers/lakeNormalsReference.js';
import { createRetargeter } from '../temp/frutiger-character/client/src/motion.js';

const baseline = process.argv[2] ?? 'f766e1f';
const source = execFileSync('git', ['show', `${baseline}:temp/frutiger-character/client/src/motion.js`], { encoding: 'utf8' });
const reference = await import(`data:text/javascript;base64,${Buffer.from(source.replace('from "three"', `from ${JSON.stringify(import.meta.resolve('three'))}`)).toString('base64')}`);
const data = JSON.parse(await readFile(new URL('../temp/frutiger-character/client/public/motion/dance.json', import.meta.url)));
const bytes = await readFile(new URL('../temp/frutiger-character/client/public/models/aero-character.glb', import.meta.url));
const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');

const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
function benchmark(run, iterations = 1) {
  for (let i = 0; i < 2; i++) run(iterations);
  const times = [];
  for (let i = 0; i < 7; i++) {
    const start = performance.now();
    run(iterations);
    times.push((performance.now() - start) / iterations);
  }
  return median(times);
}
const waves = lakeWaves();
assert.deepEqual(createLakeNormalPixels(512, waves), referenceLakeNormalPixels(512, waves));
const lake = {
  beforeMs: benchmark(() => referenceLakeNormalPixels(512, waves)),
  afterMs: benchmark(() => createLakeNormalPixels(512, waves)),
  differentBytes: 0,
};

let maxMatrixError = 0;
for (const person of [0, 1]) {
  const models = [clone(asset.scene), clone(asset.scene)];
  const parents = models.map((model) => { const parent = new Group(); parent.add(model); parent.scale.set(1.3, 0.8, 0.9); return parent; });
  const apply = [reference.createRetargeter(models[0], data, person), createRetargeter(models[1], data, person)];
  for (let time = -0.1; time < data.duration + 0.1; time += 1 / 60) {
    parents.forEach((parent) => { parent.position.set(Math.sin(time), 0.4, 3); parent.rotation.set(0.2, Math.sin(time) * 0.7, -0.1); });
    apply.forEach((fn) => fn(time));
    models.forEach((model) => model.updateMatrixWorld(true));
    for (const name of ['Root', 'Body', 'Head', 'ArmL', 'ArmR', 'FootL', 'FootR']) {
      const matrices = models.map((model) => model.getObjectByName(name).matrixWorld.elements);
      for (let i = 0; i < 16; i++) maxMatrixError = Math.max(maxMatrixError, Math.abs(matrices[0][i] - matrices[1][i]));
    }
  }
}
assert.ok(maxMatrixError < 1e-10, `Pose matrix error: ${maxMatrixError}`);
function benchmarkRetarget(factory) {
  const model = clone(asset.scene), parent = new Group(); parent.add(model);
  const apply = factory(model, data, 0);
  return benchmark((iterations) => { for (let i = 0; i < iterations; i++) apply(i / 60); }, 20000);
}
function countCompositions(factory) {
  const model = clone(asset.scene), apply = factory(model, data, 0);
  let compositions = 0;
  const original = Object3D.prototype.updateMatrix;
  Object3D.prototype.updateMatrix = function () { compositions++; return original.call(this); };
  try { apply(6); } finally { Object3D.prototype.updateMatrix = original; }
  return compositions;
}
console.log(JSON.stringify({
  baseline,
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  lake,
  retarget: {
    beforeMs: benchmarkRetarget(reference.createRetargeter),
    afterMs: benchmarkRetarget(createRetargeter),
    beforeMatrixCompositions: countCompositions(reference.createRetargeter),
    afterMatrixCompositions: countCompositions(createRetargeter),
    maxMatrixError,
  },
}, null, 2));
