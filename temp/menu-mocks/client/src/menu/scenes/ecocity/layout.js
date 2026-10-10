import * as THREE from 'three';

// World layout for the Eco Metropolis: meters, water at y = 0, city ground
// at y = GROUND, the bay in the foreground (+z) and hills beyond (-z).

export const GROUND = 1.5;

const sunE = THREE.MathUtils.degToRad(33);
const sunA = THREE.MathUtils.degToRad(116);
export const SUN = new THREE.Vector3(Math.sin(sunA) * Math.cos(sunE), Math.sin(sunE), -Math.cos(sunA) * Math.cos(sunE)).normalize();

export const FOG = [420, 3000];

export const COLORS = {
  skyTop: '#1262cf',
  skyHorizon: '#c6e9ff',
  fog: '#c9e6fa',
};

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** z of the shoreline at x (land is at smaller z). */
export function shoreZ(x) {
  return 46 + 7 * Math.sin(0.012 * x + 0.6) + 190 * smooth(360, 600, x) + 170 * smooth(-380, -640, x);
}

/** Terrain height: flat city, rolling hills behind and headlands to the sides. */
export function groundHeight(x, z) {
  const back = smooth(-330, -560, z);
  const side = Math.max(smooth(330, 470, x), smooth(-350, -500, x));
  const rolling =
    48 +
    30 * Math.sin(x * 0.0052 + 0.7) * Math.cos(z * 0.0061 + 0.3) +
    18 * Math.sin(x * 0.013 + 2.1 + z * 0.004) +
    10 * Math.cos(z * 0.017 + x * 0.006);
  const far = smooth(-700, -1100, z) * 40;
  // Headland hills taper down into beaches near the water.
  const toShore = smooth(0, 90, shoreZ(x) - z);
  const sideHill = side * (26 + 16 * Math.sin(x * 0.012 + z * 0.01)) * toShore;
  const backHill = back * (rolling + far);
  return GROUND + Math.max(backHill, sideHill);
}

// Street grid (center lines). Blocks between streets hold buildings or parks.
export const STREETS_X = [-350, -250, -150, -50, 50, 150, 250, 340];
export const AVENUES_Z = [20, -70, -165, -260, -335];

// The monorail loop runs over the waterfront promenade and back along streets.
export const MONORAIL_CORNERS = [
  [-262, 30],
  [262, 30],
  [262, -165],
  [-250, -165],
];
export const MONORAIL_Y = 24;

// Landmarks that menu items point at.
export const LANDMARKS = {
  plaza: new THREE.Vector3(100, 0, -22),
  hero: new THREE.Vector3(100, 0, -118),
  dome: new THREE.Vector3(-90, 0, -112),
  shell: new THREE.Vector3(-8, 0, 36),
  twist: new THREE.Vector3(205, 0, -100),
  turbines: new THREE.Vector3(160, 0, -560),
};

/*
 * Hand-placed towers. type: cyl | ellipse | twist | sail | bulge | stepped | lobed | block
 * a/b: half extents (m), h: height, style: 0 curtain, 1 ribbon, 2 diagrid, 3 fins
 * tint: 0..1 glass palette, top: crown | dome | garden | spire | none, rot: yaw
 */
export const TOWERS = [
  { x: 100, z: -118, type: 'twist', a: 17, b: 17, h: 214, style: 3, tint: 0.05, top: 'petals', twist: 1.4, bands: 12, green: 0 },
  { x: 8, z: -112, type: 'sail', a: 22, b: 12, h: 176, style: 0, tint: 0.5, top: 'crown', rot: 0.15, bands: 8 },
  { x: 205, z: -100, type: 'lobed', a: 15, b: 15, h: 150, style: 3, tint: 0.28, top: 'garden', twist: 0.7, bands: 10, green: 0.5 },
  { x: -18, z: -212, type: 'bulge', a: 19, b: 19, h: 168, style: 2, tint: 0.9, top: 'dome' },
  { x: 195, z: -212, type: 'stepped', a: 22, b: 18, h: 136, style: 1, tint: 0.7, top: 'garden', green: 0.9 },
  { x: 58, z: -214, type: 'ellipse', a: 20, b: 13, h: 190, style: 0, tint: 0.3, top: 'crown', rot: -0.35, bands: 9 },
  { x: 128, z: -206, type: 'cyl', a: 11, b: 11, h: 196, style: 0, tint: 0.12, top: 'spire', bands: 14 },
  { x: -112, z: -214, type: 'sail', a: 20, b: 11, h: 150, style: 1, tint: 0.55, top: 'garden', rot: 2.9, green: 0.4 },
  { x: -200, z: -108, type: 'twist', a: 15, b: 13, h: 132, style: 0, tint: 0.35, top: 'crown', twist: 0.9, bands: 8 },
  { x: 290, z: -105, type: 'cyl', a: 13, b: 13, h: 112, style: 0, tint: 0.62, top: 'garden', bands: 6, green: 0.6 },
  { x: 300, z: -150, type: 'cyl', a: 10, b: 10, h: 92, style: 3, tint: 0.45, top: 'dome', bands: 6 },
  { x: -200, z: -212, type: 'stepped', a: 22, b: 20, h: 118, style: 0, tint: 0.2, top: 'garden', green: 0.8 },
  { x: 290, z: -212, type: 'twist', a: 14, b: 14, h: 158, style: 1, tint: 0.8, top: 'spire', twist: -0.8, bands: 10 },
  { x: -300, z: -110, type: 'ellipse', a: 18, b: 14, h: 104, style: 1, tint: 0.15, top: 'garden', bands: 0, green: 0.5 },
  { x: -300, z: -212, type: 'cyl', a: 14, b: 14, h: 138, style: 2, tint: 0.4, top: 'dome' },
  { x: 25, z: -300, type: 'lobed', a: 16, b: 16, h: 172, style: 0, tint: 0.65, top: 'crown', twist: -0.6, bands: 9 },
  { x: -70, z: -298, type: 'cyl', a: 13, b: 13, h: 140, style: 1, tint: 0.25, top: 'garden', bands: 0 },
  { x: 110, z: -300, type: 'sail', a: 20, b: 10, h: 158, style: 3, tint: 0.85, top: 'spire', rot: -0.2 },
  { x: 205, z: -298, type: 'ellipse', a: 16, b: 12, h: 126, style: 3, tint: 0.5, top: 'garden', bands: 7 },
  { x: -160, z: -300, type: 'bulge', a: 15, b: 15, h: 128, style: 2, tint: 0.1, top: 'dome' },
];

// Sky bridges (tower index pairs and heights).
export const BRIDGES = [
  { from: 0, to: 2, y: 118 },
  { from: 9, to: 10, y: 64 },
  { from: 9, to: 10, y: 80 },
  { from: 1, to: 0, y: 92 },
];
