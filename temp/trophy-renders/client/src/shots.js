// Square renders at 1080x1080 (the NFT's 1:1), drawn in design units of 1000x1000.
export const BUFFER = { width: 1080, height: 1080, aspect: 1 };
export const DESIGN = { width: 1000, height: 1000 };

// The sample battles from the SVG gallery, so each 3D trophy matches its SVG's traits.
// Stats are in fakeDance.js's ranges.
export const BATTLES = [
  { id: '3wegvq', score: 824, pops: 55, sync: 0.76, flair: 91 },
  { id: 'cxh7mk', score: 1658, pops: 44, sync: 0.77, flair: 63 },
  { id: '7cpt83', score: 1264, pops: 31, sync: 0.69, flair: 22 },
  { id: 'ps4wgf', score: 1061, pops: 31, sync: 0.61, flair: 66 },
  { id: 'tadr5e', score: 824, pops: 33, sync: 0.72, flair: 87 },
  { id: 'wzn6wy', score: 1068, pops: 16, sync: 0.55, flair: 76 },
];
export const DATE = '2026-10-11T18:00:00Z';

/*
 * Each stage's framing, relative to its dance floor (meta.dancers.position):
 *   camera: offset of the camera; target: offset it looks at; fov
 *   time: seconds the stage plays before the capture (lights, water, creatures)
 */
// Close enough that the trophy fills the space between the wordmark and the name card.
// Aimed a little low so the pedestal's WINNER plate clears the name card.
const DEFAULT = { camera: [0, 1.45, 5.4], target: [0, 1.12, 0], fov: 36, time: 6 };
export const FRAMING = {
  sanctuary: { ...DEFAULT, camera: [1.5, 1.45, 5.2] },
  reef: { ...DEFAULT, camera: [1.3, 1.45, 5.2], time: 8 },
  openreef: { ...DEFAULT, camera: [0, 1.35, 5.4], target: [0, 1.16, 0] },
  falls: { ...DEFAULT, camera: [-0.7, 1.45, 5.35] },
  club: { ...DEFAULT, camera: [0.6, 1.6, 5.35], time: 6.4 },
  beach: { ...DEFAULT, camera: [0, 1.3, 5.4], target: [0, 1.16, 0] },
};
