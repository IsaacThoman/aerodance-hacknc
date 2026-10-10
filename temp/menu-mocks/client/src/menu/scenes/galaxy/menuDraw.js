import { font, icon, linear, radial, rgba, roundRect, text, withShadow } from '../../ui/draw.js';
import { drawGlossyWord } from '../../ui/Logo.jsx';

// Canvas2D painting for the galaxy-map menu (dark starlit glass + star motifs).

export function starPath(ctx, cx, cy, r, inner = 0.48, rot = -Math.PI / 2, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rr = i % 2 === 0 ? r : r * inner;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Puffy glossy star (gel style) in a given color. */
export function glossyStar(ctx, cx, cy, r, { color = '#ffd84a', light = '#fff6c2', deep = '#d98a00', outline = 'rgba(255,255,255,0.95)', glow = null } = {}) {
  ctx.save();
  ctx.lineJoin = 'round';
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = r * 0.9;
  }
  starPath(ctx, cx, cy, r, 0.5);
  ctx.fillStyle = radial(ctx, cx - r * 0.15, cy - r * 0.3, r * 0.05, cx, cy, r * 1.05, [
    [0, light],
    [0.5, color],
    [1, deep],
  ]);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1.5, r * 0.11);
  ctx.strokeStyle = outline;
  ctx.stroke();
  // Specular blob on the upper body.
  ctx.save();
  starPath(ctx, cx, cy, r, 0.5);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.12, cy - r * 0.42, r * 0.5, r * 0.26, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = linear(ctx, 0, cy - r * 0.7, 0, cy - r * 0.15, [
    [0, 'rgba(255,255,255,0.9)'],
    [1, 'rgba(255,255,255,0.05)'],
  ]);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

/** Small four-point twinkle. */
export function twinkle(ctx, cx, cy, r, color = '#ffffff', alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 1.2;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.2;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Star bit gem icon (faceted crystal star). */
export function starBitIcon(ctx, cx, cy, r, color = '#ff5fae', light = '#ffd3ec') {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 0.8;
  starPath(ctx, cx, cy, r, 0.55, -Math.PI / 2, 6);
  ctx.fillStyle = radial(ctx, cx - r * 0.2, cy - r * 0.3, 0, cx, cy, r, [
    [0, '#ffffff'],
    [0.35, light],
    [1, color],
  ]);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Facets.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.restore();
}

/** Dark starlit glass capsule with a colored edge glow. */
export function starGlass(ctx, { w, h, r = h / 2, color = '#8fb8ff', active = false, alpha = 1 }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // Outer glow.
  withShadow(ctx, { color: active ? rgba(color, 0.9) : 'rgba(10,0,40,0.55)', blur: active ? 22 : 14, y: active ? 0 : 5 }, () => {
    roundRect(ctx, 0, 0, w, h, r);
    ctx.fillStyle = 'rgba(20,10,60,0.6)';
    ctx.fill();
  });
  ctx.save();
  roundRect(ctx, 0, 0, w, h, r);
  ctx.clip();
  ctx.fillStyle = active
    ? linear(ctx, 0, 0, w, h, [
        [0, rgba(color, 0.95)],
        [0.55, mixHex(color, '#3a1f8a', 0.45, 0.92)],
        [1, 'rgba(40,20,110,0.9)'],
      ])
    : linear(ctx, 0, 0, 0, h, [
        [0, 'rgba(92,70,190,0.62)'],
        [0.5, 'rgba(42,26,120,0.6)'],
        [1, 'rgba(26,14,80,0.7)'],
      ]);
  ctx.fillRect(0, 0, w, h);
  // Speckle of tiny stars inside the glass.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const s = rnd() * 1.1 + 0.3;
    ctx.globalAlpha = alpha * (0.25 + rnd() * 0.5);
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = alpha;
  // Bottom aurora caustic.
  ctx.fillStyle = radial(ctx, w * 0.5, h * 1.2, 0, w * 0.5, h * 1.2, w * 0.55, [
    [0, rgba(color, active ? 0.55 : 0.32)],
    [1, rgba(color, 0)],
  ]);
  ctx.fillRect(0, 0, w, h);
  // Top gloss.
  roundRect(ctx, r * 0.35, 2, w - r * 0.7, h * 0.48, h * 0.24);
  ctx.fillStyle = linear(ctx, 0, 2, 0, h * 0.5, [
    [0, `rgba(255,255,255,${active ? 0.55 : 0.32})`],
    [1, 'rgba(255,255,255,0.02)'],
  ]);
  ctx.fill();
  ctx.restore();
  // Rims.
  roundRect(ctx, 1, 1, w - 2, h - 2, r - 1);
  ctx.strokeStyle = active ? 'rgba(255,255,255,0.95)' : 'rgba(210,200,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  roundRect(ctx, 0, 0, w, h, r);
  ctx.strokeStyle = active ? rgba(color, 0.9) : 'rgba(10,0,40,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function mixHex(a, b, t, alpha = 1) {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

export function lighten(hex, t) {
  return mixHex(hex, '#ffffff', t);
}

/** Menu entry: star badge with icon + label + caption on starlit glass. */
export function drawEntry(ctx, w, h, target, { hovered, primary }) {
  const active = hovered || primary;
  const color = target.color;
  if (primary) {
    // Primary action: golden gel capsule.
    withShadow(ctx, { color: hovered ? 'rgba(255,210,80,0.95)' : 'rgba(255,170,40,0.55)', blur: hovered ? 26 : 16, y: 2 }, () => {
      roundRect(ctx, 0, 0, w, h, h / 2);
      ctx.fillStyle = '#ffb42a';
      ctx.fill();
    });
    ctx.save();
    roundRect(ctx, 0, 0, w, h, h / 2);
    ctx.clip();
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [
      [0, '#fff3a6'],
      [0.45, '#ffc52e'],
      [1, '#e07800'],
    ]);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = radial(ctx, w / 2, h * 1.2, 0, w / 2, h * 1.2, w * 0.5, [
      [0, 'rgba(255,250,200,0.85)'],
      [1, 'rgba(255,250,200,0)'],
    ]);
    ctx.fillRect(0, 0, w, h);
    roundRect(ctx, h * 0.3, 3, w - h * 0.6, h * 0.46, h * 0.23);
    ctx.fillStyle = linear(ctx, 0, 3, 0, h * 0.5, [
      [0, 'rgba(255,255,255,0.9)'],
      [1, 'rgba(255,255,255,0.08)'],
    ]);
    ctx.fill();
    ctx.restore();
    roundRect(ctx, 1.5, 1.5, w - 3, h - 3, h / 2 - 1.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    roundRect(ctx, 0, 0, w, h, h / 2);
    ctx.strokeStyle = 'rgba(150,70,0,0.7)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else {
    starGlass(ctx, { w, h, color, active });
  }

  // Star badge.
  const br = h * (primary ? 0.42 : 0.4);
  const bx = h * 0.56;
  glossyStar(ctx, bx, h / 2 + 1, br, {
    color: primary ? '#ffffff' : color,
    light: primary ? '#ffffff' : lighten(color, 0.7),
    deep: primary ? '#ffd76a' : target.deep,
    outline: primary ? 'rgba(200,110,0,0.9)' : 'rgba(255,255,255,0.95)',
    glow: active ? (primary ? 'rgba(255,255,255,0.9)' : color) : null,
  });
  ctx.save();
  ctx.shadowColor = primary ? 'rgba(160,80,0,0.6)' : 'rgba(30,0,60,0.7)';
  ctx.shadowBlur = 3;
  icon(ctx, target.icon, bx + (target.icon === 'play' ? 1 : 0), h / 2 + 2.5, br * 0.62, primary ? '#e58a00' : '#ffffff');
  ctx.restore();

  const tx = bx + br + 14;
  const textShadow = primary ? { color: 'rgba(150,70,0,0.75)', blur: 4, y: 1.5 } : { color: 'rgba(20,0,60,0.85)', blur: 5, y: 1.5 };
  text(ctx, target.label, tx, h * 0.42, {
    size: primary ? 30 : 24,
    weight: 900,
    align: 'left',
    fill: '#ffffff',
    stroke: primary ? 'rgba(196,96,0,0.95)' : null,
    strokeWidth: 5,
    shadow: textShadow,
    maxWidth: w - tx - 30,
  });
  text(ctx, target.caption.toUpperCase(), tx + 1, h * 0.77, {
    size: primary ? 11.5 : 10.5,
    weight: 800,
    align: 'left',
    letterSpacing: 1.6,
    fill: primary ? 'rgba(130,60,0,0.9)' : active ? '#ffffff' : lighten(color, 0.35),
    maxWidth: w - tx - 30,
  });
  // Trailing chevron sparkle.
  if (active) {
    twinkle(ctx, w - h * 0.42, h / 2, h * 0.17, primary ? '#fffbe6' : '#ffffff', 0.95);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(w - h * 0.42, h / 2, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export const STARLIGHT_PALETTE = {
  top: '#ffffff',
  mid: '#fff0b3',
  bottom: '#ff9fd6',
  outline: '#2b176e',
  shadow: 'rgba(255,170,255,0.85)',
  accent: '#ffe066',
};

/** Custom wordmark: glossy word with a comet swoosh and a star at its head. */
export function drawGalaxyLogo(ctx, w, h, size) {
  const pal = STARLIGHT_PALETTE;
  const baseline = h * 0.64;
  // Comet swoosh arcing under and over the word.
  ctx.save();
  ctx.lineCap = 'round';
  const path = (dy) => {
    ctx.beginPath();
    ctx.moveTo(w * 0.02, baseline + size * 0.02 + dy);
    ctx.bezierCurveTo(w * 0.3, baseline + size * 0.42 + dy, w * 0.72, baseline - size * 0.95 + dy, w * 0.93, baseline - size * 0.82 + dy);
  };
  const grad = linear(ctx, w * 0.02, 0, w * 0.93, 0, [
    [0, 'rgba(255,140,220,0)'],
    [0.45, 'rgba(255,140,220,0.65)'],
    [1, 'rgba(255,240,170,1)'],
  ]);
  ctx.shadowColor = 'rgba(255,150,230,0.9)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = grad;
  ctx.lineWidth = 8;
  path(0);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = linear(ctx, w * 0.02, 0, w * 0.93, 0, [
    [0, 'rgba(255,255,255,0)'],
    [1, 'rgba(255,255,255,0.95)'],
  ]);
  ctx.lineWidth = 2.5;
  path(-1.5);
  ctx.stroke();
  ctx.restore();
  glossyStar(ctx, w * 0.935, baseline - size * 0.83, size * 0.24, { color: '#ffd84a', light: '#fffbe0', deep: '#f08a00', glow: 'rgba(255,220,120,0.95)' });

  drawGlossyWord(ctx, 'aerodance', w * 0.47, baseline, { size, palette: pal, family: 'logo' });

  // Tagline.
  ctx.save();
  ctx.font = font(size * 0.19, 900, 'round');
  ctx.letterSpacing = `${size * 0.07}px`;
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(120,60,255,0.9)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = linear(ctx, 0, baseline + size * 0.2, 0, baseline + size * 0.42, [
    [0, '#ffffff'],
    [1, '#ffd6f4'],
  ]);
  ctx.fillText('STARLIGHT GALAXY', w * 0.47, baseline + size * 0.4);
  ctx.restore();
  // Sparkles.
  twinkle(ctx, w * 0.12, baseline - size * 0.72, size * 0.09, '#fff6d0');
  twinkle(ctx, w * 0.8, baseline + size * 0.3, size * 0.07, '#ffd6f4');
  twinkle(ctx, w * 0.56, baseline - size * 0.98, size * 0.06, '#d6f0ff');
}
