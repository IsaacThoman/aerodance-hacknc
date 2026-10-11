import { SHORE, WATER_Y } from './palette.js';
import { smoothstep } from '../shared/random.js';
import { makeNoise3 } from './geometry.js';

// Approximate signed distance to the cove shoreline (positive on land).
export function shoreDistance(x, z) {
  const k = x < 0 ? SHORE.left : SHORE.right;
  // A little wobble so the cove doesn't read as a perfect parabola.
  const zs = SHORE.z0 - k * x * x + 0.9 * Math.sin(x * 0.31) * Math.min(Math.abs(x) * 0.25, 1) + 0.5 * Math.sin(x * 0.83 + 1.3);
  const slope = 2 * k * x;
  return (z - zs) / Math.sqrt(1 + slope * slope);
}

// Beach / seabed height. Mirrored in GLSL below so the water knows its depth.
export function groundHeight(x, z) {
  const d = shoreDistance(x, z);
  let h = d > 0 ? WATER_Y + 1.5 * (1 - Math.exp(-d / 20)) + smoothstep(9, 30, d) * 2.2 : WATER_Y + 0.085 * d;
  const end = x < 0 ? SHORE.endLeft : SHORE.endRight;
  h -= smoothstep(end, end - 16, z) * 7;
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
  float k = p.x < 0.0 ? ${SHORE.left.toFixed(4)} : ${SHORE.right.toFixed(4)};
  float zs = ${SHORE.z0.toFixed(3)} - k * p.x * p.x + 0.9 * sin(p.x * 0.31) * min(abs(p.x) * 0.25, 1.0) + 0.5 * sin(p.x * 0.83 + 1.3);
  float slope = 2.0 * k * p.x;
  return (p.y - zs) / sqrt(1.0 + slope * slope);
}
float groundHeight(vec2 p) {
  float d = shoreDistance(p);
  float h = d > 0.0
    ? ${WATER_Y.toFixed(3)} + 1.5 * (1.0 - exp(-d / 20.0)) + smoothstep(9.0, 30.0, d) * 2.2
    : ${WATER_Y.toFixed(3)} + 0.085 * d;
  float end = p.x < 0.0 ? ${SHORE.endLeft.toFixed(1)} : ${SHORE.endRight.toFixed(1)};
  h -= (1.0 - smoothstep(end - 16.0, end, p.y)) * 7.0;
  return max(h, -4.0);
}
`;
