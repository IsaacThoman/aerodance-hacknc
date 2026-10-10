// Breezy Meadow world layout: a deterministic height field shared by the
// terrain mesh and everything that sits on it (grass, flowers, props).
import * as THREE from 'three';
import { mulberry32 } from '../../shared/random.js';

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** Seeded 2D simplex noise in [-1, 1]. */
export function makeNoise2(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const corner = (gi, x, y) => {
    let t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    t *= t;
    const g = GRAD[gi & 7];
    return t * t * (g[0] * x + g[1] * y);
  };
  return (xin, yin) => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    return 70 * (
      corner(perm[ii + perm[jj]], x0, y0) +
      corner(perm[ii + i1 + perm[jj + j1]], x1, y1) +
      corner(perm[ii + 1 + perm[jj + 1]], x2, y2)
    );
  };
}

const n2 = makeNoise2(11);
const n2b = makeNoise2(29);

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const gauss = (x, z, cx, cz, rx, rz) => {
  const dx = (x - cx) / rx;
  const dz = (z - cz) / rz;
  return Math.exp(-(dx * dx + dz * dz));
};

// Key landmarks (world metres; the camera sits near the origin looking -z).
export const HERO = { x: 40, z: -80 }; // the big Bliss hill with the tree
export const KNOLL = { x: -27, z: -40 }; // gazebo knoll
export const POND = { x: -20, z: -21, rx: 6.8, rz: 4.2, rot: 0.25 };
export const CAM_XZ = [0, 14];

// Pond basin mask: 1 inside the (slightly wobbly) ellipse, soft shore.
export function pondMask(x, z, soft = 2.2) {
  const c = Math.cos(POND.rot);
  const s = Math.sin(POND.rot);
  const dx = x - POND.x;
  const dz = z - POND.z;
  const u = (dx * c - dz * s) / POND.rx;
  const v = (dx * s + dz * c) / POND.rz;
  const ang = Math.atan2(v, u);
  const wobble = 1 + 0.12 * Math.sin(ang * 3 + 1.1) + 0.07 * Math.sin(ang * 5 - 0.4);
  const r = Math.sqrt(u * u + v * v) / wobble;
  return 1 - smooth(1 - soft / POND.rx, 1 + soft / POND.rx, r);
}

function baseHeight(x, z) {
  let h = 0;
  h += 1.7 * n2(x * 0.011, z * 0.011);
  h += 0.6 * n2(x * 0.028 + 3.1, z * 0.028 - 7.3);
  h += 0.18 * n2b(x * 0.09, z * 0.09);
  // The hero hill: a broad, smooth Bliss dome.
  h += 17 * gauss(x, z, HERO.x, HERO.z, 56, 36);
  h += 4 * gauss(x, z, HERO.x + 40, HERO.z - 30, 40, 30);
  // Gazebo knoll and a softer shoulder beside it.
  h += 6.5 * gauss(x, z, KNOLL.x, KNOLL.z, 19, 15);
  h += 2.5 * gauss(x, z, KNOLL.x - 22, KNOLL.z - 12, 20, 16);
  // Long ridge in the distance carrying the wind turbines.
  const ridge = smooth(-115, -215, z) * (23 + 7 * n2b(x * 0.007, 3.3) + 3 * n2(x * 0.02, 9.1));
  h += ridge;
  // Rise toward the sides to cradle the valley.
  h += 6 * smooth(70, 180, Math.abs(x)) * smooth(10, -60, z);
  // Keep the camera's own patch gently flat.
  const near = gauss(x, z, CAM_XZ[0], CAM_XZ[1], 9, 9);
  h = h * (1 - near * 0.6);
  // The camera stands on a gentle rise above the pond hollow.
  h += 1.6 * gauss(x, z, CAM_XZ[0] + 2, CAM_XZ[1] + 2, 16, 13);
  h -= 0.9 * gauss(x, z, POND.x, POND.z, 16, 11);
  return h;
}

export const POND_LEVEL = baseHeight(POND.x, POND.z) - 0.35;

export function heightAt(x, z) {
  let h = baseHeight(x, z);
  const m = pondMask(x, z);
  if (m > 0) h = THREE.MathUtils.lerp(h, POND_LEVEL - 0.9, m * m * (3 - 2 * m));
  // Carve a faint dip along the path so it reads as worn in.
  const pd = distToPath(x, z);
  if (pd < 3) h -= 0.08 * (1 - pd / 3);
  return h;
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.6;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}

// The winding footpath: from the right foreground, up the hero hill to the tree.
const PATH_CONTROL = [
  [5, 13], [7, 3], [5.5, -7], [8.5, -18], [15, -26], [19.5, -36],
  [21.5, -46], [27, -55], [33, -62], [36.5, -70], [39.5, -75.5],
];
export const PATH_POINTS = new THREE.CatmullRomCurve3(
  PATH_CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  'centripetal',
).getSpacedPoints(160);

const PATH_BOX = PATH_POINTS.reduce(
  (b, p) => [Math.min(b[0], p.x), Math.max(b[1], p.x), Math.min(b[2], p.z), Math.max(b[3], p.z)],
  [Infinity, -Infinity, Infinity, -Infinity],
);

export function distToPath(x, z) {
  if (x < PATH_BOX[0] - 6 || x > PATH_BOX[1] + 6 || z < PATH_BOX[2] - 6 || z > PATH_BOX[3] + 6) return 99;
  let best = Infinity;
  for (let i = 0; i < PATH_POINTS.length - 1; i++) {
    const a = PATH_POINTS[i];
    const b = PATH_POINTS[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const t = Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)));
    const dx = x - (a.x + abx * t);
    const dz = z - (a.z + abz * t);
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export const TREE = { x: HERO.x + 1, z: HERO.z + 2 };
TREE.y = baseHeight(TREE.x, TREE.z);
export const GAZEBO = { x: KNOLL.x + 1, z: KNOLL.z + 1 };
GAZEBO.y = baseHeight(GAZEBO.x, GAZEBO.z);
export const CAMERA_POS = [0, heightAt(0, 14) + 1.7, 14];
