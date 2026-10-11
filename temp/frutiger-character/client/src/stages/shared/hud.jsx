import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/900.css';
import { useDisposable } from './hooks.js';

// HUD coordinates are virtual pixels: 1280x720, origin at the center, +y up.
// They map onto the 640x480 buffer, which is displayed at 16:9.
export const HUD_WIDTH = 1280;
export const HUD_HEIGHT = 720;

export function useHudLayer() {
  // useState (not useMemo) so Fast Refresh keeps the same layer.
  const [layer] = useState(() => {
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-HUD_WIDTH / 2, HUD_WIDTH / 2, HUD_HEIGHT / 2, -HUD_HEIGHT / 2, -10, 10);
    camera.manual = true;
    camera.updateProjectionMatrix();
    return { scene, camera };
  });
  return layer;
}

const fontsReady = Promise.all(['700 32px Nunito', '900 32px Nunito'].map((f) => document.fonts.load(f))).catch(() => {});

const PILL = { w: 560, h: 84, y: -360 + 62, scale: 2 };
const ARROW = { r: 26, inset: 46 };
const IDLE_SECONDS = 3.5;
// ?nohud hides the name card, e.g. for clean screenshots.
const HIDE_CARD = new URLSearchParams(window.location.search).has('nohud');

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawArrowOrb(ctx, cx, cy, r, dir, accent) {
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.45, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, accent[0]);
  g.addColorStop(1, accent[1]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // Gloss cap.
  const s = ctx.createLinearGradient(0, cy - r, 0, cy);
  s.addColorStop(0, 'rgba(255,255,255,0.95)');
  s.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = s;
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.42, r * 0.72, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,70,120,0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - dir * r * 0.22, cy - r * 0.38);
  ctx.lineTo(cx + dir * r * 0.32, cy + r * 0.02);
  ctx.lineTo(cx - dir * r * 0.22, cy + r * 0.42);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

function drawPill(canvas, { name, subtitle, index, count, accent }) {
  const ctx = canvas.getContext('2d');
  const s = PILL.scale;
  const w = PILL.w * s;
  const h = PILL.h * s;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(s, s);
  const W = PILL.w;
  const H = PILL.h;
  // Soft drop shadow.
  ctx.shadowColor = 'rgba(0,40,80,0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  roundRect(ctx, 6, 6, W - 12, H - 14, (H - 14) / 2);
  const body = ctx.createLinearGradient(0, 6, 0, H - 8);
  body.addColorStop(0, 'rgba(255,255,255,0.92)');
  body.addColorStop(0.5, 'rgba(214,246,255,0.82)');
  body.addColorStop(0.51, 'rgba(176,232,250,0.78)');
  body.addColorStop(1, 'rgba(222,252,255,0.88)');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(40,150,200,0.45)';
  roundRect(ctx, 7.5, 7.5, W - 15, H - 17, (H - 17) / 2);
  ctx.stroke();
  // Top sheen.
  roundRect(ctx, 22, 9, W - 44, (H - 14) * 0.42, (H - 14) * 0.2);
  const sheen = ctx.createLinearGradient(0, 9, 0, 9 + (H - 14) * 0.42);
  sheen.addColorStop(0, 'rgba(255,255,255,0.9)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.08)');
  ctx.fillStyle = sheen;
  ctx.fill();

  drawArrowOrb(ctx, ARROW.inset, (H - 8) / 2 + 2, ARROW.r, -1, accent);
  drawArrowOrb(ctx, W - ARROW.inset, (H - 8) / 2 + 2, ARROW.r, 1, accent);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '900 27px Nunito, sans-serif';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeText(name, W / 2, 41);
  const ink = ctx.createLinearGradient(0, 18, 0, 42);
  ink.addColorStop(0, '#0a6fb0');
  ink.addColorStop(1, '#064a7e');
  ctx.fillStyle = ink;
  ctx.fillText(name, W / 2, 41);
  ctx.font = '700 14px Nunito, sans-serif';
  ctx.fillStyle = 'rgba(10,80,120,0.85)';
  ctx.fillText(`${index + 1} / ${count}  ·  ${subtitle}`, W / 2, 61);
  ctx.restore();
  return { w, h };
}

/**
 * Stage name card with prev/next orbs, plus the white transition veil.
 * The card shows on switch or pointer movement and fades out when idle.
 */
export function StageHud({ layer, stages, index, onSelect, fade }) {
  const gl = useThree((s) => s.gl);
  const [ready, setReady] = useState(false);
  const shown = useRef(1);
  const lastActive = useRef(0);
  const clock = useRef(0);

  useEffect(() => {
    let alive = true;
    fontsReady.then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const card = useDisposable(() => {
    const canvas = document.createElement('canvas');
    canvas.width = PILL.w * PILL.scale;
    canvas.height = PILL.h * PILL.scale;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthTest: false, depthWrite: false });
    const geometry = new THREE.PlaneGeometry(PILL.w, PILL.h);
    return { canvas, texture, material, geometry };
  });

  const veil = useDisposable(() => ({
    geometry: new THREE.PlaneGeometry(HUD_WIDTH, HUD_HEIGHT),
    material: new THREE.MeshBasicMaterial({ color: '#f4fdff', transparent: true, toneMapped: false, depthTest: false, depthWrite: false }),
  }));

  const meta = stages[index];
  useEffect(() => {
    if (!ready) return;
    drawPill(card.canvas, { ...meta, index, count: stages.length, accent: meta.accent ?? ['#7fe3ff', '#0a8fd8'] });
    card.texture.needsUpdate = true;
    lastActive.current = clock.current;
  }, [ready, meta, index, stages.length, card]);

  // Pointer: wake the card on movement; clicking its orbs switches stages.
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    const el = gl.domElement;
    const toVirtual = (e) => {
      const r = el.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width - 0.5) * HUD_WIDTH, (0.5 - (e.clientY - r.top) / r.height) * HUD_HEIGHT];
    };
    const onMove = () => {
      lastActive.current = clock.current;
    };
    const onDown = (e) => {
      lastActive.current = clock.current;
      const [x, y] = toVirtual(e);
      const dy = y - (PILL.y + 2);
      for (const dir of [-1, 1]) {
        const cx = dir * (PILL.w / 2 - ARROW.inset);
        if (Math.hypot(x - cx, dy) < ARROW.r + 10) {
          select.current(index + dir);
          return;
        }
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
    };
  }, [gl, index]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    clock.current += dt;
    const awake = clock.current - lastActive.current < IDLE_SECONDS;
    shown.current += ((awake ? 1 : 0) - shown.current) * Math.min(1, dt * (awake ? 6 : 1.6));
    card.material.opacity = ready && !HIDE_CARD ? shown.current : 0;
    veil.material.opacity = fade.current.value;
    veil.material.visible = fade.current.value > 0.001;
  });

  return createPortal(
    <>
      <mesh geometry={card.geometry} material={card.material} position={[0, PILL.y, 0]} renderOrder={10} />
      <mesh geometry={veil.geometry} material={veil.material} renderOrder={20} />
    </>,
    layer.scene,
  );
}
