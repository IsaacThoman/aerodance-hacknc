import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { GROUND, MONO_Y, RIVER, polar } from './layout.js';
import { stageUniforms } from './materials.js';
import { makeBalloon, makeBirdGeometry, makeBlimp, makePod, makeSailboat, makeTrainCar, makeTurbine, makeVehicleMaterial } from './vehicles.js';
import { hillRidge } from './World.jsx';

// Everything that moves in the city: the monorail, eco pods, the airship with
// its screen, hot-air balloons, gull flocks and the wind farm on the hills.

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);

function useInstanced(geometry, material, count, setup) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, count);
    m.frustumCulled = false;
    setup?.(m);
    return m;
  }, [geometry, material, count]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => mesh.dispose(), [mesh]);
  return mesh;
}

// One train per monorail loop, running in opposite directions.
const TRAINS = [
  { speed: 46, offset: 300 },
  { speed: -40, offset: 900 },
];

export function Trains({ city, envMap }) {
  const geometry = useDisposable(() => makeTrainCar());
  const material = useDisposable(() => makeVehicleMaterial('train', envMap), [envMap]);
  const cars = 4;
  const mesh = useInstanced(geometry, material, cars * city.monorails.length);
  useFrame((state) => {
    city.monorails.forEach((loop, li) => placeTrain(mesh, li * cars, cars, loop, TRAINS[li], state.clock.elapsedTime));
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
}

function placeTrain(mesh, first, cars, loop, { speed, offset }, t) {
  const n = loop.points.length;
  const dir = Math.sign(speed);
  const head = (((t * speed + offset) % loop.total) + loop.total) % loop.total;
  for (let k = 0; k < cars; k++) {
    const s = (((head - dir * k * 19) % loop.total) + loop.total) % loop.total;
    const f = s / loop.step;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const a = f - Math.floor(f);
    const p0 = loop.points[i0];
    const p1 = loop.points[i1];
    const p2 = loop.points[(i1 + 1) % n];
    tmpP.set(p0.x + (p1.x - p0.x) * a, MONO_Y + 3.6, p0.z + (p1.z - p0.z) * a);
    tmpE.set(0, Math.atan2(-(p2.z - p0.z), p2.x - p0.x), 0);
    tmpQ.setFromEuler(tmpE);
    mesh.setMatrixAt(first + k, tmpM.compose(tmpP, tmpQ, tmpS));
  }
}

const POD_COLORS = ['#ffffff', '#7ed957', '#38c6f4', '#ffd23f', '#ff8fb1', '#9ff0e2', '#ffffff', '#2d8cf0', '#ffffff', '#7ed957', '#38c6f4', '#ffffff'];

// Elliptical flight loops between the towers: [cx, cz, rx, rz, speed, phase, y, bob].
const POD_ROUTES = (() => {
  const rand = makeRandom(31);
  const routes = [];
  const add = (az, d, rx, rz, y, n) => {
    const [cx, cz] = polar(az, d);
    const speed = rand.range(0.05, 0.09) * rand.sign();
    for (let i = 0; i < n; i++) routes.push([cx, cz, rx, rz, speed, i / n + rand.range(-0.05, 0.05), y + rand.range(-6, 6), rand.range(1, 3)]);
  };
  add(-30, 330, 180, 90, 18, 3);
  add(30, 360, 200, 80, 30, 3);
  add(0, 520, 360, 120, -8, 3);
  add(-20, 220, 120, 60, -18, 2);
  add(25, 240, 110, 70, 46, 1);
  return routes;
})();

export function Pods({ envMap }) {
  const geometry = useDisposable(() => makePod().scale(1.4, 1.4, 1.4));
  const material = useDisposable(() => makeVehicleMaterial('pod', envMap), [envMap]);
  const mesh = useInstanced(geometry, material, POD_ROUTES.length, (m) => {
    const c = new THREE.Color();
    POD_ROUTES.forEach((_, i) => m.setColorAt(i, c.set(POD_COLORS[i % POD_COLORS.length])));
  });
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    POD_ROUTES.forEach(([cx, cz, rx, rz, speed, phase, y, bob], i) => {
      const ang = t * speed + phase * Math.PI * 2;
      const dx = -Math.sin(ang) * rx * Math.sign(speed);
      const dz = Math.cos(ang) * rz * Math.sign(speed);
      tmpP.set(cx + Math.cos(ang) * rx, y + Math.sin(t * 0.7 + phase * 10) * bob, cz + Math.sin(ang) * rz);
      tmpE.set(0, Math.atan2(-dz, dx), Math.sin(t * 0.5 + phase * 7) * 0.08);
      tmpQ.setFromEuler(tmpE);
      mesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
}

function makeScreenMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: stageUniforms.uTime, uBeat: stageUniforms.uBeat },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uBeat;
      varying vec2 vUv;
      void main() {
        // Glowing billboard: aqua gradient, a rolling wave and an equalizer pulsing to the beat.
        vec2 uv = vUv;
        vec3 col = mix(vec3(0.0, 0.18, 0.45), vec3(0.0, 0.5, 0.75), uv.y);
        float bars = floor(uv.x * 24.0);
        float h = 0.25 + 0.55 * fract(sin(bars * 12.9898 + floor(uTime * 4.0)) * 43758.5453) * (0.5 + 0.5 * uBeat);
        float bar = step(uv.y, h) * step(0.15, fract(uv.x * 24.0)) * step(uv.x, 0.48);
        col = mix(col, mix(vec3(0.5, 1.0, 0.3), vec3(0.6, 1.0, 1.0), uv.y), bar);
        float wave = 0.5 + 0.22 * sin(uv.x * 18.0 - uTime * 3.0);
        float line = smoothstep(0.06, 0.0, abs(uv.y - wave)) * step(0.52, uv.x);
        col += vec3(0.8, 1.0, 1.0) * line;
        float orb = smoothstep(0.16, 0.12, length((uv - vec2(0.76, 0.5)) * vec2(3.0, 1.0)));
        col = mix(col, vec3(0.9, 1.0, 1.0), orb * 0.5);
        float edge = step(0.03, uv.x) * step(uv.x, 0.97) * step(0.06, uv.y) * step(uv.y, 0.94);
        gl_FragColor = vec4(mix(vec3(0.85, 0.95, 1.0), col * 2.2, edge), 1.0);
      }
    `,
  });
}

function makeScreenGeometry() {
  // Curved panel hugging the airship's flank (facing +z).
  const g = new THREE.PlaneGeometry(30, 7, 24, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i) + 0.8;
    const u = (x + 32) / 64;
    const r = 10.5 * Math.pow(Math.sin(Math.PI * u), 0.72) * (1 - 0.18 * u) + 0.2;
    p.setXYZ(i, x, y, Math.sqrt(Math.max(r * r - y * y, 0)));
  }
  g.computeVertexNormals();
  return g;
}

export function Blimp({ envMap }) {
  const group = useRef();
  const body = useDisposable(() => makeBlimp());
  const bodyMat = useDisposable(() => makeVehicleMaterial('blimp', envMap), [envMap]);
  const screenGeo = useDisposable(() => makeScreenGeometry());
  const screenMat = useDisposable(() => makeScreenMaterial());
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const x = -620 + ((t * 4.5 + 420) % 1240);
    group.current.position.set(x, 64 + Math.sin(t * 0.3) * 2, -520);
    group.current.rotation.set(0, Math.sin(t * 0.05) * 0.06, Math.sin(t * 0.4) * 0.015);
  });
  return (
    <group ref={group}>
      <mesh geometry={body} material={bodyMat} />
      <mesh geometry={screenGeo} material={screenMat} />
    </group>
  );
}

const BALLOONS = [
  { az: -24, d: 360, size: 9, color: '#24c6e8', speed: 1.6, phase: 0.1 },
  { az: 17, d: 520, size: 11, color: '#8fdc3c', speed: 1.2, phase: 0.55 },
  { az: -39, d: 610, size: 12, color: '#ff8a3d', speed: 1.0, phase: 0.8 },
  { az: 36, d: 330, size: 8, color: '#ff5fa8', speed: 1.4, phase: 0.35 },
  { az: -14, d: 820, size: 13, color: '#ffd23f', speed: 0.9, phase: 0.65 },
  { az: 47, d: 700, size: 12, color: '#3f8fff', speed: 1.1, phase: 0.2 },
];

const tmpXZ = [0, 0];

export function Balloons({ envMap }) {
  const geometry = useDisposable(() => makeBalloon());
  const material = useDisposable(() => makeVehicleMaterial('balloon', envMap), [envMap]);
  const mesh = useInstanced(geometry, material, BALLOONS.length, (m) => {
    const c = new THREE.Color();
    BALLOONS.forEach((b, i) => m.setColorAt(i, c.set(b.color)));
  });
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    BALLOONS.forEach((b, i) => {
      // Rise from below the terrace edge to above the frame, then start again out of sight.
      const range = 200;
      const y = -80 + ((t * b.speed + b.phase * range) % range);
      polar(b.az + Math.sin(t * 0.03 + i) * 1.5, b.d, tmpXZ);
      tmpP.set(tmpXZ[0], y, tmpXZ[1]);
      tmpE.set(Math.sin(t * 0.4 + i) * 0.04, t * 0.05 + i, Math.cos(t * 0.33 + i) * 0.04);
      tmpQ.setFromEuler(tmpE);
      tmpS.setScalar(b.size);
      mesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    });
    tmpS.setScalar(1);
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
}

const flock = {
  pos: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
  yaw: [0, 0, 0],
};

// One flock wheels in front of the terrace above the pool, two over the city.
function flockPath(i, t, out) {
  if (i === 0) return out.set(4 + 40 * Math.cos(t * 0.12), 9 + 3 * Math.sin(t * 0.23), -58 + 18 * Math.sin(t * 0.12));
  if (i === 1) return out.set(-120 + 150 * Math.cos(t * 0.05 + 2), 22 + 8 * Math.sin(t * 0.1), -360 + 120 * Math.sin(t * 0.05 + 2));
  return out.set(180 + 120 * Math.cos(-t * 0.06 + 1), -20 + 6 * Math.sin(t * 0.13), -300 + 90 * Math.sin(-t * 0.06 + 1));
}

export function Birds() {
  const geometry = useDisposable(() => {
    const base = makeBirdGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    g.setAttribute('aWing', base.attributes.aWing);
    const rand = makeRandom(12);
    const n = 40;
    const a = new Float32Array(n * 4);
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const fl = i < 14 ? 0 : i < 28 ? 1 : 2;
      const spread = fl === 0 ? 10 : 18;
      const back = rand.range(0, spread);
      a.set([-back, rand.range(-2, 2), rand.sign() * back * rand.range(0.4, 0.9) + rand.range(-2, 2), rand.range(0, 100)], i * 4);
      f[i] = fl;
    }
    g.setAttribute('aBird', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aFlock', new THREE.InstancedBufferAttribute(f, 1));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    return g;
  });
  const material = useDisposable(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#f7fbff', roughness: 0.55, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = stageUniforms.uTime;
      shader.uniforms.uFlockPos = { value: flock.pos };
      shader.uniforms.uFlockYaw = { value: flock.yaw };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform vec3 uFlockPos[3];
          uniform float uFlockYaw[3];
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
          int fi = int(aFlock + 0.5);
          float yaw = fi == 0 ? uFlockYaw[0] : fi == 1 ? uFlockYaw[1] : uFlockYaw[2];
          vec3 fp = fi == 0 ? uFlockPos[0] : fi == 1 ? uFlockPos[1] : uFlockPos[2];
          transformed *= fi == 0 ? 1.1 : 2.6;
          float cy = cos(yaw), sy = sin(yaw);
          vec3 off = aBird.xyz * (fi == 0 ? 0.6 : 1.0) + vec3(sin(uTime * 0.5 + ph) * 1.5, sin(uTime * 0.7 + ph * 2.0) * 1.0, cos(uTime * 0.4 + ph) * 1.5);
          vec3 lp = transformed;
          transformed = fp + vec3(off.x * cy + off.z * sy, off.y, -off.x * sy + off.z * cy) + vec3(lp.x * cy + lp.z * sy, lp.y, -lp.x * sy + lp.z * cy);
          vTip = span;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vTip;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.5, smoothstep(0.75, 1.0, vTip));');
    };
    m.customProgramCacheKey = () => 'sanctuary-birds';
    return m;
  });
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < 3; i++) {
      flockPath(i, t, flock.pos[i]);
      flockPath(i, t + 0.5, tmpP);
      flock.yaw[i] = Math.atan2(-(tmpP.z - flock.pos[i].z), tmpP.x - flock.pos[i].x);
    }
  });
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(geometry, material);
    m.frustumCulled = false;
    return m;
  }, [geometry, material]);
  return <primitive object={mesh} />;
}

export function Turbines({ envMap }) {
  const { base, rotor } = useDisposable(() => makeTurbine());
  // Unfogged so the white turbines stand out against the hazy hills.
  const material = useDisposable(() => new THREE.MeshStandardMaterial({ color: '#e8f4fb', roughness: 0.4, fog: false, envMap }), [envMap]);
  const spots = useMemo(() => {
    const ridge = hillRidge(90);
    const rand = makeRandom(66);
    return ridge
      .filter((p, i) => i % 3 === 0 && Math.abs(p.az + 8) > 6 && Math.abs(p.az) < 70)
      .map((p) => ({ ...p, s: rand.range(2.6, 3.2), yaw: rand.range(-0.3, 0.3), phase: rand.range(0, 6), speed: rand.range(0.5, 0.8) }));
  }, []);
  const baseMesh = useInstanced(base, material, spots.length, (m) => {
    spots.forEach((p, i) => {
      tmpE.set(0, p.yaw, 0);
      tmpQ.setFromEuler(tmpE);
      m.setMatrixAt(i, tmpM.compose(tmpP.set(p.x, p.y - 4, p.z), tmpQ, tmpS.setScalar(p.s)));
    });
    tmpS.setScalar(1);
  });
  const rotorMesh = useInstanced(rotor, material, spots.length);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    spots.forEach((p, i) => {
      tmpE.set(0, p.yaw, t * p.speed + p.phase);
      tmpQ.setFromEuler(tmpE);
      tmpS.setScalar(p.s);
      // Hub sits at the nacelle front (72.5 up, 3 forward), scaled with the tower.
      tmpP.set(p.x + Math.sin(p.yaw) * 3 * p.s, p.y - 4 + 72.5 * p.s, p.z + Math.cos(p.yaw) * 3 * p.s);
      rotorMesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    });
    tmpS.setScalar(1);
    rotorMesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <primitive object={baseMesh} />
      <primitive object={rotorMesh} />
    </>
  );
}


const BOAT_COLORS = ['#38c6f4', '#7ed957', '#ffd23f', '#ff7fa8', '#2d8cf0', '#ffffff', '#4fe0c8', '#ff9a3c'];

// Sample the river centerline by arc length so boats can sail along it.
const riverPath = (() => {
  const pts = RIVER.map(([x, z, w]) => new THREE.Vector3(x, w, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return { curve, length: curve.getLength() };
})();

function makeTintMaterial(envMap) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide, envMap });
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
  m.customProgramCacheKey = () => 'sanctuary-tint';
  return m;
}

export function Sailboats({ envMap, count = 12 }) {
  const geometry = useDisposable(() => makeSailboat());
  const material = useDisposable(() => makeTintMaterial(envMap), [envMap]);
  const boats = useMemo(() => {
    const rand = makeRandom(55);
    return Array.from({ length: count }, (_, i) => ({
      u: rand.next(),
      lane: rand.range(-0.55, 0.55),
      speed: rand.range(2.5, 5) * rand.sign(),
      s: rand.range(2.3, 3.1),
      phase: rand.range(0, 10),
      color: BOAT_COLORS[i % BOAT_COLORS.length],
    }));
  }, [count]);
  const mesh = useInstanced(geometry, material, count, (m) => {
    const c = new THREE.Color();
    boats.forEach((b, i) => m.setColorAt(i, c.set(b.color)));
  });
  const p = useMemo(() => new THREE.Vector3(), []);
  const tan = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const { curve, length } = riverPath;
    boats.forEach((b, i) => {
      // Sail the nearer stretch of the river; fade in/out by shrinking at the ends.
      const k = (((b.u + (b.speed * t) / (length * 0.5)) % 1) + 1) % 1;
      const u = 0.03 + 0.5 * k;
      const grow = Math.min(1, k * 12, (1 - k) * 12);
      curve.getPointAt(u, p);
      curve.getTangentAt(u, tan);
      const half = p.y * 0.6;
      tmpP.set(p.x - tan.z * b.lane * half, GROUND + 0.6 + Math.sin(t * 1.3 + b.phase) * 0.15, p.z + tan.x * b.lane * half);
      const dir = Math.sign(b.speed);
      tmpE.set(Math.sin(t * 0.9 + b.phase) * 0.04, Math.atan2(-tan.z * dir, tan.x * dir), 0.12 * dir);
      tmpQ.setFromEuler(tmpE);
      tmpS.setScalar(b.s * grow);
      mesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    });
    tmpS.setScalar(1);
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
}
