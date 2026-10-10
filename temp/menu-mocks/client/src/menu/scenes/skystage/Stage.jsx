import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, useDisposable } from '../../shared/hooks.js';
import { hash } from '../../shared/glsl.js';
import { show } from './palette.js';
import { makeSkyUniforms, skyFunction, skyUniformsDecl } from './GoldenSky.jsx';

export const STAGE_RADIUS = 6;
export const FLOOR_RADIUS = 5.08;

// Continuous beat count (beats since start) for shaders.
export const beatCount = () => beat.beat + beat.phase;

/** Glossy white stage body: rounded lip, glowing groove band, tapered hull. */
function StageBody({ env }) {
  const geometry = useDisposable(() => {
    const pts = [
      [5.0, 0.0], [5.08, 0.06], [5.16, 0.14], [5.3, 0.21], [5.5, 0.25], [5.7, 0.24], [5.86, 0.19],
      [5.97, 0.1], [6.03, -0.02], [6.04, -0.16], [6.0, -0.3], [5.92, -0.4], [5.84, -0.47],
      [5.79, -0.55], [5.78, -0.66], [5.8, -0.76], [5.86, -0.84], [5.88, -0.94], [5.8, -1.08],
      [5.6, -1.3], [5.25, -1.62], [4.75, -1.98], [4.1, -2.34], [3.35, -2.64], [2.6, -2.86],
      [1.95, -3.0], [1.45, -3.08], [1.15, -3.12],
    ].map(([x, y]) => new THREE.Vector2(x, y)).reverse();
    return new THREE.LatheGeometry(pts, 128);
  });
  const material = useDisposable(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#fbf8ff',
        roughness: 0.3,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        iridescence: 0.2,
        iridescenceIOR: 1.3,
        emissive: '#fff2f8',
        emissiveIntensity: 0.04,
        envMap: env,
        envMapIntensity: 0.75,
      }),
    [env],
  );
  return <mesh geometry={geometry} material={material} />;
}

/** Emissive ring set into the hull groove; colors chase around on the beat. */
function GlowBand({ radius = 5.8, y = -0.66, tube = 0.085, speed = 1, intensity = 2.4 }) {
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uBeat: { value: 0 },
          uPulse: { value: 0 },
          uC0: { value: new THREE.Color() },
          uC1: { value: new THREE.Color() },
          uC2: { value: new THREE.Color() },
          uIntensity: { value: intensity },
        },
        vertexShader: /* glsl */ `
          varying vec3 vPos;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vPos = position;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uBeat, uPulse, uIntensity;
          uniform vec3 uC0, uC1, uC2;
          varying vec3 vPos;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            float a = atan(vPos.y, vPos.x) / 6.2831853 + 0.5;
            float s = fract(a * 12.0 - uBeat * 0.5 * ${speed.toFixed(2)});
            vec3 col = mix(uC0, uC1, smoothstep(0.2, 0.5, s));
            col = mix(col, uC2, smoothstep(0.6, 0.9, s));
            float core = pow(max(dot(normalize(vNormal), normalize(vView)), 0.0), 0.6);
            float chase = 0.55 + 0.45 * smoothstep(0.0, 0.25, s) * smoothstep(1.0, 0.6, s);
            vec3 c = col * uIntensity * (0.6 + 0.4 * uPulse) * chase * (0.5 + 0.7 * core) + vec3(0.6) * core * 0.4;
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
  );
  useFrame(() => {
    const u = material.uniforms;
    u.uBeat.value = beatCount();
    u.uPulse.value = beat.pulse;
    u.uC0.value.copy(show.colors[0]);
    u.uC1.value.copy(show.colors[1]);
    u.uC2.value.copy(show.colors[2]);
  });
  return (
    <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={material}>
      <torusGeometry args={[radius, tube, 12, 160]} />
    </mesh>
  );
}

/** Polar-tiled LED dance floor with beat-synced patterns, glossy sky reflection and disco spots. */
function LedFloor() {
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...makeSkyUniforms(),
          uTime: { value: 0 },
          uBeat: { value: 0 },
          uPulse: { value: 0 },
          uBurst: { value: 0 },
          uC0: { value: new THREE.Color() },
          uC1: { value: new THREE.Color() },
          uC2: { value: new THREE.Color() },
        },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          varying vec3 vWorld;
          void main() {
            vP = position.xy;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime, uBeat, uPulse, uBurst;
          uniform vec3 uC0, uC1, uC2;
          ${skyUniformsDecl}
          varying vec2 vP;
          varying vec3 vWorld;
          ${hash}
          ${skyFunction}

          vec3 pick(float k) {
            k = fract(k);
            return k < 0.333 ? uC0 : (k < 0.666 ? uC1 : uC2);
          }

          void main() {
            const float TAU = 6.2831853;
            float r = length(vP);
            float a01 = atan(vP.y, vP.x) / TAU + 0.5;
            float ringW = 0.58;
            float ring = floor(r / ringW);
            float sectors = ring < 0.5 ? 1.0 : 6.0 * ring;
            float fr = fract(r / ringW);
            float fa = fract(a01 * sectors);
            float sec = floor(a01 * sectors);
            float edgeR = min(fr, 1.0 - fr) * ringW;
            float edgeA = min(fa, 1.0 - fa) * (TAU * r / sectors);
            float edge = ring < 0.5 ? (1.0 - fr) * ringW : min(edgeR, edgeA);
            float grout = smoothstep(0.018, 0.045, edge);
            float bevel = smoothstep(0.04, 0.13, edge);
            float id = hash12(vec2(ring * 7.0 + 1.0, sec + 3.0));

            float b = uBeat;
            float ph = fract(b);
            float mode = mod(floor(b / 8.0), 4.0);
            float rings = 9.0;
            float lit = 0.0;
            vec3 tint = pick(id);
            if (mode < 0.5) {
              // Ripples rolling outward from the dancer on every beat.
              float front = ph * (rings + 3.0) - 1.0;
              lit = exp(-pow(ring - front, 2.0) * 0.9);
              lit += 0.22 * step(1.0, mod(ring + floor(b), 2.0));
              tint = pick(ring * 0.34 + floor(b) * 0.34);
            } else if (mode < 1.5) {
              // Pinwheel arms sweeping around.
              float s = fract(a01 * 3.0 + r * 0.09 - b * 0.25);
              lit = smoothstep(0.3, 0.05, abs(s - 0.5)) * 0.9 + 0.12;
              tint = pick(floor(a01 * 3.0 + r * 0.09 - b * 0.25) * 0.34);
            } else if (mode < 2.5) {
              // Checkerboard that flips on the beat.
              float parity = mod(ring + sec + floor(b), 2.0);
              lit = parity * (0.3 + 0.7 * uPulse) + 0.06;
              tint = pick(floor(b) * 0.34 + parity * 0.34);
            } else {
              // Random tiles twinkling on eighth notes.
              float e8 = floor(b * 2.0);
              float rnd = hash12(vec2(ring * 13.0 + sec, e8));
              lit = step(0.68, rnd) * exp(-fract(b * 2.0) * 2.5) + 0.1;
              tint = pick(rnd * 3.0);
            }
            // Ring of light that bursts out when DANCE! is pressed.
            float burstFront = uBurst * 9.0;
            lit += exp(-pow(r - burstFront, 2.0) * 1.5) * smoothstep(1.2, 0.2, uBurst) * 1.5;
            lit = clamp(lit, 0.0, 1.6);

            // Frosted pearl glass tiles.
            vec3 base = mix(vec3(0.32, 0.3, 0.5), vec3(0.5, 0.47, 0.7), bevel);
            base *= 0.9 + 0.1 * id;
            vec3 V = normalize(cameraPosition - vWorld);
            vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
            vec3 refl = skyGradient(R) + sunLight(R, 3.0);
            float fres = 0.1 + 0.5 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
            vec3 col = base * 0.8 + refl * fres;
            col = mix(col, tint * (0.8 + 1.5 * lit), clamp(lit, 0.0, 1.0) * mix(0.5, 0.92, bevel));
            col += tint * lit * 0.35 * (1.0 - bevel) * grout;

            // Disco ball spots drifting over the floor.
            for (int i = 0; i < 7; i++) {
              float fi = float(i);
              float ang = fi * 0.897 + uTime * (0.35 + 0.05 * fi);
              float rad = 1.4 + mod(fi * 1.7, 3.4);
              vec2 sp = vec2(cos(ang), sin(ang)) * rad;
              float spot = smoothstep(0.42, 0.18, length(vP - sp));
              col += pick(fi * 0.34) * spot * 0.75;
            }

            col = mix(vec3(0.85, 0.82, 0.95), col, grout);
            // Soft contact shadow under the dancer.
            col *= 1.0 - 0.28 * exp(-r * r / 0.6);
            // Fade to the lip.
            col = mix(col, vec3(0.92, 0.9, 0.97), smoothstep(${(FLOOR_RADIUS - 0.08).toFixed(2)}, ${FLOOR_RADIUS.toFixed(2)}, r));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );
  useFrame((state) => {
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uBeat.value = beatCount();
    u.uPulse.value = beat.pulse;
    u.uBurst.value = show.burst;
    u.uC0.value.copy(show.colors[0]);
    u.uC1.value.copy(show.colors[1]);
    u.uC2.value.copy(show.colors[2]);
  });
  return (
    <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} material={material}>
      <circleGeometry args={[FLOOR_RADIUS + 0.04, 128]} />
    </mesh>
  );
}

/** Marquee bulbs around the stage lip, chasing on eighth notes. */
function RimBulbs({ count = 56, radius = 5.52, y = 0.29, size = 0.075, rate = 2 }) {
  const mesh = useRef();
  const dummy = useDisposable(() => new THREE.Object3D());
  const color = useDisposable(() => new THREE.Color());
  const geometry = useDisposable(() => new THREE.SphereGeometry(size, 12, 8), [size]);
  const material = useDisposable(() => new THREE.MeshBasicMaterial({ toneMapped: true }));
  const placed = useRef(false);
  useFrame(() => {
    const m = mesh.current;
    if (!placed.current) {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        dummy.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
      placed.current = true;
    }
    const b = beatCount();
    const step = Math.floor(b * rate);
    for (let i = 0; i < count; i++) {
      const k = (i + step) % 4;
      const on = k === 0 ? 1 : k === 2 ? 0.45 : 0.12;
      color.copy(show.colors[(i >> 2) % 3]).multiplyScalar(0.4 + on * (1.8 + beat.pulse * 1.2));
      color.r += 0.25;
      color.g += 0.25;
      color.b += 0.25;
      m.setColorAt(i, color);
    }
    m.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} />;
}

/** Glowing anti-gravity emitter under the hull and a soft beam into the clouds. */
function Underglow() {
  const beamMat = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uPulse: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying float vFacing;
          void main() {
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vec3 n = normalize(normalMatrix * normal);
            vFacing = abs(dot(n, normalize(-mv.xyz)));
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uTime, uPulse;
          varying vec2 vUv;
          varying float vFacing;
          void main() {
            float along = clamp(vUv.y, 0.0, 1.0); // 1 at the top (emitter), 0 at the bottom
            float fade = along * along;
            float streak = 0.75 + 0.25 * sin(vUv.x * 50.0 + uTime * 2.0) * sin(vUv.x * 23.0 - uTime * 1.3);
            float f = clamp(vFacing, 0.0, 1.0);
            float a = fade * f * sqrt(f) * streak * (0.22 + 0.1 * uPulse);
            gl_FragColor = vec4(uColor * a, 1.0);
          }
        `,
      }),
  );
  const coreMat = useDisposable(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  const ringMat = useDisposable(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  useFrame((state) => {
    const u = beamMat.uniforms;
    u.uColor.value.copy(show.colors[2]).lerp(show.colors[0], 0.3);
    u.uTime.value = state.clock.elapsedTime;
    u.uPulse.value = beat.pulse;
    coreMat.color.copy(show.colors[2]).multiplyScalar(1.6 + beat.pulse * 0.8).addScalar(0.4);
    ringMat.color.copy(show.colors[0]).multiplyScalar(1.4 + beat.pulse).addScalar(0.2);
  });
  return (
    <group>
      <mesh position={[0, -3.12, 0]} material={coreMat} scale={[1, 0.45, 1]}>
        <sphereGeometry args={[1.12, 32, 16]} />
      </mesh>
      <mesh position={[0, -2.92, 0]} rotation={[Math.PI / 2, 0, 0]} material={ringMat}>
        <torusGeometry args={[1.95, 0.06, 8, 96]} />
      </mesh>
      <mesh position={[0, -10.5, 0]} material={beamMat}>
        <cylinderGeometry args={[1.0, 3.4, 14, 48, 1, true]} />
      </mesh>
    </group>
  );
}

export function Stage({ env, children }) {
  return (
    <group>
      <StageBody env={env} />
      <LedFloor />
      <RimBulbs />
      <RimBulbs count={34} radius={4.8} y={-1.96} size={0.085} rate={1} />
      <GlowBand />
      <Underglow />
      {children}
    </group>
  );
}
