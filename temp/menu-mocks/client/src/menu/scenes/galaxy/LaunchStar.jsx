import { useRef } from 'react';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { beat, useDisposable } from '../../shared/hooks.js';
import { makeGlowTexture, makeLit, merge, paint, starShape, xform } from './materials.js';
import { PlanetRoot } from './PlanetRoot.jsx';
import { TARGET_INDEX } from './layout.js';

const STAR_SURFACE = /* glsl */ `
  uniform float uPulse;
  void surface(inout Surf s, vec3 V) {
    float f = clamp(1.0 - dot(s.N, V), 0.0, 1.0);
    // Warm inner glow that breathes with the music.
    float r = length(vObjPos.xy);
    s.emit = 0.08 + 0.18 * uPulse + 0.1 * uFocus + 0.18 * smoothstep(0.55, 0.0, r);
    s.add = vec3(1.0, 0.75, 0.3) * pow(f, 2.5) * (0.45 + uFocus * 0.4);
  }
`;

function puffyStar(scale, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(starShape(scale, scale * 0.5, 0.16), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.65,
    bevelSegments: 5,
    curveSegments: 6,
  });
  g.center();
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const smooth = mergeVertices(g, 1e-3);
  g.dispose();
  smooth.computeVertexNormals();
  return smooth;
}

function starGeometry() {
  const gold = new THREE.Color('#ff7a00');
  const light = new THREE.Color('#ffbb1a');
  const c = new THREE.Color();
  const body = paint(puffyStar(1, 0.22, 0.2), (x, y) => c.copy(gold).lerp(light, Math.max(0, 1 - Math.hypot(x, y) * 0.85)));
  // Raised inner emblem star on both faces.
  const emblem = new THREE.Color('#ffe066');
  const front = paint(puffyStar(0.5, 0.06, 0.07), (x, y) => c.copy(emblem).lerp(new THREE.Color('#fff6c0'), Math.max(0, 1 - Math.hypot(x, y) * 1.6)), 0.25);
  front.translate(0, 0, 0.27);
  const back = front.clone();
  back.rotateY(Math.PI);
  return merge([body, front, back]);
}

function ringGeometry(radius, beads, color) {
  const parts = [paint(new THREE.TorusGeometry(radius, 0.022, 6, 140), color, 0.9)];
  for (let i = 0; i < beads; i++) {
    const a = (i / beads) * Math.PI * 2;
    parts.push(xform(paint(new THREE.IcosahedronGeometry(i % 3 === 0 ? 0.075 : 0.045, 1), i % 3 === 0 ? '#fff6d0' : color, 1.6), { p: [Math.cos(a) * radius, Math.sin(a) * radius, 0] }));
  }
  return merge(parts);
}

export default function LaunchStar({ state }) {
  const index = TARGET_INDEX.play;
  const star = useDisposable(starGeometry);
  const ring1 = useDisposable(() => ringGeometry(1.62, 18, '#ffd36b'));
  const ring2 = useDisposable(() => ringGeometry(1.95, 12, '#8fdcff'));
  const starMat = useDisposable(() =>
    makeLit({ surface: STAR_SURFACE, rim: '#ffe28a', rimStrength: 0.6, gloss: 1.2, shine: 40, wrap: 0.45, uniforms: { uPulse: { value: 0 } } }),
  );
  const ringMat = useDisposable(() => makeLit({ rim: '#ffffff', rimStrength: 0.4, gloss: 0.5, shine: 20, emitBoost: 1 }));
  const glowTex = useDisposable(() => makeGlowTexture(128, 2.4));
  const glowMat = useDisposable(
    () =>
      new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color('#ffcf6a').multiplyScalar(0.9),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    [glowTex],
  );
  const starRef = useRef();
  const r1 = useRef();
  const r2 = useRef();
  const glow = useRef();
  return (
    <PlanetRoot
      index={index}
      state={state}
      spin={0}
      materials={[starMat, ringMat]}
      onFrame={(t, dt, focus) => {
        const pulse = beat.pulse;
        starMat.uniforms.uPulse.value = pulse;
        ringMat.uniforms.uEmitBoost.value = 0.45 + pulse * 0.3 + focus * 0.15;
        const s = 1 + pulse * 0.05 + focus * 0.08;
        starRef.current.scale.setScalar(s);
        const since = t - state.punch[index];
        const burst = since >= 0 && since < 3 ? Math.exp(-since * 1.8) * 16 : 0;
        starRef.current.rotation.set(Math.sin(t * 0.6) * 0.12, Math.sin(t * 0.45) * 0.35, starRef.current.rotation.z - dt * (0.7 + focus * 1.6 + burst));
        r1.current.rotation.set(1.2 + Math.sin(t * 0.3) * 0.08, 0.3, t * 0.5);
        r2.current.rotation.set(0.5 + Math.sin(t * 0.25) * 0.08, -0.5, -t * 0.35);
        glow.current.scale.setScalar(3.6 + pulse * 0.4 + focus * 0.4);
        glowMat.color.setRGB(1.0, 0.62, 0.22).multiplyScalar(0.14 + pulse * 0.07);
      }}
    >
      <sprite ref={glow} material={glowMat} renderOrder={-1} />
      <mesh ref={starRef} geometry={star} material={starMat} />
      <mesh ref={r1} geometry={ring1} material={ringMat} />
      <mesh ref={r2} geometry={ring2} material={ringMat} />
    </PlanetRoot>
  );
}
