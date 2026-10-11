import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Vector3 } from "three";
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


test("capture has two finite, timestamped tracks and usable tracking coverage", () => {
  assert.equal(validateMotion(data), data);
  assert.ok(data.samples.length > 300);
  assert.ok(data.provenance.report.reliableJointFraction.every((n) => n > 0.9));
  assert.ok(data.provenance.report.longestMissingRun.every((n) => n <= 10));
  assert.throws(() => validateMotion({ ...data, samples: [] }));
});

test("timestamp interpolation, negative time and loop seam remain continuous", () => {
  const a = samplePose(data, 0, 4);
  assert.deepEqual(samplePose(data, 0, 4 + (data.durationMs / 1000)), a);
  const first = samplePose(data, 0, 0);
  const end = samplePose(data, 0, -0.0001);
  assert.ok(Math.abs(first.landmarks[15].x - end.landmarks[15].x) < 0.0001);
  const mid = (data.samples[30].takeTimeMs + data.samples[31].takeTimeMs) / 2000;
  assert.ok(
    Math.abs(
      samplePose(data, 1, mid).landmarks[15].x -
        (data.samples[30].poses[1].landmarks[15].x + data.samples[31].poses[1].landmarks[15].x) / 2,
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
  for (let t = 0; t < (data.durationMs / 1000); t += 1 / 30)
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
