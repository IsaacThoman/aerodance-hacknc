import * as THREE from 'three';
import { noise } from '../shared/glsl.js';

// Shared animated uniforms, updated once per frame by the stage clock.
export const stageUniforms = {
  uTime: { value: 0 },
  uBeat: { value: 0 },
  uBeatPhase: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
};

const cityFragment = /* glsl */ `
${noise}
varying vec4 vFacade;
varying vec4 vStyle;
varying vec2 vGrid;
varying vec3 vWPos;
uniform float uTime;
uniform float uBeat;

// Box-filtered coverage of pulses [k, k + lw) for a filter of width w (anti-aliased lines).
float lineCov(float x, float lw, float w) {
  float a = x + 0.5 * w;
  float b = x - 0.5 * w;
  return clamp((floor(a) * lw + min(fract(a), lw) - floor(b) * lw - min(fract(b), lw)) / w, 0.0, 1.0);
}
float lineC(float x, float lw, float w) { return lineCov(x + lw * 0.5, lw, max(w, 1e-4)); }

// Frutiger glass palette: cyan, teal, aqua-green, pale white-blue, blue.
vec3 glassTint(float t) {
  vec3 c0 = vec3(0.04, 0.62, 0.82);
  vec3 c1 = vec3(0.02, 0.40, 0.66);
  vec3 c2 = vec3(0.10, 0.70, 0.50);
  vec3 c3 = vec3(0.45, 0.80, 0.92);
  vec3 c4 = vec3(0.05, 0.30, 0.85);
  t = clamp(t, 0.0, 1.0) * 4.0;
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  return mix(c3, c4, t - 3.0);
}

void cityShade(inout vec3 col, inout float rough, inout float metal, inout vec3 tilt, inout vec3 emit) {
  float kind = vStyle.x;
  if (kind < 0.5) {
    vec2 g = vGrid;
    vec2 fw = max(fwidth(g), vec2(1e-4));
    float detail = 1.0 - smoothstep(0.35, 0.9, max(fw.x, fw.y));
    float style = vFacade.y;
    float seed = vFacade.z * 97.0;
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float r1 = hash12(cell + seed);
    float r2 = hash12(cell.yx * 1.37 + seed + 11.0);
    float r3 = hash12(vec2(cell.y, floor(cell.x / 3.0)) + seed * 1.7);
    vec3 tint = glassTint(vFacade.x);
    vec3 gcol = tint * (1.0 + (r1 - 0.5) * 0.25 * detail);
    float gRough = 0.03 + r2 * 0.05;
    float gMetal = 0.88;
    // A few panes show the interior: pale blinds or plants.
    float interior = step(0.92, r2) * detail;
    vec3 room = mix(tint * 0.8 + 0.18, vec3(0.9, 0.95, 0.97), smoothstep(0.45, 0.5, f.y) * 0.8);
    room = mix(room, vec3(0.25, 0.55, 0.18), step(0.975, r2));
    gcol = mix(gcol, room, interior * 0.6);
    gMetal = mix(gMetal, 0.4, interior);
    gRough = mix(gRough, 0.2, interior);

    float frame = 0.0;
    float spand = 0.0;
    if (style < 0.5) {
      frame = max(lineC(g.x, 0.07, fw.x), lineC(g.y, 0.14, fw.y));
    } else if (style < 1.5) {
      // Ribbon windows: white spandrel bands between glass strips.
      spand = lineCov(g.y, 0.36, fw.y);
      frame = max(lineC(g.x, 0.04, fw.x) * 0.8, spand);
    } else if (style < 2.5) {
      float d1 = (g.x + g.y * 0.75) * 0.5;
      float d2 = (g.x - g.y * 0.75) * 0.5;
      frame = max(lineC(d1, 0.07, fwidth(d1)), lineC(d2, 0.07, fwidth(d2)));
      frame = max(frame, lineC(g.y, 0.06, fw.y) * 0.75);
    } else {
      frame = max(lineC(g.x, 0.22, fw.x), lineC(g.y, 0.06, fw.y));
    }
    float bandN = vStyle.y;
    if (bandN > 0.5) {
      float band = lineC(g.y / bandN, 0.9 / bandN, fw.y / bandN);
      frame = max(frame, band);
      spand = max(spand, band);
    }
    // Greenery: planted spandrels or vertical garden strips.
    float plant = 0.0;
    float green = vFacade.w;
    if (green > 0.0) {
      if (style > 0.5 && style < 1.5) {
        plant = spand * step(mod(cell.y, 3.0), 0.5) * step(r3, green + 0.35);
      } else {
        float strip = floor(g.x / 4.0);
        plant = lineC(g.x / 4.0, 0.28, fw.x / 4.0) * step(hash12(vec2(strip, seed)), green * 0.7);
      }
    }
    vec3 leaf = mix(vec3(0.06, 0.26, 0.04), vec3(0.3, 0.6, 0.08), snoise(vWPos * 0.5) * 0.5 + 0.5);
    vec3 frameCol = vec3(0.9, 0.94, 0.96);
    col = mix(gcol, frameCol, frame);
    col = mix(col, leaf, plant);
    rough = mix(gRough, 0.32, frame);
    rough = mix(rough, 0.9, plant);
    metal = mix(gMetal, 0.04, max(frame, plant));
    float pane = (1.0 - frame) * (1.0 - plant);
    tilt = vec3(r1 - 0.5, r2 - 0.5, r3 - 0.5) * 0.05 * pane * detail;
    // Window glints: individual panes flash as if catching the sun.
    float gl = hash12(cell * 0.73 + seed + 5.0);
    float ph = fract(uTime * (0.08 + 0.1 * gl) + gl * 13.0);
    float flash = smoothstep(0.0, 0.03, ph) * smoothstep(0.1, 0.03, ph) * step(0.975, hash12(cell + seed * 0.37 + 2.0));
    float spot = smoothstep(0.5, 0.1, length(f - 0.5));
    emit += vec3(1.0, 0.97, 0.9) * flash * spot * pane * detail * 3.0;
  } else if (kind < 1.5) {
    rough = vStyle.z;
    metal = vStyle.w;
  } else if (kind < 2.5) {
    float n = snoise(vWPos * 0.25) * 0.5 + snoise(vWPos * 0.9) * 0.25;
    col *= 0.8 + 0.45 * n;
    rough = 0.85;
    metal = 0.0;
  } else if (kind < 3.5) {
    vec2 g = vGrid * vec2(4.0, 6.0);
    vec2 fw = max(fwidth(g), vec2(1e-4));
    float grid = max(lineC(g.x, 0.1, fw.x), lineC(g.y, 0.1, fw.y));
    col = mix(vec3(0.04, 0.2, 0.6), vec3(0.85, 0.9, 0.95), grid);
    rough = mix(0.1, 0.4, grid);
    metal = mix(0.6, 0.2, grid);
  } else {
    float blink = vStyle.y > 0.5 ? 0.3 + 0.7 * step(0.0, sin(uTime * 2.2 + vWPos.x * 0.37 + vWPos.z * 0.11)) : 1.0;
    float beat = vStyle.z > 0.5 ? 0.6 + 0.8 * uBeat : 1.0;
    emit = col * vStyle.w * blink * beat;
    rough = 0.3;
    metal = 0.0;
  }
}
`;

/**
 * One material for all static city geometry: surface kind and facade
 * parameters come from vertex attributes (see geometry.js KIND).
 */
export function makeCityMaterial(envMap) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, envMap, envMapIntensity: 1 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = stageUniforms.uTime;
    shader.uniforms.uBeat = stageUniforms.uBeat;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aFacade;
        attribute vec4 aStyle;
        varying vec4 vFacade;
        varying vec4 vStyle;
        varying vec2 vGrid;
        varying vec3 vWPos;`,
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
        vFacade = aFacade;
        vStyle = aStyle;
        vGrid = uv;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${cityFragment}`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        vec3 gTilt = vec3(0.0);
        vec3 gEmit = vec3(0.0);
        cityShade(diffuseColor.rgb, roughnessFactor, metalnessFactor, gTilt, gEmit);`,
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + gTilt);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;');
  };
  mat.customProgramCacheKey = () => 'sanctuary-city';
  return mat;
}

/**
 * Reflection map for the city glass, water and chrome: deep blue sky with
 * soft cumulus, a sun for glints, a pale skyline band at the horizon and the
 * bright green-and-glass city below (glass seen from above reflects it).
 * Glossy surfaces close to the camera use a soft sun so it can't blow out.
 */
export function makeCityEnv(renderer, sunDir, sunStrength = 30) {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: sunDir.clone() }, uSunStrength: { value: sunStrength } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${noise}
      uniform vec3 uSun;
      uniform float uSunStrength;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 top = vec3(0.02, 0.16, 0.72);
        vec3 hor = vec3(0.5, 0.78, 0.98);
        vec3 col = mix(hor, top, pow(clamp(h, 0.0, 1.0), 0.5));
        if (h > 0.0) {
          vec2 p = d.xz / (h + 0.2) * 1.3;
          float c = fbm(p * 1.2 + 3.0);
          c = smoothstep(0.0, 0.5, c) * smoothstep(0.0, 0.15, h);
          float shade = smoothstep(-0.2, 0.4, fbm(p * 1.2 + 3.5));
          col = mix(col, mix(vec3(0.78, 0.86, 0.96), vec3(1.3), shade), c * 0.9);
        }
        float az = atan(d.z, d.x);
        float id = floor(az * 40.0);
        float bh = 0.01 + 0.08 * pow(hash11(id * 1.7 + 3.0), 2.0) * step(0.3, hash11(id + 9.0));
        if (h < bh && h > -0.04) col = mix(vec3(0.5, 0.72, 0.8), vec3(0.84, 0.93, 0.97), hash11(id + 2.0));
        if (h < 0.0) {
          vec3 ground = mix(vec3(0.42, 0.66, 0.6), vec3(0.2, 0.42, 0.36), clamp(-h * 1.5, 0.0, 1.0));
          col = mix(col, ground, smoothstep(-0.03, -0.12, h));
        }
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.94, 0.8) * (pow(s, 1200.0) * uSunStrength + pow(s, 60.0) * 1.2 + pow(s, 6.0) * 0.2);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const geometry = new THREE.SphereGeometry(10, 96, 48);
  scene.add(new THREE.Mesh(geometry, material));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 0.1, 100, { size: 256 });
  pmrem.dispose();
  geometry.dispose();
  material.dispose();
  return target;
}

/** Instanced foliage: wind sway on canopies (aPart = 1) and per-instance tint. */
export function makeFoliageMaterial({ sway = 0.3, envMap = null } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, vertexColors: true, envMap, envMapIntensity: 0.6 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = stageUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        attribute float aPart;
        varying float vPart;
        varying float vH;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #if defined(USE_INSTANCING_COLOR) && defined(USE_COLOR)
          vColor.xyz = mix(color.xyz, color.xyz * instanceColor.xyz, aPart);
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPart = aPart;
        vH = position.y;
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float ph = ip.x * 0.13 + ip.z * 0.07;
          float w = aPart * max(position.y, 0.0);
          transformed.x += sin(uTime * 1.3 + ph) * ${sway.toFixed(3)} * w * 0.1;
          transformed.z += cos(uTime * 1.1 + ph * 1.3) * ${sway.toFixed(3)} * w * 0.07;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPart;\nvarying float vH;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Canopies get a soft sunlit top.
        diffuseColor.rgb *= mix(1.0, 0.72 + 0.5 * clamp(vH, 0.0, 1.0), vPart);`,
      );
  };
  mat.customProgramCacheKey = () => `sanctuary-foliage-${sway}`;
  return mat;
}
