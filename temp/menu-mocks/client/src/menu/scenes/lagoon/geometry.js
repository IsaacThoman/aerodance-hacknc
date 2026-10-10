import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRandom } from '../../shared/random.js';

// ---------------------------------------------------------------------------
// Small procedural toolkit: every builder returns non-indexed geometry with
// position, normal, color (linear) and aSway attributes so pieces can be
// merged into a handful of draw calls.
// ---------------------------------------------------------------------------

const _c = new THREE.Color();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

export function color(hex) {
  return new THREE.Color(hex);
}

/** Smooth 3D value noise in [-1, 1]. */
export function makeNoise3(seed = 1) {
  const rand = makeRandom(seed);
  const perm = new Uint16Array(512);
  const vals = new Float32Array(256);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand.next() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) vals[i] = rand.next() * 2 - 1;
  const fade = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const h = (x, y, z) => vals[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  return (x, y, z = 0) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    const zf = fade(z - zi);
    const x0 = lerp(h(xi, yi, zi), h(xi + 1, yi, zi), xf);
    const x1 = lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf);
    const x2 = lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf);
    const x3 = lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf);
    return lerp(lerp(x0, x1, yf), lerp(x2, x3, yf), zf);
  };
}

export function fbm3(noise, x, y, z, octaves = 3) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += a * noise(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return v;
}

/**
 * Normalise a geometry for merging: non-indexed, position/normal/color/aSway.
 * paint: hex string, THREE.Color, or fn(p, n, outColor) in object space.
 * sway: number or fn(p) -> weight (0 = rigid).
 */
export function finalize(geo, { paint = '#ffffff', sway = 0, smooth = false } = {}) {
  let g = geo;
  if (smooth && !g.index) g = mergeVertices(g);
  if (!g.attributes.normal || smooth) g.computeVertexNormals();
  if (g.index) g = g.toNonIndexed();
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'color', 'aSway'].includes(name)) g.deleteAttribute(name);
  }
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const count = pos.count;
  if (!g.attributes.color) {
    const arr = new Float32Array(count * 3);
    if (typeof paint === 'function') {
      for (let i = 0; i < count; i++) {
        _p.fromBufferAttribute(pos, i);
        _n.fromBufferAttribute(nrm, i);
        paint(_p, _n, _c);
        arr[i * 3] = _c.r;
        arr[i * 3 + 1] = _c.g;
        arr[i * 3 + 2] = _c.b;
      }
    } else {
      _c.set(paint);
      for (let i = 0; i < count; i++) {
        arr[i * 3] = _c.r;
        arr[i * 3 + 1] = _c.g;
        arr[i * 3 + 2] = _c.b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  if (!g.attributes.aSway) {
    const arr = new Float32Array(count);
    if (typeof sway === 'function') {
      for (let i = 0; i < count; i++) {
        _p.fromBufferAttribute(pos, i);
        arr[i] = sway(_p);
      }
    } else arr.fill(sway);
    g.setAttribute('aSway', new THREE.BufferAttribute(arr, 1));
  }
  g.groups = [];
  return g;
}

export function merge(list) {
  const g = mergeGeometries(list, false);
  list.forEach((x) => x.dispose());
  g.computeBoundingSphere();
  return g;
}

/** Apply a matrix built from position / euler / scale. */
export function place(geo, { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...scale),
  );
  geo.applyMatrix4(m);
  return geo;
}

/**
 * Tube along a curve with a radius function; colorFn(t, angle, outColor) and
 * swayFn(t) give per-vertex color and sway.
 */
export function taperedTube(curve, tubular, radial, radiusFn, { colorFn = null, swayFn = null, flatten = 1 } = {}) {
  const frames = curve.computeFrenetFrames(tubular, false);
  const positions = [];
  const normals = [];
  const colors = [];
  const sways = [];
  const indices = [];
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    const r = radiusFn(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const s = Math.sin(a);
      const c = -Math.cos(a);
      N.set(0, 0, 0).addScaledVector(frames.normals[i], c * flatten).addScaledVector(frames.binormals[i], s).normalize();
      positions.push(P.x + r * N.x, P.y + r * N.y, P.z + r * N.z);
      normals.push(N.x, N.y, N.z);
      if (colorFn) {
        colorFn(t, a, _c);
        colors.push(_c.r, _c.g, _c.b);
      }
      sways.push(swayFn ? swayFn(t) : 0);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      const c = (i + 1) * (radial + 1) + j + 1;
      const d = i * (radial + 1) + j + 1;
      indices.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sways, 1));
  g.setIndex(indices);
  return g;
}

/** Noise-displaced, squashed sphere ("blob") for rocks, bushes, coral heads. */
export function blob({ radius = 1, detail = 3, squash = [1, 1, 1], amount = 0.18, freq = 1.4, seed = 1, flatBottom = false } = {}) {
  const noise = makeNoise3(seed);
  let g = new THREE.IcosahedronGeometry(radius, detail);
  g = mergeVertices(g);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.copy(_p).normalize();
    const d = 1 + amount * fbm3(noise, _n.x * freq + 3.1, _n.y * freq, _n.z * freq, 3);
    _p.copy(_n).multiplyScalar(radius * d);
    _p.set(_p.x * squash[0], _p.y * squash[1], _p.z * squash[2]);
    if (flatBottom && _p.y < 0) _p.y *= 0.25;
    pos.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Above water props
// ---------------------------------------------------------------------------

/** Island landmass: polar grid with irregular coastline; sand + wet ring. */
export function islandGeometry({ radius = 30, height = 6, seed = 1, rings = 18, segments = 64 } = {}) {
  const noise = makeNoise3(seed);
  const positions = [];
  const indices = [];
  for (let i = 0; i <= rings; i++) {
    const rho = (i / rings) * 1.35;
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const coast = 1 + 0.22 * noise(Math.cos(a) * 1.3 + 5, Math.sin(a) * 1.3, seed) + 0.08 * noise(Math.cos(a) * 4, Math.sin(a) * 4, 2);
      const r = rho * radius * coast;
      let h;
      if (rho < 1) {
        h = height * Math.pow(1 - rho * rho, 0.85);
        h += (1 - rho) * height * 0.25 * noise(Math.cos(a) * rho * 3, Math.sin(a) * rho * 3, 7);
      } else h = -(rho - 1) * height * 1.6;
      positions.push(Math.cos(a) * r, h, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = (i + 1) * (segments + 1) + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const sand = color('#fbefcf');
  const wet = color('#d8c39a');
  const grass = color('#6fd04a');
  return finalize(g, {
    paint: (p, n, out) => {
      out.copy(sand);
      if (p.y < 0.35) out.lerp(wet, THREE.MathUtils.smoothstep(0.35 - p.y, 0, 0.4));
      const g2 = THREE.MathUtils.smoothstep(p.y, height * 0.55, height * 0.8) * THREE.MathUtils.smoothstep(n.y, 0.6, 0.9);
      out.lerp(grass, g2 * 0.55);
    },
  });
}

/** Cluster of glossy round bushes. */
export function bushCluster({ count = 8, spread = 8, size = [2, 4], seed = 3, base = [0, 0, 0], heightAt = () => 0 }) {
  const rand = makeRandom(seed);
  const greens = ['#4fbf3a', '#6fd448', '#3aa83a', '#8fe05a', '#2f9a48'];
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rand.range(0, Math.PI * 2);
    const d = Math.sqrt(rand.next()) * spread;
    const x = base[0] + Math.cos(a) * d;
    const z = base[2] + Math.sin(a) * d;
    const s = rand.range(size[0], size[1]) * (1 - (d / spread) * 0.45);
    const g = blob({ radius: s, detail: 2, squash: [1, 0.75, 1], amount: 0.22, freq: 1.8, seed: seed * 31 + i });
    place(g, { position: [x, base[1] + heightAt(x, z) + s * 0.25, z], rotation: [0, rand.range(0, 6), 0] });
    const c1 = color(rand.pick(greens));
    const c2 = c1.clone().multiplyScalar(0.55);
    const top = c1.clone().lerp(color('#e6ff9a'), 0.35);
    parts.push(
      finalize(g, {
        paint: (p, n, out) => {
          out.copy(c2).lerp(c1, THREE.MathUtils.smoothstep(n.y, -0.4, 0.4)).lerp(top, THREE.MathUtils.smoothstep(n.y, 0.6, 1.0) * 0.6);
        },
        sway: 0.08,
      }),
    );
  }
  return parts;
}

/** A curved palm: tapered banded trunk, drooping V-folded fronds, coconuts. */
export function palmGeometry({ height = 10, lean = 3, heading = 0, seed = 1, fronds = 9, frondLength = 4.6 } = {}) {
  const rand = makeRandom(seed);
  const parts = [];
  const dir = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
  const pts = [
    new THREE.Vector3(0, -0.3, 0),
    dir.clone().multiplyScalar(lean * 0.18).setY(height * 0.33),
    dir.clone().multiplyScalar(lean * 0.55).setY(height * 0.68),
    dir.clone().multiplyScalar(lean).setY(height),
  ];
  const curve = new THREE.CatmullRomCurve3(pts);
  const bark = color('#9a7a55');
  const barkLight = color('#d8bf92');
  parts.push(
    taperedTube(curve, 16, 7, (t) => 0.34 * (1 - t * 0.45) + (t < 0.06 ? (0.06 - t) * 4 : 0), {
      colorFn: (t, a, out) => {
        const band = Math.pow(0.5 + 0.5 * Math.sin(t * height * 4.2), 3);
        out.copy(bark).lerp(barkLight, band * 0.6 + 0.15);
      },
      swayFn: (t) => t * t * 0.35,
    }),
  );
  const crown = pts[3].clone();
  // Coconuts.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rand.range(0, 1);
    const g = new THREE.SphereGeometry(0.26, 8, 6);
    place(g, { position: [crown.x + Math.cos(a) * 0.32, crown.y - 0.35, crown.z + Math.sin(a) * 0.32] });
    parts.push(finalize(g, { paint: '#7a5a2a', sway: 0.35 }));
  }
  // Fronds.
  const leafDark = color('#2f9a3a');
  const leafLight = color('#a6e85a');
  for (let k = 0; k < fronds; k++) {
    const az = (k / fronds) * Math.PI * 2 + rand.range(-0.2, 0.2);
    const up = rand.range(-0.15, 0.55);
    const len = frondLength * rand.range(0.8, 1.1);
    const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const c = new THREE.CatmullRomCurve3([
      crown.clone(),
      crown.clone().addScaledVector(out, len * 0.3).add(new THREE.Vector3(0, len * (0.18 + up * 0.25), 0)),
      crown.clone().addScaledVector(out, len * 0.65).add(new THREE.Vector3(0, len * (0.05 + up * 0.2), 0)),
      crown.clone().addScaledVector(out, len).add(new THREE.Vector3(0, -len * (0.35 - up * 0.2), 0)),
    ]);
    const seg = 10;
    const positions = [];
    const colors = [];
    const sways = [];
    const indices = [];
    const side = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 1, 0)).normalize();
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      c.getPointAt(t, _p);
      const w = 0.85 * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (1 - t * 0.35) + 0.05;
      const fold = w * 0.35;
      // left edge, spine, right edge
      positions.push(_p.x + side.x * w, _p.y - fold, _p.z + side.z * w);
      positions.push(_p.x, _p.y, _p.z);
      positions.push(_p.x - side.x * w, _p.y - fold, _p.z - side.z * w);
      for (const e of [0, 1, 0]) {
        _c.copy(leafDark).lerp(leafLight, e * 0.7 + t * 0.25);
        colors.push(_c.r, _c.g, _c.b);
      }
      const sw = 0.35 + t * t * 0.9;
      sways.push(sw, sw, sw);
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 3;
      const b = (i + 1) * 3;
      indices.push(a, b, a + 1, b, b + 1, a + 1, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sways, 1));
    g.setIndex(indices);
    g.computeVertexNormals();
    parts.push(g);
  }
  return parts.map((g) => finalize(g));
}

/** White glossy sanctuary: podium, glass dome ribs, lighthouse. Returns { solid, glass, lantern }. */
export function sanctuaryGeometry() {
  const white = '#ffffff';
  const aqua = color('#39d0e0');
  const solid = [];
  // Podium: rounded lathe.
  const podium = new THREE.LatheGeometry(
    [
      [0, 0], [9.6, 0], [10.2, 0.3], [10.3, 0.9], [9.9, 1.4], [9.2, 1.55], [0, 1.55],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    48,
  );
  solid.push(finalize(podium, { paint: (p, n, out) => out.set(p.y < 0.8 && Math.hypot(p.x, p.z) > 9.9 ? '#bfeff5' : white) }));
  // Dome ribs.
  const domeR = 7;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const th = (i / 12) * (Math.PI / 2) * 0.97;
      pts.push(new THREE.Vector3(Math.cos(a) * Math.cos(th) * domeR, 1.55 + Math.sin(th) * domeR, Math.sin(a) * Math.cos(th) * domeR));
    }
    solid.push(finalize(taperedTube(new THREE.CatmullRomCurve3(pts), 16, 5, () => 0.16), { paint: white }));
  }
  for (const [y, r, tube] of [[1.7, domeR, 0.28], [1.55 + domeR * 0.5, domeR * 0.866, 0.12]]) {
    const ring = new THREE.TorusGeometry(r, tube, 6, 48);
    place(ring, { position: [0, y, 0], rotation: [Math.PI / 2, 0, 0] });
    solid.push(finalize(ring, { paint: white }));
  }
  const cap = new THREE.SphereGeometry(0.75, 16, 8);
  place(cap, { position: [0, 1.55 + domeR, 0] });
  solid.push(finalize(cap, { paint: white }));
  // Inner tree (seen through the glass).
  const tree = blob({ radius: 2.6, detail: 2, squash: [1, 0.9, 1], amount: 0.25, seed: 77 });
  place(tree, { position: [0.5, 4.2, 0] });
  solid.push(finalize(tree, { paint: (p, n, out) => out.set('#4fc24a').lerp(color('#c8ff7a'), Math.max(0, n.y) * 0.5) }));
  // Lighthouse.
  const lx = 11.5;
  const lz = 2;
  const tower = new THREE.LatheGeometry(
    [
      [0, 0], [2.1, 0], [2.2, 0.6], [1.75, 1.0], [1.15, 15.5], [1.7, 15.6], [1.75, 16.1], [0.95, 16.2], [0.95, 16.3], [0, 16.3],
    ].map(([x, y]) => new THREE.Vector2(x, y)),
    28,
  );
  place(tower, { position: [lx, 1.0, lz] });
  solid.push(
    finalize(tower, {
      paint: (p, n, out) => {
        const y = p.y - 1;
        const band = (y > 4.2 && y < 5.4) || (y > 9.2 && y < 10.4) ? 1 : 0;
        out.set(white).lerp(aqua, band);
      },
    }),
  );
  const roof = new THREE.LatheGeometry(
    [[0, 3.1], [0.35, 2.9], [1.25, 1.3], [1.5, 0.1], [1.2, 0], [0, 0]].map(([x, y]) => new THREE.Vector2(x, y)),
    24,
  );
  place(roof, { position: [lx, 1.0 + 16.3 + 2.0, lz] });
  solid.push(finalize(roof, { paint: (p, n, out) => out.set(p.y > 1.0 + 16.3 + 2.0 + 1.2 ? '#ffffff' : '#2bb7d6') }));
  const lantern = new THREE.CylinderGeometry(0.85, 0.95, 2.0, 16, 1, true);
  place(lantern, { position: [lx, 1.0 + 16.3 + 1.0, lz] });
  // Wave-shaped white canopy arch beside the dome.
  const arch = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-8, 1.5, 4), new THREE.Vector3(-11, 6, 1), new THREE.Vector3(-12.5, 7.5, -3), new THREE.Vector3(-10, 4, -7), new THREE.Vector3(-7.5, 1.5, -6),
  ]);
  solid.push(finalize(taperedTube(arch, 30, 6, (t) => 0.35 + 0.15 * Math.sin(t * Math.PI)), { paint: white }));
  const glassDome = new THREE.SphereGeometry(domeR - 0.05, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  place(glassDome, { position: [0, 1.55, 0] });
  return { solid, glass: glassDome, lantern };
}

/** Small sailboat: hull, cabin, mast, main + jib. */
export function sailboatGeometry() {
  const parts = [];
  const hull = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  place(hull, { scale: [0.95, 0.75, 3.2] });
  parts.push(finalize(hull, { paint: (p, n, out) => out.set(p.y > -0.18 ? '#26b3d9' : '#ffffff') }));
  const deck = new THREE.CircleGeometry(1, 18);
  place(deck, { rotation: [-Math.PI / 2, 0, 0], scale: [0.93, 3.15, 1] });
  parts.push(finalize(deck, { paint: '#f3e3c0' }));
  const cabin = blob({ radius: 0.6, detail: 1, squash: [1, 0.55, 1.8], amount: 0.02, seed: 4 });
  place(cabin, { position: [0, 0.2, -0.2] });
  parts.push(finalize(cabin, { paint: '#ffffff' }));
  const mast = new THREE.CylinderGeometry(0.05, 0.07, 7.5, 6);
  place(mast, { position: [0, 3.75, 0.6] });
  parts.push(finalize(mast, { paint: '#e9eef2' }));
  const sail = (pts, paint, belly) => {
    const [a, b, c] = pts.map((v) => new THREE.Vector3(...v));
    const n = 6;
    const positions = [];
    const indices = [];
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const v = j / n;
        const w = 1 - u - v;
        const q = new THREE.Vector3().addScaledVector(a, w).addScaledVector(b, u).addScaledVector(c, v);
        q.x += belly * u * v * w * 6;
        positions.push(q.x, q.y, q.z);
      }
    }
    let idx = 0;
    const rowStart = [];
    for (let i = 0; i <= n; i++) {
      rowStart.push(idx);
      idx += n - i + 1;
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        const p0 = rowStart[i] + j;
        const p1 = rowStart[i + 1] + j;
        indices.push(p0, p1, p0 + 1);
        if (j < n - i - 1) indices.push(p1, p1 + 1, p0 + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return finalize(g, { paint });
  };
  parts.push(sail([[0, 0.9, 0.5], [0, 7.3, 0.6], [0, 0.9, -2.6]], '#ffffff', 0.6));
  parts.push(sail([[0, 0.8, 0.75], [0, 6.6, 0.7], [0, 0.6, 3.0]], (p, n, out) => out.set(p.y < 2.2 ? '#2bc4e4' : '#ffffff'), -0.5));
  return merge(parts);
}

/** Gull with an M-shaped wing; aSway encodes signed span (wing tip = ±1). */
export function gullGeometry() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.16, 10, 6);
  place(body, { scale: [0.8, 0.75, 2.4] });
  parts.push(finalize(body, { paint: '#ffffff', sway: 0 }));
  const head = new THREE.SphereGeometry(0.12, 8, 6);
  place(head, { position: [0, 0.07, 0.36] });
  parts.push(finalize(head, { paint: '#ffffff', sway: 0 }));
  const beak = new THREE.ConeGeometry(0.03, 0.12, 5);
  place(beak, { position: [0, 0.05, 0.5], rotation: [Math.PI / 2, 0, 0] });
  parts.push(finalize(beak, { paint: '#ffc23a', sway: 0 }));
  for (const s of [-1, 1]) {
    // Inner + outer panel strip: leading edge / trailing edge pairs.
    const lead = [[0.05, 0.02, 0.12], [0.45, 0.16, 0.12], [1.05, 0.0, -0.08]];
    const trail = [[0.05, 0.0, -0.18], [0.45, 0.12, -0.22], [1.05, -0.02, -0.16]];
    const positions = [];
    const sways = [];
    const colors = [];
    for (let i = 0; i < 3; i++) {
      for (const e of [lead[i], trail[i]]) {
        positions.push(e[0] * s, e[1], e[2]);
        sways.push((e[0] / 1.05) * s);
        _c.set(i === 2 ? '#3a4552' : i === 1 ? '#c9d4de' : '#e6edf2');
        colors.push(_c.r, _c.g, _c.b);
      }
    }
    const idx = s > 0 ? [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4] : [0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sways, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(finalize(g));
  }
  return merge(parts);
}
