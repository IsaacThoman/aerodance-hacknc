import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRandom } from '../shared/random.js';
import { Builder, circleProfile, hexToLinear, mat4, superR, sweep } from './geometry.js';

// Static terrace geometry, grouped by material. Floor plan (top view, camera at +z):
// round dance dais in the middle, a crescent infinity pool behind it, planters
// with topiary on both sides, a petal canopy back-left, a fountain and wind
// flowers on the right, glass balustrades along the side edges.

export const DAIS_R = 6.2;
export const DECK_Y = -0.3;
export const DECK = { a: 20, b: 13.8, n: 2.6 };
export const deckR = (phi) => superR(phi, DECK.a, DECK.b, DECK.n);
export const POOL = { inner: 6.85, phi0: THREE.MathUtils.degToRad(-148), phi1: THREE.MathUtils.degToRad(-32), y: -0.34 };
export const FOUNTAIN = { x: 8.9, z: -2.6, r: 2.0, y: 0.06 };

export const PLANTERS = [
  { x: -6.5, z: 5.6, r: 1.1, h: 0.75, plant: 'flowers' },
  { x: 6.7, z: 5.3, r: 1.05, h: 0.7, plant: 'flowers' },
  { x: -9.8, z: -0.8, r: 1.35, h: 0.95, plant: 'lollipop' },
  { x: -12.2, z: -7.4, r: 1.6, h: 1.0, plant: 'stack' },
  { x: 13.2, z: -8.6, r: 1.3, h: 0.9, plant: 'cone' },
  { x: 12.6, z: -4.6, r: 1.25, h: 0.85, plant: 'cloud' },
  { x: -14.6, z: -6.0, r: 1.2, h: 0.85, plant: 'cone' },
];

export const CANOPY = { x: -13.6, z: -11.2, h: 7.2 };
// Two stand on little islands in the pool, one on the deck.
export const WIND_FLOWERS = [
  { x: 10.6, z: -10.4, h: 5.4, r: 0.95, speed: 1.3 },
  { x: 7.2, z: -12.8, h: 3.8, r: 0.7, speed: -1.7 },
  { x: 14.0, z: -7.0, h: 4.4, r: 0.8, speed: 1.0 },
];

// Lawn beds flanking the dais: [phiStart, phiEnd] (degrees), inner and outer radius.
export const LAWNS = [
  { from: -28, to: 34, inner: 7.9, outer: 12.2 },
  { from: 146, to: 212, inner: 7.9, outer: 12.6 },
];

const WHITE = hexToLinear('#f4f8fa');
const SOFT = hexToLinear('#e3edf0');
const GLOW = hexToLinear('#5ff3ff');

/** Deck slab with holes for the pool; shape coordinates are (x, -z). */
export function makeDeckGeometry() {
  const outline = (r, n, from = -Math.PI, to = Math.PI) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const phi = from + ((to - from) * i) / n;
      const rr = typeof r === 'function' ? r(phi) : r;
      pts.push(new THREE.Vector2(Math.cos(phi) * rr, -Math.sin(phi) * rr));
    }
    return pts;
  };
  const shape = new THREE.Shape(outline(deckR, 160).slice(0, -1));
  const hole = [...outline((p) => deckR(p) - 0.04, 60, POOL.phi0, POOL.phi1), ...outline(POOL.inner, 40, POOL.phi1, POOL.phi0)];
  shape.holes.push(new THREE.Path(hole));
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, DECK_Y, 0);
  return g;
}

export function makePoolGeometry() {
  const pts = [];
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const phi = POOL.phi0 + ((POOL.phi1 - POOL.phi0) * i) / n;
    pts.push(new THREE.Vector2(Math.cos(phi) * (deckR(phi) - 0.04), -Math.sin(phi) * (deckR(phi) - 0.04)));
  }
  for (let i = 0; i <= 40; i++) {
    const phi = POOL.phi1 + ((POOL.phi0 - POOL.phi1) * i) / 40;
    pts.push(new THREE.Vector2(Math.cos(phi) * POOL.inner, -Math.sin(phi) * POOL.inner));
  }
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts), 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, POOL.y, 0);
  const fountain = new THREE.CircleGeometry(FOUNTAIN.r, 40).rotateX(-Math.PI / 2).translate(FOUNTAIN.x, FOUNTAIN.y, FOUNTAIN.z);
  const merged = new Builder();
  merged.add(g.toNonIndexed(), new THREE.Matrix4());
  merged.add(fountain, new THREE.Matrix4());
  g.dispose();
  fountain.dispose();
  const out = new THREE.BufferGeometry();
  const b = merged.build();
  out.setAttribute('position', b.attributes.position);
  out.setIndex(b.index);
  return out;
}

/** Glossy white parts: dais body, fascia, coping, planters, basin, masts, stems. */
export function makeWhiteGeometry() {
  const b = new Builder();
  const dais = new THREE.CylinderGeometry(DAIS_R, DAIS_R + 0.08, 0.3, 96, 1, true);
  b.add(dais, mat4([0, -0.15, 0]), { color: WHITE });
  // Coping ring around the dais (pool lip).
  const coping = new THREE.RingGeometry(DAIS_R, POOL.inner, 96, 1).rotateX(-Math.PI / 2);
  b.add(coping, mat4([0, DECK_Y + 0.06, 0]), { color: WHITE });
  const copingSide = new THREE.CylinderGeometry(POOL.inner, POOL.inner, 0.1, 96, 1, true);
  b.add(copingSide, mat4([0, DECK_Y + 0.01, 0]), { color: SOFT });
  // Pool end caps (radial white walls at the crescent tips).
  for (const phi of [POOL.phi0, POOL.phi1]) {
    const len = deckR(phi) - POOL.inner;
    const mid = POOL.inner + len / 2;
    const cap = new THREE.BoxGeometry(len, 0.14, 0.5);
    b.add(cap, mat4([Math.cos(phi) * mid, DECK_Y + 0.03, Math.sin(phi) * mid], [0, -phi, 0]), { color: WHITE });
    cap.dispose();
  }
  // Low rounded curbs around the lawn beds.
  const curb = [
    [0.12, 0, 1, 0],
    [0.1, 0.1, 0.7, 0.7],
    [0, 0.13, 0, 1],
    [-0.1, 0.1, -0.7, 0.7],
    [-0.12, 0, -1, 0],
  ];
  for (const L of LAWNS) {
    const pts = [];
    const n = 48;
    const at = (deg, r) => new THREE.Vector3(Math.cos(THREE.MathUtils.degToRad(deg)) * r, DECK_Y, Math.sin(THREE.MathUtils.degToRad(deg)) * r);
    for (let i = 0; i <= n; i++) pts.push(at(L.from + ((L.to - L.from) * i) / n, L.outer));
    for (let i = 1; i < 8; i++) pts.push(at(L.to, L.outer + ((L.inner - L.outer) * i) / 8));
    for (let i = 0; i <= n; i++) pts.push(at(L.to - ((L.to - L.from) * i) / n, L.inner));
    for (let i = 1; i < 8; i++) pts.push(at(L.from, L.inner + ((L.outer - L.inner) * i) / 8));
    sweep(b, pts, curb, { closed: true, color: WHITE });
  }
  // Fascia: the deck's thick rounded edge.
  const fasciaPts = [];
  for (let i = 0; i < 160; i++) {
    const phi = (i / 160) * Math.PI * 2;
    fasciaPts.push(new THREE.Vector3(Math.cos(phi) * deckR(phi), 0, Math.sin(phi) * deckR(phi)));
  }
  const fasciaProfile = [
    [-1.2, -2.3, 0, -1],
    [0.0, -2.0, 0.5, -0.8],
    [0.24, -1.6, 1, 0],
    [0.24, -0.4, 1, 0],
    [0.18, -0.08, 0.7, 0.7],
    [0, 0, 0, 1],
  ];
  sweep(b, fasciaPts.map((p) => p.clone().setY(DECK_Y)).reverse(), fasciaProfile, { closed: true, color: WHITE });
  // Planter pots: glossy bowls with a rolled rim.
  for (const P of PLANTERS) {
    const pot = new THREE.LatheGeometry(
      [
        new THREE.Vector2(P.r * 0.72, 0),
        new THREE.Vector2(P.r * 0.92, P.h * 0.2),
        new THREE.Vector2(P.r, P.h * 0.65),
        new THREE.Vector2(P.r * 1.02, P.h),
        new THREE.Vector2(P.r * 0.94, P.h * 1.02),
      ],
      40,
    );
    b.add(pot, mat4([P.x, DECK_Y, P.z]), { color: WHITE });
    pot.dispose();
  }
  // Fountain basin.
  const basin = new THREE.LatheGeometry(
    [
      new THREE.Vector2(FOUNTAIN.r + 0.25, 0),
      new THREE.Vector2(FOUNTAIN.r + 0.35, 0.28),
      new THREE.Vector2(FOUNTAIN.r + 0.25, 0.42),
      new THREE.Vector2(FOUNTAIN.r, 0.4),
      new THREE.Vector2(FOUNTAIN.r - 0.02, 0.2),
    ],
    48,
  );
  b.add(basin, mat4([FOUNTAIN.x, DECK_Y, FOUNTAIN.z]), { color: WHITE });
  const pedestal = new THREE.LatheGeometry(
    [new THREE.Vector2(0.55, 0), new THREE.Vector2(0.3, 0.3), new THREE.Vector2(0.18, 0.7), new THREE.Vector2(0.6, 0.85), new THREE.Vector2(0.62, 0.95), new THREE.Vector2(0.1, 1.0)],
    24,
  );
  b.add(pedestal, mat4([FOUNTAIN.x, FOUNTAIN.y - 0.05, FOUNTAIN.z]), { color: WHITE });
  // Canopy mast and wind-flower stems.
  const mast = new THREE.CylinderGeometry(0.16, 0.32, CANOPY.h, 16);
  b.add(mast, mat4([CANOPY.x, DECK_Y + CANOPY.h / 2, CANOPY.z]), { color: WHITE });
  const foot = new THREE.CylinderGeometry(0.7, 0.9, 0.3, 24);
  b.add(foot, mat4([CANOPY.x, DECK_Y + 0.15, CANOPY.z]), { color: WHITE });
  for (const W of WIND_FLOWERS) {
    const stem = new THREE.CylinderGeometry(0.07, 0.16, W.h, 10);
    b.add(stem, mat4([W.x, DECK_Y + W.h / 2, W.z]), { color: WHITE });
    b.add(foot, mat4([W.x, DECK_Y + 0.15, W.z], [0, 0, 0], [0.6, 1, 0.6]), { color: WHITE });
  }
  [dais, coping, copingSide, basin, pedestal, mast, foot].forEach((g) => g.dispose());
  return b.build();
}

/** Chrome: balustrade posts and rails, dais rim, planter bands, spouts. */
export function makeChromeGeometry() {
  const b = new Builder();
  const rim = new THREE.TorusGeometry(DAIS_R + 0.02, 0.05, 6, 128).rotateX(Math.PI / 2);
  b.add(rim, mat4([0, 0, 0]));
  rim.dispose();
  const rail = [];
  const post = new THREE.CylinderGeometry(0.05, 0.05, 1.15, 8);
  // Rails along the deck edge except behind the pool (infinity edge).
  const runs = [
    [POOL.phi1 + 0.04, Math.PI * 0.5],
    [Math.PI * 0.5, Math.PI * 2 + POOL.phi0 - 0.04],
  ];
  for (const [from, to] of runs) {
    const pts = [];
    const n = Math.round((to - from) * 30);
    for (let i = 0; i <= n; i++) {
      const phi = from + ((to - from) * i) / n;
      const r = deckR(phi) - 0.25;
      pts.push(new THREE.Vector3(Math.cos(phi) * r, DECK_Y + 1.15, Math.sin(phi) * r));
      if (i % 4 === 0) b.add(post, mat4([Math.cos(phi) * r, DECK_Y + 0.575, Math.sin(phi) * r]));
    }
    sweep(b, pts, circleProfile(0.075, 10));
    rail.push(pts);
  }
  post.dispose();
  for (const P of PLANTERS) {
    const band = new THREE.TorusGeometry(P.r * 1.0, 0.035, 5, 40).rotateX(Math.PI / 2);
    b.add(band, mat4([P.x, DECK_Y + P.h * 0.62, P.z]));
    band.dispose();
  }
  const g = b.build();
  g.userData.rail = rail;
  return g;
}

/** Curved glass balustrade panels following the rails. */
export function makeGlassGeometry() {
  const b = new Builder();
  const runs = [
    [POOL.phi1 + 0.04, Math.PI * 0.5],
    [Math.PI * 0.5, Math.PI * 2 + POOL.phi0 - 0.04],
  ];
  for (const [from, to] of runs) {
    const n = Math.round((to - from) * 30);
    const base = b.count;
    for (let i = 0; i <= n; i++) {
      const phi = from + ((to - from) * i) / n;
      const r = deckR(phi) - 0.25;
      const x = Math.cos(phi) * r;
      const z = Math.sin(phi) * r;
      const nrm = [Math.cos(phi), 0, Math.sin(phi)];
      b.vertex([x, DECK_Y + 0.08, z], nrm, [i / n, 0], [1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]);
      b.vertex([x, DECK_Y + 1.1, z], nrm, [i / n, 1], [1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      b.tri(a, a + 2, a + 1);
      b.tri(a + 1, a + 2, a + 3);
    }
  }
  return b.build();
}

/** Emissive aqua strips: dais skirt, deck fascia line, planter lips. */
export function makeGlowGeometry() {
  const b = new Builder();
  const skirt = new THREE.CylinderGeometry(DAIS_R + 0.085, DAIS_R + 0.085, 0.06, 128, 1, true);
  b.add(skirt, mat4([0, -0.17, 0]), { color: GLOW });
  skirt.dispose();
  const fascia = [];
  for (let i = 0; i < 160; i++) {
    const phi = (i / 160) * Math.PI * 2;
    const r = deckR(phi) + 0.25;
    fascia.push(new THREE.Vector3(Math.cos(phi) * r, DECK_Y - 1.0, Math.sin(phi) * r));
  }
  sweep(b, fascia.reverse(), [[0, -0.07, 1, 0], [0, 0.07, 1, 0]], { closed: true, color: GLOW });
  const basin = new THREE.TorusGeometry(FOUNTAIN.r + 0.3, 0.03, 4, 48).rotateX(Math.PI / 2);
  b.add(basin, mat4([FOUNTAIN.x, DECK_Y + 0.3, FOUNTAIN.z]), { color: GLOW });
  basin.dispose();
  return b.build();
}

function lumpy(radius, detail, seed, squash = [1, 1, 1], lump = 0.1) {
  let g = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + lump * Math.sin(v.x * 7 + seed) * Math.sin(v.y * 6 + seed * 2) * Math.sin(v.z * 7 + seed * 3);
    v.multiplyScalar(k);
    p.setXYZ(i, v.x * squash[0], v.y * squash[1], v.z * squash[2]);
  }
  g.computeVertexNormals();
  return g;
}

/** Lawn bed surfaces (flat rings at deck level). */
export function makeLawnGeometry() {
  const b = new Builder();
  for (const L of LAWNS) {
    const from = THREE.MathUtils.degToRad(L.from);
    const len = THREE.MathUtils.degToRad(L.to - L.from);
    // RingGeometry runs counter-clockwise in xy; mirrored into xz it matches phi = -theta.
    const ring = new THREE.RingGeometry(L.inner, L.outer, 64, 1, -from - len, len).rotateX(-Math.PI / 2);
    b.add(ring, mat4([0, DECK_Y + 0.05, 0]), { color: [1, 1, 1] });
    ring.dispose();
  }
  return b.build();
}

/** Topiary greens and planter soil/grass tops (vertex colored). */
export function makeLeafGeometry() {
  const b = new Builder();
  const rand = makeRandom(91);
  const greens = ['#3fae3a', '#58c23c', '#2f9a3f', '#6fcf3f'].map(hexToLinear);
  const trunk = hexToLinear('#8a6a4c');
  // Shade topiary from a deep underside to a sunlit top.
  const shaded = (c) => (p, n) => {
    const k = THREE.MathUtils.smoothstep(n.y, -0.7, 0.9);
    return [c[0] * (0.45 + 0.75 * k), c[1] * (0.55 + 0.6 * k), c[2] * (0.5 + 0.6 * k)];
  };
  const put = (geo, pos, color) => {
    b.add(geo, mat4(pos), { color: color === trunk ? color : shaded(color) });
    geo.dispose();
  };
  for (const P of PLANTERS) {
    const top = DECK_Y + P.h * 0.96;
    put(new THREE.CircleGeometry(P.r * 0.93, 32).rotateX(-Math.PI / 2), [P.x, top, P.z], hexToLinear('#4a9a30'));
    const g = rand.pick(greens);
    if (P.plant === 'lollipop') {
      put(new THREE.CylinderGeometry(0.07, 0.1, 2.0, 8), [P.x, top + 1.0, P.z], trunk);
      put(lumpy(1.15, 2, 1), [P.x, top + 2.6, P.z], g);
      put(lumpy(0.55, 1, 2), [P.x, top + 0.35, P.z], rand.pick(greens));
    } else if (P.plant === 'stack') {
      put(lumpy(1.2, 2, 3, [1, 0.9, 1]), [P.x, top + 0.95, P.z], g);
      put(lumpy(0.9, 2, 4, [1, 0.9, 1]), [P.x, top + 2.5, P.z], g);
      put(lumpy(0.6, 1, 5, [1, 0.95, 1]), [P.x, top + 3.6, P.z], g);
    } else if (P.plant === 'cone') {
      put(lumpy(1, 2, 6, [0.85, 2.4, 0.85], 0.05), [P.x, top + 2.1, P.z], g);
    } else if (P.plant === 'cloud') {
      put(new THREE.CylinderGeometry(0.08, 0.12, 1.6, 8), [P.x, top + 0.8, P.z], trunk);
      put(lumpy(1.0, 2, 7), [P.x, top + 2.2, P.z], g);
      put(lumpy(0.7, 1, 8), [P.x + 0.8, top + 1.9, P.z + 0.3], rand.pick(greens));
      put(lumpy(0.65, 1, 9), [P.x - 0.7, top + 2.0, P.z - 0.2], rand.pick(greens));
      put(lumpy(0.55, 1, 10), [P.x + 0.1, top + 2.95, P.z], rand.pick(greens));
    } else {
      put(lumpy(P.r * 0.85, 2, 11, [1, 0.45, 1], 0.06), [P.x, top + 0.1, P.z], g);
    }
  }
  // A pair of leaves on each wind-flower stem.
  for (const W of WIND_FLOWERS) {
    for (const side of [-1, 1]) {
      const leafGeo = lumpy(0.5, 1, 12, [0.35, 1, 0.12], 0.02);
      const m = mat4([W.x + side * 0.25, DECK_Y + W.h * (side > 0 ? 0.42 : 0.3), W.z], [0, 0.4, -side * 0.75]);
      b.add(leafGeo, m, { color: shaded(hexToLinear('#5cc23c')) });
      leafGeo.dispose();
    }
  }
  return b.build();
}

/** Flower heads for instancing: [x, y, z, colorIndex]. */
export function flowerSpots() {
  const rand = makeRandom(5);
  const spots = [];
  for (const P of PLANTERS) {
    const top = DECK_Y + P.h * 0.96;
    const mound = P.plant === 'flowers';
    const n = mound ? 70 : 24;
    for (let i = 0; i < n; i++) {
      const ang = rand.range(0, Math.PI * 2);
      const rr = mound ? Math.sqrt(rand.next()) * P.r * 0.85 : P.r * rand.range(0.62, 0.9);
      const dome = mound ? Math.sqrt(Math.max(0, 1 - (rr / (P.r * 0.85)) ** 2)) * P.r * 0.38 : 0.05;
      spots.push([P.x + Math.cos(ang) * rr, top + 0.1 + dome, P.z + Math.sin(ang) * rr, rand.int(0, 5)]);
    }
  }
  return spots;
}

/** One canopy petal: a cupped, tapering sail rising from the mast top, uv.y across. */
export function makePetalGeometry() {
  const nu = 18;
  const nv = 8;
  const pos = [];
  const uv = [];
  const idx = [];
  const L = 8.5;
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const w = Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.92 + 0.08)), 0.75) * 2.3 * (1 - 0.25 * u);
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      const x = u * L;
      const y = Math.sin(u * Math.PI * 0.75) * 1.9 - u * u * 1.4 + v * v * w * 0.32;
      pos.push(x, y, v * w);
      uv.push(u, v * 0.5 + 0.5);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j;
      idx.push(a, a + 1, a + nv + 1, a + 1, a + nv + 2, a + nv + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Wind-flower rotor: five glossy petals around a hub, facing +z, spinning about z. */
export function makeRotorGeometry() {
  const b = new Builder();
  const tip = hexToLinear('#2fc4e6');
  const lime = hexToLinear('#9be24a');
  const petal = new THREE.SphereGeometry(1, 16, 10);
  for (let k = 0; k < 5; k++) {
    const ang = (k / 5) * Math.PI * 2;
    // Each petal is a flattened ellipsoid pitched like a propeller blade.
    const m = new THREE.Matrix4()
      .makeRotationZ(ang)
      .multiply(new THREE.Matrix4().makeTranslation(0, 1.05, 0))
      .multiply(new THREE.Matrix4().makeRotationY(0.45))
      .multiply(new THREE.Matrix4().makeScale(0.36, 0.9, 0.07));
    const c = k % 2 ? lime : tip;
    b.add(petal, m, {
      color: (p) => {
        const t = THREE.MathUtils.smoothstep(Math.hypot(p.x, p.y), 0.4, 1.9);
        return WHITE.map((w, i) => w + (c[i] - w) * t);
      },
    });
  }
  petal.dispose();
  const hub = new THREE.SphereGeometry(0.3, 16, 10);
  b.add(hub, mat4([0, 0, 0.05], [0, 0, 0], [1, 1, 0.8]), { color: hexToLinear('#ffe14a') });
  hub.dispose();
  const nacelle = new THREE.CylinderGeometry(0.12, 0.2, 0.6, 10).rotateX(Math.PI / 2);
  b.add(nacelle, mat4([0, 0, -0.3]), { color: WHITE });
  nacelle.dispose();
  return b.build();
}
