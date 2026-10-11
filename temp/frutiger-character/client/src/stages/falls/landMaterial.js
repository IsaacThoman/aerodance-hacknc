// One lit, hazed material for all terrain: meadow, valley, mesas, mountains.
// Colour comes from slope, height and noise: lush grass on the flats,
// pale limestone with moss streaks on the cliffs, snow on the far peaks.
import * as THREE from 'three';
import { fx, lightGLSL, windGLSL } from './fx.js';
import { LAKE_Y } from './terrain.js';

export const LAND_KIND = { meadow: 0, valley: 1, mesa: 2, mountain: 3, island: 4 };

const vertex = /* glsl */ `
  attribute float aRel;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vRel;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vRel = aRel;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  #define KIND __KIND__
  #define LAKE_Y ${LAKE_Y.toFixed(1)}
  ${windGLSL}
  ${lightGLSL}
  uniform float uHazeMul;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vRel;

  vec3 grassColor(vec2 p, float n1, float n2) {
    vec3 deep = vec3(0.03, 0.2, 0.02);
    vec3 lush = vec3(0.07, 0.42, 0.03);
    vec3 lime = vec3(0.3, 0.62, 0.05);
    vec3 col = mix(deep, lush, smoothstep(-0.6, 0.3, n1));
    col = mix(col, lime, smoothstep(0.25, 0.9, n2) * 0.55);
    return col;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 P = vWorld;
    vec4 tn = tnoise(P.xz * 0.045);
    vec4 tf = tnoise(P.xz * 0.19 + 7.3);
    float n1 = tn.r * 0.7 + tf.g * 0.3;
    float n2 = tn.g * 0.6 + tf.b * 0.4;

    // Limestone walls: vertical fluting, gentle strata, ochre and grey washes,
    // dark wet streaks, moss on ledges and in sparse drapes. 'across' is a
    // cheap wall-aligned horizontal axis.
    float across = mix(P.x, P.z, abs(n.x) / (abs(n.x) + abs(n.z) + 1e-3));
    float flute = tnoise(vec2(across * 0.35, P.y * 0.01)).r;
    float flute2 = tnoise(vec2(across * 0.9 + 3.0, P.y * 0.02)).g;
    float strata = 0.5 + 0.5 * sin(P.y * 0.42 + flute * 0.5);
    vec3 rock = mix(vec3(0.68, 0.6, 0.46), vec3(0.66, 0.44, 0.25), smoothstep(-0.2, 0.6, tnoise(vec2(across * 0.04, P.y * 0.015 + 5.0)).b) * 0.6);
    rock = mix(rock, vec3(0.46, 0.46, 0.44), smoothstep(0.2, 0.8, flute2) * 0.3);
    rock *= 0.82 + 0.18 * strata;
    rock *= 0.7 + 0.3 * smoothstep(-0.5, 0.5, flute);
    float stain = smoothstep(0.3, 0.8, tnoise(vec2(across * 0.12 + 11.0, P.y * 0.003)).a);
    rock *= 1.0 - 0.28 * stain;
    float drape = smoothstep(0.4, 0.75, tnoise(vec2(across * 0.15 + 7.0, P.y * 0.006)).r);
    float moss = max(smoothstep(0.55, 0.8, n.y), drape * 0.75);
    rock = mix(rock, vec3(0.1, 0.32, 0.06), moss * 0.8);

    vec3 grass = grassColor(P.xz, n1, n2);
    float flat_ = smoothstep(0.52, 0.78, n.y + n1 * 0.12);

  #if KIND == 2
    // Mesas: green rim + hanging gardens, darker toward the misty base.
    flat_ = max(flat_, smoothstep(0.93, 0.99, vRel) * 0.9);
    flat_ = max(flat_, smoothstep(0.24, 0.1, vRel) * smoothstep(0.2, 0.6, n.y + 0.4));
  #endif

    vec3 albedo = mix(rock, grass, flat_);
  #if KIND == 0
    // Turf seen between the blades.
    albedo = mix(rock, mix(grass * 0.7, vec3(0.12, 0.3, 0.05), 0.3), flat_);
  #endif

  #if KIND == 1
    // Pale sandy shore at the waterline.
    float shore = smoothstep(LAKE_Y + 2.2, LAKE_Y + 0.6, P.y) * smoothstep(LAKE_Y - 3.0, LAKE_Y - 0.5, P.y);
    albedo = mix(albedo, vec3(0.62, 0.58, 0.4), shore * 0.8);
    // Woodland patches darken the lower hills.
    albedo *= 1.0 - 0.3 * smoothstep(0.2, 0.6, tnoise(P.xz * 0.02 + 3.0).b);
  #endif

  #if KIND == 3
    float snow = smoothstep(95.0, 140.0, P.y + n1 * 30.0) * smoothstep(0.35, 0.6, n.y + n2 * 0.15);
    vec3 far = mix(vec3(0.17, 0.26, 0.3), vec3(0.23, 0.38, 0.18), smoothstep(60.0, 10.0, P.y));
    albedo = mix(far, vec3(0.92, 0.95, 1.0), snow);
  #endif

  #if KIND == 4
    // Floating islands: rocky underside, grassy top.
    albedo = mix(rock * vec3(0.95, 0.9, 0.85), grass, smoothstep(0.3, 0.6, n.y));
  #endif

    float ao = 1.0;
  #if KIND == 2
    ao = mix(0.6, 1.0, smoothstep(0.0, 0.45, vRel));
  #endif

    vec3 col = shadeLambert(albedo, n, 0.25, ao);
    // Drifting cloud shadows over the valley.
  #if KIND != 0
    float cloud = tnoise(P.xz * 0.0028 - uWindDir * uTime * 0.006).b;
    col *= 1.0 - 0.32 * smoothstep(0.05, 0.5, cloud);
  #endif
    col = applyHaze(col, P, uHazeMul);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function makeLandMaterial(kind, hazeMul = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { ...fx, uHazeMul: { value: hazeMul } },
    vertexShader: vertex,
    fragmentShader: fragment.replace('__KIND__', String(kind)),
  });
}
