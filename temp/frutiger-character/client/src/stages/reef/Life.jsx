import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { causticsGLSL, makeLitMaterial, waterGLSL } from './shaders.js';
import { dolphinGeometry, fishGeometry, jellyGeometry, mantaGeometry, tentacleLines, turtleGeometry } from './creatureGeometry.js';

// ---------------------------------------------------------------------------
// Fish schools: path, tail beat and orientation are computed on the GPU from
// per-instance seeds, so a whole school costs one draw.
//   mode 0: groups streaming around an elliptical loop (uCenter, uRadius.xz)
//   mode 1: a milling ball / orbit around uCenter
// ---------------------------------------------------------------------------

const fishVertex = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uRadius;
uniform float uSpeed;
uniform float uMode;
uniform float uWiggle;
uniform float uSize;
attribute float aU;
attribute float aFin;
attribute vec4 aSeed;
attribute vec3 aOffset;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying float vU;
varying float vFin;
varying float vSeed;

vec3 pathPos(float t) {
  vec3 p;
  if (uMode < 0.5) {
    float s = aSeed.x * 6.2831853 + t * uSpeed * (1.0 + (aSeed.w - 0.5) * 0.06);
    p = uCenter + vec3(cos(s) * uRadius.x, sin(s * 2.0 + aSeed.z * 2.0) * uRadius.y, sin(s) * uRadius.z);
    vec2 tang = normalize(vec2(-sin(s) * uRadius.x, cos(s) * uRadius.z)) * sign(uSpeed);
    vec2 nrm = vec2(-tang.y, tang.x);
    vec3 off = aOffset * (1.0 + 0.2 * sin(t * 0.7 + aSeed.x * 31.0));
    off.y += 0.12 * sin(t * 1.1 + aSeed.y * 17.0);
    p += vec3(nrm.x * off.x + tang.x * off.z, off.y, nrm.y * off.x + tang.y * off.z);
  } else {
    float a = aSeed.x * 6.2831853 + t * uSpeed * (0.8 + 0.4 * aSeed.w);
    float r = uRadius.x * (0.3 + 0.7 * aSeed.y) * (1.0 + 0.14 * sin(t * 0.5 + aSeed.x * 23.0));
    vec3 c = uCenter + vec3(sin(t * 0.13) * uRadius.z, sin(t * 0.21) * 0.35, cos(t * 0.11) * uRadius.z * 0.7);
    p = c + vec3(cos(a) * r, (aSeed.z - 0.5) * uRadius.y + 0.3 * sin(a * 2.0 + aSeed.x * 10.0), sin(a) * r);
  }
  return p;
}

void main() {
  float t = uTime;
  vec3 p0 = pathPos(t);
  vec3 p1 = pathPos(t + 0.06);
  vec3 fwd = p1 - p0;
  float spd = length(fwd);
  fwd = spd > 1e-5 ? fwd / spd : vec3(1.0, 0.0, 0.0);
  fwd.y = clamp(fwd.y, -0.45, 0.45);
  fwd = normalize(fwd);
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, side);
  float sz = uSize * (0.82 + 0.36 * aSeed.y);
  vec3 lp = position;
  float tail = smoothstep(0.25, 1.0, aU);
  float freq = uWiggle * (0.85 + 0.3 * aSeed.w) * (1.0 + min(spd * 6.0, 1.5));
  float ph = t * freq + aSeed.x * 40.0;
  lp.x += sin(ph - aU * 5.0) * tail * tail * 0.17 + sin(ph) * (1.0 - tail) * 0.02;
  vLocal = position;
  vU = aU;
  vFin = aFin;
  vSeed = aSeed.y;
  vec3 wp = p0 + (side * lp.x + up * lp.y + fwd * lp.z) * sz;
  vN = normalize(side * normal.x + up * normal.y + fwd * normal.z);
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const fishFragment = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform vec3 uBody;
uniform vec3 uBelly;
uniform vec3 uFin;
uniform vec3 uTailFin;
uniform vec3 uStripe;
uniform vec4 uPattern;
uniform vec3 uEye;
uniform float uHalfH;
uniform float uIrid;
uniform float uGloss;
uniform vec3 uUnderSun;
uniform vec3 uUnderSunColor;
uniform vec3 uUnderSky;
uniform vec3 uUnderGround;
${waterGLSL}
${causticsGLSL}
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying float vU;
varying float vFin;
varying float vSeed;

void main() {
  vec3 n = normalize(vN);
  n *= gl_FrontFacing ? 1.0 : -1.0;
  vec3 v = normalize(cameraPosition - vWorld);
  float yN = vLocal.y / uHalfH;
  float u = vU;
  vec3 base = mix(uBelly, uBody, smoothstep(-0.55, 0.4, yN));
  float mode = uPattern.w;
  if (mode > 0.5 && mode < 1.5) {
    // Vertical bands.
    float b = fract(u * uPattern.x + uPattern.z);
    float band = smoothstep(uPattern.y + 0.05, uPattern.y, b) * step(u, 0.78);
    base = mix(base, uStripe, band);
  } else if (mode > 1.5 && mode < 2.5) {
    // Swoosh stripe (regal tang palette).
    float c = uPattern.z + 0.35 * sin(u * 6.0 + 0.6);
    float sl = smoothstep(uPattern.y, uPattern.y * 0.5, abs(yN - c)) * smoothstep(0.08, 0.2, u) * step(u, 0.78);
    base = mix(base, uStripe, sl);
  } else if (mode > 2.5 && mode < 3.5) {
    // Clownfish: three white bands with dark edges.
    float w = 0.0;
    float e = 0.0;
    for (int i = 0; i < 3; i++) {
      float c = 0.2 + float(i) * 0.29;
      float d = abs(u - c);
      w += smoothstep(0.055, 0.04, d);
      e += smoothstep(0.075, 0.06, d);
    }
    base = mix(base, vec3(0.03, 0.02, 0.02), clamp(e - w, 0.0, 1.0));
    base = mix(base, vec3(1.0), clamp(w, 0.0, 1.0));
  } else if (mode > 3.5) {
    // Neon lateral stripe.
    float sl = smoothstep(uPattern.y, uPattern.y * 0.4, abs(yN - uPattern.z)) * step(u, 0.8);
    base = mix(base, uStripe, sl);
  }
  vec3 finCol = u > 0.8 ? uTailFin : uFin;
  base = mix(base, finCol, vFin);
  float eyeD = length(vec2(vLocal.z - uEye.x, vLocal.y - uEye.y));
  float eye = smoothstep(uEye.z, uEye.z * 0.55, eyeD) * (1.0 - vFin);
  base = mix(base, vec3(0.01), eye);

  vec3 L = -uUnderSun;
  float depth = max(uSurfaceY - vWorld.y, 0.0);
  vec3 sunC = uUnderSunColor * exp(-depth * vec3(0.05, 0.018, 0.01));
  float ndl = dot(n, L);
  float diff = max((ndl + 0.5) / 1.5, 0.0);
  vec3 amb = mix(uUnderGround, uUnderSky, n.y * 0.5 + 0.5);
  vec3 col = base * (amb * 1.1 + sunC * diff * 0.9);
  vec3 h = normalize(L + v);
  col += sunC * pow(max(dot(n, h), 0.0), 50.0) * uGloss * (1.0 - vFin * 0.7);
  float fr = pow(1.0 - abs(dot(n, v)), 2.0);
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (fr * 1.3 + vSeed * 0.3 + vec3(0.0, 0.33, 0.67)));
  col += irid * fr * uIrid * 0.55;
  col += vec3(0.5, 0.9, 1.0) * fr * 0.18;
  float c = caustics(vWorld, uUnderSun, uSurfaceY, uTime);
  col += base * sunC * c * 0.6 * max(n.y, 0.0);
  col = underwaterFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPECIES = {
  bait: {
    geo: { height: 0.24, width: 0.11, tailH: 0.34, tailLen: 0.2, fork: 0.5, dorsalH: 0.07, analH: 0.05 },
    body: '#3a7fc0', belly: '#ffffff', fin: '#d8eefa', tailFin: '#c8e6f8', stripe: '#ffffff',
    pattern: [0, 0, 0, 0], eye: [0.4, 0.03, 0.035], irid: 1.5, gloss: 2.2, wiggle: 9,
  },
  chromis: {
    geo: { height: 0.36, width: 0.13, tailH: 0.36, tailLen: 0.2, fork: 0.55, dorsalH: 0.1, analH: 0.08 },
    body: '#36d8d0', belly: '#bfffe8', fin: '#8ff6e6', tailFin: '#a8fff0', stripe: '#ffffff',
    pattern: [0, 0, 0, 0], eye: [0.4, 0.04, 0.04], irid: 1.0, gloss: 1.4, wiggle: 8,
  },
  yellowTang: {
    geo: { height: 0.62, width: 0.14, tailH: 0.5, tailLen: 0.2, fork: 0.15, dorsalH: 0.26, dorsalSpan: [0.16, 0.8], analH: 0.22, analSpan: [0.4, 0.82] },
    body: '#ffb800', belly: '#ffdc4a', fin: '#ffaa00', tailFin: '#ffc420', stripe: '#ffffff',
    pattern: [0, 0, 0, 0], eye: [0.36, 0.08, 0.045], irid: 0.25, gloss: 0.6, wiggle: 6,
  },
  blueTang: {
    geo: { height: 0.52, width: 0.13, tailH: 0.48, tailLen: 0.2, fork: 0.25, dorsalH: 0.14, dorsalSpan: [0.2, 0.85], analH: 0.12, analSpan: [0.45, 0.85] },
    body: '#1f5ae8', belly: '#3d96ff', fin: '#0c1a5a', tailFin: '#ffd21a', stripe: '#071030',
    pattern: [0, 0.32, 0.25, 2], eye: [0.36, 0.06, 0.04], irid: 0.5, gloss: 0.8, wiggle: 6.5,
  },
  butterfly: {
    geo: { height: 0.72, width: 0.12, tailH: 0.42, tailLen: 0.16, fork: 0.1, dorsalH: 0.4, dorsalSpan: [0.12, 0.6], analH: 0.24, analSpan: [0.4, 0.78] },
    body: '#fff6c8', belly: '#ffffff', fin: '#ffd84a', tailFin: '#ffe680', stripe: '#141414',
    pattern: [2.4, 0.18, 0.05, 1], eye: [0.38, 0.06, 0.045], irid: 0.2, gloss: 0.6, wiggle: 5.5,
  },
  clown: {
    geo: { height: 0.44, width: 0.18, tailH: 0.36, tailLen: 0.16, fork: 0.0, dorsalH: 0.12, analH: 0.08 },
    body: '#ff6a12', belly: '#ff9a3c', fin: '#ff7a1a', tailFin: '#ff7a1a', stripe: '#ffffff',
    pattern: [0, 0, 0, 3], eye: [0.38, 0.05, 0.05], irid: 0.2, gloss: 0.8, wiggle: 8,
  },
  parrot: {
    geo: { height: 0.36, width: 0.16, tailH: 0.42, tailLen: 0.2, fork: 0.3, dorsalH: 0.07, dorsalSpan: [0.15, 0.85], analH: 0.06 },
    body: '#25c9a8', belly: '#8ff0d4', fin: '#ff7ac2', tailFin: '#ff8fd0', stripe: '#ff9ad0',
    pattern: [0, 0, 0, 0], eye: [0.4, 0.05, 0.035], irid: 0.6, gloss: 0.9, wiggle: 4,
  },
  neon: {
    geo: { height: 0.26, width: 0.1, tailH: 0.3, tailLen: 0.18, fork: 0.4, dorsalH: 0.08, analH: 0.06 },
    body: '#2a5fd8', belly: '#ff5a7a', fin: '#9fd8ff', tailFin: '#bfe8ff', stripe: '#5ffcff',
    pattern: [0, 0.2, 0.18, 4], eye: [0.4, 0.03, 0.035], irid: 0.8, gloss: 1.6, wiggle: 9,
  },
};

const SCHOOLS = [
  // Big silver bait ball milling off to the back-right of the dome.
  { species: 'bait', count: 170, mode: 1, center: [11.5, 5.2, -13.0], radius: [3.4, 2.2, 1.6], speed: 0.45, size: 0.42, seed: 1 },
  // Aqua chromis hovering over the left bommie.
  { species: 'chromis', count: 55, mode: 1, center: [-12.6, 2.6, -7.2], radius: [2.2, 1.2, 0.6], speed: 0.35, size: 0.3, seed: 7 },
  // Yellow tangs streaming around the dome, crossing high in front of it.
  { species: 'yellowTang', count: 26, mode: 0, center: [0, 6.6, -2.0], radius: [12.5, 0.6, 10.5], speed: 0.1, size: 0.62, groups: [0, 0.5], spreadLong: 2.4, spreadLat: [1.5, 0.8], seed: 2 },
  // Blue tangs skimming the sand the other way round.
  { species: 'blueTang', count: 14, mode: 0, center: [0, 0.05, -2.5], radius: [12.0, 0.4, 11.0], speed: -0.085, size: 0.56, groups: [0.25, 0.75], spreadLong: 1.8, spreadLat: [1.4, 0.5], seed: 3 },
  // Neon tetras-style darting stream along the back.
  { species: 'neon', count: 60, mode: 0, center: [0, 3.0, -15.0], radius: [16.0, 0.6, 5.0], speed: 0.16, size: 0.3, groups: [0.1, 0.6], spreadLong: 2.4, spreadLat: [0.9, 0.5], seed: 8 },
  { species: 'butterfly', count: 10, mode: 0, center: [-12.0, 1.6, -6.4], radius: [3.4, 0.5, 2.4], speed: 0.18, size: 0.5, groups: [0, 0.33, 0.66], spreadLong: 0.6, spreadLat: [0.4, 0.3], seed: 4 },
  { species: 'clown', count: 3, mode: 1, center: [12.2, 0.4, -5.6], radius: [0.55, 0.35, 0.0], speed: 0.6, size: 0.3, seed: 5 },
  { species: 'clown', count: 2, mode: 1, center: [-3.3, 0.25, 8.4], radius: [0.5, 0.25, 0.0], speed: 0.5, size: 0.28, seed: 9 },
  { species: 'parrot', count: 4, mode: 0, center: [0, 0.6, -4.0], radius: [15.0, 0.5, 13.0], speed: 0.06, size: 0.95, groups: [0.1, 0.35, 0.6, 0.85], spreadLong: 0.2, spreadLat: [0.6, 0.3], seed: 6 },
];

function FishSchool({ shared, school }) {
  const spec = SPECIES[school.species];
  const geometry = useDisposable(() => {
    const base = fishGeometry(spec.geo);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    for (const name of ['position', 'normal', 'aU', 'aFin']) g.setAttribute(name, base.attributes[name]);
    const rand = makeRandom(school.seed * 97);
    const seeds = new Float32Array(school.count * 4);
    const offsets = new Float32Array(school.count * 3);
    for (let i = 0; i < school.count; i++) {
      let phase = rand.next();
      if (school.mode === 0) {
        const groups = school.groups ?? [0];
        const loop = 2 * Math.PI * Math.max(school.radius[0], school.radius[2]);
        phase = groups[i % groups.length] + (rand.range(-1, 1) * (school.spreadLong ?? 1)) / loop;
      }
      seeds.set([phase, rand.next(), rand.next(), rand.next()], i * 4);
      const lat = school.spreadLat ?? [0, 0];
      offsets.set([rand.range(-1, 1) * lat[0], rand.range(-1, 1) * lat[1], rand.range(-1, 1) * (school.spreadLong ?? 0) * 0.3], i * 3);
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    g.instanceCount = school.count;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...shared,
          uCenter: { value: new THREE.Vector3(...school.center) },
          uRadius: { value: new THREE.Vector3(...school.radius) },
          uSpeed: { value: school.speed },
          uMode: { value: school.mode },
          uWiggle: { value: spec.wiggle },
          uSize: { value: school.size },
          uBody: { value: new THREE.Color(spec.body) },
          uBelly: { value: new THREE.Color(spec.belly) },
          uFin: { value: new THREE.Color(spec.fin) },
          uTailFin: { value: new THREE.Color(spec.tailFin) },
          uStripe: { value: new THREE.Color(spec.stripe) },
          uPattern: { value: new THREE.Vector4(...spec.pattern) },
          uEye: { value: new THREE.Vector3(...spec.eye) },
          uHalfH: { value: spec.geo.height / 2 },
          uIrid: { value: spec.irid },
          uGloss: { value: spec.gloss },
        },
        vertexShader: fishVertex,
        fragmentShader: fishFragment,
        side: THREE.DoubleSide,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Dolphins, turtle, manta and jellyfish.
// ---------------------------------------------------------------------------

/** Drives an InstancedMesh along path(t, k, out) facing its direction of travel. */
function usePathInstances(ref, count, path, { lead = 0.1, roll = () => 0, scale = 1 } = {}) {
  const tmp = useMemo(() => ({ dummy: new THREE.Object3D(), ahead: new THREE.Vector3() }), []);
  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    const { dummy, ahead } = tmp;
    for (let k = 0; k < count; k++) {
      path(t, k, dummy.position);
      path(t + lead, k, ahead);
      dummy.lookAt(ahead);
      dummy.rotateZ(roll(t, k));
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
}

// A pair arcing in a long loop behind the dome, swooping over its back.
const dolphinPath = (t, k, out) => {
  const th = (t / 44) * Math.PI * 2 - k * 0.1 + 1.2;
  return out.set(
    Math.cos(th) * 18 + k * 1.0,
    6.0 + Math.sin(th * 2 + 0.4) * 1.5 + Math.sin(t * 0.8 + k * 1.7) * 0.35 + k * 0.6,
    -15.5 + Math.sin(th) * 6.5 - k * 0.9,
  );
};

function Dolphins({ shared }) {
  const mesh = useRef();
  const geometry = useDisposable(() => {
    const g = dolphinGeometry();
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array([0, 0.37]), 1));
    return g;
  });
  const material = useDisposable(() =>
    makeLitMaterial(shared, { shininess: 70, specular: 0.9, rim: 0.4, rimColor: '#bff4ff', wrap: 0.45, caustics: 1.0, defines: { UNDULATE: '' } }),
  );
  usePathInstances(mesh, 2, dolphinPath, { roll: () => 0.28, scale: 1.15 });
  return <instancedMesh ref={mesh} args={[geometry, material, 2]} frustumCulled={false} />;
}

const turtlePath = (t, k, out) => {
  const th = -(t / 75) * Math.PI * 2 + 2.6;
  return out.set(2 + Math.cos(th) * 17, 5.0 + Math.sin(th * 2) * 0.5 + Math.sin(t * 0.4) * 0.2, -12.5 + Math.sin(th) * 5);
};

function Turtle({ shared }) {
  const mesh = useRef();
  const geometry = useDisposable(() => {
    const g = turtleGeometry();
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
    return g;
  });
  const material = useDisposable(() => makeLitMaterial(shared, { shininess: 50, specular: 0.5, rim: 0.25, wrap: 0.5, caustics: 1.0, defines: { FLIPPERS: '' } }));
  usePathInstances(mesh, 1, turtlePath, { lead: 0.3, roll: (t) => -0.12 + Math.sin(t * 1.25) * 0.04, scale: 1.8 });
  return <instancedMesh ref={mesh} args={[geometry, material, 1]} frustumCulled={false} />;
}

// Far off in the blue: a manta gliding a slow arc near the surface.
const mantaPath = (t, k, out) => {
  const th = (t / 110) * Math.PI * 2 + 2.2;
  return out.set(Math.cos(th) * 30, 8.0 + Math.sin(t * 0.13) * 0.5, -40 + Math.sin(th) * 8);
};

function Manta({ shared }) {
  const mesh = useRef();
  const geometry = useDisposable(() => {
    const g = mantaGeometry();
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
    return g;
  });
  const material = useDisposable(() =>
    makeLitMaterial(shared, { shininess: 40, specular: 0.3, rim: 0.3, wrap: 0.5, caustics: 0.5, side: THREE.DoubleSide, defines: { MANTA: '' } }),
  );
  usePathInstances(mesh, 1, mantaPath, { lead: 0.5, roll: (t) => 0.2 + Math.sin(t * 0.2) * 0.08, scale: 3.6 });
  return <instancedMesh ref={mesh} args={[geometry, material, 1]} frustumCulled={false} />;
}

const jellyMotion = /* glsl */ `
uniform float uTime;
attribute vec4 aJ;
attribute vec4 aJ2;
varying float vFadeW;
varying float vPulse;
varying float vHue;
vec3 jellyCenter(out float pulse) {
  float ph = aJ.w * 6.2831853;
  float cyc = uTime * 0.95 * aJ2.w + ph;
  pulse = pow(0.5 + 0.5 * sin(cyc), 2.0);
  float rise = uTime * aJ2.z + 0.22 * sin(cyc - 1.2);
  float range = 8.0;
  float yy = mod(rise + aJ.w * range, range);
  vFadeW = smoothstep(0.0, 1.4, yy) * smoothstep(range, range - 1.4, yy);
  return vec3(aJ.x + sin(uTime * 0.09 + ph) * 0.9, aJ.y - range + yy, aJ.z + cos(uTime * 0.07 + ph) * 0.6);
}
`;

const jellyPalette = /* glsl */ `
vec3 jellyPal(float h) {
  vec3 aqua = vec3(0.45, 0.95, 1.0);
  vec3 pink = vec3(1.0, 0.45, 0.85);
  vec3 violet = vec3(0.7, 0.5, 1.0);
  return h < 0.33 ? mix(aqua, pink, h * 3.0) : h < 0.66 ? mix(pink, violet, (h - 0.33) * 3.0) : mix(violet, aqua, (h - 0.66) * 3.0);
}
`;

const jellyFragment = /* glsl */ `
uniform float uTime;
uniform float uWaterDensity;
uniform float uFogStart;
${jellyPalette}
varying vec3 vWorld;
varying vec3 vN;
varying float vU;
varying float vFadeW;
varying float vPulse;
varying float vHue;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vWorld);
  float fr = pow(1.0 - abs(dot(n, v)), 1.6);
  vec3 tint = jellyPal(vHue);
  float bell = 1.0 - step(1.0, vU);
  float arms = 1.0 - bell;
  vec3 col = tint * (0.3 + fr * 2.0) * (1.0 + vPulse * 0.7);
  col += mix(tint, vec3(1.0), 0.4) * smoothstep(0.72, 0.98, vU) * bell * 2.0;
  col += tint * smoothstep(0.35, 0.0, vU) * 0.8;
  col = mix(col, tint * (0.5 + 0.5 * sin(vU * 30.0 - uTime * 2.0)) * 0.9, arms);
  float a = mix(0.2 + fr * 0.6, 0.35, arms);
  float d = length(cameraPosition - vWorld);
  a *= vFadeW * exp(-max(d - uFogStart, 0.0) * uWaterDensity * 1.3);
  gl_FragColor = vec4(col * a, a);
}
`;

const JELLY_SPOTS = [
  [-13.5, 8.0, -9.0],
  [-9.0, 9.0, -20.0],
  [14.0, 7.5, -16.0],
  [9.0, 9.0, -26.0],
  [-19.0, 8.5, -22.0],
  [17.5, 8.0, -6.0],
  [-4.0, 9.5, -32.0],
];

function Jellyfish({ shared }) {
  const count = JELLY_SPOTS.length;
  const inst = useMemo(() => {
    const rand = makeRandom(404);
    const a = new Float32Array(count * 4);
    const b = new Float32Array(count * 4);
    const hues = [0.4, 0.15, 0.6, 0.85, 0.45, 0.55, 0.3];
    JELLY_SPOTS.forEach(([x, y, z], i) => {
      a.set([x, y, z, rand.next()], i * 4);
      b.set([rand.range(0.42, 0.62), hues[i % hues.length], rand.range(0.14, 0.22), rand.range(0.8, 1.2)], i * 4);
    });
    return { a, b };
  }, [count]);
  const bellGeo = useDisposable(() => {
    const base = jellyGeometry();
    const g = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'normal', 'aU']) g.setAttribute(name, base.attributes[name]);
    g.setAttribute('aJ', new THREE.InstancedBufferAttribute(inst.a, 4));
    g.setAttribute('aJ2', new THREE.InstancedBufferAttribute(inst.b, 4));
    g.instanceCount = count;
    return g;
  });
  const lineGeo = useDisposable(() => {
    const base = tentacleLines();
    const g = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'aU']) g.setAttribute(name, base.attributes[name]);
    g.setAttribute('aJ', new THREE.InstancedBufferAttribute(inst.a, 4));
    g.setAttribute('aJ2', new THREE.InstancedBufferAttribute(inst.b, 4));
    g.instanceCount = count;
    return g;
  });
  const mats = useDisposable(() => {
    const common = {
      uniforms: { ...shared },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    };
    return {
      bell: new THREE.ShaderMaterial({
        ...common,
        vertexShader: /* glsl */ `
          ${jellyMotion}
          attribute float aU;
          varying vec3 vWorld;
          varying vec3 vN;
          varying float vU;
          void main() {
            float pulse;
            vec3 c = jellyCenter(pulse);
            vec3 p = position;
            float isBell = 1.0 - step(1.0, aU);
            float rimW = smoothstep(0.15, 1.0, aU) * isBell;
            p.xz *= 1.0 - 0.2 * pulse * rimW;
            p.y *= 1.0 + 0.12 * pulse * isBell;
            float tl = max(aU - 1.0, 0.0);
            p.x += sin(uTime * 1.2 + aJ.w * 9.0 + tl * 3.0) * tl * 0.3;
            p.z += cos(uTime * 1.0 + aJ.w * 7.0 + tl * 2.5) * tl * 0.3;
            p.y += pulse * tl * 0.25;
            vec3 wp = c + p * aJ2.x;
            vWorld = wp;
            vN = normal;
            vU = aU;
            vPulse = pulse;
            vHue = aJ2.y;
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          }
        `,
        fragmentShader: jellyFragment,
      }),
      lines: new THREE.ShaderMaterial({
        ...common,
        vertexShader: /* glsl */ `
          ${jellyMotion}
          ${jellyPalette}
          uniform float uWaterDensity;
          uniform float uFogStart;
          attribute float aU;
          varying float vA;
          varying vec3 vCol;
          void main() {
            float pulse;
            vec3 c = jellyCenter(pulse);
            vec3 p = position;
            p.xz *= 1.0 - 0.2 * pulse * (1.0 - aU * 0.6);
            p.x += sin(uTime * 1.4 + aJ.w * 9.0 + aU * 4.0) * aU * 0.45;
            p.z += cos(uTime * 1.1 + aJ.w * 5.0 + aU * 3.0) * aU * 0.45;
            p.y += pulse * aU * 0.35;
            vec3 wp = c + p * aJ2.x;
            vCol = mix(jellyPal(aJ2.y), vec3(1.0), 0.25) * 1.3;
            float d = length(cameraPosition - wp);
            vA = (1.0 - aU) * 0.55 * exp(-max(d - uFogStart, 0.0) * uWaterDensity * 1.3);
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying vec3 vCol;
          varying float vFadeW;
          void main() {
            float a = vA * vFadeW;
            gl_FragColor = vec4(vCol * a, a);
          }
        `,
      }),
    };
  });
  return (
    <>
      <lineSegments geometry={lineGeo} material={mats.lines} frustumCulled={false} renderOrder={24} />
      <mesh geometry={bellGeo} material={mats.bell} frustumCulled={false} renderOrder={25} />
    </>
  );
}

export function Life({ shared }) {
  return (
    <>
      {SCHOOLS.map((s, i) => (
        <FishSchool key={i} shared={shared} school={s} />
      ))}
      <Dolphins shared={shared} />
      <Turtle shared={shared} />
      <Manta shared={shared} />
      <Jellyfish shared={shared} />
    </>
  );
}
