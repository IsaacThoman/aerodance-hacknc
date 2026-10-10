import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { remote } from '../remote/remoteLink.js';

/**
 * Title menu drawn in-engine: a 2D canvas the size of the render buffer is laid out
 * in 16:9 design units, uploaded as a texture and drawn on a full-screen quad after
 * the world (useFrame priority 2). It shares the world's pixels and gets the same
 * stretch to the 16:9 frame, so it matches the game's resolution and aspect exactly.
 *
 * Screens: main (Start + settings), start (random / select song), songs (song list),
 * settings (sound).
 *
 * Input comes from the mouse/touch on the canvas or from a paired phone remote
 * (remoteLink.js), whose cursor is drawn here in the menu's own pixels.
 *
 * <MainMenu visible onStart={(mode, song) => ...} sound={sound} onSoundChange={setSound} />
 */

// Design space (16:9); everything below is in these units.
const W = 1600;
const H = 900;

const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
const NAVY = '#0c2f52';
const TAU = Math.PI * 2;

const TITLE = { x: 124, y: 418, size: 156 };

// Main screen.
const START = { x: 128, y: 486, w: 440, h: 112 };
const SETTINGS = { x: 128, y: 618, w: 440, h: 112 };

// Submenus share a header row: back button + small caps heading.
const BACK = { x: 166, y: 500, r: 30 };
const RANDOM = { x: 128, y: 550, w: 470, h: 96 };
const SELECT = { x: 128, y: 666, w: 470, h: 96 };
// Placeholder track list until real songs exist.
const SONGS = [
  { id: 'song-1', title: 'Song Title One', artist: 'Artist Name' },
  { id: 'song-2', title: 'Song Title Two', artist: 'Artist Name' },
];
const SONG_RECTS = SONGS.map((_, i) => ({ x: 128, y: 550 + i * 116, w: 520, h: 96 }));
const PANEL = { x: 128, y: 548, w: 600, h: 284 };
const SLIDERS = [
  { key: 'master', label: 'Master' },
  { key: 'music', label: 'Music' },
  { key: 'sfx', label: 'Effects' },
];
const ROW_Y = (i) => PANEL.y + 54 + i * 60;
const TRACK = { x0: PANEL.x + 190, x1: PANEL.x + PANEL.w - 110 };

const WIDGETS = {
  main: [
    { id: 'start', rect: START },
    { id: 'settings', rect: SETTINGS },
  ],
  start: [
    { id: 'back', circle: BACK },
    { id: 'random', rect: RANDOM },
    { id: 'select', rect: SELECT },
  ],
  songs: [
    { id: 'back', circle: BACK },
    ...SONGS.map((song, i) => ({ id: song.id, song, rect: SONG_RECTS[i] })),
  ],
  settings: [
    { id: 'back', circle: BACK },
    ...SLIDERS.map((sl, i) => ({ id: sl.key, slider: true, rect: { x: TRACK.x0 - 24, y: ROW_Y(i) - 28, w: TRACK.x1 - TRACK.x0 + 48, h: 56 } })),
    { id: 'muted', rect: { x: PANEL.x + 16, y: ROW_Y(3) - 28, w: PANEL.w - 32, h: 56 } },
  ],
};
// Where back / Escape leads from each submenu.
const PARENT = { start: 'main', settings: 'main', songs: 'start' };

// Hit areas are padded a little so a bubble's rim and edge count as part of it.
const PAD = 8;
const inRect = (p, r) => p && p.x >= r.x - PAD && p.x <= r.x + r.w + PAD && p.y >= r.y - PAD && p.y <= r.y + r.h + PAD;
const inCircle = (p, c) => p && Math.hypot(p.x - c.x, p.y - c.y) <= c.r + 6;
const hit = (p, wdg) => (wdg.rect ? inRect(p, wdg.rect) : inCircle(p, wdg.circle));
const sliderValue = (x) => Math.min(1, Math.max(0, (x - TRACK.x0) / (TRACK.x1 - TRACK.x0)));

function pill(g, x, y, w, h) {
  const r = h / 2;
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x + r, y + h);
  g.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  g.closePath();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function drawTitle(g) {
  const { x, y, size } = TITLE;
  g.save();
  if ('letterSpacing' in g) g.letterSpacing = `${-size * 0.045}px`;
  g.textBaseline = 'alphabetic';
  g.font = `800 ${size}px ${FONT}`;
  const aeroW = g.measureText('aero').width;
  g.font = `200 ${size}px ${FONT}`;
  const danceW = g.measureText('dance').width;
  const s = size * 0.15;
  const dotX = x + aeroW + danceW + size * 0.04;

  const text = (fill) => {
    g.fillStyle = fill;
    g.font = `800 ${size}px ${FONT}`;
    g.fillText('aero', x, y);
    g.font = `200 ${size}px ${FONT}`;
    g.fillText('dance', x + aeroW, y);
  };

  // 1) Wide, dark halo so the title separates from bright sky and clouds.
  g.shadowColor = 'rgba(0, 28, 70, 0.55)';
  g.shadowBlur = 46;
  g.shadowOffsetY = 10;
  text('rgba(0, 40, 90, 0.35)');
  // 2) Tight, hard drop shadow for an embossed, aero-style edge.
  g.shadowColor = 'rgba(0, 34, 84, 0.75)';
  g.shadowBlur = 4;
  g.shadowOffsetY = 7;
  text('#ffffff');
  // 3) Glossy face: white with a cool tint towards the baseline.
  g.shadowColor = 'transparent';
  const face = g.createLinearGradient(0, y - size * 0.75, 0, y);
  face.addColorStop(0, '#ffffff');
  face.addColorStop(0.55, '#ffffff');
  face.addColorStop(1, '#d5f3ff');
  text(face);

  // Mint full stop.
  g.shadowColor = 'rgba(0, 34, 84, 0.75)';
  g.shadowBlur = 4;
  g.shadowOffsetY = 7;
  g.fillStyle = '#6ff3d6';
  g.fillRect(dotX, y - s, s, s);
  g.restore();
}

function drawDisc(g, cx, cy, r) {
  g.save();
  g.shadowColor = 'rgba(0, 60, 120, 0.4)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 3;
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  const disc = g.createLinearGradient(0, cy - r, 0, cy + r);
  disc.addColorStop(0, '#5cc2ec');
  disc.addColorStop(0.5, '#1f8fd0');
  disc.addColorStop(1, '#0d63a8');
  g.fillStyle = disc;
  g.fill();
  g.restore();
  g.beginPath();
  g.ellipse(cx, cy - r * 0.45, r * 0.75, r * 0.42, 0, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.fill();
}

const ICONS = {
  play(g, cx, cy, r) {
    const t = r * 0.42;
    g.beginPath();
    g.moveTo(cx - t * 0.7, cy - t);
    g.lineTo(cx + t, cy);
    g.lineTo(cx - t * 0.7, cy + t);
    g.closePath();
    g.stroke();
  },
  // Two crossing strands with solid arrowheads; the strand on top gets a
  // disc-coloured gap so the crossing still reads at 640x480.
  shuffle(g, cx, cy, r) {
    const a = r * 0.56;
    const b = r * 0.3;
    const hw = r * 0.2;
    const tip = cx + a;
    const neck = tip - hw * 1.3;
    const strand = (y0, y1) => {
      g.beginPath();
      g.moveTo(cx - a, y0);
      g.lineTo(cx - a * 0.35, y0);
      g.lineTo(cx + a * 0.25, y1);
      g.lineTo(neck, y1);
      g.stroke();
    };
    const head = (y) => {
      g.beginPath();
      g.moveTo(tip, y);
      g.lineTo(neck, y - hw);
      g.lineTo(neck, y + hw);
      g.closePath();
      g.fill();
    };
    g.save();
    g.fillStyle = '#ffffff';
    g.lineWidth = 5;
    g.lineJoin = 'miter';
    g.lineCap = 'butt';
    strand(cy - b, cy + b);
    head(cy + b);
    g.strokeStyle = '#1f8fd0';
    g.lineWidth = 12;
    strand(cy + b, cy - b);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    strand(cy + b, cy - b);
    head(cy - b);
    g.restore();
  },
  note(g, cx, cy, r) {
    const s = r * 0.5;
    g.save();
    g.fillStyle = '#ffffff';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx - s * 0.35, cy + s * 0.6);
    g.lineTo(cx - s * 0.35, cy - s * 0.75);
    g.lineTo(cx + s * 0.75, cy - s);
    g.lineTo(cx + s * 0.75, cy + s * 0.35);
    g.stroke();
    for (const [x, y] of [[cx - s * 0.62, cy + s * 0.62], [cx + s * 0.48, cy + s * 0.37]]) {
      g.beginPath();
      g.ellipse(x, y, s * 0.32, s * 0.24, -0.4, 0, TAU);
      g.fill();
    }
    g.restore();
  },
  list(g, cx, cy, r) {
    const a = r * 0.44;
    g.beginPath();
    for (const dy of [-a * 0.7, 0, a * 0.7]) {
      g.moveTo(cx - a * 0.55, cy + dy);
      g.lineTo(cx + a, cy + dy);
      g.moveTo(cx - a, cy + dy);
      g.lineTo(cx - a * 0.92, cy + dy);
    }
    g.stroke();
  },
  gear(g, cx, cy, r, angle = 0) {
    const teeth = 8;
    const outer = r * 0.5;
    const inner = r * 0.37;
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    g.lineWidth = 5;
    g.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i / (teeth * 2)) * TAU;
      const a1 = ((i + 1) / (teeth * 2)) * TAU;
      const rad = i % 2 === 0 ? outer : inner;
      g.lineTo(Math.cos(a0) * rad, Math.sin(a0) * rad);
      g.lineTo(Math.cos(a1) * rad, Math.sin(a1) * rad);
    }
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r * 0.15, 0, TAU);
    g.stroke();
    g.restore();
  },
};

function drawPill(g, rect, { label, sub, icon, hover, press, angle }) {
  const lift = hover * 3 - press * 3;
  const { x, w, h } = rect;
  const y = rect.y - lift;

  g.save();
  g.shadowColor = `rgba(0, 50, 110, ${0.4 + hover * 0.1})`;
  g.shadowBlur = 24 + hover * 10;
  g.shadowOffsetY = 8;
  pill(g, x, y, w, h);
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, '#f4feff');
  body.addColorStop(0.48, `rgb(${200 + hover * 20}, ${244 + hover * 6}, 255)`);
  body.addColorStop(0.52, '#a9ecf6');
  body.addColorStop(1, '#7fdcef');
  g.fillStyle = body;
  g.fill();
  g.restore();

  // Glossy upper sheen.
  g.save();
  pill(g, x, y, w, h);
  g.clip();
  const sheen = g.createLinearGradient(0, y, 0, y + h * 0.5);
  sheen.addColorStop(0, 'rgba(255,255,255,0.85)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.15)');
  g.fillStyle = sheen;
  pill(g, x + 10, y + 5, w - 20, h * 0.46);
  g.fill();
  g.restore();

  pill(g, x, y, w, h);
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.stroke();

  const cx = x + h / 2 + 2;
  const cy = y + h / 2;
  const r = h / 2 - 12;
  drawDisc(g, cx, cy, r);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = 6;
  g.strokeStyle = '#ffffff';
  ICONS[icon](g, cx, cy, r, angle);

  g.fillStyle = NAVY;
  g.font = `700 ${Math.round(h * (sub ? 0.34 : 0.4))}px ${FONT}`;
  g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = '-1px';
  g.fillText(label, x + h + 14, sub ? cy - h * 0.13 : cy + 2);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  if (sub) {
    g.fillStyle = 'rgba(12, 47, 82, 0.7)';
    g.font = `600 ${Math.round(h * 0.22)}px ${FONT}`;
    g.fillText(sub, x + h + 15, cy + h * 0.2);
  }
}

function drawGlassCircle(g, c, hover) {
  g.save();
  g.shadowColor = 'rgba(0, 34, 84, 0.45)';
  g.shadowBlur = 16;
  g.shadowOffsetY = 4;
  g.beginPath();
  g.arc(c.x, c.y, c.r, 0, TAU);
  g.fillStyle = `rgba(20, 90, 160, ${0.35 + hover * 0.15})`;
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(c.x, c.y, c.r, 0, TAU);
  g.lineWidth = 3;
  g.strokeStyle = `rgba(255,255,255,${0.65 + hover * 0.35})`;
  g.stroke();
  g.beginPath();
  g.ellipse(c.x, c.y - c.r * 0.45, c.r * 0.7, c.r * 0.38, 0, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fill();
}

function drawHeader(g, label, hover) {
  const { x, y, r } = BACK;
  drawGlassCircle(g, BACK, hover);
  const a = r * 0.4 + hover * 2;
  g.beginPath();
  g.moveTo(x + a, y);
  g.lineTo(x - a, y);
  g.moveTo(x - a + 11, y - 11);
  g.lineTo(x - a, y);
  g.lineTo(x - a + 11, y + 11);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = '#ffffff';
  g.stroke();

  g.save();
  g.font = `800 26px ${FONT}`;
  if ('letterSpacing' in g) g.letterSpacing = '6px';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0, 34, 84, 0.7)';
  g.shadowBlur = 6;
  g.shadowOffsetY = 3;
  g.fillStyle = '#ffffff';
  g.fillText(label, x + r + 22, y + 1);
  g.restore();
}

// The phone remote's pointer: a glossy aqua arrow with a soft glow, like a Wii cursor.
function drawRemoteCursor(g, { x, y }, press) {
  const s = 1 - press * 0.12;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.rotate(-0.42);
  g.shadowColor = 'rgba(0, 40, 90, 0.55)';
  g.shadowBlur = 12;
  g.shadowOffsetY = 4;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(22, 54);
  g.lineTo(0, 44);
  g.lineTo(-22, 54);
  g.closePath();
  const body = g.createLinearGradient(0, 0, 0, 54);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.5, '#8fe3ff');
  body.addColorStop(1, '#13a8e8');
  g.fillStyle = body;
  g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 4;
  g.lineJoin = 'round';
  g.strokeStyle = '#0c2f52';
  g.stroke();
  g.restore();
}

function drawSoundPanel(g, sound, hover) {
  const { x, y, w, h } = PANEL;
  const base = g.globalAlpha;
  g.save();
  g.shadowColor = 'rgba(0, 30, 80, 0.45)';
  g.shadowBlur = 30;
  g.shadowOffsetY = 10;
  roundRect(g, x, y, w, h, 34);
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, 'rgba(34, 120, 196, 0.82)');
  body.addColorStop(1, 'rgba(6, 52, 116, 0.88)');
  g.fillStyle = body;
  g.fill();
  g.restore();
  g.save();
  roundRect(g, x, y, w, h, 34);
  g.clip();
  const sheen = g.createLinearGradient(0, y, 0, y + 70);
  sheen.addColorStop(0, 'rgba(255,255,255,0.28)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(x, y, w, 70);
  g.restore();
  roundRect(g, x, y, w, h, 34);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.stroke();

  const label = (text, cy) => {
    g.font = `600 30px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText(text, x + 40, cy + 1);
  };

  SLIDERS.forEach((sl, i) => {
    const cy = ROW_Y(i);
    const v = sound[sl.key];
    const kx = TRACK.x0 + v * (TRACK.x1 - TRACK.x0);
    const dim = base * (sound.muted ? 0.45 : 1);
    label(sl.label, cy);

    g.globalAlpha = dim;
    pill(g, TRACK.x0 - 6, cy - 7, TRACK.x1 - TRACK.x0 + 12, 14);
    g.fillStyle = 'rgba(0, 30, 70, 0.45)';
    g.fill();
    if (v > 0.01) {
      pill(g, TRACK.x0 - 6, cy - 7, kx - TRACK.x0 + 12, 14);
      const fill = g.createLinearGradient(0, cy - 7, 0, cy + 7);
      fill.addColorStop(0, '#b8fff0');
      fill.addColorStop(1, '#4fd8e8');
      g.fillStyle = fill;
      g.fill();
    }
    g.save();
    g.shadowColor = 'rgba(0, 30, 70, 0.5)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 3;
    g.beginPath();
    g.arc(kx, cy, 17 + (hover[sl.key] ?? 0) * 3, 0, TAU);
    const knob = g.createLinearGradient(0, cy - 18, 0, cy + 18);
    knob.addColorStop(0, '#ffffff');
    knob.addColorStop(1, '#bfeff8');
    g.fillStyle = knob;
    g.fill();
    g.restore();

    g.font = `700 26px ${FONT}`;
    g.textAlign = 'right';
    g.fillStyle = '#ffffff';
    g.fillText(String(Math.round(v * 100)), x + w - 40, cy + 1);
    g.textAlign = 'left';
    g.globalAlpha = base;
  });

  // Mute toggle.
  const cy = ROW_Y(3);
  label('Mute', cy);
  const tw = 84;
  const th = 42;
  pill(g, TRACK.x0, cy - th / 2, tw, th);
  g.fillStyle = sound.muted ? '#4fd8e8' : 'rgba(0, 30, 70, 0.45)';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = `rgba(255,255,255,${0.5 + (hover.muted ?? 0) * 0.4})`;
  g.stroke();
  const kx = TRACK.x0 + (sound.muted ? tw - th / 2 : th / 2);
  g.beginPath();
  g.arc(kx, cy, th / 2 - 5, 0, TAU);
  g.fillStyle = '#ffffff';
  g.fill();
}

export default function MainMenu({ visible = true, onStart, onSettingsOpen, sound, onSoundChange }) {
  const gl = useThree((state) => state.gl);
  const ui = useMemo(() => {
    const canvas = document.createElement('canvas');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    return { canvas, texture, material, quad, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1) };
  }, []);

  const state = useRef({
    pointer: null, remote: null, hover: {}, press: 0, spin: 0, gearAngle: 0, alpha: 0,
    screen: 'main', next: 'main', swap: 1, drag: null, drawnSound: null, dirty: true,
  });
  const props = useRef({});
  props.current = { visible, onStart, onSettingsOpen, sound, onSoundChange };

  useEffect(() => {
    const el = gl.domElement;
    const s = state.current;
    const toDesign = (e) => {
      const rect = el.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
    };
    // Input goes to the visible screen as soon as it is fading in (never mid swap-out).
    const active = () => props.current.visible && s.alpha > 0.3 && s.screen === s.next;
    const widgetAt = (p) => (active() ? WIDGETS[s.screen].find((wdg) => hit(p, wdg)) : undefined);
    const go = (screen) => { if (screen !== s.next) { s.next = screen; s.dirty = true; } };
    const setSound = (patch) => {
      const { sound: cur, onSoundChange: cb } = props.current;
      cb?.({ ...cur, ...patch });
    };

    // Shared by the mouse and the phone remote; p is in design units.
    const pointerMove = (p) => {
      s.pointer = p;
      if (s.drag) setSound({ [s.drag]: sliderValue(p.x) });
    };
    // Buttons fire on release when the press started on the same button, so a
    // press anywhere on the bubble counts even if the pointer wobbles a little.
    const pointerDown = (p) => {
      s.pointer = p;
      const wdg = widgetAt(p);
      if (!wdg) return false;
      if (wdg.slider) {
        s.drag = wdg.id;
        setSound({ [wdg.id]: sliderValue(p.x) });
      } else {
        s.pressed = wdg.id;
      }
      return true;
    };
    const pointerUp = (p) => {
      if (s.drag) { s.drag = null; return; }
      const id = s.pressed;
      s.pressed = null;
      if (!id) return;
      const wdg = widgetAt(p);
      if (wdg?.id === id) activate(wdg);
    };
    const back = () => { if (active() && PARENT[s.screen]) go(PARENT[s.screen]); };

    const onMove = (e) => {
      pointerMove(toDesign(e));
      el.style.cursor = s.drag || widgetAt(s.pointer) ? 'pointer' : '';
    };
    const onLeave = () => { s.pointer = null; el.style.cursor = ''; };
    const onDown = (e) => {
      if (e.button !== 0) return;
      if (pointerDown(toDesign(e))) el.setPointerCapture(e.pointerId);
    };
    const onUp = (e) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      pointerUp(toDesign(e));
    };
    const onCancel = (e) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      s.drag = null;
      s.pressed = null;
    };
    const activate = (wdg) => {
      s.press = 1;
      if (wdg.song) { props.current.onStart?.('select', wdg.song); return; }
      switch (wdg.id) {
        case 'start': go('start'); break;
        case 'settings': s.spin += Math.PI / 2; go('settings'); props.current.onSettingsOpen?.(); break;
        case 'back': go(PARENT[s.screen]); break;
        case 'random': props.current.onStart?.('random'); break;
        case 'select': go('songs'); break;
        case 'muted': setSound({ muted: !props.current.sound?.muted }); break;
        default:
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') back(); };

    const onRemoteMove = (e) => { s.remote = e.detail; pointerMove(e.detail); s.dirty = true; };
    const onRemoteDown = (e) => { s.remote = e.detail; pointerDown(e.detail); s.dirty = true; };
    const onRemoteUp = (e) => { pointerUp(e.detail); s.dirty = true; };
    const onRemoteLeave = () => { s.remote = null; s.pointer = null; s.drag = null; s.pressed = null; s.dirty = true; };
    const remoteHandlers = { move: onRemoteMove, down: onRemoteDown, up: onRemoteUp, back, leave: onRemoteLeave };
    for (const [type, fn] of Object.entries(remoteHandlers)) remote.addEventListener(type, fn);

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);

    // Canvas text needs the web font resident before it is drawn.
    let cancelled = false;
    Promise.all(['800', '700', '600', '200'].map((wt) => document.fonts.load(`${wt} 64px ${FONT}`)))
      .catch(() => {})
      .then(() => { if (!cancelled) s.dirty = true; });

    return () => {
      cancelled = true;
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      for (const [type, fn] of Object.entries(remoteHandlers)) remote.removeEventListener(type, fn);
      el.style.cursor = '';
    };
  }, [gl]);

  // Reopening the menu always lands on the main screen.
  useEffect(() => {
    if (!visible) return;
    const s = state.current;
    s.screen = s.next = 'main';
    s.swap = 1;
    s.dirty = true;
  }, [visible]);

  useEffect(() => () => {
    ui.texture.dispose();
    ui.material.dispose();
    ui.quad.geometry.dispose();
  }, [ui]);

  useFrame((_, delta) => {
    const s = state.current;
    const { visible: shown, sound: snd } = props.current;
    const dt = Math.min(delta, 0.1);

    // Match the render buffer exactly so menu pixels line up with world pixels.
    const buf = gl.getDrawingBufferSize(new THREE.Vector2());
    if (ui.canvas.width !== buf.x || ui.canvas.height !== buf.y) {
      ui.canvas.width = buf.x;
      ui.canvas.height = buf.y;
      ui.texture.dispose();
      s.dirty = true;
    }

    const ease = (v, to, rate) => {
      const n = v + (to - v) * Math.min(1, dt * rate);
      if (Math.abs(n - to) > 1e-3) { s.dirty = true; return n; }
      if (n !== v) s.dirty = true;
      return to;
    };

    // Screen change: fade the current screen out, swap, fade the next one in.
    if (s.next !== s.screen) {
      s.swap = Math.max(0, s.swap - dt * 7);
      if (s.swap === 0) s.screen = s.next;
      s.dirty = true;
    } else if (s.swap < 1) {
      s.swap = Math.min(1, s.swap + dt * 6);
      s.dirty = true;
    }

    const live = shown && s.alpha > 0.5 && s.screen === s.next;
    const hovered = live && (s.drag ?? WIDGETS[s.screen].find((wdg) => hit(s.pointer, wdg))?.id);
    for (const id of new Set(Object.values(WIDGETS).flat().map((wdg) => wdg.id))) {
      s.hover[id] = ease(s.hover[id] ?? 0, id === hovered ? 1 : 0, 12);
    }
    s.press = ease(s.press, 0, 10);
    s.alpha = ease(s.alpha, shown ? 1 : 0, shown ? 3 : 6);
    s.gearAngle = ease(s.gearAngle, s.spin + (s.hover.settings ?? 0) * 0.35, 8);
    if (snd !== s.drawnSound) s.dirty = true;

    if (s.alpha < 0.005) return;

    if (s.dirty) {
      s.dirty = false;
      s.drawnSound = snd;
      const g = ui.canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
      g.setTransform(ui.canvas.width / W, 0, 0, ui.canvas.height / H, 0, 0);
      drawTitle(g);

      const t = s.swap;
      g.save();
      g.globalAlpha = t;
      g.translate((1 - t) * -24, 0);
      const h = s.hover;
      if (s.screen === 'main') {
        drawPill(g, START, { label: 'Start', icon: 'play', hover: h.start ?? 0, press: s.press * (h.start ?? 0) });
        drawPill(g, SETTINGS, { label: 'Settings', icon: 'gear', hover: h.settings ?? 0, press: s.press * (h.settings ?? 0), angle: s.gearAngle });
      } else if (s.screen === 'start') {
        drawHeader(g, 'START', h.back ?? 0);
        drawPill(g, RANDOM, { label: 'Random song', icon: 'shuffle', hover: h.random ?? 0, press: s.press * (h.random ?? 0) });
        drawPill(g, SELECT, { label: 'Select song', icon: 'list', hover: h.select ?? 0, press: s.press * (h.select ?? 0) });
      } else if (s.screen === 'songs') {
        drawHeader(g, 'SELECT SONG', h.back ?? 0);
        SONGS.forEach((song, i) => {
          drawPill(g, SONG_RECTS[i], { label: song.title, sub: song.artist, icon: 'note', hover: h[song.id] ?? 0, press: s.press * (h[song.id] ?? 0) });
        });
      } else {
        drawHeader(g, 'SOUND', h.back ?? 0);
        drawSoundPanel(g, snd, h);
      }
      g.restore();
      if (s.remote) drawRemoteCursor(g, s.remote, s.pressed || s.drag ? 1 : 0);
      ui.texture.needsUpdate = true;
    }

    ui.material.opacity = s.alpha;
    const ac = gl.autoClear;
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(ui.scene, ui.camera);
    gl.autoClear = ac;
  }, 2);

  return null;
}
