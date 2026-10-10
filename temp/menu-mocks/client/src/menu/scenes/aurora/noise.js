import { makeRandom } from '../../shared/random.js';

// Small 2D gradient noise for building terrain on the CPU. Output ~[-1, 1].
export function makeNoise2D(seed = 1) {
  const rand = makeRandom(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand.next() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint16Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rand.next() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const grad = (h, dx, dy) => gx[h] * dx + gy[h] * dy;
  return function noise(x, y) {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const fx = x - X;
    const fy = y - Y;
    const xi = X & 255;
    const yi = Y & 255;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = perm[xi] + yi;
    const b = perm[xi + 1] + yi;
    const n00 = grad(perm[a], fx, fy);
    const n10 = grad(perm[b], fx - 1, fy);
    const n01 = grad(perm[a + 1], fx, fy - 1);
    const n11 = grad(perm[b + 1], fx - 1, fy - 1);
    const nx0 = n00 + (n10 - n00) * u;
    const nx1 = n01 + (n11 - n01) * u;
    return (nx0 + (nx1 - nx0) * v) * 1.45;
  };
}

export function fbm(noise, x, y, octaves = 5, lacunarity = 2.03, gain = 0.5) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f + i * 17.3, y * f - i * 9.1);
    f *= lacunarity;
    amp *= gain;
  }
  return sum;
}

// Ridged multifractal: sharp crests, soft valleys. Output ~[0, 1].
export function ridged(noise, x, y, octaves = 6) {
  let sum = 0;
  let amp = 0.55;
  let f = 1;
  let prev = 1;
  for (let i = 0; i < octaves; i++) {
    let v = 1 - Math.abs(noise(x * f + i * 31.7, y * f + i * 11.3));
    v *= v;
    sum += v * amp * (0.35 + 0.65 * prev);
    prev = v;
    f *= 2.07;
    amp *= 0.5;
  }
  return sum;
}
