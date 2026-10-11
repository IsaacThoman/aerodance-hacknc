import * as THREE from 'three';
import { CAMERA, MESAS, makeNoise2, meadowHeight, mesaBase, mesaRadius, smooth, valleyHeight } from './terrain.js';

function gridIndex(nx, nz) {
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  return idx;
}

function finish(pos, idx, extra = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  for (const [k, v] of Object.entries(extra)) g.setAttribute(k, new THREE.BufferAttribute(v, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Clifftop meadow + its cliff walls. Denser toward the stage. */
export function buildMeadowGeometry() {
  const NX = 170;
  const NZ = 110;
  const pos = new Float32Array((NX + 1) * (NZ + 1) * 3);
  let k = 0;
  for (let j = 0; j <= NZ; j++) {
    const v = j / NZ;
    const z = 24 - 58 * v;
    for (let i = 0; i <= NX; i++) {
      const w = (i / NX) * 2 - 1;
      const x = 46 * Math.sign(w) * (0.45 * Math.abs(w) + 0.55 * w * w);
      pos[k++] = x;
      pos[k++] = meadowHeight(x, z);
      pos[k++] = z;
    }
  }
  return finish(pos, gridIndex(NX, NZ));
}

/** Valley floor on a polar grid around the camera: fine near, coarse far. */
export function buildValleyGeometry() {
  const NA = 200;
  const NR = 150;
  const span = THREE.MathUtils.degToRad(78);
  const r0 = 40;
  const r1 = 1500;
  const [cx, , cz] = CAMERA.position;
  const pos = new Float32Array((NA + 1) * (NR + 1) * 3);
  let k = 0;
  for (let j = 0; j <= NR; j++) {
    const r = r0 * Math.pow(r1 / r0, j / NR);
    for (let i = 0; i <= NA; i++) {
      const a = -span + (2 * span * i) / NA;
      const x = cx + Math.sin(a) * r;
      const z = cz - Math.cos(a) * r;
      pos[k++] = x;
      pos[k++] = valleyHeight(x, z);
      pos[k++] = z;
    }
  }
  return finish(pos, gridIndex(NA, NR));
}

/** All waterfall mesas merged: noisy walls, ledges, gorge notches, domed tops. */
export function buildMesaGeometry() {
  const NA = 96;
  const NY = 26;
  const NC = 6;
  const positions = [];
  const rels = [];
  const indices = [];
  let base = 0;
  for (const m of MESAS) {
    const bottom = mesaBase(m);
    const top = m.top;
    const cap = makeNoise2(m.seed * 7 + 1);
    const rows = [];
    // Walls: s from base (0) to rim (1).
    for (let j = 0; j <= NY; j++) {
      const s = j / NY;
      rows.push({ s, y: bottom + (top - bottom) * Math.pow(s, 0.9), cap: 0 });
    }
    // Rim roll + domed cap toward the centre.
    for (let c = 1; c <= NC; c++) {
      rows.push({ s: 1, y: top, cap: c / NC });
    }
    rows.forEach((row) => {
      for (let i = 0; i <= NA; i++) {
        const a = (i / NA) * Math.PI * 2;
        let r = mesaRadius(m, a, row.s);
        let y = row.y;
        if (row.cap > 0) {
          const t = row.cap;
          r *= 1 - t * 0.98;
          y = top + 1.2 * Math.sin(t * Math.PI * 0.5) + 2.5 * t * t + 1.2 * cap(Math.cos(a) * 2 * t, Math.sin(a) * 2 * t) * t;
        } else {
          // Rough rock surface between strata.
          r += 0.9 * cap(a * 3, row.y * 0.12) * smooth(0.1, 0.3, row.s);
        }
        positions.push(m.x + Math.cos(a) * r, y, m.z + Math.sin(a) * r);
        rels.push(row.cap > 0 ? 1 : row.s);
      }
    });
    for (let j = 0; j < rows.length - 1; j++) {
      for (let i = 0; i < NA; i++) {
        const a = base + j * (NA + 1) + i;
        const b = a + 1;
        const c = a + NA + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    base += rows.length * (NA + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aRel', new THREE.Float32BufferAttribute(rels, 1));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const ridged = (n, x, z, oct) => {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += a * (1 - Math.abs(n(x * f, z * f)));
    f *= 2.03;
    a *= 0.5;
  }
  return v;
};

/** Distant snow-capped range: a strip of ridged peaks. */
export function buildMountainGeometry({ x0 = -2600, x1 = 2600, z0 = -1150, z1 = -1750, segX = 300, segZ = 30, peak = 210, seed = 5 } = {}) {
  const nA = makeNoise2(seed);
  const nB = makeNoise2(seed + 9);
  const pos = new Float32Array((segX + 1) * (segZ + 1) * 3);
  let k = 0;
  for (let j = 0; j <= segZ; j++) {
    const tz = j / segZ;
    const z = z0 + (z1 - z0) * tz;
    for (let i = 0; i <= segX; i++) {
      const x = x0 + ((x1 - x0) * i) / segX;
      const crest = 0.45 + 0.2 * nA(x * 0.001, 1.1);
      const across = (tz - crest) / (tz < crest ? crest : 1 - crest);
      const profile = Math.max(0, 1 - across * across);
      const massif = 0.4 + 0.6 * smooth(-0.5, 0.6, nA(x * 0.0011, 4.4));
      const r = ridged(nA, x * 0.0032, z * 0.003, 5);
      const d = ridged(nB, x * 0.011, z * 0.011, 3);
      let h = -30 + peak * massif * (Math.pow(profile, 1.2) * (0.3 + 0.7 * r) + 0.1 * d * profile);
      h -= (1 - smooth(0, 0.1, tz)) * 40;
      pos[k++] = x;
      pos[k++] = h;
      pos[k++] = z;
    }
  }
  return finish(pos, gridIndex(segX, segZ));
}
