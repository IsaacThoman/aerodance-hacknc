import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Group, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import {
  validateMotion,
  samplePose,
  createRetargeter,
} from "../client/src/motion.js";

const data = JSON.parse(
  await readFile(
    new URL("../client/public/motion/dance.json", import.meta.url),
  ),
);
const buffer = await readFile(
  new URL("../client/public/models/aero-character.glb", import.meta.url),
);
const asset = await new GLTFLoader().parseAsync(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  "",
);
const output = () => Array.from({ length: 33 }, () => [0, 0, 0, 0]);

test("capture has two finite, timestamped tracks and usable tracking coverage", () => {
  assert.equal(validateMotion(data), data);
  assert.ok(data.times.length > 300);
  assert.ok(data.report.reliableJointFraction.every((n) => n > 0.9));
  assert.ok(data.report.longestMissingRun.every((n) => n <= 10));
  assert.throws(() => validateMotion({ ...data, poses: [] }));
});

test("timestamp interpolation, negative time and loop seam remain continuous", () => {
  const a = samplePose(data, 0, 4, output());
  assert.deepEqual(samplePose(data, 0, 4 + data.duration, output()), a);
  const first = samplePose(data, 0, 0, output());
  const end = samplePose(data, 0, -0.0001, output());
  assert.ok(Math.abs(first[15][0] - end[15][0]) < 0.0001);
  const mid = (data.times[30] + data.times[31]) / 2;
  assert.ok(
    Math.abs(
      samplePose(data, 1, mid, output())[15][0] -
        (data.poses[30][1][15][0] + data.poses[31][1][15][0]) / 2,
    ) < 1e-8,
  );
});

test("cloned skeletons move independently, remain finite and keep feet above the stage", () => {
  const models = [clone(asset.scene), clone(asset.scene)];
  const apply = models.map((m, p) => createRetargeter(m, data, p));
  const fixed = models[1].getObjectByName("ArmR").position.clone();
  apply[0](5);
  assert.deepEqual(models[1].getObjectByName("ArmR").position, fixed);
  let minX = Infinity,
    maxX = -Infinity;
  for (let t = 0; t < data.duration; t += 1 / 30)
    for (let p = 0; p < 2; p++) {
      apply[p](t);
      models[p].updateMatrixWorld(true);
      models[p].traverse((o) => {
        if (o.isBone) assert.ok(o.matrixWorld.elements.every(Number.isFinite));
      });
      for (const name of ["FootL", "FootR"])
        assert.ok(
          models[p].getObjectByName(name).getWorldPosition(new Vector3()).y >=
            0.299,
        );
      const hand = models[p]
        .getObjectByName("ArmR")
        .getWorldPosition(new Vector3());
      minX = Math.min(minX, hand.x);
      maxX = Math.max(maxX, hand.x);
    }
  assert.ok(
    maxX - minX > 0.5,
    "the recording must produce substantial hand motion",
  );
});

test("retargeting preserves the pose under moving, rotated and nonuniformly scaled parents", () => {
  const names = ["Root", "Body", "Head", "ArmL", "ArmR", "FootL", "FootR"];
  for (const person of [0, 1]) {
    const local = clone(asset.scene), transformed = clone(asset.scene);
    const parent = new Group(), grandparent = new Group();
    parent.add(transformed);
    grandparent.add(parent);
    const applyLocal = createRetargeter(local, data, person);
    const applyTransformed = createRetargeter(transformed, data, person);
    for (let t = -0.1; t < data.duration + 0.1; t += 1 / 30) {
      parent.position.set(Math.sin(t), 0.4, 3);
      parent.rotation.set(0.2, Math.sin(t) * 0.7, -0.1);
      parent.scale.set(1.3, 0.8, 0.9);
      grandparent.rotation.y = t * 0.1;
      grandparent.position.y = Math.cos(t);
      // Deliberately leave the ancestor matrices stale, as they are between
      // frame callbacks and the renderer's scene update.
      applyLocal(t);
      applyTransformed(t);
      for (const name of names) {
        const a = local.getObjectByName(name), b = transformed.getObjectByName(name);
        assert.ok(a.position.distanceTo(b.position) < 1e-10, `${name} position at ${t}`);
        assert.ok(a.quaternion.toArray().every((n, i) => Math.abs(n - b.quaternion.toArray()[i]) < 1e-10));
      }
    }
  }
});
