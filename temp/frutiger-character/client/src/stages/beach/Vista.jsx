import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { WATER_Y, world } from './palette.js';
import { makeLitMaterial, patchMaterial } from './shaders.js';
import { blob, color, finalize, merge, place } from './geometry.js';
import {
  cruiseShipGeometry,
  lighthouseGeometry,
  palmGeometry,
  rotorGeometry,
  sailboatGeometry,
  turbineTowerGeometry,
  volcanoGeometry,
} from './props.js';

const ss = THREE.MathUtils.smoothstep;

const LIGHTHOUSE = { x: -23.5, y: 4.2, z: -84, scale: 0.9 };
const LAMP_Y = LIGHTHOUSE.y + 12.3 * LIGHTHOUSE.scale;
const TURBINES = [
  { x: 55, z: -262, y: 8.5, h: 22 },
  { x: 82, z: -266, y: 10, h: 22 },
  { x: 110, z: -258, y: 8, h: 22 },
];
const VOLCANO = { x: 235, z: -800 };

function rockPaint(seed) {
  const a = color('#b9a48e');
  const b = color('#8a766a');
  const moss = color('#7fbf5a');
  return (p, n, out) => {
    out.copy(b).lerp(a, ss(n.y, -0.3, 0.6) * 0.8 + (Math.sin(p.x * 3 + p.z * 2 + seed) * 0.5 + 0.5) * 0.2);
    if (n.y > 0.75) out.lerp(moss, 0.6);
  };
}

function bushes(rand, cx, cz, baseY, spread, count, size, seedBase) {
  const parts = [];
  const greens = ['#3fb84a', '#5fcf4a', '#2f9e46', '#86dc58'];
  for (let i = 0; i < count; i++) {
    const a = rand.range(0, Math.PI * 2);
    const d = Math.sqrt(rand.next()) * spread;
    const s = rand.range(size[0], size[1]);
    const g = blob({ radius: s, detail: 2, squash: [1, 0.8, 1], amount: 0.25, freq: 1.8, seed: seedBase + i });
    place(g, { position: [cx + Math.cos(a) * d, baseY(cx + Math.cos(a) * d, cz + Math.sin(a) * d) + s * 0.3, cz + Math.sin(a) * d] });
    const c1 = color(rand.pick(greens));
    const top = c1.clone().lerp(color('#eaff9a'), 0.35);
    parts.push(finalize(g, { paint: (p, n, out) => out.copy(c1).multiplyScalar(0.55).lerp(c1, ss(n.y, -0.4, 0.4)).lerp(top, ss(n.y, 0.6, 1) * 0.6) }));
  }
  return parts;
}

/** Headlands, islands, the volcano, lighthouse, resort and turbine towers: one hazy mesh. */
function Landforms() {
  const { solid, far, sway } = useDisposable(() => {
    const parts = [];
    const farParts = [];
    const swayParts = [];
    const rand = makeRandom(71);
    // Lighthouse islet: tumbled rocks capped with grass, off the tip of the left arm.
    const core = blob({ radius: 6.5, detail: 3, squash: [1.3, 0.65, 1.1], amount: 0.25, freq: 1.5, seed: 499 });
    place(core, { position: [LIGHTHOUSE.x, WATER_Y + 0.4, LIGHTHOUSE.z] });
    parts.push(finalize(core, { paint: rockPaint(0) }));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand.range(-0.2, 0.2);
      const r = rand.range(6, 10);
      const s = rand.range(1.8, 3.6);
      const g = blob({ radius: s, detail: 2, squash: [1.2, 0.8, 1], amount: 0.3, freq: 1.6, seed: 500 + i });
      place(g, { position: [LIGHTHOUSE.x + Math.cos(a) * r, WATER_Y + s * 0.3, LIGHTHOUSE.z + Math.sin(a) * r * 0.8], rotation: [0, rand.range(0, 6), 0] });
      parts.push(finalize(g, { paint: rockPaint(i + 1) }));
    }
    // Stepping-stone rocks trailing back to the end of the left arm.
    for (let i = 0; i < 6; i++) {
      const s = rand.range(1.2, 2.4);
      const g = blob({ radius: s, detail: 2, squash: [1.3, 0.7, 1], amount: 0.3, freq: 1.7, seed: 540 + i });
      place(g, { position: [-25 + i * 1.1 + rand.range(-1, 1), WATER_Y + s * 0.2, -44 - i * 6.5], rotation: [0, rand.range(0, 6), 0] });
      parts.push(finalize(g, { paint: rockPaint(i + 20) }));
    }
    const cap = blob({ radius: 5.6, detail: 3, squash: [1.1, 0.28, 0.95], amount: 0.15, seed: 520 });
    place(cap, { position: [LIGHTHOUSE.x + 0.4, LIGHTHOUSE.y - 0.5, LIGHTHOUSE.z + 0.6] });
    parts.push(finalize(cap, { paint: (p, n, out) => out.set('#5fc252').lerp(color('#b8ec72'), ss(n.y, 0.5, 1) * 0.5) }));
    for (const g of lighthouseGeometry()) parts.push(place(g, { position: [LIGHTHOUSE.x, LIGHTHOUSE.y, LIGHTHOUSE.z], scale: LIGHTHOUSE.scale, rotation: [0, 0.6, 0] }));

    // Right headland: a rounded green hill.
    const hill = blob({ radius: 15, detail: 3, squash: [1.25, 0.5, 0.9], amount: 0.14, seed: 610, flatBottom: true });
    place(hill, { position: [44, WATER_Y - 1.2, -72] });
    parts.push(finalize(hill, { paint: (p, n, out) => out.set(p.y < 0.4 ? '#efd7a6' : '#4fb84e').lerp(color('#a6e46a'), ss(n.y, 0.6, 1) * 0.45) }));
    const hillY = (x, z) => WATER_Y - 1.2 + 7.5 * Math.max(0, 1 - ((x - 44) / 18.5) ** 2 - ((z + 72) / 13.5) ** 2) ** 0.5;
    parts.push(...bushes(rand, 44, -71, hillY, 12, 12, [1.4, 2.6], 640));

    // Wind turbine ridge on a far headland.
    const ridge = blob({ radius: 55, detail: 3, squash: [1.3, 0.22, 0.5], amount: 0.2, freq: 1.3, seed: 700, flatBottom: true });
    place(ridge, { position: [84, WATER_Y - 2, -272] });
    parts.push(finalize(ridge, { paint: (p, n, out) => out.set(p.y < 1 ? '#e9d2a2' : '#5aa85a').lerp(color('#9fd879'), ss(n.y, 0.7, 1) * 0.5) }));
    for (const t of TURBINES) for (const g of turbineTowerGeometry(t.h)) parts.push(place(g, { position: [t.x, t.y, t.z], rotation: [0, 0.25, 0] }));

    // Islands: a palm islet near the sun's path, a rocky islet, a low far one.
    const islets = [
      { x: 270, z: -560, r: 30, h: 7, palms: 4 },
      { x: -128, z: -330, r: 10, h: 5, palms: 1 },
      { x: -420, z: -1050, r: 80, h: 18, palms: 0 },
    ];
    islets.forEach((isl, k) => {
      const g = blob({ radius: 1, detail: 3, squash: [isl.r, isl.h, isl.r * 0.6], amount: 0.2, freq: 2, seed: 800 + k, flatBottom: true });
      place(g, { position: [isl.x, WATER_Y - 0.6, isl.z] });
      farParts.push(finalize(g, { paint: (p, n, out) => out.set(p.y < WATER_Y + 1 ? '#f2dcae' : '#4fae5c').lerp(color('#a8e07a'), ss(n.y, 0.6, 1) * 0.4) }));
      for (let i = 0; i < isl.palms; i++) {
        const px = isl.x + (i - isl.palms / 2) * isl.r * 0.35;
        for (const pg of palmGeometry({ height: 14, lean: 3, heading: rand.range(0, 6), seed: 900 + i + k * 10, fronds: 8, frondLength: 6 })) {
          swayParts.push(place(pg, { position: [px, WATER_Y + isl.h * 0.6, isl.z] }));
        }
      }
    });

    const volcano = volcanoGeometry({ radius: 150, height: 105 });
    place(volcano, { position: [VOLCANO.x, WATER_Y - 2, VOLCANO.z] });
    farParts.push(volcano);
    return { solid: merge(parts), far: merge(farParts), sway: merge(swayParts) };
  });
  const mats = useDisposable(() => ({
    solid: patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), { key: 'land' }),
    // Far islands sit in the sunset's shadow side: dusky, cool silhouettes.
    far: patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, color: '#7a6aa8', roughness: 0.9 }), { key: 'far', ibl: 0.35, haze: 0.6 }),
    sway: patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), { sway: 0.5, key: 'land-sway' }),
  }));
  return (
    <>
      <mesh geometry={solid} material={mats.solid} />
      <mesh geometry={far} material={mats.far} />
      <mesh geometry={sway} material={mats.sway} />
    </>
  );
}

/** Lighthouse lantern and its slowly turning beam. */
function LighthouseBeam() {
  const beam = useRef();
  const geometry = useDisposable(() => {
    const g = new THREE.ConeGeometry(4.5, 70, 24, 1, true);
    g.translate(0, -35, 0);
    g.rotateZ(Math.PI / 2);
    return g;
  });
  const mats = useDisposable(() => ({
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff1c8').multiplyScalar(4) }),
    beam: new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying float vAlong;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          vAlong = position.x / 70.0;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlong;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          float ndv = abs(dot(normalize(vN), normalize(vView)));
          float a = pow(ndv, 2.0) * (1.0 - smoothstep(0.0, 1.0, vAlong)) * smoothstep(0.0, 0.04, vAlong);
          gl_FragColor = vec4(vec3(1.0, 0.9, 0.65) * a * 0.6, 1.0);
        }
      `,
    }),
  }));
  useFrame(() => {
    beam.current.rotation.y = world.uTime.value * 0.45;
  });
  return (
    <group position={[LIGHTHOUSE.x, LAMP_Y, LIGHTHOUSE.z]}>
      <mesh material={mats.lamp}>
        <cylinderGeometry args={[0.75, 0.75, 1.3, 12]} />
      </mesh>
      <group ref={beam}>
        <mesh geometry={geometry} material={mats.beam} renderOrder={6} />
        <mesh geometry={geometry} material={mats.beam} rotation={[0, Math.PI, 0]} renderOrder={6} />
      </group>
    </group>
  );
}

function Rotors() {
  const mesh = useRef();
  const geometry = useDisposable(() => rotorGeometry(9));
  const material = useDisposable(() => makeLitMaterial({ shininess: 50, specular: 0.4, side: THREE.DoubleSide }));
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const t = world.uTime.value;
    TURBINES.forEach((tb, i) => {
      dummy.position.set(tb.x + Math.sin(0.25) * 1.0, tb.y + tb.h, tb.z + Math.cos(0.25) * 1.0);
      dummy.rotation.set(0, 0.25, t * 0.9 + i * 1.3);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, TURBINES.length]} frustumCulled={false} />;
}

const SAILBOATS = [
  { x: -30, z: -170, speed: 0.9, scale: 1.4 },
  { x: 55, z: -260, speed: -0.7, scale: 1.8 },
  { x: -120, z: -380, speed: 0.6, scale: 2.2 },
  { x: 90, z: -120, speed: -0.5, scale: 1.2 },
];

function Sailboats() {
  const mesh = useRef();
  const geometry = useDisposable(() => sailboatGeometry());
  const material = useDisposable(() => makeLitMaterial({ shininess: 60, specular: 0.4, rim: 0.6, side: THREE.DoubleSide }));
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const t = world.uTime.value;
    SAILBOATS.forEach((b, i) => {
      const span = 260;
      const x = b.x + ((((t * b.speed) % span) + span * 1.5) % span) - span / 2;
      dummy.position.set(x, WATER_Y + 0.1 * Math.sin(t * 1.1 + i * 2), b.z);
      dummy.rotation.set(0.04 * Math.sin(t * 1.3 + i), b.speed > 0 ? Math.PI / 2 : -Math.PI / 2, 0.06 * Math.sin(t * 0.9 + i * 1.7) - 0.08 * Math.sign(b.speed));
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, SAILBOATS.length]} frustumCulled={false} />;
}

/** White cruise liner gliding across the horizon with its decks lit up. */
function CruiseShip() {
  const group = useRef();
  const { body, windows } = useDisposable(() => cruiseShipGeometry());
  const mats = useDisposable(() => ({
    body: makeLitMaterial({ shininess: 60, specular: 0.3, rim: 0.4 }),
    windows: makeLitMaterial({ emissive: '#ffffff', emissiveIntensity: 2.2, specular: 0, rim: 0 }),
  }));
  useFrame(() => {
    const t = world.uTime.value;
    group.current.position.set(-170 + ((t * 1.4) % 420), WATER_Y - 0.6 + Math.sin(t * 0.4) * 0.15, -690);
  });
  return (
    <group ref={group} rotation={[0, -0.06, 0]}>
      <mesh geometry={body} material={mats.body} />
      <mesh geometry={windows} material={mats.windows} />
    </group>
  );
}

/** Lazy steam plume above the volcano's crater. */
function VolcanoSteam() {
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: world.uTime },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            mv.xy += (position.xy + vec2(0.0, 0.5)) * vec2(70.0, 90.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            vec2 p = vUv - vec2(0.5, 0.0);
            float drift = p.y * p.y * 0.5;
            p.x -= drift + sin(p.y * 6.0 - uTime * 0.3) * 0.03 * p.y;
            float w = 0.06 + p.y * 0.3;
            float a = exp(-p.x * p.x / (w * w)) * smoothstep(0.0, 0.1, p.y) * (1.0 - smoothstep(0.4, 1.0, p.y));
            gl_FragColor = vec4(vec3(1.0, 0.86, 0.85), a * 0.4);
          }
        `,
      }),
  );
  return (
    <mesh material={material} position={[VOLCANO.x, WATER_Y + 100, VOLCANO.z]} frustumCulled={false} renderOrder={-400}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

export function Vista() {
  return (
    <>
      <Landforms />
      <LighthouseBeam />
      <Rotors />
      <Sailboats />
      <CruiseShip />
      <VolcanoSteam />
    </>
  );
}
