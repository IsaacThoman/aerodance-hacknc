import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { cloudGLSL, lightGLSL, lightUniforms, windGLSL, windUniforms } from './fx.js';
import { CAM_XZ, distToPath, heightAt, pondMask } from './terrain.js';

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

// Area-uniform sampling inside a view wedge in front of the camera.
function sampleWedge(rand, rMin, rMax, halfAngle) {
  const r = Math.sqrt(rand.range(rMin * rMin, rMax * rMax));
  const a = rand.range(-halfAngle, halfAngle);
  return [CAM_XZ[0] + Math.sin(a) * r, CAM_XZ[1] - Math.cos(a) * r, r];
}

function buildBlades({ count, rMin, rMax, segments, width, seed, halfAngle = 0.82 }) {
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
  while (n < count && guard++ < count * 4) {
    const [x, z, r] = sampleWedge(rand, rMin, rMax, halfAngle);
    if (pondMask(x, z, 0.4) > 0.05) continue;
    const pd = distToPath(x, z);
    if (pd < 0.55) continue;
    // Clumpy density: thin out some patches so the field has texture.
    const fade = 1 - THREE.MathUtils.smoothstep(r, rMax * 0.8, rMax);
    const nearPath = THREE.MathUtils.smoothstep(pd, 0.55, 1.6);
    const shore = 1 - pondMask(x, z, 2.5) * 0.4;
    const y = heightAt(x, z);
    roots.set([x, y - 0.02, z], n * 3);
    const tall = rand.chance(0.12) ? rand.range(1.25, 1.6) : 1;
    const h = rand.range(0.32, 0.62) * tall * (0.35 + 0.65 * fade) * nearPath * shore * (1 + r * 0.006);
    const w = width * rand.range(0.75, 1.25) * (1 + r * 0.02);
    blades.set([rand.range(0, Math.PI * 2), h, w, rand.range(0.05, 0.4)], n * 4);
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
  ${cloudGLSL}
  varying float vT;
  varying float vVar;
  varying float vGust;
  varying float vCloud;
  varying vec3 vWorld;
  void main() {
    float t = position.y;
    float yaw = aBlade.x;
    vec2 face = vec2(cos(yaw), sin(yaw));
    vec2 across = vec2(-face.y, face.x);
    float g = gustField(aRoot.xz);
    float ph = aVar.y * 6.2831;
    float sway = sin(uTime * (1.5 + aVar.y * 0.9) + ph + dot(aRoot.xz, uWindDir) * 0.45);
    float flutter = sin(uTime * 7.0 + ph * 3.0) * 0.03 * (0.4 + g);
    vec2 bend = face * aBlade.w + uWindDir * (0.22 + 0.13 * sway + 1.15 * g) + across * (0.07 * sway + flutter);
    float bl = length(bend);
    float h = aBlade.y;
    vec3 p = aRoot;
    p.xz += across * position.x * aBlade.z;
    p.xz += bend * t * t * h;
    p.y += t * h * (1.0 - 0.3 * min(bl * bl, 1.5));
    vT = t;
    vVar = aVar.x;
    vGust = g;
    vCloud = cloudShade(aRoot.xz, uTime, uWindDir);
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const bladeFrag = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uMid;
  uniform vec3 uTip;
  uniform vec3 uDry;
  uniform vec3 uFlash;
  ${lightGLSL}
  varying float vT;
  varying float vVar;
  varying float vGust;
  varying float vCloud;
  varying vec3 vWorld;
  void main() {
    vec3 col = mix(uBase, uMid, smoothstep(0.0, 0.6, vT));
    col = mix(col, uTip, smoothstep(0.5, 1.0, vT));
    // Per-blade variety: a few sun-bleached, a few deep emerald.
    col = mix(col, uDry, smoothstep(0.82, 1.0, vVar) * 0.6 * vT);
    col *= 0.86 + 0.28 * fract(vVar * 13.71);
    // Self-shadowing toward the roots, sun on the tips.
    col *= 0.5 + 0.62 * vT;
    vec3 light = uSunColor * 0.75 + uSkyLight * 0.45;
    col *= light;
    // Sun shining through the blades (translucency).
    vec3 v = normalize(vWorld - cameraPosition);
    float back = pow(max(dot(v, normalize(uSunView)), 0.0), 4.0);
    col += uTip * uSunColor * back * vT * 0.5;
    // Gust flash: bending blades show their pale undersides.
    col *= vCloud;
    col = mix(col, col * 1.35 + uFlash * 0.3, clamp(vGust, 0.0, 1.3) * smoothstep(0.15, 1.0, vT) * 0.95);
    col = applyHaze(col, vWorld, 1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function useBladeMaterial() {
  return useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
          ...windUniforms,
          ...lightUniforms,
          uBase: { value: new THREE.Color('#1d5e16') },
          uMid: { value: new THREE.Color('#47a326') },
          uTip: { value: new THREE.Color('#a7e04f') },
          uDry: { value: new THREE.Color('#e3e08a') },
          uFlash: { value: new THREE.Color('#f2ffd0') },
        },
        vertexShader: bladeVert,
        fragmentShader: bladeFrag,
      }),
  );
}

export function GrassField() {
  const material = useBladeMaterial();
  const near = useDisposable(() => buildBlades({ count: 22000, rMin: 0.6, rMax: 11, segments: 4, width: 0.028, seed: 3 }));
  const far = useDisposable(() => buildBlades({ count: 52000, rMin: 9, rMax: 58, segments: 2, width: 0.05, seed: 8 }));
  return (
    <>
      <mesh geometry={near} material={material} frustumCulled={false} />
      <mesh geometry={far} material={material} frustumCulled={false} />
    </>
  );
}

// ------------------------------------------------------------------ flowers

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
  // Daisy.
  petals(c, c, 16, 54, 9, '#ffffff', '#e8eef5');
  center(c, c, 15, '#fff27a', '#f0a81c');
  // Buttercup.
  petals(cell + c, c, 5, 50, 22, '#ffe23b', '#f7b500');
  center(cell + c, c, 12, '#fffbd0', '#f2a900');
  // Pink cosmos.
  petals(c, cell + c, 8, 56, 17, '#ff8fc6', '#ff4f9e');
  center(c, cell + c, 12, '#fff3a0', '#e7a52a');
  // Lilac clover ball.
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
  t.anisotropy = 4;
  return t;
}

function buildFlowers(seed = 21) {
  const rand = makeRandom(seed);
  // Stem quad (part 0) + head quad (part 1).
  const pos = [-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0, -1, -1, 1, 1, -1, 1, -1, 1, 1, 1, 1, 1];
  const index = [0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  const roots = [];
  const params = [];
  const clumps = 70;
  for (let c = 0; c < clumps; c++) {
    const [cx, cz, r] = sampleWedge(rand, 1.8, 52, 0.86);
    const type = rand.pick([0, 0, 1, 1, 2, 3, 0, 2]);
    const type2 = rand.pick([0, 1, 2, 3]);
    const n = Math.round(rand.range(8, 26) * (r < 12 ? 0.7 : 1.2));
    const spread = rand.range(0.8, 2.2) * (1 + r * 0.02);
    for (let i = 0; i < n; i++) {
      const a = rand.range(0, Math.PI * 2);
      const d = Math.pow(rand.next(), 0.7) * spread;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (pondMask(x, z, 0.4) > 0.02 || distToPath(x, z) < 0.8) continue;
      const dist = Math.hypot(x - CAM_XZ[0], z - CAM_XZ[1]);
      roots.push(x, heightAt(x, z), z);
      const t = rand.chance(0.8) ? type : type2;
      const size = rand.range(0.065, 0.11) * (1 + dist * 0.018);
      params.push(t, rand.range(0.28, 0.6), size, rand.next());
    }
  }
  g.setAttribute('aRoot', new THREE.InstancedBufferAttribute(new Float32Array(roots), 3));
  g.setAttribute('aFlower', new THREE.InstancedBufferAttribute(new Float32Array(params), 4));
  g.instanceCount = roots.length / 3;
  return g;
}

export function Wildflowers() {
  const geometry = useDisposable(() => buildFlowers());
  const texture = useDisposable(makeFlowerAtlas);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
          ...windUniforms,
          ...lightUniforms,
          uMap: { value: texture },
          uStem: { value: new THREE.Color('#3f8f25') },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aRoot;
          attribute vec4 aFlower;
          ${windGLSL}
          ${cloudGLSL}
          varying float vCloud;
          varying vec2 vUv;
          varying float vPart;
          varying float vType;
          varying vec3 vWorld;
          void main() {
            float part = position.z;
            float h = aFlower.y;
            float g = gustField(aRoot.xz);
            float ph = aFlower.w * 6.2831;
            float sway = sin(uTime * (1.3 + aFlower.w) + ph + dot(aRoot.xz, uWindDir) * 0.45);
            vec2 bend = uWindDir * (0.15 + 0.12 * sway + 0.7 * g) + vec2(0.05 * sin(ph), 0.05 * cos(ph));
            vec3 tip = aRoot + vec3(bend.x * h, h * (1.0 - 0.25 * dot(bend, bend)), bend.y * h);
            vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            vec3 p;
            if (part < 0.5) {
              float t = position.y;
              vec3 along = mix(aRoot, tip, t);
              along.xz += bend * h * (t * t - t) * 0.6;
              p = along + camR * position.x * 0.008 * (1.0 + h);
              vUv = vec2(0.0, t);
            } else {
              float s = aFlower.z;
              // Heads nod with the wind.
              float nod = sway * 0.25 + g * 0.4;
              vec2 q = position.xy;
              q = vec2(q.x * cos(nod) - q.y * sin(nod), q.x * sin(nod) + q.y * cos(nod));
              p = tip + (camR * q.x + camU * q.y * 0.85) * s;
              vec2 cell = vec2(mod(aFlower.x, 2.0), 1.0 - floor(aFlower.x / 2.0));
              vUv = (position.xy * 0.5 + 0.5 + cell) * 0.5;
            }
            vPart = part;
            vCloud = cloudShade(aRoot.xz, uTime, uWindDir);
            vType = aFlower.x;
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
          varying float vType;
          varying float vCloud;
          varying vec3 vWorld;
          void main() {
            vec3 col;
            if (vPart < 0.5) {
              col = uStem * (0.5 + 0.6 * vUv.y);
            } else {
              vec4 t = texture2D(uMap, vUv);
              if (t.a < 0.5) discard;
              col = t.rgb * 1.08;
            }
            col *= (uSunColor * 0.8 + uSkyLight * 0.4) * vCloud;
            col = applyHaze(col, vWorld, 1.0);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
