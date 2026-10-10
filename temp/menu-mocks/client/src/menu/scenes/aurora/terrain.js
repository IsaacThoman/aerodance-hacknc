import * as THREE from 'three';
import { makeNoise2D, fbm, ridged } from './noise.js';
import { CAMERA, DOME_POS } from './state.js';

const n1 = makeNoise2D(11);
const n2 = makeNoise2D(23);

// Lake shorelines as x(z) tables (z descending, away from the camera).
const LEFT = [
  [80, 0], [40, -2], [30, -6], [20, -11], [10, -17], [0, -24], [-30, -46], [-80, -92], [-160, -150], [-260, -230], [-380, -300], [-520, -380], [-800, -460],
];
const RIGHT = [
  [80, 70], [40, 64], [10, 54], [-20, 44], [-40, 40], [-58, 38], [-80, 46], [-110, 74], [-170, 128], [-260, 210], [-380, 300], [-520, 380], [-800, 470],
];
export const FAR_SHORE_Z = -545;

function interp(table, z) {
  if (z >= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [z1, x1] = table[i];
    if (z >= z1) {
      const [z0, x0] = table[i - 1];
      const t = (z - z0) / (z1 - z0);
      const s = t * t * (3 - 2 * t);
      return x0 + (x1 - x0) * (t * 0.5 + s * 0.5);
    }
  }
  return table[table.length - 1][1];
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Signed distance-ish from the shore: > 0 on land, < 0 in the lake. */
export function landDistance(x, z) {
  const xl = interp(LEFT, z) + n1(z * 0.025, 1.3) * 6;
  const xr = interp(RIGHT, z) + n1(z * 0.025, 7.1) * 6;
  const zf = FAR_SHORE_Z + n1(x * 0.012, 3.3) * 22;
  return Math.max(xl - x, x - xr, zf - z);
}

const forestN = makeNoise2D(5);

/** 0..1 forest cover: dense along shores, in clumps, thinning uphill. */
export function forestDensity(x, z) {
  const d = landDistance(x, z);
  if (d < 2.5) return 0;
  if (Math.hypot(x - DOME_POS.x, z - DOME_POS.z) < 19) return 0;
  const dist = Math.hypot(x - CAMERA.position[0], z - CAMERA.position[2]);
  const isFar = dist > 300;
  const edge = Math.exp(-Math.max(d - 4, 0) / (isFar ? 160 : 50));
  const clump = smooth(-0.35, 0.45, forestN(x * 0.011, z * 0.011));
  // Shaded forest floor around the hero pines in the left foreground.
  const fg = x < -2 && z > -40 ? smooth(-2, -16, x) * 0.8 : 0;
  return Math.max((0.25 + 0.75 * edge) * (0.12 + 0.88 * clump), fg) * smooth(2.5, 6, d);
}

/** Height of the lake basin and its shores. Water level is y = 0. */
export function shoreHeight(x, z) {
  const d = landDistance(x, z);
  let h;
  if (d < 0) {
    h = -2.5 + 2.5 * Math.exp(d * 0.3);
  } else {
    // Bank: quick lift, then hills whose steepness depends on the side.
    const left = x < 0 && z > FAR_SHORE_Z + 40;
    const far = z < FAR_SHORE_Z + 40;
    const slope = far ? 0.32 : left ? 0.38 : 0.12;
    h = 2.4 * (1 - Math.exp(-d / 3)) + Math.max(d - 6, 0) * slope;
    h += fbm(n2, x * 0.02, z * 0.02, 4) * 7 * smooth(4, 30, d);
    if (far) {
      // Forested hills on the far shore.
      const hill = 0.6 + 0.4 * fbm(n1, x * 0.006, 5.5, 3);
      h += hill * 26 * smooth(0, 90, d) + ridged(n2, x * 0.004, z * 0.004, 4) * 20 * smooth(30, 120, d);
    }
  }
  // Flatten a clearing for the glass dome.
  const dx = x - DOME_POS.x;
  const dz = z - DOME_POS.z;
  const r = Math.sqrt(dx * dx + dz * dz);
  const flat = smooth(24, 13, r);
  h = h + (DOME_POS.y - 0.1 - h) * flat;
  return h;
}

/** Shore terrain mesh with a grid that is dense near the camera. */
export function buildShoreGeometry() {
  const NX = 200;
  const NZ = 150;
  const pos = new Float32Array((NX + 1) * (NZ + 1) * 3);
  const forest = new Float32Array((NX + 1) * (NZ + 1));
  let k = 0;
  for (let j = 0; j <= NZ; j++) {
    const v = j / NZ;
    const z = 62 - 780 * (0.18 * v + 0.82 * v * v);
    for (let i = 0; i <= NX; i++) {
      const w = (i / NX) * 2 - 1;
      const x = 820 * Math.sign(w) * (0.22 * Math.abs(w) + 0.78 * w * w) + 10;
      forest[k / 3] = forestDensity(x, z);
      pos[k++] = x;
      pos[k++] = shoreHeight(x, z);
      pos[k++] = z;
    }
  }
  const idx = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const b = a + 1;
      const c = a + NX + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aForest', new THREE.BufferAttribute(forest, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A mountain range: a strip of ridged terrain between z0 (front) and z1 (back).
 */
export function buildRangeGeometry({ x0, x1, z0, z1, segX, segZ, peak, base, seed, freq, crest = 0.5 }) {
  const nA = makeNoise2D(seed);
  const nB = makeNoise2D(seed + 5);
  const pos = new Float32Array((segX + 1) * (segZ + 1) * 3);
  const depth = z0 - z1;
  let k = 0;
  for (let j = 0; j <= segZ; j++) {
    const tz = j / segZ;
    const z = z0 - depth * tz;
    for (let i = 0; i <= segX; i++) {
      const x = x0 + ((x1 - x0) * i) / segX;
      const cz = crest + nA(x * 0.0012, 2.2) * 0.22;
      const across = (tz - cz) / (tz < cz ? cz : 1 - cz);
      const profile = Math.max(0, 1 - across * across);
      const massif = 0.45 + 0.55 * smooth(-0.6, 0.5, nA(x * 0.0009, 7.7));
      const ridge = ridged(nA, x * freq, z * freq * 0.9, 6);
      const detail = ridged(nB, x * freq * 3.1, z * freq * 3.1, 4);
      let h = base + peak * massif * (Math.pow(profile, 1.3) * (0.35 + 0.65 * ridge) + 0.12 * detail * profile);
      // Front and back edges sink below the water/horizon.
      h -= (1 - smooth(0, 0.12, tz)) * 30;
      pos[k++] = x;
      pos[k++] = h;
      pos[k++] = z;
    }
  }
  const idx = [];
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * (segX + 1) + i;
      const b = a + 1;
      const c = a + segX + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
