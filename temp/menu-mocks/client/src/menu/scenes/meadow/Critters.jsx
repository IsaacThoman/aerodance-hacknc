import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { lightGLSL, lightUniforms, windGLSL, windUniforms } from './fx.js';
import { CAM_XZ, heightAt } from './terrain.js';

// ------------------------------------------------------------- butterflies

function makeWingAtlas() {
  // Three wing designs side by side; each cell is the RIGHT wing (hinge at left).
  const cw = 128;
  const ch = 128;
  const c = document.createElement('canvas');
  c.width = cw * 3;
  c.height = ch;
  const ctx = c.getContext('2d');
  const designs = [
    { base: '#ff9a1f', edge: '#3a1d0a', spot: '#ffffff', inner: '#ffd16a' }, // monarch
    { base: '#2fa8ff', edge: '#0b2f6b', spot: '#bff3ff', inner: '#8fe3ff' }, // morpho
    { base: '#ffe14d', edge: '#7a5a00', spot: '#ffffff', inner: '#fff6b8' }, // brimstone
  ];
  designs.forEach((d, i) => {
    const ox = i * cw;
    const wing = (path) => {
      ctx.save();
      ctx.translate(ox, 0);
      path();
      const g = ctx.createRadialGradient(4, ch / 2, 4, 4, ch / 2, cw);
      g.addColorStop(0, d.inner);
      g.addColorStop(0.45, d.base);
      g.addColorStop(0.85, d.base);
      g.addColorStop(1, d.edge);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = d.edge;
      ctx.stroke();
      ctx.restore();
    };
    // Fore wing.
    wing(() => {
      ctx.beginPath();
      ctx.moveTo(4, ch * 0.5);
      ctx.bezierCurveTo(cw * 0.3, ch * 0.02, cw * 0.95, ch * 0.0, cw * 0.95, ch * 0.18);
      ctx.bezierCurveTo(cw * 0.98, ch * 0.38, cw * 0.6, ch * 0.5, 4, ch * 0.54);
      ctx.closePath();
    });
    // Hind wing.
    wing(() => {
      ctx.beginPath();
      ctx.moveTo(4, ch * 0.52);
      ctx.bezierCurveTo(cw * 0.55, ch * 0.5, cw * 0.8, ch * 0.72, cw * 0.62, ch * 0.92);
      ctx.bezierCurveTo(cw * 0.45, ch * 1.02, cw * 0.15, ch * 0.8, 4, ch * 0.58);
      ctx.closePath();
    });
    // Spots along the edge.
    ctx.fillStyle = d.spot;
    for (const [x, y, r] of [[0.82, 0.14, 4], [0.7, 0.1, 3], [0.88, 0.26, 3], [0.55, 0.85, 3], [0.62, 0.76, 2.5]]) {
      ctx.beginPath();
      ctx.arc(ox + x * cw, y * ch, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Body half.
    ctx.fillStyle = '#2b2118';
    ctx.beginPath();
    ctx.ellipse(ox + 3, ch * 0.55, 4, ch * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const BUTTERFLY_SPOTS = [
  // [x, z, radius, type] — mostly in the visible side margins.
  [-4.6, 7.5, 1.4, 0], [-7, 3, 2.0, 1], [-10, -3, 2.5, 2], [-15, -12, 3, 0],
  [4.8, 7.5, 1.5, 2], [7.5, 3, 2.2, 0], [11, -4, 3, 1], [2.5, 1, 3, 1], [-2.5, 2, 2.5, 2],
];

export function Butterflies() {
  const texture = useDisposable(makeWingAtlas);
  const geometry = useDisposable(() => {
    // Two wing quads; x in [0,1] outward, sign in aSide.
    const pos = [];
    const uv = [];
    const side = [];
    for (const s of [-1, 1]) {
      pos.push(0, -0.5, 0, 1, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0);
      uv.push(0, 0, 1, 0, 0, 1, 1, 1);
      side.push(s, s, s, s);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setIndex([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6]);
    const rand = makeRandom(8);
    const home = [];
    const params = [];
    for (const [x, z, r, type] of BUTTERFLY_SPOTS) {
      home.push(x, heightAt(x, z) + rand.range(0.6, 1.3), z);
      params.push(r, type, rand.range(0, 100), rand.range(0.8, 1.2));
    }
    g.setAttribute('aHome', new THREE.InstancedBufferAttribute(new Float32Array(home), 3));
    g.setAttribute('aParams', new THREE.InstancedBufferAttribute(new Float32Array(params), 4));
    g.instanceCount = BUTTERFLY_SPOTS.length;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        uniforms: { ...windUniforms, ...lightUniforms, uMap: { value: texture } },
        vertexShader: /* glsl */ `
          attribute float aSide;
          attribute vec3 aHome;
          attribute vec4 aParams; // radius, type, phase, speed
          uniform float uTime;
          uniform vec2 uWindDir;
          varying vec2 vUv;
          varying float vShade;
          varying vec3 vWorld;
          vec3 path(float t) {
            float r = aParams.x;
            return aHome + vec3(
              sin(t * 0.47) * r + sin(t * 1.13) * 0.35 * r,
              sin(t * 0.9) * 0.35 + sin(t * 2.3) * 0.12,
              cos(t * 0.39) * r * 0.6 + cos(t * 1.31) * 0.25 * r
            );
          }
          void main() {
            float t = uTime * aParams.w + aParams.z;
            vec3 p = path(t);
            vec3 v = normalize(path(t + 0.05) - p + vec3(1e-4, 0.0, 0.0));
            float yaw = atan(v.x, v.z);
            // Wing flap: fast beats with occasional glides.
            float glide = smoothstep(0.6, 0.9, sin(t * 0.7));
            float flap = mix(0.15 + 1.05 * abs(sin(t * 13.0)), 0.35, glide);
            float ang = aSide * flap;
            vec3 local = vec3(position.x * aSide * cos(ang), position.x * sin(flap), position.y);
            local *= 0.22;
            // Orient: local z (body axis) along the heading.
            float cy = cos(yaw), sy = sin(yaw);
            vec3 w = vec3(local.x * cy + local.z * sy, local.y, -local.x * sy + local.z * cy);
            // Slight pitch up.
            w.y += local.z * 0.35;
            vec3 world = p + w;
            vUv = vec2((position.x + aParams.y) / 3.0, position.y + 0.5);
            vShade = 0.75 + 0.25 * cos(ang);
            vWorld = world;
            gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          ${lightGLSL}
          varying vec2 vUv;
          varying float vShade;
          varying vec3 vWorld;
          void main() {
            vec4 t = texture2D(uMap, vUv);
            if (t.a < 0.4) discard;
            vec3 col = t.rgb * vShade * (uSunColor * 0.75 + uSkyLight * 0.45) * 1.1;
            col = applyHaze(col, vWorld, 1.0);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

// ------------------------------------------------------------------- birds

export function Birds({ center = [-6, 19, -62], count = 7 }) {
  const geometry = useDisposable(() => {
    // Each bird: two wing triangles + tiny body. x outward, aPart: 0 body/root, 1 tip.
    const pos = [
      // left wing
      0, 0, 0.12, -1, 0, 0, 0, 0, -0.18,
      // right wing
      0, 0, 0.12, 1, 0, 0, 0, 0, -0.18,
    ];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const rand = makeRandom(55);
    const p = [];
    for (let i = 0; i < count; i++) p.push(rand.range(-1, 1), rand.range(-1, 1), rand.range(0, 6.28), rand.range(0.9, 1.1));
    g.setAttribute('aBird', new THREE.InstancedBufferAttribute(new Float32Array(p), 4));
    g.instanceCount = count;
    return g;
  }, [count]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { ...windUniforms, ...lightUniforms, uCenter: { value: new THREE.Vector3(...center) } },
        vertexShader: /* glsl */ `
          attribute vec4 aBird;
          uniform float uTime;
          uniform vec3 uCenter;
          varying vec3 vWorld;
          void main() {
            float t = uTime * 0.16 * aBird.w;
            // Loose flock circling the valley.
            float a = t + aBird.x * 0.35;
            vec3 c = uCenter + vec3(cos(a) * 28.0, sin(t * 1.7 + aBird.z) * 1.5, sin(a) * 12.0);
            c += vec3(aBird.x * 4.0, aBird.y * 2.0, aBird.y * 3.0);
            vec3 vel = normalize(vec3(-sin(a) * 28.0, 0.0, cos(a) * 12.0));
            float yaw = atan(vel.x, vel.z);
            float flap = sin(uTime * 7.0 * aBird.w + aBird.z) * 0.55;
            float glide = smoothstep(0.3, 0.8, sin(uTime * 0.5 + aBird.z));
            flap *= 1.0 - glide * 0.8;
            vec3 l = position;
            l.y += abs(l.x) * flap;
            l *= 0.85;
            float cy = cos(yaw), sy = sin(yaw);
            vec3 w = vec3(l.x * cy + l.z * sy, l.y, -l.x * sy + l.z * cy);
            vWorld = c + w;
            gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          ${lightGLSL}
          varying vec3 vWorld;
          void main() {
            vec3 col = vec3(0.12, 0.2, 0.32);
            col = applyHaze(col, vWorld, 1.6);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [...center],
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

// --------------------------------------------------------- dandelion seeds

function makeSeedTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const cx = s / 2;
  const cy = s * 0.42;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1.6;
  // Pappus: a little umbrella of fine filaments.
  for (let i = 0; i < 13; i++) {
    const a = Math.PI + (i / 12) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * 22, cy + Math.sin(a) * 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 22, cy + Math.sin(a) * 16, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
  }
  const g = ctx.createRadialGradient(cx, cy - 6, 0, cx, cy - 6, 20);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // Stalk + seed.
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy + 16);
  ctx.stroke();
  ctx.fillStyle = '#c9a46a';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 20, 2.2, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function DandelionSeeds({ count = 120 }) {
  const texture = useDisposable(makeSeedTexture);
  const geometry = useDisposable(() => {
    const rand = makeRandom(31);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos.set([rand.next(), rand.next(), rand.next()], i * 3);
      seed.set([rand.next(), rand.range(0.7, 1.3), rand.range(0, 6.28), rand.next()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    return g;
  }, [count]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          ...windUniforms,
          ...lightUniforms,
          uMap: { value: texture },
          uBoxMin: { value: new THREE.Vector3(CAM_XZ[0] - 26, 1.6, CAM_XZ[1] - 46) },
          uBoxSize: { value: new THREE.Vector3(52, 7.5, 50) },
          uScale: { value: 480 * 0.5 / Math.tan(THREE.MathUtils.degToRad(22.5)) },
        },
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          uniform vec3 uBoxMin;
          uniform vec3 uBoxSize;
          uniform float uScale;
          ${windGLSL}
          varying float vAlpha;
          varying float vRot;
          varying vec3 vWorld;
          void main() {
            vec3 p = position * uBoxSize;
            float t = uTime * (0.8 + aSeed.y * 0.4);
            // Drift downwind, with lazy loops and lift.
            vec2 drift = uWindDir * t * 1.6 * aSeed.y;
            p.xz += drift;
            p.x += sin(t * 0.6 + aSeed.z) * 1.5;
            p.z += cos(t * 0.45 + aSeed.z) * 1.2;
            p.y += sin(t * 0.8 + aSeed.z * 2.0) * 0.8 + t * 0.05;
            vec3 wrapped = mod(p, uBoxSize);
            vec3 world = uBoxMin + wrapped;
            float g = gustField(world.xz);
            world.xz += uWindDir * g * 1.2;
            vec4 mv = viewMatrix * vec4(world, 1.0);
            float dist = -mv.z;
            gl_PointSize = clamp(0.28 * uScale / max(dist, 0.1), 2.0, 34.0);
            // Fade at the box seams and very close to the lens.
            vec3 e = min(wrapped, uBoxSize - wrapped) / uBoxSize;
            vAlpha = smoothstep(0.0, 0.08, min(e.x, e.z)) * smoothstep(1.2, 3.0, dist) * smoothstep(30.0, 16.0, dist) * (0.75 + 0.25 * sin(uTime * 3.0 + aSeed.z * 5.0));
            vRot = sin(t * 0.9 + aSeed.z) * 0.6;
            vWorld = world;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          ${lightGLSL}
          varying float vAlpha;
          varying float vRot;
          varying vec3 vWorld;
          void main() {
            vec2 uv = gl_PointCoord - 0.5;
            float c = cos(vRot), s = sin(vRot);
            uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
            // The 640x480 buffer is shown at 16:9, so pre-squeeze sprites horizontally.
            uv.x *= 1.333;
            uv += 0.5;
            if (uv.x < 0.0 || uv.x > 1.0) discard;
            vec4 t = texture2D(uMap, vec2(uv.x, 1.0 - uv.y));
            float a = t.a * vAlpha;
            if (a < 0.02) discard;
            vec3 col = t.rgb * (uSunColor * 1.05 + 0.15);
            col = applyHaze(col, vWorld, 1.0);
            gl_FragColor = vec4(col, a);
          }
        `,
      }),
  );
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />;
}

// ------------------------------------------------------------- lens flare

const FLARE = [
  // k (0 sun -> 1 centre -> 2 mirror), size, shape(0 disc 1 ring 2 hex 3 rainbow 4 streak), r,g,b, alpha
  [0.0, 0.62, 4, 1.0, 0.9, 0.7, 0.35],
  [0.0, 0.2, 0, 1.0, 0.95, 0.8, 0.45],
  [0.22, 0.045, 2, 0.6, 1.0, 0.8, 0.4],
  [0.4, 0.08, 0, 0.5, 0.9, 1.0, 0.2],
  [0.58, 0.03, 2, 1.0, 0.8, 0.5, 0.45],
  [0.75, 0.11, 1, 0.6, 1.0, 0.8, 0.12],
  [0.92, 0.05, 2, 0.7, 0.75, 1.0, 0.3],
  [1.3, 0.04, 2, 1.0, 0.7, 0.9, 0.18],
];

export function LensFlare({ sun }) {
  const geometry = useDisposable(() => {
    const plane = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    g.setAttribute('aEl', new THREE.InstancedBufferAttribute(new Float32Array(FLARE.flatMap((f) => [f[0], f[1], f[2], f[6]])), 4));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(FLARE.flatMap((f) => [f[3], f[4], f[5]])), 3));
    g.instanceCount = FLARE.length;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uSun: { value: new THREE.Vector2() }, uStrength: { value: 0 }, uAspect: { value: 16 / 9 } },
        vertexShader: /* glsl */ `
          attribute vec4 aEl;
          attribute vec3 aCol;
          uniform vec2 uSun;
          uniform float uAspect;
          varying vec2 vUv;
          varying vec3 vCol;
          varying float vShape;
          varying float vAlpha;
          void main() {
            vec2 c = uSun * (1.0 - aEl.x);
            vec2 size = vec2(aEl.y / uAspect, aEl.y);
            if (aEl.z > 3.5) size = vec2(aEl.y * 1.6 / uAspect, aEl.y * 0.06);
            vUv = position.xy;
            vCol = aCol;
            vShape = aEl.z;
            vAlpha = aEl.w;
            gl_Position = vec4(c + position.xy * size, 0.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uStrength;
          varying vec2 vUv;
          varying vec3 vCol;
          varying float vShape;
          varying float vAlpha;
          void main() {
            float r = length(vUv);
            float a;
            vec3 col = vCol;
            if (vShape < 0.5) a = smoothstep(1.0, 0.0, r) * smoothstep(1.0, 0.75, r);
            else if (vShape < 1.5) a = exp(-pow((r - 0.82) / 0.07, 2.0)) + 0.15 * smoothstep(0.85, 0.0, r);
            else if (vShape < 2.5) {
              vec2 q = abs(vUv);
              float hex = max(q.x * 0.866 + q.y * 0.5, q.y);
              a = smoothstep(0.92, 0.82, hex) * (0.55 + 0.45 * hex);
            } else if (vShape < 3.5) {
              float ring = exp(-pow((r - 0.85) / 0.06, 2.0));
              col = 0.6 + 0.4 * cos(6.2831 * (r * 2.5 + vec3(0.0, 0.33, 0.67)));
              a = ring * 0.8;
            } else {
              a = exp(-vUv.x * vUv.x * 2.5) * exp(-vUv.y * vUv.y * 3.0);
            }
            a *= vAlpha * uStrength;
            gl_FragColor = vec4(col * a, 1.0);
          }
        `,
      }),
  );
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const cam = state.camera;
    v.set(sun[0], sun[1], sun[2]).multiplyScalar(1000).add(cam.position).project(cam);
    const u = material.uniforms;
    u.uSun.value.set(v.x, v.y);
    const onScreen = v.z < 1 ? 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(v.x), Math.abs(v.y)), 0.9, 1.25) : 0;
    u.uStrength.value = onScreen * (0.92 + 0.08 * Math.sin(state.clock.elapsedTime * 0.7));
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={999} />;
}
