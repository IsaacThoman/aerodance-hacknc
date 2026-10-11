// Frutiger Aero drawing kit for the in-engine 2D overlays. Everything takes design units;
// useCanvasUI scales them to the render buffer.

export const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
export const NAVY = '#0c2f52';
export const TAU = Math.PI * 2;

// Canvas text needs the web font resident before it is drawn.
export const loadFonts = () =>
  Promise.all(['800', '700', '600', '200'].map((wt) => document.fonts.load(`${wt} 64px ${FONT}`))).catch(() => {});

export function pill(g, x, y, w, h) {
  const r = h / 2;
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x + r, y + h);
  g.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  g.closePath();
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

// "aerodance." wordmark with its baseline at y.
export function drawTitle(g, { x, y, size }) {
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

export function titleWidth(g, size) {
  g.save();
  if ('letterSpacing' in g) g.letterSpacing = `${-size * 0.045}px`;
  g.font = `800 ${size}px ${FONT}`;
  const aeroW = g.measureText('aero').width;
  g.font = `200 ${size}px ${FONT}`;
  const danceW = g.measureText('dance').width;
  g.restore();
  return aeroW + danceW + size * 0.19;
}

export function drawDisc(g, cx, cy, r) {
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

// White head-and-shoulders figures for the player icons: [x offset, scale] in units of r.
function figures(g, cx, cy, r, list) {
  g.save();
  g.fillStyle = '#ffffff';
  for (const [dx, k] of list) {
    const s = r * 0.5 * k;
    const hx = cx + dx * r;
    g.beginPath();
    g.arc(hx, cy - s * 0.38, s * 0.36, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(hx, cy + s * 0.72, s * 0.6, s * 0.56, 0, Math.PI, TAU);
    g.closePath();
    g.fill();
  }
  g.restore();
}

// Icons drawn in white on a blue disc of radius r.
export const ICONS = {
  fullscreen(g, cx, cy, r, collapse = false) {
    const a = r * 0.48;
    const b = r * 0.18;
    const corner = collapse ? b : a;
    const end = collapse ? a : b;
    g.beginPath();
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        g.moveTo(cx + sx * end, cy + sy * corner);
        g.lineTo(cx + sx * corner, cy + sy * corner);
        g.lineTo(cx + sx * corner, cy + sy * end);
      }
    }
    g.stroke();
  },
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
  // Two figures side by side (battles).
  duo(g, cx, cy, r) {
    const s = r * 0.5;
    g.save();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#1f8fd0';
    g.lineWidth = 5;
    for (const [dx, k] of [[s * 0.42, 0.82], [-s * 0.38, 1]]) {
      const hx = cx + dx;
      g.beginPath();
      g.arc(hx, cy - s * 0.42 * k, s * 0.34 * k, 0, TAU);
      g.stroke();
      g.fill();
      g.beginPath();
      g.ellipse(hx, cy + s * 0.62, s * 0.56 * k, s * 0.5 * k, 0, Math.PI, TAU);
      g.closePath();
      g.stroke();
      g.fill();
    }
    g.restore();
  },
  // One figure (one player).
  solo(g, cx, cy, r) { figures(g, cx, cy, r, [[0, 1.15]]); },
  // Two figures shoulder to shoulder (two players, co-op; Battle's duo stands staggered).
  pair(g, cx, cy, r) { figures(g, cx, cy, r, [[-0.3, 0.8], [0.3, 0.8]]); },
  // Circular arrow (run it back).
  replay(g, cx, cy, r) {
    const a = r * 0.42;
    g.beginPath();
    g.arc(cx, cy, a, -Math.PI * 0.35, Math.PI * 1.45);
    g.stroke();
    const tx = cx + Math.cos(-Math.PI * 0.35) * a;
    const ty = cy + Math.sin(-Math.PI * 0.35) * a;
    g.save();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(tx + a * 0.62, ty - a * 0.12);
    g.lineTo(tx - a * 0.2, ty - a * 0.62);
    g.lineTo(tx - a * 0.04, ty + a * 0.46);
    g.closePath();
    g.fill();
    g.restore();
  },
  home(g, cx, cy, r) {
    const a = r * 0.42;
    g.beginPath();
    g.moveTo(cx - a, cy - a * 0.05);
    g.lineTo(cx, cy - a * 0.9);
    g.lineTo(cx + a, cy - a * 0.05);
    g.moveTo(cx - a * 0.7, cy - a * 0.3);
    g.lineTo(cx - a * 0.7, cy + a * 0.8);
    g.lineTo(cx + a * 0.7, cy + a * 0.8);
    g.lineTo(cx + a * 0.7, cy - a * 0.3);
    g.stroke();
  },
  bubble(g, cx, cy, r) {
    g.beginPath();
    g.arc(cx + r * 0.08, cy + r * 0.06, r * 0.36, 0, TAU);
    g.stroke();
    g.beginPath();
    g.arc(cx - r * 0.3, cy - r * 0.32, r * 0.14, 0, TAU);
    g.stroke();
    g.beginPath();
    g.arc(cx - r * 0.03, cy - r * 0.06, r * 0.1, Math.PI * 1.05, Math.PI * 1.55);
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
  close(g, cx, cy, r) {
    const a = r * 0.36;
    g.beginPath();
    g.moveTo(cx - a, cy - a);
    g.lineTo(cx + a, cy + a);
    g.moveTo(cx + a, cy - a);
    g.lineTo(cx - a, cy + a);
    g.stroke();
  },
  pause(g, cx, cy, r) {
    const a = r * 0.4;
    g.beginPath();
    g.moveTo(cx - a * 0.45, cy - a);
    g.lineTo(cx - a * 0.45, cy + a);
    g.moveTo(cx + a * 0.45, cy - a);
    g.lineTo(cx + a * 0.45, cy + a);
    g.stroke();
  },
  // Chevrons: up / down page a list, left / right step through choices.
  up(g, cx, cy, r) { chevron(g, cx, cy, r, -Math.PI / 2); },
  down(g, cx, cy, r) { chevron(g, cx, cy, r, Math.PI / 2); },
  left(g, cx, cy, r) { chevron(g, cx, cy, r, Math.PI); },
  right(g, cx, cy, r) { chevron(g, cx, cy, r, 0); },
  // Delete-left key: a tag pointing left with an x in it.
  backspace(g, cx, cy, r) {
    const a = r * 0.5;
    const b = r * 0.32;
    g.beginPath();
    g.moveTo(cx - a, cy);
    g.lineTo(cx - a * 0.4, cy - b);
    g.lineTo(cx + a, cy - b);
    g.lineTo(cx + a, cy + b);
    g.lineTo(cx - a * 0.4, cy + b);
    g.closePath();
    const x = cx + a * 0.3;
    const k = b * 0.45;
    g.moveTo(x - k, cy - k);
    g.lineTo(x + k, cy + k);
    g.moveTo(x + k, cy - k);
    g.lineTo(x - k, cy + k);
    g.stroke();
  },
  // A phone-shaped camera: the Android client.
  camera(g, cx, cy, r) {
    const w = r * 0.5;
    const h = r * 0.82;
    g.beginPath();
    g.roundRect(cx - w / 2, cy - h / 2, w, h, r * 0.1);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy - h * 0.22, r * 0.09, 0, TAU);
    g.stroke();
  },
  // Box with an arrow leaving it: opens somewhere else.
  link(g, cx, cy, r) {
    const a = r * 0.4;
    g.beginPath();
    g.moveTo(cx - a * 0.1, cy - a);
    g.lineTo(cx - a, cy - a);
    g.lineTo(cx - a, cy + a);
    g.lineTo(cx + a, cy + a);
    g.lineTo(cx + a, cy + a * 0.1);
    g.moveTo(cx - a * 0.05, cy + a * 0.05);
    g.lineTo(cx + a, cy - a);
    g.moveTo(cx + a * 0.25, cy - a);
    g.lineTo(cx + a, cy - a);
    g.lineTo(cx + a, cy - a * 0.25);
    g.stroke();
  },
};

function chevron(g, cx, cy, r, angle) {
  const a = r * 0.3;
  g.save();
  g.translate(cx, cy);
  g.rotate(angle);
  g.beginPath();
  g.moveTo(-a * 0.6, -a);
  g.lineTo(a * 0.6, 0);
  g.lineTo(-a * 0.6, a);
  g.stroke();
  g.restore();
}

// Glossy aqua bubble button with an icon disc on the left. Disabled buttons fade and stay put.
export function drawPill(g, rect, { label, sub, icon, hover = 0, press = 0, angle, disabled = false }) {
  if (disabled) {
    hover = 0;
    press = 0;
  }
  const lift = hover * 3 - press * 3;
  const { x, w, h } = rect;
  const y = rect.y - lift;

  g.save();
  if (disabled) g.globalAlpha *= 0.5;
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
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = '-1px';
  g.fillText(label, x + h + 14, sub ? cy - h * 0.13 : cy + 2);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  if (sub) {
    g.fillStyle = 'rgba(12, 47, 82, 0.7)';
    g.font = `600 ${Math.round(h * 0.22)}px ${FONT}`;
    g.fillText(sub, x + h + 15, cy + h * 0.2);
  }
  g.restore();
}

export function drawGlassCircle(g, c, hover) {
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

// Submenu header: glass back button (circle `back`) and a small-caps heading beside it.
export function drawHeader(g, back, label, hover) {
  const { x, y, r } = back;
  drawGlassCircle(g, back, hover);
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

  drawCaps(g, label, x + r + 22, y + 1);
}

// White small-caps label with a navy drop shadow (headers, panel titles).
export function drawCaps(g, label, x, y, { size = 26, align = 'left' } = {}) {
  g.save();
  g.font = `800 ${size}px ${FONT}`;
  if ('letterSpacing' in g) g.letterSpacing = `${Math.round(size * 0.23)}px`;
  g.textBaseline = 'middle';
  g.textAlign = align;
  g.shadowColor = 'rgba(0, 34, 84, 0.7)';
  g.shadowBlur = 6;
  g.shadowOffsetY = 3;
  g.fillStyle = '#ffffff';
  g.fillText(label, x, y);
  g.restore();
}

// Deep-blue glass panel (the settings panel look) for cards and sheets.
export function drawGlassPanel(g, { x, y, w, h }, radius = 34) {
  g.save();
  g.shadowColor = 'rgba(0, 30, 80, 0.45)';
  g.shadowBlur = 30;
  g.shadowOffsetY = 10;
  roundRect(g, x, y, w, h, radius);
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, 'rgba(34, 120, 196, 0.82)');
  body.addColorStop(1, 'rgba(6, 52, 116, 0.88)');
  g.fillStyle = body;
  g.fill();
  g.restore();
  g.save();
  roundRect(g, x, y, w, h, radius);
  g.clip();
  const sheen = g.createLinearGradient(0, y, 0, y + 70);
  sheen.addColorStop(0, 'rgba(255,255,255,0.28)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(x, y, w, 70);
  g.restore();
  roundRect(g, x, y, w, h, radius);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.stroke();
}

// White text with the navy drop shadow used over the bright world.
export function drawShadowText(g, text, x, y, { size = 30, weight = 700, align = 'left', color = '#ffffff', alpha = 1 } = {}) {
  g.save();
  g.globalAlpha *= alpha;
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0, 34, 84, 0.75)';
  g.shadowBlur = size * 0.2;
  g.shadowOffsetY = Math.max(2, size * 0.08);
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.restore();
}

// Shortens text with an ellipsis to fit maxW in the current font.
export function ellipsize(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

// Soap bubble: clear body, bright rim and a specular highlight.
export function drawBubble(g, x, y, r, alpha = 1) {
  g.save();
  g.globalAlpha *= alpha;
  const body = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
  body.addColorStop(0, 'rgba(255,255,255,0.6)');
  body.addColorStop(0.45, 'rgba(170,235,255,0.14)');
  body.addColorStop(0.82, 'rgba(110,210,255,0.28)');
  body.addColorStop(1, 'rgba(255,255,255,0.85)');
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = body;
  g.fill();
  g.lineWidth = Math.max(2, r * 0.07);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.stroke();
  g.beginPath();
  g.ellipse(x - r * 0.36, y - r * 0.42, r * 0.28, r * 0.15, -0.6, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fill();
  g.restore();
}

/**
 * QR code from qrcode's module grid, snapped to whole render-buffer pixels so it stays
 * crisp after the pixelated stretch. Fills as much of `box` (design units) as fits, on
 * white with a two-module quiet zone. view = { w, h } is the design size.
 */
export function drawQR(g, modules, box, view, { dark = '#0b3d6b' } = {}) {
  const { canvas } = g;
  const sx = canvas.width / view.w;
  const sy = canvas.height / view.h;
  // Width of a buffer pixel over its height once displayed (design units are square on screen).
  const pixelAspect = sy / sx;
  const n = modules.size + 4;
  let mx = Math.max(1, Math.floor((box.w * sx) / n));
  let my = Math.max(1, Math.floor((box.h * sy) / n));
  // Keep modules roughly square on screen.
  while (mx > 1 && mx * pixelAspect > my * 1.15) mx--;
  while (my > 1 && my > mx * pixelAspect * 1.15) my--;
  const t = g.getTransform();
  const ox = Math.round(t.e + box.x * sx + (box.w * sx - n * mx) / 2);
  const oy = Math.round(t.f + box.y * sy + (box.h * sy - n * my) / 2);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#ffffff';
  g.fillRect(ox, oy, n * mx, n * my);
  g.fillStyle = dark;
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) g.fillRect(ox + (col + 2) * mx, oy + (row + 2) * my, mx, my);
    }
  }
  g.restore();
}

// Splits text into lines no wider than maxW in the current font.
export function wrapText(g, text, maxW) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Plain text, vertically centred on y.
export function text(g, str, x, y, { size = 28, weight = 600, color = '#ffffff', align = 'left' } = {}) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(str, x, y);
}

// Wrapped text from y down; returns the height it took.
export function paragraph(g, str, x, y, maxW, { size = 26, weight = 600, color = 'rgba(255,255,255,0.88)', align = 'left', lineH = size * 1.35 } = {}) {
  g.font = `${weight} ${size}px ${FONT}`;
  const lines = wrapText(g, str, maxW);
  lines.forEach((line, i) => text(g, line, x, y + i * lineH, { size, weight, color, align }));
  return lines.length * lineH;
}

// White text field with its value (or placeholder) and a blinking caret while focused.
export function drawField(g, rect, { value, placeholder, focused, blink, disabled = false }) {
  g.save();
  if (disabled) g.globalAlpha *= 0.6;
  roundRect(g, rect.x, rect.y, rect.w, rect.h, 22);
  g.fillStyle = 'rgba(255,255,255,0.94)';
  g.fill();
  g.lineWidth = focused ? 5 : 3;
  g.strokeStyle = focused ? '#4fd8e8' : 'rgba(255,255,255,0.9)';
  g.stroke();
  roundRect(g, rect.x + 4, rect.y, rect.w - 8, rect.h, 20);
  g.clip();
  g.font = `600 32px ${FONT}`;
  const tw = g.measureText(value).width;
  // Keep the end of long input in view.
  const tx = rect.x + 26 - Math.max(0, tw - (rect.w - 60));
  text(g, value || placeholder, tx, rect.y + rect.h / 2 + 1, { size: 32, color: value ? NAVY : 'rgba(12,47,82,0.42)' });
  if (focused && blink) {
    g.fillStyle = NAVY;
    g.fillRect(tx + (value ? tw : 0) + 2, rect.y + rect.h / 2 - 20, 3, 40);
  }
  g.restore();
}

// Small outlined status chip; returns its width.
export function drawChip(g, x, y, label, color) {
  g.font = `700 22px ${FONT}`;
  const w = g.measureText(label).width + 40;
  roundRect(g, x, y, w, 44, 22);
  g.fillStyle = 'rgba(0, 30, 70, 0.4)';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = color;
  g.stroke();
  text(g, label, x + 20, y + 23, { size: 22, weight: 700, color });
  return w;
}

// Underlined text link; returns its (padded) hit rect.
export function drawLink(g, label, x, y, hover, { align = 'left', size = 26 } = {}) {
  text(g, label, x, y, { size, weight: 700, color: hover ? '#ffffff' : '#bff4ff', align });
  g.font = `700 ${size}px ${FONT}`;
  const w = g.measureText(label).width;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  g.fillStyle = hover ? '#ffffff' : 'rgba(191,244,255,0.7)';
  g.fillRect(x0, y + size * 0.62, w, 2);
  return { x: x0 - 12, y: y - size, w: w + 24, h: size * 2 };
}

// Connection status colours (the Android client): green when live, amber while connecting.
export const STATUS_COLORS = {
  connected: '#3ad68a',
  connecting: '#ffc44d',
  initializing: '#ffc44d',
  reconnecting: '#ffc44d',
  error: '#ff6b70',
  dummy: '#8fa3ff',
  disconnected: '#9db4bf',
};

// Glossy status light.
export function drawStatusDot(g, x, y, status, r = 10) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.disconnected;
  g.save();
  g.shadowColor = color;
  g.shadowBlur = status === 'disconnected' ? 0 : r;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = color;
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.stroke();
  g.beginPath();
  g.ellipse(x, y - r * 0.4, r * 0.55, r * 0.3, 0, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fill();
}

// Glossy track filling to t (0..1), with a knob while hovered or dragged (scrubbing).
export function drawProgress(g, rect, t, { hover = 0, knob = false } = {}) {
  const k = Math.min(1, Math.max(0, t));
  const { x, y, w, h } = rect;
  roundRect(g, x, y, w, h, h / 2);
  g.fillStyle = 'rgba(0, 30, 70, 0.4)';
  g.fill();
  if (k > 0) {
    roundRect(g, x, y, Math.max(h, w * k), h, h / 2);
    const fill = g.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, '#b9fff0');
    fill.addColorStop(1, '#2fc7d8');
    g.fillStyle = fill;
    g.fill();
  }
  roundRect(g, x, y, w, h, h / 2);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.stroke();
  if (!knob) return;
  const kx = x + w * k;
  const cy = y + h / 2;
  g.save();
  g.shadowColor = 'rgba(0, 30, 70, 0.5)';
  g.shadowBlur = 8;
  g.shadowOffsetY = 3;
  g.beginPath();
  g.arc(kx, cy, h * 0.75 + hover * 3, 0, TAU);
  const body = g.createLinearGradient(0, cy - h, 0, cy + h);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(1, '#bfeff8');
  g.fillStyle = body;
  g.fill();
  g.restore();
}

// ---------- Frutiger Aero celebration ----------

// Soft rotating light rays with a glowing aqua core, like a 2007 desktop wallpaper.
export function drawSunburst(g, x, y, r, { angle = 0, alpha = 1, rays = 14 } = {}) {
  if (r <= 0 || alpha <= 0) return;
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  g.rotate(angle);
  const fade = g.createRadialGradient(0, 0, r * 0.08, 0, 0, r);
  fade.addColorStop(0, 'rgba(255,255,255,0.75)');
  fade.addColorStop(0.45, 'rgba(200,245,255,0.32)');
  fade.addColorStop(1, 'rgba(160,235,255,0)');
  g.fillStyle = fade;
  const half = (Math.PI / rays) * 0.5;
  g.beginPath();
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * TAU;
    g.moveTo(0, 0);
    g.arc(0, 0, r, a - half, a + half);
    g.closePath();
  }
  g.fill();
  const core = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.42);
  core.addColorStop(0, 'rgba(255,255,255,0.9)');
  core.addColorStop(0.35, 'rgba(150,240,230,0.45)');
  core.addColorStop(1, 'rgba(90,200,255,0)');
  g.fillStyle = core;
  g.beginPath();
  g.arc(0, 0, r * 0.42, 0, TAU);
  g.fill();
  g.restore();
}

// Four-point glint.
export function drawSparkle(g, x, y, size, alpha = 1) {
  if (size <= 0 || alpha <= 0) return;
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  g.beginPath();
  const w = size * 0.16;
  g.moveTo(0, -size);
  g.quadraticCurveTo(w, -w, size, 0);
  g.quadraticCurveTo(w, w, 0, size);
  g.quadraticCurveTo(-w, w, -size, 0);
  g.quadraticCurveTo(-w, -w, 0, -size);
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(160,240,255,0.9)';
  g.shadowBlur = size * 0.8;
  g.fill();
  g.restore();
}

// Glossy gold medal with a star: the winner's badge.
export function drawMedal(g, x, y, r) {
  if (r <= 0) return;
  g.save();
  g.shadowColor = 'rgba(120, 70, 0, 0.45)';
  g.shadowBlur = r * 0.4;
  g.shadowOffsetY = r * 0.12;
  const body = g.createLinearGradient(0, y - r, 0, y + r);
  body.addColorStop(0, '#fff3b0');
  body.addColorStop(0.45, '#ffd34d');
  body.addColorStop(1, '#e09a12');
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = body;
  g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = Math.max(2, r * 0.08);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.stroke();
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.25 : r * 0.58;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = '#ffffff';
  g.fill();
  g.beginPath();
  g.ellipse(x - r * 0.1, y - r * 0.5, r * 0.6, r * 0.28, -0.2, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fill();
  g.restore();
}

// The four player LEDs off a Wii remote: `player` (1-4, or a list of them) lit and glowing,
// `glow` 0..1 pulses it.
export function drawPlayerLeds(g, cx, cy, { player, glow = 1, scale = 1 } = {}) {
  const players = [player].flat();
  const gap = 46 * scale;
  const size = 22 * scale;
  const bar = { x: cx - gap * 2 - 4 * scale, y: cy - 30 * scale, w: gap * 4 + 8 * scale, h: 60 * scale };
  g.save();
  roundRect(g, bar.x, bar.y, bar.w, bar.h, bar.h / 2);
  const body = g.createLinearGradient(0, bar.y, 0, bar.y + bar.h);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(1, '#dfe6ec');
  g.fillStyle = body;
  g.shadowColor = 'rgba(0, 34, 84, 0.35)';
  g.shadowBlur = 14 * scale;
  g.shadowOffsetY = 4 * scale;
  g.fill();
  g.restore();
  for (let i = 0; i < 4; i++) {
    const x = cx + (i - 1.5) * gap;
    const lit = players.includes(i + 1);
    g.save();
    roundRect(g, x - size / 2, cy - size / 2, size, size, 5 * scale);
    if (lit) {
      g.shadowColor = '#34b9ff';
      g.shadowBlur = (10 + 14 * glow) * scale;
    }
    g.fillStyle = lit ? '#34b9ff' : '#cdd6dd';
    g.fill();
    g.restore();
  }
}
