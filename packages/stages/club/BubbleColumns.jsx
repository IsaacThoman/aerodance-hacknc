import * as THREE from 'three';
import { useDisposable } from '../shared/hooks.js';
import { clubCommon, fogUniforms } from './patch.js';
import { mergeAll } from './geometry.js';
import { CEILING, COLUMNS, FLOOR, ROOM_R, polar } from './layout.js';

const R = 0.62;
const DIST = ROOM_R - 0.45;

// Floor-to-ceiling glass tubes of glowing liquid with bubbles streaming up,
// and light bands that run up the column on every beat.
const columnVertex = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const columnFragment = /* glsl */ `
${clubCommon}
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
#include <fog_pars_fragment>

float bubbles(vec2 p, float speed, float seed) {
  p.y -= uTime * speed;
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = hash12(cell + seed);
  vec2 off = (hash22(cell + seed * 1.7) - 0.5) * 0.45;
  f.x += 0.12 * sin(uTime * 2.0 + h * 20.0 + p.y);
  float r = 0.16 + 0.18 * h;
  float d = length(f - off);
  float ring = smoothstep(r, r - 0.05, d) * (0.35 + 0.65 * smoothstep(r - 0.14, r - 0.04, d));
  float hl = smoothstep(r * 0.45, 0.0, length(f - off + vec2(r * 0.35, -r * 0.35)));
  return (ring + hl) * step(0.62, h);
}

void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float side = vW.x < 0.0 ? 0.0 : 1.0;
  float y = vW.y;
  float h = clamp((y - ${FLOOR.toFixed(2)}) / ${(CEILING - FLOOR).toFixed(2)}, 0.0, 1.0);
  vec3 lo = side < 0.5 ? vec3(0.0, 0.55, 1.0) : vec3(0.75, 0.2, 1.0);
  vec3 hi = side < 0.5 ? vec3(0.45, 1.0, 0.4) : vec3(0.2, 0.75, 1.0);
  vec3 liquid = mix(lo, hi, smoothstep(0.0, 1.0, h));
  // Thicker liquid toward the silhouette reads darker and richer.
  vec3 col = liquid * (0.08 + 0.45 * pow(facing, 1.5));
  vec2 p = vec2(vUv.x * 18.0, y * 2.4);
  float b = bubbles(p, 2.6, side * 7.0) + 0.6 * bubbles(p * 1.7 + 3.1, 3.4, side * 7.0 + 3.0);
  col += mix(vec3(0.8, 1.0, 1.0), liquid, 0.5) * b * (0.3 + 0.4 * facing);
  float band = exp(-pow((fract(h * 1.6 - uBeat * 0.25) - 0.5) * 7.0, 2.0));
  col += liquid * band * (0.5 + 0.8 * uPulse) * facing;
  // Glass: fresnel rim and a vertical specular streak.
  float fr = pow(1.0 - facing, 3.0);
  col += vec3(0.7, 0.95, 1.0) * fr * 0.35;
  vec3 hv = normalize(v + normalize(vec3(0.4, 0.3, 1.0)));
  col += vec3(1.0) * pow(max(dot(n, hv), 0.0), 60.0) * 1.2;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

export default function BubbleColumns() {
  const res = useDisposable(() => {
    const h = CEILING - FLOOR;
    const caps = [];
    COLUMNS.forEach((theta) => {
      const [x, , z] = polar(DIST, theta);
      caps.push(
        new THREE.CylinderGeometry(R + 0.12, R + 0.18, 0.5, 32).translate(x, FLOOR + 0.25, z),
        new THREE.CylinderGeometry(R + 0.16, R + 0.1, 0.4, 32).translate(x, CEILING - 0.2, z),
      );
    });
    const rings = [];
    COLUMNS.forEach((theta) => {
      const [x, , z] = polar(DIST, theta);
      rings.push(
        new THREE.TorusGeometry(R + 0.16, 0.04, 6, 40).rotateX(Math.PI / 2).translate(x, FLOOR + 0.52, z),
        new THREE.TorusGeometry(R + 0.18, 0.04, 6, 40).rotateX(Math.PI / 2).translate(x, CEILING - 0.42, z),
      );
    });
    return {
      tubes: mergeAll(
        COLUMNS.map((theta) => {
          const [x, , z] = polar(DIST, theta);
          return new THREE.CylinderGeometry(R, R, h, 40, 1, true).translate(x, FLOOR + h / 2, z);
        }),
      ),
      caps: mergeAll(caps),
      rings: mergeAll(rings),
      tube: new THREE.ShaderMaterial({ uniforms: fogUniforms(), vertexShader: columnVertex, fragmentShader: columnFragment, fog: true }),
      chrome: new THREE.MeshPhysicalMaterial({ color: '#cfd8f4', metalness: 0.9, roughness: 0.15, clearcoat: 1, envMapIntensity: 0.6 }),
      glow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#9ff6ff').multiplyScalar(2.2) }),
    };
  });
  return (
    <group>
      <mesh geometry={res.tubes} material={res.tube} />
      <mesh geometry={res.caps} material={res.chrome} />
      <mesh geometry={res.rings} material={res.glow} />
    </group>
  );
}
