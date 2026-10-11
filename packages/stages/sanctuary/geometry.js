import * as THREE from 'three';

// Geometry accumulation helpers. Static scenery is merged into a few buffers
// that share one material; per-vertex attributes pick the surface kind.

export const KIND = { GLASS: 0, PAINT: 1, LEAF: 2, SOLAR: 3, GROUND: 4, EMIT: 5 };

const DEFAULT_FA = [0, 0, 0, 0];

export const PAINT = (rough = 0.3, metal = 0.05) => [KIND.PAINT, 0, rough, metal];
export const LEAF = [KIND.LEAF, 0, 0, 0];
export const SOLAR = [KIND.SOLAR, 0, 0, 0];
// Emissive accents: strength, blink, beat-reactive.
export const EMIT = (strength, blink = false, beat = false) => [KIND.EMIT, blink ? 1 : 0, beat ? 1 : 0, strength];

export class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.fa = [];
    this.st = [];
    this.idx = [];
  }

  get count() {
    return this.pos.length / 3;
  }

  vertex(p, n, uv, col, fa, st) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.col.push(col[0], col[1], col[2]);
    this.fa.push(fa[0], fa[1], fa[2], fa[3]);
    this.st.push(st[0], st[1], st[2], st[3]);
    return this.count - 1;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  /** Append a three.js geometry transformed by `matrix`; color may be fn(pos, normal). */
  add(geometry, matrix, { color = [1, 1, 1], fa = DEFAULT_FA, st = PAINT(), uvScale = [1, 1], flip = false } = {}) {
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    const u = geometry.attributes.uv;
    const base = this.count;
    const v = new THREE.Vector3();
    const nv = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      if (n) nv.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      else nv.set(0, 1, 0);
      const c = typeof color === 'function' ? color(v, nv) : color;
      this.vertex(
        [v.x, v.y, v.z],
        flip ? [-nv.x, -nv.y, -nv.z] : [nv.x, nv.y, nv.z],
        u ? [u.getX(i) * uvScale[0], u.getY(i) * uvScale[1]] : [0, 0],
        c,
        fa,
        st,
      );
    }
    const ix = geometry.index ? geometry.index.array : null;
    const n3 = ix ? ix.length : p.count;
    for (let i = 0; i < n3; i += 3) {
      const a = base + (ix ? ix[i] : i);
      const b = base + (ix ? ix[i + 1] : i + 1);
      const c = base + (ix ? ix[i + 2] : i + 2);
      if (flip) this.idx.push(a, c, b);
      else this.idx.push(a, b, c);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.fa, 4));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.st, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Superellipse radius for direction theta. n=2 ellipse, n~4 rounded rectangle. */
export function superR(theta, a, b, n) {
  const c = Math.abs(Math.cos(theta)) / a;
  const s = Math.abs(Math.sin(theta)) / b;
  return Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
}

/**
 * Loft a closed cross-section up a vertical axis.
 * section(theta, t) -> [x, z] offsets from (cx, cz) at normalized height t.
 * Facade grid uv: u counts window columns around the perimeter, v counts floors.
 */
export function loft(b, {
  cx = 0,
  cz = 0,
  y0 = 0,
  y1 = 10,
  levels = 1,
  segments = 32,
  section,
  yAt = null,
  cols = 24,
  floorH = 4,
  color = [1, 1, 1],
  fa = DEFAULT_FA,
  st = [KIND.GLASS, 0, 0, 0],
  capTop = null,
}) {
  const ring = [];
  for (let j = 0; j <= levels; j++) {
    const t = j / levels;
    const y = yAt ? yAt(t) : y0 + (y1 - y0) * t;
    const row = [];
    for (let i = 0; i < segments; i++) {
      const [x, z] = section((i / segments) * Math.PI * 2, t);
      row.push([cx + x, y, cz + z]);
    }
    ring.push(row);
  }
  const P = (i, j) => ring[Math.max(0, Math.min(levels, j))][((i % segments) + segments) % segments];
  const base = b.count;
  for (let j = 0; j <= levels; j++) {
    for (let i = 0; i <= segments; i++) {
      const p = P(i, j);
      const pa = P(i + 1, j);
      const pb = P(i - 1, j);
      const T = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
      const qa = P(i, j + 1);
      const qb = P(i, j - 1);
      const V = [qa[0] - qb[0], qa[1] - qb[1], qa[2] - qb[2]];
      // Outward normal (sections run counter-clockwise seen from above).
      let nx = V[1] * T[2] - V[2] * T[1];
      let ny = V[2] * T[0] - V[0] * T[2];
      let nz = V[0] * T[1] - V[1] * T[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const c = typeof color === 'function' ? color(p, j / levels) : color;
      b.vertex(p, [nx, ny, nz], [(i / segments) * cols, p[1] / floorH], c, fa, st);
    }
  }
  const W = segments + 1;
  for (let j = 0; j < levels; j++) {
    for (let i = 0; i < segments; i++) {
      const a = base + j * W + i;
      const bb = base + (j + 1) * W + i;
      const c = base + j * W + i + 1;
      const d = base + (j + 1) * W + i + 1;
      b.tri(a, bb, c);
      b.tri(c, bb, d);
    }
  }
  if (capTop) {
    for (const opts of Array.isArray(capTop) ? capTop : [capTop]) {
      const row = ring[levels];
      let mx = 0;
      let mz = 0;
      for (const p of row) {
        mx += p[0];
        mz += p[2];
      }
      mx /= row.length;
      mz /= row.length;
      const y = row[0][1] + (opts.lift ?? 0);
      const scale = opts.scale ?? 1;
      const col = opts.color ?? [1, 1, 1];
      const center = b.vertex([mx, y, mz], [0, 1, 0], [0, 0], col, opts.fa ?? fa, opts.st ?? st);
      const first = b.count;
      for (let i = 0; i < segments; i++) {
        const p = row[i];
        const x = mx + (p[0] - mx) * scale;
        const z = mz + (p[2] - mz) * scale;
        b.vertex([x, y, z], [0, 1, 0], [(x - mx) / 4, (z - mz) / 4], col, opts.fa ?? fa, opts.st ?? st);
      }
      for (let i = 0; i < segments; i++) b.tri(center, first + ((i + 1) % segments), first + i);
    }
  }
  return ring;
}

/**
 * Sweep a 2D profile ([x, y, nx, ny] in the plane normal to the path, x = right
 * of travel, y = up) along a 3D path.
 */
export function sweep(b, path, profile, { closed = false, color = [1, 1, 1], fa = DEFAULT_FA, st = PAINT(), uvLen = 1 } = {}) {
  const n = path.length;
  const m = profile.length;
  const base = b.count;
  const up = new THREE.Vector3(0, 1, 0);
  const T = new THREE.Vector3();
  const S = new THREE.Vector3();
  const U = new THREE.Vector3();
  let along = 0;
  const rows = closed ? n + 1 : n;
  for (let i = 0; i < rows; i++) {
    const p = path[i % n];
    if (closed) T.subVectors(path[(i + 1) % n], path[(i - 1 + n) % n]).normalize();
    else T.subVectors(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]).normalize();
    if (i > 0) along += p.distanceTo(path[(i - 1) % n]);
    S.crossVectors(T, up).normalize();
    U.crossVectors(S, T).normalize();
    for (let j = 0; j < m; j++) {
      const [sx, sy, nx, ny] = profile[j];
      const pos = [p.x + S.x * sx + U.x * sy, p.y + S.y * sx + U.y * sy, p.z + S.z * sx + U.z * sy];
      const nor = [S.x * nx + U.x * ny, S.y * nx + U.y * ny, S.z * nx + U.z * ny];
      b.vertex(pos, nor, [j / (m - 1), along / uvLen], typeof color === 'function' ? color(j, i) : color, fa, st);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < m - 1; j++) {
      const a = base + i * m + j;
      const c = base + i * m + j + 1;
      const d = base + (i + 1) * m + j;
      const e = base + (i + 1) * m + j + 1;
      // Counter-clockwise profiles (seen along the path) face outward.
      b.tri(a, d, c);
      b.tri(c, d, e);
    }
  }
}

/** Rounded-rectangle profile for sweep(), counter-clockwise. */
export function roundedProfile(w, h, r, seg = 3) {
  const pts = [];
  const corners = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, Math.PI * 1.5],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let s = 0; s <= seg; s++) {
      const a = a0 + (s / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
    }
  }
  pts.push(pts[0]);
  return pts;
}

/** Circle profile for tubes. */
export function circleProfile(r, seg = 8) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
  }
  return pts;
}

export const mat4 = (() => {
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  return (pos, rot = [0, 0, 0], scale = [1, 1, 1]) => {
    e.set(rot[0], rot[1], rot[2]);
    q.setFromEuler(e);
    p.set(pos[0], pos[1], pos[2]);
    if (typeof scale === 'number') s.set(scale, scale, scale);
    else s.set(scale[0], scale[1], scale[2]);
    return new THREE.Matrix4().compose(p, q, s);
  };
})();

export function hexToLinear(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

/**
 * Merge non-indexed copies of geometries, giving each a flat vertex color and
 * optional extra float attributes ({ name: value }). Only position/normal/color/extras are kept.
 */
export function mergeTagged(parts) {
  const prepared = parts.map(({ geometry, color = [1, 1, 1], extra = {} }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(color, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    for (const [name, value] of Object.entries(extra)) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n).fill(value), 1));
    return g;
  });
  const names = ['position', 'normal', 'color', ...Object.keys(parts[0].extra ?? {})];
  const total = prepared.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = prepared[0].attributes[name].itemSize;
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of prepared) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  prepared.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}

/** Instanced copy of a base geometry with per-instance float attributes: { name: [itemSize, Float32Array] }. */
export function instanced(base, count, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  if (base.index) g.setIndex(base.index);
  for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
  for (const [name, [size, array]] of Object.entries(attrs)) g.setAttribute(name, new THREE.InstancedBufferAttribute(array, size));
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}
