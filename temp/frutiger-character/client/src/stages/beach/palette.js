import * as THREE from 'three';

// Golden-hour palette (sRGB hex; THREE.Color converts to linear).
export const SKY = {
  zenith: '#2f55c0',
  upper: '#5f73d6',
  lilac: '#a07ad8',
  pink: '#ff7aa2',
  peach: '#ff9466',
  gold: '#ffad48',
  glow: '#ffc865',
  sun: '#fff0c2',
};

// Low sun over the sea, framed between the two dancers.
export const SUN_ELEVATION = 3.0;
export const SUN_AZIMUTH = 0;
const e = THREE.MathUtils.degToRad(SUN_ELEVATION);
const a = THREE.MathUtils.degToRad(SUN_AZIMUTH);
export const SUN_DIR = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();

// Mean sea level; the dancers stand on the sand just above it.
export const WATER_Y = -0.7;

// Cove shoreline: z = z0 - k * x^2 on each side; land ends past the headlands.
export const SHORE = { z0: -1.4, left: 0.1, right: 0.1, endLeft: -46, endRight: -50 };

// Uniforms shared by every custom shader in the stage, updated once per frame.
export const world = {
  uTime: { value: 0 },
  uBeat: { value: 0 },
  uWaterY: { value: WATER_Y },
  uSunDir: { value: SUN_DIR.clone() },
  uZenith: { value: new THREE.Color(SKY.zenith) },
  uUpper: { value: new THREE.Color(SKY.upper) },
  uLilac: { value: new THREE.Color(SKY.lilac) },
  uPink: { value: new THREE.Color(SKY.pink) },
  uPeach: { value: new THREE.Color(SKY.peach) },
  uGold: { value: new THREE.Color(SKY.gold) },
  uGlow: { value: new THREE.Color(SKY.glow) },
  uSunCol: { value: new THREE.Color(SKY.sun) },
  uHazeDensity: { value: 1 / 1100 },
};
