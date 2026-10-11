import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { fx, lightGLSL, windGLSL } from './fx.js';
import {
  CAMERA, distToRiver, lakeMask, LAKE_Y, lawnMask, makeNoise2, meadowEdge, MESAS, mesaRadius, smooth, valleyHeight,
} from './terrain.js';

// Unit tree: trunk (uv.x = 0) of height 1, crown (uv.x = 1) as a unit sphere at
// y = 0. The vertex shader stretches them per instance.
function unitTree(detail, lumpy) {
  const trunk = new THREE.CylinderGeometry(0.5, 0.8, 1, 6, 1, true);
  trunk.translate(0, 0.5, 0);
  trunk.deleteAttribute('uv');
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(trunk.attributes.position.count * 2), 2));
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const crown = mergeVertices(ico);
  ico.dispose();
  if (lumpy) {
    const n = makeNoise2(9);
    const pos = crown.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const k = 1 + 0.12 * n(v.x * 2.2 + v.y, v.z * 2.2 - v.y) + 0.06 * n(v.x * 5, v.z * 5 + v.y * 3);
      v.multiplyScalar(k);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  crown.computeVertexNormals();
  crown.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(crown.attributes.position.count * 2).fill(1), 2));
  const merged = mergeGeometries([trunk, crown]);
  trunk.dispose();
  crown.dispose();
  return merged;
}

const vertex = /* glsl */ `
  attribute vec4 aTree;   // x, y, z, crown radius
  attribute vec4 aShape;  // trunk height, crown stretch, hue variation, phase
  ${windGLSL}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vPart;
  varying float vVar;
  varying vec3 vLocal;
  void main() {
    float part = uv.x;
    float r = aTree.w;
    vec3 p;
    vec3 nrm = normal;
    if (part < 0.5) {
      p = vec3(position.x * r * 0.14, position.y * (aShape.x + r * 0.4), position.z * r * 0.14);
    } else {
      p = vec3(position.x * r, position.y * r * aShape.y, position.z * r);
      p.y += aShape.x + r * aShape.y * 0.85;
      nrm = normalize(vec3(normal.x, normal.y / aShape.y, normal.z));
      // Crowns lean and rustle in the gusts.
      float g = gustField(aTree.xz);
      float hgt = clamp(position.y * 0.5 + 0.5, 0.0, 1.0);
      float sway = sin(uTime * 1.1 + aShape.w * 6.28) * 0.5 + sin(uTime * 1.9 + aShape.w * 3.1) * 0.25;
      p.xz += uWindDir * r * (0.03 + 0.04 * sway + 0.07 * g) * hgt;
      p += normal * sin(uTime * 5.0 + dot(position, vec3(3.1, 2.3, 2.7)) + aShape.w * 9.0) * r * 0.025 * (0.4 + g);
    }
    vec4 w = modelMatrix * vec4(p + aTree.xyz, 1.0);
    vWorld = w.xyz;
    vNormal = nrm;
    vPart = part;
    vVar = aShape.z;
    vLocal = position;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uLeafDark;
  uniform vec3 uLeaf;
  uniform vec3 uLeafLight;
  uniform vec3 uTrunk;
  ${lightGLSL}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vPart;
  varying float vVar;
  varying vec3 vLocal;
  float hashF(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    vec3 n = normalize(vNormal);
    vec3 col;
    if (vPart < 0.5) {
      col = shadeLambert(uTrunk, n, 0.3, 0.8);
    } else {
      float wrap = clamp((dot(n, uSunDir) + 0.45) / 1.45, 0.0, 1.0);
      float leaf = hashF(floor(vLocal * 3.0 + vVar * 17.0));
      float tone = wrap * (0.75 + 0.25 * (vLocal.y * 0.5 + 0.5)) + (leaf - 0.5) * 0.18;
      vec3 base = mix(uLeafDark, uLeaf, smoothstep(0.1, 0.55, tone));
      base = mix(base, uLeafLight, smoothstep(0.55, 1.0, tone));
      // Per-tree hue: some lime, some deep emerald, a few spring-yellow.
      base *= mix(vec3(0.85, 1.0, 0.9), vec3(1.15, 1.08, 0.75), vVar);
      col = base * (uSunColor * 0.85 + ambient(n) * 0.9);
      vec3 v = normalize(cameraPosition - vWorld);
      float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      col += uLeafLight * rim * 0.18;
    }
    col = applyHaze(col, vWorld, 1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function useTreeMaterial() {
  return useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...fx,
          uLeafDark: { value: new THREE.Color('#174f17') },
          uLeaf: { value: new THREE.Color('#3f9e22') },
          uLeafLight: { value: new THREE.Color('#a6e04a') },
          uTrunk: { value: new THREE.Color('#6b4b33') },
        },
        vertexShader: vertex,
        fragmentShader: fragment,
      }),
  );
}

function instanced(base, trees) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, base.attributes[k]);
  g.setAttribute('aTree', new THREE.InstancedBufferAttribute(new Float32Array(trees.flatMap((t) => [t.x, t.y, t.z, t.r])), 4));
  g.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(trees.flatMap((t) => [t.trunk, t.stretch, t.hue, t.phase])), 4));
  g.instanceCount = trees.length;
  return g;
}

const forestN = makeNoise2(303);

export function makeTree(rand, x, y, z, r, opts = {}) {
  return { x, y, z, r, trunk: opts.trunk ?? r * rand.range(0.5, 0.9), stretch: opts.stretch ?? rand.range(0.95, 1.35), hue: rand.next(), phase: rand.next() };
}

/**
 * Deterministic tree layout for the valley floor and mesa tops, split into
 * level-of-detail tiers by distance from the camera. avoid: [{ x, z, r }]
 */
export function layoutTrees(avoid = []) {
  const rand = makeRandom(77);
  const near = [];
  const mid = [];
  const far = [];
  const [cx, , cz] = CAMERA.position;
  const add = (list, x, y, z, r) => list.push(makeTree(rand, x, y, z, r));

  // Valley forests: clumps on the hills, open lawns between, none in water.
  let guard = 0;
  while (mid.length + far.length < 2600 && guard++ < 80000) {
    const a = rand.range(-1.25, 1.25);
    const d = 60 + Math.pow(rand.next(), 1.6) * 820;
    const x = cx + Math.sin(a) * d;
    const z = cz - Math.cos(a) * d;
    if (meadowEdge(x, z) > -4) continue;
    if (lakeMask(x, z, 4) > 0.01 || distToRiver(x, z) < 9) continue;
    const clump = smooth(-0.15, 0.45, forestN(x * 0.012, z * 0.012)) * (1 - smooth(0.25, 0.6, lawnMask(x, z)));
    if (rand.next() > clump * 0.9 + 0.04) continue;
    const y = valleyHeight(x, z);
    if (y < LAKE_Y + 0.8) continue;
    if (MESAS.some((m) => Math.hypot(x - m.x, z - m.z) < m.r * 1.45)) continue;
    const r = rand.range(1.9, 3.1) * (1 + d * 0.0012);
    add(d < 140 ? mid : far, x, y - 0.4, z, r);
  }
  // Mesa tops: a ring of trees along the rim plus a few inland.
  for (const m of MESAS) {
    const n = Math.round(m.r * 0.9);
    for (let i = 0; i < n; i++) {
      const a = rand.range(0, Math.PI * 2);
      const edge = mesaRadius(m, a, 1);
      const k = rand.chance(0.65) ? rand.range(0.72, 0.9) : rand.range(0.1, 0.7);
      const x = m.x + Math.cos(a) * edge * k;
      const z = m.z + Math.sin(a) * edge * k;
      const nearFall = m.falls.some((f) => {
        const da = Math.atan2(Math.sin(a - THREE.MathUtils.degToRad(f.angle)), Math.cos(a - THREE.MathUtils.degToRad(f.angle)));
        return Math.abs(da) < (f.width / m.r) * 1.6;
      });
      if (nearFall || avoid.some((o) => Math.hypot(x - o.x, z - o.z) < o.r)) continue;
      const d = Math.hypot(x - cx, z - cz);
      add(d < 95 ? near : d < 140 ? mid : far, x, m.top + 0.3 + 2.2 * (1 - k), z, rand.range(2.4, 3.8));
    }
  }
  return { near, mid, far };
}

/** A small standalone batch of trees (e.g. riding on a floating island). */
export function TreeGroup({ trees, detail = 2 }) {
  const material = useTreeMaterial();
  const base = useDisposable(() => unitTree(detail, detail > 2), [detail]);
  const geometry = useDisposable(() => instanced(base, trees), [base, trees]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

export function Trees({ layout }) {
  const material = useTreeMaterial();
  const farBase = useDisposable(() => unitTree(1, false));
  const midBase = useDisposable(() => unitTree(2, false));
  const nearBase = useDisposable(() => unitTree(3, true));
  const far = useDisposable(() => instanced(farBase, layout.far), [farBase, layout]);
  const mid = useDisposable(() => instanced(midBase, layout.mid), [midBase, layout]);
  const near = useDisposable(() => instanced(nearBase, layout.near), [nearBase, layout]);
  return (
    <>
      <mesh geometry={far} material={material} frustumCulled={false} />
      <mesh geometry={mid} material={material} frustumCulled={false} />
      {layout.near.length > 0 && <mesh geometry={near} material={material} frustumCulled={false} />}
    </>
  );
}
