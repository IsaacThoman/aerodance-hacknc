import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { dirLL, makeAtmosphere, makeLit, merge, paint, plant, xform } from './materials.js';
import { shadeHex, vgrad } from './props.js';
import { PlanetRoot } from './PlanetRoot.jsx';
import { TARGET_INDEX } from './layout.js';

const R = 1.75;

const SURFACE = /* glsl */ `
  uniform vec3 uPink, uCream, uMint, uHoney;
  void surface(inout Surf s, vec3 V) {
    vec3 n = normalize(vObjPos);
    float ang = atan(n.z, n.x);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float sw = ang * 3.0 + lat * 4.0;
    float st = sin(sw * 2.0);
    float stripe = smoothstep(-0.06, 0.06, st);
    float mint = smoothstep(0.82, 0.9, sin(sw * 2.0 + 3.1416)) ;
    vec3 col = mix(uCream, uPink, stripe);
    col = mix(col, uMint, mint);
    // Honey glaze over the north cap with drips running down.
    float drip = pow(0.5 + 0.5 * sin(ang * 6.0 + 0.5), 6.0) * 0.16 + pow(0.5 + 0.5 * sin(ang * 11.0 + 2.0), 10.0) * 0.08;
    float hv = n.y - (0.72 - drip) + 0.012 * snoise(n * 6.0);
    float honey = smoothstep(0.0, 0.018, hv);
    float honeyDeep = smoothstep(0.1, 0.5, hv);
    vec3 hcol = mix(uHoney, uHoney * vec3(0.75, 0.5, 0.25), honeyDeep * 0.6);
    s.albedo = mix(col, hcol, honey);
    s.gloss = mix(0.9, 1.8, honey);
    s.shine = mix(50.0, 90.0, honey);
    s.emit = mix(0.06, 0.16, honey);
    // A little bulge highlight at the drip edges.
    s.add = uHoney * smoothstep(0.0, 0.02, hv) * (1.0 - smoothstep(0.02, 0.06, hv)) * 0.25;
    // Translucent honey: a warm inner glow toward the limb.
    float hf = clamp(1.0 - dot(s.N, V), 0.0, 1.0);
    s.add += vec3(1.0, 0.55, 0.1) * honey * hf * hf * 0.35;
  }
`;

const candyColor = (a, b, k = 40) => {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return (x, y, z) => (Math.sin((x * 0.7 + y + z * 0.7) * k) > 0 ? ca : cb);
};

function lollipop(rand, colors) {
  const h = rand.range(0.45, 0.65);
  const parts = [xform(paint(new THREE.CylinderGeometry(0.018, 0.018, h, 6), '#fff8f0'), { p: [0, h / 2, 0] })];
  const rings = [[0.16, colors[0]], [0.105, colors[1]], [0.05, colors[0]]];
  for (const [r, c] of rings) {
    parts.push(xform(paint(new THREE.TorusGeometry(r, 0.032, 8, 28), vgrad(shadeHex(c, 0.75), c, -0.15, 0.15), 0.2), { p: [0, h + 0.15, 0] }));
  }
  parts.push(xform(paint(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 24), '#ffffff', 0.15), { p: [0, h + 0.15, 0], r: [Math.PI / 2, 0, 0] }));
  return parts;
}

function gumdrop(rand) {
  const c = rand.pick(['#4fe08a', '#ff8a3d', '#b46bff', '#ff4f7a', '#ffd84a', '#4fc8ff']);
  const r = rand.range(0.09, 0.14);
  const g = new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  return [xform(paint(g, vgrad(shadeHex(c, 0.7), shadeHex(c, 1.25), 0, r), 0.3), { s: [1, 1.15, 1] })];
}

function candyCane() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.35, 0),
    new THREE.Vector3(0.02, 0.55, 0),
    new THREE.Vector3(0.1, 0.64, 0),
    new THREE.Vector3(0.19, 0.6, 0),
    new THREE.Vector3(0.22, 0.5, 0),
  ]);
  return [paint(new THREE.TubeGeometry(curve, 32, 0.035, 8), candyColor('#ff3b5c', '#ffffff', 30))];
}

function cupcake() {
  const parts = [];
  const paper = new THREE.CylinderGeometry(0.16, 0.12, 0.16, 16, 1);
  parts.push(xform(paint(paper, (x, y, z) => (Math.sin(Math.atan2(z, x) * 16) > 0 ? new THREE.Color('#7fd8ff') : new THREE.Color('#c9f0ff'))), { p: [0, 0.08, 0] }));
  for (let i = 0; i < 3; i++) {
    const r = 0.17 - i * 0.045;
    parts.push(xform(paint(new THREE.SphereGeometry(r, 16, 8), vgrad('#ffb3d9', '#fff0f8', -r, r), 0.1), { p: [0, 0.18 + i * 0.075, 0], s: [1, 0.6, 1] }));
  }
  parts.push(xform(paint(new THREE.SphereGeometry(0.045, 10, 8), '#ff2f5a', 0.35), { p: [0, 0.39, 0] }));
  return parts;
}

function beehive() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const r = 0.2 - Math.pow(i / 4, 1.6) * 0.14;
    parts.push(xform(paint(new THREE.TorusGeometry(r, 0.055, 8, 20), vgrad('#d98a1e', '#ffd36b', -0.05, 0.05), 0.15), { p: [0, 0.05 + i * 0.085, 0], r: [Math.PI / 2, 0, 0] }));
  }
  parts.push(xform(paint(new THREE.SphereGeometry(0.17, 12, 8), '#f2a832'), { p: [0, 0.18, 0], s: [1, 1.2, 1] }));
  parts.push(xform(paint(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10), '#4a2a10'), { p: [0, 0.12, 0.2], r: [Math.PI / 2, 0, 0] }));
  return parts;
}

function buildDecor() {
  const rand = makeRandom(77);
  const parts = [];
  const add = (list, dir, spin = rand.range(0, 6.28), sink = 0.02) => list.forEach((g) => parts.push(plant(g, R, dir, spin, sink)));
  add(beehive(), [0, 1, 0], 0.4, 0.03);
  add(lollipop(rand, ['#ff5aa8', '#ffffff']), dirLL(28, 30));
  add(lollipop(rand, ['#4fd8ff', '#ffffff']), dirLL(-8, 150));
  add(lollipop(rand, ['#ffd84a', '#ff7a3d']), dirLL(14, 260));
  add(candyCane(), dirLL(6, 80), 1.2);
  add(candyCane(), dirLL(-20, 215), 3.0);
  add(cupcake(), dirLL(-28, 20), 0);
  add(cupcake(), dirLL(-2, 320), 0);
  for (let i = 0; i < 18; i++) add(gumdrop(rand), dirLL(rand.range(-70, 35), rand.range(0, 360)), 0, 0.01);
  // Sprinkles stuck to the honey.
  for (let i = 0; i < 26; i++) {
    const c = rand.pick(['#ffffff', '#ff6fb1', '#7fe3ff', '#b5ff7a', '#ffe066']);
    add([xform(paint(new THREE.CapsuleGeometry(0.012, 0.045, 2, 4), c, 0.3), { p: [0, 0.008, 0], r: [Math.PI / 2, rand.range(0, 3), 0] })], dirLL(rand.range(42, 82), rand.range(0, 360)), 0, 0.0);
  }
  return merge(parts);
}

function bee() {
  const parts = [];
  parts.push(xform(paint(new THREE.SphereGeometry(0.06, 10, 8), (x, y, z) => (Math.sin(z * 120) > 0.2 ? new THREE.Color('#2a1a10') : new THREE.Color('#ffd23a'))), { s: [0.85, 0.85, 1.25] }));
  parts.push(xform(paint(new THREE.SphereGeometry(0.045, 8, 6), '#ffffff', 0.6), { p: [0.045, 0.05, -0.01], s: [1, 0.3, 0.6], r: [0, 0, 0.5] }));
  parts.push(xform(paint(new THREE.SphereGeometry(0.045, 8, 6), '#ffffff', 0.6), { p: [-0.045, 0.05, -0.01], s: [1, 0.3, 0.6], r: [0, 0, -0.5] }));
  return merge(parts);
}

function Bees({ material }) {
  const mesh = useRef();
  const geometry = useDisposable(bee);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), prev: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1) }), []);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let i = 0; i < 3; i++) {
      const a = t * (0.9 + i * 0.2) + i * 2.1;
      const r = R + 0.45 + Math.sin(t * 2.3 + i) * 0.08;
      const y = 0.9 + Math.sin(a * 2.0 + i) * 0.35;
      tmp.p.set(Math.cos(a) * r * Math.cos(y * 0.5), y + Math.sin(t * 9 + i) * 0.03, Math.sin(a) * r * Math.cos(y * 0.5));
      tmp.e.set(0, -a, 0);
      tmp.q.setFromEuler(tmp.e);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      mesh.current.setMatrixAt(i, tmp.m);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, 3]} frustumCulled={false} />;
}

function DonutMoon({ material }) {
  const ref = useRef();
  const geometry = useDisposable(() => {
    const g = new THREE.TorusGeometry(0.26, 0.12, 12, 28);
    g.rotateX(Math.PI / 2);
    const sprinkles = ['#ffffff', '#7fe3ff', '#ffe066', '#b5ff7a'];
    return paint(g, (x, y, z) => {
      if (y > 0.02) {
        const h = Math.sin(x * 91 + z * 57) * Math.sin(x * 37 - z * 83);
        if (h > 0.85) return new THREE.Color(sprinkles[Math.abs(Math.floor((x * 13 + z * 7) * 10)) % 4]);
        return new THREE.Color('#ff8cc6');
      }
      return new THREE.Color('#e0a560');
    }, 0.12);
  });
  useFrame((state) => {
    const a = state.clock.elapsedTime * 0.35 + 0.8;
    ref.current.position.set(Math.cos(a) * 3.1, Math.sin(a) * 1.1, Math.sin(a) * 2.9);
    ref.current.rotation.set(0.5 + Math.sin(a) * 0.2, a * 0.7, 0.3);
  });
  return <mesh ref={ref} geometry={geometry} material={material} />;
}

export default function Candy({ state }) {
  const index = TARGET_INDEX.songs;
  const decor = useDisposable(buildDecor);
  const planetMat = useDisposable(() =>
    makeLit({
      surface: SURFACE,
      painted: false,
      withNoise: true,
      rim: '#ffb3e6',
      rimStrength: 0.6,
      wrap: 0.2,
      uniforms: {
        uPink: { value: new THREE.Color('#ff5ea8') },
        uCream: { value: new THREE.Color('#fff2e2') },
        uMint: { value: new THREE.Color('#7ff0d0') },
        uHoney: { value: new THREE.Color('#ffb21f') },
      },
    }),
  );
  const decorMat = useDisposable(() => makeLit({ rim: '#ffd0f0', rimStrength: 0.6, gloss: 1.1, shine: 60 }));
  const atmo = useDisposable(() => makeAtmosphere({ color: '#ff8ad0', inner: R, outer: R * 1.28, strength: 0.32, power: 2.8 }));
  return (
    <PlanetRoot
      index={index}
      state={state}
      tilt={[0.38, 0, 0.2]}
      spin={0.09}
      materials={[planetMat, decorMat]}
      still={
        <>
          <mesh material={atmo} scale={R * 1.28}>
            <icosahedronGeometry args={[1, 8]} />
          </mesh>
          <DonutMoon material={decorMat} />
        </>
      }
    >
      <mesh material={planetMat}>
        <icosahedronGeometry args={[R, 18]} />
      </mesh>
      <mesh geometry={decor} material={decorMat} />
      <Bees material={decorMat} />
    </PlanetRoot>
  );
}
