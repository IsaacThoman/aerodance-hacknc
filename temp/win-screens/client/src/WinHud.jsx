import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HUD_HEIGHT, HUD_WIDTH } from '../../../../packages/stages/shared/hud.jsx';
import { PLAYERS, REVEAL, backOut, clamp01, timeline } from './results.js';

/*
 * The 2D side of a win screen, drawn in the stages' HUD layer (1280x720 virtual pixels,
 * unaffected by bloom) in the title screen's Inter type: the title and scores free-standing
 * over the stage in the winner's and players' colours, and buttons in the stage name card's
 * glass pills, tinted with the stage's accent.
 *
 * <WinHud layer show stage={meta} song onReplay onMenu />
 */

const W = HUD_WIDTH;
const H = HUD_HEIGHT;
const TITLE = { x: 640, y: 82, w: 900 };
// Score columns: centre offset from the middle, and the y of each row.
const SCORES = { dx: 240, status: 516, name: 544, score: 620 };
const GOLD = ['#fff6cc', '#ffd34d', '#f0a500'];
const BUTTONS = {
  replay: { x: 640 - 230, y: 650, w: 220, h: 50, label: 'Play again' },
  menu: { x: 650, y: 650, w: 160, h: 50, label: 'Menu' },
};

// The title screen's font (client/src/ui/draw.js); canvas text needs it loaded before drawing.
const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
const fontsReady = Promise.all(['200', '600', '700', '800'].map((wt) => document.fonts.load(`${wt} 64px ${FONT}`))).catch(() => {});

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The name card's glass pill: white-to-aqua body, sheen and a crisp rim. */
function glassPill(ctx, x, y, w, h, { rim = null } = {}) {
  const r = h / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,40,80,0.35)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, x, y, w, h, r);
  const body = ctx.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, 'rgba(255,255,255,0.94)');
  body.addColorStop(0.5, 'rgba(214,246,255,0.86)');
  body.addColorStop(0.51, 'rgba(176,232,250,0.82)');
  body.addColorStop(1, 'rgba(222,252,255,0.9)');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
  roundRect(ctx, x + 16, y + 3, w - 32, h * 0.42, h * 0.2);
  const sheen = ctx.createLinearGradient(0, y + 3, 0, y + h * 0.45);
  sheen.addColorStop(0, 'rgba(255,255,255,0.9)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.08)');
  ctx.fillStyle = sheen;
  ctx.fill();
  if (rim) {
    ctx.shadowColor = rim;
    ctx.shadowBlur = 16;
    roundRect(ctx, x - 3, y - 3, w + 6, h + 6, r + 3);
    ctx.lineWidth = 5;
    ctx.strokeStyle = rim;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Glossy orb in a two-colour gradient (the name card's arrow orbs). Soft orbs carry an icon,
 * so they drop the white hot spot and keep only a faint sheen for the white icon to read on.
 */
function orb(ctx, cx, cy, r, light, dark, { soft = false } = {}) {
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.45, r * 0.1, cx, cy, r);
  g.addColorStop(0, soft ? light : '#ffffff');
  g.addColorStop(0.35, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  const s = ctx.createLinearGradient(0, cy - r, 0, cy);
  s.addColorStop(0, `rgba(255,255,255,${soft ? 0.4 : 0.95})`);
  s.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = s;
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.42, r * 0.72, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * White button icons for the orbs, keyed by button id, centred at (cx, cy) in an orb of
 * radius r. Kept to bold, simple strokes so they read at the 640x480 buffer.
 */
const ICONS = {
  // Anticlockwise arrow, open at the top left, like a replay control.
  replay(ctx, cx, cy, r) {
    const a = r * 0.5;
    const head = r * 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, a, -Math.PI / 2, Math.PI * 0.95);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - head * 1.1, cy - a);
    ctx.lineTo(cx + head * 0.4, cy - a - head);
    ctx.lineTo(cx + head * 0.4, cy - a + head);
    ctx.closePath();
    ctx.fill();
  },
  // Three bars.
  menu(ctx, cx, cy, r) {
    const a = r * 0.46;
    ctx.beginPath();
    for (const dy of [-a * 0.75, 0, a * 0.75]) {
      ctx.moveTo(cx - a, cy + dy);
      ctx.lineTo(cx + a, cy + dy);
    }
    ctx.stroke();
  },
};

function icon(ctx, id, cx, cy, r) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 30, 70, 0.75)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.strokeStyle = ctx.fillStyle = '#ffffff';
  ctx.lineWidth = r * 0.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ICONS[id](ctx, cx, cy, r);
  ctx.restore();
}

/** Bold Inter with a white outline and a vertical ink gradient. */
function inkText(ctx, text, x, y, size, [top, bottom], { align = 'center', maxW } = {}) {
  ctx.save();
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeText(text, x, y, maxW);
  const ink = ctx.createLinearGradient(0, y - size * 0.8, 0, y);
  ink.addColorStop(0, top);
  ink.addColorStop(1, bottom);
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y, maxW);
  ctx.restore();
}

/**
 * Headline in the "aerodance." wordmark's treatment (client/src/ui/draw.js drawTitle): Inter
 * 800 with tight tracking, a wide dark halo, a hard drop shadow and a glossy face, here tinted
 * [top, middle, bottom].
 */
function headline(ctx, text, x, y, size, face, maxW) {
  ctx.save();
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${-size * 0.015}px`;
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // 1) Wide, dark halo so it separates from bright stages.
  ctx.shadowColor = 'rgba(0, 28, 70, 0.55)';
  ctx.shadowBlur = 46;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = 'rgba(0, 40, 90, 0.35)';
  ctx.fillText(text, x, y, maxW);
  // 2) Tight, hard drop shadow for the embossed aero edge.
  ctx.shadowColor = 'rgba(0, 34, 84, 0.75)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = size * 0.09;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y, maxW);
  // 3) Glossy face.
  ctx.shadowColor = 'transparent';
  const g = ctx.createLinearGradient(0, y - size * 0.75, 0, y);
  g.addColorStop(0, face[0]);
  g.addColorStop(0.5, face[1]);
  g.addColorStop(1, face[2]);
  ctx.fillStyle = g;
  ctx.fillText(text, x, y, maxW);
  ctx.restore();
}

/**
 * Small free-standing caption: the headline's soft dark halo, so it holds on bright stages,
 * under the subtitle's tight shadow.
 */
function caption(ctx, text, x, y, size, color, { align = 'center', spacing = 0 } = {}) {
  ctx.save();
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 28, 70, 0.6)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = 'rgba(0, 40, 90, 0.35)';
  ctx.fillText(text, x, y);
  ctx.shadowColor = 'rgba(0, 30, 70, 0.8)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawHud(ctx, { show, now, stage, song, hover, toast, modeLabel }) {
  const { results, winner } = show;
  const { t, count, reveal } = timeline(show, now);
  const solo = results.length === 1;
  const accent = stage.accent ?? ['#7fe3ff', '#0a8fd8'];

  // Title: free-standing text (no pill). While the scores count up it reads
  // "And the winner is…"; the moment they finish, the result pops in.
  // White faces match the title screen's wordmark; results are tinted in the winner's colour.
  const WHITE = ['#ffffff', '#ffffff', '#d5f3ff'];
  let title;
  let face = WHITE;
  let pop = 1;
  if (solo) {
    title = 'SONG COMPLETE!';
  } else if (t < REVEAL) {
    title = 'And the winner is…';
  } else {
    pop = backOut(clamp01((t - REVEAL) / 0.32));
    if (winner === null) {
      title = "IT'S A TIE!";
      face = GOLD;
    } else {
      const p = PLAYERS[winner];
      title = `${p.name.toUpperCase()} WINS!`;
      face = ['#ffffff', p.light, p.color];
    }
  }
  ctx.save();
  ctx.translate(TITLE.x, TITLE.y);
  ctx.scale(pop, pop);
  headline(ctx, title, 0, 12, t < REVEAL && !solo ? 56 : 76, face, TITLE.w);
  ctx.font = `600 19px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 30, 70, 0.8)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${stage.name}  ·  ${song.title}`, 0, 50);
  ctx.restore();

  // Scores: free-standing over the stage like the title, one column per dancer. Each column
  // reads top to bottom: status (solo, or a tie once it's in), number orb and name, the score.
  const xs = solo ? [640] : [640 - SCORES.dx, 640 + SCORES.dx];
  results.forEach((r, i) => {
    const x = xs[i];
    const p = PLAYERS[i];
    const win = !solo && winner === i;
    const lose = !solo && winner !== null && !win;
    const tied = !solo && winner === null && t >= REVEAL;
    ctx.save();
    ctx.globalAlpha *= lose ? 1 - 0.2 * reveal : 1;
    const status = solo ? 'FINAL SCORE' : tied ? 'TIED' : null;
    if (status) {
      ctx.save();
      ctx.globalAlpha *= solo ? 1 : reveal;
      caption(ctx, status, x, SCORES.status, 17, solo ? '#ffffff' : GOLD[1], { spacing: 3 });
      ctx.restore();
    }
    ctx.font = `800 22px ${FONT}`;
    const left = x - (36 + ctx.measureText(r.name).width) / 2;
    orb(ctx, left + 13, SCORES.name, 13, p.light, p.dark);
    caption(ctx, String(i + 1), left + 13, SCORES.name + 1, 15, '#ffffff');
    caption(ctx, r.name, left + 36, SCORES.name, 22, '#ffffff', { align: 'left' });
    // The winner's score turns gold and pops a size up as the result lands.
    const grow = win ? 0.12 * backOut(clamp01((t - REVEAL) / 0.32)) : 0;
    ctx.save();
    ctx.translate(x, SCORES.score - 26);
    ctx.scale(1 + grow, 1 + grow);
    headline(ctx, String(Math.round(r.score * count)), 0, 26, 72, win && reveal > 0 ? GOLD : ['#ffffff', p.light, p.color], 400);
    ctx.restore();
    ctx.restore();
  });

  // Buttons.
  for (const [id, b] of Object.entries(BUTTONS)) {
    const k = hover === id ? 1 : 0;
    ctx.save();
    ctx.translate(0, -2 * k);
    glassPill(ctx, b.x, b.y, b.w, b.h, { rim: k ? 'rgba(255,255,255,0.9)' : null });
    orb(ctx, b.x + 26, b.y + b.h / 2, 19, accent[0], accent[1], { soft: true });
    icon(ctx, id, b.x + 26, b.y + b.h / 2, 19);
    ctx.font = `800 21px ${FONT}`;
    ctx.fillStyle = '#064a7e';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + 52, b.y + b.h / 2 + 1);
    ctx.restore();
  }
  if (now - toast < 1.6) {
    inkText(ctx, 'Menu would open here (mockup)', 640, 630, 22, ['#0a6fb0', '#064a7e']);
  }

  // Mock controls, top-left.
  ctx.save();
  ctx.font = `800 12px ${FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  const hint = `MOCKUP · ${modeLabel.toUpperCase()} · 1–6 STAGE · M RESULT · R REPLAY`;
  const hw = ctx.measureText(hint).width + 24;
  roundRect(ctx, 14, 12, hw, 24, 12);
  ctx.fillStyle = 'rgba(4, 40, 80, 0.5)';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(hint, 26, 25);
  ctx.restore();
}

export default function WinHud({ layer, show, stage, song, modeLabel, onReplay, onMenu }) {
  const gl = useThree((s) => s.gl);
  const [ready, setReady] = useState(false);
  const ui = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthTest: false, depthWrite: false });
    const geometry = new THREE.PlaneGeometry(W, H);
    return { canvas, texture, material, geometry };
  }, []);
  useEffect(() => () => { ui.texture.dispose(); ui.material.dispose(); ui.geometry.dispose(); }, [ui]);
  useEffect(() => {
    let alive = true;
    fontsReady.then(() => alive && setReady(true));
    return () => { alive = false; };
  }, []);

  const st = useRef({ hover: null, toast: -10, now: 0 }).current;
  const props = useRef({});
  props.current = { show, stage, song, modeLabel, onReplay, onMenu };

  useEffect(() => {
    const el = gl.domElement;
    const toVirtual = (e) => {
      const r = el.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };
    const hit = (p) => Object.entries(BUTTONS).find(([, b]) => p.x >= b.x - 6 && p.x <= b.x + b.w + 6 && p.y >= b.y - 6 && p.y <= b.y + b.h + 6)?.[0] ?? null;
    const onMove = (e) => { st.hover = hit(toVirtual(e)); el.style.cursor = st.hover ? 'pointer' : ''; };
    const onUp = (e) => {
      const id = hit(toVirtual(e));
      if (id === 'replay') props.current.onReplay?.();
      else if (id === 'menu') { st.toast = st.now; props.current.onMenu?.(); }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    return () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); };
  }, [gl, st]);

  useFrame((state) => {
    st.now = state.clock.elapsedTime;
    if (!ready) return;
    const ctx = ui.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    ctx.setTransform(ui.canvas.width / W, 0, 0, ui.canvas.height / H, 0, 0);
    const p = props.current;
    drawHud(ctx, { show: p.show.current, now: st.now, stage: p.stage, song: p.song, hover: st.hover, toast: st.toast, modeLabel: p.modeLabel });
    ui.texture.needsUpdate = true;
  });

  return createPortal(<mesh geometry={ui.geometry} material={ui.material} renderOrder={15} />, layer.scene);
}
