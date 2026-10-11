import * as THREE from 'three';
import { makeRandom, smoothstep } from '../shared/random.js';
import { Builder, EMIT, KIND, LEAF, PAINT, SOLAR, circleProfile, hexToLinear, loft, mat4, roundedProfile, superR, sweep } from './geometry.js';
import { CAMERA, GROUND, MONORAILS, MONO_Y, polar, riverSDF } from './layout.js';

// Builds every static piece of the city into one merged geometry, plus the
// placement data other systems need (trees, waterfalls, domes, monorail path).

const WHITE = hexToLinear('#f6f9fc');
const OFFWHITE = hexToLinear('#dfe9ee');
const GRASS = hexToLinear('#5fb83a');
const AQUA = hexToLinear('#7ff0ff');
const RED = [1, 0.3, 0.25];

const rotated = (rot) => {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return (x, z) => [x * c - z * s, x * s + z * c];
};

function towerSection(T) {
  const { type, a, b = a, rot = 0, twist = 0 } = T;
  const R = rotated(rot);
  switch (type) {
    case 'cyl':
      return (th, t) => {
        const r = a * (1 - 0.06 * t);
        return [Math.cos(th) * r, Math.sin(th) * r];
      };
    case 'ellipse':
      return (th, t) => R(Math.cos(th) * a * (1 - 0.1 * t), Math.sin(th) * b * (1 - 0.1 * t));
    case 'twist':
      return (th, t) => {
        const r = superR(th - twist * t, a, b, 4.2) * (1 - 0.16 * t);
        return R(Math.cos(th) * r, Math.sin(th) * r);
      };
    case 'sail':
      return (th, t) => {
        const r = superR(th, a * (1 - 0.32 * t * t), b * (1 - 0.45 * t), 2.3);
        const x = Math.cos(th) * r;
        let z = Math.sin(th) * r;
        if (z < 0) z *= 0.5;
        z -= b * 0.8 * t * t;
        return R(x, z);
      };
    case 'bulge':
      return (th, t) => {
        const body = 0.84 + 0.3 * Math.sin(Math.PI * t * 0.92);
        const cap = t < 0.8 ? 1 : Math.sqrt(Math.max(0.003, 1 - ((t - 0.8) / 0.2) ** 2));
        const r = a * body * cap;
        return [Math.cos(th) * r, Math.sin(th) * r];
      };
    case 'lobed':
      return (th, t) => {
        const r = a * (1 + 0.15 * Math.cos(3 * (th - twist * t))) * (1 - 0.12 * t);
        return [Math.cos(th) * r, Math.sin(th) * r];
      };
    default:
      return (th) => {
        const r = superR(th, a, b, 5);
        return R(Math.cos(th) * r, Math.sin(th) * r);
      };
  }
}

function perimeter(section, t, n = 48) {
  let p = 0;
  let prev = section(0, t);
  for (let i = 1; i <= n; i++) {
    const cur = section((i / n) * Math.PI * 2, t);
    p += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    prev = cur;
  }
  return p;
}

const scaled = (section, k, tFixed = null) => (th, t) => section(th, tFixed ?? t).map((v) => v * k);

function addGardenTop(b, rand, { cx, cz, y, section, inner, trees, count = 5, scale = 1 }) {
  loft(b, {
    cx, cz, y0: y, y1: y + 1.4, segments: 40,
    section: (th) => section(th, 1).map((v) => v * 1.02),
    color: WHITE, st: PAINT(),
    capTop: [{ lift: -0.7, scale: 0.94, color: GRASS, st: LEAF }],
  });
  for (let i = 0; i < count; i++) {
    const ang = rand.range(0, Math.PI * 2);
    const rr = Math.sqrt(rand.next()) * inner * 0.62;
    trees.push({ x: cx + Math.cos(ang) * rr, y: y + 0.6, z: cz + Math.sin(ang) * rr, s: rand.range(4, 7) * scale, type: rand.chance(0.25) ? 'cone' : 'round' });
  }
}

function addSolarRoof(b, { cx, cz, y, a, bb, rot = 0 }) {
  const R = rotated(rot);
  const panel = new THREE.BoxGeometry(5, 0.2, 2.8);
  const nx = Math.max(1, Math.floor((a * 1.3) / 6));
  const nz = Math.max(1, Math.floor((bb * 1.3) / 4.2));
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const [ox, oz] = R((i - (nx - 1) / 2) * 6, (j - (nz - 1) / 2) * 4.2);
      b.add(panel, mat4([cx + ox, y + 1.4, cz + oz], [0.4, -rot, 0]), { color: [1, 1, 1], st: SOLAR });
    }
  }
  panel.dispose();
}

function addSpire(b, cx, cz, y, height) {
  const cone = new THREE.CylinderGeometry(0.25, 2.4, height, 10, 1);
  b.add(cone, mat4([cx, y + height / 2, cz]), { color: WHITE, st: PAINT(0.25, 0.2) });
  const ring = new THREE.TorusGeometry(3.6, 0.6, 6, 24);
  b.add(ring, mat4([cx, y + height * 0.3, cz], [Math.PI / 2, 0, 0]), { color: WHITE, st: PAINT() });
  const tip = new THREE.SphereGeometry(1.2, 10, 8);
  b.add(tip, mat4([cx, y + height + 0.8, cz]), { color: RED, st: EMIT(10, true) });
  [cone, ring, tip].forEach((g) => g.dispose());
}

function addTower(b, T, rand, out) {
  const { x: cx, z: cz, h, a } = T;
  const bb = T.b ?? a;
  const floorH = 5;
  const seed = rand.next();
  const fa = [T.tint ?? rand.next(), T.style ?? rand.int(0, 3), seed, T.green ?? 0];
  const st = [KIND.GLASS, T.bands ?? 0, 0, 0];
  const g0 = GROUND;
  out.footprints.push({ x: cx, z: cz, r: Math.max(a, bb) });

  if (T.type === 'stepped') {
    // Terraced tower: lush gardens on each tier with water spilling down the front.
    const R = rotated(T.rot ?? 0);
    const tiers = [
      [0, 0.45, 1],
      [0.45, 0.74, 0.76],
      [0.74, 1, 0.52],
    ];
    const toCam = Math.atan2(CAMERA.position[2] - cz, CAMERA.position[0] - cx);
    tiers.forEach(([t0, t1, s], k) => {
      const section = (th) => {
        const r = superR(th, a * s, bb * s, 5);
        return R(Math.cos(th) * r, Math.sin(th) * r);
      };
      const y0 = g0 + h * t0;
      const y1 = g0 + h * t1;
      loft(b, { cx, cz, y0, y1, segments: 48, section, cols: Math.round(perimeter(section, 0) / 3.2), floorH, fa, st });
      loft(b, {
        cx, cz, y0: y1 - 0.6, y1: y1 + 1.6, segments: 48,
        section: (th) => section(th).map((v) => v * 1.05),
        color: WHITE, st: PAINT(),
        capTop: [{ lift: -0.4, scale: 0.97, color: GRASS, st: LEAF }],
      });
      const next = tiers[k + 1];
      const ringR = next ? (s + next[2]) / 2 : s * 0.5;
      const n = next ? 16 : 6;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + rand.range(-0.15, 0.15);
        // Leave the waterfall lip clear of trees (ang is in the tower's rotated frame).
        const rel = ang + (T.rot ?? 0) - toCam;
        if (Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel))) < 0.45) continue;
        const r = superR(ang, a * ringR, bb * ringR, 5);
        const [ox, oz] = R(Math.cos(ang) * r, Math.sin(ang) * r);
        out.trees.push({ x: cx + ox, y: y1 + 1.2, z: cz + oz, s: rand.range(5, 8), type: rand.chance(0.25) ? 'cone' : 'round' });
      }
      // Waterfall from this tier's lip down to the terrace (or the ground) below.
      const lipR = superR(toCam - (T.rot ?? 0), a * s, bb * s, 5) * 1.06;
      const below = k === 0 ? g0 + 0.5 : g0 + h * tiers[k - 1][1] + 1.2;
      out.falls.push({ cx, cz, r: lipR, th: toCam, span: 0.5 - k * 0.08, y0: y1 + 1.0, y1: below });
    });
    return;
  }

  const section = towerSection(T);
  const perim = perimeter(section, 0);
  const colW = fa[1] === 3 ? 3.6 : fa[1] === 2 ? 2.8 : 3.2;
  const cols = Math.max(8, Math.round(perim / colW));
  const levels = { cyl: 2, ellipse: 2, twist: Math.ceil(h / 10), sail: 18, bulge: 30, lobed: Math.ceil(h / 10) }[T.type] ?? 1;
  const segments = T.far ? 24 : T.type === 'twist' || T.type === 'lobed' ? 48 : 40;

  // Planted podium.
  if (T.podium) {
    const k = 1 + 8 / Math.max(a, bb);
    loft(b, {
      cx, cz, y0: g0, y1: g0 + 12, segments: 40, section: scaled(section, k, 0),
      cols: Math.round((perim * k) / 3.8), floorH: 6, fa: [0.8, 1, seed + 0.31, 0], st,
    });
    loft(b, {
      cx, cz, y0: g0 + 12, y1: g0 + 13.2, segments: 40,
      section: scaled(section, k * 1.015, 0), color: WHITE, st: PAINT(),
      capTop: [{ lift: -0.6, scale: 0.96, color: GRASS, st: LEAF }],
    });
  }

  loft(b, { cx, cz, y0: g0, y1: g0 + h, levels, segments, section, cols, floorH, fa, st });

  const top = g0 + h;
  const topR = Math.min(a, bb) * 0.8;
  switch (T.crown) {
    case 'spire':
      loft(b, {
        cx, cz, y0: top - 3, y1: top + 5, segments, section: scaled(section, 1.03, 1),
        color: WHITE, st: PAINT(), capTop: { lift: -3, color: OFFWHITE, st: PAINT() },
      });
      addSpire(b, cx, cz, top - 3, Math.min(70, h * 0.22));
      break;
    case 'petals': {
      // Lotus crown: white fins flaring out from the roof edge around a spire.
      loft(b, {
        cx, cz, y0: top - 2, y1: top + 2, segments, section: scaled(section, 1.02, 1),
        color: WHITE, st: PAINT(), capTop: { lift: -1, color: OFFWHITE, st: PAINT() },
      });
      const fin = new THREE.BoxGeometry(1.6, 1, 9, 1, 10, 2);
      const fp = fin.attributes.position;
      for (let i = 0; i < fp.count; i++) {
        const t = fp.getY(i) + 0.5;
        const w = Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.15)) * (1 - 0.55 * t);
        fp.setXYZ(i, fp.getX(i) + t * t * 12, t * 36, fp.getZ(i) * w);
      }
      fin.computeVertexNormals();
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const [px, pz] = section(ang, 1);
        b.add(fin, mat4([cx + px * 0.95, top - 8, cz + pz * 0.95], [0, -ang, 0]), { color: WHITE, st: PAINT(0.22, 0.1) });
      }
      fin.dispose();
      const ring = new THREE.TorusGeometry(topR * 1.2, 0.7, 6, 40);
      b.add(ring, mat4([cx, top + 20, cz], [Math.PI / 2, 0, 0]), { color: AQUA, st: EMIT(2.2, false, true) });
      ring.dispose();
      addSpire(b, cx, cz, top, h * 0.2);
      break;
    }
    case 'crown':
      loft(b, {
        cx, cz, y0: top - 6, y1: top + 10, levels: 4, segments,
        section: (th, t) => section(th, 1).map((v) => v * (1.02 + 0.1 * t * t)),
        color: WHITE, st: PAINT(0.22, 0.1), capTop: [{ lift: -12, color: GRASS, st: LEAF, scale: 0.95 }],
      });
      for (let i = 0; i < 6; i++) {
        const ang = rand.range(0, Math.PI * 2);
        const rr = Math.sqrt(rand.next()) * topR * 0.6;
        out.trees.push({ x: cx + Math.cos(ang) * rr, y: top - 2, z: cz + Math.sin(ang) * rr, s: rand.range(5, 8), type: 'round' });
      }
      break;
    case 'dome':
      if (T.type !== 'bulge') {
        loft(b, {
          cx, cz, levels: 8, segments, cols, floorH, fa, st,
          yAt: (u) => top + Math.sin(u * Math.PI * 0.5) * topR * 0.7,
          section: (th, u) => section(th, 1).map((v) => v * Math.max(0.04, Math.cos(u * Math.PI * 0.5))),
        });
      }
      {
        const domeTop = T.type === 'bulge' ? top : top + topR * 0.7;
        const fin = new THREE.CylinderGeometry(0.2, 1.4, 18, 8);
        b.add(fin, mat4([cx, domeTop + 8, cz]), { color: WHITE, st: PAINT() });
        fin.dispose();
        const tip = new THREE.SphereGeometry(1.1, 8, 6);
        b.add(tip, mat4([cx, domeTop + 17.5, cz]), { color: RED, st: EMIT(10, true) });
        tip.dispose();
      }
      break;
    case 'solar':
      loft(b, {
        cx, cz, y0: top, y1: top + 1.4, segments, section: scaled(section, 1.02, 1),
        color: WHITE, st: PAINT(), capTop: { lift: -0.3, scale: 0.98, color: OFFWHITE, st: PAINT(0.5, 0) },
      });
      addSolarRoof(b, { cx, cz, y: top, a: a * 0.85, bb: bb * 0.85, rot: T.rot ?? 0 });
      break;
    case 'flat':
      loft(b, {
        cx, cz, y0: top, y1: top + 1.2, segments, section: scaled(section, 1.02, 1),
        color: WHITE, st: PAINT(), capTop: { lift: -0.2, scale: 0.98, color: OFFWHITE, st: PAINT(0.5, 0) },
      });
      break;
    case 'garden':
    default:
      addGardenTop(b, rand, { cx, cz, y: top, section, inner: topR, trees: out.trees, count: Math.round(3 + topR / 3) });
      break;
  }
}

// Hand-placed landmarks: tall towers frame both sides of the shot, the middle
// stays low so the space behind the dancers' heads is calm haze and river.
// az/d are degrees and distance from the camera; top is height above the terrace.
const LANDMARKS = [
  { az: -31, d: 250, type: 'twist', a: 22, b: 17, top: 150, crown: 'petals', style: 1, tint: 0.05, green: 0.5, twist: 0.9 },
  { az: -45, d: 440, type: 'bulge', a: 30, top: 95, crown: 'dome', style: 0, tint: 0.62, podium: true },
  { az: -25, d: 600, type: 'cyl', a: 22, top: 60, crown: 'spire', style: 3, tint: 0.88, bands: 6 },
  { az: -41, d: 160, type: 'ellipse', a: 17, b: 12, rot: 0.4, top: -20, crown: 'garden', style: 1, tint: 0.45, green: 0.8 },
  { az: -40, d: 330, type: 'block', a: 20, b: 15, rot: 0.2, top: -34, crown: 'solar', style: 0, tint: 0.3 },
  { az: 29, d: 265, type: 'sail', a: 27, b: 18, rot: -0.35, top: 175, crown: 'spire', style: 2, tint: 0.72 },
  { az: 43, d: 480, type: 'lobed', a: 26, top: 112, crown: 'crown', style: 1, tint: 0.25, twist: 0.6, green: 0.6 },
  { az: 19, d: 420, type: 'stepped', a: 40, b: 30, rot: -0.3, top: 12, style: 1, tint: 0.4, green: 0.6 },
  { az: 38, d: 165, type: 'block', a: 15, b: 13, top: -24, crown: 'garden', style: 1, tint: 0.55, green: 0.5 },
  { az: 9, d: 1080, type: 'cyl', a: 26, top: 72, crown: 'spire', style: 1, tint: 0.15 },
  { az: -9, d: 1300, type: 'twist', a: 24, b: 20, top: 98, crown: 'petals', style: 0, tint: 0.9, twist: -0.8 },
  { az: 5, d: 2150, type: 'ellipse', a: 30, b: 22, top: 60, crown: 'dome', style: 3, tint: 0.5 },
];

// Sky bridges between landmark pairs, at heights above the terrace.
const BRIDGES = [
  [0, 1, 32],
  [0, 2, 16],
  [5, 6, 58],
  [5, 7, 4],
];

function distToPath(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (p.x + dx * t), z - (p.z + dz * t)));
  }
  return best;
}

function addMonorail(b, loop, out) {
  const curve = new THREE.CatmullRomCurve3(loop.map(([x, z]) => new THREE.Vector3(x, MONO_Y, z)), true, 'centripetal');
  const total = curve.getLength();
  const n = Math.round(total / 6);
  const pts = curve.getSpacedPoints(n).slice(0, n);
  const track = { points: pts, total, step: total / n };
  out.monorails.push(track);
  sweep(b, pts, roundedProfile(4.2, 2.6, 1.0, 3), { closed: true, color: (j) => (j > 3 && j < 9 ? WHITE : OFFWHITE), st: PAINT(0.25, 0.05) });
  const stripe = roundedProfile(4.4, 0.4, 0.15, 1).map(([x, y, nx, ny]) => [x, y - 0.5, nx, ny]);
  sweep(b, pts, stripe, { closed: true, color: hexToLinear('#2fd2ea'), st: EMIT(1.2) });
  const pylon = new THREE.CylinderGeometry(1.2, 1.8, 1, 12, 1);
  const cap = new THREE.CapsuleGeometry(1.4, 4.5, 4, 8);
  const every = Math.round(70 / track.step);
  for (let i = 0; i < pts.length; i += every) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const hgt = MONO_Y - 2 - GROUND;
    b.add(pylon, mat4([p.x, GROUND + hgt / 2, p.z], [0, 0, 0], [1, hgt, 1]), { color: WHITE, st: PAINT() });
    b.add(cap, mat4([p.x, MONO_Y - 2, p.z], [0, -Math.atan2(q.z - p.z, q.x - p.x), Math.PI / 2]), { color: WHITE, st: PAINT() });
  }
  pylon.dispose();
  cap.dispose();
}

function addBridges(b, rand, towers) {
  const tube = circleProfile(3.4, 14);
  for (const [i, j, y] of BRIDGES) {
    const A = towers[i];
    const B = towers[j];
    const path = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      path.push(new THREE.Vector3(A.x + (B.x - A.x) * t, y - Math.sin(t * Math.PI) * 4, A.z + (B.z - A.z) * t));
    }
    sweep(b, path, tube, { fa: [0.15, 3, rand.next(), 0], st: [KIND.GLASS, 0, 0, 0], uvLen: 4 });
    const spine = roundedProfile(8.4, 1.2, 0.5, 2).map(([x, yy, nx, ny]) => [x, yy - 3.4, nx, ny]);
    sweep(b, path, spine, { color: WHITE, st: PAINT() });
    const glow = roundedProfile(8.6, 0.3, 0.1, 1).map(([x, yy, nx, ny]) => [x, yy - 2.9, nx, ny]);
    sweep(b, path, glow, { color: AQUA, st: EMIT(1.8) });
  }
}

function addDomeBase(b, dome) {
  const ring = new THREE.CylinderGeometry(dome.r * 1.04, dome.r * 1.08, 3, 64, 1, true);
  b.add(ring, mat4([dome.x, GROUND + 1.5, dome.z]), { color: WHITE, st: PAINT() });
  const rim = new THREE.TorusGeometry(dome.r * 1.04, 0.8, 6, 64);
  b.add(rim, mat4([dome.x, GROUND + 3, dome.z], [Math.PI / 2, 0, 0]), { color: WHITE, st: PAINT(0.2, 0.2) });
  ring.dispose();
  rim.dispose();
}

export function buildCity() {
  const rand = makeRandom(20260611);
  const b = new Builder();
  const out = { trees: [], footprints: [], falls: [], domes: [], monorails: [] };

  MONORAILS.forEach((loop) => addMonorail(b, loop, out));
  const rails = out.monorails.map((m) => m.points);

  const [dx, dz] = polar(-21, 470);
  const dome = { x: dx, z: dz, r: 54, hy: 0.78, base: 22 };
  out.domes.push(dome);
  addDomeBase(b, dome);

  const placed = LANDMARKS.map((L) => {
    const [x, z] = polar(L.az, L.d);
    const T = { ...L, x, z, h: L.top - GROUND };
    addTower(b, T, rand, out);
    return T;
  });
  addBridges(b, rand, placed);

  // Fill the city with lower rounded towers whose rooftops sit below the terrace,
  // rising toward the flanks. Nothing tall right behind the dancers.
  const blocked = (x, z, r) =>
    out.footprints.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 16) ||
    riverSDF(x, z) < r + 18 ||
    rails.some((rail) => distToPath(x, z, rail) < r + 12) ||
    Math.hypot(x - dome.x, z - dome.z) < dome.r + r + 24;
  let made = 0;
  for (let k = 0; k < 900 && made < 95; k++) {
    const az = rand.range(-62, 62);
    const d = 170 + Math.pow(rand.next(), 1.3) * 1500;
    const [x, z] = polar(az, d);
    const a = rand.range(11, 22);
    const bb = a * rand.range(0.7, 1);
    if (blocked(x, z, a)) continue;
    const flank = smoothstep(10, 38, Math.abs(az));
    let top = d < 650 ? -60 + flank * 85 + rand.range(-20, 35) : -30 + flank * 70 + rand.range(-25, 55);
    // Calm middle: only low pavilions behind the dancers until the far haze.
    if (Math.abs(az) < 14) top = Math.min(top, d < 1300 ? -78 : 10);
    const type = rand.pick(['cyl', 'ellipse', 'twist', 'block', 'lobed', 'block', 'ellipse']);
    const crown = top < 0 ? rand.pick(['garden', 'garden', 'solar', 'flat', 'garden']) : rand.pick(['garden', 'dome', 'crown', 'spire', 'flat']);
    addTower(b, {
      x, z, type, a, b: bb, h: top - GROUND, rot: rand.range(-0.6, 0.6), twist: rand.range(-0.8, 0.8),
      crown, green: rand.chance(0.45) ? rand.range(0.3, 0.8) : 0, bands: rand.chance(0.3) ? 5 : 0, podium: d < 900 && rand.chance(0.35),
    }, rand, out);
    made++;
  }

  // Hazy far skyline ring near the horizon.
  for (let i = 0; i < 46; i++) {
    const az = -70 + i * 3.1 + rand.range(-1, 1);
    const d = rand.range(1900, 2700);
    const [x, z] = polar(az, d);
    if (riverSDF(x, z) < 40) continue;
    const a = rand.range(16, 30);
    const center = 1 - smoothstep(4, 20, Math.abs(az));
    const top = rand.range(-10, 120) * (1 - 0.5 * center);
    addTower(b, { x, z, type: rand.pick(['cyl', 'ellipse', 'twist', 'block']), a, b: a * rand.range(0.7, 1), h: top - GROUND, crown: rand.pick(['flat', 'dome', 'spire']), far: true }, rand, out);
  }

  // Park trees on visible ground: along the river banks and in green blocks.
  for (let k = 0; k < 6000 && out.trees.length < 1500; k++) {
    const az = rand.range(-65, 65);
    const d = rand.range(380, 2300);
    const [x, z] = polar(az, d);
    const sdf = riverSDF(x, z);
    if (sdf < 10) continue;
    const park = sdf < 70 || Math.sin(x * 0.011) * Math.sin(z * 0.013 + 1.3) > 0.25;
    if (!park) continue;
    if (out.footprints.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 8)) continue;
    if (Math.hypot(x - dome.x, z - dome.z) < dome.r + 6) continue;
    out.trees.push({ x, y: GROUND, z, s: rand.range(9, 15) * (1 + d / 3000), type: rand.chance(0.2) ? 'cone' : 'round' });
  }
  // Tropical planting inside the biodome.
  for (let k = 0; k < 40; k++) {
    const ang = rand.range(0, Math.PI * 2);
    const rr = Math.sqrt(rand.next()) * dome.r * 0.78;
    const hgt = Math.sqrt(1 - (rr / dome.r) ** 2) * dome.r * dome.hy;
    out.trees.push({ x: dome.x + Math.cos(ang) * rr, y: GROUND + dome.base, z: dome.z + Math.sin(ang) * rr, s: Math.min(rand.range(9, 20), hgt * 0.8), type: rand.chance(0.5) ? 'palm' : 'round' });
  }

  return { geometry: b.build(), ...out };
}
