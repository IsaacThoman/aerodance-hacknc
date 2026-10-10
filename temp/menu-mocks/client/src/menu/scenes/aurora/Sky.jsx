import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { noise } from '../../shared/glsl.js';
import { env, fx, SKY_RADIUS } from './state.js';

/** Deep sapphire night sky: gradient, aurora horizon glow, Milky Way and a crescent moon. */
export function NightSky() {
  const mesh = useRef();
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTime: env.uTime,
          uMoonDir: env.uMoonDir,
          uZenith: env.uZenith,
          uMid: env.uMid,
          uHorizon: env.uHorizon,
          uAurora0: env.uAurora0,
          uAurora1: env.uAurora1,
          uAurora2: env.uAurora2,
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uMoonDir, uZenith, uMid, uHorizon, uAurora0, uAurora1, uAurora2;
          varying vec3 vDir;
          ${noise}
          void main() {
            vec3 d = normalize(vDir);
            float hh = max(d.y, 0.0);
            vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, hh));
            col = mix(col, uZenith, smoothstep(0.16, 0.8, hh));

            // Aurora light scattered low over the northern horizon.
            float north = smoothstep(-0.35, 0.85, -d.z);
            col += (uAurora0 * 0.02 + uAurora1 * 0.016) * exp(-hh * 8.0) * north;
            col += uAurora1 * 0.008 * exp(-hh * 2.5) * north;
            col += uAurora2 * 0.01 * smoothstep(0.25, 0.75, hh) * north;

            // Milky Way: a soft clumpy band with a dust lane.
            vec3 mwN = normalize(vec3(0.791, 0.164, 0.589));
            float b = dot(d, mwN);
            float band = exp(-b * b * 30.0);
            float n = fbm(d * 3.2 + vec3(3.1, 1.7, 0.0)) * 0.5 + 0.5;
            float ld = (b + 0.015 + 0.04 * snoise(d * 7.0)) * 34.0;
            float lane = exp(-ld * ld);
            float mw = band * (0.25 + 0.75 * n * n) * (1.0 - 0.7 * lane);
            col += mix(vec3(0.3, 0.36, 0.6), vec3(0.55, 0.48, 0.5), n * band) * mw * 0.24 * smoothstep(0.03, 0.4, hh);

            // Crescent moon with earthshine and halo.
            vec3 m = normalize(uMoonDir);
            float ca = dot(d, m);
            vec3 tx = normalize(cross(vec3(0.0, 1.0, 0.0), m));
            vec3 ty = cross(m, tx);
            float R = 0.024;
            vec2 q = vec2(dot(d, tx), dot(d, ty)) / R;
            float aa = (fwidth(q.x) + fwidth(q.y)) * 0.7;
            float disc = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, length(q))) * step(0.0, ca);
            float sh = 1.0 - smoothstep(0.92 - aa, 0.92 + aa, length(q - vec2(-0.5, 0.3)));
            float lit = disc * (1.0 - sh);
            float maria = 0.86 + 0.14 * snoise(vec3(q * 1.7, 4.0));
            col += vec3(1.0, 0.95, 0.84) * lit * 2.4 * maria;
            col += vec3(0.16, 0.2, 0.34) * disc * sh * 0.35;
            float ang = acos(clamp(ca, -1.0, 1.0));
            col += vec3(0.3, 0.42, 0.75) * (exp(-ang * 30.0) * 0.16 + exp(-ang * 7.0) * 0.022) * step(0.0, ca);

            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );

  useFrame((state) => {
    mesh.current.position.copy(state.camera.position);
  });

  return (
    <mesh ref={mesh} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[SKY_RADIUS, 64, 32]} />
    </mesh>
  );
}

/** Point stars on a large shell that follows the camera; extra density along the Milky Way. */
export function Stars({ count = 2600, milkyCount = 2400 }) {
  const group = useRef();
  const geometry = useDisposable(() => {
    const rand = makeRandom(4242);
    const total = count + milkyCount;
    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const size = new Float32Array(total);
    const phase = new Float32Array(total);
    const mwN = new THREE.Vector3(0.791, 0.164, 0.589).normalize();
    const tmp = new THREE.Vector3();
    const palette = [
      [0.75, 0.85, 1.0],
      [1.0, 1.0, 1.0],
      [1.0, 0.94, 0.82],
      [1.0, 0.9, 0.8],
      [0.7, 0.8, 1.0],
    ];
    let i = 0;
    while (i < total) {
      tmp.set(rand.range(-1, 1), rand.range(-0.08, 1), rand.range(-1, 1));
      if (tmp.lengthSq() > 1 || tmp.lengthSq() < 0.01) continue;
      tmp.normalize();
      if (i >= count) {
        // Milky Way star cloud: keep only directions near the band.
        const b = tmp.dot(mwN);
        if (Math.abs(b) > 0.2 || rand.next() > Math.exp(-b * b * 60)) continue;
      }
      pos.set([tmp.x * SKY_RADIUS * 0.94, tmp.y * SKY_RADIUS * 0.94, tmp.z * SKY_RADIUS * 0.94], i * 3);
      const r = rand.next();
      const bright = i >= count ? 0.18 + r * 0.3 : 0.25 + Math.pow(r, 7) * 3.2;
      const c = rand.pick(palette);
      col.set([c[0] * bright, c[1] * bright, c[2] * bright], i * 3);
      size[i] = i >= count ? 2.0 : 2.1 + Math.pow(r, 5) * 2.4;
      phase[i] = rand.next();
      i++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    return g;
  });

  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: env.uTime },
        vertexShader: /* glsl */ `
          attribute vec3 aColor;
          attribute float aSize;
          attribute float aPhase;
          uniform float uTime;
          varying vec3 vColor;
          void main() {
            vec3 dir = normalize(position);
            float tw = 0.72 + 0.28 * sin(uTime * (1.2 + aPhase * 3.5) + aPhase * 60.0);
            float horizon = smoothstep(0.0, 0.14, dir.y);
            vColor = aColor * tw * horizon;
            gl_PointSize = aSize;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          void main() {
            vec2 p = gl_PointCoord - 0.5;
            float a = exp(-dot(p, p) * 14.0);
            gl_FragColor = vec4(vColor * a, 1.0);
          }
        `,
      }),
  );

  useFrame((state) => {
    group.current.position.copy(state.camera.position);
  });

  return (
    <group ref={group}>
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-900} />
    </group>
  );
}

/** Occasional shooting star streaking across the sky (also on demand via fx.shoot). */
export function ShootingStar() {
  const state = useRef({ age: 99, next: 5, dur: 0.9, from: new THREE.Vector3(), dir: new THREE.Vector3(), rand: makeRandom(77) });
  const geometry = useDisposable(() => {
    const seg = 12;
    const pos = new Float32Array((seg + 1) * 2 * 3);
    const t = new Float32Array((seg + 1) * 2);
    const side = new Float32Array((seg + 1) * 2);
    const idx = [];
    for (let i = 0; i <= seg; i++) {
      for (let s = 0; s < 2; s++) {
        t[i * 2 + s] = i / seg;
        side[i * 2 + s] = s ? 1 : -1;
      }
      if (i < seg) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(idx);
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uHead: { value: new THREE.Vector3() }, uTail: { value: new THREE.Vector3() }, uAlpha: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute float aT;
          attribute float aSide;
          uniform vec3 uHead, uTail;
          varying float vT;
          varying float vSide;
          void main() {
            vec4 h = viewMatrix * vec4(uHead, 1.0);
            vec4 t = viewMatrix * vec4(uTail, 1.0);
            vec4 p = mix(t, h, aT);
            vec2 dd = h.xy / -h.z - t.xy / -t.z;
            vec2 dir = dot(dd, dd) > 1e-12 ? normalize(dd) : vec2(1.0, 0.0);
            vec2 perp = vec2(-dir.y, dir.x);
            p.xy += perp * aSide * 0.0032 * (-p.z) * mix(0.25, 1.0, aT);
            vT = aT;
            vSide = aSide;
            gl_Position = projectionMatrix * p;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          varying float vT;
          varying float vSide;
          void main() {
            float a = pow(clamp(vT, 0.0, 1.0), 2.2) * exp(-vSide * vSide * 3.0) * uAlpha;
            vec3 c = mix(vec3(0.5, 0.9, 1.0), vec3(1.0), vT * vT);
            gl_FragColor = vec4(c * a * 3.5, 1.0);
          }
        `,
      }),
  );
  const mesh = useRef();

  useFrame((three, delta) => {
    const s = state.current;
    const u = material.uniforms;
    s.age += delta;
    if ((s.age > s.next || fx.shoot) && s.age > s.dur) {
      const r = s.rand;
      // Requested stars go to the darker sky on the right of the moon.
      const az = THREE.MathUtils.degToRad(fx.shoot ? r.range(8, 42) : r.range(-40, 42));
      const el = THREE.MathUtils.degToRad(r.range(17, 30));
      fx.shoot = false;
      s.from.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      // Mostly downward, sideways drift.
      const side = r.sign();
      s.dir.set(side * r.range(0.7, 1.0), -r.range(0.3, 0.55), r.range(-0.15, 0.15)).normalize();
      s.dur = r.range(0.7, 1.1);
      s.age = 0;
      s.next = r.range(7, 16);
    }
    const p = s.age / s.dur;
    const cam = three.camera.position;
    if (p < 1) {
      const travel = 0.3;
      const head = Math.min(p * 1.15, 1) * travel;
      const tail = Math.max(head - 0.12, 0);
      u.uHead.value.copy(s.dir).multiplyScalar(head).add(s.from).normalize().multiplyScalar(SKY_RADIUS * 0.9).add(cam);
      u.uTail.value.copy(s.dir).multiplyScalar(tail).add(s.from).normalize().multiplyScalar(SKY_RADIUS * 0.9).add(cam);
      u.uAlpha.value = Math.sin(Math.PI * Math.min(p, 1)) ** 0.7;
      mesh.current.visible = true;
    } else {
      mesh.current.visible = false;
    }
  });

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} renderOrder={-800} />;
}
