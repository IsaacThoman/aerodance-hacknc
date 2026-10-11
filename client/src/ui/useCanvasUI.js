import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadFonts } from './draw.js';

/**
 * An in-engine 2D overlay: a canvas the size of the render buffer, laid out in design
 * units, uploaded as a texture and drawn on a full-screen quad after the world. It shares
 * the world's pixels and stretch, so UI and world always match in resolution and aspect.
 *
 * const ui = useCanvasUI({
 *   priority: 2,                          // useFrame priority (the world renders at 1)
 *   design: (cssW, cssH) => ({ w, h }),   // design units for the displayed size (default 1600x900)
 *   widgets: (ui) => [{ id, rect | circle, drag? }],  // current hit areas, in content units
 *   active: (ui) => bool,                 // input and hover go to widgets only while true
 *   onActivate: (wdg, ui) => {},          // press and release on the same widget
 *   onDrag: (wdg, point, ui) => {},       // widgets with drag: true (sliders)
 *   onKey: (event, ui) => {},
 *   update: (dt, ui) => {},               // per-frame animation; ui.ease() marks the overlay dirty
 *   draw: (g, ui) => {},                  // redraw in design units, only when dirty
 *   opacity: (ui) => 1,                   // the overlay isn't drawn below 0.005
 * });
 *
 * Content taller than the design height scrolls by drag or wheel: draw sets ui.contentHeight.
 */

// Hit areas are padded a little so a bubble's rim and edge count as part of it.
const PAD = 8;
export const inRect = (p, r) => p && p.x >= r.x - PAD && p.x <= r.x + r.w + PAD && p.y >= r.y - PAD && p.y <= r.y + r.h + PAD;
export const inCircle = (p, c) => p && Math.hypot(p.x - c.x, p.y - c.y) <= c.r + 6;
export const hit = (p, wdg) => (wdg.rect ? inRect(p, wdg.rect) : inCircle(p, wdg.circle));

// Overlays share the canvas element, so the cursor is a pointer while any of them wants one.
const cursorWants = new WeakMap();
function wantCursor(el, key, want) {
  const wants = cursorWants.get(el) ?? new Set();
  cursorWants.set(el, wants);
  if (want) wants.add(key);
  else wants.delete(key);
  el.style.cursor = wants.size ? 'pointer' : '';
}

const DEFAULT_DESIGN = () => ({ w: 1600, h: 900 });
// A press that travels this far (design units) turns into a scroll.
const SCROLL_SLOP = 14;

function createState() {
  return {
    w: 1600,
    h: 900,
    pointer: null,
    hover: {},
    press: 0,
    pressed: null,
    drag: null,
    scroll: 0,
    contentHeight: 0,
    dirty: true,
    dt: 0,
    time: 0,
    invalidate() { this.dirty = true; },
    get maxScroll() { return Math.max(0, this.contentHeight - this.h); },
    // Eases v towards `to`, marking the overlay dirty while it moves.
    ease(v, to, rate) {
      const n = v + (to - v) * Math.min(1, this.dt * rate);
      if (Math.abs(n - to) > 1e-3) { this.dirty = true; return n; }
      if (n !== v) this.dirty = true;
      return to;
    },
  };
}

export default function useCanvasUI(options) {
  const gl = useThree((state) => state.gl);
  const opts = useRef(options);
  opts.current = options;

  const overlay = useMemo(() => {
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

  const ref = useRef(null);
  ref.current ??= createState();
  const ui = ref.current;

  useEffect(() => {
    const el = gl.domElement;
    const s = ui;
    const key = {};
    const toDesign = (e) => {
      const rect = el.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) / rect.width) * s.w, y: ((e.clientY - rect.top) / rect.height) * s.h + s.scroll };
    };
    const active = () => opts.current.active?.(s) ?? true;
    const widgetAt = (p) => (active() ? opts.current.widgets?.(s).find((wdg) => hit(p, wdg)) : undefined);
    let down = null; // { y, scroll } for drag-to-scroll

    const onMove = (e) => {
      s.pointer = toDesign(e);
      if (s.drag) opts.current.onDrag?.(s.drag, s.pointer, s);
      if (down && s.maxScroll > 0) {
        const dy = s.pointer.y - s.scroll - down.y;
        if (s.pressed && Math.abs(dy) > SCROLL_SLOP) s.pressed = null;
        if (!s.pressed) {
          s.scroll = Math.min(s.maxScroll, Math.max(0, down.scroll - dy));
          s.dirty = true;
        }
      }
      wantCursor(el, key, !!(s.drag || widgetAt(s.pointer)));
    };
    const onLeave = () => { s.pointer = null; wantCursor(el, key, false); };
    // Buttons fire on release when the press started on the same button, so a
    // press anywhere on the bubble counts even if the pointer wobbles a little.
    const onDown = (e) => {
      if (e.button !== 0) return;
      const p = toDesign(e);
      s.pointer = p;
      const wdg = widgetAt(p);
      if (!wdg && !(s.maxScroll > 0 && active())) return;
      el.setPointerCapture(e.pointerId);
      down = { y: p.y - s.scroll, scroll: s.scroll };
      if (!wdg) return;
      if (wdg.drag) {
        s.drag = wdg;
        down = null;
        opts.current.onDrag?.(wdg, p, s);
      } else {
        s.pressed = wdg.id;
      }
    };
    const onUp = (e) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      down = null;
      // A lifted finger isn't hovering anything.
      if (e.pointerType === 'touch') setTimeout(() => { s.pointer = null; }, 0);
      if (s.drag) { s.drag = null; return; }
      const id = s.pressed;
      s.pressed = null;
      if (!id) return;
      const wdg = widgetAt(toDesign(e));
      if (wdg?.id === id) {
        s.press = 1;
        opts.current.onActivate?.(wdg, s);
      }
    };
    const onCancel = (e) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      down = null;
      s.drag = null;
      s.pressed = null;
    };
    const onWheel = (e) => {
      if (!(s.maxScroll > 0) || !active()) return;
      const rect = el.getBoundingClientRect();
      s.scroll = Math.min(s.maxScroll, Math.max(0, s.scroll + (e.deltaY / rect.height) * s.h));
      s.dirty = true;
    };
    const onKey = (e) => opts.current.onKey?.(e, s);

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);

    let cancelled = false;
    loadFonts().then(() => { if (!cancelled) s.dirty = true; });

    return () => {
      cancelled = true;
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      wantCursor(el, key, false);
    };
  }, [gl, ui]);

  useEffect(() => () => {
    overlay.texture.dispose();
    overlay.material.dispose();
    overlay.quad.geometry.dispose();
  }, [overlay]);

  useFrame((_, delta) => {
    const s = ui;
    const o = opts.current;
    s.dt = Math.min(delta, 0.1);
    s.time += s.dt;

    // Match the render buffer exactly so overlay pixels line up with world pixels.
    const buf = gl.getDrawingBufferSize(new THREE.Vector2());
    if (overlay.canvas.width !== buf.x || overlay.canvas.height !== buf.y) {
      overlay.canvas.width = buf.x;
      overlay.canvas.height = buf.y;
      overlay.texture.dispose();
      s.dirty = true;
    }
    const el = gl.domElement;
    const d = (o.design ?? DEFAULT_DESIGN)(el.clientWidth || 1, el.clientHeight || 1);
    if (d.w !== s.w || d.h !== s.h) {
      s.w = d.w;
      s.h = d.h;
      s.dirty = true;
    }

    const live = o.active?.(s) ?? true;
    const widgets = o.widgets?.(s) ?? [];
    const hovered = live && (s.drag?.id ?? widgets.find((wdg) => hit(s.pointer, wdg))?.id);
    for (const id of new Set([...Object.keys(s.hover), ...widgets.map((wdg) => wdg.id)])) {
      s.hover[id] = s.ease(s.hover[id] ?? 0, id === hovered ? 1 : 0, 12);
    }
    s.press = s.ease(s.press, 0, 10);
    o.update?.(s.dt, s);
    if (s.scroll > s.maxScroll) { s.scroll = s.maxScroll; s.dirty = true; }

    const alpha = o.opacity?.(s) ?? 1;
    if (alpha < 0.005) return;

    if (s.dirty) {
      s.dirty = false;
      const g = overlay.canvas.getContext('2d');
      const sx = overlay.canvas.width / s.w;
      const sy = overlay.canvas.height / s.h;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);
      // The context outlives each draw: start every redraw from the same state.
      Object.assign(g, {
        globalAlpha: 1, textAlign: 'start', textBaseline: 'alphabetic', shadowColor: 'transparent',
        shadowBlur: 0, shadowOffsetY: 0, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
      });
      if ('letterSpacing' in g) g.letterSpacing = '0px';
      g.setTransform(sx, 0, 0, sy, 0, -s.scroll * sy);
      o.draw(g, s);
      overlay.texture.needsUpdate = true;
    }

    overlay.material.opacity = alpha;
    const ac = gl.autoClear;
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(overlay.scene, overlay.camera);
    gl.autoClear = ac;
  }, options.priority ?? 2);

  return ui;
}
