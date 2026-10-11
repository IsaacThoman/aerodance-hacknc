import * as THREE from 'three';
import { world } from './palette.js';

// Golden-hour sky gradient (gold -> peach -> pink -> lilac -> blue) plus the
// low sun. Shared by the dome, the sea reflection and the horizon haze so
// distant things melt into exactly the sky behind them.
export const skyGLSL = /* glsl */ `
uniform vec3 uZenith, uUpper, uLilac, uPink, uPeach, uGold, uGlow, uSunCol, uSunDir;
uniform float uHazeDensity;
vec3 skyGradient(vec3 d) {
  float h = max(d.y, 0.0);
  vec2 dh = normalize(d.xz + vec2(1e-5));
  float az = dot(dh, normalize(uSunDir.xz)) * 0.5 + 0.5;
  // Warm bands climb higher on the side facing the sun.
  float k = mix(0.62, 1.15, az * az);
  vec3 col = mix(uGold, uPeach, smoothstep(0.0, 0.05 * k, h));
  col = mix(col, uPink, smoothstep(0.035 * k, 0.11 * k, h));
  col = mix(col, uLilac, smoothstep(0.075 * k, 0.16 * k, h));
  col = mix(col, uUpper, smoothstep(0.12 * k, 0.24 * k, h));
  col = mix(col, uZenith, smoothstep(0.3, 0.8, h));
  float warm = pow(az, 6.0) * (1.0 - smoothstep(0.0, 0.22, h));
  return mix(col, uGlow, warm * 0.8);
}
vec3 sunHalo(vec3 d) {
  float s = max(dot(d, uSunDir), 0.0);
  return uSunCol * (pow(s, 1500.0) * 1.0 + pow(s, 400.0) * 0.45) + uGlow * (pow(s, 60.0) * 0.25 + pow(s, 12.0) * 0.08);
}
vec3 hazeColor(vec3 dir) {
  vec3 d = normalize(vec3(dir.x, 0.015 + max(dir.y, 0.0) * 0.5, dir.z));
  float s = max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  return skyGradient(d) + uGlow * pow(s, 10.0) * 0.35;
}
vec3 applyHaze(vec3 col, vec3 wp) {
  vec3 dv = wp - cameraPosition;
  float dist = length(dv);
  float f = 1.0 - exp(-pow(dist * uHazeDensity, 1.3));
  return mix(col, hazeColor(dv / max(dist, 1e-3)), f);
}
`;

export function skyUniforms() {
  const {
    uZenith, uUpper, uLilac, uPink, uPeach, uGold, uGlow, uSunCol, uSunDir, uHazeDensity,
  } = world;
  return { uZenith, uUpper, uLilac, uPink, uPeach, uGold, uGlow, uSunCol, uSunDir, uHazeDensity };
}

const swayGLSL = /* glsl */ `
{
  // Sea breeze: gentle sway, stronger toward tips (aSway), leaning inland (+z).
  float ph = transformed.x * 0.23 + transformed.z * 0.19;
  float s1 = sin(uTime * 1.05 + ph);
  float s2 = sin(uTime * 2.4 + ph * 1.7 + 1.3);
  float w = aSway * uSwayAmp;
  transformed.x += (s1 * 0.6 + s2 * 0.25) * w;
  transformed.z += (0.55 + 0.45 * sin(uTime * 0.7 + ph * 1.3)) * w * 0.6;
  transformed.y -= abs(s2) * 0.15 * w;
}
`;

/**
 * Patch a built-in lit material with the stage's horizon haze (sky-colored
 * fog) and optional wind sway driven by an `aSway` vertex attribute.
 */
export function patchMaterial(material, { sway = 0, key = 'base', fragment = null, ibl = 0.6, haze = 1, translucency = 0 } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, skyUniforms(), { uTime: world.uTime, uWaterY: world.uWaterY, uSwayAmp: { value: sway }, uIbl: { value: ibl }, uHazeScale: { value: haze }, uTranslucency: { value: translucency } });
    fragment?.uniforms && Object.assign(shader.uniforms, fragment.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vHazeWorld;
        uniform float uTime;
        ${sway ? 'attribute float aSway; uniform float uSwayAmp; varying float vSwayW;' : ''}`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${sway ? `vSwayW = aSway;\n${swayGLSL}` : ''}`)
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
        {
          vec4 hw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            hw = instanceMatrix * hw;
          #endif
          vHazeWorld = (modelMatrix * hw).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vHazeWorld;
        uniform float uTime, uWaterY, uIbl, uHazeScale, uTranslucency;
        ${sway ? 'varying float vSwayW;' : ''}
        ${skyGLSL}
        ${fragment?.head ?? ''}`,
      )
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = applyHaze(gl_FragColor.rgb, cameraPosition + (vHazeWorld - cameraPosition) * uHazeScale);')
      // The bright sunset environment is tuned for the glass dancers; the world takes less of it.
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
        #if defined( RE_IndirectSpecular )
          radiance *= uIbl;
          clearcoatRadiance *= uIbl;
        #endif
        #if defined( RE_IndirectDiffuse )
          iblIrradiance *= uIbl;
        #endif`,
      );
    if (translucency && sway) {
      // Leaves glow warm where we look through them toward the low sun.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float toward = pow(max(dot(normalize(vHazeWorld - cameraPosition), uSunDir), 0.0), 6.0);
          totalEmissiveRadiance += diffuseColor.rgb * uGlow * toward * smoothstep(0.25, 0.7, vSwayW) * uTranslucency;
        }`,
      );
    }
    if (fragment?.color) shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n${fragment.color}`);
    if (fragment?.normal) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${fragment.normal}`);
    if (fragment?.roughness) shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${fragment.roughness}`);
  };
  material.customProgramCacheKey = () => `beach-${key}-${sway ? 1 : 0}-${translucency ? 1 : 0}`;
  return material;
}

// Cheap stylised lighting for distant / moving things (boats, birds, dolphins):
// warm front key, sky/ground ambient, sunset rim from behind, horizon haze.
const litVertex = /* glsl */ `
uniform float uTime;
#ifdef FLAP
attribute float aSway;
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
    float id = float(gl_InstanceID);
    float flapOn = smoothstep(-0.2, 0.6, sin(uTime * 0.4 + id * 2.3));
    pos.y += (sin(uTime * 7.0 + id * 1.9) * flapOn * 0.85 + 0.12) * (span * span * 0.55 + span * 0.15);
  #endif
  vec4 wp = vec4(pos, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
    nrm = mat3(instanceMatrix) * nrm;
  #endif
  wp = modelMatrix * wp;
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * nrm);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const litFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uColor, uEmissive, uKeyDir, uKeyCol, uSkyAmb, uGroundAmb;
uniform float uShininess, uSpecular, uRim;
${skyGLSL}
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
  float ndl = dot(n, uKeyDir);
  float diff = max((ndl + 0.4) / 1.4, 0.0);
  vec3 col = base * (mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5) + uKeyCol * diff);
  vec3 h = normalize(uKeyDir + v);
  col += uKeyCol * pow(max(dot(n, h), 0.0), uShininess) * uSpecular;
  // Backlit by the low sun: warm fresnel rim on the side facing away from us.
  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float back = 0.35 + 0.65 * max(dot(-v, uSunDir), 0.0);
  col += uGlow * fr * uRim * back;
  col += uEmissive * vCol;
  gl_FragColor = vec4(applyHaze(col, vWorld), 1.0);
}
`;

export function makeLitMaterial({
  color = '#ffffff',
  emissive = '#000000',
  emissiveIntensity = 1,
  shininess = 40,
  specular = 0.35,
  rim = 0.5,
  vertexColors = true,
  side = THREE.FrontSide,
  flap = false,
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...skyUniforms(),
      uTime: world.uTime,
      uColor: { value: new THREE.Color(color) },
      uEmissive: { value: new THREE.Color(emissive).multiplyScalar(emissiveIntensity) },
      uKeyDir: { value: new THREE.Vector3(-0.35, 0.6, 0.75).normalize() },
      uKeyCol: { value: new THREE.Color('#ffd9c4').multiplyScalar(0.95) },
      uSkyAmb: { value: new THREE.Color('#c7a8e0').multiplyScalar(0.55) },
      uGroundAmb: { value: new THREE.Color('#e8b48a').multiplyScalar(0.35) },
      uShininess: { value: shininess },
      uSpecular: { value: specular },
      uRim: { value: rim },
    },
    defines: flap ? { FLAP: '' } : {},
    vertexShader: litVertex,
    fragmentShader: litFragment,
    vertexColors,
    side,
  });
}
