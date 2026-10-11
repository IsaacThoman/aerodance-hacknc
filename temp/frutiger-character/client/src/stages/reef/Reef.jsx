import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { hash, simplex } from '../shared/glsl.js';
import { causticsGLSL, makeLitMaterial, waterGLSL } from './shaders.js';
import { makeNoise3, merge, place, ss } from './geometry.js';
import {
  anemoneBase,
  bladeGeometry,
  brainCoral,
  branchingCoral,
  fanGeometry,
  giantClam,
  leatherCoral,
  makeLaceTexture,
  pillarCoral,
  rock,
  rockArch,
  seaWhips,
  starfish,
  tableCoral,
  tentacleGeometry,
  tubeSponges,
} from './reefGeometry.js';

// Sand level around the dome; the reef beyond dips a little lower.
export const SAND_Y = -0.45;

/** Seafloor height: flat around the dome, dunes beyond, sloping into the deep. */
export function makeFloorHeight() {
  const noise = makeNoise3(42);
  return (x, z) => {
    const k = ss(Math.hypot(x, z * 1.1), 9, 17);
    let y = SAND_Y - 0.35 * k;
    y += k * (0.55 * noise(x * 0.05, z * 0.05, 1) + 0.22 * noise(x * 0.14, z * 0.14, 2));
    y -= Math.max(0, -z - 34) * 0.045;
    y += Math.max(0, Math.abs(x) - 28) * 0.06;
    return y;
  };
}

// Bommies (rock + coral heads). Corals: [kind, x, z, size, opts].
const BOMMIES = [
  {
    rocks: [[-12.6, -7.2, 1.5, [1.2, 1.0, 1.1]], [-14.4, -5.6, 1.0, [1.2, 0.9, 1]], [-11.0, -9.0, 1.1, [1.2, 0.95, 1]], [-15.2, -8.8, 0.9, [1.1, 1.1, 1]]],
    corals: [
      ['brain', -12.0, -6.5, 0.8, { palette: ['#d6ef62', '#7aa22c'] }],
      ['branch', -13.6, -7.6, 1.2, { base: '#e0418f', tip: '#ffc8ea' }],
      ['table', -11.2, -8.4, 1.1, { top: '#5ee0c0', rim: '#e0fff6' }],
      ['whips', -15.0, -6.4, 1.1, { palette: ['#ff6a3d', '#ffb13b'] }],
      ['sponges', -10.6, -6.6, 0, { palette: ['#ffd23a', '#ff9a3c'] }],
    ],
  },
  {
    rocks: [[12.6, -6.4, 1.5, [1.2, 1.0, 1.1]], [14.4, -5.0, 1.1, [1.2, 0.9, 1]], [11.0, -8.0, 1.2, [1.2, 0.9, 1]], [15.6, -7.8, 0.9, [1.1, 1.1, 1]]],
    corals: [
      ['anemone', 12.2, -5.6, 0.62, { paint: '#c43c8a', tip: '#ff8ae0' }],
      ['branch', 13.8, -6.8, 1.1, { base: '#7b4fd0', tip: '#e6d4ff' }],
      ['brain', 11.0, -7.6, 0.75, { palette: ['#ffa6c8', '#b8507c'] }],
      ['whips', 15.2, -5.0, 1.1, { palette: ['#e8457a', '#ff8fb3'] }],
      ['table', 13.4, -8.6, 1.0, { top: '#f0c560', rim: '#fff3c2' }],
    ],
  },
  {
    rocks: [[-10.8, 2.2, 1.0, [1.2, 0.9, 1.1]], [-12.4, 0.6, 0.8, [1.1, 1.0, 1]]],
    corals: [
      ['anemone', -10.4, 2.6, 0.5, { paint: '#5b4fd0', tip: '#c2a6ff' }],
      ['branch', -11.6, 1.0, 0.9, { base: '#1fb8d8', tip: '#d8fdff' }],
      ['leather', -12.0, 2.6, 0.55, { paint: '#b8e86a', rim: '#f6ffd8' }],
    ],
  },
  {
    rocks: [[11.6, 2.6, 1.1, [1.2, 0.9, 1.1]], [13.0, 1.0, 0.8, [1.1, 1.0, 1]]],
    corals: [
      ['table', 11.4, 2.2, 1.0, { top: '#86dcc0', rim: '#e8fff6' }],
      ['sponges', 12.6, 3.2, 0, { palette: ['#ff4fa0', '#d13cd6'] }],
      ['brain', 13.0, 1.2, 0.6, { palette: ['#c9ef5a', '#6f9a22'] }],
    ],
  },
  {
    rocks: [[-10.5, -22.0, 2.0, [1.4, 1.0, 1.2]], [-7.6, -21.0, 1.3, [1.2, 0.9, 1]], [-13.2, -23.6, 1.5, [1.2, 0.9, 1]]],
    corals: [
      ['table', -10.6, -21.4, 1.9, { top: '#86dcc0', rim: '#e8fff6' }],
      ['branch', -12.8, -23.0, 1.6, { base: '#ff7d3a', tip: '#ffe3a6' }],
      ['pillar', -8.0, -21.6, 1.5, { paint: '#ffd86a' }],
      ['whips', -9.4, -23.4, 1.3, { palette: ['#ffcf3a', '#ff8a3d'] }],
    ],
  },
  {
    rocks: [[11.0, -25.0, 2.2, [1.4, 1.0, 1.2]], [8.4, -26.6, 1.4, [1.2, 0.9, 1]]],
    corals: [
      ['table', 11.2, -24.4, 2.0, { top: '#e8b25a', rim: '#fff0c8' }],
      ['branch', 8.6, -26.0, 1.5, { base: '#3e8ed8', tip: '#c9f0ff' }],
      ['pillar', 12.6, -25.8, 1.7, { paint: '#f0cf6a' }],
    ],
  },
  {
    rocks: [[-22.0, -30.0, 2.6, [1.4, 1.0, 1.2]], [24.0, -32.0, 2.8, [1.4, 1.0, 1.2]], [-2.0, -44.0, 3.0, [1.5, 1.0, 1.2]], [13.0, -48.0, 3.2, [1.5, 1.1, 1.2]], [-29.0, -12.0, 2.4, [1.3, 1.0, 1.2]], [29.0, -10.0, 2.6, [1.3, 1.0, 1.2]]],
    corals: [
      ['table', -21.4, -29.4, 2.2, { top: '#9ad89a', rim: '#efffe0' }],
      ['branch', 23.0, -31.4, 2.0, { base: '#d1468c', tip: '#ffc4e6' }],
      ['table', -2.4, -43.4, 2.6, { top: '#86dcc0', rim: '#e8fff6' }],
      ['branch', 13.6, -47.6, 2.4, { base: '#7b4fd0', tip: '#e6d4ff' }],
      ['pillar', -28.4, -11.4, 2.0, { paint: '#f0cf6a' }],
      ['table', 28.4, -9.6, 2.2, { top: '#e8b25a', rim: '#fff0c8' }],
    ],
  },
];

// Low pieces on the sand, including the framing corners in front of the plinth.
const SCATTER = [
  ['brain', -4.6, 8.1, 0.7, { palette: ['#e2f56a', '#6f9424'] }],
  ['branch', -5.4, 7.2, 1.1, { base: '#ff3d8f', tip: '#ffd0ea' }],
  ['anemone', -3.3, 8.4, 0.5, { paint: '#2f9a6a', tip: '#c8ff6a' }],
  ['star', -2.2, 8.6, 0.24, { paint: '#ff7a2e' }],
  ['brain', 4.9, 7.6, 0.65, { palette: ['#ffa6c8', '#b8507c'] }],
  ['clam', 3.6, 8.2, 0.5],
  ['branch', 5.9, 6.6, 0.95, { base: '#1fb8d8', tip: '#d8fdff' }],
  ['sponges', 6.3, 7.7, 0, { palette: ['#ff4fa0', '#d13cd6'] }],
  ['star', 2.6, 8.7, 0.22, { paint: '#2f7de8' }],
  ['brain', -8.6, 5.6, 0.6, { palette: ['#ff9ec4', '#c2507e'] }],
  ['branch', 8.8, 5.4, 0.85, { base: '#8a4bff', tip: '#e8dcff' }],
  ['leather', 9.4, -0.6, 0.6, { paint: '#ff9fd0', rim: '#fff0fa' }],
  ['whips', -9.4, -2.2, 1.0, { palette: ['#ff6a3d', '#ffc23b'] }],
  ['brain', -8.4, -3.6, 0.55, { palette: ['#9ad8ff', '#3a7fd0'] }],
  ['clam', -7.6, -12.0, 0.45],
  ['clam', 6.0, -15.0, 0.42],
  ['clam', 13.6, 4.8, 0.42],
  ['brain', -3.4, -13.0, 0.5, { palette: ['#c9ef5a', '#6f9a22'] }],
  ['brain', 3.6, -17.0, 0.55, { palette: ['#ffb07a', '#c0603a'] }],
  ['leather', -1.8, -19.5, 0.5, { paint: '#b8e86a', rim: '#f6ffd8' }],
  ['star', 1.4, -11.0, 0.22, { paint: '#ff5e7a' }],
  ['star', -5.0, -9.6, 0.2, { paint: '#ffb02e' }],
  ['branch', -4.0, -16.0, 0.8, { base: '#20a7c9', tip: '#d4fbff' }],
  ['sponges', 4.8, -10.4, 0, { palette: ['#ffd23a', '#ff8a2a'] }],
];

const ARCH = { x: 14.5, z: -18.5, yaw: -0.45, span: 8.5, height: 5.2 };

const FANS = [
  [-14.6, -4.6, 2.6, '#b23cff', 0.35],
  [15.0, -3.6, 2.4, '#ff3fb4', -0.5],
  [5.2, 6.9, 2.0, '#a24cff', -0.4],
  [-5.6, 6.4, 1.8, '#ff4fb0', 0.35],
  [-9.0, -19.6, 2.8, '#c040ff', 0.2],
  [17.2, -21.0, 3.0, '#ff5a3c', -0.3],
  [-20.0, -16.0, 3.0, '#9c3cff', 0.5],
  [22.4, -12.0, 2.6, '#d24cff', -0.6],
  [-13.4, 0.4, 1.8, '#ff4fb0', 0.4],
];

// [x, z, radius, count, height scale]
const GRASS_PATCHES = [
  [-2.9, 8.8, 0.8, 26, 0.5],
  [3.3, 8.9, 0.7, 20, 0.5],
  [-8.0, -12.5, 2.6, 120],
  [6.4, -13.0, 2.5, 120],
  [0.0, -19.0, 3.4, 150],
  [-16.0, -2.0, 3.0, 120],
  [16.4, 0.0, 3.0, 120],
  [-3.0, -30.0, 4.0, 110],
  [10.0, -35.0, 3.5, 90],
  [-9.0, 6.0, 1.6, 60],
  [9.4, 7.0, 1.6, 60],
];

const KELP = [
  [-21.0, -5.0, 7],
  [-24.5, -18.0, 8],
  [22.0, -3.0, 7],
  [25.0, -19.0, 8],
  [-8.0, -47.0, 7],
  [9.0, -53.0, 7],
  [-31.0, -36.0, 8],
  [31.0, -40.0, 8],
  [-17.0, 4.0, 5],
  [18.0, 6.0, 5],
];

export const VENTS = [
  { x: -9.6, y: -0.5, z: -14.4, count: 18 },
  { x: 7.4, y: -0.5, z: -19.6, count: 18 },
  { x: 16.2, y: 0.4, z: -9.0, count: 14 },
  { x: -15.6, y: 0.2, z: -10.4, count: 14 },
  { x: 3.6, y: -0.2, z: 8.2, count: 10, size: 0.7, top: 7 },
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
    else if (kind === 'clam') giantClam({ size }).forEach((g) => solid.push(at(g)));
    else if (kind === 'pillar') pillarCoral({ size, seed, ...opts }).forEach((g) => solid.push(at(g)));
    else if (kind === 'leather') solid.push(at(leatherCoral({ radius: size, seed, ...opts })));
    else if (kind === 'anemone') {
      solid.push(at(anemoneBase({ radius: size, paint: opts.paint })));
      anemones.push({ x, y: y + 0.42, z, r: size, tip: opts.tip ?? '#ff7fd1' });
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
  // The arch, with a few colonies along its crown.
  {
    const { x, z, yaw, span, height } = ARCH;
    const y = floorHeight(x, z);
    solid.push(place(rockArch({ span, height, seed: 77 }), { position: [x, y, z], rotation: [0, yaw, 0] }));
    const crown = [
      ['brain', -0.4, 0.62, { palette: ['#ffa6c8', '#b8507c'] }],
      ['branch', 1.6, 0.8, { base: '#ff7a2a', tip: '#ffe0a8' }],
      ['leather', -2.2, 0.55, { paint: '#b8e86a', rim: '#f6ffd8' }],
      ['branch', 0.6, 0.7, { base: '#1fb8d8', tip: '#d8fdff' }],
    ];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const [kind, u, size, opts] of crown) {
      const t = (u / span) * 2;
      const lift = height * (1 - 0.35 * t * t) + 0.7;
      const px = x + u * c;
      const pz = z - u * s;
      const g =
        kind === 'brain' ? [brainCoral({ radius: size, seed: seed++, ...opts })]
          : kind === 'leather' ? [leatherCoral({ radius: size, seed: seed++, ...opts })]
            : branchingCoral({ size, seed: seed++, ...opts });
      g.forEach((p) => solid.push(place(p, { position: [px, y + lift, pz], rotation: [0, rand.range(0, 6), 0] })));
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
    const n = Math.round(r.r * 4.5);
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
  for (const c of SCATTER) addCoral(c, seed++);
  // Scattered pebbles.
  for (let i = 0; i < 30; i++) {
    const x = rand.range(-18, 18);
    const z = rand.range(-32, 9);
    if (Math.hypot(x, z) < 9) continue;
    const r = rand.range(0.14, 0.42);
    solid.push(place(rock({ radius: r, seed: seed++, squash: [1.3, 0.6, 1] }), { position: [x, floorHeight(x, z) - r * 0.2, z] }));
  }
  const blades = [];
  const grassRand = makeRandom(77);
  for (const [cx, cz, radius, count, scale = 1] of GRASS_PATCHES) {
    for (let i = 0; i < count; i++) {
      const a = grassRand.range(0, Math.PI * 2);
      const d = Math.sqrt(grassRand.next()) * radius;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d * 0.7;
      if (Math.hypot(x, z) < 7.9) continue;
      blades.push({ x, y: floorHeight(x, z) - 0.05, z, h: grassRand.range(0.5, 1.3) * (1 - (d / radius) * 0.4) * scale, yaw: grassRand.range(0, 6.28), hue: grassRand.next() });
    }
  }
  const kelp = [];
  const kelpRand = makeRandom(91);
  for (const [cx, cz, count] of KELP) {
    for (let i = 0; i < count; i++) {
      const x = cx + kelpRand.range(-1.6, 1.6);
      const z = cz + kelpRand.range(-1.6, 1.6);
      kelp.push({ x, y: floorHeight(x, z) - 0.1, z, h: kelpRand.range(5.5, 9.6), yaw: kelpRand.range(0, 6.28), hue: kelpRand.next() });
    }
  }
  const fans = FANS.map(([x, z, size, tint, yaw]) => ({ x, y: topAt(x, z) - 0.1, z, size, tint, yaw }));
  return { solid: merge(solid), sway: merge(sway), anemones, blades, kelp, fans };
}

// ---------------------------------------------------------------------------

const sandFragment = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform vec3 uUnderSun;
uniform vec3 uUnderSunColor;
uniform vec3 uUnderSky;
uniform vec3 uUnderGround;
${waterGLSL}
${causticsGLSL}
${hash}
${simplex}
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  vec2 p = vWorld.xz;
  float dist = length(cameraPosition - vWorld);
  // Current-blown sand ripples, faded with distance to avoid shimmer.
  float fade = 1.0 - smoothstep(10.0, 40.0, dist);
  vec2 rd = normalize(vec2(0.35, 1.0));
  float warp = snoise(p * 0.11) * 2.6;
  float ph = dot(p, rd) * 3.0 + warp;
  float slope = cos(ph) * 0.5 * fade;
  n = normalize(n + vec3(rd.x * slope, 0.0, rd.y * slope));
  float crest = smoothstep(0.55, 1.0, sin(ph)) * fade;
  float patchN = snoise(p * 0.06) * 0.5 + 0.5;
  vec3 sand = mix(vec3(0.78, 0.7, 0.56), vec3(0.93, 0.88, 0.76), patchN);
  sand *= 0.92 + 0.12 * crest;
  sand *= 0.95 + 0.07 * hash12(floor(p * 9.0)) * fade;
  // Soft contact shadow around the dome's plinth.
  float r = length(p);
  sand *= mix(0.62, 1.0, smoothstep(7.3, 9.9, r));
  vec3 L = -uUnderSun;
  float depth = max(uSurfaceY - vWorld.y, 0.0);
  vec3 sunC = uUnderSunColor * exp(-depth * vec3(0.05, 0.018, 0.01));
  float diff = max(dot(n, L), 0.0);
  vec3 col = sand * (mix(uUnderGround, uUnderSky, n.y * 0.5 + 0.5) * 0.6 + sunC * diff * 0.36);
  float c = caustics(vWorld, uUnderSun, uSurfaceY, uTime);
  c = mix(c, 0.3, smoothstep(16.0, 50.0, dist));
  col += sand * sunC * c * 0.95 * mix(0.75, 1.0, smoothstep(7.3, 9.9, r));
  col = underwaterFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

function SandFloor({ shared, floorHeight }) {
  const geometry = useDisposable(() => {
    const g = new THREE.PlaneGeometry(320, 210, 160, 105);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -78);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, floorHeight(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          varying vec3 vN;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            vN = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: sandFragment,
      }),
  );
  return <mesh geometry={geometry} material={material} />;
}

function useInstanced(geometry, material, items, write) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, items.length);
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    items.forEach((item, i) => {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      write(item, i, dummy, c);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, c);
    });
    m.frustumCulled = false;
    return m;
  }, [geometry, material, items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => mesh.dispose(), [mesh]);
  return mesh;
}

function Seagrass({ shared, blades }) {
  const geometry = useDisposable(() => bladeGeometry({ width: 0.07 }));
  const material = useDisposable(() =>
    makeLitMaterial(shared, { shininess: 25, specular: 0.25, rim: 0.2, wrap: 0.7, sway: true, swayAmp: 0.32, swaySpeed: 1.1, vertexColors: false, side: THREE.DoubleSide, caustics: 0.7 }),
  );
  const greens = useMemo(() => ['#6fd34a', '#4fc04a', '#9ce65a', '#3eb06a', '#bcec6a'].map((c) => new THREE.Color(c)), []);
  const mesh = useInstanced(geometry, material, blades, (b, i, dummy, c) => {
    dummy.position.set(b.x, b.y, b.z);
    dummy.rotation.set(0, b.yaw, 0);
    dummy.scale.set(1, b.h, 1);
    c.copy(greens[Math.floor(b.hue * greens.length)]);
  });
  return <primitive object={mesh} />;
}

function Kelp({ shared, kelp }) {
  const geometry = useDisposable(() => bladeGeometry({ seg: 18, width: 0.22, bend: 0.5, ruffle: 1 }));
  const material = useDisposable(() =>
    makeLitMaterial(shared, { shininess: 30, specular: 0.3, rim: 0.35, rimColor: '#e6ff9a', wrap: 0.8, sway: true, swayAmp: 1.3, swaySpeed: 0.5, vertexColors: false, side: THREE.DoubleSide, caustics: 0.5 }),
  );
  const tones = useMemo(() => ['#a9c43a', '#c6d24a', '#8fbf3a', '#d8d25a', '#7fb04a'].map((c) => new THREE.Color(c)), []);
  const mesh = useInstanced(geometry, material, kelp, (k, i, dummy, c) => {
    dummy.position.set(k.x, k.y, k.z);
    dummy.rotation.set(0, k.yaw, 0);
    dummy.scale.set(1.2, k.h, 1);
    c.copy(tones[Math.floor(k.hue * tones.length)]);
  });
  return <primitive object={mesh} />;
}

function SeaFans({ shared, fans }) {
  const texture = useDisposable(() => makeLaceTexture());
  const geometry = useDisposable(() => fanGeometry());
  const material = useDisposable(() =>
    makeLitMaterial(shared, { shininess: 20, specular: 0.2, rim: 0.3, rimColor: '#ffd0ff', wrap: 0.7, sway: true, swayAmp: 0.18, swaySpeed: 0.8, vertexColors: false, side: THREE.DoubleSide, caustics: 0.6, map: texture }),
  );
  const mesh = useInstanced(geometry, material, fans, (f, i, dummy, c) => {
    dummy.position.set(f.x, f.y, f.z);
    dummy.rotation.set(0, f.yaw, 0);
    dummy.scale.set(f.size * 1.1, f.size, f.size);
    c.set(f.tint);
  });
  return <primitive object={mesh} />;
}

function Anemones({ shared, anemones }) {
  const geometry = useDisposable(() => tentacleGeometry('#f4ead0', '#ffffff'));
  const material = useDisposable(() =>
    makeLitMaterial(shared, { shininess: 40, specular: 0.4, rim: 0.4, rimColor: '#ffe6fa', wrap: 0.6, sway: true, swayAmp: 0.12, swaySpeed: 1.5, emissive: '#2a1030', caustics: 0.8 }),
  );
  const items = useMemo(() => {
    const rand = makeRandom(5);
    const list = [];
    for (const a of anemones) {
      const tip = new THREE.Color(a.tip);
      const per = Math.round(110 * (a.r / 0.55) ** 2);
      for (let i = 0; i < per; i++) {
        const ang = rand.range(0, Math.PI * 2);
        const rr = Math.sqrt(rand.next()) * a.r * 1.05;
        list.push({ x: a.x + Math.cos(ang) * rr, y: a.y, z: a.z + Math.sin(ang) * rr, ang, tilt: (rr / a.r) * 1.1 + rand.range(-0.15, 0.15), s: rand.range(0.8, 1.25), tip, l: rand.range(0.85, 1.05) });
      }
    }
    return list;
  }, [anemones]);
  const mesh = useInstanced(geometry, material, items, (t, i, dummy, c) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.rotateY(-t.ang);
    dummy.rotateZ(-t.tilt);
    dummy.scale.setScalar(t.s);
    c.copy(t.tip).multiplyScalar(t.l);
  });
  return <primitive object={mesh} />;
}

export function Reef({ shared, floorHeight }) {
  const reef = useDisposable(() => buildReef(floorHeight), [floorHeight]);
  const mats = useDisposable(() => ({
    solid: makeLitMaterial(shared, { shininess: 30, specular: 0.25, rim: 0.14, rimColor: '#9ff0ff', wrap: 0.45, caustics: 1.1 }),
    sway: makeLitMaterial(shared, { shininess: 20, specular: 0.2, rim: 0.2, wrap: 0.5, sway: true, swayAmp: 0.22, swaySpeed: 0.9, caustics: 0.8 }),
  }));
  return (
    <>
      <SandFloor shared={shared} floorHeight={floorHeight} />
      <mesh geometry={reef.solid} material={mats.solid} />
      <mesh geometry={reef.sway} material={mats.sway} />
      <Seagrass shared={shared} blades={reef.blades} />
      <Kelp shared={shared} kelp={reef.kelp} />
      <SeaFans shared={shared} fans={reef.fans} />
      <Anemones shared={shared} anemones={reef.anemones} />
    </>
  );
}
