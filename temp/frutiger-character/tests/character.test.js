import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AnimationMixer, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  sanitizeCharacter,
  DEFAULT_CHARACTER,
} from "../client/src/character.js";
import { movementInput } from "../client/src/movement.js";

const bytes = await readFile(
  new URL("../../../packages/character/assets/aero-character.glb", import.meta.url),
);
const asset = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  "",
);

test("export contains the reference silhouette, two arms, two feet, and no invented face details", () => {
  const meshes = [];
  asset.scene.traverse((o) => {
    if (o.isSkinnedMesh) meshes.push(o);
  });
  const bodyParts = meshes.filter((o) => o.material.name === "AquaGel");
  assert.equal(bodyParts.length, 6);
  assert.equal(bodyParts.filter((o) => o.name.startsWith("Arm")).length, 2);
  assert.equal(bodyParts.filter((o) => o.name.startsWith("Foot")).length, 2);
  assert.equal(meshes.filter((o) => o.material.name === "Ink").length, 2);
  assert.ok(!meshes.some((o) => /Smile|Glint/.test(o.name)));
  const head = bodyParts.find((o) => o.name.startsWith("Head"));
  const torso = bodyParts.find((o) => o.name.startsWith("Body"));
  head.geometry.computeBoundingBox();
  torso.geometry.computeBoundingBox();
  const headSize = head.geometry.boundingBox.getSize(new Vector3());
  const bodySize = torso.geometry.boundingBox.getSize(new Vector3());
  assert.ok(Math.abs(headSize.x - 1.29) < 0.01);
  assert.ok(Math.abs(bodySize.y / headSize.y - 145 / 129) < 0.04);
  assert.ok(bodySize.x / headSize.x > 1 && bodySize.x / headSize.x < 1.1);
  for (const mesh of bodyParts) {
    assert.equal(mesh.skeleton.bones.length, 7);
    const weights = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < weights.count; i++) {
      assert.ok(
        Math.abs(
          weights.getX(i) +
            weights.getY(i) +
            weights.getZ(i) +
            weights.getW(i) -
            1,
        ) < 0.001,
      );
    }
  }
});

test("four usable clips animate the actual exported skeleton", () => {
  assert.deepEqual(asset.animations.map((a) => a.name).sort(), [
    "Dance",
    "Idle",
    "Walk",
    "Wave",
  ]);
  const mixer = new AnimationMixer(asset.scene);
  const arm = asset.scene.getObjectByName("ArmR");
  const rest = arm.quaternion.clone();
  mixer.clipAction(asset.animations.find((c) => c.name === "Wave")).play();
  mixer.update(0.5);
  assert.ok(
    rest.angleTo(arm.quaternion) > 1.8,
    "Wave must raise the arm, not just spin it in place",
  );
  mixer.stopAllAction();
  mixer.uncacheRoot(asset.scene);
  for (const clip of asset.animations) {
    assert.ok(clip.duration >= 1);
    for (const track of clip.tracks)
      assert.ok([...track.values].every(Number.isFinite));
  }
});

test("keyboard movement works without touch input and diagonals preserve speed", () => {
  assert.deepEqual(movementInput(new Set()), [0, 0]);
  assert.deepEqual(movementInput(new Set(["d"])), [1, 0]);
  assert.deepEqual(movementInput(new Set(["arrowup"])), [0, -1]);
  assert.deepEqual(movementInput(new Set(), { left: true }), [-1, 0]);
  assert.deepEqual(movementInput(new Set(["a", "d"])), [0, 0]);
  assert.ok(
    Math.abs(Math.hypot(...movementInput(new Set(["w", "d"]))) - 1) < 1e-9,
  );
});

test("saved character values are bounded and invalid data falls back safely", () => {
  assert.deepEqual(sanitizeCharacter(null), DEFAULT_CHARACTER);
  assert.equal(
    sanitizeCharacter({ name: "a".repeat(50), gloss: 500 }).name.length,
    20,
  );
  assert.equal(sanitizeCharacter({ gloss: 500 }).gloss, 100);
  assert.equal(sanitizeCharacter({ gloss: -10 }).gloss, 0);
  assert.equal(
    sanitizeCharacter({ color: "garbage" }).color,
    DEFAULT_CHARACTER.color,
  );
});
