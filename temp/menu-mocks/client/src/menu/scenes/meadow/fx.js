// Shared wind / light state for the Breezy Meadow. Every custom material in
// the scene references these uniform objects, so one update per frame drives
// the grass, flowers, tree, seeds and terrain highlights together.
import * as THREE from 'three';
import { noise } from '../../shared/glsl.js';
import { mulberry32 } from '../../shared/random.js';

const WIND = new THREE.Vector2(1, 0.22).normalize();

export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: WIND.clone() },
  // A wind "front" triggered by the menu: sweeps across along the wind axis.
  uSweep: { value: -999 },
  uSweepAmp: { value: 0 },
  // Tileable value-noise texture (RGBA = 4 independent fields), see makeNoiseTexture.
  uNoise: { value: null },
};

/**
 * 256x256 tileable value noise, 3 octaves per channel, contrast-normalised.
 * Sampling a texture is far cheaper than simplex noise in the grass vertex shader.
 * One noise unit = 1/8 of the texture.
 */
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const field = new Float32Array(size * size);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let ch = 0; ch < 4; ch++) {
    const rand = mulberry32(101 + ch * 977);
    field.fill(0);
    for (const [cells, amp] of [[8, 0.62], [16, 0.27], [32, 0.11]]) {
      const grid = new Float32Array(cells * cells).map(() => rand());
      for (let y = 0; y < size; y++) {
        const gy = (y / size) * cells;
        const y0 = Math.floor(gy);
        const fy = smooth(gy - y0);
        const y1 = (y0 + 1) % cells;
        for (let x = 0; x < size; x++) {
          const gx = (x / size) * cells;
          const x0 = Math.floor(gx);
          const fx = smooth(gx - x0);
          const x1 = (x0 + 1) % cells;
          const a = grid[y0 * cells + x0] + (grid[y0 * cells + x1] - grid[y0 * cells + x0]) * fx;
          const b = grid[y1 * cells + x0] + (grid[y1 * cells + x1] - grid[y1 * cells + x0]) * fx;
          field[y * size + x] += (a + (b - a) * fy) * amp;
        }
      }
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of field) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    for (let i = 0; i < size * size; i++) data[i * 4 + ch] = Math.round(((field[i] - lo) / (hi - lo)) * 255);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const lightUniforms = {
  uSunDir: { value: new THREE.Vector3(-0.45, 0.72, 0.25).normalize() },
  uSunColor: { value: new THREE.Color('#fff1d6') },
  uSkyLight: { value: new THREE.Color('#b9dcff') },
  uGroundLight: { value: new THREE.Color('#6d8f3c') },
  uHaze: { value: new THREE.Color('#cde9fb') },
  uHazeDensity: { value: 0.0016 },
  // Visible sun direction (sky dome / flare / backlit translucency).
  uSunView: { value: new THREE.Vector3() },
};

// Menu -> scene reactions.
export const meadowFx = {
  sweepStart: -999,
  sweepStrength: 0,
  noteBurst: 0, // incremented on click; the gazebo emits extra notes
  burstTime: -999,
  hoverIndex: -1,
};

export function triggerGust(time, strength = 1) {
  meadowFx.sweepStart = time;
  meadowFx.sweepStrength = strength;
}

/** Advance shared uniforms; call once per frame. */
export function tickMeadow(t) {
  windUniforms.uTime.value = t;
  const age = t - meadowFx.sweepStart;
  // Front travels ~28 m/s from 70 m upwind across the meadow.
  windUniforms.uSweep.value = -70 + age * 28;
  windUniforms.uSweepAmp.value = meadowFx.sweepStrength * Math.max(0, 1 - age / 5.5);
}

export const windGLSL = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uSweep;
uniform float uSweepAmp;
uniform sampler2D uNoise;
${noise}
// Texture noise in roughly [-1, 1]; one unit = 1/8 of the tile.
vec4 tnoise(vec2 q) { return texture2D(uNoise, q * 0.125) * 2.0 - 1.0; }
// 0..~1 gust strength at a ground point; bright fronts travel downwind.
float gustField(vec2 p) {
  vec2 w = uWindDir;
  vec2 a = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
  vec2 q = vec2(a.x * 0.045 - uTime * 0.3, a.y * 0.018);
  float n = tnoise(q).r * 0.75 + tnoise(q * vec2(2.1, 2.6) + vec2(-uTime * 0.17, 3.7)).g * 0.25;
  float g = smoothstep(0.05, 0.6, n);
  float s = a.x - uSweep;
  g += uSweepAmp * exp(-s * s * 0.012) * (0.75 + 0.25 * sin(a.y * 0.3));
  return g;
}
`;

export const lightGLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyLight;
uniform vec3 uGroundLight;
uniform vec3 uHaze;
uniform float uHazeDensity;
uniform vec3 uSunView;
vec3 applyHaze(vec3 col, vec3 world, float strength) {
  float d = length(world - cameraPosition);
  float f = 1.0 - exp(-d * uHazeDensity * strength);
  vec3 dir = normalize(world - cameraPosition);
  vec3 haze = uHaze + vec3(0.16, 0.12, 0.03) * pow(max(dot(dir, normalize(uSunView)), 0.0), 8.0);
  return mix(col, haze, f);
}
`;

// Soft cloud shadows drifting over the land (needs windGLSL for tnoise).
export const cloudGLSL = /* glsl */ `
float cloudShade(vec2 p, float t, vec2 w) {
  float n = tnoise(p * 0.0105 - w * t * 0.042).b;
  return 1.0 - 0.28 * smoothstep(0.1, 0.55, n);
}
`;
