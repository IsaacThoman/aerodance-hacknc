import * as THREE from 'three';
import { SUN_TRAVEL, SURFACE_Y } from './constants.js';

/**
 * One uniform object per frame-updated value, referenced by every material
 * so a single write per frame updates them all.
 */
export function makeShared() {
  return {
    uTime: { value: 0 },
    uBeat: { value: 0 },
    uBeatPhase: { value: 0 },
    uSurfaceY: { value: SURFACE_Y },
    uWaterTop: { value: new THREE.Color('#2ecbe8') },
    uWaterMid: { value: new THREE.Color('#0a5eb0') },
    uWaterDeep: { value: new THREE.Color('#062e80') },
    uWaterDensity: { value: 0.025 },
    uFogStart: { value: 9 },
    uUnderSun: { value: new THREE.Vector3(...SUN_TRAVEL).normalize() },
    uUnderSunColor: { value: new THREE.Color('#f2feff').multiplyScalar(1.45) },
    uUnderSky: { value: new THREE.Color('#7fe6f6').multiplyScalar(0.6) },
    uUnderGround: { value: new THREE.Color('#2a8ab8').multiplyScalar(0.36) },
  };
}

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
// Two layers projected along the sun direction from the surface.
float caustics(vec3 wp, vec3 sunDir, float surfaceY, float time) {
  vec2 cp = wp.xz + (wp.y - surfaceY) * (sunDir.xz / sunDir.y);
  float c = causticPattern(cp * 0.2, time * 0.42 + 23.0);
  c += 0.5 * causticPattern(cp * 0.13 + 0.37, time * 0.31 + 11.0);
  return c;
}
`;

/**
 * Underwater haze: wavelength-dependent absorption plus scattering toward
 * the water color in that direction. Haze starts a few meters out so the
 * stage stays crisp, and near haze reads brighter (lit from above) than
 * the deep blue far away.
 */
export const waterGLSL = /* glsl */ `
uniform vec3 uWaterTop;
uniform vec3 uWaterMid;
uniform vec3 uWaterDeep;
uniform float uWaterDensity;
uniform float uFogStart;
vec3 waterBg(float dy) {
  vec3 c = mix(uWaterMid, uWaterTop, smoothstep(-0.04, 0.55, dy));
  return mix(c, uWaterDeep, 1.0 - smoothstep(-0.55, 0.06, dy));
}
float waterFogAmount(float d) {
  return 1.0 - exp(-max(d - uFogStart, 0.0) * uWaterDensity);
}
vec3 underwaterFog(vec3 col, vec3 wp) {
  vec3 dv = wp - cameraPosition;
  float d = length(dv);
  vec3 dir = dv / max(d, 1e-4);
  float e = max(d - uFogStart, 0.0);
  vec3 absorb = exp(-e * vec3(0.026, 0.008, 0.005));
  vec3 haze = waterBg(dir.y + 0.14 * (1.0 - smoothstep(12.0, 60.0, d)));
  return mix(col * absorb, haze, waterFogAmount(d));
}
`;

// ---------------------------------------------------------------------------
// Stylised underwater lit material (hemisphere + wrapped sun + gloss + rim +
// caustics + haze) with optional current sway and creature deformations.
// ---------------------------------------------------------------------------
const litVertex = /* glsl */ `
uniform float uTime;
uniform float uSwayAmp;
uniform float uSwaySpeed;
#if defined(SWAY) || defined(MANTA)
attribute float aSway;
#endif
#if defined(UNDULATE) || defined(FLIPPERS) || defined(MANTA)
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
#ifdef LACE
varying vec2 vUv;
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
  #ifdef LACE
    vUv = uv;
  #endif
  #ifdef MANTA
    // Slow wing beat travelling out to the tips.
    float span = aSway;
    float beatW = sin(uTime * 1.15 + aPhase * 6.2831 - abs(span) * 1.3);
    pos.y += beatW * span * span * 0.5;
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
    float ph = wp.x * 0.31 + wp.z * 0.19;
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
uniform float uSurfaceY;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uWrap;
uniform float uShininess;
uniform float uSpecular;
uniform float uRim;
uniform vec3 uRimColor;
uniform vec3 uUnderSun;
uniform vec3 uUnderSunColor;
uniform vec3 uUnderSky;
uniform vec3 uUnderGround;
uniform float uCaustics;
#ifdef LACE
uniform sampler2D uMap;
varying vec2 vUv;
#endif
${waterGLSL}
${causticsGLSL}
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vCol;
void main() {
  float alpha = 1.0;
  #ifdef LACE
    alpha = texture2D(uMap, vUv).a;
    if (alpha < 0.02) discard;
  #endif
  vec3 n = normalize(vNormalW);
  #ifdef DOUBLE_SIDED
    n *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 base = uColor * vCol;
  vec3 L = -uUnderSun;
  float depth = max(uSurfaceY - vWorld.y, 0.0);
  vec3 sunC = uUnderSunColor * exp(-depth * vec3(0.05, 0.018, 0.01));
  vec3 amb = mix(uUnderGround, uUnderSky, n.y * 0.5 + 0.5);
  float ndl = dot(n, L);
  float diff = max((ndl + uWrap) / (1.0 + uWrap), 0.0);
  vec3 col = base * (amb + sunC * diff);
  vec3 h = normalize(L + v);
  col += sunC * pow(max(dot(n, h), 0.0), uShininess) * uSpecular * smoothstep(-0.1, 0.2, ndl);
  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += uRimColor * fr * uRim;
  col += uEmissive * vCol;
  float c = caustics(vWorld, uUnderSun, uSurfaceY, uTime);
  col += base * sunC * c * uCaustics * smoothstep(-0.3, 0.9, n.y) * (0.55 + 0.45 * diff);
  col = underwaterFog(col, vWorld);
  #ifdef LACE
    gl_FragColor = vec4(col, alpha);
  #else
    gl_FragColor = vec4(col, 1.0);
  #endif
}
`;

/** Stylised lit material sharing the stage uniforms. */
export function makeLitMaterial(shared, {
  color = '#ffffff',
  emissive = '#000000',
  emissiveIntensity = 1,
  wrap = 0.35,
  shininess = 40,
  specular = 0.35,
  rim = 0.25,
  rimColor = '#bff3ff',
  caustics = 1,
  sway = false,
  swayAmp = 0.3,
  swaySpeed = 1,
  vertexColors = true,
  side = THREE.FrontSide,
  defines = {},
  map = null,
} = {}) {
  const m = new THREE.ShaderMaterial({
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
      uMap: { value: map },
    },
    defines: {
      ...(sway ? { SWAY: '' } : {}),
      ...(side === THREE.DoubleSide ? { DOUBLE_SIDED: '' } : {}),
      ...(map ? { LACE: '' } : {}),
      ...defines,
    },
    vertexShader: litVertex,
    fragmentShader: litFragment,
    vertexColors,
    side,
  });
  if (map) m.alphaToCoverage = true;
  return m;
}

/**
 * Give a built-in material (standard/physical/basic) the stage's caustic
 * light and underwater haze. Uniform objects are shared, so they animate.
 */
export function patchUnderwater(material, shared, { caustics = 0, fog = true, ibl = 1, color = '' } = {}) {
  const uCaustics = { value: caustics };
  const uIbl = { value: ibl };
  material.onBeforeCompile = (shader) => {
    for (const k of ['uTime', 'uSurfaceY', 'uUnderSun', 'uUnderSunColor', 'uWaterTop', 'uWaterMid', 'uWaterDeep', 'uWaterDensity', 'uFogStart']) {
      shader.uniforms[k] = shared[k];
    }
    shader.uniforms.uCaustics = uCaustics;
    shader.uniforms.uIbl = uIbl;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vUwWorld;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        vec4 uwWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          uwWp = instanceMatrix * uwWp;
        #endif
        vUwWorld = (modelMatrix * uwWp).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vUwWorld;
        uniform float uTime;
        uniform float uSurfaceY;
        uniform vec3 uUnderSun;
        uniform vec3 uUnderSunColor;
        uniform float uCaustics;
        uniform float uIbl;
        ${waterGLSL}
        ${causticsGLSL}`,
      )
      // Optional GLSL that tweaks diffuseColor from the world position (vUwWorld).
      .replace('#include <color_fragment>', `#include <color_fragment>\n${color}`)
      // Bright white surfaces would drown in the overhead env light; keep reflections, damp diffuse IBL.
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n#ifdef USE_ENVMAP\n  iblIrradiance *= uIbl;\n#endif')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `${caustics > 0 ? `{
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float up = smoothstep(-0.2, 0.9, dot(normal, upV));
          float cst = caustics(vUwWorld, uUnderSun, uSurfaceY, uTime);
          outgoingLight += diffuseColor.rgb * uUnderSunColor * cst * uCaustics * up;
        }` : ''}
        #include <opaque_fragment>
        ${fog ? 'gl_FragColor.rgb = underwaterFog(gl_FragColor.rgb, vUwWorld);' : ''}`,
      );
  };
  material.customProgramCacheKey = () => `reef-uw-${caustics > 0 ? 1 : 0}-${fog ? 1 : 0}-${color}`;
  return material;
}
