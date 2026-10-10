import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { noise } from '../../shared/glsl.js';
import { CAMERA, DOME_POS, env, LIGHTING } from './state.js';
import { buildRangeGeometry, buildShoreGeometry, forestDensity, landDistance, shoreHeight } from './terrain.js';
import { makeNoise2D } from './noise.js';
import { makeLitMaterial, paint } from './materials.js';

const worldVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const RANGES = [
  // Mid range: crisp, moonlit snow.
  { x0: -2800, x1: 2800, z0: -760, z1: -1180, segX: 440, segZ: 28, peak: 235, base: -8, seed: 31, freq: 0.0031, crest: 0.42, haze: 0.6, snowLine: 70 },
  // Far range: taller, hazier.
  { x0: -3800, x1: 3800, z0: -1260, z1: -1950, segX: 420, segZ: 26, peak: 410, base: -20, seed: 57, freq: 0.0021, crest: 0.5, haze: 0.75, snowLine: 110 },
];

function Range({ cfg }) {
  const geometry = useDisposable(() => buildRangeGeometry(cfg), [cfg]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...env, uHazeMul: { value: cfg.haze }, uSnowLine: { value: cfg.snowLine } },
        vertexShader: worldVertex,
        fragmentShader: /* glsl */ `
          uniform float uHazeMul;
          uniform float uSnowLine;
          varying vec3 vWorld;
          varying vec3 vNormal;
          ${noise}
          ${LIGHTING}
          void main() {
            vec3 N = normalize(vNormal);
            vec3 P = vWorld;
            float n1 = snoise(P.xz * 0.011);
            float n2 = snoise(P.xz * 0.045 + 3.0);
            // Rock streaks running down the fall line break up the snow.
            float streak = snoise(vec2(P.x * 0.045 + n1 * 0.6, P.y * 0.012 + P.z * 0.01));
            float streak2 = snoise(vec2(P.x * 0.11 + P.z * 0.03, P.y * 0.02));
            float steep = 1.0 - N.y;
            float snow = smoothstep(0.5, 0.7, N.y + n1 * 0.1 + n2 * 0.07 - max(streak, 0.0) * 0.28 * steep * 2.0 - max(streak2, 0.0) * 0.12);
            snow = max(snow, smoothstep(uSnowLine, uSnowLine + 70.0, P.y + n1 * 30.0) * smoothstep(0.25, 0.5, N.y + n2 * 0.1 - streak * 0.15));
            vec3 rock = vec3(0.016, 0.02, 0.034) * (0.8 + 0.4 * n2);
            vec3 snowCol = vec3(0.7, 0.78, 0.94);
            vec3 albedo = mix(rock, snowCol, snow);
            vec3 col = shade(albedo, N, P, 0.05);
            col += uAuroraGlow * 0.5 * pow(max(N.y, 0.0), 6.0) * snow;
            col = applyHaze(col, P, uHazeMul);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [cfg],
  );
  return <mesh geometry={geometry} material={material} />;
}

export function Mountains() {
  return (
    <group>
      {RANGES.map((cfg, i) => (
        <Range key={i} cfg={cfg} />
      ))}
    </group>
  );
}

export function Shore() {
  const geometry = useDisposable(() => buildShoreGeometry(), []);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...env },
        vertexShader: /* glsl */ `
          attribute float aForest;
          varying vec3 vWorld;
          varying vec3 vNormal;
          varying float vForest;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            vNormal = normalize(mat3(modelMatrix) * normal);
            vForest = aForest;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vWorld;
          varying vec3 vNormal;
          varying float vForest;
          ${noise}
          ${LIGHTING}
          void main() {
            vec3 N = normalize(vNormal);
            vec3 P = vWorld;
            float n1 = snoise(P.xz * 0.04);
            float n2 = snoise(P.xz * 0.21 + 7.0);
            float snow = smoothstep(0.5, 0.72, N.y + n2 * 0.12);
            vec3 snowCol = vec3(0.76, 0.83, 0.95) * (0.9 + 0.1 * n1);
            vec3 rock = vec3(0.035, 0.04, 0.055);
            vec3 albedo = mix(rock, snowCol, snow);
            // Wind-carved drifts: soft ripples in the snow.
            albedo *= 0.94 + 0.06 * sin(P.x * 0.9 + P.z * 0.4 + n1 * 4.0);
            // Under the forest canopy the snow is shaded and littered with needles.
            float canopy = smoothstep(0.08, 0.55, vForest + n2 * 0.08);
            albedo = mix(albedo, vec3(0.035, 0.06, 0.08), canopy * 0.85);
            // Thin ice at the waterline and darker wet rock just below it.
            float ice = smoothstep(-0.45, 0.0, P.y) * (1.0 - smoothstep(0.05, 0.6, P.y));
            albedo = mix(albedo, vec3(0.42, 0.58, 0.78), ice * 0.7);
            albedo *= mix(0.25, 1.0, smoothstep(-1.6, -0.3, P.y));
            vec3 col = shade(albedo, N, P, 0.2);

            // Frost glints: tiny points that twinkle as you move.
            vec2 q = P.xz * 2.2;
            vec2 cell = floor(q);
            float r = hash12(cell);
            vec2 local = fract(q) - 0.5 - (hash22(cell) - 0.5) * 0.6;
            float pix = (fwidth(q.x) + fwidth(q.y)) * 0.8;
            float dot1 = 1.0 - smoothstep(0.0, max(pix, 0.06), length(local));
            float tw = pow(max(sin(uTime * (1.5 + r * 2.0) + r * 80.0 + (cameraPosition.x + cameraPosition.y) * 3.0), 0.0), 12.0);
            float dist = length(P - cameraPosition);
            col += vec3(0.75, 0.9, 1.0) * dot1 * step(0.93, r) * tw * snow * (1.0 - canopy) * 2.6 * smoothstep(140.0, 20.0, dist);

            col = applyHaze(col, P, 1.0);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} />;
}

// ---------------------------------------------------------------------------
// Pine trees

function buildPine({ tiers, points, seed, underside = true, mid = true, trunk = true, height = 1, radius = 2.8, step = 0.55 }) {
  const rand = makeRandom(seed);
  const pos = [];
  const nrm = [];
  const snow = [];
  // Each vertex: [x, y, z, nx, ny, nz, snow]
  const tri = (...v) => {
    for (const p of v) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(p[3], p[4], p[5]);
      snow.push(p[6]);
    }
  };
  const vtx = (x, y, z, nx, ny, nz, sn) => {
    const l = Math.hypot(nx, ny, nz) || 1;
    return [x, y, z, nx / l, ny / l, nz / l, sn];
  };
  if (trunk) {
    // Trunk (snow = -1 marks bark).
    const tr = 0.32;
    const th = 2.4;
    for (let i = 0; i < 5; i++) {
      const a0 = (i / 5) * Math.PI * 2;
      const a1 = ((i + 1) / 5) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const p0 = vtx(c0 * tr, -0.6, s0 * tr, c0, 0, s0, -1);
      const p1 = vtx(c1 * tr, -0.6, s1 * tr, c1, 0, s1, -1);
      const p2 = vtx(c1 * tr * 0.7, th, s1 * tr * 0.7, c1, 0, s1, -1);
      const p3 = vtx(c0 * tr * 0.7, th, s0 * tr * 0.7, c0, 0, s0, -1);
      tri(p0, p2, p1);
      tri(p0, p3, p2);
    }
  }
  // Tiers are star-shaped skirts: drooping branch tips between tucked notches,
  // with smooth cone-like normals so they shade softly.
  let y = 1.3;
  const n = points * 2;
  for (let k = 0; k < tiers; k++) {
    const f = tiers === 1 ? 0 : k / (tiers - 1);
    const R = radius * (1 - f * 0.8) * (0.9 + rand.next() * 0.2);
    const H = (3.4 - f * 1.4) * height;
    const droop = 0.8 * (1 - f * 0.5);
    const apex = vtx(rand.range(-0.08, 0.08), y + H, rand.range(-0.08, 0.08), 0, 1, 0, 0.7);
    const ring0 = [];
    const ring1 = [];
    const under = [];
    const off = rand.next() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2 + rand.range(-0.08, 0.08);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const tip = i % 2 === 0;
      const r0 = tip ? R * rand.range(0.85, 1.12) : R * rand.range(0.5, 0.62);
      const y0 = tip ? y - droop * rand.range(0.7, 1.25) : y + H * 0.1;
      ring0.push(vtx(c * r0, y0, sn * r0, c * 0.85, 0.55, sn * 0.85, tip ? 0.62 : 0.3));
      under.push(vtx(c * r0, y0, sn * r0, c * 0.4, -1, sn * 0.4, 0));
      ring1.push(vtx(c * R * 0.36, y + H * 0.45, sn * R * 0.36, c * 0.55, 0.85, sn * 0.55, 0.82));
    }
    const inner = vtx(0, y + H * 0.15, 0, 0, -1, 0, 0);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (mid) {
        tri(ring0[i], ring1[i], ring0[j]);
        tri(ring0[j], ring1[i], ring1[j]);
        tri(ring1[i], apex, ring1[j]);
      } else {
        tri(ring0[i], apex, ring0[j]);
      }
      if (underside && i % 2 === 0) tri(under[i], under[j], inner);
    }
    y += H * step;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aSnow', new THREE.Float32BufferAttribute(snow, 1));
  return g;
}

function makeTreeMaterial(haze = 1, snowMul = 1) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...env, uHazeMul: { value: haze }, uSnowMul: { value: snowMul } },
    vertexShader: /* glsl */ `
      attribute float aSnow;
      uniform float uTime;
      varying float vSnow;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vTint;
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vec3 p = position;
        float id = float(gl_InstanceID);
        // Gentle sway increasing with height.
        float sway = sin(uTime * 0.7 + id * 1.37) * 0.035 * max(p.y, 0.0);
        p.x += sway;
        vec4 wp = m * vec4(p, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(m) * normal);
        vSnow = aSnow;
        vTint = fract(sin(id * 12.9898) * 43758.5453);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uHazeMul;
      uniform float uSnowMul;
      varying float vSnow;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vTint;
      ${noise}
      ${LIGHTING}
      void main() {
        vec3 N = normalize(vNormal);
        vec3 needles = mix(vec3(0.008, 0.026, 0.022), vec3(0.014, 0.038, 0.028), vTint);
        vec3 bark = vec3(0.04, 0.025, 0.018);
        float n = snoise(vWorld.xz * 1.7 + vWorld.y * 0.9);
        float s = uSnowMul * smoothstep(0.6, 0.85, clamp(vSnow, 0.0, 1.0) * 0.7 + N.y * 0.3 + n * 0.32 + (vTint - 0.5) * 0.15);
        vec3 albedo = vSnow < -0.5 ? bark : mix(needles, vec3(0.62, 0.7, 0.88), s);
        vec3 col = shade(albedo, N, vWorld, 0.12);
        col = applyHaze(col, vWorld, uHazeMul);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// Hand-placed hero pines framing the left foreground.
const FOREGROUND_TREES = [
  [-27, 7, 1.35],
  [-35, -4, 1.6],
  [-44, -17, 1.55],
  [-31, 15, 1.1],
  [-52, -29, 1.4],
];

function placeTrees() {
  const rand = makeRandom(99);
  const near = [];
  const far = [];
  const cam = new THREE.Vector2(CAMERA.position[0], CAMERA.position[2]);
  const domeAng = Math.atan2(DOME_POS.x - cam.x, -(DOME_POS.z - cam.y));
  const domeDist = Math.hypot(DOME_POS.x - cam.x, DOME_POS.z - cam.y);
  const hero = FOREGROUND_TREES.map(([x, z, s]) => ({ x, y: shoreHeight(x, z) - 0.4, z, s, sy: rand.range(1.0, 1.12), rot: rand.range(0, Math.PI * 2), tilt: rand.range(-0.02, 0.02) }));
  for (let tries = 0; tries < 90000; tries++) {
    const x = rand.range(-760, 760);
    const z = rand.range(-760, 40);
    const dx = x - cam.x;
    const dz = z - cam.y;
    const ang = Math.atan2(dx, -dz);
    if (Math.abs(ang) > 0.86) continue;
    const dist = Math.hypot(dx, dz);
    if (dist < 16) continue;
    // Keep the dome and jetty in clear view.
    if (Math.abs(ang - domeAng) < 0.11 && dist < domeDist + 5) continue;
    const density = forestDensity(x, z);
    if (density <= 0) continue;
    const isFar = dist > 300;
    if (rand.next() > density * (isFar ? 0.7 : 0.6)) continue;
    if (isFar ? far.length >= 1700 : near.length >= 440) continue;
    const h = shoreHeight(x, z);
    const s = rand.range(0.75, 1.3) * (isFar ? 1.35 : 1) * (dist < 40 ? 1.3 : 1);
    (isFar ? far : near).push({ x, y: h - 0.4, z, s, sy: rand.range(0.9, 1.25), rot: rand.range(0, Math.PI * 2), tilt: rand.range(-0.04, 0.04) });
  }
  return { near, far, hero };
}

function fillInstances(mesh, list) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  list.forEach((t, i) => {
    e.set(t.tilt, t.rot, t.tilt * 0.7);
    q.setFromEuler(e);
    p.set(t.x, t.y, t.z);
    s.set(t.s, t.s * t.sy, t.s);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

export function Trees() {
  const data = useDisposable(() => {
    const placement = placeTrees();
    return {
      placement,
      nearGeo: buildPine({ tiers: 4, points: 5, seed: 3 }),
      heroGeo: buildPine({ tiers: 8, points: 7, seed: 21, radius: 2.5, height: 0.92, step: 0.42 }),
      farGeo: buildPine({ tiers: 3, points: 3, seed: 8, underside: false, mid: false, trunk: false, height: 1.3 }),
      nearMat: makeTreeMaterial(1, 0.8),
      farMat: makeTreeMaterial(1.1, 0.3),
    };
  }, []);
  const near = useRef();
  const far = useRef();
  const hero = useRef();
  useLayoutEffect(() => {
    fillInstances(near.current, data.placement.near);
    fillInstances(far.current, data.placement.far);
    fillInstances(hero.current, data.placement.hero);
  }, [data]);
  return (
    <group>
      <instancedMesh ref={near} args={[data.nearGeo, data.nearMat, 460]} frustumCulled={false} />
      <instancedMesh ref={far} args={[data.farGeo, data.farMat, 1700]} frustumCulled={false} />
      <instancedMesh ref={hero} args={[data.heroGeo, data.nearMat, FOREGROUND_TREES.length]} frustumCulled={false} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Snow-capped boulders along the shore.

export function Rocks() {
  const data = useDisposable(() => {
    const base = new THREE.IcosahedronGeometry(1, 2);
    const n = makeNoise2D(17);
    const p = base.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = 1 + 0.22 * n(x * 1.6 + z, y * 1.6) + 0.08 * n(x * 4 + 3, z * 4 - y);
      p.setXYZ(i, x * k, Math.max(y * k * 0.7, -0.3), z * k);
    }
    base.computeVertexNormals();
    const geo = paint(base, '#141824');
    const mat = makeLitMaterial({ snow: 1, wrap: 0.3 });
    const rand = makeRandom(5);
    const list = [];
    for (let tries = 0; tries < 6000 && list.length < 46; tries++) {
      const x = rand.range(-300, 300);
      const z = rand.range(-420, 38);
      const d = landDistance(x, z);
      if (d < -2 || d > 6) continue;
      const dist = Math.hypot(x, z - 40);
      if (Math.abs(Math.atan2(x, 40 - z)) > 0.85 || dist < 12) continue;
      if (Math.hypot(x - DOME_POS.x, z - DOME_POS.z) < 16) continue;
      list.push({ x, y: shoreHeight(x, z) - 0.2, z, s: rand.range(0.6, 2.2) * (dist < 60 ? 1.2 : 1.6), rot: rand.range(0, 6.28), sy: rand.range(0.7, 1.1), tilt: rand.range(-0.2, 0.2) });
    }
    return { geo, mat, list };
  }, []);
  const ref = useRef();
  useLayoutEffect(() => fillInstances(ref.current, data.list), [data]);
  return <instancedMesh ref={ref} args={[data.geo, data.mat, data.list.length]} frustumCulled={false} />;
}

