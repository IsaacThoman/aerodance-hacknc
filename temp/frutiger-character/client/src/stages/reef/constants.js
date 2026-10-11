// Scene-wide layout constants shared by the stage modules.

// Water surface height; the reef floor sits ~10 m below it.
export const SURFACE_Y = 9.5;

// Direction sunlight travels underwater: slanting down from the left. The
// shadow-casting light, caustics and god rays all follow it.
export const SUN_TRAVEL = [0.5, -1, 0.1];

export const CAMERA = { position: [0, 2.8, 15], target: [0, 1.45, 0], fov: 41 };
