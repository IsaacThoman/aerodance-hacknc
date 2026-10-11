import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { fx, lightGLSL, windGLSL } from './fx.js';
import { heightAt } from './terrain.js';

// ------------------------------------------------------------- butterflies

function makeWingAtlas() {
  // Three designs side by side; each cell is the RIGHT wing (hinge at left).
  const cw = 128;
  const ch = 128;
  const c = document.createElement('canvas');
  c.width = cw * 3;
  c.height = ch;
  const ctx = c.getContext('2d');
  const designs = [
    { base: '#2fb8ff', edge: '#0b2f6b', spot: '#dffbff', inner: '#9af0ff' },
    { base: '#ff9a1f', edge: '#3a1d0a', spot: '#ffffff', inner: '#ffd16a' },
    { base: '#ffe14d', edge: '#7a5a00', spot: '#ffffff', inner: '#fff6b8' },
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
    wing(() => {
      ctx.beginPath();
      ctx.moveTo(4, ch * 0.5);
      ctx.bezierCurveTo(cw * 0.3, ch * 0.02, cw * 0.95, ch * 0.0, cw * 0.95, ch * 0.18);
      ctx.bezierCurveTo(cw * 0.98, ch * 0.38, cw * 0.6, ch * 0.5, 4, ch * 0.54);
      ctx.closePath();
    });
    wing(() => {
      ctx.beginPath();
      ctx.moveTo(4, ch * 0.52);
      ctx.bezierCurveTo(cw * 0.55, ch * 0.5, cw * 0.8, ch * 0.72, cw * 0.62, ch * 0.92);
      ctx.bezierCurveTo(cw * 0.45, ch * 1.02, cw * 0.15, ch * 0.8, 4, ch * 0.58);
      ctx.closePath();
    });
    ctx.fillStyle = d.spot;
    for (const [x, y, r] of [[0.82, 0.14, 5], [0.7, 0.1, 4], [0.88, 0.26, 4], [0.55, 0.85, 4], [0.62, 0.76, 3]]) {
      ctx.beginPath();
      ctx.arc(ox + x * cw, y * ch, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#2b2118';
    ctx.beginPath();
    ctx.ellipse(ox + 3, ch * 0.55, 4, ch * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// [x, z, radius, design] — around the platform and flower beds.
const BUTTERFLY_SPOTS = [
  [-7.2, -1.2, 1.4, 0], [-8.5, 2.5, 1.8, 2], [-5.5, 5.5, 1.6, 1], [7.4, -1.4, 1.5, 1],
  [8.6, 3, 2, 0], [5.8, 5.8, 1.5, 2], [-3.5, -7.5, 2.4, 0], [3.8, -7.2, 2.2, 2], [0, 7.2, 2.5, 1],
];

export function Butterflies() {
  const texture = useDisposable(makeWingAtlas);
  const geometry = useDisposable(() => {
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
      home.push(x, Math.max(heightAt(x, z), 0) + rand.range(0.7, 1.5), z);
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
        uniforms: { ...fx, uMap: { value: texture } },
        vertexShader: /* glsl */ `
          attribute float aSide;
          attribute vec3 aHome;
          attribute vec4 aParams; // radius, design, phase, speed
          uniform float uTime;
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
            float glide = smoothstep(0.6, 0.9, sin(t * 0.7));
            float flap = mix(0.15 + 1.05 * abs(sin(t * 13.0)), 0.35, glide);
            float ang = aSide * flap;
            vec3 local = vec3(position.x * aSide * cos(ang), position.x * sin(flap), position.y) * 0.26;
            float cy = cos(yaw), sy = sin(yaw);
            vec3 w = vec3(local.x * cy + local.z * sy, local.y, -local.x * sy + local.z * cy);
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
            vec3 col = t.rgb * vShade * (uSunColor * 0.8 + uSkyLight * 0.5) * 1.15;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

// ------------------------------------------------------------------- birds

/** Loose flocks gliding in wide loops over the valley. flocks: [{ center, radius, count, speed, size, color }] */
export function Birds({ flocks }) {
  const geometry = useDisposable(() => {
    const pos = [0, 0, 0.14, -1, 0, -0.05, 0, 0, -0.2, 0, 0, 0.14, 1, 0, -0.05, 0, 0, -0.2];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const rand = makeRandom(55);
    const a = [];
    const b = [];
    const c = [];
    for (const f of flocks) {
      for (let i = 0; i < f.count; i++) {
        a.push(...f.center, f.radius);
        b.push(rand.range(-1, 1), rand.range(-1, 1), rand.range(0, 6.28), f.speed * rand.range(0.92, 1.08));
        c.push(f.size * rand.range(0.85, 1.15), f.color, f.spread ?? 1, 0);
      }
    }
    g.setAttribute('aFlock', new THREE.InstancedBufferAttribute(new Float32Array(a), 4));
    g.setAttribute('aBird', new THREE.InstancedBufferAttribute(new Float32Array(b), 4));
    g.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(c), 4));
    g.instanceCount = a.length / 4;
    return g;
  }, [flocks]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { ...fx },
        vertexShader: /* glsl */ `
          attribute vec4 aFlock;
          attribute vec4 aBird;
          attribute vec4 aLook;
          uniform float uTime;
          varying vec3 vWorld;
          varying float vColor;
          varying float vUnder;
          void main() {
            float t = uTime * aBird.w;
            float a = t + aBird.x * 0.3 * aLook.z;
            float R = aFlock.w;
            vec3 c = aFlock.xyz + vec3(cos(a) * R, sin(t * 1.3 + aBird.z) * R * 0.04, sin(a) * R * 0.45);
            c += vec3(aBird.x, aBird.y * 0.5, aBird.y) * R * 0.12 * aLook.z;
            vec3 vel = normalize(vec3(-sin(a), 0.0, cos(a) * 0.45));
            float yaw = atan(vel.x, vel.z);
            float flap = sin(uTime * 7.5 * (0.8 + aBird.w * 0.2) + aBird.z * 5.0) * 0.6;
            float glide = smoothstep(0.2, 0.7, sin(uTime * 0.45 + aBird.z));
            flap = mix(flap, 0.12, glide);
            vec3 l = position;
            // Gull-wing dihedral so the silhouette reads from any angle.
            l.y += abs(l.x) * (0.45 + flap) - abs(l.x) * abs(l.x) * 0.3;
            l *= aLook.x;
            // Bank into the turn.
            float bank = 0.35;
            l = vec3(l.x * cos(bank) - l.y * sin(bank), l.x * sin(bank) + l.y * cos(bank), l.z);
            float cy = cos(yaw), sy = sin(yaw);
            vec3 w = vec3(l.x * cy + l.z * sy, l.y, -l.x * sy + l.z * cy);
            vWorld = c + w;
            vColor = aLook.y;
            vUnder = flap;
            gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          ${lightGLSL}
          varying vec3 vWorld;
          varying float vColor;
          varying float vUnder;
          void main() {
            vec3 white = vec3(0.95, 0.97, 1.0) * (uSunColor * 0.9 + uSkyLight * 0.5) * (0.85 + 0.2 * vUnder);
            vec3 dark = vec3(0.08, 0.12, 0.2);
            vec3 col = mix(dark, white, vColor);
            col = applyHaze(col, vWorld, 0.8);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

// ------------------------------------------------- dandelion seeds + pollen

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

const FOCAL = 480 * 0.5 / Math.tan(THREE.MathUtils.degToRad(25));

/** Dandelion seeds drifting downwind and twinkling pollen motes. */
export function Floaters({ seeds = 90, motes = 140 }) {
  const texture = useDisposable(makeSeedTexture);
  const geometry = useDisposable(() => {
    const rand = makeRandom(31);
    const count = seeds + motes;
    const pos = new Float32Array(count * 3);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos.set([rand.next(), rand.next(), rand.next()], i * 3);
      data.set([rand.next(), rand.range(0.7, 1.3), rand.range(0, 6.28), i < seeds ? 0 : 1], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(data, 4));
    return g;
  }, [seeds, motes]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          ...fx,
          uMap: { value: texture },
          uBoxMin: { value: new THREE.Vector3(-22, 0.2, -26) },
          uBoxSize: { value: new THREE.Vector3(44, 9, 36) },
          uScale: { value: FOCAL },
        },
        vertexShader: /* glsl */ `
          attribute vec4 aSeed;
          uniform vec3 uBoxMin;
          uniform vec3 uBoxSize;
          uniform float uScale;
          ${windGLSL}
          varying float vAlpha;
          varying float vRot;
          varying float vKind;
          varying float vTw;
          void main() {
            vec3 p = position * uBoxSize;
            float t = uTime * (0.8 + aSeed.y * 0.4);
            p.xz += uWindDir * t * 1.3 * aSeed.y;
            p.x += sin(t * 0.6 + aSeed.z) * 1.5;
            p.z += cos(t * 0.45 + aSeed.z) * 1.2;
            p.y += sin(t * 0.8 + aSeed.z * 2.0) * 0.8 + t * 0.06;
            vec3 wrapped = mod(p, uBoxSize);
            vec3 world = uBoxMin + wrapped;
            world.xz += uWindDir * gustField(world.xz) * 1.2;
            vec4 mv = viewMatrix * vec4(world, 1.0);
            float dist = -mv.z;
            float size = aSeed.w > 0.5 ? 0.09 : 0.3;
            gl_PointSize = clamp(size * uScale / max(dist, 0.1), 1.5, 30.0);
            vec3 e = min(wrapped, uBoxSize - wrapped) / uBoxSize;
            vAlpha = smoothstep(0.0, 0.08, min(e.x, min(e.y, e.z))) * smoothstep(1.5, 3.5, dist);
            vRot = sin(t * 0.9 + aSeed.z) * 0.6;
            vKind = aSeed.w;
            vTw = 0.5 + 0.5 * sin(uTime * (2.0 + aSeed.y * 3.0) + aSeed.z * 7.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uSunColor;
          varying float vAlpha;
          varying float vRot;
          varying float vKind;
          varying float vTw;
          void main() {
            vec2 uv = gl_PointCoord - 0.5;
            // The 640x480 buffer is shown at 16:9, so pre-squeeze sprites horizontally.
            uv.x *= 1.333;
            if (vKind > 0.5) {
              float r = length(uv) * 2.0;
              float a = smoothstep(1.0, 0.0, r) * vAlpha * (0.35 + 0.65 * vTw);
              if (a < 0.02) discard;
              // Warm golden pollen glints, bright enough to bloom at their peak.
              vec3 col = vec3(1.0, 0.92, 0.6) * (1.2 + 2.2 * vTw * vTw);
              gl_FragColor = vec4(col, a);
              return;
            }
            float c = cos(vRot), s = sin(vRot);
            uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) + 0.5;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
            vec4 t = texture2D(uMap, vec2(uv.x, 1.0 - uv.y));
            float a = t.a * vAlpha;
            if (a < 0.02) discard;
            gl_FragColor = vec4(t.rgb * (uSunColor * 1.1 + 0.2), a);
          }
        `,
      }),
  );
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={6} />;
}
