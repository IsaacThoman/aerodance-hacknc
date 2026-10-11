import * as THREE from 'three';

/**
 * Small tropical fish along +z (nose at +z). Attributes:
 *   aU: 0 at the nose -> 1 at the tail tip (drives the swim wiggle)
 *   aFin: 1 on fins
 */
export function fishGeometry({ height = 0.42, width = 0.14, tailH = 0.44, tailLen = 0.22, dorsalH = 0.14, rings = 10, segs = 8 } = {}) {
  const positions = [];
  const normals = [];
  const us = [];
  const fins = [];
  const indices = [];
  const profile = (u) => (u < 0.3 ? Math.sqrt(Math.max(0, 1 - ((0.3 - u) / 0.3) ** 2)) : 1 - 0.8 * THREE.MathUtils.smoothstep((u - 0.3) / 0.7, 0, 1));
  const zAt = (u) => 0.5 - u * 0.8;
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    const p = profile(u);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const sy = Math.sin(a);
      positions.push(Math.cos(a) * (width / 2) * p, sy * (height / 2) * p, zAt(u));
      const n = new THREE.Vector3(Math.cos(a) / width, sy / height, (0.5 - u) * 0.8).normalize();
      normals.push(n.x, n.y, n.z);
      us.push(u * 0.8);
      fins.push(0);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const vert = (x, y, z, u) => {
    positions.push(x, y, z);
    normals.push(1, 0, 0);
    us.push(u);
    fins.push(1);
    return positions.length / 3 - 1;
  };
  // Forked tail.
  const z0 = zAt(1) + 0.02;
  const ped = (height / 2) * profile(1);
  const a = vert(0, ped, z0, 0.8);
  const b = vert(0, -ped, z0, 0.8);
  const c = vert(0, tailH / 2, z0 - tailLen, 1);
  const d = vert(0, 0, z0 - tailLen * 0.55, 0.95);
  const e = vert(0, -tailH / 2, z0 - tailLen, 1);
  indices.push(a, c, d, a, d, b, b, d, e);
  // Dorsal fin.
  const f0 = vert(0, (height / 2) * 0.92, zAt(0.2), 0.2);
  const f1 = vert(0, (height / 2) * 0.55, zAt(0.75), 0.6);
  const f2 = vert(0, height / 2 + dorsalH, zAt(0.62), 0.5);
  indices.push(f0, f2, f1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
  g.setAttribute('aFin', new THREE.Float32BufferAttribute(fins, 1));
  g.setIndex(indices);
  return g;
}

// Fish palettes: body, accent, pattern (0 plain, 1 bands, 2 stripe).
export const SPECIES = [
  { body: '#ffc21a', accent: '#fff2a0', pattern: 0, size: 0.62, weight: 3 }, // yellow tang
  { body: '#1f5cff', accent: '#ffd21a', pattern: 2, size: 0.66, weight: 3 }, // blue tang
  { body: '#ff6a12', accent: '#ffffff', pattern: 1, size: 0.42, weight: 3 }, // clownfish
  { body: '#16e0ff', accent: '#ff3fbf', pattern: 2, size: 0.36, weight: 5 }, // neon tetra
  { body: '#e8f4ff', accent: '#20263a', pattern: 1, size: 0.7, weight: 2 }, // angelfish
  { body: '#ff5fc8', accent: '#ffe0f4', pattern: 0, size: 0.5, weight: 2 }, // pink anthias
];
