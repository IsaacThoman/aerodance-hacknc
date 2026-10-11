// Deterministic randomness so every scene lays out the same way on each load.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRandom(seed = 1) {
  const rand = mulberry32(seed);
  return {
    next: rand,
    range: (min, max) => min + (max - min) * rand(),
    int: (min, max) => Math.floor(min + (max - min + 1) * rand()),
    pick: (list) => list[Math.floor(rand() * list.length)],
    sign: () => (rand() < 0.5 ? -1 : 1),
    chance: (p) => rand() < p,
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
// Frame-rate independent exponential approach.
export const damp = (current, target, lambda, delta) =>
  lerp(current, target, 1 - Math.exp(-lambda * delta));
