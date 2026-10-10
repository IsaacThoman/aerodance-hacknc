import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { SUN_DIR } from './palette.js';

// ---------------------------------------------------------------------------
// Small deterministic value noise for sculpting rocks on the CPU.

function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let acc = 0;
  for (let dz = 0; dz <= 1; dz++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const h = hash3(xi + dx, yi + dy, zi + dz);
        acc += h * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
      }
  return acc;
}
const fbm3 = (x, y, z) => vnoise(x, y, z) * 0.6 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.1;

function paint(geometry, fn) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(c, pos.getX(i), pos.getY(i), pos.getZ(i), i);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const solid = (hex) => (c) => c.set(hex);

// ---------------------------------------------------------------------------
// Floating islands: grassy domes on tapered sandstone roots, with trees,
// optional waterfall, wind turbine and a glass greenhouse dome.

function islandGeometry(seed, { trees = 6, pond = false } = {}) {
  const rand = makeRandom(seed);
  const rock = new THREE.SphereGeometry(1, 40, 28);
  const pos = rock.attributes.position;
  const ox = rand.range(0, 100);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = fbm3(x * 2.2 + ox, y * 2.2, z * 2.2);
    if (y > 0) {
      y *= 0.18 + n * 0.08;
      const r = 1 + (n - 0.5) * 0.18;
      x *= r;
      z *= r;
    } else {
      const d = -y;
      const taper = Math.pow(1 - d, 0.8) * 0.85 + 0.15 * (1 - d);
      y = -Math.pow(d, 0.9) * (1.6 + n * 0.9);
      const r = (taper + (n - 0.5) * 0.35) * (1 + 0.12 * Math.sin(Math.atan2(z, x) * 5 + ox));
      x *= r;
      z *= r;
    }
    pos.setXYZ(i, x, y, z);
  }
  rock.computeVertexNormals();
  paint(rock, (c, x, y, z) => {
    if (y > -0.02) {
      const n = fbm3(x * 4 + ox, 0, z * 4);
      c.set('#8fe05a').lerp(new THREE.Color('#d2f57a'), n * 0.9);
      const rim = Math.sqrt(x * x + z * z);
      if (rim > 0.92) c.lerp(new THREE.Color('#6cc850'), 0.5);
    } else if (y > -0.12) {
      c.set('#6fbe4a').lerp(new THREE.Color('#d9a679'), (-y - 0.02) / 0.1);
    } else {
      const strata = Math.sin(y * 9 + fbm3(x * 3, y * 3, z * 3) * 4) * 0.5 + 0.5;
      c.set('#ffd9b4').lerp(new THREE.Color('#f2ae94'), strata * 0.55);
      c.lerp(new THREE.Color('#b5a2e6'), THREE.MathUtils.clamp((-y - 0.8) / 1.6, 0, 1) * 0.85);
    }
  });

  const parts = [rock];
  const topY = (x, z) => 0.18 * Math.sqrt(Math.max(0, 1 - x * x - z * z)) + 0.01;
  for (let i = 0; i < trees; i++) {
    const a = rand.range(0, Math.PI * 2);
    const r = rand.range(0.15, 0.78);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = rand.range(0.18, 0.32);
    const y = topY(x, z) - 0.02;
    const trunk = new THREE.CylinderGeometry(0.018, 0.028, h, 6);
    trunk.translate(x, y + h / 2, z);
    parts.push(paint(trunk, solid('#a5735a')));
    const round = rand.chance(0.6);
    const leaf = rand.pick(['#5cc95a', '#7fdc5f', '#46b55a', '#9be36b']);
    if (round) {
      for (let k = 0; k < 3; k++) {
        const s = rand.range(0.08, 0.13);
        const blob = new THREE.IcosahedronGeometry(s, 1);
        blob.translate(x + rand.range(-0.05, 0.05), y + h + rand.range(-0.02, 0.06), z + rand.range(-0.05, 0.05));
        parts.push(paint(blob, (c, bx, by) => c.set(leaf).offsetHSL(0, 0, (by - y - h) * 1.5)));
      }
    } else {
      const cone = new THREE.ConeGeometry(0.09, 0.32, 8);
      cone.translate(x, y + h + 0.1, z);
      parts.push(paint(cone, (c, bx, by) => c.set('#3fae63').offsetHSL(0, 0, (by - y - h) * 0.4)));
    }
  }
  if (pond) {
    const disc = new THREE.CircleGeometry(0.22, 24);
    disc.rotateX(-Math.PI / 2);
    disc.translate(0.35, topY(0.35, 0.2) + 0.012, 0.2);
    parts.push(paint(disc, solid('#5fd6f2')));
  }
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  parts.forEach((g) => g.dispose());
  return merged;
}

function waterfallMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      float h(float x) { return fract(sin(x * 91.7) * 4375.5); }
      void main() {
        float x = vUv.x;
        float y = vUv.y;
        float lanes = 9.0;
        float lane = floor(x * lanes);
        float speed = 0.6 + h(lane) * 0.5;
        float streak = fract(y * 3.0 + uTime * speed + h(lane + 3.0));
        float s = smoothstep(0.0, 0.5, streak) * (0.6 + 0.4 * h(lane + 7.0));
        float edge = smoothstep(0.0, 0.25, x) * smoothstep(1.0, 0.75, x);
        float fall = smoothstep(0.0, 0.35, y);
        vec3 col = mix(vec3(0.65, 0.92, 1.0), vec3(1.0), s);
        float a = edge * fall * (0.55 + 0.4 * s);
        gl_FragColor = vec4(col * 1.1, a);
      }
    `,
  });
}

function crystalGeometry(seed) {
  const rand = makeRandom(seed * 31 + 7);
  const parts = [];
  const clusters = rand.int(2, 3);
  for (let c = 0; c < clusters; c++) {
    const a = rand.range(0, Math.PI * 2);
    const r = rand.range(0.25, 0.45);
    const base = new THREE.Vector3(Math.cos(a) * r, -rand.range(0.7, 1.0), Math.sin(a) * r);
    const n = rand.int(3, 5);
    for (let i = 0; i < n; i++) {
      const h = rand.range(0.12, 0.3);
      const g = new THREE.OctahedronGeometry(1, 0);
      g.scale(0.045, h, 0.045);
      g.rotateZ(Math.PI + rand.range(-0.5, 0.5));
      g.rotateX(rand.range(-0.4, 0.4));
      g.translate(base.x + rand.range(-0.06, 0.06), base.y - h * 0.6, base.z + rand.range(-0.06, 0.06));
      parts.push(g);
    }
  }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

function mistMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 scale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), 1.0);
        mv.xy += position.xy * scale.xy;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p * vec2(1.0, 1.4));
        float puff = exp(-r * r * 3.0) * (0.75 + 0.25 * sin(uTime * 1.7 + p.x * 4.0));
        // A faint mist rainbow arcing over the spray.
        float arc = length(p - vec2(0.0, -0.35));
        float band = smoothstep(0.62, 0.7, arc) * smoothstep(0.92, 0.84, arc) * smoothstep(-0.35, 0.1, p.y);
        float k = clamp((arc - 0.66) / 0.22, 0.0, 1.0);
        vec3 rainbow = clamp(vec3(abs(k * 6.0 - 3.0) - 1.0, 2.0 - abs(k * 6.0 - 2.0), 2.0 - abs(k * 6.0 - 4.0)), 0.0, 1.0);
        vec3 col = vec3(1.0) * puff + rainbow * band * 0.5;
        float a = clamp(puff * 0.75 + band * 0.22, 0.0, 1.0);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

function Turbine({ position, scale = 1, speed = 1.4, material }) {
  const rotor = useRef();
  useFrame((state) => {
    rotor.current.rotation.z = state.clock.elapsedTime * speed;
  });
  return (
    <group position={position} scale={scale}>
      <mesh material={material} position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.018, 0.03, 1, 8]} />
      </mesh>
      <mesh material={material} position={[0, 1.0, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
        <capsuleGeometry args={[0.035, 0.08, 4, 8]} />
      </mesh>
      <group ref={rotor} position={[0, 1.0, 0.1]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} material={material} rotation={[0, 0, (i * Math.PI * 2) / 3]}>
            <boxGeometry args={[0.035, 0.62, 0.01]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Island({ position, scale, seed, trees, pond, waterfall, turbine, dome, crystals = true, bob = 0.4, phase = 0, rockMat, wfMat, mistMat, crystalMat, white, glass }) {
  const group = useRef();
  const geometry = useDisposable(() => islandGeometry(seed, { trees, pond }), [seed, trees, pond]);
  const gems = useDisposable(() => (crystals ? crystalGeometry(seed) : null), [seed, crystals]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    group.current.position.y = position[1] + Math.sin(t * 0.25 + phase) * bob;
    group.current.rotation.y = Math.sin(t * 0.05 + phase) * 0.05;
  });
  return (
    <group ref={group} position={position} scale={scale}>
      <mesh geometry={geometry} material={rockMat} />
      {gems && <mesh geometry={gems} material={crystalMat} />}
      {waterfall && (
        <group position={waterfall.position} rotation={[0, waterfall.angle, 0]}>
          <mesh material={wfMat} position={[0, -waterfall.length / 2, 0]}>
            <planeGeometry args={[waterfall.width, waterfall.length, 1, 1]} />
          </mesh>
          <mesh material={mistMat} position={[0, -waterfall.length * 0.93, 0.05]} scale={[waterfall.width * 4.5, waterfall.width * 3.2, 1]}>
            <planeGeometry args={[1, 1]} />
          </mesh>
        </group>
      )}
      {turbine && turbine.map((p, i) => <Turbine key={i} position={p} scale={0.55} material={white} speed={1.2 + i * 0.3} />)}
      {dome && (
        <group position={dome}>
          <mesh material={glass}>
            <sphereGeometry args={[0.16, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh material={white} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.15, 0.18, 24]} />
          </mesh>
        </group>
      )}
    </group>
  );
}

export function Islands() {
  const rockMat = useDisposable(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, emissive: '#3a2850', emissiveIntensity: 0.4 });
    // Soft self-illumination from the vertex colors keeps shadowed faces
    // saturated instead of muddy (the sun is behind the islands).
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * 0.32;',
      );
    };
    return m;
  });
  const wfMat = useDisposable(() => waterfallMaterial());
  const mistMat = useDisposable(() => mistMaterial());
  const crystalMat = useDisposable(
    () => new THREE.MeshStandardMaterial({ color: '#9fefff', emissive: '#53d6ff', emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.2, flatShading: true }),
  );
  const white = useDisposable(() => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 }));
  const glass = useDisposable(
    () => new THREE.MeshPhysicalMaterial({ color: '#bff3ff', roughness: 0.05, transmission: 0, transparent: true, opacity: 0.55, clearcoat: 1 }),
  );
  useFrame((state) => {
    wfMat.uniforms.uTime.value = state.clock.elapsedTime;
    mistMat.uniforms.uTime.value = state.clock.elapsedTime;
  });
  const common = { rockMat, wfMat, mistMat, crystalMat, white, glass };
  return (
    <group>
      <Island
        {...common}
        position={[-44, 0, -78]}
        scale={11}
        seed={3}
        trees={9}
        pond
        waterfall={{ position: [0.7, 0.05, 0.84], angle: 0.6, width: 0.17, length: 1.2 }}
        dome={[-0.3, 0.16, 0.25]}
        phase={0}
      />
      <Island
        {...common}
        position={[57, 1, -92]}
        scale={9}
        seed={8}
        trees={6}
        waterfall={{ position: [-0.74, 0.05, 0.7], angle: -0.5, width: 0.24, length: 2.2 }}
        turbine={[[0.25, 0.12, -0.2], [-0.15, 0.14, -0.4]]}
        phase={1.7}
      />
      <Island {...common} position={[-44, 5, -182]} scale={8} seed={21} trees={7} phase={3.1} bob={0.8} waterfall={{ position: [0.23, 0.05, 1.08], angle: 0.22, width: 0.22, length: 2.4 }} />
      <Island {...common} position={[48, -7, -182]} scale={6} seed={14} trees={5} turbine={[[0.0, 0.14, 0.0]]} phase={4.2} />
      <Island {...common} position={[-24, -11, -34]} scale={4} seed={33} trees={4} phase={2.4} bob={0.3} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Hot-air balloons with striped gores and flickering burners.

function paintFaces(geometry, fn) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    fn(c, x, y, z);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function balloonGeometry(colors, stripes = 12) {
  const profile = [];
  const n = 30;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let r;
    let y;
    if (t < 0.55) {
      const u = t / 0.55;
      r = 0.14 + 0.81 * Math.pow(Math.sin((u * Math.PI) / 2), 0.85);
      y = -1.3 + u * 1.3;
    } else {
      const phi = ((t - 0.55) / 0.45) * (Math.PI / 2);
      r = 0.95 * Math.cos(phi);
      y = 0.95 * Math.sin(phi);
    }
    profile.push(new THREE.Vector2(Math.max(r, 0.0001), y));
  }
  const env = new THREE.LatheGeometry(profile, stripes * 3).toNonIndexed();
  const ca = colors.map((c) => new THREE.Color(c));
  const white = new THREE.Color('#ffffff');
  paintFaces(env, (c, x, y, z) => {
    const ang = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
    const k = Math.floor(ang * stripes) % ca.length;
    c.copy(ca[k]);
    if (y > 0.28 && y < 0.42) c.copy(white);
    if (y < -1.0) c.lerp(white, 0.35);
  });
  const basket = new THREE.CylinderGeometry(0.13, 0.11, 0.16, 10);
  basket.translate(0, -1.48, 0);
  paint(basket, solid('#c98d5c'));
  const rim = new THREE.TorusGeometry(0.13, 0.015, 6, 16);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, -1.4, 0);
  paint(rim, solid('#8a5a3a'));
  const parts = [env, basket.toNonIndexed(), rim.toNonIndexed()];
  basket.dispose();
  rim.dispose();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rope = new THREE.CylinderGeometry(0.006, 0.006, 0.42, 3);
    rope.rotateZ(Math.cos(a) * 0.25);
    rope.rotateX(-Math.sin(a) * 0.25);
    rope.translate(Math.cos(a) * 0.15, -1.2, Math.sin(a) * 0.15);
    parts.push(paint(rope.toNonIndexed(), solid('#7a6050')));
    rope.dispose();
  }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

const BALLOONS = [
  { colors: ['#ff6f9f', '#ffd166', '#7ad66b', '#3fb8f0', '#9b7bff'], position: [9, 5.8, -22], scale: 1.5, drift: 0.16, phase: 0 },
  { colors: ['#ffffff', '#33c3f0'], position: [33, 15.5, -72], scale: 2.8, drift: -0.1, phase: 1.3 },
  { colors: ['#ffffff', '#ff8fc0'], position: [-27, 9, -142], scale: 4.0, drift: 0.08, phase: 2.2 },
  { colors: ['#b8f06a', '#ffe36b'], position: [-62, -6, -182], scale: 4.6, drift: 0.07, phase: 3.0 },
];

function Balloon({ cfg, material, flameMat }) {
  const group = useRef();
  const geometry = useDisposable(() => balloonGeometry(cfg.colors), [cfg.colors.join()]);
  const flame = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const g = group.current;
    g.position.set(cfg.position[0] + Math.sin(t * cfg.drift + cfg.phase) * 3, cfg.position[1] + Math.sin(t * 0.4 + cfg.phase) * 0.6, cfg.position[2]);
    g.rotation.y = t * 0.08 + cfg.phase;
    g.rotation.z = Math.sin(t * 0.5 + cfg.phase) * 0.03;
    const f = 0.7 + 0.3 * Math.sin(t * 13 + cfg.phase * 7) * Math.sin(t * 7.3);
    flame.current.scale.set(0.05 * f, 0.09 * f, 0.05 * f);
  });
  return (
    <group ref={group} scale={cfg.scale}>
      <mesh geometry={geometry} material={material} />
      <mesh ref={flame} material={flameMat} position={[0, -1.28, 0]}>
        <sphereGeometry args={[1, 10, 8]} />
      </mesh>
    </group>
  );
}

export function Balloons() {
  const material = useDisposable(() => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.2, sheen: 0.4 }));
  const flameMat = useDisposable(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.7) }));
  return (
    <group>
      {BALLOONS.map((cfg, i) => (
        <Balloon key={i} cfg={cfg} material={material} flameMat={flameMat} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Flocks of white birds gliding in wide loops, wings flapping in the shader.

export function Birds({ count = 22, seed = 4 }) {
  const geometry = useDisposable(() => {
    // Body + two wings; aWing = -1/1 on wing tips, 0 on the body line.
    const verts = [
      // left wing
      0, 0, 0.12, -0.9, 0.0, -0.05, 0, 0, -0.18,
      // right wing
      0, 0, 0.12, 0, 0, -0.18, 0.9, 0.0, -0.05,
      // body
      0, 0.04, 0.3, -0.08, 0, -0.1, 0.08, 0, -0.1,
      0, 0.0, -0.1, -0.12, 0, -0.45, 0.12, 0, -0.45,
    ];
    const wing = [0, -1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    const rand = makeRandom(seed);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const flock = i < count / 2 ? 0 : 1;
      data[i * 4] = flock;
      data[i * 4 + 1] = rand.range(-1, 1);
      data[i * 4 + 2] = rand.range(-1, 1);
      data[i * 4 + 3] = rand.next();
    }
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
    g.instanceCount = count;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uSun: { value: SUN_DIR.clone() } },
        vertexShader: /* glsl */ `
          attribute float aWing;
          attribute vec4 aData;
          uniform float uTime;
          varying float vShade;
          void main() {
            float flock = aData.x;
            float t = uTime * (flock < 0.5 ? 0.07 : 0.055) + flock * 2.4;
            vec3 center = flock < 0.5 ? vec3(-8.0, 13.0, -40.0) : vec3(26.0, 17.0, -70.0);
            float R = flock < 0.5 ? 22.0 : 30.0;
            vec3 path = center + vec3(cos(t) * R, sin(t * 2.0) * 1.5, sin(t) * R * 0.5);
            vec3 tangent = normalize(vec3(-sin(t) * R, cos(t * 2.0) * 3.0, cos(t) * R * 0.5));
            vec3 offset = vec3(aData.y * 3.0, aData.z * 1.2 + sin(uTime * 0.7 + aData.w * 9.0) * 0.3, aData.z * 2.5 - aData.y * 1.2);
            float flap = sin(uTime * (7.0 + aData.w * 2.0) + aData.w * 30.0);
            vec3 p = position;
            p.y += abs(aWing) * flap * 0.35;
            p.x *= 1.0 - abs(aWing) * 0.15 * (flap * 0.5 + 0.5);
            vShade = 0.75 + 0.25 * (aWing == 0.0 ? 1.0 : flap * 0.5 + 0.5);
            // Orient along the path tangent.
            vec3 fwd = tangent;
            vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
            vec3 up = cross(fwd, right);
            vec3 world = path + offset + (right * p.x + up * p.y + fwd * p.z) * 0.7;
            gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vShade;
          void main() {
            vec3 c = mix(vec3(0.78, 0.74, 0.92), vec3(1.0, 0.96, 0.92), vShade);
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// A little sightseeing airship cruising past with a blinking beacon.

export function Airship({ env }) {
  const group = useRef();
  const prop = useRef();
  const beacon = useRef();
  const hullMat = useDisposable(
    () =>
      new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05, envMap: env, envMapIntensity: 0.8 }),
    [env],
  );
  const hull = useDisposable(() => {
    const g = new THREE.SphereGeometry(1, 40, 20);
    g.scale(3.2, 1, 1);
    paint(g, (c, x, y) => {
      c.set('#ffffff');
      if (Math.abs(y + 0.1) < 0.09) c.set('#39c2ee');
      if (Math.abs(y + 0.28) < 0.04) c.set('#ff8fc0');
    });
    const fins = [];
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.BoxGeometry(0.9, 0.06, 0.9);
      fin.translate(-2.75, 0, 0);
      fin.rotateX((i * Math.PI) / 2 + Math.PI / 4);
      fins.push(paint(fin, solid(i % 2 ? '#39c2ee' : '#ffffff')));
    }
    const gondola = new THREE.CapsuleGeometry(0.22, 0.9, 4, 12);
    gondola.rotateZ(Math.PI / 2);
    gondola.translate(0.2, -1.05, 0);
    paint(gondola, (c, x, y) => c.set(y > -1.05 ? '#9ee8ff' : '#ffffff'));
    const parts = [g, ...fins, gondola];
    const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
    parts.forEach((p) => p.dispose());
    return merged;
  });
  const beaconMat = useDisposable(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.6, 0.9) }));
  const propMat = useDisposable(() => new THREE.MeshStandardMaterial({ color: '#e8eef8', metalness: 0.6, roughness: 0.3 }));
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Slow sightseeing loop over the left-hand islands.
    const a = t * 0.045 + 1.2;
    const g = group.current;
    g.position.set(-62 + Math.cos(a) * 46, 17 + Math.sin(t * 0.3) * 0.8, -185 + Math.sin(a) * 34);
    g.rotation.set(0, -Math.atan2(Math.cos(a) * 34, -Math.sin(a) * 46), Math.sin(t * 0.4) * 0.03);
    prop.current.rotation.x = t * 18;
    beacon.current.visible = t % 1.2 < 0.15;
  });
  return (
    <group ref={group} scale={2.2}>
      <mesh geometry={hull} material={hullMat} />
      <group ref={prop} position={[-3.3, 0, 0]}>
        <mesh material={propMat}>
          <boxGeometry args={[0.04, 1.1, 0.12]} />
        </mesh>
        <mesh material={propMat} rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[0.04, 1.1, 0.12]} />
        </mesh>
      </group>
      <mesh ref={beacon} material={beaconMat} position={[0.4, 1.02, 0]}>
        <sphereGeometry args={[0.1, 8, 6]} />
      </mesh>
    </group>
  );
}
