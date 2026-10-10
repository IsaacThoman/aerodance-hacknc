import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { beat, useDisposable } from '../../shared/hooks.js';
import { hash } from '../../shared/glsl.js';
import { show } from './palette.js';
import { makeSkyUniforms, skyFunction, skyUniformsDecl } from './GoldenSky.jsx';
import { beatCount } from './Stage.jsx';

// ---------------------------------------------------------------------------
// Speaker towers: glossy white cabinets with pumping woofers and glow rings.

function useSpeakerParts(env) {
  const geo = useDisposable(() => {
    const cone = new THREE.LatheGeometry(
      [[0.16, -0.17], [0.24, -0.15], [0.34, -0.1], [0.44, -0.04], [0.5, 0.0]].map(([x, y]) => new THREE.Vector2(x, y)),
      40,
    );
    cone.rotateX(Math.PI / 2);
    const surround = new THREE.TorusGeometry(0.5, 0.055, 10, 48);
    const trim = new THREE.TorusGeometry(0.58, 0.035, 8, 48);
    const cap = new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.rotateX(Math.PI / 2);
    cap.scale(1, 1, 0.55);
    return {
      body: new RoundedBoxGeometry(1.5, 3.1, 1.25, 5, 0.28),
      cone,
      surround,
      trim,
      cap,
      grille: new THREE.CircleGeometry(0.16, 24),
      tweeter: new THREE.SphereGeometry(0.13, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      stripe: new THREE.BoxGeometry(1.0, 0.06, 0.02),
    };
  });
  const mats = useDisposable(
    () => ({
      shell: new THREE.MeshPhysicalMaterial({ color: '#fbf8ff', roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, envMap: env, envMapIntensity: 0.8 }),
      cone: new THREE.MeshPhysicalMaterial({ color: '#3b3f72', roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1, envMap: env, envMapIntensity: 0.7 }),
      chrome: new THREE.MeshStandardMaterial({ color: '#f4f6ff', metalness: 1, roughness: 0.1, envMap: env }),
      glow: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      glow2: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    }),
    [env],
  );
  return { geo, mats };
}

function Woofer({ parts, y, scale = 1, phase = 0, ring = 'glow' }) {
  const pump = useRef();
  useFrame(() => {
    const p = Math.exp(-((beat.phase + phase) % 1) * 7);
    pump.current.position.z = 0.05 + p * 0.09 * scale;
    pump.current.scale.setScalar(1 + p * 0.03);
  });
  const { geo, mats } = parts;
  return (
    <group position={[0, y, 0.63]} scale={scale}>
      <mesh geometry={geo.trim} material={mats[ring]} />
      <mesh geometry={geo.surround} material={mats.chrome} />
      <group ref={pump}>
        <mesh geometry={geo.cone} material={mats.cone} position={[0, 0, -0.03]} />
        <mesh geometry={geo.cap} material={mats.chrome} position={[0, 0, -0.12]} />
      </group>
    </group>
  );
}

function SpeakerTower({ parts, position, rotation, phase }) {
  const { geo, mats } = parts;
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={geo.body} material={mats.shell} position={[0, 1.55, 0]} />
      <Woofer parts={parts} y={0.85} scale={1} phase={phase} />
      <Woofer parts={parts} y={2.0} scale={0.72} phase={phase + 0.5} ring="glow2" />
      <group position={[0, 2.72, 0.6]}>
        <mesh geometry={geo.tweeter} material={mats.chrome} rotation={[Math.PI / 2, 0, 0]} />
      </group>
      <mesh geometry={geo.stripe} material={mats.glow2} position={[0, 0.16, 0.63]} />
    </group>
  );
}

export function Speakers({ env }) {
  const parts = useSpeakerParts(env);
  useFrame(() => {
    const k = 1.4 + beat.pulse * 1.8;
    parts.mats.glow.color.copy(show.colors[0]).multiplyScalar(k);
    parts.mats.glow2.color.copy(show.colors[2]).multiplyScalar(1.2 + beat.pulse);
  });
  return (
    <group>
      <SpeakerTower parts={parts} position={[-4.35, 0.12, -2.0]} rotation={[0, 0.55, 0]} phase={0} />
      <SpeakerTower parts={parts} position={[4.35, 0.12, -2.0]} rotation={[0, -0.55, 0]} phase={0} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Glass equalizer: an arc of translucent bars behind the dancer.

export function Equalizer({ count = 16, radius = 4.25, spread = 1.5, gap = 0.5 }) {
  const mesh = useRef();
  const geometry = useDisposable(() => {
    const g = new RoundedBoxGeometry(0.34, 1, 0.34, 3, 0.08);
    g.translate(0, 0.5, 0);
    return g;
  });
  const levels = useDisposable(() => new Float32Array(count));
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uC0: { value: new THREE.Color() },
          uC1: { value: new THREE.Color() },
          uPulse: { value: 0 },
        },
        vertexShader: /* glsl */ `
          attribute float aLevel;
          varying float vH;
          varying float vLevel;
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            vec3 p = position;
            // Fixed-height glass tube; stretch only the shaft so caps stay round.
            float h = 2.5;
            p.y = p.y < 0.5 ? p.y : p.y + (h - 1.0);
            vH = p.y / h;
            vLevel = aLevel;
            vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
            vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uC0, uC1;
          uniform float uPulse;
          varying float vH;
          varying float vLevel;
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            float fres = 1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
            fres = fres * fres;
            float hh = clamp(vH, 0.0, 1.0);
            vec3 col = mix(uC0, uC1, hh);
            // LED segments lit up to the current level, with a peak cap.
            float seg = fract(hh * 11.0);
            float segMask = smoothstep(0.08, 0.2, seg) * smoothstep(0.92, 0.8, seg);
            float lit = 1.0 - smoothstep(vLevel - 0.02, vLevel, hh);
            float peak = exp(-pow((hh - vLevel - 0.05) * 30.0, 2.0));
            vec3 glassCol = vec3(0.95, 0.97, 1.0) * (0.25 + fres * 0.9) + col * 0.12;
            vec3 c = glassCol + col * (0.85 + uPulse * 0.35) * lit * segMask + vec3(1.0) * peak * 0.6;
            float a = clamp(0.08 + fres * 0.45 + lit * segMask * 0.6 + peak * 0.6, 0.0, 1.0);
            gl_FragColor = vec4(c, a);
          }
        `,
      }),
  );
  const attr = useDisposable(() => new THREE.InstancedBufferAttribute(levels, 1));
  const placed = useRef(false);
  const dummy = useDisposable(() => new THREE.Object3D());
  useFrame((state, delta) => {
    const m = mesh.current;
    if (!placed.current) {
      m.geometry.setAttribute('aLevel', attr);
      for (let i = 0; i < count; i++) {
        const half = count / 2;
        const k = i < half ? i / (half - 1) : (i - half) / (half - 1);
        const span = (spread - gap) / 2;
        const a = i < half ? -spread / 2 + k * span : gap / 2 + k * span;
        dummy.position.set(Math.sin(a) * radius, 0.12, -Math.cos(a) * radius);
        dummy.rotation.set(0, -a, 0);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
      placed.current = true;
    }
    const t = state.clock.elapsedTime;
    const b = beatCount();
    for (let i = 0; i < count; i++) {
      const half = count / 2;
      // Bass bins sit nearest the dancer, highs towards the speakers.
      const x = i < half ? 1 - i / (half - 1) : (i - half) / (half - 1);
      const bass = Math.exp(-(x * x) * 3.0) * beat.pulse;
      const hats = Math.exp(-((1 - x) * (1 - x)) * 4.0) * Math.exp(-((b * 2) % 1) * 5);
      const wobble = 0.5 + 0.5 * Math.sin(t * (3.1 + i * 0.73) + i * 1.7) * Math.sin(t * 1.3 + i);
      const target = Math.min(0.92, 0.12 + bass * 0.6 + hats * 0.4 + wobble * 0.32 + show.hype * 0.15);
      // Fast attack, slow release like a real meter.
      const k = target > levels[i] ? 22 : 5;
      levels[i] += (target - levels[i]) * (1 - Math.exp(-k * delta));
    }
    attr.needsUpdate = true;
    const u = material.uniforms;
    u.uC0.value.copy(show.colors[2]);
    u.uC1.value.copy(show.colors[0]);
    u.uPulse.value = beat.pulse;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} renderOrder={2} />;
}

// ---------------------------------------------------------------------------
const WHITE = new THREE.Color(1, 1, 1);

// Disco orb: faceted mirror ball reflecting the golden sky, with sweeping beams.

export function DiscoOrb({ position = [0, 7.5, -0.8], radius = 0.8 }) {
  const group = useRef();
  const ball = useRef();
  const beams = useRef();
  const ballMat = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...makeSkyUniforms(),
          uTime: { value: 0 },
          uBeat: { value: 0 },
          uPulse: { value: 0 },
          uC0: { value: new THREE.Color() },
          uC1: { value: new THREE.Color() },
          uC2: { value: new THREE.Color() },
          uModel: { value: new THREE.Matrix3() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vObj;
          varying vec3 vWorld;
          void main() {
            vObj = normalize(position);
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime, uBeat, uPulse;
          uniform vec3 uC0, uC1, uC2;
          uniform mat3 uModel;
          ${skyUniformsDecl}
          varying vec3 vObj;
          varying vec3 vWorld;
          ${hash}
          ${skyFunction}
          void main() {
            const float PI = 3.14159265;
            vec3 o = normalize(vObj);
            float lat = acos(clamp(o.y, -1.0, 1.0));
            float rows = 16.0;
            float row = floor(lat / PI * rows);
            float latC = (row + 0.5) / rows * PI;
            float cols = max(4.0, floor(2.0 * rows * sin(latC)));
            float lon = atan(o.z, o.x) + PI;
            float col = floor(lon / (2.0 * PI) * cols);
            float lonC = (col + 0.5) / cols * 2.0 * PI - PI;
            vec3 facet = vec3(sin(latC) * cos(lonC), cos(latC), sin(latC) * sin(lonC));
            // Grout between tiles.
            float fr = fract(lat / PI * rows);
            float fc = fract(lon / (2.0 * PI) * cols);
            float grout = smoothstep(0.0, 0.12, min(fr, 1.0 - fr)) * smoothstep(0.0, 0.12, min(fc, 1.0 - fc));
            // Facet normal to world space (the ball only rotates around y).
            vec3 n = normalize(uModel * facet);
            vec3 V = normalize(cameraPosition - vWorld);
            vec3 R = reflect(-V, n);
            vec3 c = skyGradient(R) * 0.9 + sunLight(R, 2.0) * 0.5;
            float id = hash12(vec2(row, col));
            // Some tiles mirror the colored stage lights.
            vec3 stage = id < 0.33 ? uC0 : (id < 0.66 ? uC1 : uC2);
            c = mix(c, stage * 1.2, smoothstep(0.55, 1.0, hash12(vec2(row * 3.1, col + floor(uBeat)))) * 0.6);
            // Glints that flash with the beat.
            float glint = step(0.93, hash12(vec2(col * 1.7, row + floor(uBeat * 2.0)))) * (0.6 + uPulse * 2.5);
            c += vec3(1.0, 0.95, 0.9) * glint * 1.6;
            c *= mix(0.25, 1.0, grout);
            c = c * (0.85 + 0.25 * id);
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
  );
  const capMat = useDisposable(() => new THREE.MeshStandardMaterial({ color: '#f6f2ff', metalness: 1, roughness: 0.15 }));
  const haloMat = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color() }, uPulse: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            mv.xy += position.xy;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uPulse;
          varying vec2 vUv;
          void main() {
            vec2 d = vUv - 0.5;
            float r = length(d) * 2.0;
            float g = exp(-r * r * 4.0) * 0.5 + exp(-r * 9.0) * 0.4;
            // Four-point star flare.
            float star = exp(-abs(d.x) * 60.0) * exp(-abs(d.y) * 4.0) + exp(-abs(d.y) * 60.0) * exp(-abs(d.x) * 4.0);
            float a = (g + star * 0.35) * (0.55 + 0.45 * uPulse) * smoothstep(1.0, 0.7, r);
            gl_FragColor = vec4(uColor * a, 1.0);
          }
        `,
      }),
  );
  const beamMat = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uPulse: { value: 0 }, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() } },
        vertexShader: /* glsl */ `
          attribute float aBeam;
          varying float vAlong;
          varying float vFacing;
          varying float vBeam;
          void main() {
            vAlong = uv.y;
            vBeam = aBeam;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vec3 n = normalize(normalMatrix * normal);
            vFacing = abs(dot(n, normalize(-mv.xyz)));
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uPulse;
          uniform vec3 uC0, uC1, uC2;
          varying float vAlong;
          varying float vFacing;
          varying float vBeam;
          void main() {
            float k = mod(vBeam, 3.0);
            vec3 c = k < 1.0 ? uC0 : (k < 2.0 ? uC1 : uC2);
            float along = clamp(vAlong, 0.0, 1.0);
            float f = clamp(vFacing, 0.0, 1.0);
            float a = along * along * f * f * (0.14 + 0.1 * uPulse);
            gl_FragColor = vec4(c * a, 1.0);
          }
        `,
      }),
  );
  const beamGeo = useDisposable(() => {
    const parts = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const len = 7.5;
      const g = new THREE.CylinderGeometry(0.02, 0.32, len, 12, 1, true);
      g.translate(0, -len / 2, 0);
      const tilt = 0.55 + (i % 3) * 0.22;
      g.rotateX(tilt);
      g.rotateY((i / n) * Math.PI * 2);
      const ids = new Float32Array(g.attributes.position.count).fill(i);
      g.setAttribute('aBeam', new THREE.BufferAttribute(ids, 1));
      parts.push(g);
    }
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  });

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    group.current.position.y = position[1] + Math.sin(t * 1.1) * 0.08;
    ball.current.rotation.y = t * 0.5;
    beams.current.rotation.y = t * 0.5;
    const u = ballMat.uniforms;
    u.uTime.value = t;
    u.uBeat.value = beatCount();
    u.uPulse.value = beat.pulse;
    u.uC0.value.copy(show.colors[0]);
    u.uC1.value.copy(show.colors[1]);
    u.uC2.value.copy(show.colors[2]);
    u.uModel.value.setFromMatrix4(ball.current.matrixWorld);
    haloMat.uniforms.uColor.value.copy(show.colors[1]).lerp(WHITE, 0.4);
    haloMat.uniforms.uPulse.value = beat.pulse;
    const bu = beamMat.uniforms;
    bu.uPulse.value = beat.pulse + show.hype * 0.6;
    bu.uC0.value.copy(show.colors[0]);
    bu.uC1.value.copy(show.colors[1]);
    bu.uC2.value.copy(show.colors[2]);
  });

  return (
    <group ref={group} position={position}>
      <mesh ref={ball} material={ballMat}>
        <sphereGeometry args={[radius, 48, 32]} />
      </mesh>
      <mesh material={capMat} position={[0, radius * 0.98, 0]}>
        <cylinderGeometry args={[0.12, 0.16, 0.14, 20]} />
      </mesh>
      <mesh material={capMat} position={[0, radius * 0.98 + 0.16, 0]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.1, 0.03, 8, 20]} />
      </mesh>
      <mesh ref={beams} geometry={beamGeo} material={beamMat} renderOrder={3} />
      <mesh material={haloMat} renderOrder={4}>
        <planeGeometry args={[radius * 5, radius * 5]} />
      </mesh>
    </group>
  );
}
