import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { CloudField, SkyDome } from '../../shared/Sky.jsx';
import { makeRandom } from '../../shared/random.js';
import { airGLSL, hash, makeLitMaterial, simplex } from './shaders.js';
import {
  blob,
  bushCluster,
  finalize,
  gullGeometry,
  islandGeometry,
  merge,
  palmGeometry,
  place,
  sailboatGeometry,
  sanctuaryGeometry,
} from './geometry.js';

// Island layout (world xz, radius, height).
export const ISLANDS = [
  { x: 54, z: -104, r: 21, h: 3.6, seed: 4 },
  { x: -52, z: -122, r: 22, h: 3.2, seed: 9 },
  { x: 128, z: -230, r: 12, h: 2.2, seed: 15 },
  { x: -20, z: -420, r: 26, h: 2.4, seed: 21 },
];

const oceanVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const oceanFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec4 uIslands[4];
uniform vec3 uNear;
uniform vec3 uFar;
uniform vec3 uShallow;
uniform vec3 uShore;
${airGLSL}
${hash}
${simplex}
varying vec3 vWorld;

vec3 skyColor(vec3 r) {
  float h = max(r.y, 0.0);
  vec3 c = mix(uSkyHorizon, uSkyTop, pow(h, 0.45));
  float s = max(dot(r, uSunDir), 0.0);
  c += uSunColor * (pow(s, 12.0) * 0.35 + pow(s, 120.0) * 0.8);
  return c;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  vec2 p = vWorld.xz;
  float t = uTime;
  // Approximate pixel footprint along the view direction (grazing angles).
  float foot = dist * dist * 0.0011 / max(cameraPosition.y, 0.5) + 0.01;
  vec2 g = vec2(0.0);
  float lost = 0.0;
  #define WAVE(dx, dz, L, A, ph) { vec2 D = normalize(vec2(dx, dz)); float k = 6.2831853 / L; float w = sqrt(9.8 * k) * 0.8; float f = 1.0 - smoothstep(0.3, 1.1, foot / L); float s = A * k; g += D * (s * cos(dot(D, p) * k - w * t + ph)) * f; lost += s * s * (1.0 - f); }
  WAVE(1.0, 0.25, 11.0, 0.12, 0.0)
  WAVE(-0.55, 1.0, 6.3, 0.07, 1.3)
  WAVE(0.35, -1.0, 3.7, 0.045, 2.1)
  WAVE(0.95, 0.7, 2.3, 0.028, 4.0)
  WAVE(-1.0, -0.25, 1.45, 0.017, 0.7)
  WAVE(0.15, 1.0, 0.9, 0.010, 5.2)
  WAVE(-0.45, -0.9, 0.55, 0.006, 3.3)
  // Fine noise ripples close to the lens.
  float nearF = 1.0 - smoothstep(0.08, 0.5, foot);
  if (nearF > 0.0) {
    vec2 q = p * 2.2 + vec2(t * 0.35, -t * 0.2);
    float e = 0.15;
    float n0 = snoise(q);
    g += vec2(snoise(q + vec2(e, 0.0)) - n0, snoise(q + vec2(0.0, e)) - n0) / e * 0.05 * nearF;
  }
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  float ndv = max(dot(n, v), 0.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  F *= 0.62;

  // Water body: turquoise lagoon near, deep blue far, bright shallows by islands.
  vec3 water = mix(uNear, uFar, smoothstep(20.0, 260.0, dist));
  float shallow = 0.0;
  float shore = 0.0;
  float foam = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 isl = uIslands[i];
    float s = length(p - isl.xy) / isl.z;
    float wob = snoise(p * 0.06 + isl.xy) * 0.12;
    s += wob;
    shallow = max(shallow, 1.0 - smoothstep(1.0, 1.75, s));
    shore = max(shore, 1.0 - smoothstep(0.95, 1.18, s));
    float ring = exp(-pow((s - 1.03 - 0.05 * sin(t * 0.9 + isl.x)) * 22.0, 2.0));
    foam = max(foam, ring * (0.55 + 0.45 * sin(s * 60.0 - t * 1.4 + snoise(p * 0.3) * 3.0)));
  }
  water = mix(water, uShallow, shallow * 0.85);
  water = mix(water, uShore, shore * 0.7);

  vec3 sky = skyColor(r);
  vec3 col = mix(water, sky, F);

  // Sun glitter: Beckmann-like lobe widened by the detail we could not resolve.
  vec3 h = normalize(uSunDir + v);
  float ndh = max(dot(n, h), 1e-3);
  float m2 = 0.0012 + 2.2 * lost;
  float tan2 = (1.0 - ndh * ndh) / (ndh * ndh);
  float D = exp(-tan2 / m2) / (3.14159 * m2 * ndh * ndh * ndh * ndh);
  float spec = D * F * 0.11;
  col += uSunColor * min(spec, 30.0);

  // Twinkling glints near the camera.
  vec2 cell = floor(p * 3.0);
  float tw = floor(t * 7.0 + hash12(cell) * 50.0);
  float glint = step(0.993, hash12(cell + tw * 0.37));
  col += uSunColor * glint * smoothstep(0.03, 0.35, spec) * 6.0 * (1.0 - smoothstep(0.2, 1.0, foot));

  col += vec3(0.9, 1.0, 1.0) * foam * (1.0 - smoothstep(0.5, 6.0, foot)) * 0.6;
  col = airFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

function Ocean({ shared }) {
  const mesh = useRef();
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...shared,
          uIslands: { value: ISLANDS.map((i) => new THREE.Vector4(i.x, i.z, i.r, 0)) },
          uNear: { value: new THREE.Color('#0fb0c8') },
          uFar: { value: new THREE.Color('#0b4fae') },
          uShallow: { value: new THREE.Color('#4fe6d2') },
          uShore: { value: new THREE.Color('#c9f2d9') },
        },
        vertexShader: oceanVertex,
        fragmentShader: oceanFragment,
      }),
  );
  useFrame((state) => {
    mesh.current.position.x = state.camera.position.x;
    mesh.current.position.z = state.camera.position.z;
  });
  return (
    <mesh ref={mesh} material={material} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
      <planeGeometry args={[9000, 9000, 1, 1]} />
    </mesh>
  );
}

function Islands({ shared }) {
  const { solid, swaying, glass, lantern } = useDisposable(() => {
    const solidParts = [];
    const swayParts = [];
    const rand = makeRandom(5);
    ISLANDS.forEach((isl, idx) => {
      const g = islandGeometry({ radius: isl.r, height: isl.h, seed: isl.seed });
      place(g, { position: [isl.x, 0, isl.z] });
      solidParts.push(g);
      const heightAt = (x, z) => {
        const rho = Math.hypot(x - isl.x, z - isl.z) / isl.r;
        return rho < 1 ? isl.h * Math.pow(1 - rho * rho, 0.85) : 0;
      };
      // Bushes on the crown.
      const bushes = bushCluster({
        count: idx === 0 ? 11 : idx === 1 ? 6 : 5,
        spread: isl.r * 0.45,
        size: idx === 3 ? [4, 7] : [2.2, 4.2],
        seed: isl.seed * 7,
        base: [isl.x, -0.6, isl.z],
        heightAt,
      });
      solidParts.push(...bushes);
      // Shore rocks.
      for (let k = 0; k < 4; k++) {
        const a = rand.range(0, Math.PI * 2);
        const rr = blob({ radius: rand.range(0.8, 1.8), detail: 1, squash: [1.3, 0.7, 1], amount: 0.25, seed: 100 + k + idx * 10 });
        place(rr, { position: [isl.x + Math.cos(a) * isl.r * 0.95, 0.1, isl.z + Math.sin(a) * isl.r * 0.95] });
        solidParts.push(finalize(rr, { paint: '#b9b2a2' }));
      }
    });
    // Palms.
    const palmSpots = [
      [0, -10, 4, 10.5, 3.6, 2.6],
      [0, -4, -6, 9.2, 2.6, -2.2],
      [0, 6, 3, 11.5, 3.4, 0.6],
      [0, 10, -5, 8.4, 2.8, -0.4],
      [0, -14, -2, 7.6, 2.2, 3.4],
      [0, 2, 9, 9.6, 2.8, 1.4],
      [1, 17, 9, 9.5, 2.6, 0.9],
      [1, -13, -9, 8.0, 2.4, -2.4],
      [1, -17, 5, 8.8, 3.0, 2.6],
      [2, 0, 0, 7.2, 2.2, 0.3],
      [2, -3, 2, 6.0, 2.0, 2.8],
    ];
    palmSpots.forEach(([i, dx, dz, height, lean, heading], k) => {
      const isl = ISLANDS[i];
      const rho = Math.hypot(dx, dz) / isl.r;
      const y = rho < 1 ? isl.h * Math.pow(1 - rho * rho, 0.85) - 0.2 : 0;
      for (const part of palmGeometry({ height, lean, heading, seed: 40 + k })) {
        place(part, { position: [isl.x + dx, y, isl.z + dz] });
        swayParts.push(part);
      }
    });
    // Sanctuary on island 1.
    const s = sanctuaryGeometry();
    const sanct = ISLANDS[1];
    const sx = sanct.x + 2;
    const sz = sanct.z + 2;
    const sy = sanct.h - 0.9;
    const sanctXf = { position: [sx, sy, sz], rotation: [0, 0.35 + Math.PI, 0], scale: 1.25 };
    s.solid.forEach((g) => {
      place(g, sanctXf);
      solidParts.push(g);
    });
    place(s.glass, sanctXf);
    place(s.lantern, sanctXf);
    // Hazy distant islands on the horizon.
    const far = [
      [-380, -1250, 120, 26],
      [-250, -1400, 70, 14],
      [420, -1500, 160, 34],
      [600, -1350, 80, 18],
      [130, -1700, 110, 16],
    ];
    far.forEach(([x, z, r, h], k) => {
      const g = blob({ radius: 1, detail: 3, squash: [r, h, r * 0.6], amount: 0.22, freq: 2.2, seed: 300 + k, flatBottom: true });
      place(g, { position: [x, -h * 0.15, z] });
      solidParts.push(finalize(g, { paint: (p, n, out) => out.set('#5fae7a').lerp(new THREE.Color('#9fd6a0'), Math.max(0, n.y)) }));
    });
    return {
      solid: merge(solidParts),
      swaying: merge(swayParts),
      glass: s.glass,
      lantern: s.lantern,
    };
  });

  const mats = useDisposable(() => ({
    solid: makeLitMaterial(shared, { shininess: 60, specular: 0.45, rim: 0.2, wrap: 0.4 }),
    sway: makeLitMaterial(shared, { shininess: 30, specular: 0.25, rim: 0.15, wrap: 0.5, sway: true, swayAmp: 0.35, swaySpeed: 1.3, side: THREE.DoubleSide }),
    glass: new THREE.ShaderMaterial({
      uniforms: { ...shared },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld; varying vec3 vN;
        void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uSunColor, uSkyTop, uSkyHorizon;
        ${airGLSL}
        varying vec3 vWorld; varying vec3 vN;
        void main() {
          vec3 n = normalize(vN);
          vec3 v = normalize(cameraPosition - vWorld);
          float ndv = max(dot(n, v), 0.0);
          float F = 0.08 + 0.92 * pow(1.0 - ndv, 3.0);
          vec3 r = reflect(-v, n);
          vec3 sky = mix(uSkyHorizon, uSkyTop, pow(max(r.y, 0.0), 0.5));
          float spec = pow(max(dot(r, uSunDir), 0.0), 220.0) * 6.0;
          vec3 tint = vec3(0.55, 0.93, 0.98);
          vec3 col = mix(tint * 0.75, sky * 1.15, F) + uSunColor * spec;
          float a = clamp(0.25 + F * 0.7 + spec, 0.0, 1.0);
          col = airFog(col, vWorld);
          gl_FragColor = vec4(col * a, a);
        }
      `,
      premultipliedAlpha: true,
    }),
    lantern: new THREE.ShaderMaterial({
      uniforms: { ...shared },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vWorld;
        void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        ${airGLSL}
        varying vec3 vN; varying vec3 vWorld;
        void main() {
          float pulse = 0.65 + 0.35 * sin(uTime * 2.2);
          vec3 col = vec3(0.45, 1.6, 1.9) * (1.2 + pulse * 1.6);
          gl_FragColor = vec4(airFog(col, vWorld), 1.0);
        }
      `,
      side: THREE.DoubleSide,
    }),
  }));

  return (
    <>
      <mesh geometry={solid} material={mats.solid} />
      <mesh geometry={swaying} material={mats.sway} />
      <mesh geometry={lantern} material={mats.lantern} />
      <mesh geometry={glass} material={mats.glass} renderOrder={5} />
    </>
  );
}

function Boats({ shared }) {
  const mesh = useRef();
  const geometry = useDisposable(() => sailboatGeometry());
  const material = useDisposable(() => makeLitMaterial(shared, { shininess: 80, specular: 0.5, rim: 0.2, wrap: 0.5, side: THREE.DoubleSide }));
  const boats = useMemo(
    () => [
      { x: -120, z: -250, speed: 1.1, phase: 0, heading: 0.35, scale: 1.7 },
      { x: 150, z: -340, speed: -0.8, phase: 2, heading: Math.PI - 0.4, scale: 1.8 },
      { x: 20, z: -520, speed: 0.6, phase: 4, heading: 0.1, scale: 2.0 },
    ],
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    boats.forEach((b, i) => {
      const x = b.x + ((((t * b.speed) % 300) + 450) % 300) - 150;
      dummy.position.set(x, 0.15 * Math.sin(t * 1.1 + b.phase), b.z);
      // Bow (+z) points along the drift direction; gentle pitch/roll on the swell, heeled by the wind.
      const yaw = b.speed > 0 ? Math.PI / 2 + b.heading * 0.3 : -Math.PI / 2 + b.heading * 0.1;
      dummy.rotation.set(0.04 * Math.sin(t * 1.3 + b.phase), yaw, 0.07 * Math.sin(t * 0.9 + b.phase) - 0.08);
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, boats.length]} frustumCulled={false} />;
}

function Gulls({ shared }) {
  const mesh = useRef();
  const count = 7;
  const geometry = useDisposable(() => {
    const g = gullGeometry();
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) phase[i] = i / count + 0.13 * i;
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    return g;
  });
  const material = useDisposable(() => {
    const m = makeLitMaterial(shared, { shininess: 20, specular: 0.2, rim: 0.4, wrap: 0.6, side: THREE.DoubleSide });
    m.defines.FLAP = '';
    return m;
  });
  const gulls = useMemo(() => {
    const rand = makeRandom(91);
    return Array.from({ length: count }, (_, i) => ({
      cx: rand.range(-50, 60),
      cy: rand.range(12, 26),
      cz: rand.range(-120, -70),
      r: rand.range(12, 26),
      w: rand.range(0.14, 0.24) * rand.sign(),
      ph: rand.range(0, 6.28),
      s: rand.range(2.4, 3.0),
    }));
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const ahead = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    gulls.forEach((g, i) => {
      const a = g.ph + t * g.w;
      const y = g.cy + Math.sin(a * 1.7 + g.ph) * 3;
      dummy.position.set(g.cx + Math.cos(a) * g.r, y, g.cz + Math.sin(a) * g.r * 0.6);
      const a2 = a + 0.05 * Math.sign(g.w);
      ahead.set(g.cx + Math.cos(a2) * g.r, g.cy + Math.sin(a2 * 1.7 + g.ph) * 3, g.cz + Math.sin(a2) * g.r * 0.6);
      dummy.lookAt(ahead);
      dummy.rotateZ(-Math.sign(g.w) * 0.32);
      dummy.scale.setScalar(g.s);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} />;
}

export function AboveWorld({ shared, sunDirection }) {
  return (
    <>
      <SkyDome
        top="#0d6fd8"
        horizon="#c4efff"
        bottom="#c4efff"
        exponent={0.42}
        sunDirection={sunDirection}
        sunColor="#fff3d1"
        sunDisc={4}
        sunGlow={0.75}
        sunSize={1.1}
      />
      <CloudField
        count={22}
        center={[0, 90, -1500]}
        area={[4200, 900]}
        heightJitter={40}
        size={[220, 480]}
        speed={3}
        seed={11}
        shade="#a7c9ec"
        fogColor="#c4efff"
        fogNear={700}
        fogFar={3200}
        renderOrder={-500}
      />
      <CloudField
        count={10}
        center={[0, 300, -1100]}
        area={[3000, 500]}
        heightJitter={60}
        size={[160, 300]}
        speed={4.5}
        seed={23}
        shade="#b6d4f2"
        fogColor="#c4efff"
        fogNear={700}
        fogFar={3200}
        opacity={0.9}
        renderOrder={-499}
      />
      <Ocean shared={shared} />
      <Islands shared={shared} />
      <Boats shared={shared} />
      <Gulls shared={shared} />
    </>
  );
}
