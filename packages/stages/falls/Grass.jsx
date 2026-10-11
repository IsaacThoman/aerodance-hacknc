import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { fx, lightGLSL, windGLSL } from './fx.js';
import { CAMERA, meadowEdge, meadowHeight, PLATFORM_R } from './terrain.js';

// Blade template: `segments` rows of two vertices plus a tip. x = side, y = t.
function bladeTemplate(segments) {
  const pos = [];
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const w = 1 - Math.pow(t, 1.4) * 0.75;
    pos.push(-w, t, 0, w, t, 0);
  }
  pos.push(0, 1, 0);
  const index = [];
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  index.push(last, last + 1, segments * 2);
  return { pos, index };
}

/** True where the meadow is free for grass (not platform, beds or cliff). */
export function makeGrassMask(blockers) {
  return (x, z, pad = 0) => {
    if (meadowEdge(x, z) < 0.25) return false;
    if (Math.hypot(x, z) < PLATFORM_R + 0.72 + pad) return false;
    return !blockers.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + pad);
  };
}

function sampleWedge(rand, rMin, rMax, half) {
  const r = Math.sqrt(rand.range(rMin * rMin, rMax * rMax));
  const a = rand.range(-half, half);
  return [CAMERA.position[0] + Math.sin(a) * r, CAMERA.position[2] - Math.cos(a) * r, r];
}

function buildBlades({ count, rMin, rMax, segments, width, seed, free }) {
  const rand = makeRandom(seed);
  const { pos, index } = bladeTemplate(segments);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  const roots = new Float32Array(count * 3);
  const blades = new Float32Array(count * 4);
  const vars = new Float32Array(count * 2);
  let n = 0;
  let guard = 0;
  while (n < count && guard++ < count * 5) {
    const [x, z, r] = sampleWedge(rand, rMin, rMax, 0.95);
    if (!free(x, z)) continue;
    // Shorter turf right next to the platform and the cliff lip.
    const edge = THREE.MathUtils.smoothstep(meadowEdge(x, z), 0.25, 1.6);
    const plat = THREE.MathUtils.smoothstep(Math.hypot(x, z), PLATFORM_R + 0.7, PLATFORM_R + 1.6);
    const tall = rand.chance(0.15) ? rand.range(1.3, 1.7) : 1;
    const h = rand.range(0.3, 0.55) * tall * (0.45 + 0.55 * edge) * (0.55 + 0.45 * plat) * (1 + r * 0.012);
    roots.set([x, meadowHeight(x, z) - 0.03, z], n * 3);
    blades.set([rand.range(0, Math.PI * 2), h, width * rand.range(0.75, 1.3) * (1 + r * 0.03), rand.range(0.05, 0.35)], n * 4);
    vars.set([rand.next(), rand.next()], n * 2);
    n++;
  }
  g.setAttribute('aRoot', new THREE.InstancedBufferAttribute(roots, 3));
  g.setAttribute('aBlade', new THREE.InstancedBufferAttribute(blades, 4));
  g.setAttribute('aVar', new THREE.InstancedBufferAttribute(vars, 2));
  g.instanceCount = n;
  return g;
}

const bladeVert = /* glsl */ `
  attribute vec3 aRoot;
  attribute vec4 aBlade;
  attribute vec2 aVar;
  ${windGLSL}
  varying float vT;
  varying float vVar;
  varying float vGust;
  varying vec3 vWorld;
  void main() {
    float t = position.y;
    float yaw = aBlade.x;
    vec2 face = vec2(cos(yaw), sin(yaw));
    vec2 across = vec2(-face.y, face.x);
    float g = gustField(aRoot.xz);
    float ph = aVar.y * 6.2831;
    float sway = sin(uTime * (1.6 + aVar.y * 0.9) + ph + dot(aRoot.xz, uWindDir) * 0.5);
    float flutter = sin(uTime * 8.0 + ph * 3.0) * 0.04 * (0.4 + g);
    vec2 bend = face * aBlade.w + uWindDir * (0.25 + 0.14 * sway + 1.1 * g) + across * (0.08 * sway + flutter);
    float bl = length(bend);
    float h = aBlade.y;
    vec3 p = aRoot;
    p.xz += across * position.x * aBlade.z;
    p.xz += bend * t * t * h;
    p.y += t * h * (1.0 - 0.3 * min(bl * bl, 1.5));
    vT = t;
    vVar = aVar.x;
    vGust = g;
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const bladeFrag = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uMid;
  uniform vec3 uTip;
  uniform vec3 uDry;
  ${lightGLSL}
  varying float vT;
  varying float vVar;
  varying float vGust;
  varying vec3 vWorld;
  void main() {
    vec3 col = mix(uBase, uMid, smoothstep(0.0, 0.6, vT));
    col = mix(col, uTip, smoothstep(0.5, 1.0, vT));
    col = mix(col, uDry, smoothstep(0.85, 1.0, vVar) * 0.55 * vT);
    col *= 0.85 + 0.3 * fract(vVar * 13.71);
    col *= 0.55 + 0.6 * vT;
    col *= uSunColor * 0.8 + uSkyLight * 0.55;
    // Sunlight through the blades and pale undersides flashing in gusts.
    col += uTip * uSunColor * vT * 0.12;
    col = mix(col, col * 1.3 + vec3(0.12, 0.14, 0.05), clamp(vGust, 0.0, 1.2) * smoothstep(0.2, 1.0, vT) * 0.7);
    col = applyHaze(col, vWorld, 1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function GrassField({ free }) {
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
          ...fx,
          uBase: { value: new THREE.Color('#1f5a14') },
          uMid: { value: new THREE.Color('#4aa52a') },
          uTip: { value: new THREE.Color('#b6e85a') },
          uDry: { value: new THREE.Color('#e6e39a') },
        },
        vertexShader: bladeVert,
        fragmentShader: bladeFrag,
      }),
  );
  const near = useDisposable(() => buildBlades({ count: 24000, rMin: 3, rMax: 16, segments: 3, width: 0.032, seed: 3, free }), [free]);
  const far = useDisposable(() => buildBlades({ count: 14000, rMin: 14, rMax: 36, segments: 2, width: 0.05, seed: 8, free }), [free]);
  return (
    <>
      <mesh geometry={near} material={material} frustumCulled={false} />
      <mesh geometry={far} material={material} frustumCulled={false} />
    </>
  );
}

// ---------------------------------------------------------------- flowers

// 2x2 atlas: white daisy, buttercup, pink cosmos, lilac clover-ball.
function makeFlowerAtlas() {
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = cell * 2;
  canvas.height = cell * 2;
  const ctx = canvas.getContext('2d');
  const petals = (cx, cy, n, len, wid, fill, edge) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(len * 0.5, 0, len * 0.5, wid, 0, 0, Math.PI * 2);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, edge);
      g.addColorStop(0.4, fill);
      g.addColorStop(1, fill);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    }
  };
  const center = (cx, cy, r, c0, c1) => {
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const c = cell / 2;
  petals(c, c, 16, 54, 9, '#ffffff', '#e8eef5');
  center(c, c, 15, '#fff27a', '#f0a81c');
  petals(cell + c, c, 5, 50, 22, '#ffe23b', '#f7b500');
  center(cell + c, c, 12, '#fffbd0', '#f2a900');
  petals(c, cell + c, 8, 56, 17, '#ff8fc6', '#ff4f9e');
  center(c, cell + c, 12, '#fff3a0', '#e7a52a');
  for (let i = 0; i < 70; i++) {
    const a = i * 2.39996;
    const r = Math.sqrt(i / 70) * 46;
    ctx.beginPath();
    ctx.arc(cell + c + Math.cos(a) * r, cell + c + Math.sin(a) * r * 0.95, 9, 0, Math.PI * 2);
    ctx.fillStyle = i % 3 === 0 ? '#f4e1ff' : '#c99cf2';
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildFlowers(free, seed = 21) {
  const rand = makeRandom(seed);
  // Stem quad (part 0) + head quad (part 1).
  const pos = [-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0, -1, -1, 1, 1, -1, 1, -1, 1, 1, 1, 1, 1];
  const index = [0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  const roots = [];
  const params = [];
  for (let c = 0; c < 74; c++) {
    // Half the clumps ring the platform edge, the rest roam the meadow.
    let cx;
    let cz;
    if (c % 2 === 0) {
      const a = rand.range(-Math.PI, Math.PI);
      const r = PLATFORM_R + rand.range(1.0, 2.6);
      cx = Math.sin(a) * r;
      cz = Math.cos(a) * r;
    } else {
      [cx, cz] = sampleWedge(rand, 4, 24, 0.95);
    }
    const type = rand.pick([0, 0, 1, 1, 2, 3, 2]);
    const type2 = rand.pick([0, 1, 2, 3]);
    const n = Math.round(rand.range(10, 24));
    const spread = rand.range(0.7, 1.8);
    for (let i = 0; i < n; i++) {
      const a = rand.range(0, Math.PI * 2);
      const d = Math.pow(rand.next(), 0.7) * spread;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (!free(x, z, 0.2)) continue;
      roots.push(x, meadowHeight(x, z), z);
      params.push(rand.chance(0.8) ? type : type2, rand.range(0.3, 0.62), rand.range(0.075, 0.12), rand.next());
    }
  }
  g.setAttribute('aRoot', new THREE.InstancedBufferAttribute(new Float32Array(roots), 3));
  g.setAttribute('aFlower', new THREE.InstancedBufferAttribute(new Float32Array(params), 4));
  g.instanceCount = roots.length / 3;
  return g;
}

export function Wildflowers({ free }) {
  const geometry = useDisposable(() => buildFlowers(free), [free]);
  const texture = useDisposable(makeFlowerAtlas);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { ...fx, uMap: { value: texture }, uStem: { value: new THREE.Color('#3f8f25') } },
        vertexShader: /* glsl */ `
          attribute vec3 aRoot;
          attribute vec4 aFlower;
          ${windGLSL}
          varying vec2 vUv;
          varying float vPart;
          varying vec3 vWorld;
          void main() {
            float part = position.z;
            float h = aFlower.y;
            float g = gustField(aRoot.xz);
            float ph = aFlower.w * 6.2831;
            float sway = sin(uTime * (1.4 + aFlower.w) + ph + dot(aRoot.xz, uWindDir) * 0.5);
            vec2 bend = uWindDir * (0.16 + 0.13 * sway + 0.7 * g) + vec2(0.05 * sin(ph), 0.05 * cos(ph));
            vec3 tip = aRoot + vec3(bend.x * h, h * (1.0 - 0.25 * dot(bend, bend)), bend.y * h);
            vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            vec3 p;
            if (part < 0.5) {
              float t = position.y;
              vec3 along = mix(aRoot, tip, t);
              along.xz += bend * h * (t * t - t) * 0.6;
              p = along + camR * position.x * 0.01 * (1.0 + h);
              vUv = vec2(0.0, t);
            } else {
              float s = aFlower.z;
              float nod = sway * 0.25 + g * 0.4;
              vec2 q = position.xy;
              q = vec2(q.x * cos(nod) - q.y * sin(nod), q.x * sin(nod) + q.y * cos(nod));
              p = tip + (camR * q.x + camU * q.y * 0.85) * s;
              vec2 cell = vec2(mod(aFlower.x, 2.0), 1.0 - floor(aFlower.x / 2.0));
              vUv = (position.xy * 0.5 + 0.5 + cell) * 0.5;
            }
            vPart = part;
            vWorld = p;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uStem;
          ${lightGLSL}
          varying vec2 vUv;
          varying float vPart;
          varying vec3 vWorld;
          void main() {
            vec3 col;
            if (vPart < 0.5) {
              col = uStem * (0.5 + 0.6 * vUv.y);
            } else {
              vec4 t = texture2D(uMap, vUv);
              if (t.a < 0.5) discard;
              col = t.rgb * 1.05;
            }
            col *= uSunColor * 0.85 + uSkyLight * 0.45;
            col = applyHaze(col, vWorld, 1.0);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
