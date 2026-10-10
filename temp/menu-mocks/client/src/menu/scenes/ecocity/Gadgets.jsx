import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat } from '../../shared/hooks.js';
import { UIPlane } from '../../ui/UIPlane.jsx';
import { icon, linear, orb, radial, roundRect, text, withShadow } from '../../ui/draw.js';
import { GlassPanel } from './hudkit.jsx';

// Windows Sidebar gadgets: analog clock (real time), weather, now playing.

/** Gently floats a whole gadget so its layered parts stay aligned. */
function Bob({ position, amp = 2, speed = 0.9, phase = 0, children }) {
  const ref = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    ref.current.position.set(position[0], position[1] + Math.sin(t * speed + phase) * amp, position[2] ?? 0);
  });
  return <group ref={ref}>{children}</group>;
}

const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

function drawClockFace(ctx, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const R = w / 2 - 3;
  // Chrome bezel.
  withShadow(ctx, { color: 'rgba(0,30,70,0.4)', blur: 12, y: 4 }, () => {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = '#cfd9e2';
    ctx.fill();
  });
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = linear(ctx, 0, cy - R, 0, cy + R, [
    [0, '#ffffff'],
    [0.45, '#b9c8d6'],
    [0.55, '#8ea3b8'],
    [1, '#e8f0f7'],
  ]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,70,100,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Face.
  const F = R - 8;
  ctx.beginPath();
  ctx.arc(cx, cy, F, 0, Math.PI * 2);
  ctx.fillStyle = radial(ctx, cx, cy - F * 0.3, F * 0.1, cx, cy, F, [
    [0, '#ffffff'],
    [0.75, '#f1f7fc'],
    [1, '#d5e4f0'],
  ]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,90,120,0.45)';
  ctx.stroke();
  // Ticks.
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const hour = i % 5 === 0;
    const r0 = F - (hour ? 9 : 4.5);
    const r1 = F - 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
    ctx.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
    ctx.strokeStyle = hour ? '#1b3d60' : 'rgba(40,70,100,0.45)';
    ctx.lineWidth = hour ? 2.6 : 1;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  for (const [n, a] of [
    ['12', 0],
    ['3', 0.25],
    ['6', 0.5],
    ['9', 0.75],
  ]) {
    const ang = a * Math.PI * 2;
    const r = F - 19;
    text(ctx, n, cx + Math.sin(ang) * r, cy - Math.cos(ang) * r + 1, { size: 14, weight: 900, fill: '#1b3d60' });
  }
  text(ctx, 'ECO CITY', cx, cy + F * 0.42, { size: 8.5, weight: 900, fill: 'rgba(30,80,120,0.55)', letterSpacing: 1.5 });
  icon(ctx, 'leaf', cx, cy - F * 0.4, 10, 'rgba(70,170,60,0.8)');
}

function drawClockGlass(ctx, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const F = w / 2 - 11;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, F, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(cx, cy - F * 0.45, F * 0.92, F * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = linear(ctx, 0, cy - F, 0, cy, [
    [0, 'rgba(255,255,255,0.75)'],
    [1, 'rgba(255,255,255,0.0)'],
  ]);
  ctx.fill();
  ctx.restore();
}

function drawHand(len, width, color, tail = 0, counter = false) {
  return (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,20,50,0.35)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1.5;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx, cy + tail);
    ctx.lineTo(cx, cy - len);
    ctx.stroke();
    if (counter) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy + tail, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };
}

function Hand({ length, width, color, tail, counter, getAngle, appear, z }) {
  const group = useRef();
  const size = length * 2 + 8;
  useFrame(() => {
    group.current.rotation.z = -getAngle();
  });
  return (
    <group ref={group} position={[0, 0, z]}>
      <UIPlane width={size} height={size} pad={4} appear={appear} draw={drawHand(length, width, color, tail, counter)} deps={[]} />
    </group>
  );
}

export function ClockGadget({ position }) {
  const S = 150;
  // One clock read per frame shared by all three hands.
  const angles = useRef({ h: 0, m: 0, s: 0 });
  useFrame(() => {
    const d = new Date();
    const sec = d.getSeconds();
    // Tick with a little overshoot, like a quartz second hand.
    const k = Math.min(1, d.getMilliseconds() / 180);
    const a = angles.current;
    a.s = ((sec - 1 + easeOutBack(k)) / 60) * Math.PI * 2;
    a.m = ((d.getMinutes() + sec / 60) / 60) * Math.PI * 2;
    a.h = (((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2;
  }, -1);
  const secAngle = () => angles.current.s;
  const minAngle = () => angles.current.m;
  const hourAngle = () => angles.current.h;
  return (
    <Bob position={position} amp={2} speed={0.9} phase={0.5}>
      <UIPlane width={S} height={S} pad={18} appear={0.5} draw={drawClockFace} deps={[]} />
      <group>
        <Hand length={34} width={5} color="#173a5e" tail={7} getAngle={hourAngle} appear={0.6} z={1} />
        <Hand length={50} width={3.4} color="#173a5e" tail={9} getAngle={minAngle} appear={0.6} z={2} />
        <Hand length={54} width={1.6} color="#e5482a" tail={14} counter getAngle={secAngle} appear={0.65} z={3} />
        <UIPlane
          width={12}
          height={12}
          pad={4}
          position={[0, 0, 4]}
          appear={0.65}
          deps={[]}
          draw={(ctx, w, h) => orb(ctx, w / 2, h / 2, 5, { color: '#2a4f78', light: '#9fc6ec', dark: '#0d2440', shadow: false })}
        />
        <UIPlane width={S} height={S} pad={4} position={[0, 0, 5]} appear={0.6} draw={drawClockGlass} deps={[]} />
      </group>
    </Bob>
  );
}

function drawSun(ctx, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  ctx.save();
  ctx.fillStyle = radial(ctx, cx, cy, 0, cx, cy, w / 2, [
    [0, 'rgba(255,240,150,0.9)'],
    [0.4, 'rgba(255,220,90,0.35)'],
    [1, 'rgba(255,220,90,0)'],
  ]);
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - 0.12) * 15, cy + Math.sin(a - 0.12) * 15);
    ctx.lineTo(cx + Math.cos(a) * (i % 2 ? 23 : 27), cy + Math.sin(a) * (i % 2 ? 23 : 27));
    ctx.lineTo(cx + Math.cos(a + 0.12) * 15, cy + Math.sin(a + 0.12) * 15);
    ctx.fillStyle = 'rgba(255,214,60,0.95)';
    ctx.fill();
  }
  orb(ctx, cx, cy, 14, { color: '#ffc61a', light: '#fff6b0', dark: '#f08a00', shadow: false, rim: 0.5 });
  ctx.restore();
}

function drawCloud(ctx, w, h) {
  withShadow(ctx, { color: 'rgba(0,50,110,0.35)', blur: 6, y: 2 }, () => {
    ctx.beginPath();
    ctx.arc(w * 0.3, h * 0.62, h * 0.28, 0, Math.PI * 2);
    ctx.arc(w * 0.52, h * 0.45, h * 0.36, 0, Math.PI * 2);
    ctx.arc(w * 0.74, h * 0.62, h * 0.26, 0, Math.PI * 2);
    ctx.rect(w * 0.3, h * 0.62, w * 0.44, h * 0.28);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [
    [0, '#ffffff'],
    [1, '#cfe3f5'],
  ]);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawWeather(ctx, w, h) {
  withShadow(ctx, { color: 'rgba(0,40,90,0.35)', blur: 14, y: 5 }, () => {
    roundRect(ctx, 0, 0, w, h, 14);
    ctx.fillStyle = '#2a8ae6';
    ctx.fill();
  });
  ctx.save();
  roundRect(ctx, 0, 0, w, h, 14);
  ctx.clip();
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [
    [0, '#5fc0ff'],
    [0.55, '#2386e3'],
    [1, '#1660c4'],
  ]);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = radial(ctx, w * 0.25, h * 0.35, 0, w * 0.25, h * 0.35, w * 0.6, [
    [0, 'rgba(255,255,255,0.25)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  ctx.fillRect(0, 0, w, h);
  roundRect(ctx, 3, 3, w - 6, h * 0.42, 11);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h * 0.45, [
    [0, 'rgba(255,255,255,0.45)'],
    [1, 'rgba(255,255,255,0.04)'],
  ]);
  ctx.fill();
  // Forecast strip.
  ctx.fillStyle = 'rgba(0,30,90,0.22)';
  ctx.fillRect(0, h - 30, w, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, h - 30, w, 1);
  ctx.restore();
  roundRect(ctx, 1, 1, w - 2, h - 2, 13);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  roundRect(ctx, 0, 0, w, h, 14);
  ctx.strokeStyle = 'rgba(0,40,100,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const sh = { color: 'rgba(0,40,100,0.55)', blur: 4, y: 1 };
  text(ctx, '24°', w - 14, 30, { size: 36, weight: 900, fill: '#ffffff', align: 'right', shadow: sh });
  text(ctx, 'Sunny', w - 14, 56, { size: 13, weight: 800, fill: '#ffffff', align: 'right', shadow: sh });
  text(ctx, 'Eco City', w - 14, 71, { size: 10.5, weight: 800, fill: 'rgba(225,245,255,0.85)', align: 'right', shadow: sh });
  const days = [
    ['Sat', '26°', 'sun'],
    ['Sun', '23°', 'cloud'],
    ['Mon', '25°', 'sun'],
  ];
  days.forEach(([d, t, kind], i) => {
    const cx = 10 + (i + 0.5) * ((w - 20) / 3);
    const y = h - 15;
    const ix = cx - 13;
    if (kind === 'sun') {
      ctx.beginPath();
      ctx.arc(ix, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd23f';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(ix - 3, y + 1.5, 3.5, 0, Math.PI * 2);
      ctx.arc(ix + 0.5, y - 1, 4.5, 0, Math.PI * 2);
      ctx.arc(ix + 4, y + 1.5, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    text(ctx, d, cx - 4, y - 5, { size: 9, weight: 800, fill: 'rgba(220,240,255,0.9)', align: 'left', shadow: sh });
    text(ctx, t, cx - 4, y + 6, { size: 10.5, weight: 900, fill: '#ffffff', align: 'left', shadow: sh });
  });
}

export function WeatherGadget({ position }) {
  const sun = useRef();
  useFrame((state) => {
    if (sun.current) sun.current.rotation.z = state.clock.elapsedTime * 0.25;
  });
  return (
    <Bob position={position} amp={2} speed={0.8} phase={1.6}>
      <UIPlane width={176} height={112} pad={20} appear={0.6} draw={drawWeather} deps={[]} sheen={0.15} />
      <group position={[-50, 20, 1]}>
        <group ref={sun}>
          <UIPlane width={60} height={60} pad={4} appear={0.7} draw={drawSun} deps={[]} />
        </group>
      </group>
      <UIPlane width={52} height={32} pad={8} position={[-34, 6, 2]} appear={0.75} bob={[1.5, 0.6, 0]} draw={drawCloud} deps={[]} />
    </Bob>
  );
}

const TRACKS = [
  { title: 'Eco Dreams', artist: 'Aero Collective', a: '#2fd3ff', b: '#1a5fd6', c: '#9cff6a', len: 214 },
  { title: 'Glass Horizon', artist: 'Skyline Kids', a: '#7ff0ff', b: '#3a7af0', c: '#ffffff', len: 198 },
  { title: 'Bubble Pop Utopia', artist: 'DJ Frutiger', a: '#ff9fd8', b: '#6a5cff', c: '#fff27a', len: 231 },
  { title: 'Solar Sway', artist: 'The Turbines', a: '#ffe36a', b: '#2bb36b', c: '#ffffff', len: 187 },
];

function drawArt(ctx, s, track) {
  ctx.save();
  roundRect(ctx, 0, 0, s, s, 6);
  ctx.clip();
  ctx.fillStyle = linear(ctx, 0, 0, s, s, [
    [0, track.a],
    [1, track.b],
  ]);
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(s * (0.2 + 0.17 * i), s * (0.3 + 0.12 * ((i * 7) % 5)), s * (0.05 + 0.03 * (i % 3)), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.strokeStyle = track.c;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-2, s * 0.8);
  ctx.bezierCurveTo(s * 0.3, s * 0.5, s * 0.6, s * 1.05, s + 2, s * 0.62);
  ctx.stroke();
  icon(ctx, 'dancer', s * 0.55, s * 0.5, s * 0.55, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = linear(ctx, 0, 0, 0, s * 0.5, [
    [0, 'rgba(255,255,255,0.5)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  ctx.fillRect(0, 0, s, s * 0.45);
  ctx.restore();
  roundRect(ctx, 0.5, 0.5, s - 1, s - 1, 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function fmt(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const MEDIA_W = 176;
const MEDIA_H = 164;

// Equalizer + progress bar drawn in a shader so they can move every frame.
function MediaFX({ playing, progressRef, position }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uBeat: { value: 0 }, uPlay: { value: 1 }, uProgress: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uBeat, uPlay, uProgress;
          varying vec2 vUv;
          float hash(float n) { return fract(sin(n) * 43758.5453); }
          void main() {
            vec2 p = vUv * vec2(152.0, 40.0);
            vec4 col = vec4(0.0);
            // Equalizer: 16 bars of LED segments in the top 30 px.
            if (p.y > 9.0) {
              float bars = 16.0;
              float bw = 152.0 / bars;
              float i = floor(p.x / bw);
              float fx = fract(p.x / bw);
              float f = 1.2 + hash(i) * 3.5;
              float lvl = 0.25 + 0.45 * abs(sin(uTime * f + i * 1.7)) + 0.35 * uBeat * (1.0 - i / bars * 0.6);
              lvl = mix(0.06, clamp(lvl, 0.0, 1.0), uPlay);
              float y = (p.y - 9.0) / 31.0;
              float seg = step(0.28, fract(y * 10.0));
              float on = step(y, lvl) * step(0.12, fx) * step(fx, 0.88) * seg;
              vec3 c = mix(vec3(0.15, 0.85, 1.0), vec3(0.65, 1.0, 0.35), smoothstep(0.2, 0.9, y));
              float ghost = step(0.12, fx) * step(fx, 0.88) * seg * 0.1;
              col = vec4(c, 1.0) * on + vec4(0.6, 0.8, 1.0, 1.0) * ghost * (1.0 - on);
            } else if (p.y > 1.5 && p.y < 5.5) {
              // Progress track.
              float x = p.x / 152.0;
              float fill = step(x, uProgress);
              vec3 c = mix(vec3(0.2, 0.3, 0.45), mix(vec3(0.2, 0.8, 1.0), vec3(0.6, 1.0, 0.5), x), fill);
              float hl = smoothstep(5.5, 3.5, p.y) * 0.3;
              col = vec4(c + hl, 1.0) * mix(0.7, 1.0, fill);
              float knob = 1.0 - smoothstep(2.5, 3.5, length(vec2(p.x - uProgress * 152.0, p.y - 3.5)));
              col = mix(col, vec4(1.0), knob);
            }
            gl_FragColor = vec4(col.rgb * col.a, col.a);
          }
        `,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const born = useRef(null);
  useFrame((state) => {
    const u = material.uniforms;
    const t = state.clock.elapsedTime;
    if (born.current === null) born.current = t;
    u.uTime.value = t;
    u.uBeat.value = beat.pulse;
    u.uPlay.value += ((playing ? 1 : 0) - u.uPlay.value) * 0.1;
    u.uProgress.value = progressRef.current;
  });
  return (
    <mesh material={material} position={position} renderOrder={2}>
      <planeGeometry args={[152, 40]} />
    </mesh>
  );
}

export function MediaGadget({ position }) {
  const [track, setTrack] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(71);
  const progress = useRef(0);
  const clock = useRef({ t: 71 });
  const T = TRACKS[track];
  useFrame((_, dt) => {
    const c = clock.current;
    if (playing) c.t += dt;
    if (c.t >= T.len) {
      c.t = 0;
      setTrack((i) => (i + 1) % TRACKS.length);
    }
    progress.current = c.t / T.len;
    const whole = Math.floor(c.t);
    if (whole !== elapsed) setElapsed(whole);
  });
  const skip = (d) => {
    clock.current.t = 0;
    setTrack((i) => (i + d + TRACKS.length) % TRACKS.length);
  };
  return (
    <Bob position={position} amp={1.5} speed={0.7} phase={3.1}>
      <GlassPanel width={MEDIA_W} height={MEDIA_H} radius={12} tint="#0d2a4a" blur={6} appear={0.7} renderOrder={-40} />
      <UIPlane
        width={MEDIA_W}
        height={MEDIA_H}
        pad={8}
        position={[0, 0, 1]}
        appear={0.75}
        deps={[track]}
        draw={(ctx, w, h) => {
          // Dark smoked overlay so the white text reads on the glass.
          ctx.save();
          roundRect(ctx, 0, 0, w, h, 12);
          ctx.clip();
          ctx.fillStyle = linear(ctx, 0, 0, 0, h, [
            [0, 'rgba(10,40,75,0.55)'],
            [1, 'rgba(3,14,30,0.82)'],
          ]);
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = linear(ctx, 0, 0, 0, 40, [
            [0, 'rgba(255,255,255,0.28)'],
            [1, 'rgba(255,255,255,0)'],
          ]);
          ctx.fillRect(0, 0, w, 40);
          ctx.restore();
          text(ctx, 'NOW PLAYING', 12, 13, { size: 9, weight: 900, fill: 'rgba(140,230,255,0.9)', align: 'left', letterSpacing: 1.5 });
          ctx.save();
          ctx.translate(12, 22);
          drawArt(ctx, 44, T);
          ctx.restore();
          const sh = { color: 'rgba(0,0,0,0.6)', blur: 3, y: 1 };
          text(ctx, T.title, 64, 36, { size: 14, weight: 900, fill: '#ffffff', align: 'left', maxWidth: w - 72, shadow: sh });
          text(ctx, T.artist, 64, 53, { size: 11, weight: 800, fill: '#8fe3ff', align: 'left', maxWidth: w - 72, shadow: sh });
        }}
      />
      <MediaFX playing={playing} progressRef={progress} position={[0, -24, 2]} />
      <UIPlane
        width={150}
        height={12}
        pad={4}
        position={[0, -50, 2]}
        appear={0.8}
        deps={[elapsed, track]}
        draw={(ctx, w, h) => {
          text(ctx, fmt(clock.current.t), 0, h / 2, { size: 9.5, weight: 800, fill: 'rgba(200,235,255,0.8)', align: 'left' });
          text(ctx, fmt(T.len), w, h / 2, { size: 9.5, weight: 800, fill: 'rgba(200,235,255,0.8)', align: 'right' });
        }}
      />
      {[
        ['chevronLeft', -36, () => skip(-1), 13],
        [playing ? 'pause' : 'play', 0, () => setPlaying((p) => !p), 16],
        ['chevronRight', 36, () => skip(1), 13],
      ].map(([name, x, fn, r]) => (
        <UIPlane
          key={x}
          width={r * 2}
          height={r * 2}
          pad={8}
          position={[x, -67, 3]}
          appear={0.85}
          hoverScale={1.15}
          onClick={fn}
          deps={[name]}
          draw={(ctx, w, h) => {
            orb(ctx, w / 2, h / 2, w / 2 - 1, name === 'play' || name === 'pause' ? { color: '#22a6f2', light: '#bdf0ff', dark: '#06508f' } : { color: '#4d7396', light: '#c4dcf0', dark: '#1a3654' });
            if (name === 'pause') {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(w / 2 - 5, h / 2 - 5.5, 3.5, 11);
              ctx.fillRect(w / 2 + 1.5, h / 2 - 5.5, 3.5, 11);
            } else {
              icon(ctx, name, w / 2 + (name === 'play' ? 1 : 0), h / 2 + 0.5, name === 'play' ? 13 : 12, '#ffffff');
            }
          }}
        />
      ))}
    </Bob>
  );
}
