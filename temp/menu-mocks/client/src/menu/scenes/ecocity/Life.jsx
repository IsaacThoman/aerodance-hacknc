import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { GROUND, LANDMARKS, MONORAIL_Y, SUN, TOWERS, groundHeight, shoreZ } from './layout.js';
import { cityUniforms } from './materials.js';
import { reactions } from './reactions.js';
import { makeBlimp, makePod, makeSailboat, makeTrainCar, makeTurbine, makeVehicleMaterial } from './vehicles.js';
import { LAYER_NO_REFLECT, MAX_BOATS, waterUniforms } from './Water.jsx';

// Everything that moves: monorail, pods, air taxis, the airship, birds,
// sailboats, wind turbines, glints and the menu focus halo.

// Free per-instance GPU buffers when an InstancedMesh goes away.
function useInstancedDispose(mesh) {
  useEffect(() => () => mesh.dispose(), [mesh]);
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);

export function Train({ city }) {
  const geometry = useDisposable(() => makeTrainCar());
  const material = useDisposable(() => makeVehicleMaterial('train'));
  const cars = 5;
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, cars);
    m.frustumCulled = false;
    return m;
  }, [geometry, material]);
  useInstancedDispose(mesh);
  const loop = city.monorail;
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const n = loop.points.length;
    const head = (t * 17 + 300) % loop.total;
    for (let k = 0; k < cars; k++) {
      let s = head - k * 14.6;
      if (s < 0) s += loop.total;
      const f = s / loop.step;
      const i0 = Math.floor(f) % n;
      const i1 = (i0 + 1) % n;
      const a = f - Math.floor(f);
      const p0 = loop.points[i0];
      const p1 = loop.points[i1];
      const t0 = loop.tangents[i0];
      const t1 = loop.tangents[i1];
      const tx = t0.x + (t1.x - t0.x) * a;
      const tz = t0.y + (t1.y - t0.y) * a;
      tmpP.set(p0.x + (p1.x - p0.x) * a, MONORAIL_Y + 2.1, p0.y + (p1.y - p0.y) * a);
      tmpE.set(0, Math.atan2(-tz, tx), 0);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(k, tmpM);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
}

const POD_COLORS = ['#ffffff', '#7ed957', '#38c6f4', '#ffd23f', '#ff8fb1', '#9ff0e2', '#ffffff', '#2d8cf0'];

export function Pods() {
  const geometry = useDisposable(() => {
    const rand = makeRandom(31);
    const lanes = [];
    const add = (a, b, n, y = GROUND + 0.72, speed = [10, 14]) => {
      for (let i = 0; i < n; i++) lanes.push({ a, b, phase: i / n + rand.range(-0.03, 0.03), y, speed: rand.range(speed[0], speed[1]) });
    };
    add([-380, 17.6], [380, 17.6], 10);
    add([380, 22.4], [-380, 22.4], 10);
    add([-360, -67.6], [350, -67.6], 6);
    add([350, -72.4], [-360, -72.4], 6);
    add([-360, -162.6], [350, -162.6], 4);
    add([350, -167.4], [-360, -167.4], 4);
    for (const x of [-150, -50, 50, 150]) {
      add([x - 2.2, 22], [x - 2.2, -338], 3);
      add([x + 2.2, -338], [x + 2.2, 22], 3);
    }
    const base = makePod();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    const lane = new Float32Array(lanes.length * 4);
    const move = new Float32Array(lanes.length * 4);
    lanes.forEach((l, i) => {
      lane.set([l.a[0], l.a[1], l.b[0], l.b[1]], i * 4);
      move.set([l.speed, l.phase, l.y, 0], i * 4);
    });
    g.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4));
    g.setAttribute('aMove', new THREE.InstancedBufferAttribute(move, 4));
    g.instanceCount = lanes.length;
    g.userData.count = lanes.length;
    return g;
  });
  const material = useDisposable(() => makeVehicleMaterial('pod'));
  const mesh = useMemo(() => {
    const n = geometry.userData.count;
    const m = new THREE.InstancedMesh(geometry, material, n);
    const rand = makeRandom(8);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) m.setColorAt(i, c.set(rand.pick(POD_COLORS)));
    m.frustumCulled = false;
    return m;
  }, [geometry, material]);
  useInstancedDispose(mesh);
  return <primitive object={mesh} />;
}

export function AirTaxis() {
  const geometry = useDisposable(() => {
    const routes = [
      // cx, cz, rx, rz, angular speed, phase, y, bob
      [40, 70, 300, 60, 0.05, 0.0, 44, 1.5],
      [40, 70, 300, 60, 0.05, 0.5, 44, 1.5],
      [60, 90, 340, 80, -0.042, 0.2, 58, 2],
      [60, 90, 340, 80, -0.042, 0.72, 58, 2],
      [0, 40, 380, 50, 0.036, 0.35, 70, 2.5],
      [120, 60, 260, 70, -0.06, 0.9, 36, 1.2],
      [-60, -60, 420, 330, 0.03, 0.1, 238, 3],
      [-60, -60, 420, 330, 0.03, 0.6, 246, 3],
    ];
    const base = makePod();
    base.scale(1.6, 1.6, 1.6);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    const lane = new Float32Array(routes.length * 4);
    const move = new Float32Array(routes.length * 4);
    routes.forEach((r, i) => {
      lane.set(r.slice(0, 4), i * 4);
      move.set(r.slice(4, 8), i * 4);
    });
    g.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4));
    g.setAttribute('aMove', new THREE.InstancedBufferAttribute(move, 4));
    g.instanceCount = routes.length;
    g.userData.count = routes.length;
    return g;
  });
  const material = useDisposable(() => makeVehicleMaterial('pod', { air: true }));
  const mesh = useMemo(() => {
    const n = geometry.userData.count;
    const m = new THREE.InstancedMesh(geometry, material, n);
    const c = new THREE.Color();
    const cols = ['#ffffff', '#38c6f4', '#7ed957', '#ffffff', '#ffd23f', '#ffffff', '#ffffff', '#38c6f4'];
    for (let i = 0; i < n; i++) m.setColorAt(i, c.set(cols[i % cols.length]));
    m.frustumCulled = false;
    return m;
  }, [geometry, material]);
  useInstancedDispose(mesh);
  return <primitive object={mesh} />;
}

function makeScreenTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 192);
  g.addColorStop(0, '#0a3d7a');
  g.addColorStop(1, '#03203f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 192);
  ctx.font = '700 104px Comfortaa, Nunito, sans-serif';
  ctx.textBaseline = 'middle';
  const tg = ctx.createLinearGradient(0, 40, 0, 150);
  tg.addColorStop(0, '#e6fbff');
  tg.addColorStop(0.5, '#5fd3ff');
  tg.addColorStop(1, '#1b8fe0');
  ctx.fillStyle = tg;
  ctx.shadowColor = 'rgba(120,220,255,0.9)';
  ctx.shadowBlur = 18;
  ctx.fillText('aerodance', 30, 92);
  ctx.shadowBlur = 0;
  ctx.font = '800 34px Nunito, sans-serif';
  ctx.fillStyle = '#b8f56a';
  ctx.fillText('ECO CITY DANCE FEST  ✦  TONIGHT', 560, 70);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('ON THE BAY STAGE', 560, 120);
  // Pixel grid for an LED look.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 0; x < 1024; x += 4) ctx.fillRect(x, 0, 1, 192);
  for (let y = 0; y < 192; y += 4) ctx.fillRect(0, y, 1024, 1);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function makeScreenGeometry() {
  const g = new THREE.PlaneGeometry(30, 6.4, 24, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i) + 1.2;
    const u = (x + 32) / 64;
    const r = 10.5 * Math.pow(Math.sin(Math.PI * u), 0.72) * (1 - 0.18 * (1 - u)) + 0.18;
    p.setXYZ(i, x, y, Math.sqrt(Math.max(r * r - y * y, 0)));
  }
  g.computeVertexNormals();
  return g;
}

export function Blimp() {
  const group = useRef();
  const body = useDisposable(() => makeBlimp());
  const bodyMat = useDisposable(() => makeVehicleMaterial('blimp'));
  const screenTex = useDisposable(() => makeScreenTexture());
  const screenGeo = useDisposable(() => makeScreenGeometry());
  const screenMat = useDisposable(() => new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(1.15, 1.15, 1.15) }));
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const span = 1500;
    const x = -700 + ((t * 5.5 + 820) % span);
    const g = group.current;
    g.position.set(x, 196 + Math.sin(t * 0.3) * 3, -165 + Math.sin(t * 0.05) * 12);
    g.rotation.set(0, Math.sin(t * 0.05) * 0.08, Math.sin(t * 0.4) * 0.02);
    screenTex.offset.x = (t * 0.03) % 1;
  });
  return (
    <group ref={group}>
      <mesh geometry={body} material={bodyMat} />
      <mesh geometry={screenGeo} material={screenMat} />
    </group>
  );
}

function makeBirdGeometry() {
  // Body + two-segment wings; aWing = signed span position for flapping.
  const v = [];
  const w = [];
  const quad = (a, b, c, d, wa, wb, wc, wd) => {
    v.push(...a, ...b, ...c, ...a, ...c, ...d);
    w.push(wa, wb, wc, wa, wc, wd);
  };
  // body (diamond)
  v.push(0.7, 0, 0, -0.5, 0.05, 0, 0, 0.12, 0.12, 0.7, 0, 0, 0, 0.12, -0.12, -0.5, 0.05, 0);
  w.push(0, 0, 0, 0, 0, 0);
  for (const s of [1, -1]) {
    quad([0.25, 0.05, 0], [-0.15, 0.05, 0], [-0.25, 0.05, 0.7 * s], [0.15, 0.05, 0.7 * s], 0, 0, 0.5 * s, 0.5 * s);
    quad([0.15, 0.05, 0.7 * s], [-0.25, 0.05, 0.7 * s], [-0.45, 0.05, 1.4 * s], [-0.2, 0.05, 1.4 * s], 0.5 * s, 0.5 * s, s, s);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(w, 1));
  g.computeVertexNormals();
  return g;
}

const flockUniforms = {
  uFlockPos: { value: [new THREE.Vector3(), new THREE.Vector3()] },
  uFlockYaw: { value: [0, 0] },
};

export function Birds() {
  const geometry = useDisposable(() => {
    const base = makeBirdGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    g.setAttribute('aWing', base.attributes.aWing);
    const rand = makeRandom(12);
    const n = 34;
    const a = new Float32Array(n * 4);
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const flock = i < 20 ? 0 : 1;
      const spread = flock === 0 ? 16 : 26;
      // Loose V: birds trail behind the leader.
      const back = rand.range(0, spread);
      a.set([-back, rand.range(-3, 3), (rand.next() < 0.5 ? -1 : 1) * back * rand.range(0.4, 0.9) + rand.range(-3, 3), rand.range(0, 100)], i * 4);
      f[i] = flock;
    }
    g.setAttribute('aBird', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aFlock', new THREE.InstancedBufferAttribute(f, 1));
    g.instanceCount = n;
    g.userData.count = n;
    return g;
  });
  const material = useDisposable(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#f7fbff', roughness: 0.55, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = cityUniforms.uTime;
      shader.uniforms.uFlockPos = flockUniforms.uFlockPos;
      shader.uniforms.uFlockYaw = flockUniforms.uFlockYaw;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform vec3 uFlockPos[2];
          uniform float uFlockYaw[2];
          attribute float aWing;
          attribute vec4 aBird;
          attribute float aFlock;
          varying float vTip;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float ph = aBird.w;
          float glide = smoothstep(-0.2, 0.4, sin(uTime * 0.6 + ph));
          float flap = sin(uTime * 8.0 + ph * 3.0) * mix(1.0, 0.12, glide);
          float span = abs(aWing);
          transformed.y += flap * span * span * 0.9 + span * 0.15;
          transformed *= 2.1;
          int fi = int(aFlock + 0.5);
          float yaw = fi == 0 ? uFlockYaw[0] : uFlockYaw[1];
          vec3 fp = fi == 0 ? uFlockPos[0] : uFlockPos[1];
          float cy = cos(yaw), sy = sin(yaw);
          vec3 off = aBird.xyz + vec3(sin(uTime * 0.5 + ph) * 2.0, sin(uTime * 0.7 + ph * 2.0) * 1.2, cos(uTime * 0.4 + ph) * 2.0);
          vec3 lp = transformed;
          vec3 rp = vec3(lp.x * cy + lp.z * sy, lp.y, -lp.x * sy + lp.z * cy);
          vec3 ro = vec3(off.x * cy + off.z * sy, off.y, -off.x * sy + off.z * cy);
          transformed = fp + ro + rp;
          vTip = span;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vTip;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.55, smoothstep(0.75, 1.0, vTip));');
    };
    m.customProgramCacheKey = () => 'ecocity-birds';
    return m;
  });
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, geometry.userData.count);
    m.frustumCulled = false;
    m.layers.set(LAYER_NO_REFLECT);
    return m;
  }, [geometry, material]);
  useInstancedDispose(mesh);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const path = (i, tt) => {
      if (i === 0) return [40 + 190 * Math.cos(tt * 0.06), 100 + 10 * Math.sin(tt * 0.13), 175 + 75 * Math.sin(tt * 0.06)];
      return [-30 + 280 * Math.cos(-tt * 0.045 + 2), 160 + 12 * Math.sin(tt * 0.1), -150 + 150 * Math.sin(-tt * 0.045 + 2)];
    };
    for (let i = 0; i < 2; i++) {
      const p = path(i, t);
      const q = path(i, t + 0.5);
      flockUniforms.uFlockPos.value[i].set(p[0], p[1], p[2]);
      flockUniforms.uFlockYaw.value[i] = Math.atan2(-(q[2] - p[2]), q[0] - p[0]);
    }
  });
  return <primitive object={mesh} />;
}

function makeTintMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #if defined(USE_INSTANCING_COLOR) && defined(USE_COLOR)
          vColor.xyz = mix(color.xyz, color.xyz * instanceColor.xyz, aPart);
        #endif`,
      );
  };
  m.customProgramCacheKey = () => 'ecocity-tint';
  return m;
}

const BOAT_COLORS = ['#38c6f4', '#7ed957', '#ffd23f', '#ff7fa8', '#2d8cf0', '#ffffff', '#4fe0c8'];

export function Boats({ city }) {
  const geometry = useDisposable(() => makeSailboat());
  const material = useDisposable(() => makeTintMaterial());
  const boats = useMemo(() => {
    const rand = makeRandom(55);
    const moving = [
      { z: 98, speed: 3.2, dir: 1 },
      { z: 145, speed: 4.2, dir: -1 },
      { z: 168, speed: 2.8, dir: 1 },
      { z: 214, speed: 3.6, dir: -1 },
      { z: 240, speed: 3.0, dir: 1 },
      { z: 150, speed: 2.4, dir: 1 },
      { z: 282, speed: 2.2, dir: 1 },
      { z: 310, speed: 1.8, dir: -1 },
    ].map((b, i) => ({ ...b, x0: rand.range(-200, 200), phase: rand.range(0, 10), color: BOAT_COLORS[i % BOAT_COLORS.length], s: rand.range(0.95, 1.2) }));
    const docked = city.docked.map((d, i) => ({ ...d, docked: true, phase: rand.range(0, 10), color: BOAT_COLORS[(i + 3) % BOAT_COLORS.length] }));
    return [...moving, ...docked];
  }, [city]);
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, boats.length);
    const c = new THREE.Color();
    boats.forEach((b, i) => m.setColorAt(i, c.set(b.color)));
    m.frustumCulled = false;
    return m;
  }, [geometry, material, boats]);
  useInstancedDispose(mesh);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const cam = state.camera.position;
    let w = 0;
    boats.forEach((b, i) => {
      let x;
      let z;
      let yaw;
      let heel = 0;
      if (b.docked) {
        x = b.x;
        z = b.z;
        yaw = b.heading;
      } else {
        // Wrap just outside the visible width at this depth so boats keep sailing through the view.
        const half = (cam.z - b.z) * 0.68 + 70;
        const span = half * 2;
        x = cam.x - half + ((((b.x0 + b.dir * b.speed * t) % span) + span) % span);
        z = b.z + Math.sin(t * 0.05 + b.phase) * 3;
        yaw = b.dir > 0 ? 0 : Math.PI;
        heel = 0.13;
        if (w < MAX_BOATS) {
          waterUniforms.uBoats.value[w].set(x, z, b.dir > 0 ? 0 : Math.PI, 1);
          w++;
        }
      }
      const s = b.s ?? 1;
      tmpP.set(x, Math.sin(t * 1.3 + b.phase) * 0.15 + 0.1, z);
      tmpE.set(heel + Math.sin(t * 0.9 + b.phase) * 0.04, yaw, Math.sin(t * 1.1 + b.phase) * 0.025, 'YXZ');
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpP, tmpQ, tmpS.set(s, s, s));
      mesh.setMatrixAt(i, tmpM);
    });
    for (; w < MAX_BOATS; w++) waterUniforms.uBoats.value[w].set(0, 0, 0, 0);
    mesh.instanceMatrix.needsUpdate = true;
    tmpS.set(1, 1, 1);
  });
  return <primitive object={mesh} />;
}

const turbineUniforms = { uSpin: { value: 0 } };

function turbineSites() {
  const sites = [];
  const rand = makeRandom(3);
  // Ridge line behind the city.
  for (let x = -820; x <= 900; x += rand.range(95, 130)) {
    let best = null;
    for (let z = -540; z >= -760; z -= 20) {
      const h = groundHeight(x, z);
      if (!best || h > best.y) best = { x, z, y: h };
    }
    sites.push(best);
  }
  // Right headland, closer to the camera.
  for (const [x, z] of [
    [452, 30],
    [500, 92],
    [548, 150],
    [430, -60],
  ]) {
    if (z < shoreZ(x) - 20) sites.push({ x, z, y: groundHeight(x, z) });
  }
  return sites.map((s) => ({ ...s, speed: rand.range(0.8, 1.2), phase: rand.range(0, 6.28), scale: s.z > -200 ? 0.8 : rand.range(0.9, 1.1) }));
}

export function Turbines() {
  const parts = useDisposable(() => makeTurbine());
  const sites = useMemo(() => turbineSites(), []);
  const baseMat = useDisposable(() => new THREE.MeshStandardMaterial({ color: '#f4f8fb', roughness: 0.35, metalness: 0.05 }));
  const rotorMat = useDisposable(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#f7fbfe', roughness: 0.3, metalness: 0.05 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uSpin = turbineUniforms.uSpin;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uSpin;\nattribute vec2 aRotor;')
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          float ra = uSpin * aRotor.x + aRotor.y;
          mat2 rot = mat2(cos(ra), sin(ra), -sin(ra), cos(ra));
          objectNormal.xy = rot * objectNormal.xy;`,
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xy = rot * transformed.xy;');
    };
    m.customProgramCacheKey = () => 'ecocity-rotor';
    return m;
  });
  const [base, rotor] = useMemo(() => {
    const yaw = 0.35;
    const b = new THREE.InstancedMesh(parts.base, baseMat, sites.length);
    const rg = parts.rotor.clone();
    const ar = new Float32Array(sites.length * 2);
    sites.forEach((s, i) => ar.set([s.speed, s.phase], i * 2));
    rg.setAttribute('aRotor', new THREE.InstancedBufferAttribute(ar, 2));
    const r = new THREE.InstancedMesh(rg, rotorMat, sites.length);
    sites.forEach((s, i) => {
      tmpE.set(0, yaw, 0);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpP.set(s.x, s.y - 1, s.z), tmpQ, tmpS.set(s.scale, s.scale, s.scale));
      b.setMatrixAt(i, tmpM);
      const hub = new THREE.Vector3(0, 72.5, 4.6).multiplyScalar(s.scale).applyQuaternion(tmpQ);
      tmpM.compose(tmpP.set(s.x + hub.x, s.y - 1 + hub.y, s.z + hub.z), tmpQ, tmpS);
      r.setMatrixAt(i, tmpM);
    });
    tmpS.set(1, 1, 1);
    b.computeBoundingSphere();
    r.computeBoundingSphere();
    return [b, r];
  }, [parts, sites, baseMat, rotorMat]);
  useEffect(
    () => () => {
      base.dispose();
      rotor.geometry.dispose();
      rotor.dispose();
    },
    [base, rotor],
  );
  useFrame((_, dt) => {
    const boost = reactions.focus === 'turbines' ? 3.2 : 1;
    turbineUniforms.uSpin.value += Math.min(dt, 0.1) * boost;
  });
  return (
    <>
      <primitive object={base} />
      <primitive object={rotor} />
    </>
  );
}

export function Sparkles({ city }) {
  const geometry = useDisposable(() => {
    const rand = makeRandom(66);
    const pts = [];
    // Glints on the sun-facing side of glass towers.
    const sunAng = Math.atan2(SUN.z, SUN.x);
    for (let i = 0; i < 46; i++) {
      const T = TOWERS[rand.int(0, TOWERS.length - 1)];
      const t = rand.range(0.15, 0.85);
      const ang = sunAng + rand.range(-0.9, 0.5);
      const r = Math.max(T.a, T.b ?? T.a) * (1 - 0.1 * t) + 0.6;
      pts.push([T.x + Math.cos(ang) * r, GROUND + T.h * t, T.z + Math.sin(ang) * r, rand.next(), 1]);
    }
    // Sparkles dancing on the bay.
    for (let i = 0; i < 40; i++) {
      const z = rand.range(70, 300);
      const x = rand.range(-260, 280) * (0.6 + (300 - z) / 500);
      pts.push([x, 0.6, z, rand.next(), 0]);
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    const a = new Float32Array(pts.length * 4);
    const k = new Float32Array(pts.length);
    pts.forEach((p, i) => {
      a.set(p.slice(0, 4), i * 4);
      k[i] = p[4];
    });
    g.setAttribute('aSpark', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aKind', new THREE.InstancedBufferAttribute(k, 1));
    g.instanceCount = pts.length;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: cityUniforms.uTime },
        vertexShader: /* glsl */ `
          attribute vec4 aSpark;
          attribute float aKind;
          uniform float uTime;
          varying vec2 vUv;
          varying float vA;
          void main() {
            float seed = aSpark.w;
            float speed = mix(0.6, 1.4, fract(seed * 13.7)) * (aKind > 0.5 ? 0.7 : 1.3);
            float cyc = uTime * speed + seed * 40.0;
            float tw = pow(max(sin(cyc), 0.0), aKind > 0.5 ? 18.0 : 10.0);
            // Water sparkles hop to a nearby spot every cycle.
            vec3 p = aSpark.xyz;
            float hop = floor(cyc / 6.2831853);
            if (aKind < 0.5) p.xz += vec2(sin(hop * 12.9 + seed * 7.0), cos(hop * 7.1 + seed * 3.0)) * 18.0;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float px = (aKind > 0.5 ? 22.0 : 13.0) * tw;
            mv.xy += position.xy * px * (-mv.z) / 330.0;
            gl_Position = projectionMatrix * mv;
            vUv = uv - 0.5;
            vA = tw;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying float vA;
          void main() {
            vec2 a = abs(vUv) * 2.0;
            float rays = exp(-a.x * 22.0) * exp(-a.y * 3.2) + exp(-a.y * 22.0) * exp(-a.x * 3.2);
            float diag = exp(-abs(a.x - a.y) * 18.0) * exp(-(a.x + a.y) * 5.0) * 0.5;
            float core = exp(-dot(a, a) * 18.0);
            float s = (rays + diag + core * 1.5) * vA;
            gl_FragColor = vec4(vec3(1.0, 0.98, 0.9) * s * 2.6, 1.0);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={20} layers={LAYER_NO_REFLECT} />;
}

// Landmarks each menu item points at: center, halo radius, height range, glow radius for the city shader.
export const FOCUS = {
  plaza: { p: LANDMARKS.plaza, r: 27, y: [2, 34] },
  hero: { p: LANDMARKS.hero, r: 26, y: [12, 200], glow: 30 },
  dome: { p: LANDMARKS.dome, r: 36, y: [2, 24] },
  shell: { p: new THREE.Vector3(LANDMARKS.shell.x, 0, 56), r: 19, y: [2, 15] },
  twist: { p: LANDMARKS.twist, r: 24, y: [12, 140], glow: 28 },
  turbines: null,
};

export function FocusHalo() {
  const group = useRef();
  const rings = useRef([]);
  const state = useRef({ key: null, amount: 0, pos: new THREE.Vector3(), r: 20, y: [0, 10] });
  const geometry = useDisposable(() => new THREE.TorusGeometry(1, 0.022, 6, 96).rotateX(Math.PI / 2));
  const materials = useDisposable(() =>
    [0, 1, 2].map(
      () =>
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(0.35, 1.15, 1.25),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
    ),
  );
  useFrame((st, dt) => {
    const s = state.current;
    const f = reactions.focus ? FOCUS[reactions.focus] : null;
    if (f) {
      if (s.key !== reactions.focus) {
        s.key = reactions.focus;
        s.pos.copy(f.p);
        s.r = f.r;
        s.y = f.y;
      }
    }
    s.amount += ((f ? 1 : 0) - s.amount) * Math.min(1, dt * 5);
    const t = st.clock.elapsedTime;
    group.current.visible = s.amount > 0.01;
    group.current.position.set(s.pos.x, GROUND, s.pos.z);
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const ph = (t * 0.4 + i / 3) % 1;
      const y = s.y[0] + (s.y[1] - s.y[0]) * ph;
      ring.position.y = y;
      const sc = s.r * (1 + 0.08 * Math.sin(ph * Math.PI));
      ring.scale.set(sc, sc * 3, sc);
      materials[i].opacity = s.amount * Math.sin(ph * Math.PI) * 0.75;
    });
    // Drive the facade glow in the city shader.
    const gw = f?.glow ?? 0;
    const u = cityUniforms.uFocus.value;
    if (f) u.set(f.p.x, f.p.z, gw || 0.001, u.w);
    u.w += ((f && gw ? 1 : 0) - u.w) * Math.min(1, dt * 4);
  });
  return (
    <group ref={group} visible={false}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => (rings.current[i] = el)} geometry={geometry} material={materials[i]} renderOrder={30} layers={LAYER_NO_REFLECT} />
      ))}
    </group>
  );
}

// Click celebration: a cloud of iridescent bubbles rising from the focused landmark.
export function BubbleBurst() {
  const count = 44;
  const geometry = useDisposable(() => {
    const rand = makeRandom(404);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const a = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) a.set([rand.range(0, Math.PI * 2), Math.sqrt(rand.next()), rand.range(3.5, 7.5), rand.next()], i * 4);
    g.setAttribute('aRand', new THREE.BufferAttribute(a, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uAge: { value: 99 }, uOrigin: { value: new THREE.Vector3() }, uSpread: { value: 20 } },
        vertexShader: /* glsl */ `
          attribute vec4 aRand;
          uniform float uAge;
          uniform vec3 uOrigin;
          uniform float uSpread;
          varying float vA;
          varying float vHue;
          void main() {
            float t = max(uAge - aRand.w * 0.6, 0.0);
            float out1 = 1.0 - exp(-t * 2.6);
            vec3 p = uOrigin;
            p.xz += vec2(cos(aRand.x), sin(aRand.x)) * aRand.y * uSpread * out1;
            p.y += t * (6.0 + fract(aRand.w * 7.3) * 12.0) + sin(t * 3.0 + aRand.x * 5.0) * 1.2;
            p.x += sin(t * 2.0 + aRand.w * 20.0) * 1.5;
            vA = smoothstep(0.0, 0.35, t) * (1.0 - smoothstep(2.2, 3.4, t)) * step(0.001, t);
            vHue = aRand.w;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(aRand.z * 660.0 / -mv.z, 3.0, 48.0) * (0.7 + 0.5 * smoothstep(0.0, 1.0, t));
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying float vHue;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c) * 2.0;
            if (d > 1.0) discard;
            float ring = smoothstep(0.62, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d));
            float ang = atan(c.y, c.x);
            vec3 irid = 0.6 + 0.4 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + ang * 0.25 + vHue));
            float spot = smoothstep(0.22, 0.0, length(c - vec2(-0.18, -0.2)));
            vec3 col = irid * ring * 0.85 + vec3(1.0) * spot * 1.1 + vec3(0.5, 0.85, 1.0) * 0.04;
            gl_FragColor = vec4(col * vA, 1.0);
          }
        `,
      }),
  );
  const st = useRef({ id: 0, start: -99 });
  useFrame((state) => {
    const s = st.current;
    const t = state.clock.elapsedTime;
    if (reactions.burstId !== s.id) {
      s.id = reactions.burstId;
      s.start = t;
      const f = FOCUS[reactions.focus] ?? FOCUS.plaza;
      material.uniforms.uOrigin.value.set(f.p.x, GROUND + (f.y[0] + f.y[1]) * 0.35, f.p.z);
      material.uniforms.uSpread.value = f.r * 1.7;
    }
    material.uniforms.uAge.value = t - s.start;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={25} layers={LAYER_NO_REFLECT} />;
}
