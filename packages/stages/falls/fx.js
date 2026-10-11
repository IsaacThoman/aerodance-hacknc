// Shared wind, light and haze state for Emerald Falls. Every custom material
// references these uniform objects, so one update per frame drives the grass,
// trees, water and haze together.
import * as THREE from 'three';
import { mulberry32 } from '../shared/random.js';

export const HAZE = '#c9e8fc';
export const SUN = { elevation: 46, azimuth: -122 };

export const fx = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(1, 0.3).normalize() },
  uNoise: { value: null },
  uBeat: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  // Sun / sky radiance already scaled to roughly match three's physical lights.
  uSunColor: { value: new THREE.Color('#fff0d2').multiplyScalar(0.95) },
  uSkyLight: { value: new THREE.Color('#9fcdf5').multiplyScalar(0.62) },
  uGroundLight: { value: new THREE.Color('#5d7f3a').multiplyScalar(0.5) },
  uHaze: { value: new THREE.Color(HAZE) },
  uHazeSun: { value: new THREE.Color('#fff2d6') },
  uHazeDensity: { value: 0.00082 },
};

/**
 * 256x256 tileable value noise, 3 octaves per channel (RGBA = 4 independent
 * fields). Sampling it is far cheaper than simplex in big vertex shaders.
 */
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const field = new Float32Array(size * size);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let ch = 0; ch < 4; ch++) {
    const rand = mulberry32(211 + ch * 977);
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
          const fx_ = smooth(gx - x0);
          const x1 = (x0 + 1) % cells;
          const a = grid[y0 * cells + x0] + (grid[y0 * cells + x1] - grid[y0 * cells + x0]) * fx_;
          const b = grid[y1 * cells + x0] + (grid[y1 * cells + x1] - grid[y1 * cells + x0]) * fx_;
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

// Uniform declarations + texture noise + wind gusts.
export const windGLSL = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform sampler2D uNoise;
uniform float uBeat;
// Texture noise in roughly [-1, 1]; one unit = 1/8 of the tile.
vec4 tnoise(vec2 q) { return texture2D(uNoise, q * 0.125) * 2.0 - 1.0; }
// 0..~1 gust strength at a ground point; bright fronts travel downwind.
float gustField(vec2 p) {
  vec2 w = uWindDir;
  vec2 a = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
  vec2 q = vec2(a.x * 0.08 - uTime * 0.5, a.y * 0.035);
  float n = tnoise(q).r * 0.75 + tnoise(q * vec2(2.1, 2.6) + vec2(-uTime * 0.27, 3.7)).g * 0.25;
  return smoothstep(0.0, 0.6, n);
}
`;

// Lighting + aerial perspective shared by every custom land/vegetation shader.
export const lightGLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyLight;
uniform vec3 uGroundLight;
uniform vec3 uHaze;
uniform vec3 uHazeSun;
uniform float uHazeDensity;
vec3 ambient(vec3 n) { return mix(uGroundLight, uSkyLight, n.y * 0.5 + 0.5); }
vec3 shadeLambert(vec3 albedo, vec3 n, float wrap, float ao) {
  float d = clamp((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0, 1.0);
  return albedo * (uSunColor * d + ambient(n)) * ao;
}
// Exponential haze, thicker in the low air of the valley basin.
float hazeAmount(vec3 world, float strength) {
  float dist = length(world - cameraPosition);
  float low = smoothstep(-8.0, -46.0, world.y);
  return 1.0 - exp(-dist * uHazeDensity * strength * (1.0 + low * 0.5));
}
vec3 hazeColor(vec3 world) {
  vec3 dir = normalize(world - cameraPosition);
  float s = pow(max(dot(dir, uSunDir), 0.0), 5.0);
  return mix(uHaze, uHazeSun, s * 0.5);
}
vec3 applyHaze(vec3 col, vec3 world, float strength) {
  return mix(col, hazeColor(world), hazeAmount(world, strength));
}
`;

export function tickFalls(t, beatPulse) {
  fx.uTime.value = t;
  fx.uBeat.value = beatPulse;
}
