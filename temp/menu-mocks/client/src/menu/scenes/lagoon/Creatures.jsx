import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { causticsGLSL, makeLitMaterial, waterGLSL } from './shaders.js';
import { dolphinGeometry, fishGeometry, jellyGeometry, tentacleLines, turtleGeometry } from './creatureGeometry.js';

// ---------------------------------------------------------------------------
// Fish schools: motion, tail beat and orientation are computed entirely on
// the GPU from per-instance seeds, so hundreds of fish cost one draw each.
// ---------------------------------------------------------------------------

const fishVertex = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uRadius;
uniform float uSpeed;
uniform float uMode;
uniform float uWiggle;
uniform float uSize;
uniform vec4 uAttract;
uniform float uAttractGain;
uniform vec4 uRepel;
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
    vec3 c = uCenter + vec3(sin(t * 0.13) * 1.8, sin(t * 0.21) * 0.35, cos(t * 0.11) * 1.2);
    p = c + vec3(cos(a) * r, (aSeed.z - 0.5) * uRadius.y + 0.3 * sin(a * 2.0 + aSeed.x * 10.0), sin(a) * r);
  }
  float ga = t * 1.4 * sign(uSpeed) + aSeed.x * 6.2831853 * 3.0;
  vec3 orbit = uAttract.xyz + vec3(cos(ga) * (0.7 + aSeed.y * 1.4), (aSeed.z - 0.5) * 1.2 + 0.2 * sin(ga * 2.0), sin(ga) * (0.5 + aSeed.y * 0.9));
  p = mix(p, orbit, clamp(uAttract.w * uAttractGain, 0.0, 1.0));
  vec3 d = p - uRepel.xyz;
  float k = uRepel.w * exp(-dot(d, d) / 12.0);
  vec3 away = normalize(vec3(d.x, d.y * 0.6, min(d.z, 0.0) * 0.6 - 0.15) + vec3(0.0, 0.001, 0.0));
  p += away * k * 2.4;
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
  } else if (mode > 2.5) {
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
  }
  vec3 finCol = u > 0.8 ? uTailFin : uFin;
  base = mix(base, finCol, vFin);
  float eyeD = length(vec2(vLocal.z - uEye.x, vLocal.y - uEye.y));
  float eye = smoothstep(uEye.z, uEye.z * 0.55, eyeD) * (1.0 - vFin);
  base = mix(base, vec3(0.01), eye);

  vec3 L = -uUnderSun;
  float depth = max(-vWorld.y, 0.0);
  vec3 sunC = uUnderSunColor * exp(-depth * vec3(0.11, 0.035, 0.02));
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
  vec2 cp = vWorld.xz + vWorld.y * (uUnderSun.xz / uUnderSun.y);
  float c = causticPattern(cp * 0.21, uTime * 0.42 + 23.0);
  col += base * sunC * c * 0.7 * max(n.y, 0.0);
  col = underwaterFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPECIES = {
  bait: {
    geo: { height: 0.24, width: 0.11, tailH: 0.34, tailLen: 0.2, fork: 0.5, dorsalH: 0.07, analH: 0.05 },
    body: '#2c6fa8', belly: '#ffffff', fin: '#d8eefa', tailFin: '#c8e6f8', stripe: '#ffffff',
    pattern: [0, 0, 0, 0], eye: [0.4, 0.03, 0.035], irid: 1.4, gloss: 2.2, wiggle: 9,
  },
  yellowTang: {
    geo: { height: 0.62, width: 0.14, tailH: 0.5, tailLen: 0.2, fork: 0.15, dorsalH: 0.26, dorsalSpan: [0.16, 0.8], analH: 0.22, analSpan: [0.4, 0.82] },
    body: '#ffb400', belly: '#ffd84a', fin: '#ffa800', tailFin: '#ffc020', stripe: '#ffffff',
    pattern: [0, 0, 0, 0], eye: [0.36, 0.08, 0.045], irid: 0.25, gloss: 0.6, wiggle: 6,
  },
  blueTang: {
    geo: { height: 0.52, width: 0.13, tailH: 0.48, tailLen: 0.2, fork: 0.25, dorsalH: 0.14, dorsalSpan: [0.2, 0.85], analH: 0.12, analSpan: [0.45, 0.85] },
    body: '#1f54e0', belly: '#3d8cff', fin: '#0c1a5a', tailFin: '#ffd21a', stripe: '#071030',
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
};

export const SCHOOLS = [
  { species: 'bait', count: 150, mode: 1, center: [-1.0, -2.8, -13.0], radius: [3.2, 1.8, 0], speed: 0.5, size: 0.4, attractGain: 1, seed: 1 },
  { species: 'yellowTang', count: 28, mode: 0, center: [1.0, -4.0, -13.5], radius: [10, 0.7, 4.5], speed: 0.1, size: 0.62, groups: [0, 0.5], spreadLong: 2.2, spreadLat: [1.6, 0.8], attractGain: 0.35, seed: 2 },
  { species: 'blueTang', count: 16, mode: 0, center: [-1, -3.4, -17], radius: [13, 1.0, 6], speed: -0.08, size: 0.66, groups: [0.25, 0.75], spreadLong: 1.8, spreadLat: [1.4, 0.8], attractGain: 0.3, seed: 3 },
  { species: 'butterfly', count: 10, mode: 0, center: [-6.0, -4.6, -12.5], radius: [3.0, 0.5, 2.0], speed: 0.18, size: 0.5, groups: [0, 0.33, 0.66], spreadLong: 0.6, spreadLat: [0.4, 0.3], attractGain: 0.15, seed: 4 },
  { species: 'clown', count: 4, mode: 1, center: [8.1, -5.3, -16.5], radius: [0.5, 0.35, 0], speed: 0.6, size: 0.3, attractGain: 0, seed: 5 },
  { species: 'parrot', count: 4, mode: 0, center: [1, -5.3, -12.5], radius: [8, 0.4, 3.5], speed: 0.06, size: 0.95, groups: [0.1, 0.35, 0.6, 0.85], spreadLong: 0.2, spreadLat: [0.6, 0.3], attractGain: 0, seed: 6 },
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
          uAttractGain: { value: school.attractGain ?? 0 },
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
// Dolphins, turtle and jellyfish.
// ---------------------------------------------------------------------------

function Dolphins({ shared }) {
  const mesh = useRef();
  const geometry = useDisposable(() => {
    const g = dolphinGeometry();
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array([0, 0.37]), 1));
    return g;
  });
  const material = useDisposable(() => {
    const m = makeLitMaterial(shared, { underwater: true, shininess: 70, specular: 0.9, rim: 0.35, rimColor: '#bff4ff', wrap: 0.45, caustics: 1.0 });
    m.defines.UNDULATE = '';
    m.uniforms.uUndAmp.value = 0.13;
    m.uniforms.uUndFreq.value = 2.4;
    return m;
  });
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const ahead = useMemo(() => new THREE.Vector3(), []);
  const pos = (t, k, out) => {
    const T = 64;
    const th = (t / T) * Math.PI * 2 - k * 0.09 + 0.4;
    out.set(
      2 + Math.cos(th) * 17 + k * 0.9,
      -3.5 + Math.sin(th * 2) * 0.8 + Math.sin(t * 0.9 + k) * 0.25 - k * 0.6,
      -20 + Math.sin(th) * 11 + k * 1.3,
    );
    return out;
  };
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let k = 0; k < 2; k++) {
      pos(t, k, dummy.position);
      pos(t + 0.1, k, ahead);
      dummy.lookAt(ahead);
      dummy.rotateZ(0.22);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(k, dummy.matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, 2]} frustumCulled={false} />;
}

function Turtle({ shared }) {
  const mesh = useRef();
  const geometry = useDisposable(() => {
    const g = turtleGeometry();
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1));
    return g;
  });
  const material = useDisposable(() => {
    const m = makeLitMaterial(shared, { underwater: true, shininess: 50, specular: 0.5, rim: 0.25, wrap: 0.5, caustics: 1.0 });
    m.defines.FLIPPERS = '';
    return m;
  });
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const ahead = useMemo(() => new THREE.Vector3(), []);
  const pos = (t, out) => {
    const th = -(t / 70) * Math.PI * 2 + 2.0;
    out.set(-1 + Math.cos(th) * 11, -3.35 + Math.sin(th * 2) * 0.3 + Math.sin(t * 0.4) * 0.15, -16 + Math.sin(th) * 6.5);
    return out;
  };
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    pos(t, dummy.position);
    pos(t + 0.3, ahead);
    dummy.lookAt(ahead);
    dummy.rotateZ(-0.12 + Math.sin(t * 1.25) * 0.04);
    dummy.scale.setScalar(1.25);
    dummy.updateMatrix();
    mesh.current.setMatrixAt(0, dummy.matrix);
    mesh.current.instanceMatrix.needsUpdate = true;
  });
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
  float range = 7.5;
  float yy = mod(rise + aJ.w * range, range);
  vFadeW = smoothstep(0.0, 1.2, yy) * smoothstep(range, range - 1.2, yy);
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
  // Four-leaf glow in the crown.
  col += tint * smoothstep(0.35, 0.0, vU) * 0.8;
  col = mix(col, tint * (0.5 + 0.5 * sin(vU * 30.0 - uTime * 2.0)) * 0.9, arms);
  float a = mix(0.2 + fr * 0.6, 0.35, arms);
  float d = length(cameraPosition - vWorld);
  a *= vFadeW * exp(-d * 0.045);
  gl_FragColor = vec4(col * a, a);
}
`;

function Jellyfish({ shared }) {
  const count = 7;
  const instData = useMemo(() => {
    const rand = makeRandom(404);
    const a = new Float32Array(count * 4);
    const b = new Float32Array(count * 4);
    const spots = [[-6.5, -0.8, -9], [-5, -0.4, -23], [10, -1.0, -17], [4, -0.2, -26], [-13, -0.6, -24], [7.5, -0.4, -10], [-1, 0.0, -30]];
    for (let i = 0; i < count; i++) {
      const [x, y, z] = spots[i];
      a.set([x, y, z, rand.next()], i * 4);
      b.set([rand.range(0.36, 0.6), [0.4, 0.15, 0.6, 0.85, 0.45, 0.55, 0.3][i], rand.range(0.12, 0.2), rand.range(0.8, 1.2)], i * 4);
    }
    return { a, b };
  }, []);
  const bellGeo = useDisposable(() => {
    const base = jellyGeometry();
    const g = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'normal', 'aU']) g.setAttribute(name, base.attributes[name]);
    g.setAttribute('aJ', new THREE.InstancedBufferAttribute(instData.a, 4));
    g.setAttribute('aJ2', new THREE.InstancedBufferAttribute(instData.b, 4));
    g.instanceCount = count;
    return g;
  });
  const lineGeo = useDisposable(() => {
    const base = tentacleLines();
    const g = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'aU']) g.setAttribute(name, base.attributes[name]);
    g.setAttribute('aJ', new THREE.InstancedBufferAttribute(instData.a, 4));
    g.setAttribute('aJ2', new THREE.InstancedBufferAttribute(instData.b, 4));
    g.instanceCount = count;
    return g;
  });
  const mats = useDisposable(() => {
    const common = { uniforms: { ...shared }, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, side: THREE.DoubleSide };
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
            vA = (1.0 - aU) * 0.55 * exp(-d * 0.045);
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

export function Creatures({ shared }) {
  return (
    <>
      {SCHOOLS.map((s) => (
        <FishSchool key={s.species} shared={shared} school={s} />
      ))}
      <Dolphins shared={shared} />
      <Turtle shared={shared} />
      <Jellyfish shared={shared} />
    </>
  );
}
