import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/*
 * A hype sticker NFT as a real object: a domed candy-glass badge (the old art's glossy
 * disc, now with depth, a pearly rim and an aero gloss) with the sticker's subject floating
 * just above it and casting a soft shadow onto it.
 *
 *   bubble:  iridescent soap bubbles on a sky-blue badge
 *   koi:     a kohaku koi seen from above, swimming out over the rim of a peach badge
 *   rainbow: a candy rainbow between two puffy clouds on a lime badge
 *
 * <Sticker id onReady /> renders around the origin facing +z; the badge's radius is 1.
 */

export const STICKER_IDS = ['bubble', 'koi', 'rainbow'];

const BADGES = {
  bubble: { top: '#8fe3ff', bottom: '#0a84d6', rim: '#e6fbff' },
  koi: { top: '#ffd2a6', bottom: '#ff6a1a', rim: '#fff5ea' },
  rainbow: { top: '#d4ff9e', bottom: '#3aa81c', rim: '#f4ffe6' },
};

const srgb = (hex) => new THREE.Color(hex);

// A studio light box for crisp reflections on the glass, like the trophy renders.
function useStudio() {
  const gl = useThree((s) => s.gl);
  return useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    pmrem.dispose();
    return env;
  }, [gl]);
}

// ---------- badge ----------

// [radius, height] of the badge's side, from the back centre round the lip to the dome's top.
const BADGE_PROFILE = [
  [0.001, 0], [0.9, 0], [0.965, 0.02], [0.995, 0.07], [1, 0.12], [0.99, 0.17], [0.96, 0.205],
  [0.9, 0.222], [0.75, 0.238], [0.55, 0.252], [0.3, 0.262], [0.001, 0.265],
];

function badgeGeometry(colors) {
  const geo = new THREE.LatheGeometry(BADGE_PROFILE.map(([r, h]) => new THREE.Vector2(r, h)), 160);
  geo.rotateX(Math.PI / 2); // the lathe's axis (y) now points at the camera (+z)
  // Top-lit candy: light at the top, deep colour at the bottom, and a deeper side wall.
  const top = srgb(colors.top);
  const bottom = srgb(colors.bottom);
  const wall = bottom.clone().multiplyScalar(0.78);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.smoothstep((pos.getY(i) + 1) / 2, 0, 1.05);
    c.copy(bottom).lerp(top, t);
    c.lerp(wall, THREE.MathUtils.smoothstep(0.2 - pos.getZ(i), 0, 0.06));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// The aero gloss: a soft white crescent over the top of the dome.
function glossTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.save();
  g.beginPath();
  g.ellipse(256, 200, 236, 150, 0, 0, Math.PI * 2);
  g.clip();
  const fill = g.createLinearGradient(0, 50, 0, 350);
  fill.addColorStop(0, 'rgba(255,255,255,0.95)');
  fill.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  fill.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = fill;
  g.fillRect(0, 0, 512, 512);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Badge({ id, studio }) {
  const colors = BADGES[id];
  const parts = useMemo(() => ({
    body: badgeGeometry(colors),
    gloss: glossTexture(),
    material: new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.15,
      sheenColor: srgb(colors.top), envMap: studio, envMapIntensity: 0.45,
    }),
    rim: new THREE.MeshPhysicalMaterial({
      color: srgb(colors.rim), roughness: 0.08, clearcoat: 1, iridescence: 0.7, iridescenceIOR: 1.6,
      iridescenceThicknessRange: [250, 700], envMap: studio, envMapIntensity: 1.3,
    }),
  }), [colors, studio]);
  return (
    <group>
      <mesh geometry={parts.body} material={parts.material} receiveShadow />
      {/* A chunky pearly bezel over the whole side wall (bare, it mirrors the grey studio at a grazing angle). */}
      <mesh position-z={0.105} material={parts.rim}>
        <torusGeometry args={[0.955, 0.108, 32, 160]} />
      </mesh>
      {/* The gloss sits on the dome, under the subject. */}
      <mesh position={[0, 0.36, 0.272]} scale={[1.62, 1.62, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={parts.gloss} transparent opacity={0.62} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------- soap bubbles ----------

// A thin film: clear in the middle, a rainbow at the rim, two window highlights.
const soapMaterial = (shift) => new THREE.ShaderMaterial({
  uniforms: { uShift: { value: shift } },
  vertexShader: `
    varying vec3 vNormal; varying vec3 vView;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform float uShift; varying vec3 vNormal; varying vec3 vView;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 v = normalize(vView);
      float f = 1.0 - abs(dot(n, v));
      float rim = pow(f, 2.4);
      vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + f * 1.7 + uShift));
      vec3 r = reflect(-v, n);
      float s1 = pow(max(dot(r, normalize(vec3(-0.55, 0.62, 0.56))), 0.0), 90.0);
      float s2 = pow(max(dot(r, normalize(vec3(0.5, -0.45, 0.74))), 0.0), 40.0) * 0.45;
      vec3 color = mix(vec3(1.0), film, 0.85) * (0.9 + 0.6 * rim) + vec3(s1 + s2) * 2.0;
      float alpha = clamp(0.035 + rim * 0.95 + s1 + s2, 0.0, 1.0);
      gl_FragColor = vec4(color, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  transparent: true,
  depthWrite: false,
});

function SoapBubble({ r, shift = 0, ...props }) {
  const material = useMemo(() => soapMaterial(shift), [shift]);
  return (
    <mesh material={material} renderOrder={2} {...props}>
      <sphereGeometry args={[r, 64, 48]} />
    </mesh>
  );
}

// Soap bubbles don't cast hard shadows: a soft, faint disc under each one instead.
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const fill = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  fill.addColorStop(0, 'rgba(0,40,90,0.5)');
  fill.addColorStop(1, 'rgba(0,40,90,0)');
  g.fillStyle = fill;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function BubbleSubject() {
  const shadow = useMemo(shadowTexture, []);
  const bubbles = [
    { p: [-0.2, 0.1, 0.78], r: 0.5, shift: 0 },
    { p: [0.46, -0.36, 0.62], r: 0.3, shift: 0.3 },
    { p: [0.5, 0.48, 0.56], r: 0.17, shift: 0.55 },
    { p: [-0.52, -0.56, 0.5], r: 0.12, shift: 0.15 },
    { p: [0.12, -0.66, 0.46], r: 0.07, shift: 0.7 },
    { p: [-0.68, 0.46, 0.44], r: 0.06, shift: 0.4 },
  ];
  return (
    <group>
      {bubbles.map(({ p, r, shift }, i) => (
        <group key={i}>
          <mesh position={[p[0] + r * 0.18, p[1] - r * 0.22, 0.268]} renderOrder={1}>
            <planeGeometry args={[r * 2.1, r * 2.1]} />
            <meshBasicMaterial map={shadow} transparent opacity={0.22} depthWrite={false} />
          </mesh>
          <SoapBubble position={p} r={r} shift={shift} />
        </group>
      ))}
    </group>
  );
}

// ---------- koi ----------

// [radius, length] from the nose (0) to the tail stalk.
const KOI_PROFILE = [
  [0.001, 0], [0.085, 0.025], [0.15, 0.08], [0.2, 0.17], [0.225, 0.3], [0.222, 0.44], [0.2, 0.6],
  [0.16, 0.78], [0.11, 0.96], [0.07, 1.1], [0.05, 1.2], [0.04, 1.26], [0.001, 1.28],
];
const KOI_LENGTH = 1.28;
// The body curves as it swims: sideways offset along its length.
const bend = (x) => 0.2 * ((x + KOI_LENGTH / 2) / KOI_LENGTH) ** 2.2;
// Kohaku patches on the back, in the unbent body's coordinates.
const PATCHES = [
  { c: [-0.42, 0.0, 0.16], r: 0.15 },
  { c: [-0.08, 0.06, 0.18], r: 0.2 },
  { c: [0.26, -0.05, 0.14], r: 0.15 },
  { c: [0.5, 0.02, 0.08], r: 0.08 },
];

function koiBodyGeometry() {
  // Many rings along the body, so the patches' edges stay crisp.
  const spline = new THREE.SplineCurve(KOI_PROFILE.map(([r, h]) => new THREE.Vector2(r, h)));
  const geo = new THREE.LatheGeometry(spline.getSpacedPoints(160).map((p) => new THREE.Vector2(Math.max(p.x, 0.001), p.y)), 128);
  geo.rotateZ(-Math.PI / 2); // nose at x = 0, tail towards +x
  geo.translate(-KOI_LENGTH / 2, 0, 0);
  geo.scale(1, 1, 0.62); // wider than it is deep, seen from above
  const white = srgb('#fffaf3');
  const red = srgb('#e2300c');
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let k = 0;
    for (const { c: [x, y, z], r } of PATCHES) {
      const d = Math.hypot(v.x - x, v.y - y, (v.z - z) * 0.8);
      k = Math.max(k, THREE.MathUtils.smoothstep(r - d, -0.006, 0.006));
    }
    c.copy(white).lerp(red, k);
    col.set([c.r, c.g, c.b], i * 3);
    pos.setY(i, v.y + bend(v.x));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function tailGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.03);
  s.bezierCurveTo(0.12, 0.08, 0.3, 0.24, 0.44, 0.3);
  s.bezierCurveTo(0.42, 0.18, 0.32, 0.06, 0.3, 0);
  s.bezierCurveTo(0.32, -0.06, 0.42, -0.18, 0.44, -0.3);
  s.bezierCurveTo(0.3, -0.24, 0.12, -0.08, 0, -0.03);
  s.closePath();
  return new THREE.ShapeGeometry(s, 32);
}

function finGeometry(len, width) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(len * 0.1, width * 0.9, len * 0.75, width * 1.1, len, width * 0.55);
  s.bezierCurveTo(len * 0.8, width * 0.2, len * 0.45, 0.02, 0, 0);
  return new THREE.ShapeGeometry(s, 24);
}

// Fins fade from frosted white at the root to clear at the edge, with fine rays.
function finTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const fill = g.createLinearGradient(0, 0, 256, 0);
  fill.addColorStop(0, 'rgba(255,246,238,1)');
  fill.addColorStop(1, 'rgba(255,160,105,0.85)');
  g.fillStyle = fill;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 2;
  for (let i = 0; i < 22; i++) {
    g.beginPath();
    g.moveTo(0, 128);
    g.lineTo(256, i * 12.2);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function KoiSubject({ studio }) {
  const parts = useMemo(() => {
    const finMap = finTexture();
    // Shape UVs are in shape units; map the fin's box onto the ray texture.
    const fitUv = (geo) => {
      geo.computeBoundingBox();
      const { min, max } = geo.boundingBox;
      const uv = geo.attributes.uv;
      const pos = geo.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (pos.getX(i) - min.x) / (max.x - min.x), (pos.getY(i) - min.y) / (max.y - min.y));
      }
      return geo;
    };
    return {
      body: koiBodyGeometry(),
      tail: fitUv(tailGeometry()),
      pectoral: fitUv(finGeometry(0.32, 0.24)),
      pelvic: fitUv(finGeometry(0.18, 0.12)),
      skin: new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMap: studio, envMapIntensity: 0.6,
      }),
      fin: new THREE.MeshPhysicalMaterial({
        map: finMap, transparent: true, roughness: 0.3, clearcoat: 0.6, side: THREE.DoubleSide,
        emissive: srgb('#ffe2cc'), emissiveMap: finMap, emissiveIntensity: 0.35, envMap: studio, envMapIntensity: 0.6,
      }),
      eye: new THREE.MeshPhysicalMaterial({ color: '#0a1424', roughness: 0.05, clearcoat: 1, envMap: studio, envMapIntensity: 1.5 }),
    };
  }, [studio]);
  const tailX = KOI_LENGTH / 2 - 0.04;
  return (
    // Swimming up and to the left, its tail out over the rim.
    <group position={[0.02, -0.02, 0.56]} rotation-z={-0.62}>
      <mesh geometry={parts.body} material={parts.skin} castShadow />
      <mesh geometry={parts.tail} material={parts.fin} position={[tailX, bend(tailX), 0]} rotation-z={0.22} castShadow />
      {[1, -1].map((side) => (
        <group key={side} scale={[1, side, 1]}>
          <mesh geometry={parts.pectoral} material={parts.fin} position={[-0.3, 0.17 + (side > 0 ? bend(-0.3) : -bend(-0.3)), -0.02]} rotation={[0.25, 0, 1.0]} castShadow />
          <mesh geometry={parts.pelvic} material={parts.fin} position={[0.12, 0.13 + (side > 0 ? bend(0.12) : -bend(0.12)), -0.02]} rotation={[0.25, 0, 0.9]} castShadow />
          <mesh position={[-0.5, 0.105 + (side > 0 ? bend(-0.5) : -bend(-0.5)), 0.07]} material={parts.eye}>
            <sphereGeometry args={[0.03, 24, 16]} />
          </mesh>
        </group>
      ))}
      {/* Barbels at the mouth. */}
      {[1, -1].map((side) => (
        <mesh key={side} position={[-0.6, side * 0.05 + bend(-0.6), 0.02]} rotation-z={side * 0.9 + Math.PI} material={parts.skin}>
          <capsuleGeometry args={[0.008, 0.07, 4, 8]} />
        </mesh>
      ))}
      <SoapBubble position={[-0.86, 0.06, 0.12]} r={0.07} shift={0.2} />
      <SoapBubble position={[-1.02, 0.16, 0.18]} r={0.045} shift={0.6} />
      <SoapBubble position={[-1.12, 0.02, 0.22]} r={0.03} shift={0.4} />
    </group>
  );
}

// ---------- rainbow ----------

const BANDS = ['#e80c26', '#ff7000', '#ffc400', '#12b034', '#0a66ff', '#7424ff'];

function RainbowSubject({ studio }) {
  const outer = 0.78;
  const step = 0.088;
  const tube = 0.047;
  const mid = outer - (step * (BANDS.length - 1)) / 2;
  const materials = useMemo(() => BANDS.map((hex) => new THREE.MeshPhysicalMaterial({
    color: srgb(hex), roughness: 0.22, clearcoat: 0.55, clearcoatRoughness: 0.05, emissive: srgb(hex),
    emissiveIntensity: 0.22, envMap: studio, envMapIntensity: 0.35,
  })), [studio]);
  const cloud = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#ffffff', roughness: 0.42, clearcoat: 0.5, sheen: 1, sheenColor: srgb('#cfeeff'),
    envMap: studio, envMapIntensity: 0.8,
  }), [studio]);
  const puffs = [[0, 0, 0, 0.2], [-0.19, -0.05, -0.02, 0.15], [0.19, -0.05, -0.02, 0.15], [-0.08, 0.13, -0.03, 0.15], [0.1, 0.11, -0.03, 0.16], [0, -0.09, 0.03, 0.15]];
  return (
    <group position={[0, -0.26, 0.5]}>
      {BANDS.map((hex, i) => (
        <mesh key={hex} material={materials[i]} castShadow>
          <torusGeometry args={[outer - i * step, tube, 24, 128, Math.PI]} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * mid, -0.02, 0.06]} scale={[side, 1, 1]}>
          {puffs.map(([x, y, z, r], i) => (
            <mesh key={i} position={[x, y, z]} material={cloud} castShadow>
              <sphereGeometry args={[r, 48, 32]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------- sticker ----------

export default function Sticker({ id }) {
  const studio = useStudio();
  return (
    <group rotation={[-0.13, 0.17, 0]}>
      <Badge id={id} studio={studio} />
      {id === 'bubble' && <BubbleSubject />}
      {id === 'koi' && <KoiSubject studio={studio} />}
      {id === 'rainbow' && <RainbowSubject studio={studio} />}
    </group>
  );
}
