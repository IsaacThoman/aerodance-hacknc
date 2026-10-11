import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import Character from '../../../../packages/character/Character.jsx';

/*
 * The trophy NFT as a real object on a stage's dance floor, built from server/trophyArt.js's
 * traits: a white glass pedestal with a WINNER plate, the trophy itself (tinted glass with a
 * drink in it, polished chrome, or iridescent opal), halo rings and the winner's light
 * column, soap bubbles for pops and glints for flair. Shapes follow the SVG's: the Classic
 * and Goblet bowls are its Béziers turned on a lathe, the Bubble holds a little glass dancer
 * and the Dancer is the game's own character holding its hands-up pose.
 *
 * <Trophy battle traits motion position bloomThreshold onReady />
 *   bloomThreshold: the stage's (meta.post); glows are kept under it on low-threshold stages.
 *
 * userData flags for pipeline.jsx: `trophy` on the group (its silhouette lifts it off the
 * backdrop), `noDepth` on the glows (left out of the depth of field and the silhouette) and
 * `noMask` on the floating bubbles (blurred like the stage, not part of the silhouette).
 */

const GOLD = '#ffd34d';
const U = 1 / 270; // trophyArt.js's SVG units to world units (the dancers are ~2.6 tall)
const PEDESTAL_H = 0.4;
const BOWL_BASE = 0.84;
const DANCER_POSE = 5; // seconds into the dance capture: both hands up
const WALL = 0.028;

// The SVG bowls' cubic Béziers as [radius, y], from the rim down to the stem at y 602.
const BOWLS = {
  Classic: [[165, 300], [165, 470], [80, 590], [0, 602]],
  Goblet: [[125, 258], [130, 420], [60, 575], [0, 602]],
};
BOWLS.Star = BOWLS.Classic;
const HANDLES = [[[657, 345], [750, 330], [755, 470], [608, 520]]];

const hsl = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l, THREE.SRGBColorSpace);
const hdr = (color, k) => new THREE.Color(color).multiplyScalar(k);
const svgPoint = ([x, y]) => new THREE.Vector3((x - 500) * U, (602 - y) * U, 0);

// Deterministic [0, 1) numbers for a battle's bubble and glint layout.
function seeded(text) {
  let a = 2166136261;
  for (const c of text) a = Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [radius, height] from the stem (height 0) up to the rim.
function bowlProfile(curve, steps = 48) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = 1 - i / steps;
    const u = 1 - t;
    const [r, y] = [0, 1].map((k) => u * u * u * curve[0][k] + 3 * u * u * t * curve[1][k] + 3 * u * t * t * curve[2][k] + t * t * t * curve[3][k]);
    return [r * U, (602 - y) * U];
  });
}

// A glass bowl with a real wall: up the outside, over the lip and down the inside.
function shellGeometry(profile) {
  const outer = profile.map(([r, h]) => new THREE.Vector2(Math.max(r, 0.002), h));
  const inner = profile.filter(([r]) => r > WALL * 1.4).reverse().map(([r, h]) => new THREE.Vector2(r - WALL, Math.max(h, WALL * 2)));
  return new THREE.LatheGeometry([...outer, ...inner, new THREE.Vector2(0.002, WALL * 2)], 128);
}

// The drink inside the glass, filled to `level` of the bowl's height.
function drinkGeometry(profile, level) {
  const top = profile[profile.length - 1][1] * level;
  const wall = profile.filter(([r, h]) => h > WALL * 2.4 && h < top && r > WALL * 1.6);
  const pts = [new THREE.Vector2(0.002, WALL * 2.4), ...wall.map(([r, h]) => new THREE.Vector2(r - WALL - 0.006, h))];
  const last = pts[pts.length - 1];
  pts.push(new THREE.Vector2(last.x, top), new THREE.Vector2(0.002, top));
  return new THREE.LatheGeometry(pts, 128);
}

// Foot, stem with a knob, and the collar the bowl sits in.
function stemGeometry() {
  const p = [
    [0.002, PEDESTAL_H], [0.36, PEDESTAL_H], [0.375, PEDESTAL_H + 0.02], [0.35, PEDESTAL_H + 0.05], [0.14, PEDESTAL_H + 0.08],
    [0.06, PEDESTAL_H + 0.13], [0.045, 0.58], [0.085, 0.61], [0.095, 0.64], [0.085, 0.67], [0.045, 0.7], [0.05, 0.78],
    [0.12, 0.81], [0.13, 0.83], [0.11, BOWL_BASE + 0.01], [0.002, BOWL_BASE + 0.01],
  ];
  return new THREE.LatheGeometry(p.map(([r, h]) => new THREE.Vector2(r, h)), 96);
}

function starGeometry(outer, inner) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 5 });
  geo.center();
  return geo;
}

// Four-point glint like the UI's drawSparkle, white with an aqua glow.
function sparkleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  g.shadowColor = 'rgba(160,240,255,1)';
  g.shadowBlur = 18;
  const s = 50;
  const w = s * 0.16;
  g.beginPath();
  g.moveTo(0, -s);
  g.quadraticCurveTo(w, -w, s, 0);
  g.quadraticCurveTo(w, w, 0, s);
  g.quadraticCurveTo(-w, w, -s, 0);
  g.quadraticCurveTo(-w, -w, 0, -s);
  g.fillStyle = '#ffffff';
  g.fill();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The pedestal's WINNER plate: a glass pill with navy small caps.
function plateTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.beginPath();
  g.roundRect(8, 8, 496, 112, 56);
  const body = g.createLinearGradient(0, 8, 0, 120);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.5, '#d6f6ff');
  body.addColorStop(0.51, '#b0e8fa');
  body.addColorStop(1, '#defcff');
  g.fillStyle = body;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.font = '800 58px "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
  if ('letterSpacing' in g) g.letterSpacing = '16px';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#0c2f52';
  g.fillText('WINNER', 264, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Soft additive light: a column fading up and towards its silhouette, or a floor glow.
const glowMaterial = (color, opacity, kind) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: color }, uOpacity: { value: opacity } },
  vertexShader: `
    varying float vFace; varying vec2 vUv;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec3 n = normalize(mat3(modelMatrix) * normal);
      vFace = abs(dot(n, normalize(cameraPosition - wp.xyz)));
      vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uOpacity; varying float vFace; varying vec2 vUv;
    void main() {
      float a = ${kind === 'column'
        ? 'pow(vFace, 3.0) * smoothstep(1.0, 0.0, vUv.y) * smoothstep(0.0, 0.04, vUv.y)'
        : 'pow(max(1.0 - length(vUv - 0.5) * 2.0, 0.0), 2.2)'};
      gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
});

// A studio light box for the trophy's own reflections, so chrome and glass get crisp
// highlights even on stages whose environment is a soft, even haze (the reefs).
function useStudio() {
  const gl = useThree((s) => s.gl);
  return useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    pmrem.dispose();
    return env;
  }, [gl]);
}

function useMaterials(traits, studio, k) {
  return useMemo(() => {
    const { hue } = traits;
    const glass = new THREE.MeshPhysicalMaterial({
      // Tinted enough to read as coloured glass against any stage, still clear enough to see through.
      color: hsl(hue, 0.75, 0.8), transmission: 1, thickness: 0.18, roughness: 0.015, ior: 1.5,
      attenuationColor: hsl(hue, 0.95, 0.55), attenuationDistance: 0.9, clearcoat: 1, clearcoatRoughness: 0.02,
      specularIntensity: 1, envMap: studio, envMapIntensity: 1.1, side: THREE.DoubleSide,
    });
    const chrome = new THREE.MeshPhysicalMaterial({
      color: hsl(hue, 0.5, 0.76), metalness: 1, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMap: studio, envMapIntensity: 1.25,
    });
    // Pearly rather than clear, so it holds its own against bright stages.
    const opal = new THREE.MeshPhysicalMaterial({
      color: hsl(hue, 0.45, 0.88), transmission: 0.45, thickness: 0.5, roughness: 0.06, ior: 1.45, iridescence: 1, iridescenceIOR: 1.9,
      iridescenceThicknessRange: [300, 1100], sheen: 0.6, sheenColor: hsl((hue + 60) % 360, 0.8, 0.7), clearcoat: 1,
      envMap: studio, envMapIntensity: 0.9, side: THREE.DoubleSide,
    });
    const surface = { Glass: glass, Chrome: chrome, Iridescent: opal }[traits.finish];
    return {
      surface,
      glass,
      chrome,
      trim: new THREE.MeshPhysicalMaterial({ color: hsl(hue, 0.25, 0.86), metalness: 1, roughness: 0.08, clearcoat: 0.6, envMap: studio, envMapIntensity: 1.1 }),
      // Transmissive glass only shows opaque things behind it, so the drink and its fizz are
      // opaque, lit from within instead.
      drink: new THREE.MeshPhysicalMaterial({
        color: hsl(hue, 0.95, 0.58), roughness: 0.06, clearcoat: 1, sheen: 0.4, sheenColor: hsl(hue, 1, 0.8),
        emissive: hsl(hue, 1, 0.5), emissiveIntensity: 0.55, envMapIntensity: 1.6,
      }),
      fizz: new THREE.MeshPhysicalMaterial({
        color: '#ffffff', roughness: 0.05, clearcoat: 1, emissive: hsl(hue, 0.6, 0.85), emissiveIntensity: 0.6, envMapIntensity: 2,
      }),
      pedestal: new THREE.MeshPhysicalMaterial({ color: '#cfe6f2', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, envMap: studio, envMapIntensity: 0.75 * k }),
      band: new THREE.MeshPhysicalMaterial({ color: hsl(hue, 0.7, 0.62), roughness: 0.08, clearcoat: 1, metalness: 0.2, envMap: studio, envMapIntensity: 1 }),
      // Clear soap film: see-through, with the environment and a rainbow sheen on the rim.
      soap: new THREE.MeshPhysicalMaterial({
        color: '#ffffff', transmission: 1, thickness: 0.01, ior: 1.05, roughness: 0, iridescence: 1, iridescenceIOR: 1.33,
        iridescenceThicknessRange: [260, 820], specularIntensity: 1, clearcoat: 1, envMapIntensity: 3,
      }),
    };
  }, [traits, studio, k]);
}

/**
 * Restyles a Character's gel to the trophy's finish (it sets its own on mount). `opaque`
 * keeps it visible through transmissive glass (the dancer inside the Bubble).
 */
function FinishedCharacter({ finish, color, scale, motion, playback, studio, opaque = false, opacity = 0.97, ...props }) {
  const group = useRef();
  useFrame(() => {
    group.current?.traverse((o) => {
      if (!o.isMesh || o.material.name !== 'AquaGel') return;
      const m = o.material;
      // Studio reflections give the gel more contrast than a bright, hazy stage would.
      Object.assign(m, { envMap: studio, envMapIntensity: 1.2 });
      if (finish === 'Chrome') Object.assign(m, { metalness: 1, roughness: 0.04, opacity: 1, clearcoat: 1 });
      if (finish === 'Iridescent') Object.assign(m, { iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [180, 900], opacity: 0.82 });
      if ((opaque || finish === 'Chrome') && m.transparent) Object.assign(m, { transparent: false, opacity: 1, depthWrite: true, needsUpdate: true });
    });
  }, -2);
  // Nearly solid (the game's dancers are 0.85) so the figurine doesn't fade into the stage.
  const appearance = useMemo(() => ({ color: `#${color.getHexString()}`, gloss: 95, accessory: 'None', opacity }), [color, opacity]);
  return (
    <group ref={group} scale={[-scale, scale, scale]} {...props}>
      <Character appearance={appearance} motion={motion} person={0} playback={playback} />
    </group>
  );
}

function Loaded({ onLoaded }) {
  useLayoutEffect(() => onLoaded(), [onLoaded]);
  return null;
}

export default function Trophy({ battle, traits, motion, position, bloomThreshold = 2, onReady }) {
  // Glows and lights scale down on stages that bloom early (the club), so they glow instead
  // of flaring.
  const k = Math.min(1, Math.max(0.4, bloomThreshold / 2));
  const studio = useStudio();
  const m = useMaterials(traits, studio, k);
  const light = traits.aura ? GOLD : traits.stage.accent[0];
  const playback = useMemo(() => ({ current: DANCER_POSE }), []);
  const needsDancer = traits.cup === 'Dancer' || traits.cup === 'Bubble';

  const parts = useMemo(() => {
    const curve = BOWLS[traits.cup];
    const profile = curve && bowlProfile(curve);
    return {
      profile,
      shell: profile && shellGeometry(profile),
      drink: profile && drinkGeometry(profile, 0.58),
      rim: profile && profile[profile.length - 1],
      stem: stemGeometry(),
      handles: traits.cup === 'Goblet' ? [] : HANDLES.flatMap((h) => [1, -1].map((side) =>
        new THREE.TubeGeometry(new THREE.CubicBezierCurve3(...h.map((p) => svgPoint(p).multiply(new THREE.Vector3(side, 1, 1)))), 64, 0.036, 20))),
      star: starGeometry(0.3, 0.13),
      sparkle: sparkleTexture(),
      plate: plateTexture(),
    };
  }, [traits]);

  // Bubbles for pops and glints for flair, around the trophy but clear of it.
  const scatter = useMemo(() => {
    const rand = seeded(`trophy3d:${battle.id}`);
    const away = () => {
      let x = (rand() * 2 - 1) * 2.6;
      if (Math.abs(x) < 0.9) x = Math.sign(x || 1) * (0.9 + rand() * 0.6);
      return x;
    };
    return {
      bubbles: Array.from({ length: Math.min(24, 6 + Math.round(battle.pops * 0.35)) }, () =>
        ({ position: [away(), 0.5 + rand() * 2.6, -1.2 + rand() * 2.4], r: 0.05 + rand() * 0.16 })),
      sparkles: Array.from({ length: Math.min(12, 3 + Math.round(battle.flair / 8)) }, () =>
        ({ position: [away() * 0.8, 0.5 + rand() * 2.3, 0.3 + rand() * 0.8], s: 0.07 + rand() * 0.13 })),
      fizz: Array.from({ length: 9 }, () => ({ a: rand() * Math.PI * 2, d: rand(), h: rand(), r: 0.012 + rand() * 0.03 })),
    };
  }, [battle]);

  useLayoutEffect(() => {
    if (!needsDancer) onReady();
  }, [needsDancer, onReady]);

  // Deeper than the game's dancers: the gel lightens towards the feet and glows at the rim.
  const dancerColor = useMemo(() => hsl(traits.hue, 1, 0.4), [traits]);
  const bowlTop = parts.rim ? BOWL_BASE + parts.rim[1] : 0;
  const glows = useMemo(() => ({
    floor: glowMaterial(hdr(light, 0.6 * k), 0.45, 'disc'),
    column: glowMaterial(hdr(light, 0.7 * k * k), 0.3, 'column'),
  }), [light, k]);
  // Spotlight targets live in the trophy's group so they follow it onto each stage.
  const targets = useMemo(() => [1.1, 1.3].map((y) => {
    const t = new THREE.Object3D();
    t.position.set(0, y, 0);
    return t;
  }), []);

  return (
    <group position={position} userData={{ trophy: true }}>
      {/* Halo rings and floor glow on the dance floor, and the winner's light column. */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.015} material={glows.floor} userData={{ noDepth: true }}>
        <planeGeometry args={[4.6, 4.6]} />
      </mesh>
      {[0.95, 1.4, 1.85].map((r, i) => (
        <mesh key={r} rotation-x={-Math.PI / 2} position-y={0.02 + i * 0.001} userData={{ noDepth: true }}>
          <ringGeometry args={[r - 0.016 + i * 0.004, r + 0.016 - i * 0.004, 160]} />
          <meshBasicMaterial color={hdr(light, (2.2 - i * 0.4) * k)} transparent opacity={0.9 - i * 0.2} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      <mesh position-y={3.6} material={glows.column} userData={{ noDepth: true }}>
        <cylinderGeometry args={[0.85, 0.95, 7.2, 64, 1, true]} />
      </mesh>

      {/* Pedestal with its WINNER plate and a glowing rim. */}
      <mesh position-y={PEDESTAL_H / 2} material={m.pedestal} castShadow receiveShadow>
        <cylinderGeometry args={[0.6, 0.64, PEDESTAL_H, 96]} />
      </mesh>
      <mesh position-y={PEDESTAL_H * 0.86} material={m.band}>
        <cylinderGeometry args={[0.608, 0.612, 0.05, 96]} />
      </mesh>
      <mesh position-y={PEDESTAL_H} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.6, 0.012, 12, 128]} />
        <meshBasicMaterial color={hdr(light, 2 * k)} />
      </mesh>
      <mesh position={[0, PEDESTAL_H * 0.48, 0.645]} rotation-x={-0.05}>
        <planeGeometry args={[0.52, 0.13]} />
        <meshBasicMaterial map={parts.plate} transparent toneMapped={false} />
      </mesh>

      {traits.cup === 'Dancer' && (
        <Suspense fallback={null}>
          <FinishedCharacter finish={traits.finish} color={dancerColor} scale={0.52} position-y={PEDESTAL_H + 0.01} motion={motion} playback={playback} studio={studio} />
          <Loaded onLoaded={onReady} />
        </Suspense>
      )}

      {traits.cup !== 'Dancer' && <mesh geometry={parts.stem} material={m.trim} castShadow />}

      {traits.cup === 'Bubble' && (
        <group position-y={BOWL_BASE + 0.58}>
          <mesh material={traits.finish === 'Iridescent' ? m.surface : m.glass}>
            <sphereGeometry args={[0.62, 96, 64]} />
          </mesh>
          <mesh position-y={-0.34} material={m.band}>
            <cylinderGeometry args={[0.36, 0.38, 0.035, 64]} />
          </mesh>
          <Suspense fallback={null}>
            <FinishedCharacter finish={traits.finish} color={dancerColor} scale={0.26} position-y={-0.32} motion={motion} playback={playback} studio={studio} opaque />
            <Loaded onLoaded={onReady} />
          </Suspense>
        </group>
      )}

      {parts.shell && (
        <group position-y={BOWL_BASE}>
          <mesh geometry={parts.shell} material={m.surface} castShadow />
          {/* A crisp lip, like the SVG's white rim. */}
          <mesh position-y={parts.rim[1]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[parts.rim[0] - WALL / 2, WALL * 0.6, 12, 160]} />
            <meshBasicMaterial color={hdr('#ffffff', (traits.finish === 'Chrome' ? 0.9 : 1.3) * k)} />
          </mesh>
          {traits.finish === 'Glass' && <mesh geometry={parts.drink} material={m.drink} />}
          {traits.finish === 'Glass' && scatter.fizz.map(({ a, d, h, r }, i) => {
            const y = 0.12 + h * parts.rim[1] * 0.42;
            const at = parts.profile.find(([, ph]) => ph >= y) ?? parts.rim;
            const rad = Math.max(0, at[0] - WALL - 0.04) * d;
            return (
              <mesh key={i} position={[Math.cos(a) * rad, y, Math.sin(a) * rad]} material={m.fizz}>
                <sphereGeometry args={[r, 16, 12]} />
              </mesh>
            );
          })}
          {parts.handles.map((geo, i) => <mesh key={i} geometry={geo} material={m.surface} castShadow />)}
          {traits.cup === 'Star' && (
            <>
              <mesh position-y={parts.rim[1] + 0.12} material={m.trim}>
                <cylinderGeometry args={[0.018, 0.018, 0.5, 16]} />
              </mesh>
              <mesh geometry={parts.star} position-y={parts.rim[1] + 0.48} material={m.surface} />
            </>
          )}
          <pointLight position-y={parts.rim[1] * 0.45} color={hsl(traits.hue, 0.9, 0.6)} intensity={{ Glass: 2.2, Chrome: 0.4, Iridescent: 0.8 }[traits.finish] * k} distance={2.2} />
        </group>
      )}

      {/* Key and rim light so the trophy reads on every stage. */}
      {targets.map((t, i) => <primitive key={i} object={t} />)}
      <spotLight position={[2.4, 5.2, 5]} angle={0.42} penumbra={0.8} intensity={70 * k * k} decay={2} color="#fff8f0" target={targets[0]} />
      <spotLight position={[-2.6, 3.6, -3]} angle={0.5} penumbra={0.9} intensity={40 * k} decay={2} color={light} target={targets[1]} />
      {traits.aura && <pointLight position={[0, Math.max(1.4, bowlTop * 0.8), -0.7]} color={GOLD} intensity={2.5 * k} distance={4} />}

      {scatter.bubbles.map(({ position: p, r }, i) => (
        <mesh key={i} position={p} material={m.soap} userData={{ noMask: true }}>
          <sphereGeometry args={[r, 32, 24]} />
        </mesh>
      ))}
      {scatter.sparkles.map(({ position: p, s }, i) => (
        <sprite key={i} position={p} scale={[s, s, s]} userData={{ noDepth: true }}>
          <spriteMaterial map={parts.sparkle} color={hdr('#ffffff', 2.5 * k)} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </group>
  );
}
