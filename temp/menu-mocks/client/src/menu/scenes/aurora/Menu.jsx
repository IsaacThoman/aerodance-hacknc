import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HUD_LEFT, HUD_TOP } from '../../hud.jsx';
import { useCanvasTexture } from '../../ui/UIPlane.jsx';
import { Logo } from '../../ui/Logo.jsx';
import { icon as drawIcon, text as drawText, linear, radial } from '../../ui/draw.js';
import { setCursor } from '../../shared/hooks.js';
import { clamp, damp } from '../../shared/random.js';
import { fx, PALETTES } from './state.js';

// PS3 XMB-style cross menu: a row of glowing category icons, and under the
// focused one a vertical list of items. Hovering a category focuses it;
// hovering an item highlights it; clicking an item sends an aurora surge.

const CATEGORIES = [
  {
    label: 'Dance',
    icon: 'dancer',
    items: [
      { label: 'Quick Play', sub: 'Jump straight onto the floor', icon: 'play' },
      { label: 'Story', sub: 'Chase the lights across the north', icon: 'star' },
      { label: 'Practice', sub: 'Slow it down, learn every move', icon: 'dancer' },
      { label: 'Party', sub: 'Up to four dancers, one screen', icon: 'people' },
    ],
  },
  {
    label: 'Songs',
    icon: 'music',
    items: [
      { label: 'Library', sub: 'Every track you own', icon: 'music' },
      { label: 'Playlists', sub: 'Your mixes, your order', icon: 'headphones' },
      { label: 'Song Shop', sub: 'New this week: Polar Glow', icon: 'bag' },
    ],
  },
  {
    label: 'Online',
    icon: 'globe',
    items: [
      { label: 'World Stage', sub: 'Dance live with everyone', icon: 'globe' },
      { label: 'Ranked', sub: 'Climb the aurora leagues', icon: 'trophy' },
      { label: 'Lobbies', sub: 'Join or host a room', icon: 'gamepad' },
    ],
  },
  {
    label: 'Friends',
    icon: 'people',
    items: [
      { label: 'Friend List', sub: '3 friends online', icon: 'people' },
      { label: 'Messages', sub: 'No new messages', icon: 'heart' },
      { label: 'Invites', sub: 'Send a dance invite', icon: 'sparkle' },
    ],
  },
  {
    label: 'Wardrobe',
    icon: 'shirt',
    items: [
      { label: 'Outfits', sub: 'Parkas, glitter and glow', icon: 'shirt' },
      { label: 'Accessories', sub: 'Earmuffs to light-up boots', icon: 'star' },
      { label: 'Emotes', sub: 'Victory dances and waves', icon: 'heart' },
    ],
  },
  {
    label: 'Settings',
    icon: 'gear',
    items: [
      { label: 'Display', sub: 'Brightness, calibration', icon: 'sparkle' },
      { label: 'Audio', sub: 'Music, voice and effects', icon: 'headphones' },
      { label: 'Controls', sub: 'Remap and calibrate', icon: 'gamepad' },
      { label: 'System', sub: 'Version 1.0.0', icon: 'power' },
    ],
  },
];

const ROW_Y = 132;
const SPACING = 132;
const ROW_X0 = -400;
const LIST_TOP = ROW_Y - 128;
const ITEM_GAP = 62;
const catX = (i) => ROW_X0 + i * SPACING;
const WHITE = new THREE.Color(1, 1, 1);

// ---------------------------------------------------------------------------
// Sprite: a canvas-textured quad whose opacity/brightness are animated by the
// owner. Premultiplied, unlit, drawn on top of post-processing.

const spriteVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const spriteFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float uOpacity;
  uniform float uBright;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(map, vUv);
    c.rgb *= 1.0 + uBright;
    gl_FragColor = c * uOpacity;
    #include <colorspace_fragment>
  }
`;

function useSpriteMaterial(texture, additive = false) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { map: { value: null }, uOpacity: { value: 0 }, uBright: { value: 0 } },
        vertexShader: spriteVertex,
        fragmentShader: spriteFragment,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [additive],
  );
  useEffect(() => () => material.dispose(), [material]);
  material.uniforms.map.value = texture;
  return material;
}

function Sprite({ width, height, pad = 16, draw, deps = [], meshRef, additive = false, position = [0, 0, 0] }) {
  const texture = useCanvasTexture(width, height, draw, deps, { pad });
  const material = useSpriteMaterial(texture, additive);
  return (
    <mesh ref={meshRef} material={material} position={position}>
      <planeGeometry args={[width + pad * 2, height + pad * 2]} />
    </mesh>
  );
}

function HitArea({ width, height, position = [0, 0, 0], onOver, onOut, onClick, onDown }) {
  const hovered = useRef(false);
  useEffect(
    () => () => {
      if (hovered.current) setCursor(false);
    },
    [],
  );
  return (
    <mesh
      visible={false}
      position={position}
      onPointerOver={(e) => {
        e.stopPropagation();
        hovered.current = true;
        setCursor(true);
        onOver?.();
      }}
      onPointerOut={() => {
        hovered.current = false;
        setCursor(false);
        onOut?.();
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onDown?.();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <planeGeometry args={[width, height]} />
    </mesh>
  );
}

// Glossy white XMB glyph: soft cyan glow, pearly gradient, top gloss.
function drawGlyph(ctx, name, cx, cy, size, { glow = 14, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(150,235,255,0.95)';
  ctx.shadowBlur = glow;
  drawIcon(ctx, name, cx, cy, size, 'rgba(255,255,255,0.9)');
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  const g = linear(ctx, 0, -size / 2, 0, size / 2, [
    [0, '#ffffff'],
    [0.5, '#f2fbff'],
    [0.56, '#d4eefc'],
    [1, '#eaf8ff'],
  ]);
  ctx.translate(-cx, -cy);
  drawIcon(ctx, name, cx, cy, size, g);
  ctx.restore();
}

// ---------------------------------------------------------------------------

function Category({ index, cat, focused, onFocus, appearDelay }) {
  const scaler = useRef();
  const icon = useRef();
  const halo = useRef();
  const label = useRef();
  const a = useRef({ f: focused ? 1 : 0, hover: 0, hovered: false, born: null, pop: 0 });

  useFrame((state, dt) => {
    const s = a.current;
    const t = state.clock.elapsedTime;
    if (s.born === null) s.born = t;
    const appear = clamp((t - s.born - appearDelay) / 0.6);
    s.f = damp(s.f, focused ? 1 : 0, 9, dt);
    s.hover = damp(s.hover, s.hovered ? 1 : 0, 12, dt);
    s.pop = damp(s.pop, 0, 6, dt);
    const sc = 0.72 + 0.36 * s.f + 0.05 * s.hover + s.pop * 0.12;
    scaler.current.scale.setScalar(sc * (0.85 + 0.15 * appear));
    scaler.current.position.y = (1 - appear) * -16 + Math.sin(t * 1.2 + index) * 1.5 * s.f;
    icon.current.material.uniforms.uOpacity.value = (0.5 + 0.5 * s.f + 0.25 * s.hover * (1 - s.f)) * appear;
    icon.current.material.uniforms.uBright.value = s.pop * 0.6;
    halo.current.material.uniforms.uOpacity.value = (s.f * (0.62 + 0.12 * Math.sin(t * 1.7)) + s.hover * 0.2) * appear;
    label.current.material.uniforms.uOpacity.value = s.f * appear;
    label.current.position.y = -66 + (1 - s.f) * 8;
  });

  useEffect(() => {
    if (focused) a.current.pop = 1;
  }, [focused]);

  return (
    <group position={[catX(index), ROW_Y, 0]}>
      <group ref={scaler}>
        <Sprite
          meshRef={halo}
          width={150}
          height={150}
          pad={0}
          additive
          deps={[]}
          draw={(ctx, w, h) => {
            ctx.fillStyle = radial(ctx, w / 2, h / 2, 0, w / 2, h / 2, w / 2, [
              [0, 'rgba(200,250,255,0.55)'],
              [0.35, 'rgba(120,220,255,0.22)'],
              [1, 'rgba(80,180,255,0)'],
            ]);
            ctx.fillRect(0, 0, w, h);
          }}
        />
        <Sprite meshRef={icon} width={84} height={84} pad={20} deps={[cat.icon]} draw={(ctx, w, h) => drawGlyph(ctx, cat.icon, w / 2, h / 2, 66, { glow: 16 })} />
      </group>
      <Sprite
        meshRef={label}
        width={200}
        height={34}
        deps={[cat.label]}
        draw={(ctx, w, h) => {
          drawText(ctx, cat.label, w / 2, h / 2, { size: 23, weight: 800, fill: 'rgba(0,0,0,0)', letterSpacing: 0.5, shadow: { color: 'rgba(0,12,40,0.75)', blur: 9, y: 2 } });
          drawText(ctx, cat.label, w / 2, h / 2, { size: 23, weight: 800, fill: '#ffffff', letterSpacing: 0.5, shadow: { color: 'rgba(120,220,255,0.95)', blur: 10, y: 0 } });
        }}
      />
      <HitArea
        width={SPACING - 6}
        height={120}
        onOver={() => {
          a.current.hovered = true;
          onFocus(index);
        }}
        onOut={() => {
          a.current.hovered = false;
        }}
        onClick={() => {
          a.current.pop = 1;
          onFocus(index);
        }}
      />
    </group>
  );
}

function Item({ catIndex, index, item, active, highlighted, onHighlight }) {
  const root = useRef();
  const glow = useRef();
  const backing = useRef();
  const icon = useRef();
  const iconGroup = useRef();
  const labelGroup = useRef();
  const label = useRef();
  const sub = useRef();
  const a = useRef({ vis: 0, hi: highlighted ? 1 : 0, flash: 0, press: 0, pressed: false, since: 0, wasActive: false });

  const baseX = catX(catIndex);
  const baseY = LIST_TOP - index * ITEM_GAP;

  useFrame((state, dt) => {
    const s = a.current;
    const t = state.clock.elapsedTime;
    if (active && !s.wasActive) s.since = t;
    s.wasActive = active;
    const ready = active && t - s.since > index * 0.045;
    s.vis = damp(s.vis, ready ? 1 : 0, ready ? 10 : 16, dt);
    s.hi = damp(s.hi, highlighted && active ? 1 : 0, 12, dt);
    s.flash = damp(s.flash, 0, 3.5, dt);
    s.press = damp(s.press, s.pressed ? 1 : 0, 25, dt);
    const visible = s.vis > 0.003;
    root.current.visible = visible;
    if (!visible) return;
    // Slide in from the right and settle; highlighted items breathe gently.
    root.current.position.set(baseX + (1 - s.vis) * 36, baseY - (1 - s.vis) * 10, 0);
    const pressK = 1 - s.press * 0.06;
    iconGroup.current.scale.setScalar((0.66 + 0.34 * s.hi + s.flash * 0.15) * pressK);
    labelGroup.current.scale.setScalar((0.8 + 0.2 * s.hi + s.flash * 0.06) * pressK);
    labelGroup.current.position.x = 34 + 10 * s.hi;
    icon.current.material.uniforms.uOpacity.value = s.vis * (0.6 + 0.4 * s.hi);
    icon.current.material.uniforms.uBright.value = s.flash * 0.8;
    label.current.material.uniforms.uOpacity.value = s.vis * (0.62 + 0.38 * s.hi);
    label.current.material.uniforms.uBright.value = s.flash * 0.5;
    sub.current.material.uniforms.uOpacity.value = s.vis * s.hi * 0.9;
    sub.current.position.y = -22 - (1 - s.hi) * 6;
    glow.current.material.uniforms.uOpacity.value = s.vis * (s.hi * (0.75 + 0.15 * Math.sin(t * 2.2)) + s.flash * 0.8);
    backing.current.material.uniforms.uOpacity.value = s.vis * (0.6 + 0.4 * s.hi);
  });

  const activate = () => {
    a.current.flash = 1;
    fx.surge = 1;
    fx.surgeAge = 0;
    fx.shoot = true;
  };

  return (
    <group ref={root} visible={false}>
      <Sprite
        meshRef={backing}
        width={440}
        height={78}
        pad={0}
        position={[160, -4, -2]}
        deps={[]}
        draw={(ctx, w, h) => {
          ctx.save();
          ctx.scale(1, h / w);
          ctx.fillStyle = radial(ctx, w * 0.42, w / 2, 0, w * 0.42, w / 2, w * 0.5, [
            [0, 'rgba(2,10,30,0.5)'],
            [0.5, 'rgba(2,10,30,0.3)'],
            [1, 'rgba(2,10,30,0)'],
          ]);
          ctx.fillRect(0, 0, w, w);
          ctx.restore();
        }}
      />
      <Sprite
        meshRef={glow}
        width={420}
        height={70}
        pad={0}
        additive
        position={[170, 0, -1]}
        deps={[]}
        draw={(ctx, w, h) => {
          const g = ctx.createLinearGradient(0, 0, w, 0);
          g.addColorStop(0, 'rgba(140,230,255,0)');
          g.addColorStop(0.12, 'rgba(140,230,255,0.22)');
          g.addColorStop(0.5, 'rgba(120,210,255,0.12)');
          g.addColorStop(1, 'rgba(120,210,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, h * 0.18, w, h * 0.64);
          ctx.globalCompositeOperation = 'destination-in';
          const v = ctx.createLinearGradient(0, 0, 0, h);
          v.addColorStop(0.15, 'rgba(0,0,0,0)');
          v.addColorStop(0.5, 'rgba(0,0,0,1)');
          v.addColorStop(0.85, 'rgba(0,0,0,0)');
          ctx.fillStyle = v;
          ctx.fillRect(0, 0, w, h);
          ctx.globalCompositeOperation = 'lighter';
          const line = (y) => {
            const lg = ctx.createLinearGradient(0, 0, w, 0);
            lg.addColorStop(0, 'rgba(255,255,255,0)');
            lg.addColorStop(0.15, 'rgba(220,250,255,0.45)');
            lg.addColorStop(0.7, 'rgba(220,250,255,0.12)');
            lg.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = lg;
            ctx.fillRect(0, y, w, 1.2);
          };
          line(h * 0.2);
          line(h * 0.8 - 1.2);
        }}
      />
      <group ref={iconGroup}>
        <Sprite meshRef={icon} width={56} height={56} pad={16} deps={[item.icon]} draw={(ctx, w, h) => drawGlyph(ctx, item.icon, w / 2, h / 2, 40, { glow: 12 })} />
      </group>
      <group ref={labelGroup} position={[34, 0, 0]}>
        <Sprite
          meshRef={label}
          width={300}
          height={40}
          position={[150, 3, 0]}
          deps={[item.label]}
          draw={(ctx, w, h) => {
            drawText(ctx, item.label, 0, h / 2, { size: 28, weight: 800, align: 'left', fill: 'rgba(0,0,0,0)', letterSpacing: 0.3, shadow: { color: 'rgba(0,12,40,0.75)', blur: 9, y: 2 } });
            drawText(ctx, item.label, 0, h / 2, { size: 28, weight: 800, align: 'left', fill: '#ffffff', letterSpacing: 0.3, shadow: { color: 'rgba(110,210,255,0.9)', blur: 10, y: 0 } });
          }}
        />
        <Sprite
          meshRef={sub}
          width={300}
          height={22}
          position={[150, -22, 0]}
          deps={[item.sub]}
          draw={(ctx, w, h) =>
            drawText(ctx, item.sub, 0, h / 2, { size: 16.5, weight: 800, align: 'left', fill: 'rgba(230,248,255,0.95)', shadow: { color: 'rgba(0,14,44,0.85)', blur: 6, y: 1 } })
          }
        />
      </group>
      {active && (
        <HitArea
          width={360}
          height={ITEM_GAP - 4}
          position={[150, 0, 0]}
          onOver={() => onHighlight(index)}
          onDown={() => {
            a.current.pressed = true;
          }}
          onOut={() => {
            a.current.pressed = false;
          }}
          onClick={() => {
            a.current.pressed = false;
            onHighlight(index);
            activate();
          }}
        />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// XMB wave: flowing translucent ribbons across the lower screen.

function XmbWave() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uTint: { value: new THREE.Color('#bff4ff') }, uOpacity: { value: 0 } },
        vertexShader: spriteVertex,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uTint;
          uniform float uOpacity;
          varying vec2 vUv;
          float curve(float x, float base, float a1, float k1, float s1, float a2, float k2, float s2, float ph) {
            return base + a1 * sin(x * k1 + uTime * s1 + ph) + a2 * sin(x * k2 - uTime * s2 + ph * 1.7);
          }
          void main() {
            vec2 p = vec2((vUv.x - 0.5) * 1280.0, (vUv.y - 0.5) * 720.0);
            float t = uTime;
            float acc = 0.0;
            // Two translucent sheets with brighter edges.
            for (int i = 0; i < 2; i++) {
              float fi = float(i);
              float top = curve(p.x, -150.0 - fi * 26.0, 34.0, 0.0042, 0.21, 18.0, 0.0093, 0.17, fi * 2.4);
              float bot = curve(p.x, -230.0 - fi * 18.0, 26.0, 0.0051, 0.16, 14.0, 0.0081, 0.23, fi * 1.3 + 4.0);
              float inside = smoothstep(bot - 1.0, bot + 1.0, p.y) * smoothstep(top + 1.0, top - 1.0, p.y);
              float span = max(top - bot, 1.0);
              float k = clamp((p.y - bot) / span, 0.0, 1.0);
              float sheet = inside * (0.05 + 0.12 * k * k * k * k + 0.06 * (1.0 - k) * (1.0 - k) * (1.0 - k));
              float de = (p.y - top) / 2.4;
              float edge = exp(-de * de) * 0.3 + exp(-abs(p.y - top) / 12.0) * 0.12;
              acc += sheet + edge * (0.6 + 0.4 * sin(p.x * 0.006 + t * 0.4 + fi));
            }
            // Fine filament lines.
            for (int i = 0; i < 3; i++) {
              float fi = float(i);
              float y = curve(p.x, -175.0 + fi * 22.0, 40.0, 0.0036, 0.27, 12.0, 0.011, 0.19, fi * 3.1 + 1.0);
              float dl = (p.y - y) / 1.4;
              acc += exp(-dl * dl) * 0.12 + exp(-abs(p.y - y) / 8.0) * 0.035;
            }
            float fadeX = smoothstep(-660.0, -380.0, p.x) * 0.6 + 0.4;
            fadeX *= smoothstep(660.0, 420.0, p.x) * 0.5 + 0.5;
            float a = acc * fadeX * uOpacity * 0.6;
            gl_FragColor = vec4(uTint * a, a);
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const tint = useRef(new THREE.Color());
  useFrame((state, dt) => {
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uOpacity.value = damp(u.uOpacity.value, 1, 1.5, dt);
    // Lean toward the focused category's aurora color.
    tint.current.set(PALETTES[fx.focus].mid).lerp(WHITE, 0.55);
    u.uTint.value.lerp(tint.current, 1 - Math.exp(-3 * dt));
  });
  return (
    <mesh material={material} position={[0, 0, -40]}>
      <planeGeometry args={[1280, 720]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = `${now.getMonth() + 1}/${now.getDate()}`;
  const ref = useRef();
  const born = useRef(null);
  useFrame((state) => {
    if (born.current === null) born.current = state.clock.elapsedTime;
    ref.current.material.uniforms.uOpacity.value = clamp((state.clock.elapsedTime - born.current - 0.3) / 0.8);
  });
  const w = 240;
  return (
    <Sprite
      meshRef={ref}
      width={w}
      height={36}
      position={[HUD_LEFT + 46 + w / 2, HUD_TOP - 40, 0]}
      deps={[time, date]}
      draw={(ctx, cw, ch) => {
        // Small crescent glyph.
        ctx.save();
        ctx.shadowColor = 'rgba(150,230,255,0.9)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(11, ch / 2, 9, 0, Math.PI * 2);
        ctx.arc(15, ch / 2 - 3.5, 8, 0, Math.PI * 2, true);
        ctx.fillStyle = '#f4fbff';
        ctx.fill('evenodd');
        ctx.restore();
        const shadow = { color: 'rgba(120,210,255,0.8)', blur: 8, y: 0 };
        drawText(ctx, date, 32, ch / 2 + 1, { size: 19, weight: 600, family: 'tech', align: 'left', fill: 'rgba(235,248,255,0.85)', shadow, letterSpacing: 1 });
        drawText(ctx, time, 92, ch / 2 + 1, { size: 19, weight: 800, family: 'tech', align: 'left', fill: '#ffffff', shadow, letterSpacing: 1 });
      }}
    />
  );
}

export function AuroraMenu() {
  const [focus, setFocus] = useState(0);
  const [highlight, setHighlight] = useState(() => CATEGORIES.map(() => 0));

  const onFocus = (i) => {
    setFocus(i);
    fx.focus = i;
  };
  useEffect(() => {
    fx.focus = 0;
  }, []);

  useFrame((_, dt) => {
    fx.surgeAge += dt;
    fx.surge = Math.max(0, fx.surge - dt * 0.45);
  });

  return (
    <group>
      <XmbWave />
      <Logo palette="night" position={[0, 266, 0]} scale={0.6} tagline="aurora lake" taglineColor="#d8f6ff" bob={[3, 0.9, 0]} />
      <Clock />
      {CATEGORIES.map((cat, i) => (
        <Category key={cat.label} index={i} cat={cat} focused={focus === i} onFocus={onFocus} appearDelay={0.15 + i * 0.06} />
      ))}
      {CATEGORIES.map((cat, ci) =>
        cat.items.map((item, ii) => (
          <Item
            key={`${cat.label}-${item.label}`}
            catIndex={ci}
            index={ii}
            item={item}
            active={focus === ci}
            highlighted={highlight[ci] === ii}
            onHighlight={(j) => {
              fx.boost = 1;
              setHighlight((h) => (h[ci] === j ? h : h.map((v, k) => (k === ci ? j : v))));
            }}
          />
        )),
      )}
    </group>
  );
}
