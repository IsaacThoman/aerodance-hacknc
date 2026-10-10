import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { cloudGLSL, lightGLSL, lightUniforms, windGLSL, windUniforms } from './fx.js';
import { heightAt, makeNoise2, PATH_POINTS, POND, POND_LEVEL, TREE } from './terrain.js';

// ---------------------------------------------------------------- terrain

function buildTerrain() {
  const NX = 230;
  const NZ = 170;
  const positions = new Float32Array((NX + 1) * (NZ + 1) * 3);
  let k = 0;
  for (let j = 0; j <= NZ; j++) {
    const v = j / NZ;
    const z = 32 - 372 * Math.pow(v, 1.65);
    for (let i = 0; i <= NX; i++) {
      const u = (i / NX) * 2 - 1;
      const x = Math.sign(u) * Math.pow(Math.abs(u), 1.45) * 440;
      positions[k++] = x;
      positions[k++] = heightAt(x, z);
      positions[k++] = z;
    }
  }
  const index = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const b = a + 1;
      const c = a + NX + 1;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const terrainVert = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vWorld = position;
    vNormal = normal;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;

const terrainFrag = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uLush;
  uniform vec3 uSunny;
  uniform vec3 uTreePos;
  ${windGLSL}
  ${lightGLSL}
  ${cloudGLSL}
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    vec2 p = vWorld.xz;
    float d = length(vWorld - cameraPosition);
    // Big soft colour patches, like light and shade drifting over a meadow.
    vec4 nz = tnoise(p * 0.013);
    float patchN = nz.a * 0.8 + tnoise(p * 0.05).r * 0.2;
    vec3 base = mix(uDeep, uLush, smoothstep(-0.55, 0.35, patchN));
    base = mix(base, uSunny, smoothstep(0.15, 0.8, patchN) * 0.55);
    // Grass texture up close (fades out before it can shimmer).
    float fine = tnoise(p * vec2(1.6, 0.6)).g * 0.5 + tnoise(p * 4.1).b * 0.5;
    base *= 1.0 + fine * 0.12 * smoothstep(60.0, 8.0, d);
    // Under the blade field the ground reads as shaded grass.
    base *= mix(0.62, 1.0, smoothstep(14.0, 48.0, d));
    // Lighting: wrapped sun + sky/ground hemisphere.
    float wrap = clamp((dot(n, uSunDir) + 0.35) / 1.35, 0.0, 1.0);
    vec3 light = uSunColor * wrap * 0.95 + mix(uGroundLight, uSkyLight, n.y * 0.5 + 0.5) * 0.55;
    vec3 col = base * light;
    // Rim of light on crests seen against the sky.
    vec3 v = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 4.0) * smoothstep(40.0, 120.0, d);
    col += vec3(0.30, 0.42, 0.16) * rim * 0.6;
    // Travelling gust highlights (the grass flattens and flashes silver).
    float g = gustField(p);
    col = mix(col, col * 1.32 + vec3(0.05, 0.07, 0.015), clamp(g, 0.0, 1.3) * 0.55);
    // Soft contact shadow under the tree.
    float ts = length((p - uTreePos.xz) * vec2(1.0, 1.25) - vec2(2.2, 0.8));
    col *= 1.0 - 0.38 * smoothstep(9.5, 2.0, ts);
    col *= cloudShade(p, uTime, uWindDir);
    col = applyHaze(col, vWorld, 1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Terrain() {
  const geometry = useDisposable(buildTerrain);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...windUniforms,
          ...lightUniforms,
          uDeep: { value: new THREE.Color('#2f8a22') },
          uLush: { value: new THREE.Color('#58b52c') },
          uSunny: { value: new THREE.Color('#9fd83e') },
          uTreePos: { value: new THREE.Vector3(TREE.x, TREE.y, TREE.z) },
        },
        vertexShader: terrainVert,
        fragmentShader: terrainFrag,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

// ------------------------------------------------------- distant hill layers

function buildHillLayer({ radius, height, variation, seed, span = 1.45, segments = 220, base = -40 }) {
  const noise = makeNoise2(seed);
  const rows = 6;
  const positions = [];
  const vs = [];
  for (let i = 0; i <= segments; i++) {
    const a = -span + (i / segments) * span * 2;
    const top =
      height +
      variation * (0.55 * noise(a * 2.2, 0.5) + 0.3 * noise(a * 5.3, 2.5) + 0.15 * noise(a * 11.0, 7.5));
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const y = THREE.MathUtils.lerp(top, base, Math.pow(t, 0.7));
      // Lean the face slightly toward the camera so the lit slope reads.
      const rr = radius - (1 - t) * radius * 0.04;
      positions.push(Math.sin(a) * rr, y, -Math.cos(a) * rr);
      vs.push(t);
    }
  }
  const index = [];
  for (let i = 0; i < segments; i++) {
    for (let r = 0; r < rows; r++) {
      const a = i * (rows + 1) + r;
      const b = a + 1;
      const c = a + rows + 1;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(vs, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const hillVert = /* glsl */ `
  attribute float aV;
  varying vec3 vWorld;
  varying float vV;
  varying vec3 vNormal;
  void main() {
    vWorld = position;
    vV = aV;
    vNormal = normal;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;

const hillFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uTopColor;
  uniform float uHazeAmount;
  uniform float uSeed;
  ${lightGLSL}
  ${windGLSL}
  varying vec3 vWorld;
  varying float vV;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    float shade = clamp((dot(n, uSunDir) + 0.5) / 1.5, 0.0, 1.0);
    vec3 col = mix(uColor, uTopColor, smoothstep(0.35, 0.0, vV));
    // Gentle tree-line speckle and field patches.
    float pn = snoise(vec2(atan(vWorld.x, -vWorld.z) * 40.0 + uSeed, vWorld.y * 0.08));
    col *= 0.88 + 0.12 * pn;
    col *= 0.75 + 0.35 * shade;
    // Atmospheric perspective: thicker toward the base of each layer.
    float haze = clamp(uHazeAmount + vV * 0.25, 0.0, 1.0);
    vec3 dir = normalize(vWorld - cameraPosition);
    vec3 hz = uHaze + vec3(0.22, 0.16, 0.05) * pow(max(dot(dir, normalize(uSunView)), 0.0), 5.0);
    col = mix(col, hz, haze);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const HILL_LAYERS = [
  { radius: 1350, height: 150, variation: 70, seed: 5, color: '#6aa6a2', top: '#9ccfc0', haze: 0.72 },
  { radius: 860, height: 92, variation: 42, seed: 9, color: '#4f9a4e', top: '#8fcd5f', haze: 0.5 },
  { radius: 520, height: 52, variation: 26, seed: 17, color: '#3f9636', top: '#86cc48', haze: 0.3 },
];

function HillLayer({ layer }) {
  const geometry = useDisposable(() => buildHillLayer(layer), [layer]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...lightUniforms,
          ...windUniforms,
          uColor: { value: new THREE.Color(layer.color) },
          uTopColor: { value: new THREE.Color(layer.top) },
          uHazeAmount: { value: layer.haze },
          uSeed: { value: layer.seed },
        },
        vertexShader: hillVert,
        fragmentShader: hillFrag,
      }),
    [layer],
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

// ------------------------------------------------------------------- path

function buildPath() {
  const positions = [];
  const attrs = [];
  const n = PATH_POINTS.length;
  const across = [-1.05, -0.5, 0.5, 1.05];
  for (let i = 0; i < n; i++) {
    const p = PATH_POINTS[i];
    const q = PATH_POINTS[Math.min(n - 1, i + 1)];
    const o = PATH_POINTS[Math.max(0, i - 1)];
    const tx = q.x - o.x;
    const tz = q.z - o.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len;
    const nz = tx / len;
    const fadeEnd = Math.min(1, (n - 1 - i) / 10);
    const w = 1 - (i / n) * 0.3;
    for (const a of across) {
      const x = p.x + nx * a * w;
      const z = p.z + nz * a * w;
      positions.push(x, heightAt(x, z) + 0.07, z);
      attrs.push(Math.abs(a) < 0.8 ? fadeEnd : 0, i * 0.35, a / 1.05);
    }
  }
  const index = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < 3; k++) {
      const a = i * 4 + k;
      index.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aPath', new THREE.Float32BufferAttribute(attrs, 3));
  g.setIndex(index);
  return g;
}

function Path() {
  const geometry = useDisposable(buildPath);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          ...lightUniforms,
          ...windUniforms,
          uSand: { value: new THREE.Color('#e9dcae') },
          uDirt: { value: new THREE.Color('#c7b07a') },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aPath;
          varying vec3 vPath;
          varying vec3 vWorld;
          void main() {
            vPath = aPath;
            vWorld = position;
            gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uSand;
          uniform vec3 uDirt;
          ${windGLSL}
          ${lightGLSL}
          ${cloudGLSL}
          varying vec3 vPath;
          varying vec3 vWorld;
          void main() {
            float edge = vPath.x;
            float wob = snoise(vec2(vPath.y * 0.6, vPath.z * 2.0)) * 0.25;
            float a = smoothstep(0.05, 0.6, edge + wob * edge);
            float grain = snoise(vWorld.xz * 3.0) * 0.5 + 0.5;
            vec3 col = mix(uDirt, uSand, grain * 0.6 + 0.3);
            // Twin worn tracks.
            col *= 1.0 - 0.1 * exp(-pow(abs(vPath.z) - 0.45, 2.0) * 30.0);
            col *= uSunColor * 0.8 + uSkyLight * 0.35;
            col *= cloudShade(vWorld.xz, uTime, uWindDir);
            col = applyHaze(col, vWorld, 1.0);
            gl_FragColor = vec4(col * a, a);
          }
        `,
        premultipliedAlpha: true,
      }),
  );
  return <mesh geometry={geometry} material={material} renderOrder={-10} frustumCulled={false} />;
}

// ------------------------------------------------------------------- pond

function Pond() {
  const geometry = useDisposable(() => {
    const g = new THREE.CircleGeometry(1, 64);
    g.rotateX(-Math.PI / 2);
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...lightUniforms,
          ...windUniforms,
          uDeep: { value: new THREE.Color('#1f8fb0') },
          uSky: { value: new THREE.Color('#a9dcff') },
          uSkyTop: { value: new THREE.Color('#3f8fe6') },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uDeep;
          uniform vec3 uSky;
          uniform vec3 uSkyTop;
          ${windGLSL}
          ${lightGLSL}
          varying vec3 vWorld;
          void main() {
            vec2 p = vWorld.xz;
            // Ripple normal from two drifting noise layers.
            vec2 q = p * 0.9 - uWindDir * uTime * 0.35;
            float e = 0.08;
            float h0 = snoise(q) + 0.5 * snoise(q * 2.3 + uTime * 0.2);
            float hx = snoise(q + vec2(e, 0.0)) + 0.5 * snoise((q + vec2(e, 0.0)) * 2.3 + uTime * 0.2);
            float hz = snoise(q + vec2(0.0, e)) + 0.5 * snoise((q + vec2(0.0, e)) * 2.3 + uTime * 0.2);
            vec3 n = normalize(vec3(-(hx - h0) * 0.12, 1.0, -(hz - h0) * 0.12));
            vec3 v = normalize(cameraPosition - vWorld);
            float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
            vec3 r = reflect(-v, n);
            vec3 sky = mix(uSky, uSkyTop, smoothstep(0.0, 0.6, r.y));
            vec3 col = mix(uDeep, sky, 0.35 + 0.6 * fres);
            // Sparkles: sun glints on ripple crests (HDR -> bloom).
            float spec = pow(max(dot(r, normalize(uSunView)), 0.0), 220.0);
            float glint = smoothstep(0.82, 1.0, snoise(p * 7.0 + uTime * vec2(0.9, 0.4)));
            col += uSunColor * (spec * 2.2 + glint * 0.9 * (0.4 + fres));
            // Shallow, lighter water toward the shore.
            col = applyHaze(col, vWorld, 1.0);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[POND.x, POND_LEVEL, POND.z]}
      rotation={[0, POND.rot, 0]}
      scale={[POND.rx * 1.35, 1, POND.rz * 1.35]}
    />
  );
}

// Lily pads with a few pink blossoms floating on the pond.
function LilyPads() {
  const data = useDisposable(() => {
    const rand = makeRandom(41);
    const padShape = new THREE.Shape();
    padShape.absarc(0, 0, 1, 0.35, Math.PI * 2 - 0.05, false);
    padShape.lineTo(0, 0);
    const pad = new THREE.ShapeGeometry(padShape, 18);
    pad.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshStandardMaterial({ color: '#4cae3a', roughness: 0.35, metalness: 0 });
    const bloom = new THREE.ConeGeometry(0.22, 0.2, 7, 1, true);
    bloom.translate(0, 0.1, 0);
    bloom.rotateX(Math.PI);
    bloom.translate(0, 0.2, 0);
    const bloomMat = new THREE.MeshStandardMaterial({ color: '#ff9ccd', roughness: 0.4, side: THREE.DoubleSide, emissive: '#ff6fae', emissiveIntensity: 0.25 });
    const pads = new THREE.InstancedMesh(pad, padMat, 9);
    const blooms = new THREE.InstancedMesh(bloom, bloomMat, 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let b = 0;
    for (let i = 0; i < 9; i++) {
      const a = rand.range(0, Math.PI * 2);
      const r = Math.sqrt(rand.next()) * 0.75;
      const lx = Math.cos(a) * r * POND.rx;
      const lz = Math.sin(a) * r * POND.rz;
      const c = Math.cos(POND.rot);
      const sn = Math.sin(POND.rot);
      p.set(POND.x + lx * c + lz * sn, POND_LEVEL + 0.02, POND.z - lx * sn + lz * c);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand.range(0, Math.PI * 2));
      const sc = rand.range(0.35, 0.65);
      s.set(sc, 1, sc);
      m.compose(p, q, s);
      pads.setMatrixAt(i, m);
      if (b < 3 && rand.chance(0.45)) {
        s.setScalar(sc * 1.4);
        m.compose(p, q, s);
        blooms.setMatrixAt(b++, m);
      }
    }
    blooms.count = b;
    return { pad, padMat, bloom, bloomMat, pads, blooms };
  });
  return (
    <>
      <primitive object={data.pads} />
      <primitive object={data.blooms} />
    </>
  );
}

export function Ground() {
  return (
    <>
      {HILL_LAYERS.map((layer) => (
        <HillLayer key={layer.seed} layer={layer} />
      ))}
      <Terrain />
      <Path />
      <Pond />
      <LilyPads />
    </>
  );
}
