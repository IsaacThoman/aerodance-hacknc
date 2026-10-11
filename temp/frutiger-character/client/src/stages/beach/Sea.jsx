import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { hash, simplex } from '../shared/glsl.js';
import { DECK_R, WATER_Y, world } from './palette.js';
import { skyGLSL, skyUniforms } from './shaders.js';
import { terrainGLSL } from './terrain.js';

const vertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
uniform float uTime, uWaterY, uBeat;
uniform vec3 uDeep, uMid, uFar, uShallow, uSandBed, uFoam;
${skyGLSL}
${terrainGLSL}
${hash}
${simplex}
varying vec3 vWorld;

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  vec2 p = vWorld.xz;
  float t = uTime;
  // World size of a pixel along the view direction (grazing angles stretch it).
  float foot = dist * dist * 0.0022 / max(cameraPosition.y - vWorld.y, 0.5) + 0.01;

  // Swell rolling in toward the beach (+z) plus cross chop; waves too small to
  // resolve fade out and widen the sun-glitter lobe instead.
  vec2 g = vec2(0.0);
  float lost = 0.0;
  #define WAVE(dx, dz, L, A, ph) { vec2 D = normalize(vec2(dx, dz)); float k = 6.2831853 / L; float w = sqrt(9.8 * k) * 0.8; float f = 1.0 - smoothstep(0.35, 1.2, foot / L); float s = A * k; g += D * (s * cos(dot(D, p) * k - w * t + ph)) * f; lost += s * s * (1.0 - f); }
  WAVE(0.12, 1.0, 14.0, 0.055, 0.0)
  WAVE(-0.5, 1.0, 7.3, 0.035, 1.3)
  WAVE(0.7, 0.8, 4.1, 0.032, 2.1)
  WAVE(-0.9, 0.45, 2.4, 0.024, 4.0)
  WAVE(0.95, -0.3, 1.5, 0.015, 0.7)
  WAVE(-0.2, -1.0, 0.95, 0.009, 5.2)
  float nearF = 1.0 - smoothstep(0.08, 0.45, foot);
  if (nearF > 0.0) {
    vec2 q = p * 1.9 + vec2(t * 0.3, t * 0.25);
    float e = 0.2;
    float n0 = snoise(q);
    g += vec2(snoise(q + vec2(e, 0.0)) - n0, snoise(q + vec2(0.0, e)) - n0) / e * 0.032 * nearF;
  }
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  float ndv = max(dot(n, v), 0.0);
  vec3 r = reflect(-v, n);
  r.y = abs(r.y);
  float F = (0.02 + 0.98 * pow(1.0 - ndv, 5.0)) * 0.5;

  // Water body: aqua over the sandy cove, teal then deep blue offshore.
  float depth0 = ${WATER_Y.toFixed(3)} - groundHeight(p);
  float depth = uWaterY - groundHeight(p);
  vec3 body = mix(uMid, uDeep, smoothstep(25.0, 140.0, dist));
  body = mix(body, uFar, smoothstep(160.0, 700.0, dist));
  body = mix(body, uShallow, 1.0 - smoothstep(0.25, 2.6, depth0));
  body = mix(body, uSandBed, exp(-max(depth, 0.0) * 3.2) * 0.6);
  // Light through the backs of the swells when looking toward the sun.
  float back = pow(max(dot(-v, uSunDir), 0.0), 6.0);
  body += uShallow * back * 0.25 * clamp(length(g) * 3.0, 0.0, 1.0);

  vec3 sky = skyGradient(vec3(r.x, r.y * 0.85, r.z)) + uSunCol * pow(max(dot(r, uSunDir), 0.0), 90.0) * 0.8;
  vec3 col = mix(body, sky, F);

  // Sun glitter: Beckmann-like lobe widened by unresolved detail.
  vec3 h = normalize(uSunDir + v);
  float ndh = max(dot(n, h), 1e-3);
  float m2 = 0.0016 + 2.0 * lost;
  float tan2 = (1.0 - ndh * ndh) / (ndh * ndh);
  float D = exp(-tan2 / m2) / (3.14159 * m2 * ndh * ndh * ndh * ndh);
  float spec = D * F * 0.2;
  col += uSunCol * min(spec, 30.0);

  // Twinkling glints scattered along the sun path.
  vec2 cell = floor(p * vec2(1.2, 0.5));
  float tw = floor(t * 6.0 + hash12(cell) * 50.0);
  float glint = step(0.985, hash12(cell + tw * 0.37));
  col += uSunCol * glint * smoothstep(0.02, 0.4, spec) * (5.0 + 3.0 * uBeat) * (1.0 - smoothstep(0.4, 3.0, foot));

  // Foam: breakers rolling in over the shallows, the swash edge, and lapping
  // rings around the deck's base.
  // Breakers: a sharp leading edge with a trailing wash of foam behind it.
  float wf = fract((depth0 * 8.0 + t * 1.1 + snoise(p * 0.09) * 1.4) / 6.2831853);
  float crest = smoothstep(0.0, 0.05, wf) * (1.0 - smoothstep(0.05, 0.3, wf));
  float lace = smoothstep(-0.35, 0.6, snoise(p * vec2(0.55, 0.9) + vec2(t * 0.12, -t * 0.3)));
  float zone = (1.0 - smoothstep(0.5, 1.8, depth0)) * smoothstep(0.03, 0.2, depth0);
  float foam = crest * mix(0.45, 1.0, lace) * zone;
  // Swash: a lacy band where the water thins out over the sand.
  float edge = 1.0 - smoothstep(0.0, 0.11, depth);
  float edgeLace = smoothstep(-0.3, 0.5, snoise(p * 1.3 + vec2(0.0, t * 0.4)));
  foam = max(foam, edge * (0.55 + 0.45 * edgeLace));
  float dd = length(p) - ${(DECK_R - 0.15).toFixed(2)};
  float ring = exp(-max(dd, 0.0) * 3.5) * (0.55 + 0.45 * sin(dd * 9.0 - t * 2.4)) * (0.6 + 0.4 * lace);
  foam = max(foam, ring * 0.75 * step(0.0, depth));
  foam *= 1.0 - smoothstep(0.6, 4.0, foot);
  col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.9);

  gl_FragColor = vec4(applyHaze(col, vWorld), 1.0);
}
`;

/** The sea: follows the camera, gently rising and falling to lap the shore. */
export function Sea() {
  const mesh = useRef();
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...skyUniforms(),
          uTime: world.uTime,
          uBeat: world.uBeat,
          uWaterY: world.uWaterY,
          uDeep: { value: new THREE.Color('#163a9a') },
          uFar: { value: new THREE.Color('#3a3596') },
          uMid: { value: new THREE.Color('#0a72a6') },
          uShallow: { value: new THREE.Color('#12aab4') },
          uSandBed: { value: new THREE.Color('#9fdcc0') },
          uFoam: { value: new THREE.Color('#fff6ec') },
        },
        vertexShader: vertex,
        fragmentShader: fragment,
      }),
  );
  useFrame((state) => {
    mesh.current.position.set(state.camera.position.x, world.uWaterY.value, state.camera.position.z);
  });
  return (
    <mesh ref={mesh} material={material} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
      <planeGeometry args={[6000, 6000, 1, 1]} />
    </mesh>
  );
}
