import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { HUD_HEIGHT, HUD_WIDTH } from '../../../../packages/stages/shared/hud.jsx';
import { PLAYERS, REVEAL, backOut, clamp01, timeline } from './results.js';

/*
 * The 2D side of a win screen, drawn in the stages' HUD layer (1280x720 virtual pixels,
 * unaffected by bloom) in the title screen's Inter type, with the stage name card's glass
 * pills, tinted with the stage's accent and the winner's colour. Scores are marked TEMP SCORE.
 *
 * <WinHud layer show stage={meta} song onReplay onMenu />
 */

const W = HUD_WIDTH;
const H = HUD_HEIGHT;
const TITLE = { x: 640, y: 82, w: 900 };
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
function glassPill(ctx, x, y, w, h, { alpha = 1, rim = null } = {}) {
  const r = h / 2;
  ctx.save();
  ctx.globalAlpha *= alpha;
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

/** Glossy orb in a two-colour gradient (the name card's arrow orbs). */
function orb(ctx, cx, cy, r, light, dark) {
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.45, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#ffffff');
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
  s.addColorStop(0, 'rgba(255,255,255,0.95)');
  s.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = s;
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.42, r * 0.72, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
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

function tempTag(ctx, x, y) {
  ctx.save();
  ctx.font = `800 12px ${FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  const w = ctx.measureText('TEMP SCORE').width + 18;
  roundRect(ctx, x - w / 2, y - 10, w, 20, 10);
  ctx.fillStyle = 'rgba(255, 211, 77, 0.9)';
  ctx.fill();
  ctx.fillStyle = '#6a4200';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TEMP SCORE', x, y + 1);
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
      face = ['#fff6cc', '#ffd34d', '#f0a500'];
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

  // Score pills.
  const cardW = solo ? 470 : 430;
  const xs = solo ? [640 - cardW / 2] : [640 - cardW - 24, 640 + 24];
  results.forEach((r, i) => {
    const x = xs[i];
    const y = 540;
    const h = 90;
    const win = !solo && winner === i;
    const lose = !solo && winner !== null && !win;
    const p = PLAYERS[i];
    glassPill(ctx, x, y, cardW, h, { alpha: lose ? 1 - 0.25 * reveal : 1, rim: win && reveal > 0 ? `rgba(255, 211, 77, ${reveal})` : null });
    ctx.save();
    ctx.globalAlpha *= lose ? 1 - 0.25 * reveal : 1;
    orb(ctx, x + 48, y + h / 2, 30, p.light, p.dark);
    ctx.font = `800 26px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x + 48, y + h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.font = `800 26px ${FONT}`;
    ctx.fillStyle = '#064a7e';
    ctx.fillText(solo ? 'Final score' : r.name, x + 92, y + 34);
    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = 'rgba(10,80,120,0.75)';
    ctx.fillText(solo ? r.name : win && reveal > 0.5 ? 'Winner' : winner === null && t >= REVEAL ? 'Tied' : 'Score', x + 93, y + 62);
    inkText(ctx, String(Math.round(r.score * count)), x + cardW - 34, y + 64, 50, win && reveal > 0.5 ? ['#ffc21a', '#b36b00'] : [p.color, p.dark], { align: 'right' });
    ctx.restore();
    tempTag(ctx, x + cardW / 2 + 40, y + h + 2);
    // Winner tab above the pill.
    if (win && reveal > 0) {
      ctx.save();
      ctx.globalAlpha *= reveal;
      const tw = 150;
      roundRect(ctx, x + cardW / 2 - tw / 2, y - 30, tw, 34, 17);
      const g = ctx.createLinearGradient(0, y - 30, 0, y + 4);
      g.addColorStop(0, '#fff2b0');
      g.addColorStop(1, '#ffb800');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = `800 18px ${FONT}`;
      ctx.fillStyle = '#6a4200';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★ WINNER ★', x + cardW / 2, y - 12);
      ctx.restore();
    }
  });
  if (!solo) {
    orb(ctx, 640, 585, 26, accent[0], accent[1]);
    ctx.font = `800 20px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VS', 640, 586);
  }

  // Buttons.
  for (const [id, b] of Object.entries(BUTTONS)) {
    const k = hover === id ? 1 : 0;
    ctx.save();
    ctx.translate(0, -2 * k);
    glassPill(ctx, b.x, b.y, b.w, b.h, { rim: k ? 'rgba(255,255,255,0.9)' : null });
    orb(ctx, b.x + 26, b.y + b.h / 2, 17, accent[0], accent[1]);
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
