import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Material 0 is rock, material 1 is snow. Both sections share the same rim;
// a full mountain cone underneath a snow cone would fight for depth at distance.
export function createMountainGeometry(radius, height) {
  const snowHeight = height * 0.3, rimRadius = radius * 0.3;
  const rock = new THREE.CylinderGeometry(rimRadius, radius, height - snowHeight, 7, 1, true);
  rock.translate(0, -snowHeight / 2, 0);
  const snow = new THREE.ConeGeometry(rimRadius, snowHeight, 7, 1, true);
  snow.translate(0, (height - snowHeight) / 2, 0);
  const geometry = mergeGeometries([rock, snow], true);
  rock.dispose(); snow.dispose();
  return geometry;
}
