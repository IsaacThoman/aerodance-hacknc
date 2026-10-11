import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFlockInstances, disposeFlockInstances } from '../../../client/src/aero/flock/world-instances.js';

const root = new URL('../', import.meta.url);
const scenes = new Map();
for (const variant of ['', '-low', '-world']) {
  // The World LOD ships with the game, next to its instancing helper.
  const modelPath = variant === '-world'
    ? '../../client/src/aero/flock/flock-camera-world.glb'
    : `client/public/models/flock-camera${variant}.glb`;
  const raw = await readFile(new URL(modelPath, root));
  const { scene } = await new GLTFLoader().parseAsync(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '',
  );
  const expected = JSON.parse(await readFile(new URL(`assets/model-stats${variant}.json`, root), 'utf8'));
  let meshes = 0, triangles = 0, pivot;
  scene.traverse(object => {
    if (object.name.includes('aiming_pivot')) pivot = object;
    if (!object.isMesh) return;
    meshes += 1;
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });
  assert.equal(meshes, expected.mesh_objects, `${variant || 'high'} mesh count`);
  assert.equal(triangles, expected.triangles, `${variant || 'high'} triangle count`);
  assert.ok(pivot, 'Camera aiming pivot is missing');
  scene.updateMatrixWorld(true);
  const forward = new Vector3(0, 0, 1).applyQuaternion(pivot.getWorldQuaternion(new Quaternion()));
  assert.ok(forward.y < 0, 'Camera must point downward');
  assert.ok(Math.abs(Math.asin(-forward.y) - 7 * Math.PI / 180) < 1e-6, 'Camera aim must be 7 degrees down');
  scenes.set(variant, scene);
  console.log(`${variant.slice(1) || 'high'}: ${triangles.toLocaleString()} triangles, ${meshes} meshes, ${raw.length.toLocaleString()} bytes`);
}

const source = scenes.get('-world');
let worldTriangles = 0;
const materials = new Set();
source.traverse(object => {
  assert.ok(!/Battery|Cable/.test(object.name), 'World LOD must omit batteries and cables');
  if (!object.isMesh) return;
  worldTriangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  materials.add(object.material);
});
assert.ok(worldTriangles < 2000, 'World LOD exceeds its placement geometry budget');
assert.equal(materials.size, 4);

// Batching must preserve all component transforms, including the tilted panel
// and aimed camera; compare actual vertex bounds rather than loose rotated AABBs.
const expectedBounds = new Box3().setFromObject(source, true);
const single = createFlockInstances(source, [new Matrix4()]);
const batchedBounds = new Box3().setFromObject(single);
assert.ok(expectedBounds.min.distanceTo(batchedBounds.min) < 1e-6);
assert.ok(expectedBounds.max.distanceTo(batchedBounds.max) < 1e-6);
disposeFlockInstances(single);

const transforms = Array.from({ length: 1000 }, (_, index) => new Matrix4()
  .makeTranslation((index % 32) * 6, 0, Math.floor(index / 32) * 6)
  .multiply(new Matrix4().makeRotationY((index % 4) * Math.PI / 2)));
const population = createFlockInstances(source, transforms);
assert.equal(population.children.length, 4, 'One instanced batch per material');
let batchedTriangles = 0;
for (const mesh of population.children) {
  assert.equal(mesh.count, 1000);
  assert.ok(Number.isFinite(mesh.boundingSphere.radius));
  batchedTriangles += mesh.geometry.attributes.position.count / 3;
  for (const index of [0, 31, 999]) {
    const actual = new Matrix4();
    mesh.getMatrixAt(index, actual);
    actual.elements.forEach((value, component) => {
      assert.ok(Math.abs(value - transforms[index].elements[component]) < 1e-6);
    });
  }
}
assert.equal(batchedTriangles, worldTriangles);
disposeFlockInstances(population);
assert.equal(population.children.length, 0);
// Disposing batches must leave the source geometry reusable.
assert.equal(new Box3().setFromObject(source, true).min.distanceTo(expectedBounds.min), 0);
console.log('World LOD: 1,000 transforms in four material batches; bounds and cleanup passed.');
