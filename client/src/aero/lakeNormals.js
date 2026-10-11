// Generate the same seamless ripple field without evaluating a cosine per texel
// per wave. cos(x + y) = cos(x)cos(y) - sin(x)sin(y); the Float32 accumulators
// retain the original rounding between waves.
export function createLakeNormalPixels(size, waves, pixels = new Uint8ClampedArray(size * size * 4)) {
  const hx = new Float32Array(size * size), hy = new Float32Array(size * size);
  const cosX = new Float64Array(size), sinX = new Float64Array(size);
  for (const [kx, ky, phase, amplitude] of waves) {
    const fx = kx * Math.PI * 2 / size, fy = ky * Math.PI * 2 / size;
    for (let x = 0; x < size; x++) {
      cosX[x] = Math.cos(fx * x);
      sinX[x] = Math.sin(fx * x);
    }
    for (let y = 0; y < size; y++) {
      const cosY = Math.cos(fy * y + phase), sinY = Math.sin(fy * y + phase);
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const value = (cosX[x] * cosY - sinX[x] * sinY) * amplitude;
        hx[row + x] += value * kx;
        hy[row + x] += value * ky;
      }
    }
  }
  for (let i = 0; i < size * size; i++) {
    const nx = -hx[i] * 0.09, ny = -hy[i] * 0.09, length = Math.hypot(nx, ny, 1);
    pixels[i * 4] = (nx / length * 0.5 + 0.5) * 255;
    pixels[i * 4 + 1] = (ny / length * 0.5 + 0.5) * 255;
    pixels[i * 4 + 2] = (1 / length * 0.5 + 0.5) * 255;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}
