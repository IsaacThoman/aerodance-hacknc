import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { dirLL, makeAtmosphere, makeGlass, makeLit, merge, paint, plant, xform } from './materials.js';
import { shadeHex, vgrad } from './props.js';
import { PlanetRoot } from './PlanetRoot.jsx';
import { TARGET_INDEX } from './layout.js';

const R = 1.6;
const DECK = 0.14;
const DOME = 0.74;

const SURFACE = /* glsl */ `
  uniform vec3 uStone, uStoneDark, uMoss, uVein;
  void surface(inout Surf s, vec3 V) {
    vec3 n = normalize(vObjPos);
    float m = fbm(n * 2.0);
    float c = snoise(n * 3.2 + 3.0);
    float crater = smoothstep(0.45, 0.6, c) - 0.8 * smoothstep(0.62, 0.85, c);
    float strata = 0.5 + 0.5 * sin(n.y * 26.0 + m * 4.0);
    vec3 stone = mix(uStoneDark, uStone, smoothstep(-0.5, 0.5, m + 0.3 * n.y)) * (1.0 - 0.16 * crater) * (0.92 + 0.08 * strata);
    float edgeN = fbm(n * 6.0 + 2.0);
    float moss = smoothstep(0.66, 0.69, n.y + 0.1 * edgeN);
    vec3 grass = mix(uMoss * 0.72, uMoss * 1.08, smoothstep(-0.3, 0.4, fbm(n * 4.5)));
    // Soft shadowed lip where the grass meets the rock.
    stone *= 1.0 - 0.25 * smoothstep(0.55, 0.68, n.y + 0.1 * edgeN) * (1.0 - moss);
    stone = mix(stone, grass, moss);
    float vein = 1.0 - smoothstep(0.0, 0.022, abs(snoise(n * 2.2 + 9.0)));
    vein *= (1.0 - moss) * smoothstep(0.3, -0.2, n.y);
    s.albedo = mix(stone, uVein, vein);
    s.emit = vein * (1.1 + 0.6 * sin(uTime * 1.7 + n.x * 6.0 + n.z * 4.0)) * (1.0 + uFocus);
    s.gloss = 0.25;
    s.shine = 18.0;
  }
`;

// Decor emission > 9 = blinking beacon.
const DECOR_SURFACE = /* glsl */ `
  void surface(inout Surf s, vec3 V) {
    if (s.emit > 9.0) s.emit = (s.emit - 10.0) * (0.15 + 0.85 * step(0.55, fract(uTime * 0.8)));
  }
`;

function buildDecor() {
  const rand = makeRandom(9);
  const parts = [];
  const top = [];
  // Deck.
  top.push(xform(paint(new THREE.CylinderGeometry(0.9, 0.8, DECK, 32), vgrad('#b9b2de', '#ffffff', -0.07, 0.07)), { p: [0, DECK / 2, 0] }));
  top.push(xform(paint(new THREE.TorusGeometry(0.895, 0.028, 6, 48), '#ffcf5a', 0.35), { p: [0, DECK, 0], r: [Math.PI / 2, 0, 0] }));
  // Warm lamp glowing inside the dome.
  top.push(xform(paint(new THREE.IcosahedronGeometry(0.07, 1), '#ffe2a0', 3.0), { p: [-0.32, DECK + 0.08, 0.2] }));
  top.push(xform(paint(new THREE.TorusGeometry(DOME + 0.02, 0.035, 6, 40), '#ffcf5a', 0.25), { p: [0, DECK + 0.01, 0], r: [Math.PI / 2, 0, 0] }));
  // Dome ribs and finial.
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.TorusGeometry(DOME + 0.004, 0.011, 4, 36, Math.PI);
    rib.rotateY((i / 4) * Math.PI);
    top.push(xform(paint(rib, '#ffe18a', 0.25), { p: [0, DECK, 0] }));
  }
  top.push(xform(paint(new THREE.IcosahedronGeometry(0.05, 1), '#ffe18a', 0.8), { p: [0, DECK + DOME + 0.04, 0] }));
  // Lantern posts around the rim.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const x = Math.cos(a) * 0.84;
    const z = Math.sin(a) * 0.84;
    top.push(xform(paint(new THREE.CylinderGeometry(0.012, 0.016, 0.16, 5), '#6f68a8'), { p: [x, DECK + 0.08, z] }));
    top.push(xform(paint(new THREE.IcosahedronGeometry(0.03, 1), i % 2 ? '#ffe9a6' : '#a6f0ff', 3), { p: [x, DECK + 0.18, z] }));
  }
  // Antenna with a blinking beacon.
  top.push(xform(paint(new THREE.CylinderGeometry(0.008, 0.012, 0.45, 5), '#d9d4f5'), { p: [0.66, DECK + 0.22, -0.4] }));
  top.push(xform(paint(new THREE.IcosahedronGeometry(0.03, 1), '#ff5a7a', 13.5), { p: [0.66, DECK + 0.46, -0.4] }));
  for (const g of top) parts.push(plant(g, R, [0, 1, 0], 0, 0.06));

  // Glowing crystal clusters on the rock.
  const crystal = (h, c) => {
    const g = new THREE.OctahedronGeometry(0.06, 0);
    g.scale(1, h, 1);
    g.translate(0, 0.06 * h * 0.6, 0);
    return paint(g, vgrad(shadeHex(c, 0.7), shadeHex(c, 1.3), 0, 0.06 * h), 0.9);
  };
  for (let k = 0; k < 7; k++) {
    const dir = dirLL(rand.range(-70, 25), rand.range(0, 360));
    const c = rand.pick(['#c58bff', '#ffd36b', '#8fd8ff']);
    for (let i = 0; i < 3; i++) {
      const g = crystal(rand.range(2, 4), c);
      g.rotateZ(rand.range(-0.5, 0.5));
      g.rotateX(rand.range(-0.5, 0.5));
      parts.push(plant(g, R, dir, rand.range(0, 6), 0.02));
    }
  }
  // Little stair of floating stepping stones.
  for (let i = 0; i < 4; i++) {
    parts.push(plant(xform(paint(new THREE.CylinderGeometry(0.08, 0.07, 0.04, 8), '#ded8ff'), { p: [0, 0.02, 0] }), R, dirLL(58 - i * 9, 150), 0, -0.01));
  }
  return merge(parts);
}

function buildTelescope() {
  const parts = [];
  parts.push(xform(paint(new THREE.CylinderGeometry(0.05, 0.08, 0.2, 10), '#5f58a0'), { p: [0, 0.1, 0] }));
  parts.push(xform(paint(new THREE.BoxGeometry(0.16, 0.05, 0.05), '#8a82c8'), { p: [0, 0.22, 0] }));
  const tube = [];
  tube.push(xform(paint(new THREE.CylinderGeometry(0.065, 0.05, 0.6, 16), vgrad('#e9e6ff', '#ffffff', -0.3, 0.3)), { p: [0, 0.1, 0] }));
  tube.push(xform(paint(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 16), '#ffcf5a', 0.3), { p: [0, 0.38, 0] }));
  tube.push(xform(paint(new THREE.CylinderGeometry(0.068, 0.068, 0.03, 16), '#ffcf5a', 0.3), { p: [0, -0.06, 0] }));
  tube.push(xform(paint(new THREE.CylinderGeometry(0.058, 0.058, 0.012, 16), '#7ff2ff', 2.2), { p: [0, 0.405, 0] }));
  tube.push(xform(paint(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 8), '#3d3770'), { p: [0, -0.22, 0] }));
  for (const g of tube) {
    g.rotateX(-0.85);
    g.translate(0, 0.25, 0);
    parts.push(g);
  }
  return merge(parts);
}

function Satellite({ material }) {
  const ref = useRef();
  const geometry = useDisposable(() =>
    merge([
      xform(paint(new THREE.BoxGeometry(0.12, 0.12, 0.16), vgrad('#c98d2a', '#ffd36b', -0.06, 0.06), 0.1)),
      xform(paint(new THREE.BoxGeometry(0.34, 0.01, 0.12), (x) => (Math.abs((x * 30) % 1) < 0.12 ? new THREE.Color('#9fd8ff') : new THREE.Color('#2b5fd9')), 0.35), { p: [0.25, 0, 0] }),
      xform(paint(new THREE.BoxGeometry(0.34, 0.01, 0.12), (x) => (Math.abs((x * 30) % 1) < 0.12 ? new THREE.Color('#9fd8ff') : new THREE.Color('#2b5fd9')), 0.35), { p: [-0.25, 0, 0] }),
      xform(paint(new THREE.ConeGeometry(0.06, 0.05, 12, 1, true), '#ffffff'), { p: [0, 0, 0.11], r: [-Math.PI / 2, 0, 0] }),
      xform(paint(new THREE.IcosahedronGeometry(0.018, 0), '#7fffd0', 3), { p: [0, 0.08, 0] }),
    ]),
  );
  useFrame((state) => {
    const a = state.clock.elapsedTime * 0.42 + 2;
    ref.current.position.set(Math.cos(a) * 2.5, 0.6 + Math.sin(a) * 0.9, Math.sin(a) * 2.5);
    ref.current.rotation.set(a * 0.3, -a, 0.4);
  });
  return <mesh ref={ref} geometry={geometry} material={material} />;
}

export default function Observatory({ state }) {
  const index = TARGET_INDEX.options;
  const decor = useDisposable(buildDecor);
  const telescope = useDisposable(buildTelescope);
  const planetMat = useDisposable(() =>
    makeLit({
      surface: SURFACE,
      painted: false,
      withNoise: true,
      rim: '#ffcf9a',
      rimStrength: 0.55,
      wrap: 0.2,
      uniforms: {
        uStone: { value: new THREE.Color('#c9b4f0') },
        uStoneDark: { value: new THREE.Color('#6a52b8') },
        uMoss: { value: new THREE.Color('#62cf72') },
        uVein: { value: new THREE.Color('#ffc65a') },
      },
    }),
  );
  const decorMat = useDisposable(() => makeLit({ surface: DECOR_SURFACE, rim: '#ffe6c2', rimStrength: 0.6, gloss: 0.8, shine: 40 }));
  const glassMat = useDisposable(() => makeGlass({ tint: '#a8e8ff', base: 0.07, edge: 0.8 }));
  const atmo = useDisposable(() => makeAtmosphere({ color: '#ffb36b', inner: R, outer: R * 1.3, strength: 0.3, power: 2.8 }));
  const scope = useRef();
  return (
    <PlanetRoot
      index={index}
      state={state}
      tilt={[0.45, 0, -0.28]}
      spin={0.07}
      materials={[planetMat, decorMat, glassMat]}
      onFrame={(t, dt, focus) => {
        scope.current.rotation.y = t * 0.25 + Math.sin(t * 0.7) * 0.6;
        scope.current.rotation.x = Math.sin(t * 0.5) * 0.15;
      }}
      still={
        <>
          <mesh material={atmo} scale={R * 1.3}>
            <icosahedronGeometry args={[1, 8]} />
          </mesh>
          <Satellite material={decorMat} />
        </>
      }
    >
      <mesh material={planetMat}>
        <icosahedronGeometry args={[R, 16]} />
      </mesh>
      <mesh geometry={decor} material={decorMat} />
      <group ref={scope} position={[0, R - 0.06 + DECK, 0]} scale={1.2}>
        <mesh geometry={telescope} material={decorMat} />
      </group>
      <mesh material={glassMat} position={[0, R - 0.06 + DECK, 0]} renderOrder={5}>
        <sphereGeometry args={[DOME, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
    </PlanetRoot>
  );
}
