import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { cloudGLSL, lightGLSL, lightUniforms, windGLSL, windUniforms } from './fx.js';
import { makeNoise2 } from './terrain.js';

/** Tube with a radius that tapers along a curve (trunk / branches). */
export function taperedTube(points, r0, r1, radial = 8, steps = 14) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(steps, false);
  const pos = [];
  const norm = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const c = curve.getPointAt(t);
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 0.8)) * (1 + 0.25 * Math.pow(1 - t, 6));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      v.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      norm.push(v.x, v.y, v.z);
      pos.push(c.x + v.x * r, c.y + v.y * r, c.z + v.z * r);
    }
  }
  const index = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setIndex(index);
  return g;
}

function buildTrunk() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const parts = [
    taperedTube([V(0, -0.6, 0), V(0.15, 1.6, 0.05), V(-0.1, 3.4, 0.1), V(0.1, 4.6, 0)], 0.62, 0.34, 10, 16),
    taperedTube([V(0.05, 3.6, 0), V(1.3, 4.9, 0.3), V(2.6, 5.9, 0.2), V(3.6, 6.6, -0.3)], 0.3, 0.1),
    taperedTube([V(-0.05, 3.8, 0), V(-1.4, 5.0, 0.2), V(-2.8, 6.1, -0.2), V(-3.5, 7.0, -0.6)], 0.28, 0.09),
    taperedTube([V(0.1, 4.4, 0), V(0.3, 5.8, 0.8), V(0.4, 7.2, 1.2), V(0.2, 8.0, 1.0)], 0.24, 0.08),
    taperedTube([V(0, 4.2, 0), V(0.4, 5.6, -1.0), V(0.2, 7.0, -1.8)], 0.22, 0.08),
  ];
  return mergeGeometries(parts);
}

function buildCrown() {
  const rand = makeRandom(77);
  const noise = makeNoise2(5);
  const blobs = [{ x: 0, y: 7.6, z: 0, r: 4.4 }];
  // Dome of clusters around the core.
  for (let i = 0; i < 26; i++) {
    const u = rand.next();
    const phi = Math.acos(1 - u * 1.25); // biased to the top half
    const th = rand.range(0, Math.PI * 2);
    const R = rand.range(3.6, 4.4);
    blobs.push({
      x: Math.sin(phi) * Math.cos(th) * R * 1.22,
      y: 7.4 + Math.cos(phi) * R * 0.82,
      z: Math.sin(phi) * Math.sin(th) * R * 1.05,
      r: rand.range(1.7, 2.6),
    });
  }
  const parts = [];
  const center = new THREE.Vector3(0, 7.5, 0);
  for (const b of blobs) {
    const ico = new THREE.IcosahedronGeometry(b.r, 3);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    const g = mergeVertices(ico);
    ico.dispose();
    const pos = g.attributes.position;
    const ao = new Float32Array(pos.count);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = v.clone().normalize();
      // Lumpy leaf clumps.
      const bump = 1 + 0.13 * noise(n.x * 2.3 + b.x, n.y * 2.3 + n.z * 1.7 + b.z) + 0.06 * noise(n.x * 6 + b.y, n.z * 6 - n.y * 3);
      v.multiplyScalar(bump).add(new THREE.Vector3(b.x, b.y, b.z));
      pos.setXYZ(i, v.x, v.y, v.z);
      ao[i] = THREE.MathUtils.clamp(v.distanceTo(center) / 6.2, 0, 1);
    }
    g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    g.computeVertexNormals();
    // Blend normals toward the crown's overall sphere for a soft, round read.
    const nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) {
      v.fromBufferAttribute(pos, i).sub(center).normalize();
      const n = new THREE.Vector3().fromBufferAttribute(nrm, i).lerp(v, 0.45).normalize();
      nrm.setXYZ(i, n.x, n.y, n.z);
    }
    parts.push(g);
  }
  return mergeGeometries(parts);
}

const foliageVert = /* glsl */ `
  attribute float aAO;
  uniform vec3 uOrigin;
  ${windGLSL}
  ${cloudGLSL}
  varying float vCloud;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vAO;
  varying vec3 vLocal;
  void main() {
    vec3 p = position;
    float hgt = clamp((p.y - 3.0) / 8.0, 0.0, 1.0);
    float g = gustField(uOrigin.xz);
    float sway = sin(uTime * 0.8) * 0.5 + sin(uTime * 1.37 + 1.2) * 0.3;
    vec2 off = uWindDir * (0.12 + 0.12 * sway + 0.45 * g) * hgt * hgt;
    // Leaves rustle.
    float rustle = sin(uTime * 5.0 + dot(p, vec3(2.1, 1.7, 2.6))) * (0.04 + 0.08 * g);
    p.xz += off + normal.xz * rustle * hgt;
    p.y += rustle * 0.5 * hgt;
    vLocal = position;
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vAO = aAO;
    vCloud = cloudShade(uOrigin.xz, uTime, uWindDir);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const foliageFrag = /* glsl */ `
  uniform vec3 uShadow;
  uniform vec3 uMid;
  uniform vec3 uLight;
  ${lightGLSL}
  float hashF(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vAO;
  varying vec3 vLocal;
  varying float vCloud;
  void main() {
    vec3 n = normalize(vNormal);
    float wrap = clamp((dot(n, uSunDir) + 0.4) / 1.4, 0.0, 1.0) * mix(0.6, 1.0, (vCloud - 0.72) / 0.28);
    // Leafy dapple: cellular-ish speckle that stays readable at low res.
    vec3 q = vLocal * 2.2;
    float leaf = hashF(floor(q)) * 0.5 + hashF(floor(q * 1.9 + 3.1)) * 0.5;
    float tone = wrap * (0.55 + 0.45 * vAO) + (leaf - 0.5) * 0.22;
    vec3 col = mix(uShadow, uMid, smoothstep(0.05, 0.55, tone));
    col = mix(col, uLight, smoothstep(0.55, 0.95, tone));
    col *= uSunColor * 0.55 + mix(uGroundLight, uSkyLight, n.y * 0.5 + 0.5) * 0.6;
    // Backlit rim where the sun shines through the canopy edge.
    vec3 v = normalize(cameraPosition - vWorld);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    float back = max(dot(-v, normalize(uSunView)), 0.0);
    col += uLight * rim * (0.25 + 0.9 * back) * 0.6;
    col = applyHaze(col, vWorld, 1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function Tree({ position, scale = 1 }) {
  const trunk = useDisposable(buildTrunk);
  const crown = useDisposable(buildCrown);
  const bark = useDisposable(() => new THREE.MeshStandardMaterial({ color: '#7c5a3e', roughness: 0.85 }));
  const foliage = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...windUniforms,
          ...lightUniforms,
          uOrigin: { value: new THREE.Vector3(...position) },
          uShadow: { value: new THREE.Color('#1f5a1c') },
          uMid: { value: new THREE.Color('#4a9e2a') },
          uLight: { value: new THREE.Color('#b4e85e') },
        },
        vertexShader: foliageVert,
        fragmentShader: foliageFrag,
      }),
    [...position],
  );
  return (
    <group position={position} scale={scale}>
      <mesh geometry={trunk} material={bark} />
      <mesh geometry={crown} material={foliage} />
    </group>
  );
}

// ----------------------------------------------- small background trees

const lollipopVert = /* glsl */ `
  attribute vec4 aTree; // x, y, z, scale
  attribute float aShade;
  ${windGLSL}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vPart;
  varying float vShade;
  void main() {
    float part = step(0.5, uv.x); // 0 trunk, 1 crown (encoded in uv)
    vec3 p = position * aTree.w;
    float hgt = clamp(position.y / 3.0, 0.0, 1.0);
    p.xz += uWindDir * sin(uTime * 0.9 + aTree.x * 0.1) * 0.08 * aTree.w * hgt * part;
    vec3 w = p + aTree.xyz;
    vWorld = w;
    vNormal = normal;
    vPart = part;
    vShade = aShade;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }
`;

const lollipopFrag = /* glsl */ `
  uniform vec3 uLeaf;
  uniform vec3 uLeafLight;
  uniform vec3 uTrunk;
  ${lightGLSL}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vPart;
  varying float vShade;
  void main() {
    vec3 n = normalize(vNormal);
    float wrap = clamp((dot(n, uSunDir) + 0.4) / 1.4, 0.0, 1.0);
    vec3 leaf = mix(uLeaf, uLeafLight, wrap) * (0.85 + 0.3 * vShade);
    vec3 col = mix(uTrunk, leaf, vPart);
    col *= uSunColor * 0.5 + uSkyLight * 0.55;
    col = applyHaze(col, vWorld, 1.25);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Instanced little round trees dotted over the far hills. */
export function TreeClumps({ trees }) {
  const geometry = useDisposable(() => {
    const trunk = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6, 1, true);
    trunk.translate(0, 1.1, 0);
    trunk.attributes.uv.array.fill(0);
    const ico = new THREE.IcosahedronGeometry(1.7, 2);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    const crown = mergeVertices(ico);
    ico.dispose();
    crown.scale(1, 1.08, 1);
    crown.translate(0, 3.3, 0);
    crown.computeVertexNormals();
    crown.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(crown.attributes.position.count * 2).fill(1), 2));
    const merged = mergeGeometries([trunk, crown]);
    const g = new THREE.InstancedBufferGeometry();
    g.index = merged.index;
    g.attributes.position = merged.attributes.position;
    g.attributes.normal = merged.attributes.normal;
    g.attributes.uv = merged.attributes.uv;
    g.setAttribute('aTree', new THREE.InstancedBufferAttribute(new Float32Array(trees.flatMap((t) => [t.x, t.y, t.z, t.s])), 4));
    g.setAttribute('aShade', new THREE.InstancedBufferAttribute(new Float32Array(trees.map((t) => t.shade)), 1));
    g.instanceCount = trees.length;
    return g;
  }, [trees]);
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...windUniforms,
          ...lightUniforms,
          uLeaf: { value: new THREE.Color('#2f7d26') },
          uLeafLight: { value: new THREE.Color('#8fd04a') },
          uTrunk: { value: new THREE.Color('#6b4b33') },
        },
        vertexShader: lollipopVert,
        fragmentShader: lollipopFrag,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
