import * as THREE from 'three';
import { hash } from '../shared/glsl.js';
import { club } from './clock.js';

const clubDecl = /* glsl */ `
uniform float uTime;
uniform float uBeat;
uniform float uPulse;
uniform vec3 uBallPos;
uniform float uBallRot;
uniform float uDots;
`;

export const hueGLSL = /* glsl */ `
vec3 clubHue(float t) {
  float s = 1.0 - abs(fract(t) * 2.0 - 1.0);
  float x = s * 4.0;
  vec3 c0 = vec3(0.62, 1.0, 0.23);
  vec3 c1 = vec3(0.12, 0.91, 1.0);
  vec3 c2 = vec3(0.18, 0.55, 1.0);
  vec3 c3 = vec3(0.55, 0.36, 1.0);
  vec3 c4 = vec3(1.0, 0.25, 0.82);
  if (x < 1.0) return mix(c0, c1, smoothstep(0.0, 1.0, x));
  if (x < 2.0) return mix(c1, c2, smoothstep(1.0, 2.0, x));
  if (x < 3.0) return mix(c2, c3, smoothstep(2.0, 3.0, x));
  return mix(c3, c4, smoothstep(3.0, 4.0, x));
}
`;

// Light dots thrown by the slowly turning mirror ball onto any surface.
const ballDotsGLSL = /* glsl */ `
vec3 ballDots(vec3 wp, vec3 n) {
  vec3 d = wp - uBallPos;
  float dist = length(d);
  d /= dist;
  float facing = smoothstep(0.0, 0.35, dot(n, -d));
  float c = cos(uBallRot), s = sin(uBallRot);
  vec3 r = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  const float PI_ = 3.14159265;
  float lat = acos(clamp(r.y, -1.0, 1.0));
  float rows = 26.0;
  float row = floor(lat / PI_ * rows);
  float latC = (row + 0.5) / rows * PI_;
  float cols = max(3.0, floor(rows * 2.0 * sin(latC)));
  float lon = atan(r.z, r.x) + PI_;
  float col = floor(lon / (2.0 * PI_) * cols);
  float lonC = (col + 0.5) / cols * 2.0 * PI_ - PI_;
  vec3 cd = vec3(sin(latC) * cos(lonC), cos(latC), sin(latC) * sin(lonC));
  float h = hash12(vec2(row, col) + 3.7);
  float size = 0.008 + 0.006 * h;
  float spot = smoothstep(size, size * 0.35, length(r - cd)) * step(0.45, h);
  vec3 tint = mix(vec3(1.0), clubHue(h * 3.0 + uBeat * 0.03), 0.55);
  return tint * spot * facing * uDots * 2.2 / (1.0 + dist * dist * 0.004);
}
`;

export const clubCommon = clubDecl + hash + hueGLSL + ballDotsGLSL;

// Glassy bubble sprite for points: thin bright rim plus a highlight.
export const bubbleSpriteGLSL = /* glsl */ `
float bubbleSprite(vec2 pc) {
  vec2 d = pc - 0.5;
  float r = length(d) * 2.0;
  float ring = smoothstep(1.0, 0.82, r) * (0.18 + 0.82 * smoothstep(0.45, 0.95, r));
  float hl = smoothstep(0.32, 0.05, length(d - vec2(-0.16, -0.16)));
  return ring + hl;
}
`;

/**
 * Patch a lit three.js material with club extras, keeping lights/shadows/env:
 *   uniforms/head: extra uniforms and GLSL declarations
 *   emissive: GLSL that adds to `totalEmissiveRadiance` (has `vClubWorld`, `vClubNormal`)
 *   dots: mirror-ball dot strength
 *   shadowEmissive: how much the key light's shadow dims the emissive (0..1)
 */
export function patchClub(material, { key, uniforms = {}, head = '', emissive = '', dots = 0, shadowEmissive = 0 } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, club, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vClubWorld;\nvarying vec3 vClubNormal;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        {
          vec4 cw = vec4(transformed, 1.0);
          vec3 cn = objectNormal;
          #ifdef USE_INSTANCING
            cw = instanceMatrix * cw;
            cn = mat3(instanceMatrix) * cn;
          #endif
          vClubWorld = (modelMatrix * cw).xyz;
          vClubNormal = normalize(mat3(modelMatrix) * cn);
        }`,
      );
    let frag = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vClubWorld;\nvarying vec3 vClubNormal;\n${clubCommon}\n${head}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n{\n${emissive}\n}\n` +
          (dots ? `totalEmissiveRadiance += ballDots(vClubWorld, normalize(vClubNormal)) * ${dots.toFixed(3)};\n` : ''),
      );
    if (shadowEmissive > 0) {
      frag = frag.replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        {
          float clubShadow = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
          totalEmissiveRadiance *= mix(1.0 - ${shadowEmissive.toFixed(3)}, 1.0, clubShadow);
        }
        #endif`,
      );
    }
    shader.fragmentShader = frag;
  };
  // Same onBeforeCompile source for every patch, so tell three which program is which.
  material.customProgramCacheKey = () => `club-${key}`;
  return material;
}

// Uniforms + chunks for custom ShaderMaterials that want scene fog.
export function fogUniforms(extra = {}) {
  return { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...club, ...extra };
}
