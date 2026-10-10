import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Hud } from '../../hud.jsx';
import { beat, useDisposable } from '../../shared/hooks.js';
import { damp } from '../../shared/random.js';
import { Logo } from '../../ui/Logo.jsx';
import { UIButton, UIPlane } from '../../ui/UIPlane.jsx';
import { glass, icon, linear, orb, roundRect, text, withShadow } from '../../ui/draw.js';
import { AnimPlane, drawAlbumArt } from './hudKit.jsx';
import { DanceOrb } from './DanceOrb.jsx';
import { Particles2D } from './Particles2D.jsx';
import { SONGS, show } from './palette.js';

const LOGO_PALETTE = {
  top: '#fffaf2',
  mid: '#ffc46b',
  bottom: '#ff4f9a',
  outline: '#ffffff',
  shadow: 'rgba(110,30,120,0.55)',
  accent: '#7fe3ff',
};

const PLUM = '#3a1a63';
const PLUM_SOFT = '#8a5aa8';

// ---------------------------------------------------------------------------
// Featured song carousel: a stacked deck of glass cards that advances every
// four bars (in time with the music) with a slide-out, plus prev/next.

const CARD_W = 336;
const CARD_H = 132;
const ADVANCE_BEATS = 16;

function drawCard(song, index) {
  return (ctx, w, h) => {
    // Frosted, nearly opaque pearl glass so stacked cards don't show through.
    withShadow(ctx, { color: 'rgba(90,30,110,0.3)', blur: 20, y: 7 }, () => {
      roundRect(ctx, 0, 0, w, h, 24);
      ctx.fillStyle = '#fff6fb';
      ctx.fill();
    });
    ctx.save();
    roundRect(ctx, 0, 0, w, h, 24);
    ctx.clip();
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [
      [0, '#ffffff'],
      [0.5, '#fff1f8'],
      [1, '#f6e6ff'],
    ]);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = linear(ctx, 0, 0, w, 0, [
      [0, 'rgba(255,190,225,0.0)'],
      [1, 'rgba(190,225,255,0.35)'],
    ]);
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const [o, wd, a] of [[0.5, 0.08, 0.18], [0.62, 0.03, 0.15], [0.86, 0.1, 0.12]]) {
      ctx.beginPath();
      ctx.moveTo(w * o, 0);
      ctx.lineTo(w * (o + wd), 0);
      ctx.lineTo(w * (o + wd) - h * 0.6, h);
      ctx.lineTo(w * o - h * 0.6, h);
      ctx.closePath();
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fill();
    }
    ctx.restore();
    roundRect(ctx, 1, 1, w - 2, h - 2, 23);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    roundRect(ctx, 0, 0, w, h, 24);
    ctx.strokeStyle = 'rgba(150,90,170,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const art = h - 26;
    drawAlbumArt(ctx, 13, 13, art, song);
    const tx = art + 28;
    const tw = w - tx - 14;
    text(ctx, song.title, tx, 32, { size: 22, weight: 900, align: 'left', fill: PLUM, maxWidth: tw });
    text(ctx, song.artist, tx, 57, { size: 14, weight: 800, align: 'left', fill: PLUM_SOFT, maxWidth: tw });
    // BPM chip.
    const chipY = 76;
    ctx.save();
    roundRect(ctx, tx, chipY, 92, 24, 12);
    ctx.fillStyle = linear(ctx, 0, chipY, 0, chipY + 24, [
      [0, '#8fe9ff'],
      [1, '#23a9e6'],
    ]);
    ctx.fill();
    roundRect(ctx, tx + 2, chipY + 2, 88, 10, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
    ctx.restore();
    icon(ctx, 'music', tx + 15, chipY + 12, 13, '#ffffff');
    text(ctx, `${song.bpm} BPM`, tx + 27, chipY + 13, { size: 12.5, weight: 900, align: 'left', fill: '#ffffff', shadow: { color: 'rgba(0,60,110,0.5)', blur: 2, y: 1 } });
    // Difficulty stars.
    for (let i = 0; i < 5; i++) {
      ctx.save();
      if (i < song.stars) {
        ctx.shadowColor = 'rgba(255,150,0,0.6)';
        ctx.shadowBlur = 4;
      }
      icon(ctx, 'star', tx + 107 + i * 17, chipY + 12, 14, i < song.stars ? '#ffc23d' : 'rgba(120,80,160,0.22)');
      ctx.restore();
    }
    // Track number tab.
    text(ctx, `#${index + 1}`, w - 16, h - 18, { size: 11, weight: 900, align: 'right', fill: 'rgba(138,90,168,0.55)', letterSpacing: 1 });
  };
}

function Carousel({ x, y, particles }) {
  const n = SONGS.length;
  const [index, setIndex] = useState(0);
  const pos = useRef(0);
  const target = useRef(0);
  const hovered = useRef(false);
  const lastBeat = useRef(null);
  const elapsedBeats = useRef(0);
  const progress = useRef();
  const anims = useMemo(() => SONGS.map(() => ({ x, y, z: 0, scale: 1, opacity: 0, rot: 0, dim: 0 })), [x, y]);
  const born = useRef(null);

  const go = (d) => {
    target.current += d;
    elapsedBeats.current = 0;
    setIndex(target.current);
  };

  useEffect(() => {
    show.song = ((index % n) + n) % n;
  }, [index, n]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (born.current === null) born.current = t;
    const enter = Math.min(1, Math.max(0, (t - born.current - 0.45) / 0.6));
    // Advance on the downbeat every few bars unless the player is hovering.
    if (lastBeat.current !== beat.beat) {
      if (lastBeat.current !== null && !hovered.current) elapsedBeats.current += 1;
      lastBeat.current = beat.beat;
      if (elapsedBeats.current >= ADVANCE_BEATS && beat.beat % 4 === 0) go(1);
    }
    pos.current = damp(pos.current, target.current, 6, delta);
    for (let i = 0; i < n; i++) {
      let rel = (((i - pos.current) % n) + n) % n;
      if (rel > n - 1.5) rel -= n;
      const a = anims[i];
      if (rel >= 0) {
        const k = Math.min(rel, 2.6);
        a.x = x + k * 16;
        a.y = y + k * 17;
        a.scale = 1 - k * 0.06;
        a.z = 10 - rel;
        a.dim = Math.min(k * 0.1, 0.3);
        a.rot = 0;
        a.opacity = (rel < 2 ? 1 - k * 0.12 : (1 - k * 0.12) * Math.max(0, 1 - (rel - 2) * 2)) * enter;
      } else {
        const k = Math.min(-rel, 1);
        const e = k * k * (3 - 2 * k);
        a.x = x - e * 250;
        a.y = y - e * 18;
        a.scale = 1 - e * 0.1;
        a.z = 11;
        a.dim = 0;
        a.rot = e * 0.08;
        a.opacity = (1 - e) * enter;
      }
    }
    if (progress.current) {
      const p = Math.min(1, (elapsedBeats.current + (hovered.current ? 0 : beat.phase)) / ADVANCE_BEATS);
      progress.current.scale.x = Math.max(0.001, p);
      progress.current.position.x = -CARD_W / 2 + 22 + (p * (CARD_W - 44)) / 2;
      progress.current.material.opacity = enter;
    }
  });

  const current = ((index % n) + n) % n;
  const barMat = useDisposable(() => new THREE.MeshBasicMaterial({ color: '#ff7ac0', transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));

  return (
    <group>
      <SongHeader x={x - CARD_W / 2 + 118} y={y + CARD_H / 2 + 52} />
      {SONGS.map((song, i) => (
        <AnimPlane
          key={song.title}
          width={CARD_W}
          height={CARD_H}
          pad={24}
          anim={anims[i]}
          sheen={0.15}
          hoverScale={1.03}
          deps={[song.title]}
          draw={drawCard(song, i)}
          onHoverChange={(h) => {
            hovered.current = h;
          }}
          onClick={() => {
            let rel = (((i - target.current) % n) + n) % n;
            if (rel > n / 2) rel -= n;
            if (rel === 0) {
              show.burst = 0;
              particles.current?.emit(anims[i].x - CARD_W / 2 + 70, anims[i].y, { count: 16, kind: 1, colors: song.colors, speed: 300, gravity: -60, size: 20, jitter: 80 });
            } else {
              go(rel);
            }
          }}
        />
      ))}
      {/* Auto-advance progress bar along the bottom of the card. */}
      <group position={[x, y - CARD_H / 2 + 7, 30]}>
        <mesh ref={progress} material={barMat}>
          <planeGeometry args={[CARD_W - 44, 3]} />
        </mesh>
      </group>
      <CarouselNav x={x} y={y - CARD_H / 2 - 30} current={current} onPrev={() => go(-1)} onNext={() => go(1)} onDot={(d) => go(d)} />
    </group>
  );
}

function SongHeader({ x, y }) {
  const [b, setB] = useState(0);
  useFrame(() => {
    const k = beat.beat % 4;
    if (k !== b) setB(k);
  });
  return (
    <UIPlane
      width={236}
      height={34}
      pad={16}
      position={[x, y, 5]}
      appear={0.35}
      deps={[b]}
      draw={(ctx, w, h) => {
        glass(ctx, { w, h, r: h / 2, tint: '#fff0f8', alpha: 0.55, streaks: false });
        icon(ctx, 'music', 20, h / 2, 16, '#ff5fa8');
        text(ctx, 'FEATURED SONG', 34, h / 2 + 1, { size: 13, weight: 900, align: 'left', fill: PLUM, letterSpacing: 1.5 });
        for (let i = 0; i < 4; i++) {
          const on = i === b;
          ctx.beginPath();
          ctx.arc(w - 52 + i * 12, h / 2, on ? 4.4 : 3, 0, Math.PI * 2);
          ctx.fillStyle = on ? (i === 0 ? '#ff5fa8' : '#3fc6f0') : 'rgba(138,90,168,0.3)';
          ctx.fill();
        }
      }}
    />
  );
}

function CarouselNav({ x, y, current, onPrev, onNext, onDot }) {
  const n = SONGS.length;
  const button = (name, dx, handler) => (
    <UIPlane
      key={name}
      width={34}
      height={34}
      pad={12}
      position={[x + dx, y, 6]}
      appear={0.6}
      hoverScale={1.15}
      onClick={handler}
      draw={(ctx, w, h) => {
        orb(ctx, w / 2, h / 2, w / 2 - 1, { color: '#ff6fb5', light: '#ffd0ea', dark: '#b8338a' });
        icon(ctx, name, w / 2 + (name === 'chevronLeft' ? -1 : 1), h / 2 + 1, 14, '#ffffff');
      }}
    />
  );
  return (
    <group>
      {button('chevronLeft', -92, onPrev)}
      {button('chevronRight', 92, onNext)}
      <UIPlane
        width={120}
        height={20}
        pad={10}
        position={[x, y, 6]}
        appear={0.6}
        deps={[current]}
        draw={(ctx, w, h) => {
          for (let i = 0; i < n; i++) {
            const on = i === current;
            const cx = w / 2 + (i - (n - 1) / 2) * 20;
            if (on) {
              roundRect(ctx, cx - 11, h / 2 - 5, 22, 10, 5);
              ctx.fillStyle = '#ffffff';
              ctx.shadowColor = 'rgba(255,90,170,0.8)';
              ctx.shadowBlur = 6;
              ctx.fill();
              ctx.shadowBlur = 0;
            } else {
              ctx.beginPath();
              ctx.arc(cx, h / 2, 4, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(255,255,255,0.75)';
              ctx.fill();
              ctx.strokeStyle = 'rgba(138,90,168,0.45)';
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
        }}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------

const PILLS = [
  { label: 'Party', icon: 'people', theme: { color: '#ff5fa8', light: '#ffc6e2', dark: '#c0287a', outline: 'rgba(110,20,80,0.5)' } },
  { label: 'Online', icon: 'globe', theme: { color: '#22b2ee', light: '#b8eeff', dark: '#0a6fb0', outline: 'rgba(0,60,110,0.5)' } },
  { label: 'Wardrobe', icon: 'shirt', theme: { color: '#55c63a', light: '#d6f8ae', dark: '#2a861c', outline: 'rgba(20,80,20,0.5)' } },
  { label: 'Options', icon: 'gear', theme: { color: '#9a6cf0', light: '#e2d4ff', dark: '#5a34b0', outline: 'rgba(60,20,110,0.5)' } },
];

function Pills({ x, y, particles }) {
  return (
    <group>
      {PILLS.map((p, i) => {
        const px = x + (i % 2) * 182;
        const py = y - Math.floor(i / 2) * 70;
        return (
          <UIButton
            key={p.label}
            label={p.label}
            icon={p.icon}
            width={170}
            height={56}
            fontSize={22}
            theme={p.theme}
            position={[px, py, 4]}
            appear={0.75 + i * 0.07}
            bob={[2, 1.6, i * 0.9]}
            onHoverChange={(h) => {
              if (h) particles.current?.emit(px - 52, py, { count: 6, kind: 1, colors: ['#ffffff', p.theme.light], speed: 140, gravity: -80, size: 14, jitter: 30 });
            }}
            onClick={() => {
              particles.current?.emit(px, py, { count: 22, colors: [p.theme.color, p.theme.light, '#ffffff'], speed: 380, gravity: 700, size: 12, jitter: 50 });
            }}
          />
        );
      })}
    </group>
  );
}

export function SkyStageMenu() {
  const particles = useRef();
  return (
    <Hud>
      <Logo position={[-384, 268, 0]} palette={LOGO_PALETTE} size={78} width={460} height={124} tagline="Cloud Stage · Live" bob={[3, 1.3, 0]} />
      <Carousel x={-418} y={-150} particles={particles} />
      <DanceOrb position={[440, 30, 0]} particles={particles} />
      <Pills x={351} y={-176} particles={particles} />
      <Particles2D ref={particles} />
    </Hud>
  );
}
