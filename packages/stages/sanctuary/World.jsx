import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { noise } from '../shared/glsl.js';
import { CAMERA, COLORS, GROUND, RIVER } from './layout.js';
import { makeCityMaterial, makeFoliageMaterial, stageUniforms } from './materials.js';
import { makeConeTree, makePalm, makeRoundTree, TREE_GREENS } from './trees.js';

// The static city far below the terrace: towers, ground with parks and river,
// trees, the biodome, tower waterfalls and the green hills on the horizon.

export function CityMesh({ city, envMap }) {
  const material = useDisposable(() => makeCityMaterial(envMap), [envMap]);
  return <mesh geometry={city.geometry} material={material} frustumCulled={false} />;
}

const riverGlsl = /* glsl */ `
uniform vec3 uRiver[${RIVER.length}];
float riverSDF(vec2 p) {
  float best = 1e9;
  for (int i = 0; i < ${RIVER.length - 1}; i++) {
    vec3 a = uRiver[i];
    vec3 b = uRiver[i + 1];
    vec2 ab = b.xy - a.xy;
    float t = clamp(dot(p - a.xy, ab) / dot(ab, ab), 0.0, 1.0);
    best = min(best, length(p - a.xy - ab * t) - mix(a.z, b.z, t));
  }
  return best;
}
`;

function makeGroundMaterial(envMap) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0, envMap });
  const river = RIVER.map(([x, z, w]) => new THREE.Vector3(x, z, w));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = stageUniforms.uTime;
    shader.uniforms.uSunDir = stageUniforms.uSunDir;
    shader.uniforms.uRiver = { value: river };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${noise}
        ${riverGlsl}
        uniform float uTime;
        varying vec3 vWPos;
        float lineC(float x, float lw, float w) {
          float d = abs(fract(x + 0.5) - 0.5);
          return 1.0 - smoothstep(lw * 0.5 - w, lw * 0.5 + w, d);
        }`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        vec2 q = vWPos.xz;
        float sdf = riverSDF(q) + snoise(q * 0.006) * 14.0;
        float fwq = length(fwidth(q));
        // Land: curving road grid over a patchwork of lawns, plazas and paving.
        float ang = 0.35 + snoise(q * 0.0004) * 0.25;
        vec2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q / 150.0;
        vec2 cell = floor(r);
        float h = hash12(cell);
        float fw = fwq / 150.0;
        float road = max(lineC(r.x, 0.07, fw), lineC(r.y, 0.07, fw));
        float n = snoise(q * 0.01) * 0.5 + snoise(q * 0.045) * 0.25;
        vec3 lawn = mix(vec3(0.16, 0.46, 0.08), vec3(0.42, 0.72, 0.14), n * 0.5 + 0.5);
        vec3 paved = mix(vec3(0.72, 0.78, 0.78), vec3(0.86, 0.88, 0.86), hash12(floor(r * 4.0)));
        vec3 land = h < 0.62 ? lawn : paved;
        // Round plaza fountains / flower beds inside paved blocks.
        float plaza = smoothstep(0.2, 0.17, length(fract(r) - 0.5)) * step(0.62, h);
        land = mix(land, vec3(0.3, 0.75, 0.82), plaza * step(0.8, h));
        land = mix(land, vec3(0.45, 0.72, 0.2), plaza * step(h, 0.8));
        land = mix(land, vec3(0.9, 0.92, 0.92), road);
        vec3 shore = vec3(0.93, 0.92, 0.86);
        land = mix(shore, land, smoothstep(4.0, 14.0, sdf));
        // Water: deep teal to aqua shallows; sky comes from the reflection map.
        vec3 water = mix(vec3(0.0, 0.32, 0.4), vec3(0.0, 0.12, 0.22), smoothstep(-5.0, -60.0, sdf));
        float wet = step(sdf, 0.0);
        diffuseColor.rgb = mix(land, water, wet);
        roughnessFactor = mix(0.92, 0.05, wet);
        metalnessFactor = 0.0;
        vec2 wq = q * 0.05 + vec2(uTime * 0.3, uTime * 0.17);
        vec3 rip = vec3(snoise(wq), 0.0, snoise(wq.yx + 7.0)) * 0.06 * wet;
        // Sun glitter: hashed sparkles drifting over the water.
        vec2 gc = floor(q * 0.25 + vec2(uTime * 0.6, 0.0));
        float gh = hash12(gc);
        float tw = fract(uTime * (0.4 + gh) + gh * 9.0);
        vec3 glitter = vec3(1.0, 0.96, 0.85) * step(0.94, gh) * smoothstep(0.0, 0.1, tw) * smoothstep(0.35, 0.1, tw) * wet * 1.4;`,
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(rip, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += glitter;');
  };
  mat.customProgramCacheKey = () => 'sanctuary-ground';
  return mat;
}

export function Ground({ envMap }) {
  const material = useDisposable(() => makeGroundMaterial(envMap), [envMap]);
  const geometry = useDisposable(() => new THREE.PlaneGeometry(10000, 10000).rotateX(-Math.PI / 2));
  return <mesh geometry={geometry} material={material} position={[0, GROUND, -3000]} frustumCulled={false} />;
}

export function Trees({ city, envMap }) {
  const models = useDisposable(() => ({ round: makeRoundTree(1), cone: makeConeTree(), palm: makePalm() }));
  const material = useDisposable(() => makeFoliageMaterial({ sway: 0.25, envMap }), [envMap]);
  const meshes = useMemo(() => {
    const rand = makeRandom(77);
    const groups = { round: [], cone: [], palm: [] };
    city.trees.forEach((t) => groups[t.type].push(t));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    return Object.entries(groups)
      .filter(([, list]) => list.length)
      .map(([type, list]) => {
        const mesh = new THREE.InstancedMesh(models[type], material, list.length);
        list.forEach((t, i) => {
          e.set(0, rand.range(0, Math.PI * 2), 0);
          q.setFromEuler(e);
          p.set(t.x, t.y, t.z);
          s.setScalar(t.s);
          mesh.setMatrixAt(i, m.compose(p, q, s));
          mesh.setColorAt(i, c.set(rand.pick(TREE_GREENS)));
        });
        mesh.frustumCulled = false;
        return mesh;
      });
  }, [city, models, material]);
  useEffect(() => () => meshes.forEach((m) => m.dispose()), [meshes]);
  return meshes.map((m, i) => <primitive key={i} object={m} />);
}

const fogMerge = (uniforms) => THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]);

export function Biodome({ city }) {
  const dome = city.domes[0];
  const geometry = useDisposable(() => new THREE.SphereGeometry(1, 64, 20, 0, Math.PI * 2, 0, Math.PI / 2));
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: true,
        uniforms: fogMerge({ uSun: { value: new THREE.Vector3() } }),
        vertexShader: /* glsl */ `
          #include <fog_pars_vertex>
          varying vec3 vLocal;
          varying vec3 vN;
          varying vec3 vView;
          void main() {
            vLocal = position;
            vN = normalize(mat3(modelMatrix) * vec3(position.x, position.y * 1.6, position.z));
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vView = normalize(cameraPosition - wp.xyz);
            vec4 mvPosition = viewMatrix * wp;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }
        `,
        fragmentShader: /* glsl */ `
          #include <fog_pars_fragment>
          uniform vec3 uSun;
          varying vec3 vLocal;
          varying vec3 vN;
          varying vec3 vView;
          float line(float x, float w) {
            float d = abs(fract(x + 0.5) - 0.5);
            float fw = fwidth(x);
            return 1.0 - smoothstep(w - fw, w + fw, d);
          }
          void main() {
            vec3 p = normalize(vLocal);
            float lon = atan(p.z, p.x) / 6.2831853 * 40.0;
            float lat = asin(clamp(p.y, 0.0, 1.0)) / 1.5707963 * 9.0;
            // Triangulated geodesic lattice.
            float lattice = max(line(lat, 0.08), max(line(lon + lat * 0.5, 0.07), line(lon - lat * 0.5, 0.07)));
            float fres = pow(1.0 - max(dot(normalize(vN), vView), 0.0), 2.0);
            float spec = pow(max(dot(reflect(-vView, normalize(vN)), normalize(uSun)), 0.0), 40.0);
            vec3 glass = mix(vec3(0.12, 0.6, 0.78), vec3(0.7, 0.92, 1.0), fres);
            glass = mix(glass, vec3(0.55, 0.85, 1.0), smoothstep(0.5, 1.0, p.y) * 0.5);
            vec3 col = mix(glass, vec3(1.0), lattice) + vec3(1.0, 0.95, 0.85) * spec * 2.5;
            float a = max(0.5 + fres * 0.4 + spec, lattice);
            gl_FragColor = vec4(col, a);
            #include <fog_fragment>
          }
        `,
      }),
  );
  material.uniforms.uSun.value.copy(stageUniforms.uSunDir.value);
  return (
    <mesh geometry={geometry} material={material} position={[dome.x, GROUND + dome.base, dome.z]} scale={[dome.r, dome.r * dome.hy, dome.r]} renderOrder={2} />
  );
}

function makeFallsGeometry(falls) {
  const pos = [];
  const uv = [];
  const idx = [];
  const segs = 10;
  for (const f of falls) {
    const base = pos.length / 3;
    const rows = 6;
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      // Water leaves the lip, curves outward, then falls straight.
      const out = Math.min(1, v * 3) * 2.5;
      const y = f.y0 + (f.y1 - f.y0) * v;
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const th = f.th + (u - 0.5) * f.span;
        pos.push(f.cx + Math.cos(th) * (f.r + out), y, f.cz + Math.sin(th) * (f.r + out));
        uv.push(u, v);
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < segs; i++) {
        const a = base + j * (segs + 1) + i;
        idx.push(a, a + segs + 1, a + 1, a + 1, a + segs + 1, a + segs + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function Waterfalls({ city }) {
  const geometry = useDisposable(() => makeFallsGeometry(city.falls), [city]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
        uniforms: fogMerge({ uTime: stageUniforms.uTime }),
        vertexShader: /* glsl */ `
          #include <fog_pars_vertex>
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }
        `,
        fragmentShader: /* glsl */ `
          #include <fog_pars_fragment>
          ${noise}
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float streak = snoise(vec2(vUv.x * 26.0, vUv.y * 3.0 - uTime * 1.6)) * 0.5 + 0.5;
            streak = mix(streak, snoise(vec2(vUv.x * 60.0, vUv.y * 6.0 - uTime * 2.4)) * 0.5 + 0.5, 0.4);
            float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
            float foam = smoothstep(0.75, 1.0, vUv.y);
            vec3 col = mix(vec3(0.55, 0.9, 1.0), vec3(1.15, 1.2, 1.2), streak * 0.7 + foam * 0.6);
            float a = edge * (0.55 + 0.4 * streak) * (0.85 + foam * 0.3);
            gl_FragColor = vec4(col, a);
            #include <fog_fragment>
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} renderOrder={3} />;
}

// Rolling hill ridges on the horizon, lowest where the river reaches them.
const HILL_ROWS = [2700, 3100, 3600, 4300];
const HILL_PHASE = [2.1, 5.7, 8.3];

function hillHeight(az, k) {
  const a = az * 0.06;
  const ridge = 0.55 + 0.25 * Math.sin(a * 1.3 + HILL_PHASE[0] + k) + 0.15 * Math.sin(a * 3.1 + HILL_PHASE[1] - k) + 0.08 * Math.sin(a * 7.3 + HILL_PHASE[2]);
  const valley = 0.45 + 0.55 * THREE.MathUtils.smoothstep(Math.abs(az + 8), 4, 30);
  const lift = k === 0 ? 0 : k === HILL_ROWS.length - 1 ? 0.4 : 1;
  return GROUND + ridge * valley * (180 + k * 90) * lift;
}

/** Points along the second hill ridge (for wind turbines). */
export function hillRidge(count = 90) {
  const out = [];
  for (let i = 0; i <= count; i++) {
    const az = -95 + (i / count) * 190;
    const a = THREE.MathUtils.degToRad(az);
    out.push({ az, x: Math.sin(a) * HILL_ROWS[1], y: hillHeight(az, 1), z: CAMERA.position[2] - Math.cos(a) * HILL_ROWS[1] });
  }
  return out;
}

function makeHills() {
  const rand = makeRandom(404);
  const cols = 90;
  const pos = [];
  const col = [];
  const idx = [];
  const green = new THREE.Color('#3f9a3a');
  const light = new THREE.Color('#8fd25a');
  const haze = new THREE.Color(COLORS.fog);
  const c = new THREE.Color();
  HILL_ROWS.forEach((d, k) => {
    for (let i = 0; i <= cols; i++) {
      const az = -95 + (i / cols) * 190;
      const a = THREE.MathUtils.degToRad(az);
      pos.push(Math.sin(a) * d, hillHeight(az, k), CAMERA.position[2] - Math.cos(a) * d);
      // Baked aerial perspective (scene fog would erase hills this far out).
      c.copy(green).lerp(light, rand.range(0, 0.6)).lerp(haze, 0.3 + k * 0.1);
      col.push(c.r, c.g, c.b);
    }
  });
  for (let k = 0; k < HILL_ROWS.length - 1; k++) {
    for (let i = 0; i < cols; i++) {
      const a = k * (cols + 1) + i;
      const b = a + cols + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function Hills({ envMap }) {
  const geometry = useDisposable(() => makeHills());
  const material = useDisposable(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, fog: false, envMap }), [envMap]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
