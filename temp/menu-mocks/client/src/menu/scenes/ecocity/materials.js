import * as THREE from 'three';
import { noise } from '../../shared/glsl.js';

// Shared uniforms for animated city shaders (updated once per frame).
export const cityUniforms = {
  uTime: { value: 0 },
  uBeat: { value: 0 },
  uFocus: { value: new THREE.Vector4(0, 0, 0, 0) }, // xyz landmark, w strength
};

const cityFragmentFunctions = /* glsl */ `
${noise}
varying vec4 vFacade;
varying vec4 vStyle;
varying vec2 vGrid;
varying vec3 vWPos;
uniform float uTime;
uniform float uBeat;
uniform vec4 uFocus;

// Box-filtered coverage of pulses [k, k + lw) for a filter of width w.
float lineCov(float x, float lw, float w) {
  float a = x + 0.5 * w;
  float b = x - 0.5 * w;
  return clamp((floor(a) * lw + min(fract(a), lw) - floor(b) * lw - min(fract(b), lw)) / w, 0.0, 1.0);
}
// Lines of width lw centered on integers.
float lineC(float x, float lw, float w) { return lineCov(x + lw * 0.5, lw, max(w, 1e-4)); }

vec3 glassTint(float t) {
  vec3 c0 = vec3(0.08, 0.62, 0.74);
  vec3 c1 = vec3(0.08, 0.36, 0.86);
  vec3 c2 = vec3(0.10, 0.64, 0.46);
  vec3 c3 = vec3(0.42, 0.74, 0.88);
  vec3 c4 = vec3(0.05, 0.22, 0.68);
  t = clamp(t, 0.0, 1.0) * 4.0;
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  return mix(c3, c4, t - 3.0);
}

void cityShade(inout vec3 col, inout float rough, inout float metal, inout vec3 tilt, inout vec3 emit) {
  float kind = vStyle.x;
  float ao = mix(0.62, 1.0, smoothstep(1.0, 16.0, vWPos.y));
  if (kind < 0.5) {
    vec2 g = vGrid;
    vec2 fw = max(fwidth(g), vec2(1e-4));
    float detail = 1.0 - smoothstep(0.3, 0.9, max(fw.x, fw.y));
    float style = vFacade.y;
    float seed = vFacade.z * 97.0;
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float r1 = hash12(cell + seed);
    float r2 = hash12(cell.yx * 1.37 + seed + 11.0);
    float r3 = hash12(vec2(cell.y, floor(cell.x / 3.0)) + seed * 1.7);
    vec3 tint = glassTint(vFacade.x);
    // Glass gets subtly lighter toward the top, like sky reflected at a grazing angle.
    vec3 gcol = tint * (1.0 + (r1 - 0.5) * 0.22 * detail);
    float gRough = 0.03 + r2 * 0.05;
    float gMetal = 0.86;
    // Occasional panes where the interior shows through (blinds, warm rooms, plants).
    // A few panes show the interior through the glass: pale blinds or plants.
    float interior = step(0.93, r2) * detail;
    float blinds = smoothstep(0.45, 0.5, f.y);
    vec3 room = mix(tint * 0.9 + 0.12, vec3(0.86, 0.92, 0.95), blinds * 0.8);
    room = mix(room, vec3(0.22, 0.5, 0.16), step(0.975, r2));
    gcol = mix(gcol, room, interior * 0.6);
    gMetal = mix(gMetal, 0.45, interior);
    gRough = mix(gRough, 0.2, interior);

    float frame = 0.0;
    float spand = 0.0;
    if (style < 0.5) {
      frame = max(lineC(g.x, 0.06, fw.x), lineC(g.y, 0.12, fw.y));
    } else if (style < 1.5) {
      spand = lineCov(g.y, 0.34, fw.y);
      frame = max(lineC(g.x, 0.035, fw.x) * 0.8, spand);
    } else if (style < 2.5) {
      float d1 = (g.x + g.y * 0.75) * 0.5;
      float d2 = (g.x - g.y * 0.75) * 0.5;
      frame = max(lineC(d1, 0.07, fwidth(d1)), lineC(d2, 0.07, fwidth(d2)));
      frame = max(frame, lineC(g.y, 0.06, fw.y) * 0.75);
    } else {
      frame = max(lineC(g.x, 0.22, fw.x), lineC(g.y, 0.05, fw.y));
    }
    float bandN = vStyle.y;
    if (bandN > 0.5) {
      float band = lineC(g.y / bandN, 0.85 / bandN, fw.y / bandN);
      frame = max(frame, band);
      spand = max(spand, band);
    }
    // Greenery: planted spandrels (ribbon) or vertical garden strips.
    float plant = 0.0;
    float green = vFacade.w;
    if (green > 0.0) {
      if (style > 0.5 && style < 1.5) {
        // Continuous planter bands every third floor, with occasional gaps.
        plant = spand * step(mod(cell.y, 3.0), 0.5) * step(r3, green + 0.35);
      } else {
        float strip = floor(g.x / 4.0);
        plant = lineC(g.x / 4.0, 0.25, fw.x / 4.0) * step(hash12(vec2(strip, seed)), green * 0.6);
      }
      plant *= smoothstep(6.0, 14.0, vWPos.y);
    }
    vec3 leaf = mix(vec3(0.05, 0.22, 0.03), vec3(0.28, 0.55, 0.06), snoise(vWPos * 0.7) * 0.5 + 0.5);
    vec3 frameCol = vec3(0.86, 0.9, 0.93);
    col = mix(gcol, frameCol, frame);
    col = mix(col, leaf, plant);
    rough = mix(gRough, 0.3, frame);
    rough = mix(rough, 0.9, plant);
    metal = mix(gMetal, 0.05, max(frame, plant));
    float pane = (1.0 - frame) * detail;
    tilt = vec3(r1 - 0.5, r2 - 0.5, r3 - 0.5) * 0.045 * pane;
    col *= ao;
    // Menu focus: a band of light sweeps up the highlighted tower.
    if (uFocus.w > 0.001) {
      float fd = length(vWPos.xz - uFocus.xy);
      float fm = (1.0 - smoothstep(uFocus.z * 0.75, uFocus.z, fd)) * uFocus.w;
      float sw = fract(vWPos.y * 0.008 - uTime * 0.4);
      float band = smoothstep(0.0, 0.03, sw) * smoothstep(0.14, 0.03, sw);
      float lit = step(0.6, hash12(cell + floor(uTime * 2.0) + seed));
      emit += vec3(0.3, 0.9, 1.0) * (band * 1.3 + 0.05 + lit * 0.22 * detail) * fm * (1.0 - frame * 0.6);
    }
  } else if (kind < 1.5) {
    rough = vStyle.z;
    metal = vStyle.w;
    col *= ao;
  } else if (kind < 2.5) {
    float n = snoise(vWPos * 0.8) * 0.5 + snoise(vWPos * 2.1) * 0.25;
    col *= 0.78 + 0.4 * n;
    rough = 0.85;
    metal = 0.0;
    col *= ao;
  } else if (kind < 3.5) {
    vec2 g = vGrid * vec2(4.0, 6.0);
    vec2 fw = max(fwidth(g), vec2(1e-4));
    float grid = max(lineC(g.x, 0.1, fw.x), lineC(g.y, 0.1, fw.y));
    col = mix(vec3(0.05, 0.2, 0.62), vec3(0.8, 0.85, 0.9), grid);
    rough = mix(0.12, 0.4, grid);
    metal = mix(0.55, 0.2, grid);
  } else if (kind < 4.5) {
    rough = 0.6;
    metal = 0.0;
    col *= ao;
  } else {
    // Emissive accents: aviation lights, stage glow, lamp heads.
    float blink = vStyle.y > 0.5 ? 0.35 + 0.65 * step(0.0, sin(uTime * 2.4 + vWPos.x * 0.37 + vWPos.z * 0.11)) : 1.0;
    float beat = vStyle.z > 0.5 ? 0.6 + 0.9 * uBeat : 1.0;
    emit = col * vStyle.w * blink * beat;
    rough = 0.3;
    metal = 0.0;
  }
}
`;

/**
 * The single material for all static city geometry. Surface kind and facade
 * parameters come from vertex attributes (see geometry.js KIND).
 */
export function makeCityMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = cityUniforms.uTime;
    shader.uniforms.uBeat = cityUniforms.uBeat;
    shader.uniforms.uFocus = cityUniforms.uFocus;
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
      .replace('#include <common>', `#include <common>\n${cityFragmentFunctions}`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        vec3 gTilt = vec3(0.0);
        vec3 gEmit = vec3(0.0);
        cityShade(diffuseColor.rgb, roughnessFactor, metalnessFactor, gTilt, gEmit);`,
      )
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n normal = normalize(normal + gTilt);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += gEmit;`);
  };
  mat.customProgramCacheKey = () => 'ecocity-city';
  return mat;
}

/**
 * Procedural environment: blue sky with soft clouds, a hot sun for glints,
 * a band of distant skyline at the horizon and green land below.
 */
export function makeEnvironment(renderer, sun) {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: sun.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${noise}
      uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 top = vec3(0.07, 0.30, 0.82);
        vec3 hor = vec3(0.70, 0.88, 1.0);
        vec3 col = mix(hor, top, pow(clamp(h, 0.0, 1.0), 0.45));
        if (h > 0.0) {
          vec2 p = d.xz / (h + 0.18) * 1.4;
          float c = fbm(p * 1.1 + 3.0);
          c = smoothstep(0.05, 0.55, c) * smoothstep(0.0, 0.12, h);
          float shade = smoothstep(-0.2, 0.4, fbm(p * 1.1 + 3.4));
          col = mix(col, mix(vec3(0.82, 0.88, 0.96), vec3(1.25), shade), c * 0.85);
        }
        // Distant skyline silhouettes reflected near the horizon.
        float az = atan(d.z, d.x);
        float id = floor(az * 36.0);
        float bh = 0.015 + 0.1 * pow(hash11(id * 1.7 + 3.0), 2.0) * step(0.3, hash11(id + 9.0));
        float sky = smoothstep(0.0, -0.04, h);
        if (h < bh && h > -0.06) {
          vec3 b = mix(vec3(0.45, 0.62, 0.72), vec3(0.78, 0.88, 0.94), hash11(id + 2.0));
          float win = step(0.5, fract(h * 300.0)) * 0.08;
          col = b - win;
        }
        if (h < 0.0) {
          // Below the horizon: hazy bright city and bay, not dark earth, so
          // glass seen from above still reads as gleaming.
          vec3 ground = mix(vec3(0.3, 0.5, 0.6), vec3(0.12, 0.3, 0.34), clamp(-h * 1.6, 0.0, 1.0));
          col = mix(col, ground, smoothstep(-0.03, -0.1, h));
        }
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.92, 0.78) * (pow(s, 1500.0) * 90.0 + pow(s, 80.0) * 1.2 + pow(s, 8.0) * 0.2);
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

/** Inject wind sway + per-instance tint into a standard material used by instanced foliage. */
export function makeFoliageMaterial({ sway = 0.35, roughness = 0.75 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness, metalness: 0, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = cityUniforms.uTime;
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
          transformed.x += sin(uTime * 1.3 + ph) * ${sway.toFixed(3)} * w * 0.12;
          transformed.z += cos(uTime * 1.1 + ph * 1.3) * ${sway.toFixed(3)} * w * 0.08;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vPart;
        varying float vH;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Canopies get a soft top-light gradient.
        diffuseColor.rgb *= mix(1.0, 0.7 + 0.45 * clamp(vH, 0.0, 1.0), vPart);`,
      );
  };
  mat.customProgramCacheKey = () => `ecocity-foliage-${sway}`;
  return mat;
}
