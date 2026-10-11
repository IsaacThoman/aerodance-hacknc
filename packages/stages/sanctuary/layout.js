import * as THREE from 'three';

// Shared numbers for the terrace and the city below it. The dance floor sits at
// y = 0 on top of a tall eco-tower; the city's streets are GROUND units below.

export const GROUND = -95;

const dir = (elevationDeg, azimuthDeg) => {
  const e = THREE.MathUtils.degToRad(elevationDeg);
  const a = THREE.MathUtils.degToRad(azimuthDeg);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
};

// The visible sun sits at the upper-right corner of the shot (for the flare);
// the key light comes from higher up on the same side.
export const SUN_DIR = dir(10.5, 19);
export const LIGHT_DIR = dir(52, 58);

export const COLORS = {
  skyTop: '#0a4ed2',
  skyHorizon: '#a6dcff',
  fog: '#b3e0fb',
};

export const FOG = [220, 5200];

// Camera sits just in front of the terrace looking out over the skyline.
export const CAMERA = { position: [0, 4.1, 13.4], target: [0, 2.05, 0], fov: 42 };

/** Ground position for an azimuth (degrees, + = right) and distance from the camera. */
export function polar(azDeg, d, out = [0, 0]) {
  const a = THREE.MathUtils.degToRad(azDeg);
  out[0] = Math.sin(a) * d;
  out[1] = CAMERA.position[2] - Math.cos(a) * d;
  return out;
}

// River + lagoon centerline [x, z, halfWidth], winding from the bay to the horizon.
export const RIVER = [
  [150, -470, 120],
  [40, -640, 85],
  [-70, -860, 70],
  [-30, -1120, 62],
  [110, -1420, 70],
  [60, -1820, 90],
  [-140, -2350, 120],
  [-60, -3000, 150],
];

/** Signed distance (xz) to the river: negative inside the water. */
export function riverSDF(x, z) {
  let best = Infinity;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az, aw] = RIVER[i];
    const [bx, bz, bw] = RIVER[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - (aw + (bw - aw) * t);
    best = Math.min(best, d);
  }
  return best;
}

// Elevated monorail: two loops weaving between the towers on either flank,
// so no track crosses the calm middle behind the dancers.
export const MONO_Y = GROUND + 70;
export const MONORAILS = [
  [
    [-18, 340],
    [-26, 360],
    [-36, 380],
    [-52, 560],
    [-40, 800],
    [-22, 760],
    [-18, 560],
  ],
  [
    [17, 330],
    [27, 380],
    [38, 360],
    [54, 560],
    [42, 820],
    [24, 780],
    [17, 560],
  ],
].map((loop) => loop.map(([az, d]) => polar(az, d)));
