import * as THREE from 'three';
import { beat } from '../shared/hooks.js';

// Club-wide uniforms shared by reference across every club material, so one
// update per frame drives the floor, walls, beams and screens in sync.
export const club = {
  uTime: { value: 0 },
  uBeat: { value: 0 }, // continuous beat count
  uPulse: { value: 0 }, // 1 on the beat, decaying
  uBallPos: { value: new THREE.Vector3(0, 6.0, 0.4) },
  uBallRot: { value: 0 },
  uDots: { value: 1 }, // mirror-ball dot intensity
};

export const BALL_POS = club.uBallPos.value;

export function tickClub(t) {
  club.uTime.value = t;
  club.uBeat.value = beat.beat + beat.phase;
  club.uPulse.value = beat.pulse;
  club.uBallRot.value = t * 0.22;
  club.uDots.value = 0.85 + 0.25 * beat.pulse;
}

export const beatCount = () => beat.beat + beat.phase;

// Show palette: neon on deep navy.
export const C = {
  night: '#060a26',
  aqua: '#1ee8ff',
  lime: '#9dff3a',
  magenta: '#ff3fd2',
  violet: '#8d5cff',
};

// Lime -> aqua -> blue -> violet -> magenta, ping-ponged so neighbours never
// mix into mud. Mirrors clubHue() in GLSL.
const HUES = ['#9dff3a', '#1ee8ff', '#2e8bff', '#8d5cff', '#ff3fd2'].map((c) => new THREE.Color(c));
export function hue(t, out) {
  const s = 1 - Math.abs((((t % 1) + 1) % 1) * 2 - 1);
  const x = s * (HUES.length - 1);
  const i = Math.min(Math.floor(x), HUES.length - 2);
  const f = x - i;
  return out.copy(HUES[i]).lerp(HUES[i + 1], f * f * (3 - 2 * f));
}
