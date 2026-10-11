// Emerald Falls layout: the clifftop promontory the stage stands on, the
// valley below (lake, river, rolling hills) and the waterfall mesas. Height
// functions are deterministic and shared by meshes and everything placed on them.
import * as THREE from 'three';
import { mulberry32 } from '../shared/random.js';

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

export const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const gauss = (x, z, cx, cz, rx, rz) => {
  const dx = (x - cx) / rx;
  const dz = (z - cz) / rz;
  return Math.exp(-(dx * dx + dz * dz));
};

const nA = makeNoise2(17);
const nB = makeNoise2(43);
const nC = makeNoise2(71);

export const CAMERA = { position: [0, 4.3, 10.4], target: [0, 2.05, 0], fov: 47 };
export const PLATFORM_R = 5.2;
export const OBSERVATORY = [110, 13.6, -260];
export const LAKE_Y = -38;

// ------------------------------------------------------------- promontory

const PROM_C = [0, -1];
const PROM_R = 8.4;

/** Signed distance-ish to the clifftop edge: > 0 on the meadow. */
export function meadowEdge(x, z) {
  const dx = x - PROM_C[0];
  const dz = z - PROM_C[1];
  const r = Math.hypot(dx, dz);
  const th = Math.atan2(dx, -dz);
  const a = Math.abs(th);
  const R = PROM_R + 22 * smooth(1.25, 2.7, a) + 0.7 * nA(th * 2.2, 3.1) + 0.3 * nB(th * 7, 1.7);
  return R - r;
}

/** Ground height of the clifftop (plateau + cliff walls). */
export function meadowHeight(x, z) {
  const d = meadowEdge(x, z);
  if (d >= 0) {
    let h = 0.1 * nA(x * 0.25, z * 0.25) + 0.05 * nB(x * 0.9, z * 0.9);
    h += 0.025 * Math.max(z, 0);
    // Rounded lip at the edge.
    h -= 0.35 * (1 - smooth(0, 1.4, d));
    // The platform sits proud of a shallow dip.
    const rp = Math.hypot(x, z);
    h = THREE.MathUtils.lerp(h, -0.46, 1 - smooth(PLATFORM_R + 0.5, PLATFORM_R + 1.8, rp));
    return h;
  }
  const out = -d;
  // Near-vertical limestone walls with a couple of ledges.
  const fall = Math.pow(smooth(0, 9, out), 0.55);
  let h = -0.35 - 74 * fall;
  h += 2.2 * smooth(2.5, 3.5, out) * (1 - smooth(4, 5, out));
  h += 2.5 * nC(x * 0.18, z * 0.18) * smooth(0.5, 3, out);
  return h;
}

export const heightAt = meadowHeight;

// --------------------------------------------------------------- valley

export const LAKE = { x: 0, z: -258, rx: 132, rz: 92 };

// River leaving the lake to the right and winding toward the foreground.
const RIVER_CONTROL = [
  [78, -204], [88, -176], [70, -150], [84, -122], [76, -96], [98, -72], [128, -52], [170, -30], [220, -4],
];
export const RIVER_CURVE = new THREE.CatmullRomCurve3(
  RIVER_CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  'centripetal',
);
export const RIVER_POINTS = RIVER_CURVE.getSpacedPoints(120);

export function distToRiver(x, z) {
  if (x < 40 || z < -230) return 99;
  let best = Infinity;
  for (let i = 0; i < RIVER_POINTS.length - 1; i++) {
    const a = RIVER_POINTS[i];
    const b = RIVER_POINTS[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const t = Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)));
    const ddx = x - (a.x + abx * t);
    const ddz = z - (a.z + abz * t);
    best = Math.min(best, ddx * ddx + ddz * ddz);
  }
  return Math.sqrt(best);
}

/** 1 inside the lake, soft wobbly shore. */
export function lakeMask(x, z, soft = 10) {
  const dx = (x - LAKE.x) / LAKE.rx;
  const dz = (z - LAKE.z) / LAKE.rz;
  const ang = Math.atan2(dz, dx);
  const wob = 1 + 0.08 * Math.sin(ang * 3 + 0.7) + 0.05 * Math.sin(ang * 7 - 1.3);
  const r = Math.hypot(dx, dz) / wob;
  return 1 - smooth(1 - soft / LAKE.rx, 1 + soft / LAKE.rx, r);
}

// Open Bliss-style lawn hills (kept free of trees).
const LAWNS = [
  [-84, -128, 42, 30, 15],
  [92, -150, 34, 26, 11],
  [-36, -178, 26, 18, 6],
];
export function lawnMask(x, z) {
  let m = 0;
  for (const [cx, cz, rx, rz] of LAWNS) m = Math.max(m, gauss(x, z, cx, cz, rx * 0.8, rz * 0.8));
  return m;
}

/** Valley floor: rolling Bliss hills around a turquoise lake, far ridges. */
export function valleyHeight(x, z) {
  let h = -36;
  h += 5 * nA(x * 0.012, z * 0.012) + 2 * nB(x * 0.035, z * 0.035);
  // Rolling hills on both sides of the lake.
  h += 20 * gauss(x, z, -178, -112, 58, 46);
  h += 18 * gauss(x, z, 196, -150, 60, 46);
  for (const [cx, cz, rx, rz, hh] of LAWNS) h += hh * gauss(x, z, cx, cz, rx, rz);
  h += 16 * gauss(x, z, -250, -260, 70, 60);
  h += 16 * gauss(x, z, 250, -300, 70, 60);
  // Far ridges with the wind turbines, rising behind the mesas.
  const ridge = smooth(-430, -620, z) * (38 + 16 * nA(x * 0.004, 5.5) + 6 * nB(x * 0.012, 2.2));
  h += ridge * (1 - smooth(-760, -900, z) * 0.6);
  // Valley walls toward the sides.
  h += 24 * smooth(260, 420, Math.abs(x));
  // Keep the ground under the promontory low.
  h -= 10 * gauss(x, z, 0, -10, 40, 40);
  // Lake basin and river channel.
  const m = lakeMask(x, z);
  if (m > 0) h = THREE.MathUtils.lerp(h, LAKE_Y - 7, m);
  const rd = distToRiver(x, z);
  if (rd < 14) h = THREE.MathUtils.lerp(h, LAKE_Y - 2.5, 1 - smooth(3, 14, rd));
  return h;
}

// ----------------------------------------------------------------- mesas

// Green-topped tepuis; each fall is { angle (deg, 0 = +x, 90 = +z), width }.
export const MESAS = [
  { x: -56, z: -56, r: 15, top: 1, seed: 29, falls: [{ angle: 25, width: 6 }] },
  { x: -106, z: -216, r: 34, top: 6, seed: 3, falls: [{ angle: 56, width: 10 }, { angle: 24, width: 5 }] },
  { x: 136, z: -250, r: 40, top: 13, seed: 7, falls: [{ angle: 150, width: 12 }] },
  { x: -6, z: -424, r: 50, top: 20, seed: 11, falls: [{ angle: 90, width: 14 }] },
  { x: 112, z: -500, r: 40, top: 30, seed: 13, falls: [{ angle: 112, width: 7 }] },
  { x: -230, z: -330, r: 46, top: 26, seed: 19, falls: [{ angle: 30, width: 7 }] },
  { x: 250, z: -380, r: 50, top: 22, seed: 23, falls: [] },
];

/** Radius of a mesa wall at an angle and relative height (0 base .. 1 rim). */
export function mesaRadius(m, angle, s) {
  const n = makeMesaNoise(m.seed);
  let r = m.r * (1 + 0.16 * n(Math.cos(angle) * 1.3, Math.sin(angle) * 1.3) + 0.06 * n(Math.cos(angle) * 4 + 9, Math.sin(angle) * 4));
  // Talus flare at the base, slight lean in toward the rim, rounded top.
  r *= 1 + 0.32 * Math.pow(1 - smooth(0, 0.3, s), 1.6);
  r *= 1 - 0.04 * s;
  r *= 1 - 0.05 * smooth(0.9, 1, s);
  // A ledge partway up.
  r *= 1 + 0.035 * smooth(0.5, 0.53, s) * (1 - smooth(0.53, 0.6, s));
  // Gorge notches where the falls pour out.
  for (const f of m.falls) {
    const da = Math.atan2(Math.sin(angle - THREE.MathUtils.degToRad(f.angle)), Math.cos(angle - THREE.MathUtils.degToRad(f.angle)));
    const w = (f.width / m.r) * 0.9;
    r -= f.width * 0.55 * Math.exp(-(da * da) / (w * w)) * smooth(0.12, 0.35, s);
  }
  return r;
}

const mesaNoiseCache = new Map();
function makeMesaNoise(seed) {
  if (!mesaNoiseCache.has(seed)) mesaNoiseCache.set(seed, makeNoise2(seed * 31 + 5));
  return mesaNoiseCache.get(seed);
}

export function mesaBase(m) {
  return Math.min(valleyHeight(m.x, m.z), LAKE_Y) - 14;
}

/** Waterfall sites derived from the mesas: lip position, outward normal, drop. */
export function fallSites() {
  const sites = [];
  for (const m of MESAS) {
    for (const f of m.falls) {
      const a = THREE.MathUtils.degToRad(f.angle);
      const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
      const rTop = mesaRadius(m, a, 0.97);
      const lip = new THREE.Vector3(m.x + dir.x * (rTop + 0.4), m.top - 0.6, m.z + dir.y * (rTop + 0.4));
      const footR = mesaRadius(m, a, 0.2) + 1;
      const fx = m.x + dir.x * footR;
      const fz = m.z + dir.y * footR;
      const bottom = Math.max(valleyHeight(fx, fz), LAKE_Y);
      sites.push({ lip, dir, width: f.width, bottom, foot: new THREE.Vector3(fx, bottom, fz), out: footR - rTop });
    }
  }
  return sites;
}
