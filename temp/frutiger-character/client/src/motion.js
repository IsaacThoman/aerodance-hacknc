import { Matrix4, Vector3 } from "three";

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const median = (values) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const midpoint = (p, a, b) => p[a].map((x, i) => (x + p[b][i]) / 2);

export function validateMotion(data) {
  if (
    data.version !== 1 ||
    !(data.duration > 0) ||
    data.times?.length < 2 ||
    data.times?.length !== data.poses?.length ||
    !(data.source?.width > 0) ||
    !(data.source?.height > 0)
  ) {
    throw new Error("Invalid dance capture");
  }
  data.times.forEach((time, i) => {
    if (
      !Number.isFinite(time) ||
      time < 0 ||
      time >= data.duration ||
      (i && time <= data.times[i - 1]) ||
      data.poses[i].length !== 2 ||
      data.poses[i].some(
        (p) =>
          p.length !== 33 ||
          p.some((j) => j.length !== 4 || !j.every(Number.isFinite)),
      )
    ) {
      throw new Error("Invalid dance samples");
    }
  });
  return data;
}

// Interpolation uses recorded presentation timestamps, independent of rendering FPS.
// The final 0.35s blends back into the first pose to hide the capture's hard cut.
export function samplePose(data, person, seconds, out) {
  const time = ((seconds % data.duration) + data.duration) % data.duration;
  let lo = 0,
    hi = data.times.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (data.times[mid] <= time) lo = mid;
    else hi = mid;
  }
  const alpha = clamp(
    (time - data.times[lo]) / (data.times[hi] - data.times[lo]),
    0,
    1,
  );
  const blend = clamp(
    (time - (data.duration - Math.min(0.35, data.duration / 4))) /
      Math.min(0.35, data.duration / 4),
    0,
    1,
  );
  const smooth = blend * blend * (3 - 2 * blend);
  for (let j = 0; j < 33; j++)
    for (let axis = 0; axis < 4; axis++) {
      const a = data.poses[lo][person][j][axis];
      const value = a + (data.poses[hi][person][j][axis] - a) * alpha;
      out[j][axis] = value + (data.poses[0][person][j][axis] - value) * smooth;
    }
  return out;
}

export function createRetargeter(model, data, person) {
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
  });
  for (const name of [
    "Root",
    "Body",
    "Head",
    "ArmL",
    "ArmR",
    "FootL",
    "FootR",
  ]) {
    if (!bones[name]) throw new Error(`Missing rig bone: ${name}`);
  }
  const aspect = data.source.width / data.source.height;
  const samples = data.poses.map((frame) => frame[person]);
  const torso = median(
    samples.map((p) => {
      const h = midpoint(p, 23, 24),
        s = midpoint(p, 11, 12);
      return Math.hypot((s[0] - h[0]) * aspect, s[1] - h[1]);
    }),
  );
  const scale = 1.05 / torso;
  const baseHip = midpoint(samples[0], 23, 24);
  const floor = median(samples.map((p) => Math.max(p[27][1], p[28][1])));
  const pose = Array.from({ length: 33 }, () => [0, 0, 0, 0]);
  const target = new Vector3(),
    offset = new Vector3();
  const parentInverse = new Matrix4();
  // Meshes have rigid weights. Place their centers, compensating for bone pivots.
  function center(bone, x, y, z, ox, oy, oz) {
    target.set(x, y, z);
    // The rig and its ancestors are current for this pose. Avoid walking and
    // recomposing that same chain twice for every hand and foot.
    target.applyMatrix4(model.matrixWorld);
    target.applyMatrix4(parentInverse.copy(bone.parent.matrixWorld).invert());
    offset.set(ox, oy, oz).applyQuaternion(bone.quaternion);
    bone.position.copy(target.sub(offset));
    bone.updateMatrixWorld(true);
  }
  return (seconds) => {
    const p = samplePose(data, person, seconds, pose);
    const hip = midpoint(p, 23, 24),
      shoulder = midpoint(p, 11, 12);
    const rootX = (hip[0] - baseHip[0]) * aspect * scale;
    const rootY = clamp((baseHip[1] - hip[1]) * scale * 0.65, -0.35, 0.65);
    bones.Root.position.set(rootX, rootY, 0);
    const roll = clamp(
      -Math.atan2((shoulder[0] - hip[0]) * aspect, hip[1] - shoulder[1]),
      -0.65,
      0.65,
    );
    const yaw = clamp(
      Math.atan2(p[11][2] - p[12][2], Math.abs(p[11][0] - p[12][0]) * aspect),
      -0.8,
      0.8,
    );
    bones.Body.rotation.set(0, yaw * 0.45, roll);
    const ears = midpoint(p, 7, 8);
    const headYaw = clamp(
      (p[0][0] - ears[0]) * aspect * scale * 2,
      -0.65,
      0.65,
    );
    const headRoll = clamp(
      -Math.atan2(p[7][1] - p[8][1], Math.abs(p[7][0] - p[8][0]) * aspect),
      -0.45,
      0.45,
    );
    bones.Head.rotation.set(0, headYaw - yaw * 0.45, headRoll - roll);
    model.updateWorldMatrix(true, true);
    // Anatomical right is screen-left in a frontal capture; the asset L/R are screen-side names.
    for (const [side, wrist, ankle, sign] of [
      ["L", 16, 28, -1],
      ["R", 15, 27, 1],
    ]) {
      center(
        bones[`Arm${side}`],
        rootX + (p[wrist][0] - hip[0]) * aspect * scale,
        rootY + 1.1 + (hip[1] - p[wrist][1]) * scale,
        clamp(-(p[wrist][2] - hip[2]) * scale * 0.35, -0.7, 0.9),
        sign * 0.26,
        -0.86,
        0,
      );
      center(
        bones[`Foot${side}`],
        rootX + (p[ankle][0] - hip[0]) * aspect * scale,
        Math.max(0.3, 0.3 + (floor - p[ankle][1]) * scale),
        clamp(-(p[ankle][2] - hip[2]) * scale * 0.25, -0.45, 0.45),
        0,
        0,
        0.13,
      );
    }
  };
}
