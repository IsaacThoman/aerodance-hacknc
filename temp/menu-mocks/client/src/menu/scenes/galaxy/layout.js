import * as THREE from 'three';

// Menu entries and the galaxy objects they are linked to. `pos` is the world
// position, `radius` the framing radius used by the camera and tooltip.
export const TARGETS = [
  {
    id: 'play',
    label: 'Play',
    icon: 'play',
    caption: 'Launch Star',
    planet: 'Launch Star',
    sub: 'Blast off to the dance floor!',
    stars: null,
    color: '#ffd84a',
    deep: '#c77a00',
    pos: [3.2, 3.6, 4],
    radius: 2.0,
    bob: [0.22, 0.9, 0],
    view: [-0.4, 0.08, 1],
    distance: 4.6,
  },
  {
    id: 'story',
    label: 'Story Galaxy',
    icon: 'star',
    caption: 'Melody Meadow',
    planet: 'Melody Meadow Planet',
    sub: 'Chapter 1 · where the music sprouts',
    stars: [3, 5],
    color: '#8be36a',
    deep: '#2f8a3a',
    pos: [6.6, -3.6, 6],
    radius: 3.4,
    bob: [0.18, 0.55, 1.2],
    view: [0.25, 0.55, 1],
    distance: 3.9,
  },
  {
    id: 'songs',
    label: 'Songs',
    icon: 'music',
    caption: 'Sugarbeat Swirl',
    planet: 'Sugarbeat Swirl Planet',
    sub: '48 songs · sweet & sticky beats',
    stars: [4, 5],
    color: '#ff8cc6',
    deep: '#c23a7d',
    pos: [-3.4, -4.6, -1],
    radius: 2.05,
    bob: [0.25, 0.7, 2.4],
    view: [0.35, 0.25, 1],
    distance: 4.4,
  },
  {
    id: 'online',
    label: 'Online',
    icon: 'globe',
    caption: 'Harmony Ring Giant',
    planet: 'Harmony Ring Giant',
    sub: 'Dance with stars across the galaxy',
    stars: [2, 5],
    color: '#b9a2ff',
    deep: '#5a3cc4',
    pos: [42, 21, -82],
    radius: 15,
    bob: [0.4, 0.2, 0.7],
    view: [-0.25, 0.12, 1],
    distance: 3.0,
  },
  {
    id: 'wardrobe',
    label: 'Wardrobe',
    icon: 'shirt',
    caption: 'Crystal Tide',
    planet: 'Crystal Tide Planet',
    sub: 'Shimmering outfits & accessories',
    stars: [1, 5],
    color: '#6fe6ff',
    deep: '#1678c8',
    pos: [21, 0.5, -10],
    radius: 3.0,
    bob: [0.25, 0.5, 3.1],
    view: [-0.35, 0.25, 1],
    distance: 4.2,
  },
  {
    id: 'options',
    label: 'Options',
    icon: 'gear',
    caption: 'Starshine Observatory',
    planet: 'Starshine Observatory',
    sub: 'Tune your telescope & settings',
    stars: [5, 5],
    color: '#ffb879',
    deep: '#c4622a',
    pos: [-3.7, 3.7, 0.5],
    radius: 2.4,
    bob: [0.2, 0.8, 4.0],
    view: [0.3, 0.35, 1],
    distance: 4.4,
  },
];

export const TARGET_INDEX = Object.fromEntries(TARGETS.map((t, i) => [t.id, i]));

/** World position of target i at time t (includes its gentle bob). */
export function targetPosition(i, t, out = new THREE.Vector3()) {
  const tg = TARGETS[i];
  const [amp, speed, phase] = tg.bob;
  return out.set(tg.pos[0], tg.pos[1] + Math.sin(t * speed + phase) * amp, tg.pos[2]);
}

export const OVERVIEW = {
  position: new THREE.Vector3(0, 1.2, 30),
  target: new THREE.Vector3(0, 0.4, 0),
};

/**
 * Shared, mutable scene state (not React state, read every frame).
 * hover/locked: entry indices (-1 none). focus: the target being framed.
 * glow[i]: smoothed 0..1 highlight per target. punch[i]: click time (bounce + sparkle burst).
 * bursts: pooled sparkle pops for collected star bits.
 */
export function createGalaxyState() {
  return {
    hover: -1,
    locked: -1,
    focus: -1,
    glow: new Float32Array(TARGETS.length),
    punch: new Float32Array(TARGETS.length).fill(-100),
    starBits: 128,
    collectedAt: -10,
    bursts: Array.from({ length: 6 }, () => ({ origin: new THREE.Vector3(), t0: -10, color: new THREE.Color() })),
    burstIndex: 0,
    listeners: new Set(),
    emit() {
      this.listeners.forEach((fn) => fn());
    },
  };
}
