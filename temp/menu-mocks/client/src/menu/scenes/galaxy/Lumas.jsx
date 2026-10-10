import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { beat, useDisposable } from '../../shared/hooks.js';
import { makeLit, merge, paint, starShape, xform } from './materials.js';
import { targetPosition } from './layout.js';

// Little star sprites (a nod to Mario Galaxy's Lumas) that float around the
// hub, bobbing to the beat and turning to peek at the camera.

function lumaGeometry() {
  const g = new THREE.ExtrudeGeometry(starShape(1, 0.56, 0.32), {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: 0.32,
    bevelSize: 0.22,
    bevelSegments: 5,
    curveSegments: 5,
  });
  g.center();
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const body = mergeVertices(g, 1e-3);
  g.dispose();
  body.computeVertexNormals();
  const parts = [paint(body, '#ffffff', 0.18)];
  for (const x of [-0.2, 0.2]) {
    parts.push(xform(paint(new THREE.SphereGeometry(0.1, 10, 8), '#1a1030'), { p: [x, 0.08, 0.46], s: [0.8, 1.25, 0.6] }));
    parts.push(xform(paint(new THREE.SphereGeometry(0.03, 6, 4), '#ffffff', 1.5), { p: [x + 0.025, 0.14, 0.52] }));
  }
  // Rosy cheeks.
  for (const x of [-0.34, 0.34]) {
    parts.push(xform(paint(new THREE.SphereGeometry(0.07, 8, 6), '#ff7aa8', 0.3), { p: [x, -0.08, 0.45], s: [1, 0.6, 0.4] }));
  }
  return merge(parts);
}

const LUMAS = [
  // anchor target, orbit radius, height, speed, phase, size, color
  [0, 2.4, 1.1, 0.35, 0.0, 0.32, '#ffe066'],
  [0, 2.9, -0.9, -0.28, 2.4, 0.26, '#ff9fd0'],
  [1, 4.1, 2.1, 0.2, 1.2, 0.3, '#9fe0ff'],
  [4, 3.9, 1.6, -0.22, 4.0, 0.28, '#b6ff9a'],
  [2, 2.9, 1.2, 0.3, 3.3, 0.24, '#d4b0ff'],
];

const LUMA_SURFACE = /* glsl */ `
  void surface(inout Surf s, vec3 V) {
    float f = clamp(1.0 - dot(s.N, V), 0.0, 1.0);
    s.add = s.albedo * pow(f, 2.0) * 0.45;
  }
`;

export function Lumas() {
  const mesh = useRef();
  const geometry = useDisposable(lumaGeometry);
  const material = useDisposable(() => makeLit({ surface: LUMA_SURFACE, rim: '#ffffff', rimStrength: 0.5, gloss: 0.9, shine: 30, wrap: 0.6 }));
  useLayoutEffect(() => {
    const c = new THREE.Color();
    LUMAS.forEach((l, i) => mesh.current.setColorAt(i, c.set(l[6])));
    mesh.current.instanceColor.needsUpdate = true;
  }, []);
  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), c: new THREE.Vector3(), s: new THREE.Vector3(), look: new THREE.Matrix4(), up: new THREE.Vector3(0, 1, 0) }),
    [],
  );
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    LUMAS.forEach(([anchor, r, h, speed, phase, size], i) => {
      targetPosition(anchor, t, tmp.c);
      const a = t * speed + phase;
      const hop = Math.abs(Math.sin(t * Math.PI * (118 / 60) * 0.5 + i)) * 0.18;
      tmp.p.set(tmp.c.x + Math.cos(a) * r, tmp.c.y + h + Math.sin(t * 0.9 + phase) * 0.25 + hop, tmp.c.z + Math.sin(a) * r);
      // Face the camera with a playful wobble.
      tmp.look.lookAt(st.camera.position, tmp.p, tmp.up);
      tmp.q.setFromRotationMatrix(tmp.look);
      tmp.e.set(Math.sin(t * 1.3 + i) * 0.25, Math.sin(t * 0.9 + phase) * 0.35, Math.sin(t * 2.1 + i * 2) * 0.22);
      tmp.q.multiply(tmp.q2.setFromEuler(tmp.e));
      const squash = 1 + beat.pulse * 0.08;
      tmp.s.set(size * squash, (size / squash) * 1.0, size * squash);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      mesh.current.setMatrixAt(i, tmp.m);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, LUMAS.length]} frustumCulled={false} />;
}

/** Soft pastel bokeh discs drifting close to the camera (dreamy Aero depth). */
export function Bokeh() {
  const COUNT = 14;
  const geometry = useDisposable(() => {
    const pos = new Float32Array(COUNT * 3);
    const data = new Float32Array(COUNT * 4);
    const colors = [
      [1.0, 0.6, 0.9],
      [0.6, 0.85, 1.0],
      [1.0, 0.9, 0.55],
      [0.75, 0.65, 1.0],
    ];
    const col = new Float32Array(COUNT * 3);
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < COUNT; i++) {
      pos.set([rnd() * 26 - 2, rnd() * 18 - 9, 8 + rnd() * 8], i * 3);
      data.set([0.7 + rnd() * 1.4, rnd() * 6.28, 0.1 + rnd() * 0.2, rnd()], i * 4);
      col.set(colors[i % colors.length], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPx: { value: 480 / (2 * Math.tan(THREE.MathUtils.degToRad(20))) } },
        vertexShader: /* glsl */ `
          attribute vec4 aData;
          attribute vec3 aColor;
          uniform float uTime, uPx;
          varying vec3 vColor;
          varying float vA;
          void main() {
            vec3 p = position + vec3(sin(uTime * 0.07 + aData.y) * 1.5, sin(uTime * 0.05 + aData.y * 2.0) * 1.0, 0.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float d = -mv.z;
            vA = aData.z * smoothstep(2.0, 6.0, d) * (0.6 + 0.4 * sin(uTime * 0.4 + aData.y));
            vColor = aColor;
            gl_PointSize = min(aData.x * uPx / max(d, 0.5), 160.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vA;
          void main() {
            vec2 p = (gl_PointCoord * 2.0 - 1.0) * vec2(1.3333, 1.0); // undo the anamorphic stretch
            float r = length(p);
            float disc = smoothstep(1.0, 0.86, r);
            float ring = smoothstep(0.7, 0.95, r) * disc;
            float a = (disc * 0.28 + ring * 0.4) * vA;
            gl_FragColor = vec4(vColor * a, 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );
  useFrame((s) => {
    material.uniforms.uTime.value = s.clock.elapsedTime;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={10} />;
}
