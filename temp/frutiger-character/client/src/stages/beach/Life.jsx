import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, useDisposable } from '../shared/hooks.js';
import { makeRandom } from '../shared/random.js';
import { SUN_AZIMUTH, WATER_Y, world } from './palette.js';
import { makeLitMaterial } from './shaders.js';
import { dolphinGeometry, gullGeometry } from './props.js';

// Gulls: circling over the cove, gliding high, and crossing near the lens.
const GULLS = (() => {
  const rand = makeRandom(91);
  const list = [];
  for (let i = 0; i < 5; i++) list.push({ kind: 0, cx: rand.range(-10, 12), cy: rand.range(8, 14), cz: rand.range(-40, -22), r: rand.range(8, 15), w: rand.range(0.18, 0.3) * rand.sign(), ph: rand.range(0, 6.28), s: rand.range(1.6, 2.1) });
  for (let i = 0; i < 3; i++) list.push({ kind: 0, cx: rand.range(-40, 30), cy: rand.range(18, 26), cz: rand.range(-110, -70), r: rand.range(18, 28), w: rand.range(0.1, 0.16) * rand.sign(), ph: rand.range(0, 6.28), s: 2.6 });
  list.push({ kind: 1, y: 7.5, z: 1.5, speed: 3.6, ph: 0, s: 1.4 });
  list.push({ kind: 1, y: 8.6, z: -2.5, speed: -3.0, ph: 31, s: 1.3 });
  return list;
})();

function gullPos(g, t, out) {
  if (g.kind === 1) {
    const span = 90;
    const x = ((((g.ph + t * g.speed) % span) + span) % span) - span / 2;
    return out.set(x, g.y + Math.sin(t * 0.8 + g.ph) * 0.6, g.z + Math.sin(t * 0.3 + g.ph) * 2);
  }
  const a = g.ph + t * g.w;
  return out.set(g.cx + Math.cos(a) * g.r, g.cy + Math.sin(a * 1.7 + g.ph) * 2, g.cz + Math.sin(a) * g.r * 0.6);
}

function Gulls() {
  const mesh = useRef();
  const geometry = useDisposable(() => gullGeometry());
  const material = useDisposable(() => makeLitMaterial({ shininess: 20, specular: 0.2, rim: 0.8, side: THREE.DoubleSide, flap: true }));
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const ahead = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const t = world.uTime.value;
    GULLS.forEach((g, i) => {
      gullPos(g, t, dummy.position);
      gullPos(g, t + 0.05, ahead);
      dummy.lookAt(ahead);
      if (g.kind === 0) dummy.rotateZ(-Math.sign(g.w) * 0.3);
      dummy.scale.setScalar(g.s);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, GULLS.length]} frustumCulled={false} />;
}

// Additive spray droplets (points) with a per-point fade.
function makeDropMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aFade;
      varying float vFade;
      void main() {
        vFade = aFade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(260.0 / -mv.z, 2.0, 9.0) * (0.5 + 0.5 * aFade);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vFade;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.3, 1.0, r)) * vFade;
        gl_FragColor = vec4(vec3(1.3, 1.25, 1.2) * a, 1.0);
      }
    `,
  });
}

function dropGeometry(count) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(count), 1));
  return g;
}

// A pod of dolphins leaping in turn across the cove mouth.
const POD = { period: 5.2, air: 0.3, height: 2.3, length: 7.5 };
const DOLPHINS = [
  { x: -6, z: -58, lag: 0, speed: 1.4 },
  { x: -9, z: -61, lag: 0.55, speed: 1.4 },
  { x: -3.5, z: -63, lag: 1.15, speed: 1.4 },
];
const DROPS = 10;

function dolphinState(d, t, out) {
  const s = ((t - d.lag) / POD.period) % 1;
  const cycle = Math.floor((t - d.lag) / POD.period);
  const u = s / POD.air;
  const baseX = d.x + ((cycle * POD.length * 1.6 + 60) % 50) - 25;
  out.inAir = u <= 1;
  out.u = Math.min(u, 1);
  out.x = baseX + out.u * POD.length;
  out.y = WATER_Y - 0.5 + Math.sin(Math.PI * out.u) * POD.height;
  out.pitch = Math.atan2(Math.cos(Math.PI * out.u) * Math.PI * POD.height, POD.length);
  out.cycleX = baseX;
  out.age = s * POD.period;
  return out;
}

function Dolphins() {
  const mesh = useRef();
  const drops = useRef();
  const geometry = useDisposable(() => dolphinGeometry());
  const material = useDisposable(() => makeLitMaterial({ shininess: 70, specular: 0.8, rim: 0.7 }));
  const dropGeo = useDisposable(() => dropGeometry(DOLPHINS.length * 2 * DROPS));
  const dropMat = useDisposable(makeDropMaterial);
  const rand = useMemo(() => {
    const r = makeRandom(5);
    return Array.from({ length: DROPS }, () => [r.range(-1.2, 1.2), r.range(1.5, 3.2), r.range(-0.8, 0.8)]);
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const st = useMemo(() => ({}), []);
  useFrame(() => {
    const t = world.uTime.value;
    const pos = dropGeo.attributes.position;
    const fade = dropGeo.attributes.aFade;
    DOLPHINS.forEach((d, i) => {
      dolphinState(d, t, st);
      dummy.position.set(st.x, st.inAir ? st.y : -20, d.z);
      dummy.rotation.set(0, Math.PI / 2, 0);
      dummy.rotateX(-st.pitch);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
      // Splash droplets at take-off and re-entry.
      for (let e = 0; e < 2; e++) {
        const age = e === 0 ? st.age : st.age - POD.period * POD.air;
        const ex = st.cycleX + e * POD.length;
        for (let k = 0; k < DROPS; k++) {
          const idx = (i * 2 + e) * DROPS + k;
          const [vx, vy, vz] = rand[k];
          if (age < 0 || age > 1.1) {
            pos.setXYZ(idx, 0, -50, 0);
            fade.setX(idx, 0);
            continue;
          }
          pos.setXYZ(idx, ex + vx * age, WATER_Y + vy * age - 4.9 * age * age, d.z + vz * age);
          fade.setX(idx, 1 - age / 1.1);
        }
      }
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    pos.needsUpdate = true;
    fade.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={mesh} args={[geometry, material, DOLPHINS.length]} frustumCulled={false} />
      <points ref={drops} geometry={dropGeo} material={dropMat} frustumCulled={false} renderOrder={8} />
    </>
  );
}

/** Glossy soap-bubble orbs drifting up from the shallows on both sides of the dancers. */
function Bubbles({ count = 26 }) {
  const geometry = useDisposable(() => {
    const rand = makeRandom(12);
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const data = new Float32Array(count * 4);
    const more = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      data.set([side * rand.range(5.5, 13), rand.range(-9, 1), rand.range(0.14, 0.38), rand.range(0, 1)], i * 4);
      more.set([rand.range(0.35, 0.6), rand.range(0, 6.28), rand.range(0, 1)], i * 3);
    }
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
    g.setAttribute('aMore', new THREE.InstancedBufferAttribute(more, 3));
    g.instanceCount = count;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        uniforms: { uTime: world.uTime, uWaterY: world.uWaterY },
        vertexShader: /* glsl */ `
          attribute vec4 aData;
          attribute vec3 aMore;
          uniform float uTime, uWaterY;
          varying vec2 vUv;
          varying float vFade;
          varying float vHue;
          void main() {
            float life = fract(uTime * aMore.x * 0.1 + aData.w);
            vec3 c = vec3(aData.x + sin(uTime * 0.7 + aMore.y) * 0.6, uWaterY + life * 8.0, aData.y + life * 2.0);
            vFade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.75, 1.0, life));
            vHue = aMore.z;
            vUv = uv;
            vec4 mv = viewMatrix * vec4(c, 1.0);
            mv.xy += position.xy * aData.z * 2.0;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          varying float vFade;
          varying float vHue;
          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            float r = length(p);
            if (r > 1.0) discard;
            float rim = smoothstep(0.65, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
            float ang = atan(p.y, p.x);
            vec3 irid = 0.55 + 0.45 * cos(6.2831 * (r * 1.3 + vHue + vec3(0.0, 0.33, 0.67)) + ang);
            float hl = exp(-dot(p - vec2(-0.38, 0.42), p - vec2(-0.38, 0.42)) * 22.0);
            float hl2 = exp(-dot(p - vec2(0.4, -0.45), p - vec2(0.4, -0.45)) * 40.0) * 0.4;
            vec3 col = irid * rim * 1.3 + vec3(1.6) * (hl + hl2) + vec3(0.6, 0.9, 1.0) * 0.06;
            float a = clamp(rim * 0.55 + hl * 0.9 + hl2 + 0.06, 0.0, 1.0) * vFade;
            gl_FragColor = vec4(col * a, a);
          }
        `,
      }),
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={10} />;
}

/** Star glints twinkling on the sun's path across the water. */
function Sparkles({ count = 80 }) {
  const geometry = useDisposable(() => {
    const rand = makeRandom(33);
    const pos = new Float32Array(count * 3);
    const data = new Float32Array(count * 2);
    const az = THREE.MathUtils.degToRad(SUN_AZIMUTH);
    for (let i = 0; i < count; i++) {
      const d = 24 + Math.pow(rand.next(), 1.8) * 420;
      const spread = 0.06 + 2.2 / (d + 8);
      const a = az + rand.range(-1, 1) * spread;
      pos.set([Math.sin(a) * d, WATER_Y + 0.05, 15 - Math.cos(a) * d], i * 3);
      data.set([rand.range(0, 100), rand.range(0.6, 1.6)], i * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 2));
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: world.uTime, uPulse: { value: 0 }, uWaterY: world.uWaterY },
        vertexShader: /* glsl */ `
          attribute vec2 aData;
          uniform float uTime, uPulse;
          varying float vGain;
          void main() {
            float tw = pow(max(sin(uTime * aData.y * 2.2 + aData.x), 0.0), 14.0);
            vGain = tw * (1.0 + uPulse * 0.6);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = mix(7.0, 15.0, tw) * clamp(40.0 / -mv.z, 0.55, 1.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vGain;
          void main() {
            vec2 p = (gl_PointCoord - 0.5) * 2.0;
            float star = exp(-abs(p.x) * 9.0) * exp(-abs(p.y) * 1.6) + exp(-abs(p.y) * 9.0) * exp(-abs(p.x) * 1.6);
            float core = exp(-dot(p, p) * 10.0);
            gl_FragColor = vec4(vec3(1.0, 0.92, 0.75) * (star * 1.6 + core * 2.0) * vGain, 1.0);
          }
        `,
      }),
  );
  useFrame(() => {
    material.uniforms.uPulse.value = beat.pulse;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={9} />;
}

export function Life() {
  return (
    <>
      <Gulls />
      <Dolphins />
      <Bubbles />
      <Sparkles />
    </>
  );
}
