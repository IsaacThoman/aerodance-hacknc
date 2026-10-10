import { createContext, useContext, useState } from 'react';
import { createPortal } from '@react-three/fiber';
import * as THREE from 'three';

// HUD coordinates are virtual pixels: 1280x720, origin at the center, +y up.
// They map onto the 640x480 buffer, which is displayed at 16:9.
export const HUD_WIDTH = 1280;
export const HUD_HEIGHT = 720;
export const HUD_LEFT = -HUD_WIDTH / 2;
export const HUD_RIGHT = HUD_WIDTH / 2;
export const HUD_TOP = HUD_HEIGHT / 2;
export const HUD_BOTTOM = -HUD_HEIGHT / 2;

const HudContext = createContext(null);

export function useHudLayer() {
  // useState (not useMemo) so Fast Refresh keeps the same layer; swapping it
  // mid-session orphans portal children rendered into the old scene.
  const [layer] = useState(() => {
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(HUD_LEFT, HUD_RIGHT, HUD_TOP, HUD_BOTTOM, -1000, 1000);
    camera.manual = true;
    camera.position.z = 100;
    camera.updateProjectionMatrix();
    return { scene, camera };
  });
  return layer;
}

export function HudProvider({ layer, children }) {
  return <HudContext.Provider value={layer}>{children}</HudContext.Provider>;
}

/** Renders children into the HUD layer: orthographic, drawn after post-processing. */
export function Hud({ children }) {
  const layer = useContext(HudContext);
  return createPortal(children, layer.scene, { camera: layer.camera, events: { priority: 10 } });
}
