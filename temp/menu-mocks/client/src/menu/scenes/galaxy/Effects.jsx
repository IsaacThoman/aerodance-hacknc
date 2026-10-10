import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, useDisposable } from '../../shared/hooks.js';
import { makeRandom, clamp } from '../../shared/random.js';
import { makeGlowTexture, makeLit, paint, SPRITE_GLSL, starBitGeometry } from './materials.js';
import { TARGETS, TARGET_INDEX, targetPosition } from './layout.js';
import { PX_SCALE } from './Meadow.jsx';

// ---------------------------------------------------------------------------
// Star bits: tumbling crystalline candy you can collect by pointing at them.

const BIT_COLORS = ['#ff5fae', '#ffd23f', '#43bfff', '#5fe36a', '#b277ff', '#ff8a3d'];
const RING_BITS = 16;
const CLUSTERS = [
  // center x, y, z, spread, count
  [-0.6, -0.8, 5, 1.5, 6],
  [13, -2.5, 1, 1.7, 6],
  [15, 6.5, -5, 1.8, 6],
  [1.5, -8.2, 4, 1.4, 5],
  [-1.5, 8.5, -6, 1.9, 6],
];
const NEAR_BITS = 11;
const BIT_COUNT = RING_BITS + CLUSTERS.reduce((n, c) => n + c[4], 0) + NEAR_BITS;
const RING_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0, 0.35));
const UP = new THREE.Vector3(0, 1, 0);
// Where collected bits fly to: the HUD counter, in NDC.
export const COUNTER_NDC = [-576 / 640, -314 / 360];

const BIT_SURFACE = /* glsl */ `
  void surface(inout Surf s, vec3 V) {
    float f = clamp(1.0 - dot(s.N, V), 0.0, 1.0);
    s.emit = 0.3 + 0.5 * f;
    s.add = mix(s.albedo, vec3(1.0), 0.5) * pow(f, 3.0) * 0.5;
  }
`;

export function StarBits({ state }) {
  const mesh = useRef();
  const geometry = useDisposable(() => starBitGeometry());
  const material = useDisposable(() => makeLit({ surface: BIT_SURFACE, painted: false, rim: '#ffffff', rimStrength: 0.5, gloss: 1.8, shine: 70, wrap: 0.5 }));
  const bits = useMemo(() => {
    const rand = makeRandom(1234);
    const list = [];
    const push = (o) =>
      list.push({
        axis: new THREE.Vector3(rand.range(-1, 1), rand.range(-1, 1), rand.range(-1, 1)).normalize(),
        spin: rand.range(0.8, 2.4) * rand.sign(),
        bobPhase: rand.range(0, 6.28),
        color: BIT_COLORS[list.length % BIT_COLORS.length],
        mode: 0, // 0 floating, 1 flying to counter, 2 hidden, 3 respawning
        t0: 0,
        from: new THREE.Vector3(),
        pos: new THREE.Vector3(),
        off: new THREE.Vector3(),
        ...o,
      });
    // A swirling ring of bits around the launch star.
    for (let i = 0; i < RING_BITS; i++) {
      push({ kind: 0, a: (i / RING_BITS) * Math.PI * 2 + rand.range(-0.08, 0.08), r: rand.range(2.7, 3.3), y: rand.range(-0.2, 0.2), size: rand.range(0.13, 0.17) });
    }
    // Loose clusters drifting between the planets.
    for (const [x, y, z, spread, count] of CLUSTERS) {
      const w = rand.range(0.08, 0.18) * rand.sign();
      for (let i = 0; i < count; i++) {
        push({
          kind: 1,
          c: new THREE.Vector3(x, y, z),
          off: new THREE.Vector3(rand.range(-1, 1), rand.range(-0.6, 0.6), rand.range(-1, 1)).normalize().multiplyScalar(spread * rand.range(0.35, 1)),
          w,
          size: rand.range(0.13, 0.19),
        });
      }
    }
    // A few big ones close to the camera.
    for (let i = 0; i < NEAR_BITS; i++) {
      push({ kind: 2, c: new THREE.Vector3(rand.range(-3, 15), rand.range(-6.5, 7), rand.range(10, 15)), size: rand.range(0.16, 0.22) });
    }
    return list;
  }, []);
  state.bits = bits;

  useLayoutEffect(() => {
    const c = new THREE.Color();
    bits.forEach((b, i) => mesh.current.setColorAt(i, c.set(b.color)));
    mesh.current.instanceColor.needsUpdate = true;
  }, [bits]);

  const tmp = useMemo(
    () => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), goal: new THREE.Vector3(), ndc: new THREE.Vector3(), v: new THREE.Vector3(), c: new THREE.Vector3() }),
    [],
  );

  const collect = (i) => {
    const b = bits[i];
    if (!b || b.mode !== 0) return;
    b.mode = 1;
    b.t0 = performance.now() / 1000;
    b.from.copy(b.pos);
    const burst = state.bursts[state.burstIndex++ % state.bursts.length];
    burst.origin.copy(b.pos);
    burst.t0 = b.t0;
    burst.color.set(b.color);
  };

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const now = performance.now() / 1000;
    // Counter target in world space, a few units in front of the camera.
    tmp.ndc.set(COUNTER_NDC[0], COUNTER_NDC[1], 0.5).unproject(s.camera).sub(s.camera.position).normalize();
    tmp.goal.copy(s.camera.position).addScaledVector(tmp.ndc, 3);
    for (let i = 0; i < BIT_COUNT; i++) {
      const b = bits[i];
      let scale = b.size;
      if (b.mode === 0 || b.mode === 3) {
        if (b.kind === 0) {
          const a = b.a + t * 0.32;
          tmp.v.set(Math.cos(a) * b.r, b.y + Math.sin(t * 1.3 + b.bobPhase) * 0.08, Math.sin(a) * b.r).applyQuaternion(RING_TILT);
          b.pos.copy(targetPosition(0, t, tmp.c)).add(tmp.v);
        } else if (b.kind === 1) {
          tmp.v.copy(b.off).applyAxisAngle(UP, t * b.w);
          b.pos.copy(b.c).add(tmp.v);
          b.pos.y += Math.sin(t * 0.6 + b.bobPhase) * 0.18;
        } else {
          b.pos.copy(b.c);
          b.pos.x += Math.sin(t * 0.13 + b.bobPhase) * 0.7;
          b.pos.y += Math.sin(t * 0.31 + b.bobPhase) * 0.45;
        }
        if (b.mode === 3) {
          const k = clamp((now - b.t0) / 0.6);
          scale *= k < 1 ? 1 + Math.sin(k * Math.PI) * 0.6 - (1 - k) : 1;
          if (k >= 1) b.mode = 0;
        }
      } else if (b.mode === 1) {
        const k = clamp((now - b.t0) / 0.75);
        const e = k * k * (3 - 2 * k);
        b.pos.lerpVectors(b.from, tmp.goal, e);
        b.pos.y += Math.sin(k * Math.PI) * 1.2;
        scale *= 1 + Math.sin(k * Math.PI) * 0.5 - k * 0.85;
        if (k >= 1) {
          b.mode = 2;
          b.t0 = now + 5 + Math.random() * 6;
          state.starBits += 1;
          state.collectedAt = now;
          state.emit();
        }
      } else if (b.mode === 2) {
        scale = 0;
        if (now > b.t0) {
          b.mode = 3;
          b.t0 = now;
        }
      }
      if (b.mode !== 1) {
        // Shrink away bits that drift right up to the lens.
        const d = b.pos.distanceTo(s.camera.position);
        scale *= clamp((d - 2.5) / 3.5);
      }
      tmp.q.setFromAxisAngle(b.axis, t * b.spin + b.bobPhase);
      tmp.s.setScalar(Math.max(scale, 0.0001));
      tmp.m.compose(b.pos, tmp.q, tmp.s);
      mesh.current.setMatrixAt(i, tmp.m);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  });

  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[geometry, material, BIT_COUNT]}
        frustumCulled={false}
        onPointerMove={(e) => {
          if (e.instanceId !== undefined) collect(e.instanceId);
        }}
        onPointerOver={(e) => {
          if (e.instanceId !== undefined) collect(e.instanceId);
        }}
      />
      <Glints bits={bits} />
    </>
  );
}

/** Occasional four-point twinkles riding on the star bits. */
function Glints({ bits }) {
  const geometry = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    const rand = makeRandom(99);
    const phase = new Float32Array(bits.length * 2);
    for (let i = 0; i < bits.length; i++) phase.set([rand.range(0, 100), rand.range(0.25, 0.6)], i * 2);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bits.length * 3), 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 2));
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPx: { value: PX_SCALE } },
        vertexShader: /* glsl */ `
          attribute vec2 aPhase;
          uniform float uTime, uPx;
          varying float vF;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            float c = fract(uTime * aPhase.y + aPhase.x);
            float f = smoothstep(0.0, 0.05, c) * smoothstep(0.16, 0.05, c);
            vF = f;
            gl_PointSize = f * 0.7 * uPx / -mv.z;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vF;
          ${SPRITE_GLSL}
          void main() {
            vec2 p = (gl_PointCoord * 2.0 - 1.0) * vec2(1.3333, 1.0); // undo the anamorphic stretch
            float f = flare4(p, 16.0);
            gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * f * vF * 2.2, 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );
  useFrame((s) => {
    material.uniforms.uTime.value = s.clock.elapsedTime;
    const pos = geometry.attributes.position;
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      if (b.mode === 2) pos.setXYZ(i, 0, -9999, 0);
      else pos.setXYZ(i, b.pos.x, b.pos.y, b.pos.z);
    }
    pos.needsUpdate = true;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

const BURST_PARTS = 10;

/** Little sparkle pops where a star bit was grabbed. */
export function CollectBursts({ state }) {
  const n = state.bursts.length * BURST_PARTS;
  const geometry = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    const dir = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const k = i % BURST_PARTS;
      const a = (k / BURST_PARTS) * Math.PI * 2;
      v.set(Math.cos(a), Math.sin(a), Math.sin(a * 3.0) * 0.4).normalize().multiplyScalar(0.7 + (k % 3) * 0.25);
      dir.set([v.x, v.y, v.z], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uPx: { value: PX_SCALE } },
        vertexShader: /* glsl */ `
          attribute vec3 aDir;
          attribute float aAge;
          attribute vec3 aColor;
          uniform float uPx;
          varying float vA;
          varying vec3 vColor;
          void main() {
            float k = clamp(aAge / 0.7, 0.0, 1.0);
            float e = 1.0 - (1.0 - k) * (1.0 - k);
            vec4 mv = modelViewMatrix * vec4(position + aDir * e * 0.9, 1.0);
            gl_Position = projectionMatrix * mv;
            vA = (1.0 - k) * step(0.0, aAge) * step(aAge, 0.7);
            vColor = aColor;
            gl_PointSize = (0.16 * (1.0 - k) + 0.04) * uPx / -mv.z;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying vec3 vColor;
          ${SPRITE_GLSL}
          void main() {
            vec2 p = (gl_PointCoord * 2.0 - 1.0) * vec2(1.3333, 1.0); // undo the anamorphic stretch
            float f = flare4(p, 14.0);
            gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.5) * f * vA * 2.0, 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );
  useFrame(() => {
    const now = performance.now() / 1000;
    const pos = geometry.attributes.position;
    const age = geometry.attributes.aAge;
    const col = geometry.attributes.aColor;
    state.bursts.forEach((b, bi) => {
      const a = now - b.t0;
      for (let k = 0; k < BURST_PARTS; k++) {
        const i = bi * BURST_PARTS + k;
        pos.setXYZ(i, b.origin.x, b.origin.y, b.origin.z);
        age.setX(i, a);
        col.setXYZ(i, b.color.r, b.color.g, b.color.b);
      }
    });
    pos.needsUpdate = true;
    age.needsUpdate = true;
    col.needsUpdate = true;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Sparkles orbiting each target; they intensify when its entry is focused.

const SPARKS_PER = 40;

export function FocusSparkles({ state }) {
  const geometry = useDisposable(() => {
    const rand = makeRandom(555);
    const n = SPARKS_PER * TARGETS.length;
    const off = new Float32Array(n * 3);
    const data = new Float32Array(n * 4);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const ti = Math.floor(i / SPARKS_PER);
      const r = TARGETS[ti].radius * (TARGETS[ti].id === 'online' ? rand.range(1.1, 1.6) : rand.range(1.1, 1.7));
      v.set(rand.range(-1, 1), rand.range(-0.8, 0.8), rand.range(-1, 1)).normalize().multiplyScalar(r);
      off.set([v.x, v.y, v.z], i * 3);
      data.set([ti, rand.range(0, 100), rand.range(0.6, 1.4), rand.range(0.1, 0.5) * rand.sign()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(off, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPx: { value: PX_SCALE },
          uCenter: { value: TARGETS.map(() => new THREE.Vector3()) },
          uGlow: { value: new Float32Array(TARGETS.length) },
          uBurst: { value: new Float32Array(TARGETS.length) },
          uScale: { value: new Float32Array(TARGETS.map((t) => (t.id === 'online' ? 6 : 1))) },
        },
        vertexShader: /* glsl */ `
          attribute vec4 aData;
          uniform float uTime, uPx;
          uniform vec3 uCenter[${TARGETS.length}];
          uniform float uGlow[${TARGETS.length}];
          uniform float uBurst[${TARGETS.length}];
          uniform float uScale[${TARGETS.length}];
          varying float vA;
          varying float vRot;
          void main() {
            int ti = int(aData.x + 0.5);
            float a = uTime * aData.w;
            vec3 o = position;
            o.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * o.xz;
            float burst = uBurst[ti];
            float bk = burst < 2.0 ? exp(-burst * 2.5) : 0.0;
            o *= 1.0 + (1.0 - exp(-burst * 4.0)) * 0.6 * step(burst, 2.0);
            vec4 mv = modelViewMatrix * vec4(uCenter[ti] + o, 1.0);
            gl_Position = projectionMatrix * mv;
            float tw = 0.5 + 0.5 * sin(uTime * 3.0 * aData.z + aData.y);
            float g = uGlow[ti];
            vA = (0.14 + g * 0.55 + bk * 1.4) * tw * tw;
            vRot = aData.y;
            gl_PointSize = (0.11 + g * 0.05 + bk * 0.16) * uScale[ti] * uPx / -mv.z * (0.6 + 0.6 * tw);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying float vRot;
          ${SPRITE_GLSL}
          void main() {
            vec2 p = (gl_PointCoord * 2.0 - 1.0) * vec2(1.3333, 1.0); // undo the anamorphic stretch
            float f = flare4(p, 12.0);
            gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * f * vA, 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const u = material.uniforms;
    u.uTime.value = t;
    for (let i = 0; i < TARGETS.length; i++) {
      targetPosition(i, t, u.uCenter.value[i]);
      u.uGlow.value[i] = state.glow[i];
      u.uBurst.value[i] = t - state.punch[i];
    }
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Glowing dotted paths linking the planets, with light pulses travelling along.

const LINKS = [
  ['play', 'story', 1.2],
  ['play', 'songs', 1.0],
  ['play', 'wardrobe', 1.4],
  ['play', 'options', 0.9],
  ['story', 'wardrobe', -1.2],
  ['wardrobe', 'online', 4],
];

/** Quadratic bezier between two targets, trimmed to their surfaces. */
function linkCurve(from, to, arc) {
  const ia = TARGET_INDEX[from];
  const ib = TARGET_INDEX[to];
  const a = new THREE.Vector3(...TARGETS[ia].pos);
  const b = new THREE.Vector3(...TARGETS[ib].pos);
  const dir = b.clone().sub(a).normalize();
  a.addScaledVector(dir, TARGETS[ia].radius * 0.95);
  b.addScaledVector(dir, -TARGETS[ib].radius * (to === 'online' ? 1.6 : 0.95));
  const ctrl = a.clone().add(b).multiplyScalar(0.5);
  ctrl.y += arc;
  return {
    a,
    b,
    ctrl,
    at(t, out = new THREE.Vector3()) {
      const u = 1 - t;
      return out.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(ctrl, 2 * u * t).addScaledVector(b, t * t);
    },
    tangent(t, out = new THREE.Vector3()) {
      return out.copy(ctrl).sub(a).multiplyScalar(2 * (1 - t)).addScaledVector(b.clone().sub(ctrl), 2 * t).normalize();
    },
  };
}

/** Golden hoops floating along the launch-star route, like a flight path. */
export function Hoops({ state }) {
  const HOOPS = [0.28, 0.5, 0.72];
  const mesh = useRef();
  const geometry = useDisposable(() => paint(new THREE.TorusGeometry(0.42, 0.045, 8, 40), (x, y, z, nx, ny) => (ny > 0 ? new THREE.Color('#fff1a0') : new THREE.Color('#ffb52e')), 1.1));
  const material = useDisposable(() => makeLit({ rim: '#fff6c8', rimStrength: 0.6, gloss: 1.4, shine: 40, wrap: 0.6 }));
  const curve = useMemo(() => linkCurve('play', 'story', 1.2), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), p: new THREE.Vector3(), tan: new THREE.Vector3(), s: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1) }), []);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const g = Math.max(state.glow[TARGET_INDEX.play], state.glow[TARGET_INDEX.story]);
    material.uniforms.uEmitBoost.value = 0.6 + beat.pulse * 0.5 + g * 0.6;
    HOOPS.forEach((ht, i) => {
      curve.at(ht, tmp.p);
      tmp.p.y += Math.sin(t * 1.1 + i * 1.7) * 0.08;
      curve.tangent(ht, tmp.tan);
      tmp.q.setFromUnitVectors(tmp.z, tmp.tan);
      tmp.q2.setFromAxisAngle(tmp.z, t * 0.8 + i);
      tmp.q.multiply(tmp.q2);
      const pulse = 1 + 0.08 * Math.max(0, Math.sin(t * 2.4 - i * 0.9)) + g * 0.12;
      tmp.s.setScalar((0.85 + i * 0.08) * pulse);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      mesh.current.setMatrixAt(i, tmp.m);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, HOOPS.length]} frustumCulled={false} />;
}

export function StarPaths({ state }) {
  const geometry = useDisposable(() => {
    const pos = [];
    const data = [];
    const p = new THREE.Vector3();
    LINKS.forEach(([from, to, arc], li) => {
      const curve = linkCurve(from, to, arc);
      const { a, b } = curve;
      const len = a.distanceTo(b);
      const n = Math.max(6, Math.floor(len / (to === 'online' ? 0.9 : 0.42)));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        curve.at(t, p);
        pos.push(p.x, p.y, p.z);
        data.push(t, li, i % 5 === 0 ? 1 : 0, len);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aData', new THREE.Float32BufferAttribute(data, 4));
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPx: { value: PX_SCALE },
          uGlow: { value: new Float32Array(LINKS.length) },
          uBeat: { value: 0 },
        },
        vertexShader: /* glsl */ `
          attribute vec4 aData;
          uniform float uTime, uPx, uBeat;
          uniform float uGlow[${LINKS.length}];
          varying float vA;
          varying float vBig;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            int li = int(aData.y + 0.5);
            float g = uGlow[li];
            float travel = fract(aData.x * aData.w / 6.0 - uTime * (0.25 + g * 0.4));
            float pulse = pow(1.0 - travel, 10.0);
            float ends = smoothstep(0.0, 0.06, aData.x) * smoothstep(1.0, 0.94, aData.x);
            vA = (0.45 + 1.1 * pulse + g * 0.7 + uBeat * 0.15) * ends;
            vBig = aData.z;
            gl_PointSize = (0.12 + aData.z * 0.07 + pulse * 0.07 + g * 0.05) * uPx / -mv.z;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying float vBig;
          void main() {
            vec2 p = (gl_PointCoord * 2.0 - 1.0) * vec2(1.3333, 1.0); // undo the anamorphic stretch
            float d = dot(p, p);
            float core = exp(-d * 6.0);
            vec3 col = mix(vec3(0.55, 0.85, 1.0), vec3(1.0, 0.86, 0.5), vBig);
            gl_FragColor = vec4(col * core * vA * 1.4, 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
  );
  useFrame((s) => {
    const u = material.uniforms;
    u.uTime.value = s.clock.elapsedTime;
    u.uBeat.value = beat.pulse;
    LINKS.forEach(([from, to], i) => {
      u.uGlow.value[i] = Math.max(state.glow[TARGET_INDEX[from]] * (from === 'play' ? 0.6 : 1), state.glow[TARGET_INDEX[to]]);
    });
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// A comet that streaks across the far background every so often.

const COMET = {
  p0: new THREE.Vector3(-150, 70, -170),
  p1: new THREE.Vector3(-20, 55, -150),
  p2: new THREE.Vector3(120, 5, -160),
  period: 19,
  duration: 7.5,
  offset: 4,
  lag: 0.2,
};
const TAIL_SEGMENTS = 70;

const COMET_GLSL = /* glsl */ `
  uniform vec3 uP0, uP1, uP2;
  vec3 bez(float t) { float u = 1.0 - t; return u * u * uP0 + 2.0 * u * t * uP1 + t * t * uP2; }
  vec3 bezD(float t) { return 2.0 * (1.0 - t) * (uP1 - uP0) + 2.0 * t * (uP2 - uP1); }
`;

function cometParam(t) {
  return ((t + COMET.offset) % COMET.period) / COMET.duration;
}

export function Comet() {
  const tail = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((TAIL_SEGMENTS + 1) * 2 * 3);
    const data = new Float32Array((TAIL_SEGMENTS + 1) * 2 * 2);
    const idx = [];
    for (let i = 0; i <= TAIL_SEGMENTS; i++) {
      const l = i / TAIL_SEGMENTS;
      data.set([l, -1, l, 1], i * 4);
      if (i < TAIL_SEGMENTS) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(data, 2));
    g.setIndex(idx);
    return g;
  });
  const uniforms = useMemo(
    () => ({ uP0: { value: COMET.p0 }, uP1: { value: COMET.p1 }, uP2: { value: COMET.p2 }, uS: { value: -1 }, uLag: { value: COMET.lag }, uTime: { value: 0 } }),
    [],
  );
  const tailMat = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: /* glsl */ `
          attribute vec2 aData;
          uniform float uS, uLag;
          varying float vL;
          varying float vA;
          varying float vSide;
          ${COMET_GLSL}
          void main() {
            float l = aData.x;
            float s = uS - l * uLag;
            float sc = clamp(s, 0.0, 1.0);
            vec3 p = bez(sc);
            vec3 tg = normalize(bezD(sc));
            vec4 mv = viewMatrix * vec4(p, 1.0);
            vec3 tv = (viewMatrix * vec4(tg, 0.0)).xyz;
            vec2 perp = normalize(vec2(-tv.y, tv.x) + 1e-5);
            float w = mix(1.3, 4.5, pow(max(l, 1e-4), 0.7)) * (1.0 - smoothstep(0.75, 1.0, l));
            mv.xy += perp * aData.y * w;
            gl_Position = projectionMatrix * mv;
            vL = l;
            vSide = aData.y;
            vA = step(0.0, s) * step(s, 1.0) * smoothstep(0.0, 0.08, uS) * (1.0 - smoothstep(0.85, 1.0, uS - uLag * 0.5));
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vL;
          varying float vA;
          varying float vSide;
          uniform float uTime;
          void main() {
            // Clamp: MSAA can extrapolate varyings slightly past the triangle.
            float edge = clamp(1.0 - abs(vSide), 0.0, 1.0);
            float l = clamp(vL, 0.0, 1.0);
            float core = edge * sqrt(edge);
            float fall = pow(max(1.0 - l, 1e-4), 1.6);
            vec3 head = vec3(0.85, 0.97, 1.0);
            vec3 mid = vec3(0.45, 0.7, 1.0);
            vec3 tailC = vec3(0.85, 0.4, 1.0);
            vec3 col = mix(head, mid, smoothstep(0.0, 0.25, l));
            col = mix(col, tailC, smoothstep(0.3, 0.9, l));
            float streaks = 0.75 + 0.25 * sin(vSide * 9.0 + l * 40.0 - uTime * 6.0);
            gl_FragColor = vec4(max(col * core * fall * vA * 1.6 * streaks, 0.0), 1.0);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
  );
  const glowTex = useDisposable(() => makeGlowTexture(64, 2.0));
  const headMat = useDisposable(
    () => new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1.6, 1.8, 2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    [glowTex],
  );
  const head = useRef();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const sp = cometParam(t);
    uniforms.uS.value = sp;
    uniforms.uTime.value = t;
    const visible = sp >= 0 && sp <= 1;
    head.current.visible = visible;
    if (visible) {
      const u = 1 - sp;
      tmp.set(0, 0, 0).addScaledVector(COMET.p0, u * u).addScaledVector(COMET.p1, 2 * u * sp).addScaledVector(COMET.p2, sp * sp);
      head.current.position.copy(tmp);
      const fade = Math.min(1, sp / 0.06) * Math.min(1, (1 - sp) / 0.06);
      head.current.scale.setScalar(7 * fade + 0.01);
    }
  });
  return (
    <>
      <mesh geometry={tail} material={tailMat} frustumCulled={false} renderOrder={-600} />
      <sprite ref={head} material={headMat} renderOrder={-599} />
    </>
  );
}
