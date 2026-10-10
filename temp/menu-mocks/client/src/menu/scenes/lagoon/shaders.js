import * as THREE from 'three';
import { hash, simplex } from '../../shared/glsl.js';

// ---------------------------------------------------------------------------
// Shared uniforms: one object per frame-updated value, referenced by every
// material so a single write per frame updates them all.
// ---------------------------------------------------------------------------
export function makeSharedUniforms() {
  return {
    uTime: { value: 0 },
    uBeat: { value: 0 },
    // Above water
    uSunDir: { value: new THREE.Vector3(-0.45, 0.22, -0.86).normalize() },
    // Key light for above-water props: front-left, so islands read bright even though the sun is in frame.
    uKeyDir: { value: new THREE.Vector3(-0.55, 0.62, 0.56).normalize() },
    uSunColor: { value: new THREE.Color('#fff1d6').multiplyScalar(1.15) },
    uSkyLight: { value: new THREE.Color('#9fd6ff').multiplyScalar(0.62) },
    uGroundLight: { value: new THREE.Color('#e8f4dc').multiplyScalar(0.34) },
    uAirFog: { value: new THREE.Color('#cfefff') },
    uAirDensity: { value: 1 / 1500 },
    uSkyTop: { value: new THREE.Color('#1a7fe0') },
    uSkyHorizon: { value: new THREE.Color('#c9f1ff') },
    // Under water
    uWaterTop: { value: new THREE.Color('#34c8ee') },
    uWaterMid: { value: new THREE.Color('#0a84c8') },
    uWaterDeep: { value: new THREE.Color('#063f8c') },
    uWaterDensity: { value: 0.025 },
    uUnderSun: { value: new THREE.Vector3(-0.28, -1, -0.18).normalize() },
    uUnderSunColor: { value: new THREE.Color('#e9fbff').multiplyScalar(1.25) },
    uUnderSky: { value: new THREE.Color('#6fd3ee').multiplyScalar(0.55) },
    uUnderGround: { value: new THREE.Color('#2a7fa8').multiplyScalar(0.32) },
    // Interaction: xyz world point, w weight
    uAttract: { value: new THREE.Vector4(0, -3, -10, 0) },
    uRepel: { value: new THREE.Vector4(0, -3, -10, 0) },
  };
}

export { hash, simplex };

// Joltz0r's tileable water caustic, tuned for world-space use.
export const causticsGLSL = /* glsl */ `
float causticPattern(vec2 p, float time) {
  const float TAU = 6.28318530718;
  vec2 q = mod(p * TAU, TAU) - 250.0;
  vec2 i = q;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = q + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(q.x / (sin(i.x + t) / inten), q.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

// Underwater fog: wavelength-dependent absorption + scattering toward the
// background gradient (same function the background sphere uses).
export const waterGLSL = /* glsl */ `
uniform vec3 uWaterTop;
uniform vec3 uWaterMid;
uniform vec3 uWaterDeep;
uniform float uWaterDensity;
vec3 waterBg(float dy) {
  vec3 c = mix(uWaterMid, uWaterTop, smoothstep(0.02, 0.5, dy));
  return mix(c, uWaterDeep, 1.0 - smoothstep(-0.75, 0.02, dy));
}
vec3 underwaterFog(vec3 col, vec3 wp) {
  vec3 dv = wp - cameraPosition;
  float d = length(dv);
  vec3 dir = dv / max(d, 1e-4);
  vec3 absorb = exp(-d * vec3(0.024, 0.0095, 0.0075));
  float fog = 1.0 - exp(-d * uWaterDensity);
  return mix(col * absorb, waterBg(dir.y), fog);
}
`;

export const airGLSL = /* glsl */ `
uniform vec3 uAirFog;
uniform float uAirDensity;
vec3 airFog(vec3 col, vec3 wp) {
  float d = length(wp - cameraPosition);
  float f = 1.0 - exp(-pow(d * uAirDensity, 1.35));
  return mix(col, uAirFog, f);
}
`;

// ---------------------------------------------------------------------------
// Generic stylised lit material (hemisphere + wrapped sun + gloss + rim),
// with optional wind/current sway, underwater caustics and fog.
// ---------------------------------------------------------------------------
const litVertex = /* glsl */ `
uniform float uTime;
uniform float uSwayAmp;
uniform float uSwaySpeed;
#if defined(SWAY) || defined(FLAP)
attribute float aSway;
#endif
#if defined(FLAP) || defined(UNDULATE) || defined(FLIPPERS)
attribute float aPhase;
#endif
#ifdef UNDULATE
attribute float aU;
uniform float uUndAmp;
uniform float uUndFreq;
#endif
#ifdef FLIPPERS
attribute float aPart;
attribute vec3 aPivot;
#endif
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vCol;
void main() {
  vec3 pos = position;
  vec3 nrm = normal;
  vCol = vec3(1.0);
  #ifdef USE_COLOR
    vCol = color.rgb;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vCol *= instanceColor;
  #endif
  #ifdef FLAP
    float span = abs(aSway);
    float flapOn = smoothstep(-0.3, 0.5, sin(uTime * 0.37 + aPhase * 17.0));
    float flap = sin(uTime * 6.0 + aPhase * 6.2831) * flapOn * 0.85 + 0.1;
    pos.y += flap * (span * span * 0.6 + span * 0.12);
  #endif
  #ifdef UNDULATE
    float bt = uTime * uUndFreq + aPhase * 6.2831853;
    float uw = smoothstep(0.3, 1.0, aU);
    pos.y += sin(bt - aU * 3.2) * uw * uw * uUndAmp;
    pos.y += sin(bt + 0.6) * (1.0 - uw) * uUndAmp * 0.1;
  #endif
  #ifdef FLIPPERS
    if (aPart > 0.5) {
      float sideS = sign(aPivot.x);
      float front = step(aPart, 1.5);
      float ft = uTime * 1.25 + aPhase * 6.2831853 + (1.0 - front) * 1.4;
      float th = sideS * sin(ft) * mix(0.25, 0.62, front);
      float ph = sideS * sin(ft - 1.3) * mix(0.15, 0.35, front);
      vec3 q = pos - aPivot;
      q = vec3(q.x * cos(th) - q.y * sin(th), q.x * sin(th) + q.y * cos(th), q.z);
      q = vec3(q.x * cos(ph) + q.z * sin(ph), q.y, -q.x * sin(ph) + q.z * cos(ph));
      pos = aPivot + q;
    }
  #endif
  vec4 wp = vec4(pos, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
    nrm = mat3(instanceMatrix) * nrm;
  #endif
  wp = modelMatrix * wp;
  #ifdef SWAY
    float w = aSway * aSway;
    float ph = wp.x * 0.37 + wp.z * 0.23;
    float s1 = sin(uTime * uSwaySpeed + ph);
    float s2 = sin(uTime * uSwaySpeed * 2.31 + ph * 1.7 + 1.3);
    wp.x += (s1 * 0.75 + s2 * 0.25) * w * uSwayAmp;
    wp.z += cos(uTime * uSwaySpeed * 0.77 + ph * 1.3) * 0.45 * w * uSwayAmp;
    wp.y -= abs(s1) * 0.12 * w * uSwayAmp;
  #endif
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * nrm);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const litFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uWrap;
uniform float uShininess;
uniform float uSpecular;
uniform float uRim;
uniform vec3 uRimColor;
#ifdef UNDERWATER
uniform vec3 uUnderSun;
uniform vec3 uUnderSunColor;
uniform vec3 uUnderSky;
uniform vec3 uUnderGround;
uniform float uCaustics;
${waterGLSL}
${causticsGLSL}
#else
uniform vec3 uKeyDir;
uniform vec3 uSunColor;
uniform vec3 uSkyLight;
uniform vec3 uGroundLight;
${airGLSL}
#endif
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vCol;
void main() {
  vec3 n = normalize(vNormalW);
  #ifdef DOUBLE_SIDED
    n *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 base = uColor * vCol;
  #ifdef UNDERWATER
    vec3 L = -uUnderSun;
    float depth = max(-vWorld.y, 0.0);
    vec3 sunC = uUnderSunColor * exp(-depth * vec3(0.11, 0.035, 0.02));
    vec3 amb = mix(uUnderGround, uUnderSky, n.y * 0.5 + 0.5);
  #else
    vec3 L = uKeyDir;
    vec3 sunC = uSunColor;
    vec3 amb = mix(uGroundLight, uSkyLight, n.y * 0.5 + 0.5);
  #endif
  float ndl = dot(n, L);
  float diff = max((ndl + uWrap) / (1.0 + uWrap), 0.0);
  vec3 col = base * (amb + sunC * diff);
  vec3 h = normalize(L + v);
  col += sunC * pow(max(dot(n, h), 0.0), uShininess) * uSpecular * smoothstep(-0.1, 0.2, ndl);
  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += uRimColor * fr * uRim;
  col += uEmissive;
  #ifdef UNDERWATER
    vec2 cp = vWorld.xz + vWorld.y * (uUnderSun.xz / uUnderSun.y);
    float c = causticPattern(cp * 0.21, uTime * 0.42 + 23.0);
    c += 0.5 * causticPattern(cp * 0.13 + 0.37, uTime * 0.31 + 11.0);
    col += base * sunC * c * uCaustics * smoothstep(-0.3, 0.9, n.y) * (0.55 + 0.45 * diff);
    col = underwaterFog(col, vWorld);
  #else
    col = airFog(col, vWorld);
  #endif
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Stylised lit material. shared: object from makeSharedUniforms.
 */
export function makeLitMaterial(shared, {
  color = '#ffffff',
  emissive = '#000000',
  emissiveIntensity = 1,
  wrap = 0.35,
  shininess = 40,
  specular = 0.35,
  rim = 0.25,
  rimColor = '#bff3ff',
  underwater = false,
  caustics = 1,
  sway = false,
  swayAmp = 0.3,
  swaySpeed = 1,
  vertexColors = true,
  side = THREE.FrontSide,
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Color(color) },
      uEmissive: { value: new THREE.Color(emissive).multiplyScalar(emissiveIntensity) },
      uWrap: { value: wrap },
      uShininess: { value: shininess },
      uSpecular: { value: specular },
      uRim: { value: rim },
      uRimColor: { value: new THREE.Color(rimColor) },
      uCaustics: { value: caustics },
      uSwayAmp: { value: swayAmp },
      uSwaySpeed: { value: swaySpeed },
      uUndAmp: { value: 0.12 },
      uUndFreq: { value: 2.4 },
    },
    defines: {
      ...(underwater ? { UNDERWATER: '' } : {}),
      ...(sway ? { SWAY: '' } : {}),
    },
    vertexShader: litVertex,
    fragmentShader: litFragment,
    vertexColors,
    side,
  });
}
