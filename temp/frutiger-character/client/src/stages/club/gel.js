import * as THREE from 'three';
import { patchClub } from './patch.js';

// Glossy gel for the aeroling blobs: clearcoat candy with a fresnel rim glow
// in its own color, like the dancers' gel but opaque and cheap.
export function gelMaterial({ key, color = '#ffffff', rim = 1.4, rimPower = 3, glow = 0.12, vertexColors = false, envMapIntensity = 0.5 } = {}) {
  return patchClub(
    new THREE.MeshPhysicalMaterial({
      color,
      vertexColors,
      roughness: 0.3,
      metalness: 0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.06,
      envMapIntensity,
    }),
    {
      key: `gel-${key}`,
      emissive: /* glsl */ `
        float fr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), ${rimPower.toFixed(1)});
        totalEmissiveRadiance += diffuseColor.rgb * (fr * ${rim.toFixed(2)} + ${glow.toFixed(3)});
      `,
    },
  );
}

export const inkMaterial = () => new THREE.MeshBasicMaterial({ color: '#020611' });
