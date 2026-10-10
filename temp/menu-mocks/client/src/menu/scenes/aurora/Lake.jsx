import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { useDisposable } from '../../shared/hooks.js';
import { noise } from '../../shared/glsl.js';
import { env, NO_REFLECT } from './state.js';
import { FAR_SHORE_Z, landDistance } from './terrain.js';
import { makeRandom } from '../../shared/random.js';
import { lanternState } from './lanterns.js';

const WaterShader = {
  name: 'AuroraLakeWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uMoonDir: { value: new THREE.Vector3() },
    uWarmPos: { value: new THREE.Vector3() },
    uWarmCol: { value: new THREE.Color() },
    uHazeCol: { value: new THREE.Color() },
    uAuroraGlow: { value: new THREE.Color() },
    uRings: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
    uDrop: { value: new THREE.Vector4(1e5, 1e5, 99, 0) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec3 uMoonDir, uWarmPos, uWarmCol, uHazeCol, uAuroraGlow;
    uniform vec3 uRings[6];
    uniform vec4 uDrop;
    varying vec4 vUv;
    varying vec3 vWorld;
    ${noise}

    vec2 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
      float ph = dot(p, dir) * freq + uTime * speed;
      return dir * (amp * freq * cos(ph));
    }

    void main() {
      vec2 p = vWorld.xz;
      float dist = length(cameraPosition - vWorld);
      // Calm lake: a few long swells plus fine cat's-paw ripples.
      vec2 g = vec2(0.0);
      g += wave(p, normalize(vec2(0.3, 1.0)), 0.21, 0.55, 0.05);
      g += wave(p, normalize(vec2(-0.7, 0.6)), 0.37, 0.8, 0.028);
      g += wave(p, normalize(vec2(0.9, 0.25)), 0.63, 1.1, 0.014);
      float fine = smoothstep(200.0, 15.0, dist);
      vec2 q = p * 0.18 + vec2(uTime * 0.05, -uTime * 0.03);
      g += vec2(snoise(vec3(q, uTime * 0.12)), snoise(vec3(q + 17.0, uTime * 0.12))) * 0.07 * fine;
      vec2 q2 = p * vec2(0.9, 1.6) + vec2(-uTime * 0.15, uTime * 0.1);
      g += vec2(snoise(vec3(q2, uTime * 0.3)), snoise(vec3(q2 + 9.0, uTime * 0.3))) * 0.05 * fine * fine;
      // Ripple rings around the floating lanterns.
      for (int i = 0; i < 6; i++) {
        vec3 r = uRings[i];
        vec2 d = p - r.xy;
        float rr = length(d) + 1e-3;
        float k = 2.6;
        float ring = cos(rr * k - uTime * 2.2 + r.z) * exp(-rr * 0.28) * smoothstep(0.3, 1.2, rr);
        g += (d / rr) * ring * 0.11;
      }
      // A fish jumped: one expanding set of rings.
      {
        vec2 d = p - uDrop.xy;
        float rr = length(d) + 1e-3;
        float front = rr - uDrop.z * 2.6;
        float env = exp(-front * front * 0.08) * exp(-uDrop.z * 0.45) * smoothstep(0.0, 0.6, uDrop.z);
        g += (d / rr) * sin(front * 2.4) * env * 0.5 * uDrop.w;
      }
      vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 V = normalize(cameraPosition - vWorld);

      // Distorted mirror reflection; distortion shrinks with distance.
      vec4 uv = vUv;
      float strength = 1.0 / (1.0 + dist * 0.03);
      uv.xy += g * strength * uv.w * 0.12;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;
      refl = refl / (1.0 + max(max(refl.r, refl.g), refl.b) * 0.25);

      float ndv = max(dot(N, V), 0.0);
      float fres = 0.02 + 0.98 * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
      float reflectivity = mix(0.42, 0.95, fres);
      vec3 deep = vec3(0.002, 0.007, 0.02) + uAuroraGlow * 0.04;
      vec3 col = mix(deep, refl, reflectivity);

      // Moon glitter and the warm path from the dome.
      vec3 Hm = normalize(V + normalize(uMoonDir));
      col += vec3(0.8, 0.88, 1.0) * pow(max(dot(N, Hm), 0.0), 2400.0) * 1.2;
      vec3 Lw = uWarmPos - vWorld;
      float dw = length(Lw);
      vec3 Hw = normalize(V + Lw / dw);
      // Keep warm glints on the light's path rather than scattered over the lake.
      vec2 toL = normalize(uWarmPos.xz - cameraPosition.xz);
      vec2 toP = normalize(vWorld.xz - cameraPosition.xz);
      float onPath = smoothstep(0.985, 0.999, dot(toL, toP));
      col += uWarmCol * pow(max(dot(N, Hw), 0.0), 700.0) * 4.0 * onPath / (1.0 + dw * 0.03);

      // Distance haze toward the far shore.
      float f = 1.0 - exp(-dist * 0.0011);
      col = mix(col, uHazeCol, f * 0.55);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function Lake() {
  const reflector = useDisposable(() => {
    const geo = new THREE.PlaneGeometry(9000, 9000);
    const r = new Reflector(geo, {
      textureWidth: 640,
      textureHeight: 480,
      clipBias: 0.002,
      multisample: 0,
      shader: WaterShader,
    });
    r.rotation.x = -Math.PI / 2;
    r.position.set(0, 0, -1500);
    const u = r.material.uniforms;
    // Share live env values.
    u.uTime = env.uTime;
    u.uMoonDir = env.uMoonDir;
    u.uWarmPos = env.uWarmPos;
    u.uWarmCol = env.uWarmCol;
    u.uHazeCol = env.uHazeCol;
    u.uAuroraGlow = env.uAuroraGlow;
    return r;
  }, []);

  useEffect(() => () => reflector.geometry.dispose(), [reflector]);
  const fish = useRef({ next: 4, rand: makeRandom(808) });

  useFrame((state, delta) => {
    const drop = reflector.material.uniforms.uDrop.value;
    const f = fish.current;
    drop.z += delta;
    f.next -= delta;
    if (f.next <= 0) {
      for (let i = 0; i < 20; i++) {
        const x = f.rand.range(-40, 45);
        const z = f.rand.range(-160, 5);
        if (landDistance(x, z) < -6) {
          drop.set(x, z, 0, f.rand.range(0.7, 1));
          break;
        }
      }
      f.next = f.rand.range(6, 13);
    }
    // Near-camera particles and mist stay out of the reflection.
    reflector.getReflectionCamera(state.camera).layers.disable(NO_REFLECT);
    const rings = reflector.material.uniforms.uRings.value;
    for (let i = 0; i < rings.length; i++) {
      const l = lanternState.water[i];
      if (l) rings[i].set(l.x, l.z, l.phase);
      else rings[i].set(1e5, 1e5, 0);
    }
  });

  return <primitive object={reflector} />;
}

/** Thin drifting mist sheets over the water plus a glowing bank along the far shore. */
export function Mist() {
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: env.uTime, uAuroraGlow: env.uAuroraGlow, uLayer: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uAuroraGlow;
          varying vec3 vWorld;
          ${noise}
          void main() {
            vec2 p = vWorld.xz * vec2(0.006, 0.012) + vec2(uTime * 0.006, uTime * 0.0025) + vWorld.y * 0.3;
            float n = fbm(p) * 0.5 + 0.5;
            float m = smoothstep(0.38, 0.8, n);
            float d = length(vWorld - cameraPosition);
            float fade = smoothstep(18.0, 70.0, d) * smoothstep(900.0, 380.0, d);
            vec3 c = vec3(0.14, 0.19, 0.3) + uAuroraGlow * 1.2;
            gl_FragColor = vec4(c * m * fade * 0.85, 1.0);
          }
        `,
      }),
  );
  const bank = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: env.uTime, uAuroraGlow: env.uAuroraGlow },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uAuroraGlow;
          varying vec2 vUv;
          varying vec3 vWorld;
          ${noise}
          void main() {
            float n = fbm(vec2(vWorld.x * 0.004 + uTime * 0.01, vUv.y * 1.5 - uTime * 0.02)) * 0.5 + 0.5;
            float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.2) * smoothstep(0.25, 0.75, n) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
            vec3 c = vec3(0.16, 0.22, 0.34) + uAuroraGlow * 0.9;
            gl_FragColor = vec4(c * a * 0.5, 1.0);
          }
        `,
      }),
  );
  const refs = useRef([]);
  useLayoutEffect(() => {
    refs.current.forEach((m) => m && m.layers.set(NO_REFLECT));
  }, []);
  const set = (i) => (m) => {
    refs.current[i] = m;
  };
  return (
    <group>
      <mesh ref={set(0)} material={material} position={[0, 1.4, -380]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <planeGeometry args={[1800, 900]} />
      </mesh>
      <mesh ref={set(1)} material={material} position={[30, 4.2, -420]} rotation={[-Math.PI / 2, 0, 0.1]} renderOrder={5}>
        <planeGeometry args={[1800, 900]} />
      </mesh>
      <mesh ref={set(2)} material={bank} position={[0, 16, FAR_SHORE_Z + 30]} renderOrder={4}>
        <planeGeometry args={[1500, 34]} />
      </mesh>
    </group>
  );
}
