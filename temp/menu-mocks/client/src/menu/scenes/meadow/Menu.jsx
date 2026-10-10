import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Hud, HUD_BOTTOM, HUD_LEFT, HUD_RIGHT } from '../../hud.jsx';
import { beat, setCursor, useDisposable } from '../../shared/hooks.js';
import { clamp, damp } from '../../shared/random.js';
import { font, linear, radial, roundRect, text as drawText } from '../../ui/draw.js';
import { Logo, LOGO_PALETTES } from '../../ui/Logo.jsx';
import { UIPlane } from '../../ui/UIPlane.jsx';
import { CHANNELS } from './channels.js';
import { meadowFx, triggerGust } from './fx.js';

const WII_BLUE = '#34beed';
// Leaf palette with a deeper shadow so the white tagline holds up over clouds.
const LOGO_PAL = { ...LOGO_PALETTES.leaf, shadow: 'rgba(8,80,40,0.85)' };
const RES = 1.5;

// --------------------------------------------------------------- shaders

const planeVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Same idea as UIPlane's material: sheen sweep + hover brighten + press dim.
const planeFrag = /* glsl */ `
  uniform sampler2D map;
  uniform float uOpacity;
  uniform float uHover;
  uniform float uPress;
  uniform float uTime;
  uniform float uPhase;
  uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(map, vUv);
    float diag = vUv.x * uSize.x + (1.0 - vUv.y) * uSize.y * 0.7;
    float period = uSize.x + uSize.y + 700.0;
    float pos = mod(uTime * 260.0 + uPhase * period, period) - 200.0;
    float band = exp(-pow((diag - pos) / 26.0, 2.0)) + 0.4 * exp(-pow((diag - pos + 45.0) / 9.0, 2.0));
    float sheen = band * (0.12 + uHover * 0.5) * 0.6;
    c.rgb = c.rgb * (1.0 + uHover * 0.06 - uPress * 0.12) + vec3(sheen) * c.a;
    gl_FragColor = c * uOpacity;
    #include <colorspace_fragment>
  }
`;

function useLiveCanvas(width, height, pad) {
  return useDisposable(() => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((width + pad * 2) * RES);
    canvas.height = Math.ceil((height + pad * 2) * RES);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.premultiplyAlpha = true;
    texture.anisotropy = 4;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        uOpacity: { value: 0 },
        uHover: { value: 0 },
        uPress: { value: 0 },
        uTime: { value: 0 },
        uPhase: { value: Math.random() },
        uSize: { value: new THREE.Vector2(width + pad * 2, height + pad * 2) },
      },
      vertexShader: planeVert,
      fragmentShader: planeFrag,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const ctx = canvas.getContext('2d');
    return { canvas, ctx, texture, material };
  }, [width, height, pad]);
}

const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

// ------------------------------------------------------------ channel tile

const TILE_W = 146;
const TILE_H = 92;
const TILE_PAD = 22;
const TILE_R = 16;
const INSET = 5;

function drawTileFrame(ctx, w, h) {
  // Soft drop shadow + glossy white bezel (Wii channel frame).
  ctx.save();
  ctx.shadowColor = 'rgba(10,50,90,0.32)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  roundRect(ctx, 0, 0, w, h, TILE_R);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  roundRect(ctx, 0, 0, w, h, TILE_R);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [
    [0, '#ffffff'],
    [0.5, '#f1f4f6'],
    [1, '#dde3e8'],
  ]);
  ctx.fill();
}

function drawTileGloss(ctx, w, h, hover) {
  // Inner bevel line, glossy top highlight, grey outline.
  ctx.save();
  roundRect(ctx, INSET, INSET, w - INSET * 2, h - INSET * 2, TILE_R - INSET);
  ctx.clip();
  ctx.fillStyle = linear(ctx, 0, INSET, 0, h * 0.45, [
    [0, 'rgba(255,255,255,0.55)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  ctx.beginPath();
  ctx.ellipse(w / 2, INSET - h * 0.12, w * 0.62, h * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  roundRect(ctx, INSET - 0.5, INSET - 0.5, w - INSET * 2 + 1, h - INSET * 2 + 1, TILE_R - INSET);
  ctx.strokeStyle = 'rgba(120,135,150,0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  roundRect(ctx, 0.75, 0.75, w - 1.5, h - 1.5, TILE_R);
  ctx.strokeStyle = hover > 0.01 ? `rgba(52,190,237,${0.4 + hover * 0.6})` : 'rgba(150,162,175,0.85)';
  ctx.lineWidth = 1.5 + hover * 2;
  ctx.stroke();
}

function drawLabel(ctx, label, w, h, hover, accent) {
  const lh = 24;
  const y = h - INSET - lh;
  ctx.save();
  roundRect(ctx, INSET, INSET, w - INSET * 2, h - INSET * 2, TILE_R - INSET);
  ctx.clip();
  ctx.fillStyle = hover > 0.01 ? `rgba(52,190,237,${0.78 + hover * 0.2})` : 'rgba(255,255,255,0.84)';
  ctx.fillRect(INSET, y, w - INSET * 2, lh);
  ctx.fillStyle = hover > 0.01 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.9)';
  ctx.fillRect(INSET, y, w - INSET * 2, 1.2);
  ctx.restore();
  drawText(ctx, label, w / 2, y + lh / 2 + 1, {
    size: 16,
    weight: 900,
    fill: hover > 0.01 ? '#ffffff' : '#56636f',
    shadow: hover > 0.01 ? { color: 'rgba(0,60,110,0.5)', blur: 3, y: 1 } : null,
    letterSpacing: 0.3,
    maxWidth: w - 24,
  });
  // Accent dot (the channel's colour) at left.
  ctx.beginPath();
  ctx.arc(INSET + 12, y + lh / 2, 4, 0, Math.PI * 2);
  ctx.fillStyle = hover > 0.01 ? '#ffffff' : accent;
  ctx.fill();
}

function ChannelTile({ channel, index, position, delay, onActivate }) {
  const live = useLiveCanvas(TILE_W, TILE_H, TILE_PAD);
  const group = useRef();
  const anim = useRef({ hover: 0, press: 0, pressed: false, born: null, last: -1, pop: 0, hovered: false });
  const [hovered, setHovered] = useState(false);
  anim.current.hovered = hovered;
  useEffect(() => () => hovered && setCursor(false), [hovered]);

  // Pre-rendered glow halo for the hover state.
  const glow = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = live.canvas.width;
    c.height = live.canvas.height;
    const g = c.getContext('2d');
    g.setTransform(RES, 0, 0, RES, TILE_PAD * RES, TILE_PAD * RES);
    g.shadowColor = 'rgba(52,190,237,1)';
    g.shadowBlur = 16;
    roundRect(g, 0, 0, TILE_W, TILE_H, TILE_R);
    g.strokeStyle = 'rgba(120,220,255,1)';
    g.lineWidth = 5;
    g.stroke();
    g.stroke();
    return c;
  }, [live]);

  useFrame((state, delta) => {
    const a = anim.current;
    const t = state.clock.elapsedTime;
    if (a.born === null) a.born = t;
    a.hover = damp(a.hover, a.hovered ? 1 : 0, 12, delta);
    a.press = damp(a.press, a.pressed ? 1 : 0, 24, delta);
    a.pop = Math.max(0, a.pop - delta * 2.2);
    const p = clamp((t - a.born - delay) / 0.6);
    const enter = easeOutBack(p);
    const s = (0.85 + 0.15 * enter) * (1 + 0.1 * a.hover) * (1 - 0.06 * a.press) * (1 + Math.sin(a.pop * Math.PI * 3) * a.pop * 0.06);
    const g = group.current;
    g.position.set(position[0], position[1] + (1 - enter) * -30 + Math.sin(t * 1.1 + index * 0.9) * 1.2, 2 + a.hover * 6);
    g.scale.setScalar(s);
    const u = live.material.uniforms;
    u.uTime.value = t;
    u.uHover.value = a.hover;
    u.uPress.value = a.press;
    u.uOpacity.value = clamp(p * 1.8);

    // Redraw at ~30 fps (every frame while hovered for a crisp glow fade).
    if (t - a.last < 1 / 30 && a.hover < 0.02 && !a.hovered) return;
    a.last = t;
    const { ctx, canvas, texture } = live;
    const w = TILE_W;
    const h = TILE_H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (a.hover > 0.01) {
      ctx.globalAlpha = a.hover;
      ctx.drawImage(glow, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(RES, 0, 0, RES, TILE_PAD * RES, TILE_PAD * RES);
    drawTileFrame(ctx, w, h);
    ctx.save();
    roundRect(ctx, INSET, INSET, w - INSET * 2, h - INSET * 2, TILE_R - INSET);
    ctx.clip();
    ctx.translate(INSET, INSET);
    const speed = 1 + a.hover * 0.6;
    channel.draw(ctx, w - INSET * 2, h - INSET * 2 - 22, t * speed + index * 3.1, beat.beat + beat.phase);
    ctx.restore();
    drawTileGloss(ctx, w, h, a.hover);
    drawLabel(ctx, channel.label, w, h, a.hover, channel.accent);
    texture.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <mesh material={live.material}>
        <planeGeometry args={[TILE_W + TILE_PAD * 2, TILE_H + TILE_PAD * 2]} />
      </mesh>
      <mesh
        visible={false}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          setCursor(true);
          meadowFx.hoverIndex = index;
          onActivate('hover', index);
        }}
        onPointerOut={() => {
          setHovered(false);
          setCursor(false);
          anim.current.pressed = false;
          if (meadowFx.hoverIndex === index) meadowFx.hoverIndex = -1;
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          anim.current.pressed = true;
        }}
        onPointerUp={() => {
          anim.current.pressed = false;
        }}
        onClick={(e) => {
          e.stopPropagation();
          anim.current.pop = 1;
          onActivate('click', index, position);
        }}
      >
        <planeGeometry args={[TILE_W, TILE_H]} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------ click sparkle burst

const BURST_N = 22;

function makeBurstAtlas() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d');
  // Cell 0: four-point sparkle. Cell 1: musical note.
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const r = i % 2 === 0 ? 26 : 6;
    ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  ctx.fill();
  ctx.font = font(44, 900, 'round');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.beginPath();
  ctx.ellipse(86, 44, 9, 7, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(92, 12, 4, 32);
  ctx.beginPath();
  ctx.moveTo(96, 12);
  ctx.quadraticCurveTo(110, 22, 104, 34);
  ctx.quadraticCurveTo(104, 24, 96, 22);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ClickBurst({ burst }) {
  const texture = useDisposable(makeBurstAtlas);
  const geometry = useDisposable(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.attributes.position = plane.attributes.position;
    g.attributes.uv = plane.attributes.uv;
    const a = new Float32Array(BURST_N * 4);
    const cols = new Float32Array(BURST_N * 3);
    const palette = ['#34beed', '#ffd23f', '#ff7ab8', '#7ed957', '#ffffff'].map((h) => new THREE.Color(h));
    for (let i = 0; i < BURST_N; i++) {
      const ang = (i / BURST_N) * Math.PI * 2 + Math.random() * 0.3;
      a.set([ang, 180 + Math.random() * 200, i % 3 === 0 ? 1 : 0, Math.random()], i * 4);
      const c = palette[i % palette.length];
      cols.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('aP', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('aC', new THREE.InstancedBufferAttribute(cols, 3));
    g.instanceCount = BURST_N;
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: texture }, uAge: { value: 99 }, uOrigin: { value: new THREE.Vector2() } },
        vertexShader: /* glsl */ `
          attribute vec4 aP;
          attribute vec3 aC;
          uniform float uAge;
          uniform vec2 uOrigin;
          varying vec2 vUv;
          varying vec3 vC;
          varying float vA;
          void main() {
            float t = uAge;
            vec2 dir = vec2(cos(aP.x), sin(aP.x));
            vec2 p = uOrigin + dir * aP.y * (1.0 - exp(-t * 3.5)) * 0.55 + vec2(0.0, -120.0 * t * t);
            float s = (aP.z > 0.5 ? 26.0 : 18.0 + aP.w * 12.0) * (1.0 - smoothstep(0.5, 1.1, t)) * smoothstep(0.0, 0.06, t);
            float rot = t * (aP.w - 0.5) * 6.0;
            vec2 q = vec2(position.x * cos(rot) - position.y * sin(rot), position.x * sin(rot) + position.y * cos(rot));
            vUv = vec2((uv.x + aP.z) * 0.5, uv.y);
            vC = aC;
            vA = 1.0 - smoothstep(0.6, 1.1, t);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p + q * s, 0.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          varying vec2 vUv;
          varying vec3 vC;
          varying float vA;
          void main() {
            vec4 t = texture2D(uMap, vUv);
            float a = t.a * vA;
            gl_FragColor = vec4(mix(vC, vec3(1.0), 0.35) * a, a);
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
  );
  const mesh = useRef();
  useFrame((state) => {
    const age = state.clock.elapsedTime - burst.current.time;
    material.uniforms.uAge.value = age;
    material.uniforms.uOrigin.value.set(burst.current.x, burst.current.y);
    mesh.current.visible = age < 1.2;
  });
  return <mesh ref={mesh} geometry={geometry} material={material} position={[0, 0, 30]} frustumCulled={false} renderOrder={20} />;
}

// --------------------------------------------------------------- Wii bar

function podPath(ctx, w, h, cx, cy, r) {
  const y0 = h - 44;
  ctx.beginPath();
  ctx.moveTo(-4, h + 4);
  ctx.lineTo(-4, y0);
  ctx.lineTo(cx - r - 26, y0);
  ctx.quadraticCurveTo(cx - r - 2, y0, cx - r * 0.96, cy - r * 0.28);
  ctx.arc(cx, cy, r, Math.PI + 0.29, Math.PI * 2 - 0.29);
  ctx.quadraticCurveTo(cx + r + 2, y0, cx + r + 26, y0);
  ctx.lineTo(w - 34, y0);
  ctx.quadraticCurveTo(w - 4, y0, w - 4, y0 + 30);
  ctx.lineTo(w - 4, h + 4);
  ctx.closePath();
}

function WiiPod({ side }) {
  const W = 380;
  const H = 128;
  const x = side < 0 ? HUD_LEFT + W / 2 : HUD_RIGHT - W / 2;
  return (
    <UIPlane
      width={W}
      height={H}
      pad={24}
      position={[x, HUD_BOTTOM + H / 2, 3]}
      appear={0.15}
      deps={[side]}
      draw={(ctx, w, h) => {
        ctx.save();
        if (side > 0) {
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
        }
        const cx = 94;
        const cy = h - 62;
        const r = 58;
        ctx.save();
        ctx.shadowColor = 'rgba(0,40,80,0.28)';
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = -2;
        podPath(ctx, w, h, cx, cy, r);
        ctx.fillStyle = 'rgba(240,244,247,0.94)';
        ctx.fill();
        ctx.restore();
        podPath(ctx, w, h, cx, cy, r);
        ctx.fillStyle = linear(ctx, 0, cy - r, 0, h, [
          [0, 'rgba(255,255,255,0.96)'],
          [0.55, 'rgba(240,244,247,0.95)'],
          [1, 'rgba(214,222,229,0.96)'],
        ]);
        ctx.fill();
        // Faint horizontal grooves like the Wii bar.
        ctx.save();
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        for (let y = h - 40; y < h; y += 5) ctx.fillRect(0, y, w, 1.6);
        ctx.restore();
        podPath(ctx, w, h, cx, cy, r);
        ctx.strokeStyle = WII_BLUE;
        ctx.lineWidth = 2.6;
        ctx.stroke();
        ctx.restore();
      }}
    />
  );
}

function RoundButton({ x, y, kind, onClick }) {
  const R = 42;
  const glowRef = useRef();
  const glowMat = useDisposable(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
  const glowTex = useDisposable(() => {
    if (kind !== 'mail') return null;
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    const g = c.getContext('2d');
    g.shadowColor = WII_BLUE;
    g.shadowBlur = 14;
    g.strokeStyle = '#7fdcff';
    g.lineWidth = 5;
    g.lineJoin = 'round';
    g.strokeRect(22, 30, 52, 36);
    g.beginPath();
    g.moveTo(22, 30);
    g.lineTo(48, 52);
    g.lineTo(74, 30);
    g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  if (glowTex) glowMat.map = glowTex;
  useFrame((state) => {
    if (!glowRef.current) return;
    // "You've got mail": the envelope pulses blue now and then.
    const t = state.clock.elapsedTime % 6;
    glowMat.opacity = t < 3 ? 0.5 + 0.5 * Math.sin(t * Math.PI * 2 - Math.PI / 2) : 0;
  });
  return (
    <group position={[x, y, 6]}>
      <UIPlane
        width={R * 2}
        height={R * 2}
        pad={20}
        appear={0.35}
        hoverScale={1.1}
        redrawOnHover
        onClick={onClick}
        deps={[kind]}
        draw={(ctx, w, h, { hovered }) => {
          const cx = w / 2;
          const cy = h / 2;
          if (hovered) {
            ctx.save();
            ctx.shadowColor = WII_BLUE;
            ctx.shadowBlur = 16;
            ctx.beginPath();
            ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
            ctx.strokeStyle = '#8fe1ff';
            ctx.lineWidth = 4;
            ctx.stroke();
            ctx.restore();
          }
          ctx.save();
          ctx.shadowColor = 'rgba(0,40,80,0.3)';
          ctx.shadowBlur = 8;
          ctx.shadowOffsetY = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.restore();
          ctx.beginPath();
          ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
          ctx.fillStyle = radial(ctx, cx, cy - R * 0.3, 2, cx, cy, R, [
            [0, '#ffffff'],
            [0.7, '#f1f4f7'],
            [1, '#d9e0e6'],
          ]);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = hovered ? WII_BLUE : '#a9b5c0';
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cy, R - 8, 0, Math.PI * 2);
          ctx.strokeStyle = hovered ? 'rgba(52,190,237,0.6)' : 'rgba(170,182,194,0.6)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          // Gloss cap.
          ctx.beginPath();
          ctx.ellipse(cx, cy - R * 0.42, R * 0.62, R * 0.36, 0, 0, Math.PI * 2);
          ctx.fillStyle = linear(ctx, 0, cy - R * 0.8, 0, cy - R * 0.05, [
            [0, 'rgba(255,255,255,0.95)'],
            [1, 'rgba(255,255,255,0)'],
          ]);
          ctx.fill();
          const ink = hovered ? WII_BLUE : '#8d9aa6';
          if (kind === 'wii') {
            drawText(ctx, 'Wii', cx, cy + 2, { size: 27, weight: 800, family: 'tech', fill: ink, letterSpacing: -0.5 });
          } else {
            ctx.save();
            ctx.strokeStyle = ink;
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            roundRect(ctx, cx - 18, cy - 12, 36, 25, 3);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - 17, cy - 10);
            ctx.lineTo(cx, cy + 3);
            ctx.lineTo(cx + 17, cy - 10);
            ctx.stroke();
            ctx.restore();
          }
        }}
      >
        {kind === 'mail' && (
          <mesh ref={glowRef} material={glowMat} position={[0, 0, 1]} renderOrder={5}>
            <planeGeometry args={[64, 64]} />
          </mesh>
        )}
      </UIPlane>
    </group>
  );
}

// ----------------------------------------------------------------- clock

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 500);
    return () => clearInterval(id);
  }, []);
  return now;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function WiiClock({ y }) {
  const now = useClock();
  const h = now.getHours() % 12 || 12;
  const m = String(now.getMinutes()).padStart(2, '0');
  const colon = now.getMilliseconds() < 500;
  const ampm = now.getHours() < 12 ? 'AM' : 'PM';
  const date = `${DAYS[now.getDay()]} ${now.getMonth() + 1}/${now.getDate()}`;
  const digits = `${h}${colon ? ':' : ' '}${m}`;
  return (
    <UIPlane
      width={300}
      height={78}
      pad={16}
      position={[0, y, 4]}
      appear={0.45}
      deps={[digits, ampm, date]}
      draw={(ctx, w) => {
        const style = {
          size: 50,
          weight: 800,
          family: 'tech',
          fill: [
            [0, '#b4bfc9'],
            [0.5, '#9aa6b2'],
            [1, '#7c8995'],
          ],
          stroke: 'rgba(255,255,255,0.95)',
          strokeWidth: 6,
          shadow: { color: 'rgba(0,40,70,0.35)', blur: 6, y: 2 },
          letterSpacing: 1,
        };
        // Lay out "h:mm" with a fixed-width colon so the blink doesn't shift it.
        const full = `${h}:${m}`;
        ctx.save();
        ctx.font = font(50, 800, 'tech');
        ctx.letterSpacing = '1px';
        const tw = ctx.measureText(full).width;
        const hw = ctx.measureText(`${h}`).width;
        const cw = ctx.measureText(':').width;
        ctx.restore();
        const x0 = w / 2 - tw / 2 - 12;
        drawText(ctx, `${h}`, x0, 28, { ...style, align: 'left' });
        if (colon) drawText(ctx, ':', x0 + hw + cw / 2, 25, { ...style, align: 'center' });
        drawText(ctx, m, x0 + hw + cw, 28, { ...style, align: 'left' });
        drawText(ctx, ampm, x0 + tw + 6, 40, { ...style, size: 16, strokeWidth: 4, align: 'left', letterSpacing: 0.5 });
        drawText(ctx, date, w / 2, 66, {
          size: 17,
          weight: 800,
          family: 'tech',
          fill: '#7f8c98',
          stroke: 'rgba(255,255,255,0.95)',
          strokeWidth: 4.5,
          letterSpacing: 0.5,
        });
      }}
    />
  );
}

// ------------------------------------------------------------------ menu

const GRID_GAP_X = 18;
const GRID_GAP_Y = 16;
const GRID_Y = -112;

export function MeadowMenu() {
  const burst = useRef({ time: -99, x: 0, y: 0 });
  const lastGust = useRef(-99);
  const clock = useRef(0);
  useFrame((state) => {
    clock.current = state.clock.elapsedTime;
  });
  const onActivate = (kind, index, position) => {
    const t = clock.current;
    if (kind === 'hover') {
      if (t - lastGust.current > 2.5) {
        triggerGust(t, 0.55);
        lastGust.current = t;
      }
      return;
    }
    triggerGust(t, 1.15);
    lastGust.current = t;
    meadowFx.burstTime = t;
    burst.current = { time: t, x: position[0], y: position[1] };
  };
  const cols = 4;
  const tiles = CHANNELS.map((channel, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = (c - (cols - 1) / 2) * (TILE_W + GRID_GAP_X);
    const y = GRID_Y + (0.5 - r) * (TILE_H + GRID_GAP_Y);
    return { channel, i, position: [x, y, 0], delay: 0.25 + (r * cols + c) * 0.06 };
  });
  return (
    <Hud>
      <Logo position={[0, 272, 0]} palette={LOGO_PAL} scale={0.72} tagline="feel the breeze" taglineColor="#ffffff" bob={[3, 0.9, 0]} />
      {tiles.map(({ channel, i, position, delay }) => (
        <ChannelTile key={channel.id} channel={channel} index={i} position={position} delay={delay} onActivate={onActivate} />
      ))}
      <WiiPod side={-1} />
      <WiiPod side={1} />
      <RoundButton x={HUD_LEFT + 94 + 0} y={HUD_BOTTOM + 62} kind="wii" onClick={() => onActivate('click', -1, [HUD_LEFT + 94, HUD_BOTTOM + 62])} />
      <RoundButton x={HUD_RIGHT - 94} y={HUD_BOTTOM + 62} kind="mail" onClick={() => onActivate('click', -1, [HUD_RIGHT - 94, HUD_BOTTOM + 62])} />
      <WiiClock y={-252} />
      <ClickBurst burst={burst} />
    </Hud>
  );
}
