import test from 'node:test';
import assert from 'node:assert/strict';
import { createMountainGeometry } from '../src/aero/mountainGeometry.js';

for (const [radius, height] of [[380, 380], [620, 720], [440.0683428533375, 575.5372948246077]]) {
  test(`mountain ${radius} × ${height} has a continuous silhouette without rock under the snow`, () => {
    const geometry = createMountainGeometry(radius, height);
    const positions = geometry.attributes.position, indices = geometry.index;
    const rimY = height * 0.2, epsilon = 0.0001;
    assert.deepEqual(geometry.groups.map((g) => g.materialIndex), [0, 1]);

    const rims = [new Set(), new Set()];
    let next = 0;
    for (const group of geometry.groups) {
      assert.equal(group.start, next, 'every triangle has exactly one material');
      next += group.count;
      for (let i = group.start; i < next; i++) {
        const v = indices.getX(i), y = positions.getY(v);
        if (group.materialIndex === 0) assert.ok(y <= rimY + epsilon, 'rock stops at the snow line');
        else assert.ok(y >= rimY - epsilon, 'snow starts at the snow line');
        // Every vertex stays on the original cone, including the shared rim.
        const r = Math.hypot(positions.getX(v), positions.getZ(v));
        assert.ok(Math.abs(r - radius * (0.5 - y / height)) < epsilon);
        if (Math.abs(y - rimY) < epsilon) {
          rims[group.materialIndex].add([positions.getX(v), y, positions.getZ(v)].map((n) => n.toFixed(4)).join(','));
        }
      }
    }
    assert.equal(next, indices.count);
    assert.ok(rims[0].size >= 7);
    assert.deepEqual(rims[0], rims[1], 'rock and snow meet without a gap');
    geometry.computeBoundingBox();
    assert.ok(Math.abs(geometry.boundingBox.min.y + height / 2) < epsilon);
    assert.ok(Math.abs(geometry.boundingBox.max.y - height / 2) < epsilon);
    geometry.dispose();
  });
}
