import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { createAeroWorld } from './aeroBackground.js';

/**
 * Puts the Aero drone flight inside the surrounding <Canvas>.
 * It drives the default camera and renders the frame itself (useFrame priority 1),
 * so it uses whatever buffer size the Canvas has, e.g. a fixed 640x480.
 *
 * <AeroWorld speed={1} quality="auto" onTelemetry={(t) => ...} />
 */
export default function AeroWorld({ speed = 1, quality = 'auto', onTelemetry }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const worldRef = useRef(null);
  const shownRef = useRef(false);
  const teleRef = useRef(onTelemetry);
  teleRef.current = onTelemetry;

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.style.transition = 'opacity 1.2s ease';
    canvas.style.opacity = '0';
    shownRef.current = false;
    let world = null;
    // Deferred one tick so StrictMode's mount/unmount/mount only builds the scene once.
    const timer = setTimeout(() => {
      world = createAeroWorld({ renderer: gl, scene, camera, speed, quality, onTelemetry: (t) => teleRef.current?.(t) });
      worldRef.current = world;
    }, 0);
    return () => {
      clearTimeout(timer);
      world?.dispose();
      worldRef.current = null;
    };
    // Rebuilding is expensive; speed changes go through setSpeed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, quality]);

  useEffect(() => { worldRef.current?.setSpeed(speed); }, [speed]);

  useFrame((_, delta) => {
    const world = worldRef.current;
    if (!world) return;
    world.update(delta);
    world.render();
    if (!shownRef.current) { shownRef.current = true; gl.domElement.style.opacity = '1'; }
  }, 1);

  return null;
}
