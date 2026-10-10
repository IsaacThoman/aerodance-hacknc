import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, useDisposable } from '../../shared/hooks.js';
import { show } from './palette.js';

// ---------------------------------------------------------------------------
// Geometry helpers: smooth tapered limbs and a sculpted torso (lathes).

function limbGeometry(len, r1, r2, bulge = 0.1, segments = 20) {
  const pts = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(r2 * Math.cos(a), 0.0001), -len + r2 * Math.sin(a) * 0.9));
  }
  const body = 10;
  for (let i = 1; i < body; i++) {
    const t = 1 - i / body; // 1 at bottom .. 0 at top
    const r = THREE.MathUtils.lerp(r1, r2, t) * (1 + bulge * Math.sin(Math.PI * Math.pow(1 - t, 0.8)));
    pts.push(new THREE.Vector2(r, -len * t));
  }
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(r1 * Math.cos(a), 0.0001), r1 * Math.sin(a) * 0.9));
  }
  return new THREE.LatheGeometry(pts, segments);
}

function torsoGeometry() {
  // Waist (y=0) up to the shoulders; flattened front-to-back afterwards.
  const profile = [
    [0.0001, -0.06], [0.16, -0.04], [0.235, 0.04], [0.25, 0.16], [0.27, 0.3], [0.33, 0.46],
    [0.39, 0.6], [0.425, 0.72], [0.42, 0.8], [0.37, 0.87], [0.26, 0.92], [0.12, 0.95], [0.0001, 0.96],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(profile, 28);
  g.scale(1, 1, 0.62);
  return g;
}

function pelvisGeometry() {
  const profile = [
    [0.0001, -0.2], [0.14, -0.18], [0.24, -0.1], [0.29, 0.0], [0.28, 0.1], [0.24, 0.16], [0.0001, 0.18],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(profile, 24);
  g.scale(1, 1, 0.72);
  return g;
}

// ---------------------------------------------------------------------------
// Pose slots (blended as flat arrays so there are no per-frame allocations).

const S = {
  rootRY: 0, rootX: 1, rootZ: 2, rootY: 3,
  hipX: 4, hipY: 5, hipZ: 6, hipRX: 7, hipRY: 8, hipRZ: 9,
  spineRX: 10, spineRY: 11, spineRZ: 12,
  chestRX: 13, chestRY: 14, chestRZ: 15,
  headRX: 16, headRY: 17, headRZ: 18,
  lAbd: 19, lFlex: 20, lTwist: 21, lElbow: 22,
  rAbd: 23, rFlex: 24, rTwist: 25, rElbow: 26,
  lFootX: 27, lFootY: 28, lFootZ: 29,
  rFootX: 30, rFootY: 31, rFootZ: 32,
  lWrist: 33, rWrist: 34,
};
const SLOTS = 35;
const ARM_L = [S.lAbd, S.lFlex, S.lTwist, S.lElbow, S.lWrist];
const ARM_R = [S.rAbd, S.rFlex, S.rTwist, S.rElbow, S.rWrist];

function rest(o) {
  o.fill(0);
  o[S.hipY] = -0.06;
  o[S.lAbd] = 0.18;
  o[S.rAbd] = 0.18;
  o[S.lElbow] = 0.3;
  o[S.rElbow] = 0.3;
  o[S.lFootX] = 0.26;
  o[S.rFootX] = -0.26;
}

const TAU = Math.PI * 2;
const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
// 1 on the beat, easing to 0 at the off-beat.
const onBeat = (b) => 0.5 + 0.5 * Math.cos(TAU * b);
// Smooth square wave alternating every beat (0 -> 1 -> 0 ...).
const flip = (b, sharp = 0.25) => {
  const p = b % 2;
  return smooth(clamp01(p / sharp)) * (1 - smooth(clamp01((p - 1) / sharp)));
};

// Each move writes a pose for continuous beat time `b` (beats).
const MOVES = [
  // Step-touch groove with finger snaps.
  function stepTouch(b, o) {
    rest(o);
    const w = Math.sin((Math.PI * b) / 2);
    const bounce = onBeat(b);
    o[S.hipX] = 0.16 * w;
    o[S.hipY] = -0.1 - 0.1 * bounce;
    o[S.hipRZ] = -0.1 * w;
    o[S.hipRY] = 0.12 * Math.sin((Math.PI * b) / 2 + 0.6);
    o[S.spineRZ] = 0.07 * w;
    o[S.chestRZ] = 0.06 * w;
    o[S.chestRX] = 0.05 * bounce;
    o[S.headRX] = 0.12 * bounce - 0.04;
    o[S.headRZ] = -0.08 * w;
    const outL = Math.max(w, 0);
    const outR = Math.max(-w, 0);
    o[S.lFootX] = 0.2 + 0.26 * outL;
    o[S.rFootX] = -0.2 - 0.26 * outR;
    o[S.lFootY] = 0.16 * Math.max(0, -Math.sin((Math.PI * b) / 2)) * (1 - bounce * 0.5);
    o[S.rFootY] = 0.16 * Math.max(0, Math.sin((Math.PI * b) / 2)) * (1 - bounce * 0.5);
    o[S.lAbd] = 0.4 + 0.25 * outL;
    o[S.rAbd] = 0.4 + 0.25 * outR;
    o[S.lFlex] = 0.5 + 0.25 * bounce;
    o[S.rFlex] = 0.5 + 0.25 * bounce;
    o[S.lElbow] = 1.5 - 0.3 * outL;
    o[S.rElbow] = 1.5 - 0.3 * outR;
    o[S.lTwist] = 0.3;
    o[S.rTwist] = 0.3;
    o[S.lWrist] = 0.4 * bounce;
    o[S.rWrist] = 0.4 * bounce;
  },
  // Disco point: right arm up to the sky, then down across the body.
  function discoPoint(b, o) {
    rest(o);
    const up = 1 - flip(b, 0.3);
    const sway = Math.sin(Math.PI * b);
    const bounce = onBeat(b);
    o[S.hipX] = 0.12 * sway;
    o[S.hipY] = -0.12 - 0.07 * bounce;
    o[S.hipRZ] = -0.12 * sway;
    o[S.hipRY] = -0.25 + 0.2 * up;
    o[S.chestRY] = -0.15 + 0.25 * up;
    o[S.chestRZ] = 0.08 * sway - 0.08 * up;
    o[S.headRY] = -0.35 * up + 0.15;
    o[S.headRX] = -0.18 * up + 0.08;
    o[S.rAbd] = THREE.MathUtils.lerp(-0.25, 2.45, up);
    o[S.rFlex] = THREE.MathUtils.lerp(0.75, 0.25, up);
    o[S.rElbow] = THREE.MathUtils.lerp(0.25, 0.05, up);
    o[S.rTwist] = 0.2;
    // Left hand on the hip.
    o[S.lAbd] = 0.85;
    o[S.lFlex] = -0.35;
    o[S.lTwist] = -1.2;
    o[S.lElbow] = 1.9;
    o[S.rFootX] = -0.28 - 0.14 * up;
    o[S.rFootZ] = 0.12 * up;
    o[S.rFootY] = 0.04 * up;
    o[S.lFootX] = 0.22;
  },
  // Arms raised in a V, swaying side to side like a festival crowd.
  function armWave(b, o) {
    rest(o);
    const sway = Math.sin((Math.PI * b) / 2);
    const bounce = onBeat(b);
    o[S.hipX] = 0.18 * sway;
    o[S.hipY] = -0.12 - 0.12 * bounce;
    o[S.hipRZ] = -0.12 * sway;
    o[S.spineRZ] = 0.1 * sway;
    o[S.chestRZ] = 0.1 * sway;
    o[S.chestRX] = -0.08;
    o[S.headRX] = -0.15 + 0.08 * bounce;
    o[S.headRZ] = 0.1 * sway;
    o[S.lAbd] = 2.55 + 0.3 * sway;
    o[S.rAbd] = 2.55 - 0.3 * sway;
    o[S.lFlex] = 0.15;
    o[S.rFlex] = 0.15;
    o[S.lElbow] = 0.35 + 0.2 * Math.max(0, -sway);
    o[S.rElbow] = 0.35 + 0.2 * Math.max(0, sway);
    o[S.lTwist] = 1.2;
    o[S.rTwist] = 1.2;
    o[S.lWrist] = 0.4 * sway;
    o[S.rWrist] = -0.4 * sway;
    o[S.lFootX] = 0.3;
    o[S.rFootX] = -0.3;
    o[S.lFootY] = 0.1 * Math.max(0, Math.sin(Math.PI * b)) * (sway < 0 ? 1 : 0);
    o[S.rFootY] = 0.1 * Math.max(0, Math.sin(Math.PI * b)) * (sway > 0 ? 1 : 0);
  },
  // Pirouette with arms flung wide, then a "ta-da" pose and a hip sway.
  function spin(b, o) {
    rest(o);
    const lb = b % 8;
    const s = smooth(clamp01((lb - 0.5) / 2.0));
    const spinning = Math.sin(Math.PI * s);
    o[S.rootRY] = (TAU * s) % TAU;
    o[S.hipY] = -0.08 + 0.06 * spinning;
    o[S.lFootX] = 0.24 - 0.12 * spinning;
    o[S.rFootX] = -0.24 + 0.12 * spinning;
    o[S.rFootY] = 0.22 * spinning;
    o[S.rFootX] += 0.1 * spinning;
    o[S.rFootZ] = 0.05 * spinning;
    const wide = spinning;
    const pose = smooth(clamp01((lb - 2.6) / 0.5)) * (1 - smooth(clamp01((lb - 6.5) / 1.0)));
    const sway = Math.sin(Math.PI * b) * pose;
    o[S.hipX] = 0.14 * sway;
    o[S.hipRZ] = -0.14 * sway;
    o[S.chestRZ] = 0.1 * sway;
    o[S.headRX] = -0.12 * wide - 0.1 * pose;
    o[S.headRZ] = 0.15 * pose;
    o[S.lAbd] = 0.2 + 1.3 * wide + 2.3 * pose;
    o[S.rAbd] = 0.2 + 1.3 * wide + 0.6 * pose;
    o[S.lElbow] = 0.3 - 0.2 * wide;
    o[S.rElbow] = 0.3 + 1.5 * pose;
    o[S.rFlex] = -0.3 * pose;
    o[S.rTwist] = -1.2 * pose;
    o[S.lTwist] = 0.6 * pose;
    o[S.lWrist] = 0.5 * pose;
  },
  // Bounce and fist pump, head nodding with the kick drum.
  function pump(b, o) {
    rest(o);
    const bounce = onBeat(b);
    const p = flip(b, 0.2);
    const side = Math.sin((Math.PI * b) / 4);
    o[S.hipY] = -0.14 - 0.16 * bounce;
    o[S.hipZ] = -0.04 * bounce;
    o[S.hipRX] = 0.08 * bounce;
    o[S.hipRY] = 0.2 * side;
    o[S.spineRX] = 0.1 * bounce;
    o[S.chestRY] = 0.15 * side;
    o[S.headRX] = 0.22 * bounce - 0.06;
    o[S.rAbd] = THREE.MathUtils.lerp(0.9, 2.2, 1 - p);
    o[S.rFlex] = THREE.MathUtils.lerp(0.9, 0.6, 1 - p);
    o[S.rElbow] = THREE.MathUtils.lerp(1.9, 0.5, 1 - p);
    o[S.rTwist] = 0.4;
    o[S.lAbd] = 0.45 + 0.1 * bounce;
    o[S.lFlex] = 0.6 + 0.3 * p;
    o[S.lElbow] = 1.6;
    o[S.lTwist] = 0.4;
    o[S.lFootX] = 0.3;
    o[S.rFootX] = -0.3;
    o[S.lFootZ] = 0.08 * side;
    o[S.rFootZ] = -0.08 * side;
  },
  // Flowing body roll with ribbon-like arms.
  function bodyRoll(b, o) {
    rest(o);
    const ph = (Math.PI * b) / 2;
    const roll = Math.sin(ph);
    const bounce = onBeat(b);
    o[S.hipZ] = 0.08 * Math.sin(ph - 1.2);
    o[S.hipX] = 0.1 * Math.sin(ph * 0.5);
    o[S.hipY] = -0.12 - 0.08 * bounce;
    o[S.hipRX] = -0.12 * Math.sin(ph - 1.2);
    o[S.spineRX] = 0.14 * Math.sin(ph - 0.6);
    o[S.chestRX] = 0.16 * Math.sin(ph);
    o[S.headRX] = -0.18 * Math.sin(ph + 0.6);
    o[S.hipRZ] = -0.08 * Math.sin(ph * 0.5);
    o[S.chestRZ] = 0.08 * Math.sin(ph * 0.5);
    o[S.lAbd] = 1.3 + 0.5 * Math.sin(ph + 0.4);
    o[S.rAbd] = 1.3 + 0.5 * Math.sin(ph + 0.4 + Math.PI);
    o[S.lFlex] = 0.4;
    o[S.rFlex] = 0.4;
    o[S.lElbow] = 0.5 + 0.5 * Math.sin(ph + 1.4);
    o[S.rElbow] = 0.5 + 0.5 * Math.sin(ph + 1.4 + Math.PI);
    o[S.lTwist] = 0.9;
    o[S.rTwist] = 0.9;
    o[S.lWrist] = 0.6 * Math.sin(ph + 2.2);
    o[S.rWrist] = 0.6 * Math.sin(ph + 2.2 + Math.PI);
    o[S.lFootX] = 0.28;
    o[S.rFootX] = -0.28;
  },
];

// Celebration when DANCE! is pressed: hop, spin and both arms up.
function celebrate(t, o) {
  rest(o);
  const hop = Math.max(0, Math.sin(Math.PI * clamp01((t - 0.15) / 0.55)));
  const s = smooth(clamp01((t - 0.12) / 0.75));
  o[S.rootRY] = (TAU * s) % TAU;
  o[S.rootY] = 0.55 * hop;
  o[S.hipY] = -0.2 * (1 - hop) * clamp01(t / 0.15) + 0.05 * hop;
  o[S.lAbd] = 2.7;
  o[S.rAbd] = 2.7;
  o[S.lElbow] = 0.15;
  o[S.rElbow] = 0.15;
  o[S.lTwist] = 1.2;
  o[S.rTwist] = 1.2;
  o[S.headRX] = -0.3;
  o[S.lFootY] = 0.18 * hop;
  o[S.rFootY] = 0.18 * hop;
  o[S.lFootX] = 0.16;
  o[S.rFootX] = -0.16;
}

// ---------------------------------------------------------------------------

const THIGH = 1.0;
const SHIN = 0.95;
const ANKLE_H = 0.13;
const HIP_H = 2.02;
const HIP_W = 0.2;

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const axis = new THREE.Vector3();
const qBase = new THREE.Quaternion();
const qSwivel = new THREE.Quaternion();
const qTmp = new THREE.Quaternion();
const qYaw = new THREE.Quaternion();
const eTmp = new THREE.Euler(0, 0, 0, 'ZXY');
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Two-bone leg IK in the hips' space. `swivel` rotates the knee outward
 * around the hip->ankle line (feet stay planted) so bends read from the front.
 */
function solveLeg(hips, side, fx, fy, fz, swivel, thigh, knee, ankle) {
  hips.updateMatrix();
  tmpM.copy(hips.matrix).invert();
  tmpV.set(fx, fy + ANKLE_H, fz).applyMatrix4(tmpM);
  const dx = tmpV.x - side * HIP_W;
  const dy = tmpV.y + 0.06;
  const dz = tmpV.z;
  const a = THIGH;
  const b = SHIN;
  let L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  L = Math.min(Math.max(L, 0.3), (a + b) * 0.9995);
  const rz = Math.atan2(dx, -dy);
  const down = Math.sqrt(dx * dx + dy * dy);
  const theta = Math.atan2(-dz, down);
  const cosA = (a * a + L * L - b * b) / (2 * a * L);
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const cosK = (a * a + b * b - L * L) / (2 * a * b);
  const bend = Math.PI - Math.acos(Math.min(1, Math.max(-1, cosK)));
  eTmp.set(theta - alpha, 0, rz, 'ZXY');
  qBase.setFromEuler(eTmp);
  axis.set(dx, dy, dz).normalize();
  qSwivel.setFromAxisAngle(axis, -side * swivel);
  thigh.quaternion.multiplyQuaternions(qSwivel, qBase);
  knee.rotation.set(bend, 0, 0);
  knee.updateMatrix();
  // Foot flat on the floor (level in root space), toes turned out slightly.
  qTmp.multiplyQuaternions(hips.quaternion, thigh.quaternion).multiply(knee.quaternion).invert();
  qYaw.setFromAxisAngle(Y_AXIS, side * 0.18);
  ankle.quaternion.multiplyQuaternions(qTmp, qYaw);
}

function setArm(shoulder, elbow, wrist, side, abd, flex, twist, bend, wristBend) {
  shoulder.rotation.set(-flex, side * twist, side * abd);
  elbow.rotation.set(-bend, 0, 0);
  wrist.rotation.set(-wristBend * 0.5, 0, side * wristBend * 0.4);
}

/**
 * Stylised pearl-and-chrome dancer made of smooth capsules, wearing glossy
 * headphones. Procedurally dances on the shared 118 bpm clock.
 */
export function Dancer({ env, position = [0, 0, 0], offset = 0, mirror = false, scale = 1, accent = 0 }) {
  const geo = useDisposable(() => ({
    torso: torsoGeometry(),
    pelvis: pelvisGeometry(),
    abdomen: limbGeometry(0.26, 0.2, 0.22, 0.0, 20),
    neck: limbGeometry(0.16, 0.085, 0.1, 0.0, 14),
    head: new THREE.SphereGeometry(0.3, 32, 24),
    upperArm: limbGeometry(0.66, 0.112, 0.088, 0.16),
    forearm: limbGeometry(0.6, 0.088, 0.064, 0.14),
    thigh: limbGeometry(THIGH, 0.185, 0.115, 0.14),
    shin: limbGeometry(SHIN, 0.115, 0.075, 0.2),
    joint: new THREE.SphereGeometry(1, 20, 14),
    hand: new THREE.SphereGeometry(1, 16, 12),
    foot: new THREE.SphereGeometry(1, 18, 12),
    band: new THREE.TorusGeometry(0.33, 0.032, 10, 40, Math.PI),
    cup: new THREE.CylinderGeometry(0.12, 0.12, 0.09, 24),
    cupRing: new THREE.TorusGeometry(0.12, 0.022, 8, 28),
    belt: new THREE.TorusGeometry(0.255, 0.03, 8, 40),
  }));

  const mats = useDisposable(
    () => ({
      pearl: new THREE.MeshPhysicalMaterial({
        color: '#fffafd',
        roughness: 0.16,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        iridescence: 0.6,
        iridescenceIOR: 1.35,
        iridescenceThicknessRange: [220, 520],
        sheen: 0.4,
        sheenColor: new THREE.Color('#ffd0ec'),
        envMap: env,
        envMapIntensity: 0.8,
      }),
      chrome: new THREE.MeshStandardMaterial({ color: '#f2f6ff', metalness: 1, roughness: 0.12, envMap: env, envMapIntensity: 1.0 }),
      glow: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.5, roughness: 0.3, envMap: env }),
      suit: new THREE.MeshPhysicalMaterial({
        color: '#2fb8e6',
        roughness: 0.14,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        iridescence: 0.35,
        iridescenceIOR: 1.4,
        envMap: env,
        envMapIntensity: 1.0,
      }),
      gel: new THREE.MeshPhysicalMaterial({ color: '#ff8ccf', roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMap: env, envMapIntensity: 1.2 }),
    }),
    [env],
  );

  const r = useRef({});
  const ref = (name) => (el) => {
    r.current[name] = el;
  };
  const pose = useMemo(() => ({ a: new Float32Array(SLOTS), b: new Float32Array(SLOTS), c: new Float32Array(SLOTS), out: new Float32Array(SLOTS) }), []);

  useFrame((state) => {
    const j = r.current;
    if (!j.root) return;
    const bt = beat.beat + beat.phase + offset;
    const cycle = 8;
    const moveIdx = Math.floor(bt / cycle);
    const lb = bt - moveIdx * cycle;
    const count = MOVES.length;
    const A = MOVES[((moveIdx % count) + count) % count];
    const B = MOVES[(((moveIdx + 1) % count) + count) % count];
    A(bt, pose.a);
    const o = pose.out;
    const blend = smooth(clamp01((lb - 7.4) / 0.6));
    if (blend > 0) {
      B(bt, pose.b);
      for (let i = 0; i < SLOTS; i++) o[i] = pose.a[i] + (pose.b[i] - pose.a[i]) * blend;
    } else {
      o.set(pose.a);
    }
    const t = show.burst;
    if (t < 1.6) {
      celebrate(t, pose.c);
      const w = smooth(clamp01(t / 0.12)) * (1 - smooth(clamp01((t - 1.2) / 0.4)));
      for (let i = 0; i < SLOTS; i++) o[i] += (pose.c[i] - o[i]) * w;
    }
    const m = mirror ? -1 : 1;
    // Breathing / idle micro motion.
    const time = state.clock.elapsedTime;
    o[S.chestRX] += Math.sin(time * 1.3) * 0.015;

    j.root.position.set(position[0] + o[S.rootX] * m, position[1] + o[S.rootY], position[2] + o[S.rootZ]);
    j.root.rotation.set(0, o[S.rootRY] * m, 0);
    // A slightly deeper, more athletic stance than the raw poses.
    j.hips.position.set(o[S.hipX] * m, HIP_H + o[S.hipY] - 0.06, o[S.hipZ]);
    j.hips.rotation.set(o[S.hipRX], o[S.hipRY] * m, o[S.hipRZ] * m);
    j.spine.rotation.set(o[S.spineRX], o[S.spineRY] * m, o[S.spineRZ] * m);
    j.chest.rotation.set(o[S.chestRX], o[S.chestRY] * m, o[S.chestRZ] * m);
    j.head.rotation.set(o[S.headRX], o[S.headRY] * m, o[S.headRZ] * m);
    // Arms and legs (mirroring swaps sides).
    const armA = mirror ? ARM_R : ARM_L;
    const armB = mirror ? ARM_L : ARM_R;
    setArm(j.lShoulder, j.lElbow, j.lWrist, 1, o[armA[0]], o[armA[1]], o[armA[2]], o[armA[3]], o[armA[4]]);
    setArm(j.rShoulder, j.rElbow, j.rWrist, -1, o[armB[0]], o[armB[1]], o[armB[2]], o[armB[3]], o[armB[4]]);
    // Knees flare out more as the hips sink.
    const swivel = 0.22 + Math.max(0, -o[S.hipY] - 0.06) * 2.2;
    if (mirror) {
      solveLeg(j.hips, 1, -o[S.rFootX], o[S.rFootY], o[S.rFootZ], swivel, j.lThigh, j.lKnee, j.lAnkle);
      solveLeg(j.hips, -1, -o[S.lFootX], o[S.lFootY], o[S.lFootZ], swivel, j.rThigh, j.rKnee, j.rAnkle);
    } else {
      solveLeg(j.hips, 1, o[S.lFootX], o[S.lFootY], o[S.lFootZ], swivel, j.lThigh, j.lKnee, j.lAnkle);
      solveLeg(j.hips, -1, o[S.rFootX], o[S.rFootY], o[S.rFootZ], swivel, j.rThigh, j.rKnee, j.rAnkle);
    }

    const c = show.colors[accent % 3];
    mats.glow.emissive.copy(c);
    mats.glow.color.copy(c);
    mats.glow.emissiveIntensity = 1.4 + beat.pulse * 1.6;
    mats.gel.color.copy(show.colors[(accent + 1) % 3]);
  });

  const { pearl, chrome, glow, gel, suit } = mats;
  const arm = (side) => {
    const p = side > 0 ? 'l' : 'r';
    return (
      <group ref={ref(`${p}Shoulder`)} position={[side * 0.43, 0.74, 0]} rotation-order="ZXY">
        <mesh geometry={geo.joint} material={chrome} scale={0.125} />
        <mesh geometry={geo.upperArm} material={pearl} />
        <group ref={ref(`${p}Elbow`)} position={[0, -0.66, 0]}>
          <mesh geometry={geo.joint} material={chrome} scale={0.088} />
          <mesh geometry={geo.forearm} material={pearl} />
          <group ref={ref(`${p}Wrist`)} position={[0, -0.62, 0]}>
            <mesh geometry={geo.hand} material={gel} position={[0, -0.07, 0]} scale={[0.08, 0.125, 0.055]} />
          </group>
        </group>
      </group>
    );
  };
  const leg = (side) => {
    const p = side > 0 ? 'l' : 'r';
    return (
      <group ref={ref(`${p}Thigh`)} position={[side * HIP_W, -0.06, 0]} rotation-order="ZXY">
        <mesh geometry={geo.joint} material={chrome} scale={0.14} />
        <mesh geometry={geo.thigh} material={suit} />
        <group ref={ref(`${p}Knee`)} position={[0, -THIGH, 0]}>
          <mesh geometry={geo.joint} material={chrome} scale={0.1} />
          <mesh geometry={geo.shin} material={pearl} />
          <group ref={ref(`${p}Ankle`)} position={[0, -SHIN, 0]} rotation-order="ZXY">
            <mesh geometry={geo.foot} material={gel} position={[0, -0.05, 0.08]} scale={[0.11, 0.08, 0.22]} />
          </group>
        </group>
      </group>
    );
  };

  return (
    <group scale={scale}>
      <group ref={ref('root')}>
        <group ref={ref('hips')} position={[0, HIP_H, 0]}>
          <mesh geometry={geo.pelvis} material={suit} />
          <mesh geometry={geo.belt} material={glow} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.13, 0]} scale={[1.02, 0.74, 1]} />
          <group ref={ref('spine')} position={[0, 0.12, 0]}>
            <mesh geometry={geo.abdomen} material={chrome} position={[0, 0.2, 0]} scale={[1, 1, 0.72]} />
            <group ref={ref('chest')} position={[0, 0.2, 0]}>
              <mesh geometry={geo.torso} material={suit} />
              <group position={[0, 0.9, 0]}>
                <mesh geometry={geo.neck} material={chrome} position={[0, 0.14, 0]} />
                <group ref={ref('head')} position={[0, 0.14, 0]}>
                  <mesh geometry={geo.head} material={pearl} position={[0, 0.27, 0.01]} scale={[0.9, 1.12, 0.98]} />
                  <mesh geometry={geo.band} material={chrome} position={[0, 0.27, -0.02]} scale={[0.94, 1.05, 1]} />
                  {[-1, 1].map((s) => (
                    <group key={s} position={[s * 0.3, 0.25, 0]} rotation={[0, 0, Math.PI / 2]}>
                      <mesh geometry={geo.cup} material={gel} />
                      <mesh geometry={geo.cupRing} material={glow} position={[0, s * 0.05, 0]} rotation={[Math.PI / 2, 0, 0]} />
                    </group>
                  ))}
                </group>
              </group>
              {arm(1)}
              {arm(-1)}
            </group>
          </group>
          {leg(1)}
          {leg(-1)}
        </group>
      </group>
    </group>
  );
}
