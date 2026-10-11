// The game renders 640x480 and shows it at 16:9 (4:3-wide pixels). Cropped to 3:2 that
// grid is 540x480; each buffer pixel becomes a 4x3 block in the 2160x1440 PNG.
export const BUFFER = { width: 540, height: 480, aspect: 3 / 2 };
export const UPSCALE = [4, 3];
// Wordmark layout units: 3:2 at the title menu's scale (its 1600x900 maps to 640x480).
export const DESIGN = { width: 1350, height: 900 };

/*
 * One entry per thumbnail. Each renders with and without the wordmark.
 *   stage: stage id (packages/stages)
 *   time: seconds the stage plays before the capture (lights, water, creatures, beat)
 *   pose: seconds into the dance capture the dancers hold (0-14)
 *   camera: { position, target, fov, near?, far? }
 *   dancers: overrides for the stage's dancer placement ({ position, rotationY, spacing })
 *   logo: { y: baseline, size, x?: 'left' | 'right' | number (default centered) } in DESIGN units
 */
export const SHOTS = [
  // Skyline Sanctuary: rooftop terrace over the glass eco-city.
  {
    id: 'sanctuary-skyline',
    stage: 'sanctuary',
    time: 10,
    pose: 5,
    camera: { position: [0, 7, 19], target: [0, 1.6, -4], fov: 45 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'sanctuary-hero',
    stage: 'sanctuary',
    time: 10,
    pose: 3.1,
    camera: { position: [0, 1.25, 10.5], target: [0, 2.55, 0], fov: 40 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'sanctuary-canopy',
    stage: 'sanctuary',
    time: 14,
    pose: 9,
    camera: { position: [7.2, 2.3, 8.6], target: [-0.3, 1.9, 0], fov: 40 },
    dancers: { rotationY: 0.35 },
    logo: { y: 215, size: 170, x: 'left' },
  },
  {
    id: 'sanctuary-towers',
    stage: 'sanctuary',
    time: 10,
    pose: 3.1,
    camera: { position: [0, 0.3, 6.8], target: [0, 2.9, 0], fov: 54 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'sanctuary-closeup',
    stage: 'sanctuary',
    time: 12,
    pose: 5,
    camera: { position: [-3, 1.65, 5.4], target: [-3.5, 1.9, 0], fov: 38 },
    logo: { y: 215, size: 140, x: 'left' },
  },

  // Coral Dome: glass dome on a sunlit reef.
  {
    id: 'reef-dome',
    stage: 'reef',
    time: 12,
    pose: 5,
    camera: { position: [0, 7, 19], target: [0, 1.8, -4], fov: 45 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'reef-hero',
    stage: 'reef',
    time: 12,
    pose: 3.1,
    camera: { position: [0, 1.2, 9], target: [0, 2.45, 0], fov: 42 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'reef-inside',
    stage: 'reef',
    time: 16,
    pose: 9,
    camera: { position: [-3.6, 0.9, 4.4], target: [0.3, 2.5, -0.4], fov: 60 },
    dancers: { rotationY: -0.45 },
    logo: { y: 215, size: 160, x: 'left' },
  },
  {
    id: 'reef-crown',
    stage: 'reef',
    time: 12,
    pose: 3.1,
    camera: { position: [0, 0.35, 6.5], target: [0, 2.9, 0], fov: 54 },
    logo: { y: 215, size: 190 },
  },

  // Open Reef: the dancers on the open sand.
  {
    id: 'openreef-surface',
    stage: 'openreef',
    time: 12,
    pose: 3.1,
    camera: { position: [0, -0.1, 6.8], target: [0, 2.5, 0], fov: 54 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'openreef-hero',
    stage: 'openreef',
    time: 10,
    pose: 5,
    camera: { position: [0, 0.85, 9.5], target: [0, 1.95, 0], fov: 42 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'openreef-garden',
    stage: 'openreef',
    time: 10,
    pose: 12.9,
    camera: { position: [0, 6.5, 19], target: [0, 1.2, -4], fov: 45 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'openreef-turtle',
    stage: 'openreef',
    time: 10,
    pose: 9,
    camera: { position: [6.2, 1.5, 7.5], target: [-0.3, 1.6, 0], fov: 40 },
    dancers: { rotationY: 0.35 },
    logo: { y: 215, size: 160, x: 'left' },
  },

  // Emerald Falls: clifftop meadow over waterfalls.
  {
    id: 'falls-valley',
    stage: 'falls',
    time: 10,
    pose: 5,
    camera: { position: [0, 7, 19], target: [0, 1.8, -4], fov: 45 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'falls-rainbow',
    stage: 'falls',
    time: 10,
    pose: 9,
    camera: { position: [6.5, 2.2, 7.5], target: [-0.3, 1.9, 0], fov: 40 },
    dancers: { rotationY: 0.35 },
    logo: { y: 215, size: 160, x: 'left' },
  },
  {
    id: 'falls-meadow',
    stage: 'falls',
    time: 10,
    pose: 3.1,
    camera: { position: [0, 1.05, 8.5], target: [0, 2.35, 0], fov: 42 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'falls-closeup',
    stage: 'falls',
    time: 10,
    pose: 9,
    camera: { position: [3, 1.65, 5.4], target: [3.5, 1.9, 0], fov: 38 },
    logo: { y: 215, size: 140, x: 'right' },
  },
  {
    id: 'falls-cliffs',
    stage: 'falls',
    time: 14,
    pose: 3.1,
    camera: { position: [-6.5, 1.6, 7.5], target: [0.3, 1.9, 0], fov: 40 },
    dancers: { rotationY: -0.35 },
    logo: { y: 215, size: 160, x: 'right' },
  },

  // Club Aquarium: glass dance club.
  {
    id: 'club-floor',
    stage: 'club',
    time: 12.23,
    pose: 5,
    camera: { position: [0, 7, 19], target: [0, 2.2, -3], fov: 45 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'club-aquarium',
    stage: 'club',
    time: 13.25,
    pose: 9,
    camera: { position: [6.5, 2.2, 7.5], target: [-0.3, 1.7, 0], fov: 40 },
    dancers: { rotationY: 0.35 },
    logo: { y: 215, size: 160, x: 'left' },
  },
  {
    id: 'club-stage',
    stage: 'club',
    time: 16.3,
    pose: 5,
    camera: { position: [4.5, -0.1, 8.5], target: [0, 2.2, -0.5], fov: 44 },
    dancers: { rotationY: 0.25 },
    logo: { y: 215, size: 170, x: 'left' },
  },
  {
    id: 'club-dj',
    stage: 'club',
    time: 16.3,
    pose: 9,
    camera: { position: [0, 1.6, 9.5], target: [0, 2.6, 0], fov: 42 },
    logo: { y: 215, size: 190 },
  },

  // Sugarsand Sunset: golden-hour beach.
  {
    id: 'beach-sunset',
    stage: 'beach',
    time: 10,
    pose: 5,
    camera: { position: [0, 6.2, 19.5], target: [0, 1.4, -3], fov: 45 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'beach-hero',
    stage: 'beach',
    time: 10,
    pose: 3.1,
    camera: { position: [0, 0.55, 9.5], target: [0, 1.9, 1], fov: 40 },
    logo: { y: 215, size: 190 },
  },
  {
    id: 'beach-ball',
    stage: 'beach',
    time: 12,
    pose: 3.1,
    camera: { position: [-6.5, 1.27, 8.5], target: [0.3, 1.1, 1], fov: 40 },
    dancers: { rotationY: -0.35 },
    logo: { y: 215, size: 160, x: 'right' },
  },
  {
    id: 'beach-palm',
    stage: 'beach',
    time: 12,
    pose: 9,
    camera: { position: [6.5, 1.67, 8.5], target: [-0.3, 1.25, 1], fov: 40 },
    dancers: { rotationY: 0.35 },
    logo: { y: 215, size: 160, x: 'left' },
  },
  {
    id: 'beach-closeup',
    stage: 'beach',
    time: 12,
    pose: 5,
    camera: { position: [3, 1.12, 6.4], target: [3.5, 1.37, 1], fov: 38 },
    logo: { y: 215, size: 140, x: 'right' },
  },
];
