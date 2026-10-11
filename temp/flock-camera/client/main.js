import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e4e9ed');
scene.fog = new THREE.Fog('#e4e9ed', 12, 32);
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, .04);
scene.environment = environment.texture;
room.dispose();
pmrem.dispose();
const camera = new THREE.PerspectiveCamera(37, innerWidth / innerHeight, .002, 80);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = .08;
controls.minDistance = .08;
controls.maxDistance = 12;
controls.autoRotateSpeed = .55;
controls.maxPolarAngle = Math.PI * .91;
const key = new THREE.DirectionalLight(0xffead2, 3.2);
key.position.set(1.3, 5, 2.7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -2.6;
key.shadow.camera.right = key.shadow.camera.top = 2.6;
key.shadow.camera.near = .1;
key.shadow.camera.far = 12;
key.shadow.normalBias = .001;
scene.add(key);
const fill = new THREE.DirectionalLight(0xbcdcff, 1.6);
fill.position.set(-2, 3.4, 1.2);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 2.7);
rim.position.set(.5, 4.5, -2);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#d7dfe5', roughness: .85 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -.003;
floor.receiveShadow = true;
scene.add(floor);

// glTF conversion maps Blender (x,y,z) -> Three (x,z,-y).
const views = {
  detail: { position: [-1.02, 3.63, 1.5], target: [0, 3.455, .04] },
  full: { position: [1.7, 2.35, 6.2], target: [0, 1.96, 0] },
  optics: { position: [.19, 3.327, .72], target: [0, 3.267, .18] },
  front: { position: [0, 3.183, .769], target: [0, 3.256, .174] },
  side: { position: [.60, 3.256, .174], target: [0, 3.256, .174] },
  rear: { position: [-.82, 3.35, -.90], target: [0, 3.47, 0] },
  solar: { position: [.47, 4.7, .81], target: [0, 3.69, 0] },
};
let activeView = 'detail';
function changeView(name) {
  activeView = name;
  const view = views[name];
  const factor = innerWidth < 760 ? 1.48 : 1;
  controls.target.fromArray(view.target);
  camera.position.fromArray(view.position).sub(controls.target).multiplyScalar(factor).add(controls.target);
  controls.update();
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
}
changeView('detail');
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => changeView(button.dataset.view)));
document.querySelector('#rotate').addEventListener('change', event => { controls.autoRotate = event.target.checked; });

let model;
let materials = new Set();
let currentVariant = 'high';
let loadSequence = 0;
const modelCache = new Map();
const loading = document.querySelector('#loading');
const detailLevel = document.querySelector('#detail-level');
const modelUrls = {
  high: `${import.meta.env.BASE_URL}models/flock-camera.glb?v=down-7`,
  low: `${import.meta.env.BASE_URL}models/flock-camera-low.glb?v=down-7`,
  world: `${import.meta.env.BASE_URL}models/flock-camera-world.glb?v=down-7`,
};
const variantNames = { high: 'High detail', low: 'Low poly', world: 'World LOD' };
const requestedVariant = new URLSearchParams(location.search).get('detail');
if (Object.hasOwn(modelUrls, requestedVariant)) detailLevel.value = requestedVariant;
function applyVisibility() {
  if (!model) return;
  document.querySelectorAll('[data-part]').forEach(input => {
    const part = input.dataset.part.replaceAll(' ', '_');
    model.traverse(object => {
      // Exporter sanitizes spaces/colon punctuation in node names.
      if (object.name.includes(part) || object.name.replaceAll('_', ' ').includes(input.dataset.part)) object.visible = input.checked;
    });
  });
}
async function loadModel(variant) {
  const sequence = ++loadSequence;
  loading.hidden = false;
  loading.textContent = `Loading ${variantNames[variant]} model…`;
  try {
    if (!modelCache.has(variant)) {
      modelCache.set(variant, new GLTFLoader().loadAsync(modelUrls[variant]));
    }
    const gltf = await modelCache.get(variant);
    if (sequence !== loadSequence) return;
    if (model) scene.remove(model);
    model = gltf.scene;
    materials = new Set();
    let meshCount = 0, triangles = 0;
    model.traverse(object => {
      if (!object.isMesh) return;
      meshCount += 1;
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      object.castShadow = object.receiveShadow = true;
      for (const material of [object.material].flat()) materials.add(material);
    });
    materials.forEach(material => { material.wireframe = document.querySelector('#wireframe').checked; });
    applyVisibility();
    scene.add(model);
    currentVariant = variant;
    document.querySelector('[data-part="Battery pack"]').disabled = variant === 'world';
    document.querySelector('#stats').textContent = `${variantNames[variant]} · ${meshCount.toLocaleString()} mesh parts · ${Math.round(triangles).toLocaleString()} triangles · Scale in meters`;
    document.querySelector('#download-model').href = modelUrls[variant];
    loading.hidden = true;
    window.flockViewer = { model, renderer, scene, camera, controls, changeView, variant };
  } catch (error) {
    modelCache.delete(variant);
    if (sequence !== loadSequence) return;
    detailLevel.value = currentVariant;
    loading.textContent = 'Could not load this model. Select a detail level to retry.';
    console.error(error);
  }
}
detailLevel.addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('detail', detailLevel.value);
  history.replaceState(null, '', url);
  loadModel(detailLevel.value);
});
document.querySelector('#wireframe').addEventListener('change', event => materials.forEach(material => { material.wireframe = event.target.checked; }));
document.querySelectorAll('[data-part]').forEach(input => input.addEventListener('change', applyVisibility));
loadModel(detailLevel.value);
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
