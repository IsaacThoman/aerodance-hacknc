import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { dirLL, makeAtmosphere, makeLit, merge, paint, plant, xform } from './materials.js';
import { bush, cottage, flower, mushroom, pineTree, poplarTree, rock, roundTree, turbineBlades, turbineTower } from './props.js';
import { PlanetRoot } from './PlanetRoot.jsx';
import { Moon } from './Moon.jsx';
import { TARGET_INDEX } from './layout.js';

const R = 2.9;
const POND = new THREE.Vector3(...dirLL(22, 38)).normalize();
const PATH_N = new THREE.Vector3(0, 1, 0).cross(POND).normalize();
const HOUSE_SPIN = THREE.MathUtils.degToRad(38);
const TURBINE_DIR = new THREE.Vector3(...dirLL(18, 205)).normalize();
export const PX_SCALE = 480 / (2 * Math.tan(THREE.MathUtils.degToRad(20)));

const SURFACE = /* glsl */ `
  uniform vec3 uG1, uG2, uG3, uSand, uWater, uWaterDeep, uPond, uPathN;
  void surface(inout Surf s, vec3 V) {
    vec3 n = normalize(vObjPos);
    float g = fbm(n * 1.7 + 3.0);
    float d = snoise(n * 6.5);
    vec3 grass = mix(uG3, uG1, smoothstep(-0.5, 0.0, g + d * 0.12));
    grass = mix(grass, uG2, smoothstep(0.12, 0.5, g + d * 0.15));
    // Soft mowing stripes around the house for a tended-garden feel.
    grass *= 1.0 + 0.05 * sin(acos(clamp(n.y, -1.0, 1.0)) * 60.0) * smoothstep(0.75, 0.95, n.y);
    s.albedo = grass;
    s.gloss = 0.14;
    s.shine = 9.0;

    float side = dot(n, uPond);
    float pathW = 0.038 + 0.012 * snoise(n * 9.0);
    float wob = 0.02 * snoise(n * 4.0 + 2.0);
    float onPath = (1.0 - smoothstep(pathW, pathW + 0.015, abs(dot(n, uPathN) + wob)))
      * smoothstep(uPond.y - 0.02, uPond.y + 0.04, n.y) * step(0.0, side) * (1.0 - smoothstep(0.93, 0.95, n.y));
    s.albedo = mix(s.albedo, uSand, onPath);

    float pr = side + 0.035 * snoise(n * 8.0);
    float shore = smoothstep(0.9, 0.91, pr);
    float water = smoothstep(0.922, 0.93, pr);
    s.albedo = mix(s.albedo, uSand, shore);
    if (water > 0.0) {
      vec3 wn = vec3(snoise(n * 28.0 + vec3(0.0, uTime * 0.6, 0.0)), snoise(n * 28.0 + vec3(5.0, uTime * 0.5, 2.0)), 0.0);
      s.N = normalize(mix(s.N, normalize(s.N + wn * 0.12), water));
      vec3 w = mix(uWater, uWaterDeep, smoothstep(0.935, 0.985, pr));
      s.albedo = mix(s.albedo, w, water);
      s.gloss = mix(s.gloss, 1.4, water);
      s.shine = mix(s.shine, 70.0, water);
      s.emit = water * 0.18;
      s.rim *= 1.0 + water;
    }
  }
`;

function buildDecor() {
  const rand = makeRandom(42);
  const parts = [];
  const add = (list, dir, spin = rand.range(0, Math.PI * 2), sink = 0.03) => {
    for (const g of list) parts.push(plant(g, R, dir, spin, sink));
  };

  add(cottage(), [0, 1, 0], HOUSE_SPIN, 0.02);
  // Picket fence around the yard, open toward the path.
  for (let a = 0; a < 360; a += 11) {
    const gap = Math.abs(((a - 38 + 540) % 360) - 180);
    if (gap < 16) continue;
    const dir = dirLL(90 - 17.5, a);
    add([xform(paint(new THREE.BoxGeometry(0.035, 0.15, 0.03), '#ffffff'), { p: [0, 0.075, 0] })], dir, THREE.MathUtils.degToRad(a), 0.01);
  }

  const v = new THREE.Vector3();
  const taken = [];
  const free = (dir, minAngle) => {
    v.set(...dir).normalize();
    if (v.y > Math.cos(THREE.MathUtils.degToRad(24))) return false;
    if (v.dot(POND) > Math.cos(THREE.MathUtils.degToRad(26))) return false;
    if (Math.abs(v.dot(PATH_N)) < 0.08 && v.dot(POND) > 0 && v.y > POND.y - 0.05) return false;
    if (v.dot(TURBINE_DIR) > Math.cos(THREE.MathUtils.degToRad(14))) return false;
    for (const t of taken) if (v.dot(t) > Math.cos(minAngle)) return false;
    return true;
  };
  const scatter = (count, minDeg, latRange, make) => {
    let placed = 0;
    for (let k = 0; k < count * 40 && placed < count; k++) {
      const dir = dirLL(rand.range(...latRange), rand.range(0, 360));
      if (!free(dir, THREE.MathUtils.degToRad(minDeg))) continue;
      taken.push(new THREE.Vector3(...dir).normalize());
      add(make(), dir);
      placed++;
    }
  };

  const canopies = ['#55c94f', '#7fda55', '#3dbb72', '#ff9fd0', '#8be36a', '#47c08f'];
  scatter(9, 16, [-35, 68], () => roundTree(rand, { canopy: rand.pick(canopies), size: rand.range(0.9, 1.35) }));
  scatter(4, 15, [-40, 60], () => poplarTree(rand, { canopy: rand.pick(['#38b26a', '#5ccf63']), size: rand.range(1, 1.3) }));
  scatter(4, 14, [-55, 45], () => pineTree(rand, { color: rand.pick(['#2fa37a', '#2a9a8a']), size: rand.range(0.9, 1.3) }));
  scatter(8, 9, [-60, 70], () => bush(rand, { color: rand.pick(['#45b85a', '#5cc96a', '#3aa772']), size: rand.range(0.8, 1.3) }));
  scatter(5, 8, [-70, 70], () => mushroom(rand, { cap: rand.pick(['#ff5a6e', '#ff8a3d', '#c86bff']), size: rand.range(0.9, 1.5) }));
  scatter(6, 7, [-80, 50], () => rock(rand, { size: rand.range(0.8, 1.8) }));

  // Flower patches.
  const petals = ['#ff8ccf', '#ffe066', '#ffffff', '#c59bff', '#ff9f6b', '#7fd7ff'];
  for (let c = 0; c < 9; c++) {
    let center = null;
    for (let k = 0; k < 60; k++) {
      const dir = dirLL(rand.range(-45, 72), rand.range(0, 360));
      if (free(dir, 0.12)) {
        center = new THREE.Vector3(...dir);
        break;
      }
    }
    if (!center) continue;
    const color = rand.pick(petals);
    const tangent = new THREE.Vector3(0, 1, 0).cross(center).normalize();
    const bitangent = center.clone().cross(tangent);
    for (let i = 0; i < 9; i++) {
      const a = rand.range(0, Math.PI * 2);
      const r = rand.range(0, 0.14);
      const dir = center.clone().addScaledVector(tangent, Math.cos(a) * r).addScaledVector(bitangent, Math.sin(a) * r);
      add(flower(rand, { color: rand.chance(0.8) ? color : rand.pick(petals), size: rand.range(0.9, 1.3) }), dir.toArray(), 0, 0.0);
    }
  }

  // Lily pads + a lotus on the pond.
  const pt = new THREE.Vector3(0, 1, 0).cross(POND).normalize();
  const pb = POND.clone().cross(pt);
  [[0.12, 0.05], [-0.1, 0.12], [0.03, -0.14], [-0.16, -0.04]].forEach(([a, b], i) => {
    const dir = POND.clone().addScaledVector(pt, a).addScaledVector(pb, b);
    add([xform(paint(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 12, 1, false, 0.3, Math.PI * 1.8), '#4fcf6a'), { p: [0, 0.03, 0] })], dir.toArray(), i, 0);
    if (i === 1) add([xform(paint(new THREE.ConeGeometry(0.04, 0.06, 6), '#ffb3dc', 0.5), { p: [0, 0.06, 0] })], dir.toArray(), 0, 0);
  });

  add(turbineTower(1.35), TURBINE_DIR.toArray(), 0.4, 0.02);
  return merge(parts);
}

const SMOKE_COUNT = 7;

function Smoke({ position }) {
  const geometry = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(SMOKE_COUNT * 3);
    const seed = new Float32Array(SMOKE_COUNT);
    for (let i = 0; i < SMOKE_COUNT; i++) seed[i] = i / SMOKE_COUNT;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPx: { value: PX_SCALE } },
        vertexShader: /* glsl */ `
          attribute float aSeed;
          uniform float uTime, uPx;
          varying float vA;
          void main() {
            float life = fract(uTime * 0.16 + aSeed);
            vec3 p = vec3(sin(life * 5.0 + aSeed * 9.0) * 0.06 + life * 0.18, life * 0.95, cos(life * 4.0 + aSeed * 7.0) * 0.05);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            vA = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.45, 1.0, life));
            gl_PointSize = (0.1 + life * 0.32) * uPx / -mv.z;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          void main() {
            vec2 p = (gl_PointCoord * 2.0 - 1.0) * vec2(1.3333, 1.0); // undo the anamorphic stretch
            float d = dot(p, p);
            float a = smoothstep(1.0, 0.2, d) * vA * 0.75;
            vec3 col = mix(vec3(0.75, 0.7, 0.95), vec3(1.0, 0.97, 1.0), smoothstep(0.8, 0.0, p.y + 0.4));
            gl_FragColor = vec4(col * a, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
      }),
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <points position={position} geometry={geometry} material={material} frustumCulled={false} />;
}

export default function Meadow({ state }) {
  const index = TARGET_INDEX.story;
  const decor = useDisposable(buildDecor);
  const blades = useDisposable(() => merge(turbineBlades(0.6)));
  const planetMat = useDisposable(() =>
    makeLit({
      surface: SURFACE,
      painted: false,
      withNoise: true,
      rim: '#9dffd8',
      rimStrength: 0.5,
      wrap: 0.15,
      uniforms: {
        uG1: { value: new THREE.Color('#4cc04a') },
        uG2: { value: new THREE.Color('#a8e05a') },
        uG3: { value: new THREE.Color('#1d8a52') },
        uSand: { value: new THREE.Color('#f2d79a') },
        uWater: { value: new THREE.Color('#47d0ff') },
        uWaterDeep: { value: new THREE.Color('#1c78e0') },
        uPond: { value: POND },
        uPathN: { value: PATH_N },
      },
    }),
  );
  const decorMat = useDisposable(() => makeLit({ rim: '#c6f2ff', rimStrength: 0.55, gloss: 0.45, shine: 28 }));
  const atmo = useDisposable(() => makeAtmosphere({ color: '#7dffd0', inner: R, outer: R * 1.22, strength: 0.38, power: 2.6 }));

  // Turbine hub placement on the planet.
  const hub = useMemo(() => {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), TURBINE_DIR);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4));
    const p = new THREE.Vector3(0, 1.37, 0.07).applyQuaternion(q).add(TURBINE_DIR.clone().multiplyScalar(R - 0.02));
    return { p: p.toArray(), q };
  }, []);
  // Chimney top in planet space.
  const chimney = useMemo(() => {
    const v = new THREE.Vector3(0.24, 0.1 + 0.58 + 0.68, -0.14).applyAxisAngle(new THREE.Vector3(0, 1, 0), HOUSE_SPIN);
    v.y += R - 0.02;
    return v.toArray();
  }, []);

  const bladeRef = useRef();
  return (
    <PlanetRoot
      index={index}
      state={state}
      tilt={[0.42, 0, -0.12]}
      spin={0.045}
      materials={[planetMat, decorMat]}
      onFrame={(t, dt, focus) => {
        bladeRef.current.rotation.z -= dt * (1.6 + focus * 2);
      }}
      still={
        <>
          <mesh material={atmo} scale={R * 1.22}>
            <icosahedronGeometry args={[1, 8]} />
          </mesh>
          <Moon radius={0.36} distance={4.7} speed={0.22} phase={1.2} incline={0.55} colors={['#8b84c4', '#efe6ff']} />
        </>
      }
    >
      <mesh material={planetMat}>
        <icosahedronGeometry args={[R, 22]} />
      </mesh>
      <mesh geometry={decor} material={decorMat} />
      <group position={hub.p} quaternion={hub.q}>
        <mesh ref={bladeRef} geometry={blades} material={decorMat} />
      </group>
      <Smoke position={chimney} />
    </PlanetRoot>
  );
}
