import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import Character from '../../../frutiger-character/client/src/Character.jsx';
import { validateMotion } from '../../../frutiger-character/client/src/motion.js';
import modelUrl from '../../../frutiger-character/client/public/models/aero-character.glb?url';
import motionUrl from '../../../frutiger-character/client/public/motion/dance.json?url';
import { createFeedback, H, NAMES, ORDER, W } from './ratings.js';
import { createTextFeedback } from './textFeedback.js';
import { TEXT_DESIGNS } from './designs.js';

/*
 * Move-ratings mockup: the glass dancers perform centre stage while judged-move popups
 * (Perfect, Great, Good, OK, Miss, Not even trying) appear in the top-left corner.
 * Ratings auto-play like a song in progress; 1-6 or the chips trigger one, A toggles auto.
 * Q-T switch between the five text-only designs, Y shows the original bubble badge;
 * H holds each rating on screen until the next one; G shows all six ratings at once.
 * Rendered in-engine at the main app's 640x480 buffer, stretched to 16:9.
 */

const RENDER = { w: 640, h: 480 };
const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
const BEAT = 60 / 118;
// Roughly how a real round might go: mostly good, the odd slip.
const WEIGHTS = { perfect: 0.3, great: 0.26, good: 0.16, ok: 0.1, miss: 0.1, lazy: 0.08 };
const CHIP = { y: 812, h: 58, gap: 14 };
// Five text-only designs, then the original bubble badge for comparison.
const DESIGN_NAMES = [...TEXT_DESIGNS.map((d) => d.name), 'Badge v1'];
const DESIGN_KEYS = ['q', 'w', 'e', 'r', 't', 'y'];
const BADGE = DESIGN_NAMES.length - 1;

function FixedRenderResolution() {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  useLayoutEffect(() => { gl.setSize(RENDER.w, RENDER.h, false); }, [gl, size.width, size.height]);
  return null;
}

class Quiet extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.warn('Dancers could not load', err); }
  render() { return this.state.failed ? null : this.props.children; }
}

// #design1..#design6 in the URL picks the starting design.
function initialDesign() {
  const m = /^#design(\d)$/.exec(window.location.hash);
  const i = m ? Number(m[1]) - 1 : 0;
  return i >= 0 && i <= BADGE ? i : 0;
}

function pickWeighted() {
  let r = Math.random();
  for (const k of ORDER) { r -= WEIGHTS[k]; if (r <= 0) return k; }
  return 'perfect';
}

function chipRow(g, items, y) {
  g.font = `800 24px ${FONT}`;
  const widths = items.map((it) => g.measureText(it.text).width + 40);
  const total = widths.reduce((s, w) => s + w, 0) + CHIP.gap * (items.length - 1);
  let x = (W - total) / 2;
  return items.map((it, i) => {
    const rect = { ...it, x, y, w: widths[i], h: CHIP.h };
    x += widths[i] + CHIP.gap;
    return rect;
  });
}

// Bottom: ratings (1-6, A); above it: designs (Q-Y).
function chipLayout(g) {
  const ratings = [...ORDER.map((k, i) => ({ id: k, text: `${i + 1}  ${NAMES[k]}` })), { id: 'auto', text: 'A  Auto' }, { id: 'hold', text: 'H  Hold' }, { id: 'gallery', text: 'G  Gallery' }];
  const designs = DESIGN_NAMES.map((name, i) => ({ id: `design${i}`, text: `${DESIGN_KEYS[i].toUpperCase()}  ${name}` }));
  return [...chipRow(g, designs, CHIP.y - CHIP.h - 14), ...chipRow(g, ratings, CHIP.y)];
}

function drawChips(g, chips, auto, hold, gallery, design, hover) {
  for (const c of chips) {
    const on = (c.id === 'auto' && auto) || (c.id === 'hold' && hold) || (c.id === 'gallery' && gallery) || c.id === `design${design}`;
    g.save();
    g.beginPath();
    g.roundRect(c.x, c.y, c.w, c.h, c.h / 2);
    const body = g.createLinearGradient(0, c.y, 0, c.y + c.h);
    body.addColorStop(0, on ? 'rgba(120, 240, 200, 0.95)' : 'rgba(255, 255, 255, 0.82)');
    body.addColorStop(1, on ? 'rgba(20, 170, 130, 0.95)' : 'rgba(170, 225, 245, 0.82)');
    g.shadowColor = 'rgba(0, 40, 80, 0.3)';
    g.shadowBlur = 10;
    g.shadowOffsetY = 3;
    g.fillStyle = body;
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = hover === c.id ? 4 : 2;
    g.strokeStyle = hover === c.id ? '#ffffff' : 'rgba(255,255,255,0.9)';
    g.stroke();
    g.fillStyle = on ? '#ffffff' : '#0c3a5c';
    g.font = `800 24px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillText(c.text, c.x + 20, c.y + c.h / 2 + 1);
    g.restore();
  }
  g.save();
  g.font = `800 20px ${FONT}`;
  g.fillStyle = 'rgba(12, 58, 92, 0.75)';
  g.textAlign = 'right';
  g.fillText(`MOCKUP · MOVE RATINGS · ${DESIGN_NAMES[design].toUpperCase()}`, W - 36, 40);
  g.restore();
}

function Show() {
  const gl = useThree((s) => s.gl);
  const [scene] = useState(() => new THREE.Scene());
  const [camera] = useState(() => new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 200));
  const [motion, setMotion] = useState(null);
  const playback = useRef(0);
  const [badge] = useState(createFeedback);
  const [text] = useState(createTextFeedback);
  const ui = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = RENDER.w;
    canvas.height = RENDER.h;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    const overlay = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    quad.frustumCulled = false;
    overlay.add(quad);
    return { canvas, texture, overlay, quad, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1), chips: null };
  }, []);
  const demo = useRef({ auto: true, hold: false, gallery: new URLSearchParams(window.location.search).has('gallery'), next: 1.2, hover: null, now: 0, design: initialDesign() });

  useEffect(() => {
    const controller = new AbortController();
    fetch(motionUrl, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error('Dance capture unavailable'); return r.json(); })
      .then((data) => setMotion(validateMotion(data)))
      .catch((e) => { if (e.name !== 'AbortError') console.warn(e); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04);
    scene.environment = env.texture;
    room.dispose();
    pmrem.dispose();
    return () => { scene.environment = null; env.dispose(); };
  }, [gl, scene]);

  // Keys and clicks on the in-engine chips.
  useEffect(() => {
    const el = gl.domElement;
    const d = demo.current;
    const fire = (id) => {
      if (id === 'auto') { d.auto = !d.auto; d.next = d.now + 0.6; return; }
      if (id === 'hold') { d.hold = !d.hold; badge.setHold(d.hold); text.setHold(d.hold); return; }
      if (id === 'gallery') { d.gallery = !d.gallery; return; }
      if (id.startsWith('design')) {
        d.design = Number(id.slice(6));
        if (d.design !== BADGE) text.setDesign(d.design);
        window.history.replaceState(null, '', `#design${d.design + 1}`);
        return;
      }
      // Both renderers track the same ratings so switching keeps the combo going.
      badge.trigger(id, d.now);
      text.trigger(id, d.now);
      d.next = d.now + BEAT * 3; // let a manual pick breathe before auto resumes
    };
    text.setDesign(Math.min(d.design, BADGE - 1));
    const toDesign = (e) => {
      const r = el.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };
    const hit = (p) => ui.chips?.find((c) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h)?.id ?? null;
    const onKey = (e) => {
      const i = Number(e.key) - 1;
      const di = DESIGN_KEYS.indexOf(e.key.toLowerCase());
      if (i >= 0 && i < ORDER.length) fire(ORDER[i]);
      else if (di >= 0) fire(`design${di}`);
      else if (e.key === 'h' || e.key === 'H') fire('hold');
      else if (e.key === 'g' || e.key === 'G') fire('gallery');
      else if (e.key === 'a' || e.key === 'A' || e.key === ' ') { e.preventDefault(); fire('auto'); }
    };
    const onMove = (e) => { d.hover = hit(toDesign(e)); el.style.cursor = d.hover ? 'pointer' : ''; };
    const onUp = (e) => { const id = hit(toDesign(e)); if (id) fire(id); };
    window.addEventListener('keydown', onKey);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
  }, [gl, badge, text, ui]);

  useEffect(() => () => {
    ui.texture.dispose();
    ui.quad.geometry.dispose();
    ui.quad.material.dispose();
  }, [ui]);

  useFrame((state, delta) => {
    const d = demo.current;
    const now = state.clock.elapsedTime;
    d.now = now;
    playback.current += Math.min(delta, 0.1);
    if (d.auto && !d.gallery && now >= d.next) {
      const type = pickWeighted();
      badge.trigger(type, now);
      text.trigger(type, now);
      d.next = now + BEAT * (Math.random() < 0.7 ? 2 : 3);
    }

    camera.position.set(Math.sin(now * 0.25) * 0.6, 1.9, 13);
    camera.lookAt(0, 2.1, 0);

    const g = ui.canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    g.setTransform(ui.canvas.width / W, 0, 0, ui.canvas.height / H, 0, 0);
    if (!ui.chips) ui.chips = chipLayout(g);
    const fb = d.design === BADGE ? badge : text;
    if (d.gallery) {
      // All six ratings side by side, settled, for comparing designs.
      ORDER.forEach((type, i) => fb.drawSample(g, type, now, (i % 2) * 780, Math.floor(i / 2) * 215));
    } else fb.draw(g, now);
    drawChips(g, ui.chips, d.auto, d.hold, d.gallery, d.design, d.hover);
    ui.texture.needsUpdate = true;

    const tm = gl.toneMapping;
    gl.toneMapping = THREE.ACESFilmicToneMapping; // the gel dancers were tuned under ACES
    gl.render(scene, camera);
    gl.toneMapping = tm;
    const ac = gl.autoClear;
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(ui.overlay, ui.cam);
    gl.autoClear = ac;
  }, 1);

  return createPortal(<StageContent motion={motion} playback={playback} />, scene);
}

// Bright Frutiger Aero stage: sky gradient, glossy floor, glass puck and bubbles.
const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  vertexShader: 'varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    varying vec3 vP;
    void main() {
      float h = vP.y;
      vec3 top = vec3(0.08, 0.42, 0.92), mid = vec3(0.45, 0.78, 1.0), low = vec3(0.86, 0.97, 1.0);
      vec3 c = mix(low, mid, smoothstep(-0.05, 0.25, h));
      c = mix(c, top, smoothstep(0.2, 0.8, h));
      float sun = max(dot(vP, normalize(vec3(0.5, 0.45, -0.75))), 0.0);
      c += vec3(1.0, 0.97, 0.85) * (pow(sun, 60.0) * 0.8 + pow(sun, 6.0) * 0.2);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
});

function Bubbles() {
  const group = useRef();
  const items = useMemo(() => Array.from({ length: 18 }, () => ({ x: (Math.random() - 0.5) * 22, y: Math.random() * 9, z: -4 - Math.random() * 10, r: 0.2 + Math.random() * 0.5, s: 0.3 + Math.random() * 0.6 })), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    group.current.children.forEach((m, i) => {
      const b = items[i];
      m.position.set(b.x + Math.sin(t * 0.6 + i) * 0.3, ((b.y + t * b.s) % 10) - 0.5, b.z);
    });
  });
  return (
    <group ref={group}>
      {items.map((b, i) => (
        <mesh key={i} scale={b.r}>
          <sphereGeometry args={[1, 20, 14]} />
          <meshPhysicalMaterial color="#ffffff" transmission={0} roughness={0.05} metalness={0} clearcoat={1} iridescence={1} iridescenceIOR={1.3} transparent opacity={0.28} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function StageContent({ motion, playback }) {
  return (
    <>
      <mesh material={skyMaterial} renderOrder={-10}>
        <sphereGeometry args={[90, 32, 16]} />
      </mesh>
      <hemisphereLight args={['#d9faff', '#489789', 1.3]} />
      <directionalLight position={[-6, 12, 8]} intensity={2.5} />
      <pointLight position={[0, 1.3, 3]} color="#65f7ff" intensity={8} distance={9} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[60, 64]} />
        <meshPhysicalMaterial color="#9fe8c8" roughness={0.35} clearcoat={0.6} />
      </mesh>
      <mesh position={[0, -0.13, 0]}>
        <cylinderGeometry args={[3.4, 3.55, 0.26, 96]} />
        <meshPhysicalMaterial color="#c4f6ff" roughness={0.08} metalness={0.2} clearcoat={1} transparent opacity={0.6} depthWrite={false} envMapIntensity={1.6} />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3.37, 0.045, 10, 128]} />
        <meshBasicMaterial color="#7affdc" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <Bubbles />
      {motion && (
        <Quiet>
          <Suspense fallback={null}>
            {[{ x: -1.5, color: '#078fff' }, { x: 1.5, color: '#b86bff' }].map((dd, person) => (
              <group key={person} position={[dd.x, 0, 0]}>
                <Character url={modelUrl} motion={motion} person={person} playback={playback} appearance={{ color: dd.color, gloss: 85, accessory: 'None' }} />
              </group>
            ))}
          </Suspense>
        </Quiet>
      )}
    </>
  );
}


export default function App() {
  return (
    <div className="canvas-frame">
      <Canvas dpr={1} flat gl={{ antialias: true }}>
        <FixedRenderResolution />
        <Show />
      </Canvas>
    </div>
  );
}
