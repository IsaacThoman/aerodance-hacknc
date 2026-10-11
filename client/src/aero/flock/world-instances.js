import { Group, InstancedMesh, Matrix4 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static World LOD populations. Supply Matrix4 transforms in glTF Y-up meters.
// Combine the component pivots by material once, then share that geometry among
// every instance. Use separate populations for spatially cullable map regions.
export function createFlockInstances(source, transforms) {
  if (!transforms.length) throw new Error('At least one instance transform is required.');
  source.updateWorldMatrix(true, true);
  const rootInverse = source.matrixWorld.clone().invert();
  const batches = new Map();
  source.traverseVisible(object => {
    if (!object.isMesh) return;
    if (Array.isArray(object.material)) throw new Error('Expected a single material per World LOD mesh.');
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(new Matrix4().multiplyMatrices(rootInverse, object.matrixWorld));
    // The World LOD uses untextured materials. Strip unused attributes so meshes
    // with different export UV layouts can share a compatible geometry batch.
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    }
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    geometry.clearGroups();
    if (!batches.has(object.material)) batches.set(object.material, []);
    batches.get(object.material).push(geometry);
  });
  const group = new Group();
  group.name = 'Flock world instances';
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries, false);
    for (const part of geometries) part.dispose();
    if (!geometry) throw new Error('Could not merge World LOD geometry.');
    const mesh = new InstancedMesh(geometry, material, transforms.length);
    transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  group.userData.instanceCount = transforms.length;
  return group;
}

// These batches own their merged geometries; source materials remain shared.
export function disposeFlockInstances(group) {
  group.removeFromParent();
  for (const mesh of [...group.children]) {
    mesh.dispose();
    mesh.geometry.dispose();
    group.remove(mesh);
  }
}
