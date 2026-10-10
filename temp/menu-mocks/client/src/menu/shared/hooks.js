import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { damp } from './random.js';

// The canvas buffer is 640x480 but displayed at 16:9, so cameras project at
// 16:9 and the stretch restores correct proportions (anamorphic, like the Wii).
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

/**
 * Scene camera that becomes the default camera while mounted.
 *
 * Props: position, target, fov, near, far, and optional rig settings:
 *   parallax: [x, y] world-unit offset applied from pointer position
 *   sway: [x, y, z] amplitude of slow idle drift
 *   swaySpeed: drift speed multiplier
 *   onFrame(camera, state, delta): custom per-frame control after the rig
 */
export function SceneCamera({
  position = [0, 0, 10],
  target = [0, 0, 0],
  fov = 45,
  near = 0.1,
  far = 4000,
  parallax = [0.4, 0.25],
  sway = [0.15, 0.08, 0],
  swaySpeed = 1,
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
    const t = state.clock.elapsedTime * swaySpeed;
    smooth.current.x = damp(smooth.current.x, state.pointer.x, 2.5, delta);
    smooth.current.y = damp(smooth.current.y, state.pointer.y, 2.5, delta);
    camera.position.set(
      base.current.x + Math.sin(t * 0.21) * sway[0] + smooth.current.x * parallax[0],
      base.current.y + Math.sin(t * 0.17 + 1.3) * sway[1] + smooth.current.y * parallax[1],
      base.current.z + Math.sin(t * 0.13 + 2.1) * sway[2],
    );
    camera.lookAt(look.current);
    onFrame?.(camera, state, delta);
  });

  return null;
}

// Shared music clock so beat-reactive scenes stay in sync with each other.
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

// Cursor feedback for in-engine buttons.
export function setCursor(pointer) {
  document.body.style.cursor = pointer ? 'pointer' : '';
}
