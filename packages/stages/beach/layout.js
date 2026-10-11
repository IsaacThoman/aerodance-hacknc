import { sandHeight } from './terrain.js';

export const ground = (x, z) => [x, sandHeight(x, z), z];

export const SURF_RACK = { at: [7.4, 0.8], heading: -0.4 };

// Tiki torches flanking the dancers.
export const TORCHES = [
  [-5.8, 3.3],
  [5.9, 3.1],
];

// The one coconut palm, leaning in over the left of the shot.
export const PALM = { x: -7.8, z: 1.4, height: 5.6, lean: 2.5, heading: -0.25, fronds: 12 };
