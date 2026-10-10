import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { beat, useDisposable } from '../../shared/hooks.js';
import { makeRandom } from '../../shared/random.js';
import { lightUniforms, meadowFx, windUniforms } from './fx.js';
import { heightAt } from './terrain.js';

const flat = (g) => (g.index ? g.toNonIndexed() : g);

// ------------------------------------------------------------ environment

/** Sunny sky PMREM for glossy white plastics; restores the old env on unmount. */
export function SkyEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 sky = mix(vec3(0.75, 0.88, 1.0), vec3(0.12, 0.38, 0.9), pow(max(h, 0.0), 0.6));
          vec3 ground = mix(vec3(0.5, 0.56, 0.42), vec3(0.32, 0.42, 0.24), clamp(-h * 3.0, 0.0, 1.0));
          vec3 col = h > 0.0 ? sky : ground;
          vec3 sunDir = normalize(vec3(-0.45, 0.6, -0.5));
          col += vec3(6.0, 5.6, 4.8) * pow(max(dot(vDir, sunDir), 0.0), 300.0);
          col += vec3(0.6, 0.55, 0.4) * pow(max(dot(vDir, sunDir), 0.0), 12.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    envScene.add(new THREE.Mesh(geo, mat));
    const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
    const previous = scene.environment;
    scene.environment = rt.texture;
    geo.dispose();
    mat.dispose();
    pmrem.dispose();
    return () => {
      scene.environment = previous;
      rt.dispose();
    };
  }, [gl, scene]);
  return null;
}

// ----------------------------------------------------------------- gazebo

function octRing(radius, tube, y) {
  const g = new THREE.TorusGeometry(radius, tube, 6, 8);
  g.rotateX(Math.PI / 2);
  g.rotateY(Math.PI / 8);
  g.translate(0, y, 0);
  return g;
}

function buildGazebo() {
  const white = [];
  const trim = [];
  const roof = [];
  const gold = [];
  const ceiling = [];
  // Two-step octagonal plinth.
  const s1 = new THREE.CylinderGeometry(3.5, 3.7, 0.45, 8);
  s1.translate(0, 0.0, 0);
  const s2 = new THREE.CylinderGeometry(3.15, 3.25, 0.32, 8);
  s2.translate(0, 0.38, 0);
  white.push(s1, s2);
  const floor = new THREE.CylinderGeometry(3.05, 3.05, 0.08, 8);
  floor.translate(0, 0.56, 0);
  trim.push(floor);
  // Columns with bases and capitals.
  const colR = 2.75;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * colR;
    const z = Math.sin(a) * colR;
    const col = new THREE.CylinderGeometry(0.11, 0.13, 2.7, 10);
    col.translate(x, 0.6 + 1.35, z);
    const base = new THREE.CylinderGeometry(0.2, 0.22, 0.18, 10);
    base.translate(x, 0.68, z);
    const cap = new THREE.CylinderGeometry(0.22, 0.14, 0.2, 10);
    cap.translate(x, 3.25, z);
    white.push(col, base, cap);
  }
  // Railing (open at the front, facing the camera-ish).
  for (let i = 0; i < 8; i++) {
    if (i === 1) continue;
    const a0 = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const a1 = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
    const p0 = new THREE.Vector3(Math.cos(a0) * colR, 0, Math.sin(a0) * colR);
    const p1 = new THREE.Vector3(Math.cos(a1) * colR, 0, Math.sin(a1) * colR);
    const len = p0.distanceTo(p1);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const ang = Math.atan2(p1.z - p0.z, p1.x - p0.x);
    for (const [y, h] of [[1.55, 0.09], [0.95, 0.06]]) {
      const rail = new THREE.BoxGeometry(len, h, 0.09);
      rail.rotateY(-ang);
      rail.translate(mid.x, y, mid.z);
      white.push(rail);
    }
    for (let k = 1; k < 6; k++) {
      const p = p0.clone().lerp(p1, k / 6);
      const bal = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 5);
      bal.translate(p.x, 1.08, p.z);
      white.push(bal);
    }
  }
  // Eave band + fascia.
  const band = new THREE.CylinderGeometry(3.32, 3.32, 0.32, 8, 1, true);
  band.rotateY(Math.PI / 8);
  band.translate(0, 3.48, 0);
  trim.push(band);
  white.push(octRing(3.3, 0.07, 3.32), octRing(3.3, 0.07, 3.64));
  // Bell-shaped roof (lathe, 8 facets).
  const prof = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const r = 3.65 * (1 - t) * (1 - 0.35 * Math.sin(t * Math.PI)) + 0.05;
    const y = 3.62 + 2.3 * Math.pow(t, 0.85);
    prof.push(new THREE.Vector2(r, y));
  }
  const dome = new THREE.LatheGeometry(prof, 8);
  dome.rotateY(Math.PI / 8);
  roof.push(dome);
  // Ceiling: a shallow inverted cone so the underside of the roof isn't see-through.
  const ceil = new THREE.ConeGeometry(3.3, 0.9, 8, 1, true);
  ceil.rotateY(Math.PI / 8);
  ceil.translate(0, 3.62 + 0.45, 0);
  ceiling.push(ceil);
  // Little lantern + finial.
  const lantern = new THREE.CylinderGeometry(0.32, 0.36, 0.5, 8);
  lantern.translate(0, 6.05, 0);
  white.push(lantern);
  const cap = new THREE.ConeGeometry(0.45, 0.45, 8);
  cap.translate(0, 6.5, 0);
  roof.push(cap);
  const ball = new THREE.SphereGeometry(0.17, 12, 8);
  ball.translate(0, 6.85, 0);
  const spike = new THREE.ConeGeometry(0.06, 0.5, 6);
  spike.translate(0, 7.2, 0);
  gold.push(ball, spike);
  const strip = (list) => mergeGeometries(list.map((g) => flat(g)).map((g) => {
    g.deleteAttribute('uv');
    return g;
  }));
  return { white: strip(white), trim: strip(trim), roof: strip(roof), gold: strip(gold), ceiling: strip(ceiling) };
}

// Fairy bulbs strung around the eave.
const BULBS = 24;

export function Gazebo({ position, rotation = 0 }) {
  const geo = useDisposable(buildGazebo);
  const mats = useDisposable(() => ({
    white: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 }),
    trim: new THREE.MeshPhysicalMaterial({ color: '#3cc4ea', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 }),
    roof: new THREE.MeshPhysicalMaterial({ color: '#178fd6', roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.05 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#9fc7dc', roughness: 0.6, side: THREE.DoubleSide, emissive: '#ffd99a', emissiveIntensity: 0.15 }),
    gold: new THREE.MeshStandardMaterial({ color: '#ffd35a', metalness: 0.9, roughness: 0.25 }),
  }));
  const bulbs = useDisposable(() => {
    const g = new THREE.SphereGeometry(0.075, 8, 6);
    const m = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const mesh = new THREE.InstancedMesh(g, m, BULBS);
    const mat = new THREE.Matrix4();
    for (let i = 0; i < BULBS; i++) {
      const a = (i / BULBS) * Math.PI * 2;
      const sag = Math.abs(Math.sin((i / BULBS) * Math.PI * 8)) * 0.12;
      mat.makeTranslation(Math.cos(a) * 3.38, 3.25 - sag, Math.sin(a) * 3.38);
      mesh.setMatrixAt(i, mat);
      mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    return { g, m, mesh };
  });
  const color = useRef(new THREE.Color());
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const { mesh } = bulbs;
    const palette = [[1.0, 0.85, 0.45], [0.55, 0.95, 1.0], [1.0, 0.6, 0.85], [0.75, 1.0, 0.55]];
    for (let i = 0; i < BULBS; i++) {
      const tw = 0.55 + 0.45 * Math.sin(t * 2.2 + i * 1.7) + beat.pulse * 0.6 * ((i + beat.beat) % 2);
      const p = palette[i % 4];
      mesh.setColorAt(i, color.current.setRGB(p[0] * (1 + tw * 1.6), p[1] * (1 + tw * 1.6), p[2] * (1 + tw * 1.6)));
    }
    mesh.instanceColor.needsUpdate = true;
  });
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh geometry={geo.white} material={mats.white} />
      <mesh geometry={geo.trim} material={mats.trim} />
      <mesh geometry={geo.roof} material={mats.roof} />
      <mesh geometry={geo.gold} material={mats.gold} />
      <mesh geometry={geo.ceiling} material={mats.ceiling} />
      <primitive object={bulbs.mesh} />
    </group>
  );
}

// ---------------------------------------------------------- musical notes

function makeNoteAtlas() {
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = cell * 2;
  canvas.height = cell * 2;
  const ctx = canvas.getContext('2d');
  const head = (x, y, r = 17) => {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.74, -0.45, 0, Math.PI * 2);
    ctx.fill();
  };
  const glyphs = [
    // Eighth note.
    (ox, oy) => {
      head(ox + 50, oy + 92);
      ctx.fillRect(ox + 62, oy + 22, 8, 70);
      ctx.beginPath();
      ctx.moveTo(ox + 70, oy + 22);
      ctx.bezierCurveTo(ox + 74, oy + 48, ox + 104, oy + 50, ox + 92, oy + 82);
      ctx.bezierCurveTo(ox + 96, oy + 56, ox + 80, oy + 52, ox + 70, oy + 48);
      ctx.fill();
    },
    // Beamed pair.
    (ox, oy) => {
      head(ox + 36, oy + 96, 15);
      head(ox + 90, oy + 86, 15);
      ctx.fillRect(ox + 45, oy + 30, 7, 66);
      ctx.fillRect(ox + 99, oy + 20, 7, 66);
      ctx.beginPath();
      ctx.moveTo(ox + 45, oy + 30);
      ctx.lineTo(ox + 106, oy + 18);
      ctx.lineTo(ox + 106, oy + 34);
      ctx.lineTo(ox + 45, oy + 46);
      ctx.fill();
    },
    // Quarter note.
    (ox, oy) => {
      head(ox + 56, oy + 92, 18);
      ctx.fillRect(ox + 68, oy + 20, 8, 72);
    },
    // Sparkle star.
    (ox, oy) => {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 4;
        const r = i % 2 === 0 ? 50 : 13;
        ctx.lineTo(ox + 64 + Math.cos(a) * r, oy + 64 + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    },
  ];
  glyphs.forEach((draw, i) => {
    const ox = (i % 2) * cell;
    const oy = Math.floor(i / 2) * cell;
    // Soft halo, white outline, then a glossy fill.
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.7)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#ffffff';
    draw(ox, oy);
    ctx.restore();
    ctx.save();
    ctx.translate(ox + 64, oy + 64);
    ctx.scale(0.86, 0.86);
    ctx.translate(-ox - 64, -oy - 64);
    const g = ctx.createLinearGradient(0, oy + 10, 0, oy + 118);
    g.addColorStop(0, 'rgb(228,228,228)');
    g.addColorStop(0.45, 'rgb(190,190,190)');
    g.addColorStop(1, 'rgb(120,120,120)');
    ctx.fillStyle = g;
    draw(ox, oy);
    ctx.restore();
  });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const NOTE_COUNT = 18;
const BURST_COUNT = 14;

/** Musical notes drifting out of the bandstand on the breeze. */
export function MusicNotes({ origin }) {
  const texture = useDisposable(makeNoteAtlas);
  const geometry = useDisposable(() => {
    const rand = makeRandom(5);
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const total = NOTE_COUNT + BURST_COUNT;
    const a = new Float32Array(total * 4);
    const c = new Float32Array(total * 3);
    const colors = ['#139cf0', '#ff3d9a', '#ffb000', '#2fc84a', '#8a4dff', '#00c2c7'].map((h) => new THREE.Color(h));
    for (let i = 0; i < total; i++) {
      const burst = i >= NOTE_COUNT ? 1 : 0;
      a.set([burst ? (i - NOTE_COUNT) / BURST_COUNT : i / NOTE_COUNT, rand.int(0, burst ? 3 : 2), burst, rand.next()], i * 4);
      const col = colors[i % colors.length];
      c.set([col.r, col.g, col.b], i * 3);
    }
    g.setAttribute('aNote', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(c, 3));
    g.instanceCount = total;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          ...windUniforms,
          ...lightUniforms,
          uMap: { value: texture },
          uOrigin: { value: new THREE.Vector3(...origin) },
          uBurst: { value: -999 },
          uPulse: { value: 0 },
        },
        vertexShader: /* glsl */ `
          attribute vec4 aNote; // phase, glyph, burst, rand
          attribute vec3 aColor;
          uniform float uTime;
          uniform vec2 uWindDir;
          uniform vec3 uOrigin;
          uniform float uBurst;
          uniform float uPulse;
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            float life = aNote.z > 0.5 ? 4.5 : 7.0;
            float age = aNote.z > 0.5
              ? uTime - uBurst - aNote.x * 0.6
              : mod(uTime + aNote.x * life, life);
            float k = clamp(age / life, 0.0, 1.0);
            float alive = step(0.0, age) * step(age, life);
            vec3 p = uOrigin;
            float spread = aNote.z > 0.5 ? 1.0 : 0.0;
            float ang = aNote.w * 6.2831;
            p += vec3(cos(ang), 0.0, sin(ang)) * spread * age * 1.6;
            p.xz += uWindDir * age * (0.7 + aNote.w * 0.5);
            p.y += age * (0.45 + aNote.w * 0.3) + spread * age * 0.8;
            p.x += sin(age * 2.1 + aNote.w * 9.0) * 0.6;
            p.y += sin(age * 3.0 + aNote.w * 5.0) * 0.25;
            float s = (1.8 + aNote.w * 0.9) * smoothstep(0.0, 0.08, k) * (1.0 + uPulse * 0.2);
            s *= alive;
            vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            float rot = sin(age * 2.0 + aNote.w * 6.0) * 0.35;
            vec2 q = vec2(position.x * cos(rot) - position.y * sin(rot), position.x * sin(rot) + position.y * cos(rot));
            p += (camR * q.x + camU * q.y) * s;
            vec2 cell = vec2(mod(aNote.y, 2.0), 1.0 - floor(aNote.y / 2.0));
            vUv = (uv + cell) * 0.5;
            vColor = aColor;
            vAlpha = smoothstep(1.0, 0.65, k) * alive;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vec4 t = texture2D(uMap, vUv);
            // Grey levels shade the coloured fill; pure white is the outline/halo.
            float fill = 1.0 - smoothstep(0.85, 1.0, t.r);
            vec3 col = mix(vec3(1.0), vColor * (0.55 + t.r * 0.8), fill) * 1.15;
            float a = t.a * vAlpha;
            if (a < 0.01) discard;
            gl_FragColor = vec4(col * a, a);
          }
        `,
        premultipliedAlpha: true,
      }),
  );
  useFrame(() => {
    material.uniforms.uBurst.value = meadowFx.burstTime;
    material.uniforms.uPulse.value = beat.pulse;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />;
}

// --------------------------------------------------------- wind turbines

function buildTurbineParts() {
  const tower = new THREE.CylinderGeometry(0.55, 1.05, 34, 14, 1, true);
  tower.translate(0, 17, 0);
  const nacelle = new THREE.CapsuleGeometry(0.9, 3.2, 4, 10);
  nacelle.rotateX(Math.PI / 2);
  nacelle.translate(0, 34.6, -0.6);
  const body = mergeGeometries([flat(tower), flat(nacelle)].map((g) => {
    g.deleteAttribute('uv');
    return g;
  }));
  const hub = new THREE.SphereGeometry(0.75, 12, 8);
  hub.scale(1, 1, 1.5);
  hub.translate(0, 0, 0.6);
  const blades = [flat(hub)];
  // Slim tapered blades with a slight twist.
  for (let i = 0; i < 3; i++) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.35, 0);
    shape.quadraticCurveTo(-0.9, 2.5, -0.55, 6);
    shape.lineTo(-0.12, 15.5);
    shape.quadraticCurveTo(0.05, 15.8, 0.12, 15.3);
    shape.lineTo(0.35, 4);
    shape.quadraticCurveTo(0.45, 1.5, 0.35, 0);
    shape.closePath();
    const b = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false, curveSegments: 6 });
    b.translate(0, 0.4, 0.3);
    b.rotateY(0.25);
    b.rotateZ((i / 3) * Math.PI * 2);
    blades.push(flat(b));
  }
  const rotor = mergeGeometries(blades.map((g) => {
    g.deleteAttribute('uv');
    return g;
  }));
  return { body, rotor };
}

export function Turbines({ sites }) {
  const parts = useDisposable(buildTurbineParts);
  const material = useDisposable(
    () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  );
  const meshes = useDisposable(() => {
    const body = new THREE.InstancedMesh(parts.body, material, sites.length);
    const rotor = new THREE.InstancedMesh(parts.rotor, material, sites.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    sites.forEach((s, i) => {
      q.setFromEuler(e.set(0, s.yaw, 0));
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.scale, s.scale, s.scale));
      body.setMatrixAt(i, m);
    });
    body.frustumCulled = false;
    rotor.frustumCulled = false;
    return { body, rotor };
  }, [parts, material, sites]);

  const tmp = useRef({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3(), off: new THREE.Vector3() });
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const { m, q, e, p, s, off } = tmp.current;
    sites.forEach((site, i) => {
      // Spin about the local z axis (rotor faces the wind).
      q.setFromEuler(e.set(0, site.yaw, t * site.speed + site.phase, 'YXZ'));
      off.set(0, 34.6 * site.scale, 1.4 * site.scale).applyEuler(e.set(0, site.yaw, 0));
      p.set(site.x, site.y, site.z).add(off);
      s.setScalar(site.scale);
      m.compose(p, q, s);
      meshes.rotor.setMatrixAt(i, m);
    });
    meshes.rotor.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <primitive object={meshes.body} />
      <primitive object={meshes.rotor} />
    </>
  );
}

export function turbineSites() {
  const rand = makeRandom(91);
  const xs = [-150, -114, -80, -47, -14, 20];
  return xs.map((x, i) => {
    const z = -205 - rand.range(0, 40) + (i % 2) * 12;
    return { x, z, y: heightAt(x, z) - 0.5, yaw: -0.35 + rand.range(-0.08, 0.08), scale: rand.range(0.78, 0.92), speed: rand.range(0.55, 0.8), phase: rand.range(0, 6) };
  });
}

// ------------------------------------------------------- hot air balloon

function makeBalloonTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  const gores = 12;
  for (let i = 0; i < gores; i++) {
    const x0 = (i / gores) * c.width;
    const g = ctx.createLinearGradient(x0, 0, x0 + c.width / gores, 0);
    const red = i % 2 === 0;
    g.addColorStop(0, red ? '#d81e2c' : '#f4f4f4');
    g.addColorStop(0.5, red ? '#ff4552' : '#ffffff');
    g.addColorStop(1, red ? '#d81e2c' : '#f4f4f4');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, c.width / gores + 1, c.height);
  }
  // Yellow belt + crown band.
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(0, c.height * 0.6, c.width, c.height * 0.05);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, c.height * 0.585, c.width, c.height * 0.015);
  ctx.fillRect(0, c.height * 0.65, c.width, c.height * 0.015);
  ctx.fillStyle = '#c4141f';
  ctx.fillRect(0, c.height * 0.955, c.width, c.height * 0.05);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildBalloon() {
  const prof = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28; // 0 = mouth, 1 = crown
    const y = -6.2 + t * 14.2;
    let r;
    if (t < 0.38) r = THREE.MathUtils.lerp(1.1, 6.0, Math.pow(t / 0.38, 1.25));
    else r = 6.0 * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.6) / 0.42, 2))) * 1.02;
    prof.push(new THREE.Vector2(Math.max(r, 0.02), y));
  }
  prof[prof.length - 1].x = 0.01;
  const envelope = new THREE.LatheGeometry(prof, 36);
  // Lathe uv.y runs 0 (mouth) -> 1 (crown); flip so the canvas reads top-down.
  const uv = envelope.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const basket = new THREE.CylinderGeometry(0.85, 0.7, 1.05, 10);
  basket.translate(0, -9.1, 0);
  const rim = new THREE.TorusGeometry(0.86, 0.09, 6, 16);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, -8.55, 0);
  const ropes = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const top = new THREE.Vector3(Math.cos(a) * 1.05, -6.2, Math.sin(a) * 1.05);
    const bot = new THREE.Vector3(Math.cos(a) * 0.75, -8.55, Math.sin(a) * 0.75);
    const len = top.distanceTo(bot);
    const r = new THREE.CylinderGeometry(0.035, 0.035, len, 4);
    r.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), bot.clone().sub(top).normalize()));
    r.translate((top.x + bot.x) / 2, (top.y + bot.y) / 2, (top.z + bot.z) / 2);
    ropes.push(flat(r));
  }
  const strip = (g) => {
    g.deleteAttribute('uv');
    return g;
  };
  const wicker = mergeGeometries([flat(basket), flat(rim), ...ropes].map(strip));
  const flame = new THREE.SphereGeometry(0.55, 12, 8);
  flame.scale(0.7, 1.6, 0.7);
  flame.translate(0, -6.6, 0);
  return { envelope, wicker, flame };
}

export function Balloon({ x0 = -330, span = 640, initial = 449, y = 110, z = -300, speed = 0.2, scale = 1.8 }) {
  const geo = useDisposable(buildBalloon);
  const texture = useDisposable(makeBalloonTexture);
  const mats = useDisposable(() => ({
    envelope: new THREE.MeshPhysicalMaterial({ map: texture, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.55, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0.18 }),
    wicker: new THREE.MeshStandardMaterial({ color: '#a2703f', roughness: 0.9 }),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.6), transparent: true, opacity: 0, toneMapped: false, depthWrite: false }),
  }));
  const group = useRef();
  const flameMesh = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Drifts downwind across the whole sky; wraps while far off-screen.
    const travel = (t * speed + initial) % span;
    const sink = Math.max(0, travel - initial) * 0.05;
    group.current.position.set(x0 + travel, y - sink + Math.sin(t * 0.21) * 1.6 + Math.sin(t * 0.07) * 2.4, z + Math.sin(t * 0.05) * 6);
    group.current.rotation.set(Math.sin(t * 0.33) * 0.03, t * 0.04, Math.sin(t * 0.27 + 1) * 0.035);
    group.current.scale.setScalar(scale);
    // A burner blast every ~9 s.
    const cyc = t % 9;
    const burn = cyc < 1.4 ? Math.sin((cyc / 1.4) * Math.PI) * (0.75 + 0.25 * Math.sin(t * 40)) : 0;
    mats.flame.opacity = burn;
    flameMesh.current.visible = burn > 0.01;
    flameMesh.current.scale.setScalar(0.8 + burn * 0.4);
  });
  return (
    <group ref={group}>
      <mesh geometry={geo.envelope} material={mats.envelope} />
      <mesh geometry={geo.wicker} material={mats.wicker} />
      <mesh ref={flameMesh} geometry={geo.flame} material={mats.flame} />
    </group>
  );
}
