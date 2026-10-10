import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Hud } from '../../hud.jsx';
import { damp } from '../../shared/random.js';
import { Logo } from '../../ui/Logo.jsx';
import { UIPlane } from '../../ui/UIPlane.jsx';
import { gel, icon, linear, orb, radial, roundRect, text, withShadow } from '../../ui/draw.js';
import { CanvasSprite, FrameGrab, GlassPanel } from './hudkit.jsx';
import { ClockGadget, MediaGadget, WeatherGadget } from './Gadgets.jsx';
import { reactions, triggerBurst } from './reactions.js';

// Windows Vista / 7 homage: a frosted Aero glass sidebar (Start-menu style
// list with a sliding light-blue selection) plus Sidebar gadgets on the right.

const PANEL = { x: -452, y: -36, w: 332, h: 500 };
const ITEM_W = 300;
const ITEM_H = 54;

const ITEMS = [
  { label: 'Start Dancing', sub: "Jump into today's set", icon: 'play', focus: 'plaza', color: '#3cc43c', light: '#c8ffb0', dark: '#137a1c' },
  { label: 'Career', sub: 'Climb the city charts', icon: 'trophy', focus: 'hero', color: '#f2b51c', light: '#fff1a8', dark: '#b06a06' },
  { label: 'Online Plaza', sub: 'Dance with friends worldwide', icon: 'globe', focus: 'dome', color: '#1e9cf0', light: '#b9ecff', dark: '#0a55a6' },
  { label: 'Music Library', sub: '128 tracks  ·  6 new', icon: 'music', focus: 'shell', color: '#7a5cf0', light: '#dccfff', dark: '#3a1fa6' },
  { label: 'Wardrobe', sub: 'Outfits & eco-fashion', icon: 'shirt', focus: 'twist', color: '#ff6f9c', light: '#ffd3e2', dark: '#c0285a' },
  { label: 'Settings', sub: 'Sound, display, controls', icon: 'gear', focus: 'turbines', color: '#7d93a8', light: '#e8f1f8', dark: '#3b5163' },
];

// Item centers relative to the panel center (a separator follows the first item).
const ITEM_Y = ITEMS.map((_, i) => 129 - i * ITEM_H - (i > 0 ? 8 : 0));

function drawItem(ctx, w, h, item, hovered) {
  const s = 40;
  const ix = 8;
  const iy = (h - s) / 2;
  gel(ctx, {
    x: ix,
    y: iy,
    w: s,
    h: s,
    r: 10,
    color: item.color,
    light: item.light,
    dark: item.dark,
    outline: 'rgba(0,40,80,0.4)',
    shadow: { color: 'rgba(0,30,70,0.32)', blur: 6, y: 2 },
  });
  withShadow(ctx, { color: 'rgba(0,30,60,0.45)', blur: 3, y: 1 }, () => icon(ctx, item.icon, ix + s / 2 + (item.icon === 'play' ? 1 : 0), iy + s / 2 + 1, s * 0.5, '#ffffff'));
  const tx = ix + s + 13;
  text(ctx, item.label, tx, h * 0.39, { size: 18, weight: 800, fill: '#12365c', align: 'left', maxWidth: w - tx - 26 });
  text(ctx, item.sub, tx, h * 0.72, { size: 11.5, weight: 700, fill: 'rgba(28,72,112,0.66)', align: 'left', maxWidth: w - tx - 26 });
  if (hovered) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    icon(ctx, 'chevronRight', w - 16, h / 2, 13, '#2a6fb3');
    ctx.restore();
  }
}

function drawHighlight(ctx, w, h) {
  // Classic Vista selection: light-blue glossy rectangle with a crisp border.
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 5);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [
    [0, '#f1f8ff'],
    [0.48, '#dcecfd'],
    [0.52, '#c8e1fb'],
    [1, '#b9d8fb'],
  ]);
  ctx.fill();
  ctx.strokeStyle = '#7da2ce';
  ctx.lineWidth = 1;
  ctx.stroke();
  roundRect(ctx, 1.5, 1.5, w - 3, h - 3, 4);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  // Soft glow at the bottom.
  ctx.save();
  roundRect(ctx, 2, 2, w - 4, h - 4, 4);
  ctx.clip();
  ctx.fillStyle = radial(ctx, w / 2, h * 1.1, 0, w / 2, h * 1.1, w * 0.45, [
    [0, 'rgba(160,215,255,0.55)'],
    [1, 'rgba(160,215,255,0)'],
  ]);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawUserTile(ctx, w, h) {
  const s = 58;
  const x = 4;
  const y = (h - s) / 2;
  // Picture frame (thick translucent glossy border like the Vista user tile).
  withShadow(ctx, { color: 'rgba(0,30,70,0.35)', blur: 8, y: 3 }, () => {
    roundRect(ctx, x, y, s, s, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fill();
  });
  const p = 5;
  ctx.save();
  roundRect(ctx, x + p, y + p, s - p * 2, s - p * 2, 5);
  ctx.clip();
  const ps = s - p * 2;
  const px = x + p;
  const py = y + p;
  ctx.fillStyle = linear(ctx, 0, py, 0, py + ps, [
    [0, '#2f8fe8'],
    [0.6, '#9fdcff'],
    [1, '#d9f6ff'],
  ]);
  ctx.fillRect(px, py, ps, ps);
  ctx.fillStyle = radial(ctx, px + ps * 0.72, py + ps * 0.3, 0, px + ps * 0.72, py + ps * 0.3, ps * 0.4, [
    [0, 'rgba(255,250,210,1)'],
    [0.25, 'rgba(255,240,170,0.9)'],
    [1, 'rgba(255,240,170,0)'],
  ]);
  ctx.fillRect(px, py, ps, ps);
  ctx.fillStyle = '#5cc13a';
  ctx.beginPath();
  ctx.moveTo(px, py + ps * 0.78);
  ctx.quadraticCurveTo(px + ps * 0.45, py + ps * 0.5, px + ps, py + ps * 0.72);
  ctx.lineTo(px + ps, py + ps);
  ctx.lineTo(px, py + ps);
  ctx.fill();
  ctx.fillStyle = '#3e9d2b';
  ctx.beginPath();
  ctx.moveTo(px, py + ps * 0.9);
  ctx.quadraticCurveTo(px + ps * 0.6, py + ps * 0.7, px + ps, py + ps * 0.95);
  ctx.lineTo(px + ps, py + ps);
  ctx.lineTo(px, py + ps);
  ctx.fill();
  // A little dancer silhouette.
  icon(ctx, 'dancer', px + ps * 0.4, py + ps * 0.56, ps * 0.5, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = linear(ctx, 0, py, 0, py + ps * 0.5, [
    [0, 'rgba(255,255,255,0.55)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  ctx.fillRect(px, py, ps, ps * 0.45);
  ctx.restore();
  roundRect(ctx, x + 0.5, y + 0.5, s - 1, s - 1, 9);
  ctx.strokeStyle = 'rgba(40,90,140,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  roundRect(ctx, x + p - 0.5, y + p - 0.5, ps + 1, ps + 1, 5);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();

  const tx = x + s + 14;
  const glow = { color: 'rgba(255,255,255,0.95)', blur: 8, y: 0 };
  text(ctx, 'Welcome back,', tx, h * 0.27, { size: 12, weight: 700, fill: 'rgba(15,47,82,0.8)', align: 'left', shadow: glow });
  text(ctx, 'Player One', tx, h * 0.52, { size: 21, weight: 900, fill: '#0f2f52', align: 'left', shadow: glow });
  // Level pill.
  const lx = tx;
  const ly = h * 0.72;
  roundRect(ctx, lx, ly, 62, 17, 8.5);
  ctx.fillStyle = linear(ctx, 0, ly, 0, ly + 17, [
    [0, '#9df07a'],
    [1, '#3fae2a'],
  ]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,90,20,0.6)';
  ctx.stroke();
  text(ctx, 'LEVEL 12', lx + 31, ly + 9, { size: 10, weight: 900, fill: '#ffffff', letterSpacing: 0.5, shadow: { color: 'rgba(0,60,0,0.5)', blur: 2, y: 1 } });
  icon(ctx, 'leaf', lx + 76, ly + 8.5, 12, '#3a9c2a');
  text(ctx, '2,450', lx + 86, ly + 9, { size: 12, weight: 900, fill: '#1f6b1a', align: 'left', shadow: glow });
}

function drawSearch(ctx, w, h) {
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 4);
  ctx.fillStyle = linear(ctx, 0, 0, 0, h, [
    [0, '#ffffff'],
    [1, '#eef5fb'],
  ]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,100,150,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, 'Search songs & dancers…', 10, h / 2 + 1, { size: 12.5, weight: 700, fill: 'rgba(60,85,110,0.6)', align: 'left' });
  // Magnifier.
  ctx.save();
  ctx.strokeStyle = '#3b77b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(w - 18, h / 2 - 1.5, 5, 0, Math.PI * 2);
  ctx.moveTo(w - 14.5, h / 2 + 2);
  ctx.lineTo(w - 10, h / 2 + 6.5);
  ctx.stroke();
  ctx.restore();
}

function MenuItem({ item, index, onHover, onSelect, hovered }) {
  return (
    <UIPlane
      width={ITEM_W}
      height={ITEM_H - 4}
      pad={10}
      position={[PANEL.x, PANEL.y + ITEM_Y[index], 3]}
      appear={0.35 + index * 0.07}
      hoverScale={1.015}
      pressScale={0.975}
      redrawOnHover
      deps={[item.label]}
      draw={(ctx, w, h, { hovered: hv }) => drawItem(ctx, w, h, item, hv)}
      onHoverChange={(h) => onHover(index, h)}
      onClick={() => onSelect(index)}
      selected={hovered}
    />
  );
}

function Sidebar() {
  const [hover, setHover] = useState(-1);
  const highlight = useRef();
  const hlMat = useRef();
  const anim = useRef({ y: ITEM_Y[0], a: 0, flash: 0 });

  const onHover = (i, on) => {
    if (on) {
      setHover(i);
      reactions.focus = ITEMS[i].focus;
    } else {
      setHover((h) => (h === i ? -1 : h));
      if (reactions.focus === ITEMS[i].focus) reactions.focus = null;
    }
  };
  const onSelect = (i) => {
    reactions.focus = ITEMS[i].focus;
    anim.current.flash = 1;
    triggerBurst();
  };
  useEffect(() => () => (reactions.focus = null), []);

  useFrame((_, dt) => {
    const a = anim.current;
    const target = hover >= 0 ? ITEM_Y[hover] : a.y;
    if (a.a < 0.02 && hover >= 0) a.y = target;
    a.y = damp(a.y, target, 18, dt);
    a.a = damp(a.a, hover >= 0 ? 1 : 0, 14, dt);
    a.flash = Math.max(0, a.flash - dt * 2.5);
    if (highlight.current) highlight.current.position.set(PANEL.x, PANEL.y + a.y, 2);
    if (hlMat.current) hlMat.current.uniforms.uOpacity.value = a.a * (1 + a.flash * 0.6);
  });

  const top = PANEL.h / 2;
  return (
    <group>
      <GlassPanel
        width={PANEL.w}
        height={PANEL.h}
        position={[PANEL.x, PANEL.y, 0]}
        radius={10}
        pane={[-PANEL.w / 2 + 10, -190, PANEL.w / 2 - 10, top - 84]}
        appear={0.15}
      />
      <UIPlane width={PANEL.w - 24} height={70} pad={16} position={[PANEL.x, PANEL.y + top - 42, 3]} appear={0.25} draw={drawUserTile} deps={[]} />
      <group ref={highlight}>
        <CanvasSprite width={ITEM_W} height={ITEM_H - 6} pad={4} draw={drawHighlight} deps={[]} spriteRef={hlMat} renderOrder={-1} />
      </group>
      {/* Separator under the primary action. */}
      <UIPlane
        width={ITEM_W - 30}
        height={4}
        pad={4}
        position={[PANEL.x + 8, PANEL.y + ITEM_Y[0] - ITEM_H / 2 - 2, 3]}
        appear={0.4}
        deps={[]}
        draw={(ctx, w) => {
          ctx.fillStyle = linear(ctx, 0, 0, w, 0, [
            [0, 'rgba(90,130,170,0)'],
            [0.5, 'rgba(90,130,170,0.5)'],
            [1, 'rgba(90,130,170,0)'],
          ]);
          ctx.fillRect(0, 1.5, w, 1);
        }}
      />
      {ITEMS.map((item, i) => (
        <MenuItem key={item.label} item={item} index={i} onHover={onHover} onSelect={onSelect} hovered={hover === i} />
      ))}
      <UIPlane width={236} height={28} pad={8} position={[PANEL.x - 34, PANEL.y - 223, 3]} appear={0.8} draw={drawSearch} deps={[]} />
      <UIPlane
        width={34}
        height={34}
        pad={10}
        position={[PANEL.x + 124, PANEL.y - 223, 3]}
        appear={0.85}
        hoverScale={1.12}
        onClick={() => triggerBurst()}
        deps={[]}
        draw={(ctx, w, h) => {
          orb(ctx, w / 2, h / 2, w / 2 - 1, { color: '#2fb3e8', light: '#c9f4ff', dark: '#0b5d9e' });
          icon(ctx, 'power', w / 2, h / 2 + 0.5, 16, '#ffffff');
        }}
      />
    </group>
  );
}

export function EcoMenu() {
  return (
    <Hud>
      <FrameGrab>
        <Logo position={[PANEL.x, 278, 10]} scale={0.6} palette="sky" tagline="dance the future" taglineColor="#0d5cb0" />
        <Sidebar />
        <ClockGadget position={[532, 190, 5]} />
        <WeatherGadget position={[532, 30, 5]} />
        <MediaGadget position={[532, -134, 5]} />
      </FrameGrab>
    </Hud>
  );
}
