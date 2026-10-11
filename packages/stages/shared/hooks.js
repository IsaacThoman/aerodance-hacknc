import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { damp } from './random.js';

// The canvas buffer is 640x480 but displayed at 16:9, so cameras project at
// 16:9 and the stretch restores correct proportions.
export const ASPECT = 16 / 9;

// Create something disposable (geometry, material, texture, render target) once
// and dispose of it when the component unmounts or deps change.
export function useDisposable(factory, deps = []) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(factory, deps);
  useEffect(() => () => disposeDeep(value), [value]);
  return value;
}

export function disposeDeep(value) {
  if (!value) return;
  if (Array.isArray(value)) return value.forEach(disposeDeep);
  if (typeof value.dispose === 'function') return value.dispose();
  if (typeof value === 'object' && value.constructor === Object) Object.values(value).forEach(disposeDeep);
}

// Extra yaw (radians) around every stage camera's target, on top of its own swing. The game
// turns it to circle the dancers in Song Select's preview and back to 0 for the song.
export const stageOrbit = { yaw: 0 };

/**
 * Stage camera that becomes the default camera while mounted.
 *
 *   position, target, fov, near, far
 *   orbit: [yawAmplitude, pitchAmplitude] radians of slow swing around the target
 *   orbitSpeed: swing speed multiplier
 *   sway: [x, y, z] world-unit idle drift
 *   parallax: [x, y] world-unit offset from the pointer
 *   onFrame(camera, state, delta): custom control after the rig
 */
export function StageCamera({
  position = [0, 4.2, 13.5],
  target = [0, 1.7, 0],
  fov = 40,
  near = 0.1,
  far = 2000,
  orbit = [0.12, 0.03],
  orbitSpeed = 1,
  sway = [0.08, 0.05, 0],
  parallax = [0.35, 0.2],
  onFrame,
}) {
  const set = useThree((s) => s.set);
  const get = useThree((s) => s.get);
  const camera = useMemo(() => {
    const cam = new THREE.PerspectiveCamera(fov, ASPECT, near, far);
    cam.manual = true;
    return cam;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const base = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const smooth = useRef(new THREE.Vector2());
  const offset = useRef(new THREE.Vector3());
  const spherical = useRef(new THREE.Spherical());

  useLayoutEffect(() => {
    camera.fov = fov;
    camera.near = near;
    camera.far = far;
    camera.aspect = ASPECT;
    camera.updateProjectionMatrix();
    base.current.set(...position);
    look.current.set(...target);
    camera.position.copy(base.current);
    camera.lookAt(look.current);
  }, [camera, fov, near, far, ...position, ...target]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const previous = get().camera;
    set({ camera });
    return () => set({ camera: previous });
  }, [camera, get, set]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    smooth.current.x = damp(smooth.current.x, state.pointer.x, 2.5, delta);
    smooth.current.y = damp(smooth.current.y, state.pointer.y, 2.5, delta);
    // Slow orbit around the target, like a crane drifting around the dancers.
    offset.current.subVectors(base.current, look.current);
    const s = spherical.current.setFromVector3(offset.current);
    s.theta += Math.sin(t * 0.11 * orbitSpeed) * orbit[0] + stageOrbit.yaw;
    s.phi = THREE.MathUtils.clamp(s.phi + Math.sin(t * 0.07 * orbitSpeed + 1.1) * orbit[1], 0.05, Math.PI - 0.05);
    offset.current.setFromSpherical(s);
    camera.position.copy(look.current).add(offset.current);
    camera.position.x += Math.sin(t * 0.21) * sway[0] + smooth.current.x * parallax[0];
    camera.position.y += Math.sin(t * 0.17 + 1.3) * sway[1] + smooth.current.y * parallax[1];
    camera.position.z += Math.sin(t * 0.13 + 2.1) * sway[2];
    camera.lookAt(look.current);
    onFrame?.(camera, state, delta);
  });

  return null;
}

// Shared music clock so beat-reactive lights stay in sync across a stage.
// The capture is silent, so this is a steady 118 bpm pulse.
export const beat = { bpm: 118, time: 0, beat: 0, phase: 0, pulse: 0, bar: 0 };

export function tickBeat(delta) {
  beat.time += delta;
  const b = (beat.time * beat.bpm) / 60;
  beat.beat = Math.floor(b);
  beat.phase = b - beat.beat;
  beat.bar = Math.floor(beat.beat / 4);
  // 1 on the beat, decaying quickly.
  beat.pulse = Math.exp(-beat.phase * 6);
}

// Respect reduced motion for big ambient movement (dancers pause separately).
export const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
