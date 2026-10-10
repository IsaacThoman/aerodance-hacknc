import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { socket } from '../../socket.js';
import { UIPlane } from './UIPlane.jsx';
import { font, linear, radial } from './draw.js';

// Clicking the logo spins it for every connected player (the original
// shared "spin" demo, now living in the menu).
export function useSharedSpin() {
  const spin = useRef({ angle: 0, velocity: 0 });
  useEffect(() => {
    const onSpin = () => {
      spin.current.velocity = Math.min(spin.current.velocity + 14, 40);
    };
    socket.on('spin', onSpin);
    return () => socket.off('spin', onSpin);
  }, []);
  useFrame((_, delta) => {
    const s = spin.current;
    s.velocity *= Math.exp(-1.6 * delta);
    s.angle += s.velocity * delta;
    // Settle facing forward once the spin runs out.
    if (s.velocity < 1.5) {
      const rest = Math.round(s.angle / (Math.PI * 2)) * Math.PI * 2;
      s.angle += (rest - s.angle) * (1 - Math.exp(-6 * delta));
    }
  });
  const trigger = () => {
    if (socket.connected) socket.emit('spin');
    else spin.current.velocity = Math.min(spin.current.velocity + 14, 40);
  };
  return [spin, trigger];
}

export const LOGO_PALETTES = {
  sky: { top: '#e6f9ff', mid: '#4cc6ff', bottom: '#0a6fd1', outline: '#ffffff', shadow: 'rgba(0,50,120,0.45)', accent: '#7ed957' },
  aqua: { top: '#e9fffd', mid: '#3fe0e0', bottom: '#0383a8', outline: '#ffffff', shadow: 'rgba(0,60,90,0.5)', accent: '#ffffff' },
  leaf: { top: '#f4ffe0', mid: '#9be35a', bottom: '#238a2a', outline: '#ffffff', shadow: 'rgba(10,70,30,0.45)', accent: '#38b6ff' },
  night: { top: '#ffffff', mid: '#b9f3ff', bottom: '#4fa8ff', outline: 'rgba(255,255,255,0.0)', shadow: 'rgba(80,200,255,0.9)', accent: '#7affc8' },
  cosmic: { top: '#ffffff', mid: '#ffe9a8', bottom: '#ff9fd8', outline: '#2a1a6e', shadow: 'rgba(255,200,255,0.8)', accent: '#ffe066' },
  sunset: { top: '#ffffff', mid: '#ffd9a0', bottom: '#ff6fb1', outline: '#ffffff', shadow: 'rgba(120,30,90,0.45)', accent: '#ffe066' },
};

/** Glossy gradient text with an outline, drop shadow and a glassy top highlight. */
export function drawGlossyWord(ctx, str, x, y, { size, family = 'logo', weight = 700, palette = LOGO_PALETTES.sky, outlineWidth = size * 0.16, letterSpacing = 0 }) {
  ctx.save();
  ctx.font = font(size, weight, family);
  ctx.letterSpacing = `${letterSpacing}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  // Outline + shadow.
  ctx.shadowColor = palette.shadow;
  ctx.shadowBlur = size * 0.18;
  ctx.shadowOffsetY = size * 0.05;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = outlineWidth;
  ctx.strokeText(str, x, y);
  ctx.restore();

  // Fill + gloss on an offscreen layer so the gloss only lands on the glyphs.
  const t = ctx.getTransform();
  const off = document.createElement('canvas');
  off.width = ctx.canvas.width;
  off.height = ctx.canvas.height;
  const o = off.getContext('2d');
  o.setTransform(t);
  o.font = font(size, weight, family);
  o.letterSpacing = `${letterSpacing}px`;
  o.textAlign = 'center';
  o.textBaseline = 'alphabetic';
  o.fillStyle = linear(o, 0, y - size * 0.78, 0, y + size * 0.05, [
    [0, palette.top],
    [0.45, palette.mid],
    [1, palette.bottom],
  ]);
  o.fillText(str, x, y);
  o.globalCompositeOperation = 'source-atop';
  const width = o.measureText(str).width;
  o.beginPath();
  o.ellipse(x, y - size * 0.66, width * 0.6, size * 0.24, 0, 0, Math.PI * 2);
  o.fillStyle = linear(o, 0, y - size * 0.9, 0, y - size * 0.42, [
    [0, 'rgba(255,255,255,0.85)'],
    [1, 'rgba(255,255,255,0.08)'],
  ]);
  o.fill();
  // Soft inner glow along the bottom.
  o.fillStyle = radial(o, x, y + size * 0.2, 0, x, y + size * 0.2, width * 0.5, [
    [0, 'rgba(255,255,255,0.35)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  o.fillRect(x - width, y - size, width * 2, size * 1.4);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(off, 0, 0);
  ctx.restore();
  return width;
}

/**
 * The aerodance wordmark. palette: one of LOGO_PALETTES or a custom object.
 * swoosh: draw an Aero light swoosh behind the word. tagline: small text below.
 */
export function Logo({
  position = [0, 0, 0],
  width = 560,
  height = 170,
  size = 104,
  palette = 'sky',
  swoosh = true,
  tagline = null,
  taglineColor = '#ffffff',
  family = 'logo',
  appear = 0.05,
  bob = [4, 1.2, 0],
  scale = 1,
}) {
  const pal = typeof palette === 'string' ? LOGO_PALETTES[palette] : palette;
  const [spin, trigger] = useSharedSpin();
  const outer = useRef();
  useFrame(() => {
    if (outer.current) outer.current.rotation.y = spin.current.angle;
  });

  return (
    <group ref={outer} position={position}>
      <UIPlane
        width={width}
        height={height}
        pad={40}
        scale={scale}
        appear={appear}
        bob={bob}
        sheen={0.5}
        hoverScale={1.03}
        onClick={trigger}
        deps={[size, JSON.stringify(pal), swoosh, tagline, taglineColor, family]}
        draw={(ctx, w, h) => {
          const baseline = tagline ? h * 0.66 : h * 0.72;
          if (swoosh) {
            ctx.save();
            ctx.globalAlpha = 0.9;
            ctx.lineCap = 'round';
            const sw = (offset, lw, color) => {
              ctx.beginPath();
              ctx.moveTo(w * 0.04, baseline - size * 0.1 + offset);
              ctx.bezierCurveTo(w * 0.3, baseline + size * 0.32 + offset, w * 0.72, baseline - size * 0.98 + offset, w * 0.98, baseline - size * 0.5 + offset);
              ctx.strokeStyle = color;
              ctx.lineWidth = lw;
              ctx.stroke();
            };
            ctx.shadowColor = pal.accent;
            ctx.shadowBlur = 16;
            sw(0, 9, pal.accent);
            ctx.shadowBlur = 0;
            sw(-1.5, 3, 'rgba(255,255,255,0.9)');
            ctx.restore();
          }
          drawGlossyWord(ctx, 'aerodance', w / 2, baseline, { size, palette: pal, family });
          if (tagline) {
            ctx.save();
            ctx.font = font(size * 0.2, 800, 'round');
            ctx.letterSpacing = `${size * 0.05}px`;
            ctx.textAlign = 'center';
            ctx.shadowColor = pal.shadow;
            ctx.shadowBlur = 6;
            ctx.fillStyle = taglineColor;
            ctx.fillText(tagline.toUpperCase(), w / 2, baseline + size * 0.36);
            ctx.restore();
          }
        }}
      />
    </group>
  );
}
