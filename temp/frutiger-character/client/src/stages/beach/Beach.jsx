import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { hash, simplex } from '../shared/glsl.js';
import { makeRandom } from '../shared/random.js';
import { WATER_Y, world } from './palette.js';
import { patchMaterial } from './shaders.js';
import { sandHeight } from './terrain.js';
import { blob, color, finalize, merge, place } from './geometry.js';
import {
  beachBallGeometry,
  bucketGeometry,
  flipFlopGeometry,
  sandcastleGeometry,
  towelGeometry,
  lifeguardGeometry,
  loungerGeometry,
  palmGeometry,
  surfboardGeometry,
  surfRackGeometry,
  umbrellaGeometry,
} from './props.js';
import { LIFEGUARD, LOUNGERS, PALMS, SURF_RACK, UMBRELLAS, ground, onArm } from './layout.js';
import meta from './meta.js';

const sandFragment = {
  uniforms: {
    uSandDry: { value: new THREE.Color('#eec088') },
    uSandLight: { value: new THREE.Color('#f8d9a6') },
    uSandWet: { value: new THREE.Color('#a87a52') },
  },
  head: /* glsl */ `
    ${hash}
    ${simplex}
    uniform vec3 uSandDry, uSandLight, uSandWet;
    float sandWet;
    // Footprints from a toward b: alternating left/right prints along a gentle wiggle.
    float footprints(vec2 p, vec2 a, vec2 b, float wiggle) {
      vec2 d = normalize(b - a);
      vec2 n = vec2(-d.y, d.x);
      float len = length(b - a);
      float i0 = floor(dot(p - a, d) / 0.62 + 0.5);
      float best = 0.0;
      for (int k = -1; k <= 1; k++) {
        float i = i0 + float(k);
        if (i < 0.0 || i * 0.62 > len) continue;
        float side = mod(i, 2.0) * 2.0 - 1.0;
        vec2 c = a + d * (i * 0.62) + n * (side * 0.13 + sin(i * 0.45) * wiggle);
        vec2 q = vec2(dot(p - c, d), dot(p - c, n));
        float w = 0.045 + 0.025 * smoothstep(-0.12, 0.08, q.x);
        best = max(best, 1.0 - smoothstep(0.7, 1.0, length(vec2(q.x / 0.13, q.y / w))));
      }
      return best;
    }
  `,
  color: /* glsl */ `
    {
      vec2 sp = vHazeWorld.xz;
      float n1 = snoise(sp * 0.13) * 0.5 + 0.5;
      float n2 = snoise(sp * 0.8 + 7.0) * 0.5 + 0.5;
      float grain = hash12(floor(sp * 22.0)) - 0.5;
      vec3 dry = mix(uSandDry, uSandLight, n1 * 0.7 + n2 * 0.3) * (1.0 + grain * 0.07);
      // Wet strip along the waterline, darker right at the lapping edge.
      float above = vHazeWorld.y - ${WATER_Y.toFixed(3)};
      sandWet = 1.0 - smoothstep(0.08, 0.3, above + (n2 - 0.5) * 0.06);
      float fresh = 1.0 - smoothstep(0.0, 0.06, vHazeWorld.y - uWaterY);
      diffuseColor.rgb = mix(dry, uSandWet, sandWet * 0.75 + fresh * 0.25);
      // Two trails of footprints wandering up to the dancers and over to the towel.
      float fp = max(footprints(sp, vec2(-2.0, 14.5), vec2(-1.1, 6.0), 0.22), footprints(sp, vec2(7.4, 13.0), vec2(4.6, 6.0), 0.28));
      diffuseColor.rgb *= 1.0 - 0.3 * fp * (1.0 - sandWet);
    }
  `,
  roughness: /* glsl */ `roughnessFactor = mix(roughnessFactor, 0.12, sandWet);`,
  // Wind ripples that catch the low sun (world-space tilt, applied in view space).
  normal: /* glsl */ `
    {
      vec2 sp = vHazeWorld.xz;
      float warp = snoise(sp * 0.25) * 1.5;
      float ph = sp.y * 3.1 + sp.x * 0.9 + warp;
      float amp = 0.24 * (1.0 - sandWet) * smoothstep(0.1, 0.55, snoise(sp * 0.07 + 3.0) * 0.5 + 0.5);
      // Finer ripples that only resolve close to the lens.
      float fine = cos(sp.y * 7.3 + sp.x * 1.6 + warp * 2.0) * 0.14 * (1.0 - sandWet) * smoothstep(-6.0, 8.0, sp.y);
      vec3 tilt = vec3(0.3, 0.0, 1.0) * (cos(ph) * amp + fine);
      normal = normalize(normal + (viewMatrix * vec4(tilt, 0.0)).xyz);
    }
  `,
};

/** Sand: a camera-dense grid shaped by the cove's height function. */
function Sand() {
  const geometry = useDisposable(() => {
    const NX = 150;
    const NZ = 110;
    const g = new THREE.PlaneGeometry(1, 1, NX, NZ);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) * 2;
      const w = pos.getZ(i) * 2;
      const x = Math.sign(u) * Math.pow(Math.abs(u), 1.7) * 110;
      const z = Math.sign(w) * Math.pow(Math.abs(w), 1.6) * (w < 0 ? 80 : 50);
      pos.setXYZ(i, x, sandHeight(x, z), z);
    }
    g.computeVertexNormals();
    g.deleteAttribute('uv');
    return g;
  });
  const material = useDisposable(() =>
    patchMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92 }), { key: 'sand', fragment: sandFragment }),
  );
  return <mesh geometry={geometry} material={material} receiveShadow />;
}

/** Palms and glossy jungle bushes along both arms of the cove; one swaying mesh. */
function Vegetation() {
  const geometry = useDisposable(() => {
    const parts = [];
    PALMS.forEach((p, i) => {
      const [x, y, z] = p.side ? onArm(p.side, p.z, p.inland) : ground(p.x, p.z);
      for (const g of palmGeometry({ height: p.height, lean: p.lean, heading: p.heading, fronds: p.fronds, seed: 30 + i, frondLength: p.height * 0.42, hue: (i % 3) * 0.015 })) {
        parts.push(place(g, { position: [x, y, z] }));
      }
    });
    const rand = makeRandom(8);
    const greens = ['#2f9a40', '#47b23e', '#23843c', '#62bf48', '#1f8a52'];
    for (const side of [-1, 1]) {
      const end = side < 0 ? -40 : -52;
      for (let z = -6; z > end; z -= rand.range(2.2, 3.6)) {
        for (let k = 0; k < 2; k++) {
          const inland = rand.range(10, 16) + k * 6;
          const [x, y] = onArm(side, z, inland);
          const s = rand.range(1.2, 2.3) * (1 + k * 0.4);
          const g = blob({ radius: s, detail: 2, squash: [1, rand.range(0.7, 0.95), 1], amount: 0.24, freq: 1.8, seed: 200 + parts.length });
          place(g, { position: [x, y + s * 0.35, z], rotation: [0, rand.range(0, 6), 0] });
          const c1 = color(rand.pick(greens));
          const c2 = c1.clone().multiplyScalar(0.5);
          const top = c1.clone().lerp(color('#eaff9a'), 0.35);
          parts.push(
            finalize(g, {
              paint: (p, n, out) => out.copy(c2).lerp(c1, THREE.MathUtils.smoothstep(n.y, -0.4, 0.4)).lerp(top, THREE.MathUtils.smoothstep(n.y, 0.6, 1) * 0.6),
              sway: 0.05,
            }),
          );
        }
      }
    }
    return merge(parts);
  });
  const material = useDisposable(() =>
    patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide }), { sway: 0.32, key: 'veg', ibl: 0.3, translucency: 0.8 }),
  );
  return <mesh geometry={geometry} material={material} />;
}

function scallop(rand) {
  const g = new THREE.CircleGeometry(1, 10, 0, Math.PI);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const a = Math.atan2(y, x);
    pos.setZ(i, 0.25 * Math.sqrt(Math.max(0, 1 - x * x - y * y)) + 0.04 * Math.abs(Math.sin(a * 10)));
  }
  g.computeVertexNormals();
  const tone = rand.pick(['#ffd0c8', '#ffe9dc', '#ffb6a6', '#fff4ea']);
  return finalize(g, { paint: (p, n, out) => out.set(tone).lerp(color('#ff8f84'), Math.max(0, 0.6 - Math.hypot(p.x, p.y)) * 0.6) });
}

function starfish() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.38 : 1;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 1 });
  return finalize(g, { paint: '#ff8a4a' });
}

/** Static glossy props: umbrellas, loungers, lifeguard tower, surf rack, shells. */
function BeachProps() {
  const geometry = useDisposable(() => {
    const parts = [];
    UMBRELLAS.forEach((u) => {
      const [x, y, z] = onArm(u.side, u.z, u.inland);
      parts.push(place(umbrellaGeometry({ stripes: u.stripes, tilt: u.tilt }), { position: [x, y - 0.1, z] }));
    });
    LOUNGERS.forEach((l) => {
      const [x, y, z] = onArm(l.side, l.z, l.inland);
      parts.push(place(loungerGeometry({ towel: l.towel }), { position: [x, y - 0.05, z], rotation: [0, l.heading, 0] }));
    });
    {
      const [x, y, z] = onArm(LIFEGUARD.side, LIFEGUARD.z, LIFEGUARD.inland);
      parts.push(place(lifeguardGeometry(), { position: [x, y - 0.1, z], rotation: [0, LIFEGUARD.heading, 0], scale: 1.05 }));
    }
    {
      const [x, z] = SURF_RACK.at;
      const y = sandHeight(x, z);
      const rack = merge([
        ...surfRackGeometry(),
        place(surfboardGeometry({ base: '#ffffff', stripe: '#2fc6e8' }), { position: [-0.75, 0, -0.35], rotation: [-0.18, 0, 0.04] }),
        place(surfboardGeometry({ base: '#ff7a86', stripe: '#ffffff', length: 2.3 }), { position: [-0.25, 0, -0.38], rotation: [-0.2, 0, -0.03] }),
        place(surfboardGeometry({ base: '#ffd34a', stripe: '#ff6f61', length: 1.9 }), { position: [0.25, 0, -0.35], rotation: [-0.17, 0, 0.05] }),
        place(surfboardGeometry({ base: '#3fd3b0', stripe: '#ffffff', length: 2.2 }), { position: [0.75, 0, -0.37], rotation: [-0.19, 0, -0.02] }),
      ]);
      parts.push(place(rack, { position: [x, y - 0.05, z], rotation: [0, SURF_RACK.heading, 0] }));
    }
    // Shells and starfish scattered over the foreground sand.
    const rand = makeRandom(44);
    for (let i = 0; i < 34; i++) {
      const x = rand.range(-11, 11);
      const z = rand.range(-1, 13);
      // Keep the dancers' patch of sand clear.
      if (Math.hypot(x - meta.dancers.position[0], z - meta.dancers.position[2]) < 4.2) continue;
      const y = sandHeight(x, z);
      if (i % 7 === 0) parts.push(place(starfish(), { position: [x, y + 0.02, z], rotation: [-Math.PI / 2, 0, rand.range(0, 6)], scale: rand.range(0.14, 0.2) }));
      else parts.push(place(scallop(rand), { position: [x, y + 0.01, z], rotation: [-Math.PI / 2 + 0.1, 0, rand.range(0, 6)], scale: rand.range(0.1, 0.17) }));
    }
    // A few more along the strip of sand in front of the dancers.
    for (let i = 0; i < 14; i++) {
      const x = rand.range(-5.5, 5.5);
      const z = rand.range(6.0, 9.5);
      parts.push(place(scallop(rand), { position: [x, sandHeight(x, z) + 0.01, z], rotation: [-Math.PI / 2 + 0.15, 0, rand.range(0, 6)], scale: rand.range(0.1, 0.15) }));
    }
    // Towel and flip-flops beside the dancers; a sandcastle and bucket on the other side.
    for (const [g, x, z, rot] of [
      [towelGeometry(), 4.3, 5.5, 0.9],
      [flipFlopGeometry('#ff7fa8'), 5.15, 6.5, 0.4],
      [flipFlopGeometry('#ff7fa8'), 5.4, 6.3, 0.15],
      [place(sandcastleGeometry(), { scale: 0.85 }), -3.0, 6.2, 0.3],
      [bucketGeometry(), -2.15, 6.75, 0],
    ]) {
      parts.push(place(g, { position: [x, sandHeight(x, z) - 0.02, z], rotation: [0, rot, 0] }));
    }
    return merge(parts);
  });
  const material = useDisposable(() =>
    patchMaterial(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }), { key: 'props' }),
  );
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />;
}

const BALLS = [
  { x: -3.7, z: 6.9, r: 0.36, float: false },
  { x: 6.3, z: 4.4, r: 0.32, float: false },
  { x: -3.4, z: -9.5, r: 0.45, float: true },
];

/** Glossy beach balls: two resting on the sand, one bobbing in the cove. */
function BeachBalls() {
  const mesh = useRef();
  const geometry = useDisposable(() => beachBallGeometry());
  const material = useDisposable(() =>
    patchMaterial(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }), { key: 'ball' }),
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const t = world.uTime.value;
    BALLS.forEach((b, i) => {
      const y = b.float ? world.uWaterY.value + b.r * 0.55 + Math.sin(t * 1.6 + i) * 0.05 : sandHeight(b.x, b.z) + b.r * 0.92;
      const x = b.float ? b.x + Math.sin(t * 0.21) * 1.2 : b.x;
      dummy.position.set(x, y, b.z);
      dummy.rotation.set(b.float ? Math.sin(t * 1.3) * 0.25 : 0.3 + i, b.float ? t * 0.2 : i * 1.7, b.float ? Math.cos(t * 1.1) * 0.2 : 0.2);
      dummy.scale.setScalar(b.r);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, BALLS.length]} castShadow frustumCulled={false} />;
}

export function Beach() {
  return (
    <>
      <Sand />
      <Vegetation />
      <BeachProps />
      <BeachBalls />
    </>
  );
}
