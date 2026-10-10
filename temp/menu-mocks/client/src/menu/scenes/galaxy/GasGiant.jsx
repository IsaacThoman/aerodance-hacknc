import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { LIGHT, makeAtmosphere, makeLit } from './materials.js';
import { PlanetRoot } from './PlanetRoot.jsx';
import { Moon } from './Moon.jsx';
import { TARGET_INDEX } from './layout.js';

const R = 11;
const RING_IN = R * 1.38;
const RING_OUT = R * 2.05;

const SURFACE = /* glsl */ `
  uniform vec3 uC1, uC2, uC3, uC4, uC5;
  void surface(inout Surf s, vec3 V) {
    vec3 n = normalize(vObjPos);
    float t = uTime * 0.015;
    float warp = fbm(vec3(n.x * 1.8 + t, n.y * 7.0, n.z * 1.8 - t)) * 0.09 + snoise(n * 8.0 + vec3(t * 3.0)) * 0.012;
    float y = n.y + warp;
    float b1 = sin(y * 16.0) * 0.5 + 0.5;
    float b2 = sin(y * 6.5 + 1.3) * 0.5 + 0.5;
    float b3 = sin(y * 31.0 + 0.4) * 0.5 + 0.5;
    vec3 col = mix(uC1, uC2, smoothstep(0.2, 0.8, b1));
    col = mix(col, uC3, smoothstep(0.62, 0.92, b2));
    col = mix(col, uC4, smoothstep(0.7, 1.0, b3) * 0.45);
    col = mix(col, uC5, smoothstep(0.75, 0.95, abs(n.y)) * 0.6);
    // Great rose storm: an oval in a local lon/lat frame.
    vec3 sd = normalize(vec3(0.62, -0.22, 0.75));
    vec3 e1 = normalize(cross(vec3(0.0, 1.0, 0.0), sd));
    vec3 e2 = cross(sd, e1);
    vec2 sp = vec2(dot(n, e1) / 0.2, dot(n, e2) / 0.09);
    float sr = length(sp) + (1.0 - step(0.0, dot(n, sd))) * 10.0;
    float swirl = sin(atan(sp.y, sp.x + 1e-4) * 2.0 + sr * 6.0 - uTime * 0.6);
    float storm = smoothstep(1.0, 0.6, sr);
    col = mix(col, mix(vec3(1.0, 0.55, 0.62), vec3(1.0, 0.82, 0.78), 0.5 + 0.5 * swirl), storm * 0.85);
    col = mix(col, vec3(1.0, 0.95, 0.9), smoothstep(1.15, 1.0, sr) * (1.0 - storm) * 0.5);
    s.albedo = col;
    s.gloss = 0.25;
    s.shine = 14.0;
    s.wrap = 0.45;
  }
`;

function makeRingMaterial(planetRadius) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uIn: { value: RING_IN },
      uOut: { value: RING_OUT },
      uKeyDir: { value: LIGHT.keyDir },
      uKeyCol: { value: LIGHT.keyCol },
      uR: { value: planetRadius },
      uFocus: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vWPos;
      varying vec3 vCenter;
      void main() {
        vObj = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIn, uOut, uR, uFocus, uTime;
      uniform vec3 uKeyDir, uKeyCol;
      varying vec3 vObj;
      varying vec3 vWPos;
      varying vec3 vCenter;
      float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
      float bands(float x) {
        float i = floor(x);
        float f = fract(x);
        return mix(h11(i), h11(i + 1.0), smoothstep(0.0, 1.0, f));
      }
      void main() {
        float r = (length(vObj.xy) - uIn) / (uOut - uIn);
        if (r < 0.0 || r > 1.0) discard;
        float d = bands(r * 46.0) * 0.6 + bands(r * 13.0 + 7.0) * 0.4;
        float gap = smoothstep(0.02, 0.0, abs(r - 0.62)) + smoothstep(0.012, 0.0, abs(r - 0.33)) * 0.7;
        float edge = smoothstep(0.0, 0.05, r) * smoothstep(1.0, 0.9, r);
        float a = (0.25 + 0.65 * d) * edge * (1.0 - gap * 0.9);
        vec3 inner = vec3(0.62, 0.52, 1.0);
        vec3 mid = vec3(1.0, 0.72, 0.86);
        vec3 outer = vec3(0.55, 0.92, 1.0);
        vec3 col = mix(inner, mid, smoothstep(0.1, 0.55, r));
        col = mix(col, outer, smoothstep(0.6, 0.95, r));
        col *= 0.75 + 0.5 * d;
        // Planet shadow on the rings.
        vec3 p = vWPos - vCenter;
        float b = dot(p, uKeyDir);
        float c = dot(p, p) - uR * uR;
        float shadow = (b < 0.0 && b * b - c > 0.0) ? 1.0 : 0.0;
        float soft = smoothstep(-0.5, 2.0, b * b - c);
        col *= 1.0 - 0.75 * shadow * soft;
        col *= uKeyCol * 0.6;
        col = mix(col, vec3(0.03, 0.02, 0.09), 0.2);
        // Glittering ice motes.
        float sparkle = pow(bands(r * 400.0 + floor(atan(vObj.y, vObj.x) * 60.0) * 3.7), 30.0) * (0.5 + 0.5 * sin(uTime * 3.0 + r * 90.0));
        col += vec3(1.0) * sparkle * 2.0 * (1.0 - shadow);
        col *= 1.0 + uFocus * 0.5;
        gl_FragColor = vec4(max(col * a, 0.0), clamp(a, 0.0, 1.0));
      }
    `,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export default function GasGiant({ state }) {
  const index = TARGET_INDEX.online;
  const planetMat = useDisposable(() =>
    makeLit({
      surface: SURFACE,
      painted: false,
      withNoise: true,
      rim: '#b9d8ff',
      rimStrength: 0.55,
      haze: 0.22,
      hazeColor: '#2b1a6a',
      uniforms: {
        uC1: { value: new THREE.Color('#ecb990') },
        uC2: { value: new THREE.Color('#dc8670') },
        uC3: { value: new THREE.Color('#7d62da') },
        uC4: { value: new THREE.Color('#e66d9c') },
        uC5: { value: new THREE.Color('#4ea6c6') },
      },
    }),
  );
  const ringMat = useDisposable(() => makeRingMaterial(R));
  const atmo = useDisposable(() => makeAtmosphere({ color: '#b39cff', inner: R, outer: R * 1.12, strength: 0.7, power: 1.6 }));
  return (
    <PlanetRoot
      index={index}
      state={state}
      tilt={[0.22, 0, 0.32]}
      spin={0.025}
      materials={[planetMat, ringMat]}
      still={
        <>
          <mesh material={atmo} scale={R * 1.12}>
            <icosahedronGeometry args={[1, 10]} />
          </mesh>
          <mesh material={ringMat} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[RING_IN, RING_OUT, 160, 1]} />
          </mesh>
          <Moon radius={1.1} distance={R * 2.6} speed={0.06} phase={0.6} incline={0.25} colors={['#d98fb0', '#ffe6f0']} rim="#ffc6e6" />
          <Moon radius={0.7} distance={R * 3.0} speed={-0.045} phase={3.4} incline={-0.35} colors={['#6fa8c8', '#d6f6ff']} rim="#bff0ff" />
        </>
      }
    >
      <mesh material={planetMat}>
        <icosahedronGeometry args={[R, 24]} />
      </mesh>
    </PlanetRoot>
  );
}
