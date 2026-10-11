import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { beat, useDisposable } from '../shared/hooks.js';
import { causticsGLSL, patchUnderwater, waterGLSL } from './shaders.js';
import { SAND_Y } from './Reef.jsx';

export const DOME_R = 6.4;
// Vertical radius: a slightly flattened dome keeps its crown in frame.
export const DOME_H = 5.3;
export const PLINTH_R = DOME_R + 0.55;
// Rib azimuths (0 = toward the camera). The front stays rib-free so nothing
// crosses in front of the dancers.
const RIBS = [45, 90, 135, 180, 225, 270, 315];
const CROWN_LAT = 74;

const deg = THREE.MathUtils.degToRad;
const onDome = (az, lat, grow = 0) =>
  new THREE.Vector3(
    Math.sin(deg(az)) * Math.cos(deg(lat)) * (DOME_R + grow),
    Math.sin(deg(lat)) * (DOME_H + grow),
    Math.cos(deg(az)) * Math.cos(deg(lat)) * (DOME_R + grow),
  );
const CROWN = { r: DOME_R * Math.cos(deg(CROWN_LAT)), y: DOME_H * Math.sin(deg(CROWN_LAT)) };

// Glass tube leading off into the reef (starts inside the dome wall).
export const TUNNEL = [
  [-4.25, 1.4, -4.25],
  [-10.0, 1.4, -7.4],
  [-14.6, 1.5, -11.8],
  [-18.8, 1.8, -17.6],
  [-22.0, 2.2, -25.0],
  [-24.4, 2.5, -33.0],
];
const TUNNEL_R = 1.3;

// White parts fade to aqua where they meet the sand.
const AQUA_FOOT = 'diffuseColor.rgb *= mix(vec3(0.55, 0.84, 0.95), vec3(1.0), smoothstep(-0.55, -0.12, vUwWorld.y));';

// Subtle polar tiles on the pearl floor, cooler toward the rim.
const FLOOR_TILES = /* glsl */ `{
  vec2 fp = vUwWorld.xz;
  float fr = length(fp);
  float fa = atan(fp.y, fp.x) / 6.2831853 + 0.5;
  float band = floor(fr / 1.15);
  float chk = mod(band + floor(fa * (8.0 + band * 6.0)), 2.0);
  diffuseColor.rgb *= 0.95 + 0.07 * chk;
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.82, 0.97, 1.0), smoothstep(4.4, 6.9, fr));
}`;

const glassVertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Nearly invisible head-on; fresnel edges, reflected surface light, a softbox
// streak and faint caustic shimmer make the glass read.
const glassFragment = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform vec3 uUnderSun;
uniform vec3 uTint;
uniform float uEdge;
uniform float uBase;
uniform float uStreak;
uniform vec3 uStreakDir;
${waterGLSL}
${causticsGLSL}
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fr = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  float rim = pow(1.0 - ndv, 2.6);
  vec3 r = reflect(-v, n);
  vec3 env = waterBg(r.y) + vec3(0.7, 1.0, 1.05) * smoothstep(0.55, 0.95, r.y);
  vec3 P = normalize(uStreakDir);
  vec3 T = normalize(cross(P, vec3(0.0, 1.0, 0.0)));
  vec3 B = cross(T, P);
  float box = smoothstep(0.07, 0.015, abs(dot(r, T))) * smoothstep(0.42, 0.22, abs(dot(r, B))) * step(0.0, dot(r, P));
  vec3 col = env * fr * 0.8 + uTint * rim * uEdge + vec3(2.2, 2.5, 2.5) * box * uStreak;
  float c = caustics(vWorld, uUnderSun, uSurfaceY, uTime);
  col += uTint * c * 0.08 * (0.25 + rim);
  float a = clamp(uBase + fr * 0.85 + rim * 0.12 + box * uStreak * 0.5, 0.0, 1.0);
  float k = 1.0 - waterFogAmount(length(cameraPosition - vWorld));
  gl_FragColor = vec4(col * k, a * k);
}
`;

// streakDir: reflected direction of the softbox; [-0.77, 0.3, -0.56] lands on the dome's left flank, clear of the dancers.
function makeGlass(shared, { tint = '#9ff6ff', edge = 0.35, base = 0.015, streak = 1, streakDir = [-0.77, 0.3, -0.56] } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uTint: { value: new THREE.Color(tint) },
      uEdge: { value: edge },
      uBase: { value: base },
      uStreak: { value: streak },
      uStreakDir: { value: new THREE.Vector3(...streakDir) },
    },
    vertexShader: glassVertex,
    fragmentShader: glassFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

const ringsFragment = /* glsl */ `
uniform float uTime;
uniform float uBeat;
uniform float uBeatPhase;
uniform float uRadius;
varying vec2 vP;
float ring(float r, float c, float w) {
  float aa = fwidth(r) * 1.2;
  return 1.0 - smoothstep(w, w + aa, abs(r - c));
}
float halo(float r, float c, float w) {
  float d = (r - c) / w;
  return exp(-d * d);
}
void main() {
  // Pattern laid out for a 7 m floor, scaled to the actual radius.
  float r = length(vP) * 7.0 / uRadius;
  float a = atan(vP.y, vP.x) / 6.2831853 + 0.5;
  vec3 aqua = vec3(0.12, 1.45, 1.7);
  vec3 lime = vec3(0.42, 1.5, 0.08);
  float pulse = 0.85 + 0.5 * uBeat;
  // Inlays cover the pearl (so they stay saturated); halos only add light.
  float outer = ring(r, 6.55, 0.1);
  float dash = smoothstep(0.35, 0.45, fract(a * 48.0 + uTime * 0.06)) * smoothstep(0.95, 0.85, fract(a * 48.0 + uTime * 0.06));
  float dashed = ring(r, 5.55, 0.08) * dash;
  float limeRing = ring(r, 4.15, 0.075);
  float dash2 = step(0.5, fract(a * 12.0 - uTime * 0.04));
  float inner = ring(r, 3.0, 0.06) * dash2;
  float core = ring(r, 1.2, 0.08);
  float dot = ring(r, 0.5, 0.06);
  float cover = outer + dashed + limeRing + inner + core + dot;
  vec3 col = aqua * (outer * 1.4 + dashed * 1.2 + inner + core * 1.2) + lime * (limeRing * 1.2 + dot);
  col += aqua * (halo(r, 6.55, 0.4) * 0.3 + halo(r, 1.2, 0.3) * 0.22 + halo(r, 5.55, 0.25) * 0.12) + lime * halo(r, 4.15, 0.3) * 0.2;
  // A soft wave rolls outward on every beat.
  col += aqua * halo(r, uBeatPhase * 7.0, 0.45) * (1.0 - uBeatPhase) * 0.35;
  float fade = smoothstep(6.95, 6.7, r);
  gl_FragColor = vec4(col * pulse * fade, clamp(cover, 0.0, 0.85) * fade);
}
`;

function FloorRings({ shared }) {
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared, uRadius: { value: DOME_R } },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() {
            vP = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: ringsFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
  );
  return (
    <mesh material={material} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} renderOrder={-5}>
      <circleGeometry args={[DOME_R - 0.05, 128]} />
    </mesh>
  );
}

function domeFrameGeometry() {
  const parts = [];
  for (const az of RIBS) {
    const pts = [];
    for (let i = 0; i <= 14; i++) pts.push(onDome(az, (i / 14) * CROWN_LAT, 0.03));
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.075, 8, false));
  }
  const crown = new THREE.TorusGeometry(CROWN.r, 0.11, 10, 48);
  crown.rotateX(Math.PI / 2);
  crown.translate(0, CROWN.y, 0);
  parts.push(crown);
  for (const g of parts) g.deleteAttribute('uv');
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  parts.forEach((g) => g.dispose());
  return merged;
}

function plinthGeometry() {
  // Low rounded rim with a short vertical face (port lights) flaring into the sand.
  const pts = [
    [0, -0.02], [DOME_R + 0.15, -0.02], [PLINTH_R - 0.12, -0.03], [PLINTH_R, -0.08], [PLINTH_R + 0.05, -0.16],
    [PLINTH_R + 0.05, -0.26], [PLINTH_R + 0.2, -0.38], [PLINTH_R + 0.5, SAND_Y - 0.08], [PLINTH_R + 0.7, SAND_Y - 0.4],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts.reverse(), 128);
}

function tunnelParts(floorHeight) {
  const curve = new THREE.CatmullRomCurve3(TUNNEL.map((p) => new THREE.Vector3(...p)));
  const glass = new THREE.TubeGeometry(curve, 90, TUNNEL_R, 24, false);
  // Walkway ribbon with a light strip down its middle.
  const len = curve.getLength();
  const steps = 90;
  const walk = [];
  const strip = [];
  const idx = [];
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const S = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    S.set(-T.z, 0, T.x).normalize();
    const y = P.y - TUNNEL_R * 0.78;
    walk.push(P.x + S.x * 0.82, y, P.z + S.z * 0.82, P.x - S.x * 0.82, y, P.z - S.z * 0.82);
    strip.push(P.x + S.x * 0.09, y + 0.012, P.z + S.z * 0.09, P.x - S.x * 0.09, y + 0.012, P.z - S.z * 0.09);
    if (i < steps) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const ribbon = (arr) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // Ring ribs + legs.
  const rings = [];
  const legs = [];
  const ringGeo = new THREE.TorusGeometry(TUNNEL_R + 0.04, 0.085, 8, 32);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const count = Math.floor(len / 2.3);
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    q.setFromUnitVectors(zAxis, T);
    m.compose(P, q, new THREE.Vector3(1, 1, 1));
    rings.push(ringGeo.clone().applyMatrix4(m));
    if (i % 2 === 0) {
      const foot = floorHeight(P.x, P.z) - 0.3;
      const h = P.y - TUNNEL_R - foot;
      const leg = new THREE.CylinderGeometry(0.1, 0.16, h, 8);
      leg.translate(P.x, foot + h / 2, P.z);
      legs.push(leg);
    }
  }
  ringGeo.dispose();
  const flat = (list) => {
    list.forEach((g) => g.deleteAttribute('uv'));
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    return merged;
  };
  return { glass, walk: ribbon(walk), strip: ribbon(strip), rings: flat(rings), legs: flat(legs) };
}

/** The dome hall: plinth, pearl floor + ring inlays, glass dome, chrome ribs, tunnel, benches and bubble lamps. */
export function Dome({ shared, floorHeight }) {
  const mats = useDisposable(() => ({
    floor: patchUnderwater(
      new THREE.MeshPhysicalMaterial({
        color: '#92c6d4',
        roughness: 0.42,
        clearcoat: 0.3,
        clearcoatRoughness: 0.12,
        iridescence: 0.6,
        iridescenceIOR: 1.35,
        iridescenceThicknessRange: [220, 620],
      }),
      shared,
      { caustics: 0.4, ibl: 0.08, color: FLOOR_TILES },
    ),
    white: patchUnderwater(new THREE.MeshPhysicalMaterial({ color: '#d8ecf4', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06 }), shared, { caustics: 0.35, ibl: 0.22, color: AQUA_FOOT }),
    chrome: patchUnderwater(new THREE.MeshPhysicalMaterial({ color: '#dff6ff', metalness: 1, roughness: 0.14, clearcoat: 0.6 }), shared, { caustics: 0.2 }),
    cushion: patchUnderwater(new THREE.MeshPhysicalMaterial({ color: '#1fbfe0', roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }), shared, { caustics: 0.3, ibl: 0.5 }),
    band: new THREE.MeshBasicMaterial({ color: '#5ff3ff' }),
    strip: patchUnderwater(new THREE.MeshBasicMaterial({ color: new THREE.Color('#5ff3ff').multiplyScalar(2.2) }), shared),
    domeBack: makeGlass(shared, { edge: 0.3, streak: 0 }),
    domeFront: makeGlass(shared, { edge: 0.4, streak: 1 }),
    tunnel: makeGlass(shared, { edge: 0.45, base: 0.03, streak: 0.6, streakDir: [0.2, 0.9, 0.4] }),
  }));
  const geo = useDisposable(() => ({
    plinth: plinthGeometry(),
    frame: domeFrameGeometry(),
    domeFront: new THREE.SphereGeometry(DOME_R, 72, 28, 0, Math.PI, 0, Math.PI / 2).scale(1, DOME_H / DOME_R, 1),
    domeBack: new THREE.SphereGeometry(DOME_R, 72, 28, Math.PI, Math.PI, 0, Math.PI / 2).scale(1, DOME_H / DOME_R, 1),
    tunnel: tunnelParts(floorHeight),
  }));
  const baseColor = useMemo(() => new THREE.Color('#5ff3ff'), []);

  useFrame(() => {
    mats.band.color.copy(baseColor).multiplyScalar(1.6 + beat.pulse * 1.2);
  });

  return (
    <group>
      <mesh geometry={geo.plinth} material={mats.white} receiveShadow />
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={mats.floor} receiveShadow>
        <circleGeometry args={[DOME_R + 0.1, 128]} />
      </mesh>
      <FloorRings shared={shared} />
      {/* Glowing band around the plinth and the dome's foot ring. */}
      <mesh position={[0, -0.35, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.band}>
        <torusGeometry args={[PLINTH_R + 0.16, 0.035, 8, 160]} />
      </mesh>
      <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.white}>
        <torusGeometry args={[DOME_R, 0.2, 14, 160]} />
      </mesh>
      <mesh position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.band}>
        <torusGeometry args={[DOME_R - 0.24, 0.035, 6, 160]} />
      </mesh>
      <mesh geometry={geo.frame} material={mats.chrome} />
      {/* Glossy oculus cap with a glowing seam. */}
      <mesh position={[0, CROWN.y, 0]} scale={[1, 0.36, 1]} material={mats.white}>
        <sphereGeometry args={[CROWN.r + 0.12, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={[0, CROWN.y - 0.06, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.band}>
        <torusGeometry args={[CROWN.r + 0.1, 0.05, 6, 64]} />
      </mesh>
      <mesh geometry={geo.domeBack} material={mats.domeBack} renderOrder={-2} />
      <mesh geometry={geo.domeFront} material={mats.domeFront} renderOrder={2} />
      <Tunnel geo={geo.tunnel} mats={mats} floorHeight={floorHeight} />
      <Furniture mats={mats} />
      <PortLights shared={shared} />
      {RIM_VENTS.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.0, z]} material={mats.chrome}>
          <cylinderGeometry args={[0.16, 0.2, 0.06, 16]} />
        </mesh>
      ))}
      <BubbleLamps shared={shared} />
    </group>
  );
}

function Tunnel({ geo, mats, floorHeight }) {
  const end = TUNNEL[TUNNEL.length - 1];
  const pod = [end[0] - 0.6, 0, end[2] - 3.2];
  pod[1] = floorHeight(pod[0], pod[2]) - 0.3;
  return (
    <group>
      <mesh geometry={geo.walk} material={mats.white} />
      <mesh geometry={geo.strip} material={mats.strip} />
      <mesh geometry={geo.rings} material={mats.chrome} />
      <mesh geometry={geo.legs} material={mats.white} />
      <mesh geometry={geo.glass} material={mats.tunnel} renderOrder={1} />
      {/* A smaller pod where the tube ends, fading into the blue. */}
      <mesh position={pod} material={mats.tunnel} renderOrder={1}>
        <sphereGeometry args={[4, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh position={pod} rotation={[Math.PI / 2, 0, 0]} material={mats.white}>
        <torusGeometry args={[4, 0.22, 10, 64]} />
      </mesh>
    </group>
  );
}

// Long low bench pods with aqua cushions and backrests along the side walls.
function Furniture({ mats }) {
  return (
    <group>
      {[-105, 105].map((az) => {
        const a = deg(az);
        const r = DOME_R - 1.35;
        return (
          <group key={az} position={[Math.sin(a) * r, 0, Math.cos(a) * r]} rotation={[0, a, 0]}>
            <mesh position={[0, 0.24, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.5, 1, 0.95]} material={mats.white}>
              <capsuleGeometry args={[0.46, 1.5, 6, 16]} />
            </mesh>
            <mesh position={[0, 0.46, -0.04]} rotation={[0, 0, Math.PI / 2]} scale={[0.36, 1, 0.75]} material={mats.cushion}>
              <capsuleGeometry args={[0.4, 1.4, 6, 16]} />
            </mesh>
            <mesh position={[0, 0.7, 0.36]} rotation={[0.25, 0, Math.PI / 2]} scale={[0.75, 1, 0.32]} material={mats.white}>
              <capsuleGeometry args={[0.4, 1.4, 6, 16]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

const LAMPS = [
  { az: -50, r: DOME_R - 0.85, h: 1.6, color: '#7ff8ff' },
  { az: 50, r: DOME_R - 0.85, h: 1.6, color: '#c8ff7a' },
  { az: -80, r: DOME_R - 0.8, h: 1.9, color: '#c8ff7a' },
  { az: 80, r: DOME_R - 0.8, h: 1.9, color: '#7ff8ff' },
];
// Floating bubble lights, kept inside the glass (x, y, z, radius, color).
const FLOATERS = [
  [-1.7, 4.45, -1.2, 0.2, '#9ffbff'],
  [1.5, 4.5, -1.8, 0.18, '#d6ff8a'],
  [-0.2, 4.85, -0.6, 0.15, '#ffffff'],
  [3.0, 3.95, -1.0, 0.17, '#9ffbff'],
  [-3.2, 3.85, -0.4, 0.16, '#ffffff'],
];

// Glowing gel orb: bright core facing the viewer, colored rim, glossy highlight.
function makeOrb(shared, color) {
  return new THREE.ShaderMaterial({
    uniforms: { uBeat: shared.uBeat, uColor: { value: new THREE.Color(color) } },
    vertexShader: glassVertex,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uBeat;
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vWorld);
        float ndv = max(dot(n, v), 0.0);
        float core = pow(ndv, 2.0);
        float rim = pow(1.0 - ndv, 3.0);
        vec3 L = normalize(vec3(-0.4, 0.8, 0.5));
        float spec = pow(max(dot(reflect(-v, n), L), 0.0), 40.0);
        vec3 col = uColor * (0.9 + core * 2.6 * (0.85 + 0.35 * uBeat)) + uColor * rim * 1.2 + vec3(3.0) * spec;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// Glossy orb lamps on chrome stems plus a few floating bubble lights.
function BubbleLamps({ shared }) {
  const orbs = useDisposable(() => Object.fromEntries(['#7ff8ff', '#c8ff7a', '#9ffbff', '#d6ff8a', '#ffffff'].map((c) => [c, makeOrb(shared, c)])));
  const stemMat = useDisposable(() => patchUnderwater(new THREE.MeshPhysicalMaterial({ color: '#dff6ff', metalness: 1, roughness: 0.15 }), shared));
  const floaters = useRef([]);
  const lights = useRef([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    FLOATERS.forEach(([x, y, z], i) => {
      const o = floaters.current[i];
      if (o) o.position.set(x + Math.sin(t * 0.3 + i * 2) * 0.25, y + Math.sin(t * 0.6 + i * 1.7) * 0.14, z + Math.cos(t * 0.25 + i) * 0.25);
    });
    lights.current.forEach((l) => {
      if (l) l.intensity = 3 + beat.pulse * 2;
    });
  });
  return (
    <group>
      {LAMPS.map(({ az, r, h, color }, i) => {
        const a = deg(az);
        return (
          <group key={az} position={[Math.sin(a) * r, 0, Math.cos(a) * r]}>
            <mesh position={[0, h / 2, 0]} material={stemMat}>
              <cylinderGeometry args={[0.035, 0.07, h, 8]} />
            </mesh>
            <mesh position={[0, 0.05, 0]} material={stemMat}>
              <cylinderGeometry args={[0.22, 0.28, 0.1, 20]} />
            </mesh>
            <mesh position={[0, h + 0.32, 0]} material={orbs[color]}>
              <sphereGeometry args={[0.34, 24, 16]} />
            </mesh>
            {i < 2 && <pointLight ref={(el) => (lights.current[i] = el)} position={[0, h + 0.3, 0]} color={color} intensity={3} distance={8} decay={2} />}
          </group>
        );
      })}
      {FLOATERS.map(([x, y, z, s, color], i) => (
        <mesh key={i} ref={(el) => (floaters.current[i] = el)} position={[x, y, z]} material={orbs[color]}>
          <sphereGeometry args={[s, 20, 12]} />
        </mesh>
      ))}
    </group>
  );
}

// A ring of round port lights around the plinth that chase on the beat.
function PortLights({ shared, count = 72 }) {
  const geometry = useDisposable(() => new THREE.CircleGeometry(0.055, 12));
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime, uBeat: shared.uBeat },
        vertexShader: /* glsl */ `
          varying float vAng;
          void main() {
            vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vAng = atan(wp.z, wp.x);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uBeat;
          varying float vAng;
          void main() {
            float chase = pow(0.5 + 0.5 * sin(vAng * 6.0 - uTime * 2.2), 4.0);
            vec3 col = vec3(0.35, 1.0, 1.0) * (0.7 + chase * 1.6 + uBeat * 0.6);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      dummy.position.set(Math.sin(a) * (PLINTH_R + 0.06), -0.21, Math.cos(a) * (PLINTH_R + 0.06));
      dummy.rotation.set(0, a, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.frustumCulled = false;
    return m;
  }, [geometry, material, count]);
  return <primitive object={mesh} />;
}

/** Glint points for the sparkle layer: dome glass (off the front), ribs and crown. */
export function domeSparklePoints() {
  const pts = [];
  for (let i = 0; i < 70; i++) {
    const az = 40 + ((i * 137.5) % 280);
    const lat = 8 + ((i * 53.3) % 70);
    pts.push(onDome(az, lat, 0.08).toArray());
  }
  for (const az of RIBS) for (const lat of [20, 45, 62]) pts.push(onDome(az, lat, 0.12).toArray());
  for (let i = 0; i < 6; i++) pts.push(onDome(i * 60, CROWN_LAT, 0.15).toArray());
  return pts;
}

// Little vents on the plinth rim, each feeding a bubble stream.
const RIM_VENTS = [-150, -78, -36, 36, 78, 150].map((az) => [Math.sin(deg(az)) * (DOME_R + 0.3), Math.cos(deg(az)) * (DOME_R + 0.3)]);

/** Bubble sources the dome adds: a vent column from the crown and streams from the rim vents. */
export const DOME_BUBBLES = [
  { x: 0, y: DOME_H + 0.6, z: 0, count: 22, size: 1.1 },
  ...RIM_VENTS.map(([x, z], i) => ({ x, y: 0.05, z, count: i % 2 ? 9 : 7, size: 0.75 })),
];
