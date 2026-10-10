import * as THREE from 'three';

// Golden-hour palette for the Cloud Stage (sRGB hex; THREE.Color converts to linear).
export const SKY = {
  zenith: '#2f86e6',
  upper: '#6fa3ee',
  lilac: '#b39be6',
  pink: '#f58fb8',
  peach: '#ffad8a',
  gold: '#ffd48f',
  sun: '#fff0c8',
  haze: '#f2b9c4',
};

const elevation = THREE.MathUtils.degToRad(5);
const azimuth = THREE.MathUtils.degToRad(27);
// Direction *towards* the sun (azimuth 0 = straight ahead, -z).
export const SUN_DIR = new THREE.Vector3(
  Math.sin(azimuth) * Math.cos(elevation),
  Math.sin(elevation),
  -Math.cos(azimuth) * Math.cos(elevation),
).normalize();

export const CLOUD_Y = -22;

// Featured songs shown in the carousel; each one re-themes the stage lights.
export const SONGS = [
  {
    title: 'Sunset Satellite',
    artist: 'Aqua Lumen',
    bpm: 118,
    stars: 3,
    colors: ['#ff7eb6', '#ffc86b', '#7fe3ff'],
    art: 'sun',
  },
  {
    title: 'Bubblegum Skyline',
    artist: 'The Glass Kites',
    bpm: 124,
    stars: 2,
    colors: ['#ff6fcf', '#b78bff', '#ffe066'],
    art: 'bubbles',
  },
  {
    title: 'Crystal Breeze',
    artist: 'Nova Marina',
    bpm: 110,
    stars: 1,
    colors: ['#3fe0d0', '#7fd8ff', '#c8ff9a'],
    art: 'waves',
  },
  {
    title: 'Neon Cumulus',
    artist: 'DJ Halcyon',
    bpm: 128,
    stars: 4,
    colors: ['#8a7bff', '#4fc3ff', '#ff8ad8'],
    art: 'stars',
  },
  {
    title: 'Chrome Hearts Club',
    artist: 'Pixel Dolphins',
    bpm: 132,
    stars: 5,
    colors: ['#ff9a3d', '#ff5f8f', '#ffe9a0'],
    art: 'hearts',
  },
];

// Mutable scene state shared between the world and the menu.
export const show = {
  song: 0,
  // Current stage light colors, eased towards the featured song's palette.
  colors: [new THREE.Color(SONGS[0].colors[0]), new THREE.Color(SONGS[0].colors[1]), new THREE.Color(SONGS[0].colors[2])],
  // Seconds since the DANCE! orb was last pressed (large = idle).
  burst: 99,
  // 0..1 eased hover on the DANCE! orb.
  hype: 0,
  hypeTarget: 0,
};

export function resetShow() {
  show.burst = 99;
  show.hype = 0;
  show.hypeTarget = 0;
  for (let i = 0; i < 3; i++) show.colors[i].set(SONGS[show.song].colors[i]);
}

const tmp = new THREE.Color();
export function tickShow(delta) {
  const target = SONGS[show.song].colors;
  for (let i = 0; i < 3; i++) {
    tmp.set(target[i]);
    show.colors[i].lerp(tmp, 1 - Math.exp(-3 * delta));
  }
  show.burst += delta;
  show.hype += (show.hypeTarget - show.hype) * (1 - Math.exp(-6 * delta));
}
