import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { dirLL, makeAtmosphere, makeLit, merge, paint, plant, xform } from './materials.js';
import { palmTree, vgrad } from './props.js';
import { PlanetRoot } from './PlanetRoot.jsx';
import { Moon } from './Moon.jsx';
import { TARGET_INDEX } from './layout.js';

const R = 2.35;
const ISLAND = new THREE.Vector3(...dirLL(24, -25)).normalize();

const SURFACE = /* glsl */ `
  uniform vec3 uDeep, uShallow, uIce, uSand, uIsland;
  void surface(inout Surf s, vec3 V) {
    vec3 n = normalize(vObjPos);
    float t = uTime;
    vec3 wn = vec3(snoise(n * 6.0 + vec3(t * 0.12, 0.0, 0.0)), snoise(n * 6.0 + vec3(4.0, -t * 0.1, 0.0)), snoise(n * 6.0 + vec3(8.0, 0.0, t * 0.1)));
    float depth = fbm(n * 1.5 + 1.0);
    float w1 = snoise(n * 5.0 + vec3(t * 0.08, 0.0, t * 0.05));
    vec3 water = mix(uDeep, uShallow, clamp(smoothstep(0.0, 0.65, depth) + 0.12 * w1, 0.0, 1.0));
    float caus = pow(max(1.0 - abs(snoise(n * 4.0 + vec3(0.0, t * 0.12, t * 0.07))), 0.0), 6.0);
    water += vec3(0.25, 0.85, 1.0) * caus * 0.14;

    float isl = dot(n, uIsland) + 0.025 * snoise(n * 12.0);
    float lagoon = smoothstep(0.9, 0.955, isl);
    water = mix(water, vec3(0.2, 0.95, 0.85), lagoon * 0.75);

    float lat = abs(n.y) + 0.07 * fbm(n * 4.0 + 2.0);
    float ice = smoothstep(0.88, 0.895, lat);
    float iceEdge = smoothstep(0.84, 0.88, lat) * (1.0 - ice);

    s.N = normalize(s.N + wn * 0.035 * (1.0 - ice));
    s.albedo = mix(water, vec3(0.75, 0.95, 1.0), iceEdge * 0.6);
    s.gloss = 1.5;
    s.shine = 110.0;
    s.emit = 0.1;
    vec3 Rf = reflect(-V, s.N);
    vec3 env = mix(vec3(0.02, 0.06, 0.2), vec3(0.45, 0.8, 1.0), smoothstep(-0.3, 0.9, Rf.y));
    float fres = pow(clamp(1.0 - dot(s.N, V), 0.0, 1.0), 3.0);
    s.add = env * fres * 0.3 * (1.0 - ice);

    vec3 iceCol = mix(uIce, vec3(0.92, 0.97, 1.0), smoothstep(0.92, 1.0, lat));
    s.albedo = mix(s.albedo, iceCol, ice);
    s.gloss = mix(s.gloss, 0.8, ice);
    s.shine = mix(s.shine, 30.0, ice);
    s.emit = mix(s.emit, 0.08, ice);
  }
`;

function crystalGeometry() {
  const body = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true);
  const top = new THREE.ConeGeometry(0.5, 0.7, 6, 1, true);
  top.translate(0, 0.85, 0);
  const bottom = new THREE.ConeGeometry(0.5, 0.5, 6, 1, true);
  bottom.rotateX(Math.PI);
  bottom.translate(0, -0.75, 0);
  const g = merge([paint(body, '#ffffff'), paint(top, '#ffffff'), paint(bottom, '#ffffff')]);
  g.computeVertexNormals();
  return g;
}

function buildDecor() {
  const rand = makeRandom(7);
  const parts = [];
  const add = (list, dir, spin = 0, sink = 0.02) => list.forEach((g) => parts.push(plant(g, R, dir, spin, sink)));
  // Sandy island with a grassy crown.
  add([xform(paint(new THREE.SphereGeometry(0.5, 20, 10), vgrad('#e2c07e', '#ffe7ad', -0.1, 0.1)), { s: [1, 0.2, 0.85] })], ISLAND.toArray(), 0.3, 0.02);
  add([xform(paint(new THREE.SphereGeometry(0.3, 16, 8), vgrad('#3fae55', '#7fe06a', -0.05, 0.08)), { p: [0.05, 0.05, -0.04], s: [1, 0.3, 0.9] })], ISLAND.toArray(), 0.3, 0.02);
  const tangent = new THREE.Vector3(0, 1, 0).cross(ISLAND).normalize();
  const bit = ISLAND.clone().cross(tangent);
  const palm1 = ISLAND.clone().addScaledVector(tangent, 0.12).addScaledVector(bit, 0.04);
  const palm2 = ISLAND.clone().addScaledVector(tangent, -0.03).addScaledVector(bit, -0.1);
  add(palmTree(rand, { size: 1.5 }), palm1.toArray(), 0.5, -0.06);
  add(palmTree(rand, { size: 1.2 }), palm2.toArray(), 2.6, -0.05);
  // Lighthouse.
  const lh = ISLAND.clone().addScaledVector(tangent, -0.14).addScaledVector(bit, 0.11);
  const tower = [];
  for (let i = 0; i < 4; i++) {
    const h = 0.11;
    const r0 = 0.07 - i * 0.008;
    tower.push(xform(paint(new THREE.CylinderGeometry(r0 - 0.008, r0, h, 12), i % 2 ? '#ff6b7a' : '#ffffff'), { p: [0, 0.06 + i * h + h / 2, 0] }));
  }
  tower.push(xform(paint(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 10), '#fff2b0', 3.2), { p: [0, 0.55, 0] }));
  tower.push(xform(paint(new THREE.ConeGeometry(0.065, 0.08, 10), '#ff6b7a'), { p: [0, 0.63, 0] }));
  add(tower, lh.toArray(), 0, 0.0);
  // Icebergs along the polar edges.
  for (let i = 0; i < 14; i++) {
    const north = i % 2 === 0;
    const dir = dirLL((north ? 1 : -1) * rand.range(47, 55), rand.range(0, 360));
    const g = new THREE.IcosahedronGeometry(rand.range(0.06, 0.13), 0);
    add([xform(paint(g, vgrad('#7fc7ff', '#f2fdff', -0.08, 0.1), 0.15), { s: [1, rand.range(0.7, 1.6), 1], r: [rand.range(0, 3), rand.range(0, 3), 0] })], dir, 0, 0.03);
  }
  return merge(parts);
}

const CRYSTALS = 64;
const CRYSTAL_COLORS = ['#bff6ff', '#9fe8ff', '#e6d6ff', '#ffd9f2', '#c9fff0', '#ffffff'];

function CrystalRing({ state, index, material }) {
  const mesh = useRef();
  const data = useMemo(() => {
    const rand = makeRandom(31);
    return Array.from({ length: CRYSTALS }, (_, i) => ({
      a: (i / CRYSTALS) * Math.PI * 2 + rand.range(-0.04, 0.04),
      r: rand.range(3.15, 3.85),
      y: rand.range(-0.18, 0.18),
      s: rand.range(0.07, 0.17) * (rand.chance(0.12) ? 1.7 : 1),
      axis: new THREE.Vector3(rand.range(-1, 1), rand.range(-1, 1), rand.range(-1, 1)).normalize(),
      spin: rand.range(0.4, 1.4) * rand.sign(),
      phase: rand.range(0, 6),
      color: rand.pick(CRYSTAL_COLORS),
    }));
  }, []);
  useLayoutEffect(() => {
    const c = new THREE.Color();
    data.forEach((d, i) => mesh.current.setColorAt(i, c.set(d.color)));
    mesh.current.instanceColor.needsUpdate = true;
  }, [data]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const orbit = t * 0.08;
    const f = state.glow[index];
    data.forEach((d, i) => {
      const a = d.a + orbit;
      tmp.p.set(Math.cos(a) * d.r, d.y + Math.sin(t * 0.9 + d.phase) * 0.06, Math.sin(a) * d.r);
      tmp.q.setFromAxisAngle(d.axis, t * d.spin + d.phase);
      tmp.s.set(d.s, d.s * 1.4, d.s).multiplyScalar(1 + f * 0.15);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      mesh.current.setMatrixAt(i, tmp.m);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  const geometry = useDisposable(crystalGeometry);
  return <instancedMesh ref={mesh} args={[geometry, material, CRYSTALS]} rotation={[0.32, 0, 0.18]} frustumCulled={false} />;
}

const CRYSTAL_SURFACE = /* glsl */ `
  void surface(inout Surf s, vec3 V) {
    float f = clamp(1.0 - dot(s.N, V), 0.0, 1.0);
    s.emit = 0.35 + 0.6 * pow(f, 2.0);
    s.add = vec3(0.3, 0.7, 1.0) * pow(f, 3.0) * 0.6 * (1.0 + uFocus);
  }
`;

export default function Crystal({ state }) {
  const index = TARGET_INDEX.wardrobe;
  const decor = useDisposable(buildDecor);
  const planetMat = useDisposable(() =>
    makeLit({
      surface: SURFACE,
      painted: false,
      withNoise: true,
      rim: '#9fe6ff',
      rimStrength: 0.6,
      wrap: 0.15,
      uniforms: {
        uDeep: { value: new THREE.Color('#0634a6') },
        uShallow: { value: new THREE.Color('#12c2e4') },
        uIce: { value: new THREE.Color('#a9dcf5') },
        uSand: { value: new THREE.Color('#f5dc9c') },
        uIsland: { value: ISLAND },
      },
    }),
  );
  const decorMat = useDisposable(() => makeLit({ rim: '#c6f2ff', rimStrength: 0.55, gloss: 0.5, shine: 30 }));
  const crystalMat = useDisposable(() => makeLit({ surface: CRYSTAL_SURFACE, painted: false, rim: '#a8f0ff', rimStrength: 1.2, gloss: 1.6, shine: 70, wrap: 0.6 }));
  const atmo = useDisposable(() => makeAtmosphere({ color: '#5fd8ff', inner: R, outer: R * 1.25, strength: 0.36, power: 2.8 }));
  return (
    <PlanetRoot
      index={index}
      state={state}
      tilt={[0.3, 0, 0.25]}
      spin={0.06}
      materials={[planetMat, decorMat, crystalMat]}
      still={
        <>
          <mesh material={atmo} scale={R * 1.25}>
            <icosahedronGeometry args={[1, 8]} />
          </mesh>
          <CrystalRing state={state} index={index} material={crystalMat} />
          <Moon radius={0.24} distance={5.2} speed={-0.3} phase={2.5} incline={-0.7} colors={['#7fb8e6', '#eaf8ff']} rim="#bff0ff" />
        </>
      }
    >
      <mesh material={planetMat}>
        <icosahedronGeometry args={[R, 22]} />
      </mesh>
      <mesh geometry={decor} material={decorMat} />
    </PlanetRoot>
  );
}
