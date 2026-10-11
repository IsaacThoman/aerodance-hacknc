import { SHORE, WATER_Y } from './palette.js';
import { smoothstep } from '../shared/random.js';
import { makeNoise3 } from './geometry.js';

// Signed distance (along z) to the shoreline, positive on land. The beach runs
// straight across the frame with a little wobble so it doesn't read as a ruler line.
export function shoreDistance(x, z) {
  const zs = SHORE.z0 + 0.9 * Math.sin(x * 0.31) * Math.min(Math.abs(x) * 0.25, 1) + 0.5 * Math.sin(x * 0.83 + 1.3);
  return z - zs;
}

// Beach / seabed height. Mirrored in GLSL below so the water knows its depth.
export function groundHeight(x, z) {
  const d = shoreDistance(x, z);
  const h = d > 0 ? WATER_Y + 1.5 * (1 - Math.exp(-d / 20)) + smoothstep(9, 30, d) * 2.2 : WATER_Y + 0.085 * d;
  return Math.max(h, -4);
}

// Ground plus the small dune bumps baked into the sand mesh (for placing props).
const bumpNoise = makeNoise3(17);
export function sandHeight(x, z) {
  const d = shoreDistance(x, z);
  return groundHeight(x, z) + 0.14 * bumpNoise(x * 0.12, z * 0.12) * smoothstep(1, 6, d);
}

export const terrainGLSL = /* glsl */ `
float shoreDistance(vec2 p) {
  float zs = ${SHORE.z0.toFixed(3)} + 0.9 * sin(p.x * 0.31) * min(abs(p.x) * 0.25, 1.0) + 0.5 * sin(p.x * 0.83 + 1.3);
  return p.y - zs;
}
float groundHeight(vec2 p) {
  float d = shoreDistance(p);
  float h = d > 0.0
    ? ${WATER_Y.toFixed(3)} + 1.5 * (1.0 - exp(-d / 20.0)) + smoothstep(9.0, 30.0, d) * 2.2
    : ${WATER_Y.toFixed(3)} + 0.085 * d;
  return max(h, -4.0);
}
`;
