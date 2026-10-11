import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Box3, Group, Vector3 } from "three";
import { createPoseApplier, calibratePoses } from '../../../packages/character/retarget.js';
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import {
  validateMotion,
  samplePose,
  createRetargeter,
} from "../../../packages/character/motion.js";

const data = JSON.parse(
  await readFile(
    new URL("../client/public/motion/dance.json", import.meta.url),
  ),
);
const buffer = await readFile(
  new URL("../../../packages/character/assets/aero-character.glb", import.meta.url),
);
const asset = await new GLTFLoader().parseAsync(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  "",
);

function meshBounds(model, prefix) {
  let mesh;
  model.traverse(o => { if (o.isSkinnedMesh && o.name.startsWith(prefix)) mesh = o; });
  mesh.skeleton.update();
  const bounds = new Box3(), vertex = new Vector3();
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++)
    bounds.expandByPoint(mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld));
  return bounds;
}
function standingPose() {
  const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .2, z: 0, visibility: 1, presence: 1 }));
  for (const [i, x, y] of [[11,.56,.3],[12,.44,.3],[23,.56,.55],[24,.44,.55],
    [15,.67,.3],[16,.33,.3],[27,.56,.9],[28,.44,.9]]) Object.assign(landmarks[i], { x, y });
  return { playerId: 0, landmarks };
}
test('webcam distance compensation keeps hands, feet and root consistent across framing and aspect ratios', () => {
  const reference = standingPose();
  reference.landmarks.forEach((p,i) => { p.x -= .2; p.z=(i-20)*.003; });
  const names=['Root','Body','Head','ArmL','ArmR','FootL','FootR'];
  const project=(pose,zoom,aspect)=>({ ...pose, landmarks:pose.landmarks.map(p=>({ ...p,
    x:.5+(p.x-.5)*zoom*(4/3)/aspect,y:.5+(p.y-.5)*zoom,z:p.z*zoom*(4/3)/aspect,
  })) });
  const baseline=clone(asset.scene);
  createPoseApplier(baseline,calibratePoses([reference],{width:640,height:480},{adaptiveDistance:true}))(reference);
  for(const input of [{width:640,height:480},{width:1280,height:720},{width:480,height:640}]) {
    const aspect=input.width/input.height;
    const neutral=project(reference,1,aspect), model=clone(asset.scene);
    // Retain the near calibration while the dancer moves back; do not silently
    // recalibrate every frame to make the regression pass.
    const apply=createPoseApplier(model,calibratePoses([neutral],input,{adaptiveDistance:true}));
    for(const zoom of [.35,.6,1,1.2]) {
      const projected=project(reference,zoom,aspect), raw=structuredClone(projected);
      apply(projected);
      for(const name of names) {
        const expected=baseline.getObjectByName(name), actual=model.getObjectByName(name);
        assert.ok(actual.position.distanceTo(expected.position)<1e-6, `${name} position at framing ${zoom}, aspect ${aspect}`);
        assert.ok(actual.quaternion.angleTo(expected.quaternion)<1e-6, `${name} orientation`);
      }
      assert.deepEqual(projected,raw);
    }
  }
});
test('original wrist reach and continuous foot depth are preserved', () => {
  const model=clone(asset.scene), standing=standingPose();
  const calibration=calibratePoses([standing]);
  const apply=createPoseApplier(model,calibration);
  apply(standing);
  assert.ok(Math.abs(meshBounds(model,'ArmR').getCenter(new Vector3()).x-.952)<1e-5);
  assert.ok(Math.abs(meshBounds(model,'ArmL').getCenter(new Vector3()).x+.952)<1e-5);
  for(const y of [.9,.897,.894,.85,.65]) {
    const lifted=structuredClone(standing); lifted.landmarks[27].y=lifted.landmarks[28].y=y;
    const raw=structuredClone(lifted); apply(lifted);
    for(const side of ['L','R']) {
      const foot=meshBounds(model,`Foot${side}`);
      assert.ok(Math.abs(foot.getCenter(new Vector3()).z)<1e-5,'feet do not snap forward at the torso boundary');
      assert.ok(foot.min.y>=0,'feet stay above the floor');
    }
    assert.deepEqual(lifted,raw);
  }
});
test('live distance smoothing damps torso noise without changing recorded playback', () => {
  const standing=standingPose(), calibration=calibratePoses([standing],undefined,{adaptiveDistance:true});
  const live=clone(asset.scene), recorded=clone(asset.scene);
  const applyLive=createPoseApplier(live,calibration,{smoothDistance:true});
  const applyRecorded=createPoseApplier(recorded,calibration);
  applyLive(standing); applyRecorded(standing);
  const initial=meshBounds(live,'ArmR').getCenter(new Vector3()).x;
  const noise=structuredClone(standing); noise.landmarks[11].y-=.01; noise.landmarks[12].y-=.01;
  applyLive(noise,1/60); applyRecorded(noise);
  const liveJump=Math.abs(meshBounds(live,'ArmR').getCenter(new Vector3()).x-initial);
  const recordedJump=Math.abs(meshBounds(recorded,'ArmR').getCenter(new Vector3()).x-initial);
  assert.ok(liveJump<recordedJump/5,'a single noisy torso measurement cannot resize the whole avatar');
  for(let i=0;i<150;i++) applyLive(standing,1/60);
  assert.ok(Math.abs(meshBounds(live,'ArmR').getCenter(new Vector3()).x-initial)<1e-5);
});


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

test("retargeting preserves the pose under moving, rotated and nonuniformly scaled parents", () => {
  const names = ["Root", "Body", "Head", "ArmL", "ArmR", "FootL", "FootR"];
  for (const person of [0, 1]) {
    const local = clone(asset.scene), transformed = clone(asset.scene);
    const parent = new Group(), grandparent = new Group();
    parent.add(transformed);
    grandparent.add(parent);
    const applyLocal = createRetargeter(local, data, person);
    const applyTransformed = createRetargeter(transformed, data, person);
    for (let t = -0.1; t < data.durationMs / 1000 + 0.1; t += 1 / 30) {
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
