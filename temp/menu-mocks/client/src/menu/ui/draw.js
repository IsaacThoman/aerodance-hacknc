// Canvas 2D drawing kit for glossy Frutiger Aero UI. All units are virtual
// HUD pixels; UIPlane scales the context for texture resolution.

export const FONTS = {
  round: '"Nunito", "Segoe UI", system-ui, sans-serif',
  logo: '"Comfortaa", "Nunito", sans-serif',
  tech: '"Exo 2", "Segoe UI", system-ui, sans-serif',
};

export function font(size, weight = 800, family = 'round') {
  return `${weight} ${size}px ${FONTS[family] ?? family}`;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

export function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  return g;
}

export function radial(ctx, x0, y0, r0, x1, y1, r1, stops) {
  const g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  return g;
}

export function withShadow(ctx, { color = 'rgba(0,30,70,0.35)', blur = 14, x = 0, y = 5 } = {}, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = x;
  ctx.shadowOffsetY = y;
  fn();
  ctx.restore();
}

/** Mix two #rrggbb colors; returns rgba() string. */
export function mix(a, b, t, alpha = 1) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

export function rgba(hex, alpha = 1) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function parseHex(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/**
 * Glossy gel button body (Vista/Wii era): saturated gradient, bottom caustic
 * glow, glassy top highlight, white inner rim and soft drop shadow.
 */
export function gel(ctx, {
  x = 0,
  y = 0,
  w,
  h,
  r = h / 2,
  color = '#1e9cf0',
  light = '#a8e6ff',
  dark = '#0a5aa8',
  rim = 'rgba(255,255,255,0.95)',
  outline = 'rgba(0,45,100,0.55)',
  shadow = true,
  glossAlpha = 0.85,
} = {}) {
  if (shadow) {
    withShadow(ctx, typeof shadow === 'object' ? shadow : undefined, () => {
      roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = linear(ctx, 0, y, 0, y + h, [
    [0, light],
    [0.48, color],
    [1, dark],
  ]);
  ctx.fillRect(x, y, w, h);
  // Bottom caustic glow.
  ctx.fillStyle = radial(ctx, x + w / 2, y + h * 1.15, 0, x + w / 2, y + h * 1.15, Math.max(w, h) * 0.55, [
    [0, rgbaFrom(light, 0.85)],
    [0.6, rgbaFrom(light, 0.15)],
    [1, rgbaFrom(light, 0)],
  ]);
  ctx.fillRect(x, y, w, h);
  // Top gloss.
  const gx = x + Math.min(r * 0.35, w * 0.08);
  const gw = w - (gx - x) * 2;
  const gh = h * 0.5;
  roundRect(ctx, gx, y + h * 0.05, gw, gh, Math.min(r, gh));
  ctx.fillStyle = linear(ctx, 0, y, 0, y + gh + h * 0.05, [
    [0, `rgba(255,255,255,${glossAlpha})`],
    [1, `rgba(255,255,255,${glossAlpha * 0.12})`],
  ]);
  ctx.fill();
  ctx.restore();
  // Rims.
  roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(0, r - 1.5));
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Frosted Aero glass panel with diagonal specular streaks. */
export function glass(ctx, {
  x = 0,
  y = 0,
  w,
  h,
  r = 18,
  tint = '#dff4ff',
  alpha = 0.32,
  dark = false,
  streaks = true,
  shadow = true,
} = {}) {
  if (shadow) {
    withShadow(ctx, { color: dark ? 'rgba(0,0,20,0.45)' : 'rgba(0,40,90,0.28)', blur: 22, y: 8 }, () => {
      roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = 'rgba(255,255,255,0.01)';
      ctx.fill();
    });
  }
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = linear(ctx, 0, y, 0, y + h, dark
    ? [[0, `rgba(40,70,110,${alpha + 0.25})`], [1, `rgba(5,15,35,${alpha + 0.35})`]]
    : [[0, rgbaFrom(tint, alpha + 0.25)], [0.5, rgbaFrom(tint, alpha)], [1, rgbaFrom(tint, alpha + 0.12)]]);
  ctx.fillRect(x, y, w, h);
  if (streaks) {
    ctx.globalCompositeOperation = 'lighter';
    for (const [offset, width, a] of [[0.12, 0.06, 0.12], [0.22, 0.02, 0.1], [0.6, 0.1, 0.07], [0.74, 0.03, 0.1]]) {
      ctx.beginPath();
      const sx = x + w * offset;
      ctx.moveTo(sx, y);
      ctx.lineTo(sx + w * width, y);
      ctx.lineTo(sx + w * width - h * 0.6, y + h);
      ctx.lineTo(sx - h * 0.6, y + h);
      ctx.closePath();
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // Top sheen.
  ctx.fillStyle = linear(ctx, 0, y, 0, y + Math.min(h * 0.45, 60), [
    [0, `rgba(255,255,255,${dark ? 0.22 : 0.55})`],
    [1, 'rgba(255,255,255,0)'],
  ]);
  ctx.fillRect(x, y, w, Math.min(h * 0.45, 60));
  ctx.restore();
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1));
  ctx.strokeStyle = `rgba(255,255,255,${dark ? 0.35 : 0.85})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = dark ? 'rgba(0,0,0,0.5)' : 'rgba(20,70,130,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Glossy sphere (orb button / gem). */
export function orb(ctx, cx, cy, r, { color = '#22a6f2', light = '#b6ecff', dark = '#07508f', shadow = true, rim = 0.7 } = {}) {
  if (shadow) {
    withShadow(ctx, { color: 'rgba(0,30,70,0.35)', blur: r * 0.4, y: r * 0.12 }, () => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = radial(ctx, cx, cy + r * 0.45, r * 0.1, cx, cy, r * 1.05, [
    [0, light],
    [0.45, color],
    [1, dark],
  ]);
  ctx.fill();
  // Specular cap.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.45, r * 0.68, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = linear(ctx, 0, cy - r * 0.9, 0, cy - r * 0.05, [
    [0, 'rgba(255,255,255,0.92)'],
    [1, 'rgba(255,255,255,0.05)'],
  ]);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,255,255,${rim})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Clear soap bubble with iridescent rim. */
export function bubble(ctx, cx, cy, r, { alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = radial(ctx, cx, cy, r * 0.55, cx, cy, r, [
    [0, 'rgba(255,255,255,0.04)'],
    [0.8, 'rgba(190,240,255,0.22)'],
    [0.93, 'rgba(255,220,255,0.45)'],
    [1, 'rgba(255,255,255,0.75)'],
  ]);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.35, cy - r * 0.4, r * 0.32, r * 0.18, -0.7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + r * 0.42, cy + r * 0.45, r * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();
  ctx.restore();
}

/**
 * Text with optional gradient fill, outline and shadow.
 * fill: color string, or array of [offset, color] stops for a vertical gradient.
 */
export function text(ctx, str, x, y, {
  size = 28,
  weight = 800,
  family = 'round',
  fill = '#ffffff',
  stroke = null,
  strokeWidth = 4,
  shadow = null,
  align = 'center',
  baseline = 'middle',
  letterSpacing = 0,
  maxWidth = null,
} = {}) {
  ctx.save();
  let s = size;
  ctx.font = font(s, weight, family);
  ctx.letterSpacing = `${letterSpacing}px`;
  if (maxWidth) {
    while (s > 8 && ctx.measureText(str).width > maxWidth) {
      s -= 1;
      ctx.font = font(s, weight, family);
    }
  }
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = 'round';
  const fillStyle = Array.isArray(fill) ? linear(ctx, 0, y - s * 0.55, 0, y + s * 0.45, fill) : fill;
  if (shadow) {
    ctx.save();
    ctx.shadowColor = shadow.color ?? 'rgba(0,30,70,0.45)';
    ctx.shadowBlur = shadow.blur ?? 6;
    ctx.shadowOffsetX = shadow.x ?? 0;
    ctx.shadowOffsetY = shadow.y ?? 2;
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(str, x, y);
    } else {
      ctx.fillStyle = fillStyle;
      ctx.fillText(str, x, y);
    }
    ctx.restore();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = fillStyle;
  ctx.fillText(str, x, y);
  ctx.restore();
  return s;
}

export function measure(ctx, str, size, weight = 800, family = 'round', letterSpacing = 0) {
  ctx.save();
  ctx.font = font(size, weight, family);
  ctx.letterSpacing = `${letterSpacing}px`;
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}

/** Simple vector icons centered at (cx, cy) fitting in a box of `size`. */
export function icon(ctx, name, cx, cy, size, color = '#ffffff', { lineWidth = size * 0.11 } = {}) {
  const s = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const draw = ICONS[name];
  if (draw) draw(ctx, s);
  ctx.restore();
}

const ICONS = {
  play(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -s * 0.8);
    ctx.lineTo(s * 0.85, 0);
    ctx.lineTo(-s * 0.55, s * 0.8);
    ctx.closePath();
    ctx.lineWidth = s * 0.18;
    ctx.stroke();
    ctx.fill();
  },
  music(ctx, s) {
    ctx.beginPath();
    ctx.ellipse(-s * 0.45, s * 0.55, s * 0.32, s * 0.24, -0.4, 0, Math.PI * 2);
    ctx.ellipse(s * 0.55, s * 0.35, s * 0.32, s * 0.24, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.17, s * 0.5);
    ctx.lineTo(-s * 0.17, -s * 0.65);
    ctx.lineTo(s * 0.83, -s * 0.85);
    ctx.lineTo(s * 0.83, s * 0.3);
    ctx.lineWidth = s * 0.16;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.17, -s * 0.65);
    ctx.lineTo(s * 0.83, -s * 0.85);
    ctx.lineTo(s * 0.83, -s * 0.5);
    ctx.lineTo(-s * 0.17, -s * 0.3);
    ctx.closePath();
    ctx.fill();
  },
  globe(ctx, s) {
    ctx.lineWidth = s * 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.38, s * 0.85, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.85, 0);
    ctx.lineTo(s * 0.85, 0);
    ctx.moveTo(-s * 0.72, -s * 0.42);
    ctx.lineTo(s * 0.72, -s * 0.42);
    ctx.moveTo(-s * 0.72, s * 0.42);
    ctx.lineTo(s * 0.72, s * 0.42);
    ctx.stroke();
  },
  gear(ctx, s) {
    const teeth = 8;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? s * 0.88 : s * 0.66;
      const a0 = a - Math.PI / (teeth * 2) * 0.55;
      const a1 = a + Math.PI / (teeth * 2) * 0.55;
      ctx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
      ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    }
    ctx.closePath();
    ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
  },
  star(ctx, s) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? s * 0.95 : s * 0.42;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.lineWidth = s * 0.12;
    ctx.stroke();
    ctx.fill();
  },
  sparkle(ctx, s) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 4;
      const r = i % 2 === 0 ? s * 0.95 : s * 0.22;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  },
  trophy(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -s * 0.8);
    ctx.lineTo(s * 0.55, -s * 0.8);
    ctx.quadraticCurveTo(s * 0.55, s * 0.15, 0, s * 0.2);
    ctx.quadraticCurveTo(-s * 0.55, s * 0.15, -s * 0.55, -s * 0.8);
    ctx.fill();
    ctx.lineWidth = s * 0.13;
    ctx.beginPath();
    ctx.arc(-s * 0.6, -s * 0.42, s * 0.25, Math.PI * 0.5, Math.PI * 1.5);
    ctx.moveTo(s * 0.6, -s * 0.67);
    ctx.arc(s * 0.6, -s * 0.42, s * 0.25, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();
    ctx.fillRect(-s * 0.1, s * 0.15, s * 0.2, s * 0.4);
    roundRect(ctx, -s * 0.45, s * 0.52, s * 0.9, s * 0.3, s * 0.08);
    ctx.fill();
  },
  person(ctx, s) {
    ctx.beginPath();
    ctx.arc(0, -s * 0.45, s * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, s * 0.62, s * 0.7, s * 0.5, 0, Math.PI, 0);
    ctx.fill();
  },
  people(ctx, s) {
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(s * 0.42, -s * 0.38, s * 0.27, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s * 0.42, s * 0.5, s * 0.5, s * 0.42, 0, Math.PI, 0);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(-s * 0.22, -s * 0.3, s * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-s * 0.22, s * 0.72, s * 0.6, s * 0.55, 0, Math.PI, 0);
    ctx.fill();
  },
  dancer(ctx, s) {
    ctx.beginPath();
    ctx.arc(s * 0.08, -s * 0.72, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = s * 0.17;
    ctx.beginPath();
    ctx.moveTo(-s * 0.75, -s * 0.75);
    ctx.lineTo(-s * 0.3, -s * 0.3);
    ctx.lineTo(s * 0.25, -s * 0.4);
    ctx.lineTo(s * 0.7, -s * 0.85);
    ctx.moveTo(-s * 0.05, -s * 0.38);
    ctx.lineTo(0, s * 0.15);
    ctx.lineTo(-s * 0.45, s * 0.45);
    ctx.lineTo(-s * 0.3, s * 0.9);
    ctx.moveTo(0, s * 0.15);
    ctx.lineTo(s * 0.4, s * 0.5);
    ctx.lineTo(s * 0.8, s * 0.55);
    ctx.stroke();
  },
  shirt(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, -s * 0.8);
    ctx.quadraticCurveTo(0, -s * 0.55, s * 0.3, -s * 0.8);
    ctx.lineTo(s * 0.9, -s * 0.45);
    ctx.lineTo(s * 0.65, -s * 0.05);
    ctx.lineTo(s * 0.45, -s * 0.15);
    ctx.lineTo(s * 0.45, s * 0.85);
    ctx.lineTo(-s * 0.45, s * 0.85);
    ctx.lineTo(-s * 0.45, -s * 0.15);
    ctx.lineTo(-s * 0.65, -s * 0.05);
    ctx.lineTo(-s * 0.9, -s * 0.45);
    ctx.closePath();
    ctx.fill();
  },
  headphones(ctx, s) {
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    ctx.arc(0, s * 0.1, s * 0.72, Math.PI, 0);
    ctx.stroke();
    roundRect(ctx, -s * 0.9, s * 0.0, s * 0.38, s * 0.75, s * 0.15);
    ctx.fill();
    roundRect(ctx, s * 0.52, s * 0.0, s * 0.38, s * 0.75, s * 0.15);
    ctx.fill();
  },
  mic(ctx, s) {
    roundRect(ctx, -s * 0.3, -s * 0.9, s * 0.6, s * 1.05, s * 0.3);
    ctx.fill();
    ctx.lineWidth = s * 0.13;
    ctx.beginPath();
    ctx.arc(0, -s * 0.15, s * 0.52, 0, Math.PI);
    ctx.moveTo(0, s * 0.37);
    ctx.lineTo(0, s * 0.75);
    ctx.moveTo(-s * 0.35, s * 0.8);
    ctx.lineTo(s * 0.35, s * 0.8);
    ctx.stroke();
  },
  home(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.85);
    ctx.lineTo(s * 0.9, -s * 0.05);
    ctx.lineTo(s * 0.62, -s * 0.05);
    ctx.lineTo(s * 0.62, s * 0.8);
    ctx.lineTo(s * 0.18, s * 0.8);
    ctx.lineTo(s * 0.18, s * 0.3);
    ctx.lineTo(-s * 0.18, s * 0.3);
    ctx.lineTo(-s * 0.18, s * 0.8);
    ctx.lineTo(-s * 0.62, s * 0.8);
    ctx.lineTo(-s * 0.62, -s * 0.05);
    ctx.lineTo(-s * 0.9, -s * 0.05);
    ctx.closePath();
    ctx.fill();
  },
  heart(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.8);
    ctx.bezierCurveTo(-s * 1.1, 0, -s * 0.7, -s * 0.95, 0, -s * 0.4);
    ctx.bezierCurveTo(s * 0.7, -s * 0.95, s * 1.1, 0, 0, s * 0.8);
    ctx.fill();
  },
  bag(ctx, s) {
    roundRect(ctx, -s * 0.75, -s * 0.35, s * 1.5, s * 1.2, s * 0.15);
    ctx.fill();
    ctx.lineWidth = s * 0.13;
    ctx.beginPath();
    ctx.arc(0, -s * 0.35, s * 0.38, Math.PI, 0);
    ctx.stroke();
  },
  gamepad(ctx, s) {
    roundRect(ctx, -s * 0.95, -s * 0.45, s * 1.9, s * 0.95, s * 0.45);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(-s * 0.62, -s * 0.07, s * 0.44, s * 0.14);
    ctx.fillRect(-s * 0.47, -s * 0.22, s * 0.14, s * 0.44);
    ctx.beginPath();
    ctx.arc(s * 0.38, -s * 0.1, s * 0.09, 0, Math.PI * 2);
    ctx.arc(s * 0.58, s * 0.1, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  },
  power(ctx, s) {
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    ctx.arc(0, s * 0.08, s * 0.7, -Math.PI * 0.32, Math.PI * 1.32);
    ctx.moveTo(0, -s * 0.85);
    ctx.lineTo(0, -s * 0.05);
    ctx.stroke();
  },
  question(ctx, s) {
    ctx.font = `900 ${s * 1.9}px ${FONTS.round}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, s * 0.08);
  },
  chevronLeft(ctx, s) {
    ctx.lineWidth = s * 0.28;
    ctx.beginPath();
    ctx.moveTo(s * 0.3, -s * 0.65);
    ctx.lineTo(-s * 0.35, 0);
    ctx.lineTo(s * 0.3, s * 0.65);
    ctx.stroke();
  },
  chevronRight(ctx, s) {
    ctx.lineWidth = s * 0.28;
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, -s * 0.65);
    ctx.lineTo(s * 0.35, 0);
    ctx.lineTo(-s * 0.3, s * 0.65);
    ctx.stroke();
  },
  leaf(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.8, s * 0.8);
    ctx.bezierCurveTo(-s * 0.9, -s * 0.4, s * 0.1, -s * 0.95, s * 0.85, -s * 0.85);
    ctx.bezierCurveTo(s * 0.95, -s * 0.1, s * 0.4, s * 0.9, -s * 0.8, s * 0.8);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(-s * 0.7, s * 0.7);
    ctx.quadraticCurveTo(0, 0, s * 0.7, -s * 0.7);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  },
  wave(ctx, s) {
    ctx.lineWidth = s * 0.15;
    for (const dy of [-0.4, 0.05, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.9, s * dy);
      ctx.bezierCurveTo(-s * 0.45, s * (dy - 0.35), -s * 0.15, s * (dy + 0.35), s * 0.2, s * dy);
      ctx.bezierCurveTo(s * 0.45, s * (dy - 0.3), s * 0.7, s * (dy + 0.2), s * 0.9, s * dy);
      ctx.stroke();
    }
  },
};

export const ICON_NAMES = Object.keys(ICONS);

function rgbaFrom(color, alpha) {
  if (color.startsWith('#')) return rgba(color, alpha);
  return color;
}
