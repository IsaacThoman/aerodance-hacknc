import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { makeLitMaterial, waterGLSL } from './shaders.js';
import { merge, place } from './geometry.js';
import {
  anemoneBase,
  bladeGeometry,
  brainCoral,
  branchingCoral,
  giantClam,
  leatherCoral,
  pillarCoral,
  rock,
  seaFan,
  seaWhips,
  starfish,
  tableCoral,
  tentacleGeometry,
  tubeSponges,
} from './reefGeometry.js';

// Reef layout: bommies (rock + coral heads) framing an open sandy channel.
const BOMMIES = [
  {
    rocks: [[-7.6, -14.2, 1.4, [1.2, 1.0, 1.1]], [-5.9, -13.0, 1.0, [1.2, 0.9, 1]], [-9.3, -15.6, 1.2, [1.2, 0.95, 1]], [-10.6, -13.4, 0.8, [1.1, 1.1, 1]]],
    corals: [
      ['brain', -7.0, -13.5, 0.75, { palette: ['#c9db62', '#7a9a2c'] }],
      ['branch', -8.4, -14.3, 1.15, { base: '#d1468c', tip: '#ffc4e6' }],
      ['table', -6.2, -14.9, 1.05, { top: '#78d6b0', rim: '#e0fff0' }],
      ['whips', -9.6, -13.4, 1, { palette: ['#ff6a3d', '#ffb13b'] }],
      ['sponges', -5.2, -12.4, 0, { palette: ['#ffd23a', '#ff9a3c'] }],
    ],
  },
  {
    rocks: [[8.6, -17.2, 1.5, [1.2, 1.0, 1.1]], [10.3, -16.0, 1.1, [1.2, 0.9, 1]], [6.9, -18.6, 1.2, [1.2, 0.9, 1]], [11.6, -18.4, 0.9, [1.1, 1.1, 1]]],
    corals: [
      ['anemone', 8.1, -16.5, 0.48],
      ['branch', 9.7, -17.4, 1.05, { base: '#7b4fd0', tip: '#e6d4ff' }],
      ['brain', 7.2, -17.9, 0.7, { palette: ['#f6a6c0', '#b85a7c'] }],
      ['whips', 10.6, -15.8, 1, { palette: ['#e8457a', '#ff8fb3'] }],
      ['table', 9.2, -18.6, 0.9, { top: '#e9c56a', rim: '#fff3c2' }],
    ],
  },
  {
    rocks: [[1.2, -27.0, 2.0, [1.4, 1.0, 1.2]], [3.8, -26.0, 1.3, [1.2, 0.9, 1]], [-1.9, -28.2, 1.5, [1.2, 0.9, 1]]],
    corals: [
      ['table', 0.6, -26.4, 2.0, { top: '#86dcc0', rim: '#e8fff6' }],
      ['table', 2.9, -27.6, 1.5, { top: '#e8b25a', rim: '#fff0c8' }],
      ['branch', -1.4, -27.4, 1.7, { base: '#ff7d3a', tip: '#ffe3a6' }],
      ['branch', 3.9, -25.6, 1.5, { base: '#3e8ed8', tip: '#c9f0ff' }],
      ['pillar', 1.9, -26.0, 1.6, { paint: '#ffd86a' }],
      ['whips', -0.2, -28.4, 1.2, { palette: ['#ffcf3a', '#ff8a3d'] }],
    ],
  },
  {
    rocks: [[-17.0, -30.0, 2.5, [1.4, 1.0, 1.2]], [-14.6, -31.8, 1.7, [1.2, 0.9, 1]]],
    corals: [
      ['table', -16.4, -29.4, 2.0, { top: '#9ad89a', rim: '#efffe0' }],
      ['branch', -14.8, -31.4, 1.8, { base: '#d1468c', tip: '#ffc4e6' }],
      ['pillar', -17.8, -30.6, 1.8, { paint: '#f0cf6a' }],
    ],
  },
  {
    rocks: [[18.5, -34.0, 2.8, [1.4, 1.0, 1.2]], [15.6, -36.0, 1.8, [1.2, 0.9, 1]]],
    corals: [
      ['table', 18.0, -33.4, 2.3, { top: '#78c8e0', rim: '#e0f8ff' }],
      ['branch', 16.0, -35.4, 1.8, { base: '#7b4fd0', tip: '#e6d4ff' }],
      ['pillar', 19.6, -34.8, 2.0, { paint: '#f0cf6a' }],
    ],
  },
  {
    rocks: [[-4.5, -44.0, 3.0, [1.5, 1.0, 1.2]], [6.0, -48.0, 3.2, [1.5, 1.1, 1.2]], [24.0, -50.0, 3.5, [1.4, 1.0, 1.2]], [-26.0, -46.0, 3.4, [1.4, 1.0, 1.2]]],
    corals: [
      ['table', -4.0, -43.5, 2.6, { top: '#86dcc0', rim: '#e8fff6' }],
      ['branch', 6.6, -47.6, 2.4, { base: '#d1468c', tip: '#ffc4e6' }],
      ['table', 23.0, -49.0, 2.8, { top: '#e8b25a', rim: '#fff0c8' }],
      ['pillar', -25.0, -45.5, 2.4, { paint: '#f0cf6a' }],
    ],
  },
];

const FOREGROUND = [
  ['brain', -6.7, -9.9, 0.62, { palette: ['#f0f48a', '#6f9424'] }],
  ['branch', -5.6, -10.4, 0.8, { base: '#ff3d8f', tip: '#ffd0ea' }],
  ['clam', -4.7, -9.1, 0.45],
  ['star', -3.0, -8.8, 0.24, { paint: '#ff7a2e' }],
  ['sponges', 6.4, -10.2, 0, { palette: ['#ff4fa0', '#d13cd6'] }],
  ['fan', -7.6, -10.6, 1.7, { base: '#9e1f6e', tip: '#ff6ab8', yaw: 0.3 }],
  ['fan', 7.9, -12.4, 1.4, { base: '#c4421c', tip: '#ffb347', yaw: -0.4 }],
  ['pillar', -2.6, -13.6, 0.9, { paint: '#f0cf6a' }],
  ['leather', 2.2, -12.0, 0.5, { paint: '#b8e86a', rim: '#f6ffd8' }],
  ['branch', 5.0, -11.2, 0.75, { base: '#20a7c9', tip: '#d4fbff' }],
  ['star', 3.6, -9.3, 0.2, { paint: '#2f7de8' }],
  ['star', -1.2, -12.5, 0.18, { paint: '#ff5e7a' }],
  ['clam', 2.4, -15.0, 0.35],
];

const GRASS_PATCHES = [
  [-4.2, -10.5, 2.2, 140],
  [-2.0, -16.5, 2.5, 110],
  [5.0, -13.0, 2.4, 120],
  [3.6, -20.5, 3.0, 110],
  [-11.0, -20.0, 3.5, 120],
  [12.5, -22.0, 3.2, 110],
  [-1.0, -34.0, 4.0, 90],
  [7.8, -9.4, 1.6, 90],
];

export function buildReef(floorHeight) {
  const solid = [];
  const sway = [];
  const anemones = [];
  const rand = makeRandom(1234);
  const rockTops = [];
  const topAt = (x, z) => {
    let y = floorHeight(x, z);
    for (const r of rockTops) {
      const d = Math.hypot((x - r.x) / (r.r * r.s[0]), (z - r.z) / (r.r * r.s[2]));
      if (d < 1) y = Math.max(y, r.y + r.r * r.s[1] * 0.92 * Math.sqrt(1 - d * d) - 0.15);
    }
    return y;
  };
  const addCoral = ([kind, x, z, size, opts = {}], seed) => {
    const y = topAt(x, z) - 0.05;
    const rotY = rand.range(0, Math.PI * 2);
    const at = (g, extra = {}) => place(g, { position: [x, y, z], rotation: [0, rotY, 0], ...extra });
    if (kind === 'brain') solid.push(at(brainCoral({ radius: size, seed, ...opts })));
    else if (kind === 'branch') branchingCoral({ size, seed, ...opts }).forEach((g) => solid.push(at(g)));
    else if (kind === 'table') solid.push(at(tableCoral({ radius: size, seed, height: 0.4 + size * 0.25, ...opts })));
    else if (kind === 'sponges') tubeSponges({ count: 5, seed, ...opts }).forEach((g) => solid.push(at(g)));
    else if (kind === 'whips') seaWhips({ count: 7, seed, height: 1.3 * size, ...opts }).forEach((g) => sway.push(at(g)));
    else if (kind === 'star') solid.push(at(starfish({ size, seed, ...opts }), { position: [x, floorHeight(x, z) + 0.02, z] }));
    else if (kind === 'clam') giantClam({ size, seed }).forEach((g) => solid.push(at(g)));
    else if (kind === 'pillar') pillarCoral({ size, seed, ...opts }).forEach((g) => solid.push(at(g)));
    else if (kind === 'leather') solid.push(at(leatherCoral({ radius: size, seed, ...opts })));
    else if (kind === 'fan') seaFan({ size, seed, ...opts }).forEach((g) => sway.push(place(g, { position: [x, y, z], rotation: [0, opts.yaw ?? rotY, 0] })));
    else if (kind === 'anemone') {
      solid.push(at(anemoneBase({ radius: size })));
      anemones.push({ x, y: y + 0.42, z, r: size });
    }
  };
  let seed = 10;
  for (const b of BOMMIES) {
    for (const [x, z, r, s] of b.rocks) {
      const y = floorHeight(x, z) - r * 0.25;
      solid.push(place(rock({ radius: r, seed: seed++, squash: s }), { position: [x, y, z], rotation: [0, rand.range(0, 6), 0] }));
      rockTops.push({ x, z, r, s, y });
    }
  }
  for (const b of BOMMIES) for (const c of b.corals) addCoral(c, seed++);
  // Carpet each bommie with smaller colonies so no bare rock reads as a blob.
  const SMALL = [
    ['brain', { palette: ['#ff9ec4', '#c2507e'] }],
    ['brain', { palette: ['#c9ef5a', '#6f9a22'] }],
    ['branch', { base: '#ff3d8f', tip: '#ffd0ea' }],
    ['branch', { base: '#8a4bff', tip: '#e8dcff' }],
    ['branch', { base: '#ff7a2a', tip: '#ffe0a8' }],
    ['branch', { base: '#1fb8d8', tip: '#d8fdff' }],
    ['pillar', { paint: '#f0cf6a' }],
    ['leather', { paint: '#b8e86a', rim: '#f6ffd8' }],
    ['leather', { paint: '#ff9fd0', rim: '#fff0fa' }],
    ['sponges', { palette: ['#ff4fa0', '#d13cd6'] }],
    ['sponges', { palette: ['#ffd23a', '#ff8a2a'] }],
  ];
  rockTops.forEach((r, i) => {
    const n = Math.round(r.r * 5.5);
    for (let k = 0; k < n; k++) {
      // Bias colonies toward the camera-facing half of the rock.
      const a = rand.range(-0.15, 1.15) * Math.PI;
      const d = Math.sqrt(rand.next()) * 0.8;
      const x = r.x + Math.cos(a) * d * r.r * r.s[0];
      const z = r.z + Math.sin(a) * d * r.r * r.s[2];
      const [kind, opts] = SMALL[(i * 7 + k * 3 + rand.int(0, 3)) % SMALL.length];
      const size = kind === 'sponges' ? 0 : kind === 'pillar' ? rand.range(0.7, 1.2) : rand.range(0.45, 0.9);
      addCoral([kind, x, z, size, opts], seed++);
    }
  });
  for (const c of FOREGROUND) addCoral(c, seed++);
  // Scattered pebbles & small rocks on the sand.
  for (let i = 0; i < 26; i++) {
    const x = rand.range(-14, 14);
    const z = rand.range(-30, -8);
    const r = rand.range(0.12, 0.4);
    solid.push(place(rock({ radius: r, seed: seed++, squash: [1.3, 0.6, 1] }), { position: [x, floorHeight(x, z) - r * 0.2, z] }));
  }
  // Seagrass blades.
  const blades = [];
  const grassRand = makeRandom(77);
  for (const [cx, cz, radius, count] of GRASS_PATCHES) {
    for (let i = 0; i < count; i++) {
      const a = grassRand.range(0, Math.PI * 2);
      const d = Math.sqrt(grassRand.next()) * radius;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d * 0.7;
      blades.push({ x, y: floorHeight(x, z) - 0.05, z, h: grassRand.range(0.45, 1.25) * (1 - (d / radius) * 0.4), yaw: grassRand.range(0, 6.28), hue: grassRand.next() });
    }
  }
  return { solid: merge(solid), sway: merge(sway), anemones, blades };
}

export function Reef({ shared, reef }) {
  const mats = useDisposable(() => ({
    solid: makeLitMaterial(shared, { underwater: true, shininess: 30, specular: 0.25, rim: 0.12, rimColor: '#9ff0ff', wrap: 0.45, caustics: 1.1 }),
    sway: makeLitMaterial(shared, { underwater: true, shininess: 20, specular: 0.2, rim: 0.2, wrap: 0.5, sway: true, swayAmp: 0.22, swaySpeed: 0.9, caustics: 0.8 }),
  }));
  return (
    <>
      <mesh geometry={reef.solid} material={mats.solid} />
      <mesh geometry={reef.sway} material={mats.sway} />
      <Seagrass shared={shared} blades={reef.blades} />
      <Anemones shared={shared} anemones={reef.anemones} />
    </>
  );
}

function Seagrass({ shared, blades }) {
  const geometry = useDisposable(() => bladeGeometry());
  const material = useDisposable(() =>
    makeLitMaterial(shared, { underwater: true, shininess: 25, specular: 0.25, rim: 0.2, wrap: 0.7, sway: true, swayAmp: 0.32, swaySpeed: 1.1, vertexColors: false, side: THREE.DoubleSide, caustics: 0.7 }),
  );
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, blades.length);
    const dummy = new THREE.Object3D();
    const greens = ['#6fcf4a', '#4fb84a', '#98e05a', '#3ea86a', '#b6e86a'].map((c) => new THREE.Color(c));
    const c = new THREE.Color();
    blades.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.set(1, b.h, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      c.copy(greens[Math.floor(b.hue * greens.length)]);
      m.setColorAt(i, c);
    });
    m.frustumCulled = false;
    return m;
  }, [geometry, material, blades]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

function Anemones({ shared, anemones }) {
  const geometry = useDisposable(() => tentacleGeometry());
  const material = useDisposable(() =>
    makeLitMaterial(shared, { underwater: true, shininess: 40, specular: 0.4, rim: 0.35, rimColor: '#ffd6f4', wrap: 0.6, sway: true, swayAmp: 0.09, swaySpeed: 1.6, emissive: '#3a0a2a', caustics: 0.8 }),
  );
  const mesh = useMemo(() => {
    const per = 120;
    const m = new THREE.InstancedMesh(geometry, material, per * anemones.length);
    const rand = makeRandom(5);
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    let k = 0;
    for (const a of anemones) {
      for (let i = 0; i < per; i++) {
        const ang = rand.range(0, Math.PI * 2);
        const rr = Math.sqrt(rand.next()) * a.r * 1.05;
        dummy.position.set(a.x + Math.cos(ang) * rr, a.y, a.z + Math.sin(ang) * rr);
        const tilt = (rr / a.r) * 1.1 + rand.range(-0.15, 0.15);
        dummy.rotation.set(0, 0, 0);
        dummy.rotateY(-ang);
        dummy.rotateZ(-tilt);
        dummy.scale.setScalar(rand.range(0.8, 1.25));
        dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix);
        c.setHSL(0.92 + rand.range(-0.04, 0.04), 0.4, rand.range(0.85, 1.0));
        m.setColorAt(k, c);
        k++;
      }
    }
    m.frustumCulled = false;
    return m;
  }, [geometry, material, anemones]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

// ---------------------------------------------------------------------------
// Light shafts, bubbles and drifting particulate.
// ---------------------------------------------------------------------------

export function GodRays({ shared }) {
  const geometry = useDisposable(() => {
    const plane = new THREE.PlaneGeometry(1, 1, 1, 8);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.attributes.position);
    const rand = makeRandom(8);
    const count = 18;
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      data.set([rand.range(-20, 16), rand.range(-36, -7), rand.range(1.2, 3.6), rand.next()], i * 4);
    }
    g.setAttribute('aRay', new THREE.InstancedBufferAttribute(data, 4));
    g.instanceCount = count;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared, uIntensity: { value: 0.75 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uUnderSun;
          attribute vec4 aRay;
          varying vec2 vUv;
          varying float vFade;
          varying float vPhase;
          void main() {
            vec3 dir = normalize(uUnderSun);
            vec3 top = vec3(aRay.x + sin(uTime * 0.11 + aRay.w * 6.0) * 1.2, 0.0, aRay.y);
            float len = 13.0;
            float along = 0.5 - position.y;
            vec3 mid = top + dir * len * 0.5;
            vec3 side = normalize(cross(dir, normalize(cameraPosition - mid)));
            float w = aRay.z * (1.0 + along * 0.7) * (0.8 + 0.2 * sin(uTime * 0.37 + aRay.w * 11.0));
            vec3 wp = top + dir * along * len + side * position.x * w;
            vUv = vec2(position.x + 0.5, along);
            vPhase = aRay.w;
            vec4 mv = viewMatrix * vec4(wp, 1.0);
            vFade = exp(-length(mv.xyz) * 0.028) * smoothstep(1.5, 5.0, -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uIntensity;
          uniform float uBeat;
          varying vec2 vUv;
          varying float vFade;
          varying float vPhase;
          void main() {
            float across = sin(3.14159 * vUv.x);
            across *= across;
            float along = smoothstep(0.0, 0.1, vUv.y) * pow(1.0 - vUv.y, 1.4);
            float flicker = 0.5 + 0.5 * sin(uTime * (0.5 + vPhase * 0.6) + vPhase * 20.0);
            float streak = 0.75 + 0.25 * sin(vUv.x * 9.0 + uTime * 0.8 + vPhase * 7.0);
            float a = across * along * flicker * streak * vFade * uIntensity * (1.0 + uBeat * 0.12);
            gl_FragColor = vec4(vec3(0.72, 0.98, 1.0), a);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={20} />;
}

export function Bubbles({ shared, vents }) {
  const geometry = useDisposable(() => {
    const ico = new THREE.IcosahedronGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', ico.attributes.position);
    g.setAttribute('normal', ico.attributes.normal);
    const rand = makeRandom(31);
    const items = [];
    for (const v of vents) {
      for (let i = 0; i < 16; i++) items.push([v.x + rand.range(-0.1, 0.1), v.z + rand.range(-0.1, 0.1), rand.range(0.9, 1.5), rand.range(0.025, 0.07), rand.next(), v.y, -0.2]);
    }
    for (let i = 0; i < 70; i++) {
      const z = rand.range(-30, -3);
      items.push([rand.range(-14, 14), z, rand.range(0.5, 1.1), rand.range(0.015, 0.06), rand.next(), -7, -0.2]);
    }
    const a = new Float32Array(items.length * 4);
    const b = new Float32Array(items.length * 4);
    items.forEach(([x, z, speed, size, phase, y0, y1], i) => {
      a.set([x, z, speed, size], i * 4);
      b.set([phase, 0, y0, y1], i * 4);
    });
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aB2', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = items.length;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared },
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        vertexShader: /* glsl */ `
          uniform float uTime;
          attribute vec4 aB;
          attribute vec4 aB2;
          varying vec3 vN;
          varying vec3 vWorld;
          varying float vA;
          void main() {
            float span = aB2.w - aB2.z;
            float prog = fract(uTime * aB.z / span + aB2.x);
            float y = aB2.z + prog * span;
            float wob = sin(uTime * 3.1 + aB2.x * 30.0) * 0.07 * (0.4 + prog);
            vec3 c = vec3(aB.x + wob, y, aB.y + cos(uTime * 2.6 + aB2.x * 20.0) * 0.05);
            float s = aB.w * (0.75 + 0.5 * prog);
            vec3 p = position * s * vec3(1.0 + 0.08 * sin(uTime * 9.0 + aB2.x * 10.0), 0.82, 1.0);
            vec4 wp = vec4(c + p, 1.0);
            vWorld = wp.xyz;
            vN = normalize(position);
            vA = smoothstep(0.0, 0.04, prog) * (1.0 - smoothstep(0.95, 1.0, prog));
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          ${waterGLSL}
          varying vec3 vN;
          varying vec3 vWorld;
          varying float vA;
          void main() {
            vec3 n = normalize(vN);
            vec3 v = normalize(cameraPosition - vWorld);
            float ndv = abs(dot(n, v));
            float rim = pow(1.0 - ndv, 2.2);
            vec3 L = normalize(vec3(-0.3, 1.0, 0.25));
            float spec = pow(max(dot(reflect(-v, n), L), 0.0), 30.0);
            vec3 col = vec3(0.8, 0.98, 1.0) * rim * 1.4 + vec3(2.2) * spec;
            float a = clamp(rim * 0.8 + spec * 0.8 + 0.06, 0.0, 1.0) * vA;
            float d = length(cameraPosition - vWorld);
            a *= exp(-d * 0.035);
            gl_FragColor = vec4(col * a, a);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={30} />;
}

export function Plankton({ shared, count = 520 }) {
  const geometry = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    const rand = makeRandom(55);
    const p = new Float32Array(count * 3);
    const a = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      p.set([rand.range(-15, 15), rand.range(-6, 1), rand.range(-34, 2)], i * 3);
      a.set([rand.next(), rand.chance(0.06) ? rand.range(2.5, 4) : rand.range(0.6, 1.4)], i * 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aP', new THREE.BufferAttribute(a, 2));
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          uniform float uTime;
          attribute vec2 aP;
          varying float vAlpha;
          varying float vBokeh;
          void main() {
            vec3 p = position + vec3(
              sin(uTime * 0.21 + aP.x * 10.0) * 0.6 + uTime * 0.12,
              uTime * 0.04 + sin(uTime * 0.33 + aP.x * 7.0) * 0.3,
              cos(uTime * 0.17 + aP.x * 5.0) * 0.6
            );
            vec3 box = vec3(30.0, 7.0, 36.0);
            vec3 origin = vec3(cameraPosition.x, -3.6, cameraPosition.z - 16.0);
            p = origin + mod(p - origin + box * 0.5, box) - box * 0.5;
            vec4 mv = viewMatrix * vec4(p, 1.0);
            float dist = max(-mv.z, 0.1);
            float size = aP.y * 120.0 / dist;
            vBokeh = smoothstep(4.0, 14.0, size);
            gl_PointSize = clamp(size, 1.0, 22.0);
            float tw = 0.6 + 0.4 * sin(uTime * (1.0 + aP.x * 2.0) + aP.x * 50.0);
            vAlpha = tw * exp(-dist * 0.05) * smoothstep(0.6, 1.5, dist) * mix(0.55, 0.12, vBokeh);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          varying float vBokeh;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float disc = smoothstep(1.0, 0.75, d);
            float core = mix(exp(-d * d * 4.0), 0.6 + 0.4 * smoothstep(0.5, 0.95, d), vBokeh);
            gl_FragColor = vec4(vec3(0.85, 1.0, 1.0), disc * core * vAlpha);
          }
        `,
      }),
  );
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={40} />;
}
