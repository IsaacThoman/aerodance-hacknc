import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { DOME_POS, DOME_RADIUS, env, LIGHTING } from './state.js';
import { makeLitMaterial, paint } from './materials.js';
import { lanternState } from './lanterns.js';

const R = DOME_RADIUS;
const BASE_Y = DOME_POS.y;

// Jetty runs from the dome deck out into the lake, angled toward the camera.
const JETTY_START = new THREE.Vector3(DOME_POS.x - R - 1.2, 0, DOME_POS.z + 5.5);
const JETTY_DIR = new THREE.Vector3(-1, 0, 0.42).normalize();
const JETTY_LEN = 24;
const JETTY_Y = 1.05;
const JETTY_SIDE = new THREE.Vector3(-JETTY_DIR.z, 0, JETTY_DIR.x);
const JETTY_END = JETTY_START.clone().addScaledVector(JETTY_DIR, JETTY_LEN);
const PIPE = new THREE.Vector3(DOME_POS.x + 4.2, DOME_POS.y + 10.4, DOME_POS.z - 3.6);

function buildDomeGeometry() {
  const ico = new THREE.IcosahedronGeometry(R, 2);
  const t = (1 + Math.sqrt(5)) / 2;
  ico.rotateZ(Math.atan2(1, t));
  const p = ico.attributes.position;
  const pos = [];
  const bary = [];
  const rnd = [];
  const nrm = [];
  const rand = makeRandom(12);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let f = 0; f < p.count; f += 3) {
    a.fromBufferAttribute(p, f);
    b.fromBufferAttribute(p, f + 1);
    c.fromBufferAttribute(p, f + 2);
    if ((a.y + b.y + c.y) / 3 < -0.14 * R) continue;
    n.copy(a).add(b).add(c).normalize();
    const r = rand.next();
    for (const [v, bc] of [
      [a, [1, 0, 0]],
      [b, [0, 1, 0]],
      [c, [0, 0, 1]],
    ]) {
      pos.push(v.x, Math.max(v.y, 0), v.z);
      bary.push(...bc);
      rnd.push(r);
      nrm.push(n.x, n.y, n.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aBary', new THREE.Float32BufferAttribute(bary, 3));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 1));
  return g;
}

function makeGlassMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...env, uBaseY: { value: BASE_Y } },
    vertexShader: /* glsl */ `
      attribute vec3 aBary;
      attribute float aRand;
      varying vec3 vBary;
      varying float vRand;
      varying vec3 vN;
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vBary = aBary;
        vRand = aRand;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBaseY;
      uniform vec3 uZenith;
      varying vec3 vBary;
      varying float vRand;
      varying vec3 vN;
      varying vec3 vWorld;
      ${LIGHTING}
      void main() {
        float e = min(min(vBary.x, vBary.y), vBary.z);
        float fw = fwidth(e);
        float frame = 1.0 - smoothstep(0.045, 0.045 + fw * 1.5, e);
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = abs(dot(N, V));
        float fres = pow(clamp(1.0 - ndv, 0.0, 1.0), 3.0);
        vec3 Rf = reflect(-V, N);
        float up = clamp(Rf.y, 0.0, 1.0);
        vec3 sky = mix(uHazeCol * 1.5, uZenith * 2.0, up) + uAuroraGlow * 3.0 * smoothstep(0.05, 0.5, up) * smoothstep(-0.3, 0.8, -Rf.z);
        vec3 col = sky * (0.4 + 1.4 * fres);
        float a = 0.16 + 0.6 * fres + vRand * 0.05;
        // Frosted lower panes glow amber from the light inside.
        float hgt = vWorld.y - uBaseY;
        float frost = smoothstep(2.8, 0.3, hgt + (vRand - 0.5) * 1.2) * (0.55 + 0.3 * vRand);
        col = mix(col, vec3(1.25, 0.62, 0.26), frost);
        a = mix(a, 0.85, frost);
        // Frame struts: moonlit outside, warm rim from inside.
        vec3 frameCol = vec3(0.86, 0.9, 1.0) * (uMoonCol * max(dot(N, uLightDir), 0.0) + uSkyAmb * 1.5) + vec3(1.0, 0.5, 0.2) * 0.22;
        col = mix(col, frameCol, frame);
        a = mix(a, 1.0, frame);
        // Snow cap on the flattest top panes.
        float snow = smoothstep(0.84, 0.93, N.y + (vRand - 0.5) * 0.18);
        vec3 snowCol = shade(vec3(0.8, 0.86, 0.97), N, vWorld, 0.2);
        col = mix(col, snowCol, snow);
        a = mix(a, 1.0, snow);
        col = applyHaze(col, vWorld, 1.0);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

function makeInteriorMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uTime: env.uTime, uBaseY: { value: BASE_Y }, uCenter: { value: DOME_POS } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uBaseY;
      uniform vec3 uCenter;
      varying vec3 vWorld;
      void main() {
        float h = clamp((vWorld.y - uBaseY) / ${R.toFixed(1)}, 0.0, 1.0);
        vec3 c = mix(vec3(1.5, 0.66, 0.26), vec3(0.22, 0.08, 0.04), pow(max(h, 0.0), 0.6));
        // Lamp hotspot on the back wall.
        vec3 lamp = uCenter + vec3(2.5, 3.0, -4.0);
        float flick = 0.94 + 0.06 * sin(uTime * 7.0) * sin(uTime * 3.1);
        c += vec3(1.8, 0.9, 0.4) * exp(-length(vWorld - lamp) * 0.32) * flick;
        // Bookshelf / window bands for texture.
        float band = step(0.5, fract(atan(vWorld.z - uCenter.z, vWorld.x - uCenter.x) * 3.0)) * smoothstep(0.15, 0.2, h) * smoothstep(0.42, 0.36, h);
        c *= 1.0 - band * 0.35;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

function buildInterior() {
  const parts = [];
  const at = (g, x, y, z, ry = 0) => {
    g.rotateY(ry);
    g.translate(DOME_POS.x + x, BASE_Y + y, DOME_POS.z + z);
    return g;
  };
  // Floor and rug.
  parts.push(paint(at(new THREE.CylinderGeometry(R * 0.97, R * 0.97, 0.2, 40), 0, 0.05, 0), '#a5552a', 1));
  parts.push(paint(at(new THREE.CylinderGeometry(3.2, 3.2, 0.06, 32), 0.5, 0.18, 1.0), '#e0a070', 1));
  // Sofa facing the glass toward the lake.
  parts.push(paint(at(new THREE.BoxGeometry(4.2, 1.0, 1.5), 1.0, 0.6, -2.4, -0.5), '#3a1a14', 1));
  parts.push(paint(at(new THREE.BoxGeometry(4.2, 1.5, 0.45), 1.3, 1.1, -3.1, -0.5), '#2e140f', 1));
  // Floor lamp.
  parts.push(paint(at(new THREE.CylinderGeometry(0.06, 0.06, 3.0, 6), 3.4, 1.6, -3.4), '#1a0d08', 1));
  parts.push(paint(at(new THREE.CylinderGeometry(0.45, 0.75, 0.75, 12, 1, true), 3.4, 3.2, -3.4), '#ffcf8a', 2.6));
  // Little decorated pine.
  parts.push(paint(at(new THREE.ConeGeometry(1.3, 3.6, 9), -3.6, 2.0, -2.0), '#0e2a1a', 1));
  parts.push(paint(at(new THREE.OctahedronGeometry(0.28), -3.6, 4.0, -2.0), '#ffe28a', 4));
  // Plant and side table.
  parts.push(paint(at(new THREE.CylinderGeometry(0.6, 0.6, 0.8, 10), -1.6, 0.5, 2.8), '#2a120a', 1));
  parts.push(paint(at(new THREE.SphereGeometry(0.75, 8, 6), -1.6, 1.3, 2.8), '#173a1e', 1));
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}

function buildDeckAndJetty() {
  const parts = [];
  const rand = makeRandom(31);
  // Deck ring around the dome.
  const deck = new THREE.LatheGeometry(
    [new THREE.Vector2(R - 0.3, 0.22), new THREE.Vector2(R + 2.6, 0.22), new THREE.Vector2(R + 2.75, 0.05), new THREE.Vector2(R + 2.75, -0.9)].reverse(),
    48,
  );
  deck.translate(DOME_POS.x, BASE_Y, DOME_POS.z);
  parts.push(paint(deck, '#5a3a24'));
  // Steps from the deck down to the jetty.
  const yaw = Math.atan2(-JETTY_DIR.z, JETTY_DIR.x);
  const place = (g, along, side, y, extraYaw = 0) => {
    g.rotateY(yaw + extraYaw);
    const p = JETTY_START.clone().addScaledVector(JETTY_DIR, along).addScaledVector(JETTY_SIDE, side);
    g.translate(p.x, y, p.z);
    return g;
  };
  // Planks.
  for (let s = 0.3; s < JETTY_LEN; s += 0.66) {
    const g = new THREE.BoxGeometry(0.56, 0.14, 3.0 + rand.range(-0.1, 0.1));
    const shade = rand.range(0, 1);
    parts.push(paint(place(g, s, rand.range(-0.06, 0.06), JETTY_Y + rand.range(-0.03, 0.03), rand.range(-0.03, 0.03)), shade > 0.5 ? '#6a4630' : '#5a3a26'));
  }
  // Stringers.
  for (const side of [-1.1, 1.1]) {
    parts.push(paint(place(new THREE.BoxGeometry(JETTY_LEN, 0.3, 0.25), JETTY_LEN / 2, side, JETTY_Y - 0.22), '#3a2617'));
  }
  // Posts with string-light hooks, and two tall lantern posts at the end.
  const posts = [];
  for (let s = 0.5; s <= JETTY_LEN; s += 4.7) {
    for (const side of [-1.55, 1.55]) {
      const tall = s > JETTY_LEN - 4.7;
      const h = tall ? 4.4 : 3.9;
      const g = new THREE.CylinderGeometry(0.16, 0.19, h, 7);
      parts.push(paint(place(g, s, side, JETTY_Y + 1.8 - h / 2 + (tall ? 0.5 : 0)), '#3e2a1b'));
      posts.push({ s, side, top: JETTY_Y + 1.8 + (tall ? 0.5 : 0) });
      if (tall) {
        parts.push(paint(place(new THREE.BoxGeometry(0.5, 0.62, 0.5), s, side, JETTY_Y + 2.75), '#ffb35c', 2.2));
        parts.push(paint(place(new THREE.BoxGeometry(0.7, 0.12, 0.7), s, side, JETTY_Y + 3.15), '#1c120b', 1));
      }
    }
  }
  // Stovepipe poking out of the dome's back shoulder.
  const pipe = new THREE.CylinderGeometry(0.28, 0.28, 3.4, 8);
  pipe.translate(PIPE.x, PIPE.y - 1.7, PIPE.z);
  parts.push(paint(pipe, '#20242c'));
  const cap = new THREE.CylinderGeometry(0.55, 0.42, 0.22, 8);
  cap.translate(PIPE.x, PIPE.y + 0.12, PIPE.z);
  parts.push(paint(cap, '#2a2f38'));
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return { geometry: g, posts };
}

function buildStringLights(posts) {
  const pts = [];
  const cols = [];
  const phase = [];
  const rand = makeRandom(8);
  const warm = [
    [1.0, 0.72, 0.35],
    [1.0, 0.82, 0.5],
    [1.0, 0.6, 0.3],
  ];
  const add = (p) => {
    pts.push(p.x, p.y, p.z);
    const c = rand.pick(warm);
    cols.push(...c);
    phase.push(rand.next());
  };
  for (const side of [-1.55, 1.55]) {
    const row = posts.filter((p) => p.side === side).sort((a, b) => a.s - b.s);
    for (let i = 0; i < row.length - 1; i++) {
      const a = row[i];
      const b = row[i + 1];
      for (let k = 0; k < 7; k++) {
        const t = k / 7;
        const s = a.s + (b.s - a.s) * t;
        const sag = Math.sin(t * Math.PI) * 0.55;
        const y = a.top + (b.top - a.top) * t - 0.1 - sag;
        add(JETTY_START.clone().addScaledVector(JETTY_DIR, s).addScaledVector(JETTY_SIDE, side).setY(y));
      }
    }
  }
  // A ring of lights around the dome at shoulder height.
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    const y = 2.6 + Math.sin(a * 6) * 0.25;
    const r = Math.sqrt(R * R - y * y) + 0.15;
    add(new THREE.Vector3(DOME_POS.x + Math.cos(a) * r, BASE_Y + y, DOME_POS.z + Math.sin(a) * r));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(cols, 3));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  return g;
}

export function Cabin() {
  const data = useDisposable(() => {
    const jetty = buildDeckAndJetty();
    return {
      dome: buildDomeGeometry(),
      glass: makeGlassMaterial(),
      shell: new THREE.SphereGeometry(R * 0.965, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      shellMat: makeInteriorMaterial(),
      interior: buildInterior(),
      jetty: jetty.geometry,
      wood: makeLitMaterial({ snow: 0.85, wrap: 0.3 }),
      lights: buildStringLights(jetty.posts),
      lightMat: new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: env.uTime },
        vertexShader: /* glsl */ `
          attribute vec3 aColor;
          attribute float aPhase;
          uniform float uTime;
          varying vec3 vColor;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float tw = 0.7 + 0.3 * sin(uTime * (1.0 + aPhase * 2.0) + aPhase * 40.0);
            vColor = aColor * tw * 3.0;
            gl_PointSize = clamp(150.0 / -mv.z, 2.0, 5.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          void main() {
            vec2 p = gl_PointCoord - 0.5;
            float a = exp(-dot(p, p) * 12.0);
            gl_FragColor = vec4(vColor * a, 1.0);
          }
        `,
      }),
    };
  }, []);

  return (
    <group>
      <mesh geometry={data.shell} material={data.shellMat} position={[DOME_POS.x, BASE_Y, DOME_POS.z]} />
      <mesh geometry={data.interior} material={data.wood} />
      <mesh geometry={data.jetty} material={data.wood} />
      <mesh geometry={data.dome} material={data.glass} position={[DOME_POS.x, BASE_Y, DOME_POS.z]} renderOrder={2} />
      <points geometry={data.lights} material={data.lightMat} frustumCulled={false} renderOrder={3} />
      <WaterLanterns />
      <Smoke />
      <Watcher />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Lanterns: paper lanterns floating near the jetty.

function buildLanternGeometry() {
  const paper = new THREE.CylinderGeometry(0.34, 0.4, 0.62, 10, 2);
  paper.translate(0, 0.36, 0);
  const top = new THREE.CylinderGeometry(0.2, 0.36, 0.1, 10);
  top.translate(0, 0.72, 0);
  const baseG = new THREE.CylinderGeometry(0.44, 0.44, 0.08, 10);
  const part = (g, kind) => {
    const n = g.attributes.position.count;
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(n).fill(kind), 1));
    if (g.attributes.uv) g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const g = mergeGeometries([part(paper, 1), part(top, 0), part(baseG, 0)]);
  return g;
}

function makeLanternMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: env.uTime },
    vertexShader: /* glsl */ `
      attribute float aKind;
      uniform float uTime;
      varying float vKind;
      varying float vY;
      varying float vFlick;
      void main() {
        float id = float(gl_InstanceID);
        vKind = aKind;
        vY = position.y;
        vFlick = 0.85 + 0.15 * sin(uTime * (6.0 + id) + id * 3.7) * sin(uTime * 2.3 + id);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vKind;
      varying float vY;
      varying float vFlick;
      void main() {
        vec3 glow = mix(vec3(2.2, 1.0, 0.36), vec3(1.3, 0.5, 0.2), smoothstep(0.1, 0.7, vY)) * vFlick;
        vec3 col = vKind > 0.5 ? glow : vec3(0.05, 0.025, 0.015);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

const WATER_LANTERNS = 6;

function WaterLanterns() {
  const data = useDisposable(() => ({ geo: buildLanternGeometry(), mat: makeLanternMaterial() }), []);
  const ref = useRef();
  const seeds = useRef(
    Array.from({ length: WATER_LANTERNS }, (_, i) => {
      const r = makeRandom(200 + i);
      return {
        cx: JETTY_END.x + r.range(-14, 6),
        cz: JETTY_END.z + r.range(-12, 10),
        rad: r.range(1.5, 5),
        speed: r.range(0.03, 0.07) * r.sign(),
        ph: r.range(0, Math.PI * 2),
        s: r.range(0.85, 1.15),
      };
    }),
  );
  const tmp = useRef({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3() });
  useLayoutEffect(() => {
    lanternState.water = seeds.current.map(() => ({ x: 0, z: 0, phase: 0 }));
    return () => {
      lanternState.water = [];
    };
  }, []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const { m, q, e, p, s } = tmp.current;
    seeds.current.forEach((l, i) => {
      const a = l.ph + t * l.speed;
      const x = l.cx + Math.cos(a) * l.rad;
      const z = l.cz + Math.sin(a) * l.rad;
      const bob = Math.sin(t * 1.3 + l.ph * 3) * 0.06;
      e.set(Math.sin(t * 0.9 + l.ph) * 0.08, a, Math.cos(t * 1.1 + l.ph) * 0.08);
      q.setFromEuler(e);
      p.set(x, 0.02 + bob, z);
      s.setScalar(l.s);
      m.compose(p, q, s);
      ref.current.setMatrixAt(i, m);
      const w = lanternState.water[i];
      if (w) {
        w.x = x;
        w.z = z;
        w.phase = l.ph * 5;
      }
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[data.geo, data.mat, WATER_LANTERNS]} frustumCulled={false} />;
}


// ---------------------------------------------------------------------------
// Wood smoke curling up from the stovepipe and drifting with the breeze.

const PUFFS = 16;
const PUFF_LIFE = 9;

function Smoke() {
  const data = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(PUFFS * 2);
    const rand = makeRandom(404);
    for (let i = 0; i < PUFFS; i++) {
      seed[i * 2] = i / PUFFS;
      seed[i * 2 + 1] = rand.next();
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PUFFS * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      uniforms: { uTime: env.uTime, uOrigin: { value: PIPE.clone().add(new THREE.Vector3(0, 0.3, 0)) }, uMoonCol: env.uMoonCol, uWarmCol: env.uWarmCol, uAuroraGlow: env.uAuroraGlow },
      vertexShader: /* glsl */ `
        attribute vec2 aSeed;
        uniform float uTime;
        uniform vec3 uOrigin;
        varying float vAlpha;
        varying float vAge;
        void main() {
          float age = fract(uTime / ${PUFF_LIFE.toFixed(1)} + aSeed.x);
          float t = age * ${PUFF_LIFE.toFixed(1)};
          vec3 p = uOrigin;
          p.y += 7.0 * (1.0 - exp(-t * 0.35)) + t * 0.25;
          p.x += t * t * 0.09 + sin(t * 0.9 + aSeed.y * 6.0) * 0.35 * t * 0.3;
          p.z -= t * 0.35 + cos(t * 0.7 + aSeed.y * 4.0) * 0.2 * t;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float worldSize = mix(0.7, 4.2, sqrt(age));
          gl_PointSize = worldSize * 480.0 / (2.0 * 0.4877) / -mv.z;
          vAlpha = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.45, 1.0, age));
          vAge = age;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uMoonCol;
        uniform vec3 uWarmCol;
        uniform vec3 uAuroraGlow;
        varying float vAlpha;
        varying float vAge;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float r = length(p) * 2.0;
          float a = smoothstep(1.0, 0.2, r) * vAlpha * 0.32;
          // Warm from the dome when fresh, moonlit and aurora-tinted as it rises.
          vec3 c = mix(uWarmCol * 0.18, uMoonCol * 0.55 + uAuroraGlow * 3.0, smoothstep(0.0, 0.35, vAge));
          c *= 0.85 + 0.3 * (0.5 - p.y);
          gl_FragColor = vec4(c * a, a);
        }
      `,
    });
    return { g, m };
  }, []);
  return <points geometry={data.g} material={data.m} frustumCulled={false} renderOrder={4} />;
}

// ---------------------------------------------------------------------------
// A tiny figure in a red parka at the end of the jetty, gazing up at the lights.

function buildWatcher() {
  const parts = [];
  const add = (g, color, x, y, z, emit = 0) => {
    g.translate(x, y, z);
    parts.push(paint(g, color, emit));
  };
  add(new THREE.CylinderGeometry(0.11, 0.1, 0.8, 6), '#1b1e2a', -0.13, 0.4, 0);
  add(new THREE.CylinderGeometry(0.11, 0.1, 0.8, 6), '#1b1e2a', 0.13, 0.4, 0);
  add(new THREE.CapsuleGeometry(0.3, 0.55, 3, 8), '#d83a40', 0, 1.15, 0, 0.75);
  add(new THREE.SphereGeometry(0.2, 10, 8), '#e9c4a8', 0, 1.72, -0.02);
  add(new THREE.SphereGeometry(0.23, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), '#f1f1f6', 0, 1.76, 0, 0.5);
  add(new THREE.SphereGeometry(0.09, 8, 6), '#ffffff', 0, 2.0, 0);
  add(new THREE.TorusGeometry(0.2, 0.07, 6, 12).rotateX(Math.PI / 2), '#f5d061', 0, 1.5, 0);
  // Hand lantern.
  add(new THREE.BoxGeometry(0.16, 0.22, 0.16), '#ffc070', 0.42, 0.85, -0.05, 3);
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}

function Watcher() {
  const data = useDisposable(() => ({ g: buildWatcher(), m: makeLitMaterial({ snow: 0, wrap: 0.4 }) }), []);
  const ref = useRef();
  const pos = JETTY_START.clone().addScaledVector(JETTY_DIR, JETTY_LEN - 1.6).addScaledVector(JETTY_SIDE, 0.4);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Idle sway and an occasional glance across the sky.
    ref.current.rotation.set(0.06 + Math.sin(t * 0.6) * 0.02, 0.35 + Math.sin(t * 0.13) * 0.45, Math.sin(t * 0.8) * 0.02);
  });
  return <mesh ref={ref} geometry={data.g} material={data.m} position={[pos.x, JETTY_Y + 0.08, pos.z]} scale={1.3} />;
}
