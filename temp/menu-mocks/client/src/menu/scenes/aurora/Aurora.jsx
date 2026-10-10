import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { noise } from '../../shared/glsl.js';
import { CAMERA, env } from './state.js';

// Aurora curtains: tall vertical ribbons hanging from a ground track that is
// art-directed as a spline (azimuth / elevation of the lower hem as seen from
// the camera). In the shader the track undulates and rolls into folds over
// time; folds seen edge-on glow brighter, fine rays run vertically, the hem
// is a sharp green edge and the top fades to violet. Additive HDR -> bloom.

const vertexShader = /* glsl */ `
  attribute vec2 aBase;
  attribute vec2 aTan;
  attribute float aAlong;
  attribute float aRay;
  uniform float uTime;
  uniform float uY, uH, uAmp, uWave, uFold, uFoldLen, uSpeed, uSeed, uLean;
  varying vec2 vC;
  varying float vAlong;
  varying float vEdgeOn;
  void main() {
    float s = uv.x;
    float v = uv.y;
    float t = uTime * uSpeed;
    float l = aAlong;
    vec2 T = aTan;
    vec2 N = vec2(-T.y, T.x);

    // Slow lateral undulation travelling along the curtain.
    float k1 = 6.2831 / uWave;
    float k2 = k1 * 2.3;
    float w = uAmp * (0.7 * sin(l * k1 + t * 0.06 + uSeed) + 0.3 * sin(l * k2 - t * 0.09 + uSeed * 2.0));
    float dw = uAmp * (0.7 * k1 * cos(l * k1 + t * 0.06 + uSeed) + 0.3 * k2 * cos(l * k2 - t * 0.09 + uSeed * 2.0));

    // Rolling folds (trochoid) that make the sheet double back.
    float kf = 6.2831 / uFoldLen;
    float ph = l * kf - t * 0.1 + uSeed * 3.0;
    float fa = uFold * (0.5 + 0.5 * sin(l * 0.0006 + t * 0.04 + uSeed));
    vec2 p = aBase + N * (w + fa * cos(ph)) + T * (fa * sin(ph));
    vec2 tang = T * (1.0 + fa * kf * cos(ph)) + N * (dw - fa * kf * sin(ph));
    vec2 Nn = normalize(vec2(-tang.y, tang.x));

    float hem = (sin(l * 0.004 + t * 0.21 + uSeed) * 0.012 + sin(l * 0.0013 - t * 0.13 + uSeed * 1.7) * 0.025) * uH;
    float height = uH * (0.72 + 0.28 * sin(l * 0.0009 + t * 0.07 + uSeed * 0.5));
    vec3 pos = vec3(p.x, uY + hem + v * height, p.y);
    pos.xz += Nn * (v * v) * uLean * (0.6 + 0.4 * sin(l * 0.001 + t * 0.1));

    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vec2 vh = normalize(cameraPosition.xz - wp.xz);
    vEdgeOn = 1.0 - abs(dot(Nn, vh));
    vC = vec2(s, v);
    vAlong = aRay;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime, uSpeed, uSeed, uIntensity, uRayScale, uSurge, uSurgePos, uBoost;
  uniform vec3 uAurora0, uAurora1, uAurora2;
  varying vec2 vC;
  varying float vAlong;
  varying float vEdgeOn;
  ${noise}

  void main() {
    float s = vC.x;
    float v = vC.y;
    float t = uTime * uSpeed;
    float a = vAlong * uRayScale;

    // Vertical rays: noise along the curtain, nearly constant with height.
    float fw = fwidth(a);
    float r1 = snoise(vec2(a * 0.035 + t * 0.03, t * 0.05 + uSeed + v * 0.25));
    float r2 = snoise(vec2(a * 0.11 - t * 0.07, t * 0.09 + uSeed * 1.3 + v * 0.5));
    float r2w = clamp(1.6 - fw * 0.4, 0.0, 1.0);
    float rays = clamp(0.5 + 0.4 * r1 + 0.28 * r2 * r2w, 0.0, 1.2);
    rays *= rays * 1.15;

    // Patches of activity drift along the curtain.
    float patchy = snoise(vec2(a * 0.005 - t * 0.04, uSeed * 2.0 + t * 0.02));
    patchy = 0.12 + 0.88 * smoothstep(-0.5, 0.55, patchy);
    float pulse = 0.82 + 0.18 * sin(a * 0.01 - uTime * 0.6 + uSeed);

    // Each ray reaches its own height.
    float top = 0.5 + 0.5 * (0.5 + 0.5 * snoise(vec2(a * 0.02 + t * 0.02, uSeed + 7.0)));

    float hemEdge = smoothstep(0.0, 0.03, v);
    float lowBand = hemEdge * exp(-v * 6.0);
    float body = hemEdge * exp(-v * 2.8) * smoothstep(top, top - 0.5, v);
    float fringe = smoothstep(0.16, 0.5, v) * smoothstep(1.0, 0.6, v) * smoothstep(top + 0.25, top - 0.15, v);

    vec3 col = uAurora0 * lowBand * 1.5
             + mix(uAurora0, uAurora1, smoothstep(0.02, 0.24, v)) * body * 0.9
             + uAurora2 * fringe * 0.95;
    // Faint magenta hem on the very lower border.
    col += vec3(0.9, 0.25, 0.65) * smoothstep(0.0, 0.01, v) * smoothstep(0.035, 0.01, v) * 0.3;

    float structure = mix(1.0, rays, mix(0.7, 1.0, smoothstep(0.0, 0.2, v)));

    // Edge-on folds glow brighter.
    float eo = clamp(vEdgeOn, 0.0, 1.0);
    float fold = 0.5 + 1.7 * eo * eo * eo;

    float ends = smoothstep(0.0, 0.08, s) * smoothstep(1.0, 0.92, s);
    float sd = (s - uSurgePos) * 5.0;
    float surge = 1.0 + uSurge * (1.2 * exp(-sd * sd) + 0.12);

    float k = structure * patchy * pulse * fold * ends * surge * uIntensity * (1.0 + uBoost * 0.2);
    gl_FragColor = vec4(col * k, 1.0);
  }
`;

// Each curtain: hem track as [azimuth deg (+ = right), elevation deg] seen from the camera.
const CURTAINS = [
  {
    // Hero curtain: pours from high on the upper left, sweeps down across the
    // center and recedes to the right-hand horizon.
    track: [[-78, 40], [-52, 30], [-30, 21], [-12, 14.5], [6, 11], [24, 9.2], [46, 8.4], [75, 9]],
    y: 470, h: 1150, amp: 140, wave: 2600, fold: 190, foldLen: 1500, speed: 1, seed: 1.9, lean: 260, intensity: 0.8, rayScale: 1, segs: 520,
  },
  {
    // Second, more distant curtain hanging low along the horizon (teal/violet).
    track: [[-85, 7.5], [-50, 9.5], [-20, 8], [10, 9.6], [40, 7.6], [85, 9]],
    y: 480, h: 950, amp: 260, wave: 3400, fold: 300, foldLen: 2400, speed: 0.75, seed: 4.7, lean: 300, intensity: 0.36, rayScale: 1.1, segs: 380,
  },
  {
    // Faint far band just above the peaks.
    track: [[-90, 5.2], [-30, 6], [30, 5.4], [90, 6]],
    y: 380, h: 1200, amp: 300, wave: 4000, fold: 320, foldLen: 2600, speed: 0.6, seed: 12.4, lean: 300, intensity: 0.3, rayScale: 1.2, segs: 260,
  },
];

function buildCurtainGeometry(cfg) {
  const cam = new THREE.Vector2(CAMERA.position[0], CAMERA.position[2]);
  const camY = CAMERA.position[1];
  const pts = cfg.track.map(([az, el]) => {
    const d = (cfg.y - camY) / Math.tan(THREE.MathUtils.degToRad(el));
    const a = THREE.MathUtils.degToRad(az);
    return new THREE.Vector3(cam.x + Math.sin(a) * d, 0, cam.y - Math.cos(a) * d);
  });
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const n = cfg.segs;
  const rows = 10;
  const plane = new THREE.PlaneGeometry(1, 1, n, rows);
  const count = plane.attributes.position.count;
  const base = new Float32Array(count * 2);
  const tan = new Float32Array(count * 2);
  const along = new Float32Array(count);
  const samples = curve.getSpacedPoints(n);
  const lengths = [0];
  for (let i = 1; i <= n; i++) lengths.push(lengths[i - 1] + samples[i].distanceTo(samples[i - 1]));
  // Angular length along the hem as seen from the camera, so rays keep an even
  // on-screen density whether the curtain is overhead or on the horizon.
  const camPos = new THREE.Vector3(CAMERA.position[0], CAMERA.position[1], CAMERA.position[2]);
  const dirs = samples.map((p) => new THREE.Vector3(p.x, cfg.y, p.z).sub(camPos).normalize());
  const angles = [0];
  for (let i = 1; i <= n; i++) angles.push(angles[i - 1] + dirs[i].angleTo(dirs[i - 1]));
  const ray = new Float32Array(count);
  const uv = plane.attributes.uv;
  for (let k = 0; k < count; k++) {
    const i = Math.round(uv.getX(k) * n);
    const p = samples[i];
    const q = samples[Math.min(i + 1, n)];
    const r = samples[Math.max(i - 1, 0)];
    const tx = q.x - r.x;
    const tz = q.z - r.z;
    const len = Math.hypot(tx, tz) || 1;
    base[k * 2] = p.x;
    base[k * 2 + 1] = p.z;
    tan[k * 2] = tx / len;
    tan[k * 2 + 1] = tz / len;
    along[k] = lengths[i];
    ray[k] = angles[i] * 800;
  }
  plane.setAttribute('aBase', new THREE.BufferAttribute(base, 2));
  plane.setAttribute('aTan', new THREE.BufferAttribute(tan, 2));
  plane.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  plane.setAttribute('aRay', new THREE.BufferAttribute(ray, 1));
  plane.deleteAttribute('normal');
  return plane;
}

function Curtain({ cfg }) {
  const geometry = useDisposable(() => buildCurtainGeometry(cfg), [cfg]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: env.uTime,
          uAurora0: env.uAurora0,
          uAurora1: env.uAurora1,
          uAurora2: env.uAurora2,
          uSurge: env.uSurge,
          uSurgePos: env.uSurgePos,
          uBoost: env.uBoost,
          uY: { value: cfg.y },
          uH: { value: cfg.h },
          uAmp: { value: cfg.amp },
          uWave: { value: cfg.wave },
          uFold: { value: cfg.fold },
          uFoldLen: { value: cfg.foldLen },
          uSpeed: { value: cfg.speed },
          uSeed: { value: cfg.seed },
          uLean: { value: cfg.lean },
          uIntensity: { value: cfg.intensity },
          uRayScale: { value: cfg.rayScale },
        },
        vertexShader,
        fragmentShader,
      }),
    [cfg],
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-600} />;
}

export function Aurora() {
  return (
    <group>
      {CURTAINS.map((cfg, i) => (
        <Curtain key={i} cfg={cfg} />
      ))}
    </group>
  );
}
