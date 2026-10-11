// The production scene's fixed seed and 48 original wave coefficients.
export function lakeWaves() {
  let seed = 8080;
  const random = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 48 }, () => {
    const k = 2 + Math.floor(random() ** 2 * 40), angle = random() * Math.PI * 2;
    return [Math.round(Math.cos(angle) * k), Math.round(Math.sin(angle) * k), random() * Math.PI * 2, 1 / k ** 1.1];
  });
}

// Direct per-texel formula from aeroBackground.js before the performance audit.
export function referenceLakeNormalPixels(size, waves) {
  const hx = new Float32Array(size * size), hy = new Float32Array(size * size);
  for (const [kx, ky, phase, amplitude] of waves) {
    const fx = kx * Math.PI * 2 / size, fy = ky * Math.PI * 2 / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const value = Math.cos(fx * x + fy * y + phase) * amplitude;
      hx[y * size + x] += value * kx;
      hy[y * size + x] += value * ky;
    }
  }
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const nx = -hx[i] * 0.09, ny = -hy[i] * 0.09, length = Math.hypot(nx, ny, 1);
    pixels[i * 4] = (nx / length * 0.5 + 0.5) * 255;
    pixels[i * 4 + 1] = (ny / length * 0.5 + 0.5) * 255;
    pixels[i * 4 + 2] = (1 / length * 0.5 + 0.5) * 255;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}
