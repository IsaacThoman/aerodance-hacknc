import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { targetPosition } from './layout.js';

/**
 * Common rig for a galaxy object linked to a menu entry:
 * outer group bobs at the target position and does a springy "boing" when
 * its entry is clicked; `tilt` orients the axis; children spin around local Y.
 * `still` children share the tilt but don't spin (halo, moons).
 * Every material in `materials` gets uTime and uFocus updated.
 */
export function PlanetRoot({ index, state, tilt = [0, 0, 0], spin = 0.05, materials = [], still = null, onFrame, children }) {
  const outer = useRef();
  const spinner = useRef();
  useFrame((s, delta) => {
    const t = s.clock.elapsedTime;
    const g = outer.current;
    targetPosition(index, t, g.position);
    const since = t - state.punch[index];
    const boing = since >= 0 && since < 2 ? Math.exp(-since * 4.5) * Math.sin(since * 19) * 0.11 : 0;
    g.scale.set(1 + boing, 1 - boing * 0.8, 1 + boing);
    spinner.current.rotation.y += spin * delta * (1 + state.glow[index] * 1.5);
    const focus = state.glow[index];
    for (const m of materials) {
      if (!m) continue;
      if (m.uniforms.uTime) m.uniforms.uTime.value = t;
      if (m.uniforms.uFocus) m.uniforms.uFocus.value = focus;
    }
    onFrame?.(t, delta, focus);
  });
  return (
    <group ref={outer}>
      <group rotation={tilt}>
        <group ref={spinner}>{children}</group>
        {still}
      </group>
    </group>
  );
}
