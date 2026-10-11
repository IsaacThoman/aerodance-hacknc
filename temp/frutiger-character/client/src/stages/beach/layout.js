import { SHORE } from './palette.js';
import { sandHeight } from './terrain.js';

// x of the shoreline at depth z on the left (-1) or right (+1) arm of the cove.
export function shoreX(z, side) {
  const k = side < 0 ? SHORE.left : SHORE.right;
  return side * Math.sqrt(Math.max(SHORE.z0 - z, 0) / k);
}

// [x, y, z] of a point `inland` units from the shoreline at depth z, on the ground.
export function onArm(side, z, inland) {
  const x = shoreX(z, side) + side * inland;
  return [x, sandHeight(x, z), z];
}

export const ground = (x, z) => [x, sandHeight(x, z), z];

// Beach furniture along the cove arms: side, z, inland, then details.
export const UMBRELLAS = [
  { side: -1, z: -3.2, inland: 4.4, stripes: ['#ff6b7a', '#ffffff'], tilt: [0.08, 0, 0.12] },
  { side: -1, z: -17, inland: 2.6, stripes: ['#2fc6e8', '#ffffff'], tilt: [-0.06, 0, 0.1] },
  { side: 1, z: -6.2, inland: 2.6, stripes: ['#ffc93a', '#ffffff'], tilt: [0.05, 0, -0.12] },
  { side: 1, z: -15.5, inland: 2.8, stripes: ['#ff6b7a', '#ffffff'], tilt: [-0.05, 0, -0.08] },
  { side: 1, z: -25, inland: 2.6, stripes: ['#7fe08a', '#ffffff'], tilt: [0.04, 0, -0.1] },
];

export const LOUNGERS = [
  { side: -1, z: -1.8, inland: 5.2, heading: 2.5, towel: '#3fd3e0' },
  { side: -1, z: -15.6, inland: 2.2, heading: 2.2, towel: '#ff8fb0' },
  { side: 1, z: -4.6, inland: 2.8, heading: -2.4, towel: '#ff8fb0' },
  { side: 1, z: -4.2, inland: 1.2, heading: -2.6, towel: '#ffd23a' },
  { side: 1, z: -14, inland: 2.2, heading: -2.4, towel: '#3fd3e0' },
];

export const LIFEGUARD = { side: -1, z: -10.5, inland: 2.2, heading: 2.3 };
export const SURF_RACK = { at: [7.4, 0.8], heading: -0.4 };

// Tiki torches flanking the dancers.
export const TORCHES = [
  [-5.8, 3.3],
  [5.9, 3.1],
];

// Palms: side, z, inland, height, lean, heading, fronds. The first two frame the shot.
export const PALMS = [
  { x: -10.2, z: 8.5, height: 9.5, lean: 3.4, heading: -0.35, fronds: 12 },
  { x: 10.6, z: 7.0, height: 10.5, lean: 3.8, heading: Math.PI + 0.45, fronds: 12 },
  { side: -1, z: -9, inland: 0.6, height: 7.6, lean: 2.8, heading: -0.7, fronds: 10 },
  { side: -1, z: -21, inland: 1.4, height: 8.2, lean: 2.4, heading: -0.3, fronds: 10 },
  { side: -1, z: -27, inland: 2.6, height: 9.4, lean: 2.8, heading: 0.1, fronds: 10 },
  { side: -1, z: -33, inland: 1.2, height: 7.8, lean: 2.0, heading: -0.2, fronds: 9 },
  { side: -1, z: -14, inland: 6.5, height: 10.5, lean: 2.0, heading: 0.4, fronds: 10 },
  { side: 1, z: -13, inland: 4, height: 9.6, lean: 2.6, heading: Math.PI - 0.1, fronds: 10 },
  { side: 1, z: -20.5, inland: 1.4, height: 8.0, lean: 2.2, heading: Math.PI + 0.3, fronds: 10 },
  { side: 1, z: -31, inland: 1.8, height: 9.0, lean: 2.6, heading: Math.PI, fronds: 9 },
  { side: 1, z: -38, inland: 1.2, height: 7.6, lean: 2.0, heading: Math.PI + 0.2, fronds: 9 },
  { side: 1, z: -17, inland: 6.5, height: 10.0, lean: 2.0, heading: Math.PI - 0.4, fronds: 10 },
];
