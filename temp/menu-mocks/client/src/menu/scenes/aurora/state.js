import * as THREE from 'three';

// World layout (world units ~ meters). The camera stands just above a still
// arctic lake looking north (-z) at mountains under the aurora.
export const CAMERA = { position: [0, 7, 40], target: [0, 16.5, -100], fov: 52 };
export const DOME_POS = new THREE.Vector3(54, 1.7, -58);
export const DOME_RADIUS = 10;
export const SKY_RADIUS = 3600;

// Objects on this layer are seen by the main camera but skipped by the lake
// reflection (screen-near snow, bokeh, mist).
export const NO_REFLECT = 1;

// Aurora palettes, one per XMB category: lower edge, body, upper fringe.
export const PALETTES = [
  { low: '#3dff96', mid: '#19e3cf', high: '#9f52ff' }, // Dance: classic green / violet
  { low: '#2cffd0', mid: '#1fb4ff', high: '#7b61ff' }, // Songs: teal / sapphire
  { low: '#52ffe0', mid: '#3d8bff', high: '#c262ff' }, // Online: aqua / indigo
  { low: '#5cff8c', mid: '#2ad6b2', high: '#ff5fc4' }, // Friends: green / rose
  { low: '#86ffb8', mid: '#3fe4ff', high: '#ff82e2' }, // Wardrobe: mint / pink
  { low: '#4dff7c', mid: '#1fc79c', high: '#8d70ff' }, // Settings: emerald
];

// Menu -> world signals. The menu writes, the world reads every frame.
export const fx = {
  focus: 0, // focused XMB category
  surge: 0, // 0..1, set to 1 when an item is activated (aurora brightening wave)
  surgeAge: 10, // seconds since the last surge started
  boost: 0, // gentle brightness lift while hovering items
  shoot: false, // request a shooting star
};

// Dev hook for poking the scene from the console / tests.
if (import.meta.env.DEV) window.__auroraFx = fx;

const c = (hex) => new THREE.Color(hex);

// Uniforms shared by every material in the scene (same objects by reference).
export const env = {
  uTime: { value: 0 },
  uMoonDir: { value: new THREE.Vector3() }, // where the moon is drawn in the sky
  uLightDir: { value: new THREE.Vector3(0.72, 0.5, -0.12).normalize() }, // moonlight used for shading
  uMoonCol: { value: c('#8ea8dc').multiplyScalar(0.58) },
  uSkyAmb: { value: c('#14234a').multiplyScalar(0.7) },
  uGroundAmb: { value: c('#070b18') },
  uAuroraGlow: { value: new THREE.Color() },
  uAurora0: { value: new THREE.Color() },
  uAurora1: { value: new THREE.Color() },
  uAurora2: { value: new THREE.Color() },
  uWarmPos: { value: DOME_POS.clone().add(new THREE.Vector3(0, 3.5, 0)) },
  uWarmCol: { value: c('#ff9a4a').multiplyScalar(2.2) },
  uZenith: { value: c('#050a27') },
  uMid: { value: c('#0a1c50') },
  uHorizon: { value: c('#103070') },
  uHazeCol: { value: new THREE.Color() },
  uHazeDensity: { value: 0.00065 },
  uSurge: { value: 0 },
  uSurgePos: { value: 0 },
  uBoost: { value: 0 },
};

// Moon in the upper right, above the dome.
{
  const az = THREE.MathUtils.degToRad(25);
  const el = THREE.MathUtils.degToRad(21);
  env.uMoonDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

// GLSL shared by lit world materials. Requires the env uniforms.
export const LIGHTING = /* glsl */ `
uniform float uTime;
uniform vec3 uLightDir;
uniform vec3 uMoonCol;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec3 uAuroraGlow;
uniform vec3 uWarmPos;
uniform vec3 uWarmCol;
uniform vec3 uHazeCol;
uniform float uHazeDensity;

vec3 warmLight(vec3 N, vec3 P) {
  vec3 L = uWarmPos - P;
  float d2 = dot(L, L);
  float ndl = max(dot(N, L * inversesqrt(d2)) * 0.75 + 0.25, 0.0);
  return uWarmCol * ndl / (1.0 + d2 * 0.009);
}

vec3 shade(vec3 albedo, vec3 N, vec3 P, float wrap) {
  float ndl = max((dot(N, uLightDir) + wrap) / (1.0 + wrap), 0.0);
  vec3 amb = mix(uGroundAmb, uSkyAmb, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
  vec3 aur = uAuroraGlow * clamp(N.y * 0.55 - N.z * 0.45, 0.0, 1.0);
  return albedo * (uMoonCol * ndl + amb + aur + warmLight(N, P));
}

vec3 applyHaze(vec3 col, vec3 P, float mul) {
  float d = length(P - cameraPosition);
  float f = 1.0 - exp(-d * uHazeDensity * mul);
  float low = exp(-abs(P.y) * 0.02);
  f = clamp(f * (0.75 + 0.45 * low), 0.0, 1.0);
  return mix(col, uHazeCol, f);
}
`;

